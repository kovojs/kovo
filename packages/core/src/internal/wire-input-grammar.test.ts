import { describe, expect, it } from 'vitest';

import {
  decodeFrameworkLiveTargetHeader,
  decodeFrameworkTargetHeader,
  encodeFrameworkLiveTargetHeader,
  encodeFrameworkTargetHeader,
  FRAMEWORK_WIRE_INPUT_GRAMMAR,
} from './wire-input-grammar.js';

function seededIdentity(seed: number): string {
  let state = seed >>> 0;
  let value = `target:${seed}`;
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-/.';
  for (let index = 0; index < 12; index += 1) {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
    value += alphabet[state % alphabet.length];
  }
  return value;
}

describe('framework wire-input grammar registry (SPEC §9.1)', () => {
  // @kovo-security-certifies C13 wire-input-grammar-round-trip
  it('derives target encoders and decoders from one finite grammar with seeded round trips', () => {
    expect(FRAMEWORK_WIRE_INPUT_GRAMMAR).toMatchObject({
      maxEntries: 64,
      maxHeaderCharacters: 64 * 1024,
      schema: 'kovo.wire-input-grammar/v1',
    });

    for (let seed = 1; seed <= 256; seed += 1) {
      const target = seededIdentity(seed);
      const entries = [
        { deps: [`query:${seed}`, `query/${seed + 1}`], target },
        { deps: [], target: `${target}-empty` },
      ];
      const descriptors = [
        {
          attestation: `token_${seed}`,
          component: `components/card-${seed}`,
          props: {
            nested: { quote: '"', separator: ';', slash: '\\' },
            seed,
          },
          target,
        },
      ];

      expect(decodeFrameworkTargetHeader(encodeFrameworkTargetHeader(entries))).toEqual(entries);
      expect(
        decodeFrameworkLiveTargetHeader(
          encodeFrameworkLiveTargetHeader(descriptors, JSON.stringify),
          JSON.parse,
        ),
      ).toEqual(descriptors);
    }
  });

  it('fails closed on delimiter injection, malformed JSON, oversized input, and excess entries', () => {
    expect(decodeFrameworkTargetHeader('safe=one; injected target=two')).toEqual([
      { deps: ['one'], target: 'safe' },
    ]);
    expect(decodeFrameworkLiveTargetHeader('safe#component@token:{bad', JSON.parse)).toEqual([]);
    expect(decodeFrameworkTargetHeader('x'.repeat(64 * 1024 + 1))).toEqual([]);
    expect(
      decodeFrameworkTargetHeader(
        Array.from({ length: 65 }, (_, index) => `target-${index}`).join(';'),
      ),
    ).toHaveLength(64);

    expect(() => encodeFrameworkTargetHeader([{ deps: ['query;admin'], target: 'safe' }])).toThrow(
      /wire identity/iu,
    );
    expect(() =>
      encodeFrameworkLiveTargetHeader(
        [{ attestation: 'token', component: 'bad:component', props: {}, target: 'safe' }],
        JSON.stringify,
      ),
    ).toThrow(/component/iu);
  });
});
