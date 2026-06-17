// SPEC.md §9.1: CSRF-exempt endpoints are declared machine ingress with a named
// justification, not browser mutation forms.
import { createApp, endpoint, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

const webhookEndpoint = endpoint('/webhooks/signed-callback', {
  auth: { kind: 'verifier', name: 'demo-hmac' },
  csrf: false,
  csrfJustification: 'signed callback verifies raw body',
  async handler(request) {
    return new Response(
      `accepted:${request.headers.get('x-demo-signature')}:${await request.text()}`,
      {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        status: 202,
      },
    );
  },
  method: 'POST',
});

const homeRoute = route('/', {
  page: () => '<main><h1>CSRF Exempt Endpoint</h1></main>',
});

export default defineFixture({
  app: createApp({
    endpoints: [webhookEndpoint],
    routes: [homeRoute],
  }),
});
