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
import { parseSqlWriteTables, type ParseSqlWriteTablesOptions } from './sql-write-allowlist.js';

/** Runtime raw-SQL write table policy enforced on mutation managed DB handles. */
export interface ManagedSqlWritePolicy {
  dialect?: ParseSqlWriteTablesOptions['dialect'];
  tables?: readonly string[];
  touches?: readonly string[];
}

const managedTransactionQueue = new WeakMap<object, Promise<void>>();

/**
 * Resolve the managed-SQL guard mode (SPEC §10.2/§744). The fail-closed default — in every
 * environment, production included — is `enforce`. Fail-open `KOVO_SQL_GUARD=warn/off` migration
 * modes are deliberately ignored for SINK-01: the managed SQL sink is a default-deny runtime floor.
 *
 * @internal
 */
export function managedSqlSafetyMode(): SqlSafetyMode {
  return 'enforce';
}

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
  writePolicy?: ManagedSqlWritePolicy,
): DbValue {
  if (!isDbAdapterLike(db)) return db;

  const proxyCache = new WeakMap<object, object>();
  const methodCache = new WeakMap<object, Map<PropertyKey, Function>>();
  return wrapDbAdapter(db, mode, proxyCache, methodCache, writePolicy) as DbValue;
}

function wrapDbAdapter(
  db: object,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
  writePolicy: ManagedSqlWritePolicy | undefined,
): object {
  const cached = proxyCache.get(db);
  if (cached) return cached;

  const proxy = new Proxy(db as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (isSqlHandleProperty(prop) && isSqlHandleLike(value)) {
        return wrapSqlHandle(value, mode, proxyCache, methodCache, writePolicy);
      }

      if (prop === 'sql' && typeof value === 'function' && isDbAdapterLike(target)) {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedSqlMethod(target, value, mode, writePolicy),
        );
      }

      if (
        (prop === 'query' || prop === 'exec' || prop === 'execute') &&
        typeof value === 'function' &&
        (isDbAdapterLike(target) || isSqlHandleLike(target))
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

      if (prop === 'transaction' && typeof value === 'function') {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedTransactionMethod(target, value, mode, proxyCache, methodCache, writePolicy),
        );
      }

      return typeof value === 'function'
        ? cachedSqlSafetyMethod(target, prop, value, methodCache, () => value.bind(target))
        : value;
    },
  });

  proxyCache.set(db, proxy);
  return proxy;
}

function wrapSqlHandle(
  handle: object,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
  writePolicy: ManagedSqlWritePolicy | undefined,
): object {
  const cached = proxyCache.get(handle);
  if (cached) return cached;

  const proxy = new Proxy(handle as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'transaction' && typeof value === 'function') {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedTransactionMethod(target, value, mode, proxyCache, methodCache, writePolicy),
        );
      }

      if (
        (prop === 'query' || prop === 'exec' || prop === 'execute') &&
        typeof value === 'function'
      ) {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedSqlMethod(target, value, mode, writePolicy),
        );
      }

      if (prop === 'prepare' && typeof value === 'function') {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedPrepareMethod(target, value, mode, proxyCache, methodCache, writePolicy),
        );
      }

      return typeof value === 'function'
        ? cachedSqlSafetyMethod(target, prop, value, methodCache, () => value.bind(target))
        : value;
    },
  });

  proxyCache.set(handle, proxy);
  return proxy;
}

function guardedSqlMethod(
  target: object,
  value: Function,
  mode: SqlSafetyMode,
  writePolicy: ManagedSqlWritePolicy | undefined,
): Function {
  return (statement: unknown, ...args: unknown[]) => {
    assertManagedSqlStatement(statement, mode, writePolicy);
    return value.call(target, statement, ...args);
  };
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
    if (typeof callback !== 'function') return value.call(target, callback, ...args);
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

function wrapTransactionDb(
  tx: unknown,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
  writePolicy: ManagedSqlWritePolicy | undefined,
): unknown {
  if (!isDbAdapterLike(tx)) return tx;
  return wrapDbAdapter(tx, mode, proxyCache, methodCache, writePolicy);
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
    assertManagedSqlStatement(statement, mode, writePolicy);
    const prepared = value.call(target, statement, ...args);
    return typeof prepared === 'object' && prepared !== null
      ? wrapPreparedSqlStatement(prepared, mode, proxyCache, methodCache)
      : prepared;
  };
}

function wrapPreparedSqlStatement(
  statementHandle: object,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
): object {
  const cached = proxyCache.get(statementHandle);
  if (cached) return cached;

  const proxy = new Proxy(statementHandle as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (isPreparedStatementExecutionMethod(prop) && typeof value === 'function') {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () => value.bind(target));
      }

      return typeof value === 'function'
        ? cachedSqlSafetyMethod(target, prop, value, methodCache, () => value.bind(target))
        : value;
    },
  });

  proxyCache.set(statementHandle, proxy);
  return proxy;
}

function assertManagedSqlStatement(
  statement: unknown,
  mode: SqlSafetyMode,
  writePolicy: ManagedSqlWritePolicy | undefined,
): void {
  void mode;
  const validation = validateManagedSqlStatement(statement);
  if (!validation.ok) throw new Error(validation.message);
  assertSqlWriteTablesAllowed(statement, writePolicy);
}

function assertSqlWriteTablesAllowed(
  statement: unknown,
  writePolicy: ManagedSqlWritePolicy | undefined,
): void {
  const declaredTables = writePolicy?.tables;
  if (declaredTables === undefined || declaredTables.length === 0) return;

  const sql = sqlStatementText(statement);
  if (sql === undefined) return;

  let writeTables: string[];
  try {
    writeTables = parseManagedSqlWriteTables(sql, writePolicy?.dialect);
  } catch (error) {
    throw new Error(
      'KV406: raw-SQL write table allowlist could not parse an executable statement on a managed mutation DB handle (SPEC §10.3/§11.2).',
      { cause: error },
    );
  }
  if (writeTables.length === 0) return;

  const allowed = new Set(declaredTables);
  const unexpected = writeTables.filter((table) => !allowed.has(table));
  if (unexpected.length === 0) return;

  throw new Error(
    [
      'KV406: raw-SQL write touched table(s) outside the declared mutation registry tables (SPEC §10.3/§11.2).',
      `  unexpected: ${[...new Set(unexpected)].sort().join(', ')}`,
      `  declared tables: ${[...new Set(declaredTables)].sort().join(', ')}`,
      `  touches: ${[...new Set(writePolicy?.touches ?? [])].sort().join(', ') || '<none>'}`,
    ].join('\n'),
  );
}

function parseManagedSqlWriteTables(
  sql: string,
  dialect: ParseSqlWriteTablesOptions['dialect'],
): string[] {
  try {
    return parseSqlWriteTables(sql, { dialect });
  } catch (error) {
    if (dialect !== undefined) throw error;
    return parseSqlWriteTables(sql, { dialect: 'sqlite' });
  }
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
