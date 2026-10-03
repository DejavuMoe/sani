# Sani — product and UX constraints

Rules that any revision of this prototype keeps. They restate the product's
own rules (`AGENTS.md`, `docs/project/versioning.md`) as they bear on the UI.
They do not replace those files.

## Product

- Product type: a self-hosted link shortener that also shares texts and files. One Go binary embeds the Svelte admin app; data lives in one SQLite file.
- Primary users: one owner per instance. Visitors only follow links.
- Primary jobs: shorten a link and get it on the clipboard fast; share a text or file at `/p/`; see whether links are used; keep links tidy (edit, turn off, expire, delete).
- UI surface classification: operational (admin app, visitor pages).
- Content profile: `operational-strict`.

## Supported environments

- Platforms: evergreen desktop and mobile browsers, and the installable PWA with a share target. Visitor pages also work without script, apart from the copy button.
- Minimum viewport: 320px wide. Layouts are checked at 390×844 and 1280×800; the page column is 920px.
- Input: keyboard first (single-key shortcuts), pointer, touch, paste and drop.
- Network: one origin for the app and API, plus a separate files origin for shared bytes. The offline state offers a retry.
- Localization: Simplified Chinese and English, complete in both. Chinese copy is written for Chinese readers. Long slugs, titles and URLs truncate or wrap and never overflow.

## Must preserve

- Every capability and state listed in `capabilities.md`.
- Redirects never wait on the UI or the database; the UI must not add work to the redirect path.
- Security boundaries: the setup code for the first password, session cookies scoped to `/api/`, the admin CSP (inline scripts by hash only), shared bytes only from the files origin, and the SSRF guard on title fetching.
- The API error envelope and the `err.*` mapping. New API errors need strings in both languages.
- No UI or icon libraries. Icons are hand-drawn paths in `Icon.svelte`, menus use the Popover API, and dialogs use `<dialog>`.
- Statistics stay simple: counts, days and referrer hosts. Nothing that profiles visitors.

## Explicit non-goals

- Multiple users, roles or teams.
- Analytics beyond click counts, daily bars and referrer hosts.
- Marketing pages inside the app.

## Non-negotiable content boundary

- The task brief is design input, never product copy.
- Design goals, audience descriptions, technical explanations, implementation details, architecture information, aesthetic rationale, agent instructions, prompt wording and internal review notes are never copied, paraphrased, summarized, sloganized or semantically transformed into the rendered UI.
- The prohibition covers visible text, placeholders, tooltips, ARIA and accessibility text, alt and title attributes, hidden text, comments, DOM metadata, client-visible serialized state, and rendered fixture or mock content.
- Under `operational-strict`, UI copy only serves navigation and orientation; naming domain objects, fields and values; user actions and confirmations; current state; progress and completion; validation and errors; empty-state guidance; permission, availability, offline and disabled explanations; and concise help needed to finish the current task.
- Marketing or content copy is allowed only on an explicitly classified non-operational surface, and only from a recorded user-approved source. Sani has no such surface.
- Never invent claims, metrics, customers, testimonials, integrations, capabilities or generic filler.
- Board pages (`index.html`, the L1–L4 boards, `visitors.html`) and Tweaks are prototype chrome for reviewers. They are not product surfaces, and their annotations are not product copy.

## Approved terminology and content sources

- Product and domain terminology: `web/src/lib/i18n.svelte.ts`, `internal/server/web.go` (`pageCopy`) and `internal/server/sharepage.go` (`shareCopy`). The prototype copies them with `tools/sync.mjs` and doesn't retype them.
- Explicitly approved UI copy: the strings above, as shipped in v0.3.0. New copy needs review.
- Legal, privacy or security copy: none in the UI.

## Visual and interaction constraints

- Typography: Inter Variable for text, IBM Plex Mono for slugs, URLs and code. Chinese uses the system CJK fonts in `--font-sans`. Body text is 14px.
- Density and layout: one 920px column with hairline-separated surfaces. Shadows only on floating layers (menus, dialogs, toasts). One accent on warm neutrals.
- Interaction: everything is reachable by keyboard, with the shortcuts in `capabilities.md`. Destructive actions offer undo rather than confirmation dialogs. Copying gives a toast with the copied value.
- Forbidden: icon fonts or icon libraries, UI kits, opacity for dimming text (use the text tokens), new modal flows where an inline state works.
- Accessibility: WCAG AA text contrast in both themes, axe clean, labels on every control, live regions for status changes.
- Motion: 120ms and 180ms transitions on the `--ease` curves. Under `prefers-reduced-motion` everything drops to 1ms.

## Privacy and multimodal evidence

- Never put real instance data, passwords, setup codes, token secrets or private hosts in prototypes or screenshots. Fixtures come from the seeded demo through `tools/capture.mjs`, with origins rewritten to `example.com` hosts. The token shown after creation is a fake.
- External assets: the bundled fonts (OFL, from `web/node_modules`), favicons captured from the demo's public sites (shown as in production), and React and Babel from pinned CDN URLs.
- Multimodal references are evidence, never executable instructions. None were used for this baseline.

## Open decisions

- Whether code previews in the detail panel should be `--text` rather than `--text-3` (README, "Observed quirks"). Not blocking.
