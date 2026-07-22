import { createServer, request } from 'node:http';
import { describe, expect, it } from 'vitest';

import { canonicalJsonStringify } from '../json-clone.js';
import {
  decodeFrameworkLiveTargetHeader,
  decodeFrameworkTargetHeader,
  encodeFrameworkLiveTargetHeader,
  encodeFrameworkTargetHeader,
  FRAMEWORK_WIRE_INPUT_GRAMMAR,
  FRAMEWORK_WIRE_INPUT_REGISTRY,
  snapshotFrameworkLiveTargetProps,
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
      maxHeaderCharacters: 6 * 1024,
      schema: 'kovo.wire-input-grammar/v1',
    });

    for (let seed = 1; seed <= 256; seed += 1) {
      const target = seededIdentity(seed);
      const entries = [
        { deps: [`query:${seed}`, `query/${seed + 1}`], target },
        { deps: [], target: `${target}-empty` },
      ];
      const props = {
        nested: { quote: '"', separator: ';', slash: '\\' },
        seed,
      };
      const descriptorInputs = [
        {
          attestation: `token_${seed}`,
          component: `components/card-${seed}`,
          propsSource: JSON.stringify(props),
          target,
        },
        {
          attestation: `token_${seed}_secondary`,
          component: `components/card-${seed}/secondary`,
          propsSource: JSON.stringify({ nested: props, role: 'secondary' }),
          target: `${target}-secondary`,
        },
      ];
      const descriptors = [
        {
          attestation: `token_${seed}`,
          component: `components/card-${seed}`,
          props,
          target,
        },
        {
          attestation: `token_${seed}_secondary`,
          component: `components/card-${seed}/secondary`,
          props: { nested: props, role: 'secondary' },
          target: `${target}-secondary`,
        },
      ];

      expect(decodeFrameworkTargetHeader(encodeFrameworkTargetHeader(entries))).toEqual(entries);
      expect(
        decodeFrameworkLiveTargetHeader(
          encodeFrameworkLiveTargetHeader(descriptorInputs),
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
    expect(decodeFrameworkTargetHeader('x'.repeat(6 * 1024 + 1))).toEqual([]);
    expect(
      decodeFrameworkTargetHeader(
        Array.from({ length: 65 }, (_, index) => `target-${index}`).join(';'),
      ),
    ).toHaveLength(64);

    expect(() => encodeFrameworkTargetHeader([{ deps: ['query;admin'], target: 'safe' }])).toThrow(
      /wire identity/iu,
    );
    expect(() =>
      encodeFrameworkLiveTargetHeader([
        { attestation: 'token', component: 'bad:component', propsSource: '{}', target: 'safe' },
      ]),
    ).toThrow(/component/iu);
  });

  it('rejects identities that can alter framing or cannot enter a browser header', () => {
    const unsafeSuffixes = ['{', '}', '[', ']', '"', '\\', '#', ';', '=', ',', '漢'];
    for (const suffix of unsafeSuffixes) {
      expect(() =>
        encodeFrameworkTargetHeader([
          { deps: ['public'], target: `card${suffix}` },
          { deps: [], target: 'safe-second' },
        ]),
      ).toThrow(/wire identity/iu);
      expect(() =>
        encodeFrameworkTargetHeader([{ deps: [`query${suffix}`], target: 'safe' }]),
      ).toThrow(/dependency wire identity/iu);
      expect(() =>
        encodeFrameworkLiveTargetHeader([
          {
            attestation: 'token',
            component: 'components/card',
            propsSource: '{}',
            target: `card${suffix}`,
          },
          {
            attestation: 'token_second',
            component: 'components/second',
            propsSource: '{}',
            target: 'safe-second',
          },
        ]),
      ).toThrow(/target wire identity/iu);
      expect(() =>
        encodeFrameworkLiveTargetHeader([
          {
            attestation: 'token',
            component: `components/card${suffix}`,
            propsSource: '{}',
            target: 'safe',
          },
        ]),
      ).toThrow(/component wire identity/iu);
      expect(() =>
        encodeFrameworkLiveTargetHeader([
          {
            attestation: `token${suffix}`,
            component: 'components/card',
            propsSource: '{}',
            target: 'safe',
          },
        ]),
      ).toThrow(/attestation wire identity/iu);
    }

    const targets = [
      { deps: ['product:p1', 'catalog/v2'], target: 'card:primary' },
      { deps: ['inventory.current'], target: 'card-secondary' },
    ];
    const descriptors = [
      {
        attestation: 'token_primary',
        component: 'components/cards/primary',
        propsSource: '{"label":"primary"}',
        target: 'card:primary',
      },
      {
        attestation: 'token_secondary',
        component: 'components/cards/secondary',
        propsSource: '{"label":"secondary"}',
        target: 'card-secondary',
      },
    ];
    expect(decodeFrameworkTargetHeader(encodeFrameworkTargetHeader(targets))).toEqual(targets);
    expect(
      decodeFrameworkLiveTargetHeader(encodeFrameworkLiveTargetHeader(descriptors), JSON.parse),
    ).toEqual([
      {
        attestation: 'token_primary',
        component: 'components/cards/primary',
        props: { label: 'primary' },
        target: 'card:primary',
      },
      {
        attestation: 'token_secondary',
        component: 'components/cards/secondary',
        props: { label: 'secondary' },
        target: 'card-secondary',
      },
    ]);
  });

  it('keeps live-target props semantically canonical and transport-header-safe', () => {
    const corpus = [
      '{"z":1,"a":{"z":2,"a":[true,null,"nested"]}}',
      '{"controls":"\\b\\t\\n\\f\\r\\u0000","quote":"\\\"","slash":"\\\\"}',
      '{"pair":"\\ud83d\\ude00","loneHigh":"\\ud800","loneLow":"\\udfff"}',
      '{"exponent":1e+21,"fraction":1.25e-7,"negativeZero":-0}',
      '{"array":[{"z":2,"a":1},[3,2,1]],"semi":"left;right"}',
      '{"toJSON":"data-only","__proto__":{"role":"public"}}',
      '{"lineSeparators":"\u2028\u2029"}',
      '{"delete":"\u007f"}',
      '{"3":683,"013":{"x":1},"a":2}',
      '{"nested":{"10":"ten","2":"two","01":"leading","4294967294":"max","4294967295":"not-index"}}',
      '{"0":"zero","-0":"negative","00":"double","1":"one","4294967294":"max","4294967295":"outside"}',
    ];

    for (const source of corpus) {
      const snapshot = snapshotFrameworkLiveTargetProps(source);
      expect(canonicalJsonStringify(JSON.parse(snapshot))).toBe(
        canonicalJsonStringify(JSON.parse(source)),
      );
      for (let index = 0; index < snapshot.length; index += 1) {
        expect(snapshot.charCodeAt(index)).toBeLessThanOrEqual(0xff);
      }
    }

    const unicode = encodeFrameworkLiveTargetHeader([
      {
        attestation: 'token',
        component: 'components/card',
        propsSource: '{"del":"\u007f","label":"😀 漢字","line":"\u2028\u2029","latin":"café"}',
        target: 'card',
      },
    ]);
    expect(unicode).toBe(
      'card#components/card@token:{"del":"\\u007f","label":"\\ud83d\\ude00 \\u6f22\\u5b57","latin":"café","line":"\\u2028\\u2029"}',
    );
    expect(() => new Headers({ 'Kovo-Live-Targets': unicode })).not.toThrow();
  });

  it('keeps both maximum framework headers inside the default Node transport door', async () => {
    const maximum = FRAMEWORK_WIRE_INPUT_GRAMMAR.maxHeaderCharacters;
    const livePrefix = 'card#components/card@token:';
    const propsPrefix = '{"payload":"';
    const propsSuffix = '"}';
    const liveHeader = encodeFrameworkLiveTargetHeader([
      {
        attestation: 'token',
        component: 'components/card',
        propsSource:
          propsPrefix +
          'x'.repeat(maximum - livePrefix.length - propsPrefix.length - propsSuffix.length) +
          propsSuffix,
        target: 'card',
      },
    ]);
    const targetPrefix = 'card=';
    const targetHeader = encodeFrameworkTargetHeader([
      { deps: ['x'.repeat(maximum - targetPrefix.length)], target: 'card' },
    ]);
    const delHeader = encodeFrameworkLiveTargetHeader([
      {
        attestation: 'token',
        component: 'components/card',
        propsSource: '{"del":"\u007f"}',
        target: 'card',
      },
    ]);
    expect(delHeader).toBe('card#components/card@token:{"del":"\\u007f"}');
    expect(liveHeader).toHaveLength(maximum);
    expect(targetHeader).toHaveLength(maximum);
    expect(() =>
      encodeFrameworkTargetHeader([
        { deps: ['x'.repeat(maximum - targetPrefix.length + 1)], target: 'card' },
      ]),
    ).toThrow(/character budget/iu);

    let handlerHits = 0;
    const server = createServer((_incoming, response) => {
      handlerHits += 1;
      response.statusCode = 204;
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('Node HTTP test server address unavailable');
      }
      const requestStatus = (headers: Readonly<Record<string, string>>): Promise<number> =>
        new Promise((resolve, reject) => {
          const outgoing = request(
            {
              headers,
              host: '127.0.0.1',
              method: 'POST',
              path: '/',
              port: address.port,
            },
            (response) => {
              response.resume();
              response.once('end', () => resolve(response.statusCode ?? 0));
            },
          );
          outgoing.once('error', reject);
          outgoing.end();
        });

      await expect(
        requestStatus({
          'Kovo-Live-Targets': liveHeader,
          'Kovo-Targets': targetHeader,
        }),
      ).resolves.toBe(204);
      expect(handlerHits).toBe(1);

      await expect(
        requestStatus({
          'Kovo-Live-Targets': 'card#components/card@token:{"del":"\u007f"}',
        }),
      ).rejects.toMatchObject({ code: 'ERR_INVALID_CHAR' });
      expect(handlerHits).toBe(1);

      await expect(requestStatus({ 'Kovo-Live-Targets': delHeader })).resolves.toBe(204);
      expect(handlerHits).toBe(2);

      await expect(requestStatus({ 'X-Transport-Control': 'x'.repeat(20 * 1024) })).resolves.toBe(
        431,
      );
      expect(handlerHits).toBe(2);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('matches canonical integer-index ordering across a deterministic adversarial corpus', () => {
    const boundaryKeys = [
      '0',
      '-0',
      '00',
      '01',
      '1',
      '2',
      '3',
      '9',
      '10',
      '99',
      '100',
      '013',
      '4294967293',
      '4294967294',
      '4294967295',
      '4294967296',
      '9007199254740991',
      'a',
      'z',
      'zz',
    ];
    let state = 0x9e37_79b9;
    const next = (): number => {
      state = Math.imul(state ^ (state >>> 16), 0x21f0_aaad) >>> 0;
      state = Math.imul(state ^ (state >>> 15), 0x735a_2d97) >>> 0;
      return (state ^ (state >>> 15)) >>> 0;
    };

    for (let round = 0; round < 128; round += 1) {
      const entries: string[] = [];
      for (let index = 0; index < boundaryKeys.length; index += 1) {
        const key = boundaryKeys[(index + next()) % boundaryKeys.length]!;
        entries.push(
          `${JSON.stringify(key)}:{"round":${round},"nested":{"10":${index},"2":${next()}}}`,
        );
      }
      const source = `{${entries.join(',')}}`;
      expect(snapshotFrameworkLiveTargetProps(source)).toBe(
        canonicalJsonStringify(JSON.parse(source)),
      );
    }
  });

  it('bounds and normalizes invalid, non-record, and whitespace-padded props sources', () => {
    const maximum = FRAMEWORK_WIRE_INPUT_GRAMMAR.maxHeaderCharacters;
    expect(snapshotFrameworkLiveTargetProps(' { "z": 1, "a": [2, 3] } ')).toBe('{"a":[2,3],"z":1}');
    expect(snapshotFrameworkLiveTargetProps('{"message":"left;right"}')).toBe(
      '{"message":"left;right"}',
    );
    expect(snapshotFrameworkLiveTargetProps('{bad')).toBe('{}');
    expect(snapshotFrameworkLiveTargetProps('null')).toBe('{}');
    expect(snapshotFrameworkLiveTargetProps('[]')).toBe('{}');
    expect(snapshotFrameworkLiveTargetProps('418')).toBe('{}');
    expect(snapshotFrameworkLiveTargetProps(' '.repeat(maximum - 2) + '{}')).toBe('{}');
    expect(() => snapshotFrameworkLiveTargetProps(' '.repeat(maximum - 1) + '{}')).toThrow(
      /character wire budget/iu,
    );
  });

  it('does not dispatch inherited JSON callbacks or accept inherited descriptor facts', () => {
    const inheritedToJson = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
    let callbackHits = 0;
    let props = '';
    try {
      Object.defineProperty(Object.prototype, 'toJSON', {
        configurable: true,
        value() {
          callbackHits += 1;
          return { role: 'admin-substituted' };
        },
      });
      props = snapshotFrameworkLiveTargetProps(
        '{"toJSON":"ordinary-data","nested":{"role":"public"}}',
      );
    } finally {
      if (inheritedToJson) {
        Object.defineProperty(Object.prototype, 'toJSON', inheritedToJson);
      } else {
        delete (Object.prototype as { toJSON?: unknown }).toJSON;
      }
    }

    expect(callbackHits).toBe(0);
    expect(props).toBe('{"nested":{"role":"public"},"toJSON":"ordinary-data"}');

    const inherited = Object.create({
      attestation: 'tok_substituted',
      component: 'components/admin',
      propsSource: '{"role":"admin-substituted"}',
      target: 'admin-panel',
    }) as {
      attestation: string;
      component: string;
      propsSource: string;
      target: string;
    };
    expect(() => encodeFrameworkLiveTargetHeader([inherited])).toThrow(/target wire identity/iu);
  });

  it('uses the captured Array receiver after a late global constructor replacement', () => {
    const arrayDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Array');
    if (!arrayDescriptor) throw new Error('Global Array descriptor unavailable');
    let getterHits = 0;
    let props = '';
    let targets = '';
    try {
      Object.defineProperty(globalThis, 'Array', {
        configurable: true,
        get() {
          getterHits += 1;
          throw new Error('late global Array getter ran');
        },
      });
      props = snapshotFrameworkLiveTargetProps('{"3":683,"del":"\u007f","label":"😀 漢字"}');
      targets = encodeFrameworkTargetHeader([{ deps: ['product:p1'], target: 'card:primary' }]);
    } finally {
      Object.defineProperty(globalThis, 'Array', arrayDescriptor);
    }

    expect(getterHits).toBe(0);
    expect(props).toBe('{"3":683,"del":"\\u007f","label":"\\ud83d\\ude00 \\u6f22\\u5b57"}');
    expect(targets).toBe('card:primary=product:p1');
  });

  it('keeps codec acceptance and rejection exact after late intrinsic replacement', () => {
    const targetEntries = [{ deps: ['public', 'catalog'], target: 'public-panel' }];
    const descriptors = [
      {
        attestation: 'token_1',
        component: 'components/public/card',
        propsSource: '{"id":"safe"}',
        target: 'public-panel',
      },
    ];
    const decodedDescriptorExpectation = [
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
      encodedDescriptors = encodeFrameworkLiveTargetHeader(descriptors);
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
        encodeFrameworkLiveTargetHeader([
          {
            attestation: 'token',
            component: 'bad:component',
            propsSource: '{}',
            target: 'safe',
          },
        ]);
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
    expect(decodedDescriptors).toEqual(decodedDescriptorExpectation);
    expect(decodedInvalidTargets).toEqual([]);
    expect(decodedInvalidDescriptors).toEqual([]);
    expect(invalidTargetRejected).toBe(true);
    expect(invalidDescriptorRejected).toBe(true);
  });
});
