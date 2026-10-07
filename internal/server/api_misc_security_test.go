package server

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/DejavuMoe/sani/internal/links"
	"github.com/DejavuMoe/sani/internal/store"
)

func TestCSVFormulaExportAndJSONRoundTrip(t *testing.T) {
	source := newEnv(t, Options{})
	source.signIn()
	cases := []struct {
		title   string
		escaped bool
	}{
		{"=1+1", true}, {"+1+1", true}, {"-1+1", true}, {"@SUM(1,1)", true},
		{"\t=1+1", true}, {"\r=1+1", true}, {"\n=1+1", true}, {" \tplain", true},
		{"  =1+1", true}, {"\u00a0=1+1", true}, {"\ufeff=1+1", true},
		{"＝1+1", true}, {"＋1+1", true}, {"－1+1", true}, {"＠SUM(1,1)", true},
		{"'=1+1", false}, {"''literal", false}, {"'ordinary", false},
		{"=\"a,b\"\n+1", true}, {"normal, \"quoted\"; =text", false}, {"中文标题", false}, {"", false},
	}
	ctx := context.Background()
	for i, tc := range cases {
		l := &store.Link{
			Slug: fmt.Sprintf("csv%d", i), URL: "https://example.com/csv", Title: tc.title,
			Redirect: 302, Enabled: true, Meta: store.MetaManual,
			Clicks: 1<<53 + 1 + int64(i), MaxClicks: math.MaxInt64, CreatedAt: 1000, UpdatedAt: 1000,
		}
		if err := source.srv.store.CreateLink(ctx, l, false); err != nil {
			t.Fatal(err)
		}
	}
	exported := source.req("GET", "/api/export?format=csv", nil)
	if exported.status != http.StatusOK {
		t.Fatalf("export: %d %s", exported.status, exported.body)
	}
	rows, err := csv.NewReader(bytes.NewReader(exported.body)).ReadAll()
	if err != nil || len(rows) != len(cases)+1 {
		t.Fatalf("CSV rows: %d, %v", len(rows), err)
	}
	if got := strings.Join(rows[0], ","); got != "slug,url,title,redirect,enabled,expires_at,max_clicks,clicks,created_at,tags" {
		t.Fatalf("CSV header changed: %s", got)
	}
	records, err := parseCSVRecords(exported.body)
	if err != nil {
		t.Fatal(err)
	}
	for i, tc := range cases {
		row := rows[i+1]
		want := tc.title
		if tc.escaped {
			want = "'" + want
		}
		if row[0] != fmt.Sprintf("csv%d", i) || row[2] != want {
			t.Errorf("unsafe/changed CSV row %d: %q", i, row)
		}
		if records[i]["title"] != want || records[i]["slug"] != row[0] {
			t.Errorf("CSV import removed protection from row %d: %q", i, records[i])
		}
	}

	// JSON stays a portable, unescaped backup, including integers above 2^53.
	var doc struct {
		Links []exportLink `json:"links"`
	}
	jsonExport := source.req("GET", "/api/export", nil)
	if err := json.Unmarshal(jsonExport.body, &doc); err != nil || len(doc.Links) != len(cases) {
		t.Fatalf("JSON export: %s, %v", jsonExport.body, err)
	}
	for i, tc := range cases {
		if doc.Links[i].Title != tc.title || doc.Links[i].Clicks != 1<<53+1+int64(i) {
			t.Errorf("JSON export changed row %d: %+v", i, doc.Links[i])
		}
	}
	target := newEnv(t, Options{})
	target.signIn()
	r := target.req("POST", "/api/import", string(jsonExport.body))
	if r.status != http.StatusOK || r.json()["created"] != float64(len(cases)) {
		t.Fatalf("import: %d %s", r.status, r.body)
	}
	all, err := target.srv.store.AllLinks(ctx)
	if err != nil || len(all) != len(cases) {
		t.Fatalf("imported rows: %d, %v", len(all), err)
	}
	for i, l := range all {
		if l.Slug != fmt.Sprintf("csv%d", i) || l.Title != links.CleanTitle(cases[i].title) ||
			l.Clicks != 1<<53+1+int64(i) || l.MaxClicks != math.MaxInt64 {
			t.Errorf("JSON round trip changed row %d: %+v", i, l)
		}
	}
}

func TestCSVLegacyApostrophesAreData(t *testing.T) {
	data := "slug,url,title\nlegacy,https://example.com,'=1+1\n"
	records, err := parseCSVRecords([]byte(data))
	if err != nil || len(records) != 1 || records[0]["title"] != "'=1+1" {
		t.Fatalf("legacy CSV changed: %v, %v", records, err)
	}
}

func TestJSONImportIntegerPrecision(t *testing.T) {
	for _, data := range []string{
		`[{"clicks":9223372036854775807,"maxClicks":9007199254740993}]`,
		`{"links":[{"clicks":9223372036854775807,"maxClicks":9007199254740993}]}`,
		`{"shortUrls":{"data":[{"visitsSummary":{"total":9223372036854775807},"meta":{"maxVisits":9007199254740993}}]}}`,
	} {
		records, err := parseJSONRecords([]byte(data))
		if err != nil || len(records) != 1 {
			t.Fatalf("parse %s: %v", data, err)
		}
		if pick(records[0], clicksFields) != "9223372036854775807" || pick(records[0], maxFields) != "9007199254740993" {
			t.Fatalf("rounded JSON integers: %v", records[0])
		}
	}
	records, err := parseJSONRecords([]byte(`[{"clicks":1e3,"maxClicks":1001.0}]`))
	if err != nil || len(records) != 1 || records[0]["clicks"] != "1000" || records[0]["maxclicks"] != "1001" {
		t.Fatalf("decimal/exponent compatibility: %v, %v", records, err)
	}
	if _, err := parseJSONRecords([]byte(`[{"clicks":1}] []`)); err == nil {
		t.Fatal("accepted trailing JSON")
	}
}

func TestImportedExtremeClicksRemainUsable(t *testing.T) {
	e := newEnv(t, Options{})
	e.signIn()
	for i, body := range []string{
		`[{"slug":"extreme","url":"https://example.com/extreme","clicks":9223372036854775807}]`,
		`[{"slug":"second","url":"https://example.com/second","clicks":"9223372036854775807"}]`,
		"slug,url,clicks\nthird,https://example.com/third,9007199254740993\n",
	} {
		r := e.req("POST", "/api/import", body)
		if r.status != http.StatusOK || r.json()["created"] != float64(1) {
			t.Fatalf("import %d: %d %s", i, r.status, r.body)
		}
		var totals struct{ Links, Clicks int64 }
		r = e.req("GET", "/api/overview", nil)
		if err := json.Unmarshal(r.body, &totals); err != nil || r.status != http.StatusOK ||
			totals.Links != int64(i+1) || totals.Clicks != math.MaxInt64 {
			t.Fatalf("overview after import %d: %d %s, %v", i, r.status, r.body, err)
		}
	}

	ctx := context.Background()
	target, err := e.srv.store.Resolve(ctx, "extreme")
	if err != nil {
		t.Fatal(err)
	}
	path := "/api/links/" + strconv.FormatInt(target.ID, 10)
	if r := e.visit("/extreme"); r.status != http.StatusFound {
		t.Fatalf("extreme redirect: %d %s", r.status, r.body)
	}
	// Check both the DTO and the actual admission counter before the flush.
	var dto struct {
		Clicks int64  `json:"clicks"`
		Status string `json:"status"`
	}
	r := e.req("GET", path, nil)
	if err := json.Unmarshal(r.body, &dto); err != nil || r.status != http.StatusOK || dto.Clicks != math.MaxInt64 {
		t.Errorf("DTO after click: %d %s, %v", r.status, r.body, err)
	}
	entry, err := e.srv.cache.Get(ctx, "extreme")
	if err != nil || entry == nil {
		t.Fatalf("cached target: %v, %v", entry, err)
	}
	if got := entry.Clicks.Load(); got != math.MaxInt64 {
		t.Errorf("admission counter wrapped: %d", got)
	}
	if err := e.srv.clicks.Flush(ctx); err != nil {
		t.Fatal(err)
	}
	l, err := e.srv.store.GetLink(ctx, target.ID)
	if err != nil || l.Clicks != math.MaxInt64 {
		t.Fatalf("persisted click is no longer an int64: %+v, %v", l, err)
	}
	for _, endpoint := range []string{path, path + "/stats", "/api/overview", "/api/export", "/api/export?format=csv"} {
		if r := e.req("GET", endpoint, nil); r.status != http.StatusOK {
			t.Errorf("unreadable after click, %s: %d %s", endpoint, r.status, r.body)
		}
	}
	var totals struct{ Links, Clicks int64 }
	r = e.req("GET", "/api/overview", nil)
	if err := json.Unmarshal(r.body, &totals); err != nil || totals.Links != 3 || totals.Clicks != math.MaxInt64 {
		t.Fatalf("overview after click and flush: %s, %v", r.body, err)
	}
	// A wrapped cached counter must not bypass a newly imposed click limit.
	r = e.req("PATCH", path, `{"maxClicks":1}`)
	if err := json.Unmarshal(r.body, &dto); err != nil || r.status != http.StatusOK || dto.Clicks != math.MaxInt64 || dto.Status != "exhausted" {
		t.Errorf("limited DTO: %d %s, %v", r.status, r.body, err)
	}
	if r := e.visit("/extreme"); r.status != http.StatusGone {
		t.Errorf("overflow bypassed click limit: %d %s", r.status, r.body)
	}
}

func TestCSVCellPrefixDetection(t *testing.T) {
	// Include whitespace before the marker and controls that CleanTitle does
	// not normalize, independently of the API's existing title normalization.
	for _, prefix := range []string{"", " ", "\t", "\r", "\n", "\x00", "\u200b", "\ufeff"} {
		for _, marker := range []string{"=", "+", "-", "@", "＝", "＋", "－", "＠"} {
			input := prefix + marker + "1"
			if got := escapeCSVCell(input); got != "'"+input || !strings.HasPrefix(got, "'") {
				t.Errorf("unescaped cell %q: %q", input, got)
			}
		}
	}
}
