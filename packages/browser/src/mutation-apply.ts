import {
  applyMutationResponseBodyToRuntime,
  applyStreamingMutationResponseBodyToRuntime,
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
import type { ImportHandlerModule } from './handlers.js';
import {
  captureSessionTransitionPrincipalRetirement,
  reloadSessionTransitionDocument,
  retireSessionTransitionRuntime,
} from './session-transition.js';

/** @internal Inputs for applying a fetched enhanced mutation response to the runtime (SPEC §9.1). */
export interface EnhancedMutationRuntimeApplyOptions {
  applyQuery?: QueryApplyInterposition;
  broadcast?: MutationBroadcast;
  /** The page-level build token (SPEC §9.1.1); deltas only apply when it matches the response's. */
  expectedBuildToken?: string;
  islandSignalScope?: IslandSignalScope;
  importModule?: ImportHandlerModule;
  morph?: MorphFragment;
  /** Whole-response build-skew recovery; defaults to a framework-pinned full reload. */
  onBuildSkew?: () => void;
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
  if (fetched.sessionTransition) return sessionTransitionResult(options, fetched);
  const recoverBuildSkew = captureBuildSkewRecovery(options);
  const buildSkew = isFetchedBuildSkew(options, fetched);

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
      onBuildSkew: recoverBuildSkew,
      onDeltaMiss: options.onDeltaMiss,
      onError: options.onError,
      queryPlans: options.queryPlans,
      responseBuildToken: fetched.buildToken,
    }),
    body: fetched.body,
    root: options.root,
    store: options.store,
  });
  if (!buildSkew) publishSuccessfulMutation(options, fetched);

  return {
    ...applied,
    changes: fetched.changes,
    idem: fetched.idem,
    targets: fetched.targets,
  };
}

/** @internal Apply a streaming fetched enhanced mutation response and broadcast only confirmed buffered bodies. */
export async function applyStreamingFetchedEnhancedMutationResponseToRuntime(
  options: EnhancedMutationRuntimeApplyOptions,
  fetched: FetchedEnhancedMutation & { streamBody: ReadableStream<Uint8Array> },
  hooks: MutationRuntimeApplyHooks = {},
): Promise<EnhancedMutationAppliedResult> {
  if (fetched.sessionTransition) return sessionTransitionResult(options, fetched);
  const recoverBuildSkew = captureBuildSkewRecovery(options);

  const applied = await applyStreamingMutationResponseBodyToRuntime({
    ...definedProps({
      applyQuery: hooks.applyQuery ?? options.applyQuery,
      beforeApplyQueries: hooks.beforeApplyQueries,
      expectedBuildToken: options.expectedBuildToken,
      importModule: options.importModule,
      islandSignalScope: options.islandSignalScope,
      morph: options.morph,
      onBuildSkew: recoverBuildSkew,
      onDeltaMiss: options.onDeltaMiss,
      onError: options.onError,
      queryPlans: options.queryPlans,
      responseBuildToken: fetched.buildToken,
    }),
    body: fetched.streamBody,
    root: options.root,
    store: options.store,
  });

  return {
    ...applied,
    changes: fetched.changes,
    idem: fetched.idem,
    targets: fetched.targets,
  };
}

function captureBuildSkewRecovery(options: EnhancedMutationRuntimeApplyOptions): () => void {
  // SPEC §6.6/§9.1.1/§14: a foreign-build response proves this realm stale. Capture the channel
  // retirement and recovery sink before any async stream work, then cut origin-wide authority
  // before requesting a full render. Navigation may be delayed or suppressed by the user agent.
  const retirePrincipal = captureSessionTransitionPrincipalRetirement(options);
  const recover = options.onBuildSkew ?? reloadSessionTransitionDocument;
  return () => {
    retirePrincipal();
    recover();
  };
}

function isFetchedBuildSkew(
  options: EnhancedMutationRuntimeApplyOptions,
  fetched: FetchedEnhancedMutation,
): boolean {
  return (
    options.expectedBuildToken !== undefined &&
    (fetched.buildToken === undefined || fetched.buildToken !== options.expectedBuildToken)
  );
}

/**
 * SPEC §9.3: a page-load principal cannot safely survive an in-place auth transition. Close the
 * origin-wide sync channel before touching response truth, then force a full server render whose
 * `<meta name="kovo-session">` installs the current principal. This deliberately handles
 * anonymous→auth, auth→anonymous, and principal A→B identically and fail-closed. A same-principal
 * rolling credential refresh also reloads conservatively while preserving the authenticated
 * session; it is never published under a stale fingerprint.
 */
function sessionTransitionResult(
  options: EnhancedMutationRuntimeApplyOptions,
  fetched: FetchedEnhancedMutation,
): EnhancedMutationAppliedResult {
  // Direct/internal callers may invoke the apply boundary without the normal submit orchestrator,
  // so this boundary still retires fail closed. The normal modular paths return the already-retired
  // result before calling apply, avoiding a structurally forgeable "already retired" flag.
  retireSessionTransitionRuntime(options);
  return retiredSessionTransitionResult(fetched);
}

/** @internal Build the discarded result after the submit orchestrator retired at header time. */
export function retiredSessionTransitionResult(
  fetched: FetchedEnhancedMutation,
): EnhancedMutationAppliedResult {
  return {
    appliedFragments: [],
    changes: [],
    fragments: [],
    idem: fetched.idem,
    queries: [],
    targets: fetched.targets,
  };
}

function publishSuccessfulMutation(
  options: EnhancedMutationRuntimeApplyOptions,
  fetched: FetchedEnhancedMutation,
): void {
  if (isFailedMutationResponse(fetched.response)) return;

  // SPEC §9.1.1/§14: the same response token that admitted direct server truth must travel to the
  // broadcast boundary. The channel refuses missing/mismatched proof instead of restamping bytes.
  options.broadcast?.publish(fetched.body, fetched.changes, fetched.buildToken);
}
