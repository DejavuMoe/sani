package clicks

import (
	"context"
	"errors"
	"fmt"
	"runtime"
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

type sinkFunc func(context.Context, *store.ClickBatch) error

func (f sinkFunc) ApplyClicks(ctx context.Context, b *store.ClickBatch) error { return f(ctx, b) }

func TestRepeatedFailedFlushBoundsMergedReferrers(t *testing.T) {
	var r *Recorder
	round := 0
	now := time.Now()
	r = New(sinkFunc(func(_ context.Context, b *store.ClickBatch) error {
		if round == 4 {
			if len(b.Refs) > maxPendingRefs+1 {
				t.Fatalf("unbounded restore: %d hosts", len(b.Refs))
			}
			var sum int64
			for _, n := range b.Refs {
				sum += n
			}
			if sum != 256 || b.Links[1].Count != 256 {
				t.Fatalf("lost clicks: refs=%d links=%d", sum, b.Links[1].Count)
			}
			return nil
		}
		for i := range maxPendingRefs {
			r.Record(1, fmt.Sprintf("%d-%d.example", round, i), now)
		}
		round++
		return errors.New("disk full")
	}), time.UTC)
	for i := range maxPendingRefs {
		r.Record(1, fmt.Sprintf("0-%d.example", i), now)
	}
	round = 1
	for range 3 {
		if err := r.Flush(context.Background()); err == nil {
			t.Fatal("expected failure")
		}
	}
	if err := r.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestWaitingFlushCanBeCanceled(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	r := New(sinkFunc(func(ctx context.Context, _ *store.ClickBatch) error {
		close(entered)
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}), time.UTC)
	r.Record(1, "", time.Now())
	done := make(chan error, 1)
	go func() { done <- r.Flush(context.Background()) }()
	<-entered
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := r.Flush(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("waiting flush: %v", err)
	}
	// Recording must remain available while the writer is blocked.
	r.Record(1, "", time.Now())
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if n := r.Pending(1); n != 1 {
		t.Fatalf("new pending = %d", n)
	}
}

func TestCountersReleaseAfterCacheAndBatch(t *testing.T) {
	r := New(&sink{}, time.UTC)
	func() {
		defer r.Snapshot()()
		for id := int64(1); id <= 2000; id++ {
			r.Counter(id, 0)
		}
		c := r.Counter(3000, 4)
		c.Add(1)
		r.Record(3000, "", time.Now())
		runtime.KeepAlive(c)
	}()
	runtime.GC()
	if got := r.Total(3000, 4); got != 5 {
		t.Fatalf("pending counter lost: %d", got)
	}
	if err := r.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		runtime.GC()
		n := 0
		for i := range r.shards {
			s := &r.shards[i]
			s.mu.Lock()
			n += len(s.counters)
			s.mu.Unlock()
		}
		if n == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("%d counters survived eviction and flush", n)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
