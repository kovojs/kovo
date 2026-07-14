import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import nodeQuerystring from 'node:querystring';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { mainAsync } from '../index.js';

const repoRoot = process.cwd();
const roots: string[] = [];
const originalQuerystringEscape = nodeQuerystring.escape;

afterEach(() => {
  vi.restoreAllMocks();
  nodeQuerystring.escape = originalQuerystringEscape;
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function fixture(name: string): string {
  const root = mkdtempSync(join(repoRoot, `.tmp-kovo-round2-${name}-`));
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

function writeApp(root: string, source: string, entry = 'app.mjs'): string {
  writeFileSync(join(root, entry), source, 'utf8');
  return `./${entry}`;
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

function expectKv424(
  root: string,
  result: { code: number; stderr: string },
  sink: string | RegExp,
): void {
  expect(result, result.stderr).toMatchObject({ code: 1 });
  expect(result.stderr).toContain('ERROR KV424');
  if (typeof sink === 'string') expect(result.stderr).toContain(`sink=${sink}`);
  else expect(result.stderr).toMatch(sink);
  expect(existsSync(join(root, 'dist'))).toBe(false);
}

function expectKv424Source(
  root: string,
  result: { code: number; stderr: string },
  sink: string,
  source: string,
): void {
  expectKv424(root, result, sink);
  expect(result.stderr).toContain(`source='${source}'`);
}

const rawProcessSink = 'child_process.execFileSync';
const authorizationSink = 'client-wire.request.header.Authorization';

// @kovo-security-certifies KV424 request-root-provenance-round2-build
describe('kovo build KV424 strict request-root provenance corpus', () => {
  it('rejects a route hidden in an unresolved createApp aggregate', async () => {
    const root = fixture('unresolved-create-app');
    writePackage(
      root,
      'external-route-aggregate',
      `import { execFileSync } from 'node:child_process';
export function makeRoutes(route, publicAccess) {
  return [route('/unsafe', {
    access: publicAccess('external aggregate audit'),
    page() { execFileSync('/usr/bin/true'); return 'safe'; },
  })];
}
`,
    );
    const entry = writeApp(
      root,
      `import { makeRoutes } from 'external-route-aggregate';
import { createApp, publicAccess, route } from '@kovojs/server';
export default createApp({ routes: makeRoutes(route, publicAccess) });
`,
    );

    const result = await strictBuild(root, entry);
    expectKv424(
      root,
      result,
      /sink=(?:request-handler\.opaque-source|child_process\.execFileSync)/u,
    );
  }, 120_000);

  it('rejects a route factory laundered through a mutable Map', async () => {
    const root = fixture('mutable-map-factory');
    const entry = writeApp(
      root,
      `import { execFileSync } from 'node:child_process';
import { createApp, publicAccess, route } from '@kovojs/server';
const factories = new Map();
factories.set('route', route);
const hiddenRoute = factories.get('route');
const unsafe = hiddenRoute('/unsafe', {
  access: publicAccess('mutable factory audit'),
  page() { execFileSync('/usr/bin/true'); return 'safe'; },
});
export default createApp({ routes: [unsafe] });
`,
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, rawProcessSink);
  }, 120_000);

  it('rejects inherited Object.create coercion authority', async () => {
    const root = fixture('object-create-protocol');
    const entry = writeApp(
      root,
      `import { execFileSync } from 'node:child_process';
import { createApp, publicAccess, route } from '@kovojs/server';
const proto = {
  toString() { execFileSync('/usr/bin/true'); return 'safe'; },
};
const authored = Object.create(proto);
const unsafe = route('/unsafe', {
  access: publicAccess('Object.create protocol audit'),
  page() { return \`value=\${authored}\`; },
});
export default createApp({ routes: [unsafe] });
`,
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, rawProcessSink);
  }, 120_000);

  it('rejects process authority invoked through a tagged template', async () => {
    const root = fixture('tagged-template');
    const entry = writeApp(
      root,
      `import { execFileSync } from 'node:child_process';
import { createApp, publicAccess, route } from '@kovojs/server';
function runTag() { execFileSync('/usr/bin/true'); return 'safe'; }
const unsafe = route('/unsafe', {
  access: publicAccess('tagged template audit'),
  page() { return runTag\`ignored\`; },
});
export default createApp({ routes: [unsafe] });
`,
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, rawProcessSink);
  }, 120_000);

  it('rejects process authority invoked by explicit resource disposal', async () => {
    const root = fixture('using-dispose');
    const entry = writeApp(
      root,
      `import { execFileSync } from 'node:child_process';
import { createApp, publicAccess, route } from '@kovojs/server';
const resource = {
  [Symbol.dispose]() { execFileSync('/usr/bin/true'); },
};
const unsafe = route('/unsafe', {
  access: publicAccess('using protocol audit'),
  page() {
    { using lease = resource; void lease; }
    return 'safe';
  },
});
export default createApp({ routes: [unsafe] });
`,
      'app.ts',
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, rawProcessSink);
  }, 120_000);

  it('rejects a pre-snapshot mutation performed by a hoisted later helper', async () => {
    const root = fixture('temporal-helper');
    const entry = writeApp(
      root,
      `import { execFileSync } from 'node:child_process';
import { createApp, publicAccess, route } from '@kovojs/server';
const config = { access: publicAccess('temporal helper audit') };
install();
const unsafe = route('/unsafe', config);
export default createApp({ routes: [unsafe] });
function install() {
  config.page = () => { execFileSync('/usr/bin/true'); return 'safe'; };
}
`,
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, rawProcessSink);
  }, 120_000);

  it('rejects interprocedural mutation of a route config', async () => {
    const root = fixture('interprocedural-config');
    const entry = writeApp(
      root,
      `import { execFileSync } from 'node:child_process';
import { createApp, publicAccess, route } from '@kovojs/server';
const config = { access: publicAccess('interprocedural config audit') };
const unsafePage = () => { execFileSync('/usr/bin/true'); return 'safe'; };
function install(target) { target.page = unsafePage; }
install(config);
const unsafe = route('/unsafe', config);
export default createApp({ routes: [unsafe] });
`,
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, rawProcessSink);
  }, 120_000);

  it('rejects route factory identity hidden behind nested named barrels', async () => {
    const root = fixture('factory-barrel');
    writeFileSync(
      join(root, 'route-root.ts'),
      "export { route as hiddenRoute } from '@kovojs/server';\n",
      'utf8',
    );
    writeFileSync(
      join(root, 'route-barrel.ts'),
      "export { hiddenRoute } from './route-root.js';\n",
      'utf8',
    );
    const entry = writeApp(
      root,
      `import { execFileSync } from 'node:child_process';
import { createApp, publicAccess } from '@kovojs/server';
import { hiddenRoute } from './route-barrel.js';
const unsafe = hiddenRoute('/unsafe', {
  access: publicAccess('barrel factory audit'),
  page() { execFileSync('/usr/bin/true'); return 'safe'; },
});
export default createApp({ routes: [unsafe] });
`,
      'app.ts',
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, rawProcessSink);
  }, 120_000);

  it('rejects route invocation through an aliased Reflect.apply adapter', async () => {
    const root = fixture('reflect-apply-factory');
    const entry = writeApp(
      root,
      `import { execFileSync } from 'node:child_process';
import { createApp, publicAccess, route } from '@kovojs/server';
const invoke = Reflect.apply;
const unsafe = invoke(route, undefined, ['/unsafe', {
  access: publicAccess('Reflect.apply factory audit'),
  page() { execFileSync('/usr/bin/true'); return 'safe'; },
}]);
export default createApp({ routes: [unsafe] });
`,
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, rawProcessSink);
  }, 120_000);

  it('rejects a route factory stored in a class static field', async () => {
    const root = fixture('class-factory');
    const entry = writeApp(
      root,
      `import { execFileSync } from 'node:child_process';
import { createApp, publicAccess, route } from '@kovojs/server';
class Registry { static factory = route; }
const unsafe = Registry.factory('/unsafe', {
  access: publicAccess('class factory audit'),
  page() { execFileSync('/usr/bin/true'); return 'safe'; },
});
export default createApp({ routes: [unsafe] });
`,
      'app.ts',
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, rawProcessSink);
  }, 120_000);

  it('rejects a route factory wrapped in a Proxy', async () => {
    const root = fixture('proxy-factory');
    const entry = writeApp(
      root,
      `import { execFileSync } from 'node:child_process';
import { createApp, publicAccess, route } from '@kovojs/server';
const hiddenRoute = new Proxy(route, {});
const unsafe = hiddenRoute('/unsafe', {
  access: publicAccess('Proxy factory audit'),
  page() { execFileSync('/usr/bin/true'); return 'safe'; },
});
export default createApp({ routes: [unsafe] });
`,
    );

    const result = await strictBuild(root, entry);
    expectKv424(
      root,
      result,
      /sink=(?:request-handler\.opaque-source|child_process\.execFileSync)/u,
    );
  }, 120_000);
});

// @kovo-security-certifies KV424 request-wire-round2-build
describe('kovo build KV424 strict request-wire corpus', () => {
  it('rejects Authorization returned through thenable assimilation', async () => {
    const root = fixture('thenable-wire');
    const entry = writeApp(
      root,
      `import { createApp, publicAccess, query, route } from '@kovojs/server';
let currentRequest;
const authoredThenable = {
  then(resolve) { resolve(currentRequest.headers.get('authorization')); },
};
export const leak = query({
  access: publicAccess('thenable wire audit'),
  async load(_input, { request }) {
    currentRequest = request;
    return await authoredThenable;
  },
});
export default createApp({
  queries: [leak],
  routes: [route('/', { access: publicAccess('fixture'), page: () => 'safe' })],
});
`,
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, authorizationSink);
  }, 120_000);

  it('rejects Authorization transferred through a custom iterator binding', async () => {
    const root = fixture('iterator-wire');
    const entry = writeApp(
      root,
      `import { createApp, publicAccess, query, route } from '@kovojs/server';
export const leak = query({
  access: publicAccess('iterator wire audit'),
  load(_input, { request }) {
    const authored = {
      *[Symbol.iterator]() { yield request.headers.get('authorization'); },
    };
    for (const token of authored) return token;
    return null;
  },
});
export default createApp({
  queries: [leak],
  routes: [route('/', { access: publicAccess('fixture'), page: () => 'safe' })],
});
`,
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, authorizationSink);
  }, 120_000);

  it('rejects Authorization returned from a collection callback', async () => {
    const root = fixture('callback-wire');
    const entry = writeApp(
      root,
      `import { createApp, publicAccess, query, route } from '@kovojs/server';
export const leak = query({
  access: publicAccess('callback wire audit'),
  load(_input, { request }) {
    const token = request.headers.get('authorization');
    return [0].map(() => token);
  },
});
export default createApp({
  queries: [leak],
  routes: [route('/', { access: publicAccess('fixture'), page: () => 'safe' })],
});
`,
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, authorizationSink);
  }, 120_000);

  it('rejects Authorization exposed by an instance-assigned toJSON method', async () => {
    const root = fixture('to-json-wire');
    const entry = writeApp(
      root,
      `import { createApp, publicAccess, query, route } from '@kovojs/server';
class Box {}
export const leak = query({
  access: publicAccess('toJSON wire audit'),
  load(_input, { request }) {
    const box = new Box();
    box.toJSON = () => ({ token: request.headers.get('authorization') });
    return box;
  },
});
export default createApp({
  queries: [leak],
  routes: [route('/', { access: publicAccess('fixture'), page: () => 'safe' })],
});
`,
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, authorizationSink);
  }, 120_000);

  it('rejects Authorization transferred through a catch binding', async () => {
    const root = fixture('catch-wire');
    const entry = writeApp(
      root,
      `import { createApp, publicAccess, query, route } from '@kovojs/server';
export const leak = query({
  access: publicAccess('catch binding wire audit'),
  load(_input, { request }) {
    try {
      throw request.headers.get('authorization');
    } catch (caught) {
      return caught;
    }
  },
});
export default createApp({
  queries: [leak],
  routes: [route('/', { access: publicAccess('fixture'), page: () => 'safe' })],
});
`,
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, authorizationSink);
  }, 120_000);

  it('rejects request-triggered process authority in a module class field initializer', async () => {
    const root = fixture('module-class-process');
    const entry = writeApp(
      root,
      `import { execFileSync } from 'node:child_process';
import { createApp, publicAccess, route } from '@kovojs/server';
let currentProgram = '/usr/bin/true';
class Runner { result = execFileSync(currentProgram); }
const unsafe = route('/unsafe', {
  access: publicAccess('module class field process audit'),
  page() {
    currentProgram = '/usr/bin/true';
    new Runner();
    return 'safe';
  },
});
export default createApp({ routes: [unsafe] });
`,
      'app.ts',
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, rawProcessSink);
  }, 120_000);

  it('rejects Authorization read by a module class field initializer', async () => {
    const root = fixture('module-class-wire');
    const entry = writeApp(
      root,
      `import { createApp, publicAccess, query, route } from '@kovojs/server';
let currentRequest;
class Box { value = currentRequest.headers.get('authorization'); }
export const leak = query({
  access: publicAccess('module class field wire audit'),
  load(_input, { request }) {
    currentRequest = request;
    return new Box().value;
  },
});
export default createApp({
  queries: [leak],
  routes: [route('/', { access: publicAccess('fixture'), page: () => 'safe' })],
});
`,
      'app.ts',
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, authorizationSink);
  }, 120_000);
});

// @kovo-security-certifies KV424 request-jsx-round2-build
describe('kovo build KV424 strict JSX and component corpus', () => {
  it('rejects Authorization rendered as an intrinsic JSX child', async () => {
    const root = fixture('jsx-intrinsic-wire');
    const entry = writeApp(
      root,
      `/** @jsxImportSource @kovojs/server */
import { createApp, publicAccess, route } from '@kovojs/server';
const leak = route('/leak', {
  access: publicAccess('JSX intrinsic wire audit'),
  page(_context, request) {
    return <div>{request.headers.get('authorization')}</div>;
  },
});
export default createApp({ routes: [leak] });
`,
      'app.tsx',
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, authorizationSink);
  }, 120_000);

  it('rejects process authority in a local JSX component body', async () => {
    const root = fixture('jsx-local-process');
    const entry = writeApp(
      root,
      `/** @jsxImportSource @kovojs/server */
import { execFileSync } from 'node:child_process';
import { createApp, publicAccess, route } from '@kovojs/server';
function DangerousComponent() {
  execFileSync('/usr/bin/true');
  return <div>done</div>;
}
const unsafe = route('/unsafe', {
  access: publicAccess('local JSX component process audit'),
  page() { return <DangerousComponent />; },
});
export default createApp({ routes: [unsafe] });
`,
      'app.tsx',
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, rawProcessSink);
  }, 120_000);

  it('rejects Authorization read in a local JSX component body', async () => {
    const root = fixture('jsx-local-wire');
    const entry = writeApp(
      root,
      `/** @jsxImportSource @kovojs/server */
import { createApp, publicAccess, route } from '@kovojs/server';
let currentRequest;
function LeakComponent() {
  return <div>{currentRequest.headers.get('authorization')}</div>;
}
const leak = route('/leak', {
  access: publicAccess('local JSX component wire audit'),
  page(_context, request) {
    currentRequest = request;
    return <LeakComponent />;
  },
});
export default createApp({ routes: [leak] });
`,
      'app.tsx',
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, authorizationSink);
  }, 120_000);

  it('fails closed on process authority in an ordinary-package JSX component', async () => {
    const root = fixture('jsx-external-process');
    writePackage(
      root,
      'external-component',
      `import { execFileSync } from 'node:child_process';
export function ExternalComponent() {
  execFileSync('/usr/bin/true');
  return 'done';
}
`,
    );
    const entry = writeApp(
      root,
      `/** @jsxImportSource @kovojs/server */
import { ExternalComponent } from 'external-component';
import { createApp, publicAccess, route } from '@kovojs/server';
const unsafe = route('/unsafe', {
  access: publicAccess('external JSX component process audit'),
  page() { return <ExternalComponent />; },
});
export default createApp({ routes: [unsafe] });
`,
      'app.tsx',
    );

    const result = await strictBuild(root, entry);
    expectKv424(
      root,
      result,
      /sink=(?:request-handler\.opaque-source|child_process\.execFileSync)/u,
    );
  }, 120_000);

  it('fails closed on Authorization passed to an ordinary-package JSX component', async () => {
    const root = fixture('jsx-external-wire');
    writePackage(
      root,
      'external-component',
      `export function ExternalComponent({ value }) { return value; }\n`,
    );
    const entry = writeApp(
      root,
      `/** @jsxImportSource @kovojs/server */
import { ExternalComponent } from 'external-component';
import { createApp, publicAccess, route } from '@kovojs/server';
const leak = route('/leak', {
  access: publicAccess('external JSX component wire audit'),
  page(_context, request) {
    return <ExternalComponent value={request.headers.get('authorization')} />;
  },
});
export default createApp({ routes: [leak] });
`,
      'app.tsx',
    );

    const result = await strictBuild(root, entry);
    expectKv424(
      root,
      result,
      /sink=(?:request-handler\.opaque-source|client-wire\.request\.header\.Authorization)/u,
    );
  }, 120_000);

  it('rejects process authority added by a class decorator replacement', async () => {
    const root = fixture('decorator-constructor');
    writeFileSync(
      join(root, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            experimentalDecorators: true,
            noCheck: true,
            skipLibCheck: true,
            strict: false,
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    const entry = writeApp(
      root,
      `import { execFileSync } from 'node:child_process';
import { createApp, publicAccess, route } from '@kovojs/server';
function dangerousDecorator(value) {
  return class extends value {
    constructor(...args) {
      super(...args);
      execFileSync('/usr/bin/true');
    }
  };
}
@dangerousDecorator
class Runner {}
const unsafe = route('/unsafe', {
  access: publicAccess('decorated constructor process audit'),
  page() { new Runner(); return 'safe'; },
});
export default createApp({ routes: [unsafe] });
`,
      'app.ts',
    );

    const result = await strictBuild(root, entry);
    expectKv424(
      root,
      result,
      /sink=(?:request-handler\.opaque-constructor|request-handler\.opaque-source|child_process\.execFileSync)/u,
    );
  }, 120_000);
});

// SPEC §2 and §6.6 require these real builds to reject every unproven request authority edge.
// @kovo-security-certifies KV424 remaining-implicit-protocol-build
describe('kovo build KV424 strict remaining implicit-protocol corpus', () => {
  it('rejects Authorization returned through Object.fromEntries custom iteration', async () => {
    const root = fixture('from-entries-iterator-wire');
    const entry = writeApp(
      root,
      `import { createApp, publicAccess, query, route } from '@kovojs/server';
export const leak = query({
  access: publicAccess('Object.fromEntries iterator wire audit'),
  load(_input, { request }) {
    const entries = {
      *[Symbol.iterator]() {
        yield ['token', request.headers.get('authorization')];
      },
    };
    return Object.fromEntries(entries);
  },
});
export default createApp({
  queries: [leak],
  routes: [route('/', { access: publicAccess('fixture'), page: () => 'safe' })],
});
`,
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, authorizationSink);
  }, 120_000);

  it('rejects Authorization returned through Array.fromAsync custom iteration', async () => {
    const root = fixture('from-async-iterator-wire');
    const entry = writeApp(
      root,
      `import { createApp, publicAccess, query, route } from '@kovojs/server';
export const leak = query({
  access: publicAccess('Array.fromAsync iterator wire audit'),
  async load(_input, { request }) {
    const values = {
      async *[Symbol.asyncIterator]() {
        yield request.headers.get('authorization');
      },
    };
    return await Array.fromAsync(values);
  },
});
export default createApp({
  queries: [leak],
  routes: [route('/', { access: publicAccess('fixture'), page: () => 'safe' })],
});
`,
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, authorizationSink);
  }, 120_000);

  it.each([
    ['object spread', '', 'return { ...dangerous };', 'proxy-object-spread'],
    [
      'object rest destructuring',
      '',
      'const { ...result } = dangerous; return result;',
      'proxy-object-rest',
    ],
    ['Object.assign source', '', 'return Object.assign({}, dangerous);', 'proxy-object-assign'],
    ['JSON.stringify', '', 'return JSON.stringify(dangerous);', 'proxy-json-stringify'],
    ['Response.json', '', 'return Response.json(dangerous);', 'proxy-response-json'],
    [
      'querystring.stringify',
      "import querystring from 'node:querystring';",
      'return querystring.stringify(dangerous);',
      'proxy-querystring-stringify',
    ],
  ])(
    'rejects process Proxy traps reached through %s',
    async (_label, extraImport, operation, marker) => {
      const root = fixture(`proxy-consumer-${marker}`);
      const entry = writeApp(
        root,
        `import { execFileSync } from 'node:child_process';
${extraImport}
import { createApp, publicAccess, route } from '@kovojs/server';
const dangerous = new Proxy({ value: 'safe' }, {
  get(target, key, receiver) {
    if (key === 'toJSON') execFileSync('/usr/bin/true');
    return Reflect.get(target, key, receiver);
  },
  ownKeys(target) {
    execFileSync('/usr/bin/true');
    return Reflect.ownKeys(target);
  },
});
const unsafe = route('/', {
  access: publicAccess('Proxy consumer audit'),
  page() { ${operation} },
});
export default createApp({ routes: [unsafe] });
`,
      );

      const result = await strictBuild(root, entry);
      if (marker === 'proxy-querystring-stringify') {
        expectKv424(root, result, 'node:querystring.stringify');
      } else {
        expectKv424Source(root, result, rawProcessSink, '/usr/bin/true');
      }
    },
    120_000,
  );

  it('rejects an authored iterator reached by destructuring assignment', async () => {
    const root = fixture('destructuring-assignment-iterator');
    const entry = writeApp(
      root,
      `import { execFileSync } from 'node:child_process';
import { createApp, publicAccess, route } from '@kovojs/server';
const dangerousIterable = {
  [Symbol.iterator]() {
    execFileSync('/usr/bin/true');
    return ['safe'][Symbol.iterator]();
  },
};
const unsafe = route('/', {
  access: publicAccess('destructuring assignment iterator audit'),
  page() {
    let value;
    [value] = dangerousIterable;
    return value;
  },
});
export default createApp({ routes: [unsafe] });
`,
    );

    const result = await strictBuild(root, entry);
    expectKv424Source(root, result, rawProcessSink, '/usr/bin/true');
  }, 120_000);

  it('rejects a mutable querystring.escape replacement used by stringify', async () => {
    const root = fixture('querystring-escape-replacement');
    const entry = writeApp(
      root,
      `import { execFileSync } from 'node:child_process';
import querystring from 'node:querystring';
import { createApp, publicAccess, route } from '@kovojs/server';
const originalEscape = querystring.escape;
querystring.escape = (value) => {
  execFileSync('/usr/bin/true');
  return originalEscape(value);
};
const unsafe = route('/', {
  access: publicAccess('querystring escape mutation audit'),
  page() { return querystring.stringify({ value: 'safe' }); },
});
export default createApp({ routes: [unsafe] });
`,
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, 'node:querystring.stringify');
  }, 120_000);

  it('rejects input prototype laundering through a Proxy before input.toString()', async () => {
    const root = fixture('input-prototype-proxy');
    const entry = writeApp(
      root,
      `import { execFileSync } from 'node:child_process';
import { createApp, publicAccess, query, route } from '@kovojs/server';
const dangerousPrototype = new Proxy(Object.prototype, {
  get(target, key, receiver) {
    if (key === 'toString') {
      return () => {
        execFileSync('/usr/bin/true');
        return 'safe';
      };
    }
    return Reflect.get(target, key, receiver);
  },
});
export const unsafe = query({
  access: publicAccess('input prototype Proxy audit'),
  load(input) {
    Object.setPrototypeOf(input, dangerousPrototype);
    return input.toString();
  },
});
export default createApp({
  queries: [unsafe],
  routes: [route('/', { access: publicAccess('fixture'), page: () => 'safe' })],
});
`,
    );

    const result = await strictBuild(root, entry);
    expectKv424Source(root, result, rawProcessSink, '/usr/bin/true');
  }, 120_000);

  it('rejects console.log after an opaque helper can poison console output', async () => {
    const root = fixture('opaque-console-poison');
    writePackage(
      root,
      'opaque-console-poison',
      `import { execFileSync } from 'node:child_process';
export function poisonConsole(consoleObject) {
  const original = consoleObject._stdout;
  consoleObject._stdout = new Proxy(original, {
    get(target, key, receiver) {
      if (key === 'write') {
        return (...args) => {
          execFileSync('/usr/bin/true');
          return target.write(...args);
        };
      }
      return Reflect.get(target, key, receiver);
    },
  });
  return () => { consoleObject._stdout = original; };
}
`,
    );
    const entry = writeApp(
      root,
      `import { poisonConsole } from 'opaque-console-poison';
import { createApp, publicAccess, route } from '@kovojs/server';
const unsafe = route('/', {
  access: publicAccess('opaque console mutation audit'),
  page() {
    const restore = poisonConsole(console);
    try {
      console.log('safe');
      return 'safe';
    } finally {
      restore();
    }
  },
});
export default createApp({ routes: [unsafe] });
`,
    );

    const result = await strictBuild(root, entry);
    expectKv424(root, result, /sink=request-handler\.opaque-call source=console\.log/u);
  }, 120_000);

  it('rejects a process callback reached through Promise.resolve(...).then', async () => {
    const root = fixture('promise-then-callback');
    const entry = writeApp(
      root,
      `import { execFileSync } from 'node:child_process';
import { createApp, publicAccess, query, route } from '@kovojs/server';
export const unsafe = query({
  access: publicAccess('Promise.then callback audit'),
  async load() {
    return await Promise.resolve('safe').then((value) => {
      execFileSync('/usr/bin/true');
      return value;
    });
  },
});
export default createApp({
  queries: [unsafe],
  routes: [route('/', { access: publicAccess('fixture'), page: () => 'safe' })],
});
`,
    );

    const result = await strictBuild(root, entry);
    expectKv424Source(root, result, rawProcessSink, '/usr/bin/true');
  }, 120_000);

  it.each([
    [
      'direct descriptor replacement',
      `const promise = Promise.resolve('safe');
       Object.defineProperty(promise, 'then', {
         value(onFulfilled) {
           execFileSync('/usr/bin/true');
           return Promise.resolve(onFulfilled('safe'));
         },
       });`,
    ],
    [
      'helper-installed descriptor replacement',
      `function install(promise) {
         Object.defineProperty(promise, 'then', {
           value(onFulfilled) {
             execFileSync('/usr/bin/true');
             return Promise.resolve(onFulfilled('safe'));
           },
         });
       }
       const promise = Promise.resolve('safe');
       install(promise);`,
    ],
    [
      'constructor-installed descriptor replacement',
      `class InstallThen {
         constructor(promise) {
           Object.defineProperty(promise, 'then', {
             value(onFulfilled) {
               execFileSync('/usr/bin/true');
               return Promise.resolve(onFulfilled('safe'));
             },
           });
         }
       }
       const promise = Promise.resolve('safe');
       new InstallThen(promise);`,
    ],
    [
      'tag-installed descriptor replacement',
      `function installThen(_parts, promise) {
         Object.defineProperty(promise, 'then', {
           value(onFulfilled) {
             execFileSync('/usr/bin/true');
             return Promise.resolve(onFulfilled('safe'));
           },
         });
         return promise;
       }
       const nativePromise = Promise.resolve('safe');
       const promise = installThen\`install:\${nativePromise}\`;`,
    ],
  ])(
    'rejects a hostile Promise own then via %s',
    async (_label, setup) => {
      const root = fixture(`promise-own-then-${_label.replaceAll(/[^a-z]+/giu, '-')}`);
      const entry = writeApp(
        root,
        `import { execFileSync } from 'node:child_process';
import { createApp, publicAccess, query, route } from '@kovojs/server';
export const unsafe = query({
  access: publicAccess('hostile Promise own then audit'),
  async load() {
    ${setup}
    return await promise.then((value) => value);
  },
});
export default createApp({
  queries: [unsafe],
  routes: [route('/', { access: publicAccess('fixture'), page: () => 'safe' })],
});
`,
      );

      const result = await strictBuild(root, entry);
      expectKv424Source(root, result, rawProcessSink, '/usr/bin/true');
    },
    120_000,
  );

  it('rejects a hostile Promise own then installed by a local JSX component', async () => {
    const root = fixture('promise-own-then-jsx');
    const entry = writeApp(
      root,
      `/** @jsxImportSource @kovojs/server */
import { execFileSync } from 'node:child_process';
import { createApp, publicAccess, route } from '@kovojs/server';
function InstallThen({ promise }) {
  Object.defineProperty(promise, 'then', {
    value(onFulfilled) {
      execFileSync('/usr/bin/true');
      return Promise.resolve(onFulfilled('safe'));
    },
  });
  return <span>installed</span>;
}
const unsafe = route('/', {
  access: publicAccess('hostile Promise JSX audit'),
  async page() {
    const promise = Promise.resolve('safe');
    const view = <InstallThen promise={promise} />;
    await promise.then((value) => value);
    return view;
  },
});
export default createApp({ routes: [unsafe] });
`,
      'app.tsx',
    );

    const result = await strictBuild(root, entry);
    expectKv424Source(root, result, rawProcessSink, '/usr/bin/true');
  }, 120_000);

  it.each([
    [
      'aliased plain-array spread',
      `const values = ['safe'];
        const alias = values;
        return [...alias].join(',');`,
    ],
    [
      'local generator spread',
      `function* values() { yield 'safe'; }
        return [...values()].join(',');`,
    ],
    [
      'plain Promise.resolve(...).then projection',
      `return await Promise.resolve('safe').then((value) => value);`,
    ],
  ])(
    'accepts %s',
    async (_label, body) => {
      const root = fixture(`protocol-precision-${_label.replaceAll(/[^a-z]+/giu, '-')}`);
      const entry = writeApp(
        root,
        `import { createApp, publicAccess, route } from '@kovojs/server';
const safe = route('/', {
  access: publicAccess('reviewed protocol precision audit'),
  async page() {
    ${body}
  },
});
export default createApp({ routes: [safe] });
`,
      );

      const result = await strictBuild(root, entry);
      expect(result, result.stderr).toMatchObject({ code: 0 });
      expect(result.stderr).not.toContain('ERROR KV424');
      expect(existsSync(join(root, 'dist'))).toBe(true);
    },
    120_000,
  );
});

describe('kovo build KV424 strict round-two precision corpus', () => {
  it.each([
    [
      'local Array mutation',
      `const values = [];
        values.push('safe');
        return values[0];`,
    ],
    [
      'local Map mutation',
      `const values = new Map();
        values.set('key', 'safe');
        return values.get('key');`,
    ],
    [
      'local URLSearchParams mutation',
      `const values = new URLSearchParams();
        values.append('key', 'safe');
        return values.toString();`,
    ],
  ])(
    'accepts benign %s in a request handler',
    async (_label, body) => {
      const root = fixture(`precision-${_label.replaceAll(' ', '-').toLowerCase()}`);
      const entry = writeApp(
        root,
        `import { createApp, publicAccess, route } from '@kovojs/server';
const safe = route('/', {
  access: publicAccess('reviewed local data precision audit'),
  page() {
    ${body}
  },
});
export default createApp({ routes: [safe] });
`,
      );

      const result = await strictBuild(root, entry);
      expect(result, result.stderr).toMatchObject({ code: 0 });
      expect(result.stderr).not.toContain('ERROR KV424');
      expect(existsSync(join(root, 'dist'))).toBe(true);
    },
    120_000,
  );

  it('accepts reviewed JSX and plain local data', async () => {
    const root = fixture('precision-jsx');
    const entry = writeApp(
      root,
      `/** @jsxImportSource @kovojs/server */
import { createApp, publicAccess, route } from '@kovojs/server';
function Reviewed({ value }) { return <span>{value}</span>; }
const safe = route('/', {
  access: publicAccess('reviewed JSX precision audit'),
  page() {
    const data = { value: 'safe' };
    return <Reviewed {...data} />;
  },
});
export default createApp({ routes: [safe] });
`,
      'app.tsx',
    );

    const result = await strictBuild(root, entry);
    expect(result, result.stderr).toMatchObject({ code: 0 });
    expect(result.stderr).not.toContain('ERROR KV424');
    expect(existsSync(join(root, 'dist'))).toBe(true);
  }, 120_000);
});
