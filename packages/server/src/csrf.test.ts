import { describe, expect, it } from 'vitest';

import {
  csrfField,
  csrfToken,
  renderMutationCsrfField,
  validateCsrfToken,
  verifyCsrfRequestOriginFloor,
} from './csrf.js';
import { runWithJsxRequestContext } from './jsx-context.js';
import {
  mutation as defineMutation,
  renderMutationResponse,
  renderNoJsMutationResponse,
  runMutation,
} from './mutation.js';
import type { MutationReplayStore } from './replay.js';
import { s } from './schema.js';

describe('csrf helpers', () => {
  const request = { sessionId: 'session-1' };
  const csrf = {
    field: 'csrf<input>',
    secret: 'secret',
    sessionId(input: typeof request): string | undefined {
      return input.sessionId;
    },
  };

  it('renders an escaped hidden field for the signed session token', () => {
    const token = csrfToken(request, csrf);

    expect(csrfField(request, csrf)).toBe(
      `<input type="hidden" name="csrf&lt;input&gt;" value="${token}">`,
    );
  });

  it('validates only the matching token for the configured field', () => {
    const token = csrfToken(request, csrf);

    expect(validateCsrfToken({ 'csrf<input>': token }, request, csrf)).toBe(true);
    expect(validateCsrfToken({ 'csrf<input>': `${token}x` }, request, csrf)).toBe(false);
    expect(validateCsrfToken({ 'csrf<input>': token }, { sessionId: '' }, csrf)).toBe(false);
  });

  it('renders and validates anonymous CSRF tokens bound to the framework cookie', () => {
    const anonymousCsrf = {
      field: 'csrf',
      secret: 'anonymous-secret',
      sessionId() {
        return undefined;
      },
    };
    const setCookies: string[] = [];
    const pageRequest = new Request('https://shop.example.test/login');

    const html = runWithJsxRequestContext(
      pageRequest,
      { onCsrfSetCookie: (cookie) => setCookies.push(cookie) },
      () => renderMutationCsrfField({ csrf: anonymousCsrf, key: 'auth/sign-in' }),
    );
    if (typeof html !== 'string') throw new TypeError('expected synchronous CSRF field render');

    expect(html).toContain('name="csrf"');
    expect(setCookies).toHaveLength(1);
    expect(setCookies[0]).toContain('kovo_csrf=');
    expect(setCookies[0]).toContain('HttpOnly');
    expect(setCookies[0]).toContain('SameSite=Lax');

    const cookiePair = setCookies[0]!.split(';')[0]!;
    const submitted = /value="([^"]+)"/.exec(html)?.[1];
    expect(submitted).toBeDefined();
    const postRequest = new Request('https://shop.example.test/_m/auth/sign-in', {
      headers: { Cookie: cookiePair, Origin: 'https://shop.example.test' },
      method: 'POST',
    });

    expect(validateCsrfToken({ csrf: submitted }, postRequest, anonymousCsrf)).toBe(true);
    expect(validateCsrfToken({ csrf: `${submitted}x` }, postRequest, anonymousCsrf)).toBe(false);
  });

  // SPEC §6.6/§9.1: the framework's anonymous CSRF cookie declares `class: 'session'`, so the
  // credential floor (HttpOnly + Secure(prod) + SameSite) is default-on at the `serializeCookie`
  // sink rather than relying on a per-call-site `httpOnly: true`. This is a runtime
  // defense-in-depth floor — sound at that sink, bypassable by same-process raw `Set-Cookie`.
  const anonymousCsrf = {
    field: 'csrf',
    secret: 'anonymous-secret',
    sessionId(): string | undefined {
      return undefined;
    },
  };

  function mintAnonymousCsrfCookie(pageRequest: Request): string {
    const setCookies: string[] = [];
    const html = runWithJsxRequestContext(
      pageRequest,
      { onCsrfSetCookie: (cookie) => setCookies.push(cookie) },
      () => renderMutationCsrfField({ csrf: anonymousCsrf, key: 'auth/sign-in' }),
    );
    if (typeof html !== 'string') throw new TypeError('expected synchronous CSRF field render');
    return setCookies[0]!;
  }

  it('floors the anonymous CSRF cookie with HttpOnly + SameSite=Lax by default (class: session)', () => {
    // HTTPS request: Secure is in effect, so the `__Host-` browser-prefix is applied by the floor.
    const cookie = mintAnonymousCsrfCookie(new Request('https://shop.example.test/login'));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    // Credential class adds the `__Host-` prefix once Secure holds (Path=/, no Domain).
    expect(cookie).toMatch(/^__Host-kovo_csrf=/);
    expect(cookie).toContain('Path=/');
  });

  it('forces Secure in production even when the request URL is plain http', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const cookie = mintAnonymousCsrfCookie(new Request('http://shop.example.test/login'));
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('HttpOnly');
      // With Secure forced by prod, the `__Host-` prefix applies even on an http request URL.
      expect(cookie).toMatch(/^__Host-kovo_csrf=/);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('omits Secure on localhost-http dev and round-trips the bare cookie name', () => {
    // Dev: http request URL, NODE_ENV not production → no Secure, no `__Host-` prefix.
    const cookie = mintAnonymousCsrfCookie(new Request('http://localhost:3000/login'));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
    expect(cookie).toMatch(/^kovo_csrf=/);

    // The bare (unprefixed) cookie still round-trips through validation in dev.
    const cookiePair = cookie.split(';')[0]!;
    const postRequest = new Request('http://localhost:3000/_m/auth/sign-in', {
      headers: { Cookie: cookiePair, Origin: 'http://localhost:3000' },
      method: 'POST',
    });
    // Re-mint the token bound to the same cookie value to validate the round-trip.
    const html = runWithJsxRequestContext(postRequest, { onCsrfSetCookie: () => {} }, () =>
      renderMutationCsrfField({ csrf: anonymousCsrf, key: 'auth/sign-in' }),
    );
    if (typeof html !== 'string') throw new TypeError('expected synchronous CSRF field render');
    const token = /value="([^"]+)"/.exec(html)![1]!;
    expect(validateCsrfToken({ csrf: token }, postRequest, anonymousCsrf)).toBe(true);
  });
});

describe('mutation CSRF enforcement', () => {
  it('validates mutation CSRF tokens before running guards', async () => {
    const request = { session: { id: 's1' } };
    const csrf = {
      field: 'csrf',
      secret: 'test-secret',
      sessionId(candidate: typeof request) {
        return candidate.session.id;
      },
    };
    let guardCalls = 0;
    const addToCart = defineMutation('cart/add', {
      csrf,
      guard() {
        guardCalls += 1;
        return true;
      },
      input: s.object({ productId: s.string() }),
      handler(input) {
        return input.productId;
      },
    });
    const token = csrfToken(request, csrf);

    expect(csrfField(request, csrf)).toBe(`<input type="hidden" name="csrf" value="${token}">`);
    await expect(
      runMutation(addToCart, { csrf: token, productId: 'p1' }, request),
    ).resolves.toMatchObject({
      ok: true,
      value: 'p1',
    });
    expect(guardCalls).toBe(1);

    await expect(runMutation(addToCart, { productId: 'p1' }, request)).resolves.toEqual({
      error: { code: 'CSRF', payload: {} },
      ok: false,
      status: 422,
    });
    expect(guardCalls).toBe(1);
  });

  it('uses default mutation CSRF options before schema parsing when csrf is omitted', async () => {
    const request = { session: { id: 's1' } };
    const csrf = {
      field: 'csrf',
      secret: 'test-secret',
      sessionId(candidate: typeof request) {
        return candidate.session.id;
      },
    };
    const addToCart = defineMutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input, _request: typeof request) {
        return input.productId;
      },
    });

    await expect(runMutation(addToCart, {}, request, { csrf })).resolves.toEqual({
      error: { code: 'CSRF', payload: {} },
      ok: false,
      status: 422,
    });

    await expect(
      runMutation(addToCart, { csrf: csrfToken(request, csrf) }, request, { csrf }),
    ).resolves.toEqual({
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected string', path: ['productId'] }] },
      },
      ok: false,
      status: 422,
    });
  });

  it('fails closed before handlers when csrf is omitted and no default options are provided', async () => {
    let writes = 0;
    const addToCart = defineMutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        writes += 1;
        return input.productId;
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1' }, {})).resolves.toEqual({
      error: { code: 'CSRF', payload: {} },
      ok: false,
      status: 422,
    });
    expect(writes).toBe(0);
  });

  it('preserves legacy mutation execution when csrf is explicitly false', async () => {
    const addToCart = defineMutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1' }, {})).resolves.toMatchObject({
      ok: true,
      value: 'p1',
    });
  });

  it('does not consult replay records before default CSRF validation', async () => {
    const request = { session: { id: 's1' } };
    const csrf = {
      field: 'csrf',
      secret: 'test-secret',
      sessionId(candidate: typeof request) {
        return candidate.session.id;
      },
    };
    let getCalls = 0;
    let writes = 0;
    const replayStore: MutationReplayStore = {
      get() {
        getCalls += 1;
        return {
          body: '<kovo-query name="cart">{"count":999}</kovo-query>',
          headers: {},
          status: 200,
        };
      },
      reserve() {
        throw new Error('replay reserve should not run before CSRF validation');
      },
      set() {},
    };
    const addToCart = defineMutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input, _request: typeof request) {
        writes += 1;
        return input.productId;
      },
    });

    const response = await renderMutationResponse(addToCart, {
      csrf,
      idem: 'idem_01',
      rawInput: { productId: 'p1' },
      replayStore,
      request,
    });

    expect(getCalls).toBe(0);
    expect(writes).toBe(0);
    expect(response).toMatchObject({ status: 422 });
    expect(response.body).toContain('data-error-code="CSRF"');
  });

  // G2 (SPEC §6.6:735): the no-JS mutation path must validate CSRF FIRST — before the
  // guard lifecycle and before any replay reservation — mirroring the wire path
  // (renderMutationResponse). A CSRF-invalid POST must NOT increment a stateful guard
  // (rateLimit budget exhaustion) or occupy a replay slot.
  it('G2: no-JS path validates CSRF before running guards or reserving replay', async () => {
    const request = { session: { id: 's1' } };
    const csrf = {
      field: 'csrf',
      secret: 'test-secret',
      sessionId(candidate: typeof request) {
        return candidate.session.id;
      },
    };
    let guardRuns = 0;
    let handlerRuns = 0;
    let storeTouches = 0;
    const replayStore = {
      get(): never {
        storeTouches += 1;
        throw new Error('replay get must not run before CSRF validation');
      },
      reserve(): never {
        storeTouches += 1;
        throw new Error('replay reserve must not run before CSRF validation');
      },
    };
    const addToCart = defineMutation('cart/add', {
      csrf,
      guard: () => {
        guardRuns += 1;
        return true;
      },
      input: s.object({ productId: s.string() }),
      handler(input: { productId: string }) {
        handlerRuns += 1;
        return input.productId;
      },
    });

    const response = await renderNoJsMutationResponse(addToCart, {
      idem: 'idem_g2',
      // No 'csrf' field in the body → CSRF validation must fail.
      rawInput: { 'Kovo-Idem': 'idem_g2', productId: 'p1' },
      redirectTo: '/cart',
      replayStore,
      request,
    });

    expect(guardRuns).toBe(0);
    expect(handlerRuns).toBe(0);
    expect(storeTouches).toBe(0);
    expect(response.status).toBe(422);
    expect(response.body).toContain('data-error-code="CSRF"');
  });
});

// SF Tier 1 (SPEC §6.6/§9.1): the header-based CSRF floor — runs BEFORE the synchronizer-token
// check on unsafe real Request paths, requiring a usable same-origin or trusted Origin.
describe('CSRF Origin / Sec-Fetch-Site floor', () => {
  const csrf = { trustedOrigins: [] as readonly string[] };

  function post(headers: Record<string, string>): Request {
    return new Request('https://shop.example.test/_m/cart/add', { headers, method: 'POST' });
  }

  it('rejects an unsafe-verb request without Origin even when Sec-Fetch-Site is cross-site', () => {
    expect(verifyCsrfRequestOriginFloor(post({ 'sec-fetch-site': 'cross-site' }), csrf)).toBe(
      false,
    );
  });

  it('rejects missing, empty, and null Origin on unsafe-verb requests', () => {
    expect(verifyCsrfRequestOriginFloor(post({}), csrf)).toBe(false);
    expect(verifyCsrfRequestOriginFloor(post({ origin: '' }), csrf)).toBe(false);
    expect(verifyCsrfRequestOriginFloor(post({ origin: 'null' }), csrf)).toBe(false);
  });

  it('does not allow same-origin / same-site / none Sec-Fetch-Site without Origin', () => {
    expect(verifyCsrfRequestOriginFloor(post({ 'sec-fetch-site': 'same-origin' }), csrf)).toBe(
      false,
    );
    expect(verifyCsrfRequestOriginFloor(post({ 'sec-fetch-site': 'same-site' }), csrf)).toBe(false);
    expect(verifyCsrfRequestOriginFloor(post({ 'sec-fetch-site': 'none' }), csrf)).toBe(false);
  });

  it('rejects a cross-origin Origin not in trustedOrigins', () => {
    expect(verifyCsrfRequestOriginFloor(post({ origin: 'https://evil.example.test' }), csrf)).toBe(
      false,
    );
  });

  it('allows a same-origin Origin', () => {
    expect(verifyCsrfRequestOriginFloor(post({ origin: 'https://shop.example.test' }), csrf)).toBe(
      true,
    );
  });

  it('honors the trustedOrigins allowlist for a cross-origin Origin', () => {
    expect(
      verifyCsrfRequestOriginFloor(post({ origin: 'https://app.example.test' }), {
        trustedOrigins: ['https://app.example.test'],
      }),
    ).toBe(true);
  });

  it('honors the trustedOrigins allowlist even when Fetch Metadata reports cross-site', () => {
    expect(
      verifyCsrfRequestOriginFloor(
        post({ origin: 'https://app.example.test', 'sec-fetch-site': 'cross-site' }),
        {
          trustedOrigins: ['https://app.example.test'],
        },
      ),
    ).toBe(true);
  });

  it('does not gate safe verbs', () => {
    const get = new Request('https://shop.example.test/_q/cart', {
      headers: { 'sec-fetch-site': 'cross-site' },
      method: 'GET',
    });
    expect(verifyCsrfRequestOriginFloor(get, csrf)).toBe(true);
  });

  it('does not gate plain-object request shapes (direct runMutation API)', () => {
    expect(verifyCsrfRequestOriginFloor({ session: { id: 's1' } }, csrf)).toBe(true);
  });

  // Integration through validateCsrfToken: the floor rejects no-Origin POSTs even with a token
  // that would otherwise pass, and allowed Origin requests still need a valid token.
  it('validateCsrfToken rejects no-Origin unsafe-verb requests before the token check', () => {
    const anonymousCsrf = {
      field: 'csrf',
      secret: 'anon',
      sessionId: () => undefined,
    };
    const setCookies: string[] = [];
    const pageRequest = new Request('https://shop.example.test/login');
    const html = runWithJsxRequestContext(
      pageRequest,
      { onCsrfSetCookie: (c) => setCookies.push(c) },
      () => renderMutationCsrfField({ csrf: anonymousCsrf, key: 'auth/sign-in' }),
    );
    if (typeof html !== 'string') throw new TypeError('expected synchronous CSRF field render');
    const cookiePair = setCookies[0]!.split(';')[0]!;
    const token = /value="([^"]+)"/.exec(html)![1]!;

    const noOrigin = new Request('https://shop.example.test/_m/auth/sign-in', {
      headers: { Cookie: cookiePair, 'sec-fetch-site': 'none' },
      method: 'POST',
    });
    // Token would otherwise validate; the Origin floor rejects first.
    expect(validateCsrfToken({ csrf: token }, noOrigin, anonymousCsrf)).toBe(false);

    const sameOrigin = new Request('https://shop.example.test/_m/auth/sign-in', {
      headers: {
        Cookie: cookiePair,
        Origin: 'https://shop.example.test',
        'sec-fetch-site': 'same-origin',
      },
      method: 'POST',
    });
    expect(validateCsrfToken({ csrf: token }, sameOrigin, anonymousCsrf)).toBe(true);
    expect(validateCsrfToken({ csrf: `${token}x` }, sameOrigin, anonymousCsrf)).toBe(false);

    const trustedOrigin = new Request('https://shop.example.test/_m/auth/sign-in', {
      headers: {
        Cookie: cookiePair,
        Origin: 'https://app.example.test',
        'sec-fetch-site': 'cross-site',
      },
      method: 'POST',
    });
    expect(
      validateCsrfToken({ csrf: token }, trustedOrigin, {
        ...anonymousCsrf,
        trustedOrigins: ['https://app.example.test'],
      }),
    ).toBe(true);
    expect(
      validateCsrfToken({ csrf: `${token}x` }, trustedOrigin, {
        ...anonymousCsrf,
        trustedOrigins: ['https://app.example.test'],
      }),
    ).toBe(false);
  });
});
