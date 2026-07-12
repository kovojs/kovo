import { describe, expect, it } from 'vitest';
import { createCipheriv, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';

import { encryptAtRest } from './confidential-at-rest.js';

const confidentialIntrinsicModuleUrl = new URL(
  './confidential-at-rest-intrinsics.ts',
  import.meta.url,
).href;
const confidentialModuleUrl = new URL('./confidential-at-rest.ts', import.meta.url).href;
const securityBootstrapModuleUrl = new URL('./security-bootstrap.ts', import.meta.url).href;
const mutableCrypto = createRequire(import.meta.url)('node:crypto') as {
  createCipheriv: typeof createCipheriv;
  randomBytes: typeof randomBytes;
};

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

  it('keeps the 96-bit IV source pinned after synchronized builtin replacement', () => {
    const originalRandomBytes = mutableCrypto.randomBytes;
    let ambientWasConstant = false;
    try {
      mutableCrypto.randomBytes = ((size: number) =>
        Buffer.alloc(size, 0x42)) as typeof randomBytes;
      syncBuiltinESMExports();
      ambientWasConstant = mutableCrypto.randomBytes(12).every((byte) => byte === 0x42);

      const key = new Uint8Array(32).fill(7);
      const first = encryptAtRest('first plaintext', key, { aad: 'profiles.secret' });
      const second = encryptAtRest('second plaintext', key, { aad: 'profiles.secret' });
      expect(first.split('.')[2]).not.toBe(second.split('.')[2]);
    } finally {
      mutableCrypto.randomBytes = originalRandomBytes;
      syncBuiltinESMExports();
    }
    expect(ambientWasConstant).toBe(true);
  });

  it('keeps createCipheriv and envelope controls pinned after late replacement', () => {
    const originalCreateCipheriv = mutableCrypto.createCipheriv;
    const originalJoin = Array.prototype.join;
    const originalExec = RegExp.prototype.exec;
    const originalTrim = String.prototype.trim;
    const originalBufferToString = Buffer.prototype.toString;
    let poisonedCreateCalls = 0;
    let encrypted = '';
    try {
      mutableCrypto.createCipheriv = ((...args: Parameters<typeof createCipheriv>) => {
        poisonedCreateCalls += 1;
        return originalCreateCipheriv(...args);
      }) as typeof createCipheriv;
      syncBuiltinESMExports();
      Array.prototype.join = () => 'ATTACKER-ENVELOPE';
      RegExp.prototype.exec = () => null;
      String.prototype.trim = () => '';
      Buffer.prototype.toString = () => 'ATTACKER-BYTES';

      encrypted = encryptAtRest('private-value', new Uint8Array(32).fill(7), {
        aad: new TextEncoder().encode('profiles.secret'),
        keyId: 'k1',
      });
    } finally {
      mutableCrypto.createCipheriv = originalCreateCipheriv;
      syncBuiltinESMExports();
      Array.prototype.join = originalJoin;
      RegExp.prototype.exec = originalExec;
      String.prototype.trim = originalTrim;
      Buffer.prototype.toString = originalBufferToString;
    }
    expect(poisonedCreateCalls).toBe(0);
    expect(encrypted).toMatch(
      /^kovo-aes256gcm-v1\.k1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
    );
    expect(encrypted).not.toContain('ATTACKER');
  });

  it('rejects accessor-backed encryption options before consuming AAD or key metadata', () => {
    const key = new Uint8Array(32).fill(7);
    expect(() =>
      encryptAtRest('private-value', key, {
        get aad() {
          return 'profiles.secret';
        },
      }),
    ).toThrow(/changed while|own data property/);
    expect(() =>
      encryptAtRest('private-value', key, {
        aad: 'profiles.secret',
        get keyId() {
          return 'k1';
        },
      }),
    ).toThrow(/changed while|own data property/);
  });

  it('fails closed when a constant random source exists before framework import', () => {
    const script = `
      const { createRequire, syncBuiltinESMExports } = await import('node:module');
      const mutable = createRequire(import.meta.url)('node:crypto');
      mutable.randomBytes = function randomBytes(size, callback) {
        const bytes = Buffer.alloc(size, 0x42);
        if (typeof callback === 'function') { callback(null, bytes); return; }
        return bytes;
      };
      syncBuiltinESMExports();
      try {
        const controls = await import(${JSON.stringify(`${confidentialIntrinsicModuleUrl}?constant-random`)});
        controls.assertConfidentialAtRestIntrinsics();
      } catch (error) {
        if (String(error).includes('crypto or realm intrinsics were modified')) process.exit(0);
      }
      process.exit(3);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('rejects a repeated IV even if a staged source passes its boot probes', () => {
    const script = `
      const { createRequire, syncBuiltinESMExports } = await import('node:module');
      const mutable = createRequire(import.meta.url)('node:crypto');
      const originalRandomBytes = mutable.randomBytes;
      const originalToString = Function.prototype.toString;
      const genuineSource = Reflect.apply(originalToString, originalRandomBytes, []);
      let calls = 0;
      function randomBytes(size, callback) {
        calls += 1;
        const bytes = Buffer.alloc(size, calls === 1 ? 0x11 : calls === 2 ? 0x22 : 0x42);
        if (typeof callback === 'function') { callback(null, bytes); return; }
        return bytes;
      }
      Function.prototype.toString = function () {
        if (this === randomBytes) return genuineSource;
        return Reflect.apply(originalToString, this, []);
      };
      mutable.randomBytes = randomBytes;
      syncBuiltinESMExports();
      const controls = await import(${JSON.stringify(`${confidentialIntrinsicModuleUrl}?staged-repeat-iv`)});
      controls.assertConfidentialAtRestIntrinsics();
      const plaintext = Buffer.from('private');
      const key = Buffer.alloc(32, 7);
      const aad = Buffer.from('profiles.secret');
      controls.confidentialEncryptEnvelope(plaintext, key, aad, undefined);
      try {
        controls.confidentialEncryptEnvelope(plaintext, key, aad, undefined);
      } catch (error) {
        if (String(error).includes('refusing nonce reuse')) process.exit(0);
      }
      process.exit(3);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('uses boot-pinned Buffer copying after a selective late wrapper is installed', () => {
    const script = `
      const { existsSync } = await import('node:fs');
      const { createRequire, registerHooks } = await import('node:module');
      registerHooks({ resolve(specifier, context, nextResolve) {
        if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
          const candidate = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
          if (existsSync(candidate)) return nextResolve(candidate.href, context);
        }
        return nextResolve(specifier, context);
      }});
      await import(${JSON.stringify(`${securityBootstrapModuleUrl}?confidential-runner`)});
      const NativeBuffer = createRequire(import.meta.url)('node:buffer').Buffer;
      const originalFrom = NativeBuffer.from;
      let wrappedTargetCalls = 0;
      NativeBuffer.from = function from(value, encodingOrOffset, length) {
        if (value === 'private') {
          wrappedTargetCalls += 1;
          return Reflect.apply(originalFrom, NativeBuffer, ['attacker', encodingOrOffset, length]);
        }
        return Reflect.apply(originalFrom, NativeBuffer, [value, encodingOrOffset, length]);
      };
      const api = await import(${JSON.stringify(`${confidentialModuleUrl}?post-bootstrap-buffer-from`)});
      const envelope = api.encryptAtRest('private', Buffer.alloc(32, 7), { aad: 'profiles.secret' });
      process.exit(envelope.startsWith('kovo-aes256gcm-v1.') && wrappedTargetCalls === 0 ? 0 : 3);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('fails closed when a cipher method is poisoned before framework import', () => {
    const script = `
      const { createCipheriv } = await import('node:crypto');
      const control = createCipheriv('aes-256-gcm', Buffer.alloc(32), Buffer.alloc(12));
      let owner = Object.getPrototypeOf(control);
      while (owner && !Object.prototype.hasOwnProperty.call(owner, 'update')) {
        owner = Object.getPrototypeOf(owner);
      }
      owner.update = () => Buffer.from('attacker');
      try {
        const controls = await import(${JSON.stringify(`${confidentialIntrinsicModuleUrl}?poisoned-cipher`)});
        controls.assertConfidentialAtRestIntrinsics();
      } catch (error) {
        if (String(error).includes('crypto or realm intrinsics were modified')) process.exit(0);
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
