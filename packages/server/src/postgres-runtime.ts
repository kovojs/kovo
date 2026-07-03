import { createHash } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';
import { extractKovoRuntimeDbMetadata, type KovoRuntimeDbMetadata } from '@kovojs/drizzle';
import { buildRelations, type AnyRelations, type SQL } from 'drizzle-orm';
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { Pool, type PoolClient, type PoolConfig, type QueryConfig, type QueryResultRow } from 'pg';

import {
  assertNonRequestPrincipalPosture,
  type NonRequestPrincipalPosture,
} from './auth-principal.js';
import {
  createAuthorizationCensusDb,
  createDeclaredWriteDb,
  createPostgresReadonlyClient,
  createPostgresScopedClient,
  kovoDeclaredWriteDbHandle,
  kovoReadonlyDbHandle,
  readonlyDb,
  type PostgresReadonlyClientOptions,
  type PostgresScopedClientOptions,
  type Reader,
} from './managed-db.js';
import { requestPassedRoleGuard } from './guards.js';
import { createSecretBoxingReadDb } from './secret-read-boundary.js';

const DEFAULT_DATA_DIR = '.kovo/pglite';
const DEFAULT_ADMIN_ROLE = 'kovo_admin';
const DEFAULT_READER_ROLE = 'kovo_reader';
const DEFAULT_WRITER_ROLE = 'kovo_writer';
const MIGRATIONS_TABLE = 'kovo_migrations';
const SCHEMA_STATE_TABLE = 'kovo_schema_state';
const RUNTIME_LEAST_PRIVILEGE_ERROR = 'runtime must be a least-privilege login role';
const internalPostgresRuntimeDbCapability: unique symbol = Symbol(
  'kovo.postgres-runtime.internal-db',
);

type PgTableConfig = ReturnType<typeof getTableConfig>;
type PgTable = Parameters<typeof getTableConfig>[0];
type PgColumn = PgTableConfig['columns'][number];
type PgForeignKey = PgTableConfig['foreignKeys'][number];

const POSTGRES_POLICY_DIALECT = new PgDialect();

interface DeclaredWritePolicy {
  tables?: readonly string[];
  touches?: readonly string[];
}

interface AuthzPolicyPredicate {
  dependencyTableNames: readonly string[];
  predicate: string;
  tableName: string;
}

interface ProtectedPostgresTable {
  kind: 'authzPolicy' | 'owner' | 'ownerVia';
  predicate: string;
  tableName: string;
}

interface PostgresCatalogRelation {
  relforcerowsecurity: boolean;
  relkind: string;
  reloptions: string[] | null;
  relrowsecurity: boolean;
  schema_name: string;
  table_name: string;
}

interface PostgresViewDependency {
  table_name: string;
  table_schema: string;
}

interface KovoDomainAnnotation {
  authzPolicy?: unknown;
  domain?: unknown;
}

interface DrizzleSqlLike {
  readonly queryChunks?: unknown;
  toQuery?: unknown;
  readonly usedTables?: unknown;
}

interface RuntimeTransactionClient {
  exec(statement: string): Promise<unknown>;
  query<Row extends QueryResultRow = QueryResultRow>(
    query: string,
    params?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

interface RuntimeSqlClient extends RuntimeTransactionClient {
  transaction<Result>(callback: (tx: RuntimeTransactionClient) => Promise<Result>): Promise<Result>;
}

interface ResolvedPostgresRuntimeConfig {
  adminRole: string;
  createReaderRole: boolean;
  createAdminRole: boolean;
  createWriterRole: boolean;
  crossOwnerReadTables: ReadonlySet<string>;
  dataDir: string;
  databaseUrl?: string;
  driver: KovoPostgresResolvedRuntimeDriver;
  postureCheckOnBoot: boolean;
  principalFromRequest: (request: unknown) => string | undefined;
  provisionOnBoot: boolean;
  readerRole: string;
  schema: Record<string, unknown>;
  seedSql: readonly string[];
  writerRole: string;
}

interface CreatedRuntimeClient {
  close(): Promise<void>;
  drizzleInternalDb(capability: typeof internalPostgresRuntimeDbCapability): KovoPostgresRuntimeDb;
  drizzleReadonlyDb(
    principal: string | undefined,
    role: string | false,
    roleSetting?: string,
  ): KovoPostgresRuntimeDb;
  drizzleRequestDb(principal: string | undefined, roleSetting?: string): KovoPostgresRuntimeDb;
  sql: RuntimeSqlClient;
  label: string;
}

interface PostgresRequestScope {
  principal?: string;
  roleSetting?: string;
}

/** Concrete Postgres runtime driver selected after config/env resolution. */
export type KovoPostgresResolvedRuntimeDriver = 'node-postgres' | 'pglite';

/** Driver selector accepted by the generated app Postgres runtime. */
export type KovoPostgresRuntimeDriver = KovoPostgresResolvedRuntimeDriver | 'pg';

/** Drizzle database handle shape returned by the generated Postgres app runtime. */
export type KovoPostgresRuntimeDb = PgliteDatabase | NodePgDatabase;

/** Configuration accepted by the generated app Postgres runtime helper. */
export interface KovoPostgresAppRuntimeOptions {
  /**
   * The app schema module, usually `import * as schema from '../schema.js'`.
   * The runtime derives Postgres tables, DDL, RLS policies, and metadata from it.
   */
  schema: Record<string, unknown>;
  /** Override the persistent PGlite directory. Defaults to `KOVO_DATA_DIR` or `.kovo/pglite`. */
  dataDir?: string;
  /** Override the external Postgres URL. Defaults to `KOVO_DATABASE_URL`. */
  databaseUrl?: string;
  /** Force the driver. Defaults to external Postgres when a database URL is present, PGlite otherwise. */
  driver?: KovoPostgresRuntimeDriver;
  /**
   * Run privileged provisioning during app boot. Defaults to true for PGlite and false for
   * external Postgres so production boot does not perform DDL/grants.
   */
  provisionOnBoot?: boolean;
  /**
   * Check schema/RLS/grant posture during app boot. Defaults to true for external Postgres and
   * false for PGlite because the default PGlite path provisions in-process first.
   */
  postureCheckOnBoot?: boolean;
  principalFromRequest?: (request: unknown) => string | undefined;
  readerRole?: string;
  /**
   * Role used by audited `crossOwnerRead(...)` calls. Defaults to `KOVO_DB_ADMIN_ROLE` or
   * `kovo_admin`; only used when `crossOwnerReadTables` is non-empty.
   */
  adminRole?: string;
  /** Physical owner/authz table names that should receive the per-table `kovo_admin_scope` policy. */
  crossOwnerReadTables?: readonly string[];
  seedSql?: string | readonly string[];
  writerRole?: string;
}

/** One reviewed SQL migration file applied by the Postgres migration runner. */
export interface KovoPostgresMigration {
  /** Stable migration id, usually the SQL file name. */
  id: string;
  /** SQL to apply transactionally. */
  sql: string;
}

/** Result of applying reviewed Postgres migrations before reasserting Kovo posture. */
export interface KovoPostgresMigrationRunReport {
  applied: readonly string[];
  posture: KovoPostgresPostureReport;
  skipped: readonly string[];
}

/** One generated, reviewable Postgres migration plan. */
export interface KovoPostgresMigrationPlan {
  /** Runtime driver used to inspect the current database. */
  driver: KovoPostgresResolvedRuntimeDriver;
  /** Reversible SQL for rolling back the generated additive changes. */
  downSql: string;
  /** True when the current database already matches the schema for supported additive changes. */
  empty: boolean;
  /** Human-readable summary of generated operations. */
  operations: readonly string[];
  /** Reviewable SQL to apply through `kovo db migrate`. */
  upSql: string;
}

/** Created app database runtime used by generated `src/_kovo/app-runtime-db.ts` modules. */
export interface KovoPostgresAppRuntimeDb {
  db(request?: unknown): KovoPostgresRuntimeDb;
  readonlyDb: Reader<KovoPostgresRuntimeDb>;
  ready: Promise<void>;
  close(): Promise<void>;
}

/** Privileged external Postgres provisioning options for the app schema. */
export interface KovoPostgresProvisionOptions extends KovoPostgresAppRuntimeOptions {
  /**
   * Force a connection string for provisioning. This must be a privileged owner/admin connection
   * for external Postgres.
   */
  databaseUrl: string;
  /** Reviewed SQL migrations to apply before Kovo reasserts RLS policies/grants. */
  migrations?: readonly KovoPostgresMigration[];
}

/** Migration runner options for embedded PGlite or external Postgres. */
export interface KovoPostgresMigrateOptions extends KovoPostgresAppRuntimeOptions {
  /** Reviewed SQL migrations to apply before Kovo reasserts RLS policies/grants. */
  migrations: readonly KovoPostgresMigration[];
}

/** Options for planning an additive reviewed SQL migration from the current DB to `schema.ts`. */
export interface KovoPostgresMigrationPlanOptions extends KovoPostgresAppRuntimeOptions {}

/** One failing Postgres schema/RLS/grant posture check. */
export interface KovoPostgresPostureIssue {
  code: string;
  detail: string;
}

/** Result of checking an existing Postgres database against the app schema posture. */
export interface KovoPostgresPostureReport {
  driver: KovoPostgresResolvedRuntimeDriver;
  fingerprint: string;
  ok: boolean;
  issues: readonly KovoPostgresPostureIssue[];
}

/**
 * Framework-owned Postgres runtime wiring for generated apps (SPEC §10.3).
 *
 * The default no-env path keeps the technical-preview PGlite developer database. Setting
 * `KOVO_DATABASE_URL` switches to an external Postgres pool whose boot path checks existing
 * posture but does not create roles, tables, policies, or grants.
 */
export function createPostgresAppRuntimeDb(
  options: KovoPostgresAppRuntimeOptions,
): KovoPostgresAppRuntimeDb {
  const config = resolvePostgresRuntimeConfig(options);
  const schemaTables = sortTablesByForeignKeyDependencies(postgresTablesFromSchema(config.schema));
  const metadata = extractKovoRuntimeDbMetadata(schemaTables);
  const ddl = schemaDdl(schemaTables);
  const fingerprint = schemaFingerprint(schemaTables, metadata);
  const client = createRuntimeClient(config);
  const ready = initializeRuntimeDb(client.sql, {
    config,
    fingerprint,
    metadata,
    schemaDdl: ddl,
    schemaTables,
  });

  return {
    db(request?: unknown) {
      const scope = postgresRequestScope(request, config);
      return createRequestScopedDb(
        client.drizzleRequestDb(scope.principal, scope.roleSetting),
        client,
        config,
        metadata,
        scope,
        request,
      );
    },
    readonlyDb: createRequestScopedReadonlyDb(client, config, metadata),
    ready,
    close: () => client.close(),
  };
}

/**
 * Privileged provisioner for an external Postgres database. Run this from the CLI or deployment
 * setup, not from ordinary app boot (SPEC §10.3).
 */
export async function provisionPostgresAppDb(
  options: KovoPostgresProvisionOptions,
): Promise<KovoPostgresPostureReport> {
  const config = resolvePostgresRuntimeConfig({
    ...options,
    driver: 'node-postgres',
    postureCheckOnBoot: false,
    provisionOnBoot: true,
  });
  const schemaTables = sortTablesByForeignKeyDependencies(postgresTablesFromSchema(config.schema));
  const metadata = extractKovoRuntimeDbMetadata(schemaTables);
  const fingerprint = schemaFingerprint(schemaTables, metadata);
  const client = createRuntimeClient(config);
  try {
    await provisionRuntimeDb(client.sql, {
      applySchemaDdl: false,
      config,
      fingerprint,
      metadata,
      migrations: options.migrations ?? [],
      schemaDdl: schemaDdl(schemaTables),
      schemaTables,
    });
    return await checkRuntimeDbPosture(client.sql, {
      config,
      fingerprint,
      metadata,
      schemaTables,
    });
  } finally {
    await client.close();
  }
}

/**
 * Apply reviewed table-structure migrations, then re-derive and re-assert framework-owned
 * Postgres RLS policies, grants, and the schema fingerprint (SPEC §10.3).
 */
export async function migratePostgresAppDb(
  options: KovoPostgresMigrateOptions,
): Promise<KovoPostgresMigrationRunReport> {
  const config = resolvePostgresRuntimeConfig({
    ...options,
    postureCheckOnBoot: false,
    provisionOnBoot: false,
  });
  const schemaTables = sortTablesByForeignKeyDependencies(postgresTablesFromSchema(config.schema));
  const metadata = extractKovoRuntimeDbMetadata(schemaTables);
  const fingerprint = schemaFingerprint(schemaTables, metadata);
  const client = createRuntimeClient(config);
  try {
    const migrations = await provisionRuntimeDb(client.sql, {
      applySchemaDdl: false,
      config,
      fingerprint,
      metadata,
      migrations: options.migrations,
      schemaDdl: schemaDdl(schemaTables),
      schemaTables,
    });
    const posture = await checkRuntimeDbPosture(client.sql, {
      config,
      fingerprint,
      metadata,
      schemaTables,
    });
    return { ...migrations, posture };
  } finally {
    await client.close();
  }
}

/**
 * Diff the current Postgres schema against the app Drizzle schema and emit a conservative,
 * reviewable up/down migration (SPEC §10.3). This generator intentionally covers additive table
 * and column changes only; destructive edits, renames, and data backfills stay hand-authored.
 */
export async function planPostgresAppDbMigration(
  options: KovoPostgresMigrationPlanOptions,
): Promise<KovoPostgresMigrationPlan> {
  const config = resolvePostgresRuntimeConfig({
    ...options,
    postureCheckOnBoot: false,
    provisionOnBoot: false,
  });
  const schemaTables = sortTablesByForeignKeyDependencies(postgresTablesFromSchema(config.schema));
  const client = createRuntimeClient(config);
  try {
    return await planRuntimeDbMigration(client.sql, schemaTables, config.driver);
  } finally {
    await client.close();
  }
}

/**
 * Check that an existing external Postgres database has the schema fingerprint and owner/RLS
 * posture Kovo expects. This is the boot-time fail-closed check for managed Postgres.
 */
export async function checkPostgresAppDbPosture(
  options: KovoPostgresAppRuntimeOptions,
): Promise<KovoPostgresPostureReport> {
  const config = resolvePostgresRuntimeConfig({
    ...options,
    driver: options.driver ?? 'node-postgres',
    provisionOnBoot: false,
  });
  const schemaTables = sortTablesByForeignKeyDependencies(postgresTablesFromSchema(config.schema));
  const metadata = extractKovoRuntimeDbMetadata(schemaTables);
  const client = createRuntimeClient(config);
  try {
    if (config.driver === 'node-postgres') {
      const leastPrivilegeIssue = await runtimeConnectionLeastPrivilegeIssue(client.sql, config);
      if (leastPrivilegeIssue !== undefined) {
        return {
          driver: config.driver,
          fingerprint: schemaFingerprint(schemaTables, metadata),
          issues: [leastPrivilegeIssue],
          ok: false,
        };
      }
    }
    return await checkRuntimeDbPosture(client.sql, {
      config,
      fingerprint: schemaFingerprint(schemaTables, metadata),
      metadata,
      schemaTables,
    });
  } finally {
    await client.close();
  }
}

async function initializeRuntimeDb(
  client: RuntimeSqlClient,
  input: {
    config: ResolvedPostgresRuntimeConfig;
    fingerprint: string;
    metadata: KovoRuntimeDbMetadata;
    schemaDdl: string;
    schemaTables: readonly PgTable[];
  },
): Promise<void> {
  if (input.config.provisionOnBoot) {
    await provisionRuntimeDb(client, { ...input, applySchemaDdl: true, migrations: [] });
  }
  if (input.config.driver === 'node-postgres') {
    await assertRuntimeConnectionLeastPrivilege(client, input.config);
  }
  if (input.config.postureCheckOnBoot) {
    const report = await checkRuntimeDbPosture(client, input);
    if (!report.ok) {
      throw new Error(
        [
          'KV433: Postgres app database posture check failed during boot (SPEC §10.3).',
          ...report.issues.map((issue) => `  ${issue.code}: ${issue.detail}`),
        ].join('\n'),
      );
    }
  }
}

async function provisionRuntimeDb(
  client: RuntimeSqlClient,
  input: {
    applySchemaDdl: boolean;
    config: ResolvedPostgresRuntimeConfig;
    fingerprint: string;
    metadata: KovoRuntimeDbMetadata;
    migrations: readonly KovoPostgresMigration[];
    schemaDdl: string;
    schemaTables: readonly PgTable[];
  },
): Promise<{ applied: readonly string[]; skipped: readonly string[] }> {
  if (input.config.createAdminRole) await ensurePostgresRole(client, input.config.adminRole);
  if (input.config.createReaderRole) await ensurePostgresRole(client, input.config.readerRole);
  if (input.config.createWriterRole) await ensurePostgresRole(client, input.config.writerRole);
  const migrationReport = await applyPostgresMigrations(client, input.migrations);
  if (input.applySchemaDdl) await client.exec(input.schemaDdl);
  await client.exec(
    'REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(text,text,boolean) FROM PUBLIC',
  );
  await applyPostgresDefaultDenyPrivileges(client, input.schemaTables, input.config);
  await applyPostgresRlsPolicies(client, input.schemaTables, input.metadata, input.config);
  await applyPostgresReaderColumnPrivileges(
    client,
    input.schemaTables,
    input.metadata,
    input.config,
  );
  await applyPostgresWriterTablePrivileges(
    client,
    input.schemaTables,
    input.metadata,
    input.config,
  );
  await persistSchemaFingerprint(client, input.fingerprint);
  for (const statement of input.config.seedSql) await client.exec(statement);
  return migrationReport;
}

async function checkRuntimeDbPosture(
  client: RuntimeSqlClient,
  input: {
    config: ResolvedPostgresRuntimeConfig;
    fingerprint: string;
    metadata: KovoRuntimeDbMetadata;
    schemaTables: readonly PgTable[];
  },
): Promise<KovoPostgresPostureReport> {
  const issues: KovoPostgresPostureIssue[] = [];
  const state = await safeQuery<{ value: string }>(
    client,
    `SELECT value FROM ${quoteIdent(SCHEMA_STATE_TABLE)} WHERE key = $1`,
    ['fingerprint'],
  );
  if (state === undefined || state.rows[0]?.value !== input.fingerprint) {
    issues.push({
      code: 'KV433_SCHEMA_FINGERPRINT',
      detail: `expected schema fingerprint ${input.fingerprint}`,
    });
  }

  for (const [tableName, owner] of input.metadata.ownerSourcesByTable) {
    const rls = await safeQuery<{ relforcerowsecurity: boolean; relrowsecurity: boolean }>(
      client,
      'SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1',
      [tableName],
    );
    const row = rls?.rows[0];
    if (row?.relrowsecurity !== true || row.relforcerowsecurity !== true) {
      issues.push({
        code: 'KV433_FORCE_RLS',
        detail: `${tableName} must have row-level security enabled and forced`,
      });
    }
    const policy = await safeQuery(
      client,
      'SELECT 1 FROM pg_policies WHERE tablename = $1 AND policyname = $2',
      [tableName, 'kovo_owner_scope'],
    );
    if ((policy?.rows.length ?? 0) === 0) {
      issues.push({
        code: 'KV433_OWNER_POLICY',
        detail: `${tableName} is missing kovo_owner_scope for ${owner.columnName}`,
      });
    }
    const systemPolicy = await safeQuery(
      client,
      'SELECT 1 FROM pg_policies WHERE tablename = $1 AND policyname = $2',
      [tableName, 'kovo_system_scope'],
    );
    if ((systemPolicy?.rows.length ?? 0) === 0) {
      issues.push({
        code: 'KV433_SYSTEM_POLICY',
        detail: `${tableName} is missing kovo_system_scope for audited system posture`,
      });
    }
  }

  for (const [tableName, ownerVia] of input.metadata.ownerViaSourcesByTable) {
    const policy = await safeQuery(
      client,
      'SELECT 1 FROM pg_policies WHERE tablename = $1 AND policyname = $2',
      [tableName, 'kovo_owner_scope'],
    );
    if ((policy?.rows.length ?? 0) === 0) {
      issues.push({
        code: 'KV433_OWNER_VIA_POLICY',
        detail: `${tableName} is missing owner-via policy through ${ownerVia.parentTable}`,
      });
    }
    const systemPolicy = await safeQuery(
      client,
      'SELECT 1 FROM pg_policies WHERE tablename = $1 AND policyname = $2',
      [tableName, 'kovo_system_scope'],
    );
    if ((systemPolicy?.rows.length ?? 0) === 0) {
      issues.push({
        code: 'KV433_SYSTEM_POLICY',
        detail: `${tableName} is missing kovo_system_scope for audited system posture`,
      });
    }
  }

  const authzPolicyPredicates = customAuthzPolicyPredicatesByTable(input.schemaTables);
  for (const [tableName] of authzPolicyPredicates) {
    const rls = await safeQuery<{ relforcerowsecurity: boolean; relrowsecurity: boolean }>(
      client,
      'SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1',
      [tableName],
    );
    const row = rls?.rows[0];
    if (row?.relrowsecurity !== true || row.relforcerowsecurity !== true) {
      issues.push({
        code: 'KV433_FORCE_RLS',
        detail: `${tableName} custom authzPolicy must have row-level security enabled and forced`,
      });
    }
    const policy = await safeQuery(
      client,
      'SELECT 1 FROM pg_policies WHERE tablename = $1 AND policyname = $2',
      [tableName, 'kovo_authz_policy'],
    );
    if ((policy?.rows.length ?? 0) === 0) {
      issues.push({
        code: 'KV433_AUTHZ_POLICY',
        detail: `${tableName} is missing kovo_authz_policy for its custom authzPolicy predicate`,
      });
    }
    const systemPolicy = await safeQuery(
      client,
      'SELECT 1 FROM pg_policies WHERE tablename = $1 AND policyname = $2',
      [tableName, 'kovo_system_scope'],
    );
    if ((systemPolicy?.rows.length ?? 0) === 0) {
      issues.push({
        code: 'KV433_SYSTEM_POLICY',
        detail: `${tableName} is missing kovo_system_scope for audited system posture`,
      });
    }
  }

  for (const tableName of input.config.crossOwnerReadTables) {
    const policy = await safeQuery(
      client,
      'SELECT 1 FROM pg_policies WHERE tablename = $1 AND policyname = $2',
      [tableName, 'kovo_admin_scope'],
    );
    if ((policy?.rows.length ?? 0) === 0) {
      issues.push({
        code: 'KV433_ADMIN_POLICY',
        detail: `${tableName} is missing kovo_admin_scope for crossOwnerRead`,
      });
    }
  }

  for (const table of input.schemaTables) {
    const tableName = getTableConfig(table).name;
    const secretColumns = input.metadata.secretColumnNamesByTable.get(tableName) ?? new Set();
    for (const column of secretColumns) {
      const grant = await safeQuery(
        client,
        [
          'SELECT 1 FROM information_schema.column_privileges',
          'WHERE table_name = $1 AND column_name = $2 AND grantee = $3 AND privilege_type = $4',
        ].join(' '),
        [tableName, column, input.config.readerRole, 'SELECT'],
      );
      if ((grant?.rows.length ?? 0) > 0) {
        issues.push({
          code: 'KV435_SECRET_COLUMN_GRANT',
          detail: `${input.config.readerRole} must not have SELECT on ${tableName}.${column}`,
        });
      }
    }
  }

  issues.push(...(await auditPostgresReachableClosure(client, input)));

  return {
    driver: input.config.driver,
    fingerprint: input.fingerprint,
    issues,
    ok: issues.length === 0,
  };
}

async function auditPostgresReachableClosure(
  client: RuntimeSqlClient,
  input: {
    config: ResolvedPostgresRuntimeConfig;
    metadata: KovoRuntimeDbMetadata;
    schemaTables: readonly PgTable[];
  },
): Promise<KovoPostgresPostureIssue[]> {
  const issues: KovoPostgresPostureIssue[] = [];
  const protectedTables = resolveProtectedPostgresTables(input.schemaTables, input.metadata);
  const protectedTableNames = new Set([
    ...protectedTables.keys(),
    ...input.config.crossOwnerReadTables,
  ]);
  const allowlistedTables = postgresReachabilityAllowlist(input.schemaTables, input.metadata);
  const grantRows = await safeQuery<{
    grantee: string;
    privilege_type: string;
    table_name: string;
    table_schema: string;
  }>(
    client,
    [
      'SELECT DISTINCT table_schema, table_name, grantee, privilege_type',
      'FROM information_schema.role_table_grants',
      'WHERE grantee IN ($1, $2, $3)',
      "AND table_schema NOT IN ('pg_catalog', 'information_schema')",
      'ORDER BY table_schema, table_name, grantee, privilege_type',
    ].join(' '),
    [input.config.readerRole, input.config.writerRole, input.config.adminRole],
  );
  if (grantRows === undefined) {
    issues.push({
      code: 'KV433_REACHABILITY_AUDIT',
      detail: 'could not enumerate app-role table grants from information_schema.role_table_grants',
    });
    return issues;
  }

  const reachable = new Map<string, { schema: string; table: string }>();
  for (const row of grantRows.rows) {
    reachable.set(`${row.table_schema}.${row.table_name}`, {
      schema: row.table_schema,
      table: row.table_name,
    });
  }

  for (const relation of reachable.values()) {
    const catalog = await postgresCatalogRelation(client, relation.schema, relation.table);
    if (catalog === undefined) {
      issues.push({
        code: 'KV433_REACHABLE_OBJECT',
        detail: `${relation.schema}.${relation.table} is reachable by an app role but could not be proven in pg_class`,
      });
      continue;
    }
    if (catalog.relkind === 'r' || catalog.relkind === 'p') {
      if (allowlistedTables.has(relation.table)) continue;
      if (!protectedTableNames.has(relation.table)) {
        issues.push({
          code: 'KV433_REACHABLE_TABLE',
          detail: `${relation.schema}.${relation.table} is reachable by an app role but is not a Kovo-protected table`,
        });
        continue;
      }
      const policy = await postgresHasLiveKovoPolicy(client, relation.table);
      if (catalog.relrowsecurity !== true || catalog.relforcerowsecurity !== true || !policy) {
        issues.push({
          code: 'KV433_REACHABLE_TABLE',
          detail: `${relation.schema}.${relation.table} is reachable by an app role but lacks FORCE RLS and a live Kovo policy`,
        });
      }
      continue;
    }
    if (catalog.relkind === 'v') {
      const dependencies = await postgresViewDependencies(client, relation.schema, relation.table);
      const protectedDependencies = dependencies.filter((dependency) =>
        protectedTableNames.has(dependency.table_name),
      );
      if (!postgresViewIsSecurityInvoker(catalog)) {
        issues.push({
          code: 'KV433_REACHABLE_VIEW',
          detail:
            protectedDependencies.length > 0
              ? `reachable non-security_invoker view ${relation.table} over owner table ${protectedDependencies[0]?.table_name}`
              : `reachable non-security_invoker view ${relation.schema}.${relation.table} cannot be proven RLS-safe`,
        });
        continue;
      }
      if (dependencies.length === 0) {
        issues.push({
          code: 'KV433_REACHABLE_VIEW',
          detail: `reachable security_invoker view ${relation.schema}.${relation.table} has no provable base-table dependency set`,
        });
        continue;
      }
      for (const dependency of dependencies) {
        if (
          !allowlistedTables.has(dependency.table_name) &&
          !(await postgresBaseTableHasProtectedPosture(client, dependency))
        ) {
          issues.push({
            code: 'KV433_REACHABLE_VIEW',
            detail: `reachable security_invoker view ${relation.table} depends on unproven table ${dependency.table_name}`,
          });
        }
      }
      continue;
    }
    issues.push({
      code: 'KV433_REACHABLE_OBJECT',
      detail: `${relation.schema}.${relation.table} is reachable by an app role with unsupported relkind ${catalog.relkind}`,
    });
  }
  return issues;
}

function createRuntimeClient(config: ResolvedPostgresRuntimeConfig): CreatedRuntimeClient {
  const relations = buildRelations(
    postgresRelationSchemaFromModule(config.schema),
    {},
  ) as AnyRelations;
  if (config.driver === 'pglite') {
    const client = new PGlite(config.dataDir);
    return {
      close: () => client.close(),
      drizzleInternalDb: (capability) => {
        assertInternalPostgresRuntimeDbCapability(capability);
        return drizzlePglite({ client, relations });
      },
      drizzleReadonlyDb: (principal, role, roleSetting) =>
        drizzlePglite({
          client: createPostgresReadonlyClient(
            client,
            postgresReadonlyClientOptions(config, principal, role, roleSetting),
          ),
          relations,
        }),
      drizzleRequestDb: (principal, roleSetting) =>
        drizzlePglite({
          client: createPostgresScopedClient(
            client,
            postgresScopedClientOptions(config, principal, roleSetting),
          ),
          relations,
        }),
      label: 'PGlite',
      sql: client,
    };
  }

  const pool = new Pool({ connectionString: config.databaseUrl } satisfies PoolConfig);
  const transactionalClient = new NodePostgresRuntimeClient(pool);
  return {
    close: () => transactionalClient.close(),
    drizzleInternalDb: (capability) => {
      assertInternalPostgresRuntimeDbCapability(capability);
      return drizzleNodePg({ client: pool, relations });
    },
    drizzleReadonlyDb: (principal, role, roleSetting) =>
      drizzleNodePg({
        client: createPostgresReadonlyClient(
          transactionalClient,
          postgresReadonlyClientOptions(config, principal, role, roleSetting),
        ) as unknown as Pool,
        relations,
      }),
    drizzleRequestDb: (principal, roleSetting) =>
      drizzleNodePg({
        client: createPostgresScopedClient(
          transactionalClient,
          postgresScopedClientOptions(config, principal, roleSetting),
        ) as unknown as Pool,
        relations,
      }),
    label: 'Postgres',
    sql: transactionalClient,
  };
}

function createRequestScopedDb(
  db: KovoPostgresRuntimeDb,
  client: CreatedRuntimeClient,
  config: ResolvedPostgresRuntimeConfig,
  metadata: KovoRuntimeDbMetadata,
  scope: PostgresRequestScope = {},
  request?: unknown,
): KovoPostgresRuntimeDb {
  const governedDb = createAuthorizationCensusDb(db, {
    dialectLabel: client.label,
    metadata,
    normalizeTableName: normalizePolicyTable,
    tableNames: pgTablePolicyNames,
  });
  Object.defineProperty(governedDb, kovoReadonlyDbHandle, {
    configurable: true,
    value: () => createRequestScopedReadonlyDb(client, config, metadata, scope, request),
  });
  Object.defineProperty(governedDb, kovoDeclaredWriteDbHandle, {
    configurable: true,
    value: (policy: DeclaredWritePolicy) =>
      createDeclaredWriteDb(governedDb, policy, {
        dialectLabel: client.label,
        governedColumns: metadata,
        normalizeTableName: normalizePolicyTable,
        tableNames: pgTablePolicyNames,
      }),
  });
  return governedDb;
}

function createRequestScopedReadonlyDb(
  client: CreatedRuntimeClient,
  config: ResolvedPostgresRuntimeConfig,
  metadata: KovoRuntimeDbMetadata,
  scope: PostgresRequestScope = {},
  request?: unknown,
): Reader<KovoPostgresRuntimeDb> {
  const readDb = client.drizzleReadonlyDb(scope.principal, config.readerRole, scope.roleSetting);
  const privilegedReadDb = client.drizzleReadonlyDb(scope.principal, false, scope.roleSetting);
  const adminReadDb =
    config.crossOwnerReadTables.size === 0
      ? undefined
      : client.drizzleReadonlyDb(scope.principal, config.readerRole, 'admin');
  const crossOwnerRead =
    adminReadDb === undefined
      ? undefined
      : {
          adminClient: adminReadDb as object,
          dialectLabel: client.label,
          hasRole: (role: 'admin') => requestPassedRoleGuard(request, role),
          normalizeTableName: normalizePolicyTable,
          ownerTables: [...config.crossOwnerReadTables],
          ...(scope.principal === undefined ? {} : { principal: scope.principal }),
        };
  const rawRead = {
    dialectLabel: client.label,
    normalizeTableName: normalizePolicyTable,
    ownerTables: postgresOwnerScopedTableNames(metadata),
  };
  const readOptions = crossOwnerRead === undefined ? { rawRead } : { crossOwnerRead, rawRead };
  return createSecretBoxingReadDb(readonlyDb(readDb, readOptions), metadata, {
    privilegedDb: readonlyDb(privilegedReadDb, { rawRead }),
    rawSecretTableRead: 'engine',
  });
}

class NodePostgresRuntimeClient implements RuntimeSqlClient {
  constructor(private readonly pool: Pool) {}

  async close(): Promise<void> {
    await this.pool.end();
  }

  async exec(statement: string): Promise<unknown> {
    return this.pool.query(statement);
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    query: QueryConfig | string,
    params?: unknown[],
  ): Promise<{ rows: Row[] }> {
    const result = await this.pool.query<Row>(query as QueryConfig, params);
    return { rows: result.rows };
  }

  async transaction<Result>(
    callback: (tx: RuntimeTransactionClient) => Promise<Result>,
  ): Promise<Result> {
    const client = await this.pool.connect();
    const tx = new NodePostgresTransactionClient(client);
    try {
      await client.query('BEGIN');
      const result = await callback(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

class NodePostgresTransactionClient implements RuntimeSqlClient {
  constructor(private readonly client: PoolClient) {}

  async exec(statement: string): Promise<unknown> {
    return this.client.query(statement);
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    query: QueryConfig | string,
    params?: unknown[],
  ): Promise<{ rows: Row[] }> {
    const result = await this.client.query<Row>(query as QueryConfig, params);
    return { rows: result.rows };
  }

  async transaction<Result>(
    callback: (tx: RuntimeTransactionClient) => Promise<Result>,
  ): Promise<Result> {
    const savepoint = `kovo_sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    await this.client.query(`SAVEPOINT ${quoteIdent(savepoint)}`);
    try {
      const result = await callback(this);
      await this.client.query(`RELEASE SAVEPOINT ${quoteIdent(savepoint)}`);
      return result;
    } catch (error) {
      await this.client
        .query(`ROLLBACK TO SAVEPOINT ${quoteIdent(savepoint)}`)
        .catch(() => undefined);
      throw error;
    }
  }
}

function resolvePostgresRuntimeConfig(
  options: KovoPostgresAppRuntimeOptions,
): ResolvedPostgresRuntimeConfig {
  const driver = resolveDriver(options);
  const databaseUrl = options.databaseUrl ?? process.env.KOVO_DATABASE_URL;
  const envAdminRole = nonEmptyEnv('KOVO_DB_ADMIN_ROLE');
  const envReaderRole = nonEmptyEnv('KOVO_DB_READER_ROLE');
  const envWriterRole = nonEmptyEnv('KOVO_DB_WRITER_ROLE');
  const crossOwnerReadTables = normalizeStringSet(options.crossOwnerReadTables);
  const config: ResolvedPostgresRuntimeConfig = {
    adminRole: options.adminRole ?? envAdminRole ?? DEFAULT_ADMIN_ROLE,
    createAdminRole:
      crossOwnerReadTables.size > 0 &&
      (options.adminRole !== undefined || envAdminRole === undefined),
    createReaderRole: options.readerRole !== undefined || envReaderRole === undefined,
    createWriterRole: options.writerRole !== undefined || envWriterRole === undefined,
    crossOwnerReadTables,
    dataDir: options.dataDir ?? process.env.KOVO_DATA_DIR ?? DEFAULT_DATA_DIR,
    driver,
    postureCheckOnBoot:
      options.postureCheckOnBoot ??
      (driver === 'node-postgres' && options.provisionOnBoot !== true),
    principalFromRequest: options.principalFromRequest ?? principalFromRequest,
    provisionOnBoot: options.provisionOnBoot ?? driver === 'pglite',
    readerRole: options.readerRole ?? envReaderRole ?? DEFAULT_READER_ROLE,
    schema: options.schema,
    seedSql: normalizeSeedSql(options.seedSql),
    writerRole: options.writerRole ?? envWriterRole ?? DEFAULT_WRITER_ROLE,
  };
  if (databaseUrl !== undefined) return { ...config, databaseUrl };
  return config;
}

function nonEmptyEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

function normalizeStringSet(values: readonly string[] | undefined): ReadonlySet<string> {
  if (values === undefined) return new Set();
  return new Set(values.map((value) => value.trim()).filter((value) => value !== ''));
}

function resolveDriver(options: KovoPostgresAppRuntimeOptions): KovoPostgresResolvedRuntimeDriver {
  const rawDriver = options.driver ?? process.env.KOVO_DB_DRIVER;
  if (rawDriver === 'pglite') return 'pglite';
  if (rawDriver === 'node-postgres' || rawDriver === 'pg') return 'node-postgres';
  if (rawDriver !== undefined && rawDriver !== '') {
    throw new Error(`KV433: unsupported Kovo Postgres driver ${rawDriver}.`);
  }
  return options.databaseUrl !== undefined || process.env.KOVO_DATABASE_URL
    ? 'node-postgres'
    : 'pglite';
}

function normalizeSeedSql(seedSql: string | readonly string[] | undefined): readonly string[] {
  if (seedSql === undefined) return [];
  return typeof seedSql === 'string' ? [seedSql] : seedSql;
}

function postgresTablesFromSchema(schema: Record<string, unknown>): PgTable[] {
  const tables: PgTable[] = [];
  const seen = new Set<unknown>();
  for (const value of Object.values(schema)) {
    if (seen.has(value)) continue;
    const table = asPgTable(value);
    if (table === undefined) continue;
    tables.push(table);
    seen.add(value);
  }
  if (tables.length === 0) {
    throw new Error('KV433: Postgres runtime could not derive any Drizzle pgTable exports.');
  }
  return tables;
}

function postgresRelationSchemaFromModule(
  schema: Record<string, unknown>,
): Record<string, PgTable> {
  const tables: Record<string, PgTable> = {};
  const seen = new Set<unknown>();
  for (const [name, value] of Object.entries(schema)) {
    if (seen.has(value)) continue;
    const table = asPgTable(value);
    if (table === undefined) continue;
    tables[name] = table;
    seen.add(value);
  }
  if (Object.keys(tables).length === 0) {
    throw new Error('KV433: Postgres runtime could not derive any Drizzle pgTable exports.');
  }
  return tables;
}

function asPgTable(value: unknown): PgTable | undefined {
  try {
    getTableConfig(value as PgTable);
    return value as PgTable;
  } catch {
    return undefined;
  }
}

function schemaDdl(tables: readonly PgTable[]): string {
  return [
    ...tables.map(createTableDdl),
    ...tables.flatMap((table) =>
      getTableConfig(table).columns.map((column) => addColumnDdl(table, column)),
    ),
  ].join('\n');
}

interface ExistingPostgresTable {
  columns: ReadonlySet<string>;
  schema: string;
  table: string;
}

async function planRuntimeDbMigration(
  client: RuntimeSqlClient,
  schemaTables: readonly PgTable[],
  driver: KovoPostgresResolvedRuntimeDriver,
): Promise<KovoPostgresMigrationPlan> {
  const existingTables = await currentPostgresTables(client);
  const up: string[] = [];
  const down: string[] = [];
  const operations: string[] = [];

  for (const table of schemaTables) {
    const config = getTableConfig(table);
    const schemaName = tableSchemaName(config);
    const existing = existingTables.get(`${schemaName}.${config.name}`);
    if (existing === undefined) {
      up.push(createTableMigrationDdl(table));
      down.unshift(`DROP TABLE ${quoteTable(config)};`);
      operations.push(`create table ${schemaName}.${config.name}`);
      continue;
    }

    for (const column of config.columns) {
      if (existing.columns.has(column.name)) continue;
      up.push(addColumnMigrationDdl(table, column));
      down.unshift(`ALTER TABLE ${quoteTable(config)} DROP COLUMN ${quoteIdent(column.name)};`);
      operations.push(`add column ${schemaName}.${config.name}.${column.name}`);
    }
  }

  const empty = up.length === 0;
  return {
    downSql: empty ? '-- No generated schema changes to roll back.\n' : `${down.join('\n')}\n`,
    driver,
    empty,
    operations,
    upSql: empty ? '-- No supported additive schema changes detected.\n' : `${up.join('\n')}\n`,
  };
}

async function currentPostgresTables(
  client: RuntimeSqlClient,
): Promise<ReadonlyMap<string, ExistingPostgresTable>> {
  const tables = await client.query<{ table_name: string; table_schema: string }>(
    [
      'SELECT table_schema, table_name',
      'FROM information_schema.tables',
      "WHERE table_schema NOT IN ('information_schema', 'pg_catalog')",
      "AND table_type = 'BASE TABLE'",
    ].join(' '),
  );
  const byName = new Map<string, ExistingPostgresTable>();
  for (const row of tables.rows) {
    const columns = await client.query<{ column_name: string }>(
      [
        'SELECT column_name',
        'FROM information_schema.columns',
        'WHERE table_schema = $1 AND table_name = $2',
      ].join(' '),
      [row.table_schema, row.table_name],
    );
    byName.set(`${row.table_schema}.${row.table_name}`, {
      columns: new Set(columns.rows.map((column) => column.column_name)),
      schema: row.table_schema,
      table: row.table_name,
    });
  }
  return byName;
}

function createTableDdl(table: PgTable): string {
  const config = getTableConfig(table);
  const definitions = [
    ...config.columns.map((column) => columnDdl(column, { createTable: true })),
    ...config.foreignKeys.map((foreignKey) => foreignKeyDdl(foreignKey)),
  ];
  return `CREATE TABLE IF NOT EXISTS ${quoteTable(config)} (${definitions.join(', ')});`;
}

function createTableMigrationDdl(table: PgTable): string {
  return createTableDdl(table).replace('CREATE TABLE IF NOT EXISTS', 'CREATE TABLE');
}

function addColumnDdl(table: PgTable, column: PgColumn): string {
  return `ALTER TABLE ${quoteTable(getTableConfig(table))} ADD COLUMN IF NOT EXISTS ${columnDdl(
    column,
    { createTable: false },
  )};`;
}

function addColumnMigrationDdl(table: PgTable, column: PgColumn): string {
  return `ALTER TABLE ${quoteTable(getTableConfig(table))} ADD COLUMN ${columnDdl(column, {
    createTable: false,
  })};`;
}

function columnDdl(column: PgColumn, options: { createTable: boolean }): string {
  return [
    quoteIdent(column.name),
    columnTypeDdl(column),
    options.createTable && column.primary ? 'PRIMARY KEY' : '',
    column.notNull ? 'NOT NULL' : '',
    options.createTable && column.isUnique ? 'UNIQUE' : '',
    columnDefaultDdl(column),
  ]
    .filter(Boolean)
    .join(' ');
}

function columnTypeDdl(column: PgColumn): string {
  switch (column.columnType) {
    case 'PgBoolean':
      return 'boolean';
    case 'PgInteger':
      return 'integer';
    case 'PgJsonb':
      return 'jsonb';
    case 'PgNumeric':
      return 'numeric';
    case 'PgSerial':
      return 'serial';
    case 'PgText':
      return 'text';
    case 'PgTimestamp':
      return 'timestamp';
    default:
      throw new Error(`KV433: unsupported Postgres starter column type ${column.columnType}.`);
  }
}

function columnDefaultDdl(column: PgColumn): string {
  if (!column.hasDefault) return '';
  if (column.columnType === 'PgSerial') return '';
  if (column.columnType === 'PgTimestamp') return 'DEFAULT now()';
  if (typeof column.default === 'boolean') return `DEFAULT ${column.default ? 'true' : 'false'}`;
  if (typeof column.default === 'number') return `DEFAULT ${column.default}`;
  if (typeof column.default === 'string') return `DEFAULT ${quoteLiteral(column.default)}`;
  throw new Error(`KV433: unsupported Postgres starter default for ${column.name}.`);
}

function foreignKeyDdl(foreignKey: PgForeignKey): string {
  const reference = foreignKey.reference();
  const columns = reference.columns.map((column) => quoteIdent(column.name)).join(', ');
  const foreignColumns = reference.foreignColumns
    .map((column) => quoteIdent(column.name))
    .join(', ');
  const onDelete = foreignKey.onDelete === 'no action' ? '' : ` ON DELETE ${foreignKey.onDelete}`;
  const onUpdate = foreignKey.onUpdate === 'no action' ? '' : ` ON UPDATE ${foreignKey.onUpdate}`;
  return `FOREIGN KEY (${columns}) REFERENCES ${quoteTable(
    getTableConfig(reference.foreignTable),
  )} (${foreignColumns})${onDelete}${onUpdate}`;
}

function sortTablesByForeignKeyDependencies(tables: readonly PgTable[]): PgTable[] {
  const pending = new Set<PgTable>(tables);
  const sorted: PgTable[] = [];

  while (pending.size > 0) {
    let progressed = false;
    for (const table of pending) {
      const dependencies = getTableConfig(table).foreignKeys.map(
        (foreignKey) => foreignKey.reference().foreignTable,
      );
      if (dependencies.some((dependency) => dependency !== table && pending.has(dependency))) {
        continue;
      }
      sorted.push(table);
      pending.delete(table);
      progressed = true;
    }
    if (!progressed) {
      const names = [...pending].map((table) => getTableConfig(table).name).join(', ');
      throw new Error(`KV433: cannot order Postgres tables with cyclic foreign keys: ${names}.`);
    }
  }

  return sorted;
}

async function ensurePostgresRole(client: RuntimeSqlClient, role: string): Promise<void> {
  const result = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  if (result.rows.length === 0) await client.exec(`CREATE ROLE ${quoteIdent(role)}`);
}

function assertInternalPostgresRuntimeDbCapability(
  capability: typeof internalPostgresRuntimeDbCapability,
): void {
  if (capability !== internalPostgresRuntimeDbCapability) {
    throw new Error('KV433: internal Postgres runtime DB handle requires framework capability.');
  }
}

async function assertRuntimeConnectionLeastPrivilege(
  client: RuntimeSqlClient,
  config: ResolvedPostgresRuntimeConfig,
): Promise<void> {
  const issue = await runtimeConnectionLeastPrivilegeIssue(client, config);
  if (issue !== undefined) {
    throw new Error(`KV433: ${RUNTIME_LEAST_PRIVILEGE_ERROR} (SPEC §10.3).`);
  }
}

async function runtimeConnectionLeastPrivilegeIssue(
  client: RuntimeSqlClient,
  config: ResolvedPostgresRuntimeConfig,
): Promise<KovoPostgresPostureIssue | undefined> {
  const role = await client.query<{
    can_admin: boolean;
    rolbypassrls: boolean;
    rolsuper: boolean;
  }>(
    [
      'SELECT r.rolsuper, r.rolbypassrls,',
      "pg_has_role(current_user, $1, 'USAGE') AS can_admin",
      'FROM pg_roles r WHERE r.rolname = current_user',
    ].join(' '),
    [config.adminRole],
  );
  const row = role.rows[0];
  if (row === undefined || row.rolsuper || row.rolbypassrls || row.can_admin) {
    return {
      code: 'KV433_RUNTIME_ROLE',
      detail: RUNTIME_LEAST_PRIVILEGE_ERROR,
    };
  }
  return undefined;
}

async function applyPostgresMigrations(
  client: RuntimeSqlClient,
  migrations: readonly KovoPostgresMigration[],
): Promise<{ applied: readonly string[]; skipped: readonly string[] }> {
  const normalized = normalizePostgresMigrations(migrations);
  const applied: string[] = [];
  const skipped: string[] = [];
  if (normalized.length === 0) return { applied, skipped };

  await client.exec(
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(
      MIGRATIONS_TABLE,
    )} (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamp NOT NULL DEFAULT now())`,
  );

  for (const migration of normalized) {
    const existing = await client.query<{ checksum: string }>(
      `SELECT checksum FROM ${quoteIdent(MIGRATIONS_TABLE)} WHERE id = $1`,
      [migration.id],
    );
    const existingChecksum = existing.rows[0]?.checksum;
    if (existingChecksum !== undefined) {
      if (existingChecksum !== migration.checksum) {
        throw new Error(
          [
            `KV433_MIGRATION_CHECKSUM: Postgres migration ${migration.id} changed after it was applied.`,
            `expected ${existingChecksum}, saw ${migration.checksum} (SPEC §10.3).`,
          ].join(' '),
        );
      }
      skipped.push(migration.id);
      continue;
    }

    await client.transaction(async (tx) => {
      await tx.exec(migration.sql);
      await tx.query(`INSERT INTO ${quoteIdent(MIGRATIONS_TABLE)} (id, checksum) VALUES ($1, $2)`, [
        migration.id,
        migration.checksum,
      ]);
    });
    applied.push(migration.id);
  }

  return { applied, skipped };
}

interface NormalizedPostgresMigration extends KovoPostgresMigration {
  checksum: string;
}

function normalizePostgresMigrations(
  migrations: readonly KovoPostgresMigration[],
): NormalizedPostgresMigration[] {
  const seen = new Set<string>();
  return migrations.map((migration) => {
    const id = migration.id.trim();
    if (id === '') {
      throw new Error('KV433_MIGRATION_ID: Postgres migration id must be non-empty.');
    }
    if (seen.has(id)) {
      throw new Error(`KV433_MIGRATION_ID: duplicate Postgres migration id ${id}.`);
    }
    seen.add(id);
    const sqlText = migration.sql.trim();
    if (sqlText === '') {
      throw new Error(`KV433_MIGRATION_SQL: Postgres migration ${id} has no SQL.`);
    }
    return { checksum: postgresMigrationChecksum(sqlText), id, sql: sqlText };
  });
}

function postgresMigrationChecksum(sqlText: string): string {
  return createHash('sha256').update(sqlText).digest('hex');
}

async function applyPostgresDefaultDenyPrivileges(
  client: RuntimeSqlClient,
  tables: readonly PgTable[],
  config: ResolvedPostgresRuntimeConfig,
): Promise<void> {
  const schemas = new Set<string>();
  for (const table of tables) schemas.add(tableSchemaName(getTableConfig(table)));
  for (const schema of schemas) {
    await client.exec(
      `REVOKE ALL ON ALL TABLES IN SCHEMA ${quoteIdent(schema)} FROM ${quoteIdent(
        config.readerRole,
      )}`,
    );
    await client.exec(
      `REVOKE ALL ON ALL TABLES IN SCHEMA ${quoteIdent(schema)} FROM ${quoteIdent(
        config.writerRole,
      )}`,
    );
  }
}

async function applyPostgresReaderColumnPrivileges(
  client: RuntimeSqlClient,
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
  config: ResolvedPostgresRuntimeConfig,
): Promise<void> {
  const protectedTables = resolveProtectedPostgresTables(tables, metadata);
  const readableTables = postgresReaderReadableTableNames(tables, metadata, protectedTables);
  const authzPolicyDependencyTables = customAuthzPolicyDependencyTableNames(tables);
  for (const table of tables) {
    const tableConfig = getTableConfig(table);
    const secretColumns =
      metadata.secretColumnNamesByTable.get(tableConfig.name) ?? new Set<string>();
    const publicColumns = tableConfig.columns
      .map((column) => column.name)
      .filter((column) => !secretColumns.has(column));
    await client.exec(`REVOKE ALL ON TABLE ${quoteTable(tableConfig)} FROM PUBLIC`);
    await client.exec(
      `REVOKE ALL ON TABLE ${quoteTable(tableConfig)} FROM ${quoteIdent(config.readerRole)}`,
    );
    if (
      (readableTables.has(tableConfig.name) || authzPolicyDependencyTables.has(tableConfig.name)) &&
      publicColumns.length > 0
    ) {
      await client.exec(
        `GRANT SELECT (${publicColumns.map(quoteIdent).join(', ')}) ON TABLE ${quoteTable(
          tableConfig,
        )} TO ${quoteIdent(config.readerRole)}`,
      );
    }
  }
}

function postgresReaderReadableTableNames(
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
  protectedTables: ReadonlyMap<string, ProtectedPostgresTable>,
): ReadonlySet<string> {
  const readableTables = new Set<string>();
  for (const tableName of protectedTables.keys()) readableTables.add(tableName);
  const authzPolicyTables = new Set(customAuthzPolicyPredicatesByTable(tables).keys());
  for (const [tableName, classifications] of metadata.authorizationClassificationsByTable) {
    if (
      classifications.some(
        (classification) =>
          classification === 'public' ||
          classification === 'reference' ||
          (classification === 'authzPolicy' && !authzPolicyTables.has(tableName)),
      )
    ) {
      readableTables.add(tableName);
    }
  }
  return readableTables;
}

function postgresOwnerScopedTableNames(metadata: KovoRuntimeDbMetadata): readonly string[] {
  return [
    ...new Set([...metadata.ownerSourcesByTable.keys(), ...metadata.ownerViaSourcesByTable.keys()]),
  ];
}

async function applyPostgresWriterTablePrivileges(
  client: RuntimeSqlClient,
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
  config: ResolvedPostgresRuntimeConfig,
): Promise<void> {
  const protectedTables = resolveProtectedPostgresTables(tables, metadata);
  const writableTables = postgresWriterWritableTableNames(protectedTables);
  const authzPolicyDependencyTables = customAuthzPolicyDependencyTableNames(tables);
  for (const table of tables) {
    const tableConfig = getTableConfig(table);
    const secretColumns =
      metadata.secretColumnNamesByTable.get(tableConfig.name) ?? new Set<string>();
    const publicColumns = tableConfig.columns
      .map((column) => column.name)
      .filter((column) => !secretColumns.has(column));
    await client.exec(
      `REVOKE ALL ON TABLE ${quoteTable(tableConfig)} FROM ${quoteIdent(config.writerRole)}`,
    );
    if (writableTables.has(tableConfig.name)) {
      await client.exec(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${quoteTable(tableConfig)} TO ${quoteIdent(
          config.writerRole,
        )}`,
      );
    } else if (authzPolicyDependencyTables.has(tableConfig.name) && publicColumns.length > 0) {
      await client.exec(
        `GRANT SELECT (${publicColumns.map(quoteIdent).join(', ')}) ON TABLE ${quoteTable(
          tableConfig,
        )} TO ${quoteIdent(config.writerRole)}`,
      );
    }
  }
}

function postgresWriterWritableTableNames(
  protectedTables: ReadonlyMap<string, ProtectedPostgresTable>,
): ReadonlySet<string> {
  const writableTables = new Set<string>();
  for (const tableName of protectedTables.keys()) writableTables.add(tableName);
  return writableTables;
}

function postgresCrossOwnerReadableTableNames(
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
): ReadonlySet<string> {
  const readableTables = new Set<string>();
  for (const tableName of resolveProtectedPostgresTables(tables, metadata).keys()) {
    readableTables.add(tableName);
  }
  return readableTables;
}

function resolveProtectedPostgresTables(
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
): ReadonlyMap<string, ProtectedPostgresTable> {
  const tableNames = new Set(tables.map((table) => getTableConfig(table).name));
  const protectedTables = new Map<string, ProtectedPostgresTable>();
  for (const [tableName, owner] of metadata.ownerSourcesByTable) {
    if (!tableNames.has(tableName)) continue;
    protectedTables.set(tableName, {
      kind: 'owner',
      predicate: `${quoteIdent(owner.columnName)} = current_setting('kovo.principal', true)`,
      tableName,
    });
  }
  for (const [tableName, ownerVia] of metadata.ownerViaSourcesByTable) {
    if (!tableNames.has(tableName)) continue;
    const predicate = ownerPredicateForTable(metadata, ownerVia.parentTable, {
      parentKeyColumnName: ownerVia.parentKeyColumnName,
      parentMatchExpression: `${quoteIdent(tableName)}.${quoteIdent(ownerVia.fkColumnName)}`,
      visited: new Set([tableName]),
    });
    if (predicate === undefined) {
      throw new Error(
        `KV414: ownerVia table ${tableName} cannot resolve parent chain through ${ownerVia.parentTable} to an owner column (SPEC §10.3).`,
      );
    }
    protectedTables.set(tableName, {
      kind: 'ownerVia',
      predicate,
      tableName,
    });
  }
  for (const { predicate, tableName } of customAuthzPolicyPredicatesByTable(tables).values()) {
    protectedTables.set(tableName, {
      kind: 'authzPolicy',
      predicate,
      tableName,
    });
  }
  return protectedTables;
}

function ownerPredicateForTable(
  metadata: KovoRuntimeDbMetadata,
  tableName: string,
  input: {
    parentKeyColumnName: string;
    parentMatchExpression: string;
    visited: Set<string>;
  },
): string | undefined {
  if (input.visited.has(tableName)) return undefined;
  input.visited.add(tableName);
  const parentAlias = quoteIdent(`kovo_parent_${tableName}_${input.visited.size}`);
  const owner = metadata.ownerSourcesByTable.get(tableName);
  if (owner !== undefined) {
    return [
      'EXISTS (SELECT 1 FROM',
      `${quoteIdent(tableName)} ${parentAlias}`,
      'WHERE',
      `${parentAlias}.${quoteIdent(input.parentKeyColumnName)} = ${input.parentMatchExpression}`,
      'AND',
      `${parentAlias}.${quoteIdent(owner.columnName)} = current_setting('kovo.principal', true))`,
    ].join(' ');
  }
  const ownerVia = metadata.ownerViaSourcesByTable.get(tableName);
  if (ownerVia === undefined) return undefined;
  const nested = ownerPredicateForTable(metadata, ownerVia.parentTable, {
    parentKeyColumnName: ownerVia.parentKeyColumnName,
    parentMatchExpression: `${parentAlias}.${quoteIdent(ownerVia.fkColumnName)}`,
    visited: input.visited,
  });
  if (nested === undefined) return undefined;
  return [
    'EXISTS (SELECT 1 FROM',
    `${quoteIdent(tableName)} ${parentAlias}`,
    'WHERE',
    `${parentAlias}.${quoteIdent(input.parentKeyColumnName)} = ${input.parentMatchExpression}`,
    'AND',
    nested,
    ')',
  ].join(' ');
}

async function applyPostgresRlsPolicies(
  client: RuntimeSqlClient,
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
  config: ResolvedPostgresRuntimeConfig,
): Promise<void> {
  const protectedTables = resolveProtectedPostgresTables(tables, metadata);
  for (const protectedTable of protectedTables.values()) {
    const { predicate, tableName } = protectedTable;
    const table = quoteIdent(tableName);
    await client.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await client.exec(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    await client.exec(`DROP POLICY IF EXISTS kovo_owner_scope ON ${table}`);
    await client.exec(`DROP POLICY IF EXISTS kovo_authz_policy ON ${table}`);
    await client.exec(`DROP POLICY IF EXISTS kovo_system_scope ON ${table}`);
    await client.exec(
      [
        `CREATE POLICY ${
          protectedTable.kind === 'authzPolicy' ? 'kovo_authz_policy' : 'kovo_owner_scope'
        } ON ${table}`,
        `FOR ALL TO ${quoteIdent(config.readerRole)}, ${quoteIdent(config.writerRole)}`,
        `USING (${predicate}) WITH CHECK (${predicate})`,
      ].join(' '),
    );
    await client.exec(
      [
        `CREATE POLICY kovo_system_scope ON ${table}`,
        `FOR ALL TO ${quoteIdent(config.readerRole)}, ${quoteIdent(config.writerRole)}`,
        "USING (current_setting('kovo.role', true) = 'system')",
        "WITH CHECK (current_setting('kovo.role', true) = 'system')",
      ].join(' '),
    );
  }
  for (const tableObject of tables) {
    const tableConfig = getTableConfig(tableObject);
    const table = quoteTable(tableConfig);
    await client.exec(`DROP POLICY IF EXISTS kovo_admin_scope ON ${table}`);
    if (!config.crossOwnerReadTables.has(tableConfig.name)) continue;
    if (!postgresCrossOwnerReadableTableNames(tables, metadata).has(tableConfig.name)) {
      throw new Error(
        `KV414: crossOwnerRead table ${tableConfig.name} must be owner, ownerVia, or custom authzPolicy scoped (SPEC §10.3).`,
      );
    }
    await client.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await client.exec(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    await client.exec(
      [
        `CREATE POLICY kovo_admin_scope ON ${table}`,
        `FOR SELECT TO ${quoteIdent(config.readerRole)}`,
        "USING (current_setting('kovo.role', true) = 'admin')",
      ].join(' '),
    );
  }
}

function customAuthzPolicyPredicatesByTable(
  tables: readonly PgTable[],
): ReadonlyMap<string, AuthzPolicyPredicate> {
  const predicates = new Map<string, AuthzPolicyPredicate>();
  for (const table of tables) {
    const tableName = getTableConfig(table).name;
    const authzPolicy = kovoDomainAnnotation(table)?.authzPolicy;
    if (authzPolicy === undefined || typeof authzPolicy === 'string') continue;
    if (!isDrizzleSqlLike(authzPolicy)) {
      throw unsupportedAuthzPolicyError(
        tableName,
        'expected authzPolicy to be a Drizzle sql`...` predicate or a string justification',
      );
    }
    predicates.set(tableName, {
      dependencyTableNames: authzPolicyUsedTableNames(authzPolicy).filter(
        (dependency) => dependency !== tableName,
      ),
      predicate: renderCustomAuthzPolicyPredicate(tableName, authzPolicy),
      tableName,
    });
  }
  return predicates;
}

function renderCustomAuthzPolicyPredicate(tableName: string, authzPolicy: unknown): string {
  if (!isDrizzleSqlLike(authzPolicy)) {
    throw unsupportedAuthzPolicyError(
      tableName,
      'expected authzPolicy to be a Drizzle sql`...` predicate or a string justification',
    );
  }
  let query: { params?: unknown[]; sql?: unknown };
  try {
    query = POSTGRES_POLICY_DIALECT.sqlToQuery(authzPolicy as SQL);
  } catch (cause) {
    const reason =
      cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'unknown error';
    throw unsupportedAuthzPolicyError(tableName, `could not render predicate SQL: ${reason}`);
  }
  const params = query.params ?? [];
  if (params.length > 0) {
    throw unsupportedAuthzPolicyError(
      tableName,
      'predicate SQL must not contain bound parameters; inline only reviewed literal SQL chunks',
    );
  }
  if (typeof query.sql !== 'string' || query.sql.trim() === '') {
    throw unsupportedAuthzPolicyError(tableName, 'predicate SQL rendered to an empty statement');
  }
  return query.sql.trim();
}

function customAuthzPolicyDependencyTableNames(tables: readonly PgTable[]): ReadonlySet<string> {
  const dependencyTableNames = new Set<string>();
  for (const { dependencyTableNames: dependencies } of customAuthzPolicyPredicatesByTable(
    tables,
  ).values()) {
    for (const dependency of dependencies) dependencyTableNames.add(dependency);
  }
  return dependencyTableNames;
}

function postgresReachabilityAllowlist(
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
): ReadonlySet<string> {
  const allowlisted = new Set<string>();
  const protectedAuthzPolicyTables = new Set(customAuthzPolicyPredicatesByTable(tables).keys());
  for (const [tableName, classifications] of metadata.authorizationClassificationsByTable) {
    if (
      classifications.some(
        (classification) =>
          classification === 'public' ||
          classification === 'reference' ||
          (classification === 'authzPolicy' && !protectedAuthzPolicyTables.has(tableName)),
      )
    ) {
      allowlisted.add(tableName);
    }
  }
  for (const tableName of customAuthzPolicyDependencyTableNames(tables)) {
    allowlisted.add(tableName);
  }
  return allowlisted;
}

async function postgresCatalogRelation(
  client: RuntimeSqlClient,
  schema: string,
  table: string,
): Promise<PostgresCatalogRelation | undefined> {
  const result = await safeQuery<PostgresCatalogRelation>(
    client,
    [
      'SELECT n.nspname AS schema_name, c.relname AS table_name, c.relkind,',
      'c.relrowsecurity, c.relforcerowsecurity, c.reloptions',
      'FROM pg_class c',
      'JOIN pg_namespace n ON n.oid = c.relnamespace',
      'WHERE n.nspname = $1 AND c.relname = $2',
    ].join(' '),
    [schema, table],
  );
  return result?.rows[0];
}

async function postgresHasLiveKovoPolicy(
  client: RuntimeSqlClient,
  table: string,
): Promise<boolean> {
  const result = await safeQuery(
    client,
    [
      'SELECT 1 FROM pg_policies',
      'WHERE tablename = $1',
      "AND policyname IN ('kovo_owner_scope', 'kovo_authz_policy', 'kovo_admin_scope')",
    ].join(' '),
    [table],
  );
  return (result?.rows.length ?? 0) > 0;
}

async function postgresBaseTableHasProtectedPosture(
  client: RuntimeSqlClient,
  relation: PostgresViewDependency,
): Promise<boolean> {
  const catalog = await postgresCatalogRelation(client, relation.table_schema, relation.table_name);
  if (
    catalog === undefined ||
    (catalog.relkind !== 'r' && catalog.relkind !== 'p') ||
    catalog.relrowsecurity !== true ||
    catalog.relforcerowsecurity !== true
  ) {
    return false;
  }
  return postgresHasLiveKovoPolicy(client, relation.table_name);
}

function postgresViewIsSecurityInvoker(relation: PostgresCatalogRelation): boolean {
  return (relation.reloptions ?? []).some((option) => option === 'security_invoker=true');
}

async function postgresViewDependencies(
  client: RuntimeSqlClient,
  schema: string,
  table: string,
): Promise<readonly PostgresViewDependency[]> {
  const usage = await safeQuery<PostgresViewDependency>(
    client,
    [
      'SELECT table_schema, table_name',
      'FROM information_schema.view_table_usage',
      'WHERE view_schema = $1 AND view_name = $2',
      'ORDER BY table_schema, table_name',
    ].join(' '),
    [schema, table],
  );
  return usage?.rows ?? [];
}

function authzPolicyUsedTableNames(authzPolicy: DrizzleSqlLike): string[] {
  return Array.isArray(authzPolicy.usedTables)
    ? authzPolicy.usedTables.filter(
        (tableName): tableName is string => typeof tableName === 'string',
      )
    : [];
}

function isDrizzleSqlLike(value: unknown): value is DrizzleSqlLike {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    Array.isArray((value as DrizzleSqlLike).queryChunks) &&
    typeof (value as DrizzleSqlLike).toQuery === 'function'
  );
}

function unsupportedAuthzPolicyError(tableName: string, detail: string): Error {
  return new Error(
    `KV433_AUTHZ_POLICY_UNSUPPORTED: Postgres authzPolicy for ${tableName} must be a conservative no-parameter SQL predicate; ${detail} (SPEC §10.3).`,
  );
}

function kovoDomainAnnotation(table: PgTable): KovoDomainAnnotation | undefined {
  for (const value of [
    ...Object.values(table as unknown as Record<string, unknown>),
    ...Object.getOwnPropertySymbols(table).map((symbol) => Reflect.get(table as object, symbol)),
  ]) {
    if (
      value !== null &&
      (typeof value === 'object' || typeof value === 'function') &&
      'domain' in value
    ) {
      return value as KovoDomainAnnotation;
    }
  }
  return undefined;
}

async function persistSchemaFingerprint(
  client: RuntimeSqlClient,
  fingerprint: string,
): Promise<void> {
  await client.exec(
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(SCHEMA_STATE_TABLE)} (key text PRIMARY KEY, value text NOT NULL, updated_at timestamp NOT NULL DEFAULT now())`,
  );
  await client.query(
    [
      `INSERT INTO ${quoteIdent(SCHEMA_STATE_TABLE)} (key, value) VALUES ($1, $2)`,
      'ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()',
    ].join(' '),
    ['fingerprint', fingerprint],
  );
}

function schemaFingerprint(tables: readonly PgTable[], metadata: KovoRuntimeDbMetadata): string {
  const shape = tables.map((table) => {
    const config = getTableConfig(table);
    return {
      columns: config.columns.map((column) => ({
        default: column.hasDefault ? stableFingerprintValue(column.default) : '',
        name: column.name,
        notNull: column.notNull,
        primary: column.primary,
        type: column.columnType,
        unique: column.isUnique,
      })),
      foreignKeys: config.foreignKeys.map((foreignKey) => {
        const reference = foreignKey.reference();
        return {
          columns: reference.columns.map((column) => column.name),
          foreignColumns: reference.foreignColumns.map((column) => column.name),
          foreignTable: getTableConfig(reference.foreignTable).name,
          onDelete: foreignKey.onDelete,
          onUpdate: foreignKey.onUpdate,
        };
      }),
      name: config.name,
      schema: (config as { schema?: unknown }).schema,
    };
  });
  const authzPolicyPredicates = [...customAuthzPolicyPredicatesByTable(tables).values()].map(
    ({ predicate, tableName }) => [tableName, predicate],
  );
  return createHash('sha256')
    .update(
      JSON.stringify({
        authorization: [...metadata.authorizationClassificationsByTable.entries()],
        authzPolicyPredicates,
        owner: [...metadata.ownerSourcesByTable.entries()],
        ownerVia: [...metadata.ownerViaSourcesByTable.entries()],
        secret: [...metadata.secretColumnNamesByTable.entries()].map(([table, columns]) => [
          table,
          [...columns].sort(),
        ]),
        shape,
      }),
    )
    .digest('hex');
}

function stableFingerprintValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

async function safeQuery<Row extends QueryResultRow>(
  client: RuntimeSqlClient,
  query: string,
  params?: readonly unknown[],
): Promise<{ rows: Row[] } | undefined> {
  try {
    return await client.query<Row>(query, params === undefined ? undefined : [...params]);
  } catch {
    return undefined;
  }
}

function pgTablePolicyNames(table: unknown): string[] {
  try {
    const config = getTableConfig(table as PgTable);
    const schema = (config as { schema?: unknown }).schema;
    const schemaName = typeof schema === 'string' ? schema : undefined;
    const names = [config.name, normalizePolicyTable(config.name)];
    if (schemaName !== undefined) names.push(`${schemaName}.${config.name}`);
    return [...new Set(names)];
  } catch {
    throw new Error(
      'KV406: Postgres declared-write fallback could not resolve a Drizzle write table (SPEC §10.3/§11.2).',
    );
  }
}

function normalizePolicyTable(table: string): string {
  return table.includes('.') ? table : `public.${table}`;
}

function tableSchemaName(config: PgTableConfig): string {
  const schema = (config as { schema?: unknown }).schema;
  return typeof schema === 'string' && schema !== '' ? schema : 'public';
}

function postgresScopedClientOptions(
  config: ResolvedPostgresRuntimeConfig,
  principal: string | undefined,
  roleSetting?: string,
): PostgresScopedClientOptions {
  const options: PostgresScopedClientOptions = { role: config.writerRole };
  if (principal !== undefined) options.principal = principal;
  if (roleSetting !== undefined) options.roleSetting = roleSetting;
  return options;
}

function postgresReadonlyClientOptions(
  config: ResolvedPostgresRuntimeConfig,
  principal: string | undefined,
  role: string | false,
  roleSetting?: string,
): PostgresReadonlyClientOptions {
  const options: PostgresReadonlyClientOptions = {
    readerRole: role,
  };
  if (principal !== undefined) options.principal = principal;
  if (roleSetting !== undefined) options.roleSetting = roleSetting;
  return options;
}

function principalFromRequest(request: unknown): string | undefined {
  const nonRequestPrincipal = nonRequestPrincipalPostureFromRequest(request);
  if (nonRequestPrincipal !== undefined) return nonRequestPrincipal;
  const userId = (request as { session?: { user?: { id?: unknown } } } | undefined)?.session?.user
    ?.id;
  return typeof userId === 'string' && userId !== '' ? userId : undefined;
}

function postgresRequestScope(
  request: unknown,
  config: ResolvedPostgresRuntimeConfig,
): PostgresRequestScope {
  const posture = nonRequestPrincipalPostureObject(request);
  if (posture !== undefined && posture.kind === 'system') {
    assertNonRequestPrincipalPosture(posture);
    return { roleSetting: 'system' };
  }
  const principal = config.principalFromRequest(request);
  return principal === undefined ? {} : { principal };
}

function nonRequestPrincipalPostureFromRequest(request: unknown): string | undefined {
  const posture = nonRequestPrincipalPostureObject(request);
  if (posture === undefined) return undefined;
  if (posture.kind === 'system') {
    assertNonRequestPrincipalPosture(posture);
    return undefined;
  }
  const principal = (posture as { principal?: unknown }).principal;
  return posture.kind === 'act-as' &&
    typeof principal === 'string' &&
    principal.trim() === principal
    ? principal
    : undefined;
}

function nonRequestPrincipalPostureObject(
  request: unknown,
): NonRequestPrincipalPosture | undefined {
  if ((typeof request !== 'object' && typeof request !== 'function') || request === null) {
    return undefined;
  }
  const posture = (request as { principalPosture?: unknown }).principalPosture;
  if ((typeof posture !== 'object' && typeof posture !== 'function') || posture === null) {
    return undefined;
  }
  return posture as NonRequestPrincipalPosture;
}

function quoteTable(config: PgTableConfig): string {
  const schema = (config as { schema?: unknown }).schema;
  return typeof schema === 'string' && schema !== ''
    ? `${quoteIdent(schema)}.${quoteIdent(config.name)}`
    : quoteIdent(config.name);
}

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
