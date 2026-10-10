package server

import (
	"bytes"
	"context"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/DejavuMoe/sani/internal/auth"
)

func TestImportExamplesRequireAuth(t *testing.T) {
	for _, format := range []string{"csv", "json"} {
		t.Run(format, func(t *testing.T) {
			e := newEnv(t, Options{BaseURL: "https://s.example.com"})
			path := "/api/admin/v1/examples/sani." + format
			for _, headers := range [][]string{
				nil,
				{"Cookie", sessionCookie + "=invalid"},
				{"Authorization", "Bearer sani_invalid"},
			} {
				for _, method := range []string{"GET", "HEAD"} {
					r := e.req(method, path, nil, headers...)
					if r.status != http.StatusUnauthorized || r.header.Get("Cache-Control") != "no-store" {
						t.Fatalf("unauthenticated %s: %d %s", method, r.status, r.body)
					}
					if method == "GET" && r.code() != "unauthorized" {
						t.Fatalf("unauthenticated error: %s", r.body)
					}
				}
			}

			e.signIn()
			cookieURL, _ := url.Parse(e.ts.URL + path)
			cookie := e.c.Jar.Cookies(cookieURL)[0]
			r := e.req("GET", path, nil)
			if r.status != http.StatusOK || !bytes.Contains(r.body, []byte("https://example.com/guide")) {
				t.Fatalf("authenticated example: %d %s", r.status, r.body)
			}
			ctype := "application/json; charset=utf-8"
			if format == "csv" {
				ctype = "text/csv; charset=utf-8"
			}
			for header, want := range map[string]string{
				"Content-Type":           ctype,
				"Content-Disposition":    `attachment; filename="sani.` + format + `"`,
				"Cache-Control":          "no-store",
				"X-Content-Type-Options": "nosniff",
			} {
				if got := r.header.Get(header); got != want {
					t.Errorf("%s = %q, want %q", header, got, want)
				}
			}
			if head := e.req("HEAD", path, nil); head.status != http.StatusOK || len(head.body) != 0 || head.header.Get("Content-Length") != r.header.Get("Content-Length") {
				t.Fatalf("authenticated HEAD: %+v", head)
			}
			for _, headers := range [][]string{{"Range", "bytes=0-0"}, {"Range", "bytes=999999-"}, {"If-None-Match", "*"}} {
				if got := e.req("GET", path, nil, headers...); got.status != http.StatusOK || got.header.Get("Cache-Control") != "no-store" || !bytes.Equal(got.body, r.body) {
					t.Fatalf("conditional example: %d %s", got.status, got.body)
				}
			}
			if imported := e.req("POST", "/api/admin/v1/import", string(r.body), "Content-Type", ctype); imported.status != http.StatusOK || imported.json()["created"] != float64(1) {
				t.Fatalf("import example: %d %s", imported.status, imported.body)
			}
			if missing := e.req("GET", "/api/admin/v1/examples/missing.json", nil); missing.status != http.StatusNotFound || missing.code() != "not_found" {
				t.Fatalf("unknown example: %d %s", missing.status, missing.body)
			}
			token := e.req("POST", "/api/admin/v1/tokens", map[string]string{"name": "example test"})
			if token.status != http.StatusCreated {
				t.Fatalf("create token: %d %s", token.status, token.body)
			}
			if logout := e.req("DELETE", "/api/admin/v1/session", nil); logout.status != http.StatusNoContent {
				t.Fatalf("logout: %d %s", logout.status, logout.body)
			}
			if denied := e.req("GET", path, nil); denied.status != http.StatusUnauthorized {
				t.Fatalf("example after logout: %d %s", denied.status, denied.body)
			}
			if denied := e.req("GET", path, nil, "Cookie", cookie.String(), "Range", "bytes=0-0"); denied.status != http.StatusUnauthorized {
				t.Fatalf("revoked cookie: %d %s", denied.status, denied.body)
			}
			key := "Bearer " + token.json()["token"].(string)
			if got := e.req("GET", path, nil, "Authorization", key); got.status != http.StatusOK || !bytes.Equal(got.body, r.body) {
				t.Fatalf("token download: %d %s", got.status, got.body)
			}
			if err := e.srv.store.DeleteToken(context.Background(), int64(token.json()["id"].(float64))); err != nil {
				t.Fatal(err)
			}
			if got := e.req("GET", path, nil, "Authorization", key, "If-None-Match", "*"); got.status != http.StatusUnauthorized {
				t.Fatalf("revoked token: %d %s", got.status, got.body)
			}
			if login := e.req("POST", "/api/admin/v1/session", map[string]string{"password": "correct horse"}); login.status != http.StatusOK {
				t.Fatalf("login: %d %s", login.status, login.body)
			}
			cookie = e.c.Jar.Cookies(cookieURL)[0]
			now := time.Now().UnixMilli()
			if err := e.srv.store.TouchSession(context.Background(), auth.HashSecret(cookie.Value), now, now-1); err != nil {
				t.Fatal(err)
			}
			if got := e.req("GET", path, nil); got.status != http.StatusUnauthorized {
				t.Fatalf("expired session: %d %s", got.status, got.body)
			}
		})
	}
}

func TestAdminAppDoesNotServeImportExamples(t *testing.T) {
	e := newEnv(t, Options{})
	// A stale frontend build must not expose its old public example files.
	e.srv.web.assets["examples/sani.csv"] = &asset{body: []byte("private example")}
	e.srv.web.assets["examples/sani.json"] = &asset{body: []byte("private example")}
	for _, path := range []string{"/admin/examples/sani.csv", "/admin/examples/sani.json"} {
		for _, method := range []string{"GET", "HEAD"} {
			if r := e.req(method, path, nil); r.status != http.StatusNotFound {
				t.Errorf("%s %s: %d %s", method, path, r.status, r.body)
			}
		}
	}
}
