package store

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestDatabasePathsPreserveLiteralNames(t *testing.T) {
	ctx := context.Background()
	fixture := func(base string) []byte {
		t.Helper()
		path := filepath.Join(t.TempDir(), "fixture.db")
		s, err := Open(ctx, path)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.SetSetting(ctx, SettingBaseURL, base); err != nil {
			t.Fatal(err)
		}
		if err := s.Close(); err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	literal, neighbor := fixture("https://literal.example"), fixture("https://neighbor.example")
	cases := []struct{ name, neighbor string }{
		{"with space", ""},
		{"with%20space", "with space/sani.db"},
		{"with#hash", "with"},
		{"with%25percent", "with%percent/sani.db"},
		{"資料%20庫", "資料 庫/sani.db"},
	}
	if runtime.GOOS != "windows" {
		cases = append(cases, struct{ name, neighbor string }{"with?query", ""})
	}
	operations := map[string]func(string) (string, error){
		"open": func(path string) (string, error) {
			s, err := Open(ctx, path)
			if err != nil {
				return "", err
			}
			defer s.Close()
			value, err := s.Setting(ctx, SettingBaseURL)
			if err != nil {
				return "", err
			}
			return value, s.SetSetting(ctx, SettingBaseURL, "https://updated.example")
		},
		"backup": func(path string) (string, error) {
			dst := filepath.Join(filepath.Dir(path), "backup%20#copy.db")
			if err := Backup(ctx, path, dst); err != nil {
				return "", err
			}
			report, err := Preflight(ctx, dst, "")
			if err != nil {
				return "", err
			}
			return report.BaseURL, nil
		},
		"preflight": func(path string) (string, error) {
			report, err := Preflight(ctx, path, "")
			if err != nil {
				return "", err
			}
			return report.BaseURL, nil
		},
	}
	for _, tc := range cases {
		for _, mode := range []string{"absolute", "relative"} {
			for name, operation := range operations {
				t.Run(tc.name+"/"+mode+"/"+name, func(t *testing.T) {
					root := t.TempDir()
					write := func(path string, data []byte) {
						t.Helper()
						if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
							t.Fatal(err)
						}
						if err := os.WriteFile(path, data, 0600); err != nil {
							t.Fatal(err)
						}
					}
					path := filepath.Join(root, tc.name, "sani.db")
					// Seed literal files without passing their names through the opener under test.
					write(path, literal)
					other := filepath.Join(root, filepath.FromSlash(tc.neighbor))
					if tc.neighbor != "" {
						write(other, neighbor)
					}
					if mode == "relative" {
						t.Chdir(root)
						path = filepath.Join(tc.name, "sani.db")
					}
					if value, err := operation(path); err != nil || value != "https://literal.example" {
						t.Errorf("%s read %q, want the literal database: %v", name, value, err)
					}
					if tc.neighbor != "" {
						got, err := os.ReadFile(other)
						if err != nil || !bytes.Equal(got, neighbor) {
							t.Errorf("neighbor database changed: %v", err)
						}
					}
				})
			}
		}
	}
}
