package server

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/DejavuMoe/sani/internal/store"
)

func TestStartSessionRejectsReplacedPassword(t *testing.T) {
	e := newEnv(t, Options{})
	e.signIn()
	ctx := context.Background()
	hash, err := e.srv.passwordHash(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if r := e.req("PUT", "/api/password", map[string]string{"current": "correct horse", "password": "battery staple"}); r.status != 204 {
		t.Fatalf("change password: %d %s", r.status, r.body)
	}
	// Resume issuance with the hash captured before the completed change.
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/api/session", nil)
	if err := e.srv.startSession(w, r, hash); !errors.Is(err, store.ErrPasswordChanged) {
		t.Fatalf("stale session issuance: %v", err)
	}
	if len(w.Result().Cookies()) != 0 {
		t.Fatal("stale login received a session cookie")
	}
	if r := e.req("POST", "/api/session", map[string]string{"password": "battery staple"}); r.status != 200 {
		t.Fatalf("new password login: %d %s", r.status, r.body)
	}
}
