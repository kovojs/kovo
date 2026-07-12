import { createRequire, syncBuiltinESMExports } from 'node:module';

import { describe, expect, it } from 'vitest';

import {
  mutationHandlerFingerprintFromRuntimeSource,
  mutationSessionAuthorityFacts,
  parseComponentModule,
} from './scan/parse.js';

describe('mutation handler authority fingerprint security', () => {
  it('uses the same identity for an authored method and its evaluated runtime function', () => {
    const source = `
import { mutation } from '@kovojs/server';
export const addToCart = mutation('cart/add', {
  csrf: false,
  handler(input) {
    return { count: input.quantity };
  },
});
`;
    const [fact] = mutationSessionAuthorityFacts(parseComponentModule('src/app.ts', source));
    const runtimeHandler = {
      handler(input: { quantity: number }) {
        return { count: input.quantity };
      },
    }.handler;
    const runtime = mutationHandlerFingerprintFromRuntimeSource(
      Function.prototype.toString.call(runtimeHandler),
    );

    expect(fact?.referencesSession).toBe(false);
    expect(fact?.handlerFingerprints).toEqual([runtime]);
  });

  it('cannot cross-bind safe and ambient-authority handlers through a late createHash replacement', () => {
    // The digest joins statically inspected source authority to an evaluated runtime handler. A
    // collision here suppresses KV418, so SPEC §2/§6.6 require a fail-closed exact identity.
    const safeSource = '() => "safe"';
    const unsafeSource = '() => globalThis.document.cookie';
    const safeBefore = mutationHandlerFingerprintFromRuntimeSource(safeSource);
    const unsafeBefore = mutationHandlerFingerprintFromRuntimeSource(unsafeSource);
    expect(safeBefore).toMatch(/^[0-9a-f]{64}$/u);
    expect(unsafeBefore).toMatch(/^[0-9a-f]{64}$/u);
    expect(safeBefore).not.toBe(unsafeBefore);

    const require = createRequire(import.meta.url);
    const mutableCrypto = require('node:crypto') as {
      createHash: (typeof import('node:crypto'))['createHash'];
    };
    const nativeCreateHash = mutableCrypto.createHash;
    mutableCrypto.createHash = (() => ({
      digest: () => '0'.repeat(64),
      update() {
        return this;
      },
    })) as unknown as typeof mutableCrypto.createHash;
    syncBuiltinESMExports();

    try {
      expect(mutationHandlerFingerprintFromRuntimeSource(safeSource)).toBe(safeBefore);
      expect(mutationHandlerFingerprintFromRuntimeSource(unsafeSource)).toBe(unsafeBefore);
      expect(mutationHandlerFingerprintFromRuntimeSource(safeSource)).not.toBe(
        mutationHandlerFingerprintFromRuntimeSource(unsafeSource),
      );
    } finally {
      mutableCrypto.createHash = nativeCreateHash;
      syncBuiltinESMExports();
    }
  });

  it('does not canonicalize safe and ambient-authority handlers through a selective Array.join', () => {
    const safeSource = '(_input, request) => request.headers.get("X-Machine-Signature")';
    const unsafeSource = '(_input, request) => request.headers.get("Cookie")';
    const nativeJoin = Array.prototype.join;
    const nativeApply = Reflect.apply;
    Array.prototype.join = function poisonedCanonicalHandlerJoin(separator?: string): string {
      if (separator === '') {
        for (let index = 0; index < this.length; index += 1) {
          const part = this[index];
          if (
            typeof part === 'string' &&
            (part.includes('X-Machine-Signature') || part.includes('Cookie'))
          ) {
            return 'attacker-canonical-handler';
          }
        }
      }
      return nativeApply(nativeJoin, this, [separator]);
    };

    try {
      const safe = mutationHandlerFingerprintFromRuntimeSource(safeSource);
      const unsafe = mutationHandlerFingerprintFromRuntimeSource(unsafeSource);
      expect(safe).toMatch(/^[0-9a-f]{64}$/u);
      expect(unsafe).toMatch(/^[0-9a-f]{64}$/u);
      expect(safe).not.toBe(unsafe);
    } finally {
      Array.prototype.join = nativeJoin;
    }
  });

  it('does not erase ambient-cookie authority while projecting handler entries through Array.map', () => {
    const source = `
import { mutation } from '@kovojs/server';
export const unsafe = mutation('auth/unsafe', {
  csrf: false,
  handler(_input, request) {
    return request.headers.get('Cookie');
  },
});
`;
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    let facts: ReturnType<typeof mutationSessionAuthorityFacts> | undefined;
    try {
      Array.prototype.map = function poisonedHandlerProjectionMap<T, U>(
        callback: (value: T, index: number, array: T[]) => U,
        thisArg?: unknown,
      ): U[] {
        const mapped = nativeApply<U[]>(nativeMap, this, [callback, thisArg]);
        const first = this[0] as { body?: unknown; handler?: unknown; model?: unknown } | undefined;
        if (first?.body && first.handler && first.model) {
          for (let index = 0; index < mapped.length; index += 1) {
            const model = mapped[index] as { readsAmbientCookie?: unknown } | undefined;
            if (model) delete model.readsAmbientCookie;
          }
        }
        return mapped;
      };
      facts = mutationSessionAuthorityFacts(parseComponentModule('src/app.ts', source));
    } finally {
      Array.prototype.map = nativeMap;
    }
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'auth/unsafe',
          referencesSession: true,
        }),
      ]),
    );
  });
});
