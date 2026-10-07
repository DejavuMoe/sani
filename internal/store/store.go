// Package store persists links, click aggregates and credentials in SQLite.
//
// Writes go through a single connection so SQLite never has to arbitrate
// between writers; reads use a separate pool and WAL permits them alongside
// normal writes. Pool contention and external database locks can still wait.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"runtime"
	"strings"

	_ "modernc.org/sqlite"
)

var (
	ErrNotFound  = errors.New("not found")
	ErrSlugTaken = errors.New("slug is already taken")
)

type Store struct {
	w *sql.DB
	r *sql.DB
}

func dsn(path string, writer bool) string {
	q := url.Values{}
	for _, p := range []string{
		// SQLite's busy handler can outlive a canceled Go context. Keep
		// each external-lock wait below the five-second flush budget.
		"busy_timeout(1000)",
		"journal_mode(WAL)",
		"synchronous(NORMAL)",
		"foreign_keys(1)",
		"temp_store(MEMORY)",
		"cache_size(-16000)",
	} {
		q.Add("_pragma", p)
	}
	if writer {
		q.Set("_txlock", "immediate")
	}
	return "file:" + strings.ReplaceAll(path, "?", "%3F") + "?" + q.Encode()
}

// Open opens (creating if needed) the database at path and migrates it.
func Open(ctx context.Context, path string) (*Store, error) {
	w, err := sql.Open("sqlite", dsn(path, true))
	if err != nil {
		return nil, err
	}
	w.SetMaxOpenConns(1)
	w.SetMaxIdleConns(1)
	w.SetConnMaxLifetime(0)
	if err := w.PingContext(ctx); err != nil {
		w.Close()
		return nil, fmt.Errorf("open database: %w", err)
	}
	if err := migrate(ctx, w); err != nil {
		w.Close()
		return nil, err
	}

	r, err := sql.Open("sqlite", dsn(path, false))
	if err != nil {
		w.Close()
		return nil, err
	}
	n := max(4, runtime.GOMAXPROCS(0))
	r.SetMaxOpenConns(n)
	r.SetMaxIdleConns(n)
	r.SetConnMaxLifetime(0)
	return &Store{w: w, r: r}, nil
}

func (s *Store) Close() error {
	return errors.Join(s.r.Close(), s.w.Close())
}

// PoolStats exposes standard database/sql counters for local capacity tests.
func (s *Store) PoolStats() (read, write sql.DBStats) { return s.r.Stats(), s.w.Stats() }

// Backup writes a consistent, compacted copy of the database at path to
// dst. It opens its own connection and never migrates, so it is safe while a
// server (even an older one) is using the database.
func Backup(ctx context.Context, path, dst string) error {
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("no database at %s", path)
	}
	if _, err := os.Stat(dst); err == nil {
		return fmt.Errorf("%s already exists", dst)
	}
	db, err := sql.Open("sqlite", dsn(path, false))
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	_, err = db.ExecContext(ctx, "VACUUM INTO ?", dst)
	return err
}

var migrations = []string{
	// 1: initial schema. Timestamps are unix milliseconds; 0 means "none".
	`CREATE TABLE links (
		id            INTEGER PRIMARY KEY,
		slug          TEXT    NOT NULL,
		slug_key      TEXT    NOT NULL UNIQUE,
		url           TEXT    NOT NULL,
		host          TEXT    NOT NULL DEFAULT '',
		title         TEXT    NOT NULL DEFAULT '',
		meta          INTEGER NOT NULL DEFAULT 0,
		redirect      INTEGER NOT NULL DEFAULT 302,
		enabled       INTEGER NOT NULL DEFAULT 1,
		expires_at    INTEGER NOT NULL DEFAULT 0,
		max_clicks    INTEGER NOT NULL DEFAULT 0,
		clicks        INTEGER NOT NULL DEFAULT 0,
		last_click_at INTEGER NOT NULL DEFAULT 0,
		created_at    INTEGER NOT NULL,
		updated_at    INTEGER NOT NULL,
		deleted_at    INTEGER NOT NULL DEFAULT 0
	);
	CREATE INDEX links_by_created ON links (created_at DESC, id DESC) WHERE deleted_at = 0;
	CREATE INDEX links_by_clicks  ON links (clicks DESC, id DESC) WHERE deleted_at = 0;
	CREATE INDEX links_by_visited ON links (last_click_at DESC, id DESC) WHERE deleted_at = 0;
	CREATE INDEX links_deleted    ON links (deleted_at) WHERE deleted_at != 0;

	CREATE TABLE clicks_daily (
		link_id INTEGER NOT NULL REFERENCES links (id) ON DELETE CASCADE,
		day     INTEGER NOT NULL,
		count   INTEGER NOT NULL,
		PRIMARY KEY (link_id, day)
	) WITHOUT ROWID;
	CREATE INDEX clicks_daily_by_day ON clicks_daily (day);

	CREATE TABLE referrers (
		link_id INTEGER NOT NULL REFERENCES links (id) ON DELETE CASCADE,
		host    TEXT    NOT NULL,
		count   INTEGER NOT NULL,
		PRIMARY KEY (link_id, host)
	) WITHOUT ROWID;

	CREATE TABLE settings (
		key   TEXT PRIMARY KEY,
		value TEXT NOT NULL
	) WITHOUT ROWID;

	CREATE TABLE sessions (
		hash       BLOB    PRIMARY KEY,
		created_at INTEGER NOT NULL,
		seen_at    INTEGER NOT NULL,
		expires_at INTEGER NOT NULL,
		agent      TEXT    NOT NULL DEFAULT ''
	) WITHOUT ROWID;

	CREATE TABLE tokens (
		id         INTEGER PRIMARY KEY,
		name       TEXT    NOT NULL,
		hash       BLOB    NOT NULL UNIQUE,
		hint       TEXT    NOT NULL,
		created_at INTEGER NOT NULL,
		used_at    INTEGER NOT NULL DEFAULT 0
	);

	CREATE TABLE favicons (
		host       TEXT    PRIMARY KEY,
		type       TEXT    NOT NULL,
		data       BLOB    NOT NULL,
		fetched_at INTEGER NOT NULL
	) WITHOUT ROWID;`,

	// 2: links that share text or a file instead of redirecting. The body
	// comes last so reading the other columns never touches its pages.
	`ALTER TABLE links ADD COLUMN kind INTEGER NOT NULL DEFAULT 0;

	CREATE TABLE contents (
		link_id INTEGER PRIMARY KEY REFERENCES links (id) ON DELETE CASCADE,
		format  INTEGER NOT NULL DEFAULT 0,
		name    TEXT    NOT NULL DEFAULT '',
		type    TEXT    NOT NULL DEFAULT '',
		size    INTEGER NOT NULL,
		lines   INTEGER NOT NULL DEFAULT 0,
		sha256  BLOB,
		file    TEXT    NOT NULL DEFAULT '',
		body    TEXT
	);`,

	// 3: a reclaimed/purged row must never inherit clicks still queued for
	// its old ID. Rebuild with foreign keys disabled by migrate; child rows
	// and their references to links are preserved and checked before commit.
	`CREATE TABLE links_new (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		slug TEXT NOT NULL,
		slug_key TEXT NOT NULL UNIQUE,
		url TEXT NOT NULL,
		host TEXT NOT NULL DEFAULT '',
		title TEXT NOT NULL DEFAULT '',
		meta INTEGER NOT NULL DEFAULT 0,
		redirect INTEGER NOT NULL DEFAULT 302,
		enabled INTEGER NOT NULL DEFAULT 1,
		expires_at INTEGER NOT NULL DEFAULT 0,
		max_clicks INTEGER NOT NULL DEFAULT 0,
		clicks INTEGER NOT NULL DEFAULT 0,
		last_click_at INTEGER NOT NULL DEFAULT 0,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		deleted_at INTEGER NOT NULL DEFAULT 0,
		kind INTEGER NOT NULL DEFAULT 0
	);
	INSERT INTO links_new SELECT * FROM links;
	DROP TABLE links;
	ALTER TABLE links_new RENAME TO links;
	CREATE INDEX links_by_created ON links (created_at DESC, id DESC) WHERE deleted_at = 0;
	CREATE INDEX links_by_clicks ON links (clicks DESC, id DESC) WHERE deleted_at = 0;
	CREATE INDEX links_by_visited ON links (last_click_at DESC, id DESC) WHERE deleted_at = 0;
	CREATE INDEX links_deleted ON links (deleted_at) WHERE deleted_at != 0;`,

	// 4: private administrator tags. Existing links remain untagged.
	`CREATE TABLE tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		name_key TEXT NOT NULL UNIQUE,
		color TEXT NOT NULL CHECK (color IN ('blue', 'green', 'amber', 'rose', 'neutral'))
	);
	CREATE TABLE link_tags (
		link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
		tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
		position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 4),
		PRIMARY KEY (link_id, tag_id),
		UNIQUE (link_id, position)
	) WITHOUT ROWID;
	CREATE INDEX link_tags_by_tag ON link_tags (tag_id, link_id);`,
}

func migrate(ctx context.Context, db *sql.DB) (result error) {
	var version int
	if err := db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}
	if version > len(migrations) {
		return fmt.Errorf("database schema version %d is newer than this build supports (%d)", version, len(migrations))
	}
	// The writer pool has exactly one connection. SQLite requires this
	// outside the transaction when rebuilding a referenced parent table.
	if _, err := db.ExecContext(ctx, "PRAGMA foreign_keys = OFF"); err != nil {
		return err
	}
	defer func() {
		_, err := db.ExecContext(context.Background(), "PRAGMA foreign_keys = ON")
		result = errors.Join(result, err)
	}()
	for i := version; i < len(migrations); i++ {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, migrations[i]); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %d: %w", i+1, err)
		}
		rows, err := tx.QueryContext(ctx, "PRAGMA foreign_key_check")
		if err != nil {
			tx.Rollback()
			return err
		}
		broken := rows.Next()
		err = rows.Err()
		rows.Close()
		if broken || err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %d: foreign key check failed: %v", i+1, err)
		}
		if _, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", i+1)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

// tx runs fn inside a write transaction.
func (s *Store) tx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := s.w.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}
