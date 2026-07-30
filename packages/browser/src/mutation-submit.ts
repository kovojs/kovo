import type { FrameworkTargetRequestHeaderPlan } from '@kovojs/core/internal/wire-input-grammar';

import {
  loadCompiledOptimisticSubmission,
  type CompiledOptimisticSubmission,
} from './compiled-optimism.js';
import { definedProps } from './defined-props.js';
import type { DelegatedEvent } from './events.js';
import { reportRuntimeError, reportRuntimeTargetError } from './error-policy.js';
import { defaultIslandSignalScope } from './handler-context.js';
import type { IslandSignalScope } from './handler-context.js';
import type { MorphFragment, MorphRoot } from './morph.js';
import type { MutationBroadcast } from './broadcast.js';
import type { TargetCollectorRoot } from './mutation-targets.js';
import {
  createEnhancedMutationIdem,
  fetchEnhancedMutation,
  prepareEnhancedMutationRequest,
  type EnhancedFormLike,
  type EnhancedMutationFetch,
  type FetchEnhancedMutationOptions,
  type UploadProgress,
} from './mutation-fetch.js';
import {
  closestEnhancedMutationForm,
  consumeEnhancedMutationNativeFallback,
  hasTypedMutationIdentity,
  isEnhancedMutationNativeFallback,
  markInvalidTypedMutationTransport,
  readEligibleEnhancedMutationTransport,
  recoverEnhancedMutationDocument,
  updateUploadProgressElements,
  isStreamingEnhancedMutationForm,
  type EnhancedFormElementLike,
  type EnhancedMutationTransport,
} from './mutation-form.js';
import {
  applyStreamingFetchedEnhancedMutationResponseToRuntime,
  applyFetchedEnhancedMutationResponseToRuntime,
  retiredSessionTransitionResult,
  type EnhancedMutationAppliedResult,
} from './mutation-apply.js';
import { readPageBuildToken } from './build-token.js';
import { createDeltaMissRefetcher, type QueryRefetchFetch } from './query-refetch.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import type { OnDeltaMiss, QueryApplyInterposition } from './query-apply.js';
import type { QueryIdentity, QueryStore } from './query-store.js';
import { readDeps, stampPendingQueries } from './pending.js';
import type { PendingQuerySelector, PendingRoot } from './pending.js';
import type { ImportHandlerModule } from './handlers.js';
import { submitOptimisticEnhancedMutation } from './mutation-optimistic.js';
import type { MutationQueue } from './mutation-queue.js';
import type { OptimisticRebaser } from './optimism.js';
import {
  captureSessionTransitionPrincipalRetirement,
  reloadSessionTransitionDocument,
} from './session-transition.js';
import {
  createRuntimeFormData,
  preventRuntimeDelegatedEventDefault,
  snapshotRuntimeDelegatedEvent,
} from './runtime-dom-security.js';

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
  /** Construction-time page build proof used for response apply and broadcast parity. */
  expectedBuildToken?: string;
  fetch: EnhancedMutationFetch;
  formData?: (form: EnhancedFormElementLike, event: DelegatedEvent) => unknown;
  importModule?: ImportHandlerModule;
  morph?: MorphFragment;
  /**
   * Handles enhanced form submit failures after preventDefault. Server-truth document recovery
   * still runs because the framework cannot know whether the POST reached the server.
   *
   * SPEC.md section 9.2 keeps enhanced and no-JS form paths equivalent; this
   * hook is the enhanced path's reporting seam for failed fragment submissions.
   */
  onError?: (error: unknown, form: EnhancedFormElementLike) => void;
  /** @internal Dispose document-scoped client state before mandatory transition recovery. */
  onSessionTransition?: () => void;
  onUploadProgress?: (progress: UploadProgress, form: EnhancedFormElementLike) => void;
  optimisticQueue?: MutationQueue;
  optimisticRebaser?: OptimisticRebaser;
  pendingRoot?: PendingRoot;
  queryPlans?: CompiledQueryUpdatePlans;
  root: MorphRoot & TargetCollectorRoot;
  store: QueryStore;
}

interface EnhancedFormSubmitHooks {
  onAppliedQueries?: (queries: readonly QueryIdentity[]) => void;
}

/** @internal Handle a delegated form submit as an enhanced mutation (SPEC §§9.1-9.2). */
export async function dispatchEnhancedFormSubmit(
  event: DelegatedEvent,
  options: EnhancedMutationLoaderOptions | undefined,
  islandSignalScope: IslandSignalScope = defaultIslandSignalScope,
  hooks: EnhancedFormSubmitHooks = {},
): Promise<boolean> {
  if (!options) return false;
  const eventFacts = snapshotRuntimeDelegatedEvent(event);
  if (!eventFacts || eventFacts.type !== 'submit') return false;

  const form = closestEnhancedMutationForm(eventFacts.target);
  if (!form) return false;
  // requestSubmit() synchronously emits one browser-owned fallback event. Treat it as consumed so
  // neither enhanced transport nor an authored delegated submit handler can re-enter it.
  if (consumeEnhancedMutationNativeFallback(form)) return true;
  const transport = readEligibleEnhancedMutationTransport(form, eventFacts.submitter);
  if (!transport) {
    if (!hasTypedMutationIdentity(form)) return false;
    // SPEC §§6.3/9.1: data-mutation owns a fixed POST /_m/<key> transport. A mismatched
    // submitter/action is DOM tampering, not an ordinary native-form fallback: allowing the
    // browser to continue could serialize CSRF/idempotency authority into a GET URL.
    if (!preventRuntimeDelegatedEventDefault(event)) return false;
    markInvalidTypedMutationTransport(form);
    return true;
  }

  // The server chooses an enhanced decoder from the immutable page build. If boot did not pin
  // that proof, leave this form on its rendered native path before constructing FormData, minting
  // an idem, or suppressing the submit event (SPEC §9.1/§14).
  const expectedBuildToken = options.expectedBuildToken ?? readPageBuildToken();
  if (!expectedBuildToken) return false;

  // Construct fallible request authority before suppressing the browser's native path. If this
  // preparation fails, the submit event remains unprevented and retains the rendered no-JS token.
  const formData = options.formData
    ? options.formData(form, event)
    : formDataForSubmit(form, eventFacts.submitter);
  const idem = createEnhancedMutationIdem(formData, true);
  const streaming = isStreamingEnhancedMutationForm(form);
  let requestPlan: FrameworkTargetRequestHeaderPlan | undefined;
  try {
    requestPlan = prepareEnhancedMutationRequest({
      buildToken: expectedBuildToken,
      form,
      idem,
      root: options.root,
      streaming,
      transport,
    });
  } catch {
    return false;
  }
  if (requestPlan === undefined) return false;
  if (!preventRuntimeDelegatedEventDefault(event)) return false;
  try {
    const submitOptions: EnhancedMutationSubmitOptions = {
      expectedBuildToken,
      fetch: options.fetch,
      form,
      formData,
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
        idem,
        importModule: options.importModule,
        morph: options.morph,
        onSessionTransition: options.onSessionTransition,
        pendingQueries: options.pendingRoot ? readDeps(form.getAttribute('kovo-deps')) : undefined,
        pendingRoot: options.pendingRoot,
        queryPlans: options.queryPlans,
        requestPlan,
        streaming,
      }),
      root: options.root,
      store: options.store,
      islandSignalScope,
      transport,
    };
    let compiledOptimism: CompiledOptimisticSubmission | undefined;
    if (transport.optimisticModule !== undefined) {
      try {
        if (!options.importModule || !options.optimisticRebaser || !transport.mutation) {
          throw new TypeError(
            'Kovo optimistic mutation form requires the generated loader optimism runtime.',
          );
        }
        compiledOptimism = await loadCompiledOptimisticSubmission({
          formData,
          importModule: options.importModule,
          moduleHref: transport.optimisticModule,
          mutation: transport.mutation,
        });
      } catch (error) {
        reportRuntimeTargetError(options.onError, error, form);
      }
    }
    const applied =
      compiledOptimism === undefined || options.optimisticRebaser === undefined
        ? await submitEnhancedMutation(submitOptions)
        : await submitOptimisticEnhancedMutation({
            ...submitOptions,
            input: compiledOptimism.input,
            optimistic: compiledOptimism.optimistic,
            ...definedProps({
              queue: options.optimisticQueue,
            }),
            rebaser: options.optimisticRebaser,
          });
    hooks.onAppliedQueries?.(applied.queries);
  } catch (error) {
    // The request may have committed before a network, response-proof, media-type, or apply
    // failure became observable. Never turn that ambiguity into a second POST with a new idem.
    recoverEnhancedMutationDocument(form, transport);
    if (options.onError) return true;
    throw error;
  }
  return true;
}

/** @internal Report whether a delegated submit event targets an enhanced mutation form (SPEC §9.2). */
export function isEnhancedSubmitEvent(
  event: DelegatedEvent,
  options: EnhancedMutationLoaderOptions | undefined,
): boolean {
  if (!options) return false;
  const eventFacts = snapshotRuntimeDelegatedEvent(event);
  if (!eventFacts || eventFacts.type !== 'submit') return false;

  const form = closestEnhancedMutationForm(eventFacts.target);
  // Classification must not consume the marker before dispatch sees the same synchronous event.
  if (form === null || isEnhancedMutationNativeFallback(form)) return false;
  return (
    hasTypedMutationIdentity(form) ||
    readEligibleEnhancedMutationTransport(form, eventFacts.submitter) !== undefined
  );
}

function formDataForSubmit(form: EnhancedFormElementLike, submitter: unknown): FormData {
  if (submitter !== undefined) {
    try {
      return createRuntimeFormData(form, submitter);
    } catch {
      // Older DOM implementations and test doubles may not support the submitter overload.
    }
  }
  return createRuntimeFormData(form);
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
  expectedBuildToken: string;
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
  /** @internal Framework-owned observation of already-membraned response facts. */
  onResponseSnapshot?: FetchEnhancedMutationOptions['onResponseSnapshot'];
  /** @internal Dispose document-scoped client state before mandatory transition recovery. */
  onSessionTransition?: () => void;
  onUploadProgress?: (progress: UploadProgress) => void;
  pendingQueries?: readonly PendingQuerySelector[];
  pendingRoot?: PendingRoot;
  queryPlans?: CompiledQueryUpdatePlans;
  /** @internal Module-minted request plan prepared before delegated preventDefault. */
  requestPlan?: FrameworkTargetRequestHeaderPlan;
  root: MorphRoot & TargetCollectorRoot;
  store: QueryStore;
  /** @internal Stream posture pinned by delegated preflight; direct callers derive it from `form`. */
  streaming?: boolean;
  /** Effective submitter transport snapshotted before preventDefault (SPEC §§6.3, 7, 9.1). */
  transport?: EnhancedMutationTransport;
}

/** @internal Submit an enhanced mutation and apply the response to the runtime (SPEC §9.1). */
export async function submitEnhancedMutation(
  options: EnhancedMutationSubmitOptions,
): Promise<EnhancedMutationAppliedResult> {
  options = definedProps(options) as EnhancedMutationSubmitOptions;
  const expectedBuildToken = options.expectedBuildToken;
  if (!expectedBuildToken) {
    (options.onBuildSkew ?? defaultBuildSkewReload)();
    throw new TypeError('Kovo refused an enhanced mutation without a document build proof.');
  }
  const streaming = options.streaming ?? isStreamingEnhancedMutationForm(options.form);
  options = { ...options, expectedBuildToken, streaming };
  const retirePrincipal = captureSessionTransitionPrincipalRetirement(options);
  const retireTransitionRuntime = (): void => {
    retirePrincipal();
    options.onSessionTransition?.();
  };
  stampEnhancedMutationPending(options, true);

  try {
    const fetched = await fetchEnhancedMutation({
      ...options,
      onSessionTransition: retireTransitionRuntime,
      onSessionTransitionReload: reloadSessionTransitionDocument,
      streaming,
    });
    if (fetched.sessionTransition) return retiredSessionTransitionResult(fetched);
    // SPEC §9.1.1: the build proof was captured before transport. Default the refetch-full handler
    // so the production submit path validates delta bases and recovers on a miss/skew.
    const onDeltaMiss = options.onDeltaMiss ?? defaultDeltaMissRefetcher(options);
    const onBuildSkew = options.onBuildSkew ?? defaultBuildSkewReload;
    if (fetched.streamBody) {
      return applyStreamingFetchedEnhancedMutationResponseToRuntime(
        {
          ...options,
          ...definedProps({ expectedBuildToken, onBuildSkew, onDeltaMiss }),
        },
        { ...fetched, streamBody: fetched.streamBody },
      );
    }

    return applyFetchedEnhancedMutationResponseToRuntime(
      {
        ...options,
        ...definedProps({ expectedBuildToken, onBuildSkew, onDeltaMiss }),
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
      redirect: 'error',
      referrerPolicy: 'origin',
    });

  return createDeltaMissRefetcher({
    fetch: refetchFetch,
    queryStore: options.store,
    ...definedProps({
      applyQuery: options.applyQuery,
      // SPEC §5.2.1 rule 2d / §14: the refetch compares the /_q Kovo-Build token to the document
      // token; on a persistent mismatch it escalates to a full reload instead of merging foreign data.
      expectedBuildToken: options.expectedBuildToken,
      onBuildSkew: options.onBuildSkew ?? defaultBuildSkewReload,
      onError: options.onError,
      queryPlans: options.queryPlans,
      root: options.root,
    }),
  });
}

/** @internal Default §14 recovery: full-navigation reload of the current route on a persistent build skew. */
function defaultBuildSkewReload(): void {
  // SPEC §6.6/§14: build-skew recovery is mandatory framework authority. Use the same
  // construction-time pinned reload as session transitions so authored code cannot suppress the
  // full-render recovery by replacing Location.reload after the loader initializes.
  reloadSessionTransitionDocument();
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
