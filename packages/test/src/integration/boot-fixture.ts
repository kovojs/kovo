/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked through verifierApply. */
// Generic "boot a single-file Kovo fixture and serve it" — the reusable
// generalization of examples/commerce/scripts/serve.mjs.
//
// The serve model mirrors the framework's own production-serve path (SPEC §9.5):
// the app shell is SSR-loaded through a Vite middleware server (so the Kovo
// compiler plugin compiles `component()` TSX on demand), built `dist/assets/*`
// are served from disk when present, and app-matched requests are dispatched to
// the fixture handler with a per-request `db`. Everything else (client modules,
// Vite internals) falls through to Vite.
import { realpath } from 'node:fs/promises';
import { createServer as createHttpServer, ServerResponse, type Server } from 'node:http';
import path from 'node:path';

import { createFrameworkFileSystemBoundary } from '@kovojs/core/internal/filesystem';
import { toNodeHandler } from '@kovojs/server';
import { shouldHandleKovoAppShellViteRequest } from '@kovojs/server/internal/app-shell-vite';
import { createServer as createViteServer } from 'vite';

import { isFixtureDescriptor } from './define-fixture.js';
import { kovoFixtureCompilerPlugin } from './fixture-compiler-plugin.js';
import {
  createFixtureInstance,
  type FixtureAppPreparer,
  type FixtureInstance,
  type FixtureRequestHandlerFactory,
  type PreparedFixtureApp,
} from './fixture-instance.js';
import {
  verifierApply,
  verifierDefineProperty,
  verifierFreeze,
  verifierGetOwnPropertyDescriptor,
  verifierGetPrototypeOf,
  verifierNullRecord,
  verifierReflectGet,
  verifierStringSlice,
  verifierStringStartsWith,
  verifierUrlPathname,
} from '../verifier-security-intrinsics.js';
import { registerFrameworkSqlSnapshotter } from '../verifier-snapshots.js';

const nativeDecodeURIComponent = globalThis.decodeURIComponent;
const nativePathExtname = path.extname;
const nativePathIsAbsolute = path.isAbsolute;
const nativePathJoin = path.join;
const nativePathRelative = path.relative;
const nativePathResolve = path.resolve;
const nativePathSeparator = path.sep;
const nativeRealpath = realpath;
const nativeServerResponseEnd = ServerResponse.prototype.end;
const nativeServerResponseWriteHead = ServerResponse.prototype.writeHead;
const nativeUint8ArrayPrototype = globalThis.Uint8Array.prototype;

/** A booted fixture server: its `origin`, the live `db`, a per-test `reset`, and `close`. */
export interface BootedFixture {
  /** The current per-test database (recreated by `reset`). */
  readonly db: FixtureInstance['db'];
  /** Runtime DB verification diagnostics collected by this fixture instance. */
  verificationDiagnostics(): ReturnType<FixtureInstance['verificationDiagnostics']>;
  /** `http://host:port` the fixture is served at. */
  readonly origin: string;
  /** Stop the HTTP server, Vite, and the database. */
  close(): Promise<void>;
  /** Reset the database to a fresh schema + seed for the next test. */
  reset(): Promise<void>;
}

/** Options for `bootFixture`. */
export interface BootFixtureOptions {
  /** Fixture entry module id relative to the fixture dir. Default `/app.tsx`. */
  entry?: string;
  /** Bind host. Default `127.0.0.1`. */
  host?: string;
}

const STATIC_MIME = verifierNullRecord<string>();
function defineStaticMime(extension: string, mime: string): void {
  verifierDefineProperty(STATIC_MIME, extension, {
    enumerable: true,
    value: mime,
  });
}
defineStaticMime('.css', 'text/css; charset=utf-8');
defineStaticMime('.ico', 'image/x-icon');
defineStaticMime('.js', 'text/javascript; charset=utf-8');
defineStaticMime('.json', 'application/json; charset=utf-8');
defineStaticMime('.png', 'image/png');
defineStaticMime('.svg', 'image/svg+xml');
defineStaticMime('.woff2', 'font/woff2');
verifierFreeze(STATIC_MIME);

/**
 * Boot a single-file fixture app and serve it on an ephemeral port.
 *
 * @param fixtureDir - Absolute path to the fixture directory (containing `app.tsx`).
 * @param options - Entry module id and bind host overrides.
 */
export async function bootFixture(
  fixtureDir: string,
  options: BootFixtureOptions = {},
): Promise<BootedFixture> {
  const entry = options.entry ?? '/app.tsx';
  const host = options.host ?? '127.0.0.1';
  const distAssetsDir = pathJoin(fixtureDir, 'dist');

  const fixtureCompiler = kovoFixtureCompilerPlugin();
  const vite = await createViteServer({
    appType: 'custom',
    configFile: false,
    logLevel: 'warn',
    plugins: [fixtureCompiler],
    root: fixtureDir,
    // Parallel Playwright workers boot different fixture roots. Give each Vite optimizer its own
    // cache commit directory so independent servers cannot race one shared deps_temp -> deps rename.
    cacheDir: pathJoin(fixtureDir, 'node_modules/.vite'),
    // No HMR/file-watching/ws server: fixtures are immutable per run, and parallel
    // workers must not contend for the default HMR WebSocket port.
    server: { hmr: false, middlewareMode: true, watch: null, ws: false },
    // Kovo workspace packages ship TS source from their dev `exports`, so Vite must
    // compile them rather than externalize to Node (which can't import `.ts`). This
    // mirrors what vite-plus configures for the example app-shells.
    ssr: { noExternal: [/^@kovojs\//] },
  });

  let instance: FixtureInstance;
  let unregisterSqlSnapshotter = (): void => {};
  try {
    // The private stylesheet registry shares the authored SSR realm. Evaluate it before any
    // fixture dependency so its dense-array controls cannot inherit later prototype setters.
    await vite.ssrLoadModule(fixtureCompiler.fixtureCssRuntimeId);
    // SPEC §6.6 rule 6: establish both security roots in this exact `ssr.noExternal`
    // module graph before Vite evaluates any authored fixture dependency. A native test-runner
    // import does not protect the separately instantiated SSR copies.
    const compilerModule = await vite.ssrLoadModule('@kovojs/compiler/internal');
    const assertCompilerSecurityIntrinsics = (
      compilerModule as { assertCompilerSecurityIntrinsics?: unknown }
    ).assertCompilerSecurityIntrinsics;
    if (typeof assertCompilerSecurityIntrinsics !== 'function') {
      throw new TypeError(
        'Fixture server could not establish @kovojs/compiler security bootstrap in the fixture SSR graph.',
      );
    }
    assertCompilerSecurityIntrinsics();
    const coreSqlModule = await vite.ssrLoadModule('@kovojs/core/internal/sql-safety');
    const snapshotManagedSqlStatement = (coreSqlModule as { snapshotManagedSqlStatement?: unknown })
      .snapshotManagedSqlStatement;
    if (typeof snapshotManagedSqlStatement !== 'function') {
      throw new TypeError(
        'Fixture server could not establish @kovojs/core SQL snapshot bridging in the fixture SSR graph.',
      );
    }
    unregisterSqlSnapshotter = registerFrameworkSqlSnapshotter(snapshotManagedSqlStatement);
    const serverModule = await vite.ssrLoadModule('@kovojs/server');
    const managedDbModule = await vite.ssrLoadModule('@kovojs/server/internal/managed-db');
    const appShellModule = await vite.ssrLoadModule('@kovojs/server/internal/app-shell-vite');
    const runWithGeneratedLiveTargetRegistry = (
      appShellModule as { runWithGeneratedLiveTargetRegistry?: unknown }
    ).runWithGeneratedLiveTargetRegistry;
    if (typeof runWithGeneratedLiveTargetRegistry !== 'function') {
      throw new TypeError(
        'Fixture server could not establish compiler-owned live-target registry scope in the fixture SSR graph.',
      );
    }
    // SPEC §2/§9.5: fixture apps exercise the same owner-scoped generated-registry handoff as
    // dev and production loaders. Evaluating authored component modules before this scope exists
    // would leave createApp() with no closed renderer inventory, making valid signed targets fall
    // through to empty mutation responses and masking the actual framework path under test.
    const module = await verifierApply<Promise<Record<string, unknown>>>(
      runWithGeneratedLiveTargetRegistry,
      undefined,
      [() => vite.ssrLoadModule(entry)],
    );
    const descriptor = (module as { default?: unknown }).default;
    if (!isFixtureDescriptor(descriptor)) {
      const exportedKeys = JSON.stringify(Object.keys(module));
      const hint = exportedKeys.includes('renderSource')
        ? ' The Kovo compiler claimed this module (it exports `renderSource`): the fixture entry' +
          ' must NOT declare a Kovo component — move components to their own file, and keep the' +
          ' component-call token out of comments in the entry (the plugin matches it as source text).'
        : '';
      throw new Error(
        `Fixture entry ${entry} must \`export default defineFixture(...)\` (exports: ${exportedKeys}).${hint}`,
      );
    }
    const createRequestHandler = fixtureRequestHandlerFactory(serverModule);
    const prepareApp = fixtureAppPreparer(appShellModule, managedDbModule);
    instance = await createFixtureInstance(descriptor, createRequestHandler, prepareApp);
  } catch (error) {
    unregisterSqlSnapshotter();
    await vite.close();
    throw error;
  }

  const nodeHandler = toNodeHandler((request) => instance.handle(request));
  const server = createHttpServer((req, res) => {
    void (async () => {
      if (await tryServeBuiltAsset(req.url ?? '/', distAssetsDir, res)) return;
      if (shouldHandleKovoAppShellViteRequest(req, instance.app)) {
        await nodeHandler(req, res);
        return;
      }
      vite.middlewares(req, res);
    })().catch((error: unknown) => {
      console.error('[kovo fixture] request routing error:', error);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
    });
  });

  const port = await listen(server, host);

  return {
    get db() {
      return instance.db;
    },
    verificationDiagnostics: () => instance.verificationDiagnostics(),
    origin: `http://${host}:${port}`,
    async close() {
      await closeHttpServer(server);
      unregisterSqlSnapshotter();
      await vite.close();
      await instance.close();
    },
    reset: () => instance.reset(),
  };
}

function fixtureRequestHandlerFactory(serverModule: unknown): FixtureRequestHandlerFactory {
  const createRequestHandler = (serverModule as { createRequestHandler?: unknown })
    .createRequestHandler;
  if (typeof createRequestHandler !== 'function') {
    throw new TypeError(
      'Fixture server could not load @kovojs/server.createRequestHandler from the fixture SSR graph.',
    );
  }
  return createRequestHandler as FixtureRequestHandlerFactory;
}

function fixtureAppPreparer(serverModule: unknown, managedDbModule: unknown): FixtureAppPreparer {
  const deriveClosedKovoApp = (serverModule as { deriveClosedKovoApp?: unknown })
    .deriveClosedKovoApp;
  if (typeof deriveClosedKovoApp !== 'function') {
    throw new TypeError(
      'Fixture server could not load @kovojs/server deriveClosedKovoApp from the fixture SSR graph.',
    );
  }
  const createDispatchProxy = (
    managedDbModule as { createFrameworkManagedSqlDispatchProxy?: unknown }
  ).createFrameworkManagedSqlDispatchProxy;
  const managedDb = (managedDbModule as { managedDb?: unknown }).managedDb;
  const readonlyHook = (managedDbModule as { kovoReadonlyDbHandle?: unknown }).kovoReadonlyDbHandle;
  const declaredWriteHook = (managedDbModule as { kovoDeclaredWriteDbHandle?: unknown })
    .kovoDeclaredWriteDbHandle;
  if (
    typeof createDispatchProxy !== 'function' ||
    typeof managedDb !== 'function' ||
    typeof readonlyHook !== 'symbol' ||
    typeof declaredWriteHook !== 'symbol'
  ) {
    throw new TypeError(
      'Fixture server could not establish managed DB capability bridging in the fixture SSR graph.',
    );
  }

  return (app, db, capabilities): PreparedFixtureApp => {
    const bridgeDispatch = (target: object): object =>
      verifierApply<object>(createDispatchProxy, undefined, [
        target,
        {
          get(value: object, property: PropertyKey, receiver: unknown) {
            return verifierReflectGet(value, property, receiver);
          },
        },
        'test-fixture',
      ]);

    // Keep the cross-SSR capability hooks off the authored/seed-retainable DB object entirely.
    // A private null-prototype shell lets the foreign server realm resolve sealed own hooks while
    // every ordinary adapter property still dispatches through the verifier-wrapped delegate.
    const rootShell = verifierNullRecord();
    verifierDefineProperty(rootShell, readonlyHook, {
      value: () => {
        const verifiedReader = bridgeDispatch(capabilities.readonly());
        const policyReader = verifierApply<object>(managedDb, undefined, [
          verifiedReader,
          'read',
          verifierFreeze({
            rawRead: verifierFreeze({
              dialectLabel: 'PGlite integration fixture',
              executeMethod: 'query',
              normalizeTableName: normalizePgliteFixtureTableName,
            }),
          }),
        ]);
        const rawRead = verifierReflectGet(policyReader, 'rawRead', policyReader);
        if (typeof rawRead !== 'function') {
          throw new TypeError('Fixture reader bridge could not resolve its rawRead policy method.');
        }
        // `ssr.noExternal` can instantiate more than one server security module. Keep the
        // policy-enforced method as an own adapter capability so a second managedDb() layer
        // preserves it from the engine-readonly hook without relying on a foreign WeakSet brand.
        const readerShell = verifierNullRecord();
        verifierDefineProperty(readerShell, 'rawRead', {
          configurable: true,
          value: (...args: unknown[]) => verifierApply(rawRead, policyReader, args),
        });
        return verifierApply<object>(createDispatchProxy, undefined, [
          readerShell,
          {
            get(value: object, property: PropertyKey, receiver: unknown) {
              return verifierGetOwnPropertyDescriptor(value, property) === undefined
                ? verifierReflectGet(verifiedReader, property, verifiedReader)
                : verifierReflectGet(value, property, receiver);
            },
          },
          'test-fixture',
        ]);
      },
    });
    verifierDefineProperty(rootShell, declaredWriteHook, {
      value: (policy: unknown) => bridgeDispatch(capabilities.declaredWrite(policy)),
    });
    const bridgedDb = verifierApply<object>(createDispatchProxy, undefined, [
      rootShell,
      {
        get(value: object, property: PropertyKey, receiver: unknown) {
          return verifierGetOwnPropertyDescriptor(value, property) === undefined
            ? verifierReflectGet(db, property, db)
            : verifierReflectGet(value, property, receiver);
        },
      },
      'test-fixture',
    ]);
    return verifierFreeze({
      app: verifierApply(deriveClosedKovoApp, undefined, [
        app,
        {
          db: () => bridgedDb,
        },
      ]),
      managesDb: true,
    });
  };
}

function normalizePgliteFixtureTableName(table: string): string {
  return table;
}

async function tryServeBuiltAsset(
  rawUrl: string,
  distDir: string,
  res: import('node:http').ServerResponse,
): Promise<boolean> {
  const pathname = decodeURIComponentControl(verifierUrlPathname(rawUrl, 'http://x'));
  if (!verifierStringStartsWith(pathname, '/assets/')) return false;
  const assetsRoot = pathResolve(distDir, 'assets');
  const relativeAssetPath = verifierStringSlice(pathname, '/assets/'.length);
  const requestedPath = pathResolve(assetsRoot, relativeAssetPath);
  if (!pathContains(assetsRoot, requestedPath)) return false;

  try {
    // Canonical containment rejects a symlinked dist root, a symlinked assets root, and symlinks
    // under dist/assets. Each trust tier must remain a strict descendant of the one above it.
    const canonicalFixture = await nativeRealpath(pathResolve(distDir, '..'));
    const canonicalDist = await nativeRealpath(distDir);
    if (
      canonicalDist !== pathResolve(canonicalFixture, 'dist') ||
      !pathContains(canonicalFixture, canonicalDist)
    ) {
      return false;
    }
    const canonicalRoot = await nativeRealpath(assetsRoot);
    if (
      canonicalRoot !== pathResolve(canonicalDist, 'assets') ||
      !pathContains(canonicalDist, canonicalRoot)
    ) {
      return false;
    }
    const fileSystem = await createFrameworkFileSystemBoundary(assetsRoot);
    if (fileSystem.root !== canonicalRoot) return false;
    const loaded = await fileSystem.readFile(relativeAssetPath);
    if (loaded === undefined || !isVerifierByteArray(loaded.body)) return false;
    verifierApply(nativeServerResponseWriteHead, res, [
      200,
      {
        'cache-control': 'public, max-age=31536000, immutable',
        'content-length': loaded.size,
        'content-type': staticMime(pathExtname(loaded.fileName)),
        'x-content-type-options': 'nosniff',
      },
    ]);
    verifierApply(nativeServerResponseEnd, res, [loaded.body]);
    return true;
  } catch {
    return false;
  }
}

function isVerifierByteArray(value: unknown): value is Uint8Array {
  return (
    typeof value === 'object' &&
    value !== null &&
    verifierGetPrototypeOf(value) === nativeUint8ArrayPrototype
  );
}

function staticMime(extension: string): string {
  const descriptor = verifierGetOwnPropertyDescriptor(STATIC_MIME, extension);
  return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string'
    ? descriptor.value
    : 'application/octet-stream';
}

function pathContains(root: string, candidate: string): boolean {
  const relative = pathRelative(root, candidate);
  return (
    !pathIsAbsolute(relative) &&
    relative !== '..' &&
    !verifierStringStartsWith(relative, `..${nativePathSeparator}`)
  );
}

function decodeURIComponentControl(value: string): string {
  return verifierApply<string>(nativeDecodeURIComponent, undefined, [value]);
}

function pathExtname(value: string): string {
  return verifierApply<string>(nativePathExtname, path, [value]);
}

function pathIsAbsolute(value: string): boolean {
  return verifierApply<boolean>(nativePathIsAbsolute, path, [value]);
}

function pathJoin(...values: string[]): string {
  return verifierApply<string>(nativePathJoin, path, values);
}

function pathRelative(from: string, to: string): string {
  return verifierApply<string>(nativePathRelative, path, [from, to]);
}

function pathResolve(...values: string[]): string {
  return verifierApply<string>(nativePathResolve, path, values);
}

function listen(server: Server, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      server.off('error', reject);
      const address = server.address();
      if (typeof address === 'object' && address !== null) {
        resolve(address.port);
        return;
      }
      reject(new Error('Fixture server did not expose a TCP port.'));
    });
  });
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
