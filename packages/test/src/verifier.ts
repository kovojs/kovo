import type * as CoreGraph from '@kovojs/core/internal/graph';
import {
  isDbAdapterLike,
  isPreparedStatementExecutionMethod,
  isSqlHandleLike,
  isSqlHandleProperty,
} from '@kovojs/core/internal/sql-safety';
import {
  createFrameworkManagedSqlDispatchProxy,
  kovoDeclaredWriteDbHandle,
  kovoReadonlyDbHandle,
} from '@kovojs/server/internal/execution';
import { observeSqlEngineSideEffects, tableObservationSnapshots } from './sql-observer.js';
import {
  assertObservedReadsCovered,
  assertObservedWritesCovered,
  diagnosticsForObservations,
  type DbVerificationDiagnostic,
} from './verifier-diagnostics.js';
import {
  cachedMethod,
  createObservationRecorder,
  observeSqlExecution,
  observeRequiredTableOperation,
  observableSqlMethod,
  observableTableMethod,
  type CachedMethod,
  type DbVerificationConfig,
  type ObservationRecorder,
  type ObservedDbOperation,
} from './verifier-observation.js';
import {
  assertVerifierSecurityIntrinsics,
  verifierApply,
  verifierArrayPush,
  verifierArrayJoin,
  verifierDenseArraySnapshot,
  verifierDefineProperty,
  verifierFreeze,
  verifierGetOwnPropertyDescriptor,
  verifierGetPrototypeOf,
  verifierIsExtensible,
  verifierIsPromise,
  verifierIsProxy,
  verifierNullRecord,
  verifierObjectKeys,
  verifierOwnKeys,
  verifierPromiseResolve,
  verifierPromiseThen,
  verifierReflectGet,
  verifierSet,
  verifierSetAdd,
  verifierSetValues,
  verifierString,
  verifierTypeError,
  verifierWeakMap,
  verifierWeakMapGet,
  verifierWeakMapSet,
} from './verifier-security-intrinsics.js';
import {
  snapshotDbVerificationConfig,
  snapshotDomains,
  snapshotObservedOperations,
  snapshotTouchGraph,
  snapshotVerifierSqlStatement,
} from './verifier-snapshots.js';

export type {
  DbObservationOptions,
  DbVerificationConfig,
  ObservedDbOperation,
} from './verifier-observation.js';

const verifierAsyncIteratorProperty = Symbol.asyncIterator;
const verifierIteratorProperty = Symbol.iterator;

/** @internal Wraps a database to record operations and assert each write is covered by the touch graph. */
export interface DbVerifier {
  assertCovered(touchGraphKey?: string): void;
  assertCoveredOperations(observed: readonly ObservedDbOperation[], touchGraphKey?: string): void;
  assertCoveredSince(start: number, touchGraphKey?: string): void;
  assertNoWritesOperations(observed: readonly ObservedDbOperation[]): void;
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
 * @internal Repo-internal verifier wrapped by `createKovoTestHarness`; app
 * authors use the harness verification API instead.
 * @param touchGraph - The compiled touch graph to verify against.
 * @param config - Verification configuration (which tables/domains to observe).
 * @returns A `DbVerifier`.
 */
export function createDbVerifier(
  touchGraph: CoreGraph.TouchGraph,
  config: DbVerificationConfig,
  options: { recordOutsideCapture?: boolean } = {},
): DbVerifier {
  assertVerifierSecurityIntrinsics();
  const touchGraphSnapshot = snapshotTouchGraph(touchGraph);
  const emptyTouchGraphSnapshot = snapshotTouchGraph({});
  const configSnapshot = snapshotDbVerificationConfig(config);
  const recorder = createObservationRecorder(options.recordOutsideCapture !== false);
  const rootProxyCache = verifierWeakMap<object, object>();
  const replicaCollectionCache = verifierWeakMap<object, object>();
  const readBuilderProxyCache = verifierWeakMap<object, object>();
  const mutationReadBuilderProxyCache = verifierWeakMap<object, object>();
  const mutationQueryBuilderProxyCache = verifierWeakMap<object, object>();
  const relationalBuilderProxyCache = verifierWeakMap<object, object>();
  const relationalNamespaceProxyCache = verifierWeakMap<object, object>();
  const cteBuilderProxyCache = verifierWeakMap<object, object>();
  const mutationCteBuilderProxyCache = verifierWeakMap<object, object>();
  const derivedReadSourceWitness = verifierWeakMap<object, true>();
  const readBuilderRawTargets = verifierWeakMap<object, object>();
  const insertEntryBuilderProxyCache = verifierWeakMap<object, object>();
  const updateEntryBuilderProxyCache = verifierWeakMap<object, object>();
  const insertBaseBuilderProxyCache = verifierWeakMap<object, object>();
  const updateBaseBuilderProxyCache = verifierWeakMap<object, object>();
  const deleteBaseBuilderProxyCache = verifierWeakMap<object, object>();
  const writePreparedProxyCache = verifierWeakMap<object, object>();
  const sqlHandleProxyCache = verifierWeakMap<object, object>();
  const preparedSqlProxyCache = verifierWeakMap<object, object>();
  const methodCache = verifierWeakMap<object, Map<PropertyKey, CachedMethod>>();
  const preparedSqlMethodCache = verifierWeakMap<object, Map<PropertyKey, CachedMethod>>();
  const mutationMethodCache = verifierWeakMap<object, Map<PropertyKey, CachedMethod>>();
  const writeEntryMethodCache = verifierWeakMap<object, Map<PropertyKey, CachedMethod>>();
  const writeBaseMethodCache = verifierWeakMap<object, Map<PropertyKey, CachedMethod>>();
  const writePreparedMethodCache = verifierWeakMap<object, Map<PropertyKey, CachedMethod>>();
  const writeBuilderContext: DrizzleWriteBuilderContext = {
    baseCaches: {
      delete: deleteBaseBuilderProxyCache,
      insert: insertBaseBuilderProxyCache,
      update: updateBaseBuilderProxyCache,
    },
    baseMethodCache: writeBaseMethodCache,
    cteCache: mutationCteBuilderProxyCache,
    derivedSources: derivedReadSourceWitness,
    entryCaches: {
      insert: insertEntryBuilderProxyCache,
      update: updateEntryBuilderProxyCache,
    },
    entryMethodCache: writeEntryMethodCache,
    mutationMethodCache,
    preparedCache: writePreparedProxyCache,
    queryBuilderCache: mutationQueryBuilderProxyCache,
    readBuilderCache: mutationReadBuilderProxyCache,
    readBuilderRawTargets,
    recorder,
    preparedMethodCache: writePreparedMethodCache,
    config: configSnapshot,
  };

  const verifier: DbVerifier = {
    assertCovered(touchGraphKey?: string): void {
      assertObservedWritesCovered(
        recorder.observed,
        touchGraphSnapshot,
        configSnapshot,
        touchGraphKey,
      );
    },
    assertCoveredOperations(
      observed: readonly ObservedDbOperation[],
      touchGraphKey?: string,
    ): void {
      assertObservedWritesCovered(
        snapshotObservedOperations(observed),
        touchGraphSnapshot,
        configSnapshot,
        touchGraphKey,
        true,
      );
    },
    assertCoveredSince(start: number, touchGraphKey?: string): void {
      assertObservedWritesCovered(
        recorder.slice(start),
        touchGraphSnapshot,
        configSnapshot,
        touchGraphKey,
        true,
      );
    },
    assertNoWritesOperations(observed: readonly ObservedDbOperation[]): void {
      assertObservedWritesCovered(
        snapshotObservedOperations(observed),
        emptyTouchGraphSnapshot,
        configSnapshot,
      );
    },
    assertReadsCovered(domains: readonly string[]): void {
      assertObservedReadsCovered(recorder.observed, snapshotDomains(domains), configSnapshot);
    },
    assertReadsCoveredOperations(
      observed: readonly ObservedDbOperation[],
      domains: readonly string[],
    ): void {
      assertObservedReadsCovered(
        snapshotObservedOperations(observed),
        snapshotDomains(domains),
        configSnapshot,
      );
    },
    assertReadsCoveredSince(start: number, domains: readonly string[]): void {
      assertObservedReadsCovered(recorder.slice(start), snapshotDomains(domains), configSnapshot);
    },
    capture<T>(
      callback: () => T | Promise<T>,
    ): Promise<{ observed: readonly ObservedDbOperation[]; result: T }> {
      return recorder.capture(callback);
    },
    diagnostics(): DbVerificationDiagnostic[] {
      return diagnosticsForObservations(recorder.observed, touchGraphSnapshot);
    },
    get observed(): readonly ObservedDbOperation[] {
      return recorder.observed;
    },
    wrap<Db>(db: Db): Db {
      if (typeof db !== 'object' || db === null) return db;
      const cached = verifierWeakMapGet(rootProxyCache, db);
      if (cached) return cached as Db;

      // SPEC.md §11.4: verification observes calls that cross the harness
      // DB seam. A raw handle captured before wrap() never reaches this proxy;
      // tests must pass and use the wrapped harness DB handle instead.
      let proxy!: Record<PropertyKey, unknown>;
      proxy = createFrameworkManagedSqlDispatchProxy(
        db as Record<string, unknown>,
        {
          get(target, prop, receiver) {
            if (prop === '__kovoObserved') return recorder.observed;
            const value = verifierReflectGet(target, prop, receiver);

            if (
              (prop === kovoReadonlyDbHandle || prop === kovoDeclaredWriteDbHandle) &&
              typeof value === 'function'
            ) {
              return cachedMethod(target, prop, value, methodCache, () => () => {
                throw verifierTypeError(
                  'Kovo DB verifier adapter capability hooks are reserved for the framework lifecycle.',
                );
              });
            }

            if (isDrizzleSelectEntry(prop) && typeof value === 'function') {
              return cachedMethod(target, prop, value, methodCache, () => (...args: unknown[]) => {
                const builder = verifierApply<unknown>(value, target, args);
                if (typeof builder !== 'object' || builder === null) {
                  throw verifierTypeError(
                    `Kovo DB verifier ${verifierString(prop)}() must return a read builder object.`,
                  );
                }
                return wrapDrizzleReadBuilder(
                  builder,
                  configSnapshot,
                  recorder,
                  readBuilderProxyCache,
                  methodCache,
                  derivedReadSourceWitness,
                  readBuilderRawTargets,
                );
              });
            }

            if (prop === '$count' && typeof value === 'function') {
              return cachedMethod(
                target,
                prop,
                value,
                methodCache,
                () =>
                  (table: unknown, ...args: unknown[]) => {
                    observeRequiredTableOperation('read', table, args, configSnapshot, recorder);
                    return verifierApply(value, target, [table, ...args]);
                  },
              );
            }

            if (prop === '$with' && typeof value === 'function') {
              return cachedMethod(target, prop, value, methodCache, () => (...args: unknown[]) => {
                const builder = verifierApply<unknown>(value, target, args);
                if (typeof builder !== 'object' || builder === null) {
                  throw verifierTypeError(
                    'Kovo DB verifier $with() must return a CTE builder object.',
                  );
                }
                return wrapDrizzleCteBuilder(
                  builder,
                  (queryBuilder) => verifier.wrap(queryBuilder),
                  cteBuilderProxyCache,
                  methodCache,
                  derivedReadSourceWitness,
                );
              });
            }

            if (prop === 'with' && typeof value === 'function') {
              return cachedMethod(target, prop, value, methodCache, () => (...args: unknown[]) => {
                const scopedDb = verifierApply<unknown>(value, target, args);
                if (typeof scopedDb !== 'object' || scopedDb === null) {
                  throw verifierTypeError(
                    'Kovo DB verifier with() must return a DB builder object.',
                  );
                }
                return verifier.wrap(scopedDb);
              });
            }

            if (prop === 'query' && typeof value === 'object' && value !== null) {
              return wrapRelationalNamespace(
                value,
                configSnapshot,
                recorder,
                relationalNamespaceProxyCache,
                relationalBuilderProxyCache,
                methodCache,
              );
            }

            if (isSqlHandleProperty(prop) || prop === 'session') {
              if (typeof value !== 'object' || value === null) {
                throw verifierTypeError(
                  `Kovo DB verifier nested SQL handle ${verifierString(prop)} must be an object.`,
                );
              }
              return wrapSqlHandle(
                value,
                configSnapshot,
                recorder,
                sqlHandleProxyCache,
                methodCache,
                preparedSqlProxyCache,
                preparedSqlMethodCache,
                (transactionDb) => verifier.wrap(transactionDb),
              );
            }

            if (prop === '$primary') {
              if (typeof value !== 'object' || value === null) {
                throw verifierTypeError('Kovo DB verifier $primary handle must be an object.');
              }
              return verifier.wrap(value);
            }

            if (prop === '$replicas') {
              return wrapReplicaCollection(value, replicaCollectionCache, (entry) =>
                verifier.wrap(entry),
              );
            }

            if (prop === 'transaction' && typeof value === 'function') {
              return cachedMethod(target, prop, value, methodCache, () =>
                verifiedTransactionMethod(target, value, (transactionDb) =>
                  verifier.wrap(transactionDb),
                ),
              );
            }

            if (prop === 'read' && typeof value === 'function') {
              return cachedMethod(target, prop, value, methodCache, () =>
                observableTableMethod('read', target, value, configSnapshot, recorder),
              );
            }

            if (prop === 'write' && typeof value === 'function') {
              return cachedMethod(target, prop, value, methodCache, () =>
                observableTableMethod('write', target, value, configSnapshot, recorder),
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
              return cachedMethod(
                target,
                prop,
                value,
                methodCache,
                () =>
                  (table: unknown, ...args: unknown[]) => {
                    observeRequiredTableOperation('write', table, args, configSnapshot, recorder);
                    const builder = verifierApply<unknown>(value, target, [table, ...args]);
                    if (typeof builder !== 'object' || builder === null) return builder;
                    return wrapDrizzleWriteBuilder(
                      builder,
                      prop,
                      prop === 'delete' ? 'base' : 'entry',
                      writeBuilderContext,
                    );
                  },
              );
            }

            if (prop === 'sql' && typeof value === 'function' && isDbAdapterLike(target)) {
              return cachedMethod(target, prop, value, methodCache, () =>
                observableSqlMethod(target, value, configSnapshot, recorder),
              );
            }

            if (
              (prop === 'query' || prop === 'exec' || prop === 'execute') &&
              typeof value === 'function' &&
              (isDbAdapterLike(target) || isSqlHandleLike(target))
            ) {
              return cachedMethod(target, prop, value, methodCache, () =>
                observableSqlMethod(target, value, configSnapshot, recorder),
              );
            }

            if (prop === 'prepare' && typeof value === 'function' && isSqlHandleLike(target)) {
              return cachedMethod(target, prop, value, methodCache, () =>
                observablePrepareMethod(
                  target,
                  value,
                  configSnapshot,
                  recorder,
                  preparedSqlProxyCache,
                  preparedSqlMethodCache,
                  (preparedResult) => verifier.wrap(preparedResult),
                ),
              );
            }

            return typeof value === 'function'
              ? cachedMethod(
                  target,
                  prop,
                  value,
                  methodCache,
                  () =>
                    (...args: unknown[]) =>
                      verifierApply(value, target, args),
                )
              : value;
          },
          getOwnPropertyDescriptor(target, prop) {
            return safeReflectedOwnDescriptor(target, prop, () =>
              verifierReflectGet(proxy, prop, proxy),
            );
          },
          getPrototypeOf() {
            return null;
          },
        },
        'test-fixture',
      );

      verifierWeakMapSet(rootProxyCache, db, proxy);
      return proxy as Db;
    },
  };
  return verifier;
}

function wrapReplicaCollection(
  value: unknown,
  cache: WeakMap<object, object>,
  wrap: <Db>(db: Db) => Db,
): readonly object[] {
  if (typeof value !== 'object' || value === null) {
    throw verifierTypeError('Kovo DB verifier $replicas must be a dense array of DB handles.');
  }
  const cached = verifierWeakMapGet(cache, value);
  if (cached !== undefined) return cached as readonly object[];
  const snapshot = verifierDenseArraySnapshot(value, 'Kovo DB verifier $replicas', (entry) => {
    if (typeof entry !== 'object' || entry === null) {
      throw verifierTypeError('Kovo DB verifier $replicas entries must be DB handle objects.');
    }
    return wrap(entry);
  });
  verifierWeakMapSet(cache, value, snapshot as object);
  return snapshot;
}

type DrizzleWriteFamily = 'delete' | 'insert' | 'update';
type DrizzleWritePhase = 'base' | 'entry';

// SPEC §11.2/§14: a Drizzle DML entry is only the first step of an executable authority chain.
// Keep every intermediate builder, insert-select QueryBuilder, and prepared result behind the
// verifier membrane so source-table reads cannot disappear after the target write is observed.
interface DrizzleWriteBuilderContext {
  baseCaches: Record<DrizzleWriteFamily, WeakMap<object, object>>;
  baseMethodCache: WeakMap<object, Map<PropertyKey, CachedMethod>>;
  config: DbVerificationConfig;
  cteCache: WeakMap<object, object>;
  derivedSources: WeakMap<object, true>;
  entryCaches: Record<Exclude<DrizzleWriteFamily, 'delete'>, WeakMap<object, object>>;
  entryMethodCache: WeakMap<object, Map<PropertyKey, CachedMethod>>;
  mutationMethodCache: WeakMap<object, Map<PropertyKey, CachedMethod>>;
  preparedCache: WeakMap<object, object>;
  preparedMethodCache: WeakMap<object, Map<PropertyKey, CachedMethod>>;
  queryBuilderCache: WeakMap<object, object>;
  readBuilderCache: WeakMap<object, object>;
  readBuilderRawTargets: WeakMap<object, object>;
  recorder: ObservationRecorder;
}

function writeBuilderCache(
  family: DrizzleWriteFamily,
  phase: DrizzleWritePhase,
  context: DrizzleWriteBuilderContext,
): WeakMap<object, object> {
  if (phase === 'base') return context.baseCaches[family];
  if (family === 'delete') {
    throw verifierTypeError('KV407: Drizzle delete() must enter a base write builder.');
  }
  return context.entryCaches[family];
}

function wrapDrizzleWriteBuilder(
  builder: object,
  family: DrizzleWriteFamily,
  phase: DrizzleWritePhase,
  context: DrizzleWriteBuilderContext,
): object {
  const cache = writeBuilderCache(family, phase, context);
  const methodCache = phase === 'entry' ? context.entryMethodCache : context.baseMethodCache;
  const cached = verifierWeakMapGet(cache, builder);
  if (cached !== undefined) return cached;

  let proxy!: Record<PropertyKey, unknown>;
  proxy = createFrameworkManagedSqlDispatchProxy(
    builder as Record<PropertyKey, unknown>,
    {
      get(target, property, receiver) {
        const value = verifierReflectGet(target, property, receiver);
        if (property === 'then' && value === undefined) return undefined;
        if (typeof value !== 'function') return blockedWriteBuilderProperty(property);

        if (phase === 'entry') {
          if (family === 'insert' && property === 'select') {
            return cachedMethod(
              target,
              property,
              value,
              methodCache,
              () =>
                (query: unknown, ...args: unknown[]) => {
                  const safeQuery = safeInsertSelectQuery(query, context);
                  const result = verifierApply<unknown>(value, target, [safeQuery, ...args]);
                  return requiredDrizzleWriteBuilderResult(
                    result,
                    family,
                    'base',
                    context,
                    property,
                  );
                },
            );
          }

          if (family === 'insert' && property === 'values') {
            return cachedMethod(
              target,
              property,
              value,
              methodCache,
              () =>
                (...args: unknown[]) =>
                  requiredDrizzleWriteBuilderResult(
                    verifierApply(value, target, args),
                    family,
                    'base',
                    context,
                    property,
                  ),
            );
          }

          if (
            family === 'insert' &&
            (property === 'ignore' || property === 'overridingSystemValue')
          ) {
            return cachedMethod(
              target,
              property,
              value,
              methodCache,
              () =>
                (...args: unknown[]) =>
                  requiredDrizzleWriteBuilderResult(
                    verifierApply(value, target, args),
                    family,
                    'entry',
                    context,
                    property,
                  ),
            );
          }

          if (family === 'update' && property === 'set') {
            return cachedMethod(
              target,
              property,
              value,
              methodCache,
              () =>
                (...args: unknown[]) =>
                  requiredDrizzleWriteBuilderResult(
                    verifierApply(value, target, args),
                    family,
                    'base',
                    context,
                    property,
                  ),
            );
          }

          return blockedWriteBuilderProperty(property);
        }

        if (isDrizzleWriteReadSourceMethod(family, property)) {
          return cachedMethod(
            target,
            property,
            value,
            methodCache,
            () =>
              (table: unknown, ...args: unknown[]) => {
                if (
                  typeof table !== 'object' ||
                  table === null ||
                  verifierWeakMapGet(context.derivedSources, table) !== true
                ) {
                  observeRequiredTableOperation(
                    'read',
                    table,
                    args,
                    context.config,
                    context.recorder,
                    true,
                  );
                }
                return requiredDrizzleWriteBuilderResult(
                  verifierApply(value, target, [table, ...args]),
                  family,
                  'base',
                  context,
                  property,
                );
              },
          );
        }

        if (isDrizzleWriteChainMethod(family, property)) {
          return cachedMethod(
            target,
            property,
            value,
            methodCache,
            () =>
              (...args: unknown[]) =>
                requiredDrizzleWriteBuilderResult(
                  verifierApply(value, target, args),
                  family,
                  'base',
                  context,
                  property,
                ),
          );
        }

        if (property === 'prepare') {
          return cachedMethod(target, property, value, methodCache, () => (...args: unknown[]) => {
            const prepared = verifierApply<unknown>(value, target, args);
            if (typeof prepared !== 'object' || prepared === null) {
              throw verifierTypeError(
                'KV407: Kovo DB verifier write-builder prepare() must return an object.',
              );
            }
            return wrapDrizzlePreparedWrite(prepared, context);
          });
        }

        if (isDrizzleWriteTerminalMethod(property)) {
          return cachedMethod(
            target,
            property,
            value,
            methodCache,
            () =>
              (...args: unknown[]) =>
                verifierApply(value, target, args),
          );
        }

        return blockedWriteBuilderProperty(property);
      },
      getOwnPropertyDescriptor(target, property) {
        return safeReflectedOwnDescriptor(target, property, () =>
          verifierReflectGet(proxy, property, proxy),
        );
      },
      getPrototypeOf() {
        return null;
      },
    },
    'test-fixture',
  );
  verifierWeakMapSet(cache, builder, proxy);
  return proxy;
}

function requiredDrizzleWriteBuilderResult(
  result: unknown,
  family: DrizzleWriteFamily,
  phase: DrizzleWritePhase,
  context: DrizzleWriteBuilderContext,
  property: PropertyKey,
): object {
  if (typeof result !== 'object' || result === null) {
    throw verifierTypeError(
      `KV407: Kovo DB verifier write-builder ${verifierString(property)}() must return an object.`,
    );
  }
  return wrapDrizzleWriteBuilder(result, family, phase, context);
}

function safeInsertSelectQuery(query: unknown, context: DrizzleWriteBuilderContext): unknown {
  if (typeof query === 'function') {
    return (queryBuilder: unknown) => {
      const selected = verifierApply<unknown>(query, undefined, [
        wrapDrizzleMutationQueryBuilder(queryBuilder, context),
      ]);
      return unwrapVerifiedInsertSelect(selected, context);
    };
  }
  return unwrapVerifiedInsertSelect(query, context);
}

function unwrapVerifiedInsertSelect(
  selected: unknown,
  context: DrizzleWriteBuilderContext,
): object {
  if (typeof selected === 'object' && selected !== null) {
    const raw = verifierWeakMapGet(context.readBuilderRawTargets, selected);
    if (raw !== undefined) return raw;
  }
  throw verifierTypeError(
    'KV407: insert-select reads must return a verifier-wrapped read builder.',
  );
}

function wrapDrizzleMutationQueryBuilder(
  queryBuilder: unknown,
  context: DrizzleWriteBuilderContext,
): object {
  if (typeof queryBuilder !== 'object' || queryBuilder === null) {
    throw verifierTypeError('KV407: insert-select callback must receive a query-builder object.');
  }
  const cached = verifierWeakMapGet(context.queryBuilderCache, queryBuilder);
  if (cached !== undefined) return cached;

  let proxy!: Record<PropertyKey, unknown>;
  proxy = createFrameworkManagedSqlDispatchProxy(
    queryBuilder as Record<PropertyKey, unknown>,
    {
      get(target, property, receiver) {
        const value = verifierReflectGet(target, property, receiver);
        if (typeof value !== 'function') return blockedMutationQueryBuilderProperty(property);

        if (isDrizzleSelectEntry(property)) {
          return cachedMethod(
            target,
            property,
            value,
            context.mutationMethodCache,
            () =>
              (...args: unknown[]) => {
                const builder = verifierApply<unknown>(value, target, args);
                if (typeof builder !== 'object' || builder === null) {
                  throw verifierTypeError(
                    `KV407: insert-select ${verifierString(property)}() must return a builder object.`,
                  );
                }
                return wrapDrizzleReadBuilder(
                  builder,
                  context.config,
                  context.recorder,
                  context.readBuilderCache,
                  context.mutationMethodCache,
                  context.derivedSources,
                  context.readBuilderRawTargets,
                  true,
                );
              },
          );
        }

        if (property === '$with') {
          return cachedMethod(
            target,
            property,
            value,
            context.mutationMethodCache,
            () =>
              (...args: unknown[]) => {
                const builder = verifierApply<unknown>(value, target, args);
                if (typeof builder !== 'object' || builder === null) {
                  throw verifierTypeError('KV407: insert-select $with() must return an object.');
                }
                return wrapDrizzleCteBuilder(
                  builder,
                  (next) => wrapDrizzleMutationQueryBuilder(next, context),
                  context.cteCache,
                  context.mutationMethodCache,
                  context.derivedSources,
                );
              },
          );
        }

        if (property === 'with') {
          return cachedMethod(
            target,
            property,
            value,
            context.mutationMethodCache,
            () =>
              (...args: unknown[]) =>
                wrapDrizzleMutationQueryBuilder(verifierApply(value, target, args), context),
          );
        }

        return blockedMutationQueryBuilderProperty(property);
      },
      getOwnPropertyDescriptor(target, property) {
        return safeReflectedOwnDescriptor(target, property, () =>
          verifierReflectGet(proxy, property, proxy),
        );
      },
      getPrototypeOf() {
        return null;
      },
    },
    'test-fixture',
  );
  verifierWeakMapSet(context.queryBuilderCache, queryBuilder, proxy);
  return proxy;
}

function wrapDrizzlePreparedWrite(prepared: object, context: DrizzleWriteBuilderContext): object {
  const cached = verifierWeakMapGet(context.preparedCache, prepared);
  if (cached !== undefined) return cached;
  let proxy!: Record<PropertyKey, unknown>;
  proxy = createFrameworkManagedSqlDispatchProxy(
    prepared as Record<PropertyKey, unknown>,
    {
      get(target, property, receiver) {
        const value = verifierReflectGet(target, property, receiver);
        if (property === 'then' && value === undefined) return undefined;
        if (typeof value !== 'function' || !isDrizzlePreparedExecutionMethod(property)) {
          return blockedWriteBuilderProperty(property);
        }
        return cachedMethod(
          target,
          property,
          value,
          context.preparedMethodCache,
          () =>
            (...args: unknown[]) =>
              verifierApply(value, target, args),
        );
      },
      getOwnPropertyDescriptor(target, property) {
        return safeReflectedOwnDescriptor(target, property, () =>
          verifierReflectGet(proxy, property, proxy),
        );
      },
      getPrototypeOf() {
        return null;
      },
    },
    'test-fixture',
  );
  verifierWeakMapSet(context.preparedCache, prepared, proxy);
  return proxy;
}

function wrapDrizzleReadBuilder(
  builder: object,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
  cache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, CachedMethod>>,
  derivedSources: WeakMap<object, true>,
  rawTargets: WeakMap<object, object>,
  mutationRead?: boolean,
): object {
  const cached = verifierWeakMapGet(cache, builder);
  if (cached !== undefined) return cached;
  let proxy!: Record<PropertyKey, unknown>;
  proxy = createFrameworkManagedSqlDispatchProxy(
    builder as Record<PropertyKey, unknown>,
    {
      get(target, property, receiver) {
        const value = verifierReflectGet(target, property, receiver);
        if (property === 'then' && value === undefined) return undefined;
        if (typeof value !== 'function') return blockedReadBuilderProperty(property);

        if (isDrizzleReadTableMethod(property)) {
          return cachedMethod(
            target,
            property,
            value,
            methodCache,
            () =>
              (table: unknown, ...args: unknown[]) => {
                if (
                  typeof table !== 'object' ||
                  table === null ||
                  verifierWeakMapGet(derivedSources, table) !== true
                ) {
                  observeRequiredTableOperation(
                    'read',
                    table,
                    args,
                    config,
                    recorder,
                    mutationRead,
                  );
                }
                const result = verifierApply<unknown>(value, target, [table, ...args]);
                return wrapDrizzleBuilderResult(
                  result,
                  config,
                  recorder,
                  cache,
                  methodCache,
                  derivedSources,
                  rawTargets,
                  false,
                  mutationRead,
                );
              },
          );
        }

        if (isDrizzleReadChainMethod(property)) {
          return cachedMethod(target, property, value, methodCache, () => (...args: unknown[]) => {
            const result = verifierApply<unknown>(value, target, args);
            return wrapDrizzleBuilderResult(
              result,
              config,
              recorder,
              cache,
              methodCache,
              derivedSources,
              rawTargets,
              property === 'as',
              mutationRead,
            );
          });
        }

        if (isDrizzleReadTerminalMethod(property)) {
          return cachedMethod(
            target,
            property,
            value,
            methodCache,
            () =>
              (...args: unknown[]) =>
                verifierApply(value, target, args),
          );
        }

        return blockedReadBuilderProperty(property);
      },
      getOwnPropertyDescriptor(target, property) {
        return safeReflectedOwnDescriptor(target, property, () =>
          verifierReflectGet(proxy, property, proxy),
        );
      },
      getPrototypeOf() {
        return null;
      },
    },
    'test-fixture',
  );
  verifierWeakMapSet(cache, builder, proxy);
  verifierWeakMapSet(derivedSources, proxy, true);
  verifierWeakMapSet(rawTargets, proxy, builder);
  return proxy;
}

function wrapDrizzleBuilderResult(
  result: unknown,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
  cache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, CachedMethod>>,
  derivedSources: WeakMap<object, true>,
  rawTargets: WeakMap<object, object>,
  derived: boolean,
  mutationRead: boolean | undefined,
): unknown {
  if (typeof result !== 'object' || result === null) return result;
  const wrapped = wrapDrizzleReadBuilder(
    result,
    config,
    recorder,
    cache,
    methodCache,
    derivedSources,
    rawTargets,
    mutationRead,
  );
  if (derived) {
    verifierWeakMapSet(derivedSources, result, true);
    verifierWeakMapSet(derivedSources, wrapped, true);
  }
  return wrapped;
}

function wrapRelationalNamespace(
  namespace: object,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
  namespaceCache: WeakMap<object, object>,
  builderCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, CachedMethod>>,
): object {
  const cached = verifierWeakMapGet(namespaceCache, namespace);
  if (cached !== undefined) return cached;
  let proxy!: Record<PropertyKey, unknown>;
  proxy = createFrameworkManagedSqlDispatchProxy(
    namespace as Record<PropertyKey, unknown>,
    {
      get(target, property, receiver) {
        const builder = verifierReflectGet(target, property, receiver);
        if (typeof builder !== 'object' || builder === null) {
          throw verifierTypeError(
            `KV407: relational query namespace ${verifierString(property)} must resolve to a builder object.`,
          );
        }
        return wrapRelationalBuilder(
          builder,
          relationalTableCarrier(builder, property),
          config,
          recorder,
          builderCache,
          methodCache,
        );
      },
      getOwnPropertyDescriptor(target, property) {
        return safeReflectedOwnDescriptor(target, property, () =>
          verifierReflectGet(proxy, property, proxy),
        );
      },
      getPrototypeOf() {
        return null;
      },
    },
    'test-fixture',
  );
  verifierWeakMapSet(namespaceCache, namespace, proxy);
  return proxy;
}

function relationalTableCarrier(builder: object, property: PropertyKey): unknown {
  const table = verifierGetOwnPropertyDescriptor(builder, 'table');
  if (table !== undefined) {
    if (!('value' in table)) {
      throw verifierTypeError(
        'KV407: relational query builder table must be an own data property.',
      );
    }
    return table.value;
  }
  if (typeof property !== 'string') {
    throw verifierTypeError('KV407: relational query table identity must be a string property.');
  }
  return property;
}

function wrapRelationalBuilder(
  builder: object,
  table: unknown,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
  cache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, CachedMethod>>,
): object {
  const cached = verifierWeakMapGet(cache, builder);
  if (cached !== undefined) return cached;
  let proxy!: Record<PropertyKey, unknown>;
  proxy = createFrameworkManagedSqlDispatchProxy(
    builder as Record<PropertyKey, unknown>,
    {
      get(target, property, receiver) {
        const value = verifierReflectGet(target, property, receiver);
        if (property === 'then' && value === undefined) return undefined;
        if (!isRelationalReadMethod(property) || typeof value !== 'function') {
          return blockedRelationalBuilderProperty(property);
        }
        return cachedMethod(target, property, value, methodCache, () => (...args: unknown[]) => {
          assertRelationalReadArguments(args);
          observeRequiredTableOperation('read', table, args, config, recorder);
          return verifierApply(value, target, args);
        });
      },
      getOwnPropertyDescriptor(target, property) {
        return safeReflectedOwnDescriptor(target, property, () =>
          verifierReflectGet(proxy, property, proxy),
        );
      },
      getPrototypeOf() {
        return null;
      },
    },
    'test-fixture',
  );
  verifierWeakMapSet(cache, builder, proxy);
  return proxy;
}

function assertRelationalReadArguments(args: readonly unknown[]): void {
  if (args.length > 1) {
    throw verifierTypeError('KV407: relational query methods accept at most one config object.');
  }
  const config = args[0];
  if (config === undefined) return;
  if (typeof config !== 'object' || config === null) {
    throw verifierTypeError('KV407: relational query config must be an object.');
  }
  const withDescriptor = verifierGetOwnPropertyDescriptor(config, 'with');
  if (withDescriptor === undefined) return;
  if (!('value' in withDescriptor)) {
    throw verifierTypeError('KV407: relational query config.with must be an own data property.');
  }
  if (withDescriptor.value !== undefined && withDescriptor.value !== false) {
    throw verifierTypeError(
      'KV407: runtime verification requires nested relational reads to use explicit query declarations.',
    );
  }
}

function wrapDrizzleCteBuilder(
  builder: object,
  wrapQueryBuilder: (queryBuilder: unknown) => unknown,
  cache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, CachedMethod>>,
  derivedSources: WeakMap<object, true>,
): object {
  const cached = verifierWeakMapGet(cache, builder);
  if (cached !== undefined) return cached;
  let proxy!: Record<PropertyKey, unknown>;
  proxy = createFrameworkManagedSqlDispatchProxy(
    builder as Record<PropertyKey, unknown>,
    {
      get(target, property, receiver) {
        const value = verifierReflectGet(target, property, receiver);
        if (property !== 'as' || typeof value !== 'function') {
          return blockedReadBuilderProperty(property);
        }
        return cachedMethod(
          target,
          property,
          value,
          methodCache,
          () =>
            (query: unknown, ...args: unknown[]) => {
              if (
                typeof query !== 'function' &&
                (typeof query !== 'object' ||
                  query === null ||
                  verifierWeakMapGet(derivedSources, query) !== true)
              ) {
                throw verifierTypeError(
                  'KV407: CTE reads must be built through the verifier-wrapped query builder.',
                );
              }
              const safeQuery =
                typeof query === 'function'
                  ? (queryBuilder: unknown) =>
                      verifierApply(query, undefined, [wrapQueryBuilder(queryBuilder)])
                  : query;
              const derived = verifierApply<unknown>(value, target, [safeQuery, ...args]);
              if (typeof derived === 'object' && derived !== null) {
                verifierWeakMapSet(derivedSources, derived, true);
              }
              return derived;
            },
        );
      },
      getOwnPropertyDescriptor(target, property) {
        return safeReflectedOwnDescriptor(target, property, () =>
          verifierReflectGet(proxy, property, proxy),
        );
      },
      getPrototypeOf() {
        return null;
      },
    },
    'test-fixture',
  );
  verifierWeakMapSet(cache, builder, proxy);
  return proxy;
}

function blockedWriteBuilderProperty(property: PropertyKey): () => never {
  return () => {
    throw verifierTypeError(
      `KV407: Kovo DB verifier blocked unsupported write-builder property ${verifierString(property)}.`,
    );
  };
}

function blockedMutationQueryBuilderProperty(property: PropertyKey): () => never {
  return () => {
    throw verifierTypeError(
      `KV407: Kovo DB verifier blocked unsupported insert-select query-builder property ${verifierString(property)}.`,
    );
  };
}

function isDrizzleWriteReadSourceMethod(
  family: DrizzleWriteFamily,
  property: PropertyKey,
): boolean {
  if (family === 'update') {
    return (
      property === 'from' ||
      property === 'leftJoin' ||
      property === 'rightJoin' ||
      property === 'innerJoin' ||
      property === 'fullJoin'
    );
  }
  return family === 'delete' && property === 'using';
}

function isDrizzleWriteChainMethod(family: DrizzleWriteFamily, property: PropertyKey): boolean {
  if (property === '$dynamic' || property === 'returning') return true;
  if (family === 'insert') {
    return (
      property === '$returningId' ||
      property === 'onConflictDoNothing' ||
      property === 'onConflictDoUpdate' ||
      property === 'onDuplicateKeyUpdate'
    );
  }
  return property === 'limit' || property === 'orderBy' || property === 'where';
}

function isDrizzleWriteTerminalMethod(property: PropertyKey): boolean {
  return (
    property === 'all' ||
    property === 'catch' ||
    property === 'execute' ||
    property === 'finally' ||
    property === 'get' ||
    property === 'getSQL' ||
    property === 'iterator' ||
    property === 'run' ||
    property === 'sync' ||
    property === 'then' ||
    property === 'toSQL' ||
    property === 'values'
  );
}

function isDrizzlePreparedExecutionMethod(property: PropertyKey): boolean {
  return isVerifierPreparedExecutionMethod(property);
}

function blockedReadBuilderProperty(property: PropertyKey): () => never {
  return () => {
    throw verifierTypeError(
      `KV407: Kovo DB verifier blocked unsupported read-builder property ${verifierString(property)}.`,
    );
  };
}

function blockedRelationalBuilderProperty(property: PropertyKey): () => never {
  return () => {
    throw verifierTypeError(
      `KV407: Kovo DB verifier blocked unsupported relational-builder property ${verifierString(property)}.`,
    );
  };
}

function isDrizzleSelectEntry(property: PropertyKey): boolean {
  return property === 'select' || property === 'selectDistinct' || property === 'selectDistinctOn';
}

function isDrizzleReadTableMethod(property: PropertyKey): boolean {
  return (
    property === 'from' ||
    property === 'leftJoin' ||
    property === 'rightJoin' ||
    property === 'innerJoin' ||
    property === 'fullJoin' ||
    property === 'crossJoin' ||
    property === 'leftJoinLateral' ||
    property === 'rightJoinLateral' ||
    property === 'innerJoinLateral' ||
    property === 'fullJoinLateral' ||
    property === 'crossJoinLateral'
  );
}

function isDrizzleReadChainMethod(property: PropertyKey): boolean {
  return (
    property === '$dynamic' ||
    property === 'as' ||
    property === 'except' ||
    property === 'exceptAll' ||
    property === 'for' ||
    property === 'groupBy' ||
    property === 'having' ||
    property === 'intersect' ||
    property === 'intersectAll' ||
    property === 'limit' ||
    property === 'mapWith' ||
    property === 'offset' ||
    property === 'orderBy' ||
    property === 'union' ||
    property === 'unionAll' ||
    property === 'where'
  );
}

function isDrizzleReadTerminalMethod(property: PropertyKey): boolean {
  return (
    property === 'all' ||
    property === 'catch' ||
    property === 'execute' ||
    property === 'finally' ||
    property === 'get' ||
    property === 'getSQL' ||
    property === 'iterator' ||
    property === 'prepare' ||
    property === 'run' ||
    property === 'sync' ||
    property === 'then' ||
    property === 'toSQL' ||
    property === 'values'
  );
}

function isRelationalReadMethod(property: PropertyKey): boolean {
  return (
    property === 'all' ||
    property === 'catch' ||
    property === 'execute' ||
    property === 'finally' ||
    property === 'findFirst' ||
    property === 'findMany' ||
    property === 'get' ||
    property === 'getSQL' ||
    property === 'prepare' ||
    property === 'sync' ||
    property === 'then' ||
    property === 'toSQL' ||
    property === 'values'
  );
}

// SPEC §11.2: transaction callbacks mint a fresh DB authority (and nested Drizzle transactions
// mint savepoint authorities). Re-wrap that value before authored code can observe any method.
function verifiedTransactionMethod(
  target: object,
  transaction: Function,
  wrapDb: (transactionDb: object) => object,
): (callback: unknown, ...args: unknown[]) => unknown {
  return (callback: unknown, ...args: unknown[]) => {
    const safeCallback = verifiedTransactionCallback(callback, wrapDb);
    return verifierApply(
      transaction,
      target,
      transactionDispatchArguments(safeCallback, snapshotTransactionArguments(args)),
    );
  };
}

function verifiedTransactionCallback(
  callback: unknown,
  wrapDb: (transactionDb: object) => object,
): (transactionDb: unknown, ...args: unknown[]) => unknown {
  if (typeof callback !== 'function') {
    throw verifierTypeError('KV407: Kovo DB verifier transaction() requires a callback function.');
  }
  return (transactionDb: unknown, ...args: unknown[]) => {
    if (args.length !== 0) {
      throw verifierTypeError(
        'KV407: Kovo DB verifier transaction callback received unsupported authority arguments.',
      );
    }
    if (typeof transactionDb !== 'object' || transactionDb === null) {
      throw verifierTypeError(
        'KV407: Kovo DB verifier transaction callback must receive a DB object.',
      );
    }
    return verifierApply(callback, undefined, [wrapDb(transactionDb)]);
  };
}

function snapshotTransactionArguments(args: readonly unknown[]): readonly unknown[] {
  if (args.length > 1) {
    throw verifierTypeError('KV407: Kovo DB verifier transaction() accepts at most one config.');
  }
  const config = args[0];
  if (config === undefined) return [];
  if (typeof config !== 'object' || config === null || verifierIsProxy(config)) {
    throw verifierTypeError('KV407: Kovo DB verifier transaction config must be a stable object.');
  }

  const snapshot = verifierNullRecord();
  const keys = verifierOwnKeys(config);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== 'string') {
      throw verifierTypeError('KV407: Kovo DB verifier transaction config must not use symbols.');
    }
    const descriptor = verifierGetOwnPropertyDescriptor(config, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw verifierTypeError(
        'KV407: Kovo DB verifier transaction config must use own data properties.',
      );
    }
    const value = descriptor.value;
    if (
      value !== null &&
      value !== undefined &&
      typeof value !== 'bigint' &&
      typeof value !== 'boolean' &&
      typeof value !== 'number' &&
      typeof value !== 'string'
    ) {
      throw verifierTypeError(
        `KV407: Kovo DB verifier transaction config ${key} must be primitive.`,
      );
    }
    verifierDefineProperty(snapshot, key, {
      enumerable: descriptor.enumerable === true,
      value,
    });
  }
  return verifierFreeze([verifierFreeze(snapshot)]);
}

function transactionDispatchArguments(
  callback: Function,
  args: readonly unknown[],
): readonly unknown[] {
  const dispatch: unknown[] = [callback];
  for (let index = 0; index < args.length; index += 1) {
    verifierArrayPush(dispatch, args[index]);
  }
  return dispatch;
}

function wrapSqlHandle<Handle extends object>(
  handle: Handle,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, CachedMethod>>,
  preparedProxyCache: WeakMap<object, object>,
  preparedMethodCache: WeakMap<object, Map<PropertyKey, CachedMethod>>,
  wrapDb: (transactionDb: object) => object,
): Handle {
  const cached = verifierWeakMapGet(proxyCache, handle);
  if (cached) return cached as Handle;

  let proxy!: Handle;
  proxy = createFrameworkManagedSqlDispatchProxy(handle as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const value = verifierReflectGet(target, prop, receiver);

      if (prop === 'transaction' && typeof value === 'function') {
        return cachedMethod(
          target,
          prop,
          value,
          methodCache,
          () =>
            async (callback: unknown, ...args: unknown[]) => {
              const safeCallback = verifiedTransactionCallback(callback, wrapDb);
              const safeArgs = snapshotTransactionArguments(args);
              const before = await tableObservationSnapshots(
                target,
                verifierObjectKeys(config.domainByTable),
                config.sqlDialect,
              );
              const start = recorder.length();
              let failed = false;
              let failure: unknown;
              let result: unknown;
              try {
                result = await verifierApply(
                  value,
                  target,
                  transactionDispatchArguments(safeCallback, safeArgs),
                );
              } catch (error) {
                failed = true;
                failure = error;
              }
              await observeSqlEngineSideEffects(
                target,
                '<transaction>',
                config,
                recorder,
                recorder.slice(start),
                before,
              );
              if (failed) throw failure;
              return result;
            },
        );
      }

      if (
        (prop === 'query' || prop === 'exec' || prop === 'execute') &&
        typeof value === 'function'
      ) {
        return cachedMethod(target, prop, value, methodCache, () =>
          observableSqlMethod(target, value, config, recorder),
        );
      }

      if (prop === 'prepare' && typeof value === 'function') {
        return cachedMethod(target, prop, value, methodCache, () =>
          observablePrepareMethod(
            target,
            value,
            config,
            recorder,
            preparedProxyCache,
            preparedMethodCache,
            wrapDb,
          ),
        );
      }

      return typeof value === 'function'
        ? cachedMethod(
            target,
            prop,
            value,
            methodCache,
            () =>
              (...args: unknown[]) =>
                verifierApply(value, target, args),
          )
        : value;
    },
    getOwnPropertyDescriptor(target, prop) {
      return safeReflectedOwnDescriptor(target, prop, () => verifierReflectGet(proxy, prop, proxy));
    },
    getPrototypeOf() {
      return null;
    },
  }) as Handle;

  verifierWeakMapSet(proxyCache, handle, proxy);
  return proxy;
}

function observablePrepareMethod(
  target: object,
  value: Function,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, CachedMethod>>,
  wrapDb: (preparedResult: object) => object,
): (statement: unknown, ...args: unknown[]) => unknown {
  return (statement: unknown, ...args: unknown[]) => {
    if (args.length !== 0) {
      throw verifierTypeError(
        'KV407: Kovo DB verifier prepare() accepts exactly one SQL statement.',
      );
    }
    const statementSnapshot = snapshotVerifierSqlStatement(statement);
    const prepared = verifierApply<unknown>(value, target, [statementSnapshot]);
    if (typeof prepared !== 'object' || prepared === null) {
      throw verifierTypeError('KV407: Kovo DB verifier prepare() must return a statement object.');
    }
    return wrapPreparedSqlStatement(
      prepared,
      target,
      statementSnapshot,
      config,
      recorder,
      proxyCache,
      methodCache,
      wrapDb,
    );
  };
}

function wrapPreparedSqlStatement<Statement extends object>(
  statementHandle: Statement,
  executionTarget: object,
  statement: unknown,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
  proxyCache: WeakMap<object, object>,
  methodCache: WeakMap<object, Map<PropertyKey, CachedMethod>>,
  wrapDb: (preparedResult: object) => object,
): Statement {
  const cached = verifierWeakMapGet(proxyCache, statementHandle);
  if (cached) return cached as Statement;

  let proxy!: Statement;
  proxy = createFrameworkManagedSqlDispatchProxy(statementHandle as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const value = preparedStatementPropertyValue(target, prop, receiver);
      if (prop === 'then' && value === undefined) return undefined;

      if (isVerifierPreparedExecutionMethod(prop) && typeof value === 'function') {
        return cachedMethod(target, prop, value, methodCache, () =>
          observablePreparedSqlMethod(
            executionTarget,
            target,
            value,
            statement,
            config,
            recorder,
            wrapDb,
          ),
        );
      }

      if (isPreparedConfigurationMethod(prop) && typeof value === 'function') {
        return cachedMethod(target, prop, value, methodCache, () => (...args: unknown[]) => {
          const configured = verifierApply<unknown>(value, target, args);
          if (typeof configured !== 'object' || configured === null) {
            throw verifierTypeError(
              `KV407: prepared statement ${verifierString(prop)}() must return an object.`,
            );
          }
          return wrapPreparedSqlStatement(
            configured,
            executionTarget,
            statement,
            config,
            recorder,
            proxyCache,
            methodCache,
            wrapDb,
          );
        });
      }

      if (prop === 'columns' && typeof value === 'function') {
        return cachedMethod(
          target,
          prop,
          value,
          methodCache,
          () =>
            (...args: unknown[]) =>
              wrapPreparedExecutionResult(verifierApply(value, target, args), wrapDb),
        );
      }

      if (typeof value === 'object' && value !== null) {
        throw verifierTypeError(
          `KV407: Kovo DB verifier blocked prepared-statement authority property ${verifierString(prop)}.`,
        );
      }
      if (typeof value === 'function') return blockedPreparedStatementProperty(prop);
      return value;
    },
    getOwnPropertyDescriptor(target, prop) {
      return safeReflectedOwnDescriptor(target, prop, () => verifierReflectGet(proxy, prop, proxy));
    },
    getPrototypeOf() {
      return null;
    },
  }) as Statement;

  verifierWeakMapSet(proxyCache, statementHandle, proxy);
  return proxy;
}

function preparedStatementPropertyValue(
  target: object,
  property: PropertyKey,
  receiver: object,
): unknown {
  // Framework-managed SQL handles are themselves proxies. Their witnessed get trap is the
  // authority choke, so preserve that composition; reject accessor execution on ordinary raw
  // statement objects before it can run outside observation (SPEC §11.2).
  if (verifierIsProxy(target)) return verifierReflectGet(target, property, receiver);
  const located = inheritedPropertyDescriptor(target, property);
  if (located === undefined) return undefined;
  if (!('value' in located.descriptor)) {
    throw verifierTypeError(
      `KV407: Kovo DB verifier prepared-statement property ${verifierString(property)} must be data-backed.`,
    );
  }
  return located.descriptor.value;
}

function isVerifierPreparedExecutionMethod(property: PropertyKey): boolean {
  return (
    isPreparedStatementExecutionMethod(property) ||
    property === 'catch' ||
    property === 'execute' ||
    property === 'finally' ||
    property === 'iterator' ||
    property === 'stream' ||
    property === 'sync' ||
    property === 'then' ||
    property === 'values' ||
    property === verifierAsyncIteratorProperty ||
    property === verifierIteratorProperty
  );
}

function isPreparedConfigurationMethod(property: PropertyKey): boolean {
  return (
    property === 'bind' ||
    property === 'expand' ||
    property === 'pluck' ||
    property === 'raw' ||
    property === 'safeIntegers'
  );
}

function blockedPreparedStatementProperty(property: PropertyKey): () => never {
  return () => {
    throw verifierTypeError(
      `KV407: Kovo DB verifier blocked unsupported prepared-statement property ${verifierString(property)}.`,
    );
  };
}

function wrapPreparedExecutionResult(
  result: unknown,
  wrapDb: (preparedResult: object) => object,
): unknown {
  if (typeof result !== 'object' || result === null) return result;
  if (verifierIsPromise(result)) {
    return verifierPromiseThen(result, (resolved) => wrapPreparedExecutionResult(resolved, wrapDb));
  }
  if (verifierIsProxy(result)) {
    throw verifierTypeError(
      'KV407: Kovo DB verifier prepared execution must not return a Proxy authority carrier.',
    );
  }
  if (preparedResultHasMethod(result, 'then')) {
    return verifierPromiseThen(verifierPromiseResolve(result as PromiseLike<unknown>), (resolved) =>
      wrapPreparedExecutionResult(resolved, wrapDb),
    );
  }
  if (
    preparedResultHasMethod(result, 'exec') ||
    preparedResultHasMethod(result, 'execute') ||
    preparedResultHasMethod(result, 'prepare') ||
    preparedResultHasMethod(result, 'query') ||
    preparedResultHasMethod(result, 'read') ||
    preparedResultHasMethod(result, 'sql') ||
    preparedResultHasMethod(result, 'transaction') ||
    preparedResultHasMethod(result, 'write')
  ) {
    return wrapDb(result);
  }
  return result;
}

function preparedResultHasMethod(result: object, property: PropertyKey): boolean {
  const located = inheritedPropertyDescriptor(result, property);
  if (located === undefined) return false;
  if (!('value' in located.descriptor)) {
    throw verifierTypeError(
      `KV407: prepared execution result authority property ${verifierString(property)} must be data-backed.`,
    );
  }
  return typeof located.descriptor.value === 'function';
}

function safeReflectedOwnDescriptor(
  target: object,
  property: PropertyKey,
  read: () => unknown,
): PropertyDescriptor | undefined {
  const located = inheritedPropertyDescriptor(target, property);
  if (located === undefined) return undefined;
  const { descriptor, own } = located;

  if (!('value' in descriptor)) {
    if (!own) return undefined;
    if (descriptor.configurable !== true) {
      throw verifierTypeError(
        `Kovo DB verifier cannot expose non-configurable accessor property ${verifierString(property)}.`,
      );
    }
    return verifierFreeze({
      configurable: true,
      enumerable: descriptor.enumerable === true,
      get: read,
    });
  }

  const value = read();
  if (!own) {
    if (!verifierIsExtensible(target)) {
      throw verifierTypeError(
        `Kovo DB verifier cannot pin inherited authority property ${verifierString(property)} on a non-extensible adapter.`,
      );
    }
    return verifierFreeze({
      configurable: true,
      enumerable: descriptor.enumerable === true,
      value,
      writable: false,
    });
  }
  if (descriptor.configurable !== true && value !== descriptor.value) {
    throw verifierTypeError(
      `Kovo DB verifier cannot expose non-configurable authority property ${verifierString(property)}.`,
    );
  }
  return verifierFreeze({
    configurable: descriptor.configurable === true,
    enumerable: descriptor.enumerable === true,
    value,
    writable: descriptor.writable === true,
  });
}

function inheritedPropertyDescriptor(
  target: object,
  property: PropertyKey,
): { descriptor: PropertyDescriptor; own: boolean } | undefined {
  let owner: object | null = target;
  for (let depth = 0; owner !== null && depth < 64; depth += 1) {
    const descriptor = verifierGetOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) return { descriptor, own: owner === target };
    owner = verifierGetPrototypeOf(owner);
  }
  if (owner !== null) {
    throw verifierTypeError('Kovo DB verifier adapter prototype chain exceeds the bounded limit.');
  }
  return undefined;
}

function observablePreparedSqlMethod(
  executionTarget: object,
  target: object,
  value: Function,
  statement: unknown,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
  wrapDb: (preparedResult: object) => object,
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    return observeSqlExecution(
      executionTarget,
      statement,
      () => wrapPreparedExecutionResult(verifierApply(value, target, args), wrapDb),
      config,
      recorder,
    );
  };
}

/**
 * SPEC §11.2 runtime cross-check for KV414 (IDOR): assert that every row a query
 * returned from an `owner:`-annotated table belongs to the session principal. This
 * is the runtime half of the static KV414 gate (§10.3) — run under instrumentation
 * it catches a branch-hidden or smuggled owner-table read that fetched another
 * principal's row, which the §11.1 static predicate analysis can miss. Static
 * over-approximates (all branches); this under-approximates (the executed read),
 * so the two are independent cross-checks of the same invariant.
 *
 * @param options.rows - The rows the owner-table read returned.
 * @param options.ownerColumn - The principal-owning column (the table's `owner:`, §10.1).
 * @param options.principal - The session principal (e.g. `req.session.user.id`).
 * @param options.domain - The owner domain, for the diagnostic message.
 * @throws if any returned row's owner column is not the principal (cross-principal leak).
 * @internal
 */
export function assertOwnerRowsScoped(options: {
  rows: readonly Record<string, unknown>[];
  ownerColumn: string;
  principal: unknown;
  domain: string;
}): void {
  const { domain, owners, principal } = snapshotOwnerScopeInputs(options);
  const foreignOwnerSet = verifierSet<string>();
  let leakedCount = 0;
  for (let index = 0; index < owners.length; index += 1) {
    const owner = owners[index];
    if (owner !== principal) {
      leakedCount += 1;
      verifierSetAdd(foreignOwnerSet, verifierString(owner));
    }
  }
  if (leakedCount === 0) return;

  const foreignOwners = verifierSetValues(foreignOwnerSet);
  throw new Error(
    `KV414 (runtime §11.2): a query returned ${leakedCount} ${domain} row(s) owned by ` +
      `${verifierArrayJoin(foreignOwners, ', ')}, not the session principal ${verifierString(principal)} — IDOR.`,
  );
}

/**
 * SPEC §11.2 runtime cross-check for KV414 (IDOR): assert that every owner-table
 * row a mutation wrote belongs to the session principal. This is the deployed
 * runtime counterpart to the static raw-SQL owner-write gate from SPEC §10.3.
 *
 * @param options.rows - The owner-table rows the mutation wrote.
 * @param options.ownerColumn - The principal-owning column (the table's `owner:`, §10.1).
 * @param options.principal - The session principal (e.g. `req.session.user.id`).
 * @param options.domain - The owner domain, for the diagnostic message.
 * @throws if any written row's owner column is not the principal (cross-principal write).
 * @internal
 */
export function assertOwnerWritesScoped(options: {
  rows: readonly Record<string, unknown>[];
  ownerColumn: string;
  principal: unknown;
  domain: string;
}): void {
  const { domain, owners, principal } = snapshotOwnerScopeInputs(options);
  const foreignOwnerSet = verifierSet<string>();
  let leakedCount = 0;
  for (let index = 0; index < owners.length; index += 1) {
    const owner = owners[index];
    if (owner !== principal) {
      leakedCount += 1;
      verifierSetAdd(foreignOwnerSet, verifierString(owner));
    }
  }
  if (leakedCount === 0) return;

  const foreignOwners = verifierSetValues(foreignOwnerSet);
  throw new Error(
    `KV414 (runtime §11.2): a mutation wrote ${leakedCount} ${domain} row(s) owned by ` +
      `${verifierArrayJoin(foreignOwners, ', ')}, not the session principal ${verifierString(principal)} — IDOR.`,
  );
}

function snapshotOwnerScopeInputs(options: {
  rows: readonly Record<string, unknown>[];
  ownerColumn: string;
  principal: unknown;
  domain: string;
}): {
  domain: string;
  ownerColumn: string;
  owners: readonly unknown[];
  principal: unknown;
} {
  const rowsDescriptor = verifierGetOwnPropertyDescriptor(options, 'rows');
  const columnDescriptor = verifierGetOwnPropertyDescriptor(options, 'ownerColumn');
  const principalDescriptor = verifierGetOwnPropertyDescriptor(options, 'principal');
  const domainDescriptor = verifierGetOwnPropertyDescriptor(options, 'domain');
  if (
    rowsDescriptor === undefined ||
    !('value' in rowsDescriptor) ||
    columnDescriptor === undefined ||
    !('value' in columnDescriptor) ||
    typeof columnDescriptor.value !== 'string' ||
    principalDescriptor === undefined ||
    !('value' in principalDescriptor) ||
    domainDescriptor === undefined ||
    !('value' in domainDescriptor) ||
    typeof domainDescriptor.value !== 'string'
  ) {
    throw new TypeError('Kovo owner-scope verification requires stable own-data inputs.');
  }
  const ownerColumn = columnDescriptor.value;
  const owners = verifierDenseArraySnapshot(
    rowsDescriptor.value,
    'owner-scope rows',
    (row, index) => {
      if (typeof row !== 'object' || row === null) {
        throw new TypeError(`Kovo owner-scope row ${index} must be an object.`);
      }
      const owner = verifierGetOwnPropertyDescriptor(row, ownerColumn);
      if (owner === undefined || !('value' in owner)) {
        throw new TypeError(
          `Kovo owner-scope row ${index}.${ownerColumn} must be a stable own data property.`,
        );
      }
      return owner.value;
    },
  );
  return verifierFreeze({
    domain: domainDescriptor.value,
    ownerColumn,
    owners,
    principal: principalDescriptor.value,
  });
}
