import { describe, expect, it, vi } from 'vitest';
import { trustedHtml } from '@kovojs/browser';
import { component } from '@kovojs/core';

import { createApp, createRequestHandler } from './app.js';
import { handleAppMutationRequest } from './app-mutation-request.js';
import { normalizeAppMutationResponseOptions } from './app-mutation-responses.js';
import { csrfToken } from './csrf.js';
import { domain } from './domain.js';
import { guards } from './guards.js';
import { stylesheet } from './hints.js';
import { renderedHtml } from './html.js';
import { componentLiveTargetRenderer } from './live-target-renderer.js';
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
  it('pins generated live-target query authority before post-assembly mutation', async () => {
    const privateData = domain('private-data');
    const reviewedQuery = query('private-record', {
      guard: () => true,
      load: () => ({ secret: 'SAFE' }),
      reads: [privateData],
    });
    const forgedQuery = query('private-record', {
      load: () => ({ secret: 'LEAKED' }),
      reads: [privateData],
    });
    const PrivateRegion = component({
      render: ({ record }) =>
        renderedHtml(`<private-region>${(record as { secret: string }).secret}</private-region>`),
    });
    const renderer = componentLiveTargetRenderer({
      component: PrivateRegion,
      componentId: 'components/private/region',
      queries: [{ name: 'record', query: reviewedQuery }],
    });
    const update = mutation('private/update', {
      csrf: false,
      handler: () => ({}),
      input: s.object({}),
      registry: { queries: [reviewedQuery], touches: [privateData] },
    });
    const app = createApp({ liveTargetRenderers: [renderer], mutations: [update] });

    const appBinding = (
      app.liveTargetRenderers[0] as typeof renderer & {
        queryBindings: Array<{ query: typeof reviewedQuery }>;
      }
    ).queryBindings[0]!;
    expect(() => {
      appBinding.query = forgedQuery;
    }).toThrow();
    reviewedQuery.load = forgedQuery.load;

    const request = new Request('https://shop.example.test/_m/private/update', {
      body: new FormData(),
      headers: {
        'Kovo-Fragment': 'true',
        'Kovo-Live-Targets': attestedLiveTargetHeader(
          'private-region',
          'components/private/region',
        ),
        'Kovo-Targets': 'private-region=private-record',
      },
      method: 'POST',
    });
    const response = await handleAppMutationRequest(
      app,
      request,
      new URL(request.url),
      'private/update',
    );
    const body = await response.text();

    expect(response.status, body).toBe(200);
    expect(body).toContain('<kovo-query name="private-record">{"secret":"SAFE"}</kovo-query>');
    expect(body).toContain('<private-region>SAFE</private-region>');
    expect(body).not.toContain('LEAKED');
  });

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

  it('keeps mutation response policy closed when ambient Object.freeze is selectively replaced', async () => {
    const save = mutation('freeze-poison/save', {
      csrf: false,
      input: s.object({ value: s.string() }),
      handler: (input) => input,
    });
    const originalFreeze = Object.freeze;
    const safeFailurePage = () => '<main>safe validation failure</main>';
    let capturedPolicy: { renderFailurePage: () => string } | undefined;
    Object.freeze = ((value: unknown) => {
      if (
        typeof value === 'object' &&
        value !== null &&
        (value as { renderFailurePage?: unknown }).renderFailurePage === safeFailurePage
      ) {
        capturedPolicy = value as { renderFailurePage: () => string };
        return value;
      }
      return originalFreeze(value);
    }) as typeof Object.freeze;

    let app: ReturnType<typeof createApp>;
    try {
      app = createApp({
        mutationResponses: {
          'freeze-poison/save': { renderFailurePage: safeFailurePage },
        },
        mutations: [save],
      });
    } finally {
      Object.freeze = originalFreeze;
    }

    if (capturedPolicy !== undefined) {
      capturedPolicy.renderFailurePage = () =>
        '<img src=x onerror="globalThis.kovoFreezePoisoned=true">';
    }
    expect(capturedPolicy).toBeUndefined();

    const form = new FormData();
    const request = new Request('https://example.test/_m/freeze-poison/save', {
      body: form,
      method: 'POST',
    });
    const response = await handleAppMutationRequest(
      app,
      request,
      new URL(request.url),
      'freeze-poison/save',
    );
    expect(response.status).toBe(422);
    expect(await response.text()).toBe('<main>safe validation failure</main>');
  });

  it('normalizes nested response policy through pinned Object, Reflect, Array, and Set controls', () => {
    const originalArrayIsArray = Array.isArray;
    const originalFreeze = Object.freeze;
    const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const originalObjectKeys = Object.keys;
    const originalOwnKeys = Reflect.ownKeys;
    const originalSetHas = Set.prototype.has;
    Array.isArray = () => false;
    Object.freeze = ((value: unknown) => value) as typeof Object.freeze;
    Object.getOwnPropertyDescriptor = (() => ({
      configurable: true,
      enumerable: true,
      value: 'attacker-substituted',
      writable: true,
    })) as typeof Object.getOwnPropertyDescriptor;
    Object.keys = () => [];
    Reflect.ownKeys = () => ['csrf'];
    Set.prototype.has = () => false;

    let normalized: ReturnType<typeof normalizeAppMutationResponseOptions>;
    try {
      normalized = normalizeAppMutationResponseOptions({
        failureStylesheets: [{ href: '/safe.css', preload: true }],
        failureTarget: 'safe-form',
        fragmentRenderers: [
          {
            errorBoundary: { render: () => trustedHtml('<output>safe boundary</output>') },
            render: () => trustedHtml('<output>safe fragment</output>'),
            stylesheets: ['/fragment.css'],
            target: 'safe-fragment',
          },
        ],
        redirectTo: { location: '/safe', status: 303 },
      });
    } finally {
      Set.prototype.has = originalSetHas;
      Reflect.ownKeys = originalOwnKeys;
      Object.keys = originalObjectKeys;
      Object.getOwnPropertyDescriptor = originalGetOwnPropertyDescriptor;
      Object.freeze = originalFreeze;
      Array.isArray = originalArrayIsArray;
    }

    expect(normalized.failureTarget).toBe('safe-form');
    expect(normalized.redirectTo).toEqual({ location: '/safe', status: 303 });
    expect(normalized.failureStylesheets).toEqual([{ href: '/safe.css', preload: true }]);
    expect(normalized.fragmentRenderers?.[0]?.target).toBe('safe-fragment');
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.failureStylesheets)).toBe(true);
    expect(Object.isFrozen(normalized.failureStylesheets?.[0])).toBe(true);
    expect(Object.isFrozen(normalized.fragmentRenderers)).toBe(true);
    expect(Object.isFrozen(normalized.fragmentRenderers?.[0])).toBe(true);
    expect(Object.isFrozen(normalized.fragmentRenderers?.[0]?.errorBoundary)).toBe(true);
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
    let shadowDbReads = 0;
    Object.defineProperty(request, 'db', {
      configurable: true,
      get() {
        shadowDbReads += 1;
        throw new Error('request db accessor must not override the app provider');
      },
    });

    const response = await handleAppMutationRequest(app, request, new URL(request.url), 'cart/add');

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/cart');
    expect(writes).toEqual(['p1']);
    expect(providerHeaders).toEqual([[null, null, 'kept']]);
    expect(request.headers.get('cookie')).toBe('sid=victim');
    expect(shadowDbReads).toBe(0);
  });

  it('preserves an own-data request db across csrf-exempt enhanced dispatch', async () => {
    // C194 / SPEC §6.6/§9.5/§11.2: adapters may bind a per-request DB capability before app
    // dispatch. Cookie/authorization neutralization must preserve that exact framework input for
    // the handler and post-lifecycle response policy without retaining ambient browser authority.
    const writes: string[] = [];
    const db = {
      insert(value: string) {
        writes.push(value);
      },
    };
    const seen: string[] = [];
    const addToCart = mutation('cart/request-db', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler(input, request: Request & { db: typeof db; session?: never }) {
        expect('session' in request).toBe(false);
        expect(request.headers.get('cookie')).toBeNull();
        request.db.insert(input.productId);
        seen.push('handler');
        return input;
      },
    });
    const app = createApp({
      mutationResponses: {
        'cart/request-db': ({ request }) => {
          (request as Request & { db: typeof db }).db.insert('response-policy');
          seen.push('response-policy');
          return { redirectTo: '/cart' };
        },
      },
      mutations: [addToCart],
    });
    const form = new FormData();
    form.set('productId', 'p1');
    const request = new Request('https://shop.example.test/_m/cart/request-db', {
      body: form,
      headers: {
        Cookie: 'sid=victim',
        'Kovo-Fragment': 'true',
        'X-Machine-Signature': 'kept',
      },
      method: 'POST',
    });
    Object.defineProperty(request, 'db', {
      configurable: true,
      value: db,
    });

    const response = await createRequestHandler(app)(request);

    expect(response.status).toBe(200);
    expect(writes).toEqual(['p1', 'response-policy']);
    expect(seen).toEqual(['handler', 'response-policy']);
    expect(request.headers.get('cookie')).toBe('sid=victim');
  });

  it('rejects an accessor-backed request db without invoking it', async () => {
    const handler = vi.fn(() => ({ ok: true }));
    const app = createApp({
      mutations: [
        mutation('cart/accessor-db', {
          csrf: false,
          handler,
          input: s.object({}),
        }),
      ],
    });
    const request = new Request('https://shop.example.test/_m/cart/accessor-db', {
      body: new FormData(),
      method: 'POST',
    });
    let reads = 0;
    Object.defineProperty(request, 'db', {
      configurable: true,
      get() {
        reads += 1;
        return {};
      },
    });

    await expect(
      handleAppMutationRequest(app, request, new URL(request.url), 'cart/accessor-db'),
    ).rejects.toThrow('A request-scoped mutation db must be an own data property.');
    expect(reads).toBe(0);
    expect(handler).not.toHaveBeenCalled();
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

  it('keeps the closed live-target renderer inventory under a late exact Array.map replacement', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart-map-poison', {
      reads: [cart],
      load: () => ({ count: 1 }),
    });
    const addToCart = mutation('cart/map-poison', {
      csrf: false,
      input: s.object({}),
      registry: { queries: [cartQuery], touches: [cart] },
      handler: () => ({}),
    });
    const app = createApp({
      liveTargetRenderers: [
        {
          component: 'components/cart/map-poison',
          queries: ['cart-map-poison'],
          render: () => '<cart-badge>safe</cart-badge>',
        },
      ],
      mutations: [addToCart],
      stylesheets: [stylesheet('./app.css')],
    });
    const originalMap = Array.prototype.map;
    let poisonedCalls = 0;
    Array.prototype.map = function (callback, thisArg) {
      if (this === app.liveTargetRenderers) {
        poisonedCalls += 1;
        return [
          {
            component: 'components/cart/map-poison',
            queries: ['cart-map-poison'],
            render: () => '<img src=x onerror="globalThis.kovoLateMapXss=true">',
          },
        ];
      }
      return originalMap.call(this, callback, thisArg);
    } as typeof Array.prototype.map;

    let response: Response;
    try {
      const request = new Request('https://shop.example.test/_m/cart/map-poison', {
        body: new FormData(),
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': attestedLiveTargetHeader('cart-badge', 'components/cart/map-poison'),
          'Kovo-Targets': 'cart-badge=cart-map-poison',
        },
        method: 'POST',
      });
      response = await handleAppMutationRequest(
        app,
        request,
        new URL(request.url),
        'cart/map-poison',
      );
    } finally {
      Array.prototype.map = originalMap;
    }

    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(poisonedCalls).toBe(0);
    expect(body).not.toContain('onerror');
    expect(body).toContain('<cart-badge>safe</cart-badge>');
  });

  it('inherits renderer stylesheets without ambient array callbacks or iterators', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart-array-census', {
      reads: [cart],
      load: () => ({ count: 1 }),
    });
    const save = mutation('cart/array-census', {
      csrf: false,
      input: s.object({}),
      registry: { queries: [cartQuery], touches: [cart] },
      handler: () => ({}),
    });
    const app = createApp({
      liveTargetRenderers: [
        {
          component: 'components/cart/array-census',
          queries: ['cart-array-census'],
          render: () => '<cart-badge>safe</cart-badge>',
          stylesheets: [
            stylesheet({ criticalCss: '.renderer-safe{color:green}', href: './renderer.css' }),
          ],
        },
      ],
      mutations: [save],
      routes: [
        route('/cart-array-census', {
          page: () => trustedHtml('<main>Cart</main>'),
          stylesheets: [
            stylesheet({ criticalCss: '.route-safe{color:blue}', href: './route.css' }),
          ],
        }),
      ],
      stylesheets: [stylesheet({ criticalCss: '.app-safe{color:red}', href: './app.css' })],
    });

    const originalFilter = Array.prototype.filter;
    const originalFlatMap = Array.prototype.flatMap;
    const originalIterator = Array.prototype[Symbol.iterator];
    const originalSome = Array.prototype.some;
    const calls = { filter: 0, flatMap: 0, iterator: 0, some: 0 };
    Array.prototype.filter = function (callback, thisArg) {
      if (this === app.liveTargetRenderers[0]?.stylesheets) calls.filter += 1;
      return originalFilter.call(this, callback, thisArg);
    } as typeof Array.prototype.filter;
    Array.prototype.flatMap = function (callback, thisArg) {
      const first = this[0] as { criticalCss?: string } | undefined;
      if (first?.criticalCss === '.app-safe{color:red}' && this.length === 2) calls.flatMap += 1;
      return originalFlatMap.call(this, callback, thisArg);
    } as typeof Array.prototype.flatMap;
    Array.prototype[Symbol.iterator] = function () {
      if (this === app.stylesheets || this === app.routes[0]?.stylesheets) calls.iterator += 1;
      return originalIterator.call(this);
    } as (typeof Array.prototype)[Symbol.iterator];
    Array.prototype.some = function (callback, thisArg) {
      if (this[0] === '.app-safe{color:red}') calls.some += 1;
      return originalSome.call(this, callback, thisArg);
    } as typeof Array.prototype.some;

    let response: Response;
    try {
      const request = new Request('https://shop.example.test/_m/cart/array-census', {
        body: new FormData(),
        headers: {
          Referer: 'https://shop.example.test/cart-array-census',
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': attestedLiveTargetHeader(
            'cart-badge',
            'components/cart/array-census',
          ),
          'Kovo-Targets': 'cart-badge=cart-array-census',
        },
        method: 'POST',
      });
      response = await handleAppMutationRequest(
        app,
        request,
        new URL(request.url),
        'cart/array-census',
      );
    } finally {
      Array.prototype.some = originalSome;
      Array.prototype[Symbol.iterator] = originalIterator;
      Array.prototype.flatMap = originalFlatMap;
      Array.prototype.filter = originalFilter;
    }

    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(calls).toEqual({ filter: 0, flatMap: 0, iterator: 0, some: 0 });
    expect(body).toContain('<cart-badge>safe</cart-badge>');
    expect(body).toContain('./app.css');
    expect(body).toContain('./route.css');
    expect(body).toContain('./renderer.css');
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

  it('pins the post-lifecycle outcome before invoking an app response policy', async () => {
    let observedOutcome: { readonly kind: string } | undefined;
    const save = mutation('freeze-outcome/save', {
      csrf: false,
      input: s.object({ value: s.string() }),
      handler: (input) => input,
    });
    const app = createApp({
      mutationResponses: {
        'freeze-outcome/save': ({ outcome }) => {
          observedOutcome = outcome;
          return { redirectTo: '/saved' };
        },
      },
      mutations: [save],
    });
    const form = new FormData();
    form.set('value', 'safe');
    const request = new Request('https://example.test/_m/freeze-outcome/save', {
      body: form,
      method: 'POST',
    });
    const originalFreeze = Object.freeze;
    let interceptedOutcome = false;
    Object.freeze = ((value: unknown) => {
      if (
        typeof value === 'object' &&
        value !== null &&
        (value as { kind?: unknown }).kind === 'success'
      ) {
        interceptedOutcome = true;
        return originalFreeze({ code: 'ATTACKER', kind: 'failure', status: 422 });
      }
      return originalFreeze(value);
    }) as typeof Object.freeze;

    let response: Response;
    try {
      response = await handleAppMutationRequest(
        app,
        request,
        new URL(request.url),
        'freeze-outcome/save',
      );
    } finally {
      Object.freeze = originalFreeze;
    }

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/saved');
    expect(interceptedOutcome).toBe(false);
    expect(observedOutcome).toEqual({ kind: 'success' });
    expect(Object.isFrozen(observedOutcome)).toBe(true);
  });

  it('pins replay-store authority and does not run policy when reservation fails closed', async () => {
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
    (replayStore as { reserve: (...args: unknown[]) => unknown }).reserve = vi.fn(() => ({
      commit: vi.fn(),
    }));
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
    // The pinned lifecycle carrier is intentionally immutable after its one security snapshot;
    // a handler cannot install a late getter that reopens the original Request authority.
    expect(seen).toEqual(['handler:false:undefined:null:undefined:kept:p1']);
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
