import { describe, expect, it, vi } from 'vitest';

import { untrusted } from '@kovojs/core';

import { csrfToken, mintCsrfField, type CsrfOptions } from './csrf.js';
import { domain } from './domain.js';
import { renderMutationResponse as renderMutationResponseBase } from './mutation.js';
import { query } from './query.js';
import {
  blessRedirectResponse,
  frameworkWireBody,
  isBlessedRedirectResponse,
  redirectLocationHeader,
  serverResponseToWebResponse,
} from './response.js';
import {
  canonicalRequestFingerprint,
  createMemoryMutationReplayStore,
  mutationReplayContext,
  readMutationReplay,
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

function anonymousCsrfRequest(mutationKey: string): {
  csrf: CsrfOptions<Request>;
  request: Request;
  token(): string;
} {
  const csrf: CsrfOptions<Request> = {
    field: 'csrf',
    secret: 'anonymous-replay-csrf-secret-0123456789abcdef',
    sessionId: () => undefined,
  };
  const origin = 'https://replay.test';
  const minted = mintCsrfField(new Request(`${origin}/form`), {
    ...csrf,
    mutation: mutationKey,
  });
  if (!minted.setCookie) throw new Error('anonymous replay fixture did not mint a CSRF cookie');
  const cookie = minted.setCookie.split(';', 1)[0];
  if (!cookie) throw new Error('anonymous replay fixture emitted an empty CSRF cookie');
  const request = new Request(`${origin}/_m/${mutationKey}`, {
    headers: { Cookie: cookie, Origin: origin },
    method: 'POST',
  });
  return {
    csrf,
    request,
    token: () => csrfToken(request, csrf, { mutation: mutationKey }),
  };
}

describe('server mutation replay store', () => {
  it('preserves genuine redirect provenance and multi-value headers through memory replay clones', () => {
    const replayStore = createMemoryMutationReplayStore();
    const source = blessRedirectResponse({
      body: frameworkWireBody(''),
      headers: {
        Location: redirectLocationHeader('/after-save'),
        'Set-Cookie': ['session=one; Path=/; HttpOnly', 'flash=saved; Path=/; HttpOnly'],
      },
      status: 303 as const,
    });

    replayStore.set('session-a', 'idem_redirect', source);
    const replayed = replayStore.get('session-a', 'idem_redirect');

    if (replayed === undefined) throw new Error('memory replay did not retain redirect response');
    expect(replayed).not.toBe(source);
    expect(replayed.headers).not.toBe(source.headers);
    expect(replayed.headers['Set-Cookie']).not.toBe(source.headers['Set-Cookie']);
    expect(replayed.headers['Set-Cookie']).toEqual(source.headers['Set-Cookie']);
    expect(isBlessedRedirectResponse(replayed)).toBe(true);

    const finalized = serverResponseToWebResponse(replayed, { method: 'POST' });
    expect(finalized.headers.get('location')).toBe('/after-save');
    expect((finalized.headers as Headers & { getSetCookie(): string[] }).getSetCookie()).toEqual([
      'session=one; Path=/; HttpOnly',
      'flash=saved; Path=/; HttpOnly',
    ]);
  });

  it('revalidates a genuine redirect source while cloning and leaves durable lookalikes unblessed', () => {
    const replayStore = createMemoryMutationReplayStore();
    const source = blessRedirectResponse({
      body: frameworkWireBody(''),
      headers: { Location: redirectLocationHeader('/safe') },
      status: 303 as const,
    });
    source.headers.Location = 'https://evil.example/phish';

    replayStore.set('session-a', 'idem_mutated_redirect', source);
    const replayed = replayStore.get('session-a', 'idem_mutated_redirect');
    if (replayed === undefined) throw new Error('memory replay did not retain redirect response');
    expect(isBlessedRedirectResponse(replayed)).toBe(true);
    expect(replayed.headers.Location).toBe('/');
    expect(serverResponseToWebResponse(replayed, { method: 'POST' }).headers.get('location')).toBe(
      '/',
    );

    const durableLookalike: MutationReplayResponse = {
      body: frameworkWireBody(''),
      headers: { Location: '/looks-safe-but-has-no-private-witness' },
      status: 303,
    };
    replayStore.set('session-a', 'idem_durable_lookalike', durableLookalike);
    const clonedLookalike = replayStore.get('session-a', 'idem_durable_lookalike');
    if (clonedLookalike === undefined) {
      throw new Error('memory replay did not retain durable-store lookalike');
    }
    expect(isBlessedRedirectResponse(clonedLookalike)).toBe(false);
    expect(
      serverResponseToWebResponse(clonedLookalike, { method: 'POST' }).headers.get('location'),
    ).toBe('/');
  });

  it('rejects accessor-backed durable response authority without invoking getters', async () => {
    let bodyReads = 0;
    const response = {
      headers: {},
      status: 200,
    } as Record<string, unknown>;
    Object.defineProperty(response, 'body', {
      get() {
        bodyReads += 1;
        return frameworkWireBody('forged');
      },
    });
    const replayStore: MutationReplayStore = {
      get: () => response as unknown as MutationReplayResponse,
      reserve: () => undefined,
      set: () => undefined,
    };

    await expect(
      readMutationReplay({
        fingerprint: 'fingerprint',
        idem: 'idem',
        replayStore,
        scope: 'scope',
      }),
    ).rejects.toThrow(/body must be an own data property/u);
    expect(bodyReads).toBe(0);
  });

  it('rejects inherited and invalid durable response fields', () => {
    const replayStore = createMemoryMutationReplayStore();
    const inherited = Object.create({
      body: frameworkWireBody('inherited'),
      headers: {},
      status: 200,
    }) as MutationReplayResponse;
    expect(() => replayStore.set('scope', 'inherited', inherited)).toThrow(/body must be an own/u);
    expect(() =>
      replayStore.set('scope', 'invalid-status', {
        body: frameworkWireBody('invalid'),
        headers: {},
        status: 201 as MutationReplayResponse['status'],
      }),
    ).toThrow(/status is not allowed/u);
  });

  it('bounds memory mutation replay records by ttl and entry count', async () => {
    const replayStore = createMemoryMutationReplayStore({ maxEntries: 1, ttlMs: 5 });
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

    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(replayStore.get('session-a', 'idem_02')).toBeUndefined();
  });

  it('M7: pending reservations outlive ttl and committed ttl starts at commit', async () => {
    const replayStore = createMemoryMutationReplayStore({
      maxEntries: 1,
      maxPending: 1,
      ttlMs: 10,
    });
    const reservation = replayStore.reserve('scope', 'idem', 'fingerprint');
    expect(reservation).toBeDefined();
    const joined = replayStore.get('scope', 'idem', 'fingerprint');
    expect(joined).toBeInstanceOf(Promise);

    await new Promise((resolve) => setTimeout(resolve, 15));
    // The in-flight generation neither expires nor frees maxPending capacity.
    expect(replayStore.reserve('scope', 'idem', 'fingerprint')).toBeUndefined();
    expect(replayStore.reserve('scope', 'other', 'fingerprint')).toBeUndefined();

    const response = { body: 'settled', headers: {}, status: 200 } as const;
    reservation!.commit(response);
    await expect(joined).resolves.toEqual(response);
    expect(replayStore.get('scope', 'idem', 'fingerprint')).toEqual(response);

    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(replayStore.get('scope', 'idem', 'fingerprint')).toBeUndefined();
  });

  it('M7: a superseded reservation commit is generation-fenced from newer truth', async () => {
    const replayStore = createMemoryMutationReplayStore({ ttlMs: 10 });
    const stale = replayStore.reserve('scope', 'idem', 'fingerprint');
    expect(stale).toBeDefined();
    const joined = replayStore.get('scope', 'idem', 'fingerprint');

    const newer = { body: 'newer', headers: {}, status: 200 } as const;
    replayStore.set('scope', 'idem', newer, 'fingerprint');
    await expect(joined).resolves.toEqual(newer);

    stale!.commit({ body: 'stale', headers: {}, status: 200 });
    expect(replayStore.get('scope', 'idem', 'fingerprint')).toEqual(newer);
  });

  it('M7: an aborted old generation cannot overwrite a replacement reservation', () => {
    const replayStore = createMemoryMutationReplayStore();
    const old = replayStore.reserve('scope', 'idem', 'fingerprint');
    expect(old).toBeDefined();
    old!.abort?.();

    const replacement = replayStore.reserve('scope', 'idem', 'fingerprint');
    expect(replacement).toBeDefined();
    old!.commit({ body: 'old', headers: {}, status: 200 });
    const newer = { body: 'replacement', headers: {}, status: 200 } as const;
    replacement!.commit(newer);

    expect(replayStore.get('scope', 'idem', 'fingerprint')).toEqual(newer);
  });

  it('keeps committed replay truth under selective Map.get poisoning', () => {
    const replayStore = createMemoryMutationReplayStore({ ttlMs: 60_000 });
    const response = { body: 'committed', headers: {}, status: 200 } as const;
    replayStore.set('scope', 'idem', response, 'fingerprint');

    const originalMapGet = Map.prototype.get;
    let duplicateReservation: ReturnType<typeof replayStore.reserve> = undefined;
    let replayed: ReturnType<typeof replayStore.get> = undefined;
    try {
      Map.prototype.get = function (key: unknown) {
        if (typeof key === 'string' && key.includes('scope') && key.includes('idem')) {
          return undefined;
        }
        return originalMapGet.call(this, key);
      };
      duplicateReservation = replayStore.reserve('scope', 'idem', 'fingerprint');
      replayed = replayStore.get('scope', 'idem', 'fingerprint');
    } finally {
      Map.prototype.get = originalMapGet;
    }

    expect(duplicateReservation).toBeUndefined();
    expect(replayed).toEqual(response);
  });

  it('does not let a late Date.now advance expire committed replay truth', () => {
    const replayStore = createMemoryMutationReplayStore({ ttlMs: 60_000 });
    const response = { body: 'committed', headers: {}, status: 200 } as const;
    replayStore.set('scope', 'idem', response, 'fingerprint');

    const originalDateNow = Date.now;
    let replayed: ReturnType<typeof replayStore.get> = undefined;
    let duplicateReservation: ReturnType<typeof replayStore.reserve> = undefined;
    try {
      Date.now = () => originalDateNow() + 365 * 24 * 60 * 60_000;
      replayed = replayStore.get('scope', 'idem', 'fingerprint');
      duplicateReservation = replayStore.reserve('scope', 'idem', 'fingerprint');
    } finally {
      Date.now = originalDateNow;
    }

    expect(replayed).toEqual(response);
    expect(duplicateReservation).toBeUndefined();
  });

  it('length-frames replay scope and idempotency keys without NUL collisions', () => {
    const replayStore = createMemoryMutationReplayStore();
    const first = { body: 'first', headers: {}, status: 200 } as const;
    const second = { body: 'second', headers: {}, status: 200 } as const;

    replayStore.set('scope\0idem', 'tail', first);
    replayStore.set('scope', 'idem\0tail', second);

    expect(replayStore.get('scope\0idem', 'tail')).toEqual(first);
    expect(replayStore.get('scope', 'idem\0tail')).toEqual(second);
  });

  it('rejects unsafe replay capacities and ttl values', () => {
    expect(() => createMemoryMutationReplayStore({ maxEntries: Number.NaN })).toThrow(
      /maxEntries.*non-negative integer/u,
    );
    expect(() => createMemoryMutationReplayStore({ maxPending: -1 })).toThrow(
      /maxPending.*non-negative integer/u,
    );
    expect(() => createMemoryMutationReplayStore({ ttlMs: 1.5 })).toThrow(
      /ttlMs.*non-negative integer/u,
    );
  });

  it('ignores inherited replay-store limits and refuses accessors without invoking them', () => {
    const inherited = Object.create({ maxEntries: 0, maxPending: 0, ttlMs: 0 });
    const inheritedStore = createMemoryMutationReplayStore(inherited);
    expect(inheritedStore.reserve('scope', 'idem')).toBeDefined();

    let getterCalls = 0;
    const accessor = {} as { maxPending?: number };
    Object.defineProperty(accessor, 'maxPending', {
      configurable: true,
      get() {
        getterCalls += 1;
        return 0;
      },
    });
    expect(() => createMemoryMutationReplayStore(accessor)).toThrow('own data');
    expect(getterCalls).toBe(0);
  });

  it('does not treat a missing stored fingerprint as a wildcard for byte-sensitive requests', () => {
    const replayStore = createMemoryMutationReplayStore();
    const response = { body: 'legacy', headers: {}, status: 200 } as const;
    replayStore.set('scope', 'settled', response);
    const pending = replayStore.reserve('scope', 'pending');

    expect(() => replayStore.get('scope', 'settled', 'sha256:request')).toThrow(
      /different request fingerprint/u,
    );
    expect(() => replayStore.get('scope', 'pending', 'sha256:request')).toThrow(
      /different request fingerprint/u,
    );
    expect(() => replayStore.reserve('scope', 'settled', 'sha256:request')).toThrow(
      /different request fingerprint/u,
    );
    pending?.abort?.();
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
      body: '<kovo-query name="cart" settles="idem_01">{"count":1}</kovo-query>',
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
      body: '<kovo-query name="cart" settles="idem_concurrent_handler">{"count":1}</kovo-query>',
      status: 200,
    });
  });

  it('M4: real anonymous-CSRF enhanced duplicates join and replay across rotating tokens', async () => {
    const replayStore = createMemoryMutationReplayStore();
    const anonymous = anonymousCsrfRequest('auth/sign-up');
    const handlerStarted = deferred();
    const handlerRelease = deferred();
    let writes = 0;
    const signUp = mutation('auth/sign-up', {
      csrf: anonymous.csrf,
      input: s.object({ email: s.string() }),
      async handler(input) {
        handlerStarted.resolve();
        await handlerRelease.promise;
        writes += 1;
        return input;
      },
    });
    const submit = () =>
      renderMutationResponse(signUp, {
        idem: 'idem_anonymous_signup',
        rawInput: { csrf: anonymous.token(), email: 'person@example.test' },
        replayStore,
        request: anonymous.request,
      });

    const first = submit();
    await handlerStarted.promise;
    const concurrent = submit();
    await Promise.resolve();
    handlerRelease.resolve();

    const [firstResponse, concurrentResponse] = await Promise.all([first, concurrent]);
    const sequentialResponse = await submit();
    expect(writes).toBe(1);
    expect(concurrentResponse).toEqual(firstResponse);
    expect(sequentialResponse).toEqual(firstResponse);
  });

  it('M4: anonymous replay scope follows the CSRF cookie and keeps mutation keys separate', async () => {
    const replayStore = createMemoryMutationReplayStore();
    const firstAnonymous = anonymousCsrfRequest('cart/add');
    const secondAnonymous = anonymousCsrfRequest('cart/add');
    let addWrites = 0;
    let removeWrites = 0;
    const add = mutation('cart/add', {
      csrf: firstAnonymous.csrf,
      input: s.object({ productId: s.string() }),
      handler(input) {
        addWrites += 1;
        return input;
      },
    });
    const remove = mutation('cart/remove', {
      csrf: firstAnonymous.csrf,
      input: s.object({ productId: s.string() }),
      handler(input) {
        removeWrites += 1;
        return input;
      },
    });
    const addSubmit = (anonymous: ReturnType<typeof anonymousCsrfRequest>) =>
      renderMutationResponse(add, {
        idem: 'idem_shared_anonymous',
        rawInput: { csrf: anonymous.token(), productId: 'p1' },
        replayStore,
        request: anonymous.request,
      });

    await addSubmit(firstAnonymous);
    await addSubmit(secondAnonymous);
    await renderMutationResponse(remove, {
      idem: 'idem_shared_anonymous',
      rawInput: {
        csrf: csrfToken(firstAnonymous.request, firstAnonymous.csrf, {
          mutation: 'cart/remove',
        }),
        productId: 'p1',
      },
      replayStore,
      request: firstAnonymous.request,
    });
    await addSubmit(firstAnonymous);

    // A caller-controlled form token cannot merge two cookie principals; a sibling mutation
    // cannot consume the first mutation's response under the same cookie+idem either.
    expect(addWrites).toBe(2);
    expect(removeWrites).toBe(1);
  });

  it('M4: anonymous replay preserves request-fingerprint conflicts', async () => {
    const replayStore = createMemoryMutationReplayStore();
    const anonymous = anonymousCsrfRequest('cart/add');
    let writes = 0;
    const add = mutation('cart/add', {
      csrf: anonymous.csrf,
      input: s.object({ productId: s.string() }),
      handler(input) {
        writes += 1;
        return input;
      },
    });
    const submit = (productId: string) =>
      renderMutationResponse(add, {
        idem: 'idem_anonymous_conflict',
        rawInput: { csrf: anonymous.token(), productId },
        replayStore,
        request: anonymous.request,
      });

    await expect(submit('p1')).resolves.toMatchObject({ status: 200 });
    const conflict = await submit('p2');
    expect(conflict.status).toBe(422);
    expect(conflict.body).toContain('IDEMPOTENCY_CONFLICT');
    expect(writes).toBe(1);
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
      status: 422,
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

    // The handler ran exactly once; the divergent second multipart body is a 422 conflict,
    // NOT a silent replay of the first response.
    expect(writes).toBe(1);
    expect(first.status).toBe(200);
    expect(second.status).toBe(422);
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

  it('hashes upload bytes so same-metadata files conflict while true duplicates replay (M8)', async () => {
    const replayStore = createMemoryMutationReplayStore();
    let writes = 0;
    const observedBytes: string[] = [];
    const upload = mutation('files/upload', {
      input: s.object({ upload: s.file() }),
      async handler(input) {
        writes += 1;
        observedBytes.push(new TextDecoder().decode(await input.upload.arrayBuffer()));
        return { accepted: input.upload.name };
      },
    });
    const request = {
      idem: 'idem_upload_bytes',
      replayStore,
      request: { sessionId: 's1' },
    };
    const body = (bytes: string) => {
      const form = new FormData();
      form.append(
        'upload',
        new File([bytes], 'same-name.txt', {
          type: 'text/plain',
        }),
      );
      return form;
    };

    const first = await renderMutationResponse(upload, { ...request, rawInput: body('AAAA') });
    const duplicate = await renderMutationResponse(upload, {
      ...request,
      rawInput: body('AAAA'),
    });
    const divergent = await renderMutationResponse(upload, {
      ...request,
      rawInput: body('BBBB'),
    });

    expect(first.status).toBe(200);
    expect(duplicate).toEqual(first);
    expect(divergent.status).toBe(422);
    expect(divergent.body).toContain('IDEMPOTENCY_CONFLICT');
    expect(writes).toBe(1);
    // Fingerprinting reads Blob/File bytes non-destructively; the handler still receives them.
    expect(observedBytes).toEqual(['AAAA']);
  });

  it('includes FormData field multiplicity, order, and upload metadata in the fingerprint (M8)', async () => {
    const file = (name: string, type = 'text/plain') => new File(['SAME'], name, { type });
    const form = (entries: readonly (readonly [string, string | File])[]) => {
      const body = new FormData();
      for (const [name, value] of entries) body.append(name, value);
      return body;
    };
    const ordered = form([
      ['tag', 'a'],
      ['upload', file('same.txt')],
      ['tag', 'b'],
    ]);
    const identical = form([
      ['tag', 'a'],
      ['upload', file('same.txt')],
      ['tag', 'b'],
    ]);
    const reordered = form([
      ['tag', 'b'],
      ['upload', file('same.txt')],
      ['tag', 'a'],
    ]);
    const missingDuplicate = form([
      ['tag', 'a'],
      ['upload', file('same.txt')],
    ]);
    const renamed = form([
      ['tag', 'a'],
      ['upload', file('other.txt')],
      ['tag', 'b'],
    ]);
    const differentType = form([
      ['tag', 'a'],
      ['upload', file('same.txt', 'application/octet-stream')],
      ['tag', 'b'],
    ]);

    const fingerprint = await canonicalRequestFingerprint(ordered);
    await expect(canonicalRequestFingerprint(identical)).resolves.toBe(fingerprint);
    await expect(canonicalRequestFingerprint(reordered)).resolves.not.toBe(fingerprint);
    await expect(canonicalRequestFingerprint(missingDuplicate)).resolves.not.toBe(fingerprint);
    await expect(canonicalRequestFingerprint(renamed)).resolves.not.toBe(fingerprint);
    await expect(canonicalRequestFingerprint(differentType)).resolves.not.toBe(fingerprint);
  });

  it('keeps distinct replay inputs collision-free after app code poisons canonicalization controls', async () => {
    const firstItems = ['alpha', 'one'];
    const secondItems = ['alpha', 'two'];
    Object.defineProperty(firstItems, Symbol.iterator, {
      configurable: true,
      value: function* () {
        yield 'forged-same';
      },
    });
    Object.defineProperty(secondItems, Symbol.iterator, {
      configurable: true,
      value: function* () {
        yield 'forged-same';
      },
    });
    const originalJoin = Array.prototype.join;
    const originalSort = Array.prototype.sort;
    const originalObjectKeys = Object.keys;
    const originalJsonStringify = JSON.stringify;
    let firstFingerprint: string;
    let secondFingerprint: string;
    try {
      Array.prototype.join = () => '';
      Array.prototype.sort = function () {
        return this;
      };
      Object.keys = () => [];
      JSON.stringify = () => '"forged-same"';
      firstFingerprint = await canonicalRequestFingerprint({ items: firstItems, quantity: 1 });
      secondFingerprint = await canonicalRequestFingerprint({ items: secondItems, quantity: 2 });
    } finally {
      Array.prototype.join = originalJoin;
      Array.prototype.sort = originalSort;
      Object.keys = originalObjectKeys;
      JSON.stringify = originalJsonStringify;
    }

    expect(firstFingerprint!).not.toBe(secondFingerprint!);
  });

  it('fails closed before handler execution when upload-byte fingerprinting fails (M8)', async () => {
    const replayStore = createMemoryMutationReplayStore();
    let writes = 0;
    const upload = mutation('files/broken-upload', {
      input: s.object({ upload: s.file() }),
      handler() {
        writes += 1;
        return { accepted: true };
      },
    });
    let uploadReads = 0;
    const brokenUpload = {
      async arrayBuffer(): Promise<ArrayBuffer> {
        uploadReads += 1;
        if (uploadReads === 1) return new TextEncoder().encode('DATA').buffer;
        throw new Error('simulated upload read failure');
      },
      name: 'broken.txt',
      size: 4,
      type: 'text/plain',
    };

    await expect(
      renderMutationResponse(upload, {
        idem: 'idem_broken_upload',
        rawInput: { upload: brokenUpload },
        replayStore,
        request: { sessionId: 's1' },
      }),
    ).rejects.toThrow(/Unable to read upload bytes for replay fingerprint/u);
    expect(uploadReads).toBe(2);
    expect(writes).toBe(0);
  });

  it('does not hash upload bytes before CSRF rejects the request (M8)', async () => {
    const replayStore = createMemoryMutationReplayStore();
    let uploadReads = 0;
    let writes = 0;
    const csrf = {
      field: 'csrf',
      secret: 'upload-replay-csrf-secret-0123456789abcdef',
      sessionId: (request: { sessionId: string }) => request.sessionId,
    };
    const upload = mutation('files/csrf-upload', {
      csrf,
      input: s.object({ upload: s.file() }),
      handler() {
        writes += 1;
        return { accepted: true };
      },
    });

    const response = await renderMutationResponse(upload, {
      idem: 'idem_csrf_upload',
      rawInput: {
        csrf: 'invalid',
        upload: {
          async arrayBuffer(): Promise<ArrayBuffer> {
            uploadReads += 1;
            return new TextEncoder().encode('DATA').buffer;
          },
          name: 'data.txt',
          size: 4,
          type: 'text/plain',
        },
      },
      replayStore,
      request: { sessionId: 's1' },
    });

    expect(response.status).toBe(422);
    expect(response.body).toContain('data-error-code="CSRF"');
    expect(uploadReads).toBe(0);
    expect(writes).toBe(0);
  });

  it('uses the captured SHA-256 upload digest after app code replaces global crypto (M8)', async () => {
    const digest = vi.fn(async () => {
      throw new Error('simulated digest failure');
    });
    vi.stubGlobal('crypto', { subtle: { digest } });
    try {
      await expect(
        canonicalRequestFingerprint({
          upload: {
            async arrayBuffer() {
              return new TextEncoder().encode('DATA').buffer;
            },
            name: 'data.txt',
            size: 4,
            type: 'text/plain',
          },
        }),
      ).resolves.toContain('c97c29c7a71b392b437ee03fd17f09bb10b75e879466fc0eb757b2c4a78ac938');
      expect(digest).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps replay fingerprints body-sensitive for untrusted tagged scalar fields', async () => {
    const p1 = await canonicalRequestFingerprint({ productId: untrusted('p1') });
    const p2 = await canonicalRequestFingerprint({ productId: untrusted('p2') });
    const plainP1 = await canonicalRequestFingerprint({ productId: 'p1' });
    expect(p1).not.toBe(p2);
    expect(p1).toBe(plainP1);
  });

  it('neutralizes rotating CSRF tokens before comparing precomputed replay fingerprints (L5)', async () => {
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

    const first = await mutationReplayContext(csrf, {
      idem: 'idem_rotating_csrf',
      mutationKey: 'cart/add',
      rawInput: firstBody,
      replayStore,
      request,
      requestFingerprint: await canonicalRequestFingerprint(firstBody),
    });
    const second = await mutationReplayContext(csrf, {
      idem: 'idem_rotating_csrf',
      mutationKey: 'cart/add',
      rawInput: secondBody,
      replayStore,
      request,
      requestFingerprint: await canonicalRequestFingerprint(secondBody),
    });

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.fingerprint).not.toBe(await canonicalRequestFingerprint(firstBody));
    expect(second.fingerprint).not.toBe(await canonicalRequestFingerprint(secondBody));
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
        body: '<kovo-query name="cart" settles="idem_pending_query">{"count":1}</kovo-query>',
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
        body: '<kovo-query name="cart" settles="idem_pending_query">{"count":1}</kovo-query>',
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
        return request.authed ? true : { kind: 'unauthenticated' as const };
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

  // M7/K3 (SPEC §10.3): capacity applies to settled truth only. set() must never evict an
  // in-flight reservation or force its duplicate to run again; the waiter remains joined until
  // the original owner commits/aborts, while committed state remains maxEntries-bounded.
  it('M7: set() capacity never evicts an in-flight record or strands its waiter', async () => {
    const replayStore = createMemoryMutationReplayStore({ maxEntries: 1 });

    const reservationA = replayStore.reserve('scope', 'idem_a');
    expect(reservationA).toBeDefined();
    const joined = replayStore.get('scope', 'idem_a');
    expect(joined).toBeInstanceOf(Promise);

    replayStore.set('scope', 'idem_b', { body: 'b', headers: {}, status: 200 });
    expect(replayStore.reserve('scope', 'idem_a')).toBeUndefined();

    const settledA = { body: 'a', headers: {}, status: 200 } as const;
    reservationA!.commit(settledA);
    await expect(joined).resolves.toEqual(settledA);
    expect(replayStore.get('scope', 'idem_a')).toEqual(settledA);
    // A committed after B, so FIFO committed capacity retains A and evicts B.
    expect(replayStore.get('scope', 'idem_b')).toBeUndefined();
  });
});
