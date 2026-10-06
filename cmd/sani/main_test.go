package main

import (
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/DejavuMoe/sani/internal/clicks"
	"github.com/DejavuMoe/sani/internal/meta"
	"github.com/DejavuMoe/sani/internal/server"
	"github.com/DejavuMoe/sani/internal/store"
)

type stalledHeader struct {
	http.ResponseWriter
	ctx     context.Context
	entered chan struct{}
	release <-chan struct{}
}

func (w *stalledHeader) WriteHeader(status int) {
	close(w.entered)
	select {
	case <-w.release:
	case <-w.ctx.Done():
	}
	w.ResponseWriter.WriteHeader(status)
}

type failingSink struct{}

func (failingSink) ApplyClicks(context.Context, *store.ClickBatch) error {
	return errors.New("disk full")
}

func TestFinishDrainsRequestsAndReportsFailedFlush(t *testing.T) {
	for _, mode := range []string{"normal", "timeout", "write-failure"} {
		t.Run(mode, func(t *testing.T) {
			ctx := context.Background()
			st, err := store.Open(ctx, filepath.Join(t.TempDir(), "sani.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer st.Close()
			l := &store.Link{Slug: "drain", URL: "https://example.com", Enabled: true, Redirect: 302}
			if err := st.CreateLink(ctx, l, true); err != nil {
				t.Fatal(err)
			}
			var sink clicks.Sink = st
			if mode == "write-failure" {
				sink = failingSink{}
			}
			rec := clicks.New(sink, time.UTC)
			srv, err := server.New(server.Options{}, st, rec, meta.New(), fstest.MapFS{
				"index.html": {Data: []byte("<!doctype html><title>Sani</title>")},
			}, slog.New(slog.NewTextHandler(io.Discard, nil)))
			if err != nil {
				t.Fatal(err)
			}
			entered, release := make(chan struct{}), make(chan struct{})
			ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				srv.ServeHTTP(&stalledHeader{w, r.Context(), entered, release}, r)
			}))
			defer ts.Close()
			requestDone := make(chan struct{})
			go func() {
				defer close(requestDone)
				r, _ := http.NewRequest("GET", ts.URL+"/drain", nil)
				r.Header.Set("User-Agent", "Mozilla/5.0")
				client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
				if resp, err := client.Do(r); err == nil {
					resp.Body.Close()
				}
			}()
			<-entered
			graceTime := time.Second
			if mode == "timeout" {
				graceTime = 20 * time.Millisecond
			}
			grace, cancel := context.WithTimeout(ctx, graceTime)
			defer cancel()
			backgroundDone := make(chan struct{})
			close(backgroundDone)
			done := make(chan error, 1)
			go func() { done <- finish(grace, ts.Config, srv, rec, func() {}, backgroundDone) }()
			if mode != "timeout" {
				close(release)
			}
			err = <-done
			<-requestDone
			switch mode {
			case "normal":
				if err != nil {
					t.Fatal(err)
				}
			case "timeout":
				if !errors.Is(err, context.DeadlineExceeded) {
					t.Fatalf("timeout not reported: %v", err)
				}
			case "write-failure":
				if err == nil || !strings.Contains(err.Error(), "final click flush: disk full") {
					t.Fatalf("failure not reported: %v", err)
				}
				if rec.Pending(l.ID) != 1 {
					t.Fatal("failed final batch was lost")
				}
				return
			}
			got, err := st.GetLink(ctx, l.ID)
			if err != nil || got.Clicks != 1 {
				t.Fatalf("final count: %+v, %v", got, err)
			}
		})
	}
}

func TestStoppedBackupRestoresDatabaseAndFileHashes(t *testing.T) {
	ctx := context.Background()
	source, restored := t.TempDir(), t.TempDir()
	files := filepath.Join(source, "files")
	if err := os.Mkdir(files, 0700); err != nil {
		t.Fatal(err)
	}
	data := []byte("snapshot file\n")
	name := strings.Repeat("a", 32)
	sum := sha256.Sum256(data)
	if err := os.WriteFile(filepath.Join(files, name), data, 0600); err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(ctx, filepath.Join(source, "sani.db"))
	if err != nil {
		t.Fatal(err)
	}
	l := &store.Link{Slug: "file", Kind: store.KindFile, Enabled: true, Content: &store.Content{Name: "file.txt", Size: int64(len(data)), SHA256: sum[:], File: name}}
	if err := st.CreateLink(ctx, l, true); err != nil {
		t.Fatal(err)
	}
	rec := clicks.New(st, time.UTC)
	rec.Record(l.ID, "example.com", time.Now())
	if err := rec.Flush(ctx); err != nil {
		t.Fatal(err)
	}
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}
	// This is the documented stopped-service sequence: one database
	// snapshot plus its files, without a concurrent garbage collector.
	if err := store.Backup(ctx, filepath.Join(source, "sani.db"), filepath.Join(restored, "sani.db")); err != nil {
		t.Fatal(err)
	}
	if err := os.CopyFS(filepath.Join(restored, "files"), os.DirFS(files)); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(files, name)); err != nil {
		t.Fatal(err)
	}
	restoredDB, err := store.Open(ctx, filepath.Join(restored, "sani.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer restoredDB.Close()
	got, err := restoredDB.GetLink(ctx, l.ID)
	if err != nil || got.Clicks != 1 {
		t.Fatalf("restored link: %+v %v", got, err)
	}
	bytes, err := os.ReadFile(filepath.Join(restored, "files", got.Content.File))
	if err != nil {
		t.Fatal(err)
	}
	if sha256.Sum256(bytes) != sum {
		t.Fatal("restored file checksum mismatch")
	}
	refs, err := restoredDB.StoredFiles(ctx)
	if err != nil || len(refs) != 1 || !refs[name] {
		t.Fatalf("restored references: %v %v", refs, err)
	}
}
