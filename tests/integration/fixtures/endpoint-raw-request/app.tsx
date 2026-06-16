// SPEC.md §9.1 and §9.5: raw endpoint handlers receive the original Request
// before body parsing, without ambient session, and dispatch before page routes.
import { createApp, endpoint, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';

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
  auth: { kind: 'verifier', name: 'signature-header' },
  csrf: false,
  csrfJustification: 'signed machine payload',
  async handler(request) {
    return Response.json({
      body: await request.text(),
      signature: request.headers.get('x-signature'),
      sessionAmbient: 'session' in request,
    });
  },
  method: 'POST',
});

const prefixEndpoint = endpoint('/machine/prefix', {
  csrf: false,
  csrfJustification: 'machine prefix mount',
  async handler(request) {
    const url = new URL(request.url);
    return new Response(`prefix:${url.pathname}:${await request.text()}`, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
  method: 'POST',
  mount: 'prefix',
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
