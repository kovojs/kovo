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

const lateDeferred = `
  class DeferredValue {
    static then(resolve: (value: { ok: true }) => void) {
      resolve({ ok: true });
      queueMicrotask(() => { void fetch('https://example.test/late'); });
    }
  }
`;

const localDeferred = `
  class DeferredValue {
    static then(resolve: (value: { ok: true }) => void) { resolve({ ok: true }); }
  }
`;

describe('temporal final independent rereview', () => {
  it.each([
    [
      'Map constructor carrier',
      `const values = new Map([['promise', Promise]]);
       Object.defineProperty(values.get('promise')!, 'resolve', { value: () => DeferredValue });`,
    ],
    [
      'Map set carrier',
      `const values = new Map<string, any>();
       values.set('promise', Promise);
       Object.defineProperty(values.get('promise')!, 'resolve', { value: () => DeferredValue });`,
    ],
    [
      'WeakMap carrier',
      `const key = {};
       const values = new WeakMap([[key, Promise]]);
       Object.defineProperty(values.get(key)!, 'resolve', { value: () => DeferredValue });`,
    ],
    [
      'array iterator alias',
      `const iterator = [Promise].values();
       const target = iterator.next().value!;
       Object.defineProperty(target, 'resolve', { value: () => DeferredValue });`,
    ],
    [
      'symbol iterator alias',
      `const iterator = [Promise][Symbol.iterator]();
       const target = iterator.next().value!;
       Object.defineProperty(target, 'resolve', { value: () => DeferredValue });`,
    ],
    [
      'Set iterator alias',
      `const values = new Set([Promise]);
       const iterator = values.values();
       const target = iterator.next().value!;
       Object.defineProperty(target, 'resolve', { value: () => DeferredValue });`,
    ],
    [
      'generator return carrier',
      `function* reveal() { yield Promise; }
       const target = reveal().next().value!;
       Object.defineProperty(target, 'resolve', { value: () => DeferredValue });`,
    ],
    [
      'for-of binding carrier',
      `for (const target of [Promise]) {
         Object.defineProperty(target, 'resolve', { value: () => DeferredValue });
         break;
       }`,
    ],
    [
      'for-of nested binding carrier',
      `for (const [target] of [[Promise]]) {
         Object.defineProperty(target, 'resolve', { value: () => DeferredValue });
         break;
       }`,
    ],
    [
      'Array.from carrier',
      `const target = Array.from([Promise])[0]!;
       Object.defineProperty(target, 'resolve', { value: () => DeferredValue });`,
    ],
    [
      'Object.values carrier',
      `const target = Object.values({ promise: Promise })[0]!;
       Object.defineProperty(target, 'resolve', { value: () => DeferredValue });`,
    ],
    [
      'Object.entries carrier',
      `const target = Object.entries({ promise: Promise })[0]![1];
       Object.defineProperty(target, 'resolve', { value: () => DeferredValue });`,
    ],
    [
      'nested array object carrier',
      `const box = { nested: [[{ target: Promise }]] };
       Object.defineProperty(box.nested[0]![0]!.target, 'resolve', {
         value: () => DeferredValue,
       });`,
    ],
    [
      'object-method helper carrier',
      `const helpers = { reveal() { return Promise; } };
       Object.defineProperty(helpers.reveal(), 'resolve', { value: () => DeferredValue });`,
    ],
    [
      'static-this helper carrier',
      `class Holder {
         static promise = Promise;
         static reveal() { return this.promise; }
       }
       Object.defineProperty(Holder.reveal(), 'resolve', { value: () => DeferredValue });`,
    ],
    [
      'callback parameter carrier',
      `[Promise].forEach((target) => {
         Object.defineProperty(target, 'resolve', { value: () => DeferredValue });
       });`,
    ],
    [
      'Object.defineProperties direct',
      `Object.defineProperties(Promise, {
         resolve: { value: () => DeferredValue },
       });`,
    ],
    [
      'Reflect.defineProperty direct',
      `Reflect.defineProperty(Promise, 'resolve', { value: () => DeferredValue });`,
    ],
    [
      'aliased mutation method',
      `const install = Object.defineProperty;
       install(Promise, 'resolve', { value: () => DeferredValue });`,
    ],
    [
      'object-method poison helper',
      `const helpers = {
         poison(target: any) { target.resolve = () => DeferredValue; },
       };
       helpers.poison(Promise);`,
    ],
    [
      'unknown Promise escape',
      `declare function opaque(value: unknown): void;
       opaque(Promise);`,
    ],
  ])('C1 closes %s', (label, poison) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      ${lateDeferred}
      ${poison}
      task('c1-rereview', { input: s.object({}), async run() { return Promise.resolve(); } });
    `);
    expectClosed(facts, label);
  });

  it.each([
    [
      'Map constructor mutation target',
      `const values = new Map([['holder', Holder]]);
       Object.defineProperty(values.get('holder')!, 'value', { value: DeferredValue });
       return Holder.value;`,
    ],
    [
      'Map set mutation target',
      `const values = new Map<string, any>();
       values.set('holder', Holder);
       Object.defineProperty(values.get('holder')!, 'value', { value: DeferredValue });
       return Holder.value;`,
    ],
    [
      'WeakMap mutation target',
      `const key = {};
       const values = new WeakMap([[key, Holder]]);
       Object.defineProperty(values.get(key)!, 'value', { value: DeferredValue });
       return Holder.value;`,
    ],
    [
      'array iterator mutation target',
      `const iterator = [Holder].values();
       const target = iterator.next().value!;
       Object.defineProperty(target, 'value', { value: DeferredValue });
       return Holder.value;`,
    ],
    [
      'Set iterator mutation target',
      `const values = new Set([Holder]);
       const iterator = values.values();
       const target = iterator.next().value!;
       Object.defineProperty(target, 'value', { value: DeferredValue });
       return Holder.value;`,
    ],
    [
      'generator mutation target',
      `function* reveal() { yield Holder; }
       const target = reveal().next().value!;
       Object.defineProperty(target, 'value', { value: DeferredValue });
       return Holder.value;`,
    ],
    [
      'for-of mutation target',
      `for (const target of [Holder]) {
         Object.defineProperty(target, 'value', { value: DeferredValue });
         break;
       }
       return Holder.value;`,
    ],
    [
      'forEach mutation target',
      `[Holder].forEach((target) => {
         Object.defineProperty(target, 'value', { value: DeferredValue });
       });
       return Holder.value;`,
    ],
    [
      'for-of nested binding mutation target',
      `for (const [target] of [[Holder]]) {
         (target as any).value = DeferredValue;
         break;
       }
       return Holder.value;`,
    ],
    [
      'for-of Set binding mutation target',
      `for (const target of new Set([Holder])) {
         (target as any).value = DeferredValue;
         break;
       }
       return Holder.value;`,
    ],
    [
      'for-of generator binding mutation target',
      `function* holders() { yield Holder; }
       for (const target of holders()) {
         (target as any).value = DeferredValue;
         break;
       }
       return Holder.value;`,
    ],
    [
      'for-await array binding mutation target',
      `for await (const target of [Holder]) {
         (target as any).value = DeferredValue;
         break;
       }
       return Holder.value;`,
    ],
    [
      'for-await async-generator binding mutation target',
      `async function* holders() { yield Holder; }
       for await (const target of holders()) {
         (target as any).value = DeferredValue;
         break;
       }
       return Holder.value;`,
    ],
    [
      'for-in projected mutation target',
      `const holders = [Holder];
       for (const index in holders) {
         (holders[index] as any).value = DeferredValue;
       }
       return Holder.value;`,
    ],
    [
      'Array.map callback mutation target',
      `[Holder].map((target) => {
         (target as any).value = DeferredValue;
         return target;
       });
       return Holder.value;`,
    ],
    [
      'Array.filter callback mutation target',
      `[Holder].filter((target) => {
         (target as any).value = DeferredValue;
         return true;
       });
       return Holder.value;`,
    ],
    [
      'Array.find callback mutation target',
      `[Holder].find((target) => {
         (target as any).value = DeferredValue;
         return true;
       });
       return Holder.value;`,
    ],
    [
      'Array.some callback mutation target',
      `[Holder].some((target) => {
         (target as any).value = DeferredValue;
         return true;
       });
       return Holder.value;`,
    ],
    [
      'Array.every callback mutation target',
      `[Holder].every((target) => {
         (target as any).value = DeferredValue;
         return true;
       });
       return Holder.value;`,
    ],
    [
      'Array.reduce callback mutation target',
      `[Holder].reduce((_seed, target) => {
         (target as any).value = DeferredValue;
         return target;
       }, Holder);
       return Holder.value;`,
    ],
    [
      'Promise callback mutation target',
      `await Promise.resolve(Holder).then((target) => {
         (target as any).value = DeferredValue;
       });
       return Holder.value;`,
    ],
    [
      'helper-owned loop mutation target',
      `function install(targets: any[]) {
         for (const target of targets) target.value = DeferredValue;
       }
       install([Holder]);
       return Holder.value;`,
    ],
    [
      'helper-owned callback mutation target',
      `function install(targets: any[]) {
         targets.forEach((target) => { target.value = DeferredValue; });
       }
       install([Holder]);
       return Holder.value;`,
    ],
    [
      'uninitialized mutable alias assignment',
      `let target: any;
       target = Holder;
       target.value = DeferredValue;
       return Holder.value;`,
    ],
    [
      'array destructuring assignment alias',
      `let target: any;
       [target] = [Holder];
       target.value = DeferredValue;
       return Holder.value;`,
    ],
    [
      'object destructuring assignment alias',
      `let target: any;
       ({ target } = { target: Holder });
       target.value = DeferredValue;
       return Holder.value;`,
    ],
    [
      'array push carrier mutation target',
      `const targets: any[] = [];
       targets.push(Holder);
       targets[0]!.value = DeferredValue;
       return Holder.value;`,
    ],
    [
      'class static block for-of mutation target',
      `class Trigger {
         static {
           for (const target of [Holder]) (target as any).value = DeferredValue;
         }
       }
       void Trigger;
       return Holder.value;`,
    ],
    [
      'Array.flatMap callback mutation target',
      `[Holder].flatMap((target) => {
         (target as any).value = DeferredValue;
         return [target];
       });
       return Holder.value;`,
    ],
    [
      'Array.findLast callback mutation target',
      `[Holder].findLast((target) => {
         (target as any).value = DeferredValue;
         return true;
       });
       return Holder.value;`,
    ],
    [
      'Array.sort comparator mutation target',
      `[Holder, class Other {}].sort((target) => {
         (target as any).value = DeferredValue;
         return 0;
       });
       return Holder.value;`,
    ],
    [
      'Array.toSorted comparator mutation target',
      `[Holder, class Other {}].toSorted((target) => {
         (target as any).value = DeferredValue;
         return 0;
       });
       return Holder.value;`,
    ],
    [
      'Array.from mapper mutation target',
      `Array.from([Holder], (target) => {
         (target as any).value = DeferredValue;
         return target;
       });
       return Holder.value;`,
    ],
    [
      'Set.forEach callback mutation target',
      `new Set([Holder]).forEach((target) => {
         (target as any).value = DeferredValue;
       });
       return Holder.value;`,
    ],
    [
      'Map.forEach callback mutation target',
      `new Map([['holder', Holder]]).forEach((target) => {
         (target as any).value = DeferredValue;
       });
       return Holder.value;`,
    ],
    [
      'forEach nested destructuring callback target',
      `[[Holder]].forEach(([target]) => {
         (target as any).value = DeferredValue;
       });
       return Holder.value;`,
    ],
    [
      'forEach rest callback target',
      `[Holder].forEach((...args) => {
         (args[0] as any).value = DeferredValue;
       });
       return Holder.value;`,
    ],
    [
      'forEach receiver callback target',
      `[Holder].forEach((_target, _index, targets) => {
         (targets[0] as any).value = DeferredValue;
       });
       return Holder.value;`,
    ],
    [
      'callback prototype transition',
      `class Base { static value = DeferredValue; }
       [Holder].forEach((target) => Object.setPrototypeOf(target, Base));
       return (Holder as typeof Base).value;`,
    ],
    [
      'callback delete-shadow transition',
      `class Base { static value = DeferredValue; }
       class Child extends Base { static value = { ok: true }; }
       [Child].forEach((target) => { delete (target as any).value; });
       return Child.value;`,
    ],
    [
      'while indexed mutation target',
      `const targets = [Holder];
       let index = 0;
       while (index < targets.length) {
         (targets[index++] as any).value = DeferredValue;
       }
       return Holder.value;`,
    ],
    [
      'constructor-owned for-of mutation target',
      `class Trigger {
         constructor() {
           for (const target of [Holder]) (target as any).value = DeferredValue;
         }
       }
       new Trigger();
       return Holder.value;`,
    ],
    [
      'unknown Holder escape',
      `declare function opaque(value: unknown): void;
       opaque(Holder);
       return Holder.value;`,
    ],
    [
      'object-method helper mutation target',
      `const helpers = { install(target: any) { target.value = DeferredValue; } };
       helpers.install(Holder);
       return Holder.value;`,
    ],
    [
      'class-static helper mutation target',
      `class Helpers { static install(target: any) { target.value = DeferredValue; } }
       Helpers.install(Holder);
       return Holder.value;`,
    ],
    [
      'bound helper mutation target',
      `function install(target: any) { target.value = DeferredValue; }
       const bound = install.bind(undefined, Holder);
       bound();
       return Holder.value;`,
    ],
    [
      'nested helper-return mutation target',
      `function wrap(target: any) { return { nested: [[target]] }; }
       Object.defineProperty(wrap(Holder).nested[0]![0], 'value', { value: DeferredValue });
       return Holder.value;`,
    ],
    [
      'static method this mutation',
      `class Target {
         static install() { (this as any).value = DeferredValue; }
       }
       Target.install();
       return (Target as any).value;`,
    ],
    [
      'class-expression static method this mutation',
      `const Target = class Inner {
         static install() { (this as any).value = DeferredValue; }
       };
       Target.install();
       return (Target as any).value;`,
    ],
    [
      'Object.defineProperties',
      `Object.defineProperties(Holder, { value: { value: DeferredValue } });
       return Holder.value;`,
    ],
    [
      'Reflect.defineProperty',
      `Reflect.defineProperty(Holder, 'value', { value: DeferredValue });
       return Holder.value;`,
    ],
    [
      'descriptor getter',
      `Object.defineProperty(Holder, 'value', { get() { return DeferredValue; } });
       return Holder.value;`,
    ],
    [
      'Object.assign spread',
      `const source = { value: DeferredValue };
       Object.assign(Holder, { ...source });
       return Holder.value;`,
    ],
    [
      'Object.assign fromEntries',
      `Object.assign(Holder, Object.fromEntries([['value', DeferredValue]]));
       return Holder.value;`,
    ],
    [
      'computed dynamic member assignment',
      `const member: string = 'value';
       (Holder as any)[member] = DeferredValue;
       return Holder.value;`,
    ],
    [
      'generator output assimilation',
      `function* reveal() { yield DeferredValue; }
       return reveal().next().value;`,
    ],
    [
      'iterator-alias output assimilation',
      `const iterator = [DeferredValue].values();
       return iterator.next().value;`,
    ],
    [
      'WeakMap output assimilation',
      `const key = {};
       const values = new WeakMap([[key, DeferredValue]]);
       return values.get(key);`,
    ],
    [
      'Promise.catch callback output',
      `return Promise.reject(new Error('x')).catch(() => DeferredValue);`,
    ],
    [
      'Promise.finally callback output',
      `return Promise.resolve(DeferredValue).finally(() => DeferredValue);`,
    ],
    [
      'async helper output',
      `async function reveal() { return DeferredValue; }
       return reveal();`,
    ],
    ['Promise.all assimilation', `return Promise.all([DeferredValue]);`],
    ['Promise.race assimilation', `return Promise.race([DeferredValue]);`],
  ])('C2 closes %s', (label, statement) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      task('c2-rereview', { input: s.object({}), run() {
        ${localDeferred}
        class Holder {}
        ${statement}
      } });
    `);
    expectClosed(facts, label);
  });

  it.each([
    [
      'array iterator alias',
      `const iterator = input.items.values();
       const alias = iterator.next().value!;
       alias.value = DeferredValue as unknown as string;`,
    ],
    [
      'symbol iterator alias',
      `const iterator = input.items[Symbol.iterator]();
       const alias = iterator.next().value!;
       alias.value = DeferredValue as unknown as string;`,
    ],
    [
      'Map constructor carrier',
      `const values = new Map([['key', input.items[0]!]]);
       const alias = values.get('key')!;
       alias.value = DeferredValue as unknown as string;`,
    ],
    [
      'WeakMap carrier',
      `const key = {};
       const values = new WeakMap([[key, input.items[0]!]]);
       const alias = values.get(key)!;
       alias.value = DeferredValue as unknown as string;`,
    ],
    [
      'object-method helper mutation',
      `const helpers = {
         poison(alias: { value: string }) {
           alias.value = DeferredValue as unknown as string;
         },
       };
       helpers.poison(input.items[0]!);`,
    ],
    [
      'class-static helper mutation',
      `class Helpers {
         static poison(alias: { value: string }) {
           alias.value = DeferredValue as unknown as string;
         }
       }
       Helpers.poison(input.items[0]!);`,
    ],
    [
      'bound helper mutation',
      `function poison(alias: { value: string }) {
         alias.value = DeferredValue as unknown as string;
       }
       const bound = poison.bind(undefined, input.items[0]!);
       bound();`,
    ],
    [
      'two-hop identity helper mutation',
      `function identity<T>(value: T): T { return value; }
       function identity2<T>(value: T): T { return identity(value); }
       const alias = identity2(input.items[0]!);
       alias.value = DeferredValue as unknown as string;`,
    ],
    [
      'generator loop mutation',
      `function* aliases(value: { value: string }) { yield value; }
       for (const alias of aliases(input.items[0]!)) {
         alias.value = DeferredValue as unknown as string;
         break;
       }`,
    ],
    [
      'async-generator loop mutation',
      `async function* aliases(value: { value: string }) { yield value; }
       for await (const alias of aliases(input.items[0]!)) {
         alias.value = DeferredValue as unknown as string;
         break;
       }`,
    ],
    [
      'custom iterable mutation',
      `const iterable = {
         *[Symbol.iterator]() { yield input.items[0]!; },
       };
       for (const alias of iterable) {
         alias.value = DeferredValue as unknown as string;
         break;
       }`,
    ],
    [
      'Promise named callback mutation',
      `function poison(alias: { value: string }) {
         alias.value = DeferredValue as unknown as string;
       }
       await Promise.resolve(input.items[0]!).then(poison);`,
    ],
    [
      'Promise object-method callback mutation',
      `const helpers = {
         poison(alias: { value: string }) {
           alias.value = DeferredValue as unknown as string;
         },
       };
       await Promise.resolve(input.items[0]!).then(helpers.poison);`,
    ],
    [
      'Array.some callback mutation',
      `input.items.some((alias) => {
         alias.value = DeferredValue as unknown as string;
         return true;
       });`,
    ],
    [
      'Array.filter callback mutation',
      `input.items.filter((alias) => {
         alias.value = DeferredValue as unknown as string;
         return true;
       });`,
    ],
    [
      'array rest destructuring mutation',
      `const [, ...rest] = input.items;
       rest[0]!.value = DeferredValue as unknown as string;`,
    ],
    [
      'nested object carrier mutation',
      `const box = { one: [{ two: input.items[0]! }] };
       box.one[0]!.two.value = DeferredValue as unknown as string;`,
    ],
    [
      'Object.defineProperties through alias',
      `const box = { alias: input.items[0]! };
       Object.defineProperties(box.alias, {
         value: { value: DeferredValue as unknown as string },
       });`,
    ],
    [
      'prototype delete-shadow transition',
      `const alias = input.items[0]!;
       Object.setPrototypeOf(alias, { value: DeferredValue });
       delete alias.value;`,
    ],
    [
      'dynamic computed write',
      `const alias = input.items[0]!;
       const member: string = 'value';
       (alias as any)[member] = DeferredValue;`,
    ],
    [
      'class static field carrier',
      `class Carrier { static alias = input.items[0]!; }
       Carrier.alias.value = DeferredValue as unknown as string;`,
    ],
    [
      'class static block carrier',
      `class Carrier {
         static alias: { value: string };
         static { this.alias = input.items[0]!; }
       }
       Carrier.alias.value = DeferredValue as unknown as string;`,
    ],
    [
      'class instance field carrier',
      `class Carrier {
         constructor(readonly alias: { value: string }) {}
       }
       const carrier = new Carrier(input.items[0]!);
       carrier.alias.value = DeferredValue as unknown as string;`,
    ],
    [
      'object getter carrier',
      `const carrier = { get alias() { return input.items[0]!; } };
       carrier.alias.value = DeferredValue as unknown as string;`,
    ],
    [
      'forEach receiver callback mutation',
      `input.items.forEach((_alias, _index, values) => {
         values[0]!.value = DeferredValue as unknown as string;
       });`,
    ],
    [
      'Set.forEach callback mutation',
      `new Set(input.items).forEach((alias) => {
         alias.value = DeferredValue as unknown as string;
       });`,
    ],
    [
      'Map.forEach callback mutation',
      `new Map([['item', input.items[0]!]]).forEach((alias) => {
         alias.value = DeferredValue as unknown as string;
       });`,
    ],
    [
      'for-in projected mutation',
      `for (const index in input.items) {
         input.items[index]!.value = DeferredValue as unknown as string;
         break;
       }`,
    ],
    [
      'array destructuring assignment carrier',
      `let alias: { value: string };
       [alias] = input.items;
       alias!.value = DeferredValue as unknown as string;`,
    ],
    [
      'object destructuring assignment carrier',
      `let alias: { value: string };
       ({ alias } = { alias: input.items[0]! });
       alias!.value = DeferredValue as unknown as string;`,
    ],
    [
      'yield-star generator carrier',
      `function* aliases(value: { value: string }) { yield* [value]; }
       for (const alias of aliases(input.items[0]!)) {
         alias.value = DeferredValue as unknown as string;
         break;
       }`,
    ],
    [
      'WeakRef carrier',
      `const reference = new WeakRef(input.items[0]!);
       reference.deref()!.value = DeferredValue as unknown as string;`,
    ],
    [
      'Proxy carrier',
      `const proxy = new Proxy(input.items[0]!, {});
       proxy.value = DeferredValue as unknown as string;`,
    ],
  ])('C3 closes %s', (label, mutation) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      task('c3-rereview', {
        input: s.object({ items: s.array(s.object({ value: s.string() })) }),
        async run(input) {
          ${localDeferred}
          ${mutation}
          return input.items[0]!.value;
        },
      });
    `);
    expectClosed(facts, label);
  });

  it('C1 closes an imported two-hop helper carrier', () => {
    const facts = sinksForFiles([
      {
        fileName: 'helper.ts',
        source: `export function identity<T>(value: T): T { return value; }
          export function identity2<T>(value: T): T { return identity(value); }`,
      },
      {
        fileName: 'app.ts',
        source: `
          import { s, task } from '@kovojs/server';
          import { identity2 } from './helper.js';
          ${lateDeferred}
          Object.defineProperty(identity2(Promise), 'resolve', {
            value: () => DeferredValue,
          });
          task('c1-import-rereview', {
            input: s.object({}), async run() { return Promise.resolve(); },
          });
        `,
      },
    ]);
    expectClosed(facts, 'imported two-hop helper carrier');
  });

  it('C3 closes an imported object-method helper mutation', () => {
    const facts = sinksForFiles([
      {
        fileName: 'helper.ts',
        source: `export const helpers = {
          poison(alias: { value: string }, DeferredValue: unknown) {
            alias.value = DeferredValue as string;
          },
        };`,
      },
      {
        fileName: 'app.ts',
        source: `
          import { s, task } from '@kovojs/server';
          import { helpers } from './helper.js';
          ${localDeferred}
          task('c3-import-rereview', {
            input: s.object({ items: s.array(s.object({ value: s.string() })) }),
            run(input) {
              helpers.poison(input.items[0]!, DeferredValue);
              return input.items[0]!.value;
            },
          });
        `,
      },
    ]);
    expectClosed(facts, 'imported object-method helper');
  });

  it('C2 closes an imported callback mutation target', () => {
    const facts = sinksForFiles([
      {
        fileName: 'helper.ts',
        source: `
          export class DeferredValue {
            static then(resolve: (value: { ok: true }) => void) { resolve({ ok: true }); }
          }
          export function install(target: any) { target.value = DeferredValue; }
        `,
      },
      {
        fileName: 'app.ts',
        source: `
          import { s, task } from '@kovojs/server';
          import { install } from './helper.js';
          task('c2-import-callback-rereview', { input: s.object({}), run() {
            class Holder {}
            [Holder].forEach(install);
            return (Holder as any).value;
          } });
        `,
      },
    ]);
    expectClosed(facts, 'imported callback mutation target');
  });

  it.each([
    [
      'for-of installs plain data',
      `class Holder {}
       for (const target of [Holder]) (target as any).value = { ok: true };
       return (Holder as any).value;`,
    ],
    [
      'forEach installs plain data',
      `class Holder {}
       [Holder].forEach((target) => { (target as any).value = { ok: true }; });
       return (Holder as any).value;`,
    ],
    [
      'callback mutates an unrelated class',
      `class Holder { static value = { ok: true }; }
       class Other {}
       [Other].forEach((target) => { (target as any).value = { ok: true }; });
       return Holder.value;`,
    ],
    [
      'native Promise callback returns plain data',
      `return Promise.resolve({ ok: true }).then((value) => value);`,
    ],
  ])('keeps safe temporal control precise: %s', (label, statement) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      task('temporal-precision-rereview', { input: s.object({}), run() {
        ${statement}
      } });
    `);
    expect(facts, `${label}: ${JSON.stringify(facts)}`).toEqual([]);
  });

  it('keeps a detached primitive input copy precise', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      task('c3-clone-precision-rereview', {
        input: s.object({ item: s.object({ value: s.string() }) }),
        run(input) {
          const clone = { value: input.item.value };
          clone.value = 'local';
          return input.item.value;
        },
      });
    `);
    expect(facts).toEqual([]);
  });

  it('keeps sixty safe callback-mutated class slots within the provenance budget', () => {
    const cases = Array.from(
      { length: 60 },
      (_value, index) => `
        class Holder${index} {}
        [Holder${index}].forEach((target) => {
          (target as any).value = { ok: true };
        });
        task('callback-precision-${index}', {
          input: s.object({}), run() { return (Holder${index} as any).value; },
        });
      `,
    ).join('\n');
    const startedAt = performance.now();
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      ${cases}
    `);
    const elapsed = performance.now() - startedAt;

    expect(facts).toEqual([]);
    expect(elapsed).toBeLessThan(8_000);
  });
});
