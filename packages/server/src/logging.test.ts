import { describe, expect, it } from 'vitest';
import { secret } from '@kovojs/core';

import {
  formatLogMessage,
  neutralizeLogValue,
  sanitizeDiagnosticText,
  sanitizeDiagnosticUrl,
  scrubConsoleArgs,
  scrubSecretLifecycleValue,
} from './logging.js';

describe('log-channel neutralization', () => {
  it('renders control characters as visible escapes', () => {
    expect(neutralizeLogValue('line\r\nnext\t\x1b[31m\x7f')).toBe(
      'line\\u000d\\u000anext\\u0009\\u001b[31m\\u007f',
    );
  });

  it('keeps log-line neutralization closed after late String.replace poisoning', () => {
    const originalReplace = String.prototype.replace;
    try {
      String.prototype.replace = function () {
        if (this.valueOf() === 'safe\r\nforged=admin') return this.valueOf();
        return Reflect.apply(originalReplace, this, arguments);
      };
      expect(neutralizeLogValue('safe\r\nforged=admin')).toBe('safe\\u000d\\u000aforged=admin');
    } finally {
      String.prototype.replace = originalReplace;
    }
  });

  it('neutralizes interpolated values in formatted log messages', () => {
    expect(formatLogMessage`request failed: ${'/search?q=a\r\nforged=true'}`).toBe(
      'request failed: /search?q=a\\u000d\\u000aforged=true',
    );
  });

  it('scrubs secret-tagged values before logger formatting', () => {
    const token = secret('sk_live_q5_logger');

    expect(neutralizeLogValue({ token })).toBe('[object Object]');
    expect(formatLogMessage`token=${token}`).toBe('token=[secret]');
    expect(JSON.stringify(scrubSecretLifecycleValue({ nested: [token] }))).toBe(
      '{"nested":["[secret]"]}',
    );
  });

  it('scrubs structured console arguments without mutating non-secret inputs', () => {
    const plain = { ok: true };
    const token = secret('sk_live_q5_console');
    const args = scrubConsoleArgs(['message', { plain, token }]);

    expect(args).toEqual(['message', { plain, token: '[secret]' }]);
    expect(JSON.stringify(args)).not.toContain('sk_live_q5_console');
    expect(scrubSecretLifecycleValue(plain)).toBe(plain);
  });

  it('retains only pathname and ordered query-key names for diagnostic URLs', () => {
    const corpus = [
      [
        'https://app.test/_kovo/storage/a?kovo-cap=CAPABILITY&next=%2Faccount',
        '/_kovo/storage/a?kovo-cap&next',
      ],
      [
        '/oauth/callback?code=AUTH_CODE&state=STATE&state=SECOND',
        '/oauth/callback?code&state&state',
      ],
      ['/reset?Token=RESET&token=lower&TOKEN=upper', '/reset?Token&token&TOKEN'],
      ['/encoded?%6b%6f%76%6f%2d%63%61%70=a%252Fb&x=%00', '/encoded?kovo-cap&x'],
      ['/plain/path#fragment-secret', '/plain/path'],
    ] as const;

    for (const [input, expected] of corpus) expect(sanitizeDiagnosticUrl(input)).toBe(expected);
  });

  it('removes request URLs from diagnostic error text without touching unrelated text', () => {
    const absolute = 'https://app.test/reset?token=RESET_SECRET&state=STATE_SECRET';
    const message = `backend failed for ${absolute} via /reset?token=RESET_SECRET&state=STATE_SECRET`;

    expect(sanitizeDiagnosticText(message, [absolute], sanitizeDiagnosticUrl)).toBe(
      'backend failed for /reset?token&state via /reset?token&state',
    );
  });

  it('removes origin and userinfo from absolute diagnostic URLs without query values', () => {
    const absolute = 'https://diagnostic-user:DIAGNOSTIC_PASSWORD@idp.example/callback';

    expect(
      sanitizeDiagnosticText(`provider failed at ${absolute}`, [absolute], sanitizeDiagnosticUrl),
    ).toBe('provider failed at /callback');
  });

  it('keeps credential redaction closed after late String.replaceAll poisoning', () => {
    const absolute =
      'https://diagnostic-user:DIAGNOSTIC_PASSWORD@idp.example/callback?code=AUTH_CODE#SECRET';
    const originalReplaceAll = String.prototype.replaceAll;
    try {
      String.prototype.replaceAll = function (search, replacement) {
        if (this.valueOf() === `provider failed at ${absolute}`) return this.valueOf();
        return Reflect.apply(originalReplaceAll, this, [search, replacement]);
      };
      expect(
        sanitizeDiagnosticText(`provider failed at ${absolute}`, [absolute], sanitizeDiagnosticUrl),
      ).toBe('provider failed at /callback?code');
    } finally {
      String.prototype.replaceAll = originalReplaceAll;
    }
  });

  it('keeps nested secrets, accessors, errors, and URL credentials closed under realm poisoning', () => {
    const token = secret('sk_live_nested_logger_secret');
    const absolute =
      'https://diagnostic-user:DIAGNOSTIC_PASSWORD@idp.example/callback?code=AUTH_CODE#SECRET';
    const error = new Error('provider failed');
    Object.defineProperty(error, 'cause', { enumerable: false, value: token });
    Object.defineProperty(error, 'token', { enumerable: true, value: token });
    const payload: Record<string, unknown> = { error, nested: [token], url: absolute };
    let accessorReads = 0;
    Object.defineProperty(payload, 'accessor', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return token;
      },
    });

    const originalArrayIsArray = Array.isArray;
    const originalArrayMap = Array.prototype.map;
    const originalArraySort = Array.prototype.sort;
    const originalMapSet = Map.prototype.set;
    const originalWeakMapGet = WeakMap.prototype.get;
    const originalWeakMapSet = WeakMap.prototype.set;
    const originalObjectDefineProperty = Object.defineProperty;
    const originalObjectGetPrototypeOf = Object.getPrototypeOf;
    const originalObjectKeys = Object.keys;
    const originalRegExpTest = RegExp.prototype.test;
    const OriginalURL = globalThis.URL;
    const originalEncodeURIComponent = globalThis.encodeURIComponent;
    let sanitizedText = '';
    let sanitizedUrl = '';
    let scrubbed: unknown;
    try {
      Array.isArray = () => false;
      Array.prototype.map = () => [];
      Array.prototype.sort = function () {
        return this;
      };
      Map.prototype.set = function () {
        return this;
      };
      WeakMap.prototype.get = () => undefined;
      WeakMap.prototype.set = function () {
        return this;
      };
      Object.defineProperty = ((value: object) => value) as typeof Object.defineProperty;
      Object.getPrototypeOf = () => null;
      Object.keys = () => [];
      RegExp.prototype.test = () => false;
      globalThis.URL = class ForgedURL {} as typeof URL;
      globalThis.encodeURIComponent = () => 'forged';

      sanitizedText = sanitizeDiagnosticText(
        `provider failed at ${absolute}`,
        [absolute],
        sanitizeDiagnosticUrl,
      );
      sanitizedUrl = sanitizeDiagnosticUrl(absolute);
      scrubbed = scrubConsoleArgs([payload])[0];
    } finally {
      Array.isArray = originalArrayIsArray;
      Array.prototype.map = originalArrayMap;
      Array.prototype.sort = originalArraySort;
      Map.prototype.set = originalMapSet;
      WeakMap.prototype.get = originalWeakMapGet;
      WeakMap.prototype.set = originalWeakMapSet;
      Object.defineProperty = originalObjectDefineProperty;
      Object.getPrototypeOf = originalObjectGetPrototypeOf;
      Object.keys = originalObjectKeys;
      RegExp.prototype.test = originalRegExpTest;
      globalThis.URL = OriginalURL;
      globalThis.encodeURIComponent = originalEncodeURIComponent;
    }

    expect(sanitizedText).toBe('provider failed at /callback?code');
    expect(sanitizedUrl).toBe('/callback?code');
    expect(accessorReads).toBe(0);
    expect(scrubbed).toMatchObject({
      accessor: '[redacted]',
      error: { cause: '[secret]', token: '[secret]' },
      nested: ['[secret]'],
      url: absolute,
    });
    expect(JSON.stringify(scrubbed)).not.toContain('sk_live_nested_logger_secret');
  });
});
