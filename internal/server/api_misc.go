package server

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/DejavuMoe/sani/internal/auth"
	"github.com/DejavuMoe/sani/internal/links"
	"github.com/DejavuMoe/sani/internal/store"
)

func (s *Server) getConfig(w http.ResponseWriter, r *http.Request) {
	var files *string
	if s.opt.FilesURL != "" {
		files = &s.opt.FilesURL
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"filesUrl":        files,
		"maxFileSize":     s.opt.MaxFileBytes,
		"maxTextSize":     links.MaxTextBytes,
		"version":         s.opt.Version,
		"baseUrl":         s.baseURL(r),
		"baseUrlSource":   s.baseSource(),
		"requestOrigin":   s.requestOrigin(r),
		"slugLength":      s.opt.SlugLength,
		"fetchMeta":       s.opt.FetchMeta,
		"forwardQuery":    s.opt.ForwardQuery,
		"passwordFromEnv": s.opt.PasswordFromEnv,
		"timezone":        s.clicks.Location().String(),
	})
}

// normalizeOrigin accepts "https://s.example.com" (optionally with a trailing
// slash) and rejects anything with a path, query or fragment.
func normalizeOrigin(raw string) (string, bool) {
	raw = strings.TrimSuffix(strings.TrimSpace(raw), "/")
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" ||
		u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return "", false
	}
	return strings.ToLower(u.Scheme) + "://" + strings.ToLower(u.Host), true
}

func hostname(origin string) string {
	u, err := url.Parse(origin)
	if err != nil {
		return ""
	}
	return u.Hostname()
}

func (s *Server) patchConfig(w http.ResponseWriter, r *http.Request) {
	var in struct {
		BaseURL nullable[string] `json:"baseUrl"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.BaseURL.Set {
		if s.opt.BaseURL != "" {
			writeError(w, http.StatusConflict, "base_url_env", "the base URL is fixed by SANI_BASE_URL")
			return
		}
		value := ""
		if !in.BaseURL.Null && strings.TrimSpace(in.BaseURL.Value) != "" {
			v, ok := normalizeOrigin(in.BaseURL.Value)
			if !ok || (s.filesHost != "" && hostname(v) == hostname(s.opt.FilesURL)) {
				writeError(w, http.StatusBadRequest, "base_url_invalid", "use an origin such as https://s.example.com")
				return
			}
			value = v
		}
		var err error
		if value == "" {
			err = s.store.DeleteSetting(r.Context(), store.SettingBaseURL)
		} else {
			err = s.store.SetSetting(r.Context(), store.SettingBaseURL, value)
		}
		if err != nil {
			s.internalError(w, r, err)
			return
		}
		s.storedBase.Store(&value)
	}
	s.getConfig(w, r)
}

type tokenDTO struct {
	ID        int64      `json:"id"`
	Name      string     `json:"name"`
	Hint      string     `json:"hint"`
	CreatedAt time.Time  `json:"createdAt"`
	UsedAt    *time.Time `json:"usedAt"`
	Token     string     `json:"token,omitempty"`
}

func toTokenDTO(t *store.Token) tokenDTO {
	return tokenDTO{ID: t.ID, Name: t.Name, Hint: t.Hint, CreatedAt: time.UnixMilli(t.CreatedAt).UTC(), UsedAt: msTime(t.UsedAt)}
}

func (s *Server) listTokens(w http.ResponseWriter, r *http.Request) {
	ts, err := s.store.Tokens(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	out := make([]tokenDTO, len(ts))
	for i, t := range ts {
		out[i] = toTokenDTO(t)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

func (s *Server) createToken(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	name := strings.Join(strings.Fields(in.Name), " ")
	if name == "" || utf8.RuneCountInString(name) > 60 {
		writeError(w, http.StatusBadRequest, "name_invalid", "give the token a name of up to 60 characters")
		return
	}
	secret, hash := auth.NewSecret(tokenPrefix)
	t, err := s.store.CreateToken(r.Context(), name, hash, secret[:len(tokenPrefix)+4], time.Now().UnixMilli())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	d := toTokenDTO(t)
	d.Token = secret
	writeJSON(w, http.StatusCreated, d)
}

func (s *Server) deleteToken(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "no such token")
		return
	}
	if err := s.store.DeleteToken(r.Context(), id); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "no such token")
		return
	} else if err != nil {
		s.internalError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) favicon(w http.ResponseWriter, r *http.Request) {
	// Links report hosts without "www.", while icons are stored per exact host.
	host := strings.ToLower(r.PathValue("host"))
	f, err := s.store.Favicon(r.Context(), host)
	if errors.Is(err, store.ErrNotFound) && !strings.HasPrefix(host, "www.") {
		f, err = s.store.Favicon(r.Context(), "www."+host)
	}
	if errors.Is(err, store.ErrNotFound) || (err == nil && f.Type == "") {
		w.Header().Set("Cache-Control", "private, max-age=600")
		http.NotFound(w, r)
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	h := w.Header()
	h.Set("Content-Type", f.Type)
	h.Set("Cache-Control", "private, max-age=604800")
	h.Set("X-Content-Type-Options", "nosniff")
	// Icons are third-party bytes; an SVG opened directly must stay inert.
	h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	http.ServeContent(w, r, "", time.UnixMilli(f.FetchedAt), bytes.NewReader(f.Data))
}

// exportLink is the portable form of a link, shared by export and import.
type exportLink struct {
	Tags      []exportTag `json:"tags,omitempty"`
	Slug      string      `json:"slug"`
	URL       string      `json:"url"`
	Title     string      `json:"title,omitempty"`
	Redirect  int         `json:"redirect,omitempty"`
	Enabled   *bool       `json:"enabled,omitempty"`
	ExpiresAt *time.Time  `json:"expiresAt,omitempty"`
	MaxClicks int64       `json:"maxClicks,omitempty"`
	Clicks    int64       `json:"clicks,omitempty"`
	CreatedAt *time.Time  `json:"createdAt,omitempty"`
}

type exportTag struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

func (s *Server) export(w http.ResponseWriter, r *http.Request) {
	if err := s.clicks.Flush(r.Context()); err != nil {
		s.log.Warn("flush clicks", "err", err)
	}
	all, err := s.store.AllLinks(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	stamp := time.Now().Format("20060102-150405")
	catalog, err := s.store.Tags(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	byID := make(map[int64]exportTag, len(catalog.Items))
	for _, tag := range catalog.Items {
		byID[tag.ID] = exportTag{Name: tag.Name, Color: tag.Color}
	}
	tagsOf := func(l *store.Link) []exportTag {
		tags := make([]exportTag, 0, len(l.Tags))
		for _, id := range l.Tags {
			tags = append(tags, byID[id])
		}
		return tags
	}
	if r.URL.Query().Get("format") == "csv" {
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="sani-links-`+stamp+`.csv"`)
		w.Header().Set("Cache-Control", "no-store")
		cw := csv.NewWriter(w)
		cw.Write([]string{"slug", "url", "title", "redirect", "enabled", "expires_at", "max_clicks", "clicks", "created_at", "tags"})
		for _, l := range all {
			exp := ""
			if l.ExpiresAt != 0 {
				exp = time.UnixMilli(l.ExpiresAt).UTC().Format(time.RFC3339)
			}
			max := ""
			if l.MaxClicks > 0 {
				max = strconv.FormatInt(l.MaxClicks, 10)
			}
			tags, _ := json.Marshal(tagsOf(l))
			cw.Write([]string{l.Slug, l.URL, l.Title, strconv.Itoa(l.Redirect), strconv.FormatBool(l.Enabled), exp, max,
				strconv.FormatInt(l.Clicks, 10), time.UnixMilli(l.CreatedAt).UTC().Format(time.RFC3339), string(tags)})
		}
		cw.Flush()
		return
	}
	out := make([]exportLink, len(all))
	for i, l := range all {
		enabled := l.Enabled
		out[i] = exportLink{Tags: tagsOf(l), Slug: l.Slug, URL: l.URL, Title: l.Title, Redirect: l.Redirect, Enabled: &enabled,
			ExpiresAt: msTime(l.ExpiresAt), MaxClicks: l.MaxClicks, Clicks: l.Clicks, CreatedAt: msTime(l.CreatedAt)}
	}
	w.Header().Set("Content-Disposition", `attachment; filename="sani-links-`+stamp+`.json"`)
	writeJSON(w, http.StatusOK, map[string]any{
		"app":        "sani",
		"version":    1,
		"exportedAt": time.Now().UTC(),
		"links":      out,
	})
}

type importProblem struct {
	Row    int    `json:"row,omitempty"` // 1-based; absent for slug conflicts
	Slug   string `json:"slug,omitempty"`
	Reason string `json:"reason"`
}

// importLinks accepts Sani's own export and the common shapes other
// shorteners produce: a JSON array (or {"links": [...]}) or a CSV file with a
// header row. Field names from Shlink, Sink, YOURLS and Kutt are recognized.
func (s *Server) importLinks(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 32<<20))
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "import files are limited to 32 MB")
		return
	}
	body = bytes.TrimPrefix(body, []byte("\xef\xbb\xbf"))
	var records []map[string]string
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) > 0 && (trimmed[0] == '[' || trimmed[0] == '{') {
		records, err = parseJSONRecords(trimmed)
	} else {
		records, err = parseCSVRecords(body)
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "import_unreadable", err.Error())
		return
	}
	if len(records) > 100000 {
		writeError(w, http.StatusBadRequest, "import_too_many", "import at most 100,000 links at a time")
		return
	}

	now := time.Now()
	var items []*store.Link
	problems := []importProblem{}
	for i, rec := range records {
		l, reason := s.recordToLink(r, rec, now)
		if reason != "" {
			problems = append(problems, importProblem{Row: i + 1, Slug: pick(rec, slugFields), Reason: reason})
			continue
		}
		items = append(items, l)
	}
	n := s.opt.SlugLength
	res, err := s.store.ImportLinks(r.Context(), items, func() string { return links.Generate(n + 1) })
	if tagError(w, err) {
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	for _, l := range res.Created {
		s.cache.Invalidate(links.Key(l.Slug))
	}
	for _, slug := range res.Conflicts {
		problems = append(problems, importProblem{Slug: slug, Reason: "slug_taken"})
	}
	s.log.Info("imported links", "created", len(res.Created), "skipped", len(problems))
	writeJSON(w, http.StatusOK, map[string]any{"created": len(res.Created), "skipped": problems})
}

var (
	slugFields    = []string{"slug", "shortcode", "short_code", "code", "keyword", "key", "alias", "address", "custom_slug", "customslug"}
	urlFields     = []string{"url", "longurl", "long_url", "target", "destination", "original_url", "originalurl", "link"}
	titleFields   = []string{"title", "name", "description"}
	createdFields = []string{"createdat", "created_at", "datecreated", "date_created", "timestamp", "created"}
	clicksFields  = []string{"clicks", "visits", "visitscount", "visits_count", "visit_count", "count"}
	expiresFields = []string{"expiresat", "expires_at", "validuntil", "valid_until", "expiration", "expires"}
	maxFields     = []string{"maxclicks", "max_clicks", "maxvisits", "max_visits"}
)

func pick(rec map[string]string, keys []string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(rec[k]); v != "" {
			return v
		}
	}
	return ""
}

// parseTime accepts RFC 3339, "2006-01-02 15:04:05" and unix seconds or
// milliseconds.
func parseTime(v string) (int64, bool) {
	if v == "" {
		return 0, false
	}
	if n, err := strconv.ParseInt(v, 10, 64); err == nil {
		if n > 1e11 {
			return n, true
		}
		return n * 1000, true
	}
	for _, layout := range []string{time.RFC3339Nano, time.DateTime, time.DateOnly} {
		if t, err := time.Parse(layout, v); err == nil {
			return t.UnixMilli(), true
		}
	}
	return 0, false
}

func (s *Server) recordToLink(r *http.Request, rec map[string]string, now time.Time) (*store.Link, string) {
	u, err := links.NormalizeURL(pick(rec, urlFields))
	if err != nil {
		return nil, linkErrors[err]
	}
	if s.pointsHere(r, u) {
		return nil, "url_self"
	}
	slug := strings.TrimPrefix(pick(rec, slugFields), "/")
	if slug != "" {
		if err := links.ValidateSlug(slug); err != nil {
			return nil, linkErrors[err]
		}
	}
	title := links.CleanTitle(pick(rec, titleFields))
	l := &store.Link{
		Slug:      slug,
		URL:       u,
		Host:      links.FetchHost(u),
		Title:     title,
		Meta:      store.MetaFailed,
		Redirect:  http.StatusFound,
		Enabled:   true,
		CreatedAt: now.UnixMilli(),
		UpdatedAt: now.UnixMilli(),
	}
	if title != "" {
		l.Meta = store.MetaManual
	}
	if ms, ok := parseTime(pick(rec, createdFields)); ok && ms > 0 && ms <= now.UnixMilli() {
		l.CreatedAt = ms
	}
	if ms, ok := parseTime(pick(rec, expiresFields)); ok && ms > 0 {
		l.ExpiresAt = ms
	}
	if v, err := strconv.ParseInt(pick(rec, clicksFields), 10, 64); err == nil && v > 0 {
		l.Clicks = v
	}
	if v, err := strconv.ParseInt(pick(rec, maxFields), 10, 64); err == nil && v > 0 {
		l.MaxClicks = v
	}
	if v, err := strconv.Atoi(rec["redirect"]); err == nil {
		switch v {
		case 301, 302, 307, 308:
			l.Redirect = v
		}
	}
	if v, err := strconv.ParseBool(rec["enabled"]); err == nil {
		l.Enabled = v
	}
	if raw := strings.TrimSpace(rec["tags"]); raw != "" {
		var tags []json.RawMessage
		if err := json.Unmarshal([]byte(raw), &tags); err != nil || len(tags) > store.MaxLinkTags {
			return nil, "tags_invalid"
		}
		seen := map[string]bool{}
		for _, rawTag := range tags {
			var tag exportTag
			if len(rawTag) > 0 && rawTag[0] == '"' {
				if err := json.Unmarshal(rawTag, &tag.Name); err != nil {
					return nil, "tags_invalid"
				}
			} else if err := json.Unmarshal(rawTag, &tag); err != nil {
				return nil, "tags_invalid"
			}
			name, color, err := store.NormalizeTag(tag.Name, tag.Color)
			if err != nil {
				return nil, "tags_invalid"
			}
			key := strings.ToLower(name)
			if seen[key] {
				continue
			}
			seen[key] = true
			l.ImportTags = append(l.ImportTags, store.Tag{Name: name, Color: color})
		}
	}
	return l, ""
}

func normalizeKey(k string) string {
	return strings.ToLower(strings.TrimSpace(strings.ReplaceAll(k, " ", "_")))
}

func parseJSONRecords(data []byte) ([]map[string]string, error) {
	var raw []map[string]any
	if data[0] == '{' {
		var wrapped map[string]json.RawMessage
		if err := json.Unmarshal(data, &wrapped); err != nil {
			return nil, errors.New("the file is not valid JSON")
		}
		found := false
		for _, key := range []string{"links", "shortUrls", "short_urls", "data", "items", "urls"} {
			if v, ok := wrapped[key]; ok {
				// Shlink nests the list: {"shortUrls": {"data": [...]}}.
				if len(v) > 0 && v[0] == '{' {
					var inner map[string]json.RawMessage
					if json.Unmarshal(v, &inner) == nil {
						if d, ok := inner["data"]; ok {
							v = d
						}
					}
				}
				if err := json.Unmarshal(v, &raw); err != nil {
					return nil, fmt.Errorf("%q is not a list of links", key)
				}
				found = true
				break
			}
		}
		if !found {
			return nil, errors.New(`expected a list of links, or an object with a "links" list`)
		}
	} else if err := json.Unmarshal(data, &raw); err != nil {
		return nil, errors.New("the file is not valid JSON")
	}
	out := make([]map[string]string, 0, len(raw))
	for _, obj := range raw {
		rec := map[string]string{}
		for k, v := range obj {
			if normalizeKey(k) == "tags" {
				if text, ok := v.(string); ok {
					rec["tags"] = text
				} else {
					b, _ := json.Marshal(v)
					rec["tags"] = string(b)
				}
				continue
			}
			switch x := v.(type) {
			case string:
				rec[normalizeKey(k)] = x
			case float64:
				rec[normalizeKey(k)] = strconv.FormatFloat(x, 'f', -1, 64)
			case bool:
				rec[normalizeKey(k)] = strconv.FormatBool(x)
			}
		}
		// Shlink nests counters and limits:
		// "visitsSummary": {"total": n}, "meta": {"validUntil": t, "maxVisits": n}.
		if m, ok := obj["visitsSummary"].(map[string]any); ok {
			if t, ok := m["total"].(float64); ok {
				rec["visits"] = strconv.FormatFloat(t, 'f', -1, 64)
			}
		}
		if m, ok := obj["meta"].(map[string]any); ok {
			if v, ok := m["validUntil"].(string); ok {
				rec["validuntil"] = v
			}
			if v, ok := m["maxVisits"].(float64); ok {
				rec["maxvisits"] = strconv.FormatFloat(v, 'f', -1, 64)
			}
		}
		out = append(out, rec)
	}
	return out, nil
}

func parseCSVRecords(data []byte) ([]map[string]string, error) {
	cr := csv.NewReader(bytes.NewReader(data))
	cr.FieldsPerRecord = -1
	cr.LazyQuotes = true
	rows, err := cr.ReadAll()
	if err != nil {
		return nil, errors.New("the file is not valid CSV")
	}
	if len(rows) < 1 {
		return nil, errors.New("the file is empty")
	}
	header := make([]string, len(rows[0]))
	hasURL := false
	for i, h := range rows[0] {
		header[i] = normalizeKey(h)
		for _, f := range urlFields {
			if header[i] == f {
				hasURL = true
			}
		}
	}
	if !hasURL {
		return nil, errors.New(`the CSV needs a header row with a "url" column`)
	}
	out := make([]map[string]string, 0, len(rows)-1)
	for _, row := range rows[1:] {
		rec := map[string]string{}
		for i, v := range row {
			if i < len(header) {
				rec[header[i]] = v
			}
		}
		out = append(out, rec)
	}
	return out, nil
}
