import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  compilerRegExpTest,
  compilerSha256Hex,
  compilerStringReplaceAll,
  compilerStringSplit,
} from './compiler-security-intrinsics.js';

describe('compiler supported-runner security bootstrap', () => {
  it('allows only its module-private record to authorize an idempotent global relock', () => {
    const inventoryUrl = new URL(
      '../../core/src/internal/request-safe-runtime-inventory.ts',
      import.meta.url,
    ).href;
    const relockSource = `
      import { lockRequestSafeRuntimeRealm } from ${JSON.stringify(inventoryUrl)};
      lockRequestSafeRuntimeRealm();
      const before = Object.getOwnPropertyDescriptor(globalThis, 'Response');
      lockRequestSafeRuntimeRealm();
      lockRequestSafeRuntimeRealm();
      const after = Object.getOwnPropertyDescriptor(globalThis, 'Response');
      if (!before || !after || before.get !== after.get || before.set !== after.set) {
        throw new Error('framework relock did not preserve the recorded descriptor identities');
      }
      process.stdout.write('framework-relock-ok');
    `;
    const relockResult = runTypedChild(relockSource);
    expect(relockResult.status, relockResult.stderr).toBe(0);
    expect(relockResult.stdout).toBe('framework-relock-ok');

    const attackerAccessorSource = `
      import { lockRequestSafeRuntimeRealmWithInventory } from ${JSON.stringify(inventoryUrl)};
      let current = globalThis.Response;
      Object.defineProperty(globalThis, 'Response', {
        configurable: false,
        enumerable: true,
        get() { return current; },
        set(next) { current = next; },
      });
      let rejection = '';
      try {
        lockRequestSafeRuntimeRealmWithInventory({
          callbackGlobals: [],
          globalCallables: [],
          globalConstructors: [],
          globalNamespaceMemberPaths: [],
          globalNamespaces: ['Response'],
          governedGlobals: [],
        });
      } catch (error) {
        rejection = String(error?.message ?? error);
      }
      if (!rejection.includes('cannot be pinned')) {
        throw new Error('preexisting non-configurable accessor was accepted: ' + rejection);
      }
      process.stdout.write('attacker-accessor-rejected');
    `;
    const attackerAccessorResult = runTypedChild(attackerAccessorSource);
    expect(attackerAccessorResult.status, attackerAccessorResult.stderr).toBe(0);
    expect(attackerAccessorResult.stdout).toBe('attacker-accessor-rejected');
  });

  it('validates an exact realm record across direct independent lock calls', () => {
    const inventoryUrl = new URL(
      '../../core/src/internal/request-safe-runtime-inventory.ts',
      import.meta.url,
    ).href;
    const source = `
      import {
        lockRequestSafeRuntimeRealmWithInventory,
        requestSafeRuntimeInventory,
      } from ${JSON.stringify(inventoryUrl)};
      lockRequestSafeRuntimeRealmWithInventory(requestSafeRuntimeInventory);
      const stateKey = Symbol.for('@kovojs/request-safe-runtime-lock/v1');
      const state = globalThis[stateKey];
      const callables = state.inventory.globalCallables;
      const atobDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'atob');
      const btoaDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'btoa');
      if (
        !callables.includes('atob') ||
        !callables.includes('btoa') ||
        !atobDescriptor ||
        atobDescriptor.writable !== false ||
        !btoaDescriptor ||
        btoaDescriptor.writable !== false
      ) {
        throw new Error('base64 globals are absent from the cross-bundle lock inventory');
      }
      const mutationRejected = !Reflect.set(state, 'properties', []);
      const globalThisReplacementRejected = !Reflect.set(globalThis, 'globalThis', Object.create(null));
      lockRequestSafeRuntimeRealmWithInventory(requestSafeRuntimeInventory);
      if (!mutationRejected || !globalThisReplacementRejected || globalThis.globalThis !== globalThis) {
        throw new Error('realm lock state or globalThis binding remained mutable');
      }
      process.stdout.write('cross-copy-relock-ok');
    `;
    const result = runTypedChild(source);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('cross-copy-relock-ok');
  });

  it('rejects malformed incomplete realm state instead of treating it as bootstrap proof', () => {
    const inventoryUrl = new URL(
      '../../core/src/internal/request-safe-runtime-inventory.ts',
      import.meta.url,
    ).href;
    const source = `
      import {
        lockRequestSafeRuntimeRealmWithInventory,
        requestSafeRuntimeInventory,
      } from ${JSON.stringify(inventoryUrl)};
      Object.defineProperty(globalThis, Symbol.for('@kovojs/request-safe-runtime-lock/v1'), {
        configurable: false,
        enumerable: false,
        value: Object.freeze({ inventory: Object.freeze({}), properties: Object.freeze([]) }),
        writable: false,
      });
      let rejection = '';
      try {
        lockRequestSafeRuntimeRealmWithInventory(requestSafeRuntimeInventory);
      } catch (error) {
        rejection = String(error?.message ?? error);
      }
      if (!rejection.includes('non-data property') && !rejection.includes('changed across bundles')) {
        throw new Error('malformed realm record was not rejected: ' + rejection);
      }
      process.stdout.write('malformed-record-rejected');
    `;
    const result = runTypedChild(source);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('malformed-record-rejected');
  });

  it('pins behavior-bearing prototype data before authored packages can replace it', () => {
    const bootstrapUrl = new URL('./security-bootstrap.ts', import.meta.url).href;
    const source = `
      import { lockCompilerSecurityRealm } from ${JSON.stringify(bootstrapUrl)};
      lockCompilerSecurityRealm();
      let coercionHit = false;
      let errorNameRejected = false;
      try {
        Error.prototype.name = { toString() { coercionHit = true; return 'Evil'; } };
      } catch {
        errorNameRejected = true;
      }
      const defineRejected = !Reflect.defineProperty(Error.prototype, 'name', {
        configurable: true,
        value: { toString() { coercionHit = true; return 'DefinedEvil'; } },
        writable: true,
      });
      const rendered = String(new Error('safe'));
      const subclass = new (class UndiciStyleError extends Error {
        constructor() {
          super('instance-safe');
          this.name = 'UndiciStyleError';
        }
      })();
      const arrayLength = Object.getOwnPropertyDescriptor(Array.prototype, 'length');
      let arrayLengthRejected = false;
      try { Array.prototype.length = 1000000; } catch { arrayLengthRejected = true; }
      if (!errorNameRejected || !defineRejected || coercionHit || rendered !== 'Error: safe') {
        throw new Error('Error.prototype behavior-bearing data remained mutable');
      }
      if (subclass.name !== 'UndiciStyleError' || !Object.hasOwn(subclass, 'name')) {
        throw new Error('Error instance name shadowing stopped working');
      }
      if (!arrayLengthRejected || !arrayLength || arrayLength.writable !== false || arrayLength.value !== 0) {
        throw new Error('Array.prototype.length remained mutable');
      }
      process.stdout.write('prototype-data-locked');
    `;
    const result = runTypedChild(source);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('prototype-data-locked');
  });

  it('locks native promise methods without turning them into accessor-backed thenables', () => {
    const bootstrapUrl = new URL('./security-bootstrap.ts', import.meta.url).href;
    const source = `
      import { lockCompilerSecurityRealm } from ${JSON.stringify(bootstrapUrl)};
      lockCompilerSecurityRealm();
      const descriptor = Object.getOwnPropertyDescriptor(Promise.prototype, 'then');
      if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new Error('Promise.prototype.then must remain an immutable data function.');
      }
      if (descriptor.writable !== false || descriptor.configurable !== false) {
        throw new Error('Promise.prototype.then must be locked.');
      }
      const value = await Promise.resolve('promise-lockdown-ok');
      process.stdout.write(value);
    `;
    const result = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        '--experimental-transform-types',
        '--input-type=module',
        '--eval',
        source,
      ],
      { encoding: 'utf8' },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('promise-lockdown-ok');
  });

  it('keeps Vite-style Map instance decoration while rejecting realm-wide replacement', () => {
    const bootstrapUrl = new URL('./security-bootstrap.ts', import.meta.url).href;
    const source = `
      import { lockCompilerSecurityRealm } from ${JSON.stringify(bootstrapUrl)};
      lockCompilerSecurityRealm();
      const cache = new Map();
      const nativeSet = cache.set;
      cache.set = function decoratedSet(key, value) {
        return Reflect.apply(nativeSet, this, [key, value]);
      };
      cache.set('safe', 1);
      if (!Object.hasOwn(cache, 'set') || cache.get('safe') !== 1) {
        throw new Error('Map instance decoration stopped working');
      }
      let assignmentRejected = false;
      try { Map.prototype.set = () => new Map(); } catch { assignmentRejected = true; }
      const defineRejected = !Reflect.defineProperty(Map.prototype, 'set', {
        configurable: true,
        value: () => new Map(),
        writable: true,
      });
      if (!assignmentRejected || !defineRejected) {
        throw new Error('Map.prototype replacement remained possible');
      }
      process.stdout.write('map-instance-decoration-ok');
    `;
    const result = runTypedChild(source);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('map-instance-decoration-ok');
  });

  it('locks shared function dispatch and callable own-property shadowing', () => {
    const bootstrapUrl = new URL('./security-bootstrap.ts', import.meta.url).href;
    const source = `
      import { lockCompilerSecurityRealm } from ${JSON.stringify(bootstrapUrl)};
      lockCompilerSecurityRealm();
      const attempts = [
        Reflect.set(Function.prototype, 'call', () => 'poisoned-call'),
        Reflect.set(Function.prototype, 'apply', () => 'poisoned-apply'),
        Reflect.set(Function.prototype, 'bind', () => () => 'poisoned-bind'),
        Reflect.defineProperty(Array.from, 'call', {
          configurable: true,
          value: () => ['poisoned-static-call'],
          writable: true,
        }),
        Reflect.defineProperty(Object.keys, 'apply', {
          configurable: true,
          value: () => ['poisoned-static-apply'],
          writable: true,
        }),
      ];
      function join(left, right) { return this.prefix + left + right; }
      const called = join.call({ prefix: 'c' }, 'a', 'l');
      const applied = join.apply({ prefix: 'a' }, ['p', 'p']);
      const bound = join.bind({ prefix: 'b' }, 'i')('n');
      if (attempts.some(Boolean) || called !== 'cal' || applied !== 'app' || bound !== 'bin') {
        throw new Error('function dispatch or static callable shadowing remained mutable');
      }
      if (Array.from(new Set(['safe']))[0] !== 'safe' || Object.keys({ safe: true })[0] !== 'safe') {
        throw new Error('reviewed static callables stopped working');
      }
      process.stdout.write('function-dispatch-locked');
    `;
    const result = runTypedChild(source);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('function-dispatch-locked');
  });

  it('locks hidden iterator and generator prototype chains', () => {
    const bootstrapUrl = new URL('./security-bootstrap.ts', import.meta.url).href;
    const source = `
      import { lockCompilerSecurityRealm } from ${JSON.stringify(bootstrapUrl)};
      lockCompilerSecurityRealm();
      const arrayIteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]());
      const mapIteratorPrototype = Object.getPrototypeOf(new Map().entries());
      const formDataIteratorPrototype = Object.getPrototypeOf(new FormData().entries());
      const matchAllIteratorPrototype = Object.getPrototypeOf('safe'.matchAll(/./g));
      const generator = (function* () { yield 'generator-safe'; })();
      const asyncGenerator = (async function* () { yield 'async-generator-safe'; })();
      const attempts = [
        Reflect.set(arrayIteratorPrototype, 'next', () => ({ done: true })),
        Reflect.set(mapIteratorPrototype, 'next', () => ({ done: true })),
        Reflect.set(formDataIteratorPrototype, 'next', () => ({ done: true })),
        Reflect.set(matchAllIteratorPrototype, 'next', () => ({ done: true })),
        Reflect.set(Object.getPrototypeOf(Object.getPrototypeOf(generator)), 'next', () => ({ done: true })),
        Reflect.set(Object.getPrototypeOf(Object.getPrototypeOf(asyncGenerator)), 'next', async () => ({ done: true })),
      ];
      const formData = new FormData();
      formData.append('field', 'form-safe');
      const headers = new Headers({ field: 'headers-safe' });
      const values = {
        array: [...['array-safe']][0],
        asyncGenerator: (await asyncGenerator.next()).value,
        formData: [...formData.entries()][0][1],
        generator: generator.next().value,
        headers: [...headers.entries()][0][1],
        map: [...new Map([['field', 'map-safe']]).values()][0],
        matchAll: [...'match-safe'.matchAll(/match/g)][0][0],
      };
      if (
        attempts.some(Boolean) ||
        values.matchAll !== 'match' ||
        Object.entries(values).some(([key, value]) => key !== 'matchAll' && !String(value).endsWith('safe'))
      ) {
        throw new Error('hidden protocol prototype remained mutable or stopped working: ' + JSON.stringify(values));
      }
      process.stdout.write('hidden-protocols-locked');
    `;
    const result = runTypedChild(source);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('hidden-protocols-locked');
  });

  it('pins every reviewed global before deferred or external replacement can run', () => {
    const bootstrapUrl = new URL('./security-bootstrap.ts', import.meta.url).href;
    const source = `
      import { lockCompilerSecurityRealm } from ${JSON.stringify(bootstrapUrl)};
      const NativeResponse = globalThis.Response;
      const nativeFetch = globalThis.fetch;
      const nativeQueueMicrotask = queueMicrotask;
      const nativeSetTimeout = setTimeout;
      const attempts = [];
      lockCompilerSecurityRealm();

      const poison = () => {
        attempts.push(Reflect.set(globalThis, 'Response', class EvilResponse {}));
        attempts.push(Reflect.set(globalThis, 'fetch', async () => new Response('evil')));
        attempts.push(Reflect.set(globalThis, 'queueMicrotask', () => {}));
        attempts.push(Reflect.set(globalThis, 'setTimeout', () => 0));
      };
      const externalInvoke = (callback) => callback();
      externalInvoke(poison);
      await new Promise((resolve) => nativeQueueMicrotask(() => {
        poison();
        nativeSetTimeout(resolve, 0);
      }));

      if (globalThis.Response !== NativeResponse) throw new Error('Response identity changed');
      if (globalThis.fetch !== nativeFetch) throw new Error('fetch identity changed');
      if (queueMicrotask !== nativeQueueMicrotask) throw new Error('queueMicrotask changed');
      if (setTimeout !== nativeSetTimeout) throw new Error('setTimeout changed');
      const response = new Response('locked');
      if (await response.text() !== 'locked') throw new Error('Response stopped working');
      process.stdout.write('reviewed-globals-locked');
    `;
    const result = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        '--experimental-transform-types',
        '--input-type=module',
        '--eval',
        source,
      ],
      { encoding: 'utf8' },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('reviewed-globals-locked');
  });

  it('keeps exact identities after a selective lookalike Hash.update replacement', () => {
    // Importing compiler-security-intrinsics above is the supported runner bootstrap. App/plugin
    // evaluation happens after that point; source-comment likeness is deliberately irrelevant.
    const safe = 'export const safe = true;';
    const target = 'export const adminToken = leak;';
    const safeDigest = compilerSha256Hex(safe);
    const targetDigest = compilerSha256Hex(target);
    expect(targetDigest).not.toBe(safeDigest);

    const probe = createHash('sha256');
    const prototype = Object.getPrototypeOf(probe) as { update: Function };
    const nativeUpdate = prototype.update;
    const nativeApply = Reflect.apply;
    prototype.update = function update(data: unknown, encoding?: unknown) {
      // Deliberately mimics the old source-text allowlist: this[kHandle].update
      return nativeApply(nativeUpdate, this, [data === target ? safe : data, encoding]);
    };
    try {
      expect(compilerSha256Hex(safe)).toBe(safeDigest);
      expect(compilerSha256Hex(target)).toBe(targetDigest);
      expect(compilerSha256Hex(target)).not.toBe(compilerSha256Hex(safe));
    } finally {
      prototype.update = nativeUpdate;
    }
  });

  it('does not dispatch security classification through late RegExp.prototype.exec', () => {
    const nativeExec = RegExp.prototype.exec;
    RegExp.prototype.exec = function poisonedClassifierExec(value: string): RegExpExecArray | null {
      if (value === 'unsafe') {
        return Object.assign(['safe'], { index: 0, input: value }) as RegExpExecArray;
      }
      return null;
    };
    try {
      expect(compilerRegExpTest(/^safe$/u, 'safe')).toBe(true);
      expect(compilerRegExpTest(/^safe$/u, 'unsafe')).toBe(false);
    } finally {
      RegExp.prototype.exec = nativeExec;
    }
  });

  it('does not dispatch literal replace/split through late symbol hooks', () => {
    const replaceDescriptor = Object.getOwnPropertyDescriptor(String.prototype, Symbol.replace);
    const splitDescriptor = Object.getOwnPropertyDescriptor(String.prototype, Symbol.split);
    Object.defineProperty(String.prototype, Symbol.replace, {
      configurable: true,
      value: () => 'attacker-replacement',
    });
    Object.defineProperty(String.prototype, Symbol.split, {
      configurable: true,
      value: () => [],
    });
    try {
      expect(compilerStringReplaceAll('safe-old-old', 'old', 'new')).toBe('safe-new-new');
      expect(compilerStringSplit('safe,reviewed', ',')).toEqual(['safe', 'reviewed']);
    } finally {
      if (replaceDescriptor === undefined) Reflect.deleteProperty(String.prototype, Symbol.replace);
      else Object.defineProperty(String.prototype, Symbol.replace, replaceDescriptor);
      if (splitDescriptor === undefined) Reflect.deleteProperty(String.prototype, Symbol.split);
      else Object.defineProperty(String.prototype, Symbol.split, splitDescriptor);
    }
  });
});

function runTypedChild(source: string) {
  return spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--experimental-transform-types',
      '--input-type=module',
      '--eval',
      source,
    ],
    { encoding: 'utf8' },
  );
}
