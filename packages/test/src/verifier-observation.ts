import { AsyncLocalStorage } from 'node:async_hooks';

import { observeSqlStatementArgument } from './sql-observer.js';

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
    observeSqlStatementArgument(statement, config, recorder);
    return value.call(target, statement, ...args);
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
