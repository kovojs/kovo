export type { DiagnosticCode } from '@jiso/core';
import type {
  Form,
  FormFailure,
  FormInput,
  InvalidationSets,
  JsonValue,
  QueryRegistry,
} from '@jiso/core';
import { malformedJsonError, parseJsonValue } from './json.js';
import { hydrateQueryScripts, queryIdentityFromStoreKey, queryStoreKey } from './query-store.js';
import type { QueryScriptLike, QuerySnapshot, QueryStore } from './query-store.js';
import {
  abortIslandSignalScope,
  createIslandSignalScope,
  defaultIslandSignalScope,
  dispatchDelegatedEvent,
} from './handlers.js';
import type { ImportHandlerModule, IslandSignalScope } from './handlers.js';
import { applyFragments } from './morph.js';
import type { MorphFragment, MorphRoot } from './morph.js';
import {
  deferredStreamChunks,
  readAttribute,
  readFragmentChunks,
  readQueryChunks,
  tagClose,
  unescapeHtml,
} from './wire-parser.js';
import type { FragmentChunk, QueryChunk } from './wire-parser.js';
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
export { createQueryStore, hydrateQueryScripts } from './query-store.js';
export type { QueryScriptLike, QuerySnapshot, QueryStore, QueryUpdatePlan } from './query-store.js';
export type { FragmentChunk, QueryChunk } from './wire-parser.js';

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

export type InlineImportHandlerModule = ImportHandlerModule;

// SPEC.md §4.4 keeps the always-loaded loader under a 4KB gzip budget; this
// literal is the pre-minified bootstrap shipped in document shells.
const inlineJisoLoaderInstallerSource = `function installInlineJisoLoader(importModule){const events=['click','submit','input','change'];const doc=document;let idemCounter=0;const createInlineIdem=()=>crypto.randomUUID?.()??'idem_'+Date.now().toString(36)+'_'+(idemCounter+=1).toString(36);const readStateHost=(element)=>element.closest?.('[fw-state]')??element;const readState=(element)=>{try{return JSON.parse(readStateHost(element)?.getAttribute('fw-state')??'{}');}catch{return{};}};const readDeps=(value)=>(value??'').split(/[\\s,]+/).map((dep)=>dep.trim()).filter(Boolean);const readTargets=()=>[...doc.querySelectorAll('[fw-deps]')].map((element)=>{const deps=readDeps(element.getAttribute('fw-deps'));const target=element.getAttribute('fw-fragment-target')??element.id;return target&&(deps.length>0?target+'='+deps.join(' '):target);}).filter(Boolean);const findFragmentTarget=(target)=>doc.getElementById(target)??doc.querySelector('[fw-fragment-target="'+target+'"]');const applyFragment=(fragment)=>{const target=fragment.getAttribute('target');const element=target&&findFragmentTarget(target);if(!element)return;if(fragment.getAttribute('mode')==='append'){element.insertAdjacentHTML('beforeend',fragment.innerHTML);}else{element.innerHTML=fragment.innerHTML;}};const applyResponseBody=(body)=>{const parsed=new DOMParser().parseFromString(body,'text/html');parsed.querySelectorAll('fw-query').forEach((query)=>{dispatchEvent(new CustomEvent('jiso:query',{detail:{body:query.textContent,key:query.getAttribute('key')??undefined,name:query.getAttribute('name'),},}),);});parsed.querySelectorAll('fw-fragment').forEach(applyFragment);};const fallbackSubmit=(form)=>{if(typeof form.submit==='function'){form.submit();return;}form.setAttribute?.('data-error-code','NETWORK_ERROR');form.setAttribute?.('fw-error','');};const submitEnhancedForm=(event,form)=>{event.preventDefault();fetch(form.action,{body:new FormData(form),headers:{Accept:'text/vnd.jiso.fragment+html','FW-Fragment':'true','FW-Idem':createInlineIdem(),'FW-Targets':readTargets().join('; '),},keepalive:true,method:(form.method||'post').toUpperCase(),}).then((response)=>response.text()).then(applyResponseBody).catch(()=>fallbackSubmit(form));};const readParamTypes=(element)=>(element.getAttribute('fw-param-types')||'').split(/[\\s,]+/).reduce((types,entry)=>{const[name,type]=entry.split(':');if(name)types[name]=type;return types;},{},);const dispatch=async(event)=>{if(event.type==='submit'){const form=event.target?.closest?.('form[enhance],form[data-enhance],form[data-mutation]',);if(form){submitEnhancedForm(event,form);return;}}const element=event.target?.closest?.('[on\\\\:'+event.type+']');const refs=element?.getAttribute('on:'+event.type);if(!element||!refs)return;const params={};const paramTypes=readParamTypes(element);const state=readState(element);const stateHost=readStateHost(element);const context={params,state,signal:new AbortController().signal};for(const attribute of element.attributes||[]){if(!attribute.name.startsWith('data-p-'))continue;const name=attribute.name.slice('data-p-'.length).replace(/-([a-z0-9])/g,(_match,char)=>char.toUpperCase());const type=paramTypes[name];const value=attribute.value;params[name]=type==='number'?Number(value):type==='boolean'?value==='true':value;}for(const ref of refs.split(/\\s+/).filter(Boolean)){const hashIndex=ref.lastIndexOf('#');if(hashIndex<=0||hashIndex===ref.length-1)throw Error('Invalid handler reference: '+ref);const mod=await importModule(ref.slice(0,hashIndex));const fn=mod[ref.slice(hashIndex+1)];if(typeof fn!=='function')throw Error('Handler export not found: '+ref);await fn(event,context);}stateHost?.setAttribute?.('fw-state',JSON.stringify(state));};const trigger=(type,target)=>{void dispatch({target,type});};for(const event of events)addEventListener(event,dispatch,{capture:true});doc.querySelectorAll('[on\\\\:load]').forEach((element)=>trigger('load',element));doc.querySelectorAll('[on\\\\:idle]').forEach((element)=>(globalThis.requestIdleCallback||setTimeout)(()=>trigger('idle',element)),);if(globalThis.IntersectionObserver){const observer=new IntersectionObserver((entries)=>entries.forEach((entry)=>{if(!entry.isIntersecting)return;observer.unobserve(entry.target);trigger('visible',entry.target);}),);doc.querySelectorAll('[on\\\\:visible]').forEach((element)=>observer.observe(element));}}`;

function readInlineJisoLoaderInstaller(): (importModule: InlineImportHandlerModule) => void {
  return (0, eval)(`(${inlineJisoLoaderInstallerSource})`) as (
    importModule: InlineImportHandlerModule,
  ) => void;
}

export function installInlineJisoLoader(importModule: InlineImportHandlerModule): void {
  readInlineJisoLoaderInstaller()(importModule);
}

export const jisoLoaderSource = `(${inlineJisoLoaderInstallerSource})((url)=>import(url));`;

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
      ...(options.morph ? { morph: options.morph } : {}),
      channel: new globalThis.BroadcastChannel('jiso:mutation-response') as BroadcastLike,
      ...(options.queryPlans ? { queryPlans: options.queryPlans } : {}),
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
      ...(options.pendingRoot ? { pendingQueries: readDeps(form.getAttribute('fw-deps')) } : {}),
      ...(options.pendingRoot ? { pendingRoot: options.pendingRoot } : {}),
      root: options.root,
      store: options.store,
      ...(options.broadcast ? { broadcast: options.broadcast } : {}),
      ...(options.idem ? { idem: options.idem() } : {}),
      islandSignalScope,
      ...(options.morph ? { morph: options.morph } : {}),
      ...(options.queryPlans ? { queryPlans: options.queryPlans } : {}),
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

export type OptimisticTransform<Input = unknown, Value = unknown> = (
  current: Value,
  input: Input,
) => Value;

export interface OptimisticChange<Input = unknown> extends MutationChangeRecord {
  input: Input;
}

export type OptimisticQueryKey<Input = unknown> =
  | ((change: OptimisticChange<Input>) => string | undefined)
  | string
  | undefined;

export interface OptimisticPlan<Input = unknown> {
  keys?: Readonly<Record<string, OptimisticQueryKey<Input>>>;
  queue?: string;
  transforms: Record<string, OptimisticTransform<Input>>;
}

export type OptimisticEntry<Input = unknown, Value = unknown> =
  | OptimisticTransform<Input, Value>
  | 'await-fragment';

type MutationKey<Definition> =
  Definition extends Form<infer Key, Record<string, JsonValue>, JsonValue> ? Key : never;

type InvalidatedQueryNames<Definition> =
  MutationKey<Definition> extends keyof InvalidationSets
    ? Extract<InvalidationSets[MutationKey<Definition>], Extract<keyof QueryRegistry, string>>
    : never;

type InvalidatedQueryValues<Definition> = {
  [QueryName in InvalidatedQueryNames<Definition>]: QueryRegistry[QueryName];
};

export type OptimisticFor<
  Definition extends Form<string, Record<string, JsonValue>, JsonValue>,
  QueryValues extends Record<string, unknown> = InvalidatedQueryValues<Definition>,
> = Omit<OptimisticPlan<FormInput<Definition>>, 'transforms'> & {
  transforms: {
    [QueryName in keyof QueryValues]: OptimisticEntry<
      FormInput<Definition>,
      QueryValues[QueryName]
    >;
  };
};

export interface PendingOptimism {
  commit(): void;
  restore(): void;
  snapshot: QuerySnapshot;
}

export interface PendingTransform<Input = unknown> {
  change: OptimisticChange<Input>;
  id: string;
  transform: OptimisticTransform<Input>;
}

export interface PagehideOptimismCleanupOptions {
  discardPendingOptimism: () => readonly string[] | void;
  root: LoaderRoot;
}

export type MutationTask<Value> = () => Promise<Value> | Value;

export class MutationQueue {
  #tails = new Map<string, Promise<unknown>>();

  run<Value>(queue: string | undefined, task: MutationTask<Value>): Promise<Value> {
    if (!queue) return Promise.resolve().then(task);

    const previous = this.#tails.get(queue) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run
      .catch(() => undefined)
      .finally(() => {
        if (this.#tails.get(queue) === tail) {
          this.#tails.delete(queue);
        }
      });

    this.#tails.set(queue, tail);
    return run;
  }

  pending(queue: string): boolean {
    return this.#tails.has(queue);
  }
}

export class OptimisticRebaser {
  #pendingByQuery = new Map<string, PendingTransform[]>();
  #serverTruthByQuery = new Map<string, unknown>();
  #store: QueryStore;

  constructor(store: QueryStore) {
    this.#store = store;
  }

  add<Input>(id: string, input: Input, plan: OptimisticPlan<Input>): void {
    this.addChange(id, optimisticChangeFromInput(input), plan);
  }

  addChange<Input>(id: string, change: OptimisticChange<Input>, plan: OptimisticPlan<Input>): void {
    for (const [queryName, transform] of Object.entries(plan.transforms)) {
      const key = optimisticQueryKey(plan, queryName, change);
      const storeKey = queryStoreKey(queryName, key);
      const pending = this.#pendingByQuery.get(storeKey) ?? [];
      if (pending.length === 0) {
        this.#serverTruthByQuery.set(storeKey, structuredClone(this.#store.get(queryName, key)));
      }
      pending.push({ change, id, transform: transform as OptimisticTransform });
      this.#pendingByQuery.set(storeKey, pending);

      this.#store.set(queryName, transform(this.#store.get(queryName, key), change.input), key);
    }
  }

  settle(id: string): void {
    for (const [queryName, pending] of this.#pendingByQuery) {
      const next = pending.filter((item) => item.id !== id);
      if (next.length === 0) {
        this.#pendingByQuery.delete(queryName);
        this.#serverTruthByQuery.delete(queryName);
      } else {
        this.#pendingByQuery.set(queryName, next);
      }
    }
  }

  settleWithoutServerTruth(id: string, queryName: string, key?: string): void {
    const storeKey = queryStoreKey(queryName, key);
    const pending = this.#pendingByQuery.get(storeKey);
    if (!pending) return;

    const nextPending = pending.filter((item) => item.id !== id);
    let next = structuredClone(this.#serverTruthByQuery.get(storeKey));

    for (const pendingTransform of nextPending) {
      next = pendingTransform.transform(next, pendingTransform.change.input);
    }

    this.#store.set(queryName, next, key);

    if (nextPending.length === 0) {
      this.#pendingByQuery.delete(storeKey);
      this.#serverTruthByQuery.delete(storeKey);
    } else {
      this.#pendingByQuery.set(storeKey, nextPending);
    }
  }

  applyServerTruth<Value>(queryName: string, value: Value, key?: string): void {
    const storeKey = queryStoreKey(queryName, key);
    let next: unknown = value;
    const pendingTransforms = this.#pendingByQuery.get(storeKey) ?? [];

    if (pendingTransforms.length > 0) {
      this.#serverTruthByQuery.set(storeKey, structuredClone(value));
    } else {
      this.#serverTruthByQuery.delete(storeKey);
    }

    for (const pending of pendingTransforms) {
      next = pending.transform(next, pending.change.input);
    }

    this.#store.set(queryName, next, key);
  }

  discardPendingOptimism(
    queryNames?: readonly string[],
    keys: Readonly<Record<string, string | undefined>> = {},
  ): string[] {
    const discarded: string[] = [];

    for (const storeKey of queryNames?.map((queryName) =>
      queryStoreKey(queryName, keys[queryName]),
    ) ?? [...this.#pendingByQuery.keys()]) {
      if (!this.#pendingByQuery.has(storeKey)) continue;

      const identity = queryIdentityFromStoreKey(storeKey);
      this.#store.set(
        identity.name,
        structuredClone(this.#serverTruthByQuery.get(storeKey)),
        identity.key,
      );
      this.#pendingByQuery.delete(storeKey);
      this.#serverTruthByQuery.delete(storeKey);
      discarded.push(identity.name);
    }

    return discarded;
  }

  pendingCount(queryName: string, key?: string): number {
    return this.#pendingByQuery.get(queryStoreKey(queryName, key))?.length ?? 0;
  }
}

export function installPagehideOptimismCleanup(
  options: PagehideOptimismCleanupOptions,
): () => void {
  // SPEC.md §8/§9.3: pagehide is bfcache-safe; unload handlers are forbidden.
  const listener = () => {
    options.discardPendingOptimism();
  };
  options.root.addEventListener('pagehide', listener);
  return () => {
    options.root.removeEventListener?.('pagehide', listener);
  };
}

export function applyOptimisticTransforms<Input>(
  store: QueryStore,
  input: Input,
  plan: OptimisticPlan<Input>,
  change: OptimisticChange<Input> = optimisticChangeFromInput(input),
): PendingOptimism {
  const queryNames = Object.keys(plan.transforms);
  const keys = resolveOptimisticKeys(plan, change);
  const snapshot = store.snapshot(queryNames, keys);

  for (const queryName of queryNames) {
    const transform = plan.transforms[queryName];
    if (!transform) continue;
    const key = keys[queryName];

    store.set(queryName, transform(store.get(queryName, key), change.input), key);
  }

  return {
    commit() {
      snapshot.clear();
    },
    restore() {
      for (const [storeKey, value] of snapshot) {
        const identity = queryIdentityFromStoreKey(storeKey);
        store.set(identity.name, value, identity.key);
      }
    },
    snapshot,
  };
}

function optimisticChangeFromInput<Input>(
  input: Input,
  change?: OptimisticChange<Input>,
): OptimisticChange<Input> {
  return change ?? { domain: 'mutation', input };
}

function resolveOptimisticKeys<Input>(
  plan: OptimisticPlan<Input>,
  change: OptimisticChange<Input>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.keys(plan.transforms).map((queryName) => [
      queryName,
      optimisticQueryKey(plan, queryName, change),
    ]),
  );
}

function optimisticQueryKey<Input>(
  plan: OptimisticPlan<Input>,
  queryName: string,
  change: OptimisticChange<Input>,
): string | undefined {
  const key = plan.keys?.[queryName];
  return typeof key === 'function' ? key(change) : key;
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

export interface AppliedMutationResponse {
  fragments: FragmentChunk[];
  queries: string[];
}

export interface AppliedDeferredStreamResponse extends AppliedMutationResponse {
  appliedFragments: string[];
  chunks: Array<AppliedMutationResponse & { appliedFragments: string[] }>;
}

export interface MutationChangeRecord {
  domain: string;
  keys?: readonly string[];
}

export interface QueryBindingElement {
  attributes?: unknown;
  getAttribute(name: string): string | null;
  removeAttribute?: (name: string) => void;
  setAttribute?: (name: string, value: string) => void;
  textContent?: string | null;
  value?: string;
}

export interface QueryBindingRoot {
  querySelectorAll(selector: string): Iterable<QueryBindingElement>;
}

export interface TemplateStampItem {
  html: string;
  index: number;
  key: string;
  value: unknown;
}

export interface TemplateStampHost extends QueryBindingElement {
  reconcileTemplateStamp(items: readonly TemplateStampItem[]): void;
}

export interface CompiledQueryDerive {
  name: string;
  select(value: unknown, root: QueryBindingRoot): unknown;
  selector?: string;
}

export interface CompiledQueryStamp {
  attr: string;
  select(value: unknown, root: QueryBindingRoot): unknown;
  selector: string;
}

export interface CompiledQueryTemplateStamp {
  key: string | ((item: unknown, index: number) => string | number);
  list: string;
  render(item: unknown, index: number): string;
  selector: string;
}

export interface CompiledQueryUpdatePlan {
  bindings?: boolean;
  derives?: readonly CompiledQueryDerive[];
  stamps?: readonly CompiledQueryStamp[];
  templateStamps?: readonly CompiledQueryTemplateStamp[];
}

export interface AppliedCompiledQueryUpdatePlan {
  bindings: string[];
  derives: string[];
  stamps: string[];
  templateStamps: string[];
}

export type CompiledQueryUpdatePlans = Readonly<
  Record<string, CompiledQueryUpdatePlan | undefined>
>;

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
        root: options.root,
        store: options.store,
        ...(options.broadcast ? { broadcast: options.broadcast } : {}),
        ...(submitOptions.idem ? { idem: submitOptions.idem } : {}),
        ...(options.morph ? { morph: options.morph } : {}),
        ...(options.queryPlans ? { queryPlans: options.queryPlans } : {}),
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
  return applyFragmentQueryBody(body, (name, value, key) => {
    store.set(name, value, key);
  });
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
    (name, value, key) => {
      const query = { ...(key === undefined ? {} : { key }), name, value };
      const queryResult = options.applyQuery?.(query);
      const planValue = queryResult ? queryResult.value : value;
      if (!queryResult) {
        options.store.set(name, value, key);
      }
      applyCompiledQueryUpdatePlanIfSupported(
        options.root,
        name,
        planValue,
        options.queryPlans?.[name],
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
    ...(hooks.applyQuery ? { applyQuery: hooks.applyQuery } : {}),
    ...(hooks.beforeApplyQueries ? { beforeApplyQueries: hooks.beforeApplyQueries } : {}),
    body,
    ...(options.islandSignalScope ? { islandSignalScope: options.islandSignalScope } : {}),
    ...(options.morph ? { morph: options.morph } : {}),
    ...(options.onError ? { onError: options.onError } : {}),
    ...(options.queryPlans ? { queryPlans: options.queryPlans } : {}),
    root: options.root,
    store: options.store,
  });
}

export function applyQueryBindings(
  root: QueryBindingRoot,
  queryName: string,
  value: unknown,
): string[] {
  const applied: string[] = [];

  for (const element of root.querySelectorAll('[data-bind]')) {
    const path = element.getAttribute('data-bind');
    if (!path?.startsWith(`${queryName}.`)) continue;

    const boundValue = valueAtPath(value, path.slice(queryName.length + 1));
    const rendered = formatBoundValue(boundValue);

    if (element.value !== undefined) {
      element.value = rendered;
    } else {
      element.textContent = rendered;
    }
    applied.push(path);
  }

  for (const element of queryAllElements(root)) {
    for (const attribute of bindingAttributes(element)) {
      const boundAttribute = attribute.name.slice('data-bind:'.length);
      const path = attribute.value;
      if (!path.startsWith(`${queryName}.`)) continue;

      const boundValue = valueAtPath(value, path.slice(queryName.length + 1));
      if (boundValue === undefined || boundValue === null) {
        element.removeAttribute?.(boundAttribute);
      } else {
        element.setAttribute?.(boundAttribute, formatBoundValue(boundValue));
      }
      applied.push(path);
    }
  }

  return applied;
}

export function applyCompiledQueryUpdatePlan(
  root: QueryBindingRoot,
  queryName: string,
  value: unknown,
  plan: CompiledQueryUpdatePlan = {},
): AppliedCompiledQueryUpdatePlan {
  const applied: AppliedCompiledQueryUpdatePlan = {
    bindings: plan.bindings === false ? [] : applyQueryBindings(root, queryName, value),
    derives: [],
    stamps: [],
    templateStamps: [],
  };

  for (const derive of plan.derives ?? []) {
    const selector = derive.selector ?? `[data-derive="${queryName}.${derive.name}"]`;
    const rendered = formatBoundValue(derive.select(value, root));

    for (const element of root.querySelectorAll(selector)) {
      writeQueryPlanElement(element, rendered);
      applied.derives.push(derive.name);
    }
  }

  for (const stamp of plan.stamps ?? []) {
    const selected = stamp.select(value, root);

    for (const element of root.querySelectorAll(stamp.selector)) {
      if (selected === undefined || selected === null) {
        element.removeAttribute?.(stamp.attr);
      } else {
        element.setAttribute?.(stamp.attr, formatBoundValue(selected));
      }
      applied.stamps.push(stamp.attr);
    }
  }

  for (const stamp of plan.templateStamps ?? []) {
    const list = valueAtPath(value, stamp.list);
    if (!Array.isArray(list)) continue;

    const items = list.map((item, index) => ({
      html: stamp.render(item, index),
      index,
      key: String(readTemplateStampKey(stamp, item, index)),
      value: item,
    }));

    for (const element of root.querySelectorAll(stamp.selector)) {
      if (!isTemplateStampHost(element)) continue;
      element.reconcileTemplateStamp(items);
      applied.templateStamps.push(stamp.selector);
    }
  }

  return applied;
}

function isTemplateStampHost(element: QueryBindingElement): element is TemplateStampHost {
  return (
    'reconcileTemplateStamp' in element && typeof element.reconcileTemplateStamp === 'function'
  );
}

function readTemplateStampKey(
  stamp: CompiledQueryTemplateStamp,
  item: unknown,
  index: number,
): string | number {
  if (typeof stamp.key === 'function') return stamp.key(item, index);

  const key = valueAtPath(item, stamp.key);
  return typeof key === 'string' || typeof key === 'number' || typeof key === 'bigint'
    ? key.toString()
    : index;
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
        ...(options.islandSignalScope ? { islandSignalScope: options.islandSignalScope } : {}),
        ...(options.queryPlans ? { queryPlans: options.queryPlans } : {}),
        ...(options.onError ? { onError: options.onError } : {}),
        root: options.root,
        store: options.store,
        ...(options.morph ? { morph: options.morph } : {}),
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
        ...(options.morph ? { morph: options.morph } : {}),
        ...(options.queryPlans ? { queryPlans: options.queryPlans } : {}),
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

function applyFragmentQueryBody(
  body: string,
  applyQuery: (name: string, value: unknown, key: string | undefined) => void,
  onError?: (error: unknown) => void,
  beforeApplyQueries?: (queries: readonly QueryChunk[]) => void,
): AppliedMutationResponse {
  const queryChunks = readQueryChunks(body, onError);
  beforeApplyQueries?.(queryChunks);

  for (const query of queryChunks) {
    applyQuery(query.name, query.value, query.key);
  }

  return {
    fragments: readFragmentChunks(body, onError),
    queries: queryChunks.map((query) => query.name),
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

function supportsQueryBindings(root: MorphRoot): root is MorphRoot & QueryBindingRoot {
  return typeof (root as Partial<QueryBindingRoot>).querySelectorAll === 'function';
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    const key = segment.endsWith('?') ? segment.slice(0, -1) : segment;
    if (typeof current !== 'object' || current === null) return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function queryAllElements(root: QueryBindingRoot): QueryBindingElement[] {
  try {
    return Array.from(root.querySelectorAll('*'));
  } catch {
    return [];
  }
}

function bindingAttributes(element: QueryBindingElement): Array<{ name: string; value: string }> {
  if (!element.attributes) return [];
  const attributes = element.attributes;

  if (
    typeof attributes === 'object' &&
    attributes !== null &&
    'length' in attributes &&
    typeof (attributes as { length: unknown }).length === 'number'
  ) {
    return Array.from(
      { length: (attributes as { length: number }).length },
      (_, index) => (attributes as ArrayLike<{ name: string; value: string }>)[index],
    )
      .filter((attribute): attribute is { name: string; value: string } => Boolean(attribute))
      .filter((attribute) => attribute.name.startsWith('data-bind:') && attribute.value !== '');
  }

  if (typeof attributes === 'object' && attributes !== null) {
    return Object.entries(attributes)
      .map(([name, value]) => ({ name, value: String(value) }))
      .filter((attribute) => attribute.name.startsWith('data-bind:') && attribute.value !== '');
  }

  return [];
}

function writeQueryPlanElement(element: QueryBindingElement, rendered: string): void {
  if (element.value !== undefined) {
    element.value = rendered;
  } else {
    element.textContent = rendered;
  }
}

function formatBoundValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return '';
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
