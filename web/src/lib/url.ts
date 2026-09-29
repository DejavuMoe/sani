/** Mirrors the server's leniency: "example.com/a" is a URL, "hello" is not. */
export function looksLikeURL(raw: string): boolean {
  const s = raw.trim();
  if (!s || /\s/.test(s) || s.length > 8192) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(s)) return true;
  if (/^(mailto|tel|sms|magnet|weixin|alipays?|itms-apps|tg|obsidian):\S+$/i.test(s)) return true;
  const host = s.split(/[/?#]/)[0].replace(/:\d+$/, '');
  return /^localhost$/i.test(host) || /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+$/u.test(host);
}

/** First URL in a blob of shared text ("Look at this https://…"). */
export function extractURL(text: string): string | null {
  const s = text.trim();
  if (looksLikeURL(s)) return s;
  const m = s.match(/https?:\/\/[^\s<>"'，。、）)]+/i);
  return m ? m[0] : null;
}

/** Split a destination for display: host is emphasized, the rest recedes. */
export function displayParts(url: string): { host: string; rest: string } {
  const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)(.*)$/i);
  if (!m) return { host: '', rest: url };
  const host = m[1].replace(/^www\./i, '');
  let rest = m[2];
  try {
    rest = decodeURI(rest);
  } catch {
    /* keep encoded */
  }
  if (rest === '/') rest = '';
  return { host, rest };
}

/** "https://s.ice.dev/k3x9p" → "s.ice.dev/k3x9p" */
export function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//i, '');
}

/** Host of the short domain, for prefixes like "s.ice.dev/". */
export function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

export function sameSlug(a: string, b: string): boolean {
  return a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();
}

const slugPattern = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}_.-]*$/u;

export type SlugProblem = 'invalid' | 'tooLong' | null;

export function slugProblem(slug: string): SlugProblem {
  if (!slug) return null;
  if ([...slug].length > 64) return 'tooLong';
  if (!slugPattern.test(slug) || slug.endsWith('.')) return 'invalid';
  return null;
}

/** Deterministic hue for a host, used by the letter avatar when there is no icon. */
export function hostHue(host: string): number {
  let h = 0;
  for (let i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) >>> 0;
  return h % 360;
}
