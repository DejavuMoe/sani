// Compares the documentation with the source tree and fails loudly when they
// disagree. Runs before every docs build and in `make check`:
//
//   node docs/.vitepress/sync/check.ts
//
// The progress page shows the same results, so readers can see what is
// verified rather than take it on trust.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { benchmark } from '../data/benchmark.ts';
import { groups } from '../pages.ts';
import { buildCompose, buildProxy, buildService, type BuilderInput, type Built } from './builder.ts';
import { apiRoutes, commands, docsRoot, envVars, errorCodes, latestVersion, read, release, reservedSlugs } from './source.ts';

export interface Check {
  id: 'pages' | 'config' | 'readme' | 'api' | 'errors' | 'cli' | 'reserved' | 'benchmark' | 'builder' | 'release' | 'assets' | 'behavior';
  /** How many facts were compared. */
  count: number;
  problems: string[];
}

const locales = [
  { lang: 'zh', dir: '' },
  { lang: 'en', dir: 'en/' },
] as const;

const doc = (dir: string, path: string) => readFileSync(join(docsRoot, `${dir}${path}.md`), 'utf8');

const codeSpans = (cell: string) => [...cell.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

/** Markdown table rows as trimmed cells, header and divider rows excluded. */
function tableRows(md: string): string[][] {
  return md
    .split('\n')
    .filter((l) => l.startsWith('|') && !/^\|\s*:?-{3,}/.test(l))
    .map((l) => l.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim()));
}

/** The text of a section, from its heading to the next heading of any level. */
function section(md: string, heading: RegExp): string | undefined {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return undefined;
  const end = lines.findIndex((l, i) => i > start && /^#{1,6} /.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

function diff(label: string, documented: Iterable<string>, actual: Iterable<string>): string[] {
  const doc = new Set(documented);
  const src = new Set(actual);
  return [
    ...[...src].filter((x) => !doc.has(x)).map((x) => `${label}: ${x} is missing`),
    ...[...doc].filter((x) => !src.has(x)).map((x) => `${label}: ${x} is documented but does not exist`),
  ];
}

/** Every page of the sidebar exists in both languages, and nothing else does. */
function checkPages(): Check {
  const problems: string[] = [];
  const listed = new Set(groups.flatMap((g) => g.pages.map((p) => p.path)));
  for (const { dir } of locales) {
    for (const path of listed) {
      if (!existsSync(join(docsRoot, `${dir}${path}.md`))) problems.push(`${dir}${path}.md is missing`);
    }
  }
  const walk = (dir: string): string[] =>
    readdirSync(join(docsRoot, dir)).flatMap((name) => {
      const rel = dir ? `${dir}/${name}` : name;
      if (name.startsWith('.') || name === 'node_modules' || name === 'public' || name === 'scripts') return [];
      return statSync(join(docsRoot, rel)).isDirectory() ? walk(rel) : rel.endsWith('.md') ? [rel] : [];
    });
  for (const file of walk('')) {
    const path = file.replace(/^en\//, '').replace(/\.md$/, '');
    if (path !== 'index' && !listed.has(path)) problems.push(`${file} is not in the sidebar (.vitepress/pages.ts)`);
  }
  return { id: 'pages', count: listed.size, problems };
}

/**
 * Configuration tables: rows whose first cell names SANI_* variables and
 * whose second cell gives their defaults, as `code` or a word when there is
 * no fixed default. "`A` / `B`" rows describe two variables at once.
 */
function checkConfigTable(file: string, md: string, problems: string[]): Set<string> {
  const vars = new Map(envVars().map((v) => [v.name, v]));
  const seen = new Set<string>();
  for (const cells of tableRows(md)) {
    const names = codeSpans(cells[0] ?? '').filter((n) => n.startsWith('SANI_'));
    if (!names.length) continue;
    const defaults = cells[1]?.split(' / ') ?? [];
    names.forEach((name, i) => {
      seen.add(name);
      const v = vars.get(name);
      if (!v) return;
      const cell = defaults[i]?.trim() ?? '';
      const code = /^`([^`]*)`$/.exec(cell)?.[1];
      if (v.default === '' && code !== undefined) problems.push(`${file}: ${name} has no default, but the table says \`${code}\``);
      if (v.default !== '' && code !== v.default) problems.push(`${file}: ${name} defaults to \`${v.default}\`, not ${cell || 'nothing'}`);
    });
  }
  for (const d of diff(file, seen, vars.keys())) problems.push(d);
  return seen;
}

function checkConfig(): Check {
  const problems: string[] = [];
  const vars = envVars();
  for (const { dir } of locales) {
    const file = `${dir}reference/configuration.md`;
    const md = doc(dir, 'reference/configuration');
    checkConfigTable(file, md, problems);
    const headed = [...md.matchAll(/^### `(SANI_\w+)`/gm)].map((m) => m[1]);
    problems.push(...diff(`${file} sections`, headed, vars.map((v) => v.name)));
    for (const v of vars) {
      if (v.min === undefined) continue;
      const text = section(md, new RegExp(`^### \`${v.name}\``))?.replace(/[,\s]/g, '') ?? '';
      for (const n of [v.min, v.max]) {
        if (!text.includes(String(n))) problems.push(`${file}: the ${v.name} section should give the range ${v.min}–${v.max}`);
      }
    }
  }
  return { id: 'config', count: vars.length, problems };
}

function checkReadme(): Check {
  const problems: string[] = [];
  for (const file of ['README.md', 'README.zh-CN.md']) checkConfigTable(file, read(file), problems);
  return { id: 'readme', count: 2, problems };
}

function checkApi(): Check {
  const problems: string[] = [];
  const routes = apiRoutes();
  for (const { dir } of locales) {
    const file = `${dir}reference/api.md`;
    const md = doc(dir, 'reference/api');
    const lines = [...md.matchAll(/^`([A-Z]+ \/api\/[^`]*)`$/gm)].map((m) => m[1]);
    problems.push(...diff(`${file} endpoints`, lines, routes));
    const indexed = tableRows(md)
      .filter((c) => /^`[A-Z]+`$/.test(c[0] ?? '') && /^`\/api\//.test(c[1] ?? ''))
      .map((c) => `${codeSpans(c[0])[0]} ${codeSpans(c[1])[0]}`);
    problems.push(...diff(`${file} index table`, indexed, routes));
  }
  return { id: 'api', count: routes.length, problems };
}

function checkErrors(): Check {
  const problems: string[] = [];
  const codes = errorCodes();
  for (const { dir } of locales) {
    const file = `${dir}reference/api.md`;
    const table = section(doc(dir, 'reference/api'), /^## .*\{#errors\}$/);
    if (!table) {
      problems.push(`${file}: no section with {#errors}`);
      continue;
    }
    const rows = tableRows(table).filter((c) => /^`[a-z_]+`$/.test(c[0] ?? ''));
    problems.push(...diff(`${file} error codes`, rows.map((c) => codeSpans(c[0])[0]), codes.keys()));
    for (const c of rows) {
      const code = codeSpans(c[0])[0];
      const want = [...(codes.get(code) ?? [])].sort().join(', ');
      const got = (c[1] ?? '').split(/[,、/]\s*/).map((s) => s.trim()).sort().join(', ');
      if (codes.has(code) && want !== got) problems.push(`${file}: ${code} answers ${want}, not ${c[1]}`);
    }
  }
  return { id: 'errors', count: codes.size, problems };
}

function checkCli(): Check {
  const problems: string[] = [];
  const cmds = commands();
  for (const { dir } of locales) {
    const md = doc(dir, 'reference/cli');
    const documented = [...md.matchAll(/^#{2,3} `sani (\w+)/gm)].map((m) => m[1]);
    problems.push(...diff(`${dir}reference/cli.md`, documented, cmds));
  }
  return { id: 'cli', count: cmds.length, problems };
}

function checkReserved(): Check {
  const problems: string[] = [];
  const slugs = reservedSlugs();
  for (const { dir } of locales) {
    const md = doc(dir, 'guide/usage');
    for (const s of slugs) if (!md.includes(`\`${s}\``)) problems.push(`${dir}guide/usage.md: reserved slug \`${s}\` is not listed`);
  }
  return { id: 'reserved', count: slugs.length, problems };
}

/** The README performance tables quote docs/.vitepress/data/benchmark.ts. */
function checkBenchmark(): Check {
  const problems: string[] = [];
  const n = (x: number) => x.toLocaleString('en-US');
  const ms = (x: number) => `${x.toFixed(2)} ms`;
  const facts = [
    ...benchmark.runs.flatMap((r) => [n(r.rps), ms(r.p50), ms(r.p99)]),
    n(benchmark.clicks.served),
    n(benchmark.clicks.counted),
  ];
  for (const file of ['README.md', 'README.zh-CN.md']) {
    const md = read(file);
    for (const f of facts) if (!md.includes(f)) problems.push(`${file}: expected ${f} from the latest benchmark`);
  }
  return { id: 'benchmark', count: facts.length, problems };
}

function checkBuilder(): Check {
  const problems: string[] = [];
  const compose = read('compose.yaml');
  for (const line of ['type: bind', 'source: ./sani-data', 'target: /data', 'create_host_path: false']) {
    if (!compose.includes(line)) problems.push(`compose.yaml: missing ${line}`);
  }
  if (/^volumes:/m.test(compose)) problems.push('compose.yaml: default must not create named volumes');
  for (const file of ['README.md', 'README.zh-CN.md',
    'docs/.vitepress/theme/components/HomePage.vue', 'docs/.vitepress/theme/components/ConfigBuilder.vue',
    ...locales.flatMap(({ dir }) => [`docs/${dir}guide/deploy.md`, `docs/${dir}guide/quick-start.md`])]) {
    if (!read(file).includes('sudo install -d -m 750 -o 65532 -g 65532 ./sani-data')) {
      problems.push(`${file}: missing bind-directory permission initialization`);
    }
  }
  // Include hosts containing the template names: replacements must not cascade.
  const domains = [
    ['go.example.org', 'files.example.org'],
    ['example.com', ''],
    ['example.com', 'f.example.com'],
    ['example.com', 's.example.com'],
    ['example.com', 'files.example.com'],
    ['f.example.com', 's.example.com'],
    ['links.s.example.com', 'files.f.example.com'],
  ];
  for (const [domain, filesDomain] of domains) {
    const input: BuilderInput = { domain, filesDomain, tz: 'Europe/Berlin', password: 'x'.repeat(20), rootRedirect: 'https://example.org' };
    const hosts = [domain, filesDomain].filter(Boolean);
    const runs: [string, () => Built, RegExp, string[]][] = [
      ['compose.yaml', () => buildCompose(read('compose.yaml'), input), /^\s*SANI_(?:BASE|FILES)_URL: .+$/gm,
        [`SANI_BASE_URL: https://${domain}`, ...(filesDomain ? [`SANI_FILES_URL: https://${filesDomain}`] : [])]],
      ['deploy/sani.service', () => buildService(read('deploy/sani.service'), input), /^Environment=SANI_(?:BASE|FILES)_URL=.+$/gm,
        [`Environment=SANI_BASE_URL=https://${domain}`, ...(filesDomain ? [`Environment=SANI_FILES_URL=https://${filesDomain}`] : [])]],
      ['deploy/Caddyfile', () => buildProxy(read('deploy/Caddyfile'), input, 'deploy/Caddyfile'), /^[^#\s].* \{$/gm,
        [`${hosts.join(', ')} {`]],
      ['deploy/nginx.conf', () => buildProxy(read('deploy/nginx.conf'), input, 'deploy/nginx.conf'), /^\s*(?:server_name|ssl_certificate|ssl_certificate_key) .+;$/gm,
        [`server_name ${hosts.join(' ')};`, `server_name ${hosts.join(' ')};`,
          `ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;`, `ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;`]],
    ];
    for (const [file, run, pattern, expected] of runs) {
      try {
        const { text } = run();
        const actual = (text.match(pattern) ?? []).map(line => line.replace(/\s+#.*$/, '').trim().replace(/\s+/g, ' '));
        assert.deepEqual(actual.sort(), expected.sort());
      } catch (e) {
        problems.push(`${file} (${domain}, ${filesDomain || 'no files domain'}): ${(e as Error).message}`);
      }
    }
  }
  return { id: 'builder', count: domains.length * 4, problems };
}

/**
 * The deploy page names every archive and image platform a release publishes,
 * and nothing it doesn't; compose.yaml uses the image the release pushes.
 */
export function imageTagProblems(compose: string, workflow: string): string[] {
  const problems: string[] = [];
  if (!/^\s+image: ghcr\.io\/dejavumoe\/sani:v\d+\.\d+\.\d+(?:-[\w.-]+)?\s*$/m.test(compose)) {
    problems.push('compose.yaml: pin a full vX.Y.Z image tag');
  }
  if (!workflow.includes('type=raw,value=${{ github.ref_name }}') || workflow.includes('type=semver') || !workflow.includes('flavor: latest=false')) {
    problems.push('release.yml: publish the exact Git tag without floating aliases');
  }
  return problems;
}

function checkRelease(): Check {
  const problems: string[] = [];
  const { image, archives, platforms } = release();
  const quoted = (s: string) => '`' + s + '`';
  for (const { dir } of locales) {
    const file = `${dir}guide/deploy.md`;
    const md = doc(dir, 'guide/deploy');
    for (const a of archives) if (!md.includes(quoted(a))) problems.push(`${file}: the archive ${a} is not listed`);
    for (const p of platforms) if (!md.includes(quoted(p))) problems.push(`${file}: the image platform ${p} is not listed`);
    const listed = new Set([...md.matchAll(/`(sani-[a-z0-9]+-[a-z0-9]+\.(?:tar\.gz|zip))`/g)].map((m) => m[1]));
    for (const a of listed) if (!archives.includes(a)) problems.push(`${file}: ${a} is not built by scripts/dist.sh`);
  }
  const composeImage = /^\s+image: (\S+?)(:\S+)?(\s|$)/m.exec(read('compose.yaml'))?.[1];
  if (composeImage !== image) problems.push(`compose.yaml: the image is ${composeImage}, but releases push ${image}`);
  problems.push(...imageTagProblems(read('compose.yaml'), read('.github/workflows/release.yml')));
  const pin = /^\s+image: (\S+)/m.exec(read('compose.yaml'))?.[1];
  for (const file of ['README.md', 'README.zh-CN.md', 'SECURITY.md', ...locales.flatMap(({ dir }) => [`docs/${dir}guide/deploy.md`, `docs/${dir}guide/quick-start.md`])]) {
    for (const match of read(file).matchAll(/ghcr\.io\/dejavumoe\/sani:[\w.-]+/g)) {
      if (match[0] !== pin) problems.push(`${file}: ${match[0]} differs from compose.yaml's ${pin}`);
    }
    if (/docker (?:run|pull)[^\n]*ghcr\.io\/dejavumoe\/sani(?:\s|$)/m.test(read(file))) {
      problems.push(`${file}: Docker command implicitly uses latest`);
    }
  }

  const zh = [...doc('', 'project/changelog').matchAll(/^## (v\S+)/gm)].map(m => m[1]);
  const en = [...doc('en/', 'project/changelog').matchAll(/^## (v\S+)/gm)].map(m => m[1]);
  if (JSON.stringify(zh) !== JSON.stringify(en)) problems.push('bilingual changelog release headings differ');
  if (latestVersion() === 'dev') problems.push('no release heading in the changelog');
  for (const { dir } of locales) {
    if (!doc(dir, 'project/progress').includes('{{ status.latestVersion }}')) problems.push(`${dir}project/progress.md must use the shared release version`);
  }
  if (read('docs/.vitepress/config.ts').includes('/edit/main/')) problems.push('docs edit links still target the retired main branch');
  return { id: 'release', count: archives.length + platforms.length + 1, problems };
}

/** Guard the specific promises that previously drifted; this is not a
 * substitute for reviewing prose against behavior tests. */
export function behaviorProblems(statistics: string, operations: string, interval: number, downloads: number): string[] {
  const problems: string[] = [];
  if (!new RegExp(`(?:每 ?${interval} 秒|every ${interval} seconds)`).test(statistics)) problems.push('statistics: flush interval differs from source');
  if (!new RegExp(`\\b${downloads}\\b`).test(statistics)) problems.push('statistics: concurrent download bound differs from source');
  for (const status of ['200', '206', '304', '412', '416']) {
    if (!statistics.includes('`' + status + '`')) problems.push(`statistics: missing content/conditional status ${status}`);
  }
  if (/最多丢失最后(?:这)?\s*2\s*秒|at most the last 2 seconds/i.test(statistics + operations)) problems.push('durability: the two-second loss guarantee is false');
  if (/之后复制的目录里，一定有|a copy taken after the database has every file/i.test(operations)) problems.push('backup: online copy order does not guarantee referenced files');
  if (!operations.includes('synchronous=NORMAL')) problems.push('operations: explain WAL/NORMAL durability');
  return problems;
}

function checkBehavior(): Check {
  const interval = Number(/rec\.Run\(bg, (\d+)\*time.Second/.exec(read('cmd/sani/main.go'))?.[1]);
  const downloads = Number(/const maxDownloads = (\d+)/.exec(read('internal/server/share.go'))?.[1]);
  if (!interval || !downloads) throw new Error('cannot extract counting limits from source');
  const problems = locales.flatMap(({ dir }) => behaviorProblems(doc(dir, 'guide/statistics'), doc(dir, 'guide/operations'), interval, downloads).map(p => dir + p));
  return { id: 'behavior', count: 10, problems };
}

function checkAssets(): Check {
  const same = read('web/public/favicon.svg') === readFileSync(join(docsRoot, 'public/favicon.svg'), 'utf8');
  return { id: 'assets', count: 1, problems: same ? [] : ['docs/public/favicon.svg differs from web/public/favicon.svg'] };
}

export function runChecks(): Check[] {
  const checks = [checkPages, checkConfig, checkReadme, checkApi, checkErrors, checkCli, checkReserved, checkBenchmark, checkBuilder, checkRelease, checkAssets, checkBehavior];
  return checks.map((check) => {
    try {
      return check();
    } catch (e) {
      return { id: check.name.replace(/^check/, '').toLowerCase() as Check['id'], count: 0, problems: [(e as Error).message] };
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const results = runChecks();
  const failed = results.filter((r) => r.problems.length);
  console.log(`docs sync check (${relative(process.cwd(), docsRoot) || '.'})`);
  for (const r of results) {
    console.log(`  ${r.problems.length ? '✗' : '✓'} ${r.id.padEnd(10)} ${r.count} compared`);
    for (const p of r.problems) console.log(`      ${p}`);
  }
  if (failed.length) {
    console.error(`\n${failed.length} check(s) failed: update the docs or the source so they agree.`);
    process.exit(1);
  }
}
