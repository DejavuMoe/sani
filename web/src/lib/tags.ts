import type { TagColor } from './api';

export const TAG_LIMIT = 5;
export const TAG_NAME_LIMIT = 24;

export const tagKey = (name: string) => name.trim().normalize('NFC').toLowerCase();

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

const legacyColors: Record<string, string> = { blue: '#5872a5', green: '#56877e', amber: '#b18b54', rose: '#a96f89', neutral: '#808481' };
export const tagHex = (color: string) => legacyColors[color] ?? normalizeTagColor(color) ?? '#808481';
export const TAG_COLORS = [
  ['#5872a5', 'tags.presetBlue'],
  ['#588c98', 'tags.presetCyan'],
  ['#56877e', 'tags.presetTeal'],
  ['#74896a', 'tags.presetSage'],
  ['#91885d', 'tags.presetOlive'],
  ['#b18b54', 'tags.presetOchre'],
  ['#b17c5e', 'tags.presetTerracotta'],
  ['#ad7070', 'tags.presetBrick'],
  ['#a96f89', 'tags.presetRose'],
  ['#9679a5', 'tags.presetMauve'],
  ['#797ba1', 'tags.presetIris'],
  ['#808481', 'tags.presetStone'],
] as const;
