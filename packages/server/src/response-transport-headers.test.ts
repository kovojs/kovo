import { describe, expect, it } from 'vitest';

import {
  type BrowserNavigationResponseHeaderName,
  createTransportResponseHeaderClassifier,
  type TransportOwnedResponseHeaderName,
} from './response-transport-headers.js';

// @kovo-security-classifier-corpus response-transport-headers
const transportOwnedResponseHeaderNames = [
  'connection',
  'content-length',
  'http2-settings',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
] as const satisfies readonly TransportOwnedResponseHeaderName[];

type MissingTransportOwnedResponseHeaderName = Exclude<
  TransportOwnedResponseHeaderName,
  (typeof transportOwnedResponseHeaderNames)[number]
>;
const exactTypeSet: MissingTransportOwnedResponseHeaderName extends never ? true : never = true;

const browserNavigationResponseHeaderNames = [
  'refresh',
] as const satisfies readonly BrowserNavigationResponseHeaderName[];

type MissingBrowserNavigationResponseHeaderName = Exclude<
  BrowserNavigationResponseHeaderName,
  (typeof browserNavigationResponseHeaderNames)[number]
>;
const exactBrowserNavigationTypeSet: MissingBrowserNavigationResponseHeaderName extends never
  ? true
  : never = true;

const classify = createTransportResponseHeaderClassifier({
  lowerCase: (value) => value.toLowerCase(),
});

describe('response transport-header classifier', () => {
  it('keeps the runtime rejection set aligned with the exhaustive type-level set', () => {
    expect(exactTypeSet).toBe(true);
    for (const name of transportOwnedResponseHeaderNames) {
      expect(classify([{ name, value: 'attacker-controlled' }])).toMatchObject({
        headerName: name,
      });
      expect(classify([{ name: name.toUpperCase(), value: 'attacker-controlled' }])).toBeDefined();
    }
  });

  it.each([
    ['Refresh', '0;url=https://attacker.example/phish'],
    ['rEfReSh', ' 0 ; url = https://attacker.example/phish '],
    ['REFRESH', '5'],
    ['refresh', '5; URL=/account'],
    ['Refresh', '0; url=//attacker.example/phish'],
  ])('rejects browser-navigation header %s independently of value %s', (name, value) => {
    expect(exactBrowserNavigationTypeSet).toBe(true);
    expect(classify([{ name, value }])).toMatchObject({
      headerName: name,
      kind: 'browser-navigation',
    });
  });

  it('leaves legitimate end-to-end names open while rejecting Connection wholesale', () => {
    expect(
      classify([
        { name: 'Cache-Control', value: 'public, max-age=60' },
        { name: 'X-Connection-Nominated-Looking', value: 'safe without Connection' },
      ]),
    ).toBeUndefined();
    expect(
      classify([
        { name: 'Connection', value: 'X-Connection-Nominated-Looking' },
        { name: 'X-Connection-Nominated-Looking', value: 'unreachable' },
      ]),
    ).toMatchObject({ headerName: 'Connection', kind: 'hop-by-hop' });
  });
});
