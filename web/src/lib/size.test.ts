import { describe, expect, it } from 'vitest';
import { byteLength, formatSize } from './size';

describe('formatSize', () => {
  it('matches the visitor page', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(1023)).toBe('1023 B');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(64 << 20)).toBe('64 MB');
    expect(formatSize(5 * 1024 ** 3)).toBe('5.0 GB');
  });
});

describe('byteLength', () => {
  it('counts UTF-8 bytes like the server limit does', () => {
    expect(byteLength('abc')).toBe(3);
    expect(byteLength('文本')).toBe(6);
    expect(byteLength('😀')).toBe(4);
  });
});
