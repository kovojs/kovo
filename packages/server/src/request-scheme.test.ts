import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';

import { trustedNodeRequestScheme } from './request-scheme.js';

function nodeRequest(headers: Record<string, string | string[] | undefined>): IncomingMessage {
  return { headers, socket: { encrypted: false } } as unknown as IncomingMessage;
}

describe('trusted request scheme provenance', () => {
  it('does not promote peer-supplied HTTP/2 scheme control data without trusted-proxy posture', () => {
    // SPEC §9.5: adapter-owned socket state remains authoritative absent explicit proxy trust.
    const request = nodeRequest({ ':scheme': 'https' });

    expect(trustedNodeRequestScheme(request)).toBe('http');
    expect(trustedNodeRequestScheme(request, { trustedProxy: true })).toBe('https');
  });

  it('keeps an encrypted transport secure when peer control data spells http', () => {
    const request = nodeRequest({ ':scheme': 'http' });
    (request.socket as { encrypted?: boolean }).encrypted = true;

    expect(trustedNodeRequestScheme(request)).toBe('https');
  });

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

    expect(scheme).toBe('http');
  });

  it('uses the closest trusted proxy value from a comma-joined forwarding chain', () => {
    const request = nodeRequest({ 'x-forwarded-proto': 'http, \t https \t' });

    expect(trustedNodeRequestScheme(request, { trustedProxy: true })).toBe('https');
  });

  it('rejects an invalid closest-hop scheme without falling through to other HTTPS signals', () => {
    for (const value of ['', 'https, ', 'https, ftp', []] as const) {
      const request = nodeRequest({
        ':scheme': 'https',
        'x-forwarded-proto': value,
      });
      (request.socket as { encrypted?: boolean }).encrypted = true;

      expect(() => trustedNodeRequestScheme(request, { trustedProxy: true })).toThrow(
        /must end in http or https|must end in an own string/u,
      );
    }
  });

  it('rejects accessor-backed array entries instead of treating them as transport authority', () => {
    const forwarded: string[] = [];
    Object.defineProperty(forwarded, 0, { get: () => 'https' });

    expect(() =>
      trustedNodeRequestScheme(nodeRequest({ 'x-forwarded-proto': forwarded }), {
        trustedProxy: true,
      }),
    ).toThrow(/own string/);
  });
});
