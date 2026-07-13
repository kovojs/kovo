import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  appWithBuildStylesheetAssets,
  kovoServerHandlerEntrySource,
  serializeBuildRuntimeRegistryWireModule,
} from './build-export.js';
import {
  buildPromiseAll,
  buildSnapshotDenseArray,
  buildStringSplit,
} from './build-security-intrinsics.js';

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
    expect(source).toContain('appendFrameworkRuntimeArrayValue');
    expect(source).not.toContain('[result.length]');
    expect(source).not.toContain('[hrefOrder.length]');
    expect(source).not.toContain('[chunksByHref.length]');
    expect(source).not.toContain('.map(');
    expect(source).not.toContain('new Map(');
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

  it('does not erase build snapshots through inherited numeric setters', () => {
    const nativeDefineProperty = Object.defineProperty;
    const originalDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    const source = ['reviewed-build-fact'];
    let poisonHits = 0;
    let snapshot: string[] | undefined;
    try {
      nativeDefineProperty(Array.prototype, '0', {
        configurable: true,
        set(value: unknown) {
          if (value === 'reviewed-build-fact') {
            poisonHits += 1;
            return;
          }
          nativeDefineProperty(this, '0', {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
        },
      });
      snapshot = buildSnapshotDenseArray(source, 'Build setter proof');
    } finally {
      if (originalDescriptor === undefined) {
        delete (Array.prototype as unknown as Record<string, unknown>)['0'];
      } else {
        nativeDefineProperty(Array.prototype, '0', originalDescriptor);
      }
    }
    expect(snapshot).toEqual(['reviewed-build-fact']);
    expect(poisonHits).toBe(0);
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

  it('does not redispatch closed app route authority through a late exact Array.map receiver', () => {
    const declaredRoute = { path: '/declared', stylesheets: [] };
    const forgedRoute = { path: '/forged-admin', stylesheets: [] };
    const app = {
      liveTargetRenderers: [],
      routes: [declaredRoute],
      stylesheets: [],
    } as never;
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;

    try {
      Array.prototype.map = function poisonedClosedRouteMap(this: any[], callback, thisArg) {
        if (this === (app as { routes: unknown[] }).routes) {
          poisonHits += 1;
          return [forgedRoute] as unknown[];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      } as typeof Array.prototype.map;
      const derived = appWithBuildStylesheetAssets(
        app,
        {
          app: [],
          fragments: {},
          routes: {
            '/declared': [{ href: '/assets/declared.css' }],
            '/forged-admin': [{ href: '/assets/forged.css' }],
          },
        },
        ((source: object, overrides: object) => ({ ...source, ...overrides })) as never,
      ) as unknown as { routes: { path: string }[] };

      expect(poisonHits).toBe(0);
      expect(derived.routes).toHaveLength(1);
      expect(derived.routes[0]?.path).toBe('/declared');
    } finally {
      Array.prototype.map = nativeMap;
    }
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

  it('keeps first-use compiler truth across process restarts under selective lookalikes', () => {
    const root = cliFixtureRoot('restart-selective-matrix');
    const appPath = join(root, 'app.ts');
    try {
      writeFileSync(
        join(root, 'kovo.config.mjs'),
        `import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const probe = crypto.createHash('sha256');
const prototype = Object.getPrototypeOf(probe);
const nativeUpdate = prototype.update;
const nativeApply = Reflect.apply;
let calls = 0;
prototype.update = function selectiveHashLookalike(data, encoding) {
  // Deliberately selective across the C69 dimensions: input bytes, size, receiver, and call count.
  calls += 1;
  const text = typeof data === 'string' ? data : '';
  const size = typeof data === 'string' ? Buffer.byteLength(data) : (data?.byteLength ?? -1);
  const replacement = this !== probe && calls > 0 && size > 16 && text.includes('Cookie')
    ? text.replaceAll('Cookie', 'ReviewedHeader')
    : data;
  return nativeApply(nativeUpdate, this, [replacement, encoding]);
};

// Path-specific facade replacement must be rejected before the app graph is imported.
const pathInstalled = Reflect.set(path, 'resolve', () => '/tmp/omitted-security-source');
const fsInstalled = Reflect.set(fs, 'readFileSync', () => 'export default {}');
if (pathInstalled || fsInstalled) throw new Error('path-specific compiler poison installed');

export default {};
`,
        'utf8',
      );
      writeFileSync(
        appPath,
        `import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';

const unsafe = mutation('auth/restart-selective', {
  access: publicAccess('C69 restart regression'),
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

      for (let restart = 0; restart < 2; restart += 1) {
        const outDir = join(root, `dist-${restart}`);
        const result = runKovoCli(root, ['build', appPath, '--out', outDir]);
        expect(result.status, result.stderr).toBe(1);
        expect(result.stderr).toContain('ERROR KV418 MUTATION auth/restart-selective');
        expect(result.stderr).not.toContain('path-specific compiler poison installed');
        expect(readFileIfPresent(join(outDir, '.kovo/graph.json'))).toBeUndefined();
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('pins operator paranoid disposition before app evaluation in the real CLI', () => {
    const root = cliFixtureRoot('paranoid-disposition');
    const appPath = join(root, 'app.ts');
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(
        join(root, 'index.html'),
        '<!doctype html><script type="module" src="/src/client.ts"></script>\n',
        'utf8',
      );
      writeFileSync(join(root, 'src/client.ts'), 'export {};\n', 'utf8');
      writeFileSync(
        appPath,
        `import { createApp, publicAccess, query, route, s } from '@kovojs/server';

if (process.env.APP_PARANOID_MUTATION === 'enable') process.env.KOVO_PARANOID = '1';
if (process.env.APP_PARANOID_MUTATION === 'disable') delete process.env.KOVO_PARANOID;

const accounts = {};
const badRead = query('badRead', {
  access: publicAccess('paranoid disposition regression'),
  async load(_input, db) {
    await db.update(accounts).set({ role: 'admin' });
    return { id: 'a1' };
  },
  output: s.object({ id: s.string() }),
});

export default createApp({
  queries: [badRead],
  routes: [route('/', {
    access: publicAccess('paranoid disposition regression'),
    page: () => '<main>Paranoid disposition</main>',
  })],
});
`,
        'utf8',
      );

      const ordinaryEnv = { ...process.env, APP_PARANOID_MUTATION: 'enable' };
      delete ordinaryEnv.KOVO_PARANOID;
      const appEnabled = runKovoCli(
        root,
        ['build', appPath, '--out', join(root, 'app-enabled'), '--check'],
        ordinaryEnv,
      );
      expect(appEnabled.status, appEnabled.stderr).toBe(1);
      expect(appEnabled.stderr).toContain('ERROR KV406 QUERY badRead');
      expect(readFileIfPresent(join(root, 'app-enabled/.kovo/graph.json'))).toBeUndefined();

      const operatorParanoid = runKovoCli(
        root,
        ['build', appPath, '--out', join(root, 'operator-paranoid'), '--check'],
        { ...process.env, APP_PARANOID_MUTATION: 'disable', KOVO_PARANOID: '1' },
      );
      expect(operatorParanoid.status, operatorParanoid.stderr).toBe(0);
      expect(operatorParanoid.stdout).toContain('CHECK ok preset=node');
      expect(readFileSync(join(root, 'operator-paranoid/.kovo/graph.json'), 'utf8')).toContain(
        'KV406',
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('keeps real build and export outside undeclared authored Vite config hooks', () => {
    const root = cliFixtureRoot('undeclared-vite-config');
    const appPath = join(root, 'app.mjs');
    const markerPath = join(root, 'vite-config-evaluated.marker');
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(
        join(root, 'index.html'),
        '<!doctype html><script type="module" src="/src/client.ts"></script>\n',
        'utf8',
      );
      writeFileSync(join(root, 'src/client.ts'), 'export {};\n', 'utf8');
      writeFileSync(
        join(root, 'vite.config.mjs'),
        `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(markerPath)}, 'evaluated', 'utf8');
throw new Error('undeclared authored Vite config evaluated');
`,
        'utf8',
      );
      writeFileSync(
        appPath,
        `import { createApp, publicAccess, route } from '@kovojs/server';
export default createApp({
  routes: [route('/', {
    access: publicAccess('C74 undeclared Vite config regression'),
    page: () => 'C74-safe-document',
  })],
});
`,
        'utf8',
      );

      const buildOut = join(root, 'build-dist');
      const built = runKovoCli(root, ['build', appPath, '--out', buildOut, '--check']);
      expect(built.status, built.stderr).toBe(0);
      expect(built.stdout).toContain('CHECK ok preset=node');
      expect(readFileIfPresent(markerPath)).toBeUndefined();

      const exportOut = join(root, 'export-dist');
      const exported = runKovoCli(root, ['export', appPath, '--out', exportOut]);
      expect(exported.status, exported.stderr).toBe(0);
      expect(readFileSync(join(exportOut, 'index.html'), 'utf8')).toContain('C74-safe-document');
      expect(readFileIfPresent(markerPath)).toBeUndefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);
});

function cliFixtureRoot(name: string): string {
  const repoRoot = process.cwd();
  const root = mkdtempSync(join(repoRoot, `.tmp-kovo-${name}-`));
  mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
  symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
  writeFileSync(join(root, 'package.json'), '{"private":true,"type":"module"}\n', 'utf8');
  return root;
}

function runKovoCli(root: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(join(process.cwd(), 'packages/cli/src/bin.ts'), args, {
    cwd: root,
    encoding: 'utf8',
    env,
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
