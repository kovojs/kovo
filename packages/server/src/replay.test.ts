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
        headers: { 'Kovo-Idem': 'idem_01' },
        status: 200,
      } as const;
      const second = {
        body: 'second',
        headers: { 'Kovo-Idem': 'idem_02' },
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
  it('replays enhanced mutation responses by Kovo-Idem without re-running the handler', async () => {
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
      body: '<kovo-query name="cart">{"count":1}</kovo-query>',
      headers: {
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Changes': '[{"domain":"cart"}]',
        'Kovo-Idem': 'idem_01',
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
      body: '<kovo-query name="cart">{"count":1}</kovo-query>',
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
    // Same session + same Kovo-Idem but a different mutation: must NOT replay the
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
        body: '<kovo-query name="cart">{"count":1}</kovo-query>',
        headers: {
          'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
          'Kovo-Changes': '[{"domain":"cart"}]',
          'Kovo-Idem': 'idem_pending_query',
        },
        status: 200,
      },
      {
        body: '<kovo-query name="cart">{"count":1}</kovo-query>',
        headers: {
          'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
          'Kovo-Changes': '[{"domain":"cart"}]',
          'Kovo-Idem': 'idem_pending_query',
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
        body: '<kovo-fragment target="cart-badge"><cart-badge>1</cart-badge></kovo-fragment>',
        headers: {
          'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
          'Kovo-Changes': '[{"domain":"cart"}]',
          'Kovo-Idem': 'idem_pending_fragment',
        },
        status: 200,
      },
      {
        body: '<kovo-fragment target="cart-badge"><cart-badge>1</cart-badge></kovo-fragment>',
        headers: {
          'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
          'Kovo-Changes': '[{"domain":"cart"}]',
          'Kovo-Idem': 'idem_pending_fragment',
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
        body: '<kovo-fragment target="error"><output role="alert">Sold out</output></kovo-fragment>',
        headers: {
          'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
          'Kovo-Idem': 'idem_pending_failure',
        },
        status: 422,
      },
      {
        body: '<kovo-fragment target="error"><output role="alert">Sold out</output></kovo-fragment>',
        headers: {
          'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
          'Kovo-Idem': 'idem_pending_failure',
        },
        status: 422,
      },
    ]);
    expect(attempts).toBe(1);
    expect(renders).toBe(1);
  });

  it('replays enhanced mutation validation failures by Kovo-Idem', async () => {
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
      body: '<kovo-fragment target="error"><output role="alert" data-error-code="OUT_OF_STOCK">{"availableQuantity":0}</output></kovo-fragment>',
      headers: {
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Idem': 'idem_422',
      },
      status: 422,
    });
    expect(attempts).toBe(1);
  });

  it('does not replay pure schema validation failures by Kovo-Idem', async () => {
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
      body: '<kovo-fragment target="cart-badge"><output role="alert" data-error-code="RENDER_ERROR">Internal Server Error</output></kovo-fragment>',
      headers: {
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Changes': '[{"domain":"cart"}]',
        'Kovo-Idem': 'idem_render_failure',
      },
      status: 500,
    });
    expect(second).toEqual(first);
  });

  // A1 (SPEC §10.3:1061): a replay hit must re-evaluate the session-bound guard chain
  // against the current principal before re-serving the cached response.
  it('A1: re-runs the guard before serving a replay hit, rejecting a now-unauthorized principal', async () => {
    const replayStore = createMemoryMutationReplayStore();
    let handlerCalls = 0;
    const protectedMutation = mutation('cart/add', {
      guard(request: { authed: boolean; sessionId?: string }) {
        return request.authed;
      },
      input: s.object({ productId: s.string() }),
      handler(input) {
        handlerCalls += 1;
        return input;
      },
    });

    // First request: authorized — handler runs, response committed to replay.
    const first = await renderMutationResponse(protectedMutation, {
      idem: 'idem_a1',
      rawInput: { productId: 'p1' },
      replayStore,
      request: { authed: true, sessionId: 's1' },
    });
    expect(first.status).toBe(200);
    expect(handlerCalls).toBe(1);

    // Second request: same idem, now unauthorized — must NOT replay the cached 200.
    const second = await renderMutationResponse(protectedMutation, {
      idem: 'idem_a1',
      rawInput: { productId: 'p1' },
      replayStore,
      request: { authed: false, sessionId: 's1' },
    });
    // Guard rejected — must return 422 UNAUTHORIZED, not the stored 200.
    expect(second.status).toBe(422);
    expect(second.body).toContain('UNAUTHORIZED');
    // Handler must not have run a second time.
    expect(handlerCalls).toBe(1);
  });

  // A5 (SPEC §9.1.1:904): a transient 429 (RATE_LIMITED from the handler) must abort the
  // reservation, not be committed to replay, so a post-window retry re-runs the handler.
  it('A5: aborts the reservation on 429 so a post-window retry re-runs the handler', async () => {
    const replayStore = createMemoryMutationReplayStore();
    let rateLimited = true;
    let handlerCalls = 0;
    const rateLimitedMutation = mutation('cart/add', {
      errors: { RATE_LIMITED: s.object({}) },
      input: s.object({ productId: s.string() }),
      handler(input, _request, _context) {
        handlerCalls += 1;
        if (rateLimited) {
          // Handler emits a 429 RATE_LIMITED failure (transient shed).
          return {
            error: { code: 'RATE_LIMITED', payload: {} },
            ok: false as const,
            status: 429 as const,
          };
        }
        return input;
      },
    });
    const base = {
      idem: 'idem_a5',
      rawInput: { productId: 'p1' },
      replayStore,
      request: { sessionId: 's5' },
    };

    const first = await renderMutationResponse(rateLimitedMutation, base);
    expect(first.status).toBe(429);
    expect(handlerCalls).toBe(1);

    // Simulate the rate-limit window passing.
    rateLimited = false;

    // Post-window retry with the same idem: must NOT replay the stale 429.
    // The reservation was aborted, so the handler runs again fresh.
    const second = await renderMutationResponse(rateLimitedMutation, base);
    expect(second.status).toBe(200);
    expect(handlerCalls).toBe(2);
  });

  // A6 (SPEC §10.3:1063/1065): reserve() must never FIFO-evict in-flight pending
  // reservations; a second reserve() for the same key must return undefined (already taken).
  it('A6: does not evict in-flight pending reservations under maxEntries pressure', async () => {
    const replayStore = createMemoryMutationReplayStore({ maxEntries: 2 });

    // Reserve A (pending).
    const reservationA = replayStore.reserve('scope-a', 'idem_a');
    expect(reservationA).toBeDefined();

    // Drive 2 more reserves to fill/overflow the store.
    replayStore.reserve('scope-b', 'idem_b');
    replayStore.reserve('scope-c', 'idem_c');

    // A must still be present (not evicted) — get() returns a Promise (the pending record).
    const getA = replayStore.get('scope-a', 'idem_a');
    expect(getA).toBeDefined();

    // A second reserve for A must return undefined (slot still occupied by the pending reservation).
    const secondReserveA = replayStore.reserve('scope-a', 'idem_a');
    expect(secondReserveA).toBeUndefined();
  });
});
