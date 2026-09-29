import { expect, test, type Page } from '@playwright/test';

// One server and database for the whole file: each test builds on the last,
// the way an owner actually uses Sani.
test.describe.configure({ mode: 'serial' });

const PASSWORD = 'correct horse battery';
let page: Page;
const pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
});

test.afterAll(async () => {
  await page.context().close();
  expect(pageErrors).toEqual([]);
});

async function clipboard() {
  return page.evaluate(() => navigator.clipboard.readText());
}

async function follow(slug: string) {
  const res = await page.request.get(`/${encodeURIComponent(slug)}`, {
    maxRedirects: 0,
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0 Safari/537.36' },
  });
  return { status: res.status(), location: res.headers()['location'] };
}

test('first run asks for the setup code and a password, then lands on an empty dashboard', async () => {
  await page.goto('/admin/');
  await expect(page.getByRole('heading', { name: 'Set an admin password' })).toBeVisible();
  await expect(page.getByLabel('Setup code')).toBeFocused();
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByRole('alert')).toContainText('setup code from the server log');

  await page.getByLabel('Setup code').fill('wrong-code-here');
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByLabel('Repeat it').fill('short');
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByRole('alert')).toContainText('at least 8 characters');

  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Repeat it').fill(PASSWORD);
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByRole('alert')).toContainText('setup code isn’t right');

  // Codes are compared without case, spaces or dashes.
  await page.getByLabel('Setup code').fill(' E2E TEST CODE ');
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByRole('heading', { name: 'No links yet' })).toBeVisible();
});

test('a pasted URL becomes a short link on the clipboard', async () => {
  await page.getByLabel('Long URL').fill('example.com/docs/getting-started?ref=e2e');
  await page.keyboard.press('Enter');
  await expect(page.locator('.toast')).toContainText('Copied');

  const short = await clipboard();
  expect(short).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[a-z0-9]{5}$/);
  const slug = short.split('/').pop()!;
  await expect(page.locator('.row').first()).toContainText(`/${slug}`);

  const hop = await follow(slug);
  expect(hop.status).toBe(302);
  expect(hop.location).toBe('https://example.com/docs/getting-started?ref=e2e');
});

test('custom slugs are checked while typing and conflicts are explained', async () => {
  await page.getByLabel('Long URL').fill('https://github.com/sveltejs/svelte');
  await page.locator('#composer-slug').fill('svelte');
  await expect(page.locator('.options')).toContainText('Available');
  await page.keyboard.press('Enter');
  await expect(page.locator('.row', { hasText: '/svelte' })).toBeVisible();

  await page.getByLabel('Long URL').fill('https://svelte.dev');
  await page.locator('#composer-slug').fill('SVELTE');
  await expect(page.locator('.options')).toContainText('Taken');
  await page.getByRole('button', { name: /Shorten/ }).click();
  await expect(page.locator('#composer-error')).toContainText('taken');
  await page.locator('#composer-slug').fill('');
  await page.getByLabel('Long URL').fill('');
});

test('the destination can be edited and takes effect immediately', async () => {
  const row = page.locator('.row', { hasText: '/svelte' });
  await row.locator('.main').click();
  await expect(row.locator('.detail')).toBeVisible();
  await page.keyboard.press('e');
  const url = row.getByLabel('Destination');
  await url.fill('https://svelte.dev/docs');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.toast').last()).toContainText('Saved');
  expect((await follow('svelte')).location).toBe('https://svelte.dev/docs');
});

test('a link can be turned off and on', async () => {
  const row = page.locator('.row', { hasText: '/svelte' });
  await row.getByRole('button', { name: 'Turn off' }).click();
  await expect(row.locator('.badge')).toContainText('Off');
  expect((await follow('svelte')).status).toBe(410);
  await row.getByRole('button', { name: 'Turn on' }).click();
  await expect(row.locator('.badge')).toHaveCount(0);
  expect((await follow('svelte')).status).toBe(302);
});

test('deleting offers undo', async () => {
  const row = page.locator('.row', { hasText: '/svelte' });
  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.row', { hasText: '/svelte' })).toHaveCount(0);
  expect((await follow('svelte')).status).toBe(404);

  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.row', { hasText: '/svelte' })).toBeVisible();
  expect((await follow('svelte')).status).toBe(302);
});

test('search narrows the list and Escape clears it', async () => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('/');
  await page.keyboard.type('svelte');
  await expect(page.locator('.row')).toHaveCount(1);
  await expect(page.locator('.count')).toContainText('1 result');
  await page.keyboard.press('Escape');
  await expect(page.locator('.row')).toHaveCount(2);
});

test('keyboard: move, copy and open the shortcut sheet', async () => {
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await page.keyboard.press('c');
  expect(await clipboard()).toMatch(/\/[a-z0-9]{5}$/);
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('an API token can create links and be revoked', async () => {
  await page.goto('/admin/settings');
  await page.getByLabel('Token name').fill('e2e');
  await page.getByRole('button', { name: 'Create token' }).click();
  const token = (await page.locator('.secret code').textContent())!.trim();
  expect(token).toMatch(/^sani_[0-9A-Za-z]{43}$/);

  const api = await page.context().request;
  const created = await api.post('/api/links', {
    headers: { Authorization: `Bearer ${token}` },
    data: { url: 'https://example.org/from-api', slug: 'from-api' },
  });
  expect(created.status()).toBe(201);

  await page.getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('.tokens')).toHaveCount(0);
  const refused = await api.post('/api/links', {
    headers: { Authorization: `Bearer ${token}` },
    data: { url: 'https://example.org/again' },
  });
  expect(refused.status()).toBe(401);
});

test('signing out and back in', async () => {
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Password').fill('not the password');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('isn’t right');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});

test('unknown and gone links get a readable page', async () => {
  const res = await page.request.get('/does-not-exist', { headers: { 'Accept-Language': 'zh-CN' } });
  expect(res.status()).toBe(404);
  expect(await res.text()).toContain('这个短链接不存在');
});
