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

  it('sanitizes render URLs through the shared core sink policy', () => {
    expect(safeUrl('ftp://example.test/file.txt')).toBe('ftp://example.test/file.txt');
    expect(safeUrl('javascript&#x3a;alert(1)')).toBe('#');
    expect(safeUrl('R&D/projects')).toBe('R&D/projects');
    expect(safeUrl('   ')).toBe('#');
    expect(safeUrl(undefined, '/fallback')).toBe('/fallback');
  });
});
