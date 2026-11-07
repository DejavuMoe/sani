import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

// Its own server, so it runs the same alone or in a full run.
const base = 'http://127.0.0.1:18777';
const password = 'placeholder-regressions';
const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
let server: ChildProcess;
let serverLog = '';

test.beforeAll(async () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('SANI_')) delete env[key];
  server = spawn('../bin/sani', [], {
    env: { ...env, SANI_DATA_DIR: mkdtempSync(join(tmpdir(), 'sani-placeholder-')),
      SANI_LISTEN: '127.0.0.1:18777', SANI_FILES_URL: 'http://localhost:18777',
      SANI_PASSWORD: password, SANI_FETCH_META: 'false', SANI_LOG_LEVEL: 'info' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  server.stderr!.on('data', chunk => { serverLog = (serverLog + chunk.toString()).slice(-8192); });
  await expect.poll(async () => {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Placeholder fixture exited early\n${serverLog}`);
    // Only this child's own "ready" line proves the port is ours.
    if (!serverLog.includes('sani is ready')) return 0;
    return fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1000) }).then(r => r.status, () => 0);
  }, { timeout: 10_000 }).toBe(200);
});

test.afterAll(async () => {
  if (!server?.pid || server.exitCode !== null || server.signalCode !== null) return;
  const stopped = new Promise<void>(done => server.once('exit', () => done()));
  server.kill('SIGTERM');
  await Promise.race([stopped, new Promise(done => setTimeout(done, 5000))]);
  if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
});

// One profile for each layout the list has: the full table, without the activity column, and the phone's stacked rows.
const profiles = [
  { lang: 'en', theme: 'light', width: 1280 },
  { lang: 'zh', theme: 'dark', width: 800 },
  { lang: 'en', theme: 'dark', width: 390 },
  { lang: 'zh', theme: 'light', width: 390 },
] as const;

async function login(page: Page, profile: (typeof profiles)[number]) {
  await page.setViewportSize({ width: profile.width, height: 900 });
  await page.emulateMedia({ colorScheme: profile.theme });
  await page.addInitScript(({ lang, theme }) => {
    localStorage.setItem('sani.lang', lang);
    localStorage.setItem('sani.theme', theme);
  }, profile);
  expect((await page.request.post(`${base}/api/admin/v1/session`, { data: { password } })).ok()).toBe(true);
}

/** Where the parts of a list sit, relative to its card, so the placeholder and the real list can be compared. */
async function measure(page: Page, card: string, parts: { icon: string; slug: string; clicks: string; copy: string; spark: string }) {
  return page.evaluate(({ card, parts }) => {
    const root = document.querySelector(card) as HTMLElement;
    const box = root.getBoundingClientRect();
    const head = root.querySelector('.head') as HTMLElement;
    const rel = (el: Element | null, row: DOMRect) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null; // not displayed at this width
      return { x: r.left - box.left, y: r.top - row.top, w: r.width, h: r.height };
    };
    const rows = [...root.querySelectorAll(':scope > ul > li')].slice(0, 5).map(li => {
      const r = li.getBoundingClientRect();
      return {
        top: r.top - box.top, height: r.height,
        icon: rel(li.querySelector(parts.icon), r), slug: rel(li.querySelector(parts.slug), r),
        clicks: rel(li.querySelector(parts.clicks), r), copy: rel(li.querySelector(parts.copy), r), spark: rel(li.querySelector(parts.spark), r),
      };
    });
    return {
      left: box.left, top: box.top, width: box.width,
      head: head && getComputedStyle(head).display !== 'none' ? head.getBoundingClientRect().height : 0,
      rows,
    };
  }, { card, parts });
}

for (const profile of profiles) {
  test(`the placeholder has the geometry of the list that replaces it ${profile.lang}/${profile.theme}/${profile.width}`, async ({ page }) => {
    await login(page, profile);
    for (let i = 0; i < 6; i++) {
      const response = await page.request.post(`${base}/api/admin/v1/links`, { data: { url: `https://example.com/placeholder/${Date.now()}-${i}` } });
      expect(response.status(), await response.text()).toBe(201);
    }
    // Hold the first page, as a slow network would.
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(url => url.pathname === '/api/admin/v1/links', async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      await gate;
      await route.continue();
    });

    await page.goto(`${base}/admin/`);
    const ghost = page.locator('.card[role=status]');
    // It waits a moment first, so a quick load shows no placeholder at all.
    await expect(ghost).toBeVisible();
    await expect(ghost).toHaveAttribute('aria-busy', 'true');
    await expect(ghost).toHaveAttribute('aria-label', profile.lang === 'zh' ? '正在加载…' : 'Loading…');
    await expect(ghost.locator('ul > li')).toHaveCount(5);
    // Nothing in it can be reached by keyboard or read out, and axe finds nothing wrong.
    await expect(ghost.locator('ul')).toHaveAttribute('aria-hidden', 'true');
    await expect(ghost.locator('.head')).toHaveAttribute('inert', '');
    await page.waitForTimeout(300); // tags and the totals settle, which can move the list
    await page.evaluate(axe);
    expect(await page.evaluate(async () => (await (window as any).axe.run(document, { resultTypes: ['violations'] })).violations
      .map((v: any) => `${v.id}: ${v.nodes.map((n: any) => n.target.join(' ')).join(' | ')}`))).toEqual([]);
    const placeholder = await measure(page, '.card[role=status]', { icon: '.g-icon', slug: '.g-slug', clicks: '.g-clicks', copy: '.g-copy', spark: '.g-spark' });
    if (process.env.SANI_QA_DIR) {
      expect(isAbsolute(process.env.SANI_QA_DIR), 'SANI_QA_DIR must be absolute').toBe(true);
      mkdirSync(process.env.SANI_QA_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.SANI_QA_DIR, `placeholder-${profile.lang}-${profile.theme}-${profile.width}.png`), fullPage: true });
    }

    release();
    const list = page.locator('.card:not([role=status])');
    await expect(list.locator('ul > li').first()).toBeVisible();
    await expect(ghost).toHaveCount(0);
    await page.waitForTimeout(300);
    const real = await measure(page, '.card:not([role=status])', { icon: '.title-line > :first-child', slug: '.slug', clicks: '.clicks', copy: '.copy', spark: '.spark' });

    const near = (what: string, a: number | null, b: number | null) => {
      if (a === null || b === null) return expect(a, `${what}: placeholder ${a}, list ${b}`).toBe(b);
      expect(Math.abs(a - b), `${what}: placeholder ${a}, list ${b}`).toBeLessThanOrEqual(1);
    };
    near('card left', placeholder.left, real.left);
    near('card top', placeholder.top, real.top);
    near('card width', placeholder.width, real.width);
    near('header height', placeholder.head, real.head);
    expect(real.rows.length).toBeGreaterThanOrEqual(5);
    placeholder.rows.forEach((row, i) => {
      const other = real.rows[i];
      near(`row ${i} top`, row.top, other.top);
      near(`row ${i} height`, row.height, other.height);
      for (const part of ['icon', 'slug', 'clicks', 'copy', 'spark'] as const) {
        const a = row[part], b = other[part];
        near(`row ${i} ${part} x`, a && a.x, b && b.x);
        near(`row ${i} ${part} y`, a && a.y, b && b.y);
      }
    });
  });
}
