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
});
