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
import { snapshotManagedSqlStatement } from '@kovojs/core/internal/sql-safety';
import { securityClassifier } from '@kovojs/core/internal/security-markers';
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

const READ_CAPABILITY_PROPERTIES = new Set<string>([
  '$count',
  '$with',
  'crossOwnerRead',
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
  'crossOwnerRead',
  'rawRead',
  'select',
  'selectDistinct',
  'with',
]);

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
 * Create a Drizzle handle that denies access to schema tables with no DEC-K authorization
 * classification. This is the managed-handle runtime floor for the authorization census
 * (SPEC §10.3 / DEC-K): the wrapper decides only from framework-owned schema metadata and table
 * objects passed through builder APIs, avoiding SQL text heuristics and avoiding unknown
 * framework/internal driver tables.
 */
export const createAuthorizationCensusDb = securityClassifier(
  'server.managed-db.authorization-census-db',
  function <Db extends object>(db: Db, options: AuthorizationCensusDbOptions): Db {
    return authorizationCensusProxy(db, options, undefined) as Db;
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
    if (options.roleSetting !== undefined) scopedOptions.roleSetting = options.roleSetting;
    if (options.rlsDiagnostics !== undefined) scopedOptions.rlsDiagnostics = options.rlsDiagnostics;
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
        if (prop === 'transaction') return scopedPostgresTransaction(target, options, receiver);
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
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

const publicReadAuditFacts: PublicReadAuditFact[] = [];
const crossOwnerReadAuditFacts: CrossOwnerReadAuditFact[] = [];
const postgresRlsSilentDenyDiagnostics: PostgresRlsSilentDenyDiagnostic[] = [];

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

/**
 * Drain recorded cross-owner read audit facts for `kovo explain`/tests. Returns and clears the
 * facts accumulated since the last drain.
 */
export function drainCrossOwnerReadAuditFacts(): CrossOwnerReadAuditFact[] {
  return crossOwnerReadAuditFacts.splice(0, crossOwnerReadAuditFacts.length);
}

/**
 * Drain dev-only Postgres RLS empty-read diagnostics. Returns and clears facts accumulated since
 * the last drain; production scoped clients never write to this sink.
 */
export function drainPostgresRlsSilentDenyDiagnostics(): PostgresRlsSilentDenyDiagnostic[] {
  return postgresRlsSilentDenyDiagnostics.splice(0, postgresRlsSilentDenyDiagnostics.length);
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
  return new Proxy(value, {
    get(target, prop, receiver) {
      const item = Reflect.get(target, prop, receiver);
      if (typeof item !== 'function') return item;
      if (isDeclaredWriteDrizzleMethod(prop)) {
        return (table: unknown, ...args: unknown[]) => {
          assertAuthorizationCensusTablesAllowed(options.tableNames(table), options);
          return authorizationCensusProxy(
            Reflect.apply(item, target, [table, ...args]),
            options,
            undefined,
          );
        };
      }
      if (prop === 'select' || prop === 'selectDistinct') {
        return (...args: unknown[]) =>
          authorizationCensusProxy(Reflect.apply(item, target, args), options, 'select');
      }
      if (builderMode === 'select' && isAuthorizationCensusReadTableMethod(prop)) {
        return (table: unknown, ...args: unknown[]) => {
          assertAuthorizationCensusTablesAllowed(options.tableNames(table), options);
          return authorizationCensusProxy(
            Reflect.apply(item, target, [table, ...args]),
            options,
            builderMode,
          );
        };
      }
      return (...args: unknown[]) =>
        authorizationCensusProxy(Reflect.apply(item, target, args), options, builderMode);
    },
  });
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
  for (const tableName of tableNames) {
    const normalizedNames = authorizationCensusLookupNames(tableName, options);
    const inSchema = normalizedNames.some((name) => options.metadata.schemaTableNames?.has(name));
    if (!inSchema) continue;
    const classifications = normalizedNames.flatMap(
      (name) => options.metadata.authorizationClassificationsByTable?.get(name) ?? [],
    );
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
  const unqualified = tableName.includes('.') ? tableName.split('.').at(-1) : tableName;
  const normalizedUnqualified =
    unqualified === undefined ? undefined : options.normalizeTableName(unqualified);
  return [
    tableName,
    normalized,
    ...(unqualified === undefined ? [] : [unqualified]),
    ...(normalizedUnqualified === undefined ? [] : [normalizedUnqualified]),
  ].filter((name, index, names): name is string => name !== '' && names.indexOf(name) === index);
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
        '  Use a server-derived value or the audited trustedAssign(...) escape for intentional privileged assignment.',
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

function sqlCarrierFromValue(value: unknown, params: readonly unknown[]): SqlCarrier | undefined {
  if (typeof value === 'string') return { params, text: value };
  const snapshot = snapshotManagedSqlStatement(value);
  if (snapshot.ok) {
    return {
      params: snapshot.statement.values,
      text: sqlTextFromValue(value) ?? snapshot.statement.text,
    };
  }
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
  const text = sqlTextFromChunks(chunks);
  return text || undefined;
}

function sqlTextFromChunks(chunks: readonly unknown[]): string {
  return chunks.map(sqlTextFromChunk).join('');
}

function sqlTextFromChunk(chunk: unknown): string {
  if (chunk === undefined) return '';
  if (typeof chunk === 'string') return chunk;
  if (Array.isArray(chunk)) return `(${chunk.map(sqlTextFromChunk).join(', ')})`;
  if (!isRecord(chunk)) return '';

  const stringChunkValue = chunk.value;
  if (Array.isArray(stringChunkValue)) {
    return stringChunkValue.filter((item): item is string => typeof item === 'string').join('');
  }
  if (typeof stringChunkValue === 'string') return quoteSqlIdentifier(stringChunkValue);

  const table = drizzleTableIdentifier(chunk);
  if (table !== undefined) return table;

  const nestedChunks = chunk.queryChunks;
  if (Array.isArray(nestedChunks)) return sqlTextFromChunks(nestedChunks);

  const columnName = chunk.name;
  if (typeof columnName !== 'string') return '';
  const tableName = drizzleTableIdentifier(chunk.table);
  return tableName === undefined
    ? quoteSqlIdentifier(columnName)
    : `${tableName}.${quoteSqlIdentifier(columnName)}`;
}

function drizzleTableIdentifier(value: unknown): string | undefined {
  if (!isRecord(value) || !(DRIZZLE_IS_TABLE_SYMBOL in value)) return undefined;
  const name = value[DRIZZLE_NAME_SYMBOL];
  if (typeof name !== 'string' || name === '') return undefined;
  const schema = value[DRIZZLE_SCHEMA_SYMBOL];
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
  return isRecord(value) && typeof value.exec === 'function' && typeof value.query === 'function';
}

function scopedPostgresTransaction(
  target: Record<PropertyKey, unknown>,
  options: PostgresScopedClientOptions,
  receiver: unknown,
): unknown {
  const value = Reflect.get(target, 'transaction', receiver);
  if (typeof value !== 'function') return value;
  return <Result>(callback: (tx: unknown) => Promise<Result> | Result, ...args: unknown[]) => {
    if (typeof callback !== 'function') return value.call(target, callback, ...args);
    return value.call(
      target,
      (tx: unknown) => {
        if (!isPostgresTransactionClient(tx)) return callback(tx);
        return Promise.resolve(runPostgresTransactionControl(tx, options)).then(() =>
          callback(scopedPostgresTransactionClient(tx, options)),
        );
      },
      ...args,
    ) as Result;
  };
}

function scopedPostgresTransactionClient(
  tx: PostgresTransactionClient,
  options: PostgresScopedClientOptions,
): PostgresTransactionClient {
  return new Proxy(tx as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      if (prop === 'query') {
        return (query: unknown, params?: unknown[], queryOptions?: unknown) => {
          const snapshot = postgresQuerySnapshot(query, params);
          assertAppPostgresTextAllowed(snapshot.text);
          const queryMethod = Reflect.get(target, 'query', receiver);
          if (typeof queryMethod !== 'function') {
            throw new KovoReadonlyHandleError(
              'KV433: Postgres scoped transaction client requires a callable query method (SPEC §10.3/§11.2).',
            );
          }
          return Reflect.apply(
            queryMethod,
            target,
            postgresQueryExecutionArgs(snapshot, queryOptions),
          );
        };
      }
      if (prop === 'exec') return scopedPostgresExec.bind(undefined, options);
      if (prop === 'transaction') return scopedPostgresTransaction(target, options, receiver);
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as PostgresTransactionClient;
}

function scopedPostgresQuery(
  client: Record<PropertyKey, unknown>,
  options: PostgresScopedClientOptions,
  query: unknown,
  params?: unknown[],
  queryOptions?: unknown,
): Promise<unknown> {
  const snapshot = postgresQuerySnapshot(query, params);
  assertAppPostgresTextAllowed(snapshot.text);
  return postgresTransaction(client, async (tx) => {
    await runPostgresTransactionControl(tx, options);
    const queryMethod = tx.query.bind(tx);
    try {
      return (await queryMethod(...postgresQueryExecutionArgs(snapshot, queryOptions))) as unknown;
    } catch (error) {
      throw translatedPostgresWriteDenial(error, snapshot);
    }
  }).then(async (result) => {
    await maybeReportPostgresRlsSilentDeny(options, snapshot.diagnosticQuery ?? snapshot, result);
    return result;
  });
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
  if (typeof query === 'string') return { text: query, values: params ?? [] };
  const snapshot = snapshotManagedSqlStatement(query, 'postgres');
  if (snapshot.ok) return snapshot.statement;
  const config = plainPostgresQueryConfigSnapshot(query, params);
  if (config !== undefined) return config;
  throw new KovoReadonlyHandleError(
    'KV414: Postgres scoped managed clients reject unknown SQL query carriers; app SQL must be a string or query config with text/sql (SPEC §10.2/§10.3).',
  );
}

type PostgresQuerySnapshot = {
  diagnosticQuery?: unknown;
  driverQuery?: unknown;
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
  const values = dataPropertyValue(query, 'values');
  const snapshot = Object.freeze({
    text,
    values: Object.freeze(Array.isArray(values) ? [...values] : [...(params ?? [])]),
  });
  return {
    diagnosticQuery: query,
    ...snapshot,
    driverQuery: postgresDriverQueryConfig(query, snapshot),
  };
}

function postgresDriverQueryConfig(
  query: Record<PropertyKey, unknown>,
  snapshot: { text: string; values: readonly unknown[] },
): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(query))) {
    if (!('value' in descriptor)) continue;
    config[key] = descriptor.value;
  }
  delete config.sql;
  config.text = snapshot.text;
  config.values = [...snapshot.values];
  return config;
}

function postgresQueryExecutionArgs(
  snapshot: PostgresQuerySnapshot,
  queryOptions: unknown,
): [unknown, unknown[] | undefined, unknown] {
  if (snapshot.driverQuery !== undefined) return [snapshot.driverQuery, undefined, queryOptions];
  return [snapshot.text, [...snapshot.values], queryOptions];
}

function dataPropertyValue(
  record: Record<PropertyKey, unknown>,
  property: 'sql' | 'text' | 'values',
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, property);
  if (descriptor === undefined || !('value' in descriptor)) return undefined;
  return descriptor.value;
}

const APP_POSTGRES_ALLOWED_COMMANDS = new Set(['delete', 'insert', 'select', 'update', 'with']);

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
    const char = sql.charAt(index);
    const next = sql.charAt(index + 1);
    if (char === '-' && next === '-') {
      cleaned += ' ';
      index += 2;
      while (index < sql.length && sql.charAt(index) !== '\n' && sql.charAt(index) !== '\r')
        index += 1;
      if (index < sql.length) cleaned += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      cleaned += ' ';
      index += 2;
      let closed = false;
      for (; index < sql.length; index += 1) {
        if (sql.charAt(index) === '*' && sql.charAt(index + 1) === '/') {
          closed = true;
          index += 1;
          break;
        }
      }
      if (!closed) return { ok: false, reason: 'unterminated block comment' };
      cleaned += ' ';
      continue;
    }
    if (char === "'" || char === '"') {
      const quote = char;
      cleaned += ' ';
      for (index += 1; index < sql.length; index += 1) {
        if (sql.charAt(index) === quote) {
          if (sql.charAt(index + 1) === quote) {
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
    if (char === '$') {
      const tagMatch = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u.exec(sql.slice(index));
      if (tagMatch !== null) {
        const tag = tagMatch[0];
        cleaned += ' ';
        const end = sql.indexOf(tag, index + tag.length);
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
    if (/\S/u.test(char)) {
      if (trailingOnly) return { ok: false, reason: 'multiple SQL statements' };
      statementHasToken = true;
    }
    cleaned += char;
  }
  if (statementHasToken) statementCount += 1;
  if (statementCount !== 1) return { ok: false, reason: 'expected exactly one SQL statement' };
  const command = /^\s*([A-Za-z]+)/u.exec(cleaned)?.[1]?.toLowerCase();
  if (command === undefined || !APP_POSTGRES_ALLOWED_COMMANDS.has(command)) {
    return { ok: false, reason: 'statement command is not in the app SQL allowlist' };
  }
  if (/\b(?:pg_catalog\.)?set_config\s*\(/iu.test(cleaned)) {
    return { ok: false, reason: 'app SQL cannot change framework transaction settings' };
  }
  return { command, ok: true };
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
  if (options.roleSetting !== undefined) {
    await (query("SELECT set_config('kovo.role', $1, true)", [
      options.roleSetting,
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

async function maybeReportPostgresRlsSilentDeny(
  options: PostgresScopedClientOptions,
  query: unknown,
  result: unknown,
): Promise<void> {
  const diagnostics = options.rlsDiagnostics;
  if (
    diagnostics === undefined ||
    diagnostics.enabled === false ||
    process.env.NODE_ENV === 'production' ||
    options.readOnly !== true ||
    resultRowCount(result) !== 0
  ) {
    return;
  }

  const table = resolvePostgresRlsDiagnosticTable(query, diagnostics);
  if (options.principal === undefined) {
    postgresRlsSilentDenyDiagnostics.push({
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

  postgresRlsSilentDenyDiagnostics.push({
    filteredRows: count,
    kind: 'owner-scope-filtered',
    message: `kovo_owner_scope filtered ${count} row${count === 1 ? '' : 's'} for principal ${options.principal}.`,
    principal: options.principal,
    table,
  });
}

function resultRowCount(result: unknown): number | undefined {
  if (Array.isArray(result)) return result.length;
  if (isRecord(result)) {
    const rows = result.rows;
    if (Array.isArray(rows)) return rows.length;
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
  const rows = Array.isArray(result)
    ? result
    : isRecord(result) && Array.isArray(result.rows)
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
  const normalized = query.trim().replace(/;+\s*$/, '');
  const match =
    /^select\b[\s\S]*?\bfrom\s+((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?)(?:\s+(?:as\s+)?(?:"[^"]+"|[A-Za-z_][\w$]*))?(?:\s+where\b|\s+group\s+by\b|\s+having\b|\s+order\s+by\b|\s+limit\b|\s+offset\b|\s+fetch\b|\s+for\b|\s*$)/iu.exec(
      normalized,
    );
  if (!match) return undefined;
  const table = match[1]?.replace(/\s*\.\s*/g, '.');
  if (table === undefined) return undefined;
  if (/\b(join|,)\b/iu.test(normalized.slice(match.index + match[0].length))) return undefined;
  return unquoteQualifiedSqlIdentifier(table);
}

function unquoteQualifiedSqlIdentifier(value: string): string {
  return value
    .split('.')
    .map((part) => {
      const trimmed = part.trim();
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1).replaceAll('""', '"');
      }
      return trimmed;
    })
    .join('.');
}

function quoteQualifiedSqlIdentifier(value: string, quote: (identifier: string) => string): string {
  return value
    .split('.')
    .map((part) => quote(part))
    .join('.');
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
  const readDb = readonlyDbTarget(db);
  const safe = wrapManagedDbForSqlSafety(
    readDb,
    undefined,
    managedSqlExecutionPolicy({
      capability: 'read',
      engineReadonly: readDb !== db,
    }),
  );
  return readonlyCapabilityDb(safe as object, options) as unknown as Reader<Db>;
}

function readonlyCapabilityDb<Db extends object>(
  db: Db,
  options: { crossOwnerRead?: CrossOwnerReadPolicyOptions; rawRead?: RawReadPolicyOptions },
  preserveInnerCapabilities = false,
): Reader<Db> {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'then') return undefined;
      if (typeof prop === 'string') {
        if (DENIED_READ_CAPABILITY_PROPERTIES.has(prop)) return readonlyCapabilityError(prop);
        if (!READ_CAPABILITY_PROPERTIES.has(prop)) return readonlyCapabilityError(prop);
        if (prop === 'crossOwnerRead')
          return readonlyCrossOwnerRead(target, receiver, options, preserveInnerCapabilities);
        if (prop === 'rawRead')
          return readonlyRawRead(target, receiver, options, preserveInnerCapabilities);
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

function readonlyCrossOwnerRead(
  target: object,
  receiver: unknown,
  options: { crossOwnerRead?: CrossOwnerReadPolicyOptions },
  preserveInnerCapabilities: boolean,
): unknown {
  if (options.crossOwnerRead === undefined && preserveInnerCapabilities) {
    const value = Reflect.get(target, 'crossOwnerRead', receiver);
    if (typeof value === 'function') return value.bind(target);
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
    const value = Reflect.get(target, 'rawRead', receiver);
    if (typeof value === 'function') return value.bind(target);
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
    assertRawReadDeclaration(declaration);
    const carrier = sqlCarrierFromValue(statement, []);
    if (carrier === undefined) {
      throw new Error(
        'KV410: rawRead requires a SQL statement whose table set can be checked against the declared reads (SPEC §10.2/§10.3).',
      );
    }
    assertRawReadObservedTablesAllowed(carrier.text, declaration, policy);
    if (policy.executeSql !== undefined) {
      return policy.executeSql(carrier) as Promise<Row[]> | Row[];
    }
    const method = rawReadExecutionMethod(target, policy);
    return method.call(target, statement) as Promise<Row[]> | Row[];
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
    if (policy.hasRole?.(normalized.role) !== true) {
      throw new KovoReadonlyHandleError(
        'KV414: crossOwnerRead requires a passed guards.role("admin") request guard before the admin read role is enabled (SPEC §10.3).',
      );
    }
    assertCrossOwnerReadAllowed(observed, normalized, policy);
    recordCrossOwnerReadAuditFact(normalized, observed, policy);
    if (policy.executeSql !== undefined) {
      return policy.executeSql(carrier) as Promise<Row[]> | Row[];
    }
    const method = rawReadExecutionMethod(policy.adminClient, policy);
    return method.call(policy.adminClient, statement) as Promise<Row[]> | Row[];
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

function normalizedCrossOwnerReadDeclaration(
  declaration: CrossOwnerReadDeclaration,
): CrossOwnerReadDeclaration {
  if (!isRecord(declaration)) {
    throw new Error('KV414: crossOwnerRead requires a declaration object (SPEC §10.3).');
  }
  if (declaration.role !== 'admin') {
    throw new Error('KV414: crossOwnerRead requires role: "admin" (SPEC §10.3).');
  }
  const reason = declaration.reason;
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new Error('KV414: crossOwnerRead requires a non-empty reason.');
  }
  if (
    !Array.isArray(declaration.reads) ||
    declaration.reads.length === 0 ||
    declaration.reads.some((table) => typeof table !== 'string' || table.trim() === '')
  ) {
    throw new Error('KV414: crossOwnerRead requires a non-empty declared reads table set.');
  }
  const site = declaration.site?.trim();
  return {
    reason: reason.trim(),
    reads: [...new Set(declaration.reads.map((table) => table.trim()))],
    role: 'admin',
    ...(site === undefined || site === '' ? {} : { site }),
  };
}

function assertCrossOwnerReadAllowed(
  observedTable: string,
  declaration: CrossOwnerReadDeclaration,
  policy: CrossOwnerReadPolicyOptions,
): void {
  const observed = policy.normalizeTableName(observedTable);
  const declared = new Set(declaration.reads.map(policy.normalizeTableName));
  const optedIn = new Set(policy.ownerTables.map(policy.normalizeTableName));
  if (!declared.has(observed)) {
    throw new Error(
      [
        `KV414: ${policy.dialectLabel} crossOwnerRead observed a table outside the declared reads set (SPEC §10.3).`,
        `  observed: ${observed}`,
        `  declared reads: ${[...declared].sort().join(', ') || '<none>'}`,
      ].join('\n'),
    );
  }
  if (!optedIn.has(observed)) {
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
  crossOwnerReadAuditFacts.push({
    declaredReads: [...new Set(declaration.reads.map(policy.normalizeTableName))].sort(),
    dialectLabel: policy.dialectLabel,
    observedRead: policy.normalizeTableName(observedTable),
    reason: declaration.reason,
    ...(policy.principal === undefined ? {} : { principal: policy.principal }),
    ...(declaration.site === undefined ? {} : { site: declaration.site }),
  });
}

function isPublicReadRowsScope(value: unknown): value is PublicReadRowsScope {
  return (
    isRecord(value) &&
    typeof value.predicate === 'string' &&
    (value.table === undefined || typeof value.table === 'string')
  );
}

function rawReadExecutionMethod(
  target: object,
  policy: Pick<RawReadPolicyOptions, 'dialectLabel' | 'executeMethod'>,
): Function {
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
  const readonlyTarget =
    mode === 'read' ? resolveReadonlyDbTarget(raw) : { fromHook: false, target: raw };
  const target =
    mode === 'read' ? readonlyTarget.target : declaredWriteDbTarget(raw, options.sqlWritePolicy);
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
  return readonlyCapabilityDb(
    safe as unknown as object,
    managedReadCapabilityOptions(options),
    readonlyTarget.fromHook,
  ) as unknown as Reader<Db>;
}

function readonlyDbTarget<Db>(raw: Db): Db {
  return resolveReadonlyDbTarget(raw).target;
}

function managedReadCapabilityOptions(options: ManagedDbOptions): {
  crossOwnerRead?: CrossOwnerReadPolicyOptions;
  rawRead?: RawReadPolicyOptions;
} {
  const readOptions: {
    crossOwnerRead?: CrossOwnerReadPolicyOptions;
    rawRead?: RawReadPolicyOptions;
  } = {};
  if (options.crossOwnerRead !== undefined) readOptions.crossOwnerRead = options.crossOwnerRead;
  if (options.rawRead !== undefined) readOptions.rawRead = options.rawRead;
  return readOptions;
}

function resolveReadonlyDbTarget<Db>(raw: Db): { fromHook: boolean; target: Db } {
  if (!isRecord(raw)) return { fromHook: false, target: raw };
  const createReadonly = raw[kovoReadonlyDbHandle];
  if (typeof createReadonly !== 'function') return { fromHook: false, target: raw };
  const readTarget = createReadonly.call(raw) as Db;
  if (readTarget === raw) {
    throw new KovoReadonlyHandleError(
      'KV433: adapter read-only DB hook returned the mutable writer handle; managed readers require a dedicated engine read-only handle (SPEC §10.3/§11.2).',
    );
  }
  return { fromHook: true, target: readTarget };
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
