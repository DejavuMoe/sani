import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { modEnter, startSani, stopSani } from './fixture';

const base = 'http://127.0.0.1:18776';
const password = 'local-expiry-fixture';
const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
let server: ChildProcess;

test.beforeAll(async () => { server = await startSani(base, password); });
test.afterAll(() => stopSani(server));

async function login(page: Page, lang = 'en', theme = 'light') {
  await page.addInitScript(({ lang, theme }) => { localStorage.setItem('sani.lang', lang); localStorage.setItem('sani.theme', theme); }, { lang, theme });
  expect((await page.request.post(`${base}/api/admin/v1/session`, { data: { password } })).ok()).toBe(true);
  await page.goto(`${base}/admin/`);
}

async function openExpiry(scope: Locator, zh = false) {
  await scope.getByRole('button', { name: zh ? '有效期' : 'Expires', exact: true }).click();
  await scope.getByRole('menuitemradio', { name: zh ? '自定义时间…' : 'Pick a time…' }).click();
  const pop = scope.locator('.expiry-pop:popover-open');
  await expect(pop).toBeVisible();
  return pop;
}

for (const width of [1280, 390]) for (const lang of ['zh', 'en']) for (const theme of ['light', 'dark']) {
  test(`expiry drafts and time chooser ${lang}/${theme}/${width}`, async ({ page }, info) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 804 });
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await login(page, lang, theme);
    const zh = lang === 'zh', panel = page.locator('#create-panel-url');
    const trigger = panel.getByRole('button', { name: zh ? '有效期' : 'Expires', exact: true });
    const original = await trigger.innerText(), height = (await panel.boundingBox())!.height;
    let pop = await openExpiry(panel, zh);
    const date = pop.getByPlaceholder('YYYY-MM-DD'), time = pop.getByPlaceholder('HH:mm');
    const apply = pop.getByRole('button', { name: zh ? '应用时间' : 'Apply date and time' });
    await expect(apply).toBeEnabled();
    expect((await panel.boundingBox())!.height).toBe(height);
    await date.fill('2032-02-29'); await time.fill('13:07');
    const choose = pop.getByRole('button', { name: zh ? '选择时间' : 'Choose time', exact: true });
    await choose.click();
    const menu = pop.locator('.time-entry > .menu:popover-open');
    const hours = menu.locator('[data-time-column="0"]'), minutes = menu.locator('[data-time-column="1"]');
    const hour = (n: string) => hours.getByRole('menuitemradio', { name: n, exact: true });
    const minute = (n: string) => minutes.getByRole('menuitemradio', { name: n, exact: true });
    await expect(hour('13')).toBeFocused();
    await expect(minute('07')).toHaveAttribute('aria-checked', 'true');
    await expect(hour('13')).toBeInViewport(); await expect(minute('07')).toBeInViewport();
    // Selection is the check alone, like every other menu; the popover uses the access popovers' surface.
    expect(await hour('13').evaluate(el => getComputedStyle(el).color)).toBe(await hour('12').evaluate(el => getComputedStyle(el).color));
    await expect(pop).toHaveClass(/\bpop\b/);
    await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'));
    for (const layer of [pop, menu]) {
      const r = (await layer.boundingBox())!;
      expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.width).toBeLessThanOrEqual(width);
      expect(r.y).toBeGreaterThanOrEqual(0); expect(r.y + r.height).toBeLessThanOrEqual(804);
    }
    await page.screenshot({ path: info.outputPath('time-open.png') });
    await page.evaluate(axe);
    expect(await page.evaluate(async () => (await (window as any).axe.run(document, { resultTypes: ['violations'] })).violations.map((v: any) => ({ id: v.id, nodes: v.nodes.map((n: any) => n.target) })))).toEqual([]);
    await hour('23').click(); await minute('59').click(); await expect(time).toHaveValue('23:59');
    await expect(trigger).toHaveText(original);
    await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0); await expect(pop).toBeVisible(); await expect(choose).toBeFocused();
    await choose.press('Enter'); await expect(hour('23')).toBeFocused();
    await page.keyboard.press('Home'); await page.keyboard.press('Enter'); await expect(time).toHaveValue('00:59');
    await page.keyboard.press('ArrowRight'); await expect(minute('59')).toBeFocused();
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await expect(time).toHaveValue('00:00');
    await page.keyboard.press('End'); await expect(minute('59')).toBeFocused();
    await menu.getByRole('menuitem', { name: zh ? '完成' : 'Done', exact: true }).click();
    await pop.getByRole('button', { name: zh ? '取消' : 'Cancel', exact: true }).click();
    await expect(trigger).toHaveText(original); await expect(trigger).toBeFocused();
    pop = await openExpiry(panel, zh);
    await date.fill('2032-02-30'); await expect(apply).toBeDisabled();
    await date.fill('2032-02-29'); await time.fill('25:99'); await expect(apply).toBeDisabled();
    await choose.click(); await hour('09').click(); await minute('07').click();
    await date.click(); await expect(menu).toHaveCount(0); await expect(pop).toBeVisible();
    await apply.click(); await expect(pop).toHaveCount(0); await expect(trigger).not.toHaveText(original);
    const committed = await trigger.innerText();
    pop = await openExpiry(panel, zh); await expect(time).toHaveValue('09:07');
    await time.fill('10:10'); await page.keyboard.press('Escape'); await expect(pop).toHaveCount(0); await expect(trigger).toHaveText(committed);
    pop = await openExpiry(panel, zh); await expect(time).toHaveValue('09:07');
    await time.fill('11:11'); await panel.locator('.url').click(); await expect(pop).toHaveCount(0);
    pop = await openExpiry(panel, zh); await expect(time).toHaveValue('09:07');
    await time.fill('12:34'); await time.press('Enter'); await expect(pop).toHaveCount(0);
    pop = await openExpiry(panel, zh); await expect(time).toHaveValue('12:34'); await page.keyboard.press('Escape');
    expect((await (await page.request.get(`${base}/api/admin/v1/links`)).json()).items).toEqual([]);

    const sizes = [];
    for (const [mode, label] of [['url', zh ? '链接' : 'Links'], ['text', zh ? '文本' : 'Text'], ['file', zh ? '文件' : 'Files']]) {
      await page.getByRole('tab', { name: label, exact: true }).click();
      const current = page.locator(`#create-panel-${mode}`), button = current.locator('.creation-action');
      await button.focus(); await expect(button).toBeFocused();
      sizes.push(await button.evaluate(el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return [r.height, s.borderRadius, s.fontWeight, r.width >= 88]; }));
      // Link and text show their Enter shortcut as a key badge on desktop; files have none.
      const kbd = button.locator('.go-kbd');
      if (mode === 'file') await expect(kbd).toHaveCount(0);
      else if (width <= 640) await expect(kbd).toBeHidden();
      else {
        await expect(kbd).toBeVisible();
        if (mode === 'text') await expect(kbd).toHaveText(/^(Ctrl|⌘)$/);
        const [b, k] = [(await button.boundingBox())!, (await kbd.boundingBox())!];
        // Label and badge stay together; short labels center the pair within the 88px minimum.
        expect(k.height).toBe(20);
        expect(Math.round(k.y - b.y)).toBe(Math.round(b.y + b.height - (k.y + k.height)));
        expect(Math.round(b.x + b.width - (k.x + k.width))).toBeGreaterThanOrEqual(6);
      }
      if (mode !== 'url') { await openExpiry(current, zh); await page.keyboard.press('Escape'); }
      await page.screenshot({ path: info.outputPath(`${mode}-action.png`), animations: 'disabled' });
    }
    // One height, corner and weight in every composer.
    expect(sizes[1]).toEqual(sizes[0]); expect(sizes[2]).toEqual(sizes[0]);
    expect(sizes[0]).toEqual([width <= 640 ? 40 : 32, '8px', '600', true]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('applied expiry persists through real creation and editor save for links, text and files', async ({ page }) => {
  await login(page);
  for (const [mode, label, endpoint] of [['url', 'Links', 'links'], ['text', 'Text', 'texts'], ['file', 'Files', 'files']]) {
    await page.getByRole('tab', { name: label, exact: true }).click();
    const panel = page.locator(`#create-panel-${mode}`);
    if (mode === 'url') await panel.locator('.url').fill('https://example.com/expiry');
    else if (mode === 'text') await panel.getByLabel('Text to share').fill('Expiry fixture');
    else await panel.locator('input[type=file]').setInputFiles({ name: 'expiry.txt', mimeType: 'text/plain', buffer: Buffer.from('Expiry fixture') });
    const pop = await openExpiry(panel);
    await pop.getByPlaceholder('YYYY-MM-DD').fill('2032-02-29');
    await pop.getByPlaceholder('HH:mm').fill('09:07');
    await pop.getByRole('button', { name: 'Apply date and time' }).click();
    const created = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/api/admin/v1/${endpoint}`));
    if (mode === 'text') await panel.getByLabel('Text to share').press(modEnter);
    else if (mode === 'url') await panel.locator('.url').press('Enter');
    else await panel.locator('.go').click();
    const response = await created; expect(response.ok()).toBe(true);
    const link = await response.json(); expect(link.expiresAt).toBe('2032-02-29T01:07:00Z');
    const row = page.locator(`[data-link="${link.id}"]`);
    await row.locator('button.main').press('e');
    const editor = row.locator('form.editor');
    const editPop = await openExpiry(editor);
    await expect(editPop.getByPlaceholder('HH:mm')).toHaveValue('09:07');
    await editPop.getByPlaceholder('HH:mm').fill('18:45');
    await editPop.getByRole('button', { name: 'Apply date and time' }).click();
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect((await (await page.request.get(`${base}/api/admin/v1/links/${link.id}`)).json()).expiresAt).toBe('2032-02-29T10:45:00Z');
  }
});

test('time columns remain tappable in a narrow touch viewport', async ({ browser }, info) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 320, height: 700 } });
  try {
    const page = await context.newPage();
    await login(page, 'en', 'dark');
    const pop = await openExpiry(page.locator('#create-panel-url'));
    await pop.getByPlaceholder('YYYY-MM-DD').fill('2032-02-29');
    await pop.getByRole('button', { name: 'Choose time', exact: true }).tap();
    const menu = pop.locator('.menu:popover-open');
    await menu.locator('[data-time-column="0"]').getByRole('menuitemradio', { name: '23', exact: true }).tap();
    await menu.locator('[data-time-column="1"]').getByRole('menuitemradio', { name: '59', exact: true }).tap();
    await expect(pop.getByPlaceholder('HH:mm')).toHaveValue('23:59');
    const r = (await menu.boundingBox())!;
    expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.width).toBeLessThanOrEqual(320);
    expect(r.y + r.height).toBeLessThanOrEqual(700);
    await page.screenshot({ path: info.outputPath('touch-time.png') });
    await menu.getByRole('menuitem', { name: 'Done', exact: true }).tap();
    await pop.getByRole('button', { name: 'Apply date and time' }).tap();
    await expect(pop).toHaveCount(0);
  } finally { await context.close(); }
});
