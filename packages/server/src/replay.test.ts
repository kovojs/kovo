import { describe, expect, it, vi } from 'vitest';

import { csrfToken } from './csrf.js';
import { domain } from './domain.js';
import { renderMutationResponse } from './mutation.js';
import { query } from './query.js';
import {
  createMemoryMutationReplayStore,
  type MutationReplayResponse,
  type MutationReplayStore,
} from './replay.js';
import { s } from './schema.js';
import { testMutation as mutation } from './test-fixtures.js';

function deferred<Value = void>(): {
  promise: Promise<Value>;
  reject(reason?: unknown): void;
  resolve(value: Value | PromiseLike<Value>): void;
} {
  let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

describe('server mutation replay store', () => {
  it('bounds memory mutation replay records by ttl and entry count', () => {
    vi.useFakeTimers();
    try {
      const replayStore = createMemoryMutationReplayStore({ maxEntries: 1, ttlMs: 100 });
      const first = {
        body: 'first',
        headers: { 'FW-Idem': 'idem_01' },
        status: 200,
      } as const;
      const second = {
        body: 'second',
        headers: { 'FW-Idem': 'idem_02' },
        status: 200,
      } as const;

      replayStore.set('session-a', 'idem_01', first);
      replayStore.set('session-a', 'idem_02', second);

      expect(replayStore.get('session-a', 'idem_01')).toBeUndefined();
      expect(replayStore.get('session-a', 'idem_02')).toEqual(second);

      vi.advanceTimersByTime(100);

      expect(replayStore.get('session-a', 'idem_02')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('server mutation response replay', () => {
  it('replays enhanced mutation responses by FW-Idem without re-running the handler', async () => {
    const cart = domain('cart');
    const replayStore = createMemoryMutationReplayStore();
    let writes = 0;
    const cartQuery = query('cart', {
      load: () => ({ count: writes }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        writes += 1;
        return input;
      },
    });
    const request = {
      idem: 'idem_01',
      rawInput: { productId: 'p1' },
      replayStore,
      request: { sessionId: 's1' },
      targets: ['cart-badge'],
    };

    const first = await renderMutationResponse(addToCart, request);
    first.headers['X-Mutated-By-Test'] = 'yes';
    const second = await renderMutationResponse(addToCart, request);

    expect(writes).toBe(1);
    expect(second).toEqual({
      body: '<fw-query name="cart">{"count":1}</fw-query>',
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        'FW-Changes': '[{"domain":"cart"}]',
        'FW-Idem': 'idem_01',
      },
      status: 200,
    });
  });

  // Security finding M4: the reservation must be created BEFORE the handler runs,
  // so a duplicate dispatched while the first handler is still in-flight coalesces
  // onto the first execution instead of double-running the handler.
  it('runs the handler once for concurrent duplicates dispatched mid-handler', async () => {
    const cart = domain('cart');
    const replayStore = createMemoryMutationReplayStore();
    const handlerStarted = deferred();
    const handlerRelease = deferred();
    let writes = 0;
    const cartQuery = query('cart', {
      load: () => ({ count: writes }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      async handler(input) {
        handlerStarted.resolve();
        await handlerRelease.promise;
        writes += 1;
        return input;
      },
    });
    const request = {
      idem: 'idem_concurrent_handler',
      rawInput: { productId: 'p1' },
      replayStore,
      request: { sessionId: 's1' },
      targets: ['cart-badge'],
    };

    const first = renderMutationResponse(addToCart, request);
    await handlerStarted.promise;
    // Dispatch the duplicate while the first handler is still pending.
    const second = renderMutationResponse(addToCart, request);
    await Promise.resolve();

    handlerRelease.resolve();
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(writes).toBe(1);
    expect(firstResponse).toEqual(secondResponse);
    expect(firstResponse).toMatchObject({
      body: '<fw-query name="cart">{"count":1}</fw-query>',
      status: 200,
    });
  });

  it('scopes replay records by mutation key so a sibling mutation does not replay another', async () => {
    const cart = domain('cart');
    const replayStore = createMemoryMutationReplayStore();
    let addWrites = 0;
    let removeWrites = 0;
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: { touches: [cart] },
      handler(input) {
        addWrites += 1;
        return input;
      },
    });
    const removeFromCart = mutation('cart/remove', {
      input: s.object({ productId: s.string() }),
      registry: { touches: [cart] },
      handler(input) {
        removeWrites += 1;
        return input;
      },
    });
    const baseRequest = {
      idem: 'idem_shared',
      rawInput: { productId: 'p1' },
      replayStore,
      request: { sessionId: 's1' },
    };

    await renderMutationResponse(addToCart, baseRequest);
    // Same session + same FW-Idem but a different mutation: must NOT replay the
    // add response; the remove handler must run on its own scope.
    await renderMutationResponse(removeFromCart, baseRequest);

    expect(addWrites).toBe(1);
    expect(removeWrites).toBe(1);
  });

  it('does not double-run the handler for concurrent duplicates that race the reservation', async () => {
    // Exercise the reserve()-returns-undefined race: the second request reserves
    // before its own get() can observe the first, so it must await the pending
    // entry rather than re-run the handler.
    const cart = domain('cart');
    const reserved = new Set<string>();
    const records = new Map<string, MutationReplayResponse>();
    const pendingResolvers = new Map<string, (response: MutationReplayResponse) => void>();
    const replayStore: MutationReplayStore = {
      get(scope, idem) {
        const key = `${scope} ${idem}`;
        return records.get(key);
      },
      reserve(scope, idem) {
        const key = `${scope} ${idem}`;
        if (reserved.has(key)) return undefined;
        reserved.add(key);
        let resolvePending: (response: MutationReplayResponse) => void = () => undefined;
        const pending = new Promise<MutationReplayResponse>((resolve) => {
          resolvePending = resolve;
        });
        records.set(key, pending as unknown as MutationReplayResponse);
        pendingResolvers.set(key, resolvePending);
        return {
          commit(response) {
            records.set(key, response);
            pendingResolvers.get(key)?.(response);
          },
        };
      },
      set(scope, idem, response) {
        records.set(`${scope} ${idem}`, response);
      },
    };
    const handlerStarted = deferred();
    const handlerRelease = deferred();
    let writes = 0;
    const cartQuery = query('cart', {
      load: () => ({ count: writes }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: { queries: [cartQuery], touches: [cart] },
      async handler(input) {
        handlerStarted.resolve();
        await handlerRelease.promise;
        writes += 1;
        return input;
      },
    });
    const request = {
      idem: 'idem_race',
      rawInput: { productId: 'p1' },
      replayStore,
      request: { sessionId: 's1' },
    };

    const first = renderMutationResponse(addToCart, request);
    await handlerStarted.promise;
    const second = renderMutationResponse(addToCart, request);
    await Promise.resolve();

    handlerRelease.resolve();
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(writes).toBe(1);
    expect(firstResponse).toEqual(secondResponse);
  });

  it('does not replay a different request after a validation failure abandons the reservation', async () => {
    const replayStore = createMemoryMutationReplayStore();
    let writes = 0;
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        writes += 1;
        return input;
      },
    });
    const base = { idem: 'idem_validation_abort', replayStore, request: { sessionId: 's1' } };

    await expect(
      renderMutationResponse(addToCart, { ...base, rawInput: { quantity: 1 } }),
    ).resolves.toMatchObject({ status: 422 });
    // A corrected retry under the same idem must run the handler (the failed
    // reservation was abandoned, not committed).
    await expect(
      renderMutationResponse(addToCart, { ...base, rawInput: { productId: 'p1' } }),
    ).resolves.toMatchObject({ status: 200 });

    expect(writes).toBe(1);
  });

  it('replays duplicate requests while post-commit query rendering is pending', async () => {
    const cart = domain('cart');
    const replayStore = createMemoryMutationReplayStore();
    const queryStarted = deferred();
    const queryRelease = deferred();
    let writes = 0;
    let loads = 0;
    const cartQuery = query('cart', {
      async load() {
        loads += 1;
        queryStarted.resolve();
        await queryRelease.promise;
        return { count: writes };
      },
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        writes += 1;
        return input;
      },
    });
    const request = {
      idem: 'idem_pending_query',
      rawInput: { productId: 'p1' },
      replayStore,
      request: { sessionId: 's1' },
      targets: ['cart-badge'],
    };

    const first = renderMutationResponse(addToCart, request);
    await queryStarted.promise;
    const second = renderMutationResponse(addToCart, request);
    await Promise.resolve();

    expect(writes).toBe(1);
    expect(loads).toBe(1);

    queryRelease.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        body: '<fw-query name="cart">{"count":1}</fw-query>',
        headers: {
          'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
          'FW-Changes': '[{"domain":"cart"}]',
          'FW-Idem': 'idem_pending_query',
        },
        status: 200,
      },
      {
        body: '<fw-query name="cart">{"count":1}</fw-query>',
        headers: {
          'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
          'FW-Changes': '[{"domain":"cart"}]',
          'FW-Idem': 'idem_pending_query',
        },
        status: 200,
      },
    ]);
    expect(writes).toBe(1);
    expect(loads).toBe(1);
  });

  it('replays duplicate requests while post-commit fragment rendering is pending', async () => {
    const cart = domain('cart');
    const replayStore = createMemoryMutationReplayStore();
    const fragmentStarted = deferred();
    const fragmentRelease = deferred();
    let writes = 0;
    let renders = 0;
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        touches: [cart],
      },
      handler(input) {
        writes += 1;
        return input;
      },
    });
    const request = {
      fragmentRenderers: [
        {
          async render() {
            renders += 1;
            fragmentStarted.resolve();
            await fragmentRelease.promise;
            return '<cart-badge>1</cart-badge>';
          },
          target: 'cart-badge',
        },
      ],
      idem: 'idem_pending_fragment',
      rawInput: { productId: 'p1' },
      replayStore,
      request: { sessionId: 's1' },
      targets: ['cart-badge'],
    };

    const first = renderMutationResponse(addToCart, request);
    await fragmentStarted.promise;
    const second = renderMutationResponse(addToCart, request);
    await Promise.resolve();

    expect(writes).toBe(1);
    expect(renders).toBe(1);

    fragmentRelease.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        body: '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
        headers: {
          'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
          'FW-Changes': '[{"domain":"cart"}]',
          'FW-Idem': 'idem_pending_fragment',
        },
        status: 200,
      },
      {
        body: '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
        headers: {
          'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
          'FW-Changes': '[{"domain":"cart"}]',
          'FW-Idem': 'idem_pending_fragment',
        },
        status: 200,
      },
    ]);
    expect(writes).toBe(1);
    expect(renders).toBe(1);
  });

  it('replays duplicate mutation failures while the failure fragment is pending', async () => {
    const replayStore = createMemoryMutationReplayStore();
    const failureStarted = deferred();
    const failureRelease = deferred();
    let attempts = 0;
    let renders = 0;
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string() }),
      handler(_input, _request, context) {
        attempts += 1;
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });
    const request = {
      idem: 'idem_pending_failure',
      rawInput: { productId: 'p1' },
      renderFailureFragment: async () => {
        renders += 1;
        failureStarted.resolve();
        await failureRelease.promise;
        return '<output role="alert">Sold out</output>';
      },
      replayStore,
      request: { sessionId: 's1' },
    };

    const first = renderMutationResponse(addToCart, request);
    await failureStarted.promise;
    const second = renderMutationResponse(addToCart, request);
    await Promise.resolve();

    expect(attempts).toBe(1);
    expect(renders).toBe(1);

    failureRelease.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        body: '<fw-fragment target="error"><output role="alert">Sold out</output></fw-fragment>',
        headers: {
          'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
          'FW-Idem': 'idem_pending_failure',
        },
        status: 422,
      },
      {
        body: '<fw-fragment target="error"><output role="alert">Sold out</output></fw-fragment>',
        headers: {
          'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
          'FW-Idem': 'idem_pending_failure',
        },
        status: 422,
      },
    ]);
    expect(attempts).toBe(1);
    expect(renders).toBe(1);
  });

  it('replays enhanced mutation validation failures by FW-Idem', async () => {
    const replayStore = createMemoryMutationReplayStore();
    let attempts = 0;
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string() }),
      handler(_input, _request, context) {
        attempts += 1;
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });
    const request = {
      idem: 'idem_422',
      rawInput: { productId: 'p1' },
      replayStore,
      request: { sessionId: 's1' },
    };

    await expect(renderMutationResponse(addToCart, request)).resolves.toMatchObject({
      status: 422,
    });
    await expect(renderMutationResponse(addToCart, request)).resolves.toEqual({
      body: '<fw-fragment target="error"><output role="alert" data-error-code="OUT_OF_STOCK">{"availableQuantity":0}</output></fw-fragment>',
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        'FW-Idem': 'idem_422',
      },
      status: 422,
    });
    expect(attempts).toBe(1);
  });

  it('does not replay pure schema validation failures by FW-Idem', async () => {
    const replayStore = createMemoryMutationReplayStore();
    let writes = 0;
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        writes += 1;
        return input;
      },
    });
    const baseRequest = {
      idem: 'idem_validation',
      replayStore,
      request: { sessionId: 's1' },
    };

    await expect(
      renderMutationResponse(addToCart, {
        ...baseRequest,
        rawInput: { quantity: 1 },
      }),
    ).resolves.toMatchObject({ status: 422 });
    await expect(
      renderMutationResponse(addToCart, {
        ...baseRequest,
        rawInput: { productId: 'p1' },
      }),
    ).resolves.toMatchObject({ status: 200 });

    expect(writes).toBe(1);
  });

  it('does not replay enhanced mutation responses before validating CSRF', async () => {
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
          body: '<fw-query name="cart">{"count":999}</fw-query>',
          headers: {},
          status: 200,
        };
      },
      reserve() {
        throw new Error('replay reserve should not run before CSRF validation');
      },
      set() {},
    };
    const addToCart = mutation('cart/add', {
      csrf,
      input: s.object({ productId: s.string() }),
      handler(input) {
        writes += 1;
        return input;
      },
    });

    const response = await renderMutationResponse(addToCart, {
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

  it('scopes enhanced mutation replay records by CSRF session id', async () => {
    const replayStore = createMemoryMutationReplayStore();
    const csrf = {
      field: 'csrf',
      secret: 'test-secret',
      sessionId(candidate: { session: { id: string } }) {
        return candidate.session.id;
      },
    };
    let writes = 0;
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: (_input, context: { request: { session: { id: string } } }) => ({
        count: writes,
        session: context.request.session.id,
      }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      csrf,
      input: s.object({ csrf: s.string(), productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        writes += 1;
        return input;
      },
    });
    const requestA = { session: { id: 's1' } };
    const requestB = { session: { id: 's2' } };

    const first = await renderMutationResponse(addToCart, {
      idem: 'idem_shared',
      rawInput: { csrf: csrfToken(requestA, csrf), productId: 'p1' },
      replayStore,
      request: requestA,
    });
    const second = await renderMutationResponse(addToCart, {
      idem: 'idem_shared',
      rawInput: { csrf: csrfToken(requestB, csrf), productId: 'p1' },
      replayStore,
      request: requestB,
    });
    const replayedFirst = await renderMutationResponse(addToCart, {
      idem: 'idem_shared',
      rawInput: { csrf: csrfToken(requestA, csrf), productId: 'p1' },
      replayStore,
      request: requestA,
    });

    expect(writes).toBe(2);
    expect(first.body).toContain('"session":"s1"');
    expect(second.body).toContain('"session":"s2"');
    expect(replayedFirst.body).toBe(first.body);
  });

  it('scopes enhanced mutation replay records by request session id', async () => {
    const replayStore = createMemoryMutationReplayStore();
    let writes = 0;
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: (_input, context: { request: { session: { id: string } } }) => ({
        count: writes,
        session: context.request.session.id,
      }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input) {
        writes += 1;
        return input;
      },
    });
    const requestA = { session: { id: 's1' } };
    const requestB = { session: { id: 's2' } };

    const first = await renderMutationResponse(addToCart, {
      idem: 'idem_shared',
      rawInput: { productId: 'p1' },
      replayStore,
      request: requestA,
    });
    const second = await renderMutationResponse(addToCart, {
      idem: 'idem_shared',
      rawInput: { productId: 'p1' },
      replayStore,
      request: requestB,
    });
    const replayedFirst = await renderMutationResponse(addToCart, {
      idem: 'idem_shared',
      rawInput: { productId: 'p1' },
      replayStore,
      request: requestA,
    });

    expect(writes).toBe(2);
    expect(first.body).toContain('"session":"s1"');
    expect(second.body).toContain('"session":"s2"');
    expect(replayedFirst.body).toBe(first.body);
  });

  it('replays post-commit render failures without re-running the handler', async () => {
    const replayStore = createMemoryMutationReplayStore();
    const cart = domain('cart');
    let writes = 0;
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        touches: [cart],
      },
      handler(input) {
        writes += 1;
        return input;
      },
    });
    const request = {
      fragmentRenderers: [
        {
          render() {
            throw new Error('post-commit render failed');
          },
          target: 'cart-badge',
        },
      ],
      idem: 'idem_render_failure',
      rawInput: { productId: 'p1' },
      replayStore,
      request: { sessionId: 's1' },
      targets: ['cart-badge'],
    };

    const first = await renderMutationResponse(addToCart, request);
    const second = await renderMutationResponse(addToCart, request);

    expect(writes).toBe(1);
    expect(first).toEqual({
      body: '<fw-fragment target="cart-badge"><output role="alert" data-error-code="RENDER_ERROR">Internal Server Error</output></fw-fragment>',
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        'FW-Changes': '[{"domain":"cart"}]',
        'FW-Idem': 'idem_render_failure',
      },
      status: 500,
    });
    expect(second).toEqual(first);
  });
});
