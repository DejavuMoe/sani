// Command capacity measures the real store and redirect handler on disposable
// databases. It never contacts a running instance or follows redirect targets.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing/fstest"
	"time"

	"github.com/DejavuMoe/sani/internal/clicks"
	"github.com/DejavuMoe/sani/internal/meta"
	"github.com/DejavuMoe/sani/internal/server"
	"github.com/DejavuMoe/sani/internal/store"
)

type measurement struct {
	Name        string  `json:"name"`
	Samples     int     `json:"samples"`
	P50         float64 `json:"p50_ms"`
	P95         float64 `json:"p95_ms"`
	P99         float64 `json:"p99_ms"`
	ReadWaits   int64   `json:"read_waits"`
	WriteWaits  int64   `json:"write_waits"`
	ReadWaitMS  float64 `json:"read_wait_ms"`
	WriteWaitMS float64 `json:"write_wait_ms"`
	WALBytes    int64   `json:"wal_bytes"`
}

type dataset struct {
	Links        int           `json:"links"`
	ImportMS     float64       `json:"import_ms"`
	PeakRSSKB    int64         `json:"peak_rss_kib"`
	Busy         int           `json:"sqlite_busy"`
	Redirects    int64         `json:"recorded_clicks"`
	StoredClicks int64         `json:"stored_clicks"`
	Runs         []measurement `json:"runs"`
}

func main() {
	sizes := flag.String("sizes", "1000,10000,100000", "comma-separated link counts")
	samples := flag.Int("samples", 200, "samples per workload (at least 100 for tail percentiles)")
	workers := flag.Int("workers", 8, "mixed workload concurrency")
	flag.Parse()
	if *samples < 100 || *workers < 2 || *workers > 64 {
		panic("samples >= 100; workers between 2 and 64")
	}
	results := []dataset{}
	for _, raw := range strings.Split(*sizes, ",") {
		n, err := strconv.Atoi(raw)
		if err != nil || n < *samples || n > 100000 {
			panic("size must be between samples and 100000")
		}
		fmt.Fprintf(os.Stderr, "capacity: %d links\n", n)
		d, err := run(n, *samples, *workers)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		results = append(results, d)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(struct {
		At       string    `json:"at"`
		Go       string    `json:"go"`
		OS       string    `json:"os"`
		CPUs     int       `json:"cpus"`
		Workers  int       `json:"workers"`
		Datasets []dataset `json:"datasets"`
	}{time.Now().UTC().Format(time.RFC3339), runtime.Version(), runtime.GOOS, runtime.GOMAXPROCS(0), *workers, results}); err != nil {
		panic(err)
	}
}

func run(n, samples, workers int) (result dataset, err error) {
	dir, err := os.MkdirTemp("", "sani-capacity-")
	if err != nil {
		return result, err
	}
	defer os.RemoveAll(dir)
	ctx := context.Background()
	path := filepath.Join(dir, "sani.db")
	st, err := store.Open(ctx, path)
	if err != nil {
		return result, err
	}
	defer st.Close()
	result.Links = n
	var peak atomic.Int64
	stopRSS := make(chan struct{})
	rssDone := make(chan struct{})
	go func() {
		defer close(rssDone)
		tick := time.NewTicker(10 * time.Millisecond)
		defer tick.Stop()
		for {
			select {
			case <-stopRSS:
				return
			case <-tick.C:
				b, _ := os.ReadFile("/proc/self/status")
				for _, line := range strings.Split(string(b), "\n") {
					if strings.HasPrefix(line, "VmRSS:") {
						fields := strings.Fields(line)
						v, _ := strconv.ParseInt(fields[1], 10, 64)
						if v > peak.Load() {
							peak.Store(v)
						}
					}
				}
			}
		}
	}()
	defer func() { close(stopRSS); <-rssDone; result.PeakRSSKB = peak.Load() }()
	items := make([]*store.Link, n)
	for i := range items {
		items[i] = &store.Link{Slug: fmt.Sprintf("link-%06d", i), URL: fmt.Sprintf("https://example.com/%d", i), Host: "example.com", Title: fmt.Sprintf("Reference %06d", i), Enabled: true, Redirect: 302, CreatedAt: int64(i + 1), UpdatedAt: int64(i + 1)}
	}
	start := time.Now()
	imported, err := st.ImportLinks(ctx, items, func() string { panic("explicit slugs") })
	if err != nil {
		return result, err
	}
	result.ImportMS = float64(time.Since(start).Microseconds()) / 1000
	if len(imported.Created) != n {
		return result, fmt.Errorf("imported %d of %d", len(imported.Created), n)
	}
	ids := make([]int64, samples)
	for i := range ids {
		ids[i] = items[i].ID
	}
	items = nil
	imported = nil
	runtime.GC()

	rec := clicks.New(st, time.UTC)
	srv, err := server.New(server.Options{CacheSize: 64}, st, rec, meta.New(), fstest.MapFS{"index.html": {Data: []byte("<!doctype html><title>Sani</title>")}}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		return result, err
	}
	defer srv.Shutdown(ctx)
	measure := func(name string, count int, work func(int) error) error {
		r0, w0 := st.PoolStats()
		times := make([]time.Duration, count)
		for i := range times {
			t := time.Now()
			e := work(i)
			times[i] = time.Since(t)
			if e != nil {
				return e
			}
		}
		r1, w1 := st.PoolStats()
		result.Runs = append(result.Runs, summary(name, times, r0, w0, r1, w1, path))
		return nil
	}
	for _, q := range []struct {
		name string
		q    store.ListQuery
	}{
		{"list", store.ListQuery{Limit: 50}},
		{"search", store.ListQuery{Limit: 50, Search: "Reference 000"}},
		{"click-sort", store.ListQuery{Limit: 50, Sort: "clicks"}},
	} {
		if err := measure(q.name, samples, func(int) error { _, e := st.ListLinks(ctx, q.q); return e }); err != nil {
			return result, err
		}
	}
	if err := measure("cold-redirect", samples, func(i int) error {
		r := httptest.NewRequest("GET", fmt.Sprintf("http://localhost/link-%06d", i), nil)
		r.Header.Set("User-Agent", "Mozilla/5.0")
		w := httptest.NewRecorder()
		srv.ServeHTTP(w, r)
		if w.Code != 302 {
			return fmt.Errorf("cold redirect: %d", w.Code)
		}
		result.Redirects++
		return nil
	}); err != nil {
		return result, err
	}
	// Vary batch membership as well as click volume; hot-slug load alone
	// cannot reveal the cost of updating hundreds of links in one flush.
	if err := measure("flush", samples, func(i int) error {
		for _, id := range ids {
			rec.Record(id, "example.com", time.Now())
			result.Redirects++
		}
		return rec.Flush(ctx)
	}); err != nil {
		return result, err
	}
	r0, w0 := st.PoolStats()
	times := make([]time.Duration, samples*workers)
	failures := make(chan error, len(times))
	var wg sync.WaitGroup
	for worker := range workers {
		wg.Go(func() {
			for i := range samples {
				t := time.Now()
				var e error
				if worker%4 == 0 {
					l := &store.Link{Slug: fmt.Sprintf("mixed-%d-%d", worker, i), URL: "https://example.com/mixed", Enabled: true, Redirect: 302, CreatedAt: time.Now().UnixMilli()}
					e = st.CreateLink(ctx, l, false)
				} else {
					_, e = st.ListLinks(ctx, store.ListQuery{Limit: 50})
				}
				times[worker*samples+i] = time.Since(t)
				if e != nil {
					failures <- e
				}
			}
		})
	}
	wg.Wait()
	close(failures)
	for e := range failures {
		var code interface{ Code() int }
		if errors.As(e, &code) && code.Code()&255 == 5 {
			result.Busy++
		}
		if err == nil {
			err = e
		}
	}
	if err != nil {
		return result, err
	}
	r1, w1 := st.PoolStats()
	result.Runs = append(result.Runs, summary("mixed", times, r0, w0, r1, w1, path))
	if err = rec.Flush(ctx); err != nil {
		return result, err
	}
	_, result.StoredClicks, err = st.Totals(ctx)
	if err == nil && result.StoredClicks != result.Redirects {
		err = fmt.Errorf("lost clicks: recorded %d stored %d", result.Redirects, result.StoredClicks)
	}
	return result, err
}

func summary(name string, times []time.Duration, r0, w0, r1, w1 sql.DBStats, path string) measurement {
	slices.Sort(times)
	p := func(percent int) float64 { return float64(times[(len(times)-1)*percent/100].Microseconds()) / 1000 }
	var size int64
	if f, err := os.Stat(path + "-wal"); err == nil {
		size = f.Size()
	}
	return measurement{name, len(times), p(50), p(95), p(99), r1.WaitCount - r0.WaitCount, w1.WaitCount - w0.WaitCount, float64(r1.WaitDuration-r0.WaitDuration) / float64(time.Millisecond), float64(w1.WaitDuration-w0.WaitDuration) / float64(time.Millisecond), size}
}
