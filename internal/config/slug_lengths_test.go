package config

import (
	"strconv"
	"strings"
	"testing"
)

func TestIndependentSlugLengthEnvironment(t *testing.T) {
	keys := []string{"SANI_SLUG_LENGTH", "SANI_TEXT_SLUG_LENGTH", "SANI_FILE_SLUG_LENGTH"}
	for i, key := range keys {
		t.Run(key, func(t *testing.T) {
			for _, key := range keys {
				t.Setenv(key, "")
			}
			for _, value := range []string{"", " \t ", "3", "5", "10", " 32 "} {
				t.Setenv(key, value)
				c, err := Load()
				if err != nil {
					t.Fatalf("%s=%q: %v", key, value, err)
				}
				want := [3]int{5, 10, 10}
				var locked [3]bool
				if strings.TrimSpace(value) != "" {
					want[i], _ = strconv.Atoi(strings.TrimSpace(value))
					locked[i] = true
				}
				if got := [3]int{c.SlugLength, c.TextSlugLength, c.FileSlugLength}; got != want {
					t.Fatalf("%s=%q: lengths %v, want %v", key, value, got, want)
				}
				if got := [3]bool{c.SlugLengthFromEnv, c.TextSlugLengthFromEnv, c.FileSlugLengthFromEnv}; got != locked {
					t.Fatalf("%s=%q: locks %v, want %v", key, value, got, locked)
				}
			}
			for _, value := range []string{"0", "-1", "2", "33", "3.5", "3e1", "true", "no", "99999999999999999999"} {
				t.Setenv(key, value)
				if _, err := Load(); err == nil || !strings.Contains(err.Error(), key) {
					t.Fatalf("%s=%q accepted or misreported: %v", key, value, err)
				}
			}
		})
	}
	t.Setenv(keys[0], "32")
	t.Setenv(keys[1], "3")
	t.Setenv(keys[2], "12")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.SlugLength != 32 || c.TextSlugLength != 3 || c.FileSlugLength != 12 || !c.SlugLengthFromEnv || !c.TextSlugLengthFromEnv || !c.FileSlugLengthFromEnv {
		t.Fatalf("combined overrides: %+v", c)
	}
}
