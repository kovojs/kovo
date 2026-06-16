// Owns a fixture's live database + app handler lifecycle. The database is
// recreated on `reset()` so each test gets an isolated, freshly-seeded PGlite —
// the app object closes over a mutable `db` holder, so the same request handler
// keeps working across resets without rebuilding the Vite module graph.
import { createRequestHandler, type KovoApp } from '@kovojs/server/app-shell/core';

import { createPgliteTestDb, type PgliteTestDb } from '../pglite.js';
import type { KovoFixtureDescriptor, KovoFixtureRequest } from './define-fixture.js';

/** A booted fixture's database + dispatch handler, with per-test `reset()`. */
export interface FixtureInstance {
  /** The Kovo app aggregate for the current database. */
  readonly app: KovoApp;
  /** The current per-test database. */
  readonly db: PgliteTestDb;
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
  let db: PgliteTestDb;
  let app: KovoApp;
  let dispatch: (request: Request) => Promise<Response>;

  const build = async (): Promise<void> => {
    db = await createPgliteTestDb();
    for (const statement of schemaStatements(definition.schema)) {
      await db.exec(statement);
    }
    await definition.seed?.(db);
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
    async handle(request) {
      // Attach the current db the same way the example app-shells do (SPEC §9.5
      // request context), so fixture handlers read `(request as KovoFixtureRequest).db`.
      Object.defineProperty(request, 'db', {
        configurable: true,
        value: db,
      } satisfies { configurable: true; value: KovoFixtureRequest['db'] });
      try {
        return await dispatch(request);
      } catch (error) {
        // toNodeHandler turns thrown errors into an opaque 500; surface the cause
        // so fixture authoring mistakes are debuggable.
        console.error('[kovo fixture] request handler error:', error);
        throw error;
      }
    },
    async close() {
      await db.close();
    },
    async reset() {
      await db.close();
      await build();
    },
  };
}
