import { describe, expect, it, vi } from 'vitest';
import { trustedHtml } from '@kovojs/browser';
import { component, form } from '@kovojs/core';

import { createApp, createRequestHandler } from './app.js';
import { appLiveTargetAttestationAudience } from './live-target-app-identity.js';
import { handleAppMutationRequest } from './app-mutation-request.js';
import { csrfToken, mintIdemToken, resolveCsrfLiveTargetBinding } from './csrf.js';
import { domain } from './domain.js';
import { guard, guards, resolveLifecycleRequest } from './guards.js';
import { stylesheet } from './hints.js';
import { renderedHtml } from './html.js';
import { assignDerivedComponentName } from './internal/wire.js';
import { jsx } from './jsx-runtime.js';
import { componentLiveTargetRenderer } from './live-target-renderer.js';
import {
  registerGeneratedLiveTargetRenderer,
  runWithGeneratedLiveTargetRegistry,
} from './live-target-registry.js';
import { mutation } from './mutation.js';
import { query } from './query.js';
import { createMemoryMutationReplayStore } from './replay.js';
import { route } from './route.js';
import { s } from './schema.js';
import { createLiveTargetAttestation, type LiveTargetRenderer } from './mutation-wire.js';

function withCompilerLiveTargetRenderers<Result>(
  renderers: readonly LiveTargetRenderer<any>[],
  action: () => Result,
): Result {
  return runWithGeneratedLiveTargetRegistry(() => {
    for (const renderer of renderers) registerGeneratedLiveTargetRenderer(renderer);
    return action();
  });
}

function attestedLiveTargetHeader(
  target: string,
  component: string,
  buildToken: string,
  props: Record<string, unknown> = {},
  sourceUrl?: string,
): string {
  const token = createLiveTargetAttestation(
    { component, props, target },
    { buildToken, request: {}, ...(sourceUrl === undefined ? {} : { sourceUrl }) },
  );
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
      csrfJustification: 'test fixture uses a non-browser caller',
      handler: () => ({}),
      input: s.object({}),
      registry: { queries: [reviewedQuery], touches: [privateData] },
    });
    const app = withCompilerLiveTargetRenderers([renderer], () =>
      createApp({
        mutations: [update],
        routes: [route('/', { page: () => renderedHtml('<main>Private update</main>') })],
      }),
    );

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
        'Kovo-Current-Url': 'https://shop.example.test/',
        'Kovo-Fragment': 'true',
        'Kovo-Live-Targets': attestedLiveTargetHeader(
          'private-region',
          'components/private/region',
          appLiveTargetAttestationAudience(app),
          {},
          'https://shop.example.test/',
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
          csrfJustification: 'test fixture uses a non-browser caller',
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

  it('rejects the removed root-public mutationResponses switch without invoking accessors', () => {
    let reads = 0;
    const options = Object.defineProperty({}, 'mutationResponses', {
      enumerable: true,
      get() {
        reads += 1;
        return {
          save: {
            fragmentRenderers: [
              { render: () => trustedHtml('<output>secret</output>'), target: 'secret' },
            ],
          },
        };
      },
    });

    expect(() => createApp(options as never)).toThrow(
      'createApp({ mutationResponses }) is forbidden',
    );
    expect(reads).toBe(0);
  });

  it.each([
    {
      name: 'one uniquely named sensitive renderer',
      renderers: [
        {
          render: vi.fn(() => trustedHtml('<output>SERVER_DATABASE_SECRET</output>')),
          target: 'admin',
        },
      ],
    },
    {
      name: 'duplicate sensitive renderer targets',
      renderers: [
        { render: vi.fn(() => trustedHtml('<output>public</output>')), target: 'shared' },
        {
          render: vi.fn(() => trustedHtml('<output>SERVER_DATABASE_SECRET</output>')),
          target: 'shared',
        },
      ],
    },
  ])('rejects $name before any renderer callback can become app authority', ({ renderers }) => {
    expect(() =>
      createApp({
        mutationResponses: {
          save: { fragmentRenderers: renderers },
        },
      } as never),
    ).toThrow('createApp({ mutationResponses }) is forbidden');
    for (const renderer of renderers) expect(renderer.render).not.toHaveBeenCalled();
  });

  it('decodes JSON mutation bodies through schemas without prototype-pollution side effects', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const addToCart = mutation('cart/add', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      redirectTo: '/cart',
      input: s.object({ productId: s.string() }),
      handler(input) {
        seen.push(input);
        return input;
      },
    });
    const app = createApp({ mutations: [addToCart] });
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
      csrfJustification: 'test fixture uses a non-browser caller',
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
      csrfJustification: 'test fixture uses a non-browser caller',
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

  it('canonicalizes the reserved current-URL header before mutation code can observe it', async () => {
    let observedCurrentUrl: string | null | undefined;
    const save = mutation('account/save', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      handler(_input, request) {
        observedCurrentUrl = (request as Request).headers.get('Kovo-Current-Url');
        return {};
      },
      input: s.object({}),
    });
    const app = createApp({ mutations: [save] });
    const request = new Request('https://shop.example.test/_m/account/save', {
      body: new FormData(),
      headers: {
        'Kovo-Current-Url': 'https://shop.example.test/account?tab=security#private-browser-state',
      },
      method: 'POST',
    });

    const response = await handleAppMutationRequest(
      app,
      request,
      new URL(request.url),
      'account/save',
    );

    expect(observedCurrentUrl).toBe('https://shop.example.test/account?tab=security');
    expect(request.headers.get('Kovo-Current-Url')).toBe(
      'https://shop.example.test/account?tab=security',
    );
    expect(response.headers.get('location')).toBe('/account?tab=security');
    expect(response.headers.get('location')).not.toContain('#');
  });

  it.each([
    {
      expected: '/cart?step=1',
      headers: { Referer: 'https://shop.example.test/cart?step=1#private-browser-state' },
      name: 'same-origin Referer',
    },
    {
      expected: '/',
      headers: { Referer: 'http://[' },
      name: 'invalid Referer',
    },
    {
      expected: '/',
      headers: { Referer: '//attacker.test/phish#private-browser-state' },
      name: 'scheme-relative Referer',
    },
    {
      expected: '/',
      headers: { Referer: 'https://attacker.test/phish#private-browser-state' },
      name: 'cross-origin Referer',
    },
    { expected: '/', headers: undefined, name: 'missing source headers' },
  ])(
    'derives the default no-JS redirect from canonical source truth for $name',
    async (testCase) => {
      const save = mutation('account/no-js-save', {
        csrf: false,
        csrfJustification: 'test fixture uses a non-browser caller',
        handler: () => ({}),
        input: s.object({}),
      });
      const app = createApp({ mutations: [save] });
      const request = new Request('https://shop.example.test/_m/account/no-js-save', {
        body: new FormData(),
        ...(testCase.headers === undefined ? {} : { headers: testCase.headers }),
        method: 'POST',
      });

      const response = await handleAppMutationRequest(
        app,
        request,
        new URL(request.url),
        'account/no-js-save',
      );

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(testCase.expected);
      expect(response.headers.get('location')).not.toContain('#');
      expect(response.headers.get('location')).not.toContain('private-browser-state');
    },
  );

  it('uses mutation-level dynamic redirectTo without an app-authored response switch', async () => {
    const signIn = mutation('auth/sign-in', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
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
      csrfJustification: 'test fixture uses a non-browser caller',
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
    // the handler without retaining ambient browser authority.
    const writes: string[] = [];
    const db = {
      insert(value: string) {
        writes.push(value);
      },
    };
    const addToCart = mutation('cart/request-db', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      input: s.object({ productId: s.string() }),
      handler(input, request: Request & { db: typeof db; session?: never }) {
        expect('session' in request).toBe(false);
        expect(request.headers.get('cookie')).toBeNull();
        request.db.insert(input.productId);
        return input;
      },
    });
    const app = createApp({ mutations: [addToCart] });
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
    expect(writes).toEqual(['p1']);
    expect(request.headers.get('cookie')).toBe('sid=victim');
  });

  it('rejects an accessor-backed request db without invoking it', async () => {
    const handler = vi.fn(() => ({ ok: true }));
    const app = createApp({
      mutations: [
        mutation('cart/accessor-db', {
          csrf: false,
          csrfJustification: 'test fixture uses a non-browser caller',
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
      csrfJustification: 'test fixture uses a non-browser caller',
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
    const renderer = {
      component: 'components/cart/badge',
      mutationKeys: [],
      queries: ['cart'],
      render: () => '<cart-badge>1</cart-badge>',
      stylesheets: [stylesheet('./badge.css')],
    };
    const app = withCompilerLiveTargetRenderers([renderer], () =>
      createApp({
        mutations: [addToCart],
        routes: [cartRoute],
        stylesheets: [stylesheet('./app.css')],
      }),
    );
    const form = new FormData();
    form.set('productId', 'p1');
    const request = new Request('https://shop.example.test/_m/cart/add', {
      body: form,
      headers: {
        Referer: 'https://shop.example.test/cart',
        'Kovo-Fragment': 'true',
        'Kovo-Live-Targets': `${attestedLiveTargetHeader('cart-badge', 'components/cart/badge', appLiveTargetAttestationAudience(app), {}, 'https://shop.example.test/cart')}`,
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
      csrfJustification: 'test fixture uses a non-browser caller',
      input: s.object({}),
      registry: { queries: [cartQuery], touches: [cart] },
      handler: () => ({}),
    });
    const renderer = {
      component: 'components/cart/map-poison',
      mutationKeys: [],
      queries: ['cart-map-poison'],
      render: () => '<cart-badge>safe</cart-badge>',
    };
    const app = withCompilerLiveTargetRenderers([renderer], () =>
      createApp({
        mutations: [addToCart],
        routes: [route('/', { page: () => renderedHtml('<main>Cart</main>') })],
        stylesheets: [stylesheet('./app.css')],
      }),
    );
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
          'Kovo-Current-Url': 'https://shop.example.test/',
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': attestedLiveTargetHeader(
            'cart-badge',
            'components/cart/map-poison',
            appLiveTargetAttestationAudience(app),
            {},
            'https://shop.example.test/',
          ),
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
      csrfJustification: 'test fixture uses a non-browser caller',
      input: s.object({}),
      registry: { queries: [cartQuery], touches: [cart] },
      handler: () => ({}),
    });
    const renderer = {
      component: 'components/cart/array-census',
      mutationKeys: [],
      queries: ['cart-array-census'],
      render: () => '<cart-badge>safe</cart-badge>',
      stylesheets: [
        stylesheet({ criticalCss: '.renderer-safe{color:green}', href: './renderer.css' }),
      ],
    };
    const app = withCompilerLiveTargetRenderers([renderer], () =>
      createApp({
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
      }),
    );

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
            appLiveTargetAttestationAudience(app),
            {},
            'https://shop.example.test/cart-array-census',
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
      csrfJustification: 'test fixture uses a non-browser caller',
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
    const catalogPlanRenderer: LiveTargetRenderer = {
      component: 'components/catalog/list-plan',
      mutationKeys: [],
      queries: ['catalogItems'],
      queryDefinitions: [catalogQuery],
      render: () => {
        throw new Error('A query-plan target must not render a fragment.');
      },
      updateCoverage: 'plan',
    };
    const app = withCompilerLiveTargetRenderers([catalogPlanRenderer], () =>
      createApp({
        mutations: [refreshCatalog],
        requestLimits: { maxQueryListItems: 2 },
        routes: [route('/catalog', { page: () => renderedHtml('<main>Catalog</main>') })],
      }),
    );
    const form = new FormData();
    form.set('reason', 'test');
    const request = new Request('https://shop.example.test/_m/catalog/refresh', {
      body: form,
      headers: {
        'Kovo-Current-Url': 'https://shop.example.test/catalog',
        'Kovo-Fragment': 'true',
        'Kovo-Live-Targets': attestedLiveTargetHeader(
          'catalog-list',
          'components/catalog/list-plan',
          appLiveTargetAttestationAudience(app),
          {},
          'https://shop.example.test/catalog',
        ),
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

  it('retains only anonymous live-target identity for csrf:false enhanced refreshes', async () => {
    const catalog = domain('anonymous-catalog');
    let queryClone: Request | undefined;
    const catalogQuery = query('anonymousCatalogItems', {
      load(_input: unknown, { request }: { request: Request }) {
        queryClone = request.clone();
        return { rows: [{ id: 1, label: 'anonymous item' }] };
      },
      reads: [catalog],
    });
    let handlerCookie: string | null | undefined;
    const refreshCatalog = mutation('anonymous-catalog/refresh', {
      csrf: false,
      csrfJustification: 'public refresh proof changes no server or browser state',
      input: s.object({ reason: s.string() }),
      registry: { queries: [catalogQuery], touches: [catalog] },
      handler(input, request) {
        handlerCookie = (request as Request).headers.get('cookie');
        return input;
      },
    });
    const catalogPlanRenderer: LiveTargetRenderer = {
      component: 'components/anonymous-catalog/list-plan',
      mutationKeys: [],
      queries: ['anonymousCatalogItems'],
      queryDefinitions: [catalogQuery],
      render: () => {
        throw new Error('A query-plan target must not render a fragment.');
      },
      updateCoverage: 'plan',
    };
    const csrfSessionCookieReads: Array<string | null> = [];
    const csrf = {
      secret: 'anonymous-live-target-csrf-secret-0123456789',
      sessionId(request: Request) {
        const cookie = request.headers.get('cookie');
        csrfSessionCookieReads.push(cookie);
        return /(?:^|;\s*)sid=([^;]+)/u.exec(cookie ?? '')?.[1];
      },
    };
    const app = withCompilerLiveTargetRenderers([catalogPlanRenderer], () =>
      createApp({
        csrf,
        mutations: [refreshCatalog],
        routes: [route('/catalog', { page: () => renderedHtml('<main>Catalog</main>') })],
      }),
    );
    const sourceUrl = 'https://shop.example.test/catalog';
    const anonymousSecret = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const sourceRequest = new Request(sourceUrl, {
      headers: { cookie: `__Host-kovo_csrf=${anonymousSecret}` },
    });
    const descriptor = {
      component: 'components/anonymous-catalog/list-plan',
      props: {},
      target: 'anonymous-catalog-list',
    };
    const attestation = createLiveTargetAttestation(descriptor, {
      buildToken: appLiveTargetAttestationAudience(app),
      csrf,
      request: sourceRequest,
      sourceUrl,
    });
    csrfSessionCookieReads.length = 0;
    const form = new FormData();
    form.set('reason', 'test');
    const request = new Request('https://shop.example.test/_m/anonymous-catalog/refresh', {
      body: form,
      headers: {
        cookie: `__Host-kovo_csrf=${anonymousSecret}`,
        'Kovo-Current-Url': sourceUrl,
        'Kovo-Fragment': 'true',
        'Kovo-Live-Targets': `${descriptor.target}#${descriptor.component}@${attestation}:{}`,
        'Kovo-Targets': `${descriptor.target}=anonymousCatalogItems`,
      },
      method: 'POST',
    });

    const response = await handleAppMutationRequest(
      app,
      request,
      new URL(request.url),
      'anonymous-catalog/refresh',
    );
    const body = await response.text();

    expect(response.status, body).toBe(200);
    expect(handlerCookie).toBeNull();
    expect(csrfSessionCookieReads).toEqual([]);
    expect(queryClone).toBeDefined();
    expect(resolveCsrfLiveTargetBinding(queryClone!, csrf)).toBeUndefined();
    expect(csrfSessionCookieReads).toEqual([null]);
    csrfSessionCookieReads.length = 0;
    expect(body).toContain(
      '<kovo-query name="anonymousCatalogItems">{"rows":[{"id":1,"label":"anonymous item"}]}</kovo-query>',
    );

    const wrongCookieRequest = new Request(request.url, {
      body: new URLSearchParams({ reason: 'wrong-cookie' }),
      headers: {
        cookie: '__Host-kovo_csrf=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        'Kovo-Current-Url': sourceUrl,
        'Kovo-Fragment': 'true',
        'Kovo-Live-Targets': `${descriptor.target}#${descriptor.component}@${attestation}:{}`,
        'Kovo-Targets': `${descriptor.target}=anonymousCatalogItems`,
      },
      method: 'POST',
    });
    const wrongCookieResponse = await handleAppMutationRequest(
      app,
      wrongCookieRequest,
      new URL(wrongCookieRequest.url),
      'anonymous-catalog/refresh',
    );
    await expect(wrongCookieResponse.text()).resolves.toBe('');
    expect(handlerCookie).toBeNull();

    const sessionSourceRequest = new Request(sourceUrl, {
      headers: {
        cookie: `__Host-kovo_csrf=${anonymousSecret}; sid=session-principal`,
      },
    });
    const sessionAttestation = createLiveTargetAttestation(descriptor, {
      buildToken: appLiveTargetAttestationAudience(app),
      csrf,
      request: sessionSourceRequest,
      sourceUrl,
    });
    csrfSessionCookieReads.length = 0;
    const sessionBoundRequest = new Request(request.url, {
      body: new URLSearchParams({ reason: 'session-bound' }),
      headers: {
        cookie: `__Host-kovo_csrf=${anonymousSecret}; sid=session-principal`,
        'Kovo-Current-Url': sourceUrl,
        'Kovo-Fragment': 'true',
        'Kovo-Live-Targets': `${descriptor.target}#${descriptor.component}@${sessionAttestation}:{}`,
        'Kovo-Targets': `${descriptor.target}=anonymousCatalogItems`,
      },
      method: 'POST',
    });
    const sessionBoundResponse = await handleAppMutationRequest(
      app,
      sessionBoundRequest,
      new URL(sessionBoundRequest.url),
      'anonymous-catalog/refresh',
    );
    await expect(sessionBoundResponse.text()).resolves.toBe('');
    expect(csrfSessionCookieReads).toEqual([]);

    const noAnonymousCookieRequest = new Request(request.url, {
      body: new URLSearchParams({ reason: 'session-cookie-only' }),
      headers: {
        cookie: 'sid=session-principal',
        'Kovo-Current-Url': sourceUrl,
        'Kovo-Fragment': 'true',
        'Kovo-Live-Targets': `${descriptor.target}#${descriptor.component}@${sessionAttestation}:{}`,
        'Kovo-Targets': `${descriptor.target}=anonymousCatalogItems`,
      },
      method: 'POST',
    });
    const noAnonymousCookieResponse = await handleAppMutationRequest(
      app,
      noAnonymousCookieRequest,
      new URL(noAnonymousCookieRequest.url),
      'anonymous-catalog/refresh',
    );
    await expect(noAnonymousCookieResponse.text()).resolves.toBe('');
    expect(csrfSessionCookieReads.length).toBeGreaterThan(0);
    expect(csrfSessionCookieReads.every((cookie) => cookie === null)).toBe(true);
  });

  it('inherits app and source-route stylesheets into generated enhanced failure fragments', async () => {
    const addToCart = mutation('cart/add', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
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
        'Kovo-Form-Target': 'cart-form',
        'Kovo-Fragment': 'true',
      },
      method: 'POST',
    });

    const response = await handleAppMutationRequest(app, request, new URL(request.url), 'cart/add');
    const body = await response.text();

    expect(response.status, body).toBe(422);
    expect(body).toBe(
      '<kovo-fragment target="cart-form"><link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/cart.css"><output role="alert" data-error-path="quantity">Expected number &gt;= 1</output></kovo-fragment>',
    );
  });

  it('resolves the app session once before guarded mutation handlers', async () => {
    // SPEC §6.6/§9.1: a session-authenticated mutation is CSRF-checked (KV418 forbids the
    // `csrf: false` + session combination), so this exercises the normal protected path. The
    // synchronizer token is stamped into the form and validated before the guard chain.
    const seen: string[] = [];
    let sessionReads = 0;
    type MutationSession = { id: string; user: { id: string } };
    type MutationRequest = Request & { session?: MutationSession | null };
    const csrf = {
      secret: 'mutation-session-once-secret-key-0123456789',
      sessionId: (request: MutationRequest) => request.session?.id,
    };
    const sessionProvider = () => {
      sessionReads += 1;
      return { id: 's1', user: { id: 'u1' } } satisfies MutationSession;
    };
    const addToCart = mutation('cart/add', {
      guard: guards.authed(),
      input: s.object({ productId: s.string() }),
      redirectTo: '/cart',
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
      mutations: [addToCart],
      sessionProvider,
    });
    const renderRequest = await resolveLifecycleRequest(
      new Request('https://shop.example.test/cart'),
      { sessionProvider },
    );
    const renderedToken = csrfToken(renderRequest, csrf, { audience: 'cart/add' });
    sessionReads = 0;
    const form = new FormData();
    form.set('productId', 'p1');
    form.set('kovo-csrf', renderedToken);
    const request = new Request('https://shop.example.test/_m/cart/add?from=button', {
      body: form,
      headers: { origin: 'https://shop.example.test' },
      method: 'POST',
    });

    const response = await handleAppMutationRequest(app, request, new URL(request.url), 'cart/add');

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/cart');
    expect(sessionReads).toBe(1);
    expect(seen).toEqual(['handler:u1:p1']);
    expect('session' in request).toBe(false);
  });

  it('keeps shared CSRF rotation ids and replay records bound to the current framework principal', async () => {
    // SPEC §6.6/§10.3: session/rotation identity and authorization principal are independent.
    // Even a misconfigured provider that shares the former must not let Bob validate or replay
    // Alice's private response/browser-state effects.
    type SharedSession = { id: string; user: { id: string } };
    type SharedRequest = Request & { session?: SharedSession | null };
    const csrf = {
      secret: 'shared-rotation-principal-secret-0123456789abcdef',
      sessionId: (request: SharedRequest) => request.session?.id,
    };
    const sessionProvider = (request: Request): SharedSession | null => {
      const userId = request.headers.get('x-user');
      return userId === null ? null : { id: 'shared-rotation', user: { id: userId } };
    };
    const handlerUsers: string[] = [];
    const save = mutation('account/save', {
      guard: guards.authed(),
      input: s.object({ value: s.string() }),
      redirectTo: '/done',
      handler(input, request, context) {
        const userId = (request as SharedRequest).session!.user.id;
        handlerUsers.push(userId);
        context.setCookie('seen-user', userId);
        return input;
      },
    });
    const app = createApp({
      csrf,
      mutationReplayStore: createMemoryMutationReplayStore(),
      mutations: [save],
      sessionProvider,
    });
    const tokenFor = async (userId: string) => {
      const renderRequest = await resolveLifecycleRequest(
        new Request('https://shop.example.test/account', {
          headers: { 'x-user': userId },
        }),
        { sessionProvider },
      );
      return csrfToken(renderRequest, csrf, { audience: save.key });
    };
    const idem = mintIdemToken();
    const submit = async (userId: string, token: string) => {
      const body = new FormData();
      body.set('value', 'same-input');
      body.set('kovo-csrf', token);
      body.set('Kovo-Idem', idem);
      const request = new Request('https://shop.example.test/_m/account/save', {
        body,
        headers: { origin: 'https://shop.example.test', 'x-user': userId },
        method: 'POST',
      });
      return handleAppMutationRequest(app, request, new URL(request.url), save.key);
    };

    const aliceToken = await tokenFor('alice');
    const alice = await submit('alice', aliceToken);
    const crossPrincipal = await submit('bob', aliceToken);
    const bob = await submit('bob', await tokenFor('bob'));

    expect(alice.status).toBe(303);
    expect(crossPrincipal.status).toBe(422);
    expect(crossPrincipal.headers.getSetCookie()).toEqual([]);
    expect(bob.status).toBe(303);
    expect(alice.headers.getSetCookie()).toEqual([
      '__Host-seen-user=alice; Path=/; HttpOnly; Secure; SameSite=Lax',
    ]);
    expect(bob.headers.getSetCookie()).toEqual([
      '__Host-seen-user=bob; Path=/; HttpOnly; Secure; SameSite=Lax',
    ]);
    expect(handlerUsers).toEqual(['alice', 'bob']);
  });

  it('rejects an oversized framework principal before replay-store or handler execution', async () => {
    type OversizedSession = { id: string; user: { id: string } };
    type OversizedRequest = Request & { session?: OversizedSession | null };
    const principal = 'p'.repeat(1_025);
    const csrf = {
      secret: 'oversized-framework-principal-secret-0123456789abcdef',
      sessionId: (request: OversizedRequest) => request.session?.id,
    };
    const replayStore = {
      get: vi.fn(() => undefined),
      reserve: vi.fn(() => undefined),
      set: vi.fn(),
    };
    const handler = vi.fn((input: { value: string }) => input);
    const save = mutation('account/oversized-principal', {
      guard: guards.authed(),
      handler,
      input: s.object({ value: s.string() }),
      redirectTo: '/done',
    });
    const app = createApp({
      csrf,
      mutationReplayStore: replayStore,
      mutations: [save],
      sessionProvider: () => ({ id: 'rotation', user: { id: principal } }),
    });
    // A standalone helper has no framework lifecycle principal metadata and can mint the former
    // session-id-only shape. Dispatch must still reject the framework-resolved oversized principal
    // rather than falling back to anonymous CSRF or touching replay/handler authority.
    const token = csrfToken(
      { session: { id: 'rotation', user: { id: principal } } } as OversizedRequest,
      csrf,
      { audience: save.key },
    );
    const body = new FormData();
    body.set('value', 'blocked');
    body.set('kovo-csrf', token);
    body.set('Kovo-Idem', mintIdemToken());
    const request = new Request('https://shop.example.test/_m/account/oversized-principal', {
      body,
      headers: { origin: 'https://shop.example.test' },
      method: 'POST',
    });

    const response = await handleAppMutationRequest(app, request, new URL(request.url), save.key);

    expect(response.status).toBe(422);
    expect(replayStore.get).not.toHaveBeenCalled();
    expect(replayStore.reserve).not.toHaveBeenCalled();
    expect(replayStore.set).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('authorizes and reruns mutation failure UI against the canonical source GET request', async () => {
    const events: string[] = [];
    const sourceRequests: Request[] = [];
    const contextualLoad = vi.fn((_input: unknown, { request }: { request: Request }) => {
      events.push('source-query');
      sourceRequests.push(request);
      return {
        value: new URL(request.url).pathname.startsWith('/_m/')
          ? 'ADMIN_MUTATION_SECRET'
          : 'PUBLIC_PAGE',
      };
    });
    const contextualQuery = query('public/mutation-source-context', {
      access: { kind: 'public', reason: 'source-context regression fixture' },
      load: contextualLoad,
    });
    const SourcePanel = assignDerivedComponentName(
      component({
        mutations: { deleteAdmin: form('admin/delete') },
        queries: { contextual: contextualQuery },
        render: ({ contextual }) =>
          trustedHtml(
            `<mutation-source-panel>${(contextual as { value: string }).value}</mutation-source-panel>`,
            'source-context regression fixture',
          ),
      }),
      'components/mutation/source-panel',
    );
    const renderer = componentLiveTargetRenderer({
      component: SourcePanel,
      componentId: 'components/mutation/source-panel',
    });
    expect(renderer.mutationKeys).toEqual(['admin/delete']);

    const mutationGuard = vi.fn(() => {
      events.push('mutation-guard');
      return { kind: 'forbidden' as const };
    });
    const adminHandler = vi.fn(() => ({ ok: true }));
    const adminMutation = mutation('admin/delete', {
      guard: mutationGuard,
      input: s.object({ confirmation: s.string() }),
      handler: adminHandler,
    });
    const sourceGuard = guard<Request>('mutation-source-route', (request) => {
      events.push('source-guard');
      expect(request.method).toBe('GET');
      expect(new URL(request.url).pathname).toBe('/public');
      expect(request.headers.get('accept')).toBe('text/html');
      expect(request.headers.get('cookie')).toBe('sid=public-user');
      expect(request.headers.get('origin')).toBeNull();
      expect(request.headers.get('kovo-fragment')).toBeNull();
      return request.headers.get('x-source-allowed') === 'yes'
        ? true
        : { kind: 'forbidden' as const };
    });
    const csrf = {
      secret: 'mutation-source-context-secret-key-0123456789',
      sessionId: () => 'public-user',
    };
    const app = withCompilerLiveTargetRenderers([renderer], () =>
      createApp({
        csrf,
        mutations: [adminMutation],
        routes: [
          route('/public', {
            access: [sourceGuard],
            page: () => jsx(SourcePanel, {}),
          }),
        ],
      }),
    );
    const handler = createRequestHandler(app);
    const sourceHeaders = {
      Accept: 'text/html',
      Cookie: 'sid=public-user',
      'X-Source-Allowed': 'yes',
    };
    const publicPage = await handler(
      new Request('https://app.test/public', { headers: sourceHeaders }),
    );
    const publicHtml = await publicPage.text();
    const target = /kovo-fragment-target="([^"]+)"/u.exec(publicHtml)?.[1];
    const token = /kovo-live-token="([^"]+)"/u.exec(publicHtml)?.[1];
    expect(target).toBe('source-panel');
    expect(token).toBeTruthy();
    expect(publicHtml).toContain('PUBLIC_PAGE');
    events.length = 0;

    const mutationCsrf = csrfToken({}, csrf, { audience: adminMutation.key });
    const enhancedForm = new FormData();
    enhancedForm.set('confirmation', 'yes');
    enhancedForm.set('kovo-csrf', mutationCsrf);
    const enhancedResponse = await handler(
      new Request('https://app.test/_m/admin/delete', {
        body: enhancedForm,
        headers: {
          ...sourceHeaders,
          Origin: 'https://app.test',
          'Kovo-Current-Url': 'https://app.test/public',
          'Kovo-Form-Target': target!,
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': `${target}#components/mutation/source-panel@${token}:{}`,
        },
        method: 'POST',
      }),
    );
    const enhancedBody = await enhancedResponse.text();
    expect(enhancedResponse.status).toBe(403);
    expect(enhancedBody).toContain('PUBLIC_PAGE');
    expect(enhancedBody).not.toContain('ADMIN_MUTATION_SECRET');
    expect(events).toEqual(['mutation-guard', 'source-guard', 'source-query']);
    expect(adminHandler).not.toHaveBeenCalled();
    expect(new URL(sourceRequests.at(-1)!.url).pathname).toBe('/public');

    events.length = 0;
    const invalidForm = new FormData();
    invalidForm.set('kovo-csrf', mutationCsrf);
    const validationResponse = await handler(
      new Request('https://app.test/_m/admin/delete', {
        body: invalidForm,
        headers: {
          ...sourceHeaders,
          Origin: 'https://app.test',
          'Kovo-Current-Url': 'https://app.test/public',
          'Kovo-Form-Target': target!,
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': `${target}#components/mutation/source-panel@${token}:{}`,
        },
        method: 'POST',
      }),
    );
    expect(validationResponse.status).toBe(422);
    expect(await validationResponse.text()).toContain('PUBLIC_PAGE');
    expect(events).toEqual(['source-guard', 'source-query']);
    expect(mutationGuard).toHaveBeenCalledTimes(1);

    events.length = 0;
    const noJsForm = new FormData();
    noJsForm.set('kovo-csrf', mutationCsrf);
    const noJsResponse = await handler(
      new Request('https://app.test/_m/admin/delete', {
        body: noJsForm,
        headers: {
          ...sourceHeaders,
          Origin: 'https://app.test',
          'Kovo-Current-Url': 'https://app.test/public',
        },
        method: 'POST',
      }),
    );
    const noJsBody = await noJsResponse.text();
    expect(noJsResponse.status).toBe(422);
    expect(noJsBody).toContain('PUBLIC_PAGE');
    expect(noJsBody).not.toContain('ADMIN_MUTATION_SECRET');
    expect(events).toEqual(['source-guard', 'source-query']);

    events.length = 0;
    const deniedForm = new FormData();
    deniedForm.set('confirmation', 'yes');
    deniedForm.set('kovo-csrf', mutationCsrf);
    const deniedResponse = await handler(
      new Request('https://app.test/_m/admin/delete', {
        body: deniedForm,
        headers: {
          Cookie: 'sid=public-user',
          Origin: 'https://app.test',
          'Kovo-Current-Url': 'https://app.test/public',
          'Kovo-Form-Target': target!,
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': `${target}#components/mutation/source-panel@${token}:{}`,
        },
        method: 'POST',
      }),
    );
    const deniedBody = await deniedResponse.text();
    expect(deniedResponse.status).toBe(403);
    expect(deniedBody).not.toContain('PUBLIC_PAGE');
    expect(deniedBody).not.toContain('ADMIN_MUTATION_SECRET');
    expect(events).toEqual(['mutation-guard', 'source-guard']);
    expect(contextualLoad).toHaveBeenCalledTimes(4);

    events.length = 0;
    const csrfFailureForm = new FormData();
    csrfFailureForm.set('confirmation', 'yes');
    csrfFailureForm.set('kovo-csrf', 'forged');
    const csrfFailureResponse = await handler(
      new Request('https://app.test/_m/admin/delete', {
        body: csrfFailureForm,
        headers: {
          ...sourceHeaders,
          Origin: 'https://app.test',
          'Kovo-Current-Url': 'https://app.test/public',
          'Kovo-Form-Target': target!,
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': `${target}#components/mutation/source-panel@${token}:{}`,
        },
        method: 'POST',
      }),
    );
    const csrfFailureBody = await csrfFailureResponse.text();
    expect(csrfFailureResponse.status).toBe(422);
    expect(csrfFailureBody).not.toContain('PUBLIC_PAGE');
    expect(csrfFailureBody).not.toContain('ADMIN_MUTATION_SECRET');
    expect(events).toEqual([]);
    expect(contextualLoad).toHaveBeenCalledTimes(4);
  });

  it('pins replay-store authority and does not run the handler when reservation fails closed', async () => {
    const handler = vi.fn(() => ({ ok: true }));
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
        'Kovo-Idem': mintIdemToken(),
        origin: 'https://example.test',
      },
      method: 'POST',
    });

    const response = await handleAppMutationRequest(app, request, new URL(request.url), 'save');
    expect(response.status).toBe(429);
    expect(handler).not.toHaveBeenCalled();
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
      csrfJustification: 'test fixture uses a non-browser caller',
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

  it('keeps csrf:false no-JS source failure rerenders credential and session neutral', async () => {
    let sessionReads = 0;
    const sourceRequests: Request[] = [];
    const update = mutation('machine/update', {
      csrf: false,
      csrfJustification: 'signed non-browser fixture has no ambient browser authority',
      input: s.object({ value: s.string() }),
      handler: () => ({ ok: true }),
    });
    const app = createApp({
      mutations: [update],
      routes: [
        route('/public', {
          page(_context, request) {
            sourceRequests.push(request);
            const lifecycle = request as Request & { session?: unknown };
            return renderedHtml(
              `<main>session:${String('session' in lifecycle)} cookie:${String(request.headers.get('cookie'))} auth:${String(request.headers.get('authorization'))}</main>`,
            );
          },
        }),
      ],
      sessionProvider() {
        sessionReads += 1;
        return { user: { id: 'victim' } };
      },
    });
    const response = await createRequestHandler(app)(
      new Request('https://app.test/_m/machine/update', {
        body: new FormData(),
        headers: {
          Authorization: 'Bearer victim',
          Cookie: 'sid=victim',
          'Kovo-Current-Url': 'https://app.test/public',
        },
        method: 'POST',
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(422);
    expect(body).toContain('session:false cookie:null auth:null');
    expect(sessionReads).toBe(0);
    expect(sourceRequests).toHaveLength(1);
    expect(sourceRequests[0]!.method).toBe('GET');
    expect(new URL(sourceRequests[0]!.url).pathname).toBe('/public');
  });

  // H1 (high) — SPEC §9.2: malformed/wrong-Content-Type mutation body → 422, before CSRF.
  // Before the fix, readMutationRequestBody threw into the generic 500 shell + onError.

  it('H1: returns 422 for a malformed JSON body without calling onError', async () => {
    const onError = vi.fn();
    const addToCart = mutation('cart/add', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
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
      csrfJustification: 'test fixture uses a non-browser caller',
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
