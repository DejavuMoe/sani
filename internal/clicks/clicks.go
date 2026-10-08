// Package clicks aggregates redirects in memory and writes them to the store
// in periodic batches, so counting a click never waits on the database.
package clicks

import (
	"context"
	"log/slog"
	"math"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
	"weak"

	"github.com/DejavuMoe/sani/internal/store"
)

const shardCount = 32

// Referrer hosts come from a request header anyone can set, so each link
// tracks a bounded number of them; the rest are counted under OtherReferrer.
const (
	maxPendingRefs = 64
	OtherReferrer  = store.OtherReferrer
)

// Sink persists a batch of clicks.
type Sink interface {
	ApplyClicks(ctx context.Context, b *store.ClickBatch) error
}

type pending struct {
	counter *atomic.Int64 // keep the live total until this batch has been stored
	total   int64
	last    int64
	days    map[int32]int64
	refs    map[string]int64
}

type shard struct {
	mu       sync.Mutex
	links    map[int64]*pending
	counters map[int64]weak.Pointer[atomic.Int64]
}

type Recorder struct {
	shards [shardCount]shard
	sink   Sink
	loc    *time.Location
	window atomic.Pointer[dayWindow]

	// ponytail: one snapshot lock; use versioned snapshots if measured
	// cold-load contention becomes a bottleneck.
	flushMu   sync.RWMutex  // cold loads pair a stored total with pending clicks
	flushSlot chan struct{} // waiting flushes can honor cancellation
}

func New(sink Sink, loc *time.Location) *Recorder {
	r := &Recorder{sink: sink, loc: loc, flushSlot: make(chan struct{}, 1)}
	for i := range r.shards {
		r.shards[i].links = map[int64]*pending{}
		r.shards[i].counters = map[int64]weak.Pointer[atomic.Int64]{}
	}
	return r
}

// Record counts one click on link id from referrer host ref ("" if direct).
func (r *Recorder) Record(id int64, ref string, now time.Time) {
	day := r.Day(now)
	ms := now.UnixMilli()
	s := &r.shards[uint64(id)%shardCount]
	s.mu.Lock()
	p := s.links[id]
	if p == nil {
		p = &pending{days: make(map[int32]int64, 1), refs: make(map[string]int64, 2)}
		p.counter = s.counters[id].Value()
		s.links[id] = p
	}
	p.total++
	if ms > p.last {
		p.last = ms
	}
	p.days[day]++
	p.addRef(ref, 1)
	s.mu.Unlock()
}

// Snapshot prevents a flush between reading the stored and pending totals.
// Cached redirects and Record never take this lock.
func (r *Recorder) Snapshot() func() {
	r.flushMu.RLock()
	return r.flushMu.RUnlock
}

// Counter is called inside Snapshot, after reading stored from the database.
// Cache replacements share a counter with requests still using the old entry.
// Weak references let cache eviction release it once its pending batch is stored.
func (r *Recorder) Counter(id, stored int64) *atomic.Int64 {
	s := &r.shards[uint64(id)%shardCount]
	s.mu.Lock()
	defer s.mu.Unlock()
	if c := s.counters[id].Value(); c != nil {
		return c
	}
	// Avoid the tiny allocator: a batched 8-byte object can stay alive with
	// its neighbours, which would retain otherwise dead weak-map entries.
	box := new(struct {
		value atomic.Int64
		_     [8]byte
	})
	c := &box.value
	if p := s.links[id]; p != nil {
		stored += min(p.total, math.MaxInt64-stored)
		p.counter = c
	}
	c.Store(stored)
	w := weak.Make(c)
	s.counters[id] = w
	runtime.AddCleanup(c, func(w weak.Pointer[atomic.Int64]) {
		s.mu.Lock()
		if s.counters[id] == w {
			delete(s.counters, id)
		}
		s.mu.Unlock()
	}, w)
	return c
}

// Total returns one live total, or the database snapshot if the link is cold.
// Never add a pending batch to a database row read at a different instant.
func (r *Recorder) Total(id, stored int64) int64 {
	s := &r.shards[uint64(id)%shardCount]
	s.mu.Lock()
	defer s.mu.Unlock()
	if c := s.counters[id].Value(); c != nil {
		return max(stored, c.Load())
	}
	return stored
}

// Pending returns clicks on id that are not yet in the store. Call within
// Snapshot when combining this with a database read.
func (r *Recorder) Pending(id int64) int64 {
	s := &r.shards[uint64(id)%shardCount]
	s.mu.Lock()
	var n int64
	if p := s.links[id]; p != nil {
		n = p.total
	}
	s.mu.Unlock()
	return n
}

// Flush writes everything recorded so far. On failure the clicks are put
// back and retried by the next flush.
func (r *Recorder) Flush(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	select {
	case r.flushSlot <- struct{}{}:
		defer func() { <-r.flushSlot }()
	case <-ctx.Done():
		return ctx.Err()
	}
	r.flushMu.Lock()
	defer r.flushMu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}

	taken := make([]map[int64]*pending, 0, shardCount)
	for i := range r.shards {
		s := &r.shards[i]
		s.mu.Lock()
		if len(s.links) > 0 {
			taken = append(taken, s.links)
			s.links = map[int64]*pending{}
		}
		s.mu.Unlock()
	}
	if len(taken) == 0 {
		return nil
	}

	b := &store.ClickBatch{
		Links: map[int64]store.LinkDelta{},
		Days:  map[store.DayKey]int64{},
		Refs:  map[store.RefKey]int64{},
	}
	for _, m := range taken {
		for id, p := range m {
			b.Links[id] = store.LinkDelta{Count: p.total, Last: p.last}
			for d, n := range p.days {
				b.Days[store.DayKey{LinkID: id, Day: d}] += n
			}
			for h, n := range p.refs {
				b.Refs[store.RefKey{LinkID: id, Host: h}] += n
			}
		}
	}
	err := r.sink.ApplyClicks(ctx, b)
	if err != nil {
		for _, m := range taken {
			r.restore(m)
		}
	}
	return err
}

func (r *Recorder) restore(m map[int64]*pending) {
	for id, p := range m {
		s := &r.shards[uint64(id)%shardCount]
		s.mu.Lock()
		cur := s.links[id]
		if cur == nil {
			s.links[id] = p
		} else {
			cur.total += p.total
			cur.last = max(cur.last, p.last)
			for d, n := range p.days {
				cur.days[d] += n
			}
			for h, n := range p.refs {
				cur.addRef(h, n)
			}
		}
		s.mu.Unlock()
	}
}

func (p *pending) addRef(host string, n int64) {
	if _, known := p.refs[host]; !known && len(p.refs) >= maxPendingRefs {
		host = OtherReferrer
	}
	p.refs[host] += n
}

// Run flushes every interval until ctx is done. The final flush is left to
// the caller, after the HTTP server has stopped accepting clicks.
func (r *Recorder) Run(ctx context.Context, interval time.Duration, log *slog.Logger) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := r.Flush(ctx); err != nil && ctx.Err() == nil {
				log.Error("flush clicks", "err", err)
			}
		}
	}
}

type dayWindow struct {
	day        int32
	start, end int64 // unix seconds, [start, end)
}

// Day maps an instant to its calendar day number in the recorder's zone.
func (r *Recorder) Day(t time.Time) int32 {
	sec := t.Unix()
	if w := r.window.Load(); w != nil && sec >= w.start && sec < w.end {
		return w.day
	}
	day, start, end := DayBounds(t, r.loc)
	r.window.Store(&dayWindow{day: day, start: start.Unix(), end: end.Unix()})
	return day
}

// Location returns the time zone days are counted in.
func (r *Recorder) Location() *time.Location { return r.loc }

// DayBounds returns the day number of t in loc and that day's start and end.
func DayBounds(t time.Time, loc *time.Location) (day int32, start, end time.Time) {
	y, m, d := t.In(loc).Date()
	start = time.Date(y, m, d, 0, 0, 0, 0, loc)
	end = time.Date(y, m, d+1, 0, 0, 0, 0, loc)
	day = int32(time.Date(y, m, d, 0, 0, 0, 0, time.UTC).Unix() / 86400)
	return day, start, end
}

// DayDate returns the calendar date of a day number as YYYY-MM-DD.
func DayDate(day int32) string {
	return time.Unix(int64(day)*86400, 0).UTC().Format(time.DateOnly)
}
