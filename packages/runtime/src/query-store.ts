/**
 * A subscriber callback invoked with a query's new value when it changes.
 */
export type QueryUpdatePlan<Value = unknown> = (value: Value) => void;

/**
 * The client query store: get/set/subscribe to query values and take snapshots.
 */
export interface QueryStore {
  get<Value = unknown>(name: string, key?: string): Value | undefined;
  snapshot(
    names: readonly string[],
    keys?: Readonly<Record<string, string | undefined>>,
  ): QuerySnapshot;
  set<Value = unknown>(name: string, value: Value, key?: string): void;
  subscribe<Value = unknown>(name: string, plan: QueryUpdatePlan<Value>, key?: string): () => void;
}

/**
 * A point-in-time copy of query values, used to roll back optimistic updates.
 */
export type QuerySnapshot = Map<string, unknown>;

/**
 * Create the client-side query store: the in-memory source of truth the loader
 * hydrates from `<kovo-query>` scripts and that bindings and optimistic updates
 * read and write (SPEC §9.4).
 *
 * @returns A fresh `QueryStore`.
 * @example
 * import { createQueryStore } from '@kovojs/runtime/client';
 *
 * const store = createQueryStore();
 * store.set('cart', { count: 1 });
 */
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

/** Runtime API used by Kovo applications and generated runtime integration. */
export function queryStoreKey(name: string, key: string | undefined): string {
  return key === undefined ? name : `${name}\0${key}`;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export function queryWireKey(name: string, key: string | undefined): string {
  if (key === undefined) return name;

  return key.startsWith(`${name}:`) ? key : `${name}:${key}`;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export function queryIdentityFromStoreKey(storeKey: string): { key?: string; name: string } {
  const separator = storeKey.indexOf('\0');
  if (separator === -1) return { name: storeKey };

  return {
    key: storeKey.slice(separator + 1),
    name: storeKey.slice(0, separator),
  };
}
