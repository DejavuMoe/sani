# Architecture

<p class="lead">Sani is one Go process that serves redirects, the JSON API and the admin app, with its data in one SQLite file. The whole design follows from one goal: redirects must be fast, whatever else is going on.</p>

## Where a request goes

<ArchDiagram />

## Routes

| Path | Handled by |
|---|---|
| `/` | A redirect to `SANI_ROOT_REDIRECT`, `/admin/` by default |
| `/admin/…` | The embedded admin app, a single-page app |
| `/api/…` | The [JSON API](../reference/api) |
| `/p/…` | The pages of [shared texts and files](../guide/usage#shares) |
| `/healthz` | Health check, answers `ok` |
| `/robots.txt` | Asks search engines to stay out of `/admin/`, `/api/` and `/p/` |
| `/favicon.ico` and friends | The admin app’s icons |
| Everything else | Short links |

A request for the [files domain](../reference/configuration#sani-files-url) is told apart by its host before any of these, and only ever reaches the handler that serves shared bytes.

## The hot path

`internal/server/redirect.go` handles `/{slug}`. A redirect goes through:

1. **Request checks.** Only `GET` and `HEAD` are accepted. A trailing `/` is dropped, and paths that can’t be a slug get a 404 without even touching the cache.
2. **The lookup key.** Unicode normalization (NFC) and lowercasing, so `/GitHub` matches `/github`, and the same word typed with different input methods matches too.
3. **The cache.** It’s split into 64 shards with a read-write lock each. A hit is one map lookup under a read lock. Slugs known not to exist are cached too and get a 404 right away.
4. **A cache miss.** One query on the reader pool, and the result goes into the cache. Concurrent misses for the same slug share that one query. If an edit invalidated the cache while the query ran, the result is still served but not cached, so stale data never sticks.
5. **Link state.** Turned off, expired, visit limit used up? The visit count is an atomic counter on the cache entry.
6. **Counting.** A request that [counts as a click](../guide/statistics#counted) hands it to the click aggregator: an in-memory increment that never waits for a write.
7. **The response.** Append the query string, set `Location` and `Cache-Control`, and send the redirect status.

The 404 and 410 pages are rendered for each language at startup and split where the short link goes, so sending one takes three writes. When something scans for random paths, an error page costs about as little as a redirect.

## Where clicks go

`internal/clicks` spreads clicks over 32 shards by link ID. For each link it keeps the running total, the time of the last visit, clicks per day and clicks per referring site.

Every 2 seconds the aggregator takes everything out of the shards and writes it to SQLite as one batch in **one transaction**: link totals and last-visit times in `links`, and additions to `clicks_daily` and `referrers`. If the write fails, the batch goes back into memory for the next attempt.

Between taking the clicks out and the commit, they still count in the numbers the API returns, so the admin app never shows a dip. When Sani stops, the HTTP server stops accepting requests first, then the last batch is written.

## The database

SQLite comes from [modernc.org/sqlite](https://gitlab.com/cznic/sqlite), a pure Go implementation. Without cgo the binary links statically, and the image can be `FROM scratch`.

- **WAL mode**, so reads never wait for writes.
- **One writer connection**: writes queue up instead of fighting over locks, and transactions start with `BEGIN IMMEDIATE`.
- **A pool of readers**, one per CPU core, at least 4.

| Table | Contents |
|---|---|
| `links` | Each link: kind, slug and lookup key, destination, title, settings, total clicks, last visit, deletion time |
| `contents` | What a text or file shares: a text’s body, format and line count, or a file’s name, type, SHA-256 and stored name |
| `clicks_daily` | Clicks per link per day |
| `referrers` | Clicks per link per referring site, at most 200 sites per link |
| `settings` | The password hash and the short domain from Settings |
| `sessions` | Sign-in sessions, stored as hashes of their secrets |
| `tokens` | API tokens, stored as hashes |
| `favicons` | Fetched site icons, one per host |

Shared files themselves are not in the database but in `files/` in the data directory, each under a random name; texts and files share the cache and click counting with links.

The schema version is kept in `PRAGMA user_version`. At startup, any upgrades not yet applied run in order, each in its own transaction.

## Background work

| Task | When | What |
|---|---|---|
| Writing clicks | Every 2 seconds | Writes the clicks in memory to the database as one batch |
| Purging deleted links | Every minute | Removes links deleted more than an hour ago, with their statistics |
| Purging sessions | Every hour | Removes expired sessions |
| Sweeping files | Every 10 minutes | Removes stored files no link refers to any more, and uploads that never finished |
| Fetching titles and icons | When links are created | At most 3 at a time, each for at most 20 seconds |

## Titles and icons

After a link is created, a background task fetches the destination: it reads at most 1 MB and follows at most 5 redirects. The request carries your browser’s language preferences, so titles usually come in the language you read.

- **Title.** The first of `og:title`, `twitter:title` and `<title>`. For files such as PDFs, the file name.
- **Icon.** Chosen from the icons the page declares: images close to 64 pixels and SVGs first, then `apple-touch-icon` and larger images, and `/favicon.ico` last, trying at most 4. An icon must be at most 256 KB, and its content must really be an image.
- **Reuse.** Icons are stored per host, so other links to the same site share them. An icon older than 30 days is fetched again the next time it’s needed; after a failure, Sani waits a day before trying again.

Fetches only ever reach public addresses; see [Security](./security#fetching).

## The admin app

The admin app is written in Svelte 5 and TypeScript and built with Vite, without UI or icon libraries. The build output is precompressed with Brotli and gzip and embedded in the binary with Go’s `embed`, and each browser gets the precompressed version it supports.

Assets with hashed file names are cached for a year; `index.html` is revalidated every time and carries a strict Content Security Policy.
