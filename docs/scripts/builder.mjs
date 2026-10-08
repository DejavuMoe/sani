import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';

export async function checkBuilder(page, base, theme) {
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
      const zone = builder.getByRole('combobox');
      await expect(zone.locator('option[value="UTC"]')).toHaveCount(1);
      assert(await zone.locator('option').count() > 400);
      await builder.getByLabel(lang === 'zh' ? '主域名' : 'Main domain').fill('zsh.moe');
      await builder.getByLabel(lang === 'zh' ? '文件下载域名' : 'Download domain', { exact: false }).fill('f.zsh.moe');
      await zone.selectOption('Europe/Berlin');
      await expect(panel).toContainText('TZ: Europe/Berlin');
      await zone.focus();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await expect(zone).toHaveValue('UTC');
      await expect(panel).toContainText('TZ: UTC');
      await expect(panel).toContainText('SANI_FILES_URL: https://f.zsh.moe');
      const compose = (await panel.locator('.line').allTextContents()).join('\n') + '\n';
      assert.match(compose, /image: ghcr\.io\/dejavumoe\/sani:v\d+\.\d+\.\d+/);
      assert(!compose.includes(':latest'));

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

      if (screenshotDir && lang === 'zh' && [1440, 390].includes(width)) {
        await builder.locator('.form').screenshot({ path: `${screenshotDir}/builder-${theme}-${width}.png` });
      }
    }
  }
  page.off('pageerror', pageError);
  page.off('console', consoleError);
  if (viewport) await page.setViewportSize(viewport);
  assert.deepEqual(errors, [], 'configuration builder browser errors');
  console.log(`builder: ${theme}, both languages, 1440/768/390/320px; timezone, clipboard, download and proxy/runtime switching passed`);
}
