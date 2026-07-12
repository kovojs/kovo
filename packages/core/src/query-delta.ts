import type { JsonValue } from './index.js';
import { cloneJsonValue, jsonEncodedByteLength } from './json-clone.js';
import {
  securityDefineProperty,
  securityGetOwnPropertyDescriptor,
  securityHasOwn,
  securityIsArray,
  securityMap,
  securityMapDelete,
  securityMapGet,
  securityMapHas,
  securityMapSet,
  securityObjectKeys,
  securityOwnArrayEntry,
  securitySet,
  securitySetAdd,
  securitySetHas,
  securitySetValues,
  securityString,
} from '#security-witness-intrinsics';

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
  /**
   * Read-side pagination position (SPEC §9.1.1/§9.3). When `true`, unmatched
   * upsert rows insert at the FRONT of the base collection in wire order instead
   * of appending — the data-side companion to `<kovo-fragment mode="prepend">`
   * for "load older" feeds. Matched rows still reconcile in place by `key`
   * (§13.2). Absent/false ⇒ append (the default; mutation deltas never set it).
   */
  prepend?: boolean;
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
  return typeof value === 'object' && value !== null && !securityIsArray(value);
}

/**
 * Runtime plain-object check that does NOT narrow its argument's static type, so
 * validating the untrusted wire `delta` envelope does not collapse the declared
 * {@link QueryDelta} structure (`lists` → {@link QueryListDelta}) to `JsonValue`.
 */
function isRecordShape(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !securityIsArray(value);
}

function rowKey(row: JsonValue, keyField: string): string | undefined {
  if (!isPlainObject(row)) return undefined;
  const descriptor = securityGetOwnPropertyDescriptor(row, keyField);
  if (descriptor === undefined || !('value' in descriptor)) return undefined;
  const value = descriptor.value;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return securityString(value);
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
 */
export function buildQueryDelta(
  value: JsonValue,
  affectedKeysByDomain: ReadonlyMap<string, ReadonlySet<string>>,
  listMeta: readonly QueryDeltaListMeta[],
): QueryDelta | undefined {
  if (!isPlainObject(value) || listMeta.length === 0) return undefined;

  const lists: { [path: string]: QueryListDelta } = {};
  const collectionPaths = securitySet<string>();

  for (let metaIndex = 0; metaIndex < listMeta.length; metaIndex += 1) {
    const metaEntry = securityOwnArrayEntry(listMeta, metaIndex);
    if (!metaEntry.ok) return undefined;
    const meta = metaEntry.value;
    const affected = securityMapGet(affectedKeysByDomain, meta.domain);
    // No explicit keys for this collection's domain ⇒ the whole collection could
    // have changed ⇒ a scoped delta is not sound. Fall back to full.
    if (affected === undefined || securitySetValues(affected).length === 0) return undefined;

    const collectionDescriptor = securityGetOwnPropertyDescriptor(value, meta.path);
    if (
      collectionDescriptor === undefined ||
      !('value' in collectionDescriptor) ||
      !securityIsArray(collectionDescriptor.value)
    ) {
      return undefined;
    }
    const collection = collectionDescriptor.value as JsonValue[];
    securitySetAdd(collectionPaths, meta.path);

    const upsert: JsonValue[] = [];
    const present = securitySet<string>();
    for (let rowIndex = 0; rowIndex < collection.length; rowIndex += 1) {
      const rowEntry = securityOwnArrayEntry(collection, rowIndex);
      if (!rowEntry.ok) return undefined;
      const row = rowEntry.value;
      const key = rowKey(row, meta.key);
      if (key === undefined) return undefined; // unkeyed row ⇒ cannot scope ⇒ full
      securitySetAdd(present, key);
      if (securitySetHas(affected, key)) upsert[upsert.length] = row;
    }
    const remove: string[] = [];
    const affectedValues = securitySetValues(affected);
    for (let keyIndex = 0; keyIndex < affectedValues.length; keyIndex += 1) {
      const keyEntry = securityOwnArrayEntry(affectedValues, keyIndex);
      if (!keyEntry.ok) return undefined;
      if (!securitySetHas(present, keyEntry.value)) remove[remove.length] = keyEntry.value;
    }

    securityDefineProperty(lists, meta.path, {
      configurable: true,
      enumerable: true,
      value: {
        key: meta.key,
        ...(upsert.length > 0 ? { upsert } : {}),
        ...(remove.length > 0 ? { remove } : {}),
      },
      writable: true,
    });
  }

  const set: { [field: string]: JsonValue } = {};
  const valueKeys = securityObjectKeys(value);
  for (let fieldIndex = 0; fieldIndex < valueKeys.length; fieldIndex += 1) {
    const fieldEntry = securityOwnArrayEntry(valueKeys, fieldIndex);
    if (!fieldEntry.ok) return undefined;
    const field = fieldEntry.value;
    if (securitySetHas(collectionPaths, field)) continue;
    const fieldDescriptor = securityGetOwnPropertyDescriptor(value, field);
    if (fieldDescriptor === undefined || !('value' in fieldDescriptor)) return undefined;
    securityDefineProperty(set, field, {
      configurable: true,
      enumerable: true,
      value: fieldDescriptor.value as JsonValue,
      writable: true,
    });
  }

  return {
    ...(securityObjectKeys(set).length > 0 ? { set } : {}),
    ...(securityObjectKeys(lists).length > 0 ? { lists } : {}),
  };
}

/**
 * @internal
 * Whether a `delta` serializes smaller than the full `value` — the deterministic
 * automatic full-vs-delta selection rule (SPEC §9.1.1). Callers ship the delta
 * only when this holds, so a delta is never larger than the value it replaces.
 */
export function queryDeltaIsSmaller(delta: QueryDelta, value: JsonValue): boolean {
  return jsonEncodedByteLength(delta) < jsonEncodedByteLength(value);
}

/**
 * @internal
 * Apply a change-record-scoped `delta` to the client's held `base` value,
 * returning the reconstructed full value (SPEC §9.1.1). `set` is the parent
 * object sent whole for non-collection fields (§843/§848): its fields overwrite
 * the base, and base non-collection fields absent from `set` are dropped (the
 * only deletion path for a non-keyed field). Keyed collections reconcile by
 * `kovo-key` — matched rows are replaced in place, new rows append, removed keys
 * drop — and their paths (the keys of `delta.lists`) are never treated as dropped
 * fields by the whole-object `set` rule. The result is then fed to the existing
 * update plan (§4.8) exactly like a full value.
 *
 * Throws {@link QueryDeltaApplyError} when the delta cannot be applied to the
 * base — a missing/non-object base, a malformed envelope whose shape is not a
 * plain object (§847 delta-miss), or a field whose shape moved across a deploy —
 * so the caller refetches the full value rather than guessing.
 *
 * @param base - The client's currently held query value.
 * @param delta - The wire delta to apply.
 * @returns The reconstructed full query value.
 */
export function applyQueryDelta(base: JsonValue | undefined, delta: QueryDelta): JsonValue {
  if (!isPlainObject(base)) {
    throw new QueryDeltaApplyError('cannot apply a query delta without an object base');
  }

  // SPEC §847: a malformed/shape-skewed envelope is a delta-miss, not a silent
  // no-op apply. Throwing routes the caller to onDeltaMiss → full refetch
  // (browser/src/query-apply.ts) instead of swallowing corrupted truth as success.
  if (!isRecordShape(delta)) {
    throw new QueryDeltaApplyError('cannot apply a non-object query delta envelope');
  }
  if (delta.set !== undefined && !isRecordShape(delta.set)) {
    throw new QueryDeltaApplyError('query delta "set" is not a plain object');
  }
  if (delta.lists !== undefined && !isRecordShape(delta.lists)) {
    throw new QueryDeltaApplyError('query delta "lists" is not a plain object');
  }

  const next: { [key: string]: JsonValue } = cloneJsonValue(base);

  // SPEC §843/§848 (KV416): for non-collection (non-keyed) top-level fields the
  // value is "the parent object sent whole" — `set` is the authoritative
  // whole-object-minus-collections. The ONLY way to drop a non-keyed field is to
  // send its parent whole with the field omitted, so a base top-level key absent
  // from `set` is a dropped field and must be removed. Tracked COLLECTION paths
  // (the keys of `delta.lists`) are reconciled by identity below and MUST NEVER be
  // deleted by this rule — they are not part of the whole-object `set`. This
  // mirrors buildQueryDelta, which emits `set` as exactly value-minus-collectionPaths.
  if (delta.set) {
    const listPaths = securitySet<string>();
    const listPathKeys = securityObjectKeys(delta.lists ?? {});
    for (let index = 0; index < listPathKeys.length; index += 1) {
      const pathEntry = securityOwnArrayEntry(listPathKeys, index);
      if (!pathEntry.ok) throw new QueryDeltaApplyError('query delta list paths are unstable');
      securitySetAdd(listPaths, pathEntry.value);
    }
    const nextFields = securityObjectKeys(next);
    for (let index = 0; index < nextFields.length; index += 1) {
      const fieldEntry = securityOwnArrayEntry(nextFields, index);
      if (!fieldEntry.ok) throw new QueryDeltaApplyError('query delta base fields are unstable');
      const field = fieldEntry.value;
      if (!securityHasOwn(delta.set, field) && !securitySetHas(listPaths, field)) {
        delete next[field];
      }
    }
    // part-4 L2-protopollution-1: assign as an OWN data property. Bracket assignment of a
    // `__proto__` field from the wire/DB would invoke the prototype setter (rebinding the value
    // object's prototype + dropping the field) instead of replacing the field wholesale (§9.1.1).
    const setFields = securityObjectKeys(delta.set);
    for (let index = 0; index < setFields.length; index += 1) {
      const fieldEntry = securityOwnArrayEntry(setFields, index);
      if (!fieldEntry.ok) throw new QueryDeltaApplyError('query delta set fields are unstable');
      const field = fieldEntry.value;
      const valueDescriptor = securityGetOwnPropertyDescriptor(delta.set, field);
      if (valueDescriptor === undefined || !('value' in valueDescriptor)) {
        throw new QueryDeltaApplyError(`query delta set field "${field}" is unstable`);
      }
      securityDefineProperty(next, field, {
        configurable: true,
        enumerable: true,
        value: valueDescriptor.value as JsonValue,
        writable: true,
      });
    }
  }

  const listFields = securityObjectKeys(delta.lists ?? {});
  for (let index = 0; index < listFields.length; index += 1) {
    const pathEntry = securityOwnArrayEntry(listFields, index);
    if (!pathEntry.ok) throw new QueryDeltaApplyError('query delta list fields are unstable');
    const path = pathEntry.value;
    const listDescriptor = securityGetOwnPropertyDescriptor(delta.lists ?? {}, path);
    if (listDescriptor === undefined || !('value' in listDescriptor)) {
      throw new QueryDeltaApplyError(`query delta list field "${path}" is unstable`);
    }
    const baseDescriptor = securityGetOwnPropertyDescriptor(next, path);
    const baseList =
      baseDescriptor !== undefined && 'value' in baseDescriptor
        ? (baseDescriptor.value as JsonValue)
        : undefined;
    securityDefineProperty(next, path, {
      configurable: true,
      enumerable: true,
      value: reconcileList(baseList, listDescriptor.value as QueryListDelta, path),
      writable: true,
    });
  }

  return next;
}

function reconcileList(
  baseList: JsonValue | undefined,
  listDelta: QueryListDelta,
  path: string,
): JsonValue[] {
  if (!securityIsArray(baseList)) {
    throw new QueryDeltaApplyError(`query delta targets non-array base collection "${path}"`);
  }

  const removeSet = securitySet<string>();
  const remove = listDelta.remove ?? [];
  if (!securityIsArray(remove)) {
    throw new QueryDeltaApplyError(`query delta remove list for "${path}" is not an array`);
  }
  for (let index = 0; index < remove.length; index += 1) {
    const entry = securityOwnArrayEntry(remove, index);
    if (!entry.ok || typeof entry.value !== 'string') {
      throw new QueryDeltaApplyError(`query delta remove list for "${path}" is unstable`);
    }
    securitySetAdd(removeSet, entry.value);
  }
  const upsertByKey = securityMap<string, JsonValue>();
  const upsert = listDelta.upsert ?? [];
  if (!securityIsArray(upsert)) {
    throw new QueryDeltaApplyError(`query delta upsert list for "${path}" is not an array`);
  }
  for (let index = 0; index < upsert.length; index += 1) {
    const entry = securityOwnArrayEntry(upsert, index);
    if (!entry.ok) {
      throw new QueryDeltaApplyError(`query delta upsert list for "${path}" is unstable`);
    }
    const row = entry.value as JsonValue;
    const key = rowKey(row, listDelta.key);
    if (key === undefined) {
      throw new QueryDeltaApplyError(`query delta upsert row missing key "${listDelta.key}"`);
    }
    securityMapSet(upsertByKey, key, row);
  }

  const kept: JsonValue[] = [];
  for (let index = 0; index < baseList.length; index += 1) {
    const entry = securityOwnArrayEntry(baseList, index);
    if (!entry.ok) throw new QueryDeltaApplyError(`query delta base list "${path}" is unstable`);
    const row = entry.value as JsonValue;
    const key = rowKey(row, listDelta.key);
    if (key !== undefined && securitySetHas(removeSet, key)) continue;
    if (key !== undefined && securityMapHas(upsertByKey, key)) {
      kept[kept.length] = securityMapGet(upsertByKey, key) as JsonValue;
      securityMapDelete(upsertByKey, key);
      continue;
    }
    kept[kept.length] = row;
  }
  // New rows (upserts whose key was not already present), in wire order.
  const added: JsonValue[] = [];
  for (let index = 0; index < upsert.length; index += 1) {
    const entry = securityOwnArrayEntry(upsert, index);
    if (!entry.ok) throw new QueryDeltaApplyError(`query delta upsert list "${path}" is unstable`);
    const row = entry.value as JsonValue;
    const key = rowKey(row, listDelta.key);
    if (key !== undefined && securityMapHas(upsertByKey, key)) {
      added[added.length] = row;
      securityMapDelete(upsertByKey, key);
    }
  }

  // SPEC §9.1.1/§9.3 read-side pagination: a `prepend` delta inserts the new page
  // at the FRONT of the held list (load older), otherwise new rows append (load
  // more). Matched rows already reconciled in place above either way.
  const result: JsonValue[] = [];
  const first = listDelta.prepend ? added : kept;
  const second = listDelta.prepend ? kept : added;
  for (let index = 0; index < first.length; index += 1) {
    const entry = securityOwnArrayEntry(first, index);
    if (!entry.ok) throw new QueryDeltaApplyError(`query delta result for "${path}" is unstable`);
    result[result.length] = entry.value;
  }
  for (let index = 0; index < second.length; index += 1) {
    const entry = securityOwnArrayEntry(second, index);
    if (!entry.ok) throw new QueryDeltaApplyError(`query delta result for "${path}" is unstable`);
    result[result.length] = entry.value;
  }
  return result;
}
