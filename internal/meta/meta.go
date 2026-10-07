// Package meta fetches a destination's title and icon so the owner can
// recognize links at a glance.
//
// Fetches only reach public addresses: every hostname is resolved and
// checked before the request, and the dialer re-checks the address it
// actually connects to, which defeats DNS rebinding. A configured proxy is
// the one address allowed through; what the proxy then reaches is up to it.
package meta

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/net/html"
	"golang.org/x/net/html/charset"

	"github.com/DejavuMoe/sani/internal/links"
)

const (
	maxPageBytes      = 1 << 20
	maxIconBytes      = 256 << 10
	maxIconCandidates = 32
	userAgent         = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Sani/1"
)

// PreviewHeader marks requests made by the fetcher, so a destination that
// is itself a Sani link does not count the fetch as a click.
const PreviewHeader = "X-Sani-Preview"

var ErrBlocked = errors.New("destination is not a public address")

type Page struct {
	Title string
	Icons []string // candidate icon URLs, best first
}

type Fetcher struct {
	client  *http.Client
	proxied bool
}

func New() *Fetcher {
	// Every connection is checked at dial time, after DNS, so a name that
	// resolves differently the second time cannot reach a private address.
	// The one exception is a configured proxy, which may well be local.
	proxies := proxyAddrs()
	dialer := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
	dialer.Control = func(network, address string, c syscall.RawConn) error {
		if _, ok := proxies[address]; ok {
			return nil
		}
		return guardDial(network, address, c)
	}
	f := &Fetcher{proxied: len(proxies) > 0}
	f.client = &http.Client{
		Timeout: 12 * time.Second,
		Transport: &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			DialContext:           dialer.DialContext,
			TLSHandshakeTimeout:   6 * time.Second,
			ResponseHeaderTimeout: 8 * time.Second,
			MaxIdleConns:          16,
			IdleConnTimeout:       30 * time.Second,
			ForceAttemptHTTP2:     true,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 6 {
				return errors.New("too many redirects")
			}
			return f.checkHost(req.Context(), req.URL)
		},
	}
	return f
}

// proxyAddrs resolves the proxies http.ProxyFromEnvironment would use to
// the "ip:port" addresses the dialer will see.
func proxyAddrs() map[string]struct{} {
	out := map[string]struct{}{}
	for _, k := range []string{"HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"} {
		v := os.Getenv(k)
		if v == "" {
			continue
		}
		if !strings.Contains(v, "://") {
			v = "http://" + v
		}
		u, err := url.Parse(v)
		if err != nil || u.Hostname() == "" {
			continue
		}
		port := u.Port()
		if port == "" {
			port = map[string]string{"https": "443", "socks5": "1080", "socks5h": "1080"}[u.Scheme]
			if port == "" {
				port = "80"
			}
		}
		ips, err := net.LookupIP(u.Hostname())
		if err != nil {
			continue
		}
		for _, ip := range ips {
			out[net.JoinHostPort(ip.String(), port)] = struct{}{}
		}
	}
	return out
}

// Ranges that are not public even though netip does not call them private.
// 198.18.0.0/15 is deliberately absent: transparent proxies in "fake-ip"
// mode resolve every name into it.
var blockedPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("64:ff9b::/96"),
	netip.MustParsePrefix("64:ff9b:1::/48"),
	netip.MustParsePrefix("100::/64"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"),
	netip.MustParsePrefix("2001::/32"),
	netip.MustParsePrefix("fec0::/10"),
	netip.MustParsePrefix("168.63.129.16/32"), // Azure host services
}

// Public reports whether ip is a globally routable unicast address.
func Public(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsValid() || ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsInterfaceLocalMulticast() || ip.IsMulticast() {
		return false
	}
	for _, p := range blockedPrefixes {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}

func guardDial(_, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return ErrBlocked
	}
	ip, err := netip.ParseAddr(host)
	if err != nil || !Public(ip) {
		return ErrBlocked
	}
	return nil
}

func (f *Fetcher) checkHost(ctx context.Context, u *url.URL) error {
	if u.Scheme != "http" && u.Scheme != "https" {
		return ErrBlocked
	}
	host := strings.ToLower(u.Hostname())
	if ip, err := netip.ParseAddr(host); err == nil {
		if !Public(ip) {
			return ErrBlocked
		}
		return nil
	}
	if host == "" || host == "localhost" || !strings.Contains(host, ".") ||
		strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") ||
		strings.HasSuffix(host, ".internal") || strings.HasSuffix(host, ".lan") || strings.HasSuffix(host, ".home.arpa") {
		return ErrBlocked
	}
	addrs, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		if f.proxied {
			return nil // the proxy may resolve names this host cannot
		}
		return err
	}
	for _, a := range addrs {
		if !Public(a) {
			return ErrBlocked
		}
	}
	return nil
}

func (f *Fetcher) get(ctx context.Context, raw, accept, lang string) (*http.Response, error) {
	u, err := url.Parse(links.Location(raw))
	if err != nil {
		return nil, err
	}
	if err := f.checkHost(ctx, u); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", accept)
	req.Header.Set(PreviewHeader, "1")
	if lang != "" {
		req.Header.Set("Accept-Language", lang)
	}
	resp, err := f.client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		resp.Body.Close()
		return nil, fmt.Errorf("%s: status %d", u.Host, resp.StatusCode)
	}
	return resp, nil
}

// Page fetches a destination and extracts its title and icon candidates.
// lang is forwarded as Accept-Language so titles match the owner's locale.
func (f *Fetcher) Page(ctx context.Context, raw, lang string) (*Page, error) {
	resp, err := f.get(ctx, raw, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", lang)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	final := resp.Request.URL
	ct := resp.Header.Get("Content-Type")
	mediatype, _, _ := mime.ParseMediaType(ct)

	p := &Page{}
	if mediatype == "" || mediatype == "text/html" || mediatype == "application/xhtml+xml" {
		body := io.LimitReader(resp.Body, maxPageBytes)
		r, err := charset.NewReader(body, ct)
		if err != nil {
			r = body
		}
		parseHead(r, final, p)
	} else {
		p.Title = fileTitle(final)
	}
	if fallback := final.ResolveReference(&url.URL{Path: "/favicon.ico"}).String(); len(fallback) <= links.MaxURLLength {
		p.Icons = append(p.Icons, fallback)
	}
	p.Icons = dedupe(p.Icons)
	return p, nil
}

// FallbackIcons lists icon locations to try when the page itself failed.
func FallbackIcons(raw string) []string {
	u, err := url.Parse(links.Location(raw))
	if err != nil || u.Host == "" {
		return nil
	}
	fallback := u.Scheme + "://" + u.Host + "/favicon.ico"
	if len(fallback) > links.MaxURLLength {
		return nil
	}
	return []string{fallback}
}

type iconRef struct {
	href  string
	score int
}

func parseHead(r io.Reader, base *url.URL, p *Page) {
	// Redirects can supply a long base too; never multiply it by icon links.
	if len(base.String()) > links.MaxURLLength {
		base = &url.URL{}
	}
	z := html.NewTokenizer(r)
	var title, ogTitle, twTitle strings.Builder
	var icons []iconRef
	inTitle, haveTitle := false, false

loop:
	for {
		switch z.Next() {
		case html.ErrorToken:
			break loop
		case html.StartTagToken, html.SelfClosingTagToken:
			name, hasAttr := z.TagName()
			attrs := map[string]string{}
			for hasAttr {
				var k, v []byte
				k, v, hasAttr = z.TagAttr()
				attrs[string(k)] = string(v)
			}
			switch string(name) {
			case "title":
				inTitle = !haveTitle
			case "meta":
				key := strings.ToLower(attrs["property"])
				if key == "" {
					key = strings.ToLower(attrs["name"])
				}
				switch key {
				case "og:title":
					if ogTitle.Len() == 0 {
						ogTitle.WriteString(attrs["content"])
					}
				case "twitter:title":
					if twTitle.Len() == 0 {
						twTitle.WriteString(attrs["content"])
					}
				}
			case "base":
				if href := attrs["href"]; href != "" && len(href) <= links.MaxURLLength {
					if u, err := base.Parse(href); err == nil && len(u.String()) <= links.MaxURLLength {
						base = u
					}
				}
			case "link":
				// Bound expansion before resolving more references, not after sorting.
				if len(icons) >= maxIconCandidates {
					continue
				}
				if ref, ok := iconCandidate(attrs, base); ok {
					icons = append(icons, ref)
				}
			case "body":
				if haveTitle || ogTitle.Len() > 0 {
					break loop
				}
			}
		case html.TextToken:
			if inTitle {
				title.Write(z.Text())
			}
		case html.EndTagToken:
			name, _ := z.TagName()
			switch string(name) {
			case "title":
				if inTitle {
					inTitle = false
					haveTitle = strings.TrimSpace(title.String()) != ""
				}
			case "head":
				if haveTitle || ogTitle.Len() > 0 {
					break loop
				}
			}
		}
	}

	for _, t := range []string{ogTitle.String(), twTitle.String(), title.String()} {
		if t = strings.TrimSpace(t); t != "" {
			p.Title = t
			break
		}
	}
	sort.SliceStable(icons, func(i, j int) bool { return icons[i].score > icons[j].score })
	for _, ic := range icons {
		p.Icons = append(p.Icons, ic.href)
	}
}

func iconCandidate(attrs map[string]string, base *url.URL) (iconRef, bool) {
	rel := " " + strings.ToLower(attrs["rel"]) + " "
	href := strings.TrimSpace(attrs["href"])
	if href == "" || !strings.Contains(rel, "icon") || strings.Contains(rel, "mask-icon") {
		return iconRef{}, false
	}
	var abs string
	if strings.HasPrefix(href, "data:") {
		abs = href
	} else {
		if len(href) > links.MaxURLLength {
			return iconRef{}, false
		}
		u, err := base.Parse(href)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
			return iconRef{}, false
		}
		abs = u.String()
		if len(abs) > links.MaxURLLength {
			return iconRef{}, false
		}
	}
	score := 40
	isSVG := strings.Contains(attrs["type"], "svg") || strings.HasSuffix(strings.ToLower(path.Ext(href)), ".svg")
	switch {
	case strings.Contains(rel, "apple-touch-icon"):
		score = 70
	case isSVG:
		score = 90
	default:
		// Prefer sizes near 64px: sharp at 2x without a large download.
		best := 0
		for _, s := range strings.Fields(strings.ToLower(attrs["sizes"])) {
			w, _, _ := strings.Cut(s, "x")
			if n, err := strconv.Atoi(w); err == nil && n > best {
				best = n
			}
		}
		switch {
		case best >= 32:
			d := best - 64
			if d < 0 {
				d = -d
			}
			score = max(50, 100-d/4)
		case best > 0:
			score = 30 // blurry on high-density screens
		}
	}
	return iconRef{href: abs, score: score}, true
}

func fileTitle(u *url.URL) string {
	name := path.Base(u.Path)
	if name == "/" || name == "." {
		return ""
	}
	if s, err := url.PathUnescape(name); err == nil {
		name = s
	}
	return name
}

func dedupe(in []string) []string {
	seen := map[string]bool{}
	out := in[:0]
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

// Icon downloads one icon and returns its media type and bytes.
func (f *Fetcher) Icon(ctx context.Context, raw string) (string, []byte, error) {
	if strings.HasPrefix(raw, "data:") {
		return decodeDataURI(raw)
	}
	resp, err := f.get(ctx, raw, "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5", "")
	if err != nil {
		return "", nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxIconBytes+1))
	if err != nil {
		return "", nil, err
	}
	if len(data) > maxIconBytes {
		return "", nil, errors.New("icon too large")
	}
	declared, _, _ := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	ct, ok := imageType(declared, data)
	if !ok {
		return "", nil, errors.New("not an image")
	}
	return ct, data, nil
}

// imageType trusts content sniffing over the declared type, except for SVG,
// which sniffing cannot recognize.
func imageType(declared string, data []byte) (string, bool) {
	if len(data) == 0 {
		return "", false
	}
	sniffed := http.DetectContentType(data)
	if strings.HasPrefix(sniffed, "image/") {
		return sniffed, true
	}
	head := strings.ToLower(string(data[:min(len(data), 512)]))
	if (declared == "image/svg+xml" || strings.Contains(head, "<svg")) && strings.Contains(strings.ToLower(string(data)), "<svg") {
		return "image/svg+xml", true
	}
	return "", false
}

func decodeDataURI(raw string) (string, []byte, error) {
	meta, payload, ok := strings.Cut(strings.TrimPrefix(raw, "data:"), ",")
	if !ok {
		return "", nil, errors.New("malformed data URI")
	}
	var data []byte
	var err error
	if strings.HasSuffix(meta, ";base64") {
		data, err = base64.StdEncoding.DecodeString(payload)
	} else {
		var s string
		s, err = url.PathUnescape(payload)
		data = []byte(s)
	}
	if err != nil || len(data) > maxIconBytes {
		return "", nil, errors.New("malformed data URI")
	}
	declared, _, _ := mime.ParseMediaType(strings.TrimSuffix(meta, ";base64"))
	ct, ok := imageType(declared, data)
	if !ok {
		return "", nil, errors.New("not an image")
	}
	return ct, data, nil
}
