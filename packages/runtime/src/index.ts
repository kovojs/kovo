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
}

export interface DelegatedEvent {
  type: string;
  target: EventTargetLike | null;
}

export interface EventTargetLike {
  closest?: (selector: string) => EventElementLike | null;
}

export interface EventElementLike {
  getAttribute(name: string): string | null;
  attributes?: Iterable<{ name: string; value: string }>;
}

export interface JisoLoaderOptions {
  discardPendingOptimism?: () => readonly string[] | void;
  events?: readonly string[];
  importModule: ImportHandlerModule;
  queryStore?: QueryStore;
  refetchOnFocus?: () => void | Promise<void>;
  root: LoaderRoot;
}

export interface JisoLoader {
  events: readonly string[];
}

const defaultDelegatedEvents = ['click', 'submit', 'input', 'change'] as const;

export const jisoLoaderSource = `(()=>{const E=["click","submit","input","change"],P=e=>{const t=e.target?.closest?.("[on\\\\:"+e.type+"]");if(!t)return;const r=t.getAttribute("on:"+e.type);if(!r)return;const i=r.lastIndexOf("#");if(i<=0)return;const p={};for(const a of t.attributes||[])a.name.startsWith("data-p-")&&(p[a.name.slice(7).replace(/-([a-z0-9])/g,(_,c)=>c.toUpperCase())]=a.value);import(r.slice(0,i)).then(m=>m[r.slice(i+1)]?.(e,{params:p,state:{}}))};for(const e of E)addEventListener(e,P,{capture:!0});const R=()=>dispatchEvent(new CustomEvent("jiso:refetch"));addEventListener("visibilitychange",R);addEventListener("focus",R)})();`;

export function installJisoLoader(options: JisoLoaderOptions): JisoLoader {
  const events = options.events ?? defaultDelegatedEvents;

  if (options.queryStore && options.root.querySelectorAll) {
    hydrateQueryScripts(options.queryStore, options.root.querySelectorAll('script[fw-query]'));
  }

  for (const eventName of events) {
    options.root.addEventListener(
      eventName,
      async (event) => {
        await dispatchDelegatedEvent(event, options.importModule);
      },
      { capture: true },
    );
  }

  if (options.refetchOnFocus) {
    options.root.addEventListener('visibilitychange', options.refetchOnFocus);
    options.root.addEventListener('focus', options.refetchOnFocus);
  }

  if (options.discardPendingOptimism) {
    installPagehideOptimismCleanup({
      discardPendingOptimism: options.discardPendingOptimism,
      root: options.root,
    });
  }

  return { events };
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

  await (fn as ClientHandler)(event as Event, {
    params: readElementParams(element),
    state: {},
  });
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

function camelCase(value: string): string {
  return value.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

export type QueryUpdatePlan<Value = unknown> = (value: Value) => void;

export interface QueryStore {
  get<Value = unknown>(name: string): Value | undefined;
  hydrate(script: QueryScriptLike): void;
  snapshot(names: readonly string[]): QuerySnapshot;
  set<Value = unknown>(name: string, value: Value): void;
  subscribe<Value = unknown>(name: string, plan: QueryUpdatePlan<Value>): () => void;
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
    get<Value = unknown>(name: string): Value | undefined {
      return values.get(name) as Value | undefined;
    },
    hydrate(script: QueryScriptLike): void {
      const name = script.getAttribute('fw-query');
      if (!name) return;

      this.set(name, JSON.parse(script.textContent ?? 'null'));
    },
    snapshot(names: readonly string[]): QuerySnapshot {
      const snapshot = new Map<string, unknown>();

      for (const name of names) {
        snapshot.set(name, structuredClone(values.get(name)));
      }

      return snapshot;
    },
    set<Value = unknown>(name: string, value: Value): void {
      values.set(name, value);

      for (const plan of plans.get(name) ?? []) {
        plan(value);
      }
    },
    subscribe<Value = unknown>(name: string, plan: QueryUpdatePlan<Value>): () => void {
      const existing = plans.get(name) ?? new Set<QueryUpdatePlan>();
      existing.add(plan as QueryUpdatePlan);
      plans.set(name, existing);

      if (values.has(name)) {
        plan(values.get(name) as Value);
      }

      return () => {
        existing.delete(plan as QueryUpdatePlan);
      };
    },
  };
}

export type OptimisticTransform<Input = unknown, Value = unknown> = (
  current: Value,
  input: Input,
) => Value;

export interface OptimisticPlan<Input = unknown> {
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
      const pending = this.#pendingByQuery.get(queryName) ?? [];
      if (pending.length === 0) {
        this.#serverTruthByQuery.set(queryName, structuredClone(this.#store.get(queryName)));
      }
      pending.push({ id, input, transform: transform as OptimisticTransform });
      this.#pendingByQuery.set(queryName, pending);

      this.#store.set(queryName, transform(this.#store.get(queryName), input));
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

  applyServerTruth<Value>(queryName: string, value: Value): void {
    let next: unknown = value;
    const pendingTransforms = this.#pendingByQuery.get(queryName) ?? [];

    if (pendingTransforms.length > 0) {
      this.#serverTruthByQuery.set(queryName, structuredClone(value));
    } else {
      this.#serverTruthByQuery.delete(queryName);
    }

    for (const pending of pendingTransforms) {
      next = pending.transform(next, pending.input);
    }

    this.#store.set(queryName, next);
  }

  discardPendingOptimism(queryNames?: readonly string[]): string[] {
    const discarded: string[] = [];

    for (const queryName of queryNames ?? [...this.#pendingByQuery.keys()]) {
      if (!this.#pendingByQuery.has(queryName)) continue;

      this.#store.set(queryName, structuredClone(this.#serverTruthByQuery.get(queryName)));
      this.#pendingByQuery.delete(queryName);
      this.#serverTruthByQuery.delete(queryName);
      discarded.push(queryName);
    }

    return discarded;
  }

  pendingCount(queryName: string): number {
    return this.#pendingByQuery.get(queryName)?.length ?? 0;
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
  const snapshot = store.snapshot(queryNames);

  for (const queryName of queryNames) {
    const transform = plan.transforms[queryName];
    if (!transform) continue;

    store.set(queryName, transform(store.get(queryName), input));
  }

  return {
    commit() {
      snapshot.clear();
    },
    restore() {
      for (const [queryName, value] of snapshot) {
        store.set(queryName, value);
      }
    },
    snapshot,
  };
}

export function hydrateQueryScripts(store: QueryStore, scripts: Iterable<QueryScriptLike>): void {
  for (const script of scripts) {
    store.hydrate(script);
  }
}

export interface AppliedMutationResponse {
  fragments: FragmentChunk[];
  queries: string[];
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
  target: string;
}

export interface MorphTarget {
  replaceWithHtml(html: string): void;
}

export interface MorphRoot {
  findFragmentTarget(target: string): MorphTarget | null;
}

export type MorphFragment = (target: MorphTarget, html: string) => void;

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
  const raw = errorMatch?.groups?.json ? unescapeHtml(errorMatch.groups.json) : body;

  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return { body: raw, code: 'unknown' };
  }
}

export function applyMutationResponse(store: QueryStore, body: string): AppliedMutationResponse {
  return applyMutationResponseWithQueries(body, (name, value) => {
    store.set(name, value);
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

    morph(target, fragment.html);
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
  const applied = applyMutationResponse(options.store, options.body);

  return {
    ...applied,
    appliedFragments: applyFragments(options.root, applied.fragments, options.morph),
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
  const { body, changes, idem, response, targets } = await fetchEnhancedMutation(options);
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
      options.rebaser.discardPendingOptimism(queryNames);
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
      options.rebaser.applyServerTruth(query.name, query.value);
    }
    const applied = {
      appliedFragments: applyFragments(options.root, fragments, options.morph),
      fragments,
      queries: queryChunks.map((query) => query.name),
    };
    publishSuccessfulMutation(options, response, body, changes);
    const settledQueries = queryNames.filter(
      (queryName) => options.rebaser.pendingCount(queryName) === 0,
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
    options.rebaser.discardPendingOptimism(queryNames);
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
  onChanges?: (changes: readonly MutationChangeRecord[]) => void;
  store: QueryStore;
}): MutationBroadcast {
  options.channel.onmessage = (event) => {
    if (!isMutationBroadcastMessage(event.data)) return;

    applyMutationResponse(options.store, event.data.body);
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

function applyMutationResponseWithQueries(
  body: string,
  applyQuery: (name: string, value: unknown) => void,
): AppliedMutationResponse {
  const queryChunks = readQueryChunks(body);

  for (const query of queryChunks) {
    applyQuery(query.name, query.value);
  }

  return {
    fragments: readFragmentChunks(body),
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
      'FW-Targets': targets.join(','),
    },
    keepalive: true,
    method: (options.form.method ?? 'post').toUpperCase(),
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

interface QueryChunk {
  name: string;
  value: unknown;
}

function readQueryChunks(body: string): QueryChunk[] {
  const queries: QueryChunk[] = [];

  for (const match of body.matchAll(/<fw-query\b(?<attrs>[^>]*)>(?<json>[\s\S]*?)<\/fw-query>/g)) {
    const name = readAttribute(match.groups?.attrs ?? '', 'name');
    if (!name) continue;

    queries.push({
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
      target,
    });
  }

  return fragments;
}

function replaceFragment(target: MorphTarget, html: string): void {
  target.replaceWithHtml(html);
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
    if (target) targets.add(target);
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
