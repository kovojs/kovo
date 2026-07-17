// SPEC.md §9.1: webhook() captures raw bytes, verifies before parsing, accepts
// loose provider fields, writes Kovo-owned data, and emits unified changes.
import { hmacSignature } from '@kovojs/core';
import {
  createApp,
  createMemoryWebhookReplayStore,
  domain,
  mutation,
  s,
  webhook,
  webhookReplayIdentity,
} from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

type WebhookRequest = Request & KovoFixtureRequest;
const WEBHOOK_HMAC_SECRET = '909192939495969798999a9b9c9d9e9f';

const invoiceDomain = domain('invoice');
const replayStore = createMemoryWebhookReplayStore();
const webhookEventInput = s.object({
  id: s.string(),
  occurredAtMs: s.number().int(),
  type: s.string(),
});
const recordWebhookEventInput = s.object({
  id: s.string(),
  rawAmount: s.number(),
  type: s.string(),
});

function providerAmount(input: unknown): number | null {
  if (typeof input !== 'object' || input === null || !('provider_extra' in input)) return null;
  const extra = (input as { provider_extra?: unknown }).provider_extra;
  if (typeof extra !== 'object' || extra === null || !('amount' in extra)) return null;
  const amount = (extra as { amount?: unknown }).amount;
  return typeof amount === 'number' ? amount : null;
}

const recordWebhookEvent = mutation('webhook-hmac/record-event', {
  async handler(input, request) {
    const webhookRequest = request as WebhookRequest;
    await webhookRequest.db.query({
      text: 'insert into webhook_events (id, event_type, raw_amount) values ($1, $2, $3)',
      values: [input.id, input.type, input.rawAmount],
    });
    return { ok: true };
  },
  input: recordWebhookEventInput,
  registry: { tables: ['webhook_events'] },
});

const stripeLite = webhook('/webhooks/stripe-lite', {
  async handler(input, context) {
    const rawAmount = providerAmount(input);
    if (rawAmount === null) throw new TypeError('provider amount is missing');
    const result = await context
      .declareSystemWrite('record verified Stripe webhook event')
      .runMutation(recordWebhookEvent, { id: input.id, rawAmount, type: input.type });
    context.recordChange(invoiceDomain, { keys: [input.id] });
    return result;
  },
  idempotency: (input) => webhookReplayIdentity(input.id, input.occurredAtMs),
  input: webhookEventInput,
  replayStore,
  verify: hmacSignature({
    encoding: 'hex',
    header: 'x-signature',
    name: 'stripe-lite',
    payload: (request) => request.payload,
    scheme: 'stripe-lite:v1:hmac-sha256',
    secret: WEBHOOK_HMAC_SECRET,
  }),
  writes: [invoiceDomain],
});

export default defineFixture({
  app: createApp({ endpoints: [stripeLite], mutations: [recordWebhookEvent] }),
  schema: `create table webhook_events (
    id text primary key,
    event_type text not null,
    raw_amount integer
  )`,
});
