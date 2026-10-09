package server

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/DejavuMoe/sani/internal/store"
)

func TestMetadataProxyPersistenceCredentialsAndAtomicity(t *testing.T) {
	e := newEnv(t, Options{FetchMeta: true})
	e.signIn()
	const secret = "test-only-proxy-password"
	p := metadataProxyInput{Scheme: "https", Host: "proxy.example.com", Port: 443, Auth: true, Username: "demo", Password: new(secret)}
	patch := func() reply {
		return e.req("PATCH", "/api/config", map[string]any{"metaMode": "proxy", "metaProxy": p})
	}
	if r := patch(); r.status != 200 || strings.Contains(string(r.body), secret) || r.json()["metaProxy"].(map[string]any)["passwordSet"] != true {
		t.Fatal(r.status, string(r.body))
	}
	before := e.srv.metadataFetcher()
	p.Password = nil
	if r := patch(); r.status != 200 || e.srv.metadataFetcher() != before {
		t.Fatal("unchanged proxy replaced or password not retained")
	}
	if err := e.srv.loadSettings(); err != nil || e.srv.settings.Load().stored.MetaProxy.Password != secret {
		t.Fatal("credentials not restored", err)
	}
	for _, change := range []func(){func() { p.Host = "other.example.com" }, func() { p.Port = 8443 }, func() { p.Username = "other" }, func() { p.Scheme = "http" }} {
		old := p
		change()
		if r := patch(); r.code() != "proxy_password_required" {
			t.Fatal("saved secret may be forwarded to another endpoint", r.status, string(r.body))
		}
		p = old
	}
	p.Password = new("replacement-only")
	if r := patch(); r.status != 200 || strings.Contains(string(r.body), *p.Password) {
		t.Fatal(r.status, string(r.body))
	}
	raw, _ := e.srv.store.Setting(context.Background(), store.SettingCreation)
	p.Port = 0
	if r := e.req("PATCH", "/api/config", map[string]any{"metaProxy": p, "baseUrl": "https://new.example.com", "slugLength": 9}); r.status != 400 {
		t.Fatal(r.status, string(r.body))
	}
	after, _ := e.srv.store.Setting(context.Background(), store.SettingCreation)
	if after != raw || e.srv.settings.Load().slugLength != 5 || *e.srv.storedBase.Load() != "" {
		t.Fatal("invalid patch partially committed")
	}
	p.Port, p.Auth, p.Password = 443, false, nil
	if r := patch(); r.status != 200 || r.json()["metaProxy"].(map[string]any)["passwordSet"] != false {
		t.Fatal(r.status, string(r.body))
	}
	stored, _ := e.srv.store.Setting(context.Background(), store.SettingCreation)
	if strings.Contains(stored, "replacement-only") || strings.Contains(stored, secret) {
		t.Fatal("disabled authentication retained a credential")
	}
	// Restore from persisted state with a newly constructed server and transport.
	other, err := New(e.srv.opt, e.srv.store, e.srv.clicks, e.srv.fetcher, testUI, e.srv.log)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Shutdown(context.Background())
	if other.settings.Load().proxy.Host != p.Host || other.metadataFetcher() == nil {
		t.Fatal("restart lost proxy")
	}
}

func TestStoredMetadataProxyActuallyRoutesAndNeverFallsBack(t *testing.T) {
	var connections atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "CONNECT" || r.Host != "1.1.1.1:80" {
			t.Error("unexpected tunnel", r.Method, r.Host)
			w.WriteHeader(400)
			return
		}
		connections.Add(1)
		conn, rw, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		defer conn.Close()
		rw.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n")
		rw.Flush()
		req, err := http.ReadRequest(bufio.NewReader(conn))
		if err != nil {
			return
		}
		if req.Host != "1.1.1.1" || req.Header.Get("Proxy-Authorization") != "" {
			t.Error("target headers", req.Host)
		}
		io.WriteString(conn, "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 22\r\nConnection: close\r\n\r\n<title>Fixture</title>\n")
	}))
	e := newEnv(t, Options{FetchMeta: true})
	e.signIn()
	u, _ := url.Parse(proxy.URL)
	port, _ := strconv.Atoi(u.Port())
	p := metadataProxyInput{Scheme: "http", Host: u.Hostname(), Port: port}
	if r := e.req("PATCH", "/api/config", map[string]any{"metaMode": "proxy", "metaProxy": p}); r.status != 200 {
		t.Fatal(string(r.body))
	}
	f := e.srv.metadataFetcher()
	page, err := f.Page(context.Background(), "http://1.1.1.1", "")
	if err != nil || page.Title != "Fixture" || connections.Load() != 1 {
		t.Fatal(page, err, connections.Load())
	}
	proxy.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err := f.Page(ctx, "http://1.1.1.1", ""); err == nil {
		t.Fatal("failed proxy used a direct connection")
	}
}

func TestMetadataProxyValidationLocksAndTestBoundary(t *testing.T) {
	for _, host := range []string{"", "https://proxy.example.com", "user@host", "a/b", "bad host", "[::1]", "a?b", "x#y", "-bad.example"} {
		if (metadataProxy{Scheme: "http", Host: host, Port: 80}).valid() {
			t.Fatalf("accepted host %q", host)
		}
	}
	for _, host := range []string{"127.0.0.1", "::1", "proxy.example.com"} {
		if !(metadataProxy{Scheme: "socks5", Host: host, Port: 1080}).valid() {
			t.Fatalf("rejected proxy endpoint %q", host)
		}
	}
	e := newEnv(t, Options{})
	if r := e.req("POST", "/api/config/metadata/test", `{}`); r.status != 401 {
		t.Fatal(r.status)
	}
	e.signIn()
	if r := e.req("POST", "/api/config/metadata/test", `{}`, "Origin", "https://other.example.com", "Sec-Fetch-Site", "cross-site"); r.code() != "cross_origin" {
		t.Fatal(r.status)
	}
	if r := e.req("POST", "/api/config/metadata/test", `{"metaProxy":{"host":"`+strings.Repeat("x", 5000)+`"}}`); r.status != 413 {
		t.Fatal(r.status)
	}
	if r := e.req("POST", "/api/config/metadata/test", `{}`); r.code() != "config_invalid" {
		t.Fatal(r.code())
	}
	e.srv.metaTestNext = time.Now().Add(time.Minute)
	input := map[string]any{"metaProxy": metadataProxyInput{Scheme: "http", Host: "127.0.0.1", Port: 1}}
	if r := e.req("POST", "/api/config/metadata/test", input); r.status != 429 || r.header.Get("Retry-After") == "" {
		t.Fatal(r.status)
	}
	e.srv.metaTestNext = time.Time{}
	if r := e.req("POST", "/api/config/metadata/test", input); r.code() != "proxy_test_failed" || r.header.Get("Cache-Control") != "no-store" {
		t.Fatal(r.status, string(r.body))
	}
	if _, err := e.srv.store.Setting(context.Background(), store.SettingCreation); err != store.ErrNotFound {
		t.Fatal("test changed saved settings", err)
	}
	locked := newEnv(t, Options{MetaProxy: "http://demo:env-only-secret@127.0.0.1:8080", FetchMeta: true})
	locked.signIn()
	if r := locked.req("GET", "/api/config", nil); strings.Contains(string(r.body), "env-only-secret") {
		t.Fatal("environment secret leaked")
	}
	for _, method := range []string{"PATCH", "POST"} {
		path := "/api/config"
		if method == "POST" {
			path += "/metadata/test"
		}
		if r := locked.req(method, path, input); r.code() != "config_env" {
			t.Fatal(r.status, string(r.body))
		}
	}
}

func TestMetadataProxyConcurrentSnapshots(t *testing.T) {
	e := newEnv(t, Options{FetchMeta: true})
	e.signIn()
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Go(func() {
			for j := 0; j < 20; j++ {
				_ = e.srv.metadataFetcher()
				cfg := e.srv.settings.Load()
				if cfg.proxy != nil {
					_, _ = json.Marshal(cfg.proxy.dto())
				}
			}
		})
	}
	for i := 0; i < 20; i++ {
		body := fmt.Sprintf(`{"metaMode":"proxy","metaProxy":{"scheme":"http","host":"127.0.0.1","port":%d,"auth":false}}`, 20000+i)
		if r := e.req("PATCH", "/api/config", body); r.status != 200 {
			t.Fatal(r.status, string(r.body))
		}
	}
	wg.Wait()
}
