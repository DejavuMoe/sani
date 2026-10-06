// Puts production and the prototype into the same state, in the same
// browser, viewport, theme, language and time zone, screenshots both and
// diffs them pixel by pixel. Writes screenshots/compare/<case>-{prod,proto,diff}.png
// and screenshots/compare/report.json.
//
//   SANI_URL=http://127.0.0.1:18080 SANI_FRESH_URL=http://127.0.0.1:18081 \
//   node designs/sani/tools/compare.mjs [filter]
//
// Production is a seeded instance (see tools/capture.mjs) and a fresh one for
// the first-run screen; the prototype is served from designs/ on :4311.
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(project, '../../web/package.json'));
const { chromium } = require('@playwright/test');

const prod = process.env.SANI_URL ?? 'http://127.0.0.1:18080';
const fresh = process.env.SANI_FRESH_URL ?? 'http://127.0.0.1:18081';
const proto = process.env.PROTO_URL ?? 'http://127.0.0.1:4311/sani';
const password = process.env.SANI_DEMO_PASSWORD ?? 'sani-demo';
const filter = process.argv[2] ?? '';
const out = join(project, 'screenshots/compare');
mkdirSync(out, { recursive: true });

const fixtures = JSON.parse(readFileSync(join(project, 'src/fixtures.js'), 'utf8').replace(/^[\s\S]*?window\.SANI_FIXTURES = /, '').replace(/;\s*$/, ''));
const fileSlug = fixtures.links.find((l) => l.kind === 'file').slug;

const row = (page, slug) => page.locator('.row', { has: page.locator('.slug', { hasText: new RegExp(`^/(p/)?${RegExp.escape(slug)}$`) }) }).first();
async function openDetail(page, slug) {
  const r = row(page, slug);
  await r.locator('.main').click();
  await page.waitForSelector('.detail');
  await page.evaluate((el) => scrollTo({ top: el.getBoundingClientRect().top + scrollY - 64, behavior: 'instant' }), await r.elementHandle());
}
const blur = (page) => page.evaluate(() => document.activeElement?.blur());
/** The prototype opens a scene's row on load; park it where openDetail parks production's. */
const park = async (page) => {
  await blur(page);
  await page.evaluate(() => {
    const el = document.querySelector('.lr.expanded');
    if (el) scrollTo({ top: el.getBoundingClientRect().top + scrollY - 64, behavior: 'instant' });
  });
};

/** Each case: how to get production there, and the prototype scene that matches. */
const cases = [
  { id: 'dashboard', scene: 'dashboard', w: 1280, h: 800 },
  { id: 'dashboard-phone', scene: 'dashboard', w: 390, h: 844, phone: true },
  { id: 'detail-url', scene: 'detail-url', w: 1280, h: 860, run: (p) => openDetail(p, 'weekly-42'), protoRun: park },
  { id: 'detail-text', scene: 'detail-text', w: 1280, h: 860, run: (p) => openDetail(p, 'nginx-conf'), protoRun: park },
  { id: 'detail-file', scene: 'detail-file', w: 1280, h: 860, run: (p) => openDetail(p, fileSlug), protoRun: park },
  { id: 'detail-phone', scene: 'detail-url', w: 390, h: 844, phone: true, run: (p) => openDetail(p, 'weekly-42'), protoRun: park },
  {
    id: 'edit-url',
    scene: 'edit-url',
    w: 1280,
    h: 860,
    run: async (p) => {
      await openDetail(p, 'weekly-42');
      await p.locator('.detail .actions button').first().click();
      await p.waitForSelector('.editor');
      await blur(p);
    },
    protoRun: park,
  },
  {
    id: 'picking',
    scene: 'dashboard-picking',
    w: 1280,
    h: 800,
    run: async (p) => {
      await p.locator('.toolbar .pick').click();
      for (const s of ['gh', 'blog', 'talk']) await row(p, s).locator('.line').click();
      await blur(p);
      await p.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    },
  },
  {
    id: 'search',
    scene: 'dashboard-search',
    w: 1280,
    h: 800,
    run: async (p) => {
      await p.fill('.toolbar input[type=search]', 'github');
      await p.waitForTimeout(500);
      await blur(p);
    },
  },
  { id: 'sort-clicks', scene: 'dashboard-sort-clicks', w: 1280, h: 800, run: async (p) => (await p.locator('.head .h-clicks').click(), await p.waitForTimeout(400)) },
  { id: 'composer-text', scene: 'composer-text', w: 1280, h: 800, run: async (p) => (await p.locator('#create-tab-text').click(), await blur(p)), protoRun: park },
  { id: 'composer-file', scene: 'composer-file', w: 1280, h: 800, run: async (p) => (await p.locator('#create-tab-file').click(), await blur(p)), protoRun: park },
  {
    id: 'composer-more',
    scene: 'composer-more',
    w: 1280,
    h: 800,
    run: async (p) => {
      await p.fill('#composer-url', 'https://example.com/a/very/long/path?with=query');
      await p.locator('.options .opt[aria-controls="composer-more"]').click();
      await blur(p);
    },
    protoRun: blur,
  },
  { id: 'shortcuts', scene: 'shortcuts', w: 1280, h: 800, run: (p) => p.keyboard.press('Shift+Slash') },
  { id: 'settings', scene: 'settings', w: 1280, h: 1000, path: '/admin/settings', full: true },
  { id: 'settings-phone', scene: 'settings', w: 390, h: 844, phone: true, path: '/admin/settings', full: true },
  { id: 'new', scene: 'new', w: 480, h: 560, path: '/admin/new', protoRun: blur, run: blur },
  { id: 'login', scene: 'login', w: 560, h: 760, signIn: false, host: true, run: blur, protoRun: park },
  {
    id: 'setup',
    scene: 'setup-filled',
    w: 560,
    h: 760,
    origin: fresh,
    signIn: false,
    host: true,
    run: async (p) => {
      await p.fill('#setup-code', 'k7m2-p9x4-hq3d');
      await p.fill('#new-password', 'correct-horse');
      await p.fill('#confirm-password', 'correct-horse');
      await blur(p);
    },
    protoRun: blur,
  },
  // Visitor pages come from the Go server, so the prototype side is visitor.html.
  { id: 'visitor-notfound', visitor: 'page=notfound&slug=nonexistent-xyz', w: 800, h: 600, path: '/nonexistent-xyz' },
  { id: 'visitor-gone', visitor: 'page=gone&slug=talk', w: 800, h: 600, path: '/talk' },
  { id: 'visitor-share-notfound', visitor: 'page=share-notfound&slug=p/nonexistent-xyz', w: 800, h: 600, path: '/p/nonexistent-xyz' },
  { id: 'visitor-share-code', visitor: 'page=share-code', w: 1280, h: 700, path: '/p/nginx-conf' },
  { id: 'visitor-share-code-phone', visitor: 'page=share-code', w: 390, h: 844, phone: true, path: '/p/nginx-conf' },
  { id: 'visitor-share-file', visitor: 'page=share-file', w: 1280, h: 700, path: `/p/${fileSlug}` },
  {
    id: 'offline',
    scene: 'offline',
    w: 560,
    h: 400,
    signIn: false,
    before: (ctx) => ctx.route('**/api/session', (r) => r.abort()),
  },
];

// LCD text depends on how a layer is composited (scrollers, top layer), which
// differs between frameworks without any visible design difference.
const browser = await chromium.launch({ args: ['--disable-lcd-text'] });

async function shoot(c, { theme, lang }, side) {
  const origin = c.origin ?? prod;
  const ctx = await browser.newContext({
    viewport: { width: c.w, height: c.h },
    deviceScaleFactor: 1,
    colorScheme: theme,
    locale: lang === 'zh' ? 'zh-CN' : 'en-US',
    timezoneId: 'Asia/Shanghai',
    isMobile: !!c.phone,
    hasTouch: !!c.phone,
    reducedMotion: 'reduce',
  });
  let page;
  if (side === 'prod') {
    await ctx.addInitScript(([t, l]) => (localStorage.setItem('sani.theme', t), localStorage.setItem('sani.lang', l)), [theme, lang]);
    if (c.signIn !== false && !c.visitor) await ctx.request.post(`${origin}/api/session`, { data: { password } });
    await c.before?.(ctx);
    page = await ctx.newPage();
    await page.goto(`${origin}${c.path ?? '/admin/'}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await c.run?.(page);
  } else if (c.visitor) {
    page = await ctx.newPage();
    await page.goto(`${proto}/visitor.html?${c.visitor}&lang=${lang}&host=${new URL(origin).host}`, { waitUntil: 'networkidle' });
  } else {
    page = await ctx.newPage();
    const host = c.host ? `&host=${new URL(origin).host}` : '';
    await page.goto(`${proto}/prototype.html?scene=${c.scene}&theme=${theme}&lang=${lang}&now=live&chrome=0&latency=0${host}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.getElementById('app')?.childElementCount > 0);
    await page.evaluate(() => document.fonts.ready);
    await c.protoRun?.(page);
  }
  await page.mouse.move(0, 0);
  await page.waitForTimeout(450);
  const buf = await page.screenshot({ fullPage: !!c.full, animations: 'disabled', caret: 'hide' });
  await ctx.close();
  return buf;
}

async function diff(a, b) {
  const page = await browser.newPage();
  const result = await page.evaluate(
    async ([a, b]) => {
      const load = (src) => new Promise((r) => Object.assign(new Image(), { onload() { r(this); }, src }));
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = Math.max(ia.width, ib.width);
      const h = Math.max(ia.height, ib.height);
      const ctx = (img) => {
        const c = new OffscreenCanvas(w, h);
        const x = c.getContext('2d');
        x.fillStyle = '#ff00ff';
        x.fillRect(0, 0, w, h);
        x.drawImage(img, 0, 0);
        return x.getImageData(0, 0, w, h).data;
      };
      const da = ctx(ia);
      const db = ctx(ib);
      const out = new OffscreenCanvas(w, h);
      const ox = out.getContext('2d');
      const img = ox.createImageData(w, h);
      let bad = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
        const grey = (da[i] + da[i + 1] + da[i + 2]) / 3;
        if (d > 32) {
          bad++;
          img.data.set([230, 30, 60, 255], i);
        } else img.data.set([grey, grey, grey, 70], i);
      }
      ox.putImageData(img, 0, 0);
      const blob = await out.convertToBlob({ type: 'image/png' });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { ratio: bad / (w * h), size: [ia.width, ia.height, ib.width, ib.height], png: btoa(bin) };
    },
    [`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`],
  );
  await page.close();
  return result;
}

const variants = (process.env.VARIANTS ?? 'light-zh,dark-en').split(',').map((v) => {
  const [theme, lang] = v.split('-');
  return { theme, lang };
});
const report = [];
for (const c of cases.filter((c) => c.id.includes(filter))) {
  for (const v of variants) {
    const name = `${c.id}-${v.theme}-${v.lang}`;
    try {
      const [a, b] = [await shoot(c, v, 'prod'), await shoot(c, v, 'proto')];
      const d = await diff(a, b);
      writeFileSync(join(out, `${name}-prod.png`), a);
      writeFileSync(join(out, `${name}-proto.png`), b);
      writeFileSync(join(out, `${name}-diff.png`), Buffer.from(d.png, 'base64'));
      const sameSize = d.size[0] === d.size[2] && d.size[1] === d.size[3];
      report.push({ case: name, diff: +(d.ratio * 100).toFixed(3), sameSize, prod: d.size.slice(0, 2), proto: d.size.slice(2) });
      console.log(`${name.padEnd(34)} ${(d.ratio * 100).toFixed(2).padStart(6)}% ${sameSize ? '' : `size ${d.size.slice(0, 2)} vs ${d.size.slice(2)}`}`);
    } catch (e) {
      report.push({ case: name, error: e.message.split('\n')[0] });
      console.log(`${name.padEnd(34)} ERROR ${e.message.split('\n')[0]}`);
    }
  }
}
await browser.close();
// A filtered run (by case or variant) updates its cases in the existing report rather than replacing it.
const file = join(out, 'report.json');
let merged = report;
if ((filter || process.env.VARIANTS) && existsSync(file)) {
  const done = new Set(report.map((r) => r.case));
  merged = [...JSON.parse(readFileSync(file, 'utf8')).cases.filter((r) => !done.has(r.case)), ...report];
}
writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), cases: merged }, null, 2) + '\n');
