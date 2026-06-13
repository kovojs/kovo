import { definedProps } from './defined-props.js';
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

interface ApplyQueryChunksOptions {
  afterApplyQuery?: (query: QueryChunk, value: unknown) => void;
  applyQuery?: QueryApplyInterposition;
}

export interface ApplyQueryChunksToRuntimeOptions extends ApplyQueryChunksOptions {
  queryPlans?: CompiledQueryUpdatePlans;
  root?: unknown;
}

function applyQueryChunk(
  store: QueryStore,
  query: QueryChunk,
  interpose?: QueryApplyInterposition,
): unknown {
  const interposed = interpose?.(query);
  if (interposed) return interposed.value;

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
    const value = applyQueryChunk(store, query, options.applyQuery);
    options.afterApplyQuery?.(query, value);
    applied.push(queryWireKey(query.name, query.key));
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
      applyCompiledQueryUpdatePlanIfSupported(
        options.root,
        query.name,
        value,
        options.queryPlans?.[query.name],
        readBindingIndex,
      );
      options.afterApplyQuery?.(query, value);
    },
    ...definedProps({ applyQuery: options.applyQuery }),
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
): void {
  if (!root || !supportsQueryBindings(root)) return;

  const options =
    plan.bindings === false || !readBindingIndex ? {} : { bindingIndex: readBindingIndex(root) };
  applyCompiledQueryUpdatePlan(root, queryName, value, plan, options);
}
