package server

import (
	"bytes"
	"net/http"
	"strings"
	"time"

	"github.com/DejavuMoe/sani/internal/links"
	"github.com/DejavuMoe/sani/internal/meta"
)

var (
	cacheTemporary = []string{"private, max-age=0"}
	cachePermanent = []string{"public, max-age=86400"}
)

// redirect resolves /{slug}. It is the hot path: a cache hit costs a map
// lookup, and counting a click is an in-memory increment.
func (s *Server) redirect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	slug := strings.TrimSuffix(r.URL.Path[1:], "/")
	if !links.Plausible(slug) {
		s.pages.render(w, r, pageNotFound, slug)
		return
	}
	e, err := s.cache.Get(r.Context(), links.Key(slug))
	if err != nil {
		if r.Context().Err() == nil {
			s.log.Error("resolve link", "slug", slug, "err", err)
		}
		s.pages.render(w, r, pageError, slug)
		return
	}
	if e == nil {
		s.pages.render(w, r, pageNotFound, slug)
		return
	}

	now := time.Now()
	if !e.Enabled || (e.ExpiresAt != 0 && now.UnixMilli() >= e.ExpiresAt) {
		s.pages.render(w, r, pageGone, slug)
		return
	}
	count := s.countable(r)
	if e.MaxClicks > 0 {
		if count {
			if n := e.Clicks.Add(1); n > e.MaxClicks {
				e.Clicks.Add(-1)
				s.pages.render(w, r, pageGone, slug)
				return
			}
		} else if e.Clicks.Load() >= e.MaxClicks {
			s.pages.render(w, r, pageGone, slug)
			return
		}
	}
	if count {
		s.clicks.Record(e.ID, referrerHost(r.Header.Get("Referer")), now)
	}

	loc := e.Location
	if s.opt.ForwardQuery && r.URL.RawQuery != "" {
		loc = mergeQuery(loc, r.URL.RawQuery)
	}
	h := w.Header()
	h["Location"] = []string{loc}
	if e.Code == http.StatusMovedPermanently || e.Code == http.StatusPermanentRedirect {
		h["Cache-Control"] = cachePermanent
	} else {
		h["Cache-Control"] = cacheTemporary
	}
	w.WriteHeader(e.Code)
}

// countable reports whether a request looks like a person following the
// link: not a HEAD, prefetch, crawler, link preview or the owner testing
// the link from the dashboard.
func (s *Server) countable(r *http.Request) bool {
	if r.Method != http.MethodGet {
		return false
	}
	h := r.Header
	if p := h.Get("Sec-Purpose"); p != "" && strings.Contains(p, "prefetch") {
		return false
	}
	if p := h.Get("Purpose"); p != "" && strings.Contains(p, "prefetch") {
		return false
	}
	if h.Get(meta.PreviewHeader) != "" {
		return false
	}
	if isBot(r.UserAgent()) {
		return false
	}
	if ref := h.Get("Referer"); ref != "" && fromAdmin(ref, r.Host) {
		return false
	}
	return true
}

var botMarkers = [][]byte{
	[]byte("bot"), []byte("spider"), []byte("crawl"), []byte("slurp"), []byte("preview"),
	[]byte("facebookexternalhit"), []byte("meta-externalagent"), []byte("embedly"), []byte("whatsapp"),
	[]byte("vkshare"), []byte("skypeuripreview"), []byte("headless"), []byte("lighthouse"), []byte("pingdom"),
	[]byte("uptime"), []byte("monitor"), []byte("curl/"), []byte("wget/"), []byte("python"), []byte("go-http-client"),
	[]byte("okhttp"), []byte("java/"), []byte("libwww"), []byte("httpclient"), []byte("axios/"), []byte("node-fetch"),
	[]byte("scrapy"), []byte("feedfetcher"), []byte("mastodon"), []byte("pleroma"), []byte("misskey"),
}

func isBot(ua string) bool {
	if ua == "" {
		return true
	}
	var buf [512]byte
	b := buf[:copy(buf[:], ua)]
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + ('a' - 'A')
		}
	}
	for _, m := range botMarkers {
		if bytes.Contains(b, m) {
			return true
		}
	}
	return false
}

// referrerHost reduces a Referer to its host, without "www.". Slicing keeps
// this allocation-free for the common already-lowercase case.
func referrerHost(ref string) string {
	i := strings.Index(ref, "://")
	if i < 0 {
		return ""
	}
	h := ref[i+3:]
	if end := strings.IndexAny(h, "/?#"); end >= 0 {
		h = h[:end]
	}
	if at := strings.LastIndexByte(h, '@'); at >= 0 {
		h = h[at+1:]
	}
	if c := strings.LastIndexByte(h, ':'); c >= 0 && !strings.HasSuffix(h, "]") {
		h = h[:c]
	}
	if len(h) == 0 || len(h) > 253 {
		return ""
	}
	for i := 0; i < len(h); i++ {
		c := h[i]
		if c >= 'A' && c <= 'Z' {
			h = strings.ToLower(h)
			break
		}
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '.' || c == '-' || c == '_' || c == '[' || c == ']' || c == ':') {
			return ""
		}
	}
	return strings.TrimPrefix(h, "www.")
}

// fromAdmin reports whether a Referer is this server's own dashboard.
func fromAdmin(ref, host string) bool {
	i := strings.Index(ref, "://")
	if i < 0 {
		return false
	}
	rest := ref[i+3:]
	return strings.HasPrefix(rest, host+"/admin")
}

// mergeQuery appends the visitor's query string to the destination, before
// any fragment.
func mergeQuery(loc, query string) string {
	frag := ""
	if i := strings.IndexByte(loc, '#'); i >= 0 {
		loc, frag = loc[:i], loc[i:]
	}
	sep := "?"
	if strings.IndexByte(loc, '?') >= 0 {
		sep = "&"
		if strings.HasSuffix(loc, "?") || strings.HasSuffix(loc, "&") {
			sep = ""
		}
	}
	return loc + sep + query + frag
}
