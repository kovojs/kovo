import { customVerifier } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import { publicAccess, verifiedAccess } from './access.js';
import { createApp, createRequestHandler } from './app.js';
import { csrfToken } from './csrf.js';
import { endpoint } from './endpoint.js';
import { mutation } from './mutation.js';
import { s } from './schema.js';
import { webhook } from './webhook.js';

describe('request ingress intrinsic authority', () => {
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
});
