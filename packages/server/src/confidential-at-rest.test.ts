import { createCipheriv, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';

import { describe, expect, it } from 'vitest';

import {
  createConfidentialAtRestCipher,
  decryptAtRest,
  encryptAtRest,
  rewrapAtRest,
} from './confidential-at-rest.js';
import { createSigningKeyRing } from './keyring.js';

const ROOT_SECRET = 'confidential-at-rest-test-root-at-least-32-bytes';
const cryptoAuthorityModuleUrl = new URL('./crypto-authority.ts', import.meta.url).href;
const confidentialModuleUrl = new URL('./confidential-at-rest.ts', import.meta.url).href;
const keyringModuleUrl = new URL('./keyring.ts', import.meta.url).href;
const mutableCrypto = createRequire(import.meta.url)('node:crypto') as {
  createCipheriv: typeof createCipheriv;
  randomBytes: typeof randomBytes;
};

function cipher(audience = 'profiles.ssn') {
  return createConfidentialAtRestCipher(
    createSigningKeyRing({
      keys: [{ id: 'k1', secret: ROOT_SECRET, state: 'active' }],
    }),
    { audience },
  );
}

describe('confidential-at-rest authority', () => {
  it('round-trips a randomized v2 envelope and authenticates audience plus caller AAD', () => {
    const first = encryptAtRest('123-45-6789', cipher(), { aad: 'tenant:one' });
    const second = encryptAtRest('123-45-6789', cipher(), { aad: 'tenant:one' });

    expect(first).toMatch(
      /^kovo-aes256gcm-v2\.k1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/u,
    );
    expect(first).not.toEqual(second);
    expect(first).not.toContain('123-45-6789');
    expect(new TextDecoder().decode(decryptAtRest(first, cipher(), { aad: 'tenant:one' }))).toBe(
      '123-45-6789',
    );
    expect(() => decryptAtRest(first, cipher('profiles.other'), { aad: 'tenant:one' })).toThrow(
      /cannot be opened/u,
    );
    expect(() => decryptAtRest(first, cipher(), { aad: 'tenant:two' })).toThrow(
      /cannot be opened/u,
    );
  });

  it('rewraps through the same authenticated sink under a fresh nonce', () => {
    const original = encryptAtRest('private-value', cipher());
    const rewrapped = rewrapAtRest(original, cipher());
    expect(rewrapped).not.toBe(original);
    expect(new TextDecoder().decode(decryptAtRest(rewrapped, cipher()))).toBe('private-value');
  });

  it('rejects malformed envelopes and accessor-backed configuration', () => {
    expect(() => decryptAtRest('kovo-aes256gcm-v1.k1.bad.bad.bad', cipher())).toThrow(
      /cannot be opened/u,
    );
    expect(() =>
      createConfidentialAtRestCipher(
        createSigningKeyRing({
          keys: [{ id: 'k1', secret: ROOT_SECRET, state: 'active' }],
        }),
        {
          get audience() {
            return 'profiles.ssn';
          },
        },
      ),
    ).toThrow(/changed while|own data property/u);
    expect(() =>
      encryptAtRest('private', cipher(), {
        get aad() {
          return 'tenant:one';
        },
      }),
    ).toThrow(/changed while|own data property/u);
  });

  it('does not dispatch plaintext through a post-import poisoned cipher method', () => {
    const control = createCipheriv('aes-256-gcm', new Uint8Array(32), new Uint8Array(12));
    let owner = Object.getPrototypeOf(control) as Record<string, unknown> | null;
    while (owner && !Object.prototype.hasOwnProperty.call(owner, 'update')) {
      owner = Object.getPrototypeOf(owner) as Record<string, unknown> | null;
    }
    if (owner === null) throw new Error('missing cipher update owner');
    const originalUpdate = owner.update;
    try {
      owner.update = () => {
        throw new Error('poisoned cipher update received plaintext');
      };
      expect(encryptAtRest('private-value', cipher())).not.toContain('private-value');
    } finally {
      owner.update = originalUpdate;
    }
  });

  it('keeps crypto and envelope controls pinned after late replacement', () => {
    const originalCreateCipheriv = mutableCrypto.createCipheriv;
    const originalRandomBytes = mutableCrypto.randomBytes;
    const originalJoin = Array.prototype.join;
    const originalBufferToString = Buffer.prototype.toString;
    let poisonedCreateCalls = 0;
    let envelope = '';
    try {
      mutableCrypto.createCipheriv = ((...args: Parameters<typeof createCipheriv>) => {
        poisonedCreateCalls += 1;
        return originalCreateCipheriv(...args);
      }) as typeof createCipheriv;
      mutableCrypto.randomBytes = ((size: number) =>
        Buffer.alloc(size, 0x42)) as typeof randomBytes;
      syncBuiltinESMExports();
      Array.prototype.join = () => 'ATTACKER-ENVELOPE';
      Buffer.prototype.toString = () => 'ATTACKER-BYTES';
      envelope = encryptAtRest('private-value', cipher(), {
        aad: new TextEncoder().encode('tenant:one'),
      });
    } finally {
      mutableCrypto.createCipheriv = originalCreateCipheriv;
      mutableCrypto.randomBytes = originalRandomBytes;
      syncBuiltinESMExports();
      Array.prototype.join = originalJoin;
      Buffer.prototype.toString = originalBufferToString;
    }
    expect(poisonedCreateCalls).toBe(0);
    expect(envelope).toMatch(/^kovo-aes256gcm-v2\.k1\./u);
    expect(envelope).not.toContain('ATTACKER');
  });

  it('fails closed when a constant random source exists before authority import', () => {
    const script = `
      const { existsSync } = await import('node:fs');
      const { createRequire, registerHooks, syncBuiltinESMExports } = await import('node:module');
      registerHooks({ resolve(specifier, context, nextResolve) {
        if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
          const candidate = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
          if (existsSync(candidate)) return nextResolve(candidate.href, context);
        }
        return nextResolve(specifier, context);
      }});
      const mutable = createRequire(import.meta.url)('node:crypto');
      mutable.randomBytes = function randomBytes(size, callback) {
        const bytes = Buffer.alloc(size, 0x42);
        if (typeof callback === 'function') { callback(null, bytes); return; }
        return bytes;
      };
      syncBuiltinESMExports();
      try {
        await import(${JSON.stringify(`${cryptoAuthorityModuleUrl}?constant-random`)});
      } catch (error) {
        if (String(error).includes('intrinsics were modified before framework initialization')) process.exit(0);
      }
      process.exit(3);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('rejects a repeated IV even if a staged source passes boot probes', () => {
    const script = `
      const { existsSync } = await import('node:fs');
      const { createRequire, registerHooks, syncBuiltinESMExports } = await import('node:module');
      registerHooks({ resolve(specifier, context, nextResolve) {
        if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
          const candidate = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
          if (existsSync(candidate)) return nextResolve(candidate.href, context);
        }
        return nextResolve(specifier, context);
      }});
      const mutable = createRequire(import.meta.url)('node:crypto');
      let calls = 0;
      let repeat = false;
      mutable.randomBytes = function randomBytes(size, callback) {
        calls += 1;
        const bytes = Buffer.alloc(size, repeat ? 0x42 : (calls % 251) + 1);
        if (typeof callback === 'function') { callback(null, bytes); return; }
        return bytes;
      };
      syncBuiltinESMExports();
      const [{ createSigningKeyRing }, api] = await Promise.all([
        import(${JSON.stringify(keyringModuleUrl)}),
        import(${JSON.stringify(`${confidentialModuleUrl}?staged-repeat-iv`)}),
      ]);
      repeat = true;
      const ring = createSigningKeyRing({ keys: [{ id: 'k1', secret: ${JSON.stringify(ROOT_SECRET)}, state: 'active' }] });
      const cipher = api.createConfidentialAtRestCipher(ring, { audience: 'profiles.ssn' });
      api.encryptAtRest('first', cipher);
      try {
        api.encryptAtRest('second', cipher);
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
});
