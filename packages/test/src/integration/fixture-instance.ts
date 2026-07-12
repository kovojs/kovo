// Owns a fixture's live database + app handler lifecycle. The database is
// recreated on `reset()` so each test gets an isolated, freshly-seeded PGlite —
// the app object closes over a mutable `db` holder, so the same request handler
// keeps working across resets without rebuilding the Vite module graph.
import type { KovoApp, RequestHandler } from '@kovojs/server';
import {
  kovoDeclaredWriteDbHandle,
  kovoReadonlyDbHandle,
  type KovoDeclaredWriteDbCapable,
  type KovoReadonlyDbCapable,
} from '@kovojs/server/internal/execution';

import { createPgliteTestDb, type PgliteTestDb } from '../pglite.js';
import { createDbVerifier, type DbVerifier } from '../verifier.js';
import type { DbVerificationDiagnostic } from '../verifier-diagnostics.js';
import type { ObservedDbOperation } from '../verifier-observation.js';
import {
  verifierApply,
  verifierDefineProperty,
  verifierDenseArraySnapshot,
  verifierFreeze,
  verifierGetOwnPropertyDescriptor,
  verifierMap,
  verifierMapGet,
  verifierMapHas,
  verifierMapSet,
  verifierOwnKeys,
  verifierRegExpExec,
  verifierRequestUrl,
  verifierResponse,
  verifierStringSlice,
  verifierStringStartsWith,
  verifierUrlPathname,
} from '../verifier-security-intrinsics.js';
import { snapshotDomains, snapshotQueryReadDomains } from '../verifier-snapshots.js';
import type { KovoFixtureDescriptor, KovoFixtureRequest } from './define-fixture.js';

const nativeDecodeURIComponent = globalThis.decodeURIComponent;
const emptyDeclaredReads = snapshotDomains([]);

type QueryReadPolicy = ReadonlyMap<string, readonly string[]>;
type RouteReadPolicy = ReadonlyMap<string, readonly string[]>;
type FixtureVerificationRoute =
  | Readonly<{ kind: 'mutation'; touchGraphKey: string }>
  | Readonly<{ kind: 'query'; queryKey: string }>
  | Readonly<{ kind: 'route'; pathname: string }>;

/** A booted fixture's database + dispatch handler, with per-test `reset()`. */
export interface FixtureInstance {
  /** The Kovo app aggregate for the current database. */
  readonly app: KovoApp;
  /** The current per-test database. */
  readonly db: PgliteTestDb;
  /** Runtime DB verification diagnostics collected by this fixture instance. */
  verificationDiagnostics(): readonly DbVerificationDiagnostic[];
  /** Dispatch a Web `Request` through the app with `db` attached. */
  handle(request: Request): Promise<Response>;
  /** Tear down the database for good. */
  close(): Promise<void>;
  /** Drop and re-create the database (schema + seed) for the next test. */
  reset(): Promise<void>;
}

function schemaStatements(schema: string | readonly string[] | undefined): readonly string[] {
  if (schema === undefined) return [];
  return typeof schema === 'string' ? [schema] : schema;
}

export type FixtureRequestHandlerFactory = (app: KovoApp) => RequestHandler;
type FixtureDeclaredWritePolicy = Parameters<
  KovoDeclaredWriteDbCapable[typeof kovoDeclaredWriteDbHandle]
>[0];

/** Engine-enforced adapter targets, re-wrapped at the verifier seam before SSR bridging. */
export interface FixtureDbCapabilityFactories {
  declaredWrite(policy: unknown): object;
  readonly(): object;
}

/** Result of preparing an authored fixture app for dispatch. */
export interface PreparedFixtureApp {
  app: KovoApp;
  /** Whether the prepared app owns `request.db` through the framework lifecycle. */
  managesDb: boolean;
}

export type FixtureAppPreparer = (
  app: KovoApp,
  db: PgliteTestDb,
  capabilities: FixtureDbCapabilityFactories,
) => PreparedFixtureApp;

/**
 * Build a fixture instance: create the database, apply schema + seed, and wire a
 * request handler that attaches the current `db` to every request.
 */
export async function createFixtureInstance(
  descriptor: KovoFixtureDescriptor,
  createRequestHandler: FixtureRequestHandlerFactory,
  prepareApp: FixtureAppPreparer = (app) => ({ app, managesDb: false }),
): Promise<FixtureInstance> {
  const { definition } = descriptor;
  let rawDb: PgliteTestDb;
  let db: PgliteTestDb;
  let inspectionDb: PgliteTestDb;
  let app: KovoApp;
  let dispatch: (request: Request) => Promise<Response>;
  let queryReadPolicy: QueryReadPolicy;
  let routeReadPolicy: RouteReadPolicy;
  let verifier: DbVerifier | null;
  let appManagesDb = false;

  const build = async (): Promise<void> => {
    rawDb = await createPgliteTestDb();
    for (const statement of schemaStatements(definition.schema)) {
      await rawDb.exec(statement);
    }
    verifier =
      definition.touchGraph && definition.verification
        ? createDbVerifier(definition.touchGraph, definition.verification, {
            recordOutsideCapture: false,
          })
        : null;
    db = verifier ? (verifier.wrap(rawDb) as PgliteTestDb) : rawDb;
    inspectionDb = verifier
      ? (createDbVerifier({}, { domainByTable: {} }).wrap(rawDb) as PgliteTestDb)
      : rawDb;
    // Seal the engine hook functions before fixture-controlled seed/app code can retain and
    // replace the adapter symbols. The factories still wrap every produced target in the verifier.
    const capabilities = fixtureDbCapabilityFactories(rawDb, verifier);
    // C238 / SPEC §11.2: setup may use the verified handle, but it does so in a short-lived capture.
    // After setup, the same root is usable only while a request capture is active. A seed/app
    // closure that retains it therefore cannot launder DB authority into a fresh async context.
    const setup = async (): Promise<PreparedFixtureApp> => {
      await definition.seed?.(db);
      const authoredApp =
        typeof definition.app === 'function' ? definition.app({ db }) : definition.app;
      return prepareApp(authoredApp, db, capabilities);
    };
    const prepared = verifier ? (await verifier.captureSetup(setup)).result : await setup();
    app = prepared.app;
    appManagesDb = prepared.managesDb;
    queryReadPolicy = verifier ? snapshotQueryReadPolicy(app) : verifierMap();
    routeReadPolicy = verifier ? snapshotRouteReadPolicy(definition) : verifierMap();
    dispatch = createRequestHandler(app);
  };

  await build();

  return {
    get app() {
      return app;
    },
    get db() {
      // The instance's explicit test-inspection handle is not threaded into application requests.
      // Request/app code receives `db` above, whose verifier requires an active capture.
      return inspectionDb;
    },
    verificationDiagnostics() {
      return verifier?.diagnostics() ?? [];
    },
    async handle(request) {
      const verificationRoute = verifier ? snapshotVerificationRoute(request) : null;
      // Attach the current db the same way the example app-shells do (SPEC §9.5
      // request context), so fixture handlers read `(request as KovoFixtureRequest).db`.
      if (!appManagesDb) {
        verifierDefineProperty(request, 'db', {
          configurable: true,
          value: db,
        } satisfies { configurable: true; value: KovoFixtureRequest['db'] });
      }
      try {
        if (!verifier || verificationRoute === null) return await dispatch(request);

        const captured = await verifier.capture(() => dispatch(request));
        verifyRequestOperations(
          verificationRoute,
          captured.observed,
          verifier,
          queryReadPolicy,
          routeReadPolicy,
        );
        return captured.result;
      } catch (error) {
        const verificationResponse = verificationFailureResponse(error);
        if (verificationResponse) return verificationResponse;
        // toNodeHandler turns thrown errors into an opaque 500; surface the cause
        // so fixture authoring mistakes are debuggable.
        console.error('[kovo fixture] request handler error:', error);
        throw error;
      }
    },
    async close() {
      await rawDb.close();
    },
    async reset() {
      await rawDb.close();
      await build();
    },
  };
}

function fixtureDbCapabilityFactories(
  rawDb: PgliteTestDb,
  verifier: DbVerifier | null,
): FixtureDbCapabilityFactories {
  const readonlyHook = adapterCapabilityHook<KovoReadonlyDbCapable>(
    rawDb,
    kovoReadonlyDbHandle,
    'readonly',
  );
  const declaredWriteHook = adapterCapabilityHook<KovoDeclaredWriteDbCapable>(
    rawDb,
    kovoDeclaredWriteDbHandle,
    'declared-write',
  );

  return verifierFreeze({
    declaredWrite(policy: unknown): object {
      const target = verifierApply<object>(declaredWriteHook, rawDb, [
        policy as FixtureDeclaredWritePolicy,
      ]);
      return verifier?.wrap(target) ?? target;
    },
    readonly(): object {
      const target = verifierApply<object>(readonlyHook, rawDb, []);
      return verifier?.wrap(target) ?? target;
    },
  });
}

function adapterCapabilityHook<Capability extends object>(
  db: object,
  property: keyof Capability,
  label: string,
): Function {
  const descriptor = verifierGetOwnPropertyDescriptor(db, property);
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'function'
  ) {
    throw new TypeError(`Fixture PGlite adapter is missing its ${label} engine capability hook.`);
  }
  return descriptor.value;
}

function verifyRequestOperations(
  route: FixtureVerificationRoute,
  observed: readonly ObservedDbOperation[],
  verifier: DbVerifier,
  queryReadPolicy: QueryReadPolicy,
  routeReadPolicy: RouteReadPolicy,
): void {
  if (route.kind === 'mutation') {
    verifier.assertCoveredOperations(observed, route.touchGraphKey);
    return;
  }

  if (route.kind === 'query') {
    verifier.assertNoWritesOperations(observed);
    verifier.assertReadsCoveredOperations(
      observed,
      verifierMapGet(queryReadPolicy, route.queryKey) ?? emptyDeclaredReads,
    );
    return;
  }

  verifier.assertNoWritesOperations(observed);
  verifier.assertReadsCoveredOperations(
    observed,
    verifierMapGet(routeReadPolicy, route.pathname) ?? emptyDeclaredReads,
  );
}

function snapshotVerificationRoute(request: Request): FixtureVerificationRoute {
  const pathname = verifierUrlPathname(verifierRequestUrl(request));
  if (verifierStringStartsWith(pathname, '/_m/')) {
    return verifierFreeze({
      kind: 'mutation',
      touchGraphKey: decodeURIComponentControl(verifierStringSlice(pathname, '/_m/'.length)),
    });
  }
  if (verifierStringStartsWith(pathname, '/_q/')) {
    return verifierFreeze({
      kind: 'query',
      queryKey: decodeURIComponentControl(verifierStringSlice(pathname, '/_q/'.length)),
    });
  }
  return verifierFreeze({ kind: 'route', pathname });
}

function snapshotQueryReadPolicy(app: KovoApp): QueryReadPolicy {
  const queriesDescriptor = verifierGetOwnPropertyDescriptor(app, 'queries');
  if (queriesDescriptor === undefined || !('value' in queriesDescriptor)) {
    throw new TypeError('fixture app.queries must be a stable own data property.');
  }
  const queries = verifierDenseArraySnapshot(
    queriesDescriptor.value,
    'fixture app.queries',
    (query, index) => {
      if (typeof query !== 'object' || query === null) {
        throw new TypeError(`fixture app.queries[${index}] must be a query definition object.`);
      }
      const keyDescriptor = verifierGetOwnPropertyDescriptor(query, 'key');
      if (
        keyDescriptor === undefined ||
        !('value' in keyDescriptor) ||
        typeof keyDescriptor.value !== 'string'
      ) {
        throw new TypeError(
          `fixture app.queries[${index}].key must be a string own data property.`,
        );
      }
      return {
        key: keyDescriptor.value,
        reads: snapshotQueryReadDomains(query, `fixture app.queries[${index}]`),
      };
    },
  );
  const policy = verifierMap<string, readonly string[]>();
  for (let index = 0; index < queries.length; index += 1) {
    const query = queries[index];
    if (query === undefined) continue;
    if (verifierMapHas(policy, query.key)) {
      throw new TypeError(`fixture app has duplicate query key ${query.key}.`);
    }
    verifierMapSet(policy, query.key, query.reads);
  }
  return policy;
}

function snapshotRouteReadPolicy(definition: KovoFixtureDescriptor['definition']): RouteReadPolicy {
  const policy = verifierMap<string, readonly string[]>();
  const routeReadsDescriptor = verifierGetOwnPropertyDescriptor(definition, 'routeReads');
  if (routeReadsDescriptor === undefined) return policy;
  if (!('value' in routeReadsDescriptor)) {
    throw new TypeError('fixture definition.routeReads must be a stable own data property.');
  }
  if (routeReadsDescriptor.value === undefined) return policy;
  if (typeof routeReadsDescriptor.value !== 'object' || routeReadsDescriptor.value === null) {
    throw new TypeError('fixture definition.routeReads must be an own-data object.');
  }

  const paths = verifierOwnKeys(routeReadsDescriptor.value);
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index];
    if (typeof path !== 'string') {
      throw new TypeError('fixture definition.routeReads must not contain symbol properties.');
    }
    if (!verifierStringStartsWith(path, '/')) {
      throw new TypeError(`fixture definition.routeReads path ${path} must start with /.`);
    }
    const descriptor = verifierGetOwnPropertyDescriptor(routeReadsDescriptor.value, path);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(
        `fixture definition.routeReads.${path} must be an enumerable own data property.`,
      );
    }
    verifierMapSet(policy, path, snapshotDomains(descriptor.value as readonly string[]));
  }
  return policy;
}

function decodeURIComponentControl(value: string): string {
  return verifierApply<string>(nativeDecodeURIComponent, undefined, [value]);
}

function verificationFailureResponse(error: unknown): Response | null {
  if (typeof error !== 'object' || error === null) return null;
  const messageDescriptor = verifierGetOwnPropertyDescriptor(error, 'message');
  if (
    messageDescriptor === undefined ||
    !('value' in messageDescriptor) ||
    typeof messageDescriptor.value !== 'string' ||
    verifierRegExpExec(/^KV\d{3}\b/u, messageDescriptor.value) === null
  ) {
    return null;
  }

  return verifierResponse(`Kovo verification failed: ${messageDescriptor.value}`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    status: 500,
  });
}
