// Package clicks aggregates redirects in memory and writes them to the store
// in periodic batches, so counting a click never waits on the database.
package clicks

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

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
	total int64
	last  int64
	days  map[int32]int64
	refs  map[string]int64
}

type shard struct {
	mu    sync.Mutex
	links map[int64]*pending
}

type Recorder struct {
	shards [shardCount]shard
	sink   Sink
	loc    *time.Location
	window atomic.Pointer[dayWindow]

	flushMu sync.Mutex // one flush at a time

	inflightMu sync.RWMutex
	inflight   map[int64]int64 // totals taken out of the shards but not yet stored
}

func New(sink Sink, loc *time.Location) *Recorder {
	r := &Recorder{sink: sink, loc: loc}
	for i := range r.shards {
		r.shards[i].links = map[int64]*pending{}
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
		s.links[id] = p
	}
	p.total++
	if ms > p.last {
		p.last = ms
	}
	p.days[day]++
	if _, known := p.refs[ref]; !known && len(p.refs) >= maxPendingRefs {
		ref = OtherReferrer
	}
	p.refs[ref]++
	s.mu.Unlock()
}

// Pending returns clicks on id that are not yet in the store.
func (r *Recorder) Pending(id int64) int64 {
	s := &r.shards[uint64(id)%shardCount]
	s.mu.Lock()
	var n int64
	if p := s.links[id]; p != nil {
		n = p.total
	}
	s.mu.Unlock()
	r.inflightMu.RLock()
	n += r.inflight[id]
	r.inflightMu.RUnlock()
	return n
}

// Flush writes everything recorded so far. On failure the clicks are put
// back and retried by the next flush.
func (r *Recorder) Flush(ctx context.Context) error {
	r.flushMu.Lock()
	defer r.flushMu.Unlock()

	taken := make([]map[int64]*pending, 0, shardCount)
	inflight := map[int64]int64{}
	r.inflightMu.Lock()
	for i := range r.shards {
		s := &r.shards[i]
		s.mu.Lock()
		if len(s.links) > 0 {
			taken = append(taken, s.links)
			for id, p := range s.links {
				inflight[id] += p.total
			}
			s.links = map[int64]*pending{}
		}
		s.mu.Unlock()
	}
	r.inflight = inflight
	r.inflightMu.Unlock()
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
	r.inflightMu.Lock()
	r.inflight = nil
	r.inflightMu.Unlock()
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
				cur.refs[h] += n
			}
		}
		s.mu.Unlock()
	}
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
