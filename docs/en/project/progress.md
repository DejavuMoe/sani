# Status

<p class="lead">Sani is at v0.3.0: feature-complete, tested and load-tested, with ready-made images and binaries. This page tracks what’s done, what comes next and what Sani deliberately won’t do. The checks and numbers below are computed from the source whenever the docs are built.</p>

## Where things stand {#current}

| Area | Status | Covers |
|---|---|---|
| Redirects and statistics | <span class="sn-status done">Done</span> | In-memory cache, click aggregation, crawler and preview filtering, expiry, visit limits |
| Admin app | <span class="sn-status done">Done</span> | English and Chinese, light and dark, keyboard control, bulk actions, QR codes, bookmarklet, phone share menu |
| Texts and files | <span class="sn-status done">Done</span> | Plain text and code at `/p/`, file uploads served from a domain of their own, since v0.3.0 |
| HTTP API | <span class="sn-status done">Done</span> | Every feature, with API tokens |
| Import and export | <span class="sn-status done">Done</span> | Sani, Shlink, Sink and all kinds of CSV |
| Deployment | <span class="sn-status done">Done</span> | A Docker image built `FROM scratch`; systemd, Caddy and nginx examples |
| Operations | <span class="sn-status done">Done</span> | Online backups, password reset, health checks |
| Documentation | <span class="sn-status done">Done</span> | This site: English and Chinese, checked against the source at build time |
| Releases | <span class="sn-status done">Done</span> | A tag publishes everything: multi-platform images on GHCR, binaries for Linux, macOS, Windows and FreeBSD, with checksums and build provenance |
| Continuous integration | <span class="sn-status done">Done</span> | Every commit runs the checks and tests (Linux, macOS, Windows), the end-to-end tests, axe and a vulnerability scan, and builds the image and every binary |
| Hosted docs | <span class="sn-status planned">Planned</span> | For now, browse them locally with `make docs-dev` |

## Build-time checks {#checks}

Before every docs build, the documentation is compared with the source, and any mismatch fails the build. What you see here is what this build of the docs actually passed.

<SyncStatus part="checks" />

## Size {#size}

<SyncStatus part="stats" />

## Toolchain {#toolchain}

Pinned in `mise.toml`, `go.mod` and `pnpm-workspace.yaml`:

<SyncStatus part="versions" />

## Next {#next}

1. **Listening.** Sani is out in public; what comes next is mostly fixes and polish. Problems and questions are welcome on [GitHub](https://github.com/DejavuMoe/sani/issues).
2. **Settling for 1.0.** The API, the settings and the database schema are fixed at 1.0; after that, incompatible changes only come with a new major version. [Versioning](./versioning) spells out the promise.
3. **Hosted docs.** Publish this site as a static website.

Under consideration, not decided:

- **Tags.** Group links once there are many, if there’s a way to do it without adding complexity.
- **Markdown.** Show shared texts written in Markdown as formatted text; for now they’re plain text or code.

## Not planned {#non-goals}

Sani is meant to be a simple link shortener for one person. These would turn it into something else, so they’re not planned:

- multiple users, teams and permissions;
- visitor tracking: location, device, browser, UTM breakdowns;
- routing visitors to different destinations by device, region or percentage;
- interstitial pages and ads before the redirect;
- uploads from visitors, and end-to-end encryption for shares;
- depending on external services such as PostgreSQL or Redis.
