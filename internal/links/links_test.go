package links

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestNormalizeURL(t *testing.T) {
	cases := []struct {
		in, want string
		err      error
	}{
		{in: "https://example.com/a?b=1#c", want: "https://example.com/a?b=1#c"},
		{in: "  https://example.com  ", want: "https://example.com"},
		{in: "example.com/path", want: "https://example.com/path"},
		{in: "github.com", want: "https://github.com"},
		{in: "localhost:3000/x", want: "http://localhost:3000/x"},
		{in: "192.168.1.2:8080", want: "http://192.168.1.2:8080"},
		{in: "example.com:8443/a", want: "https://example.com:8443/a"},
		{in: "HTTPS://Example.COM/Path", want: "https://example.com/Path"},
		{in: "https://example.com/a b", want: "https://example.com/a%20b"},
		{in: "https://exa\nmple.com/", want: "https://example.com/"},
		{in: "mailto:me@example.com", want: "mailto:me@example.com"},
		{in: "tel:+15551234", want: "tel:+15551234"},
		{in: "tel:5551234", want: "tel:5551234"},
		{in: "weixin://dl/business/?t=abc", want: "weixin://dl/business/?t=abc"},
		{in: "https://例子.中国/路径", want: "https://例子.中国/路径"},
		{in: "HTTPS://User@Example.COM:8080/Path", want: "https://User@example.com:8080/Path"},
		{in: "https://%C3%89xample.com/", err: ErrURLInvalid},
		{in: "http://%41BC.example/", err: ErrURLInvalid},
		{in: "view-source:https://example.com", err: ErrURLScheme},
		{in: "java\tscript:alert(1)", err: ErrURLScheme},
		{in: "", err: ErrURLRequired},
		{in: "   ", err: ErrURLRequired},
		{in: "javascript:alert(1)", err: ErrURLScheme},
		{in: "JavaScript:alert(1)", err: ErrURLScheme},
		{in: "data:text/html,hi", err: ErrURLScheme},
		{in: "file:///etc/passwd", err: ErrURLScheme},
		{in: "not a url", err: ErrURLInvalid},
		{in: "foo", err: ErrURLInvalid},
		{in: "https://", err: ErrURLInvalid},
		{in: "http:/example.com", err: ErrURLInvalid},
		{in: "mailto:", err: ErrURLInvalid},
		{in: "https://" + strings.Repeat("a", MaxURLLength), err: ErrURLTooLong},
	}
	for _, c := range cases {
		got, err := NormalizeURL(c.in)
		if err != c.err {
			t.Errorf("NormalizeURL(%q) error = %v, want %v", c.in, err, c.err)
			continue
		}
		if got != c.want {
			t.Errorf("NormalizeURL(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestValidateSlug(t *testing.T) {
	ok := []string{"a", "gh", "Blog-2026", "a_b.c", "简历", "café", "テスト", "x1", strings.Repeat("a", MaxSlugLength), "नमस्ते"}
	for _, s := range ok {
		if err := ValidateSlug(s); err != nil {
			t.Errorf("ValidateSlug(%q) = %v, want nil", s, err)
		}
	}
	bad := map[string]error{
		"":                                   ErrSlugInvalid,
		"-a":                                 ErrSlugInvalid,
		".env":                               ErrSlugInvalid,
		"a/b":                                ErrSlugInvalid,
		"a b":                                ErrSlugInvalid,
		"a?":                                 ErrSlugInvalid,
		"end.":                               ErrSlugInvalid,
		"%41":                                ErrSlugInvalid,
		"emoji😀":                             ErrSlugInvalid,
		strings.Repeat("a", MaxSlugLength+1): ErrSlugTooLong,
		"admin":                              ErrSlugReserved,
		"API":                                ErrSlugReserved,
		"favicon.ico":                        ErrSlugReserved,
	}
	for s, want := range bad {
		if err := ValidateSlug(s); err != want {
			t.Errorf("ValidateSlug(%q) = %v, want %v", s, err, want)
		}
	}
}

func TestKey(t *testing.T) {
	if Key("GitHub") != "github" {
		t.Error("keys must be case-insensitive")
	}
	// "é" precomposed vs "e" + combining acute accent.
	if Key("café") != Key("café") {
		t.Error("keys must not depend on Unicode composition")
	}
}

func TestGenerate(t *testing.T) {
	seen := map[string]bool{}
	for range 2000 {
		s := Generate(6)
		if len(s) != 6 {
			t.Fatalf("Generate(6) = %q", s)
		}
		for _, c := range s {
			if !strings.ContainsRune(alphabet, c) {
				t.Fatalf("Generate produced %q outside the alphabet", c)
			}
		}
		if err := checkSyntax(s); err != nil {
			t.Fatalf("generated slug %q is not a valid slug: %v", s, err)
		}
		seen[s] = true
	}
	if len(seen) < 1990 {
		t.Errorf("only %d distinct slugs out of 2000", len(seen))
	}
}

func TestLocation(t *testing.T) {
	cases := map[string]string{
		"https://example.com/a?b=c":        "https://example.com/a?b=c",
		"https://例子.中国/路径":                 "https://xn--fsqu00a.xn--fiqs8s/%E8%B7%AF%E5%BE%84",
		"https://example.com/搜索?q=你好#片段":   "https://example.com/%E6%90%9C%E7%B4%A2?q=%E4%BD%A0%E5%A5%BD#%E7%89%87%E6%AE%B5",
		"https://user@bücher.de:8080/x":    "https://user@xn--bcher-kva.de:8080/x",
		"weixin://dl/business/?t=中":        "weixin://dl/business/?t=%E4%B8%AD",
		"https://example.com/already%20ok": "https://example.com/already%20ok",
	}
	for in, want := range cases {
		if got := Location(in); got != want {
			t.Errorf("Location(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestHost(t *testing.T) {
	if h := Host("https://www.GitHub.com/x"); h != "github.com" {
		t.Errorf("Host = %q", h)
	}
	if h := FetchHost("https://www.GitHub.com:443/x"); h != "www.github.com" {
		t.Errorf("FetchHost = %q", h)
	}
	if h := Host("mailto:a@b.c"); h != "" {
		t.Errorf("Host(mailto) = %q", h)
	}
}

func TestCleanTitle(t *testing.T) {
	if got := CleanTitle("  Hello \n\t world  "); got != "Hello world" {
		t.Errorf("CleanTitle = %q", got)
	}
	long := CleanTitle(strings.Repeat("字", MaxTitleLength+50))
	if n := len([]rune(long)); n != MaxTitleLength {
		t.Errorf("CleanTitle length = %d, want %d", n, MaxTitleLength)
	}
}

func TestTextRules(t *testing.T) {
	for in, want := range map[string]int64{"": 0, "a": 1, "a\n": 1, "a\nb": 2, "\n\n": 2} {
		if got := TextLines(in); got != want {
			t.Errorf("TextLines(%q) = %d, want %d", in, got, want)
		}
	}
	if got := TextPreview("\n  \n  func  main() {\nx"); got != "func main() {" {
		t.Errorf("TextPreview = %q", got)
	}
	if got := TextPreview(strings.Repeat("长", 200)); len([]rune(got)) != 120 {
		t.Errorf("TextPreview length = %d", len([]rune(got)))
	}
}

func TestFileName(t *testing.T) {
	for in, want := range map[string]string{
		"report.pdf":            "report.pdf",
		`C:\Users\me\photo.JPG`: "photo.JPG",
		"../../etc/passwd":      "passwd",
		"evil\u202egpj.exe":     "evilgpj.exe",
		"tab\there.txt":         "tabhere.txt",
		"..":                    "file",
		"":                      "file",
		"dir/":                  "file",
		"  spaced name .txt  ":  "spaced name .txt",
		"bad\xffbytes.txt":      "badbytes.txt",
	} {
		if got := FileName(in); got != want {
			t.Errorf("FileName(%q) = %q, want %q", in, got, want)
		}
	}
	long := FileName(strings.Repeat("名", 200) + ".tar.gz")
	if len(long) > 255 || !strings.HasSuffix(long, ".gz") || !utf8.ValidString(long) {
		t.Errorf("long name = %q (%d bytes)", long, len(long))
	}
}

func TestGenerateFullAlphabet(t *testing.T) {
	slug := GenerateWithAlphabet(4096, false)
	if len(slug) != 4096 || !strings.ContainsAny(slug, "01ilo") {
		t.Fatal("full alphabet was not used")
	}
	for _, ch := range slug {
		if !strings.ContainsRune("0123456789abcdefghijklmnopqrstuvwxyz", ch) {
			t.Fatalf("unexpected character %q", ch)
		}
	}
}
