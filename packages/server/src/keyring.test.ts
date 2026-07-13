import { describe, expect, it } from 'vitest';

import { createSigningKeyRing, signingKeyRingFromSecret } from './keyring.js';

const OLD_SECRET = 'old-signing-secret-at-least-32-bytes';
const NEW_SECRET = 'new-signing-secret-at-least-32-bytes';
const DIFFERENT_SECRET = 'different-signing-secret-at-least-32-bytes';

describe('SigningKeyRing', () => {
  it('signs with the single active key and verifies with previous non-revoked keys', () => {
    const previousOnly = createSigningKeyRing({
      keys: [{ id: 'old', secret: OLD_SECRET, state: 'active' }],
    });
    const old = previousOnly.sign({
      audience: 'storage-download:/files',
      payload: 'payload',
      purpose: 'capability-url',
    });

    const rotated = createSigningKeyRing({
      keys: [
        { id: 'new', secret: NEW_SECRET, state: 'active' },
        { id: 'old', secret: OLD_SECRET, state: 'previous' },
      ],
    });
    const current = rotated.sign({
      audience: 'storage-download:/files',
      payload: 'payload',
      purpose: 'capability-url',
    });

    expect(current.keyId).toBe('new');
    expect(
      rotated.verify({
        audience: 'storage-download:/files',
        payload: 'payload',
        purpose: 'capability-url',
        signature: old.signature,
      }),
    ).toEqual({ ok: true, keyId: 'old' });
  });

  it('rejects revoked-key signatures without accepting them as ordinary rotation', () => {
    const revokedOnly = createSigningKeyRing({
      keys: [{ id: 'old', secret: OLD_SECRET, state: 'active' }],
    });
    const revokedToken = revokedOnly.sign({
      audience: 'csrf:cart/add',
      payload: 'session-1',
      purpose: 'csrf',
    });

    const rotated = createSigningKeyRing({
      keys: [
        { id: 'new', secret: NEW_SECRET, state: 'active' },
        { id: 'old', secret: OLD_SECRET, state: 'revoked' },
      ],
    });

    expect(
      rotated.verify({
        audience: 'csrf:cart/add',
        payload: 'session-1',
        purpose: 'csrf',
        signature: revokedToken.signature,
      }),
    ).toEqual({ ok: false, reason: 'revoked-key' });
  });

  it('rejects unknown signing material and wrong purpose or audience', () => {
    const keyRing = createSigningKeyRing({
      keys: [{ id: 'current', secret: NEW_SECRET, state: 'active' }],
    });
    const signature = keyRing.sign({
      audience: 'storage-download:/files',
      payload: 'payload',
      purpose: 'capability-url',
    }).signature;

    expect(
      keyRing.verify({
        audience: 'storage-download:/other',
        payload: 'payload',
        purpose: 'capability-url',
        signature,
      }),
    ).toEqual({ ok: false, reason: 'bad-signature' });
    expect(
      keyRing.verify({
        audience: 'storage-download:/files',
        payload: 'payload',
        purpose: 'csrf',
        signature,
      }),
    ).toEqual({ ok: false, reason: 'bad-signature' });
    expect(
      createSigningKeyRing({
        keys: [{ id: 'different', secret: DIFFERENT_SECRET, state: 'active' }],
      }).verify({
        audience: 'storage-download:/files',
        keyId: 'missing',
        payload: 'payload',
        purpose: 'capability-url',
        signature,
      }),
    ).toEqual({ ok: false, reason: 'unknown-key' });
  });

  it('rejects malformed-length signatures through the same fixed-width compare path', () => {
    const keyRing = createSigningKeyRing({
      keys: [{ id: 'current', secret: NEW_SECRET, state: 'active' }],
    });
    const signed = keyRing.sign({
      audience: 'csrf:cart/add',
      payload: 'session-1',
      purpose: 'csrf',
    });

    expect(
      keyRing.verify({
        audience: 'csrf:cart/add',
        keyId: signed.keyId,
        payload: 'session-1',
        purpose: 'csrf',
        signature: signed.signature.slice(0, -1),
      }),
    ).toEqual({ ok: false, reason: 'bad-signature' });
    expect(
      keyRing.verify({
        audience: 'csrf:cart/add',
        keyId: signed.keyId,
        payload: 'session-1',
        purpose: 'csrf',
        signature: `${signed.signature}a`,
      }),
    ).toEqual({ ok: false, reason: 'bad-signature' });
    expect(
      keyRing.verify({
        audience: 'csrf:cart/add',
        keyId: signed.keyId,
        payload: 'session-1',
        purpose: 'csrf',
        signature: signed.signature,
      }),
    ).toEqual({ ok: true, keyId: signed.keyId });
  });

  it('fails closed for missing or invalid signing material', () => {
    expect(() => createSigningKeyRing({ keys: [] })).toThrow(/exactly one active key/);
    expect(() =>
      createSigningKeyRing({ keys: [{ id: 'current', secret: '', state: 'active' }] }),
    ).toThrow(/minimum is 32 bytes/);
    expect(() =>
      createSigningKeyRing({ keys: [{ id: 'current', secret: 'short', state: 'active' }] }),
    ).toThrow(/minimum is 32 bytes/);
    expect(() =>
      createSigningKeyRing({
        keys: [
          { id: 'a', secret: OLD_SECRET, state: 'active' },
          { id: 'b', secret: NEW_SECRET, state: 'active' },
        ],
      }),
    ).toThrow(/exactly one active key/);
  });

  it('rejects undersized signing material after typed-array length accessors are poisoned', () => {
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
    const byteLengthDescriptor = Object.getOwnPropertyDescriptor(
      typedArrayPrototype,
      'byteLength',
    );
    expect(byteLengthDescriptor).toBeDefined();

    Object.defineProperty(typedArrayPrototype, 'byteLength', {
      configurable: true,
      get(this: Uint8Array) {
        const actual = Reflect.apply(byteLengthDescriptor!.get!, this, []) as number;
        return actual === 5 ? 64 : actual;
      },
    });
    try {
      expect(() =>
        createSigningKeyRing({
          keys: [{ id: 'current', secret: 'short', state: 'active' }],
        }),
      ).toThrow(/minimum is 32 bytes/);
    } finally {
      Object.defineProperty(typedArrayPrototype, 'byteLength', byteLengthDescriptor!);
    }
  });

  it('pins opaque key-ring method identities and current key metadata', () => {
    const source = {
      currentKeyId: 'original',
      sign: () => ({ keyId: 'original', signature: 'original-signature' }),
      verify: () => ({ ok: false as const, reason: 'bad-signature' as const }),
    };
    const pinned = signingKeyRingFromSecret(source);

    source.currentKeyId = 'attacker';
    source.sign = () => ({ keyId: 'attacker', signature: 'attacker-signature' });
    source.verify = () => ({ ok: true as const, keyId: 'attacker' });

    expect(pinned.currentKeyId).toBe('original');
    expect(
      pinned.sign({ audience: 'csrf:account/delete', payload: 'victim', purpose: 'csrf' }),
    ).toEqual({ keyId: 'original', signature: 'original-signature' });
    expect(
      pinned.verify({
        audience: 'csrf:account/delete',
        payload: 'victim',
        purpose: 'csrf',
        signature: 'attacker-signature',
      }),
    ).toEqual({ ok: false, reason: 'bad-signature' });
    expect(Object.isFrozen(pinned)).toBe(true);
  });

  it('never dispatches signing-key arrays through poisoned find or iterator prototypes', () => {
    const originalFind = Array.prototype.find;
    const originalIterator = Array.prototype[Symbol.iterator];
    Array.prototype.find = () => {
      throw new Error('poisoned Array.find observed signing keys');
    };
    Array.prototype[Symbol.iterator] = function () {
      const first = this[0] as { secret?: unknown } | undefined;
      if (first && typeof first === 'object' && 'secret' in first) {
        throw new Error('poisoned Array iterator observed signing keys');
      }
      return originalIterator.call(this);
    };
    try {
      const ring = createSigningKeyRing({
        keys: [
          { id: 'new', secret: NEW_SECRET, state: 'active' },
          { id: 'old', secret: OLD_SECRET, state: 'previous' },
        ],
      });
      const signed = ring.sign({ audience: 'csrf:cart/add', payload: 'victim', purpose: 'csrf' });
      expect(
        ring.verify({
          audience: 'csrf:cart/add',
          keyId: signed.keyId,
          payload: 'victim',
          purpose: 'csrf',
          signature: signed.signature,
        }),
      ).toEqual({ ok: true, keyId: 'new' });
    } finally {
      Array.prototype.find = originalFind;
      Array.prototype[Symbol.iterator] = originalIterator;
    }
  });
});
