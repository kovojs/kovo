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

  it('keeps security-sensitive Set-Cookie values visible after late Object.entries poisoning', () => {
    const originalEntries = Object.entries;
    let observed: string[] = [];

    try {
      Object.entries = () => [];
      observed = setCookieValues({
        'Set-Cookie': ['sid=1; Path=/; Secure; HttpOnly', 'theme=dark; SameSite=Strict'],
      });
    } finally {
      Object.entries = originalEntries;
    }

    expect(observed).toEqual(['sid=1; Path=/; Secure; HttpOnly', 'theme=dark; SameSite=Strict']);
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

  it('uses boot-captured native Headers controls after tested code replaces prototype methods', () => {
    const headers = new Headers({
      'content-type': 'text/html',
      'set-cookie': 'sid=1; Path=/; Secure; HttpOnly',
    });
    const getDescriptor = Object.getOwnPropertyDescriptor(Headers.prototype, 'get')!;
    const getSetCookieDescriptor = Object.getOwnPropertyDescriptor(
      Headers.prototype,
      'getSetCookie',
    );
    let contentTypes: string[] = [];
    let setCookies: string[] = [];

    try {
      Object.defineProperty(Headers.prototype, 'get', {
        configurable: true,
        value: () => null,
        writable: true,
      });
      if (getSetCookieDescriptor !== undefined) {
        Object.defineProperty(Headers.prototype, 'getSetCookie', {
          configurable: true,
          value: () => [],
          writable: true,
        });
      }
      contentTypes = headerValues(headers, 'content-type');
      setCookies = setCookieValues(headers);
    } finally {
      Object.defineProperty(Headers.prototype, 'get', getDescriptor);
      if (getSetCookieDescriptor !== undefined) {
        Object.defineProperty(Headers.prototype, 'getSetCookie', getSetCookieDescriptor);
      }
    }

    expect(contentTypes).toEqual(['text/html']);
    expect(setCookies).toEqual(['sid=1; Path=/; Secure; HttpOnly']);
  });

  it('builds enhanced mutation headers for app scenario tests', () => {
    expect(
      enhancedMutationHeaders({
        formTarget: 'product-grid',
        liveTargets: [
          { component: 'components/cart-badge', target: 'cart-badge' },
          { component: 'components/grid', target: 'product-grid' },
        ],
        targets: [
          { queries: 'cart', target: 'cart-badge' },
          { queries: 'productGrid', target: 'product-grid' },
        ],
      }),
    ).toEqual({
      'Kovo-Form-Target': 'product-grid',
      'Kovo-Fragment': 'true',
      'Kovo-Live-Targets': 'cart-badge#components/cart-badge:{}; product-grid#components/grid:{}',
      'Kovo-Targets': 'cart-badge=cart; product-grid=productGrid',
    });
  });

  it('keeps enhanced mutation requests exact after collection and JSON controls are replaced', () => {
    const originalMap = Array.prototype.map;
    const originalJoin = Array.prototype.join;
    const originalStringify = JSON.stringify;
    const objectToJson = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
    const arrayToJson = Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON');
    let headers: Record<string, string> = {};

    try {
      Array.prototype.map = () => [];
      Array.prototype.join = () => 'forged';
      JSON.stringify = () => '{"forged":true}';
      Object.defineProperty(Object.prototype, 'toJSON', {
        configurable: true,
        value: () => ({ forged: true }),
      });
      Object.defineProperty(Array.prototype, 'toJSON', {
        configurable: true,
        value: () => ['forged'],
      });
      headers = enhancedMutationHeaders({
        liveTargets: [
          {
            component: 'components/cart',
            props: { count: 1, items: ['safe'] },
            target: 'cart',
          },
        ],
        targets: [{ queries: ['cart', 'viewer'], target: 'cart' }],
      });
    } finally {
      Array.prototype.map = originalMap;
      Array.prototype.join = originalJoin;
      JSON.stringify = originalStringify;
      if (objectToJson === undefined) delete (Object.prototype as { toJSON?: unknown }).toJSON;
      else Object.defineProperty(Object.prototype, 'toJSON', objectToJson);
      if (arrayToJson === undefined)
        delete (Array.prototype as unknown as { toJSON?: unknown }).toJSON;
      else Object.defineProperty(Array.prototype, 'toJSON', arrayToJson);
    }

    expect(headers).toEqual({
      'Kovo-Fragment': 'true',
      'Kovo-Live-Targets': 'cart#components/cart:{"count":1,"items":["safe"]}',
      'Kovo-Targets': 'cart=cart viewer',
    });
  });

  it('keeps string header fixtures available for package-level wire tests', () => {
    expect(
      enhancedMutationHeaders({
        liveTargets: 'cart#components/cart:{}',
        targets: 'cart=cart',
      }),
    ).toMatchObject({
      'Kovo-Live-Targets': 'cart#components/cart:{}',
      'Kovo-Targets': 'cart=cart',
    });
  });
});
