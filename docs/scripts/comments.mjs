import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

// Keep docs CI independent of the public service, and never post test comments there.
export async function mockComments(context) {
  const state = { failure: false, submitted: null, keys: [] };
  await context.route('https://ecoku-dev.zsh.moe/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/comment/submit' && request.method() === 'POST') {
      state.submitted = request.postDataJSON();
      assert.equal(state.submitted.siteId, 'sani-docs');
      return route.fulfill({ json: { code: 200, data: { id: 1 } } });
    }
    assert.equal(url.pathname, '/api/comment/list');
    assert.equal(url.searchParams.get('siteId'), 'sani-docs');
    const key = url.searchParams.get('key');
    state.keys.push(key);
    if (state.failure) return route.fulfill({ status: 503, json: { code: 503 } });
    const comments = state.submitted?.mark === key ? [{
      id: 1, username: 'Reader', content: state.submitted.content, mark: key,
      site_id: 'sani-docs', parent: 0, created_at: '2026-10-07T12:00:00Z',
    }] : [];
    return route.fulfill({ json: { code: 200, data: {
      data: comments, total: comments.length, commentTotal: comments.length,
      page: 1, pageSize: 10, pageCount: comments.length ? 1 : 0,
      formConfig: { emailRequired: false, captcha: { provider: 'off' } },
    } } });
  });
  return state;
}

export async function checkComments(page, base, state) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/guide/introduction.html?review=1#next');
  await expect(page.locator('.ecoku-comments')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('.ecoku-empty-state')).toBeVisible();
  assert.equal(state.keys.at(-1), '/guide/introduction');
  const editor = page.locator('.ecoku-composer textarea').first();
  await editor.fill('A draft stays here.');
  const color = () => page.locator('.ecoku-composer').evaluate((el) => getComputedStyle(el).backgroundColor);
  const before = await color();
  await page.locator('.VPSwitchAppearance:visible').click();
  assert.notEqual(await color(), before);
  await expect(editor).toHaveValue('A draft stays here.');
  await editor.focus();
  await page.keyboard.press('Tab');
  assert.ok(await page.locator('.sn-comments').evaluate((el) => el.contains(document.activeElement)));

  // VitePress client navigation, followed by a language change, must replace the thread.
  await page.locator('.VPSidebar a[href="/guide/quick-start"]').click();
  await expect(editor).toHaveValue('');
  await expect.poll(() => state.keys.at(-1)).toBe('/guide/quick-start');
  await page.locator('.VPNavBarTranslations button').click();
  await page.locator('.VPNavBarTranslations a[href="/en/guide/quick-start"]').click();
  await expect(page.locator('.ecoku-comments')).toHaveAttribute('lang', 'en');
  await expect.poll(() => state.keys.at(-1)).toBe('/en/guide/quick-start');
  await expect(page.locator('.ecoku-empty-state')).toContainText('No comments yet');
  await page.locator('.ecoku-composer input[autocomplete="nickname"]').fill('Reader');
  await editor.fill('A local test comment.');
  await page.locator('.ecoku-composer').getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.locator('.ecoku-thread-list')).toContainText('A local test comment.');
  assert.equal(state.submitted.mark, '/en/guide/quick-start');
  assert.ok(state.submitted.pageTitle);

  state.failure = true;
  await page.locator('.VPSidebar a[href="/en/guide/introduction"]').click();
  await expect(page.locator('.ecoku-service-error')).toBeVisible();
  await expect(page.locator('.vp-doc h1')).toBeVisible();
  state.failure = false;
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.locator('.ecoku-empty-state')).toBeVisible();

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await editor.fill('Mobile draft');
    assert.ok(await page.locator('.sn-comments').evaluate((el) =>
      el.scrollWidth <= el.clientWidth && document.documentElement.scrollWidth <= innerWidth));
  }
  await page.goto(base + '/');
  await expect(page.locator('.sn-comments')).toHaveCount(0);
  await page.goto(base + '/404.html');
  await expect(page.locator('.sn-comments')).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log('comments: route keys, language, theme drafts, keyboard, submission, retry and mobile checks passed');
}
