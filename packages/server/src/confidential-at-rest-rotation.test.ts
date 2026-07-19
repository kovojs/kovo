import { describe, expect, it } from 'vitest';

import {
  createConfidentialAtRestCipher,
  decryptAtRest,
  encryptAtRest,
} from './confidential-at-rest.js';
import { createSigningKeyRing } from './keyring.js';

const oldRoot = 'old-confidential-root-secret-at-least-32-bytes';
const newRoot = 'new-confidential-root-secret-at-least-32-bytes';

function cipherFor(
  ring = createSigningKeyRing({
    keys: [{ id: 'new', secret: newRoot, state: 'active' }],
  }),
) {
  return createConfidentialAtRestCipher(ring, { audience: 'profiles.ssn' });
}

describe('SPEC §6.6 confidential-at-rest rotation envelope', () => {
  it('uses active-only v2 sealing and authenticates audience, key id, and caller AAD', () => {
    const cipher = cipherFor();
    const envelope = encryptAtRest('123-45-6789', cipher, { aad: 'tenant:one' });
    expect(envelope).toMatch(/^kovo-aes256gcm-v2\.new\./u);
    expect(new TextDecoder().decode(decryptAtRest(envelope, cipher, { aad: 'tenant:one' }))).toBe(
      '123-45-6789',
    );
    expect(() => decryptAtRest(envelope, cipher, { aad: 'tenant:two' })).toThrow(
      /cannot be opened/u,
    );
    expect(() =>
      decryptAtRest(envelope.replace('.new.', '.old.'), cipher, { aad: 'tenant:one' }),
    ).toThrow(/cannot be opened/u);
  });

  it('opens previous keys only inside the finite overlap and rejects revoked/expired keys', () => {
    const oldRing = createSigningKeyRing({
      keys: [{ id: 'old', secret: oldRoot, state: 'active' }],
    });
    const envelope = encryptAtRest(
      'previous-value',
      createConfidentialAtRestCipher(oldRing, {
        audience: 'profiles.ssn',
      }),
    );
    const rotated = createSigningKeyRing({
      keys: [
        { id: 'new', secret: newRoot, state: 'active' },
        { id: 'old', secret: oldRoot, state: 'previous', acceptUntil: Date.now() + 60_000 },
      ],
    });
    expect(new TextDecoder().decode(decryptAtRest(envelope, cipherFor(rotated)))).toBe(
      'previous-value',
    );

    const expired = createSigningKeyRing({
      keys: [
        { id: 'new', secret: newRoot, state: 'active' },
        { id: 'old', secret: oldRoot, state: 'previous', acceptUntil: 1 },
      ],
    });
    expect(() => decryptAtRest(envelope, cipherFor(expired))).toThrow(/cannot be opened/u);
    const revoked = createSigningKeyRing({
      keys: [
        { id: 'new', secret: newRoot, state: 'active' },
        { id: 'old', state: 'revoked' },
      ],
    });
    expect(() => decryptAtRest(envelope, cipherFor(revoked))).toThrow(/cannot be opened/u);
  });

  it('rejects structural handle forgeries and the former raw-key/caller-key-id call shape', () => {
    expect(() =>
      encryptAtRest(
        'private',
        new Uint8Array(32) as unknown as ReturnType<typeof createConfidentialAtRestCipher>,
        { aad: 'profiles.ssn' },
      ),
    ).toThrow(/framework-minted confidential-at-rest cipher/u);
    expect(() =>
      createConfidentialAtRestCipher(
        { currentKeyId: 'forged' } as unknown as Parameters<
          typeof createConfidentialAtRestCipher
        >[0],
        { audience: 'profiles.ssn' },
      ),
    ).toThrow(/exact framework signing key ring/u);
  });
});
