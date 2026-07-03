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
  frameworkManagedDbRawTarget,
  managedSqlExecutionPolicy,
  wrapManagedDbForSqlSafety,
  type ManagedSqlWritePolicy,
} from './sql-safe-handle.js';
import { securityClassifier } from '@kovojs/core/internal/security-markers';
import { and, eq, sql } from 'drizzle-orm';
import type { SQLWrapper } from 'drizzle-orm';
import { requestInputProvenanceForValue } from './request-input-provenance.js';

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
}

/** Options for a Postgres/PGlite request-scoped transaction client. */
export interface PostgresScopedClientOptions {
  principal?: string | undefined;
  quoteIdentifier?: (value: string) => string;
  readOnly?: boolean;
  role?: string | false;
}

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
  executeMethod?: 'all' | 'execute' | 'query' | 'values';
  normalizeTableName: (table: string) => string;
  ownerTables?: readonly string[];
  sqliteAuthorizer?: DeclaredWriteSqliteAuthorizerOptions;
}

/** Runtime authorization classifications grouped by physical SQLite table. */
export type SqliteAuthorizationClassification =
  | 'authzPolicy'
  | 'owned'
  | 'ownedVia'
  | 'public'
  | 'reference';

/** Direct owner-column source metadata for a physical SQLite table. */
export interface SqliteOwnerSource {
  columnKey: string;
  columnName: string;
  table: string;
}

/** Transitive owner source metadata for an ownerVia-classified SQLite table. */
export interface SqliteOwnerViaSource {
  fkColumnKey: string;
  fkColumnName: string;
  parentKeyColumnKey: string;
  parentKeyColumnName: string;
  parentTable: string;
  table: string;
}

/** Structural subset of `@kovojs/drizzle` runtime metadata consumed by SQLite authz. */
export interface SqliteAuthorizationMetadata {
  authorizationClassificationsByTable?: ReadonlyMap<
    string,
    readonly SqliteAuthorizationClassification[]
  >;
  ownerSourcesByTable?: ReadonlyMap<string, SqliteOwnerSource>;
  ownerViaSourcesByTable?: ReadonlyMap<string, SqliteOwnerViaSource>;
}

/** Options for the framework-owned SQLite predicate-binding authorization wrapper. */
export interface SqliteAuthorizationDbOptions {
  metadata: SqliteAuthorizationMetadata;
  principal?: string;
}

interface SqliteAuthorizationApplyState {
  appliedWhere: SQLWrapper | undefined;
  sourceWhere: SQLWrapper | undefined;
}

const READ_CAPABILITY_PROPERTIES = new Set<string>([
  '$count',
  '$with',
  'query',
  'rawRead',
  'select',
  'selectDistinct',
  'with',
]);
const DENIED_READ_CAPABILITY_PROPERTIES = new Set<string>([
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
]);
const CALLABLE_READ_CAPABILITY_PROPERTIES = new Set<string>([
  '$count',
  '$with',
  'rawRead',
  'select',
  'selectDistinct',
  'with',
]);
const SQLITE_AUTHZ_DIRECT_SQL_METHODS = new Set<PropertyKey>([
  'all',
  'execute',
  'get',
  'prepare',
  'query',
  'run',
  'sql',
  'values',
]);
const SQLITE_AUTHZ_TERMINALS = new Set<PropertyKey>([
  'all',
  'execute',
  'get',
  'run',
  'then',
  'toSQL',
  'values',
]);
const DRIZZLE_NAME_SYMBOL = Symbol.for('drizzle:Name');
const DRIZZLE_ORIGINAL_NAME_SYMBOL = Symbol.for('drizzle:OriginalName');
const DRIZZLE_BASE_NAME_SYMBOL = Symbol.for('drizzle:BaseName');

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
    return new Proxy(db as Record<PropertyKey, unknown>, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (isDeclaredWriteDirectSqlMethod(prop, options) && typeof value === 'function') {
          return (statement: unknown, ...args: unknown[]) => {
            assertSqliteDeclaredWriteStatementAllowed(statement, args, policy, options);
            return Reflect.apply(value, target, [statement, ...args]);
          };
        }
        if (isDeclaredWriteDrizzleMethod(prop) && typeof value === 'function') {
          return (table: unknown, ...args: unknown[]) => {
            const tableNames = options.tableNames(table);
            assertDeclaredWriteTablesAllowed(tableNames, policy, options);
            const builder = Reflect.apply(value, target, [table, ...args]);
            return prop === 'delete'
              ? builder
              : declaredWriteBuilder(builder, prop, tableNames, options);
          };
        }
        if (prop === 'transaction' && typeof value === 'function') {
          return (callback: (tx: unknown) => unknown, ...args: unknown[]) =>
            Reflect.apply(value, target, [
              (tx: unknown) => callback(createDeclaredWriteDb(tx as object, policy, options)),
              ...args,
            ]);
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as Db;
  },
);

/**
 * Create a SQLite Drizzle handle that binds Kovo owner/ownerVia predicates at runtime.
 *
 * SQLite has no storage-engine RLS, so the framework-owned managed handle is the DEC-A choke:
 * owned reads/writes are scoped to the proven owner principal, unclassified reachable tables deny
 * at runtime, and shapes the wrapper cannot safely introspect fail closed (SPEC §10.3/§11.2).
 */
export const createSqliteAuthorizationDb = securityClassifier(
  'server.managed-db.sqlite-authorization-db',
  function <Db extends object>(db: Db, options: SqliteAuthorizationDbOptions): Db {
    const applyStates = new WeakMap<object, SqliteAuthorizationApplyState>();
    return sqliteAuthorizationProxy(db, options, applyStates, undefined) as Db;
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
    const scopedOptions: PostgresScopedClientOptions = { readOnly: true };
    if (options.principal !== undefined) scopedOptions.principal = options.principal;
    if (options.quoteIdentifier !== undefined)
      scopedOptions.quoteIdentifier = options.quoteIdentifier;
    if (options.readerRole !== undefined) scopedOptions.role = options.readerRole;
    return createPostgresScopedClient(client, scopedOptions);
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
    return new Proxy(client as Record<PropertyKey, unknown>, {
      get(target, prop, receiver) {
        if (prop === 'query') return scopedPostgresQuery.bind(undefined, target, options);
        if (prop === 'exec') return scopedPostgresExec.bind(undefined, options);
        return Reflect.get(target, prop, receiver);
      },
    }) as Client;
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

const assertDeclaredWriteTablesAllowed = securityClassifier(
  'server.managed-db.declared-write-tables',
  function (
    tableNames: readonly string[],
    policy: ManagedSqlWritePolicy,
    options: DeclaredWriteDbOptions,
  ): void {
    const allowed = new Set((policy.tables ?? []).map(options.normalizeTableName));
    const normalized = tableNames.map(options.normalizeTableName);
    if (normalized.some((table) => allowed.has(table))) return;

    throw new Error(
      [
        `KV406: ${options.dialectLabel} declared-write wrapper rejected table ${tableNames[0] ?? '<unknown>'} outside the mutation registry tables (SPEC §10.3/§11.2).`,
        `  declared tables: ${[...new Set(policy.tables ?? [])].sort().join(', ') || '<none>'}`,
        `  touches: ${[...new Set(policy.touches ?? [])].sort().join(', ') || '<none>'}`,
      ].join('\n'),
    );
  },
);

const assertSqliteDeclaredWriteStatementAllowed = securityClassifier(
  'server.managed-db.sqlite-declared-write-authorizer',
  function (
    statement: unknown,
    params: readonly unknown[],
    policy: ManagedSqlWritePolicy,
    options: DeclaredWriteDbOptions,
  ): void {
    const carrier = sqlCarrierFromValue(statement, params);
    const sqliteAuthorizer = options.sqliteAuthorizer;
    if (carrier === undefined || sqliteAuthorizer === undefined) {
      throw new Error(
        'KV406: SQLite declared-write authorizer could not resolve executable SQL text (SPEC §10.3/§11.2).',
      );
    }

    const sqlite = sqliteAuthorizer.openDatabase();
    try {
      sqlite.setAuthorizer((action, objectName, _columnName, databaseName, triggerOrView) => {
        if (isSqliteDdlAction(action, sqliteAuthorizer.constants)) {
          return sqliteAuthorizer.constants.SQLITE_DENY;
        }
        if (!isSqliteWriteAction(action, sqliteAuthorizer.constants)) {
          return sqliteAuthorizer.constants.SQLITE_OK;
        }

        const table = `${databaseName ?? 'main'}.${objectName ?? '<unknown>'}`;
        const allowed = new Set((policy.tables ?? []).map(options.normalizeTableName));
        if (allowed.has(table)) return sqliteAuthorizer.constants.SQLITE_OK;
        if (
          triggerOrView === null &&
          (objectName === 'sqlite_sequence' || objectName === 'sqlite_stat1')
        ) {
          return sqliteAuthorizer.constants.SQLITE_OK;
        }
        return sqliteAuthorizer.constants.SQLITE_DENY;
      });
      sqlite.prepare(carrier.text);
    } catch (error) {
      if (error instanceof Error && /not authorized/i.test(error.message)) {
        throw new Error(
          [
            'KV406: SQLite authorizer rejected a declared-write statement outside the mutation registry tables (SPEC §10.3/§11.2).',
            `  declared tables: ${[...new Set(policy.tables ?? [])].sort().join(', ') || '<none>'}`,
            `  touches: ${[...new Set(policy.touches ?? [])].sort().join(', ') || '<none>'}`,
          ].join('\n'),
        );
      }
      throw error;
    } finally {
      sqlite.close();
    }
  },
);

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

const publicReadAuditFacts: PublicReadAuditFact[] = [];

/**
 * Declare an audited public-read authorization scope (SPEC §10.3 DEC-F). This does not assert SQL
 * injection safety (`trustedSql`) or secret disclosure authority (`reveal`); it only records the
 * intentional row/column authorization posture for a read.
 */
export function declarePublicRead(options: PublicReadDeclaration): PublicReadDeclaration {
  const normalized = normalizedPublicReadDeclaration(options);
  return Object.freeze({
    ...normalized,
    ...(normalized.columns ? { columns: Object.freeze([...normalized.columns]) } : {}),
    ...(isPublicReadRowsScope(normalized.rows)
      ? { rows: Object.freeze({ ...normalized.rows }) }
      : {}),
  });
}

/**
 * Drain recorded public-read authorization audit facts for `kovo explain`/tests. Returns and clears
 * the facts accumulated since the last drain.
 */
export function drainPublicReadAuditFacts(): PublicReadAuditFact[] {
  return publicReadAuditFacts.splice(0, publicReadAuditFacts.length);
}

function isDeclaredWriteDrizzleMethod(prop: PropertyKey): prop is 'delete' | 'insert' | 'update' {
  return prop === 'delete' || prop === 'insert' || prop === 'update';
}

function declaredWriteBuilder(
  builder: unknown,
  verb: 'insert' | 'update',
  tableNames: readonly string[],
  options: DeclaredWriteDbOptions,
): unknown {
  if (!isRecord(builder)) return builder;
  return new Proxy(builder, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
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
            Reflect.apply(value, target, [payload, ...args]),
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
            Reflect.apply(value, target, [payload, ...args]),
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
            Reflect.apply(value, target, [config, ...args]),
            verb,
            tableNames,
            options,
          );
        };
      }
      return (...args: unknown[]) =>
        wrapDeclaredWriteBuilderResult(
          Reflect.apply(value, target, args),
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
    typeof result.values === 'function' ||
    typeof result.set === 'function' ||
    typeof result.onConflictDoUpdate === 'function'
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
  if (governed.size === 0) return;
  if (Array.isArray(payload)) {
    for (const row of payload) assertGovernedWriteObjectAllowed(row, governed, context);
    return;
  }
  assertGovernedWriteObjectAllowed(payload, governed, context);
}

function assertGovernedWriteObjectAllowed(
  payload: unknown,
  governed: ReadonlySet<string>,
  context: GovernedWritePayloadContext,
): void {
  if (!isRecord(payload)) return;
  for (const key of Reflect.ownKeys(payload)) {
    if (typeof key !== 'string' || !governed.has(key)) continue;
    const value = Reflect.get(payload, key);
    const provenance = requestInputProvenanceForValue(value);
    if (provenance === undefined) continue;
    throw new Error(
      [
        `KV438: ${context.options.dialectLabel} managed write rejected parsed request input ${provenance.path} for governed column ${key} in ${context.verb}.${context.boundary} (SPEC §11.1).`,
        '  Use a server-derived value or the audited adminAssign(...) escape for intentional privileged assignment.',
      ].join('\n'),
    );
  }
}

function governedWriteColumnsForTables(
  tableNames: readonly string[],
  options: DeclaredWriteDbOptions,
): ReadonlySet<string> {
  const metadata = options.governedColumns;
  if (metadata === undefined) return new Set();
  const normalizedTargets = new Set(tableNames.map(options.normalizeTableName));
  const governed = new Set<string>();
  for (const [table, columns] of metadata.governedColumnKeysByTable) {
    if (!normalizedTargets.has(options.normalizeTableName(table))) continue;
    for (const column of columns) governed.add(column);
  }
  for (const [table, columns] of metadata.governedColumnNamesByTable) {
    if (!normalizedTargets.has(options.normalizeTableName(table))) continue;
    for (const column of columns) governed.add(column);
  }
  return governed;
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

function sqliteAuthorizationProxy(
  value: unknown,
  options: SqliteAuthorizationDbOptions,
  applyStates: WeakMap<object, SqliteAuthorizationApplyState>,
  builderMode: 'delete' | 'insert' | 'select' | 'update' | undefined,
): unknown {
  if (!isRecord(value)) return value;
  return new Proxy(value, {
    get(target, prop, receiver) {
      if (prop === 'then') {
        applySqliteAuthorizationToBuilder(target, options, applyStates, builderMode);
      }
      const item = Reflect.get(target, prop, receiver);
      if (typeof item !== 'function') return item;
      const isBuilder = isRecord((target as { config?: unknown }).config);
      if (builderMode === undefined && !isBuilder && SQLITE_AUTHZ_DIRECT_SQL_METHODS.has(prop)) {
        return (...args: unknown[]) => {
          assertSqliteAuthorizationDirectSqlAllowed(args[0], options);
          return Reflect.apply(item, target, args);
        };
      }
      if (SQLITE_AUTHZ_TERMINALS.has(prop)) {
        return (...args: unknown[]) => {
          applySqliteAuthorizationToBuilder(target, options, applyStates, builderMode);
          const result = Reflect.apply(item, target, args);
          if (builderMode === 'insert' && prop === 'values' && isRecord(result)) {
            applySqliteAuthorizationToBuilder(result, options, applyStates, builderMode);
            return sqliteAuthorizationProxy(result, options, applyStates, builderMode);
          }
          return result;
        };
      }
      if (prop === 'select' || prop === 'selectDistinct') {
        return (...args: unknown[]) =>
          sqliteAuthorizationProxy(
            Reflect.apply(item, target, args),
            options,
            applyStates,
            'select',
          );
      }
      if (prop === 'update' || prop === 'delete' || prop === 'insert') {
        return (...args: unknown[]) =>
          sqliteAuthorizationProxy(Reflect.apply(item, target, args), options, applyStates, prop);
      }
      return (...args: unknown[]) => {
        const result = Reflect.apply(item, target, args);
        return sqliteAuthorizationProxy(result, options, applyStates, builderMode);
      };
    },
  });
}

function applySqliteAuthorizationToBuilder(
  builder: object,
  options: SqliteAuthorizationDbOptions,
  applyStates: WeakMap<object, SqliteAuthorizationApplyState>,
  builderMode: 'delete' | 'insert' | 'select' | 'update' | undefined,
): void {
  const config = (builder as { config?: unknown }).config;
  if (!isRecord(config)) return;
  if (builderMode === 'insert') {
    assertSqliteInsertIsOwnerCheckable(config, options);
    return;
  }
  if (builderMode === 'update') assertSqliteUpdateDoesNotReassignOwner(config, options);
  const predicates = sqliteAuthorizationPredicatesForConfig(config, options);
  if (predicates.length === 0) {
    applySqliteAuthorizationToSetOperatorArms(config, options, applyStates);
    return;
  }

  const sourceWhere = (
    applyStates.get(config)?.appliedWhere === config.where
      ? applyStates.get(config)?.sourceWhere
      : config.where
  ) as SQLWrapper | undefined;
  const nextWhere = and(...[sourceWhere, ...predicates].filter(Boolean));
  config.where = nextWhere;
  applyStates.set(config, { appliedWhere: nextWhere, sourceWhere });
  applySqliteAuthorizationToSetOperatorArms(config, options, applyStates);
}

function sqliteAuthorizationPredicatesForConfig(
  config: Record<PropertyKey, unknown>,
  options: SqliteAuthorizationDbOptions,
): SQLWrapper[] {
  const predicates: SQLWrapper[] = [];
  const seenSelects = new WeakSet<object>();
  collectSqliteAuthorizationPredicatesForSelectConfig(config, options, predicates, seenSelects);
  return predicates;
}

function collectSqliteAuthorizationPredicatesForSelectConfig(
  config: Record<PropertyKey, unknown>,
  options: SqliteAuthorizationDbOptions,
  predicates: SQLWrapper[],
  seenSelects: WeakSet<object>,
): void {
  if (seenSelects.has(config)) return;
  seenSelects.add(config);
  collectSqliteAuthorizationPredicateForTable(config.table, options, predicates, 'where');
  const joins = config.joins;
  if (Array.isArray(joins)) {
    for (const join of joins) {
      collectSqliteAuthorizationPredicateForTable(
        (join as { table?: unknown }).table,
        options,
        predicates,
        'where',
      );
    }
  }
  const setOperators = config.setOperators;
  if (
    Array.isArray(setOperators) &&
    setOperators.some(
      (operator) =>
        !isRecord((operator as { rightSelect?: { config?: unknown } }).rightSelect?.config),
    )
  ) {
    predicates.push(sql`1 = 0`);
  }
}

function applySqliteAuthorizationToSetOperatorArms(
  config: Record<PropertyKey, unknown>,
  options: SqliteAuthorizationDbOptions,
  applyStates: WeakMap<object, SqliteAuthorizationApplyState>,
): void {
  const setOperators = config.setOperators;
  if (!Array.isArray(setOperators)) return;
  for (const operator of setOperators) {
    const rightSelect = (operator as { rightSelect?: unknown }).rightSelect;
    if (isRecord(rightSelect)) {
      applySqliteAuthorizationToBuilder(rightSelect, options, applyStates, 'select');
    }
  }
}

function collectSqliteAuthorizationPredicateForTable(
  table: unknown,
  options: SqliteAuthorizationDbOptions,
  predicates: SQLWrapper[],
  scope: 'direct' | 'where',
): void {
  if (table === undefined || table === null) return;
  const tableName = sqlitePhysicalTableName(table);
  if (tableName === undefined) {
    if (sqliteSubqueryUsesDeniedTable(table, options)) predicates.push(sql`1 = 0`);
    return;
  }
  const predicate = sqliteAuthorizationPredicateForTable(table, tableName, options, scope);
  if (predicate !== undefined) predicates.push(predicate);
}

function sqliteAuthorizationPredicateForTable(
  table: unknown,
  tableName: string,
  options: SqliteAuthorizationDbOptions,
  scope: 'direct' | 'where',
): SQLWrapper | undefined {
  const classifications = options.metadata.authorizationClassificationsByTable?.get(tableName);
  if (classifications === undefined || classifications.length === 0) return sql`1 = 0`;
  if (classifications.includes('public') || classifications.includes('reference')) return undefined;
  if (classifications.includes('authzPolicy')) return sql`1 = 0`;

  const owner = options.metadata.ownerSourcesByTable?.get(tableName);
  if (owner !== undefined) {
    const column = sqliteColumnForKey(table, owner.columnKey, owner.columnName);
    if (column === undefined || options.principal === undefined) return sql`1 = 0`;
    return eq(column as Parameters<typeof eq>[0], options.principal);
  }

  const ownerVia = options.metadata.ownerViaSourcesByTable?.get(tableName);
  if (ownerVia !== undefined) {
    const fkColumn = sqliteColumnForKey(table, ownerVia.fkColumnKey, ownerVia.fkColumnName);
    const parentOwner = options.metadata.ownerSourcesByTable?.get(ownerVia.parentTable);
    if (fkColumn === undefined || parentOwner === undefined || options.principal === undefined) {
      return sql`1 = 0`;
    }
    return sql`${fkColumn} in (select ${sql.raw(quoteSqlIdentifier(ownerVia.parentKeyColumnName))} from ${sql.raw(quoteSqlIdentifier(ownerVia.parentTable))} where ${sql.raw(quoteSqlIdentifier(parentOwner.columnName))} = ${options.principal})`;
  }

  return scope === 'where' ? sql`1 = 0` : undefined;
}

function sqliteSubqueryUsesDeniedTable(
  table: unknown,
  options: SqliteAuthorizationDbOptions,
): boolean {
  const usedTables = (table as { _?: { usedTables?: unknown } })?._?.usedTables;
  if (!Array.isArray(usedTables)) return true;
  return usedTables.some((entry) => {
    if (typeof entry !== 'string') return true;
    const classifications = options.metadata.authorizationClassificationsByTable?.get(entry);
    return (
      classifications === undefined ||
      classifications.includes('owned') ||
      classifications.includes('ownedVia') ||
      classifications.includes('authzPolicy')
    );
  });
}

function assertSqliteInsertIsOwnerCheckable(
  config: Record<PropertyKey, unknown>,
  options: SqliteAuthorizationDbOptions,
): void {
  const tableName = sqlitePhysicalTableName(config.table);
  if (tableName === undefined) return;
  const classifications = options.metadata.authorizationClassificationsByTable?.get(tableName);
  if (
    classifications?.includes('owned') !== true &&
    classifications?.includes('ownedVia') !== true
  ) {
    if (classifications === undefined || classifications.length === 0) throwSqliteAuthzDeny();
    return;
  }
  throw new Error(
    'KV414: SQLite managed insert into an owner-scoped table requires owner-checkable framework proof (SPEC §10.3).',
  );
}

function assertSqliteUpdateDoesNotReassignOwner(
  config: Record<PropertyKey, unknown>,
  options: SqliteAuthorizationDbOptions,
): void {
  const tableName = sqlitePhysicalTableName(config.table);
  if (tableName === undefined) return;
  const owner = options.metadata.ownerSourcesByTable?.get(tableName);
  if (owner === undefined || !isRecord(config.set)) return;
  if (owner.columnKey in config.set || owner.columnName in config.set) {
    throw new Error(
      'KV414: SQLite managed update cannot reassign an owner column through an owner-scoped write (SPEC §10.3).',
    );
  }
}

function assertSqliteAuthorizationDirectSqlAllowed(
  statement: unknown,
  options: SqliteAuthorizationDbOptions,
): void {
  const sqlText = sqlTextFromValue(statement);
  if (sqlText === undefined) return;
  for (const table of sqliteAuthzDeniedRawTables(options)) {
    if (sqlTextReferencesTable(sqlText, table)) throwSqliteAuthzDeny();
  }
}

function sqliteAuthzDeniedRawTables(options: SqliteAuthorizationDbOptions): string[] {
  const tables = new Set<string>();
  for (const [table, classifications] of options.metadata.authorizationClassificationsByTable ??
    []) {
    if (
      classifications.length === 0 ||
      classifications.includes('owned') ||
      classifications.includes('ownedVia') ||
      classifications.includes('authzPolicy')
    ) {
      tables.add(table);
    }
  }
  for (const table of options.metadata.ownerSourcesByTable?.keys() ?? []) tables.add(table);
  for (const table of options.metadata.ownerViaSourcesByTable?.keys() ?? []) tables.add(table);
  return [...tables];
}

function sqlitePhysicalTableName(table: unknown): string | undefined {
  if (!isRecord(table)) return undefined;
  const original = table[DRIZZLE_ORIGINAL_NAME_SYMBOL];
  if (typeof original === 'string' && original !== '') return original;
  const base = table[DRIZZLE_BASE_NAME_SYMBOL];
  if (typeof base === 'string' && base !== '') return base;
  const name = table[DRIZZLE_NAME_SYMBOL];
  return typeof name === 'string' && name !== '' ? name : undefined;
}

function sqliteColumnForKey(table: unknown, key: string, columnName: string): object | undefined {
  if (!isRecord(table)) return undefined;
  const byKey = table[key];
  if (isColumnLike(byKey)) return byKey;
  for (const value of Object.values(table)) {
    if (isColumnLike(value) && value.name === columnName) return value;
  }
  return undefined;
}

function sqlTextReferencesTable(sqlText: string, table: string): boolean {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9_])"?${escaped}"?(?:$|[^A-Za-z0-9_])`, 'iu').test(sqlText);
}

function throwSqliteAuthzDeny(): never {
  throw new Error(
    'KV414: SQLite managed authorization denied an owner-scoped or unclassified table access (SPEC §10.3).',
  );
}

function sqlCarrierFromValue(value: unknown, params: readonly unknown[]): SqlCarrier | undefined {
  if (typeof value === 'string') return { params, text: value };
  const toSQL = (value as { toSQL?: unknown }).toSQL;
  if (typeof toSQL === 'function') {
    try {
      const result = toSQL.call(value) as { params?: unknown; sql?: unknown };
      if (typeof result?.sql === 'string') {
        return { params: Array.isArray(result.params) ? result.params : params, text: result.sql };
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
  const sql = (value as { sql?: unknown }).sql;
  if (typeof sql === 'string') return sql;
  const chunks = (value as { queryChunks?: unknown }).queryChunks;
  if (!Array.isArray(chunks)) return undefined;
  const text = chunks
    .flatMap((chunk) => {
      const part = (chunk as { value?: unknown }).value;
      return Array.isArray(part)
        ? part.filter((item): item is string => typeof item === 'string')
        : [];
    })
    .join('');
  return text || undefined;
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
  query(query: string, params?: unknown[], queryOptions?: unknown): unknown;
  transaction<Result>(
    callback: (tx: PostgresTransactionClient) => Promise<Result>,
  ): Promise<Result>;
};

function scopedPostgresQuery(
  client: Record<PropertyKey, unknown>,
  options: PostgresScopedClientOptions,
  query: string,
  params?: unknown[],
  queryOptions?: unknown,
): Promise<unknown> {
  return postgresTransaction(client, async (tx) => {
    await runPostgresTransactionControl(tx, options);
    const queryMethod = tx.query.bind(tx);
    return queryMethod(query, params, queryOptions) as Promise<unknown>;
  });
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
  callback: (tx: PostgresTransactionClient) => Promise<Result>,
): Promise<Result> {
  const transaction = client.transaction;
  if (typeof transaction !== 'function') {
    throw new KovoReadonlyHandleError(
      'KV433: Postgres read-only client requires a transaction-capable driver handle (SPEC §10.3/§11.2).',
    );
  }
  return Reflect.apply(transaction, client, [callback]) as Promise<Result>;
}

async function runPostgresTransactionControl(
  tx: PostgresTransactionClient,
  options: PostgresScopedClientOptions,
): Promise<void> {
  const exec = tx.exec.bind(tx);
  const query = tx.query.bind(tx);
  if (options.readOnly === true) await (exec('SET TRANSACTION READ ONLY') as Promise<unknown>);
  if (options.principal !== undefined) {
    await (query("SELECT set_config('kovo.principal', $1, true)", [
      options.principal,
    ]) as Promise<unknown>);
  }
  if (options.role !== false && options.role !== undefined) {
    const quote = options.quoteIdentifier ?? quoteSqlIdentifier;
    await (exec(`SET LOCAL ROLE ${quote(options.role)}`) as Promise<unknown>);
  }
}

function quoteSqlIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
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
  options: { rawRead?: RawReadPolicyOptions } = {},
): Reader<Db> {
  const readDb = readonlyDbTarget(db);
  const safe = wrapManagedDbForSqlSafety(
    readDb,
    undefined,
    managedSqlExecutionPolicy({
      capability: 'read',
      engineReadonly: readDb !== db,
    }),
  );
  return readonlyCapabilityDb(safe as object, options.rawRead) as unknown as Reader<Db>;
}

function readonlyCapabilityDb<Db extends object>(
  db: Db,
  rawReadPolicy: RawReadPolicyOptions | undefined,
): Reader<Db> {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'then') return undefined;
      if (typeof prop === 'string') {
        if (DENIED_READ_CAPABILITY_PROPERTIES.has(prop)) return readonlyCapabilityError(prop);
        if (!READ_CAPABILITY_PROPERTIES.has(prop)) return readonlyCapabilityError(prop);
        if (prop === 'rawRead') return rawReadCapability(target, rawReadPolicy);
        const value = Reflect.get(target, prop, receiver);
        if (prop === 'query') {
          if (typeof value === 'function') return readonlyCapabilityError(prop);
          return value;
        }
        if (!CALLABLE_READ_CAPABILITY_PROPERTIES.has(prop)) {
          return readonlyCapabilityError(prop);
        }
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Reader<Db>;
}

function readonlyCapabilityError(prop: string): () => never {
  return () => {
    throw new KovoReadonlyHandleError(
      `KV433: framework read-only DB capability proxy blocked db.${prop} in a query() loader. Move writes to a mutation(), domain write, or endpoint().`,
    );
  };
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
    assertRawReadDeclaration(declaration);
    const carrier = sqlCarrierFromValue(statement, []);
    if (carrier === undefined) {
      throw new Error(
        'KV410: rawRead requires a SQL statement whose table set can be checked against the declared reads (SPEC §10.2/§10.3).',
      );
    }
    assertRawReadObservedTablesAllowed(carrier.text, declaration, policy);
    const method = rawReadExecutionMethod(target, policy);
    return method.call(target, statement) as Promise<Row[]> | Row[];
  };
}

function assertRawReadDeclaration(declaration: RawReadDeclaration): void {
  if (
    !Array.isArray(declaration.reads) ||
    declaration.reads.length === 0 ||
    declaration.reads.some((table) => typeof table !== 'string' || table.trim() === '')
  ) {
    throw new Error('KV410: rawRead requires a non-empty declared reads table set.');
  }
  if (declaration.actAs !== undefined && declaration.actAs.trim() === '') {
    throw new Error('KV414: rawRead actAs scope requires a non-empty principal.');
  }
  if (declaration.declarePublicRead !== undefined)
    normalizedPublicReadDeclaration(declaration.declarePublicRead);
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

  const observed = new Set<string>();
  const sqlite = sqliteAuthorizer.openDatabase();
  try {
    sqlite.setAuthorizer((action, objectName, _columnName, databaseName) => {
      if (action === readAction && objectName !== null) {
        observed.add(policy.normalizeTableName(`${databaseName ?? 'main'}.${objectName}`));
      }
      return sqliteAuthorizer.constants.SQLITE_OK;
    });
    sqlite.prepare(sql);
  } finally {
    sqlite.close();
  }

  const declared = new Set(declaration.reads.map(policy.normalizeTableName));
  const unexpected = [...observed].filter((table) => !declared.has(table));
  if (unexpected.length > 0) {
    throw new Error(
      [
        `KV410: ${policy.dialectLabel} rawRead observed table(s) outside the declared reads set (SPEC §10.2/§10.3).`,
        `  observed: ${[...observed].sort().join(', ') || '<none>'}`,
        `  declared reads: ${[...declared].sort().join(', ') || '<none>'}`,
      ].join('\n'),
    );
  }

  const ownerTables = new Set((policy.ownerTables ?? []).map(policy.normalizeTableName));
  const scoped = declaration.actAs !== undefined || publicRead !== undefined;
  const ownerReads = [...observed].filter((table) => ownerTables.has(table));
  if (!scoped && ownerReads.length > 0) {
    throw new Error(
      [
        `KV414: ${policy.dialectLabel} rawRead of owner-scoped table(s) requires actAs or declarePublicRead scope (SPEC §10.3).`,
        `  owner tables: ${[...new Set(ownerReads)].sort().join(', ')}`,
      ].join('\n'),
    );
  }
  if (publicRead !== undefined) {
    recordPublicReadAuditFact(publicRead, declaration, policy, {
      observedReads: [...observed],
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
  const reason = options.reason;
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new Error('KV414: rawRead declarePublicRead scope requires a non-empty reason.');
  }

  const normalized: PublicReadDeclaration = { reason: reason.trim() };
  if (options.rows !== undefined) normalized.rows = normalizedPublicReadRows(options.rows);
  if (options.columns !== undefined) {
    normalized.columns = normalizedPublicReadColumns(options.columns);
  }
  return normalized;
}

function normalizedPublicReadRows(
  rows: PublicReadDeclaration['rows'],
): PublicReadRowsScope | string {
  if (typeof rows === 'string') {
    const predicate = rows.trim();
    if (predicate === '') {
      throw new Error(
        'KV414: rawRead declarePublicRead rows scope requires a non-empty predicate.',
      );
    }
    return predicate;
  }
  if (!isPublicReadRowsScope(rows)) {
    throw new Error(
      'KV414: rawRead declarePublicRead rows scope requires a predicate string or { predicate, table? }.',
    );
  }
  const predicate = rows.predicate.trim();
  if (predicate === '') {
    throw new Error('KV414: rawRead declarePublicRead rows scope requires a non-empty predicate.');
  }
  const table = rows.table?.trim();
  return table === undefined || table === '' ? { predicate } : { predicate, table };
}

function normalizedPublicReadColumns(columns: readonly string[]): readonly string[] {
  if (
    !Array.isArray(columns) ||
    columns.length === 0 ||
    columns.some((column) => typeof column !== 'string' || column.trim() === '')
  ) {
    throw new Error(
      'KV414: rawRead declarePublicRead columns scope requires a non-empty column list.',
    );
  }
  return [...new Set(columns.map((column) => column.trim()))];
}

function recordPublicReadAuditFact(
  publicRead: PublicReadDeclaration,
  declaration: RawReadDeclaration,
  policy: RawReadPolicyOptions,
  observed: { observedReads?: readonly string[]; ownerReads?: readonly string[] } = {},
): void {
  publicReadAuditFacts.push({
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

function isPublicReadRowsScope(value: unknown): value is PublicReadRowsScope {
  return (
    isRecord(value) &&
    typeof value.predicate === 'string' &&
    (value.table === undefined || typeof value.table === 'string')
  );
}

function rawReadExecutionMethod(target: object, policy: RawReadPolicyOptions): Function {
  const methods =
    policy.executeMethod === undefined
      ? (['all', 'query', 'execute', 'values'] as const)
      : ([policy.executeMethod] as const);
  for (const method of methods) {
    const value = Reflect.get(target, method);
    if (typeof value === 'function') return value;
  }
  throw new KovoReadonlyHandleError(
    `KV410: ${policy.dialectLabel} rawRead could not find an executable read method on the managed DB handle (SPEC §10.2/§10.3).`,
  );
}

/** @internal Options for the framework-owned managed DB handle composition point. */
export interface ManagedDbOptions {
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
  const target =
    mode === 'read' ? readonlyDbTarget(raw) : declaredWriteDbTarget(raw, options.sqlWritePolicy);
  const safe = wrapManagedDbForSqlSafety(
    target,
    undefined,
    managedSqlExecutionPolicy({
      ...options.sqlWritePolicy,
      capability: mode,
      engineReadonly: mode === 'read' && target !== raw,
    }),
  );
  if (mode === 'write') return safe as Writer<Db>;
  if (typeof safe !== 'object' || safe === null) return safe as Reader<Db>;
  return readonlyCapabilityDb(safe as unknown as object, options.rawRead) as unknown as Reader<Db>;
}

function readonlyDbTarget<Db>(raw: Db): Db {
  if (!isRecord(raw)) return raw;
  const createReadonly = raw[kovoReadonlyDbHandle];
  if (typeof createReadonly !== 'function') return raw;
  const readTarget = createReadonly.call(raw) as Db;
  if (readTarget === raw) {
    throw new KovoReadonlyHandleError(
      'KV433: adapter read-only DB hook returned the mutable writer handle; managed readers require a dedicated engine read-only handle (SPEC §10.3/§11.2).',
    );
  }
  return readTarget;
}

function declaredWriteDbTarget<Db>(raw: Db, writePolicy: ManagedSqlWritePolicy | undefined): Db {
  if (writePolicy === undefined) {
    return raw;
  }
  const target = frameworkManagedDbRawTarget(raw) ?? raw;
  if (!isRecord(target)) return raw;
  const createDeclaredWrite = target[kovoDeclaredWriteDbHandle];
  if (typeof createDeclaredWrite !== 'function') return raw;
  return createDeclaredWrite.call(target, writePolicy) as Db;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

function isColumnLike(value: unknown): value is { name: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string'
  );
}
