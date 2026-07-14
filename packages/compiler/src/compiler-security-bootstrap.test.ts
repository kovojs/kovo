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
          globalNamespaces: ['Response'],
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
      const rendered = String(new Error('safe'));
      const arrayLength = Object.getOwnPropertyDescriptor(Array.prototype, 'length');
      let arrayLengthRejected = false;
      try { Array.prototype.length = 1000000; } catch { arrayLengthRejected = true; }
      if (!errorNameRejected || coercionHit || rendered !== 'Error: safe') {
        throw new Error('Error.prototype behavior-bearing data remained mutable');
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

  it('pins every reviewed global before deferred or external replacement can run', () => {
    const bootstrapUrl = new URL('./security-bootstrap.ts', import.meta.url).href;
    const source = `
      import { lockCompilerSecurityRealm } from ${JSON.stringify(bootstrapUrl)};
      const NativeResponse = globalThis.Response;
      const nativeConsoleLog = console.log;
      const nativeQueueMicrotask = queueMicrotask;
      const nativeSetTimeout = setTimeout;
      const attempts = [];
      lockCompilerSecurityRealm();

      const poison = () => {
        attempts.push(Reflect.set(console, 'log', () => { throw new Error('poisoned console'); }));
        attempts.push(Reflect.set(globalThis, 'Response', class EvilResponse {}));
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
      if (console.log !== nativeConsoleLog) throw new Error('console.log identity changed');
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

  it('pins every lockable reviewed Node facade before CommonJS-to-ESM resynchronization', () => {
    const bootstrapUrl = new URL('./security-bootstrap.ts', import.meta.url).href;
    const source = `
      import { createRequire, syncBuiltinESMExports } from 'node:module';
      import querystring, { escape as importedEscape } from 'node:querystring';
      import { StringDecoder } from 'node:string_decoder';
      import utilTypes, { isDate as importedIsDate } from 'node:util/types';
      import { lockCompilerSecurityRealm } from ${JSON.stringify(bootstrapUrl)};
      const require = createRequire(import.meta.url);
      const querystringFacade = require('node:querystring');
      const utilTypesFacade = require('node:util/types');
      const nativeEscape = querystring.escape;
      const nativeIsDate = utilTypes.isDate;
      lockCompilerSecurityRealm();

      const attempts = [
        Reflect.set(querystringFacade, 'escape', () => 'attacker-query'),
        Reflect.set(utilTypesFacade, 'isDate', () => true),
      ];
      syncBuiltinESMExports();
      if (attempts.some(Boolean)) throw new Error('a reviewed Node facade replacement succeeded');
      if (querystring.escape !== nativeEscape || importedEscape !== nativeEscape) {
        throw new Error('querystring escape identity changed');
      }
      if (utilTypes.isDate !== nativeIsDate || importedIsDate !== nativeIsDate) {
        throw new Error('util/types isDate identity changed');
      }
      if (querystring.escape('safe value') !== 'safe%20value') {
        throw new Error('querystring facade stopped working');
      }
      const decoder = new StringDecoder('utf8');
      if (decoder.write(Buffer.from('safe')) !== 'safe') {
        throw new Error('StringDecoder instance state stopped working');
      }
      process.stdout.write('reviewed-node-facades-locked');
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
    expect(result.stdout).toBe('reviewed-node-facades-locked');
  });

  it('keeps unpinnable events and util graphs outside the reviewed-safe inventory', () => {
    const inventoryUrl = new URL(
      '../../core/src/internal/request-safe-runtime-inventory.ts',
      import.meta.url,
    ).href;
    const source = `
      import events from 'node:events';
      import util from 'node:util';
      import { requestSafeNodeBuiltinModules } from ${JSON.stringify(inventoryUrl)};

      if (requestSafeNodeBuiltinModules.includes('events') || requestSafeNodeBuiltinModules.includes('util')) {
        throw new Error('an unpinnable Node facade is still classifier-reviewed');
      }
      const captureKey = Reflect.ownKeys(events.EventEmitter.prototype)
        .find((key) => String(key) === 'Symbol(kCapture)');
      const capture = Object.getOwnPropertyDescriptor(events.EventEmitter.prototype, captureKey);
      if (!capture || capture.configurable !== false || capture.writable !== true) {
        throw new Error('EventEmitter blocker proof no longer describes this Node runtime');
      }
      // Materialize stdout before the proof intentionally makes future EventEmitter construction
      // impossible; Node lazily constructs stdout as a Socket.
      process.stdout.write('unpinnable-node-facades-excluded');
      Object.defineProperty(events.EventEmitter.prototype, captureKey, { writable: false });
      let constructionRejected = false;
      try { new events.EventEmitter(); } catch { constructionRejected = true; }
      if (!constructionRejected) {
        throw new Error('EventEmitter became lockable; reconsider the inventory with fresh proof');
      }

      const defaultOptions = Object.getOwnPropertyDescriptor(util.inspect, 'defaultOptions');
      if (!defaultOptions || defaultOptions.configurable !== false || typeof defaultOptions.set !== 'function') {
        throw new Error('util.inspect blocker proof no longer describes this Node runtime');
      }
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
    expect(result.stdout).toBe('unpinnable-node-facades-excluded');
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
