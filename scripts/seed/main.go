// Command seed fills a Sani database with believable demo data: links of
// different ages and states, two months of daily clicks and referrers, and
// real favicons. It is used for screenshots and for trying Sani out.
//
//	go run ./scripts/seed -data ./data -password sani-demo
package main

import (
	"context"
	crand "crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"math"
	"math/rand/v2"
	"mime"
	"os"
	"path/filepath"
	"time"

	"github.com/DejavuMoe/sani/internal/auth"
	"github.com/DejavuMoe/sani/internal/clicks"
	"github.com/DejavuMoe/sani/internal/links"
	"github.com/DejavuMoe/sani/internal/meta"
	"github.com/DejavuMoe/sani/internal/store"
)

type demo struct {
	slug    string
	url     string
	title   string
	age     int     // days since creation
	rate    float64 // typical clicks per day
	burst   int     // days ago a burst happened; 0 for none
	refs    map[string]float64
	expired bool
	off     bool
	limit   int64
	lastAgo time.Duration

	// A shared text or file instead of a destination URL.
	text   string
	code   bool
	file   string
	fileOf func() []byte
}

const nginxConf = `server {
    listen 443 ssl;
    server_name s.example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`

// demoPDF is a small, valid PDF with one page of text.
func demoPDF() []byte {
	body := "BT /F1 18 Tf 72 720 Td (Sani design review, v3) Tj ET"
	objs := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(body), body),
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	}
	out := []byte("%PDF-1.4\n")
	offsets := make([]int, len(objs))
	for i, o := range objs {
		offsets[i] = len(out)
		out = fmt.Appendf(out, "%d 0 obj\n%s\nendobj\n", i+1, o)
	}
	xref := len(out)
	out = fmt.Appendf(out, "xref\n0 %d\n0000000000 65535 f \n", len(objs)+1)
	for _, off := range offsets {
		out = fmt.Appendf(out, "%010d 00000 n \n", off)
	}
	return fmt.Appendf(out, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objs)+1, xref)
}

var social = map[string]float64{"": 0.42, "t.co": 0.18, "weibo.com": 0.12, "github.com": 0.1, "google.com": 0.08, "news.ycombinator.com": 0.06, "v2ex.com": 0.04}

var demos = []demo{
	{slug: "gh", url: "https://github.com/DejavuMoe/sani", title: "DejavuMoe/sani: A small, fast link shortener you host yourself", age: 58, rate: 38, burst: 21, refs: social, lastAgo: 4 * time.Minute},
	{slug: "blog", url: "https://dejavu.moe/", title: "Dejavu’s Blog", age: 57, rate: 22, refs: map[string]float64{"": 0.55, "google.com": 0.2, "t.co": 0.15, "bing.com": 0.1}, lastAgo: 26 * time.Minute},
	{slug: "简历", url: "https://dejavu.moe/resume", title: "简历 · 工作经历与项目", age: 44, rate: 3, refs: map[string]float64{"": 0.8, "linkedin.com": 0.2}, lastAgo: 5 * time.Hour},
	{slug: "weekly-42", url: "https://mp.weixin.qq.com/s/Qm7rXk2pLwE9aZ3cVb8Nfg", title: "周刊第 42 期：把长期主义当作一种工程习惯", age: 9, rate: 64, burst: 8, refs: map[string]float64{"": 0.7, "weibo.com": 0.18, "douban.com": 0.12}, lastAgo: 2 * time.Minute},
	{slug: "nginx-conf", text: nginxConf, code: true, title: "Nginx 反向代理配置", age: 4, rate: 6, refs: map[string]float64{"": 0.7, "github.com": 0.3}, lastAgo: 3 * time.Hour},
	{file: "Sani 设计评审 v3.pdf", fileOf: demoPDF, age: 2, rate: 4, limit: 50, refs: map[string]float64{"": 1}, lastAgo: 90 * time.Minute},
	{slug: "", url: "https://www.figma.com/design/7f3Kd92/Onboarding-Flow?node-id=12-345&t=Xy8", title: "Onboarding Flow – Figma", age: 12, rate: 5, refs: map[string]float64{"": 0.9, "slack.com": 0.1}, lastAgo: 50 * time.Minute},
	{slug: "", url: "https://arxiv.org/abs/2409.01234", title: "Scaling Laws for Retrieval-Augmented Language Models", age: 27, rate: 9, burst: 25, refs: map[string]float64{"": 0.35, "t.co": 0.4, "news.ycombinator.com": 0.25}, lastAgo: 3 * time.Hour},
	{slug: "talk", url: "https://www.youtube.com/watch?v=R7tq3-GvhlQ", title: "GopherCon 2026 — Designing for the Hot Path", age: 40, rate: 11, refs: social, expired: true, lastAgo: 9 * 24 * time.Hour},
	{slug: "", url: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjK/edit#gid=0", title: "Q3 预算（草稿）", age: 33, rate: 2, refs: map[string]float64{"": 1}, off: true, lastAgo: 12 * 24 * time.Hour},
	{slug: "beta", url: "https://testflight.apple.com/join/Ab3dEf9h", title: "Join the Sani iOS beta – TestFlight", age: 6, rate: 12, refs: map[string]float64{"": 0.6, "t.co": 0.4}, limit: 60, lastAgo: 7 * time.Hour},
	{slug: "", url: "https://news.ycombinator.com/item?id=41234567", title: "", age: 3, rate: 7, refs: map[string]float64{"": 0.3, "news.ycombinator.com": 0.7}, lastAgo: 40 * time.Minute},
	{slug: "rfc", url: "https://www.rfc-editor.org/rfc/rfc9110.html#name-redirection-3xx", title: "RFC 9110: HTTP Semantics", age: 21, rate: 1.2, refs: map[string]float64{"": 0.6, "google.com": 0.4}, lastAgo: 30 * time.Hour},
	{slug: "", url: "https://www.bilibili.com/video/BV1xK4y1m7aB", title: "【开发者日常】我为什么又写了一个短链接服务", age: 1, rate: 30, refs: map[string]float64{"": 0.5, "bilibili.com": 0.3, "weibo.com": 0.2}, lastAgo: time.Minute},
}

// share turns l into a text or file link when the demo is one, writing the
// file where the server keeps uploads.
func share(l *store.Link, d demo, dataDir string) error {
	switch {
	case d.text != "":
		l.Kind = store.KindText
		l.Content = &store.Content{Name: links.TextPreview(d.text), Size: int64(len(d.text)), Lines: links.TextLines(d.text), Text: d.text}
		if d.code {
			l.Content.Format = store.FormatCode
		}
	case d.file != "":
		data := d.fileOf()
		var id [16]byte
		crand.Read(id[:])
		name := hex.EncodeToString(id[:])
		dir := filepath.Join(dataDir, "files")
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dir, name), data, 0o640); err != nil {
			return err
		}
		sum := sha256.Sum256(data)
		l.Kind = store.KindFile
		l.Content = &store.Content{Name: d.file, Type: mime.TypeByExtension(filepath.Ext(d.file)), Size: int64(len(data)), SHA256: sum[:], File: name}
	default:
		return nil
	}
	l.Meta = store.MetaManual
	if d.slug == "" {
		l.Slug = links.Generate(10)
	}
	return nil
}

// poisson draws a count with mean lambda.
func poisson(r *rand.Rand, lambda float64) int64 {
	if lambda <= 0 {
		return 0
	}
	if lambda > 30 {
		return max(0, int64(math.Round(lambda+math.Sqrt(lambda)*r.NormFloat64())))
	}
	l, k, p := math.Exp(-lambda), int64(0), 1.0
	for {
		p *= r.Float64()
		if p <= l {
			return k
		}
		k++
	}
}

func main() {
	dataDir := flag.String("data", "data", "data directory")
	password := flag.String("password", "sani-demo", "admin password to set")
	icons := flag.Bool("icons", true, "fetch real favicons for the demo hosts")
	base := flag.String("base", "", "short domain to show, e.g. https://s.example.com")
	flag.Parse()

	ctx := context.Background()
	if err := os.MkdirAll(*dataDir, 0o750); err != nil {
		log.Fatal(err)
	}
	st, err := store.Open(ctx, filepath.Join(*dataDir, "sani.db"))
	if err != nil {
		log.Fatal(err)
	}
	defer st.Close()
	if err := st.SetSetting(ctx, store.SettingPassword, auth.HashPassword(*password)); err != nil {
		log.Fatal(err)
	}
	if *base != "" {
		if err := st.SetSetting(ctx, store.SettingBaseURL, *base); err != nil {
			log.Fatal(err)
		}
	}

	r := rand.New(rand.NewPCG(2026, 9))
	now := time.Now()
	today, _, _ := clicks.DayBounds(now, time.Local)
	hosts := map[string]string{}

	// Oldest first, so the newest demo link is also the newest row.
	for i := len(demos) - 1; i >= 0; i-- {
		d := demos[i]
		created := now.Add(-time.Duration(d.age)*24*time.Hour - time.Duration(r.IntN(600))*time.Minute)
		if d.age == 1 {
			created = now.Add(-5 * time.Hour)
		}
		l := &store.Link{
			Slug:      d.slug,
			URL:       d.url,
			Host:      links.FetchHost(d.url),
			Title:     d.title,
			Meta:      store.MetaOK,
			Redirect:  302,
			Enabled:   !d.off,
			MaxClicks: d.limit,
			CreatedAt: created.UnixMilli(),
			UpdatedAt: created.UnixMilli(),
		}
		if d.title == "" {
			l.Meta = store.MetaFailed
		}
		if d.expired {
			l.ExpiresAt = now.Add(-8 * 24 * time.Hour).UnixMilli()
		}
		if l.Slug == "" {
			l.Slug = links.Generate(5)
		}
		if err := share(l, d, *dataDir); err != nil {
			log.Fatal(err)
		}
		if err := st.CreateLink(ctx, l, true); err != nil {
			log.Fatalf("create %s: %v", d.url, err)
		}
		if l.Host != "" {
			hosts[l.Host] = d.url
		}

		batch := &store.ClickBatch{Links: map[int64]store.LinkDelta{}, Days: map[store.DayKey]int64{}, Refs: map[store.RefKey]int64{}}
		var total int64
		for ago := d.age; ago >= 0; ago-- {
			day := today - int32(ago)
			if d.expired && ago < 8 {
				continue
			}
			if d.off && ago < 12 {
				continue
			}
			wd := time.Unix(int64(day)*86400, 0).UTC().Weekday()
			lambda := d.rate
			if wd == time.Saturday || wd == time.Sunday {
				lambda *= 0.62
			}
			// A new link starts strong and settles.
			lambda *= 1 + 1.4*math.Exp(-float64(d.age-ago)/3)
			if d.burst > 0 && ago <= d.burst {
				lambda *= 1 + 5*math.Exp(-float64(d.burst-ago)/1.6)
			}
			n := poisson(r, lambda)
			if ago == 0 {
				n = int64(float64(n) * float64(now.Hour()+1) / 24)
			}
			if d.limit > 0 && total+n > d.limit {
				n = d.limit - total
			}
			if n <= 0 {
				continue
			}
			total += n
			batch.Days[store.DayKey{LinkID: l.ID, Day: day}] = n
		}
		for host, share := range d.refs {
			if n := int64(math.Round(float64(total) * share)); n > 0 {
				batch.Refs[store.RefKey{LinkID: l.ID, Host: host}] = n
			}
		}
		batch.Links[l.ID] = store.LinkDelta{Count: total, Last: now.Add(-d.lastAgo).UnixMilli()}
		if err := st.ApplyClicks(ctx, batch); err != nil {
			log.Fatal(err)
		}
		fmt.Printf("  /%-12s %6d clicks  %s\n", l.Slug, total, d.url)
	}

	if *icons {
		f := meta.New()
		for host, u := range hosts {
			cctx, cancel := context.WithTimeout(ctx, 12*time.Second)
			candidates := meta.FallbackIcons(u)
			if p, err := f.Page(cctx, u, "zh-CN,zh;q=0.9,en;q=0.8"); err == nil {
				candidates = append(p.Icons, candidates...)
			}
			for _, c := range candidates {
				if ct, data, err := f.Icon(cctx, c); err == nil {
					st.PutFavicon(ctx, host, &store.Favicon{Type: ct, Data: data, FetchedAt: now.UnixMilli()})
					fmt.Printf("  icon %s (%s, %d bytes)\n", host, ct, len(data))
					break
				}
			}
			cancel()
		}
	}
	fmt.Printf("\nSeeded %d links. Sign in with the password %q.\n", len(demos), *password)
}
