package server

import (
	"context"
	"crypto/subtle"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/DejavuMoe/sani/internal/auth"
	"github.com/DejavuMoe/sani/internal/store"
)

func (s *Server) passwordHash(ctx context.Context) (string, error) {
	h, err := s.store.Setting(ctx, store.SettingPassword)
	if errors.Is(err, store.ErrNotFound) {
		return "", nil
	}
	return h, err
}

func (s *Server) getSession(w http.ResponseWriter, r *http.Request) {
	hash, err := s.passwordHash(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	_, authed := s.authenticate(w, r)
	writeJSON(w, http.StatusOK, map[string]bool{
		"authenticated": authed,
		"needsSetup":    hash == "",
	})
}

type passwordInput struct {
	Password string `json:"password"`
	Current  string `json:"current"`
	Code     string `json:"code"`
}

// normalizeCode ignores case, spaces and dashes in a typed setup code.
func normalizeCode(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '-' || r == ' ' || r == '\t' {
			return -1
		}
		return unicode.ToLower(r)
	}, s)
}

func (s *Server) setupCodeOK(code string) bool {
	want := normalizeCode(s.opt.SetupCode)
	return want != "" && subtle.ConstantTimeCompare([]byte(normalizeCode(code)), []byte(want)) == 1
}

// rateLimited answers 429 when ip has failed too often recently.
func (s *Server) rateLimited(w http.ResponseWriter, ip string, now time.Time) bool {
	blocked, wait := s.logins.Blocked(ip, now)
	if !blocked {
		return false
	}
	secs := int(math.Ceil(wait.Seconds()))
	w.Header().Set("Retry-After", strconv.Itoa(secs))
	writeJSON(w, http.StatusTooManyRequests, map[string]any{
		"error": apiError{Code: "rate_limited", Message: "too many attempts"}, "retryAfter": secs,
	})
	return true
}

func validPassword(w http.ResponseWriter, pw string) bool {
	if utf8.RuneCountInString(pw) < auth.MinPasswordLength {
		writeError(w, http.StatusBadRequest, "password_short", "password must be at least 8 characters")
		return false
	}
	if len(pw) > 1024 {
		writeError(w, http.StatusBadRequest, "password_long", "password is too long")
		return false
	}
	return true
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request) error {
	secret, hash := auth.NewSecret("")
	now := time.Now()
	agent := r.UserAgent()
	if len(agent) > 256 {
		agent = agent[:256]
	}
	err := s.store.CreateSession(r.Context(), hash, store.Session{
		CreatedAt: now.UnixMilli(),
		SeenAt:    now.UnixMilli(),
		ExpiresAt: now.Add(sessionTTL).UnixMilli(),
		Agent:     agent,
	})
	if err != nil {
		return err
	}
	s.setSessionCookie(w, r, secret, sessionTTL)
	return nil
}

// setup stores the first password. It works exactly once, and only with
// the setup code from the server log.
func (s *Server) setup(w http.ResponseWriter, r *http.Request) {
	ip := s.clientIP(r)
	now := time.Now()
	if s.rateLimited(w, ip, now) {
		return
	}
	var in passwordInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if hash, err := s.passwordHash(r.Context()); err != nil {
		s.internalError(w, r, err)
		return
	} else if hash != "" {
		writeError(w, http.StatusConflict, "already_setup", "a password is already set")
		return
	}
	if !s.setupCodeOK(in.Code) {
		s.logins.Fail(ip, now)
		s.log.Warn("wrong setup code", "ip", ip)
		writeError(w, http.StatusForbidden, "setup_code", "wrong setup code")
		return
	}
	if !validPassword(w, in.Password) {
		return
	}
	ok, err := s.store.SetPasswordOnce(r.Context(), auth.HashPassword(in.Password))
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if !ok {
		writeError(w, http.StatusConflict, "already_setup", "a password is already set")
		return
	}
	s.log.Info("admin password created")
	s.logins.Reset(ip)
	if err := s.startSession(w, r); err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"authenticated": true})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	ip := s.clientIP(r)
	now := time.Now()
	if s.rateLimited(w, ip, now) {
		return
	}
	var in passwordInput
	if !decodeJSON(w, r, &in) {
		return
	}
	hash, err := s.passwordHash(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if hash == "" {
		writeError(w, http.StatusConflict, "needs_setup", "no password has been set yet")
		return
	}
	if len(in.Password) > 1024 || !auth.VerifyPassword(in.Password, hash) {
		s.logins.Fail(ip, now)
		s.log.Warn("failed sign-in", "ip", ip)
		writeError(w, http.StatusUnauthorized, "wrong_password", "wrong password")
		return
	}
	s.logins.Reset(ip)
	if err := s.startSession(w, r); err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"authenticated": true})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
		if err := s.store.DeleteSession(r.Context(), auth.HashSecret(c.Value)); err != nil {
			s.internalError(w, r, err)
			return
		}
	}
	s.setSessionCookie(w, r, "", -time.Second)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	if s.opt.PasswordFromEnv {
		writeError(w, http.StatusConflict, "password_env", "the password is managed by SANI_PASSWORD")
		return
	}
	var in passwordInput
	if !decodeJSON(w, r, &in) || !validPassword(w, in.Password) {
		return
	}
	hash, err := s.passwordHash(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if !auth.VerifyPassword(in.Current, hash) {
		writeError(w, http.StatusBadRequest, "wrong_password", "current password is wrong")
		return
	}
	if err := s.store.SetSetting(r.Context(), store.SettingPassword, auth.HashPassword(in.Password)); err != nil {
		s.internalError(w, r, err)
		return
	}
	// Everyone else has to sign in with the new password.
	keep := principalOf(r).session
	if keep == nil {
		keep = []byte{}
	}
	if err := s.store.DeleteSessions(r.Context(), keep); err != nil {
		s.internalError(w, r, err)
		return
	}
	s.log.Info("admin password changed")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) revokeOtherSessions(w http.ResponseWriter, r *http.Request) {
	keep := principalOf(r).session
	if keep == nil {
		keep = []byte{}
	}
	if err := s.store.DeleteSessions(r.Context(), keep); err != nil {
		s.internalError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
