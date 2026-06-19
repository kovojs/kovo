import { definedProps } from './defined-props.js';
import type { RuntimeErrorReporter } from './error-policy.js';
import { applyQueryChunksToRuntime, type ApplyQueryChunksToRuntimeOptions } from './query-apply.js';
import type { QueryStore } from './query-store.js';
import { readQueryScriptChunk, readQueryScriptChunks } from './wire-parser.js';
import type { QueryChunk, QueryScriptChunkLike } from './wire-parser.js';

/**
 * An inline `<kovo-query>` script element the loader hydrates the query store
 * from on first paint (SPEC §9.4): exposes `getAttribute` and `textContent`.
 */
export interface QueryScriptLike extends QueryScriptChunkLike {}

export interface QueryScriptHydrationLedger {
  hydrate(
    scripts: Iterable<QueryScriptLike>,
    options?: QueryScriptHydrationOptions,
  ): readonly string[];
}

export interface QueryScriptHydrationOptions extends ApplyQueryChunksToRuntimeOptions {
  onError?: RuntimeErrorReporter;
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
      onError: options.onError,
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
          onError: options.onError,
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
      const appliedQueries = new Set<QueryChunk>();

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
            applyQuery: mergedOptions.applyQuery,
            onError: mergedOptions.onError,
            queryPlans: mergedOptions.queryPlans,
            root: mergedOptions.root,
          }),
          afterApplyQuery(query, value) {
            mergedOptions.afterApplyQuery?.(query, value);
            appliedQueries.add(query);
          },
        },
      );
      for (const record of records) {
        if (appliedQueries.has(record.query)) {
          seen.add(record.script);
        }
      }
      return hydrated;
    },
  };
}
