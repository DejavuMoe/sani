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

## Consistency revision, 2026-11-02

A review against the rest of the app aligned the prototype and production:

- The expiry popover uses the access popover's insets, hairline footer and
  end-aligned placement (`AccessPopover.svelte`; `.r11-pop-foot` in the prototype).
- Time menu selection is the check alone; Done is a plain menu item after a
  separator. In dark the time menu has a `--line-3` edge.
- Creation actions keep `Button`'s disabled, busy and focus states and use
  6px concentric corners; the link action is 40px inside its 52px row.
- Shortcuts show as tooltips with a fine pointer (`src/time/shortcut-tips.js`,
  `shortcutTip()` in `web/src/lib/tooltip.ts`), not as key badges.
- A file upload's busy action shows its percentage instead of a spinner.

Evidence: `review-unify/` (from `tools/time-check.mjs` and `tools/actions-check.mjs`).
