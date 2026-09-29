// Facts read straight from the source tree. The docs site renders some of
// them and the sync check compares the rest against the Markdown, so the
// documentation cannot quietly drift from the code.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const docsRoot = fileURLToPath(new URL('../../', import.meta.url));

export const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');
export const exists = (path: string) => existsSync(join(repoRoot, path));

function walk(dir: string, keep: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(repoRoot, dir))) {
    const rel = `${dir}/${name}`;
    if (name === 'node_modules' || name.startsWith('.')) continue;
    if (statSync(join(repoRoot, rel)).isDirectory()) out.push(...walk(rel, keep));
    else if (keep(rel)) out.push(rel);
  }
  return out;
}

const count = (text: string, re: RegExp) => text.match(re)?.length ?? 0;

export interface EnvVar {
  name: string;
  /** Default as the docs print it; "" when there is none. */
  default: string;
  min?: number;
  max?: number;
}

/** SANI_* variables, their defaults and ranges, from internal/config. */
export function envVars(): EnvVar[] {
  const src = read('internal/config/config.go');
  const vars = new Map<string, EnvVar>();
  const literal = (s: string) => {
    s = s.trim();
    if (s.startsWith('"')) return JSON.parse(s) as string;
    return /^[\d_]+$/.test(s) ? s.replace(/_/g, '') : s;
  };
  for (const m of src.matchAll(/\benv\("(SANI_\w+)",\s*("[^"]*")\)/g)) {
    vars.set(m[1], { name: m[1], default: literal(m[2]) });
  }
  for (const m of src.matchAll(/\benvBool\("(SANI_\w+)",\s*(true|false)\)/g)) {
    vars.set(m[1], { name: m[1], default: m[2] });
  }
  for (const m of src.matchAll(/\benvInt\("(SANI_\w+)",\s*([\d_]+),\s*([\d_]+),\s*([\d_]+)\)/g)) {
    vars.set(m[1], { name: m[1], default: literal(m[2]), min: +literal(m[3]), max: +literal(m[4]) });
  }
  for (const m of src.matchAll(/os\.Getenv\("(SANI_\w+)"\)/g)) {
    if (!vars.has(m[1])) vars.set(m[1], { name: m[1], default: '' });
  }
  return [...vars.values()];
}

/** "GET /api/links" and so on, as registered in internal/server/api.go. */
export function apiRoutes(): string[] {
  const src = read('internal/server/api.go');
  return [...src.matchAll(/mux\.Handle(?:Func)?\("([A-Z]+) (\/api\/[^"]*)"/g)].map((m) => `${m[1]} ${m[2]}`);
}

const httpStatus: Record<string, number> = {
  BadRequest: 400,
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  Conflict: 409,
  RequestEntityTooLarge: 413,
  TooManyRequests: 429,
  InternalServerError: 500,
};

/** Every error code the API can answer with, and its HTTP status. */
export function errorCodes(): Map<string, Set<number>> {
  const codes = new Map<string, Set<number>>();
  const add = (code: string, status: number | undefined) => {
    if (status === undefined) throw new Error(`unknown HTTP status for error code ${code}`);
    if (!codes.has(code)) codes.set(code, new Set());
    codes.get(code)!.add(status);
  };
  const files = walk('internal/server', (f) => f.endsWith('.go') && !f.endsWith('_test.go'));
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/writeError\(w, http\.Status(\w+), "([a-z_]+)"/g)) add(m[2], httpStatus[m[1]]);
    for (const m of src.matchAll(/writeJSON\(w, http\.Status(\w+), map\[string\]any\{\s*"error": apiError\{Code: "([a-z_]+)"/g)) {
      add(m[2], httpStatus[m[1]]);
    }
    for (const m of src.matchAll(/\bbadInput\("([a-z_]+)"/g)) add(m[1], 400);
    // Slug and URL rule violations reach the client through badInput.
    const table = /var linkErrors = map\[error\]string\{([^}]*)\}/.exec(src);
    if (table) for (const m of table[1].matchAll(/"([a-z_]+)"/g)) add(m[1], 400);
  }
  return codes;
}

/** Slugs the server answers itself, from internal/links. */
export function reservedSlugs(): string[] {
  const block = /var reserved = map\[string\]struct\{\}\{([^]*?)\n\}/.exec(read('internal/links/links.go'));
  return block ? [...block[1].matchAll(/"([^"]+)":/g)].map((m) => m[1]) : [];
}

/** The alphabet generated slugs use, and the schemes a link may not have. */
export function slugRules(): { alphabet: string; length: number; blockedSchemes: string[] } {
  const src = read('internal/links/links.go');
  const alphabet = /const alphabet = "([^"]+)"/.exec(src)?.[1];
  const blocked = /var blockedSchemes = map\[string\]struct\{\}\{([^]*?)\n\}/.exec(src);
  const length = envVars().find((v) => v.name === 'SANI_SLUG_LENGTH')?.default;
  if (!alphabet || !blocked || !length) throw new Error('slug rules not found in internal/links/links.go');
  return { alphabet, length: +length, blockedSchemes: [...blocked[1].matchAll(/"([^"]+)":/g)].map((m) => m[1]) };
}

export interface Release {
  image: string;
  /** Archive file names, such as sani-linux-amd64.tar.gz, from scripts/dist.sh. */
  archives: string[];
  /** Image platforms, such as linux/arm/v7, from the release workflow. */
  platforms: string[];
}

/** What a release publishes, from the script and the workflow that build it. */
export function release(): Release {
  const workflow = read('.github/workflows/release.yml');
  const image = /^ {2}IMAGE: (\S+)$/m.exec(workflow)?.[1];
  const platforms = /^\s+platforms: (\S+)$/m.exec(workflow)?.[1].split(',');
  const targets = /^targets=\(\n([^)]*)\)/m.exec(read('scripts/dist.sh'))?.[1].trim().split(/\s+/);
  if (!image || !platforms || !targets) throw new Error('release targets not found in scripts/dist.sh and .github/workflows/release.yml');
  const archives = targets.map((t) => {
    const [os, arch, arm] = t.split('/');
    return `sani-${os}-${arch}${arm ? `v${arm}` : ''}.${os === 'windows' ? 'zip' : 'tar.gz'}`;
  });
  return { image, archives, platforms };
}

/** Subcommands listed in the binary's own usage text. */
export function commands(): string[] {
  const usage = /const usage = `([^`]*)`/.exec(read('cmd/sani/main.go'))?.[1] ?? '';
  return [...usage.matchAll(/^ {2}sani (\w+)/gm)].map((m) => m[1]);
}

export interface Stats {
  goPackages: number;
  goTests: number;
  goBenchmarks: number;
  unitTests: number;
  e2eTests: number;
  apiRoutes: number;
  envVars: number;
  uiStrings: number;
  goLines: number;
  webLines: number;
}

/** Numbers about the project itself, counted rather than claimed. */
export function stats(): Stats {
  const goSrc = walk('internal', (f) => f.endsWith('.go')).concat(walk('cmd', (f) => f.endsWith('.go')));
  const goCode = goSrc.filter((f) => !f.endsWith('_test.go'));
  const goTests = goSrc.filter((f) => f.endsWith('_test.go')).map(read).join('\n');
  const web = walk('web/src', (f) => /\.(svelte|ts|css)$/.test(f) && !f.endsWith('.test.ts'));
  const unit = walk('web/src', (f) => f.endsWith('.test.ts')).map(read).join('\n');
  const e2e = walk('web/e2e', (f) => f.endsWith('.spec.ts')).map(read).join('\n');
  const lines = (files: string[]) => files.reduce((n, f) => n + read(f).split('\n').length, 0);
  return {
    goPackages: new Set(goCode.map((f) => f.slice(0, f.lastIndexOf('/')))).size,
    goTests: count(goTests, /^func Test\w*\(/gm),
    goBenchmarks: count(goTests, /^func Benchmark\w*\(/gm),
    unitTests: count(unit, /^\s*(?:it|test)\(/gm),
    e2eTests: count(e2e, /^test\(/gm),
    apiRoutes: apiRoutes().length,
    envVars: envVars().length,
    uiStrings: Object.keys(appStrings().zh).length,
    goLines: lines(goCode),
    webLines: lines(web),
  };
}

/** The admin app's own UI strings, so the docs quote its exact wording. */
export function appStrings(): { zh: Record<string, string>; en: Record<string, string> } {
  const src = read('web/src/lib/i18n.svelte.ts');
  const dict = (start: RegExp) => {
    const at = src.search(start);
    if (at < 0) throw new Error(`i18n dictionary not found: ${start}`);
    const body = src.slice(at, src.indexOf('\n};', at));
    const out: Record<string, string> = {};
    for (const m of body.matchAll(/^\s*'([\w.]+)':\s*'((?:[^'\\]|\\.)*)',?$/gm)) out[m[1]] = m[2].replace(/\\(.)/g, '$1');
    return out;
  };
  return { zh: dict(/^const zh = \{/m), en: dict(/^const en\b[^=]*= \{/m) };
}

export interface Versions {
  go: string;
  node: string;
  pnpm: string;
  sqlite: string;
  svelte: string;
  vite: string;
  typescript: string;
  vitepress: string;
}

/** Toolchain and key library versions, as pinned in the repository. */
export function versions(): Versions {
  const tool = (name: string) => new RegExp(`^${name} = "([^"]+)"`, 'm').exec(read('mise.toml'))?.[1] ?? '?';
  const catalog = read('pnpm-workspace.yaml');
  const pkg = (dir: string, name: string) => {
    const deps = JSON.parse(read(`${dir}/package.json`));
    let v: string = deps.dependencies?.[name] ?? deps.devDependencies?.[name] ?? '?';
    if (v === 'catalog:') v = new RegExp(`^\\s+'?${name.replace('/', '\\/')}'?: (\\S+)`, 'm').exec(catalog)?.[1] ?? '?';
    return v;
  };
  return {
    go: tool('go'),
    node: tool('node'),
    pnpm: tool('pnpm'),
    sqlite: /modernc\.org\/sqlite v(\S+)/.exec(read('go.mod'))?.[1] ?? '?',
    svelte: pkg('web', 'svelte'),
    vite: pkg('web', 'vite'),
    typescript: pkg('web', 'typescript'),
    vitepress: pkg('docs', 'vitepress'),
  };
}
