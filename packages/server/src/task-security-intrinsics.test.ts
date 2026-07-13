import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire, syncBuiltinESMExports } from 'node:module';

import { describe, expect, it } from 'vitest';

import { s } from './schema.js';
import { task } from './task.js';
import { createDurableTaskRunner } from './task-runner.js';
import { MemoryDurableTaskQueue } from './task-queue.js';
import {
  assertTaskSecurityIntrinsics,
  taskCreateEntropyId,
  taskDateNow,
  taskPromiseAll,
  taskPromiseFinally,
  taskPromiseThen,
  taskSetTimeout,
} from './task-security-intrinsics.js';

const require = createRequire(import.meta.url);
const mutableCrypto = require('node:crypto') as { randomBytes: typeof randomBytes };
const taskSecurityModuleUrl = new URL('./task-security-intrinsics.ts', import.meta.url).href;

describe('durable-task intrinsic membrane (SPEC §9.6/§10.3)', () => {
  it('does not let app code enable test fake timers after bootstrap', () => {
    const script = `
      const { existsSync } = await import('node:fs');
      const { registerHooks } = await import('node:module');
      registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
            const candidate = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
            if (existsSync(candidate)) return nextResolve(candidate.href, context);
          }
          return nextResolve(specifier, context);
        },
      });
      delete process.env.VITEST;
      const tasks = await import(${JSON.stringify(
        `${taskSecurityModuleUrl}?boot-pinned-test-posture`,
      )});
      const clock = {};
      let fakeCalls = 0;
      const fakeSetTimeout = Object.assign(() => { fakeCalls += 1; return {}; }, { clock });
      const fakeSetInterval = Object.assign(() => { fakeCalls += 1; return {}; }, { clock });
      const fakeClearTimeout = () => { fakeCalls += 1; };
      const fakeClearInterval = () => { fakeCalls += 1; };
      process.env.VITEST = 'true';
      globalThis.setTimeout = fakeSetTimeout;
      globalThis.setInterval = fakeSetInterval;
      globalThis.clearTimeout = fakeClearTimeout;
      globalThis.clearInterval = fakeClearInterval;
      const timer = tasks.taskSetTimeout(() => {}, 60_000);
      tasks.taskClearTimeout(timer);
      process.exit(fakeCalls === 0 ? 0 : 3);
    `;
    const result = spawnSync(
      process.execPath,
      ['--experimental-transform-types', '--input-type=module', '--eval', script],
      { encoding: 'utf8' },
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('keeps exact registry dispatch and cryptographic identities after late poisoning', async () => {
    const originalDateNow = Date.now;
    const originalMapGet = Map.prototype.get;
    const originalMathRandom = Math.random;
    const originalPromiseThen = Promise.prototype.then;
    const originalSetTimeout = globalThis.setTimeout;
    let ordinaryRuns = 0;
    let privilegedRuns = 0;
    let ids: string[] = [];
    let observedClock = 0;
    let promiseValue = '';
    let timerRan = false;

    const ordinary = task('ordinary', {
      input: s.object({}),
      run() {
        ordinaryRuns += 1;
      },
    });
    const privileged = task('privileged', {
      input: s.object({}),
      run() {
        privilegedRuns += 1;
      },
    });
    const store = new MemoryDurableTaskQueue();
    await store.enqueue({ task: ordinary.key, args: {}, runAt: new Date(0) });
    const runner = createDurableTaskRunner({ store, tasks: [ordinary, privileged] });

    try {
      Date.now = () => 1;
      Math.random = () => 0.5;
      Map.prototype.get = function (key: unknown) {
        return originalMapGet.call(this, 'privileged') === privileged
          ? privileged
          : originalMapGet.call(this, key);
      };
      await runner.runOnce(new Date(1));
      ids = [taskCreateEntropyId('job'), taskCreateEntropyId('job')];
      observedClock = taskDateNow();
      Promise.prototype.then = function () {
        throw new Error('late Promise.then replacement ran');
      } as typeof Promise.prototype.then;
      const promised = taskPromiseFinally(
        taskPromiseThen(taskPromiseAll([Promise.resolve('safe')]), (values) => values[0]!),
        () => undefined,
      );
      Promise.prototype.then = originalPromiseThen;
      promiseValue = await promised;

      globalThis.setTimeout = (() => {
        throw new Error('late setTimeout replacement ran');
      }) as typeof setTimeout;
      const timerPromise = new Promise<void>((resolve) => {
        taskSetTimeout(() => {
          timerRan = true;
          resolve();
        }, 0);
      });
      globalThis.setTimeout = originalSetTimeout;
      await timerPromise;
    } finally {
      Date.now = originalDateNow;
      Map.prototype.get = originalMapGet;
      Math.random = originalMathRandom;
      Promise.prototype.then = originalPromiseThen;
      globalThis.setTimeout = originalSetTimeout;
    }

    expect(ordinaryRuns).toBe(1);
    expect(privilegedRuns).toBe(0);
    expect(ids[0]).toMatch(/^job_[0-9a-f]{32}$/u);
    expect(ids[1]).toMatch(/^job_[0-9a-f]{32}$/u);
    expect(ids[1]).not.toBe(ids[0]);
    expect(observedClock).toBeGreaterThan(1);
    expect(promiseValue).toBe('safe');
    expect(timerRan).toBe(true);
  });

  it('C233 commits asynchronous task collection results without inherited setter dispatch', async () => {
    const originalZero = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    const nativeDefineProperty = Object.defineProperty;
    let setterCalls = 0;
    let results: string[] = [];

    try {
      nativeDefineProperty(Array.prototype, '0', {
        configurable: true,
        set(value: unknown) {
          if (value === 'approved-result') {
            setterCalls += 1;
            return;
          }
          nativeDefineProperty(this, '0', {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
        },
      });

      results = await taskPromiseAll([Promise.resolve('approved-result')]);
    } finally {
      if (originalZero === undefined) delete Array.prototype[0];
      else nativeDefineProperty(Array.prototype, '0', originalZero);
    }

    expect(results).toEqual(['approved-result']);
    expect(setterCalls).toBe(0);
  });

  it('is available under ordinary initialization', () => {
    expect(() => assertTaskSecurityIntrinsics()).not.toThrow();
  });

  it('pins task entropy before a late synchronized Node builtin replacement', () => {
    const originalRandomBytes = mutableCrypto.randomBytes;
    let first = '';
    let second = '';
    try {
      mutableCrypto.randomBytes = ((size: number) =>
        Buffer.alloc(size, 0x43)) as typeof randomBytes;
      syncBuiltinESMExports();
      first = taskCreateEntropyId('job');
      second = taskCreateEntropyId('job');
    } finally {
      mutableCrypto.randomBytes = originalRandomBytes;
      syncBuiltinESMExports();
    }

    expect(first).toMatch(/^job_[0-9a-f]{32}$/u);
    expect(second).toMatch(/^job_[0-9a-f]{32}$/u);
    expect(second).not.toBe(first);
    expect(first).not.toBe(`job_${'43'.repeat(16)}`);
  });

  it('pins task entropy length after a late typed-array byteLength poison', () => {
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
    const descriptor = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength');
    expect(descriptor?.get).toBeTypeOf('function');
    Object.defineProperty(typedArrayPrototype, 'byteLength', {
      configurable: true,
      get: () => 0,
    });
    try {
      expect(taskCreateEntropyId('lease')).toMatch(/^lease_[0-9a-f]{32}$/u);
    } finally {
      Object.defineProperty(typedArrayPrototype, 'byteLength', descriptor!);
    }
  });
});
