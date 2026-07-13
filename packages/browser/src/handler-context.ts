import type { JsonValue } from '@kovojs/core';
import { domAttributes } from './dom-like.js';
import type { EventElementLike } from './events.js';
import {
  applySecurityIntrinsic,
  securityArrayAppend,
  securityGetOwnPropertyDescriptor,
  securityMap,
  securityMapDelete,
  securityMapForEach,
  securityMapGet,
  securityMapSet,
  securityJsonParse,
  securityJsonStringify,
  securityNullRecord,
  securityNumber,
  securityRegExpExec,
  securityRegExpTest,
  securitySet,
  securitySetAdd,
  securitySetForEach,
  securitySetHas,
  securityStringCharCodeAt,
  securityStringIndexOf,
  securityStringSlice,
  securityStringStartsWith,
  securityWeakMap,
  securityWeakMapDelete,
  securityWeakMapGet,
  securityWeakMapSet,
} from './security-witness-intrinsics.js';
import { readAttribute, tagClose } from './wire-html.js';
import {
  closestRuntimeElement,
  readRuntimeElementAttribute,
  setRuntimeElementAttribute,
} from './runtime-dom-security.js';

const IslandAbortController = globalThis.AbortController;
const IslandAbortSignal = globalThis.AbortSignal;
const IslandAbortTypeError = globalThis.TypeError;
const islandAbort = securityGetOwnPropertyDescriptor(
  IslandAbortController.prototype,
  'abort',
)?.value;
const islandSignal = securityGetOwnPropertyDescriptor(
  IslandAbortController.prototype,
  'signal',
)?.get;
const islandSignalAborted = securityGetOwnPropertyDescriptor(
  IslandAbortSignal.prototype,
  'aborted',
)?.get;
const islandAbortControlsSound = verifyIslandAbortControls();

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

const islandSignalControllers = securityWeakMap<IslandSignalScope, Map<string, AbortController>>();

export function createIslandSignalScope(): IslandSignalScope {
  return {};
}

export function abortIslandSignalScope(scope: IslandSignalScope): void {
  const controllers = securityWeakMapGet(islandSignalControllers, scope);
  if (!controllers) return;

  securityMapForEach(controllers, (controller, key) => {
    abortIslandController(controller);
    securityMapDelete(controllers, key);
  });
  securityWeakMapDelete(islandSignalControllers, scope);
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
  const paramTypes = readElementParamTypes(
    readRuntimeElementAttribute(element, 'kovo-param-types'),
  );
  const params = securityNullRecord<ElementParamValue>();

  const attributes = domAttributes(element.attributes);
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index];
    if (attribute === undefined || !securityStringStartsWith(attribute.name, 'data-p-')) continue;

    const name = camelCase(securityStringSlice(attribute.name, 'data-p-'.length));
    params[name] = coerceElementParam(attribute.value, paramTypes[name]);
  }

  return params;
}

function readElementParamTypes(value: string | null | undefined): Record<string, string> {
  const types = securityNullRecord<string>();
  if (value === null || value === undefined) return types;

  let start = 0;
  for (let index = 0; index <= value.length; index += 1) {
    const delimiter =
      index === value.length ||
      value[index] === ',' ||
      securityRegExpTest(/\s/u, value[index] ?? '');
    if (!delimiter) continue;
    if (index > start) {
      const entry = securityStringSlice(value, start, index);
      const colon = securityStringIndexOf(entry, ':');
      if (colon > 0 && colon < entry.length - 1) {
        types[securityStringSlice(entry, 0, colon)] = securityStringSlice(entry, colon + 1);
      }
    }
    start = index + 1;
  }

  return types;
}

function coerceElementParam(value: string, type: string | undefined): ElementParamValue {
  if (type === 'number') return securityNumber(value);
  if (type === 'boolean') return value === 'true';

  return value;
}

/** @internal Read an island element's serialized `kovo-state`, defaulting malformed state to `{}` (SPEC §4.3). */
export function readElementState(element: EventElementLike): JsonValue {
  const stateHost = readElementStateHost(element);
  const state = stateHost ? readRuntimeElementAttribute(stateHost, 'kovo-state') : null;
  if (!state) return {};

  try {
    return securityJsonParse<JsonValue>(state);
  } catch {
    return {};
  }
}

/** @internal Serialize island state back onto the element's `kovo-state` attribute (SPEC §4.3). */
export function writeElementState(element: EventElementLike, state: JsonValue): void {
  const serialized = securityJsonStringify(state);
  if (serialized !== undefined) setRuntimeElementAttribute(element, 'kovo-state', serialized);
}

export function readElementStateHost(element: EventElementLike): EventElementLike | null {
  return (
    closestRuntimeElement<EventElementLike>(element, '[kovo-state]') ??
    (readRuntimeElementAttribute(element, 'kovo-state') === null ? null : element)
  );
}

function createHandlerSignal(element: EventElementLike, scope: IslandSignalScope): AbortSignal {
  const key = islandSignalKey(element);
  if (!key) return readIslandControllerSignal(createIslandAbortController());

  const controllers = islandSignalControllersFor(scope);
  const existing = securityMapGet(controllers, key);
  if (existing) {
    const signal = readIslandControllerSignal(existing);
    if (!readIslandSignalAborted(signal)) return signal;
  }

  const controller = createIslandAbortController();
  securityMapSet(controllers, key, controller);
  return readIslandControllerSignal(controller);
}

function islandSignalKey(element: EventElementLike): string | null {
  const island = closestRuntimeElement<EventElementLike>(element, '[kovo-c]') ?? element;
  return islandSignalIdentity(
    readRuntimeElementAttribute(island, 'kovo-c'),
    readRuntimeElementAttribute(island, 'kovo-key'),
    readRuntimeElementAttribute(island, 'id'),
  );
}

/** @internal Abort `ctx.signal` for islands removed/replaced during a fragment morph (SPEC §4.7). */
export function abortRemovedIslandSignals(
  currentHtml: string,
  nextHtml: string,
  scope: IslandSignalScope = defaultIslandSignalScope,
): string[] {
  const next = kovoComponentIds(nextHtml);
  const removed: string[] = [];
  securitySetForEach(kovoComponentIds(currentHtml), (id) => {
    if (!securitySetHas(next, id))
      securityArrayAppend(
        removed,
        id,
        'Browser packages/browser/src/handler-context.ts collection',
      );
  });
  const controllers = islandSignalControllersFor(scope);

  for (let index = 0; index < removed.length; index += 1) {
    const id = removed[index];
    if (id === undefined) continue;
    const controller = securityMapGet(controllers, id);
    if (!controller) continue;

    abortIslandController(controller);
    securityMapDelete(controllers, id);
  }

  return removed;
}

function islandSignalControllersFor(scope: IslandSignalScope): Map<string, AbortController> {
  const existing = securityWeakMapGet(islandSignalControllers, scope);
  if (existing) return existing;

  const controllers = securityMap<string, AbortController>();
  securityWeakMapSet(islandSignalControllers, scope, controllers);
  return controllers;
}

function createIslandAbortController(): AbortController {
  assertIslandAbortControls();
  return new IslandAbortController();
}

function readIslandControllerSignal(controller: AbortController): AbortSignal {
  assertIslandAbortControls();
  const signal = applySecurityIntrinsic<unknown>(islandSignal!, controller, []);
  if (signal === null || typeof signal !== 'object') {
    throw new IslandAbortTypeError('Kovo island AbortController signal is unavailable.');
  }
  if (typeof applySecurityIntrinsic<unknown>(islandSignalAborted!, signal, []) !== 'boolean') {
    throw new IslandAbortTypeError('Kovo island AbortSignal state is unavailable.');
  }
  return signal as AbortSignal;
}

function readIslandSignalAborted(signal: AbortSignal): boolean {
  assertIslandAbortControls();
  const aborted = applySecurityIntrinsic<unknown>(islandSignalAborted!, signal, []);
  if (typeof aborted !== 'boolean') {
    throw new IslandAbortTypeError('Kovo island AbortSignal state is unavailable.');
  }
  return aborted;
}

function abortIslandController(controller: AbortController): void {
  assertIslandAbortControls();
  const signal = readIslandControllerSignal(controller);
  if (!readIslandSignalAborted(signal)) {
    applySecurityIntrinsic(islandAbort!, controller, []);
  }
  if (!readIslandSignalAborted(signal)) {
    throw new IslandAbortTypeError('Kovo island AbortController failed to retire its signal.');
  }
}

function assertIslandAbortControls(): void {
  if (!islandAbortControlsSound) {
    throw new IslandAbortTypeError(
      'Kovo island AbortController controls are unavailable because realm intrinsics were modified before runtime initialization.',
    );
  }
}

function verifyIslandAbortControls(): boolean {
  if (
    typeof IslandAbortController !== 'function' ||
    typeof IslandAbortSignal !== 'function' ||
    typeof islandAbort !== 'function' ||
    typeof islandSignal !== 'function' ||
    typeof islandSignalAborted !== 'function'
  ) {
    return false;
  }
  try {
    const controller = new IslandAbortController();
    const signal = applySecurityIntrinsic<unknown>(islandSignal, controller, []);
    if (
      signal === null ||
      typeof signal !== 'object' ||
      applySecurityIntrinsic<unknown>(islandSignalAborted, signal, []) !== false
    ) {
      return false;
    }
    applySecurityIntrinsic(islandAbort, controller, []);
    if (applySecurityIntrinsic<unknown>(islandSignalAborted, signal, []) !== true) return false;
    let rejectedForeignReceiver = false;
    try {
      applySecurityIntrinsic(islandAbort, {}, []);
    } catch {
      rejectedForeignReceiver = true;
    }
    return rejectedForeignReceiver;
  } catch {
    return false;
  }
}

function kovoComponentIds(html: string): Set<string> {
  const ids = securitySet<string>();
  let offset = 0;

  while (offset < html.length) {
    const start = securityStringIndexOf(html, '<', offset);
    if (start === -1) break;
    if (html[start + 1] === '/') {
      offset = start + 2;
      continue;
    }

    const tagName = securityRegExpExec(/^<[a-z][a-z0-9-]*/i, securityStringSlice(html, start));
    if (!tagName) {
      offset = start + 1;
      continue;
    }

    const close = tagClose(html, start + tagName[0].length);
    if (close === undefined) break;
    const tag = securityStringSlice(html, start, close + 1);
    const identity = islandSignalIdentity(
      readAttribute(tag, 'kovo-c'),
      readAttribute(tag, 'kovo-key'),
      readAttribute(tag, 'id'),
    );
    if (identity) securitySetAdd(ids, identity);
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
  return instance ? `${component}\0${instance}` : component;
}

function camelCase(value: string): string {
  let camel = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (character === '-' && index + 1 < value.length) {
      const next = value[index + 1] ?? '';
      const code = securityStringCharCodeAt(next, 0);
      if ((code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39)) {
        camel +=
          code >= 0x61 && code <= 0x7a ? ('ABCDEFGHIJKLMNOPQRSTUVWXYZ'[code - 0x61] ?? '') : next;
        index += 1;
        continue;
      }
    }
    camel += character;
  }
  return camel;
}
