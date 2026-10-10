package store

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

type PreflightReport struct {
	Schema  int    `json:"schema"`
	Target  int    `json:"target"`
	Files   int    `json:"files"`
	Bytes   int64  `json:"file_bytes"`
	BaseURL string `json:"stored_base_url"`
}

func SchemaVersion(ctx context.Context, path string) (int, error) {
	db, err := openReadOnly(path)
	if err != nil {
		return 0, err
	}
	defer db.Close()
	var version int
	err = db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version)
	if err != nil {
		return 0, fmt.Errorf("read schema version: %w", err)
	}
	if version == 0 {
		var tables int
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'`).Scan(&tables); err != nil {
			return 0, err
		}
		if tables != 0 {
			return 0, fmt.Errorf("schema 0 contains unknown objects; refusing to initialize")
		}
	}
	if version < 0 || version > len(migrations) {
		return 0, fmt.Errorf("unsupported database schema %d; expected 1..%d", version, len(migrations))
	}
	return version, nil
}

func SchemaTarget() int { return len(migrations) }

func openReadOnly(path string) (*sql.DB, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	uriPath := filepath.ToSlash(abs)
	if !strings.HasPrefix(uriPath, "/") {
		uriPath = "/" + uriPath
	}
	u := url.URL{Scheme: "file", Path: uriPath, RawQuery: "mode=ro&_pragma=busy_timeout(1000)"}
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return db, nil
}

// Preflight never opens the migrator. Run on stopped data or an isolated copy;
// file bytes are checked against all references, including soft-deleted rows.
func Preflight(ctx context.Context, path, filesDir string) (*PreflightReport, error) {
	version, err := SchemaVersion(ctx, path)
	if err != nil {
		return nil, err
	}
	db, err := openReadOnly(path)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	var integrity string
	if err := db.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&integrity); err != nil {
		return nil, fmt.Errorf("database integrity: %w", err)
	}
	if integrity != "ok" {
		return nil, fmt.Errorf("database integrity: %s", integrity)
	}
	rows, err := db.QueryContext(ctx, "PRAGMA foreign_key_check")
	if err != nil {
		return nil, fmt.Errorf("foreign key check: %w", err)
	}
	broken := rows.Next()
	err = rows.Err()
	rows.Close()
	if broken || err != nil {
		return nil, fmt.Errorf("database has broken foreign keys: %v", err)
	}
	report := &PreflightReport{Schema: version, Target: len(migrations)}
	if version == 0 {
		return report, nil
	}
	if err := db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, SettingBaseURL).Scan(&report.BaseURL); err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("read stored base URL: %w", err)
	}
	if version >= 2 {
		rows, err := db.QueryContext(ctx, `SELECT link_id, file, size, sha256 FROM contents WHERE file != ''`)
		if err != nil {
			return nil, fmt.Errorf("read file references: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			var id, size int64
			var name string
			var sum []byte
			if err := rows.Scan(&id, &name, &size, &sum); err != nil {
				return nil, err
			}
			if !filepath.IsLocal(name) || filepath.Base(name) != name {
				return nil, fmt.Errorf("file reference for link %d has an unsafe storage name", id)
			}
			file := filepath.Join(filesDir, name)
			info, err := os.Lstat(file)
			if err != nil {
				return nil, fmt.Errorf("file for link %d (%s): %w", id, name, err)
			}
			if !info.Mode().IsRegular() || info.Size() != size {
				return nil, fmt.Errorf("file for link %d (%s): expected a regular file of %d bytes", id, name, size)
			}
			f, err := os.Open(file)
			if err != nil {
				return nil, fmt.Errorf("open file for link %d: %w", id, err)
			}
			h := sha256.New()
			_, err = io.Copy(h, f)
			closeErr := f.Close()
			if err != nil {
				return nil, fmt.Errorf("hash file for link %d: %w", id, err)
			}
			if closeErr != nil {
				return nil, closeErr
			}
			if !bytes.Equal(sum, h.Sum(nil)) {
				return nil, fmt.Errorf("file for link %d (%s): SHA-256 mismatch", id, name)
			}
			report.Files++
			report.Bytes += size
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	return report, nil
}
