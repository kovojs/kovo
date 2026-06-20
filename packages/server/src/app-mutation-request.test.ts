import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';
import { handleAppMutationRequest } from './app-mutation-request.js';
import { domain } from './domain.js';
import { guards } from './guards.js';
import { stylesheet } from './hints.js';
import { mutation } from './mutation.js';
import { query } from './query.js';
import { route } from './route.js';
import { s } from './schema.js';

describe('server app mutation request boundary', () => {
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
    expect(seen).toEqual(['policy:true', 'handler:p1']);
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
      page: () => '<main>Cart</main>',
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
        'Kovo-Live-Targets': 'cart-badge#components/cart/badge:{}',
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

  it('inherits app and source-route stylesheets into enhanced failure fragments', async () => {
    const addToCart = mutation('cart/add', {
      csrf: false,
      input: s.object({ quantity: s.number().int().min(1) }),
      handler(input) {
        return input;
      },
    });
    const cartRoute = route('/cart', {
      page: () => '<main>Cart</main>',
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
    const seen: string[] = [];
    let sessionReads = 0;
    const addToCart = mutation('cart/add', {
      csrf: false,
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
    const request = new Request('https://shop.example.test/_m/cart/add?from=button', {
      body: form,
      method: 'POST',
    });

    const response = await handleAppMutationRequest(app, request, new URL(request.url), 'cart/add');

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/cart');
    expect(sessionReads).toBe(1);
    expect(seen).toEqual(['response:u1:/_m/cart/add?from=button:true', 'handler:u1:p1']);
    expect('session' in request).toBe(false);
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
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('VALIDATION');
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
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('VALIDATION');
  });
});
