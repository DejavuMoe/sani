package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/DejavuMoe/sani/internal/auth"
	"github.com/DejavuMoe/sani/internal/store"
)

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/api/v1/", s.publicRoutes())
	a := s.requireAuth

	mux.HandleFunc("GET /api/admin/v1/session", s.getSession)
	mux.HandleFunc("POST /api/admin/v1/session", s.login)
	mux.HandleFunc("DELETE /api/admin/v1/session", s.logout)
	mux.HandleFunc("POST /api/admin/v1/setup", s.setup)
	mux.Handle("PUT /api/admin/v1/password", a(s.changePassword))
	mux.Handle("POST /api/admin/v1/sessions/revoke", a(s.revokeOtherSessions))

	mux.Handle("GET /api/admin/v1/config", a(s.getConfig))
	mux.Handle("PATCH /api/admin/v1/config", a(s.patchConfig))
	mux.Handle("POST /api/admin/v1/config/metadata/test", a(s.testMetadataProxy))
	mux.Handle("GET /api/admin/v1/overview", a(s.overview))
	mux.Handle("GET /api/admin/v1/tags", a(s.listTags))
	mux.Handle("POST /api/admin/v1/tags", a(s.createTag))
	mux.Handle("PATCH /api/admin/v1/tags/{id}", a(s.updateTag))
	mux.Handle("DELETE /api/admin/v1/tags/{id}", a(s.deleteTag))

	mux.Handle("GET /api/admin/v1/links", a(s.listLinks))
	mux.Handle("POST /api/admin/v1/links", a(s.createLink))
	mux.Handle("POST /api/admin/v1/links/bulk", a(s.bulkLinks))
	mux.Handle("GET /api/admin/v1/links/{id}", a(s.getLink))
	mux.Handle("PATCH /api/admin/v1/links/{id}", a(s.updateLink))
	mux.Handle("DELETE /api/admin/v1/links/{id}", a(s.deleteLink))
	mux.Handle("POST /api/admin/v1/links/{id}/restore", a(s.restoreLink))
	mux.Handle("POST /api/admin/v1/links/{id}/refresh", a(s.refreshLink))
	mux.Handle("GET /api/admin/v1/links/{id}/stats", a(s.linkStats))
	mux.Handle("GET /api/admin/v1/links/{id}/text", a(s.linkText))
	mux.Handle("POST /api/admin/v1/texts", a(s.createText))
	mux.Handle("POST /api/admin/v1/files", a(s.createFile))
	mux.Handle("POST /api/admin/v1/uploads", a(s.beginUpload))
	mux.Handle("PUT /api/admin/v1/uploads/{id}", a(s.uploadChunk))
	mux.Handle("POST /api/admin/v1/uploads/{id}/complete", a(s.completeUpload))
	mux.Handle("DELETE /api/admin/v1/uploads/{id}", a(s.cancelUpload))
	mux.Handle("GET /api/admin/v1/slugs/{slug}", a(s.checkSlug))

	mux.Handle("GET /api/admin/v1/tokens", a(s.listTokens))
	mux.Handle("POST /api/admin/v1/tokens", a(s.createToken))
	mux.Handle("DELETE /api/admin/v1/tokens/{id}", a(s.deleteToken))

	mux.Handle("GET /api/admin/v1/export", a(s.export))
	mux.Handle("POST /api/admin/v1/import", a(s.importLinks))
	mux.Handle("GET /api/admin/v1/favicons/{host}", a(s.favicon))

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "not_found", "no such endpoint")
	})

	// Cookie-authenticated browsers must not be driven from other origins.
	// Token clients send no Sec-Fetch-Site or Origin and pass through.
	cop := http.NewCrossOriginProtection()
	cop.SetDenyHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/v1/") {
			publicError(w, r, &inputError{http.StatusForbidden, "cross_origin", "cross-origin request refused"})
			return
		}
		writeError(w, http.StatusForbidden, "cross_origin", "cross-origin request refused")
	}))
	return cop.Handler(mux)
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	var body bytes.Buffer
	if err := json.NewEncoder(&body).Encode(v); err != nil {
		// Nothing has been committed yet: a failed DTO must not look like
		// an empty successful response (or a downloadable export).
		status = http.StatusInternalServerError
		body.Reset()
		body.WriteString("{\"error\":{\"code\":\"internal\",\"message\":\"internal error\"}}\n")
		w.Header().Del("Content-Disposition")
	}
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	w.Write(body.Bytes())
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
	return decodeJSONMax(w, r, v, 1<<20)
}

// maxTextBody leaves room for a text at its limit even when JSON escapes
// many of its characters.
const maxTextBody = 8 << 20

func decodeJSONMax(w http.ResponseWriter, r *http.Request, v any, limit int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	err := d.Decode(v)
	if err == nil {
		_, err = d.Token()
		if errors.Is(err, io.EOF) {
			return true
		}
	}
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, "too_large", "the request body is too large")
			return false
		}
	}
	writeError(w, http.StatusBadRequest, "bad_json", "send one JSON object with supported fields")
	return false
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

// timestampMillis checks the UTC representation used by every JSON DTO
// before UnixMilli can turn an out-of-range time into stored data.
func timestampMillis(t time.Time) (int64, bool) {
	t = t.UTC()
	if t.Year() < 0 || t.Year() > 9999 {
		return 0, false
	}
	return t.UnixMilli(), true
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
