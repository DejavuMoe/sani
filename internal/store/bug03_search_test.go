package store

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func TestBUG03UnicodeSearch(t *testing.T) {
	ctx := context.Background()
	s := open(t)
	var titles []*Link
	for i, title := range []string{"ÉCOLE", "école", "ÉcOlE", "E\u0301COLE"} {
		l := newLink(fmt.Sprintf("title-%d", i), "https://example.invalid/resource", int64(i+1))
		l.Title, l.Meta = title, MetaManual
		titles = append(titles, l)
	}
	slug := newLink("cafe\u0301", "https://example.invalid/other", 5)
	path := newLink("url-case", "https://example.invalid/ÜBER", 6)
	file := newLink("file-case", "", 7)
	file.Kind, file.Content = KindFile, &Content{Name: "RÉSUMÉ.pdf", File: "fixture", Type: "application/pdf"}
	text := newLink("text-case", "", 8)
	text.Kind, text.Content = KindText, &Content{Name: "ΑΘΉΝΑ", Text: "ΑΘΉΝΑ\nNot searched", Lines: 2}
	literal := newLink("literal", "https://example.invalid/literal", 9)
	literal.Title = `ÉCOLE 100%_\literal`
	sigma := newLink("greek-case", "https://example.invalid/greek", 10)
	sigma.Title = "ΟΣ"
	dotted := newLink("dotted-case", "https://example.invalid/dotted", 11)
	dotted.Title = "İB"
	for _, l := range append(append([]*Link{}, titles...), slug, path, file, text, literal, sigma, dotted) {
		if err := s.CreateLink(ctx, l, false); err != nil {
			t.Fatal(err)
		}
	}
	for _, tt := range []struct {
		name, query string
		want        []*Link
	}{
		{"exact title", "ÉCOLE", append(append([]*Link{}, titles...), literal)},
		{"mixed title", "éCoLe", append(append([]*Link{}, titles...), literal)},
		{"decomposed title", "E\u0301COLE", append(append([]*Link{}, titles...), literal)},
		{"composed slug", "CAFÉ", []*Link{slug}},
		{"decomposed slug", "CAFE\u0301", []*Link{slug}},
		{"URL path", "über", []*Link{path}},
		{"filename", "résumé", []*Link{file}},
		{"text first line", "αθήνα", []*Link{text}},
		{"Greek uppercase sigma", "ΟΣ", []*Link{sigma}},
		{"Greek lowercase sigma", "οσ", []*Link{sigma}},
		{"Greek final sigma stays distinct", "ος", nil},
		{"dotted I uppercase", "İB", []*Link{dotted}},
		{"dotted I simple lowercase", "ib", []*Link{dotted}},
		{"dotted I decomposed query", "I\u0307B", []*Link{dotted}},
		{"lowercase combining dot stays distinct", "i\u0307b", nil},
		{"percent is literal", "%", []*Link{literal}},
		{"underscore is literal", "_", []*Link{literal}},
		{"backslash is literal", `\`, []*Link{literal}},
		{"combined literals", `école 100%_\`, []*Link{literal}},
		{"body beyond first line", "Not searched", nil},
		{"not found", "école_", nil},
	} {
		t.Run(tt.name, func(t *testing.T) {
			for _, sort := range []string{"created", "clicks", "visited"} {
				q := ListQuery{Search: tt.query, Sort: sort, Limit: 1}
				seen := map[int64]bool{}
				for page := 0; ; page++ {
					if page > len(tt.want) {
						t.Fatal("pagination did not terminate")
					}
					res, err := s.ListLinks(ctx, q)
					if err != nil {
						t.Fatal(err)
					}
					if res.Total != int64(len(tt.want)) || len(res.Links) > 1 {
						t.Fatalf("sort=%s page=%d total=%d items=%d; want total=%d and at most one item", sort, page, res.Total, len(res.Links), len(tt.want))
					}
					for _, l := range res.Links {
						if seen[l.ID] {
							t.Fatalf("duplicate ID %d across pages", l.ID)
						}
						seen[l.ID] = true
					}
					if res.Next == nil {
						break
					}
					q.After = res.Next
				}
				if len(seen) != len(tt.want) {
					t.Fatalf("sort=%s listed %d unique IDs, want %d", sort, len(seen), len(tt.want))
				}
				for _, l := range tt.want {
					if !seen[l.ID] {
						t.Errorf("sort=%s missing ID %d", sort, l.ID)
					}
				}
			}
		})
	}
}

func TestBUG03LongSearchIsBounded(t *testing.T) {
	ctx := context.Background()
	s := open(t)
	if err := s.CreateLink(ctx, newLink("ordinary", "https://example.invalid/", 1), false); err != nil {
		t.Fatal(err)
	}
	res, err := s.ListLinks(ctx, ListQuery{Search: strings.Repeat("É", 100_000), Limit: 1})
	if err != nil {
		t.Fatalf("oversized literal search must return an empty result, not a SQL pattern error: %v", err)
	}
	if res.Total != 0 || len(res.Links) != 0 || res.Next != nil {
		t.Fatalf("oversized unmatched query = %+v", res)
	}
}
