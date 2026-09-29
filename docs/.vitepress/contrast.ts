import { readFileSync } from 'node:fs';
import type { MarkdownOptions } from 'vitepress';

type Transformer = NonNullable<MarkdownOptions['codeTransformers']>[number];
type RGB = [number, number, number];

/**
 * Keeps the syntax colors readable. Vitesse is a quiet theme, and several of
 * its token colors (comments in particular) fall below WCAG AA on the code
 * block background. Rather than hand-picking replacements, each color that
 * falls short is darkened (light theme) or lightened (dark theme) in OKLab,
 * keeping its hue, until it reaches the contrast ratio.
 *
 * The backgrounds are read from style.css, so the check follows the tokens.
 */
export function readableTokens(min = 4.6): Transformer {
  const css = readFileSync(new URL('./theme/style.css', import.meta.url), 'utf8');
  // The first --sn-canvas is in :root, the second in .dark.
  const canvas = [...css.matchAll(/--sn-canvas:\s*(#[0-9a-f]{6});/gi)].map((m) => parse(m[1]));
  if (canvas.length !== 2) throw new Error('contrast.ts: expected --sn-canvas in :root and .dark of style.css');
  const bg = { light: canvas[0], dark: canvas[1] };

  const memo = new Map<string, string>();
  const readable = (theme: 'light' | 'dark', color: string) => {
    const key = theme + color;
    let out = memo.get(key);
    if (!out) memo.set(key, (out = adjust(parse(color, bg[theme]), bg[theme], min, theme === 'dark')));
    return out;
  };

  return {
    name: 'sani:readable-tokens',
    span(node) {
      const style = node.properties.style;
      if (typeof style !== 'string') return;
      node.properties.style = style.replace(
        /--shiki-(light|dark):(#[0-9a-f]{3,8})/gi,
        (_, theme: 'light' | 'dark', color: string) => `--shiki-${theme}:${readable(theme, color)}`,
      );
    },
  };
}

/** #rgb, #rgba, #rrggbb or #rrggbbaa, composited over bg when translucent. */
function parse(hex: string, bg: RGB = [1, 1, 1]): RGB {
  let h = hex.slice(1);
  if (h.length <= 4) h = [...h].map((c) => c + c).join('');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  const a = h.length === 8 ? n(6) : 1;
  return [0, 1, 2].map((i) => n(i * 2) * a + bg[i] * (1 - a)) as RGB;
}

function adjust(fg: RGB, bg: RGB, min: number, lighten: boolean): string {
  if (contrast(fg, bg) >= min) return hex(fg);
  const [L, a, b] = oklab(fg);
  for (let step = 1; step <= 100; step++) {
    const next = rgb([L + (lighten ? step : -step) * 0.005, a, b]);
    if (contrast(next, bg) >= min) return hex(next);
  }
  return lighten ? '#ffffff' : '#000000';
}

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function contrast(x: RGB, y: RGB) {
  const lum = ([r, g, b]: RGB) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

function oklab([r, g, b]: RGB): RGB {
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function rgb([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => gamma(Math.min(1, Math.max(0, c)))) as RGB;
}

const hex = (c: RGB) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
