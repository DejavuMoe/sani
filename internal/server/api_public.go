package server

import (
	"encoding/hex"
	"encoding/json"
	"errors"
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

// The public API uses the same business rules and storage as the admin app.
func (s *Server) publicRoutes() http.Handler {
	mux := http.NewServeMux()
	routes := []struct {
		pattern string
		handler http.HandlerFunc
	}{
		{"POST /api/v1/links", s.publicLinks},
		{"PATCH /api/v1/links/{slug}", s.publicLinks},
		{"DELETE /api/v1/links/{slug}", s.publicLinks},
		{"GET /api/v1/links/{slug}/stats", s.publicVisitStat},
		{"POST /api/v1/texts", s.publicText},
		{"PATCH /api/v1/texts/{slug}", s.publicText},
		{"DELETE /api/v1/texts/{slug}", s.publicText},
		{"GET /api/v1/domains", s.publicDomains},
		{"GET /api/v1/tags", s.publicTags},
		{"POST /api/v1/files", s.publicUpload},
		{"GET /api/v1/files", s.publicFiles},
		{"DELETE /api/v1/files/{key}", s.publicDeleteFile},
	}
	methods := map[string][]string{}
	for _, route := range routes {
		mux.HandleFunc(route.pattern, route.handler)
		method, path, _ := strings.Cut(route.pattern, " ")
		methods[path] = append(methods[path], method)
		if method == "GET" {
			methods[path] = append(methods[path], "HEAD")
		}
	}
	for path, allowed := range methods {
		mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Allow", strings.Join(allowed, ", "))
			publicError(w, r, &inputError{405, "method_not_allowed", "method not allowed for this resource"})
		})
	}
	mux.HandleFunc("/api/v1/", func(w http.ResponseWriter, r *http.Request) {
		publicError(w, r, &inputError{404, "not_found", "no such endpoint"})
	})

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" || r.Header.Get("Origin") != "" && r.Header.Get("Origin") != s.requestOrigin(r) {
			publicError(w, r, &inputError{http.StatusForbidden, "cross_origin", "cross-origin request refused"})
			return
		}
		secret, ierr := publicCredential(r)
		if ierr != nil {
			publicError(w, r, ierr)
			return
		}
		token, err := s.store.TokenByHash(r.Context(), auth.HashSecret(secret))
		if err != nil {
			if !errors.Is(err, store.ErrNotFound) {
				s.publicFailure(w, r, err)
				return
			}
			publicError(w, r, &inputError{http.StatusUnauthorized, "unauthorized", "provide a valid Sani API token"})
			return
		}
		if now := time.Now().UnixMilli(); now-token.UsedAt > time.Minute.Milliseconds() {
			if err := s.store.TouchToken(r.Context(), token.ID, now); err != nil {
				s.log.Warn("touch public API token", "err", err)
			}
		}
		mux.ServeHTTP(w, r)
	})
}

func publicCredential(r *http.Request) (string, *inputError) {
	values := r.Header.Values("Authorization")
	if len(values) == 1 && len(r.Header.Values("X-Api-Key")) == 0 {
		scheme, secret, ok := strings.Cut(values[0], " ")
		if ok && strings.EqualFold(scheme, "Bearer") && secret != "" && !strings.ContainsAny(secret, " \t\r\n,") {
			return secret, nil
		}
	}
	return "", &inputError{401, "unauthorized", "provide one Authorization: Bearer API token; cookies are not accepted"}
}

func publicError(w http.ResponseWriter, _ *http.Request, err *inputError) {
	if err.status == http.StatusUnauthorized {
		w.Header().Set("WWW-Authenticate", `Bearer realm="Sani"`)
	}
	writeError(w, err.status, err.code, err.msg)
}

func (s *Server) publicFailure(w http.ResponseWriter, r *http.Request, err error) bool {
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
		// Keep resource identifiers out of error logs.
		s.log.Error("public API request failed", "method", r.Method, "err", err)
		in = &inputError{500, "internal", "internal error"}
	}
	publicError(w, r, in)
	return true
}

func publicOK(w http.ResponseWriter, data any) {
	writeJSON(w, http.StatusOK, map[string]any{"data": data})
}

type publicInput struct {
	Domain     string   `json:"domain"`
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
func readPublicInput(w http.ResponseWriter, r *http.Request, allowed string) (*publicInput, *inputError) {
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
	var in publicInput
	if err := json.Unmarshal(body, &in); err != nil {
		return nil, badInput("invalid_parameter", "invalid field type")
	}
	return &in, nil
}

func (s *Server) publicDomain(domain string) (string, *inputError) {
	base := s.opt.BaseURL
	if base == "" {
		base = *s.storedBase.Load()
	}
	if base == "" {
		return "", &inputError{503, "domain_unconfigured", "configure SANI_BASE_URL or the stored base URL before using the public API"}
	}
	u, err := url.Parse(base)
	if err != nil || u.Host == "" {
		return "", &inputError{503, "domain_unconfigured", "invalid configured base URL"}
	}
	if domain == "" {
		return u.Host, nil
	}
	if !strings.EqualFold(domain, u.Host) {
		return "", badInput("domain_invalid", "domain must match the configured main host (including any port)")
	}
	return u.Host, nil
}

func (s *Server) publicResource(r *http.Request, domain, slug string, kind store.Kind) (*store.Link, error) {
	if _, err := s.publicDomain(domain); err != nil {
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

func (s *Server) publicLinkInput(in *publicInput) (*linkInput, *inputError) {
	if _, err := s.publicDomain(in.Domain); err != nil {
		return nil, err
	}
	for _, value := range []*string{in.TargetURL, in.Title, in.CustomSlug} {
		if value != nil && !utf8.ValidString(*value) {
			return nil, badInput("invalid_parameter", "invalid UTF-8")
		}
	}
	if in.Title != nil && utf8.RuneCountInString(*in.Title) > links.MaxTitleLength {
		return nil, badInput("invalid_parameter", "title exceeds 300 Unicode characters")
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

func (s *Server) publicLinks(w http.ResponseWriter, r *http.Request) {
	s.publicMutate(w, r, store.KindURL)
}
func (s *Server) publicText(w http.ResponseWriter, r *http.Request) {
	s.publicMutate(w, r, store.KindText)
}

func (s *Server) publicMutate(w http.ResponseWriter, r *http.Request, kind store.Kind) {
	queryFields := ""
	if r.Method == http.MethodDelete {
		queryFields = "domain"
	}
	q, ierr := publicQuery(r, queryFields)
	if ierr != nil {
		publicError(w, r, ierr)
		return
	}
	var in *publicInput
	if r.Method == http.MethodDelete {
		// DELETE has no representation. Reject a body instead of silently ignoring it.
		r.Body = http.MaxBytesReader(w, r.Body, 1)
		body, err := io.ReadAll(r.Body)
		if err != nil || len(body) != 0 {
			publicError(w, r, badInput("invalid_parameter", "DELETE does not accept a body"))
			return
		}
		in = &publicInput{Domain: q.Get("domain")}
	} else {
		allowed := "domain title expire_at tag_ids"
		if r.Method == http.MethodPost {
			allowed += " custom_slug"
		}
		if kind == store.KindURL {
			allowed += " target_url"
		} else {
			allowed += " content text_type"
		}
		in, ierr = readPublicInput(w, r, allowed)
		if ierr != nil {
			publicError(w, r, ierr)
			return
		}
	}
	var l *store.Link
	var err error
	if r.Method != http.MethodPost {
		l, err = s.publicResource(r, in.Domain, r.PathValue("slug"), kind)
		if s.publicFailure(w, r, err) {
			return
		}
	}
	if r.Method == http.MethodDelete {
		if !s.publicFailure(w, r, s.purgeResource(r, l)) {
			w.WriteHeader(http.StatusNoContent)
		}
		return
	}
	p, ierr := s.publicLinkInput(in)
	if ierr != nil {
		publicError(w, r, ierr)
		return
	}
	if r.Method == http.MethodPost {
		if kind == store.KindURL {
			l, _, err = s.createURL(r, p)
		} else {
			l, err = s.createTextResource(r, p)
		}
	} else {
		if p.Title == nil && p.URL == nil && p.Text == nil && p.Format == nil && !p.ExpiresAt.Set && !p.Tags.Set {
			publicError(w, r, badInput("invalid_parameter", "provide a field to update"))
			return
		}
		p.expectedSlug = &l.Slug
		l, err = s.updateResource(r, l.ID, p)
	}
	if !s.publicFailure(w, r, err) {
		status := http.StatusOK
		if r.Method == http.MethodPost {
			status = http.StatusCreated
			w.Header().Set("Location", s.baseURL(r)+shortPath(l))
		}
		writeJSON(w, status, map[string]any{"data": map[string]string{"slug": l.Slug, "short_url": s.baseURL(r) + shortPath(l)}})
	}
}

func (s *Server) purgeResource(r *http.Request, expected *store.Link) error {
	key, err := s.store.PurgeLink(r.Context(), expected)
	if err == nil {
		s.cache.Invalidate(links.Key(key))
	}
	return err
}

func publicQuery(r *http.Request, allowed string) (url.Values, *inputError) {
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

func (s *Server) publicDomains(w http.ResponseWriter, r *http.Request) {
	if _, err := publicQuery(r, ""); err != nil {
		publicError(w, r, err)
		return
	}
	domain, err := s.publicDomain("")
	if err != nil {
		publicError(w, r, err)
		return
	}
	publicOK(w, map[string]any{"domains": []string{domain}, "files_url": s.opt.FilesURL})
}

func (s *Server) publicTags(w http.ResponseWriter, r *http.Request) {
	if _, err := publicQuery(r, ""); err != nil {
		publicError(w, r, err)
		return
	}
	c, err := s.store.Tags(r.Context())
	if s.publicFailure(w, r, err) {
		return
	}
	tags := make([]map[string]any, len(c.Items))
	for i, tag := range c.Items {
		tags[i] = map[string]any{"id": tag.ID, "name": tag.Name}
	}
	publicOK(w, map[string]any{"tags": tags})
}

func (s *Server) publicVisitStat(w http.ResponseWriter, r *http.Request) {
	q, ierr := publicQuery(r, "domain period")
	if ierr != nil {
		publicError(w, r, ierr)
		return
	}
	l, err := s.publicResource(r, q.Get("domain"), r.PathValue("slug"), store.KindURL)
	if s.publicFailure(w, r, err) {
		return
	}
	period := q.Get("period")
	if period != "" && period != "all" && period != "day" && period != "month" {
		publicError(w, r, badInput("invalid_parameter", "period must be day, month or all"))
		return
	}
	var count int64
	if period == "" || period == "all" {
		count = s.clicks.Total(l.ID, l.Clicks)
	} else {
		if s.publicFailure(w, r, s.clicks.Flush(r.Context())) {
			return
		}
		now := time.Now().In(s.clicks.Location())
		from, today := s.clicks.Day(now), s.clicks.Day(now)
		if period == "month" {
			from -= int32(now.Day() - 1)
		}
		counts, err := s.store.Series(r.Context(), l.ID, from, today)
		if s.publicFailure(w, r, err) {
			return
		}
		for _, n := range counts {
			count += n
		}
	}
	publicOK(w, map[string]int64{"visit_count": count})
}

var publicUploadFields = map[string]bool{"domain": true, "custom_slug": true}

func (s *Server) publicFileInput(fields map[string]string) (*linkInput, *inputError) {
	in := &publicInput{Domain: fields["domain"]}
	if slug, ok := fields["custom_slug"]; ok {
		in.CustomSlug = &slug
	}
	return s.publicLinkInput(in)
}

func (s *Server) publicFileDTO(r *http.Request, l *store.Link) map[string]any {
	c := l.Content
	return map[string]any{"created_at": l.CreatedAt / 1000, "key": c.DeleteKey,
		"file_id": l.ID, "slug": l.Slug, "filename": c.Name, "size": c.Size, "sha256": hex.EncodeToString(c.SHA256),
		"page": s.baseURL(r) + shortPath(l), "url": s.rawURL(l), "mime_type": c.Type}
}

func (s *Server) publicUpload(w http.ResponseWriter, r *http.Request) {
	if _, err := publicQuery(r, ""); err != nil {
		publicError(w, r, err)
		return
	}
	if _, err := s.publicDomain(""); err != nil {
		publicError(w, r, err)
		return
	}
	l, err := s.uploadFile(w, r, true)
	if !s.publicFailure(w, r, err) {
		w.Header().Set("Location", s.baseURL(r)+shortPath(l))
		writeJSON(w, http.StatusCreated, map[string]any{"data": s.publicFileDTO(r, l)})
	}
}

func (s *Server) publicFiles(w http.ResponseWriter, r *http.Request) {
	q, ierr := publicQuery(r, "page")
	if ierr != nil {
		publicError(w, r, ierr)
		return
	}
	if _, err := s.publicDomain(""); err != nil {
		publicError(w, r, err)
		return
	}
	page := 1
	if q.Has("page") {
		n, err := strconv.Atoi(q.Get("page"))
		if err != nil || n < 1 || n > 1_000_000 {
			publicError(w, r, badInput("invalid_parameter", "page must be between 1 and 1000000"))
			return
		}
		page = n
	}
	rows, err := s.store.FileHistory(r.Context(), page)
	if s.publicFailure(w, r, err) {
		return
	}
	out := make([]map[string]any, len(rows))
	for i, l := range rows {
		out[i] = s.publicFileDTO(r, l)
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": out, "page": page, "page_size": 30})
}

func (s *Server) publicDeleteFile(w http.ResponseWriter, r *http.Request) {
	if _, err := publicQuery(r, ""); err != nil {
		publicError(w, r, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1)
	if body, err := io.ReadAll(r.Body); err != nil || len(body) != 0 {
		publicError(w, r, badInput("invalid_parameter", "DELETE does not accept a body"))
		return
	}
	l, err := s.store.FileByDeleteKey(r.Context(), r.PathValue("key"))
	if s.publicFailure(w, r, err) || s.publicFailure(w, r, s.purgeResource(r, l)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
