import { describe, expect, it } from 'vitest';

import {
  createBetterAuthPasswordResetCryptoHandle,
  createCapabilityCryptoHandle,
  createCsrfCryptoHandle,
  createPrincipalErasureCryptoHandle,
  createSessionFingerprintCryptoHandle,
  cryptoPurposeRegistry,
  mintLiveTargetLocalAudienceNonce,
} from './crypto-authority.js';
import { createSigningKeyRing } from './keyring.js';

const root = 'crypto-authority-test-root-secret-at-least-32-bytes';

describe('SPEC §6.6 purpose-bound crypto authority', () => {
  it('exposes one frozen closed purpose registry and no string-selected generic factory', async () => {
    expect(Object.isFrozen(cryptoPurposeRegistry)).toBe(true);
    expect(cryptoPurposeRegistry.map((row) => row.purpose)).toEqual([
      'anonymous-csrf',
      'better-auth-rate-limit',
      'capability-url',
      'confidential-at-rest',
      'csrf',
      'live-target-attestation',
      'principal-erasure-receipt',
      'rendered-html-coercion',
      'session-fingerprint',
      'runtime-posture-attestation',
      'security-event-chain',
    ]);
    expect(await import('./crypto-authority.js')).not.toHaveProperty('createCryptoHandle');
    expect(await import('./crypto-authority.js')).not.toHaveProperty('deriveKey');
  });

  // @kovo-security-classifier-corpus C13 crypto-purpose-domain-separation
  it('HKDF-separates purpose and audience even under one root', () => {
    const ring = createSigningKeyRing({
      keys: [{ id: 'current', secret: root, state: 'active' }],
    });
    const capability = createCapabilityCryptoHandle(ring, 'storage-download');
    const otherAudience = createCapabilityCryptoHandle(ring, 'other-storage');
    const csrf = createCsrfCryptoHandle(ring, 'csrf', 'storage-download');
    const principalErasure = createPrincipalErasureCryptoHandle(ring);
    const signed = capability.sign('same-payload');
    const erasureSigned = principalErasure.sign('same-payload');

    expect(capability.verify('same-payload', signed.signature, signed.keyId)).toEqual({
      keyId: 'current',
      ok: true,
    });
    expect(otherAudience.verify('same-payload', signed.signature, signed.keyId)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
    expect(csrf.verify('same-payload', signed.signature, signed.keyId)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
    expect(principalErasure.verify('same-payload', signed.signature, signed.keyId)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
    expect(capability.verify('same-payload', erasureSigned.signature, erasureSigned.keyId)).toEqual(
      {
        ok: false,
        reason: 'bad-signature',
      },
    );
  });

  it('returns frozen purpose-minimal handles without primitive or key escape', () => {
    const ring = createSigningKeyRing({
      keys: [{ id: 'current', secret: root, state: 'active' }],
    });
    const handle = createCapabilityCryptoHandle(ring, 'storage-download');
    expect(Object.isFrozen(handle)).toBe(true);
    expect(Reflect.ownKeys(handle).sort()).toEqual(['currentKeyId', 'sign', 'verify']);
    expect(handle).not.toHaveProperty('secret');
    expect(handle).not.toHaveProperty('derive');
    expect(handle).not.toHaveProperty('seal');
  });

  it('exposes password-reset entropy only as a fixed-width purpose-minimal decoy token', () => {
    const handle = createBetterAuthPasswordResetCryptoHandle();
    const token = handle.mintDecoyToken();

    expect(Object.isFrozen(handle)).toBe(true);
    expect(Reflect.ownKeys(handle)).toEqual(['mintDecoyToken']);
    expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/u);
    expect(handle.mintDecoyToken()).not.toBe(token);
    expect(handle).not.toHaveProperty('randomBytes');
    expect(handle).not.toHaveProperty('sign');
  });

  it('keeps the process-local session-fingerprint root behind a sign-only handle', () => {
    const first = createSessionFingerprintCryptoHandle();
    const second = createSessionFingerprintCryptoHandle();
    const fingerprint = first.sign('principal:user-1');

    expect(Object.isFrozen(first)).toBe(true);
    expect(Reflect.ownKeys(first).sort()).toEqual(['currentKeyId', 'sign']);
    expect(second.sign('principal:user-1')).toEqual(fingerprint);
    expect(first.sign('principal:user-2').signature).not.toBe(fingerprint.signature);
    expect(first).not.toHaveProperty('secret');
    expect(first).not.toHaveProperty('randomBytes');
    expect(first).not.toHaveProperty('verify');
  });

  it('mints only a fixed-width opaque live-target local-audience nonce', () => {
    const first = mintLiveTargetLocalAudienceNonce();
    const second = mintLiveTargetLocalAudienceNonce();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(second).not.toBe(first);
  });
});
