export type { DiagnosticCode } from '@jiso/core';
import type { Form, FormFailure, FormInput, JsonValue } from '@jiso/core';
import { malformedJsonError, parseJsonValue } from './json.js';
import { hydrateQueryScripts, queryStoreKey } from './query-store.js';
import type { QueryScriptLike, QueryStore } from './query-store.js';
import { applyFragmentQueryBody, applyMutationResponseToStore } from './apply-path.js';
import type { AppliedMutationResponse } from './apply-path.js';
import {
  abortIslandSignalScope,
  createIslandSignalScope,
  defaultIslandSignalScope,
  dispatchDelegatedEvent,
} from './handlers.js';
import type { ImportHandlerModule, IslandSignalScope } from './handlers.js';
import { applyFragments } from './morph.js';
import type { MorphFragment, MorphRoot } from './morph.js';
import { MutationQueue } from './mutation-queue.js';
import { applyCompiledQueryUpdatePlan, supportsQueryBindings } from './query-bindings.js';
import type { CompiledQueryUpdatePlan, CompiledQueryUpdatePlans } from './query-bindings.js';
import {
  installPagehideOptimismCleanup,
  optimisticChangeFromInput,
  OptimisticRebaser,
  resolveOptimisticKeys,
} from './optimism.js';
import type { MutationChangeRecord, OptimisticChange, OptimisticPlan } from './optimism.js';
import { deferredStreamChunks, readAttribute, tagClose, unescapeHtml } from './wire-parser.js';
import type { QueryChunk } from './wire-parser.js';
import type { DelegatedEvent, EventElementLike, RuntimeErrorContext } from './events.js';
export * from './events.js';
export {
  abortRemovedIslandSignals,
  dispatchDelegatedEvent,
  handler,
  parseHandlerReference,
  parseHandlerReferences,
  readElementParams,
  readElementState,
  writeElementState,
} from './handlers.js';
export type {
  ClientHandler,
  ElementParamValue,
  HandlerContext,
  ImportHandlerModule,
  IslandSignalScope,
} from './handlers.js';
export type { AppliedMutationResponse } from './apply-path.js';
export {
  applyFragments,
  DomMorphRoot,
  DomMorphTarget,
  keyedDomMorph,
  morphDomElement,
  morphStructuralTree,
} from './morph.js';
export type {
  MorphFragment,
  MorphRoot,
  MorphTarget,
  StructuralMorphBrowserState,
  StructuralMorphKey,
  StructuralMorphNode,
} from './morph.js';
export {
  applyCompiledQueryUpdatePlan,
  applyQueryBindings,
  supportsQueryBindings,
} from './query-bindings.js';
export type {
  AppliedCompiledQueryUpdatePlan,
  CompiledQueryDerive,
  CompiledQueryStamp,
  CompiledQueryTemplateStamp,
  CompiledQueryUpdatePlan,
  CompiledQueryUpdatePlans,
  QueryBindingElement,
  QueryBindingRoot,
  TemplateStampHost,
  TemplateStampItem,
} from './query-bindings.js';
export {
  createInlineJisoLoaderSource,
  installInlineJisoLoader,
  jisoLoaderSource,
} from './inline-loader.js';
export type { InlineImportHandlerModule } from './inline-loader.js';
export { createQueryStore, hydrateQueryScripts } from './query-store.js';
export type { QueryScriptLike, QuerySnapshot, QueryStore, QueryUpdatePlan } from './query-store.js';
export type { FragmentChunk, QueryChunk } from './wire-parser.js';
export { MutationQueue } from './mutation-queue.js';
export type { MutationTask } from './mutation-queue.js';
export {
  applyOptimisticTransforms,
  installPagehideOptimismCleanup,
  OptimisticRebaser,
} from './optimism.js';
export type {
  MutationChangeRecord,
  OptimisticChange,
  OptimisticEntry,
  OptimisticFor,
  OptimisticPlan,
  OptimisticQueryKey,
  OptimisticTransform,
  PagehideOptimismCleanupOptions,
  PendingOptimism,
  PendingTransform,
} from './optimism.js';

export interface DeriveDefinition<Inputs extends readonly string[], Value> {
  inputs: Inputs;
  run(...values: unknown[]): Value;
}

export function derive<const Inputs extends readonly string[], Value>(
  inputs: Inputs,
  fn: (...values: unknown[]) => Value,
): DeriveDefinition<Inputs, Value> {
  return { inputs, run: fn };
}

type DefinedProps<Props extends object> = {
  [Key in keyof Props]?: Exclude<Props[Key], undefined>;
};

function definedProps<Props extends object>(props: Props): DefinedProps<Props> {
  return Object.fromEntries(
    Object.entries(props).filter((entry) => {
      const [, value] = entry;
      return value !== undefined;
    }),
  ) as DefinedProps<Props>;
}

export interface LoaderRoot {
  addEventListener(
    type: string,
    listener: (event: DelegatedEvent) => void | Promise<void>,
    options?: { capture?: boolean },
  ): void;
  querySelectorAll?: (selector: string) => Iterable<EventElementLike | QueryScriptLike>;
  removeEventListener?: (
    type: string,
    listener: (event: DelegatedEvent) => void | Promise<void>,
    options?: { capture?: boolean },
  ) => void;
  visibilityState?: 'hidden' | 'visible';
}

export interface LoaderLifecycleTarget {
  addEventListener(
    type: string,
    listener: (event: DelegatedEvent) => void | Promise<void>,
    options?: { capture?: boolean },
  ): void;
  removeEventListener?: (
    type: string,
    listener: (event: DelegatedEvent) => void | Promise<void>,
    options?: { capture?: boolean },
  ) => void;
}

export interface VisibleObserver {
  observe(element: EventElementLike): void;
  unobserve(element: EventElementLike): void;
}

export type VisibleObserverFactory = (
  callback: (entries: readonly VisibleObserverEntry[]) => void,
) => VisibleObserver;

export interface VisibleObserverEntry {
  isIntersecting: boolean;
  target: EventElementLike;
}

export interface JisoLoaderOptions {
  discardPendingOptimism?: () => readonly string[] | void;
  enhancedMutations?: EnhancedMutationLoaderOptions;
  events?: readonly string[];
  focusTarget?: LoaderLifecycleTarget;
  importModule: ImportHandlerModule;
  onError?: (error: unknown, context: RuntimeErrorContext) => void;
  queryRefetch?: QueryRefetchOptions;
  requestIdle?: (callback: () => void) => void;
  visibleObserver?: VisibleObserverFactory;
  queryStore?: QueryStore;
  refetchOnFocus?: (queries: readonly string[]) => void | Promise<void>;
  refetchOnFocusOptOut?: readonly string[];
  root: LoaderRoot;
}

export interface QueryRefetchOptions {
  fetch: QueryRefetchFetch;
  urlForQuery?: (query: string) => string | undefined;
}

export interface QueryRefetchFetch {
  (
    url: string,
    init: {
      headers: Record<string, string>;
      method: 'GET';
    },
  ): Promise<QueryRefetchResponse> | QueryRefetchResponse;
}

export interface QueryRefetchResponse {
  ok?: boolean;
  status?: number;
  text(): Promise<string> | string;
}

export interface JisoLoader {
  dispose(): void;
  events: readonly string[];
}

const defaultDelegatedEvents = ['click', 'submit', 'input', 'change'] as const;

export function installJisoLoader(options: JisoLoaderOptions): JisoLoader {
  const events = options.events ?? defaultDelegatedEvents;
  const islandSignalScope = createIslandSignalScope();
  const disposers: Array<() => void> = [];
  const hydratedQueries = new Set<string>();
  const rememberHydratedQueries = (queries: readonly string[]) => {
    for (const query of queries) {
      hydratedQueries.add(query);
    }
  };
  const enhancedMutationSetup = options.enhancedMutations
    ? withDefaultMutationBroadcast(options.enhancedMutations)
    : undefined;
  const enhancedMutations = enhancedMutationSetup?.options;

  if (options.queryStore && options.root.querySelectorAll) {
    rememberHydratedQueries(
      hydrateQueryScripts(
        options.queryStore,
        options.root.querySelectorAll('script[fw-query]') as Iterable<QueryScriptLike>,
        {
          onError(error) {
            options.onError?.(error, { phase: 'query-hydration' });
          },
        },
      ),
    );
  }

  for (const eventName of events) {
    addLoaderListener(
      options.root,
      eventName,
      async (event) => {
        const enhancedSubmit = isEnhancedSubmitEvent(event, enhancedMutations);
        try {
          if (
            await dispatchEnhancedFormSubmit(event, enhancedMutations, islandSignalScope, {
              onAppliedQueries: rememberHydratedQueries,
            })
          ) {
            return;
          }
          await dispatchDelegatedEvent(event, options.importModule, islandSignalScope);
        } catch (error) {
          options.onError?.(error, {
            event,
            phase: enhancedSubmit ? 'enhanced-mutation' : 'delegated-event',
          });
        }
      },
      disposers,
      { capture: true },
    );
  }

  if (options.refetchOnFocus || (options.queryRefetch && options.queryStore)) {
    const refetchEligibleQueries = () =>
      filterRefetchEligibleQueries([...hydratedQueries], options.refetchOnFocusOptOut ?? []);
    let refetchInFlight: Promise<void> | undefined;
    const refetchOnFocus = async () => {
      const queries = refetchEligibleQueries();
      await options.refetchOnFocus?.(queries);
      if (options.queryRefetch && options.queryStore) {
        const applied = await refetchQueries({
          ...options.queryRefetch,
          queries,
          queryStore: options.queryStore,
        });
        rememberHydratedQueries(applied.flatMap((chunk) => chunk.queries));
      }
    };
    const refetchOnce = () => {
      refetchInFlight ??= refetchOnFocus().finally(() => {
        refetchInFlight = undefined;
      });
      return refetchInFlight;
    };

    addLoaderListener(
      options.root,
      'visibilitychange',
      async () => {
        if (options.root.visibilityState === 'hidden') return;
        await refetchOnce();
      },
      disposers,
    );
  }

  if (options.discardPendingOptimism) {
    disposers.push(
      installPagehideOptimismCleanup({
        discardPendingOptimism: options.discardPendingOptimism,
        root: options.root,
      }),
    );
  }

  disposers.push(installExecutionTriggers(options, islandSignalScope));
  if (enhancedMutationSetup?.dispose) {
    disposers.push(enhancedMutationSetup.dispose);
  }
  disposers.push(() => {
    abortIslandSignalScope(islandSignalScope);
  });

  return {
    dispose() {
      for (const dispose of disposers.splice(0).reverse()) dispose();
    },
    events,
  };
}

function addLoaderListener(
  target: LoaderLifecycleTarget,
  type: string,
  listener: (event: DelegatedEvent) => void | Promise<void>,
  disposers: Array<() => void>,
  options?: { capture?: boolean },
): void {
  target.addEventListener(type, listener, options);
  disposers.push(() => {
    target.removeEventListener?.(type, listener, options);
  });
}

function installExecutionTriggers(
  options: JisoLoaderOptions,
  islandSignalScope: IslandSignalScope,
): () => void {
  if (!options.root.querySelectorAll) return () => undefined;

  for (const element of options.root.querySelectorAll(
    '[on\\:load]',
  ) as Iterable<EventElementLike>) {
    dispatchExecutionTrigger({ target: element, type: 'load' }, options, islandSignalScope);
  }

  const requestIdle =
    options.requestIdle ??
    (typeof globalThis.requestIdleCallback === 'function'
      ? (callback: () => void) => {
          globalThis.requestIdleCallback(callback);
        }
      : (callback: () => void) => {
          setTimeout(callback, 0);
        });

  for (const element of options.root.querySelectorAll(
    '[on\\:idle]',
  ) as Iterable<EventElementLike>) {
    requestIdle(() => {
      dispatchExecutionTrigger({ target: element, type: 'idle' }, options, islandSignalScope);
    });
  }

  const visibleElements = [
    ...(options.root.querySelectorAll('[on\\:visible]') as Iterable<EventElementLike>),
  ];
  if (visibleElements.length === 0) return () => undefined;

  const createObserver =
    options.visibleObserver ??
    (typeof globalThis.IntersectionObserver === 'function'
      ? (callback: (entries: readonly VisibleObserverEntry[]) => void) =>
          new globalThis.IntersectionObserver((entries) => {
            callback(
              entries.map((entry) => ({
                isIntersecting: entry.isIntersecting,
                target: entry.target as unknown as EventElementLike,
              })),
            );
          }) as unknown as VisibleObserver
      : undefined);
  if (!createObserver) return () => undefined;

  const seen = new Set<EventElementLike>();
  const observer = createObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || seen.has(entry.target)) continue;

      seen.add(entry.target);
      observer.unobserve(entry.target);
      dispatchExecutionTrigger(
        { target: entry.target, type: 'visible' },
        options,
        islandSignalScope,
      );
    }
  });

  for (const element of visibleElements) {
    observer.observe(element);
  }

  return () => {
    for (const element of new Set([...seen, ...visibleElements])) {
      observer.unobserve(element);
    }
  };
}

function dispatchExecutionTrigger(
  event: DelegatedEvent,
  options: JisoLoaderOptions,
  islandSignalScope: IslandSignalScope,
): void {
  void dispatchDelegatedEvent(event, options.importModule, islandSignalScope).catch((error) => {
    options.onError?.(error, { event, phase: 'execution-trigger' });
  });
}

function withDefaultMutationBroadcast(options: EnhancedMutationLoaderOptions): {
  dispose?: () => void;
  options: EnhancedMutationLoaderOptions;
} {
  if (options.broadcast) return { options };
  if (typeof globalThis.BroadcastChannel !== 'function') return { options };

  try {
    const broadcast = installMutationBroadcast({
      channel: new globalThis.BroadcastChannel('jiso:mutation-response') as BroadcastLike,
      ...definedProps({ morph: options.morph, queryPlans: options.queryPlans }),
      root: options.root,
      store: options.store,
    });
    return {
      dispose: () => {
        broadcast.close();
      },
      options: {
        ...options,
        broadcast,
      },
    };
  } catch {
    return { options };
  }
}

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
              options.onError?.(error, form);
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

function fallbackEnhancedMutationSubmit(form: EnhancedFormElementLike): void {
  if (typeof form.submit === 'function') {
    form.submit();
    return;
  }

  form.setAttribute?.('data-error-code', 'NETWORK_ERROR');
  form.setAttribute?.('fw-error', '');
}

function isEnhancedSubmitEvent(
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

function filterRefetchEligibleQueries(
  queries: readonly string[],
  optOut: readonly string[],
): readonly string[] {
  const excluded = new Set(optOut);
  const eligible: string[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    if (excluded.has(query) || seen.has(query)) continue;

    eligible.push(query);
    seen.add(query);
  }

  return eligible;
}

export async function refetchQueries(
  options: QueryRefetchOptions & {
    queries: readonly string[];
    queryStore: QueryStore;
  },
): Promise<AppliedMutationResponse[]> {
  const applied: AppliedMutationResponse[] = [];

  for (const query of options.queries) {
    const url = options.urlForQuery?.(query) ?? `/_q/${encodeURIComponent(query)}`;
    if (!url) continue;

    const response = await options.fetch(url, {
      headers: {
        Accept: 'text/html',
        'FW-Fragment': 'true',
      },
      method: 'GET',
    });

    if (response.ok === false || (response.status !== undefined && response.status >= 400)) {
      continue;
    }

    applied.push(applyMutationResponse(options.queryStore, await response.text()));
  }

  return applied;
}

export interface AppliedDeferredStreamResponse extends AppliedMutationResponse {
  appliedFragments: string[];
  chunks: Array<AppliedMutationResponse & { appliedFragments: string[] }>;
}

export interface EnhancedFormLike {
  action: string;
  method?: string;
}

export interface TargetCollectorRoot {
  querySelectorAll(selector: string): Iterable<{
    getAttribute(name: string): string | null;
    id?: string;
  }>;
}

export interface PendingElementLike {
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  setAttribute(name: string, value: string): void;
}

export interface PendingRoot {
  querySelectorAll(selector: string): Iterable<PendingElementLike>;
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

function parseMutationFailure(body: string): JsonValue {
  // SPEC.md §9.2: enhanced form failures travel as mutation wire HTML, so
  // quoted tag delimiters in attributes must follow the shared wire parser.
  const errorChunk = readFirstElementChunk(body, 'fw-error');
  if (errorChunk) return parseJsonOrUnknown(unescapeHtml(errorChunk.content));

  const declaredFailure = parseDeclaredFailureOutput(body);
  if (declaredFailure) return declaredFailure;

  const validationFailure = parseValidationFailureOutput(body);
  if (validationFailure) return validationFailure;

  return parseJsonOrUnknown(body);
}

function parseJsonOrUnknown(raw: string): JsonValue {
  const parsed = parseJsonValue(raw);
  if (parsed.ok) return parsed.value;

  return { body: raw, code: 'unknown' };
}

function parseDeclaredFailureOutput(body: string): JsonValue | null {
  for (const output of readElementChunks(body, 'output')) {
    const code = readAttribute(output.attrs, 'data-error-code');
    if (!code) continue;

    return {
      code,
      data: parseOutputPayload(output.content),
    };
  }

  return null;
}

function parseValidationFailureOutput(body: string): JsonValue | null {
  const fields: Record<string, string> = {};

  for (const output of readElementChunks(body, 'output')) {
    const path = readAttribute(output.attrs, 'data-error-path');
    if (!path) continue;

    fields[path] = unescapeHtml(output.content).trim();
  }

  return Object.keys(fields).length > 0 ? { code: 'VALIDATION', fields } : null;
}

function readFirstElementChunk(
  body: string,
  tagName: string,
): { attrs: string; content: string } | null {
  return readElementChunks(body, tagName)[0] ?? null;
}

function readElementChunks(
  body: string,
  tagName: string,
): Array<{ attrs: string; content: string }> {
  const chunks: Array<{ attrs: string; content: string }> = [];
  const openingTag = new RegExp(`<${tagName}\\b`, 'gi');

  for (let match = openingTag.exec(body); match; match = openingTag.exec(body)) {
    const openingEnd = tagClose(body, match.index + match[0].length);
    if (openingEnd === undefined) break;

    const closingTag = new RegExp(`</${tagName}\\s*>`, 'gi');
    closingTag.lastIndex = openingEnd + 1;
    const close = closingTag.exec(body);
    if (!close) break;

    chunks.push({
      attrs: body.slice(match.index + match[0].length, openingEnd),
      content: body.slice(openingEnd + 1, close.index),
    });
    openingTag.lastIndex = closingTag.lastIndex;
  }

  return chunks;
}

function parseOutputPayload(content: string): JsonValue {
  const raw = unescapeHtml(content).trim();
  if (!raw) return {};

  const parsed = parseJsonValue(raw);
  return parsed.ok ? parsed.value : raw;
}

export function applyMutationResponse(store: QueryStore, body: string): AppliedMutationResponse {
  return applyMutationResponseToStore(store, body);
}

export const applyDeferredChunk: typeof applyMutationResponse = applyMutationResponse;

export interface ApplyMutationResponseToDomOptions {
  applyQuery?: (query: QueryChunk) => { value: unknown } | void;
  beforeApplyQueries?: (queries: readonly QueryChunk[]) => void;
  body: string;
  islandSignalScope?: IslandSignalScope;
  morph?: MorphFragment;
  onError?: (error: unknown) => void;
  queryPlans?: CompiledQueryUpdatePlans;
  root: MorphRoot;
  store: QueryStore;
}

export type AppliedMutationResponseToDom = AppliedMutationResponse & { appliedFragments: string[] };

export function applyMutationResponseToDom(
  options: ApplyMutationResponseToDomOptions,
): AppliedMutationResponseToDom {
  const applied = applyFragmentQueryBody(
    options.body,
    (query) => {
      const queryResult = options.applyQuery?.(query);
      const planValue = queryResult ? queryResult.value : query.value;
      if (!queryResult) {
        options.store.set(query.name, query.value, query.key);
      }
      applyCompiledQueryUpdatePlanIfSupported(
        options.root,
        query.name,
        planValue,
        options.queryPlans?.[query.name],
      );
    },
    options.onError,
    options.beforeApplyQueries,
  );

  return {
    ...applied,
    appliedFragments: applyFragments(
      options.root,
      applied.fragments,
      options.morph,
      options.islandSignalScope,
    ),
  };
}

export const applyDeferredChunkToDom: typeof applyMutationResponseToDom =
  applyMutationResponseToDom;

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

export function applyDeferredStreamResponseToDom(options: {
  body: string;
  boundary?: string;
  islandSignalScope?: IslandSignalScope;
  morph?: MorphFragment;
  onError?: (error: unknown) => void;
  queryPlans?: CompiledQueryUpdatePlans;
  root: MorphRoot;
  store: QueryStore;
}): AppliedDeferredStreamResponse {
  const chunks = deferredStreamChunks(options.body, options.boundary ?? 'jiso-boundary').map(
    (body) =>
      applyDeferredChunkToDom({
        body,
        ...definedProps({
          islandSignalScope: options.islandSignalScope,
          morph: options.morph,
          onError: options.onError,
          queryPlans: options.queryPlans,
        }),
        root: options.root,
        store: options.store,
      }),
  );

  return {
    appliedFragments: chunks.flatMap((chunk) => chunk.appliedFragments),
    chunks,
    fragments: chunks.flatMap((chunk) => chunk.fragments),
    queries: chunks.flatMap((chunk) => chunk.queries),
  };
}

export async function submitEnhancedMutation(options: EnhancedMutationSubmitOptions): Promise<
  AppliedMutationResponse & {
    appliedFragments: string[];
    changes: MutationChangeRecord[];
    idem: string;
    targets: string[];
  }
> {
  stampEnhancedMutationPending(options, true);

  let body = '';
  let changes: MutationChangeRecord[] = [];
  let idem = options.idem ?? '';
  let response: EnhancedMutationResponseLike | undefined;
  let targets: string[] = [];

  try {
    const fetched = await fetchEnhancedMutation(options);
    body = fetched.body;
    changes = fetched.changes;
    idem = fetched.idem;
    response = fetched.response;
    targets = fetched.targets;
    const applied = applyEnhancedMutationResponseBodyToDom(options, body);
    publishSuccessfulMutation(options, response, body, changes);

    return {
      ...applied,
      changes,
      idem,
      targets,
    };
  } catch (error) {
    options.onError?.(error);
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
): Promise<
  AppliedMutationResponse & {
    appliedFragments: string[];
    changes: MutationChangeRecord[];
    idem: string;
    targets: string[];
  }
> {
  const idem = options.idem ?? createIdem();
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
    const { body, changes, response, targets } = await fetchEnhancedMutation(options, idem);

    if (isFailedMutationResponse(response)) {
      options.rebaser.discardPendingOptimism(queryNames, optimisticKeys);
      if (options.pendingRoot) {
        stampPendingQueries(options.pendingRoot, queryNames, false);
      }

      const applied = applyEnhancedMutationResponseBodyToDom(options, body);

      return {
        ...applied,
        changes,
        idem,
        targets,
      };
    }

    const applied = applyEnhancedMutationResponseBodyToDom(options, body, {
      applyQuery(query) {
        options.rebaser.applyServerTruth(query.name, query.value, query.key);
        return { value: options.store.get(query.name, query.key) };
      },
      beforeApplyQueries(queryChunks) {
        const uncoveredQueries = uncoveredOptimisticQueries(
          queryChunks,
          queryNames,
          optimisticKeys,
        );
        for (const queryName of uncoveredQueries) {
          options.rebaser.settleWithoutServerTruth(idem, queryName, optimisticKeys[queryName]);
          options.onError?.(uncoveredOptimisticQueryError(queryName, optimisticKeys[queryName]));
        }
        options.rebaser.settle(idem);
      },
    });
    publishSuccessfulMutation(options, response, body, changes);
    const settledQueries = queryNames.filter(
      (queryName) => options.rebaser.pendingCount(queryName, optimisticKeys[queryName]) === 0,
    );
    if (options.pendingRoot && settledQueries.length > 0) {
      stampPendingQueries(options.pendingRoot, settledQueries, false);
    }

    return {
      ...applied,
      changes,
      idem,
      targets,
    };
  } catch (error) {
    options.rebaser.discardPendingOptimism(queryNames, optimisticKeys);
    if (options.pendingRoot) {
      stampPendingQueries(options.pendingRoot, queryNames, false);
    }
    throw error;
  }
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

function publishSuccessfulMutation(
  options: EnhancedMutationSubmitOptions,
  response: EnhancedMutationResponseLike,
  body: string,
  changes: readonly MutationChangeRecord[],
): void {
  if (isFailedMutationResponse(response)) return;

  options.broadcast?.publish(body, changes);
}

export function stampPendingQueries(
  root: PendingRoot,
  queryNames: readonly string[],
  pending: boolean,
): string[] {
  const affected = new Set(queryNames);
  const stamped: string[] = [];

  for (const element of root.querySelectorAll('[fw-deps]')) {
    const deps = readDeps(element.getAttribute('fw-deps'));
    if (!deps.some((dep) => affected.has(dep))) continue;

    if (pending) {
      element.setAttribute('fw-pending', '');
      element.setAttribute('aria-busy', 'true');
    } else {
      element.removeAttribute('fw-pending');
      element.removeAttribute('aria-busy');
    }
    stamped.push(deps.join(','));
  }

  return stamped;
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

export interface BroadcastLike {
  close?: () => void;
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
}

export interface MutationBroadcast {
  close(): void;
  publish(body: string, changes?: readonly MutationChangeRecord[]): void;
}

export function installMutationBroadcast(options: {
  channel: BroadcastLike;
  morph?: MorphFragment;
  onChanges?: (changes: readonly MutationChangeRecord[]) => void;
  queryPlans?: CompiledQueryUpdatePlans;
  root?: MorphRoot;
  store: QueryStore;
}): MutationBroadcast {
  options.channel.onmessage = (event) => {
    if (!isMutationBroadcastMessage(event.data)) return;
    const changes = event.data.changes.flatMap((change) => {
      const sanitized = sanitizeMutationChangeRecord(change);
      return sanitized ? [sanitized] : [];
    });

    if (options.root) {
      applyMutationResponseToDom({
        body: event.data.body,
        ...definedProps({ morph: options.morph, queryPlans: options.queryPlans }),
        root: options.root,
        store: options.store,
      });
    } else {
      applyMutationResponse(options.store, event.data.body);
    }
    if (changes.length > 0) {
      options.onChanges?.(changes);
    }
  };

  return {
    close() {
      options.channel.onmessage = null;
      options.channel.close?.();
    },
    publish(body: string, changes: readonly MutationChangeRecord[] = []) {
      options.channel.postMessage({
        body,
        changes: changes.flatMap((change) => {
          const sanitized = sanitizeMutationChangeRecord(change);
          return sanitized ? [sanitized] : [];
        }),
        type: 'jiso:mutation-response',
      });
    },
  };
}

async function fetchEnhancedMutation(
  options: EnhancedMutationSubmitOptions,
  idem = options.idem ?? createIdem(),
): Promise<{
  body: string;
  changes: MutationChangeRecord[];
  idem: string;
  response: EnhancedMutationResponseLike;
  targets: string[];
}> {
  const targets = readLiveTargets(options.root);
  const response = await options.fetch(options.form.action, {
    body: options.formData,
    headers: {
      Accept: 'text/vnd.jiso.fragment+html',
      'FW-Fragment': 'true',
      'FW-Idem': idem,
      'FW-Targets': targets.join('; '),
    },
    keepalive: true,
    method: (options.form.method ?? 'post').toUpperCase(),
    ...(options.onUploadProgress ? { onUploadProgress: options.onUploadProgress } : {}),
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

function applyCompiledQueryUpdatePlanIfSupported(
  root: MorphRoot,
  queryName: string,
  value: unknown,
  plan: CompiledQueryUpdatePlan | undefined,
): void {
  if (!supportsQueryBindings(root)) return;
  applyCompiledQueryUpdatePlan(root, queryName, value, plan);
}

function readLiveTargets(root: TargetCollectorRoot): string[] {
  const targets = new Set<string>();

  for (const element of root.querySelectorAll('[fw-deps]')) {
    const target = element.getAttribute('fw-fragment-target') ?? element.id;
    const deps = readDeps(element.getAttribute('fw-deps'));
    if (target) targets.add(deps.length > 0 ? `${target}=${deps.join(' ')}` : target);
  }

  return [...targets];
}

function readDeps(value: string | null): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((dep) => dep.trim())
    .filter(Boolean);
}

let generatedIdemCounter = 0;

function createIdem(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `idem_${Date.now().toString(36)}_${(generatedIdemCounter += 1).toString(36)}`
  );
}

function readMutationChangeHeader(
  response: EnhancedMutationResponseLike,
  onError?: (error: unknown) => void,
): MutationChangeRecord[] {
  const value = response.headers?.get('FW-Changes') ?? response.headers?.get('fw-changes');
  if (!value) return [];

  const parsed = parseJsonValue(value);
  if (!parsed.ok) {
    onError?.(malformedJsonError('FW-Changes header', parsed.error));
    return [];
  }
  if (!Array.isArray(parsed.value)) return [];

  return parsed.value.flatMap((record) => {
    const sanitized = sanitizeMutationChangeRecord(record);
    return sanitized ? [sanitized] : [];
  });
}

function isMutationBroadcastMessage(value: unknown): value is {
  body: string;
  changes: MutationChangeRecord[];
  type: 'jiso:mutation-response';
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'jiso:mutation-response' &&
    'body' in value &&
    typeof value.body === 'string' &&
    'changes' in value &&
    Array.isArray(value.changes) &&
    value.changes.every(isMutationChangeRecord)
  );
}

function isMutationChangeRecord(value: unknown): value is MutationChangeRecord {
  return sanitizeMutationChangeRecord(value) !== null;
}

function sanitizeMutationChangeRecord(value: unknown): MutationChangeRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  if (!('domain' in value) || typeof value.domain !== 'string') return null;
  const keys = 'keys' in value ? value.keys : undefined;
  if (
    keys !== undefined &&
    !(Array.isArray(keys) && keys.every((key) => typeof key === 'string'))
  ) {
    return null;
  }

  return {
    domain: value.domain,
    ...(keys === undefined ? {} : { keys }),
  };
}
