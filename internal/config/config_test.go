package config

import (
	"log/slog"
	"strings"
	"testing"

	"github.com/DejavuMoe/sani/internal/auth"
)

func TestPasswordByteLimit(t *testing.T) {
	for _, password := range []string{strings.Repeat("x", auth.MaxPasswordBytes), strings.Repeat("界", 341) + "x"} {
		t.Setenv("SANI_PASSWORD", password)
		if _, err := Load(); err != nil {
			t.Fatalf("1024-byte password rejected: %v", err)
		}
	}
	for _, password := range []string{strings.Repeat("x", auth.MaxPasswordBytes+1), strings.Repeat("界", 342)} {
		t.Setenv("SANI_PASSWORD", password)
		if _, err := Load(); err == nil || !strings.Contains(err.Error(), "SANI_PASSWORD: use at most 1024 bytes") {
			t.Fatalf("oversized password accepted: %v", err)
		}
	}
}

func TestDefaults(t *testing.T) {
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.Listen != ":8080" || c.DataDir != "data" || c.SlugLength != 5 || c.TextSlugLength != 10 || c.FileSlugLength != 10 || !c.FetchMeta || !c.ForwardQuery ||
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

func TestFilesURL(t *testing.T) {
	t.Setenv("SANI_BASE_URL", "https://s.example.com")
	t.Setenv("SANI_FILES_URL", "https://F.example.com/")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.FilesURL != "https://f.example.com" || c.MaxFileBytes != 99_000_000 || !c.ExcludeConfusable {
		t.Fatalf("files = %q, %d MB", c.FilesURL, c.MaxFileMB)
	}

	// Another port of the same host shares its cookies.
	t.Setenv("SANI_FILES_URL", "https://s.example.com:8443")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "SANI_FILES_URL") {
		t.Fatalf("same host accepted: %v", err)
	}
	t.Setenv("SANI_FILES_URL", "https://f.example.com/raw")
	if _, err := Load(); err == nil {
		t.Fatal("a path was accepted")
	}
}

func TestInvalidValuesAreReportedTogether(t *testing.T) {
	t.Setenv("SANI_BASE_URL", "s.example.com/path")
	t.Setenv("SANI_SLUG_LENGTH", "99")
	t.Setenv("SANI_TEXT_SLUG_LENGTH", "2")
	t.Setenv("SANI_FILE_SLUG_LENGTH", "33")
	t.Setenv("SANI_TRUST_PROXY", "maybe")
	t.Setenv("SANI_PASSWORD", "short")
	_, err := Load()
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, want := range []string{"SANI_BASE_URL", "SANI_SLUG_LENGTH", "SANI_TEXT_SLUG_LENGTH", "SANI_FILE_SLUG_LENGTH", "SANI_TRUST_PROXY", "SANI_PASSWORD"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error does not mention %s:\n%v", want, err)
		}
	}
}

func TestExplicitFileLimitKeepsMiB(t *testing.T) {
	t.Setenv("SANI_MAX_FILE_MB", "99")
	c, err := Load()
	if err != nil || c.MaxFileBytes != 99<<20 || !c.MaxFileFromEnv {
		t.Fatalf("explicit MiB: %d, %v", c.MaxFileBytes, err)
	}
	t.Setenv("SANI_MAX_FILE_MB", "")
	c, err = Load()
	if err != nil || c.MaxFileBytes != 99_000_000 || c.MaxFileFromEnv {
		t.Fatalf("unset MB: %d, %v", c.MaxFileBytes, err)
	}
}
