package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

func TestCustomColorsMigrateExistingTags(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v4.db")
	db, err := sql.Open("sqlite", dsn(path, true))
	if err != nil {
		t.Fatal(err)
	}
	for _, migration := range migrations[:4] {
		if _, err := db.Exec(migration); err != nil {
			t.Fatal(err)
		}
	}
	_, err = db.Exec(`PRAGMA user_version=4;
	INSERT INTO links(id,slug,slug_key,url,created_at,updated_at) VALUES(12,'old','old','https://example.com',1,1);
	INSERT INTO tags(id,name,name_key,color) VALUES(42,'Work','work','blue');
	INSERT INTO link_tags VALUES(12,42,0);`)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	s, err := Open(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	l, err := s.GetLink(context.Background(), 12)
	if err != nil || len(l.Tags) != 1 || l.Tags[0] != 42 {
		t.Fatalf("lost association: %+v %v", l, err)
	}
	if _, err := s.UpdateTag(context.Background(), 42, "Work", "#ABCDEF"); err != nil {
		t.Fatal(err)
	}
	c, err := s.Tags(context.Background())
	if err != nil || len(c.Items) != 1 || c.Items[0].Color != "#abcdef" || c.Items[0].Count != 1 {
		t.Fatalf("migration: %+v %v", c, err)
	}
	if _, err := s.w.Exec(`UPDATE tags SET color='#zzzzzz' WHERE id=42`); err == nil {
		t.Fatal("database accepted invalid color")
	}
}
