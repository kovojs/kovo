// SPEC.md §9.1: webhook idempotency replays the stored response for repeated
// provider event ids without re-executing the handler.
import { hmacSignature } from '@kovojs/core';
import { createApp, domain, s, verifiedAccess, webhook } from '@kovojs/server';
import type {
  WebhookReplayReservation,
  WebhookReplayStore,
  WebhookWireResponse,
} from '@kovojs/server/internal/wire';
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

export default defineFixture({
  app: () => {
    const replayStore = createReplayStore();
    const idempotentWebhook = webhook('stripe-idempotent', {
      access: verifiedAccess,
      async handler(input, context) {
        const request = context.request as WebhookRequest;
        await request.db.query(
          'insert into webhook_event_attempts (event_id, event_type) values ($1, $2)',
          [input.id, input.type],
        );
        context.recordChange(invoiceDomain, { keys: [input.id] });
        return { ok: true };
      },
      idempotency: (input) => input.id,
      input: s.object({ id: s.string(), type: s.string() }),
      path: '/webhooks/stripe-idempotent',
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

    return createApp({ endpoints: [idempotentWebhook] });
  },
  schema: `create table webhook_event_attempts (
    event_id text not null,
    event_type text not null
  )`,
});
