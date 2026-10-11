import { expect, test } from 'vitest';
import { validMaxClicks } from './max-clicks';

test('visit limits allow blank clearing and safe integers within the server range', () => {
  for (const value of ['', '  ', '1', ' 5 ', '1000000000000']) expect(validMaxClicks(value), value).toBe(true);
  for (const value of ['0', '-1', '01', '1.5', '1e3', 'Infinity', 'NaN', '1000000000001', '9007199254740993', '9'.repeat(309)]) {
    expect(validMaxClicks(value), value).toBe(false);
  }
});
