package server

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"net/http"
	"os"
	"reflect"
	"testing"
	"time"
)

func TestShlinkCSVImport(t *testing.T) {
	e := newEnv(t, Options{BaseURL: "https://s.example.com"})
	e.signIn()
	var body bytes.Buffer
	w := csv.NewWriter(&body)
	w.WriteAll([][]string{
		{"createdAt", "domain", "shortCode", "shortUrl", "longUrl", "title", "tags", "visits"},
		{"2026-02-04T20:04:57+08:00", "s.example.com", "MiXeD", "https://s.example.com/MiXeD", "https://example.com/?a=1&b=2", `A "quoted", title`, `blog|工作,项目|say "hi"`, "38234"},
		{"2026-02-04T20:04:57+08:00", "s.example.com", "untagged", "https://s.example.com/untagged", "https://example.com/empty", "", "", "0"},
		{"", "s.example.com", "too-many", "https://s.example.com/too-many", "https://example.com/limit", "", "a|b|c|d|e|f", "0"},
		{"", "s.example.com", "empty-tag", "https://s.example.com/empty-tag", "https://example.com/invalid", "", "a||b", "0"},
	})
	if err := w.Error(); err != nil {
		t.Fatal(err)
	}
	r := e.req("POST", "/api/import", body.String(), "Content-Type", "text/csv")
	var result struct {
		Created int             `json:"created"`
		Skipped []importProblem `json:"skipped"`
	}
	if err := json.Unmarshal(r.body, &result); err != nil || r.status != http.StatusOK || result.Created != 2 || len(result.Skipped) != 2 {
		t.Fatalf("import: %d %s, %v", r.status, r.body, err)
	}
	for _, p := range result.Skipped {
		if p.Reason != "tags_invalid" {
			t.Fatalf("skip: %+v", p)
		}
	}
	var exported struct {
		Links []exportLink `json:"links"`
	}
	r = e.req("GET", "/api/export", nil)
	if err := json.Unmarshal(r.body, &exported); err != nil || len(exported.Links) != 2 {
		t.Fatalf("export: %s, %v", r.body, err)
	}
	l := exported.Links[0]
	created, _ := time.Parse(time.RFC3339, "2026-02-04T20:04:57+08:00")
	if l.Slug != "MiXeD" || l.URL != "https://example.com/?a=1&b=2" || l.Title != `A "quoted", title` ||
		l.Clicks != 38234 || l.CreatedAt == nil || !l.CreatedAt.Equal(created) ||
		!reflect.DeepEqual(l.Tags, []exportTag{{"blog", "blue"}, {"工作,项目", "blue"}, {`say "hi"`, "blue"}}) {
		t.Fatalf("changed import: %+v", l)
	}
	if l := exported.Links[1]; l.Slug != "untagged" || len(l.Tags) != 0 || l.Title != "" || l.Clicks != 0 {
		t.Fatalf("changed empty fields: %+v", l)
	}
	r = e.req("POST", "/api/import", body.String(), "Content-Type", "text/csv")
	if r.status != http.StatusOK || r.json()["created"] != float64(0) {
		t.Fatalf("duplicate import: %d %s", r.status, r.body)
	}
	n, clicks, err := e.srv.store.Totals(context.Background())
	if err != nil || n != 2 || clicks != 38234 {
		t.Fatalf("duplicate totals: %d %d %v", n, clicks, err)
	}
}

func TestCSVTagDialects(t *testing.T) {
	for _, tc := range []struct {
		name, header, tags, want string
	}{
		{"shlink", "ShortCode,LongUrl,shortUrl,DOMAIN,tags", "work|home", `["work","home"]`},
		{"shlink-json-looking-name", "shortCode,longUrl,shortUrl,domain,tags", `["work"]`, `["[\"work\"]"]`},
		{"sani", "slug,url,title,redirect,tags", `[{"name":"work","color":"green"}]`, `[{"name":"work","color":"green"}]`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var data bytes.Buffer
			data.WriteString(tc.header + "\n")
			w := csv.NewWriter(&data)
			w.Write([]string{"slug", "https://example.com", "", "", tc.tags})
			w.Flush()
			if err := w.Error(); err != nil {
				t.Fatal(err)
			}
			records, err := parseCSVRecords(data.Bytes())
			if err != nil || len(records) != 1 || records[0]["tags"] != tc.want {
				t.Fatalf("parsed: %v, %v", records, err)
			}
		})
	}
}

func TestExternalShlinkCSV(t *testing.T) {
	path := os.Getenv("SANI_TEST_SHLINK_CSV")
	if path == "" {
		t.Skip("optional private CSV fixture")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	e := newEnv(t, Options{BaseURL: "https://zsh.moe", FetchMeta: false})
	e.signIn()
	for _, want := range []float64{82, 0} {
		r := e.req("POST", "/api/import", string(data), "Content-Type", "text/csv")
		if r.status != 200 || r.json()["created"] != want {
			t.Fatalf("import status=%d, created=%v", r.status, r.json()["created"])
		}
		n, clicks, err := e.srv.store.Totals(context.Background())
		tags, tagErr := e.srv.store.Tags(context.Background())
		if err != nil || tagErr != nil || n != 82 || clicks != 38234 || len(tags.Items) != 10 {
			t.Fatalf("totals=%d clicks=%d tags=%d errors=%v/%v", n, clicks, len(tags.Items), err, tagErr)
		}
	}
	t.Log("Unmodified private CSV: 82 links, 10 tags, 38234 clicks; repeat import created 0; isolated temporary database, metadata disabled")
}
