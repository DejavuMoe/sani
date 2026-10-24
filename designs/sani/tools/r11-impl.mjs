// R11 production verification against a seeded ./bin/sani: access-password
// states and the visual rules, in both languages, themes and widths.
//   go run ./scripts/seed -data /tmp/sani-r11-impl-data -password sani-demo -icons=false
//   node designs/sani/tools/r11-impl.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const require = createRequire(new URL('../../../web/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const collector = readFileSync(new URL('./collect-dom-content.js', import.meta.url), 'utf8');
const port = 18790, base = `http://127.0.0.1:${port}`, password = 'sani-demo';
const out = resolve(process.env.R11_IMPL_OUTPUT || '/tmp/sani-r11-impl');
mkdirSync(out, { recursive: true });
const server = spawn(new URL('../../../bin/sani', import.meta.url).pathname, [], {
  env: { ...process.env, SANI_LISTEN: `127.0.0.1:${port}`, SANI_DATA_DIR: process.env.R11_IMPL_DATA || '/tmp/sani-r11-impl-data', SANI_FILES_URL: `http://localhost:${port}`, SANI_FETCH_META: 'false', SANI_LOG_LEVEL: 'error' },
  stdio: 'ignore',
});
const failures = [], results = [], captures = [];
try {
  await expect.poll(async () => { try { return (await fetch(`${base}/healthz`)).status; } catch { return 0; } }, { timeout: 15000 }).toBe(200);
  const browser = await chromium.launch();
  const setup = await browser.newContext();
  expect((await setup.request.post(`${base}/api/admin/v1/session`, { data: { password } })).ok()).toBe(true);
  const text = await (await setup.request.post(`${base}/api/admin/v1/texts`, { data: { text: 'Deploy checklist\n\n1. Back up /data/sani.db\n2. Restart the container', title: 'Deploy checklist', password: '7KQ2MX', maxClicks: 10 } })).json();
  const link = await (await setup.request.post(`${base}/api/admin/v1/links`, { data: { url: 'https://example.com/handbook', slug: 'handbook', password: 'H3KP9W' } })).json();
  await setup.close();

  async function inspect(page, name) {
    await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'));
    // The app's CSP refuses inline script tags; evaluate injects the same code.
    await page.evaluate(axe);
    const r = await page.evaluate(async () => {
      const visible = (e) => { const b = e.getBoundingClientRect(); return b.width > 1 && b.height > 1 && !e.closest('[inert],.sr-only'); };
      const all = [...document.querySelectorAll('body *')].filter(visible);
      const texts = all.filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
      const sizes = [...new Set(texts.map((e) => getComputedStyle(e).fontSize))].sort();
      const small = texts.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 12).length;
      const solid = all.filter((e) => { const s = getComputedStyle(e); return ['Top', 'Right', 'Bottom', 'Left'].some((k) => s[`border${k}Style`] === 'solid' && parseFloat(s[`border${k}Width`]) > 0) && !e.matches('.spinner,[class*=spinner],input[type=range]'); }).map((e) => String(e.className?.baseVal ?? e.className).split(' ')[0] || e.tagName).slice(0, 6);
      const dots = texts.filter((e) => !e.closest('.title,.short-url,pre,h1,.fname,.lr-title')).filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.includes('·'))).map((e) => e.textContent.trim().slice(0, 40));
      const titles = all.filter((e) => e.hasAttribute('title')).length;
      const violations = (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
      return { sizes, small, solid, dots, titles, violations, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    });
    const bad = [];
    if (r.sizes.length > 4) bad.push('font sizes ' + r.sizes.join(','));
    if (r.small) bad.push(`${r.small} texts below 12px`);
    if (r.solid.length) bad.push('solid borders ' + r.solid.join(','));
    if (r.dots.length) bad.push('dots ' + r.dots.join(' | '));
    if (r.titles) bad.push(`${r.titles} title attributes`);
    if (r.violations.length) bad.push('axe ' + JSON.stringify(r.violations));
    if (r.overflow) bad.push('horizontal overflow');
    if (bad.length) failures.push({ name, bad });
    await page.evaluate(collector);
    captures.push(await page.evaluate(() => window.__prototypeFirstUICollectDOMContent()));
    results.push({ name, sizes: r.sizes });
    await page.screenshot({ path: resolve(out, name + '.png') });
  }

  for (const [width, lang, theme] of [[1280, 'zh', 'light'], [1280, 'en', 'dark'], [390, 'en', 'dark'], [390, 'zh', 'light']]) {
    const ctx = await browser.newContext({ viewport: { width, height: width > 640 ? 900 : 844 }, deviceScaleFactor: 2, locale: lang === 'zh' ? 'zh-CN' : 'en-US', colorScheme: theme });
    await ctx.addInitScript(({ lang, theme }) => { localStorage.setItem('sani.lang', lang); localStorage.setItem('sani.theme', theme); }, { lang, theme });
    expect((await ctx.request.post(`${base}/api/admin/v1/session`, { data: { password } })).ok()).toBe(true);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push({ name: 'pageerror', bad: [e.message] }));
    const tag = `${lang}-${theme}-${width}`;
    await page.goto(`${base}/admin/`);
    await page.locator('.row').first().waitFor();
    await inspect(page, `dashboard-${tag}`);
    await page.getByRole('tab', { name: lang === 'zh' ? '文本' : 'Text', exact: true }).click();
    const panel = page.locator('#create-panel-text');
    await panel.locator('textarea').fill('Deploy checklist');
    await panel.locator('button[aria-haspopup="dialog"]').nth(1).click();
    await page.locator('[popover]:popover-open input').waitFor();
    await inspect(page, `password-popover-${tag}`);
    await page.keyboard.press('Escape');
    await panel.locator('button[aria-haspopup="dialog"]').first().click();
    await page.locator('[popover]:popover-open input').waitFor();
    await inspect(page, `limit-popover-${tag}`);
    await page.keyboard.press('Escape');
    const row = page.locator(`[data-link="${text.id}"]`);
    await row.locator('button.main').click();
    await row.locator('.meta .password').waitFor();
    await row.getByRole('button', { name: lang === 'zh' ? '显示密码' : 'Show password' }).click();
    await row.locator('.side').scrollIntoViewIfNeeded();
    await inspect(page, `detail-${tag}`);
    await row.locator('button.main').press('e');
    await row.locator('form.editor input.mono').waitFor();
    await inspect(page, `editor-${tag}`);
    await ctx.close();

    const visitor = await browser.newContext({ viewport: { width, height: width > 640 ? 900 : 844 }, deviceScaleFactor: 2, locale: lang === 'zh' ? 'zh-CN' : 'en-US', colorScheme: theme });
    const v = await visitor.newPage();
    await v.goto(text.shortUrl);
    await inspect(v, `visitor-unlock-${tag}`);
    await v.locator('#password').fill('wrong');
    await v.locator('#password').press('Enter');
    await v.locator('#error').waitFor();
    await inspect(v, `visitor-wrong-${tag}`);
    await v.locator('#password').fill('7kq2mx');
    await v.locator('#password').press('Enter');
    await v.locator('#text').waitFor();
    await inspect(v, `visitor-share-${tag}`);
    await v.goto(`${base}/${link.slug}`);
    await inspect(v, `visitor-link-unlock-${tag}`);
    await v.goto(`${base}/no-such-slug`);
    await inspect(v, `visitor-404-${tag}`);
    await visitor.close();
  }
  await browser.close();
} finally {
  server.kill('SIGTERM');
}
writeFileSync(resolve(out, 'rendered-content.json'), JSON.stringify(captures, null, 1));
writeFileSync(resolve(out, 'verification.json'), JSON.stringify({ base, checked: results.length, failures, results }, null, 1));
console.log(JSON.stringify({ checked: results.length, failures: failures.length }));
for (const f of failures) console.log(JSON.stringify(f).slice(0, 600));
process.exit(failures.length ? 1 : 0);
