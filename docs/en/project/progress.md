<script setup>
import { data as status } from '../../.vitepress/data/status.data'
</script>

# Status

<p class="lead">The latest release is {{ status.latestVersion }}. Sani is now maintained as a stable 1.x series. This page describes what it does today, what it is meant for and what comes next; see the <a href="./changelog">changelog</a> for individual releases.</p>

## Where things stand {#current}

| Area | Status | Covers |
|---|---|---|
| Redirects and statistics | <span class="sn-status done">Done</span> | In-memory cache, click aggregation, crawler and preview filtering, expiry, visit limits |
| Admin app | <span class="sn-status done">Done</span> | English and Chinese, light and dark, keyboard control, bulk actions, QR codes, bookmarklet, phone share menu |
| Tags | <span class="sn-status done">Done</span> | Colored tags for links, texts and files; assign during creation or editing, filter by tag or Untagged, and transfer through JSON/CSV, since v0.5.0 |
| Texts and files | <span class="sn-status done">Done</span> | Plain text and code at `/p/`, file uploads served from a domain of their own, since v0.3.0 |
| Access passwords | <span class="sn-status done">Done</span> | Password protection for links, texts and files, visitor verification, failure rate limits and password import/export, since v1.0.0 |
| HTTP API | <span class="sn-status done">Done</span> | Every feature, with API tokens |
| Import and export | <span class="sn-status done">Done</span> | Import Sani and Shlink CSV/JSON; export URL links as Sani JSON or CSV |
| Deployment | <span class="sn-status done">Done</span> | A Docker image built `FROM scratch`; systemd, Caddy and nginx examples |
| Operations | <span class="sn-status done">Done</span> | Online database snapshots, stopped-service database and file backups, password reset, health checks |
| Documentation | <span class="sn-status done">Done</span> | English and Chinese, with build-time source checks for covered configuration, API and other rules |
| Releases | <span class="sn-status done">Done</span> | A tag publishes everything: multi-platform images on GHCR, binaries for Linux, macOS, Windows and FreeBSD, with checksums and build provenance |
| Continuous integration | <span class="sn-status done">Done</span> | Go tests on Linux, macOS and Windows, cross-compilation for every release target, E2E, axe and known-vulnerability scans |
| Hosted docs | <span class="sn-status done">Done</span> | Chinese and English documentation is live at [sani.zsh.moe](https://sani.zsh.moe) |

## Intended use {#production}

Sani is intended for **one administrator, one server process and a local persistent data directory**. A reverse proxy provides HTTPS, and file sharing uses a separate hostname. The operator owns backups, disk capacity, log monitoring and upgrade recovery. Multiple processes sharing a database do not synchronize their in-memory caches or visit allowances, so replicas are not a supported high-availability setup. A share URL is not visitor authentication, and click statistics do not promise zero loss after a power failure.

After deploying, verify HTTPS, proxy trust, both domains, volume permissions, backup recovery and monitoring as described in [Operations](../guide/operations). `/healthz` reports liveness, not database writability or complete application health. The [1.x compatibility promises](./versioning#stable) apply from v1.0.0.

## Build-time checks {#checks}

Before every docs build, scripts compare covered configuration, API, error-code and parameter rules with the source; a mismatch fails the build. The rest of the prose is reviewed by hand.

<SyncStatus part="checks" />

## Size {#size}

<SyncStatus part="stats" />

## Toolchain {#toolchain}

Pinned in `mise.toml`, `go.mod` and `pnpm-workspace.yaml`:

<SyncStatus part="versions" />

## Next {#next}

1. **Listening.** Sani is out in public; what comes next is mostly fixes and polish. Problems and questions are welcome on [GitHub](https://github.com/DejavuMoe/sani/issues).
2. **Maintaining 1.x compatibility.** Preserve documented HTTP API, environment-variable and upgrade contracts in subsequent releases; internal schemas may evolve through migrations. Schedule incompatible changes for a major release under [Versioning](./versioning).

Under consideration, not decided:

- **Markdown.** Show shared texts written in Markdown as formatted text; for now they’re plain text or code.

## Not planned {#non-goals}

Sani is meant to be a simple link shortener for one person. These would turn it into something else, so they’re not planned:

- multiple users, teams and permissions;
- visitor tracking: location, device, browser, UTM breakdowns;
- routing visitors to different destinations by device, region or percentage;
- interstitial pages and ads before the redirect;
- uploads from visitors, and end-to-end encryption for shares;
- depending on external services such as PostgreSQL or Redis.
