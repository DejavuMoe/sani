package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/DejavuMoe/sani/internal/auth"
	"github.com/DejavuMoe/sani/internal/store"
)

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	a := s.requireAuth

	mux.HandleFunc("GET /api/session", s.getSession)
	mux.HandleFunc("POST /api/session", s.login)
	mux.HandleFunc("DELETE /api/session", s.logout)
	mux.HandleFunc("POST /api/setup", s.setup)
	mux.Handle("PUT /api/password", a(s.changePassword))
	mux.Handle("POST /api/sessions/revoke", a(s.revokeOtherSessions))

	mux.Handle("GET /api/config", a(s.getConfig))
	mux.Handle("PATCH /api/config", a(s.patchConfig))
	mux.Handle("GET /api/overview", a(s.overview))

	mux.Handle("GET /api/links", a(s.listLinks))
	mux.Handle("POST /api/links", a(s.createLink))
	mux.Handle("GET /api/links/{id}", a(s.getLink))
	mux.Handle("PATCH /api/links/{id}", a(s.updateLink))
	mux.Handle("DELETE /api/links/{id}", a(s.deleteLink))
	mux.Handle("POST /api/links/{id}/restore", a(s.restoreLink))
	mux.Handle("POST /api/links/{id}/refresh", a(s.refreshLink))
	mux.Handle("GET /api/links/{id}/stats", a(s.linkStats))
	mux.Handle("GET /api/slugs/{slug}", a(s.checkSlug))

	mux.Handle("GET /api/tokens", a(s.listTokens))
	mux.Handle("POST /api/tokens", a(s.createToken))
	mux.Handle("DELETE /api/tokens/{id}", a(s.deleteToken))

	mux.Handle("GET /api/export", a(s.export))
	mux.Handle("POST /api/import", a(s.importLinks))
	mux.Handle("GET /api/favicons/{host}", a(s.favicon))

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "not_found", "no such endpoint")
	})

	// Cookie-authenticated browsers must not be driven from other origins.
	// Token clients send no Sec-Fetch-Site or Origin and pass through.
	cop := http.NewCrossOriginProtection()
	cop.SetDenyHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusForbidden, "cross_origin", "cross-origin request refused")
	}))
	return cop.Handler(mux)
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	enc.Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]apiError{"error": {Code: code, Message: msg}})
}

func (s *Server) internalError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, context.Canceled) {
		return
	}
	s.log.Error("request failed", "method", r.Method, "path", r.URL.Path, "err", err)
	writeError(w, http.StatusInternalServerError, "internal", "internal error")
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "request body must be a JSON object")
		return false
	}
	return true
}

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "not_found", "no such link")
		return 0, false
	}
	return id, true
}

// nullable distinguishes an absent JSON field from an explicit null.
type nullable[T any] struct {
	Set   bool
	Null  bool
	Value T
}

func (n *nullable[T]) UnmarshalJSON(b []byte) error {
	n.Set = true
	if string(b) == "null" {
		n.Null = true
		return nil
	}
	return json.Unmarshal(b, &n.Value)
}

func msTime(ms int64) *time.Time {
	if ms == 0 {
		return nil
	}
	t := time.UnixMilli(ms).UTC()
	return &t
}

const (
	sessionCookie = "sani_session"
	sessionTTL    = 30 * 24 * time.Hour
	tokenPrefix   = "sani_"
)

type authKey struct{}

type principal struct {
	session []byte // hash of the session secret, for cookie logins
	token   *store.Token
}

// requireAuth admits requests with a valid session cookie or API token.
func (s *Server) requireAuth(h http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, ok := s.authenticate(w, r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized", "sign in or provide an API token")
			return
		}
		h(w, r.WithContext(context.WithValue(r.Context(), authKey{}, p)))
	})
}

func (s *Server) authenticate(w http.ResponseWriter, r *http.Request) (*principal, bool) {
	ctx := r.Context()
	now := time.Now()
	if secret := apiToken(r); secret != "" {
		t, err := s.store.TokenByHash(ctx, auth.HashSecret(secret))
		if err != nil {
			return nil, false
		}
		if now.UnixMilli()-t.UsedAt > time.Minute.Milliseconds() {
			if err := s.store.TouchToken(ctx, t.ID, now.UnixMilli()); err != nil {
				s.log.Warn("touch token", "err", err)
			}
		}
		return &principal{token: t}, true
	}
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		return nil, false
	}
	hash := auth.HashSecret(c.Value)
	sess, err := s.store.Session(ctx, hash)
	if err != nil || sess.ExpiresAt <= now.UnixMilli() {
		return nil, false
	}
	// Slide the expiry forward at most once a day.
	if now.UnixMilli()-sess.SeenAt > (24 * time.Hour).Milliseconds() {
		if err := s.store.TouchSession(ctx, hash, now.UnixMilli(), now.Add(sessionTTL).UnixMilli()); err == nil && w != nil {
			s.setSessionCookie(w, r, c.Value, sessionTTL)
		}
	}
	return &principal{session: hash}, true
}

func apiToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); len(h) > 7 && strings.EqualFold(h[:7], "bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return strings.TrimSpace(r.Header.Get("X-Api-Key"))
}

func (s *Server) setSessionCookie(w http.ResponseWriter, r *http.Request, value string, ttl time.Duration) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    value,
		Path:     "/api/",
		MaxAge:   int(ttl.Seconds()),
		HttpOnly: true,
		Secure:   s.isHTTPS(r),
		SameSite: http.SameSiteStrictMode,
	})
}

func principalOf(r *http.Request) *principal {
	p, _ := r.Context().Value(authKey{}).(*principal)
	return p
}
