package server

import (
	"fmt"
	"net/url"
	"strings"
	"testing"
)

// form posts an access password the way the unlock page does.
func (e *env) form(path, password string, headers ...string) reply {
	e.t.Helper()
	return e.req("POST", path, url.Values{"password": {password}}.Encode(),
		append([]string{"Content-Type", "application/x-www-form-urlencoded", "User-Agent", human}, headers...)...)
}

func TestPasswordInput(t *testing.T) {
	e := newShareEnv(t, Options{})
	l := e.create(map[string]any{"url": "https://example.com/a", "slug": "guarded", "password": "  7KQ2MX  "})
	if l["password"] != "7KQ2MX" {
		t.Fatalf("password not trimmed or returned: %v", l["password"])
	}
	for _, bad := range []string{"abc", strings.Repeat("x", 65), "ab\x00cd"} {
		if r := e.req("POST", "/api/admin/v1/links", map[string]any{"url": "https://example.com/b", "password": bad}); r.code() != "password_invalid" {
			t.Fatalf("password %q: %d %s", bad, r.status, r.body)
		}
	}
	id := l["id"]
	if r := e.req("PATCH", "/api/admin/v1/links/"+fmt.Sprint(id), map[string]any{"password": ""}); r.status != 200 || r.json()["password"] != nil {
		t.Fatalf("remove password: %d %s", r.status, r.body)
	}
	// A protected link never stands in for a plain one.
	e.create(map[string]any{"url": "https://example.com/c", "password": "abcd"})
	if r := e.req("POST", "/api/admin/v1/links", map[string]any{"url": "https://example.com/c", "reuse": true}); r.status != 201 {
		t.Fatalf("reused a protected link: %d %s", r.status, r.body)
	}
	text := e.req("POST", "/api/admin/v1/texts", map[string]any{"text": "secret", "password": "abcd"}).json()
	if text["password"] != "abcd" || text["content"].(map[string]any)["rawUrl"] != nil {
		t.Fatalf("protected text exposes a raw URL: %v", text)
	}
	file := e.upload(map[string]string{"password": "efgh"}, "a.txt", []byte("bytes")).json()
	if file["password"] != "efgh" {
		t.Fatalf("upload password: %v", file)
	}
}

func TestPasswordRedirect(t *testing.T) {
	e := newShareEnv(t, Options{})
	l := e.create(map[string]any{"url": "https://example.com/dest", "slug": "gate", "password": "7KQ2MX"})
	r := e.visit("/gate")
	if r.status != 200 || !strings.Contains(string(r.body), `name="password"`) || strings.Contains(string(r.body), "example.com/dest") {
		t.Fatalf("form: %d %s", r.status, r.body)
	}
	// Browsers check form-action on the redirect that follows the form.
	if !strings.Contains(r.header.Get("Content-Security-Policy"), "form-action 'self' https://example.com;") || r.header.Get("Cache-Control") != "no-store" {
		t.Fatalf("form headers: %v", r.header)
	}
	if r := e.form("/gate", "WRONG1"); r.status != 403 {
		t.Fatalf("wrong password: %d", r.status)
	}
	if r := e.form("/gate", ""); r.status != 400 {
		t.Fatalf("empty password: %d", r.status)
	}
	if e.clicksOf(l["id"]) != 0 {
		t.Fatal("a failed attempt counted as a visit")
	}
	r = e.form("/gate", "7kq2mx", "Referer", e.ts.URL+"/gate")
	if r.status != 303 || r.header.Get("Location") != "https://example.com/dest" || r.header.Get("Cache-Control") != "no-store" {
		t.Fatalf("right password: %d %v", r.status, r.header)
	}
	if e.clicksOf(l["id"]) != 1 {
		t.Fatal("the unlocked visit was not counted")
	}
	// Nothing is remembered for redirects.
	if r := e.visit("/gate"); r.status != 200 {
		t.Fatalf("second visit skipped the form: %d", r.status)
	}
	// POST stays refused for links without a password.
	e.create(map[string]any{"url": "https://example.com/open", "slug": "open"})
	if r := e.form("/open", "x"); r.status != 405 {
		t.Fatalf("POST to a plain link: %d", r.status)
	}
}

func TestPasswordRateLimit(t *testing.T) {
	e := newShareEnv(t, Options{})
	e.create(map[string]any{"url": "https://example.com", "slug": "brute", "password": "7KQ2MX"})
	for i := 0; i < 5; i++ {
		if r := e.form("/brute", "nope"); r.status != 403 {
			t.Fatalf("attempt %d: %d", i, r.status)
		}
	}
	r := e.form("/brute", "7KQ2MX")
	if r.status != 429 || r.header.Get("Retry-After") == "" {
		t.Fatalf("after five failures: %d %v", r.status, r.header)
	}
}

func TestPasswordShareAndFiles(t *testing.T) {
	e := newShareEnv(t, Options{})
	l := e.req("POST", "/api/admin/v1/texts", map[string]any{"text": "the secret body", "slug": "note", "password": "abcd"}).json()
	if r := e.visit("/p/note"); r.status != 200 || strings.Contains(string(r.body), "secret body") {
		t.Fatalf("locked share leaked: %d %s", r.status, r.body)
	}
	if r := e.files("GET", "/note"); r.status != 403 {
		t.Fatalf("raw text without a token: %d", r.status)
	}
	r := e.form("/p/note", "ABCD")
	if r.status != 303 || r.header.Get("Location") != "/p/note" {
		t.Fatalf("unlock: %d %v", r.status, r.header)
	}
	cookie := r.header.Get("Set-Cookie")
	if !strings.Contains(cookie, "Path=/p/note") || !strings.Contains(cookie, "HttpOnly") || !strings.Contains(cookie, "SameSite=Lax") {
		t.Fatalf("cookie: %s", cookie)
	}
	page := e.visit("/p/note")
	if page.status != 200 || !strings.Contains(string(page.body), "the secret body") {
		t.Fatalf("unlocked share: %d %s", page.status, page.body)
	}
	if e.clicksOf(l["id"]) != 1 {
		t.Fatal("opening the unlocked share did not count once")
	}
	i := strings.Index(string(page.body), "?t=")
	if i < 0 {
		t.Fatal("raw link has no token")
	}
	token := string(page.body[i+3:])
	token = token[:strings.IndexAny(token, `"&`)]
	if r := e.files("GET", "/note?t="+token); r.status != 200 || string(r.body) != "the secret body" {
		t.Fatalf("raw with token: %d %s", r.status, r.body)
	}
	if r := e.files("GET", "/note?t="+token[:len(token)-2]+"AA"); r.status != 403 {
		t.Fatalf("forged token: %d", r.status)
	}
	// A new password locks the share again and voids earlier tokens.
	e.req("PATCH", "/api/admin/v1/links/"+fmt.Sprint(l["id"]), map[string]any{"password": "efgh"})
	if r := e.visit("/p/note"); strings.Contains(string(r.body), "secret body") {
		t.Fatal("old cookie still opens the share")
	}
	if r := e.files("GET", "/note?t="+token); r.status != 403 {
		t.Fatalf("old token after a password change: %d", r.status)
	}
}

func TestPasswordExportImport(t *testing.T) {
	e := newShareEnv(t, Options{})
	e.create(map[string]any{"url": "https://example.com/x", "slug": "kept", "password": "7KQ2MX"})
	exported := e.req("GET", "/api/admin/v1/export", nil)
	if !strings.Contains(string(exported.body), `"password":"7KQ2MX"`) {
		t.Fatalf("export: %s", exported.body)
	}
	other := newShareEnv(t, Options{})
	if r := other.req("POST", "/api/admin/v1/import", string(exported.body)); r.status != 200 || r.json()["created"] != float64(1) {
		t.Fatalf("import: %d %s", r.status, r.body)
	}
	if r := other.visit("/kept"); r.status != 200 || !strings.Contains(string(r.body), `name="password"`) {
		t.Fatalf("imported link lost its password: %d", r.status)
	}
	if r := other.req("POST", "/api/admin/v1/import", `{"app":"sani","version":1,"links":[{"url":"https://example.com/y","password":"ab"}]}`); r.json()["created"] != float64(0) {
		t.Fatalf("invalid imported password accepted: %s", r.body)
	}
}
