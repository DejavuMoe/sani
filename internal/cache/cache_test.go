package cache

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestHitMissInvalidate(t *testing.T) {
	var loads atomic.Int32
	db := map[string]string{"a": "https://a.example"}
	var mu sync.Mutex
	c := New(1000, func(ctx context.Context, key string) (*Entry, error) {
		loads.Add(1)
		mu.Lock()
		defer mu.Unlock()
		if u, ok := db[key]; ok {
			return &Entry{Location: u, Code: 302, Enabled: true}, nil
		}
		return nil, nil
	})
	ctx := context.Background()

	for range 3 {
		e, err := c.Get(ctx, "a")
		if err != nil || e == nil || e.Location != "https://a.example" {
			t.Fatalf("Get(a) = %+v, %v", e, err)
		}
	}
	for range 3 {
		if e, _ := c.Get(ctx, "b"); e != nil {
			t.Fatal("Get(b) should miss")
		}
	}
	if n := loads.Load(); n != 2 {
		t.Fatalf("%d loads, want one per key", n)
	}

	mu.Lock()
	db["b"] = "https://b.example"
	mu.Unlock()
	c.Invalidate("b")
	if e, _ := c.Get(ctx, "b"); e == nil || e.Location != "https://b.example" {
		t.Fatal("a created link must be visible after invalidation")
	}
}

func TestConcurrentMissesShareOneLoad(t *testing.T) {
	var loads atomic.Int32
	release := make(chan struct{})
	c := New(1000, func(ctx context.Context, key string) (*Entry, error) {
		loads.Add(1)
		<-release
		return &Entry{Location: key}, nil
	})
	var wg sync.WaitGroup
	for range 50 {
		wg.Go(func() {
			if e, err := c.Get(context.Background(), "k"); err != nil || e.Location != "k" {
				t.Errorf("Get = %+v, %v", e, err)
			}
		})
	}
	time.Sleep(20 * time.Millisecond)
	close(release)
	wg.Wait()
	if n := loads.Load(); n != 1 {
		t.Fatalf("%d loads for one key, want 1", n)
	}
}

// A load that started before a write must not cache what it read.
func TestLoadRacingWriteIsNotCached(t *testing.T) {
	started, finish := make(chan struct{}), make(chan struct{})
	var version atomic.Int32
	c := New(1000, func(ctx context.Context, key string) (*Entry, error) {
		v := version.Load()
		if v == 0 {
			close(started)
			<-finish
		}
		return &Entry{Location: fmt.Sprint("v", v)}, nil
	})
	done := make(chan *Entry)
	go func() {
		e, _ := c.Get(context.Background(), "k")
		done <- e
	}()
	<-started
	version.Store(1)  // the write commits...
	c.Invalidate("k") // ...and invalidates while the stale load is in flight
	close(finish)
	if e := <-done; e.Location != "v0" {
		t.Fatalf("in-flight request got %q", e.Location)
	}
	if e, _ := c.Get(context.Background(), "k"); e.Location != "v1" {
		t.Fatalf("stale entry was cached: %q", e.Location)
	}
}

func TestBounded(t *testing.T) {
	c := New(shardCount*2, func(ctx context.Context, key string) (*Entry, error) {
		return &Entry{Location: key}, nil
	})
	for i := range 10000 {
		c.Get(context.Background(), fmt.Sprint(i))
	}
	if hits, _ := c.Len(); hits > shardCount*2 {
		t.Fatalf("cache holds %d entries, bound is %d", hits, shardCount*2)
	}
}

func BenchmarkGetHit(b *testing.B) {
	c := New(1000, func(ctx context.Context, key string) (*Entry, error) {
		return &Entry{Location: "https://example.com"}, nil
	})
	ctx := context.Background()
	c.Get(ctx, "hello")
	b.ReportAllocs()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			c.Get(ctx, "hello")
		}
	})
}
