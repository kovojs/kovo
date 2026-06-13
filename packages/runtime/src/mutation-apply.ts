import {
  applyMutationResponseToDom,
  type AppliedMutationResponse,
  type AppliedMutationResponseToDom,
  type ApplyMutationResponseToDomOptions,
} from './apply-mutation-response.js';
import { definedProps } from './defined-props.js';
import type { IslandSignalScope } from './handler-context.js';
import type { MorphFragment, MorphRoot } from './morph.js';
import type { MutationBroadcast } from './broadcast.js';
import { isFailedMutationResponse, type FetchedEnhancedMutation } from './mutation-fetch.js';
import type { MutationChangeRecord } from './optimism.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import type { QueryStore } from './query-store.js';

export interface EnhancedMutationDomApplyOptions {
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

export function applyEnhancedMutationResponseBodyToDom(
  options: EnhancedMutationDomApplyOptions,
  body: string,
  hooks: MutationDomApplyHooks = {},
): AppliedMutationResponseToDom {
  return applyMutationResponseToDom({
    body,
    ...definedProps({
      applyQuery: hooks.applyQuery,
      beforeApplyQueries: hooks.beforeApplyQueries,
      islandSignalScope: options.islandSignalScope,
      morph: options.morph,
      onError: options.onError,
      queryPlans: options.queryPlans,
    }),
    root: options.root,
    store: options.store,
  });
}

export function applyFetchedEnhancedMutationResponseToDom(
  options: EnhancedMutationDomApplyOptions,
  fetched: FetchedEnhancedMutation,
  hooks: MutationDomApplyHooks = {},
): EnhancedMutationAppliedResult {
  // SPEC.md §9.1/§9.2: enhanced submit, validation failure fragments, and
  // same-user broadcast all share the mutation response body application path.
  const applied = applyEnhancedMutationResponseBodyToDom(options, fetched.body, hooks);
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
