// SPEC.md §9.1: webhook() captures raw bytes, verifies before parsing, accepts
// loose provider fields, writes Kovo-owned data, and emits unified changes.
import { hmacSignature } from '@kovojs/core';
import { createApp, domain, mutation, s, webhook } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

type WebhookRequest = Request & KovoFixtureRequest;
type ReplayResponse = {
  body: string;
  headers: Record<string, string>;
  status: 200 | 400 | 401 | 422 | 429 | 500;
};

const WEBHOOK_HMAC_SECRET = '909192939495969798999a9b9c9d9e9f';

function createReplayStore() {
  const entries = new Map<string, ReplayResponse>();
  const keyFor = (scope: string, idem: string) => `${scope}\0${idem}`;

  return {
    get(scope, idem) {
      return entries.get(keyFor(scope, idem));
    },
    reserve(scope, idem) {
      const key = keyFor(scope, idem);
      return {
        commit(response: ReplayResponse) {
          entries.set(key, response);
        },
      };
    },
    set(scope: string, idem: string, response: ReplayResponse) {
      entries.set(keyFor(scope, idem), response);
    },
  };
}

const invoiceDomain = domain('invoice');
const replayStore = createReplayStore();
const webhookEventInput = s.object({ id: s.string(), type: s.string() });
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
  idempotency: (input) => input.id,
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
