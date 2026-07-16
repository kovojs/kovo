import { describe, expect, it } from 'vitest';

import { collectUnregisteredSinksFromProject } from '@kovojs/drizzle/internal/static';
import type { TrustEscapeSourceFileInput } from '@kovojs/drizzle/internal/static';

function sinksFor(source: string) {
  return collectUnregisteredSinksFromProject({ files: [{ fileName: 'app.ts', source }] });
}

function sinksForFiles(files: readonly TrustEscapeSourceFileInput[]) {
  return collectUnregisteredSinksFromProject({ files });
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
});
