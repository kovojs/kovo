import {
  isUntrusted,
  revealUntrusted,
  type JsonValue,
  type Secret,
  type StorageObjectInfo,
  type StoragePutCapability,
} from '@kovojs/core';

import {
  type UnverifiedAcceptance,
  mintStorageKey,
  sanitizeDownloadFilename,
  sniffUploadBytes,
} from './upload-sniff.js';
import {
  type BlessedFormatName,
  type LinearRegexProgram,
  type UnsafeRegexBrand,
  PATTERN_MAX_INPUT_LENGTH,
  compileLinearPattern,
  testLinearPattern,
} from './redos.js';
import {
  createWitnessSet,
  createWitnessWeakMap,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessObjectIs,
  witnessObjectKeys,
  witnessReflectApply,
  witnessSetAdd,
  witnessSetHas,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';
import {
  requestCreateNullRecord,
  requestBlobArrayBuffer,
  requestBlobSize,
  requestBlobType,
  requestFileName,
  requestFormDataEntries,
  requestIsFile,
  requestIsFormData,
  requestIsPlainRecord,
} from './request-body-intrinsics.js';
import {
  assertResponseSecurityIntrinsics,
  securityArrayIsArray,
  securityArrayJoin,
  securityCreateDate,
  securityCreateRegExp,
  securityDateGetTime,
  securityDateToISOString,
  securityIsDate,
  securityJsonParse,
  securityNumber,
  securityNumberIsFinite,
  securityNumberIsInteger,
  securityNumberIsNaN,
  securityRegExpFlags,
  securityRegExpSource,
  securityRegExpTest,
  securityString,
  securityStringCharCodeAt,
  securityStringEndsWith,
  securityStringIncludes,
  securityStringIndexOf,
  securityStringLastIndexOf,
  securityStringReplaceAll,
  securityStringSlice,
  securityStringSplit,
  securityStringStartsWith,
  securityStringToLowerCase,
  securityStringTrim,
  securityUint8ArrayFromArrayBuffer,
  securityUint8ArraySlice,
} from './response-security-intrinsics.js';

/** A validator that parses unknown input into a typed value (throwing `SchemaValidationError` on failure). */
export interface Schema<T> {
  parse(input: unknown): T;
}

/** Extract the parsed value type of a `Schema`. */
export type InferSchema<T> = T extends Schema<infer Value> ? Value : never;

interface AsyncSchema<T> extends Schema<T> {
  parseAsync(input: unknown): Promise<T>;
}

type SchemaMetadata =
  | { kind: 'array'; item: Schema<unknown> }
  | { kind: 'file'; maxBytes?: number }
  | { kind: 'object'; shape: Readonly<Record<string, Schema<unknown>>> }
  | { kind: 'record'; value: Schema<unknown> }
  | { kind: 'stored-file'; maxBytes?: number };

const schemaMetadata = createWitnessWeakMap<Schema<unknown>, SchemaMetadata>();

/** @internal Pin a schema's executable parse identities for a closed app declaration. */
export function snapshotSchemaForRuntime<Value>(
  source: Schema<Value>,
  label: string,
): Schema<Value> {
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    throw new TypeError(`${label} must expose a stable schema object.`);
  }
  const parse = stableSchemaMethod(source, 'parse', label)!;
  const parseAsync = stableSchemaMethod(source, 'parseAsync', label, true);
  const snapshot: AsyncSchema<Value> = {
    parse(input: unknown): Value {
      return witnessReflectApply(parse, source, [input]);
    },
    async parseAsync(input: unknown): Promise<Value> {
      return parseAsync === undefined
        ? witnessReflectApply(parse, source, [input])
        : await witnessReflectApply(parseAsync, source, [input]);
    },
  };
  const metadata = witnessWeakMapGet(schemaMetadata, source as Schema<unknown>);
  if (metadata !== undefined) {
    witnessWeakMapSet(schemaMetadata, snapshot as Schema<unknown>, metadata);
  }
  return witnessFreeze(snapshot);
}

function stableSchemaMethod(
  source: object,
  property: 'parse' | 'parseAsync',
  label: string,
  optional = false,
): Function | undefined {
  let owner: object | null = source;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const before = witnessGetOwnPropertyDescriptor(owner, property);
    const prototype = witnessGetPrototypeOf(owner);
    const after = witnessGetOwnPropertyDescriptor(owner, property);
    if (!sameSchemaDataDescriptor(before, after)) {
      throw new TypeError(`${label}.${property} changed while the schema was closed.`);
    }
    if (before !== undefined) {
      if (!('value' in before) || typeof before.value !== 'function') {
        throw new TypeError(`${label}.${property} must be a stable data method.`);
      }
      return before.value;
    }
    if (witnessGetPrototypeOf(owner) !== prototype) {
      throw new TypeError(`${label}.${property} prototype changed while the schema was closed.`);
    }
    owner = prototype;
  }
  if (optional) return undefined;
  throw new TypeError(`${label}.parse must be a stable data method.`);
}

function sameSchemaDataDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    'value' in left &&
    'value' in right &&
    witnessObjectIs(left.value, right.value) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
}

function snapshotSchemaShape<Shape extends Record<string, Schema<unknown>>>(shape: Shape): Shape {
  if (typeof shape !== 'object' || shape === null || securityArrayIsArray(shape)) {
    throw new TypeError('s.object(shape) requires a stable own-data schema record.');
  }
  assertSafeObjectShape(shape);
  const snapshot: Record<string, Schema<unknown>> = {};
  const keys = witnessObjectKeys(shape);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const before = witnessGetOwnPropertyDescriptor(shape, key);
    const after = witnessGetOwnPropertyDescriptor(shape, key);
    if (!sameSchemaDataDescriptor(before, after) || before === undefined || !('value' in before)) {
      throw new TypeError(`s.object(shape).${key} must be a stable own data property.`);
    }
    witnessDefineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: snapshotSchemaForRuntime(before.value as Schema<unknown>, `s.object(shape).${key}`),
      writable: false,
    });
  }
  return witnessFreeze(snapshot) as Shape;
}

function appendSchemaArrayValue<Value>(values: Value[], value: Value): void {
  witnessDefineProperty(values, values.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function arrayEvery<Value>(
  values: readonly Value[],
  predicate: (value: Value) => boolean,
): boolean {
  for (let index = 0; index < values.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(values, index);
    if (descriptor === undefined || !('value' in descriptor) || !predicate(descriptor.value)) {
      return false;
    }
  }
  return true;
}

function ownRecordValues(record: Record<string, unknown>): unknown[] {
  const values: unknown[] = [];
  const keys = witnessObjectKeys(record);
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(record, keys[index]!);
    if (descriptor === undefined || !('value' in descriptor)) continue;
    appendSchemaArrayValue(values, descriptor.value);
  }
  return values;
}

function recordValuesEvery(
  record: Record<string, unknown>,
  predicate: (value: unknown) => boolean,
): boolean {
  const keys = witnessObjectKeys(record);
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(record, keys[index]!);
    if (descriptor === undefined || !('value' in descriptor) || !predicate(descriptor.value)) {
      return false;
    }
  }
  return true;
}

/** @internal Return the declared upload bytes needed by file schemas nested in this schema. */
export function schemaMaxUploadBytes(schema: Schema<unknown>): number | undefined {
  const metadata = witnessWeakMapGet(schemaMetadata, schema);
  if (metadata === undefined) return undefined;

  if (metadata.kind === 'file' || metadata.kind === 'stored-file') return metadata.maxBytes;
  if (metadata.kind === 'array') return schemaMaxUploadBytes(metadata.item);
  if (metadata.kind === 'record') return schemaMaxUploadBytes(metadata.value);
  if (metadata.kind === 'object') {
    let total = 0;
    let found = false;
    const keys = witnessObjectKeys(metadata.shape);
    for (let index = 0; index < keys.length; index += 1) {
      const child = metadata.shape[keys[index]!]!;
      const childMaxBytes = schemaMaxUploadBytes(child);
      if (childMaxBytes === undefined) continue;
      total += childMaxBytes;
      found = true;
    }
    return found ? total : undefined;
  }

  return undefined;
}

/**
 * A single field-level validation failure: a human `message` and the `path` of record
 * keys/array indices locating it. Carried on `SchemaValidationError.issues` and surfaced
 * on the mutation 422 typed-error path (SPEC §9.2).
 */
export interface ValidationIssue {
  message: string;
  path: readonly string[];
}

/**
 * The wire shape of a schema validation failure: the collected per-field `issues`.
 * Returned on the mutation 422 response so forms can render field errors (SPEC §9.2).
 */
export interface ValidationFailurePayload {
  issues: readonly ValidationIssue[];
}

export type SchemaValidationErrorLike = Error & {
  readonly issues: readonly ValidationIssue[];
};

/** Thrown by a schema's `parse` when input is invalid; carries the per-field `issues`. */
export class SchemaValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(firstValidationIssueMessage(issues));
    this.name = 'SchemaValidationError';
    this.issues = issues;
  }
}

export function isSchemaValidationError(error: unknown): error is SchemaValidationErrorLike {
  if (typeof error !== 'object' || error === null) return false;
  const name = witnessGetOwnPropertyDescriptor(error, 'name');
  const message = witnessGetOwnPropertyDescriptor(error, 'message');
  const issues = witnessGetOwnPropertyDescriptor(error, 'issues');
  return (
    name !== undefined &&
    'value' in name &&
    name.value === 'SchemaValidationError' &&
    message !== undefined &&
    'value' in message &&
    typeof message.value === 'string' &&
    issues !== undefined &&
    'value' in issues &&
    securityArrayIsArray(issues.value) &&
    arrayEvery(issues.value, isValidationIssue)
  );
}

function firstValidationIssueMessage(issues: readonly ValidationIssue[]): string {
  const issue = witnessGetOwnPropertyDescriptor(issues, 0);
  if (issue === undefined || !('value' in issue) || !isValidationIssue(issue.value)) {
    return 'Invalid input';
  }
  const message = witnessGetOwnPropertyDescriptor(issue.value, 'message');
  return message !== undefined && 'value' in message ? message.value : 'Invalid input';
}

/**
 * The schema builder. Compose validators with `s.object`, `s.string`,
 * `s.number`, `s.decimal`, `s.date`, `s.datetime`, `s.json`, `s.boolean`, `s.array`, and `s.file`;
 * each returns a `Schema`
 * whose `parse` coerces and validates `FormData`-shaped input, so the same
 * schema validates JSON and form submissions (SPEC §6.3).
 *
 * @example
 * import { s } from '@kovojs/server';
 *
 * const input = s.object({
 *   productId: s.string(),
 *   quantity: s.number().int().min(1).default(1),
 *   tags: s.array(s.string()),
 * });
 *
 * const parsed = input.parse({ productId: 'p1', quantity: '2', tags: 'a' });
 * // parsed.quantity === 2, parsed.tags === ['a']
 */
export const s = {
  array<Item>(item: Schema<Item>): Schema<Item[]> {
    const closedItem = snapshotSchemaForRuntime(item, 's.array(item)');
    // `parseAsync` mirrors `s.object` (SPEC §6): each item flows through
    // `parseSchemaAsync` so a storing item schema (`s.file().store()`) runs its
    // async `storage.put`/`normalizeStorageKey` path. Without it, the runtime's
    // async input parse (`parseSchemaAsync`) would fall back to the sync `parse`
    // below, which for a storing file schema fabricates a result with no upload
    // and no key normalization (data loss + traversal-key passthrough; Part 4 M1).
    const schema: AsyncSchema<Item[]> = {
      parse(input: unknown): Item[] {
        const values = arrayValues(input);
        const output: Item[] = [];
        for (let index = 0; index < values.length; index += 1) {
          try {
            witnessDefineProperty(output, index, {
              configurable: true,
              enumerable: true,
              value: closedItem.parse(values[index]),
              writable: true,
            });
          } catch (error) {
            throw validationErrorFrom(error, [securityString(index)]);
          }
        }
        return output;
      },
      async parseAsync(input: unknown): Promise<Item[]> {
        const output: Item[] = [];

        const values = arrayValues(input);
        for (let index = 0; index < values.length; index += 1) {
          try {
            witnessDefineProperty(output, index, {
              configurable: true,
              enumerable: true,
              value: await parseSchemaAsync(closedItem, values[index], true),
              writable: true,
            });
          } catch (error) {
            throw validationErrorFrom(error, [securityString(index)]);
          }
        }

        return output;
      },
    };
    witnessWeakMapSet(schemaMetadata, schema, {
      item: closedItem as Schema<unknown>,
      kind: 'array',
    });
    return witnessFreeze(schema);
  },
  boolean(): Schema<boolean> {
    return {
      parse(input: unknown): boolean {
        input = revealSchemaInput(input);
        if (typeof input === 'boolean') return input;
        if (input === undefined || input === null || input === '') return false;
        if (typeof input === 'number' && (input === 0 || input === 1)) return input === 1;

        if (typeof input === 'string') {
          const value = securityStringToLowerCase(input);
          if (value === '1' || value === 'on' || value === 'true' || value === 'yes') return true;
          if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
        }

        throw validationError('Expected boolean');
      },
    };
  },
  date(): DateSchema {
    return new DateSchemaImpl('date');
  },
  datetime(): DateSchema {
    return new DateSchemaImpl('datetime');
  },
  decimal(options: DecimalSchemaOptions = {}): DecimalSchema {
    return new DecimalSchemaImpl(options);
  },
  file(options: FileSchemaOptions = {}): FileSchema {
    return new FileSchemaImpl(options);
  },
  json<Value extends JsonValue = JsonValue>(): Schema<Value> {
    return {
      parse(input: unknown): Value {
        input = revealSchemaInput(input);
        const value = typeof input === 'string' ? parseJsonInput(input) : input;
        if (!isJsonValue(value)) throw validationError('Expected JSON value');
        return value as Value;
      },
    };
  },
  string(): StringSchema {
    return new StringSchemaImpl();
  },
  number(): NumberSchema {
    return new NumberSchemaImpl();
  },
  secret<Value>(schema: Schema<Value>): Schema<Secret<Value>> {
    const closedSchema = snapshotSchemaForRuntime(schema, 's.secret(schema)');
    return witnessFreeze({
      parse(input: unknown): Secret<Value> {
        input = revealSchemaInput(input);
        return closedSchema.parse(input) as Secret<Value>;
      },
    });
  },
  object<const Shape extends Record<string, Schema<unknown>>>(
    shape: Shape,
  ): Schema<{ [Key in keyof Shape]: InferSchema<Shape[Key]> }> {
    const closedShape = snapshotSchemaShape(shape);
    const schema: AsyncSchema<{ [Key in keyof Shape]: InferSchema<Shape[Key]> }> = {
      parse(input: unknown): { [Key in keyof Shape]: InferSchema<Shape[Key]> } {
        const record = formLikeToRecord(input);
        const output: Partial<{ [Key in keyof Shape]: InferSchema<Shape[Key]> }> = {};

        const keys = witnessObjectKeys(closedShape);
        for (let index = 0; index < keys.length; index += 1) {
          const key = keys[index] as keyof Shape;
          const fieldSchema = closedShape[key]!;
          try {
            output[key] = fieldSchema.parse(
              readOwnInputField(record, securityString(key)),
            ) as InferSchema<Shape[keyof Shape]>;
          } catch (error) {
            throw validationErrorFrom(error, [securityString(key)]);
          }
        }

        return output as { [Key in keyof Shape]: InferSchema<Shape[Key]> };
      },
      async parseAsync(input: unknown): Promise<{ [Key in keyof Shape]: InferSchema<Shape[Key]> }> {
        const record = formLikeToRecord(input);
        const output: Partial<{ [Key in keyof Shape]: InferSchema<Shape[Key]> }> = {};

        const keys = witnessObjectKeys(closedShape);
        for (let index = 0; index < keys.length; index += 1) {
          const key = keys[index] as keyof Shape;
          const fieldSchema = closedShape[key]!;
          try {
            output[key] = (await parseSchemaAsync(
              fieldSchema,
              readOwnInputField(record, securityString(key)),
              true,
            )) as InferSchema<Shape[keyof Shape]>;
          } catch (error) {
            throw validationErrorFrom(error, [securityString(key)]);
          }
        }

        return output as { [Key in keyof Shape]: InferSchema<Shape[Key]> };
      },
    };
    witnessWeakMapSet(schemaMetadata, schema, { kind: 'object', shape: closedShape });
    return witnessFreeze(schema);
  },
  record<Value>(value: Schema<Value>): Schema<Record<string, Value>> {
    const closedValue = snapshotSchemaForRuntime(value, 's.record(value)');
    const schema: AsyncSchema<Record<string, Value>> = {
      parse(input: unknown): Record<string, Value> {
        const record = recordInput(input);
        const output = requestCreateNullRecord<Value>() as Record<string, Value>;

        const keys = witnessObjectKeys(record);
        for (let index = 0; index < keys.length; index += 1) {
          const key = keys[index]!;
          const field = readOwnInputField(record, key);
          assertSafeRecordKey(key);
          try {
            output[key] = closedValue.parse(field);
          } catch (error) {
            throw validationErrorFrom(error, [key]);
          }
        }

        return output;
      },
      async parseAsync(input: unknown): Promise<Record<string, Value>> {
        const record = recordInput(input);
        const output = requestCreateNullRecord<Value>() as Record<string, Value>;

        const keys = witnessObjectKeys(record);
        for (let index = 0; index < keys.length; index += 1) {
          const key = keys[index]!;
          const field = readOwnInputField(record, key);
          assertSafeRecordKey(key);
          try {
            output[key] = await parseSchemaAsync(closedValue, field, true);
          } catch (error) {
            throw validationErrorFrom(error, [key]);
          }
        }

        return output;
      },
    };
    witnessWeakMapSet(schemaMetadata, schema, {
      kind: 'record',
      value: closedValue as Schema<unknown>,
    });
    return witnessFreeze(schema);
  },
};

/** @internal Returns top-level mutation input fields that require multipart form encoding. */
export function mutationInputFileFields(schema: Schema<unknown>): readonly string[] {
  const metadata = witnessWeakMapGet(schemaMetadata, schema);
  if (metadata?.kind !== 'object') return [];

  const fields: string[] = [];
  const keys = witnessObjectKeys(metadata.shape);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (schemaContainsFile(metadata.shape[key]!)) appendSchemaArrayValue(fields, key);
  }
  return fields;
}

function schemaContainsFile(schema: Schema<unknown>): boolean {
  const metadata = witnessWeakMapGet(schemaMetadata, schema);
  if (!metadata) return false;
  if (metadata.kind === 'file' || metadata.kind === 'stored-file') return true;
  if (metadata.kind === 'array') return schemaContainsFile(metadata.item);
  if (metadata.kind === 'object') {
    const keys = witnessObjectKeys(metadata.shape);
    for (let index = 0; index < keys.length; index += 1) {
      if (schemaContainsFile(metadata.shape[keys[index]!]!)) return true;
    }
    return false;
  }
  if (metadata.kind === 'record') return schemaContainsFile(metadata.value);
  return false;
}

/** Minimal uploaded-file shape accepted by `s.file()` schemas (SPEC.md §6). */
export interface FileLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  name: string;
  size: number;
  type: string;
}

/**
 * File-upload schema produced by `s.file()`; chains a size limit, a verified content-type
 * allowlist via `.accept(...)`, and `.store()` (SPEC.md §6; KV428 SPEC §6.6/§9.1).
 *
 * KV428 (plans/secure-framework.md Phase 6 Tier 1): the legacy `.mime()` was REMOVED — it trusted
 * the client-declared `file.type`, the verbatim-client-MIME hole. The replacement `.accept(...)`
 * checks against the SERVER-SNIFFED type (`accept([...])`) or takes the audited
 * `accept.unverified([...], justification)` escape, which is surfaced in `kovo explain
 * --capabilities`.
 */
export interface FileSchema extends Schema<FileLike> {
  maxBytes(value: number): FileSchema;
  /**
   * Restrict accepted uploads to an allowlist of content types. Pass `accept([...types])` from
   * `@kovojs/server` to check against the SERVER-SNIFFED bytes (server truth), or
   * `accept.unverified([...types], justification)` to trust the client-declared MIME (the audited
   * escape, surfaced in `kovo explain --capabilities`). KV428 (SPEC §6.6/§9.1).
   */
  accept(acceptance: UnverifiedAcceptance | readonly string[]): FileSchema;
  /**
   * Parse an uploaded file and, for verified `accept([...])`, enforce the allowlist against the
   * server-sniffed bytes rather than the client-declared MIME (SPEC §6.6/§9.1, KV428).
   */
  parseAsync(input: unknown): Promise<FileLike>;
  store(options: StoredFileSchemaOptions): StoredFileSchema;
}

/** Size/content-type constraints captured by an `s.file()` schema (SPEC.md §6; KV428 §6.6/§9.1). */
export interface FileSchemaOptions {
  maxBytes?: number;
  /**
   * The accepted content types: a plain string allowlist checked against the SERVER-SNIFFED type,
   * or an `accept.unverified(...)` acceptance that trusts the client-declared MIME (audited).
   */
  accept?: UnverifiedAcceptance | readonly string[];
}

/** Result of a stored upload produced by `s.file().store(...)` (SPEC.md §6). */
export interface StoredFileUpload {
  file: FileLike;
  key: string;
  storage: StorageObjectInfo;
}

/** Stored-upload schema produced by `s.file().store(...)` (SPEC.md §6). */
export interface StoredFileSchema extends AsyncSchema<StoredFileUpload> {}

/**
 * Options for `s.file().store(...)`: storage capability, an optional key namespace, and metadata
 * (SPEC.md §6; KV428 SPEC §6.6/§9.1).
 *
 * KV428: the storage key is SERVER-GENERATED and opaque by construction (a random UUID, optionally
 * namespaced by `keyPrefix`). The client filename is NEVER the key — it is sanitized download
 * metadata only, killing path-traversal/overwrite. The legacy author-controlled `key` callback was
 * removed; pass `keyPrefix` to namespace uploads.
 */
export interface StoredFileSchemaOptions {
  /** Optional namespace segment for the server-minted random key (e.g. `'avatars'`). */
  keyPrefix?: string;
  metadata?: (file: FileLike) => Readonly<Record<string, string>>;
  storage: StoragePutCapability;
}

/**
 * String schema produced by `s.string()`; chains a blessed-format check (`.email()`/`.url()`/
 * `.uuid()`/`.slug()`), a linear-engine `.pattern(...)` literal, or the audited
 * `.matches(unsafeRegex)` escape (KV434, SPEC §6.6/§9.5).
 *
 * KV434: blessed formats are backtracking-free BY-CONSTRUCTION; `.pattern(literal)` compiles to
 * Kovo's bounded Thompson-NFA/Pike VM subset; unsupported syntax must use
 * `unsafeRegex(re, justification)`, the audited escape surfaced in `kovo explain --capabilities`.
 */
export interface StringSchema extends Schema<string> {
  default(value: string): StringSchema;
  optional(): Schema<string | undefined>;
  /**
   * Admit line terminators in string values while still rejecting other raw C0 controls and DEL
   * (SPEC §6.6).
   */
  multiline(): StringSchema;
  /** Admit arbitrary raw control characters, including line terminators (SPEC §6.6). */
  allowControlChars(): StringSchema;
  /** Restrict to one of the blessed backtracking-free formats (KV434). */
  format(name: BlessedFormatName): StringSchema;
  email(): StringSchema;
  url(): StringSchema;
  uuid(): StringSchema;
  slug(): StringSchema;
  /**
   * Require the value to match a COMPILE-VISIBLE literal pattern. Supported syntax is matched by
   * Kovo's linear engine; unsupported syntax must use `.matches(unsafeRegex(...))`.
   */
  pattern(source: RegExp | string): StringSchema;
  /** Match against an audited {@link unsafeRegex} brand — the escape for an unanalyzable pattern (KV434). */
  matches(brand: UnsafeRegexBrand): StringSchema;
}

/** Numeric schema produced by `s.number()`; chains int/min/default refinements (SPEC.md §6). */
export interface NumberSchema extends Schema<number> {
  default(value: number): NumberSchema;
  int(): NumberSchema;
  max(value: number): NumberSchema;
  min(value: number): NumberSchema;
  optional(): Schema<number | undefined>;
}

/** Decimal schema produced by `s.decimal()`; keeps numeric values as strings for Postgres `numeric`. */
export interface DecimalSchema extends Schema<string> {
  default(value: string): DecimalSchema;
  optional(): Schema<string | undefined>;
}

export interface DecimalSchemaOptions {
  /** Maximum number of fractional digits accepted. */
  scale?: number;
}

class DecimalSchemaImpl implements DecimalSchema {
  readonly #defaultValue: string | undefined;
  readonly #scale: number | undefined;

  constructor(options: DecimalSchemaOptions & { defaultValue?: string } = {}) {
    this.#defaultValue = options.defaultValue;
    this.#scale = options.scale;
  }

  default(value: string): DecimalSchema {
    const parsed = parseDecimalString(value, this.#scale);
    return new DecimalSchemaImpl({
      defaultValue: parsed,
      ...(this.#scale === undefined ? {} : { scale: this.#scale }),
    });
  }

  optional(): Schema<string | undefined> {
    return optionalSchema(this, isMissingStringInput);
  }

  parse(input: unknown): string {
    input = revealSchemaInput(input);
    const value =
      input === undefined || input === null || input === '' ? this.#defaultValue : input;
    if (typeof value !== 'string') throw validationError('Expected decimal string');
    return parseDecimalString(value, this.#scale);
  }
}

/** Date/datetime schema produced by `s.date()` or `s.datetime()`; parses form strings to `Date`. */
export interface DateSchema extends Schema<Date> {
  default(value: Date | string): DateSchema;
  optional(): Schema<Date | undefined>;
}

class DateSchemaImpl implements DateSchema {
  readonly #defaultValue: Date | undefined;
  readonly #kind: 'date' | 'datetime';

  constructor(kind: 'date' | 'datetime', defaultValue?: Date) {
    this.#kind = kind;
    this.#defaultValue = defaultValue;
  }

  default(value: Date | string): DateSchema {
    return new DateSchemaImpl(this.#kind, parseDateInput(value, this.#kind));
  }

  optional(): Schema<Date | undefined> {
    return optionalSchema(this, isMissingStringInput);
  }

  parse(input: unknown): Date {
    input = revealSchemaInput(input);
    const value =
      input === undefined || input === null || input === '' ? this.#defaultValue : input;
    return parseDateInput(value, this.#kind);
  }
}

interface NumberSchemaOptions {
  defaultValue?: number;
  integer?: boolean;
  maximum?: number;
  minimum?: number;
}

class NumberSchemaImpl implements NumberSchema {
  readonly #defaultValue: number | undefined;
  readonly #integer: boolean;
  readonly #maximum: number | undefined;
  readonly #minimum: number | undefined;

  constructor(options: NumberSchemaOptions = {}) {
    this.#defaultValue = options.defaultValue;
    this.#integer = options.integer ?? false;
    this.#maximum = options.maximum;
    this.#minimum = options.minimum;
  }

  default(value: number): NumberSchema {
    return new NumberSchemaImpl({
      defaultValue: value,
      integer: this.#integer,
      ...(this.#maximum === undefined ? {} : { maximum: this.#maximum }),
      ...(this.#minimum === undefined ? {} : { minimum: this.#minimum }),
    });
  }

  int(): NumberSchema {
    return new NumberSchemaImpl({
      ...(this.#defaultValue === undefined ? {} : { defaultValue: this.#defaultValue }),
      integer: true,
      ...(this.#maximum === undefined ? {} : { maximum: this.#maximum }),
      ...(this.#minimum === undefined ? {} : { minimum: this.#minimum }),
    });
  }

  max(value: number): NumberSchema {
    return new NumberSchemaImpl({
      ...(this.#defaultValue === undefined ? {} : { defaultValue: this.#defaultValue }),
      integer: this.#integer,
      maximum: value,
      ...(this.#minimum === undefined ? {} : { minimum: this.#minimum }),
    });
  }

  min(value: number): NumberSchema {
    return new NumberSchemaImpl({
      ...(this.#defaultValue === undefined ? {} : { defaultValue: this.#defaultValue }),
      integer: this.#integer,
      ...(this.#maximum === undefined ? {} : { maximum: this.#maximum }),
      minimum: value,
    });
  }

  optional(): Schema<number | undefined> {
    return optionalSchema(this, isMissingNumberInput);
  }

  parse(input: unknown): number {
    input = revealSchemaInput(input);
    const value =
      input === undefined || input === null || input === '' ? this.#defaultValue : input;
    const number = typeof value === 'number' ? value : securityNumber(value);

    if (!securityNumberIsFinite(number)) throw validationError('Expected number');
    if (this.#integer && !securityNumberIsInteger(number))
      throw validationError('Expected integer');
    if (this.#minimum !== undefined && number < this.#minimum) {
      throw validationError(`Expected number >= ${this.#minimum}`);
    }
    if (this.#maximum !== undefined && number > this.#maximum) {
      throw validationError(`Expected number <= ${this.#maximum}`);
    }

    return number;
  }
}

/** One refinement a `StringSchema` applies in order: a blessed format, a linear-safe pattern, or an audited regex. */
type StringCheck =
  | { kind: 'format'; name: BlessedFormatName }
  | { kind: 'pattern'; program: LinearRegexProgram; source: string }
  | { kind: 'unsafe'; regex: RegExp };

type StringControlPolicy = 'single-line' | 'multiline' | 'allow';

class StringSchemaImpl implements StringSchema {
  readonly #checks: readonly StringCheck[];
  readonly #controlPolicy: StringControlPolicy;
  readonly #defaultValue: string | undefined;

  constructor(
    checks: readonly StringCheck[] = [],
    defaultValue?: string,
    controlPolicy: StringControlPolicy = 'single-line',
  ) {
    this.#checks = checks;
    this.#defaultValue = defaultValue;
    this.#controlPolicy = controlPolicy;
  }

  #with(check: StringCheck): StringSchema {
    const checks: StringCheck[] = [];
    for (let index = 0; index < this.#checks.length; index += 1) {
      appendSchemaArrayValue(checks, this.#checks[index]!);
    }
    appendSchemaArrayValue(checks, check);
    return new StringSchemaImpl(checks, this.#defaultValue, this.#controlPolicy);
  }

  default(value: string): StringSchema {
    return new StringSchemaImpl(this.#checks, value, this.#controlPolicy);
  }

  optional(): Schema<string | undefined> {
    return optionalSchema(this, isMissingStringInput);
  }

  multiline(): StringSchema {
    return new StringSchemaImpl(this.#checks, this.#defaultValue, 'multiline');
  }

  allowControlChars(): StringSchema {
    return new StringSchemaImpl(this.#checks, this.#defaultValue, 'allow');
  }

  format(name: BlessedFormatName): StringSchema {
    return this.#with({ kind: 'format', name });
  }
  email(): StringSchema {
    return this.format('email');
  }
  url(): StringSchema {
    return this.format('url');
  }
  uuid(): StringSchema {
    return this.format('uuid');
  }
  slug(): StringSchema {
    return this.format('slug');
  }

  pattern(source: RegExp | string): StringSchema {
    assertResponseSecurityIntrinsics();
    const src = typeof source === 'string' ? source : securityRegExpSource(source);
    // KV434: compile to the framework-owned linear engine before the pattern can run. A
    // dynamic/non-literal pattern reaches here as a runtime value the compiler cannot inspect; the
    // KV434 lint flags that at the call site, and `unsafeRegex(...)` is the audited JS RegExp escape.
    const flags =
      typeof source === 'string' ? '' : stableValidationRegexFlags(securityRegExpFlags(source));
    return this.#with({ kind: 'pattern', program: compileLinearPattern(src, flags), source: src });
  }

  matches(brand: UnsafeRegexBrand): StringSchema {
    // The audited escape: the ReDoS risk was accepted + recorded at `unsafeRegex(...)`.
    const source = securityRegExpSource(brand.regex);
    const flags = stableValidationRegexFlags(securityRegExpFlags(brand.regex));
    return this.#with({ kind: 'unsafe', regex: securityCreateRegExp(source, flags) });
  }

  parse(input: unknown): string {
    input = revealSchemaInput(input);
    if (isMissingStringInput(input) && this.#defaultValue !== undefined) {
      input = this.#defaultValue;
    }
    if (typeof input !== 'string') throw validationError('Expected string');

    assertStringControlPolicy(input, this.#controlPolicy);

    for (let index = 0; index < this.#checks.length; index += 1) {
      const check = this.#checks[index];
      if (check === undefined) throw validationError('Expected stable string checks');
      if (check.kind === 'format') {
        if (!testBlessedFormat(check.name, input)) {
          throw validationError(`Expected ${check.name}`);
        }
        continue;
      }
      if (input.length > PATTERN_MAX_INPUT_LENGTH) {
        throw validationError(
          `Expected string matching pattern (input exceeds the ${PATTERN_MAX_INPUT_LENGTH}-char match budget)`,
        );
      }
      if (check.kind === 'pattern') {
        if (!testLinearPattern(check.program, input)) {
          throw validationError('Expected string matching pattern');
        }
      } else if (!securityRegExpTest(check.regex, input))
        throw validationError('Expected string matching pattern');
    }

    return input;
  }
}

function stableValidationRegexFlags(flags: string): string {
  return securityStringReplaceAll(securityStringReplaceAll(flags, 'g', ''), 'y', '');
}

function testBlessedFormat(name: BlessedFormatName, value: string): boolean {
  switch (name) {
    case 'email':
      return isBlessedEmail(value);
    case 'slug':
      return isBlessedSlug(value);
    case 'url':
      return isBlessedUrl(value);
    case 'uuid':
      return isBlessedUuid(value);
  }
}

function isAsciiLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isAsciiDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function isBlessedSlug(value: string): boolean {
  if (value.length === 0 || value.length > 256) return false;
  let previousHyphen = true;
  for (let index = 0; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    if (isAsciiDigit(code) || (code >= 0x61 && code <= 0x7a)) {
      previousHyphen = false;
    } else if (code === 0x2d) {
      if (previousHyphen) return false;
      previousHyphen = true;
    } else {
      return false;
    }
  }
  return !previousHyphen;
}

function isBlessedUuid(value: string): boolean {
  if (value.length !== 36) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    if (index === 8 || index === 13 || index === 18 || index === 23) {
      if (code !== 0x2d) return false;
    } else if (
      !isAsciiDigit(code) &&
      !(code >= 0x41 && code <= 0x46) &&
      !(code >= 0x61 && code <= 0x66)
    ) {
      return false;
    }
  }
  return true;
}

function isBlessedEmail(value: string): boolean {
  if (value.length === 0 || value.length > 254) return false;
  const at = securityStringIndexOf(value, '@');
  if (at <= 0 || at !== securityStringLastIndexOf(value, '@')) return false;
  const local = securityStringSlice(value, 0, at);
  const domain = securityStringSlice(value, at + 1);
  if (local.length > 64 || domain.length === 0) return false;
  let previousDot = true;
  for (let index = 0; index < local.length; index += 1) {
    const code = securityStringCharCodeAt(local, index);
    if (code === 0x2e) {
      if (previousDot) return false;
      previousDot = true;
    } else if (
      isAsciiLetter(code) ||
      isAsciiDigit(code) ||
      securityStringIncludes("!#$%&'*+/=?^_`{|}~-", securityStringSlice(local, index, index + 1))
    ) {
      previousDot = false;
    } else {
      return false;
    }
  }
  return !previousDot && isBlessedDomain(domain);
}

function isBlessedDomain(domain: string): boolean {
  if (domain.length > 253) return false;
  const labels = securityStringSplit(domain, '.');
  if (labels.length < 2) return false;
  for (let labelIndex = 0; labelIndex < labels.length; labelIndex += 1) {
    const label = labels[labelIndex]!;
    if (
      label.length === 0 ||
      label.length > 63 ||
      securityStringStartsWith(label, '-') ||
      securityStringEndsWith(label, '-')
    ) {
      return false;
    }
    for (let index = 0; index < label.length; index += 1) {
      const code = securityStringCharCodeAt(label, index);
      if (!isAsciiLetter(code) && !isAsciiDigit(code) && code !== 0x2d) return false;
    }
  }
  const tld = labels[labels.length - 1]!;
  for (let index = 0; index < tld.length; index += 1) {
    if (!isAsciiLetter(securityStringCharCodeAt(tld, index))) return false;
  }
  return true;
}

function isBlessedUrl(value: string): boolean {
  if (value.length === 0 || value.length > 2_048) return false;
  const lower = securityStringToLowerCase(value);
  const scheme = securityStringStartsWith(lower, 'https://')
    ? 8
    : securityStringStartsWith(lower, 'http://')
      ? 7
      : -1;
  if (scheme === -1) return false;
  const rest = securityStringSlice(value, scheme);
  if (rest.length === 0) return false;
  let end = rest.length;
  for (let index = 0; index < rest.length; index += 1) {
    const code = securityStringCharCodeAt(rest, index);
    if (code === 0x2f || code === 0x3f || code === 0x23) {
      end = index;
      break;
    }
  }
  const authority = securityStringSlice(rest, 0, end);
  const colon = securityStringLastIndexOf(authority, ':');
  const host = colon === -1 ? authority : securityStringSlice(authority, 0, colon);
  if (colon !== -1) {
    const port = securityStringSlice(authority, colon + 1);
    if (port.length === 0 || port.length > 5) return false;
    for (let index = 0; index < port.length; index += 1) {
      if (!isAsciiDigit(securityStringCharCodeAt(port, index))) return false;
    }
  }
  return host === 'localhost' || isBlessedDomain(host);
}

function assertStringControlPolicy(input: string, policy: StringControlPolicy): void {
  if (policy === 'allow') return;

  for (let index = 0; index < input.length; index += 1) {
    const code = securityStringCharCodeAt(input, index);
    if (isLineTerminatorCode(code)) {
      if (policy === 'multiline') continue;
      throw validationError('Expected string without line terminators');
    }
    if (code <= 0x1f || code === 0x7f) {
      throw validationError('Expected string without raw control characters');
    }
  }
}

function isLineTerminatorCode(code: number): boolean {
  return code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029;
}

function parseDecimalString(input: string, scale: number | undefined): string {
  const value = securityStringTrim(input);
  if (!securityRegExpTest(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u, value)) {
    throw validationError('Expected decimal string');
  }
  if (scale !== undefined) {
    const fractional = securityStringSplit(value, '.')[1]?.length ?? 0;
    if (fractional > scale) throw validationError(`Expected decimal with <= ${scale} decimals`);
  }
  return value;
}

function parseDateInput(input: unknown, kind: 'date' | 'datetime'): Date {
  if (securityIsDate(input)) {
    const timestamp = securityDateGetTime(input);
    if (securityNumberIsNaN(timestamp)) throw validationError(`Expected ${kind}`);
    return securityCreateDate(timestamp);
  }
  if (typeof input !== 'string') throw validationError(`Expected ${kind}`);
  const value = securityStringTrim(input);
  if (kind === 'date' && !securityRegExpTest(/^\d{4}-\d{2}-\d{2}$/u, value)) {
    throw validationError('Expected date');
  }
  const date = securityCreateDate(kind === 'date' ? `${value}T00:00:00.000Z` : value);
  if (securityNumberIsNaN(securityDateGetTime(date))) throw validationError(`Expected ${kind}`);
  if (kind === 'date' && securityStringSlice(securityDateToISOString(date), 0, 10) !== value) {
    throw validationError('Expected date');
  }
  return date;
}

function parseJsonInput(input: string): unknown {
  try {
    return securityJsonParse(input);
  } catch {
    throw validationError('Expected JSON value');
  }
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  switch (typeof value) {
    case 'boolean':
    case 'number':
    case 'string':
      return securityNumberIsFinite(value) || typeof value !== 'number';
    case 'object':
      if (securityArrayIsArray(value)) return arrayEvery(value, isJsonValue);
      if (!isPlainJsonObject(value)) return false;
      return recordValuesEvery(value as Record<string, unknown>, isJsonValue);
    default:
      return false;
  }
}

function isPlainJsonObject(value: object): boolean {
  return requestIsPlainRecord(value);
}

class FileSchemaImpl implements FileSchema {
  readonly #maxBytes: number | undefined;
  readonly #accept: UnverifiedAcceptance | readonly string[] | undefined;

  constructor(options: FileSchemaOptions = {}) {
    this.#maxBytes = options.maxBytes;
    this.#accept = snapshotFileAcceptance(options.accept);
    witnessWeakMapSet(schemaMetadata, this, {
      kind: 'file',
      ...(this.#maxBytes === undefined ? {} : { maxBytes: this.#maxBytes }),
    });
  }

  maxBytes(value: number): FileSchema {
    return new FileSchemaImpl({
      maxBytes: value,
      ...(this.#accept === undefined ? {} : { accept: this.#accept }),
    });
  }

  accept(acceptance: UnverifiedAcceptance | readonly string[]): FileSchema {
    return new FileSchemaImpl({
      ...(this.#maxBytes === undefined ? {} : { maxBytes: this.#maxBytes }),
      accept: acceptance,
    });
  }

  parse(input: unknown): FileLike {
    return parseFileLikeSync(input, createFileOptions(this.#maxBytes, this.#accept));
  }

  async parseAsync(input: unknown): Promise<FileLike> {
    return parseFileLikeAsync(input, createFileOptions(this.#maxBytes, this.#accept));
  }

  store(options: StoredFileSchemaOptions): StoredFileSchema {
    return new StoredFileSchemaImpl(createFileOptions(this.#maxBytes, this.#accept), options);
  }
}

class StoredFileSchemaImpl implements StoredFileSchema {
  readonly #fileOptions: FileSchemaOptions;
  readonly #storageOptions: StoredFileSchemaOptions;

  constructor(fileOptions: FileSchemaOptions, storageOptions: StoredFileSchemaOptions) {
    this.#fileOptions = fileOptions;
    this.#storageOptions = storageOptions;
    witnessWeakMapSet(schemaMetadata, this, {
      kind: 'stored-file',
      ...(fileOptions.maxBytes === undefined ? {} : { maxBytes: fileOptions.maxBytes }),
    });
  }

  parse(_input: unknown): StoredFileUpload {
    // Storing a file is inherently async: it must `await storage.put(...)` (which
    // also runs `normalizeStorageKey`). The sync `parse` cannot do that, so it must
    // NOT fabricate a `StoredFileUpload` (no upload, unnormalized key — Part 4 M1).
    // Callers reach the storing path through `parseSchemaAsync`/`parseAsync`; a sync
    // `parse` here is a programming error, so throw a non-validation Error.
    throw new Error('s.file().store(): storing requires async parsing; call parseAsync (SPEC §6).');
  }

  async parseAsync(input: unknown): Promise<StoredFileUpload> {
    const { bytes, file, name, sniffed, type } = await parseVerifiedFileLike(
      input,
      this.#fileOptions,
    );

    // KV428 (SPEC §6.6/§9.1): the storage key is SERVER-GENERATED and opaque (random UUID), never
    // derived from the client filename. This kills path traversal / overwrite by construction — an
    // attacker `../../etc/passwd` name can no longer become the storage key.
    const key = mintStorageKey(this.#storageOptions.keyPrefix);

    // KV428: mint the stored contentType from the SNIFFED bytes (server truth overrides the client
    // lie). The audited `accept.unverified(...)` escape trusts the client-declared `file.type`
    // instead (recorded for `kovo explain --capabilities`). The bytes are already buffered, so the
    // deep sniff is free.
    const contentType = isUnverifiedAcceptance(this.#fileOptions.accept)
      ? type
      : sniffed.contentType;

    const storage = await this.#storageOptions.storage.put(key, securityUint8ArraySlice(bytes), {
      ...(contentType === '' ? {} : { contentType }),
      metadata: {
        ...this.#storageOptions.metadata?.(file),
        // The client filename is sanitized framework-owned download METADATA only — never the key.
        // Keep it last so app metadata cannot replace the value that later reaches
        // Content-Disposition at the stored-file sink (SPEC §6.6 / §9.1).
        filename: sanitizeDownloadFilename(name),
      },
    });

    return { file, key, storage };
  }
}

function isUnverifiedAcceptance(
  accept: UnverifiedAcceptance | readonly string[] | undefined,
): accept is UnverifiedAcceptance {
  if (typeof accept !== 'object' || accept === null || securityArrayIsArray(accept)) return false;
  const unverified = witnessGetOwnPropertyDescriptor(accept, 'unverified');
  return unverified !== undefined && 'value' in unverified && unverified.value === true;
}

function snapshotFileAcceptance(
  accept: UnverifiedAcceptance | readonly string[] | undefined,
): UnverifiedAcceptance | readonly string[] | undefined {
  if (accept === undefined) return undefined;
  if (securityArrayIsArray(accept)) {
    const snapshot: string[] = [];
    const length = witnessGetOwnPropertyDescriptor(accept, 'length');
    if (length === undefined || !('value' in length) || length.value > 1_000) {
      throw new TypeError('s.file().accept(...) requires a bounded dense MIME array.');
    }
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(accept, index);
      if (
        descriptor === undefined ||
        !('value' in descriptor) ||
        typeof descriptor.value !== 'string'
      ) {
        throw new TypeError('s.file().accept(...) requires stable MIME string data.');
      }
      witnessDefineProperty(snapshot, index, {
        configurable: true,
        enumerable: true,
        value: descriptor.value,
        writable: true,
      });
    }
    return witnessFreeze(snapshot);
  }
  if (typeof accept !== 'object' || accept === null) {
    throw new TypeError('s.file().accept(...) requires a MIME array or audited acceptance.');
  }
  const unverified = witnessGetOwnPropertyDescriptor(accept, 'unverified');
  const justification = witnessGetOwnPropertyDescriptor(accept, 'justification');
  const types = witnessGetOwnPropertyDescriptor(accept, 'types');
  if (
    unverified?.value !== true ||
    typeof justification?.value !== 'string' ||
    types === undefined ||
    !('value' in types)
  ) {
    throw new TypeError('s.file().accept.unverified(...) must expose stable audit data.');
  }
  return witnessFreeze({
    justification: justification.value,
    types: snapshotFileAcceptance(types.value as readonly string[]) as readonly string[],
    unverified: true as const,
  });
}

function stringArrayIncludes(values: readonly string[], expected: string): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === expected) return true;
  }
  return false;
}

function createFileOptions(
  maxBytes: number | undefined,
  accept: UnverifiedAcceptance | readonly string[] | undefined,
): FileSchemaOptions {
  return {
    ...(maxBytes === undefined ? {} : { maxBytes }),
    ...(accept === undefined ? {} : { accept }),
  };
}

function arrayValues(input: unknown): unknown[] {
  input = revealSchemaInput(input);
  if (input === undefined || input === null) return [];
  return securityArrayIsArray(input) ? input : [input];
}

function optionalSchema<Value>(
  schema: Schema<Value>,
  isMissing: (input: unknown) => boolean,
): Schema<Value | undefined> {
  return {
    parse(input: unknown): Value | undefined {
      input = revealSchemaInput(input);
      return isMissing(input) ? undefined : schema.parse(input);
    },
  };
}

function isMissingStringInput(input: unknown): boolean {
  return input === undefined || input === null;
}

function isMissingNumberInput(input: unknown): boolean {
  return input === undefined || input === null || input === '';
}

const PROTOTYPE_POLLUTION_KEYS = createWitnessSet<string>();
witnessSetAdd(PROTOTYPE_POLLUTION_KEYS, '__proto__');
witnessSetAdd(PROTOTYPE_POLLUTION_KEYS, 'constructor');
witnessSetAdd(PROTOTYPE_POLLUTION_KEYS, 'prototype');

function assertSafeObjectShape(shape: Record<string, Schema<unknown>>): void {
  const keys = witnessObjectKeys(shape);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (witnessSetHas(PROTOTYPE_POLLUTION_KEYS, key)) {
      throw new Error(
        `s.object(): "${key}" is reserved by the prototype-pollution input floor (SPEC §6.6).`,
      );
    }
  }
}

function assertSafeRecordKey(key: string): void {
  if (!witnessSetHas(PROTOTYPE_POLLUTION_KEYS, key)) return;
  throw validationError(
    `s.record(): "${key}" is reserved by the prototype-pollution input floor (SPEC §6.6).`,
    [key],
  );
}

function readOwnInputField(record: Record<string, unknown>, key: string): unknown {
  // OPP-19 (SPEC §6.6 runtime-DiD): schema decode is shape-bound and must not let inherited
  // properties satisfy declared fields. JSON/form payloads can carry prototype-pollution names, but
  // object schemas project only own, declared fields into the validated value.
  const descriptor = witnessGetOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

function parseFileLikeSync(input: unknown, options: FileSchemaOptions): FileLike {
  const snapshot = parseFileLikeShape(input, options);
  const accept = options.accept;
  if (isUnverifiedAcceptance(accept)) {
    if (accept.types.length > 0 && !stringArrayIncludes(accept.types, snapshot.type)) {
      throw validationError(`Expected file type ${securityArrayJoin(accept.types, ', ')}`);
    }
  } else if (accept && accept.length > 0) {
    // SPEC §6.6/§9.1, KV428: verified `accept([...])` has one enforcing path:
    // `parseVerifiedFileLike`, which buffers and sniffs server-side bytes. Sync parsing cannot await
    // `file.arrayBuffer()`, so this is the intentional sync/async divergence: fail closed rather
    // than duplicating a client-MIME check that would drift from the async sniffing contract.
    throw new Error(
      's.file().accept([...]): verified file type checks require async parsing; call parseAsync (SPEC §6.6/§9.1).',
    );
  }

  return snapshot.file;
}

async function parseFileLikeAsync(input: unknown, options: FileSchemaOptions): Promise<FileLike> {
  const { file } = await parseVerifiedFileLike(input, options);
  return file;
}

async function parseVerifiedFileLike(
  input: unknown,
  options: FileSchemaOptions,
): Promise<{
  bytes: Uint8Array;
  file: FileLike;
  name: string;
  sniffed: ReturnType<typeof sniffUploadBytes>;
  type: string;
}> {
  const snapshot = parseFileLikeShape(input, options);
  const bytes = securityUint8ArrayFromArrayBuffer(await snapshot.readBytes());
  const sniffed = sniffUploadBytes(bytes);
  const accept = options.accept;
  if (isUnverifiedAcceptance(accept)) {
    if (accept.types.length > 0 && !stringArrayIncludes(accept.types, snapshot.type)) {
      throw validationError(`Expected file type ${securityArrayJoin(accept.types, ', ')}`);
    }
  } else if (accept && accept.length > 0 && !stringArrayIncludes(accept, sniffed.contentType)) {
    throw validationError(`Expected file type ${securityArrayJoin(accept, ', ')}`);
  }

  return {
    bytes,
    file: snapshot.file,
    name: snapshot.name,
    sniffed,
    type: snapshot.type,
  };
}

interface FileLikeSnapshot {
  file: FileLike;
  name: string;
  readBytes(): Promise<ArrayBuffer>;
  size: number;
  type: string;
}

function parseFileLikeShape(input: unknown, options: FileSchemaOptions): FileLikeSnapshot {
  input = revealSchemaInput(input);
  const snapshot = snapshotFileLike(input);
  if (snapshot === undefined) throw validationError('Expected file');
  if (options.maxBytes !== undefined && snapshot.size > options.maxBytes) {
    throw validationError(`Expected file <= ${options.maxBytes} bytes`);
  }

  return snapshot;
}

function snapshotFileLike(value: unknown): FileLikeSnapshot | undefined {
  if (requestIsFile(value)) {
    return {
      file: value,
      name: requestFileName(value),
      readBytes: () => requestBlobArrayBuffer(value),
      size: requestBlobSize(value),
      type: requestBlobType(value),
    };
  }
  if (typeof value !== 'object' || value === null) return undefined;

  const arrayBuffer = witnessGetOwnPropertyDescriptor(value, 'arrayBuffer');
  const name = witnessGetOwnPropertyDescriptor(value, 'name');
  const size = witnessGetOwnPropertyDescriptor(value, 'size');
  const type = witnessGetOwnPropertyDescriptor(value, 'type');
  if (
    arrayBuffer === undefined ||
    !('value' in arrayBuffer) ||
    typeof arrayBuffer.value !== 'function' ||
    name === undefined ||
    !('value' in name) ||
    typeof name.value !== 'string' ||
    size === undefined ||
    !('value' in size) ||
    typeof size.value !== 'number' ||
    type === undefined ||
    !('value' in type) ||
    typeof type.value !== 'string'
  ) {
    return undefined;
  }
  const file = value as FileLike;
  const readBytes = arrayBuffer.value;
  return {
    file,
    name: name.value,
    readBytes: () => witnessReflectApply(readBytes, file, []),
    size: size.value,
    type: type.value,
  };
}

export function formLikeToRecord(input: unknown): Record<string, unknown> {
  input = revealSchemaInput(input);
  if (requestIsFormData(input)) {
    return entriesToRecord(requestFormDataEntries(input));
  }

  if (typeof input === 'object' && input !== null) return input as Record<string, unknown>;
  throw validationError('Expected object input');
}

function recordInput(input: unknown): Record<string, unknown> {
  const record = formLikeToRecord(input);
  if (securityArrayIsArray(record)) throw validationError('Expected record input');
  return record;
}

function validationError(message: string, path: readonly string[] = []): SchemaValidationError {
  return new SchemaValidationError([{ message, path }]);
}

/**
 * Re-key a caught field/item error under `pathPrefix`. Only an already-validation
 * error is re-wrapped (to prepend the path); any other exception — e.g. a
 * `storage.put` failure inside `s.file().store()` — is re-thrown UNCHANGED so its
 * raw internal `.message` never gets laundered into a `SchemaValidationError` and
 * leaked to the client through the 422 path. Such errors must reach the 500 path
 * (Part 4 L1). Returns the wrapped validation error; callers `throw` the result,
 * but for non-validation input this function throws before returning.
 */
function validationErrorFrom(error: unknown, pathPrefix: readonly string[]): SchemaValidationError {
  if (isSchemaValidationError(error)) {
    const issues: ValidationIssue[] = [];
    const errorIssues = stableValidationIssues(error);
    for (let index = 0; index < errorIssues.length; index += 1) {
      const issue = stableValidationIssue(errorIssues, index);
      appendSchemaArrayValue(issues, {
        message: issue.message,
        path: mergeValidationPath(pathPrefix, issue.path),
      });
    }
    return new SchemaValidationError(issues);
  }

  throw error;
}

function isValidationIssue(value: unknown): value is ValidationIssue {
  if (typeof value !== 'object' || value === null) return false;
  const message = witnessGetOwnPropertyDescriptor(value, 'message');
  const path = witnessGetOwnPropertyDescriptor(value, 'path');
  return (
    message !== undefined &&
    'value' in message &&
    typeof message.value === 'string' &&
    path !== undefined &&
    'value' in path &&
    securityArrayIsArray(path.value) &&
    arrayEvery(path.value, (segment) => typeof segment === 'string')
  );
}

function stableValidationIssues(error: SchemaValidationErrorLike): readonly ValidationIssue[] {
  const descriptor = witnessGetOwnPropertyDescriptor(error, 'issues');
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    !securityArrayIsArray(descriptor.value) ||
    !arrayEvery(descriptor.value, isValidationIssue)
  ) {
    throw error;
  }
  return descriptor.value as readonly ValidationIssue[];
}

function stableValidationIssue(issues: readonly ValidationIssue[], index: number): ValidationIssue {
  const descriptor = witnessGetOwnPropertyDescriptor(issues, index);
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    !isValidationIssue(descriptor.value)
  ) {
    throw new TypeError('Kovo received an unstable schema validation issue.');
  }
  return descriptor.value;
}

function mergeValidationPath(
  prefix: readonly string[],
  suffix: readonly string[],
): readonly string[] {
  const path: string[] = [];
  for (let index = 0; index < prefix.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(prefix, index);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      throw new TypeError('Kovo received an unstable schema validation path.');
    }
    appendSchemaArrayValue(path, descriptor.value);
  }
  for (let index = 0; index < suffix.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(suffix, index);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      throw new TypeError('Kovo received an unstable schema validation path.');
    }
    appendSchemaArrayValue(path, descriptor.value);
  }
  return path;
}

function isAsyncSchema<T>(schema: Schema<T>): schema is AsyncSchema<T> {
  return typeof (schema as Partial<AsyncSchema<T>>).parseAsync === 'function';
}

/**
 * Bounds on the shape of untrusted wire input (KV430, SPEC §6.6/§9.5). The default
 * stops the small-body-huge-shape DoS class the byte+rate limiter cannot see; apps with
 * legitimately large bulk inputs widen it via {@link configureShapeBudget}.
 */
export interface ShapeBudget {
  readonly maxDepth: number;
  readonly maxBreadth: number;
  readonly maxNodes: number;
}

const DEFAULT_SHAPE_BUDGET: ShapeBudget = { maxDepth: 64, maxBreadth: 10_000, maxNodes: 200_000 };
let activeShapeBudget: ShapeBudget = DEFAULT_SHAPE_BUDGET;

/**
 * Raise or lower the global input-shape budget (KV430). The default stops the
 * small-body-huge-shape DoS class; an app with legitimately large bulk imports widens
 * it here (the declare-once global ceiling). Per-schema `.max()` overrides are a follow-up.
 */
export function configureShapeBudget(budget: Partial<ShapeBudget>): void {
  activeShapeBudget = { ...activeShapeBudget, ...budget };
}

/** Container children to descend; non-plain objects (File/Blob/Date/Map) are leaves. */
function descendableChildren(value: object): readonly unknown[] | undefined {
  if (securityArrayIsArray(value)) return value;
  if (requestIsPlainRecord(value)) {
    return ownRecordValues(value as Record<string, unknown>);
  }
  return undefined;
}

/**
 * KV430 (SPEC §6.6/§9.5): bound the depth/breadth/node-count of untrusted wire input
 * BEFORE the schema descends, so a small body cannot drive unbounded parser work the
 * byte+rate limiter cannot see (a 4000-deep array, a million-key object). Iterative —
 * an explicit stack, never recursion — so a deeply-nested attack input cannot itself
 * overflow the call stack while being checked. Fail-closed runtime floor (SPEC §6.6),
 * not a by-construction proof; covers JSON nesting and parsed object/array shape.
 */
export function assertShapeWithinBudget(
  input: unknown,
  budget: ShapeBudget = activeShapeBudget,
): void {
  input = revealSchemaInput(input);
  if (input === null || typeof input !== 'object') return;
  let nodes = 1;
  const stack: Array<readonly [value: object, depth: number]> = [[input, 0]];
  while (stack.length > 0) {
    const entry = popSchemaArrayValue(stack);
    if (entry === undefined) break;
    const value = entry[0];
    const depth = entry[1];
    if (depth > budget.maxDepth) {
      throw validationError(`Input nesting exceeds the maximum depth of ${budget.maxDepth}.`);
    }
    const children = descendableChildren(value);
    if (children === undefined) continue;
    const childCount = stableSchemaArrayLength(children);
    if (childCount > budget.maxBreadth) {
      throw validationError(
        `Input container of ${childCount} entries exceeds the maximum breadth of ${budget.maxBreadth}.`,
      );
    }
    nodes += childCount;
    if (nodes > budget.maxNodes) {
      throw validationError(`Input exceeds the maximum node count of ${budget.maxNodes}.`);
    }
    for (let index = 0; index < childCount; index += 1) {
      const child = stableSchemaArrayValue(children, index);
      if (child !== null && typeof child === 'object') {
        appendSchemaArrayValue(stack, [child, depth + 1]);
      }
    }
  }
}

function popSchemaArrayValue<Value>(values: Value[]): Value | undefined {
  if (values.length === 0) return undefined;
  const index = values.length - 1;
  const descriptor = witnessGetOwnPropertyDescriptor(values, index);
  values.length = index;
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError('Kovo received an unstable schema traversal stack.');
  }
  return descriptor.value;
}

function stableSchemaArrayLength(values: readonly unknown[]): number {
  const descriptor = witnessGetOwnPropertyDescriptor(values, 'length');
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    !securityNumberIsInteger(descriptor.value) ||
    descriptor.value < 0
  ) {
    throw validationError('Expected stable array input');
  }
  return descriptor.value;
}

function stableSchemaArrayValue(values: readonly unknown[], index: number): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(values, index);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw validationError('Expected dense stable array input');
  }
  return descriptor.value;
}

const SCHEMA_UNTRUSTED_REVEAL_REASON =
  'validated request-derived input through Kovo schema parsing';

function revealSchemaInput(input: unknown): unknown {
  if (isUntrusted(input)) return revealUntrusted(input, SCHEMA_UNTRUSTED_REVEAL_REASON);
  return input;
}

export async function parseSchemaAsync<T>(
  schema: Schema<T>,
  input: unknown,
  // Internal recursion (s.array/s.object item parsing) passes `true`: the top-level
  // wire entry already bounded the whole input, so subtrees are not re-walked.
  skipShapeBudget = false,
): Promise<T> {
  if (!skipShapeBudget) assertShapeWithinBudget(input);
  input = revealSchemaInput(input);
  return isAsyncSchema(schema) ? schema.parseAsync(input) : schema.parse(input);
}

export function entriesToRecord(
  entries: Iterable<readonly [string, unknown]>,
): Record<string, unknown> {
  // `Object.create(null)` (no prototype): a `__proto__` FormData entry must be a
  // plain data key, not the accessor that rebinds the prototype and silently drops
  // the value; and keys like `constructor`/`toString` must not be read off the
  // prototype chain (Part 4 SCHEMA-1/SCHEMA-2).
  const record = requestCreateNullRecord<unknown>() as Record<string, unknown>;

  if (securityArrayIsArray(entries)) {
    for (let index = 0; index < entries.length; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(entries, index);
      if (
        descriptor === undefined ||
        !('value' in descriptor) ||
        !securityArrayIsArray(descriptor.value) ||
        descriptor.value.length !== 2 ||
        typeof descriptor.value[0] !== 'string'
      ) {
        throw validationError('Expected stable form/query entry pairs');
      }
      appendRecordValue(record, descriptor.value[0], descriptor.value[1]);
    }
    return record;
  }

  for (const [key, value] of entries) {
    appendRecordValue(record, key, value);
  }

  return record;
}

function appendRecordValue(record: Record<string, unknown>, key: string, value: unknown): void {
  // Gate first-vs-repeat on own-keys only. On a null-prototype record this is also
  // correct for inherited names, but `Object.hasOwn` keeps the intent explicit and
  // robust if the record ever carries a prototype (SCHEMA-1/SCHEMA-2).
  if (witnessGetOwnPropertyDescriptor(record, key) === undefined) {
    record[key] = value;
    return;
  }

  const existing = record[key];
  if (securityArrayIsArray(existing)) {
    appendSchemaArrayValue(existing, value);
  } else {
    record[key] = [existing, value];
  }
}
