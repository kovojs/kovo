import { AsyncLocalStorage } from 'node:async_hooks';
import {
  createWitnessWeakMap,
  createWitnessWeakSet,
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

const requestInputProvenance = new AsyncLocalStorage<RequestInputProvenanceState>();

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
  return requestInputProvenance.run(state, () => callback(trackedInput));
}

/** @internal Mark an audited `trustedAssign(...)` value as intentionally writable to governed columns. */
export function markPrivilegedRequestInputAssignment(value: unknown): void {
  const state = requestInputProvenance.getStore();
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
    state.privilegedPrimitives.push({ ...read, consumed: false });
  }
}

/** @internal Resolve whether `value` is an exact parsed request-input value in the active context. */
export function requestInputProvenanceForValue(value: unknown): RequestInputProvenance | undefined {
  const state = requestInputProvenance.getStore();
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
  if (!isTrackableObject(value)) {
    if (isPrimitiveValue(value)) state.primitiveReads.push({ path, type: typeof value, value });
    return value;
  }

  const cached = witnessWeakMapGet(state.proxyCache, value);
  if (cached !== undefined) return cached;

  const proxy = new Proxy(value as Record<PropertyKey, unknown>, {
    get(target, property, receiver) {
      const item = witnessReflectGet(target, property, receiver);
      return trackRequestInputValue(item, pathForProperty(path, property), state);
    },
  });
  witnessWeakMapSet(state.proxyCache, value, proxy);
  witnessWeakMapSet(state.objectPaths, value, path);
  witnessWeakMapSet(state.objectPaths, proxy, path);
  return proxy;
}

function pathForProperty(base: string, property: PropertyKey): string {
  if (typeof property === 'symbol') return `${base}[${String(property)}]`;
  const key = String(property);
  return /^\d+$/u.test(key) ? `${base}[${key}]` : `${base}.${key}`;
}

function isTrackableObject(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return true;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPrimitiveValue(value: unknown): value is PrimitiveValue {
  return value === null || (typeof value !== 'object' && typeof value !== 'function');
}

function primitiveReadMatches(read: PrimitiveRead, value: PrimitiveValue): boolean {
  return read.type === typeof value && Object.is(read.value, value);
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
