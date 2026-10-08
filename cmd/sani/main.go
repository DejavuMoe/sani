// Command sani is a small, fast link shortener for one owner.
package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
	_ "time/tzdata" // TZ works in minimal containers without zoneinfo

	"golang.org/x/term"

	"github.com/DejavuMoe/sani/internal/auth"
	"github.com/DejavuMoe/sani/internal/clicks"
	"github.com/DejavuMoe/sani/internal/config"
	"github.com/DejavuMoe/sani/internal/links"
	"github.com/DejavuMoe/sani/internal/meta"
	"github.com/DejavuMoe/sani/internal/server"
	"github.com/DejavuMoe/sani/internal/store"
	"github.com/DejavuMoe/sani/internal/webui"
)

// Set at build time with -ldflags "-X main.version=v1.2.3".
var version = "dev"

const usage = `sani — a small, fast link shortener

Usage:
  sani              start the server (same as "sani serve")
  sani serve        start the server
  sani passwd       set a new admin password and sign out every session
  sani backup FILE  write a consistent copy of the database to FILE ("-": stdout)
  sani healthcheck  exit 0 if the local server answers /healthz
  sani version      print the version

Configuration is read from SANI_* environment variables; see README.md.
`

func main() {
	cmd := "serve"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	var err error
	switch cmd {
	case "serve":
		err = serve()
	case "passwd", "password":
		err = passwd()
	case "backup":
		err = backup()
	case "healthcheck":
		err = healthcheck()
	case "version", "-v", "--version":
		fmt.Println("sani", version)
	case "help", "-h", "--help":
		fmt.Print(usage)
	default:
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "sani:", err)
		os.Exit(1)
	}
}

func newLogger(cfg *config.Config) *slog.Logger {
	opts := &slog.HandlerOptions{Level: cfg.LogLevel}
	if cfg.LogJSON {
		return slog.New(slog.NewJSONHandler(os.Stderr, opts))
	}
	return slog.New(slog.NewTextHandler(os.Stderr, opts))
}

func openStore(ctx context.Context, cfg *config.Config) (*store.Store, error) {
	if err := os.MkdirAll(cfg.DataDir, 0o750); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}
	return store.Open(ctx, filepath.Join(cfg.DataDir, "sani.db"))
}

func serve() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log := newLogger(cfg)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := openStore(ctx, cfg)
	if err != nil {
		return err
	}
	defer st.Close()

	setupCode := ""
	if cfg.Password != "" {
		if err := syncEnvPassword(ctx, st, cfg.Password); err != nil {
			return err
		}
	} else if _, err := st.Setting(ctx, store.SettingPassword); errors.Is(err, store.ErrNotFound) {
		setupCode = cfg.SetupCode
		if setupCode == "" {
			c := links.Generate(12)
			setupCode = c[:4] + "-" + c[4:8] + "-" + c[8:]
		}
		attrs := []any{"setup_code", setupCode}
		if cfg.BaseURL != "" {
			// The fragment stays in the browser, so the code never reaches access logs.
			attrs = append(attrs, "url", cfg.BaseURL+"/admin/#setup="+setupCode)
		}
		log.Warn("no admin password yet: open /admin/ and enter this setup code, or set SANI_PASSWORD", attrs...)
		if !log.Enabled(ctx, slog.LevelWarn) {
			// The owner needs this line whatever the log level is.
			fmt.Fprintf(os.Stderr, "sani: no admin password yet: open /admin/ and enter the setup code %s\n", setupCode)
		}
	} else if err != nil {
		return err
	}

	rec := clicks.New(st, time.Local)
	srv, err := server.New(server.Options{
		BaseURL:         cfg.BaseURL,
		RootRedirect:    cfg.RootRedirect,
		TrustProxy:      cfg.TrustProxy,
		SlugLength:      cfg.SlugLength,
		FetchMeta:       cfg.FetchMeta,
		ForwardQuery:    cfg.ForwardQuery,
		PasswordFromEnv: cfg.Password != "",
		SetupCode:       setupCode,
		CacheSize:       cfg.CacheSize,
		Version:         version,
		FilesURL:        cfg.FilesURL,
		FilesDir:        filepath.Join(cfg.DataDir, "files"),
		MaxFileBytes:    int64(cfg.MaxFileMB) << 20,
	}, st, rec, meta.New(), webui.FS(), log)
	if err != nil {
		return err
	}

	hs := &http.Server{
		Handler:           srv,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    32 << 10,
		ErrorLog:          slog.NewLogLogger(log.Handler(), slog.LevelDebug),
	}
	ln, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		return err
	}
	ready := []any{"addr", ln.Addr().String(), "data", cfg.DataDir, "tz", time.Local.String(), "version", version}
	if cfg.FilesURL != "" {
		ready = append(ready, "files", cfg.FilesURL)
	}
	log.Info("sani is ready", ready...)

	bg, stopBackground := context.WithCancel(context.Background())
	defer stopBackground()
	var background sync.WaitGroup
	background.Go(func() { rec.Run(bg, 2*time.Second, log) })
	background.Go(func() { srv.RunMaintenance(bg) })
	backgroundDone := make(chan struct{})
	go func() { background.Wait(); close(backgroundDone) }()

	errc := make(chan error, 1)
	go func() { errc <- hs.Serve(ln) }()
	select {
	case <-ctx.Done():
	case err = <-errc:
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
	}

	log.Info("shutting down")
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return errors.Join(err, finish(shutdown, hs, srv, rec, stopBackground, backgroundDone))
}

// finish drains HTTP before the last click batch, and gives canceled jobs
// time to leave the database before it is closed. Failures reach the exit code.
func finish(grace context.Context, hs *http.Server, srv *server.Server, rec *clicks.Recorder,
	stopBackground context.CancelFunc, backgroundDone <-chan struct{}) error {
	httpErr := hs.Shutdown(grace)
	if httpErr != nil {
		hs.Close()
	}
	stopBackground()
	drain, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	jobErr := srv.Shutdown(drain)
	select {
	case <-backgroundDone:
	case <-drain.Done():
		jobErr = errors.Join(jobErr, drain.Err())
	}
	// Flush has its own five-second deadline; it must not inherit an
	// expired HTTP grace period.
	flushErr := rec.Flush(context.Background())
	if flushErr != nil {
		flushErr = fmt.Errorf("final click flush: %w", flushErr)
	}
	return errors.Join(httpErr, jobErr, flushErr)
}

// syncEnvPassword makes SANI_PASSWORD the password, signing out sessions
// created under an older one.
func syncEnvPassword(ctx context.Context, st *store.Store, pw string) error {
	if err := auth.ValidatePassword(pw); err != nil {
		return err
	}
	hash, err := st.Setting(ctx, store.SettingPassword)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return err
	}
	if hash != "" && auth.VerifyPassword(pw, hash) {
		return nil
	}
	return st.ReplacePassword(ctx, hash, auth.HashPassword(pw), nil)
}

func passwd() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	var pw string
	fd := int(os.Stdin.Fd())
	if term.IsTerminal(fd) {
		fmt.Fprint(os.Stderr, "New password: ")
		a, err := term.ReadPassword(fd)
		fmt.Fprintln(os.Stderr)
		if err != nil {
			return err
		}
		fmt.Fprint(os.Stderr, "Repeat it: ")
		b, err := term.ReadPassword(fd)
		fmt.Fprintln(os.Stderr)
		if err != nil {
			return err
		}
		if string(a) != string(b) {
			return errors.New("the passwords do not match")
		}
		pw = string(a)
	} else {
		line, err := bufio.NewReader(os.Stdin).ReadString('\n')
		if err != nil && line == "" {
			return errors.New("pipe the new password on standard input")
		}
		pw = strings.TrimRight(line, "\r\n")
	}
	if err := auth.ValidatePassword(pw); err != nil {
		return err
	}

	ctx := context.Background()
	st, err := openStore(ctx, cfg)
	if err != nil {
		return err
	}
	defer st.Close()
	hash, err := st.Setting(ctx, store.SettingPassword)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return err
	}
	if err := st.ReplacePassword(ctx, hash, auth.HashPassword(pw), nil); err != nil {
		return err
	}
	fmt.Fprintln(os.Stderr, "Password updated; every session has been signed out.")
	if cfg.Password != "" {
		fmt.Fprintln(os.Stderr, "Note: SANI_PASSWORD is set and will replace this password on the next start.")
	}
	return nil
}

// backup copies the database while the server keeps running. With "-" the
// copy goes to standard output, so a container needs no shell or shared
// directory: docker exec sani /sani backup - > sani.db
func backup() error {
	if len(os.Args) != 3 {
		return errors.New(`usage: sani backup FILE (or "-" for standard output)`)
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx := context.Background()
	src := filepath.Join(cfg.DataDir, "sani.db")
	// Garbage collection can remove an old snapshot's files while copying.
	// A full database + files backup needs the service stopped for both.
	files := filepath.Join(cfg.DataDir, "files")
	if entries, err := os.ReadDir(files); err == nil && len(entries) > 0 {
		defer fmt.Fprintf(os.Stderr, "Database only: shared files in %s are excluded. For a complete backup, stop Sani before taking BOTH the database backup and the files copy.\n", files)
	}
	if dst := os.Args[2]; dst != "-" {
		if err := store.Backup(ctx, src, dst); err != nil {
			return err
		}
		fmt.Fprintf(os.Stderr, "Backed up %s to %s\n", src, dst)
		return nil
	}

	if term.IsTerminal(int(os.Stdout.Fd())) {
		return errors.New("standard output is a terminal; redirect it to a file")
	}
	// The copy is staged next to the database: the data directory is known
	// to be writable, and a FROM scratch image has no /tmp.
	tmp := filepath.Join(cfg.DataDir, fmt.Sprintf(".backup-%d.db", time.Now().UnixNano()))
	defer os.Remove(tmp)
	if err := store.Backup(ctx, src, tmp); err != nil {
		return err
	}
	f, err := os.Open(tmp)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := io.Copy(os.Stdout, f); err != nil {
		return fmt.Errorf("write backup: %w", err)
	}
	return nil
}

func healthcheck() error {
	listen := os.Getenv("SANI_LISTEN")
	if listen == "" {
		listen = ":8080"
	}
	host, port, err := net.SplitHostPort(listen)
	if err != nil {
		return err
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	c := &http.Client{Timeout: 3 * time.Second}
	resp, err := c.Get("http://" + net.JoinHostPort(host, port) + "/healthz")
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("healthz returned %d", resp.StatusCode)
	}
	return nil
}
