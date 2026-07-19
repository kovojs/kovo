import { describe, expect, it } from 'vitest';

import {
  createCapabilityCryptoHandle,
  createCsrfCryptoHandle,
  createLiveTargetCryptoHandle,
  createSessionFingerprintCryptoHandle,
} from './crypto-authority.js';
import { signCapability } from './capability-url.js';
import {
  createFrameworkCsrfSigningSecret,
  createSigningKeyRing,
  isFrameworkCsrfSigningSecret,
  isSigningKeyRing,
  signingKeyRingFromSecret,
} from './keyring.js';

const OLD_SECRET = 'old-signing-secret-at-least-32-bytes';
const NEW_SECRET = 'new-signing-secret-at-least-32-bytes';
const DIFFERENT_SECRET = 'different-signing-secret-at-least-32-bytes';

describe('SigningKeyRing', () => {
  it('is an opaque configuration carrier rather than a generic signer', () => {
    const ring = createSigningKeyRing({
      keys: [{ id: 'current', secret: NEW_SECRET, state: 'active' }],
    });
    expect(Object.isFrozen(ring)).toBe(true);
    expect(Reflect.ownKeys(ring)).toEqual(['currentKeyId']);
    expect(ring).not.toHaveProperty('sign');
    expect(ring).not.toHaveProperty('verify');
    expect(ring).not.toHaveProperty('secret');
    expect(isSigningKeyRing(ring)).toBe(true);
    expect(isSigningKeyRing({ currentKeyId: 'current' })).toBe(false);
  });

  it('keeps framework CSRF authority opaque and refuses unrelated fixed-purpose doors', async () => {
    const source = createSigningKeyRing({
      keys: [{ id: 'auth', secret: NEW_SECRET, state: 'active' }],
    });
    const capability = createFrameworkCsrfSigningSecret(source);

    expect(Object.isFrozen(capability)).toBe(true);
    expect(Reflect.ownKeys(capability)).toEqual([]);
    expect(isFrameworkCsrfSigningSecret(capability)).toBe(true);
    expect(isSigningKeyRing(capability)).toBe(false);
    expect(isFrameworkCsrfSigningSecret({} as typeof capability)).toBe(false);
    expect(() => createCapabilityCryptoHandle(capability, 'storage-download')).toThrow(
      /only permits csrf, anonymous-csrf/u,
    );
    await expect(signCapability(capability, { key: 'private/report.pdf' })).rejects.toThrow(
      /only permits csrf, anonymous-csrf/u,
    );
  });

  it('grants the CSRF carrier only its fixed CSRF, live-target, and fingerprint doors', () => {
    const source = createSigningKeyRing({
      keys: [{ id: 'auth', secret: NEW_SECRET, state: 'active' }],
    });
    const capability = createFrameworkCsrfSigningSecret(source);

    for (const purpose of ['csrf', 'anonymous-csrf'] as const) {
      const handle = createCsrfCryptoHandle(capability, purpose, 'auth/sign-in');
      const signed = handle.sign('binding-1');
      expect(handle.verify('binding-1', signed.signature, signed.keyId)).toEqual({
        keyId: 'auth',
        ok: true,
      });
    }
    const live = createLiveTargetCryptoHandle(capability);
    const attestation = live.sign('descriptor');
    expect(live.verify('descriptor', attestation.signature)).toEqual({ keyId: 'auth', ok: true });

    const fingerprint = createSessionFingerprintCryptoHandle(capability).sign('principal-1');
    const directFingerprint = createSessionFingerprintCryptoHandle(source).sign('principal-1');
    expect(fingerprint).toEqual(directFingerprint);
    expect(createSessionFingerprintCryptoHandle(source)).not.toHaveProperty('verify');
  });

  it('signs with the active key and verifies previous keys only inside finite overlap', () => {
    const old = createCapabilityCryptoHandle(
      createSigningKeyRing({
        keys: [{ id: 'old', secret: OLD_SECRET, state: 'active' }],
      }),
      'storage-download:/files',
    ).sign('payload');

    const rotated = createCapabilityCryptoHandle(
      createSigningKeyRing({
        keys: [
          { id: 'new', secret: NEW_SECRET, state: 'active' },
          {
            acceptUntil: Date.now() + 60_000,
            id: 'old',
            secret: OLD_SECRET,
            state: 'previous',
          },
        ],
      }),
      'storage-download:/files',
    );
    expect(rotated.sign('payload').keyId).toBe('new');
    expect(rotated.verify('payload', old.signature)).toEqual({ keyId: 'old', ok: true });

    const expired = createCapabilityCryptoHandle(
      createSigningKeyRing({
        keys: [
          { id: 'new', secret: NEW_SECRET, state: 'active' },
          { acceptUntil: 1, id: 'old', secret: OLD_SECRET, state: 'previous' },
        ],
      }),
      'storage-download:/files',
    );
    expect(expired.verify('payload', old.signature, 'old')).toEqual({
      ok: false,
      reason: 'revoked-key',
    });
  });

  it('rejects revoked, unknown, wrong-purpose, and wrong-audience signatures', () => {
    const source = createCapabilityCryptoHandle(
      createSigningKeyRing({
        keys: [{ id: 'old', secret: OLD_SECRET, state: 'active' }],
      }),
      'storage-download:/files',
    );
    const signed = source.sign('payload');
    const revoked = createCapabilityCryptoHandle(
      createSigningKeyRing({
        keys: [
          { id: 'new', secret: NEW_SECRET, state: 'active' },
          { id: 'old', state: 'revoked' },
        ],
      }),
      'storage-download:/files',
    );
    expect(revoked.verify('payload', signed.signature, 'old')).toEqual({
      ok: false,
      reason: 'revoked-key',
    });
    expect(revoked.verify('payload', signed.signature, 'missing')).toEqual({
      ok: false,
      reason: 'unknown-key',
    });
    expect(
      createCapabilityCryptoHandle(
        signingKeyRingFromSecret(DIFFERENT_SECRET),
        'storage-download:/files',
      ).verify('payload', signed.signature),
    ).toEqual({ ok: false, reason: 'bad-signature' });
    expect(
      createCapabilityCryptoHandle(signingKeyRingFromSecret(OLD_SECRET), 'other').verify(
        'payload',
        signed.signature,
      ),
    ).toEqual({ ok: false, reason: 'bad-signature' });
    expect(
      createCsrfCryptoHandle(
        signingKeyRingFromSecret(OLD_SECRET),
        'csrf',
        'storage-download:/files',
      ).verify('payload', signed.signature),
    ).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects malformed-length signatures through the fixed-width native compare door', () => {
    const handle = createCsrfCryptoHandle(
      signingKeyRingFromSecret(NEW_SECRET),
      'csrf',
      'csrf:cart/add',
    );
    const signed = handle.sign('session-1');
    expect(handle.verify('session-1', signed.signature.slice(0, -1), signed.keyId)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
    expect(handle.verify('session-1', `${signed.signature}a`, signed.keyId)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('fails closed for invalid lifecycle declarations and weak material', () => {
    expect(() => createSigningKeyRing({ keys: [] })).toThrow(/exactly one active key/u);
    expect(() =>
      createSigningKeyRing({ keys: [{ id: 'current', secret: 'short', state: 'active' }] }),
    ).toThrow(/minimum is 32 bytes/u);
    expect(() =>
      createSigningKeyRing({
        keys: [
          { id: 'a', secret: OLD_SECRET, state: 'active' },
          { id: 'b', secret: NEW_SECRET, state: 'active' },
        ],
      }),
    ).toThrow(/exactly one active key/u);
    expect(() =>
      createSigningKeyRing({
        keys: [
          { id: 'new', secret: NEW_SECRET, state: 'active' },
          { id: 'old', secret: OLD_SECRET, state: 'previous' } as never,
        ],
      }),
    ).toThrow(/acceptUntil/u);
    expect(() =>
      createSigningKeyRing({
        keys: [
          { id: 'new', secret: NEW_SECRET, state: 'active' },
          { id: 'old', secret: OLD_SECRET, state: 'revoked' } as never,
        ],
      }),
    ).toThrow(/must not retain signing material/u);
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
      const handle = createCsrfCryptoHandle(
        createSigningKeyRing({
          keys: [
            { id: 'new', secret: NEW_SECRET, state: 'active' },
            {
              acceptUntil: Date.now() + 60_000,
              id: 'old',
              secret: OLD_SECRET,
              state: 'previous',
            },
          ],
        }),
        'csrf',
        'csrf:cart/add',
      );
      const signed = handle.sign('victim');
      expect(handle.verify('victim', signed.signature, signed.keyId)).toEqual({
        keyId: 'new',
        ok: true,
      });
    } finally {
      Array.prototype.find = originalFind;
      Array.prototype[Symbol.iterator] = originalIterator;
    }
  });
});
