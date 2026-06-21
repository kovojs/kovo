/**
 * A subscriber callback invoked with a query's new value when it changes.
 */
export type QueryUpdatePlan<Value = unknown> = (value: Value) => void;

/**
 * The client query store: get/set/subscribe to query values and take snapshots.
 */
export interface QueryStore {
  /**
   * L7-2 / SPEC §9.4: drop every held query value, releasing the heap retained
   * by rotating server-authored `<kovo-query key>` instances for the session.
   * Subscriptions are preserved (the store can be re-hydrated); use this on
   * teardown or when discarding a whole document's query truth.
   */
  clear(): void;
  /**
   * L7-2 / SPEC §9.4: drop a single `(name, key)` value so a loader/morph path can
   * evict an instance key no longer present in the DOM (e.g. a paged-out search row)
   * instead of growing the `values` map without bound. Subscriptions are preserved.
   */
  delete(name: string, key?: string): void;
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
 * import { createQueryStore } from '@kovojs/browser/client';
 *
 * const store = createQueryStore();
 * store.set('cart', { count: 1 });
 */
export function createQueryStore(): QueryStore {
  const values = new Map<string, unknown>();
  const plans = new Map<string, Set<QueryUpdatePlan>>();

  return {
    // L7-2 / SPEC §9.4: the `values` map is otherwise never evicted and its keys
    // flow from server-authored `<kovo-query key>`, so rotating keys (search,
    // pagination, per-row) grow the session heap without bound. `clear`/`delete`
    // give the loader/morph path a way to release that retained memory.
    clear(): void {
      values.clear();
    },
    delete(name: string, key?: string): void {
      values.delete(queryStoreKey(name, key));
    },
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
        // L7-1 / SPEC §9.4: prune the now-empty subscriber Set so the `plans` map
        // does not leak one empty Set per distinct `(name, key)` over the session.
        // Re-resolve the current Set first: a later subscribe() may have replaced
        // the captured `existing` with a fresh Set for the same key, which must not
        // be deleted.
        if (existing.size === 0 && plans.get(storeKey) === existing) {
          plans.delete(storeKey);
        }
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

/**
 * Split a `queryWireKey` back into its query `name` and (optional) instance
 * `keyValue` (SPEC §9.4/§10.2, F5). The canonical instance key is `name:keyValue`;
 * the typed-read endpoint dispatches by query NAME (`/_q/<name>`), so a refetch
 * must use the name as the path and never `/_q/<name:keyValue>` (which 404s — the
 * server registers no query named `name:keyValue`). `keyValue` is the §10.2
 * instance-key value (e.g. `user-1` for `recommendations:user-1`).
 *
 * Runtime API used by Kovo applications and generated runtime integration.
 */
export function splitQueryWireKey(wireKey: string): { keyValue?: string; name: string } {
  const separator = wireKey.indexOf(':');
  if (separator === -1) return { name: wireKey };

  return {
    keyValue: wireKey.slice(separator + 1),
    name: wireKey.slice(0, separator),
  };
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
