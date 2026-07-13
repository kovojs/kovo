/**
 * @internal Canonical tagged JSON codec for Kovo query/document wire values.
 * SPEC.md §9.1.1 and §9.4 require schema-shaped query JSON that can preserve
 * runtime Date/bigint values without letting package-local encoders drift.
 */
import { isSecret, isUntrusted } from '../secret.js';
import { snapshotAuditText } from './audit-text.js';
import {
  securityApply,
  securityArrayAppend,
  securityDefineProperty,
  securityGetOwnPropertyDescriptor,
  securityGetOwnPropertyNames,
  securityGetOwnPropertySymbols,
  securityGetPrototypeOf,
  securityHasInstance,
  securityHasOwn,
  securityIsArray,
  securityJsonStringify,
  securityNullRecord,
  securityObjectKeys,
  securityOwnArrayEntry,
  securityString,
  securityStringCharCodeAt,
  securityWeakSet,
  securityWeakSetAdd,
  securityWeakSetDelete,
  securityWeakSetHas,
} from './security-witness-intrinsics.js';

const IntrinsicBigInt = globalThis.BigInt;
const IntrinsicArrayPrototype = globalThis.Array.prototype;
const IntrinsicDate = globalThis.Date;
const IntrinsicError = globalThis.Error;
const IntrinsicJSON = globalThis.JSON;
const IntrinsicObjectPrototype = globalThis.Object.prototype;
const IntrinsicTypeError = globalThis.TypeError;
const intrinsicDateGetTime = IntrinsicDate.prototype.getTime;
const intrinsicDateToISOString = IntrinsicDate.prototype.toISOString;
const intrinsicJsonParse = IntrinsicJSON.parse;
const wireJsonControlsSound = verifyWireJsonControls();
const MAX_WIRE_JSON_DEPTH = 64;
const MAX_WIRE_JSON_NODES = 100_000;
const MAX_WIRE_JSON_CHARACTERS = 4_000_000;

interface WireJsonTraversalState {
  characters: number;
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

/** @internal Escaped app record whose exact shape would otherwise collide with a wire tag. */
export interface KovoWireRecordTag {
  readonly [KOVO_WIRE_TAG]: 'record';
  readonly value: readonly (readonly [string, KovoWireJsonEncodedValue | undefined])[];
}

/** @internal JSON-safe value after Kovo wire normalization. */
export type KovoWireJsonEncodedValue =
  | null
  | boolean
  | number
  | string
  | KovoWireBigIntTag
  | KovoWireDateTag
  | KovoWireRecordTag
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
  return jsonSafeWireValueAt(
    value,
    { characters: 0, nodes: 0, seen: securityWeakSet<object>() },
    0,
  );
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
  if (value === undefined) {
    throw new IntrinsicTypeError(
      'Kovo wire JSON cannot encode undefined values; return schema-shaped JSON data.',
    );
  }
  if (typeof value === 'number' && (value !== value || value === Infinity || value === -Infinity)) {
    throw new IntrinsicTypeError('Kovo wire JSON cannot encode non-finite number values.');
  }
  if (typeof value === 'bigint') {
    return wireTag('bigint', securityString(value));
  }
  if (typeof value === 'string') {
    consumeWireJsonCharacters(state, value.length);
    return value;
  }
  if (securityHasInstance(IntrinsicDate, value)) {
    if (
      securityGetPrototypeOf(value as object) !== IntrinsicDate.prototype ||
      securityGetOwnPropertyNames(value as object).length !== 0 ||
      securityGetOwnPropertySymbols(value as object).length !== 0
    ) {
      throw new IntrinsicTypeError(
        'Kovo wire JSON Date values must be exact Date instances without custom properties.',
      );
    }
    assertWireJsonControls();
    const time = securityApply<number>(intrinsicDateGetTime, value, []);
    const iso = time !== time ? null : securityApply<string>(intrinsicDateToISOString, value, []);
    return wireTag('date', iso);
  }
  if (securityIsArray(value)) {
    if (securityGetPrototypeOf(value) !== IntrinsicArrayPrototype) {
      throw new IntrinsicTypeError('Kovo wire JSON arrays must be plain JSON arrays.');
    }
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
    const keys = securityObjectKeys(value);
    if (
      keys.length !== length ||
      securityGetOwnPropertyNames(value).length !== length + 1 ||
      securityGetOwnPropertySymbols(value).length !== 0
    ) {
      throw new IntrinsicTypeError(
        'Kovo wire JSON arrays must contain dense indexed entries without custom properties.',
      );
    }
    for (let index = 0; index < length; index += 1) {
      const descriptor = securityGetOwnPropertyDescriptor(value, securityString(index));
      if (descriptor === undefined) {
        throw new IntrinsicTypeError('Kovo wire JSON arrays must not contain holes.');
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
    const prototype = securityGetPrototypeOf(value);
    if (prototype !== IntrinsicObjectPrototype && prototype !== null) {
      throw new IntrinsicTypeError(
        'Kovo wire JSON objects must be plain JSON records, Date values, or tagged bigint values.',
      );
    }
    if (securityGetOwnPropertySymbols(value).length !== 0) {
      throw new IntrinsicTypeError('Kovo wire JSON objects must not contain symbol properties.');
    }
    if (securityWeakSetHas(state.seen, value)) {
      throw new IntrinsicTypeError('Kovo wire JSON must not contain cyclic values.');
    }
    securityWeakSetAdd(state.seen, value);
    const out = securityNullRecord<unknown>();
    const keys = securityObjectKeys(value);
    if (securityGetOwnPropertyNames(value).length !== keys.length) {
      throw new IntrinsicTypeError(
        'Kovo wire JSON objects must not contain non-enumerable properties.',
      );
    }
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
      consumeWireJsonCharacters(state, key.length);
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
    return escapeAmbiguousWireRecord(out, keys);
  }
  return value;
}

function consumeWireJsonNode(state: WireJsonTraversalState): void {
  state.nodes += 1;
  if (state.nodes > MAX_WIRE_JSON_NODES) {
    throw new IntrinsicTypeError(`Kovo wire JSON exceeds the ${MAX_WIRE_JSON_NODES}-node bound.`);
  }
}

function consumeWireJsonCharacters(state: WireJsonTraversalState, count: number): void {
  state.characters += count;
  if (state.characters > MAX_WIRE_JSON_CHARACTERS) {
    throw new IntrinsicTypeError(
      `Kovo wire JSON exceeds the ${MAX_WIRE_JSON_CHARACTERS}-character aggregate bound.`,
    );
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

function escapeAmbiguousWireRecord(
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> | KovoWireRecordTag {
  if (keys.length !== 2) return value;
  const tagDescriptor = securityGetOwnPropertyDescriptor(value, KOVO_WIRE_TAG);
  const valueDescriptor = securityGetOwnPropertyDescriptor(value, 'value');
  if (
    tagDescriptor === undefined ||
    !('value' in tagDescriptor) ||
    valueDescriptor === undefined ||
    !('value' in valueDescriptor) ||
    valueDescriptor.value === undefined ||
    (tagDescriptor.value !== 'bigint' &&
      tagDescriptor.value !== 'date' &&
      tagDescriptor.value !== 'record')
  ) {
    return value;
  }

  // SPEC §6.6/§9.4: `$kovo` is not reserved from JsonValue app records. Encode a colliding record
  // as data entries so the bottom-up JSON reviver cannot mistake it for a framework primitive.
  const entries: [string, KovoWireJsonEncodedValue | undefined][] = [];
  shadowInheritedToJson(entries);
  for (let index = 0; index < keys.length; index += 1) {
    const keyEntry = securityOwnArrayEntry(keys, index);
    if (!keyEntry.ok) {
      throw new IntrinsicTypeError('Kovo wire JSON objects must contain stable own keys.');
    }
    const descriptor = securityGetOwnPropertyDescriptor(value, keyEntry.value);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new IntrinsicTypeError(
        'Kovo wire JSON objects must contain stable own data properties.',
      );
    }
    const entry: [string, KovoWireJsonEncodedValue | undefined] = [] as unknown as [
      string,
      KovoWireJsonEncodedValue | undefined,
    ];
    shadowInheritedToJson(entry);
    securityArrayAppend(entry, keyEntry.value);
    securityArrayAppend(entry, descriptor.value as KovoWireJsonEncodedValue | undefined);
    securityArrayAppend(entries, entry);
  }

  const escaped = securityNullRecord<unknown>();
  securityDefineProperty(escaped, KOVO_WIRE_TAG, {
    configurable: true,
    enumerable: true,
    value: 'record',
    writable: true,
  });
  securityDefineProperty(escaped, 'value', {
    configurable: true,
    enumerable: true,
    value: entries,
    writable: true,
  });
  return escaped as unknown as KovoWireRecordTag;
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
  // SPEC §9.1.1/§9.4: every encoder-approved record must fit the same finite raw-input envelope
  // enforced by browser/server decoders. JSON escaping and structural punctuation can make the
  // serialized representation larger than the pre-serialization character budget.
  if (result.length > MAX_WIRE_JSON_CHARACTERS) {
    throw new IntrinsicTypeError(
      `Kovo wire JSON serialized output exceeds the ${MAX_WIRE_JSON_CHARACTERS}-character bound.`,
    );
  }
  if (wireHtmlSafeSerializedLength(result) > MAX_WIRE_JSON_CHARACTERS) {
    throw new IntrinsicTypeError(
      `Kovo wire JSON HTML-safe serialized output exceeds the ${MAX_WIRE_JSON_CHARACTERS}-character bound.`,
    );
  }
  return result;
}

function wireHtmlSafeSerializedLength(value: string): number {
  let length = value.length;
  for (let index = 0; index < value.length; index += 1) {
    // Server query scripts and mutation/deferred wire fragments escape each '<' as `\u003c` so
    // HTML parsing cannot terminate the carrier. Account for that 1-to-6 expansion before the
    // browser's raw JSON input bound is reached.
    if (securityStringCharCodeAt(value, index) === 0x3c) length += 5;
    if (length > MAX_WIRE_JSON_CHARACTERS) return length;
  }
  return length;
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

  if (tag === 'record') {
    return reviveEscapedWireRecord(wireValue) ?? value;
  }

  if (tag === 'bigint' && typeof wireValue === 'string') {
    try {
      assertWireJsonControls();
      const decoded = securityApply<bigint>(IntrinsicBigInt, undefined, [wireValue]);
      return securityString(decoded) === wireValue ? decoded : value;
    } catch {
      return value;
    }
  }
  if (tag === 'date') {
    assertWireJsonControls();
    if (wireValue === null) return new IntrinsicDate(IntrinsicNumberNaN());
    if (typeof wireValue === 'string') {
      const decoded = new IntrinsicDate(wireValue);
      const time = securityApply<number>(intrinsicDateGetTime, decoded, []);
      if (
        time === time &&
        securityApply<string>(intrinsicDateToISOString, decoded, []) === wireValue
      ) {
        return decoded;
      }
    }
  }
  return value;
}

function reviveEscapedWireRecord(value: unknown): Record<string, unknown> | undefined {
  if (!securityIsArray(value)) return undefined;
  const lengthDescriptor = securityGetOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    lengthDescriptor.value !== 2
  ) {
    return undefined;
  }

  const record = securityNullRecord<unknown>();
  for (let index = 0; index < 2; index += 1) {
    const pairEntry = securityOwnArrayEntry(value, index);
    if (!pairEntry.ok || !securityIsArray(pairEntry.value)) return undefined;
    const pairLength = securityGetOwnPropertyDescriptor(pairEntry.value, 'length');
    const keyEntry = securityOwnArrayEntry(pairEntry.value, 0);
    const valueEntry = securityOwnArrayEntry(pairEntry.value, 1);
    if (
      pairLength === undefined ||
      !('value' in pairLength) ||
      pairLength.value !== 2 ||
      !keyEntry.ok ||
      typeof keyEntry.value !== 'string' ||
      !valueEntry.ok ||
      (keyEntry.value !== KOVO_WIRE_TAG && keyEntry.value !== 'value') ||
      securityHasOwn(record, keyEntry.value)
    ) {
      return undefined;
    }
    securityDefineProperty(record, keyEntry.value, {
      configurable: true,
      enumerable: true,
      value: valueEntry.value,
      writable: true,
    });
  }
  return securityHasOwn(record, KOVO_WIRE_TAG) && securityHasOwn(record, 'value')
    ? record
    : undefined;
}

/** @internal Parse a Kovo wire JSON string through the shared reviver. */
export function parseWireJsonValue(raw: string): ParseWireJsonResult {
  try {
    assertWireJsonControls();
    if (typeof raw !== 'string') {
      throw new IntrinsicTypeError('Kovo wire JSON input must be a string.');
    }
    if (raw.length > MAX_WIRE_JSON_CHARACTERS) {
      throw new IntrinsicTypeError(
        `Kovo wire JSON input exceeds the ${MAX_WIRE_JSON_CHARACTERS}-character bound.`,
      );
    }
    const parsed = securityApply<unknown>(intrinsicJsonParse, IntrinsicJSON, [raw]);
    return {
      ok: true,
      value: reviveParsedWireValue(
        parsed,
        { characters: 0, nodes: 0, seen: securityWeakSet<object>() },
        0,
      ) as KovoWireJsonDecodedValue,
    };
  } catch (error) {
    return { error, ok: false };
  }
}

function reviveParsedWireValue(
  value: unknown,
  state: WireJsonTraversalState,
  depth: number,
): unknown {
  if (depth > MAX_WIRE_JSON_DEPTH) {
    throw new IntrinsicTypeError(
      `Kovo wire JSON exceeds the ${MAX_WIRE_JSON_DEPTH}-level depth bound.`,
    );
  }
  consumeWireJsonNode(state);
  if (typeof value === 'string') {
    consumeWireJsonCharacters(state, value.length);
    return value;
  }
  if (securityIsArray(value)) {
    const lengthDescriptor = securityGetOwnPropertyDescriptor(value, 'length');
    const length =
      lengthDescriptor !== undefined && 'value' in lengthDescriptor
        ? lengthDescriptor.value
        : undefined;
    if (
      typeof length !== 'number' ||
      length < 0 ||
      length % 1 !== 0 ||
      length > MAX_WIRE_JSON_NODES
    ) {
      throw new IntrinsicTypeError('Kovo parsed wire JSON array has an invalid length.');
    }
    for (let index = 0; index < length; index += 1) {
      const entry = securityOwnArrayEntry(value, index);
      if (!entry.ok) throw new IntrinsicTypeError('Kovo parsed wire JSON array must be dense.');
      securityDefineProperty(value, index, {
        configurable: true,
        enumerable: true,
        value: reviveParsedWireValue(entry.value, state, depth + 1),
        writable: true,
      });
    }
    return value;
  }
  if (value !== null && typeof value === 'object') {
    const keys = securityObjectKeys(value);
    if (keys.length > MAX_WIRE_JSON_NODES) {
      throw new IntrinsicTypeError(
        `Kovo parsed wire JSON object exceeds ${MAX_WIRE_JSON_NODES} entries.`,
      );
    }
    for (let index = 0; index < keys.length; index += 1) {
      const keyEntry = securityOwnArrayEntry(keys, index);
      if (!keyEntry.ok) {
        throw new IntrinsicTypeError('Kovo parsed wire JSON object keys must be dense.');
      }
      consumeWireJsonCharacters(state, keyEntry.value.length);
      const descriptor = securityGetOwnPropertyDescriptor(value, keyEntry.value);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new IntrinsicTypeError('Kovo parsed wire JSON requires own data properties.');
      }
      securityDefineProperty(value, keyEntry.value, {
        configurable: true,
        enumerable: true,
        value: reviveParsedWireValue(descriptor.value, state, depth + 1),
        writable: true,
      });
    }
    return reviveWireValue('', value);
  }
  return value;
}

/** @internal Stable malformed-JSON error message shared by browser readers. */
export function malformedWireJsonError(context: string, cause: unknown): Error {
  const safeContext = snapshotAuditText(context, 'Malformed JSON context');
  let message = 'unknown parse error';
  if (securityHasInstance(IntrinsicError, cause)) {
    const descriptor = securityGetOwnPropertyDescriptor(cause as Error, 'message');
    if (descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string') {
      message = snapshotWireErrorMessage(descriptor.value);
    }
  } else if (
    cause === null ||
    typeof cause === 'boolean' ||
    typeof cause === 'bigint' ||
    typeof cause === 'number' ||
    typeof cause === 'string' ||
    typeof cause === 'symbol' ||
    cause === undefined
  ) {
    message = snapshotWireErrorMessage(securityString(cause));
  }
  return new IntrinsicError(`Malformed JSON in ${safeContext}: ${message}`, { cause });
}

function snapshotWireErrorMessage(value: string): string {
  if (value.length > 4_096) return `${securityString(value.length)} character parse error`;
  return value;
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
