import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { handleAppMutationRequest } from './app-mutation-request.js';
import { guards } from './guards.js';
import { mutation } from './mutation.js';
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
});
