import { reportMalformedJson } from './error-policy.js';
import type { RuntimeErrorReporter } from './error-policy.js';
import { parseJsonValue } from './json.js';
import type { TextContentElementLike } from './dom-like.js';
import type { QueryChunk } from './wire-parser.js';

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

export interface QueryScriptLike extends TextContentElementLike {}

export type QueryApplyInterposition = (query: QueryChunk) => { value: unknown } | void;

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
  const hydrated: string[] = [];

  for (const script of scripts) {
    const name = script.getAttribute('fw-query');
    if (name) {
      const key = script.getAttribute('key') ?? undefined;
      const parsed = parseJsonValue(script.textContent ?? 'null');
      if (parsed.ok) {
        const query: QueryChunk =
          key === undefined ? { name, value: parsed.value } : { key, name, value: parsed.value };
        applyQueryChunkToStore(store, query);
        hydrated.push(queryWireKey(query.name, query.key));
      } else {
        reportMalformedJson(options.onError, 'fw-query hydration', parsed.error);
      }
    }
  }

  return hydrated;
}
