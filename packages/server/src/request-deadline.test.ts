import { describe, expect, it, vi } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { endpoint, type EndpointResponsePosture } from './endpoint.js';

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
      [{ deadlineMs: false }, 'requestLimits.deadlineMs }) must be an integer between 1 and 300000'],
      [{ deadlineMs: 300_001 }, 'requestLimits.deadlineMs }) must be an integer between 1 and 300000'],
      [{ maxInFlight: false }, 'requestLimits.maxInFlight }) must be an integer between 1 and 10000'],
      [{ maxInFlight: 10_001 }, 'requestLimits.maxInFlight }) must be an integer between 1 and 10000'],
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
    const handlerCalls = vi.fn(async (_request: Request, context: { actAs(id: string): unknown }) => {
      await context.actAs('deadline-test-principal');
      return noStoreResponse('must-not-run');
    });
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
    expect(handlerCalls).not.toHaveBeenCalled();
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
});
