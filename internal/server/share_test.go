package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

const filesHost = "files.test"

func newShareEnv(t *testing.T, opt Options) *env {
	t.Helper()
	opt.FilesURL = "http://" + filesHost
	if opt.FilesDir == "" {
		opt.FilesDir = t.TempDir()
	}
	e := newEnv(t, opt)
	e.signIn()
	return e
}

// files requests a path on the files origin.
func (e *env) files(method, path string, headers ...string) reply {
	e.t.Helper()
	req, _ := http.NewRequest(method, e.ts.URL+path, nil)
	req.Host = filesHost
	req.Header.Set("User-Agent", human)
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

func (e *env) upload(fields map[string]string, filename string, data []byte) reply {
	e.t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range fields {
		mw.WriteField(k, v)
	}
	if filename != "" {
		fw, _ := mw.CreateFormFile("file", filename)
		fw.Write(data)
	}
	mw.Close()
	return e.req("POST", "/api/files", buf.String(), "Content-Type", mw.FormDataContentType())
}

func (e *env) clicksOf(id any) float64 {
	e.t.Helper()
	e.flush()
	return e.req("GET", fmt.Sprintf("/api/links/%v", id), nil).json()["clicks"].(float64)
}

func TestTextShare(t *testing.T) {
	e := newShareEnv(t, Options{})
	text := "<b>hi</b>\n\tline two\n"
	r := e.req("POST", "/api/texts", map[string]any{"text": text, "format": "code"})
	if r.status != 201 {
		t.Fatalf("create text: %d %s", r.status, r.body)
	}
	l := r.json()
	slug := l["slug"].(string)
	c := l["content"].(map[string]any)
	switch {
	case l["kind"] != "text" || len(slug) != sharedSlugLength:
		t.Fatalf("created %v", l)
	case !strings.HasSuffix(l["shortUrl"].(string), "/p/"+slug):
		t.Fatalf("shortUrl = %v", l["shortUrl"])
	case c["format"] != "code" || c["lines"] != 2.0 || c["preview"] != "<b>hi</b>" || c["size"] != float64(len(text)):
		t.Fatalf("content = %v", c)
	case c["rawUrl"] != "http://files.test/"+slug:
		t.Fatalf("rawUrl = %v", c["rawUrl"])
	}

	page := e.visit("/p/" + slug)
	if page.status != 200 || !strings.Contains(string(page.body), "&lt;b&gt;hi&lt;/b&gt;") || strings.Contains(string(page.body), "<b>hi") {
		t.Fatalf("page %d:\n%s", page.status, page.body)
	}
	if csp := page.header.Get("Content-Security-Policy"); !strings.Contains(csp, "script-src 'sha256-") || !strings.Contains(csp, "default-src 'none'") {
		t.Errorf("page CSP = %q", csp)
	}
	if r := e.visit("/" + slug); r.status != 404 {
		t.Errorf("text at the root = %d", r.status)
	}

	raw := e.files("GET", "/"+slug)
	if raw.status != 200 || string(raw.body) != text || raw.header.Get("Content-Type") != "text/plain; charset=utf-8" {
		t.Fatalf("raw %d %q %v", raw.status, raw.body, raw.header)
	}
	if raw.header.Get("X-Content-Type-Options") != "nosniff" || !strings.Contains(raw.header.Get("Content-Security-Policy"), "sandbox") {
		t.Errorf("raw headers = %v", raw.header)
	}
	if d := e.files("GET", "/"+slug+"/x").header.Get("Content-Disposition"); d != `attachment; filename="`+slug+`.txt"` {
		t.Errorf("download disposition = %q", d)
	}
	if n := e.clicksOf(l["id"]); n != 3 {
		t.Errorf("visits = %v, want the page and two raw fetches", n)
	}

	if body := e.req("GET", fmt.Sprintf("/api/links/%v/text", l["id"]), nil).json()["text"]; body != text {
		t.Errorf("text endpoint = %q", body)
	}
	r = e.req("PATCH", fmt.Sprintf("/api/links/%v", l["id"]), map[string]any{"text": "second\n", "format": "plain", "title": "Notes"})
	if c := r.json()["content"].(map[string]any); r.status != 200 || c["preview"] != "second" || c["format"] != "plain" || r.json()["title"] != "Notes" {
		t.Fatalf("edit text: %d %s", r.status, r.body)
	}
	if raw := e.files("GET", "/"+slug); string(raw.body) != "second\n" {
		t.Errorf("raw after edit = %q", raw.body)
	}

	link := e.create(map[string]any{"url": "https://example.com"})
	for _, tc := range []struct {
		path string
		body map[string]any
		code string
	}{
		{fmt.Sprintf("/api/links/%v", l["id"]), map[string]any{"url": "https://example.com"}, "kind_mismatch"},
		{fmt.Sprintf("/api/links/%v", link["id"]), map[string]any{"text": "x"}, "kind_mismatch"},
		{fmt.Sprintf("/api/links/%v", l["id"]), map[string]any{"format": "markdown"}, "format_invalid"},
		{fmt.Sprintf("/api/links/%v", l["id"]), map[string]any{"text": " \n "}, "text_required"},
	} {
		if r := e.req("PATCH", tc.path, tc.body); r.code() != tc.code {
			t.Errorf("PATCH %v: %d %s, want %s", tc.body, r.status, r.body, tc.code)
		}
	}
	if r := e.req("POST", fmt.Sprintf("/api/links/%v/refresh", l["id"]), nil); r.code() != "kind_mismatch" {
		t.Errorf("refresh a text: %d %s", r.status, r.body)
	}
	if r := e.req("POST", "/api/texts", map[string]any{"text": strings.Repeat("x", 1<<20+1)}); r.status != 413 || r.code() != "text_too_large" {
		t.Errorf("oversized text: %d %s", r.status, r.code())
	}
	if r := e.req("POST", "/api/texts", map[string]any{"slug": "x"}); r.code() != "text_required" {
		t.Errorf("no text: %s", r.code())
	}
}

func TestTextViewLimit(t *testing.T) {
	e := newShareEnv(t, Options{})
	l := e.req("POST", "/api/texts", map[string]any{"text": "once", "maxClicks": 1, "slug": "secret"}).json()
	if l["slug"] != "secret" {
		t.Fatalf("custom slug: %v", l)
	}
	// A link preview fetches the page without using up the one view.
	if r := e.req("GET", "/p/secret", nil, "User-Agent", "Slackbot-LinkExpanding 1.0"); r.status != 200 {
		t.Fatalf("preview = %d", r.status)
	}
	if r := e.visit("/p/secret"); r.status != 200 {
		t.Fatalf("first view = %d", r.status)
	}
	if r := e.visit("/p/secret"); r.status != 410 {
		t.Fatalf("second view = %d", r.status)
	}
	if r := e.files("GET", "/secret"); r.status != 410 {
		t.Fatalf("raw after the last view = %d", r.status)
	}
	if r := e.visit("/p/nothing-here"); r.status != 404 || !strings.Contains(string(r.body), "Nothing is shared here") {
		t.Errorf("missing share = %d", r.status)
	}
}

func TestFileShare(t *testing.T) {
	dir := t.TempDir()
	e := newShareEnv(t, Options{FilesDir: dir, MaxFileBytes: 4096})
	data := []byte("%PDF-1.4\n" + strings.Repeat("x", 600))
	r := e.upload(map[string]string{"title": "Quarterly report"}, "report.pdf", data)
	if r.status != 201 {
		t.Fatalf("upload: %d %s", r.status, r.body)
	}
	l := r.json()
	slug := l["slug"].(string)
	c := l["content"].(map[string]any)
	sum := sha256.Sum256(data)
	switch {
	case l["kind"] != "file" || l["title"] != "Quarterly report":
		t.Fatalf("created %v", l)
	case c["name"] != "report.pdf" || c["type"] != "application/pdf" || c["size"] != float64(len(data)) || c["sha256"] != hex.EncodeToString(sum[:]):
		t.Fatalf("content = %v", c)
	case c["rawUrl"] != "http://files.test/"+slug+"/report.pdf":
		t.Fatalf("rawUrl = %v", c["rawUrl"])
	}
	stored, _ := os.ReadDir(dir)
	if len(stored) != 1 || !storedName(stored[0].Name()) {
		t.Fatalf("files directory = %v", stored)
	}

	if page := e.visit("/p/" + slug); page.status != 200 || !strings.Contains(string(page.body), "report.pdf") {
		t.Fatalf("page %d", page.status)
	}
	got := e.files("GET", "/"+slug+"/report.pdf", "User-Agent", "curl/8.9")
	switch {
	case got.status != 200 || !bytes.Equal(got.body, data):
		t.Fatalf("download %d, %d bytes", got.status, len(got.body))
	case got.header.Get("Content-Disposition") != `attachment; filename="report.pdf"`:
		t.Errorf("disposition = %q", got.header.Get("Content-Disposition"))
	case got.header.Get("ETag") != `"`+hex.EncodeToString(sum[:])+`"` || got.header.Get("Cross-Origin-Resource-Policy") != "same-origin":
		t.Errorf("headers = %v", got.header)
	}
	if part := e.files("GET", "/"+slug, "Range", "bytes=9-"); part.status != 206 || !bytes.Equal(part.body, data[9:]) {
		t.Fatalf("resumed download = %d", part.status)
	}
	if n := e.clicksOf(l["id"]); n != 1 {
		t.Errorf("downloads = %v; the page and the resumed part don't count", n)
	}

	// Names lose their directories and control characters.
	r = e.upload(nil, "../../季度\u202e报告.txt", []byte("hello"))
	if c := r.json()["content"].(map[string]any); c["name"] != "季度报告.txt" {
		t.Fatalf("sanitized name = %v", c["name"])
	}
	d := e.files("GET", "/"+r.json()["slug"].(string)).header.Get("Content-Disposition")
	if !strings.Contains(d, "filename*=UTF-8''%E5%AD%A3%E5%BA%A6") {
		t.Errorf("UTF-8 disposition = %q", d)
	}

	if r := e.upload(nil, "big.bin", make([]byte, 5000)); r.status != 413 || r.code() != "file_too_large" {
		t.Errorf("oversized upload: %d %s", r.status, r.code())
	}
	if r := e.upload(nil, "empty.txt", nil); r.code() != "file_required" {
		t.Errorf("empty upload: %s", r.code())
	}
	if r := e.upload(map[string]string{"slug": "admin"}, "a.txt", []byte("a")); r.code() != "slug_reserved" {
		t.Errorf("reserved slug: %s", r.code())
	}
	if stored, _ := os.ReadDir(dir); len(stored) != 2 {
		t.Errorf("failed uploads left files behind: %v", stored)
	}

	if items := e.req("GET", "/api/links?kind=file&q=report", nil).json()["items"].([]any); len(items) != 1 {
		t.Errorf("kind filter and name search found %d", len(items))
	}
	if links := e.req("GET", "/api/export", nil).json()["links"]; links != nil && len(links.([]any)) != 0 {
		t.Errorf("export includes shares: %v", links)
	}

	// Deleting the link frees the file once the link is purged.
	e.req("DELETE", fmt.Sprintf("/api/links/%v", l["id"]), nil)
	if r := e.files("GET", "/"+slug); r.status != 404 {
		t.Errorf("deleted file = %d", r.status)
	}
	later := time.Now().Add(2 * time.Hour)
	e.srv.store.PurgeDeleted(context.Background(), later.UnixMilli())
	e.srv.sweepFiles(context.Background(), later)
	if stored, _ := os.ReadDir(dir); len(stored) != 1 {
		t.Errorf("after the purge = %v", stored)
	}
}

func TestFilesOriginServesOnlyShares(t *testing.T) {
	e := newShareEnv(t, Options{})
	for _, p := range []string{"/admin/", "/api/links", "/healthz", "/"} {
		if r := e.files("GET", p); r.status != 404 || strings.Contains(string(r.body), "<") {
			t.Errorf("files origin %s = %d %q", p, r.status, r.body)
		}
	}
	if r := e.files("POST", "/x"); r.status != 405 {
		t.Errorf("POST = %d", r.status)
	}
	if r := e.files("GET", "/robots.txt"); !strings.Contains(string(r.body), "Disallow: /") {
		t.Errorf("robots.txt = %q", r.body)
	}
	if r := e.req("PATCH", "/api/config", map[string]any{"baseUrl": "https://files.test"}); r.code() != "base_url_invalid" {
		t.Errorf("base URL on the files host: %s", r.code())
	}
}

func TestSharingFilesNeedsFilesURL(t *testing.T) {
	e := newEnv(t, Options{})
	e.signIn()
	if r := e.upload(nil, "a.txt", []byte("a")); r.status != 409 || r.code() != "files_disabled" {
		t.Fatalf("upload without files origin: %d %s", r.status, r.code())
	}
	l := e.req("POST", "/api/texts", map[string]any{"text": "still works"}).json()
	if l["content"].(map[string]any)["rawUrl"] != nil {
		t.Errorf("rawUrl without files origin = %v", l["content"])
	}
	if r := e.visit("/p/" + l["slug"].(string)); r.status != 200 || !strings.Contains(string(r.body), "still works") {
		t.Errorf("page = %d", r.status)
	}
}
