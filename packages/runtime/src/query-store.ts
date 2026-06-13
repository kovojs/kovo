import type { RuntimeErrorReporter } from './error-policy.js';
import { readQueryScriptChunks } from './wire-parser.js';
import type { QueryChunk, QueryScriptChunkLike } from './wire-parser.js';

export type QueryUpdatePlan<Value = unknown> = (value: Value) => void;

export interface QueryStore {
  get<Value = unknown>(name: string, key?: string): Value | undefined;
  snapshot(
    names: readonly string[],
    keys?: Readonly<Record<string, string | undefined>>,
  ): QuerySnapshot;
  set<Value = unknown>(name: string, value: Value, key?: string): void;
  subscribe<Value = unknown>(name: string, plan: QueryUpdatePlan<Value>, key?: string): () => void;
}

export type QuerySnapshot = Map<string, unknown>;

export interface QueryScriptLike extends QueryScriptChunkLike {}

export type QueryApplyInterposition = (query: QueryChunk) => { value: unknown } | void;

export interface QueryScriptHydrationLedger {
  hydrate(
    scripts: Iterable<QueryScriptLike>,
    options?: { onError?: RuntimeErrorReporter },
  ): readonly string[];
}

export interface ApplyQueryChunksToStoreOptions {
  afterApplyQuery?: (query: QueryChunk, value: unknown) => void;
  applyQuery?: QueryApplyInterposition;
}

export function createQueryStore(): QueryStore {
  const values = new Map<string, unknown>();
  const plans = new Map<string, Set<QueryUpdatePlan>>();

  return {
    get<Value = unknown>(name: string, key?: string): Value | undefined {
      return values.get(queryStoreKey(name, key)) as Value | undefined;
    },
    snapshot(
      names: readonly string[],
      keys: Readonly<Record<string, string | undefined>> = {},
    ): QuerySnapshot {
      const snapshot = new Map<string, unknown>();

      for (const name of names) {
        const storeKey = queryStoreKey(name, keys[name]);
        snapshot.set(storeKey, structuredClone(values.get(storeKey)));
      }

      return snapshot;
    },
    set<Value = unknown>(name: string, value: Value, key?: string): void {
      const storeKey = queryStoreKey(name, key);
      values.set(storeKey, value);

      for (const plan of plans.get(storeKey) ?? []) {
        plan(value);
      }
    },
    subscribe<Value = unknown>(
      name: string,
      plan: QueryUpdatePlan<Value>,
      key?: string,
    ): () => void {
      const storeKey = queryStoreKey(name, key);
      const existing = plans.get(storeKey) ?? new Set<QueryUpdatePlan>();
      existing.add(plan as QueryUpdatePlan);
      plans.set(storeKey, existing);

      if (values.has(storeKey)) {
        plan(values.get(storeKey) as Value);
      }

      return () => {
        existing.delete(plan as QueryUpdatePlan);
      };
    },
  };
}

export function queryStoreKey(name: string, key: string | undefined): string {
  return key === undefined ? name : `${name}\0${key}`;
}

export function queryWireKey(name: string, key: string | undefined): string {
  if (key === undefined) return name;

  return key.startsWith(`${name}:`) ? key : `${name}:${key}`;
}

export function applyQueryChunkToStore(
  store: QueryStore,
  query: QueryChunk,
  interpose?: QueryApplyInterposition,
): unknown {
  const interposed = interpose?.(query);
  if (interposed) return interposed.value;

  store.set(query.name, query.value, query.key);
  return query.value;
}

export function applyQueryChunksToStore(
  store: QueryStore,
  queries: readonly QueryChunk[],
  options: ApplyQueryChunksToStoreOptions = {},
): readonly string[] {
  const applied: string[] = [];

  for (const query of queries) {
    const value = applyQueryChunkToStore(store, query, options.applyQuery);
    options.afterApplyQuery?.(query, value);
    applied.push(queryWireKey(query.name, query.key));
  }

  return applied;
}

export function queryIdentityFromStoreKey(storeKey: string): { key?: string; name: string } {
  const separator = storeKey.indexOf('\0');
  if (separator === -1) return { name: storeKey };

  return {
    key: storeKey.slice(separator + 1),
    name: storeKey.slice(0, separator),
  };
}

export function hydrateQueryScripts(
  store: QueryStore,
  scripts: Iterable<QueryScriptLike>,
  options: { onError?: RuntimeErrorReporter } = {},
): readonly string[] {
  // SPEC.md §9.1/§9.4: initial hydration uses the same batched query chunk
  // application path as mutation responses, deferred streams, and typed reads.
  return applyQueryChunksToStore(store, readQueryScriptChunks(scripts, options.onError));
}

export function createQueryScriptHydrationLedger(store: QueryStore): QueryScriptHydrationLedger {
  const seen = new Set<QueryScriptLike>();

  return {
    hydrate(
      scripts: Iterable<QueryScriptLike>,
      options: { onError?: RuntimeErrorReporter } = {},
    ): readonly string[] {
      const pending: QueryScriptLike[] = [];

      for (const script of scripts) {
        if (seen.has(script)) continue;

        seen.add(script);
        pending.push(script);
      }

      // SPEC.md §9.1/§9.4: browser hydration, mutation responses, and typed
      // refetches must converge on the same query-store apply path without
      // replaying already observed server-provided scripts.
      return hydrateQueryScripts(store, pending, options);
    },
  };
}
