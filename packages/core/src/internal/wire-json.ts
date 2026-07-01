/**
 * @internal Canonical tagged JSON codec for Kovo query/document wire values.
 * SPEC.md §9.1.1 and §9.4 require schema-shaped query JSON that can preserve
 * runtime Date/bigint values without letting package-local encoders drift.
 */
import { isSecret } from '../secret.js';

/** @internal Discriminator key for Kovo's tagged wire JSON forms. */
export const KOVO_WIRE_TAG = '$kovo' as const;

/** @internal Tagged bigint form emitted before JSON.stringify. */
export interface KovoWireBigIntTag {
  readonly [KOVO_WIRE_TAG]: 'bigint';
  readonly value: string;
}

/** @internal Tagged Date form emitted before JSON.stringify. */
export interface KovoWireDateTag {
  readonly [KOVO_WIRE_TAG]: 'date';
  readonly value: string | null;
}

/** @internal JSON-safe value after Kovo wire normalization. */
export type KovoWireJsonEncodedValue =
  | null
  | boolean
  | number
  | string
  | KovoWireBigIntTag
  | KovoWireDateTag
  | readonly KovoWireJsonEncodedValue[]
  | { readonly [key: string]: KovoWireJsonEncodedValue | undefined };

/** @internal Runtime value after Kovo wire JSON reviving. */
export type KovoWireJsonDecodedValue =
  | null
  | boolean
  | number
  | string
  | bigint
  | Date
  | readonly KovoWireJsonDecodedValue[]
  | { readonly [key: string]: KovoWireJsonDecodedValue | undefined };

/** @internal Parse result used by browser/server wire readers. */
export type ParseWireJsonResult =
  | { readonly ok: true; readonly value: KovoWireJsonDecodedValue }
  | { readonly error: unknown; readonly ok: false };

/** @internal Contract corpus for package-local wire codec parity tests. */
export interface KovoWireJsonCorpusEntry {
  readonly json: string;
  readonly name: string;
  readonly value: unknown;
}

/** @internal Shared round-trip examples for the Kovo wire JSON vocabulary. */
export const wireJsonRoundTripCorpus: readonly KovoWireJsonCorpusEntry[] = [
  {
    json: 'null',
    name: 'primitive null',
    value: null,
  },
  {
    json: '{"count":2,"enabled":true,"label":"cart"}',
    name: 'primitive record',
    value: { count: 2, enabled: true, label: 'cart' },
  },
  {
    json: '{"$kovo":"date","value":"2020-01-02T03:04:05.678Z"}',
    name: 'top-level Date',
    value: new Date('2020-01-02T03:04:05.678Z'),
  },
  {
    json: '{"$kovo":"date","value":null}',
    name: 'invalid Date',
    value: new Date(Number.NaN),
  },
  {
    json: '{"$kovo":"bigint","value":"9007199254740993"}',
    name: 'top-level bigint',
    value: 9007199254740993n,
  },
  {
    json: '[{"id":{"$kovo":"bigint","value":"1"}},{"at":{"$kovo":"date","value":"2021-06-01T00:00:00.000Z"}}]',
    name: 'array with tagged values',
    value: [{ id: 1n }, { at: new Date('2021-06-01T00:00:00.000Z') }],
  },
  {
    json: '{"order":{"id":"o1","history":[{"at":{"$kovo":"date","value":"2022-03-04T05:06:07.008Z"},"total":{"$kovo":"bigint","value":"42"}}]}}',
    name: 'nested record',
    value: {
      order: {
        id: 'o1',
        history: [{ at: new Date('2022-03-04T05:06:07.008Z'), total: 42n }],
      },
    },
  },
  {
    json: '{"lists":{"items":{"key":"id","upsert":[{"id":"p1","qty":{"$kovo":"bigint","value":"2"}}],"remove":["p0"],"prepend":true}}}',
    name: 'query delta',
    value: {
      lists: {
        items: {
          key: 'id',
          upsert: [{ id: 'p1', qty: 2n }],
          remove: ['p0'],
          prepend: true,
        },
      },
    },
  },
  {
    json: '{"cart":{"count":2,"updatedAt":{"$kovo":"date","value":"2023-01-01T00:00:00.000Z"}}}',
    name: 'document query script value',
    value: { cart: { count: 2, updatedAt: new Date('2023-01-01T00:00:00.000Z') } },
  },
  {
    json: '{"product":{"checkedAt":{"$kovo":"date","value":"2024-02-03T04:05:06.007Z"},"id":"p1","revision":{"$kovo":"bigint","value":"42"},"stock":4}}',
    name: '/_q response value',
    value: {
      product: {
        checkedAt: new Date('2024-02-03T04:05:06.007Z'),
        id: 'p1',
        revision: 42n,
        stock: 4,
      },
    },
  },
];

/**
 * @internal Recursively normalize a runtime value into a JSON.stringify-safe
 * shape at the single Kovo wire encode seam.
 */
export function jsonSafeWireValue(value: unknown): unknown {
  if (isSecret(value)) {
    throw new Error(
      'Secret runtime value cannot cross the Kovo client wire; reveal or redact it explicitly before returning it.',
    );
  }
  if (typeof value === 'bigint') {
    return { [KOVO_WIRE_TAG]: 'bigint', value: value.toString() };
  }
  if (value instanceof Date) {
    const iso = Number.isNaN(value.getTime()) ? null : value.toISOString();
    return { [KOVO_WIRE_TAG]: 'date', value: iso };
  }
  if (Array.isArray(value)) {
    return value.map((item) => jsonSafeWireValue(item));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = jsonSafeWireValue(item);
    }
    return out;
  }
  return value;
}

/** @internal Stringify through the canonical Kovo wire JSON encoder. */
export function stringifyWireValue(value: unknown): string {
  return JSON.stringify(jsonSafeWireValue(value));
}

/**
 * @internal JSON.parse reviver for the canonical Kovo tagged wire forms. Only an
 * exact discriminator + value object is revived; ordinary app records that carry
 * `$kovo` plus additional fields remain application data.
 */
export function reviveWireValue(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;

  const record = value as Record<string, unknown>;
  const tag = record[KOVO_WIRE_TAG];
  if (tag === undefined) return value;

  const keys = Object.keys(record);
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

/** @internal Parse a Kovo wire JSON string through the shared reviver. */
export function parseWireJsonValue(raw: string): ParseWireJsonResult {
  try {
    return { ok: true, value: JSON.parse(raw, reviveWireValue) as KovoWireJsonDecodedValue };
  } catch (error) {
    return { error, ok: false };
  }
}

/** @internal Stable malformed-JSON error message shared by browser readers. */
export function malformedWireJsonError(context: string, cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new Error(`Malformed JSON in ${context}: ${message}`, { cause });
}
