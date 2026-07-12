import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

import { PGlite } from '@electric-sql/pglite';
import { createBoundedRuntimeAuditCollector } from '@kovojs/core/internal/security-markers';
import { extractKovoRuntimeDbMetadata, type KovoRuntimeDbMetadata } from '@kovojs/drizzle';
import { buildRelations, type AnyRelations, type SQL } from 'drizzle-orm';
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { Pool, type PoolClient, type PoolConfig, type QueryConfig, type QueryResultRow } from 'pg';

import {
  declareSystemPrincipal,
  principalFromNonRequestPrincipalPosture,
  type NonRequestPrincipalPosture,
} from './auth-principal.js';
import { registerEgressDatabaseUrl } from './egress-bootstrap.js';
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
import { ensureRecurringTaskSchema } from './task-cron.js';
import {
  createDurableTaskSqlExecutor,
  ensureDurableTaskSchema,
  grantDurableTaskWriterRole,
} from './task-queue.js';

const DEFAULT_DATA_DIR = '.kovo/pglite';
const DEFAULT_ADMIN_ROLE = 'kovo_admin';
const DEFAULT_READER_ROLE = 'kovo_reader';
const DEFAULT_SYSTEM_ROLE = 'kovo_system';
const DEFAULT_WRITER_ROLE = 'kovo_writer';
const MIGRATIONS_TABLE = 'kovo_migrations';
const SCHEMA_STATE_TABLE = 'kovo_schema_state';
const postgresSystemDbBrand: unique symbol = Symbol('kovo.postgres-system-db');
const postgresSystemDbValues = new WeakMap<KovoPostgresSystemDb, KovoPostgresRuntimeDb>();
const FRAMEWORK_INTERNAL_REACHABLE_TABLES = new Set([
  '_kovo_jobs',
  '_kovo_task_cron_occurrences',
  SCHEMA_STATE_TABLE,
]);
const POSTGRES_ELEVATED_ROLE_ATTRIBUTES = [
  { column: 'rolsuper', label: 'SUPERUSER' },
  { column: 'rolbypassrls', label: 'BYPASSRLS' },
  { column: 'rolreplication', label: 'REPLICATION' },
  { column: 'rolcreaterole', label: 'CREATEROLE' },
  { column: 'rolcreatedb', label: 'CREATEDB' },
] as const;
// SPEC §10.3 (C10/C11): the runtime-identity escalation surface is role ATTRIBUTES ∪
// predefined-role MEMBERSHIP. Membership in a PostgreSQL predefined role (`pg_*`, e.g.
// `pg_execute_server_program` ⇒ COPY … FROM PROGRAM OS command execution,
// `pg_read_all_data`/`pg_write_all_data`, server-file read/write, `pg_monitor`, `pg_maintain`)
// grants capabilities that carry NONE of the five elevated attribute booleans, so the
// attribute allowlist alone lets that membership pass unflagged. We therefore range an ALLOWLIST
// over predefined-role membership across the SAME `{login} ∪ {assumable-role closure}` DEC-B/DEC-C
// audit: the login and every assumable role may be a member of only the framework's own roles plus
// this explicit benign don't-care set. Any other `pg_*` predefined-role membership fails closed and
// is named. This is an ALLOWLIST (member-of-only-known-safe), NOT a denylist of known-bad roles, so
// a NEW `pg_*` predefined role in a future PostgreSQL release fails closed by default.
const POSTGRES_BENIGN_PREDEFINED_ROLES: ReadonlySet<string> = new Set<string>([]);
const POSTGRES_CLASSIFIED_ROLE_COLUMNS = new Set([
  'rolname',
  'rolsuper',
  'rolinherit',
  'rolcreaterole',
  'rolcreatedb',
  'rolcanlogin',
  'rolreplication',
  'rolconnlimit',
  'rolpassword',
  'rolvaliduntil',
  'rolbypassrls',
  'rolconfig',
]);
const POSTGRES_SECURITY_SEARCH_PATH_SQL = 'SET LOCAL search_path = pg_catalog, public, pg_temp';
// Keep pg_catalog implicit so PostgreSQL searches it before the app schema while still making
// `public` the creation target for unqualified app DDL. Listing pg_catalog after public would let a
// role with pre-provisioning CREATE authority shadow built-ins invoked by reviewed migrations or
// seed SQL and run its function with the provisioner's authority (SPEC §10.3 C9/C10).
const POSTGRES_APP_DDL_SEARCH_PATH_SQL = 'SET LOCAL search_path = public, pg_temp';
const POSTGRES_REACHABLE_RELATIONS_SQL = [
  'WITH app_roles(role_name) AS (VALUES ($1), ($2), ($3), ($4)),',
  'existing_roles AS (',
  '  SELECT DISTINCT r.oid, r.rolname',
  '  FROM pg_roles r',
  '  JOIN app_roles a ON a.role_name = r.rolname',
  ')',
  'SELECT n.nspname AS schema_name, c.relname AS table_name, c.relkind,',
  'c.relrowsecurity, c.relforcerowsecurity, c.reloptions,',
  'r.rolname AS role_name,',
  "CASE WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f') THEN has_table_privilege(r.oid, c.oid, 'SELECT') ELSE false END AS can_select,",
  "CASE WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f') THEN has_table_privilege(r.oid, c.oid, 'INSERT') ELSE false END AS can_insert,",
  "CASE WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f') THEN has_table_privilege(r.oid, c.oid, 'UPDATE') ELSE false END AS can_update,",
  "CASE WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f') THEN has_table_privilege(r.oid, c.oid, 'DELETE') ELSE false END AS can_delete,",
  "CASE WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f') THEN EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege(r.oid, c.oid, a.attname, 'SELECT')) ELSE false END AS can_select_column,",
  "CASE WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f') THEN EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege(r.oid, c.oid, a.attname, 'INSERT')) ELSE false END AS can_insert_column,",
  "CASE WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f') THEN EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege(r.oid, c.oid, a.attname, 'UPDATE')) ELSE false END AS can_update_column,",
  "CASE WHEN c.relkind = 'S' THEN has_sequence_privilege(r.oid, c.oid, 'USAGE') ELSE false END AS can_use_sequence,",
  "CASE WHEN c.relkind = 'S' THEN has_sequence_privilege(r.oid, c.oid, 'SELECT') ELSE false END AS can_select_sequence,",
  "CASE WHEN c.relkind = 'S' THEN has_sequence_privilege(r.oid, c.oid, 'UPDATE') ELSE false END AS can_update_sequence",
  'FROM pg_class c',
  'JOIN pg_namespace n ON n.oid = c.relnamespace',
  'JOIN existing_roles r ON true',
  "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')",
  'ORDER BY n.nspname, c.relname, r.rolname',
].join(' ');
const PRODUCTION_PGLITE_ERROR =
  'production requires a least-privilege external Postgres via KOVO_DATABASE_URL; PGlite is dev/test-only and runs in-process as superuser';
const RUNTIME_LEAST_PRIVILEGE_ERROR = 'runtime must be a least-privilege login role';
const internalPostgresRuntimeDbCapability: unique symbol = Symbol(
  'kovo.postgres-runtime.internal-db',
);
const publicPostgresRelationBrand: unique symbol = Symbol('kovo.postgres-public-relation');

type PgTableConfig = ReturnType<typeof getTableConfig>;
type PgTable = Parameters<typeof getTableConfig>[0];
type PgColumn = PgTableConfig['columns'][number];
type PgForeignKey = PgTableConfig['foreignKeys'][number];

const POSTGRES_POLICY_DIALECT = new PgDialect();
const postgresRuntimeRequire = createRequire(import.meta.url);
let postgresPolicySqlParser: typeof import('pgsql-ast-parser') | undefined;

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
  schemaName: string;
  tableName: string;
}

interface PostgresPolicyRow {
  cmd: string;
  permissive: string;
  policyname: string;
  qual: string | null;
  roles: string[];
  schemaname: string;
  tablename: string;
  with_check: string | null;
}

interface ExpectedPostgresPolicy {
  cmd: 'ALL' | 'SELECT';
  issueCode: string;
  name: string;
  permissive: 'PERMISSIVE';
  qual: string;
  roles: readonly string[];
  withCheck: string | null;
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

interface PostgresReachableRelationRow extends PostgresCatalogRelation {
  can_delete: boolean;
  can_insert: boolean;
  can_insert_column: boolean;
  can_select: boolean;
  can_select_column: boolean;
  can_select_sequence: boolean;
  can_update: boolean;
  can_update_column: boolean;
  can_update_sequence: boolean;
  can_use_sequence: boolean;
  role_name: string;
}

interface PostgresReachableRelation extends PostgresCatalogRelation {
  privileges: readonly string[];
  roles: readonly string[];
  schema: string;
  table: string;
}

interface PostgresRoleAttributeRow {
  rolbypassrls: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolname: string;
  rolreplication: boolean;
  rolsuper: boolean;
}

interface PostgresRoleClosureRow extends PostgresRoleAttributeRow {
  is_predefined: boolean;
}

interface PostgresAdminOptionRow {
  member_role: string;
  role_name: string;
}

interface PostgresReachableRoutineRow {
  role_name: string;
  routine_name: string;
  routine_schema: string;
}

interface PostgresReachableSequenceRow {
  sequence_name: string;
  sequence_schema: string;
  table_name: string;
  table_schema: string;
}

interface PostgresAttachedCodeRow {
  mechanism: string;
  relation_name: string;
  relation_schema: string;
  routine_name: string;
  routine_schema: string;
}

interface PostgresWritePropagationClosureRow {
  relation_name: string;
  relation_schema: string;
}

interface PostgresUnexpectedPrivilegeRow {
  object_kind: string;
  object_name: string;
  privilege_type: string;
  role_name: string;
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
  adminDatabaseUrl?: string;
  crossOwnerReadTables: ReadonlySet<string>;
  dataDir: string;
  databaseUrl?: string;
  driver: KovoPostgresResolvedRuntimeDriver;
  postureCheckOnBoot: boolean;
  postureCheckOptOut?: PostgresPostureCheckOptOut;
  principalFromRequest: (request: unknown) => string | undefined;
  provisionOnBoot: boolean;
  publicRelations: ReadonlyMap<string, KovoPostgresPublicRelationDeclaration>;
  readerRole: string;
  roleTopology: PostgresRoleTopology;
  schema: Record<string, unknown>;
  seedSql: readonly string[];
  systemDatabaseUrl?: string;
  systemRole: string;
  writerRole: string;
}

type PostgresRolePurpose = 'admin' | 'reader' | 'system' | 'writer';
type PostgresRoleManagement = 'adopt' | 'create';
type PostgresMembershipEdgeOwner = 'dba' | 'kovo';

interface PostgresRoleTopologyRole {
  management: PostgresRoleManagement;
  name: string;
  purpose: PostgresRolePurpose;
}

interface PostgresRoleMembershipEdge {
  memberRole: string;
  owner: PostgresMembershipEdgeOwner;
  role: string;
}

interface PostgresRoleTopology {
  membershipEdges: readonly PostgresRoleMembershipEdge[];
  roles: {
    admin: PostgresRoleTopologyRole;
    reader: PostgresRoleTopologyRole;
    system: PostgresRoleTopologyRole;
    writer: PostgresRoleTopologyRole;
  };
}

interface PostgresRuntimeConfigInput extends KovoPostgresAppRuntimeOptions {
  /** Internal framework override for CLI/check/provision paths. Public apps use `postureCheck`. */
  postureCheckOnBoot?: boolean;
}

interface PostgresPostureCheckOptOut {
  justification: string;
  site?: string;
}

/** Internal audit fact for `kovo explain --capabilities` posture-check opt-outs. */
export interface PostgresPostureCheckOptOutFact {
  readonly driver: KovoPostgresResolvedRuntimeDriver;
  readonly justification: string;
  readonly site?: string;
}

const postgresPostureCheckOptOutFacts =
  createBoundedRuntimeAuditCollector<PostgresPostureCheckOptOutFact>();

interface CreatedRuntimeClient {
  close(): Promise<void>;
  drizzleInternalDb(capability: typeof internalPostgresRuntimeDbCapability): KovoPostgresRuntimeDb;
  drizzleReadonlyDb(
    principal: string | undefined,
    role: string | false,
    roleSetting?: string,
  ): KovoPostgresRuntimeDb;
  drizzleRequestDb(principal: string | undefined, roleSetting?: string): KovoPostgresRuntimeDb;
  readonlySql(
    principal: string | undefined,
    role: string | false,
    roleSetting?: string,
  ): RuntimeSqlClient;
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
  /**
   * Framework-owned external Postgres URL used only for audited `crossOwnerRead(...)` calls. The
   * login must be the configured `adminRole` or be able to `SET ROLE` to it; the ordinary app
   * runtime login must not be a member of that role (SPEC §10.3).
   */
  adminDatabaseUrl?: string;
  /**
   * Framework-owned external Postgres URL used only for audited system work. The login must be the
   * configured system role or be able to `SET ROLE` to it; the ordinary app runtime login must not
   * be a member of that role (SPEC §10.3).
   */
  systemDatabaseUrl?: string;
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
   *
   * Disabling the boot check is an audited capability escape: use
   * `postureCheck: { onBoot: false, justification: '...' }`, which is recorded for
   * `kovo explain --capabilities`. Bare booleans are intentionally not accepted.
   */
  postureCheck?:
    | { readonly onBoot?: true }
    | { readonly justification: string; readonly onBoot: false; readonly site?: string };
  principalFromRequest?: (request: unknown) => string | undefined;
  readerRole?: string;
  /**
   * Role used by audited `crossOwnerRead(...)` calls. Defaults to `KOVO_DB_ADMIN_ROLE` or
   * `kovo_admin`; only used when `crossOwnerReadTables` is non-empty.
   */
  adminRole?: string;
  /**
   * Role used by audited system work. Defaults to `KOVO_DB_SYSTEM_ROLE` or `kovo_system`.
   * Supplying this option adopts a pre-created role instead of creating Kovo's default.
   */
  systemRole?: string;
  /** Physical owner/authz table names that should receive the per-table `kovo_admin_scope` policy. */
  crossOwnerReadTables?: readonly string[];
  /**
   * Reviewed database relations intentionally exposed as public read surfaces even though they
   * cannot prove Kovo row-level security, such as reporting materialized views (SPEC §10.3).
   * Use {@link declarePublicRelation}; plain objects are intentionally not accepted.
   */
  publicRelations?: readonly KovoPostgresPublicRelationDeclaration[];
  seedSql?: string | readonly string[];
  writerRole?: string;
}

/** Options accepted by {@link declarePublicRelation}. */
export interface KovoPostgresPublicRelationDeclarationOptions {
  /** Relation name, either `table_or_view_name` in `public` or `schema.table_or_view_name`. */
  relation: string;
  /** Required audit reason explaining why this relation is safe to expose publicly. */
  reason: string;
  /** Optional source span or config-site label surfaced in capability ledgers. */
  site?: string;
}

/**
 * Declare a vetted public Postgres relation for the boot-time closure audit (SPEC §10.3).
 *
 * The declaration is the only supported escape for reachable relations that cannot carry Kovo RLS,
 * such as materialized views. Base tables must use ordinary schema classifications (`public`,
 * `reference`, `owner`, `ownerVia`, or `authzPolicy`) instead.
 */
export interface KovoPostgresPublicRelationDeclaration extends KovoPostgresPublicRelationDeclarationOptions {
  /** Module-private witness so app config normally routes through declarePublicRelation(...). */
  readonly [publicPostgresRelationBrand]: {
    readonly scope: 'postgres-public-relation';
  };
}

/**
 * Construct a reviewed public relation declaration for `createPostgresAppRuntimeDb({ publicRelations })`.
 */
export function declarePublicRelation(
  options: KovoPostgresPublicRelationDeclarationOptions,
): KovoPostgresPublicRelationDeclaration {
  const normalized = normalizedPublicRelationDeclaration(options);
  const declaration = {
    [publicPostgresRelationBrand]: { scope: 'postgres-public-relation' as const },
    relation: normalized.relation,
    reason: normalized.reason,
    ...(normalized.site === undefined ? {} : { site: normalized.site }),
  };
  return Object.freeze(declaration);
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
  /** Framework-owned non-request DB capability for generated auth/seed wiring, still RLS-subject. */
  systemDb(options: {
    operation: 'read' | 'write';
    reason: string;
    surface: string;
  }): KovoPostgresSystemDb;
  close(): Promise<void>;
}

/** Opaque framework-owned system DB capability; consume through `usePostgresSystemDb(...)`. */
export interface KovoPostgresSystemDb {
  readonly [postgresSystemDbBrand]: {
    readonly scope: 'postgres-system-db';
  };
}

/**
 * Consume a framework-owned Postgres system DB capability at a narrow generated/internal sink.
 *
 * SPEC §10.3: the raw system DB remains non-structural and is not returned as an app value.
 */
export function usePostgresSystemDb<Result>(
  capability: KovoPostgresSystemDb,
  use: (db: KovoPostgresRuntimeDb) => Result,
): Result {
  const db = postgresSystemDbValues.get(capability);
  if (db === undefined) {
    throw new Error(
      'KV414: invalid Postgres system DB capability; use createPostgresAppRuntimeDb().systemDb(...) (SPEC §10.3).',
    );
  }
  return use(db);
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
  /** Least-privilege runtime URL whose login role receives app-role membership. */
  runtimeDatabaseUrl?: string;
}

/** Migration runner options for embedded PGlite or external Postgres. */
export interface KovoPostgresMigrateOptions extends KovoPostgresAppRuntimeOptions {
  /** Reviewed SQL migrations to apply before Kovo reasserts RLS policies/grants. */
  migrations: readonly KovoPostgresMigration[];
  /** Least-privilege runtime URL whose login role receives app-role membership. */
  runtimeDatabaseUrl?: string;
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
  ok: boolean;
  issues: readonly KovoPostgresPostureIssue[];
  roleTopology: {
    adminRole: {
      management: 'adopt' | 'create';
      name: string;
      purpose: 'admin' | 'reader' | 'system' | 'writer';
    };
    membershipEdges: readonly {
      memberRole: string;
      owner: 'dba' | 'kovo';
      role: string;
      status: 'expected' | 'granted' | 'missing' | 'verified';
    }[];
    readerRole: {
      management: 'adopt' | 'create';
      name: string;
      purpose: 'admin' | 'reader' | 'system' | 'writer';
    };
    runtimeLogin?: string;
    systemRole: {
      management: 'adopt' | 'create';
      name: string;
      purpose: 'admin' | 'reader' | 'system' | 'writer';
    };
    writerRole: {
      management: 'adopt' | 'create';
      name: string;
      purpose: 'admin' | 'reader' | 'system' | 'writer';
    };
  };
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
  assertProductionRuntimeDriver(config);
  const schemaTables = sortTablesByForeignKeyDependencies(postgresTablesFromSchema(config.schema));
  assertPostgresRuntimeSchemaSupported(schemaTables);
  const metadata = extractKovoRuntimeDbMetadata(schemaTables);
  const ddl = schemaDdl(schemaTables);
  const client = createRuntimeClient(config);
  const ready = initializeRuntimeDb(client.sql, {
    config,
    metadata,
    schemaDdl: ddl,
    schemaTables,
  });

  const dbForRequest = (request?: unknown): KovoPostgresRuntimeDb => {
    const scope = postgresRequestScope(request, config);
    return createRequestScopedDb(
      client.drizzleRequestDb(scope.principal, scope.roleSetting),
      client,
      config,
      metadata,
      scope,
      request,
    );
  };

  return {
    db: dbForRequest,
    readonlyDb: createRequestScopedReadonlyDb(client, config, metadata),
    ready,
    systemDb(options) {
      return createPostgresSystemDb(
        dbForRequest({
          principalPosture: declareSystemPrincipal(options.reason, {
            ingress: 'endpoint',
            operation: options.operation,
            surface: options.surface,
          }),
        }),
      );
    },
    close: () => client.close(),
  };
}

function createPostgresSystemDb(db: KovoPostgresRuntimeDb): KovoPostgresSystemDb {
  const capability = Object.freeze({
    [postgresSystemDbBrand]: { scope: 'postgres-system-db' as const },
  });
  postgresSystemDbValues.set(capability, db);
  return capability;
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
  assertPostgresRuntimeSchemaSupported(schemaTables);
  const metadata = extractKovoRuntimeDbMetadata(schemaTables);
  const client = createRuntimeClient(config);
  try {
    await provisionRuntimeDb(client.sql, {
      applySchemaDdl: false,
      config,
      metadata,
      migrations: options.migrations ?? [],
      runtimeLoginRole: runtimeLoginRoleFromDatabaseUrl(options.runtimeDatabaseUrl),
      schemaDdl: schemaDdl(schemaTables),
      schemaTables,
    });
    const runtimeLoginRole = runtimeLoginRoleFromDatabaseUrl(options.runtimeDatabaseUrl);
    return await checkRuntimeDbPosture(client.sql, {
      config,
      metadata,
      ...(runtimeLoginRole === undefined ? {} : { runtimeLoginRole }),
      schemaTables,
    });
  } finally {
    await client.close();
  }
}

/**
 * Apply reviewed table-structure migrations, then re-derive and re-assert framework-owned
 * Postgres RLS policies and grants (SPEC §10.3).
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
  assertPostgresRuntimeSchemaSupported(schemaTables);
  const metadata = extractKovoRuntimeDbMetadata(schemaTables);
  const client = createRuntimeClient(config);
  try {
    const migrations = await provisionRuntimeDb(client.sql, {
      applySchemaDdl: false,
      config,
      metadata,
      migrations: options.migrations,
      runtimeLoginRole: runtimeLoginRoleFromDatabaseUrl(options.runtimeDatabaseUrl),
      schemaDdl: schemaDdl(schemaTables),
      schemaTables,
    });
    const runtimeLoginRole = runtimeLoginRoleFromDatabaseUrl(options.runtimeDatabaseUrl);
    const posture = await checkRuntimeDbPosture(client.sql, {
      config,
      metadata,
      ...(runtimeLoginRole === undefined ? {} : { runtimeLoginRole }),
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
  assertPostgresRuntimeSchemaSupported(schemaTables);
  const client = createRuntimeClient(config);
  try {
    return await planRuntimeDbMigration(client.sql, schemaTables, config.driver);
  } finally {
    await client.close();
  }
}

/**
 * Check that an existing external Postgres database has the owner/RLS posture Kovo expects.
 * This is the boot-time fail-closed check for managed Postgres.
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
  assertPostgresRuntimeSchemaSupported(schemaTables);
  const metadata = extractKovoRuntimeDbMetadata(schemaTables);
  const client = createRuntimeClient(config);
  try {
    const runtimeLoginRole = runtimeLoginRoleFromDatabaseUrl(config.databaseUrl);
    return await checkRuntimeDbPosture(client.sql, {
      checkConnectionLeastPrivilege: config.driver === 'node-postgres',
      config,
      metadata,
      ...(runtimeLoginRole === undefined ? {} : { runtimeLoginRole }),
      schemaTables,
    });
  } finally {
    await client.close();
  }
}

/** Drain the newest 256 audited Postgres boot-posture-check opt-outs for diagnostics. */
export function drainPostgresPostureCheckOptOutFacts(): readonly PostgresPostureCheckOptOutFact[] {
  return postgresPostureCheckOptOutFacts.drain();
}

async function initializeRuntimeDb(
  client: RuntimeSqlClient,
  input: {
    config: ResolvedPostgresRuntimeConfig;
    metadata: KovoRuntimeDbMetadata;
    schemaDdl: string;
    schemaTables: readonly PgTable[];
  },
): Promise<void> {
  if (input.config.provisionOnBoot) {
    await provisionRuntimeDb(client, {
      ...input,
      applySchemaDdl: true,
      migrations: [],
      runtimeLoginRole: undefined,
    });
  }
  if (input.config.driver === 'node-postgres' && !input.config.postureCheckOnBoot) {
    await assertRuntimeConnectionLeastPrivilege(client, input.config);
  }
  if (input.config.postureCheckOnBoot) {
    const report = await checkRuntimeDbPosture(client, {
      ...input,
      checkConnectionLeastPrivilege: input.config.driver === 'node-postgres',
    });
    if (!report.ok) {
      if (
        input.config.driver === 'node-postgres' &&
        report.issues[0]?.code === 'KV433_RUNTIME_ROLE'
      ) {
        throw new Error(
          `KV433: ${RUNTIME_LEAST_PRIVILEGE_ERROR}: ${report.issues[0].detail} (SPEC §10.3).`,
        );
      }
      throw new Error(
        [
          'KV433: Postgres app database posture check failed during boot (SPEC §10.3).',
          ...report.issues.map((issue) => `  ${issue.code}: ${issue.detail}`),
        ].join('\n'),
      );
    }
  } else if (input.config.postureCheckOptOut !== undefined) {
    postgresPostureCheckOptOutFacts.record({
      driver: input.config.driver,
      ...input.config.postureCheckOptOut,
    });
  }
}

async function provisionRuntimeDb(
  client: RuntimeSqlClient,
  input: {
    applySchemaDdl: boolean;
    config: ResolvedPostgresRuntimeConfig;
    metadata: KovoRuntimeDbMetadata;
    migrations: readonly KovoPostgresMigration[];
    runtimeLoginRole: string | undefined;
    schemaDdl: string;
    schemaTables: readonly PgTable[];
  },
): Promise<{ applied: readonly string[]; skipped: readonly string[] }> {
  let migrationReport: { applied: readonly string[]; skipped: readonly string[] } = {
    applied: [],
    skipped: [],
  };
  const roleTopology = postgresRoleTopologyWithRuntimeLogin(
    input.config.roleTopology,
    input.runtimeLoginRole,
  );
  await client.transaction(async (tx) => {
    // Pin the provisioner before the first role/catalog query. Authored and framework table DDL
    // temporarily opt into public-first creation below, then immediately restore this catalog-first
    // path before any security oracle runs (SPEC §10.3 C9/C10).
    await tx.exec(POSTGRES_SECURITY_SEARCH_PATH_SQL);
    await ensurePostgresRoleTopology(tx, roleTopology);
    if (input.applySchemaDdl) {
      await withPostgresAppDdlSearchPath(tx, () => tx.exec(input.schemaDdl));
    }
    migrationReport = await withPostgresAppDdlSearchPath(tx, () =>
      applyPostgresMigrations(tx, input.migrations),
    );
    if (!input.applySchemaDdl) await assertPostgresSchemaTablesExist(tx, input.schemaTables);
    await tx.exec(
      'REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(text,text,boolean) FROM PUBLIC',
    );
    await applyPostgresDefaultDenyPrivileges(tx, input.schemaTables, input.config);
    await withPostgresAppDdlSearchPath(tx, () =>
      provisionPostgresFrameworkTaskStore(tx, input.config),
    );
    await applyPostgresRlsPolicies(tx, input.schemaTables, input.metadata, input.config);
    await applyPostgresViewSecurityInvoker(tx, input.schemaTables);
    await applyPostgresReaderColumnPrivileges(tx, input.schemaTables, input.metadata, input.config);
    await applyPostgresWriterTablePrivileges(tx, input.schemaTables, input.metadata, input.config);
    await applyPostgresWriterSequencePrivileges(
      tx,
      input.schemaTables,
      input.metadata,
      input.config,
    );
    await applyPostgresPrivilegedRolePrivileges(
      tx,
      input.schemaTables,
      input.metadata,
      input.config,
    );
    await withPostgresAppDdlSearchPath(tx, () => ensurePostgresSchemaStateTable(tx));
    await grantPostgresRuntimeLoginRole(tx, roleTopology);
    await withPostgresAppDdlSearchPath(tx, async () => {
      for (const statement of input.config.seedSql) await tx.exec(statement);
    });
    await applyPostgresCreationAuthorityDefaultDeny(tx, input.config, input.runtimeLoginRole);
  });
  return migrationReport;
}

async function withPostgresAppDdlSearchPath<Result>(
  client: RuntimeTransactionClient,
  callback: () => Promise<Result>,
): Promise<Result> {
  await client.exec(POSTGRES_APP_DDL_SEARCH_PATH_SQL);
  const result = await callback();
  await client.exec(POSTGRES_SECURITY_SEARCH_PATH_SQL);
  return result;
}

async function checkRuntimeDbPosture(
  client: RuntimeSqlClient,
  input: {
    checkConnectionLeastPrivilege?: boolean;
    config: ResolvedPostgresRuntimeConfig;
    metadata: KovoRuntimeDbMetadata;
    runtimeLoginRole?: string;
    schemaTables: readonly PgTable[];
  },
): Promise<KovoPostgresPostureReport> {
  // SPEC §10.3 (C9/C10): all live posture facts come from one pinned session and one
  // repeatable-read snapshot. Naming pg_temp last prevents PostgreSQL's implicit-first temporary
  // schema lookup, while pg_catalog first defeats public/temp catalog and privilege-oracle shadows.
  return client.transaction(async (tx) => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await tx.exec(POSTGRES_SECURITY_SEARCH_PATH_SQL);
    return checkRuntimeDbPostureTransaction(tx, input);
  });
}

async function checkRuntimeDbPostureTransaction(
  client: RuntimeTransactionClient,
  input: {
    checkConnectionLeastPrivilege?: boolean;
    config: ResolvedPostgresRuntimeConfig;
    metadata: KovoRuntimeDbMetadata;
    runtimeLoginRole?: string;
    schemaTables: readonly PgTable[];
  },
): Promise<KovoPostgresPostureReport> {
  const issues: KovoPostgresPostureIssue[] = [];
  if (input.checkConnectionLeastPrivilege === true) {
    const leastPrivilegeIssue = await runtimeConnectionLeastPrivilegeIssue(client, input.config);
    if (leastPrivilegeIssue !== undefined) {
      return {
        driver: input.config.driver,
        issues: [leastPrivilegeIssue],
        ok: false,
        roleTopology: postgresRoleTopologyReport(input.config.roleTopology),
      };
    }
  }
  const runtimeLoginRole =
    input.config.driver === 'node-postgres'
      ? (input.runtimeLoginRole ?? (await currentPostgresLogin(client)))
      : input.runtimeLoginRole;
  if (runtimeLoginRole !== undefined) {
    issues.push(
      ...(await postgresRuntimeLoginPostureIssues(client, input.config, runtimeLoginRole)),
    );
  }
  issues.push(
    ...(await postgresAppRoleClosurePostureIssues(client, input.config, runtimeLoginRole)),
  );
  issues.push(...(await postgresRoleAttributeVersionIssues(client)));
  if (input.config.driver === 'node-postgres') {
    issues.push(
      ...(await postgresRuntimeMembershipIssues(
        client,
        input.config.roleTopology,
        runtimeLoginRole,
      )),
    );
  }

  for (const relation of await missingPostgresSchemaTables(client, input.schemaTables)) {
    issues.push({
      code: 'KV433_SCHEMA_TABLE',
      detail: `${relation} is missing; run \`kovo db generate\` and \`kovo db migrate\` before provisioning/checking posture`,
    });
  }

  // SPEC §10.3 (C10): policy posture is an exact catalog allowlist, not the
  // presence of a familiar name. A same-named allow-all/PUBLIC policy or an
  // additional permissive policy changes the effective OR-composed RLS boundary.
  for (const protectedTable of resolveProtectedPostgresTables(
    input.schemaTables,
    input.metadata,
  ).values()) {
    const rls = await safeQuery<{ relforcerowsecurity: boolean; relrowsecurity: boolean }>(
      client,
      [
        'SELECT c.relrowsecurity, c.relforcerowsecurity',
        'FROM pg_class c',
        'JOIN pg_namespace n ON n.oid = c.relnamespace',
        'WHERE n.nspname = $1 AND c.relname = $2',
        "AND c.relkind IN ('r', 'p')",
      ].join(' '),
      [protectedTable.schemaName, protectedTable.tableName],
    );
    const row = rls?.rows[0];
    if (row?.relrowsecurity !== true || row.relforcerowsecurity !== true) {
      issues.push({
        code: 'KV433_FORCE_RLS',
        detail: `${protectedTable.schemaName}.${protectedTable.tableName} must have row-level security enabled and forced`,
      });
    }
    issues.push(
      ...(await postgresProtectedPolicyPostureIssues(client, protectedTable, input.config)),
    );
  }

  for (const table of input.schemaTables) {
    const tableConfig = getTableConfig(table);
    const tableName = tableConfig.name;
    const tableReference = quoteQualified(tableSchemaName(tableConfig), tableName);
    const secretColumns = input.metadata.secretColumnNamesByTable.get(tableName) ?? new Set();
    for (const column of secretColumns) {
      for (const role of [input.config.readerRole, input.config.writerRole]) {
        const grant = await safeQuery<{ can_select: boolean }>(
          client,
          ["SELECT has_column_privilege($1, $2, $3, 'SELECT') AS can_select"].join(' '),
          [role, tableReference, column],
        );
        if (grant === undefined) {
          issues.push({
            code: 'KV433_REACHABILITY_AUDIT',
            detail: `could not verify effective secret-column privilege for ${role} on ${tableName}.${column}`,
          });
          continue;
        }
        if (grant.rows[0]?.can_select === true) {
          issues.push({
            code: 'KV435_SECRET_COLUMN_GRANT',
            detail: `${role} must not have effective SELECT on ${tableName}.${column}`,
          });
        }
      }
    }
  }

  issues.push(...(await auditPostgresReachableClosure(client, input)));
  issues.push(...(await auditPostgresReachableRoutines(client, input.config, runtimeLoginRole)));
  issues.push(...(await auditPostgresUnexpectedPrivileges(client, input.config, runtimeLoginRole)));

  return {
    driver: input.config.driver,
    issues,
    ok: issues.length === 0,
    roleTopology: postgresRoleTopologyReport(
      input.config.roleTopology,
      runtimeLoginRole === undefined ? {} : { runtimeLogin: runtimeLoginRole },
    ),
  };
}

async function postgresProtectedPolicyPostureIssues(
  client: RuntimeTransactionClient,
  table: ProtectedPostgresTable,
  config: ResolvedPostgresRuntimeConfig,
): Promise<KovoPostgresPostureIssue[]> {
  const policies = await safeQuery<PostgresPolicyRow>(
    client,
    [
      'SELECT schemaname, tablename, policyname, permissive, roles::text[] AS roles, cmd, qual, with_check',
      'FROM pg_catalog.pg_policies',
      'WHERE schemaname = $1 AND tablename = $2',
      'ORDER BY policyname',
    ].join(' '),
    [table.schemaName, table.tableName],
  );
  if (policies === undefined) {
    return [
      {
        code: 'KV433_POLICY_SET',
        detail: `could not enumerate the exact RLS policy set for ${table.schemaName}.${table.tableName}`,
      },
    ];
  }

  const primaryPolicyName = table.kind === 'authzPolicy' ? 'kovo_authz_policy' : 'kovo_owner_scope';
  const primaryIssueCode =
    table.kind === 'authzPolicy'
      ? 'KV433_AUTHZ_POLICY'
      : table.kind === 'ownerVia'
        ? 'KV433_OWNER_VIA_POLICY'
        : 'KV433_OWNER_POLICY';
  const expected: ExpectedPostgresPolicy[] = [
    {
      cmd: 'ALL',
      issueCode: primaryIssueCode,
      name: primaryPolicyName,
      permissive: 'PERMISSIVE',
      qual: table.predicate,
      roles: [config.readerRole, config.writerRole],
      withCheck: table.predicate,
    },
    {
      cmd: 'ALL',
      issueCode: 'KV433_SYSTEM_POLICY',
      name: 'kovo_system_scope',
      permissive: 'PERMISSIVE',
      qual: 'true',
      roles: [config.systemRole],
      withCheck: 'true',
    },
  ];
  if (config.crossOwnerReadTables.has(table.tableName)) {
    expected.push({
      cmd: 'SELECT',
      issueCode: 'KV433_ADMIN_POLICY',
      name: 'kovo_admin_scope',
      permissive: 'PERMISSIVE',
      qual: 'true',
      roles: [config.adminRole],
      withCheck: null,
    });
  }

  const issues: KovoPostgresPostureIssue[] = [];
  const actualByName = new Map(policies.rows.map((policy) => [policy.policyname, policy]));
  for (const expectedPolicy of expected) {
    const actual = actualByName.get(expectedPolicy.name);
    if (actual === undefined || !postgresPolicyMatchesExpected(actual, expectedPolicy)) {
      issues.push({
        code: expectedPolicy.issueCode,
        detail:
          actual === undefined
            ? `${table.schemaName}.${table.tableName} is missing ${expectedPolicy.name}`
            : `${table.schemaName}.${table.tableName} ${expectedPolicy.name} has unexpected permissiveness, roles, command, USING, or WITH CHECK shape`,
      });
    }
  }

  const expectedNames = new Set(expected.map((policy) => policy.name));
  const unexpected = policies.rows
    .filter((policy) => !expectedNames.has(policy.policyname))
    .map((policy) => policy.policyname)
    .sort();
  if (unexpected.length > 0) {
    issues.push({
      code: 'KV433_POLICY_SET',
      detail: `${table.schemaName}.${table.tableName} has unexpected RLS policies outside the exact Kovo allowlist: ${unexpected.join(', ')}`,
    });
  }
  return issues;
}

function postgresPolicyMatchesExpected(
  actual: PostgresPolicyRow,
  expected: ExpectedPostgresPolicy,
): boolean {
  const actualQual = canonicalPostgresPolicyExpression(actual.qual);
  const expectedQual = canonicalPostgresPolicyExpression(expected.qual);
  const actualWithCheck = canonicalPostgresPolicyExpression(actual.with_check);
  const expectedWithCheck = canonicalPostgresPolicyExpression(expected.withCheck);
  return (
    actual.permissive === expected.permissive &&
    actual.cmd === expected.cmd &&
    sameStringSet(actual.roles, expected.roles) &&
    actualQual !== undefined &&
    actualQual === expectedQual &&
    actualWithCheck !== undefined &&
    actualWithCheck === expectedWithCheck
  );
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = [...new Set(left)].sort();
  const normalizedRight = [...new Set(right)].sort();
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

function canonicalPostgresPolicyExpression(expression: string | null): string | null | undefined {
  if (expression === null) return null;
  try {
    postgresPolicySqlParser ??= postgresRuntimeRequire(
      'pgsql-ast-parser',
    ) as typeof import('pgsql-ast-parser');
    const [statement] = postgresPolicySqlParser.parse(`SELECT 1 WHERE ${expression}`);
    if (statement?.type !== 'select' || statement.where === undefined) return undefined;
    return JSON.stringify(normalizePostgresPolicyAst(statement.where));
  } catch {
    return undefined;
  }
}

function normalizePostgresPolicyAst(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizePostgresPolicyAst);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const castTarget = record.to as { name?: unknown } | undefined;
  const operand = record.operand as { type?: unknown } | undefined;
  // PostgreSQL deparsing adds implicit `::text` casts around string literals.
  // Removing only that catalog-added representation difference keeps predicate
  // comparison structural and fail-closed without whitespace/parenthesis tricks.
  if (record.type === 'cast' && castTarget?.name === 'text' && operand?.type === 'string') {
    return normalizePostgresPolicyAst(record.operand);
  }
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (record[key] !== undefined) normalized[key] = normalizePostgresPolicyAst(record[key]);
  }
  return normalized;
}

async function auditPostgresReachableClosure(
  client: RuntimeTransactionClient,
  input: {
    config: ResolvedPostgresRuntimeConfig;
    metadata: KovoRuntimeDbMetadata;
    schemaTables: readonly PgTable[];
  },
): Promise<KovoPostgresPostureIssue[]> {
  const issues: KovoPostgresPostureIssue[] = [];
  const protectedTables = resolveProtectedPostgresTables(input.schemaTables, input.metadata);
  const protectedRelations = new Set(
    [...protectedTables.values()].map((table) =>
      postgresRelationKey(table.schemaName, table.tableName),
    ),
  );
  const allowlistedRelations = postgresReachabilityAllowlist(input.schemaTables, input.metadata);
  const allowlistedSequences = await postgresProtectedSerialSequences(client, protectedRelations);
  if (allowlistedSequences === undefined) {
    issues.push({
      code: 'KV433_REACHABILITY_AUDIT',
      detail: 'could not enumerate protected-table serial/identity sequence dependencies',
    });
    return issues;
  }
  const publicRelations = input.config.publicRelations;
  const reachableRows = await safeQuery<PostgresReachableRelationRow>(
    client,
    POSTGRES_REACHABLE_RELATIONS_SQL,
    [
      input.config.readerRole,
      input.config.writerRole,
      input.config.adminRole,
      input.config.systemRole,
    ],
  );
  if (reachableRows === undefined) {
    issues.push({
      code: 'KV433_REACHABILITY_AUDIT',
      detail:
        'could not enumerate app-role relation reachability from pg_class/effective privilege checks',
    });
    return issues;
  }

  const reachable = reachableRelationsFromRows(reachableRows.rows);

  for (const relation of reachable.values()) {
    const relationKey = postgresRelationKey(relation.schema, relation.table);
    const declaredPublicRelation = publicRelations.get(relationKey);
    if (declaredPublicRelation !== undefined) {
      if (relation.relkind === 'v' || relation.relkind === 'm' || relation.relkind === 'f') {
        continue;
      }
      issues.push({
        code: 'KV433_PUBLIC_RELATION',
        detail: `${relation.schema}.${relation.table} is declared public, but relkind ${relation.relkind} can carry Kovo RLS; use schema public/reference metadata or FORCE RLS instead`,
      });
      continue;
    }
    if (relation.relkind === 'r' || relation.relkind === 'p') {
      if (relation.schema === 'public' && FRAMEWORK_INTERNAL_REACHABLE_TABLES.has(relation.table)) {
        continue;
      }
      if (allowlistedRelations.has(relationKey)) continue;
      if (!protectedRelations.has(relationKey)) {
        issues.push({
          code: 'KV433_REACHABLE_TABLE',
          detail: `${relation.schema}.${relation.table} is reachable by an app role but is not a Kovo-protected table`,
        });
        continue;
      }
      const policy = await postgresHasLiveKovoPolicy(client, relation.schema, relation.table);
      if (relation.relrowsecurity !== true || relation.relforcerowsecurity !== true || !policy) {
        issues.push({
          code: 'KV433_REACHABLE_TABLE',
          detail: `${relation.schema}.${relation.table} is reachable by an app role but lacks FORCE RLS and a live Kovo policy`,
        });
      }
      continue;
    }
    if (relation.relkind === 'v') {
      issues.push(
        ...(await auditPostgresReachableView(
          client,
          relation,
          protectedRelations,
          allowlistedRelations,
        )),
      );
      continue;
    }
    if (relation.relkind === 'm') {
      issues.push({
        code: 'KV433_REACHABLE_OBJECT',
        detail: `${relation.schema}.${relation.table} is reachable by ${relation.roles.join(', ')} but materialized views cannot enforce row-level security`,
      });
      continue;
    }
    if (relation.relkind === 'S') {
      if (allowlistedSequences.has(postgresRelationKey(relation.schema, relation.table))) continue;
      issues.push({
        code: 'KV433_REACHABLE_OBJECT',
        detail: `${relation.schema}.${relation.table} is a sequence reachable by ${relation.roles.join(', ')} but does not back a protected table serial/identity column`,
      });
      continue;
    }
    if (relation.relkind === 'f') {
      issues.push({
        code: 'KV433_REACHABLE_OBJECT',
        detail: `${relation.schema}.${relation.table} is reachable by ${relation.roles.join(', ')} but foreign tables cannot prove Kovo row-level security`,
      });
      continue;
    }
    issues.push({
      code: 'KV433_REACHABLE_OBJECT',
      detail: `${relation.schema}.${relation.table} is reachable by an app role with unsupported relkind ${relation.relkind}`,
    });
  }
  issues.push(...(await auditPostgresAttachedCode(client, reachable, input.config)));
  return issues;
}

async function auditPostgresAttachedCode(
  client: RuntimeTransactionClient,
  reachable: ReadonlyMap<string, PostgresReachableRelation>,
  config: ResolvedPostgresRuntimeConfig,
): Promise<KovoPostgresPostureIssue[]> {
  const writableRelations = [...reachable.values()].filter((relation) =>
    postgresRelationIsWritable(relation),
  );
  if (writableRelations.length === 0) return [];
  const writeClosure = await postgresWritePropagationClosure(client, config);
  if (writeClosure === undefined) {
    return [
      {
        code: 'KV433_REACHABILITY_AUDIT',
        detail:
          'could not enumerate structural write-propagation closure for app-role-reachable attached code',
      },
    ];
  }
  if (writeClosure.size === 0) return [];

  // SPEC §10.3 (C10/C13): expression attachment is a recursive executable
  // dependency graph. In particular, CHECK/index/policy expressions depend on
  // pg_operator first; stopping at direct pg_proc edges misses its oprcode.
  const attachedRows = await safeQuery<PostgresAttachedCodeRow>(
    client,
    [
      'WITH RECURSIVE attached_roots(mechanism, relation_oid, classid, objid) AS (',
      "  SELECT 'rewrite rule', rewrite.ev_class, 'pg_rewrite'::regclass, rewrite.oid",
      '  FROM pg_rewrite rewrite',
      '  JOIN pg_class rewrite_rel ON rewrite_rel.oid = rewrite.ev_class',
      '  JOIN pg_namespace rewrite_ns ON rewrite_ns.oid = rewrite_rel.relnamespace',
      "  WHERE rewrite_ns.nspname NOT IN ('pg_catalog', 'information_schema')",
      '  UNION ALL',
      "  SELECT CASE WHEN constraint_row.contype = 'c' THEN 'CHECK/domain constraint function'",
      "    ELSE 'constraint expression function' END,",
      "    constraint_row.conrelid, 'pg_constraint'::regclass, constraint_row.oid",
      '  FROM pg_constraint constraint_row',
      '  JOIN pg_class constraint_rel ON constraint_rel.oid = constraint_row.conrelid',
      '  JOIN pg_namespace constraint_ns ON constraint_ns.oid = constraint_rel.relnamespace',
      '  WHERE constraint_row.conrelid <> 0',
      "  AND constraint_ns.nspname NOT IN ('pg_catalog', 'information_schema')",
      '  UNION ALL',
      "  SELECT 'CHECK/domain constraint function', attr.attrelid,",
      "    'pg_constraint'::regclass, constraint_row.oid",
      '  FROM pg_attribute attr',
      '  JOIN pg_class domain_rel ON domain_rel.oid = attr.attrelid',
      '  JOIN pg_namespace domain_ns ON domain_ns.oid = domain_rel.relnamespace',
      '  JOIN pg_constraint constraint_row ON constraint_row.contypid = attr.atttypid',
      '  WHERE attr.attnum > 0 AND attr.attisdropped = false',
      "  AND domain_ns.nspname NOT IN ('pg_catalog', 'information_schema')",
      '  UNION ALL',
      "  SELECT 'default/generated expression function', attrdef.adrelid,",
      "    'pg_attrdef'::regclass, attrdef.oid",
      '  FROM pg_attrdef attrdef',
      '  JOIN pg_class attrdef_rel ON attrdef_rel.oid = attrdef.adrelid',
      '  JOIN pg_namespace attrdef_ns ON attrdef_ns.oid = attrdef_rel.relnamespace',
      "  WHERE attrdef_ns.nspname NOT IN ('pg_catalog', 'information_schema')",
      '  UNION ALL',
      "  SELECT 'index/predicate expression function', index_row.indrelid,",
      "    'pg_class'::regclass, index_row.indexrelid",
      '  FROM pg_index index_row',
      '  JOIN pg_class index_table ON index_table.oid = index_row.indrelid',
      '  JOIN pg_namespace index_ns ON index_ns.oid = index_table.relnamespace',
      "  WHERE index_ns.nspname NOT IN ('pg_catalog', 'information_schema')",
      '  UNION ALL',
      "  SELECT 'RLS policy expression function', policy.polrelid,",
      "    'pg_policy'::regclass, policy.oid",
      '  FROM pg_policy policy',
      '  JOIN pg_class policy_rel ON policy_rel.oid = policy.polrelid',
      '  JOIN pg_namespace policy_ns ON policy_ns.oid = policy_rel.relnamespace',
      "  WHERE policy_ns.nspname NOT IN ('pg_catalog', 'information_schema')",
      '),',
      'executable_dependencies(mechanism, relation_oid, classid, objid) AS (',
      '  SELECT roots.mechanism, roots.relation_oid, dep.refclassid, dep.refobjid',
      '  FROM attached_roots roots',
      '  JOIN pg_depend dep ON dep.classid = roots.classid AND dep.objid = roots.objid',
      "  WHERE dep.refclassid IN ('pg_proc'::regclass, 'pg_operator'::regclass,",
      "    'pg_cast'::regclass, 'pg_type'::regclass)",
      '  UNION',
      '  SELECT closure.mechanism, closure.relation_oid, dep.refclassid, dep.refobjid',
      '  FROM executable_dependencies closure',
      '  JOIN pg_depend dep ON dep.classid = closure.classid AND dep.objid = closure.objid',
      "  WHERE closure.classid IN ('pg_operator'::regclass, 'pg_cast'::regclass, 'pg_type'::regclass)",
      "  AND dep.refclassid IN ('pg_proc'::regclass, 'pg_operator'::regclass,",
      "    'pg_cast'::regclass, 'pg_type'::regclass)",
      '),',
      'attached_routines(mechanism, relation_oid, routine_oid) AS (',
      "  SELECT CASE WHEN trigger.tgconstraint <> 0 THEN 'CONSTRAINT trigger'",
      "    WHEN (trigger.tgtype & 64) <> 0 THEN 'INSTEAD OF trigger'",
      "    ELSE 'DML trigger' END, trigger.tgrelid, trigger.tgfoid",
      '  FROM pg_trigger trigger',
      '  WHERE trigger.tgisinternal = false',
      '  UNION',
      '  SELECT DISTINCT mechanism, relation_oid, objid',
      '  FROM executable_dependencies',
      "  WHERE classid = 'pg_proc'::regclass",
      ')',
      'SELECT routines.mechanism, rel_ns.nspname AS relation_schema,',
      'rel.relname AS relation_name, proc_ns.nspname AS routine_schema,',
      'proc.proname AS routine_name',
      'FROM attached_routines routines',
      'JOIN pg_class rel ON rel.oid = routines.relation_oid',
      'JOIN pg_namespace rel_ns ON rel_ns.oid = rel.relnamespace',
      'JOIN pg_proc proc ON proc.oid = routines.routine_oid',
      'JOIN pg_namespace proc_ns ON proc_ns.oid = proc.pronamespace',
      "WHERE proc_ns.nspname NOT IN ('pg_catalog', 'information_schema')",
      "AND rel_ns.nspname NOT IN ('pg_catalog', 'information_schema')",
      'ORDER BY relation_schema, relation_name, mechanism, routine_schema, routine_name',
    ].join(' '),
  );
  if (attachedRows === undefined) {
    return [
      {
        code: 'KV433_REACHABILITY_AUDIT',
        detail: 'could not enumerate side-effect attached code on app-role-reachable tables',
      },
    ];
  }
  return attachedRows.rows
    .filter((row) => writeClosure.has(postgresRelationKey(row.relation_schema, row.relation_name)))
    .map((row) => ({
      code: 'KV433_ATTACHED_CODE',
      detail: `${row.relation_schema}.${row.relation_name} has ${row.mechanism} reaching app-authored routine ${row.routine_schema}.${row.routine_name}; attached code is app-role-reachable through writable relation side effects (SPEC §10.3)`,
    }));
}

async function postgresWritePropagationClosure(
  client: RuntimeTransactionClient,
  config: ResolvedPostgresRuntimeConfig,
): Promise<ReadonlySet<string> | undefined> {
  const closureRows = await safeQuery<PostgresWritePropagationClosureRow>(
    client,
    [
      'WITH RECURSIVE app_roles(role_name) AS (VALUES ($1), ($2), ($3), ($4)),',
      'existing_roles AS (',
      '  SELECT DISTINCT r.oid',
      '  FROM pg_roles r',
      '  JOIN app_roles a ON a.role_name = r.rolname',
      '),',
      'direct_writable(oid) AS (',
      '  SELECT DISTINCT c.oid',
      '  FROM pg_class c',
      '  JOIN pg_namespace n ON n.oid = c.relnamespace',
      '  JOIN existing_roles r ON true',
      "  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')",
      "  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')",
      '  AND (',
      "    has_table_privilege(r.oid, c.oid, 'INSERT')",
      "    OR has_table_privilege(r.oid, c.oid, 'UPDATE')",
      "    OR has_table_privilege(r.oid, c.oid, 'DELETE')",
      '    OR EXISTS (',
      '      SELECT 1 FROM pg_attribute a',
      '      WHERE a.attrelid = c.oid',
      '      AND a.attnum > 0',
      '      AND NOT a.attisdropped',
      "      AND (has_column_privilege(r.oid, c.oid, a.attname, 'INSERT')",
      "        OR has_column_privilege(r.oid, c.oid, a.attname, 'UPDATE'))",
      '    )',
      '  )',
      '),',
      'propagation_edges(source_oid, target_oid) AS (',
      '  SELECT constraint_row.confrelid, constraint_row.conrelid',
      '  FROM pg_constraint constraint_row',
      "  WHERE constraint_row.contype = 'f'",
      "  AND (constraint_row.confdeltype IN ('c', 'n', 'd')",
      "    OR constraint_row.confupdtype IN ('c', 'n', 'd'))",
      '  UNION',
      '  SELECT inherits.inhparent, inherits.inhrelid',
      '  FROM pg_inherits inherits',
      '  UNION',
      '  SELECT rewrite.ev_class, dep.refobjid',
      '  FROM pg_rewrite rewrite',
      "  JOIN pg_depend dep ON dep.classid = 'pg_rewrite'::regclass AND dep.objid = rewrite.oid",
      "    AND dep.refclassid = 'pg_class'::regclass",
      '  JOIN pg_class target_rel ON target_rel.oid = dep.refobjid',
      "  WHERE target_rel.relkind IN ('r', 'p', 'v', 'm', 'f')",
      '  AND dep.refobjid <> rewrite.ev_class',
      '),',
      'closure(oid) AS (',
      '  SELECT oid FROM direct_writable',
      '  UNION',
      '  SELECT propagation_edges.target_oid',
      '  FROM closure',
      '  JOIN propagation_edges ON propagation_edges.source_oid = closure.oid',
      ')',
      'SELECT DISTINCT n.nspname AS relation_schema, c.relname AS relation_name',
      'FROM closure',
      'JOIN pg_class c ON c.oid = closure.oid',
      'JOIN pg_namespace n ON n.oid = c.relnamespace',
      "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')",
      'ORDER BY n.nspname, c.relname',
    ].join(' '),
    [config.readerRole, config.writerRole, config.adminRole, config.systemRole],
  );
  if (closureRows === undefined) return undefined;
  return new Set(
    closureRows.rows.map((row) => postgresRelationKey(row.relation_schema, row.relation_name)),
  );
}

function postgresRelationIsWritable(relation: PostgresReachableRelation): boolean {
  return relation.privileges.some(
    (privilege) =>
      privilege === 'INSERT' ||
      privilege === 'UPDATE' ||
      privilege === 'DELETE' ||
      privilege === 'INSERT_COLUMN' ||
      privilege === 'UPDATE_COLUMN',
  );
}

async function auditPostgresReachableView(
  client: RuntimeTransactionClient,
  relation: PostgresReachableRelation,
  protectedRelations: ReadonlySet<string>,
  allowlistedRelations: ReadonlySet<string>,
): Promise<KovoPostgresPostureIssue[]> {
  const issues: KovoPostgresPostureIssue[] = [];
  const dependencies = await postgresViewDependencies(client, relation.schema, relation.table);
  const protectedDependencies = dependencies.filter((dependency) =>
    protectedRelations.has(postgresRelationKey(dependency.table_schema, dependency.table_name)),
  );
  if (!postgresViewIsSecurityInvoker(relation)) {
    issues.push({
      code: 'KV433_REACHABLE_VIEW',
      detail:
        protectedDependencies.length > 0
          ? `reachable non-security_invoker view ${relation.table} over owner table ${protectedDependencies[0]?.table_name}`
          : `reachable non-security_invoker view ${relation.schema}.${relation.table} cannot be proven RLS-safe`,
    });
    return issues;
  }
  if (dependencies.length === 0) {
    issues.push({
      code: 'KV433_REACHABLE_VIEW',
      detail: `reachable security_invoker view ${relation.schema}.${relation.table} has no provable base-table dependency set`,
    });
    return issues;
  }
  for (const dependency of dependencies) {
    const dependencyKey = postgresRelationKey(dependency.table_schema, dependency.table_name);
    if (
      !allowlistedRelations.has(dependencyKey) &&
      (!protectedRelations.has(dependencyKey) ||
        !(await postgresBaseTableHasProtectedPosture(client, dependency)))
    ) {
      issues.push({
        code: 'KV433_REACHABLE_VIEW',
        detail: `reachable security_invoker view ${relation.table} depends on unproven table ${dependency.table_name}`,
      });
    }
  }
  return issues;
}

function reachableRelationsFromRows(
  rows: readonly PostgresReachableRelationRow[],
): ReadonlyMap<string, PostgresReachableRelation> {
  const reachable = new Map<
    string,
    PostgresCatalogRelation & {
      privileges: Set<string>;
      roles: Set<string>;
      schema: string;
      table: string;
    }
  >();
  for (const row of rows) {
    const privileges = [
      row.can_select ? 'SELECT' : undefined,
      row.can_insert ? 'INSERT' : undefined,
      row.can_update ? 'UPDATE' : undefined,
      row.can_delete ? 'DELETE' : undefined,
      row.can_select_column ? 'SELECT_COLUMN' : undefined,
      row.can_insert_column ? 'INSERT_COLUMN' : undefined,
      row.can_update_column ? 'UPDATE_COLUMN' : undefined,
      row.can_use_sequence ? 'USAGE_SEQUENCE' : undefined,
      row.can_select_sequence ? 'SELECT_SEQUENCE' : undefined,
      row.can_update_sequence ? 'UPDATE_SEQUENCE' : undefined,
    ].filter((privilege): privilege is string => privilege !== undefined);
    if (privileges.length === 0) continue;
    const key = `${row.schema_name}.${row.table_name}`;
    let relation = reachable.get(key);
    if (relation === undefined) {
      relation = {
        relforcerowsecurity: row.relforcerowsecurity,
        relkind: row.relkind,
        reloptions: row.reloptions,
        relrowsecurity: row.relrowsecurity,
        schema: row.schema_name,
        schema_name: row.schema_name,
        table: row.table_name,
        table_name: row.table_name,
        privileges: new Set<string>(),
        roles: new Set<string>(),
      };
      reachable.set(key, relation);
    }
    relation.roles.add(row.role_name);
    for (const privilege of privileges) relation.privileges.add(privilege);
  }
  return new Map(
    [...reachable].map(([key, relation]) => [
      key,
      {
        ...relation,
        privileges: [...relation.privileges].sort(),
        roles: [...relation.roles].sort(),
      },
    ]),
  );
}

async function provisionPostgresFrameworkTaskStore(
  client: RuntimeTransactionClient,
  config: ResolvedPostgresRuntimeConfig,
): Promise<void> {
  const executor = createDurableTaskSqlExecutor(client);
  await ensureDurableTaskSchema(executor);
  await ensureRecurringTaskSchema(executor);
  await grantDurableTaskWriterRole(executor, config.writerRole);
}

async function auditPostgresReachableRoutines(
  client: RuntimeTransactionClient,
  config: ResolvedPostgresRuntimeConfig,
  runtimeLoginRole: string | undefined,
): Promise<KovoPostgresPostureIssue[]> {
  const auditedIdentities = await postgresAuditedIdentityNames(client, config, runtimeLoginRole);
  if (auditedIdentities === undefined) {
    return [
      {
        code: 'KV433_REACHABILITY_AUDIT',
        detail:
          'could not enumerate runtime-login/assumable-role routine reachability from pg_roles/pg_has_role',
      },
    ];
  }
  if (auditedIdentities.length === 0) return [];
  const routineRows = await safeQuery<PostgresReachableRoutineRow>(
    client,
    [
      'WITH audited_roles(role_name) AS (SELECT unnest($1::text[])),',
      'existing_roles AS (',
      '  SELECT DISTINCT r.oid, r.rolname',
      '  FROM pg_roles r',
      '  JOIN audited_roles a ON a.role_name = r.rolname',
      ')',
      'SELECT DISTINCT n.nspname AS routine_schema, p.proname AS routine_name,',
      'r.rolname AS role_name',
      'FROM pg_proc p',
      'JOIN pg_namespace n ON n.oid = p.pronamespace',
      'JOIN existing_roles r ON true',
      "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')",
      'AND p.prosecdef = true',
      "AND has_function_privilege(r.oid, p.oid, 'EXECUTE')",
      'ORDER BY n.nspname, p.proname, r.rolname',
    ].join(' '),
    [auditedIdentities],
  );
  if (routineRows === undefined) {
    return [
      {
        code: 'KV433_REACHABILITY_AUDIT',
        detail:
          'could not enumerate app-role routine reachability from pg_proc/has_function_privilege',
      },
    ];
  }
  return routineRows.rows.map((row) => ({
    code: 'KV433_REACHABLE_ROUTINE',
    detail: `${row.routine_schema}.${row.routine_name} is a SECURITY DEFINER routine executable by ${row.role_name}; routine reachability has no vetted Kovo allowlist`,
  }));
}

async function postgresAuditedIdentityNames(
  client: RuntimeTransactionClient,
  config: ResolvedPostgresRuntimeConfig,
  runtimeLoginRole: string | undefined,
): Promise<readonly string[] | undefined> {
  if (runtimeLoginRole === undefined || runtimeLoginRole === '') {
    return [
      ...new Set([config.readerRole, config.writerRole, config.adminRole, config.systemRole]),
    ].sort();
  }
  const rows = await safeQuery<{ rolname: string }>(
    client,
    [
      'SELECT DISTINCT role.rolname',
      'FROM pg_catalog.pg_roles login',
      'JOIN pg_catalog.pg_roles role ON role.oid = login.oid OR pg_catalog.pg_has_role(login.oid, role.oid, $2)',
      'WHERE login.rolname = $1',
      'ORDER BY role.rolname',
    ].join(' '),
    [runtimeLoginRole, 'MEMBER'],
  );
  return rows?.rows.map((row) => row.rolname);
}

async function postgresAppAuthorityIdentityNames(
  client: RuntimeTransactionClient,
  config: ResolvedPostgresRuntimeConfig,
  runtimeLoginRole: string | undefined,
): Promise<readonly string[] | undefined> {
  const roots = [config.readerRole, config.writerRole, runtimeLoginRole]
    .filter((role): role is string => role !== undefined && role !== '')
    .filter((role, index, roles) => roles.indexOf(role) === index);
  const rows = await safeQuery<{ rolname: string }>(
    client,
    [
      'WITH root_names(role_name) AS (SELECT unnest($1::text[])),',
      'existing_roots AS (',
      '  SELECT DISTINCT root.oid',
      '  FROM pg_catalog.pg_roles root',
      '  JOIN root_names input ON input.role_name = root.rolname',
      ')',
      'SELECT DISTINCT candidate.rolname',
      'FROM existing_roots root',
      'JOIN pg_catalog.pg_roles candidate',
      "ON candidate.oid = root.oid OR pg_catalog.pg_has_role(root.oid, candidate.oid, 'MEMBER')",
      'ORDER BY candidate.rolname',
    ].join(' '),
    [roots],
  );
  return rows?.rows.map((row) => row.rolname);
}

async function postgresAppRoleClosurePostureIssues(
  client: RuntimeTransactionClient,
  config: ResolvedPostgresRuntimeConfig,
  runtimeLoginRole: string | undefined,
): Promise<KovoPostgresPostureIssue[]> {
  const auditedIdentities = await postgresAppAuthorityIdentityNames(
    client,
    config,
    runtimeLoginRole,
  );
  if (auditedIdentities === undefined) {
    return [
      {
        code: 'KV433_REACHABILITY_AUDIT',
        detail:
          'could not enumerate the reader/writer/runtime assumable-role closure from pg_roles/pg_has_role',
      },
    ];
  }

  const roleRows = await safeQuery<PostgresRoleClosureRow>(
    client,
    [
      'SELECT role.rolname, role.rolsuper, role.rolbypassrls, role.rolreplication, role.rolcreaterole, role.rolcreatedb,',
      "(role.oid < 16384 OR role.rolname LIKE 'pg\\_%') AS is_predefined",
      'FROM pg_catalog.pg_roles role',
      'WHERE role.rolname = ANY($1::text[])',
      'ORDER BY role.rolname',
    ].join(' '),
    [auditedIdentities],
  );
  const adminOptionRows = await safeQuery<PostgresAdminOptionRow>(
    client,
    [
      'WITH audited_names(role_name) AS (SELECT unnest($1::text[]))',
      'SELECT member_role.rolname AS member_role, granted_role.rolname AS role_name',
      'FROM pg_catalog.pg_auth_members membership',
      'JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member',
      'JOIN audited_names audited ON audited.role_name = member_role.rolname',
      'JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = membership.roleid',
      'WHERE membership.admin_option = true',
      'ORDER BY member_role.rolname, granted_role.rolname',
    ].join(' '),
    [auditedIdentities],
  );
  if (roleRows === undefined || adminOptionRows === undefined) {
    return [
      {
        code: 'KV433_REACHABILITY_AUDIT',
        detail:
          'could not classify elevated attributes, predefined roles, and ADMIN OPTION across the reader/writer/runtime assumable-role closure',
      },
    ];
  }

  const issues: KovoPostgresPostureIssue[] = [];
  const frameworkRoles = new Set([
    config.readerRole,
    config.writerRole,
    config.adminRole,
    config.systemRole,
  ]);
  for (const role of roleRows.rows) {
    if (role.rolname === config.adminRole || role.rolname === config.systemRole) {
      issues.push({
        code: 'KV433_RUNTIME_ROLE',
        detail: `reader/writer/runtime assumable-role closure reaches privileged framework role ${role.rolname}`,
      });
    }
    if (
      role.is_predefined === true &&
      // pg_database_owner is a current-database ownership alias, not a grantable ambient
      // capability. The exact schema/database owner branch in the creation-authority audit below
      // rejects it with the owned object named, so do not replace that stronger diagnostic here.
      role.rolname !== 'pg_database_owner' &&
      !frameworkRoles.has(role.rolname) &&
      !POSTGRES_BENIGN_PREDEFINED_ROLES.has(role.rolname)
    ) {
      issues.push({
        code: 'KV433_RUNTIME_ROLE',
        detail: `reader/writer/runtime assumable-role closure includes PostgreSQL predefined role ${role.rolname}; predefined roles are denied unless explicitly classified benign`,
      });
    }
    if (postgresRoleElevatedAttributes(role).length > 0) {
      issues.push({
        code: 'KV433_RUNTIME_ROLE',
        detail: `reader/writer/runtime assumable-role closure includes ${postgresRoleAttributeDetail(
          role,
        )}; every reachable role must have no elevated attributes`,
      });
    }
  }
  for (const row of adminOptionRows.rows) {
    issues.push({
      code: 'KV433_RUNTIME_ROLE',
      detail: `${row.member_role} in the reader/writer/runtime assumable-role closure holds ADMIN OPTION on ${row.role_name}`,
    });
  }
  return issues;
}

async function postgresUnexpectedCreationAuthorityRows(
  client: RuntimeTransactionClient,
  auditedIdentities: readonly string[],
): Promise<readonly PostgresUnexpectedPrivilegeRow[] | undefined> {
  const rows = await safeQuery<PostgresUnexpectedPrivilegeRow>(
    client,
    [
      'WITH audited_names(role_name) AS (SELECT unnest($1::text[])),',
      'existing_roles AS (',
      '  SELECT DISTINCT role.oid, role.rolname',
      '  FROM pg_catalog.pg_roles role',
      '  JOIN audited_names audited ON audited.role_name = role.rolname',
      '), unsafe_schema_authority AS (',
      "  SELECT 'schema'::text AS object_kind, namespace.nspname::text AS object_name,",
      "  'CREATE'::text AS privilege_type, role.rolname::text AS role_name",
      '  FROM pg_catalog.pg_namespace namespace',
      '  CROSS JOIN existing_roles role',
      "  WHERE namespace.nspname <> 'information_schema'",
      "  AND namespace.nspname !~ '^pg_'",
      "  AND pg_catalog.has_schema_privilege(role.oid, namespace.oid, 'CREATE')",
      '), unsafe_schema_ownership AS (',
      "  SELECT 'schema'::text AS object_kind, namespace.nspname::text AS object_name,",
      "  'OWNER-CREATE'::text AS privilege_type, role.rolname::text AS role_name",
      '  FROM pg_catalog.pg_namespace namespace',
      '  JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = namespace.nspowner',
      '  CROSS JOIN existing_roles role',
      "  WHERE namespace.nspname <> 'information_schema'",
      "  AND namespace.nspname !~ '^pg_'",
      "  AND (role.oid = owner_role.oid OR pg_catalog.pg_has_role(role.oid, owner_role.oid, 'MEMBER'))",
      '), unsafe_database_authority AS (',
      "  SELECT 'database'::text AS object_kind, database.datname::text AS object_name,",
      '  privilege.privilege_type::text, role.rolname::text AS role_name',
      '  FROM pg_catalog.pg_database database',
      '  CROSS JOIN existing_roles role',
      "  CROSS JOIN (VALUES ('CREATE'), ('TEMPORARY')) AS privilege(privilege_type)",
      '  WHERE database.datname = pg_catalog.current_database()',
      '  AND pg_catalog.has_database_privilege(role.oid, database.oid, privilege.privilege_type)',
      '), unsafe_database_ownership AS (',
      "  SELECT 'database'::text AS object_kind, database.datname::text AS object_name,",
      '  privilege.privilege_type::text, role.rolname::text AS role_name',
      '  FROM pg_catalog.pg_database database',
      '  JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = database.datdba',
      '  CROSS JOIN existing_roles role',
      "  CROSS JOIN (VALUES ('OWNER-CREATE'), ('OWNER-TEMPORARY')) AS privilege(privilege_type)",
      '  WHERE database.datname = pg_catalog.current_database()',
      "  AND (role.oid = owner_role.oid OR pg_catalog.pg_has_role(role.oid, owner_role.oid, 'MEMBER'))",
      '), public_schema_authority AS (',
      "  SELECT 'schema'::text AS object_kind, namespace.nspname::text AS object_name,",
      "  acl.privilege_type::text, 'PUBLIC'::text AS role_name",
      '  FROM pg_catalog.pg_namespace namespace',
      "  CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))) acl",
      "  WHERE namespace.nspname <> 'information_schema'",
      "  AND namespace.nspname !~ '^pg_'",
      '  AND acl.grantee = 0',
      "  AND acl.privilege_type = 'CREATE'",
      '), public_database_authority AS (',
      "  SELECT 'database'::text AS object_kind, database.datname::text AS object_name,",
      "  acl.privilege_type::text, 'PUBLIC'::text AS role_name",
      '  FROM pg_catalog.pg_database database',
      "  CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(database.datacl, pg_catalog.acldefault('d', database.datdba))) acl",
      '  WHERE database.datname = pg_catalog.current_database()',
      '  AND acl.grantee = 0',
      "  AND acl.privilege_type IN ('CREATE', 'TEMPORARY')",
      ')',
      'SELECT * FROM unsafe_schema_authority',
      'UNION ALL SELECT * FROM unsafe_schema_ownership',
      'UNION ALL SELECT * FROM unsafe_database_authority',
      'UNION ALL SELECT * FROM unsafe_database_ownership',
      'UNION ALL SELECT * FROM public_schema_authority',
      'UNION ALL SELECT * FROM public_database_authority',
      'ORDER BY object_kind, object_name, privilege_type, role_name',
    ].join(' '),
    [auditedIdentities],
  );
  return rows?.rows;
}

async function auditPostgresUnexpectedPrivileges(
  client: RuntimeTransactionClient,
  config: ResolvedPostgresRuntimeConfig,
  runtimeLoginRole: string | undefined,
): Promise<KovoPostgresPostureIssue[]> {
  const auditedIdentities = await postgresAppAuthorityIdentityNames(
    client,
    config,
    runtimeLoginRole,
  );
  if (auditedIdentities === undefined) {
    return [
      {
        code: 'KV433_REACHABILITY_AUDIT',
        detail:
          'could not enumerate runtime-login/reader/writer assumable-role authority from pg_roles/pg_has_role',
      },
    ];
  }
  const queries = [
    [
      'WITH app_roles(role_name) AS (SELECT unnest($1::text[])),',
      'existing_roles AS (',
      '  SELECT DISTINCT r.oid, r.rolname',
      '  FROM pg_roles r',
      '  JOIN app_roles a ON a.role_name = r.rolname',
      ')',
      "SELECT 'foreign_data_wrapper' AS object_kind, f.fdwname AS object_name,",
      'acl.privilege_type, r.rolname AS role_name',
      'FROM pg_foreign_data_wrapper f',
      'CROSS JOIN LATERAL aclexplode(f.fdwacl) acl',
      'JOIN existing_roles r ON true',
      "WHERE acl.privilege_type = 'USAGE'",
      "AND (acl.grantee = 0 OR acl.grantee = r.oid OR pg_has_role(r.oid, acl.grantee, 'USAGE'))",
    ].join(' '),
    [
      'WITH app_roles(role_name) AS (SELECT unnest($1::text[])),',
      'existing_roles AS (',
      '  SELECT DISTINCT r.oid, r.rolname',
      '  FROM pg_roles r',
      '  JOIN app_roles a ON a.role_name = r.rolname',
      ')',
      "SELECT 'foreign_server' AS object_kind, s.srvname AS object_name,",
      'acl.privilege_type, r.rolname AS role_name',
      'FROM pg_foreign_server s',
      'CROSS JOIN LATERAL aclexplode(s.srvacl) acl',
      'JOIN existing_roles r ON true',
      "WHERE acl.privilege_type = 'USAGE'",
      "AND (acl.grantee = 0 OR acl.grantee = r.oid OR pg_has_role(r.oid, acl.grantee, 'USAGE'))",
    ].join(' '),
    [
      'WITH app_roles(role_name) AS (SELECT unnest($1::text[])),',
      'existing_roles AS (',
      '  SELECT DISTINCT r.oid, r.rolname',
      '  FROM pg_roles r',
      '  JOIN app_roles a ON a.role_name = r.rolname',
      ')',
      "SELECT 'language' AS object_kind, l.lanname AS object_name,",
      'acl.privilege_type, r.rolname AS role_name',
      'FROM pg_language l',
      'CROSS JOIN LATERAL aclexplode(l.lanacl) acl',
      'JOIN existing_roles r ON true',
      "WHERE l.lanname NOT IN ('internal')",
      "AND acl.privilege_type = 'USAGE'",
      "AND (acl.grantee = 0 OR acl.grantee = r.oid OR pg_has_role(r.oid, acl.grantee, 'USAGE'))",
    ].join(' '),
    [
      'WITH app_roles(role_name) AS (SELECT unnest($1::text[])),',
      'existing_roles AS (',
      '  SELECT DISTINCT r.oid, r.rolname',
      '  FROM pg_roles r',
      '  JOIN app_roles a ON a.role_name = r.rolname',
      ')',
      "SELECT 'large_object' AS object_kind, m.oid::text AS object_name,",
      'acl.privilege_type, r.rolname AS role_name',
      'FROM pg_largeobject_metadata m',
      'CROSS JOIN LATERAL aclexplode(m.lomacl) acl',
      'JOIN existing_roles r ON true',
      "WHERE acl.privilege_type IN ('SELECT', 'UPDATE')",
      "AND (acl.grantee = 0 OR acl.grantee = r.oid OR pg_has_role(r.oid, acl.grantee, 'USAGE'))",
    ].join(' '),
    [
      'WITH app_roles(role_name) AS (SELECT unnest($1::text[])),',
      'existing_roles AS (',
      '  SELECT DISTINCT r.oid, r.rolname',
      '  FROM pg_roles r',
      '  JOIN app_roles a ON a.role_name = r.rolname',
      '), expanded_default_acl AS (',
      '  SELECT n.nspname, d.defaclobjtype, acl.grantee, acl.privilege_type',
      '  FROM pg_default_acl d',
      '  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace',
      '  CROSS JOIN LATERAL aclexplode(d.defaclacl) acl',
      ')',
      "SELECT 'default_acl' AS object_kind,",
      "COALESCE(nspname, '*') || ':' || defaclobjtype::text AS object_name,",
      'privilege_type, r.rolname AS role_name',
      'FROM expanded_default_acl acl',
      "JOIN existing_roles r ON acl.grantee = 0 OR acl.grantee = r.oid OR pg_has_role(r.oid, acl.grantee, 'USAGE')",
    ].join(' '),
  ];
  const issues: KovoPostgresPostureIssue[] = [];
  const creationAuthorityRows = await postgresUnexpectedCreationAuthorityRows(
    client,
    auditedIdentities,
  );
  if (creationAuthorityRows === undefined) {
    issues.push({
      code: 'KV433_REACHABILITY_AUDIT',
      detail:
        'could not enumerate effective non-system-schema CREATE or current-database CREATE/TEMPORARY authority',
    });
  } else {
    for (const row of creationAuthorityRows) {
      issues.push({
        code: 'KV433_UNEXPECTED_PRIVILEGE',
        detail: `${row.role_name} has effective ${row.privilege_type} on ${row.object_kind} ${row.object_name}; runtime, reader, writer, PUBLIC, and every assumable role must not create unaudited schemas, objects, or temporary shadow relations`,
      });
    }
  }
  for (const query of queries) {
    const rows = await safeQuery<PostgresUnexpectedPrivilegeRow>(client, query, [
      auditedIdentities,
    ]);
    if (rows === undefined) {
      issues.push({
        code: 'KV433_REACHABILITY_AUDIT',
        detail: 'could not enumerate unexpected app-role ACL-bearing catalog privileges',
      });
      continue;
    }
    for (const row of rows.rows) {
      issues.push({
        code: 'KV433_UNEXPECTED_PRIVILEGE',
        detail: `${row.role_name} has ${row.privilege_type} on ${row.object_kind} ${row.object_name}; app roles may only reach audited relations, columns, routines, and protected-table sequences`,
      });
    }
  }
  return issues;
}

async function postgresProtectedSerialSequences(
  client: RuntimeTransactionClient,
  protectedRelations: ReadonlySet<string>,
): Promise<ReadonlySet<string> | undefined> {
  const rows = await safeQuery<PostgresReachableSequenceRow>(
    client,
    [
      'SELECT DISTINCT seq_ns.nspname AS sequence_schema, seq.relname AS sequence_name',
      ', tbl_ns.nspname AS table_schema, tbl.relname AS table_name',
      'FROM pg_class seq',
      'JOIN pg_namespace seq_ns ON seq_ns.oid = seq.relnamespace',
      'JOIN pg_depend dep ON dep.classid = $1::regclass AND dep.objid = seq.oid',
      'JOIN pg_class tbl ON tbl.oid = dep.refobjid',
      'JOIN pg_namespace tbl_ns ON tbl_ns.oid = tbl.relnamespace',
      "WHERE seq.relkind = 'S'",
      "AND dep.deptype IN ('a', 'i')",
    ].join(' '),
    ['pg_class'],
  );
  return rows === undefined
    ? undefined
    : new Set(
        rows.rows
          .filter((row) =>
            protectedRelations.has(postgresRelationKey(row.table_schema, row.table_name)),
          )
          .map((row) => postgresRelationKey(row.sequence_schema, row.sequence_name)),
      );
}

function createRuntimeClient(config: ResolvedPostgresRuntimeConfig): CreatedRuntimeClient {
  const relations = buildRelations(
    postgresRelationSchemaFromModule(config.schema),
    {},
  ) as AnyRelations;
  return config.driver === 'pglite'
    ? createPgliteRuntimeClient(config, relations)
    : createNodePostgresRuntimeClient(config, relations);
}

function createPgliteRuntimeClient(
  config: ResolvedPostgresRuntimeConfig,
  relations: AnyRelations,
): CreatedRuntimeClient {
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
          postgresReadonlyClientOptions(config, principal, role, roleSetting, client),
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
    readonlySql: (principal, role, roleSetting) =>
      createPostgresReadonlyClient(
        client,
        postgresReadonlyClientOptions(config, principal, role, roleSetting, client),
      ),
    sql: client,
  };
}

function createNodePostgresRuntimeClient(
  config: ResolvedPostgresRuntimeConfig,
  relations: AnyRelations,
): CreatedRuntimeClient {
  const unregisterDatabaseEgressUrl = registerEgressDatabaseUrl(config.databaseUrl);
  const unregisterAdminDatabaseEgressUrl =
    config.adminDatabaseUrl === undefined
      ? undefined
      : registerEgressDatabaseUrl(config.adminDatabaseUrl);
  const unregisterSystemDatabaseEgressUrl =
    config.systemDatabaseUrl === undefined
      ? undefined
      : registerEgressDatabaseUrl(config.systemDatabaseUrl);
  const pool = new Pool({ connectionString: config.databaseUrl } satisfies PoolConfig);
  const transactionalClient = new NodePostgresRuntimeClient(pool);
  const adminTransactionalClient = createOptionalNodePostgresRuntimeClient(config.adminDatabaseUrl);
  const systemTransactionalClient = createOptionalNodePostgresRuntimeClient(
    config.systemDatabaseUrl,
  );
  return {
    close: async () => {
      try {
        await Promise.all([
          transactionalClient.close(),
          adminTransactionalClient?.close(),
          systemTransactionalClient?.close(),
        ]);
      } finally {
        unregisterDatabaseEgressUrl();
        unregisterAdminDatabaseEgressUrl?.();
        unregisterSystemDatabaseEgressUrl?.();
      }
    },
    drizzleInternalDb: (capability) => {
      assertInternalPostgresRuntimeDbCapability(capability);
      return drizzleNodePg({ client: pool, relations });
    },
    drizzleReadonlyDb: (principal, role, roleSetting) =>
      drizzleNodePg({
        client: createPostgresReadonlyClient(
          nodePostgresScopedRuntimeClient(config, transactionalClient, {
            adminClient: adminTransactionalClient,
            roleSetting,
            systemClient: systemTransactionalClient,
          }),
          postgresReadonlyClientOptions(config, principal, role, roleSetting),
        ) as unknown as Pool,
        relations,
      }),
    drizzleRequestDb: (principal, roleSetting) =>
      drizzleNodePg({
        client: createPostgresScopedClient(
          nodePostgresScopedRuntimeClient(config, transactionalClient, {
            adminClient: adminTransactionalClient,
            roleSetting,
            systemClient: systemTransactionalClient,
          }),
          postgresScopedClientOptions(config, principal, roleSetting),
        ) as unknown as Pool,
        relations,
      }),
    label: 'Postgres',
    readonlySql: (principal, role, roleSetting) =>
      createPostgresReadonlyClient(
        nodePostgresScopedRuntimeClient(config, transactionalClient, {
          adminClient: adminTransactionalClient,
          roleSetting,
          systemClient: systemTransactionalClient,
        }),
        postgresReadonlyClientOptions(config, principal, role, roleSetting),
      ),
    sql: transactionalClient,
  };
}

function createOptionalNodePostgresRuntimeClient(
  databaseUrl: string | undefined,
): NodePostgresRuntimeClient | undefined {
  return databaseUrl === undefined
    ? undefined
    : new NodePostgresRuntimeClient(
        new Pool({ connectionString: databaseUrl } satisfies PoolConfig),
      );
}

function nodePostgresScopedRuntimeClient(
  config: ResolvedPostgresRuntimeConfig,
  appClient: NodePostgresRuntimeClient,
  input: {
    adminClient: NodePostgresRuntimeClient | undefined;
    roleSetting: string | undefined;
    systemClient: NodePostgresRuntimeClient | undefined;
  },
): NodePostgresRuntimeClient {
  if (input.roleSetting === 'admin') {
    if (input.adminClient === undefined) {
      throw new Error(
        `KV414: external Postgres crossOwnerRead requires a framework-owned adminDatabaseUrl/KOVO_DB_ADMIN_URL; the ordinary app runtime login must not assume ${config.adminRole} (SPEC §10.3).`,
      );
    }
    return input.adminClient;
  }
  if (input.roleSetting === 'system') {
    if (input.systemClient === undefined) {
      throw new Error(
        `KV414: external Postgres systemDb requires a framework-owned systemDatabaseUrl/KOVO_DB_SYSTEM_URL; the ordinary app runtime login must not assume ${config.systemRole} (SPEC §10.3).`,
      );
    }
    return input.systemClient;
  }
  return appClient;
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
  const readSql = client.readonlySql(scope.principal, config.readerRole, scope.roleSetting);
  const privilegedReadSql = client.readonlySql(scope.principal, false, scope.roleSetting);
  const adminReadDb =
    config.crossOwnerReadTables.size === 0
      ? undefined
      : client.drizzleReadonlyDb(scope.principal, config.readerRole, 'admin');
  const adminReadSql =
    config.crossOwnerReadTables.size === 0
      ? undefined
      : client.readonlySql(scope.principal, config.readerRole, 'admin');
  const crossOwnerRead =
    adminReadDb === undefined || adminReadSql === undefined
      ? undefined
      : {
          adminClient: adminReadDb as object,
          dialectLabel: client.label,
          executeSql: async (statement: { params: readonly unknown[]; text: string }) =>
            (await adminReadSql.query(statement.text, [...statement.params])).rows,
          hasRole: (role: 'admin') => requestPassedRoleGuard(request, role),
          normalizeTableName: normalizePolicyTable,
          ownerTables: [...config.crossOwnerReadTables],
          ...(scope.principal === undefined ? {} : { principal: scope.principal }),
        };
  const rawRead = {
    dialectLabel: client.label,
    executeSql: async (statement: { params: readonly unknown[]; text: string }) =>
      (await readSql.query(statement.text, [...statement.params])).rows,
    normalizeTableName: normalizePolicyTable,
    ownerTables: postgresOwnerScopedTableNames(metadata),
  };
  const privilegedRawRead = {
    dialectLabel: client.label,
    executeSql: async (statement: { params: readonly unknown[]; text: string }) =>
      (await privilegedReadSql.query(statement.text, [...statement.params])).rows,
    normalizeTableName: normalizePolicyTable,
    ownerTables: postgresOwnerScopedTableNames(metadata),
  };
  const readOptions = crossOwnerRead === undefined ? { rawRead } : { crossOwnerRead, rawRead };
  return createSecretBoxingReadDb(readonlyDb(readDb, readOptions), metadata, {
    privilegedDb: readonlyDb(privilegedReadDb, { rawRead: privilegedRawRead }),
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
    let result: Result | undefined;
    let primaryError: unknown;
    try {
      await client.query('BEGIN');
      result = await callback(tx);
      await client.query('COMMIT');
    } catch (error) {
      primaryError = error;
      await client.query('ROLLBACK').catch(() => undefined);
    }
    const cleanupError = await discardNodePostgresSession(client);
    if (cleanupError === undefined) client.release();
    else client.release(cleanupError);
    if (primaryError !== undefined) throw primaryError;
    if (cleanupError !== undefined) throw cleanupError;
    return result as Result;
  }
}

async function discardNodePostgresSession(client: PoolClient): Promise<Error | undefined> {
  try {
    await client.query('DISCARD ALL');
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

export const __testPostgresRuntimeInternals = {
  createRuntimeClient(config: ResolvedPostgresRuntimeConfig): CreatedRuntimeClient {
    return createRuntimeClient(config);
  },
  createNodePostgresRuntimeClient(pool: Pool): RuntimeSqlClient {
    return new NodePostgresRuntimeClient(pool);
  },
  resolvePostgresRuntimeConfig(options: PostgresRuntimeConfigInput): ResolvedPostgresRuntimeConfig {
    return resolvePostgresRuntimeConfig(options);
  },
  unclassifiedPostgresRoleColumns(columns: readonly string[]): readonly string[] {
    return unclassifiedPostgresRoleColumns(columns);
  },
};

class NodePostgresTransactionClient implements RuntimeSqlClient {
  #savepointSequence = 0;

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
    // SPEC §10.3 C15: nested rollback authority must not depend on ambient clocks/RNG/string
    // prototypes. PostgreSQL permits duplicate savepoint names and resolves a rollback to the most
    // recent one; a caught inner failure could therefore shadow the outer marker and commit writes
    // that the outer scope believed it rolled back. This JS-private monotonic sequence is unique for
    // the lifetime of the physical transaction client, and the emitted identifier has fixed SQL
    // grammar rather than passing through caller-mutable quoting controls.
    this.#savepointSequence += 1;
    if (this.#savepointSequence > 1_000_000_000) {
      throw new Error('Nested PostgreSQL transaction savepoint limit exceeded.');
    }
    const savepoint = `kovo_sp_${this.#savepointSequence}`;
    await this.client.query(`SAVEPOINT ${savepoint}`);
    try {
      const result = await callback(this);
      await this.client.query(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      await this.client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => undefined);
      throw error;
    }
  }
}

function resolvePostgresRuntimeConfig(
  options: PostgresRuntimeConfigInput,
): ResolvedPostgresRuntimeConfig {
  const driver = resolveDriver(options);
  const databaseUrl = options.databaseUrl ?? process.env.KOVO_DATABASE_URL;
  const adminDatabaseUrl = options.adminDatabaseUrl ?? process.env.KOVO_DB_ADMIN_URL;
  const systemDatabaseUrl = options.systemDatabaseUrl ?? process.env.KOVO_DB_SYSTEM_URL;
  const envAdminRole = nonEmptyEnv('KOVO_DB_ADMIN_ROLE');
  const envReaderRole = nonEmptyEnv('KOVO_DB_READER_ROLE');
  const envSystemRole = nonEmptyEnv('KOVO_DB_SYSTEM_ROLE');
  const envWriterRole = nonEmptyEnv('KOVO_DB_WRITER_ROLE');
  const adminRole = options.adminRole ?? envAdminRole ?? DEFAULT_ADMIN_ROLE;
  const readerRole = options.readerRole ?? envReaderRole ?? DEFAULT_READER_ROLE;
  const systemRole = options.systemRole ?? envSystemRole ?? DEFAULT_SYSTEM_ROLE;
  const writerRole = options.writerRole ?? envWriterRole ?? DEFAULT_WRITER_ROLE;
  const roleTopology = resolvePostgresRoleTopology({
    adminRole,
    adminRoleAdopted: options.adminRole !== undefined || envAdminRole !== undefined,
    readerRole,
    readerRoleAdopted: options.readerRole !== undefined || envReaderRole !== undefined,
    systemRole,
    systemRoleAdopted: options.systemRole !== undefined || envSystemRole !== undefined,
    writerRole,
    writerRoleAdopted: options.writerRole !== undefined || envWriterRole !== undefined,
  });
  const crossOwnerReadTables = normalizeStringSet(options.crossOwnerReadTables);
  const publicRelations = normalizePublicRelationDeclarations(options.publicRelations);
  const postureCheck = resolvePostgresPostureCheck(
    options,
    driver === 'node-postgres' && options.provisionOnBoot !== true,
  );
  const config: ResolvedPostgresRuntimeConfig = {
    adminRole,
    ...(adminDatabaseUrl === undefined ? {} : { adminDatabaseUrl }),
    crossOwnerReadTables,
    dataDir: options.dataDir ?? process.env.KOVO_DATA_DIR ?? DEFAULT_DATA_DIR,
    driver,
    postureCheckOnBoot: postureCheck.onBoot,
    ...(postureCheck.optOut === undefined ? {} : { postureCheckOptOut: postureCheck.optOut }),
    principalFromRequest: options.principalFromRequest ?? principalFromRequest,
    provisionOnBoot: options.provisionOnBoot ?? driver === 'pglite',
    publicRelations,
    readerRole,
    roleTopology,
    schema: options.schema,
    seedSql: normalizeSeedSql(options.seedSql),
    ...(systemDatabaseUrl === undefined ? {} : { systemDatabaseUrl }),
    systemRole,
    writerRole,
  };
  if (databaseUrl !== undefined) return { ...config, databaseUrl };
  return config;
}

function resolvePostgresPostureCheck(
  options: PostgresRuntimeConfigInput,
  defaultOnBoot: boolean,
): { onBoot: boolean; optOut?: PostgresPostureCheckOptOut } {
  if (options.postureCheckOnBoot !== undefined) {
    return { onBoot: options.postureCheckOnBoot };
  }

  const postureCheck = options.postureCheck;
  if (postureCheck === undefined) return { onBoot: defaultOnBoot };
  if (!isRecord(postureCheck)) {
    throw new Error(
      'KV433: postureCheck must be { onBoot: true } or { onBoot: false, justification } (SPEC §10.3).',
    );
  }

  if (postureCheck.onBoot === undefined || postureCheck.onBoot === true) {
    return { onBoot: true };
  }
  if (postureCheck.onBoot !== false) {
    throw new Error(
      'KV433: postureCheck.onBoot must be true or false; disabling requires a justification (SPEC §10.3).',
    );
  }

  const justification = postureCheck.justification;
  if (typeof justification !== 'string' || justification.trim() === '') {
    throw new Error(
      'KV433: postureCheck: { onBoot: false } requires a non-empty justification for kovo explain --capabilities (SPEC §10.3).',
    );
  }
  const site = postureCheck.site;
  return {
    onBoot: false,
    optOut: {
      justification: justification.trim(),
      ...(typeof site === 'string' && site.trim() !== '' ? { site: site.trim() } : {}),
    },
  };
}

function nonEmptyEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

function normalizeStringSet(values: readonly string[] | undefined): ReadonlySet<string> {
  if (values === undefined) return new Set();
  return new Set(values.map((value) => value.trim()).filter((value) => value !== ''));
}

function normalizedPublicRelationDeclaration(
  value: KovoPostgresPublicRelationDeclarationOptions,
): KovoPostgresPublicRelationDeclarationOptions {
  if (!isRecord(value)) {
    throw new Error('KV433: declarePublicRelation requires a declaration object (SPEC §10.3).');
  }
  const relation = normalizePostgresRelationName(value.relation);
  const reason = value.reason;
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new Error('KV433: declarePublicRelation requires a non-empty reason (SPEC §10.3).');
  }
  const site = value.site;
  if (site !== undefined && (typeof site !== 'string' || site.trim() === '')) {
    throw new Error('KV433: declarePublicRelation site must be a non-empty string.');
  }
  return {
    relation,
    reason: reason.trim(),
    ...(site === undefined ? {} : { site: site.trim() }),
  };
}

function normalizePublicRelationDeclarations(
  declarations: readonly KovoPostgresPublicRelationDeclaration[] | undefined,
): ReadonlyMap<string, KovoPostgresPublicRelationDeclaration> {
  const publicRelations = new Map<string, KovoPostgresPublicRelationDeclaration>();
  if (declarations === undefined) return publicRelations;
  for (const declaration of declarations) {
    if (!isPublicRelationDeclaration(declaration)) {
      throw new Error(
        'KV433: publicRelations entries must be created with declarePublicRelation(...) (SPEC §10.3).',
      );
    }
    const key = normalizePostgresRelationName(declaration.relation);
    if (publicRelations.has(key)) {
      throw new Error(`KV433: duplicate declarePublicRelation entry for ${key}.`);
    }
    publicRelations.set(key, declaration);
  }
  return publicRelations;
}

function isPublicRelationDeclaration(
  value: unknown,
): value is KovoPostgresPublicRelationDeclaration {
  return (
    isRecord(value) &&
    Reflect.get(value, publicPostgresRelationBrand) !== undefined &&
    typeof Reflect.get(value, 'relation') === 'string' &&
    typeof Reflect.get(value, 'reason') === 'string'
  );
}

function normalizePostgresRelationName(relation: unknown): string {
  if (typeof relation !== 'string') {
    throw new Error('KV433: declarePublicRelation relation must be a string (SPEC §10.3).');
  }
  const parts = relation
    .trim()
    .split('.')
    .map((part) => part.trim());
  if (parts.length === 1) {
    const [table] = parts;
    if (table === undefined) {
      throw new Error('KV433: declarePublicRelation relation must name a relation.');
    }
    return postgresRelationKey('public', normalizedIdentifierPart(table));
  }
  if (parts.length === 2) {
    const [schema, table] = parts;
    if (schema === undefined || table === undefined) {
      throw new Error('KV433: declarePublicRelation relation must name a relation.');
    }
    return postgresRelationKey(normalizedIdentifierPart(schema), normalizedIdentifierPart(table));
  }
  throw new Error(
    'KV433: declarePublicRelation relation must be `name` or `schema.name` (SPEC §10.3).',
  );
}

function normalizedIdentifierPart(part: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/u.test(part)) {
    throw new Error(
      `KV433: declarePublicRelation relation part ${JSON.stringify(
        part,
      )} must be an unquoted Postgres identifier.`,
    );
  }
  return part;
}

function postgresRelationKey(schema: string, table: string): string {
  return `${schema}.${table}`;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
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

async function ensurePostgresRole(client: RuntimeTransactionClient, role: string): Promise<void> {
  const result = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  if (result.rows.length === 0) await client.exec(`CREATE ROLE ${quoteIdent(role)}`);
}

function resolvePostgresRoleTopology(input: {
  adminRole: string;
  adminRoleAdopted: boolean;
  readerRole: string;
  readerRoleAdopted: boolean;
  systemRole: string;
  systemRoleAdopted: boolean;
  writerRole: string;
  writerRoleAdopted: boolean;
}): PostgresRoleTopology {
  const roles = {
    admin: postgresTopologyRole('admin', input.adminRole, input.adminRoleAdopted),
    reader: postgresTopologyRole('reader', input.readerRole, input.readerRoleAdopted),
    system: postgresTopologyRole('system', input.systemRole, input.systemRoleAdopted),
    writer: postgresTopologyRole('writer', input.writerRole, input.writerRoleAdopted),
  };
  return {
    roles,
    membershipEdges: [],
  };
}

function postgresTopologyRole(
  purpose: PostgresRolePurpose,
  name: string,
  adopted: boolean,
): PostgresRoleTopologyRole {
  return {
    management: adopted ? 'adopt' : 'create',
    name,
    purpose,
  };
}

function postgresRoleTopologyWithRuntimeLogin(
  topology: PostgresRoleTopology,
  runtimeLoginRole: string | undefined,
): PostgresRoleTopology {
  if (runtimeLoginRole === undefined || runtimeLoginRole === '') return topology;
  return {
    ...topology,
    membershipEdges: postgresRuntimeMembershipEdges(topology, runtimeLoginRole),
  };
}

function postgresRuntimeMembershipEdges(
  topology: PostgresRoleTopology,
  runtimeLoginRole: string,
): readonly PostgresRoleMembershipEdge[] {
  return [topology.roles.reader.name, topology.roles.writer.name]
    .filter((role) => role !== runtimeLoginRole)
    .map((role) => ({
      memberRole: runtimeLoginRole,
      owner: 'kovo' as const,
      role,
    }));
}

async function preflightPostgresRoleTopology(
  client: RuntimeTransactionClient,
  topology: PostgresRoleTopology,
): Promise<void> {
  const adoptedRoles = Object.values(topology.roles).filter((role) => role.management === 'adopt');
  if (adoptedRoles.length === 0) return;
  const existing = await existingPostgresRoles(
    client,
    adoptedRoles.map((role) => role.name),
  );
  const missing = adoptedRoles.filter((role) => !existing.has(role.name));
  if (missing.length > 0) {
    throw new Error(
      [
        'KV433_ROLE_TOPOLOGY: adopted Postgres roles must exist before provisioning (SPEC §10.3).',
        `missing: ${missing.map((role) => `${role.purpose}Role=${role.name}`).join(', ')}`,
        'Set KOVO_DB_READER_ROLE, KOVO_DB_WRITER_ROLE, KOVO_DB_ADMIN_ROLE, and KOVO_DB_SYSTEM_ROLE to pre-created roles, or allow Kovo to create its default roles.',
      ].join(' '),
    );
  }
  const attributeRows = await postgresRoleAttributeRows(
    client,
    adoptedRoles.map((role) => role.name),
  );
  const privileged = attributeRows.filter((row) => postgresRoleElevatedAttributes(row).length > 0);
  if (privileged.length > 0) {
    throw new Error(
      [
        `KV433_ROLE_TOPOLOGY: adopted Postgres roles must have no elevated role attributes (${POSTGRES_ELEVATED_ROLE_ATTRIBUTES.map(
          (attribute) => `NO${attribute.label}`,
        ).join(', ')}) (SPEC §10.3).`,
        `offending: ${privileged.map(postgresRoleAttributeDetail).join(', ')}`,
      ].join(' '),
    );
  }
}

async function ensurePostgresRoleTopology(
  client: RuntimeTransactionClient,
  topology: PostgresRoleTopology,
): Promise<void> {
  await preflightPostgresRoleTopology(client, topology);
  for (const role of Object.values(topology.roles)) {
    if (role.management === 'create') await ensurePostgresRole(client, role.name);
  }
}

async function existingPostgresRoles(
  client: RuntimeTransactionClient,
  roles: readonly string[],
): Promise<ReadonlySet<string>> {
  if (roles.length === 0) return new Set();
  const result = await client.query<{ rolname: string }>(
    'SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])',
    [roles],
  );
  return new Set(result.rows.map((row) => row.rolname));
}

async function postgresRoleAttributeRows(
  client: RuntimeTransactionClient,
  roles: readonly string[],
): Promise<readonly PostgresRoleAttributeRow[]> {
  if (roles.length === 0) return [];
  const result = await client.query<PostgresRoleAttributeRow>(
    [
      'SELECT rolname, rolsuper, rolbypassrls, rolreplication, rolcreaterole, rolcreatedb',
      'FROM pg_catalog.pg_roles WHERE rolname = ANY($1::text[])',
    ].join(' '),
    [roles],
  );
  return result.rows;
}

function postgresRoleElevatedAttributes(row: PostgresRoleAttributeRow): readonly string[] {
  const attributes: string[] = [];
  for (const attribute of POSTGRES_ELEVATED_ROLE_ATTRIBUTES) {
    if (row[attribute.column]) attributes.push(attribute.label);
  }
  return attributes;
}

function postgresRoleAttributeDetail(row: PostgresRoleAttributeRow): string {
  const attributes = postgresRoleElevatedAttributes(row);
  return `${row.rolname}(${attributes.join('+')})`;
}

async function postgresRoleAttributeVersionIssues(
  client: RuntimeTransactionClient,
): Promise<KovoPostgresPostureIssue[]> {
  const rows = await safeQuery<{ attname: string }>(
    client,
    [
      'SELECT attname',
      'FROM pg_attribute',
      "WHERE attrelid = 'pg_catalog.pg_roles'::regclass",
      'AND attnum > 0',
      'AND attisdropped = false',
      "AND attname LIKE 'rol%'",
      'ORDER BY attname',
    ].join(' '),
  );
  if (rows === undefined) {
    return [
      {
        code: 'KV433_ROLE_ATTRIBUTE_SET',
        detail:
          'could not enumerate pg_roles role-attribute columns for fail-closed classification',
      },
    ];
  }
  const unclassified = unclassifiedPostgresRoleColumns(rows.rows.map((row) => row.attname));
  if (unclassified.length === 0) return [];
  return [
    {
      code: 'KV433_ROLE_ATTRIBUTE_SET',
      detail: `pg_roles exposes unclassified role-attribute column(s): ${unclassified.join(
        ', ',
      )}; classify each as elevated or benign before trusting runtime identity posture (SPEC §10.3)`,
    },
  ];
}

function unclassifiedPostgresRoleColumns(columns: readonly string[]): readonly string[] {
  return columns
    .filter((column) => !POSTGRES_CLASSIFIED_ROLE_COLUMNS.has(column))
    .sort((left, right) => left.localeCompare(right));
}

async function postgresRuntimeLoginPostureIssues(
  client: RuntimeTransactionClient,
  config: ResolvedPostgresRuntimeConfig,
  runtimeLoginRole: string,
): Promise<KovoPostgresPostureIssue[]> {
  const issues: KovoPostgresPostureIssue[] = [];
  const roleRows = await safeQuery<
    PostgresRoleAttributeRow & { can_admin: boolean; can_system: boolean }
  >(
    client,
    [
      'SELECT r.rolname, r.rolsuper, r.rolbypassrls, r.rolreplication, r.rolcreaterole, r.rolcreatedb,',
      "(SELECT pg_has_role(r.oid, admin.oid, 'MEMBER') FROM pg_roles admin WHERE admin.rolname = $2) AS can_admin,",
      "(SELECT pg_has_role(r.oid, system_role.oid, 'MEMBER') FROM pg_roles system_role WHERE system_role.rolname = $3) AS can_system",
      'FROM pg_roles r WHERE r.rolname = $1',
    ].join(' '),
    [runtimeLoginRole, config.adminRole, config.systemRole],
  );
  const login = roleRows?.rows[0];
  if (login === undefined) {
    return [
      {
        code: 'KV433_RUNTIME_ROLE',
        detail: `runtime login ${runtimeLoginRole} does not exist`,
      },
    ];
  }
  if (postgresRoleElevatedAttributes(login).length > 0) {
    issues.push({
      code: 'KV433_RUNTIME_ROLE',
      detail: `runtime login ${runtimeLoginRole} must have no elevated role attributes; found ${postgresRoleAttributeDetail(
        login,
      )}`,
    });
  }
  for (const [purpose, role, canAssume] of [
    ['admin', config.adminRole, login.can_admin],
    ['system', config.systemRole, login.can_system],
  ] as const) {
    if (canAssume !== true) continue;
    issues.push({
      code: 'KV433_RUNTIME_ROLE',
      detail: `runtime login ${runtimeLoginRole} must not be able to SET ROLE to ${purpose}Role=${role}`,
    });
  }

  // SPEC §10.3 (C10/C11): this is the SAME `pg_has_role(login, role, 'MEMBER')` closure DEC-B/DEC-C
  // audit — the roles the login can SET ROLE to. `is_predefined` flags PostgreSQL predefined roles,
  // identified by the reserved `pg_` name prefix (sound: `pg_` is reserved for predefined roles) and
  // the < FirstNormalObjectId (16384) system-OID range, so the allowlist below can range over
  // predefined-role MEMBERSHIP in addition to the role-ATTRIBUTE allowlist.
  const assumableRows = await safeQuery<PostgresRoleAttributeRow & { is_predefined: boolean }>(
    client,
    [
      'SELECT role.rolname, role.rolsuper, role.rolbypassrls, role.rolreplication, role.rolcreaterole, role.rolcreatedb,',
      "(role.oid < 16384 OR role.rolname LIKE 'pg\\_%') AS is_predefined",
      'FROM pg_roles login',
      'JOIN pg_roles role ON role.oid <> login.oid',
      'WHERE login.rolname = $1',
      "AND pg_has_role(login.oid, role.oid, 'MEMBER')",
      'ORDER BY role.rolname',
    ].join(' '),
    [runtimeLoginRole],
  );
  const frameworkRoles: ReadonlySet<string> = new Set([
    config.readerRole,
    config.writerRole,
    config.adminRole,
    config.systemRole,
  ]);
  if (assumableRows === undefined) {
    issues.push({
      code: 'KV433_RUNTIME_ROLE',
      detail: `could not enumerate roles assumable by runtime login ${runtimeLoginRole}`,
    });
  } else {
    for (const role of assumableRows.rows) {
      // SPEC §10.3 (C10/C11): ALLOWLIST over predefined-role membership. Membership in any `pg_*`
      // predefined role that is not one of the framework's own roles or an explicit benign
      // don't-care entry fails closed and is named — this catches escalation surfaces (OS command
      // execution, all-data read/write, server-file access, monitoring/maintenance) that carry NONE
      // of the five elevated role attributes and would otherwise pass the attribute allowlist.
      if (
        role.is_predefined === true &&
        !frameworkRoles.has(role.rolname) &&
        !POSTGRES_BENIGN_PREDEFINED_ROLES.has(role.rolname)
      ) {
        issues.push({
          code: 'KV433_RUNTIME_ROLE',
          detail: `runtime login ${runtimeLoginRole} is a member of PostgreSQL predefined role ${role.rolname}; predefined-role membership grants escalation capabilities that carry no elevated role attribute, so the runtime login and every assumable role must be a member of only framework roles`,
        });
      }
      if (postgresRoleElevatedAttributes(role).length === 0) continue;
      issues.push({
        code: 'KV433_RUNTIME_ROLE',
        detail: `runtime login ${runtimeLoginRole} can SET ROLE to ${postgresRoleAttributeDetail(
          role,
        )}; every assumable role must have no elevated role attributes`,
      });
    }
  }

  const adminOptionRows = await safeQuery<{ role_name: string }>(
    client,
    [
      'SELECT role.rolname AS role_name',
      'FROM pg_auth_members member',
      'JOIN pg_roles login ON login.oid = member.member',
      'JOIN pg_roles role ON role.oid = member.roleid',
      'WHERE login.rolname = $1 AND member.admin_option = true',
      'ORDER BY role.rolname',
    ].join(' '),
    [runtimeLoginRole],
  );
  if (adminOptionRows === undefined) {
    issues.push({
      code: 'KV433_RUNTIME_ROLE',
      detail: `could not verify runtime login ${runtimeLoginRole} ADMIN OPTION memberships`,
    });
  } else {
    for (const row of adminOptionRows.rows) {
      issues.push({
        code: 'KV433_RUNTIME_ROLE',
        detail: `runtime login ${runtimeLoginRole} holds ADMIN OPTION on ${row.role_name}; runtime logins must not be able to grant themselves assumable roles`,
      });
    }
  }
  return issues;
}

async function postgresRuntimeMembershipIssues(
  client: RuntimeTransactionClient,
  topology: PostgresRoleTopology,
  runtimeLoginRole: string | undefined,
): Promise<KovoPostgresPostureIssue[]> {
  const issues: KovoPostgresPostureIssue[] = [];
  const rows = await safeQuery<{ can_reader: boolean; can_writer: boolean; runtime_login: string }>(
    client,
    [
      'SELECT COALESCE($3::text, current_user) AS runtime_login,',
      "(SELECT pg_has_role(COALESCE($3::text, current_user), reader.oid, 'USAGE') FROM pg_roles reader WHERE reader.rolname = $1) AS can_reader,",
      "(SELECT pg_has_role(COALESCE($3::text, current_user), writer.oid, 'USAGE') FROM pg_roles writer WHERE writer.rolname = $2) AS can_writer",
    ].join(' '),
    [topology.roles.reader.name, topology.roles.writer.name, runtimeLoginRole ?? null],
  );
  const row = rows?.rows[0];
  if (row === undefined) {
    return [
      {
        code: 'KV433_ROLE_TOPOLOGY',
        detail: 'could not verify runtime membership edges for reader/writer roles',
      },
    ];
  }
  for (const [purpose, role, ok] of [
    ['reader', topology.roles.reader.name, row.can_reader],
    ['writer', topology.roles.writer.name, row.can_writer],
  ] as const) {
    if (role === row.runtime_login || ok === true) continue;
    issues.push({
      code: 'KV433_ROLE_TOPOLOGY',
      detail: `runtime login ${row.runtime_login} is missing membership in ${purpose}Role=${role}; grant ${quoteIdent(role)} to ${quoteIdent(row.runtime_login)} or run kovo db provision with a privileged admin URL`,
    });
  }
  return issues;
}

async function currentPostgresLogin(client: RuntimeTransactionClient): Promise<string | undefined> {
  const result = await safeQuery<{ runtime_login: string }>(
    client,
    'SELECT current_user AS runtime_login',
  );
  return result?.rows[0]?.runtime_login;
}

function postgresRoleTopologyReport(
  topology: PostgresRoleTopology,
  input: {
    edgeStatuses?: ReadonlyMap<
      string,
      KovoPostgresPostureReport['roleTopology']['membershipEdges'][number]['status']
    >;
    runtimeLogin?: string;
  } = {},
): KovoPostgresPostureReport['roleTopology'] {
  const withRuntime = postgresRoleTopologyWithRuntimeLogin(topology, input.runtimeLogin);
  return {
    adminRole: withRuntime.roles.admin,
    membershipEdges: withRuntime.membershipEdges.map((edge) => ({
      ...edge,
      status: input.edgeStatuses?.get(postgresMembershipEdgeKey(edge)) ?? 'expected',
    })),
    readerRole: withRuntime.roles.reader,
    ...(input.runtimeLogin === undefined ? {} : { runtimeLogin: input.runtimeLogin }),
    systemRole: withRuntime.roles.system,
    writerRole: withRuntime.roles.writer,
  };
}

function postgresMembershipEdgeKey(edge: PostgresRoleMembershipEdge): string {
  return `${edge.memberRole}->${edge.role}`;
}

async function assertPostgresSchemaTablesExist(
  client: RuntimeTransactionClient,
  tables: readonly PgTable[],
): Promise<void> {
  const missing = await missingPostgresSchemaTables(client, tables);
  if (missing.length === 0) return;
  throw new Error(
    [
      'KV433_SCHEMA_TABLE: Postgres schema tables are missing; run `kovo db generate` and `kovo db migrate` before `kovo db provision` (SPEC §10.3).',
      `missing: ${missing.join(', ')}`,
    ].join(' '),
  );
}

async function missingPostgresSchemaTables(
  client: RuntimeTransactionClient,
  tables: readonly PgTable[],
): Promise<readonly string[]> {
  const missing: string[] = [];
  for (const table of tables) {
    const config = getTableConfig(table);
    const schema = tableSchemaName(config);
    const result = await safeQuery<{ exists: number }>(
      client,
      [
        'SELECT 1 AS exists',
        'FROM pg_class c',
        'JOIN pg_namespace n ON n.oid = c.relnamespace',
        'WHERE n.nspname = $1 AND c.relname = $2',
        "AND c.relkind IN ('r', 'p')",
      ].join(' '),
      [schema, config.name],
    );
    if ((result?.rows.length ?? 0) === 0) missing.push(`${schema}.${config.name}`);
  }
  return missing;
}

async function ensurePostgresSchemaStateTable(client: RuntimeTransactionClient): Promise<void> {
  await client.exec(
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(SCHEMA_STATE_TABLE)} (key text PRIMARY KEY, value text NOT NULL, updated_at timestamp NOT NULL DEFAULT now())`,
  );
}

async function grantPostgresRuntimeLoginRole(
  client: RuntimeTransactionClient,
  topology: PostgresRoleTopology,
): Promise<void> {
  for (const edge of topology.membershipEdges) {
    if (edge.owner !== 'kovo') continue;
    if (await postgresRoleMembershipExists(client, edge)) continue;
    await client.exec(`GRANT ${quoteIdent(edge.role)} TO ${quoteIdent(edge.memberRole)}`);
  }
  const runtimeLoginRole = topology.membershipEdges[0]?.memberRole;
  if (runtimeLoginRole === undefined || runtimeLoginRole === '') return;
  await client.exec(
    `GRANT SELECT ON TABLE ${quoteIdent(SCHEMA_STATE_TABLE)} TO ${quoteIdent(runtimeLoginRole)}`,
  );
  await client.exec(
    `GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text,text,boolean) TO ${quoteIdent(
      runtimeLoginRole,
    )}`,
  );
}

async function postgresRoleMembershipExists(
  client: RuntimeTransactionClient,
  edge: PostgresRoleMembershipEdge,
): Promise<boolean> {
  const result = await client.query<{ has_membership: boolean }>(
    "SELECT pg_has_role($1::text, $2::text, 'USAGE') AS has_membership",
    [edge.memberRole, edge.role],
  );
  return result.rows[0]?.has_membership === true;
}

function runtimeLoginRoleFromDatabaseUrl(databaseUrl: string | undefined): string | undefined {
  if (databaseUrl === undefined || databaseUrl === '') return undefined;
  try {
    const username = new URL(databaseUrl).username;
    return username === '' ? undefined : decodeURIComponent(username);
  } catch {
    return undefined;
  }
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
  const issue = await client.transaction(async (tx) => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await tx.exec(POSTGRES_SECURITY_SEARCH_PATH_SQL);
    return runtimeConnectionLeastPrivilegeIssue(tx, config);
  });
  if (issue !== undefined) {
    throw new Error(`KV433: ${RUNTIME_LEAST_PRIVILEGE_ERROR}: ${issue.detail} (SPEC §10.3).`);
  }
}

async function runtimeConnectionLeastPrivilegeIssue(
  client: RuntimeTransactionClient,
  config: ResolvedPostgresRuntimeConfig,
): Promise<KovoPostgresPostureIssue | undefined> {
  const current = await client.query<{ runtime_login: string }>(
    'SELECT current_user AS runtime_login',
  );
  const runtimeLogin = current.rows[0]?.runtime_login;
  if (runtimeLogin === undefined) {
    return {
      code: 'KV433_RUNTIME_ROLE',
      detail: RUNTIME_LEAST_PRIVILEGE_ERROR,
    };
  }
  return (await postgresRuntimeLoginPostureIssues(client, config, runtimeLogin))[0];
}

function assertProductionRuntimeDriver(config: ResolvedPostgresRuntimeConfig): void {
  if (config.driver === 'pglite' && currentNodeEnv() === 'production') {
    throw new Error(`KV433: ${PRODUCTION_PGLITE_ERROR} (SPEC §10.3).`);
  }
}

function currentNodeEnv(): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.['NODE_ENV'];
}

async function applyPostgresMigrations(
  client: RuntimeTransactionClient,
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

    await client.exec(migration.sql);
    await client.query(
      `INSERT INTO ${quoteIdent(MIGRATIONS_TABLE)} (id, checksum) VALUES ($1, $2)`,
      [migration.id, migration.checksum],
    );
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
  client: RuntimeTransactionClient,
  tables: readonly PgTable[],
  config: ResolvedPostgresRuntimeConfig,
): Promise<void> {
  const schemas = new Set<string>();
  for (const table of tables) schemas.add(tableSchemaName(getTableConfig(table)));
  for (const schema of schemas) {
    await client.exec(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${quoteIdent(schema)} REVOKE ALL ON TABLES FROM PUBLIC`,
    );
    await client.exec(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${quoteIdent(
        schema,
      )} REVOKE ALL ON SEQUENCES FROM PUBLIC`,
    );
    await client.exec(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${quoteIdent(
        schema,
      )} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`,
    );
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
    await client.exec(
      `REVOKE ALL ON ALL TABLES IN SCHEMA ${quoteIdent(schema)} FROM ${quoteIdent(
        config.adminRole,
      )}`,
    );
    await client.exec(
      `REVOKE ALL ON ALL TABLES IN SCHEMA ${quoteIdent(schema)} FROM ${quoteIdent(
        config.systemRole,
      )}`,
    );
  }
}

async function applyPostgresCreationAuthorityDefaultDeny(
  client: RuntimeTransactionClient,
  config: ResolvedPostgresRuntimeConfig,
  runtimeLoginRole: string | undefined,
): Promise<void> {
  await client.exec(POSTGRES_SECURITY_SEARCH_PATH_SQL);
  const auditedIdentities = await postgresAppAuthorityIdentityNames(
    client,
    config,
    runtimeLoginRole,
  );
  if (auditedIdentities === undefined) {
    throw new Error(
      'KV433_REACHABILITY_AUDIT: could not enumerate runtime-login/reader/writer assumable-role authority while provisioning (SPEC §10.3).',
    );
  }
  const identityIssues = await postgresAppRoleClosurePostureIssues(
    client,
    config,
    runtimeLoginRole,
  );
  if (identityIssues.length > 0) {
    throw new Error(
      [
        'KV433_RUNTIME_ROLE: Postgres provisioning refuses an unsafe reader/writer/runtime role closure (SPEC §10.3).',
        ...identityIssues.map((issue) => `${issue.code}: ${issue.detail}`),
      ].join(' '),
    );
  }

  // SPEC §10.3 (C9/C10): CREATE/TEMP are graph-expanding privileges. Revoke them from PUBLIC and
  // only the explicitly configured app identities. Undeclared roles may be shared with another app;
  // Kovo never rewrites their ACLs. Their authority remains visible through the full closure audit
  // below and therefore aborts and rolls back provisioning instead.
  const revocationIdentities = [config.readerRole, config.writerRole, runtimeLoginRole]
    .filter((role): role is string => role !== undefined && role !== '')
    .filter((role, index, roles) => roles.indexOf(role) === index);
  const revocationRoles = revocationIdentities.filter(
    (role) => role !== config.adminRole && role !== config.systemRole && !role.startsWith('pg_'),
  );
  const grantees = ['PUBLIC', ...revocationRoles.map(quoteIdent)].join(', ');
  const schemas = await client.query<{ schema_name: string }>(
    [
      'SELECT nspname AS schema_name',
      'FROM pg_catalog.pg_namespace',
      "WHERE nspname <> 'information_schema'",
      "AND nspname !~ '^pg_'",
      'ORDER BY nspname',
    ].join(' '),
  );
  for (const row of schemas.rows) {
    await client.exec(`REVOKE CREATE ON SCHEMA ${quoteIdent(row.schema_name)} FROM ${grantees}`);
  }
  const database = await client.query<{ database_name: string }>(
    'SELECT pg_catalog.current_database() AS database_name',
  );
  const databaseName = database.rows[0]?.database_name;
  if (databaseName === undefined) {
    throw new Error(
      'KV433_REACHABILITY_AUDIT: could not identify the current database while provisioning (SPEC §10.3).',
    );
  }
  await client.exec(
    `REVOKE CREATE, TEMPORARY ON DATABASE ${quoteIdent(databaseName)} FROM ${grantees}`,
  );

  const remaining = await postgresUnexpectedCreationAuthorityRows(client, auditedIdentities);
  if (remaining === undefined) {
    throw new Error(
      'KV433_REACHABILITY_AUDIT: could not verify effective CREATE/TEMPORARY authority after provisioning (SPEC §10.3).',
    );
  }
  if (remaining.length > 0) {
    throw new Error(
      [
        'KV433_UNEXPECTED_PRIVILEGE: Postgres provisioning could not remove app-reachable CREATE/TEMPORARY authority (SPEC §10.3).',
        ...remaining.map(
          (row) =>
            `${row.role_name} has effective ${row.privilege_type} on ${row.object_kind} ${row.object_name}`,
        ),
      ].join(' '),
    );
  }
}

async function applyPostgresReaderColumnPrivileges(
  client: RuntimeTransactionClient,
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
  client: RuntimeTransactionClient,
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
  config: ResolvedPostgresRuntimeConfig,
): Promise<void> {
  const protectedTables = resolveProtectedPostgresTables(tables, metadata);
  const writableTables = postgresWriterWritableTableNames(tables, metadata, protectedTables);
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
        `GRANT INSERT, UPDATE, DELETE ON TABLE ${quoteTable(tableConfig)} TO ${quoteIdent(
          config.writerRole,
        )}`,
      );
      if (publicColumns.length > 0) {
        await client.exec(
          `GRANT SELECT (${publicColumns.map(quoteIdent).join(', ')}) ON TABLE ${quoteTable(
            tableConfig,
          )} TO ${quoteIdent(config.writerRole)}`,
        );
      }
    } else if (authzPolicyDependencyTables.has(tableConfig.name) && publicColumns.length > 0) {
      await client.exec(
        `GRANT SELECT (${publicColumns.map(quoteIdent).join(', ')}) ON TABLE ${quoteTable(
          tableConfig,
        )} TO ${quoteIdent(config.writerRole)}`,
      );
    }
  }
}

async function applyPostgresWriterSequencePrivileges(
  client: RuntimeTransactionClient,
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
  config: ResolvedPostgresRuntimeConfig,
): Promise<void> {
  const protectedTables = resolveProtectedPostgresTables(tables, metadata);
  const writableTables = postgresWriterWritableTableNames(tables, metadata, protectedTables);
  const sequences = await postgresProtectedSerialSequences(
    client,
    postgresDeclaredRelationKeys(tables, writableTables),
  );
  if (sequences === undefined) return;
  for (const sequence of sequences) {
    const [schema, name] = sequence.split('.', 2);
    if (schema === undefined || name === undefined) continue;
    await client.exec(
      `GRANT USAGE ON SEQUENCE ${quoteQualified(schema, name)} TO ${quoteIdent(config.writerRole)}`,
    );
  }
}

async function applyPostgresPrivilegedRolePrivileges(
  client: RuntimeTransactionClient,
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
  config: ResolvedPostgresRuntimeConfig,
): Promise<void> {
  const protectedTables = resolveProtectedPostgresTables(tables, metadata);
  for (const table of tables) {
    const tableConfig = getTableConfig(table);
    const tableName = tableConfig.name;
    await client.exec(
      `REVOKE ALL ON TABLE ${quoteTable(tableConfig)} FROM ${quoteIdent(config.adminRole)}`,
    );
    await client.exec(
      `REVOKE ALL ON TABLE ${quoteTable(tableConfig)} FROM ${quoteIdent(config.systemRole)}`,
    );
    if (config.crossOwnerReadTables.has(tableName)) {
      const secretColumns = metadata.secretColumnNamesByTable.get(tableName) ?? new Set<string>();
      const publicColumns = tableConfig.columns
        .map((column) => column.name)
        .filter((column) => !secretColumns.has(column));
      if (publicColumns.length > 0) {
        await client.exec(
          `GRANT SELECT (${publicColumns.map(quoteIdent).join(', ')}) ON TABLE ${quoteTable(
            tableConfig,
          )} TO ${quoteIdent(config.adminRole)}`,
        );
      }
    }
    if (protectedTables.has(tableName)) {
      await client.exec(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${quoteTable(tableConfig)} TO ${quoteIdent(
          config.systemRole,
        )}`,
      );
    }
  }
  const sequences = await postgresProtectedSerialSequences(
    client,
    new Set(
      [...protectedTables.values()].map((table) =>
        postgresRelationKey(table.schemaName, table.tableName),
      ),
    ),
  );
  if (sequences === undefined) return;
  for (const sequence of sequences) {
    const [schema, name] = sequence.split('.', 2);
    if (schema === undefined || name === undefined) continue;
    await client.exec(
      `GRANT USAGE ON SEQUENCE ${quoteQualified(schema, name)} TO ${quoteIdent(config.systemRole)}`,
    );
  }
}

function postgresWriterWritableTableNames(
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
  protectedTables: ReadonlyMap<string, ProtectedPostgresTable>,
): ReadonlySet<string> {
  const writableTables = new Set<string>();
  for (const tableName of protectedTables.keys()) writableTables.add(tableName);
  const authzPolicyTables = new Set(customAuthzPolicyPredicatesByTable(tables).keys());
  for (const [tableName, classifications] of metadata.authorizationClassificationsByTable) {
    if (
      classifications.some(
        (classification) => classification === 'authzPolicy' && !authzPolicyTables.has(tableName),
      )
    ) {
      writableTables.add(tableName);
    }
  }
  return writableTables;
}

function postgresDeclaredRelationKeys(
  tables: readonly PgTable[],
  tableNames: ReadonlySet<string>,
): ReadonlySet<string> {
  return new Set(
    tables
      .map((table) => getTableConfig(table))
      .filter((config) => tableNames.has(config.name))
      .map((config) => postgresRelationKey(tableSchemaName(config), config.name)),
  );
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
  const tableConfigs = new Map<string, PgTableConfig>();
  for (const table of tables) {
    const config = getTableConfig(table);
    const previous = tableConfigs.get(config.name);
    if (previous !== undefined && tableSchemaName(previous) !== tableSchemaName(config)) {
      throw new Error(
        `KV414: duplicate Postgres table name ${config.name} across schemas is ambiguous in Kovo metadata (SPEC §10.3).`,
      );
    }
    tableConfigs.set(config.name, config);
  }
  const protectedTables = new Map<string, ProtectedPostgresTable>();
  for (const [tableName, owner] of metadata.ownerSourcesByTable) {
    const tableConfig = tableConfigs.get(tableName);
    if (tableConfig === undefined) continue;
    protectedTables.set(tableName, {
      kind: 'owner',
      predicate: `${quoteIdent(owner.columnName)} = current_setting('kovo.principal', true)`,
      schemaName: tableSchemaName(tableConfig),
      tableName,
    });
  }
  for (const [tableName, ownerVia] of metadata.ownerViaSourcesByTable) {
    const tableConfig = tableConfigs.get(tableName);
    if (tableConfig === undefined) continue;
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
      schemaName: tableSchemaName(tableConfig),
      tableName,
    });
  }
  for (const { predicate, tableName } of customAuthzPolicyPredicatesByTable(tables).values()) {
    const tableConfig = tableConfigs.get(tableName);
    if (tableConfig === undefined) continue;
    protectedTables.set(tableName, {
      kind: 'authzPolicy',
      predicate,
      schemaName: tableSchemaName(tableConfig),
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
  client: RuntimeTransactionClient,
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
  config: ResolvedPostgresRuntimeConfig,
): Promise<void> {
  const protectedTables = resolveProtectedPostgresTables(tables, metadata);
  for (const protectedTable of protectedTables.values()) {
    const { predicate, schemaName, tableName } = protectedTable;
    const table = quoteQualified(schemaName, tableName);
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
        `FOR ALL TO ${quoteIdent(config.systemRole)}`,
        'USING (true) WITH CHECK (true)',
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
        `FOR SELECT TO ${quoteIdent(config.adminRole)}`,
        'USING (true)',
      ].join(' '),
    );
  }
}

async function applyPostgresViewSecurityInvoker(
  client: RuntimeTransactionClient,
  tables: readonly PgTable[],
): Promise<void> {
  const appTableNames = new Set(tables.map((table) => getTableConfig(table).name));
  const schemas = postgresSchemaNames(tables);
  if (schemas.length === 0) return;
  const schemaPlaceholders = schemas.map((_, index) => `$${index + 1}`).join(', ');
  const views = await safeQuery<{ table_name: string; table_schema: string }>(
    client,
    [
      'SELECT table_schema, table_name',
      'FROM information_schema.views',
      `WHERE table_schema IN (${schemaPlaceholders})`,
      'ORDER BY table_schema, table_name',
    ].join(' '),
    schemas,
  );
  if (views === undefined) {
    throw new Error(
      'KV433_REACHABILITY_AUDIT: could not enumerate app-schema views before Postgres provision.',
    );
  }
  for (const view of views.rows) {
    const dependencies = await postgresViewDependencies(client, view.table_schema, view.table_name);
    if (dependencies.some((dependency) => appTableNames.has(dependency.table_name))) {
      await client.exec(
        `ALTER VIEW ${quoteQualified(view.table_schema, view.table_name)} SET (security_invoker = true)`,
      );
    }
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

function assertPostgresRuntimeSchemaSupported(tables: readonly PgTable[]): void {
  customAuthzPolicyPredicatesByTable(tables);
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
  const tableConfigs = new Map(
    tables.map((table) => {
      const config = getTableConfig(table);
      return [config.name, config] as const;
    }),
  );
  const addDeclaredTable = (tableName: string): void => {
    const config = tableConfigs.get(tableName);
    if (config !== undefined) {
      allowlisted.add(postgresRelationKey(tableSchemaName(config), config.name));
    }
  };
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
      addDeclaredTable(tableName);
    }
  }
  for (const tableName of customAuthzPolicyDependencyTableNames(tables)) {
    addDeclaredTable(tableName);
  }
  return allowlisted;
}

async function postgresCatalogRelation(
  client: RuntimeTransactionClient,
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
  client: RuntimeTransactionClient,
  schema: string,
  table: string,
): Promise<boolean> {
  const result = await safeQuery(
    client,
    [
      'SELECT 1 FROM pg_policies',
      'WHERE schemaname = $1 AND tablename = $2',
      "AND policyname IN ('kovo_owner_scope', 'kovo_authz_policy', 'kovo_admin_scope')",
    ].join(' '),
    [schema, table],
  );
  return (result?.rows.length ?? 0) > 0;
}

async function postgresBaseTableHasProtectedPosture(
  client: RuntimeTransactionClient,
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
  return postgresHasLiveKovoPolicy(client, relation.table_schema, relation.table_name);
}

function postgresViewIsSecurityInvoker(relation: PostgresCatalogRelation): boolean {
  return (relation.reloptions ?? []).some((option) => option === 'security_invoker=true');
}

async function postgresViewDependencies(
  client: RuntimeTransactionClient,
  schema: string,
  table: string,
): Promise<readonly PostgresViewDependency[]> {
  const usage = await safeQuery<PostgresViewDependency>(
    client,
    [
      'SELECT DISTINCT base_ns.nspname AS table_schema, base.relname AS table_name',
      'FROM pg_class view_rel',
      'JOIN pg_namespace view_ns ON view_ns.oid = view_rel.relnamespace',
      'JOIN pg_rewrite rewrite ON rewrite.ev_class = view_rel.oid',
      'JOIN pg_depend dep ON dep.classid = $3::regclass',
      '  AND dep.objid = rewrite.oid',
      '  AND dep.refclassid = $4::regclass',
      'JOIN pg_class base ON base.oid = dep.refobjid',
      'JOIN pg_namespace base_ns ON base_ns.oid = base.relnamespace',
      'WHERE view_ns.nspname = $1 AND view_rel.relname = $2',
      'AND base.oid <> view_rel.oid',
      "AND base_ns.nspname NOT IN ('pg_catalog', 'information_schema')",
      'ORDER BY base_ns.nspname, base.relname',
    ].join(' '),
    [schema, table, 'pg_rewrite', 'pg_class'],
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

async function safeQuery<Row extends QueryResultRow>(
  client: RuntimeTransactionClient,
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

function postgresSchemaNames(tables: readonly PgTable[]): readonly string[] {
  return [...new Set(tables.map((table) => tableSchemaName(getTableConfig(table))))];
}

function postgresScopedClientOptions(
  config: ResolvedPostgresRuntimeConfig,
  principal: string | undefined,
  roleSetting?: string,
): PostgresScopedClientOptions {
  const options: PostgresScopedClientOptions = {
    role: roleSetting === 'system' ? config.systemRole : config.writerRole,
  };
  if (principal !== undefined) options.principal = principal;
  return options;
}

function postgresReadonlyClientOptions(
  config: ResolvedPostgresRuntimeConfig,
  principal: string | undefined,
  role: string | false,
  roleSetting?: string,
  diagnosticClient?: RuntimeSqlClient,
): PostgresReadonlyClientOptions {
  const options: PostgresReadonlyClientOptions = {
    readerRole:
      roleSetting === 'system'
        ? config.systemRole
        : roleSetting === 'admin'
          ? config.adminRole
          : role,
  };
  if (principal !== undefined) options.principal = principal;
  const rlsDiagnostics = postgresRlsDiagnosticsOptions(config, diagnosticClient);
  if (rlsDiagnostics !== undefined) options.rlsDiagnostics = rlsDiagnostics;
  return options;
}

function postgresRlsDiagnosticsOptions(
  config: ResolvedPostgresRuntimeConfig,
  diagnosticClient: RuntimeSqlClient | undefined,
): PostgresReadonlyClientOptions['rlsDiagnostics'] | undefined {
  if (
    diagnosticClient === undefined ||
    config.driver !== 'pglite' ||
    currentNodeEnv() === 'production'
  ) {
    return undefined;
  }
  return { privilegedClient: diagnosticClient };
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
  if (posture !== undefined) {
    const nonRequestPrincipal = principalFromNonRequestPrincipalPosture(posture);
    if (posture.kind === 'system') return { roleSetting: 'system' };
    if (nonRequestPrincipal === undefined) {
      throw new Error('Framework-minted actAs(id) posture did not provide a principal.');
    }
    return { principal: nonRequestPrincipal };
  }
  const principal = config.principalFromRequest(request);
  return principal === undefined ? {} : { principal };
}

function nonRequestPrincipalPostureFromRequest(request: unknown): string | undefined {
  const posture = nonRequestPrincipalPostureObject(request);
  if (posture === undefined) return undefined;
  return principalFromNonRequestPrincipalPosture(posture);
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

function quoteQualified(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
