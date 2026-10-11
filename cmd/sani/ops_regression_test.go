package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// Use the real CLI dispatch and exit status without building another binary.
func TestOpsRegressionCLI(t *testing.T) {
	if command := os.Getenv("SANI_TEST_OPS_COMMAND"); command != "" {
		os.Args = []string{"sani", command}
		main()
		os.Exit(0)
	}
}

func opsRegressionCLI(t *testing.T, command string, extra ...string) ([]byte, error) {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, exe, "-test.run=^TestOpsRegressionCLI$")
	for _, entry := range os.Environ() {
		if !strings.HasPrefix(strings.ToUpper(entry), "SANI_") {
			cmd.Env = append(cmd.Env, entry)
		}
	}
	cmd.Env = append(cmd.Env, "SANI_TEST_OPS_COMMAND="+command)
	cmd.Env = append(cmd.Env, extra...)
	out, err := cmd.CombinedOutput()
	if ctx.Err() != nil {
		t.Fatalf("CLI timed out: %s", out)
	}
	return out, err
}

func TestRegressionBUG05SetupURLRoundTrip(t *testing.T) {
	root := t.TempDir()
	for _, code := range []string{"AbCd-EfGh-1234", "alpha+beta123", "alpha&beta123", "alpha%2Bbeta123"} {
		t.Run(code, func(t *testing.T) {
			dir, err := os.MkdirTemp(root, "case-")
			if err != nil {
				t.Fatal(err)
			}
			// Startup prints the setup URL before binding; an invalid address
			// terminates this fixture without starting a listener or background jobs.
			out, err := opsRegressionCLI(t, "serve", "SANI_DATA_DIR="+dir,
				"SANI_LISTEN=invalid-listener", "SANI_SETUP_CODE="+code,
				"SANI_BASE_URL=http://127.0.0.1:18765", "SANI_LOG_FORMAT=json", "SANI_FETCH_META=false")
			var exit *exec.ExitError
			if !errors.As(err, &exit) || exit.ExitCode() != 1 || !strings.Contains(string(out), "missing port in address") {
				t.Fatalf("expected bounded startup to stop at invalid listener: %v\n%s", err, out)
			}
			for _, line := range strings.Split(string(out), "\n") {
				var event struct {
					URL       string `json:"url"`
					SetupCode string `json:"setup_code"`
				}
				if json.Unmarshal([]byte(line), &event) != nil || event.URL == "" {
					continue
				}
				if event.SetupCode != code {
					t.Fatalf("logged challenge = %q, want %q", event.SetupCode, code)
				}
				base, fragment, ok := strings.Cut(event.URL, "#")
				if !ok || base != "http://127.0.0.1:18765/admin/" {
					t.Fatalf("challenge must stay in the fragment: %q", event.URL)
				}
				// Parse the raw fragment once, like Setup.svelte's URLSearchParams.
				values, err := url.ParseQuery(fragment)
				if err != nil || len(values) != 1 || values.Get("setup") != code {
					t.Fatalf("BUG-05: setup link changed %q to %q: %v", code, values.Get("setup"), err)
				}
				return
			}
			t.Fatalf("startup emitted no setup URL:\n%s", out)
		})
	}
}

func TestRegressionBUG15HealthcheckPaddedListenerCLI(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusServiceUnavailable} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			requests := make(chan string, 1)
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests <- r.Method + " " + r.URL.Path
				w.WriteHeader(status)
			}))
			defer srv.Close()
			out, err := opsRegressionCLI(t, "healthcheck",
				"SANI_LISTEN= \t"+strings.TrimPrefix(srv.URL, "http://")+" \t",
				"SANI_BASE_URL=invalid-unrelated-config")
			if status == http.StatusOK && err != nil {
				t.Errorf("BUG-15: healthy padded listener rejected: %v\n%s", err, out)
			}
			if status != http.StatusOK && (err == nil || !strings.Contains(string(out), "healthz returned 503")) {
				t.Errorf("unhealthy HTTP status must fail CLI: %v\n%s", err, out)
			}
			select {
			case request := <-requests:
				if request != "GET /healthz" {
					t.Errorf("unexpected probe: %s", request)
				}
			default:
				t.Error("BUG-15: CLI did not probe the normalized listener")
			}
		})
	}
}

type opsRegressionTransport func(*http.Request) (*http.Response, error)

func (f opsRegressionTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestRegressionBUG15HealthcheckWhitespaceDefault(t *testing.T) {
	// Intercept the request so the default-port case cannot contact a real service.
	old := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = old })
	called := false
	http.DefaultTransport = opsRegressionTransport(func(r *http.Request) (*http.Response, error) {
		called = true
		if r.URL.String() != "http://127.0.0.1:8080/healthz" {
			t.Errorf("unexpected default probe: %s", r.URL)
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader("ok"))}, nil
	})
	t.Setenv("SANI_LISTEN", " \t\n ")
	if err := healthcheck(); err != nil || !called {
		t.Fatalf("BUG-15: whitespace must select the default listener: called=%v, err=%v", called, err)
	}
}
