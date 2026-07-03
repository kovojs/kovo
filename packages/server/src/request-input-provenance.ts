import { AsyncLocalStorage } from 'node:async_hooks';

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
    objectPaths: new WeakMap(),
    primitiveReads: [],
    privilegedObjects: new WeakSet(),
    privilegedPrimitives: [],
    proxyCache: new WeakMap(),
  };
  const trackedInput = trackRequestInputValue(input, '<input>', state) as Input;
  return requestInputProvenance.run(state, () => callback(trackedInput));
}

/** @internal Mark an audited `adminAssign(...)` value as intentionally writable to governed columns. */
export function markPrivilegedRequestInputAssignment(value: unknown): void {
  const state = requestInputProvenance.getStore();
  if (state === undefined) return;
  if (isTrackableObject(value)) {
    state.privilegedObjects.add(value);
    return;
  }
  if (isPrimitiveValue(value)) {
    const read = lastPrimitiveReadForValue(state, value) ?? {
      path: '<adminAssign>',
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
    if (state.privilegedObjects.has(value)) return undefined;
    const path = state.objectPaths.get(value);
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

  const cached = state.proxyCache.get(value);
  if (cached !== undefined) return cached;

  const proxy = new Proxy(value as Record<PropertyKey, unknown>, {
    get(target, property, receiver) {
      const item = Reflect.get(target, property, receiver);
      return trackRequestInputValue(item, pathForProperty(path, property), state);
    },
  });
  state.proxyCache.set(value, proxy);
  state.objectPaths.set(value, path);
  state.objectPaths.set(proxy, path);
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
