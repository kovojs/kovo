import { describe, expect, it } from 'vitest';

import {
  isBrowserTrustedHtml,
  isKovoTrustedHtml,
  kovoBoundAttributeValue,
  kovoEscapeHtml,
  kovoStyleProperties,
  kovoStyleProperty,
  kovoTrustedHtmlContent,
  trustedHtml,
} from './security-output.js';

describe('runtime output-context helpers', () => {
  it('escapes HTML-fragment placeholders and neutralizes unsafe URL attributes', () => {
    expect(kovoEscapeHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
    expect(kovoBoundAttributeValue('href', 'java\tscript:alert(1)')).toBe('#');
    expect(kovoBoundAttributeValue('href', '/products/p1')).toBe('/products/p1');
    expect(kovoBoundAttributeValue('title', '<b>copy</b>')).toBe('<b>copy</b>');
  });

  it('sanitizes generated CSS property values', () => {
    expect(kovoStyleProperty('view-transition-name', 'product hero')).toBe(
      'view-transition-name: product-hero',
    );
    expect(
      kovoStyleProperties({
        height: '28%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'javascript:alert(1)',
      }),
    ).toBe('height: 28%; left: 50%; transform: translate(-50%, -50%)');
    expect(kovoStyleProperty('background-image', 'url(javascript:alert(1))')).toBe('');
  });

  it('unwraps only Kovo TrustedHtml and browser TrustedHTML-compatible values', () => {
    const browserTrustedHtml = {
      [Symbol.toStringTag]: 'TrustedHTML',
      toString: () => '<i>browser trusted</i>',
    } as const;

    expect(trustedHtml('<b>safe</b>')).toEqual({
      __kovoTrustedHtml: true,
      value: '<b>safe</b>',
    });
    expect(isKovoTrustedHtml(trustedHtml('<b>safe</b>'))).toBe(true);
    expect(isBrowserTrustedHtml(browserTrustedHtml)).toBe(true);
    expect(isBrowserTrustedHtml({ toString: () => '<i>not branded</i>' })).toBe(false);
    expect(kovoTrustedHtmlContent(trustedHtml('<b>safe</b>'))).toBe('<b>safe</b>');
    expect(kovoTrustedHtmlContent(trustedHtml(browserTrustedHtml))).toBe('<i>browser trusted</i>');
    expect(kovoTrustedHtmlContent(browserTrustedHtml)).toBe('<i>browser trusted</i>');
    expect(kovoTrustedHtmlContent('<img src=x onerror=alert(1)>')).toBe('');
    expect(kovoTrustedHtmlContent({ toString: () => '<i>not branded</i>' })).toBe('');
  });

  // F2: runtime must neutralize on* and srcdoc attribute sinks (KV236/SPEC §4.8:348)
  it('returns null for on* and srcdoc attribute names to suppress write', () => {
    expect(kovoBoundAttributeValue('onclick', 'alert(1)')).toBeNull();
    expect(kovoBoundAttributeValue('onerror', 'bad()')).toBeNull();
    expect(kovoBoundAttributeValue('onmouseover', 'x')).toBeNull();
    expect(kovoBoundAttributeValue('ONCLICK', 'alert(1)')).toBeNull();
    expect(kovoBoundAttributeValue('srcdoc', '<script>bad()</script>')).toBeNull();
    // Safe attributes still work normally.
    expect(kovoBoundAttributeValue('data-value', 'hello')).toBe('hello');
    expect(kovoBoundAttributeValue('aria-label', 'Close')).toBe('Close');
  });

  // F4: ftp must be in the runtime URL-scheme allowlist (SPEC §4.8:347)
  it('allows ftp: scheme URLs as safe bound attribute values', () => {
    expect(kovoBoundAttributeValue('href', 'ftp://example.com/x')).toBe('ftp://example.com/x');
    expect(kovoBoundAttributeValue('src', 'ftp://files.example.com/doc')).toBe(
      'ftp://files.example.com/doc',
    );
    // Unsafe schemes still blocked.
    expect(kovoBoundAttributeValue('href', 'javascript:alert(1)')).toBe('#');
  });
});
