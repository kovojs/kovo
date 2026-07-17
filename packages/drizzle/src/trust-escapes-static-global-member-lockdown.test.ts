import { cpuUsage } from 'node:process';

import { describe, expect, it } from 'vitest';

import { collectUnregisteredSinksFromProject } from '@kovojs/drizzle/internal/static';
import type { TrustEscapeSourceFileInput } from '@kovojs/drizzle/internal/static';

function sinksFor(source: string) {
  return collectUnregisteredSinksFromProject({ files: [{ fileName: 'app.ts', source }] });
}

function sinksForFiles(files: readonly TrustEscapeSourceFileInput[]) {
  return collectUnregisteredSinksFromProject({ files });
}

function elapsedClassifierCpuMs(startedAt: ReturnType<typeof cpuUsage>): number {
  // C13 runs files concurrently. Process CPU time measures classifier work without turning
  // unrelated worker scheduling contention into a false performance-bound failure.
  const elapsed = cpuUsage(startedAt);
  return (elapsed.user + elapsed.system) / 1_000;
}

function expectExactMemberRejected(
  facts: ReturnType<typeof collectUnregisteredSinksFromProject>,
  source: string,
): void {
  expect(facts, JSON.stringify(facts)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sink: expect.stringMatching(/^request-handler\.opaque/u),
        source,
      }),
    ]),
  );
}

const EXACT_GLOBAL_MEMBER_CASES = [
  ['Promise', 'resolve', 'Promise.resolve({ ok: true })', 'Promise.resolve'],
  ['Response', 'json', 'Response.json({ ok: true })', 'Response.json'],
  ['Array', 'isArray', 'Array.isArray([])', 'Array.isArray'],
  ['JSON', 'stringify', 'JSON.stringify({ ok: true })', 'JSON.stringify'],
] as const;

// This is the complete carrier/result subset of REQUEST_REVIEWED_LOCAL_ARRAY_METHODS plus the
// already-reviewed at/slice element projections. Boolean, index, string, and void results cannot
// retain an exact namespace value.
const EXACT_GLOBAL_ARRAY_CARRIER_CASES = [
  ['at', (namespace: string) => `[${namespace}].at(0)!`],
  ['slice', (namespace: string) => `[${namespace}].slice(0)[0]!`],
  ['find', (namespace: string) => `[${namespace}].find(() => true)!`],
  ['findLast', (namespace: string) => `[{ local: true }, ${namespace}].findLast(() => true)!`],
  ['pop', (namespace: string) => `[${namespace}].pop()!`],
  ['shift', (namespace: string) => `[${namespace}].shift()!`],
  [
    'reduce',
    (namespace: string) => `[{ local: true }, ${namespace}].reduce((_accumulator, value) => value)`,
  ],
  [
    'reduceRight',
    (namespace: string) =>
      `[${namespace}, { local: true }].reduceRight((_accumulator, value) => value)`,
  ],
  ['concat receiver', (namespace: string) => `[${namespace}].concat([])[0]!`],
  ['concat argument', (namespace: string) => `[].concat([${namespace}] as never[])[0]!`],
  ['filter', (namespace: string) => `[${namespace}].filter(() => true)[0]!`],
  ['flatMap', (namespace: string) => `[${namespace}].flatMap((value) => [value])[0]!`],
  ['map', (namespace: string) => `[${namespace}].map((value) => value)[0]!`],
  ['sort', (namespace: string) => `[${namespace}].sort()[0]!`],
  ['toSorted', (namespace: string) => `[${namespace}].toSorted()[0]!`],
] as const;

const EXACT_GLOBAL_ITERABLE_CARRIER_CASES = [
  ['Array.of indexed read', (namespace: string) => `Array.of(${namespace})[0]!`],
  ['Array.of spread materialization', (namespace: string) => `[...Array.of(${namespace})][0]!`],
  ['Set spread materialization', (namespace: string) => `[...new Set([${namespace}])][0]!`],
  [
    'authored iterable spread materialization',
    (namespace: string) => `[...{ *[Symbol.iterator]() { yield ${namespace}; } }][0]!`,
  ],
] as const;

// @kovo-security-classifier-corpus kv424-request-global-member-lockdown
// SPEC §6.6: a reviewed global member is executable authority only while its exact
// framework-locked identity remains pristine across the complete authored module graph.
describe('KV424 exact global namespace-member lockdown', () => {
  it.each([
    ['Promise', 'resolve', 'Promise.resolve()', 'Promise.resolve'],
    ['Response', 'json', 'Response.json({ ok: true })', 'Response.json'],
    ['Array', 'isArray', 'Array.isArray([])', 'Array.isArray'],
    ['JSON', 'stringify', 'JSON.stringify({ ok: true })', 'JSON.stringify'],
  ])(
    'rejects an Object.defineProperty replacement of %s.%s',
    (namespace, member, invocation, source) => {
      const facts = sinksFor(`
        import { s, task } from '@kovojs/server';
        class Deferred {
          static then(resolve: (value: { ok: true }) => void): void {
            resolve({ ok: true });
            queueMicrotask(() => { void fetch('https://example.test/late'); });
          }
        }
        Object.defineProperty(${namespace}, '${member}', { value: () => Deferred });
        task('member-lockdown', {
          input: s.object({}),
          async run() { return ${invocation}; },
        });
      `);

      expectExactMemberRejected(facts, source);
    },
  );

  it.each([
    [
      'direct assignment',
      'Promise.resolve = (() => Deferred) as typeof Promise.resolve;',
      'Promise.resolve()',
      'Promise.resolve',
    ],
    [
      'Object.assign',
      'Object.assign(Response, { json: () => Deferred });',
      'Response.json({ ok: true })',
      'Response.json',
    ],
    [
      'Reflect.set',
      "Reflect.set(Array, 'isArray', () => Deferred);",
      'Array.isArray([])',
      'Array.isArray',
    ],
    [
      'Object.defineProperties',
      'Object.defineProperties(JSON, { stringify: { value: () => Deferred } });',
      'JSON.stringify({ ok: true })',
      'JSON.stringify',
    ],
  ])('rejects a reviewed member changed through %s', (_label, replacement, invocation, source) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Deferred {
        static then(resolve: (value: { ok: true }) => void): void {
          resolve({ ok: true });
          queueMicrotask(() => { void fetch('https://example.test/late'); });
        }
      }
      ${replacement}
      task('member-mutation-form', {
        input: s.object({}),
        async run() { return ${invocation}; },
      });
    `);

    expectExactMemberRejected(facts, source);
  });

  it('rejects an aliased and cross-module Promise.resolve replacement', () => {
    const facts = sinksForFiles([
      {
        fileName: 'intrinsic-alias.ts',
        source: `export const promiseNamespace = Promise;`,
      },
      {
        fileName: 'intrinsic-barrel.ts',
        source: `export { promiseNamespace as runtimePromise } from './intrinsic-alias.js';`,
      },
      {
        fileName: 'poison.ts',
        source: `
          import { runtimePromise } from './intrinsic-barrel.js';
          export class Deferred {
            static then(resolve: (value: { ok: true }) => void): void {
              resolve({ ok: true });
              queueMicrotask(() => { void fetch('https://example.test/late'); });
            }
          }
          const alias = runtimePromise;
          Object.defineProperty(alias, 'resolve', { value: () => Deferred });
        `,
      },
      {
        fileName: 'app.ts',
        source: `
          import './poison.js';
          import { s, task } from '@kovojs/server';
          task('cross-module-member-lockdown', {
            input: s.object({}),
            async run() { return Promise.resolve(); },
          });
        `,
      },
    ]);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it.each([
    ['direct assignment', 'holder.promise.resolve = (() => Deferred) as typeof Promise.resolve;'],
    [
      'Object.defineProperty',
      "Object.defineProperty(holder.promise, 'resolve', { value: () => Deferred });",
    ],
    [
      'Object.defineProperties',
      'Object.defineProperties(holder.promise, { resolve: { value: () => Deferred } });',
    ],
    ['Object.assign', 'Object.assign(holder.promise, { resolve: () => Deferred });'],
    [
      'dynamic namespace and member keys',
      `const namespaceKey: keyof typeof holder = 'promise';
       const memberKey: keyof typeof Promise = 'resolve';
       holder[namespaceKey][memberKey] = (() => Deferred) as typeof Promise.resolve;`,
    ],
  ])('rejects an ordinary object carrier changed through %s', (_label, replacement) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Deferred {
        static then(resolve: (value: { ok: true }) => void): void {
          resolve({ ok: true });
          queueMicrotask(() => { void fetch('https://example.test/late'); });
        }
      }
      const holder = { promise: Promise };
      ${replacement}
      task('object-carrier-member-lockdown', {
        input: s.object({}),
        async run() { return Promise.resolve(); },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it('rejects a namespace reached through an object destructuring alias', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Deferred {
        static then(resolve: (value: { ok: true }) => void): void {
          resolve({ ok: true });
          queueMicrotask(() => { void fetch('https://example.test/late'); });
        }
      }
      const holder = { nested: { promise: Promise } };
      const { nested: { promise: promiseNamespace } } = holder;
      Object.defineProperty(promiseNamespace, 'resolve', { value: () => Deferred });
      task('destructured-carrier-member-lockdown', {
        input: s.object({}),
        async run() { return Promise.resolve(); },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it('rejects destructured global namespace and mutation-method aliases', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Deferred {
        static then(resolve: (value: { ok: true }) => void): void {
          resolve({ ok: true });
          queueMicrotask(() => { void fetch('https://example.test/late'); });
        }
      }
      const { Promise: promiseNamespace } = globalThis;
      const { defineProperty: replace } = Object;
      replace(promiseNamespace, 'resolve', { value: () => Deferred });
      task('destructured-global-member-lockdown', {
        input: s.object({}),
        async run() { return Promise.resolve(); },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it('keeps computed Object namespace seeds fail closed', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Deferred {
        static then(resolve: (value: { ok: true }) => void): void {
          resolve({ ok: true });
          queueMicrotask(() => { void fetch('https://example.test/late'); });
        }
      }
      const objectNamespace = globalThis[\`Object\`];
      const replace = objectNamespace['defineProperty'];
      replace(Promise, 'resolve', { value: () => Deferred });
      task('computed-object-seed-lockdown', {
        input: s.object({}),
        async run() { return Promise.resolve(); },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it.each([
    ['literal', '[Promise][0]!.resolve = (() => Deferred) as typeof Promise.resolve;'],
    [
      'nested',
      `const holder = { nested: [[Promise]] };
       holder.nested[0]![0]!.resolve = (() => Deferred) as typeof Promise.resolve;`,
    ],
  ])('rejects a namespace reached through a %s array projection', (_label, replacement) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Deferred {
        static then(resolve: (value: { ok: true }) => void): void {
          resolve({ ok: true });
          queueMicrotask(() => { void fetch('https://example.test/late'); });
        }
      }
      ${replacement}
      task('array-carrier-member-lockdown', {
        input: s.object({}),
        async run() { return Promise.resolve(); },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it.each([
    [
      'object destructuring assignment target',
      `({ resolve: Promise.resolve } = { resolve: (() => Deferred) as typeof Promise.resolve });`,
    ],
    [
      'array destructuring assignment target',
      `[Promise.resolve] = [(() => Deferred) as typeof Promise.resolve];`,
    ],
    [
      'nested destructuring assignment target',
      `({ nested: { resolve: Promise.resolve } } = {
         nested: { resolve: (() => Deferred) as typeof Promise.resolve },
       });`,
    ],
  ])('rejects a %s', (_label, replacement) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Deferred {
        static then(resolve: (value: { ok: true }) => void): void {
          resolve({ ok: true });
          queueMicrotask(() => { void fetch('https://example.test/late'); });
        }
      }
      ${replacement}
      task('assignment-pattern-member-lockdown', {
        input: s.object({}),
        async run() { return Promise.resolve(); },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it.each([
    [
      'for-of direct target',
      `for (Promise.resolve of [(() => Deferred) as typeof Promise.resolve]) { break; }`,
    ],
    ['for-in direct target', `for (Promise.resolve in { poisoned: true }) { break; }`],
    [
      'for-await direct target',
      `for await (Promise.resolve of [(() => Deferred) as typeof Promise.resolve]) { break; }`,
    ],
    [
      'for-of nested object target',
      `for ({ nested: { resolve: Promise.resolve } } of [{
         nested: { resolve: (() => Deferred) as typeof Promise.resolve },
       }]) { break; }`,
    ],
    [
      'for-await nested array target',
      `for await ([Promise.resolve] of [[(() => Deferred) as typeof Promise.resolve]]) {
         break;
       }`,
    ],
  ])('rejects a %s', (_label, replacement) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Deferred {
        static then(resolve: (value: { ok: true }) => void): void {
          resolve({ ok: true });
          queueMicrotask(() => { void fetch('https://example.test/late'); });
        }
      }
      task('loop-target-member-lockdown', {
        input: s.object({}),
        async run() {
          ${replacement}
          return Promise.resolve();
        },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it('fails closed when exact namespace provenance exhausts the traversal depth', () => {
    const aliasChain = Array.from(
      { length: 40 },
      (_value, index) => `const alias${index + 1} = alias${index};`,
    ).join('\n');
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Deferred {
        static then(resolve: (value: { ok: true }) => void): void {
          resolve({ ok: true });
          queueMicrotask(() => { void fetch('https://example.test/late'); });
        }
      }
      const alias0 = Promise;
      ${aliasChain}
      Object.defineProperty(alias40, 'resolve', { value: () => Deferred });
      task('exhausted-provenance-member-lockdown', {
        input: s.object({}),
        async run() { return Promise.resolve(); },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it('keeps pristine reviewed members and local lookalikes open', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      const LocalPromise = { resolve: () => ({ ok: true }) };
      Object.defineProperty(LocalPromise, 'resolve', { value: () => ({ ok: true }) });
      task('pristine-members', {
        input: s.object({}),
        async run() {
          void LocalPromise.resolve();
          void Response.json({ ok: true });
          void Array.isArray([]);
          void JSON.stringify({ ok: true });
          return Promise.resolve({ ok: true });
        },
      });
    `);

    expect(facts).toEqual([]);
  });

  it('keeps finite object, array, and destructuring carriers of local lookalikes open', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      const LocalPromise = { resolve: () => ({ ok: true }) };
      const holder = { nested: { promises: [LocalPromise] } };
      const { nested: { promises: [localNamespace] } } = holder;
      localNamespace.resolve = () => ({ ok: true });
      const namespaceKey: keyof typeof holder = 'nested';
      const memberKey: keyof typeof LocalPromise = 'resolve';
      holder[namespaceKey].promises[0]![memberKey] = () => ({ ok: true });
      Object.defineProperty(holder.nested.promises[0], 'resolve', {
        value: () => ({ ok: true }),
      });
      Object.defineProperties(holder.nested.promises[0], {
        resolve: { value: () => ({ ok: true }) },
      });
      Object.assign(holder.nested.promises[0], { resolve: () => ({ ok: true }) });
      ({ resolve: localNamespace.resolve } = { resolve: () => ({ ok: true }) });
      for (localNamespace.resolve of [() => ({ ok: true })]) { break; }
      task('local-carrier-control', {
        input: s.object({}),
        async run() {
          for await (localNamespace.resolve of [() => ({ ok: true })]) { break; }
          return Promise.resolve({ ok: true });
        },
      });
    `);

    expect(facts).toEqual([]);
  });

  it.each([
    [
      'mutable optional property',
      `const holder: { promise?: PromiseConstructor } = {};
       holder.promise = Promise;
       Object.defineProperty(holder.promise, 'resolve', { value: () => Deferred });`,
    ],
    [
      'nested mutable property',
      `const holder: { nested: { promise?: PromiseConstructor } } = { nested: {} };
       holder.nested.promise = Promise;
       Reflect.set(holder.nested.promise, 'resolve', () => Deferred);`,
    ],
    [
      'Object.assign carrier installation',
      `const holder: { promise?: PromiseConstructor } = {};
       Object.assign(holder, { promise: Promise });
       Object.defineProperty(holder.promise, 'resolve', { value: () => Deferred });`,
    ],
    [
      'Object.defineProperty carrier installation',
      `const holder: { promise?: PromiseConstructor } = {};
       Object.defineProperty(holder, 'promise', { value: Promise });
       Object.defineProperty(holder.promise, 'resolve', { value: () => Deferred });`,
    ],
    [
      'Object.defineProperty getter carrier installation',
      `const holder: { promise?: PromiseConstructor } = {};
       Object.defineProperty(holder, 'promise', { get: () => Promise });
       Object.defineProperty(holder.promise, 'resolve', { value: () => Deferred });`,
    ],
    [
      'Object.defineProperty method-getter carrier installation',
      `const holder: { promise?: PromiseConstructor } = {};
       Object.defineProperty(holder, 'promise', { get() { return Promise; } });
       Object.defineProperty(holder.promise, 'resolve', { value: () => Deferred });`,
    ],
    [
      'Object.defineProperties carrier installation',
      `const holder: { promise?: PromiseConstructor } = {};
       Object.defineProperties(holder, { promise: { value: Promise } });
       Object.defineProperty(holder.promise, 'resolve', { value: () => Deferred });`,
    ],
    [
      'Reflect.set carrier installation',
      `const holder: { promise?: PromiseConstructor } = {};
       Reflect.set(holder, 'promise', Promise);
       Object.defineProperty(holder.promise, 'resolve', { value: () => Deferred });`,
    ],
    [
      'Object.setPrototypeOf carrier installation',
      `const holder: { promise?: PromiseConstructor } = {};
       Object.setPrototypeOf(holder, { promise: Promise });
       Object.defineProperty(holder.promise, 'resolve', { value: () => Deferred });`,
    ],
    [
      'Reflect.setPrototypeOf carrier installation',
      `const holder: { promise?: PromiseConstructor } = {};
       Reflect.setPrototypeOf(holder, { promise: Promise });
       Object.defineProperty(holder.promise, 'resolve', { value: () => Deferred });`,
    ],
    [
      'Object.create carrier installation',
      `const holder: { promise?: PromiseConstructor } = Object.create({ promise: Promise });
       Object.defineProperty(holder.promise, 'resolve', { value: () => Deferred });`,
    ],
  ])('rejects a namespace installed through %s', (_label, prelude) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Deferred {
        static then(resolve: (value: { ok: true }) => void): void {
          resolve({ ok: true });
          queueMicrotask(() => { void fetch('https://example.test/late'); });
        }
      }
      ${prelude}
      task('mutable-carrier-member-lockdown', {
        input: s.object({}),
        async run() { return Promise.resolve(); },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it.each([
    [
      'object binding default',
      `const { promise = Promise }: { promise?: PromiseConstructor } = {};
       Object.defineProperty(promise, 'resolve', { value: () => Deferred });`,
    ],
    [
      'array binding default',
      `const [promise = Promise]: [PromiseConstructor?] = [];
       Object.defineProperty(promise, 'resolve', { value: () => Deferred });`,
    ],
    [
      'assignment result',
      `let promise: PromiseConstructor;
       Object.defineProperty((promise = Promise), 'resolve', { value: () => Deferred });`,
    ],
    [
      'logical assignment result',
      `let promise: PromiseConstructor | undefined;
       Object.defineProperty((promise ??= Promise), 'resolve', { value: () => Deferred });`,
    ],
  ])('rejects a namespace reached through a %s', (_label, prelude) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Deferred {
        static then(resolve: (value: { ok: true }) => void): void {
          resolve({ ok: true });
          queueMicrotask(() => { void fetch('https://example.test/late'); });
        }
      }
      ${prelude}
      task('default-and-assignment-result-lockdown', {
        input: s.object({}),
        async run() { return Promise.resolve(); },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it.each([
    [
      'array for-of binding',
      `for (const promise of [Promise]) {
         Object.defineProperty(promise, 'resolve', { value: () => Deferred });
       }`,
    ],
    [
      'Set for-of binding',
      `for (const promise of new Set([Promise])) {
         Object.defineProperty(promise, 'resolve', { value: () => Deferred });
       }`,
    ],
    [
      'destructured for-of binding',
      `for (const [promise] of [[Promise]]) {
         Object.defineProperty(promise, 'resolve', { value: () => Deferred });
       }`,
    ],
    [
      'array callback parameter',
      `[Promise].forEach((promise) => {
         Object.defineProperty(promise, 'resolve', { value: () => Deferred });
       });`,
    ],
  ])('rejects a namespace reaching a %s', (_label, prelude) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Deferred {
        static then(resolve: (value: { ok: true }) => void): void {
          resolve({ ok: true });
          queueMicrotask(() => { void fetch('https://example.test/late'); });
        }
      }
      ${prelude}
      task('iteration-member-lockdown', {
        input: s.object({}),
        async run() { return Promise.resolve(); },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it('rejects a namespace passed into a local mutation helper', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Deferred {
        static then(resolve: (value: { ok: true }) => void): void {
          resolve({ ok: true });
          queueMicrotask(() => { void fetch('https://example.test/late'); });
        }
      }
      function replace(target: PromiseConstructor): void {
        Object.defineProperty(target, 'resolve', { value: () => Deferred });
      }
      replace(Promise);
      task('local-helper-member-lockdown', {
        input: s.object({}),
        async run() { return Promise.resolve(); },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it('rejects a namespace substituted into an authored callback parameter', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Deferred {
        static then(resolve: (value: { ok: true }) => void): void {
          resolve({ ok: true });
          queueMicrotask(() => { void fetch('https://example.test/late'); });
        }
      }
      function visit(
        value: PromiseConstructor,
        callback: (value: PromiseConstructor) => void,
      ): void {
        callback(value);
      }
      const replace = (promise: PromiseConstructor): void => {
        Object.defineProperty(promise, 'resolve', { value: () => Deferred });
      };
      visit(Promise, replace);
      task('callback-parameter-member-lockdown', {
        input: s.object({}),
        async run() { return Promise.resolve(); },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it.each([
    ['at', `[Promise].at(0)`],
    ['slice', `[Promise].slice(0)[0]`],
    ['shifted slice', `[{ local: true }, Promise].slice(1)[0]`],
    ['spread', `[{ local: true }, ...[Promise]][1]`],
    ['find', `[Promise].find(() => true)`],
    ['map', `[Promise].map((value) => value)[0]`],
  ])('rejects a namespace reached through Array.%s', (_label, receiver) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Deferred {
        static then(resolve: (value: { ok: true }) => void): void {
          resolve({ ok: true });
          queueMicrotask(() => { void fetch('https://example.test/late'); });
        }
      }
      Object.defineProperty(${receiver}, 'resolve', { value: () => Deferred });
      task('array-method-member-lockdown', {
        input: s.object({}),
        async run() { return Promise.resolve(); },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it.each(EXACT_GLOBAL_ARRAY_CARRIER_CASES)(
    'rejects all four exact members reached through the reviewed Array %s carrier/result',
    (_label, carrier) => {
      const poisons = EXACT_GLOBAL_MEMBER_CASES.map(
        ([namespace, member]) =>
          `Object.defineProperty(${carrier(namespace)}, '${member}', { value: () => Deferred });`,
      ).join('\n');
      const tasks = EXACT_GLOBAL_MEMBER_CASES.map(
        ([_namespace, _member, invocation], index) => `
          task('array-carrier-family-${index}', {
            input: s.object({}),
            async run() { return ${invocation}; },
          });`,
      ).join('\n');
      const facts = sinksFor(`
        import { s, task } from '@kovojs/server';
        class Deferred {
          static then(resolve: (value: { ok: true }) => void): void {
            resolve({ ok: true });
            queueMicrotask(() => { void fetch('https://example.test/late'); });
          }
        }
        ${poisons}
        ${tasks}
      `);

      for (const [, , , source] of EXACT_GLOBAL_MEMBER_CASES) {
        expectExactMemberRejected(facts, source);
      }
    },
  );

  it.each(EXACT_GLOBAL_ITERABLE_CARRIER_CASES)(
    'rejects all four exact members reached through %s',
    (_label, carrier) => {
      const poisons = EXACT_GLOBAL_MEMBER_CASES.map(
        ([namespace, member]) =>
          `Object.defineProperty(${carrier(namespace)}, '${member}', { value: () => Deferred });`,
      ).join('\n');
      const tasks = EXACT_GLOBAL_MEMBER_CASES.map(
        ([_namespace, _member, invocation], index) => `
          task('iterable-carrier-family-${index}', {
            input: s.object({}),
            async run() { return ${invocation}; },
          });`,
      ).join('\n');
      const facts = sinksFor(`
        import { s, task } from '@kovojs/server';
        class Deferred {
          static then(resolve: (value: { ok: true }) => void): void {
            resolve({ ok: true });
            queueMicrotask(() => { void fetch('https://example.test/late'); });
          }
        }
        ${poisons}
        ${tasks}
      `);

      for (const [, , , source] of EXACT_GLOBAL_MEMBER_CASES) {
        expectExactMemberRejected(facts, source);
      }
    },
  );

  it('fails closed when exact Array.of carrier semantics are authored-mutable', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Deferred {
        static then(resolve: (value: { ok: true }) => void): void {
          resolve({ ok: true });
          queueMicrotask(() => { void fetch('https://example.test/late'); });
        }
      }
      Array.of = ((value: unknown) => [value]) as typeof Array.of;
      Object.defineProperty(Array.of(Promise)[0]!, 'resolve', { value: () => Deferred });
      task('mutable-array-of-carrier', {
        input: s.object({}),
        async run() { return Promise.resolve(); },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it('tracks Set duplicate collapse for indexed reads and destructuring', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Deferred {
        static then(resolve: (value: { ok: true }) => void): void {
          resolve({ ok: true });
          queueMicrotask(() => { void fetch('https://example.test/late'); });
        }
      }
      const localNamespace = { resolve: () => ({ ok: true }) };
      Object.defineProperty(
        [...new Set([localNamespace, localNamespace, Promise])][1]!,
        'resolve',
        { value: () => Deferred },
      );
      const [, destructured] = new Set([localNamespace, localNamespace, Promise]);
      Object.defineProperty(destructured!, 'resolve', { value: () => Deferred });
      task('set-duplicate-collapse', {
        input: s.object({}),
        async run() { return Promise.resolve(); },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it('tracks a later custom-iterator yield that can occupy the first materialized slot', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Deferred {
        static then(resolve: (value: { ok: true }) => void): void {
          resolve({ ok: true });
          queueMicrotask(() => { void fetch('https://example.test/late'); });
        }
      }
      const localNamespace = { resolve: () => ({ ok: true }) };
      const carrier = {
        *[Symbol.iterator]() {
          if (false) yield localNamespace;
          yield Promise;
        },
      };
      Object.defineProperty([...carrier][0]!, 'resolve', { value: () => Deferred });
      task('conditional-iterator-slot', {
        input: s.object({}),
        async run() { return Promise.resolve(); },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it.each([
    [
      'Set destructuring',
      'const [carrier] = new Set([Promise]);',
      `Object.defineProperty(carrier!, 'resolve', { value: () => Deferred });`,
    ],
    [
      'authored iterable destructuring',
      'const [carrier] = { *[Symbol.iterator]() { yield Promise; } };',
      `Object.defineProperty(carrier!, 'resolve', { value: () => Deferred });`,
    ],
    [
      'tuple call spread',
      `function replace(target: PromiseConstructor): void {
         Object.defineProperty(target, 'resolve', { value: () => Deferred });
       }`,
      'replace(...([Promise] as [PromiseConstructor]));',
    ],
    [
      'Set call spread',
      `function replace(target: PromiseConstructor): void {
         Object.defineProperty(target, 'resolve', { value: () => Deferred });
       }`,
      'replace(...(new Set([Promise]) as unknown as [PromiseConstructor]));',
    ],
    [
      'authored iterable call spread',
      `function replace(target: PromiseConstructor): void {
         Object.defineProperty(target, 'resolve', { value: () => Deferred });
       }`,
      `replace(...({
         *[Symbol.iterator]() { yield Promise; }
       } as unknown as [PromiseConstructor]));`,
    ],
    [
      'rest parameter indexed read',
      `function replace(...targets: [PromiseConstructor]): void {
         Object.defineProperty(targets[0], 'resolve', { value: () => Deferred });
       }`,
      'replace(Promise);',
    ],
    [
      'tuple-destructured parameter',
      `function replace([target]: [PromiseConstructor]): void {
         Object.defineProperty(target, 'resolve', { value: () => Deferred });
       }`,
      'replace([Promise]);',
    ],
    [
      'object-destructured aliased parameter',
      `function replace({ target: alias }: { target: PromiseConstructor }): void {
         Object.defineProperty(alias, 'resolve', { value: () => Deferred });
       }`,
      'replace({ target: Promise });',
    ],
    [
      'tuple-destructured parameter default',
      `function replace([target = Promise]: [PromiseConstructor?]): void {
         Object.defineProperty(target, 'resolve', { value: () => Deferred });
       }`,
      'replace([]);',
    ],
    [
      'object-destructured aliased parameter default',
      `function replace(
         { target: alias = Promise }: { target?: PromiseConstructor },
       ): void {
         Object.defineProperty(alias, 'resolve', { value: () => Deferred });
       }`,
      'replace({});',
    ],
    [
      'object-rest parameter member read',
      `function replace({ ...rest }: { target: PromiseConstructor }): void {
         Object.defineProperty(rest.target, 'resolve', { value: () => Deferred });
       }`,
      'replace({ target: Promise });',
    ],
  ])('rejects Promise flowing through %s', (_label, prelude, poison) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Deferred {
        static then(resolve: (value: { ok: true }) => void): void {
          resolve({ ok: true });
          queueMicrotask(() => { void fetch('https://example.test/late'); });
        }
      }
      ${prelude}
      ${poison}
      task('carrier-binding-member-lockdown', {
        input: s.object({}),
        async run() { return Promise.resolve(); },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it('keeps iterable carriers, call spreads, and parameter patterns open for local lookalikes', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      const LocalPromise = { resolve: () => ({ ok: true }) };
      const localCarriers = [
        Array.of(LocalPromise)[0]!,
        [...Array.of(LocalPromise)][0]!,
        [...new Set([LocalPromise])][0]!,
        [...{ *[Symbol.iterator]() { yield LocalPromise; } }][0]!,
      ];
      for (const carrier of localCarriers) {
        Object.defineProperty(carrier, 'resolve', { value: () => ({ ok: true }) });
      }
      const [setCarrier] = new Set([LocalPromise]);
      Object.defineProperty(setCarrier!, 'resolve', { value: () => ({ ok: true }) });
      Object.defineProperty(
        [...new Set([LocalPromise, LocalPromise, Promise])][0]!,
        'resolve',
        { value: () => ({ ok: true }) },
      );
      function spreadReplace(target: typeof LocalPromise): void {
        Object.defineProperty(target, 'resolve', { value: () => ({ ok: true }) });
      }
      spreadReplace(...([LocalPromise] as [typeof LocalPromise]));
      spreadReplace(...(new Set([LocalPromise]) as unknown as [typeof LocalPromise]));
      spreadReplace(...({
        *[Symbol.iterator]() { yield LocalPromise; }
      } as unknown as [typeof LocalPromise]));
      function restReplace(...targets: [typeof LocalPromise]): void {
        Object.defineProperty(targets[0], 'resolve', { value: () => ({ ok: true }) });
      }
      restReplace(LocalPromise);
      function tupleReplace([target]: [typeof LocalPromise]): void {
        Object.defineProperty(target, 'resolve', { value: () => ({ ok: true }) });
      }
      tupleReplace([LocalPromise]);
      function objectReplace({ target: alias }: { target: typeof LocalPromise }): void {
        Object.defineProperty(alias, 'resolve', { value: () => ({ ok: true }) });
      }
      objectReplace({ target: LocalPromise });
      function copiedGlobalIsNotGlobal({ ...copy }: PromiseConstructor): void {
        Object.defineProperty(copy, 'resolve', { value: () => ({ ok: true }) });
      }
      copiedGlobalIsNotGlobal(Promise);
      const { ...copiedPromise } = Promise;
      Object.defineProperty(copiedPromise, 'resolve', { value: () => ({ ok: true }) });
      task('local-iterable-binding-lookalikes', {
        input: s.object({}),
        async run() { return Promise.resolve({ ok: true }); },
      });
    `);

    expect(facts.some((fact) => fact.source === 'Promise.resolve')).toBe(false);
  });

  it.each([
    [
      'spread materialization',
      `declare function opaqueIterable(): Iterable<PromiseConstructor>;
       Object.defineProperty([...opaqueIterable()][0]!, 'resolve', {
         value: () => Deferred,
       });`,
    ],
    [
      'destructuring',
      `declare function opaqueIterable(): Iterable<PromiseConstructor>;
       const [carrier] = opaqueIterable();
       Object.defineProperty(carrier!, 'resolve', { value: () => Deferred });`,
    ],
    [
      'call spread',
      `declare function opaqueTuple(): [PromiseConstructor];
       function replace(target: PromiseConstructor): void {
         Object.defineProperty(target, 'resolve', { value: () => Deferred });
       }
       replace(...opaqueTuple());`,
    ],
  ])('keeps an opaque iterable %s fail closed', (_label, poison) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Deferred {
        static then(resolve: (value: { ok: true }) => void): void {
          resolve({ ok: true });
          queueMicrotask(() => { void fetch('https://example.test/late'); });
        }
      }
      ${poison}
      task('opaque-iterable-carrier', {
        input: s.object({}),
        async run() { return Promise.resolve(); },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it('keeps every reviewed Array carrier/result method open for local lookalikes', () => {
    const localNamespaces = [
      ['LocalPromise', 'resolve'],
      ['LocalResponse', 'json'],
      ['LocalArray', 'isArray'],
      ['LocalJson', 'stringify'],
    ] as const;
    const localMutations = EXACT_GLOBAL_ARRAY_CARRIER_CASES.flatMap(([_label, carrier]) =>
      localNamespaces.map(
        ([namespace, member]) =>
          `(${carrier(namespace)} as Record<string, unknown>)['${member}'] = () => ({ ok: true });`,
      ),
    ).join('\n');
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      const LocalPromise = { resolve: () => ({ ok: true }) };
      const LocalResponse = { json: () => ({ ok: true }) };
      const LocalArray = { isArray: () => true };
      const LocalJson = { stringify: () => 'ok' };
      ${localMutations}
      task('local-array-carrier-family', {
        input: s.object({}),
        async run() {
          void Response.json({ ok: true });
          void Array.isArray([]);
          void JSON.stringify({ ok: true });
          return Promise.resolve({ ok: true });
        },
      });
    `);

    for (const [, , , source] of EXACT_GLOBAL_MEMBER_CASES) {
      expect(facts.some((fact) => fact.source === source)).toBe(false);
    }
  });

  it.each([
    ['hexadecimal to decimal', `const holder = { 0x0: Promise };`, `holder[0]`],
    ['decimal to hexadecimal', `const holder = { 0: Promise };`, `holder[0x0]`],
  ])('canonicalizes %s numeric carrier keys', (_label, prelude, receiver) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Deferred {
        static then(resolve: (value: { ok: true }) => void): void {
          resolve({ ok: true });
          queueMicrotask(() => { void fetch('https://example.test/late'); });
        }
      }
      ${prelude}
      Object.defineProperty(${receiver}, 'resolve', { value: () => Deferred });
      task('numeric-key-member-lockdown', {
        input: s.object({}),
        async run() { return Promise.resolve(); },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it.each([
    ['named barrel', `export { replace } from './ops.js';`],
    ['export-star barrel', `export * from './ops.js';`],
    ['default-as-named barrel', `export { default as replace } from './ops.js';`],
  ])('rejects Promise passed through an imported %s mutation wrapper', (_label, barrel) => {
    const defaultExport = _label === 'default-as-named barrel' ? 'export default replace;' : '';
    const facts = sinksForFiles([
      {
        fileName: 'ops.ts',
        source: `
          export function replace(target: PromiseConstructor, value: () => unknown): void {
            Object.defineProperty(target, 'resolve', { value });
          }
          ${defaultExport}
        `,
      },
      { fileName: 'barrel.ts', source: barrel },
      {
        fileName: 'app.ts',
        source: `
          import { replace } from './barrel.js';
          import { s, task } from '@kovojs/server';
          class Deferred {
            static then(resolve: (value: { ok: true }) => void): void {
              resolve({ ok: true });
              queueMicrotask(() => { void fetch('https://example.test/late'); });
            }
          }
          replace(Promise, () => Deferred);
          task('imported-wrapper-member-lockdown', {
            input: s.object({}),
            async run() { return Promise.resolve(); },
          });
        `,
      },
    ]);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it('keeps an authored getter returning a local lookalike from poisoning the global member', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      const LocalPromise = { resolve: () => ({ ok: true }) };
      const holder = { get promise() { return LocalPromise; } };
      Object.defineProperty(holder.promise, 'resolve', { value: () => ({ ok: true }) });
      task('local-getter-lookalike', {
        input: s.object({}),
        async run() { return Promise.resolve({ ok: true }); },
      });
    `);

    expect(facts).toEqual([]);
  });

  it('does not close the global member for helper and callback substitution of local lookalikes', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      const LocalPromise = { resolve: () => ({ ok: true }) };
      function visit(
        value: typeof LocalPromise,
        callback: (value: typeof LocalPromise) => void,
      ): void {
        callback(value);
      }
      const replace = (promise: typeof LocalPromise): void => {
        Object.defineProperty(promise, 'resolve', { value: () => ({ ok: true }) });
      };
      visit(LocalPromise, replace);
      task('local-callback-lookalike', {
        input: s.object({}),
        async run() { return Promise.resolve({ ok: true }); },
      });
    `);

    expect(facts.some((fact) => fact.source === 'Promise.resolve')).toBe(false);
  });

  it('keeps reusable callback-helper substitution bound to the actual safe invocation', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      type Namespace = { resolve: (...args: never[]) => unknown };
      const LocalPromise: Namespace = { resolve: () => ({ ok: true }) };
      function visit(value: Namespace, callback: (value: Namespace) => void): void {
        callback(value);
      }
      const noop = (promise: Namespace): void => { void promise; };
      const replace = (promise: Namespace): void => {
        Object.defineProperty(promise, 'resolve', { value: () => ({ ok: true }) });
      };
      visit(Promise, noop);
      visit(LocalPromise, replace);
      task('call-site-sensitive-local-callback', {
        input: s.object({}),
        async run() { return Promise.resolve({ ok: true }); },
      });
    `);

    expect(facts.some((fact) => fact.source === 'Promise.resolve')).toBe(false);
  });

  it('closes reusable callback-helper substitution at the actually poisoned invocation', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      type Namespace = { resolve: (...args: never[]) => unknown };
      const LocalPromise: Namespace = { resolve: () => ({ ok: true }) };
      function visit(value: Namespace, callback: (value: Namespace) => void): void {
        callback(value);
      }
      const noop = (promise: Namespace): void => { void promise; };
      const replace = (promise: Namespace): void => {
        Object.defineProperty(promise, 'resolve', { value: () => ({ ok: true }) });
      };
      visit(LocalPromise, noop);
      visit(Promise, replace);
      task('call-site-sensitive-global-callback', {
        input: s.object({}),
        async run() { return Promise.resolve({ ok: true }); },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
  });

  it('keeps reusable helper return substitution call-site-sensitive', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      const LocalPromise = { resolve: () => ({ ok: true }) };
      function identity<T>(value: T): T { return value; }
      void identity(Promise);
      Object.defineProperty(identity(LocalPromise), 'resolve', {
        value: () => ({ ok: true }),
      });
      task('local-helper-return-lookalike', {
        input: s.object({}),
        async run() { return Promise.resolve({ ok: true }); },
      });
    `);

    expect(facts.some((fact) => fact.source === 'Promise.resolve')).toBe(false);
  });

  it('keeps cyclic exact-global aliases sound and bounded', () => {
    const startedAt = cpuUsage();
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      function noop(value: PromiseConstructor): void { void value; }
      let root!: PromiseConstructor;
      let cycle!: PromiseConstructor;
      root = true ? cycle : Promise;
      cycle = root;
      noop(root);
      Object.defineProperty(cycle, 'resolve', { value: () => ({ ok: true }) });
      task('cyclic-exact-global-alias', {
        input: s.object({}),
        async run() { return Promise.resolve({ ok: true }); },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
    expect(elapsedClassifierCpuMs(startedAt)).toBeLessThan(2_000);
  });

  it('keeps an Object/Reflect-free high-fanout call graph bounded', () => {
    const bindings = Array.from({ length: 160 }, (_value, index) =>
      [
        `function createBinding${index}(value: { ok: true }) {`,
        '  return { invoke: () => value };',
        '}',
        `const binding${index} = createBinding${index}({ ok: true });`,
        `void binding${index}.invoke();`,
      ].join('\n'),
    ).join('\n');
    const startedAt = cpuUsage();
    const facts = sinksFor(`
      import { endpoint, publicAccess } from '@kovojs/server';
      ${bindings}
      endpoint('/bounded-no-mutation-authority', {
        access: publicAccess('bounded exact-global provenance proof'),
        auth: { justification: 'bounded exact-global provenance proof', kind: 'none' },
        csrf: false,
        csrfJustification: 'read-only exact-global provenance proof',
        handler() { return Response.json({ ok: true }); },
        method: 'GET',
        reason: 'read-only exact-global provenance proof',
        response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
      });
    `);

    expect(facts).toEqual([]);
    expect(elapsedClassifierCpuMs(startedAt)).toBeLessThan(5_000);
  });

  it('keeps diamond alias provenance bounded', () => {
    const aliases = Array.from(
      { length: 18 },
      (_value, index) => `const alias${index + 1} = true ? alias${index} : alias${index};`,
    ).join('\n');
    const startedAt = cpuUsage();
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      const alias0 = Promise;
      ${aliases}
      Object.defineProperty(alias18, 'resolve', { value: () => ({ ok: true }) });
      task('bounded-diamond-provenance', {
        input: s.object({}),
        async run() { return Promise.resolve({ ok: true }); },
      });
    `);

    expectExactMemberRejected(facts, 'Promise.resolve');
    expect(elapsedClassifierCpuMs(startedAt)).toBeLessThan(2_000);
  });

  it('keeps 120 distinct iterable and parameter-pattern safe misses bounded', () => {
    const count = 120;
    const helpers = Array.from({ length: count }, (_value, index) => {
      if (index % 3 === 0) {
        return `function replace${index}([target]: [typeof LocalPromise]): void {
          Object.defineProperty(target, 'resolve', { value: () => ({ ok: true }) });
        }`;
      }
      if (index % 3 === 1) {
        return `function replace${index}({ target }: { target: typeof LocalPromise }): void {
          Object.defineProperty(target, 'resolve', { value: () => ({ ok: true }) });
        }`;
      }
      return `function replace${index}(...targets: [typeof LocalPromise]): void {
        Object.defineProperty(targets[0], 'resolve', { value: () => ({ ok: true }) });
      }`;
    }).join('\n');
    const calls = Array.from({ length: count }, (_value, index) => {
      if (index % 3 === 0) return `replace${index}([LocalPromise]);`;
      if (index % 3 === 1) return `replace${index}({ target: LocalPromise });`;
      return `replace${index}(...([LocalPromise] as [typeof LocalPromise]));`;
    }).join('\n');
    const startedAt = cpuUsage();
    const facts = sinksFor(`
      const LocalPromise = { resolve: () => ({ ok: true }) };
      ${helpers}
      ${calls}
      void Promise.resolve({ ok: true });
    `);

    expect(facts).toEqual([]);
    expect(elapsedClassifierCpuMs(startedAt)).toBeLessThan(5_000);
  });

  it('indexes 400/800 distinct exact-global helper safe misses with near-linear bounded scaling', () => {
    const run = (count: number): number => {
      const helpers = Array.from(
        { length: count },
        (_value, index) => `
          function replace${index}(target: typeof LocalPromise): void {
            Object.defineProperty(target, 'resolve', { value: () => ({ ok: true }) });
          }`,
      ).join('\n');
      const calls = Array.from(
        { length: count },
        (_value, index) => `replace${index}(LocalPromise);`,
      ).join('\n');
      const startedAt = cpuUsage();
      const facts = sinksFor(`
        const LocalPromise = { resolve: () => ({ ok: true }) };
        ${helpers}
        function retainDistinctSafeMissCalls(): void {
          ${calls}
        }
        void retainDistinctSafeMissCalls;
        void Promise.resolve({ ok: true });
      `);
      const elapsed = elapsedClassifierCpuMs(startedAt);
      expect(facts).toEqual([]);
      return elapsed;
    };

    const fourHundredMs = run(400);
    const eightHundredMs = run(800);
    expect(fourHundredMs).toBeLessThan(4_000);
    expect(eightHundredMs).toBeLessThan(6_000);
    expect(eightHundredMs).toBeLessThan(Math.max(1_000, fourHundredMs * 3));
  });
});
