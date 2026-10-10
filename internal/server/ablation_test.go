package server

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/DejavuMoe/sani/internal/cache"
	"github.com/DejavuMoe/sani/internal/clicks"
	"github.com/DejavuMoe/sani/internal/meta"
	"github.com/DejavuMoe/sani/internal/store"
)

type ablationSink struct {
	*store.Store
	writes int
}

func (s *ablationSink) ApplyClicks(ctx context.Context, batch *store.ClickBatch) error {
	s.writes++
	return s.Store.ApplyClicks(ctx, batch)
}

// Isolated databases, identical requests. Each ablation removes one benefit:
// evict before lookup, or flush after each click. Neither is a production option.
func BenchmarkAblation(b *testing.B) {
	for _, mode := range []string{"cached-batched", "evict-each", "flush-each"} {
		b.Run(mode, func(b *testing.B) {
			ctx := context.Background()
			st, err := store.Open(ctx, filepath.Join(b.TempDir(), "sani.db"))
			if err != nil {
				b.Fatal(err)
			}
			defer st.Close()
			sink := &ablationSink{Store: st}
			rec := clicks.New(sink, time.UTC)
			s, err := New(Options{CacheSize: 1000}, st, rec, meta.New(), testUI, slog.New(slog.NewTextHandler(io.Discard, nil)))
			if err != nil {
				b.Fatal(err)
			}
			now := time.Now().UnixMilli()
			l := &store.Link{Slug: "bench", URL: "https://example.com/landing", Redirect: 302, Enabled: true, CreatedAt: now, UpdatedAt: now}
			if err := st.CreateLink(ctx, l, true); err != nil {
				b.Fatal(err)
			}
			loads := 0
			s.cache = cache.New(1000, func(ctx context.Context, key string) (*cache.Entry, error) { loads++; return s.loadTarget(ctx, key) })
			if _, err := s.cache.Get(ctx, "bench"); err != nil {
				b.Fatal(err)
			}
			loads = 0
			req := httptest.NewRequest("GET", "/bench", nil)
			req.Header.Set("User-Agent", human)
			req.Header.Set("Referer", "https://example.org/source")
			b.ReportAllocs()
			b.ResetTimer()
			for range b.N {
				if mode == "evict-each" {
					s.cache.Invalidate("bench")
				}
				w := &discardWriter{h: http.Header{}}
				s.ServeHTTP(w, req)
				if w.code != 302 || w.h.Get("Location") != l.URL {
					b.Fatalf("redirect: %d %v", w.code, w.h)
				}
				if mode == "flush-each" {
					if err := rec.Flush(ctx); err != nil {
						b.Fatal(err)
					}
				}
			}
			if err := rec.Flush(ctx); err != nil {
				b.Fatal(err)
			}
			b.StopTimer()
			got, err := st.GetLink(ctx, l.ID)
			if err != nil || got.Clicks != int64(b.N) {
				b.Fatalf("lost clicks: %+v %v; want %d", got, err, b.N)
			}
			if _, count, err := st.Referrers(ctx, l.ID, 8); err != nil || count != int64(b.N) {
				b.Fatalf("referrers: %d %v", count, err)
			}
			if mode == "evict-each" && loads != b.N || mode != "evict-each" && loads != 0 {
				b.Fatalf("unexpected database loads: %d", loads)
			}
			b.ReportMetric(float64(loads)/float64(b.N), "loads/op")
			b.ReportMetric(float64(sink.writes)/float64(b.N), "writes/op")
		})
	}
}
