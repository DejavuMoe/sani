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

## How visit limits count {#visit-limits}

On a link with a visit limit, only visits that count toward the statistics use it up, so crawlers and link previews can’t exhaust it. Once it’s used up, every request, counted or not, gets the 410 page.

The count is incremented atomically in memory, so even with many simultaneous visitors the link stops exactly at its limit.

## How current the numbers are

Clicks are added up in memory and written to the database every 2 seconds. The admin app and the API add the clicks still in memory, so what you see is always current. Opening a link’s statistics first writes all pending clicks.

When Sani stops normally, it writes the remaining clicks before exiting. If the process is killed outright or the machine loses power, at most the last 2 seconds of clicks are lost.

## Time zone

“Today” and the daily counts follow the time zone of the Sani process, set with the `TZ` environment variable. The Docker image uses UTC unless you set `TZ`, so set it when you deploy, for example `TZ=Europe/Berlin`.

The database stores dates, not instants. Changing `TZ` later doesn’t redistribute past clicks; new clicks follow the new zone.

## Referring sites

- The `Referer` header comes from the visitor’s browser, and anyone can forge it. To keep fake referrers from bloating the database, each link stores at most 200 distinct referring sites; any site after that counts as “Other sites”.
- Many apps and browsers don’t send a `Referer` for privacy reasons, and browsers never send one from an HTTPS page to an HTTP address, so “Direct” is often the biggest entry. That’s normal.
- The details show the top 8 referrers. Shares are relative to all clicks with referrer data; imported click counts have none, so they’re not included.

## Why the numbers may be lower than you expect

- **Permanent redirects are cached.** Browsers cache a 301 redirect for a day, and visits from that browser skip Sani in the meantime. For links where counting matters, keep the default temporary redirect.
- **Previews don’t count.** When you post a link in a chat app or on social media, the platform usually fetches it once for the preview. Common platforms’ fetchers are recognized and not counted.
- **Your own clicks don’t count.** Links opened from the admin app are left out.

## Why there are no more statistics

Location, device, browser and UTM breakdowns all require keeping details of every visit. That would turn Sani into a visitor-tracking system with privacy obligations, and a database that grows with every visit. Sani doesn’t do it. If you need those numbers, use your own analytics on the destination pages: short links pass `utm_*` parameters and other query strings straight through.
