# Sani UI prototype

Interactive prototypes for the Sani admin app (`web/src`) and the visitor pages
(`internal/server`). Review a change here before implementing it in `web/`.

Nothing in `web/` or `internal/` imports from `designs/`, and nothing here
ships. Production code and tests stay the functional truth; this prototype is
the visual and interaction truth for what it shows. Earlier revisions live in
git history.

## Open it

```sh
python -m http.server 4311 --bind 127.0.0.1 --directory designs
```

- <http://127.0.0.1:4311/sani/prototype-time.html>: the current admin app. The **Tweaks** button (bottom right) switches scene, theme and language.
- <http://127.0.0.1:4311/sani/visitor-r11.html>: the current visitor pages (password prompts for links, texts and files).
- <http://127.0.0.1:4311/sani/index.html>: the baseline boards (`prototype.html`, `visitor.html`) with every layer and the production comparison report.

React 18.3.1 and Babel standalone 7.29.0 load from unpkg, pinned with
integrity hashes. Everything else is local, so the pages need network access
only for those three files.

URL parameters for the prototype pages:

| Parameter | Values | Default |
|---|---|---|
| `scene` | any scene id, listed in Tweaks | `dashboard` |
| `theme` | `system`, `light`, `dark` | `system` |
| `lang` | `zh`, `en` | the browser's |
| `now` | an ISO time, or `live` | the fixture capture time, so relative times stay fixed |
| `host` | a host shown on the sign-in screens | `s.example.com` |
| `latency` | ms before mock requests resolve | `220` |
| `chrome` | `0` hides Tweaks | shown |

The boards take `theme=light|dark|both` and `lang=zh|en`. `visitor-r11.html`
takes `page`, `lang`, `theme` and `host`. Example passwords: text `7KQ2MX`,
file `R4TQ8N`, link `H3KP9W`.

## What the current prototype specifies

**Access passwords** (links, texts and files)

| Where | Design |
|---|---|
| Create | Expiry, visit limit and access password sit side by side before the submit button, each an icon plus its current value. |
| Password popover | Opens with a generated 6-character password, selected, and Enter confirms. Characters exclude 0/O and 1/I/L. Regenerate or type your own (4–64 characters); a set password offers Remove. |
| After creating | The clipboard gets the link and a "Password: XXXXXX" line. |
| List and detail | A lock icon marks protected rows; copy takes link and password. Detail shows the password masked, with show and copy. |
| Edit | An "Access password" field with a Generate button; clearing it removes the password. |
| Visitor | A script-free form: lock icon, the short address, one field, Continue. Errors: empty, wrong, too many attempts. Comparison ignores case. |

**Expiry and creation controls**

| Surface | Behavior |
|---|---|
| Expiry popover | Presets and a custom time; the draft commits only on Apply. Cancel, Esc and clicking outside keep the old value. |
| Time entry | Editable `HH:mm` with a two-column hour/minute menu; selection is the check alone and Done is a plain item. |
| Creation actions | Link, text and file actions share one height, corner and state set. Link and text show Enter key badges, hidden on touch and narrow screens; a file upload's busy action shows its percentage. |

The visual rules (Radix colour roles, 0.5px lines, four type sizes, concentric
corners, motion) are in [constraints.md](constraints.md).

## Layers

| Layer | Files | Board | Ported from |
|---|---|---|---|
| L0 logic | `src/lib.jsx` | — | `web/src/lib/{i18n,url,size,expiry,keys,qr,toast}` |
| L1 foundations | `src/gen/tokens.css`, `src/fonts.css` | `foundations.html` | `web/src/app.css`, `Icon.svelte`, `Logo.svelte` |
| L2 components | `src/components.jsx`, `src/css/components.css` | `components.html` | `web/src/components/*` (primitives) |
| L3 patterns | `src/patterns.jsx`, `src/css/patterns.css`, `src/store.jsx` | `patterns.html` | `web/src/components/*` (composites), `lib/links.svelte.ts` |
| L4 screens | `src/screens.jsx`, `src/css/screens.css` | `screens.html` | `web/src/views/*` |
| L5 app | `src/app.jsx`, `src/scenes.jsx` | `prototype.html` | `web/src/App.svelte`, `lib/session`, `lib/router` |
| Visitor | `visitor.html`, `src/gen/visitor.js` | `visitors.html` | `internal/server/web.go`, `sharepage.go` |

Each layer uses only the layers below it. `src/board.jsx` and
`src/css/board.css` hold the board shell, and `src/css/proto.css` styles
Tweaks. Both are prototype chrome and never part of a design.

The current pages (`prototype-time.html`, `visitor-r11.html`) are built on top
of the baseline: later changes are added as small override layers in
`src/r2` … `src/r11`, `src/expiry` and `src/time`, loaded in order. A file in
a later layer replaces what it redefines, so keep the load order in the HTML.
`src/r11/app.css` is derived from `src/r10/app.css` and `src/r10/controls.css`
by `tools/r11-css.mjs`.

### Naming

Svelte scopes styles per component, but the prototype has no scoping. Every
class therefore carries a prefix for its component. Button's `.primary`
becomes `.btn-primary`. The other prefixes:

| Prefix | Component | Prefix | Component |
|---|---|---|---|
| `mi` | MenuItem | `slugf` | SlugField |
| `cmp-` | Composer, ShareComposer | `cr-` | Creator |
| `sum` | Summary | `ll-` | LinkList |
| `lr-` | LinkRow | `ld-` | LinkDetail |
| `le-` | LinkEditor | `hd-` | AppHeader |
| `auth-` | AuthShell | `st-` | Settings |
| `nl-` | NewLink | `dash` | Dashboard |

A descendant selector can reach into nested components, which Svelte's scoping
prevents. Where production relied on that, the port uses child combinators, as
in `.ll-card > ul > li + li`. Tokens, `.field`, `.label`, `.hint`,
`.error-text`, `kbd` and the other global rules from `app.css` keep their
names.

## Keeping it aligned

| Tool | Does |
|---|---|
| `tools/sync.mjs [--check]` | Copies tokens, both dictionaries, icon paths, the QR encoder, fonts, and the visitor pages' styles and copy out of production source into `src/gen/` and `src/fonts/`. `--check` exits 1 on drift. |
| `tools/capture.mjs` | Reads a seeded instance through the API into `src/fixtures.js` (links, stats, texts, tokens, overview, config) and saves favicons. Origins are rewritten to `s.example.com` / `files.example.com`. |
| `tools/compare.mjs [filter]` | Opens the same state in production and the baseline prototype (same Chromium, viewport, theme, language, time zone), screenshots both and diffs them per pixel into `screenshots/compare/`. |
| `tools/probe.mjs` | Prints element boxes on both sides, to find where a layout difference starts. |
| `tools/smoke.mjs` | Loads every scene (and the pages in `PAGES`) and fails on console errors, failed requests or empty renders. |
| `tools/shot.mjs` | Screenshots one page, or one element with `--sel=`, for review. |
| `tools/a11y.mjs` | axe over every state, the visitor pages and the boards, in both themes at desktop and phone width. |
| `tools/time-check.mjs` | Checks the expiry popover, time menu and creation actions of `prototype-time.html` at both widths, in both languages and themes, with axe. |
| `tools/revision-shots.mjs <rev>` | Crops each item of a revision (`src/revisions.js`) from the baseline and the current prototype into `screenshots/revisions/<rev>/` for `changes.html`. |
| `tools/r11-css.mjs` | Rebuilds `src/r11/app.css` from the R10 stylesheets. |
| `tools/collect-dom-content.js` | Collects the rendered text and structure of a page, injected by the check tools. |

To set up production for capture and comparison, run from the repository root:

```sh
make build
go run ./scripts/seed -data /tmp/sani-proto -password sani-demo
SANI_LISTEN=127.0.0.1:18080 SANI_DATA_DIR=/tmp/sani-proto SANI_FILES_URL=http://localhost:18080 ./bin/sani &
SANI_LISTEN=127.0.0.1:18081 SANI_DATA_DIR=/tmp/sani-fresh ./bin/sani &     # first-run screen
node designs/sani/tools/capture.mjs      # only when the fixtures should change
node designs/sani/tools/compare.mjs
```

Comparing visits the seeded instance, which adds clicks to its data. A fresh
seed restores it. The full table is in `screenshots/compare/report.json` and
on the hub page; the PNGs are regenerated on every run and are not committed.

## Records

- `capabilities.md`: the current surfaces, states and interfaces, with evidence
- `constraints.md`: the product and content rules any revision keeps
- `ui-contract.json`: each surface mapped to its production files, interfaces and tests
- `design-sources.json`: where the prototype's truth comes from
- `_d_meta.json`: Baoyu-Design asset status (approval lives here)

These live in `designs/sani/` rather than the skill's default `docs/ui/` and
`docs/product/`. Everything under `docs/` is the published VitePress site, and
its sync check rejects pages that aren't in its sidebar.
