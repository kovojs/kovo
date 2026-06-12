import { AsyncLocalStorage } from 'node:async_hooks';
import { type TouchGraph } from '@jiso/core';
import {
  assertObservedReadsCovered,
  assertObservedWritesCovered,
  diagnosticsForObservations,
  type DbVerificationDiagnostic,
} from './verifier-diagnostics.js';
import { parseSqlOperations } from './verifier-sql.js';

export interface DbVerificationConfig {
  domainByTable: Record<string, string>;
  exemptTables?: readonly string[];
  keyByTable?: Record<string, string>;
}

export interface ObservedDbOperation {
  branch: string | undefined;
  domain: string | undefined;
  kind: 'read' | 'write';
  mutationRead: boolean | undefined;
  rowKey: string | undefined;
  sql: string | undefined;
  table: string;
}

export interface DbObservationOptions {
  branch?: string;
  rowKey?: string;
}

export type { DbVerificationDiagnostic } from './verifier-diagnostics.js';
export { diagnosticMessage } from './verifier-diagnostics.js';

export interface DbVerifier {
  assertCovered(touchGraphKey?: string): void;
  assertCoveredOperations(observed: readonly ObservedDbOperation[], touchGraphKey?: string): void;
  assertCoveredSince(start: number, touchGraphKey?: string): void;
  assertReadsCovered(domains: readonly string[]): void;
  assertReadsCoveredOperations(
    observed: readonly ObservedDbOperation[],
    domains: readonly string[],
  ): void;
  assertReadsCoveredSince(start: number, domains: readonly string[]): void;
  capture<T>(
    callback: () => T | Promise<T>,
  ): Promise<{ observed: readonly ObservedDbOperation[]; result: T }>;
  diagnostics(): DbVerificationDiagnostic[];
  observed: readonly ObservedDbOperation[];
  wrap<Db>(db: Db): Db;
}

export function createDbVerifier(touchGraph: TouchGraph, config: DbVerificationConfig): DbVerifier {
  const recorder = createObservationRecorder();
  const rootProxyCache = new WeakMap<object, object>();
  const sqlHandleProxyCache = new WeakMap<object, object>();
  const methodCache = new WeakMap<object, Map<PropertyKey, CachedMethod>>();

  return {
    assertCovered(touchGraphKey?: string): void {
      assertObservedWritesCovered(recorder.observed, touchGraph, config, touchGraphKey);
    },
    assertCoveredOperations(
      observed: readonly ObservedDbOperation[],
      touchGraphKey?: string,
    ): void {
      assertObservedWritesCovered(observed, touchGraph, config, touchGraphKey);
    },
    assertCoveredSince(start: number, touchGraphKey?: string): void {
      assertObservedWritesCovered(
        recorder.observed.slice(start),
        touchGraph,
        config,
        touchGraphKey,
      );
    },
    assertReadsCovered(domains: readonly string[]): void {
      assertObservedReadsCovered(recorder.observed, domains, config);
    },
    assertReadsCoveredOperations(
      observed: readonly ObservedDbOperation[],
      domains: readonly string[],
    ): void {
      assertObservedReadsCovered(observed, domains, config);
    },
    assertReadsCoveredSince(start: number, domains: readonly string[]): void {
      assertObservedReadsCovered(recorder.observed.slice(start), domains, config);
    },
    capture<T>(
      callback: () => T | Promise<T>,
    ): Promise<{ observed: readonly ObservedDbOperation[]; result: T }> {
      return recorder.capture(callback);
    },
    diagnostics(): DbVerificationDiagnostic[] {
      return diagnosticsForObservations(recorder.observed, touchGraph);
    },
    observed: recorder.observed,
    wrap<Db>(db: Db): Db {
      if (typeof db !== 'object' || db === null) return db;
      const cached = rootProxyCache.get(db);
      if (cached) return cached as Db;

      // SPEC.md §11.4: verification observes calls that cross the harness
      // DB seam. A raw handle captured before wrap() never reaches this proxy;
      // tests must pass and use the wrapped harness DB handle instead.
      const proxy = new Proxy(db as Record<string, unknown>, {
        get(target, prop, receiver) {
          if (prop === '__jisoObserved') return recorder.observed;
          const value = Reflect.get(target, prop, receiver);

          if (prop === 'pglite' && isSqlHandleLike(value)) {
            return wrapSqlHandle(value, config, recorder, sqlHandleProxyCache, methodCache);
          }

          if (prop === 'read' && typeof value === 'function') {
            return cachedMethod(target, prop, value, methodCache, () =>
              observableTableMethod('read', target, value, config, recorder),
            );
          }

          if (prop === 'write' && typeof value === 'function') {
            return cachedMethod(target, prop, value, methodCache, () =>
              observableTableMethod('write', target, value, config, recorder),
            );
          }

          if (prop === 'sql' && typeof value === 'function' && isDbAdapterLike(target)) {
            return cachedMethod(target, prop, value, methodCache, () =>
              observableSqlMethod(target, value, config, recorder),
            );
          }

          if (
            (prop === 'query' || prop === 'exec') &&
            typeof value === 'function' &&
            (isDbAdapterLike(target) || isSqlHandleLike(target))
          ) {
            return cachedMethod(target, prop, value, methodCache, () =>
              observableSqlMethod(target, value, config, recorder),
            );
          }

          return typeof value === 'function'
            ? cachedMethod(target, prop, value, methodCache, () => value.bind(target))
            : value;
        },
      });

      rootProxyCache.set(db, proxy);
      return proxy as Db;
    },
  };
}

function wrapSqlHandle<Handle extends object>(
  handle: Handle,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, CachedMethod>>,
): Handle {
  const cached = proxyCache.get(handle);
  if (cached) return cached as Handle;

  const proxy = new Proxy(handle as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'transaction' && typeof value === 'function') {
        return cachedMethod(
          target,
          prop,
          value,
          methodCache,
          () =>
            (callback: (tx: object) => Promise<unknown>, ...args: unknown[]) =>
              value.call(
                target,
                (tx: object) =>
                  callback(wrapSqlHandle(tx, config, recorder, proxyCache, methodCache)),
                ...args,
              ),
        );
      }

      if ((prop === 'query' || prop === 'exec') && typeof value === 'function') {
        return cachedMethod(target, prop, value, methodCache, () =>
          observableSqlMethod(target, value, config, recorder),
        );
      }

      return typeof value === 'function'
        ? cachedMethod(target, prop, value, methodCache, () => value.bind(target))
        : value;
    },
  }) as Handle;

  proxyCache.set(handle, proxy);
  return proxy;
}

interface ObservationRecorder {
  observed: ObservedDbOperation[];
  capture<T>(
    callback: () => T | Promise<T>,
  ): Promise<{ observed: readonly ObservedDbOperation[]; result: T }>;
  record(operation: ObservedDbOperation): void;
}

interface ObservationScope {
  observed: ObservedDbOperation[];
}

interface CachedMethod {
  original: Function;
  wrapped: unknown;
}

function createObservationRecorder(): ObservationRecorder {
  const observed: ObservedDbOperation[] = [];
  const storage = new AsyncLocalStorage<ObservationScope>();

  return {
    observed,
    async capture<T>(
      callback: () => T | Promise<T>,
    ): Promise<{ observed: readonly ObservedDbOperation[]; result: T }> {
      const scope: ObservationScope = { observed: [] };
      const result = await storage.run(scope, callback);
      return { observed: scope.observed, result };
    },
    record(operation: ObservedDbOperation): void {
      observed.push(operation);
      storage.getStore()?.observed.push(operation);
    },
  };
}

function cachedMethod(
  target: object,
  prop: PropertyKey,
  original: Function,
  methodCache: WeakMap<object, Map<PropertyKey, CachedMethod>>,
  create: () => unknown,
): unknown {
  let cachedForTarget = methodCache.get(target);
  if (!cachedForTarget) {
    cachedForTarget = new Map();
    methodCache.set(target, cachedForTarget);
  }

  const cached = cachedForTarget.get(prop);
  if (cached?.original === original) return cached.wrapped;

  const wrapped = create();
  cachedForTarget.set(prop, { original, wrapped });
  return wrapped;
}

function observableTableMethod(
  kind: ObservedDbOperation['kind'],
  target: object,
  value: Function,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
): (table: unknown, ...args: unknown[]) => unknown {
  return (table: unknown, ...args: unknown[]) => {
    observeTableIfString(kind, table, args, config, recorder);
    return value.call(target, table, ...args);
  };
}

function observableSqlMethod(
  target: object,
  value: Function,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
): (statement: unknown, ...args: unknown[]) => unknown {
  return (statement: unknown, ...args: unknown[]) => {
    observeSqlIfString(statement, config, recorder);
    return value.call(target, statement, ...args);
  };
}

function isDbAdapterLike(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<PropertyKey, unknown>;

  return (
    isSqlHandleLike(record.pglite) ||
    typeof record.read === 'function' ||
    typeof record.write === 'function' ||
    typeof record.sql === 'function' ||
    (typeof record.exec === 'function' && typeof record.query === 'function')
  );
}

function isSqlHandleLike(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<PropertyKey, unknown>;
  const handleMethodCount = [
    typeof record.transaction === 'function',
    typeof record.exec === 'function',
    typeof record.query === 'function',
  ].filter(Boolean).length;

  return handleMethodCount >= 2;
}

function observeTableIfString(
  kind: ObservedDbOperation['kind'],
  table: unknown,
  args: readonly unknown[],
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
): void {
  if (typeof table !== 'string') return;
  observe(kind, table, args, config, recorder);
}

function observeSqlIfString(
  statement: unknown,
  config: DbVerificationConfig,
  observed: ObservationRecorder,
): void {
  if (typeof statement !== 'string') return;
  try {
    observeSql(statement, config, observed);
  } catch {
    // SPEC 11.2: instrumentation verifies observed SQL, but must not prevent
    // the user's database method from receiving adapter-specific statements.
  }
}

function observe(
  kind: ObservedDbOperation['kind'],
  table: string,
  args: readonly unknown[],
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
): void {
  recorder.record({
    branch: observationOptions(args)?.branch,
    domain: config.domainByTable[table],
    kind,
    mutationRead: undefined,
    rowKey: observationOptions(args)?.rowKey,
    sql: undefined,
    table,
  });
}

function observeSql(
  statement: string,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
): void {
  for (const operation of parseSqlOperations(statement)) {
    recorder.record({
      branch: undefined,
      domain: config.domainByTable[operation.table],
      kind: operation.kind,
      mutationRead: operation.mutationRead,
      rowKey: operation.rowKey,
      sql: statement,
      table: operation.table,
    });
  }
}

function observationOptions(args: readonly unknown[]): DbObservationOptions | undefined {
  const last = args.at(-1);

  if (typeof last !== 'object' || last === null || (!('branch' in last) && !('rowKey' in last))) {
    return undefined;
  }

  const rowKey = (last as { rowKey?: unknown }).rowKey;
  const branch = (last as { branch?: unknown }).branch;

  return {
    ...(typeof branch === 'string' ? { branch } : {}),
    ...(typeof rowKey === 'string' ? { rowKey } : {}),
  };
}
