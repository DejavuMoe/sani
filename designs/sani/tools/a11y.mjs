// axe-core (the copy web/ uses) over every scene of the prototype, every
// visitor page and the layer boards, in both themes, at desktop and phone
// width. Same checks as web/scripts/a11y.mjs, plus its reflow check.
//
//   node designs/sani/tools/a11y.mjs [filter]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(project, '../../web/package.json'));
const { chromium } = require('@playwright/test');
const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const base = process.env.PROTO_URL ?? 'http://127.0.0.1:4311/sani';
const filter = process.argv[2] ?? '';

const scenes = [...readFileSync(join(project, 'src/scenes.jsx'), 'utf8').matchAll(/^\s+'?([\w-]+)'?: \{ group/gm)].map((m) => m[1]);
const visitor = ['notfound', 'gone', 'share-code', 'share-text', 'share-file', 'share-file-off'];
const boards = ['index.html', 'foundations.html', 'components.html', 'patterns.html', 'visitors.html'];
const pages = [
  ...scenes.map((s) => ({ name: s, url: (theme, lang) => `prototype.html?scene=${s}&theme=${theme}&lang=${lang}&chrome=0&latency=0` })),
  ...visitor.map((v) => ({ name: `visitor-${v}`, url: (theme, lang) => `visitor.html?page=${v}&theme=${theme}&lang=${lang}` })),
  ...boards.map((b) => ({ name: `board-${b}`, board: true, url: (theme, lang) => `${b}?theme=${theme}&lang=${lang}` })),
].filter((p) => p.name.includes(filter));

// Findings that production has too, reproduced on purpose and reported in
// capabilities.md ("Accessibility findings in production"). They are listed,
// not counted, so a new violation still fails the run.
const parity = [
  { rule: 'page-has-heading-one', page: /^(offline|new|new-result)$/, where: 'App.svelte offline state, views/NewLink.svelte' },
  { rule: 'aria-prohibited-attr', page: /^(dashboard-loading|board-patterns\.html)$/, where: 'LinkList.svelte:213 aria-label on a div without a role' },
  { rule: 'scrollable-region-focusable', page: /^settings-token$/, where: 'Settings.svelte:262 <pre> scrolls on phones' },
  { rule: 'color-contrast', page: /^board-components\.html$/, node: /slug-.*-available/, where: 'SlugField.svelte:238 --success text, 4.39:1 on --surface in light' },
];
const known = (p, v) => parity.find((k) => k.rule === v.id && k.page.test(p.name) && (!k.node || v.nodes.every((n) => k.node.test(n))));

const browser = await chromium.launch();
let total = 0;
let matched = 0;
for (const theme of ['light', 'dark']) {
  for (const [vw, vh, size] of [
    [1280, 800, 'desktop'],
    [390, 844, 'phone'],
  ]) {
    for (const p of pages) {
      if (p.board && size === 'phone' && p.name !== 'board-index.html') continue;
      const lang = theme === 'light' ? 'zh' : 'en';
      const page = await browser.newPage({ viewport: { width: vw, height: vh }, colorScheme: theme, locale: lang === 'zh' ? 'zh-CN' : 'en-US', reducedMotion: 'reduce' });
      await page.goto(`${base}/${p.url(theme, lang)}`, { waitUntil: 'networkidle', timeout: 120000 });
      await page.waitForTimeout(300);
      await page.addScriptTag({ content: axe });
      const result = await page.evaluate(async (board) => {
        // Boards repeat the same specimen in several panes, so ids repeat by design.
        const rules = board ? { 'duplicate-id-aria': { enabled: false }, 'duplicate-id': { enabled: false }, 'landmark-unique': { enabled: false } } : {};
        const r = await window.axe.run(document, { resultTypes: ['violations'], rules });
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
      }, !!p.board);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (wide > 0) result.push({ id: 'reflow', impact: 'serious', help: `page is ${wide}px wider than the viewport`, count: 1, nodes: [] });
      for (const v of result) {
        const k = known(p, v);
        if (k) matched++;
        else total++;
        console.log(`[${theme}/${lang}/${size}] ${p.name}: ${k ? 'production parity' : 'NEW'} ${v.impact} ${v.id} (${v.count}): ${v.help}`);
        console.log(`      ${k ? k.where : v.nodes.join('\n      ')}`);
      }
      await page.close();
    }
  }
}
await browser.close();
console.log(`${pages.length} pages × 2 themes × 2 sizes: ${total} new violation(s), ${matched} matching production`);
process.exitCode = total ? 1 : 0;
