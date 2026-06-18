import type { JsonValue } from './index.js';

/**
 * @internal
 * A keyed-collection delta: the rows present after a change (matched/added by
 * key) and the key values removed. Part of the change-record-scoped query delta
 * wire format (SPEC §9.1.1).
 */
export interface QueryListDelta {
  /** The `kovo-key` field name identifying each row in this collection (SPEC §4.8). */
  key: string;
  /** Rows to upsert, matched against the base by `key`; unmatched rows append. */
  upsert?: readonly JsonValue[];
  /** Key values to drop from the base collection. */
  remove?: readonly string[];
}

/**
 * @internal
 * A change-record-scoped query delta (SPEC §9.1.1). Carries only what the
 * committed write provably touched: scalar/object fields whole under `set`, and
 * keyed-collection upserts/removals under `lists`. Everything outside this scope
 * is unchanged by server truth (Constitution #5), so applying the delta to the
 * client's held base reconstructs the full value without the server ever knowing
 * client state.
 */
export interface QueryDelta {
  /** Top-level fields to overwrite on the base value (non-collection fields). */
  set?: { [field: string]: JsonValue };
  /** Map of top-level collection field name → keyed upsert/remove operations. */
  lists?: { [path: string]: QueryListDelta };
}

/**
 * @internal
 * Metadata that makes one collection in a query result delta-eligible: the field
 * `path` holding the array, the `key` field on each row (its `kovo-key`), and the
 * `domain` whose change-record keys scope it. A collection is delta-eligible only
 * when its row key corresponds to a domain the change record scopes with explicit
 * keys; otherwise it ships whole (SPEC §9.1.1).
 */
export interface QueryDeltaListMeta {
  domain: string;
  key: string;
  path: string;
}

/** @internal Thrown when a delta cannot be applied to a base (structural mismatch / deploy skew). */
export class QueryDeltaApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryDeltaApplyError';
  }
}

function isPlainObject(value: unknown): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rowKey(row: JsonValue, keyField: string): string | undefined {
  if (!isPlainObject(row)) return undefined;
  const value = row[keyField];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/**
 * @internal
 * Build a change-record-scoped delta from a freshly re-run query `value`
 * (SPEC §9.1.1). For each delta-eligible collection, emit only the rows whose key
 * is in the change-record's `affectedKeysByDomain` set (upsert) plus the affected
 * keys no longer present (remove); all non-collection fields go in `set`.
 *
 * Returns `undefined` when no delta is sound — when there is no collection
 * metadata, or a collection's scoping domain carries no explicit keys (so the
 * whole collection could have changed) — signalling the caller to ship the full
 * value. This keeps the server stateless: it never diffs against client state,
 * it only narrows to what the committed write touched.
 *
 * @param value - The full re-run query value (must be a JSON object to be delta-eligible).
 * @param affectedKeysByDomain - Change-record keys per touched domain (SPEC §9.1, `Kovo-Changes`).
 * @param listMeta - The query's delta-eligible collections.
 * @returns A `QueryDelta`, or `undefined` to fall back to the full value.
 * @example
 * import { buildQueryDelta } from '@kovojs/core/internal/query-delta';
 *
 * const delta = buildQueryDelta(
 *   { count: 3, items: [{ id: 'p1', qty: 2 }] },
 *   new Map([['cart', new Set(['p1'])]]),
 *   [{ domain: 'cart', key: 'id', path: 'items' }],
 * );
 * // delta.set === { count: 3 }; delta.lists.items.upsert === [{ id: 'p1', qty: 2 }]
 */
export function buildQueryDelta(
  value: JsonValue,
  affectedKeysByDomain: ReadonlyMap<string, ReadonlySet<string>>,
  listMeta: readonly QueryDeltaListMeta[],
): QueryDelta | undefined {
  if (!isPlainObject(value) || listMeta.length === 0) return undefined;

  const lists: { [path: string]: QueryListDelta } = {};
  const collectionPaths = new Set<string>();

  for (const meta of listMeta) {
    const affected = affectedKeysByDomain.get(meta.domain);
    // No explicit keys for this collection's domain ⇒ the whole collection could
    // have changed ⇒ a scoped delta is not sound. Fall back to full.
    if (affected === undefined || affected.size === 0) return undefined;

    const collection = value[meta.path];
    if (!Array.isArray(collection)) return undefined;
    collectionPaths.add(meta.path);

    const upsert: JsonValue[] = [];
    const present = new Set<string>();
    for (const row of collection) {
      const key = rowKey(row, meta.key);
      if (key === undefined) return undefined; // unkeyed row ⇒ cannot scope ⇒ full
      present.add(key);
      if (affected.has(key)) upsert.push(row);
    }
    const remove = [...affected].filter((key) => !present.has(key));

    lists[meta.path] = {
      key: meta.key,
      ...(upsert.length > 0 ? { upsert } : {}),
      ...(remove.length > 0 ? { remove } : {}),
    };
  }

  const set: { [field: string]: JsonValue } = {};
  for (const [field, fieldValue] of Object.entries(value)) {
    if (!collectionPaths.has(field)) set[field] = fieldValue;
  }

  return {
    ...(Object.keys(set).length > 0 ? { set } : {}),
    ...(Object.keys(lists).length > 0 ? { lists } : {}),
  };
}

/**
 * @internal
 * Whether a `delta` serializes smaller than the full `value` — the deterministic
 * automatic full-vs-delta selection rule (SPEC §9.1.1). Callers ship the delta
 * only when this holds, so a delta is never larger than the value it replaces.
 */
export function queryDeltaIsSmaller(delta: QueryDelta, value: JsonValue): boolean {
  return JSON.stringify(delta).length < JSON.stringify(value).length;
}

/**
 * @internal
 * Apply a change-record-scoped `delta` to the client's held `base` value,
 * returning the reconstructed full value (SPEC §9.1.1). Scalar/object fields in
 * `set` overwrite; keyed collections reconcile by `kovo-key` — matched rows are
 * replaced in place, new rows append, removed keys drop. The result is then fed
 * to the existing update plan (§4.8) exactly like a full value.
 *
 * Throws {@link QueryDeltaApplyError} when the delta cannot be applied to the
 * base (missing base, or a field whose shape moved across a deploy) so the caller
 * refetches the full value rather than guessing.
 *
 * @param base - The client's currently held query value.
 * @param delta - The wire delta to apply.
 * @returns The reconstructed full query value.
 * @example
 * import { applyQueryDelta } from '@kovojs/core/internal/query-delta';
 *
 * const next = applyQueryDelta(
 *   { count: 2, items: [{ id: 'p1', qty: 1 }] },
 *   { set: { count: 3 }, lists: { items: { key: 'id', upsert: [{ id: 'p1', qty: 2 }] } } },
 * );
 * // next === { count: 3, items: [{ id: 'p1', qty: 2 }] }
 */
export function applyQueryDelta(base: JsonValue | undefined, delta: QueryDelta): JsonValue {
  if (!isPlainObject(base)) {
    throw new QueryDeltaApplyError('cannot apply a query delta without an object base');
  }

  const next: { [key: string]: JsonValue } = structuredClone(base);

  if (delta.set) {
    for (const [field, fieldValue] of Object.entries(delta.set)) next[field] = fieldValue;
  }

  for (const [path, listDelta] of Object.entries(delta.lists ?? {})) {
    next[path] = reconcileList(next[path], listDelta, path);
  }

  return next;
}

function reconcileList(
  baseList: JsonValue | undefined,
  listDelta: QueryListDelta,
  path: string,
): JsonValue[] {
  if (!Array.isArray(baseList)) {
    throw new QueryDeltaApplyError(`query delta targets non-array base collection "${path}"`);
  }

  const removeSet = new Set(listDelta.remove ?? []);
  const upsertByKey = new Map<string, JsonValue>();
  for (const row of listDelta.upsert ?? []) {
    const key = rowKey(row, listDelta.key);
    if (key === undefined) {
      throw new QueryDeltaApplyError(`query delta upsert row missing key "${listDelta.key}"`);
    }
    upsertByKey.set(key, row);
  }

  const result: JsonValue[] = [];
  for (const row of baseList) {
    const key = rowKey(row, listDelta.key);
    if (key !== undefined && removeSet.has(key)) continue;
    if (key !== undefined && upsertByKey.has(key)) {
      result.push(upsertByKey.get(key) as JsonValue);
      upsertByKey.delete(key);
      continue;
    }
    result.push(row);
  }
  // New rows (upserts whose key was not already present) append in wire order.
  for (const row of listDelta.upsert ?? []) {
    const key = rowKey(row, listDelta.key);
    if (key !== undefined && upsertByKey.has(key)) {
      result.push(row);
      upsertByKey.delete(key);
    }
  }

  return result;
}
