import { createServer, request } from 'node:http';
import { describe, expect, it } from 'vitest';

import { canonicalJsonStringify } from '../json-clone.js';
import {
  canonicalQueryInstanceKeyValue,
  decodeFrameworkFormTargetHeader,
  decodeFrameworkIdentityToken,
  decodeFrameworkQueryDependencyToken,
  decodeFrameworkLiveTargetHeader,
  decodeFrameworkTargetHeader,
  encodeFrameworkFormTargetHeader,
  encodeFrameworkIdentityToken,
  encodeFrameworkQueryDependencyToken,
  encodeFrameworkLiveTargetHeader,
  encodeFrameworkTargetHeader,
  encodeFrameworkWireEntryList,
  FRAMEWORK_WIRE_INPUT_GRAMMAR,
  FRAMEWORK_WIRE_INPUT_REGISTRY,
  frameworkDomIdentityIsValid,
  planFrameworkTargetRequestHeaders,
  snapshotFrameworkLiveTargetProps,
  type FrameworkQueryDependencyIdentity,
} from './wire-input-grammar.js';

function dep(name: string, key?: string): FrameworkQueryDependencyIdentity {
  return key === undefined ? { name } : { key, name };
}

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

describe('canonical query-instance key codec (SPEC §9.4/§10.2)', () => {
  it('uses declared field order and keeps empty and optional args canonical', () => {
    expect(canonicalQueryInstanceKeyValue([], {})).toBe('');

    const declared = ['org', 'id', 'cursor'] as const;
    const declaredOrder = canonicalQueryInstanceKeyValue(declared, {
      org: 'o1',
      id: 'p1',
    });
    const reversedInsertionOrder = canonicalQueryInstanceKeyValue(declared, {
      id: 'p1',
      org: 'o1',
    });
    expect(reversedInsertionOrder).toBe(declaredOrder);
    expect(
      canonicalQueryInstanceKeyValue(declared, {
        cursor: 'p1',
        org: 'o1',
      }),
    ).not.toBe(declaredOrder);
    expect(
      canonicalQueryInstanceKeyValue(declared, {
        cursor: undefined,
        id: 'p1',
        org: 'o1',
      }),
    ).toBe(declaredOrder);
  });

  it('frames delimiters, scalar types, and dense scalar arrays without collisions', () => {
    const fields = ['left', 'right'] as const;
    expect(canonicalQueryInstanceKeyValue(fields, { left: 'x:y', right: 'z' })).not.toBe(
      canonicalQueryInstanceKeyValue(fields, { left: 'x', right: 'y:z' }),
    );
    expect(canonicalQueryInstanceKeyValue(['value'], { value: '1' })).not.toBe(
      canonicalQueryInstanceKeyValue(['value'], { value: 1 }),
    );
    expect(canonicalQueryInstanceKeyValue(['value'], { value: 1 })).not.toBe(
      canonicalQueryInstanceKeyValue(['value'], { value: true }),
    );
    expect(canonicalQueryInstanceKeyValue(['values'], { values: ['x:y', 1, false] })).not.toBe(
      canonicalQueryInstanceKeyValue(['values'], { values: ['x', 'y:1', false] }),
    );
    expect(canonicalQueryInstanceKeyValue(['values'], { values: [] })).not.toBe(
      canonicalQueryInstanceKeyValue([], {}),
    );
  });

  it('fails closed on undeclared, non-scalar, sparse, and non-finite values', () => {
    expect(() => canonicalQueryInstanceKeyValue(['id'], { id: 'p1', extra: true })).toThrow(
      /undeclared field/iu,
    );
    expect(() => canonicalQueryInstanceKeyValue(['id'], { id: { nested: true } })).toThrow(
      /explicit instanceKey/iu,
    );
    expect(() => canonicalQueryInstanceKeyValue(['id'], { id: Number.NaN })).toThrow(
      /finite scalar/iu,
    );
    const sparse = new Array(2);
    sparse[1] = 'p1';
    expect(() => canonicalQueryInstanceKeyValue(['ids'], { ids: sparse })).toThrow(
      /dense scalar array/iu,
    );
  });
});

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
      maxCurrentUrlCharacters: 1536,
      maxHeaderCharacters: 4 * 1024,
      maxTargetRequestHeaderBytes: 9 * 1024,
      schema: 'kovo.wire-input-grammar/v4',
    });

    for (let seed = 1; seed <= 256; seed += 1) {
      const target = seededIdentity(seed);
      const entries = [
        { deps: [dep(`query:${seed}`), dep(`query/${seed + 1}`)], target },
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
    expect(decodeFrameworkTargetHeader('safe=one; injected target=two')).toEqual([]);
    expect(decodeFrameworkLiveTargetHeader('safe#component@token:{bad', JSON.parse)).toEqual([]);
    expect(decodeFrameworkTargetHeader('x'.repeat(4 * 1024 + 1))).toEqual([]);
    expect(
      decodeFrameworkTargetHeader(
        Array.from({ length: 65 }, (_, index) => `target-${index}`).join(';'),
      ),
    ).toHaveLength(0);

    expect(
      decodeFrameworkTargetHeader(
        encodeFrameworkTargetHeader([{ deps: [dep('query;admin')], target: 'safe' }]),
      ),
    ).toEqual([{ deps: [dep('query;admin')], target: 'safe' }]);
    expect(() =>
      encodeFrameworkLiveTargetHeader([
        { attestation: 'bad:token', component: 'component', propsSource: '{}', target: 'safe' },
      ]),
    ).toThrow(/attestation/iu);

    const max = FRAMEWORK_WIRE_INPUT_GRAMMAR.maxHeaderCharacters;
    expect(encodeFrameworkWireEntryList(['x'.repeat(max)])).toBe('x'.repeat(max));
    expect(encodeFrameworkWireEntryList(['safe', 'x'.repeat(max)])).toBe('');
    expect(
      encodeFrameworkTargetHeader([
        { deps: [], target: 'safe' },
        { deps: [], target: 'x'.repeat(max) },
      ]),
    ).toBe('');
  });

  it('keeps target and dependency encoder/decoder domains finite, unique, and atomic', () => {
    const excessiveDependencies = Array.from(
      { length: FRAMEWORK_WIRE_INPUT_GRAMMAR.maxEntries + 1 },
      (_, index) => dep(`q${index}`),
    );
    const excessiveDependencyWire = `safe=${excessiveDependencies
      .map(({ name }) => name)
      .join(' ')}`;

    expect(() =>
      encodeFrameworkTargetHeader([{ deps: excessiveDependencies, target: 'safe' }]),
    ).toThrow(/dependency list exceeds/iu);
    expect(decodeFrameworkTargetHeader(excessiveDependencyWire)).toEqual([]);

    expect(() =>
      encodeFrameworkTargetHeader([{ deps: [dep('catalog'), dep('catalog')], target: 'safe' }]),
    ).toThrow(/duplicate dependency/iu);
    expect(decodeFrameworkTargetHeader('safe=catalog catalog')).toEqual([]);

    expect(() =>
      encodeFrameworkTargetHeader([
        { deps: [dep('catalog', 'featured'), dep('catalog', 'featured')], target: 'safe' },
      ]),
    ).toThrow(/duplicate dependency/iu);
    expect(decodeFrameworkTargetHeader('safe=!catalog!featured !catalog!featured')).toEqual([]);

    const keyedAndUnkeyed = [
      { deps: [dep('catalog'), dep('catalog', 'featured')], target: 'safe' },
    ];
    expect(encodeFrameworkTargetHeader(keyedAndUnkeyed)).toBe('safe=catalog !catalog!featured');
    expect(decodeFrameworkTargetHeader('safe=catalog !catalog!featured')).toEqual(keyedAndUnkeyed);

    expect(() =>
      encodeFrameworkTargetHeader([
        { deps: [], target: 'safe' },
        { deps: [dep('catalog')], target: 'safe' },
      ]),
    ).toThrow(/duplicate target/iu);
    expect(decodeFrameworkTargetHeader('safe; safe=catalog')).toEqual([]);

    const liveTarget = {
      attestation: 'token',
      component: 'components/card',
      propsSource: '{}',
      target: 'safe',
    };
    expect(() => encodeFrameworkLiveTargetHeader([liveTarget, liveTarget])).toThrow(
      /duplicate target/iu,
    );
    expect(
      decodeFrameworkLiveTargetHeader(
        'safe#components%2Fcard@token:{}; safe#components%2Fcard@token:{}',
        JSON.parse,
      ),
    ).toEqual([]);
  });

  it('canonically tokenizes every wire-stable semantic identity and rejects malformed tokens', () => {
    expect(frameworkDomIdentityIsValid('')).toBe(true);
    expect(encodeFrameworkIdentityToken('')).toBeUndefined();
    const identities = [
      'plain-target',
      'braces{}[] "quotes" \\',
      'punctuation;#@=/%',
      ' leading and trailing ',
      'product:crème brûlée',
      '漢字',
      'emoji-😀',
      'delete-\u007f',
      'line\nfeed',
      'é',
      'e\u0301',
    ];
    for (const identity of identities) {
      const token = encodeFrameworkIdentityToken(identity);
      expect(token).toBeTypeOf('string');
      expect(decodeFrameworkIdentityToken(token)).toBe(identity);
      expect(decodeFrameworkFormTargetHeader(encodeFrameworkFormTargetHeader(identity))).toBe(
        identity,
      );
      expect(() => new Headers({ 'Kovo-Form-Target': token! })).not.toThrow();

      const targets = [{ deps: [dep(identity)], target: identity }];
      expect(decodeFrameworkTargetHeader(encodeFrameworkTargetHeader(targets))).toEqual(targets);
      expect(
        decodeFrameworkLiveTargetHeader(
          encodeFrameworkLiveTargetHeader([
            {
              attestation: 'token_safe',
              component: `component/${identity}`,
              propsSource: '{}',
              target: identity,
            },
          ]),
          JSON.parse,
        ),
      ).toEqual([
        {
          attestation: 'token_safe',
          component: `component/${identity}`,
          props: {},
          target: identity,
        },
      ]);
    }

    for (const invalidIdentity of ['nul\0target', 'carriage\rreturn', '\ud800', '\udc00']) {
      expect(encodeFrameworkIdentityToken(invalidIdentity)).toBeUndefined();
      expect(encodeFrameworkFormTargetHeader(invalidIdentity)).toBeUndefined();
    }
    for (const malformed of [
      '%',
      '%2f',
      '%C0%AF',
      '%ED%A0%80',
      '%00',
      '%0D',
      'raw:colon',
      'raw space',
    ]) {
      expect(decodeFrameworkIdentityToken(malformed)).toBeUndefined();
      expect(decodeFrameworkFormTargetHeader(malformed)).toBeUndefined();
    }

    const longIdentity = `product:${'漢'.repeat(5_000)}`;
    const longToken = encodeFrameworkIdentityToken(longIdentity)!;
    expect(longToken.length).toBeGreaterThan(FRAMEWORK_WIRE_INPUT_GRAMMAR.maxHeaderCharacters);
    expect(decodeFrameworkIdentityToken(longToken)).toBe(longIdentity);
    expect(encodeFrameworkFormTargetHeader(longIdentity)).toBeUndefined();
    expect(encodeFrameworkTargetHeader([{ deps: [dep(longIdentity)], target: 'card' }])).toBe('');
  });

  it('frames keyed DOM dependencies without aliasing unkeyed query names', () => {
    expect(encodeFrameworkQueryDependencyToken('bar')).toBe('bar');
    expect(encodeFrameworkQueryDependencyToken('foo', 'bar')).toBe('!foo!bar');
    expect(encodeFrameworkQueryDependencyToken('!foo!bar')).toBe('%21foo%21bar');
    expect(decodeFrameworkQueryDependencyToken('bar')).toEqual({ name: 'bar' });
    expect(decodeFrameworkQueryDependencyToken('!foo!bar')).toEqual({ key: 'bar', name: 'foo' });
    expect(decodeFrameworkQueryDependencyToken('%21foo%21bar')).toEqual({ name: '!foo!bar' });
    expect(encodeFrameworkQueryDependencyToken('product', 'product:p1')).toBe(
      '!product!product%3Ap1',
    );
    for (const malformed of ['!', '!!bar', '!foo!', '!foo!bar!tail', '!foo!bar%3atail']) {
      expect(decodeFrameworkQueryDependencyToken(malformed)).toBeUndefined();
    }
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
      'card#components%2Fcard@token:{"del":"\\u007f","label":"\\ud83d\\ude00 \\u6f22\\u5b57","latin":"caf\\u00e9","line":"\\u2028\\u2029"}',
    );
    expect(() => new Headers({ 'Kovo-Live-Targets': unicode })).not.toThrow();
  });

  it('plans exact aggregate header lines, freezes snapshots, and rejects required overflow', () => {
    const lineBytes = (name: string, value: string): number => name.length + 2 + value.length + 2;
    const totalLineBytes = (headers: Readonly<Record<string, string>>): number => {
      let total = 0;
      for (const name of Object.keys(headers)) total += lineBytes(name, headers[name]!);
      return total;
    };
    const build = '0123456789abcdef';
    const idem = 'v1_1750000000000_000102030405060708090a0b0c0d0e0f';
    const currentPrefix = 'https://kovo.test/';
    const currentUrl =
      currentPrefix +
      'a'.repeat(FRAMEWORK_WIRE_INPUT_GRAMMAR.maxCurrentUrlCharacters - currentPrefix.length);
    const formTarget = ' form:#@=/% 漢字\n';
    const encodedFormTarget = encodeFrameworkFormTargetHeader(formTarget)!;
    const targetPrefix = 'card=';
    const targetWireEntry = encodeFrameworkTargetHeader([
      {
        deps: [
          dep('x'.repeat(FRAMEWORK_WIRE_INPUT_GRAMMAR.maxHeaderCharacters - targetPrefix.length)),
        ],
        target: 'card',
      },
    ]);
    expect(targetWireEntry).toHaveLength(FRAMEWORK_WIRE_INPUT_GRAMMAR.maxHeaderCharacters);
    const fixedBytes =
      lineBytes('Kovo-Fragment', 'true') +
      lineBytes('Kovo-Build', build) +
      lineBytes('Kovo-Idem', idem) +
      lineBytes('Kovo-Current-Url', currentUrl) +
      lineBytes('Kovo-Form-Target', encodedFormTarget) +
      lineBytes('Kovo-Targets', targetWireEntry);
    const liveValueCharacters =
      FRAMEWORK_WIRE_INPUT_GRAMMAR.maxTargetRequestHeaderBytes -
      fixedBytes -
      lineBytes('Kovo-Live-Targets', '');
    const emptyLive = encodeFrameworkLiveTargetHeader([
      {
        attestation: 'token',
        component: 'components/card',
        propsSource: '{"payload":""}',
        target: 'card',
      },
    ]);
    const liveWireEntry = encodeFrameworkLiveTargetHeader([
      {
        attestation: 'token',
        component: 'components/card',
        propsSource: `{"payload":"${'x'.repeat(liveValueCharacters - emptyLive.length)}"}`,
        target: 'card',
      },
    ]);
    expect(liveWireEntry).toHaveLength(liveValueCharacters);

    const targetSnapshot = { target: 'card', wireEntry: targetWireEntry };
    const liveSnapshot = { target: 'card', wireEntry: liveWireEntry };
    const plan = planFrameworkTargetRequestHeaders({
      build,
      currentUrl,
      formTarget,
      idem,
      liveTargets: [liveSnapshot],
      targets: [targetSnapshot],
    });
    expect(plan).toBeDefined();
    expect(totalLineBytes(plan!.headers)).toBe(
      FRAMEWORK_WIRE_INPUT_GRAMMAR.maxTargetRequestHeaderBytes,
    );
    expect(Object.getPrototypeOf(plan!.headers)).toBeNull();
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan!.headers)).toBe(true);
    expect(Object.isFrozen(plan!.targets)).toBe(true);
    expect(Object.isFrozen(plan!.targets[0])).toBe(true);
    targetSnapshot.target = 'attacker';
    expect(plan!.targets[0]).toEqual({ target: 'card', wireEntry: targetWireEntry });

    const empty = planFrameworkTargetRequestHeaders({
      build,
      currentUrl: 'https://kovo.test/',
      idem,
      liveTargets: [],
      targets: [],
    });
    expect(empty?.headers).toEqual({
      'Kovo-Build': build,
      'Kovo-Current-Url': 'https://kovo.test/',
      'Kovo-Fragment': 'true',
      'Kovo-Idem': idem,
    });
    expect(Object.hasOwn(empty!.headers, 'Kovo-Targets')).toBe(false);
    expect(Object.hasOwn(empty!.headers, 'Kovo-Live-Targets')).toBe(false);

    const exactTarget = encodeFrameworkTargetHeader([
      { deps: [dep('x'.repeat(4_091))], target: 'card' },
    ]);
    expect(exactTarget).toHaveLength(FRAMEWORK_WIRE_INPUT_GRAMMAR.maxHeaderCharacters);
    const exactCurrentUrl = `https://kovo.test/${'x'.repeat(
      FRAMEWORK_WIRE_INPUT_GRAMMAR.maxCurrentUrlCharacters - 'https://kovo.test/'.length,
    )}`;
    const exactFormTarget = 'f'.repeat(3_477);
    const exactPlan = planFrameworkTargetRequestHeaders({
      build,
      currentUrl: exactCurrentUrl,
      formTarget: exactFormTarget,
      liveTargets: [],
      targets: [{ target: 'card', wireEntry: exactTarget }],
    });
    expect(exactPlan).toBeDefined();
    expect(totalLineBytes(exactPlan!.headers)).toBe(
      FRAMEWORK_WIRE_INPUT_GRAMMAR.maxTargetRequestHeaderBytes,
    );
    expect(exactPlan!.headers).not.toHaveProperty('Kovo-Live-Targets');

    expect(
      planFrameworkTargetRequestHeaders({
        build,
        currentUrl: `https://kovo.test/${'x'.repeat(1536)}`,
        idem,
        liveTargets: [],
        targets: [],
      }),
    ).toBeUndefined();
    expect(
      planFrameworkTargetRequestHeaders({
        build,
        currentUrl: 'https://kovo.test/',
        formTarget: 'x'.repeat(4097),
        idem,
        liveTargets: [],
        targets: [],
      }),
    ).toBeUndefined();
    expect(
      planFrameworkTargetRequestHeaders({
        build,
        currentUrl: 'https://kovo.test/',
        idem,
        liveTargets: [],
        targets: [{ target: 'safe', wireEntry: 'safe=public;admin=secret' }],
      }),
    ).toBeUndefined();
  });

  it('keeps both maximum framework headers and a maximum cookie inside Node transport', async () => {
    const maximum = FRAMEWORK_WIRE_INPUT_GRAMMAR.maxHeaderCharacters;
    const targetPrefix = 'card=';
    const delHeader = encodeFrameworkLiveTargetHeader([
      {
        attestation: 'token',
        component: 'components/card',
        propsSource: '{"del":"\u007f"}',
        target: 'card',
      },
    ]);
    expect(delHeader).toBe('card#components%2Fcard@token:{"del":"\\u007f"}');
    expect(
      encodeFrameworkTargetHeader([
        { deps: [dep('x'.repeat(maximum - targetPrefix.length + 1))], target: 'card' },
      ]),
    ).toBe('');

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
      const currentUrlPrefix = `http://127.0.0.1:${address.port}/catalog?page=`;
      const currentUrl =
        currentUrlPrefix +
        'x'.repeat(FRAMEWORK_WIRE_INPUT_GRAMMAR.maxCurrentUrlCharacters - currentUrlPrefix.length);
      const csrfCookiePrefix = '__Host-kovo_csrf=';
      const cookie = csrfCookiePrefix + 'x'.repeat(4_096 - csrfCookiePrefix.length);
      expect(cookie).toHaveLength(4_096);
      const formTarget = 'catalog-panel';
      const build = '0123456789abcdef';
      const idem = 'v1_1750000000000_000102030405060708090a0b0c0d0e0f';
      const targetWireEntry = encodeFrameworkTargetHeader([
        { deps: [dep('x'.repeat(maximum - targetPrefix.length))], target: 'card' },
      ]);
      const encodedFormTarget = encodeFrameworkFormTargetHeader(formTarget)!;
      const lineBytes = (name: string, value: string): number => name.length + 2 + value.length + 2;
      const fixedBytes =
        lineBytes('Kovo-Fragment', 'true') +
        lineBytes('Kovo-Build', build) +
        lineBytes('Kovo-Idem', idem) +
        lineBytes('Kovo-Current-Url', currentUrl) +
        lineBytes('Kovo-Form-Target', encodedFormTarget) +
        lineBytes('Kovo-Targets', targetWireEntry);
      const liveValueCharacters =
        FRAMEWORK_WIRE_INPUT_GRAMMAR.maxTargetRequestHeaderBytes -
        fixedBytes -
        lineBytes('Kovo-Live-Targets', '');
      const emptyLive = encodeFrameworkLiveTargetHeader([
        {
          attestation: 'token',
          component: 'components/card',
          propsSource: '{"payload":""}',
          target: 'card',
        },
      ]);
      const liveWireEntry = encodeFrameworkLiveTargetHeader([
        {
          attestation: 'token',
          component: 'components/card',
          propsSource: `{"payload":"${'x'.repeat(liveValueCharacters - emptyLive.length)}"}`,
          target: 'card',
        },
      ]);
      const plan = planFrameworkTargetRequestHeaders({
        build,
        currentUrl,
        formTarget,
        idem,
        liveTargets: [{ target: 'card', wireEntry: liveWireEntry }],
        targets: [{ target: 'card', wireEntry: targetWireEntry }],
      });
      expect(plan).toBeDefined();
      expect(
        Object.keys(plan!.headers).reduce(
          (total, name) => total + lineBytes(name, plan!.headers[name]!),
          0,
        ),
      ).toBe(FRAMEWORK_WIRE_INPUT_GRAMMAR.maxTargetRequestHeaderBytes);
      const representativeMutationHeaders = (): Readonly<Record<string, string>> => ({
        Accept: 'text/vnd.kovo.fragment+html',
        'Accept-Language': 'en-US,en;q=0.9',
        'Content-Length': '0',
        'Content-Type': 'multipart/form-data; boundary=----kovo-transport-boundary',
        Cookie: cookie,
        Origin: `http://127.0.0.1:${address.port}`,
        Referer: currentUrl,
        'User-Agent': 'Kovo transport-boundary regression',
        ...plan!.headers,
      });
      const requestStatus = (headers: Readonly<Record<string, string>>): Promise<number> =>
        new Promise((resolve, reject) => {
          const outgoing = request(
            {
              headers,
              host: '127.0.0.1',
              method: 'POST',
              path: '/_m/catalog/select',
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

      await expect(requestStatus(representativeMutationHeaders())).resolves.toBe(204);
      expect(handlerHits).toBe(1);

      await expect(
        requestStatus({
          ...representativeMutationHeaders(),
          'Kovo-Live-Targets': 'x'.repeat(6 * 1024),
          'Kovo-Targets': 'x'.repeat(6 * 1024),
        }),
      ).resolves.toBe(431);
      expect(handlerHits).toBe(1);

      await expect(
        requestStatus({
          'Kovo-Live-Targets': 'card#components/card@token:{"del":"\u007f"}',
        }),
      ).rejects.toMatchObject({ code: 'ERR_INVALID_CHAR' });
      expect(handlerHits).toBe(1);

      await expect(requestStatus({ 'Kovo-Live-Targets': delHeader })).resolves.toBe(204);
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
      targets = encodeFrameworkTargetHeader([
        { deps: [dep('product:p1')], target: 'card:primary' },
      ]);
    } finally {
      Object.defineProperty(globalThis, 'Array', arrayDescriptor);
    }

    expect(getterHits).toBe(0);
    expect(props).toBe('{"3":683,"del":"\\u007f","label":"\\ud83d\\ude00 \\u6f22\\u5b57"}');
    expect(targets).toBe('card%3Aprimary=product%3Ap1');
  });

  it('keeps codec acceptance and rejection exact after late intrinsic replacement', () => {
    const targetEntries = [{ deps: [dep('public'), dep('catalog')], target: 'public-panel' }];
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
    const targetHeader = 'public-panel=public catalog';
    const descriptorHeader = 'public-panel#components%2Fpublic%2Fcard@token_1:{"id":"safe"}';
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
        encodeFrameworkTargetHeader([{ deps: [dep('query\0admin')], target: 'safe' }]);
      } catch {
        invalidTargetRejected = true;
      }
      try {
        encodeFrameworkLiveTargetHeader([
          {
            attestation: 'bad:token',
            component: 'component',
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
    expect(encodedDescriptors).toBe(
      'public-panel#components%2Fpublic%2Fcard@token_1:{"id":"safe"}',
    );
    expect(decodedTargets).toEqual(targetEntries);
    expect(decodedDescriptors).toEqual(decodedDescriptorExpectation);
    expect(decodedInvalidTargets).toEqual([]);
    expect(decodedInvalidDescriptors).toEqual([]);
    expect(invalidTargetRejected).toBe(true);
    expect(invalidDescriptorRejected).toBe(true);
  });
});
