import { describe, expect, it } from 'vitest';

import {
  setRuntimeSinkSecurityEventHandler,
  type RuntimeSinkSecurityEvent,
} from '@kovojs/core/internal/sink-policy';
import {
  isBrowserTrustedHtml,
  isKovoTrustedHtml,
  isKovoTrustedUrl,
  kovoBoundAttributeValue,
  kovoEscapeHtml,
  kovoSafeUrl,
  kovoStyleProperties,
  kovoStyleProperty,
  kovoTrustedHtmlContent,
  safeRichHtml,
  sanitizeRichHtml,
  trustedHtml,
  trustedUrl,
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

  it('passes author-vouched trustedUrl values through unsafe-scheme neutralization (SPEC §4.8)', () => {
    expect(trustedUrl('javascript:alert(1)')).toEqual({
      __kovoTrustedUrl: true,
      value: 'javascript:alert(1)',
    });
    expect(trustedUrl('data:image/png;base64,AAAA', 'reviewed CDN image')).toEqual({
      __kovoTrustedUrl: true,
      reason: 'reviewed CDN image',
      value: 'data:image/png;base64,AAAA',
    });
    expect(isKovoTrustedUrl(trustedUrl('data:text/html,x'))).toBe(true);
    expect(isKovoTrustedUrl('data:text/html,x')).toBe(false);

    // An unbranded unsafe URL is neutralized; the trusted brand is emitted verbatim.
    expect(kovoSafeUrl('javascript:alert(1)')).toBe('#');
    expect(kovoSafeUrl(trustedUrl('javascript:alert(1)'))).toBe('javascript:alert(1)');

    // The compiler-emitted bound-attribute path honors the brand too.
    expect(kovoBoundAttributeValue('href', 'data:text/html,evil')).toBe('#');
    expect(kovoBoundAttributeValue('href', trustedUrl('data:image/png;base64,AAAA'))).toBe(
      'data:image/png;base64,AAAA',
    );
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

  it('filters srcset candidates and suppresses unsafe CSS text attribute writes', () => {
    expect(
      kovoBoundAttributeValue(
        'srcset',
        '/img/small.png 1x, javascript:alert(1) 2x, https://cdn.test/large.png 3x',
      ),
    ).toBe('/img/small.png 1x, https://cdn.test/large.png 3x');
    expect(kovoBoundAttributeValue('srcset', 'javascript:alert(1) 1x')).toBeNull();
    expect(kovoBoundAttributeValue('style', 'background:url(javascript:alert(1))')).toBeNull();
    expect(kovoBoundAttributeValue('style', 'min-height: 120px')).toBe('min-height: 120px');
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
    expect(
      trustedHtml('<b>safe</b>', {
        reason: 'cms sanitizer owns rich text',
        source: 'cms.promo.body',
      }),
    ).toEqual({
      __kovoTrustedHtml: true,
      reason: 'cms sanitizer owns rich text',
      source: 'cms.promo.body',
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

  it('sanitizes CMS rich HTML before returning a trusted HTML brand', () => {
    const rich = safeRichHtml(
      '<p onclick="steal()">Hello <strong>world</strong><script>alert(1)</script>' +
        '<a href="javascript:alert(1)" target="popup" rel="noopener evil">link</a>' +
        '<img src="data:text/html,<svg onload=alert(1)>" srcset="/safe.png 1x, javascript:bad 2x" onerror="bad()">' +
        '<custom-tag data-x="<ok>">text</custom-tag></p>',
      { reason: 'cms body', source: 'posts.body' },
    );

    expect(rich.reason).toBe('cms body');
    expect(rich.source).toBe('posts.body');
    expect(kovoTrustedHtmlContent(rich)).toBe(
      '<p>Hello <strong>world</strong><a href="#" rel="noopener">link</a>' +
        '<img src="#" srcset="/safe.png 1x">text</p>',
    );
  });

  it('escapes malformed rich HTML text and closes allowed elements', () => {
    expect(sanitizeRichHtml('<p>one < two <em>three')).toBe('<p>one &lt; two <em>three</em></p>');
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

  it('drains one redacted KV236 event per blocked browser output sink write', () => {
    const events: RuntimeSinkSecurityEvent[] = [];
    const restore = setRuntimeSinkSecurityEventHandler((event) => events.push(event));
    const attackerPayload = 'javascript:alert("secret-token")';

    try {
      expect(kovoBoundAttributeValue('href', attackerPayload)).toBe('#');
      expect(kovoBoundAttributeValue('srcset', `${attackerPayload} 1x`)).toBeNull();
      expect(kovoBoundAttributeValue('style', `background:url(${attackerPayload})`)).toBeNull();
      expect(
        kovoBoundAttributeValue('innerHTML', `<img src=x onerror="${attackerPayload}">`),
      ).toBeNull();
      expect(kovoBoundAttributeValue('onclick', attackerPayload)).toBeNull();
    } finally {
      restore();
    }

    expect(events).toHaveLength(5);
    expect(events.map((event) => [event.code, event.family, event.action])).toEqual([
      ['KV236', 'url', 'neutralize'],
      ['KV236', 'srcset', 'remove'],
      ['KV236', 'css-text', 'remove'],
      ['KV236', 'raw-html', 'remove'],
      ['KV236', 'event-handler', 'remove'],
    ]);
    for (const event of events) {
      expect(event.value).toEqual({
        length: expect.any(Number),
        preview: `<redacted:${event.value.length}>`,
        redacted: true,
      });
    }
    expect(JSON.stringify(events)).not.toContain('secret-token');
    expect(JSON.stringify(events)).not.toContain('alert');
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
