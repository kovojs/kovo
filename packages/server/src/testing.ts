import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isProvenPrincipal } from './auth-principal.js';
import { createPostgresAppRuntimeDb, type KovoPostgresRuntimeDb } from './postgres-runtime.js';
import type { KovoPostgresAppRuntimeOptions } from './postgres-runtime.js';

/** Drizzle database handle passed to Postgres testing principal callbacks. */
export type KovoPostgresTestDb = KovoPostgresRuntimeDb;

/** Configuration for `createPostgresTestRuntime`. */
export interface KovoPostgresTestRuntimeOptions {
  /**
   * The app schema module, usually `import * as schema from '../src/schema.js'`.
   * Kovo derives the test DDL and RLS policy posture from the same schema metadata as app boot.
   */
  schema: Record<string, unknown>;
  /** Optional SQL statements to run after the ephemeral PGlite schema is provisioned. */
  seedSql?: string | readonly string[];
}

/** Ephemeral PGlite-backed test runtime for owner-scoped Postgres behavior. */
export interface KovoPostgresTestRuntime {
  /** Temporary PGlite data directory owned and removed by `close()`. */
  readonly dataDir: string;
  /** Release the runtime and remove its temporary PGlite data directory. */
  close(): Promise<void>;
  /**
   * Run test code through the real Kovo Postgres owner-scoped runtime as one principal.
   *
   * SPEC §10.3: this helper exercises the same provisioned RLS engine as generated app DB
   * wiring. It deliberately exposes no system/admin helper until the runtime has an honest
   * cross-owner posture for those cases.
   *
   * @param principalId Proven non-empty owner principal id for the callback.
   * @param callback Test body that receives the request-scoped Drizzle database handle.
   * @returns The callback result.
   */
  withPrincipal<Result>(
    principalId: string,
    callback: (db: KovoPostgresTestDb) => Result | Promise<Result>,
  ): Promise<Result>;
}

/**
 * Provision an ephemeral PGlite-backed Kovo Postgres runtime for tests.
 *
 * The helper always forces the local PGlite driver and provisions before returning, so tests do
 * not accidentally depend on `KOVO_DATABASE_URL` or an app server/auth stack.
 *
 * @param options App schema and optional seed SQL for the test database.
 * @returns A scoped runtime with `withPrincipal(id, fn)` and cleanup via `close()`.
 */
export async function createPostgresTestRuntime(
  options: KovoPostgresTestRuntimeOptions,
): Promise<KovoPostgresTestRuntime> {
  const dataDir = await mkdtemp(join(tmpdir(), 'kovo-postgres-test-'));
  const runtimeOptions: KovoPostgresAppRuntimeOptions = {
    dataDir,
    driver: 'pglite',
    postureCheckOnBoot: false,
    provisionOnBoot: true,
    schema: options.schema,
  };
  if (options.seedSql !== undefined) runtimeOptions.seedSql = options.seedSql;

  const runtime = createPostgresAppRuntimeDb(runtimeOptions);
  let closed = false;

  try {
    await runtime.ready;
  } catch (error) {
    await runtime.close().catch(() => undefined);
    await rm(dataDir, { force: true, recursive: true }).catch(() => undefined);
    throw error;
  }

  return {
    dataDir,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await runtime.close();
      } finally {
        await rm(dataDir, { force: true, recursive: true });
      }
    },
    async withPrincipal<Result>(
      principalId: string,
      callback: (db: KovoPostgresTestDb) => Result | Promise<Result>,
    ): Promise<Result> {
      if (closed) throw new Error('Postgres test runtime is already closed.');
      assertPostgresTestPrincipal(principalId);
      return await callback(
        runtime.db({ principalPosture: { kind: 'act-as', principal: principalId } }),
      );
    },
  };
}

function assertPostgresTestPrincipal(principalId: string): void {
  if (isProvenPrincipal(principalId)) return;
  throw new TypeError(
    'withPrincipal(id) requires a proven non-empty principal id for Postgres owner-scoped tests.',
  );
}
