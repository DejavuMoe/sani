// Screens of a brand-new instance: setup, then the empty dashboard.
//   SANI_SETUP_CODE=abcd-efgh-jkmn SANI_URL=http://127.0.0.1:18081 node scripts/fresh-shots.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.env.SANI_URL ?? 'http://127.0.0.1:8080';
const out = process.env.SHOTS_DIR ?? 'shots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();

async function shot(file, { lang, theme = 'light', width = 1440, height = 900 }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: theme, locale: lang === 'zh' ? 'zh-CN' : 'en-US', isMobile: width < 700 });
  await ctx.addInitScript(([t, l]) => (localStorage.setItem('sani.theme', t), localStorage.setItem('sani.lang', l)), [theme, lang]);
  if (!file.startsWith('setup')) await ctx.request.post(`${base}/api/session`, { data: { password: 'fresh-password' } });
  const page = await ctx.newPage();
  await page.goto(`${base}/admin/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${file}` });
  await ctx.close();
  console.log('wrote', file);
}

await shot('setup-zh-light.png', { lang: 'zh' });
await shot('setup-en-dark-390.png', { lang: 'en', theme: 'dark', width: 390, height: 844 });
const ctx = await browser.newContext();
await ctx.request.post(`${base}/api/setup`, { data: { password: 'fresh-password', code: process.env.SANI_SETUP_CODE } });
await ctx.close();
await shot('empty-zh-light.png', { lang: 'zh' });
await shot('empty-en-dark.png', { lang: 'en', theme: 'dark' });
await shot('empty-zh-390.png', { lang: 'zh', width: 390, height: 844 });
await browser.close();
