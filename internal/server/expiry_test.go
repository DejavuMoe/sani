package server

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestExpiryBoundsAtEveryInput(t *testing.T) {
	const last = "9999-12-31T23:59:59.999Z"
	const maxMS = int64(253402300799999)
	for _, format := range []string{"json", "csv"} {
		t.Run(format, func(t *testing.T) {
			e := newEnv(t, Options{})
			e.signIn()
			for i, value := range []any{last, maxMS, "9999-12-31T23:59:59-01:00", maxMS + 1, int64(math.MaxInt64), int64(math.MinInt64), "not a date"} {
				slug := fmt.Sprintf("expiry%d", i)
				body, _ := json.Marshal(map[string]any{"app": "sani", "version": 1, "links": []map[string]any{{"url": "https://example.com/", "slug": slug, "expiresAt": value}}})
				if format == "csv" {
					body = []byte(fmt.Sprintf("url,slug,expires_at\nhttps://example.com/,%s,%v\n", slug, value))
				}
				r := e.req("POST", "/api/import", string(body))
				var result struct {
					Created int             `json:"created"`
					Skipped []importProblem `json:"skipped"`
				}
				if err := json.Unmarshal(r.body, &result); err != nil || r.status != http.StatusOK {
					t.Fatalf("import %v: %d %s", value, r.status, r.body)
				}
				if i < 2 {
					if result.Created != 1 || len(result.Skipped) != 0 {
						t.Fatalf("valid expiry rejected: %s", r.body)
					}
				} else if result.Created != 0 || len(result.Skipped) != 1 || result.Skipped[0].Reason != "expires_invalid" {
					t.Fatalf("invalid expiry silently accepted: %v: %s", value, r.body)
				}
			}
			all, err := e.srv.store.AllLinks(context.Background())
			if err != nil || len(all) != 2 {
				t.Fatalf("stored rows: %d, %v", len(all), err)
			}
			for _, l := range all {
				if l.ExpiresAt != maxMS {
					t.Fatalf("expiry changed: %d", l.ExpiresAt)
				}
				if r := e.req("GET", fmt.Sprintf("/api/links/%d", l.ID), nil); r.status != 200 || !json.Valid(r.body) || r.json()["expiresAt"] != last {
					t.Fatalf("detail broken: %d %s", r.status, r.body)
				}
			}
			for _, path := range []string{"/api/links", "/api/export"} {
				if r := e.req("GET", path, nil); r.status != 200 || !json.Valid(r.body) {
					t.Fatalf("%s broken: %d %s", path, r.status, r.body)
				}
			}
			if r := e.req("GET", "/api/export?format=csv", nil); r.status != 200 || !strings.Contains(string(r.body), "9999-12-31T23:59:59Z") {
				t.Fatalf("CSV export broken: %d %s", r.status, r.body)
			}
		})
	}

	e := newShareEnv(t, Options{})
	for _, expiry := range []string{last, "9999-12-31T23:59:59-01:00"} {
		want := http.StatusCreated
		if expiry != last {
			want = http.StatusBadRequest
		}
		for _, path := range []string{"/api/links", "/api/texts"} {
			body := map[string]any{"expiresAt": expiry}
			if path == "/api/links" {
				body["url"] = "https://example.com/"
			} else {
				body["text"] = "shared text"
			}
			r := e.req("POST", path, body)
			if r.status != want || !json.Valid(r.body) || want == 400 && r.code() != "expires_invalid" {
				t.Fatalf("%s %s: %d %s", path, expiry, r.status, r.body)
			}
		}
		r := e.upload(map[string]string{"expiresAt": expiry}, "expiry.txt", []byte("file"))
		if r.status != want || want == 400 && r.code() != "expires_invalid" {
			t.Fatalf("file expiry %s: %d %s", expiry, r.status, r.body)
		}
	}
	l := e.create(map[string]any{"url": "https://example.com/", "expiresAt": last})
	path := fmt.Sprintf("/api/links/%v", l["id"])
	for _, expiry := range []string{last, "9999-12-31T23:59:59-01:00"} {
		r := e.req("PATCH", path, map[string]any{"expiresAt": expiry})
		if expiry == last && (r.status != 200 || r.json()["expiresAt"] != last) || expiry != last && (r.status != 400 || r.code() != "expires_invalid") {
			t.Fatalf("patch expiry %s: %d %s", expiry, r.status, r.body)
		}
		if got := e.req("GET", path, nil).json()["expiresAt"]; got != last {
			t.Fatalf("rejected patch changed expiry: %v", got)
		}
	}
	for _, path := range []string{"/api/links", "/api/export"} {
		if r := e.req("GET", path, nil); r.status != 200 || !json.Valid(r.body) {
			t.Fatalf("%s broken after rejected writes: %d %s", path, r.status, r.body)
		}
	}
}

func TestWriteJSONFailureIsAnErrorResponse(t *testing.T) {
	w := httptest.NewRecorder()
	w.Header().Set("Content-Disposition", "attachment")
	writeJSON(w, http.StatusOK, time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC))
	var result struct {
		Error apiError `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || w.Code != 500 || result.Error.Code != "internal" || w.Header().Get("Content-Disposition") != "" {
		t.Fatalf("serialization failure: %d %s (%v)", w.Code, w.Body.String(), err)
	}
}

func TestWriteJSONEscapesHTMLWithoutChangingData(t *testing.T) {
	w := httptest.NewRecorder()
	want := map[string]string{"value": `<script>alert("中文")</script>&`}
	writeJSON(w, http.StatusCreated, want)
	if w.Code != http.StatusCreated || w.Header().Get("Content-Type") != "application/json; charset=utf-8" || w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("JSON response: %d %v", w.Code, w.Header())
	}
	if strings.ContainsAny(w.Body.String(), "<>&") {
		t.Fatalf("literal HTML in JSON: %s", w.Body.String())
	}
	var got map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || got["value"] != want["value"] {
		t.Fatalf("JSON data changed: %q (%v)", got, err)
	}
}
