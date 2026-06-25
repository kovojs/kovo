import { describe, expect, it } from 'vitest';

import {
  applySourceReplacements,
  applySourceReplacementsWithOffsetMap,
  composeSourceOffsetMaps,
  generatedOffsetToOriginal,
  sourceReplacementOffsetMap,
  SourceReplacementAccumulator,
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

  it('returns patched source and offset map from the same source spans', () => {
    const original = '<span>{cart.count}</span>';
    const replacement = '<span data-bind="cart.count">{cart.count}</span>';
    const prefix = 'export const Cart$count = derive(["cart"], (cart) => cart.count);\n\n';
    const result = applySourceReplacementsWithOffsetMap(
      original,
      [{ end: original.length, replacement, start: 0 }],
      prefix,
    );

    expect(result.source).toBe(`${prefix}${replacement}`);
    expect(result.sourceOffsetMap.generatedLength).toBe(result.source.length);
    expect(result.sourceOffsetMap.originalLength).toBe(original.length);
    expect(generatedOffsetToOriginal(result.sourceOffsetMap, prefix.length)).toBeUndefined();
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

  it('composes two patch offset maps back to the original source', () => {
    const original = '<section><span>{cart.count}</span></section>';
    const firstReplacement = '<span data-bind="cart.count">{cart.count}</span>';
    const intermediate = applySourceReplacements(original, [
      { end: 32, replacement: firstReplacement, start: 9 },
    ]);
    const firstMap = sourceReplacementOffsetMap(original.length, [
      { end: 32, replacement: firstReplacement, start: 9 },
    ]);
    const secondMap = sourceReplacementOffsetMap(intermediate.length, [
      { end: 8, replacement: '<section class="kv-root"', start: 0 },
    ]);
    const composed = composeSourceOffsetMaps(firstMap, secondMap);
    const generatedSectionClose = applySourceReplacements(intermediate, [
      { end: 8, replacement: '<section class="kv-root"', start: 0 },
    ]).indexOf('</section>');

    expect(generatedOffsetToOriginal(composed, generatedSectionClose)).toBe(
      original.indexOf('</section>'),
    );
    expect(generatedOffsetToOriginal(composed, '<section class="kv-root"'.length - 1)).toBe(
      undefined,
    );
  });

  it('records phase, writer, original span, and generated span for replacement plans', () => {
    const accumulator = new SourceReplacementAccumulator();
    accumulator.add(
      { phase: 'lowering', writer: 'structural-jsx' },
      [{ end: 10, replacement: 'BETA-BETA', start: 6 }],
    );

    expect(accumulator.plan('alpha beta gamma'.length).records).toEqual([
      {
        generatedEnd: 15,
        generatedStart: 6,
        originalEnd: 10,
        originalStart: 6,
        phase: 'lowering',
        replacement: 'BETA-BETA',
        writer: 'structural-jsx',
      },
    ]);
  });

  it('records replacement conflict diagnostics with both writers', () => {
    const accumulator = new SourceReplacementAccumulator();
    accumulator.add(
      { phase: 'lowering', writer: 'structural-jsx' },
      [{ end: 4, replacement: 'x', start: 1 }],
    );
    accumulator.add(
      { phase: 'lowering', writer: 'navigation-standalone-href' },
      [{ end: 5, replacement: 'y', start: 3 }],
    );

    expect(accumulator.plan('abcdef'.length).diagnostics).toMatchObject([
      {
        conflicting: {
          originalEnd: 4,
          originalStart: 1,
          phase: 'lowering',
          writer: 'structural-jsx',
        },
        kind: 'overlap',
        originalEnd: 5,
        originalStart: 3,
        phase: 'lowering',
        writer: 'navigation-standalone-href',
      },
    ]);
  });
});
