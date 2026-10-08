package server

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/DejavuMoe/sani/internal/clicks"
	"github.com/DejavuMoe/sani/internal/store"
)

func TestDownloadsChargeOnlyContentResponses(t *testing.T) {
	for _, kind := range []string{"file", "text"} {
		for _, condition := range []string{"suffix", "offset", "invalid", "not-modified", "precondition", "missing"} {
			t.Run(kind+"/"+condition, func(t *testing.T) {
				e := newShareEnv(t, Options{})
				data := "nineteen-byte-file!!"
				var l map[string]any
				if kind == "file" {
					l = e.upload(map[string]string{"slug": "limited", "maxClicks": "1"}, "data.txt", []byte(data)).json()
				} else {
					l = e.req("POST", "/api/texts", map[string]any{"slug": "limited", "text": data, "maxClicks": 1}).json()
				}
				if l["id"] == nil {
					t.Fatalf("create: %v", l)
				}
				head := e.files("HEAD", "/limited")
				headers, want, charged := []string{}, 0, false
				switch condition {
				case "suffix":
					headers, want, charged = []string{"Range", fmt.Sprintf("bytes=-%d", len(data))}, 206, true
				case "offset":
					headers, want, charged = []string{"Range", "bytes=1-"}, 206, true
				case "invalid":
					headers, want = []string{"Range", "bytes=0-invalid"}, 416
				case "not-modified":
					headers, want = []string{"If-Modified-Since", head.header.Get("Last-Modified")}, 304
				case "precondition":
					headers, want = []string{"If-Match", `"not-the-etag"`}, 412
				case "missing":
					if kind != "file" {
						t.Skip("text is stored in SQLite")
					}
					files, err := os.ReadDir(e.srv.opt.FilesDir)
					if err != nil {
						t.Fatal(err)
					}
					if err := os.Remove(filepath.Join(e.srv.opt.FilesDir, files[0].Name())); err != nil {
						t.Fatal(err)
					}
					want = 500
				}
				r := e.files("GET", "/limited", append(headers, "User-Agent", "curl/8.9")...)
				if r.status != want {
					t.Fatalf("response: %d %s, want %d", r.status, r.body, want)
				}
				if got := r.header.Get("Cache-Control"); got != "no-store" {
					t.Errorf("content response %d Cache-Control = %q", r.status, got)
				}
				if condition == "suffix" && string(r.body) != data {
					t.Fatalf("suffix: %q", r.body)
				}
				n := e.clicksOf(l["id"])
				if charged && n != 1 || !charged && n != 0 {
					t.Fatalf("charged %v clicks", n)
				}
				if condition == "missing" {
					return
				}
				want = 200
				if charged {
					want = 410
				}
				if next := e.files("GET", "/limited"); next.status != want {
					t.Fatalf("next: %d, want %d", next.status, want)
				}
			})
		}
	}
}

func TestLimitedRedirectsAreNotCached(t *testing.T) {
	e := newEnv(t, Options{})
	e.signIn()
	for _, code := range []int{301, 302, 307, 308} {
		for _, limit := range []string{"none", "expiry", "visits"} {
			slug := fmt.Sprintf("cache-%d-%s", code, limit)
			input := map[string]any{"slug": slug, "url": "https://example.com/target", "redirect": code}
			want := "no-store"
			switch limit {
			case "expiry":
				input["expiresAt"] = time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
			case "visits":
				input["maxClicks"] = 1
			default:
				want = "private, max-age=0"
				if code == 301 || code == 308 {
					want = "public, max-age=86400"
				}
			}
			e.create(input)
			r := e.visit("/" + slug)
			if r.status != code || r.header.Get("Cache-Control") != want {
				t.Errorf("%s: status=%d Cache-Control=%q, want %d %q", slug, r.status, r.header.Get("Cache-Control"), code, want)
			}
			if limit == "visits" {
				r = e.visit("/" + slug)
				if r.status != http.StatusGone || r.header.Get("Cache-Control") != "no-store" {
					t.Errorf("exhausted %s: %d %q", slug, r.status, r.header.Get("Cache-Control"))
				}
			}
		}
	}
}

func TestReclaimedLinkCannotInheritPendingClicks(t *testing.T) {
	e := newEnv(t, Options{})
	e.signIn()
	old := e.create(map[string]any{"slug": "reclaimed", "url": "https://example.com/old"})
	for range 5 {
		e.visit("/reclaimed")
	}
	if r := e.req("DELETE", fmt.Sprintf("/api/links/%v", old["id"]), nil); r.status != 204 {
		t.Fatal(r.status)
	}
	next := e.create(map[string]any{"slug": "reclaimed", "url": "https://example.com/new", "maxClicks": 1})
	if next["id"] == old["id"] || next["clicks"] != float64(0) {
		t.Fatalf("old=%v new=%v", old, next)
	}
	if r := e.visit("/reclaimed"); r.status != 302 {
		t.Fatal(r.status)
	}
	if n := e.clicksOf(next["id"]); n != 1 {
		t.Fatal(n)
	}
}

type pausedCommit struct {
	*store.Store
	committed, release chan struct{}
}

func (s *pausedCommit) ApplyClicks(ctx context.Context, b *store.ClickBatch) error {
	if err := s.Store.ApplyClicks(ctx, b); err != nil {
		return err
	}
	close(s.committed)
	<-s.release
	return nil
}

func TestCountDuringCommittedFlushAndCacheReplacement(t *testing.T) {
	e := newEnv(t, Options{})
	sk := &pausedCommit{Store: e.srv.store, committed: make(chan struct{}), release: make(chan struct{})}
	e.srv.clicks = clicks.New(sk, time.UTC)
	e.signIn()
	l := e.create(map[string]any{"slug": "twice", "url": "https://example.com", "maxClicks": 2})
	e.visit("/twice")
	flushed := make(chan error, 1)
	go func() { flushed <- e.srv.clicks.Flush(context.Background()) }()
	<-sk.committed
	var once sync.Once
	release := func() { once.Do(func() { close(sk.release) }) }
	defer release()
	got := e.req("GET", fmt.Sprintf("/api/links/%v", l["id"]), nil).json()
	if got["clicks"] != float64(1) {
		t.Fatalf("committed batch counted twice: %v", got)
	}
	// A hot request must finish even while the sink is stalled after commit.
	if r := e.visit("/twice"); r.status != 302 {
		t.Fatalf("hot redirect: %d", r.status)
	}
	release()
	if err := <-flushed; err != nil {
		t.Fatal(err)
	}
	e.srv.cache.Invalidate("twice")
	if r := e.visit("/twice"); r.status != 410 {
		t.Fatalf("reloaded exhausted link: %d", r.status)
	}
}

func TestOldAndReplacementEntriesShareLimit(t *testing.T) {
	e := newEnv(t, Options{})
	e.signIn()
	l := e.create(map[string]any{"slug": "quota", "url": "https://example.com", "maxClicks": 20})
	old, err := e.srv.cache.Get(context.Background(), "quota")
	if err != nil {
		t.Fatal(err)
	}
	e.srv.cache.Invalidate("quota")
	fresh, err := e.srv.cache.Get(context.Background(), "quota")
	if err != nil {
		t.Fatal(err)
	}
	if old.Clicks != fresh.Clicks {
		t.Fatal("replacement has an independent quota")
	}
	var passed atomic.Int64
	var wg sync.WaitGroup
	for i := range 100 {
		wg.Go(func() {
			entry := old
			if i%2 == 0 {
				entry = fresh
			}
			r := httptest.NewRequest(http.MethodGet, "/quota", nil)
			if e.srv.admit(entry, true, r, time.Now()) {
				passed.Add(1)
			}
		})
	}
	wg.Wait()
	if passed.Load() != 20 {
		t.Fatalf("admitted %d of 20", passed.Load())
	}
	if n := e.clicksOf(l["id"]); n != 20 {
		t.Fatalf("stored %v of 20", n)
	}
}
