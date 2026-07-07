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
  BLESSED_FORMATS,
  PATTERN_MAX_INPUT_LENGTH,
  compileLinearPattern,
  testLinearPattern,
} from './redos.js';

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

const schemaMetadata = new WeakMap<Schema<unknown>, SchemaMetadata>();

/** @internal Return the declared upload bytes needed by file schemas nested in this schema. */
export function schemaMaxUploadBytes(schema: Schema<unknown>): number | undefined {
  const metadata = schemaMetadata.get(schema);
  if (metadata === undefined) return undefined;

  if (metadata.kind === 'file' || metadata.kind === 'stored-file') return metadata.maxBytes;
  if (metadata.kind === 'array') return schemaMaxUploadBytes(metadata.item);
  if (metadata.kind === 'record') return schemaMaxUploadBytes(metadata.value);
  if (metadata.kind === 'object') {
    let total = 0;
    let found = false;
    for (const child of Object.values(metadata.shape)) {
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
    super(issues[0]?.message ?? 'Invalid input');
    this.name = 'SchemaValidationError';
    this.issues = issues;
  }
}

export function isSchemaValidationError(error: unknown): error is SchemaValidationErrorLike {
  if (error instanceof SchemaValidationError) return true;
  if (typeof error !== 'object' || error === null) return false;

  const candidate = error as Partial<SchemaValidationErrorLike>;
  return (
    candidate.name === 'SchemaValidationError' &&
    typeof candidate.message === 'string' &&
    Array.isArray(candidate.issues) &&
    candidate.issues.every(isValidationIssue)
  );
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
    // `parseAsync` mirrors `s.object` (SPEC §6): each item flows through
    // `parseSchemaAsync` so a storing item schema (`s.file().store()`) runs its
    // async `storage.put`/`normalizeStorageKey` path. Without it, the runtime's
    // async input parse (`parseSchemaAsync`) would fall back to the sync `parse`
    // below, which for a storing file schema fabricates a result with no upload
    // and no key normalization (data loss + traversal-key passthrough; Part 4 M1).
    const schema: AsyncSchema<Item[]> = {
      parse(input: unknown): Item[] {
        return arrayValues(input).map((value, index) => {
          try {
            return item.parse(value);
          } catch (error) {
            throw validationErrorFrom(error, [String(index)]);
          }
        });
      },
      async parseAsync(input: unknown): Promise<Item[]> {
        const output: Item[] = [];

        for (const [index, value] of arrayValues(input).entries()) {
          try {
            output.push(await parseSchemaAsync(item, value, true));
          } catch (error) {
            throw validationErrorFrom(error, [String(index)]);
          }
        }

        return output;
      },
    };
    schemaMetadata.set(schema, { item: item as Schema<unknown>, kind: 'array' });
    return schema;
  },
  boolean(): Schema<boolean> {
    return {
      parse(input: unknown): boolean {
        input = revealSchemaInput(input);
        if (typeof input === 'boolean') return input;
        if (input === undefined || input === null || input === '') return false;
        if (typeof input === 'number' && (input === 0 || input === 1)) return Boolean(input);

        if (typeof input === 'string') {
          const value = input.toLowerCase();
          if (['1', 'on', 'true', 'yes'].includes(value)) return true;
          if (['0', 'false', 'no', 'off'].includes(value)) return false;
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
    return {
      parse(input: unknown): Secret<Value> {
        input = revealSchemaInput(input);
        return schema.parse(input) as Secret<Value>;
      },
    };
  },
  object<const Shape extends Record<string, Schema<unknown>>>(
    shape: Shape,
  ): Schema<{ [Key in keyof Shape]: InferSchema<Shape[Key]> }> {
    assertSafeObjectShape(shape);
    const schema: AsyncSchema<{ [Key in keyof Shape]: InferSchema<Shape[Key]> }> = {
      parse(input: unknown): { [Key in keyof Shape]: InferSchema<Shape[Key]> } {
        const record = formLikeToRecord(input);
        const output: Partial<{ [Key in keyof Shape]: InferSchema<Shape[Key]> }> = {};

        for (const [key, schema] of Object.entries(shape) as [keyof Shape, Shape[keyof Shape]][]) {
          try {
            output[key] = schema.parse(readOwnInputField(record, String(key))) as InferSchema<
              Shape[keyof Shape]
            >;
          } catch (error) {
            throw validationErrorFrom(error, [String(key)]);
          }
        }

        return output as { [Key in keyof Shape]: InferSchema<Shape[Key]> };
      },
      async parseAsync(input: unknown): Promise<{ [Key in keyof Shape]: InferSchema<Shape[Key]> }> {
        const record = formLikeToRecord(input);
        const output: Partial<{ [Key in keyof Shape]: InferSchema<Shape[Key]> }> = {};

        for (const [key, schema] of Object.entries(shape) as [keyof Shape, Shape[keyof Shape]][]) {
          try {
            output[key] = (await parseSchemaAsync(
              schema,
              readOwnInputField(record, String(key)),
              true,
            )) as InferSchema<Shape[keyof Shape]>;
          } catch (error) {
            throw validationErrorFrom(error, [String(key)]);
          }
        }

        return output as { [Key in keyof Shape]: InferSchema<Shape[Key]> };
      },
    };
    schemaMetadata.set(schema, { kind: 'object', shape });
    return schema;
  },
  record<Value>(value: Schema<Value>): Schema<Record<string, Value>> {
    const schema: AsyncSchema<Record<string, Value>> = {
      parse(input: unknown): Record<string, Value> {
        const record = recordInput(input);
        const output = Object.create(null) as Record<string, Value>;

        for (const [key, field] of Object.entries(record)) {
          assertSafeRecordKey(key);
          try {
            output[key] = value.parse(field);
          } catch (error) {
            throw validationErrorFrom(error, [key]);
          }
        }

        return output;
      },
      async parseAsync(input: unknown): Promise<Record<string, Value>> {
        const record = recordInput(input);
        const output = Object.create(null) as Record<string, Value>;

        for (const [key, field] of Object.entries(record)) {
          assertSafeRecordKey(key);
          try {
            output[key] = await parseSchemaAsync(value, field, true);
          } catch (error) {
            throw validationErrorFrom(error, [key]);
          }
        }

        return output;
      },
    };
    schemaMetadata.set(schema, { kind: 'record', value: value as Schema<unknown> });
    return schema;
  },
};

/** @internal Returns top-level mutation input fields that require multipart form encoding. */
export function mutationInputFileFields(schema: Schema<unknown>): readonly string[] {
  const metadata = schemaMetadata.get(schema);
  if (metadata?.kind !== 'object') return [];

  return Object.entries(metadata.shape)
    .filter(([, fieldSchema]) => schemaContainsFile(fieldSchema))
    .map(([fieldName]) => fieldName);
}

function schemaContainsFile(schema: Schema<unknown>): boolean {
  const metadata = schemaMetadata.get(schema);
  if (!metadata) return false;
  if (metadata.kind === 'file' || metadata.kind === 'stored-file') return true;
  if (metadata.kind === 'array') return schemaContainsFile(metadata.item);
  if (metadata.kind === 'object') {
    return Object.values(metadata.shape).some((fieldSchema) => schemaContainsFile(fieldSchema));
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
    const number = typeof value === 'number' ? value : Number(value);

    if (!Number.isFinite(number)) throw validationError('Expected number');
    if (this.#integer && !Number.isInteger(number)) throw validationError('Expected integer');
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
    return new StringSchemaImpl([...this.#checks, check], this.#defaultValue, this.#controlPolicy);
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
    const src = typeof source === 'string' ? source : source.source;
    // KV434: compile to the framework-owned linear engine before the pattern can run. A
    // dynamic/non-literal pattern reaches here as a runtime value the compiler cannot inspect; the
    // KV434 lint flags that at the call site, and `unsafeRegex(...)` is the audited JS RegExp escape.
    const flags = typeof source === 'string' ? '' : source.flags.replace(/[gy]/g, '');
    return this.#with({ kind: 'pattern', program: compileLinearPattern(src, flags), source: src });
  }

  matches(brand: UnsafeRegexBrand): StringSchema {
    // The audited escape: the ReDoS risk was accepted + recorded at `unsafeRegex(...)`.
    return this.#with({ kind: 'unsafe', regex: brand.regex });
  }

  parse(input: unknown): string {
    input = revealSchemaInput(input);
    if (isMissingStringInput(input) && this.#defaultValue !== undefined) {
      input = this.#defaultValue;
    }
    if (typeof input !== 'string') throw validationError('Expected string');

    assertStringControlPolicy(input, this.#controlPolicy);

    for (const check of this.#checks) {
      if (check.kind === 'format') {
        if (!BLESSED_FORMATS[check.name].test(input)) {
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
      } else if (!check.regex.test(input))
        throw validationError('Expected string matching pattern');
    }

    return input;
  }
}

function assertStringControlPolicy(input: string, policy: StringControlPolicy): void {
  if (policy === 'allow') return;

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
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
  const value = input.trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) {
    throw validationError('Expected decimal string');
  }
  if (scale !== undefined) {
    const fractional = value.split('.', 2)[1]?.length ?? 0;
    if (fractional > scale) throw validationError(`Expected decimal with <= ${scale} decimals`);
  }
  return value;
}

function parseDateInput(input: unknown, kind: 'date' | 'datetime'): Date {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) throw validationError(`Expected ${kind}`);
    return input;
  }
  if (typeof input !== 'string') throw validationError(`Expected ${kind}`);
  const value = input.trim();
  if (kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw validationError('Expected date');
  }
  const date = kind === 'date' ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) throw validationError(`Expected ${kind}`);
  if (kind === 'date' && date.toISOString().slice(0, 10) !== value) {
    throw validationError('Expected date');
  }
  return date;
}

function parseJsonInput(input: string): unknown {
  try {
    return JSON.parse(input);
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
      return Number.isFinite(value as number) || typeof value !== 'number';
    case 'object':
      if (Array.isArray(value)) return value.every(isJsonValue);
      if (!isPlainJsonObject(value)) return false;
      return Object.values(value as Record<string, unknown>).every(isJsonValue);
    default:
      return false;
  }
}

function isPlainJsonObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

class FileSchemaImpl implements FileSchema {
  readonly #maxBytes: number | undefined;
  readonly #accept: UnverifiedAcceptance | readonly string[] | undefined;

  constructor(options: FileSchemaOptions = {}) {
    this.#maxBytes = options.maxBytes;
    this.#accept = options.accept;
    schemaMetadata.set(this, {
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
    schemaMetadata.set(this, {
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
    const { bytes, file, sniffed } = await parseVerifiedFileLike(input, this.#fileOptions);

    // KV428 (SPEC §6.6/§9.1): the storage key is SERVER-GENERATED and opaque (random UUID), never
    // derived from the client filename. This kills path traversal / overwrite by construction — an
    // attacker `../../etc/passwd` name can no longer become the storage key.
    const key = mintStorageKey(this.#storageOptions.keyPrefix);

    // KV428: mint the stored contentType from the SNIFFED bytes (server truth overrides the client
    // lie). The audited `accept.unverified(...)` escape trusts the client-declared `file.type`
    // instead (recorded for `kovo explain --capabilities`). The bytes are already buffered, so the
    // deep sniff is free.
    const contentType = isUnverifiedAcceptance(this.#fileOptions.accept)
      ? file.type
      : sniffed.contentType;

    const storage = await this.#storageOptions.storage.put(key, bytes.slice(), {
      ...(contentType === '' ? {} : { contentType }),
      metadata: {
        ...this.#storageOptions.metadata?.(file),
        // The client filename is sanitized framework-owned download METADATA only — never the key.
        // Keep it last so app metadata cannot replace the value that later reaches
        // Content-Disposition at the stored-file sink (SPEC §6.6 / §9.1).
        filename: sanitizeDownloadFilename(file.name),
      },
    });

    return { file, key, storage };
  }
}

function isUnverifiedAcceptance(
  accept: UnverifiedAcceptance | readonly string[] | undefined,
): accept is UnverifiedAcceptance {
  return (
    typeof accept === 'object' &&
    accept !== null &&
    !Array.isArray(accept) &&
    (accept as UnverifiedAcceptance).unverified === true
  );
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
  return Array.isArray(input) ? input : [input];
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

const PROTOTYPE_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function assertSafeObjectShape(shape: Record<string, Schema<unknown>>): void {
  for (const key of Object.keys(shape)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) {
      throw new Error(
        `s.object(): "${key}" is reserved by the prototype-pollution input floor (SPEC §6.6).`,
      );
    }
  }
}

function assertSafeRecordKey(key: string): void {
  if (!PROTOTYPE_POLLUTION_KEYS.has(key)) return;
  throw validationError(
    `s.record(): "${key}" is reserved by the prototype-pollution input floor (SPEC §6.6).`,
    [key],
  );
}

function readOwnInputField(record: Record<string, unknown>, key: string): unknown {
  // OPP-19 (SPEC §6.6 runtime-DiD): schema decode is shape-bound and must not let inherited
  // properties satisfy declared fields. JSON/form payloads can carry prototype-pollution names, but
  // object schemas project only own, declared fields into the validated value.
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function parseFileLikeSync(input: unknown, options: FileSchemaOptions): FileLike {
  const file = parseFileLikeShape(input, options);
  const accept = options.accept;
  if (isUnverifiedAcceptance(accept)) {
    if (accept.types.length > 0 && !accept.types.includes(file.type)) {
      throw validationError(`Expected file type ${accept.types.join(', ')}`);
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

  return file;
}

async function parseFileLikeAsync(input: unknown, options: FileSchemaOptions): Promise<FileLike> {
  const { file } = await parseVerifiedFileLike(input, options);
  return file;
}

async function parseVerifiedFileLike(
  input: unknown,
  options: FileSchemaOptions,
): Promise<{ bytes: Uint8Array; file: FileLike; sniffed: ReturnType<typeof sniffUploadBytes> }> {
  const file = parseFileLikeShape(input, options);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffUploadBytes(bytes);
  const accept = options.accept;
  if (isUnverifiedAcceptance(accept)) {
    if (accept.types.length > 0 && !accept.types.includes(file.type)) {
      throw validationError(`Expected file type ${accept.types.join(', ')}`);
    }
  } else if (accept && accept.length > 0 && !accept.includes(sniffed.contentType)) {
    throw validationError(`Expected file type ${accept.join(', ')}`);
  }

  return { bytes, file, sniffed };
}

function parseFileLikeShape(input: unknown, options: FileSchemaOptions): FileLike {
  input = revealSchemaInput(input);
  if (!isFileLike(input)) throw validationError('Expected file');
  if (options.maxBytes !== undefined && input.size > options.maxBytes) {
    throw validationError(`Expected file <= ${options.maxBytes} bytes`);
  }

  return input;
}

function isFileLike(value: unknown): value is FileLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'arrayBuffer' in value &&
    typeof value.arrayBuffer === 'function' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'size' in value &&
    typeof value.size === 'number' &&
    'type' in value &&
    typeof value.type === 'string'
  );
}

export function formLikeToRecord(input: unknown): Record<string, unknown> {
  input = revealSchemaInput(input);
  if (input instanceof FormData) {
    return entriesToRecord(input.entries());
  }

  if (typeof input === 'object' && input !== null) return input as Record<string, unknown>;
  throw validationError('Expected object input');
}

function recordInput(input: unknown): Record<string, unknown> {
  const record = formLikeToRecord(input);
  if (Array.isArray(record)) throw validationError('Expected record input');
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
    return new SchemaValidationError(
      error.issues.map((issue) => ({
        message: issue.message,
        path: [...pathPrefix, ...issue.path],
      })),
    );
  }

  throw error;
}

function isValidationIssue(value: unknown): value is ValidationIssue {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<ValidationIssue>).message === 'string' &&
    Array.isArray((value as Partial<ValidationIssue>).path) &&
    (value as Partial<ValidationIssue>).path?.every((segment) => typeof segment === 'string') ===
      true
  );
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
  if (Array.isArray(value)) return value;
  const proto = Object.getPrototypeOf(value);
  if (proto === Object.prototype || proto === null) {
    return Object.values(value as Record<string, unknown>);
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
    const entry = stack.pop();
    if (entry === undefined) break;
    const [value, depth] = entry;
    if (depth > budget.maxDepth) {
      throw validationError(`Input nesting exceeds the maximum depth of ${budget.maxDepth}.`);
    }
    const children = descendableChildren(value);
    if (children === undefined) continue;
    if (children.length > budget.maxBreadth) {
      throw validationError(
        `Input container of ${children.length} entries exceeds the maximum breadth of ${budget.maxBreadth}.`,
      );
    }
    nodes += children.length;
    if (nodes > budget.maxNodes) {
      throw validationError(`Input exceeds the maximum node count of ${budget.maxNodes}.`);
    }
    for (const child of children) {
      if (child !== null && typeof child === 'object') stack.push([child, depth + 1]);
    }
  }
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
  const record = Object.create(null) as Record<string, unknown>;

  for (const [key, value] of entries) {
    appendRecordValue(record, key, value);
  }

  return record;
}

function appendRecordValue(record: Record<string, unknown>, key: string, value: unknown): void {
  // Gate first-vs-repeat on own-keys only. On a null-prototype record this is also
  // correct for inherited names, but `Object.hasOwn` keeps the intent explicit and
  // robust if the record ever carries a prototype (SCHEMA-1/SCHEMA-2).
  if (!Object.hasOwn(record, key)) {
    record[key] = value;
    return;
  }

  const existing = record[key];
  if (Array.isArray(existing)) {
    existing.push(value);
  } else {
    record[key] = [existing, value];
  }
}
