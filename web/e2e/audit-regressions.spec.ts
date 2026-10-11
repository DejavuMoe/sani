import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Link, LinkInput } from '../src/lib/api';

// Independent of app.spec.ts setup order, including focused --grep runs.
const base = 'http://127.0.0.1:18770';
const PASSWORD = 'correct horse battery';
let server: ChildProcess;
let dataDir: string;
let childStopped: Promise<void>;
let childLog = '';

test.beforeAll(async () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('SANI_')) delete env[key];
  dataDir = mkdtempSync(join(tmpdir(), 'sani-audit-e2e-'));
  childLog = '';
  server = spawn('../bin/sani', [], {
    env: { ...env, SANI_DATA_DIR: dataDir, SANI_LISTEN: '127.0.0.1:18770',
      SANI_FILES_URL: 'http://localhost:18770', SANI_PASSWORD: PASSWORD,
      SANI_FETCH_META: 'false', SANI_LOG_LEVEL: 'info', SANI_LOG_FORMAT: 'json' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let spawnError: Error | undefined;
  server.on('error', error => { spawnError = error; });
  childStopped = new Promise<void>(done => { server.once('exit', () => done()); });
  let ready = false;
  server.stderr!.setEncoding('utf8');
  server.stderr!.on('data', (chunk: string) => {
    childLog = (childLog + chunk).slice(-8192);
    ready ||= childLog.split('\n').some(line => line.includes('"msg":"sani is ready"')
      && line.includes('"addr":"127.0.0.1:18770"') && line.includes(`"data":${JSON.stringify(dataDir)}`));
  });
  try {
    await expect.poll(async () => {
      if (spawnError) throw spawnError;
      if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Child exited before readiness: ${server.exitCode ?? server.signalCode}`);
      // A different process answering this port cannot establish ownership.
      if (!ready) return 0;
      let status = 0;
      try { status = (await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1000) })).status; } catch { /* poll until deadline */ }
      if (spawnError) throw spawnError;
      if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Child exited during health check: ${server.exitCode ?? server.signalCode}`);
      return status;
    }, { timeout: 10_000 }).toBe(200);
  } catch (error) {
    throw new Error(`Audit child startup failed: ${String(error)}\n${childLog}`);
  }
});

test.afterAll(async () => {
  if (!server?.pid || server.exitCode !== null || server.signalCode !== null) return;
  if (!server.kill('SIGTERM')) throw new Error(`Could not terminate owned audit child ${server.pid}\n${childLog}`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([childStopped, new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const sent = server.kill('SIGKILL');
        reject(new Error(`Owned audit child ${server.pid} did not exit within 12 seconds; SIGKILL sent: ${sent}\n${childLog}`));
      }, 12_000);
    })]);
  } finally {
    clearTimeout(timer);
  }
});

test.afterEach(async ({ page }, info) => {
  if (!process.env.SANI_QA_DIR) return;
  const dir = process.env.SANI_QA_DIR;
  const fromRepo = relative(resolve('..'), dir);
  expect(isAbsolute(dir) && (isAbsolute(fromRepo) || fromRepo === '..' || fromRepo.startsWith(`..${sep}`)), 'SANI_QA_DIR must be absolute and outside the repository').toBe(true);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${info.title.replace(/[^a-zA-Z0-9-]/g, '-')}.png`), fullPage: true });
});

const profiles = [
  { lang: 'en', theme: 'light', width: 1280 },
  { lang: 'zh', theme: 'dark', width: 1280 },
  { lang: 'en', theme: 'dark', width: 390 },
  { lang: 'zh', theme: 'light', width: 390 },
] as const;

async function login(page: Page, profile: (typeof profiles)[number] = profiles[0]) {
  await page.setViewportSize({ width: profile.width, height: 900 });
  await page.emulateMedia({ colorScheme: profile.theme });
  await page.addInitScript(({ lang, theme }) => {
    localStorage.setItem('sani.lang', lang);
    localStorage.setItem('sani.theme', theme);
  }, profile);
  expect((await page.request.post(`${base}/api/admin/v1/session`, { data: { password: PASSWORD } })).ok()).toBe(true);
}

async function create(page: Page, input: LinkInput): Promise<Link> {
  const response = await page.request.post(`${base}/api/admin/v1/${input.text === undefined ? 'links' : 'texts'}`, { data: input });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

async function search(page: Page, query: string) {
  const loaded = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/admin/v1/links' && url.searchParams.get('q') === query && response.request().method() === 'GET';
  });
  await page.locator('.toolbar input[type=search]').fill(query);
  expect((await loaded).ok()).toBe(true);
  await expect(page.locator('.card[aria-busy=true]')).toHaveCount(0);
}

async function openDetails(page: Page, id: number) {
  const row = page.locator(`[data-link="${id}"]`);
  const trigger = row.locator('button.main');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(row.locator('.detail')).toBeVisible();
  await trigger.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(row.locator('.detail')).toHaveCount(0);
  await trigger.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(row.locator('.detail')).toBeVisible();
  await expect(row.locator('.chart-placeholder')).toHaveCount(0);
  return row;
}

for (const profile of profiles) {
  const name = `${profile.lang}/${profile.theme}/${profile.width}`;
  test.describe(() => {
  test.use({ locale: profile.lang === 'zh' ? 'zh-CN' : 'en-US' });
  test(`BUG-01 canceled selection keeps the dirty text draft guarded on Delete ${name}`, async ({ page }) => {
    await login(page, profile);
    const link = await create(page, { text: 'Saved text before editing', title: `Draft ${name}` });
    await page.goto(`${base}/admin/`);
    const row = await openDetails(page, link.id);
    await row.getByRole('button', { name: profile.lang === 'zh' ? /^编辑/ : /^Edit/ }).click();
    const body = page.locator(`#edit-text-${link.id}`);
    await expect(body).toBeEnabled();
    await expect(body).toHaveValue('Saved text before editing');
    const draft = `Unsaved draft must survive ${name}\n第二行 <keep me>`;
    await body.fill(draft);
    const save = row.locator('.editor button[type=submit]');
    await save.focus();
    await expect(save).toBeFocused();
    await page.keyboard.press('x');
    const guard = page.getByRole('dialog', { name: profile.lang === 'zh' ? '保存修改后离开？' : 'Save changes before leaving?' });
    await expect(guard).toBeVisible();
    await expect(guard).toHaveCSS('opacity', '1');
    await guard.getByRole('button', { name: profile.lang === 'zh' ? '继续编辑' : 'Keep editing', exact: true }).click();
    await expect(guard).not.toBeVisible();
    await expect(body).toHaveValue(draft);
    await expect(page.locator('.bulkbar')).toHaveCount(0);
    await expect(row.getByRole('checkbox')).toHaveCount(0);

    const deletes: string[] = [];
    page.on('request', request => {
      if (request.method() === 'DELETE' || (request.url().endsWith('/links/bulk') && request.postDataJSON()?.action === 'delete')) deletes.push(request.url());
    });
    await save.focus();
    await expect(save).toBeFocused();
    await page.keyboard.press('Delete');
    // The baseline performs a real bulk deletion here and destroys this draft.
    await expect(guard).toBeVisible();
    expect(deletes).toEqual([]);
    await guard.getByRole('button', { name: profile.lang === 'zh' ? '继续编辑' : 'Keep editing', exact: true }).press('Enter');
    await expect(guard).not.toBeVisible();
    await expect(row).not.toHaveClass(/\bpicked\b/);
    await expect(body).toHaveValue(draft);
    expect((await (await page.request.get(`${base}/api/admin/v1/links/${link.id}/text`)).json()).text).toBe('Saved text before editing');
    const saved = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url() === `${base}/api/admin/v1/links/${link.id}`);
    await save.click();
    expect((await saved).ok()).toBe(true);
    await expect(row.locator('.editor')).toHaveCount(0);
    expect((await (await page.request.get(`${base}/api/admin/v1/links/${link.id}/text`)).json()).text).toBe(draft);
  });

  for (const clipboard of ['missing', 'reject'] as const) for (const legacyWorks of [true, false]) {
    test(`BUG-11 ${clipboard} clipboard with legacy ${legacyWorks ? 'success' : 'failure'} gives visible feedback ${name}`, async ({ page }) => {
      await login(page, profile);
      const text = 'Clipboard fixture\n中文 <plain text> & trailing newline\n';
      const link = await create(page, { text });
      await page.addInitScript(({ clipboard, legacyWorks }) => {
        const probe = { modernCalls: 0, legacyCalls: 0, selected: '', copied: 'unchanged sentinel' };
        Object.assign(window, { auditClipboard: probe });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard === 'missing' ? undefined : {
          writeText: async () => { probe.modernCalls++; throw new DOMException('Fixture permission denial', 'NotAllowedError'); },
        } });
        Object.defineProperty(document, 'execCommand', { configurable: true, value: (command: string) => {
          if (command !== 'copy') return false;
          probe.legacyCalls++;
          const active = document.activeElement;
          probe.selected = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement
            ? active.value.slice(active.selectionStart ?? 0, active.selectionEnd ?? 0) : getSelection()?.toString() ?? '';
          if (legacyWorks) probe.copied = probe.selected;
          return legacyWorks;
        } });
      }, { clipboard, legacyWorks });
      await page.goto(link.shortUrl);
      await expect(page.locator('html')).toHaveAttribute('lang', profile.lang === 'zh' ? 'zh-CN' : 'en');
      const copy = page.locator('[data-copy]');
      await expect(copy).toBeVisible();
      const original = await page.locator('main').innerText();
      const done = profile.lang === 'zh' ? '已复制' : 'Copied';
      if (profile.width === 390) await copy.press('Enter');
      else await copy.click();
      if (legacyWorks) {
        await expect(copy).toHaveText(done);
      } else {
        // Accept a localized button label or separate live instruction; never silent failure or false success.
        await expect(page.locator('main')).not.toHaveText(original, { useInnerText: true });
        await expect(copy).not.toHaveText(done);
        const feedback = (await page.locator('main').innerText()).replace(text.trim(), '');
        expect(feedback).toMatch(profile.lang === 'zh' ? /(?:无法|失败|手动|选择|选中)/ : /(?:could not|couldn.t|unable|failed|manually|select)/i);
      }
      const probe = await page.evaluate(() => (window as unknown as {
        auditClipboard: { modernCalls: number; legacyCalls: number; selected: string; copied: string };
      }).auditClipboard);
      expect(probe.modernCalls).toBe(clipboard === 'missing' ? 0 : 1);
      expect(probe.legacyCalls).toBe(1);
      expect(probe.selected).toBe(text);
      expect(probe.copied).toBe(legacyWorks ? text : 'unchanged sentinel');
      expect(await page.locator('#text').textContent()).toBe(text);
    });
  }
  });
}

for (const bareState of ['failed', 'different'] as const) {
  test(`BUG-19 www favicon uses exact host when bare-host cache is ${bareState}, including bare-host control`, async ({ page }) => {
    await login(page);
    const host = `${bareState}.example.invalid`;
    const needle = `IconFixture${bareState}`;
    const bare = await create(page, { url: `https://${host}/bare`, title: needle });
    const www = await create(page, { url: `https://www.${host}/path`, title: needle });
    const wwwBytes = readFileSync('public/icon-192.png');
    const bareBytes = readFileSync('public/icon-512.png');
    expect(wwwBytes.equals(bareBytes)).toBe(false);
    // There is no cache-write API: seed only this suite's disposable SQLite database.
    const db = new DatabaseSync(join(dataDir, 'sani.db'));
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      const put = db.prepare('INSERT OR REPLACE INTO favicons (host, type, data, fetched_at) VALUES (?, ?, ?, ?)');
      put.run(`www.${host}`, 'image/png', wwwBytes, Date.now());
      put.run(host, bareState === 'failed' ? '' : 'image/png', bareState === 'failed' ? Buffer.alloc(0) : bareBytes, Date.now());
    } finally { db.close(); }
    const dto = await (await page.request.get(`${base}/api/admin/v1/links/${www.id}`)).json();
    expect(dto).toMatchObject({ host, icon: true, url: www.url });
    const exact = await page.request.get(`${base}/api/admin/v1/favicons/www.${host}`);
    expect(exact.status()).toBe(200);
    expect(await exact.body()).toEqual(wwwBytes);
    const bareResponse = await page.request.get(`${base}/api/admin/v1/favicons/${host}`);
    expect(bareResponse.status()).toBe(bareState === 'failed' ? 404 : 200);
    if (bareState === 'different') expect(await bareResponse.body()).toEqual(bareBytes);

    const requested: string[] = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname.startsWith('/api/admin/v1/favicons/')) requested.push(new URL(request.url()).pathname);
    });
    await page.goto(`${base}/admin/`);
    await search(page, needle);
    const bareRow = page.locator(`[data-link="${bare.id}"]`);
    await bareRow.scrollIntoViewIfNeeded();
    if (bareState === 'different') {
      await expect(bareRow.locator('img.fav')).toHaveAttribute('src', `/api/admin/v1/favicons/${host}`);
      await expect.poll(() => bareRow.locator('img.fav').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(512);
    } else {
      await expect(bareRow.locator('img.fav')).toHaveCount(0);
      await expect(bareRow.locator('.letter')).toBeVisible();
    }
    const wwwRow = page.locator(`[data-link="${www.id}"]`);
    await wwwRow.scrollIntoViewIfNeeded();
    await expect.poll(() => requested).toContain(`/api/admin/v1/favicons/www.${host}`);
    await expect(wwwRow.locator('img.fav')).toHaveAttribute('src', `/api/admin/v1/favicons/www.${host}`);
    await expect.poll(() => wwwRow.locator('img.fav').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(192);
  });
}

for (const queryKind of ['slash', 'full-url'] as const) {
  test(`BUG-22 aborted precommit delete restores row and count under ${queryKind} search`, async ({ page }) => {
    await login(page);
    const link = await create(page, { url: 'https://destination.invalid/unrelated', title: 'Unrelated title', slug: `rollback-${queryKind}` });
    await page.goto(`${base}/admin/`);
    const query = queryKind === 'slash' ? `/${link.slug}` : link.shortUrl;
    await search(page, query);
    await expect(page.locator('.row')).toHaveCount(1);
    await expect(page.locator('.count')).toHaveText('1 result');
    const row = await openDetails(page, link.id);
    let release!: () => void;
    const held = new Promise<void>(done => { release = done; });
    let intercepted = 0;
    await page.route(`${base}/api/admin/v1/links/${link.id}`, async route => {
      if (route.request().method() !== 'DELETE') return route.continue();
      intercepted++;
      await held;
      await route.abort('failed');
    });
    try {
      await row.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect.poll(() => intercepted).toBe(1);
      await expect(row).toHaveCount(0);
      await expect(page.locator('.count')).toHaveText('0 results');
    } finally { release(); }
    await expect(page.locator('.toast')).toContainText('Can’t reach the server');
    expect((await page.request.get(`${base}/api/admin/v1/links/${link.id}`)).status()).toBe(200);
    await expect(page.locator('.toolbar input[type=search]')).toHaveValue(query);
    await expect(row).toBeVisible();
    await expect(page.locator('.count')).toHaveText('1 result');
    await expect(page.locator('.list-section .blank')).toHaveCount(0);
  });
}

for (const profile of [profiles[0], profiles[3]]) {
  test(`BUG-23 saving away sole title match removes row and count ${profile.lang}/${profile.theme}/${profile.width}`, async ({ page }) => {
    await login(page, profile);
    const needle = `NeedleOnly${profile.lang}`;
    const link = await create(page, { url: 'https://destination.invalid/ordinary', title: needle, slug: `edited-${profile.lang}` });
    await page.goto(`${base}/admin/`);
    await search(page, needle);
    await expect(page.locator('.row')).toHaveCount(1);
    const row = await openDetails(page, link.id);
    await row.getByRole('button', { name: profile.lang === 'zh' ? /^编辑/ : /^Edit/ }).click();
    await page.locator(`#edit-title-${link.id}`).fill('Changed');
    const saved = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url() === `${base}/api/admin/v1/links/${link.id}`);
    await row.locator('.editor button[type=submit]').click();
    expect((await saved).ok()).toBe(true);
    await expect(row.locator('.editor')).toHaveCount(0);
    expect((await (await page.request.get(`${base}/api/admin/v1/links/${link.id}`)).json()).title).toBe('Changed');
    const result = await page.request.get(`${base}/api/admin/v1/links`, { params: { q: needle } });
    expect(await result.json()).toMatchObject({ items: [], total: 0 });
    await expect(page.locator('.toolbar input[type=search]')).toHaveValue(needle);
    await expect(page.locator('.row')).toHaveCount(0);
    await expect(page.locator('.count')).toHaveText(profile.lang === 'zh' ? '当前筛选：0 条内容' : '0 results');
    await expect(page.locator('.list-section .blank')).toContainText(needle);
  });
}
