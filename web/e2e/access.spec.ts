import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const base = 'http://127.0.0.1:18773';
const password = 'local-access-fixture';
const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
let server: ChildProcess;

test.beforeAll(async () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('SANI_')) delete env[key];
  server = spawn('../bin/sani', [], {
    env: { ...env, SANI_DATA_DIR: mkdtempSync(join(tmpdir(), 'sani-access-e2e-')), SANI_LISTEN: '127.0.0.1:18773', SANI_FILES_URL: 'http://localhost:18773', SANI_PASSWORD: password, SANI_FETCH_META: 'false', SANI_LOG_LEVEL: 'error' },
    stdio: 'ignore',
  });
  await expect.poll(async () => { try { return (await fetch(`${base}/healthz`)).status; } catch { return 0; } }).toBe(200);
});
test.afterAll(async () => {
  if (server?.exitCode === null) await new Promise<void>(resolve => { server.once('exit', () => resolve()); server.kill('SIGTERM'); });
});

async function login(page: Page, lang = 'en', theme = 'light') {
  await page.addInitScript(({ lang, theme }) => { localStorage.setItem('sani.lang', lang); localStorage.setItem('sani.theme', theme); }, { lang, theme });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  expect((await page.request.post(`${base}/api/admin/v1/session`, { data: { password } })).ok()).toBe(true);
}

async function audit(page: Page) {
  // Popovers fade in; measure contrast once they have arrived.
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'));
  await page.evaluate(axe);
  expect(await page.evaluate(async () => (await (window as any).axe.run(document, { resultTypes: ['violations'] })).violations.map((v: any) => ({ id: v.id, nodes: v.nodes.map((n: any) => n.target) })))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('a text shared with a generated password: popover, clipboard, list, detail and editor', async ({ page }) => {
  await login(page);
  await page.goto(`${base}/admin/`);
  await page.getByRole('tab', { name: 'Text', exact: true }).click();
  const panel = page.locator('#create-panel-text');
  await panel.getByLabel('Text to share').fill('Deploy notes');

  const trigger = panel.locator('button[aria-haspopup="dialog"]').nth(1);
  await expect(trigger).toHaveText('No password');
  await trigger.click();
  const pop = page.getByRole('dialog', { name: 'Access password' });
  const field = pop.getByLabel('Access password');
  await expect(field).toBeFocused();
  const generated = await field.inputValue();
  expect(generated).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
  await audit(page);
  await pop.getByRole('button', { name: 'Generate a new password' }).click();
  await field.fill('ab');
  await field.press('Enter');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(pop.locator('.error-text')).toHaveText('Use 4 to 64 characters.');
  await field.fill('blue-otter');
  await field.press('Enter');
  await expect(pop).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveText('blue-otter');
  // Enter in the popover must not have submitted the composer.
  await expect(panel.getByLabel('Text to share')).toHaveValue('Deploy notes');

  const created = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/admin/v1/texts'));
  await panel.getByLabel('Text to share').press('Control+Enter');
  const link = await (await created).json();
  expect(link.password).toBe('blue-otter');
  await expect(page.locator('.toast').first()).toContainText('Link and password copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${link.shortUrl}\nPassword: blue-otter`);

  const row = page.locator(`[data-link="${link.id}"]`);
  await expect(row.getByRole('img', { name: 'Password protected' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Copy link and password' })).toBeVisible();
  await row.locator('button.main').click();
  const value = row.locator('.meta .password .code');
  await expect(value).toHaveText('••••••');
  await row.getByRole('button', { name: 'Show password' }).click();
  await expect(value).toHaveText('blue-otter');
  await expect(row.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
  await audit(page);

  await row.locator('button.main').press('e');
  const editor = row.locator('form.editor');
  await expect(editor.getByLabel('Access password')).toHaveValue('blue-otter');
  await editor.getByLabel('Access password').fill('');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(row.getByRole('img', { name: 'Password protected' })).toHaveCount(0);
  expect((await (await page.request.get(`${base}/api/admin/v1/links/${link.id}`)).json()).password).toBeNull();
});

test('the visit limit popover validates before anything is sent', async ({ page }) => {
  await login(page, 'zh');
  await page.goto(`${base}/admin/`);
  const panel = page.locator('#create-panel-url');
  const trigger = panel.locator('button[aria-haspopup="dialog"]').first();
  await expect(trigger).toHaveText('不限次数');
  await trigger.click();
  const field = page.getByRole('dialog', { name: '访问上限' }).getByLabel('访问上限');
  await field.fill('0');
  await field.press('Enter');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await field.fill('12');
  await field.press('Enter');
  await expect(trigger).toHaveText('12 次');
});

for (const [lang, theme] of [['zh', 'light'], ['en', 'dark']] as const) {
  test(`visitors unlock a protected share and a protected redirect (${lang}/${theme})`, async ({ browser, page }) => {
    await login(page);
    const text = await (await page.request.post(`${base}/api/admin/v1/texts`, { data: { text: 'Visible after unlock', password: '7KQ2MX' } })).json();
    const url = await (await page.request.post(`${base}/api/admin/v1/links`, { data: { url: 'https://example.com/after-unlock', password: 'H3KP9W' } })).json();

    const visitor = await browser.newContext({ locale: lang === 'zh' ? 'zh-CN' : 'en-US', colorScheme: theme });
    try {
      const v = await visitor.newPage();
      await v.goto(text.shortUrl);
      await expect(v.locator('#password')).toBeFocused();
      await expect(v.locator('body')).not.toContainText('Visible after unlock');
      await audit(v);
      await v.locator('#password').fill('nope');
      await v.locator('#password').press('Enter');
      await expect(v.locator('#error')).toHaveText(lang === 'zh' ? '密码不正确' : 'Incorrect password');
      await expect(v.locator('#password')).toHaveAttribute('aria-invalid', 'true');
      await audit(v);
      await v.locator('#password').fill('7kq2mx');
      await v.locator('#password').press('Enter');
      await expect(v.locator('#text')).toContainText('Visible after unlock');
      const raw = await v.getByRole('link', { name: lang === 'zh' ? '原始文本' : 'Raw' }).getAttribute('href');
      expect(raw).toContain('?t=');
      expect(await (await visitor.request.get(raw!)).text()).toBe('Visible after unlock');
      expect((await visitor.request.get(raw!.split('?')[0])).status()).toBe(403);
      await audit(v);

      await v.route('https://example.com/**', route => route.fulfill({ body: 'destination' }));
      await v.goto(url.shortUrl);
      await v.locator('#password').fill('H3KP9W');
      await v.locator('#password').press('Enter');
      await expect(v).toHaveURL('https://example.com/after-unlock');
    } finally {
      await visitor.close();
    }
  });
}
