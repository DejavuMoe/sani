package server

import (
	"database/sql/driver"
	"fmt"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"modernc.org/sqlite"
)

var exportTestSequence atomic.Uint64

func TestExportKeepsTagsFromOneSnapshot(t *testing.T) {
	readStarted, resume := make(chan struct{}), make(chan struct{})
	unblock := sync.OnceFunc(func() { close(resume) })
	gate := fmt.Sprintf("sani_export_gate_%d", exportTestSequence.Add(1))
	signalRead := sync.OnceFunc(func() { close(readStarted) })
	sqlite.MustRegisterScalarFunction(gate, 0, func(*sqlite.FunctionContext, []driver.Value) (driver.Value, error) {
		signalRead()
		<-resume
		return "image/png", nil
	})
	source := newEnv(t, Options{})
	source.signIn()
	tag := source.req("POST", "/api/admin/v1/tags", map[string]string{"name": "Work", "color": "blue"})
	if tag.status != 200 {
		t.Fatal(string(tag.body))
	}
	id := int64(tag.json()["id"].(float64))
	source.create(map[string]any{"slug": "snapshot", "url": "https://example.org/a", "tags": []int64{id}})

	// Pause while the export reads the link row, with its SQLite snapshot open.
	db := source.openDB()
	if _, err := db.Exec("ALTER TABLE favicons RENAME TO saved_favicons"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("CREATE VIEW favicons AS SELECT 'example.org' AS host, " + gate + "() AS type"); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		defer close(done)
		source.srv.export(rec, httptest.NewRequestWithContext(t.Context(), "GET", "/api/admin/v1/export", nil))
	}()
	defer func() { unblock(); <-done }()
	select {
	case <-readStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("export did not reach the read gate")
	}
	if deleted := source.req("DELETE", fmt.Sprintf("/api/admin/v1/tags/%d", id), nil); deleted.status != 204 {
		t.Fatalf("delete tag: %d %s", deleted.status, deleted.body)
	}
	unblock()
	<-done
	if rec.Code != 200 {
		t.Fatalf("export: %d %s", rec.Code, rec.Body)
	}
	target := newEnv(t, Options{})
	target.signIn()
	imported := target.req("POST", "/api/admin/v1/import", rec.Body.String())
	if imported.status != 200 || imported.json()["created"] != float64(1) {
		t.Fatalf("export could not be reimported: %d %s; export: %s", imported.status, imported.body, rec.Body)
	}
	if tags := target.req("GET", "/api/admin/v1/tags", nil); tags.status != 200 || !strings.Contains(string(tags.body), "\"name\":\"Work\"") {
		t.Fatalf("export did not preserve the snapshot tag: %s", tags.body)
	}
}

func TestDeleteTagAPIKeepsSharedContents(t *testing.T) {
	e := newEnv(t, Options{FilesURL: "http://" + filesHost, FilesDir: t.TempDir()})
	if r := e.req("DELETE", "/api/admin/v1/tags/1", nil); r.status != 401 {
		t.Fatal(r.status)
	}
	e.signIn()
	tag := e.req("POST", "/api/admin/v1/tags", `{"name":"remove","color":"blue"}`).json()["id"]
	path := fmt.Sprintf("/api/admin/v1/tags/%v", tag)
	ids := []any{tag}
	link := e.create(map[string]any{"url": "https://example.com", "tags": ids})
	text := e.req("POST", "/api/admin/v1/texts", map[string]any{"text": "retained text", "tags": ids}).json()
	file := e.upload(map[string]string{"tags": fmt.Sprintf("[%v]", tag)}, "keep.txt", []byte("retained bytes")).json()
	if r := e.req("DELETE", path, nil, "Sec-Fetch-Site", "cross-site"); r.status != 403 {
		t.Fatal(r.status)
	}
	if r := e.req("DELETE", path, nil); r.status != 204 || len(r.body) != 0 {
		t.Fatalf("delete: %d %s", r.status, r.body)
	}
	for _, item := range []map[string]any{link, text, file} {
		r := e.req("GET", fmt.Sprintf("/api/admin/v1/links/%v", item["id"]), nil)
		if r.status != 200 || len(r.json()["tags"].([]any)) != 0 {
			t.Fatalf("lost item: %d %s", r.status, r.body)
		}
	}
	if r := e.req("GET", fmt.Sprintf("/api/admin/v1/links/%v/text", text["id"]), nil); r.status != 200 || !strings.Contains(string(r.body), "retained text") {
		t.Fatalf("text lost: %s", r.body)
	}
	entries, err := os.ReadDir(e.srv.opt.FilesDir)
	if err != nil || len(entries) == 0 {
		t.Fatalf("file lost: %v", err)
	}
	if r := e.req("DELETE", path, nil); r.status != 404 {
		t.Fatal(r.status)
	}
}

func TestTagAPIAndSharing(t *testing.T) {
	e := newEnv(t, Options{FilesURL: "http://" + filesHost, FilesDir: t.TempDir()})
	for _, method := range []string{"GET", "POST"} {
		if r := e.req(method, "/api/admin/v1/tags", `{}`); r.status != 401 {
			t.Fatalf("unauthenticated tags: %d", r.status)
		}
	}
	e.signIn()
	r := e.req("POST", "/api/admin/v1/tags", `{"name":"  private-group  ","color":"amber"}`)
	if r.status != 200 {
		t.Fatalf("tag: %d %s", r.status, r.body)
	}
	id := r.json()["id"]
	dup := e.req("POST", "/api/admin/v1/tags", `{"name":"PRIVATE-GROUP","color":"rose"}`)
	if dup.json()["id"] != id || dup.json()["color"] != "amber" {
		t.Fatal(string(dup.body))
	}
	if r := e.req("POST", "/api/admin/v1/tags", `{"name":"x"}`, "Sec-Fetch-Site", "cross-site"); r.status != 403 {
		t.Fatal(r.status)
	}
	ids := []any{id}
	l := e.create(map[string]any{"url": "https://example.com/tagged", "slug": "tagged", "tags": ids})
	if !reflect.DeepEqual(l["tags"], ids) {
		t.Fatal(l)
	}
	path := fmt.Sprintf("/api/admin/v1/links/%v", l["id"])
	for _, tags := range []string{"null", "[0]", "[99999]", fmt.Sprintf("[%v,%v]", id, id), "[1,2,3,4,5,6]"} {
		r := e.req("PATCH", path, `{"title":"must-not-save","tags":`+tags+`}`)
		if r.code() != "tags_invalid" {
			t.Fatalf("invalid %s: %s", tags, r.body)
		}
	}
	got := e.req("GET", path, nil).json()
	if got["title"] != "" || !reflect.DeepEqual(got["tags"], ids) {
		t.Fatal(got)
	}
	if r := e.req("PATCH", path, `{"enabled":false}`); !reflect.DeepEqual(r.json()["tags"], ids) {
		t.Fatal(string(r.body))
	}
	text := e.req("POST", "/api/admin/v1/texts", map[string]any{"text": "hello", "slug": "tag-note", "tags": ids})
	if text.status != 201 || !reflect.DeepEqual(text.json()["tags"], ids) {
		t.Fatal(string(text.body))
	}
	file := e.upload(map[string]string{"slug": "tag-file", "tags": fmt.Sprintf("[%v]", id)}, "note.txt", []byte("file body"))
	if file.status != 201 || !reflect.DeepEqual(file.json()["tags"], ids) {
		t.Fatal(string(file.body))
	}
	for _, slug := range []string{"tag-note", "tag-file"} {
		if r := e.req("GET", "/p/"+slug, nil); strings.Contains(string(r.body), "private-group") {
			t.Fatal("tag leaked to visitors")
		}
	}
	if r := e.files("GET", "/api/admin/v1/tags"); r.status == 200 {
		t.Fatal("tags exposed on files origin")
	}
	entries, _ := os.ReadDir(e.srv.opt.FilesDir)
	bad := e.upload(map[string]string{"tags": "[99999]"}, "reject.txt", []byte("reject me"))
	if bad.code() != "tags_invalid" {
		t.Fatal(string(bad.body))
	}
	after, _ := os.ReadDir(e.srv.opt.FilesDir)
	if len(entries) != len(after) {
		t.Fatal("failed upload leaked a file")
	}
	for _, q := range []string{fmt.Sprintf("tag=%v&kind=file&q=note.txt", id), "tag=untagged"} {
		r := e.req("GET", "/api/admin/v1/links?"+q, nil)
		want := float64(1)
		if q == "tag=untagged" {
			want = 0
		}
		if r.status != 200 || r.json()["total"] != want {
			t.Fatal(string(r.body))
		}
	}
	e.req("PATCH", path, `{"tags":[]}`)
	if total := e.req("GET", "/api/admin/v1/links?tag=untagged", nil).json()["total"]; total != float64(1) {
		t.Fatal(total)
	}
	// Explicit tags must not be silently discarded by reuse.
	reused := e.req("POST", "/api/admin/v1/links", map[string]any{"url": "https://example.com/tagged", "reuse": true, "tags": ids})
	if reused.status != 201 || !reflect.DeepEqual(reused.json()["tags"], ids) {
		t.Fatal(string(reused.body))
	}
}

func TestTagExportImport(t *testing.T) {
	for _, format := range []string{"json", "csv"} {
		t.Run(format, func(t *testing.T) {
			source := newEnv(t, Options{})
			source.signIn()
			tag := source.req("POST", "/api/admin/v1/tags", `{"name":"发布,一组","color":"#5872a5"}`).json()["id"]
			source.create(map[string]any{"url": "https://example.com/portable", "slug": "portable", "tags": []any{tag}})
			exported := source.req("GET", "/api/admin/v1/export?format="+format, nil)
			target := newEnv(t, Options{})
			target.signIn()
			target.req("POST", "/api/admin/v1/tags", `{"name":"unrelated"}`)
			r := target.req("POST", "/api/admin/v1/import", string(exported.body))
			if r.status != 200 || r.json()["created"] != float64(1) {
				t.Fatal(string(r.body))
			}
			links := target.req("GET", "/api/admin/v1/links", nil).json()["items"].([]any)
			ids := links[0].(map[string]any)["tags"].([]any)
			catalog := target.req("GET", "/api/admin/v1/tags", nil).json()["items"].([]any)
			got := catalog[1].(map[string]any)
			if len(ids) != 1 || ids[0] != got["id"] || got["name"] != "发布,一组" || got["color"] != "#5872a5" || got["count"] != float64(1) {
				t.Fatalf("import tags: %v %v", ids, catalog)
			}
			// Older exports without tags are still accepted.
			r = target.req("POST", "/api/admin/v1/import", `{"app":"sani","version":1,"links":[{"slug":"legacy","url":"https://example.com/old"},{"slug":"foreign","url":"https://example.com/foreign","tags":["team"]}]}`)
			if r.json()["created"] != float64(2) {
				t.Fatal(string(r.body))
			}
		})
	}
}
