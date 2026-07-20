import { describe, expect, it, vi } from 'vitest';

import { publicAccess } from './access.js';
import { createApp, createRequestHandler } from './app.js';
import { mintFrameworkLoadShedError } from './app-load-shed.js';
import { endpoint } from './endpoint.js';
import { createFrameworkManagedDbProvider } from './guards.js';

const rawTextResponse = {
  appOwnedSafety: true,
  body: 'text',
  cache: 'no-store',
} as const;

describe('Postgres posture app load shedding', () => {
  it('rejects an oversized streamed body before managed database admission', async () => {
    const admit = vi.fn(async () => undefined);
    const provider = createFrameworkManagedDbProvider(async () => ({}), { admit });
    const ingest = endpoint('/ingest', {
      access: publicAccess('streamed admission-order regression fixture'),
      auth: { kind: 'none', justification: 'streamed admission-order regression fixture' },
      csrf: false,
      csrfJustification: 'fixture models a machine upload receiver',
      handler: () =>
        new Response('should not run', {
          headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' },
        }),
      method: 'POST',
      reason: 'prove the remote body gate precedes database posture work',
      response: rawTextResponse,
    });
    const handler = createRequestHandler(
      createApp({ db: provider, endpoints: [ingest], requestLimits: { maxBodyBytes: 4 } }),
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('12345'));
        controller.close();
      },
    });

    const response = await handler(
      new Request('https://app.example/ingest', {
        body,
        duplex: 'half',
        method: 'POST',
      } as RequestInit & { duplex: 'half' }),
    );

    expect(response.status).toBe(413);
    expect(admit).not.toHaveBeenCalled();
  });

  it('maps only a framework-minted posture admission failure to a stable 503 shell', async () => {
    const onError = vi.fn();
    const provider = createFrameworkManagedDbProvider(async () => ({}), {
      admit: async () => {
        throw mintFrameworkLoadShedError({
          code: 'KV433',
          reason: 'Postgres posture lease digest diverged',
          retryAfterMs: 2_500,
        });
      },
    });
    const health = endpoint('/health', {
      db: true,
      handler: async (_request, context) => {
        await context.actAs('health-check');
        return new Response('should not run', { headers: { 'Cache-Control': 'no-store' } });
      },
      method: 'GET',
      reason: 'posture lease admission test',
      response: rawTextResponse,
    });
    const handler = createRequestHandler(createApp({ db: provider, endpoints: [health], onError }));

    const response = await handler(new Request('https://app.example/health'));

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBe('3');
    await expect(response.text()).resolves.toBe('Service Unavailable');
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not let an app-thrown structurally similar error forge the load-shed response', async () => {
    const onError = vi.fn();
    const forged = Object.assign(new Error('Postgres posture lease digest diverged'), {
      code: 'KV433',
      reason: 'Postgres posture lease digest diverged',
      retryAfterMs: 2_500,
    });
    const provider = createFrameworkManagedDbProvider(async () => ({}), {
      admit: async () => {
        throw forged;
      },
    });
    const health = endpoint('/health', {
      db: true,
      handler: async (_request, context) => {
        await context.actAs('health-check');
        return new Response('should not run', { headers: { 'Cache-Control': 'no-store' } });
      },
      method: 'GET',
      reason: 'posture lease forged admission test',
      response: rawTextResponse,
    });
    const handler = createRequestHandler(createApp({ db: provider, endpoints: [health], onError }));

    const response = await handler(new Request('https://app.example/health'));

    expect(response.status).toBe(500);
    expect(onError).toHaveBeenCalledWith(forged, expect.any(Object));
  });
});
