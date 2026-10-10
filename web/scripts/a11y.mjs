// Runs axe-core over the main screens in both languages and themes.
//   SANI_URL=http://127.0.0.1:8080 node scripts/a11y.mjs
// SANI_FRESH_URL may point at an instance without a password to include setup.
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const base = process.env.SANI_URL ?? 'http://127.0.0.1:8080';
const password = process.env.SANI_DEMO_PASSWORD ?? 'sani-demo';
const fresh = process.env.SANI_FRESH_URL;

const screenshots = process.env.SANI_SCREENSHOTS;
if (screenshots) mkdirSync(screenshots, {recursive:true});
const phone = { width: 390, height: 800 };

const screens = [
  ...(fresh ? [{ name: 'setup', path: '/admin/', auth: false, origin: fresh }] : []),
  { name: 'login', path: '/admin/', auth: false },
  { name: 'dashboard', path: '/admin/' },
  { name: 'dashboard-narrow', path: '/admin/', viewport:{width:320,height:860} },
  {
    name: 'detail',
    path: '/admin/',
    run: async (page) => {
      await page.locator('.row .main').first().click();
      await page.waitForSelector('.detail');
      await page.waitForTimeout(400);
    },
  },
  {
    name: 'editor',
    path: '/admin/',
    run: async (page) => {
      await page.locator('.row .main').first().click();
      await page.keyboard.press('e');
      await page.waitForSelector('.editor');
    },
  },
  {
    name: 'bulk',
    path: '/admin/',
    run: async (page) => {
      await page.locator('.toolbar .pick').click();
      await page.locator('.row .main').nth(1).click();
      await page.locator('.row .main').nth(2).click();
      await page.waitForSelector('.bulkbar');
    },
  },
  { name: 'settings', path: '/admin/settings' },
  { name: 'settings-narrow', path: '/admin/settings', viewport: {width:320,height:860} },
  ...[1280,390,320].flatMap(width => ['create','edit'].map(mode => ({
    name: `r3-tag-${mode}-${width}`, path:'/admin/', viewport:{width,height:860},
    run:async page => {
      if (mode === 'edit') {
        await page.request.post(`${base}/api/admin/v1/tags`, {data:{name:'QA color',color:'#5872a5'}});
        await page.reload();
      }
      await page.locator('#create-panel-url .tag-add').click();
      const pop = page.locator('.tag-pop:popover-open');
      let editor = pop;
      if (mode === 'create') await pop.locator('.tag-search input').fill('R3 custom');
      else {
        await pop.getByRole('button', {name: /^(管理标签|Manage tags)$/}).click();
        await page.getByRole('button', {name: /^(编辑标签|Edit tag) QA color$/}).click();
        editor = page.getByRole('dialog', {name: /^(编辑标签|Edit tag)$/});
      }
      await editor.locator('.color-input .field').fill('#e8dfcc');
    },
  }))),
  {
    name: 'share-text',
    path: '/admin/',
    run: async (page) => {
      await page.getByRole('tab', { name: /^(文本|Text)$/ }).click();
      await page.locator('#share-text-body').fill('server {\n    listen 443;\n}');
      await page.locator('#create-panel-text').getByRole('radio', { name: /^(代码|Code)$/ }).click();
    },
  },
  {
    name: 'share-file',
    path: '/admin/',
    run: async (page) => {
      await page.getByRole('tab', { name: /^(文件|Files)$/ }).click();
      await page.locator('#create-panel-file input[type=file]').setInputFiles({
        name: 'notes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('notes'),
      });
    },
  },
  {
    name: 'text-detail',
    path: '/admin/',
    run: async (page) => {
      await page.locator('.row', { hasText: '/p/nginx-conf' }).locator('.main').click();
      await page.waitForSelector('.preview');
      await page.waitForTimeout(400);
    },
  },
  {
    name: 'text-editor-phone',
    path: '/admin/',
    viewport: phone,
    run: async (page) => {
      await page.locator('.row', { hasText: '/p/nginx-conf' }).locator('.main').click();
      await page.keyboard.press('e');
      await page.waitForSelector('.editor textarea:not([disabled])');
    },
  },
  { name: 'visitor-text', path: '/p/nginx-conf' },
  { name: 'visitor-text-phone', path: '/p/nginx-conf', viewport: phone },
  {
    name: 'visitor-file',
    // The seeded file has a generated slug.
    path: async (request) => {
      const res = await request.get(`${base}/api/admin/v1/links?kind=file`);
      return `/p/${(await res.json()).items[0].slug}`;
    },
  },
];

const browser = await chromium.launch();
let total = 0;
for (const [locale, theme] of ['zh-CN', 'en-US'].flatMap((locale) => ['light', 'dark'].map((theme) => [locale, theme]))) {
  for (const s of screens) {
    const ctx = await browser.newContext({ colorScheme: theme, locale, bypassCSP: true, viewport: s.viewport });
    await ctx.addInitScript((t) => localStorage.setItem('sani.theme', t), theme);
    if (s.auth !== false) await ctx.request.post(`${base}/api/admin/v1/session`, { data: { password } });
    const page = await ctx.newPage();
    const path = typeof s.path === 'function' ? await s.path(ctx.request) : s.path;
    await page.goto((s.origin ?? base) + path, { waitUntil: 'networkidle' });
    if (s.run) await s.run(page);
    if (screenshots && (s.name.startsWith('r3-') || s.name === 'settings-narrow' || s.name === 'settings' || s.name === 'dashboard')) {
      const artifact = `${screenshots}/${locale}-${theme}-${s.name}`;
      await page.screenshot({path:artifact+'.png',fullPage:false});
      await page.addScriptTag({content:readFileSync('../.agents/skills/prototype-first-ui/scripts/collect_dom_content.js','utf8')});
      writeFileSync(artifact+'.json', JSON.stringify(await page.evaluate(() => window.__prototypeFirstUICollectDOMContent()),null,2));
    }
    await page.addScriptTag({ content: axe });
    const result = await page.evaluate(async () => {
      // @ts-ignore injected above
      // Scan the top-layer popover separately: covered rows otherwise inherit its button background in axe.
      // The underlying page has its own full-document checks at desktop and narrow widths.
      const r = await window.axe.run(document.querySelector('.tag-pop:popover-open') ?? document, { resultTypes: ['violations'] });
      return r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.slice(0, 4).map((n) => ({ target: n.target.join(' '), summary: n.failureSummary?.split('\n')[1]?.trim() })),
        count: v.nodes.length,
      }));
    });
    // Not an axe rule, but a page that scrolls sideways fails reflow (WCAG 1.4.10).
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (wide > 0) result.push({ id: 'reflow', impact: 'serious', help: `page is ${wide}px wider than the viewport`, nodes: [], count: 1 });
    total += result.length;
    console.log(`\n[${locale}/${theme}] ${s.name}: ${result.length ? result.length + ' violation(s)' : 'clean'}`);
    for (const v of result) {
      console.log(`  - ${v.impact} ${v.id} (${v.count}): ${v.help}`);
      for (const n of v.nodes) console.log(`      ${n.target}${n.summary ? ' — ' + n.summary : ''}`);
    }
    await ctx.close();
  }
}
await browser.close();
process.exitCode = total ? 1 : 0;
