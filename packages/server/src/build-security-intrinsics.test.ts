import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildSecurityGetRequest,
  buildSecurityPathJoin,
  buildSecurityPathResolve,
  buildSecuritySourceLiteral,
  buildSecurityUrlSnapshot,
  commitBuildArrayValue,
  snapshotBuildArray,
} from './build-security-intrinsics.js';

const originalJsonStringify = JSON.stringify;

afterEach(() => {
  JSON.stringify = originalJsonStringify;
});

describe('build source serialization (SPEC §6.6 rule 6)', () => {
  it('keeps variadic build paths exact after late array-iterator replacement', () => {
    const originalIterator = Array.prototype[Symbol.iterator];
    const expectedJoin = path.join('approved-root', 'child.css');
    const expectedResolve = path.resolve('approved-root', 'child.css');
    let joined = '';
    let resolved = '';
    try {
      Array.prototype[Symbol.iterator] = function () {
        if (this[0] === 'approved-root') {
          return Reflect.apply(originalIterator, ['attacker-root', 'cross-route.css'], []);
        }
        return Reflect.apply(originalIterator, this, []);
      } as (typeof Array.prototype)[Symbol.iterator];

      joined = buildSecurityPathJoin('approved-root', 'child.css');
      resolved = buildSecurityPathResolve('approved-root', 'child.css');
    } finally {
      Array.prototype[Symbol.iterator] = originalIterator;
    }

    expect(joined).toBe(expectedJoin);
    expect(resolved).toBe(expectedResolve);
  });

  it('keeps synthetic replay URL and Request identity after late global replacement', () => {
    const NativeRequest = globalThis.Request;
    const NativeURL = globalThis.URL;
    try {
      const CrossBindUrl = class CrossBindUrl extends NativeURL {
        constructor(input: string | URL, base?: string | URL) {
          super('/admin', base);
        }
      } as typeof URL;
      const CrossBindRequest = class CrossBindRequest extends NativeRequest {
        constructor(input: RequestInfo | URL, init?: RequestInit) {
          super('https://kovo.test/admin', init);
        }
      } as typeof Request;
      globalThis.URL = CrossBindUrl;
      globalThis.Request = CrossBindRequest;

      const url = buildSecurityUrlSnapshot('/safe?proof=1', 'https://kovo.test');
      const request = buildSecurityGetRequest(url.href);

      expect(url).toEqual({
        hash: '',
        href: 'https://kovo.test/safe?proof=1',
        origin: 'https://kovo.test',
        pathname: '/safe',
        protocol: 'https:',
        search: '?proof=1',
      });
      expect(request.method).toBe('GET');
      expect(request.url).toBe('https://kovo.test/safe?proof=1');
      expect(globalThis.URL).toBe(CrossBindUrl);
      expect(globalThis.Request).toBe(CrossBindRequest);
    } finally {
      globalThis.Request = NativeRequest;
      globalThis.URL = NativeURL;
    }
  });

  it('commits dense framework arrays without method or inherited-index dispatch', () => {
    const originalPush = Array.prototype.push;
    const originalZero = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    let setterCalls = 0;
    let committed: PropertyDescriptor | undefined;
    let committedLength = -1;
    let snapshot: readonly string[] = [];
    const source = ['approved'];
    try {
      Array.prototype.push = () => {
        throw new Error('mutable push must not run');
      };
      Object.defineProperty(Array.prototype, '0', {
        configurable: true,
        set() {
          setterCalls += 1;
        },
      });

      const target: string[] = [];
      commitBuildArrayValue(target, 'approved', 'test artifact');
      snapshot = snapshotBuildArray(source, 'test source');
      committed = Object.getOwnPropertyDescriptor(target, '0');
      committedLength = target.length;
    } finally {
      Array.prototype.push = originalPush;
      if (originalZero === undefined) delete Array.prototype[0];
      else Object.defineProperty(Array.prototype, '0', originalZero);
    }

    expect(committed?.value).toBe('approved');
    expect(committedLength).toBe(1);
    expect(snapshot).toEqual(['approved']);
    expect(setterCalls).toBe(0);
  });

  it('keeps nested source data exact after a selective ambient JSON replacement', () => {
    JSON.stringify = ((value: unknown) =>
      value && typeof value === 'object'
        ? '(()=>{globalThis.__kovoSourceInjection=true;return {}})()'
        : originalJsonStringify(value)) as typeof JSON.stringify;

    expect(
      buildSecuritySourceLiteral({
        headers: { 'x-content-type-options': 'nosniff' },
        reads: [{ domains: ['cart'], query: 'cart' }],
      }),
    ).toBe(
      '{"headers":{"x-content-type-options":"nosniff"},"reads":[{"domains":["cart"],"query":"cart"}]}',
    );
  });

  it('ignores inherited toJSON and rejects own accessors or unstable descriptors', () => {
    const inherited = Object.create({
      toJSON() {
        return 'ATTACKER';
      },
    }) as { safe: string };
    Object.defineProperty(inherited, 'safe', {
      enumerable: true,
      value: 'reviewed',
    });
    expect(buildSecuritySourceLiteral(inherited)).toBe('{"safe":"reviewed"}');

    expect(() =>
      buildSecuritySourceLiteral({
        get unsafe() {
          return 'ATTACKER';
        },
      }),
    ).toThrow('stable own data property');

    let calls = 0;
    const unstable = new Proxy(
      { value: 'safe' },
      {
        getOwnPropertyDescriptor(target, property) {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
          if (property !== 'value' || descriptor === undefined) return descriptor;
          calls += 1;
          return { ...descriptor, value: calls % 2 === 0 ? 'attacker' : 'safe' };
        },
      },
    );
    expect(() => buildSecuritySourceLiteral(unstable)).toThrow('stable own data property');
  });
});
