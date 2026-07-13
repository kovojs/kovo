import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';

import { trustedNodeRequestScheme } from './request-scheme.js';

function nodeRequest(headers: Record<string, string | string[] | undefined>): IncomingMessage {
  return { headers, socket: { encrypted: false } } as unknown as IncomingMessage;
}

describe('trusted request scheme provenance', () => {
  it('keeps trusted proxy header authority under late Array.isArray poison', () => {
    const request = nodeRequest({ 'x-forwarded-proto': ['https', 'http'] });
    const originalIsArray = Array.isArray;
    let scheme: ReturnType<typeof trustedNodeRequestScheme> | undefined;
    try {
      Array.isArray = () => false;
      scheme = trustedNodeRequestScheme(request, { trustedProxy: true });
    } finally {
      Array.isArray = originalIsArray;
    }

    expect(scheme).toBe('https');
  });

  it('rejects accessor-backed array entries instead of treating them as transport authority', () => {
    const forwarded: string[] = [];
    Object.defineProperty(forwarded, 0, { get: () => 'https' });

    expect(() =>
      trustedNodeRequestScheme(nodeRequest({ 'x-forwarded-proto': forwarded }), {
        trustedProxy: true,
      }),
    ).toThrow(/stable own strings/);
  });
});
