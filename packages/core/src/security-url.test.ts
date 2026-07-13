import { describe, expect, it } from 'vitest';

import {
  hasUnsafeUrlScheme,
  isUrlAttributeName,
  safeUrl,
  SAFE_URL_SCHEMES,
  URL_ATTRIBUTE_NAMES,
} from './internal/security-url.js';

describe('shared URL sink security facts', () => {
  it('classifies URL-bearing attributes case-insensitively', () => {
    expect(URL_ATTRIBUTE_NAMES).toContain('href');
    expect(isUrlAttributeName('href')).toBe(true);
    expect(isUrlAttributeName('HREF')).toBe(true);
    expect(isUrlAttributeName('data-action')).toBe(false);
  });

  it('keeps the URL scheme allowlist centralized', () => {
    expect(SAFE_URL_SCHEMES).toContain('ftp');
    expect(hasUnsafeUrlScheme('https://example.test')).toBe(false);
    expect(hasUnsafeUrlScheme('ftp://example.test/file.txt')).toBe(false);
    expect(hasUnsafeUrlScheme('/relative/path')).toBe(false);
    expect(hasUnsafeUrlScheme('java\nscript:alert(1)')).toBe(true);
    expect(hasUnsafeUrlScheme('javascript&#58;alert(1)')).toBe(true);
    expect(hasUnsafeUrlScheme('AT&T/products')).toBe(false);
    expect(hasUnsafeUrlScheme('data:text/html,<svg onload=alert(1)>')).toBe(true);
  });

  it('does not expose mutable URL sink policy to app imports', () => {
    const scheme = SAFE_URL_SCHEMES[0]!;
    const attribute = URL_ATTRIBUTE_NAMES[0]!;
    const changedScheme = Reflect.set(SAFE_URL_SCHEMES, 0, 'javascript');
    const changedAttribute = Reflect.set(URL_ATTRIBUTE_NAMES, 0, 'data-attacker');

    try {
      expect(changedScheme).toBe(false);
      expect(changedAttribute).toBe(false);
      expect(SAFE_URL_SCHEMES[0]).toBe(scheme);
      expect(URL_ATTRIBUTE_NAMES[0]).toBe(attribute);
    } finally {
      Reflect.set(SAFE_URL_SCHEMES, 0, scheme);
      Reflect.set(URL_ATTRIBUTE_NAMES, 0, attribute);
    }
  });

  it('sanitizes render URLs through the shared core sink policy', () => {
    expect(safeUrl('ftp://example.test/file.txt')).toBe('ftp://example.test/file.txt');
    expect(safeUrl('javascript&#x3a;alert(1)')).toBe('#');
    expect(safeUrl('R&D/projects')).toBe('R&D/projects');
    expect(safeUrl('   ')).toBe('#');
    expect(safeUrl(undefined, '/fallback')).toBe('/fallback');
  });

  it('rejects late-coercing carriers and ignores poisoned String.prototype.replace', () => {
    const originalReplace = String.prototype.replace;
    let invoked = false;
    let poisonedResult = '';
    try {
      String.prototype.replace = function replacePoison() {
        return this as unknown as string;
      };
      poisonedResult = safeUrl('javascript:alert(1)');
      const carrier = {
        length: 8,
        replace: () => 'https://safe.example',
        toString() {
          invoked = true;
          return invoked ? 'javascript:alert(2)' : 'https://safe.example';
        },
      };
      expect(safeUrl(carrier as unknown as string)).toBe('#');
    } finally {
      String.prototype.replace = originalReplace;
    }

    expect(poisonedResult).toBe('#');
    expect(invoked).toBe(false);
  });
});
