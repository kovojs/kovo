import type { Form, FormInput, InvalidationSets, QueryRegistry } from '@kovojs/core';
import { reportRuntimeError } from './error-policy.js';
import type { RuntimeErrorReporter } from './error-policy.js';
import { queryIdentityFromStoreKey, queryStoreKey } from './query-store.js';
import type { QuerySnapshot, QueryStore } from './query-store.js';

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
 * @internal The §10.2 instance-key derivation an authored keyed transform carries: derive
 * the canonical key VALUE (the `keyValue` of `name:keyValue`, §10.2:1040) for the keyed
 * query instance this transform predicts, from the same validated mutation `input` the
 * query's own `instanceKey` resolves against (§10.2 WHERE eq-predicate → `args.*`). Returns
 * the keyValue string directly, or the declared args object reduced to the keyValue.
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

type MutationKey<Definition> = Definition extends Form<infer Key, any, any> ? Key : never;

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
 * import type { OptimisticFor } from '@kovojs/browser';
 *
 * const addToCart = form('cart/add');
 *
 * export const addToCartOptimistic = {
 *   queue: 'cart',
 *   transforms: {},
 * } satisfies OptimisticFor<typeof addToCart>;
 */
export type OptimisticFor<
  Definition extends Form<string, any, any>,
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
  #pendingByQuery = new Map<string, PendingTransform[]>();
  #serverTruthByQuery = new Map<string, unknown>();
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

    for (const [queryName, transform] of Object.entries(plan.transforms)) {
      if (transform === 'await-fragment') continue;

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

      staged.push({
        ...(key === undefined ? {} : { key }),
        predicted,
        previous,
        queryName,
        storeKey,
        transform: transform as OptimisticTransform,
      });
    }

    // Phase 2: all transforms predicted cleanly — commit pending + store writes.
    for (const entry of staged) {
      const pending = this.#pendingByQuery.get(entry.storeKey) ?? [];
      if (pending.length === 0) {
        this.#serverTruthByQuery.set(entry.storeKey, entry.previous);
      }
      pending.push({ change, id, transform: entry.transform });
      this.#pendingByQuery.set(entry.storeKey, pending);

      this.#store.set(entry.queryName, entry.predicted, entry.key);
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
    let next = this.#serverTruthByQuery.get(storeKey);
    const survivors: PendingTransform[] = [];

    for (const pendingTransform of nextPending) {
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
      survivors.push(pendingTransform);
    }

    this.#store.set(queryName, next, key);

    if (survivors.length === 0) {
      this.#pendingByQuery.delete(storeKey);
      this.#serverTruthByQuery.delete(storeKey);
    } else {
      this.#pendingByQuery.set(storeKey, survivors);
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
    let pendingTransforms = this.#pendingByQuery.get(storeKey) ?? [];
    if (settles && settles.length > 0 && pendingTransforms.length > 0) {
      const settled = new Set(settles);
      const survivors = pendingTransforms.filter((pending) => !settled.has(pending.id));
      if (survivors.length === 0) {
        this.#pendingByQuery.delete(storeKey);
      } else {
        this.#pendingByQuery.set(storeKey, survivors);
      }
      pendingTransforms = survivors;
    }

    if (pendingTransforms.length > 0) {
      this.#serverTruthByQuery.set(storeKey, value);
    } else {
      this.#serverTruthByQuery.delete(storeKey);
    }

    // SPEC §10.4 line 1129 / KV313 (F2): be fault-atomic. Re-apply each survivor over the SETTLED
    // server truth with a per-transform try/catch, so no throw can escape and leave the store frozen
    // on the pre-truth prediction. A survivor that throws (e.g. a concurrent delete made truth
    // `{items:null}` but the transform does `items.push`) is dropped and reported — never freeze the
    // stale prediction on screen, never discard the arriving truth, and never re-run that throwing
    // transform on the next reconcile. `applyOptimisticTransform` clones before mutating, so a throw
    // leaves `next` at the last successfully-rebased value.
    const survivors: PendingTransform[] = [];
    for (const pending of pendingTransforms) {
      try {
        next = applyOptimisticTransform(next, pending.change.input, pending.transform);
      } catch (error) {
        reportRuntimeError(this.#onError, error);
        continue;
      }
      survivors.push(pending);
    }

    // The store always lands on settled truth + surviving predictions, never the old prediction.
    this.#store.set(queryName, next, key);

    if (survivors.length === 0) {
      this.#pendingByQuery.delete(storeKey);
      this.#serverTruthByQuery.delete(storeKey);
    } else if (survivors.length !== pendingTransforms.length) {
      this.#pendingByQuery.set(storeKey, survivors);
    }
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
      this.#store.set(identity.name, this.#serverTruthByQuery.get(storeKey), identity.key);
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
  options.root.addEventListener('pagehide', listener);
  globalTarget?.addEventListener('pagehide', listener);
  return () => {
    options.root.removeEventListener?.('pagehide', listener);
    globalTarget?.removeEventListener?.('pagehide', listener);
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
  const queryNames = Object.keys(plan.transforms);
  const keys = resolveOptimisticKeys(plan, change);
  const snapshot = store.snapshot(queryNames, keys);

  for (const queryName of queryNames) {
    const transform = plan.transforms[queryName];
    if (!transform || transform === 'await-fragment') continue;
    const key = keys[queryName];

    store.set(
      queryName,
      applyOptimisticTransform(store.get(queryName, key), change.input, transform),
      key,
    );
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

/**
 * @internal Client clock for `now()` placeholders in derived optimistic transforms (SPEC.md §10.5).
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

/**
 * Reduce an authored §10.2 instance-key derivation result to the canonical key VALUE — the
 * `keyValue` of the `name:keyValue` encoding (SPEC §10.2:1040). A string result IS the keyValue
 * (symmetric with a query's own `instanceKey: (input) => string`, §10.2). An args object is
 * reduced to its values joined in declared (insertion) order, so a single-arg keyed query
 * (`{ id }`) yields just the value (`q3`) and the prediction lands on the same store slot the
 * matching `<kovo-query name key>` server-truth chunk decodes to (§9.4/§13.2).
 */
export function canonicalInstanceKeyValue(
  derived: string | Record<string, string | number | boolean>,
): string {
  if (typeof derived === 'string') return derived;
  return Object.values(derived)
    .map((value) => String(value))
    .join(':');
}

/**
 * @internal Lower an authored inline `mutation({ optimistic })` map (keyed by query NAME,
 * possibly carrying {@link KeyedOptimisticEntry} keyed pairs) into the runtime
 * {@link OptimisticPlan} (SPEC §10.4). This is the bridge between the keyed AUTHORING surface
 * (server `MutationOptimisticMap`, compiler-scanned per §5.2) and the instance-keyed runtime:
 * a keyed entry's `transform` flows into `plan.transforms`, and its `keys` derivation flows
 * into `plan.keys` as a `(change) => keyValue` function (§10.2), so the existing rebaser/apply
 * path predicts on, reconciles into, and rebases the correct query INSTANCE (§13.2). Unkeyed
 * transforms and `'await-fragment'` positions lower unchanged.
 */
export function optimisticPlanFromAuthoredMap<Input>(
  map: Readonly<Record<string, AuthoredOptimisticEntry<Input>>>,
  queue?: string,
): OptimisticPlan<Input> {
  const transforms: Record<string, OptimisticEntry<Input>> = {};
  const keys: Record<string, OptimisticQueryKey<Input>> = {};

  for (const [queryName, entry] of Object.entries(map)) {
    if (entry === 'await-fragment' || typeof entry === 'function') {
      transforms[queryName] = entry;
      continue;
    }
    // SPEC §10.2/§10.4: a keyed entry contributes its transform plus an instance-key
    // derivation; resolve the author's `(input) => keyValue|args` to the canonical keyValue
    // the runtime store/wire share, evaluated per change against the mutation input.
    transforms[queryName] = entry.transform;
    const derive = entry.keys;
    keys[queryName] = (change) => canonicalInstanceKeyValue(derive(change.input));
  }

  return {
    transforms,
    ...(Object.keys(keys).length === 0 ? {} : { keys }),
    ...(queue === undefined ? {} : { queue }),
  };
}
