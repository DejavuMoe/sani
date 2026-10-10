// Renders the admin app in headless Chromium for visual review and for the
// README screenshots. Point it at a running server seeded with demo data:
//
//   go run ./scripts/seed -data /tmp/sani-demo && SANI_DATA_DIR=/tmp/sani-demo sani &
//   node scripts/shots.mjs [name-filter …]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.env.SANI_URL ?? 'http://127.0.0.1:8080';
const out = process.env.SHOTS_DIR ?? 'shots';
const password = process.env.SANI_DEMO_PASSWORD ?? 'sani-demo';
const filters = process.argv.slice(2);

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const problems = [];

async function shoot(name, opts = {}) {
  const { width = 1440, height = 900, theme = 'light', lang = 'zh', path = '/admin/', auth = true, run, fullPage = false } = opts;
  const id = `${lang}-${theme}-${width}-${name}`;
  if (filters.length && !filters.some((f) => id.includes(f))) return;
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: theme,
    locale: lang === 'zh' ? 'zh-CN' : 'en-US',
    timezoneId: 'Asia/Shanghai',
    hasTouch: width < 700,
    isMobile: width < 700,
  });
  await ctx.addInitScript(
    ([t, l]) => {
      localStorage.setItem('sani.theme', t);
      localStorage.setItem('sani.lang', l);
    },
    [theme, lang],
  );
  if (auth) {
    const r = await ctx.request.post(`${base}/api/admin/v1/session`, { data: { password } });
    if (!r.ok()) throw new Error(`sign-in failed: ${r.status()}`);
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`[${id}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`[${id}] console.error: ${m.text()}`);
  });
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  if (run) await run(page);
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${out}/${id}.png`, fullPage });
  await ctx.close();
  console.log('shot', id);
}

const expand = (slug) => async (page) => {
  await page.locator('.row', { has: page.locator('.slug', { hasText: slug }) }).first().locator('.main').click();
  await page.waitForSelector('.detail .bar, .detail .empty', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
};

const scenarios = [
  ['login', { auth: false }],
  ['dashboard', {}],
  ['dashboard-full', { fullPage: true }],
  ['detail', { run: expand('weekly-42'), fullPage: true }],
  [
    'hover-chart',
    {
      run: async (page) => {
        await expand('gh')(page);
        const svg = page.locator('.detail .chart svg');
        await svg.scrollIntoViewIfNeeded();
        await page.mouse.wheel(0, 160);
        await page.waitForTimeout(200);
        const box = await svg.boundingBox();
        if (box) await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.6);
      },
    },
  ],
  [
    'edit',
    {
      run: async (page) => {
        await expand('beta')(page);
        await page.keyboard.press('e');
        await page.waitForSelector('.editor');
      },
      fullPage: true,
    },
  ],
  [
    'composer-more',
    {
      run: async (page) => {
        await page.fill('#composer-url', 'https://www.notion.so/dejavu/Travel-notes-Kyoto-2026-8f2e4b1c');
        await page.fill('#composer-slug', 'kyoto');
        await page.waitForTimeout(400);
        await page.click('button[aria-controls="composer-more"]');
      },
    },
  ],
  [
    'created',
    {
      run: async (page) => {
        await page.fill('#composer-url', 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/302');
        await page.keyboard.press('Enter');
        await page.waitForSelector('.toast');
        await page.waitForTimeout(250);
      },
    },
  ],
  ['shortcuts', { run: async (page) => (await page.keyboard.press('?'), await page.waitForSelector('dialog[open]')) }],
  ['settings', { path: '/admin/settings', fullPage: true }],
  ['new', { path: '/admin/new?url=https%3A%2F%2Fgithub.com%2Fsveltejs%2Fsvelte&title=Svelte', auth: true }],
];

const variants = [
  { theme: 'light', lang: 'zh', width: 1440, height: 900 },
  { theme: 'dark', lang: 'zh', width: 1440, height: 900 },
  { theme: 'light', lang: 'en', width: 1440, height: 900 },
  { theme: 'light', lang: 'zh', width: 390, height: 844 },
  { theme: 'dark', lang: 'en', width: 390, height: 844 },
  { theme: 'light', lang: 'zh', width: 768, height: 1024 },
];

for (const v of variants) {
  for (const [name, opts] of scenarios) {
    try {
      await shoot(name, { ...v, ...opts });
    } catch (e) {
      problems.push(`[${v.lang}-${v.theme}-${v.width}-${name}] ${e.message}`);
    }
  }
}

await browser.close();
if (problems.length) {
  console.log('\nProblems:');
  for (const p of problems) console.log(' ', p);
  process.exitCode = 1;
}
