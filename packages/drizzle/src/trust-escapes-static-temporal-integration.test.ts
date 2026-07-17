import { describe, expect, it } from 'vitest';

import { collectUnregisteredSinksFromProject } from '@kovojs/drizzle/internal/static';

function sinksFor(source: string) {
  return collectUnregisteredSinksFromProject({ files: [{ fileName: 'app.ts', source }] });
}

function expectOpaqueBoundary(facts: ReturnType<typeof sinksFor>): void {
  expect(facts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sink: expect.stringMatching(/^request-handler\.opaque/u) }),
    ]),
  );
}

// Regression repros for the combined C1/C2/C3 replay at bedfeb0de.
describe('temporal/provenance combined blockers', () => {
  it.each([
    [
      'own static getter',
      `class Holder { static get promise() { return Promise; } }
       Object.defineProperty(Holder.promise, 'resolve', { value: () => Deferred });`,
    ],
    [
      'own static field',
      `class Holder { static promise = Promise; }
       Object.defineProperty(Holder.promise, 'resolve', { value: () => Deferred });`,
    ],
    [
      'inherited static getter',
      `class Base { static get promise() { return Promise; } }
       class Holder extends Base {}
       Object.defineProperty(Holder.promise, 'resolve', { value: () => Deferred });`,
    ],
    [
      'inherited static field',
      `class Base { static promise = Promise; }
       class Holder extends Base {}
       Object.defineProperty(Holder.promise, 'resolve', { value: () => Deferred });`,
    ],
    [
      'assigned static field',
      `class Holder {}
       (Holder as any).promise = Promise;
       Object.defineProperty((Holder as any).promise, 'resolve', { value: () => Deferred });`,
    ],
    [
      'Object.assign static field',
      `class Holder {}
       Object.assign(Holder, { promise: Promise });
       Object.defineProperty((Holder as any).promise, 'resolve', { value: () => Deferred });`,
    ],
    [
      'Reflect.set static field',
      `class Holder {}
       Reflect.set(Holder, 'promise', Promise);
       Object.defineProperty((Holder as any).promise, 'resolve', { value: () => Deferred });`,
    ],
    [
      'defined static field',
      `class Holder {}
       Object.defineProperty(Holder, 'promise', { value: Promise });
       Object.defineProperty((Holder as any).promise, 'resolve', { value: () => Deferred });`,
    ],
    [
      'defined static getter',
      `class Holder {}
       Object.defineProperty(Holder, 'promise', { get: () => Promise });
       Object.defineProperty((Holder as any).promise, 'resolve', { value: () => Deferred });`,
    ],
    [
      'defineProperties static field',
      `class Holder {}
       Object.defineProperties(Holder, { promise: { value: Promise } });
       Object.defineProperty((Holder as any).promise, 'resolve', { value: () => Deferred });`,
    ],
  ])('C1 preserves Promise identity through a class %s', (_label, poison) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Deferred {
        static then(resolve: (value: { ok: true }) => void) {
          resolve({ ok: true });
          queueMicrotask(() => { void fetch('https://example.test/late'); });
        }
      }
      ${poison}
      task('class-global-carrier', {
        input: s.object({}),
        async run() { return Promise.resolve({ ok: true }); },
      });
    `);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: expect.stringMatching(/^request-handler\.opaque/u),
          source: 'Promise.resolve',
        }),
      ]),
    );
  });

  it.each([
    [
      'Object.setPrototypeOf with a class',
      `class Base { static value = DeferredValue; }
       class Child {}
       Object.setPrototypeOf(Child, Base);
       return (Child as typeof Base).value;`,
    ],
    [
      '__proto__ assignment with a class',
      `class Base { static value = DeferredValue; }
       class Child {}
       (Child as any).__proto__ = Base;
       return (Child as typeof Base).value;`,
    ],
    [
      'Object.defineProperties on an inherited class',
      `class Base {}
       Object.defineProperties(Base, { value: { value: DeferredValue } });
       class Child extends Base {}
       return (Child as typeof Base & { value: typeof DeferredValue }).value;`,
    ],
    [
      '__proto__ assignment on a plain thenable',
      `const value = {};
       (value as any).__proto__ = {
         then(resolve: (value: { ok: true }) => void) {
           resolve({ ok: true });
           queueMicrotask(() => { void context.fetch('https://example.test/late'); });
         },
       };
       return value;`,
    ],
  ])('C2 rejects %s', (_label, statement) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      task('dynamic-static-projection', { input: s.object({}), run(_input, context) {
        class DeferredValue {
          static then(resolve: (value: { ok: true }) => void) {
            resolve({ ok: true });
            queueMicrotask(() => { void context.fetch('https://example.test/late'); });
          }
        }
        ${statement}
      } });
    `);

    expectOpaqueBoundary(facts);
  });

  it.each([
    ['toSorted element', `const alias = input.items.toSorted(() => 0)[0]!;`],
    ['spread element', `const alias = [...input.items][0]!;`],
    ['Array.of spread element', `const alias = Array.of(...input.items)[0]!;`],
    ['filter plus spread element', `const alias = [...input.items.filter(() => true)][0]!;`],
    ['Set spread element', `const alias = [...new Set(input.items)][0]!;`],
    [
      'destructured helper result',
      `function identity<T>(value: T) { return [value] as const; }
       const [alias] = identity(input.items[0]!);`,
    ],
  ])('C3 invalidates a validated root through a %s', (_label, setup) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      task('root-alias', {
        input: s.object({ items: s.array(s.object({ value: s.string() })) }),
        run(input) {
          class DeferredValue {
            static then(resolve: (value: { ok: true }) => void) { resolve({ ok: true }); }
          }
          ${setup}
          alias.value = DeferredValue as unknown as string;
          return input.items[0]!.value;
        },
      });
    `);

    expectOpaqueBoundary(facts);
  });

  it.each([
    [
      'field',
      `class Base { static value = DeferredValue; }
       class Child extends Base { static value = { ok: true }; }`,
    ],
    [
      'base descriptor',
      `class Base {}
       Object.defineProperty(Base, 'value', { value: DeferredValue });
       class Child extends Base { static value = { ok: true }; }`,
    ],
    [
      'subclass descriptor',
      `class Base { static value = DeferredValue; }
       class Child extends Base {}
       Object.defineProperty(Child, 'value', { value: { ok: true } });`,
    ],
    [
      'dynamic prototype',
      `class Base { static value = DeferredValue; }
       class Child {}
       Object.setPrototypeOf(Child, Base);
       Object.defineProperty(Child, 'value', { value: { ok: true } });`,
    ],
  ])('does not inherit a shadowed unsafe static %s', (_label, setup) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class DeferredValue {
        static then(resolve: (value: { ok: true }) => void) { resolve({ ok: true }); }
      }
      task('static-override', { input: s.object({}), run() {
        ${setup}
        return Child.value;
      } });
    `);

    expect(facts).toEqual([]);
  });

  it.each([
    ['assignment', `(Holder as any).promise = Promise;`],
    ['descriptor', `Object.defineProperty(Holder, 'promise', { get: () => Promise });`],
  ])('does not apply a later class-static %s to an earlier local write', (_label, laterWrite) => {
    const facts = sinksFor(`
      const LocalPromise = { resolve: () => ({ ok: true }) };
      class Holder { static promise = LocalPromise; }
      Object.defineProperty(Holder.promise, 'resolve', { value: () => ({ ok: true }) });
      ${laterWrite}
      void Promise.resolve({ ok: true });
    `);

    expect(facts).toEqual([]);
  });

  it('keeps an ordinary local destructured mutation helper open', () => {
    const facts = sinksFor(`
      const LocalPromise = { resolve: () => ({ ok: true }) };
      function replace({ target }: { target: typeof LocalPromise }) {
        Object.defineProperty(target, 'resolve', { value: () => ({ ok: true }) });
      }
      replace({ target: LocalPromise });
      void Promise.resolve({ ok: true });
    `);

    expect(facts).toEqual([]);
  });

  it.each([
    [
      'validated input',
      `import { s, task } from '@kovojs/server';
       task('opaque-target/input', { input: s.object({}), run(input) {
         function replace({ target }: { target: object }) {
           Object.defineProperty(target, 'value', { value: 1 });
         }
         replace({ target: input });
         return { ok: true };
       } });`,
    ],
    [
      'Proxy',
      `const target = new Proxy({}, {});
       function replace({ target: value }: { target: object }) {
         Object.defineProperty(value, 'value', { value: 1 });
       }
       replace({ target });`,
    ],
    [
      'exported helper parameter',
      `const target = {};
       export function replace({ target: value }: { target: object }) {
         Object.defineProperty(value, 'value', { value: 1 });
       }
       replace({ target });`,
    ],
  ])('keeps an unresolved %s reflective target closed', (_label, source) => {
    expectOpaqueBoundary(sinksFor(source));
  });
});
