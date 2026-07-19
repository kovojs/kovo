import { createHash, randomBytes } from 'node:crypto';
import { types as nodeUtilTypes } from 'node:util';

import { PGlite } from '@electric-sql/pglite';
import {
  createBoundedRuntimeAuditCollector,
  mintFrameworkDurableReplayStoreReceipt,
} from '@kovojs/core/internal/security-markers';
import type { KovoRuntimeDbMetadata } from '@kovojs/drizzle';
import { buildRelations, type AnyRelations, type SQL } from 'drizzle-orm';
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import {
  Client,
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryConfig,
  type QueryResultRow,
} from 'pg';

import {
  createPostgresSystemDb,
  registerPostgresAppRuntimeDb,
  type KovoPostgresSystemDb,
} from '@kovojs/server/internal/postgres-capability';
import { runtimeEnvironmentValue } from '@kovojs/server/internal/runtime-environment';

import {
  declareSystemPrincipal,
  principalFromNonRequestPrincipalPosture,
  type NonRequestPrincipalPosture,
} from './auth-principal.js';
import {
  snapshotAuditJustification,
  snapshotAuditReason,
  snapshotAuditText,
} from './audit-justification.js';
import { registerEgressDatabaseUrl } from './egress-bootstrap.js';
import { classifyHost, createDatabaseEgressSocket, databaseEgressUrlFacts } from './egress.js';
import { runExactlyOnceAdapter } from './exactly-once-continuation.js';
import { egressDecodeURIComponent, egressUrl, egressUrlUsername } from './egress-intrinsics.js';
import {
  createDeclaredWriteDb,
  createFrameworkAuthorizationCensusDb,
  createPostgresReadonlyClient,
  createPostgresScopedClient,
  readonlyDb,
  type PostgresReadonlyClientOptions,
  type PostgresScopedClientOptions,
  type Reader,
} from './managed-db.js';
import {
  createFrameworkManagedDbProvider,
  requestPassedRoleGuard,
  type FrameworkManagedDbProvider,
} from './guards.js';
import {
  createPostgresCapabilityReplayStoreFromExecutor,
  createPostgresMutationReplayStoreFromExecutor,
  createPostgresWebhookReplayStoreFromExecutor,
  POSTGRES_REPLAY_MAX_ENTRIES,
  POSTGRES_REPLAY_MAX_RESPONSE_BODY_STORAGE_BYTES,
  POSTGRES_REPLAY_MAX_RESPONSE_HEADER_BYTES,
  POSTGRES_REPLAY_TABLE,
  POSTGRES_REPLAY_WATERMARK_TABLE,
  releasePostgresPendingReplayFromExecutor,
  type PostgresPendingReplayReleaseOptions,
  type PostgresPendingReplayTarget,
} from './postgres-replay.js';
import type { CapabilityReplayStore } from './capability-url.js';
import type { MutationReplayStore } from './replay.js';
import {
  forEachReadonlyMapEntry,
  forEachReadonlySetValue,
} from './readonly-collection-snapshot.js';
import {
  securityArrayIsArray,
  securityArrayJoin,
  securityArraySort,
  securityJsonStringify,
  securityObjectKeys,
  securityRegExpTest,
  securityString,
  securityStringIncludes,
  securityStringReplaceAll,
  securityStringSplit,
  securityStringStartsWith,
  securityStringTrim,
} from './response-security-intrinsics.js';
import { createSecretBoxingReadDb } from './secret-read-boundary.js';
import { WEBHOOK_REPLAY_HORIZON_MS, type WebhookReplayStore } from './webhook.js';
import {
  createWitnessMap,
  createWitnessSet,
  createWitnessWeakMap,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetPrototypeOf,
  witnessGetOwnPropertyDescriptor,
  witnessObjectIs,
  witnessOwnKeys,
  witnessReflectApply,
  witnessMapGet,
  witnessMapForEach,
  witnessMapHas,
  witnessMapSet,
  witnessSetAdd,
  witnessSetDelete,
  witnessSetHas,
  witnessSetForEach,
  witnessSetSize,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';
import { extractCompilerBoundKovoRuntimeDbMetadata } from './generated-table-security-registry.js';
import { ensureRecurringTaskSchema } from './task-cron.js';
import { assertManagedSqlParserAuthorityReady } from './sql-parser-authority-bootstrap.js';
import { parseWithIsolatedSqlParser } from './sql-parser-authority.js';
import {
  createDurableTaskSqlExecutor,
  ensureDurableTaskSchema,
  grantDurableTaskWriterRole,
} from './task-queue.js';

const postgresIsProxy = nodeUtilTypes.isProxy;
const postgresModuleNamespaceTag = Symbol.toStringTag;
const DEFAULT_DATA_DIR = '.kovo/pglite';
const DEFAULT_ADMIN_ROLE = 'kovo_admin';
const DEFAULT_READER_ROLE = 'kovo_reader';
const DEFAULT_SYSTEM_ROLE = 'kovo_system';
const DEFAULT_WRITER_ROLE = 'kovo_writer';
const MIGRATIONS_TABLE = 'kovo_migrations';
const SCHEMA_STATE_TABLE = 'kovo_schema_state';
const POSTGRES_DATABASE_INSTANCE_KEY = 'database_instance_id';
const POSTGRES_DATABASE_INSTANCE_ID_PATTERN = /^[0-9a-f]{64}$/u;
const postgresPinnedNodePools = createWitnessWeakMap<object, true>();
const postgresPinnedNodeClients = createWitnessWeakMap<object, true>();
const postgresNodeClientReleaseValues = createWitnessWeakMap<object, Function>();
const postgresAppRuntimeOptionSnapshots = createWitnessWeakMap<
  object,
  Readonly<KovoPostgresAppRuntimeOptions>
>();
const POSTGRES_APP_RUNTIME_OPTION_KEYS = postgresStringSet([
  'adminDatabaseUrl',
  'adminRole',
  'crossOwnerReadTables',
  'databaseUrl',
  'dataDir',
  'driver',
  'postureCheck',
  'principalFromRequest',
  'provisionOnBoot',
  'publicRelations',
  'readerRole',
  'schema',
  'seedSql',
  'systemDatabaseUrl',
  'systemRole',
  'writerRole',
]);
const FRAMEWORK_INTERNAL_REACHABLE_TABLES = postgresStringSet([
  '_kovo_jobs',
  POSTGRES_REPLAY_TABLE,
  POSTGRES_REPLAY_WATERMARK_TABLE,
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
const POSTGRES_BENIGN_PREDEFINED_ROLES: ReadonlySet<string> = createWitnessSet<string>();
// SPEC §10.3 (C10): the runtime session accepts only pinned-driver UTF-8 negotiation and
// observability naming from client/role/database startup configuration. Every other explicit GUC
// is security-relevant until classified: PostgreSQL applies superuser-authored role/database
// settings to a non-superuser login, including session_replication_role=replica.
const POSTGRES_BENIGN_EXTERNAL_SESSION_SETTINGS: ReadonlySet<string> = postgresStringSet([
  'application_name',
  'client_encoding',
]);
const POSTGRES_EXTERNAL_SESSION_SETTING_SOURCES: ReadonlySet<string> = postgresStringSet([
  'client',
  'database',
  'database user',
  'user',
]);
// PostgreSQL 18's complete GucSource_Names display set. `default` intentionally represents both
// PGC_S_DEFAULT and PGC_S_DYNAMIC_DEFAULT. A future display value is unclassified and fails closed.
const POSTGRES_RECOGNIZED_SETTING_SOURCES: ReadonlySet<string> = postgresStringSet([
  'client',
  'command line',
  'configuration file',
  'database',
  'database user',
  'default',
  'environment variable',
  'global',
  'interactive',
  'override',
  'session',
  'test',
  'user',
]);
const POSTGRES_SERVER_SETTING_SOURCES: ReadonlySet<string> = postgresStringSet([
  'command line',
  'configuration file',
  'default',
  'environment variable',
  'global',
  'override',
]);
const POSTGRES_BENIGN_PERSISTED_SETTINGS: ReadonlySet<string> = postgresStringSet([
  'application_name',
]);
const POSTGRES_CLASSIFIED_ROLE_COLUMNS = postgresStringSet([
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
  'WITH app_roles(role_name) AS (SELECT unnest($1::text[])),',
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
];
const POSTGRES_REACHABLE_RELATIONS_QUERY = postgresJoin(POSTGRES_REACHABLE_RELATIONS_SQL, ' ');
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
type CompilerBoundAuthzPolicy =
  NonNullable<KovoRuntimeDbMetadata['compilerBoundAuthzPoliciesByTable']> extends ReadonlyMap<
    string,
    infer Policy
  >
    ? Policy
    : never;

const POSTGRES_POLICY_DIALECT = new PgDialect();
const postgresPolicySqlToQuery = capturePostgresPolicySqlToQuery();
const postgresHashMethodSource = createHash('sha256');
const postgresHashUpdate = capturePostgresCallable(
  postgresHashMethodSource,
  'update',
  'Postgres migration hash update',
) as ReturnType<typeof createHash>['update'];
const postgresHashDigest = capturePostgresCallable(
  postgresHashMethodSource,
  'digest',
  'Postgres migration hash digest',
) as ReturnType<typeof createHash>['digest'];
const postgresPgliteClose = capturePostgresCallable(PGlite.prototype, 'close', 'PGlite close');
const postgresPgliteExec = capturePostgresCallable(PGlite.prototype, 'exec', 'PGlite exec');
const postgresPgliteQuery = capturePostgresCallable(PGlite.prototype, 'query', 'PGlite query');
const postgresPgliteTransaction = capturePostgresCallable(
  PGlite.prototype,
  'transaction',
  'PGlite transaction',
);
const postgresPoolEnd = capturePostgresCallable(Pool.prototype, 'end', 'node-postgres Pool.end');
const postgresPoolQuery = capturePostgresCallable(
  Pool.prototype,
  'query',
  'node-postgres Pool.query',
);
const postgresPoolConnect = capturePostgresCallable(
  Pool.prototype,
  'connect',
  'node-postgres Pool.connect',
);
const postgresClientQuery = capturePostgresCallable(
  Client.prototype,
  'query',
  'node-postgres Client.query',
);
const postgresPoolPrototypeMethods = capturePostgresPrototypeMethods(
  Pool.prototype,
  'node-postgres Pool',
  'newClient',
);
const postgresClientPrototypeMethods = capturePostgresPrototypeMethods(
  Client.prototype,
  'node-postgres Client',
  '_pulseQueryQueue',
);

function capturePostgresPolicySqlToQuery(): PgDialect['sqlToQuery'] {
  const descriptor = witnessGetOwnPropertyDescriptor(PgDialect.prototype, 'sqlToQuery');
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'function'
  ) {
    throw new TypeError('Postgres policy SQL renderer must be an own-data method.');
  }
  return descriptor.value as PgDialect['sqlToQuery'];
}

function capturePostgresCallable(target: object, property: PropertyKey, label: string): Function {
  let owner: object | null = target;
  while (owner !== null) {
    if (postgresIsProxy(owner)) throw new TypeError(`${label} owner must not be a Proxy.`);
    const descriptor = witnessGetOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new TypeError(`${label} must be an own-data method.`);
      }
      return descriptor.value;
    }
    owner = witnessGetPrototypeOf(owner);
  }
  throw new TypeError(`${label} is unavailable.`);
}

function capturePostgresOwnCallable(
  target: object,
  property: PropertyKey,
  label: string,
): Function {
  if (postgresIsProxy(target)) throw new TypeError(`${label} owner must not be a Proxy.`);
  const descriptor = witnessGetOwnPropertyDescriptor(target, property);
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'function'
  ) {
    throw new TypeError(`${label} must be a fresh own-data method.`);
  }
  return descriptor.value;
}

function capturePostgresPrototypeMethods(
  prototype: object,
  label: string,
  terminalProperty: PropertyKey,
): ReadonlyMap<PropertyKey, Function> {
  if (postgresIsProxy(prototype)) throw new TypeError(`${label} prototype must not be a Proxy.`);
  const methods = createWitnessMap<PropertyKey, Function>();
  let owner: object | null = prototype;
  while (owner !== null) {
    if (postgresIsProxy(owner)) throw new TypeError(`${label} method owner must not be a Proxy.`);
    const keys = witnessOwnKeys(owner);
    const keyCount = postgresDenseArrayLength(keys, `${label} prototype keys`);
    for (let index = 0; index < keyCount; index += 1) {
      const key = postgresDenseArrayValue(keys, index, `${label} prototype keys`);
      if (key === 'constructor' || witnessMapHas(methods, key)) continue;
      const descriptor = witnessGetOwnPropertyDescriptor(owner, key);
      if (
        descriptor !== undefined &&
        'value' in descriptor &&
        typeof descriptor.value === 'function'
      ) {
        witnessMapSet(methods, key, descriptor.value);
      }
    }
    if (witnessMapHas(methods, terminalProperty)) break;
    owner = witnessGetPrototypeOf(owner);
  }
  if (!witnessMapHas(methods, terminalProperty)) {
    throw new TypeError(`${label}.${String(terminalProperty)} is unavailable.`);
  }
  return methods;
}

function postgresSha256(value: string): string {
  const hash = createHash('sha256');
  witnessReflectApply(postgresHashUpdate, hash, [value]);
  return witnessReflectApply<string>(postgresHashDigest, hash, ['hex']);
}

if (postgresSha256('kovo') !== 'b8bf1c0dec7311f45820565ff15a657a416c158950db5206552f6198b868b52f') {
  throw new TypeError('Postgres migration SHA-256 controls failed their known-vector proof.');
}

function postgresDenseArrayLength(values: readonly unknown[], label = 'Postgres array'): number {
  if (postgresIsProxy(values)) {
    throw new TypeError(`${label} must not be a Proxy.`);
  }
  const descriptor = witnessGetOwnPropertyDescriptor(values, 'length');
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'number' ||
    descriptor.value < 0 ||
    descriptor.value % 1 !== 0
  ) {
    throw new TypeError(`${label} must expose a bounded own data length.`);
  }
  return descriptor.value;
}

function postgresDenseArrayValue<Value>(
  values: readonly Value[],
  index: number,
  label = 'Postgres array',
): Value {
  const descriptor = witnessGetOwnPropertyDescriptor(values, index);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`${label} must contain dense own data elements.`);
  }
  return descriptor.value;
}

function appendPostgresValue<Value>(values: Value[], value: Value): void {
  const length = postgresDenseArrayLength(values);
  witnessDefineProperty(values, length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function postgresMapDense<Input, Output>(
  values: readonly Input[],
  map: (value: Input, index: number) => Output,
  label = 'Postgres mapped array',
): Output[] {
  const output: Output[] = [];
  const length = postgresDenseArrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    appendPostgresValue(output, map(postgresDenseArrayValue(values, index, label), index));
  }
  return output;
}

function appendPostgresDenseValues<Value>(
  target: Value[],
  source: readonly Value[],
  label = 'Postgres appended array',
): void {
  const length = postgresDenseArrayLength(source, label);
  for (let index = 0; index < length; index += 1) {
    appendPostgresDenseValue(target, postgresDenseArrayValue(source, index, label));
  }
}

function postgresExtractedCollectionForEach(source: object, label: string): Function {
  if (postgresIsProxy(source)) throw new TypeError(`${label} must not be a Proxy.`);
  const descriptor = witnessGetOwnPropertyDescriptor(source, 'forEach');
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'function'
  ) {
    throw new TypeError(`${label} must expose a frozen own-data forEach method.`);
  }
  return descriptor.value;
}

function snapshotExtractedReadonlySet<Value>(
  source: ReadonlySet<Value>,
  label: string,
): Set<Value> {
  const output = createWitnessSet<Value>();
  const forEach = postgresExtractedCollectionForEach(source, label);
  witnessReflectApply(forEach, source, [
    (value: Value) => {
      witnessSetAdd(output, value);
    },
  ]);
  return output;
}

function snapshotExtractedReadonlyMap<Key, Value, OutputValue = Value>(
  source: ReadonlyMap<Key, Value>,
  label: string,
  snapshotValue: (value: Value, key: Key) => OutputValue = (value) =>
    value as unknown as OutputValue,
): Map<Key, OutputValue> {
  const output = createWitnessMap<Key, OutputValue>();
  const forEach = postgresExtractedCollectionForEach(source, label);
  witnessReflectApply(forEach, source, [
    (value: Value, key: Key) => {
      witnessMapSet(output, key, snapshotValue(value, key));
    },
  ]);
  return output;
}

function snapshotExtractedKovoRuntimeDbMetadata(
  metadata: KovoRuntimeDbMetadata,
): KovoRuntimeDbMetadata {
  const compilerBoundAuthzPoliciesByTable = postgresOwnDataValue(
    metadata as unknown as Record<PropertyKey, unknown>,
    'compilerBoundAuthzPoliciesByTable',
  ) as ReadonlyMap<string, CompilerBoundAuthzPolicy> | undefined;
  return witnessFreeze({
    allColumnKeys: snapshotExtractedReadonlySet(
      metadata.allColumnKeys,
      'Kovo runtime all-column keys',
    ),
    authorizationClassificationsByTable: snapshotExtractedReadonlyMap(
      metadata.authorizationClassificationsByTable,
      'Kovo runtime authorization classifications',
      (classifications, tableName) =>
        witnessFreeze(
          postgresMapDense(
            classifications,
            (classification) => classification,
            `Kovo runtime authorization classifications for ${tableName}`,
          ),
        ),
    ),
    ...(compilerBoundAuthzPoliciesByTable === undefined
      ? {}
      : {
          compilerBoundAuthzPoliciesByTable: snapshotExtractedReadonlyMap(
            compilerBoundAuthzPoliciesByTable,
            'Kovo compiler-bound authorization policies',
            snapshotExtractedAuthzPolicy,
          ),
        }),
    columnSources: snapshotExtractedReadonlyMap(
      metadata.columnSources,
      'Kovo runtime column sources',
    ),
    governedColumnKeysByTable: snapshotExtractedReadonlyMap(
      metadata.governedColumnKeysByTable,
      'Kovo runtime governed column keys',
      (keys, tableName) =>
        snapshotExtractedReadonlySet(keys, `Kovo runtime governed column keys for ${tableName}`),
    ),
    governedColumnNamesByTable: snapshotExtractedReadonlyMap(
      metadata.governedColumnNamesByTable,
      'Kovo runtime governed column names',
      (names, tableName) =>
        snapshotExtractedReadonlySet(names, `Kovo runtime governed column names for ${tableName}`),
    ),
    ownerSourcesByTable: snapshotExtractedReadonlyMap(
      metadata.ownerSourcesByTable,
      'Kovo runtime owner sources',
    ),
    ownerViaSourcesByTable: snapshotExtractedReadonlyMap(
      metadata.ownerViaSourcesByTable,
      'Kovo runtime owner-via sources',
    ),
    schemaTableNames: snapshotExtractedReadonlySet(
      metadata.schemaTableNames,
      'Kovo runtime schema table names',
    ),
    secretColumnKeys: snapshotExtractedReadonlySet(
      metadata.secretColumnKeys,
      'Kovo runtime secret column keys',
    ),
    secretColumnNames: snapshotExtractedReadonlySet(
      metadata.secretColumnNames,
      'Kovo runtime secret column names',
    ),
    secretColumnKeysByTable: snapshotExtractedReadonlyMap(
      metadata.secretColumnKeysByTable,
      'Kovo runtime secret column keys by table',
      (keys, tableName) =>
        snapshotExtractedReadonlySet(keys, `Kovo runtime secret column keys for ${tableName}`),
    ),
    secretColumnNamesByTable: snapshotExtractedReadonlyMap(
      metadata.secretColumnNamesByTable,
      'Kovo runtime secret column names by table',
      (names, tableName) =>
        snapshotExtractedReadonlySet(names, `Kovo runtime secret column names for ${tableName}`),
    ),
    secretTableNames: snapshotExtractedReadonlySet(
      metadata.secretTableNames,
      'Kovo runtime secret table names',
    ),
  });
}

function snapshotExtractedAuthzPolicy(
  value: CompilerBoundAuthzPolicy,
  tableName: string,
): CompilerBoundAuthzPolicy {
  if (
    typeof value !== 'object' ||
    value === null ||
    securityArrayIsArray(value) ||
    postgresIsProxy(value)
  ) {
    throw new TypeError(
      `Kovo compiler-bound authorization policy for ${tableName} must be an own-data record.`,
    );
  }
  const record = value as unknown as Record<PropertyKey, unknown>;
  const kind = postgresOwnDataValue(record, 'kind');
  if (kind === 'guard-assertion') {
    const justification = postgresOwnDataValue(record, 'justification');
    if (typeof justification !== 'string') {
      throw new TypeError(`Kovo compiler-bound authorization policy for ${tableName} is invalid.`);
    }
    return witnessFreeze({ justification, kind });
  }
  if (kind === 'sql') {
    const sql = postgresOwnDataValue(record, 'sql');
    if (typeof sql !== 'string') {
      throw new TypeError(`Kovo compiler-bound authorization policy for ${tableName} is invalid.`);
    }
    return witnessFreeze({ kind, sql });
  }
  throw new TypeError(`Kovo compiler-bound authorization policy for ${tableName} is invalid.`);
}

function postgresFilterDense<Value>(
  values: readonly Value[],
  include: (value: Value, index: number) => boolean,
  label = 'Postgres filtered array',
): Value[] {
  const output: Value[] = [];
  const length = postgresDenseArrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    const value = postgresDenseArrayValue(values, index, label);
    if (include(value, index)) appendPostgresValue(output, value);
  }
  return output;
}

function postgresSomeDense<Value>(
  values: readonly Value[],
  predicate: (value: Value, index: number) => boolean,
  label = 'Postgres searched array',
): boolean {
  const length = postgresDenseArrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    if (predicate(postgresDenseArrayValue(values, index, label), index)) return true;
  }
  return false;
}

function postgresJoin(values: readonly unknown[], separator: string): string {
  return securityArrayJoin(values, separator);
}

function postgresStringSet(values: readonly string[]): Set<string> {
  const output = createWitnessSet<string>();
  const length = postgresDenseArrayLength(values, 'Postgres string set source');
  for (let index = 0; index < length; index += 1) {
    witnessSetAdd(output, postgresDenseArrayValue(values, index, 'Postgres string set source'));
  }
  return output;
}

function postgresSetValues<Value>(values: ReadonlySet<Value>): Value[] {
  const output: Value[] = [];
  forEachReadonlySetValue(values, 'Postgres readonly set', (value) =>
    appendPostgresValue(output, value),
  );
  return output;
}

function postgresReadonlySetHas<Value>(
  values: ReadonlySet<Value>,
  expected: Value,
  label: string,
): boolean {
  let found = false;
  forEachReadonlySetValue(values, label, (value) => {
    if (witnessObjectIs(value, expected)) found = true;
  });
  return found;
}

function postgresForEachReadonlyMapEntry<Key, Value>(
  values: ReadonlyMap<Key, Value>,
  label: string,
  callback: (value: Value, key: Key) => void,
): void {
  forEachReadonlyMapEntry<Key, Value>(values, label, callback);
}

function postgresMapValues<Key, Value>(values: ReadonlyMap<Key, Value>): Value[] {
  const output: Value[] = [];
  postgresForEachReadonlyMapEntry(values, 'Postgres readonly map', (value) =>
    appendPostgresValue(output, value),
  );
  return output;
}

function postgresReadonlyMapValue<Key, Value>(
  values: ReadonlyMap<Key, Value>,
  key: Key,
  label: string,
): Value | undefined {
  let result: Value | undefined;
  postgresForEachReadonlyMapEntry(values, label, (value, candidate) => {
    if (witnessObjectIs(candidate, key)) result = value;
  });
  return result;
}

function postgresOwnDataValues(values: object): unknown[] {
  const output: unknown[] = [];
  const keys = witnessOwnKeys(values);
  const length = postgresDenseArrayLength(keys, 'Postgres object key snapshot');
  for (let index = 0; index < length; index += 1) {
    const key = postgresDenseArrayValue(keys, index, 'Postgres object key snapshot');
    if (typeof key !== 'string') continue;
    const descriptor = witnessGetOwnPropertyDescriptor(values, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Postgres object values must use own data properties.');
    }
    appendPostgresValue(output, descriptor.value);
  }
  return output;
}

function postgresOwnDataEntries(values: object): [string, unknown][] {
  const output: [string, unknown][] = [];
  const keys = witnessOwnKeys(values);
  const length = postgresDenseArrayLength(keys, 'Postgres object entry keys');
  for (let index = 0; index < length; index += 1) {
    const key = postgresDenseArrayValue(keys, index, 'Postgres object entry keys');
    if (typeof key !== 'string') continue;
    const descriptor = witnessGetOwnPropertyDescriptor(values, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Postgres object entries must use own data properties.');
    }
    appendPostgresValue(output, [key, descriptor.value]);
  }
  return output;
}

/**
 * Capture a genuine ESM schema namespace as one immutable own-data record.
 *
 * Vite represents ESM live bindings as accessors, while the Postgres runtime deliberately rejects
 * ordinary accessor-backed schema objects. This validating constructor accepts the immutable
 * `Module` namespace shape emitted natively or by the production bundler, verifies each live binding
 * is stable while captured, and returns the exact snapshot shared by runtime DDL/RLS and adapter
 * construction (SPEC §6.6/§10.3).
 *
 * @param namespace - A namespace produced by `import * as schema from './schema.js'`.
 * @returns A frozen null-prototype record containing own data properties for every schema export.
 */
export function postgresSchemaModule<Schema extends object>(namespace: Schema): Readonly<Schema> {
  if (typeof namespace !== 'object' || namespace === null) {
    throw new TypeError('Postgres schema module namespace must be an object.');
  }
  if (postgresIsProxy(namespace)) {
    throw new TypeError('Postgres schema module namespace must not be a Proxy.');
  }
  const tag = witnessGetOwnPropertyDescriptor(namespace, postgresModuleNamespaceTag);
  if (tag === undefined) {
    // Accessor-backed objects receive no exception without the immutable namespace brand. This
    // keeps ordinary author objects on the runtime's strict own-data path.
    return postgresOwnDataSnapshot(namespace, 'Postgres bundled schema module namespace');
  }
  if (
    !('value' in tag) ||
    tag.value !== 'Module' ||
    tag.configurable !== false ||
    tag.enumerable !== false ||
    tag.writable !== false
  ) {
    throw new TypeError('Postgres schema module namespace must carry the immutable Module tag.');
  }

  const snapshot = witnessCreateNullRecord<unknown>();
  const keys = witnessOwnKeys(namespace);
  const keyCount = postgresDenseArrayLength(keys, 'Postgres schema module namespace keys');
  for (let index = 0; index < keyCount; index += 1) {
    const key = postgresDenseArrayValue(keys, index, 'Postgres schema module namespace keys');
    if (key === postgresModuleNamespaceTag) continue;
    if (typeof key !== 'string') {
      throw new TypeError('Postgres schema module namespace must not expose extra symbols.');
    }
    const descriptor = witnessGetOwnPropertyDescriptor(namespace, key);
    if (descriptor === undefined || descriptor.enumerable !== true) {
      throw new TypeError(`Postgres schema module namespace export ${key} must be enumerable.`);
    }

    let exportValue: unknown;
    if ('value' in descriptor) {
      exportValue = descriptor.value;
    } else {
      if (typeof descriptor.get !== 'function' || descriptor.set !== undefined) {
        throw new TypeError(
          `Postgres schema module namespace export ${key} must be a read-only live binding.`,
        );
      }
      let repeated: unknown;
      try {
        // oxlint-disable-next-line typescript/unbound-method -- Invoked with the namespace receiver through the pinned witness.
        exportValue = witnessReflectApply(descriptor.get, namespace, []);
        // oxlint-disable-next-line typescript/unbound-method -- Repeated with the same receiver to reject a changing live binding.
        repeated = witnessReflectApply(descriptor.get, namespace, []);
      } catch {
        throw new TypeError(
          `Postgres schema module namespace export ${key} could not be snapshotted.`,
        );
      }
      if (!witnessObjectIs(exportValue, repeated)) {
        throw new TypeError(
          `Postgres schema module namespace export ${key} changed while it was snapshotted.`,
        );
      }
    }

    witnessDefineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      value: exportValue,
      writable: true,
    });
  }
  return witnessFreeze(snapshot) as Readonly<Schema>;
}

function postgresOwnDataSnapshot<Value extends object>(value: Value, label: string): Value {
  // A Proxy controls ownKeys and property descriptors themselves, so descriptor-first copying is
  // not sufficient for security-authoritative schema/config carriers. Reject it before the single
  // immutable snapshot rather than trusting an attacker-selected partial view (SPEC §10.3).
  if (postgresIsProxy(value)) {
    throw new TypeError(`${label} must not be a Proxy.`);
  }
  const snapshot = witnessCreateNullRecord<unknown>();
  const keys = witnessOwnKeys(value);
  const keyCount = postgresDenseArrayLength(keys, `${label} keys`);
  for (let index = 0; index < keyCount; index += 1) {
    const key = postgresDenseArrayValue(keys, index, `${label} keys`);
    const descriptor = witnessGetOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`${label} properties must be own data.`);
    }
    witnessDefineProperty(snapshot, key, {
      configurable: true,
      enumerable: descriptor.enumerable === true,
      value: descriptor.value,
      writable: true,
    });
  }
  return witnessFreeze(snapshot) as Value;
}

function snapshotPostgresRuntimeConfigInput<Input extends PostgresRuntimeConfigInput>(
  input: Input,
  overrides?: Partial<PostgresRuntimeConfigInput>,
): Input {
  if (!isRecord(input)) {
    throw new TypeError('KV433: Postgres runtime options must be an own-data object.');
  }
  const storedSnapshot = witnessWeakMapGet(postgresAppRuntimeOptionSnapshots, input);
  const source =
    storedSnapshot === undefined
      ? postgresOwnDataSnapshot(input, 'Postgres runtime options')
      : storedSnapshot;
  const snapshot = witnessCreateNullRecord<unknown>();
  const keys = witnessOwnKeys(source);
  const keyCount = postgresDenseArrayLength(keys, 'Postgres runtime option keys');
  for (let index = 0; index < keyCount; index += 1) {
    const key = postgresDenseArrayValue(keys, index, 'Postgres runtime option keys');
    const descriptor = witnessGetOwnPropertyDescriptor(source, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Postgres runtime option properties must remain own data.');
    }
    witnessDefineProperty(snapshot, key, {
      configurable: true,
      enumerable: descriptor.enumerable === true,
      value: descriptor.value,
      writable: true,
    });
  }
  if (overrides !== undefined) {
    const overrideKeys = witnessOwnKeys(overrides);
    const overrideCount = postgresDenseArrayLength(overrideKeys, 'Postgres runtime override keys');
    for (let index = 0; index < overrideCount; index += 1) {
      const key = postgresDenseArrayValue(overrideKeys, index, 'Postgres runtime override keys');
      const descriptor = witnessGetOwnPropertyDescriptor(overrides, key);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new TypeError('Postgres runtime override properties must be own data.');
      }
      witnessDefineProperty(snapshot, key, {
        configurable: true,
        enumerable: descriptor.enumerable === true,
        value: descriptor.value,
        writable: true,
      });
    }
  }
  const schema = postgresOwnDataValue(snapshot, 'schema');
  if (!isRecord(schema)) {
    throw new TypeError('KV433: Postgres runtime schema must be an own-data object.');
  }
  witnessDefineProperty(snapshot, 'schema', {
    configurable: true,
    enumerable: true,
    value: postgresOwnDataSnapshot(schema, 'Postgres runtime schema'),
    writable: true,
  });
  return witnessFreeze(snapshot) as Input;
}

function snapshotPublicPostgresAppRuntimeOptions(
  input: KovoPostgresAppRuntimeOptions,
): Readonly<KovoPostgresAppRuntimeOptions> {
  if (!isRecord(input)) {
    throw new TypeError('KV433: postgresAppRuntimeOptions() requires an own-data object.');
  }
  const source = postgresOwnDataSnapshot(input, 'Postgres app runtime options');
  const snapshot = witnessCreateNullRecord<unknown>();
  const keys = witnessOwnKeys(source);
  const keyCount = postgresDenseArrayLength(keys, 'Postgres app runtime option keys');
  let hasSchema = false;
  for (let index = 0; index < keyCount; index += 1) {
    const key = postgresDenseArrayValue(keys, index, 'Postgres app runtime option keys');
    if (typeof key !== 'string' || !witnessSetHas(POSTGRES_APP_RUNTIME_OPTION_KEYS, key)) {
      throw new TypeError(
        `KV433: postgresAppRuntimeOptions() does not accept option ${securityString(key)} (SPEC §10.3).`,
      );
    }
    const descriptor = witnessGetOwnPropertyDescriptor(source, key);
    if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError(
        `KV433: postgresAppRuntimeOptions() option ${key} must be an enumerable own-data property.`,
      );
    }
    const value = snapshotPublicPostgresAppRuntimeOptionValue(key, descriptor.value);
    witnessDefineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
    if (key === 'schema') hasSchema = true;
  }
  if (!hasSchema) {
    throw new TypeError('KV433: postgresAppRuntimeOptions() requires schema (SPEC §10.3).');
  }
  return witnessFreeze(snapshot) as Readonly<KovoPostgresAppRuntimeOptions>;
}

function snapshotPublicPostgresAppRuntimeOptionValue(key: string, value: unknown): unknown {
  if (key === 'schema') {
    if (!isRecord(value)) {
      throw new TypeError('KV433: postgresAppRuntimeOptions() schema must be an own-data object.');
    }
    return postgresOwnDataSnapshot(value, 'Postgres app runtime schema');
  }
  if (key === 'seedSql') {
    return snapshotPublicPostgresAppRuntimeSeedSql(value);
  }
  if (key === 'crossOwnerReadTables') {
    return snapshotPublicPostgresAppRuntimeArray(
      value,
      'Postgres app runtime crossOwnerReadTables',
      true,
    );
  }
  if (key === 'publicRelations') {
    return snapshotPublicPostgresAppRuntimeArray(
      value,
      'Postgres app runtime publicRelations',
      false,
    );
  }
  if (key === 'postureCheck' && value !== undefined) {
    if (!isRecord(value) || securityArrayIsArray(value)) {
      throw new TypeError(
        'KV433: postgresAppRuntimeOptions() postureCheck must be an own-data object.',
      );
    }
    return postgresOwnDataSnapshot(value, 'Postgres app runtime postureCheck');
  }
  return value;
}

function snapshotPublicPostgresAppRuntimeSeedSql(value: unknown): unknown {
  if (value === undefined || typeof value === 'string') return value;
  return snapshotPublicPostgresAppRuntimeArray(value, 'Postgres app runtime seedSql', true);
}

function snapshotPublicPostgresAppRuntimeArray(
  value: unknown,
  label: string,
  requireStrings: boolean,
): readonly unknown[] | undefined {
  if (value === undefined) return undefined;
  if (!securityArrayIsArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  const snapshot: unknown[] = [];
  const length = postgresDenseArrayLength(value, label);
  for (let index = 0; index < length; index += 1) {
    const entry = postgresDenseArrayValue(value, index, label);
    if (requireStrings && typeof entry !== 'string') {
      throw new TypeError(`${label} entries must be strings.`);
    }
    appendPostgresValue(snapshot, entry);
  }
  return witnessFreeze(snapshot);
}

function snapshotPostgresQueryRows<Row extends QueryResultRow>(
  rows: readonly Row[],
  label: string,
): Row[] {
  if (postgresIsProxy(rows)) {
    throw new TypeError(`${label} must not be a Proxy.`);
  }
  const snapshot: Row[] = [];
  const rowCount = postgresDenseArrayLength(rows, label);
  for (let index = 0; index < rowCount; index += 1) {
    const row = postgresDenseArrayValue(rows, index, label);
    if (!isRecord(row)) {
      throw new TypeError(`${label} entries must be own-data records.`);
    }
    appendPostgresValue(snapshot, postgresOwnDataSnapshot(row, `${label} entry`) as Row);
  }
  return snapshot;
}

function snapshotPostgresQueryParams(
  params: readonly unknown[] | undefined,
): unknown[] | undefined {
  if (params === undefined) return undefined;
  if (postgresIsProxy(params)) {
    throw new TypeError('Postgres query parameters must not be a Proxy.');
  }
  const snapshot: unknown[] = [];
  const paramCount = postgresDenseArrayLength(params, 'Postgres query parameters');
  for (let index = 0; index < paramCount; index += 1) {
    appendPostgresValue(
      snapshot,
      postgresDenseArrayValue(params, index, 'Postgres query parameters'),
    );
  }
  return snapshot;
}

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
  /** Privileged, framework-owned client used only for exact boot-posture catalog proofs. */
  postureSql: RuntimeSqlClient;
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

/**
 * Capture generated Postgres runtime options through framework-owned intrinsics (SPEC §6.6/§10.3).
 *
 * Generated modules call this instead of ambient `Object.freeze(...)`. The constructor rejects
 * Proxies, accessors, symbols, and unknown option keys; snapshots the schema and array-valued
 * options; and returns an immutable null-prototype carrier. Runtime/provision/check consumers
 * recover the module-private snapshot by carrier identity rather than re-reading app-held state.
 * This authenticates the configuration carrier, not the safety of authored `seedSql` statements.
 *
 * @param options - Exact Postgres runtime options to pin before authored modules can mutate them.
 * @returns A frozen carrier assignable anywhere `KovoPostgresAppRuntimeOptions` is accepted.
 */
export function postgresAppRuntimeOptions(
  options: KovoPostgresAppRuntimeOptions,
): Readonly<KovoPostgresAppRuntimeOptions> {
  const snapshot = snapshotPublicPostgresAppRuntimeOptions(options);
  const carrier = postgresOwnDataSnapshot(snapshot, 'Postgres app runtime options carrier');
  witnessWeakMapSet(postgresAppRuntimeOptionSnapshots, carrier, snapshot);
  return carrier;
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
  return witnessFreeze(declaration);
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
  /** Framework-system durable one-time capability replay truth (SPEC §6.6/§10.3). */
  readonly capabilityReplayStore: CapabilityReplayStore;
  /** Opaque framework provider token accepted by `createApp({ db })`. */
  readonly db: FrameworkManagedDbProvider<KovoPostgresRuntimeDb>;
  /** Framework-system durable mutation idempotency truth (SPEC §10.3). */
  readonly mutationReplayStore: MutationReplayStore;
  readonlyDb: Reader<KovoPostgresRuntimeDb>;
  ready: Promise<void>;
  /** Operator reconciliation for an exact crash-orphaned pending replay claim (SPEC §10.3). */
  releasePendingReplay(
    target: PostgresPendingReplayTarget,
    options: PostgresPendingReplayReleaseOptions,
  ): Promise<boolean>;
  /** Framework-owned non-request DB capability for generated auth/seed wiring, still RLS-subject. */
  systemDb(options: { operation: 'write'; reason: string; surface: string }): KovoPostgresSystemDb;
  /** Framework-system durable webhook idempotency truth (SPEC §10.3). */
  readonly webhookReplayStore: WebhookReplayStore;
  close(): Promise<void>;
}

export type { KovoPostgresSystemDb } from '@kovojs/server/internal/postgres-capability';

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
  assertManagedSqlParserAuthorityReady();
  const config = resolvePostgresRuntimeConfig(options);
  assertProductionRuntimeDriver(config);
  const schemaTables = sortTablesByForeignKeyDependencies(postgresTablesFromSchema(config.schema));
  const metadata = snapshotExtractedKovoRuntimeDbMetadata(
    extractCompilerBoundKovoRuntimeDbMetadata(schemaTables),
  );
  assertPostgresRuntimeSchemaSupported(schemaTables, metadata);
  const ddl = schemaDdl(schemaTables);
  const client = createRuntimeClient(config);
  const ready = initializeRuntimeDb(client.sql, {
    config,
    metadata,
    postureClient: client.postureSql,
    schemaDdl: ddl,
    schemaTables,
  });
  let capabilityReplayStore: CapabilityReplayStore | undefined;
  let mutationReplayStore: MutationReplayStore | undefined;
  let replaySqlExecutor: ReturnType<typeof createDurableTaskSqlExecutor> | undefined;
  let webhookReplayStore: WebhookReplayStore | undefined;

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
  const durableReplaySqlExecutor = (): ReturnType<typeof createDurableTaskSqlExecutor> => {
    replaySqlExecutor ??= createDurableTaskSqlExecutor(
      dbForRequest({
        principalPosture: declareSystemPrincipal(
          'reserve and settle framework-owned durable replay truth',
          {
            ingress: 'endpoint',
            operation: 'write',
            surface: 'createPostgresAppRuntimeDb().replayStores',
          },
        ),
      }),
    );
    return replaySqlExecutor;
  };
  const durableCapabilityReplayStore = (): CapabilityReplayStore => {
    capabilityReplayStore ??= createPostgresCapabilityReplayStoreFromExecutor(
      durableReplaySqlExecutor(),
    );
    return capabilityReplayStore;
  };
  const durableMutationReplayStore = (): MutationReplayStore => {
    mutationReplayStore ??= createPostgresMutationReplayStoreFromExecutor(
      durableReplaySqlExecutor(),
    );
    return mutationReplayStore;
  };
  const durableWebhookReplayStore = (): WebhookReplayStore => {
    webhookReplayStore ??= createPostgresWebhookReplayStoreFromExecutor(durableReplaySqlExecutor());
    return webhookReplayStore;
  };
  const capabilityStore: CapabilityReplayStore = witnessFreeze({
    consume(id, expiresAt) {
      return durableCapabilityReplayStore().consume(id, expiresAt);
    },
  });
  mintFrameworkDurableReplayStoreReceipt(capabilityStore, 'capability');
  const mutationStore: MutationReplayStore = witnessFreeze({
    get(key, scope, idem, fingerprint) {
      return durableMutationReplayStore().get(key, scope, idem, fingerprint);
    },
    reserve(key, scope, idem, fingerprint) {
      return durableMutationReplayStore().reserve(key, scope, idem, fingerprint);
    },
    set(key, scope, idem, response, fingerprint) {
      return durableMutationReplayStore().set(key, scope, idem, response, fingerprint);
    },
  });
  mintFrameworkDurableReplayStoreReceipt(mutationStore, 'mutation');
  const webhookStore: WebhookReplayStore = witnessFreeze({
    get(scope, idem) {
      return durableWebhookReplayStore().get(scope, idem);
    },
    reserve(scope, idem) {
      return durableWebhookReplayStore().reserve(scope, idem);
    },
    set(scope, idem, response) {
      return durableWebhookReplayStore().set(scope, idem, response);
    },
  });
  mintFrameworkDurableReplayStoreReceipt(webhookStore, 'webhook');

  const runtime: KovoPostgresAppRuntimeDb = witnessFreeze({
    capabilityReplayStore: capabilityStore,
    db: createFrameworkManagedDbProvider<unknown, KovoPostgresRuntimeDb>((request) =>
      dbForRequest(request),
    ),
    mutationReplayStore: mutationStore,
    readonlyDb: createRequestScopedReadonlyDb(client, config, metadata),
    ready,
    releasePendingReplay(target, releaseOptions) {
      return releasePostgresPendingReplayFromExecutor(
        durableReplaySqlExecutor(),
        target,
        releaseOptions,
      );
    },
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
    webhookReplayStore: webhookStore,
    close: () => client.close(),
  });
  registerPostgresAppRuntimeDb(runtime, dbForRequest);
  return runtime;
}

/**
 * Privileged provisioner for an external Postgres database. Run this from the CLI or deployment
 * setup, not from ordinary app boot (SPEC §10.3).
 */
export async function provisionPostgresAppDb(
  options: KovoPostgresProvisionOptions,
): Promise<KovoPostgresPostureReport> {
  assertManagedSqlParserAuthorityReady();
  const safeOptions = snapshotPostgresRuntimeConfigInput(options, {
    driver: 'node-postgres',
    postureCheckOnBoot: false,
    provisionOnBoot: true,
  });
  assertManagedPostgresTransportUrl('runtimeDatabaseUrl', safeOptions.runtimeDatabaseUrl);
  const config = resolvePostgresRuntimeConfigSnapshot(safeOptions);
  const schemaTables = sortTablesByForeignKeyDependencies(postgresTablesFromSchema(config.schema));
  const metadata = snapshotExtractedKovoRuntimeDbMetadata(
    extractCompilerBoundKovoRuntimeDbMetadata(schemaTables),
  );
  assertPostgresRuntimeSchemaSupported(schemaTables, metadata);
  const client = createRuntimeClient(config);
  try {
    await provisionRuntimeDb(client.sql, {
      applySchemaDdl: false,
      config,
      metadata,
      migrations: safeOptions.migrations ?? [],
      runtimeLoginRole: runtimeLoginRoleFromDatabaseUrl(safeOptions.runtimeDatabaseUrl),
      schemaDdl: schemaDdl(schemaTables),
      schemaTables,
    });
    const runtimeConnectionPosture = await witnessConfiguredPostgresRuntimeDatabase(
      config,
      safeOptions.runtimeDatabaseUrl,
    );
    if (runtimeConnectionPosture?.issue !== undefined) {
      return postgresRuntimeWitnessFailureReport(config, runtimeConnectionPosture);
    }
    const runtimeLoginRole =
      runtimeConnectionPosture?.runtimeLoginRole ??
      runtimeLoginRoleFromDatabaseUrl(safeOptions.runtimeDatabaseUrl);
    return await checkRuntimeDbPosture(client.sql, {
      config,
      metadata,
      ...(runtimeLoginRole === undefined ? {} : { runtimeLoginRole }),
      ...(runtimeConnectionPosture?.databaseIdentity === undefined
        ? {}
        : { runtimeDatabaseIdentity: runtimeConnectionPosture.databaseIdentity }),
      runtimeLoginPostureWitnessed: runtimeConnectionPosture !== undefined,
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
  assertManagedSqlParserAuthorityReady();
  const safeOptions = snapshotPostgresRuntimeConfigInput(options, {
    postureCheckOnBoot: false,
    provisionOnBoot: false,
  });
  assertManagedPostgresTransportUrl('runtimeDatabaseUrl', safeOptions.runtimeDatabaseUrl);
  const config = resolvePostgresRuntimeConfigSnapshot(safeOptions);
  const schemaTables = sortTablesByForeignKeyDependencies(postgresTablesFromSchema(config.schema));
  const metadata = snapshotExtractedKovoRuntimeDbMetadata(
    extractCompilerBoundKovoRuntimeDbMetadata(schemaTables),
  );
  assertPostgresRuntimeSchemaSupported(schemaTables, metadata);
  const client = createRuntimeClient(config);
  try {
    const migrations = await provisionRuntimeDb(client.sql, {
      applySchemaDdl: false,
      config,
      metadata,
      migrations: safeOptions.migrations,
      runtimeLoginRole: runtimeLoginRoleFromDatabaseUrl(safeOptions.runtimeDatabaseUrl),
      schemaDdl: schemaDdl(schemaTables),
      schemaTables,
    });
    const runtimeConnectionPosture = await witnessConfiguredPostgresRuntimeDatabase(
      config,
      safeOptions.runtimeDatabaseUrl,
    );
    if (runtimeConnectionPosture?.issue !== undefined) {
      return {
        ...migrations,
        posture: postgresRuntimeWitnessFailureReport(config, runtimeConnectionPosture),
      };
    }
    const runtimeLoginRole =
      runtimeConnectionPosture?.runtimeLoginRole ??
      runtimeLoginRoleFromDatabaseUrl(safeOptions.runtimeDatabaseUrl);
    const posture = await checkRuntimeDbPosture(client.sql, {
      config,
      metadata,
      ...(runtimeLoginRole === undefined ? {} : { runtimeLoginRole }),
      ...(runtimeConnectionPosture?.databaseIdentity === undefined
        ? {}
        : { runtimeDatabaseIdentity: runtimeConnectionPosture.databaseIdentity }),
      runtimeLoginPostureWitnessed: runtimeConnectionPosture !== undefined,
      schemaTables,
    });
    return { ...migrations, posture };
  } finally {
    await client.close();
  }
}

async function witnessConfiguredPostgresRuntimeDatabase(
  config: ResolvedPostgresRuntimeConfig,
  runtimeDatabaseUrl: string | undefined,
): Promise<PostgresRuntimeConnectionPostureWitness | undefined> {
  if (config.driver !== 'node-postgres' || runtimeDatabaseUrl === undefined) return undefined;
  const runtimeClient = createRuntimeClient({ ...config, databaseUrl: runtimeDatabaseUrl });
  try {
    return await witnessRuntimeConnectionPosture(runtimeClient.sql, {
      ...config,
      databaseUrl: runtimeDatabaseUrl,
    });
  } finally {
    await runtimeClient.close();
  }
}

function postgresRuntimeWitnessFailureReport(
  config: ResolvedPostgresRuntimeConfig,
  witness: PostgresRuntimeConnectionPostureWitness,
): KovoPostgresPostureReport {
  const issue = witness.issue ?? {
    code: 'KV433_RUNTIME_ROLE',
    detail: RUNTIME_LEAST_PRIVILEGE_ERROR,
  };
  return {
    driver: config.driver,
    issues: [issue],
    ok: false,
    roleTopology: postgresRoleTopologyReport(
      config.roleTopology,
      witness.runtimeLoginRole === undefined ? {} : { runtimeLogin: witness.runtimeLoginRole },
    ),
  };
}

/**
 * Diff the current Postgres schema against the app Drizzle schema and emit a conservative,
 * reviewable up/down migration (SPEC §10.3). This generator intentionally covers additive table
 * and column changes only; destructive edits, renames, and data backfills stay hand-authored.
 */
export async function planPostgresAppDbMigration(
  options: KovoPostgresMigrationPlanOptions,
): Promise<KovoPostgresMigrationPlan> {
  assertManagedSqlParserAuthorityReady();
  const safeOptions = snapshotPostgresRuntimeConfigInput(options, {
    postureCheckOnBoot: false,
    provisionOnBoot: false,
  });
  const config = resolvePostgresRuntimeConfigSnapshot(safeOptions);
  const schemaTables = sortTablesByForeignKeyDependencies(postgresTablesFromSchema(config.schema));
  const metadata = snapshotExtractedKovoRuntimeDbMetadata(
    extractCompilerBoundKovoRuntimeDbMetadata(schemaTables),
  );
  assertPostgresRuntimeSchemaSupported(schemaTables, metadata);
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
  assertManagedSqlParserAuthorityReady();
  const storedOptions = isRecord(options)
    ? witnessWeakMapGet(postgresAppRuntimeOptionSnapshots, options)
    : undefined;
  const optionDriver = postgresOwnDataValue(
    (storedOptions ?? options) as unknown as Record<PropertyKey, unknown>,
    'driver',
  );
  const safeOptions = snapshotPostgresRuntimeConfigInput(options, {
    driver:
      optionDriver === undefined ? 'node-postgres' : (optionDriver as KovoPostgresRuntimeDriver),
    provisionOnBoot: false,
  });
  const config = resolvePostgresRuntimeConfigSnapshot(safeOptions);
  const schemaTables = sortTablesByForeignKeyDependencies(postgresTablesFromSchema(config.schema));
  const metadata = snapshotExtractedKovoRuntimeDbMetadata(
    extractCompilerBoundKovoRuntimeDbMetadata(schemaTables),
  );
  assertPostgresRuntimeSchemaSupported(schemaTables, metadata);
  const client = createRuntimeClient(config);
  try {
    const runtimeConnectionPosture =
      config.driver === 'node-postgres'
        ? await witnessRuntimeConnectionPosture(client.sql, config)
        : undefined;
    if (runtimeConnectionPosture?.issue !== undefined) {
      return {
        driver: config.driver,
        issues: [runtimeConnectionPosture.issue],
        ok: false,
        roleTopology: postgresRoleTopologyReport(
          config.roleTopology,
          runtimeConnectionPosture.runtimeLoginRole === undefined
            ? {}
            : { runtimeLogin: runtimeConnectionPosture.runtimeLoginRole },
        ),
      };
    }
    const runtimeLoginRole =
      runtimeConnectionPosture?.runtimeLoginRole ??
      runtimeLoginRoleFromDatabaseUrl(config.databaseUrl);
    // SPEC §10.3: the ordinary connection witnesses its authenticated identity and least-privilege
    // posture first. Framework admin/system authority then proves private replay and catalog facts
    // without substituting a URL-declared username for that live runtime identity.
    return await checkRuntimeDbPosture(client.postureSql, {
      config,
      metadata,
      ...(runtimeLoginRole === undefined ? {} : { runtimeLoginRole }),
      ...(runtimeConnectionPosture?.databaseIdentity === undefined
        ? {}
        : { runtimeDatabaseIdentity: runtimeConnectionPosture.databaseIdentity }),
      runtimeLoginPostureWitnessed: runtimeConnectionPosture !== undefined,
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
    postureClient: RuntimeSqlClient;
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
  const runtimeConnectionPosture =
    input.config.driver === 'node-postgres'
      ? await assertRuntimeConnectionLeastPrivilege(client, input.config)
      : undefined;
  const runtimeLoginRole =
    runtimeConnectionPosture?.runtimeLoginRole ??
    runtimeLoginRoleFromDatabaseUrl(input.config.databaseUrl);
  if (input.config.postureCheckOnBoot) {
    const report = await checkRuntimeDbPosture(input.postureClient, {
      config: input.config,
      metadata: input.metadata,
      schemaTables: input.schemaTables,
      ...(runtimeLoginRole === undefined ? {} : { runtimeLoginRole }),
      ...(runtimeConnectionPosture?.databaseIdentity === undefined
        ? {}
        : { runtimeDatabaseIdentity: runtimeConnectionPosture.databaseIdentity }),
      runtimeLoginPostureWitnessed: input.config.driver === 'node-postgres',
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
      const lines = ['KV433: Postgres app database posture check failed during boot (SPEC §10.3).'];
      const issueCount = postgresDenseArrayLength(report.issues, 'Postgres posture issues');
      for (let index = 0; index < issueCount; index += 1) {
        const issue = postgresDenseArrayValue(report.issues, index, 'Postgres posture issues');
        appendPostgresDenseValue(lines, `  ${issue.code}: ${issue.detail}`);
      }
      throw new Error(postgresJoin(lines, '\n'));
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
  // SPEC §10.3: snapshot and checksum every reviewed migration before the provisioner opens a
  // transaction or performs any role/catalog write. The exact frozen SQL bytes checked here are
  // the only bytes the transaction may execute.
  const migrations = normalizePostgresMigrations(input.migrations);
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
      applyPostgresMigrations(tx, migrations),
    );
    if (!input.applySchemaDdl) await assertPostgresSchemaTablesExist(tx, input.schemaTables);
    await tx.exec(
      'REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(text,text,boolean) FROM PUBLIC',
    );
    await applyPostgresDefaultDenyPrivileges(tx, input.schemaTables, input.config);
    await withPostgresAppDdlSearchPath(tx, () =>
      provisionPostgresFrameworkTaskStore(tx, input.config),
    );
    await withPostgresAppDdlSearchPath(tx, () =>
      provisionPostgresFrameworkReplayStore(tx, input.config, input.runtimeLoginRole),
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
    await withPostgresAppDdlSearchPath(tx, async () => {
      await ensurePostgresSchemaStateTable(tx);
      if (input.config.driver === 'node-postgres') {
        await ensurePostgresDatabaseInstanceIdentity(tx, input.config);
      }
    });
    await grantPostgresRuntimeLoginRole(tx, roleTopology);
    await withPostgresAppDdlSearchPath(tx, async () => {
      const seedCount = postgresDenseArrayLength(input.config.seedSql, 'Postgres seed SQL');
      for (let index = 0; index < seedCount; index += 1) {
        await tx.exec(postgresDenseArrayValue(input.config.seedSql, index, 'Postgres seed SQL'));
      }
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
    config: ResolvedPostgresRuntimeConfig;
    metadata: KovoRuntimeDbMetadata;
    runtimeDatabaseIdentity?: PostgresDatabaseIdentity;
    runtimeLoginRole?: string;
    runtimeLoginPostureWitnessed?: boolean;
    schemaTables: readonly PgTable[];
  },
): Promise<KovoPostgresPostureReport> {
  // SPEC §10.3 (C9/C10): all exact database-posture facts come from one pinned session and one
  // repeatable-read snapshot; the authenticated runtime identity is witnessed separately on that
  // ordinary connection. Naming pg_temp last prevents PostgreSQL's implicit-first temporary schema
  // lookup, while pg_catalog first defeats public/temp catalog and privilege-oracle shadows.
  return client.transaction(async (tx) => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await tx.exec(POSTGRES_SECURITY_SEARCH_PATH_SQL);
    return checkRuntimeDbPostureTransaction(tx, input);
  });
}

async function checkRuntimeDbPostureTransaction(
  client: RuntimeTransactionClient,
  input: {
    config: ResolvedPostgresRuntimeConfig;
    metadata: KovoRuntimeDbMetadata;
    runtimeDatabaseIdentity?: PostgresDatabaseIdentity;
    runtimeLoginRole?: string;
    runtimeLoginPostureWitnessed?: boolean;
    schemaTables: readonly PgTable[];
  },
): Promise<KovoPostgresPostureReport> {
  const issues: KovoPostgresPostureIssue[] = [];
  const runtimeLoginRole =
    input.config.driver === 'node-postgres'
      ? (input.runtimeLoginRole ?? (await currentPostgresLogin(client)))
      : input.runtimeLoginRole;
  if (input.runtimeDatabaseIdentity !== undefined) {
    const identityIssue = await postgresPostureDatabaseIdentityIssue(
      client,
      input.runtimeDatabaseIdentity,
    );
    if (identityIssue !== undefined) {
      return {
        driver: input.config.driver,
        issues: [identityIssue],
        ok: false,
        roleTopology: postgresRoleTopologyReport(
          input.config.roleTopology,
          runtimeLoginRole === undefined ? {} : { runtimeLogin: runtimeLoginRole },
        ),
      };
    }
    appendPostgresDenseValues(
      issues,
      await postgresPersistedRuntimeSettingIssues(
        client,
        input.runtimeDatabaseIdentity.databaseName,
        runtimeLoginRole,
      ),
      'Postgres persisted runtime-setting issues',
    );
  }
  if (runtimeLoginRole !== undefined && input.runtimeLoginPostureWitnessed !== true) {
    appendPostgresDenseValues(
      issues,
      await postgresRuntimeLoginPostureIssues(client, input.config, runtimeLoginRole),
      'Postgres runtime login posture issues',
    );
  }
  appendPostgresDenseValues(
    issues,
    await postgresAppRoleClosurePostureIssues(client, input.config, runtimeLoginRole),
    'Postgres role closure posture issues',
  );
  appendPostgresDenseValues(
    issues,
    await postgresRoleAttributeVersionIssues(client),
    'Postgres role attribute issues',
  );
  appendPostgresDenseValues(
    issues,
    await postgresReplayStorePostureIssues(client, input.config, runtimeLoginRole),
    'Postgres replay store posture issues',
  );
  if (input.config.driver === 'node-postgres') {
    appendPostgresDenseValues(
      issues,
      await postgresRuntimeMembershipIssues(client, input.config.roleTopology, runtimeLoginRole),
      'Postgres runtime membership issues',
    );
  }

  const missingRelations = await missingPostgresSchemaTables(client, input.schemaTables);
  const missingRelationCount = postgresDenseArrayLength(
    missingRelations,
    'Missing Postgres relations',
  );
  for (let index = 0; index < missingRelationCount; index += 1) {
    const relation = postgresDenseArrayValue(missingRelations, index, 'Missing Postgres relations');
    appendPostgresDenseValue(issues, {
      code: 'KV433_SCHEMA_TABLE',
      detail: `${relation} is missing; run \`kovo db generate\` and \`kovo db migrate\` before provisioning/checking posture`,
    });
  }

  // SPEC §10.3 (C10): policy posture is an exact catalog allowlist, not the
  // presence of a familiar name. A same-named allow-all/PUBLIC policy or an
  // additional permissive policy changes the effective OR-composed RLS boundary.
  const protectedTables = postgresMapValues(
    resolveProtectedPostgresTables(input.schemaTables, input.metadata),
  );
  const protectedTableCount = postgresDenseArrayLength(
    protectedTables,
    'Protected Postgres tables',
  );
  for (let protectedIndex = 0; protectedIndex < protectedTableCount; protectedIndex += 1) {
    const protectedTable = postgresDenseArrayValue(
      protectedTables,
      protectedIndex,
      'Protected Postgres tables',
    );
    const rls = await safeQuery<{ relforcerowsecurity: boolean; relrowsecurity: boolean }>(
      client,
      postgresJoin(
        [
          'SELECT c.relrowsecurity, c.relforcerowsecurity',
          'FROM pg_class c',
          'JOIN pg_namespace n ON n.oid = c.relnamespace',
          'WHERE n.nspname = $1 AND c.relname = $2',
          "AND c.relkind IN ('r', 'p')",
        ],
        ' ',
      ),
      [protectedTable.schemaName, protectedTable.tableName],
    );
    const row =
      rls === undefined || postgresDenseArrayLength(rls.rows, 'Postgres RLS rows') === 0
        ? undefined
        : postgresDenseArrayValue(rls.rows, 0, 'Postgres RLS rows');
    if (row?.relrowsecurity !== true || row.relforcerowsecurity !== true) {
      appendPostgresDenseValue(issues, {
        code: 'KV433_FORCE_RLS',
        detail: `${protectedTable.schemaName}.${protectedTable.tableName} must have row-level security enabled and forced`,
      });
    }
    appendPostgresDenseValues(
      issues,
      await postgresProtectedPolicyPostureIssues(client, protectedTable, input.config),
      'Protected Postgres policy posture issues',
    );
  }

  const schemaTableCount = postgresDenseArrayLength(input.schemaTables, 'Postgres schema tables');
  for (let tableIndex = 0; tableIndex < schemaTableCount; tableIndex += 1) {
    const table = postgresDenseArrayValue(input.schemaTables, tableIndex, 'Postgres schema tables');
    const tableConfig = getTableConfig(table);
    const tableName = tableConfig.name;
    const tableReference = quoteQualified(tableSchemaName(tableConfig), tableName);
    const secretColumns =
      postgresReadonlyMapValue(
        input.metadata.secretColumnNamesByTable,
        tableName,
        'Postgres secret column names by table',
      ) ?? createWitnessSet<string>();
    const secretColumnValues = postgresSetValues(secretColumns);
    const secretColumnCount = postgresDenseArrayLength(
      secretColumnValues,
      'Postgres secret columns',
    );
    const roles = [input.config.readerRole, input.config.writerRole];
    for (let columnIndex = 0; columnIndex < secretColumnCount; columnIndex += 1) {
      const column = postgresDenseArrayValue(
        secretColumnValues,
        columnIndex,
        'Postgres secret columns',
      );
      for (let roleIndex = 0; roleIndex < 2; roleIndex += 1) {
        const role = postgresDenseArrayValue(roles, roleIndex, 'Postgres secret grant roles');
        const grant = await safeQuery<{ can_select: boolean }>(
          client,
          "SELECT has_column_privilege($1, $2, $3, 'SELECT') AS can_select",
          [role, tableReference, column],
        );
        if (grant === undefined) {
          appendPostgresDenseValue(issues, {
            code: 'KV433_REACHABILITY_AUDIT',
            detail: `could not verify effective secret-column privilege for ${role} on ${tableName}.${column}`,
          });
          continue;
        }
        const grantRow =
          postgresDenseArrayLength(grant.rows, 'Postgres secret grant rows') === 0
            ? undefined
            : postgresDenseArrayValue(grant.rows, 0, 'Postgres secret grant rows');
        if (grantRow?.can_select === true) {
          appendPostgresDenseValue(issues, {
            code: 'KV435_SECRET_COLUMN_GRANT',
            detail: `${role} must not have effective SELECT on ${tableName}.${column}`,
          });
        }
      }
    }
  }

  appendPostgresDenseValues(
    issues,
    await auditPostgresReachableClosure(client, input, runtimeLoginRole),
    'Postgres reachable closure issues',
  );
  appendPostgresDenseValues(
    issues,
    await auditPostgresReachableRoutines(client, input.config, runtimeLoginRole),
    'Postgres reachable routine issues',
  );
  appendPostgresDenseValues(
    issues,
    await auditPostgresUnexpectedPrivileges(client, input.config, runtimeLoginRole),
    'Postgres unexpected privilege issues',
  );

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
    postgresJoin(
      [
        'SELECT schemaname, tablename, policyname, permissive, roles::text[] AS roles, cmd, qual, with_check',
        'FROM pg_catalog.pg_policies',
        'WHERE schemaname = $1 AND tablename = $2',
        'ORDER BY policyname',
      ],
      ' ',
    ),
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
  if (witnessSetHas(config.crossOwnerReadTables, table.tableName)) {
    appendPostgresDenseValue(expected, {
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
  const actualByName = createWitnessMap<string, PostgresPolicyRow>();
  for (let index = 0; index < policies.rows.length; index += 1) {
    const policy = postgresDenseValue(policies.rows, index, 'Postgres policy rows');
    witnessMapSet(actualByName, policy.policyname, policy);
  }
  for (let index = 0; index < expected.length; index += 1) {
    const expectedPolicy = postgresDenseValue(expected, index, 'Expected Postgres policies');
    const actual = witnessMapGet(actualByName, expectedPolicy.name);
    if (actual === undefined || !postgresPolicyMatchesExpected(actual, expectedPolicy)) {
      appendPostgresDenseValue(issues, {
        code: expectedPolicy.issueCode,
        detail:
          actual === undefined
            ? `${table.schemaName}.${table.tableName} is missing ${expectedPolicy.name}`
            : `${table.schemaName}.${table.tableName} ${expectedPolicy.name} has unexpected permissiveness, roles, command, USING, or WITH CHECK shape`,
      });
    }
  }

  const expectedNames = createWitnessSet<string>();
  for (let index = 0; index < expected.length; index += 1) {
    witnessSetAdd(
      expectedNames,
      postgresDenseValue(expected, index, 'Expected Postgres policies').name,
    );
  }
  const unexpected: string[] = [];
  for (let index = 0; index < policies.rows.length; index += 1) {
    const policy = postgresDenseValue(policies.rows, index, 'Postgres policy rows');
    if (!witnessSetHas(expectedNames, policy.policyname)) {
      appendPostgresDenseValue(unexpected, policy.policyname);
    }
  }
  securityArraySort(unexpected, (left, right) => (left === right ? 0 : left < right ? -1 : 1));
  if (unexpected.length > 0) {
    appendPostgresDenseValue(issues, {
      code: 'KV433_POLICY_SET',
      detail: `${table.schemaName}.${table.tableName} has unexpected RLS policies outside the exact Kovo allowlist: ${postgresJoin(unexpected, ', ')}`,
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
  const normalizedLeft = createWitnessSet<string>();
  const normalizedRight = createWitnessSet<string>();
  for (let index = 0; index < left.length; index += 1) {
    witnessSetAdd(normalizedLeft, postgresDenseValue(left, index, 'Postgres policy roles'));
  }
  for (let index = 0; index < right.length; index += 1) {
    witnessSetAdd(normalizedRight, postgresDenseValue(right, index, 'Expected policy roles'));
  }
  if (witnessSetSize(normalizedLeft) !== witnessSetSize(normalizedRight)) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!witnessSetHas(normalizedRight, postgresDenseValue(left, index, 'Postgres policy roles'))) {
      return false;
    }
  }
  return true;
}

function canonicalPostgresPolicyExpression(expression: string | null): string | null | undefined {
  if (expression === null) return null;
  try {
    const statements = parseWithIsolatedSqlParser(`SELECT 1 WHERE ${expression}`);
    const statement =
      postgresDenseArrayLength(statements, 'Parsed Postgres policy statements') === 0
        ? undefined
        : postgresDenseArrayValue(statements, 0, 'Parsed Postgres policy statements');
    if (statement?.type !== 'select' || statement.where === undefined) return undefined;
    return securityJsonStringify(normalizePostgresPolicyAst(statement.where));
  } catch {
    return undefined;
  }
}

function normalizePostgresPolicyAst(value: unknown): unknown {
  if (securityArrayIsArray(value)) {
    const normalized: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      appendPostgresDenseValue(
        normalized,
        normalizePostgresPolicyAst(postgresDenseValue(value, index, 'Postgres policy AST array')),
      );
    }
    return normalized;
  }
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const castTarget = postgresOwnDataValue(record, 'to') as { name?: unknown } | undefined;
  const operand = postgresOwnDataValue(record, 'operand') as { type?: unknown } | undefined;
  // PostgreSQL deparsing adds implicit `::text` casts around string literals.
  // Removing only that catalog-added representation difference keeps predicate
  // comparison structural and fail-closed without whitespace/parenthesis tricks.
  if (
    postgresOwnDataValue(record, 'type') === 'cast' &&
    castTarget !== undefined &&
    postgresOwnDataValue(castTarget, 'name') === 'text' &&
    operand !== undefined &&
    postgresOwnDataValue(operand, 'type') === 'string'
  ) {
    return normalizePostgresPolicyAst(operand);
  }
  const normalized = witnessCreateNullRecord<unknown>();
  const keys = securityObjectKeys(record);
  securityArraySort(keys, (left, right) => (left === right ? 0 : left < right ? -1 : 1));
  for (let index = 0; index < keys.length; index += 1) {
    const key = postgresDenseValue(keys, index, 'Postgres policy AST keys');
    const entry = postgresOwnDataValue(record, key);
    if (entry !== undefined) {
      witnessDefineProperty(normalized, key, {
        configurable: true,
        enumerable: true,
        value: normalizePostgresPolicyAst(entry),
        writable: true,
      });
    }
  }
  return normalized;
}

function postgresOwnDataValue(
  record: Record<PropertyKey, unknown>,
  property: PropertyKey,
): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(record, property);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw new TypeError(
      `Postgres security metadata property ${String(property)} must be own data.`,
    );
  }
  return descriptor.value;
}

async function auditPostgresReachableClosure(
  client: RuntimeTransactionClient,
  input: {
    config: ResolvedPostgresRuntimeConfig;
    metadata: KovoRuntimeDbMetadata;
    schemaTables: readonly PgTable[];
  },
  runtimeLoginRole: string | undefined,
): Promise<KovoPostgresPostureIssue[]> {
  const issues: KovoPostgresPostureIssue[] = [];
  const auditedIdentities = await postgresRelationAuditIdentityNames(
    client,
    input.config,
    runtimeLoginRole,
  );
  if (auditedIdentities === undefined) {
    appendPostgresDenseValue(issues, {
      code: 'KV433_REACHABILITY_AUDIT',
      detail:
        'could not enumerate runtime-login/assumable-role relation reachability from pg_roles/pg_has_role',
    });
    return issues;
  }
  const protectedTables = resolveProtectedPostgresTables(input.schemaTables, input.metadata);
  const protectedRelations = createWitnessSet<string>();
  witnessMapForEach(protectedTables, (table) =>
    witnessSetAdd(protectedRelations, postgresRelationKey(table.schemaName, table.tableName)),
  );
  const allowlistedRelations = postgresReachabilityAllowlist(input.schemaTables, input.metadata);
  const allowlistedSequences = await postgresProtectedSerialSequences(client, protectedRelations);
  if (allowlistedSequences === undefined) {
    appendPostgresDenseValue(issues, {
      code: 'KV433_REACHABILITY_AUDIT',
      detail: 'could not enumerate protected-table serial/identity sequence dependencies',
    });
    return issues;
  }
  const publicRelations = input.config.publicRelations;
  const reachableRows = await safeQuery<PostgresReachableRelationRow>(
    client,
    POSTGRES_REACHABLE_RELATIONS_QUERY,
    [auditedIdentities],
  );
  if (reachableRows === undefined) {
    appendPostgresDenseValue(issues, {
      code: 'KV433_REACHABILITY_AUDIT',
      detail:
        'could not enumerate app-role relation reachability from pg_class/effective privilege checks',
    });
    return issues;
  }

  const reachable = reachableRelationsFromRows(reachableRows.rows);

  const reachableValues = postgresMapValues(reachable);
  const reachableCount = postgresDenseArrayLength(reachableValues, 'Postgres reachable relations');
  for (let index = 0; index < reachableCount; index += 1) {
    const relation = postgresDenseArrayValue(
      reachableValues,
      index,
      'Postgres reachable relations',
    );
    const relationKey = postgresRelationKey(relation.schema, relation.table);
    const declaredPublicRelation = witnessMapGet(publicRelations, relationKey);
    if (declaredPublicRelation !== undefined) {
      if (relation.relkind === 'v' || relation.relkind === 'm' || relation.relkind === 'f') {
        continue;
      }
      appendPostgresDenseValue(issues, {
        code: 'KV433_PUBLIC_RELATION',
        detail: `${relation.schema}.${relation.table} is declared public, but relkind ${relation.relkind} can carry Kovo RLS; use schema public/reference metadata or FORCE RLS instead`,
      });
      continue;
    }
    if (relation.relkind === 'r' || relation.relkind === 'p') {
      if (
        relation.schema === 'public' &&
        witnessSetHas(FRAMEWORK_INTERNAL_REACHABLE_TABLES, relation.table)
      ) {
        continue;
      }
      if (witnessSetHas(allowlistedRelations, relationKey)) continue;
      if (!witnessSetHas(protectedRelations, relationKey)) {
        appendPostgresDenseValue(issues, {
          code: 'KV433_REACHABLE_TABLE',
          detail: `${relation.schema}.${relation.table} is reachable by an app role but is not a Kovo-protected table`,
        });
        continue;
      }
      const policy = await postgresHasLiveKovoPolicy(client, relation.schema, relation.table);
      if (relation.relrowsecurity !== true || relation.relforcerowsecurity !== true || !policy) {
        appendPostgresDenseValue(issues, {
          code: 'KV433_REACHABLE_TABLE',
          detail: `${relation.schema}.${relation.table} is reachable by an app role but lacks FORCE RLS and a live Kovo policy`,
        });
      }
      continue;
    }
    if (relation.relkind === 'v') {
      appendPostgresDenseValues(
        issues,
        await auditPostgresReachableView(
          client,
          relation,
          protectedRelations,
          allowlistedRelations,
        ),
        'Postgres reachable view issues',
      );
      continue;
    }
    if (relation.relkind === 'm') {
      appendPostgresDenseValue(issues, {
        code: 'KV433_REACHABLE_OBJECT',
        detail: `${relation.schema}.${relation.table} is reachable by ${postgresJoin(relation.roles, ', ')} but materialized views cannot enforce row-level security`,
      });
      continue;
    }
    if (relation.relkind === 'S') {
      if (
        witnessSetHas(allowlistedSequences, postgresRelationKey(relation.schema, relation.table))
      ) {
        continue;
      }
      appendPostgresDenseValue(issues, {
        code: 'KV433_REACHABLE_OBJECT',
        detail: `${relation.schema}.${relation.table} is a sequence reachable by ${postgresJoin(relation.roles, ', ')} but does not back a protected table serial/identity column`,
      });
      continue;
    }
    if (relation.relkind === 'f') {
      appendPostgresDenseValue(issues, {
        code: 'KV433_REACHABLE_OBJECT',
        detail: `${relation.schema}.${relation.table} is reachable by ${postgresJoin(relation.roles, ', ')} but foreign tables cannot prove Kovo row-level security`,
      });
      continue;
    }
    appendPostgresDenseValue(issues, {
      code: 'KV433_REACHABLE_OBJECT',
      detail: `${relation.schema}.${relation.table} is reachable by an app role with unsupported relkind ${relation.relkind}`,
    });
  }
  appendPostgresDenseValues(
    issues,
    await auditPostgresAttachedCode(client, reachable, auditedIdentities),
    'Postgres attached code issues',
  );
  return issues;
}

async function auditPostgresAttachedCode(
  client: RuntimeTransactionClient,
  reachable: ReadonlyMap<string, PostgresReachableRelation>,
  auditedIdentities: readonly string[],
): Promise<KovoPostgresPostureIssue[]> {
  const writableRelations = postgresFilterDense(
    postgresMapValues(reachable),
    (relation) => postgresRelationIsWritable(relation),
    'Writable Postgres reachable relations',
  );
  if (writableRelations.length === 0) return [];
  const writeClosure = await postgresWritePropagationClosure(client, auditedIdentities);
  if (writeClosure === undefined) {
    return [
      {
        code: 'KV433_REACHABILITY_AUDIT',
        detail:
          'could not enumerate structural write-propagation closure for app-role-reachable attached code',
      },
    ];
  }
  if (witnessSetSize(writeClosure as Set<string>) === 0) return [];

  // SPEC §10.3 (C10/C13): expression attachment is a recursive executable
  // dependency graph. In particular, CHECK/index/policy expressions depend on
  // pg_operator first; stopping at direct pg_proc edges misses its oprcode.
  const attachedRows = await safeQuery<PostgresAttachedCodeRow>(
    client,
    postgresJoin(
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
      ],
      ' ',
    ),
  );
  if (attachedRows === undefined) {
    return [
      {
        code: 'KV433_REACHABILITY_AUDIT',
        detail: 'could not enumerate side-effect attached code on app-role-reachable tables',
      },
    ];
  }
  const issues: KovoPostgresPostureIssue[] = [];
  const rowCount = postgresDenseArrayLength(attachedRows.rows, 'Postgres attached code rows');
  for (let index = 0; index < rowCount; index += 1) {
    const row = postgresDenseArrayValue(attachedRows.rows, index, 'Postgres attached code rows');
    if (
      !witnessSetHas(
        writeClosure as Set<string>,
        postgresRelationKey(row.relation_schema, row.relation_name),
      )
    ) {
      continue;
    }
    appendPostgresDenseValue(issues, {
      code: 'KV433_ATTACHED_CODE',
      detail: `${row.relation_schema}.${row.relation_name} has ${row.mechanism} reaching app-authored routine ${row.routine_schema}.${row.routine_name}; attached code is app-role-reachable through writable relation side effects (SPEC §10.3)`,
    });
  }
  return issues;
}

async function postgresWritePropagationClosure(
  client: RuntimeTransactionClient,
  auditedIdentities: readonly string[],
): Promise<ReadonlySet<string> | undefined> {
  const closureRows = await safeQuery<PostgresWritePropagationClosureRow>(
    client,
    postgresJoin(
      [
        'WITH RECURSIVE app_roles(role_name) AS (SELECT unnest($1::text[])),',
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
      ],
      ' ',
    ),
    [auditedIdentities],
  );
  if (closureRows === undefined) return undefined;
  const closure = createWitnessSet<string>();
  const closureCount = postgresDenseArrayLength(
    closureRows.rows,
    'Postgres write propagation rows',
  );
  for (let index = 0; index < closureCount; index += 1) {
    const row = postgresDenseArrayValue(closureRows.rows, index, 'Postgres write propagation rows');
    witnessSetAdd(closure, postgresRelationKey(row.relation_schema, row.relation_name));
  }
  return closure;
}

function postgresRelationIsWritable(relation: PostgresReachableRelation): boolean {
  return postgresSomeDense(
    relation.privileges,
    (privilege) =>
      privilege === 'INSERT' ||
      privilege === 'UPDATE' ||
      privilege === 'DELETE' ||
      privilege === 'INSERT_COLUMN' ||
      privilege === 'UPDATE_COLUMN',
    'Postgres relation privileges',
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
  const protectedDependencies = postgresFilterDense(
    dependencies,
    (dependency) =>
      witnessSetHas(
        protectedRelations as Set<string>,
        postgresRelationKey(dependency.table_schema, dependency.table_name),
      ),
    'Protected Postgres view dependencies',
  );
  if (!postgresViewIsSecurityInvoker(relation)) {
    const firstProtectedDependency =
      postgresDenseArrayLength(protectedDependencies) === 0
        ? undefined
        : postgresDenseArrayValue(protectedDependencies, 0, 'Protected Postgres view dependencies');
    appendPostgresDenseValue(issues, {
      code: 'KV433_REACHABLE_VIEW',
      detail:
        protectedDependencies.length > 0
          ? `reachable non-security_invoker view ${relation.table} over owner table ${firstProtectedDependency?.table_name}`
          : `reachable non-security_invoker view ${relation.schema}.${relation.table} cannot be proven RLS-safe`,
    });
    return issues;
  }
  if (dependencies.length === 0) {
    appendPostgresDenseValue(issues, {
      code: 'KV433_REACHABLE_VIEW',
      detail: `reachable security_invoker view ${relation.schema}.${relation.table} has no provable base-table dependency set`,
    });
    return issues;
  }
  const dependencyCount = postgresDenseArrayLength(dependencies, 'Postgres view dependencies');
  for (let index = 0; index < dependencyCount; index += 1) {
    const dependency = postgresDenseArrayValue(dependencies, index, 'Postgres view dependencies');
    const dependencyKey = postgresRelationKey(dependency.table_schema, dependency.table_name);
    if (
      !witnessSetHas(allowlistedRelations as Set<string>, dependencyKey) &&
      (!witnessSetHas(protectedRelations as Set<string>, dependencyKey) ||
        !(await postgresBaseTableHasProtectedPosture(client, dependency)))
    ) {
      appendPostgresDenseValue(issues, {
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
  const reachable = createWitnessMap<
    string,
    PostgresCatalogRelation & {
      privileges: Set<string>;
      roles: Set<string>;
      schema: string;
      table: string;
    }
  >();
  const rowCount = postgresDenseArrayLength(rows, 'Postgres reachable relation rows');
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const row = postgresDenseArrayValue(rows, rowIndex, 'Postgres reachable relation rows');
    const privileges: string[] = [];
    if (row.can_select) appendPostgresDenseValue(privileges, 'SELECT');
    if (row.can_insert) appendPostgresDenseValue(privileges, 'INSERT');
    if (row.can_update) appendPostgresDenseValue(privileges, 'UPDATE');
    if (row.can_delete) appendPostgresDenseValue(privileges, 'DELETE');
    if (row.can_select_column) appendPostgresDenseValue(privileges, 'SELECT_COLUMN');
    if (row.can_insert_column) appendPostgresDenseValue(privileges, 'INSERT_COLUMN');
    if (row.can_update_column) appendPostgresDenseValue(privileges, 'UPDATE_COLUMN');
    if (row.can_use_sequence) appendPostgresDenseValue(privileges, 'USAGE_SEQUENCE');
    if (row.can_select_sequence) appendPostgresDenseValue(privileges, 'SELECT_SEQUENCE');
    if (row.can_update_sequence) appendPostgresDenseValue(privileges, 'UPDATE_SEQUENCE');
    if (privileges.length === 0) continue;
    const key = `${row.schema_name}.${row.table_name}`;
    let relation = witnessMapGet(reachable, key);
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
        privileges: createWitnessSet<string>(),
        roles: createWitnessSet<string>(),
      };
      witnessMapSet(reachable, key, relation);
    }
    witnessSetAdd(relation.roles, row.role_name);
    const privilegeCount = postgresDenseArrayLength(privileges, 'Postgres reachable privileges');
    for (let privilegeIndex = 0; privilegeIndex < privilegeCount; privilegeIndex += 1) {
      witnessSetAdd(
        relation.privileges,
        postgresDenseArrayValue(privileges, privilegeIndex, 'Postgres reachable privileges'),
      );
    }
  }
  const snapshot = createWitnessMap<string, PostgresReachableRelation>();
  witnessMapForEach(reachable, (relation, key) => {
    const privileges = postgresSetValues(relation.privileges);
    const roles = postgresSetValues(relation.roles);
    securityArraySort(privileges, (left, right) => (left === right ? 0 : left < right ? -1 : 1));
    securityArraySort(roles, (left, right) => (left === right ? 0 : left < right ? -1 : 1));
    witnessMapSet(snapshot, key, {
      privileges,
      relforcerowsecurity: relation.relforcerowsecurity,
      relkind: relation.relkind,
      reloptions: relation.reloptions,
      relrowsecurity: relation.relrowsecurity,
      roles,
      schema: relation.schema,
      schema_name: relation.schema_name,
      table: relation.table,
      table_name: relation.table_name,
    });
  });
  return snapshot;
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

/**
 * Provision the framework-owned replay truth outside ordinary app-role authority (SPEC §10.3).
 * The system client is the only runtime surface allowed to reserve or settle these rows.
 */
async function provisionPostgresFrameworkReplayStore(
  client: RuntimeTransactionClient,
  config: ResolvedPostgresRuntimeConfig,
  runtimeLoginRole: string | undefined,
): Promise<void> {
  const table = quoteQualified('public', POSTGRES_REPLAY_TABLE);
  await client.exec(
    postgresJoin(
      [
        `CREATE TABLE IF NOT EXISTS ${quoteIdent(POSTGRES_REPLAY_TABLE)} (`,
        'surface text NOT NULL,',
        'scope text NOT NULL CHECK (char_length(scope) BETWEEN 1 AND 4096),',
        'idem text NOT NULL CHECK (char_length(idem) BETWEEN 1 AND 1024),',
        'fingerprint text CHECK (fingerprint IS NULL OR char_length(fingerprint) BETWEEN 1 AND 1024),',
        'generation text NOT NULL CHECK (char_length(generation) BETWEEN 1 AND 128),',
        "state text NOT NULL CHECK (state IN ('pending', 'committed')),",
        'response_body text,',
        'response_headers text,',
        'response_status integer,',
        'admission_slot integer,',
        'expires_at bigint,',
        'occurred_at bigint,',
        'created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,',
        'committed_at timestamptz,',
        'PRIMARY KEY (surface, scope, idem),',
        `CONSTRAINT ${quoteIdent(`${POSTGRES_REPLAY_TABLE}_state_response_check`)} CHECK (`,
        "(state = 'pending' AND response_body IS NULL AND response_headers IS NULL AND response_status IS NULL AND committed_at IS NULL)",
        'OR',
        "(state = 'committed' AND response_body IS NOT NULL AND response_headers IS NOT NULL AND response_status IS NOT NULL AND committed_at IS NOT NULL)",
        ')',
        ')',
      ],
      ' ',
    ),
  );
  await client.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS expires_at bigint`);
  await client.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS occurred_at bigint`);
  await client.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS admission_slot integer`);
  // SPEC §10.3: pre-horizon mutation/webhook rows carry no authenticated expiry. Inferring one
  // from created_at, committed_at, or current time would either delete durable execution truth too
  // early or extend a replay key beyond the signed identity. Empty legacy tables migrate; non-empty
  // timeless surfaces require an explicit operator cutover instead of silent truth fabrication.
  const timelessResult = await client.query<{ timeless_rows: string }>(
    `SELECT COUNT(*)::text AS timeless_rows FROM ${table} ` +
      "WHERE surface IN ('mutation', 'webhook') AND expires_at IS NULL",
  );
  const timelessRow =
    postgresDenseArrayLength(timelessResult.rows, 'Postgres replay timeless-row preflight') === 0
      ? undefined
      : postgresDenseArrayValue(timelessResult.rows, 0, 'Postgres replay timeless-row preflight');
  const timelessCount =
    timelessRow === undefined ? undefined : postgresOwnDataValue(timelessRow, 'timeless_rows');
  if (timelessCount !== '0') {
    throw new Error(
      'KV433_REPLAY_STORE_CUTOVER: public._kovo_replay contains legacy mutation/webhook truth without authenticated expires_at; preserve or reconcile those rows, then perform an explicit operator cutover before provisioning the replay horizon schema.',
    );
  }
  const identityConstraint = quoteIdent(`${POSTGRES_REPLAY_TABLE}_pkey`);
  await client.exec(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${identityConstraint}`);
  await client.exec(
    `ALTER TABLE ${table} ADD CONSTRAINT ${identityConstraint} ` +
      'PRIMARY KEY (surface, scope, idem)',
  );
  const admissionConstraint = quoteIdent(`${POSTGRES_REPLAY_TABLE}_admission_slot_check`);
  await client.exec(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${admissionConstraint}`);
  await client.exec(
    `UPDATE ${table} SET admission_slot = NULL ` +
      "WHERE state = 'committed' AND admission_slot IS NOT NULL",
  );
  await client.exec(
    `WITH ranked AS (` +
      `SELECT ctid, ROW_NUMBER() OVER (` +
      `PARTITION BY surface ORDER BY created_at, scope, idem)::integer AS admission_slot ` +
      `FROM ${table} WHERE surface IN ('mutation', 'webhook') ` +
      "AND state = 'pending' AND admission_slot IS NULL" +
      `) UPDATE ${table} AS replay_row SET admission_slot = ranked.admission_slot ` +
      `FROM ranked WHERE replay_row.ctid = ranked.ctid`,
  );
  const surfaceConstraint = quoteIdent(`${POSTGRES_REPLAY_TABLE}_surface_check`);
  await client.exec(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${surfaceConstraint}`);
  await client.exec(
    `ALTER TABLE ${table} ADD CONSTRAINT ${surfaceConstraint} ` +
      "CHECK (surface IN ('capability', 'mutation', 'webhook'))",
  );
  const expiryConstraint = quoteIdent(`${POSTGRES_REPLAY_TABLE}_expires_at_check`);
  await client.exec(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${expiryConstraint}`);
  await client.exec(
    `ALTER TABLE ${table} ADD CONSTRAINT ${expiryConstraint} ` +
      'CHECK (expires_at IS NULL OR expires_at > 0)',
  );
  const legacyCapabilityConstraint = quoteIdent(`${POSTGRES_REPLAY_TABLE}_capability_expiry_check`);
  await client.exec(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${legacyCapabilityConstraint}`);
  const surfaceStateConstraint = quoteIdent(`${POSTGRES_REPLAY_TABLE}_surface_state_expiry_check`);
  await client.exec(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${surfaceStateConstraint}`);
  await client.exec(
    `ALTER TABLE ${table} ADD CONSTRAINT ${surfaceStateConstraint} CHECK (` +
      "(surface = 'capability' AND state = 'committed' AND expires_at IS NOT NULL AND occurred_at IS NULL) OR " +
      "(surface = 'mutation' AND expires_at IS NOT NULL AND occurred_at IS NULL) OR " +
      `(surface = 'webhook' AND expires_at IS NOT NULL AND occurred_at IS NOT NULL ` +
      `AND expires_at = occurred_at + ${WEBHOOK_REPLAY_HORIZON_MS}))`,
  );
  await client.exec(
    `ALTER TABLE ${table} ADD CONSTRAINT ${admissionConstraint} CHECK (` +
      "(state = 'committed' AND admission_slot IS NULL) OR " +
      `(state = 'pending' AND surface IN ('mutation', 'webhook') AND ` +
      `admission_slot BETWEEN 1 AND ${POSTGRES_REPLAY_MAX_ENTRIES}))`,
  );
  const stateResponseConstraint = quoteIdent(`${POSTGRES_REPLAY_TABLE}_state_response_check`);
  await client.exec(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${stateResponseConstraint}`);
  await client.exec(
    `ALTER TABLE ${table} ADD CONSTRAINT ${stateResponseConstraint} CHECK (` +
      "(state = 'pending' AND response_body IS NULL AND response_headers IS NULL " +
      'AND response_status IS NULL AND committed_at IS NULL) OR ' +
      "(state = 'committed' AND response_body IS NOT NULL AND response_headers IS NOT NULL " +
      'AND response_status IS NOT NULL AND committed_at IS NOT NULL))',
  );
  const responseSizeConstraint = quoteIdent(`${POSTGRES_REPLAY_TABLE}_response_size_check`);
  await client.exec(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${responseSizeConstraint}`);
  await client.exec(
    `ALTER TABLE ${table} ADD CONSTRAINT ${responseSizeConstraint} CHECK (` +
      `(response_body IS NULL OR octet_length(response_body) <= ${POSTGRES_REPLAY_MAX_RESPONSE_BODY_STORAGE_BYTES}) AND ` +
      `(response_headers IS NULL OR octet_length(response_headers) <= ${POSTGRES_REPLAY_MAX_RESPONSE_HEADER_BYTES}))`,
  );
  await client.exec(
    `DROP INDEX IF EXISTS ${quoteQualified(
      'public',
      `${POSTGRES_REPLAY_TABLE}_capability_expiry_idx`,
    )}`,
  );
  await client.exec(
    `DROP INDEX IF EXISTS ${quoteQualified(
      'public',
      `${POSTGRES_REPLAY_TABLE}_committed_expiry_idx`,
    )}`,
  );
  await client.exec(
    `CREATE INDEX ${quoteIdent(`${POSTGRES_REPLAY_TABLE}_committed_expiry_idx`)} ` +
      `ON ${table} (surface, expires_at) WHERE state = 'committed'`,
  );
  await client.exec(
    `DROP INDEX IF EXISTS ${quoteQualified(
      'public',
      `${POSTGRES_REPLAY_TABLE}_admission_slot_idx`,
    )}`,
  );
  await client.exec(
    `CREATE UNIQUE INDEX ${quoteIdent(`${POSTGRES_REPLAY_TABLE}_admission_slot_idx`)} ` +
      `ON ${table} (surface, admission_slot) ` +
      `WHERE surface IN ('mutation', 'webhook') AND state = 'pending'`,
  );
  const watermarkTable = quoteQualified('public', POSTGRES_REPLAY_WATERMARK_TABLE);
  const watermarkIdentityConstraint = quoteIdent(`${POSTGRES_REPLAY_WATERMARK_TABLE}_pkey`);
  const watermarkSurfaceConstraint = quoteIdent(`${POSTGRES_REPLAY_WATERMARK_TABLE}_surface_check`);
  const watermarkValueConstraint = quoteIdent(`${POSTGRES_REPLAY_WATERMARK_TABLE}_value_check`);
  await client.exec(
    postgresJoin(
      [
        `CREATE TABLE IF NOT EXISTS ${watermarkTable} (`,
        'surface text NOT NULL,',
        'reclaimed_through bigint NOT NULL DEFAULT 0,',
        `CONSTRAINT ${watermarkIdentityConstraint} PRIMARY KEY (surface),`,
        `CONSTRAINT ${watermarkSurfaceConstraint} CHECK (` +
          "surface IN ('capability', 'mutation', 'webhook')),",
        `CONSTRAINT ${watermarkValueConstraint} CHECK (reclaimed_through >= 0))`,
      ],
      ' ',
    ),
  );
  await client.exec(
    `ALTER TABLE ${watermarkTable} DROP CONSTRAINT IF EXISTS ${watermarkIdentityConstraint}`,
  );
  await client.exec(
    `ALTER TABLE ${watermarkTable} ADD CONSTRAINT ${watermarkIdentityConstraint} ` +
      'PRIMARY KEY (surface)',
  );
  await client.exec(
    `ALTER TABLE ${watermarkTable} DROP CONSTRAINT IF EXISTS ${watermarkSurfaceConstraint}`,
  );
  await client.exec(
    `ALTER TABLE ${watermarkTable} ADD CONSTRAINT ${watermarkSurfaceConstraint} ` +
      "CHECK (surface IN ('capability', 'mutation', 'webhook'))",
  );
  await client.exec(
    `ALTER TABLE ${watermarkTable} DROP CONSTRAINT IF EXISTS ${watermarkValueConstraint}`,
  );
  await client.exec(
    `ALTER TABLE ${watermarkTable} ADD CONSTRAINT ${watermarkValueConstraint} ` +
      'CHECK (reclaimed_through >= 0)',
  );
  await client.exec(
    `INSERT INTO ${watermarkTable} AS watermark (surface, reclaimed_through) ` +
      `SELECT canonical.surface, FLOOR(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::bigint ` +
      `FROM (VALUES ('capability'), ('mutation'), ('webhook')) AS canonical(surface) ` +
      `ON CONFLICT (surface) DO UPDATE SET reclaimed_through = GREATEST(` +
      `watermark.reclaimed_through, EXCLUDED.reclaimed_through)`,
  );
  await client.exec(`REVOKE ALL ON TABLE ${table} FROM PUBLIC`);
  await client.exec(`REVOKE ALL ON TABLE ${watermarkTable} FROM PUBLIC`);
  const deniedRoles = [config.readerRole, config.writerRole, config.adminRole, config.systemRole];
  if (runtimeLoginRole !== undefined) appendPostgresDenseValue(deniedRoles, runtimeLoginRole);
  const seen = createWitnessSet<string>();
  for (let index = 0; index < deniedRoles.length; index += 1) {
    const role = postgresDenseValue(deniedRoles, index, 'Postgres replay denied roles');
    if (witnessSetHas(seen, role)) continue;
    witnessSetAdd(seen, role);
    await client.exec(`REVOKE ALL ON TABLE ${table} FROM ${quoteIdent(role)}`);
    await client.exec(`REVOKE ALL ON TABLE ${watermarkTable} FROM ${quoteIdent(role)}`);
  }
  await client.exec(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${table} TO ${quoteIdent(config.systemRole)}`,
  );
  await client.exec(
    `GRANT SELECT, UPDATE ON TABLE ${watermarkTable} TO ${quoteIdent(config.systemRole)}`,
  );
  // The framework admin connection performs the exact boot-posture proof, including the three
  // monotonic watermark rows. It receives read-only visibility into that non-secret clock state;
  // mutation/webhook payload truth and every watermark write remain system-only (SPEC §10.3).
  await client.exec(`GRANT SELECT ON TABLE ${watermarkTable} TO ${quoteIdent(config.adminRole)}`);
}

interface PostgresReplayPrivilegeRow {
  can_any_column_insert: boolean;
  can_any_column_references: boolean;
  can_any_column_select: boolean;
  can_any_column_update: boolean;
  can_delete: boolean;
  can_insert: boolean;
  can_references: boolean;
  can_select: boolean;
  can_trigger: boolean;
  can_truncate: boolean;
  can_update: boolean;
  watermark_can_any_column_insert: boolean;
  watermark_can_any_column_references: boolean;
  watermark_can_any_column_select: boolean;
  watermark_can_any_column_update: boolean;
  watermark_can_delete: boolean;
  watermark_can_insert: boolean;
  watermark_can_references: boolean;
  watermark_can_select: boolean;
  watermark_can_trigger: boolean;
  watermark_can_truncate: boolean;
  watermark_can_update: boolean;
}

interface PostgresReplayShapeRow {
  exact_admission_constraint: boolean;
  exact_admission_index: boolean;
  exact_admission_column: boolean;
  exact_committed_expiry_index: boolean;
  exact_expiry_constraint: boolean;
  exact_expiry_column: boolean;
  exact_identity_constraint: boolean;
  exact_occurrence_column: boolean;
  exact_response_constraint: boolean;
  exact_state_response_constraint: boolean;
  exact_surface_constraint: boolean;
  exact_surface_state_constraint: boolean;
}

interface PostgresReplayWatermarkShapeRow {
  exact_identity_constraint: boolean;
  exact_rows: boolean;
  exact_surface_column: boolean;
  exact_surface_constraint: boolean;
  exact_value_column: boolean;
  exact_value_constraint: boolean;
}

const POSTGRES_REPLAY_SURFACE_CONSTRAINT =
  "CHECK ((surface = ANY (ARRAY['capability'::text, 'mutation'::text, 'webhook'::text])))";
const POSTGRES_REPLAY_EXPIRY_CONSTRAINT = 'CHECK (((expires_at IS NULL) OR (expires_at > 0)))';
const POSTGRES_REPLAY_SURFACE_STATE_CONSTRAINT = `CHECK ((((surface = 'capability'::text) AND (state = 'committed'::text) AND (expires_at IS NOT NULL) AND (occurred_at IS NULL)) OR ((surface = 'mutation'::text) AND (expires_at IS NOT NULL) AND (occurred_at IS NULL)) OR ((surface = 'webhook'::text) AND (expires_at IS NOT NULL) AND (occurred_at IS NOT NULL) AND (expires_at = (occurred_at + '${WEBHOOK_REPLAY_HORIZON_MS}'::bigint)))))`;
const POSTGRES_REPLAY_ADMISSION_CONSTRAINT =
  "CHECK ((((state = 'committed'::text) AND (admission_slot IS NULL)) OR ((state = 'pending'::text) AND (surface = ANY (ARRAY['mutation'::text, 'webhook'::text])) AND ((admission_slot >= 1) AND (admission_slot <= 1000)))))";
const POSTGRES_REPLAY_STATE_RESPONSE_CONSTRAINT =
  "CHECK ((((state = 'pending'::text) AND (response_body IS NULL) AND (response_headers IS NULL) AND (response_status IS NULL) AND (committed_at IS NULL)) OR ((state = 'committed'::text) AND (response_body IS NOT NULL) AND (response_headers IS NOT NULL) AND (response_status IS NOT NULL) AND (committed_at IS NOT NULL))))";
const POSTGRES_REPLAY_RESPONSE_CONSTRAINT =
  'CHECK ((((response_body IS NULL) OR (octet_length(response_body) <= 1398104)) AND ((response_headers IS NULL) OR (octet_length(response_headers) <= 65536))))';
const POSTGRES_REPLAY_COMMITTED_INDEX_PREDICATE = "(state = 'committed'::text)";
const POSTGRES_REPLAY_ADMISSION_INDEX_PREDICATE =
  "((surface = ANY (ARRAY['mutation'::text, 'webhook'::text])) AND (state = 'pending'::text))";
const POSTGRES_REPLAY_WATERMARK_VALUE_CONSTRAINT = 'CHECK ((reclaimed_through >= 0))';

async function postgresReplayStorePostureIssues(
  client: RuntimeTransactionClient,
  config: ResolvedPostgresRuntimeConfig,
  runtimeLoginRole: string | undefined,
): Promise<KovoPostgresPostureIssue[]> {
  const relation = await safeQuery<{ exists: boolean }>(
    client,
    "SELECT to_regclass('public._kovo_replay') IS NOT NULL AS exists",
  );
  const relationRow =
    relation === undefined ||
    postgresDenseArrayLength(relation.rows, 'Postgres replay relation') === 0
      ? undefined
      : postgresDenseArrayValue(relation.rows, 0, 'Postgres replay relation');
  if (relationRow?.exists !== true) {
    return [
      {
        code: 'KV433_REPLAY_STORE',
        detail:
          'public._kovo_replay is missing; provision the framework replay truth table before boot',
      },
    ];
  }

  const issues: KovoPostgresPostureIssue[] = [];
  const watermarkRelation = await safeQuery<{ exists: boolean }>(
    client,
    "SELECT to_regclass('public._kovo_replay_reclaimed') IS NOT NULL AS exists",
  );
  const watermarkRelationRow =
    watermarkRelation === undefined ||
    postgresDenseArrayLength(watermarkRelation.rows, 'Postgres replay watermark relation') === 0
      ? undefined
      : postgresDenseArrayValue(watermarkRelation.rows, 0, 'Postgres replay watermark relation');
  if (watermarkRelationRow?.exists !== true) {
    appendPostgresDenseValue(issues, {
      code: 'KV433_REPLAY_STORE_SCHEMA',
      detail:
        'public._kovo_replay_reclaimed is missing; provision the durable replay rollback watermark before boot',
    });
  }
  const timeless = await safeQuery<{ timeless_rows: boolean }>(
    client,
    "SELECT EXISTS (SELECT 1 FROM public._kovo_replay WHERE surface IN ('mutation', 'webhook') AND expires_at IS NULL) AS timeless_rows",
  );
  const timelessRow =
    timeless === undefined ||
    postgresDenseArrayLength(timeless.rows, 'Postgres replay timeless posture rows') === 0
      ? undefined
      : postgresDenseArrayValue(timeless.rows, 0, 'Postgres replay timeless posture rows');
  if (timelessRow?.timeless_rows === true) {
    appendPostgresDenseValue(issues, {
      code: 'KV433_REPLAY_STORE_CUTOVER',
      detail:
        'public._kovo_replay contains legacy mutation/webhook truth without authenticated expires_at; reconcile and explicitly cut over those rows before enabling bounded replay cleanup',
    });
  }
  const shape = await safeQuery<PostgresReplayShapeRow>(
    client,
    postgresJoin(
      [
        'SELECT EXISTS (SELECT 1 FROM pg_attribute AS column_row',
        'JOIN pg_class AS relation_row ON relation_row.oid = column_row.attrelid',
        'JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace',
        "WHERE namespace_row.nspname = 'public' AND relation_row.relname = '_kovo_replay'",
        "AND column_row.attname = 'expires_at' AND column_row.attnum > 0",
        'AND NOT column_row.attisdropped AND NOT column_row.attnotnull',
        "AND format_type(column_row.atttypid, column_row.atttypmod) = 'bigint') AS exact_expiry_column,",
        'EXISTS (SELECT 1 FROM pg_attribute AS column_row',
        'JOIN pg_class AS relation_row ON relation_row.oid = column_row.attrelid',
        'JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace',
        "WHERE namespace_row.nspname = 'public' AND relation_row.relname = '_kovo_replay'",
        "AND column_row.attname = 'occurred_at' AND column_row.attnum > 0",
        'AND NOT column_row.attisdropped AND NOT column_row.attnotnull',
        "AND format_type(column_row.atttypid, column_row.atttypmod) = 'bigint') AS exact_occurrence_column,",
        'EXISTS (SELECT 1 FROM pg_attribute AS column_row',
        'JOIN pg_class AS relation_row ON relation_row.oid = column_row.attrelid',
        'JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace',
        "WHERE namespace_row.nspname = 'public' AND relation_row.relname = '_kovo_replay'",
        "AND column_row.attname = 'admission_slot' AND column_row.attnum > 0",
        'AND NOT column_row.attisdropped AND NOT column_row.attnotnull',
        "AND format_type(column_row.atttypid, column_row.atttypmod) = 'integer') AS exact_admission_column,",
        'EXISTS (SELECT 1 FROM pg_constraint AS constraint_row',
        'JOIN pg_class AS relation_row ON relation_row.oid = constraint_row.conrelid',
        'JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace',
        'JOIN pg_attribute AS surface_column ON surface_column.attrelid = relation_row.oid',
        'AND surface_column.attnum = constraint_row.conkey[1]',
        'JOIN pg_attribute AS scope_column ON scope_column.attrelid = relation_row.oid',
        'AND scope_column.attnum = constraint_row.conkey[2]',
        'JOIN pg_attribute AS idem_column ON idem_column.attrelid = relation_row.oid',
        'AND idem_column.attnum = constraint_row.conkey[3]',
        "WHERE namespace_row.nspname = 'public' AND relation_row.relname = '_kovo_replay'",
        "AND constraint_row.contype = 'p' AND constraint_row.convalidated",
        'AND NOT constraint_row.condeferrable AND NOT constraint_row.condeferred',
        "AND constraint_row.conname = '_kovo_replay_pkey'",
        'AND cardinality(constraint_row.conkey) = 3',
        "AND surface_column.attname = 'surface' AND scope_column.attname = 'scope'",
        "AND idem_column.attname = 'idem') AS exact_identity_constraint,",
        'EXISTS (SELECT 1 FROM pg_constraint AS constraint_row',
        'JOIN pg_class AS relation_row ON relation_row.oid = constraint_row.conrelid',
        'JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace',
        "WHERE namespace_row.nspname = 'public' AND relation_row.relname = '_kovo_replay'",
        "AND constraint_row.contype = 'c' AND constraint_row.convalidated",
        'AND NOT constraint_row.condeferrable AND NOT constraint_row.condeferred',
        "AND constraint_row.conname = '_kovo_replay_surface_check'",
        'AND pg_get_constraintdef(constraint_row.oid) = $1) AS exact_surface_constraint,',
        'EXISTS (SELECT 1 FROM pg_constraint AS constraint_row',
        'JOIN pg_class AS relation_row ON relation_row.oid = constraint_row.conrelid',
        'JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace',
        "WHERE namespace_row.nspname = 'public' AND relation_row.relname = '_kovo_replay'",
        "AND constraint_row.contype = 'c' AND constraint_row.convalidated",
        'AND NOT constraint_row.condeferrable AND NOT constraint_row.condeferred',
        "AND constraint_row.conname = '_kovo_replay_expires_at_check'",
        'AND pg_get_constraintdef(constraint_row.oid) = $2) AS exact_expiry_constraint,',
        'EXISTS (SELECT 1 FROM pg_constraint AS constraint_row',
        'JOIN pg_class AS relation_row ON relation_row.oid = constraint_row.conrelid',
        'JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace',
        "WHERE namespace_row.nspname = 'public' AND relation_row.relname = '_kovo_replay'",
        "AND constraint_row.contype = 'c' AND constraint_row.convalidated",
        'AND NOT constraint_row.condeferrable AND NOT constraint_row.condeferred',
        "AND constraint_row.conname = '_kovo_replay_surface_state_expiry_check'",
        'AND pg_get_constraintdef(constraint_row.oid) = $3) AS exact_surface_state_constraint,',
        'EXISTS (SELECT 1 FROM pg_constraint AS constraint_row',
        'JOIN pg_class AS relation_row ON relation_row.oid = constraint_row.conrelid',
        'JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace',
        "WHERE namespace_row.nspname = 'public' AND relation_row.relname = '_kovo_replay'",
        "AND constraint_row.contype = 'c' AND constraint_row.convalidated",
        'AND NOT constraint_row.condeferrable AND NOT constraint_row.condeferred',
        "AND constraint_row.conname = '_kovo_replay_admission_slot_check'",
        'AND pg_get_constraintdef(constraint_row.oid) = $4) AS exact_admission_constraint,',
        'EXISTS (SELECT 1 FROM pg_constraint AS constraint_row',
        'JOIN pg_class AS relation_row ON relation_row.oid = constraint_row.conrelid',
        'JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace',
        "WHERE namespace_row.nspname = 'public' AND relation_row.relname = '_kovo_replay'",
        "AND constraint_row.contype = 'c' AND constraint_row.convalidated",
        'AND NOT constraint_row.condeferrable AND NOT constraint_row.condeferred',
        "AND constraint_row.conname = '_kovo_replay_state_response_check'",
        'AND pg_get_constraintdef(constraint_row.oid) = $5) AS exact_state_response_constraint,',
        'EXISTS (SELECT 1 FROM pg_constraint AS constraint_row',
        'JOIN pg_class AS relation_row ON relation_row.oid = constraint_row.conrelid',
        'JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace',
        "WHERE namespace_row.nspname = 'public' AND relation_row.relname = '_kovo_replay'",
        "AND constraint_row.contype = 'c' AND constraint_row.convalidated",
        'AND NOT constraint_row.condeferrable AND NOT constraint_row.condeferred',
        "AND constraint_row.conname = '_kovo_replay_response_size_check'",
        'AND pg_get_constraintdef(constraint_row.oid) = $6) AS exact_response_constraint,',
        'EXISTS (SELECT 1 FROM pg_index AS index_row',
        'JOIN pg_class AS index_relation ON index_relation.oid = index_row.indexrelid',
        'JOIN pg_class AS table_relation ON table_relation.oid = index_row.indrelid',
        'JOIN pg_namespace AS namespace_row ON namespace_row.oid = table_relation.relnamespace',
        'JOIN pg_am AS access_method ON access_method.oid = index_relation.relam',
        'JOIN pg_attribute AS surface_column ON surface_column.attrelid = table_relation.oid',
        'AND surface_column.attnum = index_row.indkey[0]',
        'JOIN pg_attribute AS expiry_column ON expiry_column.attrelid = table_relation.oid',
        'AND expiry_column.attnum = index_row.indkey[1]',
        "WHERE namespace_row.nspname = 'public' AND table_relation.relname = '_kovo_replay'",
        "AND index_relation.relname = '_kovo_replay_committed_expiry_idx'",
        "AND access_method.amname = 'btree' AND surface_column.attname = 'surface'",
        "AND expiry_column.attname = 'expires_at'",
        'AND index_row.indnatts = 2 AND index_row.indnkeyatts = 2',
        'AND index_row.indexprs IS NULL AND NOT index_row.indisunique',
        'AND index_row.indisvalid AND index_row.indisready AND index_row.indislive',
        'AND pg_get_expr(index_row.indpred, index_row.indrelid) = $7) AS exact_committed_expiry_index,',
        'EXISTS (SELECT 1 FROM pg_index AS index_row',
        'JOIN pg_class AS index_relation ON index_relation.oid = index_row.indexrelid',
        'JOIN pg_class AS table_relation ON table_relation.oid = index_row.indrelid',
        'JOIN pg_namespace AS namespace_row ON namespace_row.oid = table_relation.relnamespace',
        'JOIN pg_am AS access_method ON access_method.oid = index_relation.relam',
        'JOIN pg_attribute AS surface_column ON surface_column.attrelid = table_relation.oid',
        'AND surface_column.attnum = index_row.indkey[0]',
        'JOIN pg_attribute AS slot_column ON slot_column.attrelid = table_relation.oid',
        'AND slot_column.attnum = index_row.indkey[1]',
        "WHERE namespace_row.nspname = 'public' AND table_relation.relname = '_kovo_replay'",
        "AND index_relation.relname = '_kovo_replay_admission_slot_idx'",
        "AND access_method.amname = 'btree' AND surface_column.attname = 'surface'",
        "AND slot_column.attname = 'admission_slot'",
        'AND index_row.indnatts = 2 AND index_row.indnkeyatts = 2',
        'AND index_row.indexprs IS NULL AND index_row.indisunique',
        'AND index_row.indisvalid AND index_row.indisready AND index_row.indislive',
        'AND pg_get_expr(index_row.indpred, index_row.indrelid) = $8) AS exact_admission_index',
      ],
      ' ',
    ),
    [
      POSTGRES_REPLAY_SURFACE_CONSTRAINT,
      POSTGRES_REPLAY_EXPIRY_CONSTRAINT,
      POSTGRES_REPLAY_SURFACE_STATE_CONSTRAINT,
      POSTGRES_REPLAY_ADMISSION_CONSTRAINT,
      POSTGRES_REPLAY_STATE_RESPONSE_CONSTRAINT,
      POSTGRES_REPLAY_RESPONSE_CONSTRAINT,
      POSTGRES_REPLAY_COMMITTED_INDEX_PREDICATE,
      POSTGRES_REPLAY_ADMISSION_INDEX_PREDICATE,
    ],
  );
  const shapeRow =
    shape === undefined || postgresDenseArrayLength(shape.rows, 'Postgres replay shape rows') === 0
      ? undefined
      : postgresDenseArrayValue(shape.rows, 0, 'Postgres replay shape rows');
  if (
    shapeRow?.exact_admission_column !== true ||
    shapeRow.exact_admission_constraint !== true ||
    shapeRow.exact_admission_index !== true ||
    shapeRow.exact_identity_constraint !== true ||
    shapeRow.exact_response_constraint !== true ||
    shapeRow.exact_state_response_constraint !== true ||
    shapeRow.exact_expiry_column !== true ||
    shapeRow.exact_occurrence_column !== true ||
    shapeRow.exact_surface_constraint !== true ||
    shapeRow.exact_expiry_constraint !== true ||
    shapeRow.exact_surface_state_constraint !== true ||
    shapeRow.exact_committed_expiry_index !== true
  ) {
    appendPostgresDenseValue(issues, {
      code: 'KV433_REPLAY_STORE_SCHEMA',
      detail:
        'public._kovo_replay must have the exact replay-identity primary key, expiry/admission columns, capability/mutation/webhook constraints, and bounded cleanup/admission indexes; run the current framework provisioner',
    });
  }
  const watermarkShape = await safeQuery<PostgresReplayWatermarkShapeRow>(
    client,
    postgresJoin(
      [
        'SELECT EXISTS (SELECT 1 FROM pg_attribute AS column_row',
        'JOIN pg_class AS relation_row ON relation_row.oid = column_row.attrelid',
        'JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace',
        "WHERE namespace_row.nspname = 'public' AND relation_row.relname = '_kovo_replay_reclaimed'",
        "AND column_row.attname = 'surface' AND column_row.attnum > 0",
        'AND NOT column_row.attisdropped AND column_row.attnotnull',
        "AND format_type(column_row.atttypid, column_row.atttypmod) = 'text') AS exact_surface_column,",
        'EXISTS (SELECT 1 FROM pg_attribute AS column_row',
        'JOIN pg_class AS relation_row ON relation_row.oid = column_row.attrelid',
        'JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace',
        "WHERE namespace_row.nspname = 'public' AND relation_row.relname = '_kovo_replay_reclaimed'",
        "AND column_row.attname = 'reclaimed_through' AND column_row.attnum > 0",
        'AND NOT column_row.attisdropped AND column_row.attnotnull',
        "AND format_type(column_row.atttypid, column_row.atttypmod) = 'bigint') AS exact_value_column,",
        'EXISTS (SELECT 1 FROM pg_constraint AS constraint_row',
        'JOIN pg_class AS relation_row ON relation_row.oid = constraint_row.conrelid',
        'JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace',
        'JOIN pg_attribute AS surface_column ON surface_column.attrelid = relation_row.oid',
        'AND surface_column.attnum = constraint_row.conkey[1]',
        "WHERE namespace_row.nspname = 'public' AND relation_row.relname = '_kovo_replay_reclaimed'",
        "AND constraint_row.contype = 'p' AND constraint_row.convalidated",
        'AND NOT constraint_row.condeferrable AND NOT constraint_row.condeferred',
        "AND constraint_row.conname = '_kovo_replay_reclaimed_pkey'",
        'AND cardinality(constraint_row.conkey) = 1',
        "AND surface_column.attname = 'surface') AS exact_identity_constraint,",
        'EXISTS (SELECT 1 FROM pg_constraint AS constraint_row',
        'JOIN pg_class AS relation_row ON relation_row.oid = constraint_row.conrelid',
        'JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace',
        "WHERE namespace_row.nspname = 'public' AND relation_row.relname = '_kovo_replay_reclaimed'",
        "AND constraint_row.contype = 'c' AND constraint_row.convalidated",
        'AND NOT constraint_row.condeferrable AND NOT constraint_row.condeferred',
        "AND constraint_row.conname = '_kovo_replay_reclaimed_surface_check'",
        'AND pg_get_constraintdef(constraint_row.oid) = $1) AS exact_surface_constraint,',
        'EXISTS (SELECT 1 FROM pg_constraint AS constraint_row',
        'JOIN pg_class AS relation_row ON relation_row.oid = constraint_row.conrelid',
        'JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace',
        "WHERE namespace_row.nspname = 'public' AND relation_row.relname = '_kovo_replay_reclaimed'",
        "AND constraint_row.contype = 'c' AND constraint_row.convalidated",
        'AND NOT constraint_row.condeferrable AND NOT constraint_row.condeferred',
        "AND constraint_row.conname = '_kovo_replay_reclaimed_value_check'",
        'AND pg_get_constraintdef(constraint_row.oid) = $2) AS exact_value_constraint,',
        'EXISTS (SELECT 1 FROM public._kovo_replay_reclaimed HAVING COUNT(*) = 3',
        "AND COUNT(*) FILTER (WHERE surface IN ('capability', 'mutation', 'webhook')) = 3) AS exact_rows",
      ],
      ' ',
    ),
    [POSTGRES_REPLAY_SURFACE_CONSTRAINT, POSTGRES_REPLAY_WATERMARK_VALUE_CONSTRAINT],
  );
  const watermarkShapeRow =
    watermarkShape === undefined ||
    postgresDenseArrayLength(watermarkShape.rows, 'Postgres replay watermark shape rows') === 0
      ? undefined
      : postgresDenseArrayValue(watermarkShape.rows, 0, 'Postgres replay watermark shape rows');
  if (
    watermarkShapeRow?.exact_surface_column !== true ||
    watermarkShapeRow.exact_value_column !== true ||
    watermarkShapeRow.exact_identity_constraint !== true ||
    watermarkShapeRow.exact_surface_constraint !== true ||
    watermarkShapeRow.exact_value_constraint !== true ||
    watermarkShapeRow.exact_rows !== true
  ) {
    appendPostgresDenseValue(issues, {
      code: 'KV433_REPLAY_STORE_SCHEMA',
      detail:
        'public._kovo_replay_reclaimed must hold exactly one non-negative monotonic watermark for capability, mutation, and webhook replay cleanup',
    });
  }
  const roles: { allow: boolean; role: string; watermarkRead: boolean }[] = [
    { allow: false, role: config.readerRole, watermarkRead: false },
    { allow: false, role: config.writerRole, watermarkRead: false },
    { allow: false, role: config.adminRole, watermarkRead: true },
    { allow: true, role: config.systemRole, watermarkRead: true },
  ];
  if (runtimeLoginRole !== undefined) {
    appendPostgresDenseValue(roles, {
      allow: false,
      role: runtimeLoginRole,
      watermarkRead: false,
    });
  }
  const seen = createWitnessSet<string>();
  for (let index = 0; index < roles.length; index += 1) {
    const expected = postgresDenseValue(roles, index, 'Postgres replay privilege roles');
    if (witnessSetHas(seen, expected.role)) continue;
    witnessSetAdd(seen, expected.role);
    const privileges = await safeQuery<PostgresReplayPrivilegeRow>(
      client,
      postgresJoin(
        [
          "SELECT has_table_privilege($1, 'public._kovo_replay', 'SELECT') AS can_select,",
          "has_table_privilege($1, 'public._kovo_replay', 'INSERT') AS can_insert,",
          "has_table_privilege($1, 'public._kovo_replay', 'UPDATE') AS can_update,",
          "has_table_privilege($1, 'public._kovo_replay', 'DELETE') AS can_delete,",
          "has_table_privilege($1, 'public._kovo_replay', 'TRUNCATE') AS can_truncate,",
          "has_table_privilege($1, 'public._kovo_replay', 'REFERENCES') AS can_references,",
          "has_table_privilege($1, 'public._kovo_replay', 'TRIGGER') AS can_trigger,",
          "has_any_column_privilege($1, 'public._kovo_replay', 'SELECT') AS can_any_column_select,",
          "has_any_column_privilege($1, 'public._kovo_replay', 'INSERT') AS can_any_column_insert,",
          "has_any_column_privilege($1, 'public._kovo_replay', 'UPDATE') AS can_any_column_update,",
          "has_any_column_privilege($1, 'public._kovo_replay', 'REFERENCES') AS can_any_column_references,",
          "has_table_privilege($1, 'public._kovo_replay_reclaimed', 'SELECT') AS watermark_can_select,",
          "has_table_privilege($1, 'public._kovo_replay_reclaimed', 'INSERT') AS watermark_can_insert,",
          "has_table_privilege($1, 'public._kovo_replay_reclaimed', 'UPDATE') AS watermark_can_update,",
          "has_table_privilege($1, 'public._kovo_replay_reclaimed', 'DELETE') AS watermark_can_delete,",
          "has_table_privilege($1, 'public._kovo_replay_reclaimed', 'TRUNCATE') AS watermark_can_truncate,",
          "has_table_privilege($1, 'public._kovo_replay_reclaimed', 'REFERENCES') AS watermark_can_references,",
          "has_table_privilege($1, 'public._kovo_replay_reclaimed', 'TRIGGER') AS watermark_can_trigger,",
          "has_any_column_privilege($1, 'public._kovo_replay_reclaimed', 'SELECT') AS watermark_can_any_column_select,",
          "has_any_column_privilege($1, 'public._kovo_replay_reclaimed', 'INSERT') AS watermark_can_any_column_insert,",
          "has_any_column_privilege($1, 'public._kovo_replay_reclaimed', 'UPDATE') AS watermark_can_any_column_update,",
          "has_any_column_privilege($1, 'public._kovo_replay_reclaimed', 'REFERENCES') AS watermark_can_any_column_references",
        ],
        ' ',
      ),
      [expected.role],
    );
    const privilegeRow =
      privileges === undefined ||
      postgresDenseArrayLength(privileges.rows, 'Postgres replay privilege rows') === 0
        ? undefined
        : postgresDenseArrayValue(privileges.rows, 0, 'Postgres replay privilege rows');
    if (privilegeRow === undefined) {
      appendPostgresDenseValue(issues, {
        code: 'KV433_REPLAY_STORE_ACL',
        detail: `could not verify replay-table privileges for ${expected.role}`,
      });
      continue;
    }
    const hasAll =
      privilegeRow.can_select === true &&
      privilegeRow.can_insert === true &&
      privilegeRow.can_update === true &&
      privilegeRow.can_delete === true &&
      privilegeRow.can_truncate === false &&
      privilegeRow.can_references === false &&
      privilegeRow.can_trigger === false &&
      privilegeRow.can_any_column_references === false;
    const watermarkHasAll =
      privilegeRow.watermark_can_select === true &&
      privilegeRow.watermark_can_update === true &&
      privilegeRow.watermark_can_insert === false &&
      privilegeRow.watermark_can_delete === false &&
      privilegeRow.watermark_can_truncate === false &&
      privilegeRow.watermark_can_references === false &&
      privilegeRow.watermark_can_trigger === false &&
      privilegeRow.watermark_can_any_column_select === true &&
      privilegeRow.watermark_can_any_column_insert === false &&
      privilegeRow.watermark_can_any_column_update === true &&
      privilegeRow.watermark_can_any_column_references === false;
    const hasAnyReplayPrivilege =
      privilegeRow.can_select === true ||
      privilegeRow.can_insert === true ||
      privilegeRow.can_update === true ||
      privilegeRow.can_delete === true ||
      privilegeRow.can_truncate === true ||
      privilegeRow.can_references === true ||
      privilegeRow.can_trigger === true ||
      privilegeRow.can_any_column_select === true ||
      privilegeRow.can_any_column_insert === true ||
      privilegeRow.can_any_column_update === true ||
      privilegeRow.can_any_column_references === true;
    const hasAnyWatermarkPrivilege =
      privilegeRow.watermark_can_select === true ||
      privilegeRow.watermark_can_insert === true ||
      privilegeRow.watermark_can_update === true ||
      privilegeRow.watermark_can_delete === true ||
      privilegeRow.watermark_can_truncate === true ||
      privilegeRow.watermark_can_references === true ||
      privilegeRow.watermark_can_trigger === true ||
      privilegeRow.watermark_can_any_column_select === true ||
      privilegeRow.watermark_can_any_column_insert === true ||
      privilegeRow.watermark_can_any_column_update === true ||
      privilegeRow.watermark_can_any_column_references === true;
    const watermarkHasReadOnly =
      privilegeRow.watermark_can_select === true &&
      privilegeRow.watermark_can_insert === false &&
      privilegeRow.watermark_can_update === false &&
      privilegeRow.watermark_can_delete === false &&
      privilegeRow.watermark_can_truncate === false &&
      privilegeRow.watermark_can_references === false &&
      privilegeRow.watermark_can_trigger === false &&
      privilegeRow.watermark_can_any_column_select === true &&
      privilegeRow.watermark_can_any_column_insert === false &&
      privilegeRow.watermark_can_any_column_update === false &&
      privilegeRow.watermark_can_any_column_references === false;
    const replayPrivilegesMatch = expected.allow ? hasAll : !hasAnyReplayPrivilege;
    const watermarkPrivilegesMatch = expected.allow
      ? watermarkHasAll
      : expected.watermarkRead
        ? watermarkHasReadOnly
        : !hasAnyWatermarkPrivilege;
    if (!replayPrivilegesMatch || !watermarkPrivilegesMatch) {
      appendPostgresDenseValue(issues, {
        code: 'KV433_REPLAY_STORE_ACL',
        detail: expected.allow
          ? `${expected.role} must have exactly SELECT, INSERT, UPDATE, DELETE on public._kovo_replay and SELECT, UPDATE on public._kovo_replay_reclaimed`
          : expected.watermarkRead
            ? `${expected.role} must have no access to public._kovo_replay and exactly SELECT on public._kovo_replay_reclaimed`
            : `${expected.role} must not have effective access to the replay truth or reclamation-watermark relations`,
      });
    }
  }
  return issues;
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
    postgresJoin(
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
      ],
      ' ',
    ),
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
  const issues: KovoPostgresPostureIssue[] = [];
  for (let index = 0; index < routineRows.rows.length; index += 1) {
    const row = postgresDenseValue(routineRows.rows, index, 'Postgres reachable routine rows');
    appendPostgresDenseValue(issues, {
      code: 'KV433_REACHABLE_ROUTINE',
      detail: `${row.routine_schema}.${row.routine_name} is a SECURITY DEFINER routine executable by ${row.role_name}; routine reachability has no vetted Kovo allowlist`,
    });
  }
  return issues;
}

async function postgresAuditedIdentityNames(
  client: RuntimeTransactionClient,
  config: ResolvedPostgresRuntimeConfig,
  runtimeLoginRole: string | undefined,
): Promise<readonly string[] | undefined> {
  if (runtimeLoginRole === undefined || runtimeLoginRole === '') {
    const identities: string[] = [];
    const seen = createWitnessSet<string>();
    appendUniquePostgresIdentity(identities, seen, config.readerRole);
    appendUniquePostgresIdentity(identities, seen, config.writerRole);
    appendUniquePostgresIdentity(identities, seen, config.adminRole);
    appendUniquePostgresIdentity(identities, seen, config.systemRole);
    return identities;
  }
  const rows = await safeQuery<{ rolname: string }>(
    client,
    postgresJoin(
      [
        'SELECT DISTINCT role.rolname',
        'FROM pg_catalog.pg_roles login',
        'JOIN pg_catalog.pg_roles role ON role.oid = login.oid OR pg_catalog.pg_has_role(login.oid, role.oid, $2)',
        'WHERE login.rolname = $1',
        'ORDER BY role.rolname',
      ],
      ' ',
    ),
    [runtimeLoginRole, 'MEMBER'],
  );
  return rows === undefined
    ? undefined
    : postgresIdentityNamesFromRows(rows.rows, 'Postgres audited identity rows');
}

async function postgresAppAuthorityIdentityNames(
  client: RuntimeTransactionClient,
  config: ResolvedPostgresRuntimeConfig,
  runtimeLoginRole: string | undefined,
): Promise<readonly string[] | undefined> {
  const roots = postgresAppAuthorityRootNames(config, runtimeLoginRole);
  const rows = await safeQuery<{ rolname: string }>(
    client,
    postgresJoin(
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
      ],
      ' ',
    ),
    [roots],
  );
  return rows === undefined
    ? undefined
    : postgresIdentityNamesFromRows(rows.rows, 'Postgres app authority identity rows');
}

/**
 * Complete identity set for relation and attached-code reachability.
 *
 * The four configured framework roles preserve the existing privileged-handle posture audit. The
 * runtime login and every role it can assume are additionally mandatory: managed-provider logins
 * can carry direct legacy relation grants that are not inherited from reader/writer, and those
 * grants still sit on the request-serving engine boundary (SPEC §10.3 C10).
 */
async function postgresRelationAuditIdentityNames(
  client: RuntimeTransactionClient,
  config: ResolvedPostgresRuntimeConfig,
  runtimeLoginRole: string | undefined,
): Promise<readonly string[] | undefined> {
  const appAuthorityIdentities = await postgresAppAuthorityIdentityNames(
    client,
    config,
    runtimeLoginRole,
  );
  if (appAuthorityIdentities === undefined) return undefined;

  const identities: string[] = [];
  const seen = createWitnessSet<string>();
  appendUniquePostgresIdentity(identities, seen, config.readerRole);
  appendUniquePostgresIdentity(identities, seen, config.writerRole);
  appendUniquePostgresIdentity(identities, seen, config.adminRole);
  appendUniquePostgresIdentity(identities, seen, config.systemRole);
  const appIdentityCount = postgresDenseArrayLength(
    appAuthorityIdentities,
    'Postgres app authority identities',
  );
  for (let index = 0; index < appIdentityCount; index += 1) {
    appendUniquePostgresIdentity(
      identities,
      seen,
      postgresDenseArrayValue(appAuthorityIdentities, index, 'Postgres app authority identities'),
    );
  }
  return identities;
}

function postgresAppAuthorityRootNames(
  config: ResolvedPostgresRuntimeConfig,
  runtimeLoginRole: string | undefined,
): string[] {
  const roots: string[] = [];
  const seen = createWitnessSet<string>();
  appendUniquePostgresIdentity(roots, seen, config.readerRole);
  appendUniquePostgresIdentity(roots, seen, config.writerRole);
  if (runtimeLoginRole !== undefined) {
    appendUniquePostgresIdentity(roots, seen, runtimeLoginRole);
  }
  return roots;
}

function appendUniquePostgresIdentity(
  identities: string[],
  seen: Set<string>,
  identity: string,
): void {
  if (identity === '' || witnessSetHas(seen, identity)) return;
  witnessSetAdd(seen, identity);
  appendPostgresDenseValue(identities, identity);
}

function postgresIdentityNamesFromRows(
  rows: readonly { rolname: string }[],
  label: string,
): string[] {
  const identities: string[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    appendPostgresDenseValue(identities, postgresDenseValue(rows, index, label).rolname);
  }
  return identities;
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
    postgresJoin(
      [
        'SELECT role.rolname, role.rolsuper, role.rolbypassrls, role.rolreplication, role.rolcreaterole, role.rolcreatedb,',
        "(role.oid < 16384 OR role.rolname LIKE 'pg\\_%') AS is_predefined",
        'FROM pg_catalog.pg_roles role',
        'WHERE role.rolname = ANY($1::text[])',
        'ORDER BY role.rolname',
      ],
      ' ',
    ),
    [auditedIdentities],
  );
  const adminOptionRows = await safeQuery<PostgresAdminOptionRow>(
    client,
    postgresJoin(
      [
        'WITH audited_names(role_name) AS (SELECT unnest($1::text[]))',
        'SELECT member_role.rolname AS member_role, granted_role.rolname AS role_name',
        'FROM pg_catalog.pg_auth_members membership',
        'JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member',
        'JOIN audited_names audited ON audited.role_name = member_role.rolname',
        'JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = membership.roleid',
        'WHERE membership.admin_option = true',
        'ORDER BY member_role.rolname, granted_role.rolname',
      ],
      ' ',
    ),
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
  const frameworkRoles = createWitnessSet<string>();
  witnessSetAdd(frameworkRoles, config.readerRole);
  witnessSetAdd(frameworkRoles, config.writerRole);
  witnessSetAdd(frameworkRoles, config.adminRole);
  witnessSetAdd(frameworkRoles, config.systemRole);
  for (let index = 0; index < roleRows.rows.length; index += 1) {
    const role = postgresDenseValue(roleRows.rows, index, 'Postgres role closure rows');
    if (role.rolname === config.adminRole || role.rolname === config.systemRole) {
      appendPostgresDenseValue(issues, {
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
      !witnessSetHas(frameworkRoles, role.rolname) &&
      !witnessSetHas(POSTGRES_BENIGN_PREDEFINED_ROLES, role.rolname)
    ) {
      appendPostgresDenseValue(issues, {
        code: 'KV433_RUNTIME_ROLE',
        detail: `reader/writer/runtime assumable-role closure includes PostgreSQL predefined role ${role.rolname}; predefined roles are denied unless explicitly classified benign`,
      });
    }
    if (postgresRoleElevatedAttributes(role).length > 0) {
      appendPostgresDenseValue(issues, {
        code: 'KV433_RUNTIME_ROLE',
        detail: `reader/writer/runtime assumable-role closure includes ${postgresRoleAttributeDetail(
          role,
        )}; every reachable role must have no elevated attributes`,
      });
    }
  }
  for (let index = 0; index < adminOptionRows.rows.length; index += 1) {
    const row = postgresDenseValue(
      adminOptionRows.rows,
      index,
      'Postgres closure admin-option rows',
    );
    appendPostgresDenseValue(issues, {
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
    postgresJoin(
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
      ],
      ' ',
    ),
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
    postgresJoin(
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
      ],
      ' ',
    ),
    postgresJoin(
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
      ],
      ' ',
    ),
    postgresJoin(
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
      ],
      ' ',
    ),
    postgresJoin(
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
      ],
      ' ',
    ),
    postgresJoin(
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
      ],
      ' ',
    ),
  ];
  const issues: KovoPostgresPostureIssue[] = [];
  const creationAuthorityRows = await postgresUnexpectedCreationAuthorityRows(
    client,
    auditedIdentities,
  );
  if (creationAuthorityRows === undefined) {
    appendPostgresDenseValue(issues, {
      code: 'KV433_REACHABILITY_AUDIT',
      detail:
        'could not enumerate effective non-system-schema CREATE or current-database CREATE/TEMPORARY authority',
    });
  } else {
    const creationRowCount = postgresDenseArrayLength(
      creationAuthorityRows,
      'Postgres creation authority rows',
    );
    for (let index = 0; index < creationRowCount; index += 1) {
      const row = postgresDenseArrayValue(
        creationAuthorityRows,
        index,
        'Postgres creation authority rows',
      );
      appendPostgresDenseValue(issues, {
        code: 'KV433_UNEXPECTED_PRIVILEGE',
        detail: `${row.role_name} has effective ${row.privilege_type} on ${row.object_kind} ${row.object_name}; runtime, reader, writer, PUBLIC, and every assumable role must not create unaudited schemas, objects, or temporary shadow relations`,
      });
    }
  }
  const queryCount = postgresDenseArrayLength(queries, 'Postgres privilege audit queries');
  for (let queryIndex = 0; queryIndex < queryCount; queryIndex += 1) {
    const query = postgresDenseArrayValue(queries, queryIndex, 'Postgres privilege audit queries');
    const rows = await safeQuery<PostgresUnexpectedPrivilegeRow>(client, query, [
      auditedIdentities,
    ]);
    if (rows === undefined) {
      appendPostgresDenseValue(issues, {
        code: 'KV433_REACHABILITY_AUDIT',
        detail: 'could not enumerate unexpected app-role ACL-bearing catalog privileges',
      });
      continue;
    }
    const rowCount = postgresDenseArrayLength(rows.rows, 'Postgres unexpected privilege rows');
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const row = postgresDenseArrayValue(
        rows.rows,
        rowIndex,
        'Postgres unexpected privilege rows',
      );
      appendPostgresDenseValue(issues, {
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
    postgresJoin(
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
      ],
      ' ',
    ),
    ['pg_class'],
  );
  if (rows === undefined) return undefined;
  const sequences = createWitnessSet<string>();
  const rowCount = postgresDenseArrayLength(rows.rows, 'Postgres protected sequence rows');
  for (let index = 0; index < rowCount; index += 1) {
    const row = postgresDenseArrayValue(rows.rows, index, 'Postgres protected sequence rows');
    if (
      witnessSetHas(
        protectedRelations as Set<string>,
        postgresRelationKey(row.table_schema, row.table_name),
      )
    ) {
      witnessSetAdd(sequences, postgresRelationKey(row.sequence_schema, row.sequence_name));
    }
  }
  return sequences;
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
  const client = pinPostgresPgliteInstance(new PGlite(config.dataDir));
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
    postureSql: client,
    sql: client,
  };
}

function pinPostgresPgliteInstance(client: PGlite): PGlite {
  if (postgresIsProxy(client)) throw new TypeError('PGlite client must not be a Proxy.');
  defineCapturedPostgresMethod(client, 'close', postgresPgliteClose, client);
  defineCapturedPostgresMethod(client, 'exec', postgresPgliteExec, client);
  defineCapturedPostgresMethod(client, 'query', postgresPgliteQuery, client);
  witnessDefineProperty(client, 'transaction', {
    configurable: false,
    enumerable: false,
    value: <Result>(
      callback: (tx: RuntimeTransactionClient) => Promise<Result>,
      ...args: unknown[]
    ): Promise<Result> => invokeCapturedPgliteTransaction(client, callback, args),
    writable: false,
  });
  return client;
}

function defineCapturedPostgresMethod(
  target: object,
  property: PropertyKey,
  method: Function,
  receiver: object,
): void {
  witnessDefineProperty(target, property, {
    configurable: false,
    enumerable: false,
    value: (...args: unknown[]) => witnessReflectApply(method, receiver, args),
    writable: false,
  });
}

function invokeCapturedPgliteTransaction<Result>(
  receiver: object,
  callback: (tx: RuntimeTransactionClient) => Promise<Result>,
  trailingArgs: readonly unknown[],
): Promise<Result> {
  if (typeof callback !== 'function') {
    throw new TypeError('PGlite transaction callback must be callable.');
  }
  return runExactlyOnceAdapter(
    (run) => {
      const invocationArgs: unknown[] = [run];
      appendPostgresDenseValues(
        invocationArgs,
        trailingArgs,
        'PGlite transaction invocation arguments',
      );
      return witnessReflectApply<Promise<Result>>(
        postgresPgliteTransaction,
        receiver,
        invocationArgs,
      );
    },
    (transaction: unknown) => callback(pinPostgresPgliteTransactionClient(transaction)),
  );
}

function pinPostgresPgliteTransactionClient(transaction: unknown): RuntimeTransactionClient {
  if (!isRecord(transaction) || postgresIsProxy(transaction)) {
    throw new TypeError('PGlite transaction client must be a non-Proxy object.');
  }
  const exec = capturePostgresOwnCallable(transaction, 'exec', 'PGlite transaction exec');
  const query = capturePostgresOwnCallable(transaction, 'query', 'PGlite transaction query');
  const facade = witnessCreateNullRecord<unknown>();
  defineCapturedPostgresMethod(facade, 'exec', exec, transaction);
  defineCapturedPostgresMethod(facade, 'query', query, transaction);
  witnessDefineProperty(facade, 'transaction', {
    configurable: false,
    enumerable: false,
    value: <Result>(
      callback: (tx: RuntimeTransactionClient) => Promise<Result>,
      ...args: unknown[]
    ): Promise<Result> => invokeCapturedPgliteTransaction(transaction, callback, args),
    writable: false,
  });
  return witnessFreeze(facade) as unknown as RuntimeTransactionClient;
}

function pinNodePostgresPool(pool: Pool): Pool {
  if (postgresIsProxy(pool)) throw new TypeError('node-postgres Pool must not be a Proxy.');
  if (witnessWeakMapGet(postgresPinnedNodePools, pool) === true) return pool;
  defineCapturedNodePostgresPoolInternals(pool);
  defineCapturedPostgresMethod(pool, 'end', postgresPoolEnd, pool);
  defineCapturedPostgresMethod(pool, 'query', postgresPoolQuery, pool);
  witnessDefineProperty(pool, 'connect', {
    configurable: false,
    enumerable: false,
    value: (...args: unknown[]): unknown => invokePinnedNodePostgresConnect(pool, args),
    writable: false,
  });
  witnessWeakMapSet(postgresPinnedNodePools, pool, true);
  return pool;
}

function defineCapturedNodePostgresPoolInternals(pool: Pool): void {
  witnessMapForEach(postgresPoolPrototypeMethods, (method, property) => {
    if (property === 'connect' || property === 'query' || property === 'end') return;
    witnessDefineProperty(pool, property, {
      configurable: false,
      enumerable: false,
      value: (...args: unknown[]) => {
        if (property === 'newClient') {
          assertPostgresPrototypeMethods(
            Client.prototype,
            postgresClientPrototypeMethods,
            'node-postgres Client',
          );
        }
        return witnessReflectApply(method, pool, args);
      },
      writable: false,
    });
  });
}

function assertPostgresPrototypeMethods(
  prototype: object,
  expected: ReadonlyMap<PropertyKey, Function>,
  label: string,
): void {
  if (postgresIsProxy(prototype)) throw new TypeError(`${label} prototype must not be a Proxy.`);
  witnessMapForEach(expected, (method, property) => {
    const descriptor = witnessGetOwnPropertyDescriptor(prototype, property);
    if (descriptor === undefined || !('value' in descriptor) || descriptor.value !== method) {
      throw new TypeError(`${label}.${String(property)} changed after framework bootstrap.`);
    }
  });
}

function invokePinnedNodePostgresConnect(pool: Pool, args: readonly unknown[]): unknown {
  const argumentCount = postgresDenseArrayLength(args, 'node-postgres Pool.connect arguments');
  const firstArgument =
    argumentCount === 0
      ? undefined
      : postgresDenseArrayValue(args, 0, 'node-postgres Pool.connect arguments');
  if (typeof firstArgument === 'function') {
    const invocationArgs: unknown[] = [
      (...callbackArgs: unknown[]): unknown => {
        const pinnedCallbackArgs: unknown[] = [];
        appendPostgresDenseValues(
          pinnedCallbackArgs,
          callbackArgs,
          'node-postgres Pool.connect callback arguments',
        );
        const rawClient =
          callbackArgs.length > 1
            ? postgresDenseArrayValue(
                callbackArgs,
                1,
                'node-postgres Pool.connect callback arguments',
              )
            : undefined;
        if (isRecord(rawClient)) {
          const client = pinNodePostgresPoolClient(rawClient as unknown as PoolClient);
          witnessDefineProperty(pinnedCallbackArgs, 1, {
            configurable: true,
            enumerable: true,
            value: client,
            writable: true,
          });
          witnessDefineProperty(pinnedCallbackArgs, 2, {
            configurable: true,
            enumerable: true,
            value: (error?: Error | boolean) => releasePinnedNodePostgresPoolClient(client, error),
            writable: true,
          });
        }
        return witnessReflectApply(firstArgument, undefined, pinnedCallbackArgs);
      },
    ];
    for (let index = 1; index < argumentCount; index += 1) {
      appendPostgresValue(
        invocationArgs,
        postgresDenseArrayValue(args, index, 'node-postgres Pool.connect arguments'),
      );
    }
    return witnessReflectApply(postgresPoolConnect, pool, invocationArgs);
  }
  return (async (): Promise<PoolClient> => {
    const client = await witnessReflectApply<Promise<PoolClient>>(postgresPoolConnect, pool, args);
    return pinNodePostgresPoolClient(client);
  })();
}

function pinNodePostgresPoolClient(client: PoolClient): PoolClient {
  if (!isRecord(client) || postgresIsProxy(client)) {
    throw new TypeError('node-postgres pooled Client must not be a Proxy.');
  }
  snapshotNodePostgresPoolClientRelease(client);
  if (witnessWeakMapGet(postgresPinnedNodeClients, client) !== true) {
    witnessMapForEach(postgresClientPrototypeMethods, (method, property) => {
      if (property === 'query') return;
      defineCapturedPostgresMethod(client, property, method, client);
    });
    defineCapturedPostgresMethod(client, 'query', postgresClientQuery, client);
    witnessWeakMapSet(postgresPinnedNodeClients, client, true);
  }
  return client;
}

function snapshotNodePostgresPoolClientRelease(client: PoolClient): void {
  const release = capturePostgresOwnCallable(
    client,
    'release',
    'node-postgres pooled Client.release',
  );
  witnessWeakMapSet(postgresNodeClientReleaseValues, client, release);
}

function releasePinnedNodePostgresPoolClient(client: PoolClient, error?: Error | boolean): void {
  const release = witnessWeakMapGet(postgresNodeClientReleaseValues, client);
  if (release === undefined) {
    throw new TypeError('node-postgres pooled Client.release was not captured for this checkout.');
  }
  witnessReflectApply(release, client, error === undefined ? [] : [error]);
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
  const pool = createFrameworkNodePostgresPool(config.databaseUrl);
  const transactionalClient = new NodePostgresRuntimeClient(pool);
  const adminTransactionalClient = createOptionalNodePostgresRuntimeClient(config.adminDatabaseUrl);
  const systemTransactionalClient = createOptionalNodePostgresRuntimeClient(
    config.systemDatabaseUrl,
  );
  // SPEC §10.3: the system role already owns the exact durable replay truth, so it is the
  // least-privilege authority for boot/check posture. The admin/owner connection is only a
  // fallback for deployments that have not supplied the dedicated system URL.
  const postureTransactionalClient =
    systemTransactionalClient ?? adminTransactionalClient ?? transactionalClient;
  return {
    close: () =>
      closeNodePostgresRuntimeClients(
        [transactionalClient, adminTransactionalClient, systemTransactionalClient],
        [
          unregisterDatabaseEgressUrl,
          unregisterAdminDatabaseEgressUrl,
          unregisterSystemDatabaseEgressUrl,
        ],
      ),
    drizzleInternalDb: (capability) => {
      assertInternalPostgresRuntimeDbCapability(capability);
      return drizzleNodePg({ client: pool, relations });
    },
    drizzleReadonlyDb: (principal, role, roleSetting) =>
      createScopedNodePostgresDrizzleDb(
        createPostgresReadonlyClient(
          nodePostgresScopedRuntimeClient(config, transactionalClient, {
            adminClient: adminTransactionalClient,
            roleSetting,
            systemClient: systemTransactionalClient,
          }),
          postgresReadonlyClientOptions(config, principal, role, roleSetting),
        ),
        relations,
      ),
    drizzleRequestDb: (principal, roleSetting) =>
      createScopedNodePostgresDrizzleDb(
        createPostgresScopedClient(
          nodePostgresScopedRuntimeClient(config, transactionalClient, {
            adminClient: adminTransactionalClient,
            roleSetting,
            systemClient: systemTransactionalClient,
          }),
          postgresScopedClientOptions(config, principal, roleSetting),
        ),
        relations,
      ),
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
    postureSql: postureTransactionalClient,
    sql: transactionalClient,
  };
}

async function closeNodePostgresRuntimeClients(
  clients: readonly (NodePostgresRuntimeClient | undefined)[],
  unregisterEgressUrls: readonly ((() => void) | undefined)[],
): Promise<void> {
  let closeFailed = false;
  let closeError: unknown;
  try {
    for (let index = 0; index < clients.length; index += 1) {
      const client = postgresDenseArrayValue(clients, index, 'Postgres runtime close clients');
      try {
        await client?.close();
      } catch (error) {
        if (!closeFailed) closeError = error;
        closeFailed = true;
      }
    }
    if (closeFailed) throw closeError;
  } finally {
    for (let index = 0; index < unregisterEgressUrls.length; index += 1) {
      postgresDenseArrayValue(
        unregisterEgressUrls,
        index,
        'Postgres runtime egress unregister callbacks',
      )?.();
    }
  }
}

/**
 * Bind Drizzle's callback transaction surface to Kovo's already-scoped client transaction.
 *
 * NodePgSession otherwise emits its own `BEGIN` through `client.query()`. That is correctly denied
 * by the scoped client as app-controlled transaction text, and it would also place the Drizzle
 * callback outside Kovo's role/principal frame. This own method keeps the whole callback inside the
 * framework transaction and reconstructs the Drizzle handle over the transaction-scoped client
 * (SPEC §10.3/§11.2).
 */
function createScopedNodePostgresDrizzleDb(
  client: object,
  relations: AnyRelations,
): NodePgDatabase {
  const transaction = capturePostgresCallable(
    client,
    'transaction',
    'Postgres managed Drizzle transaction',
  );
  const db = drizzleNodePg({ client: client as Pool, relations });
  witnessDefineProperty(db, 'transaction', {
    // The authorization-census proxy must be able to reflect this own authority method without
    // inheriting a non-configurable target invariant. Its own traps still deny app mutation.
    configurable: true,
    enumerable: false,
    value<Result>(
      callback: (tx: NodePgDatabase) => Promise<Result> | Result,
      ...args: unknown[]
    ): Promise<Result> {
      if (typeof callback !== 'function') {
        throw new TypeError('Postgres managed Drizzle transactions require a callback.');
      }
      const wrappedCallback = (transactionClient: object): Promise<Result> | Result =>
        witnessReflectApply(callback, undefined, [
          createScopedNodePostgresDrizzleDb(transactionClient, relations),
        ]);
      const invocationArgs: unknown[] = [wrappedCallback];
      appendPostgresDenseValues(invocationArgs, args, 'Postgres managed transaction arguments');
      return witnessReflectApply<Promise<Result>>(transaction, client, invocationArgs);
    },
    writable: false,
  });
  return db;
}

function createOptionalNodePostgresRuntimeClient(
  databaseUrl: string | undefined,
): NodePostgresRuntimeClient | undefined {
  return databaseUrl === undefined
    ? undefined
    : new NodePostgresRuntimeClient(createFrameworkNodePostgresPool(databaseUrl));
}

function createFrameworkNodePostgresPool(databaseUrl: string | undefined): Pool {
  if (databaseUrl === undefined) {
    throw new Error(
      'KV433_POSTGRES_URL: node-postgres requires an explicit databaseUrl/KOVO_DATABASE_URL (SPEC §10.3).',
    );
  }
  return pinNodePostgresPool(
    new Pool({
      connectionString: databaseUrl,
      // SPEC §6.6/§10.3: the private DB endpoint exemption belongs to this framework-owned
      // Postgres carrier. Merely registering the URL must not open the same host:port to ambient
      // fetch/node:http/raw TCP calls that can be steered by a remote request.
      stream: () => createDatabaseEgressSocket(databaseUrl),
    } satisfies PoolConfig),
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
  let governedDb: KovoPostgresRuntimeDb;
  governedDb = createFrameworkAuthorizationCensusDb(
    db,
    {
      dialectLabel: client.label,
      metadata,
      normalizeTableName: normalizePolicyTable,
      tableNames: pgTablePolicyNames,
    },
    () => createRequestScopedReadonlyDb(client, config, metadata, scope, request),
    (policy: DeclaredWritePolicy) =>
      createDeclaredWriteDb(governedDb, policy, {
        dialectLabel: client.label,
        governedColumns: metadata,
        normalizeTableName: normalizePolicyTable,
        tableNames: pgTablePolicyNames,
      }),
  );
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
    witnessSetSize(config.crossOwnerReadTables) === 0
      ? undefined
      : client.drizzleReadonlyDb(scope.principal, config.readerRole, 'admin');
  const adminReadSql =
    witnessSetSize(config.crossOwnerReadTables) === 0
      ? undefined
      : client.readonlySql(scope.principal, config.readerRole, 'admin');
  const crossOwnerRead =
    adminReadDb === undefined || adminReadSql === undefined
      ? undefined
      : {
          adminClient: adminReadDb as object,
          dialect: 'postgres' as const,
          dialectLabel: client.label,
          executeSql: async (statement: { params: readonly unknown[]; text: string }) =>
            (
              await adminReadSql.query(
                statement.text,
                snapshotPostgresQueryParams(statement.params),
              )
            ).rows,
          hasRole: (role: 'admin') => requestPassedRoleGuard(request, role),
          normalizeTableName: normalizePolicyTable,
          ownerTables: postgresSetValues(config.crossOwnerReadTables),
          ...(scope.principal === undefined ? {} : { principal: scope.principal }),
        };
  const rawRead = {
    dialect: 'postgres' as const,
    dialectLabel: client.label,
    executeSql: async (statement: { params: readonly unknown[]; text: string }) =>
      (await readSql.query(statement.text, snapshotPostgresQueryParams(statement.params))).rows,
    normalizeTableName: normalizePolicyTable,
    ownerTables: postgresOwnerScopedTableNames(metadata),
  };
  const privilegedRawRead = {
    dialect: 'postgres' as const,
    dialectLabel: client.label,
    executeSql: async (statement: { params: readonly unknown[]; text: string }) =>
      (await privilegedReadSql.query(statement.text, snapshotPostgresQueryParams(statement.params)))
        .rows,
    normalizeTableName: normalizePolicyTable,
    ownerTables: postgresOwnerScopedTableNames(metadata),
  };
  const readOptions = crossOwnerRead === undefined ? { rawRead } : { crossOwnerRead, rawRead };
  return createSecretBoxingReadDb(readonlyDb(readDb, readOptions), metadata, {
    executeSql: async (statement) =>
      (await readSql.query(statement.text, postgresSecretReadParams(statement.params))).rows,
    privilegedDb: readonlyDb(privilegedReadDb, { rawRead: privilegedRawRead }),
    rawSecretTableRead: 'engine',
  });
}

function postgresSecretReadParams(values: readonly unknown[]): unknown[] {
  const snapshot: unknown[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(values, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Postgres secret-read parameters must be a dense own-data array.');
    }
    witnessDefineProperty(snapshot, index, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
  }
  return snapshot;
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
    if (witnessWeakMapGet(postgresNodeClientReleaseValues, client) === undefined) {
      snapshotNodePostgresPoolClientRelease(client);
    }
    const tx = new NodePostgresTransactionClient(client);
    let result: Result | undefined;
    let primaryError: unknown;
    try {
      await client.query('BEGIN');
      result = await callback(tx);
      await client.query('COMMIT');
    } catch (error) {
      primaryError = error;
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the primary transaction failure while still attempting session cleanup below.
      }
    }
    const cleanupError = await discardNodePostgresSession(client);
    releasePinnedNodePostgresPoolClient(client, cleanupError);
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
  externalSessionSettingIssue(
    settings: readonly { context: string; name: string; setting: string; source: string }[],
  ): KovoPostgresPostureIssue | undefined {
    return postgresExternalSessionSettingRowsIssue(settings);
  },
  createRuntimeClient(config: ResolvedPostgresRuntimeConfig): CreatedRuntimeClient {
    return createRuntimeClient(config);
  },
  createNodePostgresRuntimeClient(pool: Pool): RuntimeSqlClient {
    return new NodePostgresRuntimeClient(pool instanceof Pool ? pinNodePostgresPool(pool) : pool);
  },
  pinNodePostgresPoolClient(client: PoolClient): PoolClient {
    return pinNodePostgresPoolClient(client);
  },
  releasePinnedNodePostgresPoolClient(client: PoolClient, error?: Error | boolean): void {
    releasePinnedNodePostgresPoolClient(client, error);
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
      try {
        await this.client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      } catch {
        // Preserve the primary nested-transaction failure; outer cleanup still runs.
      }
      throw error;
    }
  }
}

function resolvePostgresRuntimeConfig(
  options: PostgresRuntimeConfigInput,
): ResolvedPostgresRuntimeConfig {
  return resolvePostgresRuntimeConfigSnapshot(snapshotPostgresRuntimeConfigInput(options));
}

function resolvePostgresRuntimeConfigSnapshot(
  options: PostgresRuntimeConfigInput,
): ResolvedPostgresRuntimeConfig {
  const driver = resolveDriver(options);
  const databaseUrl = options.databaseUrl ?? runtimeEnvironmentValue('KOVO_DATABASE_URL');
  const adminDatabaseUrl = options.adminDatabaseUrl ?? runtimeEnvironmentValue('KOVO_DB_ADMIN_URL');
  const systemDatabaseUrl =
    options.systemDatabaseUrl ?? runtimeEnvironmentValue('KOVO_DB_SYSTEM_URL');
  if (driver === 'node-postgres') {
    if (databaseUrl === undefined) {
      throw new Error(
        'KV433_POSTGRES_URL: node-postgres requires an explicit databaseUrl/KOVO_DATABASE_URL so Kovo and pg consume the same reviewed transport authority (SPEC §10.3).',
      );
    }
    assertManagedPostgresTransportUrl('databaseUrl', databaseUrl);
    assertManagedPostgresTransportUrl('adminDatabaseUrl', adminDatabaseUrl);
    assertManagedPostgresTransportUrl('systemDatabaseUrl', systemDatabaseUrl);
  }
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
    dataDir: options.dataDir ?? runtimeEnvironmentValue('KOVO_DATA_DIR') ?? DEFAULT_DATA_DIR,
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

type ManagedPostgresUrlLabel =
  | 'adminDatabaseUrl'
  | 'databaseUrl'
  | 'runtimeDatabaseUrl'
  | 'systemDatabaseUrl';

/**
 * Refuse remote database credentials before pool construction unless pg will authenticate both
 * the certificate chain and the server hostname. The exact mode is intentional: pinned pg 8 treats
 * several weaker libpq names as temporary aliases today and has announced weaker pg 9 semantics.
 * Kovo must not silently change its transport proof when that dependency changes (SPEC §10.3).
 */
function assertManagedPostgresTransportUrl(
  label: ManagedPostgresUrlLabel,
  databaseUrl: string | undefined,
): void {
  if (databaseUrl === undefined) return;
  const facts = databaseEgressUrlFacts(databaseUrl);
  if (facts === null) {
    throw new Error(
      `KV433_POSTGRES_URL: ${label} must be a valid postgres:// or postgresql:// connection string (SPEC §10.3).`,
    );
  }
  assertCanonicalPostgresIdentity(label, facts);
  if (facts.unixSocket) return;
  if (isExactLocalPostgresEndpoint(facts)) return;
  assertCanonicalRemotePostgresAuthority(label, facts);
  if (runtimeEnvironmentValue('NODE_TLS_REJECT_UNAUTHORIZED') === '0') {
    throw new Error(
      `KV433_POSTGRES_TLS_ENV: non-local ${label} is forbidden while NODE_TLS_REJECT_UNAUTHORIZED=0 disables Node certificate verification (SPEC §10.3).`,
    );
  }
  if (classifyHost(facts.host) !== null) {
    throw new Error(
      `KV433_POSTGRES_TLS_HOST: non-local ${label} must use a DNS hostname, not an IP literal, because pinned node-postgres does not verify IP literals against the certificate identity (SPEC §10.3).`,
    );
  }
  if (facts.sslMode !== 'verify-full') {
    throw new Error(
      `KV433_POSTGRES_TLS: non-local ${label} must include exact sslmode=verify-full so Postgres authenticates the certificate chain and server hostname (SPEC §10.3).`,
    );
  }
}

function isExactLocalPostgresEndpoint(
  facts: NonNullable<ReturnType<typeof databaseEgressUrlFacts>>,
): boolean {
  // Compare the exact string pinned pg passes to net.connect. In particular, pg retains brackets
  // on an IPv6 URL authority (`[::1]`), which is not the working `::1` carrier and must not inherit
  // the cleartext-local exception. A query `host=%3A%3A1` produces the exact working value.
  return facts.host === '127.0.0.1' || facts.host === '::1';
}

function assertCanonicalPostgresIdentity(
  label: ManagedPostgresUrlLabel,
  facts: NonNullable<ReturnType<typeof databaseEgressUrlFacts>>,
): void {
  if (
    (facts.queryUserOverride !== undefined && facts.queryUserOverride !== '') ||
    (facts.queryDatabaseOverride !== undefined && facts.queryDatabaseOverride !== '')
  ) {
    throw new Error(
      `KV433_POSTGRES_AUTHORITY: ${label} must keep user and database in the URL authority/path; query overrides are forbidden (SPEC §10.3).`,
    );
  }
  if (
    !facts.authorityPortExplicit &&
    (facts.queryPortOverride === undefined || facts.queryPortOverride === '')
  ) {
    throw new Error(
      `KV433_POSTGRES_AUTHORITY: ${label} must include an explicit decimal port so PGPORT cannot retarget the connection (SPEC §10.3).`,
    );
  }
  if (facts.authorityUsername === '') {
    throw new Error(
      `KV433_POSTGRES_AUTHORITY: ${label} must include a nonempty authority username so PGUSER cannot select the login role (SPEC §10.3).`,
    );
  }
  if (!facts.databasePathPresent) {
    throw new Error(
      `KV433_POSTGRES_AUTHORITY: ${label} must include a nonempty database path so PGDATABASE cannot select the database (SPEC §10.3).`,
    );
  }
}

function assertCanonicalRemotePostgresAuthority(
  label: ManagedPostgresUrlLabel,
  facts: NonNullable<ReturnType<typeof databaseEgressUrlFacts>>,
): void {
  if (
    (facts.queryHostOverride !== undefined && facts.queryHostOverride !== '') ||
    (facts.queryPortOverride !== undefined && facts.queryPortOverride !== '')
  ) {
    throw new Error(
      `KV433_POSTGRES_AUTHORITY: non-local ${label} must keep host, port, user, and database in the URL authority/path; query overrides are forbidden (SPEC §10.3).`,
    );
  }
}

function resolvePostgresPostureCheck(
  options: PostgresRuntimeConfigInput,
  defaultOnBoot: boolean,
): { onBoot: boolean; optOut?: PostgresPostureCheckOptOut } {
  if (options.postureCheckOnBoot !== undefined) {
    return { onBoot: options.postureCheckOnBoot };
  }

  const postureCheckValue = options.postureCheck;
  const postureCheck =
    postureCheckValue === undefined || !isRecord(postureCheckValue)
      ? postureCheckValue
      : postgresOwnDataSnapshot(postureCheckValue, 'Postgres posture-check options');
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

  const justification = snapshotAuditJustification(
    postureCheck.justification,
    'KV433 postureCheck: { onBoot: false } for kovo explain --capabilities (SPEC §10.3)',
  );
  const site = postureCheck.site;
  return {
    onBoot: false,
    optOut: {
      justification: securityStringTrim(justification),
      ...(site === undefined
        ? {}
        : {
            site: securityStringTrim(
              snapshotAuditText(site, 'KV433 postureCheck opt-out site (SPEC §10.3)'),
            ),
          }),
    },
  };
}

function nonEmptyEnv(name: string): string | undefined {
  const value = runtimeEnvironmentValue(name);
  return value === undefined || value === '' ? undefined : value;
}

function normalizeStringSet(values: readonly string[] | undefined): ReadonlySet<string> {
  const normalized = createWitnessSet<string>();
  if (values === undefined) return normalized;
  const valueCount = postgresDenseArrayLength(values, 'Postgres string-list option');
  for (let index = 0; index < valueCount; index += 1) {
    const value = postgresDenseArrayValue(values, index, 'Postgres string-list option');
    if (typeof value !== 'string') {
      throw new TypeError('KV433: Postgres string-list options must contain strings.');
    }
    const trimmed = securityStringTrim(value);
    if (trimmed !== '') witnessSetAdd(normalized, trimmed);
  }
  return normalized;
}

function normalizedPublicRelationDeclaration(
  value: KovoPostgresPublicRelationDeclarationOptions,
): KovoPostgresPublicRelationDeclarationOptions {
  if (!isRecord(value)) {
    throw new Error('KV433: declarePublicRelation requires a declaration object (SPEC §10.3).');
  }
  const declaration = postgresOwnDataSnapshot(value, 'Postgres public-relation declaration');
  const relation = normalizePostgresRelationName(declaration.relation);
  const reason = snapshotAuditReason(
    declaration.reason,
    'KV433 declarePublicRelation() (SPEC §10.3)',
  );
  const site = declaration.site;
  const closedSite =
    site === undefined
      ? undefined
      : snapshotAuditText(site, 'KV433 declarePublicRelation() site (SPEC §10.3)');
  return {
    relation,
    reason: securityStringTrim(reason),
    ...(closedSite === undefined ? {} : { site: securityStringTrim(closedSite) }),
  };
}

function normalizePublicRelationDeclarations(
  declarations: readonly KovoPostgresPublicRelationDeclaration[] | undefined,
): ReadonlyMap<string, KovoPostgresPublicRelationDeclaration> {
  const publicRelations = createWitnessMap<string, KovoPostgresPublicRelationDeclaration>();
  if (declarations === undefined) return publicRelations;
  const declarationCount = postgresDenseArrayLength(
    declarations,
    'Postgres public-relation declarations',
  );
  for (let index = 0; index < declarationCount; index += 1) {
    const rawDeclaration = postgresDenseArrayValue(
      declarations,
      index,
      'Postgres public-relation declarations',
    );
    if (!isRecord(rawDeclaration)) {
      throw new Error(
        'KV433: publicRelations entries must be created with declarePublicRelation(...) (SPEC §10.3).',
      );
    }
    const declaration = postgresOwnDataSnapshot(
      rawDeclaration,
      'Postgres public-relation declaration',
    ) as KovoPostgresPublicRelationDeclaration;
    if (!isPublicRelationDeclaration(declaration)) {
      throw new Error(
        'KV433: publicRelations entries must be created with declarePublicRelation(...) (SPEC §10.3).',
      );
    }
    const key = normalizePostgresRelationName(declaration.relation);
    if (witnessMapHas(publicRelations, key)) {
      throw new Error(`KV433: duplicate declarePublicRelation entry for ${key}.`);
    }
    witnessMapSet(publicRelations, key, declaration);
  }
  return publicRelations;
}

function isPublicRelationDeclaration(
  value: unknown,
): value is KovoPostgresPublicRelationDeclaration {
  if (!isRecord(value)) return false;
  const brand = postgresOwnDataValue(value, publicPostgresRelationBrand);
  const relation = postgresOwnDataValue(value, 'relation');
  const reason = postgresOwnDataValue(value, 'reason');
  return brand !== undefined && typeof relation === 'string' && typeof reason === 'string';
}

function normalizePostgresRelationName(relation: unknown): string {
  if (typeof relation !== 'string') {
    throw new Error('KV433: declarePublicRelation relation must be a string (SPEC §10.3).');
  }
  const rawParts = securityStringSplit(securityStringTrim(relation), '.');
  const parts = postgresMapDense(
    rawParts,
    (part) => securityStringTrim(part),
    'Postgres public-relation name parts',
  );
  if (parts.length === 1) {
    const table = postgresDenseArrayValue(parts, 0, 'Postgres public-relation name parts');
    if (table === undefined) {
      throw new Error('KV433: declarePublicRelation relation must name a relation.');
    }
    return postgresRelationKey('public', normalizedIdentifierPart(table));
  }
  if (parts.length === 2) {
    const schema = postgresDenseArrayValue(parts, 0, 'Postgres public-relation name parts');
    const table = postgresDenseArrayValue(parts, 1, 'Postgres public-relation name parts');
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
  if (!securityRegExpTest(/^[A-Za-z_][A-Za-z0-9_$]*$/u, part)) {
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
  const rawDriver = options.driver ?? runtimeEnvironmentValue('KOVO_DB_DRIVER');
  if (rawDriver === 'pglite') return 'pglite';
  if (rawDriver === 'node-postgres' || rawDriver === 'pg') return 'node-postgres';
  if (rawDriver !== undefined && rawDriver !== '') {
    throw new Error(`KV433: unsupported Kovo Postgres driver ${rawDriver}.`);
  }
  return options.databaseUrl !== undefined || runtimeEnvironmentValue('KOVO_DATABASE_URL')
    ? 'node-postgres'
    : 'pglite';
}

function normalizeSeedSql(seedSql: string | readonly string[] | undefined): readonly string[] {
  if (seedSql === undefined) return [];
  if (typeof seedSql === 'string') return witnessFreeze([seedSql]);
  const statements: string[] = [];
  const statementCount = postgresDenseArrayLength(seedSql, 'Postgres seed SQL');
  for (let index = 0; index < statementCount; index += 1) {
    const statement = postgresDenseArrayValue(seedSql, index, 'Postgres seed SQL');
    if (typeof statement !== 'string') {
      throw new TypeError('KV433: Postgres seedSql entries must be strings.');
    }
    appendPostgresValue(statements, statement);
  }
  return witnessFreeze(statements);
}

function postgresTablesFromSchema(schema: Record<string, unknown>): PgTable[] {
  const tables: PgTable[] = [];
  const seen = createWitnessSet<unknown>();
  const values = postgresOwnDataValues(schema);
  const valueCount = postgresDenseArrayLength(values, 'Postgres schema values');
  for (let index = 0; index < valueCount; index += 1) {
    const value = postgresDenseArrayValue(values, index, 'Postgres schema values');
    if (witnessSetHas(seen, value)) continue;
    const table = asPgTable(value);
    if (table === undefined) continue;
    appendPostgresValue(tables, table);
    witnessSetAdd(seen, value);
  }
  if (postgresDenseArrayLength(tables, 'Postgres schema tables') === 0) {
    throw new Error('KV433: Postgres runtime could not derive any Drizzle pgTable exports.');
  }
  assertPostgresUniqueBaseTableNames(tables);
  return tables;
}

function assertPostgresUniqueBaseTableNames(tables: readonly PgTable[]): void {
  // SPEC §10.3 (C9/C10): authorization metadata, owner chains, grant allowlists, and policy
  // dependencies currently share the Drizzle base table name as their closed-world key. Until the
  // whole security pipeline uses schema-qualified relation identities, accepting the same base
  // name in two schemas could merge a public classification into a secret relation (or vice versa).
  const relationsByBaseName = createWitnessMap<string, string>();
  const tableCount = postgresDenseArrayLength(tables, 'Postgres schema tables');
  for (let index = 0; index < tableCount; index += 1) {
    const config = getTableConfig(postgresDenseArrayValue(tables, index, 'Postgres schema tables'));
    const baseName = config.name;
    const relation = `${tableSchemaName(config)}.${baseName}`;
    const previous = witnessMapGet(relationsByBaseName, baseName);
    if (previous !== undefined) {
      throw new Error(
        `KV433_DUPLICATE_TABLE_NAME: Postgres runtime schema declares both ${previous} and ${relation}; base table names must be globally unique until every authorization and grant key is schema-qualified (SPEC §10.3 C9/C10).`,
      );
    }
    witnessMapSet(relationsByBaseName, baseName, relation);
  }
}

function postgresRelationSchemaFromModule(
  schema: Record<string, unknown>,
): Record<string, PgTable> {
  const tables = witnessCreateNullRecord<PgTable>();
  const seen = createWitnessSet<unknown>();
  const entries = postgresOwnDataEntries(schema);
  const entryCount = postgresDenseArrayLength(entries, 'Postgres relation schema entries');
  for (let index = 0; index < entryCount; index += 1) {
    const entry: [string, unknown] = postgresDenseArrayValue(
      entries,
      index,
      'Postgres relation schema entries',
    );
    const name = postgresDenseArrayValue(entry, 0, 'Postgres relation schema entry');
    if (typeof name !== 'string') {
      throw new TypeError('Postgres relation schema entry names must be strings.');
    }
    const value = postgresDenseArrayValue(entry, 1, 'Postgres relation schema entry');
    if (witnessSetHas(seen, value)) continue;
    const table = asPgTable(value);
    if (table === undefined) continue;
    witnessDefineProperty(tables, name, {
      configurable: true,
      enumerable: true,
      value: table,
      writable: true,
    });
    witnessSetAdd(seen, value);
  }
  if (securityObjectKeys(tables).length === 0) {
    throw new Error('KV433: Postgres runtime could not derive any Drizzle pgTable exports.');
  }
  return witnessFreeze(tables);
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
  const statements: string[] = [];
  const tableCount = postgresDenseArrayLength(tables, 'Postgres schema DDL tables');
  for (let tableIndex = 0; tableIndex < tableCount; tableIndex += 1) {
    appendPostgresValue(
      statements,
      createTableDdl(postgresDenseArrayValue(tables, tableIndex, 'Postgres schema DDL tables')),
    );
  }
  for (let tableIndex = 0; tableIndex < tableCount; tableIndex += 1) {
    const table = postgresDenseArrayValue(tables, tableIndex, 'Postgres schema DDL tables');
    const columns = getTableConfig(table).columns;
    const columnCount = postgresDenseArrayLength(columns, 'Postgres schema DDL columns');
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      appendPostgresValue(
        statements,
        addColumnDdl(
          table,
          postgresDenseArrayValue(columns, columnIndex, 'Postgres schema DDL columns'),
        ),
      );
    }
  }
  return postgresJoin(statements, '\n');
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

  const tableCount = postgresDenseArrayLength(schemaTables, 'Postgres migration-plan tables');
  for (let tableIndex = 0; tableIndex < tableCount; tableIndex += 1) {
    const table = postgresDenseArrayValue(
      schemaTables,
      tableIndex,
      'Postgres migration-plan tables',
    );
    const config = getTableConfig(table);
    const schemaName = tableSchemaName(config);
    const existing = witnessMapGet(existingTables, `${schemaName}.${config.name}`);
    if (existing === undefined) {
      appendPostgresValue(up, createTableMigrationDdl(table));
      appendPostgresValue(down, `DROP TABLE ${quoteTable(config)};`);
      appendPostgresValue(operations, `create table ${schemaName}.${config.name}`);
      continue;
    }

    const columnCount = postgresDenseArrayLength(config.columns, 'Postgres migration-plan columns');
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const column = postgresDenseArrayValue(
        config.columns,
        columnIndex,
        'Postgres migration-plan columns',
      );
      if (witnessSetHas(existing.columns, column.name)) continue;
      appendPostgresValue(up, addColumnMigrationDdl(table, column));
      appendPostgresValue(
        down,
        `ALTER TABLE ${quoteTable(config)} DROP COLUMN ${quoteIdent(column.name)};`,
      );
      appendPostgresValue(operations, `add column ${schemaName}.${config.name}.${column.name}`);
    }
  }

  const upCount = postgresDenseArrayLength(up, 'Postgres up migration statements');
  const downInReverseOrder: string[] = [];
  const downCount = postgresDenseArrayLength(down, 'Postgres down migration statements');
  for (let index = downCount - 1; index >= 0; index -= 1) {
    appendPostgresValue(
      downInReverseOrder,
      postgresDenseArrayValue(down, index, 'Postgres down migration statements'),
    );
  }
  const empty = upCount === 0;
  return {
    downSql: empty
      ? '-- No generated schema changes to roll back.\n'
      : `${postgresJoin(downInReverseOrder, '\n')}\n`,
    driver,
    empty,
    operations: witnessFreeze(operations),
    upSql: empty
      ? '-- No supported additive schema changes detected.\n'
      : `${postgresJoin(up, '\n')}\n`,
  };
}

async function currentPostgresTables(
  client: RuntimeSqlClient,
): Promise<ReadonlyMap<string, ExistingPostgresTable>> {
  const tables = await client.query<{ table_name: string; table_schema: string }>(
    postgresJoin(
      [
        'SELECT table_schema, table_name',
        'FROM information_schema.tables',
        "WHERE table_schema NOT IN ('information_schema', 'pg_catalog')",
        "AND table_type = 'BASE TABLE'",
      ],
      ' ',
    ),
  );
  const byName = createWitnessMap<string, ExistingPostgresTable>();
  const rowCount = postgresDenseArrayLength(tables.rows, 'Postgres current-table rows');
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const row = postgresOwnDataSnapshot(
      postgresDenseArrayValue(tables.rows, rowIndex, 'Postgres current-table rows'),
      'Postgres current-table row',
    );
    const columns = await client.query<{ column_name: string }>(
      postgresJoin(
        [
          'SELECT column_name',
          'FROM information_schema.columns',
          'WHERE table_schema = $1 AND table_name = $2',
        ],
        ' ',
      ),
      [row.table_schema, row.table_name],
    );
    const columnNames = createWitnessSet<string>();
    const columnRowCount = postgresDenseArrayLength(columns.rows, 'Postgres current-column rows');
    for (let columnIndex = 0; columnIndex < columnRowCount; columnIndex += 1) {
      const column = postgresOwnDataSnapshot(
        postgresDenseArrayValue(columns.rows, columnIndex, 'Postgres current-column rows'),
        'Postgres current-column row',
      );
      witnessSetAdd(columnNames, column.column_name);
    }
    witnessMapSet(byName, `${row.table_schema}.${row.table_name}`, {
      columns: columnNames,
      schema: row.table_schema,
      table: row.table_name,
    });
  }
  return byName;
}

function createTableDdl(table: PgTable): string {
  const config = getTableConfig(table);
  const definitions: string[] = [];
  const columnCount = postgresDenseArrayLength(config.columns, 'Postgres table DDL columns');
  for (let index = 0; index < columnCount; index += 1) {
    appendPostgresValue(
      definitions,
      columnDdl(postgresDenseArrayValue(config.columns, index, 'Postgres table DDL columns'), {
        createTable: true,
      }),
    );
  }
  const foreignKeyCount = postgresDenseArrayLength(
    config.foreignKeys,
    'Postgres table DDL foreign keys',
  );
  for (let index = 0; index < foreignKeyCount; index += 1) {
    appendPostgresValue(
      definitions,
      foreignKeyDdl(
        postgresDenseArrayValue(config.foreignKeys, index, 'Postgres table DDL foreign keys'),
      ),
    );
  }
  return `CREATE TABLE IF NOT EXISTS ${quoteTable(config)} (${postgresJoin(definitions, ', ')});`;
}

function createTableMigrationDdl(table: PgTable): string {
  return securityStringReplaceAll(
    createTableDdl(table),
    'CREATE TABLE IF NOT EXISTS',
    'CREATE TABLE',
  );
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
  const tokens = [
    quoteIdent(column.name),
    columnTypeDdl(column),
    options.createTable && column.primary ? 'PRIMARY KEY' : '',
    column.notNull ? 'NOT NULL' : '',
    options.createTable && column.isUnique ? 'UNIQUE' : '',
    columnDefaultDdl(column),
  ];
  return postgresJoin(
    postgresFilterDense(tokens, (token) => token !== '', 'Postgres column DDL tokens'),
    ' ',
  );
}

function columnTypeDdl(column: PgColumn): string {
  switch (column.columnType) {
    case 'PgBigInt53':
      return 'bigint';
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
  const columns = postgresJoin(
    postgresMapDense(
      reference.columns,
      (column) => quoteIdent(column.name),
      'Postgres foreign-key columns',
    ),
    ', ',
  );
  const foreignColumns = postgresJoin(
    postgresMapDense(
      reference.foreignColumns,
      (column) => quoteIdent(column.name),
      'Postgres foreign-key target columns',
    ),
    ', ',
  );
  const onDelete = foreignKey.onDelete === 'no action' ? '' : ` ON DELETE ${foreignKey.onDelete}`;
  const onUpdate = foreignKey.onUpdate === 'no action' ? '' : ` ON UPDATE ${foreignKey.onUpdate}`;
  return `FOREIGN KEY (${columns}) REFERENCES ${quoteTable(
    getTableConfig(reference.foreignTable),
  )} (${foreignColumns})${onDelete}${onUpdate}`;
}

function sortTablesByForeignKeyDependencies(tables: readonly PgTable[]): PgTable[] {
  const pending = createWitnessSet<PgTable>();
  const tableCount = postgresDenseArrayLength(tables, 'Postgres dependency-sort tables');
  for (let index = 0; index < tableCount; index += 1) {
    witnessSetAdd(
      pending,
      postgresDenseArrayValue(tables, index, 'Postgres dependency-sort tables'),
    );
  }
  const sorted: PgTable[] = [];

  while (witnessSetSize(pending) > 0) {
    let progressed = false;
    const pendingTables = postgresSetValues(pending);
    const pendingCount = postgresDenseArrayLength(pendingTables, 'Pending Postgres tables');
    for (let index = 0; index < pendingCount; index += 1) {
      const table = postgresDenseArrayValue(pendingTables, index, 'Pending Postgres tables');
      const foreignKeys = getTableConfig(table).foreignKeys;
      const blocked = postgresSomeDense(
        foreignKeys,
        (foreignKey) => {
          const dependency = foreignKey.reference().foreignTable;
          return dependency !== table && witnessSetHas(pending, dependency);
        },
        'Postgres dependency-sort foreign keys',
      );
      if (blocked) {
        continue;
      }
      appendPostgresValue(sorted, table);
      witnessSetDelete(pending, table);
      progressed = true;
    }
    if (!progressed) {
      const names = postgresMapDense(
        postgresSetValues(pending),
        (table) => getTableConfig(table).name,
        'Cyclic Postgres tables',
      );
      throw new Error(
        `KV433: cannot order Postgres tables with cyclic foreign keys: ${postgresJoin(names, ', ')}.`,
      );
    }
  }

  return sorted;
}

async function ensurePostgresRole(client: RuntimeTransactionClient, role: string): Promise<void> {
  const result = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  const rows = snapshotPostgresQueryRows(result.rows, 'Postgres role-existence rows');
  if (postgresDenseArrayLength(rows, 'Postgres role-existence rows') === 0) {
    await client.exec(`CREATE ROLE ${quoteIdent(role)}`);
  }
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
  const roles = witnessFreeze({
    admin: postgresTopologyRole('admin', input.adminRole, input.adminRoleAdopted),
    reader: postgresTopologyRole('reader', input.readerRole, input.readerRoleAdopted),
    system: postgresTopologyRole('system', input.systemRole, input.systemRoleAdopted),
    writer: postgresTopologyRole('writer', input.writerRole, input.writerRoleAdopted),
  });
  return witnessFreeze({
    roles,
    membershipEdges: witnessFreeze([]),
  });
}

function postgresTopologyRole(
  purpose: PostgresRolePurpose,
  name: string,
  adopted: boolean,
): PostgresRoleTopologyRole {
  return witnessFreeze({
    management: adopted ? 'adopt' : 'create',
    name,
    purpose,
  });
}

function postgresRoleTopologyWithRuntimeLogin(
  topology: PostgresRoleTopology,
  runtimeLoginRole: string | undefined,
): PostgresRoleTopology {
  if (runtimeLoginRole === undefined || runtimeLoginRole === '') return topology;
  return witnessFreeze({
    membershipEdges: postgresRuntimeMembershipEdges(topology, runtimeLoginRole),
    roles: topology.roles,
  });
}

function postgresRuntimeMembershipEdges(
  topology: PostgresRoleTopology,
  runtimeLoginRole: string,
): readonly PostgresRoleMembershipEdge[] {
  const edges: PostgresRoleMembershipEdge[] = [];
  appendPostgresRuntimeMembershipEdge(edges, topology.roles.reader.name, runtimeLoginRole);
  appendPostgresRuntimeMembershipEdge(edges, topology.roles.writer.name, runtimeLoginRole);
  return witnessFreeze(edges);
}

function appendPostgresRuntimeMembershipEdge(
  edges: PostgresRoleMembershipEdge[],
  role: string,
  runtimeLoginRole: string,
): void {
  if (role === runtimeLoginRole) return;
  appendPostgresDenseValue(
    edges,
    witnessFreeze({ memberRole: runtimeLoginRole, owner: 'kovo' as const, role }),
  );
}

function postgresTopologyRoles(
  topology: PostgresRoleTopology,
): readonly PostgresRoleTopologyRole[] {
  const roles: PostgresRoleTopologyRole[] = [];
  appendPostgresDenseValue(roles, topology.roles.admin);
  appendPostgresDenseValue(roles, topology.roles.reader);
  appendPostgresDenseValue(roles, topology.roles.system);
  appendPostgresDenseValue(roles, topology.roles.writer);
  return roles;
}

function appendPostgresDenseValue<Value>(values: Value[], value: Value): void {
  appendPostgresValue(values, value);
}

function postgresDenseValue<Value>(values: readonly Value[], index: number, label: string): Value {
  const descriptor = witnessGetOwnPropertyDescriptor(values, index);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`${label} must remain a dense own-data array.`);
  }
  return descriptor.value;
}

async function preflightPostgresRoleTopology(
  client: RuntimeTransactionClient,
  topology: PostgresRoleTopology,
): Promise<void> {
  const roles = postgresTopologyRoles(topology);
  const adoptedRoles: PostgresRoleTopologyRole[] = [];
  for (let index = 0; index < roles.length; index += 1) {
    const role = postgresDenseValue(roles, index, 'Postgres topology roles');
    if (role.management === 'adopt') appendPostgresDenseValue(adoptedRoles, role);
  }
  if (adoptedRoles.length === 0) return;
  const adoptedRoleNames: string[] = [];
  for (let index = 0; index < adoptedRoles.length; index += 1) {
    appendPostgresDenseValue(
      adoptedRoleNames,
      postgresDenseValue(adoptedRoles, index, 'Postgres adopted roles').name,
    );
  }
  const existing = await existingPostgresRoles(client, adoptedRoleNames);
  const missing: PostgresRoleTopologyRole[] = [];
  for (let index = 0; index < adoptedRoles.length; index += 1) {
    const role = postgresDenseValue(adoptedRoles, index, 'Postgres adopted roles');
    if (!witnessSetHas(existing, role.name)) appendPostgresDenseValue(missing, role);
  }
  if (missing.length > 0) {
    const missingLabels = postgresMapDense(
      missing,
      (role) => `${role.purpose}Role=${role.name}`,
      'Missing adopted Postgres roles',
    );
    throw new Error(
      postgresJoin(
        [
          'KV433_ROLE_TOPOLOGY: adopted Postgres roles must exist before provisioning (SPEC §10.3).',
          `missing: ${postgresJoin(missingLabels, ', ')}`,
          'Set KOVO_DB_READER_ROLE, KOVO_DB_WRITER_ROLE, KOVO_DB_ADMIN_ROLE, and KOVO_DB_SYSTEM_ROLE to pre-created roles, or allow Kovo to create its default roles.',
        ],
        ' ',
      ),
    );
  }
  const attributeRows = await postgresRoleAttributeRows(client, adoptedRoleNames);
  const privileged: PostgresRoleAttributeRow[] = [];
  for (let index = 0; index < attributeRows.length; index += 1) {
    const row = postgresDenseValue(attributeRows, index, 'Postgres role attribute rows');
    if (postgresRoleElevatedAttributes(row).length > 0) {
      appendPostgresDenseValue(privileged, row);
    }
  }
  if (privileged.length > 0) {
    const attributeLabels = postgresMapDense(
      POSTGRES_ELEVATED_ROLE_ATTRIBUTES,
      (attribute) => `NO${attribute.label}`,
      'Postgres elevated role attribute labels',
    );
    const privilegedRoleDetails = postgresMapDense(
      privileged,
      postgresRoleAttributeDetail,
      'Privileged adopted Postgres roles',
    );
    throw new Error(
      postgresJoin(
        [
          `KV433_ROLE_TOPOLOGY: adopted Postgres roles must have no elevated role attributes (${postgresJoin(attributeLabels, ', ')}) (SPEC §10.3).`,
          `offending: ${postgresJoin(privilegedRoleDetails, ', ')}`,
        ],
        ' ',
      ),
    );
  }
}

async function ensurePostgresRoleTopology(
  client: RuntimeTransactionClient,
  topology: PostgresRoleTopology,
): Promise<void> {
  await preflightPostgresRoleTopology(client, topology);
  const roles = postgresTopologyRoles(topology);
  for (let index = 0; index < roles.length; index += 1) {
    const role = postgresDenseValue(roles, index, 'Postgres topology roles');
    if (role.management === 'create') await ensurePostgresRole(client, role.name);
  }
}

async function existingPostgresRoles(
  client: RuntimeTransactionClient,
  roles: readonly string[],
): Promise<ReadonlySet<string>> {
  if (roles.length === 0) return createWitnessSet<string>();
  const result = await client.query<{ rolname: string }>(
    'SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])',
    [roles],
  );
  const existing = createWitnessSet<string>();
  const rows = snapshotPostgresQueryRows(result.rows, 'Postgres existing role rows');
  for (let index = 0; index < rows.length; index += 1) {
    const row = postgresDenseValue(rows, index, 'Postgres existing role rows');
    witnessSetAdd(existing, row.rolname);
  }
  return existing;
}

async function postgresRoleAttributeRows(
  client: RuntimeTransactionClient,
  roles: readonly string[],
): Promise<readonly PostgresRoleAttributeRow[]> {
  if (roles.length === 0) return [];
  const result = await client.query<PostgresRoleAttributeRow>(
    postgresJoin(
      [
        'SELECT rolname, rolsuper, rolbypassrls, rolreplication, rolcreaterole, rolcreatedb',
        'FROM pg_catalog.pg_roles WHERE rolname = ANY($1::text[])',
      ],
      ' ',
    ),
    [roles],
  );
  return snapshotPostgresQueryRows(result.rows, 'Postgres role attribute rows');
}

function postgresRoleElevatedAttributes(row: PostgresRoleAttributeRow): readonly string[] {
  const attributes: string[] = [];
  for (let index = 0; index < POSTGRES_ELEVATED_ROLE_ATTRIBUTES.length; index += 1) {
    const attribute = postgresDenseValue(
      POSTGRES_ELEVATED_ROLE_ATTRIBUTES,
      index,
      'Postgres elevated role attributes',
    );
    if (row[attribute.column]) appendPostgresDenseValue(attributes, attribute.label);
  }
  return attributes;
}

function postgresRoleAttributeDetail(row: PostgresRoleAttributeRow): string {
  const attributes = postgresRoleElevatedAttributes(row);
  return `${row.rolname}(${postgresJoin(attributes, '+')})`;
}

async function postgresRoleAttributeVersionIssues(
  client: RuntimeTransactionClient,
): Promise<KovoPostgresPostureIssue[]> {
  const rows = await safeQuery<{ attname: string }>(
    client,
    postgresJoin(
      [
        'SELECT attname',
        'FROM pg_attribute',
        "WHERE attrelid = 'pg_catalog.pg_roles'::regclass",
        'AND attnum > 0',
        'AND attisdropped = false',
        "AND attname LIKE 'rol%'",
        'ORDER BY attname',
      ],
      ' ',
    ),
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
  const columns: string[] = [];
  for (let index = 0; index < rows.rows.length; index += 1) {
    appendPostgresDenseValue(
      columns,
      postgresDenseValue(rows.rows, index, 'Postgres role column rows').attname,
    );
  }
  const unclassified = unclassifiedPostgresRoleColumns(columns);
  if (unclassified.length === 0) return [];
  return [
    {
      code: 'KV433_ROLE_ATTRIBUTE_SET',
      detail: `pg_roles exposes unclassified role-attribute column(s): ${postgresJoin(unclassified, ', ')}; classify each as elevated or benign before trusting runtime identity posture (SPEC §10.3)`,
    },
  ];
}

function unclassifiedPostgresRoleColumns(columns: readonly string[]): readonly string[] {
  const unclassified: string[] = [];
  for (let index = 0; index < columns.length; index += 1) {
    const column = postgresDenseValue(columns, index, 'Postgres role columns');
    if (!witnessSetHas(POSTGRES_CLASSIFIED_ROLE_COLUMNS, column)) {
      appendPostgresDenseValue(unclassified, column);
    }
  }
  return unclassified;
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
    postgresJoin(
      [
        'SELECT r.rolname, r.rolsuper, r.rolbypassrls, r.rolreplication, r.rolcreaterole, r.rolcreatedb,',
        "(SELECT pg_has_role(r.oid, admin.oid, 'MEMBER') FROM pg_roles admin WHERE admin.rolname = $2) AS can_admin,",
        "(SELECT pg_has_role(r.oid, system_role.oid, 'MEMBER') FROM pg_roles system_role WHERE system_role.rolname = $3) AS can_system",
        'FROM pg_roles r WHERE r.rolname = $1',
      ],
      ' ',
    ),
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
    appendPostgresDenseValue(issues, {
      code: 'KV433_RUNTIME_ROLE',
      detail: `runtime login ${runtimeLoginRole} must have no elevated role attributes; found ${postgresRoleAttributeDetail(
        login,
      )}`,
    });
  }
  if (login.can_admin === true) {
    appendPostgresDenseValue(issues, {
      code: 'KV433_RUNTIME_ROLE',
      detail: `runtime login ${runtimeLoginRole} must not be able to SET ROLE to adminRole=${config.adminRole}`,
    });
  }
  if (login.can_system === true) {
    appendPostgresDenseValue(issues, {
      code: 'KV433_RUNTIME_ROLE',
      detail: `runtime login ${runtimeLoginRole} must not be able to SET ROLE to systemRole=${config.systemRole}`,
    });
  }

  // SPEC §10.3 (C10/C11): this is the SAME `pg_has_role(login, role, 'MEMBER')` closure DEC-B/DEC-C
  // audit — the roles the login can SET ROLE to. `is_predefined` flags PostgreSQL predefined roles,
  // identified by the reserved `pg_` name prefix (sound: `pg_` is reserved for predefined roles) and
  // the < FirstNormalObjectId (16384) system-OID range, so the allowlist below can range over
  // predefined-role MEMBERSHIP in addition to the role-ATTRIBUTE allowlist.
  const assumableRows = await safeQuery<PostgresRoleAttributeRow & { is_predefined: boolean }>(
    client,
    postgresJoin(
      [
        'SELECT role.rolname, role.rolsuper, role.rolbypassrls, role.rolreplication, role.rolcreaterole, role.rolcreatedb,',
        "(role.oid < 16384 OR role.rolname LIKE 'pg\\_%') AS is_predefined",
        'FROM pg_roles login',
        'JOIN pg_roles role ON role.oid <> login.oid',
        'WHERE login.rolname = $1',
        "AND pg_has_role(login.oid, role.oid, 'MEMBER')",
        'ORDER BY role.rolname',
      ],
      ' ',
    ),
    [runtimeLoginRole],
  );
  const frameworkRoles = createWitnessSet<string>();
  witnessSetAdd(frameworkRoles, config.readerRole);
  witnessSetAdd(frameworkRoles, config.writerRole);
  witnessSetAdd(frameworkRoles, config.adminRole);
  witnessSetAdd(frameworkRoles, config.systemRole);
  if (assumableRows === undefined) {
    appendPostgresDenseValue(issues, {
      code: 'KV433_RUNTIME_ROLE',
      detail: `could not enumerate roles assumable by runtime login ${runtimeLoginRole}`,
    });
  } else {
    for (let index = 0; index < assumableRows.rows.length; index += 1) {
      const role = postgresDenseValue(assumableRows.rows, index, 'Postgres assumable role rows');
      // SPEC §10.3 (C10/C11): ALLOWLIST over predefined-role membership. Membership in any `pg_*`
      // predefined role that is not one of the framework's own roles or an explicit benign
      // don't-care entry fails closed and is named — this catches escalation surfaces (OS command
      // execution, all-data read/write, server-file access, monitoring/maintenance) that carry NONE
      // of the five elevated role attributes and would otherwise pass the attribute allowlist.
      if (
        role.is_predefined === true &&
        !witnessSetHas(frameworkRoles, role.rolname) &&
        !witnessSetHas(POSTGRES_BENIGN_PREDEFINED_ROLES, role.rolname)
      ) {
        appendPostgresDenseValue(issues, {
          code: 'KV433_RUNTIME_ROLE',
          detail: `runtime login ${runtimeLoginRole} is a member of PostgreSQL predefined role ${role.rolname}; predefined-role membership grants escalation capabilities that carry no elevated role attribute, so the runtime login and every assumable role must be a member of only framework roles`,
        });
      }
      if (postgresRoleElevatedAttributes(role).length === 0) continue;
      appendPostgresDenseValue(issues, {
        code: 'KV433_RUNTIME_ROLE',
        detail: `runtime login ${runtimeLoginRole} can SET ROLE to ${postgresRoleAttributeDetail(
          role,
        )}; every assumable role must have no elevated role attributes`,
      });
    }
  }

  const adminOptionRows = await safeQuery<{ role_name: string }>(
    client,
    postgresJoin(
      [
        'SELECT role.rolname AS role_name',
        'FROM pg_auth_members member',
        'JOIN pg_roles login ON login.oid = member.member',
        'JOIN pg_roles role ON role.oid = member.roleid',
        'WHERE login.rolname = $1 AND member.admin_option = true',
        'ORDER BY role.rolname',
      ],
      ' ',
    ),
    [runtimeLoginRole],
  );
  if (adminOptionRows === undefined) {
    appendPostgresDenseValue(issues, {
      code: 'KV433_RUNTIME_ROLE',
      detail: `could not verify runtime login ${runtimeLoginRole} ADMIN OPTION memberships`,
    });
  } else {
    for (let index = 0; index < adminOptionRows.rows.length; index += 1) {
      const row = postgresDenseValue(adminOptionRows.rows, index, 'Postgres admin-option rows');
      appendPostgresDenseValue(issues, {
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
    postgresJoin(
      [
        'SELECT COALESCE($3::text, current_user) AS runtime_login,',
        "(SELECT pg_has_role(COALESCE($3::text, current_user), reader.oid, 'USAGE') FROM pg_roles reader WHERE reader.rolname = $1) AS can_reader,",
        "(SELECT pg_has_role(COALESCE($3::text, current_user), writer.oid, 'USAGE') FROM pg_roles writer WHERE writer.rolname = $2) AS can_writer",
      ],
      ' ',
    ),
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
  if (topology.roles.reader.name !== row.runtime_login && row.can_reader !== true) {
    appendPostgresDenseValue(issues, {
      code: 'KV433_ROLE_TOPOLOGY',
      detail: `runtime login ${row.runtime_login} is missing membership in readerRole=${topology.roles.reader.name}; grant ${quoteIdent(topology.roles.reader.name)} to ${quoteIdent(row.runtime_login)} or run kovo db provision with a privileged admin URL`,
    });
  }
  if (topology.roles.writer.name !== row.runtime_login && row.can_writer !== true) {
    appendPostgresDenseValue(issues, {
      code: 'KV433_ROLE_TOPOLOGY',
      detail: `runtime login ${row.runtime_login} is missing membership in writerRole=${topology.roles.writer.name}; grant ${quoteIdent(topology.roles.writer.name)} to ${quoteIdent(row.runtime_login)} or run kovo db provision with a privileged admin URL`,
    });
  }
  return issues;
}

async function currentPostgresLogin(client: RuntimeTransactionClient): Promise<string | undefined> {
  const result = await safeQuery<{ runtime_login: string }>(
    client,
    'SELECT current_user AS runtime_login',
  );
  if (result === undefined || result.rows.length === 0) return undefined;
  return postgresDenseArrayValue(result.rows, 0, 'Postgres current-login rows').runtime_login;
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
  const membershipEdges: KovoPostgresPostureReport['roleTopology']['membershipEdges'][number][] =
    [];
  for (let index = 0; index < withRuntime.membershipEdges.length; index += 1) {
    const edge = postgresDenseValue(
      withRuntime.membershipEdges,
      index,
      'Postgres membership edges',
    );
    appendPostgresDenseValue(membershipEdges, {
      memberRole: edge.memberRole,
      owner: edge.owner,
      role: edge.role,
      status:
        (input.edgeStatuses === undefined
          ? undefined
          : witnessMapGet(input.edgeStatuses, postgresMembershipEdgeKey(edge))) ?? 'expected',
    });
  }
  return {
    adminRole: withRuntime.roles.admin,
    membershipEdges,
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
    postgresJoin(
      [
        'KV433_SCHEMA_TABLE: Postgres schema tables are missing; run `kovo db generate` and `kovo db migrate` before `kovo db provision` (SPEC §10.3).',
        `missing: ${postgresJoin(missing, ', ')}`,
      ],
      ' ',
    ),
  );
}

async function missingPostgresSchemaTables(
  client: RuntimeTransactionClient,
  tables: readonly PgTable[],
): Promise<readonly string[]> {
  const missing: string[] = [];
  const tableCount = postgresDenseArrayLength(tables, 'Postgres required schema tables');
  for (let index = 0; index < tableCount; index += 1) {
    const table = postgresDenseArrayValue(tables, index, 'Postgres required schema tables');
    const config = getTableConfig(table);
    const schema = tableSchemaName(config);
    const result = await safeQuery<{ exists: number }>(
      client,
      postgresJoin(
        [
          'SELECT 1 AS exists',
          'FROM pg_class c',
          'JOIN pg_namespace n ON n.oid = c.relnamespace',
          'WHERE n.nspname = $1 AND c.relname = $2',
          "AND c.relkind IN ('r', 'p')",
        ],
        ' ',
      ),
      [schema, config.name],
    );
    if ((result?.rows.length ?? 0) === 0) {
      appendPostgresValue(missing, `${schema}.${config.name}`);
    }
  }
  return missing;
}

async function ensurePostgresSchemaStateTable(client: RuntimeTransactionClient): Promise<void> {
  await client.exec(
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(SCHEMA_STATE_TABLE)} (key text PRIMARY KEY, value text NOT NULL, updated_at timestamp NOT NULL DEFAULT now())`,
  );
}

async function ensurePostgresDatabaseInstanceIdentity(
  client: RuntimeTransactionClient,
  config: ResolvedPostgresRuntimeConfig,
): Promise<void> {
  const candidate = randomBytes(32).toString('hex');
  await client.query(
    `INSERT INTO ${quoteIdent(SCHEMA_STATE_TABLE)} (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
    [POSTGRES_DATABASE_INSTANCE_KEY, candidate],
  );
  const result = await client.query<{ value: string }>(
    `SELECT value FROM ${quoteIdent(SCHEMA_STATE_TABLE)} WHERE key = $1 FOR UPDATE`,
    [POSTGRES_DATABASE_INSTANCE_KEY],
  );
  const rows = snapshotPostgresQueryRows(result.rows, 'Postgres database-instance rows');
  const value =
    rows.length === 0
      ? undefined
      : postgresDenseArrayValue(rows, 0, 'Postgres database-instance rows').value;
  if (value === undefined || !securityRegExpTest(POSTGRES_DATABASE_INSTANCE_ID_PATTERN, value)) {
    throw new Error(
      'KV433_DATABASE_IDENTITY: kovo_schema_state database_instance_id must be one framework-minted 256-bit lowercase hexadecimal identity (SPEC §10.3 C9/C10).',
    );
  }
  const readers = [config.adminRole, config.systemRole];
  const seen = createWitnessSet<string>();
  for (let index = 0; index < readers.length; index += 1) {
    const role = postgresDenseValue(readers, index, 'Postgres database-identity readers');
    if (witnessSetHas(seen, role)) continue;
    witnessSetAdd(seen, role);
    await client.exec(
      `GRANT SELECT ON TABLE ${quoteIdent(SCHEMA_STATE_TABLE)} TO ${quoteIdent(role)}`,
    );
  }
}

async function grantPostgresRuntimeLoginRole(
  client: RuntimeTransactionClient,
  topology: PostgresRoleTopology,
): Promise<void> {
  for (let index = 0; index < topology.membershipEdges.length; index += 1) {
    const edge = postgresDenseValue(topology.membershipEdges, index, 'Postgres membership edges');
    if (edge.owner !== 'kovo') continue;
    if (await postgresRoleMembershipExists(client, edge)) continue;
    await client.exec(`GRANT ${quoteIdent(edge.role)} TO ${quoteIdent(edge.memberRole)}`);
  }
  const runtimeLoginRole =
    topology.membershipEdges.length === 0
      ? undefined
      : postgresDenseValue(topology.membershipEdges, 0, 'Postgres membership edges').memberRole;
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
  const rows = snapshotPostgresQueryRows(result.rows, 'Postgres role-membership rows');
  return (
    rows.length > 0 &&
    postgresDenseArrayValue(rows, 0, 'Postgres role-membership rows').has_membership === true
  );
}

function runtimeLoginRoleFromDatabaseUrl(databaseUrl: string | undefined): string | undefined {
  if (databaseUrl === undefined || databaseUrl === '') return undefined;
  try {
    const username = egressUrlUsername(egressUrl(databaseUrl));
    return username === '' ? undefined : egressDecodeURIComponent(username);
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
): Promise<PostgresRuntimeConnectionPostureWitness> {
  const witness = await witnessRuntimeConnectionPosture(client, config);
  if (witness.issue !== undefined) {
    throw new Error(
      `KV433: ${RUNTIME_LEAST_PRIVILEGE_ERROR}: ${witness.issue.detail} (SPEC §10.3).`,
    );
  }
  if (witness.runtimeLoginRole === undefined) {
    throw new Error(`KV433: ${RUNTIME_LEAST_PRIVILEGE_ERROR} (SPEC §10.3).`);
  }
  return witness;
}

interface PostgresRuntimeConnectionPostureWitness {
  databaseIdentity: PostgresDatabaseIdentity | undefined;
  issue: KovoPostgresPostureIssue | undefined;
  runtimeLoginRole: string | undefined;
}

interface PostgresDatabaseIdentity {
  databaseInstanceId: string;
  databaseName: string;
  databaseOid: string;
  postmasterStartEpoch: string;
  serverAddress: string | null;
  serverPort: number | null;
  systemIdentifier: string;
  timelineId: string;
}

interface PostgresLiveIdentityRow {
  backslash_quote: string;
  client_encoding: string;
  database_name: string;
  database_oid: string;
  default_transaction_isolation: string;
  in_recovery: boolean;
  lo_compat_privileges: string;
  postmaster_start_epoch: string;
  role_setting: string;
  row_security: string;
  runtime_login: string;
  server_address: string | null;
  server_port: number | null;
  session_authorization: string;
  session_login: string;
  session_replication_role: string;
  standard_conforming_strings: string;
  system_identifier: string;
  timeline_id: string;
  transform_null_equals: string;
}

interface PostgresExternalSessionSettingRow {
  context: string;
  name: string;
  setting: string;
  source: string;
}

async function witnessRuntimeConnectionPosture(
  client: RuntimeSqlClient,
  config: ResolvedPostgresRuntimeConfig,
): Promise<PostgresRuntimeConnectionPostureWitness> {
  return client.transaction(async (tx) => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const witness = await witnessRuntimeConnectionPostureTransaction(tx, config);
    if (witness.issue !== undefined) return witness;
    await tx.exec(POSTGRES_SECURITY_SEARCH_PATH_SQL);
    const normalizedSearchPath = await safeQuery<{ search_path: string }>(
      tx,
      "SELECT pg_catalog.current_setting('search_path') AS search_path",
    );
    const searchPath = normalizedSearchPath?.rows[0]?.search_path;
    if (searchPath !== 'pg_catalog, public, pg_temp') {
      return {
        ...witness,
        issue: {
          code: 'KV433_RUNTIME_SETTING',
          detail:
            'runtime search_path could not be normalized to the exact pg_catalog, public, pg_temp security path',
        },
      };
    }
    const runtimeLoginRole = witness.runtimeLoginRole;
    if (runtimeLoginRole === undefined) return witness;
    return {
      ...witness,
      issue: (await postgresRuntimeLoginPostureIssues(tx, config, runtimeLoginRole))[0],
    };
  });
}

async function witnessRuntimeConnectionPostureTransaction(
  client: RuntimeTransactionClient,
  config: ResolvedPostgresRuntimeConfig,
): Promise<PostgresRuntimeConnectionPostureWitness> {
  // Read the session exactly as node-postgres opened it, before Kovo overwrites search_path. This
  // catches URL `options`, ALTER ROLE, ALTER DATABASE, and ALTER ROLE ... IN DATABASE settings that
  // would otherwise disappear behind the later framework normalization (SPEC §10.3 C9/C10).
  const current = await safeQuery<PostgresLiveIdentityRow>(client, postgresLiveIdentitySql());
  if (current === undefined) {
    return {
      databaseIdentity: undefined,
      issue: {
        code: 'KV433_DATABASE_IDENTITY',
        detail:
          'runtime connection could not read pg_control_system()/pg_control_checkpoint() and live database identity; managed providers must preserve these read-only identity oracles for split-authority posture',
      },
      runtimeLoginRole: undefined,
    };
  }
  const currentRows = snapshotPostgresQueryRows(current.rows, 'Postgres runtime-login rows');
  const identity =
    currentRows.length !== 1
      ? undefined
      : postgresDenseArrayValue(currentRows, 0, 'Postgres runtime-login rows');
  if (
    identity === undefined ||
    identity.runtime_login === '' ||
    identity.session_login === '' ||
    identity.database_name === '' ||
    identity.database_oid === '' ||
    identity.system_identifier === '' ||
    identity.timeline_id === '' ||
    identity.postmaster_start_epoch === ''
  ) {
    return {
      databaseIdentity: undefined,
      issue: {
        code: 'KV433_DATABASE_IDENTITY',
        detail: 'runtime connection returned an incomplete live database/role identity witness',
      },
      runtimeLoginRole: undefined,
    };
  }
  const expectedLogin = runtimeLoginRoleFromDatabaseUrl(config.databaseUrl);
  if (expectedLogin === undefined || identity.session_login !== expectedLogin) {
    return {
      databaseIdentity: undefined,
      issue: {
        code: 'KV433_RUNTIME_ROLE',
        detail: `runtime connection authenticated session_user ${identity.session_login} must match authority login ${expectedLogin ?? '(missing)'} from databaseUrl`,
      },
      runtimeLoginRole: identity.runtime_login,
    };
  }
  if (identity.runtime_login !== identity.session_login) {
    return {
      databaseIdentity: undefined,
      issue: {
        code: 'KV433_RUNTIME_ROLE',
        detail: `runtime connection current_user ${identity.runtime_login} must match authenticated session_user ${identity.session_login}; startup SET ROLE/role options are forbidden for the ordinary runtime connection`,
      },
      runtimeLoginRole: identity.runtime_login,
    };
  }
  if (
    identity.role_setting !== 'none' ||
    identity.session_authorization !== identity.session_login
  ) {
    return {
      databaseIdentity: undefined,
      issue: {
        code: 'KV433_RUNTIME_ROLE',
        detail: `runtime connection must start with role=none and session_authorization=${identity.session_login}; observed role=${identity.role_setting} session_authorization=${identity.session_authorization}`,
      },
      runtimeLoginRole: identity.runtime_login,
    };
  }
  const baselineIssue = postgresRuntimeSemanticSettingIssue(identity);
  if (baselineIssue !== undefined) {
    return {
      databaseIdentity: undefined,
      issue: baselineIssue,
      runtimeLoginRole: identity.runtime_login,
    };
  }
  const externalSettingIssue = await postgresExternalSessionSettingIssue(client);
  if (externalSettingIssue !== undefined) {
    return {
      databaseIdentity: undefined,
      issue: externalSettingIssue,
      runtimeLoginRole: identity.runtime_login,
    };
  }
  const databaseIdentity = await postgresFrameworkDatabaseIdentity(client, identity);
  if ('issue' in databaseIdentity) {
    return {
      databaseIdentity: undefined,
      issue: databaseIdentity.issue,
      runtimeLoginRole: identity.runtime_login,
    };
  }
  return {
    databaseIdentity: databaseIdentity.identity,
    issue: undefined,
    runtimeLoginRole: identity.runtime_login,
  };
}

function postgresLiveIdentitySql(): string {
  return postgresJoin(
    [
      'SELECT current_user AS runtime_login, session_user AS session_login,',
      "pg_catalog.current_setting('role') AS role_setting,",
      "pg_catalog.current_setting('session_authorization') AS session_authorization,",
      "pg_catalog.current_setting('client_encoding') AS client_encoding,",
      "pg_catalog.current_setting('session_replication_role') AS session_replication_role,",
      "pg_catalog.current_setting('row_security') AS row_security,",
      "pg_catalog.current_setting('standard_conforming_strings') AS standard_conforming_strings,",
      "pg_catalog.current_setting('backslash_quote') AS backslash_quote,",
      "pg_catalog.current_setting('transform_null_equals') AS transform_null_equals,",
      "pg_catalog.current_setting('lo_compat_privileges') AS lo_compat_privileges,",
      "pg_catalog.current_setting('default_transaction_isolation') AS default_transaction_isolation,",
      'pg_catalog.current_database() AS database_name, database_row.oid::pg_catalog.text AS database_oid,',
      'control.system_identifier::pg_catalog.text AS system_identifier,',
      'checkpoint.timeline_id::pg_catalog.text AS timeline_id,',
      'pg_catalog.pg_is_in_recovery() AS in_recovery,',
      'EXTRACT(EPOCH FROM pg_catalog.pg_postmaster_start_time())::pg_catalog.text AS postmaster_start_epoch,',
      'pg_catalog.inet_server_addr()::pg_catalog.text AS server_address,',
      'pg_catalog.inet_server_port() AS server_port',
      'FROM pg_catalog.pg_database AS database_row',
      'CROSS JOIN pg_catalog.pg_control_system() AS control',
      'CROSS JOIN pg_catalog.pg_control_checkpoint() AS checkpoint',
      'WHERE database_row.datname OPERATOR(pg_catalog.=) pg_catalog.current_database()',
    ],
    ' ',
  );
}

function postgresRuntimeSemanticSettingIssue(
  identity: PostgresLiveIdentityRow,
): KovoPostgresPostureIssue | undefined {
  const exactSettings: readonly [string, string, string][] = [
    ['client_encoding', identity.client_encoding, 'UTF8'],
    ['session_replication_role', identity.session_replication_role, 'origin'],
    ['row_security', identity.row_security, 'on'],
    ['standard_conforming_strings', identity.standard_conforming_strings, 'on'],
    ['transform_null_equals', identity.transform_null_equals, 'off'],
    ['lo_compat_privileges', identity.lo_compat_privileges, 'off'],
    ['default_transaction_isolation', identity.default_transaction_isolation, 'read committed'],
  ];
  for (let index = 0; index < exactSettings.length; index += 1) {
    const [name, actual, expected] = postgresDenseValue(
      exactSettings,
      index,
      'Postgres semantic setting baseline',
    );
    if (actual !== expected) {
      return {
        code: 'KV433_RUNTIME_SETTING',
        detail: `runtime setting ${name} must be ${expected}; observed ${actual}`,
      };
    }
  }
  if (identity.backslash_quote !== 'safe_encoding' && identity.backslash_quote !== 'off') {
    return {
      code: 'KV433_RUNTIME_SETTING',
      detail: `runtime setting backslash_quote must be safe_encoding or off; observed ${identity.backslash_quote}`,
    };
  }
  if (identity.in_recovery) {
    return {
      code: 'KV433_DATABASE_IDENTITY',
      detail:
        'ordinary Kovo runtime connections must target the writable primary; recovery/standby sessions cannot be split-authority posture witnesses',
    };
  }
  return undefined;
}

async function postgresExternalSessionSettingIssue(
  client: RuntimeTransactionClient,
): Promise<KovoPostgresPostureIssue | undefined> {
  const configured = await safeQuery<PostgresExternalSessionSettingRow>(
    client,
    'SELECT name, setting, context, source FROM pg_catalog.pg_settings',
  );
  if (configured === undefined) {
    return {
      code: 'KV433_RUNTIME_SETTING',
      detail: 'could not enumerate explicit runtime client/role/database settings',
    };
  }
  return postgresExternalSessionSettingRowsIssue(configured.rows);
}

function postgresExternalSessionSettingRowsIssue(
  settings: readonly PostgresExternalSessionSettingRow[],
): KovoPostgresPostureIssue | undefined {
  const settingCount = postgresDenseArrayLength(settings, 'Postgres external session settings');
  for (let index = 0; index < settingCount; index += 1) {
    const setting = postgresDenseValue(settings, index, 'Postgres external session settings');
    if (!witnessSetHas(POSTGRES_RECOGNIZED_SETTING_SOURCES, setting.source)) {
      return {
        code: 'KV433_RUNTIME_SETTING',
        detail: `runtime setting ${setting.name} has unclassified pg_settings source ${setting.source}; PostgreSQL source categories are a closed allowlist`,
      };
    }
    if (witnessSetHas(POSTGRES_SERVER_SETTING_SOURCES, setting.source)) continue;
    if (setting.source === 'interactive' || setting.source === 'test') {
      return {
        code: 'KV433_RUNTIME_SETTING',
        detail: `runtime setting ${setting.name} has forbidden transient pg_settings source ${setting.source}`,
      };
    }
    if (setting.source === 'session') {
      const frameworkTransactionSetting =
        (setting.name === 'transaction_isolation' && setting.setting === 'repeatable read') ||
        (setting.name === 'transaction_read_only' && setting.setting === 'on');
      if (frameworkTransactionSetting) continue;
      return {
        code: 'KV433_RUNTIME_SETTING',
        detail: `runtime setting ${setting.name} is session-sourced outside Kovo's exact repeatable-read/read-only witness frame`,
      };
    }
    if (!witnessSetHas(POSTGRES_EXTERNAL_SESSION_SETTING_SOURCES, setting.source)) {
      return {
        code: 'KV433_RUNTIME_SETTING',
        detail: `runtime setting ${setting.name} reached an unclassified source branch ${setting.source}`,
      };
    }
    if (!witnessSetHas(POSTGRES_BENIGN_EXTERNAL_SESSION_SETTINGS, setting.name)) {
      return {
        code: 'KV433_RUNTIME_SETTING',
        detail: `runtime setting ${setting.name} is explicitly sourced from ${setting.source}; client/role/database startup settings are denied unless classified as semantics-neutral`,
      };
    }
    if (
      setting.name === 'client_encoding' &&
      (setting.setting !== 'UTF8' || setting.context !== 'user' || setting.source !== 'client')
    ) {
      return {
        code: 'KV433_RUNTIME_SETTING',
        detail: `runtime client_encoding must be the pinned driver UTF8 client negotiation; observed source=${setting.source} context=${setting.context} value=${setting.setting}`,
      };
    }
  }
  return undefined;
}

async function postgresFrameworkDatabaseIdentity(
  client: RuntimeTransactionClient,
  live: PostgresLiveIdentityRow,
): Promise<{ identity: PostgresDatabaseIdentity } | { issue: KovoPostgresPostureIssue }> {
  const nonce = await safeQuery<{ value: string }>(
    client,
    `SELECT value FROM public.${quoteIdent(SCHEMA_STATE_TABLE)} WHERE key OPERATOR(pg_catalog.=) $1::pg_catalog.text`,
    [POSTGRES_DATABASE_INSTANCE_KEY],
  );
  const nonceRows = nonce?.rows;
  const databaseInstanceId =
    nonceRows === undefined || nonceRows.length !== 1
      ? undefined
      : postgresDenseValue(nonceRows, 0, 'Postgres database-instance witness rows').value;
  if (
    databaseInstanceId === undefined ||
    !securityRegExpTest(POSTGRES_DATABASE_INSTANCE_ID_PATTERN, databaseInstanceId)
  ) {
    return {
      issue: {
        code: 'KV433_DATABASE_IDENTITY',
        detail:
          'runtime connection could not read exactly one framework-minted database_instance_id from public.kovo_schema_state; run the current provisioner and preserve its SELECT grant',
      },
    };
  }
  return {
    identity: witnessFreeze({
      databaseInstanceId,
      databaseName: live.database_name,
      databaseOid: live.database_oid,
      postmasterStartEpoch: live.postmaster_start_epoch,
      serverAddress: live.server_address,
      serverPort: live.server_port,
      systemIdentifier: live.system_identifier,
      timelineId: live.timeline_id,
    }),
  };
}

async function postgresPostureDatabaseIdentityIssue(
  client: RuntimeTransactionClient,
  runtimeIdentity: PostgresDatabaseIdentity,
): Promise<KovoPostgresPostureIssue | undefined> {
  const current = await safeQuery<PostgresLiveIdentityRow>(client, postgresLiveIdentitySql());
  const rows = current?.rows;
  const live =
    rows === undefined || rows.length !== 1
      ? undefined
      : postgresDenseValue(rows, 0, 'Postgres posture database-identity rows');
  if (live === undefined) {
    return {
      code: 'KV433_DATABASE_IDENTITY',
      detail:
        'posture authority could not read pg_control_system()/pg_control_checkpoint() and live database identity; managed providers must preserve these read-only identity oracles',
    };
  }
  if (live.in_recovery) {
    return {
      code: 'KV433_DATABASE_IDENTITY',
      detail:
        'posture authority must target the same writable primary, not a recovery/standby node',
    };
  }
  const postureIdentity = await postgresFrameworkDatabaseIdentity(client, live);
  if ('issue' in postureIdentity) return postureIdentity.issue;
  const mismatches: string[] = [];
  const compared: readonly [string, string | number | null, string | number | null][] = [
    [
      'database_instance_id',
      postureIdentity.identity.databaseInstanceId,
      runtimeIdentity.databaseInstanceId,
    ],
    [
      'system_identifier',
      postureIdentity.identity.systemIdentifier,
      runtimeIdentity.systemIdentifier,
    ],
    ['database_name', postureIdentity.identity.databaseName, runtimeIdentity.databaseName],
    ['database_oid', postureIdentity.identity.databaseOid, runtimeIdentity.databaseOid],
    ['timeline_id', postureIdentity.identity.timelineId, runtimeIdentity.timelineId],
    [
      'postmaster_start_time',
      postureIdentity.identity.postmasterStartEpoch,
      runtimeIdentity.postmasterStartEpoch,
    ],
    ['server_address', postureIdentity.identity.serverAddress, runtimeIdentity.serverAddress],
    ['server_port', postureIdentity.identity.serverPort, runtimeIdentity.serverPort],
  ];
  for (let index = 0; index < compared.length; index += 1) {
    const [label, postureValue, runtimeValue] = postgresDenseValue(
      compared,
      index,
      'Postgres database-identity comparisons',
    );
    if (!witnessObjectIs(postureValue, runtimeValue)) appendPostgresDenseValue(mismatches, label);
  }
  if (mismatches.length === 0) return undefined;
  return {
    code: 'KV433_DATABASE_IDENTITY',
    detail: `privileged posture authority is not bound to the witnessed runtime database; mismatched ${postgresJoin(mismatches, ', ')}`,
  };
}

interface PostgresPersistedSettingRow {
  database_name: string | null;
  role_name: string | null;
  setting_name: string;
}

async function postgresPersistedRuntimeSettingIssues(
  client: RuntimeTransactionClient,
  databaseName: string,
  runtimeLoginRole: string | undefined,
): Promise<KovoPostgresPostureIssue[]> {
  if (runtimeLoginRole === undefined) {
    return [
      {
        code: 'KV433_RUNTIME_SETTING',
        detail: 'could not bind persisted role/database settings without a witnessed runtime login',
      },
    ];
  }
  const result = await safeQuery<PostgresPersistedSettingRow>(
    client,
    postgresJoin(
      [
        'WITH relevant_roles AS (',
        'SELECT role_row.oid FROM pg_catalog.pg_roles AS role_row',
        'WHERE role_row.rolname = $2',
        "OR pg_catalog.pg_has_role($2, role_row.oid, 'MEMBER')",
        ') SELECT database_row.datname AS database_name, role_row.rolname AS role_name,',
        "split_part(config.value, '=', 1) AS setting_name",
        'FROM pg_catalog.pg_db_role_setting AS setting_row',
        'LEFT JOIN pg_catalog.pg_database AS database_row ON database_row.oid = setting_row.setdatabase',
        'LEFT JOIN pg_catalog.pg_roles AS role_row ON role_row.oid = setting_row.setrole',
        'CROSS JOIN LATERAL unnest(setting_row.setconfig) AS config(value)',
        'WHERE (setting_row.setdatabase = 0 OR database_row.datname = $1)',
        'AND (setting_row.setrole = 0 OR setting_row.setrole IN (SELECT oid FROM relevant_roles))',
        'ORDER BY database_name NULLS FIRST, role_name NULLS FIRST, setting_name',
      ],
      ' ',
    ),
    [databaseName, runtimeLoginRole],
  );
  if (result === undefined) {
    return [
      {
        code: 'KV433_RUNTIME_SETTING',
        detail:
          'could not enumerate persisted ALTER DATABASE/ALTER ROLE settings for the runtime identity closure',
      },
    ];
  }
  const issues: KovoPostgresPostureIssue[] = [];
  for (let index = 0; index < result.rows.length; index += 1) {
    const setting = postgresDenseValue(
      result.rows,
      index,
      'Postgres persisted role/database settings',
    );
    if (witnessSetHas(POSTGRES_BENIGN_PERSISTED_SETTINGS, setting.setting_name)) continue;
    appendPostgresDenseValue(issues, {
      code: 'KV433_RUNTIME_SETTING',
      detail: `persisted setting ${setting.setting_name} is configured for database=${setting.database_name ?? '*'} role=${setting.role_name ?? '*'} in the runtime assumable-role closure; only explicitly classified semantics-neutral settings are allowed`,
    });
  }
  return issues;
}

function assertProductionRuntimeDriver(config: ResolvedPostgresRuntimeConfig): void {
  if (config.driver === 'pglite' && currentNodeEnv() === 'production') {
    throw new Error(`KV433: ${PRODUCTION_PGLITE_ERROR} (SPEC §10.3).`);
  }
}

function currentNodeEnv(): string | undefined {
  return runtimeEnvironmentValue('NODE_ENV');
}

async function applyPostgresMigrations(
  client: RuntimeTransactionClient,
  normalized: readonly NormalizedPostgresMigration[],
): Promise<{ applied: readonly string[]; skipped: readonly string[] }> {
  const applied: string[] = [];
  const skipped: string[] = [];
  const migrationCount = postgresDenseArrayLength(normalized, 'Normalized Postgres migrations');
  if (migrationCount === 0) return { applied, skipped };

  await client.exec(
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(
      MIGRATIONS_TABLE,
    )} (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamp NOT NULL DEFAULT now())`,
  );

  for (let index = 0; index < migrationCount; index += 1) {
    const migration = postgresDenseArrayValue(normalized, index, 'Normalized Postgres migrations');
    const id = migration.id;
    const sql = migration.sql;
    const checksum = migration.checksum;
    if (postgresMigrationChecksum(sql) !== checksum) {
      throw new Error(
        `KV433_MIGRATION_CHECKSUM: Postgres migration ${id} bytes changed after validation (SPEC §10.3).`,
      );
    }
    const existing = await client.query<{ checksum: string }>(
      `SELECT checksum FROM ${quoteIdent(MIGRATIONS_TABLE)} WHERE id = $1`,
      [id],
    );
    const existingRow =
      postgresDenseArrayLength(existing.rows, 'Postgres migration ledger rows') === 0
        ? undefined
        : postgresDenseArrayValue(existing.rows, 0, 'Postgres migration ledger rows');
    const existingChecksum =
      existingRow === undefined
        ? undefined
        : postgresOwnDataValue(existingRow as Record<PropertyKey, unknown>, 'checksum');
    if (existingChecksum !== undefined) {
      if (typeof existingChecksum !== 'string') {
        throw new Error(
          `KV433_MIGRATION_CHECKSUM: Postgres migration ${id} has an invalid stored checksum (SPEC §10.3).`,
        );
      }
      if (existingChecksum !== checksum) {
        throw new Error(
          postgresJoin(
            [
              `KV433_MIGRATION_CHECKSUM: Postgres migration ${id} changed after it was applied.`,
              `expected ${existingChecksum}, saw ${checksum} (SPEC §10.3).`,
            ],
            ' ',
          ),
        );
      }
      appendPostgresValue(skipped, id);
      continue;
    }

    await client.exec(sql);
    await client.query(
      `INSERT INTO ${quoteIdent(MIGRATIONS_TABLE)} (id, checksum) VALUES ($1, $2)`,
      [id, checksum],
    );
    appendPostgresValue(applied, id);
  }

  return { applied, skipped };
}

interface NormalizedPostgresMigration extends KovoPostgresMigration {
  checksum: string;
}

function normalizePostgresMigrations(
  migrations: readonly KovoPostgresMigration[],
): readonly NormalizedPostgresMigration[] {
  const seen = createWitnessSet<string>();
  const normalized: NormalizedPostgresMigration[] = [];
  const migrationCount = postgresDenseArrayLength(migrations, 'Postgres migration input');
  for (let index = 0; index < migrationCount; index += 1) {
    const migration = postgresDenseArrayValue(migrations, index, 'Postgres migration input');
    if (!isRecord(migration)) {
      throw new TypeError(
        'KV433_MIGRATION_SQL: Postgres migration entries must be own-data objects.',
      );
    }
    const snapshot = postgresOwnDataSnapshot(migration, 'Postgres migration');
    const rawId = postgresOwnDataValue(snapshot, 'id');
    const rawSql = postgresOwnDataValue(snapshot, 'sql');
    if (typeof rawId !== 'string') {
      throw new TypeError('KV433_MIGRATION_ID: Postgres migration id must be a string.');
    }
    if (typeof rawSql !== 'string') {
      throw new TypeError('KV433_MIGRATION_SQL: Postgres migration SQL must be a string.');
    }
    const id = securityStringTrim(rawId);
    if (id === '') {
      throw new Error('KV433_MIGRATION_ID: Postgres migration id must be non-empty.');
    }
    if (witnessSetHas(seen, id)) {
      throw new Error(`KV433_MIGRATION_ID: duplicate Postgres migration id ${id}.`);
    }
    witnessSetAdd(seen, id);
    const sqlText = securityStringTrim(rawSql);
    if (sqlText === '') {
      throw new Error(`KV433_MIGRATION_SQL: Postgres migration ${id} has no SQL.`);
    }
    appendPostgresValue(
      normalized,
      witnessFreeze({ checksum: postgresMigrationChecksum(sqlText), id, sql: sqlText }),
    );
  }
  return witnessFreeze(normalized);
}

function postgresMigrationChecksum(sqlText: string): string {
  return postgresSha256(sqlText);
}

async function applyPostgresDefaultDenyPrivileges(
  client: RuntimeTransactionClient,
  tables: readonly PgTable[],
  config: ResolvedPostgresRuntimeConfig,
): Promise<void> {
  const schemas = createWitnessSet<string>();
  for (let index = 0; index < tables.length; index += 1) {
    witnessSetAdd(
      schemas,
      tableSchemaName(getTableConfig(postgresDenseValue(tables, index, 'Postgres schema tables'))),
    );
  }
  const schemaNames: string[] = [];
  witnessSetForEach(schemas, (schema) => appendPostgresDenseValue(schemaNames, schema));
  for (let index = 0; index < schemaNames.length; index += 1) {
    const schema = postgresDenseValue(schemaNames, index, 'Postgres schema names');
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
    const issueDetails = postgresMapDense(
      identityIssues,
      (issue) => `${issue.code}: ${issue.detail}`,
      'Postgres identity closure issues',
    );
    const lines = [
      'KV433_RUNTIME_ROLE: Postgres provisioning refuses an unsafe reader/writer/runtime role closure (SPEC §10.3).',
    ];
    appendPostgresDenseValues(lines, issueDetails, 'Postgres identity closure issues');
    throw new Error(postgresJoin(lines, ' '));
  }

  // SPEC §10.3 (C9/C10): CREATE/TEMP are graph-expanding privileges. Revoke them from PUBLIC and
  // only the explicitly configured app identities. Undeclared roles may be shared with another app;
  // Kovo never rewrites their ACLs. Their authority remains visible through the full closure audit
  // below and therefore aborts and rolls back provisioning instead.
  const revocationIdentities = postgresAppAuthorityRootNames(config, runtimeLoginRole);
  const revocationRoles: string[] = [];
  for (let index = 0; index < revocationIdentities.length; index += 1) {
    const role = postgresDenseValue(
      revocationIdentities,
      index,
      'Postgres creation-authority identities',
    );
    if (
      role !== config.adminRole &&
      role !== config.systemRole &&
      !securityStringStartsWith(role, 'pg_')
    ) {
      appendPostgresDenseValue(revocationRoles, role);
    }
  }
  let grantees = 'PUBLIC';
  for (let index = 0; index < revocationRoles.length; index += 1) {
    grantees += `, ${quoteIdent(
      postgresDenseValue(revocationRoles, index, 'Postgres creation-authority roles'),
    )}`;
  }
  const schemas = await client.query<{ schema_name: string }>(
    postgresJoin(
      [
        'SELECT nspname AS schema_name',
        'FROM pg_catalog.pg_namespace',
        "WHERE nspname <> 'information_schema'",
        "AND nspname !~ '^pg_'",
        'ORDER BY nspname',
      ],
      ' ',
    ),
  );
  const schemaRows = snapshotPostgresQueryRows(schemas.rows, 'Postgres schema authority rows');
  for (let index = 0; index < schemaRows.length; index += 1) {
    const row = postgresDenseValue(schemaRows, index, 'Postgres schema authority rows');
    await client.exec(`REVOKE CREATE ON SCHEMA ${quoteIdent(row.schema_name)} FROM ${grantees}`);
  }
  const database = await client.query<{ database_name: string }>(
    'SELECT pg_catalog.current_database() AS database_name',
  );
  const databaseRows = snapshotPostgresQueryRows(database.rows, 'Postgres database-name rows');
  const databaseName =
    databaseRows.length === 0
      ? undefined
      : postgresDenseArrayValue(databaseRows, 0, 'Postgres database-name rows').database_name;
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
    const remainingDetails = postgresMapDense(
      remaining,
      (row) =>
        `${row.role_name} has effective ${row.privilege_type} on ${row.object_kind} ${row.object_name}`,
      'Postgres remaining creation authority',
    );
    const lines = [
      'KV433_UNEXPECTED_PRIVILEGE: Postgres provisioning could not remove app-reachable CREATE/TEMPORARY authority (SPEC §10.3).',
    ];
    appendPostgresDenseValues(lines, remainingDetails, 'Postgres creation-authority issues');
    throw new Error(postgresJoin(lines, ' '));
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
  const authzPolicyDependencyTables = customAuthzPolicyDependencyTableNames(tables, metadata);
  for (let index = 0; index < tables.length; index += 1) {
    const table = postgresDenseValue(tables, index, 'Postgres reader privilege tables');
    const tableConfig = getTableConfig(table);
    const secretColumns =
      postgresReadonlyMapValue(
        metadata.secretColumnNamesByTable,
        tableConfig.name,
        'Postgres secret column names by table',
      ) ?? createWitnessSet<string>();
    const publicColumns = postgresPublicColumnNames(tableConfig, secretColumns);
    await client.exec(`REVOKE ALL ON TABLE ${quoteTable(tableConfig)} FROM PUBLIC`);
    await client.exec(
      `REVOKE ALL ON TABLE ${quoteTable(tableConfig)} FROM ${quoteIdent(config.readerRole)}`,
    );
    if (
      (witnessSetHas(readableTables, tableConfig.name) ||
        witnessSetHas(authzPolicyDependencyTables, tableConfig.name)) &&
      publicColumns.length > 0
    ) {
      await client.exec(
        `GRANT SELECT (${postgresQuotedIdentifierList(publicColumns)}) ON TABLE ${quoteTable(tableConfig)} TO ${quoteIdent(config.readerRole)}`,
      );
    }
  }
}

function postgresPublicColumnNames(
  table: PgTableConfig,
  secretColumns: ReadonlySet<string>,
): string[] {
  const publicColumns: string[] = [];
  for (let index = 0; index < table.columns.length; index += 1) {
    const column = postgresDenseValue(table.columns, index, 'Postgres table columns').name;
    if (!postgresReadonlySetHas(secretColumns, column, 'Postgres secret column names')) {
      appendPostgresDenseValue(publicColumns, column);
    }
  }
  return publicColumns;
}

function postgresQuotedIdentifierList(values: readonly string[]): string {
  let result = '';
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) result += ', ';
    result += quoteIdent(postgresDenseValue(values, index, 'Postgres identifier list'));
  }
  return result;
}

function postgresReaderReadableTableNames(
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
  protectedTables: ReadonlyMap<string, ProtectedPostgresTable>,
): ReadonlySet<string> {
  const readableTables = createWitnessSet<string>();
  witnessMapForEach(protectedTables, (_table, tableName) =>
    witnessSetAdd(readableTables, tableName),
  );
  const authzPolicyTables = createWitnessSet<string>();
  witnessMapForEach(customAuthzPolicyPredicatesByTable(tables, metadata), (_predicate, tableName) =>
    witnessSetAdd(authzPolicyTables, tableName),
  );
  postgresForEachReadonlyMapEntry(
    metadata.authorizationClassificationsByTable,
    'Postgres authorization classifications by table',
    (classifications, tableName) => {
      for (let index = 0; index < classifications.length; index += 1) {
        const classification = postgresDenseValue(
          classifications,
          index,
          'Postgres authorization classifications',
        );
        if (
          classification === 'public' ||
          classification === 'reference' ||
          (classification === 'authzPolicy' && !witnessSetHas(authzPolicyTables, tableName))
        ) {
          witnessSetAdd(readableTables, tableName);
          break;
        }
      }
    },
  );
  return readableTables;
}

function postgresOwnerScopedTableNames(metadata: KovoRuntimeDbMetadata): readonly string[] {
  const names: string[] = [];
  const seen = createWitnessSet<string>();
  postgresForEachReadonlyMapEntry(
    metadata.ownerSourcesByTable,
    'Postgres owner sources by table',
    (_source, name) => appendUniquePostgresIdentity(names, seen, name),
  );
  postgresForEachReadonlyMapEntry(
    metadata.ownerViaSourcesByTable,
    'Postgres owner-via sources by table',
    (_source, name) => appendUniquePostgresIdentity(names, seen, name),
  );
  return names;
}

async function applyPostgresWriterTablePrivileges(
  client: RuntimeTransactionClient,
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
  config: ResolvedPostgresRuntimeConfig,
): Promise<void> {
  const protectedTables = resolveProtectedPostgresTables(tables, metadata);
  const writableTables = postgresWriterWritableTableNames(tables, metadata, protectedTables);
  const authzPolicyDependencyTables = customAuthzPolicyDependencyTableNames(tables, metadata);
  for (let index = 0; index < tables.length; index += 1) {
    const table = postgresDenseValue(tables, index, 'Postgres writer privilege tables');
    const tableConfig = getTableConfig(table);
    const secretColumns =
      postgresReadonlyMapValue(
        metadata.secretColumnNamesByTable,
        tableConfig.name,
        'Postgres secret column names by table',
      ) ?? createWitnessSet<string>();
    const publicColumns = postgresPublicColumnNames(tableConfig, secretColumns);
    await client.exec(
      `REVOKE ALL ON TABLE ${quoteTable(tableConfig)} FROM ${quoteIdent(config.writerRole)}`,
    );
    if (witnessSetHas(writableTables, tableConfig.name)) {
      await client.exec(
        `GRANT INSERT, UPDATE, DELETE ON TABLE ${quoteTable(tableConfig)} TO ${quoteIdent(
          config.writerRole,
        )}`,
      );
      if (publicColumns.length > 0) {
        await client.exec(
          `GRANT SELECT (${postgresQuotedIdentifierList(publicColumns)}) ON TABLE ${quoteTable(tableConfig)} TO ${quoteIdent(config.writerRole)}`,
        );
      }
    } else if (
      witnessSetHas(authzPolicyDependencyTables, tableConfig.name) &&
      publicColumns.length > 0
    ) {
      await client.exec(
        `GRANT SELECT (${postgresQuotedIdentifierList(publicColumns)}) ON TABLE ${quoteTable(tableConfig)} TO ${quoteIdent(config.writerRole)}`,
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
  const sequenceNames: string[] = [];
  witnessSetForEach(sequences, (sequence) => appendPostgresDenseValue(sequenceNames, sequence));
  for (let index = 0; index < sequenceNames.length; index += 1) {
    const sequence = postgresDenseValue(sequenceNames, index, 'Postgres writer sequences');
    const parts = securityStringSplit(sequence, '.');
    const schema =
      parts.length > 0 ? postgresDenseValue(parts, 0, 'Postgres sequence parts') : undefined;
    const name =
      parts.length > 1 ? postgresDenseValue(parts, 1, 'Postgres sequence parts') : undefined;
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
  for (let index = 0; index < tables.length; index += 1) {
    const table = postgresDenseValue(tables, index, 'Postgres privileged-role tables');
    const tableConfig = getTableConfig(table);
    const tableName = tableConfig.name;
    await client.exec(
      `REVOKE ALL ON TABLE ${quoteTable(tableConfig)} FROM ${quoteIdent(config.adminRole)}`,
    );
    await client.exec(
      `REVOKE ALL ON TABLE ${quoteTable(tableConfig)} FROM ${quoteIdent(config.systemRole)}`,
    );
    if (witnessSetHas(config.crossOwnerReadTables, tableName)) {
      const secretColumns =
        postgresReadonlyMapValue(
          metadata.secretColumnNamesByTable,
          tableName,
          'Postgres secret column names by table',
        ) ?? createWitnessSet<string>();
      const publicColumns = postgresPublicColumnNames(tableConfig, secretColumns);
      if (publicColumns.length > 0) {
        await client.exec(
          `GRANT SELECT (${postgresQuotedIdentifierList(publicColumns)}) ON TABLE ${quoteTable(tableConfig)} TO ${quoteIdent(config.adminRole)}`,
        );
      }
    }
    if (witnessMapHas(protectedTables, tableName)) {
      await client.exec(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${quoteTable(tableConfig)} TO ${quoteIdent(
          config.systemRole,
        )}`,
      );
    }
  }
  const protectedRelations = createWitnessSet<string>();
  witnessMapForEach(protectedTables, (table) =>
    witnessSetAdd(protectedRelations, postgresRelationKey(table.schemaName, table.tableName)),
  );
  const sequences = await postgresProtectedSerialSequences(client, protectedRelations);
  if (sequences === undefined) return;
  const sequenceNames: string[] = [];
  witnessSetForEach(sequences, (sequence) => appendPostgresDenseValue(sequenceNames, sequence));
  for (let index = 0; index < sequenceNames.length; index += 1) {
    const sequence = postgresDenseValue(sequenceNames, index, 'Postgres system sequences');
    const parts = securityStringSplit(sequence, '.');
    const schema =
      parts.length > 0 ? postgresDenseValue(parts, 0, 'Postgres sequence parts') : undefined;
    const name =
      parts.length > 1 ? postgresDenseValue(parts, 1, 'Postgres sequence parts') : undefined;
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
  const writableTables = createWitnessSet<string>();
  witnessMapForEach(protectedTables, (_table, tableName) =>
    witnessSetAdd(writableTables, tableName),
  );
  const authzPolicyTables = createWitnessSet<string>();
  witnessMapForEach(customAuthzPolicyPredicatesByTable(tables, metadata), (_predicate, tableName) =>
    witnessSetAdd(authzPolicyTables, tableName),
  );
  postgresForEachReadonlyMapEntry(
    metadata.authorizationClassificationsByTable,
    'Postgres authorization classifications by table',
    (classifications, tableName) => {
      for (let index = 0; index < classifications.length; index += 1) {
        if (
          postgresDenseValue(classifications, index, 'Postgres authorization classifications') ===
            'authzPolicy' &&
          !witnessSetHas(authzPolicyTables, tableName)
        ) {
          witnessSetAdd(writableTables, tableName);
          break;
        }
      }
    },
  );
  return writableTables;
}

function postgresDeclaredRelationKeys(
  tables: readonly PgTable[],
  tableNames: ReadonlySet<string>,
): ReadonlySet<string> {
  const relations = createWitnessSet<string>();
  for (let index = 0; index < tables.length; index += 1) {
    const config = getTableConfig(
      postgresDenseValue(tables, index, 'Postgres declared relation tables'),
    );
    if (witnessSetHas(tableNames, config.name)) {
      witnessSetAdd(relations, postgresRelationKey(tableSchemaName(config), config.name));
    }
  }
  return relations;
}

function postgresCrossOwnerReadableTableNames(
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
): ReadonlySet<string> {
  const readableTables = createWitnessSet<string>();
  witnessMapForEach(resolveProtectedPostgresTables(tables, metadata), (_table, tableName) =>
    witnessSetAdd(readableTables, tableName),
  );
  return readableTables;
}

function resolveProtectedPostgresTables(
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
): ReadonlyMap<string, ProtectedPostgresTable> {
  const tableConfigs = createWitnessMap<string, PgTableConfig>();
  const tableCount = postgresDenseArrayLength(tables, 'Postgres protected-table schema');
  for (let index = 0; index < tableCount; index += 1) {
    const table = postgresDenseArrayValue(tables, index, 'Postgres protected-table schema');
    const config = getTableConfig(table);
    const previous = witnessMapGet(tableConfigs, config.name);
    if (previous !== undefined && tableSchemaName(previous) !== tableSchemaName(config)) {
      throw new Error(
        `KV414: duplicate Postgres table name ${config.name} across schemas is ambiguous in Kovo metadata (SPEC §10.3).`,
      );
    }
    witnessMapSet(tableConfigs, config.name, config);
  }
  const protectedTables = createWitnessMap<string, ProtectedPostgresTable>();
  postgresForEachReadonlyMapEntry(
    metadata.ownerSourcesByTable,
    'Postgres owner sources by table',
    (owner, tableName) => {
      const tableConfig = witnessMapGet(tableConfigs, tableName);
      if (tableConfig === undefined) return;
      witnessMapSet(protectedTables, tableName, {
        kind: 'owner',
        predicate: `${quoteIdent(owner.columnName)} = current_setting('kovo.principal', true)`,
        schemaName: tableSchemaName(tableConfig),
        tableName,
      });
    },
  );
  postgresForEachReadonlyMapEntry(
    metadata.ownerViaSourcesByTable,
    'Postgres owner-via sources by table',
    (ownerVia, tableName) => {
      const tableConfig = witnessMapGet(tableConfigs, tableName);
      if (tableConfig === undefined) return;
      const predicate = ownerPredicateForTable(metadata, ownerVia.parentTable, {
        parentKeyColumnName: ownerVia.parentKeyColumnName,
        parentMatchExpression: `${quoteIdent(tableName)}.${quoteIdent(ownerVia.fkColumnName)}`,
        visited: postgresStringSet([tableName]),
      });
      if (predicate === undefined) {
        throw new Error(
          `KV414: ownerVia table ${tableName} cannot resolve parent chain through ${ownerVia.parentTable} to an owner column (SPEC §10.3).`,
        );
      }
      witnessMapSet(protectedTables, tableName, {
        kind: 'ownerVia',
        predicate,
        schemaName: tableSchemaName(tableConfig),
        tableName,
      });
    },
  );
  witnessMapForEach(customAuthzPolicyPredicatesByTable(tables, metadata), (policy) => {
    const predicate = policy.predicate;
    const tableName = policy.tableName;
    const tableConfig = witnessMapGet(tableConfigs, tableName);
    if (tableConfig === undefined) return;
    witnessMapSet(protectedTables, tableName, {
      kind: 'authzPolicy',
      predicate,
      schemaName: tableSchemaName(tableConfig),
      tableName,
    });
  });
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
  if (witnessSetHas(input.visited, tableName)) return undefined;
  witnessSetAdd(input.visited, tableName);
  const parentAlias = quoteIdent(`kovo_parent_${tableName}_${witnessSetSize(input.visited)}`);
  const owner = postgresReadonlyMapValue(
    metadata.ownerSourcesByTable,
    tableName,
    'Postgres owner sources by table',
  );
  if (owner !== undefined) {
    return postgresJoin(
      [
        'EXISTS (SELECT 1 FROM',
        `${quoteIdent(tableName)} ${parentAlias}`,
        'WHERE',
        `${parentAlias}.${quoteIdent(input.parentKeyColumnName)} = ${input.parentMatchExpression}`,
        'AND',
        `${parentAlias}.${quoteIdent(owner.columnName)} = current_setting('kovo.principal', true))`,
      ],
      ' ',
    );
  }
  const ownerVia = postgresReadonlyMapValue(
    metadata.ownerViaSourcesByTable,
    tableName,
    'Postgres owner-via sources by table',
  );
  if (ownerVia === undefined) return undefined;
  const nested = ownerPredicateForTable(metadata, ownerVia.parentTable, {
    parentKeyColumnName: ownerVia.parentKeyColumnName,
    parentMatchExpression: `${parentAlias}.${quoteIdent(ownerVia.fkColumnName)}`,
    visited: input.visited,
  });
  if (nested === undefined) return undefined;
  return postgresJoin(
    [
      'EXISTS (SELECT 1 FROM',
      `${quoteIdent(tableName)} ${parentAlias}`,
      'WHERE',
      `${parentAlias}.${quoteIdent(input.parentKeyColumnName)} = ${input.parentMatchExpression}`,
      'AND',
      nested,
      ')',
    ],
    ' ',
  );
}

async function applyPostgresRlsPolicies(
  client: RuntimeTransactionClient,
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
  config: ResolvedPostgresRuntimeConfig,
): Promise<void> {
  const protectedTables = resolveProtectedPostgresTables(tables, metadata);
  const protectedTableValues = postgresMapValues(protectedTables);
  const protectedTableCount = postgresDenseArrayLength(
    protectedTableValues,
    'Postgres RLS protected tables',
  );
  for (let index = 0; index < protectedTableCount; index += 1) {
    const protectedTable = postgresDenseArrayValue(
      protectedTableValues,
      index,
      'Postgres RLS protected tables',
    );
    const { predicate, schemaName, tableName } = protectedTable;
    const table = quoteQualified(schemaName, tableName);
    await client.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await client.exec(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    await client.exec(`DROP POLICY IF EXISTS kovo_owner_scope ON ${table}`);
    await client.exec(`DROP POLICY IF EXISTS kovo_authz_policy ON ${table}`);
    await client.exec(`DROP POLICY IF EXISTS kovo_system_scope ON ${table}`);
    await client.exec(
      postgresJoin(
        [
          `CREATE POLICY ${
            protectedTable.kind === 'authzPolicy' ? 'kovo_authz_policy' : 'kovo_owner_scope'
          } ON ${table}`,
          `FOR ALL TO ${quoteIdent(config.readerRole)}, ${quoteIdent(config.writerRole)}`,
          `USING (${predicate}) WITH CHECK (${predicate})`,
        ],
        ' ',
      ),
    );
    await client.exec(
      postgresJoin(
        [
          `CREATE POLICY kovo_system_scope ON ${table}`,
          `FOR ALL TO ${quoteIdent(config.systemRole)}`,
          'USING (true) WITH CHECK (true)',
        ],
        ' ',
      ),
    );
  }
  const crossOwnerReadableTables = postgresCrossOwnerReadableTableNames(tables, metadata);
  const tableCount = postgresDenseArrayLength(tables, 'Postgres RLS schema tables');
  for (let index = 0; index < tableCount; index += 1) {
    const tableObject = postgresDenseArrayValue(tables, index, 'Postgres RLS schema tables');
    const tableConfig = getTableConfig(tableObject);
    const table = quoteTable(tableConfig);
    await client.exec(`DROP POLICY IF EXISTS kovo_admin_scope ON ${table}`);
    if (!witnessSetHas(config.crossOwnerReadTables, tableConfig.name)) continue;
    if (!witnessSetHas(crossOwnerReadableTables, tableConfig.name)) {
      throw new Error(
        `KV414: crossOwnerRead table ${tableConfig.name} must be owner, ownerVia, or custom authzPolicy scoped (SPEC §10.3).`,
      );
    }
    await client.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await client.exec(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    await client.exec(
      postgresJoin(
        [
          `CREATE POLICY kovo_admin_scope ON ${table}`,
          `FOR SELECT TO ${quoteIdent(config.adminRole)}`,
          'USING (true)',
        ],
        ' ',
      ),
    );
  }
}

async function applyPostgresViewSecurityInvoker(
  client: RuntimeTransactionClient,
  tables: readonly PgTable[],
): Promise<void> {
  const appTableNames = createWitnessSet<string>();
  const tableCount = postgresDenseArrayLength(tables, 'Postgres view-security tables');
  for (let index = 0; index < tableCount; index += 1) {
    witnessSetAdd(
      appTableNames,
      getTableConfig(postgresDenseArrayValue(tables, index, 'Postgres view-security tables')).name,
    );
  }
  const schemas = postgresSchemaNames(tables);
  if (schemas.length === 0) return;
  const schemaPlaceholders = postgresJoin(
    postgresMapDense(schemas, (_schema, index) => `$${index + 1}`, 'Postgres view schemas'),
    ', ',
  );
  const views = await safeQuery<{ table_name: string; table_schema: string }>(
    client,
    postgresJoin(
      [
        'SELECT table_schema, table_name',
        'FROM information_schema.views',
        `WHERE table_schema IN (${schemaPlaceholders})`,
        'ORDER BY table_schema, table_name',
      ],
      ' ',
    ),
    schemas,
  );
  if (views === undefined) {
    throw new Error(
      'KV433_REACHABILITY_AUDIT: could not enumerate app-schema views before Postgres provision.',
    );
  }
  const viewCount = postgresDenseArrayLength(views.rows, 'Postgres app view rows');
  for (let index = 0; index < viewCount; index += 1) {
    const view = postgresDenseArrayValue(views.rows, index, 'Postgres app view rows');
    const dependencies = await postgresViewDependencies(client, view.table_schema, view.table_name);
    if (
      postgresSomeDense(
        dependencies,
        (dependency) => witnessSetHas(appTableNames, dependency.table_name),
        'Postgres view dependencies',
      )
    ) {
      await client.exec(
        `ALTER VIEW ${quoteQualified(view.table_schema, view.table_name)} SET (security_invoker = true)`,
      );
    }
  }
}

function customAuthzPolicyPredicatesByTable(
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
): ReadonlyMap<string, AuthzPolicyPredicate> {
  const predicates = createWitnessMap<string, AuthzPolicyPredicate>();
  const compilerBoundPolicies = metadata.compilerBoundAuthzPoliciesByTable;
  if (compilerBoundPolicies !== undefined) {
    postgresForEachReadonlyMapEntry(
      compilerBoundPolicies,
      'Postgres compiler-bound authorization policies',
      (policy, tableName) => {
        if (policy.kind === 'guard-assertion') {
          throw unsupportedAuthzPolicyError(
            tableName,
            'a string guard assertion cannot become a Postgres RLS predicate; provide compiler-bound literal SQL',
          );
        }
        if (securityStringTrim(policy.sql) === '') {
          throw unsupportedAuthzPolicyError(
            tableName,
            'predicate SQL rendered to an empty statement',
          );
        }
        witnessMapSet(predicates, tableName, {
          dependencyTableNames: [],
          predicate: policy.sql,
          tableName,
        });
      },
    );
    return predicates;
  }
  const tableCount = postgresDenseArrayLength(tables, 'Postgres authz-policy tables');
  for (let index = 0; index < tableCount; index += 1) {
    const table = postgresDenseArrayValue(tables, index, 'Postgres authz-policy tables');
    const tableName = getTableConfig(table).name;
    const annotation = kovoDomainAnnotation(table);
    const authzPolicy =
      annotation === undefined
        ? undefined
        : postgresOwnDataValue(annotation as Record<PropertyKey, unknown>, 'authzPolicy');
    if (authzPolicy === undefined) continue;
    if (typeof authzPolicy === 'string') {
      throw unsupportedAuthzPolicyError(
        tableName,
        'a string guard assertion cannot become a Postgres RLS predicate; provide compiler-bound literal SQL',
      );
    }
    if (!isDrizzleSqlLike(authzPolicy)) {
      throw unsupportedAuthzPolicyError(
        tableName,
        'expected authzPolicy to be a Drizzle sql`...` predicate or a string justification',
      );
    }
    witnessMapSet(predicates, tableName, {
      dependencyTableNames: postgresFilterDense(
        authzPolicyUsedTableNames(authzPolicy),
        (dependency) => dependency !== tableName,
        'Postgres authz-policy dependencies',
      ),
      predicate: renderCustomAuthzPolicyPredicate(tableName, authzPolicy),
      tableName,
    });
  }
  return predicates;
}

function assertPostgresRuntimeSchemaSupported(
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
): void {
  customAuthzPolicyPredicatesByTable(tables, metadata);
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
    query = witnessReflectApply(postgresPolicySqlToQuery, POSTGRES_POLICY_DIALECT, [
      authzPolicy as SQL,
    ]);
  } catch (cause) {
    const reason =
      cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'unknown error';
    throw unsupportedAuthzPolicyError(tableName, `could not render predicate SQL: ${reason}`);
  }
  const params = query.params ?? [];
  if (postgresDenseArrayLength(params, 'Postgres authz-policy parameters') > 0) {
    throw unsupportedAuthzPolicyError(
      tableName,
      'predicate SQL must not contain bound parameters; inline only reviewed literal SQL chunks',
    );
  }
  if (typeof query.sql !== 'string' || securityStringTrim(query.sql) === '') {
    throw unsupportedAuthzPolicyError(tableName, 'predicate SQL rendered to an empty statement');
  }
  return securityStringTrim(query.sql);
}

function customAuthzPolicyDependencyTableNames(
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
): ReadonlySet<string> {
  const dependencyTableNames = createWitnessSet<string>();
  const policies = postgresMapValues(customAuthzPolicyPredicatesByTable(tables, metadata));
  const policyCount = postgresDenseArrayLength(policies, 'Postgres authz policies');
  for (let policyIndex = 0; policyIndex < policyCount; policyIndex += 1) {
    const dependencies = postgresDenseArrayValue(
      policies,
      policyIndex,
      'Postgres authz policies',
    ).dependencyTableNames;
    const dependencyCount = postgresDenseArrayLength(
      dependencies,
      'Postgres authz-policy dependencies',
    );
    for (let dependencyIndex = 0; dependencyIndex < dependencyCount; dependencyIndex += 1) {
      witnessSetAdd(
        dependencyTableNames,
        postgresDenseArrayValue(
          dependencies,
          dependencyIndex,
          'Postgres authz-policy dependencies',
        ),
      );
    }
  }
  return dependencyTableNames;
}

function postgresReachabilityAllowlist(
  tables: readonly PgTable[],
  metadata: KovoRuntimeDbMetadata,
): ReadonlySet<string> {
  const allowlisted = createWitnessSet<string>();
  const tableConfigs = createWitnessMap<string, PgTableConfig>();
  const tableCount = postgresDenseArrayLength(tables, 'Postgres reachability-allowlist tables');
  for (let index = 0; index < tableCount; index += 1) {
    const config = getTableConfig(
      postgresDenseArrayValue(tables, index, 'Postgres reachability-allowlist tables'),
    );
    witnessMapSet(tableConfigs, config.name, config);
  }
  const addDeclaredTable = (tableName: string): void => {
    const config = witnessMapGet(tableConfigs, tableName);
    if (config !== undefined) {
      witnessSetAdd(allowlisted, postgresRelationKey(tableSchemaName(config), config.name));
    }
  };
  const protectedAuthzPolicyTables = createWitnessSet<string>();
  witnessMapForEach(customAuthzPolicyPredicatesByTable(tables, metadata), (_policy, tableName) =>
    witnessSetAdd(protectedAuthzPolicyTables, tableName),
  );
  postgresForEachReadonlyMapEntry(
    metadata.authorizationClassificationsByTable,
    'Postgres authorization classifications by table',
    (classifications, tableName) => {
      if (
        postgresSomeDense(
          classifications,
          (classification) =>
            classification === 'public' ||
            classification === 'reference' ||
            (classification === 'authzPolicy' &&
              !witnessSetHas(protectedAuthzPolicyTables, tableName)),
          'Postgres reachability classifications',
        )
      ) {
        addDeclaredTable(tableName);
      }
    },
  );
  witnessSetForEach(customAuthzPolicyDependencyTableNames(tables, metadata), addDeclaredTable);
  return allowlisted;
}

async function postgresCatalogRelation(
  client: RuntimeTransactionClient,
  schema: string,
  table: string,
): Promise<PostgresCatalogRelation | undefined> {
  const result = await safeQuery<PostgresCatalogRelation>(
    client,
    postgresJoin(
      [
        'SELECT n.nspname AS schema_name, c.relname AS table_name, c.relkind,',
        'c.relrowsecurity, c.relforcerowsecurity, c.reloptions',
        'FROM pg_class c',
        'JOIN pg_namespace n ON n.oid = c.relnamespace',
        'WHERE n.nspname = $1 AND c.relname = $2',
      ],
      ' ',
    ),
    [schema, table],
  );
  return result === undefined || result.rows.length === 0
    ? undefined
    : postgresDenseArrayValue(result.rows, 0, 'Postgres catalog relation rows');
}

async function postgresHasLiveKovoPolicy(
  client: RuntimeTransactionClient,
  schema: string,
  table: string,
): Promise<boolean> {
  const result = await safeQuery(
    client,
    postgresJoin(
      [
        'SELECT 1 FROM pg_policies',
        'WHERE schemaname = $1 AND tablename = $2',
        "AND policyname IN ('kovo_owner_scope', 'kovo_authz_policy', 'kovo_admin_scope')",
      ],
      ' ',
    ),
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
  return postgresSomeDense(
    relation.reloptions ?? [],
    (option) => option === 'security_invoker=true',
    'Postgres relation options',
  );
}

async function postgresViewDependencies(
  client: RuntimeTransactionClient,
  schema: string,
  table: string,
): Promise<readonly PostgresViewDependency[]> {
  const usage = await safeQuery<PostgresViewDependency>(
    client,
    postgresJoin(
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
      ],
      ' ',
    ),
    [schema, table, 'pg_rewrite', 'pg_class'],
  );
  return usage?.rows ?? [];
}

function authzPolicyUsedTableNames(authzPolicy: DrizzleSqlLike): string[] {
  const usedTables = postgresOwnDataValue(
    authzPolicy as unknown as Record<PropertyKey, unknown>,
    'usedTables',
  );
  if (!securityArrayIsArray(usedTables)) return [];
  const tableNames: string[] = [];
  const tableCount = postgresDenseArrayLength(usedTables, 'Postgres authz-policy used tables');
  for (let index = 0; index < tableCount; index += 1) {
    const tableName = postgresDenseArrayValue(
      usedTables,
      index,
      'Postgres authz-policy used tables',
    );
    if (typeof tableName === 'string') appendPostgresValue(tableNames, tableName);
  }
  return tableNames;
}

function isDrizzleSqlLike(value: unknown): value is DrizzleSqlLike {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function') ||
    postgresIsProxy(value)
  ) {
    return false;
  }
  const queryChunks = postgresOwnDataValue(value as Record<PropertyKey, unknown>, 'queryChunks');
  return (
    securityArrayIsArray(queryChunks) && typeof (value as DrizzleSqlLike).toQuery === 'function'
  );
}

function unsupportedAuthzPolicyError(tableName: string, detail: string): Error {
  return new Error(
    `KV433_AUTHZ_POLICY_UNSUPPORTED: Postgres authzPolicy for ${tableName} must be a conservative no-parameter SQL predicate; ${detail} (SPEC §10.3).`,
  );
}

function kovoDomainAnnotation(table: PgTable): KovoDomainAnnotation | undefined {
  if (postgresIsProxy(table as unknown as object)) {
    throw new TypeError('Postgres schema tables must not be Proxies.');
  }
  const values: unknown[] = [];
  const keys = witnessOwnKeys(table as unknown as object);
  const keyCount = postgresDenseArrayLength(keys, 'Postgres table annotation keys');
  for (let index = 0; index < keyCount; index += 1) {
    const key = postgresDenseArrayValue(keys, index, 'Postgres table annotation keys');
    const descriptor = witnessGetOwnPropertyDescriptor(table as unknown as object, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Postgres schema table properties must be own data.');
    }
    appendPostgresValue(values, descriptor.value);
  }
  const valueCount = postgresDenseArrayLength(values, 'Postgres table annotation values');
  for (let index = 0; index < valueCount; index += 1) {
    const value = postgresDenseArrayValue(values, index, 'Postgres table annotation values');
    if (
      value !== null &&
      (typeof value === 'object' || typeof value === 'function') &&
      !postgresIsProxy(value) &&
      postgresOwnDataValue(value as Record<PropertyKey, unknown>, 'domain') !== undefined
    ) {
      return postgresOwnDataSnapshot(value, 'Postgres Kovo domain annotation');
    }
  }
  return undefined;
}

async function safeQuery<Row extends QueryResultRow>(
  client: RuntimeTransactionClient,
  query: string,
  params?: readonly unknown[],
): Promise<{ rows: Row[] } | undefined> {
  const savepoint = 'kovo_posture_optional_query';
  let savepointCreated = false;
  try {
    await client.exec(`SAVEPOINT ${savepoint}`);
    savepointCreated = true;
    const result = await client.query<Row>(query, snapshotPostgresQueryParams(params));
    await client.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return { rows: snapshotPostgresQueryRows(result.rows, 'Postgres catalog rows') };
  } catch {
    if (savepointCreated) {
      try {
        await client.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await client.exec(`RELEASE SAVEPOINT ${savepoint}`);
      } catch {
        // The outer posture transaction still fails closed if savepoint recovery is unavailable.
      }
    }
    return undefined;
  }
}

function pgTablePolicyNames(table: unknown): string[] {
  try {
    if (
      (typeof table === 'object' || typeof table === 'function') &&
      table !== null &&
      postgresIsProxy(table)
    ) {
      throw new TypeError('Postgres declared-write tables must not be Proxies.');
    }
    const config = getTableConfig(table as PgTable);
    const schema = postgresOwnDataValue(
      config as unknown as Record<PropertyKey, unknown>,
      'schema',
    );
    const schemaName = typeof schema === 'string' ? schema : undefined;
    const names = [config.name, normalizePolicyTable(config.name)];
    if (schemaName !== undefined) appendPostgresValue(names, `${schemaName}.${config.name}`);
    const unique = createWitnessSet<string>();
    const output: string[] = [];
    const nameCount = postgresDenseArrayLength(names, 'Postgres policy table names');
    for (let index = 0; index < nameCount; index += 1) {
      const name = postgresDenseArrayValue(names, index, 'Postgres policy table names');
      if (!witnessSetHas(unique, name)) {
        witnessSetAdd(unique, name);
        appendPostgresValue(output, name);
      }
    }
    return output;
  } catch {
    throw new Error(
      'KV406: Postgres declared-write fallback could not resolve a Drizzle write table (SPEC §10.3/§11.2).',
    );
  }
}

function normalizePolicyTable(table: string): string {
  return securityStringIncludes(table, '.') ? table : `public.${table}`;
}

function tableSchemaName(config: PgTableConfig): string {
  const schema = postgresOwnDataValue(config as unknown as Record<PropertyKey, unknown>, 'schema');
  return typeof schema === 'string' && schema !== '' ? schema : 'public';
}

function postgresSchemaNames(tables: readonly PgTable[]): readonly string[] {
  const schemas = createWitnessSet<string>();
  const tableCount = postgresDenseArrayLength(tables, 'Postgres schema-name tables');
  for (let index = 0; index < tableCount; index += 1) {
    witnessSetAdd(
      schemas,
      tableSchemaName(
        getTableConfig(postgresDenseArrayValue(tables, index, 'Postgres schema-name tables')),
      ),
    );
  }
  return postgresSetValues(schemas);
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
  return `"${securityStringReplaceAll(value, '"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${securityStringReplaceAll(value, "'", "''")}'`;
}
