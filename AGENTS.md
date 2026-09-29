# Working on Sani

A self-hosted link shortener: one Go binary with the Svelte admin app embedded, one SQLite file. Keep it small: new features have to earn their place, and statistics stay simple on purpose.

## Commands

Toolchain versions are pinned in `mise.toml` (Go, Node, pnpm).

```sh
make install          # web and docs dependencies (one pnpm workspace, frozen lockfile)
make check            # gofmt, go vet, svelte-check --fail-on-warnings, docs sync check, vue-tsc
make test             # go test -race ./..., vitest
make build            # web → internal/webui/dist, then ./bin/sani
make e2e              # Playwright against a fresh ./bin/sani on 127.0.0.1:18765
make bench            # handler, cache and click-recorder benchmarks
make load             # bombardier load test; fails if clicks ≠ redirects
make docs-dev         # the docs site on 127.0.0.1:5174
make docs             # sync check, then the static site in docs/.vitepress/dist
pnpm --dir web a11y   # axe over the main screens (needs a running demo: make demo)
pnpm --dir docs a11y  # axe over every docs page, both languages and themes (needs pnpm --dir docs preview)
```

Before calling a change done, run `make check test`, and `make e2e` for anything the admin app touches. Screenshots of the app, for the docs and READMEs, come from `web/scripts/screenshots.mjs` against a seeded instance (`scripts/seed`) and a fresh one; `docs/project/development.md` has the commands.

## Layout

- `cmd/sani`: entry point and subcommands (`serve`, `passwd`, `backup`, `healthcheck`, `version`).
- `internal/server`: routes, redirect hot path, JSON API, embedded app, visitor pages.
- `internal/cache`, `internal/clicks`: the in-memory redirect cache and click aggregation.
- `internal/store`: SQLite schema, migrations (`PRAGMA user_version`) and queries.
- `internal/links`: pure rules for slugs and URLs. `internal/meta`: the title/icon fetcher.
- `web/src`: Svelte 5 (runes) + TypeScript. `lib/` holds state and helpers, `components/` and `views/` the UI.
- `docs/`: the VitePress site. Chinese pages at `docs/`, English ones at the same paths under `docs/en/`, listed in `docs/.vitepress/pages.ts`; theme and components in `docs/.vitepress/theme/`.

## The docs follow the code

`docs/.vitepress/sync/check.ts` compares the docs with the source and fails `make check` and every docs build on a mismatch. When you change:

- environment variables: `reference/configuration.md` and the configuration tables of both READMEs;
- API routes or error codes: `reference/api.md` (every endpoint, the index table and the error table);
- subcommands: `reference/cli.md`; reserved slugs: `guide/usage.md`;
- benchmark results: `docs/.vitepress/data/benchmark.ts` and both READMEs;
- `compose.yaml` or `deploy/*`: the deploy page's builder (`sync/builder.ts`) must still find the lines it fills in.

Update both languages; the check names what's missing. Anything else the docs claim about behavior (limits, timeouts, defaults) is checked by hand against the code, so read it before you change it.

## Invariants

- **Redirects never touch the database** when the slug is cached, and never wait on a write. Clicks are counted in memory and flushed in batches. Check `make bench` before and after changing `redirect.go`, `cache` or `clicks`.
- **No cgo.** SQLite is `modernc.org/sqlite`; the image is `FROM scratch`.
- **Security boundaries stay in place:** the SSRF guard in `internal/meta` (pre-resolve and dial-time checks), blocked URL schemes in `internal/links`, the setup code for the first password, session cookies scoped to `/api/`, `http.CrossOriginProtection`, and the admin CSP (inline scripts only by hash; `web.go` computes the hashes).
- **Untrusted input is bounded:** referrer hosts per link, limiter keys, request bodies, fetched pages and icons all have caps. New maps keyed by client input need one too.
- **Every UI string exists in both `zh` and `en`** in `web/src/lib/i18n.svelte.ts`; `zh` defines the keys and the type of `en` requires all of them. Chinese copy is written for Chinese readers, not translated word for word. The same goes for the docs: every page exists in both languages.
- **No UI or icon libraries.** Icons are hand-drawn paths in `components/Icon.svelte`; menus use the Popover API and dialogs use `<dialog>`. The docs theme copies the icons it needs into its own `Icon.vue`.
- **Accessibility:** text meets WCAG AA contrast in both themes (dim with text tokens, not opacity), every control is reachable by keyboard, and axe reports no violations, in the app and on every docs page.

## Conventions

- Go: standard library first, `gofmt`, errors wrapped with context, comments explain why rather than what.
- API errors are `{"error": {"code": "...", "message": "..."}}`; the app maps `code` to i18n keys under `err.*`.
- Dev servers listen on `127.0.0.1` only.
