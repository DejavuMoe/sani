# Changelog

<p class="lead">Every release’s changes are recorded here. Versions follow [semantic versioning](./versioning); before 1.0, a minor version may include breaking changes, and when it does, this page says how to upgrade.</p>

## Unreleased

- Apply approved R9 control sizes: 32px desktop toolbars, 36px fields and 38px menu rows, with 44px controls on narrow or touch screens. Align tag search and filters, management entry styling and About typography.
- Complete tag management with search, unused tags, global editing and atomic deletion that retains content.
- Protect submitted drafts and unsaved item edits; preserve loaded pages and selection during refresh.
- Distinguish query, pagination, statistics and token errors from empty data, with retry actions.
- Clarify Links / Text / Files, counts, access limits and export versus backup; download all skipped import records.

## v0.9.3

2026-10-09 · Fix share slug lengths not matching their settings, detail preview jitter and controls abruptly growing on narrow screens. Implements approved R6. Database schema stays at 5; the first startup only initializes missing independent share-length settings, with no new schema migration.

- Fix admin inputs, save buttons and tag controls abruptly growing at the 640px breakpoint. Keep text/code creation and editing typography consistent, with separate touch-input font sizing and switch hit areas that preserve the compact layout.

- Configure generated slug lengths independently by type: new installations default to 5 for URL `slugLength`, 10 for text/code `textSlugLength` and 10 for `fileSlugLength`. Each accepts integers 3–32 and persists independently. Add the fields to config GET/PATCH and `configSources`; `SANI_TEXT_SLUG_LENGTH` and `SANI_FILE_SLUG_LENGTH` each override and lock their own setting.
- On the initial upgrade, save missing share-length settings as `max(10, legacy effective URL slug length)`, preserving longer legacy values. Later URL-length edits no longer affect shares. Existing and manually chosen slugs stay unchanged; shares always exclude look-alikes. Values below 10 are honored with a guessing-risk advisory, without silently raising them to 10.
- Fix text/code detail preview jitter when statistics ranges change or list/timer refreshes run: retain loaded content and scroll position instead of repeatedly clearing the body. Content-version changes still refresh the body, with explicit initial-loading and failure/retry states.

Before upgrading from v0.9.2, stop the service cleanly and back up the database, files and configuration as described in [backup and restore](../guide/operations#backup). Replace the binary or pin `ghcr.io/dejavumoe/sani:v0.9.3`, then check all three lengths in Settings → Creation defaults. To generate five-character text/code share slugs, set that field to 5 independently. Existing links and content stay unchanged.

## v0.9.2

2026-10-09 · Fix environment proxy isolation and backup file permissions with reproducible security regressions. Database schema stays at 5 with no new migration.

- Fix direct requests borrowing the environment proxy's address exemption. Requests matching `NO_PROXY` use a separate connection pool and always check the public IP at dial time, blocking DNS rebinding to the configured private proxy address and port. Only requests actually routed through a proxy may delegate failed local DNS lookups. Dedicated metadata proxy IP pinning is unchanged.
- Create `sani backup FILE` with `0600` permissions from the start, atomically reject existing files and symlinks, and remove incomplete output on failure. The host shell still controls stdout backup permissions; bilingual examples now use `umask 077` and prevent overwrites. Existing backup permissions are unchanged and should be reviewed after upgrading.
- Add regression tests for proxy/direct DNS rebinding, backup permissions and failure cleanup, plus 308 HTTP checks that forwarded queries cannot replace the saved redirect scheme or authority. CodeQL #7 is dismissed as a false positive; the raw scan still reports this data flow and is not claimed to be clean.

## v0.9.1

2026-10-09 · Fix admin proxy configuration and control styling with approved R5. Database schema stays at 5 with no new migration.

- Implement approved R5: restore compact Settings rows with one centered Direct/HTTP(S)/SOCKS5 segmented control. Align paired domain, token and password actions, retaining touch sizes on narrow screens.
- Configure proxy hosts, ports and optional authentication directly in Settings, effective for new requests after saving. Never return saved passwords; changing a proxy or account requires re-entry. Add real connection testing without saving or direct fallback, preserving environment overrides.
- Replace native controls with app-styled RGB sliders, a calendar with date/time text fields, and hover/focus tooltips. Keep HEX/RGB/HSL entry, keyboard access and both themes. Record the no-browser-default-visuals rule in design and development constraints.
- Align bilingual settings, API and credential-storage documentation. Saved proxy passwords are included in the database and backups without encryption; this change does not alter the database schema.
- Document Forgejo as the push destination for branches and tags, mirrored to GitHub for builds. Forgejo master pushes trigger Woodpecker documentation deployment; verify both remotes and the live site after publishing.
- Update the Go toolchain and Docker builder to 1.27.2 and `golang.org/x/net` to 0.60.0 to fix known security vulnerabilities found by release checks.

## v0.9.0

2026-10-09 · Implement approved R3: editable tag colors, creation defaults, a dedicated metadata proxy and chunked file uploads, with consistent admin interactions. First startup migrates to schema 5; read the upgrade notes below.

- Add 12 muted tag presets, the system color picker and HEX/RGB/HSL input, stored as six-digit HEX. Edit existing tag names and colors in place across all references; legacy named colors remain supported.
- Add persisted settings for generated slug length, look-alike character exclusion, file size and off/direct/proxy metadata fetching. Explicit environment values take priority and lock their corresponding controls. Generated share IDs remain at least 10 characters.
- Default to a 99,000,000-byte file limit when unset, configurable to 1–4096 decimal MB in Settings. Files over 25,000,000 bytes use sequential independent requests, retrying from the last confirmed offset in the current page. Cancellation, expiry and restart reclaim fragments; a share is published only after full validation. Limit pending uploads to 2 per credential, 8 per instance and 8 GiB of reserved space.
- Add optional `SANI_META_PROXY` for HTTP, HTTPS or SOCKS5 with optional authentication. Dedicated mode pins verified public target IPs while retaining Host/TLS SNI, ignores NO_PROXY and never falls back to direct connections. Proxy credentials stay on the server; refreshing with fetching disabled preserves existing metadata.
- Limit imports to native Sani CSV/JSON and explicit Shlink formats, with downloadable Sani examples. Remove other products’ aliases and arbitrary wrappers; reject unrecognized formats before writing. Verify an unmodified Shlink CSV against an isolated database and repeated imports without duplicate links or counts.
- Soften composer focus halos and upload hover; unify keyboard, copy, open and Enter icons and action buttons. Keep hidden creation panels out of focus order and prevent long domains from widening narrow Settings pages.
- Align bilingual API, configuration, import, deployment and security documentation; add proxy protocol/DNS, schema migration, settings precedence, chunk retry and browser regression coverage.

### Incompatible changes and upgrade

- **Database schema 5:** extend tag color constraints while retaining tag IDs, link associations and statistics. Stop the service cleanly and back up the database, `files/` and configuration before upgrading. v0.8.x and earlier cannot open schema 5; rollback requires the matching full pre-upgrade backup, not just the old image. See [backup and restore](../guide/operations#backup).
- **Import allowlist:** product-specific Sink, YOURLS, Kutt exports and arbitrary JSON wrappers are no longer supported. Native JSON requires `app: "sani"`, `version: 1` and `links`. Convert other sources using the [standard examples](../guide/import-export). Existing links and duplicate-slug handling are unchanged.
- **File limit units:** the unset default and Settings use decimal MB. Explicit `SANI_MAX_FILE_MB` retains its existing MiB semantics and takes priority over Settings. Chunking does not bypass the whole-file limit; resume across reloads or server restarts is not supported. Review proxy body limits, timeouts and `/api/` cache rules as needed.

## v0.8.0

2026-10-08 · Fix original Shlink CSV imports and caching of limited access; document CDN rules and shared-file cleanup. Database schema stays at 4 with no new migration.

### Fixed

- Import the Shlink Web Client's original `short_urls.csv`, recognizing pipe-separated tags and retaining slugs, destinations, titles, creation times and total visits. Keep Sani CSV's JSON tag format and validation limits unchanged. Add import, repeated-import and admin upload regression coverage.
- Send `Cache-Control: no-store` for redirects with expiry or a visit limit, preventing 301/308 caches from bypassing later checks. Unlimited permanent redirects still allow one day of caching. Invalid Range and other text/file download errors also retain `no-store`.
- Default to a `./sani-data` bind directory and prevent Docker from creating it automatically. The homepage, both READMEs, quick starts, deployment pages and builder initialize permissions for `65532:65532` before startup and document repairs for existing directories. Back up and migrate existing named-volume data before changing the mount.
- Replace the browser-native time zone dropdown with a custom searchable menu matching the site, with keyboard selection, mobile touch support and both themes.

### Documentation

- Document Cloudflare rules that bypass both application hosts by default and cache only admin build assets, plus the inability to recall permanent redirects already cached by browsers.
- Clarify that expiry, exhausted visits and disabling do not delete content. Explain soft deletion, asynchronous cleanup, slug reuse, retained backups and SQLite WAL/SHM files, correcting destruction-after-reading and strict one-hour restoration claims.

### Incompatible changes

Redirects with expiry or a visit limit now disallow caching, so cache-dependent clients must reach the origin for validation. HTTP status codes and destinations are unchanged. The default Compose mount changes from a named volume to a bind directory that must be initialized first; do not replace an existing mount with the new example without migrating its data.

- Back up the database, files and configuration, then update the image to `ghcr.io/dejavumoe/sani:v0.8.0`. Existing installations should keep their current data mount, such as `./data:/data`; changing directories to match new examples is unnecessary. Review CDN rules and purge previously cached dynamic responses; browser-cached permanent redirects may survive until their original expiry. Before importing Shlink data, review expiry, disabled state and visit limits absent from the export, then check `created` / `skipped` afterward.

## v0.7.0

2026-10-08 · Align release and image tags, fix the deployment configuration builder, and document container data directory permissions. Database schema remains at 4.

### Breaking changes

- **Container image tags:** from v0.7.0, Git tags, GitHub Releases and GHCR image tags match, retaining the full `v` prefix. Releases no longer publish `latest`, major or minor floating tags; old image tags are retired. Back up, change the image in Compose or deployment scripts to `ghcr.io/dejavumoe/sani:v0.7.0`, then run `docker compose pull && docker compose up -d`. This change does not alter the database schema.

### Fixed

- Pin Compose and the configuration builder to an explicit version; reject releases whose Git tag differs from the template. Align bilingual quick starts, downloads and image verification examples with the full version.
- Document named volumes versus bind mounts, `65532:65532` ownership setup, and a data-preserving repair for SQLite database-open failures.
- Use a full time zone selector, retaining the browser's zone and including UTC. Correct form alignment, narrow-screen file tabs and actions, and the width of highlighted scrolling code.

## v0.6.0

2026-10-08 · Harden concurrency boundaries for sessions, caching and file uploads, and improve imports, exports, admin state and bilingual documentation checks. Read “Incompatible changes” before upgrading.

- Advance each link's update timestamp in commit order for edits and bulk enable/disable, so requests committed late or within the same millisecond are not mistaken for stale responses by the admin app. Metadata refreshes still preserve the timestamp.
- Validate expiry consistently across creation, updates and imports. Send a success status only after JSON encoding succeeds; encoding failures return `500 internal`.
- Use standard HTML character escaping in JSON responses without changing decoded field values or JSON import/export content.
- Protect temporary and renamed files for the full upload request until database ownership or failure cleanup, preventing the file sweeper from removing active uploads.
- Decide whether to refetch a title from the latest row inside the write transaction, preserving concurrently saved manual titles during URL updates and metadata refreshes.
- Ignore late list and text responses to preserve saved or deleted data. Retry stale pagination and refresh counts after deletion. Failed sign-out keeps the authenticated interface and shows an error that can be retried.
- Add CI smoke coverage using real processes for authentication, shares, CLI password reset and stopped-service backup/restore. Run admin axe checks in Chinese/English and light/dark themes.
- Align bilingual product scope, cache/statistics limits, proxy trust and stopped-service backup/upgrade instructions. Add page descriptions, canonical URLs, language alternates, social metadata and JSON-LD, with post-build checks of HTML, sitemap, robots and 404 indexing rules.
- Reject session issuance from a password verification that predates a password change. Admin changes, environment synchronization and CLI resets update the password and revoke sessions atomically; a failed revocation rolls back the password.
- Prevent requests after cache invalidation from joining an older load, so disabling or renaming links and shares takes effect for new requests.
- Limit HTML icon candidates to 32 and base and HTTP(S) icon URLs to 8192 bytes to bound relative-URL expansion.
- Bookmarklet and phone shares now prefill the URL and title for review. Click “Shorten” to create or reuse a link.
- Prefix potentially executable spreadsheet fields in CSV exports; use JSON for lossless migration. Prevent very large imported click counts from overflowing statistics, saturating at the int64 ceiling while retaining exact integer counts within range.
- Add Ecoku comments to documentation pages, with Chinese and English UI and light/dark themes. Each page has its own discussion; theme changes preserve comment drafts.

### Incompatible changes

Upgrading from v0.5.0 keeps the database at schema 4 with no new migration. This minor release includes the behavior changes below under the [versioning policy](./versioning). Stop the service cleanly and back up the database, `files/` and configuration before upgrading; review password configuration and import/export workflows. See [backup and restore](../guide/operations#backup) for the complete procedure.

- **CSV formula protection:** fields that could trigger spreadsheet formulas gain an apostrophe prefix. Reimporting retains that prefix and can change original titles and other fields. For lossless migration of URL links and tags, export Sani JSON again from the original instance. Do not strip apostrophes in bulk: they may be original content. Full instance recovery still requires matching backups of the database, files and configuration.
- **Bookmarklet and phone shares:** incoming URLs and titles only prefill the form; review and confirm creation manually. Workflows that relied on automatic creation must use the authenticated API or keep the manual confirmation step.
- **Password length:** setting or replacing a password requires at least 8 Unicode code points and at most 1,024 UTF-8 bytes, consistently across the API, `SANI_PASSWORD` and `sani passwd`. Multibyte characters count toward the byte ceiling. Check environment configuration before upgrading: an oversized password prevents startup. Reset an existing oversized password through `sani passwd`; a successful reset revokes sessions. Rejected passwords leave the stored password and sessions unchanged.
- **Expiry:** creation and updates require a future RFC 3339 time whose UTC year is within 0000–9999, stored with millisecond precision. Imports skip a row with `expires_invalid` when a nonempty expiry is malformed, predates the Unix epoch or exceeds the UTC range, instead of silently making the link permanent. Unix seconds are checked for overflow before conversion to milliseconds. Review `skipped`, correct the input and retry; use an empty value or import value `0` when permanent validity is intended.

## v0.5.0

2026-10-07 · Add tag grouping, filtering and portable imports/exports, and refine mobile interactions and deployment documentation. First startup migrates to schema 4; read “Database upgrade” before upgrading.

### Added

- Select or create colored tags when creating and editing URL, text and file shares. Filter by a tag or Untagged alongside search and type filters, with global tag counts. Desktop and mobile retain the existing layout; creation time stays in link details.
- Authenticated tag APIs and optional link tag assignments/filtering. JSON/CSV exports and imports preserve tag names, colors and assignments, and older exports still import.
- Assign up to 5 tags per link, with names up to 24 Unicode code points, 5 colors and case-insensitive deduplication. Tags are private to the administrator and never appear on visitor pages.

### Database upgrade

- Startup automatically migrates to schema 4, adding `tags`, `link_tags` and a filter index. Existing links start untagged; link IDs, content and statistics are preserved.
- Stop the service cleanly and back up the database, `files/` and configuration before upgrading. To return to v0.4.0 or earlier, restore that complete pre-upgrade backup; old binaries cannot open schema 4. See [backup and restore](../guide/operations#backup).

### Fixed

- Prevent delayed statistics or metadata responses from overwriting newly saved tags and other link edits.
- Keep mobile tag popovers clear of the reserved scrollbar gutter, and prevent hidden chart data tables from adding blank space to the page.
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
