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
      // `class: 'app-data'` keeps this focused on attribute serialization mechanics — a classless
      // cookie now fails closed to the credential floor (L1), which would add the __Secure- prefix
      // here (Domain set) and is exercised by the dedicated floor tests below.
      serializeCookie('kovo_csrf', 'c1', {
        class: 'app-data',
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
    // (explicit `class: 'app-data'` — a classless cookie now fails closed to the credential floor, L1)
    expect(serializeCookie('name', 'bad;value', { class: 'app-data' })).toBe(
      'name=bad%3Bvalue; SameSite=Lax',
    );
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
    expect(serializeCookie('sid', 'tok', { partitioned: true })).toBe(
      'sid=tok; Path=/; HttpOnly; SameSite=Lax; Partitioned',
    );
    expect(() =>
      serializeCookie('sid', 'tok', {
        httpOnly: true,
        partitioned: true,
        path: '/',
        sameSite: 'none',
        secure: true,
      }),
    ).toThrow(CookieDowngradeError);
    expect(
      serializeCookie('embed', 'tok', {
        class: 'app-data',
        httpOnly: true,
        partitioned: true,
        path: '/',
        sameSite: 'none',
        secure: true,
      }),
    ).toBe('embed=tok; Path=/; HttpOnly; Secure; SameSite=None; Partitioned');
    expect(serializeCookie('pref', 'tok', { class: 'app-data', priority: 'high' })).toBe(
      'pref=tok; SameSite=Lax; Priority=High',
    );
    expect(serializeCookie('pref', 'tok', { class: 'app-data', priority: 'medium' })).toBe(
      'pref=tok; SameSite=Lax; Priority=Medium',
    );
  });

  // B2: SPEC §9.1.1:846 — typed builder must percent-encode the value.
  it('percent-encodes cookie values so special characters cannot inject cookies (B2)', () => {
    expect(serializeCookie('pref', 'a b,c=d', { class: 'app-data' })).toBe(
      'pref=a%20b%2Cc%3Dd; SameSite=Lax',
    );
    // round-trip: decodeURIComponent recovers the original value
    const serialized = serializeCookie('pref', 'a b,c=d', { class: 'app-data' });
    const encodedValue = serialized.split(';')[0]?.split('=').slice(1).join('=') ?? '';
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

  // L1 (SPEC §2 default-deny over default-allow, §6.6/§9.1): an OMITTED `class` fails CLOSED to the
  // credential floor, never the client-readable app-data floor. Shipping a client-readable cookie
  // must be an explicit `class: 'app-data'`. The old name-guessing `inferCookieClass` is deleted.
  it('fails closed: a classless cookie gets the credential floor regardless of name (L1)', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'development';
      // Names that the old heuristic would NOT have matched (so previously shipped insecure as
      // app-data) now get HttpOnly + Path=/ by default. No `class`, no fail-open.
      for (const name of ['theme', 'access_token', 'jwt', 'bearer', 'token', 'whatever']) {
        const cookie = serializeCookie(name, 'v');
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('Path=/');
        expect(cookie).toContain('SameSite=Lax');
      }
      // Dev: no Secure (localhost-http) and so no __Host- prefix.
      expect(serializeCookie('theme', 'dark')).toBe('theme=dark; Path=/; HttpOnly; SameSite=Lax');

      // Production: the classless credential floor forces Secure + the __Host- prefix.
      process.env.NODE_ENV = 'production';
      expect(serializeCookie('access_token', 'tok')).toBe(
        '__Host-access_token=tok; Path=/; HttpOnly; Secure; SameSite=Lax',
      );
      expect(serializeCookie('sid', 'tok')).toBe(
        '__Host-sid=tok; Path=/; HttpOnly; Secure; SameSite=Lax',
      );
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  // L1: a client-readable cookie is opt-in and explicit — `class: 'app-data'` is the only way to
  // ship a cookie without the HttpOnly/Secure floor.
  it('requires an explicit class: "app-data" to ship a client-readable cookie (L1)', () => {
    // app-data is environment-independent: no env-gated Secure, no __Host- prefix.
    const cookie = serializeCookie('theme', 'dark', { class: 'app-data' });
    expect(cookie).toBe('theme=dark; SameSite=Lax');
    expect(cookie).not.toContain('HttpOnly');
    expect(cookie).not.toContain('Secure');
    expect(serializeCookie('theme', 'dark', { class: 'app-data', sameSite: 'strict' })).toBe(
      'theme=dark; SameSite=Strict',
    );
  });

  // L2 (SPEC §9.1.1): an app-data cookie with SameSite=None is auto-paired with Secure so browsers
  // do not silently drop it — mirroring the credential and forwarded paths. Previously the app-data
  // branch returned `secure: options.secure` verbatim, emitting `SameSite=None` without `Secure`.
  it('pairs an app-data SameSite=None cookie with Secure (L2)', () => {
    // Environment-independent: the Secure pairing follows SameSite=None, not NODE_ENV.
    const cookie = serializeCookie('theme', 'dark', { class: 'app-data', sameSite: 'none' });
    expect(cookie).toBe('theme=dark; Secure; SameSite=None');
    expect(cookie).toContain('Secure');
    // An explicit secure:true is preserved (no double-forcing); a non-None app-data cookie is
    // unaffected and stays Secure-free in dev.
    expect(serializeCookie('theme', 'dark', { class: 'app-data' })).not.toContain('Secure');
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

  // L1 (SPEC §6.6/§9.1): an HTTPS-request signal (`secure: true`) forces the credential Secure floor
  // (+ __Host- prefix) even when NODE_ENV is not production — the floor no longer depends SOLELY on
  // the env string. The dev-localhost carve-out (plain http, no signal) still omits Secure.
  it('forces Secure + __Host- on an HTTPS request signal independent of NODE_ENV (L1)', () => {
    process.env.NODE_ENV = 'development';
    const cookie = serializeCookie('sid', 'abc', { class: 'session', secure: true });
    expect(cookie).toContain('Secure');
    expect(cookie.startsWith('__Host-sid=')).toBe(true);
    // Control: dev plain-http (no signal) keeps the carve-out — no Secure, no prefix.
    expect(serializeCookie('sid', 'abc', { class: 'session' })).toBe(
      'sid=abc; Path=/; HttpOnly; SameSite=Lax',
    );
  });

  // M1 (SPEC §6.6/§9.1, KV432): `productionSecure:false` is a credential Secure downgrade routed
  // through the SAME KV432 throw as `secure:false`. BEFORE the fix it flowed into
  // `resolveProductionSecure()` → effective secure=false with NO throw and NO recorded fact, even
  // under NODE_ENV=production (an un-audited insecure session cookie). It must now reject.
  it('emits KV432 on a productionSecure:false credential downgrade in production (M1)', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      serializeCookie('sid', 'abc', { class: 'session', productionSecure: false }),
    ).toThrow(CookieDowngradeError);
    expect(() => serializeCookie('sid', 'abc', { class: 'auth', productionSecure: false })).toThrow(
      'KV432',
    );
    // The downgrade must not have silently emitted a no-Secure cookie + no audit fact (old behavior).
    expect(drainCookieDowngradeFacts()).toEqual([]);
    // A forced HTTPS signal (`secure: true`) also makes `productionSecure:false` a downgrade in dev.
    process.env.NODE_ENV = 'development';
    expect(() =>
      serializeCookie('sid', 'abc', { class: 'session', secure: true, productionSecure: false }),
    ).toThrow('KV432');
    // Dev plain-http: `productionSecure:false` suppresses a floor that is not engaged, so it is the
    // dev default (a no-op), not a downgrade — consistent with `secure:false` in dev.
    expect(() =>
      serializeCookie('sid', 'abc', { class: 'session', productionSecure: false }),
    ).not.toThrow();
  });

  // M1: a `productionSecure:false` downgrade is expressible ONLY through the audited unsafeCookie
  // escape, which records a downgrade fact for `kovo explain --cookies` (no silent suppression).
  it('records an audited fact for a justified productionSecure:false downgrade (M1)', () => {
    process.env.NODE_ENV = 'production';
    drainCookieDowngradeFacts();
    const cookie = serializeCookie('sid', 'abc', {
      class: 'session',
      productionSecure: false,
      unsafe: unsafeCookie({
        downgrade: { secure: false },
        justification: 'TLS terminates at an internal LB; cookie stays on the private hop',
      }),
    });
    expect(cookie).not.toContain('Secure');
    expect(cookie.startsWith('sid=')).toBe(true);
    const facts = drainCookieDowngradeFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ class: 'session', name: 'sid' });
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
    expect(() => serializeCookie('sid', 'abc', { class: 'session', secure: false })).not.toThrow();
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

  it('requires unsafeCookie to exactly match the downgraded credential attributes', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      serializeCookie('sid', 'abc', {
        class: 'session',
        httpOnly: false,
        sameSite: 'none',
        secure: false,
        unsafe: unsafeCookie({
          downgrade: {},
          justification: 'too broad',
        }),
      }),
    ).toThrow(CookieDowngradeError);
    expect(() =>
      serializeCookie('sid', 'abc', {
        class: 'session',
        httpOnly: false,
        sameSite: 'none',
        secure: false,
        unsafe: unsafeCookie({
          downgrade: { httpOnly: false, sameSite: 'none', secure: false },
          justification: 'legacy embedded session endpoint',
        }),
      }),
    ).not.toThrow();

    const facts = drainCookieDowngradeFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0]?.downgrade).toEqual({
      httpOnly: false,
      sameSite: 'none',
      secure: false,
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
