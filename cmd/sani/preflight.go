package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/DejavuMoe/sani/internal/config"
	"github.com/DejavuMoe/sani/internal/store"
)

func preflight() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	report, err := checkUpgrade(context.Background(), cfg)
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(report)
}

func checkUpgrade(ctx context.Context, cfg *config.Config) (*store.PreflightReport, error) {
	// Directory access does not imply that an existing database or WAL is writable.
	for _, name := range []string{"sani.db", "sani.db-wal", "sani.db-shm"} {
		path := filepath.Join(cfg.DataDir, name)
		f, err := os.OpenFile(path, os.O_RDWR, 0)
		if name != "sani.db" && errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("preflight file permissions (%s): %w", path, err)
		}
		if err := f.Close(); err != nil {
			return nil, fmt.Errorf("preflight close (%s): %w", path, err)
		}
	}
	report, err := store.Preflight(ctx, filepath.Join(cfg.DataDir, "sani.db"), filepath.Join(cfg.DataDir, "files"))
	if err != nil {
		return nil, fmt.Errorf("upgrade preflight: %w", err)
	}
	// Small probes find directory permission errors, not a guarantee of free
	// space. VACUUM and the migration still report disk-full errors atomically.
	dirs := []string{cfg.DataDir}
	if info, err := os.Stat(filepath.Join(cfg.DataDir, "files")); err == nil && info.IsDir() {
		dirs = append(dirs, filepath.Join(cfg.DataDir, "files"))
	}
	for _, dir := range dirs {
		f, err := os.CreateTemp(dir, ".sani-preflight-*")
		if err != nil {
			return nil, fmt.Errorf("preflight directory permissions (%s): %w", dir, err)
		}
		name := f.Name()
		_, writeErr := f.Write([]byte("preflight"))
		closeErr := f.Close()
		removeErr := os.Remove(name)
		for _, err := range []error{writeErr, closeErr, removeErr} {
			if err != nil {
				return nil, fmt.Errorf("preflight directory probe (%s): %w", dir, err)
			}
		}
	}
	return report, nil
}

func prepareUpgrade(ctx context.Context, cfg *config.Config, path string, version int) (string, error) {
	if version == store.SchemaTarget() {
		return "", nil
	}
	if _, err := checkUpgrade(ctx, cfg); err != nil {
		return "", err
	}
	backup := fmt.Sprintf("%s.pre-v%d-to-v%d-%d.db", path, version, store.SchemaTarget(), time.Now().UnixNano())
	if err := store.Backup(ctx, path, backup); err != nil {
		return "", fmt.Errorf("pre-migration database snapshot: %w", err)
	}
	fmt.Fprintf(os.Stderr, "sani: migrating schema %d to %d; database safety copy: %s (full pre-upgrade snapshot required for rollback)\n", version, store.SchemaTarget(), backup)
	return backup, nil
}
