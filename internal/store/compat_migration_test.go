package store

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func legacyFixture(t *testing.T, version int) (string, string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "sani.db")
	files := filepath.Join(dir, "files")
	if err := os.Mkdir(files, 0700); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", dsn(path, true))
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	defer db.Close()
	if _, err := db.Exec("PRAGMA foreign_keys=OFF"); err != nil {
		t.Fatal(err)
	}
	for _, m := range migrations[:version] {
		if _, err := db.Exec(m); err != nil {
			t.Fatal(err)
		}
	}
	_, err = db.Exec(fmt.Sprintf(`PRAGMA user_version=%d;
	INSERT INTO links(id,slug,slug_key,url,title,redirect,enabled,expires_at,max_clicks,clicks,last_click_at,created_at,updated_at)
	VALUES(101,'KeepCase','keepcase',?,'legacy',307,1,1234,500,27,111,100,110);
	INSERT INTO links(id,slug,slug_key,url,created_at,updated_at,deleted_at) VALUES(104,'trash','trash','https://example.org',100,110,120);
	INSERT INTO settings VALUES('password','unchanged password hash');
	INSERT INTO settings VALUES('base_url','https://short.example');
	INSERT INTO sessions VALUES(X'010203',100,110,9999999999999,'old browser');
	INSERT INTO tokens VALUES(71,'old token',X'040506','hint',100,110);
	INSERT INTO clicks_daily VALUES(101,20000,27);
	INSERT INTO referrers VALUES(101,'example.org',27);`, version), "https://example.org/"+strings.Repeat("x", 3000))
	if err != nil {
		t.Fatal(err)
	}
	if version >= 2 {
		data := []byte("old binary\x00\xff\n")
		sum := sha256.Sum256(data)
		if err := os.WriteFile(filepath.Join(files, "original-file"), data, 0600); err != nil {
			t.Fatal(err)
		}
		_, err = db.Exec(`INSERT INTO links(id,slug,slug_key,url,created_at,updated_at,kind) VALUES(102,'Note','note','',100,110,1),(103,'Download','download','',100,110,2);
		INSERT INTO contents(link_id,format,name,size,lines,body) VALUES(102,1,'first',20,2,'原文 <script>\n');
		INSERT INTO contents(link_id,name,type,size,sha256,file) VALUES(103,'报告.bin','application/octet-stream',?,?, 'original-file');`, len(data), sum[:])
		if err != nil {
			t.Fatal(err)
		}
	}
	if version >= 4 {
		if _, err := db.Exec(`INSERT INTO tags VALUES(42,'old','old','blue');INSERT INTO link_tags VALUES(101,42,0)`); err != nil {
			t.Fatal(err)
		}
	}
	return path, files
}

func TestCompatibilityUpgradePreservesAllLegacySchemas(t *testing.T) {
	for version := 1; version <= 5; version++ {
		t.Run(fmt.Sprint(version), func(t *testing.T) {
			path, files := legacyFixture(t, version)
			ctx := context.Background()
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			report, err := Preflight(ctx, path, files)
			if err != nil || report.Schema != version || report.Target != 6 {
				t.Fatalf("preflight: %+v %v", report, err)
			}
			after, _ := os.ReadFile(path)
			if !bytes.Equal(before, after) {
				t.Fatal("preflight rewrote the database")
			}
			var key string
			for attempt := 0; attempt < 2; attempt++ {
				s, err := Open(ctx, path)
				if err != nil {
					t.Fatal(err)
				}
				l, err := s.GetLink(ctx, 101)
				if err != nil || l.Slug != "KeepCase" || len(l.URL) <= 3000 || l.Clicks != 27 || l.Redirect != 307 || l.ExpiresAt != 1234 || l.MaxClicks != 500 {
					t.Fatalf("changed legacy link: %+v %v", l, err)
				}
				var password string
				s.w.QueryRow(`SELECT value FROM settings WHERE key='password'`).Scan(&password)
				if password != "unchanged password hash" {
					t.Fatal("password reset")
				}
				for _, q := range []string{`SELECT count(*) FROM sessions WHERE hash=X'010203' AND seen_at=110`, `SELECT count(*) FROM tokens WHERE id=71 AND hash=X'040506' AND used_at=110`, `SELECT count(*) FROM links WHERE id=104 AND deleted_at=120`, `SELECT count(*) FROM clicks_daily WHERE count=27`, `SELECT count(*) FROM referrers WHERE count=27`} {
					var n int
					if err := s.w.QueryRow(q).Scan(&n); err != nil || n != 1 {
						t.Fatalf("lost data: %s: %d %v", q, n, err)
					}
				}
				if version >= 2 {
					body, err := s.TextBody(ctx, 102)
					if err != nil || body != `原文 <script>\n` {
						t.Fatalf("text: %q %v", body, err)
					}
					file, err := s.GetLink(ctx, 103)
					if err != nil || file.Content.File != "original-file" || file.Content.Name != "报告.bin" || len(file.Content.DeleteKey) != 48 {
						t.Fatalf("file: %+v %v", file, err)
					}
					if attempt == 0 {
						key = file.Content.DeleteKey
					} else if key != file.Content.DeleteKey {
						t.Fatal("deletion key changed on restart")
					}
				}
				if version >= 4 && (len(l.Tags) != 1 || l.Tags[0] != 42) {
					t.Fatal("tag ID or order lost")
				}
				s.Close()
			}
			if _, err := Preflight(ctx, path, files); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCompatibilityMigrationFailureIsAtomic(t *testing.T) {
	for _, mode := range []string{"sql", "disk-full", "cancelled"} {
		t.Run(mode, func(t *testing.T) {
			path, _ := legacyFixture(t, 5)
			ctx := context.Background()
			db, err := sql.Open("sqlite", dsn(path, true))
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			db.SetMaxOpenConns(1)
			original := migrations
			defer func() { migrations = original }()
			switch mode {
			case "sql":
				migrations = append(append([]string{}, migrations...), `CREATE TABLE fail AS SELECT missing FROM absent`)
			case "disk-full":
				var pages int
				if err := db.QueryRow("PRAGMA page_count").Scan(&pages); err != nil {
					t.Fatal(err)
				}
				if _, err := db.Exec(fmt.Sprintf("PRAGMA max_page_count=%d", pages+2)); err != nil {
					t.Fatal(err)
				}
				migrations = append(append([]string{}, migrations...), `CREATE TABLE full(data); INSERT INTO full VALUES(zeroblob(8388608));`)
			case "cancelled":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			}
			if err := migrate(ctx, db); err == nil {
				t.Fatal("expected migration failure")
			}
			var version int
			db.QueryRow("PRAGMA user_version").Scan(&version)
			if version != 5 {
				t.Fatalf("partial schema committed: %d", version)
			}
			var n int
			db.QueryRow(`SELECT count(*) FROM pragma_table_info('contents') WHERE name='delete_key'`).Scan(&n)
			if n != 0 {
				t.Fatal("partial column survived rollback")
			}
			migrations = original
			if _, err := db.Exec("PRAGMA max_page_count=1073741823"); err != nil {
				t.Fatal(err)
			}
			if err := migrate(context.Background(), db); err != nil {
				t.Fatalf("retry failed: %v", err)
			}
		})
	}
}

func TestPreflightRejectsMissingAndCorruptFiles(t *testing.T) {
	path, files := legacyFixture(t, 5)
	file := filepath.Join(files, "original-file")
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	data[0] ^= 1
	if err := os.WriteFile(file, data, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Preflight(context.Background(), path, files); err == nil || !strings.Contains(err.Error(), "SHA-256 mismatch") {
		t.Fatalf("same-size corrupt file accepted: %v", err)
	}
	if err := os.WriteFile(file, []byte("bad"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Preflight(context.Background(), path, files); err == nil || !strings.Contains(err.Error(), "link 103") {
		t.Fatalf("corrupt file accepted: %v", err)
	}
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	if _, err := Preflight(context.Background(), path, files); err == nil || !strings.Contains(err.Error(), "link 103") {
		t.Fatalf("missing file accepted: %v", err)
	}
	if v, err := SchemaVersion(context.Background(), path); err != nil || v != 5 {
		t.Fatalf("preflight migrated: %d %v", v, err)
	}
}

func TestConcurrentMigratorsAndFilePagination(t *testing.T) {
	path, _ := legacyFixture(t, 5)
	var ready sync.WaitGroup
	ready.Add(2)
	errors := make(chan error, 2)
	for range 2 {
		go func() {
			db, err := sql.Open("sqlite", dsn(path, true))
			ready.Done()
			ready.Wait()
			if err == nil {
				db.SetMaxOpenConns(1)
				err = migrate(context.Background(), db)
				db.Close()
			}
			errors <- err
		}()
	}
	for range 2 {
		if err := <-errors; err != nil {
			t.Fatal(err)
		}
	}
	s, err := Open(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for i := range 30 {
		l := &Link{Slug: fmt.Sprintf("file%d", i), Kind: KindFile, Enabled: true, CreatedAt: 200, UpdatedAt: 200, Content: &Content{File: fmt.Sprintf("file%d", i)}}
		if err := s.CreateLink(context.Background(), l, true); err != nil {
			t.Fatal(err)
		}
	}
	first, err := s.FileHistory(context.Background(), 1)
	if err != nil || len(first) != 30 {
		t.Fatalf("first page: %d %v", len(first), err)
	}
	for i := 1; i < len(first); i++ {
		if first[i-1].ID <= first[i].ID {
			t.Fatal("unstable creation-time tie breaker")
		}
	}
	second, err := s.FileHistory(context.Background(), 2)
	if err != nil || len(second) != 1 || second[0].ID != 103 {
		t.Fatalf("second page: %+v %v", second, err)
	}
}

func TestSchemaZeroWithUnknownObjectsIsRefused(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sani.db")
	db, err := sql.Open("sqlite", dsn(path, true))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec("CREATE TABLE unrelated(value)")
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := SchemaVersion(context.Background(), path); err == nil || !strings.Contains(err.Error(), "unknown objects") {
		t.Fatalf("unknown database accepted: %v", err)
	}
}
