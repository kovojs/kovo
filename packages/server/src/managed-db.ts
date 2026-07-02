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

/** Options for the framework-owned declared-write DB choke. */
export interface DeclaredWriteDbOptions {
  dialectLabel: string;
  normalizeTableName: (table: string) => string;
  sqliteAuthorizer?: DeclaredWriteSqliteAuthorizerOptions;
  tableNames: (table: unknown) => readonly string[];
}

/** Options for a Postgres/PGlite read-only transaction client. */
export interface PostgresReadonlyClientOptions {
  quoteIdentifier?: (value: string) => string;
  readerRole?: string | false;
}

const READ_CAPABILITY_PROPERTIES = new Set<string>([
  '$count',
  '$with',
  'query',
  'select',
  'selectDistinct',
  'with',
]);
const PARSED_READ_SQL_METHODS = new Set<string>([
  'all',
  'exec',
  'execute',
  'get',
  'prepare',
  'run',
  'sql',
  'values',
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
            assertDeclaredWriteTablesAllowed(options.tableNames(table), policy, options);
            return Reflect.apply(value, target, [table, ...args]);
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
 * Create a Postgres/PGlite client whose `query`/`exec` methods always run inside a read-only
 * transaction, optionally assuming a reader role before app SQL executes (SPEC §10.3 KV433).
 */
export const createPostgresReadonlyClient = securityClassifier(
  'server.managed-db.postgres-readonly-client',
  function <Client extends object>(
    client: Client,
    options: PostgresReadonlyClientOptions = {},
  ): Client {
    return new Proxy(client as Record<PropertyKey, unknown>, {
      get(target, prop, receiver) {
        if (prop === 'query') return readonlyPostgresQuery.bind(undefined, target, options);
        if (prop === 'exec') return readonlyPostgresExec.bind(undefined, target, options);
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
  ? Pick<Db, Extract<keyof Db, '$count' | '$with' | 'query' | 'select' | 'selectDistinct'>> &
      (Db extends { with: (...args: infer Args) => infer Result }
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

function isDeclaredWriteDrizzleMethod(prop: PropertyKey): prop is 'delete' | 'insert' | 'update' {
  return prop === 'delete' || prop === 'insert' || prop === 'update';
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

function readonlyPostgresQuery(
  client: Record<PropertyKey, unknown>,
  options: PostgresReadonlyClientOptions,
  query: string,
  params?: unknown[],
  queryOptions?: unknown,
): Promise<unknown> {
  return postgresTransaction(client, async (tx) => {
    await runPostgresReadOnlyTransactionControl(tx, options);
    const queryMethod = tx.query.bind(tx);
    return queryMethod(query, params, queryOptions) as Promise<unknown>;
  });
}

function readonlyPostgresExec(
  client: Record<PropertyKey, unknown>,
  options: PostgresReadonlyClientOptions,
  query: string,
  execOptions?: unknown,
): Promise<unknown> {
  return postgresTransaction(client, async (tx) => {
    await runPostgresReadOnlyTransactionControl(tx, options);
    const execMethod = tx.exec.bind(tx);
    return execMethod(query, execOptions) as Promise<unknown>;
  });
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

async function runPostgresReadOnlyTransactionControl(
  tx: PostgresTransactionClient,
  options: PostgresReadonlyClientOptions,
): Promise<void> {
  const exec = tx.exec.bind(tx);
  await (exec('SET TRANSACTION READ ONLY') as Promise<unknown>);
  if (options.readerRole !== false && options.readerRole !== undefined) {
    const quote = options.quoteIdentifier ?? quoteSqlIdentifier;
    await (exec(`SET LOCAL ROLE ${quote(options.readerRole)}`) as Promise<unknown>);
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
export function readonlyDb<Db extends object>(db: Db): Reader<Db> {
  const readDb = readonlyDbTarget(db);
  const safe = wrapManagedDbForSqlSafety(
    readDb,
    undefined,
    managedSqlExecutionPolicy({
      capability: 'read',
      engineReadonly: readDb !== db,
    }),
  );
  return readonlyCapabilityDb(safe as object) as Reader<Db>;
}

function readonlyCapabilityDb<Db extends object>(db: Db): Reader<Db> {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'then') return undefined;
      if (typeof prop === 'string') {
        if (DENIED_READ_CAPABILITY_PROPERTIES.has(prop)) return readonlyCapabilityError(prop);
        if (!READ_CAPABILITY_PROPERTIES.has(prop)) {
          const value = Reflect.get(target, prop, receiver);
          if (
            typeof value === 'function' &&
            (PARSED_READ_SQL_METHODS.has(prop) || prop in target)
          ) {
            return value.bind(target);
          }
          return readonlyCapabilityError(prop);
        }
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
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

/** @internal Options for the framework-owned managed DB handle composition point. */
export interface ManagedDbOptions {
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
  return readonlyCapabilityDb(safe as unknown as object) as Reader<Db>;
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
