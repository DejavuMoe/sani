package server

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"testing"
)

func TestBUG20UploadRejectsIncompatibleFieldsBeforeReservation(t *testing.T) {
	for _, field := range []string{`"text":"copy-fixture"`, `"format":"code"`, `"url":"https://example.invalid/path"`, `"redirect":301`} {
		t.Run(field, func(t *testing.T) {
			e := newShareEnv(t, Options{})
			r := e.req("POST", "/api/admin/v1/uploads", fmt.Sprintf(`{"name":"fixture.bin","size":1,%s}`, field))
			if r.status != http.StatusBadRequest || r.code() != "kind_mismatch" {
				t.Errorf("incompatible input accepted: %d %s", r.status, r.body)
			}
			e.srv.uploadsMu.Lock()
			reserved := len(e.srv.uploads)
			e.srv.uploadsMu.Unlock()
			if reserved != 0 {
				t.Errorf("rejected input reserved %d sessions", reserved)
			}
			entries, err := os.ReadDir(e.srv.opt.FilesDir)
			if err != nil || len(entries) != 0 {
				t.Errorf("rejected input left disk entries: %v (%v)", entries, err)
			}
		})
	}
	t.Run("common-options-still-complete", func(t *testing.T) {
		e := newShareEnv(t, Options{})
		r := e.req("POST", "/api/admin/v1/uploads", `{"name":"fixture.bin","size":1,"slug":"ordinary-file","title":"Keep title","maxClicks":5,"enabled":false}`)
		if r.status != http.StatusCreated {
			t.Fatalf("begin: %d %s", r.status, r.body)
		}
		path := "/api/admin/v1/uploads/" + r.json()["id"].(string)
		if r := e.req("PUT", path, "x", "Upload-Offset", "0"); r.status != http.StatusOK {
			t.Fatalf("chunk: %d %s", r.status, r.body)
		}
		r = e.req("POST", path+"/complete", nil)
		l := r.json()
		if r.status != http.StatusCreated || l["kind"] != "file" || l["slug"] != "ordinary-file" || l["title"] != "Keep title" || l["maxClicks"] != float64(5) || l["enabled"] != false {
			t.Fatalf("file options lost: %d %s", r.status, r.body)
		}
	})
}

func TestBUG20UploadCompletionRechecksKind(t *testing.T) {
	e := newShareEnv(t, Options{})
	r := e.req("POST", "/api/admin/v1/uploads", `{"name":"fixture.bin","size":1}`)
	if r.status != http.StatusCreated {
		t.Fatalf("begin: %d %s", r.status, r.body)
	}
	id := r.json()["id"].(string)
	path := "/api/admin/v1/uploads/" + id
	if r := e.req("PUT", path, "x", "Upload-Offset", "0"); r.status != http.StatusOK {
		t.Fatalf("chunk: %d %s", r.status, r.body)
	}
	// Model an already accepted incompatible session to cover final validation.
	e.srv.uploadsMu.Lock()
	up := e.srv.uploads[id]
	e.srv.uploadsMu.Unlock()
	up.mu.Lock()
	text := "copy-fixture"
	up.input.Text = &text
	up.mu.Unlock()
	r = e.req("POST", path+"/complete", nil)
	if r.status != http.StatusBadRequest || r.code() != "kind_mismatch" {
		t.Errorf("completion accepted incompatible fields: %d %s", r.status, r.body)
	}
	if count, _, err := e.srv.store.Totals(context.Background()); err != nil || count != 0 {
		t.Errorf("rejected completion created a link: %d (%v)", count, err)
	}
	if _, err := os.Stat(e.srv.uploadPath(id)); err != nil {
		t.Errorf("rejected completion consumed pending bytes: %v", err)
	}
}
