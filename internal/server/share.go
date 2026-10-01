package server

// Texts and files are links that share content instead of redirecting. The
// owner creates them through the API. Visitors open /p/{slug} on the main
// origin, a page that shows a text (escaped) or describes a file, and fetch
// the bytes from the files origin (SANI_FILES_URL), which serves nothing
// else. Uploaded bytes never share an origin with the admin app.

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/DejavuMoe/sani/internal/cache"
	"github.com/DejavuMoe/sani/internal/links"
	"github.com/DejavuMoe/sani/internal/store"
)

// sharedSlugLength is the shortest generated slug for a text or a file.
// Nothing lists them, so the slug is all that keeps them private, and ten
// characters from the 31-letter alphabet are far beyond guessing.
const sharedSlugLength = 10

// maxDownloads bounds the file transfers running at once; each holds a file
// and a connection open for as long as the slowest reader needs.
const maxDownloads = 32

// rawURL is where the files origin serves a link's bytes, or "" without one.
func (s *Server) rawURL(l *store.Link) string {
	if s.opt.FilesURL == "" || l.Content == nil {
		return ""
	}
	u := s.opt.FilesURL + "/" + url.PathEscape(l.Slug)
	if l.Kind == store.KindFile {
		// A file name at the end lets curl -O and wget save it under that name.
		u += "/" + url.PathEscape(l.Content.Name)
	}
	return u
}

func (s *Server) onFilesOrigin(r *http.Request) bool {
	host := r.Host
	if s.opt.TrustProxy {
		if h := r.Header.Get("X-Forwarded-Host"); h != "" {
			host = strings.TrimSpace(strings.Split(h, ",")[0])
		}
	}
	if strings.EqualFold(host, s.filesHost) {
		return true
	}
	// "f.example.com:443" names the same origin as "https://f.example.com".
	h, port, ok := strings.Cut(host, ":")
	return ok && (port == "443" || port == "80") && strings.EqualFold(h, s.filesHost)
}

// applyOptions copies the settings every kind of link shares from p into a
// new link.
func applyOptions(l *store.Link, p *store.Patch) {
	if p.Title != nil {
		l.Title = *p.Title
	}
	if p.Enabled != nil {
		l.Enabled = *p.Enabled
	}
	if p.ExpiresAt != nil {
		l.ExpiresAt = *p.ExpiresAt
	}
	if p.MaxClicks != nil {
		l.MaxClicks = *p.MaxClicks
	}
}

// save inserts a new link under the requested slug, or a generated one, and
// reports problems to the client.
func (s *Server) save(w http.ResponseWriter, r *http.Request, l *store.Link, slug *string) bool {
	var err error
	if slug != nil && *slug != "" {
		l.Slug = *slug
		err = s.store.CreateLink(r.Context(), l, true)
	} else {
		err = s.createGenerated(r, l)
	}
	if errors.Is(err, store.ErrSlugTaken) {
		writeError(w, http.StatusConflict, "slug_taken", "this slug is already in use")
		return false
	}
	if err != nil {
		s.internalError(w, r, err)
		return false
	}
	s.cache.Invalidate(links.Key(l.Slug))
	return true
}

func (s *Server) createText(w http.ResponseWriter, r *http.Request) {
	var in linkInput
	if !decodeJSONMax(w, r, &in, maxTextBody) {
		return
	}
	if in.Text == nil {
		writeError(w, http.StatusBadRequest, "text_required", "text is required")
		return
	}
	now := time.Now().UnixMilli()
	p, ierr := s.resolveInput(r, &in, now)
	if ierr == nil {
		ierr = checkKind(store.KindText, p)
	}
	if ierr != nil {
		writeError(w, ierr.status, ierr.code, ierr.msg)
		return
	}
	text := *p.Text
	l := &store.Link{
		Kind:      store.KindText,
		Meta:      store.MetaManual,
		Redirect:  http.StatusFound,
		Enabled:   true,
		CreatedAt: now,
		UpdatedAt: now,
		Content: &store.Content{
			Name:  links.TextPreview(text),
			Size:  int64(len(text)),
			Lines: links.TextLines(text),
			Text:  text,
		},
	}
	if p.Format != nil {
		l.Content.Format = *p.Format
	}
	applyOptions(l, p)
	if s.save(w, r, l, p.Slug) {
		writeJSON(w, http.StatusCreated, s.toDTO(s.baseURL(r), l, now))
	}
}

// linkText returns the body of a text link, which listings leave out.
func (s *Server) linkText(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	body, err := s.store.TextBody(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "no such text")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"text": body})
}

// transferTime is how long a transfer of n bytes may take: a minute, plus the
// time a slow 64 KB/s connection needs.
func transferTime(n int64) time.Duration {
	return time.Minute + time.Duration(n/(64<<10))*time.Second
}

var errFileTooLarge = errors.New("file too large")

// upload is a file received into the files directory under a random name.
type upload struct {
	name, ctype, file string
	size              int64
	sum               []byte
}

// uploadFields are the multipart fields createFile reads besides the file.
var uploadFields = map[string]bool{"slug": true, "title": true, "expiresAt": true, "maxClicks": true, "enabled": true}

// createFile stores one uploaded file as a new link. The body is
// multipart/form-data with a "file" part and optional fields named like the
// JSON ones; the file is streamed to disk, never held in memory.
func (s *Server) createFile(w http.ResponseWriter, r *http.Request) {
	if s.opt.FilesURL == "" {
		writeError(w, http.StatusConflict, "files_disabled", "sharing files needs SANI_FILES_URL")
		return
	}
	limit := s.opt.MaxFileBytes
	rc := http.NewResponseController(w)
	rc.SetReadDeadline(time.Now().Add(transferTime(limit)))
	rc.SetWriteDeadline(time.Now().Add(transferTime(limit)))
	r.Body = http.MaxBytesReader(w, r.Body, limit+1<<20)
	mr, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "upload_invalid", "send the file as multipart/form-data")
		return
	}

	var up *upload
	defer func() {
		if up != nil && up.file != "" {
			os.Remove(filepath.Join(s.opt.FilesDir, up.file))
		}
	}()
	tooLargeMsg := fmt.Sprintf("files are limited to %d MB", limit>>20)
	fields := map[string]string{}
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, "file_too_large", tooLargeMsg)
			return
		}
		if err != nil {
			writeError(w, http.StatusBadRequest, "upload_invalid", "the multipart body is malformed")
			return
		}
		name := part.FormName()
		switch {
		case name == "file" && up == nil:
			up, err = s.receive(part, limit)
			if errors.Is(err, errFileTooLarge) || errors.As(err, &tooBig) {
				writeError(w, http.StatusRequestEntityTooLarge, "file_too_large", tooLargeMsg)
				return
			}
			if errors.Is(err, io.ErrUnexpectedEOF) {
				writeError(w, http.StatusBadRequest, "upload_invalid", "the upload ended early")
				return
			}
			if err != nil {
				s.internalError(w, r, err)
				return
			}
		case name == "file":
			writeError(w, http.StatusBadRequest, "upload_invalid", "send one file at a time")
			return
		case uploadFields[name]:
			v, err := io.ReadAll(io.LimitReader(part, 4<<10+1))
			if err != nil || len(v) > 4<<10 {
				writeError(w, http.StatusBadRequest, "upload_invalid", "the "+name+" field is too long")
				return
			}
			fields[name] = string(v)
		}
		part.Close()
	}
	if up == nil || up.size == 0 {
		writeError(w, http.StatusBadRequest, "file_required", "attach a file that is not empty")
		return
	}

	in, ierr := formInput(fields)
	now := time.Now().UnixMilli()
	var p *store.Patch
	if ierr == nil {
		p, ierr = s.resolveInput(r, in, now)
	}
	if ierr != nil {
		writeError(w, ierr.status, ierr.code, ierr.msg)
		return
	}
	l := &store.Link{
		Kind:      store.KindFile,
		Meta:      store.MetaManual,
		Redirect:  http.StatusFound,
		Enabled:   true,
		CreatedAt: now,
		UpdatedAt: now,
		Content:   &store.Content{Name: up.name, Type: up.ctype, Size: up.size, SHA256: up.sum, File: up.file},
	}
	applyOptions(l, p)
	if !s.save(w, r, l, p.Slug) {
		return
	}
	up.file = "" // the link owns it now
	s.log.Info("file shared", "slug", l.Slug, "bytes", l.Content.Size)
	writeJSON(w, http.StatusCreated, s.toDTO(s.baseURL(r), l, now))
}

// formInput reads multipart fields as the JSON body of a create request.
func formInput(f map[string]string) (*linkInput, *inputError) {
	in := &linkInput{}
	if v, ok := f["slug"]; ok {
		in.Slug = &v
	}
	if v, ok := f["title"]; ok {
		in.Title = &v
	}
	if v := strings.TrimSpace(f["expiresAt"]); v != "" {
		in.ExpiresAt = nullable[string]{Set: true, Value: v}
	}
	if v := strings.TrimSpace(f["maxClicks"]); v != "" {
		n, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return nil, badInput("max_clicks_invalid", "maxClicks must be a positive whole number")
		}
		in.MaxClicks = nullable[float64]{Set: true, Value: n}
	}
	if v := strings.TrimSpace(f["enabled"]); v != "" {
		b, err := strconv.ParseBool(v)
		if err != nil {
			return nil, badInput("upload_invalid", "enabled must be true or false")
		}
		in.Enabled = &b
	}
	return in, nil
}

// receive streams a file part into the files directory. The bytes land in a
// temporary file first, so a half-received upload never looks like a file
// some link might own.
func (s *Server) receive(part *multipart.Part, limit int64) (*upload, error) {
	dir := s.opt.FilesDir
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, fmt.Errorf("create files directory: %w", err)
	}
	var id [16]byte
	rand.Read(id[:])
	name := hex.EncodeToString(id[:])
	tmp := filepath.Join(dir, ".upload-"+name)
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o640)
	if err != nil {
		return nil, fmt.Errorf("create upload: %w", err)
	}
	defer os.Remove(tmp) // a no-op once renamed

	h := sha256.New()
	head := &prefix{max: 512}
	n, err := io.Copy(io.MultiWriter(f, h, head), io.LimitReader(part, limit+1))
	if err == nil && n > limit {
		err = errFileTooLarge
	}
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return nil, err
	}
	if err := os.Rename(tmp, filepath.Join(dir, name)); err != nil {
		return nil, fmt.Errorf("store upload: %w", err)
	}

	up := &upload{name: links.FileName(part.FileName()), file: name, size: n, sum: h.Sum(nil)}
	// The extension says more than the bytes for most office and archive
	// formats; sniffing covers files without one.
	up.ctype = mime.TypeByExtension(strings.ToLower(filepath.Ext(up.name)))
	if up.ctype == "" {
		up.ctype = http.DetectContentType(head.buf)
	}
	return up, nil
}

// prefix keeps the first max bytes written to it.
type prefix struct {
	buf []byte
	max int
}

func (p *prefix) Write(b []byte) (int, error) {
	if room := p.max - len(p.buf); room > 0 {
		p.buf = append(p.buf, b[:min(room, len(b))]...)
	}
	return len(b), nil
}

// storedName reports whether name is one receive could have chosen.
func storedName(name string) bool {
	if len(name) != 32 {
		return false
	}
	_, err := hex.DecodeString(name)
	return err == nil && strings.ToLower(name) == name
}

// sweepFiles removes files no link refers to any more: those of purged
// links, and uploads that never became one. A file younger than ten minutes
// may belong to a link being saved right now, so it stays for the next round.
func (s *Server) sweepFiles(ctx context.Context, now time.Time) {
	if s.opt.FilesDir == "" {
		return
	}
	entries, err := os.ReadDir(s.opt.FilesDir)
	if errors.Is(err, fs.ErrNotExist) {
		return
	}
	if err != nil {
		s.log.Error("list files", "err", err)
		return
	}
	keep, err := s.store.StoredFiles(ctx)
	if err != nil {
		s.log.Error("list stored files", "err", err)
		return
	}
	removed := 0
	for _, e := range entries {
		name := e.Name()
		info, err := e.Info()
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		age := now.Sub(info.ModTime())
		switch {
		case strings.HasPrefix(name, ".upload-") && age > time.Hour:
		case storedName(name) && !keep[name] && age > 10*time.Minute:
		default:
			continue
		}
		if err := os.Remove(filepath.Join(s.opt.FilesDir, name)); err != nil {
			s.log.Warn("remove file", "name", name, "err", err)
			continue
		}
		removed++
	}
	if removed > 0 {
		s.log.Info("removed unused files", "count", removed)
	}
}

// admit applies a link's limits to one visit, counting it when count is
// set, and reports whether the visit may proceed.
func (s *Server) admit(e *cache.Entry, count bool, r *http.Request, now time.Time) bool {
	if !e.Enabled || (e.ExpiresAt != 0 && now.UnixMilli() >= e.ExpiresAt) {
		return false
	}
	if e.MaxClicks > 0 {
		if count {
			if e.Clicks.Add(1) > e.MaxClicks {
				e.Clicks.Add(-1)
				return false
			}
		} else if e.Clicks.Load() >= e.MaxClicks {
			return false
		}
	}
	if count {
		s.clicks.Record(e.ID, referrerHost(r.Header.Get("Referer")), now)
	}
	return true
}

// lookupShared finds the text or file link behind a slug; nil when there is
// none.
func (s *Server) lookupShared(r *http.Request, slug string) (*cache.Entry, error) {
	if !links.Plausible(slug) {
		return nil, nil
	}
	e, err := s.cache.Get(r.Context(), links.Key(slug))
	if err != nil || e == nil || store.Kind(e.Kind) == store.KindURL {
		return nil, err
	}
	return e, nil
}

// sharedLink loads the full link behind a cache entry; nil when it was
// deleted since the entry was cached.
func (s *Server) sharedLink(r *http.Request, e *cache.Entry) (*store.Link, error) {
	l, err := s.store.GetLink(r.Context(), e.ID)
	if errors.Is(err, store.ErrNotFound) {
		return nil, nil
	}
	return l, err
}

func (s *Server) logShareError(r *http.Request, err error) {
	if r.Context().Err() == nil {
		s.log.Error("open share", "path", r.URL.Path, "err", err)
	}
}

// Every response from the files origin is inert: it cannot run script, be
// framed, be sniffed into another type or be embedded by other sites.
var filesHeaders = http.Header{
	"X-Content-Type-Options":       {"nosniff"},
	"Content-Security-Policy":      {"default-src 'none'; sandbox"},
	"Cross-Origin-Resource-Policy": {"same-origin"},
	"X-Frame-Options":              {"DENY"},
	"Referrer-Policy":              {"no-referrer"},
	"X-Robots-Tag":                 {"noindex"},
	"Cache-Control":                {"no-store"},
}

func plainStatus(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(code)
	io.WriteString(w, msg+"\n")
}

// serveFiles answers the files origin: /{slug} is a text as plain text or a
// file as a download, and /{slug}/{name} downloads either under that name.
func (s *Server) serveFiles(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	for k, v := range filesHeaders {
		h[k] = v
	}
	if r.URL.Path == "/robots.txt" {
		plainStatus(w, http.StatusOK, "User-agent: *\nDisallow: /")
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		h.Set("Allow", "GET, HEAD")
		plainStatus(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	slug, named, _ := strings.Cut(strings.TrimPrefix(r.URL.Path, "/"), "/")
	e, err := s.lookupShared(r, slug)
	if err != nil {
		s.logShareError(r, err)
		plainStatus(w, http.StatusInternalServerError, "internal error")
		return
	}
	if e == nil {
		plainStatus(w, http.StatusNotFound, "not found")
		return
	}
	// Wait for a slot before counting, so a busy server never uses up a
	// visit it didn't serve.
	if store.Kind(e.Kind) == store.KindFile {
		select {
		case s.downloads <- struct{}{}:
			defer func() { <-s.downloads }()
		default:
			h.Set("Retry-After", "5")
			plainStatus(w, http.StatusServiceUnavailable, "too many downloads at once; try again in a moment")
			return
		}
	}
	now := time.Now()
	if !s.admit(e, downloadCountable(r), r, now) {
		plainStatus(w, http.StatusGone, "no longer shared")
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
		plainStatus(w, http.StatusInternalServerError, "internal error")
		return
	}
	if l == nil {
		plainStatus(w, http.StatusNotFound, "not found")
		return
	}
	modified := time.UnixMilli(l.UpdatedAt)

	if l.Kind == store.KindText {
		h.Set("Content-Type", "text/plain; charset=utf-8")
		if named != "" {
			h.Set("Content-Disposition", disposition(l.Slug+".txt"))
		}
		http.ServeContent(w, r, "", modified, strings.NewReader(body))
		return
	}

	c := l.Content
	f, err := s.openStored(c.File)
	if err != nil {
		s.log.Error("open shared file", "slug", l.Slug, "err", err)
		plainStatus(w, http.StatusInternalServerError, "the file is missing")
		return
	}
	defer f.Close()
	http.NewResponseController(w).SetWriteDeadline(now.Add(transferTime(c.Size)))
	h.Set("Content-Type", c.Type)
	h.Set("Content-Disposition", disposition(c.Name))
	h.Set("ETag", `"`+hex.EncodeToString(c.SHA256)+`"`)
	http.ServeContent(w, r, "", modified, f)
}

// openStored opens a file that receive stored. Names are checked so a
// damaged row can never point outside the files directory.
func (s *Server) openStored(name string) (*os.File, error) {
	if !storedName(name) {
		return nil, fmt.Errorf("invalid stored file name %q", name)
	}
	return os.Open(filepath.Join(s.opt.FilesDir, name))
}

// downloadCountable reports whether a request on the files origin fetches
// the content for someone: link previews and prefetches don't count, nor do
// the later parts of a download that resumes. Command-line tools do count;
// they are how people download files.
func downloadCountable(r *http.Request) bool {
	if r.Method != http.MethodGet {
		return false
	}
	if rg := r.Header.Get("Range"); rg != "" && !strings.HasPrefix(strings.TrimSpace(rg), "bytes=0-") {
		return false
	}
	h := r.Header
	if strings.Contains(h.Get("Sec-Purpose"), "prefetch") || strings.Contains(h.Get("Purpose"), "prefetch") {
		return false
	}
	ua := strings.ToLower(r.UserAgent())
	return strings.HasPrefix(ua, "curl/") || strings.HasPrefix(ua, "wget/") || !isBot(ua)
}

// disposition makes an attachment header that names the file, with an ASCII
// fallback for clients that don't read the UTF-8 form.
func disposition(name string) string {
	ascii := []byte(name)
	plain := true
	for i, c := range ascii {
		if c < 0x20 || c >= 0x7f || c == '"' || c == '\\' {
			ascii[i] = '_'
			plain = false
		}
	}
	v := `attachment; filename="` + string(ascii) + `"`
	if !plain {
		v += "; filename*=UTF-8''" + extValue(name)
	}
	return v
}

// extValue percent-encodes everything but RFC 8187's attr-chars.
func extValue(s string) string {
	const hexDigits = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.IndexByte("!#$&+-.^_`|~", c) >= 0 {
			b.WriteByte(c)
			continue
		}
		b.WriteByte('%')
		b.WriteByte(hexDigits[c>>4])
		b.WriteByte(hexDigits[c&15])
	}
	return b.String()
}
