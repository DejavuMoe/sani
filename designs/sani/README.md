# Sani UI prototype

A layered reconstruction of the current Sani UI: the admin app (`web/src`) and
the visitor pages the Go server renders (`internal/server`). It matches
production pixel for pixel in the compared states. Change a layer here, get it
reviewed, then implement it in `web/`.

Nothing in `web/` or `internal/` imports from `designs/`, and nothing here
ships. Production code and tests stay the functional truth; this prototype
becomes the visual and interaction truth once a version is approved
(`_d_meta.json`). Revisions 1–3 are approved and implemented; R4 needs changes;
R5 and R6 are approved and implemented. R7 is approved and implemented.

## Revisions

R7 is approved: [review hub](http://127.0.0.1:4311/sani/review-r7.html), [full prototype](http://127.0.0.1:4311/sani/prototype-r7.html?scene=r7-dashboard&lang=zh&theme=light&chrome=0). Scope, state contracts and implementation boundaries are in [r7-handoff.md](r7-handoff.md). Production verification and screenshots are in `implementation-r7/`.

R6 is approved and implemented; see [r6-handoff.md](r6-handoff.md) for implementation and responsive verification. Approval status is authoritative in `_d_meta.json`; implementation evidence is recorded by revision below. Release or deployment must not be inferred from design approval.

| Revision | Base | Items | Approved | Implemented |
|---|---|---|---|---|
| r1 — detail polish | `f01fe22` | 10 | `c28d7ef` | `0ea9e05` |
| r2 — link tags | `61d2a5f` | Create, edit, filter | `99109ac` | Implemented 2026-10-07; schema 4 |
| r3 — admin refinements | `fc391bd` | Colors, defaults, uploads, metadata | `81e5609` | `e58de51` / v0.9.0 |
| r4 — metadata connections | `e58de51` | In-admin relay/HTTP/SOCKS and custom controls | Changes requested | Not implemented |
| r5 — compact settings | R4 | One connection selector, aligned controls, no hosted relay | `81a1762` | `eeea4eb`; see r5-handoff.md |
| r6 — creation defaults and text preview | R5 | Independent URL/text/file lengths, stable content preview | `a4a77b7` | `480c707`, responsive fix `0b9b1bd`; see r6-handoff.md |
| r7 — management and recovery | R6 / `934c5f0` | Tag lifecycle, drafts, errors, copy and delivery boundaries | `2cce5c1` / 2026-10-10 | Implemented 2026-10-10; see r7-handoff.md |

### R5 — compact settings (approved)

Open [R5 settings](http://127.0.0.1:4311/sani/prototype-r5.html?scene=r5-settings&lang=zh&theme=light&chrome=0).
The connection selector is one existing Segmented control: Direct / HTTP(S) /
SOCKS5. Fields use the original flat settings layout. Jina, its API key and the
nested connection dropdown/card are removed. Input/action pairs use equal
heights throughout Settings, including the domain and API token forms.
See [r5-handoff.md](r5-handoff.md) for the three comment fixes and verification.
R5 keeps R1–R4 snapshots intact. Saves and connection tests remain in-memory
simulations; the approved production implementation is recorded in r5-handoff.md.

### R4 — metadata connections (changes requested)

Open [R4 settings](http://127.0.0.1:4311/sani/prototype-r4.html?scene=r4-settings&lang=zh&theme=light&chrome=0).
See [r4-handoff.md](r4-handoff.md) for the verified docs deployment mismatch,
relay capabilities, interaction states, production implementation boundary and checks.
The no-browser-default-controls rule is in [constraints.md](constraints.md) and root `AGENTS.md`.
R4 preserves the approved R3 assets and adds only overrides under `src/r4/`.
Connection tests are simulated; there are no production API calls or saved credentials.

### R2 — tags (implemented)

Open [prototype-r2.html](http://127.0.0.1:4311/sani/prototype-r2.html?scene=tags-create&lang=zh&theme=light).
The approved `prototype.html` and its scripts remain unchanged. R2 reuses the
same tokens, primitives, screens and fixtures; only the changed pattern and
store layers are copied into `src/r2/` so the original stays reviewable.

The approved flow supports multiple tags when creating a short link, text or
file share. Choose existing tags or create one in place; edit assignments in
the existing link editor. The list shows compact badges in a desktop column
and below each destination on phones. A tag filter intersects search and type;
“Untagged” finds records without tags. Counts refer to all records in each tag.
Newly created links clear filters so the result is visible.
Creation time appears only in the expanded link detail; the list's sort menu
still supports creation time and last visit.

Rules: up to five tags per link, 24 Unicode code points per
name, whitespace trimming and case-insensitive NFC deduplication. Color is
optional and defaults to blue. Names are user data and are not translated.
Tags are private to the administrator and do not appear on visitor pages.
The prototype keeps assignments in memory; reloading restores its sample data.
The implementation persists the tag catalog and assignments in SQLite.

Review scenes: `tags-create`, `tags-filter`, `tags-untagged`, `tags-empty`,
`tags-noresults`, `tags-edit`, and `tags-save-error` (first save fails; retry
preserves the form). Existing text/file, disabled, loading and error scenes
remain available through Tweaks. Both languages and themes use the same flow.

Production mappings are recorded in `ui-contract.json`. `Link`, `LinkInput`
and `FileFields` carry tag IDs; authenticated `/api/tags` manages the catalog.
Schema 4 adds `tags` and `link_tags`, with transactional assignment updates,
foreign keys and a filter index. Portable JSON/CSV exports use names and colors.
The catalog is bounded at 1,000 tags; tags never appear on visitor pages.

Implementation verification on 2026-10-07: `make check test e2e` and `make docs`,
including schema-3 upgrade, backup/reopen, assignment rollback, filtering,
upload cleanup and cross-instance import/export tests. Browser checks cover
creation, failed-save retry, editing, cancellation, filtering, text/file uploads,
refresh persistence and delayed-response protection. The rendered review covers
both languages and themes, desktop and phone layouts, widths from 320 to 1280px,
keyboard operation and native popover bounds. All 92 tag-state axe/reflow checks
and 26 existing app/visitor axe checks passed. Native mobile browsers have not
been tested. Screenshots and DOM captures are generated review artifacts.

<http://127.0.0.1:4311/sani/changes.html> lists every item with its reason,
the prototype files it touched, the production files it changes, and
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

### Revision 1 comparison

With r1 implemented (`0ea9e05`), all 26 cases are captured in all four theme
and language combinations (104 captures; by default `compare.mjs` runs
light/zh and dark/en, and `VARIANTS=light-en,dark-zh` runs the other two).
Every capture rounds to 0.00% except:

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

The inventory now contains 1221 reviewed strings, including 447 strings captured
from the implemented tag flow in both languages. Sources include production
i18n/server copy, formatted values, sanitized demo records and approved R2 mock
copy and the R3–R5 proposals. Historical proposal strings stay traceable even
when a later revision removes them. The 26 warnings are reviewed `data-*` metadata values (link IDs, theme and
screen labels). No strings remain unclassified.

### Production quirks found at the baseline

The baseline reproduced these on purpose; r1 resolves each of them, in the
prototype and in production:

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

## R3（2026-10-08，已批准并实施）

`prototype-r3.html` 在保留 R2 的基础上扩展标签颜色、创建默认值、网页信息获取方式、导入示例和交互细节。打开 `?lang=zh&theme=light&chrome=0` 或 `?scene=r3-settings`。技术取舍、范围、场景和验收见 [r3-handoff.md](r3-handoff.md)。原型使用内存演示；其批准范围已在 v0.9.0 实施。

## R5（2026-10-09，已批准并实施）

`prototype-r5.html?scene=r5-settings&lang=zh&theme=light&chrome=0` 恢复紧凑设置布局；后台直接配置 HTTP(S)/SOCKS5，移除公共商业中继，并统一应用内颜色、日期和提示控件。对应设计提交 `81a1762`，实现与本地验证记录见 [r5-handoff.md](r5-handoff.md)。R4 保留为被要求修改的历史方案；该记录只证明设计与实现状态；发布和部署需另行核对。
