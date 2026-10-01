// Runs axe-core over the main screens in both themes and reports violations.
//   SANI_URL=http://127.0.0.1:8080 node scripts/a11y.mjs
// SANI_FRESH_URL may point at an instance without a password to include setup.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const base = process.env.SANI_URL ?? 'http://127.0.0.1:8080';
const password = process.env.SANI_DEMO_PASSWORD ?? 'sani-demo';
const fresh = process.env.SANI_FRESH_URL;

const screens = [
  ...(fresh ? [{ name: 'setup', path: '/admin/', auth: false, origin: fresh }] : []),
  { name: 'login', path: '/admin/', auth: false },
  { name: 'dashboard', path: '/admin/' },
  {
    name: 'detail',
    path: '/admin/',
    run: async (page) => {
      await page.locator('.row .main').first().click();
      await page.waitForSelector('.detail');
      await page.waitForTimeout(400);
    },
  },
  {
    name: 'editor',
    path: '/admin/',
    run: async (page) => {
      await page.locator('.row .main').first().click();
      await page.keyboard.press('e');
      await page.waitForSelector('.editor');
    },
  },
  {
    name: 'bulk',
    path: '/admin/',
    run: async (page) => {
      await page.locator('.toolbar .pick').click();
      await page.locator('.row .main').nth(1).click();
      await page.locator('.row .main').nth(2).click();
      await page.waitForSelector('.bulkbar');
    },
  },
  { name: 'settings', path: '/admin/settings' },
];

const browser = await chromium.launch();
let total = 0;
for (const theme of ['light', 'dark']) {
  for (const s of screens) {
    const ctx = await browser.newContext({ colorScheme: theme, locale: 'zh-CN', bypassCSP: true });
    await ctx.addInitScript((t) => localStorage.setItem('sani.theme', t), theme);
    if (s.auth !== false) await ctx.request.post(`${base}/api/session`, { data: { password } });
    const page = await ctx.newPage();
    await page.goto((s.origin ?? base) + s.path, { waitUntil: 'networkidle' });
    if (s.run) await s.run(page);
    await page.addScriptTag({ content: axe });
    const result = await page.evaluate(async () => {
      // @ts-ignore injected above
      const r = await window.axe.run(document, { resultTypes: ['violations'] });
      return r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.slice(0, 4).map((n) => ({ target: n.target.join(' '), summary: n.failureSummary?.split('\n')[1]?.trim() })),
        count: v.nodes.length,
      }));
    });
    total += result.length;
    console.log(`\n[${theme}] ${s.name}: ${result.length ? result.length + ' violation(s)' : 'clean'}`);
    for (const v of result) {
      console.log(`  - ${v.impact} ${v.id} (${v.count}): ${v.help}`);
      for (const n of v.nodes) console.log(`      ${n.target}${n.summary ? ' — ' + n.summary : ''}`);
    }
    await ctx.close();
  }
}
await browser.close();
process.exitCode = total ? 1 : 0;
