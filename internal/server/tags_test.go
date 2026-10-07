package server

import (
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
)

func TestTagAPIAndSharing(t *testing.T) {
	e := newEnv(t, Options{FilesURL: "http://" + filesHost, FilesDir: t.TempDir()})
	for _, method := range []string{"GET", "POST"} {
		if r := e.req(method, "/api/tags", `{}`); r.status != 401 {
			t.Fatalf("unauthenticated tags: %d", r.status)
		}
	}
	e.signIn()
	r := e.req("POST", "/api/tags", `{"name":"  private-group  ","color":"amber"}`)
	if r.status != 200 {
		t.Fatalf("tag: %d %s", r.status, r.body)
	}
	id := r.json()["id"]
	dup := e.req("POST", "/api/tags", `{"name":"PRIVATE-GROUP","color":"rose"}`)
	if dup.json()["id"] != id || dup.json()["color"] != "amber" {
		t.Fatal(string(dup.body))
	}
	if r := e.req("POST", "/api/tags", `{"name":"x"}`, "Sec-Fetch-Site", "cross-site"); r.status != 403 {
		t.Fatal(r.status)
	}
	ids := []any{id}
	l := e.create(map[string]any{"url": "https://example.com/tagged", "slug": "tagged", "tags": ids})
	if !reflect.DeepEqual(l["tags"], ids) {
		t.Fatal(l)
	}
	path := fmt.Sprintf("/api/links/%v", l["id"])
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
	text := e.req("POST", "/api/texts", map[string]any{"text": "hello", "slug": "tag-note", "tags": ids})
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
	if r := e.files("GET", "/api/tags"); r.status == 200 {
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
		r := e.req("GET", "/api/links?"+q, nil)
		want := float64(1)
		if q == "tag=untagged" {
			want = 0
		}
		if r.status != 200 || r.json()["total"] != want {
			t.Fatal(string(r.body))
		}
	}
	e.req("PATCH", path, `{"tags":[]}`)
	if total := e.req("GET", "/api/links?tag=untagged", nil).json()["total"]; total != float64(1) {
		t.Fatal(total)
	}
	// Explicit tags must not be silently discarded by reuse.
	reused := e.req("POST", "/api/links", map[string]any{"url": "https://example.com/tagged", "reuse": true, "tags": ids})
	if reused.status != 201 || !reflect.DeepEqual(reused.json()["tags"], ids) {
		t.Fatal(string(reused.body))
	}
}

func TestTagExportImport(t *testing.T) {
	for _, format := range []string{"json", "csv"} {
		t.Run(format, func(t *testing.T) {
			source := newEnv(t, Options{})
			source.signIn()
			tag := source.req("POST", "/api/tags", `{"name":"发布,一组","color":"green"}`).json()["id"]
			source.create(map[string]any{"url": "https://example.com/portable", "slug": "portable", "tags": []any{tag}})
			exported := source.req("GET", "/api/export?format="+format, nil)
			target := newEnv(t, Options{})
			target.signIn()
			target.req("POST", "/api/tags", `{"name":"unrelated"}`)
			r := target.req("POST", "/api/import", string(exported.body))
			if r.status != 200 || r.json()["created"] != float64(1) {
				t.Fatal(string(r.body))
			}
			links := target.req("GET", "/api/links", nil).json()["items"].([]any)
			ids := links[0].(map[string]any)["tags"].([]any)
			catalog := target.req("GET", "/api/tags", nil).json()["items"].([]any)
			got := catalog[1].(map[string]any)
			if len(ids) != 1 || ids[0] != got["id"] || got["name"] != "发布,一组" || got["color"] != "green" || got["count"] != float64(1) {
				t.Fatalf("import tags: %v %v", ids, catalog)
			}
			// Older exports without tags are still accepted.
			r = target.req("POST", "/api/import", `[{"slug":"legacy","url":"https://example.com/old"},{"slug":"foreign","url":"https://example.com/foreign","tags":["team"]}]`)
			if r.json()["created"] != float64(2) {
				t.Fatal(string(r.body))
			}
		})
	}
}
