import { definedProps } from './defined-props.js';
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
import { readQueryScriptChunk, readQueryScriptChunks } from './wire-parser.js';
import type { QueryChunk, QueryScriptChunkLike } from './wire-parser.js';

export interface QueryScriptLike extends QueryScriptChunkLike {}

export type QueryApplyInterposition = (query: QueryChunk) => { value: unknown } | void;

export interface QueryScriptHydrationLedger {
  hydrate(
    scripts: Iterable<QueryScriptLike>,
    options?: QueryScriptHydrationOptions,
  ): readonly string[];
}

interface ApplyQueryChunksOptions {
  afterApplyQuery?: (query: QueryChunk, value: unknown) => void;
  applyQuery?: QueryApplyInterposition;
}

export interface ApplyQueryChunksToRuntimeOptions extends ApplyQueryChunksOptions {
  queryPlans?: CompiledQueryUpdatePlans;
  root?: unknown;
}

export interface QueryScriptHydrationOptions extends ApplyQueryChunksToRuntimeOptions {
  onError?: RuntimeErrorReporter;
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

export function hydrateQueryScripts(
  store: QueryStore,
  scripts: Iterable<QueryScriptLike>,
  options: QueryScriptHydrationOptions = {},
): readonly string[] {
  // SPEC.md §9.1/§9.4: initial hydration uses the same batched query chunk
  // application path as mutation responses, deferred streams, and typed reads.
  return applyQueryChunksToRuntime(store, readQueryScriptChunks(scripts, options.onError), {
    ...definedProps({
      afterApplyQuery: options.afterApplyQuery,
      applyQuery: options.applyQuery,
      queryPlans: options.queryPlans,
      root: options.root,
    }),
  });
}

export function createQueryScriptHydrationLedger(
  store: QueryStore,
  options: QueryScriptHydrationOptions = {},
): QueryScriptHydrationLedger {
  const seen = new Set<QueryScriptLike>();

  return {
    hydrate(
      scripts: Iterable<QueryScriptLike>,
      hydrationOptions: QueryScriptHydrationOptions = {},
    ): readonly string[] {
      const mergedOptions = {
        ...definedProps({
          afterApplyQuery: options.afterApplyQuery,
          applyQuery: options.applyQuery,
          queryPlans: options.queryPlans,
          root: options.root,
        }),
        ...definedProps({
          afterApplyQuery: hydrationOptions.afterApplyQuery,
          applyQuery: hydrationOptions.applyQuery,
          onError: hydrationOptions.onError,
          queryPlans: hydrationOptions.queryPlans,
          root: hydrationOptions.root,
        }),
      };
      const records: Array<{ query: QueryChunk; script: QueryScriptLike }> = [];

      for (const script of scripts) {
        if (seen.has(script)) continue;

        const query = readQueryScriptChunk(script, mergedOptions.onError);
        if (!query) continue;

        records.push({ query, script });
      }

      // SPEC.md §9.1/§9.4: browser hydration, mutation responses, and typed
      // refetches must converge on the same query-store apply path without
      // replaying already applied server-provided scripts. Malformed transient
      // script data is intentionally left observable for a later hydration pass.
      const hydrated = applyQueryChunksToRuntime(
        store,
        records.map((record) => record.query),
        {
          ...definedProps({
            afterApplyQuery: mergedOptions.afterApplyQuery,
            applyQuery: mergedOptions.applyQuery,
            queryPlans: mergedOptions.queryPlans,
            root: mergedOptions.root,
          }),
        },
      );
      for (const record of records) {
        seen.add(record.script);
      }
      return hydrated;
    },
  };
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
