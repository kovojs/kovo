import { describe, expect, it } from 'vitest';

import { factHash } from './fact-hash.js';

describe('compiler fact identity', () => {
  it('does not alias fixed distinct FNV-1a collision preimages', () => {
    // SPEC.md §5.2.1 requires collision-resistant build/cache identities. These distinct canonical
    // JSON strings both produced the former 32-bit FNV-1a digest 3e919d20.
    expect(factHash('hmr-authority-149599')).not.toBe(factHash('hmr-authority-312382'));
  });

  it('does not delegate fact identity to late scalar hash controls', () => {
    const originalCharCodeAt = String.prototype.charCodeAt;
    const originalImul = Math.imul;
    const originalPadStart = String.prototype.padStart;
    const originalToString = Number.prototype.toString;
    let poisonHits = 0;
    let digest = '';

    try {
      String.prototype.charCodeAt = function poisonedFactCharCodeAt(index) {
        if (String(this).includes('hmr-authority')) {
          poisonHits += 1;
          return 0;
        }
        return Reflect.apply(originalCharCodeAt, this, [index]);
      };
      Math.imul = function poisonedFactImul(left, right) {
        poisonHits += 1;
        return Reflect.apply(originalImul, Math, [left, right]);
      };
      Number.prototype.toString = function poisonedFactToString(radix) {
        poisonHits += 1;
        return Reflect.apply(originalToString, this, radix === undefined ? [] : [radix]);
      };
      String.prototype.padStart = function poisonedFactPadStart(maxLength, fillString) {
        poisonHits += 1;
        return Reflect.apply(
          originalPadStart,
          this,
          fillString === undefined ? [maxLength] : [maxLength, fillString],
        );
      };

      digest = factHash('hmr-authority-safe');
    } finally {
      String.prototype.charCodeAt = originalCharCodeAt;
      Math.imul = originalImul;
      Number.prototype.toString = originalToString;
      String.prototype.padStart = originalPadStart;
    }

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(poisonHits).toBe(0);
  });
});
