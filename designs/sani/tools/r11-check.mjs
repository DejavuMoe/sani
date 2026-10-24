// Isolated R11 prototype QA: scenes, visitor pages and the password flows.
// Never imports the app or contacts a Sani instance.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(new URL('../../../web/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const collector = readFileSync(new URL('./collect-dom-content.js', import.meta.url), 'utf8');
const base = process.env.PROTO_URL || 'http://127.0.0.1:4312/sani';
const out = resolve(process.env.R11_OUTPUT || '/tmp/sani-r11');
mkdirSync(out, { recursive: true });
const quick = process.argv.includes('--quick');
const browser = await chromium.launch();
const failures = [], results = [], captures = [];

const scenes = ['r11-dashboard', 'r11-link-create', 'r11-text-create', 'r11-text-password', 'r11-text-limit', 'r11-file-create', 'r11-detail-text', 'r11-detail-file', 'r11-detail-url', 'r11-edit-text', 'r11-settings', 'r11-empty', 'r11-login', 'r11-setup'];
const visitors = ['unlock-text', 'unlock-text&state=wrong', 'unlock-text&state=rate', 'unlock-file', 'unlock-url&state=empty', 'share-text', 'share-code&until=1', 'share-file', 'share-file-off', 'notfound', 'share-gone'];
const matrix = quick ? [[1280, 900, 'zh', 'light'], [390, 844, 'en', 'dark']] : [1280, 390].flatMap((w) => ['zh', 'en'].flatMap((l) => ['light', 'dark'].map((t) => [w, w === 1280 ? 900 : 844, l, t])));

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
}

async function inspect(page, name, shot) {
  await page.addScriptTag({ content: axe });
  const r = await page.evaluate(async () => {
    const visible = (e) => { const b = e.getBoundingClientRect(); return b.width > 1 && b.height > 1 && !e.closest('[inert],[data-proto-chrome],.tweaks,.sr-only'); };
    const all = [...document.querySelectorAll('body *')].filter(visible);
    const textNodes = all.filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
    const sizes = [...new Set(textNodes.map((e) => getComputedStyle(e).fontSize))].sort();
    const bySize = Object.fromEntries(sizes.map((s) => [s, textNodes.filter((e) => getComputedStyle(e).fontSize === s).slice(0, 3).map((e) => (e.className?.baseVal ?? e.className) || e.tagName)]));
    const small = textNodes.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 12).map((e) => e.className || e.tagName).slice(0, 5);
    const thick = all.filter((e) => { const s = getComputedStyle(e); return ['Top', 'Right', 'Bottom', 'Left'].some((k) => s[`border${k}Style`] === 'solid' && parseFloat(s[`border${k}Width`]) > 0 && !e.matches('.spinner,.cmp-spinner,.r4-sliders input')); }).map((e) => (e.className?.baseVal ?? e.className) || e.tagName).slice(0, 8);
    // Titles and slugs are user data; separators only count in product copy.
    const dots = textNodes.filter((e) => !e.closest('.lr-title, .ld-short, pre, h1')).filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.includes('·'))).map((e) => e.textContent.trim().slice(0, 40));
    const titles = all.filter((e) => e.hasAttribute('title')).map((e) => e.outerHTML.slice(0, 80));
    const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
    const violations = (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
    const rows = [...document.querySelectorAll('.cmp-options, .r11-pop-foot, .r11-field-pair, .r11-pw')].filter(visible).map((p) => {
      const c = [...p.querySelectorAll(':scope > .opt, :scope > .cmp-go, :scope .r11-access > .opt, :scope .r11-access .expiry > .opt, :scope > .btn, :scope > .field, :scope > .seg')].filter(visible).map((e) => e.getBoundingClientRect());
      return c.filter((a) => c.some((b) => Math.abs(a.top - b.top) < 4 && Math.abs(a.height - b.height) > 1)).length;
    });
    return { sizes, bySize, small, thick, dots, titles, overflow, violations, misaligned: rows.reduce((a, b) => a + b, 0) };
  });
  const bad = [];
  if (r.sizes.length > 4) bad.push(`font sizes ${JSON.stringify(r.bySize)}`);
  if (r.small.length) bad.push(`below 12px: ${r.small.join(',')}`);
  if (r.thick.length) bad.push(`solid borders (lines must be 0.5px shadows): ${r.thick.join(',')}`);
  if (r.dots.length) bad.push(`middle dots: ${r.dots.join(' | ')}`);
  if (r.titles.length) bad.push(`title attributes: ${r.titles.length}`);
  if (r.overflow) bad.push('horizontal overflow');
  if (r.violations.length) bad.push(`axe: ${JSON.stringify(r.violations)}`);
  if (r.misaligned) bad.push(`unequal heights in a row: ${r.misaligned}`);
  if (bad.length) failures.push({ name, bad });
  await page.addScriptTag({ content: collector });
  captures.push(await page.evaluate(() => window.__prototypeFirstUICollectDOMContent()));
  results.push({ name, viewport: page.viewportSize(), sizes: r.sizes });
  if (shot) await page.screenshot({ path: resolve(out, name + '.png') });
}

function watch(page, name) {
  page.on('console', (m) => { if (m.type() === 'error' && !/Download the React DevTools|in-browser Babel/.test(m.text())) failures.push({ name, bad: ['console: ' + m.text().slice(0, 200)] }); });
  page.on('pageerror', (e) => failures.push({ name, bad: ['pageerror: ' + e.message.slice(0, 200)] }));
}

for (const [width, height, lang, theme] of matrix) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, locale: lang === 'zh' ? 'zh-CN' : 'en-US', permissions: ['clipboard-read', 'clipboard-write'] });
  for (const scene of scenes) {
    const page = await ctx.newPage();
    const name = `${scene}-${lang}-${theme}-${width}`;
    watch(page, name);
    await page.goto(`${base}/prototype-r11.html?${new URLSearchParams({ scene, lang, theme, chrome: '0', latency: '0' })}`, { waitUntil: 'networkidle' });
    await page.locator('#app > *').first().waitFor();
    await settle(page);
    if (scene === 'r11-text-password' || scene === 'r11-text-limit') await page.locator('.r11-pop:popover-open').waitFor();
    await inspect(page, name, width === 1280 ? lang === 'zh' && theme === 'light' || lang === 'en' && theme === 'dark' : lang === 'en' && theme === 'dark');
    await page.close();
  }
  for (const v of visitors) {
    const page = await ctx.newPage();
    const name = `visitor-${v.replace(/[&=]/g, '-')}-${lang}-${theme}-${width}`;
    watch(page, name);
    await page.goto(`${base}/visitor-r11.html?page=${v}&lang=${lang}&theme=${theme}`, { waitUntil: 'networkidle' });
    await settle(page);
    await inspect(page, name, (lang === 'zh' && theme === 'light' && width === 1280) || (lang === 'en' && theme === 'dark' && width === 390));
    await page.close();
  }
  await ctx.close();
}

// Flows, with keyboard where the product promises it.
const flows = [];
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, locale: 'zh-CN', permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  watch(page, 'flow-create');
  await page.goto(`${base}/prototype-r11.html?scene=r11-text-password&lang=zh&theme=light&chrome=0&latency=0`, { waitUntil: 'networkidle' });
  const pop = page.locator('.r11-pop:popover-open');
  await pop.waitFor();
  const input = pop.locator('input');
  await expect(input).toBeFocused();
  const generated = await input.inputValue();
  if (!/^[2-9A-HJ-NP-Z]{6}$/.test(generated)) failures.push({ name: 'flow-create', bad: ['generated ' + generated] });
  await pop.getByRole('button', { name: '重新生成' }).click();
  if ((await input.inputValue()) === generated) failures.push({ name: 'flow-create', bad: ['regenerate kept the value'] });
  await input.fill('ab');
  await input.press('Enter');
  await expect(pop.locator('.error-text')).toHaveText('密码需为 4 到 64 个字符');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await input.fill('blue-otter');
  await input.press('Enter');
  await expect(page.locator('.r11-pop:popover-open')).toHaveCount(0);
  const trigger = page.locator('#create-panel-text .r11-access .opt.set').filter({ hasText: 'blue-otter' });
  await expect(trigger).toBeFocused();
  await page.locator('#create-panel-text textarea').press('Control+Enter');
  await expect(page.locator('.toast').first()).toContainText('已复制链接和密码');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  if (!/\/p\/\S+\n密码：blue-otter$/.test(clip)) failures.push({ name: 'flow-create', bad: ['clipboard ' + JSON.stringify(clip)] });
  await expect(page.locator('.lr').first().locator('.r11-lock')).toHaveCount(1);
  flows.push({ name: 'create-text-with-password', generated, clipboard: clip });
  await page.screenshot({ path: resolve(out, 'flow-create-toast.png') });

  await page.goto(`${base}/prototype-r11.html?scene=r11-detail-text&lang=zh&theme=light&chrome=0&latency=0`, { waitUntil: 'networkidle' });
  const value = page.locator('.r11-pw-value');
  await expect(value.locator('.r11-code')).toHaveText('••••••');
  await value.getByRole('button', { name: '显示密码' }).click();
  await expect(value.locator('.r11-code')).toHaveText('7KQ2MX');
  await expect(value.getByRole('button', { name: '隐藏密码' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '复制链接和密码' }).first().click();
  flows.push({ name: 'detail-reveal-copy', clipboard: await page.evaluate(() => navigator.clipboard.readText()) });
  await page.screenshot({ path: resolve(out, 'flow-detail-revealed.png') });

  await page.goto(`${base}/prototype-r11.html?scene=r11-edit-text&lang=zh&theme=light&chrome=0&latency=0`, { waitUntil: 'networkidle' });
  const field = page.locator('#edit-password-10');
  await expect(field).toHaveValue('7KQ2MX');
  await field.fill('');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.toast').first()).toBeVisible();
  await expect(page.locator('.lr[data-link="10"] .r11-lock')).toHaveCount(0);
  flows.push({ name: 'edit-remove-password' });

  await page.goto(`${base}/visitor-r11.html?page=unlock-text&lang=zh&theme=light`, { waitUntil: 'networkidle' });
  await expect(page.locator('#password')).toBeFocused();
  await page.keyboard.type('nope');
  await page.keyboard.press('Enter');
  await page.waitForURL(/state=wrong/);
  await expect(page.locator('#error')).toHaveText('密码不正确');
  await page.locator('#password').fill('7kq2mx');
  await page.keyboard.press('Enter');
  await page.waitForURL(/page=share-text/);
  await expect(page.locator('h1')).toBeVisible();
  flows.push({ name: 'visitor-unlock-wrong-then-right' });
  await ctx.close();
}

await browser.close();
writeFileSync(resolve(out, 'rendered-content.json'), JSON.stringify(captures, null, 1));
writeFileSync(resolve(out, 'verification.json'), JSON.stringify({ base, checked: results.length, flows, failures, results }, null, 1));
console.log(JSON.stringify({ checked: results.length, flows: flows.length, failures: failures.length }));
for (const f of failures.slice(0, 60)) console.log(JSON.stringify(f));
process.exit(failures.length ? 1 : 0);
