import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';

export async function checkBuilder(page, base, theme, axe) {
  const viewport = page.viewportSize();
  const errors = [];
  const pageError = (error) => errors.push(error.message);
  const consoleError = (message) => {
    if (message.type() === 'error') errors.push(message.text());
  };
  page.on('pageerror', pageError);
  page.on('console', consoleError);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const screenshotDir = process.env.BUILDER_SCREENSHOTS;
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  for (const lang of ['zh', 'en']) {
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${base}/${lang === 'en' ? 'en/' : ''}guide/deploy`, { waitUntil: 'networkidle' });
      await expect(page).toHaveTitle(lang === 'zh' ? /部署.*Sani/ : /Deployment.*Sani/);
      await expect(page.locator('vite-error-overlay')).toHaveCount(0);
      const builder = page.locator('.sn-builder');
      const panel = builder.getByRole('tabpanel');
      const zone = builder.getByRole('button', { name: lang === 'zh' ? /^统计时区/ : /^Time zone for statistics/ });
      const pop = builder.getByRole('dialog');
      const search = pop.getByRole('combobox');
      await expect(builder.locator('select, datalist')).toHaveCount(0);
      await builder.getByLabel(lang === 'zh' ? '主域名' : 'Main domain').fill('zsh.moe');
      await builder.getByLabel(lang === 'zh' ? '文件下载域名' : 'Download domain', { exact: false }).fill('f.zsh.moe');
      await zone.click();
      await expect(search).toBeFocused();
      assert(await pop.getByRole('option').count() > 400);
      await search.fill('berlin');
      await expect(pop.getByRole('option')).toHaveCount(1);
      await pop.getByRole('option', { name: 'Europe/Berlin', exact: true }).click();
      await expect(pop).toBeHidden();
      await expect(zone).toBeFocused();
      await expect(panel).toContainText('TZ: Europe/Berlin');
      await page.keyboard.press('Enter');
      await expect(search).toBeFocused();
      await search.press('Home');
      const first = await search.getAttribute('aria-activedescendant');
      await search.press('ArrowDown');
      await expect(search).not.toHaveAttribute('aria-activedescendant', first);
      await search.press('ArrowUp');
      await expect(search).toHaveAttribute('aria-activedescendant', first);
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await expect(zone).toContainText('UTC');
      await expect(panel).toContainText('TZ: UTC');
      // Type in the opening task, before the browser dispatches its queued toggle.
      await zone.evaluate(el => {
        el.click();
        const input = document.querySelector('#b-zone-pop input');
        input.value = 'no-such-time-zone';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await expect(pop.getByRole('option')).toHaveCount(0);
      await expect(pop.getByRole('status')).toBeVisible();
      await search.press('Enter');
      await expect(zone).toContainText('UTC');
      await search.press('Escape');
      await expect(zone).toBeFocused();
      await zone.click();
      await expect(search).toHaveValue('');
      await search.press('Tab');
      await expect(pop).toBeHidden();
      await expect(builder.getByRole('radio', { name: lang === 'zh' ? '首次访问时设置' : 'Choose on first visit' })).toBeFocused();
      await expect(panel).toContainText('SANI_FILES_URL: https://f.zsh.moe');
      const compose = (await panel.locator('.line').allTextContents()).join('\n') + '\n';
      assert.match(compose, /image: ghcr\.io\/dejavumoe\/sani:v\d+\.\d+\.\d+/);
      assert(!compose.includes(':latest'));
      assert.match(compose, /source: \.\/sani-data/);
      assert.match(compose, /create_host_path: false/);
      assert(!/^volumes:/m.test(compose));
      const steps = await builder.locator('.steps').innerText();
      const prepareAt = steps.indexOf('sudo install -d -m 750 -o 65532 -g 65532 ./sani-data');
      assert(prepareAt >= 0 && prepareAt < steps.indexOf('docker compose up -d'));

      const domainBox = await builder.getByLabel(lang === 'zh' ? '主域名' : 'Main domain').boundingBox();
      const zoneBox = await zone.boundingBox();
      if (width > 640) assert(Math.abs(domainBox.y - zoneBox.y) < 1, `${lang}/${width}: misaligned controls`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${lang}/${width}: page overflow`);

      await builder.getByRole('button', { name: lang === 'zh' ? '复制' : 'Copy', exact: true }).click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), compose);
      const downloadEvent = page.waitForEvent('download');
      await builder.getByRole('button', { name: lang === 'zh' ? '下载' : 'Download', exact: true }).click();
      const download = await downloadEvent;
      assert.equal(download.suggestedFilename(), 'compose.yaml');
      assert.equal(await readFile(await download.path(), 'utf8'), compose);

      await builder.getByRole('radio', { name: 'nginx', exact: true }).click();
      await builder.getByRole('tab', { name: 'sani.conf', exact: true }).click();
      await expect(panel).toContainText('server_name zsh.moe f.zsh.moe;');
      await builder.getByRole('radio', { name: 'systemd', exact: true }).click();
      await builder.getByRole('tab', { name: 'sani.service', exact: true }).click();
      await expect(panel).toContainText('Environment=TZ=UTC');
      await expect(builder.locator('.steps')).toContainText('/releases/download/v');
      await builder.getByRole('radio', { name: 'Docker Compose', exact: true }).click();

      await zone.evaluate(el => el.scrollIntoView({ block: 'center' }));
      await zone.click();
      await expect(search).toBeFocused();
      await search.press('Home');
      const menuBox = await pop.boundingBox();
      const triggerBox = await zone.boundingBox();
      assert(menuBox.x >= 0 && menuBox.x + menuBox.width <= width + 1 && menuBox.y >= 0 && menuBox.y + menuBox.height <= 1001);
      assert(Math.abs(menuBox.width - triggerBox.width) < 1, `${lang}/${width}: popup width differs from trigger`);
      if (axe) {
        await page.addScriptTag({ content: axe });
        const violations = await page.evaluate(async () => (await window.axe.run('#b-zone-pop')).violations);
        assert.deepEqual(violations, [], `${theme}/${lang}/${width}: open timezone accessibility`);
      }
      if (screenshotDir && lang === 'zh' && [1440, 390].includes(width)) {
        await page.screenshot({ path: `${screenshotDir}/builder-${theme}-${width}.png` });
      }
      await builder.locator('#b-zone-label').click();
      await expect(pop).toBeHidden();
    }
  }
  page.off('pageerror', pageError);
  page.off('console', consoleError);
  if (viewport) await page.setViewportSize(viewport);
  const touch = await page.context().browser().newContext({ hasTouch: true, viewport: { width: 390, height: 844 }, colorScheme: theme });
  const mobile = await touch.newPage();
  await mobile.goto(`${base}/guide/deploy`, { waitUntil: 'networkidle' });
  await mobile.getByRole('button', { name: /^统计时区/ }).tap();
  await mobile.setViewportSize({ width: 390, height: 400 });
  await expect.poll(async () => {
    const box = await mobile.getByRole('dialog').boundingBox();
    return box && box.y >= 0 && box.y + box.height <= 401;
  }).toBe(true);
  await mobile.getByRole('combobox', { name: '搜索时区' }).fill('Shanghai');
  await mobile.getByRole('option', { name: 'Asia/Shanghai', exact: true }).tap();
  await expect(mobile.getByRole('tabpanel')).toContainText('TZ: Asia/Shanghai');
  await expect(mobile.getByRole('dialog')).toBeHidden();
  await touch.close();
  assert.deepEqual(errors, [], 'configuration builder browser errors');
  console.log(`builder: ${theme}, both languages, 1440/768/390/320px; timezone, clipboard, download and proxy/runtime switching passed`);
}
