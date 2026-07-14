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

async function check(root: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const before = process.cwd();
  try {
    process.chdir(root);
    const code = await mainAsync(['build', './app.mjs', '--out', './dist', '--check']);
    return {
      code,
      stdout: stdout.mock.calls.map(([chunk]) => String(chunk)).join(''),
      stderr: stderr.mock.calls.map(([chunk]) => String(chunk)).join(''),
    };
  } finally {
    process.chdir(before);
  }
}

// @kovo-security-certifies KV424 request-process-local-build
// @kovo-security-certifies KV424 request-process-package-build
// @kovo-security-certifies KV424 request-raw-authority-build
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
