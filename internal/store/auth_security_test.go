package store

import (
	"context"
	"errors"
	"testing"
)

func TestPasswordReplacementRevokesSessionsAtomically(t *testing.T) {
	ctx := context.Background()
	s := open(t)
	if err := s.CreateSession(ctx, []byte("unset"), "", Session{}); !errors.Is(err, ErrPasswordChanged) {
		t.Fatalf("session without a password: %v", err)
	}
	if err := s.ReplacePassword(ctx, "", "old", nil); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"keep", "revoke"} {
		if err := s.CreateSession(ctx, []byte(key), "old", Session{ExpiresAt: 100}); err != nil {
			t.Fatal(err)
		}
	}
	// Simulate a failed revocation after the password write, then retry.
	if _, err := s.w.ExecContext(ctx, `CREATE TRIGGER fail_revocation BEFORE DELETE ON sessions
		BEGIN SELECT RAISE(ABORT, 'revocation failed'); END`); err != nil {
		t.Fatal(err)
	}
	if err := s.ReplacePassword(ctx, "old", "new", []byte("keep")); err == nil {
		t.Fatal("expected revocation failure")
	}
	if hash, err := s.Setting(ctx, SettingPassword); err != nil || hash != "old" {
		t.Fatalf("password was not rolled back: %q, %v", hash, err)
	}
	if _, err := s.Session(ctx, []byte("revoke")); err != nil {
		t.Fatalf("session was not rolled back: %v", err)
	}
	if _, err := s.w.ExecContext(ctx, `DROP TRIGGER fail_revocation`); err != nil {
		t.Fatal(err)
	}
	if err := s.ReplacePassword(ctx, "old", "new", []byte("keep")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Session(ctx, []byte("keep")); err != nil {
		t.Fatalf("current session lost: %v", err)
	}
	if _, err := s.Session(ctx, []byte("revoke")); !errors.Is(err, ErrNotFound) {
		t.Fatalf("old session survived: %v", err)
	}
	// A login/change that verified the old hash before replacement resumes now.
	if err := s.CreateSession(ctx, []byte("stale"), "old", Session{}); !errors.Is(err, ErrPasswordChanged) {
		t.Fatalf("stale verification issued a session: %v", err)
	}
	if _, err := s.Session(ctx, []byte("stale")); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stale session stored: %v", err)
	}
	if err := s.ReplacePassword(ctx, "old", "stale", nil); !errors.Is(err, ErrPasswordChanged) {
		t.Fatalf("stale password replacement: %v", err)
	}
	if err := s.CreateSession(ctx, []byte("fresh"), "new", Session{}); err != nil {
		t.Fatalf("new password session: %v", err)
	}
	if err := s.ReplacePassword(ctx, "new", "reset", nil); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"keep", "fresh"} {
		if _, err := s.Session(ctx, []byte(key)); !errors.Is(err, ErrNotFound) {
			t.Fatalf("session %q survived reset: %v", key, err)
		}
	}
}
