// Before/after crops for each item in src/revisions.js. "Before" is the
// baseline prototype (identical to production in every compared state),
// served from a checkout of the base commit; "after" is the current one.
//
//   git archive f01fe22 designs | tar -x -C /tmp/sani-r0
//   python -m http.server 4312 --bind 127.0.0.1 --directory /tmp/sani-r0/designs
//   node designs/sani/tools/revision-shots.mjs [revision]   → screenshots/revisions/<rev>/<item>-{before,after}.png
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(join(project, '../../web/package.json'))('@playwright/test');
const before = process.env.BEFORE_URL ?? 'http://127.0.0.1:4312/sani';
const after = process.env.PROTO_URL ?? 'http://127.0.0.1:4311/sani';
const window = {};
new Function('window', readFileSync(join(project, 'src/revisions.js'), 'utf8'))(window);
const wanted = process.argv[2];

const browser = await chromium.launch();
for (const rev of window.SANI_REVISIONS.filter((r) => !wanted || r.id === wanted)) {
  const out = join(project, 'screenshots/revisions', rev.id);
  mkdirSync(out, { recursive: true });
  for (const item of rev.items.filter((i) => i.shot)) {
    const { scene, w, h, clip, type } = item.shot;
    for (const theme of ['light', 'dark']) {
      const lang = theme === 'light' ? 'zh' : 'en';
      for (const [side, base] of [
        ['before', before],
        ['after', after],
      ]) {
        const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
        await page.goto(`${base}/prototype.html?scene=${scene}&theme=${theme}&lang=${lang}&chrome=0&latency=0`, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        if (type) {
          await page.fill(type.selector, type.text);
          await page.waitForTimeout(400);
        }
        await page.evaluate(() => document.activeElement?.blur());
        await page.waitForTimeout(300);
        const [x, y, cw, ch] = clip;
        await page.screenshot({ path: join(out, `${item.id}-${theme}-${side}.png`), clip: { x, y, width: cw, height: ch } });
        await page.close();
      }
    }
    console.log(rev.id, item.id);
  }
}
await browser.close();
