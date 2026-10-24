package server

// Links can carry an access password. Visitors see a form instead of the
// share or the redirect; the form posts back to the same path. A text or
// file share then sets a cookie scoped to that one path, and its raw bytes
// on the files origin need a short-lived token in the query, because the
// cookie never reaches that origin. A redirect is followed straight after a
// correct password and remembers nothing.
//
// Both proofs are HMACs over the link ID, its current password and an
// expiry, keyed by a secret made at startup: changing the password, or
// restarting the server, asks for the password again.

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"html/template"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/DejavuMoe/sani/internal/cache"
	"github.com/DejavuMoe/sani/internal/links"
)

const (
	unlockCookie   = "sani_unlock"
	unlockLifetime = 12 * time.Hour // how long an unlocked share stays open in a browser
	rawLifetime    = time.Hour      // how long a raw or download link from an unlocked page works
	maxUnlockBody  = 4 << 10
)

func newUnlockSecret() []byte {
	k := make([]byte, 32)
	rand.Read(k)
	return k
}

func (s *Server) proof(purpose string, e *cache.Entry, expires int64) string {
	m := hmac.New(sha256.New, s.unlockKey)
	m.Write([]byte(purpose))
	var b [16]byte
	binary.BigEndian.PutUint64(b[:8], uint64(e.ID))
	binary.BigEndian.PutUint64(b[8:], uint64(expires))
	m.Write(b[:])
	m.Write([]byte(e.Password))
	out := binary.BigEndian.AppendUint64(nil, uint64(expires))
	return base64.RawURLEncoding.EncodeToString(m.Sum(out))
}

func (s *Server) validProof(purpose, token string, e *cache.Entry, now time.Time) bool {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(raw) != 8+sha256.Size {
		return false
	}
	expires := int64(binary.BigEndian.Uint64(raw[:8]))
	if now.UnixMilli() >= expires {
		return false
	}
	return hmac.Equal([]byte(token), []byte(s.proof(purpose, e, expires)))
}

// unlocked reports whether the request may see a protected share.
func (s *Server) unlocked(r *http.Request, e *cache.Entry) bool {
	if e.Password == "" {
		return true
	}
	c, err := r.Cookie(unlockCookie)
	return err == nil && s.validProof("share", c.Value, e, time.Now())
}

// rawToken is appended to raw and download links on an unlocked page.
func (s *Server) rawToken(e *cache.Entry) string {
	return s.proof("raw", e, time.Now().Add(rawLifetime).UnixMilli())
}

// guard answers a request for a protected link that has not been unlocked:
// the form for GET and HEAD, the password check for POST. It reports true
// when the caller may go on; for a redirect that means the password was
// right and the visit should be followed.
func (s *Server) guard(w http.ResponseWriter, r *http.Request, e *cache.Entry, shown string) bool {
	render := func(problem string, status int) {
		s.renderUnlock(w, r, shown, formTarget(e), problem, status)
	}
	if r.Method != http.MethodPost {
		render("", http.StatusOK)
		return false
	}
	now := time.Now()
	key := s.clientIP(r) + "\x00" + strconv.FormatInt(e.ID, 10)
	if blocked, wait := s.unlocks.Blocked(key, now); blocked {
		w.Header().Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
		render("rate", http.StatusTooManyRequests)
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUnlockBody)
	attempt := ""
	if err := r.ParseForm(); err == nil {
		attempt = r.PostForm.Get("password")
	}
	switch {
	case strings.TrimSpace(attempt) == "":
		render("empty", http.StatusBadRequest)
		return false
	case !links.SamePassword(attempt, e.Password):
		s.unlocks.Fail(key, now)
		render("wrong", http.StatusForbidden)
		return false
	}
	s.unlocks.Reset(key)
	if e.Kind != 0 {
		path := strings.TrimSuffix(r.URL.EscapedPath(), "/")
		http.SetCookie(w, &http.Cookie{
			Name:     unlockCookie,
			Value:    s.proof("share", e, now.Add(unlockLifetime).UnixMilli()),
			Path:     path,
			MaxAge:   int(unlockLifetime.Seconds()),
			HttpOnly: true,
			Secure:   s.isHTTPS(r),
			SameSite: http.SameSiteLaxMode,
		})
		w.Header().Set("Cache-Control", "no-store")
		http.Redirect(w, r, path, http.StatusSeeOther)
		return false
	}
	return true
}

type unlockText struct {
	Title, Label, Submit, Empty, Wrong, Rate string
}

var unlockCopy = map[string]unlockText{
	"zh": {Title: "输入访问密码", Label: "访问密码", Submit: "继续", Empty: "请输入访问密码", Wrong: "密码不正确", Rate: "尝试次数过多，请 1 分钟后再试"},
	"en": {Title: "Enter the password", Label: "Password", Submit: "Continue", Empty: "Enter the password to continue", Wrong: "Incorrect password", Rate: "Too many attempts. Try again in a minute."},
}

const unlockCSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'%s; frame-ancestors 'none'; base-uri 'none'"

// formTarget is the extra form-action source a short link's form needs:
// browsers check form-action against every redirect after the submission,
// so the 303 to the destination must be allowed. Shares redirect to
// themselves and need nothing.
func formTarget(e *cache.Entry) string {
	if e.Kind != 0 {
		return ""
	}
	u, err := url.Parse(e.Location)
	if err != nil || u.Scheme == "" {
		return ""
	}
	if u.Host == "" {
		return " " + u.Scheme + ":"
	}
	// Location is already normalized: an ASCII host without spaces or ';'.
	return " " + u.Scheme + "://" + u.Host
}

// The form posts to the page's own URL, so it works without script.
const unlockPage = `<!doctype html>
<html lang="{{.Lang}}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>{{.L.Title}}</title>
<style>
` + visitorTokens + `
body{display:grid;min-height:100vh;min-height:100dvh;place-items:center;padding:24px 16px}
main{width:min(100%,320px);text-align:center}
.mark{display:grid;width:40px;height:40px;margin:0 auto 16px;place-items:center;border-radius:10px;background:var(--soft);color:var(--fg2)}
h1{margin:0;font-size:16px;font-weight:600;line-height:1.5}
.where{margin:4px 0 0;color:var(--fg2);font-size:12px;overflow-wrap:anywhere}
form{display:grid;gap:8px;margin-top:24px;text-align:left}
input{width:100%;height:40px;padding:0 12px;border:0;border-radius:8px;box-shadow:inset 0 0 0 .5px var(--line2);background:var(--surface);
color:var(--fg);font:16px/1 var(--mono);letter-spacing:.04em;outline:none}
input:focus,input:focus-visible{outline:none;box-shadow:inset 0 0 0 .5px var(--focus),0 0 0 2px var(--ring)}
input[aria-invalid=true]{box-shadow:inset 0 0 0 .5px var(--danger-line)}
input[aria-invalid=true]:focus{box-shadow:inset 0 0 0 .5px var(--danger-line),0 0 0 2px var(--danger-ring)}
.error{margin:0;color:var(--danger);font-size:12px}
button{height:40px;border:0;border-radius:8px;background:var(--solid);color:#fff;font:inherit;font-weight:500;cursor:pointer}
button:hover{background:var(--solid-hover)}
button:disabled{cursor:default}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
</style>
</head>
<body>
<main>
<div class="mark"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="10" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg></div>
<h1>{{.L.Title}}</h1>
<p class="where mono">{{.Where}}</p>
<form method="post" novalidate>
<label class="sr" for="password">{{.L.Label}}</label>
<input id="password" name="password" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="64" autofocus{{if .Error}} aria-invalid="true" aria-describedby="error"{{end}}>
{{if .Error}}<p class="error" id="error" role="alert">{{.Error}}</p>
{{end}}<button type="submit"{{if .Blocked}} disabled{{end}}>{{.L.Submit}}</button>
</form>
</main>
</body>
</html>
`

var unlockTemplate = template.Must(template.New("unlock").Parse(unlockPage))

func (s *Server) renderUnlock(w http.ResponseWriter, r *http.Request, shown, target, problem string, status int) {
	lang := pageLang(r)
	l := unlockCopy[lang]
	msg := map[string]string{"empty": l.Empty, "wrong": l.Wrong, "rate": l.Rate}[problem]
	var buf bytes.Buffer
	unlockTemplate.Execute(&buf, map[string]any{
		"Lang": htmlLang[lang], "L": l, "Error": msg, "Blocked": problem == "rate",
		"Where": r.Host + "/" + truncate(shown, 256),
	})
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Content-Security-Policy", fmt.Sprintf(unlockCSP, target))
	h.Set("Cache-Control", "no-store")
	h.Set("X-Robots-Tag", "noindex")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("Content-Language", htmlLang[lang])
	h.Set("Vary", "Accept-Language")
	h.Set("Content-Length", strconv.Itoa(buf.Len()))
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		w.Write(buf.Bytes())
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return strings.ToValidUTF8(s[:n], "")
}
