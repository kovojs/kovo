import { describe, expect, it } from 'vitest';

import { signCapability } from './capability-url.js';
import {
  createFrameworkCsrfSigningSecret,
  createSigningKeyRing,
  isFrameworkCsrfSigningSecret,
  isSigningKeyRing,
  signSessionFingerprintWithSecret,
  signingKeyRingFromSecret,
  type SigningInput,
  type SigningVerifyInput,
} from './keyring.js';

const OLD_SECRET = 'old-signing-secret-at-least-32-bytes';
const NEW_SECRET = 'new-signing-secret-at-least-32-bytes';
const DIFFERENT_SECRET = 'different-signing-secret-at-least-32-bytes';

describe('SigningKeyRing', () => {
  it('keeps framework CSRF authority opaque and refuses generic signing sinks', async () => {
    const source = createSigningKeyRing({
      keys: [{ id: 'auth', secret: NEW_SECRET, state: 'active' }],
    });
    const capability = createFrameworkCsrfSigningSecret(source);

    expect(Object.isFrozen(capability)).toBe(true);
    expect(Reflect.ownKeys(capability)).toEqual([]);
    expect(capability).not.toHaveProperty('currentKeyId');
    expect(capability).not.toHaveProperty('sign');
    expect(capability).not.toHaveProperty('verify');
    expect(isFrameworkCsrfSigningSecret(capability)).toBe(true);
    expect(isSigningKeyRing(capability)).toBe(false);
    expect(isFrameworkCsrfSigningSecret({} as unknown as typeof capability)).toBe(false);
    expect(() => signingKeyRingFromSecret({} as unknown as typeof capability)).toThrow(
      /exact framework-minted token/u,
    );
    await expect(signCapability(capability, { key: 'private/report.pdf' })).rejects.toThrow(
      /only permits csrf, anonymous-csrf/u,
    );
  });

  it('limits a framework CSRF token to CSRF and the exact live-target audience', () => {
    const source = createSigningKeyRing({
      keys: [{ id: 'auth', secret: NEW_SECRET, state: 'active' }],
    });
    const capability = createFrameworkCsrfSigningSecret(source);
    const scoped = signingKeyRingFromSecret(capability);
    for (const purpose of ['csrf', 'anonymous-csrf'] as const) {
      const signed = scoped.sign({ audience: 'auth/sign-in', payload: 'binding-1', purpose });
      expect(
        scoped.verify({
          audience: 'auth/sign-in',
          keyId: signed.keyId,
          payload: 'binding-1',
          purpose,
          signature: signed.signature,
        }),
      ).toEqual({ keyId: 'auth', ok: true });
    }
    expect(() =>
      scoped.sign({
        audience: 'storage-download',
        payload: 'binding-1',
        purpose: 'capability-url',
      }),
    ).toThrow(/only permits csrf, anonymous-csrf/u);
    expect(() =>
      scoped.sign({
        audience: 'attacker-chosen-live-target',
        payload: 'binding-1',
        purpose: 'live-target-attestation',
      }),
    ).toThrow(/mutation-live-target/u);
    expect(() =>
      scoped.verify({
        audience: 'storage-download',
        payload: 'binding-1',
        purpose: 'session-fingerprint',
        signature: 'forged',
      }),
    ).toThrow(/only permits csrf, anonymous-csrf/u);

    const live = scoped.sign({
      audience: 'mutation-live-target',
      payload: 'descriptor',
      purpose: 'live-target-attestation',
    });
    expect(
      scoped.verify({
        audience: 'mutation-live-target',
        keyId: live.keyId,
        payload: 'descriptor',
        purpose: 'live-target-attestation',
        signature: live.signature,
      }),
    ).toEqual({ keyId: 'auth', ok: true });

    const fingerprint = signSessionFingerprintWithSecret(capability, 'principal-1');
    expect(
      source.verify({
        audience: 'broadcast-channel-session-fingerprint',
        payload: 'principal-1',
        purpose: 'session-fingerprint',
        signature: fingerprint,
      }),
    ).toEqual({ keyId: 'auth', ok: true });
    expect(() =>
      scoped.sign({
        audience: 'broadcast-channel-session-fingerprint',
        payload: 'principal-1',
        purpose: 'session-fingerprint',
      }),
    ).toThrow(/only permits csrf, anonymous-csrf/u);
  });

  it('rejects hostile scoped-signing carriers before traps and forwards only a pinned snapshot', () => {
    let signInput: SigningInput | undefined;
    let verifyInput: SigningVerifyInput | undefined;
    const originalSignInput: SigningInput = {
      audience: 'auth/sign-in',
      payload: 'session-1',
      purpose: 'csrf',
    };
    const originalVerifyInput: SigningVerifyInput = {
      ...originalSignInput,
      keyId: 'source',
      signature: 'signature',
    };
    const capability = createFrameworkCsrfSigningSecret({
      currentKeyId: 'source',
      sign(input) {
        signInput = input;
        originalSignInput.audience = 'attacker-audience';
        originalSignInput.purpose = 'capability-url';
        return { keyId: 'source', signature: 'signature' };
      },
      verify(input) {
        verifyInput = input;
        originalVerifyInput.audience = 'attacker-audience';
        originalVerifyInput.purpose = 'capability-url';
        return { keyId: 'source', ok: true };
      },
    });
    const scoped = signingKeyRingFromSecret(capability);

    expect(scoped.sign(originalSignInput)).toEqual({ keyId: 'source', signature: 'signature' });
    expect(signInput).not.toBe(originalSignInput);
    expect(Object.getPrototypeOf(signInput!)).toBeNull();
    expect(Object.isFrozen(signInput)).toBe(true);
    expect(signInput).toMatchObject({ audience: 'auth/sign-in', purpose: 'csrf' });

    expect(scoped.verify(originalVerifyInput)).toEqual({ keyId: 'source', ok: true });
    expect(verifyInput).not.toBe(originalVerifyInput);
    expect(Object.getPrototypeOf(verifyInput!)).toBeNull();
    expect(Object.isFrozen(verifyInput)).toBe(true);
    expect(verifyInput).toMatchObject({ audience: 'auth/sign-in', purpose: 'csrf' });

    let proxyTrapHits = 0;
    const hostile = new Proxy(
      {},
      {
        get() {
          proxyTrapHits += 1;
          return 'capability-url';
        },
        getOwnPropertyDescriptor() {
          proxyTrapHits += 1;
          return { configurable: true, enumerable: true, value: 'csrf', writable: true };
        },
      },
    ) as unknown as SigningInput;
    expect(() => scoped.sign(hostile)).toThrow(/must not be a Proxy/u);
    expect(() => scoped.verify(hostile as SigningVerifyInput)).toThrow(/must not be a Proxy/u);
    expect(proxyTrapHits).toBe(0);

    let accessorHits = 0;
    const accessor = { audience: 'auth/sign-in', payload: 'session-1' } as Record<string, unknown>;
    Object.defineProperty(accessor, 'purpose', {
      get() {
        accessorHits += 1;
        return 'csrf';
      },
    });
    expect(() => scoped.sign(accessor as unknown as SigningInput)).toThrow(
      /stable own data property/u,
    );
    expect(accessorHits).toBe(0);
  });

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
    const byteLengthDescriptor = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength');
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
