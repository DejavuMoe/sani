import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';

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
  await page.getByLabel('URL', {exact:true}).fill('example.com/docs/getting-started?ref=e2e');
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
  await page.getByLabel('URL', {exact:true}).fill('https://github.com/sveltejs/svelte');
  await page.locator('#composer-slug').fill('svelte');
  await expect(page.locator('#create-panel-url .options')).toContainText('Available');
  await page.keyboard.press('Enter');
  await expect(page.locator('.row', { hasText: '/svelte' })).toBeVisible();

  await page.getByLabel('URL', {exact:true}).fill('https://svelte.dev');
  await page.locator('#composer-slug').fill('SVELTE');
  await expect(page.locator('#create-panel-url .options')).toContainText('Taken');
  await page.getByRole('button', { name: /Shorten/ }).click();
  await expect(page.locator('#composer-error')).toContainText('taken');
  await page.locator('#composer-slug').fill('');
  await page.getByLabel('URL', {exact:true}).fill('');
});

test('the destination can be edited and takes effect immediately', async () => {
  const row = page.locator('.row', { hasText: '/svelte' });
  await row.locator('button.main').click();
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

test('several links at once: turn off, turn on, delete with undo', async () => {
  await page.getByRole('button', { name: 'Select multiple items' }).click();
  const bar = page.getByRole('group', { name: 'Bulk actions' });
  await expect(bar).toContainText('Select links');
  await page.getByRole('checkbox', { name: 'Select all loaded links' }).click();
  await expect(bar).toContainText('2 selected');

  await bar.getByRole('button', { name: 'Turn off' }).click();
  await expect(page.locator('.toast').last()).toContainText('Turned off 2 links');
  await expect(page.locator('.row .badge')).toHaveCount(2);
  expect((await follow('svelte')).status).toBe(410);
  await bar.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.locator('.row .badge')).toHaveCount(0);
  expect((await follow('svelte')).status).toBe(302);

  // In selection mode a click on a row unchecks it instead of opening it.
  await page.locator('.row', { hasText: '/svelte' }).locator('.main').click();
  await expect(bar).toContainText('1 selected');
  await expect(page.locator('.detail')).toHaveCount(0);
  await bar.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.row')).toHaveCount(1);
  await expect(page.locator('.row', { hasText: '/svelte' })).toHaveCount(1);
  await expect(bar).toHaveCount(0);
  await page.locator('.toast').last().getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.toast').last()).toContainText('Restored 1 link');
  await expect(page.locator('.row')).toHaveCount(2);

  // X checks the selected row from the keyboard; Escape leaves selection mode.
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('j');
  await page.keyboard.press('x');
  await expect(bar).toContainText('1 selected');
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
});

const port = Number(process.env.SANI_E2E_PORT ?? 18765);
const filesOrigin = `http://localhost:${port}`;

test('a text is shared at /p/ and served raw from the files origin', async () => {
  const text = 'func main() {\n\tprintln("<hi>")\n}\n';
  await page.getByRole('tab', { name: 'Text' }).click();
  const body = page.getByLabel('Text to share');
  await body.fill(text);
  await page.locator('#create-panel-text').getByRole('radio', { name: 'Code' }).click();
  await body.press('Control+Enter');
  await expect(page.locator('.toast').last()).toContainText('Copied');

  const short = await clipboard();
  expect(short).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/p\/[a-z0-9]{10}$/);
  const slug = short.split('/').pop()!;
  const row = page.locator('.row', { hasText: `/p/${slug}` });
  await expect(row).toContainText('func main() {');
  await expect(row).toContainText('Code · 3 lines');

  const visitor = await page.context().newPage();
  await visitor.goto(short);
  await visitor.bringToFront();
  expect(await visitor.locator('#text').evaluate((el) => el.textContent)).toBe(text);
  // The label turns into "Copied" once the write has finished.
  const copy = visitor.locator('[data-copy]');
  await expect(copy).toHaveAccessibleName('Copy');
  await copy.click();
  await expect(copy).toHaveText('Copied');
  expect(await visitor.evaluate(() => navigator.clipboard.readText())).toBe(text);
  const raw = await visitor.request.get(`${filesOrigin}/${slug}`);
  expect(await raw.text()).toBe(text);
  expect(raw.headers()['content-security-policy']).toContain('sandbox');
  await visitor.close();
  await page.bringToFront();

  // The owner reads it in the details without using up a view.
  await row.locator('button.main').click();
  await expect(row.locator('.preview')).toHaveText(text.trimEnd(), { useInnerText: true });
  await expect(row.locator('.figs')).toContainText('Views');
  await page.keyboard.press('Escape');
});

test('a file is uploaded and downloaded from the files origin', async () => {
  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  const panel = page.locator('#create-panel-file');
  await panel.locator('input[type=file]').setInputFiles({
    name: '会议纪要.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello from a file\n'),
  });
  await expect(panel).toContainText('会议纪要.txt');
  await panel.getByRole('button', { name: 'Share' }).click();
  await expect(page.locator('.toast').last()).toContainText(/Copied|Created/);

  const row = page.locator('.row', { hasText: '会议纪要.txt' });
  await expect(row).toContainText('/p/');
  const slug = (await row.locator('.slug').textContent())!.trim().replace(/^\/p\//, '');

  const visitor = await page.context().newPage();
  await visitor.goto(`/p/${slug}`);
  const download = visitor.getByRole('link', { name: 'Download file' });
  await expect(download).toHaveAttribute('href', `${filesOrigin}/${slug}/${encodeURIComponent('会议纪要.txt')}`);
  const res = await visitor.request.get((await download.getAttribute('href'))!);
  expect(await res.text()).toBe('hello from a file\n');
  expect(res.headers()['content-disposition']).toContain('attachment');
  await visitor.close();
  await page.bringToFront();

  // The type filter shows just the files.
  await page.getByRole('button', { name: 'Filter by type' }).click();
  await page.getByRole('menuitemradio', { name: 'Files' }).click();
  await expect(page.locator('.row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Filter by type' }).click();
  await page.getByRole('menuitemradio', { name: 'All types' }).click();
  await expect(page.locator('.row')).toHaveCount(4);
  await page.getByRole('tab', { name: 'Links', exact: true }).click();
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

test('tags are created inline, survive refresh and retain the draft after a failed save', async () => {
  await page.goto('/admin/');
  await page.getByLabel('URL', {exact:true}).fill('https://example.org/tag-review');
  await page.locator('#composer-slug').fill('review-tags');
  await page.locator('#create-panel-url .tag-add').click();
  const pop = page.locator('.tag-pop:popover-open');
  const search = pop.getByRole('textbox', { name: 'Search or create a tag' });
  await search.fill('界'.repeat(25));
  await expect(pop).toContainText('Use up to 24 characters');
  await expect(pop.locator('.tag-create')).toHaveCount(0);
  await search.fill('Review');
  await pop.getByRole('button', { name: 'Teal', exact: true }).click();
  await search.press('Enter');
  await expect(page.locator('#create-panel-url .tag-selected')).toContainText('Review');
  await search.fill('review');
  await expect(pop.locator('.tag-create')).toHaveCount(0);
  await expect(pop.getByRole('checkbox', { name: 'Review', exact: true })).toHaveAttribute('aria-checked', 'true');
  await search.press('Escape');
  await expect(page.locator('#create-panel-url .tag-add')).toBeFocused();

  await page.route('**/api/links', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'try again' } }) })
    : route.continue());
  await page.locator('#create-panel-url .go').click();
  await expect(page.locator('#create-panel-url [role=alert]')).toBeVisible();
  await expect(page.getByLabel('URL', {exact:true})).toHaveValue('https://example.org/tag-review');
  await expect(page.locator('#create-panel-url .tag-selected')).toContainText('Review');
  await page.unroute('**/api/links');
  await page.locator('#create-panel-url .go').click();
  const row = page.locator('.row', { hasText: '/review-tags' });
  await expect(row.locator('.tags')).toContainText('Review');
  await page.reload();
  await expect(row.locator('.tags .tag-badge')).toHaveAttribute('style', /#56877e/);
  await expect(page.locator('.age, .h-age')).toHaveCount(0);
  await row.locator('button.main').click();
  await expect(row.locator('.meta')).toContainText('Created');
  await expect(row.locator('.tag-detail')).toContainText('Review');
});

test('tag editing, filtering and clearing work together', async () => {
  const filter = page.locator('.tag-filter', { has: page.locator('.tag-name', { hasText: /^Review$/ }) });
  await filter.click();
  await expect(page.locator('.row')).toHaveCount(1);
  const row = page.locator('.row').first();
  await row.locator('button.main').click();
  await page.keyboard.press('e');
  await page.getByRole('button', { name: 'Remove tag Review', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(row.locator('.tags')).toContainText('Review');
  await page.keyboard.press('e');
  await page.getByRole('button', { name: 'Remove tag Review', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.row')).toHaveCount(0);
  await expect(filter.locator('.tag-count')).toHaveText('0');
  await expect(page.getByRole('button', { name: 'Clear this tag filter', exact: true })).toBeVisible();

  // Creating while filtered returns to the complete list, with the new link visible.
  await page.getByLabel('URL', {exact:true}).fill('https://example.org/tag-limit');
  await page.locator('#composer-slug').fill('limit-tags');
  await page.locator('#create-panel-url .tag-add').click();
  const pop = page.locator('.tag-pop:popover-open');
  await pop.getByRole('checkbox', { name: 'Review', exact: true }).click();
  for (const name of ['One', 'Two', 'Three', 'Four']) {
    await pop.getByRole('textbox', {name: 'Search or create a tag'}).fill(name);
    await pop.getByRole('textbox', {name: 'Search or create a tag'}).press('Enter');
    await expect(page.locator('#create-panel-url .tag-selected .tag-name')).toHaveCount(['One', 'Two', 'Three', 'Four'].indexOf(name) + 2);
  }
  await expect(pop).toContainText('Choose up to 5 tags');
  await pop.getByRole('textbox', {name: 'Search or create a tag'}).fill('Sixth');
  await expect(pop.locator('.tag-create')).toBeDisabled();
  await pop.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('#create-panel-url .go').click();
  await expect(page.locator('.tag-filter').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.row', { hasText: '/limit-tags' }).locator('.tag-overflow')).toHaveText('+3');
  await filter.click();
  await expect(page.locator('.row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Filter by type' }).click();
  await page.getByRole('menuitemradio', { name: 'Files', exact: true }).click();
  await expect(page.locator('.row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear this tag filter', exact: true }).click();
  await expect(page.locator('.row')).not.toHaveCount(0);
});

test('tags work for text and multipart file uploads on a phone', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const kind of ['Text', 'File']) {
    await page.getByRole('tab', { name: kind === 'File' ? 'Files' : kind, exact: true }).click();
    const panel = page.locator(`#create-panel-${kind.toLowerCase()}`);
    if (kind === 'Text') await panel.getByLabel('Text to share').fill('Tagged mobile note');
    else await panel.locator('input[type=file]').setInputFiles({ name: 'tagged-mobile.txt', mimeType: 'text/plain', buffer: Buffer.from('tagged mobile file') });
    await panel.locator('.tag-add').click();
    const pop = page.locator('.tag-pop:popover-open');
    await expect.poll(() => pop.evaluate(el => el.getBoundingClientRect().right <= document.documentElement.getBoundingClientRect().right - 8)).toBe(true);
    await pop.getByRole('textbox', {name: 'Search or create a tag'}).fill('Review');
    await pop.getByRole('textbox', {name: 'Search or create a tag'}).press('ArrowDown');
    await expect(pop.getByRole('checkbox', { name: 'Review', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await pop.getByRole('button', { name: 'Done', exact: true }).click();
    await panel.locator('.go').click();
    await expect(page.locator('.row', { hasText: kind === 'Text' ? 'Tagged mobile note' : 'tagged-mobile.txt' }).locator('.tags')).toContainText('Review');
  }
  await page.reload();
  const review = page.locator('.tag-filter', { has: page.locator('.tag-name', { hasText: /^Review$/ }) });
  await review.click();
  await expect(page.locator('.row')).toHaveCount(3);
  await expect(review.locator('.tag-count')).toHaveText('3');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const untagged = page.locator('.tag-filter', { has: page.locator('.tag-name', { hasText: /^Untagged$/ }) });
  await untagged.click();
  await expect(page.locator('.row')).not.toHaveCount(0);
  await expect(page.locator('.row .tags .tag-badge')).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 860 });
});

test('a delayed statistics response cannot undo saved tags', async () => {
  await page.goto('/admin/');
  let release!: () => void;
  let captured!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { captured = resolve; });
  await page.route('**/api/links/*/stats?*', async route => {
    const response = await route.fetch();
    captured();
    await held;
    await route.fulfill({ response });
  });
  const row = page.locator('.row', { hasText: '/limit-tags' });
  try {
    await row.locator('button.main').click();
    await ready;
    await page.keyboard.press('e');
    await page.getByRole('button', { name: 'Remove tag Four', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(row.locator('.tag-overflow')).toHaveText('+2');
    const done = page.waitForResponse(r => r.url().includes('/stats?'));
    release();
    await done;
    await expect(row.locator('.chart')).toBeVisible();
    await expect(row.locator('.tag-overflow')).toHaveText('+2');
    await expect(row.locator('.tag-detail .tag-name')).toHaveText(['Review', 'One', 'Two', 'Three']);
  } finally {
    release();
    await page.unroute('**/api/links/*/stats?*');
  }
});

test('external shared URLs need confirmation on desktop and phone', async () => {
  const destination = 'https://example.com/review-before-shortening';
  const before = await (await page.request.get('/api/links')).json();
  let createdURL = '';
  for (const [index, width] of [1280, 390].entries()) {
    await page.setViewportSize({ width, height: 860 });
    const target = new URL('/admin/new', page.url());
    target.searchParams.set(index === 0 ? 'url' : 'text', destination);
    target.searchParams.set('title', 'Review this shared page');
    const posts: string[] = [];
    const track = (request: import('@playwright/test').Request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/links') posts.push(request.url());
    };
    page.on('request', track);
    await page.route('http://external.test/share', route => route.fulfill({
      contentType: 'text/html', body: `<a href="${target.href}">Open shared page</a>`,
    }));
    try {
      // A local fixture supplies a genuinely cross-site top-level navigation.
      await page.goto('http://external.test/share');
      await page.getByRole('link', { name: 'Open shared page' }).click();
      await expect(page.getByRole('heading', { name: 'Shorten this page' })).toBeVisible();
      await expect(page.getByLabel('URL', {exact:true})).toHaveValue(destination);
      await page.getByRole('button', { name: 'More options' }).click();
      await expect(page.locator('#composer-more input').first()).toHaveValue('Review this shared page');
      await page.waitForLoadState('networkidle');
      expect(posts).toHaveLength(0);
      const unconfirmed = await (await page.request.get('/api/links')).json();
      expect(unconfirmed.total).toBe(before.total + index);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

      await page.getByRole('button', { name: 'Shorten', exact: true }).click();
      await expect(page.locator('.result .short')).toBeVisible();
      expect(posts).toHaveLength(1);
      if (index === 0) createdURL = (await page.locator('.result .short').getAttribute('href'))!;
      else await expect(page.locator('.result .short')).toHaveAttribute('href', createdURL);
      await expect(page.locator('.result .page')).toHaveText('Review this shared page');
    } finally {
      page.off('request', track);
      await page.unroute('http://external.test/share');
    }
  }
  const after = await (await page.request.get('/api/links')).json();
  expect(after.total).toBe(before.total + 1);
  await page.setViewportSize({ width: 1280, height: 860 });
});

test('a text response from before an edit cannot replace its saved preview or clipboard', async () => {
  const created = await page.request.post('/api/texts', { data: { slug: 'delayed-body', text: 'Old body' } });
  expect(created.status()).toBe(201);
  const link = await created.json();
  await page.goto('/admin/');
  let release!: () => void;
  let captured!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { captured = resolve; });
  let first = true;
  const path = `**/api/links/${link.id}/text`;
  await page.route(path, async route => {
    if (!first) return route.continue();
    first = false;
    const response = await route.fetch();
    captured();
    await held;
    await route.fulfill({ response });
  });
  const row = page.locator('.row', { hasText: '/p/delayed-body' });
  try {
    await row.locator('button.main').click();
    await ready;
    await page.keyboard.press('e');
    await expect(row.locator('.editor textarea')).toBeEnabled();
    await row.locator('.editor textarea').fill('New saved body');
    await row.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(row.locator('.preview')).toHaveText('New saved body');
    const response = page.waitForResponse(r => r.url().endsWith(`/api/links/${link.id}/text`));
    release();
    await response;
    await row.getByRole('button', { name: 'Copy text', exact: true }).click();
    expect(await clipboard()).toBe('New saved body');
    await expect(row.locator('.preview')).toHaveText('New saved body');
  } finally {
    release();
    await page.unroute(path);
  }
});

test('failed sign-out stays authenticated and can be retried', async () => {
  await page.goto('/admin/settings');
  for (const failure of ['server', 'network']) {
    await page.route('**/api/session', route => {
      if (route.request().method() !== 'DELETE') return route.continue();
      return failure === 'network' ? route.abort('failed') : route.fulfill({
        status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'failed' } }),
      });
    });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('.toast').last()).toContainText(failure === 'network' ? 'Can’t reach the server' : 'Something went wrong');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await page.unroute('**/api/session');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  }
  const oldCookie = (await page.context().cookies()).filter(cookie => cookie.path === '/api/').map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  expect(oldCookie).not.toBe('');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect((await page.request.get('/api/links', { headers: { Cookie: oldCookie } })).status()).toBe(401);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});

test('import validation explains skipped rows in both languages', async () => {
  await page.goto('/admin/settings');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'validation.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'sani', version: 1, links: [
      { slug: 'import-valid', url: 'https://example.com/imported', title: 'Imported' },
      { slug: 'import-expiry', url: 'https://example.com/', expiresAt: '9999-12-31T23:59:59-01:00' },
      { slug: 'import-tags', url: 'https://example.com/', tags: [{ name: '' }] },
    ] })),
  });
  const result = page.locator('.import-result');
  await expect(result).toContainText('invalid expiry format or range');
  await expect(result).toContainText('Check the tags');
  expect((await follow('import-valid')).status).toBe(302);
  expect((await follow('import-expiry')).status).toBe(404);
  await page.getByRole('radio', { name: '中文', exact: true }).click();
  await expect(result).toContainText('过期时间格式或范围无效');
  await expect(result).toContainText('请检查标签');
  await expect(result).not.toContainText('expires_invalid');
  await expect(result).not.toContainText('tags_invalid');
  await page.getByRole('radio', { name: 'English', exact: true }).click();
});

test('imports the original Shlink CSV shape through Settings', async () => {
  await page.goto('/admin/settings');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'short_urls.csv', mimeType: 'text/csv',
    buffer: Buffer.from('"createdAt","domain","shortCode","shortUrl","longUrl","title","tags","visits"\n'
      + '"2026-02-04T20:04:57+08:00","s.example.com","shlink-csv","https://s.example.com/shlink-csv","https://example.com/from-shlink","Imported from Shlink","blog|work",17\n'),
  });
  await expect(page.locator('.import-result')).toContainText('Imported 1 link');
  const exported = await (await page.request.get('/api/export')).json();
  expect(exported.links.find((link: { slug: string }) => link.slug === 'shlink-csv')).toMatchObject({
    url: 'https://example.com/from-shlink', title: 'Imported from Shlink', clicks: 17,
    tags: [{ name: 'blog', color: 'blue' }, { name: 'work', color: 'blue' }],
  });
});


test('custom tag colors validate, edit existing references and keep Enter inside the popover', async () => {
  await page.goto('/admin/');
  const panel = page.getByRole('tabpanel', { name: 'Links', exact: true });
  await panel.getByRole('button', { name: 'Choose or create tags' }).click();
  const pop = page.locator('.tag-pop:popover-open');
  await pop.getByLabel('Search or create a tag').fill('Custom R3');
  const color = pop.getByLabel('Custom color', { exact: true });
  await color.fill('rgb(300, 0, 0)');
  await expect(color).toHaveAttribute('aria-invalid', 'true');
  await expect(pop.locator('.tag-create')).toBeDisabled();
  await color.fill('rgb(88, 114, 165)');
  await color.press('Enter');
  await expect(pop).toBeVisible();
  await pop.locator('.tag-create').click();
  await pop.getByRole('button', { name: 'Manage tags', exact: true }).click();
  const manager = page.getByRole('dialog', {name:'Manage tags',exact:true});
  await manager.getByRole('button',{name:'Edit tag Custom R3'}).click();
  const edit = page.getByRole('dialog',{name:'Edit tag',exact:true});
  await edit.getByLabel('Name', { exact: true }).fill('Custom renamed');
  await edit.getByLabel('Custom color', { exact: true }).fill('hsl(120, 20%, 40%)');
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(manager.getByRole('button', { name: 'Edit tag Custom renamed' })).toBeFocused();
  const tags = await (await page.request.get('/api/tags')).json();
  expect(tags.items.find((tag: {name:string}) => tag.name === 'Custom renamed').color).toBe('#527a52');
  await manager.getByRole('button', {name:'Close',exact:true}).click();
  await expect(panel.locator('.tag-selected')).toContainText('Custom renamed');
});

test('creation defaults persist and environment metadata stays locked', async () => {
  await page.goto('/admin/settings');
  await page.getByLabel('URL links', { exact: true }).fill('7');
  await page.getByLabel('Maximum file size', { exact: true }).fill('200');
  await page.locator('section', {has:page.getByRole('heading', {name:'Creation defaults'})}).getByRole('button', {name:'Save',exact:true}).click();
  await expect(page.locator('.saved').first()).toContainText('Saved');
  await page.reload();
  await expect(page.getByLabel('URL links', { exact: true })).toHaveValue('7');
  await expect(page.getByLabel('Maximum file size', { exact: true })).toHaveValue('200');
  await expect(page.locator('#metadata-enabled')).toBeDisabled();
  const created = await page.request.post('/api/links', {data:{url:'https://example.com/r3-settings'}});
  expect((await created.json()).slug).toHaveLength(7);
  for (const format of ['csv', 'json']) {
    const sample = await page.request.get(`/admin/examples/sani.${format}`);
    expect(sample.ok()).toBe(true);
    expect(await sample.text()).toContain('example.com');
  }
});

test('large file retries the failed chunk without resending confirmed bytes', async () => {
  test.setTimeout(60000);
  await page.goto('/admin/');
  await page.getByRole('tab', {name:'Files',exact:true}).click();
  const panel = page.getByRole('tabpanel', {name:'Files',exact:true});
  const bytes = Buffer.alloc(26_000_000, 37);
  const offsets:number[] = [];
  let fail = true;
  await page.route('**/api/uploads/*', route => {
    if (route.request().method() !== 'PUT') return route.continue();
    const offset = Number(route.request().headers()['upload-offset']);
    offsets.push(offset);
    if (offset === 25_000_000 && fail) { fail = false; return route.abort('failed'); }
    return route.continue();
  });
  try {
    await panel.locator('input[type=file]').setInputFiles({name:'large-r3.bin',mimeType:'application/octet-stream',buffer:bytes});
    await panel.getByRole('button', {name:'Share',exact:true}).click();
    await expect(panel.getByRole('button', {name:'Retry upload'})).toBeVisible();
    const completed = page.waitForResponse(r => r.url().endsWith('/complete') && r.request().method() === 'POST');
    await panel.getByRole('button', {name:'Retry upload'}).click();
    await expect(page.locator('.toast').last()).toContainText('Copied');
    expect(offsets).toEqual([0,25_000_000,25_000_000]);
    const link = await (await completed).json();
    expect(link).toBeTruthy();
    const file = await page.request.get(`http://localhost:${new URL(page.url()).port}/${link.slug}/large-r3.bin`, {headers:{'User-Agent':'Mozilla/5.0'}});
    expect(file.status()).toBe(200);
    const downloaded = await file.body();
    expect(downloaded.length).toBe(bytes.length);
    expect(createHash('sha256').update(downloaded).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
  } finally { await page.unroute('**/api/uploads/*'); }
});

test('tabs and settings keep horizontal geometry at desktop and narrow widths', async () => {
  for (const width of [1280,390,320]) {
    await page.setViewportSize({width,height:860});
    await page.goto('/admin/');
    let left:number|undefined;
    for (const name of ['Links','Text','Files','Links']) {
      const tab = page.getByRole('tab', {name,exact:true});
      await tab.click();
      const x = (await page.getByRole('tablist').boundingBox())!.x;
      if (left !== undefined) expect(Math.abs(x-left)).toBeLessThanOrEqual(1);
      left=x;
      expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      await expect(page.locator('[role=tabpanel][hidden]')).toHaveCount(2);
    }
    await page.goto('/admin/settings');
    expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({width:1280,height:860});
});
