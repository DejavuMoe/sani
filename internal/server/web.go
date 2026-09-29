package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"html/template"
	"io"
	"io/fs"
	"net/http"
	"path"
	"regexp"
	"strings"
)

type asset struct {
	body, gz, br []byte
	ctype        string
	etag         string
	immutable    bool
}

// webApp serves the embedded admin app. Files are read once at startup,
// together with the .br and .gz variants the frontend build produces.
type webApp struct {
	assets map[string]*asset
	index  *asset
	csp    string
}

var contentTypes = map[string]string{
	".html":        "text/html; charset=utf-8",
	".js":          "text/javascript; charset=utf-8",
	".mjs":         "text/javascript; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".json":        "application/json",
	".webmanifest": "application/manifest+json",
	".svg":         "image/svg+xml",
	".png":         "image/png",
	".ico":         "image/x-icon",
	".woff2":       "font/woff2",
	".woff":        "font/woff",
	".txt":         "text/plain; charset=utf-8",
	".map":         "application/json",
}

var inlineScript = regexp.MustCompile(`(?s)<script>(.*?)</script>`)

func newWebApp(ui fs.FS) (*webApp, error) {
	app := &webApp{assets: map[string]*asset{}}
	if ui == nil {
		return app, nil
	}
	err := fs.WalkDir(ui, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := path.Base(p)
		if d.IsDir() || strings.HasPrefix(name, ".") || strings.HasSuffix(p, ".gz") || strings.HasSuffix(p, ".br") {
			return nil
		}
		body, err := fs.ReadFile(ui, p)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(body)
		a := &asset{
			body:      body,
			ctype:     contentTypes[path.Ext(p)],
			etag:      `"` + hex.EncodeToString(sum[:10]) + `"`,
			immutable: strings.HasPrefix(p, "assets/"),
		}
		if a.ctype == "" {
			a.ctype = "application/octet-stream"
		}
		a.gz, _ = fs.ReadFile(ui, p+".gz")
		a.br, _ = fs.ReadFile(ui, p+".br")
		app.assets[p] = a
		return nil
	})
	if err != nil {
		return nil, err
	}
	if idx := app.assets["index.html"]; idx != nil {
		app.index = idx
		delete(app.assets, "index.html")
		app.csp = contentSecurityPolicy(idx.body)
	}
	return app, nil
}

// contentSecurityPolicy allows the page's own inline bootstrap scripts by
// hash and nothing else inline.
func contentSecurityPolicy(index []byte) string {
	scripts := []string{"'self'"}
	for _, m := range inlineScript.FindAllSubmatch(index, -1) {
		sum := sha256.Sum256(m[1])
		scripts = append(scripts, "'sha256-"+base64.StdEncoding.EncodeToString(sum[:])+"'")
	}
	return strings.Join([]string{
		"default-src 'self'",
		"script-src " + strings.Join(scripts, " "),
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self'",
		"connect-src 'self'",
		"manifest-src 'self'",
		"frame-ancestors 'none'",
		"base-uri 'none'",
		"form-action 'self'",
		"object-src 'none'",
	}, "; ")
}

func (a *webApp) serveApp(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if r.URL.Path == "/admin" {
		target := "/admin/"
		if r.URL.RawQuery != "" {
			target += "?" + r.URL.RawQuery
		}
		http.Redirect(w, r, target, http.StatusMovedPermanently)
		return
	}
	if a.index == nil {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusServiceUnavailable)
		io.WriteString(w, "The admin app is not part of this build. Run `make build` to embed it.\n")
		return
	}
	rel := strings.TrimPrefix(r.URL.Path, "/admin/")
	if f, ok := a.assets[rel]; ok {
		a.serveAsset(w, r, f)
		return
	}
	if strings.HasPrefix(rel, "assets/") || path.Ext(rel) != "" {
		http.NotFound(w, r)
		return
	}
	// Every other path is a client-side route.
	h := w.Header()
	h.Set("Content-Security-Policy", a.csp)
	h.Set("X-Frame-Options", "DENY")
	h.Set("Referrer-Policy", "same-origin")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
	a.serveAsset(w, r, a.index)
}

// serveRootFile serves app icons that browsers request from the site root.
func (a *webApp) serveRootFile(w http.ResponseWriter, r *http.Request, name string) {
	f, ok := a.assets[name]
	if !ok {
		http.NotFound(w, r)
		return
	}
	a.serveAsset(w, r, f)
}

func (a *webApp) serveAsset(w http.ResponseWriter, r *http.Request, f *asset) {
	h := w.Header()
	h.Set("Content-Type", f.ctype)
	h.Set("ETag", f.etag)
	h.Set("Vary", "Accept-Encoding")
	if f.immutable {
		h.Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		h.Set("Cache-Control", "no-cache")
	}
	if match := r.Header.Get("If-None-Match"); match != "" && strings.Contains(match, f.etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	body := f.body
	accept := r.Header.Get("Accept-Encoding")
	switch {
	case f.br != nil && strings.Contains(accept, "br"):
		h.Set("Content-Encoding", "br")
		body = f.br
	case f.gz != nil && strings.Contains(accept, "gzip"):
		h.Set("Content-Encoding", "gzip")
		body = f.gz
	}
	h.Set("Content-Length", itoa(len(body)))
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		w.Write(body)
	}
}

func itoa(n int) string {
	var b [20]byte
	i := len(b)
	for {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
		if n == 0 {
			break
		}
	}
	return string(b[i:])
}

type pageKind int

const (
	pageNotFound pageKind = iota
	pageGone
	pageError
)

type pageText struct {
	Title, Heading, Body string
}

var pageCopy = map[string]map[pageKind]pageText{
	"zh": {
		pageNotFound: {"链接不存在", "这个短链接不存在", "请检查链接是否完整，或联系把它发给你的人。"},
		pageGone:     {"链接已失效", "这个短链接已失效", "它可能已过期、被停用，或已达到访问次数上限。"},
		pageError:    {"暂时无法打开", "暂时无法打开这个链接", "服务出了点问题，请稍后再试。"},
	},
	"en": {
		pageNotFound: {"Link not found", "This short link doesn’t exist", "Check that the link is complete, or ask the person who sent it."},
		pageGone:     {"Link unavailable", "This short link is no longer available", "It may have expired, been turned off, or reached its visit limit."},
		pageError:    {"Link unavailable", "This link can’t be opened right now", "Something went wrong on our side. Try again in a moment."},
	},
}

var pageStatus = map[pageKind]int{
	pageNotFound: http.StatusNotFound,
	pageGone:     http.StatusGone,
	pageError:    http.StatusInternalServerError,
}

const pageTemplate = `<!doctype html>
<html lang="{{.Lang}}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{{.Title}}</title>
<style>
:root{color-scheme:light dark;--bg:#f6f6f3;--fg:#1c1c1a;--muted:#6f6e68;--line:#e3e1db}
@media (prefers-color-scheme:dark){:root{--bg:#111110;--fg:#ecebe6;--muted:#9b9991;--line:#2b2a27}}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--fg);
font:15px/1.65 system-ui,-apple-system,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
main{width:min(100%,400px);margin-top:-8vh}
.code{display:flex;align-items:center;gap:12px;color:var(--muted);
font:500 12px/1 ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;letter-spacing:.06em}
.code:after{content:"";flex:1;height:1px;background:var(--line)}
h1{margin:22px 0 6px;font-size:19px;font-weight:600;line-height:1.4;letter-spacing:-.005em}
p{margin:0;color:var(--muted)}
.link{margin-top:28px;color:var(--muted);font:13px/1.5 ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
overflow-wrap:anywhere}
</style>
</head>
<body>
<main>
<div class="code">{{.Status}}</div>
<h1>{{.Heading}}</h1>
<p>{{.Body}}</p>
<div class="link">{{.Link}}</div>
</main>
</body>
</html>
`

// pages holds every visitor page pre-rendered, split around the requested
// link, so a 404 costs two writes rather than a template execution. That
// matters when something scans the domain for random paths.
type pages struct {
	parts   map[string]map[pageKind][2][]byte
	headers map[string]http.Header
}

const linkMarker = "SANI-LINK-MARKER"

func newPages() *pages {
	tmpl := template.Must(template.New("page").Parse(pageTemplate))
	p := &pages{parts: map[string]map[pageKind][2][]byte{}, headers: map[string]http.Header{}}
	for lang, texts := range pageCopy {
		p.parts[lang] = map[pageKind][2][]byte{}
		for kind, text := range texts {
			var buf bytes.Buffer
			tmpl.Execute(&buf, map[string]any{
				"Lang":    htmlLang[lang],
				"Title":   text.Title,
				"Heading": text.Heading,
				"Body":    text.Body,
				"Status":  itoa(pageStatus[kind]),
				"Link":    linkMarker,
			})
			before, after, _ := bytes.Cut(buf.Bytes(), []byte(linkMarker))
			p.parts[lang][kind] = [2][]byte{before, after}
		}
		p.headers[lang] = http.Header{
			"Content-Type":            {"text/html; charset=utf-8"},
			"Cache-Control":           {"no-store"},
			"Content-Security-Policy": {"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"},
			"X-Robots-Tag":            {"noindex"},
			"X-Content-Type-Options":  {"nosniff"},
			"Content-Language":        {htmlLang[lang]},
			"Vary":                    {"Accept-Language"},
		}
	}
	return p
}

var htmlLang = map[string]string{"zh": "zh-CN", "en": "en"}

func pageLang(r *http.Request) string {
	al := strings.ToLower(strings.TrimSpace(r.Header.Get("Accept-Language")))
	if strings.HasPrefix(al, "zh") {
		return "zh"
	}
	return "en"
}

func (p *pages) render(w http.ResponseWriter, r *http.Request, kind pageKind, slug string) {
	lang := pageLang(r)
	parts := p.parts[lang][kind]
	link := ""
	if slug != "" && len(slug) <= 256 {
		link = template.HTMLEscapeString(r.Host + "/" + slug)
	}
	h := w.Header()
	for k, v := range p.headers[lang] {
		h[k] = v
	}
	h.Set("Content-Length", itoa(len(parts[0])+len(link)+len(parts[1])))
	w.WriteHeader(pageStatus[kind])
	if r.Method != http.MethodHead {
		w.Write(parts[0])
		io.WriteString(w, link)
		w.Write(parts[1])
	}
}
