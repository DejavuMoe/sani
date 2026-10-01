// Package server wires the HTTP surface: short link redirects at the root,
// the JSON API under /api and the embedded admin app under /admin.
package server

import (
	"context"
	"errors"
	"html/template"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/DejavuMoe/sani/internal/auth"
	"github.com/DejavuMoe/sani/internal/cache"
	"github.com/DejavuMoe/sani/internal/clicks"
	"github.com/DejavuMoe/sani/internal/links"
	"github.com/DejavuMoe/sani/internal/meta"
	"github.com/DejavuMoe/sani/internal/store"
)

type Options struct {
	BaseURL         string // fixed public origin; overrides the stored setting
	RootRedirect    string // where "/" sends visitors; the admin app when empty
	TrustProxy      bool   // honor X-Forwarded-* headers
	SlugLength      int
	FetchMeta       bool
	ForwardQuery    bool
	PasswordFromEnv bool
	CacheSize       int
	Version         string

	// FilesURL is the origin that serves shared files and raw text; empty
	// turns file sharing off. FilesDir holds the uploaded files.
	FilesURL     string
	FilesDir     string
	MaxFileBytes int64

	// SetupCode must accompany the first password, so a fresh instance on
	// the internet cannot be claimed by whoever finds it first. It is
	// printed to the log at startup.
	SetupCode string
}

type Server struct {
	opt     Options
	store   *store.Store
	cache   *cache.Cache
	clicks  *clicks.Recorder
	fetcher *meta.Fetcher
	log     *slog.Logger
	logins  *auth.Limiter
	web     *webApp
	pages   *pages
	api     http.Handler

	storedBase atomic.Pointer[string] // base URL from settings

	ctx      context.Context // canceled on shutdown; parents background jobs
	cancel   context.CancelFunc
	jobs     sync.WaitGroup
	jobSlots chan struct{}

	filesHost string        // host[:port] of FilesURL
	downloads chan struct{} // bounds concurrent file downloads
	share     *template.Template
}

func New(opt Options, st *store.Store, rec *clicks.Recorder, fetcher *meta.Fetcher, ui fs.FS, log *slog.Logger) (*Server, error) {
	if opt.SlugLength <= 0 {
		opt.SlugLength = 5
	}
	if opt.MaxFileBytes <= 0 {
		opt.MaxFileBytes = 64 << 20
	}
	s := &Server{
		opt:       opt,
		store:     st,
		clicks:    rec,
		fetcher:   fetcher,
		log:       log,
		logins:    auth.NewLimiter(8, 15*time.Minute),
		pages:     newPages(),
		jobSlots:  make(chan struct{}, 3),
		downloads: make(chan struct{}, maxDownloads),
		share:     template.Must(template.New("share").Parse(sharePage)),
	}
	if opt.FilesURL != "" {
		_, s.filesHost, _ = strings.Cut(opt.FilesURL, "://")
	}
	s.ctx, s.cancel = context.WithCancel(context.Background())
	s.cache = cache.New(opt.CacheSize, s.loadTarget)

	base, err := st.Setting(context.Background(), store.SettingBaseURL)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return nil, err
	}
	s.storedBase.Store(&base)

	if s.web, err = newWebApp(ui); err != nil {
		return nil, err
	}
	s.api = s.routes()
	return s, nil
}

func (s *Server) loadTarget(ctx context.Context, key string) (*cache.Entry, error) {
	t, err := s.store.Resolve(ctx, key)
	if errors.Is(err, store.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	e := &cache.Entry{
		ID:        t.ID,
		Kind:      uint8(t.Kind),
		Location:  links.Location(t.URL),
		Code:      t.Redirect,
		Enabled:   t.Enabled,
		ExpiresAt: t.ExpiresAt,
		MaxClicks: t.MaxClicks,
	}
	e.Clicks.Store(t.Clicks + s.clicks.Pending(t.ID))
	return e, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if s.filesHost != "" && s.onFilesOrigin(r) {
		s.serveFiles(w, r)
		return
	}
	p := r.URL.Path
	switch {
	case len(p) > 3 && strings.HasPrefix(p, "/p/"):
		s.serveShare(w, r)
	case p == "/":
		s.serveRoot(w, r)
	case strings.HasPrefix(p, "/api/"):
		s.api.ServeHTTP(w, r)
	case p == "/admin" || strings.HasPrefix(p, "/admin/"):
		s.web.serveApp(w, r)
	case p == "/healthz":
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		io.WriteString(w, "ok\n")
	case p == "/robots.txt":
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		io.WriteString(w, "User-agent: *\nDisallow: /admin/\nDisallow: /api/\nDisallow: /p/\n")
	case p == "/favicon.ico" || p == "/favicon.svg" || p == "/apple-touch-icon.png":
		s.web.serveRootFile(w, r, strings.TrimPrefix(p, "/"))
	default:
		s.redirect(w, r)
	}
}

func (s *Server) serveRoot(w http.ResponseWriter, r *http.Request) {
	target := s.opt.RootRedirect
	if target == "" {
		target = "/admin/"
	}
	w.Header().Set("Cache-Control", "private, max-age=0")
	http.Redirect(w, r, target, http.StatusFound)
}

// Shutdown stops background jobs and waits for them to finish.
func (s *Server) Shutdown(ctx context.Context) {
	s.cancel()
	done := make(chan struct{})
	go func() {
		s.jobs.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
	}
}

// RunMaintenance purges deleted links and expired sessions until ctx ends.
func (s *Server) RunMaintenance(ctx context.Context) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for i := 0; ; i++ {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		now := time.Now()
		if n, err := s.store.PurgeDeleted(ctx, now.Add(-deletedRetention).UnixMilli()); err != nil {
			s.log.Error("purge deleted links", "err", err)
		} else if n > 0 {
			s.log.Debug("purged deleted links", "count", n)
		}
		if i%60 == 0 {
			if err := s.store.PurgeSessions(ctx, now.UnixMilli()); err != nil {
				s.log.Error("purge sessions", "err", err)
			}
		}
		if i%10 == 0 {
			s.sweepFiles(ctx, now)
		}
	}
}

// Deleted links stay restorable this long.
const deletedRetention = time.Hour

func (s *Server) isHTTPS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	if s.opt.TrustProxy {
		if p := r.Header.Get("X-Forwarded-Proto"); p != "" {
			return strings.EqualFold(strings.TrimSpace(strings.Split(p, ",")[0]), "https")
		}
	}
	return false
}

// baseURL returns the public origin short URLs are built from.
func (s *Server) baseURL(r *http.Request) string {
	if s.opt.BaseURL != "" {
		return s.opt.BaseURL
	}
	if b := *s.storedBase.Load(); b != "" {
		return b
	}
	return s.requestOrigin(r)
}

func (s *Server) requestOrigin(r *http.Request) string {
	scheme := "http"
	if s.isHTTPS(r) {
		scheme = "https"
	}
	host := r.Host
	if s.opt.TrustProxy {
		if h := r.Header.Get("X-Forwarded-Host"); h != "" {
			host = strings.TrimSpace(strings.Split(h, ",")[0])
		}
	}
	return scheme + "://" + host
}

func (s *Server) baseSource() string {
	switch {
	case s.opt.BaseURL != "":
		return "env"
	case *s.storedBase.Load() != "":
		return "setting"
	}
	return "request"
}

// clientIP identifies a client for rate limiting.
func (s *Server) clientIP(r *http.Request) string {
	if s.opt.TrustProxy {
		// The rightmost X-Forwarded-For entry is the one the proxy in front
		// of us added; everything left of it came from the client. Only fall
		// back to X-Real-IP, which some proxies pass through unchanged.
		if xff := strings.Join(r.Header.Values("X-Forwarded-For"), ","); xff != "" {
			parts := strings.Split(xff, ",")
			if ip := strings.TrimSpace(parts[len(parts)-1]); ip != "" {
				return ip
			}
		}
		if ip := strings.TrimSpace(r.Header.Get("X-Real-IP")); ip != "" {
			return ip
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
