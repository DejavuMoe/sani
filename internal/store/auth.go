package store

import (
	"context"
	"database/sql"
	"errors"
)

// Setting keys.
const (
	SettingPassword = "password" // argon2id hash of the admin password
	SettingBaseURL  = "base_url" // public origin used to build short URLs
)

var ErrPasswordChanged = errors.New("password changed")

func (s *Store) Setting(ctx context.Context, key string) (string, error) {
	var v string
	err := s.r.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return v, err
}

func (s *Store) SetSetting(ctx context.Context, key, value string) error {
	_, err := s.w.ExecContext(ctx, `INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

func (s *Store) DeleteSetting(ctx context.Context, key string) error {
	_, err := s.w.ExecContext(ctx, `DELETE FROM settings WHERE key = ?`, key)
	return err
}

// SetPasswordOnce stores the first password. It reports false when a
// password already exists, so two concurrent setups cannot both win.
func (s *Store) SetPasswordOnce(ctx context.Context, hash string) (bool, error) {
	res, err := s.w.ExecContext(ctx, `INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT (key) DO NOTHING`, SettingPassword, hash)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n == 1, err
}

// ReplacePassword atomically replaces the expected password and revokes sessions.
// Checking the old hash also rejects a password change verified before a reset.
func (s *Store) ReplacePassword(ctx context.Context, old, hash string, keep []byte) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `INSERT INTO settings (key, value)
			SELECT ?1, ?2 WHERE coalesce((SELECT value FROM settings WHERE key = ?1), '') = ?3
			ON CONFLICT (key) DO UPDATE SET value = excluded.value`, SettingPassword, hash, old)
		if err != nil {
			return err
		}
		if n, err := res.RowsAffected(); err != nil {
			return err
		} else if n == 0 {
			return ErrPasswordChanged
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM sessions WHERE ?1 IS NULL OR hash != ?1`, keep)
		return err
	})
}

type Session struct {
	CreatedAt int64
	SeenAt    int64
	ExpiresAt int64
	Agent     string
}

func (s *Store) CreateSession(ctx context.Context, hash []byte, password string, sess Session) error {
	// Verification runs outside the write lock; bind issuance to that exact hash.
	res, err := s.w.ExecContext(ctx, `INSERT INTO sessions (hash, created_at, seen_at, expires_at, agent)
		SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM settings WHERE key = ? AND value = ?)`,
		hash, sess.CreatedAt, sess.SeenAt, sess.ExpiresAt, sess.Agent, SettingPassword, password)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err != nil {
		return err
	} else if n == 0 {
		return ErrPasswordChanged
	}
	return nil
}

func (s *Store) Session(ctx context.Context, hash []byte) (Session, error) {
	var sess Session
	err := s.r.QueryRowContext(ctx, `SELECT created_at, seen_at, expires_at, agent FROM sessions WHERE hash = ?`, hash).
		Scan(&sess.CreatedAt, &sess.SeenAt, &sess.ExpiresAt, &sess.Agent)
	if errors.Is(err, sql.ErrNoRows) {
		return sess, ErrNotFound
	}
	return sess, err
}

func (s *Store) TouchSession(ctx context.Context, hash []byte, seen, expires int64) error {
	_, err := s.w.ExecContext(ctx, `UPDATE sessions SET seen_at = ?, expires_at = ? WHERE hash = ?`, seen, expires, hash)
	return err
}

func (s *Store) DeleteSession(ctx context.Context, hash []byte) error {
	_, err := s.w.ExecContext(ctx, `DELETE FROM sessions WHERE hash = ?`, hash)
	return err
}

// DeleteSessions signs out every device, optionally keeping one session.
func (s *Store) DeleteSessions(ctx context.Context, keep []byte) error {
	_, err := s.w.ExecContext(ctx, `DELETE FROM sessions WHERE hash != ?`, keep)
	return err
}

func (s *Store) PurgeSessions(ctx context.Context, now int64) error {
	_, err := s.w.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at < ?`, now)
	return err
}

type Token struct {
	ID        int64
	Name      string
	Hint      string // first characters of the secret, for recognition
	CreatedAt int64
	UsedAt    int64
}

func (s *Store) CreateToken(ctx context.Context, name string, hash []byte, hint string, now int64) (*Token, error) {
	res, err := s.w.ExecContext(ctx, `INSERT INTO tokens (name, hash, hint, created_at) VALUES (?, ?, ?, ?)`,
		name, hash, hint, now)
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return &Token{ID: id, Name: name, Hint: hint, CreatedAt: now}, nil
}

func (s *Store) Tokens(ctx context.Context) ([]*Token, error) {
	rows, err := s.r.QueryContext(ctx, `SELECT id, name, hint, created_at, used_at FROM tokens ORDER BY id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Token{}
	for rows.Next() {
		var t Token
		if err := rows.Scan(&t.ID, &t.Name, &t.Hint, &t.CreatedAt, &t.UsedAt); err != nil {
			return nil, err
		}
		out = append(out, &t)
	}
	return out, rows.Err()
}

func (s *Store) TokenByHash(ctx context.Context, hash []byte) (*Token, error) {
	var t Token
	err := s.r.QueryRowContext(ctx, `SELECT id, name, hint, created_at, used_at FROM tokens WHERE hash = ?`, hash).
		Scan(&t.ID, &t.Name, &t.Hint, &t.CreatedAt, &t.UsedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *Store) TouchToken(ctx context.Context, id, now int64) error {
	_, err := s.w.ExecContext(ctx, `UPDATE tokens SET used_at = ? WHERE id = ?`, now, id)
	return err
}

func (s *Store) DeleteToken(ctx context.Context, id int64) error {
	res, err := s.w.ExecContext(ctx, `DELETE FROM tokens WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

type Favicon struct {
	Type      string // "" records a failed fetch
	Data      []byte
	FetchedAt int64
}

func (s *Store) Favicon(ctx context.Context, host string) (*Favicon, error) {
	var f Favicon
	err := s.r.QueryRowContext(ctx, `SELECT type, data, fetched_at FROM favicons WHERE host = ?`, host).
		Scan(&f.Type, &f.Data, &f.FetchedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &f, nil
}

// FaviconFetchedAt returns when a host's icon was last fetched, or 0.
func (s *Store) FaviconFetchedAt(ctx context.Context, host string) (int64, error) {
	var at int64
	err := s.r.QueryRowContext(ctx, `SELECT fetched_at FROM favicons WHERE host = ?`, host).Scan(&at)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return at, err
}

func (s *Store) PutFavicon(ctx context.Context, host string, f *Favicon) error {
	_, err := s.w.ExecContext(ctx, `INSERT INTO favicons (host, type, data, fetched_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (host) DO UPDATE SET type = excluded.type, data = excluded.data, fetched_at = excluded.fetched_at`,
		host, f.Type, f.Data, f.FetchedAt)
	return err
}
