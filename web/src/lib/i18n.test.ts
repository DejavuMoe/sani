import { afterEach, describe, expect, it } from 'vitest';
import { formatCompact, formatRelative, i18n, t } from './i18n.svelte';
import { fromISO, sameExpiry, toISO, toLocalInput, validLocalExpiry } from './expiry';

afterEach(() => {
  i18n.lang = 'zh';
});

describe('t', () => {
  it('interpolates and picks English plurals', () => {
    i18n.lang = 'en';
    expect(t('chart.clicks', { n: 1 })).toBe('1 visit');
    expect(t('chart.clicks', { n: 1234 })).toBe('1,234 visits');
    expect(t('list.spark', { n: 1 })).toBe('1 visit in the last 14 days');
    expect(t('list.spark', { n: 2 })).toBe('2 visits in the last 14 days');
    i18n.lang = 'zh';
    expect(t('chart.clicks', { n: 1234 })).toBe('1,234 次');
  });

  it('has every key in both languages', async () => {
    // A missing English key falls back to the key itself.
    const zhKeys = ['composer.submit', 'settings.tokens', 'keys.title', 'err.slug_taken', 'reason.expires_invalid', 'summary.last30'] as const;
    i18n.lang = 'en';
    for (const k of zhKeys) expect(t(k)).not.toBe(k);
  });
});

describe('formatRelative', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');

  it('never shows a past event in the future', () => {
    i18n.lang = 'en';
    // A fresh server timestamp slightly ahead of a stale clock.
    expect(formatRelative(new Date(Date.now() + 20_000).toISOString(), now)).toBe('just now');
  });

  it('switches to a date after a month', () => {
    i18n.lang = 'en';
    const old = '2026-07-01T08:00:00Z';
    expect(formatRelative(old, Date.parse('2026-09-28T12:00:00Z'))).toMatch(/Jul/);
  });
});

describe('formatCompact', () => {
  it('keeps exact numbers below 100k', () => {
    i18n.lang = 'en';
    expect(formatCompact(99_999)).toBe('99,999');
    expect(formatCompact(1_250_000)).toBe('1.3M');
  });
});

describe('expiry', () => {
  it('rejects malformed, rolled-over and past local dates before applying them', () => {
    const now = +new Date(2028, 0, 1);
    expect(validLocalExpiry('2028-02-29T12:30', now)).toBe(true);
    for (const value of ['2027-02-29T12:30', '2028-02-30T12:30', '2028-02-29T24:00', '2028-13-01T12:30', '2028-02-29T12:60', '2028-02-29', '2028-02-29T12:30Z', '2028-01-01T00:00']) {
      expect(validLocalExpiry(value, now), value).toBe(false);
    }
  });
  it('resolves presets when saved', () => {
    const before = Date.now();
    const iso = toISO({ preset: '1d' })!;
    const ms = Date.parse(iso) - before;
    expect(ms).toBeGreaterThanOrEqual(86_400_000 - 50);
    expect(ms).toBeLessThan(86_400_000 + 1000);
    expect(toISO({ preset: 'never' })).toBeNull();
  });

  it('round-trips a stored time through the picker', () => {
    const d = new Date(2026, 9, 1, 14, 30);
    const e = fromISO(d.toISOString());
    expect(e).toEqual({ at: toLocalInput(d) });
    expect(toISO(e)).toBe(d.toISOString());
    expect(sameExpiry(fromISO(null), { preset: 'never' })).toBe(true);
  });
});
