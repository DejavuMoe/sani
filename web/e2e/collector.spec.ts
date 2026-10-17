import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const collectors = [
  ['prototype', '../../designs/sani/tools/collect-dom-content.js'],
  ['shared', '../../.agents/skills/prototype-first-ui/scripts/collect_dom_content.js'],
] as const;

for (const [name, path] of collectors) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  for (const fallback of [false, true]) {
    test(`${name} content locations resolve with ${fallback ? 'fallback' : 'native'} CSS escaping`, async ({ page }) => {
      await page.setContent('<div>audit sentinel</div>');
      if (fallback) {
        await page.evaluate(() => Object.defineProperty(CSS, 'escape', { value: undefined }));
      }
      await page.addScriptTag({ content: source });
      const failures = await page.evaluate(() => {
        const element = document.querySelector('div')!;
        const collect = (window as unknown as {
          __prototypeFirstUICollectDOMContent: () => { items: { kind: string; text: string; location: string }[] };
        }).__prototypeFirstUICollectDOMContent;
        const failures: { attribute: string; value: string; selector: string }[] = [];
        for (const attribute of ['data-screen-id', 'data-component-id', 'id', 'class']) {
          for (const value of ['back\\slash', 'quote"value', 'back\\"quote', 'line\nbreak', '123', '-', '中文😀']) {
            element.setAttribute(attribute, value);
            const selector = collect().items.find(item => item.kind === 'text' && item.text === 'audit sentinel')!.location;
            try {
              const matches = document.querySelectorAll(selector);
              if (matches.length !== 1 || matches[0] !== element) failures.push({ attribute, value, selector });
            } catch {
              failures.push({ attribute, value, selector });
            }
            element.removeAttribute(attribute);
          }
        }
        return failures;
      });
      expect(failures).toEqual([]);
    });
  }
}
