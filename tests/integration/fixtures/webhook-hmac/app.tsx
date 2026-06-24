// SPEC.md §9.1: webhook() captures raw bytes, verifies before parsing, accepts
// loose provider fields, writes Kovo-owned data, and emits unified changes.
import { hmacSignature } from '@kovojs/core';
import { createApp, domain, s, verifiedAccess, webhook } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

type WebhookRequest = Request & KovoFixtureRequest;

const invoiceDomain = domain('invoice');

function providerAmount(input: unknown): number | null {
  if (typeof input !== 'object' || input === null || !('provider_extra' in input)) return null;
  const extra = (input as { provider_extra?: unknown }).provider_extra;
  if (typeof extra !== 'object' || extra === null || !('amount' in extra)) return null;
  const amount = (extra as { amount?: unknown }).amount;
  return typeof amount === 'number' ? amount : null;
}

const stripeLite = webhook('stripe-lite', {
  access: verifiedAccess,
  async handler(input, context) {
    const request = context.request as WebhookRequest;
    await request.db.query(
      'insert into webhook_events (id, event_type, raw_amount) values ($1, $2, $3)',
      [input.id, input.type, providerAmount(input)],
    );
    context.recordChange(invoiceDomain, { keys: [input.id] });
    return { ok: true };
  },
  idempotency: (input) => input.id,
  input: s.object({ id: s.string(), type: s.string() }),
  path: '/webhooks/stripe-lite',
  verify: hmacSignature({
    encoding: 'hex',
    header: 'x-signature',
    name: 'stripe-lite',
    payload: (request) => request.payload,
    scheme: 'stripe-lite:v1:hmac-sha256',
    secret: 'whsec_integration',
  }),
});

export default defineFixture({
  app: createApp({ endpoints: [stripeLite] }),
  schema: `create table webhook_events (
    id text primary key,
    event_type text not null,
    raw_amount integer
  )`,
});
