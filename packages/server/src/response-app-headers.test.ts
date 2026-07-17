import { describe, expect, it } from 'vitest';

import {
  assertAllowedAppResponseHeaders,
  createAppResponseHeaderClassifier,
  type AppResponseHeaderName,
} from './response-app-headers.js';

const allowedNames = ['cache-control', 'last-modified', 'vary'] as const;
type MissingAppResponseHeaderName = Exclude<
  Lowercase<AppResponseHeaderName>,
  (typeof allowedNames)[number]
>;
const missingAppResponseHeaderName: MissingAppResponseHeaderName extends never ? true : never =
  true;
void missingAppResponseHeaderName;

const classify = createAppResponseHeaderClassifier({
  lowerCase: (value) => value.toLowerCase(),
});

describe('structured app response-header classifier', () => {
  // @kovo-security-classifier-corpus structured-app-response-headers
  it('keeps the exact runtime allowlist aligned with the public type-level set', () => {
    for (const name of allowedNames) {
      expect(classify([{ name, value: 'safe' }])).toBeUndefined();
      expect(classify([{ name: name.toUpperCase(), value: 'safe' }])).toBeUndefined();
    }

    for (const name of [
      'Access-Control-Allow-Origin',
      'Content-Disposition',
      'Content-Type',
      'ETag',
      'Kovo-Build',
      'Location',
      'Set-Cookie',
      'X-Accel-Redirect',
    ]) {
      expect(classify([{ name, value: 'attacker-controlled' }])).toMatchObject({
        headerName: name,
      });
    }
  });

  it('fails a whole dynamic bag when any name falls outside the direct allowlist', () => {
    expect(() =>
      assertAllowedAppResponseHeaders(
        [
          { name: 'Cache-Control', value: 'private, no-store' },
          { name: 'X-Accel-Redirect', value: '/internal/admin' },
          { name: 'Vary', value: 'Cookie' },
        ],
        classify,
      ),
    ).toThrow(/KV415.*X-Accel-Redirect.*outside the direct allowlist/u);
  });

  it('routes dedicated response fields to their structured APIs', () => {
    expect(() =>
      assertAllowedAppResponseHeaders([{ name: 'Content-Type', value: 'text/html' }], classify),
    ).toThrow(/KV415.*contentType option/u);
    expect(() =>
      assertAllowedAppResponseHeaders([{ name: 'ETag', value: 'weak' }], classify),
    ).toThrow(/KV415.*etag option/u);
    expect(() =>
      assertAllowedAppResponseHeaders([{ name: 'Content-Disposition', value: 'inline' }], classify),
    ).toThrow(/KV415.*filename\/disposition options/u);
    expect(() =>
      assertAllowedAppResponseHeaders([{ name: 'Location', value: '/admin' }], classify),
    ).toThrow(/KV415.*redirect\(\)/u);
    expect(() =>
      assertAllowedAppResponseHeaders([{ name: 'Set-Cookie', value: 'sid=x' }], classify),
    ).toThrow(/KV415.*typed mutation cookie builder/u);
  });
});
