package store

import (
	"context"
	"errors"
	"fmt"
	"math"
	"testing"
)

func TestTotalsSeparateImportsOverflow(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	if n, clicks, err := s.Totals(ctx); err != nil || n != 0 || clicks != 0 {
		t.Fatalf("empty totals: %d, %d, %v", n, clicks, err)
	}
	const precise = 1<<53 + 1
	counts := []int64{precise, 2, math.MaxInt64 - precise - 2, 1, math.MaxInt64}
	want := []int64{precise, precise + 2, math.MaxInt64, math.MaxInt64, math.MaxInt64}
	var imported []*Link
	for i, count := range counts {
		l := newLink(fmt.Sprintf("overflow%d", i), "https://example.com/", int64(i+1))
		l.Clicks = count
		res, err := s.ImportLinks(ctx, []*Link{l}, func() string { panic("explicit slug") })
		if err != nil || len(res.Created) != 1 {
			t.Fatalf("import %d: %+v, %v", i, res, err)
		}
		imported = append(imported, l)
		n, clicks, err := s.Totals(ctx)
		if err != nil || n != int64(i+1) || clicks != want[i] {
			t.Fatalf("totals after import %d: %d, %d, %v; want %d", i, n, clicks, err, want[i])
		}
	}
	all, err := s.AllLinks(ctx)
	if err != nil || len(all) != len(counts) {
		t.Fatalf("links: %v, %v", all, err)
	}
	for i, l := range all {
		if l.Clicks != counts[i] {
			t.Errorf("per-link count changed: %d, want %d", l.Clicks, counts[i])
		}
	}
	// Both paths exclude deleted rows; restoring an extreme row is also safe.
	for _, i := range []int{2, 4} {
		if _, err := s.DeleteLink(ctx, imported[i].ID, 100); err != nil {
			t.Fatal(err)
		}
	}
	if n, clicks, err := s.Totals(ctx); err != nil || n != 3 || clicks != precise+3 {
		t.Fatalf("totals after deletion: %d, %d, %v", n, clicks, err)
	}
	if _, err := s.RestoreLink(ctx, imported[4].ID); err != nil {
		t.Fatal(err)
	}
	if n, clicks, err := s.Totals(ctx); err != nil || n != 4 || clicks != math.MaxInt64 {
		t.Fatalf("totals after restore: %d, %d, %v", n, clicks, err)
	}
}

func TestApplyClicksKeepsExtremeLinkInteger(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	extreme := newLink("extreme", "https://example.com/extreme", 1)
	extreme.Clicks = math.MaxInt64 - 1
	ordinary := newLink("ordinary", "https://example.com/ordinary", 2)
	for _, l := range []*Link{extreme, ordinary} {
		if err := s.CreateLink(ctx, l, false); err != nil {
			t.Fatal(err)
		}
	}
	for i := int64(1); i <= 3; i++ {
		if err := s.ApplyClicks(ctx, &ClickBatch{
			Links: map[int64]LinkDelta{extreme.ID: {Count: 1, Last: i + 100}, ordinary.ID: {Count: 1, Last: i + 100}},
			Days:  map[DayKey]int64{{LinkID: extreme.ID, Day: 20}: 1},
			Refs:  map[RefKey]int64{{LinkID: extreme.ID, Host: ""}: 1},
		}); err != nil {
			t.Fatal(err)
		}
		var storageType string
		var count, last int64
		err := s.r.QueryRowContext(ctx, `SELECT typeof(clicks), clicks, last_click_at FROM links WHERE id = ?`, extreme.ID).
			Scan(&storageType, &count, &last)
		if err != nil || storageType != "integer" || count != math.MaxInt64 || last != i+100 {
			t.Fatalf("extreme after click %d: %s, %d, %d, %v", i, storageType, count, last, err)
		}
		l, err := s.GetLink(ctx, ordinary.ID)
		if err != nil || l.Clicks != i {
			t.Fatalf("ordinary count lost: %+v, %v", l, err)
		}
	}
	// Imported totals do not become daily/referrer data; only real deltas do.
	series, err := s.Series(ctx, extreme.ID, 20, 20)
	if err != nil || len(series) != 1 || series[0] != 3 {
		t.Fatalf("daily deltas: %v, %v", series, err)
	}
	refs, total, err := s.Referrers(ctx, extreme.ID, 8)
	if err != nil || total != 3 || len(refs) != 1 || refs[0].Count != 3 {
		t.Fatalf("referrer deltas: %v, %d, %v", refs, total, err)
	}
}

func TestTotalsPreservesOtherErrors(t *testing.T) {
	s := open(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := s.Totals(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation hidden: %v", err)
	}
	if err := s.r.Close(); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Totals(context.Background()); err == nil {
		t.Fatal("closed database error hidden")
	}
}
