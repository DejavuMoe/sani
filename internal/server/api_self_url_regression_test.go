package server

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBUG09DefaultPortSelfOrigins(t *testing.T) {
	e := newEnv(t, Options{BaseURL: "https://short.example"})
	for _, tc := range []struct {
		origin, dest string
		want         bool
	}{
		{"https://short.example", "https://short.example:443/loop", true},
		{"https://short.example:443", "https://short.example/loop", true},
		{"http://alias.example", "http://alias.example:80/loop", true},
		{"http://alias.example:80", "http://alias.example/loop", true},
		{"https://ALIAS.example", "https://alias.example:443/loop", true},
		{"http://[::1]", "http://[::1]:80/loop", true},
		{"http://internal.example:18765", "https://short.example:443/loop", true},
		{"https://short.example", "https://short.example:444/loop", false},
		{"http://alias.example:8080", "http://alias.example/loop", false},
		{"https://short.example", "https://other.example:443/loop", false},
		{"https://short.example", "https://short.example:443/", false},
		{"https://short.example", "https://short.example:443/admin", false},
		{"https://short.example", "https://short.example:443/api", false},
		{"https://short.example", "https://short.example:443/docs/page", false},
	} {
		t.Run(tc.origin+"->"+tc.dest, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, tc.origin+"/api/admin/v1/links", nil)
			if got := e.srv.pointsHere(r, tc.dest); got != tc.want {
				t.Errorf("pointsHere = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestBUG09SelfURLMutationAndImport(t *testing.T) {
	e, key := publicEnv(t)
	l := e.create(map[string]any{"slug": "existing", "url": "https://example.invalid/original"})
	for _, tc := range []struct{ method, path, body string }{
		{"POST", "/api/admin/v1/links", `{"slug":"admin-loop","url":"https://short.example:443/admin-loop"}`},
		{"PATCH", fmt.Sprintf("/api/admin/v1/links/%v", l["id"]), `{"url":"https://short.example:443/existing"}`},
		{"POST", "/api/v1/links", `{"custom_slug":"public-loop","target_url":"https://short.example:443/public-loop"}`},
		{"PATCH", "/api/v1/links/existing", `{"target_url":"https://short.example:443/existing"}`},
	} {
		t.Run(tc.method+tc.path, func(t *testing.T) {
			r := e.req(tc.method, tc.path, tc.body, "Authorization", key)
			if r.status != http.StatusBadRequest || r.code() != "url_self" {
				t.Errorf("self URL accepted: %d %s", r.status, r.body)
			}
		})
	}
	r := e.req("POST", "/api/admin/v1/import", `{"app":"sani","version":1,"links":[{"slug":"import-loop","url":"https://short.example:443/import-loop"}]}`)
	if r.status != http.StatusOK || r.json()["created"] != float64(0) {
		t.Errorf("self URL import accepted: %d %s", r.status, r.body)
	}
	r = e.req("GET", fmt.Sprintf("/api/admin/v1/links/%v", l["id"]), nil)
	if r.status != http.StatusOK || r.json()["url"] != "https://example.invalid/original" {
		t.Errorf("rejected updates changed destination: %d %s", r.status, r.body)
	}
}
