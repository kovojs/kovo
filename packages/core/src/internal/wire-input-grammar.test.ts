import { describe, expect, it } from 'vitest';

import {
  decodeFrameworkLiveTargetHeader,
  decodeFrameworkTargetHeader,
  encodeFrameworkLiveTargetHeader,
  encodeFrameworkTargetHeader,
  FRAMEWORK_WIRE_INPUT_GRAMMAR,
  FRAMEWORK_WIRE_INPUT_REGISTRY,
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
  // @kovo-security-certifies C13 cache-influence-wire-input-vocabulary
  it('closes cache-influence credential and response-header observations', () => {
    expect(FRAMEWORK_WIRE_INPUT_REGISTRY.inputs).toEqual(
      expect.arrayContaining([
        {
          carrier: 'request-header',
          grammar: 'http-field-value',
          id: 'request-header.authorization',
          name: 'authorization',
        },
        {
          carrier: 'response-header',
          grammar: 'http-field-value',
          id: 'response-header.cache-control',
          name: 'cache-control',
        },
        {
          carrier: 'response-header',
          grammar: 'content-disposition',
          id: 'response-header.content-disposition',
          name: 'content-disposition',
        },
        {
          carrier: 'response-header',
          grammar: 'http-field-value',
          id: 'response-header.vary',
          name: 'vary',
        },
      ]),
    );
  });

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

  it('keeps codec acceptance and rejection exact after late intrinsic replacement', () => {
    const targetEntries = [{ deps: ['public', 'catalog'], target: 'public-panel' }];
    const descriptors = [
      {
        attestation: 'token_1',
        component: 'components/public/card',
        props: { id: 'safe' },
        target: 'public-panel',
      },
    ];
    const targetHeader = ' public-panel=public catalog ';
    const descriptorHeader = ' public-panel#components/public/card@token_1:{"id":"safe"} ';
    const parseJson = JSON.parse;
    const stringifyJson = JSON.stringify;
    const originalApply = Reflect.apply;
    const originalArrayIsArray = Array.isArray;
    const originalArrayJoin = Array.prototype.join;
    const originalArrayPush = Array.prototype.push;
    const originalRegExpTest = RegExp.prototype.test;
    const originalCharCodeAt = String.prototype.charCodeAt;
    const originalIncludes = String.prototype.includes;
    const originalIndexOf = String.prototype.indexOf;
    const originalLastIndexOf = String.prototype.lastIndexOf;
    const originalSlice = String.prototype.slice;
    const originalTrim = String.prototype.trim;
    let encodedTargets = '';
    let encodedDescriptors = '';
    let decodedTargets: ReturnType<typeof decodeFrameworkTargetHeader> = [];
    let decodedDescriptors: ReturnType<typeof decodeFrameworkLiveTargetHeader> = [];
    let decodedInvalidTargets: ReturnType<typeof decodeFrameworkTargetHeader> = [];
    let decodedInvalidDescriptors: ReturnType<typeof decodeFrameworkLiveTargetHeader> = [];
    let invalidTargetRejected = false;
    let invalidDescriptorRejected = false;

    try {
      Reflect.apply = (() => {
        throw new Error('late Reflect.apply replacement ran');
      }) as typeof Reflect.apply;
      Array.isArray = (() => true) as typeof Array.isArray;
      Array.prototype.join = () => 'admin';
      Array.prototype.push = function () {
        return this.length;
      };
      RegExp.prototype.test = () => true;
      String.prototype.charCodeAt = () => 0;
      String.prototype.includes = () => true;
      String.prototype.indexOf = () => -1;
      String.prototype.lastIndexOf = () => -1;
      String.prototype.slice = () => 'admin';
      String.prototype.trim = () => 'admin';

      encodedTargets = encodeFrameworkTargetHeader(targetEntries);
      encodedDescriptors = encodeFrameworkLiveTargetHeader(descriptors, stringifyJson);
      decodedTargets = decodeFrameworkTargetHeader(targetHeader);
      decodedDescriptors = decodeFrameworkLiveTargetHeader(descriptorHeader, parseJson);
      decodedInvalidTargets = decodeFrameworkTargetHeader('bad\u0000target=admin');
      decodedInvalidDescriptors = decodeFrameworkLiveTargetHeader(
        'safe#bad component@token:{}',
        parseJson,
      );
      try {
        encodeFrameworkTargetHeader([{ deps: ['query;admin'], target: 'safe' }]);
      } catch {
        invalidTargetRejected = true;
      }
      try {
        encodeFrameworkLiveTargetHeader(
          [{ attestation: 'token', component: 'bad:component', props: {}, target: 'safe' }],
          stringifyJson,
        );
      } catch {
        invalidDescriptorRejected = true;
      }
    } finally {
      String.prototype.trim = originalTrim;
      String.prototype.slice = originalSlice;
      String.prototype.lastIndexOf = originalLastIndexOf;
      String.prototype.indexOf = originalIndexOf;
      String.prototype.includes = originalIncludes;
      String.prototype.charCodeAt = originalCharCodeAt;
      RegExp.prototype.test = originalRegExpTest;
      Array.prototype.push = originalArrayPush;
      Array.prototype.join = originalArrayJoin;
      Array.isArray = originalArrayIsArray;
      Reflect.apply = originalApply;
    }

    expect(encodedTargets).toBe('public-panel=public catalog');
    expect(encodedDescriptors).toBe('public-panel#components/public/card@token_1:{"id":"safe"}');
    expect(decodedTargets).toEqual(targetEntries);
    expect(decodedDescriptors).toEqual(descriptors);
    expect(decodedInvalidTargets).toEqual([]);
    expect(decodedInvalidDescriptors).toEqual([]);
    expect(invalidTargetRejected).toBe(true);
    expect(invalidDescriptorRejected).toBe(true);
  });
});
