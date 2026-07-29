import { createPostgresTestRuntime as createInternalPostgresTestRuntime } from '@kovojs/server/internal/testing';
import type { CrossOwnerReadDeclaration, RawReadDeclaration } from '@kovojs/server/data';
import type { KovoPostgresRuntimeDb } from '@kovojs/server/postgres';

/** Drizzle database handle passed to owner-scoped Postgres test callbacks. */
export type KovoPostgresTestDb = KovoPostgresRuntimeDb;

/**
 * Read-only Postgres handle passed to admin-guarded test callbacks.
 *
 * The runtime is the same fail-closed reader capability used by Kovo request paths. This public
 * shape deliberately omits write verbs while preserving Drizzle reads and the two reviewed raw
 * read escape hatches (SPEC §§10.3, 12).
 */
export type KovoPostgresTestAdminDb = Pick<
  KovoPostgresRuntimeDb,
  Extract<keyof KovoPostgresRuntimeDb, '$count' | '$with' | 'query' | 'select' | 'selectDistinct'>
> & {
  crossOwnerRead<Row = unknown>(
    statement: unknown,
    declaration: CrossOwnerReadDeclaration,
  ): Promise<Row[]> | Row[];
  rawRead<Row = unknown>(
    statement: unknown,
    declaration: RawReadDeclaration,
  ): Promise<Row[]> | Row[];
};

/** Drizzle database handle passed to audited non-request system test callbacks. */
export type KovoPostgresTestSystemDb = KovoPostgresRuntimeDb;

/** Configuration for an ephemeral owner-scoped Postgres test runtime. */
export interface KovoPostgresTestRuntimeOptions {
  /**
   * Physical owner/authz tables allowed through the audited admin cross-owner read path.
   * Each test must opt in per table (SPEC §10.3 DEC-G).
   */
  crossOwnerReadTables?: readonly string[];
  /** App schema module, normally `import * as schema from '../src/schema.js'`. */
  schema: Record<string, unknown>;
  /** SQL run after the ephemeral PGlite schema is provisioned. */
  seedSql?: string | readonly string[];
}

/** Ephemeral PGlite-backed runtime that exercises Kovo's real Postgres RLS posture. */
export interface KovoPostgresTestRuntime {
  /** Temporary data directory removed by {@link close}. */
  readonly dataDir: string;
  /** Release the runtime and remove its temporary data. */
  close(): Promise<void>;
  /** Run with one owner principal through Kovo's request-scoped database capability. */
  withPrincipal<Result>(
    principalId: string,
    callback: (db: KovoPostgresTestDb) => Result | Promise<Result>,
  ): Promise<Result>;
  /** Run an explicitly table-scoped, admin-guarded cross-owner read. */
  asAdmin<Result>(
    principalId: string,
    callback: (db: KovoPostgresTestAdminDb) => Result | Promise<Result>,
  ): Promise<Result>;
  /** Run audited non-request system work with a required non-empty reason. */
  asSystem<Result>(
    reason: string,
    callback: (db: KovoPostgresTestSystemDb) => Result | Promise<Result>,
  ): Promise<Result>;
}

/**
 * Provision an ephemeral PGlite-backed Kovo Postgres runtime for RLS tests.
 *
 * This is the canonical app-facing home for the testing capability. It exercises the same
 * principal, reader, admin, and system paths as the server runtime without exposing a parallel
 * `@kovojs/server/testing` API (SPEC §§10.3, 12).
 */
export async function createPostgresTestRuntime(
  options: KovoPostgresTestRuntimeOptions,
): Promise<KovoPostgresTestRuntime> {
  return (await createInternalPostgresTestRuntime(options)) as unknown as KovoPostgresTestRuntime;
}
