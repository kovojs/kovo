import { describe, expect, it } from 'vitest';

describe('request ingress bootstrap order', () => {
  it('does not authenticate pre-import Request.arrayBuffer substitution', async () => {
    const nativeArrayBuffer = Request.prototype.arrayBuffer;
    const signedSafe = new TextEncoder().encode('signed-safe');
    try {
      Request.prototype.arrayBuffer = async function () {
        return signedSafe.buffer.slice(0);
      };
      const [core, access, app, endpoints] = await Promise.all([
        import('@kovojs/core'),
        import('./access.js'),
        import('./app.js'),
        import('./endpoint.js'),
      ]);
      const handlerCalls: string[] = [];
      const definition = endpoints.endpoint('/intrinsics/preimport-body-auth', {
        access: access.verifiedAccess,
        auth: {
          kind: 'custom',
          name: 'preimport-body-auth',
          verify: core.customVerifier(
            'preimport-body-auth',
            ({ payload }) => new TextDecoder().decode(payload) === 'signed-safe',
          ),
        },
        csrf: false,
        csrfJustification: 'machine pre-import body-auth intrinsic regression',
        async handler(request) {
          handlerCalls.push(await request.text());
          return new Response('ok');
        },
        method: 'POST',
        reason: 'pre-import body-auth intrinsic regression',
        response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
      });
      const handler = app.createRequestHandler(app.createApp({ endpoints: [definition] }));
      const response = await handler(
        new Request('https://kovo.local/intrinsics/preimport-body-auth', {
          body: 'dangerous',
          method: 'POST',
        }),
      );

      expect(response.status).toBe(401);
      expect(handlerCalls).toEqual([]);
    } finally {
      Request.prototype.arrayBuffer = nativeArrayBuffer;
    }
  });
});
