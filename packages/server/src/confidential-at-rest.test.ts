import { describe, expect, it } from 'vitest';
import { createCipheriv } from 'node:crypto';

import { encryptAtRest } from './confidential-at-rest.js';

describe('encryptAtRest', () => {
  it('encrypts with AES-256-GCM using a random IV and serialized envelope', () => {
    const key = new Uint8Array(32).fill(7);

    const first = encryptAtRest('123-45-6789', key, { aad: 'profiles.ssn', keyId: 'k1' });
    const second = encryptAtRest('123-45-6789', key, { aad: 'profiles.ssn', keyId: 'k1' });

    expect(first).toMatch(
      /^kovo-aes256gcm-v1\.k1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
    );
    expect(second).toMatch(/^kovo-aes256gcm-v1\.k1\./u);
    expect(first).not.toEqual(second);
    expect(first).not.toContain('123-45-6789');
  });

  it('refuses weak keys and missing authenticated context', () => {
    expect(() => encryptAtRest('secret', new Uint8Array(16), { aad: 'profiles.ssn' })).toThrow(
      /32-byte AES-256-GCM key/u,
    );
    expect(() => encryptAtRest('secret', new Uint8Array(32), { aad: '   ' })).toThrow(
      /non-empty authenticated context/u,
    );
  });

  it('does not dispatch plaintext through a post-import poisoned Cipher update method', () => {
    const control = createCipheriv('aes-256-gcm', new Uint8Array(32), new Uint8Array(12));
    let owner = Object.getPrototypeOf(control);
    while (owner && !Object.prototype.hasOwnProperty.call(owner, 'update')) {
      owner = Object.getPrototypeOf(owner);
    }
    const originalUpdate = owner.update;
    try {
      owner.update = () => {
        throw new Error('poisoned cipher update received plaintext');
      };
      const encrypted = encryptAtRest('private-value', new Uint8Array(32).fill(7), {
        aad: 'profiles.secret',
      });
      expect(encrypted).not.toContain('private-value');
    } finally {
      owner.update = originalUpdate;
    }
  });
});
