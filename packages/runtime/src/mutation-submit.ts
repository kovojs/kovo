import { definedProps } from './defined-props.js';
import type { DelegatedEvent } from './events.js';
import { reportRuntimeError, reportRuntimeTargetError } from './error-policy.js';
import { defaultIslandSignalScope } from './handler-context.js';
import type { IslandSignalScope } from './handler-context.js';
import type { MorphFragment, MorphRoot } from './morph.js';
import type { MutationBroadcast } from './broadcast.js';
import type { TargetCollectorRoot } from './mutation-targets.js';
import {
  fetchEnhancedMutation,
  type EnhancedFormLike,
  type EnhancedMutationFetch,
  type UploadProgress,
} from './mutation-fetch.js';
import {
  closestEnhancedMutationForm,
  fallbackEnhancedMutationSubmit,
  updateUploadProgressElements,
  type EnhancedFormElementLike,
} from './mutation-form.js';
import {
  applyFetchedEnhancedMutationResponseToRuntime,
  type EnhancedMutationAppliedResult,
} from './mutation-apply.js';
import { readPageBuildToken } from './build-token.js';
import { createDeltaMissRefetcher, type QueryRefetchFetch } from './query-refetch.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import type { OnDeltaMiss, QueryApplyInterposition } from './query-apply.js';
import type { QueryStore } from './query-store.js';
import { readDeps, stampPendingQueries } from './pending.js';
import type { PendingRoot } from './pending.js';

export type {
  EnhancedFormLike,
  EnhancedMutationFetch,
  EnhancedMutationFetchOptions,
  EnhancedMutationResponseLike,
  UploadProgress,
} from './mutation-fetch.js';
export type { EnhancedFormElementLike } from './mutation-form.js';

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface EnhancedMutationLoaderOptions {
  applyQuery?: QueryApplyInterposition;
  broadcast?: MutationBroadcast;
  fetch: EnhancedMutationFetch;
  formData?: (form: EnhancedFormElementLike, event: DelegatedEvent) => unknown;
  idem?: () => string;
  morph?: MorphFragment;
  /**
   * Handles enhanced form submit failures after preventDefault. When present,
   * the form layer owns the error and native submit fallback is skipped.
   *
   * SPEC.md section 9.2 keeps enhanced and no-JS form paths equivalent; this
   * hook is the enhanced path's reporting seam for failed fragment submissions.
   */
  onError?: (error: unknown, form: EnhancedFormElementLike) => void;
  onUploadProgress?: (progress: UploadProgress, form: EnhancedFormElementLike) => void;
  pendingRoot?: PendingRoot;
  queryPlans?: CompiledQueryUpdatePlans;
  root: MorphRoot & TargetCollectorRoot;
  store: QueryStore;
}

interface EnhancedFormSubmitHooks {
  onAppliedQueries?: (queries: readonly string[]) => void;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export async function dispatchEnhancedFormSubmit(
  event: DelegatedEvent,
  options: EnhancedMutationLoaderOptions | undefined,
  islandSignalScope: IslandSignalScope = defaultIslandSignalScope,
  hooks: EnhancedFormSubmitHooks = {},
): Promise<boolean> {
  if (!options || event.type !== 'submit') return false;

  const form = closestEnhancedMutationForm(event.target);
  if (!form) return false;

  event.preventDefault?.();
  try {
    const applied = await submitEnhancedMutation({
      fetch: options.fetch,
      form,
      formData: options.formData ? options.formData(form, event) : formDataForSubmit(form, event),
      ...(options.onError
        ? {
            onError(error) {
              reportRuntimeTargetError(options.onError, error, form);
            },
          }
        : {}),
      onUploadProgress: (progress) => {
        updateUploadProgressElements(form, progress);
        options.onUploadProgress?.(progress, form);
      },
      ...definedProps({
        applyQuery: options.applyQuery,
        broadcast: options.broadcast,
        idem: options.idem?.(),
        morph: options.morph,
        pendingQueries: options.pendingRoot ? readDeps(form.getAttribute('kovo-deps')) : undefined,
        pendingRoot: options.pendingRoot,
        queryPlans: options.queryPlans,
      }),
      root: options.root,
      store: options.store,
      islandSignalScope,
    });
    hooks.onAppliedQueries?.(applied.queries);
  } catch (error) {
    if (options.onError) return true;

    fallbackEnhancedMutationSubmit(form);
    throw error;
  }
  return true;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export function isEnhancedSubmitEvent(
  event: DelegatedEvent,
  options: EnhancedMutationLoaderOptions | undefined,
): boolean {
  if (!options || event.type !== 'submit') return false;

  return closestEnhancedMutationForm(event.target) !== null;
}

function formDataForSubmit(form: EnhancedFormElementLike, event: DelegatedEvent): FormData {
  if (event.submitter !== undefined) {
    try {
      return new FormData(form as HTMLFormElement, event.submitter as HTMLElement);
    } catch {
      // Older DOM implementations and test doubles may not support the submitter overload.
    }
  }
  return new FormData(form as HTMLFormElement);
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface EnhancedMutationSubmitOptions {
  applyQuery?: QueryApplyInterposition;
  broadcast?: MutationBroadcast;
  /**
   * The page-level build token (SPEC §9.1.1). Defaults to `readPageBuildToken()`
   * (`<meta name="kovo-build">`) when omitted; deltas apply only when it matches
   * the response's `Kovo-Build` token.
   */
  expectedBuildToken?: string;
  fetch: EnhancedMutationFetch;
  form: EnhancedFormLike;
  formData: unknown;
  idem?: string;
  islandSignalScope?: IslandSignalScope;
  morph?: MorphFragment;
  /**
   * Refetch-full handler for delta chunks with a missing/stale base (SPEC §9.1.1).
   * Defaults to a `/_q/<wireKey>` refetcher over the submit `fetch` when omitted.
   */
  onDeltaMiss?: OnDeltaMiss;
  /**
   * Reports mutation submit/apply failures. Direct submit callers still receive
   * the thrown error; dispatchEnhancedFormSubmit decides whether a form-layer
   * error has been handled.
   */
  onError?: (error: unknown) => void;
  onUploadProgress?: (progress: UploadProgress) => void;
  pendingQueries?: readonly string[];
  pendingRoot?: PendingRoot;
  queryPlans?: CompiledQueryUpdatePlans;
  root: MorphRoot & TargetCollectorRoot;
  store: QueryStore;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export async function submitEnhancedMutation(
  options: EnhancedMutationSubmitOptions,
): Promise<EnhancedMutationAppliedResult> {
  stampEnhancedMutationPending(options, true);

  try {
    const fetched = await fetchEnhancedMutation(options);
    // SPEC §9.1.1: default the build token (from the page meta) and the
    // refetch-full handler so the production submit path validates delta bases
    // and recovers on a miss/skew. Both stay injectable for tests.
    const expectedBuildToken = options.expectedBuildToken ?? readPageBuildToken();
    const onDeltaMiss = options.onDeltaMiss ?? defaultDeltaMissRefetcher(options);
    return applyFetchedEnhancedMutationResponseToRuntime(
      {
        ...options,
        ...definedProps({ expectedBuildToken, onDeltaMiss }),
      },
      fetched,
    );
  } catch (error) {
    reportRuntimeError(options.onError, error);
    throw error;
  } finally {
    stampEnhancedMutationPending(options, false);
  }
}

function defaultDeltaMissRefetcher(options: EnhancedMutationSubmitOptions): OnDeltaMiss {
  // SPEC §9.1.1: reuse the submit `fetch` for the /_q/<wireKey> GET so a stubbed
  // fetch in tests serves the refetch too, and production shares one transport.
  const refetchFetch: QueryRefetchFetch = (url, init) =>
    options.fetch(url, {
      body: null,
      headers: init.headers,
      keepalive: false,
      method: init.method,
    });

  return createDeltaMissRefetcher({
    fetch: refetchFetch,
    queryStore: options.store,
    ...definedProps({
      applyQuery: options.applyQuery,
      onError: options.onError,
      queryPlans: options.queryPlans,
      root: options.root,
    }),
  });
}

function stampEnhancedMutationPending(
  options: EnhancedMutationSubmitOptions,
  pending: boolean,
): string[] {
  if (!options.pendingRoot || !options.pendingQueries || options.pendingQueries.length === 0) {
    return [];
  }

  return stampPendingQueries(options.pendingRoot, options.pendingQueries, pending);
}
