// SPEC.md §9.1: webhook idempotency replays the stored response for repeated
// provider event ids without re-executing the handler.
import { hmacSignature } from '@kovojs/core';
import { createApp, domain, mutation, s, webhook } from '@kovojs/server';
import type {
  WebhookReplayReservation,
  WebhookReplayStore,
  WebhookWireResponse,
} from '@kovojs/test/internal/integration/fixture-abi';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

type WebhookRequest = Request & KovoFixtureRequest;

function createReplayStore(): WebhookReplayStore {
  const entries = new Map<string, WebhookWireResponse>();
  const keyFor = (scope: string, idem: string) => `${scope}\0${idem}`;

  return {
    get(scope, idem) {
      return entries.get(keyFor(scope, idem));
    },
    reserve(scope, idem): WebhookReplayReservation {
      const key = keyFor(scope, idem);
      return {
        commit(response) {
          entries.set(key, response);
        },
      };
    },
    set(scope, idem, response) {
      entries.set(keyFor(scope, idem), response);
    },
  };
}

const invoiceDomain = domain('invoice');
const webhookEventInput = s.object({ id: s.string(), type: s.string() });

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
    const replayStore = createReplayStore();
    const idempotentWebhook = webhook('/webhooks/stripe-idempotent', {
      async handler(input, context) {
        return context
          .declareSystemWrite('record verified Stripe webhook delivery attempt')
          .runMutation(recordWebhookAttempt, { id: input.id, type: input.type });
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
        secret: 'whsec_integration',
      }),
    });

    return createApp({ endpoints: [idempotentWebhook], mutations: [recordWebhookAttempt] });
  },
  schema: `create table webhook_event_attempts (
    event_id text not null,
    event_type text not null
  )`,
});
