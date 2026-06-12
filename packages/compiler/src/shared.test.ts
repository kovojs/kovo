import { describe, expect, it } from 'vitest';

import {
  applySourceReplacements,
  generatedOffsetToOriginal,
  sourceReplacementOffsetMap,
} from './shared.js';

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

  it('maps patched generated offsets back to original unchanged spans', () => {
    const original =
      '<button disabled={cart.count === 0}>Checkout</button> <strong>{cart.discount}</strong>';
    const replacement =
      'data-derive="cart.CartBadge$button_disabled_derive" data-derive-attr="disabled"';
    const patched = applySourceReplacements(original, [{ end: 32, replacement, start: 8 }]);
    const map = sourceReplacementOffsetMap(
      original.length,
      [{ end: 32, replacement, start: 8 }],
      12,
    );

    const generatedDiscount = 12 + patched.indexOf('cart.discount');

    expect(generatedOffsetToOriginal(map, generatedDiscount)).toBe(
      original.indexOf('cart.discount'),
    );
  });

  it('does not map generated replacement boundary offsets onto the previous segment', () => {
    const original = 'alpha beta gamma';
    const replacement = 'BETA-BETA';
    const map = sourceReplacementOffsetMap(original.length, [{ end: 10, replacement, start: 6 }]);
    const generatedReplacementStart = original.indexOf('beta');
    const generatedTailStart = generatedReplacementStart + replacement.length;

    expect(generatedOffsetToOriginal(map, generatedReplacementStart)).toBeUndefined();
    expect(generatedOffsetToOriginal(map, generatedTailStart - 1)).toBeUndefined();
    expect(generatedOffsetToOriginal(map, generatedTailStart)).toBe(10);
    expect(generatedOffsetToOriginal(map, generatedTailStart + 1)).toBe(original.indexOf('gamma'));
  });

  it('maps generated end-of-file to original end-of-file', () => {
    const original = 'alpha beta';
    const map = sourceReplacementOffsetMap(original.length, [
      { end: original.length, replacement: 'omega', start: 6 },
    ]);

    expect(generatedOffsetToOriginal(map, map.generatedLength)).toBe(original.length);
  });
});
