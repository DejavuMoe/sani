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
  server = spawn('../bin/sani', [], { env: { ...env, SANI_DATA_DIR: mkdtempSync(join(tmpdir(), 'sani-r5-e2e-')), SANI_LISTEN: '127.0.0.1:18767', SANI_FILES_URL: 'http://localhost:18767', SANI_PASSWORD: password, SANI_LOG_LEVEL: 'error' }, stdio: 'ignore' });
  await expect.poll(async () => { try { return (await fetch(`${base}/healthz`)).status; } catch { return 0; } }).toBe(200);
});
test.afterAll(async () => {
  if (server?.exitCode === null) await new Promise<void>(resolve => { server.once('exit', () => resolve()); server.kill('SIGTERM'); });
});

async function login(page: Page, lang = 'en', theme = 'light') {
  await page.addInitScript(({ lang, theme }) => { localStorage.setItem('sani.lang', lang); localStorage.setItem('sani.theme', theme); }, { lang, theme });
  expect((await page.request.post(`${base}/api/admin/v1/session`, { data: { password } })).ok()).toBe(true);
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
  let config = await (await page.request.get(`${base}/api/admin/v1/config`)).json();
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
  expect((await (await page.request.get(`${base}/api/admin/v1/config`)).json()).metaProxy.host).toBe('127.0.0.1');
  await page.locator('#metadata-host').fill('127.0.0.1');
  await form.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('Could not');
  await expect(form.getByRole('button', { name: 'Retry connection' })).toBeEnabled();
  expect((await (await page.request.get(`${base}/api/admin/v1/config`)).json()).metaProxy).toEqual(config.metaProxy);
  await form.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.locator('#metadata-auth').click();
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('Saved.');
  config = await (await page.request.get(`${base}/api/admin/v1/config`)).json();
  expect(config.metaProxy).toMatchObject({ auth: false, username: '', passwordSet: false });
});

for (const lang of ['zh', 'en']) for (const theme of ['light', 'dark']) for (const width of [1544, 390, 320]) {
  test(`R5 settings geometry and open controls ${lang}/${theme}/${width}`, async ({ page }, info) => {
    await login(page, lang, theme);
    expect((await page.request.patch(`${base}/api/admin/v1/config`, { data: { metaMode: 'direct' } })).ok()).toBe(true);
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
    // Becoming enabled must restore readable text immediately, without an opacity fade.
    expect(await form.locator('.secret button').evaluate(el => getComputedStyle(el).opacity)).toBe('1');
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
      expect(control.height).toBe(width <= 640 ? 40 : 32);
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
    await page.request.patch(`${base}/api/admin/v1/config`, { data: { metaMode: 'off' } });
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
    expect((await (await page.request.get(`${base}/api/admin/v1/links`)).json()).items).toEqual([]);
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

for (const touch of [false, true]) for (const lang of ['zh', 'en']) for (const theme of ['light', 'dark']) {
  test(`responsive control consistency ${touch ? 'touch' : 'mouse'}/${lang}/${theme}`, async ({ browser }, info) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ hasTouch: touch, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      await login(page, lang, theme);
      expect((await page.request.patch(`${base}/api/admin/v1/config`, { data: { metaMode: 'direct' } })).ok()).toBe(true);
      await page.goto(`${base}/admin/settings`);
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(touch);
      const form = page.locator('.metadata-form');
      await form.getByRole('radio').nth(0).focus();
      await page.keyboard.press('ArrowRight');
      await page.locator('#metadata-auth').click();
      for (const width of [721, 720, 641, 640, 502, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        const large = touch || width <= 640;
        for (const input of await page.locator('.inline-form input,.metadata-form input').all()) {
          await expect(input).toHaveCSS('height', large ? '40px' : '32px');
          await expect(input).toHaveCSS('font-size', large ? '16px' : '13px');
        }
        for (const radio of await form.getByRole('radio').all()) await expect(radio).toHaveCSS('height', large ? '32px' : '24px');
        const field = page.locator('#default-fileSlugLength');
        await expect(field).toHaveCSS('font-size', (touch || width <= 640) ? '16px' : '13px');
        await expect(field).toHaveCSS('height', (touch || width <= 640) ? '36px' : '32px');
        await expect(page.locator('.settings-save .btn')).toHaveCSS('height', await form.locator('.actions .btn').first().evaluate(el => getComputedStyle(el).height));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (width === 502 || width === 320) {
          await field.scrollIntoViewIfNeeded();
          await page.screenshot({ path: info.outputPath(`settings-${width}.png`) });
        }
      }
      const toggle = page.locator('#default-exclude');
      if (touch) {
        const targets = await page.locator('#metadata-tls,#metadata-auth').evaluateAll(elements => elements.map(el => {
          const rect = el.getBoundingClientRect(), hit = getComputedStyle(el, '::before');
          return { top: rect.top + parseFloat(hit.top), bottom: rect.bottom - parseFloat(hit.bottom) };
        }));
        expect(targets[0].bottom).toBeLessThanOrEqual(targets[1].top);
      }
      await toggle.scrollIntoViewIfNeeded();
      const checked = await toggle.getAttribute('aria-checked');
      if (touch) {
        const rect = (await toggle.boundingBox())!;
        // The track stays compact; tapping just above it must hit its larger target.
        await page.touchscreen.tap(rect.x + rect.width / 2, rect.y - 8);
      } else {
        await toggle.focus();
        await page.keyboard.press('Space');
      }
      await expect(toggle).toHaveAttribute('aria-checked', checked === 'true' ? 'false' : 'true');
      await audit(page);

      await page.goto(`${base}/admin/`);
      const urlPanel = page.locator('#create-panel-url');
      for (const width of [641, 640, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(urlPanel.locator('.tag-add')).toHaveCSS('min-height', (touch || width <= 640) ? '36px' : '28px');
        await expect(urlPanel.locator('.url')).toHaveCSS('font-size', (touch || width <= 640) ? '16px' : '15px');
      }
      await urlPanel.locator('.tag-add').press('Enter');
      const pop = page.locator('.tag-pop:popover-open');
      await pop.locator('.tag-search input').fill('Responsive color');
      for (const width of [641, 640, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(pop.locator('.tag-search input')).toHaveCSS('font-size', (touch || width <= 640) ? '16px' : '13px');
        await expect(pop.locator('.color-input input')).toHaveCSS('font-size', (touch || width <= 640) ? '16px' : '13px');
        await expect(pop.locator('.tag-done')).toHaveCSS('min-height', (touch || width <= 640) ? '36px' : '28px');
        await expect(pop.locator('.color-swatches button').first()).toHaveCSS('height', (touch || width <= 640) ? '44px' : '36px');
      }
      await audit(page);
      await page.screenshot({ path: info.outputPath('tag-open.png') });
      await page.keyboard.press('Escape');
      await expect(urlPanel.locator('.tag-add')).toBeFocused();
      await urlPanel.getByRole('button', { name: lang === 'zh' ? '有效期' : 'Expires', exact: true }).press('Enter');
      await page.getByRole('menuitemradio', { name: lang === 'zh' ? '自定义时间…' : 'Pick a time…' }).click();
      const calendar = urlPanel.locator('.date-editor');
      await expect(page.locator('.menu:visible')).toHaveCount(0);
      await expect(calendar.getByPlaceholder('YYYY-MM-DD')).toHaveCSS('font-size', '16px');
      await audit(page);

      const response = await page.request.post(`${base}/api/admin/v1/texts`, { data: { text: 'const schedule = "weekly meeting";', format: 'code' } });
      expect(response.ok()).toBe(true);
      const link = await response.json();
      await page.reload();
      await page.getByRole('tab', { name: lang === 'zh' ? '文本' : 'Text', exact: true }).click();
      const panel = page.locator('#create-panel-text');
      const row = page.locator(`[data-link="${link.id}"]`);
      await row.locator('button.main').click();
      await row.getByRole('button', { name: lang === 'zh' ? '编辑' : 'Edit', exact: true }).click();
      const editor = row.locator('.editor');
      for (const format of [0, 1]) {
        await panel.getByRole('radio').nth(format).click();
        await editor.getByRole('radio').nth(format).click();
        for (const width of [641, 640, 320]) {
          await page.setViewportSize({ width, height: 900 });
          const font = (touch || width <= 640) ? '16px' : '13px';
          await expect(panel.locator('textarea')).toHaveCSS('font-size', font);
          await expect(editor.locator('textarea')).toHaveCSS('font-size', font);
        }
      }
      await audit(page);
      await editor.locator('textarea').scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath('editor.png') });
      await editor.getByRole('button', { name: lang === 'zh' ? '取消' : 'Cancel', exact: true }).click();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
