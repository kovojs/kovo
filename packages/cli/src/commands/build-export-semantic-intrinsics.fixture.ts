import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { mainAsync } from '../index.js';

const repoRoot = process.cwd();
const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function fixture(name: string): string {
  const root = mkdtempSync(join(repoRoot, `.tmp-kovo-semantic-intrinsics-${name}-`));
  roots.push(root);
  mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
  symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
  symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><script type="module" src="/src/client.ts"></script>\n',
    'utf8',
  );
  writeFileSync(join(root, 'src/client.ts'), 'export {};\n', 'utf8');
  return root;
}

function writePackage(root: string, name: string, source: string): void {
  const directory = join(root, 'node_modules', name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'package.json'),
    `${JSON.stringify({ name, type: 'module', exports: './index.mjs' }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(join(directory, 'index.mjs'), source, 'utf8');
}

function writeAttackPackage(root: string): void {
  writePackage(
    root,
    'semantic-intrinsic-attacks',
    `import { execFileSync } from 'node:child_process';
function hit() { execFileSync('/usr/bin/true'); }
export function callback(value) { hit(); return value ?? 'safe'; }
export const enumerable = {
  get value() { hit(); return 'safe'; },
  set value(next) { hit(); void next; },
};
export const nested = {
  child: { get value() { hit(); return 'safe'; } },
};
export const responseInit = {
  get status() { hit(); return 200; },
};
export const coercible = {
  [Symbol.toPrimitive](hint) { hit(); return hint === 'string' ? 'data:,safe' : 1; },
  valueOf() { hit(); return 'safe'; },
  toString() { hit(); return 'safe'; },
};
export const rawTemplate = {
  get raw() { hit(); return ['safe']; },
};
export const urlRecord = {
  get protocol() { hit(); return 'https:'; },
  get host() { hit(); return 'example.test'; },
  get pathname() { hit(); return '/'; },
};
export const argumentList = {
  get length() { hit(); return 0; },
  get 0() { hit(); return 'safe'; },
};
export const thenable = {
  then(resolve) { hit(); resolve('safe'); },
};
export const localeOptions = {
  get sensitivity() { hit(); return 'base'; },
};
export const descriptor = {
  get value() { hit(); return 'safe'; },
  enumerable: true,
};
export const fetchInit = {
  get method() { hit(); return 'GET'; },
};
export const stringBox = new String('value');
stringBox.toString = () => { hit(); return 'value'; };
export const numberBox = new Number(1);
Object.defineProperty(numberBox, 'toString', { value: undefined });
numberBox.valueOf = () => { hit(); return 1; };
export function decorator(value) { hit(); return value; }
export function poisonFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = () => { hit(); return Promise.resolve(new Response('safe')); };
  return () => { globalThis.fetch = original; };
}
export const protoGetter = {
  get secret() { hit(); return 'safe'; },
};
export const proxyTarget = new Proxy({ value: 'safe' }, {
  ownKeys(target) { hit(); return Reflect.ownKeys(target); },
  getOwnPropertyDescriptor(target, key) { hit(); return Reflect.getOwnPropertyDescriptor(target, key); },
  getPrototypeOf(target) { hit(); return Reflect.getPrototypeOf(target); },
  has(target, key) { hit(); return Reflect.has(target, key); },
  isExtensible(target) { hit(); return Reflect.isExtensible(target); },
  preventExtensions(target) { hit(); return Reflect.preventExtensions(target); },
  defineProperty(target, key, descriptor) { hit(); return Reflect.defineProperty(target, key, descriptor); },
  setPrototypeOf(target, proto) { hit(); return Reflect.setPrototypeOf(target, proto); },
});
class PlainBase {}
export const Base = new Proxy(PlainBase, {
  get(target, key, receiver) { hit(); return Reflect.get(target, key, receiver); },
});
`,
  );
}

function writeApp(root: string, source: string, fileName = 'app.mjs'): void {
  writeFileSync(join(root, fileName), source, 'utf8');
}

function appSource(imports: string, statement: string, declarations = ''): string {
  return `/** @jsxImportSource @kovojs/server */
${imports}
import { createApp, publicAccess, route } from '@kovojs/server';
${declarations}
const semanticRoute = route('/', {
  access: publicAccess('semantic intrinsic security corpus'),
  page() {
    ${statement}
    return 'safe';
  },
});
export default createApp({ routes: [semanticRoute] });
`;
}

async function strictBuild(
  root: string,
  entry = './app.mjs',
): Promise<{ code: number; stderr: string; stdout: string }> {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const before = process.cwd();
  try {
    process.chdir(root);
    const code = await mainAsync(['build', entry, '--out', './dist', '--no-cache']);
    return {
      code,
      stderr: stderr.mock.calls.map(([chunk]) => String(chunk)).join(''),
      stdout: stdout.mock.calls.map(([chunk]) => String(chunk)).join(''),
    };
  } finally {
    process.chdir(before);
    stdout.mockRestore();
    stderr.mockRestore();
  }
}

function expectOpaqueKv424(root: string, result: { code: number; stderr: string }): void {
  expect(result, result.stderr).toMatchObject({ code: 1 });
  expect(result.stderr).toContain('ERROR KV424');
  expect(result.stderr).toMatch(/sink=request-handler\.opaque/u);
  expect(existsSync(join(root, 'dist'))).toBe(false);
}

function expectRejectedKv424(root: string, result: { code: number; stderr: string }): void {
  expect(result, result.stderr).toMatchObject({ code: 1 });
  expect(result.stderr).toContain('ERROR KV424');
  expect(existsSync(join(root, 'dist'))).toBe(false);
}

function expectProcessKv424(root: string, result: { code: number; stderr: string }): void {
  expect(result, result.stderr).toMatchObject({ code: 1 });
  expect(result.stderr).toContain('ERROR KV424');
  expect(result.stderr).toContain('sink=child_process.execFileSync');
  expect(result.stderr).toContain("source='/usr/bin/true'");
  expect(existsSync(join(root, 'dist'))).toBe(false);
}

// SPEC §2 and §6.6: these exact intrinsics execute opaque package callbacks, accessors, or
// coercion hooks. A strict build must not silently treat the whole operation as reviewed-safe.
export function registerSemanticIntrinsicStrictCorpus(bucket: 0 | 1 | 2 | 3): void {
  describe('kovo build KV424 strict semantic intrinsic corpus', () => {
    it.each(
      [
        [
          'Object.groupBy opaque callback',
          "import { callback } from 'semantic-intrinsic-attacks';",
          "Object.groupBy(['safe'], callback);",
          '',
        ],
        [
          'Object.values imported getter',
          "import { enumerable } from 'semantic-intrinsic-attacks';",
          'Object.values(enumerable);',
          '',
        ],
        [
          'Response.json nested imported getter',
          "import { nested } from 'semantic-intrinsic-attacks';",
          'Response.json({ nested });',
          '',
        ],
        [
          'Response.json imported init getter',
          "import { responseInit } from 'semantic-intrinsic-attacks';",
          'Response.json({ ok: true }, responseInit);',
          '',
        ],
        [
          'Headers nested imported record value',
          "import { coercible } from 'semantic-intrinsic-attacks';",
          "new Headers({ 'x-test': coercible });",
          '',
        ],
        [
          'Response.json nested imported statusText',
          "import { coercible } from 'semantic-intrinsic-attacks';",
          'Response.json({ ok: true }, { statusText: coercible });',
          '',
        ],
        [
          'Response.json nested HeadersInit tuple conversion',
          "import { coercible } from 'semantic-intrinsic-attacks';",
          "Response.json({ ok: true }, { headers: [['x-test', coercible]] });",
          '',
        ],
        [
          'node:assert opaque callback',
          "import assert from 'node:assert/strict'; import { callback } from 'semantic-intrinsic-attacks';",
          'assert.throws(callback);',
          '',
        ],
        [
          'node:querystring opaque decoder callback',
          "import querystring from 'node:querystring'; import { callback } from 'semantic-intrinsic-attacks';",
          "querystring.parse('x=y', '&', '=', { decodeURIComponent: callback });",
          '',
        ],
        [
          'node:buffer opaque valueOf',
          "import { Buffer as NodeBuffer } from 'node:buffer'; import { coercible } from 'semantic-intrinsic-attacks';",
          'NodeBuffer.from(coercible);',
          '',
        ],
        [
          'node:buffer opaque array element valueOf',
          "import { Buffer as NodeBuffer } from 'node:buffer'; import { coercible } from 'semantic-intrinsic-attacks';",
          'NodeBuffer.from([coercible]);',
          '',
        ],
        [
          'node:url format imported getters',
          "import * as nodeUrl from 'node:url'; import { urlRecord } from 'semantic-intrinsic-attacks';",
          'nodeUrl.format(urlRecord);',
          '',
        ],
        [
          'Math.max opaque ToPrimitive',
          "import { coercible } from 'semantic-intrinsic-attacks';",
          'Math.max(coercible);',
          '',
        ],
        [
          'String.raw imported raw getter',
          "import { rawTemplate } from 'semantic-intrinsic-attacks';",
          'String.raw(rawTemplate);',
          '',
        ],
        [
          'Blob opaque element conversion',
          "import { coercible } from 'semantic-intrinsic-attacks';",
          'new Blob([coercible]);',
          '',
        ],
        [
          'Reflect.apply opaque argument-list getters',
          "import { argumentList } from 'semantic-intrinsic-attacks';",
          'Reflect.apply(localFunction, null, argumentList);',
          'function localFunction(value) { return value; }',
        ],
        [
          'Array.sort opaque comparator result coercion',
          "import { coercible } from 'semantic-intrinsic-attacks';",
          "['b', 'a'].sort(() => coercible);",
          '',
        ],
        [
          'String.replace opaque replacer result coercion',
          "import { coercible } from 'semantic-intrinsic-attacks';",
          "'x'.replace('x', () => coercible);",
          '',
        ],
        [
          'JSON.stringify opaque replacer-result nested getter',
          "import { nested } from 'semantic-intrinsic-attacks';",
          "JSON.stringify({ value: 'safe' }, (key, value) => key === 'value' ? nested : value);",
          '',
        ],
        [
          'Promise.try opaque returned thenable',
          "import { thenable } from 'semantic-intrinsic-attacks';",
          'Promise.try(() => thenable);',
          '',
        ],
        [
          'Array.fromAsync mapper opaque returned thenable',
          "import { thenable } from 'semantic-intrinsic-attacks';",
          "Array.fromAsync(['safe'], () => thenable);",
          '',
        ],
        [
          'String.includes opaque ToString',
          "import { coercible } from 'semantic-intrinsic-attacks';",
          "'abc'.includes(coercible);",
          '',
        ],
        [
          'String.localeCompare opaque options getters',
          "import { localeOptions } from 'semantic-intrinsic-attacks';",
          "'a'.localeCompare('b', 'en', localeOptions);",
          '',
        ],
        [
          'JSON.rawJSON opaque ToString',
          "import { coercible } from 'semantic-intrinsic-attacks';",
          'JSON.rawJSON(coercible);',
          '',
        ],
        [
          'typed-array opaque array-like element conversion',
          "import { coercible } from 'semantic-intrinsic-attacks';",
          'new Uint8Array({ length: 1, 0: coercible });',
          '',
        ],
        [
          'prefix update opaque coercion',
          "import { coercible } from 'semantic-intrinsic-attacks';",
          'let value = coercible; ++value;',
          '',
        ],
        [
          'direct opaque imported property getter',
          "import { enumerable } from 'semantic-intrinsic-attacks';",
          'void enumerable.value;',
          '',
        ],
        [
          'helper destructured opaque imported getter',
          "import { enumerable } from 'semantic-intrinsic-attacks';",
          'readValue(enumerable);',
          'function readValue({ value }) { return value; }',
        ],
        [
          'direct opaque imported setter',
          "import { enumerable } from 'semantic-intrinsic-attacks';",
          "enumerable.value = 'safe';",
          '',
        ],
        [
          'opaque class heritage evaluation',
          "import { Base } from 'semantic-intrinsic-attacks';",
          'class Child extends Base {} void Child;',
          '',
        ],
        [
          'Object.defineProperties opaque nested descriptor',
          "import { descriptor } from 'semantic-intrinsic-attacks';",
          'Object.defineProperties({}, { x: descriptor });',
          '',
        ],
        [
          'JSON.stringify replacer-array String-box conversion',
          "import { stringBox } from 'semantic-intrinsic-attacks';",
          "JSON.stringify({ value: 'safe' }, [stringBox]);",
          '',
        ],
        [
          'JSON.stringify replacer-array Number-box conversion',
          "import { numberBox } from 'semantic-intrinsic-attacks';",
          "JSON.stringify({ 1: 'safe' }, [numberBox]);",
          '',
        ],
        [
          'JSON.stringify String-box space conversion',
          "import { stringBox } from 'semantic-intrinsic-attacks';",
          "JSON.stringify({ value: 'safe' }, null, stringBox);",
          '',
        ],
        [
          'JSON.stringify Number-box space conversion',
          "import { numberBox } from 'semantic-intrinsic-attacks';",
          "JSON.stringify({ value: 'safe' }, null, numberBox);",
          '',
        ],
        [
          'for-await sync-array thenable assimilation',
          "import { thenable } from 'semantic-intrinsic-attacks';",
          'void consume();',
          'async function consume() { for await (const value of [thenable]) void value; }',
        ],
        [
          'async-generator plain-yield thenable assimilation',
          "import { thenable } from 'semantic-intrinsic-attacks';",
          'void produce().next();',
          'async function* produce() { yield thenable; }',
        ],
        [
          'ignored async-function returned thenable assimilation',
          "import { thenable } from 'semantic-intrinsic-attacks';",
          'void produce();',
          'async function produce() { return thenable; }',
        ],
        [
          'fetch opaque input ToString',
          "import { coercible } from 'semantic-intrinsic-attacks';",
          'void fetch(coercible);',
          '',
        ],
        [
          'fetch opaque init getter',
          "import { fetchInit } from 'semantic-intrinsic-attacks';",
          "void fetch('data:,safe', fetchInit);",
          '',
        ],
        [
          'fetch opaque HeadersInit record getter',
          "import { enumerable } from 'semantic-intrinsic-attacks';",
          "void fetch('data:,safe', { headers: enumerable });",
          '',
        ],
        [
          'fetch opaque HeadersInit tuple conversion',
          "import { coercible } from 'semantic-intrinsic-attacks';",
          "void fetch('data:,safe', { headers: [['x-test', coercible]] });",
          '',
        ],
        [
          'setTimeout opaque delay conversion',
          "import { coercible } from 'semantic-intrinsic-attacks';",
          'clearTimeout(setTimeout(() => {}, coercible));',
          '',
        ],
        [
          'setInterval opaque delay conversion',
          "import { coercible } from 'semantic-intrinsic-attacks';",
          'clearInterval(setInterval(() => {}, coercible));',
          '',
        ],
        [
          'Request.text direct own-method shadow',
          "import { callback } from 'semantic-intrinsic-attacks';",
          `const request = new Request('data:,safe');
       Object.defineProperty(request, 'text', { value: callback });
       void request.text();`,
          '',
        ],
        [
          'Request.text aliased own-method shadow',
          "import { callback } from 'semantic-intrinsic-attacks';",
          `const request = new Request('data:,safe');
       const alias = request;
       Reflect.defineProperty(alias, 'text', { value: callback });
       void request.text();`,
          '',
        ],
        [
          'fetched Response.json direct own-method shadow',
          "import { callback } from 'semantic-intrinsic-attacks';",
          'void exercise();',
          `async function exercise() {
         const response = await fetch('data:application/json,{}');
         Object.defineProperty(response, 'json', { value: callback });
         void response.json();
       }`,
        ],
        [
          'fetched Response.json aliased own-method shadow',
          "import { callback } from 'semantic-intrinsic-attacks';",
          'void exercise();',
          `async function exercise() {
         const response = await fetch('data:application/json,{}');
         const alias = response;
         Reflect.defineProperty(alias, 'json', { value: callback });
         void response.json();
       }`,
        ],
        [
          'Date.toString direct own-method shadow',
          "import { callback } from 'semantic-intrinsic-attacks';",
          `const value = new Date(0);
       Object.defineProperty(value, 'toString', { value: callback });
       void value.toString();`,
          '',
        ],
        [
          'Date.toString aliased own-method shadow',
          "import { callback } from 'semantic-intrinsic-attacks';",
          `const value = new Date(0);
       const alias = value;
       Reflect.defineProperty(alias, 'toString', { value: callback });
       void value.toString();`,
          '',
        ],
        [
          'Error.name direct opaque assignment',
          "import { coercible } from 'semantic-intrinsic-attacks';",
          `const error = new Error('safe');
       error.name = coercible;
       void error.toString();`,
          '',
        ],
        [
          'Error.name aliased opaque assignment',
          "import { coercible } from 'semantic-intrinsic-attacks';",
          `const error = new Error('safe');
       const alias = error;
       alias.name = coercible;
       void error.toString();`,
          '',
        ],
        [
          'Object.keys opaque Proxy traps',
          "import { proxyTarget } from 'semantic-intrinsic-attacks';",
          'Object.keys(proxyTarget);',
          '',
        ],
        [
          'Object.getOwnPropertyDescriptor opaque Proxy trap',
          "import { proxyTarget } from 'semantic-intrinsic-attacks';",
          "Object.getOwnPropertyDescriptor(proxyTarget, 'value');",
          '',
        ],
        [
          'Object.freeze opaque Proxy traps',
          "import { proxyTarget } from 'semantic-intrinsic-attacks';",
          'Object.freeze(proxyTarget);',
          '',
        ],
        [
          'Object.defineProperty opaque Proxy trap',
          "import { proxyTarget } from 'semantic-intrinsic-attacks';",
          "Object.defineProperty(proxyTarget, 'extra', { value: 'safe' });",
          '',
        ],
        [
          'Object.setPrototypeOf opaque Proxy trap',
          "import { proxyTarget } from 'semantic-intrinsic-attacks';",
          'Object.setPrototypeOf(proxyTarget, null);',
          '',
        ],
        [
          'Reflect.ownKeys opaque Proxy trap',
          "import { proxyTarget } from 'semantic-intrinsic-attacks';",
          'Reflect.ownKeys(proxyTarget);',
          '',
        ],
        [
          'Reflect.preventExtensions opaque Proxy trap',
          "import { proxyTarget } from 'semantic-intrinsic-attacks';",
          'Reflect.preventExtensions(proxyTarget);',
          '',
        ],
        [
          'Object.create opaque prototype getter',
          "import { protoGetter } from 'semantic-intrinsic-attacks';",
          'const child = Object.create(protoGetter); void child.secret;',
          '',
        ],
        [
          'Object.setPrototypeOf opaque prototype getter',
          "import { protoGetter } from 'semantic-intrinsic-attacks';",
          'const child = {}; Object.setPrototypeOf(child, protoGetter); void child.secret;',
          '',
        ],
        [
          'object-literal __proto__ opaque getter',
          "import { protoGetter } from 'semantic-intrinsic-attacks';",
          'const child = { __proto__: protoGetter }; void child.secret;',
          '',
        ],
        [
          'rebound global.JSON.stringify',
          "import { callback } from 'semantic-intrinsic-attacks';",
          `const original = global;
       try {
         global = { JSON: { stringify() { callback(); } } };
         global.JSON.stringify({ safe: true });
       } finally { global = original; }`,
          '',
        ],
        [
          'rebound globalThis.Math.abs',
          "import { callback } from 'semantic-intrinsic-attacks';",
          `const original = globalThis;
       try {
         globalThis = { Math: { abs() { callback(); } } };
         globalThis.Math.abs(-1);
       } finally { globalThis = original; }`,
          '',
        ],
        [
          'Reflect.get fake-global JSON.stringify',
          "import { callback } from 'semantic-intrinsic-attacks';",
          `const fake = { JSON: { stringify() { callback(); } } };
       Reflect.get(fake, 'JSON').stringify({ safe: true });`,
          '',
        ],
        [
          'Reflect.get rebound-globalThis JSON.stringify',
          "import { callback } from 'semantic-intrinsic-attacks';",
          `const original = globalThis;
       try {
         globalThis = { JSON: { stringify() { callback(); } } };
         Reflect.get(globalThis, 'JSON').stringify({ safe: true });
       } finally { globalThis = original; }`,
          '',
        ],
        [
          'rebound global.fetch',
          "import { callback } from 'semantic-intrinsic-attacks';",
          `const original = global;
       try {
         global = { fetch() { callback(); } };
         global.fetch('data:,safe');
       } finally { global = original; }`,
          '',
        ],
        [
          'rebound globalThis.fetch',
          "import { callback } from 'semantic-intrinsic-attacks';",
          `const original = globalThis;
       try {
         globalThis = { fetch() { callback(); } };
         globalThis.fetch('data:,safe');
       } finally { globalThis = original; }`,
          '',
        ],
        [
          'rebound globalThis.queueMicrotask',
          "import { callback } from 'semantic-intrinsic-attacks';",
          `const original = globalThis;
       try {
         globalThis = { queueMicrotask() { callback(); } };
         globalThis.queueMicrotask(() => {});
       } finally { globalThis = original; }`,
          '',
        ],
        [
          'assigned direct fetch binding followed by direct fetch',
          "import { callback } from 'semantic-intrinsic-attacks';",
          `const original = fetch;
       try {
         fetch = callback;
         void fetch('data:,safe');
       } finally { fetch = original; }`,
          '',
        ],
        [
          'assigned globalThis.fetch followed by direct fetch',
          "import { callback } from 'semantic-intrinsic-attacks';",
          `const original = globalThis.fetch;
       try {
         globalThis.fetch = callback;
         void fetch('data:,safe');
       } finally { globalThis.fetch = original; }`,
          '',
        ],
        [
          'defined globalThis.fetch followed by direct fetch',
          "import { callback } from 'semantic-intrinsic-attacks';",
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
          '',
        ],
        [
          'opaque helper poisoned fetch followed by direct fetch',
          "import { poisonFetch } from 'semantic-intrinsic-attacks';",
          `const restore = poisonFetch();
       try { void fetch('data:,safe'); }
       finally { restore(); }`,
          '',
        ],
        [
          'Request.text direct per-instance prototype replacement',
          "import { callback } from 'semantic-intrinsic-attacks';",
          `const request = new Request('data:,safe');
       Object.setPrototypeOf(request, { text: callback });
       void request.text();`,
          '',
        ],
        [
          'Request.text aliased per-instance prototype replacement',
          "import { callback } from 'semantic-intrinsic-attacks';",
          `const request = new Request('data:,safe');
       const alias = request;
       Reflect.setPrototypeOf(alias, { text: callback });
       void request.text();`,
          '',
        ],
        [
          'fetched Response.json direct per-instance prototype replacement',
          "import { callback } from 'semantic-intrinsic-attacks';",
          'void exercise();',
          `async function exercise() {
         const response = await fetch('data:application/json,{}');
         Object.setPrototypeOf(response, { json: callback });
         void response.json();
       }`,
        ],
        [
          'fetched Response.json aliased per-instance prototype replacement',
          "import { callback } from 'semantic-intrinsic-attacks';",
          'void exercise();',
          `async function exercise() {
         const response = await fetch('data:application/json,{}');
         const alias = response;
         Reflect.setPrototypeOf(alias, { json: callback });
         void response.json();
       }`,
        ],
      ].filter((_row, index) => bucket < 3 && index % 3 === bucket),
    )(
      'rejects %s',
      async (_label, imports, statement, declarations) => {
        const root = fixture('opaque-package');
        writeAttackPackage(root);
        writeApp(root, appSource(imports, statement, declarations));

        const result = await strictBuild(root);
        if (_label.startsWith('node:')) expectRejectedKv424(root, result);
        else expectOpaqueKv424(root, result);
      },
      120_000,
    );

    if (bucket === 3) {
      it('fails closed when globalThis.setTimeout is rebound', async () => {
        const root = fixture('rebound-set-timeout');
        writeAttackPackage(root);
        writeApp(
          root,
          appSource(
            "import { callback } from 'semantic-intrinsic-attacks';",
            `const original = globalThis;
         try {
           globalThis = { setTimeout() { callback(); } };
           globalThis.setTimeout(() => {}, 0);
         } finally { globalThis = original; }`,
          ),
        );

        const result = await strictBuild(root);
        expect(result, result.stderr).toMatchObject({ code: 1 });
        expect(result.stderr).toContain('ERROR KV424');
        expect(result.stderr).toContain('sink=setTimeout');
        expect(existsSync(join(root, 'dist'))).toBe(false);
      }, 120_000);

      it('rejects Proxy entry getters yielded into Object.fromEntries', async () => {
        const root = fixture('from-entries-proxy-entry');
        writeApp(
          root,
          appSource(
            "import { execFileSync } from 'node:child_process';",
            'Object.fromEntries(entries);',
            `const entry = new Proxy(['key', 'value'], {
  get(target, key, receiver) {
    execFileSync('/usr/bin/true');
    return Reflect.get(target, key, receiver);
  },
});
const entries = { *[Symbol.iterator]() { yield entry; } };`,
          ),
        );

        const result = await strictBuild(root);
        expectProcessKv424(root, result);
      }, 120_000);

      it('rejects thenables yielded into Array.fromAsync', async () => {
        const root = fixture('from-async-yielded-thenable');
        writeApp(
          root,
          appSource(
            "import { execFileSync } from 'node:child_process';",
            'Array.fromAsync(values);',
            `const thenable = {
  then(resolve) {
    execFileSync('/usr/bin/true');
    resolve('safe');
  },
};
const values = { async *[Symbol.asyncIterator]() { yield thenable; } };`,
          ),
        );

        const result = await strictBuild(root);
        expectProcessKv424(root, result);
      }, 120_000);

      it('rejects a Reflect.set receiver Proxy defineProperty trap', async () => {
        const root = fixture('reflect-set-receiver-proxy');
        writeApp(
          root,
          appSource(
            "import { execFileSync } from 'node:child_process';",
            "Reflect.set({}, 'value', 1, receiver);",
            `const receiver = new Proxy({}, {
  defineProperty(target, key, descriptor) {
    execFileSync('/usr/bin/true');
    return Reflect.defineProperty(target, key, descriptor);
  },
});`,
          ),
        );

        const result = await strictBuild(root);
        expectProcessKv424(root, result);
      }, 120_000);

      it('rejects a Reflect.construct newTarget Proxy prototype getter', async () => {
        const root = fixture('reflect-construct-new-target-proxy');
        writeApp(
          root,
          appSource(
            "import { execFileSync } from 'node:child_process';",
            'Reflect.construct(Target, [], newTarget);',
            `function Target() {}
function NewTarget() {}
const newTarget = new Proxy(NewTarget, {
  get(target, key, receiver) {
    if (key === 'prototype') execFileSync('/usr/bin/true');
    return Reflect.get(target, key, receiver);
  },
});`,
          ),
        );

        const result = await strictBuild(root);
        expectProcessKv424(root, result);
      }, 120_000);

      it('rejects an Array.concat indexed getter installed after initialization', async () => {
        const root = fixture('concat-index-getter');
        writeApp(
          root,
          appSource(
            "import { execFileSync } from 'node:child_process';",
            '[].concat(spreadable);',
            `const spreadable = { length: 1, [Symbol.isConcatSpreadable]: true };
Object.defineProperty(spreadable, '0', {
  get() { execFileSync('/usr/bin/true'); return 'safe'; },
});`,
          ),
        );

        const result = await strictBuild(root);
        expectProcessKv424(root, result);
      }, 120_000);

      it('rejects an indexed getter on an array returned from flatMap', async () => {
        const root = fixture('flat-map-returned-index');
        writeApp(
          root,
          appSource(
            "import { execFileSync } from 'node:child_process';",
            '[1].flatMap(() => returned);',
            `const returned = new Proxy(['safe'], {
  get(target, key, receiver) {
    if (key === '0') execFileSync('/usr/bin/true');
    return Reflect.get(target, key, receiver);
  },
});`,
          ),
        );

        const result = await strictBuild(root);
        expectProcessKv424(root, result);
      }, 120_000);

      it('rejects a dynamically installed ArrayBuffer maxByteLength getter', async () => {
        const root = fixture('array-buffer-options-getter');
        writeApp(
          root,
          appSource(
            "import { execFileSync } from 'node:child_process';",
            'new ArrayBuffer(8, options);',
            `const options = {};
Object.defineProperty(options, 'maxByteLength', {
  get() { execFileSync('/usr/bin/true'); return 8; },
});`,
          ),
        );

        const result = await strictBuild(root);
        expectProcessKv424(root, result);
      }, 120_000);

      it('rejects for-in Proxy ownKeys and descriptor traps', async () => {
        const root = fixture('for-in-proxy');
        writeApp(
          root,
          appSource(
            "import { execFileSync } from 'node:child_process';",
            'for (const key in source) void key;',
            `const source = new Proxy({ value: 'safe' }, {
  ownKeys(target) { execFileSync('/usr/bin/true'); return Reflect.ownKeys(target); },
  getOwnPropertyDescriptor(target, key) {
    execFileSync('/usr/bin/true');
    return Reflect.getOwnPropertyDescriptor(target, key);
  },
});`,
          ),
        );

        const result = await strictBuild(root);
        expectProcessKv424(root, result);
      }, 120_000);

      it('rejects Proxy prototype access during class heritage evaluation', async () => {
        const root = fixture('class-heritage-proxy');
        writeApp(
          root,
          appSource(
            "import { execFileSync } from 'node:child_process';",
            'class Child extends proxiedBase {} void Child;',
            `class Base {}
const proxiedBase = new Proxy(Base, {
  get(target, key, receiver) {
    if (key === 'prototype') execFileSync('/usr/bin/true');
    return Reflect.get(target, key, receiver);
  },
});`,
          ),
        );

        const result = await strictBuild(root);
        expectProcessKv424(root, result);
      }, 120_000);

      it('fails closed on a custom async iterator delegated through async yield*', async () => {
        const root = fixture('async-yield-star');
        writeApp(
          root,
          appSource(
            "import { execFileSync } from 'node:child_process';",
            'void delegate().next();',
            `const values = {
  [Symbol.asyncIterator]() {
    return {
      next() {
        execFileSync('/usr/bin/true');
        return Promise.resolve({ done: true, value: undefined });
      },
    };
  },
};
async function* delegate() { yield* values; }`,
          ),
        );

        const result = await strictBuild(root);
        expectOpaqueKv424(root, result);
      }, 120_000);

      it.each([
        ['getter', 'read() { return super.secret; }', 'void new Child().read();'],
        ['setter', 'write(value) { super.secret = value; }', "new Child().write('safe');"],
      ])(
        'rejects a base %s reached through a request-reachable super accessor',
        async (_label, method, statement) => {
          const root = fixture('super-accessor');
          writeApp(
            root,
            appSource(
              "import { execFileSync } from 'node:child_process';",
              statement,
              `class Base {
  get secret() { execFileSync('/usr/bin/true'); return 'safe'; }
  set secret(value) { execFileSync('/usr/bin/true'); void value; }
}
class Child extends Base { ${method} }`,
            ),
          );

          const result = await strictBuild(root);
          expectProcessKv424(root, result);
        },
        120_000,
      );

      it.each([
        ['intrinsic', 'const node = <div {...enumerable} />; void node;', ''],
        [
          'component',
          'const node = <Component {...enumerable} />; void node;',
          'function Component(props) { return <div>{props.value}</div>; }',
        ],
      ])(
        'rejects an opaque getter consumed by an %s JSX spread',
        async (_label, statement, declarations) => {
          const root = fixture('opaque-jsx-spread');
          writeAttackPackage(root);
          writeApp(
            root,
            appSource(
              "import { enumerable } from 'semantic-intrinsic-attacks';",
              statement,
              declarations,
            ),
            'app.tsx',
          );

          const result = await strictBuild(root, './app.tsx');
          expectOpaqueKv424(root, result);
        },
        120_000,
      );

      it.each([
        ['intrinsic', 'const node = <div {...source} />; void node;', ''],
        [
          'component',
          'const node = <Component {...source} />; void node;',
          'function Component(props) { return <div>{props.value}</div>; }',
        ],
      ])(
        'rejects a local getter consumed by an %s JSX spread',
        async (_label, statement, declarations) => {
          const root = fixture('local-jsx-spread');
          writeApp(
            root,
            appSource(
              "import { execFileSync } from 'node:child_process';",
              statement,
              `const source = {
  get value() { execFileSync('/usr/bin/true'); return 'safe'; },
};
${declarations}`,
            ),
            'app.tsx',
          );

          const result = await strictBuild(root, './app.tsx');
          expectProcessKv424(root, result);
        },
        120_000,
      );

      it('keeps the existing process traversal guard for local array element coercion', async () => {
        const root = fixture('array-join-element');
        writeApp(
          root,
          appSource(
            "import { execFileSync } from 'node:child_process';",
            "values.join(',');",
            `const values = [{
  toString() { execFileSync('/usr/bin/true'); return 'safe'; },
}];`,
          ),
        );

        const result = await strictBuild(root);
        expectProcessKv424(root, result);
      }, 120_000);

      it('accepts plain controls and rejects stronger-default boundary controls', async () => {
        const root = fixture('plain-controls');
        writeApp(
          root,
          appSource(
            '',
            `Object.groupBy(['safe'], (value) => value);
Object.values({ value: 'safe' });
Response.json({ nested: { value: 'safe' } }, { status: 200 });
new Headers({ 'x-test': 'safe' });
new URLSearchParams({ x: 'safe' });
new Response('safe', { statusText: 'safe' });
Response.json({ ok: true }, { headers: [['x-test', 'safe']] });
Math.max(1, 2);
String.raw({ raw: ['safe'] });
new Blob(['safe']);
['b', 'a'].sort(() => 0);
['b', 'a'].toSorted(() => 0);
'x'.replace('x', () => 'safe');
'x'.replaceAll('x', () => 'safe');
JSON.stringify({ value: 'safe' }, (_key, value) => value);
Promise.try(() => 'safe');
Array.fromAsync(['safe'], () => 'safe');
'abc'.includes('b');
[1, 2].slice(1);
[1, 2].join(',');
(1.25).toFixed(1);
'a'.localeCompare('b', 'en', { sensitivity: 'base' });
[].concat({ length: 1, 0: 'safe', [Symbol.isConcatSpreadable]: true });
[1].flatMap(() => ['safe']);
new ArrayBuffer(8, { maxByteLength: 8 });
new Uint8Array({ length: 1, 0: 1 });
Object.create(null, { x: { value: 'safe' } });
Object.defineProperties({}, { x: { value: 'safe' } });
Reflect.apply(localFunction, null, ['safe']);
Reflect.set({}, 'value', 1, {});
Reflect.construct(localFunction, [], localFunction);
Object.fromEntries([['key', 'value']]);
Array.fromAsync(['safe']);
void consume();
void returnsValue();
void fetch('data:,safe', { headers: [['x-test', 'safe']] });
void setTimeout(() => {}, 0);
void setInterval(() => {}, 1);
const proto = { get secret() { return 'safe'; } };
void Object.create(proto).secret;
const inherited = { __proto__: proto };
void inherited.secret;
const plain = { value: 'safe' };
Object.keys(plain);
Object.getOwnPropertyDescriptor(plain, 'value');
Object.getOwnPropertyDescriptors(plain);
Object.getPrototypeOf(plain);
Object.hasOwn(plain, 'value');
Object.isExtensible(plain);
Object.is(plain, plain);
['a', 'b'].join(',');
let numeric = 1;
++numeric;
numeric *= 2;
for (const key in { value: 'safe' }) void key;
void ({ value: 'safe' }).value;
readValue({ value: 'safe' });
const target = { value: 1 };
target.value = 2;
class Base {}
class Child extends Base {}
void Child;`,
            `function localFunction(value) { return value; }
function readValue({ value }) { return value; }
async function consume() { for await (const value of ['safe']) void value; }
async function returnsValue() { return 'safe'; }`,
          ),
        );

        const result = await strictBuild(root);
        expect(result, result.stderr).toMatchObject({ code: 0 });
        expect(result.stderr).not.toContain('ERROR KV424');
        expect(existsSync(join(root, 'dist'))).toBe(true);

        const rejectedRoot = fixture('stronger-default-controls');
        writeApp(
          rejectedRoot,
          appSource(
            `import assert from 'node:assert/strict';
import { Buffer as NodeBuffer } from 'node:buffer';
import querystring from 'node:querystring';
import * as nodeUrl from 'node:url';`,
            `assert.throws(() => { throw new Error('expected'); });
querystring.parse('x=y', '&', '=', { decodeURIComponent });
NodeBuffer.from('safe');
NodeBuffer.from([1, 2]);
nodeUrl.format({ protocol: 'https:', host: 'example.test', pathname: '/' });
JSON.rawJSON('1');
global.JSON.stringify({ safe: true });
globalThis.Math.abs(-1);
void globalThis.fetch('data:,safe');
globalThis.queueMicrotask(() => {});`,
          ),
        );

        const rejected = await strictBuild(rejectedRoot);
        expectRejectedKv424(rejectedRoot, rejected);
        for (const sink of [
          'sink=node:assert/strict.throws',
          'sink=node:querystring.parse',
          'sink=node:buffer.Buffer',
          'sink=node:url.format',
          'source=JSON.rawJSON',
          'source=global.JSON.stringify',
          'source=globalThis.Math.abs',
          'source=globalThis.fetch',
          'source=globalThis.queueMicrotask',
        ]) {
          expect(rejected.stderr).toContain(sink);
        }
      }, 120_000);

      it('accepts plain JSX spreads through the emitted build', async () => {
        const root = fixture('plain-tsx-controls');
        writeApp(
          root,
          appSource(
            '',
            `const source = { value: 'safe' };
         const intrinsic = <div {...source} />;
         const component = <Component {...source} />;
         void intrinsic;
         void component;`,
            `function Component(props) { return <div>{props.value}</div>; }`,
          ),
          'app.tsx',
        );

        const result = await strictBuild(root, './app.tsx');
        expect(result, result.stderr).toMatchObject({ code: 0 });
        expect(result.stderr).not.toContain('ERROR KV424');
        expect(existsSync(join(root, 'dist'))).toBe(true);
      }, 120_000);
    }
  });
}
