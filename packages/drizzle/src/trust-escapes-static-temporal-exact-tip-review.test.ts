import { describe, expect, it } from 'vitest';

import { collectUnregisteredSinksFromProject } from '@kovojs/drizzle/internal/static';

function sinksFor(source: string) {
  return collectUnregisteredSinksFromProject({ files: [{ fileName: 'app.ts', source }] });
}

const lateAuthorityThenHook = `
  then(resolve: (value: { ok: true }) => void) {
    resolve({ ok: true });
    queueMicrotask(() => { void fetch('https://example.test/late'); });
  }
`;

const lateAuthorityThenFunction = `
  (resolve: (value: { ok: true }) => void) => {
    resolve({ ok: true });
    queueMicrotask(() => { void fetch('https://example.test/late'); });
  }
`;

// SPEC §6.6 / §9.6, bugz-31 C2: framework/native-Promise assimilation must fail closed for every
// authored thenable shape, not only a class constructor with a static `then` member.
describe('temporal exact-tip adversarial review', () => {
  it.each([
    ['ordinary object', `return { ${lateAuthorityThenHook} };`, 'authored-thenable'],
    [
      'aliased ordinary object',
      `const value = { ${lateAuthorityThenHook} };
       const alias = value;
       return alias;`,
      'authored-thenable',
    ],
    [
      'ordinary object with an aliased then function',
      `const settle = ${lateAuthorityThenFunction};
       return { then: settle };`,
      'authored-thenable',
    ],
    [
      'ordinary object with a computed then method',
      `const hook = 'then' as const;
       return {
         [hook](resolve: (value: { ok: true }) => void) {
           resolve({ ok: true });
           queueMicrotask(() => { void fetch('https://example.test/late'); });
         },
       };`,
      'authored-thenable',
    ],
    [
      'ordinary object with a then getter',
      `const settle = ${lateAuthorityThenFunction};
       return { get then() { return settle; } };`,
      'authored-thenable',
    ],
    [
      'helper-returned ordinary object',
      `function makeDeferred() { return { ${lateAuthorityThenHook} }; }
       return makeDeferred();`,
      'authored-thenable',
    ],
    [
      'Object.create inherited thenable',
      `const prototype = { ${lateAuthorityThenHook} };
       return Object.create(prototype);`,
      'authored-thenable',
    ],
    [
      'array with an assigned then function',
      `const value: unknown[] & { then?: typeof settle } = [];
       const settle = ${lateAuthorityThenFunction};
       value.then = settle;
       return value;`,
      'authored-thenable',
    ],
    [
      'function with an assigned then function',
      `const settle = ${lateAuthorityThenFunction};
       function value() { return undefined; }
       value.then = settle;
       return value;`,
      'authored-thenable',
    ],
    [
      'class instance',
      `class DeferredValue { ${lateAuthorityThenHook} }
       return new DeferredValue();`,
      'authored-thenable',
    ],
    [
      'class instance with an inherited then method',
      `class DeferredBase { ${lateAuthorityThenHook} }
       class DeferredValue extends DeferredBase {}
       return new DeferredValue();`,
      'authored-thenable',
    ],
    [
      'class instance with a computed then method',
      `const hook = 'then' as const;
       class DeferredValue {
         [hook](resolve: (value: { ok: true }) => void) {
           resolve({ ok: true });
           queueMicrotask(() => { void fetch('https://example.test/late'); });
         }
       }
       return new DeferredValue();`,
      'authored-thenable',
    ],
    [
      'class instance with a constructor-assigned then function',
      `class DeferredValue {
         then: (resolve: (value: { ok: true }) => void) => void;
         constructor() { this.then = ${lateAuthorityThenFunction}; }
       }
       return new DeferredValue();`,
      'authored-thenable',
    ],
  ])(
    'rejects a returned %s thenable before late authority can escape settlement',
    (label, body, protocol) => {
      const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      task('object-thenable-rereview', {
        input: s.object({}),
        run() { ${body} },
      });
    `);

      expect(
        facts.some(
          (fact) =>
            fact.sink === 'request-handler.opaque-protocol' &&
            fact.source?.startsWith(`<${protocol}:`),
        ),
        `${label}: ${JSON.stringify(facts)}`,
      ).toBe(true);
    },
  );

  it.each([
    [
      'Promise.resolve',
      `const value = { ${lateAuthorityThenHook} };
       return Promise.resolve(value);`,
    ],
    [
      'await',
      `const value = { ${lateAuthorityThenHook} };
       const settled = await value;
       return settled;`,
    ],
    [
      'native Promise callback output',
      `return Promise.resolve({ ok: true }).then(() => ({ ${lateAuthorityThenHook} }));`,
    ],
  ])('rejects authored thenables assimilated through %s', (label, body) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      task('thenable-assimilation-rereview', {
        input: s.object({}),
        async run() { ${body} },
      });
    `);

    expect(
      facts.some(
        (fact) =>
          fact.sink === 'request-handler.opaque-protocol' &&
          fact.source?.startsWith('<authored-thenable:'),
      ),
      `${label}: ${JSON.stringify(facts)}`,
    ).toBe(true);
  });

  it.each([
    ['plain object', `return { ok: true, nested: { value: 'plain' } };`],
    ['object with non-callable then data', `return { ok: true, then: 'metadata' };`],
    ['plain Array', `return [{ ok: true }];`],
    ['exact native Promise', `return Promise.resolve({ ok: true });`],
  ])('keeps the %s precision control inside the plain-data subset', (label, body) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      task('thenable-precision-rereview', {
        input: s.object({}),
        run() { ${body} },
      });
    `);

    expect(facts, `${label}: ${JSON.stringify(facts)}`).toEqual([]);
  });

  it('keeps a primitive copied through Object.fromEntries independent from its source root', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      task('from-entries-fresh-slot', {
        input: s.object({ item: s.object({ value: s.string() }) }),
        run(input) {
          const copy = Object.fromEntries([['value', input.item.value]]);
          copy.value = 'local';
          return input.item.value;
        },
      });
    `);

    expect(facts).toEqual([]);
  });

  it.each([
    [
      'retained object reference',
      `const copy = Object.fromEntries([['item', input.item]]);
       copy.item.value = 'mutated';`,
    ],
    [
      'last duplicate entry retaining the object reference',
      `const copy = Object.fromEntries([
         ['item', { value: 'local' }],
         ['item', input.item],
       ]);
       copy.item.value = 'mutated';`,
    ],
    [
      'unknown possibly-colliding key',
      `const copy = Object.fromEntries([[input.key, input.item]]);
       copy.item = { value: 'local' };`,
    ],
  ])('keeps Object.fromEntries %s mutations linked to the source root', (label, mutation) => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      task('from-entries-live-reference', {
        input: s.object({ key: s.string(), item: s.object({ value: s.string() }) }),
        run(input) {
          ${mutation}
          return input.item.value;
        },
      });
    `);

    expect(
      facts.some((fact) => fact.sink.startsWith('request-handler.opaque')),
      `${label}: ${JSON.stringify(facts)}`,
    ).toBe(true);
  });

  it('uses the last Object.fromEntries duplicate when projecting a fresh record', () => {
    const facts = sinksFor(`
      import { s, task } from '@kovojs/server';
      task('from-entries-last-write-wins', {
        input: s.object({ item: s.object({ value: s.string() }) }),
        run(input) {
          const copy = Object.fromEntries([
            ['item', input.item],
            ['item', { value: 'local' }],
          ]);
          copy.item.value = 'mutated';
          return input.item.value;
        },
      });
    `);

    expect(facts).toEqual([]);
  });

  it('demonstrates that the authored microtask runs after framework settlement', async () => {
    const trace: string[] = [];
    const value = {
      then(resolve: (value: { ok: true }) => void): void {
        trace.push('then');
        resolve({ ok: true });
        queueMicrotask(() => trace.push('late-authority'));
      },
    };

    void Promise.resolve(value).then(() => trace.push('framework-settled'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(trace).toEqual(['then', 'framework-settled', 'late-authority']);
  });
});
