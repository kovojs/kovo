import { describe, expect, it } from 'vitest';

import {
  customVerifier,
  hmacSignature,
  standardWebhooks,
  stripeSignature,
  type WebhookVerificationRequest,
} from './index.js';

const stripePayload = '{"id":"evt_test_webhook","object":"event"}';
const stripeTimestamp = 1674087231;
const stripeNow = stripeTimestamp * 1000;
const stripeSignatureHeader =
  't=1674087231,v1=413e6d5ee0846b0726a98c703e7195bb2ff47e561b7de4a663cfc050fec40796';

const standardPayload =
  '{"type":"contact.created","timestamp":"2022-11-03T20:26:10.344522Z","data":{"id":"1f81eb52-5198-4599-803e-771906343485"}}';
const standardSecret = 'whsec_c3RhbmRhcmQgdGVzdCBzZWNyZXQga2V5IDMyIGJ5dGVzISE=';
const standardHeaders = {
  'webhook-id': 'msg_2KWPBgLlAfxdpx2AI54pPJ85f4W',
  'webhook-signature': 'v1,57taE4Y46JQnEtGtq+L0e70M5KAxhpYCvUSOaz7PZ2E=',
  'webhook-timestamp': '1674087231',
};

describe('webhook verifier kit', () => {
  it('verifies a generic HMAC signature with constant-time comparison inputs', async () => {
    const verifier = hmacSignature({
      encoding: 'hex',
      header: 'x-signature',
      payload: ({ payload }) => payload,
      secret: 'secret',
      tolerance: {
        header: 'x-timestamp',
        seconds: 300,
      },
    });
    const request = {
      headers: {
        'x-signature': '88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b',
        'x-timestamp': '1674087231',
      },
      now: 1674087231 * 1000,
      payload: 'hello',
    } satisfies WebhookVerificationRequest;

    await expect(verifier.verify(request)).resolves.toBe(true);
    await expect(
      verifier.verify({
        ...request,
        headers: {
          ...request.headers,
          'x-signature': 'deadbeef',
        },
      }),
    ).resolves.toBe(false);
  });

  it('uses the Stripe preset over raw payload bytes with default timestamp tolerance', async () => {
    const verifier = stripeSignature({ secret: 'whsec_test_secret' });

    expect(verifier.resolved).toEqual({
      encoding: 'hex',
      header: 'stripe-signature',
      kind: 'hmac',
      multiSig: true,
      name: 'stripe',
      scheme: 'stripe:v1:hmac-sha256',
      toleranceSeconds: 300,
    });
    await expect(
      verifier.verify({
        headers: {
          'stripe-signature': stripeSignatureHeader,
        },
        now: stripeNow,
        payload: stripePayload,
      }),
    ).resolves.toBe(true);
  });

  it('rejects tampered payloads and stale Stripe timestamps', async () => {
    const verifier = stripeSignature({ secret: 'whsec_test_secret' });
    const request = {
      headers: {
        'stripe-signature': stripeSignatureHeader,
      },
      now: stripeNow,
      payload: stripePayload,
    } satisfies WebhookVerificationRequest;

    await expect(verifier.verify({ ...request, payload: '{"id":"evt_tampered"}' })).resolves.toBe(
      false,
    );
    await expect(verifier.verify({ ...request, now: stripeNow + 301_000 })).resolves.toBe(false);
  });

  it('accepts Stripe rotated secrets and multiple v1 signatures', async () => {
    const verifier = stripeSignature({ secret: ['whsec_current_secret', 'whsec_old_secret'] });

    await expect(
      verifier.verify({
        headers: {
          'stripe-signature': [
            't=1674087231',
            'v1=0000000000000000000000000000000000000000000000000000000000000000',
            'v1=9cdda4392bf620067d218f36a1a74bba6f181ea440c8e81ac4e847807976f5d3',
          ].join(','),
        },
        now: stripeNow,
        payload: stripePayload,
      }),
    ).resolves.toBe(true);
  });

  it('uses the Standard Webhooks preset with whsec base64 secrets', async () => {
    const verifier = standardWebhooks({ secret: standardSecret });

    expect(verifier.resolved).toEqual({
      encoding: 'base64',
      header: 'webhook-signature',
      kind: 'hmac',
      multiSig: true,
      name: 'standard-webhooks',
      scheme: 'standard-webhooks:v1:hmac-sha256',
      toleranceSeconds: 300,
    });
    await expect(
      verifier.verify({
        headers: standardHeaders,
        now: stripeNow,
        payload: standardPayload,
      }),
    ).resolves.toBe(true);
  });

  it('rejects invalid Standard Webhooks signatures and timestamps', async () => {
    const verifier = standardWebhooks({ secret: standardSecret });
    const request = {
      headers: standardHeaders,
      now: stripeNow,
      payload: standardPayload,
    } satisfies WebhookVerificationRequest;

    await expect(
      verifier.verify({
        ...request,
        headers: {
          ...request.headers,
          'webhook-signature': 'v1,invalid',
        },
      }),
    ).resolves.toBe(false);
    await expect(verifier.verify({ ...request, now: stripeNow - 301_000 })).resolves.toBe(false);
  });

  it('supports custom verifier escapes for non-HMAC schemes', async () => {
    const verifier = customVerifier('provider-ed25519', (request) =>
      request.headers instanceof Headers
        ? request.headers.get('x-provider-signature') === 'accepted'
        : false,
    );

    await expect(
      verifier.verify({
        headers: new Headers({ 'x-provider-signature': 'accepted' }),
        payload: '{}',
      }),
    ).resolves.toBe(true);
  });
});
