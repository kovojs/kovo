import { customVerifier } from '@kovojs/core';
import { trustedHtml } from '@kovojs/browser';
import { enhancedNavigationDocumentAcceptHeader } from '@kovojs/core/internal/document-protocol';
import { describe, expect, it } from 'vitest';

import { publicAccess, verifiedAccess } from './access.js';
import { createApp, createRequestHandler } from './app.js';
import { csrfToken } from './csrf.js';
import { endpoint } from './endpoint.js';
import { mutation } from './mutation.js';
import { route } from './route.js';
import { s } from './schema.js';
import { webhook } from './webhook.js';

describe('request ingress intrinsic authority', () => {
  it('does not let a late global URL constructor cross-bind route capability bytes', async () => {
    const victimCapability = 'victim-route-capability';
    const publicRoute = route('/public', {
      page: () => trustedHtml('<main>public-route</main>'),
    });
    const capabilityRoute = route('/capability', {
      page: ({ search }) =>
        trustedHtml(
          search.token === victimCapability
            ? '<main>victim-account</main>'
            : '<main>access-denied</main>',
        ),
      search: s.object({ token: s.string() }),
    });
    const handler = createRequestHandler(
      createApp({ routes: [publicRoute, capabilityRoute] }),
    );
    const request = new Request('https://kovo.local/public?token=attacker-submitted');
    const NativeURL = globalThis.URL;
    class PoisonedURL extends NativeURL {
      constructor(input: string | URL, base?: string | URL) {
        const source = typeof input === 'string' ? input : input.href;
        super(
          source === request.url
            ? `https://kovo.local/capability?token=${victimCapability}`
            : input,
          base,
        );
      }
    }
    globalThis.URL = PoisonedURL;

    let response: Response;
    try {
      response = await handler(request);
    } finally {
      globalThis.URL = NativeURL;
    }
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('public-route');
    expect(body).not.toContain('victim-account');
  });

  it('does not let a late Request.method getter turn an unsafe route request into GET', async () => {
    const calls: string[] = [];
    const handler = createRequestHandler(
      createApp({
        routes: [
          route('/account', {
            page: () => {
              calls.push('rendered');
              return trustedHtml('<main>account</main>');
            },
          }),
        ],
      }),
    );
    const request = new Request('https://kovo.local/account', { method: 'POST' });
    const nativeMethod = Object.getOwnPropertyDescriptor(Request.prototype, 'method')!;
    Object.defineProperty(Request.prototype, 'method', {
      configurable: true,
      get() {
        return this === request ? 'GET' : Reflect.apply(nativeMethod.get!, this, []);
      },
    });

    let response: Response;
    try {
      response = await handler(request);
    } finally {
      Object.defineProperty(Request.prototype, 'method', nativeMethod);
    }

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    expect(calls).toEqual([]);
  });

  it('does not let a late Request.method getter turn GET into an unsafe mutation POST', async () => {
    const calls: string[] = [];
    const definition = mutation('account/delete', {
      csrf: false,
      handler() {
        calls.push('deleted');
        return { ok: true };
      },
      input: s.object({}),
    });
    const handler = createRequestHandler(createApp({ mutations: [definition] }));
    const request = new Request('https://kovo.local/_m/account/delete', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'GET',
    });
    const nativeMethod = Object.getOwnPropertyDescriptor(Request.prototype, 'method')!;
    Object.defineProperty(Request.prototype, 'method', {
      configurable: true,
      get() {
        return this === request ? 'POST' : Reflect.apply(nativeMethod.get!, this, []);
      },
    });

    let response: Response;
    try {
      response = await handler(request);
    } finally {
      Object.defineProperty(Request.prototype, 'method', nativeMethod);
    }

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(calls).toEqual([]);
  });

  it('does not let route code replace the accepted document channel through Headers.get', async () => {
    const nativeGet = Headers.prototype.get;
    const handler = createRequestHandler(
      createApp({
        routes: [
          route('/document', {
            page: () => {
              Headers.prototype.get = function (name: string) {
                if (name.toLowerCase() === 'accept') {
                  return enhancedNavigationDocumentAcceptHeader;
                }
                return Reflect.apply(nativeGet, this, [name]);
              };
              return trustedHtml('<main>full-document</main>');
            },
          }),
        ],
      }),
    );

    let response: Response;
    try {
      response = await handler(
        new Request('https://kovo.local/document', { headers: { Accept: 'text/html' } }),
      );
    } finally {
      Headers.prototype.get = nativeGet;
    }

    expect(response.status).toBe(200);
    expect(response.headers.get('vary')).toBeNull();
    await expect(response.text()).resolves.toContain('installInlineKovoBootstrap');
  });

  it('keeps oversized endpoint bytes at 413 after late stream-reader replacement', async () => {
    const echo = endpoint('/intrinsics/echo', {
      access: publicAccess('body-limit intrinsic regression'),
      csrf: false,
      csrfJustification: 'machine body-limit intrinsic regression',
      async handler(request) {
        return new Response(await request.text());
      },
      method: 'POST',
      reason: 'body-limit intrinsic regression',
      response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
    });
    const handler = createRequestHandler(
      createApp({ endpoints: [echo], requestLimits: { maxBodyBytes: 4 } }),
    );
    const request = new Request('https://kovo.local/intrinsics/echo', {
      body: 'attacker-oversized-body',
      method: 'POST',
    });
    const sourceBody = request.body;
    if (sourceBody === null) throw new Error('test request unexpectedly lacks a body');
    const nativeGetReader = ReadableStream.prototype.getReader;
    const safeBytes = new TextEncoder().encode('safe');
    let reads = 0;
    try {
      ReadableStream.prototype.getReader = function (...args: unknown[]) {
        if (this === sourceBody) {
          return {
            cancel: async () => undefined,
            read: async () =>
              reads++ === 0
                ? { done: false as const, value: safeBytes }
                : { done: true as const, value: undefined },
            releaseLock() {},
          } as ReadableStreamDefaultReader<unknown>;
        }
        return Reflect.apply(
          nativeGetReader,
          this,
          args as [],
        ) as ReadableStreamDefaultReader<unknown>;
      };
      const response = await handler(request);
      expect(response.status).toBe(413);
    } finally {
      ReadableStream.prototype.getReader = nativeGetReader;
    }
  });

  it('cannot substitute a valid victim CSRF body before mutation parsing', async () => {
    const calls: string[] = [];
    const csrf = {
      secret: 'ingress-csrf-secret-0123456789abcdef',
      sessionId(request: { headers?: Headers }) {
        return request.headers?.get('cookie')?.match(/(?:^|;\s*)sid=([^;]+)/u)?.[1];
      },
    };
    const key = 'intrinsics/body-substitution';
    const definition = mutation(key, {
      access: publicAccess('verified-body CSRF intrinsic regression'),
      handler(input: { action: string }) {
        calls.push(input.action);
        return input;
      },
      input: s.object({ action: s.string() }),
    });
    const handler = createRequestHandler(createApp({ csrf, mutations: [definition] }));
    const victimHeaders = new Headers({ Cookie: 'sid=victim' });
    const validToken = csrfToken({ headers: victimHeaders }, csrf, { audience: key });
    const substitutedBody = new URLSearchParams({
      action: 'delete-account',
      'kovo-csrf': validToken,
    }).toString();
    const request = new Request(`https://kovo.local/_m/${key}`, {
      body: new URLSearchParams({
        action: 'delete-account',
        'kovo-csrf': 'v1.attacker.attacker',
      }),
      headers: { Cookie: 'sid=victim', Origin: 'https://kovo.local' },
      method: 'POST',
    });
    const sourceBody = request.body;
    if (sourceBody === null) throw new Error('test request unexpectedly lacks a body');
    const nativeGetReader = ReadableStream.prototype.getReader;
    const substitutedBytes = new TextEncoder().encode(substitutedBody);
    let reads = 0;
    try {
      ReadableStream.prototype.getReader = function (...args: unknown[]) {
        if (this === sourceBody) {
          return {
            cancel: async () => undefined,
            read: async () =>
              reads++ === 0
                ? { done: false as const, value: substitutedBytes }
                : { done: true as const, value: undefined },
            releaseLock() {},
          } as ReadableStreamDefaultReader<unknown>;
        }
        return Reflect.apply(
          nativeGetReader,
          this,
          args as [],
        ) as ReadableStreamDefaultReader<unknown>;
      };
      const response = await handler(request);
      expect(response.status).toBe(422);
      expect(calls).toEqual([]);
    } finally {
      ReadableStream.prototype.getReader = nativeGetReader;
    }
  });

  it('authenticates the exact endpoint body instead of live Request.arrayBuffer output', async () => {
    const handlerBodies: string[] = [];
    const definition = endpoint('/intrinsics/body-auth', {
      access: verifiedAccess,
      auth: {
        kind: 'custom',
        name: 'body-auth',
        verify: customVerifier(
          'body-auth',
          ({ payload }) => new TextDecoder().decode(payload) === 'signed-safe',
        ),
      },
      csrf: false,
      csrfJustification: 'machine body-auth intrinsic regression',
      async handler(request) {
        handlerBodies.push(await request.text());
        return new Response('ok');
      },
      method: 'POST',
      reason: 'body-auth intrinsic regression',
      response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
    });
    const handler = createRequestHandler(createApp({ endpoints: [definition] }));
    const nativeArrayBuffer = Request.prototype.arrayBuffer;
    const signedSafe = new TextEncoder().encode('signed-safe');
    try {
      Request.prototype.arrayBuffer = async function () {
        return signedSafe.buffer.slice(0);
      };
      const response = await handler(
        new Request('https://kovo.local/intrinsics/body-auth', {
          body: 'dangerous',
          method: 'POST',
        }),
      );
      expect(response.status).toBe(401);
      expect(handlerBodies).toEqual([]);
    } finally {
      Request.prototype.arrayBuffer = nativeArrayBuffer;
    }
  });

  it('dispatches the exact accepted body through pinned Request readers', async () => {
    const handlerBodies: string[] = [];
    const definition = endpoint('/intrinsics/pinned-body-dispatch', {
      access: verifiedAccess,
      auth: {
        kind: 'custom',
        name: 'pinned-body-dispatch',
        verify: customVerifier(
          'pinned-body-dispatch',
          ({ payload }) => new TextDecoder().decode(payload) === 'signed-safe',
        ),
      },
      csrf: false,
      csrfJustification: 'machine pinned body dispatch regression',
      async handler(request) {
        handlerBodies.push(await request.text());
        return new Response('ok');
      },
      method: 'POST',
      reason: 'pinned body dispatch regression',
      response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
    });
    const handler = createRequestHandler(createApp({ endpoints: [definition] }));
    const nativeText = Request.prototype.text;
    try {
      Request.prototype.text = async () => 'dangerous';
      const response = await handler(
        new Request('https://kovo.local/intrinsics/pinned-body-dispatch', {
          body: 'signed-safe',
          method: 'POST',
        }),
      );
      expect(response.status).toBe(200);
      expect(handlerBodies).toEqual(['signed-safe']);
    } finally {
      Request.prototype.text = nativeText;
    }
  });

  it('pins endpoint and webhook verifier headers to the dispatched carrier', async () => {
    const endpointCalls: string[] = [];
    const webhookCalls: string[] = [];
    const verify = (name: string) =>
      customVerifier(name, ({ headers }) => headers.get('x-machine-token') === 'accepted');
    const machineEndpoint = endpoint('/intrinsics/header-auth', {
      access: verifiedAccess,
      auth: { kind: 'custom', name: 'header-auth', verify: verify('header-auth') },
      csrf: false,
      csrfJustification: 'machine header-auth intrinsic regression',
      handler(request) {
        endpointCalls.push(request.headers.get('x-machine-token') ?? 'missing');
        return new Response('ok');
      },
      method: 'POST',
      reason: 'header-auth intrinsic regression',
      response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
    });
    const machineWebhook = webhook('/intrinsics/header-webhook', {
      handler(_input, context) {
        webhookCalls.push(context.request.headers.get('x-machine-token') ?? 'missing');
      },
      input: s.object({ id: s.string() }),
      verify: verify('header-webhook'),
    });
    const handler = createRequestHandler(
      createApp({ endpoints: [machineEndpoint, machineWebhook] }),
    );
    const nativeGet = Headers.prototype.get;
    let reads = 0;
    try {
      Headers.prototype.get = function (name: string) {
        if (name.toLowerCase() === 'x-machine-token' && reads++ === 0) return 'accepted';
        return Reflect.apply(nativeGet, this, [name]);
      };
      const endpointResponse = await handler(
        new Request('https://kovo.local/intrinsics/header-auth', {
          body: 'payload',
          headers: { 'X-Machine-Token': 'attacker' },
          method: 'POST',
        }),
      );
      const webhookResponse = await handler(
        new Request('https://kovo.local/intrinsics/header-webhook', {
          body: JSON.stringify({ id: 'evt_attacker' }),
          headers: {
            'Content-Type': 'application/json',
            'X-Machine-Token': 'attacker',
          },
          method: 'POST',
        }),
      );
      expect({
        endpointCalls,
        endpointStatus: endpointResponse.status,
        reads,
        webhookCalls,
        webhookStatus: webhookResponse.status,
      }).toEqual({
        endpointCalls: [],
        endpointStatus: 401,
        reads: 0,
        webhookCalls: [],
        webhookStatus: 401,
      });
    } finally {
      Headers.prototype.get = nativeGet;
    }
  });

  it('dispatches the exact accepted headers through pinned Headers readers', async () => {
    const endpointCalls: string[] = [];
    const webhookCalls: string[] = [];
    const verify = (name: string) =>
      customVerifier(name, ({ headers }) => headers.get('x-machine-token') === 'accepted');
    const machineEndpoint = endpoint('/intrinsics/pinned-header-auth', {
      access: verifiedAccess,
      auth: { kind: 'custom', name: 'pinned-header-auth', verify: verify('pinned-header-auth') },
      csrf: false,
      csrfJustification: 'machine pinned header dispatch regression',
      handler(request) {
        endpointCalls.push(request.headers.get('x-machine-token') ?? 'missing');
        return new Response('ok');
      },
      method: 'POST',
      reason: 'pinned header dispatch regression',
      response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
    });
    const machineWebhook = webhook('/intrinsics/pinned-header-webhook', {
      handler(_input, context) {
        webhookCalls.push(context.request.headers.get('x-machine-token') ?? 'missing');
      },
      input: s.object({ id: s.string() }),
      verify: verify('pinned-header-webhook'),
    });
    const handler = createRequestHandler(
      createApp({ endpoints: [machineEndpoint, machineWebhook] }),
    );
    const nativeGet = Headers.prototype.get;
    try {
      Headers.prototype.get = function (name: string) {
        if (name.toLowerCase() === 'x-machine-token') return 'victim/admin';
        return Reflect.apply(nativeGet, this, [name]);
      };
      const endpointResponse = await handler(
        new Request('https://kovo.local/intrinsics/pinned-header-auth', {
          body: 'payload',
          headers: { 'X-Machine-Token': 'accepted' },
          method: 'POST',
        }),
      );
      const webhookResponse = await handler(
        new Request('https://kovo.local/intrinsics/pinned-header-webhook', {
          body: JSON.stringify({ id: 'evt_accepted' }),
          headers: {
            'Content-Type': 'application/json',
            'X-Machine-Token': 'accepted',
          },
          method: 'POST',
        }),
      );
      expect(endpointResponse.status).toBe(200);
      expect(webhookResponse.status).toBe(200);
      expect(endpointCalls).toEqual(['accepted']);
      expect(webhookCalls).toEqual(['accepted']);
    } finally {
      Headers.prototype.get = nativeGet;
    }
  });
});
