// The deploy page's configuration builder edits copies of the repository's
// real files (compose.yaml, deploy/sani.service, deploy/Caddyfile,
// deploy/nginx.conf) instead of keeping templates of its own. The sync check
// runs these functions on the actual files, so a line they rely on cannot
// disappear unnoticed.

export interface BuilderInput {
  domain: string; // "s.example.com"
  tz: string; // "Asia/Shanghai"
  password: string; // "" keeps the first-run setup code
  rootRedirect: string; // "" keeps the admin app on "/"
}

export interface Built {
  text: string;
  /** Zero-based lines of `text` that carry the reader's input. */
  filled: number[];
}

/** The domain the example files use. */
export const EXAMPLE_DOMAIN = 's.example.com';

/** Returned by a rule in place of a line it leaves as it is. */
const KEEP = Symbol('keep');

/**
 * A rule rewrites the first line it matches into one or more lines. The lines
 * it returns carry the reader's input and are highlighted, even when they
 * happen to match the file; KEEP stands for the original line.
 */
type Rule = [RegExp, (m: RegExpExecArray) => (string | typeof KEEP)[]];

function edit(src: string, rules: Rule[], file: string): Built {
  const lines = src.replace(/\n$/, '').split('\n');
  const replaced = new Map<number, (string | typeof KEEP)[]>();
  for (const [re, replace] of rules) {
    const i = lines.findIndex((l) => re.test(l));
    if (i < 0) throw new Error(`${file}: no line matches ${re}`);
    replaced.set(i, replace(re.exec(lines[i])!));
  }
  const out: string[] = [];
  const filled: number[] = [];
  lines.forEach((line, i) => {
    for (const next of replaced.get(i) ?? [KEEP]) {
      if (next !== KEEP) filled.push(out.length);
      out.push(next === KEEP ? line : next);
    }
  });
  return { text: out.join('\n') + '\n', filled };
}

export function buildCompose(src: string, o: BuilderInput): Built {
  return edit(
    src,
    [
      [/^(\s*TZ: )\S+(.*)$/, (m) => [m[1] + o.tz + m[2]]],
      [/^(\s*SANI_BASE_URL: )\S+(.*)$/, (m) => [`${m[1]}https://${o.domain}${m[2]}`]],
      [
        /^(\s*)# (SANI_PASSWORD: )\S+ #.*$/,
        (m) => [o.password ? `${m[1]}${m[2]}"${o.password}" # fixed; no setup code needed` : KEEP],
      ],
      [/^(\s*)# (SANI_ROOT_REDIRECT: )\S+( #.*)$/, (m) => [o.rootRedirect ? m[1] + m[2] + o.rootRedirect + m[3] : KEEP]],
    ],
    'compose.yaml',
  );
}

// systemd expands %-specifiers in Environment=, so a literal % is written %%.
const unit = (v: string) => v.replaceAll('%', '%%');

export function buildService(src: string, o: BuilderInput): Built {
  return edit(
    src,
    [
      [/^(Environment=TZ=)\S+$/, (m) => [m[1] + o.tz]],
      [/^# (Environment=SANI_BASE_URL=)\S+$/, (m) => [`${m[1]}https://${o.domain}`]],
      [
        /^Environment=SANI_TRUST_PROXY=true$/,
        () => [
          KEEP,
          ...(o.password ? [`Environment=SANI_PASSWORD=${unit(o.password)}`] : []),
          ...(o.rootRedirect ? [`Environment=SANI_ROOT_REDIRECT=${unit(o.rootRedirect)}`] : []),
        ],
      ],
    ],
    'deploy/sani.service',
  );
}

/** Caddyfile and nginx.conf only need the domain swapped. */
export function buildProxy(src: string, o: BuilderInput, file: string): Built {
  if (!src.includes(EXAMPLE_DOMAIN)) throw new Error(`${file}: ${EXAMPLE_DOMAIN} not found`);
  const out: string[] = [];
  const filled: number[] = [];
  src
    .replace(/\n$/, '')
    .split('\n')
    .forEach((line, i) => {
      if (line.includes(EXAMPLE_DOMAIN)) filled.push(i);
      out.push(line.replaceAll(EXAMPLE_DOMAIN, o.domain));
    });
  return { text: out.join('\n') + '\n', filled };
}
