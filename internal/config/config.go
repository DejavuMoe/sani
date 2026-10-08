// Package config reads Sani's settings from SANI_* environment variables.
package config

import (
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/DejavuMoe/sani/internal/auth"
)

type Config struct {
	Listen       string
	DataDir      string
	BaseURL      string
	Password     string
	SetupCode    string
	RootRedirect string
	TrustProxy   bool
	SlugLength   int
	FetchMeta    bool
	ForwardQuery bool
	CacheSize    int
	FilesURL     string // origin that serves shared files and raw text; "" turns file sharing off
	MaxFileMB    int
	LogLevel     slog.Level
	LogJSON      bool
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return def
}

func envBool(key string, def bool) (bool, error) {
	v := env(key, "")
	if v == "" {
		return def, nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def, fmt.Errorf("%s: expected true or false, got %q", key, v)
	}
	return b, nil
}

func envInt(key string, def, lo, hi int) (int, error) {
	v := env(key, "")
	if v == "" {
		return def, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < lo || n > hi {
		return def, fmt.Errorf("%s: expected a number from %d to %d, got %q", key, lo, hi, v)
	}
	return n, nil
}

// origin accepts "https://s.example.com", optionally with a trailing slash,
// and returns it lowercased.
func origin(raw string) (string, bool) {
	raw = strings.TrimSuffix(raw, "/")
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" ||
		u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return "", false
	}
	return strings.ToLower(u.Scheme) + "://" + strings.ToLower(u.Host), true
}

// Hostname returns the host of an origin without its port.
func Hostname(origin string) string {
	u, err := url.Parse(origin)
	if err != nil {
		return ""
	}
	return u.Hostname()
}

// Load reads the configuration. Unset variables take documented defaults.
func Load() (*Config, error) {
	c := &Config{
		Listen:       env("SANI_LISTEN", ":8080"),
		DataDir:      env("SANI_DATA_DIR", "data"),
		Password:     os.Getenv("SANI_PASSWORD"),
		SetupCode:    env("SANI_SETUP_CODE", ""),
		RootRedirect: env("SANI_ROOT_REDIRECT", ""),
	}
	var err error
	var errs []string
	collect := func(e error) {
		if e != nil {
			errs = append(errs, e.Error())
		}
	}

	if b := env("SANI_BASE_URL", ""); b != "" {
		if o, ok := origin(b); ok {
			c.BaseURL = o
		} else {
			collect(fmt.Errorf("SANI_BASE_URL: expected an origin such as https://s.example.com, got %q", b))
		}
	}
	if f := env("SANI_FILES_URL", ""); f != "" {
		o, ok := origin(f)
		switch {
		case !ok:
			collect(fmt.Errorf("SANI_FILES_URL: expected an origin such as https://f.example.com, got %q", f))
		case Hostname(o) == Hostname(c.BaseURL):
			// Shared files need a host of their own: browsers share cookies
			// across the ports of one host.
			collect(fmt.Errorf("SANI_FILES_URL: use a different host from SANI_BASE_URL"))
		default:
			c.FilesURL = o
		}
	}
	c.MaxFileMB, err = envInt("SANI_MAX_FILE_MB", 64, 1, 4096)
	collect(err)
	if c.RootRedirect != "" {
		u, e := url.Parse(c.RootRedirect)
		if e != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			collect(fmt.Errorf("SANI_ROOT_REDIRECT: expected an absolute http(s) URL, got %q", c.RootRedirect))
		}
	}
	if c.Password != "" {
		if err := auth.ValidatePassword(c.Password); err != nil {
			collect(fmt.Errorf("SANI_PASSWORD: %w", err))
		}
	}
	c.TrustProxy, err = envBool("SANI_TRUST_PROXY", false)
	collect(err)
	c.FetchMeta, err = envBool("SANI_FETCH_META", true)
	collect(err)
	c.ForwardQuery, err = envBool("SANI_FORWARD_QUERY", true)
	collect(err)
	c.SlugLength, err = envInt("SANI_SLUG_LENGTH", 5, 3, 32)
	collect(err)
	c.CacheSize, err = envInt("SANI_CACHE_SIZE", 100_000, 64, 100_000_000)
	collect(err)

	switch strings.ToLower(env("SANI_LOG_LEVEL", "info")) {
	case "debug":
		c.LogLevel = slog.LevelDebug
	case "info":
		c.LogLevel = slog.LevelInfo
	case "warn", "warning":
		c.LogLevel = slog.LevelWarn
	case "error":
		c.LogLevel = slog.LevelError
	default:
		collect(fmt.Errorf("SANI_LOG_LEVEL: expected debug, info, warn or error"))
	}
	switch strings.ToLower(env("SANI_LOG_FORMAT", "text")) {
	case "text":
	case "json":
		c.LogJSON = true
	default:
		collect(fmt.Errorf("SANI_LOG_FORMAT: expected text or json"))
	}

	if len(errs) > 0 {
		return nil, fmt.Errorf("invalid configuration:\n  %s", strings.Join(errs, "\n  "))
	}
	return c, nil
}
