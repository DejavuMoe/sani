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
scripts/            demo data and the load test
deploy/             systemd, Caddy and nginx examples
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
| `make bench` | Benchmarks for redirects, the cache and click counting |
| `make load` | The load test, including the click count check |
| `make build` | Build the admin app, then `bin/sani` |
| `make docker` | Build the Docker image |
| `make docs-dev` | Serve the docs on `127.0.0.1:5174` |
| `make docs` | Build the static docs into `docs/.vitepress/dist` |

Before calling a change done, run at least `make check test`, and `make e2e` when it touches the admin app. Every development server listens on `127.0.0.1` only.

## Rules

- **Redirects don’t touch the database.** On a cache hit, a redirect doesn’t query the database and never waits for a write. Run `make bench` before and after changing `redirect.go`, `cache` or `clicks`.
- **No cgo.** SQLite is the pure Go `modernc.org/sqlite`, and the image is `FROM scratch`.
- **Security boundaries stay.** The fetcher’s SSRF checks, the refused URL schemes, the setup code for the first password, session cookies scoped to `/api/`, cross-origin protection and the admin app’s Content Security Policy.
- **External input is bounded.** A new map keyed by client input needs a size limit too.
- **Every UI string exists in English and Chinese**, in `web/src/lib/i18n.svelte.ts`. The Chinese is written for Chinese readers, not translated word for word.
- **No UI or icon libraries.** Icons are hand-drawn paths in `Icon.svelte`, menus use the Popover API and dialogs use `<dialog>`.
- **Accessibility.** Text meets WCAG AA contrast in both themes, everything works from the keyboard, and axe reports nothing: `pnpm --dir web a11y` for the admin app, `pnpm --dir docs a11y` for this site.
- **API errors** are always `{"error": {"code": "…", "message": "…"}}`, and the admin app maps `code` to its `err.*` strings.

## Documentation

The site lives in `docs/`. `make docs-dev` previews it locally, updating as you edit.

- **Pages** are listed in `docs/.vitepress/pages.ts`. Chinese pages live under `docs/` and English ones at the same place under `docs/en/`; every page must exist in both languages.
- **Checks against the source.** `node docs/.vitepress/sync/check.ts` compares the docs with the source; `make check` and every docs build run it. What it compares, and the latest results, are on the [Status](./progress#checks) page.
- **Accessibility checks.** Run `pnpm --dir docs build`, start a preview with `pnpm --dir docs preview`, then run `pnpm --dir docs a11y`. It runs axe over every page, in both languages and both themes.
- **Content from the source.** The home page demo uses the admin app’s own strings and slug rules, the deploy page’s builder edits the repository’s configuration files, and the performance figures come from `docs/.vitepress/data/benchmark.ts`. None of that needs syncing by hand.

When you change the code, update the matching docs:

| When you change | Update |
|---|---|
| Environment variables | `reference/configuration.md` and the configuration tables of both READMEs |
| API endpoints or error codes | `reference/api.md` |
| Subcommands | `reference/cli.md` |
| Reserved slugs | `guide/usage.md` |
| Benchmark results | `docs/.vitepress/data/benchmark.ts` and both READMEs |

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
