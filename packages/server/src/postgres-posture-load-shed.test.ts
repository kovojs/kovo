import { describe, expect, it, vi } from 'vitest';

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
  it('maps only a framework-minted posture admission failure to a stable 503 shell', async () => {
    const onError = vi.fn();
    const provider = createFrameworkManagedDbProvider(async () => {
      throw mintFrameworkLoadShedError({
        code: 'KV433',
        reason: 'Postgres posture lease digest diverged',
        retryAfterMs: 2_500,
      });
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
    const provider = createFrameworkManagedDbProvider(async () => {
      throw forged;
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
