// SPEC.md §9.1: webhook idempotency replays the stored response for repeated
// provider event ids without re-executing the handler.
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

const WEBHOOK_HMAC_SECRET = 'a0a1a2a3a4a5a6a7a8a9aaabacadaeaf';

type WebhookRequest = Request & KovoFixtureRequest;

const invoiceDomain = domain('invoice');
const webhookEventInput = s.object({
  id: s.string(),
  occurredAtMs: s.number().int(),
  type: s.string(),
});

const recordWebhookAttempt = mutation('webhook-idempotency/record-attempt', {
  async handler(input, request) {
    const webhookRequest = request as WebhookRequest;
    await webhookRequest.db.query({
      text: 'insert into webhook_event_attempts (event_id, event_type) values ($1, $2)',
      values: [input.id, input.type],
    });
    return { ok: true };
  },
  input: webhookEventInput,
  registry: { tables: ['webhook_event_attempts'], touches: [invoiceDomain] },
});

export default defineFixture({
  app: () => {
    const replayStore = createMemoryWebhookReplayStore();
    const idempotentWebhook = webhook('/webhooks/stripe-idempotent', {
      async handler(input, context) {
        return context
          .declareSystemWrite('record verified Stripe webhook delivery attempt')
          .runMutation(recordWebhookAttempt, {
            id: input.id,
            occurredAtMs: input.occurredAtMs,
            type: input.type,
          });
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
    });

    return createApp({ endpoints: [idempotentWebhook], mutations: [recordWebhookAttempt] });
  },
  schema: `create table webhook_event_attempts (
    event_id text not null,
    event_type text not null
  )`,
});
