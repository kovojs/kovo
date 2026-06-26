import { describe, expect, it } from 'vitest';

import { safeUrl } from './safe-url.js';

describe('safeUrl', () => {
  it('neutralizes dangerous schemes to the fallback (default-deny)', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('#');
    expect(safeUrl('  javascript:alert(1)')).toBe('#');
    expect(safeUrl('java\tscript:alert(1)')).toBe('#');
    expect(safeUrl('java\nscript:alert(1)')).toBe('#');
    expect(safeUrl('JaVaScript:alert(1)')).toBe('#');
    expect(safeUrl('javascript:alert(1)')).toBe('#');
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('#');
    expect(safeUrl('vbscript:msgbox(1)')).toBe('#');
    expect(safeUrl('file:///etc/passwd')).toBe('#');
  });

  it('treats an HTML-entity-encoded colon in the scheme position as unsafe', () => {
    expect(safeUrl('javascript&#58;alert(1)')).toBe('#');
    expect(safeUrl('javascript&colon;alert(1)')).toBe('#');
  });

  it('uses a custom fallback when provided', () => {
    expect(safeUrl('javascript:alert(1)', '/safe')).toBe('/safe');
  });

  it('allows relative paths, fragments, and query-only values verbatim', () => {
    expect(safeUrl('/cart')).toBe('/cart');
    expect(safeUrl('./relative')).toBe('./relative');
    expect(safeUrl('../up')).toBe('../up');
    expect(safeUrl('#frag')).toBe('#frag');
    expect(safeUrl('?q=1')).toBe('?q=1');
    expect(safeUrl('/cart?a=1&b=2')).toBe('/cart?a=1&b=2');
  });

  it('allows absolute URLs whose scheme is in the allowlist', () => {
    expect(safeUrl('https://x.com/a')).toBe('https://x.com/a');
    expect(safeUrl('http://x.com/a')).toBe('http://x.com/a');
    expect(safeUrl('HTTPS://x.com/a')).toBe('HTTPS://x.com/a');
    expect(safeUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(safeUrl('mailto:a@b.com?subject=hi&body=yo')).toBe('mailto:a@b.com?subject=hi&body=yo');
    expect(safeUrl('tel:+1')).toBe('tel:+1');
  });

  // bugz-3 L9: a bare `&` in a relative path segment is NOT scheme obfuscation
  // and must be kept verbatim (the previous check over-blocked `AT&T/products`
  // to `#`). An HTML character reference that decodes to a colon in the scheme
  // position stays neutralized.
  it('keeps benign relative URLs whose path segment contains `&` (L9)', () => {
    expect(safeUrl('AT&T/products')).toBe('AT&T/products');
    expect(safeUrl('R&D/projects')).toBe('R&D/projects');
    expect(safeUrl('a&b/c')).toBe('a&b/c');
    expect(safeUrl('AT&T')).toBe('AT&T');
    expect(safeUrl('products/AT&T')).toBe('products/AT&T');
    expect(safeUrl('/x?a=1&b=2')).toBe('/x?a=1&b=2');
    // The dangerous-scheme and entity-encoded-colon defenses are unchanged.
    expect(safeUrl('javascript:alert(1)')).toBe('#');
    expect(safeUrl('javascript&#58;alert(1)')).toBe('#');
    expect(safeUrl('javascript&#x3a;alert(1)')).toBe('#');
    expect(safeUrl('javascript&#58alert(1)')).toBe('#'); // numeric ref, no `;`
    expect(safeUrl('javascript&colon;alert(1)')).toBe('#');
  });

  it('returns the fallback for nullish or empty input', () => {
    expect(safeUrl(undefined)).toBe('#');
    expect(safeUrl(undefined, '/login')).toBe('/login');
    expect(safeUrl('')).toBe('#');
    expect(safeUrl('   ')).toBe('#');
  });
});
