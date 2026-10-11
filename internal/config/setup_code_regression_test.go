package config

import (
	"os"
	"strings"
	"testing"
)

func TestRegressionBUG16SetupCodeMustRemainNonempty(t *testing.T) {
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if strings.HasPrefix(key, "SANI_") {
			t.Setenv(key, "")
		}
	}
	for _, code := range []string{"----", "- -", "-\t- \t-"} {
		t.Run(code, func(t *testing.T) {
			t.Setenv("SANI_SETUP_CODE", code)
			if _, err := Load(); err == nil || !strings.Contains(err.Error(), "SANI_SETUP_CODE") {
				t.Fatalf("BUG-16: separator-only code %q must be rejected with its setting name; got %v", code, err)
			}
		})
	}
	for _, code := range []string{"", " \t ", "AbCd-EfGh-1234", "alpha+beta123", "alpha&beta123", "alpha%2Bbeta123"} {
		t.Run("valid-"+code, func(t *testing.T) {
			t.Setenv("SANI_SETUP_CODE", code)
			cfg, err := Load()
			if err != nil {
				t.Fatal(err)
			}
			if cfg.SetupCode != strings.TrimSpace(code) {
				t.Fatalf("configured code changed: %q", cfg.SetupCode)
			}
		})
	}
}
