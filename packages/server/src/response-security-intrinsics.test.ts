import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { describe, expect, it } from 'vitest';

import { forwardSetCookie, serializeCookie } from './cookies.js';
import { cspSha256, renderContentSecurityPolicy } from './csp.js';
import { csrfToken, validateCsrfToken } from './csrf.js';
import { renderDocument } from './document-core.js';
import { createSigningKeyRing } from './keyring.js';
import { securityRandomBytes, securityRandomUuid } from './response-security-intrinsics.js';

const intrinsicModuleUrl = new URL('./response-security-intrinsics.ts', import.meta.url).href;
const mutableCrypto = createRequire(import.meta.url)('node:crypto') as {
  createHash: typeof createHash;
  createHmac: typeof createHmac;
  randomBytes: typeof randomBytes;
  timingSafeEqual: typeof timingSafeEqual;
};

describe('document, cookie, CSP, and CSRF intrinsic closure', () => {
  it('keeps the complete document shell pinned after selective Array.join poisoning', () => {
    const nativeJoin = Array.prototype.join;
    const attacker = '<!doctype html><img src=x onerror=alert(1)>';
    const baseline = renderDocument({ body: '<main>safe</main>', loader: 'omit' }).html;
    let ambientControl = '';
    let rendered = '';
    try {
      Array.prototype.join = function poisonedJoin(separator) {
        if (this[0] === '<!doctype html>') return attacker;
        return Reflect.apply(nativeJoin, this, [separator]);
      };
      ambientControl = ['<!doctype html>', '<main>safe</main>'].join('');
      rendered = renderDocument({ body: '<main>safe</main>', loader: 'omit' }).html;
    } finally {
      Array.prototype.join = nativeJoin;
    }

    expect(ambientControl).toBe(attacker);
    expect(rendered).toBe(baseline);
    expect(rendered).not.toContain('onerror=');
  });

  it('rejects cookie attribute injection after selective string and RegExp poisoning', () => {
    const nativeIncludes = String.prototype.includes;
    const nativeRegExpExec = RegExp.prototype.exec;
    const nativeRegExpTest = RegExp.prototype.test;
    const domain = 'example.test; Partitioned';
    let ambientControl = false;
    let domainError: unknown;
    let nameError: unknown;
    try {
      String.prototype.includes = function poisonedIncludes(search, position) {
        if (this.valueOf() === domain && search === ';') return false;
        return Reflect.apply(nativeIncludes, this, [search, position]);
      };
      RegExp.prototype.exec = () => ['forged'] as unknown as RegExpExecArray;
      RegExp.prototype.test = () => true;
      ambientControl = domain.includes(';');
      try {
        serializeCookie('prefs', 'safe', { class: 'app-data', domain });
      } catch (error) {
        domainError = error;
      }
      try {
        serializeCookie('bad; Partitioned', 'safe', { class: 'app-data' });
      } catch (error) {
        nameError = error;
      }
    } finally {
      String.prototype.includes = nativeIncludes;
      RegExp.prototype.exec = nativeRegExpExec;
      RegExp.prototype.test = nativeRegExpTest;
    }

    expect(ambientControl).toBe(false);
    expect(domainError).toBeInstanceOf(Error);
    expect(String(domainError)).toContain('cookie domain must not contain semicolons');
    expect(nameError).toBeInstanceOf(Error);
    expect(String(nameError)).toContain('Cookie name must be an HTTP token');
  });

  it('does not substitute a cached genuine token through poisoned String.split', () => {
    const nativeSplit = String.prototype.split;
    const request = { sessionId: 'victim-session' };
    const csrf = {
      field: 'csrf',
      secret: 'test-csrf-secret-0123456789abcdef012345',
      sessionId(input: typeof request) {
        return input.sessionId;
      },
    };
    const victimToken = csrfToken(request, csrf);
    const victimParts = Reflect.apply(nativeSplit, victimToken, ['.']);
    const forged = 'v1.attacker.attacker';
    let ambientControl: string[] = [];
    let genuineAccepted = false;
    let forgedAccepted = true;
    try {
      String.prototype.split = function poisonedSplit(separator, limit) {
        if (this.valueOf() === forged && separator === '.') return victimParts;
        return Reflect.apply(nativeSplit, this, [separator, limit]);
      };
      ambientControl = forged.split('.');
      genuineAccepted = validateCsrfToken({ csrf: victimToken }, request, csrf);
      forgedAccepted = validateCsrfToken({ csrf: forged }, request, csrf);
    } finally {
      String.prototype.split = nativeSplit;
    }

    expect(ambientControl).toEqual(victimParts);
    expect(genuineAccepted).toBe(true);
    expect(forgedAccepted).toBe(false);
  });

  it('pins CSP hashing, directive joins, cookie maps, and key-id rejection after late poisoning', () => {
    const hashPrototype = Object.getPrototypeOf(createHash('sha256')) as {
      update: (...args: unknown[]) => unknown;
    };
    const nativeHashUpdate = hashPrototype.update;
    const nativeArrayJoin = Array.prototype.join;
    const nativeMapGet = Map.prototype.get;
    const nativeMapHas = Map.prototype.has;
    const nativeMapSet = Map.prototype.set;
    const nativeRegExpExec = RegExp.prototype.exec;
    const baselineHash = cspSha256('alert("safe")');
    const baselinePolicy = renderContentSecurityPolicy(
      { scripts: [baselineHash], styles: [] },
      { scriptSrc: ["'self'", 'https://cdn.example.test'] },
    );
    let hash = '';
    let policy = '';
    let cookie = '';
    let keyError: unknown;
    try {
      hashPrototype.update = function poisonedHashUpdate() {
        return this;
      };
      Array.prototype.join = () => "script-src 'unsafe-inline'";
      Map.prototype.get = () => ({ value: 'None' });
      Map.prototype.has = () => false;
      Map.prototype.set = function poisonedMapSet() {
        return this;
      };
      RegExp.prototype.exec = () => ['forged'] as unknown as RegExpExecArray;

      hash = cspSha256('alert("safe")');
      policy = renderContentSecurityPolicy(
        { scripts: [baselineHash], styles: [] },
        { scriptSrc: ["'self'", 'https://cdn.example.test'] },
      );
      cookie = forwardSetCookie('sid=token; Path=/auth; Secure; SameSite=Lax', {
        class: 'session',
        source: 'session-provider',
      });
      try {
        createSigningKeyRing({
          keys: [
            {
              id: 'bad;key',
              secret: '0123456789abcdef0123456789abcdef',
              state: 'active',
            },
          ],
        });
      } catch (error) {
        keyError = error;
      }
    } finally {
      hashPrototype.update = nativeHashUpdate;
      Array.prototype.join = nativeArrayJoin;
      Map.prototype.get = nativeMapGet;
      Map.prototype.has = nativeMapHas;
      Map.prototype.set = nativeMapSet;
      RegExp.prototype.exec = nativeRegExpExec;
    }

    expect(hash).toBe(baselineHash);
    expect(policy).toBe(baselinePolicy);
    expect(policy).not.toContain("'unsafe-inline'");
    expect(cookie).toBe('sid=token; Path=/auth; HttpOnly; Secure; SameSite=Lax');
    expect(keyError).toBeInstanceOf(Error);
    expect(String(keyError)).toContain('base64url-safe text');
  });

  it('pins Node crypto functions before application code can sync poisoned builtin exports', () => {
    const nativeCreateHash = mutableCrypto.createHash;
    const nativeCreateHmac = mutableCrypto.createHmac;
    const nativeRandomBytes = mutableCrypto.randomBytes;
    const nativeTimingSafeEqual = mutableCrypto.timingSafeEqual;
    const request = { sessionId: 'victim-session' };
    const csrf = {
      field: 'csrf',
      secret: 'test-csrf-secret-0123456789abcdef012345',
      sessionId(input: typeof request) {
        return input.sessionId;
      },
    };
    let directControlThrew = false;
    let hash = '';
    let token = '';
    let forgedAccepted = true;
    try {
      mutableCrypto.createHash = (() => {
        throw new Error('poisoned createHash reached');
      }) as typeof createHash;
      mutableCrypto.createHmac = (() => {
        throw new Error('poisoned createHmac reached');
      }) as typeof createHmac;
      mutableCrypto.randomBytes = (() => {
        throw new Error('poisoned randomBytes reached');
      }) as typeof randomBytes;
      mutableCrypto.timingSafeEqual = (() => true) as typeof timingSafeEqual;
      syncBuiltinESMExports();

      try {
        mutableCrypto.randomBytes(1);
      } catch {
        directControlThrew = true;
      }
      hash = cspSha256('alert("safe")');
      token = csrfToken(request, csrf);
      const ring = createSigningKeyRing({
        keys: [
          {
            id: 'current',
            secret: '0123456789abcdef0123456789abcdef',
            state: 'active',
          },
        ],
      });
      forgedAccepted = ring.verify({
        audience: 'mutation:test',
        payload: 'victim',
        purpose: 'csrf',
        signature: 'attacker',
      }).ok;
    } finally {
      mutableCrypto.createHash = nativeCreateHash;
      mutableCrypto.createHmac = nativeCreateHmac;
      mutableCrypto.randomBytes = nativeRandomBytes;
      mutableCrypto.timingSafeEqual = nativeTimingSafeEqual;
      syncBuiltinESMExports();
    }

    expect(directControlThrew).toBe(true);
    expect(hash).toBe('sha256-pd/B67oUKzpTJFjV6bXdTyRfEJ9N2whIqXUGGvfVKpY=');
    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(forgedAccepted).toBe(false);
  });

  it('emits bounded, non-repeating cryptographic bytes and UUID authorities', () => {
    const firstBytes = securityRandomBytes(16);
    const secondBytes = securityRandomBytes(16);
    const firstUuid = securityRandomUuid();
    const secondUuid = securityRandomUuid();

    expect(firstBytes).toHaveLength(16);
    expect(secondBytes).not.toEqual(firstBytes);
    expect(firstUuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(secondUuid).not.toBe(firstUuid);
    expect(() => securityRandomBytes(0)).toThrow(/1\.\.65536 whole bytes/u);
  });

  it('fails closed when synchronized builtin entropy is constant before framework import', () => {
    const script = `
      const { createRequire, syncBuiltinESMExports } = await import('node:module');
      const mutable = createRequire(import.meta.url)('node:crypto');
      mutable.randomBytes = function randomBytes(size, callback) {
        const bytes = Buffer.alloc(size, 0x42);
        if (typeof callback === 'function') { callback(null, bytes); return; }
        return bytes;
      };
      mutable.randomUUID = function randomUUID() {
        return '42424242-4242-4424-8242-424242424242';
      };
      syncBuiltinESMExports();
      try {
        const controls = await import(${JSON.stringify(`${intrinsicModuleUrl}?constant-entropy`)});
        controls.assertResponseSecurityIntrinsics();
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

  it('fails closed if an entropy source repeats after passing its boot probes', () => {
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
      const controls = await import(${JSON.stringify(`${intrinsicModuleUrl}?staged-repeat-entropy`)});
      controls.assertResponseSecurityIntrinsics();
      controls.securityRandomBytes(16);
      try {
        controls.securityRandomBytes(16);
      } catch (error) {
        if (String(error).includes('repeated a recent authority value')) process.exit(0);
      }
      process.exit(3);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('fails closed when a selective response control is poisoned before framework import', () => {
    const script = `
      const nativeJoin = Array.prototype.join;
      Array.prototype.join = function poisonedJoin(separator) {
        if (this[0] === '<!doctype html>') return '<!doctype html><img src=x onerror=alert(1)>';
        return Reflect.apply(nativeJoin, this, [separator]);
      };
      const controls = await import(${JSON.stringify(`${intrinsicModuleUrl}?poisoned-join`)});
      try {
        controls.assertResponseSecurityIntrinsics();
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
