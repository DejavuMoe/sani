// Prints the boxes of matching elements in production and the prototype, to
// find where a layout difference starts.
//
//   node designs/sani/tools/probe.mjs <scene> <slug> "<prod selector>" "<proto selector>"
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(join(project, '../../web/package.json'))('@playwright/test');
const [scene, slug, prodSel, protoSel] = process.argv.slice(2);
const browser = await chromium.launch();
const opts = { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', colorScheme: 'light' };

const boxes = (page, sel) =>
  page.$$eval(sel, (els) => els.map((e) => {
    const r = e.getBoundingClientRect();
    return `${e.className.baseVal ?? e.className} y=${(r.top + scrollY).toFixed(2)} h=${r.height.toFixed(2)} w=${r.width.toFixed(2)}`;
  }));

const a = await browser.newContext(opts);
await a.addInitScript(() => (localStorage.setItem('sani.theme', 'light'), localStorage.setItem('sani.lang', 'zh')));
await a.request.post('http://127.0.0.1:18080/api/session', { data: { password: 'sani-demo' } });
const pa = await a.newPage();
await pa.goto('http://127.0.0.1:18080/admin/', { waitUntil: 'networkidle' });
if (slug) {
  await pa.locator('.row', { has: pa.locator('.slug', { hasText: new RegExp(`^/(p/)?${slug}$`) }) }).first().locator('.main').click();
  await pa.waitForSelector('.detail');
  await pa.waitForTimeout(400);
}
console.log('prod\n ' + (await boxes(pa, prodSel)).join('\n '));

const b = await browser.newContext(opts);
const pb = await b.newPage();
await pb.goto(`http://127.0.0.1:4311/sani/prototype.html?scene=${scene}&theme=light&lang=zh&now=live&chrome=0&latency=0`, { waitUntil: 'networkidle' });
await pb.waitForTimeout(400);
console.log('proto\n ' + (await boxes(pb, protoSel)).join('\n '));
await browser.close();
