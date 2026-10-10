# Development

<p class="lead">The repository holds three things: the Go server, the Svelte admin app and this documentation site. This page covers the development setup, the everyday commands, and the rules a change has to keep.</p>

## Setup

You need Go, Node.js and pnpm, with versions pinned in `mise.toml`. With [mise](https://mise.jdx.dev) installed, one command gets those versions, and `make` uses them automatically:

```sh
mise install
make install      # dependencies of web and docs (one pnpm workspace)
```

## Layout

```
cmd/sani            entry point and subcommands
internal/server     routes, redirects, JSON API, embedded admin app, visitor pages
internal/cache      redirect target cache
internal/clicks     click aggregation and batched writes
internal/store      SQLite: schema, migrations, queries
internal/links      rules for slugs and URLs
internal/meta       title and icon fetching, with the SSRF guard
internal/auth       password hashing, random secrets, sign-in rate limiting
internal/config     reading the environment
internal/webui      embeds the built admin app
web/                the admin app: Svelte 5 + TypeScript, built with Vite
docs/               this site: VitePress
scripts/            demo data, the load test and release scripts
deploy/             systemd, Caddy and nginx examples
.github/            CI, application release workflows and issue forms
```

The Go module is at the repository root. `web` and `docs` are two packages of one pnpm workspace sharing a lockfile, and shared dependencies such as the fonts get their versions from the `catalog` in `pnpm-workspace.yaml`.

## Commands

| Command | What it does |
|---|---|
| `make dev-backend` | Start the backend on `127.0.0.1:8080` |
| `make dev-frontend` | Start Vite on `127.0.0.1:5173/admin/`, forwarding `/api` to the backend |
| `make demo` | Build and start an instance with demo data; the password is `sani-demo` |
| `make check` | gofmt, go vet, svelte-check, and the docs check and type check |
| `make test` | Go tests (with `-race`) and frontend unit tests |
| `make e2e` | End-to-end tests with Playwright against a fresh instance |
| `make smoke` | Run the real binary to exercise authentication, URLs/texts/files/tags, SIGTERM shutdown, CLI backup/restore and password reset |
| `make bench` | Benchmarks for redirects, the cache and click counting |
| `make load` | The load test, including the click count check |
| `make capacity` | List, search, cold redirects, flushing and mixed I/O at 1k/10k/100k links; JSON output |
| `make build` | Build the admin app, then `bin/sani` |
| `make dist` | Build the release archives for every platform, and `SHA256SUMS`, in `dist/` |
| `make docker` | Build the Docker image |
| `make docs-dev` | Serve the docs on `127.0.0.1:5174` |
| `make docs` | Build the static docs into `docs/.vitepress/dist` |

Before calling a change done, run at least `make check test`, and `make e2e` when it touches the admin app. Release acceptance also runs `make smoke` to verify HTTP, CLI and stopped-service restore paths using real processes. Every development server listens on `127.0.0.1` only.

## Rules

- **Redirects don’t touch the database.** On a cache hit, a redirect doesn’t query the database and never waits for a write. Run `make bench` before and after changing `redirect.go`, `cache` or `clicks`.
- **No cgo.** SQLite is the pure Go `modernc.org/sqlite`, and the image is `FROM scratch`.
- **Security boundaries stay.** The fetcher’s SSRF checks, the refused URL schemes, the setup code for the first password, session cookies scoped to `/api/`, cross-origin protection and the admin app’s Content Security Policy.
- **External input is bounded.** A new map keyed by client input needs a size limit too.
- **Every UI string exists in English and Chinese**, in `web/src/lib/i18n.svelte.ts`. The Chinese is written for Chinese readers, not translated word for word.
- **No UI or icon libraries.** Icons are hand-drawn paths in `Icon.svelte`, menus use the Popover API and dialogs use `<dialog>`.
- **Accessibility.** Text should meet WCAG AA contrast and controls must work from the keyboard. `pnpm --dir web a11y` scans main admin screens in Chinese/English and light/dark themes; `pnpm --dir docs a11y` scans every docs page in both languages and themes. Axe must report no violations; manually check focus and keyboard interaction too.
- **API errors** are always `{"error": {"code": "…", "message": "…"}}`, and the admin app maps `code` to its `err.*` strings.

## Documentation

The site lives in `docs/`. `make docs-dev` previews it locally, updating as you edit.

- **Pages** are listed in `docs/.vitepress/pages.ts`. Chinese pages live under `docs/` and English ones at the same place under `docs/en/`; every page must exist in both languages.
- **Checks against the source.** `node docs/.vitepress/sync/check.ts` compares the docs with the source; `make check` and every docs build run it. What it compares, and the latest results, are on the [Status](./progress#checks) page.
- **Accessibility checks.** Run `pnpm --dir docs build`, start a preview with `pnpm --dir docs preview`, then run `pnpm --dir docs a11y`. It runs axe over every page, in both languages and both themes.
- **SEO regression checks.** `.vitepress/seo.ts` provides per-page summaries, canonical URLs, hreflang, OG, Twitter and JSON-LD, tested by `make check`. After building, `make docs` runs `scripts/check-seo.mjs` against real HTML to check unique titles, summaries and canonicals, the bilingual sitemap, robots and a noindex 404. Add summaries in both languages when adding a page.
- **Content from the source.** The home page demo uses the admin app’s own strings and slug rules, the deploy page’s builder edits the repository’s configuration files, and the performance figures come from `docs/.vitepress/data/benchmark.ts`. None of that needs syncing by hand.

When you change the code, update the matching docs:

| When you change | Update |
|---|---|
| Environment variables | `reference/configuration.md` and the configuration tables of both READMEs |
| API endpoints or error codes | `reference/api.md` |
| Subcommands | `reference/cli.md` |
| Reserved slugs | `guide/usage.md` |
| Benchmark results | `docs/.vitepress/data/benchmark.ts` and both READMEs |
| Release platforms | The download table and image platforms in `guide/deploy.md` |

Update both languages; if you miss one, the check names exactly what’s missing.

### Screenshots

The screenshots in the docs and READMEs come from `web/scripts/screenshots.mjs`, in both languages and both themes:

```sh
make build
go run ./scripts/seed -data /tmp/sani-demo -base https://s.example.com
SANI_LISTEN=127.0.0.1:18080 SANI_DATA_DIR=/tmp/sani-demo ./bin/sani &
SANI_LISTEN=127.0.0.1:8080 SANI_DATA_DIR=/tmp/sani-fresh ./bin/sani &
cd web && SANI_URL=http://127.0.0.1:18080 SANI_FRESH_URL=http://127.0.0.1:8080 node scripts/screenshots.mjs
```

The second instance has no password yet and provides the first-run screen. That screen shows the instance’s address, so it uses port 8080 from the quick start. The screenshots land in `docs/public/screenshots/`.

## CI and releases {#release}

Every push and pull request runs [CI](https://github.com/DejavuMoe/sani/actions/workflows/ci.yml):

- `make check test`, and the Go tests on macOS and Windows as well;
- the end-to-end tests, and axe over the admin app;
- direct HTTP contracts, old-binary upgrades and full-snapshot rollback, including non-root Docker bind-storage faults;
- a docs build, with axe over every page;
- a build of the image for every release platform, which is then started and has to pass its health check;
- the release archives for every platform;
- `govulncheck`, workspace `pnpm audit --audit-level=moderate`, and npm audit for both tracked design tools. It also runs every Monday, so a new advisory doesn’t wait for a commit.

[CodeQL](https://github.com/DejavuMoe/sani/actions/workflows/codeql.yml) scans Go, JavaScript/TypeScript, Python and GitHub Actions on pushes, pull requests and a weekly schedule. Go is built with the pinned project toolchain; the other languages are analyzed directly from source.

To release a new version:

Push to Forgejo: `origin` must point to `ssh://git@ssh.via.moe/dejavu/sani.git`. Forgejo automatically mirrors pushes to GitHub, triggering application CI and release builds. `.woodpecker/docs.yml` deploys the documentation to `https://sani.zsh.moe` on Forgejo `master` pushes; pushing only to GitHub or only pushing a tag does not trigger documentation deployment.

1. Turn the “Unreleased” section of both changelogs into a heading such as `## v0.9.5`, followed by the date. Update the full version tag in Compose, bilingual download examples and image verification examples.
2. Run `make check test e2e smoke docs VERSION=v0.9.5` and `bash scripts/test-release-notes.sh`; confirm `scripts/release-notes.sh v0.9.5` generates the notes.
3. Commit, verify the Forgejo address with `git remote get-url origin`, then run `git push origin master`. Confirm GitHub mirrors the same commit, wait for that commit's CI and CodeQL to pass, and check Woodpecker documentation deployment.
4. Create an annotated tag on the verified commit and push it to the same Forgejo remote:

   ```sh
   git tag -a v0.9.5 -m "Sani v0.9.5"
   git push origin refs/tags/v0.9.5
   ```

5. Wait for the GitHub Release to succeed and compare tag objects and target commits on Forgejo and GitHub. Verify every archive's SHA-256 and provenance, the multi-platform image and runtime version, and the live documentation's version and content in both languages. Never move, recreate or force-push a published tag; synchronize a missing tag by pushing its original object.

The release workflow first makes sure the English changelog has an entry for the version, and stops if it doesn’t. It then runs the checks and tests once more, builds the archives and `SHA256SUMS`, pushes the multi-platform image with an SBOM, records build provenance for both, and creates the GitHub release with notes taken from the changelog. A tag like `v0.9.5-rc.1` is marked as a pre-release. Images always use full version tags; no `latest` or floating tags are published.

Locally, `make web dist VERSION=v0.2.0` produces the same archives as the release. Building one commit twice gives byte-for-byte identical files.

HTTP contract and upgrade gates: run `make contract` after `make install`; run `OLD_BIN=/absolute/path/to/old-sani make upgrade-drill` with the schema-5 baseline binary. `make check test`, `make e2e`, and `make smoke` remain required. The contract script uses Node built-ins, fetch and FormData, with no s.ee SDK dependency.


Docker storage drill: build the local image, then run `bash scripts/test-docker-storage.sh sani:upgrade /absolute/path/to/old-sani`. It extracts the actual image binary and reuses the HTTP/migration/rollback drill as UID 65532 on bind storage in a temporary Node test container. Node is only the test harness; the production image remains scratch. It also verifies refusal of a read-only database and real ENOSPC on an isolated 16 MiB tmpfs: three failed starts leave no partial copies, and the old schema and files pass preflight after space is freed.

## Ablation and dependency checks {#ablation}

`make ablation` removes caching and click batching one at a time and asserts conserved counts. The [experiment record](../internals/performance#ablation) keeps conditions, three runs and limits. Protocol tests use Node's built-in fetch/FormData, with no external SDK or new runtime dependency.

The 2026-10-10 reference check covered all 36 Svelte components: each has callers, so shared components remain. The five direct Go modules provide Argon2, HTML/IDNA/proxy support, terminal password input, Unicode normalization and pure-Go SQLite. `go mod tidy -diff` and `go mod verify` check the module graph and checksums. App runtime dependencies provide local fonts and QR encoding; docs also use Vue, VitePress and Ecoku comments. Testing and type-checking tools are development dependencies. Removing these would remove existing capabilities; `go.mod`, `go.sum` and the workspace lockfile remain unchanged.

Scripts retain distinct jobs: `screenshots.mjs` produces the fixed docs filenames, `shots.mjs` covers more interactions, `fresh-shots.mjs` exercises setup/empty states, and `icons.mjs` generates icons. Screenshot authentication/setup failures must exit rather than capture a login page as the requested screen. `smoke` checks shutdown/backup, `upgrade-drill` checks old-version upgrade/rollback, and the Docker harness checks permissions, bind storage, restarts and a full disk. Release scripts use isolated fixtures in `test-release-notes.sh` and `test-publish-docs.sh`; these do not deploy a site.

Docs checks extract routes, errors, environment variables, CLI commands, reserved slugs, input lengths and release platforms from source, with negative tests against known false claims. The historical API archive is excluded from the current route comparison. Prose and interactions still need source, HTTP and browser review; automated checks are not a formal proof of every behavior.
