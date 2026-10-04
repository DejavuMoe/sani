# Sani UI prototype

A layered reconstruction of the current Sani UI: the admin app (`web/src`) and
the visitor pages the Go server renders (`internal/server`). The baseline
(commit `f01fe22`) matches production pixel for pixel in the compared states.
Change a layer here, get it reviewed, then implement it in `web/`.

Nothing in `web/` or `internal/` imports from `designs/`, and nothing here
ships. Production code and tests stay the functional truth; this prototype
becomes the visual and interaction truth once a version is approved
(`_d_meta.json`). Revision 1 is **approved** and being implemented in `web/`.

## Revisions

| Revision | Base | Items | Status |
|---|---|---|---|
| r1 — detail polish | `f01fe22` | 10 | approved |

<http://127.0.0.1:4311/sani/changes.html> lists every item with its reason,
the prototype files it touched, the production files it would change, and
before/after crops in both themes. Items live in `src/revisions.js`. To
regenerate the crops, serve the baseline next to the current prototype:

```sh
git worktree add "$TMP/sani-r0" f01fe22        # or git archive f01fe22 designs | tar -x -C "$TMP/sani-r0"
python -m http.server 4312 --bind 127.0.0.1 --directory "$TMP/sani-r0/designs"
node designs/sani/tools/revision-shots.mjs r1  # BEFORE_URL and PROTO_URL override the two origins
```

Once a revision is approved and implemented, production catches up and
`compare.mjs` goes back to measuring parity.

## Open it

```sh
python -m http.server 4311 --bind 127.0.0.1 --directory designs
```

- <http://127.0.0.1:4311/sani/index.html>: the hub, with every layer and the comparison report
- <http://127.0.0.1:4311/sani/prototype.html>: the clickable app. The **Tweaks** button (bottom right) switches scene, theme and language.

React 18.3.1 and Babel standalone 7.29.0 load from unpkg, pinned with
integrity hashes. Everything else is local, so the pages need network access
only for those three files.

URL parameters for `prototype.html`:

| Parameter | Values | Default |
|---|---|---|
| `scene` | any id in `src/scenes.jsx` | `dashboard` |
| `theme` | `system`, `light`, `dark` | `system` |
| `lang` | `zh`, `en` | the browser's |
| `now` | an ISO time, or `live` | the fixture capture time, so relative times stay fixed |
| `host` | a host shown on the sign-in screens | `s.example.com` |
| `latency` | ms before mock requests resolve | `220` |
| `chrome` | `0` hides Tweaks | shown |

The boards take `theme=light|dark|both` and `lang=zh|en`.
`visitor.html` takes `page`, `lang`, `theme`, `until=1`, `host` and `slug`.

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
| `tools/compare.mjs [filter]` | Opens the same state in production and the prototype (same Chromium, viewport, theme, language, time zone), screenshots both and diffs them per pixel into `screenshots/compare/`. |
| `tools/probe.mjs` | Prints element boxes on both sides, to find where a layout difference starts. |
| `tools/smoke.mjs` | Loads every scene (and the pages in `PAGES`) and fails on console errors, failed requests or empty renders. |
| `tools/shot.mjs` | Screenshots one page, or one element with `--sel=`, for review. |
| `tools/a11y.mjs` | axe over every state, the visitor pages and the boards, in both themes at desktop and phone width. A `parity` list can excuse findings production shares; it is empty since r1, so any finding fails. |
| `tools/revision-shots.mjs <rev>` | Crops each item of a revision (`src/revisions.js`) from the baseline and the current prototype, in light/zh and dark/en, into `screenshots/revisions/<rev>/` for `changes.html`. |
| `tools/content.mjs` | Collects every rendered string (`collect`) and classifies the content inventory by origin (`classify`), around the skill's `content_audit.py`. |

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
seed restores it.

### Current comparison

With r1 in the prototype, the comparison measures the intended changes
against production rather than parity: the dashboard states differ by about
0.13% (toolbar, sort mark), `edit-url` by about 2.9% (form rhythm),
`detail-text` by 0.3–0.7% (code color), `picking` by 0.15–0.55% (toolbar).
Login, setup, new link, offline, the phone detail and every visitor page
still round to 0.00%. Each difference maps to an item in `changes.html`.

At the baseline (`f01fe22`), all 26 cases are captured in all four theme and
language combinations (104 captures; by default `compare.mjs` runs light/zh
and dark/en, and `VARIANTS=light-en,dark-zh` runs the other two). Every
capture rounds to 0.00% except:

- **settings** (0.08–0.10% on desktop, 0.20–0.24% on phone): expected. The
  prototype shows sanitized fixture data (request origin, files domain, time
  zone `Asia/Shanghai`) where production shows the local instance's values.
- **shortcuts** (0.45–0.51%): element geometry is identical on both sides.
  The glyphs inside the top-layer dialog are about half a pixel apart
  horizontally. That is subpixel text positioning, not a design difference.

A few captures differ by a handful of pixels (≤ 0.004%), at a text caret
position or on anti-aliased edges.

The full table is in `screenshots/compare/report.json` and on the hub page.
The PNGs are regenerated on every run and are not committed.

### Content inventory

```sh
node designs/sani/tools/content.mjs collect
python .agents/skills/prototype-first-ui/scripts/content_audit.py seed --profile operational-strict \
  --output designs/sani/content-inventory.json \
  --capture designs/sani/content/dom-app-zh.json --capture designs/sani/content/dom-app-en.json \
  --capture designs/sani/content/dom-visitor-zh.json --capture designs/sani/content/dom-visitor-en.json
node designs/sani/tools/content.mjs classify
python .agents/skills/prototype-first-ui/scripts/content_audit.py check --inventory designs/sani/content-inventory.json
```

All 778 strings come from production: i18n keys or server copy (with the key
as evidence), values production formats, or sanitized demo records. The one
exception is the sample file name `design-review.pdf` used for the upload
states. The 25 warnings are `data-*` attribute values (link ids, theme, screen
labels), which the checker always asks a person to look at.

### Production quirks found at the baseline

The baseline reproduced these on purpose; r1 resolves each of them:

- In `LinkDetail.svelte`, the `.code` rule meant for the redirect code also
  matches `<pre class="preview code">`, so code previews render in `--text-3`
  instead of `--text` (r1 `code-preview`).
- In `LinkList.svelte`, `.kind + .sort` never matches, because the kind
  menu's popover sits between the two buttons (r1 `toolbar`).
- In `LinkEditor`, the boxed SlugField keeps `flex: 1` in a column and
  collapses to 22px (r1 `editor-rhythm`).
- Four accessibility findings, from states production's own axe run doesn't
  reach, are listed in `capabilities.md` (r1 `slug-available`, `a11y`).

## Records

- `capabilities.md`: the current surfaces, states and interfaces, with evidence
- `constraints.md`: the product and content rules any revision keeps
- `ui-contract.json`: each surface mapped to its production files, interfaces and tests
- `content-inventory.json`: every rendered string, with its origin and purpose
- `design-sources.json`: where the prototype's truth comes from
- `_d_meta.json`: Baoyu-Design asset status (approval lives here)

These live in `designs/sani/` rather than the skill's default `docs/ui/` and
`docs/product/`. Everything under `docs/` is the published VitePress site, and
its sync check rejects pages that aren't in its sidebar.
