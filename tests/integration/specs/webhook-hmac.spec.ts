// SPEC.md §9.1: HMAC webhooks verify the raw body before parse/write and return
// sanitized Kovo change metadata for accepted provider events.
import { createHmac } from 'node:crypto';
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'webhook-hmac' });

function sign(body: string): string {
  return createHmac('sha256', 'whsec_integration').update(body).digest('hex');
}

test('signed webhook writes once and emits a unified change record', async ({
  request,
  kovoApp,
}) => {
  const body = JSON.stringify({
    id: 'evt_hmac_1',
    provider_extra: { amount: 4900, livemode: false },
    type: 'invoice.paid',
  });

  const response = await request.post('/webhooks/stripe-lite', {
    data: body,
    headers: {
      'content-type': 'application/json',
      'x-signature': sign(body),
    },
  });

  expect(response.status()).toBe(200);
  expect(await response.text()).toBe('ok');
  expect(response.headers()['kovo-idem']).toBe('evt_hmac_1');
  expect(JSON.parse(response.headers()['kovo-changes'] ?? 'null')).toEqual([
    { domain: 'invoice', keys: ['evt_hmac_1'] },
  ]);

  await expect(
    kovoApp.db.query('select id, event_type, raw_amount from webhook_events'),
  ).resolves.toEqual([{ event_type: 'invoice.paid', id: 'evt_hmac_1', raw_amount: 4900 }]);
});

test('invalid signature is rejected before JSON parse or writes', async ({ request, kovoApp }) => {
  const response = await request.post('/webhooks/stripe-lite', {
    data: '{bad json',
    headers: {
      'content-type': 'application/json',
      'x-signature': sign('{}'),
    },
  });

  expect(response.status()).toBe(401);
  expect(await response.text()).toBe('Unauthorized');
  expect(response.headers()['kovo-changes']).toBeUndefined();
  await expect(kovoApp.db.query('select id from webhook_events')).resolves.toEqual([]);
});
