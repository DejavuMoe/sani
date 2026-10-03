// Captures the prototype's fixtures from a running, seeded Sani instance, so
// every link, count and chart in the prototype is data production produced.
//
//   go run ./scripts/seed -data <tmp>/demo -password sani-demo -base https://s.example.com
//   SANI_LISTEN=127.0.0.1:18080 SANI_DATA_DIR=<tmp>/demo SANI_FILES_URL=http://localhost:18080 ./bin/sani
//   node designs/sani/tools/capture.mjs [http://127.0.0.1:18080]
//
// Local origins are rewritten to example.com hosts, and the one token secret
// is replaced, so nothing from the machine ends up in the repository.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://127.0.0.1:18080';
const password = process.env.SANI_DEMO_PASSWORD ?? 'sani-demo';

let cookie = '';
async function api(method, path, body) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

await api('POST', '/session', { password });
const config = await api('GET', '/config');
const overview = await api('GET', '/overview?days=30');
const { items: links, total } = await api('GET', '/links?sort=created&limit=100');

const stats = {};
const texts = {};
for (const l of links) {
  stats[l.id] = {};
  for (const days of [7, 30, 90]) {
    const s = await api('GET', `/links/${l.id}/stats?days=${days}`);
    stats[l.id][days] = { days: s.days, referrers: s.referrers, referrersTotal: s.referrersTotal };
  }
  if (l.kind === 'text') texts[l.id] = (await api('GET', `/links/${l.id}/text`)).text;
}

// The favicons production fetched, so rows show the same icons.
const favicons = {};
const ext = { 'image/png': 'png', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/svg+xml': 'svg', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
mkdirSync(join(project, 'src/assets/favicons'), { recursive: true });
for (const host of new Set(links.filter((l) => l.icon && l.host).map((l) => l.host))) {
  const res = await fetch(`${base}/api/favicons/${encodeURIComponent(host)}`, { headers: { Cookie: cookie } });
  const type = (res.headers.get('content-type') ?? '').split(';')[0];
  if (!res.ok || !ext[type]) continue;
  const name = `${host}.${ext[type]}`;
  writeFileSync(join(project, 'src/assets/favicons', name), Buffer.from(await res.arrayBuffer()));
  favicons[host] = `src/assets/favicons/${name}`;
}

// Two tokens with real shapes; the list shows hints only.
let { items: tokens } = await api('GET', '/tokens');
for (const name of ['iPhone 快捷指令', 'Raycast']) {
  if (!tokens.some((t) => t.name === name)) await api('POST', '/tokens', { name });
}
({ items: tokens } = await api('GET', '/tokens'));

const capturedAt = new Date().toISOString();
let data = JSON.stringify({ capturedAt, config, overview, links, total, stats, texts, tokens, favicons }, null, 1);
const origin = new URL(base);
data = data
  .replaceAll(`http://localhost:${origin.port}`, 'https://files.example.com')
  .replaceAll(`http://127.0.0.1:${origin.port}`, 'https://s.example.com')
  .replaceAll(`127.0.0.1:${origin.port}`, 's.example.com')
  .replaceAll(/"timezone": "[^"]*"/g, '"timezone": "Asia/Shanghai"');

writeFileSync(
  join(project, 'src/fixtures.js'),
  `/* Captured by tools/capture.mjs from a seeded instance (scripts/seed) at ${capturedAt}. */\n` +
    `window.SANI_FIXTURES = ${data};\n`,
);
console.log(`captured ${links.length} links, ${tokens.length} tokens at ${capturedAt}`);
