// Content inventory for the prototype, in two steps around the skill's
// content_audit.py:
//
//   node designs/sani/tools/content.mjs collect
//     Renders every scene of prototype.html and every visitor page in both
//     languages, runs the skill's collect_dom_content.js in each, and writes
//     one capture per surface and language to content/ (locations are
//     prefixed with the scene).
//   python .agents/skills/prototype-first-ui/scripts/content_audit.py seed \
//     --profile operational-strict --output designs/sani/content-inventory.json \
//     --existing designs/sani/content-inventory.json --capture designs/sani/content/<each>.json
//   node designs/sani/tools/content.mjs classify
//     Classifies every string by where it comes from: production copy (an
//     i18n key or a server page string, with the key as evidence), fixture
//     data (sanitized demo records), or values production formats (numbers,
//     dates, sizes, keys). Prints whatever it cannot place; those need a
//     person.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(project, '../..');
const base = process.env.PROTO_URL ?? 'http://127.0.0.1:4311/sani';
const step = process.argv[2];
const load = (file) => {
  const window = {};
  new Function('window', readFileSync(join(project, file), 'utf8'))(window);
  return window;
};

if (step === 'collect') {
  const { chromium } = createRequire(join(repo, 'web/package.json'))('@playwright/test');
  const collector = readFileSync(join(repo, '.agents/skills/prototype-first-ui/scripts/collect_dom_content.js'), 'utf8');
  const src = readFileSync(join(project, 'src/scenes.jsx'), 'utf8');
  const scenes = [...src.matchAll(/^\s+'?([\w-]+)'?: \{ group/gm)].map((m) => m[1]);
  const visitor = ['notfound', 'gone', 'error', 'share-notfound', 'share-gone', 'share-code', 'share-text', 'share-code&until=1', 'share-file', 'share-file-off'];
  const browser = await chromium.launch();
  mkdirSync(join(project, 'content'), { recursive: true });
  for (const lang of ['zh', 'en']) {
    for (const [surface, pages] of [
      ['app', scenes.map((s) => [s, `prototype.html?scene=${s}&lang=${lang}&theme=light&chrome=0&latency=0`])],
      ['visitor', visitor.map((v) => [v, `visitor.html?page=${v}&lang=${lang}&theme=light`])],
    ]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: lang === 'zh' ? 'zh-CN' : 'en-US', timezoneId: 'Asia/Shanghai' });
      const items = [];
      let limitations = [];
      for (const [id, path] of pages) {
        await page.goto(`${base}/${path}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(250);
        await page.evaluate(collector);
        const report = await page.evaluate(() => window.__prototypeFirstUICollectDOMContent());
        for (const item of report.items) items.push({ ...item, location: `[${id}] ${item.location}` });
        limitations = report.limitations;
      }
      await page.close();
      const file = `content/dom-${surface}-${lang}.json`;
      const capture = {
        schemaVersion: 1,
        generator: 'prototype-first-ui/collect_dom_content.js via tools/content.mjs',
        capturedAt: new Date().toISOString(),
        page: {
          url: `${surface === 'app' ? 'prototype.html' : 'visitor.html'} (${pages.length} states, lang=${lang})`,
          title: surface === 'app' ? 'Sani admin app' : 'Sani visitor pages',
          language: lang,
          viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
        },
        items,
        limitations: [...limitations, 'Each state was rendered on its own and the items merged; the bracketed prefix of a location names the state.'],
      };
      writeFileSync(join(project, file), JSON.stringify(capture, null, 1) + '\n');
      console.log(file, items.length, 'items');
    }
  }
  await browser.close();
} else if (step === 'classify') {
  const { SANI_I18N: I18N } = load('src/gen/i18n.js');
  const { SANI_VISITOR: V } = load('src/gen/visitor.js');
  const { SANI_FIXTURES: F } = load('src/fixtures.js');
  const file = join(project, 'content-inventory.json');
  const inv = JSON.parse(readFileSync(file, 'utf8'));

  // Production copy: every i18n value, as an exact string or a template.
  const copy = [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const lang of ['zh', 'en'])
    for (const [key, value] of Object.entries(I18N[lang])) {
      const parts = value.split(/\{\w+\}/);
      copy.push({ key, value, re: parts.length > 1 ? new RegExp(`^${parts.map(esc).join('.+?')}$`, 's') : null, src: 'web/src/lib/i18n.svelte.ts' });
      // Strings with key placeholders render the keys in <kbd>, so the text
      // around them arrives as separate fragments.
      if (parts.length > 1) for (const p of parts.map((x) => x.trim()).filter((x) => x.length > 1)) copy.push({ key, value: p, fragment: true, src: 'web/src/lib/i18n.svelte.ts' });
    }
  for (const lang of ['zh', 'en']) {
    for (const [kind, t] of Object.entries(V.pageCopy[lang])) for (const [f, value] of Object.entries(t)) copy.push({ key: `pageCopy.${lang}.${kind}.${f}`, value, src: 'internal/server/web.go' });
    for (const [k, value] of Object.entries(V.shareCopy[lang])) {
      const parts = value.split('%s');
      copy.push({ key: `shareCopy.${lang}.${k}`, value, re: parts.length > 1 ? new RegExp(`^${parts.map(esc).join('.+?')}$`) : null, src: 'internal/server/sharepage.go' });
    }
  }
  const purposeOf = (key) => {
    const k = key.replace(/^(pageCopy|shareCopy)\.\w+\./, '');
    if (/^err\.|^auth\.(wrong|rateLimited)|loadError|\.(error|gone|notfound)\./.test(k) || /^(notfound|gone|error|share-notfound|share-gone)\./.test(k)) return 'error';
    if (/^act\.|^bulk\.(enable|disable|delete|done|start|all)|Submit|submit|signIn|create|Create|Copy$|Raw$|Download|Revoke|revoke|export$|import$|choose|Choose|Remove|cancel/.test(k)) return 'user-action';
    if (/empty|noResults|none|noVisits|tokensEmpty/i.test(k)) return 'empty-state';
    if (/[Hh]int|^keys\.|Help|Drop|Paste|pasted|dropped|Example|Limit|Drag|lead/.test(k)) return 'task-help';
    if (/^status\.|enabled$|fetching|loading|Loading|signingIn|saving|uploading|importing|Used|Unused|^bulk\.(count|none)|expired|Unavailable/.test(k)) return 'state';
    if (/copied|Copied|saved|Saved|deleted|restored|turned|Revoked|imported|Changed|created\./.test(k)) return 'completion';
    if (/^slug\.|mismatch|short$|Missing/.test(k)) return 'validation';
    if (/Off$|Disabled|Env$|filesOff|fileDisabled|passwordEnv|domainEnv/.test(k)) return 'disabled';
    if (/^menu\.|^nav\.|back|title$|\.label$|^create\.(url|text|file)$|^filter\.|^sort\./.test(k)) return 'navigation';
    if (/^expiry\.|^redirect\.|^theme\.|^format\.|^chart\.|lines/.test(k)) return 'domain-value';
    return 'domain-field';
  };

  // Fixture data: the sanitized demo records the prototype renders.
  const data = new Set();
  const add = (s) => s && typeof s === 'string' && data.add(s.trim());
  for (const l of F.links) {
    [l.slug, l.title, l.url, l.host, l.shortUrl, l.content?.name, l.content?.preview, l.content?.type, l.content?.sha256, l.content?.rawUrl].forEach(add);
    add(`/${l.slug}`);
    add(`/p/${l.slug}`);
    add(l.host?.replace(/^www\./, ''));
    if (l.url) {
      const m = l.url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)(.*)$/i);
      if (m) {
        add(m[1].replace(/^www\./, ''));
        try {
          add(decodeURI(m[2]));
        } catch {
          add(m[2]);
        }
      }
    }
  }
  for (const t of F.tokens) [t.name, t.hint].forEach(add);
  for (const s of Object.values(F.stats)) for (const r of Object.values(s)) for (const x of r.referrers) add(x.host);
  for (const body of Object.values(F.texts)) body.split('\n').forEach(add);
  Object.values(F.config).forEach((v) => typeof v === 'string' && add(v));

  const formatted = [
    /^[\d,.\s]+(B|KB|MB|GB)?$/, // counts, sizes
    /^[\d,.]+\s*(B|KB|MB|GB)\s*\/\s*[\d,.]+\s*(B|KB|MB|GB)$/, // size / limit
    /^\d{4}-\d{2}-\d{2}$/, // chart table dates
    /^(\d{4}年)?\d{1,2}月\d{1,2}日/, // zh dates
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d/, // en dates
    /^(\d+ ?(分钟|小时|天)前|昨天|前天|刚刚|just now|yesterday|\d+ (min|hr|day)s?\.? ago)$/,
    /^[·–\-/↵⌘⌫]$|^(Ctrl|Esc|Del|[A-Z?/])$/, // separators, keys
    /^\d+(\.\d+)?%$/,
    /^(sani_[\w…]+|SHA-256)$/,
  ];
  const isFixtureish = (t) => data.has(t) || /(^|\s)(s|files)\.example\.com\b/.test(t) || [...data].some((d) => d.length > 8 && t.length > 8 && (d.includes(t) || t.includes(d)));

  // Strings production composes or hardcodes outside the dictionaries, checked
  // by hand against the named source.
  const prod = (purpose, source, reference, notes = null) => ({ purpose, origin: 'production-behavior', decision: 'allow', evidence: { source, reference }, notes });
  const known = {
    PNG: prod('user-action', 'web/src/components/LinkDetail.svelte', 'QR download buttons'),
    SVG: prod('user-action', 'web/src/components/LinkDetail.svelte', 'QR download buttons'),
    JSON: prod('user-action', 'web/src/views/Settings.svelte', 'export links'),
    CSV: prod('user-action', 'web/src/views/Settings.svelte', 'export links'),
    'docker logs sani': prod('task-help', 'web/src/views/Setup.svelte', '{cmd} in setup.codeHint'),
    '/p/': prod('domain-value', 'web/src/components/LinkRow.svelte', 'share slug prefix'),
    '%': prod('progress', 'web/src/components/ShareComposer.svelte', 'upload percentage', 'Separate text node next to the number.'),
    '…': prod('domain-value', 'web/src/components/LinkDetail.svelte', 'truncated SHA-256'),
    'Shortcuts (?)': prod('navigation', 'web/src/components/AppHeader.svelte', "title=\"{t('menu.shortcuts')} (?)\""),
    '快捷键 (?)': prod('navigation', 'web/src/components/AppHeader.svelte', "title=\"{t('menu.shortcuts')} (?)\""),
  };
  const themeTitle = /^(Theme|主题): .+$/;
  const shareMeta = /^(Code|Text|File|代码|文本|文件) · .+$/;
  const marker = { purpose: 'machine-identifier', origin: 'production-behavior', decision: 'allow', notes: null };

  const unplaced = [];
  for (const item of inv.items) {
    if (item.decision !== 'review' && item.purpose !== 'unclassified') continue;
    const t = item.text;
    // An exact string wins; among templates, the one with the most literal text.
    const hit = copy.find((c) => c.value === t) ?? copy.filter((c) => c.re?.test(t)).sort((a, b) => b.value.replace(/\{\w+\}|%s/g, '').length - a.value.replace(/\{\w+\}|%s/g, '').length)[0];
    if (known[t]) Object.assign(item, known[t]);
    else if (themeTitle.test(t)) Object.assign(item, prod('navigation', 'web/src/components/AppHeader.svelte', "`${t('menu.theme')}: ${themeName}`"));
    else if (shareMeta.test(t)) Object.assign(item, prod('domain-value', 'web/src/components/LinkRow.svelte, internal/server/sharepage.go', 'kind · lines · size, joined with " · "'));
    else if (!hit && item.channels.every((c) => c === 'data-*'))
      Object.assign(item, {
        ...marker,
        evidence: { source: 'src/screens.jsx, src/app.jsx, src/patterns.jsx', reference: 'data-screen-label / data-theme / data-link' },
        notes: 'Attribute only. data-link carries a link id and data-theme the theme, as in production; data-screen-label is the prototype’s screen marker and is not shipped.',
      });
    else if (t === 'design-review.pdf')
      Object.assign(item, {
        purpose: 'domain-value',
        origin: 'agent-generated-task-copy',
        decision: 'allow',
        evidence: { source: 'src/scenes.jsx', reference: 'sampleFile()' },
        notes: 'Sample file name for the picked and uploading states; the seeded demo has no upload in progress to capture.',
      });
    else if (hit) {
      Object.assign(item, {
        purpose: purposeOf(hit.key),
        origin: 'existing-approved-ui-copy',
        decision: 'allow',
        evidence: { source: hit.src, reference: hit.key },
        notes: hit.fragment ? 'Text around keyboard keys rendered as <kbd>.' : hit.re ? 'Template with values filled in.' : null,
      });
    } else if (t === 'sani' || t === 'Sani') {
      Object.assign(item, { purpose: 'navigation', origin: 'production-domain', decision: 'allow', evidence: { source: 'web/src/components/Logo.svelte', reference: 'wordmark and aria-label' }, notes: null });
    } else if (isFixtureish(t)) {
      Object.assign(item, { purpose: 'domain-value', origin: 'production-domain', decision: 'allow', evidence: { source: 'src/fixtures.js', reference: 'sanitized demo records from scripts/seed via tools/capture.mjs' }, notes: null });
    } else if (formatted.some((re) => re.test(t))) {
      Object.assign(item, { purpose: /^[·–\-/↵⌘⌫]$|^(Ctrl|Esc|Del|[A-Z?/])$/.test(t) ? 'task-help' : 'domain-value', origin: 'production-behavior', decision: 'allow', evidence: { source: 'web/src/lib (i18n.svelte.ts formatters, size.ts, keys.ts)', reference: 'formatted value or key label' }, notes: null });
    } else unplaced.push(t);
  }
  // seed records absolute capture paths and every full DOM path; keep the
  // record portable and readable: project-relative captures, and for each
  // string the states it appears in with the tail of one element path.
  const rel = (p) => p.replace(/\\/g, '/').replace(/^.*\/designs\/sani\//, '');
  inv.capture.sources = inv.capture.sources.map(rel);
  const chrome = 'Board pages (index, foundations, components, patterns, screens, visitors) and the Tweaks panel are prototype chrome for reviewers and are not captured; every product state they show is captured here from prototype.html and visitor.html.';
  inv.capture.limitations = [...new Set([...(inv.capture.limitations ?? []), chrome])];
  for (const s of inv.capture.surfaces) s.source = rel(s.source);
  for (const item of inv.items) {
    item.captures = [...new Set(item.captures.map(rel))];
    const byState = new Map();
    for (const loc of item.locations) {
      const m = loc.match(/^(\[[^\]]+\]) (.*)$/);
      const [state, path] = m ? [m[1], m[2].replace(/^(… )+/, '')] : ['', loc];
      if (!byState.has(state)) byState.set(state, path.split(' > ').slice(-3).join(' > '));
    }
    item.locations = [...byState].map(([state, path]) => `${state} … ${path}`.trim());
  }
  writeFileSync(file, JSON.stringify(inv, null, 1) + '\n');
  console.log(`${inv.items.length} items, ${unplaced.length} unplaced`);
  for (const t of unplaced) console.log('  ?', JSON.stringify(t));
} else {
  console.error('usage: content.mjs collect | classify');
  process.exit(64);
}
