// Owns a fixture's live database + app handler lifecycle. The database is
// recreated on `reset()` so each test gets an isolated, freshly-seeded PGlite —
// the app object closes over a mutable `db` holder, so the same request handler
// keeps working across resets without rebuilding the Vite module graph.
import { createRequestHandler, type KovoApp } from '@kovojs/server';

import { createPgliteTestDb, type PgliteTestDb } from '../pglite.js';
import { createDbVerifier, type DbVerifier } from '../verifier.js';
import type { DbVerificationDiagnostic } from '../verifier-diagnostics.js';
import type { ObservedDbOperation } from '../verifier-observation.js';
import type { KovoFixtureDescriptor, KovoFixtureRequest } from './define-fixture.js';

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

/**
 * Build a fixture instance: create the database, apply schema + seed, and wire a
 * request handler that attaches the current `db` to every request.
 */
export async function createFixtureInstance(
  descriptor: KovoFixtureDescriptor,
): Promise<FixtureInstance> {
  const { definition } = descriptor;
  let rawDb: PgliteTestDb;
  let db: PgliteTestDb;
  let app: KovoApp;
  let dispatch: (request: Request) => Promise<Response>;
  let verifier: DbVerifier | null;

  const build = async (): Promise<void> => {
    rawDb = await createPgliteTestDb();
    for (const statement of schemaStatements(definition.schema)) {
      await rawDb.exec(statement);
    }
    await definition.seed?.(rawDb);
    verifier =
      definition.touchGraph && definition.verification
        ? createDbVerifier(definition.touchGraph, definition.verification)
        : null;
    db = verifier ? (verifier.wrap(rawDb) as PgliteTestDb) : rawDb;
    app = typeof definition.app === 'function' ? definition.app({ db }) : definition.app;
    dispatch = createRequestHandler(app);
  };

  await build();

  return {
    get app() {
      return app;
    },
    get db() {
      return db;
    },
    verificationDiagnostics() {
      return verifier?.diagnostics() ?? [];
    },
    async handle(request) {
      // Attach the current db the same way the example app-shells do (SPEC §9.5
      // request context), so fixture handlers read `(request as KovoFixtureRequest).db`.
      Object.defineProperty(request, 'db', {
        configurable: true,
        value: db,
      } satisfies { configurable: true; value: KovoFixtureRequest['db'] });
      try {
        if (!verifier) return await dispatch(request);

        const captured = await verifier.capture(() => dispatch(request));
        verifyRequestOperations(app, request, captured.observed, verifier);
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

function verifyRequestOperations(
  app: KovoApp,
  request: Request,
  observed: readonly ObservedDbOperation[],
  verifier: DbVerifier,
): void {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/_m/')) {
    verifier.assertCoveredOperations(
      observed,
      decodeURIComponent(url.pathname.slice('/_m/'.length)),
    );
    return;
  }

  if (url.pathname.startsWith('/_q/')) {
    const queryKey = decodeURIComponent(url.pathname.slice('/_q/'.length));
    const query = app.queries.find((definition) => definition.key === queryKey);
    if (!query) return;
    verifier.assertReadsCoveredOperations(
      observed,
      query.reads.map((domain: { key: string }) => domain.key),
    );
  }
}

function verificationFailureResponse(error: unknown): Response | null {
  if (!(error instanceof Error) || !/^KV\d{3}\b/.test(error.message)) return null;

  return new Response(`Kovo verification failed: ${error.message}`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    status: 500,
  });
}
