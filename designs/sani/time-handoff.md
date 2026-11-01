# Expiry and creation controls

The user approved `prototype-time.html` for implementation on 2026-11-01.
This final preview includes the expiry popover, unified creation actions and
hour/minute selector. Earlier previews are retained as review history.

| Approved surface | Production | Interface | Verification |
| --- | --- | --- | --- |
| Presets and custom expiry, apply/cancel/dismiss | `ExpiryPicker.svelte`, `AccessPopover.svelte`, `AccessBar.svelte` in all composers and LinkEditor | Existing `Expiry` binding; draft commits only on Apply | Expiry regression tests; create and edit persistence |
| Editable time with two-column menu | `DateEditor.svelte`, existing `Menu.svelte` and `MenuItem.svelte`, i18n | Local HH:mm; existing future-date validation | Pointer, keyboard, invalid input, nested dismissal, zh/en, light/dark, desktop/mobile |
| Link/text/file submit | `Composer.svelte`, `ShareComposer.svelte`, existing `Button.svelte`, shared CSS | Existing submit, upload and shortcut handlers | Equal dimensions and states, submission/upload tests |

No API, storage, dependencies or deployment changes are required.
Prototype evidence: `review-expiry/`, `review-actions/`, `review-time/`.
