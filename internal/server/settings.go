package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/DejavuMoe/sani/internal/meta"
	"github.com/DejavuMoe/sani/internal/store"
)

type creationSettings struct {
	SlugLength        *int    `json:"slugLength,omitempty"`
	ExcludeConfusable *bool   `json:"excludeConfusable,omitempty"`
	MaxFileSize       *int64  `json:"maxFileSize,omitempty"`
	MetaMode          *string `json:"metaMode,omitempty"`
}

type runtimeSettings struct {
	stored            creationSettings
	slugLength        int
	excludeConfusable bool
	maxFileSize       int64
	metaMode          string
	sources           map[string]string
}

func (s *Server) settingsFor(v creationSettings) *runtimeSettings {
	c := &runtimeSettings{stored: v, slugLength: s.opt.SlugLength, excludeConfusable: !s.opt.IncludeConfusable, maxFileSize: s.opt.MaxFileBytes, metaMode: "off", sources: map[string]string{}}
	if s.opt.FetchMeta {
		c.metaMode = "direct"
		if s.fetcher.EnvironmentProxyConfigured() {
			c.metaMode = "environment"
		}
		if s.proxyFetcher != nil {
			c.metaMode = "proxy"
		}
	}
	for _, key := range []string{"slugLength", "excludeConfusable", "maxFileSize", "metaMode"} {
		c.sources[key] = "default"
	}
	if v.SlugLength != nil {
		c.slugLength = *v.SlugLength
		c.sources["slugLength"] = "settings"
	}
	if v.ExcludeConfusable != nil {
		c.excludeConfusable = *v.ExcludeConfusable
		c.sources["excludeConfusable"] = "settings"
	}
	if v.MaxFileSize != nil {
		c.maxFileSize = *v.MaxFileSize
		c.sources["maxFileSize"] = "settings"
	}
	if v.MetaMode != nil {
		c.metaMode = *v.MetaMode
		c.sources["metaMode"] = "settings"
	}
	if s.opt.SlugLengthFromEnv {
		c.slugLength = s.opt.SlugLength
		c.sources["slugLength"] = "env"
	}
	if s.opt.ExcludeConfusableFromEnv {
		c.excludeConfusable = !s.opt.IncludeConfusable
		c.sources["excludeConfusable"] = "env"
	}
	if s.opt.MaxFileFromEnv {
		c.maxFileSize = s.opt.MaxFileBytes
		c.sources["maxFileSize"] = "env"
	}
	if s.opt.FetchMetaFromEnv {
		c.metaMode = "off"
		if s.opt.FetchMeta {
			c.metaMode = "direct"
			if s.fetcher.EnvironmentProxyConfigured() {
				c.metaMode = "environment"
			}
			if s.proxyFetcher != nil {
				c.metaMode = "proxy"
			}
		}
		c.sources["metaMode"] = "env"
	}
	return c
}

func (s *Server) loadSettings() error {
	var v creationSettings
	raw, err := s.store.Setting(context.Background(), store.SettingCreation)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return err
	}
	if raw != "" {
		if err := json.Unmarshal([]byte(raw), &v); err != nil {
			return fmt.Errorf("read creation settings: %w", err)
		}
	}
	if !validCreation(v) {
		return errors.New("invalid stored creation settings")
	}
	s.settings.Store(s.settingsFor(v))
	return nil
}

func validCreation(v creationSettings) bool {
	return (v.SlugLength == nil || *v.SlugLength >= 3 && *v.SlugLength <= 32) &&
		(v.MaxFileSize == nil || *v.MaxFileSize >= 1_000_000 && *v.MaxFileSize <= 4_096_000_000 && *v.MaxFileSize%1_000_000 == 0) &&
		(v.MetaMode == nil || *v.MetaMode == "off" || *v.MetaMode == "direct" || *v.MetaMode == "proxy")
}

func (s *Server) metadataFetcher() *meta.Fetcher {
	cfg := s.settings.Load()
	switch cfg.metaMode {
	case "direct":
		if cfg.stored.MetaMode == nil {
			return s.fetcher
		}
		return s.directFetcher
	case "environment":
		return s.fetcher
	case "proxy":
		return s.proxyFetcher
	default:
		return nil
	}
}

func (s *Server) patchConfig(w http.ResponseWriter, r *http.Request) {
	var in struct {
		BaseURL nullable[string] `json:"baseUrl"`
		creationSettings
	}
	if !decodeJSONMax(w, r, &in, 4096) {
		return
	}
	s.settingsMu.Lock()
	defer s.settingsMu.Unlock()
	current := s.settings.Load()
	v := current.stored
	values := map[string]string{}
	base := ""
	if in.BaseURL.Set {
		if s.opt.BaseURL != "" {
			writeError(w, http.StatusConflict, "base_url_env", "the base URL is fixed by SANI_BASE_URL")
			return
		}
		if !in.BaseURL.Null && strings.TrimSpace(in.BaseURL.Value) != "" {
			var ok bool
			base, ok = normalizeOrigin(in.BaseURL.Value)
			if !ok || s.filesHost != "" && hostname(base) == hostname(s.opt.FilesURL) {
				writeError(w, http.StatusBadRequest, "base_url_invalid", "use an origin such as https://s.example.com")
				return
			}
		}
		values[store.SettingBaseURL] = base
	}
	for key, set := range map[string]bool{"slugLength": in.SlugLength != nil, "excludeConfusable": in.ExcludeConfusable != nil, "maxFileSize": in.MaxFileSize != nil, "metaMode": in.MetaMode != nil} {
		if set && current.sources[key] == "env" {
			writeError(w, http.StatusConflict, "config_env", "this setting is fixed by an environment variable")
			return
		}
	}
	if in.SlugLength != nil {
		v.SlugLength = in.SlugLength
	}
	if in.ExcludeConfusable != nil {
		v.ExcludeConfusable = in.ExcludeConfusable
	}
	if in.MaxFileSize != nil {
		v.MaxFileSize = in.MaxFileSize
	}
	if in.MetaMode != nil {
		v.MetaMode = in.MetaMode
	}
	if !validCreation(v) {
		writeError(w, http.StatusBadRequest, "config_invalid", "invalid creation settings")
		return
	}
	if in.MetaMode != nil && *in.MetaMode == "proxy" && s.proxyFetcher == nil {
		writeError(w, http.StatusConflict, "proxy_missing", "configure SANI_META_PROXY first")
		return
	}
	b, _ := json.Marshal(v)
	values[store.SettingCreation] = string(b)
	if err := s.store.SetSettings(r.Context(), values); err != nil {
		s.internalError(w, r, err)
		return
	}
	if in.BaseURL.Set {
		s.storedBase.Store(&base)
	}
	s.settings.Store(s.settingsFor(v))
	s.getConfig(w, r)
}
