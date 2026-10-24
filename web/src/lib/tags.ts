import type { TagColor } from './api';
import { lookupKey } from './key';

export const TAG_LIMIT = 5;
export const TAG_NAME_LIMIT = 24;

export const tagKey = (name: string) => lookupKey(name.trim());

export function normalizeTagColor(input: string): TagColor | null {
  const value = input.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) return value as TagColor;
  if (/^#[0-9a-f]{3}$/.test(value)) return ('#' + [...value.slice(1)].map(c => c + c).join('')) as TagColor;
  const number = '(\\d+(?:\\.\\d+)?)';
  const rgb = value.match(new RegExp('^rgb\\(\\s*' + number + '\\s*,\\s*' + number + '\\s*,\\s*' + number + '\\s*\\)$'));
  let channels: number[];
  if (rgb) {
    channels = rgb.slice(1).map(Number);
    if (channels.some(n => n > 255)) return null;
  } else {
    const hsl = value.match(new RegExp('^hsl\\(\\s*' + number + '(?:deg)?\\s*,\\s*' + number + '%\\s*,\\s*' + number + '%\\s*\\)$'));
    if (!hsl) return null;
    const [h, s, l] = hsl.slice(1).map(Number);
    if (h > 360 || s > 100 || l > 100) return null;
    const light = l / 100, a = s / 100 * Math.min(light, 1 - light);
    channels = [0, 8, 4].map(n => {
      const k = (n + h / 30) % 12;
      return 255 * (light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    });
  }
  return ('#' + channels.map(n => Math.round(n).toString(16).padStart(2, '0')).join('')) as TagColor;
}

// The five named colors from before custom colors map to Radix step 9;
// saved hex values show as saved.
const legacyColors: Record<string, string> = { blue: '#0090ff', green: '#12a594', amber: '#ffc53d', rose: '#d6409f', neutral: '#8b8d98' };
export const tagHex = (color: string) => legacyColors[color] ?? normalizeTagColor(color) ?? '#8b8d98';
/** Presets are Radix Colors step 9, the scale's solid swatch. */
export const TAG_COLORS = [
  ['#0090ff', 'tags.presetBlue'],
  ['#00a2c7', 'tags.presetCyan'],
  ['#12a594', 'tags.presetTeal'],
  ['#46a758', 'tags.presetGrass'],
  ['#ffc53d', 'tags.presetAmber'],
  ['#f76b15', 'tags.presetOrange'],
  ['#e54d2e', 'tags.presetTomato'],
  ['#e5484d', 'tags.presetRed'],
  ['#d6409f', 'tags.presetPink'],
  ['#8e4ec6', 'tags.presetPurple'],
  ['#3e63dd', 'tags.presetIndigo'],
  ['#8b8d98', 'tags.presetSlate'],
] as const;
