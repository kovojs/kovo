import type { JsonValue } from '@kovojs/core';
import { domAttributes } from './dom-like.js';
import type { EventElementLike } from './events.js';
import { readAttribute, tagClose } from './wire-html.js';

/** Runtime API used by Kovo applications and generated runtime integration. */
export type ElementParamValue = string | number | boolean;

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface HandlerContext<State = unknown, Params = Record<string, ElementParamValue>> {
  params: Params;
  signal: AbortSignal;
  state: State;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export type IslandSignalScope = object;

export const defaultIslandSignalScope: IslandSignalScope = {};

const islandSignalControllers = new WeakMap<IslandSignalScope, Map<string, AbortController>>();

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

export interface DelegatedHandlerContext {
  commit(): void;
  context: HandlerContext;
}

export function createDelegatedHandlerContext(
  element: EventElementLike,
  stateHost: EventElementLike,
  islandSignalScope: IslandSignalScope,
): DelegatedHandlerContext {
  const state = readElementState(element);

  return {
    commit() {
      writeElementState(stateHost, state);
    },
    context: {
      params: readElementParams(element),
      signal: createHandlerSignal(element, islandSignalScope),
      state,
    },
  };
}

/** @internal Read an island element's `data-p-*` params into a typed params object (SPEC §4.3). */
export function readElementParams(element: EventElementLike): Record<string, ElementParamValue> {
  const paramTypes = readElementParamTypes(element.getAttribute?.('kovo-param-types'));
  const params: Record<string, ElementParamValue> = {};

  for (const attribute of domAttributes(element.attributes)) {
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

/** @internal Read an island element's serialized `kovo-state`, defaulting malformed state to `{}` (SPEC §4.3). */
export function readElementState(element: EventElementLike): JsonValue {
  const stateHost = readElementStateHost(element);
  const state = stateHost?.getAttribute('kovo-state');
  if (!state) return {};

  try {
    return JSON.parse(state) as JsonValue;
  } catch {
    return {};
  }
}

/** @internal Serialize island state back onto the element's `kovo-state` attribute (SPEC §4.3). */
export function writeElementState(element: EventElementLike, state: JsonValue): void {
  element.setAttribute?.('kovo-state', JSON.stringify(state));
}

export function readElementStateHost(element: EventElementLike): EventElementLike | null {
  return (
    element.closest?.('[kovo-state]') ??
    (element.getAttribute('kovo-state') === null ? null : element)
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
  const island = element.closest?.('[kovo-c]') ?? element;
  return islandSignalIdentity(
    island.getAttribute('kovo-c'),
    island.getAttribute('kovo-key'),
    island.getAttribute('id'),
  );
}

/** @internal Abort `ctx.signal` for islands removed/replaced during a fragment morph (SPEC §4.7). */
export function abortRemovedIslandSignals(
  currentHtml: string,
  nextHtml: string,
  scope: IslandSignalScope = defaultIslandSignalScope,
): string[] {
  const next = kovoComponentIds(nextHtml);
  const removed = [...kovoComponentIds(currentHtml)].filter((id) => !next.has(id));
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

function kovoComponentIds(html: string): Set<string> {
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
      readAttribute(tag, 'kovo-c'),
      readAttribute(tag, 'kovo-key'),
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
