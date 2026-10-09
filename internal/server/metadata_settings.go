package server

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/DejavuMoe/sani/internal/meta"
)

// Stored only in the restricted instance database, never returned as a DTO.
type metadataProxy struct {
	Scheme   string `json:"scheme"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Auth     bool   `json:"auth"`
	Username string `json:"username"`
	Password string `json:"password,omitempty"`
}

type metadataProxyInput struct {
	Scheme   string  `json:"scheme"`
	Host     string  `json:"host"`
	Port     int     `json:"port"`
	Auth     bool    `json:"auth"`
	Username string  `json:"username"`
	Password *string `json:"password"` // omitted: retain; empty: remove
}

func (p metadataProxy) valid() bool {
	if p.Scheme != "http" && p.Scheme != "https" && p.Scheme != "socks5" || p.Port < 1 || p.Port > 65535 || len(p.Host) == 0 || len(p.Host) > 253 {
		return false
	}
	if net.ParseIP(p.Host) == nil {
		for _, label := range strings.Split(p.Host, ".") {
			if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
				return false
			}
			for _, c := range label {
				if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-') {
					return false
				}
			}
		}
	}
	return !p.Auth || len(p.Username) > 0 && len(p.Username) <= 255 && len(p.Password) > 0 && len(p.Password) <= 255 && !strings.ContainsAny(p.Username, ":\r\n")
}

func (p metadataProxy) url() string {
	u := &url.URL{Scheme: p.Scheme, Host: net.JoinHostPort(p.Host, strconv.Itoa(p.Port))}
	if p.Auth {
		u.User = url.UserPassword(p.Username, p.Password)
	}
	return u.String()
}

func (p metadataProxy) dto() map[string]any {
	return map[string]any{"scheme": p.Scheme, "host": p.Host, "port": p.Port, "auth": p.Auth, "username": p.Username, "passwordSet": p.Auth && p.Password != ""}
}

func environmentMetadataProxy(raw string) *metadataProxy {
	u, err := url.Parse(raw)
	if err != nil || u == nil {
		return nil
	}
	port, _ := strconv.Atoi(u.Port())
	if port == 0 {
		port = map[string]int{"http": 80, "https": 443, "socks5": 1080}[u.Scheme]
	}
	p := &metadataProxy{Scheme: u.Scheme, Host: u.Hostname(), Port: port}
	if u.User != nil {
		p.Auth = true
		p.Username = u.User.Username()
		p.Password, _ = u.User.Password()
	}
	return p
}

func mergeMetadataProxy(in metadataProxyInput, old *metadataProxy) (*metadataProxy, *inputError) {
	p := &metadataProxy{Scheme: in.Scheme, Host: strings.TrimSpace(in.Host), Port: in.Port, Auth: in.Auth, Username: strings.TrimSpace(in.Username)}
	if !p.Auth {
		p.Username = ""
	} else if in.Password != nil {
		p.Password = *in.Password
	} else if old != nil && p.Scheme == old.Scheme && strings.EqualFold(p.Host, old.Host) && p.Port == old.Port && p.Username == old.Username {
		// Do not forward a saved secret to a different proxy or account.
		p.Password = old.Password
	} else {
		return nil, badInput("proxy_password_required", "re-enter the password for the changed proxy or account")
	}
	if !p.valid() {
		return nil, badInput("config_invalid", "invalid proxy configuration")
	}
	return p, nil
}

func (s *Server) testMetadataProxy(w http.ResponseWriter, r *http.Request) {
	var in struct {
		MetaProxy *metadataProxyInput `json:"metaProxy"`
	}
	if !decodeJSONMax(w, r, &in, 4096) {
		return
	}
	cfg := s.settings.Load()
	if cfg.sources["metaProxy"] == "env" || cfg.sources["metaMode"] == "env" {
		writeError(w, http.StatusConflict, "config_env", "this setting is fixed by an environment variable")
		return
	}
	if in.MetaProxy == nil {
		writeError(w, http.StatusBadRequest, "config_invalid", "a proxy configuration is required")
		return
	}
	p, inputErr := mergeMetadataProxy(*in.MetaProxy, cfg.stored.MetaProxy)
	if inputErr != nil {
		writeError(w, inputErr.status, inputErr.code, inputErr.msg)
		return
	}
	// One global test at a time, at most one start per five seconds. No map
	// keyed by client input, and no slow network operation under settingsMu.
	s.metaTestMu.Lock()
	now := time.Now()
	if s.metaTesting || now.Before(s.metaTestNext) {
		s.metaTestMu.Unlock()
		w.Header().Set("Retry-After", "5")
		writeError(w, http.StatusTooManyRequests, "rate_limited", "wait before testing again")
		return
	}
	s.metaTesting, s.metaTestNext = true, now.Add(5*time.Second)
	s.metaTestMu.Unlock()
	defer func() { s.metaTestMu.Lock(); s.metaTesting = false; s.metaTestMu.Unlock() }()
	f, err := meta.NewProxy(p.url())
	if err != nil {
		writeError(w, http.StatusBadRequest, "config_invalid", "invalid proxy configuration")
		return
	}
	defer f.CloseIdleConnections()
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	stop := context.AfterFunc(s.ctx, cancel)
	defer stop()
	defer cancel()
	page, err := f.Page(ctx, "https://example.com", "")
	if err != nil || page.Title == "" {
		if errors.Is(err, context.Canceled) && r.Context().Err() != nil {
			return
		}
		// Transport errors can contain proxy credentials; never log or return them.
		writeError(w, http.StatusBadGateway, "proxy_test_failed", "could not fetch the test page through the proxy")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
