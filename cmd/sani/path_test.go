package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DejavuMoe/sani/internal/auth"
	"github.com/DejavuMoe/sani/internal/store"
)

func TestCommandsKeepLiteralDatabasePaths(t *testing.T) {
	if os.Getenv("SANI_TEST_PATH_HELPER") == "1" {
		for i, arg := range os.Args {
			if arg == "--" {
				os.Args = append([]string{"sani"}, os.Args[i+1:]...)
				main()
				os.Exit(0)
			}
		}
		t.Fatal("missing helper command")
	}
	env := []string{}
	for _, entry := range os.Environ() {
		if !strings.HasPrefix(entry, "SANI_") {
			env = append(env, entry)
		}
	}
	run := func(t *testing.T, dir, input string, args ...string) []byte {
		t.Helper()
		ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], append([]string{"-test.run=^TestCommandsKeepLiteralDatabasePaths$", "--"}, args...)...)
		cmd.Env = append(append([]string{}, env...), "SANI_TEST_PATH_HELPER=1", "SANI_DATA_DIR="+dir)
		cmd.Stdin = strings.NewReader(input)
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		out, err := cmd.Output()
		if err != nil {
			t.Fatalf("%v: %v: %s", args, err, stderr.String())
		}
		return out
	}
	root := t.TempDir()
	for _, name := range []string{"with%20space", "with#hash", "資料%25庫"} {
		t.Run(name, func(t *testing.T) {
			dir := filepath.Join(root, name)
			const password = "literal-path-password"
			run(t, dir, password+"\n", "passwd")
			if _, err := os.Stat(filepath.Join(dir, "sani.db")); err != nil {
				t.Fatal("passwd did not create the literal database:", err)
			}
			var report store.PreflightReport
			if err := json.Unmarshal(run(t, dir, "", "preflight"), &report); err != nil || report.Schema != store.SchemaTarget() {
				t.Fatalf("preflight: %+v %v", report, err)
			}
			backupPath := filepath.Join(dir, "named%20#backup.db")
			run(t, dir, "", "backup", backupPath)
			stdoutPath := filepath.Join(dir, "stdout.db")
			if err := os.WriteFile(stdoutPath, run(t, dir, "", "backup", "-"), 0600); err != nil {
				t.Fatal(err)
			}
			for _, path := range []string{filepath.Join(dir, "sani.db"), backupPath, stdoutPath} {
				s, err := store.Open(t.Context(), path)
				if err != nil {
					t.Fatal(err)
				}
				hash, readErr := s.Setting(t.Context(), store.SettingPassword)
				closeErr := s.Close()
				if readErr != nil || closeErr != nil || !auth.VerifyPassword(password, hash) {
					t.Fatalf("wrong password restored from %s: %v %v", path, readErr, closeErr)
				}
			}
		})
	}
}
