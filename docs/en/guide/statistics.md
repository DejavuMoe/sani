# Statistics

<p class="lead">Sani’s statistics are deliberately small: they answer “is anyone clicking this, when, and coming from where” without tracking the people who click. This page explains where each number comes from.</p>

## What is recorded

For each link:

- the **total clicks** and the **time of the last visit**;
- **clicks per day**, with days in the server’s time zone;
- **referring sites**: only the host from the `Referer` header (without `www.`), never the full address. Visits without a `Referer` count as “Direct”.

Across all links: the number of links, total clicks, clicks today, and clicks on each of the last 30 days.

## What isn’t

Visitors’ IP addresses, User-Agents, full referrer addresses and the time of each individual visit are never stored, and Sani sets no cookies for visitors. The database only holds aggregated counts, never a row per visit, so there’s no personal data about visitors to protect, and the database doesn’t grow with traffic.

## What counts as a click {#counted}

A click is someone opening the short link in a browser. These requests are redirected as usual but not counted:

- `HEAD` requests, and browser prefetches and prerenders (with a `Sec-Purpose` or `Purpose: prefetch` header);
- search engine crawlers, link previews from social and chat apps, monitoring services and headless browsers;
- command-line tools and HTTP libraries, such as curl, wget, and clients from Python, Go, Java or Node.js;
- requests without a User-Agent;
- links opened from Sani’s own admin app, so your testing doesn’t skew the numbers;
- Sani’s own title fetcher (say, when a short link points to another Sani instance).

Crawlers and previews are recognized by words in the User-Agent, such as `bot`, `spider`, `crawl`, `preview` and `facebookexternalhit`. The full list is in `internal/server/redirect.go`.

## Texts and files {#shares}

For a [text or file](./usage#shares), a visit is someone getting the content, and the same rules apply, with one difference:

- **A text** counts when its page at `/p/{slug}` opens, and again for each fetch of its raw text or download from the files domain.
- **A file** counts when it’s downloaded from the files domain, not when its page opens; the details call these Downloads.
- **On the files domain, curl and wget count.** They are how people download files, so there they’re treated as visitors; crawlers, previews, prefetches and `HEAD` requests still don’t count. Each GET that starts a successful `200` or `206` content response counts, including later ranges and suffix ranges. `304`, `412`, `416` and file-open failures do not count. Once a successful response starts, a disconnected client does not refund the visit; the count does not prove the client saved the complete file.

The referrer of a raw text or a download is usually “Direct”, since the share page sends no `Referer`.

## How visit limits count {#visit-limits}

On a link with a visit limit, only visits that count toward the statistics use it up, so crawlers and link previews can’t exhaust it. Once it’s used up, every request, counted or not, gets the 410 page.

Concurrent requests and cache replacements share an atomic counter for each link, so one running instance stops at the limit. Crawler detection relies on forgeable headers: visit limits are a counting rule, not authentication or a confidentiality control. Do not use them to protect secrets or run multiple writers against the same data directory.

For a text, opening its page and fetching the raw text are separate visits: a text limited to one visit can be read on its page, but its Raw button then gets a 410. A file limited to 3 visits can be downloaded 3 times; when 32 downloads are already running, a new one is turned away with a 503 before it uses up a visit.

## How current the numbers are

Clicks accumulate in memory and normally flush every 2 seconds. Link totals use a live counter or a committed database snapshot, without adding the same batch twice. List sparklines, daily counts, referrers and the last-visit time use committed data and may lag. Statistics, overview and export first attempt a flush; a failure is logged and the response can still contain older statistics. Separate requests or queries under concurrent traffic do not promise one shared point-in-time snapshot.

Normal shutdown attempts a final flush within a deadline and exits nonzero on failure. A forced exit after persistent write failures loses the whole backlog; power loss can also affect recently committed SQLite WAL/NORMAL transactions. Two seconds is a scheduling interval, not a maximum loss window. See [Operations](./operations).

## Time zone

“Today” and the daily counts follow the time zone of the Sani process, set with the `TZ` environment variable. The Docker image uses UTC unless you set `TZ`, so set it when you deploy, for example `TZ=Europe/Berlin`.

The database stores dates, not instants. Changing `TZ` later doesn’t redistribute past clicks; new clicks follow the new zone.

## Referring sites

- The `Referer` header comes from the visitor’s browser, and anyone can forge it. To keep fake referrers from bloating the database, each link stores at most 200 distinct referring sites; any site after that counts as “Other sites”.
- Many apps and browsers don’t send a `Referer` for privacy reasons, and browsers never send one from an HTTPS page to an HTTP address, so “Direct” is often the biggest entry. That’s normal.
- The details show the top 8 referrers. Shares are relative to all clicks with referrer data; imported click counts have none, so they’re not included.

## Why the numbers may be lower than you expect

- **Permanent redirects are cached.** Unlimited 301/308 redirects allow one day of browser caching, so repeat visits skip Sani. Since v0.8.0, redirects with expiry or a visit limit send `no-store`, but cannot recall previously cached responses. For links where counting matters, keep the default 302 and [bypass CDN caching of dynamic content](./deploy#cdn-cache).
- **Previews don’t count.** When you post a link in a chat app or on social media, the platform usually fetches it once for the preview. Common platforms’ fetchers are recognized and not counted.
- **Your own clicks don’t count.** Links opened from the admin app are left out.

## Why there are no more statistics

Location, device, browser and UTM breakdowns all require keeping details of every visit. That would turn Sani into a visitor-tracking system with privacy obligations, and a database that grows with every visit. Sani doesn’t do it. If you need those numbers, use your own analytics on the destination pages: short links pass `utm_*` parameters and other query strings straight through.
