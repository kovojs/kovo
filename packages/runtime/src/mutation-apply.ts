import {
  applyMutationResponseBodyToRuntime,
  type AppliedMutationResponse,
} from './apply-mutation-response.js';
import { definedProps } from './defined-props.js';
import type { IslandSignalScope } from './handler-context.js';
import type { MorphFragment, MorphRoot } from './morph.js';
import type { MutationBroadcast } from './broadcast.js';
import { isFailedMutationResponse, type FetchedEnhancedMutation } from './mutation-fetch.js';
import type { MutationChangeRecord } from './optimism.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import type { OnDeltaMiss, QueryApplyInterposition } from './query-apply.js';
import type { QueryStore } from './query-store.js';
import type { QueryChunk } from './wire-parser.js';

/** @internal Inputs for applying a fetched enhanced mutation response to the runtime (SPEC §9.1). */
export interface EnhancedMutationRuntimeApplyOptions {
  applyQuery?: QueryApplyInterposition;
  broadcast?: MutationBroadcast;
  /** The page-level build token (SPEC §9.1.1); deltas only apply when it matches the response's. */
  expectedBuildToken?: string;
  islandSignalScope?: IslandSignalScope;
  morph?: MorphFragment;
  /** Refetch-full handler invoked for delta chunks with a missing/stale base (SPEC §9.1.1). */
  onDeltaMiss?: OnDeltaMiss;
  onError?: (error: unknown) => void;
  queryPlans?: CompiledQueryUpdatePlans;
  root: MorphRoot;
  store: QueryStore;
}

/** @internal Result of applying an enhanced mutation response: applied fragments, changes, idem, targets (SPEC §9.1). */
export type EnhancedMutationAppliedResult = AppliedMutationResponse & {
  appliedFragments: string[];
  changes: MutationChangeRecord[];
  idem: string;
  targets: string[];
};

/** @internal Optional apply-time hooks for interposing on query application (SPEC §9.1). */
export interface MutationRuntimeApplyHooks {
  applyQuery?: QueryApplyInterposition;
  beforeApplyQueries?: (queries: readonly QueryChunk[]) => void;
}

/** @internal Apply a fetched enhanced mutation response and broadcast success (SPEC §9.1/§9.2). */
export function applyFetchedEnhancedMutationResponseToRuntime(
  options: EnhancedMutationRuntimeApplyOptions,
  fetched: FetchedEnhancedMutation,
  hooks: MutationRuntimeApplyHooks = {},
): EnhancedMutationAppliedResult {
  // SPEC.md §9.1/§9.2: enhanced submit, validation failure fragments, and
  // same-user broadcast all parse mutation bodies before entering the canonical
  // decoded chunk apply path.
  const applied = applyMutationResponseBodyToRuntime({
    ...definedProps({
      applyQuery: hooks.applyQuery ?? options.applyQuery,
      beforeApplyQueries: hooks.beforeApplyQueries,
      // SPEC §9.1.1: thread the build tokens + refetch handler so production
      // submits validate delta bases and refetch full on a miss/skew, instead of
      // silently dropping the update.
      expectedBuildToken: options.expectedBuildToken,
      islandSignalScope: options.islandSignalScope,
      morph: options.morph,
      onDeltaMiss: options.onDeltaMiss,
      onError: options.onError,
      queryPlans: options.queryPlans,
      responseBuildToken: fetched.buildToken,
    }),
    body: fetched.body,
    root: options.root,
    store: options.store,
  });
  publishSuccessfulMutation(options, fetched);

  return {
    ...applied,
    changes: fetched.changes,
    idem: fetched.idem,
    targets: fetched.targets,
  };
}

function publishSuccessfulMutation(
  options: EnhancedMutationRuntimeApplyOptions,
  fetched: FetchedEnhancedMutation,
): void {
  if (isFailedMutationResponse(fetched.response)) return;

  options.broadcast?.publish(fetched.body, fetched.changes);
}
