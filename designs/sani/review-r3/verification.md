# R3 review evidence

Verified locally on 2026-10-08/09. These are prototype checks, not production acceptance or proof of proxy/CDN behavior. Browser interaction used Codex's in-app browser via CUA; no production host or database was accessed.

## Executed checks

- `node designs/sani/tools/r3-check.mjs`: passed 26 valid/invalid color cases, all 12 presets and the native JSON example identity.
- Shared picker: create using RGB/HSL; edit name/color; reject alpha, arbitrary named colors and invalid syntax; editing an existing link exposes the same 12 presets; Escape returns focus to the invoking button.
- Settings: saved length and file size reflected in the current app; returning to file creation showed the changed 256 MB limit; invalid length disables Save and has an explanatory error; environment-controlled values are disabled; missing proxy disables the proxy option; off/direct/proxy descriptions change with selection.
- Upload simulation: 72 MB fixture, first-attempt failure, retry from a completed chunk, successful result, cancellation and configured-size rejection. No file bytes were uploaded and no real upload session was created.
- Native examples: bundled CSV creates one mock link; importing the JSON equivalent skips the duplicate; unsupported fixture produces an error. The prototype parser intentionally only recognizes the bundled sample bytes; real imports belong to the later backend implementation.
- Layout: at 1280, 390 and 320px, tab switches preserve logo/main-column x coordinates and width. `geometry.json` records final measurements. Natural vertical differences between URL/text/file bodies remain intentional. Desktop expiry menu and shortcut dialog preserve logo x = 168.5px and document width = 1265px.
- The old settings-about file domain overflowed the 320px English viewport (scrollWidth 323 vs clientWidth 305). After the R3 wrapping fix, both are 305. English text composer also has no horizontal overflow.
- Copy/Open actions both measure 30px tall, 12.5px type and a 16×16 icon viewBox on desktop. Mobile action targets use a 44px minimum.
- Checked Chinese/English, light/dark, desktop and narrow layouts. No browser console errors in checked states. Screenshot evidence is stored alongside this file.
- 27 rendered DOM captures (17 Chinese, 10 English) contributed 588 unique strings to the existing inventory. New operational copy and fixtures were classified. CUA's read-only DOM does not expose TreeWalker, so a read-only equivalent enumerated text nodes and accessibility labels; pseudo-elements, client JSON, comments, OS-native color picker and browser chrome were not captured.
- Design-source and draft-contract validators pass. The merged content audit passes; its 26 `dom-metadata` warnings already existed in HEAD, with zero added flags. Design-scope validation confirms all changes are under `designs/`. `git diff --check` passes.

## Limits

Full application `make check test e2e smoke docs bench`, automated axe, OS-native color picker behavior and mobile on-screen keyboard behavior were not run in this design-only stage. No actual Shlink import, authenticated proxy traffic, Cloudflare chunk transfer, persistent configuration or upload cleanup was implemented or claimed as tested. The implementation test matrix is in `../r3-handoff.md`.

The prior approved assets and production code are unchanged. Approval status is recorded only in `../_d_meta.json`; this file is evidence, not approval.
