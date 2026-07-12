import {
  createWitnessMap,
  createWitnessSet,
  createWitnessWeakMap,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessMapGet,
  witnessMapForEach,
  witnessMapHas,
  witnessMapSet,
  witnessOwnKeys,
  witnessReflectApply,
  witnessReflectGet,
  witnessSetAdd,
  witnessSetHas,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

const NativeAbortController = AbortController;
const NativeHeaders = Headers;
const NativeRequest = Request;
const authorityNeutralCloneFactories = createWitnessWeakMap<Request, () => Request>();
const authorityNeutralMetadataSources = createWitnessWeakMap<Request, Request>();
const pinnedRequestCarrierSnapshots = createWitnessWeakMap<object, PinnedRequestCarrierSnapshot>();
const nativeRequestClone = witnessGetOwnPropertyDescriptor(Request.prototype, 'clone')
  ?.value as unknown;
const nativeRequestHeaders = witnessGetOwnPropertyDescriptor(Request.prototype, 'headers')?.get;
const nativeHeadersEntries = witnessGetOwnPropertyDescriptor(Headers.prototype, 'entries')
  ?.value as unknown;
const nativeAbortControllerAbort = witnessGetOwnPropertyDescriptor(
  AbortController.prototype,
  'abort',
)?.value as unknown;
const nativeAbortControllerSignal = witnessGetOwnPropertyDescriptor(
  AbortController.prototype,
  'signal',
)?.get;
const abortSignalAbortedDescriptor = witnessGetOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
);
const nativeAbortSignalAborted = abortSignalAbortedDescriptor
  ? witnessReflectGet(abortSignalAbortedDescriptor, 'get')
  : undefined;
const nativeAddEventListener = witnessGetOwnPropertyDescriptor(
  EventTarget.prototype,
  'addEventListener',
)?.value as unknown;
const intrinsicObjectPrototype = witnessGetPrototypeOf({});

export interface PinnedRequestProperty {
  readonly key: PropertyKey;
  readonly value: unknown;
}

interface PinnedCarrierProperty {
  readonly enumerable: boolean;
  readonly own: boolean;
  readonly value: unknown;
}

interface PinnedRequestCarrierSnapshot {
  readonly ownKeys: readonly (string | symbol)[];
  readonly properties: Map<PropertyKey, PinnedCarrierProperty>;
}

/**
 * Materialize a lifecycle request view from one exact reflection snapshot.
 *
 * Providers, guards, task hooks, and handlers share a realm. A nested request Proxy must therefore
 * never redispatch through live Reflect/Function.bind after an earlier guard accepted the carrier.
 * This helper snapshots own and inherited values once with captured intrinsics, binds callable
 * values through captured Reflect.apply, and serves only that framework-owned snapshot thereafter
 * (SPEC §6.6 C9, §9.5, §10.3).
 *
 * @internal
 */
export function pinnedRequestCarrier<Request>(
  request: Request,
  overrides: readonly PinnedRequestProperty[],
  omitted: readonly PropertyKey[] = [],
): Request & object {
  const objectLike =
    (typeof request === 'object' || typeof request === 'function') && request !== null;
  const target = objectLike ? (request as object) : {};
  const overrideValues = createWitnessMap<PropertyKey, unknown>();
  const omittedKeys = createWitnessSet<PropertyKey>();
  for (let index = 0; index < overrides.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(overrides, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Pinned request overrides must be a dense own-data array.');
    }
    const entry = descriptor.value;
    const key = pinnedRequestPropertyKey(ownPinnedRequestEntryValue(entry, 'key'));
    witnessMapSet(overrideValues, key, ownPinnedRequestEntryValue(entry, 'value'));
  }
  for (let index = 0; index < omitted.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(omitted, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Pinned request omissions must be a dense own-data array.');
    }
    witnessSetAdd(omittedKeys, pinnedRequestPropertyKey(descriptor.value));
  }

  const properties = createWitnessMap<PropertyKey, PinnedCarrierProperty>();
  const ownKeys: (string | symbol)[] = [];
  const priorSnapshot = objectLike
    ? witnessWeakMapGet(pinnedRequestCarrierSnapshots, target)
    : undefined;
  if (priorSnapshot === undefined) {
    if (objectLike) {
      snapshotRequestOwnProperties(target, properties, ownKeys, overrideValues, omittedKeys);
      snapshotRequestInheritedProperties(target, properties, overrideValues, omittedKeys);
    }
  } else {
    copyPinnedRequestCarrierSnapshot(
      priorSnapshot,
      properties,
      ownKeys,
      overrideValues,
      omittedKeys,
    );
  }
  for (let index = 0; index < overrides.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(overrides, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Pinned request overrides must remain dense.');
    }
    const key = pinnedRequestPropertyKey(ownPinnedRequestEntryValue(descriptor.value, 'key'));
    if (!arrayHasPropertyKey(ownKeys, key)) appendPinnedRequestKey(ownKeys, key);
    witnessMapSet(properties, key, {
      enumerable: true,
      own: true,
      value: ownPinnedRequestEntryValue(descriptor.value, 'value'),
    });
  }

  const carrierTarget = witnessCreateNullRecord();
  const carrier = new Proxy(carrierTarget, {
    get(_target, property) {
      return witnessMapGet(properties, property)?.value;
    },
    getOwnPropertyDescriptor(_target, property) {
      const snapshot = witnessMapGet(properties, property);
      if (snapshot === undefined || !snapshot.own) return undefined;
      return {
        configurable: true,
        enumerable: snapshot.enumerable,
        value: snapshot.value,
        writable: false,
      };
    },
    has(_target, property) {
      return witnessMapHas(properties, property);
    },
    ownKeys() {
      return snapshotPinnedRequestKeys(ownKeys);
    },
  });
  witnessWeakMapSet(pinnedRequestCarrierSnapshots, carrier, { ownKeys, properties });
  return carrier as Request & object;
}

function copyPinnedRequestCarrierSnapshot(
  source: PinnedRequestCarrierSnapshot,
  properties: Map<PropertyKey, PinnedCarrierProperty>,
  ownKeys: (string | symbol)[],
  overrides: Map<PropertyKey, unknown>,
  omitted: Set<PropertyKey>,
): void {
  witnessMapForEach(source.properties, (snapshot, key) => {
    if (witnessSetHas(omitted, key) || witnessMapHas(overrides, key)) return;
    witnessMapSet(properties, key, snapshot);
  });
  for (let index = 0; index < source.ownKeys.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(source.ownKeys, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Pinned request carrier lineage keys must remain dense.');
    }
    const key = descriptor.value;
    if (witnessSetHas(omitted, key) || witnessMapHas(overrides, key)) continue;
    appendPinnedRequestKey(ownKeys, key);
  }
}

function pinnedRequestPropertyKey(value: unknown): string | symbol {
  if (typeof value === 'string' || typeof value === 'symbol') return value;
  if (typeof value === 'number') return String(value);
  throw new TypeError('Pinned request property keys must be strings, numbers, or symbols.');
}

function snapshotRequestOwnProperties(
  target: object,
  properties: Map<PropertyKey, PinnedCarrierProperty>,
  ownKeys: (string | symbol)[],
  overrides: Map<PropertyKey, unknown>,
  omitted: Set<PropertyKey>,
): void {
  const keys = witnessOwnKeys(target);
  for (let index = 0; index < keys.length; index += 1) {
    const keyDescriptor = witnessGetOwnPropertyDescriptor(keys, index);
    if (keyDescriptor === undefined || !('value' in keyDescriptor)) {
      throw new TypeError('Pinned request own keys must be dense.');
    }
    const key = keyDescriptor.value;
    if (witnessSetHas(omitted, key) || witnessMapHas(overrides, key)) continue;
    const descriptor = witnessGetOwnPropertyDescriptor(target, key);
    if (descriptor === undefined) continue;
    const value =
      'value' in descriptor
        ? descriptor.value
        : witnessReflectGet(target, key, target);
    appendPinnedRequestKey(ownKeys, key);
    witnessMapSet(properties, key, {
      enumerable: descriptor.enumerable ?? false,
      own: true,
      value: pinRequestCarrierValue(value, target),
    });
  }
}

function snapshotRequestInheritedProperties(
  target: object,
  properties: Map<PropertyKey, PinnedCarrierProperty>,
  overrides: Map<PropertyKey, unknown>,
  omitted: Set<PropertyKey>,
): void {
  let prototype = witnessGetPrototypeOf(target);
  for (let depth = 0; prototype !== null && depth < 16; depth += 1) {
    if (prototype === intrinsicObjectPrototype) break;
    const keys = witnessOwnKeys(prototype);
    for (let index = 0; index < keys.length; index += 1) {
      const keyDescriptor = witnessGetOwnPropertyDescriptor(keys, index);
      if (keyDescriptor === undefined || !('value' in keyDescriptor)) {
        throw new TypeError('Pinned request prototype keys must be dense.');
      }
      const key = keyDescriptor.value;
      if (
        key === 'constructor' ||
        witnessSetHas(omitted, key) ||
        witnessMapHas(overrides, key) ||
        witnessMapHas(properties, key)
      ) {
        continue;
      }
      const descriptor = witnessGetOwnPropertyDescriptor(prototype, key);
      if (descriptor === undefined) continue;
      let value: unknown;
      try {
        value = witnessReflectGet(target, key, target);
      } catch {
        continue;
      }
      witnessMapSet(properties, key, {
        enumerable: false,
        own: false,
        value: pinRequestCarrierValue(value, target),
      });
    }
    prototype = witnessGetPrototypeOf(prototype);
  }
}

function pinRequestCarrierValue(value: unknown, receiver: object): unknown {
  if (typeof value !== 'function') return value;
  return function (this: unknown, ...args: unknown[]) {
    return witnessReflectApply(value, receiver, args);
  };
}

function ownPinnedRequestEntryValue(
  entry: PinnedRequestProperty,
  property: 'key' | 'value',
): unknown {
  if ((typeof entry !== 'object' && typeof entry !== 'function') || entry === null) {
    throw new TypeError('Pinned request override entries must be objects.');
  }
  const descriptor = witnessGetOwnPropertyDescriptor(entry, property);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`Pinned request override ${property} must be an own data property.`);
  }
  return descriptor.value;
}

function appendPinnedRequestKey(keys: (string | symbol)[], key: string | symbol): void {
  witnessDefineProperty(keys, keys.length, {
    configurable: true,
    enumerable: true,
    value: key,
    writable: true,
  });
}

function arrayHasPropertyKey(
  keys: readonly (string | symbol)[],
  expected: string | symbol,
): boolean {
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(keys, index);
    if (descriptor !== undefined && 'value' in descriptor && descriptor.value === expected) {
      return true;
    }
  }
  return false;
}

function snapshotPinnedRequestKeys(
  keys: readonly (string | symbol)[],
): (string | symbol)[] {
  const snapshot: (string | symbol)[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(keys, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Pinned request key snapshot must remain dense.');
    }
    appendPinnedRequestKey(snapshot, descriptor.value);
  }
  return snapshot;
}

/** Invoke the captured Web Request clone intrinsic on a known native carrier. */
export function cloneNativeRequest(request: Request): Request {
  if (typeof nativeRequestClone !== 'function') {
    throw new TypeError('The Web Request implementation lacks a clone method.');
  }
  return witnessReflectApply(nativeRequestClone, request, []);
}

/** Construct with the import-time Web intrinsic, never a later app-replaced global. */
export function createNativeRequest(input: RequestInfo | URL, init?: RequestInit): Request {
  return new NativeRequest(input, init);
}

/** Clone headers with the import-time Web intrinsic, never a later app-replaced global. */
export function createNativeHeaders(init?: HeadersInit): Headers {
  return new NativeHeaders(init);
}

/** Test with the import-time Web Request brand intrinsic. */
export function isNativeRequest(value: unknown): value is Request {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
  const source = witnessWeakMapGet(authorityNeutralMetadataSources, value as Request) ?? value;
  if (typeof nativeRequestHeaders !== 'function') return false;
  try {
    witnessReflectApply(nativeRequestHeaders, source, []);
    return true;
  } catch {
    return false;
  }
}

/** Test with the import-time Web Headers brand intrinsic. */
export function isNativeHeaders(value: unknown): value is Headers {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
  if (typeof nativeHeadersEntries !== 'function') return false;
  try {
    witnessReflectApply(nativeHeadersEntries, value, []);
    return true;
  } catch {
    return false;
  }
}

/** Test with the import-time Web AbortSignal brand intrinsic. */
export function isNativeAbortSignal(value: unknown): value is AbortSignal {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
  if (typeof nativeAbortSignalAborted !== 'function') return false;
  try {
    witnessReflectApply(nativeAbortSignalAborted, value, []);
    return true;
  } catch {
    return false;
  }
}

/** Register the only framework-owned way to unwrap a Request compatibility carrier safely. */
export function registerAuthorityNeutralRequestClone(
  carrier: Request,
  clone: () => Request,
  metadataSource: Request,
): void {
  witnessWeakMapSet(authorityNeutralCloneFactories, carrier, clone);
  witnessWeakMapSet(authorityNeutralMetadataSources, carrier, metadataSource);
}

/** Clone a framework carrier without trusting an app-overridable public method. */
export function cloneRequestForAuthorityNeutralization(request: Request): Request {
  return (
    witnessWeakMapGet(authorityNeutralCloneFactories, request)?.() ?? cloneNativeRequest(request)
  );
}

/** Resolve a genuine carrier for bodyless metadata reads without teeing or consuming its body. */
export function requestForAuthorityNeutralMetadata(request: Request): Request {
  return witnessWeakMapGet(authorityNeutralMetadataSources, request) ?? request;
}

/** Resolve the original framework metadata identity for any lifecycle carrier. @internal */
export function authorityMetadataSource(request: object): object {
  return witnessWeakMapGet(authorityNeutralMetadataSources, request as Request) ?? request;
}

/** Register a framework property/provenance Proxy with its genuine metadata carrier. */
export function registerAuthorityNeutralRequestMetadata(
  carrier: Request,
  metadataSource: Request,
): void {
  witnessWeakMapSet(authorityNeutralMetadataSources, carrier, metadataSource);
}

/** Mirror cancellation timing while discarding an arbitrary caller-controlled abort reason. */
export function authorityNeutralAbortSignal(source: AbortSignal): AbortSignal {
  if (
    typeof nativeAbortControllerAbort !== 'function' ||
    typeof nativeAbortControllerSignal !== 'function' ||
    typeof nativeAbortSignalAborted !== 'function' ||
    typeof nativeAddEventListener !== 'function'
  ) {
    throw new TypeError('The Web AbortSignal implementation lacks required intrinsics.');
  }

  const controller = new NativeAbortController();
  const signal = witnessReflectApply<AbortSignal>(nativeAbortControllerSignal, controller, []);
  const abort = (): void => {
    if (!witnessReflectApply<boolean>(nativeAbortSignalAborted, signal, [])) {
      witnessReflectApply(nativeAbortControllerAbort, controller, []);
    }
  };
  if (witnessReflectApply<boolean>(nativeAbortSignalAborted, source, [])) {
    abort();
    return signal;
  }
  witnessReflectApply(nativeAddEventListener, source, ['abort', abort, { once: true }]);
  // Close the check/listen race without ever copying `source.reason`.
  if (witnessReflectApply<boolean>(nativeAbortSignalAborted, source, [])) abort();
  return signal;
}
