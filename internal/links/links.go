// Package links holds the pure rules for short links: slug syntax, lookup
// keys, random slug generation and destination URL normalization.
package links

import (
	"crypto/rand"
	"errors"
	"net/netip"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/net/idna"
	"golang.org/x/text/unicode/norm"
)

const (
	MaxSlugLength  = 64   // runes
	MaxURLLength   = 8192 // bytes
	MaxTitleLength = 300  // runes
)

var (
	ErrURLRequired  = errors.New("url is required")
	ErrURLInvalid   = errors.New("url is not a valid absolute URL")
	ErrURLTooLong   = errors.New("url is too long")
	ErrURLScheme    = errors.New("url scheme is not allowed")
	ErrSlugInvalid  = errors.New("slug contains unsupported characters")
	ErrSlugTooLong  = errors.New("slug is too long")
	ErrSlugReserved = errors.New("slug is reserved")
)

// Alphabet for generated slugs: lowercase letters and digits without the
// look-alikes 0/o and 1/i/l, so a slug survives being read aloud or retyped.
const alphabet = "23456789abcdefghjkmnpqrstuvwxyz"

// Paths the server answers itself. Compared against lookup keys.
var reserved = map[string]struct{}{
	"admin":                {},
	"api":                  {},
	"rest":                 {},
	"healthz":              {},
	"robots.txt":           {},
	"favicon.ico":          {},
	"favicon.svg":          {},
	"apple-touch-icon.png": {},
}

// Schemes that must never be emitted in a Location header.
var blockedSchemes = map[string]struct{}{
	"javascript":       {},
	"vbscript":         {},
	"data":             {},
	"file":             {},
	"blob":             {},
	"about":            {},
	"filesystem":       {},
	"view-source":      {},
	"jar":              {},
	"chrome":           {},
	"chrome-extension": {},
	"moz-extension":    {},
	"resource":         {},
}

// Key maps a slug to its lookup key. Slugs match case-insensitively and
// Unicode slugs match regardless of how the client composed them.
func Key(slug string) string {
	if !norm.NFC.IsNormalString(slug) {
		slug = norm.NFC.String(slug)
	}
	return strings.ToLower(slug)
}

// IsReserved reports whether a lookup key collides with a server route.
func IsReserved(key string) bool {
	_, ok := reserved[key]
	return ok
}

// ValidateSlug checks a user-chosen slug. Letters and digits of any script
// are allowed, plus '-', '_' and '.' after the first character.
func ValidateSlug(slug string) error {
	if err := checkSyntax(slug); err != nil {
		return err
	}
	if IsReserved(Key(slug)) {
		return ErrSlugReserved
	}
	return nil
}

// Plausible reports whether a request path segment could be a slug at all.
// The redirect handler uses it to reject junk before touching the cache.
func Plausible(slug string) bool {
	return checkSyntax(slug) == nil
}

func checkSyntax(slug string) error {
	if slug == "" || !utf8.ValidString(slug) {
		return ErrSlugInvalid
	}
	if len(slug) > MaxSlugLength*utf8.UTFMax {
		return ErrSlugTooLong
	}
	n := 0
	for i, r := range slug {
		n++
		if n > MaxSlugLength {
			return ErrSlugTooLong
		}
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
		case i > 0 && unicode.IsMark(r):
		case i > 0 && (r == '-' || r == '_' || r == '.'):
		default:
			return ErrSlugInvalid
		}
	}
	if strings.HasSuffix(slug, ".") {
		return ErrSlugInvalid
	}
	return nil
}

// Generate returns a random slug of n characters from the unambiguous
// alphabet. Rejection sampling keeps every character equally likely.
func Generate(n int) string {
	const limit = 256 - 256%len(alphabet)
	out := make([]byte, 0, n)
	buf := make([]byte, n+8)
	for len(out) < n {
		rand.Read(buf)
		for _, c := range buf {
			if int(c) >= limit {
				continue
			}
			out = append(out, alphabet[int(c)%len(alphabet)])
			if len(out) == n {
				break
			}
		}
	}
	return string(out)
}

// NormalizeURL validates a destination and returns the form that is stored
// and shown. Bare hosts such as "example.com/a" gain an https:// scheme.
func NormalizeURL(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", ErrURLRequired
	}
	// Line breaks and tabs are copy/paste artifacts, never part of a URL.
	s = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' || r == '\t' {
			return -1
		}
		return r
	}, s)
	s = strings.ReplaceAll(s, " ", "%20")
	if len(s) > MaxURLLength {
		return "", ErrURLTooLong
	}

	scheme, rest, ok := splitScheme(s)
	if !ok {
		if !looksLikeHost(s) {
			return "", ErrURLInvalid
		}
		scheme, rest = "https", "//"+s
		if h := hostOf(s); h == "localhost" || isIPLiteral(h) {
			scheme = "http"
		}
	}
	scheme = strings.ToLower(scheme)
	if _, blocked := blockedSchemes[scheme]; blocked {
		return "", ErrURLScheme
	}
	s = scheme + ":" + rest

	u, err := url.Parse(s)
	if err != nil {
		return "", ErrURLInvalid
	}
	if scheme == "http" || scheme == "https" {
		if u.Hostname() == "" || strings.ContainsAny(u.Hostname(), " %<>\"{}|\\^`") {
			return "", ErrURLInvalid
		}
		var ok bool
		if s, ok = lowerHost(s); !ok {
			return "", ErrURLInvalid
		}
	} else if rest == "" {
		return "", ErrURLInvalid
	}
	if len(s) > MaxURLLength {
		return "", ErrURLTooLong
	}
	return s, nil
}

// lowerHost lowercases the host of "scheme://[userinfo@]host[:port]…" as it
// was written, leaving the rest untouched: hosts are case-insensitive, and a
// normalized host keeps display and grouping consistent. Percent-encoded
// hosts are refused; nobody pastes them, and they hide what the host is.
func lowerHost(s string) (string, bool) {
	i := strings.Index(s, "://")
	if i < 0 {
		return s, true
	}
	rest := s[i+3:]
	end := strings.IndexAny(rest, "/?#")
	if end < 0 {
		end = len(rest)
	}
	authority := rest[:end]
	hostport := authority[strings.LastIndexByte(authority, '@')+1:]
	if strings.Contains(hostport, "%") {
		return "", false
	}
	return s[:i+3] + authority[:len(authority)-len(hostport)] + strings.ToLower(hostport) + rest[end:], true
}

// Schemes whose opaque part legitimately starts with a digit.
var numericSchemes = map[string]struct{}{
	"tel": {}, "sms": {}, "smsto": {}, "callto": {}, "facetime": {}, "geo": {},
}

// splitScheme separates "scheme:rest". "localhost:8080/x" and "example.com:443"
// are host:port pairs rather than schemes, so a digit after the colon without
// a following "//" means no scheme.
func splitScheme(s string) (scheme, rest string, ok bool) {
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z':
		case i > 0 && (c >= '0' && c <= '9' || c == '+' || c == '-' || c == '.'):
		case c == ':' && i > 0:
			scheme, rest = s[:i], s[i+1:]
			_, numeric := numericSchemes[strings.ToLower(scheme)]
			if !numeric && !strings.HasPrefix(rest, "//") && rest != "" && rest[0] >= '0' && rest[0] <= '9' {
				return "", "", false
			}
			return scheme, rest, true
		default:
			return "", "", false
		}
	}
	return "", "", false
}

func looksLikeHost(s string) bool {
	h := hostOf(s)
	if h == "" || strings.ContainsAny(h, " @") {
		return false
	}
	return h == "localhost" || strings.Contains(h, ".") || isIPLiteral(h)
}

// hostOf returns the host of a scheme-less "host[:port][/path]" string.
func hostOf(s string) string {
	if i := strings.IndexAny(s, "/?#"); i >= 0 {
		s = s[:i]
	}
	if strings.HasPrefix(s, "[") {
		if i := strings.IndexByte(s, ']'); i > 0 {
			return s[1:i]
		}
		return ""
	}
	if i := strings.LastIndexByte(s, ':'); i >= 0 {
		s = s[:i]
	}
	return strings.ToLower(s)
}

func isIPLiteral(h string) bool {
	_, err := netip.ParseAddr(h)
	return err == nil
}

// Host returns the lowercase hostname of an http(s) destination, without
// port or a leading "www.". Other schemes return "".
func Host(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return ""
	}
	return strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
}

// FetchHost returns the exact hostname used to fetch page metadata.
func FetchHost(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return strings.ToLower(u.Hostname())
}

// Location converts a stored destination into a value safe for the
// Location header: IDN hosts become punycode and other non-ASCII bytes are
// percent-encoded. ASCII destinations are returned unchanged.
func Location(raw string) string {
	if isASCII(raw) {
		return raw
	}
	var b strings.Builder
	b.Grow(len(raw) * 2)
	rest := raw
	if i := strings.Index(raw, "://"); i > 0 {
		b.WriteString(raw[:i+3])
		rest = raw[i+3:]
		end := strings.IndexAny(rest, "/?#")
		if end < 0 {
			end = len(rest)
		}
		authority := rest[:end]
		rest = rest[end:]
		userinfo, hostport := "", authority
		if at := strings.LastIndexByte(authority, '@'); at >= 0 {
			userinfo, hostport = authority[:at+1], authority[at+1:]
		}
		host, port := hostport, ""
		if !strings.HasPrefix(hostport, "[") {
			if c := strings.LastIndexByte(hostport, ':'); c >= 0 {
				host, port = hostport[:c], hostport[c:]
			}
		}
		if ascii, err := idna.Lookup.ToASCII(host); err == nil {
			host = ascii
		} else {
			host = escapeNonASCII(host)
		}
		b.WriteString(escapeNonASCII(userinfo))
		b.WriteString(host)
		b.WriteString(port)
	}
	b.WriteString(escapeNonASCII(rest))
	return b.String()
}

func isASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= utf8.RuneSelf {
			return false
		}
	}
	return true
}

func escapeNonASCII(s string) string {
	if isASCII(s) {
		return s
	}
	const hex = "0123456789ABCDEF"
	var b strings.Builder
	b.Grow(len(s) * 3)
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c < utf8.RuneSelf {
			b.WriteByte(c)
			continue
		}
		b.WriteByte('%')
		b.WriteByte(hex[c>>4])
		b.WriteByte(hex[c&15])
	}
	return b.String()
}

// CleanTitle collapses whitespace and bounds the length of a title.
func CleanTitle(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) > MaxTitleLength {
		r := []rune(s)
		s = strings.TrimSpace(string(r[:MaxTitleLength-1])) + "…"
	}
	return s
}
