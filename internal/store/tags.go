package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

const MaxLinkTags = 5
const MaxTagName = 24

// MaxTags bounds the catalog returned to the administrator in one response.
const MaxTags = 1000

var ErrTagsInvalid = errors.New("invalid tags")
var ErrTagLimit = errors.New("tag catalog is full")

type Tag struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
	Count int64  `json:"count"`
}

// NormalizeTag is shared by tag creation and portable link imports.
func NormalizeTag(name, color string) (string, string, error) {
	name = norm.NFC.String(strings.TrimSpace(name))
	if name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > MaxTagName {
		return "", "", ErrTagsInvalid
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return "", "", ErrTagsInvalid
		}
	}
	if color == "" {
		color = "blue"
	}
	switch color {
	case "blue", "green", "amber", "rose", "neutral":
		return name, color, nil
	default:
		return "", "", ErrTagsInvalid
	}
}

func createTag(ctx context.Context, tx *sql.Tx, name, color string) (*Tag, error) {
	name, color, err := NormalizeTag(name, color)
	if err != nil {
		return nil, err
	}
	key := strings.ToLower(name)
	t := &Tag{}
	err = tx.QueryRowContext(ctx, `SELECT id, name, color,
		(SELECT count(*) FROM link_tags lt JOIN links l ON l.id = lt.link_id AND l.deleted_at = 0 WHERE lt.tag_id = tags.id)
		FROM tags WHERE name_key = ?`, key).Scan(&t.ID, &t.Name, &t.Color, &t.Count)
	if err == nil {
		return t, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM tags`).Scan(&count); err != nil {
		return nil, err
	}
	if count >= MaxTags {
		return nil, ErrTagLimit
	}
	err = tx.QueryRowContext(ctx, `INSERT INTO tags (name, name_key, color) VALUES (?, ?, ?) RETURNING id, name, color`, name, key, color).Scan(&t.ID, &t.Name, &t.Color)
	return t, err
}

func (s *Store) CreateTag(ctx context.Context, name, color string) (tag *Tag, err error) {
	err = s.tx(ctx, func(tx *sql.Tx) error { tag, err = createTag(ctx, tx, name, color); return err })
	return
}

type TagCatalog struct {
	Items    []Tag `json:"items"`
	Total    int64 `json:"total"`
	Untagged int64 `json:"untagged"`
}

func (s *Store) Tags(ctx context.Context) (*TagCatalog, error) {
	// One read transaction keeps counts and the catalog at the same snapshot.
	tx, err := s.r.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	c := &TagCatalog{Items: []Tag{}}
	rows, err := tx.QueryContext(ctx, `SELECT t.id, t.name, t.color, count(l.id)
		FROM tags t LEFT JOIN link_tags lt ON lt.tag_id = t.id
		LEFT JOIN links l ON l.id = lt.link_id AND l.deleted_at = 0
		GROUP BY t.id ORDER BY t.id`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var t Tag
		if err := rows.Scan(&t.ID, &t.Name, &t.Color, &t.Count); err != nil {
			rows.Close()
			return nil, err
		}
		c.Items = append(c.Items, t)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	err = tx.QueryRowContext(ctx, `SELECT count(*), coalesce(sum(NOT EXISTS (SELECT 1 FROM link_tags WHERE link_id = l.id)), 0) FROM links l WHERE deleted_at = 0`).Scan(&c.Total, &c.Untagged)
	if err != nil {
		return nil, err
	}
	return c, tx.Commit()
}

func ValidTagIDs(ids []int64) bool {
	if len(ids) > MaxLinkTags {
		return false
	}
	for i, id := range ids {
		if id <= 0 {
			return false
		}
		for _, prev := range ids[:i] {
			if prev == id {
				return false
			}
		}
	}
	return true
}

func setLinkTags(ctx context.Context, tx *sql.Tx, id int64, tags []int64) error {
	if !ValidTagIDs(tags) {
		return ErrTagsInvalid
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM link_tags WHERE link_id = ?`, id); err != nil {
		return err
	}
	for pos, tag := range tags {
		res, err := tx.ExecContext(ctx, `INSERT INTO link_tags (link_id, tag_id, position) SELECT ?, id, ? FROM tags WHERE id = ?`, id, pos, tag)
		if err != nil {
			return err
		}
		if n, err := res.RowsAffected(); err != nil {
			return err
		} else if n != 1 {
			return ErrTagsInvalid
		}
	}
	return nil
}
