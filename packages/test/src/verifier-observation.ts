import { AsyncLocalStorage } from 'node:async_hooks';

import {
  hasTableCountHandle,
  observeSqlEngineSideEffects,
  observeSqlStatementArgument,
  sqlStatementText,
  tableCounts,
} from './sql-observer.js';

/** @internal Verification config: which tables map to which domains/keys (SPEC.md §11). */
export interface DbVerificationConfig {
  domainByTable: Record<string, string>;
  exemptTables?: readonly string[];
  keyByTable?: Record<string, string>;
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
  observed: ObservedDbOperation[];
  capture<T>(
    callback: () => T | Promise<T>,
  ): Promise<{ observed: readonly ObservedDbOperation[]; result: T }>;
  record(operation: ObservedDbOperation): void;
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
  const storage = new AsyncLocalStorage<ObservationScope>();

  return {
    observed,
    async capture<T>(
      callback: () => T | Promise<T>,
    ): Promise<{ observed: readonly ObservedDbOperation[]; result: T }> {
      const scope: ObservationScope = { observed: [] };
      const result = await storage.run(scope, callback);
      return { observed: Object.freeze(scope.observed.slice()), result };
    },
    record(operation: ObservedDbOperation): void {
      observed.push(operation);
      storage.getStore()?.observed.push(operation);
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

export function observableTableMethod(
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

export function observableSqlMethod(
  target: object,
  value: Function,
  config: DbVerificationConfig,
  recorder: ObservationRecorder,
): (statement: unknown, ...args: unknown[]) => unknown {
  return (statement: unknown, ...args: unknown[]) => {
    const explicitOperations = observeSqlStatementArgument(statement, config, recorder);

    // SPEC.md §11.2 meta-soundness (E1): the row-count backstop must be
    // UNCONDITIONAL. Gating it behind a parsed write let unrecognized
    // destructive writes (`TRUNCATE`/`MERGE`/`DELETE…USING`) that parse to no
    // ops — and statements the parser rejects (fail-open `[]`) — slip past
    // `assertCovered()` green. Always snapshot/compare configured table counts
    // so any row delta the explicit parse missed is still recorded as a write.
    //
    // The count net only applies to the real async DB seam (a db exposing an
    // asynchronous raw count query handle). When none is reachable — including
    // every synchronous test double — run the call straight through so adapter
    // results pass through unwrapped (SPEC.md §11.4): a synchronous db cannot be
    // count-netted across the awaited before/after snapshot boundary.
    if (!hasTableCountHandle(target)) return value.call(target, statement, ...args);

    const sql = sqlStatementText(statement);
    // Snapshot before-counts fully (so the count queries are dispatched and
    // executed before the mutating call), then run the statement and compare.
    const before = tableCounts(target, Object.keys(config.domainByTable));
    return Promise.resolve(before).then((counts) => {
      if (counts.size === 0) return value.call(target, statement, ...args);

      return Promise.resolve(value.call(target, statement, ...args)).then(async (result) => {
        await observeSqlEngineSideEffects(
          target,
          sql,
          config,
          recorder,
          explicitOperations,
          counts,
        );
        return result;
      });
    });
  };
}

// Drizzle stores a table's SQL name on a well-known symbol; resolving it here
// lets the verifier observe real Drizzle `insert(table)`/`update(table)`/
// `delete(table)` calls (the table is the first argument) the same way it
// observes the legacy string-keyed `write('table', …)` seam.
const DRIZZLE_TABLE_NAME = Symbol.for('drizzle:Name');

function tableNameOf(table: unknown): string | undefined {
  if (typeof table === 'string') return table;
  if (typeof table === 'object' && table !== null) {
    const name = (table as Record<symbol, unknown>)[DRIZZLE_TABLE_NAME];
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
