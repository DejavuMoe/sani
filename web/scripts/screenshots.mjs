// Screenshots of the admin app for the docs and READMEs, in both languages
// and both themes. Needs two running servers: one seeded with demo data, and
// a fresh one without a password for the first-run screen.
//
//   go run ./scripts/seed -data /tmp/sani-demo -base https://s.example.com
//   SANI_LISTEN=127.0.0.1:18080 SANI_DATA_DIR=/tmp/sani-demo ./bin/sani &
//   SANI_LISTEN=127.0.0.1:8080 SANI_DATA_DIR=/tmp/sani-fresh ./bin/sani &
//   SANI_URL=http://127.0.0.1:18080 SANI_FRESH_URL=http://127.0.0.1:8080 node scripts/screenshots.mjs
//
// The first-run screen shows its own address, so the fresh instance uses the
// port from the quick start.
//
// Files are named {scene}-{theme}-{lang}.png; the docs' Screenshot component
// and the READMEs expect exactly these names and sizes.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.env.SANI_URL ?? 'http://127.0.0.1:8080';
const fresh = process.env.SANI_FRESH_URL;
const out = process.env.SHOTS_DIR ?? '../docs/public/screenshots';
const password = process.env.SANI_DEMO_PASSWORD ?? 'sani-demo';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();

async function scene(name, { lang, theme, width, height, origin = base, signIn = true, run }) {
  const phone = width < 500;
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: theme,
    locale: lang === 'zh' ? 'zh-CN' : 'en-US',
    timezoneId: 'Asia/Shanghai',
    isMobile: phone,
    hasTouch: phone,
  });
  await ctx.addInitScript(([t, l]) => (localStorage.setItem('sani.theme', t), localStorage.setItem('sani.lang', l)), [theme, lang]);
  if (signIn) await ctx.request.post(`${origin}/api/session`, { data: { password } });
  const page = await ctx.newPage();
  await page.goto(`${origin}/admin/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  if (run) await run(page);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500);
  const file = `${name}-${theme}-${lang}.png`;
  await page.screenshot({ path: `${out}/${file}` });
  await ctx.close();
  console.log('wrote', file);
}

async function openDetail(page, slug) {
  const row = page.locator('.row', { has: page.locator('.slug', { hasText: slug }) }).first();
  await row.locator('.main').click();
  await page.waitForSelector('.detail .bar');
  // Park the opened row just below the header.
  await page.evaluate((el) => {
    const top = el.getBoundingClientRect().top + scrollY - 64;
    scrollTo({ top, behavior: 'instant' });
  }, await row.elementHandle());
}

async function fillSetup(page) {
  await page.fill('#setup-code', 'k7m2-p9x4-hq3d');
  await page.fill('#new-password', 'correct-horse');
  await page.fill('#confirm-password', 'correct-horse');
  await page.locator('#confirm-password').blur();
}

for (const lang of ['zh', 'en']) {
  for (const theme of ['light', 'dark']) {
    await scene('dashboard', { lang, theme, width: 1280, height: 800 });
    await scene('detail', { lang, theme, width: 1280, height: 860, run: (p) => openDetail(p, 'weekly-42') });
    await scene('mobile', { lang, theme, width: 390, height: 844 });
    if (fresh) await scene('setup', { lang, theme, width: 560, height: 760, origin: fresh, signIn: false, run: fillSetup });
  }
}
if (!fresh) console.log('SANI_FRESH_URL is not set; skipped the setup screen');
await browser.close();
