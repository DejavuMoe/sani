import { describe, expect, it } from 'vitest';
import { displayParts, extractURL, looksLikeURL, sameSlug, slugProblem, stripScheme } from './url';

describe('looksLikeURL', () => {
  it('accepts what the server accepts', () => {
    for (const s of [
      'https://example.com',
      'http://localhost:3000/x',
      'example.com/path?q=1',
      'sub.example.co.uk',
      'localhost:8080',
      'mailto:me@example.com',
      'weixin://dl/business',
      'https://例子.中国/路径',
    ]) {
      expect(looksLikeURL(s), s).toBe(true);
    }
  });

  it('rejects prose and fragments', () => {
    for (const s of ['', 'hello', 'hello world', 'two words.com', 'not a url at all']) {
      expect(looksLikeURL(s), s).toBe(false);
    }
  });
});

describe('extractURL', () => {
  it('pulls the link out of shared text', () => {
    expect(extractURL('Look at this https://example.com/a?b=1 — neat')).toBe('https://example.com/a?b=1');
    expect(extractURL('这篇文章不错：https://mp.weixin.qq.com/s/abc，推荐')).toBe('https://mp.weixin.qq.com/s/abc');
    expect(extractURL('  example.com/x  ')).toBe('example.com/x');
    expect(extractURL('nothing here')).toBeNull();
  });
});

describe('displayParts', () => {
  it('splits host and path for display', () => {
    expect(displayParts('https://www.github.com/DejavuMoe/sani')).toEqual({ host: 'github.com', rest: '/DejavuMoe/sani' });
    expect(displayParts('https://example.com/')).toEqual({ host: 'example.com', rest: '' });
    expect(displayParts('https://example.com/%E6%90%9C%E7%B4%A2')).toEqual({ host: 'example.com', rest: '/搜索' });
    expect(displayParts('mailto:me@example.com')).toEqual({ host: '', rest: 'mailto:me@example.com' });
  });
});

describe('slugs', () => {
  it('mirrors the server rules', () => {
    expect(slugProblem('')).toBeNull();
    expect(slugProblem('gh')).toBeNull();
    expect(slugProblem('blog-2026')).toBeNull();
    expect(slugProblem('简历')).toBeNull();
    expect(slugProblem('-a')).toBe('invalid');
    expect(slugProblem('a b')).toBe('invalid');
    expect(slugProblem('end.')).toBe('invalid');
    expect(slugProblem('a'.repeat(65))).toBe('tooLong');
  });

  it('compares case- and composition-insensitively', () => {
    expect(sameSlug('GitHub', 'github')).toBe(true);
    expect(sameSlug('café', 'café')).toBe(true);
    expect(sameSlug('a', 'b')).toBe(false);
  });

  it('strips the scheme for display', () => {
    expect(stripScheme('https://s.example.com/abc')).toBe('s.example.com/abc');
  });
});
