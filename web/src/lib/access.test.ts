import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatePassword } from './access';

vi.mock('./i18n.svelte', () => ({ t: (key: string) => key }));
vi.mock('./toast.svelte', () => ({ toasts: {} }));

const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const prototype = readFileSync(new URL('../../../designs/sani/src/r11/access.jsx', import.meta.url), 'utf8');
const generatorSource = prototype.slice(prototype.indexOf('const PW_ALPHABET'), prototype.indexOf('function passwordProblem'));
const prototypePassword = (length = 6): string => runInNewContext(`${generatorSource}\ngenPassword(${length})`, { crypto });

afterEach(() => vi.restoreAllMocks());

describe.each([['production', generatePassword], ['prototype', prototypePassword]] as const)('%s passwords', (_, generate) => {
  it('maps complete byte cycles to equally frequent characters', () => {
    let next = 0;
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      const bytes = array as Uint8Array;
      for (let i = 0; i < bytes.length; i++) bytes[i] = next++ % 256;
      return array;
    });
    const password = generate(alphabet.length * 16);
    expect(password).toHaveLength(alphabet.length * 16);
    for (const char of alphabet) expect([...password].filter(c => c === char)).toHaveLength(16);
  });

  it('refills after rejecting a whole batch and preserves the default length', () => {
    let calls = 0;
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      (array as Uint8Array).fill(calls++ === 0 ? 255 : 0);
      return array;
    });
    expect(generate()).toBe(alphabet[0].repeat(6));
    expect(calls).toBe(2);
  });
});
