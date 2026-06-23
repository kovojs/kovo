import { describe, expect, it } from 'vitest';

import { csrfField, csrfToken, renderMutationCsrfField, validateCsrfToken } from './csrf.js';
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
      headers: { Cookie: cookiePair },
      method: 'POST',
    });

    expect(validateCsrfToken({ csrf: submitted }, postRequest, anonymousCsrf)).toBe(true);
    expect(validateCsrfToken({ csrf: `${submitted}x` }, postRequest, anonymousCsrf)).toBe(false);
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
