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
)

// fetchMetaLater fetches a link's title and icon in the background, a few
// at a time so a large batch cannot flood outbound connections.
func (s *Server) fetchMetaLater(id int64, url, host, lang string) {
	if !s.opt.FetchMeta {
		return
	}
	s.jobs.Add(1)
	go func() {
		defer s.jobs.Done()
		select {
		case s.jobSlots <- struct{}{}:
		case <-s.ctx.Done():
			return
		}
		defer func() { <-s.jobSlots }()
		s.fetchMeta(s.ctx, id, url, host, lang, false)
	}()
}

func (s *Server) fetchMeta(ctx context.Context, id int64, url, host, lang string, forceIcon bool) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	page, err := s.fetcher.Page(ctx, url, lang)
	state, title := store.MetaFailed, ""
	var icons []string
	if err != nil {
		s.log.Debug("fetch page metadata", "url", url, "err", err)
		icons = meta.FallbackIcons(url)
	} else {
		title = links.CleanTitle(page.Title)
		if title != "" {
			state = store.MetaOK
		}
		icons = page.Icons
	}
	if err := s.store.SetFetchedMeta(context.WithoutCancel(ctx), id, url, title, state); err != nil {
		s.log.Warn("store page metadata", "err", err)
	}
	if host != "" && len(icons) > 0 {
		s.fetchIcon(ctx, host, icons, forceIcon)
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
		ct, data, err := s.fetcher.Icon(ctx, c)
		if err != nil {
			s.log.Debug("fetch icon", "url", c, "err", err)
			continue
		}
		if err := s.store.PutFavicon(ctx, host, &store.Favicon{Type: ct, Data: data, FetchedAt: now.UnixMilli()}); err != nil {
			s.log.Warn("store icon", "err", err)
		}
		return
	}
	// Keep an older icon rather than replacing it with nothing.
	f := &store.Favicon{Type: "", Data: []byte{}, FetchedAt: now.UnixMilli()}
	if existing != nil && existing.Type != "" {
		f = existing
		f.FetchedAt = now.UnixMilli()
	}
	if err := s.store.PutFavicon(context.WithoutCancel(ctx), host, f); err != nil {
		s.log.Warn("store icon", "err", err)
	}
}
