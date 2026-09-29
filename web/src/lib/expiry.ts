import { formatDateTime, t, type MessageKey } from './i18n.svelte';

export type Preset = 'never' | '1h' | '1d' | '7d' | '30d';

/** A preset is resolved when the link is saved, not when it was picked. */
export type Expiry = { preset: Preset } | { at: string /* datetime-local, local time */ };

const HOUR = 3_600_000;
const durations: Record<Exclude<Preset, 'never'>, number> = {
  '1h': HOUR,
  '1d': 24 * HOUR,
  '7d': 7 * 24 * HOUR,
  '30d': 30 * 24 * HOUR,
};

export const presets: Preset[] = ['never', '1h', '1d', '7d', '30d'];

export function presetLabel(p: Preset): string {
  return t(`expiry.${p}` as MessageKey);
}

export function toISO(e: Expiry): string | null {
  if ('preset' in e) return e.preset === 'never' ? null : new Date(Date.now() + durations[e.preset]).toISOString();
  const d = new Date(e.at);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** datetime-local wants "YYYY-MM-DDTHH:mm" in local time. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromISO(iso: string | null): Expiry {
  return iso ? { at: toLocalInput(new Date(iso)) } : { preset: 'never' };
}

export function expiryLabel(e: Expiry): string {
  if ('preset' in e) return presetLabel(e.preset);
  const d = new Date(e.at);
  return Number.isNaN(d.getTime()) ? t('expiry.custom') : t('expiry.until', { date: formatDateTime(d.toISOString()) });
}

export function sameExpiry(a: Expiry, b: Expiry): boolean {
  if ('preset' in a && 'preset' in b) return a.preset === b.preset;
  if ('at' in a && 'at' in b) return a.at === b.at;
  return false;
}
