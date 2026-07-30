import { frameworkWireIdentityIsValid } from '@kovojs/core/internal/wire-input-grammar';

import {
  freezeSecurityValue,
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
  securityWeakMap,
  securityWeakMapGet,
  securityWeakMapSet,
} from './security-witness-intrinsics.js';

/**
 * A subscriber callback invoked with a query's new value when it changes.
 */
export type QueryUpdatePlan<Value = unknown> = (value: Value) => void;

/**
 * @internal A generated-plan subscriber for every keyed and unkeyed instance of one query.
 *
 * Optimistic predictions write through the same store as hydration and server truth. Keeping this
 * family subscription out of the public {@link QueryStore} shape lets generated loaders observe
 * future keyed instances without turning a compiler/runtime ABI into an app-authored cache API.
 */
export type QueryFamilyUpdatePlan<Value = unknown> = (value: Value, key?: string) => void;

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

const queryStorePresence = securityWeakMap<QueryStore, (storeKey: string) => boolean>();
const queryStoreFamilySubscriptions = securityWeakMap<
  QueryStore,
  {
    plans: Map<string, Set<QueryFamilyUpdatePlan>>;
    replay(name: string, plan: QueryFamilyUpdatePlan): void;
  }
>();

/** Exact query identity; `key` is separate because query names may contain `:`. */
export interface QueryIdentity {
  readonly key?: string;
  readonly name: string;
}

/**
 * Create the client-side query store: the in-memory source of truth the loader
 * hydrates from `<kovo-query>` scripts and that bindings and optimistic updates
 * read and write (SPEC §9.4).
 *
 * Compiler-emitted bootstraps consume this generated ABI. Custom shells use
 * `installKovoClient`, which owns and clears the store internally.
 *
 * @returns A fresh `QueryStore`.
 */
export function createQueryStore(): QueryStore {
  // SPEC §6.6/§9.4: decoded server truth, subscriptions, and optimistic baselines remain
  // authoritative after authored modules run. Never dispatch those facts through mutable ambient
  // Map/Set/String prototype methods.
  const values = securityMap<string, unknown>();
  const plans = securityMap<string, Set<QueryUpdatePlan>>();
  const familyPlans = securityMap<string, Set<QueryFamilyUpdatePlan>>();

  const store: QueryStore = {
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
      if (updatePlans) {
        securitySetForEach(updatePlans, (plan) => {
          plan(value);
        });
      }
      const familyUpdatePlans = securityMapGet(familyPlans, name);
      if (familyUpdatePlans) {
        securitySetForEach(familyUpdatePlans, (plan) => {
          plan(value, key);
        });
      }
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
  securityWeakMapSet(queryStorePresence, store, (storeKey) => securityMapHas(values, storeKey));
  securityWeakMapSet(queryStoreFamilySubscriptions, store, {
    plans: familyPlans,
    replay(name, plan) {
      securityMapForEach(values, (value, storeKey) => {
        if (storeKey === name) {
          plan(value);
          return;
        }
        const prefix = `${name}\0`;
        if (securityStringIndexOf(storeKey, prefix) === 0) {
          plan(value, securityStringSlice(storeKey, prefix.length));
        }
      });
    },
  });
  return store;
}

/**
 * @internal Subscribe one compiler-emitted plan to every instance of a query family.
 *
 * The generated loader uses this so an optimistic `store.set(name, value, key)` follows the same
 * DOM update path as initial hydration, typed refetch, mutation settlement, and live push.
 */
export function subscribeQueryFamily<Value = unknown>(
  store: QueryStore,
  name: string,
  plan: QueryFamilyUpdatePlan<Value>,
): () => void {
  const familyState = securityWeakMapGet(queryStoreFamilySubscriptions, store);
  if (familyState === undefined) {
    throw new TypeError('Kovo query-family subscriptions require a framework-created query store.');
  }
  const families = familyState.plans;
  const existing = securityMapGet(families, name) ?? securitySet<QueryFamilyUpdatePlan>();
  securitySetAdd(existing, plan as QueryFamilyUpdatePlan);
  securityMapSet(families, name, existing);
  familyState.replay(name, plan as QueryFamilyUpdatePlan);

  return () => {
    securitySetDelete(existing, plan as QueryFamilyUpdatePlan);
    let hasLivePlan = false;
    securitySetForEach(existing, () => {
      hasLivePlan = true;
    });
    if (!hasLivePlan && securityMapGet(families, name) === existing) {
      securityMapDelete(families, name);
    }
  };
}

/**
 * @internal Exact presence check for framework-created stores.
 *
 * Structural custom stores predate an explicit presence API. Their only observable distinction is
 * `get() !== undefined`, while the framework store retains exact membership out of band so stream
 * rollback never fabricates an explicit `undefined` entry.
 */
export function queryStoreHasValue(store: QueryStore, name: string, key?: string): boolean {
  const storeKey = queryStoreKey(name, key);
  const has = securityWeakMapGet(queryStorePresence, store);
  return has === undefined ? store.get(name, key) !== undefined : has(storeKey);
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export function queryStoreKey(name: string, key: string | undefined): string {
  if (
    !frameworkWireIdentityIsValid(name) ||
    (key !== undefined && !frameworkWireIdentityIsValid(key))
  ) {
    throw new TypeError('Kovo query store identities must be non-empty valid scalar strings.');
  }
  return key === undefined ? name : `${name}\0${key}`;
}

/** @internal Construct the single frozen query-identity currency used by runtime results/hooks. */
export function createQueryIdentity(name: string, key?: string): QueryIdentity {
  if (
    !frameworkWireIdentityIsValid(name) ||
    (key !== undefined && !frameworkWireIdentityIsValid(key))
  ) {
    throw new TypeError('Kovo query identities must be non-empty valid scalar strings.');
  }
  return freezeSecurityValue(key === undefined ? { name } : { key, name });
}

/** @internal Explicit presentation conversion for DOM dependency stamps and legacy wire labels. */
export function queryIdentityDisplay(identity: QueryIdentity): string {
  const name = securityGetOwnPropertyDescriptor(identity, 'name');
  const key = securityGetOwnPropertyDescriptor(identity, 'key');
  if (!name || !('value' in name) || !frameworkWireIdentityIsValid(name.value)) {
    throw new TypeError('Kovo query display identity requires a non-empty own-data scalar name.');
  }
  if (key && (!('value' in key) || !frameworkWireIdentityIsValid(key.value))) {
    throw new TypeError('Kovo query display identity key must be non-empty own-data scalar text.');
  }
  return key && 'value' in key ? (key.value as string) : name.value;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export function queryIdentityFromStoreKey(storeKey: string): QueryIdentity {
  const separator = securityStringIndexOf(storeKey, '\0');
  if (separator === -1) return createQueryIdentity(storeKey);

  return createQueryIdentity(
    securityStringSlice(storeKey, 0, separator),
    securityStringSlice(storeKey, separator + 1),
  );
}
