package server

import (
	"net/url"
	"strings"
	"testing"
)

func TestAUD006EncodedShortURLSearch(t *testing.T) {
	const base = "https://short.example"
	e := newShareEnv(t, Options{BaseURL: base})
	for _, kind := range []string{"url", "text", "file"} {
		for _, slug := range []string{"ascii", "审计", "café"} {
			t.Run(kind+"/"+slug, func(t *testing.T) {
				slug += "-" + kind
				var created reply
				switch kind {
				case "url":
					created = e.req("POST", "/api/admin/v1/links", map[string]any{"slug": slug, "url": "https://destination.invalid/ordinary"})
				case "text":
					created = e.req("POST", "/api/admin/v1/texts", map[string]any{"slug": slug, "text": "Unrelated saved body"})
				case "file":
					created = e.upload(map[string]string{"slug": slug}, "fixture.txt", []byte("Unrelated bytes"))
				}
				if created.status != 201 {
					t.Fatalf("create: %d %s", created.status, created.body)
				}
				link := created.json()
				shortURL := link["shortUrl"].(string)
				encoded := strings.TrimSuffix(shortURL, slug) + url.PathEscape(slug)
				queries := []string{slug, shortURL, encoded, strings.TrimPrefix(encoded, base)}
				if kind != "url" {
					queries = append(queries, strings.TrimPrefix(encoded, base+"/"))
				}
				for _, query := range queries {
					r := e.req("GET", "/api/admin/v1/links?q="+url.QueryEscape(query), nil)
					if r.status != 200 {
						t.Fatalf("query %q: %d %s", query, r.status, r.body)
					}
					result := r.json()
					items := result["items"].([]any)
					if result["total"] != float64(1) || len(items) != 1 || items[0].(map[string]any)["id"] != link["id"] {
						t.Errorf("query %q must find ID %v: %s", query, link["id"], r.body)
					}
				}
			})
		}
	}
}

func TestAUD006SearchPreservesLiteralQueries(t *testing.T) {
	const base = "https://short.example"
	e := newEnv(t, Options{BaseURL: base})
	e.signIn()
	encoded := e.create(map[string]any{"slug": "encoded", "url": "https://destination.invalid/caf%C3%A9", "title": "Literal %C3%A9 %GG %FF"})
	unicode := e.create(map[string]any{"slug": "unicode", "url": "https://destination.invalid/ordinary", "title": "é"})
	for _, tt := range []struct {
		name, query string
		id          any
	}{
		{"external URL stays encoded", "https://destination.invalid/caf%C3%A9", encoded["id"]},
		{"plain search stays literal", "%C3%A9", encoded["id"]},
		{"decode short URL only once", base + "/%25C3%25A9", encoded["id"]},
		{"malformed escape stays literal", base + "/%GG", encoded["id"]},
		{"invalid UTF8 stays literal", base + "/%FF", encoded["id"]},
		{"ordinary Unicode search", "é", unicode["id"]},
	} {
		t.Run(tt.name, func(t *testing.T) {
			r := e.req("GET", "/api/admin/v1/links?q="+url.QueryEscape(tt.query), nil)
			result := r.json()
			items, ok := result["items"].([]any)
			if r.status != 200 || !ok || result["total"] != float64(1) || len(items) != 1 || items[0].(map[string]any)["id"] != tt.id {
				t.Errorf("query %q must find only ID %v: %d %s", tt.query, tt.id, r.status, r.body)
			}
		})
	}
}
