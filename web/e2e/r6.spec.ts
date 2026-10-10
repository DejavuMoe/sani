import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const base = 'http://127.0.0.1:18768';
const password = 'local-r6-fixture';
const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
let server: ChildProcess;

test.beforeAll(async () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('SANI_')) delete env[key];
  server = spawn('../bin/sani', [], {
    env: { ...env, SANI_DATA_DIR: mkdtempSync(join(tmpdir(), 'sani-r6-e2e-')), SANI_LISTEN: '127.0.0.1:18768', SANI_FILES_URL: 'http://localhost:18768', SANI_PASSWORD: password, SANI_FETCH_META: 'false', SANI_LOG_LEVEL: 'error' },
    stdio: 'ignore',
  });
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
  expect(await page.evaluate(async () => (await (window as any).axe.run(document, { resultTypes: ['violations'] })).violations.map((v: any) => ({ id: v.id, nodes: v.nodes.map((n: any) => n.target) })))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('input[type=number],select,[title]').count()).toBe(0);
}

test('three lengths validate, retry, persist and govern actual URL/text/file creation', async ({ page }) => {
  await login(page);
  await page.goto(`${base}/admin/settings`);
  const form = page.locator('section', { has: page.getByRole('heading', { name: 'Creation defaults' }) });
  const url = form.getByLabel('Links', { exact: true });
  const text = form.getByLabel('Text', { exact: true });
  const file = form.getByLabel('Files', { exact: true });
  await expect(url).toHaveValue('5');
  await expect(text).toHaveValue('10');
  await expect(file).toHaveValue('10');
  for (const invalid of ['', '2', '33', '5.5', 'abc']) {
    await text.fill(invalid);
    await expect(text).toHaveAttribute('aria-invalid', 'true');
    await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  }
  await url.fill('32');
  await text.fill('5');
  await file.fill('12');
  await expect(form).toContainText('easier to guess');
  let fail = true;
  await page.route('**/api/admin/v1/config', route => {
    if (route.request().method() !== 'PATCH' || !fail) return route.continue();
    fail = false;
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'failed' } }) });
  });
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  expect((await (await page.request.get(`${base}/api/admin/v1/config`)).json()).textSlugLength).toBe(10);
  await form.getByRole('button', { name: /Retry/ }).press('Enter');
  await expect(form.getByRole('status')).toContainText('Saved');
  await page.unroute('**/api/admin/v1/config');
  await page.reload();
  await expect(url).toHaveValue('32');
  await expect(text).toHaveValue('5');
  await expect(file).toHaveValue('12');
  const link = await page.request.post(`${base}/api/admin/v1/links`, { data: { url: 'https://example.com/r6' } });
  const sharedText = await page.request.post(`${base}/api/admin/v1/texts`, { data: { text: 'Shared meeting notes' } });
  const sharedFile = await page.request.post(`${base}/api/admin/v1/files`, { multipart: { file: { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Meeting notes') } } });
  for (const response of [link, sharedText, sharedFile]) expect(response.status()).toBe(201);
  expect((await link.json()).slug).toHaveLength(32);
  expect((await sharedText.json()).slug).toHaveLength(5);
  expect((await sharedFile.json()).slug).toHaveLength(12);
  await text.fill('3');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('Saved');
  expect((await (await page.request.post(`${base}/api/admin/v1/texts`, { data: { text: 'Three characters' } })).json()).slug).toHaveLength(3);
});

test('a reported environment lock disables only its own field and is omitted from saves', async ({ page }) => {
  await login(page);
  await page.route('**/api/admin/v1/config', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const config = await response.json();
    config.configSources.textSlugLength = 'env';
    await route.fulfill({ response, json: config });
  });
  await page.goto(`${base}/admin/settings`);
  const form = page.locator('form.creation-form');
  await expect(form.getByLabel('Text', { exact: true })).toBeDisabled();
  await expect(form).toContainText('Set by environment');
  await form.getByLabel('Links', { exact: true }).fill('7');
  await form.getByLabel('Files', { exact: true }).fill('13');
  const saved = page.waitForRequest(r => r.url().endsWith('/api/admin/v1/config') && r.method() === 'PATCH');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await saved).postDataJSON()).toEqual({ slugLength: 7, fileSlugLength: 13 });
  await expect(form.getByRole('status')).toContainText('Saved');
});

for (const format of ['plain', 'code']) {
  test(`${format} preview survives statistics and list refresh without refetching or scrolling`, async ({ page }) => {
    await login(page);
    const text = Array.from({ length: 36 }, (_, n) => format === 'code' ? `const entry${n} = '${'weekly notes '.repeat(12)}';` : `Meeting note ${n + 1}: discuss next week's schedule.`).join('\n');
    const created = await page.request.post(`${base}/api/admin/v1/texts`, { data: { text, format } });
    const link = await created.json();
    let bodyRequests = 0;
    page.on('request', request => { if (request.url().endsWith(`/api/admin/v1/links/${link.id}/text`)) bodyRequests++; });
    await page.clock.install();
    await page.goto(`${base}/admin/`);
    const row = page.locator(`[data-link="${link.id}"]`);
    await row.locator('button.main').click();
    const preview = row.locator('.preview');
    await expect(preview).toHaveText(text);
    await preview.evaluate(el => { el.scrollTop = 140; el.scrollLeft = 80; });
    const geometry = () => preview.evaluate(el => ({ height: el.getBoundingClientRect().height, top: el.scrollTop, left: el.scrollLeft }));
    const before = await geometry();
    expect(bodyRequests).toBe(1);
    for (const days of [7, 90, 30]) {
      const response = page.waitForResponse(r => r.url().endsWith(`/stats?days=${days}`));
      await row.getByRole('radio', { name: `${days} days`, exact: true }).click();
      await response;
      await expect(preview).toHaveText(text);
      expect(await geometry()).toEqual(before);
      expect(bodyRequests).toBe(1);
    }
    const refreshed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/v1/links');
    await page.clock.fastForward(60_000);
    await refreshed;
    await expect(preview).toHaveText(text);
    expect(await geometry()).toEqual(before);
    expect(bodyRequests).toBe(1);
    await audit(page);
  });
}

test('failed initial body load retries and an edited body keeps the old content until ready', async ({ page }) => {
  await login(page);
  const link = await (await page.request.post(`${base}/api/admin/v1/texts`, { data: { text: 'Original meeting notes' } })).json();
  const path = `**/api/admin/v1/links/${link.id}/text`;
  await page.route(path, route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal' } }) }));
  await page.goto(`${base}/admin/`);
  const row = page.locator(`[data-link="${link.id}"]`);
  await row.locator('button.main').click();
  await expect(row.getByRole('status')).toContainText('Could not load');
  await page.unroute(path);
  await row.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(row.locator('.preview')).toHaveText('Original meeting notes');
  expect((await page.request.patch(`${base}/api/admin/v1/links/${link.id}`, { data: { text: 'Updated meeting notes' } })).ok()).toBe(true);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(path, async route => { await held; await route.continue(); });
  const requested = page.waitForRequest(r => r.url().endsWith(`/api/admin/v1/links/${link.id}/text`));
  await row.getByRole('radio', { name: '7 days', exact: true }).click();
  await requested;
  await expect(row.locator('.preview')).toHaveText('Original meeting notes');
  await expect(row.getByRole('status')).toContainText('Updating');
  release();
  await expect(row.locator('.preview')).toHaveText('Updated meeting notes');
  await page.unroute(path);
});

for (const lang of ['zh', 'en']) for (const theme of ['light', 'dark']) for (const width of [1280, 390, 320]) {
  test(`R6 settings and previews ${lang}/${theme}/${width}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await login(page, lang, theme);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${base}/admin/settings`);
    const fields = page.locator('.length-input input');
    await expect(fields).toHaveCount(3);
    for (const field of await fields.all()) await field.fill('32');
    const toggle = page.getByRole('switch', { name: lang === 'zh' ? '排除易混淆字符' : 'Exclude look-alike characters' });
    await toggle.focus();
    const checked = await toggle.getAttribute('aria-checked');
    await toggle.press('Space');
    await expect(toggle).toHaveAttribute('aria-checked', checked === 'true' ? 'false' : 'true');
    await audit(page);
    await fields.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('settings.png') });
    for (const format of ['plain', 'code']) {
      const text = format === 'plain' ? '下周安排：整理会议记录、核对日程，并更新项目清单。' : Array.from({ length: 36 }, (_, n) => `const entry${n} = '${'weekly schedule '.repeat(10)}';`).join('\n');
      const link = await (await page.request.post(`${base}/api/admin/v1/texts`, { data: { text, format } })).json();
      await page.goto(`${base}/admin/`);
      const row = page.locator(`[data-link="${link.id}"]`);
      await row.locator('button.main').click();
      await expect(row.locator('.preview')).toHaveText(text);
      await audit(page);
      await row.locator('.preview').scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`${format}.png`) });
    }
    expect(errors).toEqual([]);
  });
}
