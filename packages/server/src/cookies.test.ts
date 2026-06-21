import { describe, expect, it } from 'vitest';

import { serializeCookie, validateRawSetCookie } from './cookies.js';

describe('cookie header helpers', () => {
  it('serializes structured Set-Cookie values', () => {
    expect(
      serializeCookie('kovo_csrf', 'c1', {
        domain: 'example.test',
        expires: new Date('2026-01-02T03:04:05Z'),
        httpOnly: true,
        maxAge: 60,
        path: '/',
        sameSite: 'strict',
        secure: true,
      }),
    ).toBe(
      'kovo_csrf=c1; Max-Age=60; Domain=example.test; Path=/; Expires=Fri, 02 Jan 2026 03:04:05 GMT; HttpOnly; Secure; SameSite=Strict',
    );
  });

  it('rejects invalid cookie names and attributes', () => {
    expect(() => serializeCookie('bad name', 'value')).toThrow('Cookie name must be an HTTP token');
    // B2: semicolons are now percent-encoded rather than rejected; 'bad;value' → 'bad%3Bvalue'
    expect(serializeCookie('name', 'bad;value')).toBe('name=bad%3Bvalue');
    expect(() => serializeCookie('name', 'value', { maxAge: 1.5 })).toThrow(
      'Cookie maxAge must be an integer',
    );
    expect(() => serializeCookie('name', 'value', { path: '/\r\nSet-Cookie: x=y' })).toThrow(
      'cookie path must not contain control characters',
    );
  });

  // part-3 I1 (SPEC §9.1.1:856): the typed builder must be able to emit `Partitioned`
  // (CHIPS) — the correctness-critical attribute for cross-site (`SameSite=None`) login —
  // and `Priority`, so `forwardBetterAuthSetCookie` round-trips them instead of dropping.
  it('emits Partitioned and Priority when set (part-3 I1)', () => {
    expect(serializeCookie('sid', 'tok', { partitioned: true })).toBe('sid=tok; Partitioned');
    expect(
      serializeCookie('sid', 'tok', {
        httpOnly: true,
        partitioned: true,
        path: '/',
        sameSite: 'none',
        secure: true,
      }),
    ).toBe('sid=tok; Path=/; HttpOnly; Secure; SameSite=None; Partitioned');
    expect(serializeCookie('sid', 'tok', { priority: 'high' })).toBe('sid=tok; Priority=High');
    expect(serializeCookie('sid', 'tok', { priority: 'medium' })).toBe('sid=tok; Priority=Medium');
  });

  // B2: SPEC §9.1.1:846 — typed builder must percent-encode the value.
  it('percent-encodes cookie values so special characters cannot inject cookies (B2)', () => {
    expect(serializeCookie('sid', 'a b,c=d')).toBe('sid=a%20b%2Cc%3Dd');
    // round-trip: decodeURIComponent recovers the original value
    const serialized = serializeCookie('sid', 'a b,c=d');
    const encodedValue = serialized.split('=').slice(1).join('=');
    expect(decodeURIComponent(encodedValue)).toBe('a b,c=d');
  });

  // B4: SPEC §9.1.1:846 — reject all C0 control chars and DEL (not just CR/LF/NUL).
  it('rejects all control characters in cookie values (B4)', () => {
    expect(() => serializeCookie('sid', 'a\tb')).toThrow(
      'cookie value must not contain control characters',
    );
    expect(() => serializeCookie('sid', 'a\x01b')).toThrow(
      'cookie value must not contain control characters',
    );
    expect(() => serializeCookie('sid', 'a\x7fb')).toThrow(
      'cookie value must not contain control characters',
    );
  });

  it('rejects CR/LF/NUL in cookie values to prevent header injection (bugs-1 F9)', () => {
    expect(() => serializeCookie('name', 'a\r\nSet-Cookie: evil=1')).toThrow(
      'cookie value must not contain control characters',
    );
    expect(() => serializeCookie('name', 'a\nb')).toThrow(
      'cookie value must not contain control characters',
    );
    expect(() => serializeCookie('name', 'a\0b')).toThrow(
      'cookie value must not contain control characters',
    );
  });

  it('rejects empty or control-character raw Set-Cookie headers', () => {
    expect(() => validateRawSetCookie('')).toThrow(
      'ctx.setCookie requires a non-empty Set-Cookie value',
    );
    expect(() => validateRawSetCookie('a=b\nSet-Cookie: c=d')).toThrow(
      'Set-Cookie must not contain control characters',
    );
    expect(() => validateRawSetCookie('a=b\0')).toThrow(
      'Set-Cookie must not contain control characters',
    );
  });
});
