package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DejavuMoe/sani/internal/store"
)

func TestCreationSettingsPersistenceAndPrecedence(t *testing.T) {
	e := newEnv(t, Options{FetchMeta: true})
	e.signIn()
	r := e.req("PATCH", "/api/admin/v1/config", `{"slugLength":3,"excludeConfusable":false,"maxFileSize":200000000,"metaMode":"off"}`)
	if r.status != 200 || r.json()["fetchMeta"] != false || r.json()["maxFileSize"] != float64(200_000_000) {
		t.Fatal(string(r.body))
	}
	if err := e.srv.loadSettings(); err != nil {
		t.Fatal(err)
	}
	if cfg := e.srv.settings.Load(); cfg.slugLength != 3 || cfg.excludeConfusable || cfg.metaMode != "off" {
		t.Fatalf("stored config: %+v", cfg)
	}
	l := e.create(map[string]any{"url": "https://example.com"})
	if len(l["slug"].(string)) != 3 {
		t.Fatal(l)
	}
	text := e.req("POST", "/api/admin/v1/texts", `{"text":"hello"}`)
	if len(text.json()["slug"].(string)) < 10 {
		t.Fatal(string(text.body))
	}
	for _, body := range []string{`{"slugLength":2}`, `{"maxFileSize":99000001}`, `{"maxFileSize":4097000000}`, `{"metaMode":"invalid"}`, `{"slugLength":7,"baseUrl":"not an origin"}`} {
		if r := e.req("PATCH", "/api/admin/v1/config", body); r.status != 400 {
			t.Fatal(string(r.body))
		}
	}
	if r := e.req("PATCH", "/api/admin/v1/config", `{"metaMode":"proxy"}`); r.code() != "proxy_missing" {
		t.Fatal(string(r.body))
	}
	if e.srv.settings.Load().slugLength != 3 {
		t.Fatal("invalid patch partially committed")
	}
	e.srv.opt.SlugLengthFromEnv = true
	e.srv.opt.SlugLength = 9
	if err := e.srv.loadSettings(); err != nil {
		t.Fatal(err)
	}
	if cfg := e.srv.settings.Load(); cfg.slugLength != 9 || cfg.sources["slugLength"] != "env" {
		t.Fatal(cfg)
	}
	if r := e.req("PATCH", "/api/admin/v1/config", `{"slugLength":5,"maxFileSize":1000000}`); r.code() != "config_env" {
		t.Fatal(string(r.body))
	}
	if e.srv.settings.Load().maxFileSize != 200_000_000 {
		t.Fatal("locked patch partially committed")
	}
}

func TestUploadCredentialReuseAndReceiptCapacity(t *testing.T) {
	e := newShareEnv(t, Options{})
	a := e.req("POST", "/api/admin/v1/tokens", `{"name":"a"}`).json()
	authA := "Bearer " + a["token"].(string)
	r := e.req("POST", "/api/admin/v1/uploads", `{"name":"x","size":1}`, "Authorization", authA)
	path := "/api/admin/v1/uploads/" + r.json()["id"].(string)
	e.req("DELETE", fmt.Sprintf("/api/admin/v1/tokens/%v", a["id"]), nil)
	b := e.req("POST", "/api/admin/v1/tokens", `{"name":"b"}`).json()
	if a["id"] != b["id"] {
		t.Fatal("fixture did not reuse the token ID")
	}
	for _, tc := range []struct{ method, path string }{{"PUT", path}, {"POST", path + "/complete"}, {"DELETE", path}} {
		if r := e.req(tc.method, tc.path, "x", "Authorization", "Bearer "+b["token"].(string), "Upload-Offset", "0"); r.code() != "upload_not_found" {
			t.Fatal(string(r.body))
		}
	}
	for range 34 {
		r := e.req("POST", "/api/admin/v1/uploads", `{"name":"x","size":1}`)
		if r.status != 201 {
			t.Fatal(string(r.body))
		}
		path := "/api/admin/v1/uploads/" + r.json()["id"].(string)
		if r := e.req("PUT", path, "x", "Upload-Offset", "0"); r.status != 200 {
			t.Fatal(string(r.body))
		}
		if r := e.req("POST", path+"/complete", nil); r.status != 201 {
			t.Fatal(string(r.body))
		}
		if r := e.req("POST", path+"/complete", nil); r.status != 200 {
			t.Fatal("recent receipt lost", string(r.body))
		}
	}
	if len(e.srv.uploads) > 32 {
		t.Fatal("unbounded receipts")
	}
}

func TestDisabledRefreshKeepsCachedMetadata(t *testing.T) {
	for _, mode := range []string{"off", "proxy"} {
		t.Run(mode, func(t *testing.T) {
			e := newEnv(t, Options{})
			e.signIn()
			l := &store.Link{Slug: "cached", URL: "https://example.com", Title: "Cached title", Meta: store.MetaOK, Enabled: true, Redirect: 302, CreatedAt: 1, UpdatedAt: 1}
			if err := e.srv.store.CreateLink(context.Background(), l, true); err != nil {
				t.Fatal(err)
			}
			e.srv.store.SetSetting(context.Background(), store.SettingCreation, fmt.Sprintf(`{"metaMode":%q}`, mode))
			if err := e.srv.loadSettings(); err != nil {
				t.Fatal(err)
			}
			r := e.req("POST", fmt.Sprintf("/api/admin/v1/links/%d/refresh", l.ID), nil)
			if r.status != 200 || r.json()["title"] != "Cached title" || r.json()["meta"] != "ok" {
				t.Fatal(string(r.body))
			}
		})
	}
}

func TestChunkUploadRetryOwnershipAndFinalize(t *testing.T) {
	e := newShareEnv(t, Options{FilesDir: t.TempDir()})
	r := e.req("POST", "/api/admin/v1/uploads", `{"name":"hello.txt","size":11,"slug":"chunk-file"}`)
	if r.status != 201 {
		t.Fatal(string(r.body))
	}
	id := r.json()["id"].(string)
	path := "/api/admin/v1/uploads/" + id
	if r := e.req("POST", path+"/complete", nil); r.code() != "upload_incomplete" {
		t.Fatal(string(r.body))
	}
	for _, tc := range []struct{ offset, body, code string }{
		{"0", "hello ", ""}, {"0", "hello ", ""}, {"0", "HELLO ", "upload_offset"}, {"8", "bad", "upload_offset"}, {"6", "world", ""},
	} {
		r := e.req("PUT", path, tc.body, "Upload-Offset", tc.offset)
		if r.code() != tc.code || tc.code == "" && r.status != 200 {
			t.Fatalf("chunk: %d %s", r.status, r.body)
		}
	}
	token := e.req("POST", "/api/admin/v1/tokens", `{"name":"other principal"}`).json()["token"].(string)
	if r := e.req("DELETE", path, nil, "Authorization", "Bearer "+token); r.code() != "upload_not_found" {
		t.Fatal(string(r.body))
	}
	if count, _, _ := e.srv.store.Totals(context.Background()); count != 0 {
		t.Fatal("incomplete upload was visible")
	}
	r = e.req("POST", path+"/complete", nil)
	if r.status != 201 {
		t.Fatalf("complete %d %s", r.status, r.body)
	}
	firstID := r.json()["id"]
	r = e.req("POST", path+"/complete", nil)
	if r.status != 200 || r.json()["id"] != firstID {
		t.Fatal("completion was not idempotent", string(r.body))
	}
	l, err := e.srv.store.GetLink(context.Background(), int64(firstID.(float64)))
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(e.srv.opt.FilesDir, l.Content.File))
	sum := sha256.Sum256([]byte("hello world"))
	if err != nil || string(got) != "hello world" || hex.EncodeToString(l.Content.SHA256) != hex.EncodeToString(sum[:]) {
		t.Fatal("stored file differs", err)
	}
	if r := e.req("DELETE", path, nil); r.status != 204 {
		t.Fatal(string(r.body))
	}
	if _, err := os.Stat(filepath.Join(e.srv.opt.FilesDir, l.Content.File)); err != nil {
		t.Fatal("cancel deleted a completed share", err)
	}
}

func TestChunkUploadBoundsCleanupAndFailure(t *testing.T) {
	e := newShareEnv(t, Options{FilesDir: t.TempDir()})
	if r := e.req("POST", "/api/admin/v1/uploads", `{"name":"x","size":99000001}`); r.code() != "file_too_large" {
		t.Fatal(string(r.body))
	}
	ids := []string{}
	for range 2 {
		r := e.req("POST", "/api/admin/v1/uploads", `{"name":"x","size":2}`)
		if r.status != 201 {
			t.Fatal(string(r.body))
		}
		ids = append(ids, r.json()["id"].(string))
	}
	if r := e.req("POST", "/api/admin/v1/uploads", `{"name":"x","size":2}`); r.code() != "upload_limit" {
		t.Fatal(string(r.body))
	}
	path := "/api/admin/v1/uploads/" + ids[0]
	if r := e.req("PUT", path, "abc", "Upload-Offset", "0"); r.code() != "upload_invalid" {
		t.Fatal(string(r.body))
	}
	// A failed disk open cannot advance the acknowledged offset.
	if err := os.Remove(e.srv.uploadPath(ids[0])); err != nil {
		t.Fatal(err)
	}
	if r := e.req("PUT", path, "ab", "Upload-Offset", "0"); r.status != 500 {
		t.Fatal(string(r.body))
	}
	if e.srv.uploads[ids[0]].offset != 0 {
		t.Fatal("advanced failed chunk")
	}
	e.req("DELETE", path, nil)
	e.srv.expireUploads(time.Now().Add(2 * time.Hour))
	if len(e.srv.uploads) != 0 {
		t.Fatal("sessions were not reclaimed")
	}
	if files, _ := os.ReadDir(e.srv.opt.FilesDir); len(files) != 0 {
		t.Fatal("expired bytes remain", files)
	}
	id := strings.Repeat("a", 32)
	os.WriteFile(e.srv.uploadPath(id), []byte("abandoned"), 0600)
	if err := e.srv.cleanRestartUploads(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(e.srv.uploadPath(id)); !os.IsNotExist(err) {
		t.Fatal("restart fragment remains")
	}
}

func TestRemovedImportFormatsDoNotWrite(t *testing.T) {
	e := newEnv(t, Options{})
	e.signIn()
	for _, body := range []string{
		`{"links":[{"slug":"x","url":"https://example.com"}]}`,
		`{"data":[{"slug":"x","destination":"https://example.com"}]}`,
		`[{"keyword":"x","url":"https://example.com","tags":["bad"]}]`,
		`{"app":"other","version":1,"links":[{"slug":"x","url":"https://example.com"}]}`,
		"keyword,url\nx,https://example.com\n", "shortCode,longUrl\nx,https://example.com\n",
		"slug,url\nx,https://example.com\ninvalid\n", "slug,url,url\nx,https://example.com,https://example.com\n",
	} {
		r := e.req("POST", "/api/admin/v1/import", body)
		if r.code() != "import_unreadable" {
			t.Fatalf("accepted unsupported input: %s: %s", body, r.body)
		}
	}
	if count, clicks, _ := e.srv.store.Totals(context.Background()); count != 0 || clicks != 0 {
		t.Fatal("rejected imports wrote links")
	}
	if catalog, _ := e.srv.store.Tags(context.Background()); len(catalog.Items) != 0 {
		t.Fatal("rejected imports wrote tags")
	}
}

func TestTagRenameRecolorReferences(t *testing.T) {
	e := newEnv(t, Options{})
	e.signIn()
	id := e.req("POST", "/api/admin/v1/tags", `{"name":"work","color":"#ABCDEF"}`).json()["id"]
	l := e.create(map[string]any{"url": "https://example.com", "tags": []any{id}})
	r := e.req("PATCH", fmt.Sprintf("/api/admin/v1/tags/%v", id), `{"name":"Work renamed","color":"#5872a5"}`)
	if r.status != 200 || r.json()["count"] != float64(1) {
		t.Fatal(string(r.body))
	}
	if tags := e.req("GET", fmt.Sprintf("/api/admin/v1/links/%v", l["id"]), nil).json()["tags"].([]any); len(tags) != 1 || tags[0] != id {
		t.Fatal(tags)
	}
	e.req("POST", "/api/admin/v1/tags", `{"name":"taken"}`)
	if r := e.req("PATCH", fmt.Sprintf("/api/admin/v1/tags/%v", id), `{"name":"TAKEN","color":"blue"}`); r.code() != "tag_taken" {
		t.Fatal(string(r.body))
	}
	for _, color := range []string{"red", "#abc", "#abcdef00", "var(--x)", "#zzzzzz"} {
		if r := e.req("PATCH", fmt.Sprintf("/api/admin/v1/tags/%v", id), map[string]string{"name": "work", "color": color}); r.code() != "tags_invalid" {
			t.Fatal(string(r.body))
		}
	}
}

type heldChunk struct {
	entered, release chan struct{}
	body             io.Reader
}

func (b *heldChunk) Read(p []byte) (int, error) {
	if b.entered != nil {
		close(b.entered)
		b.entered = nil
		<-b.release
	}
	return b.body.Read(p)
}
func TestSlowAndTruncatedChunkDoesNotBlockOtherUploads(t *testing.T) {
	e := newShareEnv(t, Options{FilesDir: t.TempDir()})
	id := e.req("POST", "/api/admin/v1/uploads", `{"name":"one","size":2}`).json()["id"].(string)
	other := e.req("POST", "/api/admin/v1/uploads", `{"name":"two","size":1}`).json()["id"].(string)
	entered, release := make(chan struct{}), make(chan struct{})
	req := httptest.NewRequest("PUT", e.ts.URL+"/api/admin/v1/uploads/"+id, &heldChunk{entered, release, strings.NewReader("a")})
	req.ContentLength = 2
	req.Header.Set("Upload-Offset", "0")
	u, _ := url.Parse(e.ts.URL + "/api/")
	for _, c := range e.c.Jar.Cookies(u) {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { e.srv.ServeHTTP(rec, req); close(done) }()
	<-entered
	busy := e.req("DELETE", "/api/admin/v1/uploads/"+id, nil)
	e.srv.expireUploads(time.Now().Add(2 * time.Hour))
	// The inactive other session expired; create another and transfer while the first waits.
	other = e.req("POST", "/api/admin/v1/uploads", `{"name":"two","size":1}`).json()["id"].(string)
	second := e.req("PUT", "/api/admin/v1/uploads/"+other, "b", "Upload-Offset", "0")
	close(release)
	<-done
	if busy.code() != "upload_busy" || second.status != 200 || rec.Code != 400 {
		t.Fatalf("busy=%s second=%d truncated=%d", busy.code(), second.status, rec.Code)
	}
	stat, err := os.Stat(e.srv.uploadPath(id))
	if err != nil || stat.Size() != 0 || e.srv.uploads[id].offset != 0 {
		t.Fatal("partial chunk advanced", err)
	}
	if r := e.req("PUT", "/api/admin/v1/uploads/"+id, "ab", "Upload-Offset", "0"); r.status != 200 {
		t.Fatal(string(r.body))
	}
}

func TestChunkCompletionConflictKeepsBytesForRetry(t *testing.T) {
	e := newShareEnv(t, Options{FilesDir: t.TempDir()})
	id := e.req("POST", "/api/admin/v1/uploads", `{"name":"x","size":2,"slug":"race-file"}`).json()["id"].(string)
	path := "/api/admin/v1/uploads/" + id
	e.req("PUT", path, "ab", "Upload-Offset", "0")
	conflict := e.req("POST", "/api/admin/v1/texts", `{"text":"occupied","slug":"race-file"}`)
	if conflict.status != 201 {
		t.Fatal(string(conflict.body))
	}
	if r := e.req("POST", path+"/complete", nil); r.code() != "slug_taken" {
		t.Fatal(string(r.body))
	}
	data, err := os.ReadFile(e.srv.uploadPath(id))
	if err != nil || string(data) != "ab" {
		t.Fatal("failed finalize lost bytes", err)
	}
	e.req("DELETE", fmt.Sprintf("/api/admin/v1/links/%v", conflict.json()["id"]), nil)
	if r := e.req("POST", path+"/complete", nil); r.status != 201 {
		t.Fatal(string(r.body))
	}
}
