export type { DiagnosticCode } from '@jiso/core';

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

export interface LoaderRoot {
  addEventListener(
    type: string,
    listener: (event: DelegatedEvent) => void | Promise<void>,
    options?: { capture?: boolean },
  ): void;
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

export function installJisoLoader(options: JisoLoaderOptions): JisoLoader {
  const events = options.events ?? defaultDelegatedEvents;

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

export interface PendingOptimism {
  commit(): void;
  restore(): void;
  snapshot: QuerySnapshot;
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

export function applyMutationResponse(store: QueryStore, body: string): AppliedMutationResponse {
  const queries: string[] = [];

  for (const match of body.matchAll(/<fw-query\b(?<attrs>[^>]*)>(?<json>[\s\S]*?)<\/fw-query>/g)) {
    const name = readAttribute(match.groups?.attrs ?? '', 'name');
    if (!name) continue;

    store.set(name, JSON.parse(unescapeHtml(match.groups?.json ?? 'null')));
    queries.push(name);
  }

  return {
    fragments: readFragmentChunks(body),
    queries,
  };
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

export interface BroadcastLike {
  close?: () => void;
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
}

export interface MutationBroadcast {
  close(): void;
  publish(body: string): void;
}

export function installMutationBroadcast(options: {
  channel: BroadcastLike;
  store: QueryStore;
}): MutationBroadcast {
  options.channel.onmessage = (event) => {
    if (!isMutationBroadcastMessage(event.data)) return;

    applyMutationResponse(options.store, event.data.body);
  };

  return {
    close() {
      options.channel.onmessage = null;
      options.channel.close?.();
    },
    publish(body: string) {
      options.channel.postMessage({
        body,
        type: 'jiso:mutation-response',
      });
    },
  };
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

function readAttribute(attrs: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}="([^"]*)"`);
  return unescapeHtml(pattern.exec(attrs)?.[1] ?? '') || null;
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
  type: 'jiso:mutation-response';
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'jiso:mutation-response' &&
    'body' in value &&
    typeof value.body === 'string'
  );
}
