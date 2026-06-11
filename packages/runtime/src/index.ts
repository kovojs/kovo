import { diagnosticDefinitions } from '@jiso/core';
export type { DiagnosticCode } from '@jiso/core';
import type {
  EventDefinition,
  Form,
  FormFailure,
  FormInput,
  InvalidationSets,
  JsonValue,
  QueryRegistry,
} from '@jiso/core';

export type ImportHandlerModule = (url: string) => Promise<Record<string, unknown>>;

export interface HandlerContext<State = unknown, Params = Record<string, string>> {
  params: Params;
  signal: AbortSignal;
  state: State;
}

export type ClientHandler<State = unknown, Params = Record<string, string>> = (
  event: Event,
  ctx: HandlerContext<State, Params>,
) => void | Promise<void>;

export function handler<State = unknown, Params = Record<string, string>>(
  fn: ClientHandler<State, Params>,
): ClientHandler<State, Params> {
  return fn;
}

export type EventPayloadMap<Definitions extends readonly EventDefinition<string, JsonValue>[]> = {
  [Definition in Definitions[number] as Definition['name']]: Definition extends EventDefinition<
    string,
    infer Payload
  >
    ? Payload
    : never;
};

export interface TypedEvent<Name extends string = string, Payload = unknown> {
  name: Name;
  payload: Payload;
}

export type EventListener<Payload> = (event: TypedEvent<string, Payload>) => void | Promise<void>;

export interface EventSubscription {
  off(): void;
}

export interface TypedEventBus<EventMap extends Record<string, unknown>> {
  emit<Name extends Extract<keyof EventMap, string>>(name: Name, payload: EventMap[Name]): void;
  events: readonly Extract<keyof EventMap, string>[];
  on<Name extends Extract<keyof EventMap, string>>(
    name: Name,
    listener: EventListener<EventMap[Name]>,
  ): EventSubscription;
}

export interface EventBusOptions {
  onError?: (error: unknown, context: RuntimeErrorContext) => void;
  queryDataKeys?: readonly string[];
}

export interface RuntimeErrorContext {
  event?: DelegatedEvent | TypedEvent<string, unknown>;
  phase:
    | 'delegated-event'
    | 'event-listener'
    | 'execution-trigger'
    | 'enhanced-mutation'
    | 'query-hydration';
}

export function createEventBus<
  const Definitions extends readonly EventDefinition<string, JsonValue>[],
>(
  definitions: Definitions,
  options: EventBusOptions = {},
): TypedEventBus<EventPayloadMap<Definitions>> {
  const events = definitions.map((definition) => definition.name) as Extract<
    keyof EventPayloadMap<Definitions>,
    string
  >[];
  const allowed = new Set<string>(events);
  const queryDataKeys = new Set(options.queryDataKeys ?? []);
  const eventServerFactKeys = new Map(
    definitions.map((definition) => [definition.name, definition.serverFactKeys ?? []] as const),
  );
  const listeners = new Map<string, Set<EventListener<unknown>>>();

  return {
    emit(name, payload) {
      assertKnownEvent(allowed, name);
      assertPayloadDoesNotCarryQueryData(name, payload, eventServerFactKeys, queryDataKeys);

      const event = { name, payload };
      for (const listener of listeners.get(name) ?? []) {
        void Promise.resolve(listener(event)).catch((error) => {
          options.onError?.(error, { event, phase: 'event-listener' });
        });
      }
    },
    events,
    on(name, listener) {
      assertKnownEvent(allowed, name);

      const existing = listeners.get(name) ?? new Set<EventListener<unknown>>();
      existing.add(listener as EventListener<unknown>);
      listeners.set(name, existing);

      return {
        off() {
          existing.delete(listener as EventListener<unknown>);
        },
      };
    },
  };
}

function assertKnownEvent(allowed: ReadonlySet<string>, name: string): void {
  if (!allowed.has(name)) {
    throw new Error(`Event is not declared in the registry: ${name}`);
  }
}

function assertPayloadDoesNotCarryQueryData(
  name: string,
  payload: unknown,
  eventServerFactKeys: ReadonlyMap<string, readonly string[]>,
  queryDataKeys: ReadonlySet<string>,
): void {
  if (queryDataKeys.size === 0) return;

  const declaredKeys = eventServerFactKeys.get(name) ?? [];
  const payloadKeys = typeof payload === 'object' && payload !== null ? Object.keys(payload) : [];
  const overlap = [...new Set([...declaredKeys, ...payloadKeys])].find((key) =>
    queryDataKeys.has(key),
  );
  if (!overlap) return;

  throw new Error(`${diagnosticDefinitions.FW320.message} event ${name} carries ${overlap}.`);
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

export interface DelegatedEvent {
  preventDefault?: () => void;
  type: string;
  target: EventTargetLike | null;
}

export interface EventTargetLike {
  closest?: (selector: string) => EventElementLike | null;
}

export interface EventElementLike {
  closest?: (selector: string) => EventElementLike | null;
  getAttribute(name: string): string | null;
  querySelectorAll?: (selector: string) => Iterable<UploadProgressElementLike>;
  setAttribute?: (name: string, value: string) => void;
  attributes?: Iterable<{ name: string; value: string }>;
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

export interface UploadProgressElementLike {
  removeAttribute?: (name: string) => void;
  setAttribute(name: string, value: string): void;
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

export type IslandSignalScope = object;

const defaultDelegatedEvents = ['click', 'submit', 'input', 'change'] as const;
const defaultIslandSignalScope: IslandSignalScope = {};
const islandSignalControllers = new WeakMap<IslandSignalScope, Map<string, AbortController>>();

export const jisoLoaderSource = `(()=>{const E=["click","submit","input","change"],d=document,H=t=>t.closest?.("[fw-state]")||t,S=t=>{try{return JSON.parse(H(t)?.getAttribute("fw-state")||"{}")}catch{return {}}};let n=0;const I=()=>crypto.randomUUID?.()||"idem_"+Date.now().toString(36)+"_"+n++,T=()=>[...d.querySelectorAll("[fw-deps]")].map(e=>{const a=(e.getAttribute("fw-deps")||"").trim().replace(/[\\\\s,]+/g," "),t=e.getAttribute("fw-fragment-target")||e.id;return t&&(a?t+"="+a:t)}).filter(Boolean),P=async e=>{if(e.type=="submit"){const f=e.target.closest("form[enhance],form[data-enhance],form[data-mutation]");if(f){e.preventDefault();fetch(f.action,{body:new FormData(f),headers:{Accept:"text/vnd.jiso.fragment+html","FW-Fragment":"true","FW-Idem":I(),"FW-Targets":T().join("; ")},keepalive:!0,method:(f.method||"post").toUpperCase()}).then(r=>r.text()).then(b=>{const p=new DOMParser().parseFromString(b,"text/html");p.querySelectorAll("fw-query").forEach(m=>dispatchEvent(new CustomEvent("jiso:query",{detail:{body:m.textContent,name:m.getAttribute("name")}})));p.querySelectorAll("fw-fragment").forEach(m=>{const t=m.getAttribute("target"),l=t&&(d.getElementById(t)||d.querySelector('[fw-fragment-target="'+t+'"]'));l&&(m.hasAttribute("append")?l.insertAdjacentHTML("beforeend",m.innerHTML):l.innerHTML=m.innerHTML)})}).catch(()=>f.submit?f.submit():(f.setAttribute?.("data-error-code","NETWORK_ERROR"),f.setAttribute?.("fw-error","")));return}}const t=e.target.closest("[on\\\\:"+e.type+"]"),r=t?.getAttribute("on:"+e.type);if(!r)return;const p={},s=S(t),h=H(t),c={params:p,state:s,signal:new AbortController().signal};for(const a of t.attributes||[])a.name.startsWith("data-p-")&&(p[a.name.slice(7).replace(/-([a-z0-9])/g,(_,c)=>c.toUpperCase())]=a.value);for(const x of r.split(/\\s+/)){const i=x.lastIndexOf("#");if(i>0){const m=await import(x.slice(0,i));await m[x.slice(i+1)]?.(e,c)}}h?.setAttribute?.("fw-state",JSON.stringify(s))},D=(t,e)=>P({type:t,target:e});for(const e of E)addEventListener(e,P,{capture:!0});d.querySelectorAll("[on\\\\:load]").forEach(e=>D("load",e));d.querySelectorAll("[on\\\\:idle]").forEach(e=>(globalThis.requestIdleCallback||setTimeout)(()=>D("idle",e)));if(globalThis.IntersectionObserver){const o=new IntersectionObserver(a=>a.map(v=>v.isIntersecting&&(o.unobserve(v.target),D("visible",v.target))));d.querySelectorAll("[on\\\\:visible]").forEach(e=>o.observe(e))}})();`;

export function installJisoLoader(options: JisoLoaderOptions): JisoLoader {
  const events = options.events ?? defaultDelegatedEvents;
  const islandSignalScope = createIslandSignalScope();
  const enhancedMutationSetup = options.enhancedMutations
    ? withDefaultMutationBroadcast(options.enhancedMutations)
    : undefined;
  const enhancedMutations = enhancedMutationSetup?.options;
  const disposers: Array<() => void> = [];
  let hydratedQueries: readonly string[] = [];

  if (options.queryStore && options.root.querySelectorAll) {
    hydratedQueries = hydrateQueryScripts(
      options.queryStore,
      options.root.querySelectorAll('script[fw-query]') as Iterable<QueryScriptLike>,
      {
        onError(error) {
          options.onError?.(error, { phase: 'query-hydration' });
        },
      },
    );
  }

  for (const eventName of events) {
    addLoaderListener(
      options.root,
      eventName,
      async (event) => {
        const enhancedSubmit = isEnhancedSubmitEvent(event, enhancedMutations);
        try {
          if (await dispatchEnhancedFormSubmit(event, enhancedMutations, islandSignalScope)) return;
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
      filterRefetchEligibleQueries(hydratedQueries, options.refetchOnFocusOptOut ?? []);
    let refetchInFlight: Promise<void> | undefined;
    const refetchOnFocus = async () => {
      const queries = refetchEligibleQueries();
      await options.refetchOnFocus?.(queries);
      if (options.queryRefetch && options.queryStore) {
        await refetchQueries({
          ...options.queryRefetch,
          queries,
          queryStore: options.queryStore,
        });
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
    addLoaderListener(focusTargetFor(options), 'focus', refetchOnce, disposers);
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

function focusTargetFor(options: JisoLoaderOptions): LoaderLifecycleTarget {
  if (options.focusTarget) return options.focusTarget;
  if (typeof globalThis.addEventListener === 'function') {
    return globalThis as unknown as LoaderLifecycleTarget;
  }
  return options.root;
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

export async function dispatchEnhancedFormSubmit(
  event: DelegatedEvent,
  options: EnhancedMutationLoaderOptions | undefined,
  islandSignalScope: IslandSignalScope = defaultIslandSignalScope,
): Promise<boolean> {
  if (!options || event.type !== 'submit') return false;

  const form = event.target?.closest?.('form[enhance],form[data-enhance],form[data-mutation]') as
    | EnhancedFormElementLike
    | null
    | undefined;
  if (!form || !isEnhancedForm(form)) return false;

  event.preventDefault?.();
  try {
    await submitEnhancedMutation({
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
  } catch (error) {
    if (!options.onError) {
      fallbackEnhancedMutationSubmit(form);
    }
    if (!options.onError) throw error;
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

export async function dispatchDelegatedEvent(
  event: DelegatedEvent,
  importModule: ImportHandlerModule,
  islandSignalScope: IslandSignalScope = defaultIslandSignalScope,
): Promise<void> {
  const element = event.target?.closest?.(`[on\\:${event.type}]`);
  if (!element) return;

  const stateHost = findElementStateHost(element) ?? element;
  const previous = delegatedStateQueues.get(stateHost) ?? Promise.resolve();
  const dispatch = previous
    .catch(() => undefined)
    .then(() =>
      dispatchDelegatedEventForElement(event, importModule, element, stateHost, islandSignalScope),
    );
  const queued = dispatch
    .catch(() => undefined)
    .finally(() => {
      if (delegatedStateQueues.get(stateHost) === queued) {
        delegatedStateQueues.delete(stateHost);
      }
    });
  delegatedStateQueues.set(stateHost, queued);

  await dispatch;
}

const delegatedStateQueues = new WeakMap<EventElementLike, Promise<void>>();
let activeIslandSignalScope: IslandSignalScope | undefined;

async function dispatchDelegatedEventForElement(
  event: DelegatedEvent,
  importModule: ImportHandlerModule,
  element: EventElementLike,
  stateHost: EventElementLike,
  islandSignalScope: IslandSignalScope,
): Promise<void> {
  const state = readElementState(element);
  const context: HandlerContext = withIslandSignalScope(islandSignalScope, () => ({
    params: readElementParams(element),
    signal: createHandlerSignal(element),
    state,
  }));

  try {
    for (const ref of parseHandlerReferences(element.getAttribute(`on:${event.type}`))) {
      const { exportName, url } = parseHandlerReference(ref);
      const mod = await importModule(url);
      const fn = mod[exportName];

      if (typeof fn !== 'function') {
        throw new Error(`Handler export not found: ${ref}`);
      }

      await (fn as ClientHandler)(event as Event, context);
    }
  } finally {
    writeElementState(stateHost, state);
  }
}

export function parseHandlerReferences(refs: string | null): string[] {
  return refs?.split(/\s+/).filter(Boolean) ?? [];
}

export function parseHandlerReference(ref: string): { exportName: string; url: string } {
  const hashIndex = ref.lastIndexOf('#');
  if (hashIndex <= 0 || hashIndex === ref.length - 1) {
    throw new Error(`Invalid handler reference: ${ref}`);
  }

  return {
    exportName: ref.slice(hashIndex + 1),
    url: ref.slice(0, hashIndex),
  };
}

export function readElementParams(element: EventElementLike): Record<string, string> {
  const params: Record<string, string> = {};

  for (const attribute of element.attributes ?? []) {
    if (!attribute.name.startsWith('data-p-')) continue;

    params[camelCase(attribute.name.slice('data-p-'.length))] = attribute.value;
  }

  return params;
}

export function readElementState(element: EventElementLike): JsonValue {
  const stateHost = findElementStateHost(element);
  const state = stateHost?.getAttribute('fw-state');
  if (!state) return {};

  try {
    return JSON.parse(state) as JsonValue;
  } catch {
    return {};
  }
}

export function writeElementState(element: EventElementLike, state: JsonValue): void {
  element.setAttribute?.('fw-state', JSON.stringify(state));
}

function findElementStateHost(element: EventElementLike): EventElementLike | null {
  return (
    element.closest?.('[fw-state]') ?? (element.getAttribute('fw-state') === null ? null : element)
  );
}

function createIslandSignalScope(): IslandSignalScope {
  return {};
}

function withIslandSignalScope<Value>(scope: IslandSignalScope, fn: () => Value): Value {
  const previous = activeIslandSignalScope;
  activeIslandSignalScope = scope;
  try {
    return fn();
  } finally {
    activeIslandSignalScope = previous;
  }
}

function createHandlerSignal(element: EventElementLike): AbortSignal {
  const key = islandSignalKey(element);
  if (!key) return new AbortController().signal;

  const scope = activeIslandSignalScope ?? defaultIslandSignalScope;
  const controllers = islandSignalControllersFor(scope);
  const existing = controllers.get(key);
  if (existing && !existing.signal.aborted) return existing.signal;

  const controller = new AbortController();
  controllers.set(key, controller);
  return controller.signal;
}

function islandSignalKey(element: EventElementLike): string | null {
  const island = element.closest?.('[fw-c]') ?? element;
  return islandSignalIdentity(
    island.getAttribute('fw-c'),
    island.getAttribute('fw-key'),
    island.getAttribute('id'),
  );
}

export function abortRemovedIslandSignals(
  currentHtml: string,
  nextHtml: string,
  scope: IslandSignalScope = defaultIslandSignalScope,
): string[] {
  const next = fwComponentIds(nextHtml);
  const removed = [...fwComponentIds(currentHtml)].filter((id) => !next.has(id));
  const controllers = islandSignalControllersFor(activeIslandSignalScope ?? scope);

  for (const id of removed) {
    const controller = controllers.get(id);
    if (!controller) continue;

    controller.abort();
    controllers.delete(id);
  }

  return removed;
}

function islandSignalControllersFor(scope: IslandSignalScope): Map<string, AbortController> {
  const existing = islandSignalControllers.get(scope);
  if (existing) return existing;

  const controllers = new Map<string, AbortController>();
  islandSignalControllers.set(scope, controllers);
  return controllers;
}

function abortIslandSignalScope(scope: IslandSignalScope): void {
  const controllers = islandSignalControllers.get(scope);
  if (!controllers) return;

  for (const controller of controllers.values()) {
    controller.abort();
  }
  controllers.clear();
  islandSignalControllers.delete(scope);
}

function fwComponentIds(html: string): Set<string> {
  return new Set(
    [...html.matchAll(/<[^>]*\bfw-c\s*=\s*(["'])(?<component>[^"']+)\1[^>]*>/g)].flatMap(
      (match) => {
        const tag = match[0];
        const component = match.groups?.component ?? null;
        const key = readAttribute(tag, 'fw-key');
        const id = readAttribute(tag, 'id');
        const identity = islandSignalIdentity(component, key, id);
        return identity ? [identity] : [];
      },
    ),
  );
}

function islandSignalIdentity(
  component: string | null,
  key: string | null,
  id: string | null,
): string | null {
  if (!component) return null;
  const instance = key ?? id;
  return instance ? [component, instance].join('\0') : component;
}

function camelCase(value: string): string {
  return value.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

export type QueryUpdatePlan<Value = unknown> = (value: Value) => void;

export interface QueryStore {
  get<Value = unknown>(name: string, key?: string): Value | undefined;
  hydrate(script: QueryScriptLike): void;
  snapshot(
    names: readonly string[],
    keys?: Readonly<Record<string, string | undefined>>,
  ): QuerySnapshot;
  set<Value = unknown>(name: string, value: Value, key?: string): void;
  subscribe<Value = unknown>(name: string, plan: QueryUpdatePlan<Value>, key?: string): () => void;
}

export type QuerySnapshot = Map<string, unknown>;

export interface QueryScriptLike {
  getAttribute(name: string): string | null;
  textContent: string | null;
}

export function createQueryStore(): QueryStore {
  const values = new Map<string, unknown>();
  const plans = new Map<string, Set<QueryUpdatePlan>>();

  return {
    get<Value = unknown>(name: string, key?: string): Value | undefined {
      return values.get(queryStoreKey(name, key)) as Value | undefined;
    },
    hydrate(script: QueryScriptLike): void {
      const name = script.getAttribute('fw-query');
      if (!name) return;

      const parsed = parseJsonValue(script.textContent ?? 'null');
      if (!parsed.ok) return;

      this.set(name, parsed.value, script.getAttribute('key') ?? undefined);
    },
    snapshot(
      names: readonly string[],
      keys: Readonly<Record<string, string | undefined>> = {},
    ): QuerySnapshot {
      const snapshot = new Map<string, unknown>();

      for (const name of names) {
        const storeKey = queryStoreKey(name, keys[name]);
        snapshot.set(storeKey, structuredClone(values.get(storeKey)));
      }

      return snapshot;
    },
    set<Value = unknown>(name: string, value: Value, key?: string): void {
      const storeKey = queryStoreKey(name, key);
      values.set(storeKey, value);

      for (const plan of plans.get(storeKey) ?? []) {
        plan(value);
      }
    },
    subscribe<Value = unknown>(
      name: string,
      plan: QueryUpdatePlan<Value>,
      key?: string,
    ): () => void {
      const storeKey = queryStoreKey(name, key);
      const existing = plans.get(storeKey) ?? new Set<QueryUpdatePlan>();
      existing.add(plan as QueryUpdatePlan);
      plans.set(storeKey, existing);

      if (values.has(storeKey)) {
        plan(values.get(storeKey) as Value);
      }

      return () => {
        existing.delete(plan as QueryUpdatePlan);
      };
    },
  };
}

function queryStoreKey(name: string, key: string | undefined): string {
  return key === undefined ? name : `${name}\0${key}`;
}

function queryIdentityFromStoreKey(storeKey: string): { key?: string; name: string } {
  const separator = storeKey.indexOf('\0');
  if (separator === -1) return { name: storeKey };

  return {
    key: storeKey.slice(separator + 1),
    name: storeKey.slice(0, separator),
  };
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

export function hydrateQueryScripts(
  store: QueryStore,
  scripts: Iterable<QueryScriptLike>,
  options: { onError?: (error: unknown) => void } = {},
): readonly string[] {
  const hydrated: string[] = [];

  for (const script of scripts) {
    const name = script.getAttribute('fw-query');
    if (name) {
      const parsed = parseJsonValue(script.textContent ?? 'null');
      if (parsed.ok) {
        store.set(name, parsed.value, script.getAttribute('key') ?? undefined);
      } else {
        options.onError?.(malformedJsonError('fw-query hydration', parsed.error));
      }
    }
    if (name) {
      hydrated.push(name);
    }
  }

  return hydrated;
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

export interface FragmentChunk {
  html: string;
  mode?: 'append' | 'replace';
  target: string;
}

export interface MorphTarget {
  appendHtml?(html: string): void;
  readHtml?(): string;
  replaceWithHtml(html: string): void;
}

export interface MorphRoot {
  findFragmentTarget(target: string): MorphTarget | null;
}

export type MorphFragment = (target: MorphTarget, html: string) => void;

export interface QueryBindingElement {
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

export type StructuralMorphKey = string | number;

export interface StructuralMorphBrowserState {
  focused?: boolean;
  islandState?: unknown;
  scroll?: { left: number; top: number };
  selection?: { direction?: 'backward' | 'forward' | 'none'; end: number; start: number };
}

export interface StructuralMorphNode {
  browserState?: StructuralMorphBrowserState;
  children?: StructuralMorphNode[];
  key?: StructuralMorphKey | null;
  props?: Record<string, unknown>;
  text?: string;
  type: string;
}

/**
 * Browser-free structural morph contract from SPEC.md §11.4 and §13.2:
 * the current tree is rewritten to the next tree shape while matching
 * sibling keys keep their object identity and browser-owned state across
 * insertion and reorder.
 */
export function morphStructuralTree(
  current: StructuralMorphNode,
  next: StructuralMorphNode,
): StructuralMorphNode {
  current.type = next.type;
  copyOptionalStructuralFields(current, next);

  if (next.children === undefined) {
    delete current.children;
    return current;
  }

  current.children = morphStructuralChildren(current.children ?? [], next.children);
  return current;
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
  const errorMatch = /<fw-error\b[^>]*>(?<json>[\s\S]*?)<\/fw-error>/.exec(body);
  if (errorMatch?.groups?.json) return parseJsonOrUnknown(unescapeHtml(errorMatch.groups.json));

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

function parseJsonValue(
  raw: string,
): { ok: true; value: JsonValue } | { error: unknown; ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) as JsonValue };
  } catch (error) {
    return { error, ok: false };
  }
}

function malformedJsonError(context: string, cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new Error(`Malformed JSON in ${context}: ${message}`, { cause });
}

function parseDeclaredFailureOutput(body: string): JsonValue | null {
  for (const match of body.matchAll(/<output\b(?<attrs>[^>]*)>(?<content>[\s\S]*?)<\/output>/g)) {
    const code = readAttribute(match.groups?.attrs ?? '', 'data-error-code');
    if (!code) continue;

    return {
      code,
      data: parseOutputPayload(match.groups?.content ?? ''),
    };
  }

  return null;
}

function parseValidationFailureOutput(body: string): JsonValue | null {
  const fields: Record<string, string> = {};

  for (const match of body.matchAll(/<output\b(?<attrs>[^>]*)>(?<content>[\s\S]*?)<\/output>/g)) {
    const path = readAttribute(match.groups?.attrs ?? '', 'data-error-path');
    if (!path) continue;

    fields[path] = unescapeHtml(match.groups?.content ?? '').trim();
  }

  return Object.keys(fields).length > 0 ? { code: 'VALIDATION', fields } : null;
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

export function applyDeferredChunk(store: QueryStore, body: string): AppliedMutationResponse {
  return applyMutationResponse(store, body);
}

export function applyFragments(
  root: MorphRoot,
  fragments: readonly FragmentChunk[],
  morph: MorphFragment = replaceFragment,
  islandSignalScope: IslandSignalScope = defaultIslandSignalScope,
): string[] {
  const applied: string[] = [];

  for (const fragment of fragments) {
    const target = root.findFragmentTarget(fragment.target);
    if (!target) continue;

    if (fragment.mode === 'append') {
      appendFragment(target, fragment.html, morph);
    } else {
      withIslandSignalScope(islandSignalScope, () => {
        abortRemovedIslandSignals(target.readHtml?.() ?? '', fragment.html);
      });
      morph(target, fragment.html);
    }
    applied.push(fragment.target);
  }

  return applied;
}

export function applyMutationResponseToDom(options: {
  body: string;
  islandSignalScope?: IslandSignalScope;
  morph?: MorphFragment;
  onError?: (error: unknown) => void;
  queryPlans?: CompiledQueryUpdatePlans;
  root: MorphRoot;
  store: QueryStore;
}): AppliedMutationResponse & { appliedFragments: string[] } {
  const applied = applyFragmentQueryBody(
    options.body,
    (name, value, key) => {
      options.store.set(name, value, key);
      applyCompiledQueryUpdatePlanIfSupported(
        options.root,
        name,
        value,
        options.queryPlans?.[name],
      );
    },
    options.onError,
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

export function applyDeferredChunkToDom(options: {
  body: string;
  islandSignalScope?: IslandSignalScope;
  morph?: MorphFragment;
  onError?: (error: unknown) => void;
  queryPlans?: CompiledQueryUpdatePlans;
  root: MorphRoot;
  store: QueryStore;
}): AppliedMutationResponse & { appliedFragments: string[] } {
  return applyMutationResponseToDom(options);
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
    const rendered = formatBoundValue(stamp.select(value, root));

    for (const element of root.querySelectorAll(stamp.selector)) {
      element.setAttribute?.(stamp.attr, rendered);
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
    const applied = applyMutationResponseToDom({
      body,
      ...(options.queryPlans ? { queryPlans: options.queryPlans } : {}),
      root: options.root,
      store: options.store,
      ...(options.morph ? { morph: options.morph } : {}),
      ...(options.islandSignalScope ? { islandSignalScope: options.islandSignalScope } : {}),
      ...(options.onError
        ? {
            onError(error) {
              options.onError?.(error);
            },
          }
        : {}),
    });
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

      const applied = applyMutationResponseToDom({
        body,
        ...(options.queryPlans ? { queryPlans: options.queryPlans } : {}),
        ...(options.onError ? { onError: options.onError } : {}),
        root: options.root,
        store: options.store,
        ...(options.morph ? { morph: options.morph } : {}),
      });

      return {
        ...applied,
        changes,
        idem,
        targets,
      };
    }

    const queryChunks = readQueryChunks(body, options.onError);
    const fragments = readFragmentChunks(body);
    const uncoveredQueries = uncoveredOptimisticQueries(queryChunks, queryNames, optimisticKeys);
    for (const queryName of uncoveredQueries) {
      options.rebaser.settleWithoutServerTruth(idem, queryName, optimisticKeys[queryName]);
      options.onError?.(uncoveredOptimisticQueryError(queryName, optimisticKeys[queryName]));
    }
    options.rebaser.settle(idem);
    for (const query of queryChunks) {
      options.rebaser.applyServerTruth(query.name, query.value, query.key);
      applyCompiledQueryUpdatePlanIfSupported(
        options.root,
        query.name,
        query.value,
        options.queryPlans?.[query.name],
      );
    }
    const applied = {
      appliedFragments: applyFragments(options.root, fragments, options.morph),
      fragments,
      queries: queryChunks.map((query) => query.name),
    };
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
): AppliedMutationResponse {
  const queryChunks = readQueryChunks(body, onError);

  for (const query of queryChunks) {
    applyQuery(query.name, query.value, query.key);
  }

  return {
    fragments: readFragmentChunks(body),
    queries: queryChunks.map((query) => query.name),
  };
}

function deferredStreamChunks(body: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  const chunks: string[] = [];
  let cursor = 0;

  while (true) {
    const markerStart = body.indexOf(marker, cursor);
    if (markerStart === -1) return chunks;

    const chunkStart = body.indexOf('\n', markerStart);
    if (chunkStart === -1) return chunks;
    if (body.startsWith(`${marker}--`, markerStart)) return chunks;

    const nextMarkerStart = body.indexOf(`\n${marker}`, chunkStart + 1);
    const chunk =
      nextMarkerStart === -1
        ? body.slice(chunkStart + 1)
        : body.slice(chunkStart + 1, nextMarkerStart);
    if (/<fw-(?:query|fragment)\b/.test(chunk)) {
      chunks.push(chunk);
    }
    cursor = nextMarkerStart === -1 ? body.length : nextMarkerStart + 1;
  }
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
  const changes = readMutationChangeHeader(response);
  reportMalformedMutationChangeHeader(response, options.onError);

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
    if (typeof current !== 'object' || current === null) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
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

interface QueryChunk {
  key?: string;
  name: string;
  value: unknown;
}

function readQueryChunks(body: string, onError?: (error: unknown) => void): QueryChunk[] {
  const queries: QueryChunk[] = [];

  for (const match of body.matchAll(/<fw-query\b(?<attrs>[^>]*)>(?<json>[\s\S]*?)<\/fw-query>/g)) {
    const attrs = match.groups?.attrs ?? '';
    const name = readAttribute(attrs, 'name');
    if (!name) continue;
    const key = readAttribute(attrs, 'key') ?? undefined;

    const parsed = parseJsonValue(unescapeHtml(match.groups?.json ?? 'null'));
    if (!parsed.ok) {
      onError?.(malformedJsonError(`fw-query ${name}`, parsed.error));
      continue;
    }

    queries.push({
      ...(key === undefined ? {} : { key }),
      name,
      value: parsed.value,
    });
  }

  return queries;
}

function readFragmentChunks(body: string): FragmentChunk[] {
  const fragments: FragmentChunk[] = [];

  for (const match of body.matchAll(
    /<fw-fragment\b(?<attrs>[^>]*)>(?<html>[\s\S]*?)<\/fw-fragment>/g,
  )) {
    const target = readAttribute(match.groups?.attrs ?? '', 'target');
    if (!target) continue;

    fragments.push({
      html: match.groups?.html ?? '',
      ...(readAttribute(match.groups?.attrs ?? '', 'mode') === 'append' ? { mode: 'append' } : {}),
      target,
    });
  }

  return fragments;
}

function replaceFragment(target: MorphTarget, html: string): void {
  target.replaceWithHtml(html);
}

function appendFragment(target: MorphTarget, html: string, morph: MorphFragment): void {
  if (target.appendHtml) {
    target.appendHtml(html);
    return;
  }

  const current = target.readHtml?.();
  if (current !== undefined) {
    morph(target, `${current}${html}`);
    return;
  }

  morph(target, html);
}

function copyOptionalStructuralFields(
  current: StructuralMorphNode,
  next: StructuralMorphNode,
): void {
  if (next.key === undefined) {
    delete current.key;
  } else {
    current.key = next.key;
  }

  if (next.props === undefined) {
    delete current.props;
  } else {
    current.props = { ...next.props };
  }

  if (next.text === undefined) {
    delete current.text;
  } else {
    current.text = next.text;
  }

  if (current.browserState === undefined && next.browserState !== undefined) {
    current.browserState = cloneBrowserState(next.browserState);
  }
}

function morphStructuralChildren(
  currentChildren: readonly StructuralMorphNode[],
  nextChildren: readonly StructuralMorphNode[],
): StructuralMorphNode[] {
  const currentByKey = indexStructuralKeys(currentChildren, 'current');
  indexStructuralKeys(nextChildren, 'next');

  const used = new Set<StructuralMorphNode>();
  let unkeyedCursor = 0;

  function takeNextUnkeyedCurrent(): StructuralMorphNode | undefined {
    while (unkeyedCursor < currentChildren.length) {
      const candidate = currentChildren[unkeyedCursor];
      unkeyedCursor += 1;

      if (!candidate || candidate.key != null || used.has(candidate)) continue;

      return candidate;
    }

    return undefined;
  }

  return nextChildren.map((nextChild) => {
    const matched =
      nextChild.key == null ? takeNextUnkeyedCurrent() : currentByKey.get(nextChild.key);

    if (!matched || used.has(matched)) {
      return cloneStructuralNode(nextChild);
    }

    used.add(matched);
    return morphStructuralTree(matched, nextChild);
  });
}

function indexStructuralKeys(
  children: readonly StructuralMorphNode[],
  side: 'current' | 'next',
): Map<StructuralMorphKey, StructuralMorphNode> {
  const byKey = new Map<StructuralMorphKey, StructuralMorphNode>();

  for (const child of children) {
    if (child.key == null) continue;

    if (byKey.has(child.key)) {
      throw new Error(`Duplicate ${side} structural morph key: ${String(child.key)}`);
    }

    byKey.set(child.key, child);
  }

  return byKey;
}

function cloneStructuralNode(node: StructuralMorphNode): StructuralMorphNode {
  const clone: StructuralMorphNode = { type: node.type };

  if (node.browserState !== undefined) clone.browserState = cloneBrowserState(node.browserState);
  if (node.key !== undefined) clone.key = node.key;
  if (node.props !== undefined) clone.props = { ...node.props };
  if (node.text !== undefined) clone.text = node.text;
  if (node.children !== undefined) {
    clone.children = node.children.map((child) => cloneStructuralNode(child));
  }

  return clone;
}

function cloneBrowserState(state: StructuralMorphBrowserState): StructuralMorphBrowserState {
  return {
    ...(state.focused === undefined ? {} : { focused: state.focused }),
    ...(state.islandState === undefined ? {} : { islandState: structuredClone(state.islandState) }),
    ...(state.scroll === undefined ? {} : { scroll: { ...state.scroll } }),
    ...(state.selection === undefined ? {} : { selection: { ...state.selection } }),
  };
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

function readAttribute(attrs: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}="([^"]*)"`);
  return unescapeHtml(pattern.exec(attrs)?.[1] ?? '') || null;
}

let generatedIdemCounter = 0;

function createIdem(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `idem_${Date.now().toString(36)}_${(generatedIdemCounter += 1).toString(36)}`
  );
}

function readMutationChangeHeader(response: EnhancedMutationResponseLike): MutationChangeRecord[] {
  const value = response.headers?.get('FW-Changes') ?? response.headers?.get('fw-changes');
  if (!value) return [];

  const parsed = parseJsonValue(value);
  if (!parsed.ok || !Array.isArray(parsed.value)) return [];

  return parsed.value.flatMap((record) => {
    const sanitized = sanitizeMutationChangeRecord(record);
    return sanitized ? [sanitized] : [];
  });
}

function reportMalformedMutationChangeHeader(
  response: EnhancedMutationResponseLike,
  onError?: (error: unknown) => void,
): void {
  const value = response.headers?.get('FW-Changes') ?? response.headers?.get('fw-changes');
  if (!value) return;

  const parsed = parseJsonValue(value);
  if (!parsed.ok) {
    onError?.(malformedJsonError('FW-Changes header', parsed.error));
  }
}

function unescapeHtml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
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
