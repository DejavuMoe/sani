package config

import (
	"log/slog"
	"strings"
	"testing"
)

func TestDefaults(t *testing.T) {
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.Listen != ":8080" || c.DataDir != "data" || c.SlugLength != 5 || !c.FetchMeta || !c.ForwardQuery ||
		c.TrustProxy || c.CacheSize != 100_000 || c.LogLevel != slog.LevelInfo {
		t.Fatalf("defaults = %+v", c)
	}
}

func TestOverrides(t *testing.T) {
	t.Setenv("SANI_BASE_URL", "HTTPS://S.Example.com/")
	t.Setenv("SANI_TRUST_PROXY", "true")
	t.Setenv("SANI_SLUG_LENGTH", "7")
	t.Setenv("SANI_LOG_FORMAT", "json")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.BaseURL != "https://s.example.com" || !c.TrustProxy || c.SlugLength != 7 || !c.LogJSON {
		t.Fatalf("overrides = %+v", c)
	}
}

func TestInvalidValuesAreReportedTogether(t *testing.T) {
	t.Setenv("SANI_BASE_URL", "s.example.com/path")
	t.Setenv("SANI_SLUG_LENGTH", "99")
	t.Setenv("SANI_TRUST_PROXY", "maybe")
	t.Setenv("SANI_PASSWORD", "short")
	_, err := Load()
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, want := range []string{"SANI_BASE_URL", "SANI_SLUG_LENGTH", "SANI_TRUST_PROXY", "SANI_PASSWORD"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error does not mention %s:\n%v", want, err)
		}
	}
}
