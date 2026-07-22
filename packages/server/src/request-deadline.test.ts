import { describe, expect, it, vi } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { endpoint, type EndpointResponsePosture } from './endpoint.js';
import { mutation } from './mutation.js';
import {
  bindRequestDeadlineResponseTransport,
  registerRequestDeadlineTransport,
} from './request-deadline.js';
import { s } from './schema.js';

const rawTextResponse = {
  appOwnedSafety: true,
  body: 'text',
  cache: 'no-store',
} satisfies EndpointResponsePosture;

const rawStreamResponse = {
  appOwnedSafety: true,
  body: 'stream',
  cache: 'no-store',
} satisfies EndpointResponsePosture;

const auditedLongLivedResponse = {
  appOwnedSafety: true,
  body: 'text',
  cache: 'no-store',
  longLived: {
    deadlineMs: 120,
    justification: 'bounded machine long-poll used by the deadline regression fixture',
  },
} satisfies EndpointResponsePosture;

function noStoreResponse(body: BodyInit | null, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(body, { ...init, headers });
}

function deferred<Value>(): {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
} {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function waitForCall(mock: { mock: { calls: unknown[][] } }): Promise<void> {
  await vi.waitFor(() => expect(mock.mock.calls.length).toBeGreaterThan(0));
}

describe('mandatory request deadline and occupancy budget (SPEC §9.5)', () => {
  // C13-style red anchor: the finite posture must exist before the runtime door is added.
  it('normalizes finite defaults and rejects disabled or unbounded deadline posture', () => {
    const defaults = createApp({}).requestLimits as Record<string, unknown>;

    expect(defaults.deadlineMs).toBe(30_000);
    expect(defaults.maxInFlight).toBe(256);

    for (const [requestLimits, message] of [
      [
        { deadlineMs: false },
        'requestLimits.deadlineMs }) must be an integer between 1 and 300000',
      ],
      [
        { deadlineMs: 300_001 },
        'requestLimits.deadlineMs }) must be an integer between 1 and 300000',
      ],
      [
        { maxInFlight: false },
        'requestLimits.maxInFlight }) must be an integer between 1 and 10000',
      ],
      [
        { maxInFlight: 10_001 },
        'requestLimits.maxInFlight }) must be an integer between 1 and 10000',
      ],
    ] as const) {
      expect(() => createApp({ requestLimits: requestLimits as never })).toThrow(message);
    }
  });

  // C13-style red anchor for admission order and response-completion release.
  it('sheds over-occupancy before handler work and reacquires after response completion', async () => {
    const firstResult = deferred<Response>();
    const handlerCalls = vi.fn();
    const work = endpoint('/work', {
      auth: { justification: 'deadline test machine endpoint', kind: 'none' },
      handler() {
        handlerCalls();
        return handlerCalls.mock.calls.length === 1
          ? firstResult.promise
          : noStoreResponse('later-ok');
      },
      method: 'GET',
      reason: 'request occupancy regression',
      response: rawTextResponse,
    });
    const handle = createRequestHandler(
      createApp({
        endpoints: [work],
        requestLimits: { deadlineMs: 2_000, maxInFlight: 1 } as never,
      }),
    );

    const first = handle(new Request('https://app.test/work'));
    await waitForCall(handlerCalls);

    const shed = await handle(new Request('https://app.test/work'));
    expect(shed.status).toBe(503);
    expect(shed.headers.get('retry-after')).toBe('1');
    await expect(shed.text()).resolves.toBe('Service Unavailable');
    expect(handlerCalls).toHaveBeenCalledTimes(1);

    firstResult.resolve(noStoreResponse('first-ok'));
    const firstResponse = await first;
    await expect(firstResponse.text()).resolves.toBe('first-ok');

    const admittedAgain = await handle(new Request('https://app.test/work'));
    await expect(admittedAgain.text()).resolves.toBe('later-ok');
    expect(handlerCalls).toHaveBeenCalledTimes(2);
  });

  // C13-style red anchor for centrally derived capability propagation and late-result discard.
  it('aborts the handler capability and discards a result minted after the deadline', async () => {
    let observedSignal: AbortSignal | undefined;
    const handlerCalls = vi.fn();
    const slow = endpoint('/slow', {
      auth: { justification: 'deadline test machine endpoint', kind: 'none' },
      async handler(request) {
        handlerCalls();
        observedSignal = request.signal;
        await new Promise<void>((resolve) =>
          request.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        return noStoreResponse('late-secret-result');
      },
      method: 'GET',
      reason: 'request deadline response discard regression',
      response: rawTextResponse,
    });
    const handle = createRequestHandler(
      createApp({
        endpoints: [slow],
        requestLimits: { deadlineMs: 30, maxInFlight: 1 } as never,
      }),
    );

    const response = await handle(new Request('https://app.test/slow'));

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toBe('Service Unavailable');
    expect(handlerCalls).toHaveBeenCalledTimes(1);
    expect(observedSignal?.aborted).toBe(true);
  });

  // C13-style red anchor: a framework-owned DB wait consumes the same mandatory signal.
  it('propagates the request deadline into the DB provider door', async () => {
    let dbSignal: AbortSignal | undefined;
    const db = vi.fn((request: Request) => {
      dbSignal = request.signal;
      return new Promise<never>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new Error('db wait aborted')), {
          once: true,
        });
      });
    });
    let handlerPassedDbWait = false;
    const handlerCalls = vi.fn(
      async (_request: Request, context: { actAs(id: string): unknown }) => {
        await context.actAs('deadline-test-principal');
        handlerPassedDbWait = true;
        return noStoreResponse('must-not-run');
      },
    );
    const dbEndpoint = endpoint('/db-wait', {
      auth: { justification: 'deadline DB test endpoint', kind: 'none' },
      db: true,
      handler: handlerCalls,
      method: 'GET',
      reason: 'request deadline DB propagation regression',
      response: rawTextResponse,
    });
    const handle = createRequestHandler(
      createApp({
        db,
        endpoints: [dbEndpoint],
        requestLimits: { deadlineMs: 30, maxInFlight: 1 } as never,
      }),
    );

    const response = await handle(new Request('https://app.test/db-wait'));

    expect(response.status).toBe(503);
    expect(db).toHaveBeenCalledTimes(1);
    expect(dbSignal?.aborted).toBe(true);
    expect(handlerCalls).toHaveBeenCalledTimes(1);
    expect(handlerPassedDbWait).toBe(false);
  });

  // C13-style red anchor for disconnect release before the finite deadline elapses.
  it('releases occupancy when the ingress signal disconnects', async () => {
    const disconnect = new AbortController();
    const handlerCalls = vi.fn();
    const hanging = endpoint('/disconnect', {
      auth: { justification: 'deadline disconnect test endpoint', kind: 'none' },
      async handler(request) {
        handlerCalls();
        if (handlerCalls.mock.calls.length > 1) return noStoreResponse('reacquired');
        await new Promise<void>((resolve) =>
          request.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        return noStoreResponse('late-after-disconnect');
      },
      method: 'GET',
      reason: 'request disconnect occupancy regression',
      response: rawTextResponse,
    });
    const handle = createRequestHandler(
      createApp({
        endpoints: [hanging],
        requestLimits: { deadlineMs: 2_000, maxInFlight: 1 } as never,
      }),
    );

    const first = handle(new Request('https://app.test/disconnect', { signal: disconnect.signal }));
    await waitForCall(handlerCalls);
    disconnect.abort();
    const disconnectedResponse = await first;
    expect(disconnectedResponse.status).toBe(503);

    const next = await handle(new Request('https://app.test/disconnect'));
    await expect(next.text()).resolves.toBe('reacquired');
  });

  // C13-style red anchor for bounded response write-out and streaming-slot release.
  it('errors a response stream at the deadline and frees its occupancy slot', async () => {
    const handlerCalls = vi.fn();
    const streaming = endpoint('/stream', {
      auth: { justification: 'deadline stream test endpoint', kind: 'none' },
      handler() {
        handlerCalls();
        if (handlerCalls.mock.calls.length > 1) return noStoreResponse('reacquired');
        return noStoreResponse(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('first'));
            },
          }),
        );
      },
      method: 'GET',
      reason: 'bounded request response stream regression',
      response: rawStreamResponse,
    });
    const handle = createRequestHandler(
      createApp({
        endpoints: [streaming],
        requestLimits: { deadlineMs: 40, maxInFlight: 1 } as never,
      }),
    );

    const response = await handle(new Request('https://app.test/stream'));
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('first');
    await expect(reader.read()).rejects.toThrow(/deadline/i);

    const next = await handle(new Request('https://app.test/stream'));
    await expect(next.text()).resolves.toBe('reacquired');
  });

  it('binds an adapter-owned response transport to the same deadline capability', async () => {
    const streaming = endpoint('/adapter-stream', {
      auth: { justification: 'deadline transport test endpoint', kind: 'none' },
      handler: () => noStoreResponse(new ReadableStream<Uint8Array>({ pull() {} })),
      method: 'GET',
      reason: 'adapter response transport binding regression',
      response: rawStreamResponse,
    });
    const handle = createRequestHandler(
      createApp({
        endpoints: [streaming],
        requestLimits: { deadlineMs: 30, maxInFlight: 1 },
      }),
    );
    const request = new Request('https://app.test/adapter-stream');
    registerRequestDeadlineTransport(request);
    await handle(request);
    const interrupted = vi.fn();
    const complete = bindRequestDeadlineResponseTransport(request, interrupted);

    await vi.waitFor(() => expect(interrupted).toHaveBeenCalledTimes(1));
    complete();
  });

  it('releases occupancy on handler exception and consumer stream cancellation', async () => {
    let failureCalls = 0;
    const failsOnce = endpoint('/fails-once', {
      auth: { justification: 'deadline test machine endpoint', kind: 'none' },
      handler() {
        failureCalls += 1;
        if (failureCalls === 1) throw new Error('private fixture failure');
        return noStoreResponse('reacquired-after-error');
      },
      method: 'GET',
      reason: 'deadline exception release regression',
      response: rawTextResponse,
    });
    let streamCalls = 0;
    const cancellable = endpoint('/cancel-stream', {
      auth: { justification: 'deadline test machine endpoint', kind: 'none' },
      handler() {
        streamCalls += 1;
        return streamCalls === 1
          ? noStoreResponse(new ReadableStream<Uint8Array>({ pull() {} }))
          : noStoreResponse('reacquired-after-cancel');
      },
      method: 'GET',
      reason: 'deadline consumer cancellation release regression',
      response: rawStreamResponse,
    });
    const onError = vi.fn();
    const handleFailure = createRequestHandler(
      createApp({
        endpoints: [failsOnce],
        onError,
        requestLimits: { deadlineMs: 2_000, maxInFlight: 1 },
      }),
    );
    const failed = await handleFailure(new Request('https://app.test/fails-once'));
    expect(failed.status).toBe(500);
    const afterFailure = await handleFailure(new Request('https://app.test/fails-once'));
    await expect(afterFailure.text()).resolves.toBe('reacquired-after-error');
    expect(onError).toHaveBeenCalledTimes(1);

    const handleStream = createRequestHandler(
      createApp({
        endpoints: [cancellable],
        requestLimits: { deadlineMs: 2_000, maxInFlight: 1 },
      }),
    );
    const stream = await handleStream(new Request('https://app.test/cancel-stream'));
    await stream.body!.cancel('fixture consumer closed');
    const afterCancel = await handleStream(new Request('https://app.test/cancel-stream'));
    await expect(afterCancel.text()).resolves.toBe('reacquired-after-cancel');
  });

  // C13 red anchor: the sole audited extension remains finite and is scoped to one endpoint.
  it('allows only a bounded justified long-lived endpoint to extend its request deadline', async () => {
    const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 60));
    const regular = endpoint('/regular-wait', {
      auth: { justification: 'deadline test machine endpoint', kind: 'none' },
      async handler() {
        await wait();
        return noStoreResponse('regular-late');
      },
      method: 'GET',
      reason: 'default deadline control',
      response: rawTextResponse,
    });
    const longLived = endpoint('/long-poll', {
      auth: { justification: 'deadline test machine endpoint', kind: 'none' },
      async handler() {
        await wait();
        return noStoreResponse('long-poll-ok');
      },
      method: 'GET',
      reason: 'bounded long poll regression',
      response: auditedLongLivedResponse,
    });
    const handle = createRequestHandler(
      createApp({
        endpoints: [regular, longLived],
        requestLimits: { deadlineMs: 30, maxInFlight: 2 },
      }),
    );

    const regularResponse = await handle(new Request('https://app.test/regular-wait'));
    expect(regularResponse.status).toBe(503);

    const longLivedResponse = await handle(new Request('https://app.test/long-poll'));
    expect(longLivedResponse.status).toBe(200);
    await expect(longLivedResponse.text()).resolves.toBe('long-poll-ok');

    for (const longLivedPosture of [
      false,
      { deadlineMs: 300_001, justification: 'bounded fixture justification' },
      { deadlineMs: 120, justification: '' },
    ]) {
      expect(() =>
        endpoint('/invalid-long-poll', {
          auth: { justification: 'deadline test machine endpoint', kind: 'none' },
          handler: () => noStoreResponse('invalid'),
          method: 'GET',
          reason: 'invalid long poll fixture',
          response: { ...rawTextResponse, longLived: longLivedPosture } as never,
        }),
      ).toThrow(/longLived/u);
    }
  });

  // C13 red anchor: deadline expiry inside the transaction callback must take the rollback path.
  it('throws before transaction commit when the handler cooperatively observes expiry', async () => {
    const events: string[] = [];
    const abortReservation = vi.fn();
    const commitReservation = vi.fn();
    const replayStore = {
      get: vi.fn(() => undefined),
      reserve: vi.fn(() => ({ abort: abortReservation, commit: commitReservation })),
      set: vi.fn(),
    };
    const slowMutation = mutation('deadline/transaction', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      machineReplayPrincipal: () => 'deadline-transaction-machine',
      handler: async (_input, request) => {
        events.push('handler');
        await new Promise<void>((resolve) =>
          request.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        return { late: true };
      },
      input: s.object({}),
      async transaction(request, run) {
        events.push('begin');
        try {
          const value = await run(request);
          events.push('commit');
          return value;
        } catch (error) {
          events.push('rollback');
          throw error;
        }
      },
    });
    const app = createApp({
      mutationReplayStore: replayStore,
      mutations: [slowMutation],
      requestLimits: { deadlineMs: 30, maxInFlight: 1 },
    });
    const handle = createRequestHandler(app);

    const response = await handle(
      new Request('https://app.test/_m/deadline/transaction', {
        body: '{}',
        headers: {
          'Content-Type': 'application/json',
          'Kovo-Build': app.clientModules.buildToken(),
          'Kovo-Fragment': 'true',
          'Kovo-Idem': `v1_${Date.now()}_${'a'.repeat(32)}`,
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(503);
    await vi.waitFor(() => expect(events).toEqual(['begin', 'handler', 'rollback']));
    expect(replayStore.reserve).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(abortReservation).toHaveBeenCalledTimes(1));
    expect(commitReservation).not.toHaveBeenCalled();
    expect(events).not.toContain('commit');
  });

  it('discards a post-commit response without aborting already-committed replay truth', async () => {
    const events: string[] = [];
    const abortReservation = vi.fn();
    const commitStarted = vi.fn();
    const commitFinished = vi.fn();
    const replayStore = {
      get: vi.fn(() => undefined),
      reserve: vi.fn(() => ({
        abort: abortReservation,
        async commit() {
          commitStarted();
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
          commitFinished();
        },
      })),
      set: vi.fn(),
    };
    const committedMutation = mutation('deadline/post-commit', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      machineReplayPrincipal: () => 'deadline-post-commit-machine',
      handler: async () => {
        events.push('handler');
        return { committed: true };
      },
      input: s.object({}),
      async transaction(request, run) {
        events.push('begin');
        const value = await run(request);
        events.push('commit');
        return value;
      },
    });
    const app = createApp({
      mutationReplayStore: replayStore,
      mutations: [committedMutation],
      requestLimits: { deadlineMs: 50, maxInFlight: 1 },
    });
    const handle = createRequestHandler(app);

    const response = await handle(
      new Request('https://app.test/_m/deadline/post-commit', {
        body: '{}',
        headers: {
          'Content-Type': 'application/json',
          'Kovo-Build': app.clientModules.buildToken(),
          'Kovo-Fragment': 'true',
          'Kovo-Idem': `v1_${Date.now()}_${'b'.repeat(32)}`,
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(503);
    expect(events).toEqual(['begin', 'handler', 'commit']);
    expect(commitStarted).toHaveBeenCalledTimes(1);
    expect(abortReservation).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(commitFinished).toHaveBeenCalledTimes(1));
    expect(abortReservation).not.toHaveBeenCalled();
  });
});
