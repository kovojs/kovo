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

/**
 * Resolve the managed-SQL guard mode (SPEC §10.2/§744). The fail-closed default — in every
 * environment, production included — is `enforce`; an explicit `KOVO_SQL_GUARD` override is honored
 * for a migration window (`warn`/`off`).
 *
 * @internal
 */
export function managedSqlSafetyMode(): SqlSafetyMode {
  const configured =
    typeof process === 'object' && process !== null ? process.env.KOVO_SQL_GUARD : undefined;
  if (configured === 'enforce' || configured === 'off' || configured === 'warn') return configured;
  return 'enforce';
}

/**
 * Wrap a db handle so raw-string SQL on its query/exec/execute/sql/prepare sinks is rejected
 * (KV422, SPEC §10.2). Non-adapter values and `mode === 'off'` pass through untouched. Defaults to
 * the {@link managedSqlSafetyMode} when no mode is given so callers (managed-db.ts) get the
 * fail-closed `enforce` floor.
 *
 * @internal
 */
export function wrapManagedDbForSqlSafety<DbValue>(
  db: DbValue,
  mode: SqlSafetyMode = managedSqlSafetyMode(),
): DbValue {
  if (mode === 'off' || !isDbAdapterLike(db)) return db;

  const proxyCache = new WeakMap<object, object>();
  const methodCache = new WeakMap<object, Map<PropertyKey, Function>>();
  return wrapDbAdapter(db, mode, proxyCache, methodCache) as DbValue;
}

function wrapDbAdapter(
  db: object,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
): object {
  const cached = proxyCache.get(db);
  if (cached) return cached;

  const proxy = new Proxy(db as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (isSqlHandleProperty(prop) && isSqlHandleLike(value)) {
        return wrapSqlHandle(value, mode, proxyCache, methodCache);
      }

      if (prop === 'sql' && typeof value === 'function' && isDbAdapterLike(target)) {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedSqlMethod(target, value, mode),
        );
      }

      if (
        (prop === 'query' || prop === 'exec' || prop === 'execute') &&
        typeof value === 'function' &&
        (isDbAdapterLike(target) || isSqlHandleLike(target))
      ) {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedSqlMethod(target, value, mode),
        );
      }

      if (prop === 'prepare' && typeof value === 'function' && isSqlHandleLike(target)) {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedPrepareMethod(target, value, mode, proxyCache, methodCache),
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
): object {
  const cached = proxyCache.get(handle);
  if (cached) return cached;

  const proxy = new Proxy(handle as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'transaction' && typeof value === 'function') {
        return cachedSqlSafetyMethod(
          target,
          prop,
          value,
          methodCache,
          () =>
            (callback: (tx: object) => unknown, ...args: unknown[]) =>
              value.call(
                target,
                (tx: object) => callback(wrapSqlHandle(tx, mode, proxyCache, methodCache)),
                ...args,
              ),
        );
      }

      if (
        (prop === 'query' || prop === 'exec' || prop === 'execute') &&
        typeof value === 'function'
      ) {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedSqlMethod(target, value, mode),
        );
      }

      if (prop === 'prepare' && typeof value === 'function') {
        return cachedSqlSafetyMethod(target, prop, value, methodCache, () =>
          guardedPrepareMethod(target, value, mode, proxyCache, methodCache),
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

function guardedSqlMethod(target: object, value: Function, mode: SqlSafetyMode): Function {
  return (statement: unknown, ...args: unknown[]) => {
    assertManagedSqlStatement(statement, mode);
    return value.call(target, statement, ...args);
  };
}

function guardedPrepareMethod(
  target: object,
  value: Function,
  mode: SqlSafetyMode,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, Function>>,
): Function {
  return (statement: unknown, ...args: unknown[]) => {
    assertManagedSqlStatement(statement, mode);
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

function assertManagedSqlStatement(statement: unknown, mode: SqlSafetyMode): void {
  const validation = validateManagedSqlStatement(statement);
  if (validation.ok) return;
  if (mode === 'warn') {
    console.warn(validation.message);
    return;
  }
  throw new Error(validation.message);
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
