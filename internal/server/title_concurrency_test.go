package server

import (
	"context"
	"database/sql"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DejavuMoe/sani/internal/store"
)

func TestMetadataChangesKeepConcurrentlySavedManualTitle(t *testing.T) {
	for _, refresh := range []bool{false, true} {
		name := "update"
		if refresh {
			name = "refresh"
		}
		t.Run(name, func(t *testing.T) {
			e := newEnv(t, Options{FetchMeta: refresh})
			e.signIn()
			ctx := context.Background()
			now := time.Now().UnixMilli()
			l := &store.Link{Slug: "manual", URL: "http://127.0.0.1/old", Title: "automatic", Meta: store.MetaOK, Redirect: 302, Enabled: true, CreatedAt: now, UpdatedAt: now}
			if err := e.srv.store.CreateLink(ctx, l, false); err != nil {
				t.Fatal(err)
			}
			// The external writer has saved an uncommitted manual title. WAL
			// lets the handler read the old title, then blocks its write until
			// we commit. InUse proves that it reached that write boundary.
			db, err := sql.Open("sqlite", "file:"+strings.ReplaceAll(e.dbPath, "?", "%3F"))
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			tx, err := db.BeginTx(ctx, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			const manual = "keep this manual title"
			if _, err := tx.ExecContext(ctx, "UPDATE links SET title = ?, meta = ?, updated_at = ? WHERE id = ?", manual, store.MetaManual, now+1, l.ID); err != nil {
				t.Fatal(err)
			}
			r := httptest.NewRequest("PATCH", "/api/links/manual", strings.NewReader(`{"url":"http://127.0.0.1/new"}`))
			r.SetPathValue("id", fmt.Sprint(l.ID))
			w := httptest.NewRecorder()
			done := make(chan struct{})
			go func() {
				defer close(done)
				if refresh {
					e.srv.refreshLink(w, r)
				} else {
					e.srv.updateLink(w, r)
				}
			}()
			t.Cleanup(func() {
				tx.Rollback()
				select {
				case <-done:
				case <-time.After(5 * time.Second):
					t.Error("metadata handler did not finish")
				}
			})
			deadline := time.Now().Add(900 * time.Millisecond)
			for {
				_, writes := e.srv.store.PoolStats()
				if writes.InUse == 1 {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("handler did not reach the blocked write")
				}
				time.Sleep(time.Millisecond)
			}
			if err := tx.Commit(); err != nil {
				t.Fatal(err)
			}
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("metadata handler timed out")
			}
			if w.Code != 200 {
				t.Fatalf("response: %d %s", w.Code, w.Body.String())
			}
			got, err := e.srv.store.GetLink(ctx, l.ID)
			if err != nil || got.Title != manual || got.Meta != store.MetaManual {
				t.Fatalf("manual title lost: %+v %v", got, err)
			}
			if refresh && got.UpdatedAt != now+1 {
				t.Fatalf("refresh restored a stale timestamp: %d", got.UpdatedAt)
			}
			if !refresh && got.UpdatedAt <= now+1 {
				t.Fatalf("update did not advance past the concurrent commit: %d", got.UpdatedAt)
			}
			// Explicitly clearing the title still opts back into automatic
			// fetching. Direct store use keeps the pending state deterministic.
			empty := ""
			_, got, err = e.srv.store.UpdateLink(ctx, l.ID, store.Patch{Title: &empty, FetchMeta: true}, now+2)
			if err != nil || got.Title != "" || got.Meta != store.MetaPending {
				t.Fatalf("explicit clear failed: %+v %v", got, err)
			}
			if err := e.srv.store.SetFetchedMeta(ctx, l.ID, got.URL, "new automatic title", store.MetaOK); err != nil {
				t.Fatal(err)
			}
			got, err = e.srv.store.GetLink(ctx, l.ID)
			if err != nil || got.Title != "new automatic title" || got.Meta != store.MetaOK {
				t.Fatalf("refetch after clear failed: %+v %v", got, err)
			}
		})
	}
}
