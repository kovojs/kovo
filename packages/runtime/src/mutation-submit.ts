import type { Form, FormFailure, FormInput, JsonValue } from '@jiso/core';

import { applyMutationResponseToDom } from './apply-path.js';
import type {
  AppliedMutationResponse,
  AppliedMutationResponseToDom,
  ApplyMutationResponseToDomOptions,
} from './apply-path.js';
import { definedProps } from './defined-props.js';
import type { DelegatedEvent, EventElementLike } from './events.js';
import { reportRuntimeError, reportRuntimeTargetError } from './error-policy.js';
import type { IslandSignalScope } from './handlers.js';
import { defaultIslandSignalScope } from './handlers.js';
import type { MorphFragment, MorphRoot } from './morph.js';
import { MutationQueue } from './mutation-queue.js';
import type { MutationBroadcast } from './broadcast.js';
import { createMutationIdem, readMutationChangeHeader } from './mutation-response.js';
import { readLiveTargets, serializeLiveTargetEntries } from './mutation-targets.js';
import type { TargetCollectorRoot } from './mutation-targets.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import { queryStoreKey } from './query-store.js';
import type { QueryStore } from './query-store.js';
import { optimisticChangeFromInput, OptimisticRebaser, resolveOptimisticKeys } from './optimism.js';
import type { MutationChangeRecord, OptimisticChange, OptimisticPlan } from './optimism.js';
import { readDeps, stampPendingQueries } from './pending.js';
import type { PendingRoot } from './pending.js';
import { parseMutationFailure } from './mutation-failure.js';
import type { QueryChunk } from './wire-parser.js';

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

export interface EnhancedFormElementLike extends EventElementLike, EnhancedFormLike {
  submit?: () => void;
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

  const form = event.target?.closest?.('form[enhance],form[data-enhance],form[data-mutation]') as
    | EnhancedFormElementLike
    | null
    | undefined;
  if (!form || !isEnhancedForm(form)) return false;

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

  const form = event.target?.closest?.('form[enhance],form[data-enhance],form[data-mutation]') as
    | EventElementLike
    | null
    | undefined;
  return !!form && isEnhancedForm(form);
}

function fallbackEnhancedMutationSubmit(form: EnhancedFormElementLike): void {
  if (typeof form.submit === 'function') {
    form.submit();
    return;
  }

  form.setAttribute?.('data-error-code', 'NETWORK_ERROR');
  form.setAttribute?.('fw-error', '');
}

function isEnhancedForm(form: EventElementLike): boolean {
  return (
    form.getAttribute('enhance') !== null ||
    form.getAttribute('data-enhance') !== null ||
    form.getAttribute('data-mutation') !== null
  );
}

function updateUploadProgressElements(form: EventElementLike, progress: UploadProgress): void {
  const progressElements = form.querySelectorAll?.('[fw-upload-progress]') ?? [];
  const total = progress.total;
  const value =
    total !== undefined && total > 0
      ? Math.min(100, Math.round((progress.loaded / total) * 100))
      : undefined;

  for (const element of progressElements) {
    element.setAttribute('max', '100');
    if (value === undefined) {
      element.removeAttribute?.('value');
      continue;
    }
    element.setAttribute('value', String(value));
  }
}

export interface EnhancedFormLike {
  action: string;
  method?: string;
}

export interface EnhancedMutationFetchOptions {
  body: unknown;
  headers: Record<string, string>;
  keepalive: boolean;
  method: string;
  onUploadProgress?: (progress: UploadProgress) => void;
}

export interface UploadProgress {
  loaded: number;
  total?: number;
}

export interface EnhancedMutationResponseLike {
  headers?: {
    get(name: string): string | null;
  };
  ok?: boolean;
  status?: number;
  text(): Promise<string>;
}

export type EnhancedMutationFetch = (
  url: string,
  options: EnhancedMutationFetchOptions,
) => Promise<EnhancedMutationResponseLike>;

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

export interface OptimisticEnhancedMutationSubmitOptions<
  Input,
> extends EnhancedMutationSubmitOptions {
  change?: OptimisticChange<Input>;
  input: Input;
  optimistic: OptimisticPlan<Input>;
  pendingRoot?: PendingRoot;
  queue?: MutationQueue;
  rebaser: OptimisticRebaser;
}

type EnhancedMutationAppliedResult = AppliedMutationResponse & {
  appliedFragments: string[];
  changes: MutationChangeRecord[];
  idem: string;
  targets: string[];
};

export type SubmitFormDefinition = Form<string, Record<string, JsonValue>, JsonValue>;

export interface SubmitOptions<Input extends Record<string, JsonValue>, Failure> {
  action?: string;
  idem?: string;
  input: Input;
  method?: string;
  onError?: (failure: Failure) => void | Promise<void>;
  parseError?: (body: string) => Failure;
}

export interface SubmitContextOptions {
  actionFor?: (form: SubmitFormDefinition) => string;
  broadcast?: MutationBroadcast;
  fetch: EnhancedMutationFetch;
  method?: string;
  morph?: MorphFragment;
  queryPlans?: CompiledQueryUpdatePlans;
  root: MorphRoot & TargetCollectorRoot;
  store: QueryStore;
}

export interface SubmitContext {
  submit<Definition extends SubmitFormDefinition>(
    form: Definition,
    options: SubmitOptions<FormInput<Definition>, FormFailure<Definition>>,
  ): Promise<
    AppliedMutationResponse & { appliedFragments: string[]; idem: string; targets: string[] }
  >;
}

export function createSubmitContext(options: SubmitContextOptions): SubmitContext {
  return {
    async submit(form, submitOptions) {
      let body = '';
      let ok: boolean | undefined;
      let status: number | undefined;
      const response = await submitEnhancedMutation({
        fetch: async (url, fetchOptions) => {
          const result = await options.fetch(url, fetchOptions);
          ok = result.ok;
          status = result.status;

          return {
            ...result,
            async text() {
              body = await result.text();
              return body;
            },
          };
        },
        form: createEnhancedFormLike(
          submitOptions.action ?? options.actionFor?.(form) ?? `/_m/${form.key}`,
          submitOptions.method ?? options.method,
        ),
        formData: formDataFromInput(submitOptions.input),
        ...definedProps({
          broadcast: options.broadcast,
          idem: submitOptions.idem,
          morph: options.morph,
          queryPlans: options.queryPlans,
        }),
        root: options.root,
        store: options.store,
      });

      if (submitOptions.onError && isValidationFailure(status, ok)) {
        const parseError =
          submitOptions.parseError ??
          ((value: string) => parseMutationFailure(value) as FormFailure<typeof form>);
        await submitOptions.onError(parseError(body));
      }

      return response;
    },
  };
}

function createEnhancedFormLike(action: string, method: string | undefined): EnhancedFormLike {
  return {
    action,
    ...(method ? { method } : {}),
  };
}

function formDataFromInput(input: Record<string, JsonValue>): FormData {
  const data = new FormData();

  for (const [name, value] of Object.entries(input)) {
    appendFormValue(data, name, value);
  }

  return data;
}

function appendFormValue(data: FormData, name: string, value: JsonValue): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      appendFormValue(data, name, item);
    }
    return;
  }

  if (value === null) {
    data.append(name, '');
    return;
  }

  data.append(name, typeof value === 'object' ? JSON.stringify(value) : String(value));
}

function isValidationFailure(status: number | undefined, ok: boolean | undefined): boolean {
  return status === 422 || ok === false;
}

type MutationDomApplyHooks = Pick<
  ApplyMutationResponseToDomOptions,
  'applyQuery' | 'beforeApplyQueries'
>;

function applyEnhancedMutationResponseBodyToDom(
  options: EnhancedMutationSubmitOptions,
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

export async function submitOptimisticEnhancedMutation<Input>(
  options: OptimisticEnhancedMutationSubmitOptions<Input>,
): Promise<
  AppliedMutationResponse & {
    appliedFragments: string[];
    changes: MutationChangeRecord[];
    idem: string;
    targets: string[];
  }
> {
  if (options.queue) {
    // SPEC.md §10.4: mutations that declare a named queue run as named FIFO.
    return options.queue.run(options.optimistic.queue, () =>
      submitOptimisticEnhancedMutationDirect(options),
    );
  }

  return submitOptimisticEnhancedMutationDirect(options);
}

async function submitOptimisticEnhancedMutationDirect<Input>(
  options: OptimisticEnhancedMutationSubmitOptions<Input>,
): Promise<EnhancedMutationAppliedResult> {
  const idem = options.idem ?? createMutationIdem();
  const queryNames = Object.keys(options.optimistic.transforms);
  const optimisticChange = optimisticChangeFromInput(options.input, options.change);
  const optimisticKeys = resolveOptimisticKeys(options.optimistic, optimisticChange);

  // SPEC.md §10.4: predict against query data, mark dependent islands pending,
  // then reconcile the server fragment/query truth over remaining predictions.
  options.rebaser.addChange(idem, optimisticChange, options.optimistic);
  if (options.pendingRoot) {
    stampPendingQueries(options.pendingRoot, queryNames, true);
  }

  try {
    const fetched = await fetchEnhancedMutation(options, idem);

    if (isFailedMutationResponse(fetched.response)) {
      options.rebaser.discardPendingOptimism(queryNames, optimisticKeys);
      if (options.pendingRoot) {
        stampPendingQueries(options.pendingRoot, queryNames, false);
      }

      return applyFetchedEnhancedMutationResponseToDom(options, fetched);
    }

    const applied = applyFetchedEnhancedMutationResponseToDom(
      options,
      fetched,
      optimisticMutationDomApplyHooks(options, idem, queryNames, optimisticKeys),
    );
    const settledQueries = queryNames.filter(
      (queryName) => options.rebaser.pendingCount(queryName, optimisticKeys[queryName]) === 0,
    );
    if (options.pendingRoot && settledQueries.length > 0) {
      stampPendingQueries(options.pendingRoot, settledQueries, false);
    }

    return {
      ...applied,
    };
  } catch (error) {
    options.rebaser.discardPendingOptimism(queryNames, optimisticKeys);
    if (options.pendingRoot) {
      stampPendingQueries(options.pendingRoot, queryNames, false);
    }
    reportRuntimeError(options.onError, error);
    throw error;
  }
}

function optimisticMutationDomApplyHooks<Input>(
  options: OptimisticEnhancedMutationSubmitOptions<Input>,
  idem: string,
  queryNames: readonly string[],
  optimisticKeys: Readonly<Record<string, string | undefined>>,
): MutationDomApplyHooks {
  return {
    applyQuery(query) {
      options.rebaser.applyServerTruth(query.name, query.value, query.key);
      return { value: options.store.get(query.name, query.key) };
    },
    beforeApplyQueries(queryChunks) {
      const uncoveredQueries = uncoveredOptimisticQueries(queryChunks, queryNames, optimisticKeys);
      for (const queryName of uncoveredQueries) {
        options.rebaser.settleWithoutServerTruth(idem, queryName, optimisticKeys[queryName]);
        reportRuntimeError(
          options.onError,
          uncoveredOptimisticQueryError(queryName, optimisticKeys[queryName]),
        );
      }
      options.rebaser.settle(idem);
    },
  };
}

function uncoveredOptimisticQueries(
  queryChunks: readonly QueryChunk[],
  queryNames: readonly string[],
  optimisticKeys: Readonly<Record<string, string | undefined>>,
): string[] {
  const covered = new Set(queryChunks.map((query) => queryStoreKey(query.name, query.key)));
  return queryNames.filter(
    (queryName) => !covered.has(queryStoreKey(queryName, optimisticKeys[queryName])),
  );
}

function uncoveredOptimisticQueryError(queryName: string, key?: string): Error {
  const identity = key ? `${queryName}:${key}` : queryName;
  return new Error(`Optimistic transform for ${identity} was not covered by server query truth.`);
}

function applyFetchedEnhancedMutationResponseToDom(
  options: EnhancedMutationSubmitOptions,
  fetched: FetchedEnhancedMutation,
  hooks: MutationDomApplyHooks = {},
): EnhancedMutationAppliedResult {
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
  options: EnhancedMutationSubmitOptions,
  fetched: FetchedEnhancedMutation,
): void {
  if (isFailedMutationResponse(fetched.response)) return;

  options.broadcast?.publish(fetched.body, fetched.changes);
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

interface FetchedEnhancedMutation {
  body: string;
  changes: MutationChangeRecord[];
  idem: string;
  response: EnhancedMutationResponseLike;
  targets: string[];
}

async function fetchEnhancedMutation(
  options: EnhancedMutationSubmitOptions,
  idem = options.idem ?? createMutationIdem(),
): Promise<FetchedEnhancedMutation> {
  const targets = readLiveTargets(options.root);
  const response = await options.fetch(options.form.action, {
    body: options.formData,
    headers: {
      Accept: 'text/vnd.jiso.fragment+html',
      'FW-Fragment': 'true',
      'FW-Idem': idem,
      'FW-Targets': serializeLiveTargetEntries(targets),
    },
    keepalive: true,
    method: (options.form.method ?? 'post').toUpperCase(),
    ...definedProps({ onUploadProgress: options.onUploadProgress }),
  });
  const changes = readMutationChangeHeader(response, options.onError);

  return {
    body: await response.text(),
    changes,
    idem,
    response,
    targets,
  };
}

function isFailedMutationResponse(response: EnhancedMutationResponseLike): boolean {
  return response.ok === false || (response.status !== undefined && response.status >= 400);
}
