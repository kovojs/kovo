import { describe, expect, it } from 'vitest';

import { applySourceReplacements } from './shared.js';

describe('compiler shared source replacements', () => {
  it('applies replacements by original source spans', () => {
    expect(
      applySourceReplacements('alpha beta gamma', [
        { end: 16, replacement: 'delta', start: 11 },
        { end: 5, replacement: 'omega', start: 0 },
      ]),
    ).toBe('omega beta delta');
  });

  it('rejects overlapping source spans', () => {
    expect(() =>
      applySourceReplacements('abcdef', [
        { end: 4, replacement: 'x', start: 1 },
        { end: 5, replacement: 'y', start: 3 },
      ]),
    ).toThrow('Overlapping source replacement span 1:4');
  });

  it('rejects out-of-range source spans', () => {
    expect(() => applySourceReplacements('abc', [{ end: 4, replacement: 'x', start: 2 }])).toThrow(
      'Invalid source replacement span 2:4',
    );
  });
});
