import { describe, expect, it } from 'vitest';

import { escapeAttribute, safeUrlAttribute } from './html.js';

// SPEC.md §4.8 + §5.2#10: server and client must encode URL-bearing attributes
// identically. `safeUrlAttribute` mirrors the client's `kovoBoundAttributeValue`
// scheme-check logic for server SSR (F1 fix in bugs-and-testing-part2.md).
describe('safeUrlAttribute (F1 — server URL-scheme sanitizer)', () => {
  it('neutralizes javascript: URLs to "#" for href', () => {
    expect(safeUrlAttribute('href', 'javascript:alert(1)')).toBe('#');
  });

  it('neutralizes javascript: URLs to "#" for src', () => {
    expect(safeUrlAttribute('src', 'javascript:void(0)')).toBe('#');
  });

  it('neutralizes javascript: URLs to "#" for action', () => {
    expect(safeUrlAttribute('action', 'javascript:alert(1)')).toBe('#');
  });

  it('neutralizes javascript: URLs to "#" for formaction', () => {
    expect(safeUrlAttribute('formaction', 'javascript:alert(1)')).toBe('#');
  });

  it('neutralizes javascript: URLs to "#" for xlink:href', () => {
    expect(safeUrlAttribute('xlink:href', 'javascript:alert(1)')).toBe('#');
  });

  it('strips control characters before scheme-checking (java\\nscript: bypass)', () => {
    // The normalisation step filters chars with codepoint ≤ 0x20.
    expect(safeUrlAttribute('href', 'java\nscript:alert(1)')).toBe('#');
    expect(safeUrlAttribute('href', 'java\tscript:alert(1)')).toBe('#');
    expect(safeUrlAttribute('href', 'java script:alert(1)')).toBe('#');
  });

  it('neutralizes vbscript: scheme', () => {
    expect(safeUrlAttribute('href', 'vbscript:MsgBox("XSS")')).toBe('#');
  });

  it('neutralizes data: scheme', () => {
    expect(safeUrlAttribute('href', 'data:text/html,<script>alert(1)</script>')).toBe('#');
  });

  it('passes through https:// URLs unchanged (escaped)', () => {
    expect(safeUrlAttribute('href', 'https://example.com/path?q=1&r=2')).toBe(
      escapeAttribute('https://example.com/path?q=1&r=2'),
    );
  });

  it('passes through http:// URLs unchanged', () => {
    expect(safeUrlAttribute('href', 'http://example.com')).toBe(escapeAttribute('http://example.com'));
  });

  it('passes through mailto: URLs unchanged', () => {
    expect(safeUrlAttribute('href', 'mailto:user@example.com')).toBe(
      escapeAttribute('mailto:user@example.com'),
    );
  });

  it('passes through tel: URLs unchanged', () => {
    expect(safeUrlAttribute('href', 'tel:+15551234567')).toBe(
      escapeAttribute('tel:+15551234567'),
    );
  });

  it('passes through ftp:// URLs unchanged (SPEC §4.8:347 includes ftp)', () => {
    expect(safeUrlAttribute('href', 'ftp://files.example.com/path')).toBe(
      escapeAttribute('ftp://files.example.com/path'),
    );
  });

  it('passes through relative paths unchanged', () => {
    expect(safeUrlAttribute('href', '/pricing')).toBe(escapeAttribute('/pricing'));
    expect(safeUrlAttribute('src', '../images/photo.png')).toBe(
      escapeAttribute('../images/photo.png'),
    );
  });

  it('passes through fragment-only URLs unchanged', () => {
    expect(safeUrlAttribute('href', '#section-1')).toBe(escapeAttribute('#section-1'));
  });

  it('passes through empty href unchanged', () => {
    expect(safeUrlAttribute('href', '')).toBe('');
  });

  it('does not scheme-check non-URL attribute names', () => {
    // class, id, title, etc. go through plain escapeAttribute with no scheme check.
    expect(safeUrlAttribute('class', 'javascript:foo')).toBe(
      escapeAttribute('javascript:foo'),
    );
    expect(safeUrlAttribute('title', 'javascript:alert(1)')).toBe(
      escapeAttribute('javascript:alert(1)'),
    );
  });

  it('still HTML-escapes safe URL attribute values', () => {
    // Ensures the output is safe for embedding inside a double-quoted attribute.
    expect(safeUrlAttribute('href', 'https://x.com?a=1&b=2')).toBe(
      'https://x.com?a=1&amp;b=2',
    );
    expect(safeUrlAttribute('href', 'https://x.com/path"suffix')).toBe(
      'https://x.com/path&quot;suffix',
    );
  });
});
