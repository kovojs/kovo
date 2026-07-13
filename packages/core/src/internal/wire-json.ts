/**
 * @internal Canonical tagged JSON codec for Kovo query/document wire values.
 * SPEC.md §9.1.1 and §9.4 require schema-shaped query JSON that can preserve
 * runtime Date/bigint values without letting package-local encoders drift.
 */
import { isSecret, isUntrusted } from '../secret.js';
import {
  securityApply,
  securityArrayAppend,
  securityDefineProperty,
  securityGetOwnPropertyDescriptor,
  securityHasInstance,
  securityHasOwn,
  securityIsArray,
  securityJsonStringify,
  securityNullRecord,
  securityObjectKeys,
  securityOwnArrayEntry,
  securityString,
  securityWeakSet,
  securityWeakSetAdd,
  securityWeakSetDelete,
  securityWeakSetHas,
} from './security-witness-intrinsics.js';

const IntrinsicBigInt = globalThis.BigInt;
const IntrinsicDate = globalThis.Date;
const IntrinsicError = globalThis.Error;
const IntrinsicJSON = globalThis.JSON;
const IntrinsicTypeError = globalThis.TypeError;
const intrinsicDateGetTime = IntrinsicDate.prototype.getTime;
const intrinsicDateToISOString = IntrinsicDate.prototype.toISOString;
const intrinsicJsonParse = IntrinsicJSON.parse;
const wireJsonControlsSound = verifyWireJsonControls();
const MAX_WIRE_JSON_DEPTH = 64;
const MAX_WIRE_JSON_NODES = 100_000;

interface WireJsonTraversalState {
  nodes: number;
  readonly seen: WeakSet<object>;
}

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
  return jsonSafeWireValueAt(value, { nodes: 0, seen: securityWeakSet<object>() }, 0);
}

function jsonSafeWireValueAt(
  value: unknown,
  state: WireJsonTraversalState,
  depth: number,
): unknown {
  // SPEC §6.6/§9.5: wire normalization is a fail-closed runtime boundary, so
  // caller-owned recursive graphs must consume a finite framework budget.
  if (depth > MAX_WIRE_JSON_DEPTH) {
    throw new IntrinsicTypeError(
      `Kovo wire JSON exceeds the ${MAX_WIRE_JSON_DEPTH}-level depth bound.`,
    );
  }
  consumeWireJsonNode(state);
  if (isSecret(value)) {
    throw new IntrinsicError(
      'KV435 Secret runtime value cannot cross the Kovo client wire; reveal or redact it explicitly before returning it.',
    );
  }
  if (isUntrusted(value)) {
    throw new IntrinsicError(
      'KV426 Untrusted runtime value cannot cross the Kovo client wire; validate or escape it explicitly before returning it.',
    );
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new IntrinsicTypeError(
      'Kovo wire JSON cannot encode function or symbol values; return schema-shaped JSON data.',
    );
  }
  if (typeof value === 'bigint') {
    return wireTag('bigint', securityString(value));
  }
  if (securityHasInstance(IntrinsicDate, value)) {
    assertWireJsonControls();
    const time = securityApply<number>(intrinsicDateGetTime, value, []);
    const iso = time !== time ? null : securityApply<string>(intrinsicDateToISOString, value, []);
    return wireTag('date', iso);
  }
  if (securityIsArray(value)) {
    const object = value as object;
    if (securityWeakSetHas(state.seen, object)) {
      throw new IntrinsicTypeError('Kovo wire JSON must not contain cyclic values.');
    }
    const lengthDescriptor = securityGetOwnPropertyDescriptor(value, 'length');
    if (lengthDescriptor === undefined || !securityHasOwn(lengthDescriptor, 'value')) {
      throw new IntrinsicTypeError('Kovo wire JSON arrays must have a stable own-data length.');
    }
    const length = lengthDescriptor.value;
    if (
      typeof length !== 'number' ||
      length < 0 ||
      length % 1 !== 0 ||
      length > MAX_WIRE_JSON_NODES
    ) {
      throw new IntrinsicTypeError(
        `Kovo wire JSON arrays must contain at most ${MAX_WIRE_JSON_NODES} entries.`,
      );
    }
    securityWeakSetAdd(state.seen, object);
    const out: unknown[] = [];
    shadowInheritedToJson(out);
    for (let index = 0; index < length; index += 1) {
      const descriptor = securityGetOwnPropertyDescriptor(value, securityString(index));
      // JSON.stringify emits array holes as null. Reconstruct that exact value rather than
      // dispatching through caller-controlled Array iteration/map methods.
      if (descriptor === undefined) {
        consumeWireJsonNode(state);
        securityArrayAppend(out, null);
        continue;
      }
      if (!('value' in descriptor)) {
        throw new IntrinsicTypeError('Kovo wire JSON arrays must contain stable data properties.');
      }
      securityArrayAppend(out, jsonSafeWireValueAt(descriptor.value, state, depth + 1));
    }
    securityWeakSetDelete(state.seen, object);
    return out;
  }
  if (value !== null && typeof value === 'object') {
    if (securityWeakSetHas(state.seen, value)) {
      throw new IntrinsicTypeError('Kovo wire JSON must not contain cyclic values.');
    }
    securityWeakSetAdd(state.seen, value);
    const out = securityNullRecord<unknown>();
    const keys = securityObjectKeys(value);
    if (keys.length > MAX_WIRE_JSON_NODES) {
      throw new IntrinsicTypeError(
        `Kovo wire JSON objects must contain at most ${MAX_WIRE_JSON_NODES} entries.`,
      );
    }
    for (let index = 0; index < keys.length; index += 1) {
      const keyEntry = securityOwnArrayEntry(keys, index);
      if (!keyEntry.ok) {
        throw new IntrinsicTypeError('Kovo wire JSON objects must contain stable own keys.');
      }
      const key = keyEntry.value;
      const descriptor = securityGetOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new IntrinsicTypeError(
          'Kovo wire JSON objects must contain stable own data properties.',
        );
      }
      securityDefineProperty(out, key, {
        configurable: true,
        enumerable: true,
        value: jsonSafeWireValueAt(descriptor.value, state, depth + 1),
        writable: true,
      });
    }
    securityWeakSetDelete(state.seen, value);
    return out;
  }
  return value;
}

function consumeWireJsonNode(state: WireJsonTraversalState): void {
  state.nodes += 1;
  if (state.nodes > MAX_WIRE_JSON_NODES) {
    throw new IntrinsicTypeError(`Kovo wire JSON exceeds the ${MAX_WIRE_JSON_NODES}-node bound.`);
  }
}

function wireTag(tag: 'bigint', value: string): KovoWireBigIntTag;
function wireTag(tag: 'date', value: string | null): KovoWireDateTag;
function wireTag(
  tag: 'bigint' | 'date',
  value: string | null,
): KovoWireBigIntTag | KovoWireDateTag {
  const out = securityNullRecord<string | null>();
  securityDefineProperty(out, KOVO_WIRE_TAG, {
    configurable: true,
    enumerable: true,
    value: tag,
    writable: true,
  });
  securityDefineProperty(out, 'value', {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
  return out as unknown as KovoWireBigIntTag | KovoWireDateTag;
}

function shadowInheritedToJson(value: unknown[]): void {
  securityDefineProperty(value, 'toJSON', {
    configurable: true,
    enumerable: false,
    value: undefined,
    writable: false,
  });
}

/** @internal Stringify through the canonical Kovo wire JSON encoder. */
export function stringifyWireValue(value: unknown): string {
  assertWireJsonControls();
  const result = securityJsonStringify(jsonSafeWireValue(value));
  if (result === undefined) {
    throw new IntrinsicTypeError('Kovo wire JSON cannot encode an undefined top-level value.');
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
  const keys = securityObjectKeys(record);
  if (keys.length !== 2) return value;

  // SPEC §6.6/§9.4: parsed server truth shares a realm with app code. Reading either field through
  // ordinary property lookup would let an inherited getter fabricate `$kovo` and reinterpret an
  // ordinary two-field record. Only JSON.parse-created own data descriptors may mint a wire tag.
  const tagDescriptor = securityGetOwnPropertyDescriptor(record, KOVO_WIRE_TAG);
  const valueDescriptor = securityGetOwnPropertyDescriptor(record, 'value');
  if (
    tagDescriptor === undefined ||
    !('value' in tagDescriptor) ||
    valueDescriptor === undefined ||
    !('value' in valueDescriptor)
  ) {
    return value;
  }
  const tag = tagDescriptor.value;
  const wireValue = valueDescriptor.value;

  if (tag === 'bigint' && typeof wireValue === 'string') {
    try {
      assertWireJsonControls();
      return securityApply<bigint>(IntrinsicBigInt, undefined, [wireValue]);
    } catch {
      return value;
    }
  }
  if (tag === 'date') {
    assertWireJsonControls();
    if (wireValue === null) return new IntrinsicDate(IntrinsicNumberNaN());
    if (typeof wireValue === 'string') return new IntrinsicDate(wireValue);
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
    throw new IntrinsicTypeError(
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
