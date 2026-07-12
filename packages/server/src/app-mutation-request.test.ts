import { describe, expect, it, vi } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

import { createApp } from './app.js';
import { handleAppMutationRequest } from './app-mutation-request.js';
import { csrfToken } from './csrf.js';
import { domain } from './domain.js';
import { guards } from './guards.js';
import { stylesheet } from './hints.js';
import { mutation } from './mutation.js';
import { query } from './query.js';
import { route } from './route.js';
import { s } from './schema.js';
import { createLiveTargetAttestation } from './mutation-wire.js';

function attestedLiveTargetHeader(
  target: string,
  component: string,
  props: Record<string, unknown> = {},
): string {
  const token = createLiveTargetAttestation({ component, props, target }, { request: {} });
  return `${target}#${component}@${token}:${JSON.stringify(props)}`;
}

describe('server app mutation request boundary', () => {
  it('uses the pinned request method classifier after app prototype poisoning', async () => {
    const handler = vi.fn(() => ({ ok: true }));
    const app = createApp({
      mutations: [
        mutation('method/write', {
          csrf: false,
          handler,
          input: s.object({}),
        }),
      ],
    });
    const originalToUpperCase = String.prototype.toUpperCase;
    String.prototype.toUpperCase = () => 'POST';
    try {
      const getRequest = new Request('https://example.test/_m/method/write', { method: 'GET' });
      const getResponse = await handleAppMutationRequest(
        app,
        getRequest,
        new URL(getRequest.url),
        'method/write',
      );
      expect(getResponse.status).toBe(405);
      expect(handler).not.toHaveBeenCalled();

      const postRequest = new Request('https://example.test/_m/method/write', {
        body: new FormData(),
        method: 'POST',
      });
      const postResponse = await handleAppMutationRequest(
        app,
        postRequest,
        new URL(postRequest.url),
        'method/write',
      );
      expect(postResponse.status).toBe(303);
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      String.prototype.toUpperCase = originalToUpperCase;
    }
  });

  it('resolves mutation response options from exact-key policies', async () => {
    const seen: string[] = [];
    const addToCart = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input) {
        seen.push(`handler:${input.productId}`);
        return input;
      },
    });
    const app = createApp({
      mutationResponses: {
        'cart/add': ({ rawInput }) => {
          seen.push(`policy:${rawInput instanceof FormData}`);
          return { redirectTo: '/cart' };
        },
      },
      mutations: [addToCart],
    });
    const form = new FormData();
    form.set('productId', 'p1');
    const request = new Request('https://shop.example.test/_m/cart/add', {
      body: form,
      method: 'POST',
    });

    const response = await handleAppMutationRequest(app, request, new URL(request.url), 'cart/add');

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/cart');
    expect(seen).toEqual(['handler:p1', 'policy:true']);
  });

  it('snapshots static response policy and rejects registry accessors at app closure', async () => {
    const responsePolicy = { redirectTo: '/safe' };
    const save = mutation('save', {
      csrf: false,
      input: s.object({ value: s.string() }),
      handler: (input) => input,
    });
    const app = createApp({
      mutationResponses: { save: responsePolicy },
      mutations: [save],
    });
    responsePolicy.redirectTo = '/attacker';
    expect(Object.isFrozen(app.mutationResponses)).toBe(true);
    expect(Object.isFrozen(app.mutationResponses.save)).toBe(true);

    const form = new FormData();
    form.set('value', 'x');
    const request = new Request('https://example.test/_m/save', { body: form, method: 'POST' });
    const response = await handleAppMutationRequest(app, request, new URL(request.url), 'save');
    expect(response.headers.get('location')).toBe('/safe');

    let reads = 0;
    const policies = Object.defineProperty({}, 'save', {
      enumerable: true,
      get() {
        reads += 1;
        return { redirectTo: '/attacker' };
      },
    });
    expect(() => createApp({ mutationResponses: policies as never })).toThrow(
      'must be a stable own data property',
    );
    expect(reads).toBe(0);
  });

  it('decodes JSON mutation bodies through schemas without prototype-pollution side effects', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const addToCart = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input) {
        seen.push(input);
        return input;
      },
    });
    const app = createApp({
      mutationResponses: {
        'cart/add': { redirectTo: '/cart' },
      },
      mutations: [addToCart],
    });
    const request = new Request('https://shop.example.test/_m/cart/add', {
      body: '{"__proto__":{"polluted":true},"constructor":{"polluted":true},"productId":"p1","prototype":{"polluted":true}}',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    const response = await handleAppMutationRequest(app, request, new URL(request.url), 'cart/add');

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/cart');
    expect(seen).toEqual([{ productId: 'p1' }]);
    expect(({} as { polluted?: boolean }).polluted).toBe(undefined);
  });

  it('fails closed with no-store JSON when a csrf:false mutation body is malformed', async () => {
    let handlerCalls = 0;
    const addToCart = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input) {
        handlerCalls += 1;
        return input;
      },
    });
    const app = createApp({ mutations: [addToCart] });
    const request = new Request('https://shop.example.test/_m/cart/add', {
      body: '{ not valid json',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    const response = await handleAppMutationRequest(app, request, new URL(request.url), 'cart/add');
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(body).toEqual({ code: 'VALIDATION', payload: { reason: 'invalid-json' } });
    expect(handlerCalls).toBe(0);
  });

  it('uses mutation-level defaultRedirectTo without an app-authored response switch', async () => {
    const addToCart = mutation('cart/add', {
      csrf: false,
      defaultRedirectTo: '/cart',
      input: s.object({ productId: s.string() }),
      handler(input) {
        return input;
      },
    });
    const app = createApp({ mutations: [addToCart] });
    const form = new FormData();
    form.set('productId', 'p1');
    const request = new Request('https://shop.example.test/_m/cart/add', {
      body: form,
      method: 'POST',
    });

    const response = await handleAppMutationRequest(app, request, new URL(request.url), 'cart/add');

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/cart');
  });

  it('uses mutation-level dynamic redirectTo without an app-authored response switch', async () => {
    const signIn = mutation('auth/sign-in', {
      csrf: false,
      input: s.object({ next: s.string() }),
      redirectTo: (result) => (result.value as { redirectTo: string }).redirectTo,
      handler(input) {
        return { redirectTo: input.next, status: 'signed-in' };
      },
    });
    const app = createApp({ mutations: [signIn] });
    const form = new FormData();
    form.set('next', '/account');
    const request = new Request('https://shop.example.test/_m/auth/sign-in', {
      body: form,
      method: 'POST',
    });

    const response = await handleAppMutationRequest(
      app,
      request,
      new URL(request.url),
      'auth/sign-in',
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/account');
  });

  it('dispatches mutations with write lifecycle db handles', async () => {
    const writes: string[] = [];
    const db = {
      insert(value: string) {
        writes.push(value);
      },
    };
    const addToCart = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      redirectTo: '/cart',
      handler(input, request: Request & { db: typeof db; session?: never }) {
        expect('session' in request).toBe(false);
        request.db.insert(input.productId);
        return input;
      },
    });
    const providerHeaders: Array<[string | null, string | null, string | null]> = [];
    const app = createApp({
      db: (request) => {
        const clone = request.clone();
        providerHeaders.push([
          request.headers.get('cookie'),
          clone.headers.get('cookie'),
          clone.headers.get('x-machine-signature'),
        ]);
        return db;
      },
      mutations: [addToCart],
      sessionProvider() {
        return { user: { id: 'u1' } };
      },
    });
    const form = new FormData();
    form.set('productId', 'p1');
    const request = new Request('https://shop.example.test/_m/cart/add', {
      body: form,
      headers: { Cookie: 'sid=victim', 'X-Machine-Signature': 'kept' },
      method: 'POST',
    });

    const response = await handleAppMutationRequest(app, request, new URL(request.url), 'cart/add');

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/cart');
    expect(writes).toEqual(['p1']);
    expect(providerHeaders).toEqual([[null, null, 'kept']]);
    expect(request.headers.get('cookie')).toBe('sid=victim');
  });

  it('inherits app and source-route stylesheets into enhanced live-target fragments', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      reads: [cart],
      load: () => ({ count: 1 }),
    });
    const addToCart = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        return input;
      },
    });
    const cartRoute = route('/cart', {
      page: () => trustedHtml('<main>Cart</main>'),
      stylesheets: [stylesheet('./cart.css')],
    });
    const app = createApp({
      liveTargetRenderers: [
        {
          component: 'components/cart/badge',
          queries: ['cart'],
          render: () => '<cart-badge>1</cart-badge>',
          stylesheets: [stylesheet('./badge.css')],
        },
      ],
      mutations: [addToCart],
      routes: [cartRoute],
      stylesheets: [stylesheet('./app.css')],
    });
    const form = new FormData();
    form.set('productId', 'p1');
    const request = new Request('https://shop.example.test/_m/cart/add', {
      body: form,
      headers: {
        Referer: 'https://shop.example.test/cart',
        'Kovo-Fragment': 'true',
        'Kovo-Live-Targets': `${attestedLiveTargetHeader('cart-badge', 'components/cart/badge')}`,
        'Kovo-Targets': 'cart-badge=cart',
      },
      method: 'POST',
    });

    const response = await handleAppMutationRequest(app, request, new URL(request.url), 'cart/add');
    const body = await response.text();

    expect(response.status, body).toBe(200);
    expect(body).toContain(
      '<kovo-fragment target="cart-badge"><link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/cart.css"><link rel="stylesheet" href="/assets/badge.css"><cart-badge>1</cart-badge></kovo-fragment>',
    );
  });

  it('threads app query list limits into enhanced mutation query refreshes', async () => {
    const catalog = domain('catalog');
    const catalogQuery = query('catalogItems', {
      load: () => ({
        rows: Array.from({ length: 4 }, (_, id) => ({ id, label: `item-${id}` })),
      }),
      reads: [catalog],
    });
    const refreshCatalog = mutation('catalog/refresh', {
      csrf: false,
      defaultRedirectTo: '/catalog',
      input: s.object({ reason: s.string() }),
      registry: {
        queries: [catalogQuery],
        touches: [catalog],
      },
      handler(input) {
        return input;
      },
    });
    const app = createApp({
      mutations: [refreshCatalog],
      requestLimits: { maxQueryListItems: 2 },
    });
    const form = new FormData();
    form.set('reason', 'test');
    const request = new Request('https://shop.example.test/_m/catalog/refresh', {
      body: form,
      headers: {
        'Kovo-Fragment': 'true',
        'Kovo-Targets': 'catalog-list=catalogItems',
      },
      method: 'POST',
    });

    const response = await handleAppMutationRequest(
      app,
      request,
      new URL(request.url),
      'catalog/refresh',
    );
    const body = await response.text();

    expect(response.status, body).toBe(200);
    expect(response.headers.get('Kovo-Warn')).toBe('QUERY_LIST_LIMIT $.rows;limit=2');
    expect(body).toContain('"label":"item-1"');
    expect(body).not.toContain('"label":"item-2"');
  });

  it('inherits app and source-route stylesheets into enhanced failure fragments', async () => {
    const addToCart = mutation('cart/add', {
      csrf: false,
      input: s.object({ quantity: s.number().int().min(1) }),
      handler(input) {
        return input;
      },
    });
    const cartRoute = route('/cart', {
      page: () => trustedHtml('<main>Cart</main>'),
      stylesheets: [stylesheet('./cart.css')],
    });
    const app = createApp({
      mutationResponses: {
        'cart/add': {
          failureStylesheets: [stylesheet('./form.css')],
          failureTarget: 'cart-form',
        },
      },
      mutations: [addToCart],
      routes: [cartRoute],
      stylesheets: [stylesheet('./app.css')],
    });
    const form = new FormData();
    form.set('quantity', '0');
    const request = new Request('https://shop.example.test/_m/cart/add', {
      body: form,
      headers: {
        Referer: 'https://shop.example.test/cart',
        'Kovo-Fragment': 'true',
      },
      method: 'POST',
    });

    const response = await handleAppMutationRequest(app, request, new URL(request.url), 'cart/add');
    const body = await response.text();

    expect(response.status, body).toBe(422);
    expect(body).toBe(
      '<kovo-fragment target="cart-form"><link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/cart.css"><link rel="stylesheet" href="/assets/form.css"><output role="alert" data-error-path="quantity">Expected number &gt;= 1</output></kovo-fragment>',
    );
  });

  it('resolves the app session once before mutation response options and guarded handlers', async () => {
    // SPEC §6.6/§9.1: a session-authenticated mutation is CSRF-checked (KV418 forbids the
    // `csrf: false` + session combination), so this exercises the normal protected path. The
    // synchronizer token is stamped into the form and validated before the guard chain.
    const seen: string[] = [];
    let sessionReads = 0;
    const csrf = { secret: 'mutation-session-once-secret-key-0123456789', sessionId: () => 's1' };
    const addToCart = mutation('cart/add', {
      guard: guards.authed(),
      input: s.object({ productId: s.string() }),
      handler(input, request) {
        const session = (
          request as Request & { session?: { user?: { id?: string } | null } | null }
        ).session;
        seen.push(`handler:${session?.user?.id}:${input.productId}`);
        return input;
      },
    });
    const app = createApp({
      csrf,
      mutationResponses: {
        'cart/add': ({ currentUrl, rawInput, request }) => {
          const session = (
            request as Request & { session?: { user?: { id?: string } | null } | null }
          ).session;
          seen.push(`response:${session?.user?.id}:${currentUrl}:${rawInput instanceof FormData}`);
          return { redirectTo: '/cart' };
        },
      },
      mutations: [addToCart],
      sessionProvider() {
        sessionReads += 1;
        return { user: { id: 'u1' } };
      },
    });
    const form = new FormData();
    form.set('productId', 'p1');
    form.set('kovo-csrf', csrfToken({}, csrf, { audience: 'cart/add' }));
    const request = new Request('https://shop.example.test/_m/cart/add?from=button', {
      body: form,
      headers: { origin: 'https://shop.example.test' },
      method: 'POST',
    });

    const response = await handleAppMutationRequest(app, request, new URL(request.url), 'cart/add');

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/cart');
    expect(sessionReads).toBe(1);
    expect(seen).toEqual(['handler:u1:p1', 'response:u1:/_m/cart/add?from=button:true']);
    expect('session' in request).toBe(false);
  });

  it('invokes dynamic response policy only after a validated, authorized handler outcome', async () => {
    const seen: string[] = [];
    let allowSession = true;
    const csrf = {
      secret: 'post-lifecycle-policy-secret-key-0123456789',
      sessionId: () => 's1',
    };
    const addToCart = mutation('cart/add', {
      errors: { OUT_OF_STOCK: s.object({}) },
      guard: guards.authed(),
      input: s.object({ productId: s.string() }),
      handler(input, _request, context) {
        seen.push(`handler:${input.productId}`);
        if (input.productId === 'sold-out') return context.fail('OUT_OF_STOCK', {});
        return input;
      },
    });
    const app = createApp({
      csrf,
      mutationResponses: {
        'cart/add': ({ outcome }) => {
          seen.push(`policy:${outcome.kind}`);
          return { redirectTo: '/cart' };
        },
      },
      mutations: [addToCart],
      sessionProvider() {
        return { user: allowSession ? { id: 'u1' } : null };
      },
    });
    const submit = async (fields: Record<string, string>) => {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      const request = new Request('https://shop.example.test/_m/cart/add', {
        body: form,
        headers: { origin: 'https://shop.example.test' },
        method: 'POST',
      });
      return handleAppMutationRequest(app, request, new URL(request.url), 'cart/add');
    };
    const token = csrfToken({}, csrf, { audience: 'cart/add' });

    expect((await submit({ productId: 'p1' })).status).toBe(422);
    expect(seen).toEqual([]);

    expect((await submit({ 'kovo-csrf': token })).status).toBe(422);
    expect(seen).toEqual([]);

    allowSession = false;
    expect((await submit({ 'kovo-csrf': token, productId: 'p1' })).status).toBe(303);
    expect(seen).toEqual([]);

    allowSession = true;
    expect((await submit({ 'kovo-csrf': token, productId: 'p1' })).status).toBe(303);
    expect(seen).toEqual(['handler:p1', 'policy:success']);

    seen.length = 0;
    expect((await submit({ 'kovo-csrf': token, productId: 'sold-out' })).status).toBe(422);
    expect(seen).toEqual(['handler:sold-out', 'policy:failure']);
  });

  it('does not run dynamic response policy when replay reservation fails closed', async () => {
    const handler = vi.fn(() => ({ ok: true }));
    const policy = vi.fn(() => ({ redirectTo: '/done' }));
    const replayStore = {
      get: vi.fn(() => undefined),
      reserve: vi.fn(() => undefined),
      set: vi.fn(),
    };
    const csrf = {
      secret: 'replay-policy-order-secret-key-0123456789',
      sessionId: () => 's1',
    };
    const save = mutation('save', {
      input: s.object({ value: s.string() }),
      handler,
    });
    const app = createApp({
      csrf,
      mutationReplayStore: replayStore,
      mutationResponses: { save: policy },
      mutations: [save],
    });
    const form = new FormData();
    form.set('value', 'x');
    form.set('kovo-csrf', csrfToken({}, csrf, { audience: 'save' }));
    const request = new Request('https://example.test/_m/save', {
      body: form,
      headers: {
        'Kovo-Fragment': 'true',
        'Kovo-Idem': 'idem-1',
        origin: 'https://example.test',
      },
      method: 'POST',
    });

    const response = await handleAppMutationRequest(app, request, new URL(request.url), 'save');
    expect(response.status).toBe(429);
    expect(handler).not.toHaveBeenCalled();
    expect(policy).not.toHaveBeenCalled();
  });

  it('forbids static and runtime response-policy CSRF overrides', async () => {
    expect(() =>
      createApp({
        mutationResponses: { save: { csrf: false } as never },
      }),
    ).toThrow('response decoration cannot replace pre-body CSRF posture');

    const onError = vi.fn();
    const handler = vi.fn(() => ({ ok: true }));
    const policy = vi.fn(() => ({ csrf: false, redirectTo: '/forged' }) as never);
    const csrf = {
      secret: 'runtime-policy-override-secret-key-0123456789',
      sessionId: () => 's1',
    };
    const save = mutation('save', {
      input: s.object({ value: s.string() }),
      handler,
    });
    const app = createApp({
      csrf,
      mutationResponses: { save: policy },
      mutations: [save],
      onError,
    });
    const forgedForm = new FormData();
    forgedForm.set('value', 'forged');
    const forged = new Request('https://example.test/_m/save', {
      body: forgedForm,
      headers: { origin: 'https://example.test' },
      method: 'POST',
    });

    expect((await handleAppMutationRequest(app, forged, new URL(forged.url), 'save')).status).toBe(
      422,
    );
    expect(handler).not.toHaveBeenCalled();
    expect(policy).not.toHaveBeenCalled();

    const validForm = new FormData();
    validForm.set('value', 'valid');
    validForm.set('kovo-csrf', csrfToken({}, csrf, { audience: 'save' }));
    const valid = new Request('https://example.test/_m/save', {
      body: validForm,
      headers: { origin: 'https://example.test' },
      method: 'POST',
    });
    expect((await handleAppMutationRequest(app, valid, new URL(valid.url), 'save')).status).toBe(
      500,
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(policy).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.any(TypeError),
      expect.objectContaining({ mutationKey: 'save', operation: 'mutation-response-policy' }),
    );
  });

  it('serves a csrf:false mutation with no ambient session (SPEC §6.6/§9.1 KV418 runtime floor)', async () => {
    // SPEC §6.6/§9.1: a `csrf: false` mutation skips the synchronizer token, so it MUST be served
    // with no ambient session — cookies are not interpreted, mirroring the §9.1 endpoint()
    // guarantee. This defense-in-depth floor backs the by-construction KV418 compile gate: even
    // with an app `sessionProvider` configured, the provider is never invoked and `req.session`
    // is genuinely absent rather than the victim's ambient cookie.
    const clientIpCookies: Array<string | null> = [];
    const providerCredentials: Array<[string | null, string | null, unknown]> = [];
    const handlerCredentials: Array<[string | null, string | null, unknown]> = [];
    const seen: string[] = [];
    let sessionReads = 0;
    const addToCart = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request) {
        const typed = request as Request & {
          capture?: string | null;
          session?: { user?: { id?: string } };
        };
        Object.defineProperty(typed, 'capture', {
          configurable: true,
          get(this: Request) {
            return this.headers.get('cookie');
          },
        });
        seen.push(
          `handler:${'session' in typed}:${typed.session?.user?.id}:${typed.headers.get('cookie')}:${typed.capture}:${typed.headers.get('x-machine-signature')}:${input.productId}`,
        );
        handlerCredentials.push([
          typed.headers.get('authorization'),
          typed.headers.get('proxy-authorization'),
          typed.signal.reason,
        ]);
        return input;
      },
    });
    const app = createApp({
      db(request) {
        providerCredentials.push([
          request.headers.get('authorization'),
          request.headers.get('proxy-authorization'),
          request.signal.reason,
        ]);
        return {};
      },
      mutations: [addToCart],
      requestLimits: {
        clientIp(request) {
          clientIpCookies.push(request.headers.get('cookie'));
          return '203.0.113.9';
        },
      },
      sessionProvider() {
        sessionReads += 1;
        return { user: { id: 'u1' } };
      },
    });
    const form = new FormData();
    form.set('productId', 'p1');
    const abort = new AbortController();
    const abortSecret = { headers: new Headers({ Cookie: 'sid=abort-secret' }) };
    abort.abort(abortSecret);
    const request = new Request('https://shop.example.test/_m/cart/add', {
      body: form,
      headers: {
        Authorization: 'Basic victim-browser-credential',
        Cookie: 'sid=victim-session',
        'Proxy-Authorization': 'Basic victim-proxy-credential',
        'X-Machine-Signature': 'kept',
      },
      method: 'POST',
      signal: abort.signal,
    });

    const response = await handleAppMutationRequest(app, request, new URL(request.url), 'cart/add');

    expect(response.status).toBe(303);
    // The session provider is never consulted and the handler sees no ambient session.
    expect(sessionReads).toBe(0);
    expect(clientIpCookies).toEqual([null]);
    expect(providerCredentials[0]?.slice(0, 2)).toEqual([null, null]);
    expect(providerCredentials[0]?.[2]).not.toBe(abortSecret);
    expect(handlerCredentials[0]?.slice(0, 2)).toEqual([null, null]);
    expect(handlerCredentials[0]?.[2]).not.toBe(abortSecret);
    expect(seen).toEqual(['handler:false:undefined:null:null:kept:p1']);
    expect(request.headers.get('cookie')).toBe('sid=victim-session');
  });

  // H1 (high) — SPEC §9.2: malformed/wrong-Content-Type mutation body → 422, before CSRF.
  // Before the fix, readMutationRequestBody threw into the generic 500 shell + onError.

  it('H1: returns 422 for a malformed JSON body without calling onError', async () => {
    const onError = vi.fn();
    const addToCart = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input) {
        return input;
      },
    });
    const app = createApp({ mutations: [addToCart], onError });
    const request = new Request('https://shop.example.test/_m/cart/add', {
      body: '{ this is not valid json !!',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    const response = await handleAppMutationRequest(app, request, new URL(request.url), 'cart/add');

    expect(response.status).toBe(422);
    expect(onError).not.toHaveBeenCalled();
    const body = (await response.json()) as { code: string; payload: { reason: string } };
    expect(body.code).toBe('VALIDATION');
    expect(body.payload.reason).toBe('invalid-json');
  });

  it('validates CSRF before surfacing malformed body diagnostics for protected mutations', async () => {
    const onError = vi.fn();
    let handlerCalls = 0;
    const csrf = {
      field: 'csrf',
      secret: 'test-csrf-secret-0123456789abcdef012345',
      sessionId() {
        return 's1';
      },
    };
    const addToCart = mutation('cart/add', {
      csrf,
      input: s.object({ productId: s.string() }),
      handler(input) {
        handlerCalls += 1;
        return input;
      },
    });
    const app = createApp({ mutations: [addToCart], onError });
    const request = new Request('https://shop.example.test/_m/cart/add', {
      body: '{ this is not valid json !!',
      headers: {
        'Content-Type': 'application/json',
        'Kovo-Fragment': 'true',
        'Kovo-Targets': 'cart-form',
      },
      method: 'POST',
    });

    const response = await handleAppMutationRequest(app, request, new URL(request.url), 'cart/add');
    const body = await response.text();

    expect(response.status, body).toBe(422);
    expect(body).toContain('data-error-code="CSRF"');
    expect(body).not.toContain('invalid-json');
    expect(handlerCalls).toBe(0);
    expect(onError).not.toHaveBeenCalled();
  });

  it('H1: returns 422 for a text/plain Content-Type body without calling onError', async () => {
    const onError = vi.fn();
    const addToCart = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input) {
        return input;
      },
    });
    const app = createApp({ mutations: [addToCart], onError });
    const request = new Request('https://shop.example.test/_m/cart/add', {
      body: 'productId=p1',
      headers: { 'Content-Type': 'text/plain' },
      method: 'POST',
    });

    const response = await handleAppMutationRequest(app, request, new URL(request.url), 'cart/add');

    expect(response.status).toBe(422);
    expect(onError).not.toHaveBeenCalled();
    const body = (await response.json()) as { code: string; payload: { reason: string } };
    expect(body.code).toBe('VALIDATION');
    expect(body.payload.reason).toBe('unsupported-content-type');
  });
});
