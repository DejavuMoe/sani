# Status

<p class="lead">Sani is at v0.1.0: feature-complete, tested and load-tested, but not formally released yet. This page tracks what’s done, what comes next and what Sani deliberately won’t do. The checks and numbers below are computed from the source whenever the docs are built.</p>

## Where things stand {#current}

| Area | Status | Covers |
|---|---|---|
| Redirects and statistics | <span class="sn-status done">Done</span> | In-memory cache, click aggregation, crawler and preview filtering, expiry, visit limits |
| Admin app | <span class="sn-status done">Done</span> | English and Chinese, light and dark, keyboard control, QR codes, bookmarklet, phone share menu |
| HTTP API | <span class="sn-status done">Done</span> | Every feature, with API tokens |
| Import and export | <span class="sn-status done">Done</span> | Sani, Shlink, Sink and all kinds of CSV |
| Deployment | <span class="sn-status done">Done</span> | A Docker image built `FROM scratch`; systemd, Caddy and nginx examples |
| Operations | <span class="sn-status done">Done</span> | Online backups, password reset, health checks |
| Documentation | <span class="sn-status done">Done</span> | This site: English and Chinese, checked against the source at build time |
| Release | <span class="sn-status planned">Planned</span> | Version tags, with images and binaries for amd64 and arm64 |
| Continuous integration | <span class="sn-status planned">Planned</span> | Checks, tests, end-to-end tests and the docs check on every commit |
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

1. **Release.** Tag v0.1.0 and build images and binaries for several architectures automatically, with checksums. Deploying then no longer needs a local build.
2. **Continuous integration.** Run `make check test e2e`, including the docs check, on every commit.
3. **Hosted docs.** Publish this site as a static website.

Under consideration, not decided:

- **Bulk actions.** Select several links in the list and turn them off or delete them at once.
- **Tags.** Group links once there are many, if there’s a way to do it without adding complexity.

## Not planned {#non-goals}

Sani is meant to be a simple link shortener for one person. These would turn it into something else, so they’re not planned:

- multiple users, teams and permissions;
- visitor tracking: location, device, browser, UTM breakdowns;
- routing visitors to different destinations by device, region or percentage;
- interstitial pages and ads before the redirect;
- depending on external services such as PostgreSQL or Redis.
