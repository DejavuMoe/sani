package store

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"

	"github.com/DejavuMoe/sani/internal/links"
)

// MetaState records where a link's title came from.
type MetaState int

const (
	MetaPending MetaState = 0 // title not fetched yet
	MetaOK      MetaState = 1 // title fetched from the destination
	MetaFailed  MetaState = 2 // fetch failed or was disabled
	MetaManual  MetaState = 3 // title set by the owner; never overwritten
)

type Link struct {
	ID          int64
	Slug        string
	URL         string
	Host        string // exact hostname of URL, used to fetch and group favicons
	Title       string
	Meta        MetaState
	Redirect    int
	Enabled     bool
	ExpiresAt   int64 // unix ms, 0 = never
	MaxClicks   int64 // 0 = unlimited
	Clicks      int64
	LastClickAt int64
	CreatedAt   int64
	UpdatedAt   int64
	HasIcon     bool
}

// Target is the part of a link the redirect path needs.
type Target struct {
	ID        int64
	URL       string
	Redirect  int
	Enabled   bool
	ExpiresAt int64
	MaxClicks int64
	Clicks    int64
}

const linkCols = `l.id, l.slug, l.url, l.host, l.title, l.meta, l.redirect, l.enabled,
	l.expires_at, l.max_clicks, l.clicks, l.last_click_at, l.created_at, l.updated_at,
	coalesce(f.type != '', 0)`

const linkFrom = `links l LEFT JOIN favicons f ON f.host = l.host`

type scanner interface{ Scan(...any) error }

func scanLink(row scanner) (*Link, error) {
	var l Link
	err := row.Scan(&l.ID, &l.Slug, &l.URL, &l.Host, &l.Title, &l.Meta, &l.Redirect, &l.Enabled,
		&l.ExpiresAt, &l.MaxClicks, &l.Clicks, &l.LastClickAt, &l.CreatedAt, &l.UpdatedAt, &l.HasIcon)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &l, nil
}

type querier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func getLink(ctx context.Context, q querier, id int64) (*Link, error) {
	return scanLink(q.QueryRowContext(ctx,
		`SELECT `+linkCols+` FROM `+linkFrom+` WHERE l.id = ? AND l.deleted_at = 0`, id))
}

func isUniqueViolation(err error) bool {
	var e interface{ Code() int }
	return errors.As(err, &e) && e.Code() == 2067 // SQLITE_CONSTRAINT_UNIQUE
}

// claimSlug makes key usable by link id (0 for a new link). A slug held by a
// deleted link is released when reclaim is set; any other holder is a conflict.
func claimSlug(ctx context.Context, tx *sql.Tx, key string, id int64, reclaim bool) error {
	var holder, deletedAt int64
	err := tx.QueryRowContext(ctx, `SELECT id, deleted_at FROM links WHERE slug_key = ?`, key).Scan(&holder, &deletedAt)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return nil
	case err != nil:
		return err
	case holder == id:
		return nil
	case deletedAt != 0 && reclaim:
		_, err := tx.ExecContext(ctx, `DELETE FROM links WHERE id = ?`, holder)
		return err
	default:
		return ErrSlugTaken
	}
}

func insertLink(ctx context.Context, tx *sql.Tx, l *Link) error {
	res, err := tx.ExecContext(ctx, `INSERT INTO links
		(slug, slug_key, url, host, title, meta, redirect, enabled, expires_at, max_clicks,
		 clicks, last_click_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		l.Slug, links.Key(l.Slug), l.URL, l.Host, l.Title, l.Meta, l.Redirect, l.Enabled,
		l.ExpiresAt, l.MaxClicks, l.Clicks, l.LastClickAt, l.CreatedAt, l.UpdatedAt)
	if isUniqueViolation(err) {
		return ErrSlugTaken
	}
	if err != nil {
		return err
	}
	l.ID, err = res.LastInsertId()
	return err
}

// CreateLink inserts l and sets its ID. With reclaim, a slug that only a
// deleted link still holds is taken over; generated slugs never reclaim.
func (s *Store) CreateLink(ctx context.Context, l *Link, reclaim bool) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		if err := claimSlug(ctx, tx, links.Key(l.Slug), 0, reclaim); err != nil {
			return err
		}
		return insertLink(ctx, tx, l)
	})
}

func (s *Store) GetLink(ctx context.Context, id int64) (*Link, error) {
	return getLink(ctx, s.r, id)
}

// Resolve loads the redirect target for a lookup key.
func (s *Store) Resolve(ctx context.Context, key string) (*Target, error) {
	var t Target
	err := s.r.QueryRowContext(ctx, `SELECT id, url, redirect, enabled, expires_at, max_clicks, clicks
		FROM links WHERE slug_key = ? AND deleted_at = 0`, key).
		Scan(&t.ID, &t.URL, &t.Redirect, &t.Enabled, &t.ExpiresAt, &t.MaxClicks, &t.Clicks)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// FindPlainLink returns the newest live link to url that has no expiry, no
// click limit and a temporary redirect, so it can stand in for a new one.
func (s *Store) FindPlainLink(ctx context.Context, url string) (*Link, error) {
	return scanLink(s.r.QueryRowContext(ctx, `SELECT `+linkCols+` FROM `+linkFrom+`
		WHERE l.url = ? AND l.deleted_at = 0 AND l.enabled = 1 AND l.expires_at = 0
		AND l.max_clicks = 0 AND l.redirect = 302
		ORDER BY l.id DESC LIMIT 1`, url))
}

// SlugAvailable reports whether a new link could use key.
func (s *Store) SlugAvailable(ctx context.Context, key string) (bool, error) {
	var deletedAt int64
	err := s.r.QueryRowContext(ctx, `SELECT deleted_at FROM links WHERE slug_key = ?`, key).Scan(&deletedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	return deletedAt != 0, nil
}

// Patch lists the fields an update changes; nil fields stay as they are.
type Patch struct {
	URL       *string
	Slug      *string
	Title     *string
	Meta      *MetaState
	Redirect  *int
	Enabled   *bool
	ExpiresAt *int64
	MaxClicks *int64
}

// UpdateLink applies p and returns the link before and after the change.
func (s *Store) UpdateLink(ctx context.Context, id int64, p Patch, now int64) (before, after *Link, err error) {
	err = s.tx(ctx, func(tx *sql.Tx) error {
		var err error
		if before, err = getLink(ctx, tx, id); err != nil {
			return err
		}
		var sets []string
		var args []any
		set := func(col string, v any) {
			sets = append(sets, col+" = ?")
			args = append(args, v)
		}
		if p.Slug != nil && *p.Slug != before.Slug {
			key := links.Key(*p.Slug)
			if key != links.Key(before.Slug) {
				if err := claimSlug(ctx, tx, key, id, true); err != nil {
					return err
				}
			}
			set("slug", *p.Slug)
			set("slug_key", key)
		}
		if p.URL != nil {
			set("url", *p.URL)
			set("host", links.FetchHost(*p.URL))
		}
		if p.Title != nil {
			set("title", *p.Title)
		}
		if p.Meta != nil {
			set("meta", *p.Meta)
		}
		if p.Redirect != nil {
			set("redirect", *p.Redirect)
		}
		if p.Enabled != nil {
			set("enabled", *p.Enabled)
		}
		if p.ExpiresAt != nil {
			set("expires_at", *p.ExpiresAt)
		}
		if p.MaxClicks != nil {
			set("max_clicks", *p.MaxClicks)
		}
		set("updated_at", now)
		args = append(args, id)
		_, err = tx.ExecContext(ctx, `UPDATE links SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...)
		if isUniqueViolation(err) {
			return ErrSlugTaken
		}
		if err != nil {
			return err
		}
		after, err = getLink(ctx, tx, id)
		return err
	})
	return before, after, err
}

// SetFetchedMeta stores a fetched title, unless the owner has set one or the
// destination changed while the fetch was in flight.
func (s *Store) SetFetchedMeta(ctx context.Context, id int64, url, title string, state MetaState) error {
	_, err := s.w.ExecContext(ctx, `UPDATE links SET title = ?, meta = ?
		WHERE id = ? AND url = ? AND meta = ?`, title, state, id, url, MetaPending)
	return err
}

// DeleteLink marks a link deleted and returns its lookup key. The row stays
// until PurgeDeleted so the deletion can be undone.
func (s *Store) DeleteLink(ctx context.Context, id, now int64) (string, error) {
	var key string
	err := s.w.QueryRowContext(ctx, `UPDATE links SET deleted_at = ?
		WHERE id = ? AND deleted_at = 0 RETURNING slug_key`, now, id).Scan(&key)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return key, err
}

func (s *Store) RestoreLink(ctx context.Context, id int64) (*Link, error) {
	res, err := s.w.ExecContext(ctx, `UPDATE links SET deleted_at = 0 WHERE id = ? AND deleted_at != 0`, id)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return getLink(ctx, s.w, id)
}

// BulkAction is a change applied to many links at once.
type BulkAction int

const (
	BulkEnable BulkAction = iota
	BulkDisable
	BulkDelete
	BulkRestore
)

// Bulk applies action to the links with the given ids in one transaction and
// returns the links it changed: as they are afterwards, or, for BulkDelete, as
// they were. Ids that don't exist or are already in the target state are
// skipped, as is restoring a link whose slug has been taken over since.
func (s *Store) Bulk(ctx context.Context, action BulkAction, ids []int64, now int64) ([]*Link, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	in := "(" + strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",") + ")"
	idArgs := make([]any, len(ids))
	for i, id := range ids {
		idArgs[i] = id
	}
	var stmt string
	var args []any
	switch action {
	case BulkEnable, BulkDisable:
		on := action == BulkEnable
		stmt = `UPDATE links SET enabled = ?, updated_at = ? WHERE deleted_at = 0 AND enabled != ? AND id IN ` + in
		args = []any{on, now, on}
	case BulkDelete:
		stmt = `UPDATE links SET deleted_at = ? WHERE deleted_at = 0 AND id IN ` + in
		args = []any{now}
	case BulkRestore:
		stmt = `UPDATE links SET deleted_at = 0 WHERE deleted_at != 0 AND id IN ` + in
	}
	stmt += ` RETURNING id`
	args = append(args, idArgs...)

	var out []*Link
	err := s.tx(ctx, func(tx *sql.Tx) error {
		// A deleted link can't be read afterwards, so read it first.
		if action == BulkDelete {
			var err error
			if out, err = linksIn(ctx, tx, in, idArgs); err != nil {
				return err
			}
		}
		rows, err := tx.QueryContext(ctx, stmt, args...)
		if err != nil {
			return err
		}
		changed := map[int64]bool{}
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			changed[id] = true
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		if action != BulkDelete {
			if out, err = linksIn(ctx, tx, in, idArgs); err != nil {
				return err
			}
		}
		kept := out[:0]
		for _, l := range out {
			if changed[l.ID] {
				kept = append(kept, l)
			}
		}
		out = kept
		return nil
	})
	return out, err
}

// linksIn reads the live links whose id is in the list, oldest first.
func linksIn(ctx context.Context, tx *sql.Tx, in string, ids []any) ([]*Link, error) {
	rows, err := tx.QueryContext(ctx, `SELECT `+linkCols+` FROM `+linkFrom+
		` WHERE l.deleted_at = 0 AND l.id IN `+in+` ORDER BY l.id`, ids...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Link
	for rows.Next() {
		l, err := scanLink(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// PurgeDeleted permanently removes links deleted before the given time.
func (s *Store) PurgeDeleted(ctx context.Context, before int64) (int64, error) {
	res, err := s.w.ExecContext(ctx, `DELETE FROM links WHERE deleted_at != 0 AND deleted_at < ?`, before)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

type Cursor struct {
	V  int64
	ID int64
}

func (c Cursor) String() string {
	return strconv.FormatInt(c.V, 36) + "." + strconv.FormatInt(c.ID, 36)
}

func ParseCursor(s string) (*Cursor, bool) {
	v, id, ok := strings.Cut(s, ".")
	if !ok {
		return nil, false
	}
	a, err1 := strconv.ParseInt(v, 36, 64)
	b, err2 := strconv.ParseInt(id, 36, 64)
	if err1 != nil || err2 != nil {
		return nil, false
	}
	return &Cursor{V: a, ID: b}, true
}

type ListQuery struct {
	Search string
	Sort   string // "created" (default), "clicks" or "visited"
	After  *Cursor
	Limit  int
}

type ListResult struct {
	Links []*Link
	Next  *Cursor
	Total int64
}

var sortColumns = map[string]string{
	"created": "l.created_at",
	"clicks":  "l.clicks",
	"visited": "l.last_click_at",
}

func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

func (s *Store) ListLinks(ctx context.Context, q ListQuery) (*ListResult, error) {
	col, ok := sortColumns[q.Sort]
	if !ok {
		col = sortColumns["created"]
	}
	if q.Limit <= 0 || q.Limit > 200 {
		q.Limit = 50
	}
	where := []string{"l.deleted_at = 0"}
	var args []any
	if q.Search != "" {
		pat := "%" + escapeLike(strings.ToLower(q.Search)) + "%"
		where = append(where, `(l.slug_key LIKE ? ESCAPE '\' OR l.url LIKE ? ESCAPE '\' OR l.title LIKE ? ESCAPE '\')`)
		args = append(args, pat, pat, pat)
	}

	res := &ListResult{Links: []*Link{}}
	if err := s.r.QueryRowContext(ctx, `SELECT count(*) FROM links l WHERE `+strings.Join(where, " AND "), args...).
		Scan(&res.Total); err != nil {
		return nil, err
	}

	if q.After != nil {
		where = append(where, "("+col+", l.id) < (?, ?)")
		args = append(args, q.After.V, q.After.ID)
	}
	args = append(args, q.Limit+1)
	rows, err := s.r.QueryContext(ctx, `SELECT `+linkCols+` FROM `+linkFrom+
		` WHERE `+strings.Join(where, " AND ")+
		` ORDER BY `+col+` DESC, l.id DESC LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		l, err := scanLink(rows)
		if err != nil {
			return nil, err
		}
		res.Links = append(res.Links, l)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(res.Links) > q.Limit {
		res.Links = res.Links[:q.Limit]
		last := res.Links[len(res.Links)-1]
		c := Cursor{ID: last.ID}
		switch col {
		case "l.clicks":
			c.V = last.Clicks
		case "l.last_click_at":
			c.V = last.LastClickAt
		default:
			c.V = last.CreatedAt
		}
		res.Next = &c
	}
	return res, nil
}

// AllLinks returns every live link, oldest first.
func (s *Store) AllLinks(ctx context.Context) ([]*Link, error) {
	rows, err := s.r.QueryContext(ctx, `SELECT `+linkCols+` FROM `+linkFrom+
		` WHERE l.deleted_at = 0 ORDER BY l.created_at, l.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Link
	for rows.Next() {
		l, err := scanLink(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// ImportResult reports what an import did with each entry.
type ImportResult struct {
	Created   []*Link
	Conflicts []string // slugs already used by live links
}

// ImportLinks inserts many links in one transaction. Entries without a slug
// get one from gen. Slugs held by live links are reported, not overwritten.
func (s *Store) ImportLinks(ctx context.Context, items []*Link, gen func() string) (*ImportResult, error) {
	res := &ImportResult{}
	err := s.tx(ctx, func(tx *sql.Tx) error {
		for _, l := range items {
			generated := l.Slug == ""
			for attempt := 0; ; attempt++ {
				if generated {
					l.Slug = gen()
				}
				err := claimSlug(ctx, tx, links.Key(l.Slug), 0, !generated)
				if err == nil {
					err = insertLink(ctx, tx, l)
				}
				if errors.Is(err, ErrSlugTaken) {
					if generated && attempt < 16 {
						continue
					}
					res.Conflicts = append(res.Conflicts, l.Slug)
					break
				}
				if err != nil {
					return err
				}
				res.Created = append(res.Created, l)
				break
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return res, nil
}
