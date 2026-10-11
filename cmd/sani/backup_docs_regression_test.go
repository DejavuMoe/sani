package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestRegressionBUG02DocumentedBackupDereferencesStateRoot(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("the systemd backup command requires Linux cp; run through the Linux runner")
	}
	for _, language := range []string{"", "en"} {
		t.Run("docs/"+language, func(t *testing.T) {
			doc, err := os.ReadFile(filepath.Join("..", "..", "docs", language, "guide", "operations.md"))
			if err != nil {
				t.Fatal(err)
			}
			var command string
			for _, line := range strings.Split(string(doc), "\n") {
				line = strings.TrimSpace(line)
				if strings.HasPrefix(line, "sudo cp ") && strings.Contains(line, "/var/lib/sani") {
					if command != "" {
						t.Fatal("ambiguous systemd copy command")
					}
					command = strings.TrimPrefix(line, "sudo ")
				}
			}
			if command == "" {
				t.Fatal("systemd full-backup copy command not found")
			}
			for _, linked := range []bool{false, true} {
				name := "directory"
				if linked {
					name = "symlink"
				}
				t.Run(name, func(t *testing.T) {
					root := t.TempDir()
					private := filepath.Join(root, "private", "sani")
					if err := os.MkdirAll(filepath.Join(private, "files"), 0700); err != nil {
						t.Fatal(err)
					}
					contents := map[string]string{"sani.db": "dummy database", "sani.db-wal": "dummy WAL", "sani.db-shm": "dummy SHM", "files/marker": "shared file bytes"}
					for name, body := range contents {
						if err := os.WriteFile(filepath.Join(private, name), []byte(body), 0600); err != nil {
							t.Fatal(err)
						}
					}
					source := private
					if linked {
						source = filepath.Join(root, "sani")
						if err := os.Symlink(private, source); err != nil {
							t.Fatal(err)
						}
					}
					backup := filepath.Join(root, "backup")
					ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
					defer cancel()
					// Keep the documented flags and argument shape; replace only the
					// privileged source path and supply a fresh scratch destination.
					cmd := exec.CommandContext(ctx, "bash", "-eu", "-c", strings.ReplaceAll(command, "/var/lib/sani", `"$source"`))
					cmd.Env = append(os.Environ(), "source="+source, "backup="+backup)
					if out, err := cmd.CombinedOutput(); err != nil {
						t.Fatalf("documented copy failed: %v\n%s", err, out)
					}
					info, err := os.Lstat(backup)
					if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
						t.Fatalf("BUG-02: backup must be an independent real directory: %v, %v", info, err)
					}
					if err := os.RemoveAll(private); err != nil {
						t.Fatal(err)
					}
					for name, want := range contents {
						got, err := os.ReadFile(filepath.Join(backup, name))
						if err != nil || string(got) != want {
							t.Errorf("backup lost %s after source removal: %q, %v", name, got, err)
						}
					}
				})
			}
		})
	}
}
