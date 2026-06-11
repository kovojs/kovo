import { diagnosticDefinitions } from '@jiso/core';
export type { DiagnosticCode } from '@jiso/core';
import type { EventDefinition, Form, FormFailure, FormInput, JsonValue } from '@jiso/core';

export type ImportHandlerModule = (url: string) => Promise<Record<string, unknown>>;

export interface HandlerContext<State = unknown, Params = Record<string, string>> {
  params: Params;
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
  queryDataKeys?: readonly string[];
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

      for (const listener of listeners.get(name) ?? []) {
        void listener({ name, payload });
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
  querySelectorAll?: (selector: string) => Iterable<QueryScriptLike>;
  visibilityState?: 'hidden' | 'visible';
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

export interface UploadProgressElementLike {
  setAttribute(name: string, value: string): void;
}

export interface JisoLoaderOptions {
  discardPendingOptimism?: () => readonly string[] | void;
  enhancedMutations?: EnhancedMutationLoaderOptions;
  events?: readonly string[];
  importModule: ImportHandlerModule;
  queryStore?: QueryStore;
  refetchOnFocus?: (queries: readonly string[]) => void | Promise<void>;
  refetchOnFocusOptOut?: readonly string[];
  root: LoaderRoot;
}

export interface JisoLoader {
  events: readonly string[];
}

const defaultDelegatedEvents = ['click', 'submit', 'input', 'change'] as const;

export const jisoLoaderSource = `(()=>{const E=["click","submit","input","change"],H=t=>t.closest?.("[fw-state]")||t,S=t=>{try{return JSON.parse(H(t)?.getAttribute("fw-state")||"{}")}catch{return {}}},I=()=>Math.random().toString(36).slice(2),T=()=>[...document.querySelectorAll("[fw-deps]")].map(e=>{const d=(e.getAttribute("fw-deps")||"").trim().replace(/[\\\\s,]+/g," "),t=e.getAttribute("fw-fragment-target")||e.id;return t&&(d?t+"="+d:t)}).filter(Boolean),P=e=>{if(e.type=="submit"){const f=e.target.closest("form[enhance],form[data-enhance],form[data-mutation]");if(f){e.preventDefault();const x=I();fetch(f.action,{body:new FormData(f),headers:{Accept:"text/vnd.jiso.fragment+html","FW-Fragment":"true","FW-Idem":x,"FW-Targets":T().join("; ")},keepalive:!0,method:(f.method||"post").toUpperCase()}).then(r=>r.text()).then(b=>{for(const m of b.matchAll(/<fw-query\\b([^>]*)>([\\s\\S]*?)<\\/fw-query>/g)){const n=m[1].match(/name="([^"]+)"/)?.[1];dispatchEvent(new CustomEvent("jiso:query",{detail:{body:m[2],name:n}}))}for(const m of b.matchAll(/<fw-fragment\\b([^>]*)>([\\s\\S]*?)<\\/fw-fragment>/g)){const a=m[1],t=a.match(/target="([^"]+)"/)?.[1],l=t&&(document.getElementById(t)||document.querySelector('[fw-fragment-target="'+t+'"]'));l&&(a.includes("append")?l.insertAdjacentHTML("beforeend",m[2]):l.innerHTML=m[2])}});return}}const t=e.target.closest("[on\\\\:"+e.type+"]");if(!t)return;const r=t.getAttribute("on:"+e.type);if(!r)return;const i=r.lastIndexOf("#");if(i<=0)return;const p={},s=S(t),h=H(t);for(const a of t.attributes||[])a.name.startsWith("data-p-")&&(p[a.name.slice(7).replace(/-([a-z0-9])/g,(_,c)=>c.toUpperCase())]=a.value);import(r.slice(0,i)).then(m=>m[r.slice(i+1)]?.(e,{params:p,state:s})).then(()=>h?.setAttribute?.("fw-state",JSON.stringify(s)))};for(const e of E)addEventListener(e,P,{capture:!0})})();`;

export function installJisoLoader(options: JisoLoaderOptions): JisoLoader {
  const events = options.events ?? defaultDelegatedEvents;
  const enhancedMutations = options.enhancedMutations
    ? withDefaultMutationBroadcast(options.enhancedMutations)
    : undefined;
  let hydratedQueries: readonly string[] = [];

  if (options.queryStore && options.root.querySelectorAll) {
    hydratedQueries = hydrateQueryScripts(
      options.queryStore,
      options.root.querySelectorAll('script[fw-query]'),
    );
  }

  for (const eventName of events) {
    options.root.addEventListener(
      eventName,
      async (event) => {
        if (await dispatchEnhancedFormSubmit(event, enhancedMutations)) return;
        await dispatchDelegatedEvent(event, options.importModule);
      },
      { capture: true },
    );
  }

  if (options.refetchOnFocus) {
    const refetchEligibleQueries = () =>
      filterRefetchEligibleQueries(hydratedQueries, options.refetchOnFocusOptOut ?? []);
    const refetchOnFocus = async () => {
      await options.refetchOnFocus?.(refetchEligibleQueries());
    };

    options.root.addEventListener('visibilitychange', async () => {
      if (options.root.visibilityState === 'hidden') return;
      await refetchOnFocus();
    });
    options.root.addEventListener('focus', refetchOnFocus);
  }

  if (options.discardPendingOptimism) {
    installPagehideOptimismCleanup({
      discardPendingOptimism: options.discardPendingOptimism,
      root: options.root,
    });
  }

  return { events };
}

function withDefaultMutationBroadcast(
  options: EnhancedMutationLoaderOptions,
): EnhancedMutationLoaderOptions {
  if (options.broadcast) return options;
  if (typeof globalThis.BroadcastChannel !== 'function') return options;

  try {
    return {
      ...options,
      broadcast: installMutationBroadcast({
        ...(options.morph ? { morph: options.morph } : {}),
        channel: new globalThis.BroadcastChannel('jiso:mutation-response') as BroadcastLike,
        root: options.root,
        store: options.store,
      }),
    };
  } catch {
    return options;
  }
}

export interface EnhancedMutationLoaderOptions {
  broadcast?: MutationBroadcast;
  fetch: EnhancedMutationFetch;
  formData?: (form: EnhancedFormElementLike) => unknown;
  idem?: () => string;
  morph?: MorphFragment;
  onUploadProgress?: (progress: UploadProgress, form: EnhancedFormElementLike) => void;
  pendingRoot?: PendingRoot;
  root: MorphRoot & TargetCollectorRoot;
  store: QueryStore;
}

export interface EnhancedFormElementLike extends EventElementLike, EnhancedFormLike {}

export async function dispatchEnhancedFormSubmit(
  event: DelegatedEvent,
  options: EnhancedMutationLoaderOptions | undefined,
): Promise<boolean> {
  if (!options || event.type !== 'submit') return false;

  const form = event.target?.closest?.('form[enhance],form[data-enhance],form[data-mutation]') as
    | EnhancedFormElementLike
    | null
    | undefined;
  if (!form || !isEnhancedForm(form)) return false;

  event.preventDefault?.();
  await submitEnhancedMutation({
    fetch: options.fetch,
    form,
    formData: options.formData ? options.formData(form) : new FormData(form as HTMLFormElement),
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
    ...(options.morph ? { morph: options.morph } : {}),
  });
  return true;
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
  const total = progress.total ?? 100;
  const value =
    progress.total && progress.total > 0
      ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
      : progress.loaded;

  for (const element of progressElements) {
    element.setAttribute('value', String(value));
    element.setAttribute('max', progress.total ? '100' : String(total));
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
): Promise<void> {
  const element = event.target?.closest?.(`[on\\:${event.type}]`);
  if (!element) return;

  const ref = element.getAttribute(`on:${event.type}`);
  if (!ref) return;

  const { exportName, url } = parseHandlerReference(ref);
  const mod = await importModule(url);
  const fn = mod[exportName];

  if (typeof fn !== 'function') {
    throw new Error(`Handler export not found: ${ref}`);
  }

  const stateHost = findElementStateHost(element);
  const state = readElementState(element);

  await (fn as ClientHandler)(event as Event, {
    params: readElementParams(element),
    state,
  });

  writeElementState(stateHost ?? element, state);
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

      this.set(
        name,
        JSON.parse(script.textContent ?? 'null'),
        script.getAttribute('key') ?? undefined,
      );
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

export interface OptimisticPlan<Input = unknown> {
  keys?: Readonly<Record<string, string | undefined>>;
  queue?: string;
  transforms: Record<string, OptimisticTransform<Input>>;
}

export type OptimisticFor<
  Definition extends Form<string, Record<string, JsonValue>, JsonValue>,
  QueryValues extends Record<string, unknown>,
> = Omit<OptimisticPlan<FormInput<Definition>>, 'transforms'> & {
  transforms: {
    [QueryName in keyof QueryValues]: OptimisticTransform<
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
  id: string;
  input: Input;
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
    for (const [queryName, transform] of Object.entries(plan.transforms)) {
      const key = plan.keys?.[queryName];
      const storeKey = queryStoreKey(queryName, key);
      const pending = this.#pendingByQuery.get(storeKey) ?? [];
      if (pending.length === 0) {
        this.#serverTruthByQuery.set(storeKey, structuredClone(this.#store.get(queryName, key)));
      }
      pending.push({ id, input, transform: transform as OptimisticTransform });
      this.#pendingByQuery.set(storeKey, pending);

      this.#store.set(queryName, transform(this.#store.get(queryName, key), input), key);
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
      next = pending.transform(next, pending.input);
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

export function installPagehideOptimismCleanup(options: PagehideOptimismCleanupOptions): void {
  // SPEC.md §8/§9.3: pagehide is bfcache-safe; unload handlers are forbidden.
  options.root.addEventListener('pagehide', () => {
    options.discardPendingOptimism();
  });
}

export function applyOptimisticTransforms<Input>(
  store: QueryStore,
  input: Input,
  plan: OptimisticPlan<Input>,
): PendingOptimism {
  const queryNames = Object.keys(plan.transforms);
  const snapshot = store.snapshot(queryNames, plan.keys);

  for (const queryName of queryNames) {
    const transform = plan.transforms[queryName];
    if (!transform) continue;
    const key = plan.keys?.[queryName];

    store.set(queryName, transform(store.get(queryName, key), input), key);
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

export function hydrateQueryScripts(
  store: QueryStore,
  scripts: Iterable<QueryScriptLike>,
): readonly string[] {
  const hydrated: string[] = [];

  for (const script of scripts) {
    const name = script.getAttribute('fw-query');
    store.hydrate(script);
    if (name) {
      hydrated.push(name);
    }
  }

  return hydrated;
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
  input?: unknown;
  keys?: readonly string[];
  manual?: true;
  reason?: string;
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
  textContent?: string | null;
  value?: string;
}

export interface QueryBindingRoot {
  querySelectorAll(selector: string): Iterable<QueryBindingElement>;
}

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
  morph?: MorphFragment;
  onUploadProgress?: (progress: UploadProgress) => void;
  pendingQueries?: readonly string[];
  pendingRoot?: PendingRoot;
  root: MorphRoot & TargetCollectorRoot;
  store: QueryStore;
}

export interface OptimisticEnhancedMutationSubmitOptions<
  Input,
> extends EnhancedMutationSubmitOptions {
  input: Input;
  optimistic: OptimisticPlan<Input>;
  pendingRoot?: PendingRoot;
  queue?: MutationQueue;
  rebaser: OptimisticRebaser;
}

export type SubmitFormDefinition = Form<string, Record<string, JsonValue>, JsonValue>;

export interface SubmitOptions<Input extends Record<string, JsonValue>, Failure extends JsonValue> {
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
  const value = parseJsonValue(raw);
  if (value !== null) return value;

  return { body: raw, code: 'unknown' };
}

function parseJsonValue(raw: string): JsonValue | null {
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return null;
  }
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

  return parseJsonValue(raw) ?? raw;
}

export function applyMutationResponse(store: QueryStore, body: string): AppliedMutationResponse {
  return applyFragmentQueryBody(body, (name, value, key) => {
    store.set(name, value, key);
  });
}

export function applyDeferredChunk(store: QueryStore, body: string): AppliedMutationResponse {
  return applyFragmentQueryBody(body, (name, value, key) => {
    store.set(name, value, key);
  });
}

export function applyFragments(
  root: MorphRoot,
  fragments: readonly FragmentChunk[],
  morph: MorphFragment = replaceFragment,
): string[] {
  const applied: string[] = [];

  for (const fragment of fragments) {
    const target = root.findFragmentTarget(fragment.target);
    if (!target) continue;

    if (fragment.mode === 'append') {
      appendFragment(target, fragment.html, morph);
    } else {
      morph(target, fragment.html);
    }
    applied.push(fragment.target);
  }

  return applied;
}

export function applyMutationResponseToDom(options: {
  body: string;
  morph?: MorphFragment;
  root: MorphRoot;
  store: QueryStore;
}): AppliedMutationResponse & { appliedFragments: string[] } {
  const applied = applyFragmentQueryBody(options.body, (name, value, key) => {
    options.store.set(name, value, key);
    applyQueryBindingsIfSupported(options.root, name, value);
  });

  return {
    ...applied,
    appliedFragments: applyFragments(options.root, applied.fragments, options.morph),
  };
}

export function applyDeferredChunkToDom(options: {
  body: string;
  morph?: MorphFragment;
  root: MorphRoot;
  store: QueryStore;
}): AppliedMutationResponse & { appliedFragments: string[] } {
  const applied = applyFragmentQueryBody(options.body, (name, value, key) => {
    options.store.set(name, value, key);
    applyQueryBindingsIfSupported(options.root, name, value);
  });

  return {
    ...applied,
    appliedFragments: applyFragments(options.root, applied.fragments, options.morph),
  };
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

export function applyDeferredStreamResponseToDom(options: {
  body: string;
  boundary?: string;
  morph?: MorphFragment;
  root: MorphRoot;
  store: QueryStore;
}): AppliedDeferredStreamResponse {
  const chunks = deferredStreamChunks(options.body, options.boundary ?? 'jiso-boundary').map(
    (body) =>
      applyDeferredChunkToDom({
        body,
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
      root: options.root,
      store: options.store,
      ...(options.morph ? { morph: options.morph } : {}),
    });
    publishSuccessfulMutation(options, response, body, changes);

    return {
      ...applied,
      changes,
      idem,
      targets,
    };
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

  // SPEC.md §10.4: predict against query data, mark dependent islands pending,
  // then reconcile the server fragment/query truth over remaining predictions.
  options.rebaser.add(idem, options.input, options.optimistic);
  if (options.pendingRoot) {
    stampPendingQueries(options.pendingRoot, queryNames, true);
  }

  try {
    const { body, changes, response, targets } = await fetchEnhancedMutation(options, idem);

    if (isFailedMutationResponse(response)) {
      options.rebaser.discardPendingOptimism(queryNames, options.optimistic.keys);
      if (options.pendingRoot) {
        stampPendingQueries(options.pendingRoot, queryNames, false);
      }

      const applied = applyMutationResponseToDom({
        body,
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

    const queryChunks = readQueryChunks(body);
    const fragments = readFragmentChunks(body);
    options.rebaser.settle(idem);
    for (const query of queryChunks) {
      options.rebaser.applyServerTruth(query.name, query.value, query.key);
    }
    const applied = {
      appliedFragments: applyFragments(options.root, fragments, options.morph),
      fragments,
      queries: queryChunks.map((query) => query.name),
    };
    publishSuccessfulMutation(options, response, body, changes);
    const settledQueries = queryNames.filter(
      (queryName) =>
        options.rebaser.pendingCount(queryName, options.optimistic.keys?.[queryName]) === 0,
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
    options.rebaser.discardPendingOptimism(queryNames, options.optimistic.keys);
    if (options.pendingRoot) {
      stampPendingQueries(options.pendingRoot, queryNames, false);
    }
    throw error;
  }
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
  root?: MorphRoot;
  store: QueryStore;
}): MutationBroadcast {
  options.channel.onmessage = (event) => {
    if (!isMutationBroadcastMessage(event.data)) return;

    if (options.root) {
      applyMutationResponseToDom({
        body: event.data.body,
        ...(options.morph ? { morph: options.morph } : {}),
        root: options.root,
        store: options.store,
      });
    } else {
      applyMutationResponse(options.store, event.data.body);
    }
    if (event.data.changes.length > 0) {
      options.onChanges?.(event.data.changes);
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
        changes,
        type: 'jiso:mutation-response',
      });
    },
  };
}

function applyFragmentQueryBody(
  body: string,
  applyQuery: (name: string, value: unknown, key: string | undefined) => void,
): AppliedMutationResponse {
  const queryChunks = readQueryChunks(body);

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

  return {
    body: await response.text(),
    changes: readMutationChangeHeader(response),
    idem,
    response,
    targets,
  };
}

function isFailedMutationResponse(response: EnhancedMutationResponseLike): boolean {
  return response.ok === false || (response.status !== undefined && response.status >= 400);
}

function applyQueryBindingsIfSupported(root: MorphRoot, queryName: string, value: unknown): void {
  if (!supportsQueryBindings(root)) return;
  applyQueryBindings(root, queryName, value);
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

function readQueryChunks(body: string): QueryChunk[] {
  const queries: QueryChunk[] = [];

  for (const match of body.matchAll(/<fw-query\b(?<attrs>[^>]*)>(?<json>[\s\S]*?)<\/fw-query>/g)) {
    const attrs = match.groups?.attrs ?? '';
    const name = readAttribute(attrs, 'name');
    if (!name) continue;
    const key = readAttribute(attrs, 'key') ?? undefined;

    queries.push({
      ...(key === undefined ? {} : { key }),
      name,
      value: JSON.parse(unescapeHtml(match.groups?.json ?? 'null')),
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

function createIdem(): string {
  return `idem_${Math.random().toString(36).slice(2)}`;
}

function readMutationChangeHeader(response: EnhancedMutationResponseLike): MutationChangeRecord[] {
  const value = response.headers?.get('FW-Changes') ?? response.headers?.get('fw-changes');
  if (!value) return [];

  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) return [];

  return parsed.filter(isMutationChangeRecord);
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
  if (typeof value !== 'object' || value === null) return false;
  if (!('domain' in value) || typeof value.domain !== 'string') return false;

  return (
    (!('keys' in value) ||
      (Array.isArray(value.keys) && value.keys.every((key) => typeof key === 'string'))) &&
    (!('manual' in value) || value.manual === true) &&
    (!('reason' in value) || typeof value.reason === 'string')
  );
}
