package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/DejavuMoe/sani/internal/store"
)

// copyScript unhides the copy button, which needs script to work. It is the
// page's only script and the CSP admits it by hash.
const copyScript = `for(const b of document.querySelectorAll("[data-copy]")){b.hidden=false;` +
	`b.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(document.getElementById("text").textContent);` +
	`b.textContent=b.dataset.done;setTimeout(()=>b.textContent=b.dataset.label,1600)}catch(e){}})}`

var shareCSP = func() string {
	sum := sha256.Sum256([]byte(copyScript))
	return "default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-" +
		base64.StdEncoding.EncodeToString(sum[:]) + "'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
}()

// The page leaves a newline after each <pre>: the parser drops the first one,
// so a text that starts with a blank line keeps it.
const sharePage = `<!doctype html>
<html lang="{{.Lang}}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>{{.Heading}}</title>
<style>
:root{color-scheme:light dark;--bg:#f7f7f5;--surface:#fff;--soft:#f2f1ee;--fg:#1c1b19;--fg2:#56544e;--muted:#716e67;
--line:#e7e5e0;--line2:#d9d6cf;--accent:#2d4be0;--on-accent:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#111110;--surface:#191918;--soft:#20201e;--fg:#edece7;--fg2:#b3b1a9;
--muted:#8a887f;--line:#292826;--line2:#3a3936;--accent:#7189ff;--on-accent:#0d0f1c}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);
font:15px/1.65 system-ui,-apple-system,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
main{width:min(100%,{{if .Code}}1080px{{else}}760px{{end}});margin:0 auto;padding:48px 20px 72px}
h1{margin:0;font-size:20px;font-weight:600;line-height:1.4;letter-spacing:-.01em;overflow-wrap:anywhere}
.meta{margin:6px 0 0;color:var(--muted);font-size:13px}
.bar{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:18px}
.actions{display:flex;flex-wrap:wrap;gap:6px}
.btn{display:inline-flex;align-items:center;height:32px;padding:0 12px;border:1px solid var(--line2);border-radius:8px;
background:var(--surface);color:var(--fg);font-family:inherit;font-size:13px;font-weight:500;line-height:1;
text-decoration:none;cursor:pointer}
.btn:hover{border-color:var(--muted)}
.btn.primary{border-color:var(--accent);background:var(--accent);color:var(--on-accent)}
.btn:focus-visible,.sheet:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.btn[hidden]{display:none}
.sheet{overflow:hidden;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
pre{margin:0;font:13px/1.65 ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;tab-size:4}
.plain pre{padding:20px 22px;white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;font-size:15px;line-height:1.7}
.code{display:flex;overflow-x:auto}
.code .ln{position:sticky;left:0;flex:none;padding:16px 12px 16px 16px;border-right:1px solid var(--line);
background:var(--soft);color:var(--muted);text-align:right;user-select:none;-webkit-user-select:none}
.code .src{flex:1;padding:16px 20px}
.file{display:flex;flex-direction:column;align-items:center;gap:6px;padding:40px 24px;text-align:center}
.file svg{color:var(--muted)}
.file .name{margin-top:8px;font-size:16px;font-weight:600;overflow-wrap:anywhere}
.file .type{color:var(--muted);font-size:13px}
.file .btn{margin-top:16px;height:38px;padding:0 18px;font-size:14px}
.file .sum{margin-top:18px;color:var(--muted);font:12px/1.5 ui-monospace,"SF Mono",Menlo,Consolas,monospace;overflow-wrap:anywhere}
.note{margin-top:16px;color:var(--fg2);font-size:13.5px}
@media (max-width:640px){main{padding:28px 16px 56px}.plain pre{padding:16px}}
</style>
</head>
<body>
<main>
<div class="bar">
<div>
<h1>{{.Heading}}</h1>
<p class="meta">{{.Meta}}</p>
</div>
{{if .Text}}<div class="actions">
<button class="btn" type="button" data-copy data-label="{{.L.Copy}}" data-done="{{.L.Copied}}" hidden>{{.L.Copy}}</button>
{{if .RawURL}}<a class="btn" href="{{.RawURL}}">{{.L.Raw}}</a>
<a class="btn" href="{{.DownloadURL}}">{{.L.Download}}</a>{{end}}
</div>{{end}}
</div>
{{if .Text}}{{if .Code}}<div class="sheet code" tabindex="0" role="region" aria-label="{{.L.Code}}">{{if .Numbers}}<pre class="ln" aria-hidden="true">
{{.Numbers}}</pre>{{end}}<pre class="src" id="text">
{{.Body}}</pre></div>{{else}}<div class="sheet plain"><pre id="text">
{{.Body}}</pre></div>{{end}}
{{else}}<div class="sheet file">
<svg width="40" height="40" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 1.75H4.75A2 2 0 0 0 2.75 3.75v8.5a2 2 0 0 0 2 2h6.5a2 2 0 0 0 2-2V6z"/><path d="M9 1.75V6h4.25"/></svg>
<div class="name">{{.FileName}}</div>
<div class="type">{{.FileInfo}}</div>
{{if .RawURL}}<a class="btn primary" href="{{.RawURL}}">{{.L.DownloadFile}}</a>{{else}}<p class="note">{{.L.Unavailable}}</p>{{end}}
<div class="sum">SHA-256 {{.SHA256}}</div>
</div>{{end}}
{{if .Until}}<p class="note">{{.Until}}</p>{{end}}
</main>
<script>` + copyScript + `</script>
</body>
</html>
`

type shareLabels struct {
	Copy, Copied, Raw, Download, DownloadFile, Unavailable string
	Text, Code, File, Until                                string
	Line, Lines                                            string
}

var shareCopy = map[string]shareLabels{
	"zh": {
		Copy: "复制", Copied: "已复制", Raw: "原始文本", Download: "下载", DownloadFile: "下载文件",
		Unavailable: "暂时无法下载这个文件。", Text: "文本", Code: "代码", File: "文件",
		Until: "这份分享在 %s 前有效。", Line: "%s 行", Lines: "%s 行",
	},
	"en": {
		Copy: "Copy", Copied: "Copied", Raw: "Raw", Download: "Download", DownloadFile: "Download file",
		Unavailable: "This file can’t be downloaded right now.", Text: "Text", Code: "Code", File: "File",
		Until: "Shared until %s.", Line: "%s line", Lines: "%s lines",
	},
}

// maxNumbered is the longest text that gets line numbers; beyond it the
// gutter alone would outweigh most texts.
const maxNumbered = 50_000

// serveShare shows a text or describes a file at /p/{slug}. Opening a text
// counts as a visit; a file counts when it is downloaded.
func (s *Server) serveShare(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	slug := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/p/"), "/")
	shown := "p/" + slug
	e, err := s.lookupShared(r, slug)
	if err != nil {
		s.logShareError(r, err)
		s.pages.render(w, r, pageError, shown)
		return
	}
	if e == nil {
		s.pages.render(w, r, pageShareNotFound, shown)
		return
	}
	now := time.Now()
	if !s.admit(e, false, r, now) {
		s.pages.render(w, r, pageShareGone, shown)
		return
	}
	l, err := s.sharedLink(r, e)
	var body string
	if err == nil && l != nil && l.Kind == store.KindText {
		body, err = s.store.TextBody(r.Context(), l.ID)
		if errors.Is(err, store.ErrNotFound) {
			l, err = nil, nil
		}
	}
	if err != nil {
		s.logShareError(r, err)
		s.pages.render(w, r, pageError, shown)
		return
	}
	if l == nil {
		s.pages.render(w, r, pageShareNotFound, shown)
		return
	}

	lang := pageLang(r)
	lb := shareCopy[lang]
	c := l.Content
	d := map[string]any{
		"Lang": htmlLang[lang],
		"L":    lb,
		"Text": l.Kind == store.KindText,
		"Code": l.Kind == store.KindText && c.Format == store.FormatCode,
	}
	raw := s.rawURL(l)
	d["RawURL"] = raw
	meta := []string{}
	if l.Kind == store.KindText {
		d["Heading"] = firstOf(l.Title, c.Name, l.Slug)
		d["Body"] = body
		d["DownloadURL"] = raw + "/" + url.PathEscape(l.Slug) + ".txt"
		kind := lb.Text
		if c.Format == store.FormatCode {
			kind = lb.Code
			if c.Lines > 1 && c.Lines <= maxNumbered {
				d["Numbers"] = lineNumbers(c.Lines)
			}
		}
		lines := lb.Lines
		if c.Lines == 1 {
			lines = lb.Line
		}
		meta = append(meta, kind, fmt.Sprintf(lines, groupDigits(c.Lines)), formatSize(c.Size))
	} else {
		d["Heading"] = firstOf(l.Title, c.Name)
		d["FileName"] = c.Name
		mediaType, _, _ := strings.Cut(c.Type, ";")
		d["FileInfo"] = mediaType + " · " + formatSize(c.Size)
		d["SHA256"] = fmt.Sprintf("%x", c.SHA256)
		meta = append(meta, lb.File, formatSize(c.Size))
	}
	d["Meta"] = strings.Join(meta, " · ")
	if l.ExpiresAt != 0 {
		d["Until"] = fmt.Sprintf(lb.Until, formatWhen(time.UnixMilli(l.ExpiresAt).In(s.clicks.Location()), lang))
	}

	var buf bytes.Buffer
	if err := s.share.Execute(&buf, d); err != nil {
		s.logShareError(r, err)
		s.pages.render(w, r, pageError, shown)
		return
	}
	if !s.admit(e, store.Kind(e.Kind) == store.KindText && s.countable(r), r, now) {
		s.pages.render(w, r, pageShareGone, shown)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Content-Security-Policy", shareCSP)
	h.Set("Cache-Control", "no-store")
	h.Set("X-Robots-Tag", "noindex")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("Content-Language", htmlLang[lang])
	h.Set("Vary", "Accept-Language")
	h.Set("Content-Length", strconv.Itoa(buf.Len()))
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		w.Write(buf.Bytes())
	}
}

func firstOf(xs ...string) string {
	for _, x := range xs {
		if x != "" {
			return x
		}
	}
	return ""
}

func lineNumbers(n int64) string {
	var b strings.Builder
	for i := int64(1); i <= n; i++ {
		if i > 1 {
			b.WriteByte('\n')
		}
		b.WriteString(strconv.FormatInt(i, 10))
	}
	return b.String()
}

func groupDigits(n int64) string {
	s := strconv.FormatInt(n, 10)
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	return s
}

// formatSize shows a byte count the way the admin app does: 1024-based,
// one decimal below ten.
func formatSize(n int64) string {
	units := []string{"B", "KB", "MB", "GB"}
	v, u := float64(n), 0
	for v >= 1024 && u < len(units)-1 {
		v /= 1024
		u++
	}
	switch {
	case u == 0:
		return strconv.FormatInt(n, 10) + " B"
	case v < 10:
		return strconv.FormatFloat(v, 'f', 1, 64) + " " + units[u]
	}
	return strconv.FormatFloat(v, 'f', 0, 64) + " " + units[u]
}

func formatWhen(t time.Time, lang string) string {
	if lang == "zh" {
		return t.Format("2006年1月2日 15:04")
	}
	return t.Format("Jan 2, 2006, 15:04")
}
