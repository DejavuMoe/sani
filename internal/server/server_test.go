package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/DejavuMoe/sani/internal/clicks"
	"github.com/DejavuMoe/sani/internal/meta"
	"github.com/DejavuMoe/sani/internal/store"
)

type env struct {
	t   *testing.T
	srv *Server
	ts  *httptest.Server
	c   *http.Client
}

var testUI = fstest.MapFS{
	"index.html":         {Data: []byte(`<!doctype html><script>document.documentElement.dataset.x=1</script><div id=app></div>`)},
	"assets/app-1a2b.js": {Data: []byte(`console.log("app")`)},
	"favicon.svg":        {Data: []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`)},
}

func newEnv(t *testing.T, opt Options) *env {
	t.Helper()
	st, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "sani.db"))
	if err != nil {
		t.Fatal(err)
	}
	rec := clicks.New(st, time.UTC)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	if opt.CacheSize == 0 {
		opt.CacheSize = 1000
	}
	if opt.SetupCode == "" {
		opt.SetupCode = "test-code-1234"
	}
	s, err := New(opt, st, rec, meta.New(), testUI, log)
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(s)
	jar, _ := cookiejar.New(nil)
	e := &env{t: t, srv: s, ts: ts, c: &http.Client{
		Jar:           jar,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
	t.Cleanup(func() {
		ts.Close()
		s.Shutdown(context.Background())
		st.Close()
	})
	return e
}

type reply struct {
	status int
	header http.Header
	body   []byte
}

func (r reply) json() map[string]any {
	var m map[string]any
	json.Unmarshal(r.body, &m)
	return m
}

func (r reply) code() string {
	if e, ok := r.json()["error"].(map[string]any); ok {
		return fmt.Sprint(e["code"])
	}
	return ""
}

func (e *env) req(method, path string, body any, headers ...string) reply {
	e.t.Helper()
	var rd io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		rd = strings.NewReader(b)
	default:
		data, _ := json.Marshal(b)
		rd = bytes.NewReader(data)
	}
	req, _ := http.NewRequest(method, e.ts.URL+path, rd)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	resp, err := e.c.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return reply{status: resp.StatusCode, header: resp.Header, body: data}
}

// human is a browser-like User-Agent so redirects count as clicks.
const human = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15"

func (e *env) visit(path string, headers ...string) reply {
	e.t.Helper()
	return e.req("GET", path, nil, append([]string{"User-Agent", human}, headers...)...)
}

func (e *env) signIn() {
	e.t.Helper()
	if r := e.req("POST", "/api/setup", map[string]string{"password": "correct horse", "code": "TEST-CODE-1234"}); r.status != 200 {
		e.t.Fatalf("setup: %d %s", r.status, r.body)
	}
}

func (e *env) create(body map[string]any) map[string]any {
	e.t.Helper()
	r := e.req("POST", "/api/links", body)
	if r.status != 201 {
		e.t.Fatalf("create %v: %d %s", body, r.status, r.body)
	}
	return r.json()
}

func (e *env) flush() {
	e.srv.clicks.Flush(context.Background())
}

func TestSetupAndLogin(t *testing.T) {
	e := newEnv(t, Options{})
	if m := e.req("GET", "/api/session", nil).json(); m["needsSetup"] != true || m["authenticated"] != false {
		t.Fatalf("fresh session = %v", m)
	}
	if r := e.req("GET", "/api/links", nil); r.status != 401 {
		t.Fatalf("unauthenticated list = %d", r.status)
	}
	if r := e.req("POST", "/api/setup", map[string]string{"password": "correct horse"}); r.code() != "setup_code" {
		t.Fatalf("setup without the code: %s", r.body)
	}
	if r := e.req("POST", "/api/setup", map[string]string{"password": "correct horse", "code": "wrong-code-0000"}); r.status != 403 {
		t.Fatalf("setup with a wrong code: %d %s", r.status, r.body)
	}
	if r := e.req("POST", "/api/setup", map[string]string{"password": "short", "code": "test code 1234"}); r.code() != "password_short" {
		t.Fatalf("short password: %s", r.body)
	}
	e.signIn()
	if r := e.req("POST", "/api/setup", map[string]string{"password": "another password", "code": "test-code-1234"}); r.status != 409 {
		t.Fatalf("second setup = %d", r.status)
	}
	if m := e.req("GET", "/api/session", nil).json(); m["authenticated"] != true || m["needsSetup"] != false {
		t.Fatalf("after setup = %v", m)
	}

	if r := e.req("DELETE", "/api/session", nil); r.status != 204 {
		t.Fatalf("logout = %d", r.status)
	}
	if m := e.req("GET", "/api/session", nil).json(); m["authenticated"] != false {
		t.Fatal("still signed in after logout")
	}
	if r := e.req("POST", "/api/session", map[string]string{"password": "wrong password"}); r.code() != "wrong_password" {
		t.Fatalf("wrong password: %d %s", r.status, r.body)
	}
	if r := e.req("POST", "/api/session", map[string]string{"password": "correct horse"}); r.status != 200 {
		t.Fatalf("login = %d %s", r.status, r.body)
	}
	if r := e.req("GET", "/api/links", nil); r.status != 200 {
		t.Fatalf("list after login = %d", r.status)
	}

	// Change the password; the current session survives.
	r := e.req("PUT", "/api/password", map[string]string{"current": "correct horse", "password": "battery staple"})
	if r.status != 204 {
		t.Fatalf("change password = %d %s", r.status, r.body)
	}
	if r := e.req("GET", "/api/links", nil); r.status != 200 {
		t.Fatal("current session lost after password change")
	}
}

func TestLoginRateLimit(t *testing.T) {
	e := newEnv(t, Options{})
	e.signIn()
	e.req("DELETE", "/api/session", nil)
	var last reply
	for range 9 {
		last = e.req("POST", "/api/session", map[string]string{"password": "nope nope"})
	}
	if last.status != 429 || last.header.Get("Retry-After") == "" {
		t.Fatalf("after 9 failures: %d %s", last.status, last.body)
	}
	if r := e.req("POST", "/api/session", map[string]string{"password": "correct horse"}); r.status != 429 {
		t.Fatal("a locked-out client must wait even with the right password")
	}
}

func TestCreateAndRedirect(t *testing.T) {
	e := newEnv(t, Options{ForwardQuery: true, SlugLength: 5})
	e.signIn()

	l := e.create(map[string]any{"url": "example.com/docs?lang=en#intro"})
	slug := l["slug"].(string)
	if len(slug) != 5 || l["url"] != "https://example.com/docs?lang=en#intro" || l["status"] != "active" {
		t.Fatalf("created %v", l)
	}
	if l["shortUrl"] != e.ts.URL+"/"+slug {
		t.Errorf("shortUrl = %v", l["shortUrl"])
	}

	r := e.visit("/" + slug)
	if r.status != 302 || r.header.Get("Location") != "https://example.com/docs?lang=en#intro" {
		t.Fatalf("redirect = %d %q", r.status, r.header.Get("Location"))
	}
	if cc := r.header.Get("Cache-Control"); !strings.Contains(cc, "max-age=0") {
		t.Errorf("temporary redirect Cache-Control = %q", cc)
	}
	if r := e.visit("/" + strings.ToUpper(slug) + "/?utm_source=x"); r.header.Get("Location") != "https://example.com/docs?lang=en&utm_source=x#intro" {
		t.Errorf("case-insensitive + query forwarding: %q", r.header.Get("Location"))
	}

	// Not counted: HEAD, crawlers, previews, prefetches and dashboard tests.
	e.req("HEAD", "/"+slug, nil, "User-Agent", human)
	e.req("GET", "/"+slug, nil, "User-Agent", "Mozilla/5.0 (compatible; Googlebot/2.1)")
	e.req("GET", "/"+slug, nil, "User-Agent", "TelegramBot (like TwitterBot)")
	e.req("GET", "/"+slug, nil)
	e.visit("/"+slug, "Sec-Purpose", "prefetch")
	e.visit("/"+slug, "Referer", e.ts.URL+"/admin/")
	e.visit("/"+slug, "Referer", "https://t.co/xyz")

	e.flush()
	got := e.req("GET", fmt.Sprintf("/api/links/%v", l["id"]), nil).json()
	if got["clicks"] != float64(3) {
		t.Errorf("clicks = %v, want 3", got["clicks"])
	}
	stats := e.req("GET", fmt.Sprintf("/api/links/%v/stats?days=7", l["id"]), nil).json()
	days := stats["days"].([]any)
	if len(days) != 7 || days[6].(map[string]any)["count"] != float64(3) {
		t.Errorf("stats days = %v", days)
	}
	refs := stats["referrers"].([]any)
	if len(refs) != 2 || refs[0].(map[string]any)["host"] != "" || refs[0].(map[string]any)["count"] != float64(2) {
		t.Errorf("referrers = %v", refs)
	}
	ov := e.req("GET", "/api/overview?days=7", nil).json()
	if ov["links"] != float64(1) || ov["clicks"] != float64(3) || ov["today"] != float64(3) {
		t.Errorf("overview = %v", ov)
	}

	if r := e.visit("/doesnotexist"); r.status != 404 || !strings.Contains(string(r.body), "doesn’t exist") {
		t.Errorf("unknown slug: %d", r.status)
	}
	if r := e.visit("/doesnotexist", "Accept-Language", "zh-CN,zh;q=0.9"); !strings.Contains(string(r.body), "这个短链接不存在") {
		t.Error("the not-found page should follow Accept-Language")
	}
	if r := e.visit("/a/b"); r.status != 404 {
		t.Errorf("nested path = %d", r.status)
	}
	if r := e.req("POST", "/"+slug, nil); r.status != 405 {
		t.Errorf("POST to a short link = %d", r.status)
	}
}

func TestCustomSlugsAndValidation(t *testing.T) {
	e := newEnv(t, Options{})
	e.signIn()
	e.create(map[string]any{"url": "https://github.com", "slug": "gh"})

	cases := []struct {
		body map[string]any
		code string
	}{
		{map[string]any{"url": "https://x.com", "slug": "GH"}, "slug_taken"},
		{map[string]any{"url": "https://x.com", "slug": "admin"}, "slug_reserved"},
		{map[string]any{"url": "https://x.com", "slug": "a b"}, "slug_invalid"},
		{map[string]any{"url": "javascript:alert(1)"}, "url_scheme"},
		{map[string]any{"url": "nope"}, "url_invalid"},
		{map[string]any{}, "url_required"},
		{map[string]any{"url": "https://x.com", "redirect": 303}, "redirect_invalid"},
		{map[string]any{"url": "https://x.com", "expiresAt": "tomorrow"}, "expires_invalid"},
		{map[string]any{"url": "https://x.com", "expiresAt": "2001-01-01T00:00:00Z"}, "expires_past"},
		{map[string]any{"url": "https://x.com", "maxClicks": 1.5}, "max_clicks_invalid"},
		{map[string]any{"url": e.ts.URL + "/gh"}, "url_self"},
	}
	for _, c := range cases {
		if r := e.req("POST", "/api/links", c.body); r.code() != c.code {
			t.Errorf("%v: got %d %s, want %s", c.body, r.status, r.body, c.code)
		}
	}

	check := func(slug string) map[string]any { return e.req("GET", "/api/slugs/"+slug, nil).json() }
	if m := check("gh"); m["available"] != false || m["reason"] != "slug_taken" {
		t.Errorf("check gh = %v", m)
	}
	if m := check("fresh"); m["available"] != true {
		t.Errorf("check fresh = %v", m)
	}
	if m := check("%E7%AE%80%E5%8E%86"); m["available"] != true {
		t.Errorf("check 简历 = %v", m)
	}

	l := e.create(map[string]any{"url": "https://example.com/cv", "slug": "简历", "title": "  My   CV "})
	if l["title"] != "My CV" || l["meta"] != "manual" {
		t.Errorf("title handling: %v", l)
	}
	if r := e.visit("/%E7%AE%80%E5%8E%86"); r.status != 302 {
		t.Errorf("unicode slug redirect = %d", r.status)
	}
}

func TestLimitsAndCacheInvalidation(t *testing.T) {
	e := newEnv(t, Options{})
	e.signIn()
	l := e.create(map[string]any{"url": "https://a.example", "slug": "once", "maxClicks": 2})
	id := fmt.Sprint(l["id"])

	e.visit("/once", "User-Agent", "curl/8.0") // bots never use up a limit
	for i := range 2 {
		if r := e.visit("/once"); r.status != 302 {
			t.Fatalf("visit %d = %d", i+1, r.status)
		}
	}
	if r := e.visit("/once"); r.status != 410 {
		t.Fatalf("visit past the limit = %d", r.status)
	}
	if r := e.visit("/once", "User-Agent", "curl/8.0"); r.status != 410 {
		t.Fatal("an exhausted link must be gone for bots too")
	}
	e.flush()
	if m := e.req("GET", "/api/links/"+id, nil).json(); m["status"] != "exhausted" || m["clicks"] != float64(2) {
		t.Errorf("exhausted link = %v", m)
	}

	// Raising the limit reopens it; the change must bypass the cache.
	e.req("PATCH", "/api/links/"+id, map[string]any{"maxClicks": nil})
	if r := e.visit("/once"); r.status != 302 {
		t.Fatalf("after clearing the limit = %d", r.status)
	}
	e.req("PATCH", "/api/links/"+id, map[string]any{"enabled": false})
	if r := e.visit("/once"); r.status != 410 {
		t.Fatalf("disabled link = %d", r.status)
	}
	e.req("PATCH", "/api/links/"+id, map[string]any{"enabled": true, "url": "https://b.example", "redirect": 301})
	r := e.visit("/once")
	if r.status != 301 || r.header.Get("Location") != "https://b.example" || !strings.Contains(r.header.Get("Cache-Control"), "public") {
		t.Fatalf("after edit: %d %q %q", r.status, r.header.Get("Location"), r.header.Get("Cache-Control"))
	}

	// Renaming frees the old slug immediately.
	e.req("PATCH", "/api/links/"+id, map[string]any{"slug": "twice"})
	if r := e.visit("/once"); r.status != 404 {
		t.Errorf("old slug after rename = %d", r.status)
	}
	if r := e.visit("/twice"); r.status != 301 {
		t.Errorf("new slug after rename = %d", r.status)
	}

	// Expiry is enforced on the cached entry.
	exp := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	e.req("PATCH", "/api/links/"+id, map[string]any{"expiresAt": exp})
	if r := e.visit("/twice"); r.status != 301 {
		t.Fatalf("before expiry = %d", r.status)
	}
	past := time.Now().Add(-time.Minute).UnixMilli()
	if _, _, err := e.srv.store.UpdateLink(context.Background(), int64(l["id"].(float64)), store.Patch{ExpiresAt: &past}, past); err != nil {
		t.Fatal(err)
	}
	e.srv.cache.Invalidate("twice")
	if r := e.visit("/twice"); r.status != 410 {
		t.Errorf("after expiry = %d", r.status)
	}
}

func TestDeleteAndRestore(t *testing.T) {
	e := newEnv(t, Options{})
	e.signIn()
	l := e.create(map[string]any{"url": "https://a.example", "slug": "gone"})
	id := fmt.Sprint(l["id"])
	e.visit("/gone") // cache it
	if r := e.req("DELETE", "/api/links/"+id, nil); r.status != 204 {
		t.Fatalf("delete = %d", r.status)
	}
	if r := e.visit("/gone"); r.status != 404 {
		t.Fatalf("deleted link = %d", r.status)
	}
	if r := e.req("GET", "/api/links/"+id, nil); r.status != 404 {
		t.Fatalf("GET deleted = %d", r.status)
	}
	if r := e.req("POST", "/api/links/"+id+"/restore", nil); r.status != 200 {
		t.Fatalf("restore = %d %s", r.status, r.body)
	}
	if r := e.visit("/gone"); r.status != 302 {
		t.Fatalf("restored link = %d", r.status)
	}
}

func TestCrossOriginRefused(t *testing.T) {
	e := newEnv(t, Options{})
	e.signIn()
	body := map[string]any{"url": "https://evil.example"}
	if r := e.req("POST", "/api/links", body, "Sec-Fetch-Site", "cross-site"); r.status != 403 {
		t.Errorf("cross-site fetch = %d", r.status)
	}
	if r := e.req("POST", "/api/links", body, "Origin", "https://evil.example"); r.status != 403 {
		t.Errorf("foreign Origin = %d", r.status)
	}
	if r := e.req("POST", "/api/links", body, "Sec-Fetch-Site", "same-origin"); r.status != 201 {
		t.Errorf("same-origin = %d", r.status)
	}
}

func TestAPITokens(t *testing.T) {
	e := newEnv(t, Options{})
	e.signIn()
	tok := e.req("POST", "/api/tokens", map[string]string{"name": "Shortcuts"}).json()
	secret, _ := tok["token"].(string)
	if !strings.HasPrefix(secret, "sani_") || len(secret) != 48 {
		t.Fatalf("token = %v", tok)
	}
	list := e.req("GET", "/api/tokens", nil)
	if strings.Contains(string(list.body), secret) {
		t.Fatal("token list must not reveal secrets")
	}

	anon := &http.Client{}
	create := func(auth string) int {
		req, _ := http.NewRequest("POST", e.ts.URL+"/api/links", strings.NewReader(`{"url":"https://api.example"}`))
		req.Header.Set("Authorization", auth)
		resp, err := anon.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if s := create("Bearer " + secret); s != 201 {
		t.Fatalf("token create = %d", s)
	}
	if s := create("Bearer sani_wrong"); s != 401 {
		t.Fatalf("bad token = %d", s)
	}
	e.req("DELETE", fmt.Sprintf("/api/tokens/%v", tok["id"]), nil)
	if s := create("Bearer " + secret); s != 401 {
		t.Fatalf("revoked token = %d", s)
	}
}

func TestImportExport(t *testing.T) {
	e := newEnv(t, Options{})
	e.signIn()
	e.create(map[string]any{"url": "https://taken.example", "slug": "taken"})

	csv := "Short Code,Long URL,Title,Visits\nblog,https://blog.example,My blog,12\ntaken,https://x.example,,\n,https://noslug.example,,\nbad,javascript:alert(1),,\n"
	r := e.req("POST", "/api/import", csv, "Content-Type", "text/csv")
	m := r.json()
	if m["created"] != float64(2) || len(m["skipped"].([]any)) != 2 {
		t.Fatalf("csv import = %s", r.body)
	}

	shlink := `{"shortUrls":{"data":[{"shortCode":"steam","longUrl":"https://store.steampowered.com",
		"dateCreated":"2016-08-21T20:34:16+02:00","visitsSummary":{"total":328},"meta":{"maxVisits":1000}}]}}`
	if m := e.req("POST", "/api/import", shlink).json(); m["created"] != float64(1) {
		t.Fatalf("shlink import = %v", m)
	}
	if r := e.visit("/steam"); r.header.Get("Location") != "https://store.steampowered.com" {
		t.Fatalf("imported link redirect = %d", r.status)
	}

	exp := e.req("GET", "/api/export", nil)
	var doc struct {
		Links []exportLink `json:"links"`
	}
	json.Unmarshal(exp.body, &doc)
	if len(doc.Links) != 4 || !strings.Contains(exp.header.Get("Content-Disposition"), "attachment") {
		t.Fatalf("export has %d links", len(doc.Links))
	}
	var steam exportLink
	for _, l := range doc.Links {
		if l.Slug == "steam" {
			steam = l
		}
	}
	// 328 imported visits plus the one redirect above.
	if steam.Clicks != 329 || steam.MaxClicks != 1000 || steam.CreatedAt.Year() != 2016 {
		t.Errorf("steam round trip = %+v", steam)
	}
	if r := e.req("GET", "/api/export?format=csv", nil); !strings.HasPrefix(string(r.body), "slug,url,title") {
		t.Errorf("csv export = %.60s", r.body)
	}
}

func TestConfig(t *testing.T) {
	e := newEnv(t, Options{})
	e.signIn()
	if m := e.req("GET", "/api/config", nil).json(); m["baseUrlSource"] != "request" || m["baseUrl"] != e.ts.URL {
		t.Fatalf("config = %v", m)
	}
	if r := e.req("PATCH", "/api/config", map[string]any{"baseUrl": "https://s.example.com/path"}); r.code() != "base_url_invalid" {
		t.Fatalf("path in base URL: %s", r.body)
	}
	m := e.req("PATCH", "/api/config", map[string]any{"baseUrl": "https://S.Example.com/"}).json()
	if m["baseUrl"] != "https://s.example.com" || m["baseUrlSource"] != "setting" {
		t.Fatalf("patched config = %v", m)
	}
	if l := e.create(map[string]any{"url": "https://x.example", "slug": "x"}); l["shortUrl"] != "https://s.example.com/x" {
		t.Errorf("shortUrl with base = %v", l["shortUrl"])
	}
	if r := e.req("GET", "/api/links?q=https://s.example.com/x", nil); r.json()["total"] != float64(1) {
		t.Errorf("searching by short URL: %s", r.body)
	}

	fixed := newEnv(t, Options{BaseURL: "https://sani.example"})
	fixed.signIn()
	if r := fixed.req("PATCH", "/api/config", map[string]any{"baseUrl": "https://other.example"}); r.status != 409 {
		t.Errorf("env base URL must not be overridable: %d", r.status)
	}
}

func TestAdminApp(t *testing.T) {
	e := newEnv(t, Options{})
	if r := e.req("GET", "/", nil); r.status != 302 || r.header.Get("Location") != "/admin/" {
		t.Errorf("root = %d %q", r.status, r.header.Get("Location"))
	}
	if r := e.req("GET", "/admin", nil); r.status != 301 {
		t.Errorf("/admin = %d", r.status)
	}
	r := e.req("GET", "/admin/settings", nil)
	csp := r.header.Get("Content-Security-Policy")
	if r.status != 200 || !strings.Contains(string(r.body), `id=app`) || !strings.Contains(csp, "'sha256-") {
		t.Fatalf("client route: %d, CSP %q", r.status, csp)
	}
	scriptSrc, _, _ := strings.Cut(strings.Split(csp, "script-src")[1], ";")
	if strings.Contains(scriptSrc, "unsafe-inline") {
		t.Error("scripts must not be allowed inline")
	}
	a := e.req("GET", "/admin/assets/app-1a2b.js", nil)
	if a.status != 200 || !strings.Contains(a.header.Get("Cache-Control"), "immutable") {
		t.Errorf("asset: %d %q", a.status, a.header.Get("Cache-Control"))
	}
	if again := e.req("GET", "/admin/assets/app-1a2b.js", nil, "If-None-Match", a.header.Get("ETag")); again.status != 304 {
		t.Errorf("conditional asset request = %d", again.status)
	}
	if r := e.req("GET", "/admin/assets/missing.js", nil); r.status != 404 {
		t.Errorf("missing asset = %d", r.status)
	}
	if r := e.req("GET", "/favicon.svg", nil); r.status != 200 {
		t.Errorf("root favicon = %d", r.status)
	}
	if r := e.req("GET", "/robots.txt", nil); !strings.Contains(string(r.body), "Disallow: /admin/") {
		t.Error("robots.txt")
	}

	rr := newEnv(t, Options{RootRedirect: "https://home.example"})
	if r := rr.req("GET", "/", nil); r.header.Get("Location") != "https://home.example" {
		t.Errorf("root redirect = %q", r.header.Get("Location"))
	}
}

func TestMetaFetchRefusesPrivateTargets(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, "<title>internal dashboard</title>")
	}))
	defer origin.Close()
	e := newEnv(t, Options{FetchMeta: true})
	e.signIn()
	l := e.create(map[string]any{"url": origin.URL + "/secret"})
	var m map[string]any
	for range 50 {
		m = e.req("GET", fmt.Sprintf("/api/links/%v", l["id"]), nil).json()
		if m["meta"] != "pending" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if m["meta"] != "failed" || m["title"] != "" {
		t.Fatalf("fetching a loopback destination: %v", m)
	}
}

func TestClientIP(t *testing.T) {
	s := &Server{opt: Options{TrustProxy: true}}
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "127.0.0.1:5555"
	r.Header.Set("X-Real-IP", "6.6.6.6") // passed through from the client
	r.Header.Add("X-Forwarded-For", "6.6.6.6, 7.7.7.7")
	r.Header.Add("X-Forwarded-For", "203.0.113.9")
	if ip := s.clientIP(r); ip != "203.0.113.9" {
		t.Errorf("clientIP = %s, want the proxy-appended address", ip)
	}
	s.opt.TrustProxy = false
	if ip := s.clientIP(r); ip != "127.0.0.1" {
		t.Errorf("untrusted clientIP = %s", ip)
	}
}

func TestReferrersAreBounded(t *testing.T) {
	e := newEnv(t, Options{})
	e.signIn()
	l := e.create(map[string]any{"url": "https://a.example", "slug": "popular"})
	// Batches smaller than the in-memory cap, so the store's cap is what
	// stops the table from growing.
	for i := range 300 {
		e.visit("/popular", "Referer", fmt.Sprintf("https://spam%d.example/", i))
		if i%50 == 49 {
			e.flush()
		}
	}
	refs, total, err := e.srv.store.Referrers(context.Background(), int64(l["id"].(float64)), 1000)
	if err != nil {
		t.Fatal(err)
	}
	other := int64(0)
	for _, r := range refs {
		if r.Host == store.OtherReferrer {
			other = r.Count
		}
	}
	if len(refs) != store.MaxReferrers+1 || total != 300 || other != 300-store.MaxReferrers {
		t.Fatalf("%d referrer rows, %d clicks, %d under other", len(refs), total, other)
	}
}

func TestReferrerHost(t *testing.T) {
	cases := map[string]string{
		"":                               "",
		"https://t.co/abc":               "t.co",
		"https://WWW.Example.com:8443/x": "example.com",
		"android-app://com.slack/":       "com.slack",
		"https://user:pw@host.com/":      "host.com",
		"not a url":                      "",
		"https://exa mple.com/":          "",
	}
	for in, want := range cases {
		if got := referrerHost(in); got != want {
			t.Errorf("referrerHost(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestMergeQuery(t *testing.T) {
	cases := [][3]string{
		{"https://a.com", "x=1", "https://a.com?x=1"},
		{"https://a.com/?b=2", "x=1", "https://a.com/?b=2&x=1"},
		{"https://a.com/#f", "x=1", "https://a.com/?x=1#f"},
		{"https://a.com/?", "x=1", "https://a.com/?x=1"},
	}
	for _, c := range cases {
		if got := mergeQuery(c[0], c[1]); got != c[2] {
			t.Errorf("mergeQuery(%q, %q) = %q", c[0], c[1], got)
		}
	}
}

// BenchmarkRedirect measures the full handler for a cached link, without
// the network.
func BenchmarkRedirect(b *testing.B) {
	st, err := store.Open(context.Background(), filepath.Join(b.TempDir(), "sani.db"))
	if err != nil {
		b.Fatal(err)
	}
	defer st.Close()
	rec := clicks.New(st, time.UTC)
	s, _ := New(Options{CacheSize: 1000}, st, rec, meta.New(), testUI, slog.New(slog.NewTextHandler(io.Discard, nil)))
	now := time.Now().UnixMilli()
	st.CreateLink(context.Background(), &store.Link{Slug: "bench", URL: "https://example.com/landing", Redirect: 302,
		Enabled: true, CreatedAt: now, UpdatedAt: now}, true)

	b.ReportAllocs()
	b.RunParallel(func(pb *testing.PB) {
		req := httptest.NewRequest("GET", "/bench", nil)
		req.Header.Set("User-Agent", human)
		req.Header.Set("Referer", "https://t.co/abc")
		for pb.Next() {
			w := &discardWriter{h: http.Header{}}
			s.ServeHTTP(w, req)
			if w.code != 302 {
				b.Fatalf("status %d", w.code)
			}
		}
	})
}

type discardWriter struct {
	h    http.Header
	code int
}

func (w *discardWriter) Header() http.Header         { return w.h }
func (w *discardWriter) Write(p []byte) (int, error) { return len(p), nil }
func (w *discardWriter) WriteHeader(code int)        { w.code = code }
