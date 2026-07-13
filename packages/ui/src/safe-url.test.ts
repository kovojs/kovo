import { describe, expect, it } from 'vitest';

import { safeUrl } from './safe-url.js';

describe('UI safeUrl authority', () => {
  it('keeps dangerous schemes closed after authored intrinsic poisoning', () => {
    const nativeSetHas = Set.prototype.has;
    const nativeRegExpExec = RegExp.prototype.exec;
    let setResult = '';
    let regexpResult = '';
    try {
      Set.prototype.has = () => true;
      setResult = safeUrl('javascript:alert(1)');
      RegExp.prototype.exec = () => null;
      regexpResult = safeUrl('javascript:alert(1)');
    } finally {
      Set.prototype.has = nativeSetHas;
      RegExp.prototype.exec = nativeRegExpExec;
    }
    expect(setResult).toBe('#');
    expect(regexpResult).toBe('#');
  });

  it('preserves ordinary allowed and relative URL behavior', () => {
    expect(safeUrl('HTTPS://example.test/path')).toBe('HTTPS://example.test/path');
    expect(safeUrl('/cart?a=1&b=2')).toBe('/cart?a=1&b=2');
    expect(safeUrl('javascript&#x3A;alert(1)')).toBe('#');
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('#');
  });
});
