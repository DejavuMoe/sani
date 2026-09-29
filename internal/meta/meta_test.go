package meta

import (
	"bytes"
	"context"
	"net/netip"
	"net/url"
	"strings"
	"testing"

	"golang.org/x/net/html/charset"
	"golang.org/x/text/encoding/simplifiedchinese"
)

func TestParseHead(t *testing.T) {
	doc := `<!doctype html><html><head>
		<base href="https://cdn.example.com/static/">
		<title>Example &amp; Co — Home</title>
		<meta property="og:title" content="Example &amp; Co">
		<link rel="mask-icon" href="/mask.svg">
		<link rel="icon" sizes="16x16" href="/fav16.png">
		<link rel="icon" sizes="64x64" href="fav64.png">
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
		"https://cdn.example.com/touch.png",
		"https://cdn.example.com/fav16.png",
	}
	if strings.Join(p.Icons, " ") != strings.Join(want, " ") {
		t.Errorf("icons = %v\nwant    %v", p.Icons, want)
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
