import type { JsonValue } from '@jiso/core';
import type { DelegatedEvent, EventElementLike } from './events.js';
import { readAttribute, tagClose } from './wire-parser.js';

export type ImportHandlerModule = (url: string) => Promise<Record<string, unknown>>;

export type ElementParamValue = string | number | boolean;

export interface HandlerContext<State = unknown, Params = Record<string, ElementParamValue>> {
  params: Params;
  signal: AbortSignal;
  state: State;
}

export type ClientHandler<State = unknown, Params = Record<string, ElementParamValue>> = (
  event: Event,
  ctx: HandlerContext<State, Params>,
) => void | Promise<void>;

export function handler<State = unknown, Params = Record<string, ElementParamValue>>(
  fn: ClientHandler<State, Params>,
): ClientHandler<State, Params> {
  return fn;
}

export type IslandSignalScope = object;

export const defaultIslandSignalScope: IslandSignalScope = {};

const islandSignalControllers = new WeakMap<IslandSignalScope, Map<string, AbortController>>();
const delegatedStateQueues = new WeakMap<EventElementLike, Promise<void>>();

export function createIslandSignalScope(): IslandSignalScope {
  return {};
}

export function abortIslandSignalScope(scope: IslandSignalScope): void {
  const controllers = islandSignalControllers.get(scope);
  if (!controllers) return;

  for (const controller of controllers.values()) {
    controller.abort();
  }
  controllers.clear();
  islandSignalControllers.delete(scope);
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

async function dispatchDelegatedEventForElement(
  event: DelegatedEvent,
  importModule: ImportHandlerModule,
  element: EventElementLike,
  stateHost: EventElementLike,
  islandSignalScope: IslandSignalScope,
): Promise<void> {
  const state = readElementState(element);
  const context: HandlerContext = {
    params: readElementParams(element),
    signal: createHandlerSignal(element, islandSignalScope),
    state,
  };

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

export function readElementParams(element: EventElementLike): Record<string, ElementParamValue> {
  const paramTypes = readElementParamTypes(element.getAttribute?.('fw-param-types'));
  const params: Record<string, ElementParamValue> = {};

  for (const attribute of element.attributes ?? []) {
    if (!attribute.name.startsWith('data-p-')) continue;

    const name = camelCase(attribute.name.slice('data-p-'.length));
    params[name] = coerceElementParam(attribute.value, paramTypes[name]);
  }

  return params;
}

function readElementParamTypes(value: string | null | undefined): Record<string, string> {
  const types: Record<string, string> = {};

  for (const entry of value?.split(/[\s,]+/) ?? []) {
    const [name, type] = entry.split(':');
    if (name && type) types[name] = type;
  }

  return types;
}

function coerceElementParam(value: string, type: string | undefined): ElementParamValue {
  if (type === 'number') return Number(value);
  if (type === 'boolean') return value === 'true';

  return value;
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

function createHandlerSignal(element: EventElementLike, scope: IslandSignalScope): AbortSignal {
  const key = islandSignalKey(element);
  if (!key) return new AbortController().signal;

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
  const controllers = islandSignalControllersFor(scope);

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

function fwComponentIds(html: string): Set<string> {
  const ids = new Set<string>();
  let offset = 0;

  while (offset < html.length) {
    const start = html.indexOf('<', offset);
    if (start === -1) break;
    if (html[start + 1] === '/') {
      offset = start + 2;
      continue;
    }

    const tagName = /^<[a-z][a-z0-9-]*/i.exec(html.slice(start));
    if (!tagName) {
      offset = start + 1;
      continue;
    }

    const close = tagClose(html, start + tagName[0].length);
    if (close === undefined) break;
    const tag = html.slice(start, close + 1);
    const identity = islandSignalIdentity(
      readAttribute(tag, 'fw-c'),
      readAttribute(tag, 'fw-key'),
      readAttribute(tag, 'id'),
    );
    if (identity) ids.add(identity);
    offset = close + 1;
  }

  return ids;
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
