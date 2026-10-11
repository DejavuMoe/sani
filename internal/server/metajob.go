package server

import (
	"context"
	"time"

	"github.com/DejavuMoe/sani/internal/links"
	"github.com/DejavuMoe/sani/internal/meta"
	"github.com/DejavuMoe/sani/internal/store"
)

// Icons are refetched after this long; a failed fetch is retried sooner.
const (
	iconTTL       = 30 * 24 * time.Hour
	iconRetryWait = 24 * time.Hour
	maxMetaJobs   = 1024
)

type metadataJob struct {
	link   *store.Link
	ctx    context.Context
	cancel context.CancelFunc
}

// startMetaLocked hands pending state to one job, before it can wait for a slot.
func (s *Server) startMetaLocked(ctx context.Context, l *store.Link) *metadataJob {
	if old := s.metaJobs[l.ID]; old != nil {
		old.cancel()
	} else if len(s.metaJobs) >= maxMetaJobs {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		defer cancel()
		if err := s.store.SetFetchedMeta(cleanup, l.ID, l.URL, "", store.MetaFailed); err != nil {
			s.log.Warn("store metadata queue overflow", "err", err)
		} else if l.Meta == store.MetaPending {
			l.Meta = store.MetaFailed
		}
		return nil
	}
	if s.metaJobs == nil {
		s.metaJobs = make(map[int64]*metadataJob)
	}
	ctx, cancel := context.WithCancel(ctx)
	j := &metadataJob{link: l, ctx: ctx, cancel: cancel}
	s.metaJobs[l.ID] = j
	return j
}

func (s *Server) finishMeta(j *metadataJob) {
	s.metaMu.Lock()
	defer s.metaMu.Unlock()
	j.cancel()
	if s.metaJobs[j.link.ID] == j {
		delete(s.metaJobs, j.link.ID)
	}
}

func (s *Server) completeMeta(j *metadataJob, title string, state store.MetaState) {
	s.metaMu.Lock()
	defer s.metaMu.Unlock()
	if s.metaJobs[j.link.ID] != j {
		return
	}
	// Shutdown/request cancellation must still settle the current owner, within a bound.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(j.ctx), 3*time.Second)
	defer cancel()
	if err := s.store.SetFetchedMeta(ctx, j.link.ID, j.link.URL, title, state); err != nil {
		s.log.Warn("store page metadata", "err", err)
	}
}

// fetchMetaLater fetches a link's title and icon in the background, a few
// at a time so a large batch cannot flood outbound connections.
func (s *Server) fetchMetaLater(id int64, url, host, lang string) {
	s.metaMu.Lock()
	defer s.metaMu.Unlock()
	// A delayed creation must not replace a refresh that already owns this row.
	if s.metaJobs[id] != nil {
		return
	}
	// Settle soft-deleted rows too, so an undo cannot restore abandoned pending work.
	s.queueMetaLocked(&store.Link{ID: id, URL: url, Host: host}, lang)
}

func (s *Server) queueMetaLocked(l *store.Link, lang string) {
	j := s.startMetaLocked(s.ctx, l)
	if j == nil {
		return
	}
	s.jobs.Add(1)
	go func() {
		defer s.jobs.Done()
		defer s.finishMeta(j)
		select {
		case s.jobSlots <- struct{}{}:
		case <-j.ctx.Done():
			s.completeMeta(j, "", store.MetaFailed)
			return
		}
		defer func() { <-s.jobSlots }()
		fetcher := s.metadataFetcher()
		if fetcher == nil {
			s.completeMeta(j, "", store.MetaFailed)
			return
		}
		s.fetchMetaUsing(j, fetcher, lang, false)
	}()
}

// updateLinkMeta keeps metadata-affecting edits and ownership handoff atomic.
func (s *Server) updateLinkMeta(ctx context.Context, id int64, p store.Patch, now int64, lang string) (*store.Link, *store.Link, error) {
	s.metaMu.Lock()
	defer s.metaMu.Unlock()
	before, after, err := s.store.UpdateLink(ctx, id, p, now)
	if err == nil && after.Kind == store.KindURL && (p.Title != nil || before.URL != after.URL) {
		if after.Meta == store.MetaPending {
			s.queueMetaLocked(after, lang)
		} else if old := s.metaJobs[id]; old != nil {
			old.cancel()
			delete(s.metaJobs, id)
		}
	}
	return before, after, err
}

func (s *Server) refreshMeta(ctx context.Context, id int64, fetcher *meta.Fetcher, lang string) error {
	s.metaMu.Lock()
	_, l, err := s.store.UpdateLink(ctx, id, store.Patch{RefreshMeta: true}, 0)
	var j *metadataJob
	if err == nil {
		j = s.startMetaLocked(ctx, l)
	}
	s.metaMu.Unlock()
	if j != nil {
		defer s.finishMeta(j)
		s.fetchMetaUsing(j, fetcher, lang, true)
	}
	return err
}

func (s *Server) fetchMetaUsing(j *metadataJob, fetcher *meta.Fetcher, lang string, forceIcon bool) {
	ctx, cancel := context.WithTimeout(j.ctx, 20*time.Second)
	defer cancel()

	page, err := fetcher.Page(ctx, j.link.URL, lang)
	state, title := store.MetaFailed, ""
	var icons []string
	if err != nil {
		s.log.Debug("fetch page metadata", "url", j.link.URL, "err", err)
		icons = meta.FallbackIcons(j.link.URL)
	} else {
		title = links.CleanTitle(page.Title)
		if title != "" {
			state = store.MetaOK
		}
		icons = page.Icons
	}
	s.completeMeta(j, title, state)
	if j.link.Host != "" && len(icons) > 0 {
		s.fetchIcon(ctx, j.link.Host, icons, forceIcon)
	}
}

func (s *Server) fetchIcon(ctx context.Context, host string, candidates []string, force bool) {
	now := time.Now()
	existing, err := s.store.Favicon(ctx, host)
	if err == nil && !force {
		wait := iconTTL
		if existing.Type == "" {
			wait = iconRetryWait
		}
		if now.Sub(time.UnixMilli(existing.FetchedAt)) < wait {
			return
		}
	}
	for i, c := range candidates {
		if i == 4 {
			break
		}
		fetcher := s.metadataFetcher()
		if fetcher == nil {
			return
		}
		ct, data, err := fetcher.Icon(ctx, c)
		if err != nil {
			s.log.Debug("fetch icon", "url", c, "err", err)
			continue
		}
		if err := s.store.PutFavicon(ctx, host, &store.Favicon{Type: ct, Data: data, FetchedAt: now.UnixMilli()}); err != nil {
			s.log.Warn("store icon", "err", err)
		}
		return
	}
	if ctx.Err() != nil {
		return
	}
	// Keep an older icon rather than replacing it with nothing.
	f := &store.Favicon{Type: "", Data: []byte{}, FetchedAt: now.UnixMilli()}
	if existing != nil && existing.Type != "" {
		f = existing
		// Retained bytes still use iconTTL; expire their effective freshness after one day.
		f.FetchedAt = now.Add(-iconTTL + iconRetryWait).UnixMilli()
	}
	if err := s.store.PutFavicon(ctx, host, f); err != nil {
		s.log.Warn("store icon", "err", err)
	}
}
