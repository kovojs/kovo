import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

import { computeRenderPlanFingerprint, encodeRenderPlanFrame } from './render-plan-token.js';

const renderPlanIntrinsicsUrl = new URL('./render-plan-token-intrinsics.ts', import.meta.url).href;

describe('render-plan token security controls', () => {
  it('keeps exact framing and fingerprints after late collection, string, Buffer, and hash poisoning', () => {
    const expectedFrame = encodeRenderPlanFrame('名', '🙂');
    const expected = computeRenderPlanFingerprint({ a: 'field:id', z: 'field:role' });
    const changed = computeRenderPlanFingerprint({ a: 'field:id', z: 'field:name' });
    const hashPrototype = Object.getPrototypeOf(createHash('sha256')) as {
      digest: (...args: unknown[]) => unknown;
      update: (...args: unknown[]) => unknown;
    };
    const originalByteLength = Buffer.byteLength;
    const originalDigest = hashPrototype.digest;
    const originalJoin = Array.prototype.join;
    const originalMap = Array.prototype.map;
    const originalObjectKeys = Object.keys;
    const originalSlice = String.prototype.slice;
    const originalSort = Array.prototype.sort;
    const originalUpdate = hashPrototype.update;
    Buffer.byteLength = () => 0;
    hashPrototype.digest = () => '0'.repeat(64);
    hashPrototype.update = function () {
      return this;
    };
    Array.prototype.join = () => 'forged';
    Array.prototype.map = () => [];
    Array.prototype.sort = function () {
      return this;
    };
    Object.keys = () => ['z'];
    String.prototype.slice = () => '0000000000000000';

    try {
      expect(encodeRenderPlanFrame('名', '🙂')).toBe(expectedFrame);
      expect(computeRenderPlanFingerprint({ z: 'field:role', a: 'field:id' })).toBe(expected);
      expect(computeRenderPlanFingerprint({ z: 'field:name', a: 'field:id' })).toBe(changed);
      expect(changed).not.toBe(expected);
    } finally {
      String.prototype.slice = originalSlice;
      Object.keys = originalObjectKeys;
      Array.prototype.sort = originalSort;
      Array.prototype.map = originalMap;
      Array.prototype.join = originalJoin;
      hashPrototype.update = originalUpdate;
      hashPrototype.digest = originalDigest;
      Buffer.byteLength = originalByteLength;
    }
  });

  it('C242 cannot erase a query shape from the render-plan fingerprint with an inherited setter', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    const nativeDefineProperty = Object.defineProperty;
    let poisonHits = 0;
    let safe = '';
    let changed = '';
    try {
      nativeDefineProperty(Array.prototype, '0', {
        configurable: true,
        set(value: unknown) {
          if (Array.isArray(value) && value[0] === 'account') {
            poisonHits += 1;
            return;
          }
          nativeDefineProperty(this, '0', {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
        },
      });
      safe = computeRenderPlanFingerprint({ account: 'field:id' });
      changed = computeRenderPlanFingerprint({ account: 'field:role' });
    } finally {
      if (originalDescriptor === undefined) delete Array.prototype[0];
      else nativeDefineProperty(Array.prototype, '0', originalDescriptor);
    }

    expect(poisonHits).toBe(0);
    expect(safe).not.toBe(changed);
  });

  it('rejects accessor-backed query shapes instead of re-reading mutable caller authority', () => {
    const input = {} as Record<string, string>;
    Object.defineProperty(input, 'account', {
      enumerable: true,
      get: () => 'field:role',
    });
    expect(() => computeRenderPlanFingerprint(input)).toThrow(/string data property/);
  });

  it('rejects non-enumerable and symbol query-shape authority instead of omitting it', () => {
    const hidden = {} as Record<string, string>;
    Object.defineProperty(hidden, 'account', {
      enumerable: false,
      value: 'field:role',
    });
    expect(() => computeRenderPlanFingerprint(hidden)).toThrow(/enumerable string data property/);

    const symbol = { [Symbol('account')]: 'field:role' } as Record<string, string>;
    expect(() => computeRenderPlanFingerprint(symbol)).toThrow(/symbol properties/);
  });

  it('does not let a late array-iterator poison collide distinct query shapes', () => {
    const expected = computeRenderPlanFingerprint({ account: 'field:id' });
    const changed = computeRenderPlanFingerprint({ account: 'field:role' });
    const originalIterator = Array.prototype[Symbol.iterator];
    let observedExpected = '';
    let observedChanged = '';
    Array.prototype[Symbol.iterator] = function* () {
      yield 'forged-name';
      yield 'forged-shape';
    } as (typeof Array.prototype)[typeof Symbol.iterator];
    try {
      observedExpected = computeRenderPlanFingerprint({ account: 'field:id' });
      observedChanged = computeRenderPlanFingerprint({ account: 'field:role' });
    } finally {
      Array.prototype[Symbol.iterator] = originalIterator;
    }
    expect(observedExpected).toBe(expected);
    expect(observedChanged).toBe(changed);
    expect(changed).not.toBe(expected);
  });

  it('canonicalizes large reverse-ordered query maps without quadratic sorting', () => {
    const input = Object.create(null) as Record<string, string>;
    for (let index = 40_000; index > 0; index -= 1) {
      input[`query-${String(index).padStart(6, '0')}`] = 'field:id';
    }
    const start = performance.now();
    expect(computeRenderPlanFingerprint(input)).toMatch(/^[0-9a-f]{16}$/u);
    expect(performance.now() - start).toBeLessThan(2_000);
  });

  it('fails closed when framing controls were poisoned before their import', async () => {
    const originalByteLength = Buffer.byteLength;
    Buffer.byteLength = () => 0;
    try {
      const controls = await import(`${renderPlanIntrinsicsUrl}?preimport-frame-poison`);
      expect(() => controls.renderPlanUtf8ByteLength('safe')).toThrow(
        /render-plan controls are unavailable/,
      );
    } finally {
      Buffer.byteLength = originalByteLength;
    }
  });

  it('fails closed when hash controls were poisoned before their import', async () => {
    const hashPrototype = Object.getPrototypeOf(createHash('sha256')) as {
      update: (...args: unknown[]) => unknown;
    };
    const originalUpdate = hashPrototype.update;
    hashPrototype.update = function () {
      return this;
    };
    try {
      await expect(
        import(`${renderPlanIntrinsicsUrl}?preimport-hash-poison`),
      ).resolves.toBeDefined();
      const controls = await import(`${renderPlanIntrinsicsUrl}?preimport-hash-poison`);
      expect(() => controls.renderPlanHash16(['safe'])).toThrow(
        /render-plan controls are unavailable/,
      );
    } finally {
      hashPrototype.update = originalUpdate;
    }
  });
});
