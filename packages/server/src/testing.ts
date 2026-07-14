import './security-bootstrap.js';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFrameworkOutputFileSystemBoundary } from '@kovojs/core/internal/filesystem';

import {
  actAsNonRequestPrincipal,
  declareSystemPrincipal,
  isProvenPrincipal,
} from './auth-principal.js';
import { guards } from './guards.js';
import { usePostgresAppRuntimeDb } from './internal/postgres-capability.js';
import { managedDb, type Reader } from './managed-db.js';
import { createPostgresAppRuntimeDb, type KovoPostgresRuntimeDb } from './postgres-runtime.js';
import type { KovoPostgresAppRuntimeOptions } from './postgres-runtime.js';

/** Drizzle database handle passed to Postgres testing principal callbacks. */
export type KovoPostgresTestDb = KovoPostgresRuntimeDb;

/**
 * Read-only Postgres testing handle for admin-guarded cross-owner reads.
 *
 * SPEC §10.3: this is the same `Reader<Db>` shape the runtime vends to guarded read surfaces,
 * including the audited `crossOwnerRead(...)` capability. It does not expose a write handle.
 */
export type KovoPostgresTestAdminDb = Reader<KovoPostgresRuntimeDb>;

/** Drizzle database handle passed to audited Postgres system test callbacks. */
export type KovoPostgresTestSystemDb = KovoPostgresRuntimeDb;

/** Configuration for `createPostgresTestRuntime`. */
export interface KovoPostgresTestRuntimeOptions {
  /**
   * Physical owner/authz tables allowed to use the audited `asAdmin(...).crossOwnerRead(...)`
   * path. Tests must opt in per table so the helper exercises the same `kovo_admin_scope`
   * policy posture as the app runtime (SPEC §10.3 DEC-G).
   */
  crossOwnerReadTables?: readonly string[];
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
  /**
   * Run test code through the Postgres runtime's admin-guarded read posture.
   *
   * This helper creates a request-shaped object, passes the real `guards.role("admin")` runtime
   * marker, and then exposes only the framework read handle. It requires
   * `crossOwnerReadTables` at runtime creation so cross-owner reads stay per-table opt-in rather
   * than becoming a blanket test bypass (SPEC §10.3 DEC-G).
   *
   * @param principalId Proven non-empty admin principal id recorded in audit facts.
   * @param callback Test body that receives the request-scoped read-only database handle.
   * @returns The callback result.
   */
  asAdmin<Result>(
    principalId: string,
    callback: (db: KovoPostgresTestAdminDb) => Result | Promise<Result>,
  ): Promise<Result>;
  /**
   * Run test code through the Postgres runtime's audited system posture.
   *
   * SPEC §10.3 DEC-G: this is an explicit non-request cross-owner posture backed by
   * transaction-scoped RLS settings. It requires a non-empty audited reason and does not expose
   * ambient system authority outside the callback's managed DB handle.
   *
   * @param reason Non-empty audited reason for the system operation.
   * @param callback Test body that receives the transaction-scoped system database handle.
   * @returns The callback result.
   */
  asSystem<Result>(
    reason: string,
    callback: (db: KovoPostgresTestSystemDb) => Result | Promise<Result>,
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
  const tempRoot = createFrameworkOutputFileSystemBoundary(join(tmpdir(), 'kovo-postgres-test'));
  const dataDir = await tempRoot.createStagingRoot('kovo-postgres-test-');
  const dataDirFileSystem = createFrameworkOutputFileSystemBoundary(dataDir);
  const runtimeOptions: KovoPostgresAppRuntimeOptions = {
    dataDir,
    driver: 'pglite',
    provisionOnBoot: true,
    schema: options.schema,
  };
  if (options.crossOwnerReadTables !== undefined) {
    runtimeOptions.crossOwnerReadTables = options.crossOwnerReadTables;
  }
  if (options.seedSql !== undefined) runtimeOptions.seedSql = options.seedSql;

  const runtime = createPostgresAppRuntimeDb(runtimeOptions);
  const hasAdminTableOptIn =
    options.crossOwnerReadTables?.some((table) => table.trim() !== '') === true;
  let closed = false;

  try {
    await runtime.ready;
  } catch (error) {
    await runtime.close().catch(() => undefined);
    await dataDirFileSystem.removeTree().catch(() => undefined);
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
        await dataDirFileSystem.removeTree();
      }
    },
    async withPrincipal<Result>(
      principalId: string,
      callback: (db: KovoPostgresTestDb) => Result | Promise<Result>,
    ): Promise<Result> {
      if (closed) throw new Error('Postgres test runtime is already closed.');
      assertPostgresTestPrincipal('withPrincipal', principalId);
      const posture = actAsNonRequestPrincipal(principalId, {
        ingress: 'endpoint',
        operation: 'write',
        surface: 'createPostgresTestRuntime.withPrincipal',
      });
      return await callback(usePostgresAppRuntimeDb(runtime, { principalPosture: posture }));
    },
    async asAdmin<Result>(
      principalId: string,
      callback: (db: KovoPostgresTestAdminDb) => Result | Promise<Result>,
    ): Promise<Result> {
      if (closed) throw new Error('Postgres test runtime is already closed.');
      assertPostgresTestPrincipal('asAdmin', principalId);
      if (!hasAdminTableOptIn) {
        throw new Error(
          'asAdmin(id, fn) requires createPostgresTestRuntime({ crossOwnerReadTables: [...] }) so admin reads are explicitly table-scoped (SPEC §10.3 DEC-G).',
        );
      }
      const request: KovoPostgresAdminTestRequest = {
        session: { user: { id: principalId, roles: ['admin'] } },
      };
      const guardResult = await guards.role<KovoPostgresAdminTestRequest>('admin')(request);
      if (guardResult !== true) {
        throw new Error('asAdmin(id, fn) could not establish the admin role guard.');
      }
      return await callback(managedDb(usePostgresAppRuntimeDb(runtime, request), 'read'));
    },
    async asSystem<Result>(
      reason: string,
      callback: (db: KovoPostgresTestSystemDb) => Result | Promise<Result>,
    ): Promise<Result> {
      if (closed) throw new Error('Postgres test runtime is already closed.');
      const posture = declareSystemPrincipal(reason, {
        ingress: 'endpoint',
        operation: 'write',
        surface: 'createPostgresTestRuntime.asSystem',
      });
      return await callback(usePostgresAppRuntimeDb(runtime, { principalPosture: posture }));
    },
  };
}

interface KovoPostgresAdminTestRequest {
  session: {
    user: {
      id: string;
      roles: readonly string[];
    };
  };
}

function assertPostgresTestPrincipal(
  helper: 'asAdmin' | 'withPrincipal',
  principalId: string,
): void {
  if (isProvenPrincipal(principalId)) return;
  throw new TypeError(
    `${helper}(id) requires a proven non-empty principal id for Postgres owner-scoped tests.`,
  );
}
