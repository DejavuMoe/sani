package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

func TestBUG04ImportExactIntegerSpellings(t *testing.T) {
	for _, format := range []string{"sani", "shlink-flat", "shlink-nested"} {
		t.Run(format, func(t *testing.T) {
			e := newEnv(t, Options{})
			e.signIn()
			for i, tc := range []struct {
				token string
				want  int64
			}{
				{"9007199254740993", 9007199254740993},
				{"9007199254740993.0", 9007199254740993},
				{"9.007199254740993e15", 9007199254740993},
				{"9223372036854775807.0", 9223372036854775807},
				{"9.223372036854775807e18", 9223372036854775807},
				{"1e3", 1000},
				{"0", 0},
				{"0.0", 0},
				{"0e1000000", 0},
				{`""`, 0},
				{`"   "`, 0},
			} {
				t.Run(tc.token, func(t *testing.T) {
					slug := fmt.Sprintf("exact%d", i)
					var body string
					switch format {
					case "sani":
						body = fmt.Sprintf(`{"app":"sani","version":1,"links":[{"slug":%q,"url":"https://example.invalid/a","clicks":%s,"maxClicks":%s}]}`, slug, tc.token, tc.token)
					case "shlink-flat":
						body = fmt.Sprintf(`[{"shortCode":%q,"longUrl":"https://example.invalid/a","visits":%s,"maxVisits":%s}]`, slug, tc.token, tc.token)
					case "shlink-nested":
						body = fmt.Sprintf(`{"shortUrls":{"data":[{"shortCode":%q,"longUrl":"https://example.invalid/a","visitsSummary":{"total":%s},"meta":{"maxVisits":%s}}]}}`, slug, tc.token, tc.token)
					}
					r := e.req("POST", "/api/admin/v1/import", body)
					if r.status != http.StatusOK || r.json()["created"] != float64(1) {
						t.Fatalf("import: %d %s", r.status, r.body)
					}
					// Decode export straight into int64; a float64 checker would hide the loss.
					var doc struct{ Links []exportLink }
					r = e.req("GET", "/api/admin/v1/export", nil)
					if err := json.Unmarshal(r.body, &doc); err != nil || r.status != http.StatusOK {
						t.Fatalf("export: %d %s (%v)", r.status, r.body, err)
					}
					for _, l := range doc.Links {
						if l.Slug == slug {
							if l.Clicks != tc.want || l.MaxClicks != tc.want {
								t.Errorf("%s: clicks=%d maxClicks=%d, want exactly %d", tc.token, l.Clicks, l.MaxClicks, tc.want)
							}
							return
						}
					}
					t.Fatalf("export omitted %s", slug)
				})
			}
		})
	}
}

func TestBUG04ImportRejectsInvalidCounters(t *testing.T) {
	e := newEnv(t, Options{})
	e.signIn()
	for _, field := range []string{"clicks", "maxClicks"} {
		for i, token := range []string{`1.5`, `9223372036854775808`, `9223372036854775808.0`, `1e1000000`, `"not-a-number"`, `-1`, `true`, `{}`, `[]`} {
			t.Run(field+"/"+token, func(t *testing.T) {
				slug := fmt.Sprintf("invalid%s%d", field, i)
				body := fmt.Sprintf(`{"app":"sani","version":1,"links":[{"slug":%q,"url":"https://example.invalid/a",%q:%s}]}`, slug, field, token)
				r := e.req("POST", "/api/admin/v1/import", body)
				var result struct {
					Created int
					Skipped []importProblem
				}
				if err := json.Unmarshal(r.body, &result); err != nil || r.status != http.StatusOK || result.Created != 0 || len(result.Skipped) != 1 {
					t.Fatalf("invalid %s must be reported as skipped: %d %s (%v)", field, r.status, r.body, err)
				}
				if result.Skipped[0].Reason == "" || result.Skipped[0].Slug != slug {
					t.Fatalf("missing row diagnostic: %+v", result.Skipped)
				}
			})
		}
	}
}

func TestBUG04ShlinkRejectsMalformedCounters(t *testing.T) {
	e := newEnv(t, Options{})
	e.signIn()
	for _, field := range []string{`"visitsSummary":{"total":%s}`, `"meta":{"maxVisits":%s}`} {
		for _, value := range []string{`1.5`, `1e1000000`, `"invalid"`, `true`, `{}`, `[]`} {
			t.Run(field+"/"+value, func(t *testing.T) {
				body := `[{"shortCode":"invalid","longUrl":"https://example.invalid/a",` + fmt.Sprintf(field, value) + `}]`
				r := e.req("POST", "/api/admin/v1/import", body)
				var result struct {
					Created int
					Skipped []importProblem
				}
				if err := json.Unmarshal(r.body, &result); err != nil || r.status != http.StatusOK || result.Created != 0 || len(result.Skipped) != 1 || result.Skipped[0].Reason == "" {
					t.Fatalf("invalid nested counter accepted: %d %s (%v)", r.status, r.body, err)
				}
			})
		}
	}
}
