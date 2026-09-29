# Changelog

<p class="lead">Every release’s changes are recorded here. Versions follow semantic versioning; before 1.0, a minor version may include breaking changes, and when it does, this page says how to upgrade.</p>

## v0.1.0

2026-09-29 · The first version: feature-complete, without published images or binaries yet.

### Redirects and statistics

- Redirect targets are cached in memory across 64 shards; unknown slugs are cached separately and bounded; concurrent misses for the same slug share one database query.
- Clicks are aggregated in memory and written to SQLite every 2 seconds in one transaction, with the remainder written at shutdown.
- Total and daily clicks, referring sites and the last visit. `HEAD` requests, prefetches, crawlers, link previews, command-line tools and clicks from the admin app don’t count.
- Every link can have an expiry, a visit limit and a redirect type (301, 302, 307, 308), and can be turned off.
- Slugs can use letters and digits of any language and ignore case; generated slugs avoid look-alike characters.
- Visitors’ query strings are passed on to destinations by default.
- The 404 and 410 pages follow the visitor’s language, English or Chinese.

### Admin app

- Paste or drop a link anywhere on the page to shorten it; the result is copied automatically.
- Page titles and site icons are fetched automatically.
- The list has search, three sort orders and a 14-day activity line; details show daily clicks, top referrers and a QR code (PNG, SVG).
- Everything works from the keyboard, and deleting can be undone.
- A bookmarklet, and the Android share menu once the app is added to the home screen.
- English and Chinese, light and dark themes, and a layout for phones.

### API and data

- A JSON API covering everything the admin app does, with API tokens.
- Export to JSON or CSV; import from Sani, Shlink, Sink and CSV files without overwriting existing slugs.

### Deployment and operations

- One statically linked binary with the admin app inside; a Docker image built `FROM scratch`, about 24 MB.
- Configuration through `SANI_*` environment variables, checked at startup.
- The first password requires the setup code from the log, or can be set with `SANI_PASSWORD`.
- `sani backup` for online backups, including to standard output; `sani passwd` to reset the password; `sani healthcheck` for container health checks.
- Example configurations for Docker Compose, systemd, Caddy and nginx.

### Security

- argon2id passwords; sessions and tokens stored as hashes; sign-in and setup rate-limited per client.
- Cross-site requests are refused, and the admin app runs under a strict Content Security Policy.
- Title and icon fetches only reach public addresses, checked after DNS resolution and again when connecting.

### Documentation

- An English and Chinese documentation site with a deployment config builder, a live demo and a performance chart.
- Settings, API, error codes, commands, reserved slugs and benchmark figures are checked against the source at build time.
