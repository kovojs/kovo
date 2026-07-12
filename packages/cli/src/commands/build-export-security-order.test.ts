import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  kovoServerHandlerEntrySource,
  serializeBuildRuntimeRegistryWireModule,
} from './build-export.js';
import { buildPromiseAll, buildStringSplit } from './build-security-intrinsics.js';

describe('build/export security bootstrap ordering', () => {
  it('imports the server bootstrap owner before generated registry and app modules', () => {
    const source = kovoServerHandlerEntrySource('/tmp/kovo/app.mjs', {
      app: [],
      fragments: {},
      routes: {},
    });
    const serverImport = source.indexOf("import { createRequestHandler } from '@kovojs/server';");
    const registryImport = source.indexOf("import './runtime-registry.mjs';");
    const appImport = source.indexOf('import * as appModule from');

    expect(serverImport).toBeGreaterThanOrEqual(0);
    expect(serverImport).toBeLessThan(registryImport);
    expect(registryImport).toBeLessThan(appImport);
  });

  it('does not let a late JSON.stringify replacement inject generated modules', () => {
    const nativeStringify = JSON.stringify;
    const marker = 'globalThis.__kovoBuildJsonInjection = true';
    try {
      JSON.stringify = (() => `null);${marker};//`) as typeof JSON.stringify;

      const handler = kovoServerHandlerEntrySource('/tmp/kovo/app.mjs', {
        app: [{ href: '/assets/app.css' }],
        fragments: {},
        routes: {},
      });
      const registry = serializeBuildRuntimeRegistryWireModule({
        mutationTouches: {
          save: [{ domain: 'accounts', keys: 'id' }],
        },
        queryReads: [{ domains: ['accounts'], query: 'account' }],
      });

      expect(handler).not.toContain(marker);
      expect(handler).toContain('"/assets/app.css"');
      expect(registry).not.toContain(marker);
      expect(registry).toContain('"query":"account"');
      expect(registry).toContain('"domain":"accounts"');
    } finally {
      JSON.stringify = nativeStringify;
    }
  });

  it('does not dispatch build parsing through a late String symbol split hook', () => {
    const descriptor = Object.getOwnPropertyDescriptor(String.prototype, Symbol.split);
    Object.defineProperty(String.prototype, Symbol.split, {
      configurable: true,
      value: () => [],
    });
    try {
      expect(buildStringSplit('ERROR KV418\nCHECK forbidden', '\n')).toEqual([
        'ERROR KV418',
        'CHECK forbidden',
      ]);
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(String.prototype, Symbol.split);
      else Object.defineProperty(String.prototype, Symbol.split, descriptor);
    }
  });

  it('does not let late Promise/iterator controls replace build-join inputs', async () => {
    const first = Promise.resolve('first');
    const second = Promise.resolve('second');
    const values = [first, second] as const;
    const nativeIterator = Array.prototype[Symbol.iterator];
    const nativeResolve = Promise.resolve;
    let pending: Promise<readonly [string, string]>;
    try {
      Array.prototype[Symbol.iterator] = function poisonedBuildPromiseIterator<T>() {
        if (this === values) return Reflect.apply(nativeIterator, [], []);
        return Reflect.apply(nativeIterator, this, []);
      };
      Promise.resolve = function poisonedBuildPromiseResolve<T>(value: T | PromiseLike<T>) {
        if (value === first || value === second) {
          return Reflect.apply(nativeResolve, Promise, ['forged']) as Promise<Awaited<T>>;
        }
        return Reflect.apply(nativeResolve, Promise, [value]);
      };
      pending = buildPromiseAll(values);
    } finally {
      Array.prototype[Symbol.iterator] = nativeIterator;
      Promise.resolve = nativeResolve;
    }
    await expect(pending!).resolves.toEqual(['first', 'second']);
  });

  it('keeps a real CLI build blocking after app-first Array.filter poisoning is refused', () => {
    const root = cliFixtureRoot('build-lowerer-poison');
    const appPath = join(root, 'app.ts');
    const outDir = join(root, 'dist');
    try {
      writeFileSync(
        join(root, 'kovo.config.mjs'),
        `import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import ts from 'typescript';

const replacements = [
  Reflect.set(path, 'resolve', () => '/tmp/omitted-security-source'),
  Reflect.set(ts, 'createSourceFile', () => ({ statements: [] })),
  Reflect.set(Date, 'now', () => 0),
  Reflect.set(URLSearchParams.prototype, 'get', () => null),
];
syncBuiltinESMExports();
if (replacements.some(Boolean)) {
  throw new Error('compiler path/TypeScript/time/URL poison unexpectedly installed');
}

export default {};
`,
        'utf8',
      );
      writeFileSync(
        appPath,
        `import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';

let poisonRejected = false;
try {
  Reflect.set(Array.prototype, 'filter', function omitUnsafe(values) {
    return values.filter((value) => !String(value).includes('Cookie'));
  });
} catch {
  poisonRejected = true;
}
if (!poisonRejected) throw new Error('Array.filter poison unexpectedly installed');

const unsafe = mutation('auth/lowerer-poison', {
  access: publicAccess('bootstrap poison regression'),
  csrf: false,
  input: s.object({}),
  handler(_input, request) {
    return { cookie: request.headers.get('Cookie') };
  },
});

export default createApp({
  mutations: [unsafe],
  routes: [route('/', { access: publicAccess('fixture'), page: () => '<main>Unsafe</main>' })],
});
`,
        'utf8',
      );

      const result = runKovoCli(root, ['build', appPath, '--out', outDir]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('ERROR KV418 MUTATION auth/lowerer-poison');
      expect(readFileIfPresent(join(outDir, '.kovo/graph.json'))).toBeUndefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 60_000);

  it('keeps real CLI export bytes exact after app-first String.replace poisoning is refused', () => {
    const root = cliFixtureRoot('export-lowerer-poison');
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    try {
      writeFileSync(
        appPath,
        `import { createApp, publicAccess, route } from '@kovojs/server';
import { renderedHtml } from '@kovojs/server/internal/html';

let poisonRejected = false;
try {
  Reflect.set(String.prototype, 'replace', () => 'attacker-output');
} catch {
  poisonRejected = true;
}
if (!poisonRejected) throw new Error('String.replace poison unexpectedly installed');

export default createApp({
  routes: [route('/', {
    access: publicAccess('bootstrap poison regression'),
    page: () => renderedHtml('<main data-exact-export>Exact export</main>'),
  })],
});
`,
        'utf8',
      );

      const result = runKovoCli(root, ['export', appPath, '--out', outDir]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('SUMMARY html=1');
      expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toContain(
        '<main data-exact-export>Exact export</main>',
      );
      expect(readFileSync(join(outDir, 'index.html'), 'utf8')).not.toContain('attacker-output');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 60_000);
});

function cliFixtureRoot(name: string): string {
  const repoRoot = process.cwd();
  const root = mkdtempSync(join(repoRoot, `.tmp-kovo-${name}-`));
  mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
  symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
  writeFileSync(join(root, 'package.json'), '{"private":true,"type":"module"}\n', 'utf8');
  return root;
}

function runKovoCli(root: string, args: readonly string[]) {
  return spawnSync(join(process.cwd(), 'packages/cli/src/bin.ts'), args, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    timeout: 55_000,
  });
}

function readFileIfPresent(fileName: string): string | undefined {
  try {
    return readFileSync(fileName, 'utf8');
  } catch {
    return undefined;
  }
}
