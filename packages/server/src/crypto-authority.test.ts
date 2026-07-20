import { describe, expect, it } from 'vitest';

import {
  createCapabilityCryptoHandle,
  createCsrfCryptoHandle,
  cryptoPurposeRegistry,
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
    const signed = capability.sign('same-payload');

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
});
