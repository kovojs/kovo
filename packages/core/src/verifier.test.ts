import { describe, expect, it } from 'vitest';

import {
  customVerifier,
  hmacSignature,
  standardWebhooks,
  type HmacSecret,
  type HmacSignatureVerifier,
  type WebhookPayload,
  type WebhookVerificationRequest,
} from './index.js';

const providerPayload = '{"id":"evt_test_webhook","object":"event"}';
const providerTimestamp = 1674087231;
const providerNow = providerTimestamp * 1000;
const providerSignatureHeader =
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

  it('supports app-owned timestamped multi-signature HMAC recipes', async () => {
    const verifier = timestampedProviderSignature({ secret: 'whsec_test_secret' });

    expect(verifier.resolved).toEqual({
      encoding: 'hex',
      header: 'x-provider-signature',
      kind: 'hmac',
      multiSig: true,
      name: 'timestamped-provider',
      scheme: 'timestamped-provider:v1:hmac-sha256',
      toleranceSeconds: 300,
    });
    await expect(
      verifier.verify({
        headers: {
          'x-provider-signature': providerSignatureHeader,
        },
        now: providerNow,
        payload: providerPayload,
      }),
    ).resolves.toBe(true);
  });

  it('rejects tampered payloads and stale timestamped provider signatures', async () => {
    const verifier = timestampedProviderSignature({ secret: 'whsec_test_secret' });
    const request = {
      headers: {
        'x-provider-signature': providerSignatureHeader,
      },
      now: providerNow,
      payload: providerPayload,
    } satisfies WebhookVerificationRequest;

    await expect(verifier.verify({ ...request, payload: '{"id":"evt_tampered"}' })).resolves.toBe(
      false,
    );
    await expect(verifier.verify({ ...request, now: providerNow + 301_000 })).resolves.toBe(false);
  });

  it('accepts rotated secrets and multiple v1 signatures in app-owned recipes', async () => {
    const verifier = timestampedProviderSignature({
      secret: ['whsec_current_secret', 'whsec_old_secret'],
    });

    await expect(
      verifier.verify({
        headers: {
          'x-provider-signature': [
            't=1674087231',
            'v1=0000000000000000000000000000000000000000000000000000000000000000',
            'v1=9cdda4392bf620067d218f36a1a74bba6f181ea440c8e81ac4e847807976f5d3',
          ].join(','),
        },
        now: providerNow,
        payload: providerPayload,
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
        now: providerNow,
        payload: standardPayload,
      }),
    ).resolves.toBe(true);
  });

  it('rejects invalid Standard Webhooks signatures and timestamps', async () => {
    const verifier = standardWebhooks({ secret: standardSecret });
    const request = {
      headers: standardHeaders,
      now: providerNow,
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
    await expect(verifier.verify({ ...request, now: providerNow - 301_000 })).resolves.toBe(false);
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

function timestampedProviderSignature(options: {
  secret: HmacSecret | readonly HmacSecret[];
}): HmacSignatureVerifier {
  return hmacSignature({
    encoding: 'hex',
    header: 'x-provider-signature',
    multiSig: providerV1Signatures,
    name: 'timestamped-provider',
    payload: (request, context) => {
      const timestamp = parseProviderSignature(context.signatureHeader).timestamp;
      return `${timestamp}.${payloadToString(request.payload)}`;
    },
    scheme: 'timestamped-provider:v1:hmac-sha256',
    secret: options.secret,
    tolerance: {
      seconds: 300,
      timestamp: (_request, context) => parseProviderSignature(context.signatureHeader).timestamp,
    },
  });
}

function providerV1Signatures(header: string): readonly string[] {
  return parseProviderSignature(header).signatures;
}

function parseProviderSignature(header: string): { signatures: string[]; timestamp: string } {
  const signatures: string[] = [];
  let timestamp = '';

  for (const part of header.split(',')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (key === 't') timestamp = value;
    if (key === 'v1' && value.length > 0) signatures.push(value);
  }

  return { signatures, timestamp };
}

function payloadToString(payload: WebhookPayload): string {
  return typeof payload === 'string' ? payload : new TextDecoder().decode(payload as BufferSource);
}
