import { hmacSignature } from '@kovojs/core/webhooks';
import { s } from '@kovojs/server';
import { webhook } from '@kovojs/server/webhooks';

export function defineOrderWebhook(secret: string) {
  return webhook('/webhooks/orders', {
    verify: hmacSignature({
      encoding: 'hex',
      header: 'x-provider-signature',
      payload: (request) => request.payload,
      secret,
    }),
    input: s.object({ id: s.string(), type: s.string() }),
    handler: ({ id }) => ({ accepted: id }),
  });
}
