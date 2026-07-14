import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  const root = mkdtempSync(join(repoRoot, `.tmp-kovo-process-audit-${name}-`));
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

async function check(
  root: string,
  entry = './app.mjs',
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const before = process.cwd();
  try {
    process.chdir(root);
    const code = await mainAsync(['build', entry, '--out', './dist', '--check']);
    return {
      code,
      stdout: stdout.mock.calls.map(([chunk]) => String(chunk)).join(''),
      stderr: stderr.mock.calls.map(([chunk]) => String(chunk)).join(''),
    };
  } finally {
    process.chdir(before);
  }
}

function expectTypechecks(root: string, entry: string): void {
  const result = spawnSync(
    process.execPath,
    [
      join(repoRoot, 'node_modules/typescript/bin/tsc'),
      '--allowImportingTsExtensions',
      '--ignoreConfig',
      '--lib',
      'ES2022,DOM,DOM.Iterable',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--noEmit',
      '--skipLibCheck',
      '--strict',
      '--target',
      'ES2022',
      entry,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}

// @kovo-security-certifies KV424 request-process-local-build
// @kovo-security-certifies KV424 request-process-package-build
// @kovo-security-certifies KV424 request-raw-authority-build
// @kovo-security-certifies KV424 request-wire-confidentiality-build
describe('kovo build KV424 request process-sink preflight', () => {
  it('rejects a local mutation child_process sink before artifact emission', async () => {
    const root = fixture('local');
    writeFileSync(
      join(root, 'app.mjs'),
      `import { execFileSync } from 'node:child_process';
import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';

export const hiddenMutation = mutation({
  access: publicAccess('local process authority audit'),
  input: s.object({ value: s.string() }),
  handler(input) {
    execFileSync(input.value);
    return { value: input.value };
  },
});

export default createApp({
  mutations: [hiddenMutation],
  routes: [route('/', { access: publicAccess('authority audit'), page: () => 'safe' })],
});
`,
      'utf8',
    );

    const result = await check(root);
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain('sink=child_process.execFileSync');
  }, 120_000);

  it('fails closed when a mutation handler is imported from an ordinary package', async () => {
    const root = fixture('dependency');
    const pkg = join(root, 'node_modules/external-actions');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({ name: 'external-actions', type: 'module', exports: './index.mjs' }),
      'utf8',
    );
    writeFileSync(
      join(pkg, 'index.mjs'),
      `import { execFileSync } from 'node:child_process';
export function hiddenHandler(input) {
  execFileSync(input.value);
  return { value: input.value };
}
`,
      'utf8',
    );
    writeFileSync(
      join(root, 'app.mjs'),
      `import { hiddenHandler } from 'external-actions';
import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';
export const hiddenMutation = mutation({
  access: publicAccess('external package authority audit'),
  input: s.object({ value: s.string() }),
  handler: hiddenHandler,
});
export default createApp({
  mutations: [hiddenMutation],
  routes: [route('/', { access: publicAccess('authority audit'), page: () => 'safe' })],
});
`,
      'utf8',
    );

    const result = await check(root);
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain('sink=request-handler.opaque-source');
    expect(result.stderr).toContain('source=external-actions');
  }, 120_000);

  it('fails closed when a local handler calls a namespace helper from an ordinary package', async () => {
    const root = fixture('dependency-helper');
    const pkg = join(root, 'node_modules/external-actions');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({ name: 'external-actions', type: 'module', exports: './index.mjs' }),
      'utf8',
    );
    writeFileSync(
      join(pkg, 'index.mjs'),
      `import { spawnSync } from 'node:child_process';
export function invoke(program) {
  spawnSync(program);
  return { value: program };
}
`,
      'utf8',
    );
    writeFileSync(
      join(root, 'app.mjs'),
      `import * as external from 'external-actions';
import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';
export const hiddenMutation = mutation({
  access: publicAccess('external helper authority audit'),
  input: s.object({ value: s.string() }),
  handler(input) {
    return external.invoke(input.value);
  },
});
export default createApp({
  mutations: [hiddenMutation],
  routes: [route('/', { access: publicAccess('authority audit'), page: () => 'safe' })],
});
`,
      'utf8',
    );

    const result = await check(root);
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain('sink=request-handler.opaque-package-call');
    expect(result.stderr).toContain('source=external-actions');
  }, 120_000);

  it('accepts the canonical command capability instead of raw child_process', async () => {
    const root = fixture('safe-command');
    writeFileSync(
      join(root, 'app.mjs'),
      `import {
  cmd,
  commandAllowlist,
  createApp,
  mutation,
  publicAccess,
  route,
  runCommand,
  s,
} from '@kovojs/server';
const allow = commandAllowlist(['/usr/bin/true'], { justification: 'fixed health probe' });
const command = cmd('/usr/bin/true', [], { allow });
export const safeMutation = mutation({
  access: publicAccess('safe command capability'),
  input: s.object({}),
  handler() {
    return runCommand(command);
  },
});
export default createApp({
  mutations: [safeMutation],
  routes: [route('/', { access: publicAccess('authority audit'), page: () => 'safe' })],
});
`,
      'utf8',
    );

    const result = await check(root);
    expect(result, result.stderr).toMatchObject({ code: 0 });
    expect(result.stdout).toContain('CHECK ok preset=node');
  }, 120_000);

  it('rejects request-derived raw filesystem and path access before artifact emission', async () => {
    const root = fixture('raw-filesystem-path');
    writeFileSync(
      join(root, 'app.mjs'),
      `import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';
export const unsafeRead = mutation({
  access: publicAccess('raw filesystem authority audit'),
  input: s.object({ value: s.string() }),
  handler(input) {
    return { value: readFileSync(resolve(input.value), 'utf8') };
  },
});
export default createApp({
  mutations: [unsafeRead],
  routes: [route('/', { access: publicAccess('authority audit'), page: () => 'safe' })],
});
`,
      'utf8',
    );

    const result = await check(root);
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain('sink=node:fs.readFileSync');
    expect(result.stderr).toContain('sink=node:path.resolve');
  }, 120_000);

  it('rejects callback and Reflect.apply process-authority escapes in a real build', async () => {
    const root = fixture('process-reference');
    writeFileSync(
      join(root, 'app.mjs'),
      `import { execFileSync } from 'node:child_process';
import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';
export const unsafeReference = mutation({
  access: publicAccess('process callback authority audit'),
  input: s.object({ value: s.string() }),
  handler(input) {
    [input.value].map(execFileSync);
    Reflect.apply(execFileSync, null, [input.value]);
    return { value: input.value };
  },
});
export default createApp({
  mutations: [unsafeReference],
  routes: [route('/', { access: publicAccess('authority audit'), page: () => 'safe' })],
});
`,
      'utf8',
    );

    const result = await check(root);
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain('sink=child_process.execFileSync');
  }, 120_000);

  it('rejects request-derived worker_threads execution in a real build', async () => {
    const root = fixture('worker-thread');
    writeFileSync(
      join(root, 'app.mjs'),
      `import { Worker } from 'node:worker_threads';
import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';
export const unsafeWorker = mutation({
  access: publicAccess('worker authority audit'),
  input: s.object({ value: s.string() }),
  handler(input) {
    new Worker(input.value, { eval: true });
    return { value: input.value };
  },
});
export default createApp({
  mutations: [unsafeWorker],
  routes: [route('/', { access: publicAccess('authority audit'), page: () => 'safe' })],
});
`,
      'utf8',
    );

    const result = await check(root);
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain('sink=node:worker_threads.Worker');
  }, 120_000);

  it('rejects request-minted filesystem and storage roots in a real build', async () => {
    const root = fixture('framework-file-authority');
    writeFileSync(
      join(root, 'app.mjs'),
      `import {
  createApp,
  createFileSystemStorage,
  mutation,
  publicAccess,
  rootedFiles,
  route,
  s,
} from '@kovojs/server';
export const unsafeFiles = mutation({
  access: publicAccess('request-minted file authority audit'),
  input: s.object({ value: s.string() }),
  async handler(input) {
    await rootedFiles(input.value);
    createFileSystemStorage({ root: input.value });
    return { value: input.value };
  },
});
export default createApp({
  mutations: [unsafeFiles],
  routes: [route('/', { access: publicAccess('authority audit'), page: () => 'safe' })],
});
`,
      'utf8',
    );

    const result = await check(root);
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain('sink=@kovojs/server.rootedFiles');
    expect(result.stderr).toContain('sink=@kovojs/core.createFileSystemStorage');
  }, 120_000);

  it('rejects request-minted command allowlists and programs in a real build', async () => {
    const root = fixture('framework-command-authority');
    writeFileSync(
      join(root, 'app.mjs'),
      `import {
  cmd,
  commandAllowlist,
  createApp,
  mutation,
  publicAccess,
  route,
  runCommand,
  s,
} from '@kovojs/server';
export const unsafeCommand = mutation({
  access: publicAccess('request-minted command authority audit'),
  input: s.object({ value: s.string() }),
  handler(input) {
    const allow = commandAllowlist([input.value], { justification: 'request-selected program' });
    return runCommand(cmd(input.value, [], { allow }));
  },
});
export default createApp({
  mutations: [unsafeCommand],
  routes: [route('/', { access: publicAccess('authority audit'), page: () => 'safe' })],
});
`,
      'utf8',
    );

    const result = await check(root);
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain('sink=@kovojs/server.commandAllowlist');
    expect(result.stderr).toContain('sink=@kovojs/server.cmd');
  }, 120_000);

  it('accepts module-scope literal filesystem and storage roots', async () => {
    const root = fixture('framework-static-file-authority');
    const staticRoot = JSON.stringify(root);
    writeFileSync(
      join(root, 'app.mjs'),
      `import {
  createApp,
  createFileSystemStorage,
  mutation,
  publicAccess,
  rootedFiles,
  route,
  s,
} from '@kovojs/server';
const files = await rootedFiles(${staticRoot});
const storage = createFileSystemStorage({ root: ${staticRoot} });
export const safeFiles = mutation({
  access: publicAccess('static file authority'),
  input: s.object({}),
  async handler() {
    await storage.stat('fixed-key');
    return { value: Boolean(files) };
  },
});
export default createApp({
  mutations: [safeFiles],
  routes: [route('/', { access: publicAccess('authority audit'), page: () => 'safe' })],
});
`,
      'utf8',
    );

    const result = await check(root);
    expect(result, result.stderr).toMatchObject({ code: 0 });
    expect(result.stdout).toContain('CHECK ok preset=node');
  }, 120_000);

  it('rejects a request-time factory result that hides raw process authority', async () => {
    const root = fixture('closed-call-graph');
    writeFileSync(
      join(root, 'app.mjs'),
      `import { execFileSync } from 'node:child_process';
import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';
function makeRunner() { return (value) => execFileSync(value); }
export const unsafeCalls = mutation({
  access: publicAccess('closed request call graph'),
  input: s.object({ method: s.string(), value: s.string() }),
  handler(input) {
    makeRunner()(input.value);
    return { value: input.value };
  },
});
export default createApp({
  mutations: [unsafeCalls],
  routes: [route('/', { access: publicAccess('authority audit'), page: () => 'safe' })],
});
`,
      'utf8',
    );

    const result = await check(root);
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain('sink=child_process.execFileSync');
  }, 120_000);

  it('rejects object and higher-order endpoint call-graph escapes', async () => {
    const root = fixture('closed-endpoint-call-graph');
    writeFileSync(
      join(root, 'app.mjs'),
      `import { execFileSync } from 'node:child_process';
import { createApp, endpoint, publicAccess, route } from '@kovojs/server';
const helpers = { run(value) { return execFileSync(value); } };
function invoke(callback, value) { return callback(value); }
const unsafeEndpoint = endpoint('/unsafe', {
  method: 'GET',
  reason: 'closed endpoint request call graph',
  response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
  handler(request) {
    helpers.run(request.url);
    invoke((value) => value, request.url);
    return new Response('blocked', { headers: { 'cache-control': 'no-store' } });
  },
});
export default createApp({
  endpoints: [unsafeEndpoint],
  routes: [route('/', { access: publicAccess('authority audit'), page: () => 'safe' })],
});
`,
      'utf8',
    );

    const result = await check(root);
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain('sink=child_process.execFileSync');
    expect(result.stderr).toContain('sink=request-handler.opaque-call');
  }, 120_000);

  it('rejects dynamic platform namespaces and unreviewed Node builtins', async () => {
    const root = fixture('closed-platform-namespaces');
    writeFileSync(
      join(root, 'app.mjs'),
      `import * as inspector from 'node:inspector';
import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';
export const unsafePlatform = mutation({
  access: publicAccess('closed platform namespaces'),
  input: s.object({ method: s.string() }),
  handler(input) {
    inspector.open();
    Bun[input.method];
    Deno[input.method];
    return globalThis.process[input.method];
  },
});
export default createApp({
  mutations: [unsafePlatform],
  routes: [route('/', { access: publicAccess('authority audit'), page: () => 'safe' })],
});
`,
      'utf8',
    );

    const result = await check(root);
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain('sink=node:inspector.open');
    expect(result.stderr).toContain('sink=Bun.[computed]');
    expect(result.stderr).toContain('sink=Deno.[computed]');
    expect(result.stderr).toContain('sink=node:process.[computed]');
  }, 120_000);

  it('rejects raw server environment values returned from a request handler', async () => {
    const root = fixture('raw-environment-wire');
    writeFileSync(
      join(root, 'app.mjs'),
      `import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';
const environment = import.meta.env;
export const unsafeEnvironment = mutation({
  access: publicAccess('raw environment wire audit'),
  input: s.object({}),
  handler() {
    return { secret: environment.APP_SECRET };
  },
});
export default createApp({
  mutations: [unsafeEnvironment],
  routes: [route('/', { access: publicAccess('authority audit'), page: () => 'safe' })],
});
`,
      'utf8',
    );

    const result = await check(root);
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain('sink=import.meta.env');
  }, 120_000);

  it('rejects a raw Authorization value returned from an endpoint', async () => {
    const root = fixture('request-credential-wire');
    writeFileSync(
      join(root, 'app.mjs'),
      `import { createApp, endpoint, publicAccess, route } from '@kovojs/server';
const unsafeEndpoint = endpoint('/unsafe', {
  method: 'GET',
  reason: 'request credential wire audit',
  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
  handler(request) {
    return Response.json({ token: request.headers.get('Authorization') });
  },
});
export default createApp({
  endpoints: [unsafeEndpoint],
  routes: [route('/', { access: publicAccess('authority audit'), page: () => 'safe' })],
});
`,
      'utf8',
    );

    const result = await check(root);
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain('sink=client-wire.request.header.Authorization');
  }, 120_000);

  it('rejects bracketed import.meta env access before the aggregate build prefilter can skip it', async () => {
    const root = fixture('raw-bracket-environment-wire');
    writeFileSync(
      join(root, 'app.mjs'),
      `import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';
const secret = import.meta['env'].APP_SECRET;
export const unsafeEnvironment = mutation({
  access: publicAccess('raw bracket environment wire audit'),
  input: s.object({}),
  handler() { return { secret }; },
});
export default createApp({
  mutations: [unsafeEnvironment],
  routes: [route('/', { access: publicAccess('authority audit'), page: () => 'safe' })],
});
`,
      'utf8',
    );

    const result = await check(root);
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain('sink=import.meta.env');
  }, 120_000);

  it('rejects process authority and credential HTML from a route page root', async () => {
    const root = fixture('route-page-authority');
    writeFileSync(
      join(root, 'app.mjs'),
      `import { execFileSync } from 'node:child_process';
import { createApp, publicAccess, route } from '@kovojs/server';
export const unsafeRoute = route('/', {
  access: publicAccess('route authority audit'),
  page(_context, request) {
    execFileSync('/usr/bin/true');
    return request.headers.get('cookie');
  },
});
export default createApp({ routes: [unsafeRoute] });
`,
      'utf8',
    );

    const result = await check(root);
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain('sink=child_process.execFileSync');
    expect(result.stderr).toContain('sink=client-wire.request.header.Cookie');
  }, 120_000);

  it('rejects a framework authority constructor behind an object factory root', async () => {
    const root = fixture('object-factory-authority');
    writeFileSync(
      join(root, 'app.mjs'),
      `import { createApp, mutation, publicAccess, rootedFiles, route, s } from '@kovojs/server';
const factories = { mutation };
export const unsafeMutation = factories.mutation({
  access: publicAccess('object factory authority audit'),
  input: s.object({ root: s.string() }),
  async handler(input) {
    await rootedFiles(input.root);
    return { ok: true };
  },
});
export default createApp({
  mutations: [unsafeMutation],
  routes: [route('/', { access: publicAccess('authority audit'), page: () => 'safe' })],
});
`,
      'utf8',
    );

    const result = await check(root);
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain('sink=@kovojs/server.rootedFiles');
  }, 120_000);

  it('accepts governed fetch response flow and reviewed Drizzle expressions in a real build', async () => {
    const root = fixture('safe-fetch-drizzle');
    symlinkSync(
      join(repoRoot, 'packages/drizzle/node_modules/drizzle-orm'),
      join(root, 'node_modules/drizzle-orm'),
    );
    writeFileSync(
      join(root, 'app.mjs'),
      `import { and, eq, isNotNull } from 'drizzle-orm';
import { createApp, publicAccess, query, route } from '@kovojs/server';
const fields = { id: {}, name: {} };
export const safeQuery = query({
  access: publicAccess('governed fetch and Drizzle expression audit'),
  async load() {
    const response = await fetch('https://api.example.test/data');
    return {
      predicate: Boolean(and(eq(fields.id, 'fixed'), isNotNull(fields.name))),
      value: await response.clone().json(),
    };
  },
});
export default createApp({
  queries: [safeQuery],
  routes: [route('/', { access: publicAccess('authority audit'), page: () => 'safe' })],
});
`,
      'utf8',
    );

    const result = await check(root);
    expect(result, result.stderr).toMatchObject({ code: 0 });
    expect(result.stdout).toContain('CHECK ok preset=node');
  }, 120_000);

  it('rejects ambient request credentials forwarded through outbound fetch', async () => {
    const root = fixture('unsafe-fetch-credentials');
    writeFileSync(
      join(root, 'app.mjs'),
      `import { createApp, publicAccess, query, route } from '@kovojs/server';
export const unsafeQuery = query({
  access: publicAccess('outbound credential audit'),
  async load(_input, { request }) {
    await fetch('https://api.example.test/data', {
      body: request.headers.get('authorization'),
      method: 'POST',
    });
    return { ok: true };
  },
});
export default createApp({
  queries: [unsafeQuery],
  routes: [route('/', { access: publicAccess('authority audit'), page: () => 'safe' })],
});
`,
      'utf8',
    );

    const result = await check(root);
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain('sink=outbound-fetch.request.header.Authorization');
  }, 120_000);

  it('rejects the strict request-derived process, filesystem, code, command, and storage matrix', async () => {
    const root = fixture('strict-known-authority-matrix');
    writeFileSync(
      join(root, 'app.ts'),
      `import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  cmd,
  commandAllowlist,
  createApp,
  createFileSystemStorage,
  mutation,
  publicAccess,
  rootedFiles,
  route,
  runCommand,
  s,
  trustedHtml,
} from '@kovojs/server';

export const unsafeMatrix = mutation({
  access: publicAccess('strict request-derived authority matrix'),
  input: s.object({
    args: s.array(s.string()),
    expression: s.string(),
    path: s.string(),
    program: s.string(),
    root: s.string(),
  }),
  async handler(input) {
    execFileSync(input.program, input.args);
    readFileSync(resolve(input.path), 'utf8');
    new Function(input.expression);
    const allow = commandAllowlist([input.program], {
      justification: 'request-selected program is intentionally rejected',
    });
    runCommand(cmd(input.program, input.args, { allow }));
    createFileSystemStorage({ root: input.root });
    await rootedFiles(input.root);
    return { ok: true };
  },
});

export default createApp({
  mutations: [unsafeMatrix],
  routes: [
    route('/', {
      access: publicAccess('matrix route'),
      page: () => trustedHtml('<main>safe</main>', 'fixed test fixture'),
    }),
  ],
});
`,
      'utf8',
    );

    expectTypechecks(root, 'app.ts');

    const result = await check(root, './app.ts');
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain('sink=child_process.execFileSync');
    expect(result.stderr).toContain('sink=node:fs.readFileSync');
    expect(result.stderr).toContain('sink=node:path.resolve');
    expect(result.stderr).toContain('sink=Function');
    expect(result.stderr).toContain('sink=@kovojs/server.commandAllowlist');
    expect(result.stderr).toContain('sink=@kovojs/server.cmd');
    expect(result.stderr).toContain('sink=@kovojs/core.createFileSystemStorage');
    expect(result.stderr).toContain('sink=@kovojs/server.rootedFiles');
  }, 120_000);

  it('rejects strict public query and route credential plus import.meta carrier leaks', async () => {
    const root = fixture('strict-public-wire-carriers');
    writeFileSync(
      join(root, 'app.ts'),
      `import {
  createApp,
  publicAccess,
  query,
  route,
  trustedHtml,
  type QueryLoadContext,
} from '@kovojs/server';

declare global {
  interface ImportMeta {
    readonly env: Record<string, string>;
  }
}

const meta = import.meta;
const { env } = import.meta;
const holder = { meta: import.meta };
const tuple = [import.meta];
let assigned = import.meta;
let assignedEnv: Record<string, string>;
({ env: assignedEnv } = import.meta);

export const unsafeQuery = query({
  access: publicAccess('strict public query wire audit'),
  load(_input: unknown, { request }: QueryLoadContext<Request>) {
    return {
      authorization: request.headers.get('authorization'),
      cookie: request.headers.get('cookie'),
      secret: env.QUERY_SECRET ?? null,
    };
  },
});

export const unsafeRoute = route('/', {
  access: publicAccess('strict public route wire audit'),
  bootstrapScript: meta.env.BOOTSTRAP,
  modulepreloads: [holder.meta.env.PRELOAD, tuple[0].env.TUPLE],
  page(_context, request: Request) {
    return trustedHtml(
      JSON.stringify({
        authorization: request.headers.get('authorization'),
        cookie: request.headers.get('cookie'),
        secret: assigned.env.ROUTE_SECRET,
      }),
      'credential leak fixture rejected by KV424',
    );
  },
  prerenderUrls: [assignedEnv.PRERENDER],
});

export default createApp({ queries: [unsafeQuery], routes: [unsafeRoute] });
`,
      'utf8',
    );

    expectTypechecks(root, 'app.ts');

    const result = await check(root, './app.ts');
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain('sink=import.meta.env');
    expect(result.stderr).toContain('sink=client-wire.request.header.Cookie');
    expect(result.stderr).toContain('sink=client-wire.request.header.Authorization');
  }, 120_000);

  it('rejects strict endpoint env and Authorization leaks while keeping Cookie server-only', async () => {
    const root = fixture('strict-endpoint-wire');
    writeFileSync(
      join(root, 'app.ts'),
      `import {
  createApp,
  endpoint,
  publicAccess,
  route,
  trustedHtml,
} from '@kovojs/server';

declare global {
  interface ImportMeta {
    readonly env: Record<string, string>;
  }
}

const meta = import.meta;
const unsafeEndpoint = endpoint('/unsafe', {
  handler(request) {
    return Response.json({
      authorization: request.headers.get('authorization'),
      cookie: request.headers.get('cookie'),
      secret: meta.env.ENDPOINT_SECRET,
    });
  },
  method: 'GET',
  reason: 'strict endpoint wire audit',
  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
});

export default createApp({
  endpoints: [unsafeEndpoint],
  routes: [
    route('/', {
      access: publicAccess('endpoint fixture route'),
      page: () => trustedHtml('<main>safe</main>', 'fixed test fixture'),
    }),
  ],
});
`,
      'utf8',
    );

    expectTypechecks(root, 'app.ts');

    const result = await check(root, './app.ts');
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain('sink=import.meta.env');
    expect(result.stderr).toContain('sink=client-wire.request.header.Authorization');
    expect(result.stderr).not.toContain('sink=client-wire.request.header.Cookie');
  }, 120_000);

  it('keeps strict session values server-only but rejects setCookies credential authority', async () => {
    const safeRoot = fixture('strict-session-value-safe');
    writeFileSync(
      join(safeRoot, 'app.ts'),
      `import { createApp, publicAccess, route, trustedHtml } from '@kovojs/server';
export default createApp<{ session: string }>({
  routes: [
    route('/', {
      access: publicAccess('session value fixture route'),
      page: () => trustedHtml('<main>safe</main>', 'fixed test fixture'),
    }),
  ],
  sessionProvider(request) {
    return {
      setCookies: [],
      value: { session: request.headers.get('cookie') ?? '' },
    };
  },
});
`,
      'utf8',
    );
    expectTypechecks(safeRoot, 'app.ts');
    const safeResult = await check(safeRoot, './app.ts');
    expect(safeResult, safeResult.stderr).toMatchObject({ code: 0 });

    const unsafeRoot = fixture('strict-session-set-cookie-unsafe');
    writeFileSync(
      join(unsafeRoot, 'app.ts'),
      `import { createApp, publicAccess, route, trustedHtml } from '@kovojs/server';
export default createApp<{ session: string }>({
  routes: [
    route('/', {
      access: publicAccess('session set-cookie fixture route'),
      page: () => trustedHtml('<main>safe</main>', 'fixed test fixture'),
    }),
  ],
  sessionProvider(request) {
    return {
      setCookies: [request.headers.get('authorization') ?? ''],
      value: { session: request.headers.get('cookie') ?? '' },
    };
  },
});
`,
      'utf8',
    );
    expectTypechecks(unsafeRoot, 'app.ts');
    const unsafeResult = await check(unsafeRoot, './app.ts');
    expect(unsafeResult, unsafeResult.stderr).toMatchObject({ code: 1 });
    expect(unsafeResult.stderr).toContain('ERROR KV424');
    expect(unsafeResult.stderr).toContain('sink=client-wire.request.header.Authorization');
    expect(unsafeResult.stderr).not.toContain('sink=client-wire.request.header.Cookie');
  }, 120_000);

  it('rejects strict reflective factories, pre-snapshot writes, access mutation, and prototype authority', async () => {
    const root = fixture('strict-reflective-prototype-authority');
    writeFileSync(
      join(root, 'app.ts'),
      String.raw`import { execFileSync } from 'node:child_process';
import * as serverApi from '@kovojs/server';
import {
  createApp,
  endpoint,
  publicAccess,
  route,
  type EndpointDefinition,
  type Guard,
} from '@kovojs/server';

const response = { appOwnedSafety: true, body: 'text', cache: 'no-store' } as const;

let assigned: typeof endpoint;
({ endpoint: assigned } = serverApi);
const reflected: typeof endpoint = Reflect.get(serverApi, 'endpoint');
const descriptor = Object.getOwnPropertyDescriptor(serverApi, 'endpoint');
if (!descriptor) throw new Error('endpoint descriptor missing');
const described: typeof endpoint = descriptor.value;

assigned('/assigned', {
  handler(request) { execFileSync('factory-assigned'); return new Response(request.url); },
  method: 'GET', reason: 'assigned factory audit', response,
});
reflected('/reflected', {
  handler(request) { execFileSync('factory-reflected'); return new Response(request.url); },
  method: 'GET', reason: 'reflected factory audit', response,
});
described('/described', {
  handler(request) { execFileSync('factory-described'); return new Response(request.url); },
  method: 'GET', reason: 'descriptor factory audit', response,
});

const fromArray = [endpoint].at(0);
const fromMap = new Map([['endpoint', endpoint]]).get('endpoint');
const fromValues = Object.values({ endpoint })[0];
if (!fromArray || !fromMap || !fromValues) throw new Error('factory aggregate missing');
fromArray('/array', {
  handler() { execFileSync('factory-array'); return new Response('ok'); },
  method: 'GET', reason: 'array factory audit', response,
});
fromMap('/map', {
  handler() { execFileSync('factory-map'); return new Response('ok'); },
  method: 'GET', reason: 'map factory audit', response,
});
({ ...serverApi }).endpoint('/spread', {
  handler() { execFileSync('factory-spread'); return new Response('ok'); },
  method: 'GET', reason: 'spread factory audit', response,
});
Object.assign({}, serverApi).endpoint('/assign', {
  handler() { execFileSync('factory-object-assign'); return new Response('ok'); },
  method: 'GET', reason: 'Object.assign factory audit', response,
});
fromValues('/values', {
  handler() { execFileSync('factory-values'); return new Response('ok'); },
  method: 'GET', reason: 'Object.values factory audit', response,
});

const memberFactory: { endpoint?: typeof endpoint } = {};
memberFactory.endpoint = endpoint;
memberFactory.endpoint('/member-write', {
  handler() { execFileSync('factory-member-write'); return new Response('ok'); },
  method: 'GET', reason: 'member-write factory audit', response,
});

const configured: EndpointDefinition<'GET'> = {
  handler() { return new Response('safe'); },
  method: 'GET', reason: 'defineProperty config audit', response,
};
Object.defineProperty(configured, 'handler', {
  value(request: Request) {
    execFileSync('config-define-property');
    return new Response(request.url);
  },
});
endpoint('/configured', configured);

const reflectedConfig: EndpointDefinition<'GET'> = {
  handler() { return new Response('safe'); },
  method: 'GET', reason: 'Reflect.set config audit', response,
};
Reflect.set(reflectedConfig, 'handler', (request: Request) => {
  execFileSync('config-reflect-set');
  return new Response(request.url);
});
endpoint('/reflected-config', reflectedConfig);

const postSnapshot: EndpointDefinition<'GET'> = {
  handler() { return new Response('safe'); },
  method: 'GET', reason: 'post-snapshot precision audit', response,
};
endpoint('/post-snapshot', postSnapshot);
postSnapshot.handler = (request: Request) => {
  execFileSync('post-snapshot-must-stay-safe');
  return new Response(request.url);
};

const pushedAccess: Guard<Request>[] = [];
pushedAccess.push((request) => {
  execFileSync('access-push');
  return request.url.length > 0;
});
endpoint('/access-push', {
  access: pushedAccess,
  handler() { return new Response('ok'); },
  method: 'GET', reason: 'pushed access audit', response,
});
const indexedAccess: Guard<Request>[] = [];
indexedAccess[0] = (request) => {
  execFileSync('access-index');
  return request.url.length > 0;
};
endpoint('/access-index', {
  access: indexedAccess,
  handler() { return new Response('ok'); },
  method: 'GET', reason: 'indexed access audit', response,
});

String.prototype.trim = function (this: string): string {
  execFileSync('trim-prototype');
  return String(this);
};
Object.defineProperty(Array.prototype, 'map', {
  value(this: unknown[]) {
    execFileSync('map-prototype');
    return this;
  },
});

export const serializationRoute = route('/serialize', {
  access: publicAccess('prototype serialization audit'),
  page(_context, request: Request) {
    String(request.url).trim();
    [request.url].map((value) => value);
    let captured = request.headers.get('cookie');
    class Computed {
      ['to' + 'JSON']() { return { cookie: captured }; }
    }
    class Assigned {
      toJSON(): unknown { return null; }
    }
    Assigned.prototype.toJSON = () => ({
      authorization: request.headers.get('authorization'),
    });
    class Described {}
    Object.defineProperty(Described.prototype, 'toJSON', {
      value() { return { proxy: request.headers.get('proxy-authorization') }; },
    });
    captured = request.headers.get('cookie');
    return Math.random() > 0.5
      ? new Computed()
      : Math.random() > 0.5
        ? new Assigned()
        : new Described();
  },
});

export default createApp({ routes: [serializationRoute] });
`,
      'utf8',
    );

    expectTypechecks(root, 'app.ts');

    const result = await check(root, './app.ts');
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain('sink=child_process.execFileSync');
    expect(result.stderr).toContain('sink=client-wire.request.header.Cookie');
    expect(result.stderr).toContain('sink=client-wire.request.header.Authorization');
    expect(result.stderr).toContain('sink=client-wire.request.header.Proxy-Authorization');
    expect(result.stderr).toContain("source='factory-assigned'");
    expect(result.stderr).toContain("source='factory-member-write'");
    expect(result.stderr).toContain("source='config-define-property'");
    expect(result.stderr).toContain("source='access-push'");
    expect(result.stderr).toContain("source='trim-prototype'");
    expect(result.stderr).not.toContain('post-snapshot-must-stay-safe');
  }, 120_000);

  it('rejects strict inherited schema, replay, and client-module adapter authority', async () => {
    const root = fixture('strict-inherited-adapter-authority');
    writeFileSync(
      join(root, 'app.ts'),
      `import { execFileSync } from 'node:child_process';
import {
  createApp,
  publicAccess,
  query,
  route,
  trustedHtml,
  webhook,
  type MutationReplayStore,
  type Schema,
  type VersionedClientModuleInput,
  type VersionedClientModuleRegistry,
  type WebhookReplayStore,
} from '@kovojs/server';

class BaseSchema implements Schema<Record<string, never>> {
  parse(_input: unknown): Record<string, never> {
    execFileSync('schema-parse');
    return {};
  }
  async parseAsync(_input: unknown): Promise<Record<string, never>> {
    execFileSync('schema-parse-async');
    return {};
  }
}
class InheritedSchema extends BaseSchema {}

class BaseReplay implements WebhookReplayStore, MutationReplayStore {
  get(_scope: string, _idem: string): undefined {
    execFileSync('replay-get');
    return undefined;
  }
  reserve(_scope: string, _idem: string): undefined {
    execFileSync('replay-reserve');
    return undefined;
  }
  set(_scope: string, _idem: string, _response: unknown): void {
    execFileSync('replay-set');
  }
}
class InheritedReplay extends BaseReplay {}

class BaseRegistry implements VersionedClientModuleRegistry {
  buildToken(): string {
    execFileSync('registry-build-token');
    return 'strict-inherited-registry';
  }
  entries(): readonly VersionedClientModuleInput[] {
    return [];
  }
  put(_module: VersionedClientModuleInput): string {
    return '/c/strict-inherited.js';
  }
  resolve(_href: string) {
    execFileSync('registry-resolve');
    const status: 200 = 200;
    return { body: '', headers: {}, status };
  }
}
class InheritedRegistry extends BaseRegistry {}

const schema = new InheritedSchema();
const replay = new InheritedReplay();
const hook = webhook('/hook', {
  handler() { return { ok: true }; },
  input: schema,
  replayStore: replay,
  verify: 'none',
  verifyJustification: 'strict inherited adapter fixture',
});
const read = query({
  access: publicAccess('strict inherited schema query'),
  args: schema,
  load() { return { ok: true }; },
});

export default createApp({
  clientModules: new InheritedRegistry(),
  endpoints: [hook],
  mutationReplayStore: replay,
  queries: [read],
  routes: [
    route('/', {
      access: publicAccess('inherited adapter fixture route'),
      page: () => trustedHtml('<main>safe</main>', 'fixed test fixture'),
    }),
  ],
});
`,
      'utf8',
    );

    expectTypechecks(root, 'app.ts');

    const result = await check(root, './app.ts');
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain("source='schema-parse'");
    expect(result.stderr).toContain("source='schema-parse-async'");
    expect(result.stderr).toContain("source='replay-get'");
    expect(result.stderr).toContain("source='replay-reserve'");
    expect(result.stderr).toContain("source='replay-set'");
    expect(result.stderr).toContain("source='registry-build-token'");
    expect(result.stderr).toContain("source='registry-resolve'");
  }, 120_000);

  it('rejects type-safe factory mutation, method rebinding, static hints, and toJSON in a real build', async () => {
    const root = fixture('final-adversarial-census');
    writeFileSync(
      join(root, 'app.ts'),
      String.raw`import * as server from '@kovojs/server';
import {
  createApp,
  endpoint,
  publicAccess,
  rootedFiles,
  route,
  type EndpointDefinition,
  type EndpointHandler,
} from '@kovojs/server';

declare global {
  interface ImportMeta {
    readonly env: Record<string, string>;
  }
}

const helper: { trim(value: string): unknown } = {
  trim(value) { return value.trim(); },
};
helper.trim = rootedFiles;

let assignedHandler: EndpointHandler = () => new Response('safe');
const config = {
  handler: assignedHandler,
  method: 'GET',
  reason: 'type-safe mutable callback audit',
  response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
} satisfies EndpointDefinition<'GET'>;
const conditionalEndpoint = Math.random() > 0.5 ? endpoint : endpoint;
const declaredEndpoint = conditionalEndpoint('/conditional', config);
assignedHandler = (request) => {
  helper.trim(new URL(request.url).pathname);
  return new Response('unsafe');
};
config.handler = assignedHandler;

const { endpoint: destructuredEndpoint } = server;
const destructured = destructuredEndpoint('/destructured', {
  ...config,
  handler: assignedHandler,
});

const page = route('/', {
  access: publicAccess('adversarial classifier route'),
  bootstrapScript: (import /* comment */ . meta).\u0065nv.BOOTSTRAP,
  modulepreloads: [import.meta.env.PRELOAD],
  page(_context, request: Request) {
    class CredentialBox {
      toJSON() { return { cookie: request.headers.get('cookie') }; }
    }
    return new CredentialBox();
  },
  stylesheets: [import.meta.\u0065nv.STYLE],
});

export default createApp({ endpoints: [declaredEndpoint, destructured], routes: [page] });
`,
      'utf8',
    );

    expectTypechecks(root, 'app.ts');

    const result = await check(root, './app.ts');
    expect(result, result.stderr).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ERROR KV424');
    expect(result.stderr).toContain('sink=@kovojs/server.rootedFiles');
    expect(result.stderr).toContain('sink=client-wire.request.header.Cookie');
    expect(result.stderr).toContain('sink=import.meta.env');
  }, 120_000);

  it('accepts reviewed intrinsic calls and statically closed callbacks', async () => {
    const root = fixture('safe-intrinsic-calls');
    writeFileSync(
      join(root, 'app.mjs'),
      `import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';
export const safeCalls = mutation({
  access: publicAccess('reviewed intrinsic calls'),
  input: s.object({ value: s.string() }),
  handler(input) {
    const normalized = [input.value].map((value) => String(value).trim());
    return { value: JSON.stringify({ normalized }) };
  },
});
export default createApp({
  mutations: [safeCalls],
  routes: [route('/', { access: publicAccess('authority audit'), page: () => 'safe' })],
});
`,
      'utf8',
    );

    const result = await check(root);
    expect(result, result.stderr).toMatchObject({ code: 0 });
    expect(result.stdout).toContain('CHECK ok preset=node');
  }, 120_000);
});
