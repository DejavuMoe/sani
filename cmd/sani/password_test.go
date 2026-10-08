package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/DejavuMoe/sani/internal/auth"
	"github.com/DejavuMoe/sani/internal/store"
)

func TestPasswordInputsRejectOversizeWithoutChangingCredentials(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	t.Setenv("SANI_DATA_DIR", dir)
	t.Setenv("SANI_PASSWORD", "")
	st, err := store.Open(ctx, filepath.Join(dir, "sani.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := syncEnvPassword(ctx, st, "old password"); err != nil {
		t.Fatal(err)
	}
	hash, err := st.Setting(ctx, store.SettingPassword)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.CreateSession(ctx, []byte("session"), hash, store.Session{}); err != nil {
		t.Fatal(err)
	}
	stdin := os.Stdin
	t.Cleanup(func() { os.Stdin = stdin })
	for _, password := range []string{strings.Repeat("x", 1025), strings.Repeat("界", 342)} {
		if err := syncEnvPassword(ctx, st, password); !errors.Is(err, auth.ErrPasswordLong) {
			t.Fatalf("environment password: %v", err)
		}
		path := filepath.Join(t.TempDir(), "password.txt")
		if err := os.WriteFile(path, []byte(password+"\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		input, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		os.Stdin = input
		err = passwd()
		input.Close()
		if !errors.Is(err, auth.ErrPasswordLong) {
			t.Fatalf("CLI password: %v", err)
		}
		if got, err := st.Setting(ctx, store.SettingPassword); err != nil || got != hash {
			t.Fatalf("rejected password changed credentials: %v", err)
		}
		if _, err := st.Session(ctx, []byte("session")); err != nil {
			t.Fatalf("rejected password revoked session: %v", err)
		}
	}
	for _, password := range []string{strings.Repeat("x", 1024), strings.Repeat("界", 341) + "x"} {
		if err := syncEnvPassword(ctx, st, password); err != nil {
			t.Fatalf("valid maximum password: %v", err)
		}
		path := filepath.Join(t.TempDir(), "password.txt")
		if err := os.WriteFile(path, []byte(password+"\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		input, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		os.Stdin = input
		err = passwd()
		input.Close()
		if err != nil {
			t.Fatalf("valid maximum CLI password: %v", err)
		}
		hash, err = st.Setting(ctx, store.SettingPassword)
		if err != nil || !auth.VerifyPassword(password, hash) {
			t.Fatalf("maximum password cannot sign in: %v", err)
		}
	}
}

func TestSyncEnvPasswordRevokesOnlyOnReplacement(t *testing.T) {
	ctx := context.Background()
	st, err := store.Open(ctx, filepath.Join(t.TempDir(), "sani.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := syncEnvPassword(ctx, st, "old password"); err != nil {
		t.Fatal(err)
	}
	hash, err := st.Setting(ctx, store.SettingPassword)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.CreateSession(ctx, []byte("old-session"), hash, store.Session{}); err != nil {
		t.Fatal(err)
	}
	if err := syncEnvPassword(ctx, st, "old password"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Session(ctx, []byte("old-session")); err != nil {
		t.Fatalf("unchanged environment signed out session: %v", err)
	}
	for range 2 {
		if err := syncEnvPassword(ctx, st, "new password"); err != nil {
			t.Fatal(err)
		}
		if _, err := st.Session(ctx, []byte("old-session")); !errors.Is(err, store.ErrNotFound) {
			t.Fatalf("old session survived replacement/restart: %v", err)
		}
	}
}
