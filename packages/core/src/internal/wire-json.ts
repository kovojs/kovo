/**
 * @internal Canonical tagged JSON codec for Kovo query/document wire values.
 * SPEC.md §9.1.1 and §9.4 require schema-shaped query JSON that can preserve
 * runtime Date/bigint values without letting package-local encoders drift.
 */
import { isSecret, isUntrusted } from '../secret.js';
import {
  securityApply,
  securityDefineProperty,
  securityGetOwnPropertyDescriptor,
  securityHasInstance,
  securityHasOwn,
  securityIsArray,
  securityJsonStringify,
  securityNullRecord,
  securityObjectKeys,
  securityString,
} from './security-witness-intrinsics.js';

const IntrinsicBigInt = globalThis.BigInt;
const IntrinsicDate = globalThis.Date;
const IntrinsicError = globalThis.Error;
const IntrinsicJSON = globalThis.JSON;
const intrinsicDateGetTime = IntrinsicDate.prototype.getTime;
const intrinsicDateToISOString = IntrinsicDate.prototype.toISOString;
const intrinsicJsonParse = IntrinsicJSON.parse;
const wireJsonControlsSound = verifyWireJsonControls();

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
      'KV435 Secret runtime value cannot cross the Kovo client wire; reveal or redact it explicitly before returning it.',
    );
  }
  if (isUntrusted(value)) {
    throw new Error(
      'KV426 Untrusted runtime value cannot cross the Kovo client wire; validate or escape it explicitly before returning it.',
    );
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError(
      'Kovo wire JSON cannot encode function or symbol values; return schema-shaped JSON data.',
    );
  }
  if (typeof value === 'bigint') {
    return { [KOVO_WIRE_TAG]: 'bigint', value: securityString(value) };
  }
  if (securityHasInstance(IntrinsicDate, value)) {
    assertWireJsonControls();
    const time = securityApply<number>(intrinsicDateGetTime, value, []);
    const iso = time !== time ? null : securityApply<string>(intrinsicDateToISOString, value, []);
    return { [KOVO_WIRE_TAG]: 'date', value: iso };
  }
  if (securityIsArray(value)) {
    const out: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = securityGetOwnPropertyDescriptor(value, securityString(index));
      // JSON.stringify emits array holes as null. Reconstruct that exact value rather than
      // dispatching through caller-controlled Array iteration/map methods.
      if (descriptor === undefined) {
        out[index] = null;
        continue;
      }
      if (!('value' in descriptor)) {
        throw new TypeError('Kovo wire JSON arrays must contain stable data properties.');
      }
      out[index] = jsonSafeWireValue(descriptor.value);
    }
    return out;
  }
  if (value !== null && typeof value === 'object') {
    const out = securityNullRecord<unknown>();
    const keys = securityObjectKeys(value);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (key === undefined) continue;
      const descriptor = securityGetOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new TypeError('Kovo wire JSON objects must contain stable own data properties.');
      }
      securityDefineProperty(out, key, {
        configurable: true,
        enumerable: true,
        value: jsonSafeWireValue(descriptor.value),
        writable: true,
      });
    }
    return out;
  }
  return value;
}

/** @internal Stringify through the canonical Kovo wire JSON encoder. */
export function stringifyWireValue(value: unknown): string {
  assertWireJsonControls();
  const result = securityJsonStringify(jsonSafeWireValue(value));
  if (result === undefined) {
    throw new TypeError('Kovo wire JSON cannot encode an undefined top-level value.');
  }
  return result;
}

/**
 * @internal JSON.parse reviver for the canonical Kovo tagged wire forms. Only an
 * exact discriminator + value object is revived; ordinary app records that carry
 * `$kovo` plus additional fields remain application data.
 */
export function reviveWireValue(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || securityIsArray(value)) return value;

  const record = value as Record<string, unknown>;
  const tag = record[KOVO_WIRE_TAG];
  if (tag === undefined) return value;

  const keys = securityObjectKeys(record);
  if (keys.length !== 2 || !securityHasOwn(record, 'value')) return value;

  if (tag === 'bigint' && typeof record.value === 'string') {
    try {
      assertWireJsonControls();
      return securityApply<bigint>(IntrinsicBigInt, undefined, [record.value]);
    } catch {
      return value;
    }
  }
  if (tag === 'date') {
    assertWireJsonControls();
    if (record.value === null) return new IntrinsicDate(IntrinsicNumberNaN());
    if (typeof record.value === 'string') return new IntrinsicDate(record.value);
  }
  return value;
}

/** @internal Parse a Kovo wire JSON string through the shared reviver. */
export function parseWireJsonValue(raw: string): ParseWireJsonResult {
  try {
    assertWireJsonControls();
    return {
      ok: true,
      value: securityApply<KovoWireJsonDecodedValue>(intrinsicJsonParse, IntrinsicJSON, [
        raw,
        reviveWireValue,
      ]),
    };
  } catch (error) {
    return { error, ok: false };
  }
}

/** @internal Stable malformed-JSON error message shared by browser readers. */
export function malformedWireJsonError(context: string, cause: unknown): Error {
  const message = securityHasInstance(IntrinsicError, cause)
    ? (cause as Error).message
    : securityString(cause);
  return new IntrinsicError(`Malformed JSON in ${context}: ${message}`, { cause });
}

function IntrinsicNumberNaN(): number {
  // NaN is the only JavaScript number unequal to itself and needs no mutable Number helper.
  return 0 / 0;
}

function assertWireJsonControls(): void {
  if (!wireJsonControlsSound) {
    throw new TypeError(
      'Kovo wire JSON controls are unavailable because realm intrinsics were modified before framework initialization.',
    );
  }
}

function verifyWireJsonControls(): boolean {
  try {
    const parsed = securityApply<{ kovo?: unknown }>(intrinsicJsonParse, IntrinsicJSON, [
      '{"kovo":418}',
    ]);
    const date = new IntrinsicDate('2020-01-02T03:04:05.678Z');
    const time = securityApply<number>(intrinsicDateGetTime, date, []);
    const iso = securityApply<string>(intrinsicDateToISOString, date, []);
    const bigint = securityApply<bigint>(IntrinsicBigInt, undefined, ['42']);
    return (
      parsed.kovo === 418 &&
      time === 1_577_934_245_678 &&
      iso === '2020-01-02T03:04:05.678Z' &&
      securityString(bigint) === '42'
    );
  } catch {
    return false;
  }
}
