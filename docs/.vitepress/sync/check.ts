// Compares the documentation with the source tree and fails loudly when they
// disagree. Runs before every docs build and in `make check`:
//
//   node docs/.vitepress/sync/check.ts
//
// The progress page shows the same results, so readers can see what is
// verified rather than take it on trust.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { benchmark } from '../data/benchmark.ts';
import { groups } from '../pages.ts';
import { buildCompose, buildProxy, buildService, type BuilderInput } from './builder.ts';
import { apiRoutes, commands, docsRoot, envVars, errorCodes, read, release, reservedSlugs } from './source.ts';

export interface Check {
  id: 'pages' | 'config' | 'readme' | 'api' | 'errors' | 'cli' | 'reserved' | 'benchmark' | 'builder' | 'release' | 'assets';
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
  const lines = md.split('\n');
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
  const input: BuilderInput = {
    domain: 'go.example.org',
    tz: 'Europe/Berlin',
    password: 'x'.repeat(20),
    rootRedirect: 'https://example.org',
    filesDomain: 'files.example.org',
  };
  const runs: [string, () => { filled: number[] }, number][] = [
    ['compose.yaml', () => buildCompose(read('compose.yaml'), input), 5],
    ['deploy/sani.service', () => buildService(read('deploy/sani.service'), input), 5],
    ['deploy/Caddyfile', () => buildProxy(read('deploy/Caddyfile'), input, 'deploy/Caddyfile'), 1],
    ['deploy/nginx.conf', () => buildProxy(read('deploy/nginx.conf'), input, 'deploy/nginx.conf'), 1],
  ];
  for (const [file, run, least] of runs) {
    try {
      const { filled } = run();
      if (filled.length < least) problems.push(`${file}: the builder filled in ${filled.length} lines, expected at least ${least}`);
    } catch (e) {
      problems.push((e as Error).message);
    }
  }
  return { id: 'builder', count: runs.length, problems };
}

/**
 * The deploy page names every archive and image platform a release publishes,
 * and nothing it doesn't; compose.yaml uses the image the release pushes.
 */
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
  return { id: 'release', count: archives.length + platforms.length + 1, problems };
}

function checkAssets(): Check {
  const same = read('web/public/favicon.svg') === readFileSync(join(docsRoot, 'public/favicon.svg'), 'utf8');
  return { id: 'assets', count: 1, problems: same ? [] : ['docs/public/favicon.svg differs from web/public/favicon.svg'] };
}

export function runChecks(): Check[] {
  const checks = [checkPages, checkConfig, checkReadme, checkApi, checkErrors, checkCli, checkReserved, checkBenchmark, checkBuilder, checkRelease, checkAssets];
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
