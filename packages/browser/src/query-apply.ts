import type { JsonValue } from '@kovojs/core';
import { applyQueryDelta, QueryDeltaApplyError } from '@kovojs/core/internal/query-delta';
import type { QueryDelta } from '@kovojs/core/internal/query-delta';
import { definedProps } from './defined-props.js';
import { reportRuntimeError } from './error-policy.js';
import type { RuntimeErrorReporter } from './error-policy.js';
import {
  applyCompiledQueryUpdatePlan,
  createQueryBindingIndex,
  supportsQueryBindings,
} from './query-bindings.js';
import type {
  CompiledQueryUpdatePlan,
  CompiledQueryUpdatePlans,
  QueryBindingIndex,
  QueryBindingRoot,
} from './query-bindings.js';
import type { QueryStore } from './query-store.js';
import { queryWireKey } from './query-store.js';
import type { QueryChunk } from './wire-parser.js';

/**
 * An app hook that interposes on each incoming query chunk before the runtime
 * writes it to the store: return `{ value }` to override the applied value, or
 * nothing to apply the wire value unchanged (SPEC §9.4). Named by
 * `KovoLoaderOptions.applyQuery`.
 */
export type QueryApplyInterposition = (query: QueryChunk) => { value: unknown } | void;

/** Invoked when a delta cannot be applied (missing base or deploy-skew). The
 * handler is responsible for refetching the full value (SPEC §9.1.1). */
export type OnDeltaMiss = (name: string, key: string | undefined) => void;

/**
 * @internal The subset of {@link OptimisticRebaser} the apply path needs to route an external
 * server-truth writer (a refetch, a same-user broadcast) through the rebaser (SPEC §10.4, F4/L8-2).
 * Structural to avoid an import cycle with `optimism.ts`.
 */
export interface ServerTruthRebaser {
  applyServerTruth(name: string, value: unknown, key?: string, settles?: readonly string[]): void;
}

/**
 * @internal Build a {@link QueryApplyInterposition} that routes every incoming query chunk through
 * the optimistic rebaser as server truth (SPEC §10.4, F4/L8-2). A refetch or same-user broadcast
 * wired with this interpose refreshes the rebaser baseline and re-applies pending predictions
 * instead of clobbering the store with raw truth — so a later failed-mutation rollback re-derives
 * from the fresh baseline and never reverts the out-of-band write. Delta chunks are merged against
 * the held base first (F1); a delta miss routes to `onDeltaMiss` and leaves the store untouched.
 */
export function rebaserApplyQueryInterposition(
  store: QueryStore,
  rebaser: ServerTruthRebaser,
  onDeltaMiss?: OnDeltaMiss,
): QueryApplyInterposition {
  return (query) => {
    let value: unknown;
    try {
      value = resolveQueryChunkValue(store, query);
    } catch (error) {
      if (error instanceof QueryDeltaApplyError) {
        onDeltaMiss?.(query.name, query.key);
        return { value: store.get(query.name, query.key) };
      }
      throw error;
    }
    rebaser.applyServerTruth(query.name, value, query.key, query.settles);
    return { value: store.get(query.name, query.key) };
  };
}

interface ApplyQueryChunksOptions {
  afterApplyQuery?: (query: QueryChunk, value: unknown) => void;
  applyQuery?: QueryApplyInterposition;
  onDeltaMiss?: OnDeltaMiss;
  onError?: RuntimeErrorReporter | undefined;
}

export interface ApplyQueryChunksToRuntimeOptions extends ApplyQueryChunksOptions {
  queryPlans?: CompiledQueryUpdatePlans;
  root?: unknown;
}

/**
 * @internal Resolve a query chunk's effective full value (SPEC §9.1.1): for a
 * `delta=true` chunk the body is a `QueryDelta` envelope ({set}/{lists}) that
 * must be merged against the held base; for a full chunk the body IS the value.
 * Throws `QueryDeltaApplyError` on a delta whose base is missing/stale so the
 * caller can refetch full. Used by both the runtime apply path and the
 * optimistic-submit hook (F1) so neither ever treats the raw delta envelope as a
 * full value.
 */
export function resolveQueryChunkValue(store: QueryStore, query: QueryChunk): unknown {
  if (!query.delta) return query.value;

  const base = store.get(query.name, query.key);
  // Propagates QueryDeltaApplyError on a missing/stale base.
  return applyQueryDelta(base as JsonValue | undefined, query.value as QueryDelta);
}

function applyQueryChunk(
  store: QueryStore,
  query: QueryChunk,
  interpose?: QueryApplyInterposition,
  onDeltaMiss?: OnDeltaMiss,
): unknown {
  const interposed = interpose?.(query);
  if (interposed) return interposed.value;

  // SPEC §9.1.1: when the chunk carries delta=true the body is a QueryDelta
  // envelope; merge it against the held base instead of overwriting.
  if (query.delta) {
    try {
      const merged = resolveQueryChunkValue(store, query);
      store.set(query.name, merged, query.key);
      store.setVersion(query.name, query.version, query.key);
      return merged;
    } catch (error) {
      if (error instanceof QueryDeltaApplyError) {
        // Missing / stale base — invoke the miss handler; do NOT touch the store.
        onDeltaMiss?.(query.name, query.key);
        // Signal to the caller that this chunk was not applied (return undefined
        // so the caller skips afterApplyQuery and does not count it in applied).
        throw error;
      }
      throw error;
    }
  }

  store.set(query.name, query.value, query.key);
  store.setVersion(query.name, query.version, query.key);
  return query.value;
}

function applyQueryChunks(
  store: QueryStore,
  queries: readonly QueryChunk[],
  options: ApplyQueryChunksOptions = {},
): readonly string[] {
  const applied: string[] = [];

  for (const query of queries) {
    try {
      const value = applyQueryChunk(store, query, options.applyQuery, options.onDeltaMiss);
      options.afterApplyQuery?.(query, value);
      applied.push(queryWireKey(query.name, query.key));
    } catch (error) {
      // Delta-miss errors are handled by onDeltaMiss; swallow them silently here
      // (they do not constitute a runtime error — the miss handler refetches).
      if (error instanceof QueryDeltaApplyError) continue;
      if (!('onError' in options)) throw error;
      reportRuntimeError(options.onError, error);
    }
  }

  return applied;
}

export function applyQueryChunksToRuntime(
  store: QueryStore,
  queries: readonly QueryChunk[],
  options: ApplyQueryChunksToRuntimeOptions = {},
): readonly string[] {
  const readBindingIndex = createLazyBindingIndexReader();

  return applyQueryChunks(store, queries, {
    afterApplyQuery(query, value) {
      const queryKey = queryWireKey(query.name, query.key);
      applyCompiledQueryUpdatePlanIfSupported(
        options.root,
        query.name,
        value,
        options.queryPlans?.[queryKey] ?? options.queryPlans?.[query.name],
        readBindingIndex,
        query.key === undefined ? undefined : queryKey,
        store,
      );
      options.afterApplyQuery?.(query, value);
    },
    ...definedProps({ applyQuery: options.applyQuery, onDeltaMiss: options.onDeltaMiss }),
    ...('onError' in options ? { onError: options.onError } : {}),
  });
}

function createLazyBindingIndexReader(): (root: QueryBindingRoot) => QueryBindingIndex {
  let bindingIndex: QueryBindingIndex | undefined;

  return (root) => {
    bindingIndex ??= createQueryBindingIndex(root);
    return bindingIndex;
  };
}

function applyCompiledQueryUpdatePlanIfSupported(
  root: unknown,
  queryName: string,
  value: unknown,
  plan: CompiledQueryUpdatePlan = {},
  readBindingIndex?: (root: QueryBindingRoot) => QueryBindingIndex,
  queryKey?: string,
  queryStore?: QueryStore,
): void {
  if (!root || !supportsQueryBindings(root)) return;

  const options =
    plan.bindings === false || !readBindingIndex
      ? queryStore
        ? { queryStore }
        : {}
      : {
          bindingIndex: readBindingIndex(root),
          ...(queryKey === undefined ? {} : { queryKey }),
          ...(queryStore ? { queryStore } : {}),
        };
  applyCompiledQueryUpdatePlan(root, queryName, value, plan, options);
}
