import { describe, expect, it } from 'vitest';
import { normalizeTagColor, tagHex, TAG_COLORS } from './tags';

describe('tag colors', () => {
  it.each([
    ['#ABC', '#aabbcc'], [' #5872A5 ', '#5872a5'], ['rgb(88, 114, 165)', '#5872a5'],
    ['rgb(0,255,0)', '#00ff00'], ['hsl(0,100%,50%)', '#ff0000'], ['hsl(360deg,100%,50%)','#ff0000'],
    ['hsl(220, 30%, 50%)','#5973a6'], ['hsl(0,0%,100%)','#ffffff'],
  ])('normalizes %s', (input, expected) => expect(normalizeTagColor(input)).toBe(expected));
  it.each(['#abcd','#abcdef80','red','transparent','var(--color)','url(x)','rgb(256,0,0)','rgb(-1,0,0)','rgba(0,0,0,1)','hsl(361,0%,0%)','hsl(0,101%,0%)','hsl(0,0%,101%)','hsl(0 0% 0%)','rgb(Infinity,0,0)'])('rejects %s', input => expect(normalizeTagColor(input)).toBeNull());
  it('keeps legacy colors renderable and all presets valid', () => {
    expect(tagHex('blue')).toBe('#5872a5');
    expect(TAG_COLORS).toHaveLength(12);
    for (const [color] of TAG_COLORS) expect(normalizeTagColor(color)).toBe(color);
  });
});
