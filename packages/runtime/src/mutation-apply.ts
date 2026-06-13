import {
  applyMutationResponseChunksToRuntime,
  type AppliedMutationResponse,
} from './apply-mutation-response.js';
import { definedProps } from './defined-props.js';
import type { IslandSignalScope } from './handler-context.js';
import type { MorphFragment, MorphRoot } from './morph.js';
import type { MutationBroadcast } from './broadcast.js';
import { isFailedMutationResponse, type FetchedEnhancedMutation } from './mutation-fetch.js';
import type { ApplyMutationResponseToDomOptions } from './mutation-response-dom.js';
import type { MutationChangeRecord } from './optimism.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import type { QueryApplyInterposition } from './query-apply.js';
import type { QueryStore } from './query-store.js';
import { readMutationResponseBodyChunks } from './wire-parser.js';

export interface EnhancedMutationDomApplyOptions {
  applyQuery?: QueryApplyInterposition;
  broadcast?: MutationBroadcast;
  islandSignalScope?: IslandSignalScope;
  morph?: MorphFragment;
  onError?: (error: unknown) => void;
  queryPlans?: CompiledQueryUpdatePlans;
  root: MorphRoot;
  store: QueryStore;
}

export type EnhancedMutationAppliedResult = AppliedMutationResponse & {
  appliedFragments: string[];
  changes: MutationChangeRecord[];
  idem: string;
  targets: string[];
};

export type MutationDomApplyHooks = Pick<
  ApplyMutationResponseToDomOptions,
  'applyQuery' | 'beforeApplyQueries'
>;

export function applyFetchedEnhancedMutationResponseToDom(
  options: EnhancedMutationDomApplyOptions,
  fetched: FetchedEnhancedMutation,
  hooks: MutationDomApplyHooks = {},
): EnhancedMutationAppliedResult {
  // SPEC.md §9.1/§9.2: enhanced submit, validation failure fragments, and
  // same-user broadcast all parse mutation bodies before entering the canonical
  // decoded chunk apply path.
  const applied = applyMutationResponseChunksToRuntime(
    readMutationResponseBodyChunks(fetched.body, options.onError),
    {
      ...definedProps({
        applyQuery: hooks.applyQuery ?? options.applyQuery,
        beforeApplyQueries: hooks.beforeApplyQueries,
        islandSignalScope: options.islandSignalScope,
        morph: options.morph,
        onError: options.onError,
        queryPlans: options.queryPlans,
      }),
      root: options.root,
      store: options.store,
    },
  );
  publishSuccessfulMutation(options, fetched);

  return {
    ...applied,
    changes: fetched.changes,
    idem: fetched.idem,
    targets: fetched.targets,
  };
}

function publishSuccessfulMutation(
  options: EnhancedMutationDomApplyOptions,
  fetched: FetchedEnhancedMutation,
): void {
  if (isFailedMutationResponse(fetched.response)) return;

  options.broadcast?.publish(fetched.body, fetched.changes);
}
