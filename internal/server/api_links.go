package server

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/DejavuMoe/sani/internal/clicks"
	"github.com/DejavuMoe/sani/internal/links"
	"github.com/DejavuMoe/sani/internal/store"
)

type linkDTO struct {
	ID          int64      `json:"id"`
	Slug        string     `json:"slug"`
	ShortURL    string     `json:"shortUrl"`
	URL         string     `json:"url"`
	Host        string     `json:"host"`
	Title       string     `json:"title"`
	Meta        string     `json:"meta"`
	Icon        bool       `json:"icon"`
	Redirect    int        `json:"redirect"`
	Enabled     bool       `json:"enabled"`
	Status      string     `json:"status"`
	ExpiresAt   *time.Time `json:"expiresAt"`
	MaxClicks   *int64     `json:"maxClicks"`
	Clicks      int64      `json:"clicks"`
	LastClickAt *time.Time `json:"lastClickAt"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	Spark       []int64    `json:"spark,omitempty"`
	Reused      bool       `json:"reused,omitempty"`
}

var metaNames = map[store.MetaState]string{
	store.MetaPending: "pending",
	store.MetaOK:      "ok",
	store.MetaFailed:  "failed",
	store.MetaManual:  "manual",
}

func (s *Server) toDTO(base string, l *store.Link, now int64) linkDTO {
	clicks := l.Clicks + s.clicks.Pending(l.ID)
	d := linkDTO{
		ID:          l.ID,
		Slug:        l.Slug,
		ShortURL:    base + "/" + l.Slug,
		URL:         l.URL,
		Host:        strings.TrimPrefix(l.Host, "www."),
		Title:       l.Title,
		Meta:        metaNames[l.Meta],
		Icon:        l.HasIcon,
		Redirect:    l.Redirect,
		Enabled:     l.Enabled,
		ExpiresAt:   msTime(l.ExpiresAt),
		Clicks:      clicks,
		LastClickAt: msTime(l.LastClickAt),
		CreatedAt:   time.UnixMilli(l.CreatedAt).UTC(),
		UpdatedAt:   time.UnixMilli(l.UpdatedAt).UTC(),
	}
	if l.MaxClicks > 0 {
		d.MaxClicks = &l.MaxClicks
	}
	switch {
	case !l.Enabled:
		d.Status = "disabled"
	case l.ExpiresAt != 0 && now >= l.ExpiresAt:
		d.Status = "expired"
	case l.MaxClicks > 0 && clicks >= l.MaxClicks:
		d.Status = "exhausted"
	default:
		d.Status = "active"
	}
	return d
}

// linkInput is the body of create and update requests. Absent fields keep
// their value on update; null clears expiresAt and maxClicks.
type linkInput struct {
	URL       *string           `json:"url"`
	Slug      *string           `json:"slug"`
	Title     *string           `json:"title"`
	Redirect  *int              `json:"redirect"`
	Enabled   *bool             `json:"enabled"`
	ExpiresAt nullable[string]  `json:"expiresAt"`
	MaxClicks nullable[float64] `json:"maxClicks"`
	// Reuse returns an existing plain link to the same destination instead
	// of creating another one; "shorten this page" flows set it.
	Reuse bool `json:"reuse"`
}

type inputError struct {
	status int
	code   string
	msg    string
}

func (e *inputError) Error() string { return e.msg }

func badInput(code, msg string) *inputError {
	return &inputError{status: http.StatusBadRequest, code: code, msg: msg}
}

var linkErrors = map[error]string{
	links.ErrURLRequired:  "url_required",
	links.ErrURLInvalid:   "url_invalid",
	links.ErrURLTooLong:   "url_too_long",
	links.ErrURLScheme:    "url_scheme",
	links.ErrSlugInvalid:  "slug_invalid",
	links.ErrSlugTooLong:  "slug_too_long",
	links.ErrSlugReserved: "slug_reserved",
}

func fromLinkError(err error) *inputError {
	return badInput(linkErrors[err], err.Error())
}

// resolveInput validates in and turns it into a patch.
func (s *Server) resolveInput(r *http.Request, in *linkInput, now int64) (*store.Patch, *inputError) {
	p := &store.Patch{}
	if in.URL != nil {
		u, err := links.NormalizeURL(*in.URL)
		if err != nil {
			return nil, fromLinkError(err)
		}
		if s.pointsHere(r, u) {
			return nil, badInput("url_self", "a short link cannot point to this service")
		}
		p.URL = &u
	}
	if in.Slug != nil {
		slug := strings.TrimSpace(*in.Slug)
		slug = strings.TrimPrefix(slug, "/")
		if slug != "" {
			if err := links.ValidateSlug(slug); err != nil {
				return nil, fromLinkError(err)
			}
		}
		p.Slug = &slug
	}
	if in.Title != nil {
		t := links.CleanTitle(*in.Title)
		p.Title = &t
	}
	if in.Redirect != nil {
		switch *in.Redirect {
		case 301, 302, 307, 308:
			p.Redirect = in.Redirect
		default:
			return nil, badInput("redirect_invalid", "redirect must be 301, 302, 307 or 308")
		}
	}
	p.Enabled = in.Enabled
	if in.ExpiresAt.Set {
		var ms int64
		if !in.ExpiresAt.Null && in.ExpiresAt.Value != "" {
			t, err := time.Parse(time.RFC3339, in.ExpiresAt.Value)
			if err != nil {
				return nil, badInput("expires_invalid", "expiresAt must be an RFC 3339 timestamp")
			}
			ms = t.UnixMilli()
			if ms <= now {
				return nil, badInput("expires_past", "expiresAt must be in the future")
			}
		}
		p.ExpiresAt = &ms
	}
	if in.MaxClicks.Set {
		var n int64
		if !in.MaxClicks.Null {
			v := in.MaxClicks.Value
			if v < 0 || v != float64(int64(v)) || v > 1e12 {
				return nil, badInput("max_clicks_invalid", "maxClicks must be a positive whole number")
			}
			n = int64(v)
		}
		p.MaxClicks = &n
	}
	return p, nil
}

// pointsHere reports whether a destination is a short link on this server,
// which would at best loop and at worst hide a chain of redirects.
func (s *Server) pointsHere(r *http.Request, dest string) bool {
	d, err := url.Parse(dest)
	if err != nil || d.Host == "" {
		return false
	}
	for _, origin := range []string{s.baseURL(r), s.requestOrigin(r)} {
		o, err := url.Parse(origin)
		if err == nil && strings.EqualFold(o.Host, d.Host) {
			seg := strings.Trim(d.Path, "/")
			return seg != "" && !strings.Contains(seg, "/") && seg != "admin" && seg != "api"
		}
	}
	return false
}

func (s *Server) listLinks(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	lq := store.ListQuery{Sort: q.Get("sort")}
	lq.Limit, _ = strconv.Atoi(q.Get("limit"))
	if c := q.Get("cursor"); c != "" {
		cur, ok := store.ParseCursor(c)
		if !ok {
			writeError(w, http.StatusBadRequest, "cursor_invalid", "invalid cursor")
			return
		}
		lq.After = cur
	}
	base := s.baseURL(r)
	search := strings.TrimSpace(q.Get("q"))
	// Pasting a short URL into search should find that link.
	search = strings.TrimPrefix(search, base+"/")
	search = strings.TrimPrefix(search, "/")
	lq.Search = search

	res, err := s.store.ListLinks(r.Context(), lq)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	now := time.Now()
	ids := make([]int64, len(res.Links))
	for i, l := range res.Links {
		ids[i] = l.ID
	}
	today := s.clicks.Day(now)
	sparks, err := s.store.Sparks(r.Context(), ids, today-13, today)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	items := make([]linkDTO, len(res.Links))
	for i, l := range res.Links {
		items[i] = s.toDTO(base, l, now.UnixMilli())
		if sp := sparks[l.ID]; sp != nil {
			sp[len(sp)-1] += s.clicks.Pending(l.ID)
			items[i].Spark = sp
		} else if n := s.clicks.Pending(l.ID); n > 0 {
			sp := make([]int64, 14)
			sp[13] = n
			items[i].Spark = sp
		}
	}
	var next *string
	if res.Next != nil {
		c := res.Next.String()
		next = &c
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next": next, "total": res.Total})
}

func (s *Server) createLink(w http.ResponseWriter, r *http.Request) {
	var in linkInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.URL == nil {
		writeError(w, http.StatusBadRequest, "url_required", "url is required")
		return
	}
	now := time.Now().UnixMilli()
	p, ierr := s.resolveInput(r, &in, now)
	if ierr != nil {
		writeError(w, ierr.status, ierr.code, ierr.msg)
		return
	}
	plain := (p.Slug == nil || *p.Slug == "") && p.ExpiresAt == nil && p.MaxClicks == nil &&
		p.Redirect == nil && (p.Enabled == nil || *p.Enabled)
	if in.Reuse && plain {
		existing, err := s.store.FindPlainLink(r.Context(), *p.URL)
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			s.internalError(w, r, err)
			return
		}
		if existing != nil {
			d := s.toDTO(s.baseURL(r), existing, now)
			d.Reused = true
			writeJSON(w, http.StatusOK, d)
			return
		}
	}
	l := &store.Link{
		URL:       *p.URL,
		Host:      links.FetchHost(*p.URL),
		Redirect:  http.StatusFound,
		Enabled:   true,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if p.Title != nil {
		l.Title = *p.Title
	}
	if p.Redirect != nil {
		l.Redirect = *p.Redirect
	}
	if p.Enabled != nil {
		l.Enabled = *p.Enabled
	}
	if p.ExpiresAt != nil {
		l.ExpiresAt = *p.ExpiresAt
	}
	if p.MaxClicks != nil {
		l.MaxClicks = *p.MaxClicks
	}
	switch {
	case l.Title != "":
		l.Meta = store.MetaManual
	case !s.opt.FetchMeta:
		l.Meta = store.MetaFailed
	}

	var err error
	if p.Slug != nil && *p.Slug != "" {
		l.Slug = *p.Slug
		err = s.store.CreateLink(r.Context(), l, true)
	} else {
		err = s.createGenerated(r, l)
	}
	if errors.Is(err, store.ErrSlugTaken) {
		writeError(w, http.StatusConflict, "slug_taken", "this slug is already in use")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	s.cache.Invalidate(links.Key(l.Slug))
	if l.Meta == store.MetaPending {
		s.fetchMetaLater(l.ID, l.URL, l.Host, r.Header.Get("Accept-Language"))
	}
	writeJSON(w, http.StatusCreated, s.toDTO(s.baseURL(r), l, now))
}

// createGenerated inserts l under a fresh random slug, growing the slug when
// the space at the configured length gets crowded.
func (s *Server) createGenerated(r *http.Request, l *store.Link) error {
	n := s.opt.SlugLength
	for attempt := 0; ; attempt++ {
		l.Slug = links.Generate(n)
		if links.IsReserved(l.Slug) {
			continue
		}
		err := s.store.CreateLink(r.Context(), l, false)
		if !errors.Is(err, store.ErrSlugTaken) {
			return err
		}
		if attempt%4 == 3 {
			n++
		}
		if attempt > 40 {
			return err
		}
	}
}

func (s *Server) getLink(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	l, err := s.store.GetLink(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "no such link")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, s.toDTO(s.baseURL(r), l, time.Now().UnixMilli()))
}

func (s *Server) updateLink(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in linkInput
	if !decodeJSON(w, r, &in) {
		return
	}
	now := time.Now().UnixMilli()
	p, ierr := s.resolveInput(r, &in, now)
	if ierr != nil {
		writeError(w, ierr.status, ierr.code, ierr.msg)
		return
	}
	if p.Slug != nil && *p.Slug == "" {
		writeError(w, http.StatusBadRequest, "slug_invalid", "slug cannot be empty")
		return
	}
	current, err := s.store.GetLink(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "no such link")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}

	// An owner-provided title is kept for good; clearing it, or moving an
	// auto-titled link elsewhere, fetches a fresh one.
	refetch := false
	switch {
	case p.Title != nil && *p.Title != "":
		m := store.MetaManual
		p.Meta = &m
	case p.Title != nil || (p.URL != nil && *p.URL != current.URL && current.Meta != store.MetaManual):
		empty, m := "", store.MetaPending
		if !s.opt.FetchMeta {
			m = store.MetaFailed
		}
		p.Title, p.Meta = &empty, &m
		refetch = s.opt.FetchMeta
	}

	before, after, err := s.store.UpdateLink(r.Context(), id, *p, now)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "no such link")
		return
	}
	if errors.Is(err, store.ErrSlugTaken) {
		writeError(w, http.StatusConflict, "slug_taken", "this slug is already in use")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	s.cache.Invalidate(links.Key(before.Slug), links.Key(after.Slug))
	if refetch {
		s.fetchMetaLater(after.ID, after.URL, after.Host, r.Header.Get("Accept-Language"))
	}
	writeJSON(w, http.StatusOK, s.toDTO(s.baseURL(r), after, now))
}

func (s *Server) deleteLink(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	key, err := s.store.DeleteLink(r.Context(), id, time.Now().UnixMilli())
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "no such link")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	s.cache.Invalidate(key)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) restoreLink(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	l, err := s.store.RestoreLink(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "the link can no longer be restored")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	s.cache.Invalidate(links.Key(l.Slug))
	writeJSON(w, http.StatusOK, s.toDTO(s.baseURL(r), l, time.Now().UnixMilli()))
}

var bulkActions = map[string]store.BulkAction{
	"enable":  store.BulkEnable,
	"disable": store.BulkDisable,
	"delete":  store.BulkDelete,
	"restore": store.BulkRestore,
}

// maxBulk bounds one request; the admin app never sends more than it has
// loaded, which is a few hundred links at most.
const maxBulk = 500

// bulkLinks turns links on or off, deletes or restores them, many at once.
func (s *Server) bulkLinks(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Action string  `json:"action"`
		IDs    []int64 `json:"ids"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	action, ok := bulkActions[in.Action]
	if !ok {
		writeError(w, http.StatusBadRequest, "bulk_invalid", "action must be enable, disable, delete or restore")
		return
	}
	seen := map[int64]bool{}
	ids := make([]int64, 0, len(in.IDs))
	for _, id := range in.IDs {
		if id > 0 && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 || len(ids) > maxBulk {
		writeError(w, http.StatusBadRequest, "bulk_invalid", "ids must list 1 to 500 links")
		return
	}
	now := time.Now().UnixMilli()
	changed, err := s.store.Bulk(r.Context(), action, ids, now)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	keys := make([]string, len(changed))
	for i, l := range changed {
		keys[i] = links.Key(l.Slug)
	}
	s.cache.Invalidate(keys...)
	base := s.baseURL(r)
	items := make([]linkDTO, len(changed))
	for i, l := range changed {
		items[i] = s.toDTO(base, l, now)
	}
	s.log.Info("bulk change", "action", in.Action, "links", len(changed))
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// refreshLink fetches the title and icon again and waits for the result.
func (s *Server) refreshLink(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	l, err := s.store.GetLink(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "no such link")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if l.Meta != store.MetaManual {
		empty, pending := "", store.MetaPending
		if _, l, err = s.store.UpdateLink(r.Context(), id, store.Patch{Title: &empty, Meta: &pending}, l.UpdatedAt); err != nil {
			s.internalError(w, r, err)
			return
		}
	}
	s.fetchMeta(r.Context(), l.ID, l.URL, l.Host, r.Header.Get("Accept-Language"), true)
	if l, err = s.store.GetLink(r.Context(), id); err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, s.toDTO(s.baseURL(r), l, time.Now().UnixMilli()))
}

type dayCount struct {
	Date  string `json:"date"`
	Count int64  `json:"count"`
}

func (s *Server) series(r *http.Request, linkID int64, days int) ([]dayCount, error) {
	today := s.clicks.Day(time.Now())
	from := today - int32(days) + 1
	counts, err := s.store.Series(r.Context(), linkID, from, today)
	if err != nil {
		return nil, err
	}
	out := make([]dayCount, len(counts))
	for i, n := range counts {
		out[i] = dayCount{Date: clicks.DayDate(from + int32(i)), Count: n}
	}
	return out, nil
}

func parseDays(r *http.Request) int {
	d, err := strconv.Atoi(r.URL.Query().Get("days"))
	if err != nil || d < 1 {
		return 30
	}
	return min(d, 366)
}

func (s *Server) linkStats(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.clicks.Flush(r.Context()); err != nil {
		s.log.Warn("flush clicks", "err", err)
	}
	l, err := s.store.GetLink(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "no such link")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	days, err := s.series(r, id, parseDays(r))
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	refs, refTotal, err := s.store.Referrers(r.Context(), id, 8)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	type ref struct {
		Host  string `json:"host"`
		Count int64  `json:"count"`
	}
	out := make([]ref, len(refs))
	for i, x := range refs {
		out[i] = ref{Host: x.Host, Count: x.Count}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"link":           s.toDTO(s.baseURL(r), l, time.Now().UnixMilli()),
		"days":           days,
		"referrers":      out,
		"referrersTotal": refTotal,
	})
}

func (s *Server) overview(w http.ResponseWriter, r *http.Request) {
	if err := s.clicks.Flush(r.Context()); err != nil {
		s.log.Warn("flush clicks", "err", err)
	}
	nLinks, nClicks, err := s.store.Totals(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	days, err := s.series(r, 0, parseDays(r))
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"links":  nLinks,
		"clicks": nClicks,
		"today":  days[len(days)-1].Count,
		"days":   days,
	})
}

func (s *Server) checkSlug(w http.ResponseWriter, r *http.Request) {
	slug := strings.TrimPrefix(strings.TrimSpace(r.PathValue("slug")), "/")
	if err := links.ValidateSlug(slug); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"available": false, "reason": linkErrors[err]})
		return
	}
	ok, err := s.store.SlugAvailable(r.Context(), links.Key(slug))
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	res := map[string]any{"available": ok}
	if !ok {
		res["reason"] = "slug_taken"
	}
	writeJSON(w, http.StatusOK, res)
}
