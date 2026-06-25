import { beforeEach, describe, expect, it, vi } from 'vitest';

const argon2Mock = vi.hoisted(() => ({
  verify: vi.fn(),
}));

vi.mock('@node-rs/argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@node-rs/argon2')>();
  argon2Mock.verify.mockImplementation(actual.verify);

  return {
    ...actual,
    verify: argon2Mock.verify,
  };
});

import {
  PASSWORD_ARGON2ID_DEFAULTS,
  hashPassword,
  isArgon2idPasswordDigest,
  verifyCredential,
  verifyPassword,
} from './password.js';

describe('password primitive: argon2id-only sink', () => {
  beforeEach(() => {
    argon2Mock.verify.mockClear();
  });

  it('hashes passwords as argon2id/v=19 PHC digests with Kovo defaults', async () => {
    const digest = await hashPassword('correct horse battery staple');

    expect(digest).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(isArgon2idPasswordDigest(digest)).toBe(true);
  });

  it('verifies the correct password without requiring a rehash at the default floor', async () => {
    const digest = await hashPassword('correct horse battery staple');

    await expect(verifyPassword('correct horse battery staple', digest)).resolves.toEqual({
      ok: true,
      needsRehash: false,
    });
  });

  it('rejects the wrong password', async () => {
    const digest = await hashPassword('correct horse battery staple');

    await expect(verifyPassword('wrong horse battery staple', digest)).resolves.toEqual({
      ok: false,
      needsRehash: false,
    });
  });

  it('fails closed for malformed and non-argon2id digests', async () => {
    const badDigests = [
      '',
      'not-a-phc-digest',
      '$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$ZGlnZXN0',
      '$argon2d$v=19$m=19456,t=2,p=1$c2FsdA$ZGlnZXN0',
      '$bcrypt$v=19$m=19456,t=2,p=1$c2FsdA$ZGlnZXN0',
      '$argon2id$v=16$m=19456,t=2,p=1$c2FsdA$ZGlnZXN0',
      '$argon2id$v=19$m=19456,t=2$c2FsdA$ZGlnZXN0',
      '$argon2id$v=19$m=19456,t=2,p=1,sha=1$c2FsdA$ZGlnZXN0',
      '$argon2id$v=19$m=19456,t=2,p=1,p=2$c2FsdA$ZGlnZXN0',
      '$argon2id$v=19$m=0,t=2,p=1$c2FsdA$ZGlnZXN0',
      '$argon2id$v=19$m=19456,t=2,p=1$not-phc-base64?$ZGlnZXN0',
    ];

    for (const digest of badDigests) {
      expect(isArgon2idPasswordDigest(digest)).toBe(false);
      await expect(verifyPassword('password', digest)).resolves.toEqual({
        ok: false,
        needsRehash: false,
      });
    }
  });

  it('does not expose legacy algorithm knobs through accepted options', () => {
    const optionKeys = Object.keys(PASSWORD_ARGON2ID_DEFAULTS);

    expect(optionKeys).toEqual(['memoryCost', 'timeCost', 'parallelism', 'outputLen']);
    expect(optionKeys).not.toContain('algorithm');
    expect(optionKeys).not.toContain('bcrypt');
    expect(optionKeys).not.toContain('scrypt');
    expect(optionKeys).not.toContain('sha');
  });

  it('rejects parameter values below the explicit floors', async () => {
    await expect(hashPassword('password', { memoryCost: 19 * 1024 - 1 })).rejects.toThrow(
      'memoryCost must be >= 19456',
    );
    await expect(hashPassword('password', { timeCost: 1 })).rejects.toThrow(
      'timeCost must be >= 2',
    );
    await expect(hashPassword('password', { parallelism: 0 })).rejects.toThrow(
      'parallelism must be >= 1',
    );
    await expect(hashPassword('password', { outputLen: 31 })).rejects.toThrow(
      'outputLen must be >= 32',
    );
  });

  it('rejects non-integer and out-of-library-range parameters before hashing', async () => {
    await expect(hashPassword('password', { memoryCost: 19456.5 })).rejects.toThrow(
      'memoryCost must be a safe integer',
    );
    await expect(hashPassword('password', { parallelism: 256 })).rejects.toThrow(
      'parallelism must be <= 255',
    );
  });

  it('reports verified digests that need stronger parameter rehashing', async () => {
    const digest = await hashPassword('password', { memoryCost: 19 * 1024 });

    await expect(verifyPassword('password', digest, { memoryCost: 20 * 1024 })).resolves.toEqual({
      ok: true,
      needsRehash: true,
    });
  });

  it('verifies existing account credentials without exposing a separate existence bit', async () => {
    const digest = await hashPassword('correct horse battery staple');

    await expect(verifyCredential('correct horse battery staple', digest)).resolves.toEqual({
      ok: true,
      needsRehash: false,
    });
    await expect(verifyCredential('wrong horse battery staple', digest)).resolves.toEqual({
      ok: false,
      needsRehash: false,
    });
  });

  it('verifies missing account credentials against the framework decoy digest', async () => {
    await expect(verifyCredential('candidate password', undefined)).resolves.toEqual({
      ok: false,
      needsRehash: false,
    });

    expect(argon2Mock.verify).toHaveBeenCalledTimes(1);
    expect(argon2Mock.verify.mock.calls[0]![0]).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('keeps malformed stored credential behavior generic while still doing decoy work', async () => {
    await expect(verifyCredential('candidate password', undefined)).resolves.toEqual({
      ok: false,
      needsRehash: false,
    });
    const missingDigest = argon2Mock.verify.mock.calls[0]![0];

    argon2Mock.verify.mockClear();

    await expect(verifyCredential('candidate password', 'not-a-phc-digest')).resolves.toEqual({
      ok: false,
      needsRehash: false,
    });

    expect(argon2Mock.verify).toHaveBeenCalledTimes(1);
    expect(argon2Mock.verify.mock.calls[0]![0]).toBe(missingDigest);
  });

  it('reports stale but valid account digests only after successful credential verification', async () => {
    const digest = await hashPassword('password', { memoryCost: 19 * 1024 });

    await expect(verifyCredential('password', digest, { memoryCost: 20 * 1024 })).resolves.toEqual({
      ok: true,
      needsRehash: true,
    });
    await expect(
      verifyCredential('wrong password', digest, { memoryCost: 20 * 1024 }),
    ).resolves.toEqual({
      ok: false,
      needsRehash: false,
    });
  });
});
