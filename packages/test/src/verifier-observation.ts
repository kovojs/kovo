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
  verifierMap,
  verifierMapGet,
  verifierMapSize,
  verifierMapSet,
  verifierObjectKeys,
  verifierPromiseResolve,
  verifierPromiseThen,
  verifierReflectGet,
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
  capture<T>(
    callback: () => T | Promise<T>,
  ): Promise<{ observed: readonly ObservedDbOperation[]; result: T }>;
  length(): number;
  record(operation: ObservedDbOperation): void;
  slice(start: number): readonly ObservedDbOperation[];
}

interface ObservationScope {
  observed: ObservedDbOperation[];
}

export interface CachedMethod {
  original: Function;
  wrapped: unknown;
}

export function createObservationRecorder(): ObservationRecorder {
  const observed: ObservedDbOperation[] = [];
  const storage = verifierAsyncStorage<ObservationScope>();

  return {
    get observed(): readonly ObservedDbOperation[] {
      return verifierFreeze(verifierArraySlice(observed));
    },
    async capture<T>(
      callback: () => T | Promise<T>,
    ): Promise<{ observed: readonly ObservedDbOperation[]; result: T }> {
      const scope: ObservationScope = { observed: [] };
      const result = await verifierAsyncStorageRun(storage, scope, callback);
      return { observed: verifierFreeze(verifierArraySlice(scope.observed)), result };
    },
    length(): number {
      return observed.length;
    },
    record(operation: ObservedDbOperation): void {
      const snapshot = snapshotObservedOperation(operation);
      verifierArrayPush(observed, snapshot);
      const scope = verifierAsyncStorageGetStore(storage);
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
  const explicitOperations = observeSqlStatementArgument(statement, config, recorder);
  const sql = sqlStatementText(statement);

  // SPEC.md §11.2 meta-soundness (E1): the row/fingerprint backstop is
  // unconditional. Gating it behind a parsed write lets parser-rejected or
  // unrecognized destructive statements slip past `assertCovered()` green.
  const syncBefore = tableObservationSnapshotsSync(
    target,
    verifierObjectKeys(config.domainByTable),
    config.sqlDialect,
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
  );
  return verifierPromiseThen(verifierPromiseResolve(before), (counts) => {
    if (verifierMapSize(counts) === 0) return execute();

    return verifierPromiseThen(verifierPromiseResolve(execute()), async (result) => {
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
    const name = verifierReflectGet(table, DRIZZLE_TABLE_NAME, table);
    if (typeof name === 'string') return name;
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
