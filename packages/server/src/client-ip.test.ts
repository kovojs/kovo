import { describe, expect, it, vi } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { appRateLimitKeyCounts, resolveRequestClientIp } from './app-load-shed.js';
import { guards } from './guards.js';
import { mutation } from './mutation.js';
import { query } from './query.js';
import { s } from './schema.js';

describe('trusted client-IP request identity', () => {
  it.each([
    {
      first: { Forwarded: 'for="203.0.113.31:47011"' },
      label: 'Forwarded IPv4 port',
      second: { Forwarded: 'for="203.0.113.31:47012"' },
    },
    {
      first: { Forwarded: 'for="[2001:db8::31]:47011"' },
      label: 'Forwarded IPv6 port',
      second: { Forwarded: 'for="[2001:0DB8:0:0:0:0:0:31]:47012"' },
    },
    {
      first: { 'X-Forwarded-For': '203.0.113.32:47011' },
      label: 'X-Forwarded-For IPv4 port',
      second: { 'X-Forwarded-For': '203.0.113.32:47012' },
    },
    {
      first: { 'X-Forwarded-For': '[2001:db8::32]:47011' },
      label: 'X-Forwarded-For IPv6 port',
      second: { 'X-Forwarded-For': '[2001:0DB8:0:0:0:0:0:32]:47012' },
    },
    {
      first: { 'X-Real-IP': '203.0.113.33:47011' },
      label: 'X-Real-IP IPv4 port',
      second: { 'X-Real-IP': '203.0.113.33:47012' },
    },
    {
      first: { 'X-Real-IP': '[2001:db8::33]:47011' },
      label: 'X-Real-IP IPv6 port',
      second: { 'X-Real-IP': '[2001:0DB8:0:0:0:0:0:33]:47012' },
    },
  ])('keys $label by one canonical address across reconnects', async ({ first, second }) => {
    const run = vi.fn(() => ({ ok: true }));
    const key = 'cart/canonical-proxy';
    const handler = createRequestHandler(
      createApp({
        mutations: [
          mutation(key, {
            csrf: false,
            csrfJustification: 'test fixture uses a non-browser caller',
            handler: run,
            input: s.object({}),
          }),
        ],
        requestLimits: {
          global: { max: 100, windowMs: 60_000 },
          mutations: {
            global: { max: 100, windowMs: 60_000 },
            perIp: { max: 1, windowMs: 60_000 },
          },
          perIp: { max: 100, windowMs: 60_000 },
          queries: {},
          trustedProxy: true,
        },
      }),
    );
    const request = (headers: HeadersInit) =>
      new Request(`https://example.test/_m/${key}`, {
        body: new URLSearchParams(),
        headers,
        method: 'POST',
      });

    expect((await handler(request(first))).status).toBe(303);
    expect((await handler(request(second))).status).toBe(429);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('shares canonical trusted-proxy identity between the shell and per-IP guards', async () => {
    const app = createApp({
      queries: [
        query('canonical-proxy-guard', {
          guard: guards.rateLimit<{ clientIp?: string }>({
            max: 1,
            per: 'ip',
            windowMs: 60_000,
          }),
          load: () => ({ ok: true }),
          reads: [],
        }),
      ],
      requestLimits: {
        global: { max: 100, windowMs: 60_000 },
        mutations: {},
        perIp: { max: 100, windowMs: 60_000 },
        queries: {
          global: { max: 100, windowMs: 60_000 },
          perIp: { max: 100, windowMs: 60_000 },
        },
        trustedProxy: true,
      },
    });
    const handler = createRequestHandler(app);
    const request = (port: number) =>
      new Request('https://example.test/_q/canonical-proxy-guard', {
        headers: { Forwarded: `for="[2001:db8::44]:${port}"` },
      });

    expect((await handler(request(47011))).status).toBe(200);
    expect(appRateLimitKeyCounts(app).perIp).toBe(2);
    expect((await handler(request(47012))).status).toBe(429);
    expect(appRateLimitKeyCounts(app).perIp).toBe(2);
  });

  it('keeps the global request floor when malformed proxy nodes cannot mint a per-IP key', async () => {
    const app = createApp({
      queries: [
        query('malformed-proxy-global-floor', {
          load: () => ({ ok: true }),
          reads: [],
        }),
      ],
      requestLimits: {
        global: { max: 1, windowMs: 60_000 },
        mutations: {},
        perIp: { max: 100, windowMs: 60_000 },
        queries: {
          global: { max: 100, windowMs: 60_000 },
          perIp: { max: 100, windowMs: 60_000 },
        },
        trustedProxy: true,
      },
    });
    const handler = createRequestHandler(app);
    const request = (forwarded: string) =>
      new Request('https://example.test/_q/malformed-proxy-global-floor', {
        headers: { Forwarded: forwarded },
      });

    expect((await handler(request('for=unknown'))).status).toBe(200);
    expect(appRateLimitKeyCounts(app).perIp).toBe(0);
    expect((await handler(request('for=_rotated-obfuscated-node'))).status).toBe(429);
    expect(appRateLimitKeyCounts(app).perIp).toBe(0);
  });

  it.each([
    {
      Forwarded: 'for=203.0.113.70',
      'X-Forwarded-For': '198.51.100.70',
    },
    {
      Forwarded: 'for=203.0.113.71',
      'X-Real-IP': '198.51.100.71',
    },
    {
      'X-Forwarded-For': '203.0.113.72',
      'X-Real-IP': '198.51.100.72',
    },
  ])('rejects conflicting trusted client-IP header families as ambiguous', (headers) => {
    const app = createApp({ requestLimits: { trustedProxy: true } });
    expect(
      resolveRequestClientIp(
        app,
        new Request('https://example.test/conflicting-client-ip-families', { headers }),
      ),
    ).toBeUndefined();
  });

  it('applies the global floor when an attacker header conflicts with the proxy-owned family', async () => {
    const app = createApp({
      queries: [
        query('conflicting-proxy-global-floor', {
          load: () => ({ ok: true }),
          reads: [],
        }),
      ],
      requestLimits: {
        global: { max: 1, windowMs: 60_000 },
        mutations: {},
        perIp: { max: 100, windowMs: 60_000 },
        queries: {
          global: { max: 100, windowMs: 60_000 },
          perIp: { max: 100, windowMs: 60_000 },
        },
        trustedProxy: true,
      },
    });
    const handler = createRequestHandler(app);
    const request = (attackerXff: string) =>
      new Request('https://example.test/_q/conflicting-proxy-global-floor', {
        headers: {
          Forwarded: 'for=203.0.113.80',
          'X-Forwarded-For': attackerXff,
        },
      });

    expect((await handler(request('198.51.100.1'))).status).toBe(200);
    expect(appRateLimitKeyCounts(app).perIp).toBe(0);
    expect((await handler(request('198.51.100.2'))).status).toBe(429);
    expect(appRateLimitKeyCounts(app).perIp).toBe(0);
  });

  it('leaves an explicit clientIp callback in charge of its opaque keys', () => {
    const clientIp = vi.fn((request: Request) => request.headers.get('x-client-key') ?? undefined);
    const app = createApp({
      requestLimits: {
        clientIp,
        trustedProxy: true,
      },
    });
    const request = (clientKey: string) =>
      new Request('https://example.test/custom-client-key-authority', {
        headers: {
          'X-Client-Key': clientKey,
          'X-Forwarded-For': '203.0.113.99:47011',
        },
      });

    expect(resolveRequestClientIp(app, request('tenant:47011'))).toBe('tenant:47011');
    expect(resolveRequestClientIp(app, request('tenant:47012'))).toBe('tenant:47012');
    expect(clientIp).toHaveBeenCalledTimes(2);
  });
});
