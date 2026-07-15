import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { cloudflare, node, vercel, type KovoPreset } from './build.js';
import { resolveKovoBuildPreset, type KovoBuildPreset } from '@kovojs/server/internal/build-preset';
import { writeKovoNeutralBuild, type KovoNeutralBuild } from './neutral-build.js';

describe('generated request-safe runtime lockdown', () => {
  it('orders every generated runner lock before its authored handler import', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-generated-lock-order-'));
    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `export default async () => new Response('safe');\n`,
      });
      const nodeOut = join(root, 'node');
      const vercelOut = join(root, 'vercel');
      const cloudflareOut = join(root, 'cloudflare');
      await emit(node({ dockerfile: false }), build, nodeOut);
      await emit(vercel(), build, vercelOut);
      await emit(cloudflare(), build, cloudflareOut);

      const nodeSource = await readFile(join(nodeOut, 'server.mjs'), 'utf8');
      const vercelSource = await readFile(join(vercelOut, 'functions/kovo.func/index.cjs'), 'utf8');
      const cloudflareSource = await readFile(join(cloudflareOut, 'worker.mjs'), 'utf8');
      expectEagerLockBeforeImports(nodeSource, [
        "await import('./node-adapter.mjs')",
        "import('./server/handler.mjs')",
      ]);
      expectEagerLockBeforeImports(vercelSource, [
        "import('./node-adapter.mjs')",
        "import('./handler.mjs')",
      ]);
      expectEagerLockBeforeImports(cloudflareSource, ["import('./server/handler.mjs')"]);
      expect(nodeSource).not.toContain("from './node-adapter.mjs';");
      expect(nodeSource).not.toContain('lockGeneratedRequestSafeRuntimeRealm');
      expect(vercelSource).not.toContain('lockGeneratedRequestSafeRuntimeRealm');
      expect(cloudflareSource).not.toContain('lockGeneratedRequestSafeRuntimeRealm');
      expect(nodeSource).not.toContain('lockRequestSafeNodeBuiltinFacades');
      expect(vercelSource).not.toContain('lockRequestSafeNodeBuiltinFacades');
      expect(cloudflareSource).not.toMatch(/(?:from\s+|require\(|import\()['"]node:/u);
      expect(cloudflareSource).not.toContain('lockRequestSafeNodeBuiltinFacades');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('rejects bare-package top-level and deferred global poison in Node output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-generated-node-lock-'));
    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
import { poisonResult } from 'kovo-lockdown-poison';
export default async function handler() {
  return new Response(JSON.stringify(await poisonResult()));
}
`,
      });
      const packageRoot = join(build.serverDir, 'node_modules/kovo-lockdown-poison');
      await mkdir(packageRoot, { recursive: true });
      await writeFile(
        join(packageRoot, 'package.json'),
        JSON.stringify({ exports: './index.mjs', name: 'kovo-lockdown-poison', type: 'module' }),
      );
      await writeFile(join(packageRoot, 'index.mjs'), nodePoisonPackageSource());

      const outDir = join(root, 'node');
      await emit(node({ dockerfile: false }), build, outDir);
      await prependGeneratedModulePoison(join(outDir, 'node-adapter.mjs'));
      const result = runNodeRuntime(nodeRuntimeProbe(join(outDir, 'server.mjs')));
      expect(result).toEqual({
        adapter: expectedGeneratedModuleProof(),
        handler: expectedHandlerPoisonProof(),
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 30_000);

  it('rejects global poison in Vercel and stays Node-free in Cloudflare', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-generated-edge-lock-'));
    try {
      const vercelBuild = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo-vercel'),
        serverHandlerSource: inlineNodePoisonHandlerSource(),
      });
      const vercelOut = join(root, 'vercel');
      await emit(vercel(), vercelBuild, vercelOut);
      await prependGeneratedModulePoison(join(vercelOut, 'functions/kovo.func/node-adapter.mjs'));
      const vercelEntry = join(vercelOut, 'functions/kovo.func/index.cjs');
      const vercelResult = runNodeRuntime(vercelRuntimeProbe(vercelEntry));
      expect(vercelResult).toEqual({
        adapter: expectedGeneratedModuleProof(),
        handler: expectedHandlerPoisonProof(),
      });

      const cloudflareBuild = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo-cloudflare'),
        serverHandlerSource: globalPoisonHandlerSource(),
      });
      const cloudflareOut = join(root, 'cloudflare');
      await emit(cloudflare(), cloudflareBuild, cloudflareOut);
      const cloudflareResult = runNodeRuntime(
        cloudflareRuntimeProbe(join(cloudflareOut, 'worker.mjs')),
      );
      expect(cloudflareResult).toEqual(expectedHandlerPoisonProof());
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 30_000);
});

async function emit(preset: KovoPreset, build: KovoNeutralBuild, outDir: string): Promise<void> {
  const engine: KovoBuildPreset | undefined = resolveKovoBuildPreset(preset);
  if (engine === undefined) throw new TypeError('Expected a framework-owned build preset token.');
  await engine.emit(build, {
    declaredEnv: [],
    log() {},
    outDir,
    readNeutral() {
      return build;
    },
  });
}

function expectEagerLockBeforeImports(source: string, imports: readonly string[]): void {
  const declaration = source.indexOf('const lockRequestSafeRuntimeRealm = (');
  const lock = source.indexOf('\nlockRequestSafeRuntimeRealm(', declaration);
  expect(declaration).toBeGreaterThanOrEqual(0);
  expect(lock).toBeGreaterThanOrEqual(0);
  for (const importedModule of imports) {
    const moduleImport = source.indexOf(importedModule);
    expect(moduleImport, importedModule).toBeGreaterThan(lock);
  }
}

async function prependGeneratedModulePoison(modulePath: string): Promise<void> {
  const source = await readFile(modulePath, 'utf8');
  await writeFile(modulePath, `${generatedModulePoisonSource()}\n${source}`);
}

function runNodeRuntime(source: string): unknown {
  const result = spawnSync(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', '--input-type=module', '--eval', source],
    { encoding: 'utf8', timeout: 20_000 },
  );
  expect(result.status, result.stderr).toBe(0);
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    throw new Error(`runtime stdout=${result.stdout}\nruntime stderr=${result.stderr}`);
  }
}

function nodeRuntimeProbe(serverPath: string): string {
  return `
const module = await import(${JSON.stringify(pathToFileURL(serverPath).href)});
const server = module.createKovoNodeServer();
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
const response = await fetch('http://127.0.0.1:' + address.port + '/');
const handler = JSON.parse(await response.text());
await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
process.stdout.write(JSON.stringify({
  adapter: globalThis.__kovoGeneratedModuleLockProof,
  handler,
}));
`;
}

function vercelRuntimeProbe(entryPath: string): string {
  return `
import { createServer } from 'node:http';
const module = await import(${JSON.stringify(pathToFileURL(entryPath).href)});
const handler = module.default ?? module;
const server = createServer((request, response) => handler(request, response));
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
const response = await fetch('http://127.0.0.1:' + address.port + '/');
const handlerProof = JSON.parse(await response.text());
await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
process.stdout.write(JSON.stringify({
  adapter: globalThis.__kovoGeneratedModuleLockProof,
  handler: handlerProof,
}));
`;
}

function cloudflareRuntimeProbe(workerPath: string): string {
  return `
const module = await import(${JSON.stringify(pathToFileURL(workerPath).href)});
const response = await module.default.fetch(new Request('https://worker.test/'), {});
process.stdout.write(await response.text());
`;
}

function nodePoisonPackageSource(): string {
  return `
const NativeResponse = globalThis.Response;
const nativeAtob = globalThis.atob;
const nativeBtoa = globalThis.btoa;
const NativeSubtleCrypto = globalThis.SubtleCrypto;
const NativeTextEncoder = globalThis.TextEncoder;
const nativeFetch = globalThis.fetch;
const nativeSetTimeout = setTimeout;
const nativeSubtleImportKey = globalThis.crypto.subtle.importKey;
const nativeSubtleSign = globalThis.crypto.subtle.sign;
const nativeTextEncoderEncode = globalThis.TextEncoder.prototype.encode;
const nativeStringNormalize = globalThis.String.prototype.normalize;
const subtlePrototype = Object.getPrototypeOf(globalThis.crypto.subtle);
const nativeFunctionCall = Function.prototype.call;
const nativeFunctionApply = Function.prototype.apply;
const nativeFunctionBind = Function.prototype.bind;
const nativeArrayFrom = Array.from;
function generatorPrototype() {
  return Object.getPrototypeOf(Object.getPrototypeOf((function* () {})()));
}
function asyncGeneratorPrototype() {
  return Object.getPrototypeOf(Object.getPrototypeOf((async function* () {})()));
}
function poisonAttempts() {
  const attempt = (change) => {
    try { return change(); } catch { return false; }
  };
  return [
    Reflect.set(globalThis, 'Response', class AttackerResponse {}),
    Reflect.set(globalThis, 'atob', () => 'attacker-atob'),
    Reflect.set(globalThis, 'btoa', () => 'attacker-btoa'),
    Reflect.set(globalThis, 'SubtleCrypto', class AttackerSubtleCrypto {}),
    Reflect.set(globalThis, 'TextEncoder', class AttackerTextEncoder {}),
    Reflect.set(globalThis, 'fetch', async () => new Response('attacker-fetch')),
    Reflect.set(globalThis, 'setTimeout', () => 0),
    Reflect.set(subtlePrototype, 'importKey', async () => 'attacker-key'),
    Reflect.set(subtlePrototype, 'sign', async () => new ArrayBuffer(0)),
    Reflect.set(globalThis.crypto.subtle, 'importKey', async () => 'attacker-own-key'),
    Reflect.set(globalThis.TextEncoder.prototype, 'encode', () => new Uint8Array()),
    Reflect.set(globalThis.String.prototype, 'normalize', () => 'attacker-normalize'),
    Reflect.set(Function.prototype, 'call', () => 'attacker-call'),
    Reflect.set(Function.prototype, 'apply', () => 'attacker-apply'),
    Reflect.set(Function.prototype, 'bind', () => () => 'attacker-bind'),
    Reflect.defineProperty(Array.from, 'call', {
      configurable: true,
      value: () => ['attacker-static-call'],
      writable: true,
    }),
    Reflect.set(Object.getPrototypeOf([][Symbol.iterator]()), 'next', () => ({ done: true })),
    Reflect.set(Object.getPrototypeOf(new Map().entries()), 'next', () => ({ done: true })),
    Reflect.set(Object.getPrototypeOf(new FormData().entries()), 'next', () => ({ done: true })),
    Reflect.set(Object.getPrototypeOf(new Headers().entries()), 'next', () => ({ done: true })),
    Reflect.set(Object.getPrototypeOf('safe'.matchAll(/./g)), 'next', () => ({ done: true })),
    Reflect.set(generatorPrototype(), 'next', () => ({ done: true })),
    Reflect.set(asyncGeneratorPrototype(), 'next', async () => ({ done: true })),
    attempt(() => Reflect.set(Error.prototype, 'name', 'AttackerError')),
  ];
}
const topLevelAttempts = poisonAttempts();
async function safeBehavior() {
  function join(left, right) { return this.prefix + left + right; }
  const formData = new FormData();
  formData.append('field', 'form-safe');
  const generator = (function* () { yield 'generator-safe'; })();
  const asyncGenerator = (async function* () { yield 'async-generator-safe'; })();
  const subclass = new (class UndiciStyleError extends Error {
    constructor() {
      super('instance-safe');
      this.name = 'UndiciStyleError';
    }
  })();
  return {
    applied: join.apply({ prefix: 'a' }, ['p', 'p']),
    array: [...['array-safe']][0],
    arrayFrom: Array.from(new Set(['array-from-safe']))[0],
    asyncGenerator: (await asyncGenerator.next()).value,
    base64: atob(btoa('base64-safe')),
    bound: join.bind({ prefix: 'b' }, 'i')('n'),
    called: join.call({ prefix: 'c' }, 'a', 'l'),
    errorName: subclass.name,
    formData: [...formData.entries()][0][1],
    generator: generator.next().value,
    headers: [...new Headers({ field: 'headers-safe' }).entries()][0][1],
    map: [...new Map([['field', 'map-safe']]).values()][0],
    matchAll: [...'match-safe'.matchAll(/match/g)][0][0],
  };
}
export async function poisonResult() {
  const deferredAttempts = await new Promise((resolve) => setTimeout(() => resolve(poisonAttempts()), 0));
  return {
    behavior: await safeBehavior(),
    deferredAttempts,
    exactIdentities: [
      globalThis.Response === NativeResponse,
      globalThis.atob === nativeAtob,
      globalThis.btoa === nativeBtoa,
      globalThis.SubtleCrypto === NativeSubtleCrypto,
      globalThis.TextEncoder === NativeTextEncoder,
      globalThis.fetch === nativeFetch,
      setTimeout === nativeSetTimeout,
      globalThis.crypto.subtle.importKey === nativeSubtleImportKey,
      globalThis.crypto.subtle.sign === nativeSubtleSign,
      globalThis.TextEncoder.prototype.encode === nativeTextEncoderEncode,
      globalThis.String.prototype.normalize === nativeStringNormalize,
      Function.prototype.call === nativeFunctionCall,
      Function.prototype.apply === nativeFunctionApply,
      Function.prototype.bind === nativeFunctionBind,
      Array.from === nativeArrayFrom,
    ],
    topLevelAttempts,
  };
}
`;
}

function generatedModulePoisonSource(): string {
  return `
const kovoGeneratedModuleLockProof = (() => {
  const NativeResponse = globalThis.Response;
  const nativeAtob = globalThis.atob;
  const nativeBtoa = globalThis.btoa;
  const NativeSubtleCrypto = globalThis.SubtleCrypto;
  const NativeTextEncoder = globalThis.TextEncoder;
  const nativeFetch = globalThis.fetch;
  const nativeFunctionCall = Function.prototype.call;
  const nativeSubtleImportKey = globalThis.crypto.subtle.importKey;
  const nativeTextEncoderEncode = globalThis.TextEncoder.prototype.encode;
  const nativeStringNormalize = globalThis.String.prototype.normalize;
  const subtlePrototype = Object.getPrototypeOf(globalThis.crypto.subtle);
  const nativeArrayIteratorNext = Object.getPrototypeOf([][Symbol.iterator]()).next;
  const attempts = [
    Reflect.set(globalThis, 'Response', class AttackerAdapterResponse {}),
    Reflect.set(globalThis, 'atob', () => 'attacker-adapter-atob'),
    Reflect.set(globalThis, 'btoa', () => 'attacker-adapter-btoa'),
    Reflect.set(globalThis, 'SubtleCrypto', class AttackerSubtleCrypto {}),
    Reflect.set(globalThis, 'TextEncoder', class AttackerTextEncoder {}),
    Reflect.set(globalThis, 'fetch', async () => new Response('attacker-adapter-fetch')),
    Reflect.set(subtlePrototype, 'importKey', async () => 'attacker-adapter-key'),
    Reflect.set(globalThis.crypto.subtle, 'importKey', async () => 'attacker-adapter-own-key'),
    Reflect.set(globalThis.TextEncoder.prototype, 'encode', () => new Uint8Array()),
    Reflect.set(globalThis.String.prototype, 'normalize', () => 'attacker-normalize'),
    Reflect.set(Function.prototype, 'call', () => 'attacker-adapter-call'),
    Reflect.defineProperty(Array.from, 'call', {
      configurable: true,
      value: () => ['attacker-adapter-static-call'],
      writable: true,
    }),
    Reflect.set(Object.getPrototypeOf([][Symbol.iterator]()), 'next', () => ({ done: true })),
    Reflect.set(Object.getPrototypeOf(new Map().entries()), 'next', () => ({ done: true })),
    Reflect.set(Object.getPrototypeOf(new FormData().entries()), 'next', () => ({ done: true })),
    Reflect.set(Object.getPrototypeOf('safe'.matchAll(/./g)), 'next', () => ({ done: true })),
  ];
  function join(left, right) { return this.prefix + left + right; }
  return {
    attempts,
    behavior: {
      array: [...['adapter-array-safe']][0],
      base64: atob(btoa('adapter-base64-safe')),
      called: join.call({ prefix: 'a' }, 'd', 'apter-safe'),
      map: [...new Map([['field', 'adapter-map-safe']]).values()][0],
      matchAll: [...'adapter-match-safe'.matchAll(/match/g)][0][0],
    },
    exactIdentities: [
      globalThis.Response === NativeResponse,
      globalThis.atob === nativeAtob,
      globalThis.btoa === nativeBtoa,
      globalThis.SubtleCrypto === NativeSubtleCrypto,
      globalThis.TextEncoder === NativeTextEncoder,
      globalThis.fetch === nativeFetch,
      globalThis.crypto.subtle.importKey === nativeSubtleImportKey,
      globalThis.TextEncoder.prototype.encode === nativeTextEncoderEncode,
      globalThis.String.prototype.normalize === nativeStringNormalize,
      Function.prototype.call === nativeFunctionCall,
      Object.getPrototypeOf([][Symbol.iterator]()).next === nativeArrayIteratorNext,
    ],
  };
})();
Object.defineProperty(globalThis, '__kovoGeneratedModuleLockProof', {
  configurable: true,
  enumerable: false,
  value: kovoGeneratedModuleLockProof,
  writable: false,
});
`;
}

function expectedGeneratedModuleProof(): unknown {
  return {
    attempts: Array.from({ length: 16 }, () => false),
    behavior: {
      array: 'adapter-array-safe',
      base64: 'adapter-base64-safe',
      called: 'adapter-safe',
      map: 'adapter-map-safe',
      matchAll: 'match',
    },
    exactIdentities: Array.from({ length: 11 }, () => true),
  };
}

function expectedHandlerPoisonProof(): unknown {
  return {
    behavior: {
      applied: 'app',
      array: 'array-safe',
      arrayFrom: 'array-from-safe',
      asyncGenerator: 'async-generator-safe',
      base64: 'base64-safe',
      bound: 'bin',
      called: 'cal',
      errorName: 'UndiciStyleError',
      formData: 'form-safe',
      generator: 'generator-safe',
      headers: 'headers-safe',
      map: 'map-safe',
      matchAll: 'match',
    },
    deferredAttempts: Array.from({ length: 24 }, () => false),
    exactIdentities: Array.from({ length: 15 }, () => true),
    topLevelAttempts: Array.from({ length: 24 }, () => false),
  };
}

function inlineNodePoisonHandlerSource(): string {
  return `${nodePoisonPackageSource()}
export default async function handler() {
  return new Response(JSON.stringify(await poisonResult()));
}
`;
}

function globalPoisonHandlerSource(): string {
  return `${nodePoisonPackageSource()}
export default async function handler() {
  return new Response(JSON.stringify(await poisonResult()));
}
`;
}
