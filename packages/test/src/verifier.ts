import type * as CoreGraph from '@kovojs/core/internal/graph';
import {
  isDbAdapterLike,
  isPreparedStatementExecutionMethod,
  isSqlHandleLike,
  isSqlHandleProperty,
} from '@kovojs/core/internal/sql-safety';
import { createFrameworkManagedSqlDispatchProxy } from '@kovojs/server/internal/execution';
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
  verifierArrayJoin,
  verifierDenseArraySnapshot,
  verifierFreeze,
  verifierGetOwnPropertyDescriptor,
  verifierObjectKeys,
  verifierReflectGet,
  verifierSet,
  verifierSetAdd,
  verifierSetValues,
  verifierString,
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
  const sqlHandleProxyCache = verifierWeakMap<object, object>();
  const methodCache = verifierWeakMap<object, Map<PropertyKey, CachedMethod>>();

  return {
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
      const proxy = createFrameworkManagedSqlDispatchProxy(
        db as Record<string, unknown>,
        {
          get(target, prop, receiver) {
            if (prop === '__kovoObserved') return recorder.observed;
            const value = verifierReflectGet(target, prop, receiver);

            if (isSqlHandleProperty(prop) && isSqlHandleLike(value)) {
              return wrapSqlHandle(
                value,
                configSnapshot,
                recorder,
                sqlHandleProxyCache,
                methodCache,
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
              return cachedMethod(target, prop, value, methodCache, () =>
                observableTableMethod('write', target, value, configSnapshot, recorder),
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
                  sqlHandleProxyCache,
                  methodCache,
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
        },
        'test-fixture',
      );

      verifierWeakMapSet(rootProxyCache, db, proxy);
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
  const cached = verifierWeakMapGet(proxyCache, handle);
  if (cached) return cached as Handle;

  const proxy = createFrameworkManagedSqlDispatchProxy(handle as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const value = verifierReflectGet(target, prop, receiver);

      if (prop === 'transaction' && typeof value === 'function') {
        return cachedMethod(
          target,
          prop,
          value,
          methodCache,
          () =>
            async (callback: (tx: object) => Promise<unknown>, ...args: unknown[]) => {
              const before = await tableObservationSnapshots(
                target,
                verifierObjectKeys(config.domainByTable),
                config.sqlDialect,
              );
              const start = recorder.length();
              const result = await verifierApply(value, target, [
                (tx: object) =>
                  verifierApply(callback, undefined, [
                    wrapSqlHandle(tx, config, recorder, proxyCache, methodCache),
                  ]),
                ...args,
              ]);
              await observeSqlEngineSideEffects(
                target,
                '<transaction>',
                config,
                recorder,
                recorder.slice(start),
                before,
              );
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
          observablePrepareMethod(target, value, config, recorder, proxyCache, methodCache),
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
): (statement: unknown, ...args: unknown[]) => unknown {
  return (statement: unknown, ...args: unknown[]) => {
    const statementSnapshot = snapshotVerifierSqlStatement(statement);
    const prepared = verifierApply<unknown>(value, target, [statementSnapshot, ...args]);
    return typeof prepared === 'object' && prepared !== null
      ? wrapPreparedSqlStatement(
          prepared,
          target,
          statementSnapshot,
          config,
          recorder,
          proxyCache,
          methodCache,
        )
      : prepared;
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
): Statement {
  const cached = verifierWeakMapGet(proxyCache, statementHandle);
  if (cached) return cached as Statement;

  const proxy = createFrameworkManagedSqlDispatchProxy(
    statementHandle as Record<PropertyKey, unknown>,
    {
      get(target, prop, receiver) {
        const value = verifierReflectGet(target, prop, receiver);

        if (isPreparedStatementExecutionMethod(prop) && typeof value === 'function') {
          return cachedMethod(target, prop, value, methodCache, () =>
            observablePreparedSqlMethod(
              executionTarget,
              target,
              value,
              statement,
              config,
              recorder,
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
    },
  ) as Statement;

  verifierWeakMapSet(proxyCache, statementHandle, proxy);
  return proxy;
}

function observablePreparedSqlMethod(
  executionTarget: object,
  target: object,
  value: Function,
  statement: unknown,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    return observeSqlExecution(
      executionTarget,
      statement,
      () => verifierApply(value, target, args),
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
