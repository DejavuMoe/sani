// Screenshots one page of the prototype and prints its console errors, for
// reviewing boards by eye.
//
//   node designs/sani/tools/shot.mjs "<path?query>" <name> [width] [height] [--full] [--dark] [--sel=<css>]
//   → designs/sani/screenshots/review/<name>.png
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(join(project, '../../web/package.json'))('@playwright/test');
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [path, name, w = '1440', h = '900'] = args.filter((a) => !a.startsWith('--'));
const base = process.env.PROTO_URL ?? 'http://127.0.0.1:4311/sani';
const out = join(project, 'screenshots/review');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h }, colorScheme: flags.has('--dark') ? 'dark' : 'light', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/${path}`, { waitUntil: 'networkidle', timeout: 180000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);
const sel = [...flags].find((f) => f.startsWith('--sel='))?.slice(6);
if (sel) await page.locator(sel).first().screenshot({ path: join(out, `${name}.png`) });
else await page.screenshot({ path: join(out, `${name}.png`), fullPage: flags.has('--full') });
await browser.close();
console.log(`${name}.png`, errors.length ? `\n${errors.join('\n')}` : 'no errors');
