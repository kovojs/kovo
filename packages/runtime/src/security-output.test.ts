import { describe, expect, it } from 'vitest';

import {
  kovoBoundAttributeValue,
  kovoEscapeHtml,
  kovoStyleProperties,
  kovoStyleProperty,
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

  it('sanitizes generated CSS property values and exposes a trusted HTML wrapper shape', () => {
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
    expect(trustedHtml('<b>safe</b>')).toEqual({
      __kovoTrustedHtml: true,
      value: '<b>safe</b>',
    });
  });
});
