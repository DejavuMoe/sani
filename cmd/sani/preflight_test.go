package main

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/DejavuMoe/sani/internal/config"
	"github.com/DejavuMoe/sani/internal/store"
)

func TestPreflightChecksFilePermissions(t *testing.T) {
	cfg := &config.Config{DataDir: t.TempDir()}
	path := filepath.Join(cfg.DataDir, "sani.db")
	s, err := store.Open(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	for _, name := range []string{"sani.db", "sani.db-wal", "sani.db-shm"} {
		t.Run(name, func(t *testing.T) {
			file := filepath.Join(cfg.DataDir, name)
			if name != "sani.db" {
				if err := os.WriteFile(file, nil, 0600); err != nil {
					t.Fatal(err)
				}
				defer os.Remove(file)
			}
			if err := os.Chmod(file, 0400); err != nil {
				t.Fatal(err)
			}
			defer os.Chmod(file, 0600)
			if f, err := os.OpenFile(file, os.O_RDWR, 0); err == nil {
				f.Close()
				t.Skip("current user bypasses file permissions")
			}
			if _, err := checkUpgrade(context.Background(), cfg); err == nil || !strings.Contains(err.Error(), "file permissions") || !strings.Contains(err.Error(), name) {
				t.Fatalf("read-only %s accepted: %v", name, err)
			}
		})
	}
}

func TestFailedUpgradeDoesNotAccumulateSafetyCopies(t *testing.T) {
	ctx := context.Background()
	cfg := &config.Config{DataDir: t.TempDir()}
	path := filepath.Join(cfg.DataDir, "sani.db")
	s, err := store.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetSetting(ctx, store.SettingPassword, "unchanged credential"); err != nil {
		t.Fatal(err)
	}
	s.Close()
	db, err := sql.Open("sqlite", filepath.ToSlash(path))
	if err != nil {
		t.Fatal(err)
	}
	// Recreate schema 5; the colliding table fails migration 6 after ADD COLUMN.
	_, err = db.Exec(`DROP INDEX contents_delete_key; ALTER TABLE contents DROP COLUMN delete_key; PRAGMA user_version=5; CREATE TABLE contents_delete_key(value TEXT);`)
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	for range 3 {
		if s, err := openStore(ctx, cfg); err == nil {
			s.Close()
			t.Fatal("expected migration failure")
		}
		if v, err := store.SchemaVersion(ctx, path); err != nil || v != 5 {
			t.Fatalf("schema changed: %d %v", v, err)
		}
		copies, err := filepath.Glob(path + ".pre-*.db")
		if err != nil || len(copies) != 0 {
			t.Fatalf("failed copies accumulated: %v %v", copies, err)
		}
	}
	db, err = sql.Open("sqlite", filepath.ToSlash(path))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`DROP TABLE contents_delete_key`)
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		s, err := openStore(ctx, cfg)
		if err != nil {
			t.Fatal(err)
		}
		credential, err := s.Setting(ctx, store.SettingPassword)
		s.Close()
		if err != nil || credential != "unchanged credential" {
			t.Fatal("credential changed", err)
		}
		copies, err := filepath.Glob(path + ".pre-*.db")
		if err != nil || len(copies) != 1 {
			t.Fatalf("successful safety copy missing or duplicated: %v %v", copies, err)
		}
	}
}
