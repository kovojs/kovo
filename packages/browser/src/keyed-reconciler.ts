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
  const currentByKey = indexEntries(current, adapter.currentKey, 'current', adapter.onDuplicateKey);
  indexEntries(next, adapter.nextKey, 'next', adapter.onDuplicateKey);
  const used = new Set<Current>();
  let unkeyedCursor = 0;

  function takeUnkeyed(): Current | undefined {
    if (adapter.preserveUnkeyed === false) return undefined;

    while (unkeyedCursor < current.length) {
      const candidate = current[unkeyedCursor];
      unkeyedCursor += 1;
      if (!candidate || adapter.currentKey(candidate) != null || used.has(candidate)) continue;
      return candidate;
    }

    return undefined;
  }

  return next.map((nextItem) => {
    const key = adapter.nextKey(nextItem);
    const matched = key == null ? takeUnkeyed() : currentByKey.get(key);

    if (!matched || used.has(matched)) {
      return adapter.create(nextItem);
    }

    used.add(matched);
    return adapter.match(matched, nextItem);
  });
}

function indexEntries<Item, Key extends KeyedReconcileKey>(
  entries: readonly Item[],
  readKey: (item: Item) => Key | null | undefined,
  side: 'current' | 'next',
  onDuplicateKey: ((side: 'current' | 'next', key: Key) => void) | undefined,
): Map<Key, Item> {
  const byKey = new Map<Key, Item>();

  for (const entry of entries) {
    const key = readKey(entry);
    if (key == null) continue;
    if (byKey.has(key)) onDuplicateKey?.(side, key);
    else byKey.set(key, entry);
  }

  return byKey;
}
