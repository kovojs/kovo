import { describe, expect, it, vi } from 'vitest';

import { csrfToken } from './csrf.js';
import { domain } from './domain.js';
import { renderMutationResponse as renderMutationResponseBase } from './mutation.js';
import { query } from './query.js';
import {
  canonicalRequestFingerprint,
  createMemoryMutationReplayStore,
  mutationReplayContext,
  MutationReplayAbortedError,
  type MutationReplayResponse,
  type MutationReplayStore,
} from './replay.js';
import { s } from './schema.js';
import { testMutation as mutation } from './test-fixtures.js';

const replayTestBuildToken = 'replay-test-build';

function withReplayTestBuildToken<T extends { buildToken?: string }>(
  request: T,
): T & { buildToken: string } {
  return { buildToken: replayTestBuildToken, ...request };
}

function renderMutationResponse(
  ...[definition, request]: Parameters<typeof renderMutationResponseBase>
): ReturnType<typeof renderMutationResponseBase> {
  return renderMutationResponseBase(definition, withReplayTestBuildToken(request)) as ReturnType<
    typeof renderMutationResponseBase
  >;
}

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
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Build': 'replay-test-build',
        'Kovo-Changes': '[{"domain":"cart"}]',
        'Kovo-Idem': 'idem_01',
        Vary: 'Cookie',
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

  it('returns a conflict when the same Kovo-Idem is reused with a different body', async () => {
    const cart = domain('cart');
    const replayStore = createMemoryMutationReplayStore();
    let writes = 0;
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: { touches: [cart] },
      handler(input) {
        writes += 1;
        return input;
      },
    });
    const baseRequest = {
      idem: 'idem_reused_body',
      replayStore,
      request: { sessionId: 's1' },
    };

    const first = await renderMutationResponse(addToCart, {
      ...baseRequest,
      rawInput: { productId: 'p1' },
    });
    const second = await renderMutationResponse(addToCart, {
      ...baseRequest,
      rawInput: { productId: 'p2' },
    });

    expect(writes).toBe(1);
    expect(first.status).toBe(200);
    expect(second).toEqual({
      body: '<kovo-fragment target="error"><output role="alert" data-error-code="IDEMPOTENCY_CONFLICT">Conflict</output></kovo-fragment>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Build': 'replay-test-build',
        'Kovo-Idem': 'idem_reused_body',
        Vary: 'Cookie',
      },
      status: 409,
    });
  });

  // L3 (SPEC §9.1): the replay fingerprint must be body-sensitive for FormData/multipart
  // submissions. Before the fix, canonicalJson(formData) === "{}" for EVERY multipart body,
  // so two DIFFERENT FormData bodies under one Kovo-Idem silently replayed the first response
  // instead of raising MutationReplayConflictError. The enhanced JS client always submits
  // FormData, so this defeated the conflict defense in the common case.
  it('returns a conflict when the same Kovo-Idem is reused with a different FormData body', async () => {
    const cart = domain('cart');
    const replayStore = createMemoryMutationReplayStore();
    let writes = 0;
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: { touches: [cart] },
      handler(input) {
        writes += 1;
        return input;
      },
    });
    const baseRequest = {
      idem: 'idem_formdata_body',
      replayStore,
      request: { sessionId: 's1' },
    };
    const firstBody = new FormData();
    firstBody.set('productId', 'p1');
    const secondBody = new FormData();
    secondBody.set('productId', 'p2');

    const first = await renderMutationResponse(addToCart, { ...baseRequest, rawInput: firstBody });
    const second = await renderMutationResponse(addToCart, {
      ...baseRequest,
      rawInput: secondBody,
    });

    // The handler ran exactly once; the divergent second multipart body is a 409 conflict,
    // NOT a silent replay of the first response.
    expect(writes).toBe(1);
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body).toContain('IDEMPOTENCY_CONFLICT');
  });

  // L3: identical FormData bodies under one idem must still REPLAY (match), proving the
  // fingerprint is body-sensitive rather than indiscriminately distinct.
  it('replays identical FormData bodies under one Kovo-Idem without re-running the handler', async () => {
    const cart = domain('cart');
    const replayStore = createMemoryMutationReplayStore();
    let writes = 0;
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: { touches: [cart] },
      handler(input) {
        writes += 1;
        return input;
      },
    });
    const baseRequest = {
      idem: 'idem_formdata_replay',
      replayStore,
      request: { sessionId: 's1' },
    };
    const makeBody = () => {
      const body = new FormData();
      body.set('productId', 'p1');
      return body;
    };

    const first = await renderMutationResponse(addToCart, { ...baseRequest, rawInput: makeBody() });
    const second = await renderMutationResponse(addToCart, {
      ...baseRequest,
      rawInput: makeBody(),
    });

    expect(writes).toBe(1);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toBe(first.body);
  });

  it('neutralizes rotating CSRF tokens before comparing precomputed replay fingerprints (L5)', () => {
    const replayStore = createMemoryMutationReplayStore();
    const csrf = {
      secret: 'replay-csrf-secret-0123456789-abcdef',
      sessionId: (request: { sessionId?: string }) => request.sessionId,
    };
    const request = { sessionId: 's1' };
    const bodyFor = () => ({
      'kovo-csrf': csrfToken(request, csrf, { audience: 'cart/add' }),
      productId: 'p1',
    });
    const firstBody = bodyFor();
    const secondBody = bodyFor();

    const first = mutationReplayContext(csrf, {
      idem: 'idem_rotating_csrf',
      mutationKey: 'cart/add',
      rawInput: firstBody,
      replayStore,
      request,
      requestFingerprint: canonicalRequestFingerprint(firstBody),
    });
    const second = mutationReplayContext(csrf, {
      idem: 'idem_rotating_csrf',
      mutationKey: 'cart/add',
      rawInput: secondBody,
      replayStore,
      request,
      requestFingerprint: canonicalRequestFingerprint(secondBody),
    });

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.fingerprint).not.toBe(canonicalRequestFingerprint(firstBody));
    expect(second.fingerprint).not.toBe(canonicalRequestFingerprint(secondBody));
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
          'Cache-Control': 'private, no-store',
          'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
          'Kovo-Build': 'replay-test-build',
          'Kovo-Changes': '[{"domain":"cart"}]',
          'Kovo-Idem': 'idem_pending_query',
          Vary: 'Cookie',
        },
        status: 200,
      },
      {
        body: '<kovo-query name="cart">{"count":1}</kovo-query>',
        headers: {
          'Cache-Control': 'private, no-store',
          'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
          'Kovo-Build': 'replay-test-build',
          'Kovo-Changes': '[{"domain":"cart"}]',
          'Kovo-Idem': 'idem_pending_query',
          Vary: 'Cookie',
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
          'Cache-Control': 'private, no-store',
          'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
          'Kovo-Build': 'replay-test-build',
          'Kovo-Changes': '[{"domain":"cart"}]',
          'Kovo-Idem': 'idem_pending_fragment',
          Vary: 'Cookie',
        },
        status: 200,
      },
      {
        body: '<kovo-fragment target="cart-badge"><cart-badge>1</cart-badge></kovo-fragment>',
        headers: {
          'Cache-Control': 'private, no-store',
          'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
          'Kovo-Build': 'replay-test-build',
          'Kovo-Changes': '[{"domain":"cart"}]',
          'Kovo-Idem': 'idem_pending_fragment',
          Vary: 'Cookie',
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
          'Cache-Control': 'private, no-store',
          'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
          'Kovo-Build': 'replay-test-build',
          'Kovo-Idem': 'idem_pending_failure',
          Vary: 'Cookie',
        },
        status: 422,
      },
      {
        body: '<kovo-fragment target="error"><output role="alert">Sold out</output></kovo-fragment>',
        headers: {
          'Cache-Control': 'private, no-store',
          'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
          'Kovo-Build': 'replay-test-build',
          'Kovo-Idem': 'idem_pending_failure',
          Vary: 'Cookie',
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
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Build': 'replay-test-build',
        'Kovo-Idem': 'idem_422',
        Vary: 'Cookie',
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
      secret: 'test-secret-0123456789abcdef012345',
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
      secret: 'test-secret-0123456789abcdef012345',
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
      rawInput: { csrf: csrfToken(requestA, csrf, { audience: 'cart/add' }), productId: 'p1' },
      replayStore,
      request: requestA,
    });
    const second = await renderMutationResponse(addToCart, {
      idem: 'idem_shared',
      rawInput: { csrf: csrfToken(requestB, csrf, { audience: 'cart/add' }), productId: 'p1' },
      replayStore,
      request: requestB,
    });
    const replayedFirst = await renderMutationResponse(addToCart, {
      idem: 'idem_shared',
      rawInput: { csrf: csrfToken(requestA, csrf, { audience: 'cart/add' }), productId: 'p1' },
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
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Build': 'replay-test-build',
        'Kovo-Changes': '[{"domain":"cart"}]',
        'Kovo-Idem': 'idem_render_failure',
        Vary: 'Cookie',
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
    // Guard rejected — SPEC §6.5 enhanced unauthenticated mutation failures must
    // re-enter auth with 401, not replay the stored 200.
    expect(second.status).toBe(401);
    expect(second.headers).toMatchObject({
      'Cache-Control': 'private, no-store',
      'Kovo-Reauth': '/login?next=%2F',
    });
    expect(second.body).toBe('');
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

  // E4 (SPEC §9.1:1073 atomic reservation; §9.5:914 pre-dispatch shed): A6 correctly
  // stopped EVICTING pending slots to avoid the M4 double-execute, but that let in-flight
  // pending reservations bypass `maxEntries` and linger for the full TTL — an authenticated
  // attacker firing many concurrent slow mutations with client-chosen Kovo-Idem values
  // accumulates unbounded pending records. A separate `maxPending` cap REFUSES new pending
  // reservations past the cap so mutation callers can fail closed rather than EVICTING an
  // existing pending slot (which would re-open A6/M4).
  it('E4: enforces maxPending by refusing (not evicting) excess pending reservations', () => {
    const replayStore = createMemoryMutationReplayStore({ maxEntries: 100, maxPending: 2 });

    // First two distinct keys reserve pending slots up to the cap.
    const reservationA = replayStore.reserve('scope', 'idem_a');
    const reservationB = replayStore.reserve('scope', 'idem_b');
    expect(reservationA).toBeDefined();
    expect(reservationB).toBeDefined();

    // A third distinct key exceeds maxPending → refused (undefined), NOT allocated.
    const reservationC = replayStore.reserve('scope', 'idem_c');
    expect(reservationC).toBeUndefined();

    // A6 preserved: the existing pending slots were NOT evicted — they still hold and a
    // re-reserve of an occupied key returns undefined (slot still taken), not a fresh slot.
    expect(replayStore.get('scope', 'idem_a')).toBeDefined();
    expect(replayStore.get('scope', 'idem_b')).toBeDefined();
    expect(replayStore.reserve('scope', 'idem_a')).toBeUndefined();

    // Committing a pending slot frees capacity so a new reservation can be made again.
    reservationA!.commit({ body: 'committed', headers: {}, status: 200 });
    const reservationD = replayStore.reserve('scope', 'idem_d');
    expect(reservationD).toBeDefined();
  });

  it('fails closed instead of running enhanced mutations when maxPending refuses reservation', async () => {
    const replayStore = createMemoryMutationReplayStore({ maxEntries: 100, maxPending: 1 });
    const held = replayStore.reserve('other-scope', 'held-idem');
    expect(held).toBeDefined();
    let writes = 0;
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        writes += 1;
        return input;
      },
    });

    const response = await renderMutationResponse(addToCart, {
      idem: 'new-idem',
      rawInput: { productId: 'p1' },
      replayStore,
      request: { sessionId: 's1' },
      targets: ['cart-form'],
    });

    expect(writes).toBe(0);
    expect(response.status).toBe(429);
    expect(response.headers['Retry-After']).toBe('1');
    expect(response.body).toContain('data-error-code="RATE_LIMITED"');
  });

  // E4: maxPending defaults must NOT regress the A6 maxEntries-pressure scenario (3 pending
  // under maxEntries:2 all coexist). The default pending cap is generous enough that the
  // documented A6 behavior is unchanged when no maxPending is configured.
  it('E4: default maxPending leaves the A6 maxEntries scenario unchanged', () => {
    const replayStore = createMemoryMutationReplayStore({ maxEntries: 2 });
    expect(replayStore.reserve('scope-a', 'idem_a')).toBeDefined();
    expect(replayStore.reserve('scope-b', 'idem_b')).toBeDefined();
    // Third pending under maxEntries:2 must still succeed (no eviction, no premature cap).
    expect(replayStore.reserve('scope-c', 'idem_c')).toBeDefined();
  });

  // K3 (SPEC §9.1): part-2 A6 stopped reserve() from FIFO-evicting in-flight pending
  // reservations, but set()'s own maxEntries eviction still deleted the oldest record —
  // which may be a pending reservation — without settling its promise. A concurrent
  // duplicate that joined via get() (returning that pending promise) then hung forever.
  // set()'s eviction must never silently drop a pending record: it must settle the
  // awaiter (reject with MutationReplayAbortedError) so it falls back to running itself.
  it('K3: set() eviction never strands an awaiter of an evicted pending reservation', async () => {
    const replayStore = createMemoryMutationReplayStore({ maxEntries: 1 });

    // Reserve A (pending). A duplicate request joins it via get() → a pending promise.
    const reservationA = replayStore.reserve('scope', 'idem_a');
    expect(reservationA).toBeDefined();
    const joined = replayStore.get('scope', 'idem_a');
    expect(joined).toBeInstanceOf(Promise);

    // A webhook-fallback set() for a different key fires while at maxEntries:1. Its eviction
    // loop would otherwise delete A's pending record without resolving/rejecting it.
    replayStore.set('scope', 'idem_b', { body: 'b', headers: {}, status: 200 });

    // The joined awaiter MUST settle (not hang). On the fixed store it rejects with
    // MutationReplayAbortedError so the duplicate falls back to running itself.
    let settled = false;
    const settlePromise = Promise.resolve(joined).then(
      (value) => {
        settled = true;
        return { kind: 'resolved' as const, value };
      },
      (error: unknown) => {
        settled = true;
        return { kind: 'rejected' as const, error };
      },
    );

    const outcome = await Promise.race([
      settlePromise,
      new Promise<{ kind: 'timeout' }>((resolve) =>
        setTimeout(() => resolve({ kind: 'timeout' }), 200),
      ),
    ]);

    expect(settled).toBe(true);
    expect(outcome.kind).not.toBe('timeout');
    if (outcome.kind === 'rejected') {
      expect(outcome.error).toBeInstanceOf(MutationReplayAbortedError);
    }
  });
});
