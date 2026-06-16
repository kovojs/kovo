import type { Form, FormInput, InvalidationSets, JsonValue, QueryRegistry } from '@kovojs/core';
import { queryIdentityFromStoreKey, queryStoreKey } from './query-store.js';
import type { QuerySnapshot, QueryStore } from './query-store.js';

/** A pure optimistic predictor: map a query's current value plus the mutation input to the predicted value. */
export type OptimisticTransform<Input = unknown, Value = unknown> = (
  current: Value,
  input: Input,
) => Value;

/** A client-side record of one domain a mutation changed, optionally key-scoped. */
export interface MutationChangeRecord {
  domain: string;
  keys?: readonly string[];
}

/** A change a mutation made, carrying its input, used to key optimistic updates. */
export interface OptimisticChange<Input = unknown> extends MutationChangeRecord {
  input: Input;
}

/** How to derive the query-instance key an optimistic change applies to. */
export type OptimisticQueryKey<Input = unknown> =
  | ((change: OptimisticChange<Input>) => string | undefined)
  | string
  | undefined;

/** An optimistic plan: per-query transforms, an optional `queue`, and instance-key derivation. */
export interface OptimisticPlan<Input = unknown> {
  keys?: Readonly<Record<string, OptimisticQueryKey<Input>>>;
  queue?: string;
  transforms: Record<string, OptimisticTransform<Input>>;
}

/** One query's optimistic policy: a transform, or `'await-fragment'` to wait for server truth. */
export type OptimisticEntry<Input = unknown, Value = unknown> =
  | OptimisticTransform<Input, Value>
  | 'await-fragment';

type MutationKey<Definition> =
  Definition extends Form<infer Key, Record<string, JsonValue>, JsonValue> ? Key : never;

type InvalidatedQueryNames<Definition> =
  MutationKey<Definition> extends keyof InvalidationSets
    ? Extract<InvalidationSets[MutationKey<Definition>], Extract<keyof QueryRegistry, string>>
    : never;

type InvalidatedQueryValues<Definition> = {
  [QueryName in InvalidatedQueryNames<Definition>]: QueryRegistry[QueryName];
};

/**
 * The exhaustiveness-checked optimistic plan for a mutation form. Keyed by the
 * queries the mutation invalidates, each entry is either a pure
 * `OptimisticTransform` (predict from input) or `'await-fragment'` (a recorded
 * decision to wait for server truth). TypeScript requires an entry per
 * invalidated query, so deleting a transform turns the `satisfies` clause red
 * (SPEC §10.4, §10.6).
 *
 * @example
 * import { form } from '@kovojs/core';
 * import type { OptimisticFor } from '@kovojs/runtime';
 *
 * const addToCart = form('cart/add');
 *
 * export const addToCartOptimistic = {
 *   queue: 'cart',
 *   transforms: {},
 * } satisfies OptimisticFor<typeof addToCart>;
 */
export type OptimisticFor<
  Definition extends Form<string, Record<string, JsonValue>, JsonValue>,
  QueryValues extends Record<string, unknown> = InvalidatedQueryValues<Definition>,
> = Omit<OptimisticPlan<FormInput<Definition>>, 'transforms'> & {
  transforms: {
    [QueryName in keyof QueryValues]: OptimisticEntry<
      FormInput<Definition>,
      QueryValues[QueryName]
    >;
  };
};

/**
 * A staged optimistic prediction: `commit` it to keep the predicted store state,
 * or `restore` it to roll back to the captured `snapshot` when the server rejects
 * the mutation (SPEC §10.4).
 */
export interface PendingOptimism {
  commit(): void;
  restore(): void;
  snapshot: QuerySnapshot;
}

/**
 * One recorded optimistic transform awaiting reconciliation: the `change` that
 * triggered it, the mutation `id` it belongs to, and the pure `transform` re-run
 * on rebase against server truth (SPEC §10.5).
 */
export interface PendingTransform<Input = unknown> {
  change: OptimisticChange<Input>;
  id: string;
  transform: OptimisticTransform<Input>;
}

interface PagehideRoot {
  addEventListener(type: 'pagehide', listener: () => void): void;
  removeEventListener?: (type: 'pagehide', listener: () => void) => void;
}

/** @internal */
export interface PagehideOptimismCleanupOptions {
  discardPendingOptimism: () => readonly string[] | void;
  root: PagehideRoot;
}

/** @internal */
export class OptimisticRebaser {
  #pendingByQuery = new Map<string, PendingTransform[]>();
  #serverTruthByQuery = new Map<string, unknown>();
  #store: QueryStore;

  constructor(store: QueryStore) {
    this.#store = store;
  }

  add<Input>(id: string, input: Input, plan: OptimisticPlan<Input>): void {
    this.addChange(id, optimisticChangeFromInput(input), plan);
  }

  addChange<Input>(id: string, change: OptimisticChange<Input>, plan: OptimisticPlan<Input>): void {
    for (const [queryName, transform] of Object.entries(plan.transforms)) {
      const key = optimisticQueryKey(plan, queryName, change);
      const storeKey = queryStoreKey(queryName, key);
      const pending = this.#pendingByQuery.get(storeKey) ?? [];
      if (pending.length === 0) {
        this.#serverTruthByQuery.set(storeKey, structuredClone(this.#store.get(queryName, key)));
      }
      pending.push({ change, id, transform: transform as OptimisticTransform });
      this.#pendingByQuery.set(storeKey, pending);

      this.#store.set(queryName, transform(this.#store.get(queryName, key), change.input), key);
    }
  }

  settle(id: string): void {
    for (const [queryName, pending] of this.#pendingByQuery) {
      const next = pending.filter((item) => item.id !== id);
      if (next.length === 0) {
        this.#pendingByQuery.delete(queryName);
        this.#serverTruthByQuery.delete(queryName);
      } else {
        this.#pendingByQuery.set(queryName, next);
      }
    }
  }

  settleWithoutServerTruth(id: string, queryName: string, key?: string): void {
    const storeKey = queryStoreKey(queryName, key);
    const pending = this.#pendingByQuery.get(storeKey);
    if (!pending) return;

    const nextPending = pending.filter((item) => item.id !== id);
    let next = structuredClone(this.#serverTruthByQuery.get(storeKey));

    for (const pendingTransform of nextPending) {
      next = pendingTransform.transform(next, pendingTransform.change.input);
    }

    this.#store.set(queryName, next, key);

    if (nextPending.length === 0) {
      this.#pendingByQuery.delete(storeKey);
      this.#serverTruthByQuery.delete(storeKey);
    } else {
      this.#pendingByQuery.set(storeKey, nextPending);
    }
  }

  applyServerTruth<Value>(queryName: string, value: Value, key?: string): void {
    const storeKey = queryStoreKey(queryName, key);
    let next: unknown = value;
    const pendingTransforms = this.#pendingByQuery.get(storeKey) ?? [];

    if (pendingTransforms.length > 0) {
      this.#serverTruthByQuery.set(storeKey, structuredClone(value));
    } else {
      this.#serverTruthByQuery.delete(storeKey);
    }

    for (const pending of pendingTransforms) {
      next = pending.transform(next, pending.change.input);
    }

    this.#store.set(queryName, next, key);
  }

  discardPendingOptimism(
    queryNames?: readonly string[],
    keys: Readonly<Record<string, string | undefined>> = {},
  ): string[] {
    const discarded: string[] = [];

    for (const storeKey of queryNames?.map((queryName) =>
      queryStoreKey(queryName, keys[queryName]),
    ) ?? [...this.#pendingByQuery.keys()]) {
      if (!this.#pendingByQuery.has(storeKey)) continue;

      const identity = queryIdentityFromStoreKey(storeKey);
      this.#store.set(
        identity.name,
        structuredClone(this.#serverTruthByQuery.get(storeKey)),
        identity.key,
      );
      this.#pendingByQuery.delete(storeKey);
      this.#serverTruthByQuery.delete(storeKey);
      discarded.push(identity.name);
    }

    return discarded;
  }

  pendingCount(queryName: string, key?: string): number {
    return this.#pendingByQuery.get(queryStoreKey(queryName, key))?.length ?? 0;
  }
}

/** @internal */
export function installPagehideOptimismCleanup(
  options: PagehideOptimismCleanupOptions,
): () => void {
  // SPEC.md §8/§9.3: pagehide is bfcache-safe; unload handlers are forbidden.
  const listener = () => {
    options.discardPendingOptimism();
  };
  options.root.addEventListener('pagehide', listener);
  return () => {
    options.root.removeEventListener?.('pagehide', listener);
  };
}

/** @internal */
export function applyOptimisticTransforms<Input>(
  store: QueryStore,
  input: Input,
  plan: OptimisticPlan<Input>,
  change: OptimisticChange<Input> = optimisticChangeFromInput(input),
): PendingOptimism {
  const queryNames = Object.keys(plan.transforms);
  const keys = resolveOptimisticKeys(plan, change);
  const snapshot = store.snapshot(queryNames, keys);

  for (const queryName of queryNames) {
    const transform = plan.transforms[queryName];
    if (!transform) continue;
    const key = keys[queryName];

    store.set(queryName, transform(store.get(queryName, key), change.input), key);
  }

  return {
    commit() {
      snapshot.clear();
    },
    restore() {
      for (const [storeKey, value] of snapshot) {
        const identity = queryIdentityFromStoreKey(storeKey);
        store.set(identity.name, value, identity.key);
      }
    },
    snapshot,
  };
}

export function optimisticChangeFromInput<Input>(
  input: Input,
  change?: OptimisticChange<Input>,
): OptimisticChange<Input> {
  return change ?? { domain: 'mutation', input };
}

let derivedTempIdCounter = 0;

/**
 * Fresh client-only id for a row inserted by a derived optimistic transform
 * (SPEC.md §10.5 INSERT × AGG): a tempId placeholder, pending-styled and
 * content-matched against server truth on reconcile. Re-running the transform
 * during rebase mints a new id — safe because the row is a prediction until the
 * server's `<kovo-query>` truth replaces it.
 */
export function tempId(): string {
  derivedTempIdCounter += 1;
  return `kovo-tmp-${derivedTempIdCounter}`;
}

/**
 * Client clock for `now()` placeholders in derived optimistic transforms (SPEC.md §10.5).
 * @internal
 */
export function now(): number {
  return Date.now();
}

export function resolveOptimisticKeys<Input>(
  plan: OptimisticPlan<Input>,
  change: OptimisticChange<Input>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.keys(plan.transforms).map((queryName) => [
      queryName,
      optimisticQueryKey(plan, queryName, change),
    ]),
  );
}

function optimisticQueryKey<Input>(
  plan: OptimisticPlan<Input>,
  queryName: string,
  change: OptimisticChange<Input>,
): string | undefined {
  const key = plan.keys?.[queryName];
  return typeof key === 'function' ? key(change) : key;
}
