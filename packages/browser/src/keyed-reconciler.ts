import {
  applySecurityIntrinsic,
  securityArrayAppend,
  securityArrayIsArray,
  securityGetOwnPropertyDescriptor,
  securityMap,
  securityMapGet,
  securityMapHas,
  securityMapSet,
  securitySet,
  securitySetAdd,
  securitySetHas,
} from './security-witness-intrinsics.js';

/** @internal Key type shared by Kovo keyed reconciliation adapters. */
export type KeyedReconcileKey = string | number;

/** @internal One normalized reconciliation candidate. */
export interface KeyedReconcileEntry<Item, Key extends KeyedReconcileKey> {
  item: Item;
  key: Key | null | undefined;
}

/** @internal Adapter hooks for the shared §13.2 keyed reconciliation kernel. */
export interface KeyedReconcileAdapter<Current, Next, Output, Key extends KeyedReconcileKey> {
  create(this: void, next: Next): Output;
  match(this: void, current: Current, next: Next): Output;
  currentKey(this: void, current: Current): Key | null | undefined;
  nextKey(this: void, next: Next): Key | null | undefined;
  onDuplicateKey?: (this: void, side: 'current' | 'next', key: Key) => void;
  preserveUnkeyed?: boolean;
}

/**
 * @internal Apply SPEC.md §13.2 match/remove/insert/reorder semantics over an
 * arbitrary keyed collection. Adapters own DOM/structural/template specifics,
 * while this kernel owns the identity ordering.
 */
export function reconcileKeyed<Current, Next, Output, Key extends KeyedReconcileKey>(
  current: readonly Current[],
  next: readonly Next[],
  adapter: KeyedReconcileAdapter<Current, Next, Output, Key>,
): Output[] {
  const currentKey = ownAdapterFunction(adapter, 'currentKey');
  const nextKey = ownAdapterFunction(adapter, 'nextKey');
  const create = ownAdapterFunction(adapter, 'create');
  const match = ownAdapterFunction(adapter, 'match');
  const duplicate = ownOptionalAdapterFunction(adapter, 'onDuplicateKey');
  const preserveUnkeyed = ownOptionalAdapterBoolean(adapter, 'preserveUnkeyed') !== false;
  const currentEntries = snapshotEntries(current, currentKey, 'current');
  const nextEntries = snapshotEntries(next, nextKey, 'next');
  const currentByKey = indexEntries(currentEntries, 'current', duplicate);
  indexEntries(nextEntries, 'next', duplicate);
  const used = securitySet<Current>();
  let unkeyedCursor = 0;

  function takeUnkeyed(): KeyedReconcileEntry<Current, Key> | undefined {
    if (!preserveUnkeyed) return undefined;

    while (unkeyedCursor < currentEntries.length) {
      const candidate = currentEntries[unkeyedCursor];
      unkeyedCursor += 1;
      if (!candidate || candidate.key != null || securitySetHas(used, candidate.item)) continue;
      return candidate;
    }

    return undefined;
  }

  const output: Output[] = [];
  for (let index = 0; index < nextEntries.length; index += 1) {
    const nextEntry = nextEntries[index];
    if (!nextEntry) continue;
    const matched =
      nextEntry.key == null ? takeUnkeyed() : securityMapGet(currentByKey, nextEntry.key);

    if (!matched || securitySetHas(used, matched.item)) {
      securityArrayAppend(
        output,
        applySecurityIntrinsic(create, undefined, [nextEntry.item]),
        'Browser keyed reconciliation output',
      );
      continue;
    }

    securitySetAdd(used, matched.item);
    securityArrayAppend(
      output,
      applySecurityIntrinsic(match, undefined, [matched.item, nextEntry.item]),
      'Browser keyed reconciliation output',
    );
  }
  return output;
}

function indexEntries<Item, Key extends KeyedReconcileKey>(
  entries: readonly KeyedReconcileEntry<Item, Key>[],
  side: 'current' | 'next',
  onDuplicateKey: ((side: 'current' | 'next', key: Key) => void) | undefined,
): Map<Key, KeyedReconcileEntry<Item, Key>> {
  const byKey = securityMap<Key, KeyedReconcileEntry<Item, Key>>();

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    const key = entry.key;
    if (key == null) continue;
    if (securityMapHas(byKey, key)) {
      if (onDuplicateKey) applySecurityIntrinsic(onDuplicateKey, undefined, [side, key]);
    } else {
      securityMapSet(byKey, key, entry);
    }
  }

  return byKey;
}

function snapshotEntries<Item, Key extends KeyedReconcileKey>(
  items: readonly Item[],
  readKey: (item: Item) => Key | null | undefined,
  side: 'current' | 'next',
): KeyedReconcileEntry<Item, Key>[] {
  if (!securityArrayIsArray(items)) {
    throw new TypeError(`Kovo ${side} keyed reconciliation input must be an array.`);
  }
  const length = securityGetOwnPropertyDescriptor(items, 'length');
  if (
    !length ||
    !('value' in length) ||
    typeof length.value !== 'number' ||
    length.value < 0 ||
    length.value > 100_000 ||
    length.value % 1 !== 0
  ) {
    throw new TypeError(`Kovo ${side} keyed reconciliation input length is invalid.`);
  }

  const snapshot: KeyedReconcileEntry<Item, Key>[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = securityGetOwnPropertyDescriptor(items, index);
    if (!descriptor || !('value' in descriptor)) {
      throw new TypeError(`Kovo ${side} keyed reconciliation input must be dense own data.`);
    }
    const item = descriptor.value as Item;
    const key = applySecurityIntrinsic<Key | null | undefined>(readKey, undefined, [item]);
    if (key != null && typeof key !== 'string' && typeof key !== 'number') {
      throw new TypeError(`Kovo ${side} keyed reconciliation key is invalid.`);
    }
    securityArrayAppend(snapshot, { item, key }, `Browser ${side} keyed reconciliation snapshot`);
  }
  return snapshot;
}

function ownAdapterFunction<
  Current,
  Next,
  Output,
  Key extends KeyedReconcileKey,
  Name extends 'create' | 'currentKey' | 'match' | 'nextKey',
>(
  adapter: KeyedReconcileAdapter<Current, Next, Output, Key>,
  name: Name,
): Extract<KeyedReconcileAdapter<Current, Next, Output, Key>[Name], Function> {
  const descriptor = securityGetOwnPropertyDescriptor(adapter, name);
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
    throw new TypeError(`Kovo keyed reconciliation adapter ${name} must be an own-data function.`);
  }
  return descriptor.value;
}

function ownOptionalAdapterFunction<Current, Next, Output, Key extends KeyedReconcileKey>(
  adapter: KeyedReconcileAdapter<Current, Next, Output, Key>,
  name: 'onDuplicateKey',
): ((side: 'current' | 'next', key: Key) => void) | undefined {
  const descriptor = securityGetOwnPropertyDescriptor(adapter, name);
  if (!descriptor) return undefined;
  if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
    throw new TypeError(`Kovo keyed reconciliation adapter ${name} must be an own-data function.`);
  }
  return descriptor.value;
}

function ownOptionalAdapterBoolean<Current, Next, Output, Key extends KeyedReconcileKey>(
  adapter: KeyedReconcileAdapter<Current, Next, Output, Key>,
  name: 'preserveUnkeyed',
): boolean | undefined {
  const descriptor = securityGetOwnPropertyDescriptor(adapter, name);
  if (!descriptor) return undefined;
  if (!('value' in descriptor) || typeof descriptor.value !== 'boolean') {
    throw new TypeError(`Kovo keyed reconciliation adapter ${name} must be own boolean data.`);
  }
  return descriptor.value;
}
