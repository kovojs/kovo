import { describe, expect, it } from 'vitest';

import { collectUnregisteredSinksFromProject } from '@kovojs/drizzle/internal/static';

function sinksFor(source: string) {
  return collectUnregisteredSinksFromProject({ files: [{ fileName: 'app.tsx', source }] });
}

function expectOpaqueSemanticBoundary(facts: ReturnType<typeof sinksFor>): void {
  expect(
    facts.some((fact) => fact.sink.startsWith('request-handler.opaque')),
    JSON.stringify(facts),
  ).toBe(true);
}

function expectRejectedSemanticBoundary(facts: ReturnType<typeof sinksFor>): void {
  expect(facts, JSON.stringify(facts)).not.toEqual([]);
}

function expectProcessMarker(facts: ReturnType<typeof sinksFor>, marker: string): void {
  expect(facts, JSON.stringify(facts)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sink: 'child_process.execFileSync',
        source: `'${marker}'`,
      }),
    ]),
  );
}

function routeSource(imports: string, statement: string, declarations = ''): string {
  return `
    /** @jsxImportSource @kovojs/server */
    ${imports}
    import { route } from '@kovojs/server';
    ${declarations}
    route('/', {
      page() {
        ${statement}
        return 'safe';
      },
    });
  `;
}

// SPEC §2 and §6.6 require request-reachable authority to stay within the authoritative
// snapshot even when an exact intrinsic performs the call or property access implicitly.
describe('KV424 semantic intrinsic adversarial corpus', () => {
  it.each([
    ['Object.groupBy', "Object.groupBy(['safe'], callback);"],
    ['Promise.try', 'Promise.try(callback);'],
    ['JSON.parse reviver', 'JSON.parse(\'\\"safe\\"\', callback);'],
    ['JSON.stringify replacer', "JSON.stringify({ value: 'safe' }, callback);"],
    ['Array.fromAsync mapper', "Array.fromAsync(['safe'], callback);"],
  ])('rejects an opaque callback executed by %s', (_label, statement) => {
    const facts = sinksFor(
      routeSource("import { callback } from 'semantic-opaque-callback';", statement),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it.each([
    ['Object.assign source', 'Object.assign({}, attack);'],
    ['Object.values source', 'Object.values(attack);'],
    ['Object.entries source', 'Object.entries(attack);'],
    ['JSON.stringify nested value', 'JSON.stringify({ nested: attack });'],
    ['Response.json nested value', 'Response.json({ nested: attack });'],
    ['Response.json init dictionary', 'Response.json({ ok: true }, attack);'],
  ])('rejects opaque ordinary getters consumed by %s', (_label, statement) => {
    const facts = sinksFor(
      routeSource("import { attack } from 'semantic-opaque-value';", statement),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it.each([
    ['Headers nested record value', "new Headers({ 'x-test': attack });"],
    ['URLSearchParams nested record value', 'new URLSearchParams({ x: attack });'],
    ['Response nested statusText', "new Response('safe', { statusText: attack });"],
    [
      'Response.json nested init statusText',
      'Response.json({ ok: true }, { statusText: attack });',
    ],
  ])('rejects opaque conversion hooks nested in %s', (_label, statement) => {
    const facts = sinksFor(
      routeSource("import { attack } from 'semantic-opaque-value';", statement),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it.each([
    [
      'Response HeadersInit tuple value',
      "new Response('safe', { headers: [['x-test', attack]] });",
    ],
    [
      'Request HeadersInit tuple value',
      "new Request('https://example.test/', { headers: [['x-test', attack]] });",
    ],
    [
      'Response.json HeadersInit tuple value',
      "Response.json({ ok: true }, { headers: [['x-test', attack]] });",
    ],
  ])('rejects opaque conversion hooks nested in %s', (_label, statement) => {
    const facts = sinksFor(
      routeSource("import { attack } from 'semantic-opaque-value';", statement),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it.each([
    [
      'node:assert callback API',
      "import assert from 'node:assert/strict'; import { callback } from 'semantic-opaque-callback';",
      'assert.throws(callback);',
    ],
    [
      'node:querystring enumerable getters',
      "import querystring from 'node:querystring'; import { attack } from 'semantic-opaque-value';",
      'querystring.stringify(attack);',
    ],
    [
      'node:querystring decoder callback',
      "import querystring from 'node:querystring'; import { callback } from 'semantic-opaque-callback';",
      "querystring.parse('x=y', '&', '=', { decodeURIComponent: callback });",
    ],
    [
      'node:buffer valueOf or Symbol.toPrimitive',
      "import { Buffer as NodeBuffer } from 'node:buffer'; import { attack } from 'semantic-opaque-value';",
      'NodeBuffer.from(attack);',
    ],
    [
      'node:url format getters',
      "import * as nodeUrl from 'node:url'; import { attack } from 'semantic-opaque-value';",
      'nodeUrl.format(attack);',
    ],
  ])(
    'rejects semantic authority hidden by whole-module trust in %s',
    (_label, imports, statement) => {
      const facts = sinksFor(routeSource(imports, statement));

      expectRejectedSemanticBoundary(facts);
    },
  );

  it('rejects an opaque Buffer.from array element conversion hook', () => {
    const facts = sinksFor(
      routeSource(
        "import { Buffer as NodeBuffer } from 'node:buffer'; import { attack } from 'semantic-opaque-value';",
        'NodeBuffer.from([attack]);',
      ),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  // Node 24.18 confirms each operation converts or assimilates the callback result. JSON.stringify
  // reaches nested getters on a returned object (but does not call a newly returned toJSON).
  it.each([
    ['Array.sort comparator ToNumber', "['b', 'a'].sort(() => attack);"],
    ['Array.toSorted comparator ToNumber', "['b', 'a'].toSorted(() => attack);"],
    ['String.replace replacer ToString', "'x'.replace('x', () => attack);"],
    ['String.replaceAll replacer ToString', "'x'.replaceAll('x', () => attack);"],
    [
      'JSON.stringify replacer nested getters',
      "JSON.stringify({ value: 'safe' }, (key, value) => key === 'value' ? attack : value);",
    ],
    ['Promise.try returned thenable', 'Promise.try(() => attack);'],
    ['Array.fromAsync mapper returned thenable', "Array.fromAsync(['safe'], () => attack);"],
  ])('rejects opaque hooks on %s', (_label, statement) => {
    const facts = sinksFor(
      routeSource("import { attack } from 'semantic-opaque-value';", statement),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  // JSON.stringify performs ToString on boxed replacer-array entries and converts boxed space
  // values before serialization. The imported carriers are runtime String/Number wrappers.
  it.each([
    [
      'replacer-array String-box toString',
      "JSON.stringify({ value: 'safe' }, [stringBox]);",
      'stringBox',
    ],
    [
      'replacer-array Number-box valueOf',
      "JSON.stringify({ 1: 'safe' }, [numberBox]);",
      'numberBox',
    ],
    [
      'space String-box toString',
      "JSON.stringify({ value: 'safe' }, null, stringBox);",
      'stringBox',
    ],
    [
      'space Number-box valueOf',
      "JSON.stringify({ value: 'safe' }, null, numberBox);",
      'numberBox',
    ],
  ])('rejects opaque JSON.stringify %s', (_label, statement, exportName) => {
    const facts = sinksFor(
      routeSource(`import { ${exportName} } from 'semantic-opaque-value';`, statement),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it('traverses Proxy entry getters yielded into Object.fromEntries', () => {
    const marker = 'from-entries-entry-get';
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      const entry = new Proxy(['key', 'value'], {
        get(target, key, receiver) {
          execFileSync('${marker}');
          return Reflect.get(target, key, receiver);
        },
      });
      const entries = {
        *[Symbol.iterator]() { yield entry; }
      };
      route('/', {
        page() {
          Object.fromEntries(entries);
          return 'safe';
        },
      });
    `);

    expectProcessMarker(facts, marker);
  });

  it('traverses thenables yielded into Array.fromAsync', () => {
    const marker = 'from-async-yielded-thenable';
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      const thenable = {
        then(resolve) {
          execFileSync('${marker}');
          resolve('safe');
        },
      };
      const values = {
        async *[Symbol.asyncIterator]() { yield thenable; },
      };
      route('/', {
        page() {
          Array.fromAsync(values);
          return 'safe';
        },
      });
    `);

    expectProcessMarker(facts, marker);
  });

  it.each([
    [
      'for-await over a sync array',
      'void consume();',
      'async function consume() { for await (const value of [attack]) void value; }',
    ],
    [
      'plain async-generator yield',
      'void produce().next();',
      'async function* produce() { yield attack; }',
    ],
    [
      'ignored async-function return',
      'void produce();',
      'async function produce() { return attack; }',
    ],
  ])('rejects opaque thenable assimilation by %s', (_label, statement, declarations) => {
    const facts = sinksFor(
      routeSource("import { attack } from 'semantic-opaque-value';", statement, declarations),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it('fails closed on a custom async iterator delegated through async yield*', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      const values = {
        [Symbol.asyncIterator]() {
          return {
            next() {
              execFileSync('async-yield-star-next');
              return Promise.resolve({ done: true, value: undefined });
            },
          };
        },
      };
      async function* delegate() { yield* values; }
      route('/', { page() { void delegate().next(); return 'safe'; } });
    `);

    expectOpaqueSemanticBoundary(facts);
  });

  it.each([
    ['Math.max ToPrimitive', 'Math.max(attack);'],
    ['Date.parse toString', 'Date.parse(attack);'],
    ['BigInt.asIntN coercion', 'BigInt.asIntN(attack, 1n);'],
    ['String.raw template.raw', 'String.raw(attack);'],
    ['Symbol.for toString', 'Symbol.for(attack);'],
    ['URL.canParse toString', 'URL.canParse(attack);'],
    ['URL.parse toString', 'URL.parse(attack);'],
    ['crypto.randomUUID options', 'crypto.randomUUID(attack);'],
  ])('rejects opaque argument protocols executed by %s', (_label, statement) => {
    const facts = sinksFor(
      routeSource("import { attack } from 'semantic-opaque-value';", statement),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it.each([
    ['fetch input ToString', 'fetch(attack);'],
    ['fetch init dictionary getters', "fetch('data:,safe', attack);"],
    ['fetch HeadersInit record getters', "fetch('data:,safe', { headers: attack });"],
    [
      'fetch HeadersInit tuple value ToString',
      "fetch('data:,safe', { headers: [['x-test', attack]] });",
    ],
    ['setTimeout delay ToNumber', 'setTimeout(() => {}, attack);'],
    ['setInterval delay ToNumber', 'clearInterval(setInterval(() => {}, attack));'],
  ])('rejects opaque protocol hooks executed by %s', (_label, statement) => {
    const facts = sinksFor(
      routeSource("import { attack } from 'semantic-opaque-value';", statement),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it.each([
    [
      'rebound global.JSON.stringify',
      `const original = global;
       try {
         global = { JSON: { stringify() { callback(); } } };
         global.JSON.stringify({ safe: true });
       } finally { global = original; }`,
    ],
    [
      'rebound globalThis.Math.abs',
      `const original = globalThis;
       try {
         globalThis = { Math: { abs() { callback(); } } };
         globalThis.Math.abs(-1);
       } finally { globalThis = original; }`,
    ],
    [
      'Reflect.get from a fake global JSON',
      `const fake = { JSON: { stringify() { callback(); } } };
       Reflect.get(fake, 'JSON').stringify({ safe: true });`,
    ],
    [
      'Reflect.get from rebound globalThis JSON',
      `const original = globalThis;
       try {
         globalThis = { JSON: { stringify() { callback(); } } };
         Reflect.get(globalThis, 'JSON').stringify({ safe: true });
       } finally { globalThis = original; }`,
    ],
    [
      'rebound global.fetch',
      `const original = global;
       try {
         global = { fetch() { callback(); } };
         global.fetch('data:,safe');
       } finally { global = original; }`,
    ],
    [
      'rebound globalThis.fetch',
      `const original = globalThis;
       try {
         globalThis = { fetch() { callback(); } };
         globalThis.fetch('data:,safe');
       } finally { globalThis = original; }`,
    ],
    [
      'rebound globalThis.queueMicrotask',
      `const original = globalThis;
       try {
         globalThis = { queueMicrotask() { callback(); } };
         globalThis.queueMicrotask(() => {});
       } finally { globalThis = original; }`,
    ],
    [
      'assigned direct fetch binding followed by direct fetch',
      `const original = fetch;
       try {
         fetch = callback;
         void fetch('data:,safe');
       } finally { fetch = original; }`,
    ],
    [
      'assigned globalThis.fetch followed by direct fetch',
      `const original = globalThis.fetch;
       try {
         globalThis.fetch = callback;
         void fetch('data:,safe');
       } finally { globalThis.fetch = original; }`,
    ],
    [
      'Object.defineProperty globalThis.fetch followed by direct fetch',
      `const original = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
       try {
         Object.defineProperty(globalThis, 'fetch', {
           configurable: true,
           writable: true,
           value: callback,
         });
         void fetch('data:,safe');
       } finally {
         if (original) Object.defineProperty(globalThis, 'fetch', original);
       }`,
    ],
  ])('rejects an opaque callback hidden behind %s', (_label, statement) => {
    const facts = sinksFor(
      routeSource("import { callback } from 'semantic-opaque-callback';", statement),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it('fails closed when globalThis.setTimeout is rebound', () => {
    const facts = sinksFor(
      routeSource(
        "import { callback } from 'semantic-opaque-callback';",
        `const original = globalThis;
         try {
           globalThis = { setTimeout() { callback(); } };
           globalThis.setTimeout(() => {}, 0);
         } finally { globalThis = original; }`,
      ),
    );

    expect(facts).toEqual(
      expect.arrayContaining([expect.objectContaining({ sink: 'setTimeout' })]),
    );
  });

  it('rejects an opaque package helper that poisons fetch before a direct call', () => {
    const facts = sinksFor(
      routeSource(
        "import { poisonFetch } from 'semantic-opaque-value';",
        `const restore = poisonFetch();
         try { void fetch('data:,safe'); }
         finally { restore(); }`,
      ),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it.each([
    ['Blob part toString', 'new Blob([attack]);'],
    ['File part toString', "new File([attack], 'safe.txt');"],
    ['typed-array element ToPrimitive', 'new Uint8Array([attack]);'],
  ])('rejects opaque nested constructor protocols executed by %s', (_label, statement) => {
    const facts = sinksFor(
      routeSource("import { attack } from 'semantic-opaque-value';", statement),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it.each([
    [
      'Reflect.apply argument-list accessors',
      'Reflect.apply(localFunction, null, attack);',
      'function localFunction(value) { return value; }',
    ],
    [
      'Reflect.construct argument-list accessors',
      'Reflect.construct(LocalConstructor, attack);',
      'class LocalConstructor { constructor(value) { void value; } }',
    ],
  ])('rejects opaque %s', (_label, statement, declarations) => {
    const facts = sinksFor(
      routeSource("import { attack } from 'semantic-opaque-value';", statement, declarations),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it('traverses a Reflect.set receiver Proxy defineProperty trap', () => {
    const marker = 'reflect-set-receiver-proxy';
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      const receiver = new Proxy({}, {
        defineProperty(target, key, descriptor) {
          execFileSync('${marker}');
          return Reflect.defineProperty(target, key, descriptor);
        },
      });
      route('/', { page() { Reflect.set({}, 'value', 1, receiver); return 'safe'; } });
    `);

    expectProcessMarker(facts, marker);
  });

  it('traverses a Reflect.construct newTarget Proxy prototype getter', () => {
    const marker = 'reflect-construct-new-target-proxy';
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      function Target() {}
      function NewTarget() {}
      const newTarget = new Proxy(NewTarget, {
        get(target, key, receiver) {
          if (key === 'prototype') execFileSync('${marker}');
          return Reflect.get(target, key, receiver);
        },
      });
      route('/', { page() { Reflect.construct(Target, [], newTarget); return 'safe'; } });
    `);

    expectProcessMarker(facts, marker);
  });

  it.each([
    ['Object.keys', 'Object.keys(proxyTarget);'],
    ['Object.getOwnPropertyDescriptor', "Object.getOwnPropertyDescriptor(proxyTarget, 'value');"],
    ['Object.getOwnPropertyDescriptors', 'Object.getOwnPropertyDescriptors(proxyTarget);'],
    ['Object.getPrototypeOf', 'Object.getPrototypeOf(proxyTarget);'],
    ['Object.hasOwn', "Object.hasOwn(proxyTarget, 'value');"],
    ['Object.isExtensible', 'Object.isExtensible(proxyTarget);'],
    ['Object.freeze', 'Object.freeze(proxyTarget);'],
    ['Object.seal', 'Object.seal(proxyTarget);'],
    ['Object.preventExtensions', 'Object.preventExtensions(proxyTarget);'],
    ['Object.defineProperty', "Object.defineProperty(proxyTarget, 'extra', { value: 'safe' });"],
    ['Object.setPrototypeOf', 'Object.setPrototypeOf(proxyTarget, null);'],
  ])('rejects opaque Proxy traps executed by %s', (_label, statement) => {
    const facts = sinksFor(
      routeSource("import { proxyTarget } from 'semantic-opaque-value';", statement),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it.each([
    ['Reflect.ownKeys', 'Reflect.ownKeys(proxyTarget);'],
    ['Reflect.getOwnPropertyDescriptor', "Reflect.getOwnPropertyDescriptor(proxyTarget, 'value');"],
    ['Reflect.getPrototypeOf', 'Reflect.getPrototypeOf(proxyTarget);'],
    ['Reflect.has', "Reflect.has(proxyTarget, 'value');"],
    ['Reflect.isExtensible', 'Reflect.isExtensible(proxyTarget);'],
    ['Reflect.preventExtensions', 'Reflect.preventExtensions(proxyTarget);'],
    ['Reflect.defineProperty', "Reflect.defineProperty(proxyTarget, 'extra', { value: 'safe' });"],
    ['Reflect.setPrototypeOf', 'Reflect.setPrototypeOf(proxyTarget, null);'],
  ])('keeps the existing fail-closed opaque Proxy guard for %s', (_label, statement) => {
    const facts = sinksFor(
      routeSource("import { proxyTarget } from 'semantic-opaque-value';", statement),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it('keeps Object.is benign for opaque values because it performs no user-code protocol', () => {
    const facts = sinksFor(
      routeSource(
        "import { proxyTarget } from 'semantic-opaque-value';",
        'Object.is(proxyTarget, proxyTarget);',
      ),
    );

    expect(facts).toEqual([]);
  });

  // Node 24.18 runtime probes confirm each argument position below performs the named conversion
  // or options access. Exact safe-method membership must not erase those implicit call edges.
  it.each([
    ['String.includes search ToString', "'abc'.includes(attack);"],
    ['Array.slice start ToInteger', '[1, 2].slice(attack);'],
    ['Array.join separator ToString', '[1, 2].join(attack);'],
    ['Number.toFixed digits ToInteger', '(1.25).toFixed(attack);'],
    ['String.localeCompare options access', "'a'.localeCompare('b', 'en', attack);"],
    ['JSON.rawJSON input ToString', 'JSON.rawJSON(attack);'],
  ])('rejects opaque safe-method argument protocols in %s', (_label, statement) => {
    const facts = sinksFor(
      routeSource("import { attack } from 'semantic-opaque-value';", statement),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it('traverses an indexed getter consumed by Array.concat spreading', () => {
    const marker = 'array-concat-index-getter';
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      const spreadable = { length: 1, [Symbol.isConcatSpreadable]: true };
      Object.defineProperty(spreadable, '0', {
        get() { execFileSync('${marker}'); return 'safe'; },
      });
      route('/', { page() { [].concat(spreadable); return 'safe'; } });
    `);

    expectProcessMarker(facts, marker);
  });

  it('traverses indexed getters on arrays returned from flatMap callbacks', () => {
    const marker = 'flat-map-returned-index-getter';
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      const returned = new Proxy(['safe'], {
        get(target, key, receiver) {
          if (key === '0') execFileSync('${marker}');
          return Reflect.get(target, key, receiver);
        },
      });
      route('/', { page() { [1].flatMap(() => returned); return 'safe'; } });
    `);

    expectProcessMarker(facts, marker);
  });

  it('traverses a dynamically installed ArrayBuffer maxByteLength getter', () => {
    const marker = 'array-buffer-max-byte-length-getter';
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      const options = {};
      Object.defineProperty(options, 'maxByteLength', {
        get() { execFileSync('${marker}'); return 8; },
      });
      route('/', { page() { new ArrayBuffer(8, options); return 'safe'; } });
    `);

    expectProcessMarker(facts, marker);
  });

  it('rejects an opaque typed-array array-like element conversion', () => {
    const facts = sinksFor(
      routeSource(
        "import { attack } from 'semantic-opaque-value';",
        'new Uint8Array({ length: 1, 0: attack });',
      ),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it.each([
    ['Object.create descriptor map', 'Object.create(null, { x: attack });'],
    ['Object.defineProperties descriptor map', 'Object.defineProperties({}, { x: attack });'],
  ])('rejects an opaque nested descriptor in %s', (_label, statement) => {
    const facts = sinksFor(
      routeSource("import { attack } from 'semantic-opaque-value';", statement),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it.each([
    ['Object.create', 'Object.create(null, { x: descriptor });'],
    ['Object.defineProperties', 'Object.defineProperties({}, { x: descriptor });'],
  ])('keeps direct local descriptor getter traversal for %s', (_label, statement) => {
    const marker = 'local-descriptor-getter';
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      const descriptor = {
        get value() { execFileSync('${marker}'); return 'safe'; },
        enumerable: true,
      };
      route('/', { page() { ${statement} return 'safe'; } });
    `);

    expectProcessMarker(facts, marker);
  });

  it.each([
    ['join', "input.values.join(',');", false],
    ['sort', 'input.values.sort();', false],
    ['toLocaleString', 'input.values.toLocaleString();', false],
    ['join through alias', "values.join(',');", true],
    ['sort through alias', 'values.sort();', true],
    ['toLocaleString through alias', 'values.toLocaleString();', true],
  ])('keeps input-array mutation chains fail closed for %s', (_label, consume, alias) => {
    const facts = sinksFor(`
      import { attack } from 'semantic-opaque-value';
      import { query } from '@kovojs/server';
      query({ load(input) {
        ${alias ? 'const values = input.values;' : ''}
        ${alias ? 'values' : 'input.values'}.push(attack);
        ${consume}
        return 'safe';
      } });
    `);

    expectOpaqueSemanticBoundary(facts);
  });

  it.each([
    ['prefix increment', 'let value = attack; ++value;'],
    ['prefix decrement', 'let value = attack; --value;'],
    ['compound addition', 'let value = attack; value += 1;'],
    ['compound multiplication', 'let value = attack; value *= 2;'],
  ])('rejects opaque coercion executed by %s', (_label, statement) => {
    const facts = sinksFor(
      routeSource("import { attack } from 'semantic-opaque-value';", statement),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it('traverses for-in Proxy ownKeys and descriptor traps', () => {
    const marker = 'for-in-proxy-traps';
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      const source = new Proxy({ value: 'safe' }, {
        ownKeys(target) { execFileSync('${marker}'); return Reflect.ownKeys(target); },
        getOwnPropertyDescriptor(target, key) {
          execFileSync('${marker}');
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
      route('/', { page() { for (const key in source) void key; return 'safe'; } });
    `);

    expectProcessMarker(facts, marker);
  });

  it('rejects a direct opaque imported property getter read', () => {
    const facts = sinksFor(
      routeSource("import { attack } from 'semantic-opaque-value';", 'void attack.value;'),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it('rejects an opaque getter reached through a helper destructured parameter', () => {
    const facts = sinksFor(
      routeSource(
        "import { attack } from 'semantic-opaque-value';",
        'helper(attack);',
        'function helper({ value }) { return value; }',
      ),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it('keeps exact local getter and destructured-helper traversal guards', () => {
    const marker = 'local-getter-read';
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      const source = { get value() { execFileSync('${marker}'); return 'safe'; } };
      function helper({ value }) { return value; }
      route('/', { page() { void source.value; helper(source); return 'safe'; } });
    `);

    expectProcessMarker(facts, marker);
  });

  it.each([
    ['direct assignment', "attack.value = 'safe';"],
    ['compound assignment', 'attack.value += 1;'],
    ['update expression', '++attack.value;'],
    ['object destructuring assignment target', "({ value: attack.value } = { value: 'safe' });"],
    ['array destructuring assignment target', "[attack.value] = ['safe'];"],
  ])('rejects an opaque imported setter carrier reached by %s', (_label, statement) => {
    const facts = sinksFor(
      routeSource("import { attack } from 'semantic-opaque-value';", statement),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it('keeps local getter and setter traversal guards across assignment forms', () => {
    const marker = 'local-setter-assignment';
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      const target = {
        get value() { execFileSync('${marker}'); return 1; },
        set value(next) { execFileSync('${marker}'); void next; },
      };
      route('/', { page() {
        target.value = 2;
        target.value += 1;
        ++target.value;
        ({ value: target.value } = { value: 4 });
        [target.value] = [5];
        return 'safe';
      } });
    `);

    expectProcessMarker(facts, marker);
  });

  it.each([
    [
      'Request.text direct own shadow',
      "import { callback } from 'semantic-opaque-callback';",
      `const request = new Request('data:,safe');
       Object.defineProperty(request, 'text', { value: callback });
       void request.text();`,
      '',
    ],
    [
      'Request.text aliased own shadow',
      "import { callback } from 'semantic-opaque-callback';",
      `const request = new Request('data:,safe');
       const alias = request;
       Reflect.defineProperty(alias, 'text', { value: callback });
       void request.text();`,
      '',
    ],
    [
      'fetched Response.json direct own shadow',
      "import { callback } from 'semantic-opaque-callback';",
      'void exercise();',
      `async function exercise() {
         const response = await fetch('data:application/json,{}');
         Object.defineProperty(response, 'json', { value: callback });
         void response.json();
       }`,
    ],
    [
      'fetched Response.json aliased own shadow',
      "import { callback } from 'semantic-opaque-callback';",
      'void exercise();',
      `async function exercise() {
         const response = await fetch('data:application/json,{}');
         const alias = response;
         Reflect.defineProperty(alias, 'json', { value: callback });
         void response.json();
       }`,
    ],
    [
      'Request.text direct per-instance prototype replacement',
      "import { callback } from 'semantic-opaque-callback';",
      `const request = new Request('data:,safe');
       Object.setPrototypeOf(request, { text: callback });
       void request.text();`,
      '',
    ],
    [
      'Request.text aliased per-instance prototype replacement',
      "import { callback } from 'semantic-opaque-callback';",
      `const request = new Request('data:,safe');
       const alias = request;
       Reflect.setPrototypeOf(alias, { text: callback });
       void request.text();`,
      '',
    ],
    [
      'fetched Response.json direct per-instance prototype replacement',
      "import { callback } from 'semantic-opaque-callback';",
      'void exercise();',
      `async function exercise() {
         const response = await fetch('data:application/json,{}');
         Object.setPrototypeOf(response, { json: callback });
         void response.json();
       }`,
    ],
    [
      'fetched Response.json aliased per-instance prototype replacement',
      "import { callback } from 'semantic-opaque-callback';",
      'void exercise();',
      `async function exercise() {
         const response = await fetch('data:application/json,{}');
         const alias = response;
         Reflect.setPrototypeOf(alias, { json: callback });
         void response.json();
       }`,
    ],
    [
      'Date.toString direct own shadow',
      "import { callback } from 'semantic-opaque-callback';",
      `const value = new Date(0);
       Object.defineProperty(value, 'toString', { value: callback });
       void value.toString();`,
      '',
    ],
    [
      'Date.toString aliased own shadow',
      "import { callback } from 'semantic-opaque-callback';",
      `const value = new Date(0);
       const alias = value;
       Reflect.defineProperty(alias, 'toString', { value: callback });
       void value.toString();`,
      '',
    ],
    [
      'Error.name direct assignment',
      "import { attack } from 'semantic-opaque-value';",
      `const error = new Error('safe');
       error.name = attack;
       void error.toString();`,
      '',
    ],
    [
      'Error.name aliased assignment',
      "import { attack } from 'semantic-opaque-value';",
      `const error = new Error('safe');
       const alias = error;
       alias.name = attack;
       void error.toString();`,
      '',
    ],
  ])('rejects opaque hooks laundered through %s', (_label, imports, statement, declarations) => {
    const facts = sinksFor(routeSource(imports, statement, declarations));

    expectOpaqueSemanticBoundary(facts);
  });

  it.each([
    ['Object.create', 'const child = Object.create(proto);'],
    ['Object.setPrototypeOf', 'const child = {}; Object.setPrototypeOf(child, proto);'],
    ['an object-literal __proto__ entry', 'const child = { __proto__: proto };'],
  ])('traverses a local prototype getter installed through %s', (_label, setup) => {
    const marker = 'prototype-chain-local-getter';
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      const proto = {
        get secret() { execFileSync('${marker}'); return 'safe'; },
      };
      route('/', { page() { ${setup} void child.secret; return 'safe'; } });
    `);

    expectProcessMarker(facts, marker);
  });

  it.each([
    ['Object.create', 'const child = Object.create(protoGetter);'],
    ['Object.setPrototypeOf', 'const child = {}; Object.setPrototypeOf(child, protoGetter);'],
    ['an object-literal __proto__ entry', 'const child = { __proto__: protoGetter };'],
  ])('rejects an opaque prototype getter installed through %s', (_label, setup) => {
    const facts = sinksFor(
      routeSource(
        "import { protoGetter } from 'semantic-opaque-value';",
        `${setup} void child.secret;`,
      ),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it('traverses Proxy prototype access during class heritage evaluation', () => {
    const marker = 'class-heritage-proxy-prototype';
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      class Base {}
      const proxiedBase = new Proxy(Base, {
        get(target, key, receiver) {
          if (key === 'prototype') execFileSync('${marker}');
          return Reflect.get(target, key, receiver);
        },
      });
      route('/', { page() { class Child extends proxiedBase {} void Child; return 'safe'; } });
    `);

    expectProcessMarker(facts, marker);
  });

  it('rejects opaque class heritage evaluated inside a handler', () => {
    const facts = sinksFor(
      routeSource(
        "import { Base } from 'semantic-opaque-base';",
        'class Child extends Base {} void Child;',
      ),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it.each([
    ['reads', 'read() { return super.secret; }', 'void new Child().read();'],
    ['writes', 'write(value) { super.secret = value; }', "new Child().write('safe');"],
  ])(
    'resolves a base accessor when a request-reachable subclass method %s super.secret',
    (_label, method, statement) => {
      const marker = 'super-accessor';
      const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      class Base {
        get secret() { execFileSync('${marker}'); return 'safe'; }
        set secret(value) { execFileSync('${marker}'); void value; }
      }
      class Child extends Base { ${method} }
      route('/', { page() { ${statement} return 'safe'; } });
    `);

      expectProcessMarker(facts, marker);
    },
  );

  it('rejects a handler-local decorated class even when it is never instantiated', () => {
    const facts = sinksFor(
      routeSource(
        "import { decorator } from 'semantic-opaque-value';",
        '@decorator class Local {} void Local;',
      ),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it.each([
    ['intrinsic JSX element', 'const node = <div {...attack} />; void node;', ''],
    [
      'component JSX element',
      'const node = <Component {...attack} />; void node;',
      'function Component(props) { return <div>{props.value}</div>; }',
    ],
  ])(
    'rejects an opaque package getter consumed by an %s spread',
    (_label, statement, declarations) => {
      const facts = sinksFor(
        routeSource("import { attack } from 'semantic-opaque-value';", statement, declarations),
      );

      expectOpaqueSemanticBoundary(facts);
    },
  );

  it.each([
    ['intrinsic JSX element', 'const node = <div {...source} />; void node;', ''],
    [
      'component JSX element',
      'const node = <Component {...source} />; void node;',
      'function Component(props) { return <div>{props.value}</div>; }',
    ],
  ])('traverses a local getter consumed by an %s spread', (_label, statement, declarations) => {
    const marker = 'jsx-spread-getter';
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      const source = { get value() { execFileSync('${marker}'); return 'safe'; } };
      ${declarations}
      route('/', { page() { ${statement} return 'safe'; } });
    `);

    expectProcessMarker(facts, marker);
  });

  it('keeps the existing fail-closed guard for Function.prototype.apply argument lists', () => {
    const facts = sinksFor(
      routeSource(
        "import { attack } from 'semantic-opaque-value';",
        'localFunction.apply(null, attack);',
        'function localFunction(value) { return value; }',
      ),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it.each([
    ['join', "values.join(',');", 'array-join-element-coercion'],
    ['default sort', 'values.sort();', 'array-sort-element-coercion'],
    ['toLocaleString', 'values.toLocaleString();', 'array-locale-element-coercion'],
  ])('traverses local array element protocols executed by %s', (_label, statement, marker) => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      const values = [{
        toString() { execFileSync('${marker}'); return 'safe'; },
        toLocaleString() { execFileSync('${marker}'); return 'safe'; },
      }];
      route('/', { page() { ${statement} return 'safe'; } });
    `);

    expectProcessMarker(facts, marker);
  });

  it.each([
    ['Headers record init', 'new Headers(attack);'],
    ['Response init dictionary', "new Response('safe', attack);"],
    ['Request init dictionary', "new Request('https://example.test/', attack);"],
    ['URLSearchParams record init', 'new URLSearchParams(attack);'],
    ['AggregateError cause getter', "new AggregateError([], 'safe', attack);"],
    ['RegExp pattern protocol', 'new RegExp(attack);'],
  ])('keeps the existing fail-closed guard for %s', (_label, statement) => {
    const facts = sinksFor(
      routeSource("import { attack } from 'semantic-opaque-value';", statement),
    );

    expectOpaqueSemanticBoundary(facts);
  });

  it('keeps plain local callback intrinsic controls open', () => {
    const facts = sinksFor(
      routeSource(
        '',
        `
          Object.groupBy(['safe'], (value) => value);
          Promise.try(() => 'safe');
          JSON.parse('"safe"', (_key, value) => value);
          JSON.stringify({ value: 'safe' }, (_key, value) => value);
          Array.fromAsync(['safe'], (value) => value);
        `,
      ),
    );

    expect(facts).toEqual([]);
  });

  it('keeps plain-data enumeration, serialization, and dictionary controls open', () => {
    const facts = sinksFor(
      routeSource(
        '',
        `
          Object.assign({}, { value: 'safe' });
          Object.values({ value: 'safe' });
          Object.entries({ value: 'safe' });
          JSON.stringify({ nested: { value: 'safe' } });
          Response.json({ nested: { value: 'safe' } }, { status: 200 });
          new Headers({ 'x-safe': 'yes' });
          new Response('safe', { status: 200 });
          new Request('https://example.test/', { method: 'GET' });
          new URLSearchParams({ x: 'safe' });
          new Response('safe', { headers: [['x-test', 'safe']] });
          new Request('https://example.test/', { headers: [['x-test', 'safe']] });
          Response.json({ ok: true }, { headers: [['x-test', 'safe']] });
        `,
      ),
    );

    expect(facts).toEqual([]);
  });

  it('keeps primitive callback-result conversions open', () => {
    const facts = sinksFor(
      routeSource(
        '',
        `
          ['b', 'a'].sort(() => 0);
          ['b', 'a'].toSorted(() => 0);
          'x'.replace('x', () => 'safe');
          'x'.replaceAll('x', () => 'safe');
          JSON.stringify({ value: 'safe' }, (_key, value) => value);
          Promise.try(() => 'safe');
          Array.fromAsync(['safe'], () => 'safe');
        `,
      ),
    );

    expect(facts).toEqual([]);
  });

  it('keeps primitive safe-method controls open while rejecting JSON.rawJSON', () => {
    const facts = sinksFor(
      routeSource(
        '',
        `
          'abc'.includes('b');
          [1, 2].slice(1);
          [1, 2].join(',');
          (1.25).toFixed(1);
          'a'.localeCompare('b', 'en', { sensitivity: 'base' });
          JSON.rawJSON('1');
          [].concat({ length: 1, 0: 'safe', [Symbol.isConcatSpreadable]: true });
          [1].flatMap(() => ['safe']);
          new ArrayBuffer(8, { maxByteLength: 8 });
          new Uint8Array({ length: 1, 0: 1 });
          Object.create(null, { x: { value: 'safe' } });
          Object.defineProperties({}, { x: { value: 'safe' } });
          let value = 1;
          ++value;
          --value;
          value += 1;
          value *= 2;
          for (const key in { value: 'safe' }) void key;
          void ({ value: 'safe' }).value;
          helper({ value: 'safe' });
          const target = { value: 1 };
          target.value = 2;
          target.value += 1;
          ++target.value;
          ({ value: target.value } = { value: 4 });
          [target.value] = [5];
          class Base {}
          class Child extends Base {}
          void Child;
        `,
        'function helper({ value }) { return value; }',
      ),
    );

    expect(facts).toEqual([
      expect.objectContaining({
        sink: 'request-handler.opaque-call',
        source: 'JSON.rawJSON',
      }),
    ]);
  });

  it('keeps plain async, prototype, and mutation controls open while rejecting global aliases', () => {
    const facts = sinksFor(
      routeSource(
        '',
        `void consume();
         void returnsValue();
         void fetch('data:,safe', { headers: [['x-test', 'safe']] });
         void setTimeout(() => {}, 0);
         void setInterval(() => {}, 1);
         global.JSON.stringify({ safe: true });
         globalThis.Math.abs(-1);
         void globalThis.fetch('data:,safe');
         globalThis.queueMicrotask(() => {});
         const proto = { get secret() { return 'safe'; } };
         void Object.create(proto).secret;
         const child = { __proto__: proto };
         void child.secret;
         const plain = { value: 'safe' };
         Object.keys(plain);
         Object.getOwnPropertyDescriptor(plain, 'value');
         Object.getOwnPropertyDescriptors(plain);
         Object.getPrototypeOf(plain);
         Object.hasOwn(plain, 'value');
         Object.isExtensible(plain);
         Object.is(plain, plain);`,
        `async function consume() { for await (const value of ['safe']) void value; }
         async function returnsValue() { return 'safe'; }`,
      ),
    );

    expect(facts).toHaveLength(6);
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'global.JSON.stringify' }),
        expect.objectContaining({ source: '<property-getter:global>' }),
        expect.objectContaining({ source: 'globalThis.Math.abs' }),
        expect.objectContaining({ source: '<property-getter:globalThis>' }),
        expect.objectContaining({ source: 'globalThis.fetch' }),
        expect.objectContaining({ source: 'globalThis.queueMicrotask' }),
      ]),
    );
  });

  it('keeps plain decorators and JSX spreads open', () => {
    const facts = sinksFor(
      routeSource(
        '',
        `@decorator class Local {}
         const source = { value: 'safe' };
         const intrinsic = <div {...source} />;
         const component = <Component {...source} />;
         void Local;
         void intrinsic;
         void component;`,
        `function decorator(value) { return value; }
         function Component(props) { return <div>{props.value}</div>; }`,
      ),
    );

    expect(facts).toEqual([]);
  });

  it('rejects unreviewed Node builtin operations even on plain values', () => {
    const facts = sinksFor(
      routeSource(
        `
          import assert from 'node:assert/strict';
          import { Buffer as NodeBuffer } from 'node:buffer';
          import querystring from 'node:querystring';
          import * as nodeUrl from 'node:url';
        `,
        `
          assert.throws(() => { throw new Error('expected'); });
          querystring.stringify({ value: 'safe' });
          querystring.parse('x=y', '&', '=', { decodeURIComponent });
          NodeBuffer.from('safe');
          nodeUrl.format({ protocol: 'https:', host: 'example.test', pathname: '/' });
        `,
      ),
    );

    expect(facts).toHaveLength(6);
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'node:assert/strict.throws' }),
        expect.objectContaining({ sink: 'node:querystring.stringify' }),
        expect.objectContaining({ sink: 'node:querystring.parse' }),
        expect.objectContaining({ sink: 'node:buffer.Buffer' }),
        expect.objectContaining({ sink: 'request-handler.opaque-package-call' }),
        expect.objectContaining({ sink: 'node:url.format' }),
      ]),
    );
  });

  it('keeps plain Map entries and Array.fromAsync values open', () => {
    const facts = sinksFor(
      routeSource(
        '',
        `
          Object.fromEntries([['key', 'value']]);
          Array.fromAsync(['safe']);
        `,
      ),
    );

    expect(facts).toEqual([]);
  });

  it('keeps plain reflective argument lists and string array methods open', () => {
    const facts = sinksFor(
      routeSource(
        '',
        `
          Reflect.apply(localFunction, null, ['safe']);
          Reflect.construct(LocalConstructor, ['safe']);
          Reflect.set({}, 'value', 1, {});
          Reflect.construct(localFunction, [], localFunction);
          ['a', 'b'].join(',');
          ['b', 'a'].sort();
          ['a', 'b'].toLocaleString();
        `,
        `
          function localFunction(value) { return value; }
          class LocalConstructor { constructor(value) { void value; } }
        `,
      ),
    );

    expect(facts).toEqual([]);
  });

  it('keeps primitive exact-global and constructor protocol controls open', () => {
    const facts = sinksFor(
      routeSource(
        '',
        `
          Math.max(1, 2);
          Date.parse('2026-01-01T00:00:00Z');
          BigInt.asIntN(8, 1n);
          String.raw({ raw: ['safe'] });
          Symbol.for('safe');
          URL.canParse('https://example.test/');
          URL.parse('https://example.test/');
          crypto.randomUUID({ disableEntropyCache: true });
          new AggregateError([], 'safe', { cause: 'safe' });
          new RegExp('safe');
          new Blob(['safe']);
          new File(['safe'], 'safe.txt');
          new Uint8Array([1]);
        `,
      ),
    );

    expect(facts).toEqual([]);
  });
});
