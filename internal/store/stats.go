package store

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"strings"
)

type DayKey struct {
	LinkID int64
	Day    int32 // days since 1970-01-01 in the server's time zone
}

type RefKey struct {
	LinkID int64
	Host   string // "" for direct visits
}

// OtherReferrer collects referrers beyond MaxReferrers for one link.
const OtherReferrer = "*"

// MaxReferrers bounds the distinct referrer hosts stored per link.
const MaxReferrers = 200

type LinkDelta struct {
	Count int64
	Last  int64 // unix ms of the latest click
}

// ClickBatch is a set of aggregated clicks flushed together.
type ClickBatch struct {
	Links map[int64]LinkDelta
	Days  map[DayKey]int64
	Refs  map[RefKey]int64
}

func (b *ClickBatch) Empty() bool { return len(b.Links) == 0 }

// ApplyClicks adds a batch to the stored counters in one transaction. Clicks
// for links purged in the meantime are dropped. Saturating before addition
// keeps counters as INTEGERs: SQLite otherwise promotes overflowing sums to REAL.
func (s *Store) ApplyClicks(ctx context.Context, b *ClickBatch) error {
	if b.Empty() {
		return nil
	}
	return s.tx(ctx, func(tx *sql.Tx) error {
		upd, err := tx.PrepareContext(ctx,
			`UPDATE links SET clicks = clicks + min(?, 9223372036854775807 - clicks),
			last_click_at = max(last_click_at, ?) WHERE id = ?`)
		if err != nil {
			return err
		}
		defer upd.Close()
		for id, d := range b.Links {
			if _, err := upd.ExecContext(ctx, d.Count, d.Last, id); err != nil {
				return err
			}
		}

		day, err := tx.PrepareContext(ctx, `INSERT INTO clicks_daily (link_id, day, count)
			SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM links WHERE id = ?1)
			ON CONFLICT (link_id, day) DO UPDATE SET count = count + excluded.count`)
		if err != nil {
			return err
		}
		defer day.Close()
		for k, n := range b.Days {
			if _, err := day.ExecContext(ctx, k.LinkID, k.Day, n); err != nil {
				return err
			}
		}

		bump, err := tx.PrepareContext(ctx, `UPDATE referrers SET count = count + ? WHERE link_id = ? AND host = ?`)
		if err != nil {
			return err
		}
		defer bump.Close()
		add, err := tx.PrepareContext(ctx, `INSERT INTO referrers (link_id, host, count)
			SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM links WHERE id = ?1)
			ON CONFLICT (link_id, host) DO UPDATE SET count = count + excluded.count`)
		if err != nil {
			return err
		}
		defer add.Close()
		stored := map[int64]int{}
		for k, n := range b.Refs {
			res, err := bump.ExecContext(ctx, n, k.LinkID, k.Host)
			if err != nil {
				return err
			}
			if updated, _ := res.RowsAffected(); updated > 0 {
				continue
			}
			have, ok := stored[k.LinkID]
			if !ok {
				if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM referrers WHERE link_id = ?`, k.LinkID).Scan(&have); err != nil {
					return err
				}
			}
			host := k.Host
			if have >= MaxReferrers {
				host = OtherReferrer
			} else {
				have++
			}
			stored[k.LinkID] = have
			if _, err := add.ExecContext(ctx, k.LinkID, host, n); err != nil {
				return err
			}
		}
		return nil
	})
}

// Series returns daily click counts for days from..to inclusive. linkID 0
// means all live links.
func (s *Store) Series(ctx context.Context, linkID int64, from, to int32) ([]int64, error) {
	out := make([]int64, to-from+1)
	var rows *sql.Rows
	var err error
	if linkID == 0 {
		rows, err = s.r.QueryContext(ctx, `SELECT d.day, sum(d.count) FROM clicks_daily d
			JOIN links l ON l.id = d.link_id AND l.deleted_at = 0
			WHERE d.day BETWEEN ? AND ? GROUP BY d.day`, from, to)
	} else {
		rows, err = s.r.QueryContext(ctx, `SELECT day, count FROM clicks_daily
			WHERE link_id = ? AND day BETWEEN ? AND ?`, linkID, from, to)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var day int32
		var n int64
		if err := rows.Scan(&day, &n); err != nil {
			return nil, err
		}
		out[day-from] = n
	}
	return out, rows.Err()
}

// Sparks returns daily series for several links at once.
func (s *Store) Sparks(ctx context.Context, ids []int64, from, to int32) (map[int64][]int64, error) {
	out := make(map[int64][]int64, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	args := make([]any, 0, len(ids)+2)
	for _, id := range ids {
		args = append(args, id)
	}
	args = append(args, from, to)
	rows, err := s.r.QueryContext(ctx, `SELECT link_id, day, count FROM clicks_daily
		WHERE link_id IN (?`+strings.Repeat(",?", len(ids)-1)+`) AND day BETWEEN ? AND ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var day int32
		var n int64
		if err := rows.Scan(&id, &day, &n); err != nil {
			return nil, err
		}
		series := out[id]
		if series == nil {
			series = make([]int64, to-from+1)
			out[id] = series
		}
		series[day-from] = n
	}
	return out, rows.Err()
}

type Referrer struct {
	Host  string
	Count int64
}

// Referrers returns the most common referrer hosts of a link and the total
// number of clicks with referrer data.
func (s *Store) Referrers(ctx context.Context, linkID int64, limit int) ([]Referrer, int64, error) {
	var total int64
	if err := s.r.QueryRowContext(ctx, `SELECT coalesce(sum(count), 0) FROM referrers WHERE link_id = ?`, linkID).
		Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.r.QueryContext(ctx, `SELECT host, count FROM referrers WHERE link_id = ?
		ORDER BY count DESC, host LIMIT ?`, linkID, limit)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []Referrer{}
	for rows.Next() {
		var r Referrer
		if err := rows.Scan(&r.Host, &r.Count); err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	return out, total, rows.Err()
}

// Totals counts live links and their clicks, capped at MaxInt64.
func (s *Store) Totals(ctx context.Context) (links, clicks int64, err error) {
	err = s.r.QueryRowContext(ctx, `SELECT count(*), coalesce(sum(clicks), 0) FROM links WHERE deleted_at = 0`).
		Scan(&links, &clicks)
	var sqliteErr interface{ Code() int }
	if !errors.As(err, &sqliteErr) || sqliteErr.Code() != 1 || !strings.Contains(err.Error(), "integer overflow") {
		return links, clicks, err
	}
	// Separate imports can overflow sum(). Keep its fast path for normal data;
	// total() is not a substitute because it loses integer precision.
	// ponytail: saturate unrepresentable totals; larger totals need a wider API.
	links, clicks = 0, 0
	rows, err := s.r.QueryContext(ctx, `SELECT clicks FROM links WHERE deleted_at = 0`)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()
	for rows.Next() {
		var n int64
		if err := rows.Scan(&n); err != nil {
			return 0, 0, err
		}
		links++
		clicks += min(n, math.MaxInt64-clicks)
	}
	return links, clicks, rows.Err()
}
