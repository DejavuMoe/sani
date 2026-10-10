package server

import (
	"net/http"
	"strings"
	"testing"
)

func TestAdminRoutesRequireAuthentication(t *testing.T) {
	e := newEnv(t, Options{})
	for _, route := range []string{
		"PUT /password", "POST /sessions/revoke",
		"GET /config", "PATCH /config", "POST /config/metadata/test",
		"GET /overview", "GET /tags", "POST /tags", "PATCH /tags/1", "DELETE /tags/1",
		"GET /links", "POST /links", "POST /links/bulk", "GET /links/1", "PATCH /links/1", "DELETE /links/1",
		"POST /links/1/restore", "POST /links/1/refresh", "GET /links/1/stats", "GET /links/1/text",
		"POST /texts", "POST /files", "POST /uploads", "PUT /uploads/1", "POST /uploads/1/complete", "DELETE /uploads/1",
		"GET /slugs/example", "GET /tokens", "POST /tokens", "DELETE /tokens/1",
		"GET /export", "GET /export?format=csv", "POST /import",
		"GET /examples/sani.csv", "GET /examples/sani.json", "GET /favicons/example.com",
	} {
		t.Run(route, func(t *testing.T) {
			method, path, _ := strings.Cut(route, " ")
			methods := []string{method}
			if method == http.MethodGet {
				methods = append(methods, http.MethodHead)
			}
			for _, method := range methods {
				r := e.req(method, "/api/admin/v1"+path, nil)
				if r.status != http.StatusUnauthorized || r.header.Get("Cache-Control") != "no-store" {
					t.Fatalf("%s %s: %d %s", method, path, r.status, r.body)
				}
				if method != http.MethodHead && r.code() != "unauthorized" {
					t.Fatalf("error: %s", r.body)
				}
			}
		})
	}
}
