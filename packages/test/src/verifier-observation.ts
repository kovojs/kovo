import {
  hasTableCountHandle,
  observeSqlEngineSideEffects,
  observeSqlEngineSideEffectsSync,
  observeSqlStatementArgument,
  sqlStatementText,
  tableObservationSnapshots,
  tableObservationSnapshotsSync,
} from './sql-observer.js';
import {
  verifierApply,
  verifierArrayPush,
  verifierArraySlice,
  verifierAsyncStorage,
  verifierAsyncStorageGetStore,
  verifierAsyncStorageRun,
  verifierFreeze,
  verifierGetOwnPropertyDescriptor,
  verifierIsProxy,
  verifierMap,
  verifierMapGet,
  verifierMapSize,
  verifierMapSet,
  verifierObjectKeys,
  verifierPromiseResolve,
  verifierPromiseThen,
  verifierTypeError,
  verifierWeakMapGet,
  verifierWeakMapSet,
} from './verifier-security-intrinsics.js';
import { snapshotObservedOperation, snapshotVerifierSqlStatement } from './verifier-snapshots.js';

/** @internal Verification config: which tables map to which domains/keys (SPEC.md §11). */
export interface DbVerificationConfig {
  domainByTable: Record<string, string>;
  exemptTables?: readonly string[];
  keyByTable?: Record<string, string>;
  sqlDialect?: 'postgres' | 'sqlite';
}

/** @internal A single observed database read/write operation (SPEC.md §11.2). */
export interface ObservedDbOperation {
  branch: string | undefined;
  domain: string | undefined;
  kind: 'read' | 'write';
  mutationRead: boolean | undefined;
  rowKey: string | undefined;
  sql: string | undefined;
  table: string;
}

/** @internal Per-operation observation hints (branch/rowKey) passed through the db seam. */
export interface DbObservationOptions {
  branch?: string;
  rowKey?: string;
}

export interface ObservationRecorder {
  readonly observed: readonly ObservedDbOperation[];
  assertActive(): void;
  capture<T>(
    callback: () => T | Promise<T>,
  ): Promise<{ observed: readonly ObservedDbOperation[]; result: T }>;
  length(): number;
  record(operation: ObservedDbOperation): void;
  slice(start: number): readonly ObservedDbOperation[];
}

interface ObservationScope {
  active: boolean;
  observed: ObservedDbOperation[];
}

export interface CachedMethod {
  original: Function;
  wrapped: unknown;
}

export function createObservationRecorder(recordOutsideCapture = true): ObservationRecorder {
  const observed: ObservedDbOperation[] = [];
  const storage = verifierAsyncStorage<ObservationScope>();
  const assertActive = (): void => {
    const scope = verifierAsyncStorageGetStore(storage);
    if (scope?.active === false) {
      throw verifierTypeError(
        'KV407: Kovo DB verifier capture has settled; inherited DB authority is revoked.',
      );
    }
  };

  return {
    get observed(): readonly ObservedDbOperation[] {
      return verifierFreeze(verifierArraySlice(observed));
    },
    assertActive,
    async capture<T>(
      callback: () => T | Promise<T>,
    ): Promise<{ observed: readonly ObservedDbOperation[]; result: T }> {
      const scope: ObservationScope = { active: true, observed: [] };
      try {
        const result = await verifierAsyncStorageRun(storage, scope, callback);
        return { observed: verifierFreeze(verifierArraySlice(scope.observed)), result };
      } finally {
        // AsyncLocalStorage descendants retain the scope object after run() settles. Revoke that
        // shared object before capture() resolves so detached work cannot use inherited verifier
        // authority after its observations have already been checked (SPEC.md §11.2).
        scope.active = false;
      }
    },
    length(): number {
      return observed.length;
    },
    record(operation: ObservedDbOperation): void {
      assertActive();
      const scope = verifierAsyncStorageGetStore(storage);
      if (scope === undefined && !recordOutsideCapture) return;
      const snapshot = snapshotObservedOperation(operation);
      verifierArrayPush(observed, snapshot);
      if (scope !== undefined) verifierArrayPush(scope.observed, snapshot);
    },
    slice(start: number): readonly ObservedDbOperation[] {
      return verifierFreeze(verifierArraySlice(observed, start));
    },
  };
}

export function cachedMethod(
  target: object,
  prop: PropertyKey,
  original: Function,
  methodCache: WeakMap<object, Map<PropertyKey, CachedMethod>>,
  create: () => unknown,
): unknown {
  let cachedForTarget = verifierWeakMapGet(methodCache, target);
  if (!cachedForTarget) {
    cachedForTarget = verifierMap();
    verifierWeakMapSet(methodCache, target, cachedForTarget);
  }

  const cached = verifierMapGet(cachedForTarget, prop);
  if (cached?.original === original) return cached.wrapped;

  const wrapped = create();
  verifierMapSet(cachedForTarget, prop, verifierFreeze({ original, wrapped }));
  return wrapped;
}

export function observableTableMethod(
  kind: ObservedDbOperation['kind'],
  target: object,
  value: Function,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
): (table: unknown, ...args: unknown[]) => unknown {
  return (table: unknown, ...args: unknown[]) => {
    recorder.assertActive();
    observeTableIfString(kind, table, args, config, recorder);
    return verifierApply(value, target, [table, ...args]);
  };
}

export function observableSqlMethod(
  target: object,
  value: Function,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
): (statement: unknown, ...args: unknown[]) => unknown {
  return (statement: unknown, ...args: unknown[]) => {
    const statementSnapshot = snapshotVerifierSqlStatement(statement);
    return observeSqlExecution(
      target,
      statementSnapshot,
      () => verifierApply(value, target, [statementSnapshot, ...args]),
      config,
      recorder,
    );
  };
}

export function observeSqlExecution(
  target: object,
  statement: unknown,
  execute: () => unknown,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
): unknown {
  // Assert before parsing, count probes, or the adapter call: each of those may cross an
  // application-controlled authority boundary and must be impossible after capture settlement.
  recorder.assertActive();
  const explicitOperations = observeSqlStatementArgument(statement, config, recorder);
  const sql = sqlStatementText(statement);

  // SPEC.md §11.2 meta-soundness (E1): the row/fingerprint backstop is
  // unconditional. Gating it behind a parsed write lets parser-rejected or
  // unrecognized destructive statements slip past `assertCovered()` green.
  const syncBefore = tableObservationSnapshotsSync(
    target,
    verifierObjectKeys(config.domainByTable),
    config.sqlDialect,
    recorder,
  );
  if (syncBefore !== null) {
    if (verifierMapSize(syncBefore) === 0) return execute();
    const result = execute();
    observeSqlEngineSideEffectsSync(target, sql, config, recorder, explicitOperations, syncBefore);
    return result;
  }

  if (!hasTableCountHandle(target, config.sqlDialect)) return execute();

  // Snapshot before-counts fully (so the count queries are dispatched and
  // executed before the mutating call), then run the statement and compare.
  const before = tableObservationSnapshots(
    target,
    verifierObjectKeys(config.domainByTable),
    config.sqlDialect,
    recorder,
  );
  return verifierPromiseThen(verifierPromiseResolve(before), (counts) => {
    recorder.assertActive();
    if (verifierMapSize(counts) === 0) return execute();

    return verifierPromiseThen(verifierPromiseResolve(execute()), async (result) => {
      recorder.assertActive();
      await observeSqlEngineSideEffects(target, sql, config, recorder, explicitOperations, counts);
      return result;
    });
  });
}

// Drizzle stores a table's SQL name on a well-known symbol; resolving it here
// lets the verifier observe real Drizzle `insert(table)`/`update(table)`/
// `delete(table)` calls (the table is the first argument) the same way it
// observes the legacy string-keyed `write('table', …)` seam.
const DRIZZLE_TABLE_NAME = Symbol.for('drizzle:Name');

function tableNameOf(table: unknown): string | undefined {
  if (typeof table === 'string') return table;
  if (typeof table === 'object' && table !== null) {
    if (verifierIsProxy(table)) {
      throw new TypeError('Kovo DB verifier table arguments must not be Proxy carriers.');
    }
    const descriptor = verifierGetOwnPropertyDescriptor(table, DRIZZLE_TABLE_NAME);
    if (descriptor === undefined) return undefined;
    if (!('value' in descriptor) || typeof descriptor.value !== 'string') {
      throw new TypeError('Kovo DB verifier table identity must be a stable own string property.');
    }
    return descriptor.value;
  }
  return undefined;
}

function observeTableIfString(
  kind: ObservedDbOperation['kind'],
  table: unknown,
  args: readonly unknown[],
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
): void {
  const name = tableNameOf(table);
  if (name === undefined) return;
  observe(kind, name, args, config, recorder);
}

export function observeRequiredTableOperation(
  kind: ObservedDbOperation['kind'],
  table: unknown,
  args: readonly unknown[],
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
  mutationRead?: boolean,
): void {
  const name = tableNameOf(table);
  if (name === undefined) {
    throw new TypeError(
      'KV407: Kovo DB verifier could not resolve a Drizzle table argument to stable physical identity.',
    );
  }
  observe(kind, name, args, config, recorder, mutationRead);
}

function observe(
  kind: ObservedDbOperation['kind'],
  table: string,
  args: readonly unknown[],
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
  mutationRead?: boolean,
): void {
  recorder.record({
    branch: observationOptions(args)?.branch,
    domain: config.domainByTable[table],
    kind,
    mutationRead,
    rowKey: observationOptions(args)?.rowKey,
    sql: undefined,
    table,
  });
}

function observationOptions(args: readonly unknown[]): DbObservationOptions | undefined {
  const last = args.length === 0 ? undefined : args[args.length - 1];

  if (typeof last !== 'object' || last === null) {
    return undefined;
  }

  const rowKeyDescriptor = verifierGetOwnPropertyDescriptor(last, 'rowKey');
  const branchDescriptor = verifierGetOwnPropertyDescriptor(last, 'branch');
  if (rowKeyDescriptor === undefined && branchDescriptor === undefined) return undefined;
  if (
    (rowKeyDescriptor !== undefined && !('value' in rowKeyDescriptor)) ||
    (branchDescriptor !== undefined && !('value' in branchDescriptor))
  ) {
    throw new TypeError('Kovo DB observation options require stable own data properties.');
  }
  const rowKey =
    rowKeyDescriptor !== undefined && 'value' in rowKeyDescriptor
      ? rowKeyDescriptor.value
      : undefined;
  const branch =
    branchDescriptor !== undefined && 'value' in branchDescriptor
      ? branchDescriptor.value
      : undefined;

  return {
    ...(typeof branch === 'string' ? { branch } : {}),
    ...(typeof rowKey === 'string' ? { rowKey } : {}),
  };
}
