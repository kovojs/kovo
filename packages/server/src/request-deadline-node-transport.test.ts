import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { endpoint, type EndpointResponsePosture } from './endpoint.js';
import { toNodeHandler } from './node.js';

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

async function withProcessErrorCapture(
  run: () => Promise<void>,
): Promise<readonly unknown[]> {
  const processErrors: unknown[] = [];
  const onUncaught = (error: unknown): void => {
    processErrors.push(error);
  };
  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onUncaught);
  try {
    await run();
    // Give any pending 'error' emission a beat to surface.
    await new Promise((resolve) => setTimeout(resolve, 400));
  } finally {
    process.removeListener('uncaughtException', onUncaught);
    process.removeListener('unhandledRejection', onUncaught);
  }
  return processErrors;
}

describe('O6 repro: request deadline over a real Node transport', () => {
  it('a request in flight at the deadline must not raise an unhandled error event', async () => {
    const slow = endpoint('/slow', {
      auth: { justification: 'deadline crash repro machine endpoint', kind: 'none' },
      async handler() {
        // Never resolves before the deadline.
        await new Promise<void>(() => undefined);
        return new Response('never', { headers: { 'Cache-Control': 'no-store' } });
      },
      method: 'GET',
      reason: 'deadline crash repro',
      response: rawTextResponse,
    });
    const handler = createRequestHandler(
      createApp({
        endpoints: [slow],
        requestLimits: { deadlineMs: 300, maxInFlight: 4 } as never,
      }),
    );
    const server = createServer(toNodeHandler(handler));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no address');

    try {
      const processErrors = await withProcessErrorCapture(async () => {
        const response = await fetch(`http://127.0.0.1:${address.port}/slow`);
        // The deadline should produce a failed response, never a dead server.
        expect(response.status).toBe(503);
        await response.text().catch(() => undefined);
      });
      expect(processErrors).toEqual([]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 20_000);

  it('a response mid-stream at the deadline must not raise an unhandled error event', async () => {
    const streaming = endpoint('/stream', {
      auth: { justification: 'deadline crash repro machine endpoint', kind: 'none' },
      handler() {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('first-chunk'));
              // Never closes: the deadline fires while the body is on the wire.
            },
          }),
          { headers: { 'Cache-Control': 'no-store' } },
        );
      },
      method: 'GET',
      reason: 'deadline crash repro',
      response: rawStreamResponse,
    });
    const handler = createRequestHandler(
      createApp({
        endpoints: [streaming],
        requestLimits: { deadlineMs: 300, maxInFlight: 4 } as never,
      }),
    );
    // The Vite dev door serves with compression disabled; match that transport posture.
    const server = createServer(toNodeHandler(handler, { compression: false }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no address');

    try {
      const processErrors = await withProcessErrorCapture(async () => {
        const response = await fetch(`http://127.0.0.1:${address.port}/stream`);
        expect(response.status).toBe(200);
        // Hold the body open past the deadline; the server must tear it down without dying.
        await response.text().catch(() => undefined);
      });
      expect(processErrors).toEqual([]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 20_000);
});
