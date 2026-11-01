import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(new URL('../../../web/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const collector = readFileSync(new URL('./collect-dom-content.js', import.meta.url), 'utf8');
const out = resolve('/tmp/sani-actions');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const results = [], captures = [], errors = [];
try {
  for (const width of [1280, 390]) for (const lang of ['zh', 'en']) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, locale: lang === 'zh' ? 'zh-CN' : 'en-US' });
    page.on('pageerror', e => errors.push(e.message));
    const sizes = [];
    for (const mode of ['url', 'text', 'file']) {
      const scene = `r11-${mode === 'url' ? 'link' : mode}-create`;
      const name = `${mode}-${lang}-${theme}-${width}`;
      await page.goto(`http://127.0.0.1:4313/sani/prototype-actions.html?scene=${scene}&lang=${lang}&theme=${theme}&chrome=0&now=live&latency=700`);
      const panel = page.locator(`#create-panel-${mode}`), button = panel.locator('.cmp-go');
      await expect(button).toBeVisible();
      const normal = await button.evaluate(el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return { width:r.width, height:r.height, radius:s.borderRadius, fontSize:s.fontSize, fontWeight:s.fontWeight, background:s.backgroundColor, color:s.color }; });
      expect(normal.height).toBe(width === 1280 ? 32 : 40);
      expect(normal.width).toBe(88);
      expect(normal.radius).toBe('8px');
      sizes.push(normal);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await button.hover();
      await expect.poll(() => button.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(normal.background);
      await button.focus(); await button.press('Tab'); await page.keyboard.press('Shift+Tab');
      await expect(button).toBeFocused();
      expect(await button.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
      await page.mouse.move(0, 0); await button.blur();
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
      if (lang === 'zh' && theme === 'light' && width === 1280) await page.screenshot({ path: resolve(out, `${mode}.png`), clip: { x:150, y:65, width:960, height:mode === 'url' ? 205 : 330 } });
      if (lang === 'en' && theme === 'dark' && width === 390) await page.screenshot({ path: resolve(out, `${mode}-mobile.png`) });
      await page.addScriptTag({ content: axe });
      const violations = await page.evaluate(async mode => (await axe.run(document.querySelector(`#create-panel-${mode} .cmp-go`), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => v.id), mode);
      expect(violations).toEqual([]);
      await page.addScriptTag({ content: collector });
      const capture = await page.evaluate(() => window.__prototypeFirstUICollectDOMContent());
      capture.items = capture.items.filter(i => i.location.includes('button.cmp-go'));
      captures.push(capture);
      // Use the existing submit paths: URL Enter, text Ctrl+Enter, file pointer.
      if (mode === 'url') await panel.locator('#composer-url').press('Enter');
      else if (mode === 'text') await panel.locator('textarea').press('Control+Enter');
      else await button.click();
      await expect(button).toHaveAttribute('aria-busy', 'true');
      await expect(button).toBeDisabled();
      await expect(button.locator('.cmp-spinner')).toBeVisible();
      expect((await button.boundingBox()).height).toBe(normal.height);
      await expect(button).not.toHaveAttribute('aria-busy', 'true');
      await expect(page.locator('.toast').first()).toBeVisible();
      results.push({ name, ...normal, hover:true, keyboardFocus:true, submission:true, busy:true, axe:violations });
    }
    expect(sizes[1]).toEqual(sizes[0]); expect(sizes[2]).toEqual(sizes[0]);
    console.log(`PASS ${lang}/${theme}/${width}: all three actions`);
    await page.close();
  }
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width:390, height:844 } });
    await page.goto(`http://127.0.0.1:4313/sani/prototype-actions.html?scene=composer-file-off&lang=en&theme=${theme}&chrome=0`);
    const button = page.locator('#create-panel-file .cmp-go');
    await expect(button).toBeDisabled();
    await expect(button).toHaveCSS('opacity','1');
    await expect(button).toHaveCSS('height','40px');
    await page.screenshot({ path:resolve(out, `disabled-${theme}.png`) });
    results.push({ name:`disabled-${theme}`, disabled:true });
    await page.close();
  }
  expect(errors).toEqual([]);
  writeFileSync(resolve(out,'results.json'), JSON.stringify({results,errors},null,2));
  writeFileSync(resolve(out,'content.json'), JSON.stringify({...captures[0],items:captures.flatMap(c=>c.items)},null,2));
} finally { await browser.close(); }
