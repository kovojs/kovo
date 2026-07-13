import {
  securityGetOwnPropertyDescriptor,
  securityMap,
  securityMapDelete,
  securityMapForEach,
  securityMapGet,
  securityMapHas,
  securityMapSet,
  securityOwnArrayEntry,
  securitySet,
  securitySetAdd,
  securitySetDelete,
  securitySetForEach,
  securityStringIndexOf,
  securityStringSlice,
  securityStringStartsWith,
} from './security-witness-intrinsics.js';

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
  // SPEC §6.6/§9.4: decoded server truth, subscriptions, and optimistic baselines remain
  // authoritative after authored modules run. Never dispatch those facts through mutable ambient
  // Map/Set/String prototype methods.
  const values = securityMap<string, unknown>();
  const plans = securityMap<string, Set<QueryUpdatePlan>>();

  return {
    // L7-2 / SPEC §9.4: the `values` map is otherwise never evicted and its keys
    // flow from server-authored `<kovo-query key>`, so rotating keys (search,
    // pagination, per-row) grow the session heap without bound. `clear`/`delete`
    // give the loader/morph path a way to release that retained memory.
    clear(): void {
      securityMapForEach(values, (_value, key) => {
        securityMapDelete(values, key);
      });
    },
    delete(name: string, key?: string): void {
      securityMapDelete(values, queryStoreKey(name, key));
    },
    get<Value = unknown>(name: string, key?: string): Value | undefined {
      return securityMapGet(values, queryStoreKey(name, key)) as Value | undefined;
    },
    snapshot(
      names: readonly string[],
      keys: Readonly<Record<string, string | undefined>> = {},
    ): QuerySnapshot {
      const snapshot = securityMap<string, unknown>();

      for (let index = 0; index < names.length; index += 1) {
        const nameEntry = securityOwnArrayEntry(names, index);
        if (!nameEntry.ok || typeof nameEntry.value !== 'string') {
          throw new TypeError('Kovo query snapshot names must be a dense string array.');
        }
        const name = nameEntry.value;
        const keyDescriptor = securityGetOwnPropertyDescriptor(keys, name);
        const key =
          keyDescriptor && 'value' in keyDescriptor && typeof keyDescriptor.value === 'string'
            ? keyDescriptor.value
            : undefined;
        const storeKey = queryStoreKey(name, key);
        // SPEC.md §10.4 bounded snapshots: optimistic transforms use copy-on-write
        // drafts, so rollback retains the pre-transform value by reference instead
        // of deep-cloning untouched query data.
        securityMapSet(snapshot, storeKey, securityMapGet(values, storeKey));
      }

      return snapshot;
    },
    set<Value = unknown>(name: string, value: Value, key?: string): void {
      const storeKey = queryStoreKey(name, key);
      securityMapSet(values, storeKey, value);

      const updatePlans = securityMapGet(plans, storeKey);
      if (!updatePlans) return;
      securitySetForEach(updatePlans, (plan) => {
        plan(value);
      });
    },
    subscribe<Value = unknown>(
      name: string,
      plan: QueryUpdatePlan<Value>,
      key?: string,
    ): () => void {
      const storeKey = queryStoreKey(name, key);
      const existing = securityMapGet(plans, storeKey) ?? securitySet<QueryUpdatePlan>();
      securitySetAdd(existing, plan as QueryUpdatePlan);
      securityMapSet(plans, storeKey, existing);

      if (securityMapHas(values, storeKey)) {
        plan(securityMapGet(values, storeKey) as Value);
      }

      return () => {
        securitySetDelete(existing, plan as QueryUpdatePlan);
        // L7-1 / SPEC §9.4: prune the now-empty subscriber Set so the `plans` map
        // does not leak one empty Set per distinct `(name, key)` over the session.
        // Re-resolve the current Set first: a later subscribe() may have replaced
        // the captured `existing` with a fresh Set for the same key, which must not
        // be deleted.
        let hasLivePlan = false;
        securitySetForEach(existing, () => {
          hasLivePlan = true;
        });
        if (!hasLivePlan && securityMapGet(plans, storeKey) === existing) {
          securityMapDelete(plans, storeKey);
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

  return securityStringStartsWith(key, `${name}:`) ? key : `${name}:${key}`;
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
  const separator = securityStringIndexOf(wireKey, ':');
  if (separator === -1) return { name: wireKey };

  return {
    keyValue: securityStringSlice(wireKey, separator + 1),
    name: securityStringSlice(wireKey, 0, separator),
  };
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export function queryIdentityFromStoreKey(storeKey: string): { key?: string; name: string } {
  const separator = securityStringIndexOf(storeKey, '\0');
  if (separator === -1) return { name: storeKey };

  return {
    key: securityStringSlice(storeKey, separator + 1),
    name: securityStringSlice(storeKey, 0, separator),
  };
}
