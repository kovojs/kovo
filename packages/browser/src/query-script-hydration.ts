import { definedProps } from './defined-props.js';
import type { RuntimeErrorReporter } from './error-policy.js';
import { applyQueryChunksToRuntime, type ApplyQueryChunksToRuntimeOptions } from './query-apply.js';
import type { QueryStore } from './query-store.js';
import { readQueryScriptChunk, readQueryScriptChunks } from './wire-parser.js';
import type { QueryChunk, QueryScriptChunkLike } from './wire-parser.js';
import {
  applySecurityIntrinsic,
  securityArrayAppend,
  securityGetOwnPropertyDescriptor,
  securityOwnArrayEntry,
  securitySet,
  securitySetAdd,
  securitySetHas,
} from './security-witness-intrinsics.js';

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
  const seen = securitySet<QueryScriptLike>();

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
      const appliedQueries = securitySet<QueryChunk>();
      const scriptSnapshot = snapshotHydrationScripts(scripts);

      for (let index = 0; index < scriptSnapshot.length; index += 1) {
        const scriptEntry = securityOwnArrayEntry(scriptSnapshot, index);
        if (!scriptEntry.ok) throw new TypeError('Kovo hydration script snapshot must be dense.');
        const script = scriptEntry.value;
        if (securitySetHas(seen, script)) continue;

        const query = readQueryScriptChunk(script, mergedOptions.onError);
        if (!query) continue;

        securityArrayAppend(records, { query, script }, 'Browser query hydration records');
      }

      // SPEC.md §9.1/§9.4: browser hydration, mutation responses, and typed
      // refetches must converge on the same query-store apply path without
      // replaying already applied server-provided scripts. Malformed transient
      // script data is intentionally left observable for a later hydration pass.
      const hydrated = applyQueryChunksToRuntime(store, queryChunksFromHydrationRecords(records), {
        ...definedProps({
          applyQuery: mergedOptions.applyQuery,
          onError: mergedOptions.onError,
          queryPlans: mergedOptions.queryPlans,
          root: mergedOptions.root,
        }),
        afterApplyQuery(query, value) {
          mergedOptions.afterApplyQuery?.(query, value);
          securitySetAdd(appliedQueries, query);
        },
      });
      for (let index = 0; index < records.length; index += 1) {
        const record = securityOwnArrayEntry(records, index);
        if (!record.ok) throw new TypeError('Kovo query hydration records must be dense.');
        if (securitySetHas(appliedQueries, record.value.query)) {
          securitySetAdd(seen, record.value.script);
        }
      }
      return hydrated;
    },
  };
}

const HydrationArray = Array;
const hydrationArrayIsArray = HydrationArray.isArray;
const MAX_HYDRATION_SCRIPTS = 100_000;

function snapshotHydrationScripts(scripts: Iterable<QueryScriptLike>): QueryScriptLike[] {
  const snapshot: QueryScriptLike[] = [];
  if (applySecurityIntrinsic<boolean>(hydrationArrayIsArray, HydrationArray, [scripts]) === true) {
    const length = securityGetOwnPropertyDescriptor(scripts, 'length');
    if (
      !length ||
      !('value' in length) ||
      typeof length.value !== 'number' ||
      length.value < 0 ||
      length.value % 1 !== 0 ||
      length.value > MAX_HYDRATION_SCRIPTS
    ) {
      throw new TypeError('Kovo hydration script collection is invalid or too large.');
    }
    for (let index = 0; index < length.value; index += 1) {
      const entry = securityOwnArrayEntry(scripts as readonly QueryScriptLike[], index);
      if (!entry.ok) throw new TypeError('Kovo hydration script collection must be dense.');
      securityArrayAppend(snapshot, entry.value, 'Browser query hydration script snapshot');
    }
    return snapshot;
  }
  for (const script of scripts) {
    if (snapshot.length >= MAX_HYDRATION_SCRIPTS) {
      throw new TypeError('Kovo hydration script collection is too large.');
    }
    securityArrayAppend(snapshot, script, 'Browser query hydration script snapshot');
  }
  return snapshot;
}

function queryChunksFromHydrationRecords(
  records: readonly { query: QueryChunk; script: QueryScriptLike }[],
): QueryChunk[] {
  const chunks: QueryChunk[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = securityOwnArrayEntry(records, index);
    if (!record.ok) throw new TypeError('Kovo query hydration records must be dense.');
    securityArrayAppend(chunks, record.value.query, 'Browser query hydration chunks');
  }
  return chunks;
}
