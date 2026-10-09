package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/DejavuMoe/sani/internal/links"
)

func open(t *testing.T) *Store {
	t.Helper()
	s, err := Open(context.Background(), filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func newLink(slug, url string, at int64) *Link {
	return &Link{Slug: slug, URL: url, Host: links.FetchHost(url), Redirect: 302, Enabled: true, CreatedAt: at, UpdatedAt: at}
}

func TestBackup(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	path := filepath.Join(dir, "sani.db")
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.CreateLink(ctx, newLink("kept", "https://example.com/", 1000), true); err != nil {
		t.Fatal(err)
	}

	// The server keeps its connections open while the copy is taken.
	dst := filepath.Join(dir, "backup.db")
	if err := Backup(ctx, path, dst); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(dst)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		t.Errorf("backup exposes credentials with mode %o", info.Mode().Perm())
	}
	if err := Backup(ctx, path, dst); err == nil {
		t.Fatal("Backup overwrote an existing file")
	}
	if err := Backup(ctx, filepath.Join(dir, "missing.db"), filepath.Join(dir, "x.db")); err == nil {
		t.Fatal("Backup of a missing database succeeded")
	}

	b, err := Open(ctx, dst)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	if _, err := b.Resolve(ctx, "kept"); err != nil {
		t.Fatalf("link missing from the backup: %v", err)
	}
}

func TestBackupRejectsExistingTargetsAndCleansFailures(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	source := filepath.Join(dir, "source.db")
	s, err := Open(ctx, source)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	empty := filepath.Join(dir, "empty.db")
	if err := os.WriteFile(empty, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Backup(ctx, source, empty); err == nil {
		t.Fatal("backup accepted an existing empty file")
	}
	if info, err := os.Stat(empty); err != nil || info.Size() != 0 {
		t.Fatalf("existing file changed: %v %v", info, err)
	}
	t.Run("symlink", func(t *testing.T) {
		dst, target := filepath.Join(dir, "link.db"), filepath.Join(dir, "absent.db")
		if err := os.Symlink(target, dst); err != nil {
			if runtime.GOOS == "windows" {
				t.Skip("symlink privileges unavailable:", err)
			}
			t.Fatal(err)
		}
		if err := Backup(ctx, source, dst); err == nil {
			t.Fatal("backup followed a dangling symlink")
		}
		if _, err := os.Stat(target); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("symlink target was written: %v", err)
		}
		if _, err := os.Lstat(dst); err != nil {
			t.Fatal("existing symlink removed:", err)
		}
	})
	invalid := filepath.Join(dir, "invalid.db")
	if err := os.WriteFile(invalid, []byte("not a database"), 0o600); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dir, "failed.db")
	if err := Backup(ctx, invalid, dst); err == nil {
		t.Fatal("backup accepted invalid input")
	}
	if _, err := os.Stat(dst); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("failed backup left a partial file: %v", err)
	}
}

func TestMigrationPreservesChildrenAndNeverReusesIDs(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "v2.db")
	db, err := sql.Open("sqlite", dsn(path, true))
	if err != nil {
		t.Fatal(err)
	}
	for _, migration := range migrations[:2] {
		if _, err := db.ExecContext(ctx, migration); err != nil {
			t.Fatal(err)
		}
	}
	_, err = db.Exec(`PRAGMA user_version=2;
		INSERT INTO links (id, slug, slug_key, url, created_at, updated_at, kind, clicks) VALUES (42,'note','note','',1,1,1,3);
		INSERT INTO contents (link_id,size,body) VALUES (42,5,'hello');
		INSERT INTO clicks_daily VALUES (42,20000,3);
		INSERT INTO referrers VALUES (42,'example.com',3);`)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if text, err := s.TextBody(ctx, 42); err != nil || text != "hello" {
		t.Fatalf("migrated body=%q err=%v", text, err)
	}
	var daily, refs, foreignKeys int
	if err := s.r.QueryRow(`SELECT (SELECT count FROM clicks_daily WHERE link_id=42), (SELECT count FROM referrers WHERE link_id=42)`).Scan(&daily, &refs); err != nil {
		t.Fatal(err)
	}
	if err := s.w.QueryRow(`PRAGMA foreign_keys`).Scan(&foreignKeys); err != nil {
		t.Fatal(err)
	}
	if daily != 3 || refs != 3 || foreignKeys != 1 {
		t.Fatalf("daily=%d refs=%d FK=%d", daily, refs, foreignKeys)
	}
	if _, err := s.DeleteLink(ctx, 42, 2); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PurgeDeleted(ctx, 3); err != nil {
		t.Fatal(err)
	}
	l := newLink("new", "https://example.com", 4)
	if err := s.CreateLink(ctx, l, true); err != nil {
		t.Fatal(err)
	}
	if l.ID <= 42 {
		t.Fatalf("reused ID %d", l.ID)
	}
	var children int
	if err := s.r.QueryRow(`SELECT (SELECT count(*) FROM contents)+(SELECT count(*) FROM clicks_daily)+(SELECT count(*) FROM referrers)`).Scan(&children); err != nil {
		t.Fatal(err)
	}
	if children != 0 {
		t.Fatalf("cascade left %d children", children)
	}
	// The sequence survives a compacted backup and a restart.
	backup := filepath.Join(t.TempDir(), "copy.db")
	if err := Backup(ctx, path, backup); err != nil {
		t.Fatal(err)
	}
	b, err := Open(ctx, backup)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	if _, err := b.DeleteLink(ctx, l.ID, 5); err != nil {
		t.Fatal(err)
	}
	if _, err := b.PurgeDeleted(ctx, 6); err != nil {
		t.Fatal(err)
	}
	next := newLink("new", "https://example.com/next", 7)
	if err := b.CreateLink(ctx, next, true); err != nil {
		t.Fatal(err)
	}
	if next.ID <= l.ID {
		t.Fatalf("backup reused %d after %d", next.ID, l.ID)
	}
}

func TestWritePoolWaitHonorsDeadline(t *testing.T) {
	s := open(t)
	conn, err := s.w.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	err = s.CreateLink(ctx, newLink("waiting", "https://example.com", 1), false)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("blocked writer: %v", err)
	}
	if stats := s.w.Stats(); stats.WaitCount == 0 || stats.WaitDuration == 0 {
		t.Fatalf("missing pool wait: %+v", stats)
	}
}

func TestDatabaseLockWaitIsBounded(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "locked.db")
	first, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	tx, err := first.w.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	deadline, cancel := context.WithTimeout(ctx, 20*time.Millisecond)
	defer cancel()
	start := time.Now()
	err = second.CreateLink(deadline, newLink("blocked", "https://example.com", 1), false)
	if err == nil {
		t.Fatal("write passed an external write lock")
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("canceled SQLite lock wait took %v: %v", elapsed, err)
	}
}

func TestFailedMigrationRollsBack(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "broken-v2.db")
	db, err := sql.Open("sqlite", dsn(path, true))
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range migrations[:2] {
		if _, err := db.Exec(m); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`PRAGMA foreign_keys=OFF; PRAGMA user_version=2; INSERT INTO contents(link_id,size,body) VALUES(999,4,'lost');`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	if s, err := Open(ctx, path); err == nil {
		s.Close()
		t.Fatal("accepted an orphaned child during migration")
	}
	db, err = sql.Open("sqlite", dsn(path, true))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var version, children int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT count(*) FROM contents").Scan(&children); err != nil {
		t.Fatal(err)
	}
	if version != 2 || children != 1 {
		t.Fatalf("failed migration changed source: schema=%d children=%d", version, children)
	}
	if _, err := db.Exec("DELETE FROM contents"); err != nil {
		t.Fatal(err)
	}
	db.Close()
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
}

func TestLinkLifecycle(t *testing.T) {
	ctx := context.Background()
	s := open(t)

	l := newLink("GitHub", "https://github.com/", 1000)
	if err := s.CreateLink(ctx, l, true); err != nil {
		t.Fatal(err)
	}
	if l.ID == 0 {
		t.Fatal("CreateLink did not set ID")
	}
	if err := s.CreateLink(ctx, newLink("github", "https://x.com", 1001), true); !errors.Is(err, ErrSlugTaken) {
		t.Fatalf("case-insensitive duplicate: err = %v, want ErrSlugTaken", err)
	}

	tgt, err := s.Resolve(ctx, "github")
	if err != nil || tgt.URL != "https://github.com/" || tgt.ID != l.ID {
		t.Fatalf("Resolve = %+v, %v", tgt, err)
	}
	if _, err := s.Resolve(ctx, "nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Resolve(missing) err = %v", err)
	}

	slug, u := "gh", "https://github.com/DejavuMoe"
	before, after, err := s.UpdateLink(ctx, l.ID, Patch{Slug: &slug, URL: &u}, 2000)
	if err != nil {
		t.Fatal(err)
	}
	if before.Slug != "GitHub" || after.Slug != "gh" || after.URL != u || after.UpdatedAt != 2000 {
		t.Fatalf("UpdateLink before=%+v after=%+v", before, after)
	}
	if ok, _ := s.SlugAvailable(ctx, "github"); !ok {
		t.Error("old slug should be free after rename")
	}

	key, err := s.DeleteLink(ctx, l.ID, 3000)
	if err != nil || key != "gh" {
		t.Fatalf("DeleteLink = %q, %v", key, err)
	}
	if _, err := s.Resolve(ctx, "gh"); !errors.Is(err, ErrNotFound) {
		t.Fatal("deleted link still resolves")
	}
	if ok, _ := s.SlugAvailable(ctx, "gh"); !ok {
		t.Error("a deleted link's slug should be reusable")
	}
	restored, err := s.RestoreLink(ctx, l.ID)
	if err != nil || restored.Slug != "gh" {
		t.Fatalf("RestoreLink = %+v, %v", restored, err)
	}

	// Reclaiming a deleted link's slug replaces that link for good.
	s.DeleteLink(ctx, l.ID, 4000)
	if err := s.CreateLink(ctx, newLink("gh", "https://gitlab.com", 5000), false); !errors.Is(err, ErrSlugTaken) {
		t.Fatalf("generated slugs must not reclaim: %v", err)
	}
	nl := newLink("gh", "https://gitlab.com", 5000)
	if err := s.CreateLink(ctx, nl, true); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RestoreLink(ctx, l.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("restoring a reclaimed link: %v", err)
	}
}

func TestUpdateLinkTimestampIncreasesInCommitOrder(t *testing.T) {
	ctx := context.Background()
	s := open(t)
	l := newLink("ordered", "https://example.com/", 2000)
	if err := s.CreateLink(ctx, l, false); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ now, want int64 }{{2000, 2001}, {1500, 2002}, {3000, 3000}} {
		title := fmt.Sprintf("saved at %d", tc.now)
		before, after, err := s.UpdateLink(ctx, l.ID, Patch{Title: &title}, tc.now)
		if err != nil {
			t.Fatal(err)
		}
		if after.UpdatedAt != tc.want || after.UpdatedAt <= before.UpdatedAt || after.Title != title {
			t.Fatalf("now=%d: before=%+v after=%+v", tc.now, before, after)
		}
		stored, err := s.GetLink(ctx, l.ID)
		if err != nil || stored.UpdatedAt != tc.want {
			t.Fatalf("persisted timestamp: %+v, %v", stored, err)
		}
	}
	before, after, err := s.UpdateLink(ctx, l.ID, Patch{RefreshMeta: true}, 9000)
	if err != nil || after.UpdatedAt != before.UpdatedAt {
		t.Fatalf("metadata refresh changed timestamp: before=%+v after=%+v err=%v", before, after, err)
	}
}

func TestBulkTimestampIncreasesPerRow(t *testing.T) {
	ctx := context.Background()
	s := open(t)
	var ids []int64
	for i, at := range []int64{1000, 2000, 3000} {
		l := newLink(fmt.Sprintf("ordered%d", i), "https://example.com/", at)
		if err := s.CreateLink(ctx, l, false); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, l.ID)
	}
	for step, action := range []BulkAction{BulkDisable, BulkEnable} {
		changed, err := s.Bulk(ctx, action, ids, 2000)
		if err != nil || len(changed) != len(ids) {
			t.Fatalf("bulk %d: %d rows, %v", action, len(changed), err)
		}
		for i, base := range []int64{2000, 2001, 3001} {
			want := base + int64(step)
			stored, err := s.GetLink(ctx, ids[i])
			if err != nil || stored.UpdatedAt != want || stored.Enabled != (action == BulkEnable) {
				t.Fatalf("bulk %d row %d: %+v, %v; want timestamp %d", action, ids[i], stored, err, want)
			}
			for _, returned := range changed {
				if returned.ID == ids[i] && returned.UpdatedAt != want {
					t.Fatalf("bulk returned stale timestamp: %+v", returned)
				}
			}
		}
	}
}

func TestPurgeAndCascade(t *testing.T) {
	ctx := context.Background()
	s := open(t)
	l := newLink("abc", "https://example.com", 1)
	s.CreateLink(ctx, l, true)
	b := &ClickBatch{
		Links: map[int64]LinkDelta{l.ID: {Count: 3, Last: 50}},
		Days:  map[DayKey]int64{{l.ID, 100}: 3},
		Refs:  map[RefKey]int64{{l.ID, "t.co"}: 2, {l.ID, ""}: 1},
	}
	if err := s.ApplyClicks(ctx, b); err != nil {
		t.Fatal(err)
	}
	s.DeleteLink(ctx, l.ID, 10)
	if n, err := s.PurgeDeleted(ctx, 11); err != nil || n != 1 {
		t.Fatalf("PurgeDeleted = %d, %v", n, err)
	}
	var rows int
	s.r.QueryRow(`SELECT (SELECT count(*) FROM clicks_daily) + (SELECT count(*) FROM referrers)`).Scan(&rows)
	if rows != 0 {
		t.Errorf("%d stats rows survived the purge", rows)
	}
	// Clicks for a purged link are dropped without failing the batch.
	if err := s.ApplyClicks(ctx, b); err != nil {
		t.Fatalf("ApplyClicks for purged link: %v", err)
	}
}

func TestContents(t *testing.T) {
	ctx := context.Background()
	s := open(t)
	text := &Link{Kind: KindText, Slug: "note", Enabled: true, Redirect: 302, CreatedAt: 1, UpdatedAt: 1,
		Content: &Content{Format: FormatCode, Name: "package main", Size: 13, Lines: 1, Text: "package main\n"}}
	file := &Link{Kind: KindFile, Slug: "doc", Enabled: true, Redirect: 302, CreatedAt: 2, UpdatedAt: 2,
		Content: &Content{Name: "report.pdf", Type: "application/pdf", Size: 9, SHA256: []byte{1, 2}, File: "ab12"}}
	for _, l := range []*Link{text, file, newLink("site", "https://example.com", 3)} {
		if err := s.CreateLink(ctx, l, true); err != nil {
			t.Fatal(err)
		}
	}

	got, err := s.GetLink(ctx, text.ID)
	if err != nil || got.Kind != KindText || got.Content == nil || got.Content.Lines != 1 || got.Content.Text != "" {
		t.Fatalf("text link = %+v %+v, %v", got, got.Content, err)
	}
	if body, err := s.TextBody(ctx, text.ID); err != nil || body != "package main\n" {
		t.Fatalf("TextBody = %q, %v", body, err)
	}
	if _, err := s.TextBody(ctx, file.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("TextBody of a file: %v", err)
	}
	if t2, _ := s.Resolve(ctx, "doc"); t2 == nil || t2.Kind != KindFile {
		t.Fatalf("Resolve(doc) = %+v", t2)
	}

	body, format := "fmt.Println()\nreturn\n", FormatPlain
	if _, after, err := s.UpdateLink(ctx, text.ID, Patch{Text: &body, Format: &format}, 5); err != nil ||
		after.Content.Lines != 2 || after.Content.Name != "fmt.Println()" || after.Content.Format != FormatPlain {
		t.Fatalf("UpdateLink text = %+v, %v", after.Content, err)
	}

	kind := KindFile
	res, _ := s.ListLinks(ctx, ListQuery{Kind: &kind})
	if res.Total != 1 || res.Links[0].ID != file.ID {
		t.Fatalf("kind filter = %d links", res.Total)
	}
	if res, _ := s.ListLinks(ctx, ListQuery{Search: "report"}); res.Total != 1 {
		t.Fatalf("search by file name = %d", res.Total)
	}
	if all, _ := s.AllLinks(ctx); len(all) != 1 || all[0].Slug != "site" {
		t.Fatalf("AllLinks = %v", all)
	}

	// A deleted file stays on disk until its link is purged.
	s.DeleteLink(ctx, file.ID, 10)
	if names, _ := s.StoredFiles(ctx); !names["ab12"] {
		t.Fatalf("StoredFiles before the purge = %v", names)
	}
	s.PurgeDeleted(ctx, 11)
	if names, _ := s.StoredFiles(ctx); len(names) != 0 {
		t.Fatalf("StoredFiles after the purge = %v", names)
	}
}

func TestMigrateFromFirstSchema(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "old.db")
	db, err := sql.Open("sqlite", dsn(path, true))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(migrations[0] + `; PRAGMA user_version = 1;
		INSERT INTO links (slug, slug_key, url, created_at, updated_at) VALUES ('old', 'old', 'https://example.com', 1, 1)`); err != nil {
		t.Fatal(err)
	}
	db.Close()

	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	l, err := s.Resolve(ctx, "old")
	if err != nil || l.Kind != KindURL || l.URL != "https://example.com" {
		t.Fatalf("link from the first schema = %+v, %v", l, err)
	}
}

func TestClicksAndStats(t *testing.T) {
	ctx := context.Background()
	s := open(t)
	a, b := newLink("a", "https://a.example", 1), newLink("b", "https://b.example", 2)
	s.CreateLink(ctx, a, true)
	s.CreateLink(ctx, b, true)

	for i := range 3 {
		err := s.ApplyClicks(ctx, &ClickBatch{
			Links: map[int64]LinkDelta{a.ID: {Count: 2, Last: int64(100 + i)}, b.ID: {Count: 1, Last: 90}},
			Days:  map[DayKey]int64{{a.ID, int32(10 + i)}: 2, {b.ID, 12}: 1},
			Refs:  map[RefKey]int64{{a.ID, "t.co"}: 1, {a.ID, ""}: 1, {b.ID, "weibo.com"}: 1},
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	got, _ := s.GetLink(ctx, a.ID)
	if got.Clicks != 6 || got.LastClickAt != 102 {
		t.Errorf("clicks=%d last=%d, want 6 and 102", got.Clicks, got.LastClickAt)
	}
	series, err := s.Series(ctx, a.ID, 9, 13)
	if err != nil || fmt.Sprint(series) != "[0 2 2 2 0]" {
		t.Errorf("Series = %v, %v", series, err)
	}
	all, _ := s.Series(ctx, 0, 12, 12)
	if all[0] != 5 {
		t.Errorf("all-links series for day 12 = %d, want 5", all[0])
	}
	sparks, _ := s.Sparks(ctx, []int64{a.ID, b.ID}, 10, 12)
	if fmt.Sprint(sparks[a.ID]) != "[2 2 2]" || fmt.Sprint(sparks[b.ID]) != "[0 0 3]" {
		t.Errorf("Sparks = %v", sparks)
	}
	refs, total, _ := s.Referrers(ctx, a.ID, 10)
	if total != 6 || len(refs) != 2 || refs[0].Count != 3 {
		t.Errorf("Referrers = %+v total %d", refs, total)
	}
	nl, nc, _ := s.Totals(ctx)
	if nl != 2 || nc != 9 {
		t.Errorf("Totals = %d links, %d clicks", nl, nc)
	}
}

func TestListLinks(t *testing.T) {
	ctx := context.Background()
	s := open(t)
	for i := range 25 {
		l := newLink(fmt.Sprintf("s%02d", i), fmt.Sprintf("https://site%d.example/page", i), int64(1000+i))
		l.Title = fmt.Sprintf("Page %d", i)
		l.Clicks = int64(i % 5)
		if err := s.CreateLink(ctx, l, true); err != nil {
			t.Fatal(err)
		}
	}

	var seen []string
	q := ListQuery{Limit: 10}
	for {
		res, err := s.ListLinks(ctx, q)
		if err != nil {
			t.Fatal(err)
		}
		if res.Total != 25 {
			t.Fatalf("Total = %d", res.Total)
		}
		for _, l := range res.Links {
			seen = append(seen, l.Slug)
		}
		if res.Next == nil {
			break
		}
		c, ok := ParseCursor(res.Next.String())
		if !ok {
			t.Fatal("cursor does not round-trip")
		}
		q.After = c
	}
	if len(seen) != 25 || seen[0] != "s24" || seen[24] != "s00" {
		t.Fatalf("paged newest-first listing = %v", seen)
	}

	res, _ := s.ListLinks(ctx, ListQuery{Search: "site1", Limit: 50})
	if res.Total != 11 { // site1, site10..site19
		t.Errorf("search total = %d, want 11", res.Total)
	}
	res, _ = s.ListLinks(ctx, ListQuery{Search: "100%", Limit: 50})
	if res.Total != 0 {
		t.Error("LIKE wildcards in the search term must be literal")
	}
	res, _ = s.ListLinks(ctx, ListQuery{Sort: "clicks", Limit: 3})
	if res.Links[0].Clicks != 4 {
		t.Errorf("clicks sort starts with %d clicks", res.Links[0].Clicks)
	}
}

func TestImportLinks(t *testing.T) {
	ctx := context.Background()
	s := open(t)
	s.CreateLink(ctx, newLink("taken", "https://a.example", 1), true)
	n := 0
	gen := func() string { n++; return fmt.Sprintf("gen%d", n) }
	res, err := s.ImportLinks(ctx, []*Link{
		newLink("fresh", "https://b.example", 2),
		newLink("TAKEN", "https://c.example", 3),
		newLink("", "https://d.example", 4),
		newLink("fresh", "https://e.example", 5),
	}, gen)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Created) != 2 || fmt.Sprint(res.Conflicts) != "[TAKEN fresh]" {
		t.Fatalf("created %d, conflicts %v", len(res.Created), res.Conflicts)
	}
	if res.Created[1].Slug != "gen1" {
		t.Errorf("generated slug = %q", res.Created[1].Slug)
	}
}

func TestAuthRecords(t *testing.T) {
	ctx := context.Background()
	s := open(t)
	if ok, err := s.SetPasswordOnce(ctx, "h1"); !ok || err != nil {
		t.Fatalf("first SetPasswordOnce = %v, %v", ok, err)
	}
	if ok, _ := s.SetPasswordOnce(ctx, "h2"); ok {
		t.Fatal("second SetPasswordOnce must not win")
	}
	if v, _ := s.Setting(ctx, SettingPassword); v != "h1" {
		t.Fatalf("password = %q", v)
	}

	s.CreateSession(ctx, []byte("a"), "h1", Session{ExpiresAt: 10})
	s.CreateSession(ctx, []byte("b"), "h1", Session{ExpiresAt: 100})
	s.DeleteSessions(ctx, []byte("b"))
	if _, err := s.Session(ctx, []byte("a")); !errors.Is(err, ErrNotFound) {
		t.Error("other sessions should be gone")
	}
	if _, err := s.Session(ctx, []byte("b")); err != nil {
		t.Error("kept session is gone")
	}
	s.PurgeSessions(ctx, 101)
	if _, err := s.Session(ctx, []byte("b")); !errors.Is(err, ErrNotFound) {
		t.Error("expired session survived the purge")
	}

	tok, _ := s.CreateToken(ctx, "cli", []byte("hash"), "sani_ab", 5)
	if got, err := s.TokenByHash(ctx, []byte("hash")); err != nil || got.ID != tok.ID {
		t.Fatalf("TokenByHash = %+v, %v", got, err)
	}
	if err := s.DeleteToken(ctx, tok.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteToken(ctx, tok.ID); !errors.Is(err, ErrNotFound) {
		t.Error("deleting twice should report ErrNotFound")
	}
}

func TestFaviconJoin(t *testing.T) {
	ctx := context.Background()
	s := open(t)
	l := newLink("x", "https://www.example.com/a", 1)
	s.CreateLink(ctx, l, true)
	got, _ := s.GetLink(ctx, l.ID)
	if got.HasIcon {
		t.Fatal("HasIcon without an icon")
	}
	s.PutFavicon(ctx, "www.example.com", &Favicon{Type: "", Data: []byte{}, FetchedAt: 1})
	if got, _ = s.GetLink(ctx, l.ID); got.HasIcon {
		t.Fatal("a failed fetch must not count as an icon")
	}
	s.PutFavicon(ctx, "www.example.com", &Favicon{Type: "image/png", Data: []byte{1}, FetchedAt: 2})
	if got, _ = s.GetLink(ctx, l.ID); !got.HasIcon {
		t.Fatal("HasIcon is false with an icon stored")
	}
}
