import type { JsonValue } from '@kovojs/core';

/**
 * The discriminator key for the canonical wire codec's tagged forms (SPEC §4.1).
 * MUST stay in sync with `KOVO_WIRE_TAG` in `packages/server/src/wire-html.ts`,
 * which produces these tags at the `JSON.stringify` encode seam.
 *
 * A query/transform result column may infer a non-JSON runtime type — `bigint`
 * (Drizzle `bigint`/`numeric`) or `Date` (SPEC §10.2:1018 `timestamp`/`date`).
 * The server normalizes these into `{ [$kovo]: 'bigint'|'date', value }` so
 * `JSON.stringify` never throws on a `bigint` (bugs-part4 L3/L4) and a `Date`
 * keeps its type instead of degrading silently to an ISO string (bugs-part4 L5).
 * This reviver reconstructs them on decode so a `Date` round-trips as a `Date`.
 */
const KOVO_WIRE_TAG = '$kovo' as const;

/**
 * A `JSON.parse` reviver that reconstructs the wire codec's tagged forms back
 * into their runtime types. Only an object whose ONLY enumerable keys are the
 * discriminator and `value` is revived, so ordinary app data carrying a `$kovo`
 * key (e.g. `{ $kovo: 'something', extra: 1 }`) is left untouched.
 */
function reviveWireValue(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;

  const record = value as Record<string, unknown>;
  const tag = record[KOVO_WIRE_TAG];
  if (tag === undefined) return value;

  const keys = Object.keys(record);
  // Exact tagged shape only: the discriminator plus `value`. Anything else is
  // real app data that happens to contain the discriminator key.
  if (keys.length !== 2 || !('value' in record)) return value;

  if (tag === 'bigint' && typeof record.value === 'string') {
    try {
      return BigInt(record.value);
    } catch {
      return value;
    }
  }
  if (tag === 'date') {
    if (record.value === null) return new Date(Number.NaN);
    if (typeof record.value === 'string') return new Date(record.value);
  }
  return value;
}

export function parseJsonValue(
  raw: string,
): { ok: true; value: JsonValue } | { error: unknown; ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw, reviveWireValue) as JsonValue };
  } catch (error) {
    return { error, ok: false };
  }
}

export function malformedJsonError(context: string, cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new Error(`Malformed JSON in ${context}: ${message}`, { cause });
}
