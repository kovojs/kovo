import { isScopedKey } from '@kovojs/core/internal/storage';
import {
  createFrameworkAsyncContextCell,
  currentFrameworkAsyncContextValue,
  runWithFrameworkAsyncContext,
} from './async-context.js';
import {
  witnessArrayAppend,
  witnessCreateWithPrototype,
  createWitnessWeakMap,
  createWitnessWeakSet,
  witnessDefineProperty,
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessIsArray,
  witnessObjectIs,
  witnessOwnKeys,
  witnessProxy,
  witnessRegExpTest,
  witnessReflectGet,
  witnessWeakMapGet,
  witnessWeakMapSet,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

type PrimitiveValue = bigint | boolean | null | number | string | symbol | undefined;

interface PrimitiveRead {
  path: string;
  type: string;
  value: PrimitiveValue;
}

interface PrivilegedPrimitiveRead extends PrimitiveRead {
  consumed: boolean;
}

interface RequestInputProvenanceState {
  objectPaths: WeakMap<object, string>;
  primitiveReads: PrimitiveRead[];
  privilegedObjects: WeakSet<object>;
  privilegedPrimitives: PrivilegedPrimitiveRead[];
  proxyCache: WeakMap<object, object>;
}

export interface RequestInputProvenance {
  path: string;
}

const requestInputProvenance = createFrameworkAsyncContextCell<RequestInputProvenanceState>(
  'server.request-input-provenance',
);
const requestInputObjectPrototype = witnessGetPrototypeOf({});

/** @internal Run a mutation handler under a request-input provenance context (SPEC §11.1 KV438). */
export function runWithRequestInputProvenance<Input, Result>(
  input: Input,
  callback: (trackedInput: Input) => Result,
): Result {
  const state: RequestInputProvenanceState = {
    objectPaths: createWitnessWeakMap(),
    primitiveReads: [],
    privilegedObjects: createWitnessWeakSet(),
    privilegedPrimitives: [],
    proxyCache: createWitnessWeakMap(),
  };
  const trackedInput = trackRequestInputValue(input, '<input>', state) as Input;
  return runWithFrameworkAsyncContext(requestInputProvenance, state, () => callback(trackedInput));
}

/** @internal Mark an audited `trustedAssign(...)` value as intentionally writable to governed columns. */
export function markPrivilegedRequestInputAssignment(value: unknown): void {
  const state = currentFrameworkAsyncContextValue(requestInputProvenance);
  if (state === undefined) return;
  if (isTrackableObject(value)) {
    witnessWeakSetAdd(state.privilegedObjects, value);
    return;
  }
  if (isPrimitiveValue(value)) {
    const read = lastPrimitiveReadForValue(state, value) ?? {
      path: '<trustedAssign>',
      type: typeof value,
      value,
    };
    witnessArrayAppend(
      state.privilegedPrimitives,
      { ...read, consumed: false },
      'Server packages/server/src/request-input-provenance.ts collection',
    );
  }
}

/** @internal Resolve whether `value` is an exact parsed request-input value in the active context. */
export function requestInputProvenanceForValue(value: unknown): RequestInputProvenance | undefined {
  const state = currentFrameworkAsyncContextValue(requestInputProvenance);
  if (state === undefined) return undefined;
  if (isTrackableObject(value)) {
    if (witnessWeakSetHas(state.privilegedObjects, value)) return undefined;
    const path = witnessWeakMapGet(state.objectPaths, value);
    return path === undefined ? undefined : { path };
  }
  if (!isPrimitiveValue(value)) return undefined;
  const read = lastPrimitiveReadForValue(state, value);
  if (read === undefined) return undefined;
  const privilegedRead = consumePrivilegedPrimitiveRead(state, read);
  if (privilegedRead !== undefined) {
    return undefined;
  }
  return { path: read.path };
}

function trackRequestInputValue(
  value: unknown,
  path: string,
  state: RequestInputProvenanceState,
): unknown {
  // SPEC §6.6 C9: a schema-produced ScopedKey is framework authority, not request provenance.
  // Preserve the exact module-private witness; proxying would create an unwitnessed lookalike and
  // correctly make every stateful door fail closed inside the mutation handler.
  if (isScopedKey(value)) return value;
  if (!isTrackableObject(value)) {
    if (isPrimitiveValue(value)) {
      witnessArrayAppend(
        state.primitiveReads,
        { path, type: typeof value, value },
        'Server packages/server/src/request-input-provenance.ts collection',
      );
    }
    return value;
  }

  const cached = witnessWeakMapGet(state.proxyCache, value);
  if (cached !== undefined) return cached;

  // The canonical guard-args receipt is deeply frozen. Proxying that object directly would make a
  // recursively tracked `get` violate Proxy invariants for non-configurable object-valued fields.
  // Use a same-shape, configurable shadow solely as the Proxy target; every read still comes from
  // the detached canonical receipt and writes remain closed (SPEC §6.6 / §11.1 KV438).
  const proxyTarget = requestInputProvenanceProxyTarget(value);
  let proxy: object;
  proxy = witnessProxy(proxyTarget, {
    defineProperty() {
      return false;
    },
    deleteProperty() {
      return false;
    },
    get(_target, property, receiver) {
      const item = witnessReflectGet(value, property, receiver);
      return trackRequestInputValue(item, pathForProperty(path, property), state);
    },
    getOwnPropertyDescriptor(target, property) {
      const descriptor = witnessGetOwnPropertyDescriptor(target, property);
      if (
        descriptor === undefined ||
        !('value' in descriptor) ||
        descriptor.configurable === false
      ) {
        return descriptor;
      }
      return {
        ...descriptor,
        value: trackRequestInputValue(descriptor.value, pathForProperty(path, property), state),
      };
    },
    preventExtensions() {
      return false;
    },
    set() {
      return false;
    },
    setPrototypeOf() {
      return false;
    },
  });
  witnessWeakMapSet(state.proxyCache, value, proxy);
  witnessWeakMapSet(state.objectPaths, value, path);
  witnessWeakMapSet(state.objectPaths, proxy, path);
  return proxy;
}

function requestInputProvenanceProxyTarget(value: object): object {
  const target: object = witnessIsArray(value)
    ? []
    : witnessCreateWithPrototype(witnessGetPrototypeOf(value));
  const keys = witnessOwnKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const keyDescriptor = witnessGetOwnPropertyDescriptor(keys, index);
    if (keyDescriptor === undefined || !('value' in keyDescriptor)) {
      throw new TypeError('Canonical mutation input keys must remain dense.');
    }
    const property = keyDescriptor.value;
    const descriptor = witnessGetOwnPropertyDescriptor(value, property);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Canonical mutation input must contain only own data properties.');
    }
    if (witnessIsArray(target) && property === 'length') {
      witnessDefineProperty(target, 'length', { value: descriptor.value });
      continue;
    }
    witnessDefineProperty(target, property, {
      configurable: true,
      enumerable: descriptor.enumerable ?? false,
      value: descriptor.value,
      writable: true,
    });
  }
  return target;
}

function pathForProperty(base: string, property: PropertyKey): string {
  if (typeof property === 'symbol') return `${base}[${String(property)}]`;
  const key = String(property);
  return witnessRegExpTest(/^\d+$/u, key) ? `${base}[${key}]` : `${base}.${key}`;
}

function isTrackableObject(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) return false;
  if (witnessIsArray(value)) return true;
  const prototype = witnessGetPrototypeOf(value);
  return prototype === requestInputObjectPrototype || prototype === null;
}

function isPrimitiveValue(value: unknown): value is PrimitiveValue {
  return value === null || (typeof value !== 'object' && typeof value !== 'function');
}

function primitiveReadMatches(read: PrimitiveRead, value: PrimitiveValue): boolean {
  return read.type === typeof value && witnessObjectIs(read.value, value);
}

function lastPrimitiveReadForValue(
  state: RequestInputProvenanceState,
  value: PrimitiveValue,
): PrimitiveRead | undefined {
  for (let index = state.primitiveReads.length - 1; index >= 0; index -= 1) {
    const read = state.primitiveReads[index];
    if (read !== undefined && primitiveReadMatches(read, value)) return read;
  }
  return undefined;
}

function consumePrivilegedPrimitiveRead(
  state: RequestInputProvenanceState,
  read: PrimitiveRead,
): PrivilegedPrimitiveRead | undefined {
  for (let index = state.privilegedPrimitives.length - 1; index >= 0; index -= 1) {
    const privileged = state.privilegedPrimitives[index];
    if (
      privileged !== undefined &&
      !privileged.consumed &&
      privileged.path === read.path &&
      primitiveReadMatches(privileged, read.value)
    ) {
      privileged.consumed = true;
      return privileged;
    }
  }
  return undefined;
}
