import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { preDispatchLoadShedResponse } from './app-load-shed.js';
import { guards, sanitizeNext } from './guards.js';
import {
  requestStateExactCompositeKey,
  requestStateHeaderGet,
  requestStateIsSafeInteger,
  requestStateLocationWithQuery,
  requestStateNow,
  requestStateParseUnsignedInteger,
  requestStateRequiredRateLimitKey,
  requestStateRetryAfterSeconds,
  requestStateRightmostForwardedForValue,
  requestStateRightmostHeaderListValue,
  requestStateSameOriginPath,
} from './request-state-intrinsics.js';

const moduleUrl = new URL('./request-state-intrinsics.ts', import.meta.url).href;

describe('request-state intrinsic membrane', () => {
  it('pins clocks, numeric checks, client keys, headers, and URL scalars after late poisoning', () => {
    const originalDateNow = Date.now;
    const originalHeadersGet = Headers.prototype.get;
    const originalIsSafeInteger = Number.isSafeInteger;
    const originalMathCeil = Math.ceil;
    const originalRegExpExec = RegExp.prototype.exec;
    const originalStartsWith = String.prototype.startsWith;
    const originalTrim = String.prototype.trim;
    const OriginalURL = globalThis.URL;
    const before = originalDateNow();
    let result:
      | {
          clock: number;
          exactKeysDiffer: boolean;
          forwarded: string | undefined;
          header: string | null;
          list: string | undefined;
          location: string;
          parsed: number | undefined;
          retry: number;
          safeInteger: boolean;
          safePath: string | undefined;
          trimmedKey: string;
        }
      | undefined;

    try {
      Date.now = () => before + 365 * 24 * 60 * 60_000;
      Headers.prototype.get = () => 'forged';
      Number.isSafeInteger = () => true;
      Math.ceil = () => 0;
      RegExp.prototype.exec = () => ['forged', 'evil.example'] as unknown as RegExpExecArray;
      String.prototype.startsWith = () => true;
      String.prototype.trim = () => 'forged';
      globalThis.URL = class extends OriginalURL {
        constructor() {
          super('https://evil.example/phish');
        }
      } as typeof URL;

      result = {
        clock: requestStateNow(),
        exactKeysDiffer:
          requestStateExactCompositeKey('scope\0idem', 'tail') !==
          requestStateExactCompositeKey('scope', 'idem\0tail'),
        forwarded: requestStateRightmostForwardedForValue(
          'for=192.0.2.1, proto=https; for="203.0.113.9"',
        ),
        header: requestStateHeaderGet(new Headers({ 'X-Test': 'accepted' }), 'x-test'),
        list: requestStateRightmostHeaderListValue('192.0.2.1, 203.0.113.9'),
        location: requestStateLocationWithQuery('/login', 'https://kovo.local', 'next', '/safe'),
        parsed: requestStateParseUnsignedInteger('1234'),
        retry: requestStateRetryAfterSeconds(59_001),
        safeInteger: requestStateIsSafeInteger(1.5),
        safePath: requestStateSameOriginPath('//evil.example/phish', 'https://kovo.local'),
        trimmedKey: requestStateRequiredRateLimitKey(' 203.0.113.9 ', 'test client-key resolver'),
      };
    } finally {
      Date.now = originalDateNow;
      Headers.prototype.get = originalHeadersGet;
      Number.isSafeInteger = originalIsSafeInteger;
      Math.ceil = originalMathCeil;
      RegExp.prototype.exec = originalRegExpExec;
      String.prototype.startsWith = originalStartsWith;
      String.prototype.trim = originalTrim;
      globalThis.URL = OriginalURL;
    }

    expect(result).toEqual({
      clock: expect.any(Number),
      exactKeysDiffer: true,
      forwarded: '203.0.113.9',
      header: 'accepted',
      list: '203.0.113.9',
      location: '/login?next=%2Fsafe',
      parsed: 1234,
      retry: 60,
      safeInteger: false,
      safePath: undefined,
      trimmedKey: '203.0.113.9',
    });
    expect(result!.clock).toBeGreaterThanOrEqual(before);
    expect(result!.clock).toBeLessThan(before + 60_000);
  });

  it('keeps app and guard limiter truth after selective collection and clock poisoning', () => {
    const app = createApp({
      requestLimits: {
        global: { max: 1, maxKeys: 2, windowMs: 60_000 },
        mutations: {},
        queries: {},
      },
    });
    const request = () => new Request('https://example.test/protected');
    expect(preDispatchLoadShedResponse(app, request(), 'other')).toBeUndefined();

    const guard = guards.rateLimit<Record<string, never>>({
      key: () => 'client-a',
      max: 1,
      maxKeys: 2,
      windowMs: 60_000,
    });
    expect(guard({})).toBe(true);

    const originalDateNow = Date.now;
    const originalMapDelete = Map.prototype.delete;
    const originalMapForEach = Map.prototype.forEach;
    const originalMapGet = Map.prototype.get;
    const originalMapSet = Map.prototype.set;
    const originalWeakMapGet = WeakMap.prototype.get;
    let appStatus: number | undefined;
    let guardKind: string | undefined;
    try {
      Date.now = () => originalDateNow() + 365 * 24 * 60 * 60_000;
      WeakMap.prototype.get = function (key: object) {
        if ('requestLimits' in key) return undefined;
        return originalWeakMapGet.call(this, key);
      };
      Map.prototype.get = function (key: unknown) {
        if (key === 'all:global' || key === 'global' || key === 'client-a') return undefined;
        return originalMapGet.call(this, key);
      };
      Map.prototype.set = function () {
        return this;
      };
      Map.prototype.delete = () => true;
      Map.prototype.forEach = () => undefined;

      appStatus = preDispatchLoadShedResponse(app, request(), 'other')?.status;
      const guardResult = guard({});
      guardKind = typeof guardResult === 'object' ? guardResult.kind : undefined;
    } finally {
      Date.now = originalDateNow;
      Map.prototype.delete = originalMapDelete;
      Map.prototype.forEach = originalMapForEach;
      Map.prototype.get = originalMapGet;
      Map.prototype.set = originalMapSet;
      WeakMap.prototype.get = originalWeakMapGet;
    }

    expect(appStatus).toBe(429);
    expect(guardKind).toBe('rateLimited');
  });

  it('keeps protocol-relative login targets closed after startsWith and URL replacement', () => {
    const originalStartsWith = String.prototype.startsWith;
    const OriginalURL = globalThis.URL;
    let sanitized: string | undefined;
    try {
      String.prototype.startsWith = function (prefix: string) {
        return prefix === '/';
      };
      globalThis.URL = class extends OriginalURL {
        constructor() {
          super('https://evil.example/phish');
        }
      } as typeof URL;
      sanitized = sanitizeNext('//evil.example/phish');
    } finally {
      String.prototype.startsWith = originalStartsWith;
      globalThis.URL = OriginalURL;
    }
    expect(sanitized).toBe('/');
  });

  it('rejects unsafe limiter numerics and unbounded custom keys through captured controls', () => {
    const originalIsSafeInteger = Number.isSafeInteger;
    try {
      Number.isSafeInteger = () => true;
      expect(() => guards.rateLimit({ max: Number.NaN, per: 'global' })).toThrow(
        /non-negative integer/u,
      );
      expect(() => guards.rateLimit({ max: 1, maxKeys: 0, per: 'global' })).toThrow(
        /positive integer/u,
      );
    } finally {
      Number.isSafeInteger = originalIsSafeInteger;
    }

    const empty = guards.rateLimit<Record<string, never>>({ key: () => '   ', max: 1 });
    const oversized = guards.rateLimit<Record<string, never>>({
      key: () => 'x'.repeat(1_025),
      max: 1,
    });
    expect(() => empty({})).toThrow(/non-empty string/u);
    expect(() => oversized({})).toThrow(/longer than 1024/u);
  });

  it('fails closed when the clock was poisoned before framework initialization', () => {
    const script = `
      const nativeNow = Date.now;
      Date.now = () => nativeNow() + 31536000000;
      const intrinsics = await import(${JSON.stringify(`${moduleUrl}?poisoned-clock-probe`)});
      try {
        intrinsics.assertRequestStateIntrinsics();
      } catch (error) {
        if (String(error).includes('intrinsics were modified')) process.exit(0);
      }
      process.exit(3);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('fails closed when URL controls were replaced before framework initialization', () => {
    const script = `
      const NativeURL = URL;
      globalThis.URL = class extends NativeURL {
        constructor() { super('https://evil.example/phish'); }
      };
      const intrinsics = await import(${JSON.stringify(`${moduleUrl}?poisoned-url-probe`)});
      try {
        intrinsics.assertRequestStateIntrinsics();
      } catch (error) {
        if (String(error).includes('intrinsics were modified')) process.exit(0);
      }
      process.exit(3);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
