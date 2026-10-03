// Loads every scene of the prototype (and the layer pages) and fails on any
// console error, page error or failed request.
//
//   python -m http.server 4311 --bind 127.0.0.1 --directory designs
//   node designs/sani/tools/smoke.mjs [http://127.0.0.1:4311/sani]
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../../../web/package.json'));
const { chromium } = require('@playwright/test');
const base = process.argv[2] ?? 'http://127.0.0.1:4311/sani';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const problems = [];
let where = '';
page.on('console', (m) => m.type() === 'error' && problems.push(`${where}: console: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`${where}: ${e.message}`));
page.on('requestfailed', (r) => problems.push(`${where}: request failed: ${r.url()}`));
page.on('response', (r) => r.status() >= 400 && problems.push(`${where}: ${r.status()} ${r.url()}`));

await page.goto(`${base}/prototype.html?chrome=0`);
await page.waitForFunction(() => window.SCENES);
const scenes = await page.evaluate(() => Object.keys(window.SCENES));
const pages = [...scenes.map((s) => `prototype.html?scene=${s}&chrome=0`), ...(process.env.PAGES ?? '').split(',').filter(Boolean)];

for (const p of pages) {
  where = p;
  await page.goto(`${base}/${p}`);
  // React pages render into #app; visitor.html writes a whole server-style document.
  await page.waitForFunction(() => document.querySelector('#app')?.childElementCount > 0 || !!document.querySelector('body > main'), null, { timeout: 15000 }).catch(() => problems.push(`${p}: nothing rendered`));
  await page.waitForTimeout(150);
  const text = await page.evaluate(() => document.body.innerText.trim().length);
  if (!text) problems.push(`${p}: no visible text`);
}
await browser.close();
for (const p of problems) console.error(p);
console.log(`${pages.length} pages, ${problems.length} problems`);
process.exit(problems.length ? 1 : 0);
