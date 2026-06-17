import { applyQueryDelta, QueryDeltaApplyError } from '@kovojs/core';
import type { QueryDelta } from '@kovojs/core';
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

export type QueryApplyInterposition = (query: QueryChunk) => { value: unknown } | void;

/** Invoked when a delta cannot be applied (missing base or deploy-skew). The
 * handler is responsible for refetching the full value (SPEC §9.1.1). */
export type OnDeltaMiss = (name: string, key: string | undefined) => void;

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
    const base = store.get(query.name, query.key);
    try {
      const merged = applyQueryDelta(base, query.value as QueryDelta);
      store.set(query.name, merged, query.key);
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
): void {
  if (!root || !supportsQueryBindings(root)) return;

  const options =
    plan.bindings === false || !readBindingIndex
      ? {}
      : {
          bindingIndex: readBindingIndex(root),
          ...(queryKey === undefined ? {} : { queryKey }),
        };
  applyCompiledQueryUpdatePlan(root, queryName, value, plan, options);
}
