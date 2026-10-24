// R11 content inventory, around the skill's content_audit.py:
//
//   node designs/sani/tools/r11-content.mjs merge
//     Merges the captures r11-check.mjs saved (review-r11/rendered-content.json)
//     into one capture, review-r11/content/dom-r11.json.
//   python .agents/skills/prototype-first-ui/scripts/content_audit.py seed --profile operational-strict \
//     --capture designs/sani/review-r11/content/dom-r11.json \
//     --existing designs/sani/review-r10/content-inventory.json \
//     --output designs/sani/review-r11/content-inventory.json
//   node designs/sani/tools/r11-content.mjs classify
//     Places what seed left open: shipped copy, the R7–R10 approved overlays,
//     R11 proposals (copy.js and the visitor password page), demo records and
//     formatted values. Prints anything it cannot place.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const step = process.argv[2];
// Production verification reuses the same steps on its own capture and inventory.
const dir = process.env.R11_CONTENT_DIR ?? 'review-r11';

if (step === 'merge') {
  const reports = JSON.parse(readFileSync(join(project, dir, 'rendered-content.json'), 'utf8'));
  const items = [];
  for (const r of reports) for (const item of r.items) items.push({ ...item, location: `[${r.page?.url?.split('/').pop() ?? ''}] ${item.location}` });
  mkdirSync(join(project, dir, 'content'), { recursive: true });
  writeFileSync(join(project, dir, 'content/dom-r11.json'), JSON.stringify({
    schemaVersion: 1,
    generator: 'prototype-first-ui/collect_dom_content.js via tools/r11-check.mjs',
    capturedAt: new Date().toISOString(),
    page: { url: `prototype-r11.html and visitor-r11.html (${reports.length} states)`, title: 'Sani R11', language: 'zh, en', viewport: { width: 1280, height: 900, devicePixelRatio: 2 } },
    items,
    limitations: [...new Set(reports.flatMap((r) => r.limitations ?? []))],
  }, null, 1) + '\n');
  console.log(reports.length, 'states,', items.length, 'items');
} else if (step === 'classify') {
  const window = {};
  const run = (file) => new Function('window', readFileSync(join(project, file), 'utf8'))(window);
  for (const f of ['src/gen/i18n.js', 'src/gen/icons.js', 'src/fixtures.js']) run(f);
  const shipped = JSON.parse(JSON.stringify(window.SANI_I18N));
  for (const f of ['src/r3/overrides.js', 'src/r7/copy.js', 'src/r8/copy.js', 'src/r10/copy.js']) run(f);
  const approved = JSON.parse(JSON.stringify(window.SANI_I18N));
  run('src/r11/copy.js');
  run('src/gen/visitor.js');
  const I = window.SANI_I18N, V = window.SANI_VISITOR, F = window.SANI_FIXTURES;
  const visitorR11 = readFileSync(join(project, 'visitor-r11.html'), 'utf8');
  const proposedVisitor = [...visitorR11.matchAll(/(?:heading|label|submit|wrong|empty|rate): '([^']+)'/g)].map((m) => m[1]);

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const entries = [];
  for (const lang of ['zh', 'en']) for (const [key, value] of Object.entries(I[lang])) {
    const parts = value.split(/\{\w+\}/);
    const tier = shipped[lang][key] === value ? 'shipped' : approved[lang][key] === value ? 'approved' : 'r11';
    entries.push({ key, value, tier, re: parts.length > 1 ? new RegExp(`^${parts.map(esc).join('.+?')}$`, 's') : null });
  }
  for (const lang of ['zh', 'en']) {
    for (const [kind, t] of Object.entries(V.pageCopy[lang])) for (const [f, value] of Object.entries(t)) entries.push({ key: `pageCopy.${lang}.${kind}.${f}`, value, tier: 'shipped' });
    for (const [k, value] of Object.entries(V.shareCopy[lang])) entries.push({ key: `shareCopy.${lang}.${k}`, value, tier: 'shipped', re: value.includes('%s') ? new RegExp(`^${value.split('%s').map(esc).join('.+?')}$`) : null });
  }
  for (const value of proposedVisitor) entries.push({ key: 'visitor-r11 password page', value, tier: 'r11' });
  // Production captures render the shipped dictionary, R11 copy included.
  if (dir !== 'review-r11') {
    const source = readFileSync(join(project, '../../web/src/lib/i18n.svelte.ts'), 'utf8');
    for (const m of source.matchAll(/^\s+['"]([\w.]+)['"]:\s*(['"])((?:\\.|(?!\2).)*)\2,?$/gm)) {
      const value = m[3].replace(/\\(['"\\])/g, '$1');
      const parts = value.split(/\{\w+\}/);
      entries.push({ key: m[1], value, tier: 'shipped', re: parts.length > 1 ? new RegExp(`^${parts.map(esc).join('.+?')}$`, 's') : null });
    }
  }

  const purposeOf = (key) => {
    if (/^err\.|wrong|rate|empty$|pageCopy\.\w+\.(notfound|gone|error|share-)/.test(key)) return key.startsWith('err.') ? 'validation' : 'error';
    if (/^access\.(regenerate|generate|remove|done|show|hide|copy)|^act\.|submit|Copy$|Raw$|Download|cancel/i.test(key)) return 'user-action';
    if (/Copied|copied|created\./.test(key)) return 'completion';
    if (/^access\.(protected|hidden|noPassword|noLimit|visits?)|^status\.|^expiry\./.test(key)) return 'state';
    if (/hint|Hint|permanentCache|Help|keys\./.test(key)) return 'task-help';
    if (/^menu\.|^filter\.|^sort\.|^create\.|label$/.test(key)) return 'navigation';
    return 'domain-field';
  };
  const data = new Set();
  const add = (s) => s && typeof s === 'string' && data.add(s.trim());
  for (const l of F.links) [l.slug, l.title, l.url, l.host, l.shortUrl, l.content?.name, l.content?.preview, l.content?.type, l.content?.sha256, l.content?.rawUrl, `/${l.slug}`, `/p/${l.slug}`].forEach(add);
  for (const body of Object.values(F.texts)) body.split('\n').forEach(add);
  for (const t of F.tokens) [t.name, t.hint].forEach(add);
  for (const s of Object.values(F.stats)) for (const r of Object.values(s)) for (const x of r.referrers) add(x.host);
  const scenes = readFileSync(join(project, 'src/r11/scenes.jsx'), 'utf8') + readFileSync(join(project, 'src/r6/scenes.jsx'), 'utf8') + readFileSync(join(project, 'src/r8/tags.jsx'), 'utf8');
  const R11_TEXT_FLAT = (scenes.match(/const R11_TEXT = '([^']+)'/)?.[1] ?? '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
  const formatted =/^([\d,.\s]+(B|KB|MB|GB)?|[\d,.]+\s*(B|KB|MB|GB)\s*\/\s*[\d,.]+\s*(B|KB|MB|GB)|\d{4}-\d{2}-\d{2}|.*\d+%|•+|[A-Z2-9]{6}|blue-otter|[–\-/↵⌘⌫]|Ctrl|Esc|Del|[A-Z?/]|SHA-256.*|30[12]|40[04]|410|500)$|^(\d{4}年)?\d{1,2}月\d{1,2}日|^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d|前$|ago$/;

  // Strings composed in component code rather than the dictionaries.
  const proposal = (purpose, source) => ({ purpose, origin: 'agent-generated-task-copy', decision: 'allow', evidence: { source, reference: 'R11 proposal' }, notes: 'R11 proposal; needs review with the prototype.' });
  const kept = (purpose, source) => ({ purpose, origin: 'existing-approved-ui-copy', decision: 'allow', evidence: { source, reference: 'approved in an earlier revision' }, notes: null });
  const manual = {
    'Edit access': proposal('user-action', 'src/r11/states.jsx'), '修改访问设置': proposal('user-action', 'src/r11/states.jsx'),
    Unavailable: proposal('availability', 'src/r11/states.jsx'), '无法访问': proposal('availability', 'src/r11/states.jsx'),
    'Visit limit reached': kept('availability', 'src/r7/states (R7 AccessRules)'), '访问次数已用尽': kept('availability', 'src/r7/states (R7 AccessRules)'),
    'HEX、RGB、HSL': proposal('task-help', 'src/r11/controls.jsx (was HEX · RGB · HSL)'),
    'Remove tag aff': kept('user-action', 'src/r8/tags.jsx'), '移除标签 aff': kept('user-action', 'src/r8/tags.jsx'),
    // sharepage.go shareCopy.CopyFailed, newer than the synced visitor copy.
    'Copy failed. Select text manually.': kept('error', 'internal/server/sharepage.go'), '无法复制，请手动选择文本': kept('error', 'internal/server/sharepage.go'),
  };
  for (const [, cn, en] of window.SANI_COLOR_PRESETS) manual[cn] = manual[en] = proposal('domain-value', 'src/r11/copy.js (Radix tag presets)');

  const file = join(project, dir, 'content-inventory.json');
  const inv = JSON.parse(readFileSync(file, 'utf8'));
  const unplaced = [];
  for (const item of inv.items) {
    if (item.decision !== 'review' && item.purpose !== 'unclassified') continue;
    const t = item.text;
    const hit = entries.find((e) => e.value === t) ?? entries.filter((e) => e.re?.test(t)).sort((a, b) => b.value.length - a.value.length)[0];
    if (manual[t]) Object.assign(item, manual[t]);
    else if (dir !== 'review-r11' && (/^127\.0\.0\.1:\d+\//.test(t) || /^[a-z0-9]{5,10}$/.test(t) || t.startsWith('Deploy checklist') || t === 'Ctrl↵'))
      Object.assign(item, { purpose: 'domain-value', origin: 'production-domain', decision: 'allow', evidence: { source: 'designs/sani/tools/r11-impl.mjs', reference: 'local verification instance, generated slugs and its fixture text' }, notes: null });
    else if (/^[0-9a-f]{16}$/.test(t) || t === R11_TEXT_FLAT) Object.assign(item, { purpose: 'domain-value', origin: 'production-domain', decision: 'allow', evidence: { source: 'src/fixtures.js, src/r11/scenes.jsx', reference: 'SHA-256 prefix or sample text' }, notes: null });
    else if (hit) {
      Object.assign(item, {
        purpose: purposeOf(hit.key),
        origin: hit.tier === 'r11' ? 'agent-generated-task-copy' : 'existing-approved-ui-copy',
        decision: 'allow',
        evidence: { source: hit.tier === 'r11' ? (hit.key.startsWith('visitor') ? 'visitor-r11.html' : 'src/r11/copy.js') : hit.tier === 'approved' ? 'src/r7–r10 copy overlays (approved)' : hit.key.includes('Copy') ? 'internal/server' : 'web/src/lib/i18n.svelte.ts', reference: hit.key },
        notes: hit.tier === 'r11' ? 'R11 proposal; needs review with the prototype.' : null,
      });
    } else if (data.has(t) || /(^|\s)(s|files)\.example\.com\b/.test(t) || scenes.includes(t)) {
      Object.assign(item, { purpose: 'domain-value', origin: 'production-domain', decision: 'allow', evidence: { source: 'src/fixtures.js, src/r11/scenes.jsx', reference: 'sanitized demo records' }, notes: null });
    } else if (formatted.test(t) || t === 'sani' || t === 'Sani' || t === 'PNG' || t === 'SVG') {
      Object.assign(item, { purpose: 'domain-value', origin: 'production-behavior', decision: 'allow', evidence: { source: 'web/src/lib formatters, generated passwords', reference: 'formatted value' }, notes: null });
    } else if (item.channels?.every((c) => c === 'data-*')) {
      Object.assign(item, { purpose: 'machine-identifier', origin: 'production-behavior', decision: 'allow', evidence: { source: 'src/r11/patterns.jsx', reference: 'data-link and similar ids' }, notes: null });
    } else unplaced.push(t);
  }
  writeFileSync(file, JSON.stringify(inv, null, 1) + '\n');
  console.log(`${inv.items.length} items, ${unplaced.length} unplaced`);
  for (const t of unplaced.slice(0, 80)) console.log('  ?', JSON.stringify(t));
} else {
  console.error('usage: r11-content.mjs merge | classify');
  process.exit(64);
}
