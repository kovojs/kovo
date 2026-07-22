import type { JsonValue } from '@kovojs/core';
import { domAttributes } from './dom-like.js';
import type { EventElementLike } from './events.js';
import {
  applySecurityIntrinsic,
  securityArrayAppend,
  securityArrayIsArray,
  securityGetOwnPropertyDescriptor,
  securityGetPrototypeOf,
  securityMap,
  securityMapDelete,
  securityMapForEach,
  securityMapGet,
  securityMapSet,
  securityJsonParse,
  securityJsonStringify,
  securityNullRecord,
  securityNumber,
  securityObjectKeys,
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
const HandlerStateTypeError = globalThis.TypeError;
const HandlerStateArrayPrototype = globalThis.Array.prototype;
const HandlerStateObjectPrototype = globalThis.Object.prototype;
const HANDLER_STATE_MAX_DEPTH = 64;
const HANDLER_STATE_VALUE_BUDGET = 10_000;
const HANDLER_STATE_TEXT_BUDGET = 1_000_000;
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
  context: HandlerContext<JsonValue>;
}

export function createDelegatedHandlerContext(
  element: EventElementLike,
  stateHost: EventElementLike,
  islandSignalScope: IslandSignalScope,
): DelegatedHandlerContext {
  const context: HandlerContext<JsonValue> = {
    params: readElementParams(element),
    signal: createHandlerSignal(element, islandSignalScope),
    // JSON.parse creates Object.prototype-backed records. Canonicalize before handler one so the
    // state data channel never supplies inherited constructor/toString capabilities.
    // Read from the already-selected queue/commit host. The target may be reparented while this
    // dispatch waits behind an earlier state writer; re-resolving closest() would cross hosts.
    state: snapshotHandlerStateJsonValue(readElementStateValue(stateHost)),
  };

  return {
    commit() {
      writeElementState(stateHost, context.state);
    },
    context,
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
  return stateHost ? readElementStateValue(stateHost) : {};
}

function readElementStateValue(stateHost: EventElementLike): JsonValue {
  const state = readRuntimeElementAttribute(stateHost, 'kovo-state');
  if (!state) return {};

  try {
    return securityJsonParse<JsonValue>(state);
  } catch {
    return {};
  }
}

/** @internal Serialize island state back onto the element's `kovo-state` attribute (SPEC §4.3). */
export function writeElementState(element: EventElementLike, state: JsonValue): void {
  const serialized = securityJsonStringify(snapshotHandlerStateJsonValue(state));
  if (serialized !== undefined) setRuntimeElementAttribute(element, 'kovo-state', serialized);
}

interface HandlerStateSnapshotBudget {
  text: number;
  values: number;
}

/**
 * Canonicalize one handler-produced state graph to bounded recursive own-data JsonValue.
 *
 * SPEC §4.3/§5.2: state is the only cross-handler data channel. Reading descriptors instead of
 * properties rejects accessors, while copying into fresh arrays/null-prototype records prevents a
 * proxy or later mutation from changing the value observed by the next handler or serializer.
 */
export function snapshotHandlerStateJsonValue(value: unknown): JsonValue {
  try {
    return snapshotHandlerStateJsonValueAt(
      value,
      securityWeakMap<object, true>(),
      { text: 0, values: 0 },
      0,
    );
  } catch {
    throw new HandlerStateTypeError(
      'KV449: handler state must be bounded recursive own-data JsonValue.',
    );
  }
}

function snapshotHandlerStateJsonValueAt(
  value: unknown,
  active: WeakMap<object, true>,
  budget: HandlerStateSnapshotBudget,
  depth: number,
): JsonValue {
  budget.values += 1;
  if (budget.values > HANDLER_STATE_VALUE_BUDGET) throw new HandlerStateTypeError();

  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    budget.text += value.length;
    if (budget.text > HANDLER_STATE_TEXT_BUDGET) throw new HandlerStateTypeError();
    return value;
  }
  if (typeof value === 'number') {
    if (value !== value || value === Infinity || value === -Infinity) {
      throw new HandlerStateTypeError();
    }
    return value;
  }
  if (typeof value !== 'object' || depth >= HANDLER_STATE_MAX_DEPTH) {
    throw new HandlerStateTypeError();
  }
  if (securityWeakMapGet(active, value) === true) throw new HandlerStateTypeError();
  securityWeakMapSet(active, value, true);
  try {
    const prototype = securityGetPrototypeOf(value);
    const keys = securityObjectKeys(value);
    if (keys.length > HANDLER_STATE_VALUE_BUDGET - budget.values) {
      throw new HandlerStateTypeError();
    }

    if (securityArrayIsArray(value)) {
      const lengthDescriptor = securityGetOwnPropertyDescriptor(value, 'length');
      if (
        prototype !== HandlerStateArrayPrototype ||
        lengthDescriptor === undefined ||
        !('value' in lengthDescriptor) ||
        typeof lengthDescriptor.value !== 'number' ||
        lengthDescriptor.value < 0 ||
        lengthDescriptor.value % 1 !== 0 ||
        lengthDescriptor.value > HANDLER_STATE_VALUE_BUDGET ||
        keys.length !== lengthDescriptor.value
      ) {
        throw new HandlerStateTypeError();
      }
      const output: JsonValue[] = [];
      for (let index = 0; index < keys.length; index += 1) {
        const keyEntry = securityGetOwnPropertyDescriptor(keys, index);
        if (keyEntry === undefined || !('value' in keyEntry) || keyEntry.value !== `${index}`) {
          throw new HandlerStateTypeError();
        }
        const descriptor = securityGetOwnPropertyDescriptor(value, keyEntry.value);
        if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
          throw new HandlerStateTypeError();
        }
        securityArrayAppend(
          output,
          snapshotHandlerStateJsonValueAt(descriptor.value, active, budget, depth + 1),
          'Handler state JSON array',
        );
      }
      return output;
    }

    if (prototype !== null && prototype !== HandlerStateObjectPrototype) {
      throw new HandlerStateTypeError();
    }
    const output = securityNullRecord<JsonValue>();
    for (let index = 0; index < keys.length; index += 1) {
      const keyEntry = securityGetOwnPropertyDescriptor(keys, index);
      if (keyEntry === undefined || !('value' in keyEntry) || typeof keyEntry.value !== 'string') {
        throw new HandlerStateTypeError();
      }
      budget.text += keyEntry.value.length;
      if (budget.text > HANDLER_STATE_TEXT_BUDGET) throw new HandlerStateTypeError();
      const descriptor = securityGetOwnPropertyDescriptor(value, keyEntry.value);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        throw new HandlerStateTypeError();
      }
      output[keyEntry.value] = snapshotHandlerStateJsonValueAt(
        descriptor.value,
        active,
        budget,
        depth + 1,
      );
    }
    return output;
  } finally {
    securityWeakMapDelete(active, value);
  }
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
