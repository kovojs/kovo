import { describe, expect, it } from 'vitest';

import { collectUnregisteredSinksFromProject } from '@kovojs/drizzle/internal/static';
import type { TrustEscapeSourceFileInput } from '@kovojs/drizzle/internal/static';

function sinksFor(source: string) {
  return collectUnregisteredSinksFromProject({ files: [{ fileName: 'app.ts', source }] });
}

function sinksForFiles(files: readonly TrustEscapeSourceFileInput[]) {
  return collectUnregisteredSinksFromProject({ files });
}

function expectClosed(facts: ReturnType<typeof sinksFor>, label: string): void {
  expect(
    facts.some((fact) => fact.sink.startsWith('request-handler.opaque')),
    `${label}: ${JSON.stringify(facts)}`,
  ).toBe(true);
}

const deferred = `
  class DeferredValue {
    static then(resolve: (value: { ok: true }) => void) {
      resolve({ ok: true });
    }
  }
`;

const deferredWithLateAuthority = `
  class DeferredValue {
    static then(resolve: (value: { ok: true }) => void) {
      resolve({ ok: true });
      queueMicrotask(() => { void fetch('https://example.test/late'); });
    }
  }
`;

describe('temporal final adversarial review', () => {
  it.each([
    [
      'static block this assignment',
      `class Holder { static { (this as any).promise = Promise; } }
       Object.defineProperty((Holder as any).promise, 'resolve', { value: () => DeferredValue });`,
    ],
    [
      'helper-installed static member',
      `function install(target: any) { target.promise = Promise; }
       class Holder {}
       install(Holder);
       Object.defineProperty((Holder as any).promise, 'resolve', { value: () => DeferredValue });`,
    ],
    [
      'carrier-installed static member',
      `class Holder {}
       const box = { target: Holder };
       box.target.promise = Promise;
       Object.defineProperty((Holder as any).promise, 'resolve', { value: () => DeferredValue });`,
    ],
    [
      'static block descriptor',
      `class Holder {
         static { Object.defineProperty(this, 'promise', { value: Promise }); }
       }
       Object.defineProperty((Holder as any).promise, 'resolve', { value: () => DeferredValue });`,
    ],
    [
      'static field side effect',
      `class Holder {
         static installed = Object.assign(this, { promise: Promise });
       }
       Object.defineProperty((Holder as any).promise, 'resolve', { value: () => DeferredValue });`,
    ],
    [
      'helper-installed descriptor',
      `function install(target: object) {
         Object.defineProperty(target, 'promise', { value: Promise });
       }
       class Holder {}
       install(Holder);
       Object.defineProperty((Holder as any).promise, 'resolve', { value: () => DeferredValue });`,
    ],
  ])('C1 rejects a Promise carrier through %s', (label, poison) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      ${deferredWithLateAuthority}
      ${poison}
      task('c1-review', { input: s.object({}), async run() { return Promise.resolve(); } });
    `);
    expectClosed(facts, label);
  });

  it.each([
    ['Response', 'json', 'Response.json({ ok: true })'],
    ['Array', 'isArray', 'Array.isArray([])'],
    ['JSON', 'stringify', 'JSON.stringify({ ok: true })'],
  ])('C1 rejects a class static-block carrier of %s.%s', (namespace, member, invocation) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      ${deferredWithLateAuthority}
      class Holder { static { (this as any).namespace = ${namespace}; } }
      Object.defineProperty((Holder as any).namespace, '${member}', {
        value: () => DeferredValue,
      });
      task('c1-other-global', { input: s.object({}), run() { return ${invocation}; } });
    `);
    expectClosed(facts, `${namespace}.${member} static-block carrier`);
  });

  it('C1 rejects an imported class carrier', () => {
    const facts = sinksForFiles([
      {
        fileName: 'carrier.ts',
        source: `export class Holder { static promise = Promise; }`,
      },
      {
        fileName: 'app.ts',
        source: `
          import { s, task } from '@kovojs/server';
          import { Holder } from './carrier.js';
          ${deferredWithLateAuthority}
          Object.defineProperty(Holder.promise, 'resolve', { value: () => DeferredValue });
          task('c1-import', { input: s.object({}), async run() { return Promise.resolve(); } });
        `,
      },
    ]);
    expectClosed(facts, 'imported class carrier');
  });

  it('C1 rejects an imported helper that installs a class carrier', () => {
    const facts = sinksForFiles([
      {
        fileName: 'install.ts',
        source: `export function install(target: any) { target.promise = Promise; }`,
      },
      {
        fileName: 'app.ts',
        source: `
          import { s, task } from '@kovojs/server';
          import { install } from './install.js';
          ${deferredWithLateAuthority}
          class Holder {}
          install(Holder);
          Object.defineProperty((Holder as any).promise, 'resolve', {
            value: () => DeferredValue,
          });
          task('c1-import-helper', {
            input: s.object({}), async run() { return Promise.resolve(); },
          });
        `,
      },
    ]);
    expectClosed(facts, 'imported helper class carrier');
  });

  it.each([
    [
      'static block member',
      `class Holder { static { (this as any).value = DeferredValue; } }
       return (Holder as any).value;`,
    ],
    [
      'aliased Object.setPrototypeOf',
      `class Base { static value = DeferredValue; }
       class Child {}
       const inherit = Object.setPrototypeOf;
       inherit(Child, Base);
       return (Child as typeof Base).value;`,
    ],
    [
      'carrier Object.setPrototypeOf target',
      `class Base { static value = DeferredValue; }
       class Child {}
       const box = { Child };
       Object.setPrototypeOf(box.Child, Base);
       return (Child as typeof Base).value;`,
    ],
    [
      'helper Object.setPrototypeOf target',
      `class Base { static value = DeferredValue; }
       class Child {}
       function inherit(target: object, base: object) { Object.setPrototypeOf(target, base); }
       inherit(Child, Base);
       return (Child as typeof Base).value;`,
    ],
    [
      'Object.assign computed __proto__',
      `class Base { static value = DeferredValue; }
       class Child {}
       Object.assign(Child, { ['__proto__']: Base });
       return (Child as typeof Base).value;`,
    ],
    [
      'Reflect.set __proto__',
      `class Base { static value = DeferredValue; }
       class Child {}
       Reflect.set(Child, '__proto__', Base);
       return (Child as typeof Base).value;`,
    ],
    [
      'named class-expression post-assignment',
      `const Holder = class Inner {};
       (Holder as any).value = DeferredValue;
       return (Holder as any).value;`,
    ],
    [
      'computed __proto__ assignment',
      `class Base { static value = DeferredValue; }
       class Child {}
       const key = '__proto__';
       (Child as any)[key] = Base;
       return (Child as typeof Base).value;`,
    ],
    [
      'carrier Object.assign computed __proto__',
      `class Base { static value = DeferredValue; }
       class Child {}
       const box = { Child };
       Object.assign(box.Child, { ['__proto__']: Base });
       return (Child as typeof Base).value;`,
    ],
    [
      'static block prototype mutation',
      `class Base { static value = DeferredValue; }
       class Child { static { Object.setPrototypeOf(this, Base); } }
       return (Child as typeof Base).value;`,
    ],
    [
      'carrier descriptor target',
      `class Holder {}
       const box = { Holder };
       Object.defineProperty(box.Holder, 'value', { value: DeferredValue });
       return (Holder as any).value;`,
    ],
    [
      'helper descriptor target',
      `class Holder {}
       function install(target: object) {
         Object.defineProperty(target, 'value', { value: DeferredValue });
       }
       install(Holder);
       return (Holder as any).value;`,
    ],
    [
      'carrier deletion exposing inherited member',
      `class Base { static value = DeferredValue; }
       class Child extends Base { static value = { ok: true }; }
       const box = { Child };
       delete box.Child.value;
       return Child.value;`,
    ],
    [
      'helper deletion exposing inherited member',
      `class Base { static value = DeferredValue; }
       class Child extends Base { static value = { ok: true }; }
       function drop(target: any) { delete target.value; }
       drop(Child);
       return Child.value;`,
    ],
    [
      'carrier Reflect.deleteProperty exposing inherited member',
      `class Base { static value = DeferredValue; }
       class Child extends Base { static value = { ok: true }; }
       const box = { Child };
       Reflect.deleteProperty(box.Child, 'value');
       return Child.value;`,
    ],
    [
      'class-expression descriptor',
      `const Holder = class Inner {};
       Object.defineProperty(Holder, 'value', { value: DeferredValue });
       return (Holder as any).value;`,
    ],
  ])('C2 rejects a class-derived thenable through %s', (label, statement) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      task('c2-review', { input: s.object({}), run() {
        ${deferred}
        ${statement}
      } });
    `);
    expectClosed(facts, label);
  });

  it('C2 rejects a cross-file deletion exposing an unsafe base member', () => {
    const facts = sinksForFiles([
      {
        fileName: 'classes.ts',
        source: `
          export class DeferredValue {
            static then(resolve: (value: { ok: true }) => void) { resolve({ ok: true }); }
          }
          export class Base { static value = DeferredValue; }
          export class Child extends Base { static value = { ok: true }; }
        `,
      },
      {
        fileName: 'app.ts',
        source: `
          import { s, task } from '@kovojs/server';
          import { Child } from './classes.js';
          delete (Child as any).value;
          task('c2-import-delete', { input: s.object({}), run() { return Child.value; } });
        `,
      },
    ]);
    expectClosed(facts, 'cross-file delete');
  });

  it('C2 rejects an imported helper prototype mutation', () => {
    const facts = sinksForFiles([
      {
        fileName: 'inherit.ts',
        source: `export function inherit(target: object, base: object) {
          Object.setPrototypeOf(target, base);
        }`,
      },
      {
        fileName: 'app.ts',
        source: `
          import { s, task } from '@kovojs/server';
          import { inherit } from './inherit.js';
          task('c2-import-helper', { input: s.object({}), run() {
            ${deferred}
            class Base { static value = DeferredValue; }
            class Child {}
            inherit(Child, Base);
            return (Child as typeof Base).value;
          } });
        `,
      },
    ]);
    expectClosed(facts, 'imported helper prototype mutation');
  });

  it.each([
    ['Array.flat', `return [[DeferredValue]].flat()[0];`],
    ['Array.with', `return [0].with(0, DeferredValue)[0];`],
    ['Array.toSpliced', `return [0].toSpliced(0, 1, DeferredValue)[0];`],
    ['Array.from mapper', `return Array.from([0], () => DeferredValue)[0];`],
    ['Object.values', `return Object.values({ value: DeferredValue })[0];`],
    ['Object.entries', `return Object.entries({ value: DeferredValue })[0]![1];`],
    ['Set iterator', `return new Set([DeferredValue]).values().next().value;`],
    ['Map constructor read', `return new Map([['value', DeferredValue]]).get('value');`],
  ])('C2 rejects an adjacent %s container carrier', (label, statement) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      task('c2-container-review', { input: s.object({}), run() {
        ${deferred}
        ${statement}
      } });
    `);
    expectClosed(facts, label);
  });

  it.each([
    [
      'bound callback',
      `function reveal() { return DeferredValue; }
       return Promise.resolve(1).then(reveal.bind(undefined));`,
    ],
    [
      'class-static callback',
      `class Helpers { static reveal() { return DeferredValue; } }
       return Promise.resolve(1).then(Helpers.reveal);`,
    ],
    [
      'object-method callback',
      `const helpers = { reveal() { return DeferredValue; } };
       return Promise.resolve(1).then(helpers.reveal);`,
    ],
    [
      'array-carried callback',
      `const reveal = () => DeferredValue;
       return Promise.resolve(1).then([reveal][0]);`,
    ],
    ['async callback', `return Promise.resolve(1).then(async () => DeferredValue);`],
  ])('C2 rejects an adjacent native-Promise %s', (label, statement) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      task('c2-promise-review', { input: s.object({}), run() {
        ${deferred}
        ${statement}
      } });
    `);
    expectClosed(facts, label);
  });

  it.each([
    ['Object.values', `const alias = Object.values(input.items)[0]!;`],
    ['Array.from', `const alias = Array.from(input.items)[0]!;`],
    ['Reflect.get', `const alias = Reflect.get(input.items, 0);`],
    ['array iterator', `const alias = input.items.values().next().value!;`],
    [
      'Set iterator',
      `const values = new Set(input.items); const alias = values.values().next().value!;`,
    ],
    [
      'local Map read',
      `const values = new Map([['key', input.items[0]!]]); const alias = values.get('key')!;`,
    ],
    ['slice element', `const alias = input.items.slice()[0]!;`],
    ['concat element', `const alias = input.items.concat([])[0]!;`],
    ['Object.entries', `const alias = Object.entries(input.items)[0]![1];`],
    ['toReversed element', `const alias = input.items.toReversed()[0]!;`],
    ['nested destructuring', `const [[alias]] = [input.items];`],
  ])('C3 invalidates the root through a %s alias', (label, setup) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      task('c3-review', {
        input: s.object({ items: s.array(s.object({ value: s.string() })) }),
        run(input) {
          ${deferred}
          ${setup}
          alias.value = DeferredValue as unknown as string;
          return input.items[0]!.value;
        },
      });
    `);
    expectClosed(facts, label);
  });

  it.each([
    [
      'for-of callback',
      `for (const alias of input.items) {
         alias.value = DeferredValue as unknown as string;
         break;
       }`,
    ],
    [
      'forEach callback',
      `input.items.forEach((alias) => {
         alias.value = DeferredValue as unknown as string;
       });`,
    ],
    [
      'Array.from callback',
      `Array.from(input.items, (alias) => {
         alias.value = DeferredValue as unknown as string;
         return alias;
       });`,
    ],
    [
      'reduce callback',
      `input.items.reduce((_previous, alias) => {
         alias.value = DeferredValue as unknown as string;
         return alias;
       });`,
    ],
    [
      'for-of nested array binding',
      `for (const [alias] of [input.items]) {
         alias.value = DeferredValue as unknown as string;
         break;
       }`,
    ],
    [
      'for-of Set binding',
      `for (const alias of new Set(input.items)) {
         alias.value = DeferredValue as unknown as string;
         break;
       }`,
    ],
    [
      'for-of values binding',
      `for (const alias of input.items.values()) {
         alias.value = DeferredValue as unknown as string;
         break;
       }`,
    ],
  ])('C3 invalidates writes through %s', (label, mutation) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      task('c3-callback-review', {
        input: s.object({ items: s.array(s.object({ value: s.string() })) }),
        run(input) {
          ${deferred}
          ${mutation}
          return input.items[0]!.value;
        },
      });
    `);
    expectClosed(facts, label);
  });

  it('C3 invalidates a for-await binding derived from the root', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      task('c3-for-await-review', {
        input: s.object({ items: s.array(s.object({ value: s.string() })) }),
        async run(input) {
          ${deferred}
          for await (const alias of input.items) {
            alias.value = DeferredValue as unknown as string;
            break;
          }
          return input.items[0]!.value;
        },
      });
    `);
    expectClosed(facts, 'for-await binding');
  });

  it('C3 invalidates a root projection mutated in a native-Promise callback', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      task('c3-promise-callback-review', {
        input: s.object({ items: s.array(s.object({ value: s.string() })) }),
        async run(input) {
          ${deferred}
          await Promise.resolve(input.items[0]!).then((alias) => {
            alias.value = DeferredValue as unknown as string;
          });
          return input.items[0]!.value;
        },
      });
    `);
    expectClosed(facts, 'native-Promise root callback');
  });

  it('C3 invalidates an imported helper mutation of a root projection', () => {
    const facts = sinksForFiles([
      {
        fileName: 'helper.ts',
        source: `export function poison(target: { value: unknown }, value: unknown) {
          target.value = value;
        }`,
      },
      {
        fileName: 'app.ts',
        source: `
          import { s, task } from '@kovojs/server';
          import { poison } from './helper.js';
          ${deferred}
          task('c3-import-helper', {
            input: s.object({ items: s.array(s.object({ value: s.string() })) }),
            run(input) {
              poison(input.items[0]!, DeferredValue);
              return input.items[0]!.value;
            },
          });
        `,
      },
    ]);
    expectClosed(facts, 'imported helper mutation');
  });

  it('keeps an unrelated stable computed static member precise', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      const unrelated = 'metadata';
      class Holder {
        static [unrelated] = { ok: true };
        static promise = { resolve: () => ({ ok: true }) };
      }
      Object.defineProperty(Holder.promise, 'resolve', { value: () => ({ ok: true }) });
      task('precision-computed', {
        input: s.object({}),
        run() { void Promise.resolve({ ok: true }); return { ok: true }; },
      });
    `);
    expect(facts).toEqual([]);
  });

  it('keeps a safe class-expression shadow precise', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      class Base { static value = { ok: true }; }
      const Child = class Inner extends Base { static value = { ok: true }; };
      task('precision-class-expression', {
        input: s.object({}), run() { return Child.value; },
      });
    `);
    expect(facts).toEqual([]);
  });

  it('keeps one hundred twenty unrelated safe class carriers within the provenance budget', () => {
    const carriers = Array.from(
      { length: 120 },
      (_value, index) => `
        class Holder${index} { static promise = LocalPromise; }
        Object.defineProperty(Holder${index}.promise, 'resolve', {
          value: () => ({ ok: true }),
        });
      `,
    ).join('\n');
    const startedAt = performance.now();
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      const LocalPromise = { resolve: () => ({ ok: true }) };
      ${carriers}
      task('precision-carrier-budget', {
        input: s.object({}),
        run() { void Promise.resolve({ ok: true }); return { ok: true }; },
      });
    `);

    expect(facts).toEqual([]);
    expect(performance.now() - startedAt).toBeLessThan(8_000);
  });
});
