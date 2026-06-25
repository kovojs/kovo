import { describe, expect, it } from 'vitest';

import { createSigningKeyRing } from './keyring.js';

describe('SigningKeyRing', () => {
  it('signs with the single active key and verifies with previous non-revoked keys', () => {
    const previousOnly = createSigningKeyRing({
      keys: [{ id: 'old', secret: 'old-signing-secret', state: 'active' }],
    });
    const old = previousOnly.sign({
      audience: 'storage-download:/files',
      payload: 'payload',
      purpose: 'capability-url',
    });

    const rotated = createSigningKeyRing({
      keys: [
        { id: 'new', secret: 'new-signing-secret', state: 'active' },
        { id: 'old', secret: 'old-signing-secret', state: 'previous' },
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
      keys: [{ id: 'old', secret: 'old-signing-secret', state: 'active' }],
    });
    const revokedToken = revokedOnly.sign({
      audience: 'csrf:cart/add',
      payload: 'session-1',
      purpose: 'csrf',
    });

    const rotated = createSigningKeyRing({
      keys: [
        { id: 'new', secret: 'new-signing-secret', state: 'active' },
        { id: 'old', secret: 'old-signing-secret', state: 'revoked' },
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
      keys: [{ id: 'current', secret: 'signing-secret', state: 'active' }],
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
        keys: [{ id: 'different', secret: 'different-secret', state: 'active' }],
      }).verify({
        audience: 'storage-download:/files',
        keyId: 'missing',
        payload: 'payload',
        purpose: 'capability-url',
        signature,
      }),
    ).toEqual({ ok: false, reason: 'unknown-key' });
  });

  it('fails closed for missing or invalid signing material', () => {
    expect(() => createSigningKeyRing({ keys: [] })).toThrow(/exactly one active key/);
    expect(() =>
      createSigningKeyRing({ keys: [{ id: 'current', secret: '', state: 'active' }] }),
    ).toThrow(/empty signing material/);
    expect(() =>
      createSigningKeyRing({
        keys: [
          { id: 'a', secret: 'one', state: 'active' },
          { id: 'b', secret: 'two', state: 'active' },
        ],
      }),
    ).toThrow(/exactly one active key/);
  });
});
