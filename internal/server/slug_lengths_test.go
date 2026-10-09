package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DejavuMoe/sani/internal/clicks"
	"github.com/DejavuMoe/sani/internal/meta"
	"github.com/DejavuMoe/sani/internal/store"
)

func TestIndependentSlugCreation(t *testing.T) {
	e := newShareEnv(t, Options{})
	for _, lengths := range [][3]int{{5, 10, 10}, {32, 5, 12}, {3, 32, 3}, {5, 3, 32}} {
		t.Run(fmt.Sprint(lengths), func(t *testing.T) {
			r := e.req("PATCH", "/api/config", map[string]any{
				"slugLength": lengths[0], "textSlugLength": lengths[1], "fileSlugLength": lengths[2], "excludeConfusable": false,
			})
			if r.status != 200 {
				t.Fatal(string(r.body))
			}
			check := func(r reply, kind string, n int) map[string]any {
				t.Helper()
				if r.status != 201 {
					t.Fatalf("create %s: %d %s", kind, r.status, r.body)
				}
				l := r.json()
				slug := l["slug"].(string)
				alphabet := "0123456789abcdefghijklmnopqrstuvwxyz"
				prefix := "/"
				if kind != "url" {
					alphabet, prefix = "23456789abcdefghjkmnpqrstuvwxyz", "/p/"
				}
				if len(slug) != n || l["kind"] != kind || !strings.HasSuffix(l["shortUrl"].(string), prefix+slug) {
					t.Fatalf("%s length %d: %v", kind, n, l)
				}
				if strings.Trim(slug, alphabet) != "" {
					t.Fatalf("%s generated outside its alphabet: %q", kind, slug)
				}
				return l
			}
			check(e.req("POST", "/api/links", `{"url":"https://example.com"}`), "url", lengths[0])
			for _, format := range []string{"plain", "code"} {
				check(e.req("POST", "/api/texts", map[string]string{"text": "hello", "format": format}), "text", lengths[1])
			}
			check(e.upload(nil, "x.txt", []byte("x")), "file", lengths[2])
			r = e.req("POST", "/api/uploads", `{"name":"chunk.txt","size":2}`)
			if r.status != 201 {
				t.Fatal(string(r.body))
			}
			path := "/api/uploads/" + r.json()["id"].(string)
			for offset := range 2 {
				if r := e.req("PUT", path, "x", "Upload-Offset", fmt.Sprint(offset)); r.status != 200 {
					t.Fatal(string(r.body))
				}
			}
			l := check(e.req("POST", path+"/complete", nil), "file", lengths[2])
			if r := e.req("PATCH", "/api/config", `{"slugLength":7,"textSlugLength":8,"fileSlugLength":9}`); r.status != 200 {
				t.Fatal(string(r.body))
			}
			if r := e.req("POST", path+"/complete", nil); r.status != 200 || r.json()["slug"] != l["slug"] {
				t.Fatal("completed upload changed after settings patch", string(r.body))
			}
		})
	}
	// Explicit slugs and existing links do not inherit generation lengths.
	url := e.create(map[string]any{"url": "https://example.com/manual", "slug": "u"})
	text := e.req("POST", "/api/texts", `{"text":"manual","slug":"t"}`)
	file := e.upload(map[string]string{"slug": "f"}, "manual.txt", []byte("x"))
	if text.status != 201 || text.json()["slug"] != "t" || file.status != 201 || file.json()["slug"] != "f" {
		t.Fatalf("manual slugs: %s %s", text.body, file.body)
	}
	if r := e.req("PATCH", "/api/config", `{"slugLength":32,"textSlugLength":32,"fileSlugLength":32}`); r.status != 200 {
		t.Fatal(string(r.body))
	}
	for _, l := range []map[string]any{url, text.json(), file.json()} {
		if r := e.req("GET", fmt.Sprintf("/api/links/%v", l["id"]), nil); r.status != 200 || r.json()["slug"] != l["slug"] {
			t.Fatal("existing slug changed", string(r.body))
		}
	}
}

func TestIndependentSlugPatchAtomicity(t *testing.T) {
	e := newEnv(t, Options{})
	e.signIn()
	if r := e.req("PATCH", "/api/config", `{"slugLength":7,"textSlugLength":8,"fileSlugLength":9,"baseUrl":"https://old.example.com"}`); r.status != 200 {
		t.Fatal(string(r.body))
	}
	current := e.srv.settings.Load()
	raw, err := e.srv.store.Setting(context.Background(), store.SettingCreation)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"slugLength", "textSlugLength", "fileSlugLength"} {
		for _, invalid := range []string{"-1", "0", "2", "33", "3.5", `""`, `"5"`, "true", "[]", "{}", "999999999999999999999"} {
			body := map[string]any{"slugLength": 12, "textSlugLength": 13, "fileSlugLength": 14, "baseUrl": "https://new.example.com", "excludeConfusable": false}
			body[key] = json.RawMessage(invalid)
			r := e.req("PATCH", "/api/config", body)
			if r.status != 400 || r.code() != "config_invalid" && r.code() != "bad_json" {
				t.Fatalf("%s=%s accepted: %d %s", key, invalid, r.status, r.body)
			}
			after, err := e.srv.store.Setting(context.Background(), store.SettingCreation)
			base, baseErr := e.srv.store.Setting(context.Background(), store.SettingBaseURL)
			if err != nil || baseErr != nil || after != raw || base != "https://old.example.com" || e.srv.settings.Load() != current || *e.srv.storedBase.Load() != base {
				t.Fatalf("invalid patch changed settings: %s %s %v %v", after, base, err, baseErr)
			}
		}
	}
	// Null retains the existing optional-field semantics of slugLength.
	if r := e.req("PATCH", "/api/config", `{"slugLength":null,"textSlugLength":null,"fileSlugLength":null}`); r.status != 200 || r.json()["textSlugLength"] != float64(8) || r.json()["fileSlugLength"] != float64(9) {
		t.Fatal(string(r.body))
	}
	// A database failure must leave both the base URL and generation settings intact.
	db, err := sql.Open("sqlite", e.dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TRIGGER reject_creation_update BEFORE UPDATE ON settings WHEN NEW.key = 'creation' BEGIN SELECT RAISE(ABORT, 'test failure'); END`); err != nil {
		t.Fatal(err)
	}
	current = e.srv.settings.Load()
	if r := e.req("PATCH", "/api/config", `{"textSlugLength":3,"fileSlugLength":32,"baseUrl":"https://new.example.com"}`); r.status != 500 {
		t.Fatal(string(r.body))
	}
	after, err := e.srv.store.Setting(context.Background(), store.SettingCreation)
	base, baseErr := e.srv.store.Setting(context.Background(), store.SettingBaseURL)
	if err != nil || baseErr != nil || after != raw || base != "https://old.example.com" || e.srv.settings.Load() != current || *e.srv.storedBase.Load() != base {
		t.Fatalf("failed write partially committed: %s %s %v %v", after, base, err, baseErr)
	}
}

func TestIndependentSlugEnvironmentLocks(t *testing.T) {
	keys := []string{"slugLength", "textSlugLength", "fileSlugLength"}
	for i, locked := range keys {
		t.Run(locked, func(t *testing.T) {
			opt := Options{SlugLength: 7, TextSlugLength: 8, FileSlugLength: 9}
			opt.SlugLengthFromEnv = i == 0
			opt.TextSlugLengthFromEnv = i == 1
			opt.FileSlugLengthFromEnv = i == 2
			e := newEnv(t, opt)
			e.signIn()
			r := e.req("GET", "/api/config", nil)
			if r.status != 200 {
				t.Fatal(string(r.body))
			}
			for j, key := range keys {
				wantSource := "default"
				if i == j {
					wantSource = "env"
				}
				if r.json()[key] != float64(7+j) || r.json()["configSources"].(map[string]any)[key] != wantSource {
					t.Fatalf("source/value of %s: %s", key, r.body)
				}
			}
			current := e.srv.settings.Load()
			raw, err := e.srv.store.Setting(context.Background(), store.SettingCreation)
			if err != nil {
				t.Fatal(err)
			}
			r = e.req("PATCH", "/api/config", map[string]any{"slugLength": 12, "textSlugLength": 13, "fileSlugLength": 14, "baseUrl": "https://new.example.com"})
			if r.status != 409 || r.code() != "config_env" {
				t.Fatal(string(r.body))
			}
			after, err := e.srv.store.Setting(context.Background(), store.SettingCreation)
			if err != nil || after != raw || current != e.srv.settings.Load() || *e.srv.storedBase.Load() != "" {
				t.Fatalf("locked patch committed: %s %v", after, err)
			}
			patch := map[string]int{}
			for _, key := range keys {
				if key != locked {
					patch[key] = 3
				}
			}
			r = e.req("PATCH", "/api/config", patch)
			if r.status != 200 || r.json()[locked] != float64(7+i) {
				t.Fatal("one env lock blocked independent settings", string(r.body))
			}
			for key := range patch {
				if r.json()[key] != float64(3) || r.json()["configSources"].(map[string]any)[key] != "settings" {
					t.Fatal(string(r.body))
				}
			}
		})
	}
}

func TestIndependentSlugMigrationAndRestart(t *testing.T) {
	for _, tc := range []struct {
		name, raw       string
		opt             Options
		first, fallback [2]int
	}{
		{"fresh-url-env32", `{"version":1}`, Options{SlugLength: 32, SlugLengthFromEnv: true}, [2]int{10, 10}, [2]int{10, 10}},
		{"legacy-no-settings", "", Options{}, [2]int{10, 10}, [2]int{10, 10}},
		{"legacy-short-url", `{"slugLength":3}`, Options{}, [2]int{10, 10}, [2]int{10, 10}},
		{"legacy-long-url", `{"slugLength":32}`, Options{}, [2]int{32, 32}, [2]int{32, 32}},
		{"legacy-url-env24", `{"slugLength":5}`, Options{SlugLength: 24, SlugLengthFromEnv: true}, [2]int{24, 24}, [2]int{24, 24}},
		{"legacy-env-shorter-than-stored", `{"slugLength":32}`, Options{SlugLength: 7, SlugLengthFromEnv: true}, [2]int{10, 10}, [2]int{10, 10}},
		{"legacy-text-env-fallback", `{"slugLength":12}`, Options{SlugLength: 24, SlugLengthFromEnv: true, TextSlugLength: 3, TextSlugLengthFromEnv: true}, [2]int{3, 24}, [2]int{24, 24}},
		{"legacy-file-env-fallback", `{"slugLength":24}`, Options{FileSlugLength: 32, FileSlugLengthFromEnv: true}, [2]int{24, 32}, [2]int{24, 24}},
		{"partial-text", `{"slugLength":24,"textSlugLength":5}`, Options{}, [2]int{5, 24}, [2]int{5, 24}},
		{"partial-file", `{"slugLength":24,"fileSlugLength":3}`, Options{}, [2]int{24, 3}, [2]int{24, 3}},
		{"explicit-both", `{"slugLength":32,"textSlugLength":3,"fileSlugLength":5}`, Options{}, [2]int{3, 5}, [2]int{3, 5}},
		{"already-initialized", `{"version":1,"slugLength":32}`, Options{}, [2]int{10, 10}, [2]int{10, 10}},
		{"fresh-share-env", `{"version":1}`, Options{TextSlugLength: 3, TextSlugLengthFromEnv: true, FileSlugLength: 32, FileSlugLengthFromEnv: true}, [2]int{3, 32}, [2]int{10, 10}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			path := filepath.Join(t.TempDir(), "sani.db")
			st, err := store.Open(ctx, path)
			if err != nil {
				t.Fatal(err)
			}
			if tc.raw != "" {
				if err := st.SetSetting(ctx, store.SettingCreation, tc.raw); err != nil {
					t.Fatal(err)
				}
			}
			opt := tc.opt
			var raw string
			for boot := range 3 {
				s, err := New(opt, st, clicks.New(st, time.UTC), meta.New(), testUI, slog.New(slog.NewTextHandler(io.Discard, nil)))
				if err != nil {
					st.Close()
					t.Fatal(err)
				}
				cfg := s.settings.Load()
				want := tc.fallback
				if boot == 0 {
					want = tc.first
				}
				if got := [2]int{cfg.textSlugLength, cfg.fileSlugLength}; got != want {
					t.Errorf("boot %d: lengths %v, want %v", boot, got, want)
				}
				for _, key := range []string{"textSlugLength", "fileSlugLength"} {
					wantSource := "settings"
					if strings.HasPrefix(tc.name, "fresh") || tc.name == "already-initialized" {
						wantSource = "default"
					}
					if boot == 0 && (key == "textSlugLength" && opt.TextSlugLengthFromEnv || key == "fileSlugLength" && opt.FileSlugLengthFromEnv) {
						wantSource = "env"
					}
					if cfg.sources[key] != wantSource {
						t.Errorf("boot %d %s source %q, want %q", boot, key, cfg.sources[key], wantSource)
					}
				}
				stored, err := st.Setting(ctx, store.SettingCreation)
				if err != nil {
					t.Fatal(err)
				}
				if boot > 0 && stored != raw {
					t.Errorf("boot %d rewrote frozen settings: %s -> %s", boot, raw, stored)
				}
				if boot == 0 {
					// A URL-only PATCH after migration must preserve both share defaults.
					if !opt.SlugLengthFromEnv {
						w := httptest.NewRecorder()
						s.patchConfig(w, httptest.NewRequest("PATCH", "/api/config", strings.NewReader(`{"slugLength":31}`)))
						if w.Code != 200 || s.settings.Load().textSlugLength != want[0] || s.settings.Load().fileSlugLength != want[1] {
							t.Fatal("URL-only patch affected shares", w.Body.String())
						}
					}
					raw, err = st.Setting(ctx, store.SettingCreation)
					if err != nil {
						t.Fatal(err)
					}
					var v creationSettings
					if err := json.Unmarshal([]byte(raw), &v); err != nil || v.Version != 1 {
						t.Fatalf("missing initialization marker: %s %v", raw, err)
					}
				}
				s.Shutdown(ctx)
				if err := st.Close(); err != nil {
					t.Fatal(err)
				}
				if boot < 2 {
					st, err = store.Open(ctx, path)
					if err != nil {
						t.Fatal(err)
					}
				}
				opt = Options{}
				if boot == 1 {
					opt.SlugLength, opt.SlugLengthFromEnv = 32, true
				}
			}
		})
	}
}

func TestIndependentSlugStoredValidation(t *testing.T) {
	for _, raw := range []string{`{"textSlugLength":2}`, `{"fileSlugLength":33}`, `{"textSlugLength":3.5}`, `{"fileSlugLength":"5"}`, `{"slugLength":2}`, `{"version":2}`, `{"version":-1}`} {
		t.Run(raw, func(t *testing.T) {
			e := newEnv(t, Options{TextSlugLength: 5, TextSlugLengthFromEnv: true, FileSlugLength: 5, FileSlugLengthFromEnv: true})
			current := e.srv.settings.Load()
			if err := e.srv.store.SetSetting(context.Background(), store.SettingCreation, raw); err != nil {
				t.Fatal(err)
			}
			if err := e.srv.loadSettings(); err == nil {
				t.Fatal("invalid stored config accepted under env overrides")
			}
			after, err := e.srv.store.Setting(context.Background(), store.SettingCreation)
			if err != nil || after != raw || current != e.srv.settings.Load() {
				t.Fatalf("invalid stored config mutated: %s %v", after, err)
			}
		})
	}
}

func TestIndependentSlugImportKeepsURLSemantics(t *testing.T) {
	e := newEnv(t, Options{})
	e.signIn()
	if r := e.req("PATCH", "/api/config", `{"slugLength":3,"textSlugLength":32,"fileSlugLength":32,"excludeConfusable":false}`); r.status != 200 {
		t.Fatal(string(r.body))
	}
	r := e.req("POST", "/api/import", `{"app":"sani","version":1,"links":[{"url":"https://example.com/generated"},{"slug":"manual","url":"https://example.com/manual"}]}`)
	if r.status != 200 || r.json()["created"] != float64(2) {
		t.Fatal(string(r.body))
	}
	result, err := e.srv.store.ListLinks(context.Background(), store.ListQuery{})
	if err != nil || len(result.Links) != 2 {
		t.Fatalf("imported links: %+v %v", result, err)
	}
	for _, l := range result.Links {
		if l.Kind != store.KindURL || l.Slug != "manual" && (len(l.Slug) != 4 || strings.Trim(l.Slug, "23456789abcdefghjkmnpqrstuvwxyz") != "") {
			t.Fatalf("import changed its URL generation rules: %+v", l)
		}
	}
}
