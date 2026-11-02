import { expect, test, type Locator, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const base = 'http://127.0.0.1:18776';
const password = 'local-expiry-fixture';
const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
let server: ChildProcess;

test.beforeAll(async () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('SANI_')) delete env[key];
  server = spawn('../bin/sani', [], {
    env: { ...env, SANI_DATA_DIR: mkdtempSync(join(tmpdir(), 'sani-expiry-e2e-')), SANI_LISTEN: '127.0.0.1:18776', SANI_FILES_URL: 'http://localhost:18776', SANI_PASSWORD: password, SANI_FETCH_META: 'false', SANI_LOG_LEVEL: 'error' }, stdio: 'ignore',
  });
  await expect.poll(async () => { try { return (await fetch(`${base}/healthz`)).status; } catch { return 0; } }).toBe(200);
});
test.afterAll(async () => {
  if (server?.exitCode === null) await new Promise<void>(resolve => { server.once('exit', () => resolve()); server.kill('SIGTERM'); });
});

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
    // Captures are synthetic and limited to the changed controls for content review.
    const collector = readFileSync('../designs/sani/tools/collect-dom-content.js', 'utf8');
    await page.evaluate(collector);
    const content = await page.evaluate(() => {
      const capture = (window as any).__prototypeFirstUICollectDOMContent();
      capture.items = capture.items.filter((i: any) => /expiry-pop|date-editor|time-entry|time-columns|time-options|time-done|creation-action/.test(i.location));
      return capture;
    });
    writeFileSync(info.outputPath('content.json'), JSON.stringify(content, null, 2));
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
      sizes.push(await button.evaluate(el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return [r.width, r.height, s.borderRadius, s.fontWeight]; }));
      // No key badge on the buttons; the shortcut is announced as a tooltip on focus.
      const tip = page.locator('.sani-tooltip');
      if (mode === 'file') await expect(tip).toHaveCount(0);
      else await expect(tip).toHaveText(mode === 'url' ? `${zh ? '缩短' : 'Shorten'} (↵)` : new RegExp(`\\((Ctrl|⌘) ↵\\)$`));
      if (mode !== 'url') { await openExpiry(current, zh); await page.keyboard.press('Escape'); }
      await page.screenshot({ path: info.outputPath(`${mode}-action.png`), animations: 'disabled' });
    }
    // Same width, corner and weight; the link action fills its 52px row with a 6px inset.
    expect(sizes[2]).toEqual(sizes[1]);
    expect(sizes[0]).toEqual([88, 40, '6px', '600']);
    expect(sizes[1]).toEqual([88, width <= 640 ? 40 : 32, '6px', '600']);
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
    if (mode === 'text') await panel.getByLabel('Text to share').press('Control+Enter');
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
