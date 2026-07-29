import { describe, expect, it, vi } from 'vitest';

import { publicAccess } from './access.js';
import { createApp, createRequestHandler } from './app.js';
import { mintFrameworkLoadShedError } from './app-load-shed.js';
import { KOVO_CSP_REPORT_ENDPOINT } from './csp.js';
import { endpoint } from './endpoint.js';
import { createFrameworkManagedDbProvider } from './guards.js';
import { trustedHtml } from './html.js';
import { route } from './route.js';
import { s } from './schema.js';
import { task } from './task.js';

const rawTextResponse = {
  appOwnedSafety: true,
  body: 'text',
  cache: 'no-store',
} as const;

describe('Postgres posture app load shedding', () => {
  it('rejects an oversized streamed body before managed database admission', async () => {
    const admit = vi.fn(async () => undefined);
    const resolve = vi.fn(async () => ({}));
    const provider = createFrameworkManagedDbProvider(resolve, { admit });
    const background = task('admission-order/background', {
      input: s.object({}),
      run() {},
    });
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
      createApp({
        db: provider,
        endpoints: [ingest],
        requestLimits: { maxBodyBytes: 4 },
        tasks: [background],
      }),
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

    await Promise.resolve();
    expect(admit).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(response.status).toBe(413);
  });

  it('rejects oversized method-mismatch route bodies before managed database admission', async () => {
    const admit = vi.fn(async () => undefined);
    const resolve = vi.fn(async () => ({}));
    const provider = createFrameworkManagedDbProvider(resolve, { admit });
    const handler = createRequestHandler(
      createApp({
        db: provider,
        requestLimits: { maxBodyBytes: 4 },
        routes: [
          route('/document', {
            page: () =>
              trustedHtml('<main>document</main>', {
                reason: 'framework server rendering test fixture',
              }),
          }),
        ],
      }),
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('12345'));
        controller.close();
      },
    });

    const response = await handler(
      new Request('https://app.example/document', {
        body,
        duplex: 'half',
        method: 'POST',
      } as RequestInit & { duplex: 'half' }),
    );

    expect(admit).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(response.status).toBe(413);
  });

  it('keeps the reserved bounded CSP report reader outside app database admission', async () => {
    const admit = vi.fn(async () => undefined);
    const resolve = vi.fn(async () => ({}));
    const provider = createFrameworkManagedDbProvider(resolve, { admit });
    const handler = createRequestHandler(createApp({ db: provider }));

    const response = await handler(
      new Request(`https://app.example${KOVO_CSP_REPORT_ENDPOINT}`, {
        body: JSON.stringify({ type: 'csp-violation' }),
        headers: { 'Content-Type': 'application/reports+json' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(204);
    expect(admit).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
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
