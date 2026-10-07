// Runs axe-core over every page of the built docs site, in both languages and
// both themes, and fails when it finds violations. Needs a running preview:
//
//   pnpm --dir docs build && pnpm --dir docs preview &
//   pnpm --dir docs a11y
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { groups } from '../.vitepress/pages.ts';
import { checkComments, mockComments } from './comments.mjs';

const require = createRequire(import.meta.url);
const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const base = process.env.DOCS_URL ?? 'http://127.0.0.1:4174';
const paths = ['', ...groups.flatMap((g) => g.pages.map((p) => p.path))];

const browser = await chromium.launch();
let failures = 0;
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ colorScheme: theme });
  const comments = await mockComments(ctx);
  const page = await ctx.newPage();
  for (const prefix of ['/', '/en/']) {
    for (const path of paths) {
      const url = base + prefix + path;
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.addScriptTag({ content: axe });
      const violations = await page.evaluate(async () => {
        // @ts-ignore injected above
        const r = await window.axe.run(document, { resultTypes: ['violations'] });
        return r.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.slice(0, 3).map((n) => {
            // For contrast, the colors are what you need to fix it.
            const d = v.id === 'color-contrast' ? n.any[0]?.data : undefined;
            return n.target.join(' ') + (d ? `  (${d.fgColor} on ${d.bgColor}, ${d.contrastRatio}:1)` : '');
          }),
        }));
      });
      if (!violations.length) continue;
      failures += violations.length;
      console.log(`\n[${theme}] ${prefix}${path}`);
      for (const v of violations) {
        console.log(`  - ${v.impact} ${v.id}: ${v.help}`);
        for (const n of v.nodes) console.log(`      ${n}`);
      }
    }
  }
  if (theme === 'light') await checkComments(page, base, comments);
  await ctx.close();
}
await browser.close();
console.log(failures ? `\n${failures} violation(s)` : `axe: ${paths.length * 4} pages, no violations`);
process.exitCode = failures ? 1 : 0;
