// SPEC.md §9.1 and §11.4: CSRF-exempt endpoint ingress keeps its exemption and
// auth posture visible in the endpoint audit surface.
import { createHmac } from 'node:crypto';
import { expect, test } from '@kovojs/test/internal/integration';
import { kovoExplain } from '@kovojs/cli';

test.use({ kovoFixture: 'endpoint-csrf-exempt-audited' });

test('CSRF-exempt endpoint dispatches as machine ingress without mutation semantics', async ({
  request,
}) => {
  const signature = createHmac('sha256', 'endpoint-demo-hmac-secret-at-least-32-bytes')
    .update('raw=payload')
    .digest('hex');
  const response = await request.post('/webhooks/signed-callback', {
    data: 'raw=payload',
    headers: { 'x-demo-signature': signature },
  });

  expect(response.status()).toBe(202);
  expect(response.headers()['content-type']).toContain('text/plain');
  expect(response.headers()['kovo-changes']).toBeUndefined();
  expect(await response.text()).toBe(`accepted:${signature}:raw=payload`);
});

test('endpoint audit prints auth and CSRF exemption justification', () => {
  const result = kovoExplain(
    {
      endpoints: [
        {
          auth: 'verifier:demo-hmac',
          csrf: 'exempt',
          csrfJustification: 'signed callback verifies raw body',
          method: 'POST',
          name: 'webhooks/signed-callback',
          path: '/webhooks/signed-callback',
        },
      ],
    },
    { endpoints: true },
  );

  expect(result.exitCode).toBe(0);
  expect(result.output).toContain(
    'ENDPOINT webhooks/signed-callback surface=endpoint method=POST path=/webhooks/signed-callback mount=exact auth=verifier:demo-hmac csrf=exempt:signed callback verifies raw body cache=- body=- bodySize=- rateLimit=- headers=- files=- dynamic=- writes=-',
  );
});
