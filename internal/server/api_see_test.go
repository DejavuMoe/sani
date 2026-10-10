package server

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/DejavuMoe/sani/internal/clicks"
	"github.com/DejavuMoe/sani/internal/links"
	"github.com/DejavuMoe/sani/internal/store"
)

func seeEnv(t *testing.T) (*env, string) {
	t.Helper()
	e := newEnv(t, Options{BaseURL: "https://short.example", FilesURL: "https://files.example", FilesDir: t.TempDir()})
	e.signIn()
	r := e.req("POST", "/api/admin/v1/tokens", map[string]string{"name": "compat"})
	if r.status != 201 {
		t.Fatalf("token: %s", r.body)
	}
	return e, r.json()["token"].(string)
}

func seeData(t *testing.T, r reply) map[string]any {
	t.Helper()
	if r.status != 200 || r.json()["code"] != float64(200) {
		t.Fatalf("response: %d %s", r.status, r.body)
	}
	d, ok := r.json()["data"].(map[string]any)
	if !ok {
		t.Fatalf("data: %s", r.body)
	}
	return d
}

func TestSeeTokenBoundaryAndLegacyRoutes(t *testing.T) {
	e, key := seeEnv(t)
	for _, credential := range []string{key, "Bearer " + key} {
		r := e.req("GET", "/api/v1/domains", nil, "Authorization", credential)
		d := seeData(t, r)
		if fmt.Sprint(d["domains"]) != "[short.example]" {
			t.Fatal(d)
		}
	}
	for _, headers := range [][]string{nil, {"Authorization", "bad"}, {"Authorization", key, "X-Api-Key", "bad"}, {"Authorization", "", "X-Api-Key", key}} {
		if r := e.req("GET", "/api/v1/domains", nil, headers...); r.status != 401 || r.json()["success"] != false {
			t.Fatalf("cookie fallback: %d %s", r.status, r.body)
		}
	}
	for _, path := range []string{"/api/session", "/api/links", "/api/files", "/api/tokens"} {
		if r := e.req("GET", path, nil); r.status != 404 {
			t.Fatalf("old route survives: %s %d", path, r.status)
		}
	}
	for _, path := range []string{"/api/v1/usage", "/api/v1/file/private/download-url", "/api/v1/links", "/api/v1/texts", "/api/v1/token/check"} {
		if r := e.req("GET", path, nil, "Authorization", key); r.status != 501 {
			t.Fatalf("unsupported endpoint: %s %d", path, r.status)
		}
	}
	for _, headers := range [][]string{{"Origin", "https://evil.example"}, {"Sec-Fetch-Site", "cross-site"}} {
		if r := e.req("GET", "/api/v1/shorten?signature="+key+"&url=https://example.org", nil, headers...); r.status != 403 {
			t.Fatalf("cross-site creation: %s", r.body)
		}
	}
	if r := e.req("GET", "/api/v1/domains?signature="+key, nil, "Authorization", key); r.status != 400 {
		t.Fatal(r.status)
	}
	rq := httptest.NewRequest("GET", "https://short.example/api/v1/domains", nil)
	rq.Header.Add("Authorization", key)
	rq.Header.Add("Authorization", "bad")
	rw := httptest.NewRecorder()
	e.srv.ServeHTTP(rw, rq)
	if rw.Code != 401 {
		t.Fatal("duplicate conflicting authorization accepted")
	}
}

func TestSeeConfiguredDomainAndLegacyLongTargets(t *testing.T) {
	e, key := seeEnv(t)
	e.srv.opt.BaseURL = ""
	if r := e.req("GET", "/api/v1/domains", nil, "Authorization", key); r.status != 503 || r.json()["error"] != "domain_unconfigured" {
		t.Fatalf("request host used as a domain: %d %s", r.status, r.body)
	}
	base := "https://saved.example:8443"
	e.srv.storedBase.Store(&base)
	if got := seeData(t, e.req("GET", "/api/v1/domains", nil, "Authorization", key))["domains"]; fmt.Sprint(got) != "[saved.example:8443]" {
		t.Fatal(got)
	}
	long := "https://example.org/" + strings.Repeat("x", 3000)
	if r := e.req("POST", "/api/admin/v1/links", map[string]string{"url": long, "slug": "oldlong"}); r.status != 201 {
		t.Fatal(string(r.body))
	}
	seeData(t, e.req("PUT", "/api/v1/shorten", `{"domain":"saved.example:8443","slug":"oldlong","title":"new title"}`, "Authorization", key))
	if r := e.visit("/oldlong"); r.header.Get("Location") != long {
		t.Fatal("title-only update changed legacy target")
	}
}

func TestSeeShortURLContractAndCacheInvalidation(t *testing.T) {
	e, key := seeEnv(t)
	call := func(method, path string, body any) reply {
		return e.req(method, "/api/v1"+path, body, "Authorization", key)
	}
	expires := time.Now().Add(time.Hour).Unix()
	created := seeData(t, call("POST", "/shorten", map[string]any{"domain": "SHORT.EXAMPLE", "target_url": "https://example.org/original", "custom_slug": "KeptCase", "expire_at": expires}))
	stored, err := e.srv.store.LinkBySlug(context.Background(), "keptcase")
	if err != nil || stored.ExpiresAt != expires*1000 {
		t.Fatalf("expiry seconds not preserved: %+v %v", stored, err)
	}
	if created["slug"] != "KeptCase" || created["custom_slug"] != "KeptCase" || created["short_url"] != "https://short.example/KeptCase" {
		t.Fatal(created)
	}
	if r := e.visit("/keptcase"); r.status != 302 || r.header.Get("Location") != "https://example.org/original" {
		t.Fatal(r)
	}
	if r := call("PUT", "/shorten", `{"domain":"foreign.example","slug":"KeptCase","target_url":"https://example.org/hijack"}`); r.status != 400 {
		t.Fatal("domain ignored")
	}
	seeData(t, call("PUT", "/shorten", `{"domain":"short.example","slug":"keptcase","target_url":"https://example.org/new","title":""}`))
	if r := e.visit("/KeptCase"); r.header.Get("Location") != "https://example.org/new" {
		t.Fatal("cached old target")
	}
	if count := seeData(t, call("GET", "/link/visit-stat?domain=short.example&slug=KeptCase&period=totally", nil))["visit_count"]; count != float64(2) {
		t.Fatal(count)
	}
	for _, period := range []string{"daily", "monthly"} {
		if count := seeData(t, call("GET", "/link/visit-stat?domain=short.example&slug=KeptCase&period="+period, nil))["visit_count"]; count != float64(2) {
			t.Fatal(count)
		}
	}
	for _, period := range []string{"total", "24h"} {
		if r := call("GET", "/link/visit-stat?domain=short.example&slug=KeptCase&period="+period, nil); r.status != 400 {
			t.Fatal("period ignored")
		}
	}
	if r := call("DELETE", "/text", `{"domain":"short.example","slug":"KeptCase"}`); r.status != 404 {
		t.Fatal("kind mismatch accepted")
	}
	if r := call("DELETE", "/shorten", `{"domain":"short.example","slug":"KeptCase"}`); r.status != 200 || r.json()["data"] != nil {
		t.Fatal(string(r.body))
	}
	if r := e.visit("/KeptCase"); r.status != 404 {
		t.Fatal("cached deleted target")
	}
	if r := call("DELETE", "/shorten", `{"domain":"short.example","slug":"KeptCase"}`); r.status != 404 {
		t.Fatal("double deletion succeeded")
	}
	seeData(t, call("POST", "/shorten", `{"target_url":"https://example.org/reused","custom_slug":"KeptCase"}`))
}

func TestSeeRejectsUnsupportedAndAmbiguousInputBeforeWriting(t *testing.T) {
	e, key := seeEnv(t)
	for _, body := range []string{
		`{"target_url":"https://example.org","password":"secret"}`,
		`{"target_url":"https://example.org","password":""}`,
		`{"target_url":"https://example.org","domain custom_slug":"ignored"}`,
		`{"target_url":"https://example.org","":"ignored"}`,
		`{"target_url":"https://example.org","expiration_redirect_url":"https://example.net"}`,
		`{"target_url":"https://example.org","is_private":1}`,
		`{"target_url":"https://example.org","domain":"s.ee"}`,
		`{"target_url":"https://example.org","title":null}`,
		`{"target_url":"https://example.org","tag_ids":null}`,
		`{"target_url":"https://example.org","expire_at":1}`,
		`{"target_url":"https://example.org","expire_at":253402300800}`,
		`{"target_url":"https://example.org","title":"a","title":"b"}`,
		`{"target_url":"https://example.org"} {}`,
		`null`, `[]`, `{"target_url":3}`, `{"target_url":"javascript:alert(1)"}`,
	} {
		t.Run(body, func(t *testing.T) {
			if r := e.req("POST", "/api/v1/shorten", body, "Authorization", key); r.status < 400 {
				t.Fatalf("accepted %s: %s", body, r.body)
			}
		})
	}
	for _, path := range []string{"/api/v1/shorten?password=secret", "/api/v1/text?is_private=1"} {
		if r := e.req("POST", path, `{"target_url":"https://example.org"}`, "Authorization", key); r.status != 400 {
			t.Fatal(r.status)
		}
	}
	if r := e.req("POST", "/api/v1/shorten", `{"target_url":"https://example.org"}`, "Authorization", key, "Content-Type", "text/plain"); r.status != 415 {
		t.Fatal(r.status)
	}
	res, err := e.srv.store.ListLinks(context.Background(), store.ListQuery{})
	if err != nil || res.Total != 0 {
		t.Fatalf("failed request wrote resources: %+v %v", res, err)
	}
}

func TestSeeSimpleModeAndText(t *testing.T) {
	e, key := seeEnv(t)
	query := "?signature=" + key + "&url=https%3A%2F%2Fexample.org&custom_slug=simple"
	if r := e.req("HEAD", "/api/v1/shorten"+query, nil); r.status != 405 {
		t.Fatal(r.status)
	}
	if r := e.visit("/simple"); r.status != 404 {
		t.Fatal("HEAD created a resource")
	}
	r := e.req("GET", "/api/v1/shorten"+query, nil)
	if r.status != 200 || string(r.body) != "https://short.example/simple" || !strings.HasPrefix(r.header.Get("Content-Type"), "text/plain") || r.header.Get("Cache-Control") != "no-store" {
		t.Fatalf("simple: %d %s", r.status, r.body)
	}
	seeData(t, e.req("GET", "/api/v1/shorten?signature="+key+"&url=https://example.org&json=true&tag_ids=", nil))
	for _, suffix := range []string{"&password=secret", "&tag_ids[]=1", "&json=banana", "&url=https://evil.example", "&expire_at=bad", "&domain+custom_slug=ignored", "&=ignored"} {
		if r := e.req("GET", "/api/v1/shorten"+query+suffix, nil); r.status != 400 {
			t.Fatal(suffix, r.status)
		}
	}
	if r := e.req("GET", "/api/v1/shorten"+query, nil, "Authorization", "bad"); r.status != 401 {
		t.Fatal("signature conflict ignored")
	}
	content := "中英 <script>alert(1)</script>\nsecond line"
	text := seeData(t, e.req("POST", "/api/v1/text", map[string]any{"content": content, "custom_slug": "note", "text_type": "source_code"}, "Authorization", key))
	if text["short_url"] != "https://short.example/p/note" {
		t.Fatal(text)
	}
	l, err := e.srv.store.LinkBySlug(context.Background(), "note")
	if err != nil {
		t.Fatal(err)
	}
	body, err := e.srv.store.TextBody(context.Background(), l.ID)
	if err != nil || body != content {
		t.Fatal("text bytes changed")
	}
	if r := e.visit("/p/note"); r.status != 200 || strings.Contains(string(r.body), "<script>alert(1)</script>") {
		t.Fatal("unescaped text")
	}
	for _, fields := range []map[string]any{{"content": "secret", "password": "abc"}, {"content": "secret", "text_type": "markdown"}, {"content": strings.Repeat("中", (1<<20)/3+1)}} {
		if r := e.req("POST", "/api/v1/text", fields, "Authorization", key); r.status < 400 {
			t.Fatal("unsupported text accepted")
		}
	}
	seeData(t, e.req("PUT", "/api/v1/text", `{"domain":"short.example","slug":"note","content":"updated","title":""}`, "Authorization", key))
	if r := e.req("DELETE", "/api/v1/text", `{"domain":"short.example","slug":"note"}`, "Authorization", key); r.status != 200 {
		t.Fatal(r.status)
	}
}

func seeFileRequest(t *testing.T, e *env, key, alias string, fields [][2]string) reply {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, err := mw.CreateFormFile(alias, "报告.txt")
	if err != nil {
		t.Fatal(err)
	}
	part.Write([]byte("public file\x00\xff"))
	for _, f := range fields {
		if err := mw.WriteField(f[0], f[1]); err != nil {
			t.Fatal(err)
		}
	}
	mw.Close()
	return e.req("POST", "/api/v1/file/upload", body.String(), "Authorization", key, "Content-Type", mw.FormDataContentType())
}

func TestSeePublicFilesAndStableDeletionKeys(t *testing.T) {
	e, key := seeEnv(t)
	for _, fields := range [][][2]string{{{"is_private", "1"}}, {{"is_private", "false"}}, {{"domain", "evil.example"}}, {{"password", "secret"}}, {{"custom_slug", "one"}, {"custom_slug", "two"}}} {
		if r := seeFileRequest(t, e, key, "file", fields); r.status != 400 {
			t.Fatalf("invalid upload: %d %s", r.status, r.body)
		}
	}
	entries, err := os.ReadDir(e.srv.opt.FilesDir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("failed uploads leaked files: %v %v", entries, err)
	}
	var first map[string]any
	for i, alias := range []string{"file", "smfile"} {
		data := seeData(t, seeFileRequest(t, e, key, alias, [][2]string{{"is_private", "0"}, {"custom_slug", fmt.Sprintf("file-%d", i)}}))
		if len(data["hash"].(string)) != 48 || data["page"] != fmt.Sprintf("https://short.example/p/file-%d", i) || !strings.HasPrefix(data["url"].(string), "https://files.example/") {
			t.Fatal(data)
		}
		if i == 0 {
			first = data
		}
		parsed, _ := url.Parse(data["url"].(string))
		rq := httptest.NewRequest("GET", parsed.String(), nil)
		rq.Host = "files.example"
		rw := httptest.NewRecorder()
		e.srv.ServeHTTP(rw, rq)
		if rw.Code != 200 || !bytes.Equal(rw.Body.Bytes(), []byte("public file\x00\xff")) {
			t.Fatal("download bytes differ")
		}
	}
	history := e.req("GET", "/api/v1/files", nil, "Authorization", key)
	rows := history.json()["data"].([]any)
	if len(rows) != 2 || history.json()["success"] != true || rows[1].(map[string]any)["hash"] != first["hash"] {
		t.Fatal(string(history.body))
	}
	if r := e.req("GET", "/api/v1/files?page=2", nil, "Authorization", key); fmt.Sprint(r.json()["data"]) != "[]" {
		t.Fatal(string(r.body))
	}
	parsed, _ := url.Parse(first["delete"].(string))
	path := parsed.Path
	if r := e.req("HEAD", path, nil, "Authorization", key); r.status != 405 {
		t.Fatal("HEAD deletion accepted")
	}
	if r := e.req("GET", path, nil); r.status != 401 || r.json()["code"] != "401" {
		t.Fatal("delete key alone authorized")
	}
	if r := e.visit("/p/file-0"); r.status != 200 {
		t.Fatal("HEAD removed file")
	}
	if r := e.req("GET", path, nil, "Authorization", key); r.status != 200 || r.json()["code"] != "200" || r.json()["success"] != true {
		t.Fatal(string(r.body))
	}
	if r := e.visit("/p/file-0"); r.status != 404 {
		t.Fatal("file still accessible")
	}
	if r := e.req("POST", fmt.Sprintf("/api/admin/v1/links/%.0f/restore", first["file_id"]), nil); r.status != 404 {
		t.Fatal("compat permanent deletion is restorable")
	}
}

func TestSeeCalendarPeriodsUseRecorderTimezone(t *testing.T) {
	e, key := seeEnv(t)
	loc := time.FixedZone("test", 14*3600)
	e.srv.clicks = clicks.New(e.srv.store, loc)
	l := e.create(map[string]any{"slug": "calendar", "url": "https://example.org"})
	id := int64(l["id"].(float64))
	now := time.Now().In(loc)
	today := e.srv.clicks.Day(now)
	first := today - int32(now.Day()-1)
	days := map[store.DayKey]int64{{LinkID: id, Day: first - 1}: 11, {LinkID: id, Day: today}: 3}
	if err := e.srv.store.ApplyClicks(context.Background(), &store.ClickBatch{Links: map[int64]store.LinkDelta{id: {Count: 14}}, Days: days}); err != nil {
		t.Fatal(err)
	}
	for period, want := range map[string]float64{"daily": 3, "monthly": 3, "totally": 14} {
		got := seeData(t, e.req("GET", "/api/v1/link/visit-stat?domain=short.example&slug=calendar&period="+period, nil, "Authorization", key))["visit_count"]
		if got != want {
			t.Fatalf("%s %v want %v", period, got, want)
		}
	}
}

func TestSeeMutationRechecksIdentityAfterConcurrentRename(t *testing.T) {
	for _, tc := range []struct {
		name, method, endpoint, renamed string
		want                            int
	}{
		{"delete-url", "DELETE", "/shorten", "renamed", 404},
		{"delete-text", "DELETE", "/text", "renamed", 404},
		{"delete-url-equivalent-slug", "DELETE", "/shorten", "CAFE\u0301", 200},
		{"delete-text-equivalent-slug", "DELETE", "/text", "CAFE\u0301", 200},
		{"file-stable-key", "GET", "/file/upload", "renamed", 200},
		{"put-url", "PUT", "/shorten", "renamed", 404},
		{"put-text", "PUT", "/text", "renamed", 404},
		{"put-url-equivalent-slug", "PUT", "/shorten", "CAFE\u0301", 200},
		{"put-text-equivalent-slug", "PUT", "/text", "CAFE\u0301", 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e, key := seeEnv(t)
			ctx := context.Background()
			const slug = "Café"
			var created map[string]any
			switch tc.endpoint {
			case "/shorten":
				created = seeData(t, e.req("POST", "/api/v1/shorten", map[string]string{"custom_slug": slug, "target_url": "https://example.org/kept"}, "Authorization", key))
			case "/text":
				created = seeData(t, e.req("POST", "/api/v1/text", map[string]string{"custom_slug": slug, "content": "kept text"}, "Authorization", key))
			default:
				created = seeData(t, seeFileRequest(t, e, key, "file", [][2]string{{"custom_slug", slug}}))
			}
			l, err := e.srv.store.LinkBySlug(ctx, links.Key(slug))
			if err != nil {
				t.Fatal(err)
			}
			day := e.srv.clicks.Day(time.Now())
			if err := e.srv.store.ApplyClicks(ctx, &store.ClickBatch{
				Links: map[int64]store.LinkDelta{l.ID: {Count: 7}},
				Days:  map[store.DayKey]int64{{LinkID: l.ID, Day: day}: 7},
				Refs:  map[store.RefKey]int64{{LinkID: l.ID, Host: "example.org"}: 7},
			}); err != nil {
				t.Fatal(err)
			}
			// Refresh used_at before locking so the blocked write is the mutation, not token bookkeeping.
			seeData(t, e.req("GET", "/api/v1/domains", nil, "Authorization", key))
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
			if _, err := tx.ExecContext(ctx, "UPDATE links SET slug = ?, slug_key = ? WHERE id = ?", tc.renamed, links.Key(tc.renamed), l.ID); err != nil {
				t.Fatal(err)
			}
			method, path := tc.method, "/api/v1"+tc.endpoint
			body := `{"domain":"short.example","slug":"` + slug + `"}`
			if method == "PUT" {
				field, value := "target_url", "https://example.org/updated"
				if l.Kind == store.KindText {
					field, value = "content", "updated text"
				}
				body = strings.TrimSuffix(body, "}") + `,"` + field + `":"` + value + `"}`
			}
			if l.Kind == store.KindFile {
				method, path, body = "GET", "/api/v1/file/delete/"+created["hash"].(string), ""
			}
			r := httptest.NewRequest(method, "https://short.example"+path, strings.NewReader(body))
			r.Header.Set("Authorization", key)
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			done := make(chan struct{})
			go func() { defer close(done); e.srv.ServeHTTP(w, r) }()
			t.Cleanup(func() {
				tx.Rollback()
				select {
				case <-done:
				case <-time.After(5 * time.Second):
					t.Error("mutation handler did not finish")
				}
			})
			// WAL exposes the old slug until the mutation has reached its write transaction.
			deadline := time.Now().Add(900 * time.Millisecond)
			for {
				_, writes := e.srv.store.PoolStats()
				if writes.InUse == 1 {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("mutation handler did not reach the blocked write")
				}
				time.Sleep(time.Millisecond)
			}
			if err := tx.Commit(); err != nil {
				t.Fatal(err)
			}
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("mutation handler timed out")
			}
			if w.Code != tc.want {
				t.Fatalf("%s: %d %s, want %d", method, w.Code, w.Body.String(), tc.want)
			}
			got, err := e.srv.store.GetLink(ctx, l.ID)
			wantCount := int64(0)
			if tc.want == 404 || method == "PUT" {
				wantCount = 7
				wantURL, wantText := l.URL, "kept text"
				if method == "PUT" && tc.want == 200 {
					if l.Kind == store.KindURL {
						wantURL = "https://example.org/updated"
					} else {
						wantText = "updated text"
					}
					if data := seeData(t, reply{status: w.Code, body: w.Body.Bytes()}); data["slug"] != tc.renamed {
						t.Fatalf("updated slug: %v", data)
					}
				}
				if err != nil || got.Slug != tc.renamed || got.Clicks != 7 || got.URL != wantURL {
					t.Fatalf("renamed resource changed: %+v %v", got, err)
				}
				if tc.want == 404 && got.UpdatedAt != l.UpdatedAt {
					t.Fatal("rejected mutation changed updated_at")
				}
				if l.Kind == store.KindText {
					if body, err := e.srv.store.TextBody(ctx, l.ID); err != nil || body != wantText {
						t.Fatalf("renamed text changed: %q %v", body, err)
					}
				}
			} else if !errors.Is(err, store.ErrNotFound) {
				t.Fatalf("resource was not deleted: %+v %v", got, err)
			}
			if counts, err := e.srv.store.Series(ctx, l.ID, day, day); err != nil || len(counts) != 1 || counts[0] != wantCount {
				t.Fatalf("daily counts: %v %v, want %d", counts, err, wantCount)
			}
			if _, total, err := e.srv.store.Referrers(ctx, l.ID, 8); err != nil || total != wantCount {
				t.Fatalf("referrers: %d %v, want %d", total, err, wantCount)
			}
		})
	}
}

func TestSeeRejectsInvalidUTF8BeforeWriting(t *testing.T) {
	e, key := seeEnv(t)
	ctx := context.Background()
	seeData(t, e.req("POST", "/api/v1/text", `{"custom_slug":"kept-text","content":"original","title":"original"}`, "Authorization", key))
	seeData(t, e.req("POST", "/api/v1/shorten", `{"custom_slug":"kept-url","target_url":"https://example.org/original","title":"original"}`, "Authorization", key))
	for _, tc := range []struct{ method, path, body string }{
		{"POST", "/text", `{"content":"before ` + "\xff" + ` after"}`},
		{"PUT", "/text", `{"domain":"short.example","slug":"kept-text","content":"before ` + "\xff" + ` after"}`},
		{"POST", "/shorten", `{"target_url":"https://example.org/` + "\xff" + `"}`},
		{"PUT", "/shorten", `{"domain":"short.example","slug":"kept-url","target_url":"https://example.org/` + "\xff" + `"}`},
		{"POST", "/shorten", `{"target_url":"https://example.org","title":"` + "\xff" + `"}`},
		{"PUT", "/text", `{"domain":"short.example","slug":"kept-text","content":"must not be written","title":"` + "\xff" + `"}`},
	} {
		// Send raw bytes: json.Marshal would replace the invalid byte in the test client.
		r := e.req(tc.method, "/api/v1"+tc.path, tc.body, "Authorization", key)
		if r.status != 400 || r.json()["error"] != "invalid_parameter" {
			t.Errorf("%s %s: %d %s", tc.method, tc.path, r.status, r.body)
		}
	}
	res, err := e.srv.store.ListLinks(ctx, store.ListQuery{})
	if err != nil || res.Total != 2 {
		t.Fatalf("invalid UTF-8 created resources: %+v %v", res, err)
	}
	for _, l := range res.Links {
		if l.Title != "original" {
			t.Errorf("invalid UTF-8 changed title: %q", l.Title)
		}
		if l.Kind == store.KindText {
			if body, err := e.srv.store.TextBody(ctx, l.ID); err != nil || body != "original" {
				t.Errorf("invalid UTF-8 changed text: %q %v", body, err)
			}
		} else if l.URL != "https://example.org/original" {
			t.Errorf("invalid UTF-8 changed target: %q", l.URL)
		}
	}

	for _, method := range []string{"POST", "PUT"} {
		value := "中文🙂�" + method
		identity := `"custom_slug":"valid-text"`
		if method == "PUT" {
			identity = `"domain":"short.example","slug":"valid-text"`
		}
		seeData(t, e.req(method, "/api/v1/text", `{`+identity+`,"content":"`+value+`","title":"`+value+`"}`, "Authorization", key))
		l, err := e.srv.store.LinkBySlug(ctx, "valid-text")
		if err != nil || l.Title != value {
			t.Fatalf("valid title changed: %+v %v", l, err)
		}
		if body, err := e.srv.store.TextBody(ctx, l.ID); err != nil || body != value {
			t.Fatalf("valid text bytes changed: %q %v", body, err)
		}
		identity = strings.ReplaceAll(identity, "valid-text", "valid-url")
		target := "https://example.org/" + value
		seeData(t, e.req(method, "/api/v1/shorten", `{`+identity+`,"target_url":"`+target+`"}`, "Authorization", key))
		l, err = e.srv.store.LinkBySlug(ctx, "valid-url")
		if err != nil || l.URL != target {
			t.Fatalf("valid target changed: %+v %v", l, err)
		}
	}
}
