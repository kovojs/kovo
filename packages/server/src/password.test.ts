import { spawnSync } from 'node:child_process';

import { beforeEach, describe, expect, it, vi } from 'vitest';

type PasswordModule = typeof import('./password.js');

const argon2Mock = vi.hoisted(() => ({
  verify: vi.fn(),
}));

let passwordApi: PasswordModule;
const passwordModuleUrl = new URL('./password.ts', import.meta.url).href;

describe('password primitive: argon2id-only sink', () => {
  beforeEach(async () => {
    vi.resetModules();
    argon2Mock.verify.mockReset();
    vi.doMock('@node-rs/argon2', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@node-rs/argon2')>();
      argon2Mock.verify.mockImplementation(actual.verify);

      return {
        ...actual,
        verify: argon2Mock.verify,
      };
    });
    passwordApi = await import('./password.js');
    argon2Mock.verify.mockClear();
  });

  const hashPassword = (...args: Parameters<PasswordModule['hashPassword']>) =>
    passwordApi.hashPassword(...args);
  const isArgon2idPasswordDigest = (
    ...args: Parameters<PasswordModule['isArgon2idPasswordDigest']>
  ) => passwordApi.isArgon2idPasswordDigest(...args);
  const verifyCredential = (...args: Parameters<PasswordModule['verifyCredential']>) =>
    passwordApi.verifyCredential(...args);
  const verifyPassword = (...args: Parameters<PasswordModule['verifyPassword']>) =>
    passwordApi.verifyPassword(...args);

  it('hashes passwords as argon2id/v=19 PHC digests with Kovo defaults', async () => {
    const digest = await hashPassword('correct horse battery staple');

    expect(digest).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(isArgon2idPasswordDigest(digest)).toBe(true);
  });

  it('binds Argon2 before late resolver hooks can replace password work', () => {
    const forgedModule =
      'data:text/javascript,' +
      encodeURIComponent(
        'export async function hash(){throw new Error("resolver-poisoned Argon2")} ' +
          'export async function verify(){return true}',
      );
    const script = `
      const { registerHooks } = await import('node:module');
      const password = await import(${JSON.stringify(`${passwordModuleUrl}?boot-pinned-argon2`)});
      let poisonHits = 0;
      registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier === '@node-rs/argon2') {
            poisonHits += 1;
            return nextResolve(${JSON.stringify(forgedModule)}, context);
          }
          return nextResolve(specifier, context);
        },
      });
      try {
        const digest = await password.hashPassword('correct horse battery staple');
        process.exit(
          poisonHits === 0 && digest.startsWith('$argon2id$v=19$m=19456,t=2,p=1$') ? 0 : 3,
        );
      } catch {
        process.exit(3);
      }
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
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

  it('requires exact boolean true from the Argon2 verifier', async () => {
    const digest = await hashPassword('correct horse battery staple');
    argon2Mock.verify.mockResolvedValueOnce('truthy-forgery' as unknown as boolean);

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

  it('rejects a real Argon2i digest after late PHC parser poisoning', async () => {
    const { hash } = await import('@node-rs/argon2');
    const digest = await hash('correct horse battery staple', {
      algorithm: 1,
      memoryCost: 19 * 1024,
      outputLen: 32,
      parallelism: 1,
      timeCost: 2,
      version: 1,
    });
    expect(digest).toMatch(/^\$argon2i\$/u);

    const originalStartsWith = String.prototype.startsWith;
    const originalSplit = String.prototype.split;
    const originalIndexOf = String.prototype.indexOf;
    try {
      String.prototype.startsWith = function (search, position) {
        if (this.valueOf() === digest && search === '$argon2id$') return true;
        return Reflect.apply(originalStartsWith, this, [search, position]);
      };
      String.prototype.split = function (separator, limit) {
        if (this.valueOf() === digest && separator === '$') {
          const forged = digest.replace('$argon2i$', '$argon2id$');
          return Reflect.apply(originalSplit, forged, [separator, limit]);
        }
        return Reflect.apply(originalSplit, this, [separator, limit]);
      };
      String.prototype.indexOf = function (search, position) {
        if (this.valueOf() === digest && search === '$') return -1;
        return Reflect.apply(originalIndexOf, this, [search, position]);
      };

      expect(isArgon2idPasswordDigest(digest)).toBe(false);
      await expect(verifyPassword('correct horse battery staple', digest)).resolves.toEqual({
        ok: false,
        needsRehash: false,
      });
    } finally {
      String.prototype.startsWith = originalStartsWith;
      String.prototype.split = originalSplit;
      String.prototype.indexOf = originalIndexOf;
    }

    expect(argon2Mock.verify).not.toHaveBeenCalled();
  });

  it('preserves exact Argon2id bytes and rehash facts after late scalar poisoning', async () => {
    const digest = await hashPassword('password', { memoryCost: 19 * 1024 });
    const parts = digest.split('$');
    const originalSplit = String.prototype.split;
    const originalExec = RegExp.prototype.exec;
    const originalIsSafeInteger = Number.isSafeInteger;
    let result: Awaited<ReturnType<PasswordModule['verifyPassword']>>;
    try {
      String.prototype.split = function (separator, limit) {
        if (this.valueOf() === digest && separator === '$') return [];
        return Reflect.apply(originalSplit, this, [separator, limit]);
      };
      RegExp.prototype.exec = function (value) {
        if (value === parts[3] || value === parts[4] || value === parts[5]) return null;
        return Reflect.apply(originalExec, this, [value]);
      };
      Number.isSafeInteger = () => false;
      result = await verifyPassword('password', digest, { memoryCost: 20 * 1024 });
    } finally {
      String.prototype.split = originalSplit;
      RegExp.prototype.exec = originalExec;
      Number.isSafeInteger = originalIsSafeInteger;
    }

    expect(result).toEqual({ ok: true, needsRehash: true });
    expect(argon2Mock.verify).toHaveBeenCalledTimes(1);
    expect(argon2Mock.verify.mock.calls[0]?.[0]).toBe(digest);
  });

  it('does not expose legacy algorithm knobs through accepted options', () => {
    const optionKeys = Object.keys(passwordApi.PASSWORD_ARGON2ID_DEFAULTS);

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

  it('keeps option integer validation closed after late Number poisoning', async () => {
    const originalIsSafeInteger = Number.isSafeInteger;
    try {
      Number.isSafeInteger = () => true;
      await expect(hashPassword('password', { memoryCost: Number.NaN })).rejects.toThrow(
        'memoryCost must be a safe integer',
      );
    } finally {
      Number.isSafeInteger = originalIsSafeInteger;
    }
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

  it('decoy digest encodes the configured params, not the floor, preventing user-enumeration timing oracle (bugz M3)', async () => {
    // SPEC §6.6: absent-account verify work must match present-account work at any cost level.
    // Previously the decoy was pinned at the compile-time floor (m=19456,t=2,p=1), so apps
    // storing stronger digests (e.g. memoryCost:65536) had a ~4x timing gap that leaked existence.
    // The fix derives the decoy from the call's resolved params and caches it per param-set.

    // Use params above the floor so the encoded m/t/p in the decoy PHC header are distinct.
    await verifyCredential('candidate', undefined, {
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 2,
    });

    expect(argon2Mock.verify).toHaveBeenCalledTimes(1);
    const decoyDigest: string = argon2Mock.verify.mock.calls[0]![0];

    // The decoy's PHC-encoded m/t/p must reflect the hardened params, not the compile-time floor.
    // argon2 derives its work cost from these encoded values, so this is the deterministic
    // correctness check that absent-account cost matches present-account cost.
    expect(decoyDigest).toMatch(/\$argon2id\$v=19\$/);
    expect(decoyDigest).toMatch(/\$m=65536,t=3,p=2\$/);
  });

  it('keeps the configured decoy cost after late Map cache poisoning', async () => {
    const forgedFloorDigest = await hashPassword('attacker-controlled-cache-value');
    argon2Mock.verify.mockClear();
    const originalGet = Map.prototype.get;
    try {
      Map.prototype.get = function (key) {
        if (key === 'm=65536,t=3,p=2,len=32') return Promise.resolve(forgedFloorDigest);
        return Reflect.apply(originalGet, this, [key]);
      };
      await expect(
        verifyCredential('candidate', undefined, {
          memoryCost: 65_536,
          parallelism: 2,
          timeCost: 3,
        }),
      ).resolves.toEqual({ ok: false, needsRehash: false });
    } finally {
      Map.prototype.get = originalGet;
    }

    expect(argon2Mock.verify).toHaveBeenCalledTimes(1);
    expect(argon2Mock.verify.mock.calls[0]?.[0]).toMatch(/\$m=65536,t=3,p=2\$/u);
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

  it('fails closed when PHC controls were poisoned before module initialization', () => {
    const script = `
      String.prototype.indexOf = () => -1;
      try {
        const password = await import(${JSON.stringify(`${passwordModuleUrl}?poisoned-password-probe`)});
        password.assertPasswordIntrinsics();
      } catch (error) {
        if (String(error).includes('intrinsics were modified')) process.exit(0);
      }
      process.exit(3);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
