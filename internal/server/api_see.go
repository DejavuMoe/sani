package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/DejavuMoe/sani/internal/auth"
	"github.com/DejavuMoe/sani/internal/links"
	"github.com/DejavuMoe/sani/internal/store"
)

// This adapter implements the bounded HTTP contract documented in reference/api.
// It never authenticates with cookies or calls the management HTTP handlers.
func (s *Server) seeRoutes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/shorten", s.seeShorten)
	mux.HandleFunc("GET /api/v1/shorten", s.seeSimple)
	mux.HandleFunc("PUT /api/v1/shorten", s.seeShorten)
	mux.HandleFunc("DELETE /api/v1/shorten", s.seeShorten)
	mux.HandleFunc("POST /api/v1/text", s.seeText)
	mux.HandleFunc("PUT /api/v1/text", s.seeText)
	mux.HandleFunc("DELETE /api/v1/text", s.seeText)
	mux.HandleFunc("GET /api/v1/domains", s.seeDomains)
	mux.HandleFunc("GET /api/v1/text/domains", s.seeDomains)
	mux.HandleFunc("GET /api/v1/file/domains", s.seeDomains)
	mux.HandleFunc("GET /api/v1/tags", s.seeTags)
	mux.HandleFunc("GET /api/v1/link/visit-stat", s.seeVisitStat)
	mux.HandleFunc("POST /api/v1/file/upload", s.seeUpload)
	mux.HandleFunc("GET /api/v1/files", s.seeFiles)
	mux.HandleFunc("GET /api/v1/file/delete/{hash}", s.seeDeleteFile)
	mux.HandleFunc("/api/v1/", func(w http.ResponseWriter, r *http.Request) {
		seeError(w, r, &inputError{http.StatusNotImplemented, "unsupported_endpoint", "endpoint outside Sani's s.ee compatibility profile"})
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		// Go's GET patterns also match HEAD. Neither exceptional GET may mutate on HEAD.
		if r.Method == http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" || r.Header.Get("Origin") != "" && r.Header.Get("Origin") != s.requestOrigin(r) {
			seeError(w, r, &inputError{http.StatusForbidden, "cross_origin", "cross-origin request refused"})
			return
		}
		secret, ierr := seeCredential(r)
		if ierr != nil {
			seeError(w, r, ierr)
			return
		}
		token, err := s.store.TokenByHash(r.Context(), auth.HashSecret(secret))
		if err != nil {
			if !errors.Is(err, store.ErrNotFound) {
				s.seeFailure(w, r, err)
				return
			}
			seeError(w, r, &inputError{http.StatusUnauthorized, "unauthorized", "provide a valid Sani API token"})
			return
		}
		if now := time.Now().UnixMilli(); now-token.UsedAt > time.Minute.Milliseconds() {
			if err := s.store.TouchToken(r.Context(), token.ID, now); err != nil {
				s.log.Warn("touch compatibility token", "err", err)
			}
		}
		mux.ServeHTTP(w, r)
	})
}

func seeCredential(r *http.Request) (string, *inputError) {
	var secret string
	values := append(append([]string{}, r.Header.Values("Authorization")...), r.Header.Values("X-Api-Key")...)
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return "", badInput("invalid_parameter", "invalid query encoding")
	}
	if signatures, ok := q["signature"]; ok {
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/shorten" {
			return "", badInput("unsupported_parameter", "signature is only allowed in Simple Mode")
		}
		values = append(values, signatures...)
	}
	for _, value := range values {
		v := strings.TrimSpace(value)
		if len(v) >= 7 && strings.EqualFold(v[:7], "bearer ") {
			v = strings.TrimSpace(v[7:])
		}
		if v == "" || strings.ContainsAny(v, " \t\r\n,") || secret != "" && secret != v {
			return "", &inputError{http.StatusUnauthorized, "unauthorized", "empty, malformed or conflicting API credentials"}
		}
		secret = v
	}
	if secret == "" {
		return "", &inputError{http.StatusUnauthorized, "unauthorized", "an API token is required; cookies are not accepted"}
	}
	return secret, nil
}

func seeError(w http.ResponseWriter, r *http.Request, err *inputError) {
	var code any = err.status
	if strings.HasPrefix(r.URL.Path, "/api/v1/file/delete/") {
		code = strconv.Itoa(err.status)
	}
	writeJSON(w, err.status, map[string]any{"code": code, "message": err.msg, "error": err.code, "success": false})
}

func (s *Server) seeFailure(w http.ResponseWriter, r *http.Request, err error) bool {
	if err == nil {
		return false
	}
	var in *inputError
	switch {
	case errors.As(err, &in):
	case errors.Is(err, store.ErrNotFound):
		in = &inputError{404, "not_found", "no such resource"}
	case errors.Is(err, store.ErrSlugTaken):
		in = &inputError{409, "slug_taken", "this slug is already in use"}
	case errors.Is(err, store.ErrTagsInvalid):
		in = badInput("tags_invalid", "invalid tag IDs")
	default:
		// RequestURI can contain a signature or deletion handle; keep both out of logs.
		s.log.Error("compatibility request failed", "method", r.Method, "err", err)
		in = &inputError{500, "internal", "internal error"}
	}
	seeError(w, r, in)
	return true
}

func seeOK(w http.ResponseWriter, data any) {
	writeJSON(w, http.StatusOK, map[string]any{"code": 200, "message": "success", "data": data})
}

type seeInput struct {
	Domain     string   `json:"domain"`
	Slug       string   `json:"slug"`
	CustomSlug *string  `json:"custom_slug"`
	TargetURL  *string  `json:"target_url"`
	Title      *string  `json:"title"`
	Content    *string  `json:"content"`
	TextType   *string  `json:"text_type"`
	ExpireAt   *int64   `json:"expire_at"`
	TagIDs     *[]int64 `json:"tag_ids"`
}

// Reject unknown fields, duplicates, null and trailing JSON before any mutation.
// In particular, password and expiration_redirect_url cannot silently disappear.
func readSeeInput(w http.ResponseWriter, r *http.Request, allowed string) (*seeInput, *inputError) {
	ct, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || ct != "application/json" {
		return nil, &inputError{415, "content_type", "send application/json"}
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxTextBody)
	d := json.NewDecoder(r.Body)
	start, err := d.Token()
	if err != nil || start != json.Delim('{') {
		return nil, badInput("bad_json", "request body must be a JSON object")
	}
	fields := map[string]json.RawMessage{}
	for d.More() {
		t, err := d.Token()
		if err != nil {
			return nil, badInput("bad_json", "invalid JSON field")
		}
		key, ok := t.(string)
		if !ok {
			return nil, badInput("bad_json", "invalid JSON field")
		}
		if !slices.Contains(strings.Fields(allowed), key) {
			return nil, badInput("unsupported_parameter", "unsupported parameter: "+key)
		}
		if _, exists := fields[key]; exists {
			return nil, badInput("bad_json", "duplicate field: "+key)
		}
		var value json.RawMessage
		if err := d.Decode(&value); err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				return nil, tooLarge("too_large", "request body is too large")
			}
			return nil, badInput("bad_json", "invalid field value")
		}
		// Unmarshal replaces invalid bytes, so validate before converting to strings.
		if !utf8.Valid(value) {
			return nil, badInput("invalid_parameter", "invalid UTF-8")
		}
		if string(value) == "null" {
			return nil, badInput("invalid_parameter", key+" must not be null")
		}
		fields[key] = value
	}
	if _, err := d.Token(); err != nil {
		return nil, badInput("bad_json", "incomplete JSON object")
	}
	if _, err := d.Token(); err != io.EOF {
		return nil, badInput("bad_json", "send exactly one JSON object")
	}
	body, _ := json.Marshal(fields)
	var in seeInput
	if err := json.Unmarshal(body, &in); err != nil {
		return nil, badInput("invalid_parameter", "invalid field type")
	}
	return &in, nil
}

func (s *Server) seeDomain(domain string, required bool) (string, *inputError) {
	base := s.opt.BaseURL
	if base == "" {
		base = *s.storedBase.Load()
	}
	if base == "" {
		return "", &inputError{503, "domain_unconfigured", "configure SANI_BASE_URL or the stored base URL before using the compatibility API"}
	}
	u, err := url.Parse(base)
	if err != nil || u.Host == "" {
		return "", &inputError{503, "domain_unconfigured", "invalid configured base URL"}
	}
	if domain == "" && !required {
		return u.Host, nil
	}
	if !strings.EqualFold(domain, u.Host) {
		return "", badInput("domain_invalid", "domain must match the configured main host (including any port)")
	}
	return u.Host, nil
}

func (s *Server) seeResource(r *http.Request, domain, slug string, kind store.Kind) (*store.Link, error) {
	if _, err := s.seeDomain(domain, true); err != nil {
		return nil, err
	}
	if slug == "" {
		return nil, badInput("slug_invalid", "slug is required")
	}
	l, err := s.store.LinkBySlug(r.Context(), links.Key(slug))
	if err == nil && l.Kind != kind {
		return nil, store.ErrNotFound
	}
	return l, err
}

func (s *Server) seeLinkInput(in *seeInput) (*linkInput, *inputError) {
	if _, err := s.seeDomain(in.Domain, false); err != nil {
		return nil, err
	}
	for _, value := range []*string{in.TargetURL, in.Title, in.CustomSlug} {
		if value != nil && !utf8.ValidString(*value) {
			return nil, badInput("invalid_parameter", "invalid UTF-8")
		}
	}
	if in.TargetURL != nil && utf8.RuneCountInString(*in.TargetURL) > 2000 {
		return nil, badInput("url_too_long", "target_url exceeds 2000 Unicode characters")
	}
	if in.Title != nil && utf8.RuneCountInString(*in.Title) > 255 {
		return nil, badInput("invalid_parameter", "title exceeds 255 Unicode characters")
	}
	if in.CustomSlug != nil && *in.CustomSlug != "" {
		if err := links.ValidateSlug(*in.CustomSlug); err != nil {
			return nil, fromLinkError(err)
		}
	}
	out := &linkInput{URL: in.TargetURL, Slug: in.CustomSlug, Title: in.Title, Text: in.Content}
	if in.TagIDs != nil {
		out.Tags = nullable[[]int64]{Set: true, Value: *in.TagIDs}
	}
	if in.ExpireAt != nil {
		if *in.ExpireAt < 0 || *in.ExpireAt > 253402300799 {
			return nil, badInput("expires_invalid", "expire_at must be Unix seconds in the supported date range")
		}
		out.ExpiresAt.Set = true
		if *in.ExpireAt != 0 {
			out.ExpiresAt.Value = time.Unix(*in.ExpireAt, 0).UTC().Format(time.RFC3339)
		}
	}
	if in.TextType != nil {
		var format string
		switch *in.TextType {
		case "plain_text":
			format = "plain"
		case "source_code":
			format = "code"
		default:
			return nil, badInput("unsupported_parameter", "text_type supports plain_text and source_code only")
		}
		out.Format = &format
	}
	return out, nil
}

func (s *Server) seeShorten(w http.ResponseWriter, r *http.Request) { s.seeMutate(w, r, store.KindURL) }
func (s *Server) seeText(w http.ResponseWriter, r *http.Request)    { s.seeMutate(w, r, store.KindText) }

func (s *Server) seeMutate(w http.ResponseWriter, r *http.Request, kind store.Kind) {
	if _, err := seeQuery(r, ""); err != nil {
		seeError(w, r, err)
		return
	}
	allowed := "domain slug"
	if r.Method == http.MethodPost {
		allowed = "domain custom_slug title expire_at tag_ids"
		if kind == store.KindURL {
			allowed += " target_url"
		} else {
			allowed += " content text_type"
		}
	} else if r.Method == http.MethodPut {
		allowed += " title"
		if kind == store.KindURL {
			allowed += " target_url"
		} else {
			allowed += " content"
		}
	}
	in, ierr := readSeeInput(w, r, allowed)
	if ierr != nil {
		seeError(w, r, ierr)
		return
	}
	var l *store.Link
	var err error
	if r.Method != http.MethodPost {
		l, err = s.seeResource(r, in.Domain, in.Slug, kind)
		if s.seeFailure(w, r, err) {
			return
		}
	}
	if r.Method == http.MethodDelete {
		err = s.purgeResource(r, l)
		if !s.seeFailure(w, r, err) {
			seeOK(w, nil)
		}
		return
	}
	p, ierr := s.seeLinkInput(in)
	if ierr != nil {
		seeError(w, r, ierr)
		return
	}
	if r.Method == http.MethodPost {
		if kind == store.KindURL {
			l, _, err = s.createURL(r, p)
		} else {
			l, err = s.createTextResource(r, p)
		}
	} else {
		if p.Title == nil && p.URL == nil && p.Text == nil {
			seeError(w, r, badInput("invalid_parameter", "provide a field to update"))
			return
		}
		p.expectedSlug = &l.Slug
		l, err = s.updateResource(r, l.ID, p)
	}
	if !s.seeFailure(w, r, err) {
		seeOK(w, s.seeCreated(r, l))
	}
}

func (s *Server) seeCreated(r *http.Request, l *store.Link) map[string]string {
	return map[string]string{"slug": l.Slug, "custom_slug": l.Slug, "short_url": s.baseURL(r) + shortPath(l)}
}

func (s *Server) purgeResource(r *http.Request, expected *store.Link) error {
	key, err := s.store.PurgeLink(r.Context(), expected)
	if err == nil {
		s.cache.Invalidate(links.Key(key))
	}
	return err
}

func seeQuery(r *http.Request, allowed string) (url.Values, *inputError) {
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return nil, badInput("invalid_parameter", "invalid query encoding")
	}
	for key, values := range q {
		if !slices.Contains(strings.Fields(allowed), key) || len(values) != 1 {
			return nil, badInput("unsupported_parameter", "unknown or repeated query parameter: "+key)
		}
	}
	return q, nil
}

func (s *Server) seeSimple(w http.ResponseWriter, r *http.Request) {
	q, ierr := seeQuery(r, "signature url domain custom_slug title tag_ids expire_at json")
	if ierr != nil {
		seeError(w, r, ierr)
		return
	}
	if q.Get("json") != "" && q.Get("json") != "true" && q.Get("json") != "false" {
		seeError(w, r, badInput("invalid_parameter", "json must be true or false"))
		return
	}
	in := &seeInput{Domain: q.Get("domain")}
	for key, dest := range map[string]**string{"url": &in.TargetURL, "title": &in.Title, "custom_slug": &in.CustomSlug} {
		if q.Has(key) {
			v := q.Get(key)
			*dest = &v
		}
	}
	if q.Has("expire_at") {
		n, err := strconv.ParseInt(q.Get("expire_at"), 10, 64)
		if err != nil {
			seeError(w, r, badInput("expires_invalid", "expire_at must be Unix seconds"))
			return
		}
		in.ExpireAt = &n
	}
	if q.Get("tag_ids") != "" {
		ids := []int64{}
		for _, v := range strings.Split(q.Get("tag_ids"), ",") {
			n, err := strconv.ParseInt(v, 10, 64)
			if err != nil || len(ids) >= 5 {
				seeError(w, r, badInput("tags_invalid", "tag_ids must be up to five comma-separated IDs"))
				return
			}
			ids = append(ids, n)
		}
		in.TagIDs = &ids
	}
	p, ierr := s.seeLinkInput(in)
	if ierr != nil {
		seeError(w, r, ierr)
		return
	}
	l, _, err := s.createURL(r, p)
	if s.seeFailure(w, r, err) {
		return
	}
	if q.Get("json") == "true" {
		seeOK(w, s.seeCreated(r, l))
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	fmt.Fprint(w, s.baseURL(r)+shortPath(l))
}

func (s *Server) seeDomains(w http.ResponseWriter, r *http.Request) {
	if _, err := seeQuery(r, ""); err != nil {
		seeError(w, r, err)
		return
	}
	domain, err := s.seeDomain("", false)
	if err != nil {
		seeError(w, r, err)
		return
	}
	domains := []string{domain}
	if r.URL.Path == "/api/v1/file/domains" && s.opt.FilesURL == "" {
		domains = []string{}
	}
	seeOK(w, map[string]any{"domains": domains})
}

func (s *Server) seeTags(w http.ResponseWriter, r *http.Request) {
	if _, err := seeQuery(r, ""); err != nil {
		seeError(w, r, err)
		return
	}
	c, err := s.store.Tags(r.Context())
	if s.seeFailure(w, r, err) {
		return
	}
	tags := make([]map[string]any, len(c.Items))
	for i, tag := range c.Items {
		tags[i] = map[string]any{"id": tag.ID, "name": tag.Name}
	}
	seeOK(w, map[string]any{"tags": tags})
}

func (s *Server) seeVisitStat(w http.ResponseWriter, r *http.Request) {
	q, ierr := seeQuery(r, "domain slug period")
	if ierr != nil {
		seeError(w, r, ierr)
		return
	}
	l, err := s.seeResource(r, q.Get("domain"), q.Get("slug"), store.KindURL)
	if s.seeFailure(w, r, err) {
		return
	}
	period := q.Get("period")
	if period != "" && period != "totally" && period != "daily" && period != "monthly" {
		seeError(w, r, badInput("invalid_parameter", "period must be daily, monthly or totally"))
		return
	}
	var count int64
	if period == "" || period == "totally" {
		count = s.clicks.Total(l.ID, l.Clicks)
	} else {
		if s.seeFailure(w, r, s.clicks.Flush(r.Context())) {
			return
		}
		now := time.Now().In(s.clicks.Location())
		from, today := s.clicks.Day(now), s.clicks.Day(now)
		if period == "monthly" {
			from -= int32(now.Day() - 1)
		}
		counts, err := s.store.Series(r.Context(), l.ID, from, today)
		if s.seeFailure(w, r, err) {
			return
		}
		for _, n := range counts {
			count += n
		}
	}
	seeOK(w, map[string]int64{"visit_count": count})
}

var seeUploadFields = map[string]bool{"domain": true, "custom_slug": true, "is_private": true}

func (s *Server) seeFileInput(fields map[string]string) (*linkInput, *inputError) {
	if privacy, ok := fields["is_private"]; ok && privacy != "0" {
		return nil, badInput("unsupported_parameter", "only public files (is_private=0) are supported")
	}
	in := &seeInput{Domain: fields["domain"]}
	if slug, ok := fields["custom_slug"]; ok {
		in.CustomSlug = &slug
	}
	return s.seeLinkInput(in)
}

func (s *Server) seeFileDTO(r *http.Request, l *store.Link) map[string]any {
	c := l.Content
	raw := s.rawURL(l)
	path := ""
	if u, err := url.Parse(raw); err == nil {
		path = u.EscapedPath()
	}
	return map[string]any{"created_at": l.CreatedAt / 1000, "delete": s.baseURL(r) + "/api/v1/file/delete/" + c.DeleteKey,
		"file_id": l.ID, "filename": c.Name, "hash": c.DeleteKey, "height": 0, "width": 0,
		"page": s.baseURL(r) + shortPath(l), "path": path, "size": c.Size, "storename": c.File,
		"upload_status": 1, "url": raw, "mime_type": c.Type}
}

func (s *Server) seeUpload(w http.ResponseWriter, r *http.Request) {
	if _, err := seeQuery(r, ""); err != nil {
		seeError(w, r, err)
		return
	}
	if _, err := s.seeDomain("", false); err != nil {
		seeError(w, r, err)
		return
	}
	l, err := s.uploadFile(w, r, true)
	if !s.seeFailure(w, r, err) {
		seeOK(w, s.seeFileDTO(r, l))
	}
}

func (s *Server) seeFiles(w http.ResponseWriter, r *http.Request) {
	q, ierr := seeQuery(r, "page")
	if ierr != nil {
		seeError(w, r, ierr)
		return
	}
	if _, err := s.seeDomain("", false); err != nil {
		seeError(w, r, err)
		return
	}
	page := 1
	if q.Has("page") {
		n, err := strconv.Atoi(q.Get("page"))
		if err != nil || n < 1 || n > 1_000_000 {
			seeError(w, r, badInput("invalid_parameter", "page must be between 1 and 1000000"))
			return
		}
		page = n
	}
	rows, err := s.store.FileHistory(r.Context(), page)
	if s.seeFailure(w, r, err) {
		return
	}
	out := make([]map[string]any, len(rows))
	for i, l := range rows {
		out[i] = s.seeFileDTO(r, l)
	}
	writeJSON(w, http.StatusOK, map[string]any{"code": 200, "message": "success", "success": true, "data": out})
}

func (s *Server) seeDeleteFile(w http.ResponseWriter, r *http.Request) {
	if _, err := seeQuery(r, ""); err != nil {
		seeError(w, r, err)
		return
	}
	l, err := s.store.FileByDeleteKey(r.Context(), r.PathValue("hash"))
	if s.seeFailure(w, r, err) || s.seeFailure(w, r, s.purgeResource(r, l)) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"code": "200", "message": "success", "success": true})
}
