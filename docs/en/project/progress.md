<script setup>
import { data as status } from '../../.vitepress/data/status.data'
</script>

# Status

<p class="lead">The latest release is {{ status.latestVersion }}; unreleased changes appear at the top of the changelog. This page lists implemented capabilities, production acceptance checks and remaining scope. An implemented feature does not mean a particular deployment has passed acceptance.</p>

## Where things stand {#current}

| Area | Status | Covers |
|---|---|---|
| Redirects and statistics | <span class="sn-status done">Done</span> | In-memory cache, click aggregation, crawler and preview filtering, expiry, visit limits |
| Admin app | <span class="sn-status done">Done</span> | English and Chinese, light and dark, keyboard control, bulk actions, QR codes, bookmarklet, phone share menu |
| Tags | <span class="sn-status done">Done</span> | Colored tags for links, texts and files; assign during creation or editing, filter by tag or Untagged, and transfer through JSON/CSV, since v0.5.0 |
| Texts and files | <span class="sn-status done">Done</span> | Plain text and code at `/p/`, file uploads served from a domain of their own, since v0.3.0 |
| HTTP API | <span class="sn-status done">Done</span> | Every feature, with API tokens |
| Import and export | <span class="sn-status done">Done</span> | Import Sani and Shlink CSV/JSON; export URL links as Sani JSON or CSV |
| Deployment | <span class="sn-status done">Done</span> | A Docker image built `FROM scratch`; systemd, Caddy and nginx examples |
| Operations | <span class="sn-status done">Done</span> | Online database snapshots, stopped-service database and file backups, password reset, health checks |
| Documentation | <span class="sn-status done">Done</span> | This site: English and Chinese, checked against the source at build time |
| Releases | <span class="sn-status done">Done</span> | A tag publishes everything: multi-platform images on GHCR, binaries for Linux, macOS, Windows and FreeBSD, with checksums and build provenance |
| Continuous integration | <span class="sn-status done">Done</span> | Go tests on Linux, macOS and Windows, cross-compilation for every release target, E2E, axe and known-vulnerability scans; results belong to the specific commit |
| Hosted docs | <span class="sn-status done">Done</span> | Chinese and English documentation is live at [sani.zsh.moe](https://sani.zsh.moe) |

## Production acceptance scope {#production}

Sani is intended for **one administrator, one server process and a local persistent data directory**. A reverse proxy provides HTTPS, and file sharing uses a separate hostname. The operator owns backups, disk capacity, log monitoring and upgrade recovery. Multiple processes sharing a database do not synchronize their in-memory caches or visit allowances, so replicas are not a supported high-availability setup. A share URL is not visitor authentication, and click statistics do not promise zero loss after a power failure.

Run the following checks for each release candidate commit. A previous release's green checks do not validate a new candidate.

| Layer | Entry point | Acceptance condition |
|---|---|---|
| Code and features | `make check test e2e` | Static checks, Go race tests, frontend unit tests and real browser interactions pass |
| Process and recovery | `make smoke` | The built binary starts and stops cleanly; CLI database backup and paired file restore preserve counts, credentials, tags, texts and file hashes |
| Storage and failure handling | `internal/store/*_test.go`, `cmd/sani/main_test.go` | Regressions cover historical schema migration, rollback, lock waits, shutdown deadlines and failed flushes |
| Capacity and counting | `make bench load capacity` | Record the environment; request counts agree with clicks, with no unexplained performance regression |
| Accessibility | `pnpm --dir web a11y`, `pnpm --dir docs a11y` | Main admin screens and every documentation page pass axe in both languages and themes |
| Documentation and SEO | `make docs`, docs output and publishing checks | Bilingual descriptions match the code; page summaries, canonical URLs, language alternates and sitemap match the actual pages |
| Distribution and supply chain | CI, CodeQL and Release workflows for the candidate | Platform tests, archives, containers and dependency scans pass; verify the version, checksums and provenance of published artifacts separately |

Before accepting a target deployment, also verify HTTPS, proxy trust, both domains, volume permissions, backup recovery and monitoring as described in [Operations](../guide/operations). `/healthz` reports liveness, not database writability or complete application health. The compatibility promises for 1.0 require the separate [versioning gates](./versioning#before-1); passing local checks does not automatically make a 1.0 release.

## v0.9.4 management and visual consistency acceptance {#r9-acceptance}

Approved R7 and R9 are implemented. Tag search and scope filters share an outer height; toolbars, fields and menus use shared sizes, with 44px controls on narrow or touch screens. Categories, share URLs, visit statistics and About typography are consistent. R9 sizing supersedes the R6 narrow-screen compact rule.

Atomic tag deletion and retained content: `internal/store/tags_test.go`, `internal/server/tags_test.go`. Draft guards, filtered refresh, retries and grouped dimensions: `web/e2e/r7.spec.ts`. Breakpoints, both languages/themes, mouse and emulated touch: `web/e2e/metadata.spec.ts`. Rendered evidence: `designs/sani/implementation-r9/`. Physical devices and Firefox/WebKit remain unverified.

## v0.9.3 slug and interface fix acceptance {#r6-acceptance}

Approved R6 is implemented, with matching prototype and production fixes. These regressions cover independent slug settings, stable previews and responsive controls. Touch checks use browser emulation; they do not establish acceptance on physical iOS/Android devices or Firefox/WebKit.

| Capability | Acceptance entry point |
|---|---|
| Three lengths, 3–32 bounds, environment locks, legacy settings initialization and persistence across restarts | `internal/config/slug_lengths_test.go`, `internal/server/slug_lengths_test.go`, `cmd/sani/slug_lengths_test.go` |
| Generated lengths, body and scroll retention during statistics refreshes, failure retry and refresh after editing | `web/e2e/r6.spec.ts` |
| Control sizing at 721/720, 641/640, 502/390/320px; both languages and themes, mouse/touch, expanded controls and accessibility | `web/e2e/metadata.spec.ts` |

## v0.5.0 tag verification {#tags-acceptance}

| Capability | Acceptance entry point |
|---|---|
| Schema 4 migration, assignment transactions, backup/restore and filtered pagination | `internal/store/tags_test.go` |
| Authentication, rejected upload cleanup and cross-instance tag imports/exports | `internal/server/tags_test.go` |
| Creation and editing, filters, failed-save retry, mobile popovers and delayed-response protection | `web/e2e/app.spec.ts` |

## v0.4.0 implementation and verification {#acceptance}

These five batches are included in v0.4.0. Verification entry points are listed below; remote results are available in [CI](https://github.com/DejavuMoe/sani/actions/workflows/ci.yml) and [CodeQL](https://github.com/DejavuMoe/sani/actions/workflows/codeql.yml).

| Batch | Implementation | Acceptance entry point |
|---|---|---|
| 1 · Counting | Ranges and conditionals, shared allowances, non-reused IDs, flush consistency | `counting_test.go`, migration and concurrency tests |
| 2 · Backups and docs | Stopped-service paired backups, restore/hash drill, statistics and durability wording, shared version | `TestStoppedBackup`, semantic docs checks |
| 3 · Recovery | Bounded retry referrers, one-second external lock waits, shutdown and final-flush failures | Go race tests, lock and shutdown regressions |
| 4 · Capacity and automation | Three dataset sizes, simpler list counts, dependency audits, CI capacity checks | `make capacity`, `make bench load`, dependency audits |
| 5 · Docs and compatibility | Bilingual release notes and upgrade steps, 1.0 gates, docs builds and accessibility | `make check test e2e docs`, axe on both sites |

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
2. **Settling for 1.0.** Stabilize the public API, configuration and upgrade path; internal database schemas may still migrate. Complete the compatibility checklist and restore drill before release. [Versioning](./versioning) defines the boundaries.

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
