import { secret, type Secret, type StorageCapability, type StorageObjectInfo } from '@kovojs/core';

/** A validator that parses unknown input into a typed value (throwing `SchemaValidationError` on failure). */
export interface Schema<T> {
  parse(input: unknown): T;
}

/** Extract the parsed value type of a `Schema`. */
export type InferSchema<T> = T extends Schema<infer Value> ? Value : never;

/** A validator that may need async work, such as byte-backed file validation. */
export interface AsyncSchema<T> extends Schema<T> {
  parseAsync(input: unknown): Promise<T>;
}

const defaultSchemaInputBudget = {
  maxBreadth: 1_000,
  maxDepth: 32,
  maxNodes: 10_000,
} as const;

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
 * `s.number`, `s.boolean`, `s.array`, and `s.file`; each returns a `Schema`
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
  array<Item>(item: Schema<Item>): ArraySchema<Item> {
    return new ArraySchemaImpl(item);
  },
  boolean(): Schema<boolean> {
    return {
      parse(input: unknown): boolean {
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
  file(options: FileSchemaOptions = {}): FileSchema {
    return new FileSchemaImpl(options);
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
        return secret(schema.parse(input));
      },
    };
  },
  object<const Shape extends Record<string, Schema<unknown>>>(
    shape: Shape,
  ): Schema<{ [Key in keyof Shape]: InferSchema<Shape[Key]> }> {
    const schema: AsyncSchema<{ [Key in keyof Shape]: InferSchema<Shape[Key]> }> = {
      parse(input: unknown): { [Key in keyof Shape]: InferSchema<Shape[Key]> } {
        assertSchemaInputBudget(input);
        const record = formLikeToRecord(input);
        const output = Object.create(null) as Partial<{
          [Key in keyof Shape]: InferSchema<Shape[Key]>;
        }>;

        for (const [key, schema] of Object.entries(shape) as [keyof Shape, Shape[keyof Shape]][]) {
          try {
            output[key] = schema.parse(record[String(key)]) as InferSchema<Shape[keyof Shape]>;
          } catch (error) {
            throw validationErrorFrom(error, [String(key)]);
          }
        }

        return output as { [Key in keyof Shape]: InferSchema<Shape[Key]> };
      },
      async parseAsync(input: unknown): Promise<{ [Key in keyof Shape]: InferSchema<Shape[Key]> }> {
        assertSchemaInputBudget(input);
        const record = formLikeToRecord(input);
        const output = Object.create(null) as Partial<{
          [Key in keyof Shape]: InferSchema<Shape[Key]>;
        }>;

        for (const [key, schema] of Object.entries(shape) as [keyof Shape, Shape[keyof Shape]][]) {
          try {
            output[key] = (await parseSchemaAsync(schema, record[String(key)])) as InferSchema<
              Shape[keyof Shape]
            >;
          } catch (error) {
            throw validationErrorFrom(error, [String(key)]);
          }
        }

        return output as { [Key in keyof Shape]: InferSchema<Shape[Key]> };
      },
    };
    return schema;
  },
};

/** Minimal uploaded-file shape accepted by `s.file()` schemas (SPEC.md §6). */
export interface FileLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  name: string;
  size: number;
  type: string;
}

/** File-upload schema produced by `s.file()`; chains size/MIME limits and `.store()` (SPEC.md §6). */
export interface FileSchema extends AsyncSchema<FileLike> {
  maxBytes(value: number): FileSchema;
  mime(types: readonly string[]): FileSchema;
  store(options: StoredFileSchemaOptions): StoredFileSchema;
}

/** Size/MIME constraints captured by an `s.file()` schema (SPEC.md §6). */
export interface FileSchemaOptions {
  maxBytes?: number;
  mime?: readonly string[];
}

/** Result of a stored upload produced by `s.file().store(...)` (SPEC.md §6). */
export interface StoredFileUpload {
  file: FileLike;
  key: string;
  storage: StorageObjectInfo;
}

/** Stored-upload schema produced by `s.file().store(...)` (SPEC.md §6). */
export interface StoredFileSchema extends AsyncSchema<StoredFileUpload> {}

/** Options for `s.file().store(...)`: storage capability, object key, and metadata (SPEC.md §6). */
export interface StoredFileSchemaOptions {
  key: string | ((file: FileLike) => Promise<string> | string);
  metadata?: (file: FileLike) => Readonly<Record<string, string>>;
  storage: StorageCapability;
}

/** Array schema produced by `s.array(...)`; chains item parsing plus explicit length bounds (SPEC.md §6). */
export interface ArraySchema<Item> extends AsyncSchema<Item[]> {
  max(value: number): ArraySchema<Item>;
}

interface ArraySchemaOptions {
  maxLength?: number;
}

class ArraySchemaImpl<Item> implements ArraySchema<Item> {
  readonly #item: Schema<Item>;
  readonly #maxLength: number | undefined;

  constructor(item: Schema<Item>, options: ArraySchemaOptions = {}) {
    this.#item = item;
    this.#maxLength = options.maxLength;
  }

  max(value: number): ArraySchema<Item> {
    assertNonNegativeInteger(value, 'Array max');
    return new ArraySchemaImpl(this.#item, { maxLength: value });
  }

  parse(input: unknown): Item[] {
    // `parseAsync` mirrors `s.object` (SPEC §6): each item flows through
    // `parseSchemaAsync` so a storing item schema (`s.file().store()`) runs its
    // async `storage.put`/`normalizeStorageKey` path. Without it, the runtime's
    // async input parse (`parseSchemaAsync`) would fall back to the sync `parse`
    // below, which for a storing file schema fabricates a result with no upload
    // and no key normalization (data loss + traversal-key passthrough; Part 4 M1).
    assertSchemaInputBudget(input);
    const values = arrayValues(input);
    this.#assertMax(values.length);
    return values.map((value, index) => {
      try {
        return this.#item.parse(value);
      } catch (error) {
        throw validationErrorFrom(error, [String(index)]);
      }
    });
  }

  async parseAsync(input: unknown): Promise<Item[]> {
    assertSchemaInputBudget(input);
    const values = arrayValues(input);
    this.#assertMax(values.length);
    const output: Item[] = [];

    for (const [index, value] of values.entries()) {
      try {
        output.push(await parseSchemaAsync(this.#item, value));
      } catch (error) {
        throw validationErrorFrom(error, [String(index)]);
      }
    }

    return output;
  }

  #assertMax(length: number): void {
    if (this.#maxLength !== undefined && length > this.#maxLength) {
      throw validationError(`Expected array length <= ${this.#maxLength}`);
    }
  }
}

/**
 * String schema produced by `s.string()`; chains length and audited linear format validators
 * (SPEC.md §6 and secure-by-construction KV434).
 */
export interface StringSchema extends Schema<string> {
  email(): StringSchema;
  max(value: number): StringSchema;
  slug(): StringSchema;
  url(): StringSchema;
  uuid(): StringSchema;
}

type StringFormat = 'email' | 'slug' | 'url' | 'uuid';

interface StringSchemaOptions {
  format?: StringFormat;
  maxLength?: number;
}

class StringSchemaImpl implements StringSchema {
  readonly #format: StringFormat | undefined;
  readonly #maxLength: number | undefined;

  constructor(options: StringSchemaOptions = {}) {
    this.#format = options.format;
    this.#maxLength = options.maxLength;
  }

  email(): StringSchema {
    return this.#with({ format: 'email' });
  }

  max(value: number): StringSchema {
    assertNonNegativeInteger(value, 'String max');
    return this.#with({ maxLength: value });
  }

  slug(): StringSchema {
    return this.#with({ format: 'slug' });
  }

  url(): StringSchema {
    return this.#with({ format: 'url' });
  }

  uuid(): StringSchema {
    return this.#with({ format: 'uuid' });
  }

  parse(input: unknown): string {
    if (typeof input !== 'string') throw validationError('Expected string');
    if (this.#maxLength !== undefined && input.length > this.#maxLength) {
      throw validationError(`Expected string length <= ${this.#maxLength}`);
    }
    if (this.#format !== undefined && !stringFormatValidators[this.#format](input)) {
      throw validationError(`Expected ${this.#format}`);
    }

    return input;
  }

  #with(options: StringSchemaOptions): StringSchema {
    const format = options.format ?? this.#format;
    const maxLength = options.maxLength ?? this.#maxLength;
    return new StringSchemaImpl({
      ...(format === undefined ? {} : { format }),
      ...(maxLength === undefined ? {} : { maxLength }),
    });
  }
}

/** Numeric schema produced by `s.number()`; chains int/min/default refinements (SPEC.md §6). */
export interface NumberSchema extends Schema<number> {
  default(value: number): NumberSchema;
  int(): NumberSchema;
  min(value: number): NumberSchema;
}

interface NumberSchemaOptions {
  defaultValue?: number;
  integer?: boolean;
  minimum?: number;
}

class NumberSchemaImpl implements NumberSchema {
  readonly #defaultValue: number | undefined;
  readonly #integer: boolean;
  readonly #minimum: number | undefined;

  constructor(options: NumberSchemaOptions = {}) {
    this.#defaultValue = options.defaultValue;
    this.#integer = options.integer ?? false;
    this.#minimum = options.minimum;
  }

  default(value: number): NumberSchema {
    return new NumberSchemaImpl({
      defaultValue: value,
      integer: this.#integer,
      ...(this.#minimum === undefined ? {} : { minimum: this.#minimum }),
    });
  }

  int(): NumberSchema {
    return new NumberSchemaImpl({
      ...(this.#defaultValue === undefined ? {} : { defaultValue: this.#defaultValue }),
      integer: true,
      ...(this.#minimum === undefined ? {} : { minimum: this.#minimum }),
    });
  }

  min(value: number): NumberSchema {
    return new NumberSchemaImpl({
      ...(this.#defaultValue === undefined ? {} : { defaultValue: this.#defaultValue }),
      integer: this.#integer,
      minimum: value,
    });
  }

  parse(input: unknown): number {
    const value =
      input === undefined || input === null || input === '' ? this.#defaultValue : input;
    const number = typeof value === 'number' ? value : Number(value);

    if (!Number.isFinite(number)) throw validationError('Expected number');
    if (this.#integer && !Number.isInteger(number)) throw validationError('Expected integer');
    if (this.#minimum !== undefined && number < this.#minimum) {
      throw validationError(`Expected number >= ${this.#minimum}`);
    }

    return number;
  }
}

class FileSchemaImpl implements FileSchema {
  readonly #maxBytes: number | undefined;
  readonly #mime: readonly string[] | undefined;

  constructor(options: FileSchemaOptions = {}) {
    this.#maxBytes = options.maxBytes;
    this.#mime = options.mime;
  }

  maxBytes(value: number): FileSchema {
    return new FileSchemaImpl({
      maxBytes: value,
      ...(this.#mime === undefined ? {} : { mime: this.#mime }),
    });
  }

  mime(types: readonly string[]): FileSchema {
    return new FileSchemaImpl({
      ...(this.#maxBytes === undefined ? {} : { maxBytes: this.#maxBytes }),
      mime: types,
    });
  }

  parse(input: unknown): FileLike {
    const file = parseFileLike(input, createFileOptions(this.#maxBytes, undefined));
    if (this.#mime !== undefined) {
      throw validationError('File MIME validation requires async parsing');
    }

    return file;
  }

  async parseAsync(input: unknown): Promise<FileLike> {
    const file = parseFileLike(input, createFileOptions(this.#maxBytes, undefined));
    if (this.#mime !== undefined) {
      const contentType = sniffUploadContentType(new Uint8Array(await file.arrayBuffer()));
      if (!this.#mime.includes(contentType)) {
        throw validationError(`Expected file type ${this.#mime.join(', ')}`);
      }
    }

    return file;
  }

  store(options: StoredFileSchemaOptions): StoredFileSchema {
    return new StoredFileSchemaImpl(createFileOptions(this.#maxBytes, this.#mime), options);
  }
}

class StoredFileSchemaImpl implements StoredFileSchema {
  readonly #fileOptions: FileSchemaOptions;
  readonly #storageOptions: StoredFileSchemaOptions;

  constructor(fileOptions: FileSchemaOptions, storageOptions: StoredFileSchemaOptions) {
    this.#fileOptions = fileOptions;
    this.#storageOptions = storageOptions;
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
    const file = parseFileLike(input, this.#fileOptions);
    const bytes = await file.arrayBuffer();
    const contentType = sniffUploadContentType(new Uint8Array(bytes));
    if (this.#fileOptions.mime && !this.#fileOptions.mime.includes(contentType)) {
      throw validationError(`Expected file type ${this.#fileOptions.mime.join(', ')}`);
    }

    const key =
      typeof this.#storageOptions.key === 'string'
        ? this.#storageOptions.key
        : await this.#storageOptions.key(file);
    const storage = await this.#storageOptions.storage.put(key, bytes, {
      contentType,
      metadata: {
        filename: file.name,
        ...this.#storageOptions.metadata?.(file),
      },
    });

    return { file, key, storage };
  }
}

function createFileOptions(
  maxBytes: number | undefined,
  mime: readonly string[] | undefined,
): FileSchemaOptions {
  return {
    ...(maxBytes === undefined ? {} : { maxBytes }),
    ...(mime === undefined ? {} : { mime }),
  };
}

const stringFormatValidators: Record<StringFormat, (value: string) => boolean> = {
  email: isLinearEmail,
  slug: isLinearSlug,
  url: isLinearUrl,
  uuid: isLinearUuid,
};

function arrayValues(input: unknown): unknown[] {
  if (input === undefined || input === null) return [];
  return Array.isArray(input) ? input : [input];
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative integer`);
}

function isLinearEmail(value: string): boolean {
  if (value.length === 0 || value.length > 254) return false;
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@') || at === value.length - 1) return false;

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > 64 || !hasOnlyVisibleEmailLocalCharacters(local)) return false;

  return isDomainName(domain);
}

function isLinearSlug(value: string): boolean {
  if (value.length === 0) return false;
  let previousHyphen = false;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const lowerAlpha = code >= 0x61 && code <= 0x7a;
    const digit = code >= 0x30 && code <= 0x39;
    const hyphen = code === 0x2d;
    if (!lowerAlpha && !digit && !hyphen) return false;
    if (hyphen && (index === 0 || index === value.length - 1 || previousHyphen)) return false;
    previousHyphen = hyphen;
  }

  return true;
}

function isLinearUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0
    );
  } catch {
    return false;
  }
}

function isLinearUuid(value: string): boolean {
  if (value.length !== 36) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const shouldBeHyphen = index === 8 || index === 13 || index === 18 || index === 23;
    if (shouldBeHyphen) {
      if (code !== 0x2d) return false;
      continue;
    }
    if (!isAsciiHex(code)) return false;
  }

  return true;
}

function hasOnlyVisibleEmailLocalCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code >= 0x7f || code === 0x22 || code === 0x28 || code === 0x29) {
      return false;
    }
    if (code === 0x2c || code === 0x3a || code === 0x3b || code === 0x3c || code === 0x3e) {
      return false;
    }
    if (code === 0x5b || code === 0x5c || code === 0x5d) return false;
  }

  return true;
}

function isDomainName(value: string): boolean {
  if (value.length === 0 || value.length > 253 || value.startsWith('.') || value.endsWith('.')) {
    return false;
  }

  let labelLength = 0;
  let labelStartsWithHyphen = false;
  let previous = 0;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x2e) {
      if (labelLength === 0 || labelLength > 63 || labelStartsWithHyphen || previous === 0x2d) {
        return false;
      }
      labelLength = 0;
      labelStartsWithHyphen = false;
      previous = code;
      continue;
    }

    const lower = code >= 0x61 && code <= 0x7a;
    const upper = code >= 0x41 && code <= 0x5a;
    const digit = code >= 0x30 && code <= 0x39;
    const hyphen = code === 0x2d;
    if (!lower && !upper && !digit && !hyphen) return false;
    if (labelLength === 0 && hyphen) labelStartsWithHyphen = true;
    labelLength += 1;
    previous = code;
  }

  return labelLength > 0 && labelLength <= 63 && !labelStartsWithHyphen && previous !== 0x2d;
}

function isAsciiHex(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x46) ||
    (code >= 0x61 && code <= 0x66)
  );
}

function parseFileLike(input: unknown, options: FileSchemaOptions): FileLike {
  if (!isFileLike(input)) throw validationError('Expected file');
  if (options.maxBytes !== undefined && input.size > options.maxBytes) {
    throw validationError(`Expected file <= ${options.maxBytes} bytes`);
  }

  return input;
}

function sniffUploadContentType(bytes: Uint8Array): string {
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWithAscii(bytes, 'GIF87a') || startsWithAscii(bytes, 'GIF89a')) return 'image/gif';
  if (bytes.length >= 12 && startsWithAscii(bytes, 'RIFF') && asciiAt(bytes, 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (startsWithAscii(bytes, '%PDF-')) return 'application/pdf';
  if (looksLikePlainText(bytes)) return 'text/plain';

  return 'application/octet-stream';
}

function startsWithBytes(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

function startsWithAscii(bytes: Uint8Array, prefix: string): boolean {
  return asciiAt(bytes, 0, prefix.length) === prefix;
}

function asciiAt(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function looksLikePlainText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;

  for (const byte of bytes) {
    if (byte === 0) return false;
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) return false;
  }

  return true;
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
  if (input instanceof FormData) {
    return entriesToRecord(input.entries());
  }

  if (typeof input === 'object' && input !== null) {
    return entriesToRecord(Object.entries(input as Record<string, unknown>));
  }

  throw validationError('Expected object input');
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

export async function parseSchemaAsync<T>(schema: Schema<T>, input: unknown): Promise<T> {
  return isAsyncSchema(schema) ? schema.parseAsync(input) : schema.parse(input);
}

export function entriesToRecord(
  entries: Iterable<readonly [string, unknown]>,
): Record<string, unknown> {
  // SPEC §9.4/§10.2/§10.3: every request-derived record used by schema coercion
  // is null-prototype and rejects prototype-pollution keys before assignment.
  const record = Object.create(null) as Record<string, unknown>;
  let entryCount = 0;

  for (const [key, value] of entries) {
    entryCount += 1;
    if (entryCount > defaultSchemaInputBudget.maxBreadth) {
      throw validationError(`Input exceeds maximum breadth ${defaultSchemaInputBudget.maxBreadth}`);
    }
    appendRecordValue(record, key, value);
  }

  return record;
}

function assertSchemaInputBudget(input: unknown): void {
  const seen = new WeakSet<object>();
  let nodes = 0;

  const visit = (value: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > defaultSchemaInputBudget.maxNodes) {
      throw validationError(
        `Input exceeds maximum node count ${defaultSchemaInputBudget.maxNodes}`,
      );
    }
    if (depth > defaultSchemaInputBudget.maxDepth) {
      throw validationError(`Input exceeds maximum depth ${defaultSchemaInputBudget.maxDepth}`);
    }
    if (value === null || typeof value !== 'object') return;
    if (isFileLike(value)) return;
    if (seen.has(value)) return;
    seen.add(value);

    if (value instanceof FormData) {
      const entries = [...value.entries()];
      if (entries.length > defaultSchemaInputBudget.maxBreadth) {
        throw validationError(
          `Input exceeds maximum breadth ${defaultSchemaInputBudget.maxBreadth}`,
        );
      }
      for (const [, item] of entries) visit(item, depth + 1);
      return;
    }

    if (Array.isArray(value)) {
      if (value.length > defaultSchemaInputBudget.maxBreadth) {
        throw validationError(
          `Input exceeds maximum breadth ${defaultSchemaInputBudget.maxBreadth}`,
        );
      }
      for (const item of value) visit(item, depth + 1);
      return;
    }

    const entries = Object.entries(value);
    if (entries.length > defaultSchemaInputBudget.maxBreadth) {
      throw validationError(`Input exceeds maximum breadth ${defaultSchemaInputBudget.maxBreadth}`);
    }
    for (const [, item] of entries) visit(item, depth + 1);
  };

  visit(input, 0);
}

function appendRecordValue(record: Record<string, unknown>, key: string, value: unknown): void {
  if (isDangerousObjectKey(key)) {
    throw validationError(`Forbidden object key "${key}"`);
  }

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

function isDangerousObjectKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}
