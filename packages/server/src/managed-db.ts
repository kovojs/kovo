// SPEC §6.6/§9.4/§10.3 (plans/secure-framework.md MARQUEE): the framework-owned managed DB handle.
//
// This is the shipped KV433 Stage-1 runtime floor (the read-only loader proxy) unified with KV422
// (the SQL-safe managed handle). Where Kovo owns and threads the handle, loaders receive one
// managed read handle and mutations receive one managed write handle:
//
//   - `managedDb(raw, 'read')`  → SQL-safe (KV422) + read capability proxy (KV433). A `query()`
//     loader receives only the framework-approved read surface; every other property fails closed
//     at runtime and is absent from the `Reader<Db>` type mirror.
//   - `managedDb(raw, 'write')` → SQL-safe (KV422) only. A `mutation()` or other explicit write
//     surface gets the full read-write handle.
//
// The read-only proxy is the safe-default runtime backstop; the KV433 direct static no-write-
// reachable check remains the by-construction guarantee, while broader interprocedural write-
// summary work is still residue (SPEC §6.6/§10.3: proxies are defense-in-depth, never sold as the
// proof).

import {
  createFrameworkManagedSqlDispatchProxy,
  frameworkManagedSqlDispatchPropertyValue,
  frameworkManagedDbRawTarget,
  isFrameworkManagedSqlDispatchProxy,
  isFrameworkManagedTestFixtureSqlDispatchProxy,
  managedSqlExecutionPolicy,
  wrapManagedDbForSqlSafety,
  type ManagedSqlWritePolicy,
} from './sql-safe-handle.js';
import {
  frameworkTrustedSqlCarrier,
  snapshotManagedSqlStatement,
} from '@kovojs/core/internal/sql-safety';
import {
  createBoundedRuntimeAuditCollector,
  securityClassifier,
} from '@kovojs/core/internal/security-markers';
import { requestInputProvenanceForValue } from './request-input-provenance.js';
import {
  createWitnessMap,
  createWitnessSet,
  createWitnessWeakMap,
  createWitnessWeakSet,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessIsArray,
  witnessMapForEach,
  witnessMapGet,
  witnessMapSet,
  witnessOwnKeys,
  witnessProxy,
  witnessRegExpExec,
  witnessReflectApply,
  witnessReflectGet,
  witnessSetForEach,
  witnessSetAdd,
  witnessWeakMapGet,
  witnessWeakMapSet,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';
import {
  forEachReadonlyMapEntry,
  forEachReadonlySetValue,
} from './readonly-collection-snapshot.js';
import { runtimeEnvironmentValue } from './runtime-environment-authority.js';

declare const readerDbBrand: unique symbol;
declare const writerDbBrand: unique symbol;

/** Adapter hook for providing a framework-owned engine read-only DB handle. */
export const kovoReadonlyDbHandle: unique symbol = Symbol('kovo.readonly-db-handle');

/**
 * Adapter hook for providing a framework-owned write DB handle whose underlying engine or
 * adapter-enforced boundary applies the mutation's declared write table policy (SPEC §10.3/§11.2).
 * Generated starter runtimes attach this symbol to their Drizzle handle so `managedDb(...,
 * 'write')` can resolve a request-scoped writer before raw SQL provenance guards are layered on.
 */
export const kovoDeclaredWriteDbHandle: unique symbol = Symbol('kovo.declared-write-db-handle');

/**
 * @internal Adapter contract for a DB value that can vend a dedicated/read-only reader.
 */
export interface KovoReadonlyDbCapable<ReadDb = unknown> {
  [kovoReadonlyDbHandle](): ReadDb;
}

/**
 * @internal Adapter contract for a DB value that can vend an engine-scoped declared-write handle.
 */
export interface KovoDeclaredWriteDbCapable<WriteDb = unknown> {
  [kovoDeclaredWriteDbHandle](policy: ManagedSqlWritePolicy): WriteDb;
}

/** Framework-owned SQLite authorizer constants supplied by the runtime's SQLite engine. */
export interface DeclaredWriteSqliteAuthorizerConstants {
  SQLITE_ALTER_TABLE: number;
  SQLITE_ATTACH: number;
  SQLITE_CREATE_INDEX: number;
  SQLITE_CREATE_TABLE: number;
  SQLITE_CREATE_TEMP_INDEX: number;
  SQLITE_CREATE_TEMP_TABLE: number;
  SQLITE_CREATE_TEMP_TRIGGER: number;
  SQLITE_CREATE_TEMP_VIEW: number;
  SQLITE_CREATE_TRIGGER: number;
  SQLITE_CREATE_VIEW: number;
  SQLITE_CREATE_VTABLE: number;
  SQLITE_DELETE: number;
  SQLITE_DENY: number;
  SQLITE_DETACH: number;
  SQLITE_DROP_INDEX: number;
  SQLITE_DROP_TABLE: number;
  SQLITE_DROP_TEMP_INDEX: number;
  SQLITE_DROP_TEMP_TABLE: number;
  SQLITE_DROP_TEMP_TRIGGER: number;
  SQLITE_DROP_TEMP_VIEW: number;
  SQLITE_DROP_TRIGGER: number;
  SQLITE_DROP_VIEW: number;
  SQLITE_DROP_VTABLE: number;
  SQLITE_INSERT: number;
  SQLITE_OK: number;
  SQLITE_PRAGMA: number;
  SQLITE_READ?: number;
  SQLITE_REINDEX: number;
  SQLITE_UPDATE: number;
}

/** Framework-owned structural SQLite authorizer database handle. */
export interface DeclaredWriteSqliteAuthorizerDatabase {
  close(): void;
  prepare(statement: string): unknown;
  setAuthorizer(
    callback: (
      action: number,
      objectName: string | null,
      columnName: string | null,
      databaseName: string | null,
      triggerOrView: string | null,
    ) => number,
  ): void;
}

type SqliteAuthorizer = Parameters<DeclaredWriteSqliteAuthorizerDatabase['setAuthorizer']>[0];

/** SQLite engine mechanism options for {@link createDeclaredWriteDb}. */
export interface DeclaredWriteSqliteAuthorizerOptions {
  constants: DeclaredWriteSqliteAuthorizerConstants;
  openDatabase(): DeclaredWriteSqliteAuthorizerDatabase;
}

/** Schema-derived governed-column metadata consumed by the KV438 runtime write floor. */
export interface GovernedWriteMetadata {
  governedColumnKeysByTable: ReadonlyMap<string, ReadonlySet<string>>;
  governedColumnNamesByTable: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Options for the framework-owned declared-write DB choke. */
export interface DeclaredWriteDbOptions {
  dialectLabel: string;
  governedColumns?: GovernedWriteMetadata;
  normalizeTableName: (table: string) => string;
  sqliteAuthorizer?: DeclaredWriteSqliteAuthorizerOptions;
  tableNames: (table: unknown) => readonly string[];
}

/** Options for a Postgres/PGlite read-only transaction client. */
export interface PostgresReadonlyClientOptions {
  principal?: string | undefined;
  quoteIdentifier?: (value: string) => string;
  readerRole?: string | false;
  roleSetting?: string;
  rlsDiagnostics?: PostgresRlsSilentDenyDiagnosticsOptions;
}

/** Options for a Postgres/PGlite request-scoped transaction client. */
export interface PostgresScopedClientOptions {
  principal?: string | undefined;
  quoteIdentifier?: (value: string) => string;
  readOnly?: boolean;
  rlsDiagnostics?: PostgresRlsSilentDenyDiagnosticsOptions;
  role?: string | false;
  roleSetting?: string;
}

/** Minimal query surface for dev-only RLS silent-deny recounts. */
export interface PostgresRlsDiagnosticReadClient {
  query(query: unknown, params?: unknown[], queryOptions?: unknown): unknown;
}

/** Dev-only diagnostics for empty owner-scoped Postgres reads (plans/postgres-v1-devex.md DEC-F1). */
export interface PostgresRlsSilentDenyDiagnosticsOptions {
  /**
   * Defaults to true outside `NODE_ENV=production` when this object is present. Production disables
   * this path unconditionally so least-privilege runtime reads never run a privileged recount.
   */
  enabled?: boolean;
  /** Internal/admin read handle used only for dev recounts after principal-scoped reads return 0 rows. */
  privilegedClient?: PostgresRlsDiagnosticReadClient;
  /** Optional table resolver supplied by framework adapters with declared read metadata. */
  tableName?: string | ((query: unknown) => string | undefined);
}

/** In-memory runtime diagnostic fact drained by tests and future `kovo explain` plumbing. */
export type PostgresRlsSilentDenyDiagnostic =
  | {
      kind: 'principal-unset';
      message: string;
      table?: string;
    }
  | {
      filteredRows: number;
      kind: 'owner-scope-filtered';
      message: string;
      principal: string;
      table: string;
    };

/** Row-scope metadata for an audited public raw read (SPEC §10.3 DEC-F). */
export interface PublicReadRowsScope {
  /** Audit-readable public predicate, for example `published = true`. */
  predicate: string;
  /** Optional physical table the predicate applies to when the raw read spans multiple reads. */
  table?: string;
}

/** User-authored public-read authorization escape, distinct from SQL trust and secret reveal. */
export interface PublicReadDeclaration {
  /** Columns intentionally exposed by the public read; omitted only when the projection is public. */
  columns?: readonly string[];
  /** Required audit reason explaining why this read is public. */
  reason: string;
  /** Row predicate or structured row-scope metadata that makes the read public. */
  rows?: PublicReadRowsScope | string;
}

/** Recorded public-read authorization audit fact (SPEC §10.3 DEC-F, audit-grade). */
export interface PublicReadAuditFact {
  /** Columns declared public for this read. */
  columns?: readonly string[];
  /** Declared read table set after dialect normalization. */
  declaredReads: readonly string[];
  /** Human-readable dialect label supplied by the adapter. */
  dialectLabel: string;
  /** SQLite-observed read table set after dialect normalization, when available. */
  observedReads?: readonly string[];
  /** Observed owner-scoped tables covered by this public-read declaration. */
  ownerReads?: readonly string[];
  /** Required audit reason explaining why this read is public. */
  reason: string;
  /** Row predicate or structured row-scope metadata declared for the public read. */
  rows?: PublicReadRowsScope | string;
}

/** User-authored declaration for the raw read escape (SPEC §10.2/§10.3 DEC-C). */
export interface RawReadDeclaration {
  actAs?: string;
  declarePublicRead?: PublicReadDeclaration;
  reads: readonly string[];
}

/** Framework-owned rawRead enforcement options for a managed read handle. */
export interface RawReadPolicyOptions {
  dialectLabel: string;
  executeSql?: (statement: { params: readonly unknown[]; text: string }) => unknown;
  executeMethod?: 'all' | 'execute' | 'query' | 'values';
  normalizeTableName: (table: string) => string;
  ownerTables?: readonly string[];
  sqliteAuthorizer?: DeclaredWriteSqliteAuthorizerOptions;
}

/** User-authored declaration for the audited cross-owner read escape (SPEC §10.3 DEC-G). */
export interface CrossOwnerReadDeclaration {
  /** Required audit reason explaining why this endpoint may read across owners. */
  reason: string;
  /** Physical table set the statement may read. The v1 runtime supports a single owner table. */
  reads: readonly string[];
  /** Runtime role gate. Only an admin-guarded call may request this capability. */
  role: 'admin';
  /** Optional source span for capability ledgers. */
  site?: string;
}

/** Recorded cross-owner read audit fact. */
export interface CrossOwnerReadAuditFact {
  declaredReads: readonly string[];
  dialectLabel: string;
  observedRead: string;
  principal?: string;
  reason: string;
  site?: string;
}

/** Framework-owned cross-owner read execution options. */
export interface CrossOwnerReadPolicyOptions {
  adminClient?: object;
  dialectLabel: string;
  executeSql?: (statement: { params: readonly unknown[]; text: string }) => unknown;
  executeMethod?: 'all' | 'execute' | 'query' | 'values';
  hasRole?: (role: CrossOwnerReadDeclaration['role']) => boolean;
  normalizeTableName: (table: string) => string;
  ownerTables: readonly string[];
  principal?: string | undefined;
}

/** Runtime authorization classifications grouped by physical SQLite table. */
export type SqliteAuthorizationClassification =
  | 'authzPolicy'
  | 'owned'
  | 'ownedVia'
  | 'public'
  | 'reference';

/** Structural subset of `@kovojs/drizzle` runtime metadata consumed by the DEC-K census floor. */
export interface AuthorizationCensusMetadata {
  authorizationClassificationsByTable?: ReadonlyMap<
    string,
    readonly SqliteAuthorizationClassification[]
  >;
  schemaTableNames?: ReadonlySet<string>;
}

/** Options for the framework-owned managed authorization-census wrapper. */
export interface AuthorizationCensusDbOptions {
  dialectLabel: string;
  metadata: AuthorizationCensusMetadata;
  normalizeTableName: (table: string) => string;
  tableNames: (table: unknown) => readonly string[];
}

const READ_CAPABILITY_PROPERTIES = [
  '$count',
  '$with',
  'crossOwnerRead',
  'query',
  'rawRead',
  'select',
  'selectDistinct',
  'with',
] as const;
const DENIED_READ_CAPABILITY_PROPERTIES = [
  '$client',
  'batch',
  'client',
  'delete',
  'insert',
  'pglite',
  'session',
  'sqlite',
  'transaction',
  'update',
] as const;
const CALLABLE_READ_CAPABILITY_PROPERTIES = [
  '$count',
  '$with',
  'crossOwnerRead',
  'rawRead',
  'select',
  'selectDistinct',
  'with',
] as const;

/**
 * Create a framework-owned declared-write DB wrapper (SPEC §10.3/§11.2). Generated adapters pass
 * only dialect metadata and engine handles; this helper owns the accept/reject decision: `tables:`
 * is the sole write authority, missing `tables:` denies writes, and `touches:` is diagnostic
 * context only.
 */
export const createDeclaredWriteDb = securityClassifier(
  'server.managed-db.declared-write-db',
  function <Db extends object>(
    db: Db,
    policy: ManagedSqlWritePolicy,
    options: DeclaredWriteDbOptions,
  ): Db {
    const [safePolicy, safeOptions, allowed] = snapshotDeclaredWriteBoundary(policy, options);
    const assertSql = assertSqliteDeclaredWriteStatementAllowed;
    return createFrameworkManagedSqlDispatchProxy(db as Record<PropertyKey, unknown>, {
      get(target, prop) {
        const value = authorizationCensusDataPropertyValue(target, prop);
        if (isDeclaredWriteDirectSqlMethod(prop, safeOptions) && typeof value === 'function') {
          return (statement: unknown, ...args: unknown[]) => {
            assertSql(statement, args, safePolicy, safeOptions, allowed);
            return witnessReflectApply(value, target, prependManagedArgument(statement, args));
          };
        }
        if (isDeclaredWriteDrizzleMethod(prop) && typeof value === 'function') {
          return (table: unknown, ...args: unknown[]) => {
            const names = safeOptions.tableNames(table);
            assertDeclaredWriteTablesAllowed(names, safeOptions, allowed);
            const builder = witnessReflectApply(value, target, prependManagedArgument(table, args));
            return prop === 'delete'
              ? builder
              : declaredWriteBuilder(builder, prop, names, safeOptions);
          };
        }
        if (prop === 'transaction' && typeof value === 'function') {
          return (callback: (tx: unknown) => unknown, ...args: unknown[]) => {
            const secured = (tx: unknown) =>
              witnessReflectApply(callback, undefined, [
                createDeclaredWriteDb(tx as object, safePolicy, safeOptions),
              ]);
            return witnessReflectApply(value, target, prependManagedArgument(secured, args));
          };
        }
        return typeof value === 'function'
          ? (...args: unknown[]) => witnessReflectApply(value, target, args)
          : value;
      },
    }) as Db;
  },
);

/**
 * Create a Drizzle handle that denies access to schema tables with no DEC-K authorization
 * classification. This is the managed-handle runtime floor for the authorization census
 * (SPEC §10.3 / DEC-K): the wrapper decides only from framework-owned schema metadata and table
 * objects passed through builder APIs, avoiding SQL text heuristics and avoiding unknown
 * framework/internal driver tables.
 */
export const createAuthorizationCensusDb = securityClassifier(
  'server.managed-db.authorization-census-db',
  function <Db extends object>(db: Db, options: AuthorizationCensusDbOptions): Db {
    return authorizationCensusProxy(
      db,
      snapshotAuthorizationCensusOptions(options),
      undefined,
    ) as Db;
  },
);

/**
 * Construct the Postgres runtime's census handle with its engine hooks sealed before exposure.
 * This package-private entrypoint is intentionally absent from every package export barrel: the
 * public census constructor never accepts or registers engine authority (SPEC §6.6/§10.3 DEC-K).
 *
 * @internal
 */
export const createFrameworkAuthorizationCensusDb = securityClassifier(
  'server.managed-db.framework-authorization-census-db',
  function <Db extends object>(
    db: Db,
    options: AuthorizationCensusDbOptions,
    createReadonly: () => unknown,
    createDeclaredWrite: (policy: ManagedSqlWritePolicy) => unknown,
  ): Db {
    const proxy = authorizationCensusProxy(
      db,
      snapshotAuthorizationCensusOptions(options),
      undefined,
    ) as Db;
    registerFrameworkManagedDbHooks(proxy, createReadonly, createDeclaredWrite);
    return proxy;
  },
);

/** Register framework-owned adapter hooks before a runtime DB handle is exposed. @internal */
export const registerFrameworkManagedDbHooks = securityClassifier(
  'server.managed-db.register-framework-hooks',
  function (
    target: object,
    createReadonly: (() => unknown) | undefined,
    createDeclaredWrite: ((policy: ManagedSqlWritePolicy) => unknown) | undefined,
  ): void {
    if (createReadonly === undefined && createDeclaredWrite === undefined) {
      throw new Error('At least one framework managed DB hook must be registered.');
    }
    if (witnessWeakMapGet(authorizationCensusFrameworkHooks, target) !== undefined) {
      throw new Error('Framework managed DB hooks were already registered for this handle.');
    }
    witnessWeakMapSet(
      authorizationCensusFrameworkHooks,
      target,
      witnessFreeze({
        declaredWrite: createDeclaredWrite,
        readonly: createReadonly,
      }),
    );
  },
);

/**
 * Create a Postgres/PGlite client whose `query`/`exec` methods always run inside a read-only
 * transaction, optionally assuming a reader role before app SQL executes (SPEC §10.3 KV433).
 */
export const createPostgresReadonlyClient = securityClassifier(
  'server.managed-db.postgres-readonly-client',
  function <Client extends object>(
    client: Client,
    options: PostgresReadonlyClientOptions = {},
  ): Client {
    return createPostgresScopedClient(client, postgresReadonlyScopedOptions(options));
  },
);

/**
 * Create a Postgres/PGlite client whose app SQL runs as one extended-protocol statement inside a
 * transaction-scoped role/principal frame (SPEC §10.3 RLS owner scoping). The framework binds
 * `kovo.principal` with parameters before assuming the app role; direct `exec` is blocked for
 * role/principal-scoped handles so appended simple-query control text cannot widen the frame.
 */
export const createPostgresScopedClient = securityClassifier(
  'server.managed-db.postgres-scoped-client',
  function <Client extends object>(
    client: Client,
    options: PostgresScopedClientOptions = {},
  ): Client {
    const scopedOptions = snapshotPostgresScopedClientOptions(options);
    return postgresScopedClientFacade(client, scopedOptions);
  },
);

/**
 * Thrown when a `query()` loader calls a write verb on its read-only managed handle (SPEC §9.4
 * KV433 Stage 1). This is the fail-closed runtime floor; the direct static no-write-reachable
 * proof is the by-construction guarantee. Move the write to a mutation/domain/endpoint write
 * surface.
 */
export class KovoReadonlyHandleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KovoReadonlyHandleError';
  }
}

function postgresScopedClientFacade<Client extends object>(
  client: Client,
  options: PostgresScopedClientOptions,
): Client {
  const target = client as Record<PropertyKey, unknown>;
  const transactionMethod = postgresTransactionMethod(target);
  const facade = witnessCreateNullRecord<unknown>();
  witnessDefineProperty(facade, 'query', {
    enumerable: true,
    value(query: unknown, params?: unknown[], queryOptions?: unknown) {
      return scopedPostgresQuery(target, transactionMethod, options, query, params, queryOptions);
    },
  });
  witnessDefineProperty(facade, 'exec', {
    enumerable: true,
    value(query: string) {
      return scopedPostgresExec(options, query);
    },
  });
  witnessDefineProperty(facade, 'transaction', {
    enumerable: true,
    value<Result>(callback: (tx: unknown) => Promise<Result> | Result, ...args: unknown[]) {
      return scopedPostgresTransaction(target, transactionMethod, options, callback, args);
    },
  });
  defineBlockedPostgresProperties(facade, POSTGRES_BLOCKED_CLIENT_PROPERTIES);
  return witnessFreeze(facade) as Client;
}

const POSTGRES_BLOCKED_CLIENT_PROPERTIES = [
  'close',
  'clone',
  'copyToFS',
  'describeQuery',
  'dumpDataDir',
  'execProtocol',
  'execProtocolRaw',
  'execProtocolRawStream',
  'execProtocolRawSync',
  'execProtocolStream',
  'handleExternalCmd',
  'isInTransaction',
  'listen',
  'offNotification',
  'onNotification',
  'refreshArrayTypes',
  'runExclusive',
  'sql',
  'syncToFs',
  'unlisten',
] as const;

const POSTGRES_BLOCKED_TRANSACTION_PROPERTIES = ['listen', 'rollback', 'sql'] as const;

function defineBlockedPostgresProperties(
  facade: Record<PropertyKey, unknown>,
  properties: readonly PropertyKey[],
): void {
  for (let index = 0; index < properties.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(properties, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Postgres blocked property list integrity failed.');
    }
    const property = descriptor.value;
    witnessDefineProperty(facade, property, {
      value() {
        throw new KovoReadonlyHandleError(
          `KV433: Postgres scoped property ${String(property)} could bypass the framework transaction role frame (SPEC §10.3/§11.2).`,
        );
      },
    });
  }
}

function snapshotManagedWritePolicy(policy: ManagedSqlWritePolicy): ManagedSqlWritePolicy {
  const capability = optionalOwnDataProperty(policy, 'capability');
  const dialect = optionalOwnDataProperty(policy, 'dialect');
  const engineReadonly = optionalOwnDataProperty(policy, 'engineReadonly');
  const tables = optionalOwnDataProperty(policy, 'tables');
  const touches = optionalOwnDataProperty(policy, 'touches');
  const snapshot = witnessCreateNullRecord<unknown>() as ManagedSqlWritePolicy;
  if (capability !== undefined) {
    if (capability !== 'read' && capability !== 'write') {
      throw new TypeError('managed SQL capability must be read or write.');
    }
    snapshot.capability = capability;
  }
  if (dialect !== undefined) {
    if (dialect !== 'postgres' && dialect !== 'sqlite') {
      throw new TypeError('managed SQL dialect is invalid.');
    }
    snapshot.dialect = dialect;
  }
  if (engineReadonly !== undefined) {
    if (typeof engineReadonly !== 'boolean') {
      throw new TypeError('managed SQL engineReadonly must be boolean.');
    }
    snapshot.engineReadonly = engineReadonly;
  }
  if (tables !== undefined) snapshot.tables = snapshotStringArray(tables, 'declared write tables');
  if (touches !== undefined)
    snapshot.touches = snapshotStringArray(touches, 'declared write touches');
  return witnessFreeze(snapshot);
}

function snapshotDeclaredWriteBoundary(
  policy: ManagedSqlWritePolicy,
  options: DeclaredWriteDbOptions,
): readonly [ManagedSqlWritePolicy, DeclaredWriteDbOptions, readonly string[]] {
  const safePolicy = snapshotManagedWritePolicy(policy);
  const safeOptions = snapshotDeclaredWriteOptions(options);
  const allowed = normalizedStringArray(
    safePolicy.tables ?? [],
    safeOptions.normalizeTableName,
    'declared write tables',
  );
  return [safePolicy, safeOptions, allowed];
}

function snapshotDeclaredWriteOptions(options: DeclaredWriteDbOptions): DeclaredWriteDbOptions {
  const normalizeTableNameControl = ownFunctionDataProperty(options, 'normalizeTableName');
  const tableNames = ownFunctionDataProperty(options, 'tableNames');
  const runtime = witnessCreateNullRecord<unknown>() as unknown as DeclaredWriteDbOptions;
  runtime.dialectLabel = ownStringDataProperty(options, 'dialectLabel');
  runtime.normalizeTableName = function normalizeDeclaredWriteTable(table) {
    const normalized = witnessReflectApply<unknown>(normalizeTableNameControl, options, [table]);
    if (typeof normalized !== 'string') {
      throw new TypeError('declared-write table normalization must return a string.');
    }
    return normalized;
  };
  runtime.tableNames = function tableNamesSnapshot(table) {
    const names = witnessReflectApply<unknown>(tableNames, options, [table]);
    return snapshotStringArray(names, 'observed declared-write table names');
  };
  const governedColumns = optionalOwnDataProperty(options, 'governedColumns');
  const sqliteAuthorizer = optionalOwnDataProperty(options, 'sqliteAuthorizer');
  if (governedColumns !== undefined) {
    runtime.governedColumns = snapshotGovernedWriteMetadata(governedColumns);
  }
  if (sqliteAuthorizer !== undefined) {
    runtime.sqliteAuthorizer = snapshotSqliteAuthorizer(
      sqliteAuthorizer as DeclaredWriteSqliteAuthorizerOptions,
    );
  }
  return witnessFreeze(runtime);
}

function snapshotGovernedWriteMetadata(value: unknown): GovernedWriteMetadata {
  if (!isRecord(value)) throw new TypeError('governed write metadata must be an object.');
  return witnessFreeze({
    governedColumnKeysByTable: snapshotStringSetMap(
      optionalOwnDataProperty(value, 'governedColumnKeysByTable'),
      'governed column keys',
    ),
    governedColumnNamesByTable: snapshotStringSetMap(
      optionalOwnDataProperty(value, 'governedColumnNamesByTable'),
      'governed column names',
    ),
  });
}

function snapshotStringSetMap(
  value: unknown,
  label: string,
): ReadonlyMap<string, ReadonlySet<string>> {
  if (!isRecord(value)) throw new TypeError(`${label} must be a Map.`);
  const snapshot = createWitnessMap<string, ReadonlySet<string>>();
  forEachReadonlyMapEntry(value, label, (columns, table) => {
    if (typeof table !== 'string' || !isRecord(columns)) {
      throw new TypeError(`${label} must map string tables to string sets.`);
    }
    const columnSnapshot = createWitnessSet<string>();
    forEachReadonlySetValue(columns, `${label}.${table}`, (column) => {
      if (typeof column !== 'string') throw new TypeError(`${label} must contain string columns.`);
      witnessSetAdd(columnSnapshot, column);
    });
    witnessMapSet(snapshot, table, columnSnapshot);
  });
  return snapshot;
}

function snapshotAuthorizationCensusOptions(
  options: AuthorizationCensusDbOptions,
): AuthorizationCensusDbOptions {
  const normalizeTableName = ownFunctionDataProperty(options, 'normalizeTableName');
  const tableNames = ownFunctionDataProperty(options, 'tableNames');
  const metadata = optionalOwnDataProperty(options, 'metadata');
  if (!isRecord(metadata)) throw new TypeError('authorization census metadata must be an object.');
  const schemaSource = optionalOwnDataProperty(metadata, 'schemaTableNames');
  const classificationsSource = optionalOwnDataProperty(
    metadata,
    'authorizationClassificationsByTable',
  );
  const schemaTableNames = createWitnessSet<string>();
  if (schemaSource !== undefined) {
    if (!isRecord(schemaSource)) {
      throw new TypeError('authorization census schemaTableNames must be a Set.');
    }
    forEachReadonlySetValue(schemaSource, 'authorization census schemaTableNames', (table) => {
      if (typeof table !== 'string') {
        throw new TypeError('authorization census schema table names must be strings.');
      }
      witnessSetAdd(schemaTableNames, table);
    });
  }
  const authorizationClassificationsByTable = createWitnessMap<
    string,
    readonly SqliteAuthorizationClassification[]
  >();
  if (classificationsSource !== undefined) {
    if (!isRecord(classificationsSource)) {
      throw new TypeError('authorization census classifications must be a Map.');
    }
    forEachReadonlyMapEntry(
      classificationsSource,
      'authorization census classifications',
      (values, table) => {
        if (typeof table !== 'string') {
          throw new TypeError('authorization census classification table names must be strings.');
        }
        const classifications = snapshotAuthorizationClassifications(values);
        witnessMapSet(authorizationClassificationsByTable, table, classifications);
      },
    );
  }
  const runtime: AuthorizationCensusDbOptions = {
    dialectLabel: ownStringDataProperty(options, 'dialectLabel'),
    metadata: witnessFreeze({ authorizationClassificationsByTable, schemaTableNames }),
    normalizeTableName(table) {
      const normalized = witnessReflectApply<unknown>(normalizeTableName, options, [table]);
      if (typeof normalized !== 'string') {
        throw new TypeError('authorization census table normalization must return a string.');
      }
      return normalized;
    },
    tableNames(table) {
      return snapshotStringArray(
        witnessReflectApply(tableNames, options, [table]),
        'authorization census observed tables',
      );
    },
  };
  return witnessFreeze(runtime);
}

function snapshotAuthorizationClassifications(
  value: unknown,
): readonly SqliteAuthorizationClassification[] {
  const source = snapshotStringArray(value, 'authorization census classifications');
  const snapshot: SqliteAuthorizationClassification[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const classification = source[index]!;
    if (
      classification !== 'authzPolicy' &&
      classification !== 'owned' &&
      classification !== 'ownedVia' &&
      classification !== 'public' &&
      classification !== 'reference'
    ) {
      throw new TypeError(`unknown authorization census classification ${classification}.`);
    }
    appendManagedValue(snapshot, classification);
  }
  return witnessFreeze(snapshot);
}

function snapshotPostgresScopedClientOptions(
  options: PostgresScopedClientOptions,
): PostgresScopedClientOptions {
  const snapshot = witnessCreateNullRecord<unknown>() as PostgresScopedClientOptions;
  const principal = optionalOwnDataProperty(options, 'principal');
  const quoteIdentifier = optionalOwnDataProperty(options, 'quoteIdentifier');
  const readOnly = optionalOwnDataProperty(options, 'readOnly');
  const role = optionalOwnDataProperty(options, 'role');
  const roleSetting = optionalOwnDataProperty(options, 'roleSetting');
  const rlsDiagnostics = optionalOwnDataProperty(options, 'rlsDiagnostics');
  if (principal !== undefined) {
    if (typeof principal !== 'string') throw new TypeError('Postgres principal must be a string.');
    snapshot.principal = principal;
  }
  if (quoteIdentifier !== undefined) {
    if (typeof quoteIdentifier !== 'function') {
      throw new TypeError('Postgres quoteIdentifier must be a function.');
    }
    snapshot.quoteIdentifier = (value) => {
      const quoted = witnessReflectApply<unknown>(quoteIdentifier, options, [value]);
      if (typeof quoted !== 'string') throw new TypeError('Postgres identifier quoting failed.');
      return quoted;
    };
  }
  if (readOnly !== undefined) {
    if (typeof readOnly !== 'boolean') throw new TypeError('Postgres readOnly must be a boolean.');
    snapshot.readOnly = readOnly;
  }
  if (role !== undefined) {
    if (role !== false && typeof role !== 'string') {
      throw new TypeError('Postgres role must be a string or false.');
    }
    snapshot.role = role;
  }
  if (roleSetting !== undefined) {
    if (typeof roleSetting !== 'string')
      throw new TypeError('Postgres roleSetting must be a string.');
    snapshot.roleSetting = roleSetting;
  }
  if (rlsDiagnostics !== undefined) {
    snapshot.rlsDiagnostics = snapshotPostgresRlsDiagnostics(rlsDiagnostics);
  }
  return witnessFreeze(snapshot);
}

function postgresReadonlyScopedOptions(
  options: PostgresReadonlyClientOptions,
): PostgresScopedClientOptions {
  const snapshot = witnessCreateNullRecord<unknown>() as PostgresScopedClientOptions;
  snapshot.readOnly = true;
  const principal = optionalOwnDataProperty(options, 'principal');
  const quoteIdentifier = optionalOwnDataProperty(options, 'quoteIdentifier');
  const readerRole = optionalOwnDataProperty(options, 'readerRole');
  const roleSetting = optionalOwnDataProperty(options, 'roleSetting');
  const rlsDiagnostics = optionalOwnDataProperty(options, 'rlsDiagnostics');
  if (principal !== undefined) {
    if (typeof principal !== 'string') throw new TypeError('Postgres principal must be a string.');
    snapshot.principal = principal;
  }
  if (quoteIdentifier !== undefined) {
    if (typeof quoteIdentifier !== 'function') {
      throw new TypeError('Postgres quoteIdentifier must be a function.');
    }
    snapshot.quoteIdentifier = (value) => {
      const quoted = witnessReflectApply<unknown>(quoteIdentifier, options, [value]);
      if (typeof quoted !== 'string') throw new TypeError('Postgres identifier quoting failed.');
      return quoted;
    };
  }
  if (readerRole !== undefined) {
    if (readerRole !== false && typeof readerRole !== 'string') {
      throw new TypeError('Postgres readerRole must be a string or false.');
    }
    snapshot.role = readerRole;
  }
  if (roleSetting !== undefined) {
    if (typeof roleSetting !== 'string')
      throw new TypeError('Postgres roleSetting must be a string.');
    snapshot.roleSetting = roleSetting;
  }
  if (rlsDiagnostics !== undefined) {
    if (!isRecord(rlsDiagnostics))
      throw new TypeError('Postgres RLS diagnostics must be an object.');
    snapshot.rlsDiagnostics = rlsDiagnostics;
  }
  return snapshotPostgresScopedClientOptions(snapshot);
}

function snapshotPostgresRlsDiagnostics(value: unknown): PostgresRlsSilentDenyDiagnosticsOptions {
  if (!isRecord(value)) throw new TypeError('Postgres RLS diagnostics must be an object.');
  const snapshot = witnessCreateNullRecord<unknown>() as PostgresRlsSilentDenyDiagnosticsOptions;
  const enabled = optionalOwnDataProperty(value, 'enabled');
  const privilegedClient = optionalOwnDataProperty(value, 'privilegedClient');
  const tableName = optionalOwnDataProperty(value, 'tableName');
  if (enabled !== undefined) {
    if (typeof enabled !== 'boolean')
      throw new TypeError('RLS diagnostics enabled must be boolean.');
    snapshot.enabled = enabled;
  }
  if (privilegedClient !== undefined) {
    if (!isRecord(privilegedClient)) {
      throw new TypeError('RLS diagnostics privilegedClient must be an object.');
    }
    const query = optionalStrictInheritedFunctionDataProperty(privilegedClient, 'query');
    if (query === undefined) {
      throw new TypeError('RLS diagnostics privilegedClient requires a query method.');
    }
    snapshot.privilegedClient = witnessFreeze({
      query(statement: unknown, params?: unknown[], queryOptions?: unknown) {
        const args: unknown[] = [];
        appendManagedValue(args, statement);
        appendManagedValue(args, params);
        appendManagedValue(args, queryOptions);
        return witnessReflectApply(query, privilegedClient, args);
      },
    });
  }
  if (tableName !== undefined) {
    if (typeof tableName !== 'string' && typeof tableName !== 'function') {
      throw new TypeError('RLS diagnostics tableName must be a string or function.');
    }
    snapshot.tableName = tableName as string | ((query: unknown) => string | undefined);
  }
  return witnessFreeze(snapshot);
}

function snapshotSqliteAuthorizer(
  authorizer: DeclaredWriteSqliteAuthorizerOptions,
): DeclaredWriteSqliteAuthorizerOptions {
  const openDatabase = ownFunctionDataProperty(authorizer, 'openDatabase');
  const constantsDescriptor = witnessGetOwnPropertyDescriptor(authorizer, 'constants');
  if (
    constantsDescriptor === undefined ||
    !('value' in constantsDescriptor) ||
    typeof constantsDescriptor.value !== 'object' ||
    constantsDescriptor.value === null
  ) {
    throw new TypeError('SQLite authorizer constants must be an own object data property.');
  }
  const constants = constantsDescriptor.value as DeclaredWriteSqliteAuthorizerConstants;
  const snapshot = witnessCreateNullRecord<number>() as Record<string, number>;
  const keys = witnessOwnKeys(constants);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (typeof key !== 'string') continue;
    const descriptor = witnessGetOwnPropertyDescriptor(constants, key);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'number'
    ) {
      throw new TypeError(
        `SQLite authorizer constant ${key} must be an own numeric data property.`,
      );
    }
    witnessDefineProperty(snapshot, key, {
      enumerable: true,
      value: descriptor.value,
    });
  }
  return witnessFreeze({
    constants: witnessFreeze(snapshot) as unknown as DeclaredWriteSqliteAuthorizerConstants,
    openDatabase() {
      const database = witnessReflectApply<unknown>(openDatabase, authorizer, []);
      if (typeof database !== 'object' || database === null) {
        throw new TypeError('SQLite authorizer openDatabase() must return a database handle.');
      }
      return database as DeclaredWriteSqliteAuthorizerDatabase;
    },
  });
}

function ownFunctionDataProperty(value: object, property: PropertyKey): Function {
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'function'
  ) {
    throw new TypeError(`${String(property)} must be an own function data property.`);
  }
  return descriptor.value;
}

function inheritedFunctionDataProperty(value: object, property: PropertyKey): Function {
  let current: object | null = value;
  for (let depth = 0; current !== null && depth < 16; depth += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(current, property);
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new TypeError(`${String(property)} must resolve to a function data property.`);
      }
      return descriptor.value;
    }
    current = witnessGetPrototypeOf(current);
  }
  throw new TypeError(`${String(property)} function is unavailable.`);
}

function optionalInheritedFunctionDataProperty(
  value: object,
  property: PropertyKey,
): Function | undefined {
  try {
    return inheritedFunctionDataProperty(value, property);
  } catch {
    return undefined;
  }
}

function optionalStrictInheritedFunctionDataProperty(
  value: object,
  property: PropertyKey,
): Function | undefined {
  const resolved = optionalStrictInheritedDataProperty(value, property);
  if (resolved === undefined) return undefined;
  if (typeof resolved !== 'function') {
    throw new TypeError(`${String(property)} must resolve to a function data property.`);
  }
  return resolved;
}

function optionalStrictInheritedDataProperty(value: object, property: PropertyKey): unknown {
  let current: object | null = value;
  for (let depth = 0; current !== null && depth < 16; depth += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(current, property);
    if (descriptor !== undefined) {
      if (!('value' in descriptor))
        throw new TypeError(`${String(property)} must be a data property.`);
      return descriptor.value;
    }
    current = witnessGetPrototypeOf(current);
  }
  return undefined;
}

function ownStringDataProperty(value: object, property: PropertyKey): string {
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'string'
  ) {
    throw new TypeError(`${String(property)} must be an own string data property.`);
  }
  return descriptor.value;
}

function optionalOwnDataProperty(value: object, property: PropertyKey): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw new TypeError(`${String(property)} must be an own data property.`);
  }
  return descriptor.value;
}

const SQLITE_WRITE_AUTHORIZER_CONSTANT_KEYS = [
  'SQLITE_ALTER_TABLE',
  'SQLITE_ATTACH',
  'SQLITE_CREATE_INDEX',
  'SQLITE_CREATE_TABLE',
  'SQLITE_CREATE_TEMP_INDEX',
  'SQLITE_CREATE_TEMP_TABLE',
  'SQLITE_CREATE_TEMP_TRIGGER',
  'SQLITE_CREATE_TEMP_VIEW',
  'SQLITE_CREATE_TRIGGER',
  'SQLITE_CREATE_VIEW',
  'SQLITE_CREATE_VTABLE',
  'SQLITE_DELETE',
  'SQLITE_DENY',
  'SQLITE_DETACH',
  'SQLITE_DROP_INDEX',
  'SQLITE_DROP_TABLE',
  'SQLITE_DROP_TEMP_INDEX',
  'SQLITE_DROP_TEMP_TABLE',
  'SQLITE_DROP_TEMP_TRIGGER',
  'SQLITE_DROP_TEMP_VIEW',
  'SQLITE_DROP_TRIGGER',
  'SQLITE_DROP_VIEW',
  'SQLITE_DROP_VTABLE',
  'SQLITE_INSERT',
  'SQLITE_OK',
  'SQLITE_PRAGMA',
  'SQLITE_REINDEX',
  'SQLITE_UPDATE',
] as const satisfies readonly (keyof DeclaredWriteSqliteAuthorizerConstants)[];

function assertSqliteWriteAuthorizerConstants(
  constants: DeclaredWriteSqliteAuthorizerConstants,
): void {
  for (let index = 0; index < SQLITE_WRITE_AUTHORIZER_CONSTANT_KEYS.length; index += 1) {
    const key = SQLITE_WRITE_AUTHORIZER_CONSTANT_KEYS[index]!;
    const descriptor = witnessGetOwnPropertyDescriptor(constants, key);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'number'
    ) {
      throw new TypeError(`SQLite declared-write authorizer is missing numeric ${key}.`);
    }
  }
}

const assertDeclaredWriteTablesAllowed = securityClassifier(
  'server.managed-db.declared-write-tables',
  function (
    tableNames: readonly string[],
    options: DeclaredWriteDbOptions,
    allowed: readonly string[],
  ): void {
    const normalized = normalizedStringArray(
      tableNames,
      options.normalizeTableName,
      'observed write tables',
    );
    for (let index = 0; index < normalized.length; index += 1) {
      if (stringListHas(allowed, normalized[index]!)) continue;
      throw declaredWriteTableDenial(tableNames[index], options);
    }
  },
);

function declaredWriteTableDenial(
  table: string | undefined,
  options: DeclaredWriteDbOptions,
): Error {
  return new Error(
    `KV406: ${options.dialectLabel} declared-write wrapper rejected table ${table ?? '<unknown>'} outside the mutation registry tables (SPEC §10.3/§11.2).`,
  );
}

const assertSqliteDeclaredWriteStatementAllowed = securityClassifier(
  'server.managed-db.sqlite-declared-write-authorizer',
  function (
    statement: unknown,
    params: readonly unknown[],
    policy: ManagedSqlWritePolicy,
    options: DeclaredWriteDbOptions,
    allowed: readonly string[],
  ): void {
    const carrier = sqlCarrierFromValue(statement, params);
    const authorizer = options.sqliteAuthorizer;
    if (carrier === undefined || authorizer === undefined) {
      throw new Error(
        'KV406: SQLite declared-write authorizer could not resolve executable SQL text (SPEC §10.3/§11.2).',
      );
    }
    assertSqliteWriteAuthorizerConstants(authorizer.constants);
    const sqlite = authorizer.openDatabase();
    const setAuthorizer = inheritedFunctionDataProperty(sqlite, 'setAuthorizer');
    const prepare = inheritedFunctionDataProperty(sqlite, 'prepare');
    const close = inheritedFunctionDataProperty(sqlite, 'close');
    try {
      const authorize: SqliteAuthorizer = (action, object, _column, database, trigger) => {
        if (isSqliteDdlAction(action, authorizer.constants))
          return authorizer.constants.SQLITE_DENY;
        if (!isSqliteWriteAction(action, authorizer.constants))
          return authorizer.constants.SQLITE_OK;
        const table = options.normalizeTableName(`${database ?? 'main'}.${object ?? '<unknown>'}`);
        if (stringListHas(allowed, table)) return authorizer.constants.SQLITE_OK;
        if (trigger === null && (object === 'sqlite_sequence' || object === 'sqlite_stat1')) {
          return authorizer.constants.SQLITE_OK;
        }
        return authorizer.constants.SQLITE_DENY;
      };
      witnessReflectApply(setAuthorizer, sqlite, [authorize]);
      witnessReflectApply(prepare, sqlite, [carrier.text]);
    } catch (error) {
      if (isSqliteAuthorizationError(error)) throw sqliteDeclaredWriteDenial(policy);
      throw error;
    } finally {
      witnessReflectApply(close, sqlite, []);
    }
  },
);

function sqliteDeclaredWriteDenial(policy: ManagedSqlWritePolicy): Error {
  return new Error(
    [
      'KV406: SQLite authorizer rejected a declared-write statement outside the mutation registry tables (SPEC §10.3/§11.2).',
      `  declared tables: ${[...new Set(policy.tables ?? [])].sort().join(', ') || '<none>'}`,
      `  touches: ${[...new Set(policy.touches ?? [])].sort().join(', ') || '<none>'}`,
    ].join('\n'),
  );
}

function isSqliteAuthorizationError(error: unknown): boolean {
  return (
    error instanceof Error && intrinsicStringIncludes(asciiLower(error.message), 'not authorized')
  );
}

/**
 * The compile-time mirror of the runtime read-only proxy (SPEC §9.4 KV433). Framework-owned read
 * surfaces receive `Reader<Db>` so a `db.insert(...)` is a `tsc` error in addition to the runtime
 * throw and the static gate. The private-symbol brand makes a raw provider handle awkward to pass
 * where a framework-threaded read capability is expected.
 *
 * This is ergonomics and defense-in-depth only (SPEC §6.6): the runtime proxy is the fail-closed
 * floor, and the static KV433 provenance gate remains the by-construction proof. Casts/`any` can
 * defeat this type and must never be accepted as security evidence.
 */
export type Reader<Db> = (Db extends object
  ? Pick<Db, Extract<keyof Db, '$count' | '$with' | 'select' | 'selectDistinct'>> &
      (Db extends { query: infer Query }
        ? Query extends (...args: any[]) => any
          ? {}
          : { query: Query }
        : {}) & {
        crossOwnerRead<Row = unknown>(
          statement: unknown,
          declaration: CrossOwnerReadDeclaration,
        ): Promise<Row[]> | Row[];
        rawRead<Row = unknown>(
          statement: unknown,
          declaration: RawReadDeclaration,
        ): Promise<Row[]> | Row[];
      } & (Db extends { with: (...args: infer Args) => infer Result }
        ? {
            with(
              ...args: Args
            ): Result extends object
              ? Pick<
                  Result,
                  Extract<keyof Result, '$count' | '$with' | 'query' | 'select' | 'selectDistinct'>
                >
              : Result;
          }
        : {})
  : Db) & {
  readonly [readerDbBrand]: {
    readonly db: Db;
    readonly scope: 'framework-read-handle';
  };
};

/**
 * The compile-time mirror of a framework-threaded write handle (SPEC §10.3/§11.2, DEC-E).
 * Unlike {@link Reader}, this keeps the underlying DB surface intact, but adds a private-symbol
 * witness so APIs that require a managed write capability cannot be satisfied by a raw provider
 * handle by accident. Runtime SQL/read-write enforcement still belongs to {@link managedDb} and
 * {@link wrapManagedDbForSqlSafety}; this type is an author-time guardrail only.
 */
export type Writer<Db> = Db & {
  readonly [writerDbBrand]: {
    readonly db: Db;
    readonly scope: 'framework-write-handle';
  };
};

interface SqlCarrier {
  params: readonly unknown[];
  text: string;
}

const DRIZZLE_NAME_SYMBOL = Symbol.for('drizzle:Name');
const DRIZZLE_SCHEMA_SYMBOL = Symbol.for('drizzle:Schema');
const DRIZZLE_IS_TABLE_SYMBOL = Symbol.for('drizzle:IsDrizzleTable');

const publicReadAuditFacts = createBoundedRuntimeAuditCollector<PublicReadAuditFact>();
const crossOwnerReadAuditFacts = createBoundedRuntimeAuditCollector<CrossOwnerReadAuditFact>();
const postgresRlsSilentDenyDiagnostics =
  createBoundedRuntimeAuditCollector<PostgresRlsSilentDenyDiagnostic>();
const authorizationCensusFrameworkHooks = createWitnessWeakMap<
  object,
  Readonly<{
    declaredWrite?: ((policy: ManagedSqlWritePolicy) => unknown) | undefined;
    readonly?: (() => unknown) | undefined;
  }>
>();
const frameworkReadonlyCapabilityHandles = createWitnessWeakSet<object>();

/**
 * Declare an audited public-read authorization scope (SPEC §10.3 DEC-F). This does not assert SQL
 * injection safety (`trustedSql`) or secret disclosure authority (`reveal`); it only records the
 * intentional row/column authorization posture for a read.
 */
export function declarePublicRead(options: PublicReadDeclaration): PublicReadDeclaration {
  return normalizedPublicReadDeclaration(options);
}

/**
 * Drain recorded public-read authorization audit facts for runtime diagnostics/tests. Returns and
 * clears the newest 256 observations; static declaration call sites remain authoritative.
 */
export function drainPublicReadAuditFacts(): PublicReadAuditFact[] {
  return publicReadAuditFacts.drain();
}

/**
 * Drain recorded cross-owner read audit facts for runtime diagnostics/tests. Returns and clears the
 * newest 256 observations; static declaration call sites remain authoritative.
 */
export function drainCrossOwnerReadAuditFacts(): CrossOwnerReadAuditFact[] {
  return crossOwnerReadAuditFacts.drain();
}

/**
 * Drain dev-only Postgres RLS empty-read diagnostics. Returns and clears the newest 256 observations
 * since the last drain; production scoped clients never write to this sink.
 */
export function drainPostgresRlsSilentDenyDiagnostics(): PostgresRlsSilentDenyDiagnostic[] {
  return postgresRlsSilentDenyDiagnostics.drain();
}

function isDeclaredWriteDrizzleMethod(prop: PropertyKey): prop is 'delete' | 'insert' | 'update' {
  return prop === 'delete' || prop === 'insert' || prop === 'update';
}

function authorizationCensusProxy(
  value: unknown,
  options: AuthorizationCensusDbOptions,
  builderMode: 'select' | undefined,
): unknown {
  if (!isRecord(value)) return value;
  return createFrameworkManagedSqlDispatchProxy(value, {
    defineProperty() {
      return false;
    },
    deleteProperty() {
      return false;
    },
    get(target, prop) {
      const item = authorizationCensusDataPropertyValue(target, prop);
      if (prop === 'query' && isRecord(item)) {
        return authorizationCensusRelationalNamespace(item, options);
      }
      if (typeof item !== 'function') return item;
      if (isDeclaredWriteDrizzleMethod(prop)) {
        return (table: unknown, ...args: unknown[]) => {
          assertAuthorizationCensusTablesAllowed(options.tableNames(table), options);
          return authorizationCensusProxy(
            witnessReflectApply(item, target, prependManagedArgument(table, args)),
            options,
            undefined,
          );
        };
      }
      if (prop === 'select' || prop === 'selectDistinct') {
        return (...args: unknown[]) =>
          authorizationCensusProxy(witnessReflectApply(item, target, args), options, 'select');
      }
      if (builderMode === 'select' && isAuthorizationCensusReadTableMethod(prop)) {
        return (table: unknown, ...args: unknown[]) => {
          assertAuthorizationCensusTablesAllowed(options.tableNames(table), options);
          return authorizationCensusProxy(
            witnessReflectApply(item, target, prependManagedArgument(table, args)),
            options,
            builderMode,
          );
        };
      }
      return (...args: unknown[]) =>
        authorizationCensusProxy(witnessReflectApply(item, target, args), options, builderMode);
    },
    getOwnPropertyDescriptor(target, prop) {
      return authorizationCensusProxyDescriptor(target, prop);
    },
    getPrototypeOf() {
      return null;
    },
    ownKeys(target) {
      return authorizationCensusProxyOwnKeys(target);
    },
    preventExtensions() {
      return false;
    },
    set() {
      return false;
    },
    setPrototypeOf() {
      return false;
    },
  });
}

function authorizationCensusRelationalNamespace(
  namespace: Record<PropertyKey, unknown>,
  options: AuthorizationCensusDbOptions,
): object {
  return createFrameworkManagedSqlDispatchProxy(namespace, {
    defineProperty() {
      return false;
    },
    deleteProperty() {
      return false;
    },
    get(target, prop) {
      const builder = authorizationCensusDataPropertyValue(target, prop);
      if (!isRecord(builder)) return builder;
      const table = optionalOwnDataProperty(builder, 'table');
      const names =
        table === undefined ? (typeof prop === 'string' ? [prop] : []) : options.tableNames(table);
      if (names.length === 0) {
        throw new Error(
          'KV414: relational query table identity is not available to the authorization census (SPEC §10.3 DEC-K).',
        );
      }
      assertAuthorizationCensusTablesAllowed(names, options);
      return authorizationCensusRelationalBuilder(builder, options);
    },
    getOwnPropertyDescriptor(target, prop) {
      return authorizationCensusProxyDescriptor(target, prop);
    },
    getPrototypeOf() {
      return null;
    },
    ownKeys(target) {
      return authorizationCensusProxyOwnKeys(target);
    },
    preventExtensions() {
      return false;
    },
    set() {
      return false;
    },
    setPrototypeOf() {
      return false;
    },
  });
}

function authorizationCensusRelationalBuilder(
  builder: Record<PropertyKey, unknown>,
  options: AuthorizationCensusDbOptions,
): object {
  return createFrameworkManagedSqlDispatchProxy(builder, {
    defineProperty() {
      return false;
    },
    deleteProperty() {
      return false;
    },
    get(target, prop) {
      const item = authorizationCensusDataPropertyValue(target, prop);
      if ((prop !== 'findMany' && prop !== 'findFirst') || typeof item !== 'function') return item;
      return (...args: unknown[]) => {
        if (args.length > 1) {
          throw new TypeError('Relational query methods accept at most one config object.');
        }
        const config =
          args.length === 0 ? undefined : snapshotAuthorizationRelationalValue(args[0], 0);
        assertAuthorizationRelationalConfigAllowed(builder, config, options, 0);
        return witnessReflectApply(item, target, config === undefined ? [] : [config]);
      };
    },
    getOwnPropertyDescriptor(target, prop) {
      return authorizationCensusProxyDescriptor(target, prop);
    },
    getPrototypeOf() {
      return null;
    },
    ownKeys(target) {
      return authorizationCensusProxyOwnKeys(target);
    },
    preventExtensions() {
      return false;
    },
    set() {
      return false;
    },
    setPrototypeOf() {
      return false;
    },
  });
}

function authorizationCensusProxyDescriptor(
  target: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  const descriptor = witnessGetOwnPropertyDescriptor(target, property);
  if (descriptor === undefined || !authorizationDescriptorCarriesCapability(descriptor)) {
    return descriptor;
  }
  if (descriptor.configurable === false) {
    throw new Error(
      `KV414: authorization census cannot reflect non-configurable authority property ${String(property)} (SPEC §6.6/§10.3 DEC-K).`,
    );
  }
  return undefined;
}

function authorizationCensusProxyOwnKeys(target: object): (string | symbol)[] {
  const keys = witnessOwnKeys(target);
  const visible: (string | symbol)[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = witnessGetOwnPropertyDescriptor(keys, index);
    if (key === undefined || !('value' in key)) {
      throw new TypeError('Authorization census reflection keys must remain dense.');
    }
    const descriptor = witnessGetOwnPropertyDescriptor(target, key.value);
    if (
      descriptor !== undefined &&
      descriptor.configurable !== false &&
      authorizationDescriptorCarriesCapability(descriptor)
    ) {
      continue;
    }
    witnessDefineProperty(visible, visible.length, {
      configurable: true,
      enumerable: true,
      value: key.value,
      writable: true,
    });
  }
  return visible;
}

function authorizationDescriptorCarriesCapability(descriptor: PropertyDescriptor): boolean {
  return (
    !('value' in descriptor) ||
    (descriptor.value !== null &&
      (typeof descriptor.value === 'object' || typeof descriptor.value === 'function'))
  );
}

function authorizationCensusDataPropertyValue(target: object, property: PropertyKey): unknown {
  if (isFrameworkManagedSqlDispatchProxy(target)) {
    return frameworkManagedSqlDispatchPropertyValue(target, property);
  }
  let owner: object | null = target;
  for (let depth = 0; owner !== null && depth < 64; depth += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) {
      if (!('value' in descriptor)) {
        throw new Error(
          `KV414: authorization census property ${String(property)} is accessor-backed and cannot be evaluated across the database authority boundary (SPEC §6.6/§10.3 DEC-K).`,
        );
      }
      return descriptor.value;
    }
    owner = witnessGetPrototypeOf(owner);
  }
  if (owner !== null) {
    throw new Error(
      'KV414: authorization census prototype chain exceeds the bounded authority limit.',
    );
  }
  return undefined;
}

function assertAuthorizationRelationalConfigAllowed(
  builder: Record<PropertyKey, unknown>,
  config: unknown,
  options: AuthorizationCensusDbOptions,
  depth: number,
): void {
  if (!isRecord(config)) return;
  if (depth > 32) throw new TypeError('Relational authorization config is too deeply nested.');
  const withValue = optionalOwnDataProperty(config, 'with');
  if (withValue === undefined) return;
  if (!isRecord(withValue)) {
    throw new TypeError('Relational authorization `with` selections must be own-data records.');
  }
  const tableConfig = optionalOwnDataProperty(builder, 'tableConfig');
  const relations = isRecord(tableConfig)
    ? optionalOwnDataProperty(tableConfig, 'relations')
    : undefined;
  if (!isRecord(relations)) {
    throw new Error(
      'KV414: relational authorization metadata is unavailable for a nested selection (SPEC §10.3 DEC-K).',
    );
  }
  const relationKeys = witnessOwnKeys(withValue);
  for (let index = 0; index < relationKeys.length; index += 1) {
    const keyDescriptor = witnessGetOwnPropertyDescriptor(relationKeys, index);
    if (keyDescriptor === undefined || !('value' in keyDescriptor)) {
      throw new TypeError('Relational authorization selection keys must remain dense.');
    }
    const selection = witnessGetOwnPropertyDescriptor(withValue, keyDescriptor.value);
    if (selection === undefined || !('value' in selection)) {
      throw new TypeError('Relational authorization selections must use own data properties.');
    }
    if (selection.value === false || selection.value === undefined) continue;
    const relationDescriptor = witnessGetOwnPropertyDescriptor(relations, keyDescriptor.value);
    if (relationDescriptor === undefined || !('value' in relationDescriptor)) {
      throw new Error(
        `KV414: relational authorization metadata is missing for ${String(keyDescriptor.value)} (SPEC §10.3 DEC-K).`,
      );
    }
    const relation = relationDescriptor.value;
    const targetTable = isRecord(relation)
      ? optionalOwnDataProperty(relation, 'targetTable')
      : undefined;
    if (targetTable === undefined) {
      throw new Error(
        `KV414: relational authorization target is missing for ${String(keyDescriptor.value)} (SPEC §10.3 DEC-K).`,
      );
    }
    const targetNames = options.tableNames(targetTable);
    if (targetNames.length === 0) {
      throw new Error(
        `KV414: relational authorization target name is missing for ${String(keyDescriptor.value)} (SPEC §10.3 DEC-K).`,
      );
    }
    assertAuthorizationCensusTablesAllowed(targetNames, options);
    if (isRecord(selection.value)) {
      const schema = optionalOwnDataProperty(builder, 'schema');
      const nestedBuilder = authorizationRelationalBuilderForTable(schema, targetTable);
      if (nestedBuilder === undefined) {
        throw new Error(
          `KV414: relational authorization schema is missing for ${String(keyDescriptor.value)} (SPEC §10.3 DEC-K).`,
        );
      }
      assertAuthorizationRelationalConfigAllowed(
        nestedBuilder,
        selection.value,
        options,
        depth + 1,
      );
    }
  }
}

function authorizationRelationalBuilderForTable(
  schema: unknown,
  table: unknown,
): Record<PropertyKey, unknown> | undefined {
  if (!isRecord(schema)) return undefined;
  const keys = witnessOwnKeys(schema);
  for (let index = 0; index < keys.length; index += 1) {
    const key = witnessGetOwnPropertyDescriptor(keys, index);
    if (key === undefined || !('value' in key)) continue;
    const entry = witnessGetOwnPropertyDescriptor(schema, key.value);
    if (entry === undefined || !('value' in entry) || !isRecord(entry.value)) continue;
    if (optionalOwnDataProperty(entry.value, 'table') === table) {
      const builder = witnessCreateNullRecord<unknown>();
      witnessDefineProperty(builder, 'schema', { value: schema });
      witnessDefineProperty(builder, 'tableConfig', { value: entry.value });
      return builder;
    }
  }
  return undefined;
}

function snapshotAuthorizationRelationalValue(value: unknown, depth: number): unknown {
  if (depth > 64) throw new TypeError('Relational query config is too deeply nested.');
  if (witnessIsArray(value)) {
    const clone: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(value, index);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new TypeError('Relational query config arrays must be dense own data.');
      }
      witnessDefineProperty(clone, index, {
        configurable: true,
        enumerable: true,
        value: snapshotAuthorizationRelationalValue(descriptor.value, depth + 1),
        writable: true,
      });
    }
    return witnessFreeze(clone);
  }
  if (!isRecord(value)) return value;
  const prototype = witnessGetPrototypeOf(value);
  const objectPrototype = witnessGetPrototypeOf({});
  if (prototype !== null && prototype !== objectPrototype) return value;
  const clone = witnessCreateNullRecord<unknown>();
  const keys = witnessOwnKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = witnessGetOwnPropertyDescriptor(keys, index);
    if (key === undefined || !('value' in key)) {
      throw new TypeError('Relational query config keys must remain dense.');
    }
    const descriptor = witnessGetOwnPropertyDescriptor(value, key.value);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Relational query configs cannot contain accessors.');
    }
    witnessDefineProperty(clone, key.value, {
      configurable: true,
      enumerable: descriptor.enumerable ?? false,
      value: snapshotAuthorizationRelationalValue(descriptor.value, depth + 1),
      writable: true,
    });
  }
  return witnessFreeze(clone);
}

function isAuthorizationCensusReadTableMethod(prop: PropertyKey): boolean {
  return (
    prop === 'from' ||
    prop === 'innerJoin' ||
    prop === 'leftJoin' ||
    prop === 'rightJoin' ||
    prop === 'fullJoin' ||
    prop === 'crossJoin' ||
    prop === 'leftJoinLateral' ||
    prop === 'innerJoinLateral' ||
    prop === 'crossJoinLateral'
  );
}

function assertAuthorizationCensusTablesAllowed(
  tableNames: readonly string[],
  options: AuthorizationCensusDbOptions,
): void {
  for (let tableIndex = 0; tableIndex < tableNames.length; tableIndex += 1) {
    const tableName = tableNames[tableIndex]!;
    const normalizedNames = authorizationCensusLookupNames(tableName, options);
    const schemaNames: string[] = [];
    if (options.metadata.schemaTableNames !== undefined) {
      witnessSetForEach(options.metadata.schemaTableNames as Set<string>, (name) => {
        if (!stringListHas(schemaNames, name)) appendManagedValue(schemaNames, name);
      });
    }
    let inSchema = false;
    for (let index = 0; index < normalizedNames.length; index += 1) {
      if (stringListHas(schemaNames, normalizedNames[index]!)) inSchema = true;
    }
    if (!inSchema) continue;
    const classifications: SqliteAuthorizationClassification[] = [];
    const classificationMap = options.metadata.authorizationClassificationsByTable;
    for (let index = 0; index < normalizedNames.length; index += 1) {
      const values =
        classificationMap === undefined
          ? undefined
          : witnessMapGet(
              classificationMap as Map<string, readonly SqliteAuthorizationClassification[]>,
              normalizedNames[index]!,
            );
      if (values === undefined) continue;
      for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
        appendManagedValue(classifications, values[valueIndex]!);
      }
    }
    if (classifications.length === 1) continue;
    const reason =
      classifications.length === 0
        ? 'has no authorization classification'
        : `has multiple authorization classifications (${[...new Set(classifications)].join(', ')})`;
    throw new Error(
      `KV414: ${options.dialectLabel} managed authorization census denied table ${tableName}: ${reason} (SPEC §10.3).`,
    );
  }
}

function authorizationCensusLookupNames(
  tableName: string,
  options: AuthorizationCensusDbOptions,
): string[] {
  const normalized = options.normalizeTableName(tableName);
  let unqualified = '';
  for (let index = 0; index < tableName.length; index += 1) {
    unqualified = tableName[index] === '.' ? '' : `${unqualified}${tableName[index]}`;
  }
  const normalizedUnqualified = options.normalizeTableName(unqualified);
  const names: string[] = [];
  const append = (name: string) => {
    if (name !== '' && !stringListHas(names, name)) appendManagedValue(names, name);
  };
  append(tableName);
  append(normalized);
  append(unqualified);
  append(normalizedUnqualified);
  return names;
}

function declaredWriteBuilder(
  builder: unknown,
  verb: 'insert' | 'update',
  tableNames: readonly string[],
  options: DeclaredWriteDbOptions,
): unknown {
  if (!isRecord(builder)) return builder;
  return createFrameworkManagedSqlDispatchProxy(builder, {
    get(target, prop) {
      const value = authorizationCensusDataPropertyValue(target, prop);
      if (typeof value !== 'function') return value;
      if (prop === 'values') {
        return (payload: unknown, ...args: unknown[]) => {
          assertGovernedWritePayloadAllowed(payload, {
            boundary: 'values',
            options,
            tableNames,
            verb,
          });
          return wrapDeclaredWriteBuilderResult(
            witnessReflectApply(value, target, prependManagedArgument(payload, args)),
            verb,
            tableNames,
            options,
          );
        };
      }
      if (prop === 'set') {
        return (payload: unknown, ...args: unknown[]) => {
          assertGovernedWritePayloadAllowed(payload, {
            boundary: 'set',
            options,
            tableNames,
            verb,
          });
          return wrapDeclaredWriteBuilderResult(
            witnessReflectApply(value, target, prependManagedArgument(payload, args)),
            verb,
            tableNames,
            options,
          );
        };
      }
      if (prop === 'onConflictDoUpdate') {
        return (config: unknown, ...args: unknown[]) => {
          if (isRecord(config)) {
            assertGovernedWritePayloadAllowed(config.set, {
              boundary: 'onConflictDoUpdate.set',
              options,
              tableNames,
              verb,
            });
          }
          return wrapDeclaredWriteBuilderResult(
            witnessReflectApply(value, target, prependManagedArgument(config, args)),
            verb,
            tableNames,
            options,
          );
        };
      }
      if (prop === 'select' && verb === 'insert') {
        return (selection: unknown, ...args: unknown[]) => {
          assertGovernedInsertSelectAllowed(tableNames, options);
          return wrapDeclaredWriteBuilderResult(
            witnessReflectApply(value, target, prependManagedArgument(selection, args)),
            verb,
            tableNames,
            options,
          );
        };
      }
      return (...args: unknown[]) =>
        wrapDeclaredWriteBuilderResult(
          witnessReflectApply(value, target, args),
          verb,
          tableNames,
          options,
        );
    },
  });
}

function wrapDeclaredWriteBuilderResult(
  result: unknown,
  verb: 'insert' | 'update',
  tableNames: readonly string[],
  options: DeclaredWriteDbOptions,
): unknown {
  if (!isRecord(result) || !hasDeclaredWriteBuilderMethod(result)) return result;
  return declaredWriteBuilder(result, verb, tableNames, options);
}

function hasDeclaredWriteBuilderMethod(result: Record<PropertyKey, unknown>): boolean {
  return (
    typeof authorizationCensusDataPropertyValue(result, 'values') === 'function' ||
    typeof authorizationCensusDataPropertyValue(result, 'set') === 'function' ||
    typeof authorizationCensusDataPropertyValue(result, 'onConflictDoUpdate') === 'function' ||
    typeof authorizationCensusDataPropertyValue(result, 'select') === 'function'
  );
}

function assertGovernedInsertSelectAllowed(
  tableNames: readonly string[],
  options: DeclaredWriteDbOptions,
): void {
  if (governedWriteColumnsForTables(tableNames, options).length === 0) return;
  throw new Error(
    [
      `KV438: ${options.dialectLabel} managed write rejected insert.select for a governed table because selected-column provenance cannot be proven at runtime (SPEC §11.1).`,
      '  Use insert.values(...) with server-derived governed values or an audited trustedAssign(...) assignment.',
    ].join('\n'),
  );
}

interface GovernedWritePayloadContext {
  boundary: string;
  options: DeclaredWriteDbOptions;
  tableNames: readonly string[];
  verb: 'insert' | 'update';
}

function assertGovernedWritePayloadAllowed(
  payload: unknown,
  context: GovernedWritePayloadContext,
): void {
  const governed = governedWriteColumnsForTables(context.tableNames, context.options);
  if (governed.length === 0) return;
  if (witnessIsArray(payload)) {
    for (let index = 0; index < payload.length; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(payload, index);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new Error('KV438: governed write payload arrays must be dense own data properties.');
      }
      assertGovernedWriteObjectAllowed(descriptor.value, governed, context);
    }
    return;
  }
  assertGovernedWriteObjectAllowed(payload, governed, context);
}

function assertGovernedWriteObjectAllowed(
  payload: unknown,
  governed: readonly string[],
  context: GovernedWritePayloadContext,
): void {
  if (!isRecord(payload)) return;
  const keys = witnessOwnKeys(payload);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (typeof key !== 'string' || !stringListHas(governed, key)) continue;
    const descriptor = witnessGetOwnPropertyDescriptor(payload, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new Error('KV438: governed write values must be own data properties.');
    }
    const value = descriptor.value;
    const provenance = requestInputProvenanceForValue(value);
    if (provenance === undefined) continue;
    throw new Error(
      [
        `KV438: ${context.options.dialectLabel} managed write rejected parsed request input ${provenance.path} for governed column ${key} in ${context.verb}.${context.boundary} (SPEC §11.1).`,
        '  Use a server-derived value or the audited trustedAssign(...) escape for intentional privileged assignment.',
      ].join('\n'),
    );
  }
}

function governedWriteColumnsForTables(
  tableNames: readonly string[],
  options: DeclaredWriteDbOptions,
): readonly string[] {
  const metadata = options.governedColumns;
  if (metadata === undefined) return [];
  const normalizedTargets = normalizedStringArray(
    tableNames,
    options.normalizeTableName,
    'governed write target tables',
  );
  const governed: string[] = [];
  const collect = (table: string, columns: ReadonlySet<string>): void => {
    if (!stringListHas(normalizedTargets, options.normalizeTableName(table))) return;
    witnessSetForEach(columns as Set<string>, (column) => {
      if (!stringListHas(governed, column)) appendManagedValue(governed, column);
    });
  };
  witnessMapForEach(
    metadata.governedColumnKeysByTable as Map<string, ReadonlySet<string>>,
    (columns, table) => collect(table, columns),
  );
  witnessMapForEach(
    metadata.governedColumnNamesByTable as Map<string, ReadonlySet<string>>,
    (columns, table) => collect(table, columns),
  );
  return witnessFreeze(governed);
}

function isDeclaredWriteDirectSqlMethod(
  prop: PropertyKey,
  options: DeclaredWriteDbOptions,
): boolean {
  return (
    options.sqliteAuthorizer !== undefined &&
    (prop === 'all' || prop === 'execute' || prop === 'get' || prop === 'run' || prop === 'values')
  );
}

function sqlCarrierFromValue(value: unknown, params: readonly unknown[]): SqlCarrier | undefined {
  if (typeof value === 'string') return { params, text: value };
  const snapshot = snapshotManagedSqlStatement(value);
  if (snapshot.ok) {
    return {
      params: snapshot.statement.values,
      text: snapshot.statement.text,
    };
  }
  if (snapshot.message !== undefined) throw new Error(snapshot.message);
  const toSQL =
    typeof value === 'object' && value !== null
      ? optionalInheritedFunctionDataProperty(value, 'toSQL')
      : undefined;
  if (typeof toSQL === 'function') {
    try {
      const result = witnessReflectApply<unknown>(toSQL, value, []);
      if (isRecord(result)) {
        const sql = optionalOwnDataProperty(result, 'sql');
        const resultParams = optionalOwnDataProperty(result, 'params');
        if (typeof sql === 'string') {
          return {
            params: witnessIsArray(resultParams) ? snapshotUnknownArray(resultParams) : params,
            text: sql,
          };
        }
      }
    } catch {
      return undefined;
    }
  }
  const text = sqlTextFromValue(value);
  return text === undefined ? undefined : { params, text };
}

function sqlTextFromValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return undefined;
  const sql = optionalStrictInheritedDataProperty(value, 'sql');
  if (typeof sql === 'string') return sql;
  const chunks = optionalStrictInheritedDataProperty(value, 'queryChunks');
  if (!witnessIsArray(chunks)) return undefined;
  const text = sqlTextFromChunks(chunks);
  return text || undefined;
}

function sqlTextFromChunks(chunks: readonly unknown[]): string {
  let text = '';
  for (let index = 0; index < chunks.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(chunks, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('SQL chunks must be dense own data properties.');
    }
    text += sqlTextFromChunk(descriptor.value);
  }
  return text;
}

function sqlTextFromChunk(chunk: unknown): string {
  if (chunk === undefined) return '';
  if (typeof chunk === 'string') return chunk;
  if (witnessIsArray(chunk)) {
    let text = '(';
    for (let index = 0; index < chunk.length; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(chunk, index);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new TypeError('nested SQL chunks must be dense own data properties.');
      }
      if (index > 0) text += ', ';
      text += sqlTextFromChunk(descriptor.value);
    }
    return `${text})`;
  }
  if (!isRecord(chunk)) return '';

  const stringChunkValue = optionalStrictInheritedDataProperty(chunk, 'value');
  if (witnessIsArray(stringChunkValue)) {
    let text = '';
    for (let index = 0; index < stringChunkValue.length; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(stringChunkValue, index);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new TypeError('SQL string chunks must be dense own data properties.');
      }
      if (typeof descriptor.value === 'string') text += descriptor.value;
    }
    return text;
  }
  if (typeof stringChunkValue === 'string') return quoteSqlIdentifier(stringChunkValue);

  const table = drizzleTableIdentifier(chunk);
  if (table !== undefined) return table;

  const nestedChunks = optionalStrictInheritedDataProperty(chunk, 'queryChunks');
  if (witnessIsArray(nestedChunks)) return sqlTextFromChunks(nestedChunks);

  const columnName = optionalStrictInheritedDataProperty(chunk, 'name');
  if (typeof columnName !== 'string') return '';
  const tableName = drizzleTableIdentifier(optionalStrictInheritedDataProperty(chunk, 'table'));
  return tableName === undefined
    ? quoteSqlIdentifier(columnName)
    : `${tableName}.${quoteSqlIdentifier(columnName)}`;
}

function drizzleTableIdentifier(value: unknown): string | undefined {
  if (
    !isRecord(value) ||
    optionalStrictInheritedDataProperty(value, DRIZZLE_IS_TABLE_SYMBOL) !== true
  )
    return undefined;
  const name = optionalStrictInheritedDataProperty(value, DRIZZLE_NAME_SYMBOL);
  if (typeof name !== 'string' || name === '') return undefined;
  const schema = optionalStrictInheritedDataProperty(value, DRIZZLE_SCHEMA_SYMBOL);
  return typeof schema === 'string' && schema !== ''
    ? `${quoteSqlIdentifier(schema)}.${quoteSqlIdentifier(name)}`
    : quoteSqlIdentifier(name);
}

function isSqliteWriteAction(
  action: number,
  constants: DeclaredWriteSqliteAuthorizerConstants,
): boolean {
  return (
    action === constants.SQLITE_DELETE ||
    action === constants.SQLITE_INSERT ||
    action === constants.SQLITE_UPDATE
  );
}

function isSqliteDdlAction(
  action: number,
  constants: DeclaredWriteSqliteAuthorizerConstants,
): boolean {
  return (
    action === constants.SQLITE_ALTER_TABLE ||
    action === constants.SQLITE_ATTACH ||
    action === constants.SQLITE_CREATE_INDEX ||
    action === constants.SQLITE_CREATE_TABLE ||
    action === constants.SQLITE_CREATE_TEMP_INDEX ||
    action === constants.SQLITE_CREATE_TEMP_TABLE ||
    action === constants.SQLITE_CREATE_TEMP_TRIGGER ||
    action === constants.SQLITE_CREATE_TEMP_VIEW ||
    action === constants.SQLITE_CREATE_TRIGGER ||
    action === constants.SQLITE_CREATE_VIEW ||
    action === constants.SQLITE_CREATE_VTABLE ||
    action === constants.SQLITE_DETACH ||
    action === constants.SQLITE_DROP_INDEX ||
    action === constants.SQLITE_DROP_TABLE ||
    action === constants.SQLITE_DROP_TEMP_INDEX ||
    action === constants.SQLITE_DROP_TEMP_TABLE ||
    action === constants.SQLITE_DROP_TEMP_TRIGGER ||
    action === constants.SQLITE_DROP_TEMP_VIEW ||
    action === constants.SQLITE_DROP_TRIGGER ||
    action === constants.SQLITE_DROP_VIEW ||
    action === constants.SQLITE_DROP_VTABLE ||
    action === constants.SQLITE_PRAGMA ||
    action === constants.SQLITE_REINDEX
  );
}

type PostgresTransactionClient = {
  exec(statement: string, options?: unknown): unknown;
  query(query: unknown, params?: unknown[], queryOptions?: unknown): unknown;
  transaction<Result>(
    callback: (tx: PostgresTransactionClient) => Promise<Result>,
  ): Promise<Result>;
};

function isPostgresTransactionClient(value: unknown): value is PostgresTransactionClient {
  if (!isRecord(value)) return false;
  try {
    return (
      optionalStrictInheritedFunctionDataProperty(value, 'exec') !== undefined &&
      optionalStrictInheritedFunctionDataProperty(value, 'query') !== undefined
    );
  } catch {
    return false;
  }
}

function scopedPostgresTransaction(
  target: Record<PropertyKey, unknown>,
  transactionMethod: Function | undefined,
  options: PostgresScopedClientOptions,
  callback: unknown,
  args: readonly unknown[],
): unknown {
  if (transactionMethod === undefined) {
    throw new KovoReadonlyHandleError(
      'KV433: Postgres scoped transaction nesting requires a transaction-capable driver handle (SPEC §10.3).',
    );
  }
  if (typeof callback !== 'function') {
    throw new KovoReadonlyHandleError(
      'KV414: Postgres scoped transactions require a callback so the framework can establish the request role frame (SPEC §10.3).',
    );
  }
  const scopedCallback = (tx: unknown): unknown => {
    if (!isPostgresTransactionClient(tx)) {
      throw new KovoReadonlyHandleError(
        'KV433: Postgres transaction callback did not receive a framework-scopeable query/exec client (SPEC §10.3).',
      );
    }
    return runScopedPostgresTransactionCallback(tx, options, callback);
  };
  return witnessReflectApply(
    transactionMethod,
    target,
    prependManagedArgument(scopedCallback, args),
  );
}

async function runScopedPostgresTransactionCallback<Result>(
  tx: PostgresTransactionClient,
  options: PostgresScopedClientOptions,
  callback: Function,
): Promise<Result> {
  const controls = pinPostgresTransactionControls(tx);
  await runPostgresTransactionControl(tx, controls, options);
  return witnessReflectApply(callback, undefined, [
    scopedPostgresTransactionClient(tx, controls, options),
  ]) as Result;
}

function scopedPostgresTransactionClient(
  tx: PostgresTransactionClient,
  controls: PostgresTransactionControls,
  options: PostgresScopedClientOptions,
): PostgresTransactionClient {
  const target = tx as Record<PropertyKey, unknown>;
  const facade = witnessCreateNullRecord<unknown>();
  witnessDefineProperty(facade, 'query', {
    enumerable: true,
    value(query: unknown, params?: unknown[], queryOptions?: unknown) {
      const snapshot = postgresQuerySnapshot(query, params);
      assertAppPostgresTextAllowed(snapshot.text);
      return witnessReflectApply(
        controls.query,
        target,
        postgresQueryExecutionArgs(snapshot, queryOptions),
      );
    },
  });
  witnessDefineProperty(facade, 'exec', {
    enumerable: true,
    value(query: string) {
      return scopedPostgresExec(options, query);
    },
  });
  witnessDefineProperty(facade, 'transaction', {
    enumerable: true,
    value<Result>(callback: (nested: unknown) => Promise<Result> | Result, ...args: unknown[]) {
      return scopedPostgresTransaction(target, controls.transaction, options, callback, args);
    },
  });
  defineBlockedPostgresProperties(facade, POSTGRES_BLOCKED_TRANSACTION_PROPERTIES);
  return witnessFreeze(facade) as unknown as PostgresTransactionClient;
}

function scopedPostgresQuery(
  client: Record<PropertyKey, unknown>,
  transactionMethod: Function,
  options: PostgresScopedClientOptions,
  query: unknown,
  params?: unknown[],
  queryOptions?: unknown,
): Promise<unknown> {
  const snapshot = postgresQuerySnapshot(query, params);
  assertAppPostgresTextAllowed(snapshot.text);
  return executeScopedPostgresQuery(client, transactionMethod, options, snapshot, queryOptions);
}

async function executeScopedPostgresQuery(
  client: Record<PropertyKey, unknown>,
  transactionMethod: Function,
  options: PostgresScopedClientOptions,
  snapshot: PostgresQuerySnapshot,
  queryOptions: unknown,
): Promise<unknown> {
  const result = await postgresTransaction(client, transactionMethod, async (tx) => {
    const controls = pinPostgresTransactionControls(tx);
    await runPostgresTransactionControl(tx, controls, options);
    try {
      return await witnessReflectApply<Promise<unknown>>(
        controls.query,
        tx,
        postgresQueryExecutionArgs(snapshot, queryOptions),
      );
    } catch (error) {
      throw translatedPostgresWriteDenial(error, snapshot);
    }
  });
  await maybeReportPostgresRlsSilentDeny(options, snapshot.diagnosticQuery ?? snapshot, result);
  return result;
}

function translatedPostgresWriteDenial(error: unknown, query: unknown): unknown {
  if (!postgresQueryLooksLikeWrite(query)) return error;
  const message = error instanceof Error ? error.message : String(error);
  const permissionDenied = /\bpermission denied for table ["']?([^"'\s]+)["']?/iu.exec(message);
  if (permissionDenied) {
    return new Error(
      `KV433: Postgres denied write access to table ${permissionDenied[1]}; the table is not granted to the request writer role or is outside Kovo's writable authorization posture (SPEC §10.3).`,
    );
  }
  const rlsDenied =
    /\bnew row violates row-level security policy for table ["']?([^"']+)["']?/iu.exec(message) ??
    /\bviolates row-level security policy for table ["']?([^"']+)["']?/iu.exec(message);
  if (rlsDenied) {
    return new Error(
      `KV433: Postgres RLS rejected a write to table ${rlsDenied[1]}; the new row is not owned by the current principal or fails the table's Kovo WITH CHECK policy (SPEC §10.3).`,
    );
  }
  return error;
}

function postgresQueryLooksLikeWrite(query: unknown): boolean {
  const text = postgresQueryText(query);
  return text !== undefined && /^\s*(insert|update|delete|merge)\b/iu.test(text);
}

function postgresQueryText(query: unknown): string | undefined {
  if (typeof query === 'string') return query;
  const snapshot = snapshotManagedSqlStatement(query, 'postgres');
  if (snapshot.ok) return snapshot.statement.text;
  return plainPostgresQueryConfigSnapshot(query, undefined)?.text;
}

function postgresQuerySnapshot(
  query: unknown,
  params: readonly unknown[] | undefined,
): PostgresQuerySnapshot {
  if (typeof query === 'string') return { text: query, values: snapshotUnknownArray(params ?? []) };
  const config = plainPostgresQueryConfigSnapshot(query, params);
  if (config !== undefined) return config;
  const snapshot = snapshotManagedSqlStatement(query, 'postgres');
  if (snapshot.ok) return snapshot.statement;
  if (snapshot.message !== undefined) {
    throw new KovoReadonlyHandleError(`KV414: ${snapshot.message}`);
  }
  throw new KovoReadonlyHandleError(
    'KV414: Postgres scoped managed clients reject unknown SQL query carriers; app SQL must be a string or query config with text/sql (SPEC §10.2/§10.3).',
  );
}

type PostgresQuerySnapshot = {
  diagnosticQuery?: unknown;
  text: string;
  values: readonly unknown[];
};

function plainPostgresQueryConfigSnapshot(
  query: unknown,
  params: readonly unknown[] | undefined,
): PostgresQuerySnapshot | undefined {
  if (!isRecord(query)) return undefined;
  const text = dataPropertyValue(query, 'text') ?? dataPropertyValue(query, 'sql');
  if (typeof text !== 'string') return undefined;
  assertPlainPostgresQueryConfigSafe(query);
  const values = dataPropertyValue(query, 'values');
  const snapshot = witnessFreeze({
    text,
    values: snapshotUnknownArray(witnessIsArray(values) ? values : (params ?? [])),
  });
  return {
    diagnosticQuery: snapshotPostgresQueryConfig(query, snapshot.text, snapshot.values),
    ...snapshot,
  };
}

function assertPlainPostgresQueryConfigSafe(query: Record<PropertyKey, unknown>): void {
  const assertSafe = (property: 'submit' | 'then') => {
    const descriptor = witnessGetOwnPropertyDescriptor(query, property);
    if (descriptor === undefined) return;
    if ('get' in descriptor && descriptor.get !== undefined) {
      throw new KovoReadonlyHandleError(
        `KV414: Postgres scoped managed clients reject ${property}-bearing SQL carriers before snapshotting driver surface (SPEC §10.3).`,
      );
    }
    if ('value' in descriptor && typeof descriptor.value === 'function') {
      throw new KovoReadonlyHandleError(
        `KV414: Postgres scoped managed clients reject ${property}-bearing SQL carriers before snapshotting driver surface (SPEC §10.3).`,
      );
    }
  };
  assertSafe('submit');
  assertSafe('then');
}

function snapshotUnknownArray(values: readonly unknown[]): readonly unknown[] {
  const snapshot: unknown[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(values, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new KovoReadonlyHandleError(
        'KV414: Postgres query values must be dense own data properties (SPEC §10.3).',
      );
    }
    appendManagedValue(snapshot, descriptor.value);
  }
  return witnessFreeze(snapshot);
}

function snapshotPostgresQueryConfig(
  query: Record<PropertyKey, unknown>,
  text: string,
  values: readonly unknown[],
): Readonly<Record<PropertyKey, unknown>> {
  const snapshot = witnessCreateNullRecord<unknown>() as Record<PropertyKey, unknown>;
  let hasText = false;
  let hasValues = false;
  const keys = witnessOwnKeys(query);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (key === 'submit' || key === 'then' || key === 'sql') continue;
    const descriptor = witnessGetOwnPropertyDescriptor(query, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new KovoReadonlyHandleError(
        'KV414: Postgres query configs must contain only own data properties (SPEC §10.3).',
      );
    }
    const value = key === 'text' ? text : key === 'values' ? values : descriptor.value;
    if (key === 'text') hasText = true;
    if (key === 'values') hasValues = true;
    witnessDefineProperty(snapshot, key, {
      configurable: false,
      enumerable: descriptor.enumerable === true,
      value,
      writable: false,
    });
  }
  if (!hasText) witnessDefineProperty(snapshot, 'text', { enumerable: true, value: text });
  if (!hasValues) witnessDefineProperty(snapshot, 'values', { enumerable: true, value: values });
  return witnessFreeze(snapshot);
}

function postgresQueryExecutionArgs(
  snapshot: PostgresQuerySnapshot,
  queryOptions: unknown,
): [unknown, unknown[] | undefined, unknown] {
  if (isRecord(snapshot.diagnosticQuery)) {
    return [snapshot.diagnosticQuery, undefined, queryOptions];
  }
  return [snapshot.text, snapshotUnknownArray(snapshot.values) as unknown[], queryOptions];
}

function dataPropertyValue(
  record: Record<PropertyKey, unknown>,
  property: 'sql' | 'text' | 'values',
): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(record, property);
  if (descriptor === undefined || !('value' in descriptor)) return undefined;
  return descriptor.value;
}

const APP_POSTGRES_ALLOWED_COMMANDS = ['delete', 'insert', 'select', 'update', 'with'] as const;
const APP_POSTGRES_TRANSACTION_COMMANDS = [
  'begin',
  'commit',
  'release',
  'rollback',
  'savepoint',
] as const;

function assertAppPostgresTextAllowed(text: string): void {
  const shape = scanAppPostgresStatementShape(text);
  if (!shape.ok) {
    throw new KovoReadonlyHandleError(
      `KV414: Postgres scoped managed clients reject unsafe app SQL: ${shape.reason} (SPEC §10.2/§10.3).`,
    );
  }
}

type AppPostgresStatementShape = { command: string; ok: true } | { ok: false; reason: string };

function scanAppPostgresStatementShape(sql: string): AppPostgresStatementShape {
  let cleaned = '';
  let statementCount = 0;
  let statementHasToken = false;
  let trailingOnly = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index] ?? '';
    const next = sql[index + 1] ?? '';
    if (char === '-' && next === '-') {
      cleaned += ' ';
      index += 2;
      while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') index += 1;
      if (index < sql.length) cleaned += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      cleaned += ' ';
      index += 2;
      let closed = false;
      for (; index < sql.length; index += 1) {
        if (sql[index] === '*' && sql[index + 1] === '/') {
          closed = true;
          index += 1;
          break;
        }
      }
      if (!closed) return { ok: false, reason: 'unterminated block comment' };
      cleaned += ' ';
      continue;
    }
    if (char === "'") {
      cleaned += ' ';
      for (index += 1; index < sql.length; index += 1) {
        if (sql[index] === "'") {
          if (sql[index + 1] === "'") {
            index += 1;
            continue;
          }
          break;
        }
      }
      if (index >= sql.length) return { ok: false, reason: 'unterminated quoted literal' };
      cleaned += ' ';
      continue;
    }
    if (char === '"') {
      const quoted = scanSqlDoubleQuotedIdentifier(sql, index);
      if (quoted === undefined) return { ok: false, reason: 'unterminated quoted identifier' };
      cleaned += quoted.identifier;
      index = quoted.endIndex;
      continue;
    }
    if ((char === 'U' || char === 'u') && next === '&' && sql[index + 2] === '"') {
      return {
        ok: false,
        // SPEC §10.3: PostgreSQL resolves escapes inside U&"..." before function lookup, so an
        // escaped set_config spelling must not bypass the transaction-scoped principal choke.
        reason: 'Unicode-escaped identifiers are not allowed in app SQL',
      };
    }
    if (char === '$') {
      const tag = postgresDollarQuoteTag(sql, index);
      if (tag !== undefined) {
        cleaned += ' ';
        const end = intrinsicStringIndexOf(sql, tag, index + tag.length);
        if (end === -1) return { ok: false, reason: 'unterminated dollar-quoted literal' };
        index = end + tag.length - 1;
        cleaned += ' ';
        continue;
      }
    }
    if (char === ';') {
      if (statementHasToken) {
        statementCount += 1;
        statementHasToken = false;
        trailingOnly = true;
      } else if (!trailingOnly) {
        return { ok: false, reason: 'empty SQL statement' };
      }
      cleaned += ' ';
      continue;
    }
    if (!isSqlWhitespace(char)) {
      if (trailingOnly) return { ok: false, reason: 'multiple SQL statements' };
      statementHasToken = true;
    }
    cleaned += char;
  }
  if (statementHasToken) statementCount += 1;
  if (statementCount !== 1) return { ok: false, reason: 'expected exactly one SQL statement' };
  const command = firstAsciiSqlWord(cleaned);
  if (command !== undefined && stringListHas(APP_POSTGRES_TRANSACTION_COMMANDS, command)) {
    return {
      ok: false,
      reason: 'app SQL cannot control the framework transaction frame',
    };
  }
  if (command === undefined || !stringListHas(APP_POSTGRES_ALLOWED_COMMANDS, command)) {
    return { ok: false, reason: 'statement command is not in the app SQL allowlist' };
  }
  if (sqlContainsFunctionCall(cleaned, 'set_config')) {
    return { ok: false, reason: 'app SQL cannot change framework transaction settings' };
  }
  return { command, ok: true };
}

function scanSqlDoubleQuotedIdentifier(
  sql: string,
  startIndex: number,
): { endIndex: number; identifier: string } | undefined {
  let identifier = '';
  for (let index = startIndex + 1; index < sql.length; index += 1) {
    const char = sql[index] ?? '';
    if (char === '"') {
      if (sql[index + 1] === '"') {
        identifier += '"';
        index += 1;
        continue;
      }
      return {
        endIndex: index,
        identifier: isSqlIdentifier(identifier) ? identifier : ' ',
      };
    }
    identifier += char;
  }
  return undefined;
}

function postgresDollarQuoteTag(sql: string, start: number): string | undefined {
  if (sql[start] !== '$') return undefined;
  if (sql[start + 1] === '$') return '$$';
  const first = sql[start + 1] ?? '';
  if (!isAsciiIdentifierStart(first)) return undefined;
  let tag = `$${first}`;
  let index = start + 2;
  while (
    index < sql.length &&
    (isAsciiIdentifierStart(sql[index]!) || (sql[index]! >= '0' && sql[index]! <= '9'))
  ) {
    tag += sql[index]!;
    index += 1;
  }
  if (sql[index] !== '$') return undefined;
  return `${tag}$`;
}

function intrinsicStringIndexOf(value: string, search: string, start = 0): number {
  if (search.length === 0) return start <= value.length ? start : value.length;
  for (let index = start; index + search.length <= value.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < search.length; offset += 1) {
      if (value[index + offset] !== search[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return index;
  }
  return -1;
}

function firstAsciiSqlWord(value: string): string | undefined {
  let index = 0;
  while (index < value.length && isSqlWhitespace(value[index]!)) index += 1;
  if (!isAsciiLetter(value[index] ?? '')) return undefined;
  let word = '';
  while (index < value.length && isAsciiLetter(value[index]!)) {
    word += asciiLowerCharacter(value[index]!);
    index += 1;
  }
  return word;
}

function sqlContainsFunctionCall(sql: string, expected: string): boolean {
  let index = 0;
  while (index < sql.length) {
    if (!isAsciiIdentifierStart(sql[index]!)) {
      index += 1;
      continue;
    }
    let identifier = '';
    while (index < sql.length && isAsciiIdentifierContinue(sql[index]!)) {
      identifier += asciiLowerCharacter(sql[index]!);
      index += 1;
    }
    while (index < sql.length && isSqlWhitespace(sql[index]!)) index += 1;
    if (identifier === expected && sql[index] === '(') return true;
  }
  return false;
}

function stringListHas(values: readonly string[], expected: string): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === expected) return true;
  }
  return false;
}

function snapshotStringArray(value: unknown, label: string): readonly string[] {
  if (!witnessIsArray(value)) throw new TypeError(`${label} must be an array.`);
  const snapshot: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(value, index);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      throw new TypeError(`${label}[${index}] must be an own string data property.`);
    }
    appendManagedValue(snapshot, descriptor.value);
  }
  return witnessFreeze(snapshot);
}

function snapshotTrimmedStringArray(value: unknown, label: string): readonly string[] {
  const source = snapshotStringArray(value, label);
  const snapshot: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const trimmed = trimFrameworkString(source[index]!);
    if (trimmed === '') throw new TypeError(`${label}[${index}] must not be empty.`);
    if (!stringListHas(snapshot, trimmed)) appendManagedValue(snapshot, trimmed);
  }
  return witnessFreeze(snapshot);
}

function normalizedStringArray(
  values: readonly string[],
  normalize: (value: string) => string,
  label: string,
): readonly string[] {
  const source = snapshotStringArray(values, label);
  const normalized: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const value = normalize(source[index]!);
    if (typeof value !== 'string') throw new TypeError(`${label} normalization must be a string.`);
    if (!stringListHas(normalized, value)) appendManagedValue(normalized, value);
  }
  return witnessFreeze(normalized);
}

function appendManagedValue<Value>(values: Value[], value: Value): void {
  witnessDefineProperty(values, values.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function prependManagedArgument(first: unknown, rest: readonly unknown[]): readonly unknown[] {
  const args: unknown[] = [];
  appendManagedValue(args, first);
  for (let index = 0; index < rest.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(rest, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('managed DB arguments must be dense own data properties.');
    }
    appendManagedValue(args, descriptor.value);
  }
  return args;
}

function asciiLower(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    result += asciiLowerCharacter(value[index]!);
  }
  return result;
}

function trimFrameworkString(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && isFrameworkWhitespace(value[start]!)) start += 1;
  while (end > start && isFrameworkWhitespace(value[end - 1]!)) end -= 1;
  let trimmed = '';
  for (let index = start; index < end; index += 1) trimmed += value[index];
  return trimmed;
}

function stringRange(value: string, start: number, end: number): string {
  let result = '';
  for (let index = start; index < end; index += 1) result += value[index];
  return result;
}

function isFrameworkWhitespace(value: string): boolean {
  return (
    isSqlWhitespace(value) ||
    value === '\u1680' ||
    (value >= '\u2000' && value <= '\u200a') ||
    value === '\u2028' ||
    value === '\u2029' ||
    value === '\u202f' ||
    value === '\u205f' ||
    value === '\u3000'
  );
}

function intrinsicStringIncludes(value: string, search: string): boolean {
  if (search.length === 0) return true;
  for (let index = 0; index + search.length <= value.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < search.length; offset += 1) {
      if (value[index + offset] !== search[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function isSqlIdentifier(value: string): boolean {
  if (value.length === 0 || !isAsciiIdentifierStart(value[0]!)) return false;
  for (let index = 1; index < value.length; index += 1) {
    if (!isAsciiIdentifierContinue(value[index]!)) return false;
  }
  return true;
}

function isAsciiIdentifierStart(value: string): boolean {
  return isAsciiLetter(value) || value === '_';
}

function isAsciiIdentifierContinue(value: string): boolean {
  return isAsciiIdentifierStart(value) || (value >= '0' && value <= '9') || value === '$';
}

function isAsciiLetter(value: string): boolean {
  const lower = asciiLowerCharacter(value);
  return lower >= 'a' && lower <= 'z';
}

function asciiLowerCharacter(value: string): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  for (let index = 0; index < upper.length; index += 1) {
    if (upper[index] === value) return lower[index]!;
  }
  return value;
}

function isSqlWhitespace(value: string): boolean {
  return (
    value === ' ' ||
    value === '\t' ||
    value === '\n' ||
    value === '\r' ||
    value === '\f' ||
    value === '\v' ||
    value === '\u00a0' ||
    value === '\ufeff'
  );
}

function scopedPostgresExec(options: PostgresScopedClientOptions, query: string): Promise<unknown> {
  if (options.role !== false && options.role !== undefined) {
    throw new KovoReadonlyHandleError(
      'KV414: Postgres role-scoped managed clients require parameterized db.query(...) so app SQL executes as one extended-protocol statement (SPEC §10.3/§11.1).',
    );
  }
  void query;
  throw new KovoReadonlyHandleError(
    'KV414: Postgres managed clients reject db.exec(...) on the request-scoped path; use parameterized db.query(...) instead (SPEC §10.3/§11.1).',
  );
}

function postgresTransaction<Result>(
  client: Record<PropertyKey, unknown>,
  transaction: Function,
  callback: (tx: PostgresTransactionClient) => Promise<Result>,
): Promise<Result> {
  return witnessReflectApply(transaction, client, [callback]) as Promise<Result>;
}

interface PostgresTransactionControls {
  readonly exec: Function;
  readonly query: Function;
  readonly transaction: Function | undefined;
}

function postgresTransactionMethod(client: Record<PropertyKey, unknown>): Function {
  try {
    return inheritedFunctionDataProperty(client, 'transaction');
  } catch {
    throw new KovoReadonlyHandleError(
      'KV433: Postgres read-only client requires a transaction-capable driver handle (SPEC §10.3/§11.2).',
    );
  }
}

function pinPostgresTransactionControls(
  tx: PostgresTransactionClient,
): PostgresTransactionControls {
  const target = tx as Record<PropertyKey, unknown>;
  return witnessFreeze({
    exec: inheritedFunctionDataProperty(target, 'exec'),
    query: inheritedFunctionDataProperty(target, 'query'),
    transaction: optionalStrictInheritedFunctionDataProperty(target, 'transaction'),
  });
}

async function runPostgresTransactionControl(
  tx: PostgresTransactionClient,
  controls: PostgresTransactionControls,
  options: PostgresScopedClientOptions,
): Promise<void> {
  if (options.readOnly === true) {
    await witnessReflectApply<Promise<unknown>>(controls.exec, tx, ['SET TRANSACTION READ ONLY']);
  }
  if (options.principal !== undefined) {
    await witnessReflectApply<Promise<unknown>>(controls.query, tx, [
      "SELECT set_config('kovo.principal', $1, true)",
      [options.principal],
    ]);
  }
  if (options.roleSetting !== undefined) {
    await witnessReflectApply<Promise<unknown>>(controls.query, tx, [
      "SELECT set_config('kovo.role', $1, true)",
      [options.roleSetting],
    ]);
  }
  if (options.role !== false && options.role !== undefined) {
    const quote = options.quoteIdentifier ?? quoteSqlIdentifier;
    await witnessReflectApply<Promise<unknown>>(controls.exec, tx, [
      `SET LOCAL ROLE ${quote(options.role)}`,
    ]);
  }
}

function quoteSqlIdentifier(value: string): string {
  let quoted = '"';
  for (let index = 0; index < value.length; index += 1) {
    quoted += value[index] === '"' ? '""' : value[index];
  }
  return `${quoted}"`;
}

async function maybeReportPostgresRlsSilentDeny(
  options: PostgresScopedClientOptions,
  query: unknown,
  result: unknown,
): Promise<void> {
  const diagnostics = options.rlsDiagnostics;
  if (
    diagnostics === undefined ||
    diagnostics.enabled === false ||
    runtimeEnvironmentValue('NODE_ENV') === 'production' ||
    options.readOnly !== true ||
    resultRowCount(result) !== 0
  ) {
    return;
  }

  const table = resolvePostgresRlsDiagnosticTable(query, diagnostics);
  if (options.principal === undefined) {
    postgresRlsSilentDenyDiagnostics.record({
      kind: 'principal-unset',
      message: 'Postgres owner-scoped read returned 0 rows because no kovo.principal was set.',
      ...(table === undefined ? {} : { table }),
    });
    return;
  }

  const privilegedClient = diagnostics.privilegedClient;
  if (privilegedClient === undefined || table === undefined) return;

  const count = await countPostgresDiagnosticRows(privilegedClient, table, options);
  if (count <= 0) return;

  postgresRlsSilentDenyDiagnostics.record({
    filteredRows: count,
    kind: 'owner-scope-filtered',
    message: `kovo_owner_scope filtered ${count} row${count === 1 ? '' : 's'} for principal ${options.principal}.`,
    principal: options.principal,
    table,
  });
}

function resultRowCount(result: unknown): number | undefined {
  if (witnessIsArray(result)) return result.length;
  if (isRecord(result)) {
    const rows = result.rows;
    if (witnessIsArray(rows)) return rows.length;
  }
  return undefined;
}

async function countPostgresDiagnosticRows(
  client: PostgresRlsDiagnosticReadClient,
  table: string,
  options: PostgresScopedClientOptions,
): Promise<number> {
  const quote = options.quoteIdentifier ?? quoteSqlIdentifier;
  const query = `SELECT count(*) AS count FROM ${quoteQualifiedSqlIdentifier(table, quote)}`;
  const result = await client.query(query);
  const rows = witnessIsArray(result)
    ? result
    : isRecord(result) && witnessIsArray(result.rows)
      ? result.rows
      : [];
  const first = rows[0];
  if (!isRecord(first)) return 0;
  const raw = first.count;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'bigint') return Number(raw);
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw);
  return 0;
}

function resolvePostgresRlsDiagnosticTable(
  query: unknown,
  diagnostics: PostgresRlsSilentDenyDiagnosticsOptions,
): string | undefined {
  if (typeof diagnostics.tableName === 'string') return diagnostics.tableName;
  if (typeof diagnostics.tableName === 'function') return diagnostics.tableName(query);
  const text = postgresQueryText(query);
  return text === undefined ? undefined : simpleSingleTableSelectName(text);
}

function simpleSingleTableSelectName(query: string): string | undefined {
  let normalized = trimFrameworkString(query);
  let end = normalized.length;
  while (end > 0 && normalized[end - 1] === ';') {
    end -= 1;
    while (end > 0 && isFrameworkWhitespace(normalized[end - 1]!)) end -= 1;
  }
  normalized = stringRange(normalized, 0, end);
  const match = witnessRegExpExec(
    /^select\b[\s\S]*?\bfrom\s+((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?)(?:\s+(?:as\s+)?(?:"[^"]+"|[A-Za-z_][\w$]*))?(?:\s+where\b|\s+group\s+by\b|\s+having\b|\s+order\s+by\b|\s+limit\b|\s+offset\b|\s+fetch\b|\s+for\b|\s*$)/iu,
    normalized,
  );
  if (!match) return undefined;
  const tableDescriptor = witnessGetOwnPropertyDescriptor(match, 1);
  if (
    tableDescriptor === undefined ||
    !('value' in tableDescriptor) ||
    typeof tableDescriptor.value !== 'string' ||
    simpleSelectHasMultipleSources(normalized)
  ) {
    return undefined;
  }
  return unquoteQualifiedSqlIdentifier(tableDescriptor.value);
}

function simpleSelectHasMultipleSources(sql: string): boolean {
  let sawFrom = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]!;
    if (char === "'" || char === '"') {
      const quote = char;
      for (index += 1; index < sql.length; index += 1) {
        if (sql[index] !== quote) continue;
        if (sql[index + 1] === quote) {
          index += 1;
          continue;
        }
        break;
      }
      continue;
    }
    if (char === '-' && sql[index + 1] === '-') {
      while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') index += 1;
      continue;
    }
    if (char === '/' && sql[index + 1] === '*') {
      index += 2;
      while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === '/')) index += 1;
      index += 1;
      continue;
    }
    if (sawFrom && (char === ',' || char === ';')) return true;
    if (!isAsciiIdentifierStart(char)) continue;
    let word = '';
    while (index < sql.length && isAsciiIdentifierContinue(sql[index]!)) {
      word += asciiLowerCharacter(sql[index]!);
      index += 1;
    }
    index -= 1;
    if (word === 'from') {
      if (sawFrom) return true;
      sawFrom = true;
    } else if (word === 'join' || word === 'union' || word === 'intersect' || word === 'except') {
      return true;
    }
  }
  return !sawFrom;
}

function unquoteQualifiedSqlIdentifier(value: string): string | undefined {
  const parts = qualifiedSqlIdentifierParts(value);
  if (parts === undefined) return undefined;
  let normalized = '';
  for (let index = 0; index < parts.length; index += 1) {
    if (index > 0) normalized += '.';
    normalized += parts[index];
  }
  return normalized;
}

function quoteQualifiedSqlIdentifier(value: string, quote: (identifier: string) => string): string {
  const parts = qualifiedSqlIdentifierParts(value);
  if (parts === undefined) throw new TypeError('Postgres diagnostic table name is invalid.');
  let quoted = '';
  for (let index = 0; index < parts.length; index += 1) {
    if (index > 0) quoted += '.';
    quoted += quote(parts[index]!);
  }
  return quoted;
}

function qualifiedSqlIdentifierParts(value: string): readonly string[] | undefined {
  const parts: string[] = [];
  let index = 0;
  while (index < value.length) {
    while (index < value.length && isFrameworkWhitespace(value[index]!)) index += 1;
    let part = '';
    if (value[index] === '"') {
      index += 1;
      let closed = false;
      while (index < value.length) {
        if (value[index] === '"') {
          if (value[index + 1] === '"') {
            part += '"';
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        if (value[index] === '.') return undefined;
        part += value[index];
        index += 1;
      }
      if (!closed) return undefined;
    } else {
      if (!isAsciiIdentifierStart(value[index] ?? '')) return undefined;
      while (index < value.length && isAsciiIdentifierContinue(value[index]!)) {
        part += value[index];
        index += 1;
      }
    }
    if (part === '') return undefined;
    appendManagedValue(parts, part);
    while (index < value.length && isFrameworkWhitespace(value[index]!)) index += 1;
    if (index === value.length) break;
    if (value[index] !== '.' || parts.length >= 2) return undefined;
    index += 1;
    if (index === value.length) return undefined;
  }
  return witnessFreeze(parts);
}

/** The mode a managed handle is resolved in: a read-only loader handle, or a read-write handle. */
export type ManagedDbMode = 'read' | 'write';

/**
 * Wrap a db handle so only known read capabilities are exposed (SPEC §9.4 KV433 Stage 1). The proxy
 * allowlists read builders and returns a thrower for every other string property, so future/dialect
 * sinks fail closed instead of depending on an incomplete write-verb denylist. Framework-owned
 * query/document surfaces receive this pre-applied as `context.db` / `request.db`.
 *
 * This helper is the blessed read-only escape for raw endpoint reads: wrap an app DB with
 * `readonlyDb(appDb)` instead of importing a broad write handle into a read-only endpoint. It is a
 * fail-closed runtime floor plus a branded type, not the SPEC §6.6 security proof.
 */
export function readonlyDb<Db extends object>(
  db: Db,
  options: { crossOwnerRead?: CrossOwnerReadPolicyOptions; rawRead?: RawReadPolicyOptions } = {},
): Reader<Db> {
  const runtimeOptions = snapshotReadonlyCapabilityOptions(options);
  const readDb = readonlyDbTarget(db);
  const safe = wrapManagedDbForSqlSafety(
    readDb,
    undefined,
    managedSqlExecutionPolicy({
      capability: 'read',
      engineReadonly: readDb !== db,
    }),
  );
  return readonlyCapabilityDb(safe as object, runtimeOptions) as unknown as Reader<Db>;
}

function snapshotReadonlyCapabilityOptions(options: {
  crossOwnerRead?: CrossOwnerReadPolicyOptions;
  rawRead?: RawReadPolicyOptions;
}): {
  crossOwnerRead?: CrossOwnerReadPolicyOptions;
  rawRead?: RawReadPolicyOptions;
} {
  const snapshot = witnessCreateNullRecord<unknown>() as {
    crossOwnerRead?: CrossOwnerReadPolicyOptions;
    rawRead?: RawReadPolicyOptions;
  };
  const crossOwnerRead = optionalOwnDataProperty(options, 'crossOwnerRead');
  const rawRead = optionalOwnDataProperty(options, 'rawRead');
  if (crossOwnerRead !== undefined) {
    snapshot.crossOwnerRead = snapshotCrossOwnerReadPolicy(
      crossOwnerRead as CrossOwnerReadPolicyOptions,
    );
  }
  if (rawRead !== undefined)
    snapshot.rawRead = snapshotRawReadPolicy(rawRead as RawReadPolicyOptions);
  return witnessFreeze(snapshot);
}

function snapshotRawReadPolicy(policy: RawReadPolicyOptions): RawReadPolicyOptions {
  const normalizeTableName = ownFunctionDataProperty(policy, 'normalizeTableName');
  const snapshot = witnessCreateNullRecord<unknown>() as unknown as RawReadPolicyOptions;
  snapshot.dialectLabel = ownStringDataProperty(policy, 'dialectLabel');
  snapshot.normalizeTableName = function normalizeRawReadTable(table) {
    const value = witnessReflectApply<unknown>(normalizeTableName, policy, [table]);
    if (typeof value !== 'string') throw new TypeError('rawRead table normalization failed.');
    return value;
  };
  const ownerTables = optionalOwnDataProperty(policy, 'ownerTables');
  const sqliteAuthorizer = optionalOwnDataProperty(policy, 'sqliteAuthorizer');
  const executeMethod = optionalOwnDataProperty(policy, 'executeMethod');
  const executeSql = optionalOwnDataProperty(policy, 'executeSql');
  if (ownerTables !== undefined) {
    snapshot.ownerTables = snapshotStringArray(ownerTables, 'rawRead owner tables');
  }
  if (sqliteAuthorizer !== undefined) {
    snapshot.sqliteAuthorizer = snapshotSqliteAuthorizer(
      sqliteAuthorizer as DeclaredWriteSqliteAuthorizerOptions,
    );
  }
  if (executeMethod !== undefined) {
    if (
      executeMethod !== 'all' &&
      executeMethod !== 'execute' &&
      executeMethod !== 'query' &&
      executeMethod !== 'values'
    ) {
      throw new TypeError('rawRead executeMethod is invalid.');
    }
    snapshot.executeMethod = executeMethod;
  }
  if (executeSql !== undefined) {
    if (typeof executeSql !== 'function')
      throw new TypeError('rawRead executeSql must be a function.');
    const execute = executeSql;
    snapshot.executeSql = (statement) => witnessReflectApply(execute, policy, [statement]);
  }
  return witnessFreeze(snapshot);
}

function snapshotCrossOwnerReadPolicy(
  policy: CrossOwnerReadPolicyOptions,
): CrossOwnerReadPolicyOptions {
  const normalizeTableName = ownFunctionDataProperty(policy, 'normalizeTableName');
  const snapshot = witnessCreateNullRecord<unknown>() as unknown as CrossOwnerReadPolicyOptions;
  snapshot.dialectLabel = ownStringDataProperty(policy, 'dialectLabel');
  snapshot.normalizeTableName = function normalizeCrossOwnerReadTable(table) {
    const value = witnessReflectApply<unknown>(normalizeTableName, policy, [table]);
    if (typeof value !== 'string') {
      throw new TypeError('crossOwnerRead table normalization failed.');
    }
    return value;
  };
  snapshot.ownerTables = snapshotStringArray(
    optionalOwnDataProperty(policy, 'ownerTables'),
    'crossOwnerRead owner tables',
  );
  const adminClient = optionalOwnDataProperty(policy, 'adminClient');
  const executeMethod = optionalOwnDataProperty(policy, 'executeMethod');
  const executeSql = optionalOwnDataProperty(policy, 'executeSql');
  const hasRole = optionalOwnDataProperty(policy, 'hasRole');
  const principal = optionalOwnDataProperty(policy, 'principal');
  if (adminClient !== undefined) {
    if (!isRecord(adminClient))
      throw new TypeError('crossOwnerRead adminClient must be an object.');
    snapshot.adminClient = adminClient;
  }
  if (executeMethod !== undefined) {
    if (
      executeMethod !== 'all' &&
      executeMethod !== 'execute' &&
      executeMethod !== 'query' &&
      executeMethod !== 'values'
    ) {
      throw new TypeError('crossOwnerRead executeMethod is invalid.');
    }
    snapshot.executeMethod = executeMethod;
  }
  if (executeSql !== undefined) {
    if (typeof executeSql !== 'function') {
      throw new TypeError('crossOwnerRead executeSql must be a function.');
    }
    const execute = executeSql;
    snapshot.executeSql = (statement) => witnessReflectApply(execute, policy, [statement]);
  }
  if (hasRole !== undefined) {
    if (typeof hasRole !== 'function')
      throw new TypeError('crossOwnerRead hasRole must be a function.');
    snapshot.hasRole = (role) => witnessReflectApply(hasRole, policy, [role]);
  }
  if (principal !== undefined) {
    if (typeof principal !== 'string')
      throw new TypeError('crossOwnerRead principal must be a string.');
    snapshot.principal = principal;
  }
  return witnessFreeze(snapshot);
}

function readonlyCapabilityDb<Db extends object>(
  db: Db,
  options: { crossOwnerRead?: CrossOwnerReadPolicyOptions; rawRead?: RawReadPolicyOptions },
  preserveInnerCapabilities = false,
): Reader<Db> {
  const allowTestFixtureQuery =
    preserveInnerCapabilities && isFrameworkManagedTestFixtureSqlDispatchProxy(db);
  const proxy = witnessProxy(db, {
    get(target, prop, receiver) {
      return readonlyCapabilityValue(
        target,
        prop,
        receiver,
        options,
        preserveInnerCapabilities,
        allowTestFixtureQuery,
      );
    },
  }) as Reader<Db>;
  witnessWeakSetAdd(frameworkReadonlyCapabilityHandles, proxy);
  return proxy;
}

function readonlyCapabilityValue(
  target: object,
  prop: PropertyKey,
  receiver: unknown,
  options: { crossOwnerRead?: CrossOwnerReadPolicyOptions; rawRead?: RawReadPolicyOptions },
  preserveInnerCapabilities: boolean,
  allowTestFixtureQuery: boolean,
): unknown {
  const reject = readonlyCapabilityError;
  if (prop === 'then') return undefined;
  if (typeof prop !== 'string') return witnessReflectGet(target, prop, receiver);
  if (stringListHas(DENIED_READ_CAPABILITY_PROPERTIES, prop)) return reject(prop);
  if (!stringListHas(READ_CAPABILITY_PROPERTIES, prop)) return reject(prop);
  if (prop === 'crossOwnerRead')
    return readonlyCrossOwnerRead(target, receiver, options, preserveInnerCapabilities);
  if (prop === 'rawRead')
    return readonlyRawRead(target, receiver, options, preserveInnerCapabilities);
  const value = witnessReflectGet(target, prop, receiver);
  if (prop === 'query') {
    if (typeof value !== 'function') return value;
    // SPEC §11.2: only a repo-witnessed engine-readonly fixture retains legacy query().
    return allowTestFixtureQuery
      ? (...args: unknown[]) => witnessReflectApply(value, target, args)
      : reject(prop);
  }
  if (!stringListHas(CALLABLE_READ_CAPABILITY_PROPERTIES, prop)) return reject(prop);
  return typeof value === 'function'
    ? (...args: unknown[]) => witnessReflectApply(value, target, args)
    : value;
}

function readonlyCapabilityError(prop: string): () => never {
  return () => {
    throw new KovoReadonlyHandleError(
      `KV433: framework read-only DB capability proxy blocked db.${prop} in a query() loader. Move writes to a mutation(), domain write, or endpoint().`,
    );
  };
}

function readonlyCrossOwnerRead(
  target: object,
  receiver: unknown,
  options: { crossOwnerRead?: CrossOwnerReadPolicyOptions },
  preserveInnerCapabilities: boolean,
): unknown {
  if (options.crossOwnerRead === undefined && preserveInnerCapabilities) {
    const value = witnessReflectGet(target, 'crossOwnerRead', receiver);
    if (typeof value === 'function') {
      return (...args: unknown[]) => witnessReflectApply(value, target, args);
    }
  }
  return crossOwnerReadCapability(options.crossOwnerRead);
}

function readonlyRawRead(
  target: object,
  receiver: unknown,
  options: { rawRead?: RawReadPolicyOptions },
  preserveInnerCapabilities: boolean,
): unknown {
  if (options.rawRead === undefined && preserveInnerCapabilities) {
    const value = witnessReflectGet(target, 'rawRead', receiver);
    if (typeof value === 'function') {
      return (...args: unknown[]) => witnessReflectApply(value, target, args);
    }
  }
  return rawReadCapability(target, options.rawRead);
}

function rawReadCapability(
  target: object,
  policy: RawReadPolicyOptions | undefined,
): <Row = unknown>(statement: unknown, declaration: RawReadDeclaration) => Promise<Row[]> | Row[] {
  return <Row = unknown>(statement: unknown, declaration: RawReadDeclaration) => {
    if (policy === undefined) {
      throw new KovoReadonlyHandleError(
        'KV410: rawRead requires a framework-owned read policy; use builder reads unless the adapter wires the declared raw-read escape (SPEC §10.2/§10.3).',
      );
    }
    const normalized = normalizedRawReadDeclaration(declaration);
    const carrier = sqlCarrierFromValue(statement, []);
    if (carrier === undefined) {
      throw new Error(
        'KV410: rawRead requires a SQL statement whose table set can be checked against the declared reads (SPEC §10.2/§10.3).',
      );
    }
    assertRawReadObservedTablesAllowed(carrier.text, normalized, policy);
    if (policy.executeSql !== undefined) {
      return witnessReflectApply(policy.executeSql, policy, [carrier]) as Promise<Row[]> | Row[];
    }
    const method = rawReadExecutionMethod(target, policy);
    return witnessReflectApply(method, target, [reconstructedDriverCarrier(carrier)]) as
      | Promise<Row[]>
      | Row[];
  };
}

function crossOwnerReadCapability(
  policy: CrossOwnerReadPolicyOptions | undefined,
): <Row = unknown>(
  statement: unknown,
  declaration: CrossOwnerReadDeclaration,
) => Promise<Row[]> | Row[] {
  return <Row = unknown>(statement: unknown, declaration: CrossOwnerReadDeclaration) => {
    if (policy === undefined || policy.adminClient === undefined) {
      throw new KovoReadonlyHandleError(
        'KV414: crossOwnerRead requires a framework-owned admin read policy and opt-in table set (SPEC §10.3).',
      );
    }
    const normalized = normalizedCrossOwnerReadDeclaration(declaration);
    const carrier = sqlCarrierFromValue(statement, []);
    if (carrier === undefined) {
      throw new Error(
        'KV414: crossOwnerRead requires a SQL statement whose single table can be checked (SPEC §10.3).',
      );
    }
    const observed = simpleSingleTableSelectName(carrier.text);
    if (observed === undefined) {
      throw new Error(
        'KV414: crossOwnerRead currently supports one simple SELECT ... FROM table statement (SPEC §10.3).',
      );
    }
    if (
      policy.hasRole === undefined ||
      witnessReflectApply(policy.hasRole, policy, [normalized.role]) !== true
    ) {
      throw new KovoReadonlyHandleError(
        'KV414: crossOwnerRead requires a passed guards.role("admin") request guard before the admin read role is enabled (SPEC §10.3).',
      );
    }
    assertCrossOwnerReadAllowed(observed, normalized, policy);
    recordCrossOwnerReadAuditFact(normalized, observed, policy);
    if (policy.executeSql !== undefined) {
      return witnessReflectApply(policy.executeSql, policy, [carrier]) as Promise<Row[]> | Row[];
    }
    const method = rawReadExecutionMethod(policy.adminClient, policy);
    return witnessReflectApply(method, policy.adminClient, [
      reconstructedDriverCarrier(carrier),
    ]) as Promise<Row[]> | Row[];
  };
}

function reconstructedDriverCarrier(carrier: SqlCarrier): {
  readonly text: string;
  readonly values: readonly unknown[];
} {
  return frameworkTrustedSqlCarrier(
    { text: carrier.text, values: carrier.params },
    'framework reconstructed audited raw-read SQL carrier (SPEC §10.3)',
  );
}

function normalizedRawReadDeclaration(declaration: RawReadDeclaration): RawReadDeclaration {
  if (!isRecord(declaration)) throw new Error('KV410: rawRead requires a declaration object.');
  const reads = snapshotTrimmedStringArray(
    optionalOwnDataProperty(declaration, 'reads'),
    'rawRead declared reads',
  );
  if (reads.length === 0)
    throw new Error('KV410: rawRead requires a non-empty declared reads table set.');
  const actAsValue = optionalOwnDataProperty(declaration, 'actAs');
  const publicReadValue = optionalOwnDataProperty(declaration, 'declarePublicRead');
  let actAs: string | undefined;
  if (actAsValue !== undefined) {
    if (typeof actAsValue !== 'string') throw new Error('KV414: rawRead actAs must be a string.');
    actAs = trimFrameworkString(actAsValue);
    if (actAs === '') throw new Error('KV414: rawRead actAs scope requires a non-empty principal.');
  }
  const snapshot = witnessCreateNullRecord<unknown>() as unknown as RawReadDeclaration;
  snapshot.reads = reads;
  if (actAs !== undefined) snapshot.actAs = actAs;
  if (publicReadValue !== undefined) {
    snapshot.declarePublicRead = normalizedPublicReadDeclaration(
      publicReadValue as PublicReadDeclaration,
    );
  }
  return witnessFreeze(snapshot);
}

function assertRawReadObservedTablesAllowed(
  sql: string,
  declaration: RawReadDeclaration,
  policy: RawReadPolicyOptions,
): void {
  const publicRead =
    declaration.declarePublicRead === undefined
      ? undefined
      : normalizedPublicReadDeclaration(declaration.declarePublicRead);
  const sqliteAuthorizer = policy.sqliteAuthorizer;
  if (sqliteAuthorizer === undefined) {
    if (publicRead !== undefined) recordPublicReadAuditFact(publicRead, declaration, policy);
    return;
  }
  const readAction = sqliteAuthorizer.constants.SQLITE_READ;
  if (readAction === undefined) {
    throw new Error(
      'KV410: SQLite rawRead authorizer requires SQLITE_READ support to observe declared reads (SPEC §10.2/§10.3).',
    );
  }

  const observed: string[] = [];
  const sqlite = sqliteAuthorizer.openDatabase();
  const setAuthorizer = inheritedFunctionDataProperty(sqlite, 'setAuthorizer');
  const prepare = inheritedFunctionDataProperty(sqlite, 'prepare');
  const close = inheritedFunctionDataProperty(sqlite, 'close');
  try {
    witnessReflectApply(setAuthorizer, sqlite, [
      (
        action: number,
        objectName: string | null,
        _columnName: string | null,
        databaseName: string | null,
      ) => {
        if (action === readAction && objectName !== null) {
          const table = policy.normalizeTableName(`${databaseName ?? 'main'}.${objectName}`);
          if (!stringListHas(observed, table)) appendManagedValue(observed, table);
        }
        return sqliteAuthorizer.constants.SQLITE_OK;
      },
    ]);
    witnessReflectApply(prepare, sqlite, [sql]);
  } finally {
    witnessReflectApply(close, sqlite, []);
  }

  const declared = normalizedStringArray(
    declaration.reads,
    policy.normalizeTableName,
    'rawRead declared tables',
  );
  const unexpected: string[] = [];
  for (let index = 0; index < observed.length; index += 1) {
    const table = observed[index]!;
    if (!stringListHas(declared, table)) appendManagedValue(unexpected, table);
  }
  if (unexpected.length > 0) {
    throw new Error(
      [
        `KV410: ${policy.dialectLabel} rawRead observed table(s) outside the declared reads set (SPEC §10.2/§10.3).`,
        `  observed: ${observed.join(', ') || '<none>'}`,
        `  declared reads: ${declared.join(', ') || '<none>'}`,
      ].join('\n'),
    );
  }

  const ownerTables = normalizedStringArray(
    policy.ownerTables ?? [],
    policy.normalizeTableName,
    'rawRead owner tables',
  );
  const scoped = declaration.actAs !== undefined || publicRead !== undefined;
  const ownerReads: string[] = [];
  for (let index = 0; index < observed.length; index += 1) {
    const table = observed[index]!;
    if (stringListHas(ownerTables, table)) appendManagedValue(ownerReads, table);
  }
  if (!scoped && ownerReads.length > 0) {
    throw new Error(
      [
        `KV414: ${policy.dialectLabel} rawRead of owner-scoped table(s) requires actAs or declarePublicRead scope (SPEC §10.3).`,
        `  owner tables: ${ownerReads.join(', ')}`,
      ].join('\n'),
    );
  }
  if (publicRead !== undefined) {
    recordPublicReadAuditFact(publicRead, declaration, policy, {
      observedReads: observed,
      ownerReads,
    });
  }
}

function normalizedPublicReadDeclaration(options: PublicReadDeclaration): PublicReadDeclaration {
  if (!isRecord(options)) {
    throw new Error(
      'KV414: rawRead declarePublicRead scope requires a declaration object (SPEC §10.3).',
    );
  }
  const reasonValue = optionalOwnDataProperty(options, 'reason');
  if (typeof reasonValue !== 'string') {
    throw new Error('KV414: rawRead declarePublicRead scope requires a non-empty reason.');
  }
  const reason = trimFrameworkString(reasonValue);
  if (reason === '') {
    throw new Error('KV414: rawRead declarePublicRead scope requires a non-empty reason.');
  }
  const rows = optionalOwnDataProperty(options, 'rows');
  const columns = optionalOwnDataProperty(options, 'columns');
  const normalized: PublicReadDeclaration = { reason };
  if (rows !== undefined)
    normalized.rows = normalizedPublicReadRows(rows as PublicReadDeclaration['rows']);
  if (columns !== undefined)
    normalized.columns = normalizedPublicReadColumns(columns as readonly string[]);
  return witnessFreeze(normalized);
}

function normalizedPublicReadRows(
  rows: PublicReadDeclaration['rows'],
): PublicReadRowsScope | string {
  if (typeof rows === 'string') {
    const predicate = trimFrameworkString(rows);
    if (predicate === '') {
      throw new Error(
        'KV414: rawRead declarePublicRead rows scope requires a non-empty predicate.',
      );
    }
    return predicate;
  }
  if (!isRecord(rows)) {
    throw new Error(
      'KV414: rawRead declarePublicRead rows scope requires a predicate string or { predicate, table? }.',
    );
  }
  const predicateValue = optionalOwnDataProperty(rows, 'predicate');
  const tableValue = optionalOwnDataProperty(rows, 'table');
  if (typeof predicateValue !== 'string') {
    throw new Error(
      'KV414: rawRead declarePublicRead rows scope requires a predicate string or { predicate, table? }.',
    );
  }
  const predicate = trimFrameworkString(predicateValue);
  if (predicate === '') {
    throw new Error('KV414: rawRead declarePublicRead rows scope requires a non-empty predicate.');
  }
  if (tableValue !== undefined && typeof tableValue !== 'string') {
    throw new Error('KV414: rawRead declarePublicRead rows table must be a string.');
  }
  const table = typeof tableValue === 'string' ? trimFrameworkString(tableValue) : undefined;
  return witnessFreeze(table === undefined || table === '' ? { predicate } : { predicate, table });
}

function normalizedPublicReadColumns(columns: readonly string[]): readonly string[] {
  let snapshot: readonly string[];
  try {
    snapshot = snapshotTrimmedStringArray(columns, 'rawRead public columns');
  } catch {
    throw new Error(
      'KV414: rawRead declarePublicRead columns scope requires a non-empty column list.',
    );
  }
  if (snapshot.length === 0) {
    throw new Error(
      'KV414: rawRead declarePublicRead columns scope requires a non-empty column list.',
    );
  }
  return snapshot;
}

function recordPublicReadAuditFact(
  publicRead: PublicReadDeclaration,
  declaration: RawReadDeclaration,
  policy: RawReadPolicyOptions,
  observed: { observedReads?: readonly string[]; ownerReads?: readonly string[] } = {},
): void {
  publicReadAuditFacts.record({
    declaredReads: [...new Set(declaration.reads.map(policy.normalizeTableName))].sort(),
    dialectLabel: policy.dialectLabel,
    reason: publicRead.reason,
    ...(publicRead.rows === undefined ? {} : { rows: publicRead.rows }),
    ...(publicRead.columns === undefined ? {} : { columns: [...publicRead.columns] }),
    ...(observed.observedReads === undefined
      ? {}
      : { observedReads: [...new Set(observed.observedReads)].sort() }),
    ...(observed.ownerReads === undefined || observed.ownerReads.length === 0
      ? {}
      : { ownerReads: [...new Set(observed.ownerReads)].sort() }),
  });
}

function normalizedCrossOwnerReadDeclaration(
  declaration: CrossOwnerReadDeclaration,
): CrossOwnerReadDeclaration {
  if (!isRecord(declaration)) {
    throw new Error('KV414: crossOwnerRead requires a declaration object (SPEC §10.3).');
  }
  if (optionalOwnDataProperty(declaration, 'role') !== 'admin') {
    throw new Error('KV414: crossOwnerRead requires role: "admin" (SPEC §10.3).');
  }
  const reasonValue = optionalOwnDataProperty(declaration, 'reason');
  if (typeof reasonValue !== 'string') {
    throw new Error('KV414: crossOwnerRead requires a non-empty reason.');
  }
  const reason = trimFrameworkString(reasonValue);
  if (reason === '') throw new Error('KV414: crossOwnerRead requires a non-empty reason.');
  let reads: readonly string[];
  try {
    reads = snapshotTrimmedStringArray(
      optionalOwnDataProperty(declaration, 'reads'),
      'crossOwnerRead declared reads',
    );
  } catch {
    throw new Error('KV414: crossOwnerRead requires a non-empty declared reads table set.');
  }
  if (reads.length === 0) {
    throw new Error('KV414: crossOwnerRead requires a non-empty declared reads table set.');
  }
  const siteValue = optionalOwnDataProperty(declaration, 'site');
  if (siteValue !== undefined && typeof siteValue !== 'string') {
    throw new Error('KV414: crossOwnerRead site must be a string.');
  }
  const site = typeof siteValue === 'string' ? trimFrameworkString(siteValue) : undefined;
  return witnessFreeze({
    reason,
    reads,
    role: 'admin',
    ...(site === undefined || site === '' ? {} : { site }),
  });
}

function assertCrossOwnerReadAllowed(
  observedTable: string,
  declaration: CrossOwnerReadDeclaration,
  policy: CrossOwnerReadPolicyOptions,
): void {
  const observed = policy.normalizeTableName(observedTable);
  const declared = normalizedStringArray(
    declaration.reads,
    policy.normalizeTableName,
    'crossOwnerRead declared tables',
  );
  const optedIn = normalizedStringArray(
    policy.ownerTables,
    policy.normalizeTableName,
    'crossOwnerRead owner tables',
  );
  if (!stringListHas(declared, observed)) {
    throw new Error(
      [
        `KV414: ${policy.dialectLabel} crossOwnerRead observed a table outside the declared reads set (SPEC §10.3).`,
        `  observed: ${observed}`,
        `  declared reads: ${declared.join(', ') || '<none>'}`,
      ].join('\n'),
    );
  }
  if (!stringListHas(optedIn, observed)) {
    throw new Error(
      `KV414: ${policy.dialectLabel} crossOwnerRead table ${observed} is not opted in with kovo_admin_scope (SPEC §10.3).`,
    );
  }
}

function recordCrossOwnerReadAuditFact(
  declaration: CrossOwnerReadDeclaration,
  observedTable: string,
  policy: CrossOwnerReadPolicyOptions,
): void {
  crossOwnerReadAuditFacts.record({
    declaredReads: [...new Set(declaration.reads.map(policy.normalizeTableName))].sort(),
    dialectLabel: policy.dialectLabel,
    observedRead: policy.normalizeTableName(observedTable),
    reason: declaration.reason,
    ...(policy.principal === undefined ? {} : { principal: policy.principal }),
    ...(declaration.site === undefined ? {} : { site: declaration.site }),
  });
}

function rawReadExecutionMethod(
  target: object,
  policy: Pick<RawReadPolicyOptions, 'dialectLabel' | 'executeMethod'>,
): Function {
  // SPEC §10.3/§11.2: rawRead is an audited capability on top of the managed SQL choke, not an
  // escape around it. Retain the managed proxy so non-engine readers receive the statement-shape
  // allowlist and dedicated engine readers receive KV433 error mapping. Unwrapping here previously
  // let rawRead invoke the raw adapter method after all managed SQL policy had been discarded.
  const managedExecutionTarget = frameworkManagedDbRawTarget(target) !== undefined;
  const methods =
    policy.executeMethod === undefined
      ? (['all', 'query', 'execute', 'values'] as const)
      : ([policy.executeMethod] as const);
  for (let index = 0; index < methods.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(methods, index);
    if (descriptor === undefined || !('value' in descriptor)) continue;
    try {
      const method = managedExecutionTarget
        ? witnessReflectGet(target, descriptor.value, target)
        : inheritedFunctionDataProperty(target, descriptor.value);
      if (typeof method !== 'function') continue;
      return (...args: unknown[]) => witnessReflectApply(method, target, args);
    } catch {
      // Keep looking for the next fixed read method.
    }
  }
  throw new KovoReadonlyHandleError(
    `KV410: ${policy.dialectLabel} rawRead could not find an executable read method on the managed DB handle (SPEC §10.2/§10.3).`,
  );
}

/** @internal Options for the framework-owned managed DB handle composition point. */
export interface ManagedDbOptions {
  crossOwnerRead?: CrossOwnerReadPolicyOptions;
  rawRead?: RawReadPolicyOptions;
  sqlWritePolicy?: ManagedSqlWritePolicy;
}

/**
 * Resolve the framework-owned managed handle for a request (SPEC §6.6/§9.4/§10.3). Always applies
 * the KV422 SQL-safe wrap; in `'read'` mode it additionally applies the KV433 read-only proxy. This
 * is the single composition point: one handle = SQL-safe always + read-only in a loader + read-write
 * in an explicit write surface.
 *
 * @param raw - The app's raw resolved db handle (`app.db(request)` value).
 * @param mode - `'read'` for a `query()` loader, `'write'` for mutation/endpoint write surfaces.
 * @internal
 */
export function managedDb<Db>(raw: Db, mode: 'read', options?: ManagedDbOptions): Reader<Db>;
export function managedDb<Db>(raw: Db, mode: 'write', options?: ManagedDbOptions): Writer<Db>;
export function managedDb<Db>(
  raw: Db,
  mode: ManagedDbMode,
  options?: ManagedDbOptions,
): Reader<Db> | Writer<Db>;
export function managedDb<Db>(
  raw: Db,
  mode: ManagedDbMode,
  options: ManagedDbOptions = {},
): Reader<Db> | Writer<Db> {
  const runtimeOptions = snapshotManagedDbOptions(options);
  const readonlyTarget =
    mode === 'read'
      ? resolveReadonlyDbTarget(raw)
      : { fromHook: false, sealedHook: false, target: raw };
  const target =
    mode === 'read'
      ? readonlyTarget.target
      : declaredWriteDbTarget(raw, runtimeOptions.sqlWritePolicy);
  if (mode === 'read' && readonlyTarget.sealedHook) {
    return target as unknown as Reader<Db>;
  }
  if (
    mode === 'read' &&
    isRecord(target) &&
    witnessWeakSetHas(frameworkReadonlyCapabilityHandles, target)
  ) {
    return target as unknown as Reader<Db>;
  }
  const safe = wrapManagedDbForSqlSafety(
    target,
    undefined,
    managedSqlExecutionPolicy({
      ...runtimeOptions.sqlWritePolicy,
      capability: mode,
      engineReadonly: mode === 'read' && target !== raw,
    }),
  );
  if (mode === 'write') return safe as Writer<Db>;
  if (typeof safe !== 'object' || safe === null) return safe as Reader<Db>;
  return readonlyCapabilityDb(
    safe as unknown as object,
    managedReadCapabilityOptions(runtimeOptions),
    readonlyTarget.fromHook,
  ) as unknown as Reader<Db>;
}

function snapshotManagedDbOptions(options: ManagedDbOptions): ManagedDbOptions {
  const snapshot = witnessCreateNullRecord<unknown>() as ManagedDbOptions;
  const crossOwnerRead = optionalOwnDataProperty(options, 'crossOwnerRead');
  const rawRead = optionalOwnDataProperty(options, 'rawRead');
  const sqlWritePolicy = optionalOwnDataProperty(options, 'sqlWritePolicy');
  if (crossOwnerRead !== undefined) {
    snapshot.crossOwnerRead = snapshotCrossOwnerReadPolicy(
      crossOwnerRead as CrossOwnerReadPolicyOptions,
    );
  }
  if (rawRead !== undefined)
    snapshot.rawRead = snapshotRawReadPolicy(rawRead as RawReadPolicyOptions);
  if (sqlWritePolicy !== undefined) {
    if (!isRecord(sqlWritePolicy))
      throw new TypeError('managed SQL write policy must be an object.');
    snapshot.sqlWritePolicy = snapshotManagedWritePolicy(sqlWritePolicy as ManagedSqlWritePolicy);
  }
  return witnessFreeze(snapshot);
}

function readonlyDbTarget<Db>(raw: Db): Db {
  return resolveReadonlyDbTarget(raw).target;
}

function managedReadCapabilityOptions(options: ManagedDbOptions): {
  crossOwnerRead?: CrossOwnerReadPolicyOptions;
  rawRead?: RawReadPolicyOptions;
} {
  const readOptions = witnessCreateNullRecord<unknown>() as {
    crossOwnerRead?: CrossOwnerReadPolicyOptions;
    rawRead?: RawReadPolicyOptions;
  };
  if (options.crossOwnerRead !== undefined) readOptions.crossOwnerRead = options.crossOwnerRead;
  if (options.rawRead !== undefined) readOptions.rawRead = options.rawRead;
  return witnessFreeze(readOptions);
}

function resolveReadonlyDbTarget<Db>(raw: Db): {
  fromHook: boolean;
  sealedHook: boolean;
  target: Db;
} {
  if (!isRecord(raw)) return { fromHook: false, sealedHook: false, target: raw };
  const sealedCreateReadonly = witnessWeakMapGet(authorizationCensusFrameworkHooks, raw)?.readonly;
  const createReadonly =
    sealedCreateReadonly ?? optionalStrictInheritedFunctionDataProperty(raw, kovoReadonlyDbHandle);
  if (createReadonly === undefined) {
    return { fromHook: false, sealedHook: false, target: raw };
  }
  const readTarget = witnessReflectApply<Db>(createReadonly, raw, []);
  if (readTarget === raw) {
    throw new KovoReadonlyHandleError(
      'KV433: adapter read-only DB hook returned the mutable writer handle; managed readers require a dedicated engine read-only handle (SPEC §10.3/§11.2).',
    );
  }
  return { fromHook: true, sealedHook: sealedCreateReadonly !== undefined, target: readTarget };
}

function declaredWriteDbTarget<Db>(raw: Db, writePolicy: ManagedSqlWritePolicy | undefined): Db {
  if (writePolicy === undefined) {
    return raw;
  }
  const registeredCreateDeclaredWrite = frameworkDeclaredWriteHook(raw);
  if (registeredCreateDeclaredWrite !== undefined) {
    return witnessReflectApply<Db>(registeredCreateDeclaredWrite, raw, [writePolicy]);
  }
  const target = frameworkManagedDbRawTarget(raw) ?? raw;
  if (!isRecord(target)) return raw;
  // App dispatch resolves the DB provider before the mutation registry policy is known, so the
  // mutation lifecycle can legitimately hand us an already-managed KV422 proxy. Its sealed
  // adapter hooks belong to the raw runtime handle, not to that outer proxy. Re-check the private
  // hook after unwrapping or the second composition silently skips the governed-write KV438 floor
  // and lets parsed request input reach insert/update/upsert builders (SPEC §10.3/§11.1).
  const targetRegisteredCreateDeclaredWrite = frameworkDeclaredWriteHook(target);
  if (targetRegisteredCreateDeclaredWrite !== undefined) {
    return witnessReflectApply<Db>(targetRegisteredCreateDeclaredWrite, target, [writePolicy]);
  }
  const createDeclaredWrite = optionalStrictInheritedFunctionDataProperty(
    target,
    kovoDeclaredWriteDbHandle,
  );
  if (createDeclaredWrite === undefined) return raw;
  return witnessReflectApply<Db>(createDeclaredWrite, target, [writePolicy]);
}

function frameworkDeclaredWriteHook(
  value: unknown,
): ((policy: ManagedSqlWritePolicy) => unknown) | undefined {
  return isRecord(value)
    ? witnessWeakMapGet(authorizationCensusFrameworkHooks, value)?.declaredWrite
    : undefined;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}
