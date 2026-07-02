// SPEC §10.2/§10.3/§744 (KV422): the SQL-safe managed DB handle. This is the EXISTING SQL-safety
// wrap, extracted out of guards.ts so the framework-owned managed handle (managed-db.ts) can compose
// it with the KV433 read-only proxy without a circular import.
//
// The wrap is the fail-closed runtime floor for KV422: a raw string statement on a managed handle's
// query/exec/execute/sql/prepare entry points throws unless it is a Kovo-branded
// (sql`...`/staticSql`...`/trustedSql(...)) or separated `{ text, values }` carrier. Static AST
// analysis remains the by-construction proof; this is the floor that catches what cannot be proven
// statically (SPEC §6.6: brands/proxies are defense-in-depth, never sold as the proof).

import {
  isDbAdapterLike,
  isPreparedStatementExecutionMethod,
  isSqlHandleLike,
  isSqlHandleProperty,
  validateManagedSqlStatement,
  type SqlSafetyMode,
} from '@kovojs/core/internal/sql-safety';
import { securityClassifier } from '@kovojs/core/internal/security-markers';
import {
  classifyStatement,
  UNTABLED_SQL_WRITE,
  type ParsedSqlWriteTarget,
  type ParseSqlWriteTablesOptions,
  type SqlClassifierVerdict,
  type SqlWriteTargets,
} from './sql-write-allowlist.js';

/** Runtime raw-SQL write table policy enforced on mutation managed DB handles. */
export interface ManagedSqlWritePolicy {
  capability?: 'read' | 'write';
  dialect?: ParseSqlWriteTablesOptions['dialect'];
  engineReadonly?: boolean;
  tables?: readonly string[];
  touches?: readonly string[];
}

declare const managedSqlExecutionPolicyBrand: unique symbol;

/**
 * Framework-owned DB execution policy for the managed SQL choke (SPEC §10.2/§10.3/§11.2, DEC-E).
 * The public shape is intentionally not enough: direct SQL execution wrapping requires a value
 * minted by {@link managedSqlExecutionPolicy}, and the runtime WeakSet check rejects bare casts.
 *
 * @internal
 */
export type ManagedSqlExecutionPolicy = ManagedSqlWritePolicy & {
  readonly [managedSqlExecutionPolicyBrand]: {
    readonly scope: 'framework-managed-sql-execution-policy';
  };
};

export const kovoAsyncMutationTransaction = Symbol('kovo.async-mutation-transaction');

export type AsyncMutationTransactionCapableDb = {
  [kovoAsyncMutationTransaction]?<Result>(
    callback: (transactionDb: unknown) => Promise<Result>,
  ): Promise<Result>;
};

const managedTransactionQueue = new WeakMap<object, Promise<void>>();
let sqliteSavepointId = 0;

const READ_SQL_BUILDER_FAST_PATH_METHODS = new Set<PropertyKey>([
  '$count',
  '$with',
  'select',
  'selectDistinct',
]);
const WRITE_SQL_BUILDER_FAST_PATH_METHODS = new Set<PropertyKey>([
  ...READ_SQL_BUILDER_FAST_PATH_METHODS,
  'delete',
  'insert',
  'update',
  'with',
]);
const frameworkManagedDbRawTargets = new WeakMap<object, object>();
const managedSqlExecutionPolicies = new WeakSet<object>();

/**
 * Mint the module-private execution policy required by {@link wrapManagedDbForSqlSafety}.
 *
 * @internal
 */
export function managedSqlExecutionPolicy(
  policy: ManagedSqlWritePolicy,
): ManagedSqlExecutionPolicy {
  const minted = Object.freeze({ ...policy }) as ManagedSqlExecutionPolicy;
  managedSqlExecutionPolicies.add(minted);
  return minted;
}

/**
 * Resolve the managed-SQL guard mode (SPEC §10.2/§744). The fail-closed default — in every
 * environment, production included — is `enforce`. Fail-open `KOVO_SQL_GUARD=warn/off` migration
 * modes are deliberately ignored for SINK-01: the managed SQL sink is a default-deny runtime floor.
 *
 * @internal
 */
export const managedSqlSafetyMode = securityClassifier(
  'server.sql.managed-safety-mode',
  function (): SqlSafetyMode {
    return 'enforce';
  },
);

/**
 * Wrap a db handle so raw-string SQL on its query/exec/execute/sql/prepare sinks is rejected
 * (KV422, SPEC §10.2). Non-adapter values pass through untouched. Defaults to the
 * {@link managedSqlSafetyMode} when no mode is given so callers (managed-db.ts) get the fail-closed
 * `enforce` floor.
 *
 * @internal
 */
export function wrapManagedDbForSqlSafety<DbValue>(
  db: DbValue,
  mode: SqlSafetyMode = managedSqlSafetyMode(),
  writePolicy?: ManagedSqlExecutionPolicy,
): DbValue {
  if (!isRecord(db)) return db;
  assertManagedSqlExecutionPolicy(writePolicy);
  if (writePolicy === undefined && !isManagedDbAdapterLike(db)) return db;

  const proxyCache = new WeakMap<object, object>();
  const methodCache = new WeakMap<object, Map<PropertyKey, Function>>();
  return wrapDbAdapter(
    db,
    mode,
    proxyCache,
    methodCache,
    writePolicy,
    writePolicy !== undefined || isManagedDbAdapterLike(db),
  ) as DbValue;
}

function assertManagedSqlExecutionPolicy(
  policy: ManagedSqlExecutionPolicy | undefined,
): asserts policy is ManagedSqlExecutionPolicy | undefined {
  if (policy === undefined) return;
  if (typeof policy === 'object' && policy !== null && managedSqlExecutionPolicies.has(policy)) {
    return;
  }
  throw new Error(
    'KV422: managed DB SQL execution policy was not created by the framework-owned constructor (SPEC §10.2/§10.3/§11.2). Route DB execution through managedDb()/readonlyDb() so the read/write choke remains the sole door.',
  );
}

/**
 * Resolve the raw target behind a framework-owned managed DB proxy.
 *
 * @internal This is deliberately not exported from the package barrel. Framework subsystems such
 * as durable tasks use it for their own audited internal tables while app-authored code keeps the
 * managed KV422/KV433 surface.
 */
export function frameworkManagedDbRawTarget(value: unknown): object | undefined {
  if (!isRecord(value)) return undefined;
  const target = frameworkManagedDbRawTargets.get(value);
  if (target === undefined) return undefined;
  return frameworkManagedDbRawTarget(target) ?? target;
}

function wrapDbAdapter(
  db: object,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
  writePolicy: ManagedSqlWritePolicy | undefined,
  strictSqlTarget: boolean,
): object {
  const cached = proxyCache.get(db);
  if (cached) return cached;

  const proxy = new Proxy(db as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      if (prop === kovoAsyncMutationTransaction) {
        if (writePolicy?.capability === 'read') return undefined;
        const transactionControlTarget = frameworkManagedDbRawTarget(target) ?? target;
        if (!sqliteTransactionClient(transactionControlTarget)) return undefined;
        return <Result>(callback: (transactionDb: unknown) => Promise<Result>) =>
          runSqliteAsyncTransaction(
            transactionControlTarget,
            wrapTransactionDb(transactionControlTarget, mode, proxyCache, methodCache, writePolicy),
            callback,
          );
      }

      if (writePolicy !== undefined && isManagedRawDriverEscapeProperty(prop)) {
        throw new Error(
          `KV422: managed DB raw driver escape ${describeSqlMethod(prop)} is not exposed from framework-owned handles (SPEC §10.2/§10.3). Use the managed SQL methods so statement provenance and declared-table enforcement remain attached.`,
        );
      }

      const value = Reflect.get(target, prop, receiver);

      if (isNestedSqlHandleProperty(prop) && typeof value === 'object' && value !== null) {
        return wrapDbAdapter(value, mode, proxyCache, methodCache, writePolicy, true);
      }

      if (prop === 'sql' && typeof value === 'function' && isManagedDbAdapterLike(target)) {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedSqlMethod(target, value, mode, writePolicy),
        );
      }

      if (
        isDirectSqlExecutionMethod(prop) &&
        typeof value === 'function' &&
        (isManagedDbAdapterLike(target) || isSqlHandleLike(target))
      ) {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedSqlMethod(target, value, mode, writePolicy),
        );
      }

      if (prop === 'prepare' && typeof value === 'function' && isSqlHandleLike(target)) {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedPrepareMethod(target, value, mode, proxyCache, methodCache, writePolicy),
        );
      }

      if (prop === 'with' && typeof value === 'function' && writePolicy?.capability === 'read') {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedReadWithMethod(target, value, proxyCache, methodCache),
        );
      }

      if (prop === 'with' && typeof value === 'function') {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedWriteWithMethod(target, value, mode, proxyCache, methodCache, writePolicy),
        );
      }

      if (prop === 'transaction' && typeof value === 'function') {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedTransactionMethod(target, value, mode, proxyCache, methodCache, writePolicy),
        );
      }

      if (typeof value !== 'function') return value;
      return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
        isSqlBuilderFastPath(prop, writePolicy)
          ? value.bind(target)
          : guardedUnknownSqlMethod(target, prop, value, mode, writePolicy, strictSqlTarget),
      );
    },
  });

  proxyCache.set(db, proxy);
  frameworkManagedDbRawTargets.set(proxy, db);
  return proxy;
}

function isSqlBuilderFastPath(
  prop: PropertyKey,
  writePolicy: ManagedSqlWritePolicy | undefined,
): boolean {
  return (
    writePolicy?.capability === 'read'
      ? READ_SQL_BUILDER_FAST_PATH_METHODS
      : WRITE_SQL_BUILDER_FAST_PATH_METHODS
  ).has(prop);
}

function guardedSqlMethod(
  target: object,
  value: Function,
  mode: SqlSafetyMode,
  writePolicy: ManagedSqlWritePolicy | undefined,
): Function {
  return (statement: unknown, ...args: unknown[]) => {
    enforceManagedSql(statement, mode, writePolicy);
    return wrapReadonlyEngineResult(() => value.call(target, statement, ...args), writePolicy);
  };
}

function guardedReadWithMethod(
  target: object,
  value: Function,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
): Function {
  return (...args: unknown[]) => {
    const builder = value.apply(target, args);
    return isRecord(builder) ? wrapReadWithBuilder(builder, proxyCache, methodCache) : builder;
  };
}

function guardedWriteWithMethod(
  target: object,
  value: Function,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
  writePolicy: ManagedSqlWritePolicy | undefined,
): Function {
  return (...args: unknown[]) => {
    const builder = value.apply(target, args);
    return isRecord(builder)
      ? wrapDbAdapter(
          builder,
          mode,
          proxyCache,
          methodCache,
          writePolicy,
          writePolicy !== undefined,
        )
      : builder;
  };
}

function wrapReadWithBuilder(
  builder: object,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
): object {
  const cached = proxyCache.get(builder);
  if (cached) return cached;

  const proxy = new Proxy(builder as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      if (prop === 'then') return undefined;
      if (typeof prop === 'string' && !READ_SQL_BUILDER_FAST_PATH_METHODS.has(prop)) {
        return () => {
          throw new Error(
            `KV433: read-only SQL capability cannot access db.with(...).${prop} from a query loader (SPEC §10.3/§11.2).`,
          );
        };
      }
      const property = Reflect.get(target, prop, receiver);
      return typeof property === 'function'
        ? cachedSqlSafetyMethod(target, prop, property, methodCache, () => property.bind(target))
        : property;
    },
  });

  proxyCache.set(builder, proxy);
  return proxy;
}

function guardedUnknownSqlMethod(
  target: object,
  prop: PropertyKey,
  value: Function,
  mode: SqlSafetyMode,
  writePolicy: ManagedSqlWritePolicy | undefined,
  strictSqlTarget: boolean,
): Function {
  return (...args: unknown[]) => {
    assertAmbiguousSqlMethodArguments(prop, args, mode, writePolicy, strictSqlTarget);
    return wrapReadonlyEngineResult(() => value.apply(target, args), writePolicy);
  };
}

function assertAmbiguousSqlMethodArguments(
  prop: PropertyKey,
  args: readonly unknown[],
  mode: SqlSafetyMode,
  writePolicy: ManagedSqlWritePolicy | undefined,
  strictSqlTarget: boolean,
): void {
  const statements = args.filter(isSqlStatementCandidate);
  for (const statement of statements) {
    enforceManagedSql(statement, mode, writePolicy);
  }
  if (statements.length > 0) return;
  if (writePolicy === undefined || !strictSqlTarget) return;

  throw new Error(
    `KV422: unknown managed DB method ${describeSqlMethod(prop)} is not a proven SQL builder/read capability and did not receive a recognizable SQL carrier (SPEC §10.2/§10.3).`,
  );
}

function describeSqlMethod(prop: PropertyKey): string {
  return typeof prop === 'string' ? `db.${prop}` : `db[${String(prop)}]`;
}

function guardedTransactionMethod(
  target: object,
  value: Function,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
  writePolicy: ManagedSqlWritePolicy | undefined,
): Function {
  return (callback: unknown, ...args: unknown[]) => {
    if (writePolicy?.capability === 'read') {
      throw new Error(
        'KV433: read-only SQL capability cannot open db.transaction from a query loader (SPEC §10.3/§11.2).',
      );
    }
    if (typeof callback !== 'function') return value.call(target, callback, ...args);
    if (args.length === 0) {
      const sqlite = runSqliteAsyncTransaction(
        target,
        wrapTransactionDb(target, mode, proxyCache, methodCache, writePolicy),
        (tx) => Promise.resolve(callback(tx)),
      );
      if (sqlite) return sqlite;
    }
    return runQueuedManagedTransaction(target, () =>
      value.call(
        target,
        (tx: unknown) =>
          callback(wrapTransactionDb(tx, mode, proxyCache, methodCache, writePolicy)),
        ...args,
      ),
    );
  };
}

type SqliteTransactionClient = {
  exec(statement: string): unknown;
  readonly inTransaction?: boolean;
};

export function runSqliteAsyncTransaction<Result>(
  db: unknown,
  transactionDb: unknown,
  callback: (transactionDb: unknown) => Promise<Result>,
): Promise<Result> | undefined {
  const client = sqliteTransactionClient(db);
  if (!client) return undefined;

  const queueTarget = (typeof db === 'object' && db !== null ? db : client) as object;
  return runQueuedManagedTransaction(queueTarget, () =>
    runSqliteTransactionControl(client, () => callback(transactionDb)),
  );
}

export function canRunSqliteAsyncTransaction(db: unknown): boolean {
  return sqliteTransactionClient(db) !== undefined;
}

function sqliteTransactionClient(db: unknown): SqliteTransactionClient | undefined {
  const target = frameworkManagedDbRawTarget(db) ?? db;
  if (!isRecord(target)) return undefined;

  if (isSqliteTransactionClient(target)) return target;

  const client = target.$client;
  return isSqliteTransactionClient(client) ? client : undefined;
}

function isSqliteTransactionClient(value: unknown): value is SqliteTransactionClient {
  if (!isRecord(value)) return false;
  return (
    typeof value.exec === 'function' &&
    typeof value.transaction === 'function' &&
    typeof value.prepare === 'function' &&
    'inTransaction' in value
  );
}

async function runSqliteTransactionControl<Result>(
  client: SqliteTransactionClient,
  callback: () => Promise<Result>,
): Promise<Result> {
  // SPEC §10.3: better-sqlite3 transactions are synchronous, but mutation handlers may be async.
  // Keep the transaction open across the awaited handler with framework-owned control statements.
  const nested = client.inTransaction === true;
  const savepoint = nested ? `kovo_mutation_${++sqliteSavepointId}` : undefined;

  client.exec(savepoint === undefined ? 'BEGIN' : `SAVEPOINT ${savepoint}`);
  try {
    const result = await callback();
    client.exec(savepoint === undefined ? 'COMMIT' : `RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    try {
      client.exec(savepoint === undefined ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}`);
      if (savepoint !== undefined) client.exec(`RELEASE ${savepoint}`);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Kovo SQLite mutation transaction rollback failed after a handler error (SPEC §10.3).',
      );
    }
    throw error;
  }
}

async function runQueuedManagedTransaction<Result>(
  target: object,
  run: () => Promise<Result> | Result,
): Promise<Result> {
  const previous = managedTransactionQueue.get(target) ?? Promise.resolve();
  const current = previous.then(run);
  const tail = current.then(
    () => undefined,
    () => undefined,
  );
  managedTransactionQueue.set(target, tail);

  try {
    return await current;
  } finally {
    if (managedTransactionQueue.get(target) === tail) {
      managedTransactionQueue.delete(target);
    }
  }
}

function wrapReadonlyEngineResult<Result>(
  execute: () => Result,
  writePolicy: ManagedSqlWritePolicy | undefined,
): Result {
  if (writePolicy?.capability !== 'read' || writePolicy.engineReadonly !== true) {
    return execute();
  }

  try {
    const result = execute();
    if (isPromiseLike(result)) {
      return result.catch((error: unknown) => {
        throw readonlyEngineError(error);
      }) as Result;
    }
    return result;
  } catch (error) {
    throw readonlyEngineError(error);
  }
}

function readonlyEngineError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
    [
      'KV433: database engine read-only enforcement rejected a query-loader SQL statement (SPEC §10.3/§11.2).',
      `  engine: ${message}`,
    ].join('\n'),
  );
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function' &&
    typeof (value as { catch?: unknown }).catch === 'function'
  );
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

function wrapTransactionDb(
  tx: unknown,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
  writePolicy: ManagedSqlWritePolicy | undefined,
): unknown {
  if (!isRecord(tx)) return tx;
  if (writePolicy === undefined && !isManagedDbAdapterLike(tx)) return tx;
  return wrapDbAdapter(
    tx,
    mode,
    proxyCache,
    methodCache,
    writePolicy,
    writePolicy !== undefined || isManagedDbAdapterLike(tx),
  );
}

function guardedPrepareMethod(
  target: object,
  value: Function,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
  writePolicy: ManagedSqlWritePolicy | undefined,
): Function {
  return (statement: unknown, ...args: unknown[]) => {
    enforceManagedSql(statement, mode, writePolicy);
    const prepared = wrapReadonlyEngineResult(
      () => value.call(target, statement, ...args),
      writePolicy,
    );
    return typeof prepared === 'object' && prepared !== null
      ? wrapPreparedSqlStatement(prepared, mode, proxyCache, methodCache, writePolicy)
      : prepared;
  };
}

function wrapPreparedSqlStatement(
  statementHandle: object,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
  writePolicy: ManagedSqlWritePolicy | undefined,
): object {
  const cached = proxyCache.get(statementHandle);
  if (cached) return cached;

  const proxy = new Proxy(statementHandle as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (isPreparedStatementExecutionMethod(prop) && typeof value === 'function') {
        return cachedSqlSafetyMethod(
          target,
          prop,
          value,
          methodCache,
          () =>
            (...args: unknown[]) =>
              wrapReadonlyEngineResult(() => value.apply(target, args), writePolicy),
        );
      }

      return typeof value === 'function'
        ? cachedSqlSafetyMethod(target, prop, value, methodCache, () => value.bind(target))
        : value;
    },
  });

  proxyCache.set(statementHandle, proxy);
  return proxy;
}

/**
 * The single managed SQL runtime choke (SPEC §10.3/§11.2). Every framework-owned DB handle path
 * that can execute caller-provided SQL text must route through this function before reaching the
 * underlying driver.
 *
 * @internal
 */
export const enforceManagedSql = securityClassifier(
  'server.sql.enforce-managed-sql',
  function (
    statement: unknown,
    mode: SqlSafetyMode,
    writePolicy: ManagedSqlWritePolicy | undefined,
  ): void {
    void mode;
    const validation = validateManagedSqlStatement(statement);
    if (validation.ok) return assertSqlWriteTablesAllowed(statement, writePolicy);
    throw new Error(validation.message);
  },
);

const assertSqlWriteTablesAllowed = securityClassifier(
  'server.sql.write-table-allowlist',
  function (statement: unknown, writePolicy: ManagedSqlWritePolicy | undefined): void {
    if (writePolicy?.capability === 'read') {
      if (writePolicy.engineReadonly === true) return;
      assertReadSqlStatement(statement, writePolicy?.dialect);
      return;
    }

    const declaredTables = writePolicy?.tables;
    if (declaredTables === undefined || declaredTables.length === 0) return;

    const sql = sqlStatementText(statement);
    if (sql === undefined) return;

    const verdict = classifyManagedSql(sql, writePolicy?.dialect);
    if (verdict.kind === 'proven-safe') return;
    if (verdict.kind === 'unproven') {
      throw new Error(
        [
          'KV406: raw-SQL write table allowlist could not prove an executable statement read-only or table-resolved on a managed mutation DB handle (SPEC §10.3/§11.2).',
          `  reason: ${verdict.reason}`,
        ].join('\n'),
      );
    }

    const writeTables = verdict.detail;
    if (writeTables.includes(UNTABLED_SQL_WRITE)) {
      throw new Error(
        'KV406: raw-SQL write table allowlist encountered a write with no provable table allowlist target on a managed mutation DB handle (SPEC §10.3/§11.2).',
      );
    }

    const writeTableNames = writeTables
      .filter(isParsedSqlTableName)
      .map((table) => normalizeManagedSqlTableName(table, writePolicy?.dialect));
    const allowed = new Set(
      declaredTables.map((table) => normalizeManagedSqlTableName(table, writePolicy?.dialect)),
    );
    const unexpected = writeTableNames.filter((table) => !allowed.has(table));
    if (unexpected.length === 0) return;

    throw new Error(
      [
        'KV406: raw-SQL write touched table(s) outside the declared mutation registry tables (SPEC §10.3/§11.2).',
        `  unexpected: ${[...new Set(unexpected)].sort().join(', ')}`,
        `  declared tables: ${[...new Set(declaredTables)].sort().join(', ')}`,
        `  touches: ${[...new Set(writePolicy?.touches ?? [])].sort().join(', ') || '<none>'}`,
      ].join('\n'),
    );
  },
);

const assertReadSqlStatement = securityClassifier(
  'server.sql.read-only-statement',
  function (statement: unknown, dialect: ParseSqlWriteTablesOptions['dialect']): void {
    const sql = sqlStatementText(statement);
    if (sql === undefined) return;

    const verdict = classifyManagedSql(sql, dialect);
    if (verdict.kind === 'proven-safe') return;

    throw new Error(
      [
        verdict.kind === 'unproven'
          ? 'KV433: framework read-only SQL choke could not prove an executable statement read-only on a managed query DB handle (SPEC §10.3/§11.2).'
          : 'KV433: framework read-only SQL choke rejected a mutating statement from a query loader (SPEC §10.3/§11.2).',
        verdict.kind === 'unproven'
          ? `  reason: ${verdict.reason}`
          : `  tables: ${formatSqlWriteTargets(verdict.detail)}`,
      ].join('\n'),
    );
  },
);

const classifyManagedSql = securityClassifier(
  'server.sql.classify-managed-sql',
  function (
    sql: string,
    dialect: ParseSqlWriteTablesOptions['dialect'],
  ): SqlClassifierVerdict<SqlWriteTargets> {
    const primary = classifyStatement(sql, { dialect });
    if (primary.kind !== 'unproven' || dialect !== undefined) return primary;

    const sqlite = classifyStatement(sql, { dialect: 'sqlite' });
    if (sqlite.kind !== 'unproven') return sqlite;
    return primary;
  },
);

function formatSqlWriteTargets(targets: readonly ParsedSqlWriteTarget[]): string {
  return targets
    .map((target) => (target === UNTABLED_SQL_WRITE ? '<untabled write>' : target))
    .join(', ');
}

function normalizeManagedSqlTableName(
  table: string,
  dialect: ParseSqlWriteTablesOptions['dialect'],
): string {
  if (table.includes('.')) return table;
  return `${dialect === 'sqlite' ? 'main' : 'public'}.${table}`;
}

function isParsedSqlTableName(target: ParsedSqlWriteTarget): target is string {
  return target !== UNTABLED_SQL_WRITE;
}

function sqlStatementText(statement: unknown): string | undefined {
  if (typeof statement === 'string') return statement;
  if (typeof statement !== 'object' || statement === null) return undefined;

  const record = statement as Record<PropertyKey, unknown>;
  const text = readStringProperty(record, 'text') ?? readStringProperty(record, 'sql');
  if (text !== undefined) return text;

  const queryChunks = record.queryChunks;
  if (Array.isArray(queryChunks)) return sqlFromQueryChunks(queryChunks);
  return undefined;
}

function readStringProperty(
  record: Record<PropertyKey, unknown>,
  property: 'text' | 'sql',
): string | undefined {
  try {
    const value = record[property];
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

function sqlFromQueryChunks(chunks: readonly unknown[]): string {
  let sql = '';
  let parameterIndex = 0;
  const nextParameter = () => `$${++parameterIndex}`;

  for (const chunk of chunks) {
    sql += sqlFromQueryChunk(chunk, nextParameter);
  }

  return sql;
}

function sqlFromQueryChunk(chunk: unknown, nextParameter: () => string): string {
  if (typeof chunk === 'string' || typeof chunk === 'number' || typeof chunk === 'boolean') {
    return nextParameter();
  }
  if (typeof chunk !== 'object' || chunk === null) return nextParameter();

  const record = chunk as Record<PropertyKey, unknown>;
  const value = record.value;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value.join('');
  }
  if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(record, 'brand')) {
    return value;
  }

  const nested = record.queryChunks;
  if (Array.isArray(nested)) {
    return nested.map((item) => sqlFromQueryChunk(item, nextParameter)).join('');
  }

  return nextParameter();
}

function isManagedDbAdapterLike(value: unknown): value is Record<PropertyKey, unknown> {
  if (isDbAdapterLike(value)) return true;
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<PropertyKey, unknown>;
  return (
    typeof record.all === 'function' ||
    typeof record.get === 'function' ||
    typeof record.run === 'function' ||
    typeof record.values === 'function' ||
    isSqlHandleLike(record.session)
  );
}

function isNestedSqlHandleProperty(prop: PropertyKey): boolean {
  return isSqlHandleProperty(prop) || prop === 'session';
}

function isManagedRawDriverEscapeProperty(prop: PropertyKey): boolean {
  return prop === '$client' || prop === 'session';
}

function isSqlStatementCandidate(value: unknown): boolean {
  if (typeof value === 'string') return looksLikeSqlStatement(value);
  if (typeof value !== 'object' || value === null) return false;

  const record = value as Record<PropertyKey, unknown>;
  return (
    typeof record.text === 'string' ||
    typeof record.sql === 'string' ||
    Array.isArray(record.queryChunks) ||
    typeof record.getSQL === 'function'
  );
}

function looksLikeSqlStatement(value: string): boolean {
  return /^(?:alter|begin|call|commit|create|delete|drop|exec|execute|explain|insert|merge|pragma|replace|rollback|savepoint|select|truncate|update|vacuum|with)\b/iu.test(
    value.trimStart(),
  );
}

function isDirectSqlExecutionMethod(prop: PropertyKey): boolean {
  return (
    prop === 'query' ||
    prop === 'exec' ||
    prop === 'execute' ||
    prop === 'all' ||
    prop === 'get' ||
    prop === 'run' ||
    prop === 'values'
  );
}

function cachedSqlSafetyMethod(
  target: object,
  prop: PropertyKey,
  value: Function,
  cache: WeakMap<object, Map<PropertyKey, Function>>,
  factory: () => Function,
): Function {
  let targetCache = cache.get(target);
  if (!targetCache) {
    targetCache = new Map();
    cache.set(target, targetCache);
  }
  const cached = targetCache.get(prop);
  if (cached) return cached;

  const next = factory();
  targetCache.set(prop, next);
  return next;
}
