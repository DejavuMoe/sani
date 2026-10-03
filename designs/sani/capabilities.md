# Current UI capabilities and states

An inventory of Sani's existing UI, as of v0.3.0 (`c10cfd1`), drawn from
production code, the running app and tests. It lists only what exists today:
no plans, no design rationale. Paths are relative to the repository root.

## Users and primary jobs

- **The owner**, a single administrator of a self-hosted instance. They shorten links, share texts and files at `/p/`, check click counts, edit, turn off and delete links, manage API tokens, and import or export data. Evidence: `web/src/views/*`, `internal/server/api.go`.
- **Visitors**: anyone who opens a short link. They are redirected, or they see a share page or an error page. Evidence: `internal/server/redirect.go`, `web.go`, `sharepage.go`.
- **Automation**: shortcuts, Raycast and scripts, using API tokens (`Authorization: Bearer`). They have no UI of their own; the owner manages them in Settings. Evidence: `api.go` tokens routes, e2e "an API token can create links and be revoked".

## Surfaces

| Surface ID | Route/window | Purpose | Primary actions | Evidence |
|---|---|---|---|---|
| `setup` | `/admin/` while no password is set | First run: prove ownership with the setup code from the logs, then choose the password | Enter code, password and confirmation; submit | `views/Setup.svelte`, `POST /api/setup`, e2e "first run asks for the setup code…" |
| `login` | `/admin/` without a session | Sign in | Password; switch language and theme | `views/Login.svelte`, `components/AuthShell.svelte`, `POST /api/session`, e2e "signing out and back in" |
| `offline` | `/admin/` when `/api/session` fails | Server unreachable | Retry | `App.svelte` (`session.state === 'offline'`) |
| `dashboard` | `/admin/` | Create, find and manage links and shares | Create (link, text, file), search, filter by kind, sort, pick for bulk actions, open a row | `views/Dashboard.svelte`, `components/{Creator,Composer,ShareComposer,Summary,LinkList,LinkRow}.svelte` |
| `link-detail` | Row expanded on `/admin/` | Stats and actions for one link or share | Range 7/30/90 days, copy, open, QR, turn off/on, refetch title, edit, delete | `components/LinkDetail.svelte`, `GET /api/links/{id}/stats`, `…/text` |
| `link-editor` | Row in edit mode | Change destination or text, slug, title, expiry, visit limit, redirect type | Save (`Ctrl/⌘ ↵`), cancel (`Esc`) | `components/LinkEditor.svelte`, `PATCH /api/links/{id}`, e2e "the destination can be edited…" |
| `shortcuts` | `?` anywhere in the app | Keyboard reference | Close | `components/ShortcutsDialog.svelte`, `components/Dialog.svelte` |
| `settings` | `/admin/settings` | Instance settings | Theme, language, short domain, API tokens, bookmarklet and install, export/import, password, sign out other sessions, about | `views/Settings.svelte`, `/api/config`, `/api/tokens`, `/api/export`, `/api/import`, `/api/password`, `/api/sessions/revoke` |
| `new-link` | `/admin/new?url=&text=&title=` | Shortening from the bookmarklet or the PWA share target | Shortens on open; copy, open, QR, back | `views/NewLink.svelte`, `web/public/manifest.webmanifest` (`share_target.action: /admin/new`) |
| `visitor-error` | Any unknown, gone or failing slug | Readable 404 / 410 / 500 | — | `internal/server/web.go` (`pageTemplate`, `pageCopy`), e2e "unknown and gone links get a readable page" |
| `share-page` | `/p/{slug}` | Show a shared text or describe a shared file | Copy, raw, download, download file | `internal/server/sharepage.go`, e2e "a text is shared at /p/…", "a file is uploaded and downloaded…" |

## Domain objects and terminology

| Object | User-visible fields | Actions | Rules | Evidence |
|---|---|---|---|---|
| Link (`kind: url`) | slug, destination URL, title (fetched or manual), favicon, clicks, 14-day sparkline, created, last visit, expiry, visit limit, redirect (302 temporary / 301 permanent), status | create, edit, copy, open, turn off/on, refetch title, delete, restore (undo) | Status is derived: disabled → expired → limit reached → active (`store.jsx` `linkStatus`). Slugs: letters, digits, marks, `_ . -`, at most 64, no trailing dot, case-insensitive uniqueness, reserved names | `internal/links/links.go`, `internal/store`, `lib/url.ts` |
| Text share (`kind: text`) | slug under `/p/`, title or first line, format (plain/code), lines, size, views | as above, plus editing the text | At most `maxTextSize` (1 MiB by default); raw bytes are served from the files origin | `api.go` `POST /api/texts`, `sharepage.go` |
| File share (`kind: file`) | slug under `/p/`, name, media type, size, SHA-256, downloads | create, edit metadata, copy, turn off/on, delete | At most `maxFileSize` (64 MiB by default); needs `SANI_FILES_URL` (a separate host); downloads count as visits | `api.go` `POST /api/files`, `ShareComposer.svelte` |
| Overview | links, total clicks, today, 30-day bars | — | Hidden when there are no links | `components/Summary.svelte`, `GET /api/overview` |
| Referrers | host and count (direct counts separately), capped per link | — | Bounded per link (invariant in `AGENTS.md`) | `LinkDetail.svelte`, `internal/clicks` |
| API token | name, hint (`sani_xxxx`), created, last used | create (shown once), revoke | The secret is shown once after creation | `Settings.svelte`, `/api/tokens` |
| Config | short domain (setting or env), files domain, title fetching, query forwarding, slug length, limits, time zone, version | change the short domain unless it is set by env | Env-provided values are read-only in the UI | `GET/PATCH /api/config` |

## State matrix

| Flow | Ready | Loading | Empty | Error | Disabled | Permission/offline | Progress/cancel/retry | Platform |
|---|---|---|---|---|---|---|---|---|
| Session | dashboard | blank until `/api/session` answers (not modeled) | — | wrong password (`auth.wrong`); rate limited with a wait (`auth.rateLimited`); setup code wrong; passwords short or mismatched | — | session expired → login with `auth.expired`; server down → offline + retry | — | — |
| Link list | rows | ghost rows; stale (dimmed) while reloading | first run (`list.emptyTitle`); no search results; no items of a kind | load failed + retry | — | — | more pages load at the end of the list (`ll-sentinel`) | phone layout under 640px drops columns |
| Composer (link) | idle | submit busy | — | field errors from the API (`err.url_*`, `err.slug_*`, `err.expires_*`) | submit disabled while empty | — | — | paste anywhere fills it (`composer.pasted`) |
| Composer (text) | idle | busy | — | `err.text_required`, `err.text_too_large` | — | — | — | `Ctrl/⌘ ↵` submits |
| Composer (file) | drop zone | — | — | `err.file_too_large`, `err.upload_invalid` | turned off when `filesUrl` is null (`share.fileDisabled`) | — | upload progress, cancel (`share.uploading`, `share.canceled`) | drag and drop anywhere on the page |
| Slug field | idle | checking (220 ms debounce) | — | taken, reserved, invalid, too long | — | — | — | — |
| Detail | stats | — | no visits (`detail.noVisits`, dimmed chart) | — | status badge for disabled, expired, limit reached | — | refetch title ("fetching") | QR on desktop |
| Bulk actions | count, enable / disable / delete | busy | none picked → actions disabled | per-action error toast | over `MAX_PICK` (500) not pickable | — | delete offers undo | `X` toggles; shift-click picks a range |
| Settings | sections | — | no tokens | `err.base_url_invalid`, `err.password_short`, `err.wrong_password`, `err.import_unreadable` | domain and password read-only when set by env | — | import progress and result (imported / skipped) | install hint (`settings.install`) |
| Visitor pages | redirect or share page | — | — | 404, 410, 500; share 404 / 410 | file download unavailable | — | — | language from `Accept-Language`, theme from the system |

## System interfaces

| UI action | Interface | Payload/result | On failure | Source/tests |
|---|---|---|---|---|
| Boot | `GET /api/session` | `{state}` | offline screen | `lib/session.svelte.ts` |
| Set up | `POST /api/setup` | code, password | `err.setup_code`, `err.password_short` | e2e first run |
| Sign in / out | `POST` / `DELETE /api/session` | password | `auth.wrong`, `auth.rateLimited` | e2e signing out and back in |
| List / search / sort / filter | `GET /api/links?q&sort&kind&cursor&limit` | page of links with sparkline | list error + retry | e2e search |
| Overview | `GET /api/overview?days=30` | totals and days | dashes | `Summary.svelte` |
| Create link | `POST /api/links` | url, slug, title, expiresAt, maxClicks, redirect, reuse | field error under the composer | e2e pasted URL, custom slugs |
| Share text / file | `POST /api/texts`, `POST /api/files` (multipart, progress) | text + format / file | error toast or field error | e2e text, file |
| Check slug | `GET /api/slugs/{slug}` | available / taken / reserved / invalid | — | e2e custom slugs |
| Edit | `PATCH /api/links/{id}` | changed fields | field errors in the editor | e2e destination edit |
| Turn off / on | `PATCH /api/links/{id}` `{enabled}` | — | toast | e2e turned off and on |
| Delete / undo | `DELETE /api/links/{id}`, `POST …/restore` | — | toast | e2e deleting offers undo |
| Bulk | `POST /api/links/bulk` | ids, action | toast | e2e several links at once |
| Stats | `GET /api/links/{id}/stats?days=` | days, referrers | — | `LinkDetail.svelte` |
| Text body | `GET /api/links/{id}/text` | text | — | `LinkDetail.svelte`, `LinkEditor.svelte` |
| Refetch title | `POST /api/links/{id}/refresh` | — | meta `failed` | `LinkDetail.svelte` |
| Favicons | `GET /api/favicons/{host}` | image | letter tile | `Favicon.svelte` |
| Settings | `/api/config`, `/api/tokens`, `/api/password`, `/api/sessions/revoke`, `/api/export`, `/api/import` | — | inline errors, toasts | e2e API token |

Error envelope: `{"error": {"code", "message"}}`, with `code` mapped to
`err.*` (`web/src/lib/i18n.svelte.ts`). Reference: `docs/reference/api.md`.

## Interaction and accessibility behavior

- **Keyboard and focus:** `N` new, `/` search, `J`/`K` or the arrows move, `↵` opens or closes, `C` copies, `E` edits, `Ctrl/⌘ ↵` saves, `Del` (`⌘ ⌫` on macOS) deletes, `X` picks, `Esc` backs out, `?` shows the sheet. Evidence: `Dashboard.svelte`, `ShortcutsDialog.svelte`, e2e keyboard test. Menus close on `Tab`; arrows, `Home` and `End` move within them; segmented controls and tabs move with the arrows.
- **Pointer, touch and drop:** paste anywhere fills the composer; dropping a file anywhere opens the file tab; shift-click picks a range; the shortcuts button is hidden on touch.
- **Announcements:** the toaster is `role=status aria-live=polite`; slug status, search result count and picked count are live; charts include a screen-reader table.
- **Motion and contrast:** `prefers-reduced-motion` cuts transitions to 1 ms; text tokens clear 4.5:1 in both themes (the L1 board computes each ratio); `--text-4` is for disabled states and marks only. Axe runs in `pnpm --dir web a11y`.
- **Localization:** `zh` and `en`, with every key in both. `zh` defines the keys; English has plurals (`.one` / `.other`). The language comes from preferences or the browser.

## Platform, viewport and runtime constraints

- Modern evergreen browsers: the Popover API, `<dialog>` and `color-mix()`.
- Page column of 920px; the gutter shrinks from 24px to 16px under 640px. Phone layouts are checked at 390×844.
- Installable PWA with a share target. The admin CSP admits inline scripts only by hash. Cookies are scoped to `/api/`.
- Shared bytes are served only from the files origin (`SANI_FILES_URL`), never from the admin origin.

## Content authority currently evidenced

- **Domain terminology:** `web/src/lib/i18n.svelte.ts` (zh and en), `internal/server/web.go` `pageCopy`, `sharepage.go` `shareCopy`.
- **State and error strings that must stay compatible:** the `err.*` keys for every API error code (`docs/reference/api.md`).
- **Approved marketing or content copy:** none in the app; the README and docs are outside the UI.

## Accessibility findings in production

`tools/a11y.mjs` runs axe over every prototype state, including states that
`pnpm --dir web a11y` does not reach. Since the prototype reproduces
production, these findings apply to production as well. Each was checked in
the source. The prototype keeps them for parity; fixing them is production
work, outside this design pass.

| Rule (impact) | Where | State that shows it |
|---|---|---|
| `color-contrast` (serious) | `web/src/components/SlugField.svelte:238`: the "available" status text uses `--success`, 4.39:1 on `--surface` in the light theme (dark: 8.07:1) | Typing a free custom slug |
| `aria-prohibited-attr` (serious) | `web/src/components/LinkList.svelte:213`: `aria-label` on a `div` with no role (the loading card) | First load of the list |
| `scrollable-region-focusable` (serious) | `web/src/views/Settings.svelte:262`: the curl example `<pre>` scrolls sideways on phones but cannot be focused | Settings on a phone |
| `page-has-heading-one` (moderate) | `web/src/App.svelte` offline state; `web/src/views/NewLink.svelte` | Offline, `/admin/new` |

## Known unknowns

- The boot state before `/api/session` answers renders nothing. Production does the same, so it isn't modeled.
- Whether code previews in the detail panel are meant to be `--text-3` (see README, "Observed quirks").
- Installing the PWA was not exercised in any browser.
- Share-target behavior on mobile operating systems was not exercised. The prototype opens `/admin/new` states directly.
