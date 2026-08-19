import { Buffer as NativeBuffer } from 'node:buffer';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRequire, syncBuiltinESMExports } from 'node:module';

import { describe, expect, it } from 'vitest';

import {
  authenticateStaticTrustWorkerPayload,
  createKovoSourceCheckFactAuthenticationAuthority,
  equalStaticTrustWorkerAuthentication,
  mintStaticTrustWorkerAuthority,
} from './build-crypto-authority.js';

const mutableCrypto = createRequire(import.meta.url)('node:crypto') as {
  createHmac: typeof createHmac;
  randomBytes: typeof randomBytes;
  timingSafeEqual: typeof timingSafeEqual;
};

describe('SPEC §6.6 build/check crypto authority', () => {
  it('keeps source-check authentication behind a closed session handle', async () => {
    const authority = createKovoSourceCheckFactAuthenticationAuthority();
    const authentication = authority.authenticate('fact-key', 'fact-payload');

    expect(Object.isFrozen(authority)).toBe(true);
    expect(Reflect.ownKeys(authority).sort()).toEqual(['authenticate', 'destroy', 'verifyFact']);
    expect(authority.verifyFact('fact-key', 'fact-payload', authentication)).toBe(true);
    expect(authority.verifyFact('other-key', 'fact-payload', authentication)).toBe(false);
    expect(authority.verifyFact('fact-key', 'other-payload', authentication)).toBe(false);
    authority.destroy();
    expect(() => authority.authenticate('fact-key', 'fact-payload')).toThrow(/closed/u);
    expect(() => authority.verifyFact('fact-key', 'fact-payload', authentication)).toThrow(
      /closed/u,
    );
    expect(() => authority.destroy()).not.toThrow();

    const exports = await import('./build-crypto-authority.js');
    expect(exports).not.toHaveProperty('createHmac');
    expect(exports).not.toHaveProperty('randomBytes');
    expect(exports).not.toHaveProperty('timingSafeEqual');
    expect(exports).not.toHaveProperty('equal');
  });

  it('mints fixed-width worker authority and preserves the authenticated envelope identity', () => {
    const first = mintStaticTrustWorkerAuthority();
    const second = mintStaticTrustWorkerAuthority();
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.authenticationKey).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.challenge).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.authenticationKey).not.toBe(first.challenge);
    expect(second).not.toEqual(first);

    const authenticated = authenticateStaticTrustWorkerPayload(
      '00'.repeat(32),
      'request',
      'payload',
    );
    expect(authenticated).toBe(
      'hmac-sha256:ba281914233da2df3e3d321254b0055f66428febc1b0ed0706fedfd43099a237',
    );
    expect(equalStaticTrustWorkerAuthentication(authenticated, authenticated)).toBe(true);
    expect(equalStaticTrustWorkerAuthentication(authenticated, `${authenticated}0`)).toBe(false);
  });

  it('pins authority controls before late builtin and prototype poisoning', () => {
    const hmacPrototype = Object.getPrototypeOf(createHmac('sha256', 'control')) as {
      digest: Function;
      update: Function;
    };
    const nativeCreateHmac = mutableCrypto.createHmac;
    const nativeRandomBytes = mutableCrypto.randomBytes;
    const nativeTimingSafeEqual = mutableCrypto.timingSafeEqual;
    const nativeHmacDigest = hmacPrototype.digest;
    const nativeHmacUpdate = hmacPrototype.update;
    const nativeBufferFrom = NativeBuffer.from;
    const nativeBufferFill = NativeBuffer.prototype.fill;
    const nativeBufferToString = NativeBuffer.prototype.toString;
    const nativeRegExpTest = RegExp.prototype.test;
    const nativeUint8ArrayHasInstance = Object.getOwnPropertyDescriptor(
      Uint8Array,
      Symbol.hasInstance,
    );
    let ambientPoisonReached = false;
    let ambientInstanceof = true;
    let staticAuthentication = '';
    let verified = false;
    let forgedAccepted = true;
    let closed = false;
    let invalidKeyRejected = false;
    let fillPoisonHits = 0;
    let workerAuthority: ReturnType<typeof mintStaticTrustWorkerAuthority> | undefined;
    try {
      mutableCrypto.createHmac = (() => {
        throw new Error('poisoned createHmac reached');
      }) as typeof createHmac;
      mutableCrypto.randomBytes = (() => {
        throw new Error('poisoned randomBytes reached');
      }) as typeof randomBytes;
      mutableCrypto.timingSafeEqual = (() => true) as typeof timingSafeEqual;
      syncBuiltinESMExports();
      hmacPrototype.update = () => {
        throw new Error('poisoned Hmac.update reached');
      };
      hmacPrototype.digest = () => 'forged';
      NativeBuffer.from = (() => {
        throw new Error('poisoned Buffer.from reached');
      }) as typeof NativeBuffer.from;
      NativeBuffer.prototype.toString = () => 'forged';
      NativeBuffer.prototype.fill = (() => {
        fillPoisonHits += 1;
        throw new Error('poisoned Buffer.fill reached');
      }) as typeof NativeBuffer.prototype.fill;
      RegExp.prototype.test = () => true;
      Object.defineProperty(Uint8Array, Symbol.hasInstance, {
        configurable: true,
        value: () => false,
      });
      ambientInstanceof = new Uint8Array(1) instanceof Uint8Array;

      try {
        mutableCrypto.randomBytes(1);
      } catch {
        ambientPoisonReached = true;
      }
      const authority = createKovoSourceCheckFactAuthenticationAuthority();
      const authentication = authority.authenticate('fact-key', 'fact-payload');
      verified = authority.verifyFact('fact-key', 'fact-payload', authentication);
      forgedAccepted = authority.verifyFact('fact-key', 'fact-payload', new Uint8Array(32));
      staticAuthentication = authenticateStaticTrustWorkerPayload(
        '00'.repeat(32),
        'request',
        'payload',
      );
      try {
        authenticateStaticTrustWorkerPayload('not-a-key', 'request', 'payload');
      } catch {
        invalidKeyRejected = true;
      }
      workerAuthority = mintStaticTrustWorkerAuthority();
      authority.destroy();
      try {
        authority.authenticate('fact-key', 'fact-payload');
      } catch {
        closed = true;
      }
    } finally {
      mutableCrypto.createHmac = nativeCreateHmac;
      mutableCrypto.randomBytes = nativeRandomBytes;
      mutableCrypto.timingSafeEqual = nativeTimingSafeEqual;
      syncBuiltinESMExports();
      hmacPrototype.update = nativeHmacUpdate;
      hmacPrototype.digest = nativeHmacDigest;
      NativeBuffer.from = nativeBufferFrom;
      NativeBuffer.prototype.fill = nativeBufferFill;
      NativeBuffer.prototype.toString = nativeBufferToString;
      RegExp.prototype.test = nativeRegExpTest;
      if (nativeUint8ArrayHasInstance === undefined) {
        Reflect.deleteProperty(Uint8Array, Symbol.hasInstance);
      } else {
        Object.defineProperty(Uint8Array, Symbol.hasInstance, nativeUint8ArrayHasInstance);
      }
    }

    expect(ambientPoisonReached).toBe(true);
    expect(ambientInstanceof).toBe(false);
    expect(verified).toBe(true);
    expect(forgedAccepted).toBe(false);
    expect(closed).toBe(true);
    expect(invalidKeyRejected).toBe(true);
    expect(fillPoisonHits).toBe(0);
    expect(staticAuthentication).toBe(
      'hmac-sha256:ba281914233da2df3e3d321254b0055f66428febc1b0ed0706fedfd43099a237',
    );
    expect(workerAuthority?.authenticationKey).toMatch(/^[0-9a-f]{64}$/u);
    expect(workerAuthority?.challenge).toMatch(/^[0-9a-f]{64}$/u);
  });
});
