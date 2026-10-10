package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func TestDeleteTagKeepsLinksAndRollsBack(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	tag, err := s.CreateTag(ctx, "delete-me", "blue")
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.CreateTag(ctx, "keep-me", "green")
	if err != nil {
		t.Fatal(err)
	}
	l := newLink("keep-link", "https://example.com", 100)
	l.Tags = []int64{tag.ID, other.ID}
	if err := s.CreateLink(ctx, l, true); err != nil {
		t.Fatal(err)
	}
	if _, err := s.w.Exec(`CREATE TRIGGER reject_tag_delete BEFORE DELETE ON tags BEGIN SELECT RAISE(ABORT, 'test failure'); END`); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteTag(ctx, tag.ID, 200); err == nil {
		t.Fatal("delete should fail")
	}
	got, err := s.GetLink(ctx, l.ID)
	if err != nil || !reflect.DeepEqual(got.Tags, l.Tags) || got.UpdatedAt != l.UpdatedAt {
		t.Fatalf("failed delete changed link: %+v %v", got, err)
	}
	if _, err := s.w.Exec(`DROP TRIGGER reject_tag_delete`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DeleteLink(ctx, l.ID, 200); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteTag(ctx, tag.ID, 50); err != nil {
		t.Fatal(err)
	}
	got, err = s.RestoreLink(ctx, l.ID)
	if err != nil || !reflect.DeepEqual(got.Tags, []int64{other.ID}) || got.URL != l.URL || got.UpdatedAt <= l.UpdatedAt {
		t.Fatalf("restored link: %+v %v", got, err)
	}
	if err := s.DeleteTag(ctx, tag.ID, 300); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete: %v", err)
	}
}

func TestTagsMigrationAndTransactions(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "v3.db")
	db, err := sql.Open("sqlite", dsn(path, true))
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range migrations[:3] {
		if _, err := db.Exec(m); err != nil {
			t.Fatal(err)
		}
	}
	_, err = db.Exec(`PRAGMA user_version=3;
		INSERT INTO links (id,slug,slug_key,url,created_at,updated_at,kind,clicks) VALUES (42,'note','note','',1,1,1,3);
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
	defer func() { s.Close() }()
	var version int
	if err := s.r.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != len(migrations) {
		t.Fatalf("schema %d: %v", version, err)
	}
	l, err := s.GetLink(ctx, 42)
	if err != nil || len(l.Tags) != 0 || l.Clicks != 3 {
		t.Fatalf("old link: %+v %v", l, err)
	}
	if text, err := s.TextBody(ctx, 42); err != nil || text != "hello" {
		t.Fatalf("old text %q: %v", text, err)
	}
	for _, table := range []string{"clicks_daily", "referrers"} {
		var count int
		if err := s.r.QueryRow("SELECT count FROM " + table + " WHERE link_id=42").Scan(&count); err != nil || count != 3 {
			t.Fatalf("%s lost: %v", table, err)
		}
	}
	tag, err := s.CreateTag(ctx, "  Cafe\u0301  ", "amber")
	if err != nil || tag.Name != "Café" {
		t.Fatalf("normalize: %+v %v", tag, err)
	}
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			dup, err := s.CreateTag(ctx, "CAFÉ", "rose")
			if err != nil || dup.ID != tag.ID || dup.Color != "amber" {
				t.Errorf("duplicate: %+v %v", dup, err)
			}
		})
	}
	wg.Wait()
	ids := []int64{tag.ID}
	if _, _, err := s.UpdateLink(ctx, 42, Patch{Tags: &ids}, 2); err != nil {
		t.Fatal(err)
	}
	bad := []int64{tag.ID, 99999}
	title := "must roll back"
	if _, _, err := s.UpdateLink(ctx, 42, Patch{Tags: &bad, Title: &title}, 3); !errors.Is(err, ErrTagsInvalid) {
		t.Fatalf("bad patch: %v", err)
	}
	l, _ = s.GetLink(ctx, 42)
	if !reflect.DeepEqual(l.Tags, ids) || l.Title != "" || l.UpdatedAt != 2 {
		t.Fatalf("partial patch: %+v", l)
	}
	for _, query := range []ListQuery{{Tag: &tag.ID}, {Tag: &tag.ID, Search: "hello"}, {Tag: &tag.ID, Search: "missing"}} {
		res, err := s.ListLinks(ctx, query)
		want := int64(1)
		if query.Search != "" {
			want = 0
		} // text body is deliberately not searched
		if err != nil || res.Total != want {
			t.Fatalf("filter %+v: %+v %v", query, res, err)
		}
	}
	if _, err := s.DeleteLink(ctx, 42, 10); err != nil {
		t.Fatal(err)
	}
	catalog, _ := s.Tags(ctx)
	if catalog.Total != 0 || catalog.Items[0].Count != 0 {
		t.Fatalf("deleted counts: %+v", catalog)
	}
	l, err = s.RestoreLink(ctx, 42)
	if err != nil || !reflect.DeepEqual(l.Tags, ids) {
		t.Fatalf("restore: %+v %v", l, err)
	}
	backup := filepath.Join(t.TempDir(), "backup.db")
	if err := Backup(ctx, path, backup); err != nil {
		t.Fatal(err)
	}
	b, err := Open(ctx, backup)
	if err != nil {
		t.Fatal(err)
	}
	back, err := b.GetLink(ctx, 42)
	b.Close()
	if err != nil || !reflect.DeepEqual(back.Tags, ids) {
		t.Fatalf("backup: %+v %v", back, err)
	}
	s.Close()
	s, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	l, err = s.GetLink(ctx, 42)
	if err != nil || !reflect.DeepEqual(l.Tags, ids) {
		t.Fatalf("reopen: %+v %v", l, err)
	}
	if _, err := s.DeleteLink(ctx, 42, 10); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PurgeDeleted(ctx, 11); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.r.QueryRow("SELECT count(*) FROM link_tags").Scan(&count); err != nil || count != 0 {
		t.Fatalf("orphan associations: %d %v", count, err)
	}
}

func TestTagBoundsAndFilteredPagination(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	for _, name := range []string{"", " \t ", "a\nB", strings.Repeat("字", 25)} {
		if _, err := s.CreateTag(ctx, name, "blue"); !errors.Is(err, ErrTagsInvalid) {
			t.Fatalf("accepted %q", name)
		}
	}
	if _, err := s.CreateTag(ctx, "ok", "style-injection"); !errors.Is(err, ErrTagsInvalid) {
		t.Fatal(err)
	}
	tag, err := s.CreateTag(ctx, strings.Repeat("字", 24), "green")
	if err != nil {
		t.Fatal(err)
	}
	for i := range 6 {
		l := newLink(fmt.Sprintf("tagged-%d", i), "https://example.com", 100)
		if i%2 == 0 {
			l.Tags = []int64{tag.ID}
		}
		if err := s.CreateLink(ctx, l, true); err != nil {
			t.Fatal(err)
		}
	}
	q := ListQuery{Tag: &tag.ID, Limit: 2}
	first, err := s.ListLinks(ctx, q)
	if err != nil || len(first.Links) != 2 || first.Total != 3 || first.Next == nil {
		t.Fatalf("page 1: %+v %v", first, err)
	}
	q.After = first.Next
	last, err := s.ListLinks(ctx, q)
	if err != nil || len(last.Links) != 1 || last.Total != 3 || last.Next != nil || last.Links[0].ID == first.Links[1].ID {
		t.Fatalf("page 2: %+v %v", last, err)
	}
	zero := int64(0)
	untagged, _ := s.ListLinks(ctx, ListQuery{Tag: &zero})
	if untagged.Total != 3 {
		t.Fatal(untagged.Total)
	}
	for _, ids := range [][]int64{{0}, {-1}, {tag.ID, tag.ID}, {1, 2, 3, 4, 5, 6}, {9999}} {
		l := newLink("invalid", "https://example.com", 100)
		l.Tags = ids
		if err := s.CreateLink(ctx, l, true); !errors.Is(err, ErrTagsInvalid) {
			t.Fatalf("accepted %v: %v", ids, err)
		}
		if _, err := s.Resolve(ctx, "invalid"); !errors.Is(err, ErrNotFound) {
			t.Fatalf("partial insert: %v", err)
		}
	}
	_, err = s.w.Exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<999) INSERT INTO tags (name,name_key,color) SELECT 't'||x,'t'||x,'blue' FROM n`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateTag(ctx, "full", "blue"); !errors.Is(err, ErrTagLimit) {
		t.Fatal(err)
	}
	if _, err := s.CreateTag(ctx, tag.Name, "blue"); err != nil {
		t.Fatal(err)
	}
}
