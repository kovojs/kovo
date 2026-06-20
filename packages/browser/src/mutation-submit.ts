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
  applyStreamingFetchedEnhancedMutationResponseToRuntime,
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
import type { ImportHandlerModule } from './handlers.js';

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
  importModule?: ImportHandlerModule;
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

/** @internal Handle a delegated form submit as an enhanced mutation, falling back to native submit (SPEC §9.2). */
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
        importModule: options.importModule,
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

/** @internal Report whether a delegated submit event targets an enhanced mutation form (SPEC §9.2). */
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

/** @internal Options for submitting a single enhanced mutation request (SPEC §9.1). */
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
  importModule?: ImportHandlerModule;
  islandSignalScope?: IslandSignalScope;
  morph?: MorphFragment;
  /**
   * Refetch-full handler for delta chunks with a missing/stale base (SPEC §9.1.1).
   * Defaults to a `/_q/<wireKey>` refetcher over the submit `fetch` when omitted.
   */
  onDeltaMiss?: OnDeltaMiss;
  /**
   * Full-navigation reload invoked when a delta-miss `/_q/` refetch returns a build token that still
   * differs from the document token — the document is fundamentally skewed (SPEC §14). Defaults to a
   * guarded `location.reload()`; injectable for tests.
   */
  onBuildSkew?: () => void;
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

/** @internal Submit an enhanced mutation and apply the response to the runtime (SPEC §9.1). */
export async function submitEnhancedMutation(
  options: EnhancedMutationSubmitOptions,
): Promise<EnhancedMutationAppliedResult> {
  stampEnhancedMutationPending(options, true);

  try {
    const fetched = await fetchEnhancedMutation({
      ...options,
      streaming: isStreamingEnhancedMutationForm(options.form),
    });
    // SPEC §9.1.1: default the build token (from the page meta) and the
    // refetch-full handler so the production submit path validates delta bases
    // and recovers on a miss/skew. Both stay injectable for tests.
    const expectedBuildToken = options.expectedBuildToken ?? readPageBuildToken();
    const onDeltaMiss = options.onDeltaMiss ?? defaultDeltaMissRefetcher(options);
    if (fetched.streamBody) {
      return applyStreamingFetchedEnhancedMutationResponseToRuntime(
        {
          ...options,
          ...definedProps({ expectedBuildToken, onDeltaMiss }),
        },
        { ...fetched, streamBody: fetched.streamBody },
      );
    }

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

export function isStreamingEnhancedMutationForm(form: EnhancedFormLike): boolean {
  const getAttribute = form.getAttribute?.bind(form);
  if (!getAttribute) return false;

  return (
    getAttribute('stream') !== null ||
    getAttribute('data-mutation-stream') !== null ||
    getAttribute('data-stream') !== null ||
    getAttribute('data-kovo-stream') !== null
  );
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
      // SPEC §5.2.1 rule 2d / §14: the refetch compares the /_q Kovo-Build token to the document
      // token; on a persistent mismatch it escalates to a full reload instead of merging foreign data.
      expectedBuildToken: options.expectedBuildToken ?? readPageBuildToken(),
      onBuildSkew: options.onBuildSkew ?? defaultBuildSkewReload,
      onError: options.onError,
      queryPlans: options.queryPlans,
      root: options.root,
    }),
  });
}

/** @internal Default §14 recovery: full-navigation reload of the current route on a persistent build skew. */
function defaultBuildSkewReload(): void {
  const location = (globalThis as { location?: { reload?: () => void } }).location;
  location?.reload?.();
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
