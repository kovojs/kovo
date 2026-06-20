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
    // B5 fix: tolerance is set and timestampBound is not false, so the timestamp is
    // prepended to the signed bytes: hmacSha256('secret', '1674087231.hello') → new sig.
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
        'x-signature': '78509988eaa146d55bb90115e984b947f415366dffed63fa0aa0907f7b801a0e',
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

  // B5: SPEC §9.1.1:846 — when tolerance is set, the timestamp must be bound into
  // the signed bytes so that a captured (signature, body) cannot be replayed with a
  // different fresh x-timestamp. Without the fix, the same sig + body passes with any
  // fresh timestamp; after the fix, replaying with a different timestamp is rejected.
  it('rejects replay with a forged-fresh timestamp when tolerance is configured (B5)', async () => {
    const verifier = hmacSignature({
      encoding: 'hex',
      header: 'x-signature',
      // body-only payload — does NOT embed the timestamp, the natural default
      payload: ({ payload }) => payload,
      secret: 'replay-test-secret',
      tolerance: {
        header: 'x-timestamp',
        seconds: 300,
      },
    });

    const originalTimestamp = '1700000000';
    // signature over '1700000000.test-body' (timestamp auto-prepended by B5 fix)
    const capturedSignature = 'cf0bf7a18251437c4e0cef93f992afa1f5b63492d999e5813ea445bd0d135670';
    const originalRequest = {
      headers: {
        'x-signature': capturedSignature,
        'x-timestamp': originalTimestamp,
      },
      now: 1700000000 * 1000,
      payload: 'test-body',
    } satisfies WebhookVerificationRequest;

    // Valid request with the correct timestamp → must pass
    await expect(verifier.verify(originalRequest)).resolves.toBe(true);

    // Replay: same (signature, body) but a DIFFERENT fresh timestamp → must be REJECTED.
    // Before the B5 fix the timestamp was not signed and this wrongly passed.
    const replayedWithFreshTimestamp = {
      ...originalRequest,
      headers: {
        'x-signature': capturedSignature,
        'x-timestamp': '1700000100', // fresh-looking, within tolerance window
      },
      now: 1700000100 * 1000,
    };
    await expect(verifier.verify(replayedWithFreshTimestamp)).resolves.toBe(false);
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
    // timestamp is already embedded in the payload above; opt out of automatic
    // timestamp-prefix folding introduced by B5 fix to avoid double-binding.
    timestampBound: false,
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
