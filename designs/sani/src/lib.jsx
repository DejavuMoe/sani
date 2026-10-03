/*
 * Layer 0 — logic shared by every layer, ported from web/src/lib so that
 * strings, numbers, dates, URLs and sizes format exactly as in production.
 * Port map: i18n.svelte.ts, url.ts, size.ts, expiry.ts, keys.ts, qr.ts.
 */
const { createContext, useContext } = React;

const I18N = window.SANI_I18N;
const FIX = window.SANI_FIXTURES;

/* ---- environment: language, clock, origin ---- */

const EnvCtx = createContext({ lang: 'zh', now: Date.parse(FIX.capturedAt), host: 's.example.com' });

function readParams() {
  const p = new URLSearchParams(location.search);
  const now = p.get('now');
  return {
    theme: p.get('theme'),
    lang: p.get('lang'),
    now: now === 'live' ? Date.now() : now ? Date.parse(now) : Date.parse(FIX.capturedAt),
    host: p.get('host') || 's.example.com',
  };
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl';

function isTyping(target) {
  const el = target;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(el.type);
  return false;
}

const plainKey = (e) => !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target) && !e.defaultPrevented;
const modEnter = (e) => e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey);

/* ---- i18n ---- */

function makeI18n(lang, now) {
  const locale = lang === 'zh' ? 'zh-CN' : 'en';
  const dict = I18N[lang];
  const nf = new Intl.NumberFormat(locale);
  const formatNumber = (n) => nf.format(n);

  function t(key, params) {
    let s = dict[key];
    if (params && typeof params.n === 'number' && lang === 'en') s = dict[`${key}.${params.n === 1 ? 'one' : 'other'}`] ?? s;
    if (params && typeof params.n === 'number') params = { ...params, n: formatNumber(params.n) };
    s = s ?? key;
    return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : s;
  }

  const errorText = (code) => (`err.${code}` in I18N.zh ? t(`err.${code}`) : t('err.unknown'));

  const formatCompact = (n) =>
    n < 100000 ? formatNumber(n) : new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);

  function formatDate(iso, at = now) {
    const d = new Date(iso);
    const sameYear = d.getFullYear() === new Date(at).getFullYear();
    return d.toLocaleDateString(locale, { year: sameYear ? undefined : 'numeric', month: 'short', day: 'numeric' });
  }

  function formatDateTime(iso, at = now) {
    const d = new Date(iso);
    const sameYear = d.getFullYear() === new Date(at).getFullYear();
    return d.toLocaleString(locale, {
      year: sameYear ? undefined : 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const MIN = 60000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  function formatRelative(iso) {
    if (!iso) return '';
    const diff = Math.min(0, Date.parse(iso) - now);
    const abs = -diff;
    if (abs < 45000) return lang === 'zh' ? '刚刚' : 'just now';
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
    if (abs < HOUR) return rtf.format(Math.round(diff / MIN), 'minute');
    if (abs < DAY) return rtf.format(Math.round(diff / HOUR), 'hour');
    if (abs < 30 * DAY) return rtf.format(Math.round(diff / DAY), 'day');
    return formatDate(iso);
  }

  function formatDay(date, withWeekday = true) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
      weekday: withWeekday ? 'short' : undefined,
    });
  }

  const presetLabel = (p) => t(`expiry.${p}`);
  function expiryLabel(e) {
    if ('preset' in e) return presetLabel(e.preset);
    const d = new Date(e.at);
    return Number.isNaN(d.getTime()) ? t('expiry.custom') : t('expiry.until', { date: formatDateTime(d.toISOString()) });
  }

  return { lang, locale, now, t, errorText, formatNumber, formatCompact, formatDate, formatDateTime, formatRelative, formatDay, presetLabel, expiryLabel };
}

function useI18n() {
  const env = useContext(EnvCtx);
  return React.useMemo(() => ({ ...makeI18n(env.lang, env.now), host: env.host }), [env.lang, env.now, env.host]);
}

/* ---- urls, sizes, expiry ---- */

function looksLikeURL(raw) {
  const s = raw.trim();
  if (!s || /\s/.test(s) || s.length > 8192) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(s)) return true;
  if (/^(mailto|tel|sms|magnet|weixin|alipays?|itms-apps|tg|obsidian):\S+$/i.test(s)) return true;
  const host = s.split(/[/?#]/)[0].replace(/:\d+$/, '');
  return /^localhost$/i.test(host) || /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+$/u.test(host);
}

function extractURL(text) {
  const s = text.trim();
  if (looksLikeURL(s)) return s;
  const m = s.match(/https?:\/\/[^\s<>"'，。、）)]+/i);
  return m ? m[0] : null;
}

function displayParts(url) {
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

const stripScheme = (url) => url.replace(/^https?:\/\//i, '');
/** Host of the short domain, for prefixes like "s.example.com/" (session.origin in production). */
const shortHost = new URL(FIX.config.baseUrl).host;
const sameSlug = (a, b) => a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();
const slugPattern = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}_.-]*$/u;
function slugProblem(slug) {
  if (!slug) return null;
  if ([...slug].length > 64) return 'tooLong';
  if (!slugPattern.test(slug) || slug.endsWith('.')) return 'invalid';
  return null;
}
function hostHue(host) {
  let h = 0;
  for (let i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) >>> 0;
  return h % 360;
}

function formatSize(n) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  if (u === 0) return `${n} B`;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}
const mediaType = (type) => (type ?? '').split(';')[0].trim();
const byteLength = (s) => new TextEncoder().encode(s).length;

const presets = ['never', '1h', '1d', '7d', '30d'];
function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromISO = (iso) => (iso ? { at: toLocalInput(new Date(iso)) } : { preset: 'never' });

/* ---- QR (same encoder and path merge as lib/qr.ts) ---- */

function qr(text, border = 0) {
  const { data, size } = window.uqr.encode(text, { ecc: 'M', border });
  let path = '';
  for (let y = 0; y < size; y++) {
    const row = data[y];
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < size && row[x]) x++;
      path += `M${start} ${y}h${x - start}v1h${start - x}z`;
    }
  }
  return { size, path };
}

/* ---- toasts (lib/toast.svelte.ts) ---- */

function useToasts() {
  const [items, setItems] = React.useState([]);
  const timers = React.useRef(new Map());
  const seq = React.useRef(0);
  const api = React.useMemo(() => {
    const dismiss = (id) => {
      clearTimeout(timers.current.get(id));
      timers.current.delete(id);
      setItems((xs) => xs.filter((x) => x.id !== id));
    };
    const schedule = (toast, duration = toast.duration) => {
      clearTimeout(timers.current.get(toast.id));
      if (duration > 0) timers.current.set(toast.id, setTimeout(() => dismiss(toast.id), duration));
    };
    const show = (message, opts = {}) => {
      const toast = { id: ++seq.current, message, tone: 'neutral', duration: opts.action ? 6000 : 3200, ...opts };
      setItems((xs) => [...xs.slice(-2), toast]);
      schedule(toast);
      return toast.id;
    };
    return {
      show,
      success: (m, o = {}) => show(m, { ...o, tone: 'success' }),
      error: (m, o = {}) => show(m, { duration: 5000, ...o, tone: 'error' }),
      dismiss,
      pause: (id) => clearTimeout(timers.current.get(id)),
      resume: (id) => setItems((xs) => (xs.forEach((x) => x.id === id && schedule(x, Math.min(x.duration, 2500))), xs)),
    };
  }, []);
  return { items, ...api };
}

/** Classes from a list, skipping falsy entries (Svelte's class={[...]}). */
const cx = (...xs) => xs.flat().filter(Boolean).join(' ');

Object.assign(window, {
  EnvCtx,
  FIX,
  readParams,
  isMac,
  mod,
  isTyping,
  plainKey,
  modEnter,
  makeI18n,
  useI18n,
  looksLikeURL,
  extractURL,
  displayParts,
  stripScheme,
  shortHost,
  sameSlug,
  slugProblem,
  hostHue,
  formatSize,
  mediaType,
  byteLength,
  presets,
  toLocalInput,
  fromISO,
  qr,
  useToasts,
  cx,
});
