import { beforeEach, describe, expect, it, vi } from 'vitest';

const clock = vi.hoisted(() => ({ nowMs: 1_768_000_000_000 }));

vi.mock('./request-state-intrinsics.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./request-state-intrinsics.js')>();
  return {
    ...original,
    requestStateNow: () => clock.nowMs,
  };
});

import { MUTATION_IDEM_MAX_AGE_MS } from './mutation-idem.js';
import { renderMutationEndpointResponse, renderMutationResponse } from './mutation.js';
import { noJsMutationReplayPolicy } from './mutation/replay-policy.js';
import type { MutationWireRequest, NoJsMutationRequest } from './mutation-wire.js';
import {
  createMemoryMutationReplayStore,
  MutationReplayAbortedError,
  mutationReplayScopedKey,
} from './replay.js';
import { s } from './schema.js';
import { testMutation as mutation } from './test-fixtures.js';

const BASE_NOW_MS = 1_768_000_000_000;

beforeEach(() => {
  clock.nowMs = BASE_NOW_MS;
});

function expiringIdem(expiresAtMs: number, nonceByte: string): string {
  return `v1_${expiresAtMs - MUTATION_IDEM_MAX_AGE_MS}_${nonceByte.repeat(16)}`;
}

function deferred<Value = void>(): {
  promise: Promise<Value>;
  resolve(value: Value | PromiseLike<Value>): void;
} {
  let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const settledResponse = {
  body: 'settled',
  headers: {},
  status: 200,
} as const;

describe('memory mutation replay clock rollback', () => {
  it('reclaims expired committed truth without reopening it or evicting pending truth', () => {
    const store = createMemoryMutationReplayStore({ maxEntries: 1 });
    const expiresAtMs = clock.nowMs + 100;
    const idem = expiringIdem(expiresAtMs, '12');
    const key = mutationReplayScopedKey('scope', idem);

    store.set(key, 'scope', idem, settledResponse, 'fingerprint');
    expect(store.get(key, 'scope', idem, 'fingerprint')).toEqual(settledResponse);

    clock.nowMs = expiresAtMs;
    expect(store.get(key, 'scope', idem, 'fingerprint')).toBeUndefined();

    clock.nowMs = expiresAtMs - 50;
    expect(store.reserve(key, 'scope', idem, 'fingerprint')).toBeUndefined();
    expect(() => store.set(key, 'scope', idem, settledResponse, 'fingerprint')).toThrow(
      /expired before replay settlement/u,
    );

    const pendingExpiresAtMs = expiresAtMs + 200;
    const pendingIdem = expiringIdem(pendingExpiresAtMs, '34');
    const pendingKey = mutationReplayScopedKey('scope', pendingIdem);
    const reservation = store.reserve(pendingKey, 'scope', pendingIdem, 'fingerprint');
    expect(reservation).toBeDefined();

    clock.nowMs = pendingExpiresAtMs;
    expect(() => reservation?.commit(settledResponse)).toThrow(/expired before replay settlement/u);
    expect(store.get(pendingKey, 'scope', pendingIdem, 'fingerprint')).toBeInstanceOf(Promise);

    const distinctIdem = expiringIdem(pendingExpiresAtMs + 100, '56');
    const distinctKey = mutationReplayScopedKey('scope', distinctIdem);
    expect(store.get(distinctKey, 'scope', distinctIdem, 'fingerprint')).toBeUndefined();
    expect(store.reserve(distinctKey, 'scope', distinctIdem, 'fingerprint')).toBeUndefined();
  });
});

describe('mutation replay horizon lifecycle', () => {
  it('rechecks freshness after asynchronous guards even when replay storage is disabled', async () => {
    const expiresAtMs = clock.nowMs + 100;
    const idem = expiringIdem(expiresAtMs, '67');
    let handlerCalls = 0;
    const guardedMutation = mutation('clock/guard', {
      guard: async () => {
        await Promise.resolve();
        clock.nowMs = expiresAtMs;
        return true;
      },
      input: s.object({ value: s.string() }),
      handler(input) {
        handlerCalls += 1;
        return input;
      },
    });

    const response = await renderMutationResponse(guardedMutation, {
      buildToken: 'clock-test-build',
      idem,
      rawInput: { value: 'guarded' },
      request: {},
    });

    expect(response.status).toBe(422);
    expect(response.body).toContain('IDEMPOTENCY_CONFLICT');
    expect(handlerCalls).toBe(0);
  });

  it('rechecks freshness before retrying a reservation after a pending abort', async () => {
    const expiresAtMs = clock.nowMs + 100;
    const idem = expiringIdem(expiresAtMs, '78');
    let reserveCalls = 0;
    const replayStore = {
      get() {
        clock.nowMs = expiresAtMs;
        throw new MutationReplayAbortedError();
      },
      reserve() {
        reserveCalls += 1;
        return undefined;
      },
      set() {},
    };
    const policy = noJsMutationReplayPolicy({
      csrf: false,
      mutationKey: 'clock/retry',
      request: {
        rawInput: { 'Kovo-Idem': idem },
        redirectTo: '/',
        replayStore,
        request: { sessionId: 'clock-session' },
      } as NoJsMutationRequest<{ sessionId: string }, unknown>,
    });

    await expect(policy?.reserve()).resolves.toEqual({ kind: 'conflict' });
    expect(reserveCalls).toBe(1);
  });

  it('rejects a replay-store read that settles after the token expires', async () => {
    const expiresAtMs = clock.nowMs + 100;
    const idem = expiringIdem(expiresAtMs, '7f');
    const readStarted = deferred();
    const readRelease = deferred();
    let handlerCalls = 0;
    const definition = mutation('clock/read', {
      input: s.object({ value: s.string() }),
      handler(input) {
        handlerCalls += 1;
        return input;
      },
    });
    const responsePromise = renderMutationResponse(definition, {
      buildToken: 'clock-test-build',
      idem,
      rawInput: { value: 'read' },
      replayStore: {
        async get() {
          readStarted.resolve();
          await readRelease.promise;
          return settledResponse;
        },
        reserve() {
          throw new Error('reserve must not run');
        },
        set() {},
      },
      request: { sessionId: 'clock-session' },
    });

    await readStarted.promise;
    clock.nowMs = expiresAtMs;
    readRelease.resolve();
    const response = await responsePromise;

    expect(response.status).toBe(422);
    expect(response.body).toContain('IDEMPOTENCY_CONFLICT');
    expect(handlerCalls).toBe(0);
  });

  it('aborts a reservation that arrives after the token expires', async () => {
    const expiresAtMs = clock.nowMs + 100;
    const idem = expiringIdem(expiresAtMs, '8f');
    const reserveStarted = deferred();
    const reserveRelease = deferred();
    let abortCalls = 0;
    let handlerCalls = 0;
    const definition = mutation('clock/late-reserve', {
      input: s.object({ value: s.string() }),
      handler(input) {
        handlerCalls += 1;
        return input;
      },
    });
    const form = new FormData();
    form.set('Kovo-Idem', idem);
    form.set('value', 'reserve');
    const responsePromise = renderMutationEndpointResponse(definition, {
      headers: new Headers(),
      rawInput: form,
      redirectTo: '/',
      replayStore: {
        get() {
          return undefined;
        },
        async reserve() {
          reserveStarted.resolve();
          await reserveRelease.promise;
          return {
            abort() {
              abortCalls += 1;
            },
            commit() {},
          };
        },
        set() {},
      },
      request: { sessionId: 'clock-session' },
    });

    await reserveStarted.promise;
    clock.nowMs = expiresAtMs;
    reserveRelease.resolve();
    const response = await responsePromise;

    expect(response.status).toBe(422);
    expect(response.body).toContain('IDEMPOTENCY_CONFLICT');
    expect(abortCalls).toBe(1);
    expect(handlerCalls).toBe(0);
  });

  it('does not call a custom reservation commit after the token expires', async () => {
    const expiresAtMs = clock.nowMs + 100;
    const idem = expiringIdem(expiresAtMs, '89');
    let commitCalls = 0;
    const replayStore = {
      get() {
        return undefined;
      },
      reserve() {
        return {
          commit() {
            commitCalls += 1;
          },
        };
      },
      set() {},
    };
    const policy = noJsMutationReplayPolicy({
      csrf: false,
      mutationKey: 'clock/settle',
      request: {
        rawInput: { 'Kovo-Idem': idem },
        redirectTo: '/',
        replayStore,
        request: { sessionId: 'clock-session' },
      } as NoJsMutationRequest<{ sessionId: string }, unknown>,
    });
    const result = await policy?.reserve();
    if (result?.kind !== 'reserved') throw new Error('expected a replay reservation');

    clock.nowMs = expiresAtMs;
    expect(() => result.reservation.commit(settledResponse)).toThrow(
      /expired before replay settlement/u,
    );
    expect(commitCalls).toBe(0);
  });

  it('keeps a handler-crossed expiry claim pending and sheds distinct work', async () => {
    const expiresAtMs = clock.nowMs + 100;
    const idem = expiringIdem(expiresAtMs, '9a');
    const replayStore = createMemoryMutationReplayStore({ maxEntries: 1 });
    let handlerCalls = 0;
    const crossingMutation = mutation('clock/handler', {
      input: s.object({ value: s.string() }),
      handler(input) {
        handlerCalls += 1;
        clock.nowMs = expiresAtMs;
        return input;
      },
    });
    const request = {
      buildToken: 'clock-test-build',
      idem,
      rawInput: { value: 'crossing' },
      replayStore,
      request: { sessionId: 'clock-session' },
    } satisfies MutationWireRequest<{ sessionId: string }>;

    await expect(renderMutationResponse(crossingMutation, request)).rejects.toThrow(
      /expired before replay settlement/u,
    );
    expect(handlerCalls).toBe(1);

    const expiredRetry = await renderMutationResponse(crossingMutation, request);
    expect(expiredRetry.status).toBe(422);
    expect(handlerCalls).toBe(1);

    const freshIdem = expiringIdem(expiresAtMs + MUTATION_IDEM_MAX_AGE_MS, 'ab');
    const distinctRetry = await renderMutationResponse(crossingMutation, {
      ...request,
      idem: freshIdem,
    });
    expect(distinctRetry.status).toBe(429);
    expect(handlerCalls).toBe(1);
  });
});
