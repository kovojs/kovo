// SPEC.md §9.1 and §9.5: raw endpoint handlers receive the original Request
// before body parsing, without ambient session, and dispatch before page routes.
import { hmacSignature } from '@kovojs/core';
import { createApp, endpoint, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

interface RawSession {
  user: { id: string; roles: readonly string[] };
}

function readSessionCookie(request: Request): RawSession | null {
  const raw = request.headers.get('cookie') ?? '';
  return raw.includes('endpoint_raw_session=1')
    ? { user: { id: 'u1', roles: ['endpoint-tester'] } }
    : null;
}

const exactEndpoint = endpoint('/machine/exact', {
  auth: {
    kind: 'verifier',
    name: 'endpoint-raw:v1:hmac-sha256',
    verify: hmacSignature({
      encoding: 'hex',
      header: 'x-signature',
      name: 'endpoint-raw',
      payload: (request) => request.payload,
      scheme: 'endpoint-raw:v1:hmac-sha256',
      secret: 'whsec_endpoint_raw',
    }),
  },
  csrf: false,
  csrfJustification: 'signed machine payload',
  async handler(request) {
    return Response.json(
      {
        body: await request.text(),
        signature: request.headers.get('x-signature'),
        sessionAmbient: 'session' in request,
      },
      {
        headers: { 'cache-control': 'no-store' },
      },
    );
  },
  method: 'POST',
  reason: 'signed raw machine request fixture',
  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
});

const prefixEndpoint = endpoint('/machine/prefix', {
  csrf: false,
  csrfJustification: 'machine prefix mount',
  async handler(request) {
    const url = new URL(request.url);
    return new Response(`prefix:${url.pathname}:${await request.text()}`, {
      headers: {
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
      },
    });
  },
  method: 'POST',
  mount: 'prefix',
  mountJustification: 'machine prefix endpoint fixture',
  reason: 'machine prefix endpoint fixture',
  response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
});

const exactRoute = route('/machine/exact', {
  page: () => '<main><h1>Route Fallback</h1></main>',
});

export default defineFixture({
  app: createApp<RawSession>({
    endpoints: [exactEndpoint, prefixEndpoint],
    routes: [exactRoute],
    sessionProvider: (request) => readSessionCookie(request),
  }),
});
