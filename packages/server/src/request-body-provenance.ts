import {
  requestCreateNullRecord,
  requestIsPlainRecord,
  requestReflectGet,
} from './request-body-intrinsics.js';
import {
  securityArrayIsArray,
  securityArrayPush,
  securityNumberIsInteger,
  securityObjectKeys,
} from './response-security-intrinsics.js';
import {
  createWitnessWeakMap,
  createWitnessWeakSet,
  witnessDefineProperty,
  witnessGetOwnPropertyDescriptor,
  witnessObjectIs,
  witnessProxy,
  witnessWeakMapGet,
  witnessWeakMapSet,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

type RequestProvenanceLeafTagger = (value: unknown) => unknown;

interface SnapshotFrame {
  readonly array: boolean;
  readonly keys: readonly string[];
  readonly length: number;
  readonly source: object;
  readonly target: Record<PropertyKey, unknown> | unknown[];
  index: number;
}

// A detached snapshot target stores raw scalar values. Only its paired proxy is app-visible.
// Keeping these brands in private witness collections prevents structural forgery from opening the
// one raw-value path reserved for schema/CSRF validation (SPEC §5.2 rule 11 / §6.6).
const requestProvenanceSnapshotTargets = createWitnessWeakSet<object>();
const requestProvenanceProxyTargets = createWitnessWeakMap<object, object>();
const requestProvenanceVisibleProxies = createWitnessWeakMap<object, object>();

/**
 * Snapshot an array/record graph without allocating one poison box per scalar. Containers are
 * detached eagerly so later app mutation cannot race validation, but their app-visible proxies are
 * materialized lazily. Scalar poison boxes are likewise materialized only when app code reads a
 * leaf; framework validators use {@link revealRequestProvenanceContainer} instead.
 */
export function tagRequestProvenanceValue(
  value: unknown,
  tagLeaf: RequestProvenanceLeafTagger,
): unknown {
  if (isRequestProvenanceContainer(value)) return value;
  if (!isSnapshotContainer(value)) return tagLeaf(value);

  const sourceSnapshots = createWitnessWeakMap<object, object>();
  const frames: SnapshotFrame[] = [];
  const root = snapshotContainer(value, sourceSnapshots, frames);

  while (frames.length > 0) {
    const frame = popSnapshotFrame(frames);
    if (frame === undefined) break;
    if (frame.index >= frame.length) continue;

    const property: PropertyKey = frame.array ? frame.index : frame.keys[frame.index]!;
    frame.index += 1;
    securityArrayPush(frames, frame);

    const sourceValue = stableOwnDataValue(frame.source, property);
    const existingTarget = requestProvenanceTarget(sourceValue);
    const snapshotValue =
      existingTarget ??
      (isSnapshotContainer(sourceValue)
        ? snapshotContainer(sourceValue, sourceSnapshots, frames)
        : sourceValue);
    if (frame.array) {
      securityArrayPush(frame.target as unknown[], snapshotValue);
    } else {
      witnessDefineProperty(frame.target, property, {
        configurable: true,
        enumerable: true,
        value: snapshotValue,
        writable: true,
      });
    }
  }

  return visibleRequestProvenanceContainer(root, tagLeaf);
}

/** @internal Reveal only the detached container target; scalar values remain inaccessible here. */
export function revealRequestProvenanceContainer(value: unknown): unknown {
  return requestProvenanceTarget(value) ?? value;
}

/** @internal Runtime guard for Kovo's module-private lazy request-provenance membrane. */
export function isRequestProvenanceContainer(value: unknown): value is object {
  return requestProvenanceTarget(value) !== undefined;
}

function snapshotContainer(
  source: object,
  sourceSnapshots: WeakMap<object, object>,
  frames: SnapshotFrame[],
): object {
  const cached = witnessWeakMapGet(sourceSnapshots, source);
  if (cached !== undefined) return cached;

  const array = securityArrayIsArray(source);
  const target = array ? [] : (requestCreateNullRecord<unknown>() as Record<PropertyKey, unknown>);
  witnessWeakMapSet(sourceSnapshots, source, target);
  witnessWeakSetAdd(requestProvenanceSnapshotTargets, target);

  const keys = array ? [] : securityObjectKeys(source);
  const length = array ? stableArrayLength(source) : keys.length;
  securityArrayPush(frames, { array, index: 0, keys, length, source, target });
  return target;
}

function visibleRequestProvenanceContainer(
  target: object,
  tagLeaf: RequestProvenanceLeafTagger,
): object {
  const cached = witnessWeakMapGet(requestProvenanceVisibleProxies, target);
  if (cached !== undefined) return cached;

  const proxy = witnessProxy(target as Record<PropertyKey, unknown>, {
    defineProperty() {
      return false;
    },
    deleteProperty() {
      return false;
    },
    get(snapshot, property, receiver) {
      const descriptor = witnessGetOwnPropertyDescriptor(snapshot, property);
      if (descriptor !== undefined) {
        if (!('value' in descriptor)) throw unstableCarrierError();
        if (property === 'length' && securityArrayIsArray(snapshot)) return descriptor.value;
        return appVisibleRequestValue(descriptor.value, tagLeaf);
      }
      return requestReflectGet(snapshot, property, receiver);
    },
    getOwnPropertyDescriptor(snapshot, property) {
      const descriptor = witnessGetOwnPropertyDescriptor(snapshot, property);
      if (descriptor === undefined || !('value' in descriptor)) return descriptor;
      // Array length is non-configurable, so proxy invariants require the exact target descriptor.
      if (!descriptor.configurable) return descriptor;
      return {
        configurable: true,
        enumerable: descriptor.enumerable === true,
        value: appVisibleRequestValue(descriptor.value, tagLeaf),
        writable: descriptor.writable === true,
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
  witnessWeakMapSet(requestProvenanceVisibleProxies, target, proxy);
  witnessWeakMapSet(requestProvenanceProxyTargets, proxy, target);
  return proxy;
}

function appVisibleRequestValue(value: unknown, tagLeaf: RequestProvenanceLeafTagger): unknown {
  if (
    typeof value === 'object' &&
    value !== null &&
    witnessWeakSetHas(requestProvenanceSnapshotTargets, value)
  ) {
    return visibleRequestProvenanceContainer(value, tagLeaf);
  }
  return tagLeaf(value);
}

function requestProvenanceTarget(value: unknown): object | undefined {
  return typeof value === 'object' && value !== null
    ? witnessWeakMapGet(requestProvenanceProxyTargets, value)
    : undefined;
}

function isSnapshotContainer(value: unknown): value is object {
  return securityArrayIsArray(value) || requestIsPlainRecord(value);
}

function stableArrayLength(value: object): number {
  const before = witnessGetOwnPropertyDescriptor(value, 'length');
  const after = witnessGetOwnPropertyDescriptor(value, 'length');
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !witnessObjectIs(before.value, after.value) ||
    !securityNumberIsInteger(before.value) ||
    before.value < 0
  ) {
    throw unstableCarrierError();
  }
  return before.value;
}

function stableOwnDataValue(value: object, property: PropertyKey): unknown {
  const before = witnessGetOwnPropertyDescriptor(value, property);
  const after = witnessGetOwnPropertyDescriptor(value, property);
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !witnessObjectIs(before.value, after.value) ||
    before.configurable !== after.configurable ||
    before.enumerable !== after.enumerable ||
    before.writable !== after.writable
  ) {
    throw unstableCarrierError();
  }
  return before.value;
}

function popSnapshotFrame(frames: SnapshotFrame[]): SnapshotFrame | undefined {
  if (frames.length === 0) return undefined;
  const index = frames.length - 1;
  const descriptor = witnessGetOwnPropertyDescriptor(frames, index);
  frames.length = index;
  if (descriptor === undefined || !('value' in descriptor)) throw unstableCarrierError();
  return descriptor.value;
}

function unstableCarrierError(): TypeError {
  return new TypeError('Kovo request carriers require stable own data properties.');
}
