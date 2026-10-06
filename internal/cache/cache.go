// Package cache keeps redirect targets in memory so that resolving a short
// link normally costs one map lookup under a read lock.
//
// Hits and misses are cached separately: a scan for random slugs fills the
// bounded miss set without evicting real links. Concurrent misses for the
// same key share one load, and a load that raced with a write is returned
// but not cached.
package cache

import (
	"context"
	"sync"
	"sync/atomic"
	"time"
)

const shardCount = 64

// Entry is an immutable redirect target plus a live click counter used to
// enforce click limits.
type Entry struct {
	ID        int64
	Location  string // value for the Location header
	Code      int
	Enabled   bool
	Kind      uint8 // 0 redirects; other kinds share content and have no Location
	ExpiresAt int64 // unix ms, 0 = never
	MaxClicks int64 // 0 = unlimited
	Clicks    *atomic.Int64
}

// LoadFunc fetches the entry for a key; it returns (nil, nil) when the key
// does not exist.
type LoadFunc func(ctx context.Context, key string) (*Entry, error)

type shard struct {
	mu   sync.RWMutex
	hits map[string]*Entry
	miss map[string]struct{}
}

type call struct {
	done chan struct{}
	e    *Entry
	err  error
}

type Cache struct {
	shards  [shardCount]shard
	hitCap  int
	missCap int
	epoch   atomic.Uint64
	load    LoadFunc

	flightMu sync.Mutex
	flight   map[string]*call
}

// New creates a cache holding up to size targets and size/4 known misses.
func New(size int, load LoadFunc) *Cache {
	size = max(size, shardCount)
	c := &Cache{
		hitCap:  max(1, size/shardCount),
		missCap: max(1, size/4/shardCount),
		load:    load,
		flight:  map[string]*call{},
	}
	for i := range c.shards {
		c.shards[i].hits = map[string]*Entry{}
		c.shards[i].miss = map[string]struct{}{}
	}
	return c
}

func (c *Cache) shard(key string) *shard {
	// FNV-1a, inlined to stay allocation-free.
	h := uint32(2166136261)
	for i := 0; i < len(key); i++ {
		h ^= uint32(key[i])
		h *= 16777619
	}
	return &c.shards[h%shardCount]
}

// Get returns the entry for key, or nil if no such link exists.
func (c *Cache) Get(ctx context.Context, key string) (*Entry, error) {
	s := c.shard(key)
	s.mu.RLock()
	e, hit := s.hits[key]
	_, miss := s.miss[key]
	s.mu.RUnlock()
	if hit {
		return e, nil
	}
	if miss {
		return nil, nil
	}
	return c.fill(ctx, s, key)
}

func (c *Cache) fill(ctx context.Context, s *shard, key string) (*Entry, error) {
	c.flightMu.Lock()
	if f, ok := c.flight[key]; ok {
		c.flightMu.Unlock()
		select {
		case <-f.done:
			return f.e, f.err
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	f := &call{done: make(chan struct{})}
	c.flight[key] = f
	c.flightMu.Unlock()

	// The load is shared by every waiter, so it must not die with the
	// request that happened to start it.
	epoch := c.epoch.Load()
	lctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	f.e, f.err = c.load(lctx, key)
	cancel()

	if f.err == nil {
		s.mu.Lock()
		// An invalidation since the load began may concern this very key;
		// the result is still correct for this request but not cacheable.
		if c.epoch.Load() == epoch {
			if f.e != nil {
				evictOne(s.hits, c.hitCap)
				s.hits[key] = f.e
			} else {
				evictOne(s.miss, c.missCap)
				s.miss[key] = struct{}{}
			}
		}
		s.mu.Unlock()
	}

	c.flightMu.Lock()
	delete(c.flight, key)
	c.flightMu.Unlock()
	close(f.done)
	return f.e, f.err
}

// evictOne makes room for one more entry. Go randomizes map iteration, so
// this drops an arbitrary entry: cheap, and fair enough for a cache whose
// working set normally fits.
func evictOne[V any](m map[string]V, limit int) {
	if len(m) < limit {
		return
	}
	for k := range m {
		delete(m, k)
		return
	}
}

// Invalidate drops cached state for keys after their links changed.
func (c *Cache) Invalidate(keys ...string) {
	for _, key := range keys {
		s := c.shard(key)
		s.mu.Lock()
		c.epoch.Add(1)
		delete(s.hits, key)
		delete(s.miss, key)
		s.mu.Unlock()
	}
}

// Len reports the number of cached targets and misses.
func (c *Cache) Len() (hits, misses int) {
	for i := range c.shards {
		s := &c.shards[i]
		s.mu.RLock()
		hits += len(s.hits)
		misses += len(s.miss)
		s.mu.RUnlock()
	}
	return hits, misses
}
