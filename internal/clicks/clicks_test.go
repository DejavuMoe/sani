package clicks

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/DejavuMoe/sani/internal/store"
)

type sink struct {
	mu      sync.Mutex
	batches []*store.ClickBatch
	fail    bool
}

func (s *sink) ApplyClicks(ctx context.Context, b *store.ClickBatch) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fail {
		return errors.New("disk full")
	}
	s.batches = append(s.batches, b)
	return nil
}

func TestRecordAndFlush(t *testing.T) {
	sk := &sink{}
	r := New(sk, time.UTC)
	now := time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC)

	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			for range 1000 {
				r.Record(7, "t.co", now)
			}
		})
	}
	wg.Wait()
	r.Record(7, "", now.Add(time.Second))
	r.Record(9, "", now)

	if p := r.Pending(7); p != 8001 {
		t.Fatalf("Pending(7) = %d", p)
	}
	if err := r.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	if p := r.Pending(7); p != 0 {
		t.Fatalf("Pending after flush = %d", p)
	}
	b := sk.batches[0]
	day, _, _ := DayBounds(now, time.UTC)
	if b.Links[7].Count != 8001 || b.Links[7].Last != now.Add(time.Second).UnixMilli() {
		t.Errorf("link delta = %+v", b.Links[7])
	}
	if b.Days[store.DayKey{LinkID: 7, Day: day}] != 8001 {
		t.Errorf("day count = %d", b.Days[store.DayKey{LinkID: 7, Day: day}])
	}
	if b.Refs[store.RefKey{LinkID: 7, Host: "t.co"}] != 8000 || b.Refs[store.RefKey{LinkID: 7}] != 1 {
		t.Errorf("refs = %v", b.Refs)
	}
	if err := r.Flush(context.Background()); err != nil || len(sk.batches) != 1 {
		t.Error("an empty flush must not write")
	}
}

func TestFailedFlushKeepsClicks(t *testing.T) {
	sk := &sink{fail: true}
	r := New(sk, time.UTC)
	now := time.Now()
	r.Record(1, "a.com", now)
	if err := r.Flush(context.Background()); err == nil {
		t.Fatal("expected the flush to fail")
	}
	r.Record(1, "a.com", now)
	if p := r.Pending(1); p != 2 {
		t.Fatalf("Pending after failed flush = %d, want 2", p)
	}
	sk.fail = false
	r.Flush(context.Background())
	if got := sk.batches[0].Refs[store.RefKey{LinkID: 1, Host: "a.com"}]; got != 2 {
		t.Fatalf("retried batch has %d clicks, want 2", got)
	}
}

func TestDayBoundaries(t *testing.T) {
	shanghai, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Skip("no tzdata")
	}
	r := New(&sink{}, shanghai)
	// 23:59 UTC on Sep 27 is already Sep 28 in Shanghai.
	late := time.Date(2026, 9, 27, 23, 59, 0, 0, time.UTC)
	if got := DayDate(r.Day(late)); got != "2026-09-28" {
		t.Errorf("Shanghai day of %v = %s", late, got)
	}
	// The cached window must not leak into the next day.
	if got := DayDate(r.Day(late.Add(17 * time.Hour))); got != "2026-09-29" {
		t.Errorf("next day = %s", got)
	}
	if got := DayDate(r.Day(late.Add(-time.Hour))); got != "2026-09-28" {
		t.Errorf("going back within the day = %s", got)
	}
}

func BenchmarkRecord(b *testing.B) {
	r := New(&sink{}, time.UTC)
	now := time.Now()
	b.ReportAllocs()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			r.Record(42, "t.co", now)
		}
	})
}

func TestReferrersAreBounded(t *testing.T) {
	sk := &sink{}
	r := New(sk, time.UTC)
	now := time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC)
	for i := range 500 {
		r.Record(7, fmt.Sprintf("spam%d.example", i), now)
	}
	r.Record(7, "spam3.example", now) // known hosts keep counting
	if err := r.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	b := sk.batches[0]
	if n := len(b.Refs); n != maxPendingRefs+1 {
		t.Fatalf("%d referrer keys in one batch", n)
	}
	if b.Refs[store.RefKey{LinkID: 7, Host: OtherReferrer}] != 500-maxPendingRefs ||
		b.Refs[store.RefKey{LinkID: 7, Host: "spam3.example"}] != 2 {
		t.Errorf("refs = %v", b.Refs)
	}
}
