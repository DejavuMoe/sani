package store

import (
	"context"
	"database/sql"

	"github.com/DejavuMoe/sani/internal/links"
)

func (s *Store) LinkBySlug(ctx context.Context, key string) (*Link, error) {
	return scanLink(s.r.QueryRowContext(ctx, `SELECT `+linkCols+` FROM `+linkFrom+` WHERE l.slug_key = ? AND l.deleted_at = 0`, key))
}

func (s *Store) FileByDeleteKey(ctx context.Context, key string) (*Link, error) {
	return scanLink(s.r.QueryRowContext(ctx, `SELECT `+linkCols+` FROM `+linkFrom+` WHERE c.delete_key = ? AND c.delete_key != '' AND l.kind = 2 AND l.deleted_at = 0`, key))
}

// FileHistory uses the protocol's fixed 30-row pages, with an ID tie breaker.
func (s *Store) FileHistory(ctx context.Context, page int) ([]*Link, error) {
	rows, err := s.r.QueryContext(ctx, `SELECT `+linkCols+` FROM `+linkFrom+` WHERE l.kind = 2 AND l.deleted_at = 0 ORDER BY l.created_at DESC, l.id DESC LIMIT 30 OFFSET ?`, int64(page-1)*30)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Link{}
	for rows.Next() {
		l, err := scanLink(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// PurgeLink preserves AUTOINCREMENT and cascades dependents. Orphaned bytes
// are reclaimed by the existing file sweeper after its grace period.
func (s *Store) PurgeLink(ctx context.Context, expected *Link) (string, error) {
	var key string
	err := s.tx(ctx, func(tx *sql.Tx) error {
		l, err := getLink(ctx, tx, expected.ID)
		if err != nil {
			return err
		}
		// Slug-addressed deletes must not follow renames; file deletion keys do.
		if l.Kind != expected.Kind || l.Kind != KindFile && links.Key(l.Slug) != links.Key(expected.Slug) ||
			l.Kind == KindFile && l.Content.DeleteKey != expected.Content.DeleteKey {
			return ErrNotFound
		}
		key = l.Slug
		_, err = tx.ExecContext(ctx, `DELETE FROM links WHERE id = ?`, l.ID)
		return err
	})
	return key, err
}
