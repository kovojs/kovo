// SPEC.md §9.1: redelivered webhook events replay the stored response and do
// not run the write handler a second time.
import { createHmac } from 'node:crypto';
import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'webhook-idempotency' });

function sign(body: string): string {
  return createHmac('sha256', 'whsec_integration').update(body).digest('hex');
}

test('duplicate provider event id replays without re-executing handler', async ({
  request,
  kovoApp,
}) => {
  const body = JSON.stringify({ id: 'evt_repeat_1', type: 'invoice.paid' });
  const headers = {
    'content-type': 'application/json',
    'x-signature': sign(body),
  };

  const first = await request.post('/webhooks/stripe-idempotent', { data: body, headers });
  const duplicate = await request.post('/webhooks/stripe-idempotent', { data: body, headers });

  expect(first.status()).toBe(200);
  expect(duplicate.status()).toBe(200);
  expect(await first.text()).toBe('ok');
  expect(await duplicate.text()).toBe('ok');
  expect(first.headers()['kovo-idem']).toBe('evt_repeat_1');
  expect(duplicate.headers()['kovo-idem']).toBe('evt_repeat_1');
  expect(first.headers()['kovo-changes']).toBe('[{"domain":"invoice","keys":["evt_repeat_1"]}]');
  expect(duplicate.headers()['kovo-changes']).toBe(
    '[{"domain":"invoice","keys":["evt_repeat_1"]}]',
  );

  await expect(
    kovoApp.db.query(
      'select event_id, event_type, count(*)::int as count from webhook_event_attempts group by event_id, event_type',
    ),
  ).resolves.toEqual([{ count: 1, event_id: 'evt_repeat_1', event_type: 'invoice.paid' }]);
});
