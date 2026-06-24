import { afterEach, describe, expect, it } from 'vitest';

import {
  CookieDowngradeError,
  drainCookieDowngradeFacts,
  normalizeForwardedSetCookie,
  serializeCookie,
  unsafeCookie,
  validateRawSetCookie,
} from './cookies.js';

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

  // SF Phase 5 (SPEC §6.6/§9.1): a caller that passes no `class` keeps exact legacy behavior so the
  // floor is opt-in by declaring a class (no surprise attribute injection on existing callers).
  it('leaves classless cookies as a pure legacy passthrough (no forced floor)', () => {
    expect(serializeCookie('sid', 'tok', { partitioned: true })).toBe('sid=tok; Partitioned');
    expect(serializeCookie('theme', 'dark')).toBe('theme=dark');
  });
});

describe('cookie security floor (SF Phase 5, SPEC §6.6/§9.1)', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    drainCookieDowngradeFacts();
  });

  it('forces HttpOnly + SameSite=Lax on a session cookie by default; no Secure in dev', () => {
    process.env.NODE_ENV = 'development';
    const cookie = serializeCookie('sid', 'abc', { class: 'session' });
    // Dev: HttpOnly + SameSite present, but NO Secure (else localhost-http login breaks) and so no
    // __Host- prefix (which requires Secure).
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
    expect(cookie.startsWith('sid=')).toBe(true);
    expect(cookie).toContain('Path=/');
  });

  it('forces Secure + a __Host- prefix on a session cookie in production', () => {
    process.env.NODE_ENV = 'production';
    const cookie = serializeCookie('sid', 'abc', { class: 'session' });
    expect(cookie.startsWith('__Host-sid=')).toBe(true);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
  });

  it('uses __Secure- (not __Host-) when a Domain is set in production', () => {
    process.env.NODE_ENV = 'production';
    const cookie = serializeCookie('sid', 'abc', { class: 'auth', domain: 'example.com' });
    expect(cookie.startsWith('__Secure-sid=')).toBe(true);
    expect(cookie).toContain('Secure');
  });

  it('honors productionSecure override to force Secure independent of NODE_ENV', () => {
    process.env.NODE_ENV = 'development';
    const cookie = serializeCookie('sid', 'abc', { class: 'session', productionSecure: true });
    expect(cookie).toContain('Secure');
    expect(cookie.startsWith('__Host-sid=')).toBe(true);
  });

  it('defaults SameSite for app-data class but does not force HttpOnly/Secure', () => {
    process.env.NODE_ENV = 'production';
    const cookie = serializeCookie('theme', 'dark', { class: 'app-data' });
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('HttpOnly');
    expect(cookie).not.toContain('Secure');
    expect(cookie.startsWith('theme=')).toBe(true);
  });

  // KV432: an explicit insecure downgrade of a credential cookie without the audited escape rejects.
  it('emits KV432 (rejects) on an HttpOnly=false downgrade without unsafeCookie', () => {
    expect(() => serializeCookie('sid', 'abc', { class: 'session', httpOnly: false })).toThrow(
      CookieDowngradeError,
    );
    expect(() => serializeCookie('sid', 'abc', { class: 'session', httpOnly: false })).toThrow(
      'KV432',
    );
  });

  it('emits KV432 on a SameSite=None downgrade without unsafeCookie', () => {
    expect(() => serializeCookie('sid', 'abc', { class: 'auth', sameSite: 'none' })).toThrow(
      CookieDowngradeError,
    );
  });

  it('emits KV432 on a Secure=false downgrade in production without unsafeCookie', () => {
    process.env.NODE_ENV = 'production';
    expect(() => serializeCookie('sid', 'abc', { class: 'session', secure: false })).toThrow(
      'KV432',
    );
  });

  it('does NOT treat secure:false in dev as a downgrade (dev login must keep working)', () => {
    process.env.NODE_ENV = 'development';
    expect(() =>
      serializeCookie('sid', 'abc', { class: 'session', secure: false }),
    ).not.toThrow();
  });

  it('allows a downgrade with unsafeCookie and records a justification fact', () => {
    drainCookieDowngradeFacts();
    const cookie = serializeCookie('embed_sid', 'abc', {
      class: 'session',
      sameSite: 'none',
      productionSecure: true,
      unsafe: unsafeCookie({
        downgrade: { sameSite: 'none' },
        justification: 'third-party checkout iframe',
      }),
    });
    expect(cookie).toContain('SameSite=None');
    const facts = drainCookieDowngradeFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      class: 'session',
      justification: 'third-party checkout iframe',
      name: 'embed_sid',
    });
  });

  it('rejects unsafeCookie without a justification', () => {
    expect(() => unsafeCookie({ downgrade: { httpOnly: false }, justification: '   ' })).toThrow(
      'KV432',
    );
  });

  // Forwarded better-auth Set-Cookie normalization through the floor (preserve Partitioned/Priority).
  it('normalizes a forwarded Set-Cookie up to the session floor, preserving Partitioned/Priority', () => {
    process.env.NODE_ENV = 'production';
    const normalized = normalizeForwardedSetCookie(
      'better-auth.session=tok; Path=/; Priority=High; Partitioned',
      'session',
    );
    expect(normalized).toContain('better-auth.session=tok');
    expect(normalized).toContain('HttpOnly');
    expect(normalized).toContain('Secure');
    expect(normalized).toContain('SameSite=Lax');
    expect(normalized).toContain('Priority=High');
    expect(normalized).toContain('Partitioned');
  });

  it('preserves an upstream SameSite=None embed cookie and pairs it with Secure', () => {
    const normalized = normalizeForwardedSetCookie(
      'session=tok; Path=/; SameSite=None; Partitioned',
      'session',
    );
    expect(normalized).toContain('SameSite=None');
    expect(normalized).toContain('Secure');
    expect(normalized).toContain('Partitioned');
  });
});
