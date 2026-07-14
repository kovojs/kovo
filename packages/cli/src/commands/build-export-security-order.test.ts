import { spawnSync } from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { mutationHandlerFingerprintFromRuntimeSource } from '@kovojs/compiler/internal';
import type { KovoApp } from '@kovojs/server';

import {
  appWithBuildStylesheetAssets,
  completeMutationSessionAuthorityFacts,
  kovoServerHandlerEntrySource,
  serializeBuildRuntimeRegistryWireModule,
} from './build-export.js';
import {
  buildPromiseAll,
  buildSnapshotDenseArray,
  buildStringSplit,
} from './build-security-intrinsics.js';

describe('build/export security bootstrap ordering', () => {
  it('keeps the production authority join fail-closed under a late createHash replacement', () => {
    // SPEC §2/§11.4: an evaluated csrf-exempt handler must match the exact handler inspected
    // statically. A late digest collision must not let an ambient-authority handler inherit proof.
    const safeHandler = () => 'safe';
    const unsafeHandler = () => globalThis.document.cookie;
    const safeFingerprint = mutationHandlerFingerprintFromRuntimeSource(
      Function.prototype.toString.call(safeHandler),
    );
    const unsafeFingerprint = mutationHandlerFingerprintFromRuntimeSource(
      Function.prototype.toString.call(unsafeHandler),
    );
    expect(safeFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(unsafeFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(safeFingerprint).not.toBe(unsafeFingerprint);

    const require = createRequire(import.meta.url);
    const mutableCrypto = require('node:crypto') as {
      createHash: (typeof import('node:crypto'))['createHash'];
    };
    const nativeCreateHash = mutableCrypto.createHash;
    mutableCrypto.createHash = (() => ({
      // A vulnerable late-hash join would now cross-bind the unsafe runtime handler to the exact
      // safe static fingerprint. Returning an unrelated digest would not exercise that bypass.
      digest: () => safeFingerprint!,
      update() {
        return this;
      },
    })) as unknown as typeof mutableCrypto.createHash;
    syncBuiltinESMExports();

    try {
      const facts = completeMutationSessionAuthorityFacts(
        {
          mutations: [{ csrf: false, handler: unsafeHandler, key: 'auth/save' }],
        } as unknown as KovoApp,
        [
          {
            handlerFingerprints: [safeFingerprint!],
            kind: 'mutation',
            name: 'auth/save',
            referencesSession: false,
            source: 'session-authority',
          },
        ],
      );

      expect(facts).toContainEqual({
        detail: 'runtime csrf-exempt handler identity was not covered by the static authority scan',
        kind: 'mutation',
        name: 'auth/save',
        referencesSession: true,
        source: 'session-authority',
      });
    } finally {
      mutableCrypto.createHash = nativeCreateHash;
      syncBuiltinESMExports();
    }
  });

  it('imports the server bootstrap owner before generated registry and app modules', () => {
    const source = kovoServerHandlerEntrySource('/tmp/kovo/app.mjs', {
      app: [],
      fragments: {},
      routes: {},
    });
    const registryImport = source.indexOf("import './runtime-registry.mjs';");
    const serverImport = source.indexOf(
      "import { createRequestHandler, deriveClosedKovoApp, runWithGeneratedLiveTargetRegistry } from '@kovojs/server/internal/app-shell-vite';",
    );
    const appImport = source.indexOf('const appModule = await runWithGeneratedLiveTargetRegistry');

    expect(serverImport).toBeGreaterThanOrEqual(0);
    expect(registryImport).toBeLessThan(serverImport);
    expect(serverImport).toBeLessThan(appImport);
    expect(source).not.toContain("from '@kovojs/server';");
    expect(source).not.toContain('lockServerRequestSafeRuntimeRealm();');
    expect(source).not.toContain('import * as appModule from');
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

const lockedFilter = Array.prototype.filter;
const poisonInstalled = Reflect.set(Array.prototype, 'filter', function omitUnsafe(values) {
  return values.filter((value) => !String(value).includes('Cookie'));
});
if (poisonInstalled || Array.prototype.filter !== lockedFilter) {
  throw new Error('Array.filter poison unexpectedly installed');
}

const unsafe = mutation('auth/lowerer-poison', {
  access: publicAccess('bootstrap poison regression'),
  csrf: false,
  csrfJustification: 'exercise the missing-CSRF compiler diagnostic',
  input: s.object({}),
  handler(_input, request) {
    // SPEC §6.6: keep the ambient read server-local so KV418 owns this regression signal.
    request.headers.get('Cookie');
    return { ok: true };
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

if (Reflect.set(String.prototype, 'replace', () => 'attacker-output')) {
  throw new Error('String.replace poison unexpectedly installed');
}

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
  csrfJustification: 'exercise the missing-CSRF compiler diagnostic across restarts',
  input: s.object({}),
  handler(_input, request) {
    // SPEC §6.6: keep the ambient read server-local so KV418 owns this regression signal.
    request.headers.get('Cookie');
    return { ok: true };
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

  it('eagerly binds compiler graph and Drizzle analyzer truth before authored resolver hooks', () => {
    const root = cliFixtureRoot('resolver-hook-static-gates');
    const appPath = join(root, 'app.ts');
    try {
      symlinkSync(
        join(process.cwd(), 'packages/drizzle'),
        join(root, 'node_modules/@kovojs/drizzle'),
      );
      writeFileSync(
        join(root, 'kovo.config.mjs'),
        `import { registerHooks } from 'node:module';

const emptyGraph = 'data:text/javascript,' + encodeURIComponent(
  'export function deriveAppGraph(){return {graph:{},diagnostics:[]}}',
);
const emptyStatic = 'data:text/javascript,' + encodeURIComponent(
  'export function collectCapabilityEscapesFromProject(){return []};' +
  'export function collectCookieDowngradesFromProject(){return []};' +
  'export function extractStaticBuildAnalysisFactsFromProject(){return {queries:[],sqlSafetyDiagnostics:[],toctouFacts:[],touchGraph:{}}}',
);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@kovojs/compiler/graph') return { shortCircuit: true, url: emptyGraph };
    if (specifier === '@kovojs/drizzle/internal/static') return { shortCircuit: true, url: emptyStatic };
    return nextResolve(specifier, context);
  },
});
export default {};
`,
        'utf8',
      );
      writeFileSync(
        appPath,
        `import { sql } from '@kovojs/drizzle';
import { createApp, publicAccess, route } from '@kovojs/server';

export async function unsafe(db, input) {
  return db.execute(sql.raw(input.id));
}

export default createApp({
  routes: [route('/', { access: publicAccess('resolver hook regression'), page: () => '<main>Unsafe</main>' })],
});
`,
        'utf8',
      );

      const outDir = join(root, 'dist');
      const result = runKovoCli(root, ['build', appPath, '--out', outDir]);
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain('ERROR KV422');
      expect(result.stderr).toContain('sql.raw');
      expect(readFileIfPresent(join(outDir, '.kovo/graph.json'))).toBeUndefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 60_000);

  it('refuses server source changed by an authored config timer after security preflight', () => {
    const root = cliFixtureRoot('build-source-snapshot');
    const appPath = join(root, 'src/app.ts');
    const helperPath = join(root, 'dangerous.ts');
    const outDir = join(root, 'dist');
    const safeSource = `export async function dangerous(_request: unknown) {
  return 'safe';
}
`;
    const unsafeSource = `import { sql } from '@kovojs/drizzle';
export async function dangerous(request: any) {
  const rows = await request.db.execute(sql.raw(request.search.get('q')));
  return new Response(String(rows));
}
`;
    try {
      symlinkSync(
        join(process.cwd(), 'packages/drizzle'),
        join(root, 'node_modules/@kovojs/drizzle'),
      );
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(
        join(root, 'index.html'),
        '<!doctype html><script type="module" src="/src/client.ts"></script>\n',
        'utf8',
      );
      writeFileSync(join(root, 'src/client.ts'), 'export {};\n', 'utf8');
      writeFileSync(helperPath, safeSource, 'utf8');
      writeFileSync(
        join(root, 'kovo.config.mjs'),
        `import { existsSync, writeFileSync } from 'node:fs';
const helperPath = ${JSON.stringify(helperPath)};
const triggerPath = ${JSON.stringify(join(outDir, '.kovo-client'))};
const unsafeSource = ${JSON.stringify(unsafeSource)};
const timer = setInterval(() => {
  if (!existsSync(triggerPath)) return;
  writeFileSync(helperPath, unsafeSource);
  clearInterval(timer);
}, 1);
timer.unref();
export default {};
`,
        'utf8',
      );
      writeFileSync(
        appPath,
        `import { createApp, publicAccess, route } from '@kovojs/server';
import { dangerous } from '../dangerous.ts';

export default createApp({
  routes: [route('/', { access: publicAccess('source snapshot regression'), page: dangerous })],
});
`,
        'utf8',
      );

      const result = runKovoCli(root, ['build', appPath, '--out', outDir]);
      expect(readFileSync(helperPath, 'utf8')).toBe(unsafeSource);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Kovo build refused changed app source dangerous.ts');
      expect(result.stderr).toContain('security-preflight snapshot');
      expect(readFileIfPresent(join(outDir, '.kovo/server/handler.mjs'))).toBeUndefined();
      expect(readFileIfPresent(join(outDir, 'server/server/handler.mjs'))).toBeUndefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 60_000);

  it('refuses a new relative app module introduced after security preflight', () => {
    const root = cliFixtureRoot('build-new-source-snapshot');
    const appPath = join(root, 'src/app.ts');
    const lateDir = join(root, 'late');
    const latePath = join(lateDir, 'unsafe.ts');
    const outDir = join(root, 'dist');
    const lateSource = `import { sql } from '@kovojs/drizzle';
export async function unsafe(request: any) {
  return request.db.execute(sql.raw(request.search.get('q')));
}
`;
    try {
      symlinkSync(
        join(process.cwd(), 'packages/drizzle'),
        join(root, 'node_modules/@kovojs/drizzle'),
      );
      mkdirSync(join(root, 'src'), { recursive: true });
      mkdirSync(lateDir, { recursive: true });
      writeFileSync(
        join(root, 'index.html'),
        '<!doctype html><script type="module" src="/src/client.ts"></script>\n',
        'utf8',
      );
      writeFileSync(join(root, 'src/client.ts'), 'export {};\n', 'utf8');
      writeFileSync(
        join(root, 'kovo.config.mjs'),
        `import { existsSync, writeFileSync } from 'node:fs';
const latePath = ${JSON.stringify(latePath)};
const triggerPath = ${JSON.stringify(join(outDir, '.kovo-client'))};
const lateSource = ${JSON.stringify(lateSource)};
const timer = setInterval(() => {
  if (!existsSync(triggerPath)) return;
  writeFileSync(latePath, lateSource);
  clearInterval(timer);
}, 1);
timer.unref();
export default {};
`,
        'utf8',
      );
      writeFileSync(
        appPath,
        `import { createApp, publicAccess, route } from '@kovojs/server';
const lateModules = import.meta.glob('../late/*.ts', { eager: true });
if (Object.keys(lateModules).length > 1) throw new Error('unexpected late module count');

export default createApp({
  routes: [route('/', { access: publicAccess('new source snapshot regression'), page: () => 'safe' })],
});
`,
        'utf8',
      );

      const result = runKovoCli(root, ['build', appPath, '--out', outDir]);
      expect(readFileSync(latePath, 'utf8')).toBe(lateSource);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Kovo build refused unapproved app source late/unsafe.ts');
      expect(result.stderr).toContain('introduced after the security preflight');
      expect(readFileIfPresent(join(outDir, '.kovo/server/handler.mjs'))).toBeUndefined();
      expect(readFileIfPresent(join(outDir, 'server/server/handler.mjs'))).toBeUndefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 60_000);

  it('never follows an app-planted static-analysis cache symlink outside the project', () => {
    const root = cliFixtureRoot('static-cache-symlink');
    const outside = mkdtempSync(join(tmpdir(), 'kovo-static-cache-victim-'));
    const appPath = join(root, 'app.ts');
    try {
      symlinkSync(
        join(process.cwd(), 'packages/drizzle'),
        join(root, 'node_modules/@kovojs/drizzle'),
      );
      mkdirSync(join(root, '.kovo/cache'), { recursive: true });
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(outside, 'victim.txt'), 'ORIGINAL\n', 'utf8');
      symlinkSync(outside, join(root, '.kovo/cache/static-build-analysis'));
      writeFileSync(
        join(root, 'index.html'),
        '<!doctype html><script type="module" src="/src/client.ts"></script>\n',
        'utf8',
      );
      writeFileSync(join(root, 'src/client.ts'), 'export {};\n', 'utf8');
      writeFileSync(
        appPath,
        `import { sql } from '@kovojs/drizzle';
import { createApp, publicAccess, route } from '@kovojs/server';
export const reviewed = sql.raw('select 1');
export default createApp({
  routes: [route('/', { access: publicAccess('cache symlink regression'), page: () => '<main>Safe</main>' })],
});
`,
        'utf8',
      );

      const result = runKovoCli(root, ['build', appPath, '--out', join(root, 'dist')]);
      expect(result.status, result.stderr).toBe(0);
      expect(readdirSync(outside)).toEqual(['victim.txt']);
      expect(readFileSync(join(outside, 'victim.txt'), 'utf8')).toBe('ORIGINAL\n');
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  }, 60_000);

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

  it('pins build and export paths before authored process.chdir() in the real CLI', () => {
    const root = cliFixtureRoot('invocation-cwd');
    const outside = mkdtempSync(join(tmpdir(), 'kovo-cli-cwd-outside-'));
    const appPath = join(root, 'app.ts');
    try {
      writeFileSync(
        join(root, 'package.json'),
        '{"dependencies":{"root-runtime":"1.0.0"},"private":true,"type":"module"}\n',
        'utf8',
      );
      writeFileSync(
        join(root, 'pnpm-lock.yaml'),
        "lockfileVersion: '9.0'\nroot-marker: true\n",
        'utf8',
      );
      writeFileSync(
        join(outside, 'package.json'),
        '{"dependencies":{"attacker-runtime":"9.9.9"},"private":true,"type":"module"}\n',
        'utf8',
      );
      writeFileSync(
        join(outside, 'pnpm-lock.yaml'),
        "lockfileVersion: '9.0'\nattacker-marker: true\n",
        'utf8',
      );
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(
        join(root, 'index.html'),
        '<!doctype html><script type="module" src="/src/client.ts"></script>\n',
        'utf8',
      );
      writeFileSync(join(root, 'src/client.ts'), 'export {};\n', 'utf8');
      writeFileSync(
        appPath,
        `import { createApp, publicAccess, route } from '@kovojs/server';

process.chdir(process.env.APP_AUTHORED_CWD_MUTATION!);

export default createApp({
  routes: [route('/', {
    access: publicAccess('invocation cwd regression'),
    page: () => '<main>Invocation cwd</main>',
  })],
});
`,
        'utf8',
      );

      const env = { ...process.env, APP_AUTHORED_CWD_MUTATION: outside };
      const build = runKovoCli(root, ['build', './app.ts', '--out', 'dist', '--check'], env);
      expect(build.status, build.stderr).toBe(0);
      expect(build.stdout).toContain(`NEUTRAL outDir=${JSON.stringify(join(root, 'dist/.kovo'))}`);
      expect(existsSync(join(root, 'dist/.kovo/graph.json'))).toBe(true);
      expect(existsSync(join(root, '.kovo/cache/static-build-analysis'))).toBe(false);
      expect(existsSync(join(outside, 'dist'))).toBe(false);
      expect(existsSync(join(outside, '.kovo'))).toBe(false);

      const deploy = runKovoCli(root, ['build', './app.ts', '--out', 'deploy-dist'], env);
      expect(deploy.status, deploy.stderr).toBe(0);
      expect(readFileSync(join(root, 'deploy-dist/server/package.json'), 'utf8')).toContain(
        'root-runtime',
      );
      expect(readFileSync(join(root, 'deploy-dist/server/package.json'), 'utf8')).not.toContain(
        'attacker-runtime',
      );
      expect(readFileSync(join(root, 'deploy-dist/server/pnpm-lock.yaml'), 'utf8')).toContain(
        'root-marker',
      );
      expect(readFileSync(join(root, 'deploy-dist/server/pnpm-lock.yaml'), 'utf8')).not.toContain(
        'attacker-marker',
      );

      const exported = runKovoCli(root, ['export', './app.ts', '--out', 'export-dist'], env);
      expect(exported.status, exported.stderr).toBe(0);
      expect(existsSync(join(root, 'export-dist/index.html'))).toBe(true);
      expect(existsSync(join(outside, 'export-dist'))).toBe(false);
    } finally {
      rmSync(outside, { force: true, recursive: true });
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('locks a real uncached CLI artifact before bundled package and deferred poison', () => {
    const root = cliFixtureRoot('runtime-intrinsic-lockdown');
    const appPath = join(root, 'app.ts');
    const packageRoot = join(root, 'node_modules/kovo-runtime-poison');
    const outDir = join(root, 'dist');
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(
        join(root, 'index.html'),
        '<!doctype html><script type="module" src="/src/client.ts"></script>\n',
        'utf8',
      );
      writeFileSync(join(root, 'src/client.ts'), 'export {};\n', 'utf8');
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({ exports: './index.mjs', name: 'kovo-runtime-poison', type: 'module' }),
      );
      writeFileSync(
        join(packageRoot, 'index.mjs'),
        `const NativeResponse = globalThis.Response;
const nativeSetTimeout = setTimeout;
const nativeErrorName = Error.prototype.name;
let coercionHit = false;
function attemptPrototypePoison() {
  try {
    return Reflect.set(Error.prototype, 'name', {
      toString() { coercionHit = true; return 'AttackerError'; },
    });
  } catch {
    return false;
  }
}
const topLevelAttempts = [
  Reflect.set(globalThis, 'Response', class AttackerResponse {}),
  Reflect.set(globalThis, 'setTimeout', () => 0),
  attemptPrototypePoison(),
];
const exactIdentities = [
  globalThis.Response === NativeResponse,
  setTimeout === nativeSetTimeout,
  Error.prototype.name === nativeErrorName,
];
const deferredAttempts = await new Promise((resolve) => setTimeout(() => resolve([
  Reflect.set(globalThis, 'Response', class DeferredResponse {}),
  Reflect.set(globalThis, 'setTimeout', () => 0),
  attemptPrototypePoison(),
]), 0));
class UndiciStyleError extends Error {
  constructor() {
    super('instance-safe');
    this.name = 'UndiciStyleError';
  }
}
const subclass = new UndiciStyleError();
if (
  topLevelAttempts.some(Boolean) ||
  deferredAttempts.some(Boolean) ||
  exactIdentities.some((value) => !value) ||
  coercionHit ||
  subclass.name !== 'UndiciStyleError' ||
  !Object.hasOwn(subclass, 'name')
) {
  throw new Error('runtime intrinsic lockdown regression');
}
`,
        'utf8',
      );
      writeFileSync(
        appPath,
        `import 'kovo-runtime-poison';
import { createApp, endpoint, publicAccess } from '@kovojs/server';

const proof = endpoint('/proof', {
  access: publicAccess('runtime intrinsic lockdown regression'),
  handler: async () => Response.json({ locked: true }),
  method: 'GET',
  reason: 'runtime intrinsic lockdown regression',
  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
});

export default createApp({ endpoints: [proof] });
`,
        'utf8',
      );

      const built = runKovoCli(root, ['build', appPath, '--out', outDir]);
      expect(built.status, built.stderr).toBe(0);
      const serverPath = join(outDir, 'server/server.mjs');
      expect(existsSync(serverPath)).toBe(true);
      const probe = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `const module = await import(${JSON.stringify(pathToFileURL(serverPath).href)});
const server = module.createKovoNodeServer();
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
const response = await fetch('http://127.0.0.1:' + address.port + '/proof');
const body = await response.text();
await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
process.stdout.write(body);`,
        ],
        { encoding: 'utf8', timeout: 20_000 },
      );
      expect(probe.status, probe.stderr).toBe(0);
      expect(probe.stdout, probe.stderr).toBe(JSON.stringify({ locked: true }));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('pins deploy preset environment before authored config evaluation in the real CLI', () => {
    const root = cliFixtureRoot('preset-environment');
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(
        join(root, 'index.html'),
        '<!doctype html><script type="module" src="/src/client.ts"></script>\n',
        'utf8',
      );
      writeFileSync(join(root, 'src/client.ts'), 'export {};\n', 'utf8');
      writeFileSync(
        join(root, 'app.ts'),
        `import { createApp, publicAccess, route } from '@kovojs/server';
export default createApp({
  routes: [route('/', {
    access: publicAccess('preset environment regression'),
    page: () => '<main>Preset environment</main>',
  })],
});
`,
        'utf8',
      );
      writeFileSync(
        join(root, 'kovo.config.ts'),
        `if (process.env.APP_PRESET_MUTATION === 'enable') process.env.KOVO_PRESET = 'cloudflare';
if (process.env.APP_PRESET_MUTATION === 'disable') delete process.env.KOVO_PRESET;
export default {};
`,
        'utf8',
      );

      const ordinaryEnv = { ...process.env, APP_PRESET_MUTATION: 'enable' };
      delete ordinaryEnv.KOVO_PRESET;
      delete ordinaryEnv.VERCEL;
      delete ordinaryEnv.CF_PAGES;
      delete ordinaryEnv.CLOUDFLARE;
      const configEnabled = runKovoCli(
        root,
        ['build', './app.ts', '--out', 'enabled', '--check'],
        ordinaryEnv,
      );
      expect(configEnabled.status, configEnabled.stderr).toBe(0);
      expect(configEnabled.stdout).toContain('CHECK ok preset=node');

      rmSync(join(root, 'enabled'), { force: true, recursive: true });
      rmSync(join(root, '.kovo'), { force: true, recursive: true });
      const operatorVercel = runKovoCli(
        root,
        ['build', './app.ts', '--out', 'operator-vercel', '--check'],
        { ...ordinaryEnv, APP_PRESET_MUTATION: 'disable', KOVO_PRESET: 'vercel' },
      );
      expect(operatorVercel.status, operatorVercel.stderr).toBe(0);
      expect(operatorVercel.stdout).toContain('CHECK ok preset=vercel');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('pins configured preset methods before authored app evaluation in the real CLI', () => {
    const root = cliFixtureRoot('preset-method-authority');
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(
        join(root, 'index.html'),
        '<!doctype html><script type="module" src="/src/client.ts"></script>\n',
        'utf8',
      );
      writeFileSync(join(root, 'src/client.ts'), 'export {};\n', 'utf8');
      writeFileSync(
        join(root, 'kovo.config.ts'),
        `import { defineConfig, node } from '@kovojs/server/build';
const builtIn = node({ dockerfile: false });
const sharedPreset = {
  name: 'node',
  inspect: builtIn.inspect,
  emit: builtIn.emit,
};
(globalThis as any).__kovoSharedBuildPreset = sharedPreset;
export default defineConfig({ preset: sharedPreset });
`,
        'utf8',
      );
      writeFileSync(
        join(root, 'app.ts'),
        `import { createApp, publicAccess, route } from '@kovojs/server';
const sharedPreset = (globalThis as any).__kovoSharedBuildPreset;
sharedPreset.emit = async () => {};
sharedPreset.inspect = () => [];
export default createApp({
  routes: [route('/', {
    access: publicAccess('preset method authority regression'),
    page: () => '<main>Preset authority</main>',
  })],
});
`,
        'utf8',
      );

      const outDir = join(root, 'dist');
      const built = runKovoCli(root, ['build', './app.ts', '--out', outDir]);
      expect(built.status, built.stderr).toBe(0);
      expect(existsSync(join(outDir, 'server/server.mjs'))).toBe(true);
      expect(existsSync(join(outDir, 'server/Dockerfile'))).toBe(false);
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
