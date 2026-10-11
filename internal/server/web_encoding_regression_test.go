package server

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
)

func TestBUG10AssetEncodingNegotiation(t *testing.T) {
	// Distinct bytes identify the chosen representation without a decompressor.
	f := &asset{body: []byte("identity"), gz: []byte("gz"), br: []byte("b"), ctype: "text/javascript", etag: `"fixture"`}
	for _, tc := range []struct {
		name, accept, encoding, body string
		status                       int
	}{
		{"brotli-disabled", "gzip, br;q=0", "gzip", "gz", 200},
		{"gzip-disabled", "gzip;q=0", "", "identity", 200},
		{"both-disabled", "gzip;q=0, br;q=0", "", "identity", 200},
		{"quality-order", "br;q=0.2, gzip;q=0.8, identity;q=0.1", "gzip", "gz", 200},
		{"explicit-identity", "br;q=0.2, gzip;q=0.3, identity;q=1", "", "identity", 200},
		{"wildcard", "*;q=1, identity;q=0", "br", "b", 200},
		{"explicit-over-wildcard", "*;q=1, br;q=0, identity;q=0", "gzip", "gz", 200},
		{"all-rejected", "br;q=0, gzip;q=0, identity;q=0", "", "", 406},
		{"wildcard-rejected", "*;q=0", "", "", 406},
		{"token-not-substring", "x-gzipish, abracadabra", "", "identity", 200},
		{"case-insensitive", "GZIP, BR;q=0", "gzip", "gz", 200},
		{"empty", "", "", "identity", 200},
		{"ordinary-browser", "gzip, br", "br", "b", 200},
	} {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			t.Run(tc.name+"/"+method, func(t *testing.T) {
				r := httptest.NewRequest(method, "http://short.test/admin/assets/app.js", nil)
				r.Header.Set("Accept-Encoding", tc.accept)
				w := httptest.NewRecorder()
				(&webApp{}).serveAsset(w, r, f)
				if w.Code != tc.status || w.Header().Get("Content-Encoding") != tc.encoding {
					t.Fatalf("status/encoding = %d/%q, want %d/%q", w.Code, w.Header().Get("Content-Encoding"), tc.status, tc.encoding)
				}
				if w.Header().Get("Vary") != "Accept-Encoding" {
					t.Error("missing Accept-Encoding cache variation")
				}
				if tc.status != http.StatusOK {
					return
				}
				if w.Header().Get("Content-Length") != strconv.Itoa(len(tc.body)) {
					t.Errorf("wrong representation length: %s", w.Header().Get("Content-Length"))
				}
				wantBody := tc.body
				if method == http.MethodHead {
					wantBody = ""
				}
				if w.Body.String() != wantBody {
					t.Errorf("body = %q, want %q", w.Body.String(), wantBody)
				}
			})
		}
	}
	t.Run("unavailable-encodings", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodGet, "http://short.test/admin/", nil)
		r.Header.Set("Accept-Encoding", "br, gzip, identity;q=0")
		w := httptest.NewRecorder()
		(&webApp{}).serveAsset(w, r, &asset{body: f.body, ctype: f.ctype})
		if w.Code != http.StatusNotAcceptable {
			t.Errorf("unacceptable identity returned: %d %q", w.Code, w.Body.String())
		}
	})
}
