import type { Form, FormInput, InvalidationSets, QueryRegistry } from '@kovojs/core';
import { reportRuntimeError } from './error-policy.js';
import type { RuntimeErrorReporter } from './error-policy.js';
import { queryIdentityFromStoreKey, queryStoreKey, queryWireKey } from './query-store.js';
import type { QuerySnapshot, QueryStore } from './query-store.js';
import { addRuntimeEventListener, removeRuntimeEventListener } from './runtime-dom-security.js';
import {
  defineSecurityProperties,
  securityArrayAppend,
  securityGetOwnPropertyDescriptor,
  securityMap,
  securityMapDelete,
  securityMapForEach,
  securityMapGet,
  securityMapHas,
  securityMapSet,
  securityObjectKeys,
  securityOwnArrayEntry,
  securitySet,
  securitySetAdd,
  securitySetHas,
  securityString,
} from './security-witness-intrinsics.js';

/** A pure optimistic predictor: mutate the cloned query draft for the mutation input. */
export type OptimisticTransform<Input = unknown, Value = unknown> = (
  draft: Value,
  input: Input,
) => Value | void;

/** One query's optimistic policy: a transform, or `'await-fragment'` to wait for server truth. */
export type OptimisticEntry<Input = unknown, Value = unknown> =
  | OptimisticTransform<Input, Value>
  | 'await-fragment';

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
  transforms: Record<string, OptimisticEntry<Input>>;
}

/**
 * @internal The §10.2 instance-key derivation an authored keyed transform carries: name the keyed
 * query INSTANCE this transform predicts (§10.2:1040) from the same validated mutation `input` the
 * query's own `instanceKey` resolves against (§10.2 WHERE eq-predicate → `args.*`). A STRING result
 * IS the full canonical `name:keyValue` instance key (symmetric with the query's own
 * `instanceKey: (input) => string`, e.g. `product:p1`); an args OBJECT supplies only the `keyValue`
 * half (its values joined in declared order), which {@link optimisticPlanFromAuthoredMap} prefixes
 * with the query name to form the canonical instance key.
 */
export type AuthoredOptimisticKeyDerivation<Input = unknown> = (
  input: Input,
) => string | Record<string, string | number | boolean>;

/**
 * @internal An authored keyed optimistic entry — the runtime mirror of the server
 * `MutationOptimisticKeyedEntry` authoring shape (SPEC §10.4): a pure `transform` plus the
 * `keys` derivation naming the keyed query INSTANCE it predicts (§10.2). Lowered by
 * {@link optimisticPlanFromAuthoredMap} into an {@link OptimisticPlan} whose `keys` map
 * routes the prediction (and its rebase) to that instance's store slot.
 */
export interface KeyedOptimisticEntry<Input = unknown, Value = unknown> {
  keys: AuthoredOptimisticKeyDerivation<Input>;
  transform: OptimisticTransform<Input, Value>;
}

/** @internal One authored entry in an inline `mutation({ optimistic })` map (SPEC §10.4): an
 * unkeyed transform, a {@link KeyedOptimisticEntry} keyed pair, or `'await-fragment'`. */
export type AuthoredOptimisticEntry<Input = unknown, Value = unknown> =
  | OptimisticEntry<Input, Value>
  | KeyedOptimisticEntry<Input, Value>;

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
 * import type { OptimisticFor } from '@kovojs/browser';
 * import { addToCart } from './mutations';
 *
 * const addToCartForm = form(addToCart);
 *
 * export const addToCartOptimistic = {
 *   queue: 'cart',
 *   transforms: {},
 * } satisfies OptimisticFor<typeof addToCartForm>;
 */
export type OptimisticFor<
  Definition extends Form<string, any, any>,
  QueryValues extends Record<string, unknown> = {
    [QueryName in Definition extends Form<infer Key, any, any>
      ? Key extends keyof InvalidationSets
        ? Extract<InvalidationSets[Key], Extract<keyof QueryRegistry, string>>
        : never
      : never]: QueryRegistry[QueryName];
  },
> = Omit<OptimisticPlan<FormInput<Definition>>, 'transforms'> & {
  transforms: {
    [QueryName in keyof QueryValues]: OptimisticEntry<
      FormInput<Definition>,
      QueryValues[QueryName]
    >;
  };
};

/**
 * @internal A staged optimistic prediction: `commit` it to keep the predicted store state,
 * or `restore` it to roll back to the captured `snapshot` when the server rejects
 * the mutation (SPEC §10.4).
 */
export interface PendingOptimism {
  commit(): void;
  restore(): void;
  snapshot: QuerySnapshot;
}

/**
 * @internal One recorded optimistic transform awaiting reconciliation: the `change` that
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

/** @internal Options for installing pagehide-driven optimistic cleanup (SPEC §10.4). */
export interface PagehideOptimismCleanupOptions {
  discardPendingOptimism: () => readonly string[] | void;
  root: PagehideRoot;
}

/** @internal Options for constructing an {@link OptimisticRebaser} (SPEC §10.4/§10.5). */
export interface OptimisticRebaserOptions {
  /**
   * Reports a per-transform throw the rebaser recovers from (KV313, SPEC §10.4 line 1129):
   * a transform that throws on enqueue (F3) or while rebasing over arriving server truth (F2)
   * is dropped rather than freezing a stale prediction or corrupting the baseline; the dropped
   * prediction is surfaced here so app code/devtools see the escape.
   */
  onError?: RuntimeErrorReporter;
}

/** @internal Tracks pending optimistic transforms and rebases them against server truth (SPEC §10.5). */
export class OptimisticRebaser {
  #pendingByQuery = securityMap<string, PendingTransform[]>();
  #serverTruthByQuery = securityMap<string, unknown>();
  #store: QueryStore;
  #onError: RuntimeErrorReporter | undefined;

  constructor(store: QueryStore, options: OptimisticRebaserOptions = {}) {
    this.#store = store;
    this.#onError = options.onError;
  }

  add<Input>(id: string, input: Input, plan: OptimisticPlan<Input>): void {
    this.addChange(id, optimisticChangeFromInput(input), plan);
  }

  addChange<Input>(id: string, change: OptimisticChange<Input>, plan: OptimisticPlan<Input>): void {
    // SPEC §10.4 (F3): two-phase enqueue. Predict every transform against the live store FIRST,
    // committing NOTHING. A transform that throws on enqueue (store value undefined/wrong shape)
    // must not orphan a pending entry nor leave a sibling query half-applied — an orphan would
    // re-throw on every future applyServerTruth and permanently break that query's reconciliation.
    // Only if ALL transforms predict cleanly do we record pending + write the store; on any throw
    // we report (KV313) and leave the store and pending log untouched.
    const staged: Array<{
      key?: string;
      predicted: unknown;
      previous: unknown;
      queryName: string;
      storeKey: string;
      transform: OptimisticTransform;
    }> = [];

    const queryNames = securityObjectKeys(plan.transforms);
    for (let queryIndex = 0; queryIndex < queryNames.length; queryIndex += 1) {
      const queryEntry = securityOwnArrayEntry(queryNames, queryIndex);
      if (!queryEntry.ok) throw new TypeError('Kovo optimistic query plan must be dense.');
      const queryName = queryEntry.value;
      const transform = plan.transforms[queryName];
      if (transform === 'await-fragment') continue;
      if (typeof transform !== 'function') {
        throw new TypeError('Kovo optimistic query plan entries must be transforms or await-fragment.');
      }

      const key = optimisticQueryKey(plan, queryName, change);
      const storeKey = queryStoreKey(queryName, key);
      const previous = this.#store.get(queryName, key);

      let predicted: unknown;
      try {
        predicted = applyOptimisticTransform(previous, change.input, transform);
      } catch (error) {
        // Phase-1 failure: nothing committed yet, so there is nothing to roll back.
        reportRuntimeError(this.#onError, error);
        return;
      }

      securityArrayAppend(
        staged,
        {
          ...(key === undefined ? {} : { key }),
          predicted,
          previous,
          queryName,
          storeKey,
          transform: transform as OptimisticTransform,
        },
        'Browser optimistic staged transforms',
      );
    }

    // Phase 2: all transforms predicted cleanly — commit pending + store writes.
    for (let stagedIndex = 0; stagedIndex < staged.length; stagedIndex += 1) {
      const stagedEntry = securityOwnArrayEntry(staged, stagedIndex);
      if (!stagedEntry.ok) throw new TypeError('Kovo optimistic staged transforms must be dense.');
      const entry = stagedEntry.value;
      const pending = securityMapGet(this.#pendingByQuery, entry.storeKey) ?? [];
      if (pending.length === 0) {
        securityMapSet(this.#serverTruthByQuery, entry.storeKey, entry.previous);
      }
      securityArrayAppend(
        pending,
        { change, id, transform: entry.transform },
        'Browser optimistic pending transforms',
      );
      securityMapSet(this.#pendingByQuery, entry.storeKey, pending);

      this.#store.set(entry.queryName, entry.predicted, entry.key);
    }
  }

  settle(id: string): void {
    const entries: Array<{ pending: PendingTransform[]; queryName: string }> = [];
    securityMapForEach(this.#pendingByQuery, (pending, queryName) => {
      securityArrayAppend(
        entries,
        { pending, queryName },
        'Browser optimistic settlement snapshot',
      );
    });
    for (let index = 0; index < entries.length; index += 1) {
      const entry = securityOwnArrayEntry(entries, index);
      if (!entry.ok) throw new TypeError('Kovo optimistic settlement snapshot must be dense.');
      const { pending, queryName } = entry.value;
      const next = pendingWithoutIds(pending, securitySetFromDenseStrings([id]));
      if (next.length === 0) {
        securityMapDelete(this.#pendingByQuery, queryName);
        securityMapDelete(this.#serverTruthByQuery, queryName);
      } else {
        securityMapSet(this.#pendingByQuery, queryName, next);
      }
    }
  }

  settleWithoutServerTruth(id: string, queryName: string, key?: string): void {
    const storeKey = queryStoreKey(queryName, key);
    const pending = securityMapGet(this.#pendingByQuery, storeKey);
    if (!pending) return;

    const nextPending = pendingWithoutIds(pending, securitySetFromDenseStrings([id]));
    let next = securityMapGet(this.#serverTruthByQuery, storeKey);
    const survivors: PendingTransform[] = [];

    for (let index = 0; index < nextPending.length; index += 1) {
      const pendingEntry = securityOwnArrayEntry(nextPending, index);
      if (!pendingEntry.ok) throw new TypeError('Kovo optimistic pending transforms must be dense.');
      const pendingTransform = pendingEntry.value;
      try {
        next = applyOptimisticTransform(
          next,
          pendingTransform.change.input,
          pendingTransform.transform,
        );
      } catch (error) {
        reportRuntimeError(this.#onError, error);
        continue;
      }
      securityArrayAppend(
        survivors,
        pendingTransform,
        'Browser optimistic surviving transforms',
      );
    }

    this.#store.set(queryName, next, key);

    if (survivors.length === 0) {
      securityMapDelete(this.#pendingByQuery, storeKey);
      securityMapDelete(this.#serverTruthByQuery, storeKey);
    } else {
      securityMapSet(this.#pendingByQuery, storeKey, survivors);
    }
  }

  applyServerTruth<Value>(
    queryName: string,
    value: Value,
    key?: string,
    settles?: readonly string[],
  ): void {
    const storeKey = queryStoreKey(queryName, key);
    let next: unknown = value;

    // Settlement-before-rebase (SPEC §9.1.1 line 828, §10.4 line 1118): drop every pending
    // transform whose mutation idem is in the arriving truth's settlement set BEFORE re-applying
    // the remainder, so a transform already folded into this truth is never re-applied
    // (double-counted). Concurrent distinct same-query commits each settle in their own chunk.
    let pendingTransforms = securityMapGet(this.#pendingByQuery, storeKey) ?? [];
    if (settles && settles.length > 0 && pendingTransforms.length > 0) {
      const settled = securitySetFromDenseStrings(settles);
      const survivors = pendingWithoutIds(pendingTransforms, settled);
      if (survivors.length === 0) {
        securityMapDelete(this.#pendingByQuery, storeKey);
      } else {
        securityMapSet(this.#pendingByQuery, storeKey, survivors);
      }
      pendingTransforms = survivors;
    }

    if (pendingTransforms.length > 0) {
      securityMapSet(this.#serverTruthByQuery, storeKey, value);
    } else {
      securityMapDelete(this.#serverTruthByQuery, storeKey);
    }

    // SPEC §10.4 line 1129 / KV313 (F2): be fault-atomic. Re-apply each survivor over the SETTLED
    // server truth with a per-transform try/catch, so no throw can escape and leave the store frozen
    // on the pre-truth prediction. A survivor that throws (e.g. a concurrent delete made truth
    // `{items:null}` but the transform does `items.push`) is dropped and reported — never freeze the
    // stale prediction on screen, never discard the arriving truth, and never re-run that throwing
    // transform on the next reconcile. `applyOptimisticTransform` clones before mutating, so a throw
    // leaves `next` at the last successfully-rebased value.
    const survivors: PendingTransform[] = [];
    for (let index = 0; index < pendingTransforms.length; index += 1) {
      const pendingEntry = securityOwnArrayEntry(pendingTransforms, index);
      if (!pendingEntry.ok) throw new TypeError('Kovo optimistic pending transforms must be dense.');
      const pending = pendingEntry.value;
      try {
        next = applyOptimisticTransform(next, pending.change.input, pending.transform);
      } catch (error) {
        reportRuntimeError(this.#onError, error);
        continue;
      }
      securityArrayAppend(survivors, pending, 'Browser optimistic surviving transforms');
    }

    // The store always lands on settled truth + surviving predictions, never the old prediction.
    this.#store.set(queryName, next, key);

    if (survivors.length === 0) {
      securityMapDelete(this.#pendingByQuery, storeKey);
      securityMapDelete(this.#serverTruthByQuery, storeKey);
    } else if (survivors.length !== pendingTransforms.length) {
      securityMapSet(this.#pendingByQuery, storeKey, survivors);
    }
  }

  discardPendingOptimism(
    queryNames?: readonly string[],
    keys: Readonly<Record<string, string | undefined>> = {},
  ): string[] {
    const discarded: string[] = [];

    const storeKeys: string[] = [];
    if (queryNames) {
      for (let index = 0; index < queryNames.length; index += 1) {
        const queryEntry = securityOwnArrayEntry(queryNames, index);
        if (!queryEntry.ok || typeof queryEntry.value !== 'string') {
          throw new TypeError('Kovo optimistic discard query names must be dense strings.');
        }
        securityArrayAppend(
          storeKeys,
          queryStoreKey(queryEntry.value, keys[queryEntry.value]),
          'Browser optimistic discard keys',
        );
      }
    } else {
      securityMapForEach(this.#pendingByQuery, (_pending, storeKey) => {
        securityArrayAppend(storeKeys, storeKey, 'Browser optimistic discard keys');
      });
    }
    for (let index = 0; index < storeKeys.length; index += 1) {
      const storeKeyEntry = securityOwnArrayEntry(storeKeys, index);
      if (!storeKeyEntry.ok) throw new TypeError('Kovo optimistic discard keys must be dense.');
      const storeKey = storeKeyEntry.value;
      if (!securityMapHas(this.#pendingByQuery, storeKey)) continue;

      const identity = queryIdentityFromStoreKey(storeKey);
      this.#store.set(
        identity.name,
        securityMapGet(this.#serverTruthByQuery, storeKey),
        identity.key,
      );
      securityMapDelete(this.#pendingByQuery, storeKey);
      securityMapDelete(this.#serverTruthByQuery, storeKey);
      securityArrayAppend(discarded, identity.name, 'Browser optimistic discarded queries');
    }

    return discarded;
  }

  pendingCount(queryName: string, key?: string): number {
    return securityMapGet(this.#pendingByQuery, queryStoreKey(queryName, key))?.length ?? 0;
  }
}

function securitySetFromDenseStrings(values: readonly string[]): Set<string> {
  if (values.length > 100_000) throw new TypeError('Kovo optimistic settlement set is too large.');
  const snapshot = securitySet<string>();
  for (let index = 0; index < values.length; index += 1) {
    const entry = securityOwnArrayEntry(values, index);
    if (!entry.ok || typeof entry.value !== 'string') {
      throw new TypeError('Kovo optimistic settlement set must be a dense string array.');
    }
    securitySetAdd(snapshot, entry.value);
  }
  return snapshot;
}

function pendingWithoutIds(
  pending: readonly PendingTransform[],
  settled: Set<string>,
): PendingTransform[] {
  const survivors: PendingTransform[] = [];
  for (let index = 0; index < pending.length; index += 1) {
    const entry = securityOwnArrayEntry(pending, index);
    if (!entry.ok) throw new TypeError('Kovo optimistic pending transforms must be dense.');
    if (!securitySetHas(settled, entry.value.id)) {
      securityArrayAppend(survivors, entry.value, 'Browser optimistic surviving transforms');
    }
  }
  return survivors;
}

/** @internal Install a bfcache-safe pagehide listener that discards pending optimism (SPEC §10.4). */
export function installPagehideOptimismCleanup(
  options: PagehideOptimismCleanupOptions,
): () => void {
  // SPEC.md §8/§9.3: pagehide is bfcache-safe; unload handlers are forbidden.
  // In browsers pagehide is a Window lifecycle event, while app loaders usually
  // use document as their DOM root for query scans and delegated events.
  const listener = () => {
    options.discardPendingOptimism();
  };
  const globalTarget = globalPagehideTarget(options.root);
  if (!addRuntimeEventListener(options.root, 'pagehide', listener)) {
    throw new TypeError('Kovo optimistic cleanup listener enrollment failed.');
  }
  if (globalTarget && !addRuntimeEventListener(globalTarget, 'pagehide', listener)) {
    removeRuntimeEventListener(options.root, 'pagehide', listener);
    throw new TypeError('Kovo global optimistic cleanup listener enrollment failed.');
  }
  return () => {
    removeRuntimeEventListener(options.root, 'pagehide', listener);
    if (globalTarget) removeRuntimeEventListener(globalTarget, 'pagehide', listener);
  };
}

function globalPagehideTarget(root: PagehideRoot): PagehideRoot | undefined {
  const target = globalThis as unknown as PagehideRoot;
  return target !== root && typeof target.addEventListener === 'function' ? target : undefined;
}

/** @internal Apply a plan's optimistic transforms to the store, returning a commit/restore handle (SPEC §10.4). */
export function applyOptimisticTransforms<Input>(
  store: QueryStore,
  input: Input,
  plan: OptimisticPlan<Input>,
  change: OptimisticChange<Input> = optimisticChangeFromInput(input),
): PendingOptimism {
  const queryNames = securityObjectKeys(plan.transforms);
  const keys = resolveOptimisticKeys(plan, change);
  const snapshot = store.snapshot(queryNames, keys);

  for (let index = 0; index < queryNames.length; index += 1) {
    const queryNameEntry = securityOwnArrayEntry(queryNames, index);
    if (!queryNameEntry.ok) throw new TypeError('Kovo optimistic query names must be dense.');
    const queryName = queryNameEntry.value;
    const transformDescriptor = securityGetOwnPropertyDescriptor(plan.transforms, queryName);
    const transform =
      transformDescriptor && 'value' in transformDescriptor ? transformDescriptor.value : undefined;
    if (!transform || transform === 'await-fragment') continue;
    const key = optimisticKeyRecordValue(keys, queryName);

    store.set(
      queryName,
      applyOptimisticTransform(store.get(queryName, key), change.input, transform),
      key,
    );
  }

  return {
    commit() {
      securityMapForEach(snapshot, (_value, storeKey) => {
        securityMapDelete(snapshot, storeKey);
      });
    },
    restore() {
      securityMapForEach(snapshot, (value, storeKey) => {
        const identity = queryIdentityFromStoreKey(storeKey);
        store.set(identity.name, value, identity.key);
      });
    },
    snapshot,
  };
}

function applyOptimisticTransform<Input>(
  current: unknown,
  input: Input,
  transform: OptimisticTransform<Input>,
): unknown {
  const draft = createCopyOnWriteDraft(current);
  const returned = transform(draft.value, input);
  return returned === undefined ? draft.finish() : returned;
}

type DraftObject = Record<PropertyKey, unknown> | unknown[];

interface DraftState {
  base: DraftObject;
  copy?: DraftObject;
  parent?: DraftState;
  parentKey?: PropertyKey;
  proxy?: DraftObject;
}

interface CopyOnWriteDraft {
  finish(): unknown;
  value: unknown;
}

function createCopyOnWriteDraft(value: unknown): CopyOnWriteDraft {
  if (!isDraftable(value)) {
    return {
      finish: () => value,
      value,
    };
  }

  const states = new WeakMap<DraftObject, DraftState>();

  const mutableCopyFor = (state: DraftState): DraftObject => {
    if (!state.copy) {
      state.copy = Array.isArray(state.base) ? [...state.base] : { ...state.base };
      if (state.parent && state.parentKey !== undefined) {
        const parentCopy = mutableCopyFor(state.parent);
        Reflect.set(parentCopy, state.parentKey, state.copy);
      }
    }

    return state.copy;
  };

  const stateFor = (
    base: DraftObject,
    parent: DraftState | undefined,
    parentKey: PropertyKey | undefined,
  ): DraftState => {
    const existing = states.get(base);
    if (existing) return existing;

    const state: DraftState = { base };
    if (parent) {
      state.parent = parent;
      if (parentKey !== undefined) state.parentKey = parentKey;
    }
    states.set(base, state);
    return state;
  };

  const proxyFor = (
    base: DraftObject,
    parent: DraftState | undefined,
    parentKey: PropertyKey | undefined,
  ): DraftObject => {
    const state = stateFor(base, parent, parentKey);
    if (state.proxy) return state.proxy;

    state.proxy = new Proxy(base, {
      deleteProperty(_target, property) {
        const copy = mutableCopyFor(state);
        return Reflect.deleteProperty(copy, property);
      },
      get(_target, property) {
        const source = state.copy ?? state.base;
        const child = Reflect.get(source, property);
        return isDraftable(child) ? proxyFor(child, state, property) : child;
      },
      getOwnPropertyDescriptor(_target, property) {
        return Reflect.getOwnPropertyDescriptor(state.copy ?? state.base, property);
      },
      has(_target, property) {
        return Reflect.has(state.copy ?? state.base, property);
      },
      ownKeys() {
        return Reflect.ownKeys(state.copy ?? state.base);
      },
      set(_target, property, propertyValue) {
        const copy = mutableCopyFor(state);
        return Reflect.set(copy, property, propertyValue);
      },
    });

    return state.proxy;
  };

  const rootState = stateFor(value, undefined, undefined);
  return {
    finish: () => rootState.copy ?? rootState.base,
    value: proxyFor(value, undefined, undefined),
  };
}

function isDraftable(value: unknown): value is DraftObject {
  return typeof value === 'object' && value !== null;
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

/** Client clock for `now()` placeholders in generated derived optimistic transforms (SPEC.md §10.5). */
export function now(): number {
  return Date.now();
}

export function resolveOptimisticKeys<Input>(
  plan: OptimisticPlan<Input>,
  change: OptimisticChange<Input>,
): Record<string, string | undefined> {
  const resolved: Record<string, string | undefined> = {};
  const queryNames = securityObjectKeys(plan.transforms);
  for (let index = 0; index < queryNames.length; index += 1) {
    const queryName = securityOwnArrayEntry(queryNames, index);
    if (!queryName.ok) throw new TypeError('Kovo optimistic query names must be dense.');
    defineSecurityProperties(resolved, {
      [queryName.value]: {
        configurable: true,
        enumerable: true,
        value: optimisticQueryKey(plan, queryName.value, change),
        writable: true,
      },
    });
  }
  return resolved;
}

function optimisticQueryKey<Input>(
  plan: OptimisticPlan<Input>,
  queryName: string,
  change: OptimisticChange<Input>,
): string | undefined {
  const keys = plan.keys;
  const descriptor = keys ? securityGetOwnPropertyDescriptor(keys, queryName) : undefined;
  const key = descriptor && 'value' in descriptor ? descriptor.value : undefined;
  return typeof key === 'function' ? key(change) : key;
}

function optimisticKeyRecordValue(
  keys: Readonly<Record<string, string | undefined>>,
  queryName: string,
): string | undefined {
  const descriptor = securityGetOwnPropertyDescriptor(keys, queryName);
  return descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
    ? descriptor.value
    : undefined;
}

/**
 * Reduce an authored §10.2 instance-key derivation result to the canonical key VALUE — the
 * `keyValue` HALF of the `name:keyValue` encoding (SPEC §10.2:1040). An args object is reduced to
 * its values joined in declared (insertion) order, so a composite `{ org, id }` key yields
 * `o1:q3`. This returns ONLY the `keyValue`: it does NOT by itself land on a store slot, because
 * the store/wire/optimism share the FULL `name:keyValue` instance key (§10.2:1040 — "this one
 * string keys the client store, the `<kovo-query name key>` wire chunk, kovo-deps, and live-push
 * routing"). {@link optimisticPlanFromAuthoredMap} assembles that full key by prefixing the query
 * name; keying a prediction by this bare `keyValue` alone would target an empty `name␞keyValue`
 * slot while server-truth/hydration land in `name␞name:keyValue`, silently no-op'ing (KV313).
 */
export function canonicalInstanceKeyValue(
  derived: string | Record<string, string | number | boolean>,
): string {
  if (typeof derived === 'string') return derived;
  const names = securityObjectKeys(derived);
  let result = '';
  for (let index = 0; index < names.length; index += 1) {
    const name = securityOwnArrayEntry(names, index);
    if (!name.ok) throw new TypeError('Kovo optimistic key fields must be dense.');
    const descriptor = securityGetOwnPropertyDescriptor(derived, name.value);
    if (!descriptor || !('value' in descriptor)) {
      throw new TypeError('Kovo optimistic key fields must be own-data properties.');
    }
    const value = descriptor.value;
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      throw new TypeError('Kovo optimistic key fields must be string, number, or boolean values.');
    }
    result += `${index === 0 ? '' : ':'}${securityString(value)}`;
  }
  return result;
}

/**
 * @internal Lower an authored inline `mutation({ optimistic })` map (keyed by query NAME,
 * possibly carrying {@link KeyedOptimisticEntry} keyed pairs) into the runtime
 * {@link OptimisticPlan} (SPEC §10.4). This is the bridge between the keyed AUTHORING surface
 * (server `MutationOptimisticMap`, compiler-scanned per §5.2) and the instance-keyed runtime:
 * a keyed entry's `transform` flows into `plan.transforms`, and its `keys` derivation flows
 * into `plan.keys` as a `(change) => name:keyValue` function (§10.2), so the existing rebaser/apply
 * path predicts on, reconciles into, and rebases the correct query INSTANCE (§13.2). Unkeyed
 * transforms and `'await-fragment'` positions lower unchanged.
 */
export function optimisticPlanFromAuthoredMap<Input>(
  map: Readonly<Record<string, AuthoredOptimisticEntry<Input>>>,
  queue?: string,
): OptimisticPlan<Input> {
  const transforms: Record<string, OptimisticEntry<Input>> = {};
  const keys: Record<string, OptimisticQueryKey<Input>> = {};
  const queryNames = securityObjectKeys(map);
  let keyedCount = 0;

  for (let index = 0; index < queryNames.length; index += 1) {
    const queryNameEntry = securityOwnArrayEntry(queryNames, index);
    if (!queryNameEntry.ok) throw new TypeError('Kovo authored optimistic map must be dense.');
    const queryName = queryNameEntry.value;
    const entryDescriptor = securityGetOwnPropertyDescriptor(map, queryName);
    if (!entryDescriptor || !('value' in entryDescriptor)) {
      throw new TypeError('Kovo authored optimistic entries must be own-data properties.');
    }
    const entry = entryDescriptor.value as AuthoredOptimisticEntry<Input>;
    if (entry === 'await-fragment' || typeof entry === 'function') {
      defineSecurityProperties(transforms, {
        [queryName]: { configurable: true, enumerable: true, value: entry, writable: true },
      });
      continue;
    }
    if (entry === null || typeof entry !== 'object') {
      throw new TypeError('Kovo authored optimistic entries are invalid.');
    }
    // SPEC §10.2:1040: a keyed entry contributes its transform plus an instance-key derivation,
    // resolved to the FULL canonical `name:keyValue` — the single instance-key currency the store,
    // the `<kovo-query name key>` wire chunk, and live-push routing all share, so the prediction
    // lands on the SAME slot as server-truth/hydration instead of an orphaned bare-value slot
    // (the L13/KV313 divergence). A STRING derivation IS that full instance key (symmetric with the
    // query's own `instanceKey: (input) => string`, e.g. `product:p1`) and passes through; an args
    // object yields only the `keyValue`, which we prefix with the query name via `queryWireKey`
    // (idempotent — never double-prefixed) to form the canonical instance key.
    const transform = securityGetOwnPropertyDescriptor(entry, 'transform');
    const keyDerivation = securityGetOwnPropertyDescriptor(entry, 'keys');
    if (
      !transform ||
      !('value' in transform) ||
      typeof transform.value !== 'function' ||
      !keyDerivation ||
      !('value' in keyDerivation) ||
      typeof keyDerivation.value !== 'function'
    ) {
      throw new TypeError(
        'Kovo keyed optimistic entries require own-data transform and keys functions.',
      );
    }
    defineSecurityProperties(transforms, {
      [queryName]: {
        configurable: true,
        enumerable: true,
        value: transform.value as OptimisticTransform<Input>,
        writable: true,
      },
    });
    const derive = keyDerivation.value as AuthoredOptimisticKeyDerivation<Input>;
    const key = (change: OptimisticChange<Input>) => {
      const derived = derive(change.input);
      return typeof derived === 'string'
        ? derived
        : queryWireKey(queryName, canonicalInstanceKeyValue(derived));
    };
    defineSecurityProperties(keys, {
      [queryName]: { configurable: true, enumerable: true, value: key, writable: true },
    });
    keyedCount += 1;
  }

  return {
    transforms,
    ...(keyedCount === 0 ? {} : { keys }),
    ...(queue === undefined ? {} : { queue }),
  };
}
