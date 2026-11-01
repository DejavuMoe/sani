import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(new URL('../../../web/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const collector = readFileSync(new URL('./collect-dom-content.js', import.meta.url), 'utf8');
const out = resolve(process.env.EXPIRY_OUTPUT || '/tmp/sani-expiry');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const results = [], captures = [], errors = [];
try {
  for (const width of [1280, 390]) for (const lang of ['zh', 'en']) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, locale: lang === 'zh' ? 'zh-CN' : 'en-US' });
    page.on('pageerror', error => errors.push(error.message));
    const name = `${lang}-${theme}-${width}`;
    await page.goto(`http://127.0.0.1:4313/sani/prototype-expiry.html?scene=r11-link-create&lang=${lang}&theme=${theme}&chrome=0&now=live`);
    const panel = page.locator('#create-panel-url');
    const trigger = panel.locator('.expiry > button');
    await expect(trigger).toBeVisible();
    const initial = await panel.boundingBox();
    const original = await trigger.innerText();
    const open = async (keyboard = false) => {
      if (keyboard) { await trigger.focus(); await trigger.press('Enter'); }
      else await trigger.click();
      const item = page.getByRole('menuitemradio', { name: lang === 'zh' ? '自定义时间…' : 'Pick a time…' });
      if (keyboard) { await expect(page.locator('[role="menu"]:popover-open [role="menuitemradio"][aria-checked="true"]')).toBeFocused(); await page.keyboard.press('End'); await expect(item).toBeFocused(); await page.keyboard.press('Enter'); }
      else await item.click();
      await expect(page.locator('.expiry-pop:popover-open')).toBeVisible();
    };
    await open();
    const pop = page.locator('.expiry-pop:popover-open');
    const date = pop.getByPlaceholder('YYYY-MM-DD');
    await expect(date).toBeFocused();
    expect((await panel.boundingBox()).height).toBe(initial.height);
    await expect(trigger).toHaveText(original);
    const box = await pop.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
    await page.screenshot({ path: resolve(out, `${name}.png`) });
    await page.addScriptTag({ content: axe });
    const violations = await page.evaluate(async () => (await axe.run(document.querySelector('.expiry-pop:popover-open'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => v.id));
    expect(violations).toEqual([]);
    await page.addScriptTag({ content: collector });
    const capture = await page.evaluate(() => window.__prototypeFirstUICollectDOMContent());
    capture.items = capture.items.filter(item => /expiry-pop/.test(item.location));
    captures.push(capture);
    const previous = await date.inputValue();
    await date.fill('2032-02-30');
    await expect(pop.getByRole('alert')).toBeVisible();
    await expect(pop.getByRole('button', { name: lang === 'zh' ? '应用时间' : 'Apply date and time' })).toBeDisabled();
    await date.press('Escape');
    await expect(pop).toHaveCount(0); await expect(trigger).toBeFocused(); await expect(trigger).toHaveText(original);
    await open(true);
    await expect(date).toHaveValue(previous);
    await pop.getByRole('button', { name: lang === 'zh' ? '取消' : 'Cancel', exact: true }).click();
    await expect(pop).toHaveCount(0); await expect(trigger).toHaveText(original);
    await open();
    await pop.getByRole('button', { name: lang === 'zh' ? '应用时间' : 'Apply date and time' }).click();
    await expect(pop).toHaveCount(0); await expect(trigger).not.toHaveText(original);
    const committed = await trigger.innerText();
    await open();
    await date.fill('2032-02-29'); await pop.getByPlaceholder('HH:mm').fill('13:45');
    await date.press('Enter');
    await expect(pop).toHaveCount(0); await expect(trigger).not.toHaveText(committed);
    await expect(trigger).toContainText('2032');
    await open();
    await expect(date).toHaveValue('2032-02-29');
    await page.locator('.hd-brand').click();
    await expect(pop).toHaveCount(0); await expect(trigger).toContainText('2032');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    results.push({ name, layoutUnchanged: true, pointer: true, keyboard: true, cancellation: true, validation: true, axe: violations });
    await page.close();
    console.log(`PASS ${name}`);
  }
  for (const scene of ['r11-text-create', 'r11-file-create', 'r11-edit-text']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:4313/sani/prototype-expiry.html?scene=${scene}&lang=en&theme=light&chrome=0&now=live`);
    const scope = scene === 'r11-edit-text' ? page.locator('form.le') : page.locator(`#create-panel-${scene === 'r11-text-create' ? 'text' : 'file'}`);
    const trigger = scope.locator('.expiry > button');
    await trigger.click();
    await page.getByRole('menuitemradio', { name: 'Pick a time…' }).click();
    const pop = page.locator('.expiry-pop:popover-open');
    await expect(pop).toBeVisible();
    await pop.getByRole('button', { name: 'Apply date and time' }).click();
    await expect(pop).toHaveCount(0);
    await expect(trigger).toContainText('Until');
    results.push({ name: scene, apply: true });
    await page.close();
    console.log(`PASS ${scene}`);
  }
  expect(errors).toEqual([]);
  writeFileSync(resolve(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  writeFileSync(resolve(out, 'content.json'), JSON.stringify({ ...captures[0], items: captures.flatMap(c => c.items) }, null, 2));
} finally { await browser.close(); }
