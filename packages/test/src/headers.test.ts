import { describe, expect, it } from 'vitest';

import {
  cookiePair,
  enhancedMutationHeaders,
  firstSetCookiePair,
  headerValues,
  setCookieValues,
} from './headers.js';

describe('@kovojs/test header fixtures', () => {
  it('reads case-insensitive header record values', () => {
    expect(
      headerValues(
        {
          'Content-Type': 'text/html; charset=utf-8',
          'Set-Cookie': ['sid=1; Path=/', 'theme=dark; Path=/'],
        },
        'set-cookie',
      ),
    ).toEqual(['sid=1; Path=/', 'theme=dark; Path=/']);
    expect(headerValues({ 'Content-Type': 'text/html' }, 'content-type')).toEqual(['text/html']);
  });

  it('reads Headers values and normalizes Set-Cookie pairs', () => {
    const headers = new Headers({
      'content-type': 'text/html',
      'set-cookie': 'sid=1; Path=/; HttpOnly',
    });

    expect(headerValues(headers, 'content-type')).toEqual(['text/html']);
    expect(setCookieValues(headers)).toEqual(['sid=1; Path=/; HttpOnly']);
    expect(cookiePair(setCookieValues(headers)[0])).toBe('sid=1');
    expect(firstSetCookiePair(headers)).toBe('sid=1');
  });

  it('builds enhanced mutation headers for app scenario tests', () => {
    expect(
      enhancedMutationHeaders({
        formTarget: 'product-grid',
        liveTargets: ['cart-badge#components/cart-badge:{}', 'product-grid#components/grid:{}'],
        targets: ['cart-badge=cart', 'product-grid=productGrid'],
      }),
    ).toEqual({
      'Kovo-Form-Target': 'product-grid',
      'Kovo-Fragment': 'true',
      'Kovo-Live-Targets': 'cart-badge#components/cart-badge:{}; product-grid#components/grid:{}',
      'Kovo-Targets': 'cart-badge=cart; product-grid=productGrid',
    });
  });
});
