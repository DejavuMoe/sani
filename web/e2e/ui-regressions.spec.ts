import { expect, test, type Locator, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = 'http://127.0.0.1:18771';
const password = 'local-ui-regressions';
const hour = 3_600_000;
const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
let server: ChildProcess;
let serverLog = '';

test.beforeAll(async () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('SANI_')) delete env[key];
  server = spawn('../bin/sani', [], {
    env: { ...env, SANI_DATA_DIR: mkdtempSync(join(tmpdir(), 'sani-ui-regressions-')),
      SANI_LISTEN: '127.0.0.1:18771', SANI_FILES_URL: 'http://localhost:18771',
      SANI_PASSWORD: password, SANI_FETCH_META: 'false', SANI_LOG_LEVEL: 'info' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  serverLog = '';
  server.stderr!.on('data', chunk => { serverLog = (serverLog + chunk.toString()).slice(-8192); });
  await new Promise<void>((resolve, reject) => {
    let checking = false;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      server.off('exit', exited);
      server.off('error', errored);
      server.stderr!.off('data', ready);
      if (error) reject(new Error(`${error.message}\n${serverLog}`));
      else resolve();
    };
    const exited = (code: number | null, signal: NodeJS.Signals | null) => finish(new Error(`UI fixture exited: ${code ?? signal}`));
    const errored = (error: Error) => finish(error);
    const ready = () => {
      if (checking || !serverLog.includes('sani is ready')) return;
      checking = true;
      // The child emits this only after binding; another process's health is insufficient.
      void fetch(`${base}/healthz`, { signal: AbortSignal.timeout(2000) }).then(response => {
        if (!response.ok || server.exitCode !== null || server.signalCode !== null) {
          finish(new Error(`UI fixture health failed: ${response.status}`));
        } else finish();
      }, errored);
    };
    const timer = setTimeout(() => finish(new Error('UI fixture startup timed out')), 10_000);
    server.once('exit', exited);
    server.once('error', errored);
    server.stderr!.on('data', ready);
  });
});

test.afterAll(async () => {
  if (!server?.pid || server.exitCode !== null || server.signalCode !== null) return;
  const stop = (signal: NodeJS.Signals, timeout: number) => new Promise<boolean>(resolve => {
    if (server.exitCode !== null || server.signalCode !== null) { resolve(true); return; }
    const exited = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => { server.off('exit', exited); resolve(false); }, timeout);
    server.once('exit', exited);
    server.kill(signal);
  });
  if (!await stop('SIGTERM', 5000) && !await stop('SIGKILL', 2000)) throw new Error(`UI fixture did not exit\n${serverLog}`);
});

async function login(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('sani.lang', 'en');
    localStorage.setItem('sani.theme', 'light');
  });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  expect((await page.request.post(`${base}/api/admin/v1/session`, { data: { password } })).ok()).toBe(true);
  await page.goto(`${base}/admin/`);
  await expect(page.locator('#composer-url')).toBeVisible();
}

async function captureReauth(page: Page, stage: string) {
  const name = `${test.info().title.replace(/[^a-zA-Z0-9-]+/g, '-').slice(0, 120)}-${stage}.png`;
  const path = test.info().outputPath(name);
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  if (process.env.SANI_QA_DIR) {
    mkdirSync(process.env.SANI_QA_DIR, { recursive: true });
    copyFileSync(path, join(process.env.SANI_QA_DIR, name));
  }
}

async function expiry(page: Page, form: Locator) {
  await form.getByRole('button', { name: 'Expires', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '1 hour', exact: true }).click();
}

async function fileDraft(page: Page, size = 16) {
  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  const panel = page.locator('#create-panel-file');
  await panel.locator('input[type=file]').setInputFiles({
    name: 'ui-retry.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(size, 37),
  });
  await expiry(page, panel);
  return panel;
}

for (const delay of [10 * 60_000, 70 * 60_000]) {
  test(`BUG-13 multipart retry resolves expiry at the new attempt after ${delay / 60_000} minutes`, async ({ page }) => {
    // Only the browser's Date changes; the server accepts these future deadlines.
    const first = Date.now() + 24 * hour;
    await page.clock.setFixedTime(first);
    await login(page);
    const panel = await fileDraft(page);
    const deadlines: string[] = [];
    await page.route('**/api/admin/v1/files', route => {
      const body = route.request().postDataBuffer()!.toString();
      deadlines.push(body.match(/name="expiresAt"\r\n\r\n([^\r]+)/)![1]);
      return deadlines.length === 1 ? route.abort('failed') : route.continue();
    });
    await panel.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Retry upload' })).toBeVisible();
    await page.clock.setFixedTime(first + delay);
    const completed = page.waitForResponse(r => r.url().endsWith('/api/admin/v1/files'));
    await panel.getByRole('button', { name: 'Retry upload' }).click();
    const response = await completed;
    expect(response.ok()).toBe(true);
    expect(deadlines).toEqual([new Date(first + hour).toISOString(), new Date(first + delay + hour).toISOString()]);
    expect(Date.parse((await response.json()).expiresAt)).toBe(first + delay + hour);
  });
}

test('BUG-13 failed upload initialization starts with a fresh relative expiry', async ({ page }) => {
  const first = Date.now() + 24 * hour;
  await page.clock.setFixedTime(first);
  await login(page);
  const panel = await fileDraft(page, 25_000_001);
  const deadlines: string[] = [];
  await page.route('**/api/admin/v1/uploads', route => {
    deadlines.push(route.request().postDataJSON().expiresAt);
    return route.abort('failed');
  });
  await panel.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Retry upload' })).toBeVisible();
  await page.clock.setFixedTime(first + 10 * 60_000);
  await panel.getByRole('button', { name: 'Retry upload' }).click();
  await expect.poll(() => deadlines.length).toBe(2);
  expect(deadlines).toEqual([new Date(first + hour).toISOString(), new Date(first + 70 * 60_000).toISOString()]);
});

test('BUG-13 continuing a chunk session keeps its deadline and confirmed bytes', async ({ page }) => {
  test.setTimeout(60_000);
  const first = Date.now() + 24 * hour;
  await page.clock.setFixedTime(first);
  await login(page);
  const panel = await fileDraft(page, 25_000_001);
  const sessions: string[] = [];
  const chunks: { path: string; offset: number }[] = [];
  page.on('request', r => {
    if (r.url().endsWith('/api/admin/v1/uploads') && r.method() === 'POST') sessions.push(r.postDataJSON().expiresAt);
  });
  let failed = false;
  await page.route('**/api/admin/v1/uploads/*', route => {
    const request = route.request();
    if (request.method() !== 'PUT') return route.continue();
    const offset = Number(request.headers()['upload-offset']);
    chunks.push({ path: request.url(), offset });
    if (offset === 25_000_000 && !failed) { failed = true; return route.abort('failed'); }
    return route.continue();
  });
  await panel.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Retry upload' })).toBeVisible();
  await page.clock.setFixedTime(first + 10 * 60_000);
  const completed = page.waitForResponse(r => r.url().endsWith('/complete'));
  await panel.getByRole('button', { name: 'Retry upload' }).click();
  const response = await completed;
  expect(response.ok()).toBe(true);
  expect(sessions).toEqual([new Date(first + hour).toISOString()]);
  expect(chunks.map(c => c.offset)).toEqual([0, 25_000_000, 25_000_000]);
  expect(new Set(chunks.map(c => c.path)).size).toBe(1);
  expect(Date.parse((await response.json()).expiresAt)).toBe(first + hour);
});

for (const leaveDialog of [false, true]) {
  test(`BUG-14 reauthentication preserves editor and all composer drafts${leaveDialog ? ' with a leave dialog open' : ''}`, async ({ page, browser }) => {
    await login(page);
    const created = await page.request.post(`${base}/api/admin/v1/texts`, { data: { text: 'Saved body', title: 'Reauth fixture' } });
    expect(created.ok()).toBe(true);
    const link = await created.json();
    await page.reload();
    const url = page.locator('#create-panel-url');
    await url.getByLabel('URL', { exact: true }).fill('https://example.com/unsaved-url');
    await url.getByRole('button', { name: 'More options', exact: true }).click();
    await url.getByLabel('Title', { exact: true }).fill('Unsaved URL title');
    await url.getByLabel('Visit limit').fill('17');
    await expiry(page, url);
    await page.getByRole('tab', { name: 'Text', exact: true }).click();
    const text = page.locator('#create-panel-text');
    await text.getByLabel('Text to share').fill('Unsaved composer text');
    await text.getByRole('radio', { name: 'Code', exact: true }).click();
    const file = await fileDraft(page);
    await file.getByRole('button', { name: 'More options', exact: true }).click();
    await file.getByLabel('Title', { exact: true }).fill('Unsaved file title');
    await file.getByLabel('Visit limit').fill('19');
    const row = page.locator(`[data-link="${link.id}"]`);
    await row.locator('button.main').click();
    await row.locator('button.main').press('e');
    const editor = row.locator('form.editor');
    await expect(editor.locator('textarea')).toBeEnabled();
    await editor.locator('textarea').fill('Unsaved editor body');
    await editor.getByLabel('Title', { exact: true }).fill('Unsaved editor title');
    await editor.getByLabel('Visit limit').fill('23');
    if (leaveDialog) {
      await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Save changes before leaving?' })).toBeVisible();
    }

    // A genuinely different cookie jar revokes A; background refresh detects it.
    const other = await browser.newContext();
    try {
      expect((await other.request.post(`${base}/api/admin/v1/session`, { data: { password } })).ok()).toBe(true);
      expect((await other.request.post(`${base}/api/admin/v1/sessions/revoke`)).ok()).toBe(true);
      const unauthorized = page.waitForResponse(r => r.url().includes('/api/admin/v1/') && r.status() === 401);
      await page.clock.setFixedTime(Date.now() + 60_000);
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      expect((await (await unauthorized).json()).error.code).toBe('unauthorized');
      await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('tablist')).toHaveCount(0);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByLabel('Password', { exact: true }).press('Tab');
      await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeFocused();
      const writes: string[] = [];
      page.on('request', request => {
        if (request.url().includes('/api/admin/v1/') && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method()) && !request.url().endsWith('/session')) writes.push(request.url());
      });
      await page.evaluate(() => navigator.clipboard.writeText('reauth clipboard sentinel'));
      for (const key of ['c', 'Delete', 'x', 'e', 'n', '?', 'Escape']) await page.keyboard.press(key);
      await page.evaluate(() => {
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', 'https://example.com/unauthed-paste');
        document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true }));
      });
      expect(writes).toEqual([]);
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('reauth clipboard sentinel');
      expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('Unsaved');
      await page.evaluate(axe);
      expect(await page.evaluate(async () => (await (window as any).axe.run(document, { resultTypes: ['violations'] })).violations.map((v: any) => v.id))).toEqual([]);
      await captureReauth(page, 'login');
      await page.getByLabel('Password', { exact: true }).fill('wrong-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.locator('#login-error')).toBeVisible();
      await expect(page.getByRole('tablist')).toHaveCount(0);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
      const leave = page.getByRole('dialog', { name: 'Save changes before leaving?' });
      if (await leave.isVisible()) await leave.getByRole('button', { name: 'Keep editing', exact: true }).click();
      await expect(editor.locator('textarea')).toHaveValue('Unsaved editor body');
      await expect(editor.getByLabel('Title', { exact: true })).toHaveValue('Unsaved editor title');
      await expect(editor.getByLabel('Visit limit')).toHaveValue('23');
      await expect(file.locator('.fname')).toHaveText('ui-retry.bin');
      await expect(file.getByLabel('Title', { exact: true })).toHaveValue('Unsaved file title');
      await expect(file.getByLabel('Visit limit')).toHaveValue('19');
      await expect(file.getByRole('button', { name: 'Expires', exact: true })).toContainText('1 hour');
      await page.getByRole('tab', { name: 'Text', exact: true }).click();
      await expect(text.getByLabel('Text to share')).toHaveValue('Unsaved composer text');
      await expect(text.getByRole('radio', { name: 'Code', exact: true })).toHaveAttribute('aria-checked', 'true');
      await page.getByRole('tab', { name: 'Links', exact: true }).click();
      await expect(url.getByLabel('URL', { exact: true })).toHaveValue('https://example.com/unsaved-url');
      await expect(url.getByLabel('Title', { exact: true })).toHaveValue('Unsaved URL title');
      await expect(url.getByLabel('Visit limit')).toHaveValue('17');
      await expect(url.getByRole('button', { name: 'Expires', exact: true })).toContainText('1 hour');
      expect((await (await other.request.get(`${base}/api/admin/v1/links/${link.id}/text`)).json()).text).toBe('Saved body');
      expect(writes).toEqual([]);
      await captureReauth(page, 'restored');
      await editor.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(editor).toHaveCount(0);
      expect((await (await page.request.get(`${base}/api/admin/v1/links/${link.id}/text`)).json()).text).toBe('Unsaved editor body');
    } finally { await other.close(); }
  });
}

test('BUG-14 bookmarklet reauthentication retains the /new route and edited prefilled draft', async ({ page, browser }) => {
  await login(page);
  const route = `${base}/admin/new?url=${encodeURIComponent('https://example.com/prefilled')}`;
  await page.goto(route);
  await expect(page.locator('#composer-url')).toHaveValue('https://example.com/prefilled');
  await page.locator('#composer-url').fill('https://example.com/unsaved-bookmarklet');
  await page.getByRole('button', { name: 'More options', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Unsaved bookmarklet title');
  await page.getByLabel('Visit limit').fill('29');
  const other = await browser.newContext();
  try {
    expect((await other.request.post(`${base}/api/admin/v1/session`, { data: { password } })).ok()).toBe(true);
    expect((await other.request.post(`${base}/api/admin/v1/sessions/revoke`)).ok()).toBe(true);
    const unauthorized = page.waitForResponse(r => r.url().endsWith('/api/admin/v1/links') && r.status() === 401);
    await page.locator('button.go').click();
    await unauthorized;
    await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
    await captureReauth(page, 'login');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(route);
    await expect(page.locator('#composer-url')).toHaveValue('https://example.com/unsaved-bookmarklet');
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Unsaved bookmarklet title');
    await expect(page.getByLabel('Visit limit')).toHaveValue('29');
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await captureReauth(page, 'restored');
  } finally { await other.close(); }
});

for (const modal of ['shortcuts', 'tags']) {
  test(`BUG-14 reauthentication suspends and restores the ${modal} modal`, async ({ page, browser }) => {
    await login(page);
    if (modal === 'tags') {
      expect((await page.request.post(`${base}/api/admin/v1/tags`, { data: { name: 'Reauth tag' } })).ok()).toBe(true);
      await page.reload();
      await page.locator('#create-panel-url .tag-add').click();
      await page.locator('.tag-pop:popover-open').getByRole('button', { name: 'Manage tags', exact: true }).click();
      await page.getByRole('dialog', { name: 'Manage tags', exact: true }).getByRole('button', { name: 'Edit tag Reauth tag', exact: true }).click();
      await page.getByRole('dialog', { name: 'Edit tag', exact: true }).getByLabel('Name', { exact: true }).fill('Unsaved tag name');
    } else {
      await page.getByRole('button', { name: 'Shortcuts', exact: true }).click();
    }
    const other = await browser.newContext();
    try {
      expect((await other.request.post(`${base}/api/admin/v1/session`, { data: { password } })).ok()).toBe(true);
      expect((await other.request.post(`${base}/api/admin/v1/sessions/revoke`)).ok()).toBe(true);
      const unauthorized = page.waitForResponse(r => r.url().includes('/api/admin/v1/') && r.status() === 401);
      await page.clock.setFixedTime(Date.now() + 60_000);
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await unauthorized;
      await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('main')).toHaveCount(1);
      await captureReauth(page, 'login');
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByLabel('Password', { exact: true }).press('Tab');
      await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeFocused();
      await page.getByRole('button', { name: 'Sign in', exact: true }).press('Enter');
      if (modal === 'tags') {
        const edit = page.getByRole('dialog', { name: 'Edit tag', exact: true });
        await expect(edit).toBeVisible();
        await expect(edit.getByLabel('Name', { exact: true })).toHaveValue('Unsaved tag name');
        await captureReauth(page, 'restored');
        await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Manage tags', exact: true })).toBeVisible();
      } else {
        await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true })).toBeVisible();
        await captureReauth(page, 'restored');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
      }
    } finally { await other.close(); }
  });
}

test('BUG-14 deliberate sign-out still clears in-memory composer drafts', async ({ page }) => {
  await login(page);
  await page.locator('#composer-url').fill('https://example.com/discard-on-signout');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(page.locator('#composer-url')).toHaveValue('');
});

for (const kind of ['url', 'text', 'file', 'chunked file'] as const) {
  const mode = kind === 'chunked file' ? 'file' : kind;
  test(`BUG-21 ${kind} creation rejects overflowing and out-of-range limits before any request`, async ({ page }) => {
    await login(page);
    await page.getByRole('tab', { name: { url: 'Links', text: 'Text', file: 'Files' }[mode], exact: true }).click();
    const panel = page.locator(`#create-panel-${mode}`);
    if (mode === 'url') await panel.getByLabel('URL', { exact: true }).fill('https://example.com/valid-limit');
    else if (mode === 'text') await panel.getByLabel('Text to share').fill('Visit limit fixture');
    else await panel.locator('input[type=file]').setInputFiles({ name: 'limit.txt', mimeType: 'text/plain', buffer: kind === 'chunked file' ? Buffer.alloc(25_000_001, 37) : Buffer.from('limit fixture') });
    await panel.getByRole('button', { name: 'More options', exact: true }).click();
    const writes: string[] = [];
    await page.route('**/api/admin/v1/**', route => {
      if (route.request().method() === 'POST') {
        writes.push(route.request().url());
        return route.fulfill({ status: 400, json: { error: { code: 'max_clicks_invalid', message: 'invalid limit' } } });
      }
      return route.continue();
    });
    for (const value of ['9'.repeat(309), '1000000000001', '9007199254740993', '0', '-1', '1.5']) {
      await panel.getByLabel('Visit limit').fill(value);
      await panel.locator('button.go').click();
      await expect(panel.getByLabel('Visit limit')).toHaveAttribute('aria-invalid', 'true');
      await expect(panel.getByLabel('Visit limit')).toBeEnabled();
      expect(writes, `nonempty invalid limit ${value} must not leave the browser`).toEqual([]);
    }
    await page.unroute('**/api/admin/v1/**');
    // The form validator is shared by both upload transports; boundary/blank
    // persistence uses the smaller fixture after covering chunk initialization.
    if (kind === 'chunked file') await panel.locator('input[type=file]').setInputFiles({ name: 'limit.txt', mimeType: 'text/plain', buffer: Buffer.from('limit fixture') });
    for (const value of ['1000000000000', '']) {
      await panel.getByLabel('Visit limit').fill(value);
      const saved = page.waitForResponse(r => r.request().method() === 'POST' && /\/api\/admin\/v1\/(links|texts|files)$/.test(r.url()));
      await panel.locator('button.go').click();
      const response = await saved;
      expect(response.ok()).toBe(true);
      expect((await response.json()).maxClicks).toBe(value ? 1_000_000_000_000 : null);
      await expect(panel.getByLabel('Visit limit')).toHaveValue('');
      await expect(panel.locator('button.go')).toBeEnabled();
      if (value) {
        if (mode === 'url') await panel.getByLabel('URL', { exact: true }).fill('https://example.com/blank-limit');
        else if (mode === 'text') await panel.getByLabel('Text to share').fill('Blank limit fixture');
        else await panel.locator('input[type=file]').setInputFiles({ name: 'blank.txt', mimeType: 'text/plain', buffer: Buffer.from('blank fixture') });
      }
    }
  });
}

test('BUG-21 editing rejects nonempty invalid limits and only blank deliberately clears the saved limit', async ({ page }) => {
  await login(page);
  const created = await page.request.post(`${base}/api/admin/v1/links`, { data: { url: 'https://example.com/edit-limit', maxClicks: 5 } });
  expect(created.ok()).toBe(true);
  const link = await created.json();
  await page.reload();
  const row = page.locator(`[data-link="${link.id}"]`);
  await row.locator('button.main').click();
  await row.locator('button.main').press('e');
  const editor = row.locator('form.editor');
  const patches: unknown[] = [];
  page.on('request', r => { if (r.method() === 'PATCH' && r.url().endsWith(`/links/${link.id}`)) patches.push(r.postDataJSON()); });
  for (const value of ['9'.repeat(309), '1000000000001', '9007199254740993']) {
    await editor.getByLabel('Visit limit').fill(value);
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor.getByLabel('Visit limit')).toHaveAttribute('aria-invalid', 'true');
    expect(patches).toEqual([]);
    expect((await (await page.request.get(`${base}/api/admin/v1/links/${link.id}`)).json()).maxClicks).toBe(5);
  }
  await editor.getByLabel('Visit limit').fill('');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(patches).toEqual([{ maxClicks: null }]);
  expect((await (await page.request.get(`${base}/api/admin/v1/links/${link.id}`)).json()).maxClicks).toBeNull();
});

test('UI-R2 unchanged imported limit permits a title save but newly entered invalid limits are rejected', async ({ page }) => {
  await login(page);
  const limit = 1_000_000_000_001;
  await page.goto(`${base}/admin/settings`);
  const importing = page.waitForResponse(r => r.url().endsWith('/api/admin/v1/import') && r.request().method() === 'POST');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'imported-limit.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'sani', version: 1, links: [
      { slug: 'ui-import-limit', url: 'https://example.com/import-limit', title: 'Imported title', maxClicks: limit },
    ] })),
  });
  const imported = await importing;
  expect(imported.ok(), await imported.text()).toBe(true);
  expect(await imported.json()).toMatchObject({ created: 1, skipped: [] });
  const results = await (await page.request.get(`${base}/api/admin/v1/links?q=ui-import-limit`)).json();
  expect(results.items).toHaveLength(1);
  const link = results.items[0];
  expect(link.maxClicks).toBe(limit);
  await page.goto(`${base}/admin/`);
  const row = page.locator(`[data-link="${link.id}"]`);
  await row.locator('button.main').click();
  await row.locator('button.main').press('e');
  const editor = row.locator('form.editor');
  await expect(editor.getByLabel('Visit limit')).toHaveValue(String(limit));
  const patches: unknown[] = [];
  page.on('request', r => { if (r.method() === 'PATCH' && r.url().endsWith(`/links/${link.id}`)) patches.push(r.postDataJSON()); });
  await editor.getByLabel('Title', { exact: true }).fill('Edited import title');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(patches).toEqual([{ title: 'Edited import title' }]);
  expect(await (await page.request.get(`${base}/api/admin/v1/links/${link.id}`)).json()).toMatchObject({ title: 'Edited import title', maxClicks: limit });
  await row.locator('button.main').press('e');
  await editor.getByLabel('Visit limit').fill('1000000000002');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor.getByLabel('Visit limit')).toHaveAttribute('aria-invalid', 'true');
  expect(patches).toHaveLength(1);
  expect((await (await page.request.get(`${base}/api/admin/v1/links/${link.id}`)).json()).maxClicks).toBe(limit);
});

test('UI-R4 reauthentication retries an initially unauthorized editor body once without losing other draft fields', async ({ page, browser }) => {
  await login(page);
  const created = await page.request.post(`${base}/api/admin/v1/texts`, { data: { text: 'Initial saved body', title: 'Initial title' } });
  expect(created.ok()).toBe(true);
  const link = await created.json();
  await page.reload();
  const row = page.locator(`[data-link="${link.id}"]`);
  await row.locator('button.main').click();
  await expect(row.locator('.preview')).toHaveText('Initial saved body');
  const other = await browser.newContext();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let captured!: (status: number) => void;
  const capturedStatus = new Promise<number>(resolve => { captured = resolve; });
  const path = `**/api/admin/v1/links/${link.id}/text`;
  let reads = 0;
  await page.route(path, async route => {
    reads++;
    if (reads !== 1) return route.continue();
    const response = await route.fetch();
    captured(response.status());
    await held;
    await route.fulfill({ response });
  });
  try {
    expect((await other.request.post(`${base}/api/admin/v1/session`, { data: { password } })).ok()).toBe(true);
    expect((await other.request.post(`${base}/api/admin/v1/sessions/revoke`)).ok()).toBe(true);
    await row.locator('button.main').press('e');
    expect(await capturedStatus).toBe(401);
    const editor = row.locator('form.editor');
    await expect(editor.locator('textarea')).toBeDisabled();
    await editor.getByLabel('Title', { exact: true }).fill('Title drafted before the 401');
    const unauthorized = page.waitForResponse(r => r.url().endsWith(`/links/${link.id}/text`) && r.status() === 401);
    release();
    await unauthorized;
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
    await expect(editor.locator('textarea')).toBeEnabled();
    await expect(editor.locator('textarea')).toHaveValue('Initial saved body');
    await expect(editor.getByLabel('Title', { exact: true })).toHaveValue('Title drafted before the 401');
    expect(reads).toBe(2);
    await editor.locator('textarea').fill('Body drafted after recovery');
    await editor.getByLabel('Title', { exact: true }).fill('Title kept after recovery');
    await editor.getByLabel('Visit limit').fill('31');
    expect(reads).toBe(2);
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect((await (await page.request.get(`${base}/api/admin/v1/links/${link.id}/text`)).json()).text).toBe('Body drafted after recovery');
    expect(await (await page.request.get(`${base}/api/admin/v1/links/${link.id}`)).json()).toMatchObject({ title: 'Title kept after recovery', maxClicks: 31 });
  } finally {
    release();
    await page.unroute(path);
    await other.close();
  }
});
