// Derives designs/sani/src/r11/app.css from the approved R10 cascade.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
const src = join(root, 'designs/sani/src');
let css = readFileSync(join(src, 'r10/app.css'), 'utf8') + '\n' + readFileSync(join(src, 'r10/controls.css'), 'utf8');

// Four sizes: 12 meta, 13 body and controls, 16 headings, 20 figures.
const step = (px) => (px <= 12.5 ? 12 : px <= 14.5 ? 13 : px <= 17 ? 16 : 20);
css = css.replace(/(font-size:\s*(?:var\([^,]+,\s*)?)(\d+(?:\.\d+)?)px/g, (_, k, n) => `${k}${step(Number(n))}px`);
css = css.replace(/(font:\s*(?:\d{3}\s+)?)(\d+(?:\.\d+)?)px/g, (_, k, n) => `${k}${step(Number(n))}px`);

// Motion: one 250ms ease-out step.
css = css.replace(/\b(80|120|140|160|180|200|240)ms\b/g, '250ms');

// Hairlines. Browsers round borders under one device pixel up to a full
// pixel, so 1px borders become inset 0.5px shadows drawn from per-side,
// non-inherited colour properties (declared in theme.css). Rules that set
// their own box-shadow keep the hairline by prefixing --hair-shadow.
const sides = ['t', 'r', 'b', 'l'];
const sideOf = { top: 't', right: 'r', bottom: 'b', left: 'l' };
const set = (keys, v) => keys.map((k) => `--hb${k}: ${v}`).join('; ');
css = css.replace(/border-bottom-width:\s*1\.5px;?/g, '');
css = css.replace(/(^|[{;\s])border:\s*1px solid ([^;}]+)/g, (_, pre, v) => `${pre}border: 0; ${set(sides, v.trim())}`);
css = css.replace(/(^|[{;\s])border-(top|right|bottom|left):\s*1px solid ([^;}]+)/g, (_, pre, s, v) => `${pre}border-${s}: 0; ${set([sideOf[s]], v.trim())}`);
css = css.replace(/(^|[{;\s])border-color:\s*([^;}]+)/g, (_, pre, v) => `${pre}${set(sides, v.trim())}`);
css = css.replace(/(^|[{;\s])border-(top|right|bottom|left)-color:\s*([^;}]+)/g, (m, pre, s, v) => `${pre}--hb${sideOf[s]}: ${v.trim()}`);
css = css.replace(/(^|[{;\s])border:\s*(0|none)(\s*;|\s*})/g, (_, pre, z, end) => `${pre}border: 0; ${set(sides, 'transparent')}${end}`);
css = css.replace(/(^|[{;\s])box-shadow:\s*([^;}]+)/g, (_, pre, v) => `${pre}box-shadow: ${v.trim() === 'none' ? 'var(--hair-shadow)' : 'var(--hair-shadow), ' + v.trim().replace(/\binset 0 0 0 1px\b/g, 'inset 0 0 0 0.5px')}`);

// Spinners and checkboxes keep real borders.
css = css.replace(/(1\.5px solid currentColor;) --hbr: transparent;/g, '$1 border-right-color: transparent;');
writeFileSync(join(src, 'r11/app.css'), '/* R11: generated from R10 app.css + controls.css (type steps, motion, hairlines). Hand edits live in r11/theme.css. */\n' + css);
const left = css.match(/[^\n]*\b1px solid[^\n]*/g) ?? [];
console.log('remaining 1px solid:', left.length);
for (const l of left) console.log('  ', l.trim().slice(0, 140));
