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
  applyFetchedEnhancedMutationResponseToDom,
  type EnhancedMutationAppliedResult,
} from './mutation-apply.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
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

export interface EnhancedMutationLoaderOptions {
  broadcast?: MutationBroadcast;
  fetch: EnhancedMutationFetch;
  formData?: (form: EnhancedFormElementLike) => unknown;
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
      formData: options.formData ? options.formData(form) : new FormData(form as HTMLFormElement),
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
        broadcast: options.broadcast,
        idem: options.idem?.(),
        morph: options.morph,
        pendingQueries: options.pendingRoot ? readDeps(form.getAttribute('fw-deps')) : undefined,
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

export function isEnhancedSubmitEvent(
  event: DelegatedEvent,
  options: EnhancedMutationLoaderOptions | undefined,
): boolean {
  if (!options || event.type !== 'submit') return false;

  return closestEnhancedMutationForm(event.target) !== null;
}

export interface EnhancedMutationSubmitOptions {
  broadcast?: MutationBroadcast;
  fetch: EnhancedMutationFetch;
  form: EnhancedFormLike;
  formData: unknown;
  idem?: string;
  islandSignalScope?: IslandSignalScope;
  morph?: MorphFragment;
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

export async function submitEnhancedMutation(
  options: EnhancedMutationSubmitOptions,
): Promise<EnhancedMutationAppliedResult> {
  stampEnhancedMutationPending(options, true);

  try {
    const fetched = await fetchEnhancedMutation(options);
    return applyFetchedEnhancedMutationResponseToDom(options, fetched);
  } catch (error) {
    reportRuntimeError(options.onError, error);
    throw error;
  } finally {
    stampEnhancedMutationPending(options, false);
  }
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
