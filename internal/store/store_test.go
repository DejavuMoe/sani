package store

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"testing"

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

	s.CreateSession(ctx, []byte("a"), Session{ExpiresAt: 10})
	s.CreateSession(ctx, []byte("b"), Session{ExpiresAt: 100})
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
