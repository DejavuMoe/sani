package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
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

// Kind is what a link does when visited.
type Kind int

const (
	KindURL  Kind = 0 // redirects to URL
	KindText Kind = 1 // shows a text at /p/{slug}
	KindFile Kind = 2 // offers a file at /p/{slug}
)

// Format is how a shared text is shown.
type Format int

const (
	FormatPlain Format = 0 // wrapped, in the body font
	FormatCode  Format = 1 // monospace with line numbers
)

// Content describes what a text or file link shares.
type Content struct {
	Format    Format
	Name      string // a file's download name; a text's first line
	Type      string // a file's media type
	Size      int64  // bytes
	Lines     int64  // lines of a text
	SHA256    []byte // of a file
	DeleteKey string // opaque authenticated deletion handle
	File      string // a file's name in the files directory
	// Text is the body of a text. Listings leave it empty; it is set when
	// creating a link and read with TextBody.
	Text string
}

type Link struct {
	ID          int64
	Kind        Kind
	Content     *Content // nil for KindURL
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
	Tags        []int64
	ImportTags  []Tag // portable names/colors, resolved inside the import transaction
}

// Target is the part of a link the redirect path needs.
type Target struct {
	ID        int64
	Kind      Kind
	URL       string
	Redirect  int
	Enabled   bool
	ExpiresAt int64
	MaxClicks int64
	Clicks    int64
}

const linkCols = `l.id, l.slug, l.url, l.host, l.title, l.meta, l.redirect, l.enabled,
	l.expires_at, l.max_clicks, l.clicks, l.last_click_at, l.created_at, l.updated_at,
	coalesce(f.type != '', 0), l.kind, coalesce(c.format, 0), coalesce(c.name, ''), coalesce(c.type, ''),
	coalesce(c.size, 0), coalesce(c.lines, 0), c.sha256, coalesce(c.file, ''), coalesce(c.delete_key, ''),
	(SELECT json_group_array(tag_id ORDER BY position) FROM link_tags WHERE link_id = l.id)`

const linkFrom = `links l LEFT JOIN favicons f ON f.host = l.host LEFT JOIN contents c ON c.link_id = l.id`

type scanner interface{ Scan(...any) error }

func scanLink(row scanner) (*Link, error) {
	var l Link
	var c Content
	var tags string
	err := row.Scan(&l.ID, &l.Slug, &l.URL, &l.Host, &l.Title, &l.Meta, &l.Redirect, &l.Enabled,
		&l.ExpiresAt, &l.MaxClicks, &l.Clicks, &l.LastClickAt, &l.CreatedAt, &l.UpdatedAt, &l.HasIcon,
		&l.Kind, &c.Format, &c.Name, &c.Type, &c.Size, &c.Lines, &c.SHA256, &c.File, &c.DeleteKey, &tags)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if l.Kind != KindURL {
		l.Content = &c
	}
	if err := json.Unmarshal([]byte(tags), &l.Tags); err != nil {
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
		(kind, slug, slug_key, url, host, title, meta, redirect, enabled, expires_at, max_clicks,
		 clicks, last_click_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		l.Kind, l.Slug, links.Key(l.Slug), l.URL, l.Host, l.Title, l.Meta, l.Redirect, l.Enabled,
		l.ExpiresAt, l.MaxClicks, l.Clicks, l.LastClickAt, l.CreatedAt, l.UpdatedAt)
	if isUniqueViolation(err) {
		return ErrSlugTaken
	}
	if err != nil {
		return err
	}
	if l.ID, err = res.LastInsertId(); err != nil {
		return err
	}
	if c := l.Content; c != nil {
		var body any
		if l.Kind == KindFile {
			key := make([]byte, 24)
			rand.Read(key)
			c.DeleteKey = hex.EncodeToString(key)
		}
		if l.Kind == KindText {
			body = c.Text
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO contents
			(link_id, format, name, type, size, lines, sha256, file, body, delete_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			l.ID, c.Format, c.Name, c.Type, c.Size, c.Lines, c.SHA256, c.File, body, c.DeleteKey)
	}
	if err != nil {
		return err
	}
	return setLinkTags(ctx, tx, l.ID, l.Tags)
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
	err := s.r.QueryRowContext(ctx, `SELECT id, kind, url, redirect, enabled, expires_at, max_clicks, clicks
		FROM links WHERE slug_key = ? AND deleted_at = 0`, key).
		Scan(&t.ID, &t.Kind, &t.URL, &t.Redirect, &t.Enabled, &t.ExpiresAt, &t.MaxClicks, &t.Clicks)
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
		WHERE l.url = ? AND l.kind = 0 AND l.deleted_at = 0 AND l.enabled = 1 AND l.expires_at = 0
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
	ExpectedSlug *string // optional identity check under the write lock
	URL          *string
	Slug         *string
	Title        *string
	Redirect     *int
	Enabled      *bool
	ExpiresAt    *int64
	MaxClicks    *int64
	Text         *string // replaces a text's body
	Format       *Format
	Tags         *[]int64
	FetchMeta    bool // queue automatic titles when a URL or an empty title changes
	RefreshMeta  bool // refresh an automatic title without replacing a manual title
}

// UpdateLink applies p and returns the link before and after the change.
func (s *Store) UpdateLink(ctx context.Context, id int64, p Patch, now int64) (before, after *Link, err error) {
	err = s.tx(ctx, func(tx *sql.Tx) error {
		var err error
		if before, err = getLink(ctx, tx, id); err != nil {
			return err
		}
		if p.ExpectedSlug != nil && links.Key(before.Slug) != links.Key(*p.ExpectedSlug) {
			return ErrNotFound
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
		// Decide from the row read under the write transaction: a caller's
		// earlier snapshot may predate an owner-provided title.
		title, state := before.Title, before.Meta
		if p.Title != nil {
			title, state = *p.Title, MetaManual
		}
		changedURL := p.URL != nil && *p.URL != before.URL
		if before.Kind == KindURL && (p.Title != nil && *p.Title == "" ||
			p.Title == nil && before.Meta != MetaManual && (p.RefreshMeta || changedURL)) {
			title, state = "", MetaFailed
			if p.FetchMeta || p.RefreshMeta {
				state = MetaPending
			}
		}
		if title != before.Title || state != before.Meta {
			set("title", title)
			set("meta", state)
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
		if p.RefreshMeta {
			set("updated_at", before.UpdatedAt)
		} else {
			// Commit order must stay distinguishable even when requests start
			// in the same millisecond or reach this transaction out of order.
			set("updated_at", max(now, before.UpdatedAt+1))
		}
		args = append(args, id)
		_, err = tx.ExecContext(ctx, `UPDATE links SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...)
		if isUniqueViolation(err) {
			return ErrSlugTaken
		}
		if err != nil {
			return err
		}
		if p.Text != nil {
			_, err = tx.ExecContext(ctx, `UPDATE contents SET body = ?, size = ?, lines = ?, name = ? WHERE link_id = ?`,
				*p.Text, len(*p.Text), links.TextLines(*p.Text), links.TextPreview(*p.Text), id)
			if err != nil {
				return err
			}
		}
		if p.Format != nil {
			if _, err = tx.ExecContext(ctx, `UPDATE contents SET format = ? WHERE link_id = ?`, *p.Format, id); err != nil {
				return err
			}
		}
		if p.Tags != nil {
			if err := setLinkTags(ctx, tx, id, *p.Tags); err != nil {
				return err
			}
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
		stmt = `UPDATE links SET enabled = ?, updated_at = max(?, updated_at + 1) WHERE deleted_at = 0 AND enabled != ? AND id IN ` + in
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
	Kind   *Kind  // nil lists every kind
	Tag    *int64 // nil lists every tag; 0 means untagged
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
	if q.Tag != nil {
		if *q.Tag == 0 {
			where = append(where, "NOT EXISTS (SELECT 1 FROM link_tags WHERE link_id = l.id)")
		} else {
			where = append(where, "l.id IN (SELECT link_id FROM link_tags WHERE tag_id = ?)")
			args = append(args, *q.Tag)
		}
	}
	if q.Kind != nil {
		where = append(where, "l.kind = ?")
		args = append(args, *q.Kind)
	}
	if q.Search != "" {
		pat := "%" + escapeLike(strings.ToLower(q.Search)) + "%"
		where = append(where, `(l.slug_key LIKE ? ESCAPE '\' OR l.url LIKE ? ESCAPE '\' OR l.title LIKE ? ESCAPE '\'
			OR c.name LIKE ? ESCAPE '\')`)
		args = append(args, pat, pat, pat, pat)
	}

	res := &ListResult{Links: []*Link{}}
	countFrom := "links l"
	if q.Search != "" {
		countFrom += " LEFT JOIN contents c ON c.link_id = l.id"
	}
	if err := s.r.QueryRowContext(ctx, `SELECT count(*) FROM `+countFrom+` WHERE `+strings.Join(where, " AND "), args...).Scan(&res.Total); err != nil {
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

// TextBody returns the body of a live text link.
func (s *Store) TextBody(ctx context.Context, id int64) (string, error) {
	var body string
	err := s.r.QueryRowContext(ctx, `SELECT coalesce(c.body, '') FROM links l JOIN contents c ON c.link_id = l.id
		WHERE l.id = ? AND l.kind = ? AND l.deleted_at = 0`, id, KindText).Scan(&body)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return body, err
}

// StoredFiles returns the names of every file a link still refers to,
// deleted links included until they are purged.
func (s *Store) StoredFiles(ctx context.Context) (map[string]bool, error) {
	rows, err := s.r.QueryContext(ctx, `SELECT file FROM contents WHERE file != ''`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out[name] = true
	}
	return out, rows.Err()
}

// AllLinks returns every live link that redirects, oldest first.
func (s *Store) AllLinks(ctx context.Context) ([]*Link, error) {
	rows, err := s.r.QueryContext(ctx, `SELECT `+linkCols+` FROM `+linkFrom+
		` WHERE l.deleted_at = 0 AND l.kind = 0 ORDER BY l.created_at, l.id`)
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
					l.Tags = nil
					for _, imported := range l.ImportTags {
						tag, err := createTag(ctx, tx, imported.Name, imported.Color)
						if err != nil {
							return err
						}
						l.Tags = append(l.Tags, tag.ID)
					}
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
