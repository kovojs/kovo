import type * as CoreGraph from '@kovojs/core/internal/graph';
import {
  assertObservedReadsCovered,
  assertObservedWritesCovered,
  diagnosticsForObservations,
  type DbVerificationDiagnostic,
} from './verifier-diagnostics.js';
import {
  cachedMethod,
  createObservationRecorder,
  observableSqlMethod,
  observableTableMethod,
  type CachedMethod,
  type DbVerificationConfig,
  type ObservationRecorder,
  type ObservedDbOperation,
} from './verifier-observation.js';

export type {
  DbObservationOptions,
  DbVerificationConfig,
  ObservedDbOperation,
} from './verifier-observation.js';
export type { DbVerificationDiagnostic } from './verifier-diagnostics.js';
export { diagnosticMessage } from './verifier-diagnostics.js';

/** Wraps a database to record operations and assert each write is covered by the touch graph. */
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

/**
 * Create a database verifier from a touch graph: `wrap` a db to record its
 * operations, then assert that every write is covered by the domains its
 * mutation declared, and every read by its query's read set (SPEC §10.1, §11).
 *
 * @param touchGraph - The compiled touch graph to verify against.
 * @param config - Verification configuration (which tables/domains to observe).
 * @returns A `DbVerifier`.
 */
export function createDbVerifier(
  touchGraph: CoreGraph.TouchGraph,
  config: DbVerificationConfig,
): DbVerifier {
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
          if (prop === '__kovoObserved') return recorder.observed;
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

          // Real Drizzle write seam: `db.insert(table)` / `db.update(table)` /
          // `db.delete(table)` take the table as the first argument, so the same
          // table-method observer records the write (table resolved via the
          // Drizzle name symbol). SPEC.md §11.2/§14.
          if (
            (prop === 'insert' || prop === 'update' || prop === 'delete') &&
            typeof value === 'function'
          ) {
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
