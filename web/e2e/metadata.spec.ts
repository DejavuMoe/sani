import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// A separate temporary instance leaves the main suite's environment-lock fixture intact.
const base = 'http://127.0.0.1:18767';
const password = 'local-r5-fixture';
const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
let server: ChildProcess;
test.beforeAll(async () => {
  const env = { ...process.env };
  for (const key of ['SANI_FETCH_META', 'SANI_META_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) delete env[key];
  server = spawn('../bin/sani', [], { env: { ...env, SANI_DATA_DIR: mkdtempSync(join(tmpdir(), 'sani-r5-e2e-')), SANI_LISTEN: '127.0.0.1:18767', SANI_PASSWORD: password, SANI_LOG_LEVEL: 'error' }, stdio: 'ignore' });
  await expect.poll(async () => { try { return (await fetch(`${base}/healthz`)).status; } catch { return 0; } }).toBe(200);
});
test.afterAll(async () => {
  if (server?.exitCode === null) await new Promise<void>(resolve => { server.once('exit', () => resolve()); server.kill('SIGTERM'); });
});

async function login(page: Page, lang = 'en', theme = 'light') {
  await page.addInitScript(({ lang, theme }) => { localStorage.setItem('sani.lang', lang); localStorage.setItem('sani.theme', theme); }, { lang, theme });
  expect((await page.request.post(`${base}/api/session`, { data: { password } })).ok()).toBe(true);
}
async function audit(page: Page) {
  await page.evaluate(axe);
  const violations = await page.evaluate(async () => {
    const root = document.querySelector('.tag-pop:popover-open') ?? document;
    return (await (window as any).axe.run(root, { resultTypes: ['violations'] })).violations.map((v: any) => ({ id: v.id, nodes: v.nodes.map((n: any) => n.target) }));
  });
  expect(violations).toEqual([]);
  expect(await page.locator('select,input[type=color],input[type=date],input[type=time],input[type=datetime-local],[title]').count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('saved proxies persist, redact secrets and never forward a saved password to a changed address', async ({ page }) => {
  await login(page);
  await page.goto(`${base}/admin/settings`);
  const form = page.locator('.metadata-form');
  await form.getByRole('radio', { name: 'HTTP(S)', exact: true }).click();
  await page.locator('#metadata-host').fill('127.0.0.1');
  await page.locator('#metadata-port').fill('1');
  await page.locator('#metadata-tls').click();
  await page.locator('#metadata-auth').click();
  await page.locator('#metadata-user').fill('fixture');
  await page.locator('#metadata-password').fill('only-test-secret');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('Saved.');
  let config = await (await page.request.get(`${base}/api/config`)).json();
  expect(config.metaProxy).toMatchObject({ scheme: 'http', host: '127.0.0.1', port: 1, auth: true, username: 'fixture', passwordSet: true });
  expect(JSON.stringify(config)).not.toContain('only-test-secret');
  await page.reload();
  await expect(form.getByRole('button', { name: 'Replace', exact: true })).toBeVisible();
  await form.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(page.locator('#metadata-password')).toHaveValue('');
  await form.getByRole('button', { name: 'Cancel replacement' }).click();
  await page.locator('#metadata-host').fill('localhost');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('Re-enter');
  expect((await (await page.request.get(`${base}/api/config`)).json()).metaProxy.host).toBe('127.0.0.1');
  await page.locator('#metadata-host').fill('127.0.0.1');
  await form.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('Could not');
  await expect(form.getByRole('button', { name: 'Retry connection' })).toBeEnabled();
  expect((await (await page.request.get(`${base}/api/config`)).json()).metaProxy).toEqual(config.metaProxy);
  await form.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.locator('#metadata-auth').click();
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('Saved.');
  config = await (await page.request.get(`${base}/api/config`)).json();
  expect(config.metaProxy).toMatchObject({ auth: false, username: '', passwordSet: false });
});

for (const lang of ['zh', 'en']) for (const theme of ['light', 'dark']) for (const width of [1544, 390, 320]) {
  test(`R5 settings geometry and open controls ${lang}/${theme}/${width}`, async ({ page }, info) => {
    await login(page, lang, theme);
    expect((await page.request.patch(`${base}/api/config`, { data: { metaMode: 'direct' } })).ok()).toBe(true);
    await page.setViewportSize({ width, height: 1040 });
    await page.goto(`${base}/admin/settings`);
    const form = page.locator('.metadata-form');
    const radios = form.getByRole('radio');
    await radios.nth(0).focus();
    await page.keyboard.press('ArrowRight');
    await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(radios.nth(1)).toBeFocused();
    await page.locator('#metadata-auth').click();
    await page.locator('#metadata-user').fill('demo');
    await page.locator('#metadata-password').fill('new-test-password');
    const geometry = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.inline-form,.metadata-form .secret:not(.stored)')].map(row => {
        const rects = [...row.querySelectorAll('input,button')].map(el => el.getBoundingClientRect());
        return rects.map(r => ({ height: r.height, top: r.top }));
      });
      const centers = [...document.querySelectorAll('.metadata-form [role=radio]')].map(el => {
        const rect = el.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(el);
        const text = range.getBoundingClientRect();
        return { dx: Math.abs(text.x + text.width / 2 - rect.x - rect.width / 2), dy: Math.abs(text.y + text.height / 2 - rect.y - rect.height / 2) };
      });
      return { rows, centers };
    });
    for (const row of geometry.rows) for (const control of row) {
      expect(control.height).toBe(width <= 640 ? 44 : 36);
      expect(Math.abs(control.top - row[0].top)).toBeLessThanOrEqual(1);
    }
    for (const center of geometry.centers) { expect(center.dx).toBeLessThan(1); expect(center.dy).toBeLessThanOrEqual(1); }
    await audit(page);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath('settings.png'), fullPage: true });
    const before = await form.boundingBox();
    await radios.nth(2).click();
    await expect(page.locator('#metadata-tls')).toHaveCount(0);
    const after = await form.boundingBox();
    expect(after?.x).toBe(before?.x); expect(after?.width).toBe(before?.width);
    await page.locator('#metadata-enabled').click();
    await expect(radios).toHaveCount(0);
    await page.locator('#metadata-enabled').click();
    await expect(radios.nth(2)).toHaveAttribute('aria-checked', 'true');
  });
}

for (const lang of ['zh', 'en']) for (const theme of ['light', 'dark']) {
  test(`custom color, calendar and tooltips ${lang}/${theme}`, async ({ page }, info) => {
    await login(page, lang, theme);
    await page.request.patch(`${base}/api/config`, { data: { metaMode: 'off' } });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`${base}/admin/`);
    const panel = page.locator('#create-panel-url');
    await panel.locator('.tag-add').click();
    const pop = page.locator('.tag-pop:popover-open');
    await pop.locator('.tag-search input').fill('R5 color');
    const color = pop.locator('.color-input input');
    await color.fill('hsl(210, 20%, 40%)');
    await pop.getByRole('slider').nth(0).focus();
    await page.keyboard.press('ArrowRight');
    await expect(color).toHaveValue('#53667a');
    await color.fill('bad');
    await expect(pop.locator('.tag-create')).toBeDisabled();
    await color.fill('rgb(88, 114, 165)');
    await audit(page);
    await page.screenshot({ path: info.outputPath('color.png') });
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
    await panel.getByRole('button', { name: lang === 'zh' ? '有效期' : 'Expires', exact: true }).click();
    await page.getByRole('menuitemradio', { name: lang === 'zh' ? '自定义时间…' : 'Pick a time…' }).click();
    const calendar = panel.locator('.date-editor');
    await expect(calendar).toBeVisible();
    const date = calendar.getByPlaceholder('YYYY-MM-DD'), time = calendar.getByPlaceholder('HH:mm');
    await date.fill('2032-02-30');
    await expect(calendar.getByRole('alert')).toBeVisible();
    await expect(calendar.getByRole('button').last()).toBeDisabled();
    await date.fill('2032-02-29'); await time.fill('12:30');
    await time.press('Enter');
    await expect(calendar.getByRole('button').last()).toBeDisabled();
    await expect(calendar.getByRole('button', { name: '2032-02-29', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect((await (await page.request.get(`${base}/api/links`)).json()).items).toEqual([]);
    await audit(page);
    await calendar.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('calendar.png') });
    await page.setViewportSize({ width: 1544, height: 900 });
    await page.goto(`${base}/admin/`);
    const shortcuts = page.locator('.hide-touch');
    await shortcuts.hover();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.mouse.move(0, 0); await shortcuts.focus();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await audit(page);
    await page.screenshot({ path: info.outputPath('tooltip.png') });
    await page.keyboard.press('Escape'); await expect(page.getByRole('tooltip')).toHaveCount(0);
  });
}
