package server

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/DejavuMoe/sani/internal/clicks"
	"github.com/DejavuMoe/sani/internal/meta"
	"github.com/DejavuMoe/sani/internal/store"
)

func TestBUG07QueuedMetadataSettlesOnShutdown(t *testing.T) {
	e := newEnv(t, Options{FetchMeta: true})
	ctx := context.Background()
	l := &store.Link{Slug: "queued", URL: "http://1.1.1.1/unused", Meta: store.MetaPending, Redirect: 302, Enabled: true, CreatedAt: 1, UpdatedAt: 1}
	if err := e.srv.store.CreateLink(ctx, l, false); err != nil {
		t.Fatal(err)
	}
	// Occupied slots force the queue-cancel branch without making any network request.
	for range cap(e.srv.jobSlots) {
		e.srv.jobSlots <- struct{}{}
	}
	e.srv.fetchMetaLater(l.ID, l.URL, "", "")
	shutdown, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := e.srv.Shutdown(shutdown); err != nil {
		t.Fatal(err)
	}
	got, err := e.srv.store.GetLink(ctx, l.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Meta != store.MetaFailed {
		t.Errorf("abandoned queued job remains %v; want failed", got.Meta)
	}
	if err := e.srv.store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := store.Open(ctx, e.dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	fresh, err := New(e.srv.opt, reopened, clicks.New(reopened, time.UTC), meta.NewDirect(), testUI, e.srv.log)
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Shutdown(ctx)
	got, err = reopened.GetLink(ctx, l.ID)
	if err != nil || got.Meta != store.MetaFailed {
		t.Fatalf("restarted metadata state = %+v, %v; want failed", got, err)
	}
}

func TestBUG08ExplicitRefreshOwnsSameURLResult(t *testing.T) {
	for _, tt := range []struct {
		name                         string
		olderFirst, queued, editFlag bool
		replace                      string
	}{
		{"older_finishes_first", true, false, false, ""},
		{"newer_finishes_first", false, false, false, ""},
		{"superseded_queued_cleanup", true, true, false, ""},
		{"unrelated_edit_while_pending", true, false, true, ""},
		{"clear_automatic_title", true, false, false, "clear"},
		{"URL_A_B_A", true, false, false, "aba"},
		{"manual_title_while_fetching", true, false, false, "manual"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			arrived := []chan struct{}{make(chan struct{}), make(chan struct{})}
			release := []chan struct{}{make(chan struct{}), make(chan struct{})}
			var once [2]sync.Once
			unblock := func(i int) { once[i].Do(func() { close(release[i]) }) }
			proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodConnect || r.Host != "1.1.1.1:80" {
					t.Errorf("unexpected proxy request: %s %s", r.Method, r.Host)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				conn, rw, err := w.(http.Hijacker).Hijack()
				if err != nil {
					t.Error(err)
					return
				}
				defer conn.Close()
				conn.SetDeadline(time.Now().Add(10 * time.Second))
				rw.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n")
				rw.Flush()
				req, err := http.ReadRequest(bufio.NewReader(conn))
				if err != nil {
					return
				}
				req.Body.Close()
				if req.URL.Path != "/page" {
					io.WriteString(conn, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
					return
				}
				i := 0
				if req.Header.Get("Accept-Language") == "new" {
					i = 1
				} else if req.Header.Get("Accept-Language") != "old" || tt.queued {
					t.Error("unexpected page request or canceled queued task reached proxy")
					return
				}
				close(arrived[i])
				select {
				case <-release[i]:
				case <-time.After(10 * time.Second):
					return
				}
				body := []string{"<title>Old title</title>", "<title>New title</title>"}[i]
				fmt.Fprintf(conn, "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s", len(body), body)
			}))
			t.Cleanup(proxy.Close)
			e := newEnv(t, Options{FetchMeta: true, MetaProxy: proxy.URL})
			e.signIn()
			if tt.queued {
				for range cap(e.srv.jobSlots) {
					e.srv.jobSlots <- struct{}{}
				}
			}
			var refreshed sync.WaitGroup
			t.Cleanup(func() {
				unblock(0)
				unblock(1)
				refreshed.Wait()
			})
			wait := func(done <-chan struct{}, what string) {
				t.Helper()
				select {
				case <-done:
				case <-time.After(5 * time.Second):
					t.Fatalf("timed out waiting for %s", what)
				}
			}
			created := e.req("POST", "/api/admin/v1/links", `{"slug":"overlap","url":"http://1.1.1.1/page"}`, "Accept-Language", "old")
			if created.status != http.StatusCreated {
				t.Fatalf("create: %d %s", created.status, created.body)
			}
			var l linkDTO
			if err := json.Unmarshal(created.body, &l); err != nil {
				t.Fatal(err)
			}
			if !tt.queued {
				wait(arrived[0], "old automatic page")
			}
			r := httptest.NewRequest("POST", fmt.Sprintf("/api/admin/v1/links/%d/refresh", l.ID), nil)
			r.SetPathValue("id", fmt.Sprint(l.ID))
			r.Header.Set("Accept-Language", "new")
			w := httptest.NewRecorder()
			done := make(chan struct{})
			if tt.replace == "" || tt.replace == "manual" {
				refreshed.Add(1)
				go func() {
					defer refreshed.Done()
					defer close(done)
					e.srv.refreshLink(w, r)
				}()
			} else {
				endpoint := fmt.Sprintf("/api/admin/v1/links/%d", l.ID)
				body := `{"title":""}`
				if tt.replace == "aba" {
					interim := e.req("PATCH", endpoint, `{"url":"http://1.1.1.1/other","title":"temporary manual"}`)
					if interim.status != http.StatusOK {
						t.Fatalf("intermediate URL edit: %d %s", interim.status, interim.body)
					}
					body = `{"url":"http://1.1.1.1/page","title":""}`
				}
				replacement := e.req("PATCH", endpoint, body, "Accept-Language", "new")
				if replacement.status != http.StatusOK {
					t.Fatalf("replacement edit: %d %s", replacement.status, replacement.body)
				}
				go func() { e.srv.jobs.Wait(); close(done) }()
			}
			wait(arrived[1], "new explicit page after RefreshMeta")
			wantTitle, wantMeta := "New title", store.MetaOK
			if tt.replace == "manual" {
				wantTitle, wantMeta = "Keep manual", store.MetaManual
				r := e.req("PATCH", fmt.Sprintf("/api/admin/v1/links/%d", l.ID), `{"title":"Keep manual"}`)
				if r.status != http.StatusOK {
					t.Fatalf("manual title edit: %d %s", r.status, r.body)
				}
			}
			if tt.editFlag {
				r := e.req("PATCH", fmt.Sprintf("/api/admin/v1/links/%d", l.ID), `{"enabled":false}`)
				if r.status != http.StatusOK {
					t.Fatalf("unrelated edit: %d %s", r.status, r.body)
				}
			}
			oldDone := make(chan struct{})
			if tt.replace == "" || tt.replace == "manual" {
				go func() { e.srv.jobs.Wait(); close(oldDone) }()
			} else {
				// The replacement owns one occupied slot; the older worker releases the other.
				go func() {
					deadline := time.Now().Add(5 * time.Second)
					for len(e.srv.jobSlots) > 1 && time.Now().Before(deadline) {
						time.Sleep(time.Millisecond)
					}
					if len(e.srv.jobSlots) <= 1 {
						close(oldDone)
					}
				}()
			}
			if tt.olderFirst {
				unblock(0)
				wait(oldDone, "old automatic completion")
				got, err := e.srv.store.GetLink(context.Background(), l.ID)
				if err != nil {
					t.Fatal(err)
				}
				if tt.replace != "manual" && (got.Meta != store.MetaPending || got.Title != "") {
					t.Errorf("old completion consumed newer pending state: %+v", got)
				}
				unblock(1)
				wait(done, "explicit refresh completion")
			} else {
				unblock(1)
				wait(done, "explicit refresh completion")
				unblock(0)
				wait(oldDone, "old automatic completion")
			}
			if tt.replace == "" || tt.replace == "manual" {
				var response linkDTO
				if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
					t.Fatal(err)
				}
				if w.Code != http.StatusOK || response.Title != wantTitle || response.Meta != metaNames[wantMeta] {
					t.Errorf("refresh response: %d %s", w.Code, w.Body.String())
				}
			}
			got, err := e.srv.store.GetLink(context.Background(), l.ID)
			if err != nil || got.Title != wantTitle || got.Meta != wantMeta {
				t.Errorf("stored result = %+v, %v; want title %q, state %v", got, err, wantTitle, wantMeta)
			}
		})
	}
}

func TestBUG07MetadataQueueIsBounded(t *testing.T) {
	e := newEnv(t, Options{FetchMeta: true})
	ctx := context.Background()
	for range cap(e.srv.jobSlots) {
		e.srv.jobSlots <- struct{}{}
	}
	var ids []int64
	for i := range 1025 {
		l := &store.Link{Slug: fmt.Sprintf("queued-%d", i), URL: "http://1.1.1.1/unused", Meta: store.MetaPending, Redirect: 302, Enabled: true, CreatedAt: 1, UpdatedAt: 1}
		if err := e.srv.store.CreateLink(ctx, l, false); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, l.ID)
		e.srv.fetchMetaLater(l.ID, l.URL, "", "")
	}
	overflow, err := e.srv.store.GetLink(ctx, ids[len(ids)-1])
	if err != nil || overflow.Meta != store.MetaFailed {
		t.Errorf("queue overflow must be retryable failed: %+v, %v", overflow, err)
	}
	shutdown, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := e.srv.Shutdown(shutdown); err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		l, err := e.srv.store.GetLink(ctx, id)
		if err != nil || l.Meta != store.MetaFailed {
			t.Fatalf("shutdown left pending work: %+v, %v", l, err)
		}
	}
}

func TestBUG07DeletedBeforeScheduling(t *testing.T) {
	for _, reclaim := range []bool{false, true} {
		t.Run(fmt.Sprintf("reclaim_%t", reclaim), func(t *testing.T) {
			e := newEnv(t, Options{FetchMeta: true})
			ctx := context.Background()
			l := &store.Link{Slug: "deleted-queue", URL: "http://1.1.1.1/unused", Redirect: 302, Enabled: true, CreatedAt: 1, UpdatedAt: 1}
			if err := e.srv.store.CreateLink(ctx, l, false); err != nil {
				t.Fatal(err)
			}
			if _, err := e.srv.store.DeleteLink(ctx, l.ID, 2); err != nil {
				t.Fatal(err)
			}
			var replacement *store.Link
			if reclaim {
				replacement = &store.Link{Slug: l.Slug, URL: l.URL, Title: "Replacement manual", Meta: store.MetaManual, Redirect: 302, Enabled: true, CreatedAt: 3, UpdatedAt: 3}
				if err := e.srv.store.CreateLink(ctx, replacement, true); err != nil {
					t.Fatal(err)
				}
				if replacement.ID == l.ID {
					t.Fatal("reclaimed slug reused the old row identity")
				}
			}
			for range cap(e.srv.jobSlots) {
				e.srv.jobSlots <- struct{}{}
			}
			e.srv.fetchMetaLater(l.ID, l.URL, "", "")
			shutdown, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()
			if err := e.srv.Shutdown(shutdown); err != nil {
				t.Fatal(err)
			}
			if reclaim {
				got, err := e.srv.store.GetLink(ctx, replacement.ID)
				if err != nil || got.Title != replacement.Title || got.Meta != store.MetaManual {
					t.Fatalf("old task modified replacement: %+v, %v", got, err)
				}
			} else {
				got, err := e.srv.store.RestoreLink(ctx, l.ID)
				if err != nil || got.Meta != store.MetaFailed {
					t.Fatalf("undo restored abandoned pending metadata: %+v, %v", got, err)
				}
			}
		})
	}
}

func TestBUG18FailedIconRefreshRetriesAfterOneDay(t *testing.T) {
	for _, force := range []bool{false, true} {
		t.Run(fmt.Sprintf("forced_failure_%t", force), func(t *testing.T) {
			e := newEnv(t, Options{FetchMeta: true})
			ctx := context.Background()
			const host = "icon-fixture.test"
			const old = `<svg xmlns="http://www.w3.org/2000/svg"><title>Old</title></svg>`
			const updated = `<svg xmlns="http://www.w3.org/2000/svg"><title>New</title></svg>`
			f := &store.Favicon{Type: "image/svg+xml", Data: []byte(old), FetchedAt: time.Now().Add(-31 * 24 * time.Hour).UnixMilli()}
			if err := e.srv.store.PutFavicon(ctx, host, f); err != nil {
				t.Fatal(err)
			}
			e.srv.fetchIcon(ctx, host, []string{"data:text/plain,not-an-image"}, force)
			f, err := e.srv.store.Favicon(ctx, host)
			if err != nil || f.Type != "image/svg+xml" || string(f.Data) != old {
				t.Fatalf("failed refresh discarded usable icon: %+v, %v", f, err)
			}
			candidate := []string{"data:image/svg+xml," + url.PathEscape(updated)}
			e.srv.fetchIcon(ctx, host, candidate, false)
			immediate, err := e.srv.store.Favicon(ctx, host)
			if err != nil || string(immediate.Data) != old {
				t.Fatalf("failed refresh was retried before cooldown: %+v, %v", immediate, err)
			}
			// Age the stored deadline by elapsed time instead of replacing its failure freshness.
			f.FetchedAt -= (25 * time.Hour).Milliseconds()
			if err := e.srv.store.PutFavicon(ctx, host, f); err != nil {
				t.Fatal(err)
			}
			e.srv.fetchIcon(ctx, host, candidate, false)
			got, err := e.srv.store.Favicon(ctx, host)
			if err != nil || string(got.Data) != updated {
				t.Errorf("25-hour automatic retry did not replace stale icon: %+v, %v", got, err)
			}
			e.srv.fetchIcon(ctx, host, candidate, true)
			got, err = e.srv.store.Favicon(ctx, host)
			if err != nil || string(got.Data) != updated {
				t.Fatalf("forced refresh control failed: %+v, %v", got, err)
			}
		})
	}
}
