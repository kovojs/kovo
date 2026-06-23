import { describe, expect, it, vi } from 'vitest';
import { component, form } from '@kovojs/core';

import { renderComponentMutationFailure } from './component-render.js';
import { renderNoJsMutationResponse } from './mutation.js';
import { s } from './schema.js';
import { testMutation as mutation } from './test-fixtures.js';

describe('no-JS mutation responses', () => {
  it('renders no-JS mutation success as POST-redirect-GET', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1).default(1),
      }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderNoJsMutationResponse(addToCart, {
        rawInput: { productId: 'p1', quantity: 1 },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toEqual({
      body: '',
      headers: {
        'Cache-Control': 'no-store',
        Location: '/cart',
      },
      status: 303,
    });
  });

  it('renders no-JS mutation failures as a full HTML 422 page', async () => {
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string() }),
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });

    await expect(
      renderNoJsMutationResponse(addToCart, {
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toEqual({
      body: '<!doctype html><html><body><output role="alert" data-error-code="OUT_OF_STOCK">{"availableQuantity":0}</output></body></html>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 422,
    });
  });

  it('can render no-JS failures through the same component mutation form state', async () => {
    const addToCartForm = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'OUT_OF_STOCK'; payload: { availableQuantity: number } }
    >('cart/add');
    const AddToCartForm = component({
      mutations: { addToCart: addToCartForm },
      render: (_queries, _state, { forms }) =>
        '<!doctype html><html><body><form>' +
        (forms.addToCart.failure?.code === 'OUT_OF_STOCK'
          ? `<output role="alert">Only ${forms.addToCart.failure.payload.availableQuantity} left.</output>`
          : '') +
        '</form></body></html>',
    });
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string(), quantity: s.number().int().min(1) }),
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 3 });
      },
    });

    await expect(
      renderNoJsMutationResponse(addToCart, {
        rawInput: { productId: 'p1', quantity: 2 },
        redirectTo: '/cart',
        renderFailurePage: (failure) =>
          renderComponentMutationFailure(AddToCartForm, {}, failure, { formName: 'addToCart' }),
        request: {},
      }),
    ).resolves.toEqual({
      body: '<!doctype html><html><body><form><output role="alert">Only 3 left.</output></form></body></html>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 422,
    });
  });

  it('renders no-JS mutation handler exceptions as an HTML 500 response', async () => {
    const thrown = new Error('handler unavailable');
    const onError = vi.fn();
    const request = {};
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler() {
        throw thrown;
      },
    });

    await expect(
      renderNoJsMutationResponse(addToCart, {
        onError,
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request,
      }),
    ).resolves.toEqual({
      body: 'Internal Server Error',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 500,
    });
    expect(onError).toHaveBeenCalledWith(thrown, {
      mutationKey: 'cart/add',
      operation: 'no-js-mutation-handler',
      request,
    });
  });

  it('renders no-JS schema validation failures with field paths by default', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1),
      }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderNoJsMutationResponse(addToCart, {
        rawInput: { productId: 'p1', quantity: 0 },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toEqual({
      body: '<!doctype html><html><body><output role="alert" data-error-path="quantity">Expected number &gt;= 1</output></body></html>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 422,
    });
  });

  // A2-server (SPEC §10.3:1063): duplicate no-JS form submissions with the same Kovo-Idem
  // must run the handler only once; the settled 303 is replayed on re-submit.
  it('A2: deduplicates no-JS form submissions by Kovo-Idem, running the handler only once', async () => {
    let handlerCalls = 0;
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        handlerCalls += 1;
        return input;
      },
    });

    // Build a simple in-memory NoJsMutationReplayStore using a Map.
    const store = new Map<string, import('./mutation-wire.js').NoJsMutationResponse>();
    const noJsReplayStore: import('./mutation-wire.js').NoJsMutationReplayStore = {
      get(scope, idem) {
        return store.get(`${scope}\0${idem}`);
      },
      reserve(scope, idem) {
        const key = `${scope}\0${idem}`;
        if (store.has(key)) return undefined;
        // Use a sentinel value to mark as reserved (pending).
        const reservation: import('./mutation-wire.js').NoJsMutationReplayReservation = {
          abort() {
            store.delete(key);
          },
          commit(response) {
            store.set(key, response);
          },
        };
        // Mark slot as taken so a concurrent reserve returns undefined.
        store.set(key, { body: '', headers: {}, status: 303 });
        return reservation;
      },
    };

    const base = {
      idem: 'idem_nojs_01',
      rawInput: { productId: 'p1' },
      redirectTo: '/cart',
      replayStore: noJsReplayStore,
      request: { sessionId: 's1' },
    };

    // First submit: handler runs, 303 committed.
    const first = await renderNoJsMutationResponse(addToCart, base);
    expect(first.status).toBe(303);
    expect(handlerCalls).toBe(1);

    // Second submit (same idem): handler must NOT run again; replayed 303 returned.
    const second = await renderNoJsMutationResponse(addToCart, base);
    expect(second.status).toBe(303);
    expect(handlerCalls).toBe(1);
  });

  // GAP4-2 (SPEC §10.3:1062-1066): csrf:false mutation with no session must still
  // dedup by Kovo-Idem using a mutation-key namespace scope.
  it('GAP4-2: csrf:false sessionless mutation deduplicates by Kovo-Idem without session', async () => {
    let handlerCalls = 0;
    const extWrite = mutation('ext/write', {
      csrf: false,
      input: s.object({ value: s.string() }),
      handler(input) {
        handlerCalls += 1;
        return input;
      },
    });

    const store = new Map<string, import('./mutation-wire.js').NoJsMutationResponse>();
    const noJsReplayStore: import('./mutation-wire.js').NoJsMutationReplayStore = {
      get(scope, idem) {
        return store.get(`${scope}\0${idem}`);
      },
      reserve(scope, idem) {
        const key = `${scope}\0${idem}`;
        if (store.has(key)) return undefined;
        const reservation: import('./mutation-wire.js').NoJsMutationReplayReservation = {
          abort() {
            store.delete(key);
          },
          commit(response) {
            store.set(key, response);
          },
        };
        store.set(key, { body: '', headers: {}, status: 303 });
        return reservation;
      },
    };

    const base = {
      idem: 'idem_gap42',
      rawInput: { value: 'hello' },
      redirectTo: '/done',
      replayStore: noJsReplayStore,
      request: {}, // no session
    };

    const first = await renderNoJsMutationResponse(extWrite, base);
    expect(first.status).toBe(303);
    expect(handlerCalls).toBe(1);

    // Same idem, no session: must dedup and not re-run the handler.
    const second = await renderNoJsMutationResponse(extWrite, base);
    expect(second.status).toBe(303);
    expect(handlerCalls).toBe(1);
  });

  it('fails closed instead of running no-JS mutations when replay reservation is refused', async () => {
    let handlerCalls = 0;
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        handlerCalls += 1;
        return input;
      },
    });
    const noJsReplayStore: import('./mutation-wire.js').NoJsMutationReplayStore = {
      get() {
        return undefined;
      },
      reserve() {
        return undefined;
      },
    };

    const response = await renderNoJsMutationResponse(addToCart, {
      idem: 'idem_saturated',
      rawInput: { productId: 'p1' },
      redirectTo: '/cart',
      replayStore: noJsReplayStore,
      request: { sessionId: 's1' },
    });

    expect(handlerCalls).toBe(0);
    expect(response.status).toBe(429);
    expect(response.headers['Retry-After']).toBe('1');
    expect(response.body).toContain('data-error-code="RATE_LIMITED"');
  });
});
