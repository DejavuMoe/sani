package meta

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"testing"

	"golang.org/x/net/html/charset"
	"golang.org/x/text/encoding/simplifiedchinese"

	"github.com/DejavuMoe/sani/internal/links"
)

func TestParseHead(t *testing.T) {
	doc := `<!doctype html><html><head>
		<base href="https://cdn.example.com/static/">
		<title>Example &amp; Co — Home</title>
		<meta property="og:title" content="Example &amp; Co">
		<link rel="mask-icon" href="/mask.svg">
		<link rel="icon" sizes="16x16" href="/fav16.png">
		<link rel="icon" sizes="64x64" href="fav64.png">
		<link rel="icon" sizes="64x64" href="other64.png">
		<link rel="icon" href="fav.svg">
		<link rel="apple-touch-icon" href="/touch.png">
	</head><body><svg><title>not me</title></svg></body></html>`
	base, _ := url.Parse("https://example.com/page")
	p := &Page{}
	parseHead(strings.NewReader(doc), base, p)
	if p.Title != "Example & Co" {
		t.Errorf("title = %q", p.Title)
	}
	want := []string{
		"https://cdn.example.com/static/fav64.png",
		"https://cdn.example.com/static/other64.png",
		"https://cdn.example.com/static/fav.svg",
		"https://cdn.example.com/touch.png",
		"https://cdn.example.com/fav16.png",
	}
	if strings.Join(p.Icons, " ") != strings.Join(want, " ") {
		t.Errorf("icons = %v\nwant    %v", p.Icons, want)
	}
}

func TestParseHeadURLLimits(t *testing.T) {
	const origin = "https://example.com/"
	limitBase := origin + strings.Repeat("a", links.MaxURLLength-len(origin)-1) + "/"
	for _, tt := range []struct {
		name, base, head, want string
	}{
		{"long base", origin, `<base href="https://cdn.example.com/` + strings.Repeat("a", 64<<10) + `/"><link rel="icon" href="i">`, origin + "i"},
		{"escaped base", origin, `<base href="https://cdn.example.com/` + strings.Repeat("é", links.MaxURLLength/3) + `/"><link rel="icon" href="i">`, origin + "i"},
		{"expanded base", limitBase, `<base href="b/"><link rel="icon" href="..">`, origin},
		{"expanded icon", limitBase, `<link rel="icon" href="i"><link rel="icon" href="/i">`, origin + "i"},
		{"long redirect", limitBase + "x", `<link rel="icon" href="i"><link rel="icon" href="` + origin + `i">`, origin + "i"},
		{"exact limit", origin, `<base href="` + limitBase + `"><link rel="icon" href=".">`, limitBase},
	} {
		t.Run(tt.name, func(t *testing.T) {
			base, err := url.Parse(tt.base)
			if err != nil {
				t.Fatal(err)
			}
			p := &Page{}
			parseHead(strings.NewReader(tt.head+"<title>Still parsed</title>"), base, p)
			if p.Title != "Still parsed" || !slices.Equal(p.Icons, []string{tt.want}) {
				t.Fatalf("title = %q, icons = %v; want %q", p.Title, p.Icons, tt.want)
			}
		})
	}
}

func TestParseHeadManyShortIcons(t *testing.T) {
	const origin = "https://example.com/"
	base, _ := url.Parse(origin)
	iconBase := origin + strings.Repeat("a", links.MaxURLLength-len(origin)-16) + "/"
	var doc strings.Builder
	doc.WriteString(`<base href="` + iconBase + `">`)
	doc.WriteString(strings.Repeat(`<link rel="stylesheet" href="s">`, maxIconCandidates))
	for i := 0; i < 5000; i++ {
		doc.WriteString(`<link rel="icon" href="` + strconv.Itoa(i) + `">`)
	}
	doc.WriteString("<title>After icons</title>")
	p := &Page{}
	parseHead(strings.NewReader(doc.String()), base, p)
	if p.Title != "After icons" || len(p.Icons) != maxIconCandidates {
		t.Fatalf("title = %q, icon count = %d", p.Title, len(p.Icons))
	}
	for i, href := range p.Icons {
		if href != iconBase+strconv.Itoa(i) || len(href) > links.MaxURLLength {
			t.Fatalf("icon %d changed order or exceeded URL limit", i)
		}
	}
}

func TestIconCandidateURLLimits(t *testing.T) {
	const origin = "https://example.com/"
	base, _ := url.Parse(origin)
	for _, tt := range []struct {
		name, href string
		want       bool
	}{
		{"exact limit", origin + strings.Repeat("a", links.MaxURLLength-len(origin)), true},
		{"long href before normalization", strings.Repeat("a/../", links.MaxURLLength/5+1) + "i", false},
		{"escaped href", strings.Repeat("é", links.MaxURLLength/3), false},
		{"data URI", "data:image/svg+xml,<svg>" + strings.Repeat(" ", links.MaxURLLength) + "</svg>", true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, ok := iconCandidate(map[string]string{"rel": "icon", "href": tt.href}, base)
			if ok != tt.want {
				t.Fatalf("accepted = %v, want %v", ok, tt.want)
			}
		})
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestPageIconFallback(t *testing.T) {
	const origin = "https://example.com/"
	for _, tt := range []struct {
		name, final, doc string
		want             []string
	}{
		{"empty", origin + "page", "", []string{origin + "favicon.ico"}},
		{"duplicate fallback", origin, `<link rel="icon" href="/favicon.ico">`, []string{origin + "favicon.ico"}},
		{"sorted and deduplicated", origin + "page", `<base href="https://cdn.example.com/"><link rel="icon" sizes="16x16" href="a"><link rel="icon" sizes="64x64" href="b"><link rel="icon" sizes="64x64" href="b">`, []string{"https://cdn.example.com/b", "https://cdn.example.com/a", origin + "favicon.ico"}},
		{"full candidates", origin, strings.Repeat(`<link rel="icon" href="/i">`, maxIconCandidates+1), []string{origin + "i", origin + "favicon.ico"}},
		{"long final path", origin + strings.Repeat("a", links.MaxURLLength), `<link rel="icon" href="i">`, []string{origin + "favicon.ico"}},
		{"long final host", "https://" + strings.Repeat("a", links.MaxURLLength) + ".com/", "", nil},
	} {
		t.Run(tt.name, func(t *testing.T) {
			final, err := url.Parse(tt.final)
			if err != nil {
				t.Fatal(err)
			}
			f := &Fetcher{client: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     http.Header{"Content-Type": {"text/html"}},
					Body:       io.NopCloser(strings.NewReader(tt.doc)),
					Request:    &http.Request{URL: final},
				}, nil
			})}}
			// A public literal passes the SSRF check; the transport never uses the network.
			p, err := f.Page(context.Background(), "https://1.1.1.1/", "")
			if err != nil {
				t.Fatal(err)
			}
			if !slices.Equal(p.Icons, tt.want) {
				t.Fatalf("icons = %v, want %v", p.Icons, tt.want)
			}
		})
	}
	if got := FallbackIcons(origin + "page"); !slices.Equal(got, []string{origin + "favicon.ico"}) {
		t.Fatalf("FallbackIcons = %v", got)
	}
	if got := FallbackIcons("https://" + strings.Repeat("a", links.MaxURLLength) + ".com/"); len(got) != 0 {
		t.Fatal("oversized fallback URL accepted")
	}
}

func TestParseHeadFallsBackToTitle(t *testing.T) {
	p := &Page{}
	base, _ := url.Parse("https://example.com/")
	parseHead(strings.NewReader("<title>\n  Just a   title \n</title><p>body"), base, p)
	if p.Title != "Just a   title" {
		t.Errorf("title = %q", p.Title)
	}
}

func TestParseHeadGBK(t *testing.T) {
	var buf bytes.Buffer
	w := simplifiedchinese.GBK.NewEncoder().Writer(&buf)
	w.Write([]byte(`<html><head><meta charset="gbk"><title>你好，世界</title></head></html>`))
	r, err := charset.NewReader(&buf, "text/html")
	if err != nil {
		t.Fatal(err)
	}
	p := &Page{}
	base, _ := url.Parse("https://example.cn/")
	parseHead(r, base, p)
	if p.Title != "你好，世界" {
		t.Errorf("GBK title = %q", p.Title)
	}
}

func TestPublic(t *testing.T) {
	for _, s := range []string{"127.0.0.1", "10.1.2.3", "192.168.0.1", "172.16.5.5", "169.254.169.254",
		"100.64.1.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "64:ff9b::a00:1", "224.0.0.1",
		"fec0::1", "2001::1", "168.63.129.16", "::ffff:10.0.0.1"} {
		if Public(netip.MustParseAddr(s)) {
			t.Errorf("%s should not be public", s)
		}
	}
	for _, s := range []string{"1.1.1.1", "8.8.8.8", "2606:4700::1111", "140.82.112.3", "198.18.0.7"} {
		if !Public(netip.MustParseAddr(s)) {
			t.Errorf("%s should be public", s)
		}
	}
}

func TestCheckHostBlocksPrivateTargets(t *testing.T) {
	f := &Fetcher{}
	for _, raw := range []string{"http://127.0.0.1/", "http://[::1]:8080/", "http://localhost/", "http://printer.local/",
		"http://intranet/", "ftp://example.com/", "http://169.254.169.254/latest/meta-data/"} {
		u, _ := url.Parse(raw)
		if err := f.checkHost(context.Background(), u); err == nil {
			t.Errorf("checkHost(%s) allowed a private target", raw)
		}
	}
}

func TestDataURIIcon(t *testing.T) {
	ct, data, err := decodeDataURI("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E")
	if err != nil || ct != "image/svg+xml" || !strings.Contains(string(data), "<svg") {
		t.Fatalf("decodeDataURI = %q %q %v", ct, data, err)
	}
	png := "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
	if ct, _, err := decodeDataURI(png); err != nil || ct != "image/png" {
		t.Fatalf("png data URI = %q, %v", ct, err)
	}
	if _, _, err := decodeDataURI("data:text/html,<script>"); err == nil {
		t.Fatal("non-image data URI accepted")
	}
}
