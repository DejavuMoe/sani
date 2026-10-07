# Changelog

<p class="lead">Every release’s changes are recorded here. Versions follow [semantic versioning](./versioning); before 1.0, a minor version may include breaking changes, and when it does, this page says how to upgrade.</p>

## Unreleased

### Added

- Select or create colored tags when creating and editing URL, text and file shares. Filter by a tag or Untagged alongside search and type filters, with global tag counts. Desktop and mobile retain the existing layout; creation time stays in link details.
- Authenticated tag APIs and optional link tag assignments/filtering. JSON/CSV exports and imports preserve tag names, colors and assignments, and older exports still import.

### Database upgrade

- Startup automatically migrates to schema 4, adding `tags`, `link_tags` and a filter index. Existing links start untagged; link IDs, content and statistics are preserved.
- Stop the service cleanly and back up the database, `files/` and configuration before upgrading. To return to v0.4.0 or earlier, restore that complete pre-upgrade backup; old binaries cannot open schema 4. See [backup and restore](../guide/operations#backup).

### Fixed

- Fix the deployment builder rewriting download hostnames in nginx and Caddy configurations. Preserve the full input and check generated hostnames, environment variables and certificate paths during docs builds.
- Clarify that the main domain serves both short links and `/p/` share pages, while the download domain serves downloads and raw text. Update the builder hints, deployment guide and configuration reference in both languages.

## v0.4.0

2026-10-06 · Correct visit counting, persistence and shutdown behavior, and improve backup guidance and the documentation. Read “Breaking changes” first if you use file visit limits.

### Breaking changes

- Each successful `200`/`206` content GET that meets the [counting rules](../guide/statistics#counted) counts as a visit for files and raw text, including resumed, nonzero-start and suffix ranges. `304`, `412`, `416` and file-open failures do not consume visits. Raise or disable the visit limit for clients that use multiple ranges; retries after disconnects consume a new visit too.
- The database migrates to schema 3 with non-reused link IDs. Back up the database and files before first start. Downgrading requires the complete pre-upgrade backup; old binaries cannot open schema 3.

### Fixed

- Recreated links cannot inherit pending clicks from a deleted link’s reused ID.
- API totals do not double-count a committing batch; concurrent requests and replaced cache entries share the same allowance.
- Failed-batch merges keep referrers bounded while preserving accumulated clicks.
- Shutdown waits for requests and background work, gives the final flush its own deadline, and exits nonzero on failure. Deployment examples allow 30 seconds to stop.
- The demo seed script no longer prints passwords; design comparison scripts match literal slugs without interpreting them as regular expressions.

### Verification and documentation

- Add regressions for counting, conditional requests, migration, retries, shutdown and full backup restoration.
- Add a 1k/10k/100k capacity tool measuring latency percentiles, memory, SQLite waits, flushing and WAL; remove an unnecessary content-table join from unfiltered list counts.
- Correct online file-backup and two-second loss promises, distinguish live totals from committed aggregates, and check version consistency and critical documentation semantics.
- Update docs and design-tool build dependencies and audit JavaScript dependencies in CI.
- Normalize spaces around prose links, emphasis and inline code, wrap long inline code on small screens, and match thin scrollbars to both themes; simplify the home page and mark the hosted docs as live.
- Fix the `source-map-js` build dependency vulnerability, update SQLite and build tools, and add CodeQL checks for Go, JavaScript/TypeScript, Python and GitHub Actions.
- Use Ubuntu 24.04 for CI, code scanning and releases; pin mise and remove warnings caused by stale toolchain caches and duplicate Go cache restoration.

### Upgrading

1. Before upgrading from v0.3.1 or earlier, stop every Sani instance and confirm a clean exit, then back up the full data directory and current configuration. With file shares, the database and `files/` must come from the same stopped-service interval; see [paired backups](../guide/operations#backup-files).
2. Review visit limits for files and raw text. Resumed downloads, multiple ranges and retries after disconnects can consume several visits; raise or disable the limit as appropriate.
3. Update the binary or image and start Sani. The database migrates automatically to schema 3. Configuration options and HTTP API data structures are unchanged; check health, login, existing short links, file downloads and statistics.
4. To downgrade, stop the new version, restore the complete pre-upgrade backup into an empty directory or new volume, and then run the old version. Do not open the migrated database with an old binary or mix database and file snapshots taken at different times.

## v0.3.1

2026-10-05 · Fixes to the admin app's layout, feedback and accessibility.

### Improved

- When editing a link, every field, the redirect choice and the enabled switch share one height, and the slug field no longer collapses.
- Pick, kind and sort sit together at the top right of the list, and a small arrow marks the column it is sorted by.
- In a link's details, the last visit sits on the same baseline as the figures beside it, and today's bar in the chart is lighter, since the day isn't over.
- Code previews use the text color instead of a gray that looked disabled.
- On first run, the empty list shows a few fading outline rows above its message.
- Several toasts line up in one column.
- When creating a link, the custom slug field grows with what you type, so long slugs stay visible.
- Accessibility: the “available” slug status meets AA contrast, the offline and new-link pages have a top-level heading, screen readers announce the list while it loads, and the curl example in Settings can be scrolled by keyboard on phones.

### Maintenance

- The repository's default branch is now `master`. CI and links to source and deployment files in the documentation follow it. If you follow updates from source, switch to `master`.

### Upgrading

Upgrading from v0.3.0 requires no configuration changes. The database schema and HTTP API are unchanged.

## v0.3.0

2026-10-01 · Texts and files: share a note, a piece of code or a file from the same dashboard. If you script against the API, read “Breaking changes” first.

### New

- **Texts and files.** The Text and File tabs above the link box share a text, as plain text or monospace code with line numbers, or a file up to 64 MB. Paste a block of text or a file anywhere on the page to start. Visitors open them at `/p/{slug}`, where they can read, copy or download; expiry, visit limits, the off switch and statistics work as for links. See [Everyday use](../guide/usage#shares).
- **A files domain.** Raw text and file downloads come from a second domain set with [`SANI_FILES_URL`](../reference/configuration#sani-files-url), pointed at the same Sani, which serves nothing else and holds no session. Sharing files needs it; texts work without it. [`SANI_MAX_FILE_MB`](../reference/configuration#sani-max-file-mb) sets the size limit. [Deployment](../guide/deploy#files-domain) has the proxy configuration.
- Downloads from the files domain count as visits even from `curl` and `wget`, which is how people fetch files; resumed downloads, crawlers and previews don’t. See [Statistics](../guide/statistics#shares).
- The list can show just links, texts or files, and search finds file names and the first line of texts.
- New endpoints `POST /api/texts`, `POST /api/files` and `GET /api/links/{id}/text`; links have new fields `kind` and `content`, and `GET /api/links` takes a `kind` filter. See the [HTTP API](../reference/api#shares).
- Shared files live in `files/` in the data directory; `sani backup` reminds you to copy it.

### Breaking changes

- `GET /api/links` and the bulk endpoint now include texts and files, whose `url` is empty. Scripts that only expect short links should ask for `?kind=url`.
- `p` is a reserved slug now, as `/p/` holds the shares. A link you already have at `/p` keeps working, but no new one can take that slug.
- A JSON body over its size limit now gets `413 too_large` instead of `400 bad_json`.

### Upgrading

The database schema is upgraded on start. To share files, add a DNS record for the files domain, add it to your reverse proxy, raise the proxy’s request body limit and set `SANI_FILES_URL`; [Deployment](../guide/deploy#files-domain) shows each step. Back up `files/` along with `sani.db` from then on.

## v0.2.0

2026-10-01 · Bulk actions, and groundwork for 1.0. If you script against the API, read “Breaking changes” first.

### New

- **Bulk actions.** Check several links in the list and turn them on, off or delete them at once, with undo. Click “Select” above the list or press <kbd>X</kbd> to start; <kbd>Shift</kbd>-click checks a range. See [Everyday use](../guide/usage#bulk).
- A new endpoint, `POST /api/links/bulk`, changes up to 500 links at once; see the [HTTP API](../reference/api#bulk).

### Breaking changes

- `GET /api/tokens` now returns `{"items": [...]}`, like the list of links, so fields can be added later without breaking scripts. Scripts that read the response as an array should read its `items` instead.

### Documentation

- A new [Versioning](./versioning) page says what version numbers promise, and what’s different before 1.0.

## v0.1.0

2026-09-30 · The first public release.

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
- Images on GHCR for `linux/amd64`, `linux/arm64` and `linux/arm/v7`, and binaries for Linux, macOS, Windows and FreeBSD, with `SHA256SUMS` and build provenance.

### Security

- argon2id passwords; sessions and tokens stored as hashes; sign-in and setup rate-limited per client.
- Cross-site requests are refused, and the admin app runs under a strict Content Security Policy.
- Title and icon fetches only reach public addresses, checked after DNS resolution and again when connecting.

### Documentation

- An English and Chinese documentation site with a deployment config builder, a live demo and a performance chart.
- Settings, API, error codes, commands, reserved slugs and benchmark figures are checked against the source at build time.
