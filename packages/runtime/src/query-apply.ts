import { definedProps } from './defined-props.js';
import type { OptionalQuerySelectorAllRootLike } from './dom-like.js';
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
import { readQueryScriptChunks } from './wire-parser.js';
import type { QueryChunk, QueryScriptChunkLike } from './wire-parser.js';

export interface QueryScriptLike extends QueryScriptChunkLike {}

export type QueryScriptRootLike = OptionalQuerySelectorAllRootLike<unknown>;

export type QueryApplyInterposition = (query: QueryChunk) => { value: unknown } | void;

export interface QueryScriptHydrationLedger {
  hydrate(
    scripts: Iterable<QueryScriptLike>,
    options?: { onError?: RuntimeErrorReporter },
  ): readonly string[];
}

export interface ApplyQueryChunksToStoreOptions {
  afterApplyQuery?: (query: QueryChunk, value: unknown) => void;
  applyQuery?: QueryApplyInterposition;
}

export interface ApplyQueryChunksToRuntimeOptions extends ApplyQueryChunksToStoreOptions {
  queryPlans?: CompiledQueryUpdatePlans;
  root?: unknown;
}

export function applyQueryChunkToStore(
  store: QueryStore,
  query: QueryChunk,
  interpose?: QueryApplyInterposition,
): unknown {
  const interposed = interpose?.(query);
  if (interposed) return interposed.value;

  store.set(query.name, query.value, query.key);
  return query.value;
}

export function applyQueryChunksToStore(
  store: QueryStore,
  queries: readonly QueryChunk[],
  options: ApplyQueryChunksToStoreOptions = {},
): readonly string[] {
  const applied: string[] = [];

  for (const query of queries) {
    const value = applyQueryChunkToStore(store, query, options.applyQuery);
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

  return applyQueryChunksToStore(store, queries, {
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
  options: { onError?: RuntimeErrorReporter } = {},
): readonly string[] {
  // SPEC.md §9.1/§9.4: initial hydration uses the same batched query chunk
  // application path as mutation responses, deferred streams, and typed reads.
  return applyQueryChunksToStore(store, readQueryScriptChunks(scripts, options.onError));
}

export function queryScriptsFromRoot(root: QueryScriptRootLike): Iterable<QueryScriptLike> {
  return (root.querySelectorAll?.('script[fw-query]') ?? []) as Iterable<QueryScriptLike>;
}

export function createQueryScriptHydrationLedger(store: QueryStore): QueryScriptHydrationLedger {
  const seen = new Set<QueryScriptLike>();

  return {
    hydrate(
      scripts: Iterable<QueryScriptLike>,
      options: { onError?: RuntimeErrorReporter } = {},
    ): readonly string[] {
      const hydrated: string[] = [];

      for (const script of scripts) {
        if (seen.has(script)) continue;

        const applied = hydrateQueryScripts(store, [script], options);
        if (applied.length === 0) continue;

        seen.add(script);
        hydrated.push(...applied);
      }

      // SPEC.md §9.1/§9.4: browser hydration, mutation responses, and typed
      // refetches must converge on the same query-store apply path without
      // replaying already applied server-provided scripts. Malformed transient
      // script data is intentionally left observable for a later hydration pass.
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
