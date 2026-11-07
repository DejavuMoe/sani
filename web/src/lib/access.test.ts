import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatePassword } from './access';

vi.mock('./i18n.svelte', () => ({ t: (key: string) => key }));
vi.mock('./toast.svelte', () => ({ toasts: {} }));

const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

afterEach(() => vi.restoreAllMocks());

describe('generated passwords', () => {
  it('maps complete byte cycles to equally frequent characters', () => {
    let next = 0;
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      const bytes = array as Uint8Array;
      for (let i = 0; i < bytes.length; i++) bytes[i] = next++ % 256;
      return array;
    });
    const password = generatePassword(alphabet.length * 16);
    expect(password).toHaveLength(alphabet.length * 16);
    for (const char of alphabet) expect([...password].filter(c => c === char)).toHaveLength(16);
  });

  it('refills after rejecting a whole batch and preserves the default length', () => {
    let calls = 0;
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      (array as Uint8Array).fill(calls++ === 0 ? 255 : 0);
      return array;
    });
    expect(generatePassword()).toBe(alphabet[0].repeat(6));
    expect(calls).toBe(2);
  });
});
