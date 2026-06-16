// Integration-suite fixture authoring contract (plans/integration-test-suite.md).
//
// A fixture is a single-file minimal Kovo app: `export default defineFixture(...)`.
// The harness owns everything else — PGlite creation, schema, seeding, the Vite
// SSR server, per-request `db` attachment, and teardown — so a fixture author
// writes only the app and (optionally) its schema/seed. SPEC §11 frames this as a
// framework-owned suite: fixtures exercise framework public APIs end-to-end, not
// app wiring.
import type { KovoApp } from '@kovojs/server/app-shell/core';

import type { PgliteTestDb } from '../pglite.js';

/**
 * The per-request context a fixture's route/query/mutation handlers receive. The
 * harness attaches `db` to every `Request` (mirroring the example app-shells'
 * `request.db` convention), so handlers read `(request as KovoFixtureRequest).db`.
 */
export interface KovoFixtureRequest {
  db: PgliteTestDb;
}

/**
 * A fixture's app: either a ready `KovoApp` (handlers read `request.db`) or a
 * factory that receives the freshly-created `db` for the current test. The factory
 * form is re-invoked on every database reset so closures never capture a stale db.
 */
export type FixtureAppFactory = KovoApp | ((context: { db: PgliteTestDb }) => KovoApp);

/** The shape passed to `defineFixture`: the app plus optional schema DDL and seed. */
export interface FixtureDefinition {
  /** The Kovo app under test, or a factory over the per-test `db`. */
  app: FixtureAppFactory;
  /** SQL DDL run once per test before seeding (string or ordered statements). */
  schema?: string | readonly string[];
  /** Populate the database before each test, after `schema` has run. */
  seed?: (db: PgliteTestDb) => void | Promise<unknown>;
}

const FIXTURE_BRAND = '__kovoIntegrationFixture';

/** The descriptor a fixture module default-exports; consumed by the harness boot path. */
export interface KovoFixtureDescriptor {
  readonly [FIXTURE_BRAND]: true;
  readonly definition: FixtureDefinition;
}

/**
 * Declare a single-file integration fixture. The default export of a fixture
 * module must be a `defineFixture(...)` descriptor.
 *
 * @example
 * export default defineFixture({
 *   schema: 'create table todo (id serial primary key, title text)',
 *   seed: (db) => db.write('todo', { title: 'first' }),
 *   app: createApp({ routes: [...], mutations: [...] }),
 * });
 */
export function defineFixture(definition: FixtureDefinition): KovoFixtureDescriptor {
  return { [FIXTURE_BRAND]: true, definition };
}

/** Narrow an SSR-loaded module's default export to a fixture descriptor. */
export function isFixtureDescriptor(value: unknown): value is KovoFixtureDescriptor {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)[FIXTURE_BRAND] === true
  );
}
