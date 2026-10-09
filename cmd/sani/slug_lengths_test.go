package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/DejavuMoe/sani/internal/config"
	"github.com/DejavuMoe/sani/internal/store"
)

func TestOpenStoreInitializesOnlyNewDatabases(t *testing.T) {
	for _, state := range []string{"absent", "empty", "legacy", "legacy-settings", "initialized"} {
		t.Run(state, func(t *testing.T) {
			ctx := context.Background()
			cfg := &config.Config{DataDir: t.TempDir()}
			path := filepath.Join(cfg.DataDir, "sani.db")
			want := `{"version":1}`
			switch state {
			case "empty":
				if err := os.WriteFile(path, nil, 0600); err != nil {
					t.Fatal(err)
				}
			case "legacy", "legacy-settings", "initialized":
				want = ""
				if state == "legacy-settings" {
					want = `{"slugLength":24,"excludeConfusable":false}`
				} else if state == "initialized" {
					want = `{"version":1,"textSlugLength":3,"fileSlugLength":32}`
				}
				st, err := store.Open(ctx, path)
				if err != nil {
					t.Fatal(err)
				}
				if want != "" {
					if err := st.SetSetting(ctx, store.SettingCreation, want); err != nil {
						t.Fatal(err)
					}
				}
				if err := st.Close(); err != nil {
					t.Fatal(err)
				}
			}
			for range 2 {
				st, err := openStore(ctx, cfg)
				if err != nil {
					t.Fatal(err)
				}
				got, readErr := st.Setting(ctx, store.SettingCreation)
				closeErr := st.Close()
				if got != want || (want == "" && !errors.Is(readErr, store.ErrNotFound)) || (want != "" && readErr != nil) || closeErr != nil {
					t.Fatalf("creation settings = %q, want %q: %v %v", got, want, readErr, closeErr)
				}
			}
		})
	}
}

func TestServeSlugLengthStartup(t *testing.T) {
	if os.Getenv("SANI_TEST_SLUG_HELPER") == "1" {
		if err := serve(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	for _, state := range []string{"fresh", "passwd-first", "legacy-passwd", "legacy-env", "legacy-share-env"} {
		t.Run(state, func(t *testing.T) {
			dir := t.TempDir()
			legacy := strings.HasPrefix(state, "legacy")
			if legacy {
				st, err := store.Open(context.Background(), filepath.Join(dir, "sani.db"))
				if err != nil {
					t.Fatal(err)
				}
				if state == "legacy-passwd" {
					if err := st.SetSetting(context.Background(), store.SettingCreation, `{"slugLength":24}`); err != nil {
						t.Fatal(err)
					}
				}
				if err := st.Close(); err != nil {
					t.Fatal(err)
				}
			}
			if state == "passwd-first" || state == "legacy-passwd" {
				t.Setenv("SANI_DATA_DIR", dir)
				t.Setenv("SANI_PASSWORD", "")
				t.Setenv("SANI_SLUG_LENGTH", "32")
				path := filepath.Join(t.TempDir(), "password.txt")
				if err := os.WriteFile(path, []byte("correct horse\n"), 0600); err != nil {
					t.Fatal(err)
				}
				input, err := os.Open(path)
				if err != nil {
					t.Fatal(err)
				}
				stdin := os.Stdin
				os.Stdin = input
				err = passwd()
				os.Stdin = stdin
				input.Close()
				if err != nil {
					t.Fatal(err)
				}
			}
			for boot := range 2 {
				extra := []string{}
				urlLength, textLength, fileLength := 5, 10, 10
				shareSource := "default"
				if legacy {
					textLength, fileLength, shareSource = 24, 24, "settings"
				}
				if boot == 0 {
					urlLength = 32
					if legacy {
						urlLength = 24
					}
					extra = append(extra, fmt.Sprintf("SANI_SLUG_LENGTH=%d", urlLength))
					if state == "legacy-share-env" {
						extra = append(extra, "SANI_TEXT_SLUG_LENGTH=3", "SANI_FILE_SLUG_LENGTH=32")
						textLength, fileLength, shareSource = 3, 32, "env"
					}
				} else if state == "legacy-passwd" {
					urlLength = 24 // The stored URL setting also survives passwd.
				}
				base, stop := startSlugTestServer(t, dir, extra)
				jar, err := cookiejar.New(nil)
				if err != nil {
					t.Fatal(err)
				}
				client := &http.Client{Jar: jar, Timeout: 5 * time.Second}
				resp, err := client.Post(base+"/api/session", "application/json", strings.NewReader(`{"password":"correct horse"}`))
				if err != nil {
					t.Fatal(err)
				}
				resp.Body.Close()
				if resp.StatusCode != http.StatusOK {
					t.Fatalf("login: %d", resp.StatusCode)
				}
				resp, err = client.Get(base + "/api/config")
				if err != nil {
					t.Fatal(err)
				}
				var got struct {
					SlugLength     int               `json:"slugLength"`
					TextSlugLength int               `json:"textSlugLength"`
					FileSlugLength int               `json:"fileSlugLength"`
					Sources        map[string]string `json:"configSources"`
				}
				err = json.NewDecoder(resp.Body).Decode(&got)
				resp.Body.Close()
				client.CloseIdleConnections()
				if err != nil || resp.StatusCode != http.StatusOK || got.SlugLength != urlLength || got.TextSlugLength != textLength || got.FileSlugLength != fileLength || got.Sources["textSlugLength"] != shareSource || got.Sources["fileSlugLength"] != shareSource {
					t.Fatalf("boot %d: config %+v, expected lengths %d/%d/%d source %q: %v", boot, got, urlLength, textLength, fileLength, shareSource, err)
				}
				stop()
			}
		})
	}
}

func startSlugTestServer(t *testing.T, dir string, extra []string) (string, func()) {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	cmd := exec.CommandContext(ctx, exe, "-test.run=^TestServeSlugLengthStartup$")
	for _, entry := range os.Environ() {
		if !strings.HasPrefix(strings.ToUpper(entry), "SANI_") {
			cmd.Env = append(cmd.Env, entry)
		}
	}
	cmd.Env = append(cmd.Env, "SANI_TEST_SLUG_HELPER=1", "SANI_DATA_DIR="+dir, "SANI_LISTEN=127.0.0.1:0", "SANI_PASSWORD=correct horse", "SANI_LOG_FORMAT=json", "SANI_FETCH_META=false")
	cmd.Env = append(cmd.Env, extra...)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	cmd.Stdout = io.Discard
	if err := cmd.Start(); err != nil {
		cancel()
		t.Fatal(err)
	}
	stop := sync.OnceFunc(func() {
		// Exercise reopening a real process's database, including WAL recovery.
		cmd.Process.Kill()
		cmd.Wait()
		cancel()
	})
	t.Cleanup(stop)
	type ready struct{ addr, output string }
	started := make(chan ready, 1)
	go func() {
		scanner := bufio.NewScanner(stderr)
		var output strings.Builder
		for scanner.Scan() {
			line := scanner.Text()
			output.WriteString(line + "\n")
			var event struct{ Msg, Addr string }
			if json.Unmarshal([]byte(line), &event) == nil && event.Msg == "sani is ready" {
				started <- ready{addr: event.Addr}
				io.Copy(io.Discard, stderr)
				return
			}
		}
		started <- ready{output: output.String()}
	}()
	select {
	case result := <-started:
		if result.addr == "" {
			t.Fatalf("server failed to start: %s", result.output)
		}
		return "http://" + result.addr, stop
	case <-ctx.Done():
		t.Fatal("server startup timed out")
		return "", stop
	}
}
