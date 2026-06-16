import type { StorageCapability, StorageObjectInfo } from '@kovojs/core';

/** A validator that parses unknown input into a typed value (throwing `SchemaValidationError` on failure). */
export interface Schema<T> {
  parse(input: unknown): T;
}

/** Extract the parsed value type of a `Schema`. */
export type InferSchema<T> = T extends Schema<infer Value> ? Value : never;

interface AsyncSchema<T> extends Schema<T> {
  parseAsync(input: unknown): Promise<T>;
}

export interface ValidationIssue {
  message: string;
  path: readonly string[];
}

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
  array<Item>(item: Schema<Item>): Schema<Item[]> {
    return {
      parse(input: unknown): Item[] {
        const values =
          input === undefined || input === null ? [] : Array.isArray(input) ? input : [input];

        return values.map((value, index) => {
          try {
            return item.parse(value);
          } catch (error) {
            throw validationErrorFrom(error, [String(index)]);
          }
        });
      },
    };
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
  string(): Schema<string> {
    return {
      parse(input: unknown): string {
        if (typeof input !== 'string') throw validationError('Expected string');
        return input;
      },
    };
  },
  number(): NumberSchema {
    return new NumberSchemaImpl();
  },
  object<const Shape extends Record<string, Schema<unknown>>>(
    shape: Shape,
  ): Schema<{ [Key in keyof Shape]: InferSchema<Shape[Key]> }> {
    const schema: AsyncSchema<{ [Key in keyof Shape]: InferSchema<Shape[Key]> }> = {
      parse(input: unknown): { [Key in keyof Shape]: InferSchema<Shape[Key]> } {
        const record = formLikeToRecord(input);
        const output: Partial<{ [Key in keyof Shape]: InferSchema<Shape[Key]> }> = {};

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
        const record = formLikeToRecord(input);
        const output: Partial<{ [Key in keyof Shape]: InferSchema<Shape[Key]> }> = {};

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

export interface FileLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  name: string;
  size: number;
  type: string;
}

export interface FileSchema extends Schema<FileLike> {
  maxBytes(value: number): FileSchema;
  mime(types: readonly string[]): FileSchema;
  store(options: StoredFileSchemaOptions): StoredFileSchema;
}

export interface FileSchemaOptions {
  maxBytes?: number;
  mime?: readonly string[];
}

export interface StoredFileUpload {
  file: FileLike;
  key: string;
  storage: StorageObjectInfo;
}

export interface StoredFileSchema extends AsyncSchema<StoredFileUpload> {}

export type MaybePromise<Value> = Promise<Value> | Value;

export interface StoredFileSchemaOptions {
  key: string | ((file: FileLike) => MaybePromise<string>);
  metadata?: (file: FileLike) => Readonly<Record<string, string>>;
  storage: StorageCapability;
}

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
    return parseFileLike(input, createFileOptions(this.#maxBytes, this.#mime));
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

  parse(input: unknown): StoredFileUpload {
    const file = parseFileLike(input, this.#fileOptions);
    const key =
      typeof this.#storageOptions.key === 'string'
        ? this.#storageOptions.key
        : this.#storageOptions.key(file);
    if (typeof key !== 'string') {
      throw validationError('Expected synchronous storage key');
    }

    return {
      file,
      key,
      storage: {
        ...(file.type === '' ? {} : { contentType: file.type }),
        key,
        ...(this.#storageOptions.metadata === undefined
          ? {}
          : { metadata: this.#storageOptions.metadata(file) }),
        size: file.size,
      },
    };
  }

  async parseAsync(input: unknown): Promise<StoredFileUpload> {
    const file = parseFileLike(input, this.#fileOptions);
    const key =
      typeof this.#storageOptions.key === 'string'
        ? this.#storageOptions.key
        : await this.#storageOptions.key(file);
    const storage = await this.#storageOptions.storage.put(key, await file.arrayBuffer(), {
      ...(file.type === '' ? {} : { contentType: file.type }),
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

function parseFileLike(input: unknown, options: FileSchemaOptions): FileLike {
  if (!isFileLike(input)) throw validationError('Expected file');
  if (options.maxBytes !== undefined && input.size > options.maxBytes) {
    throw validationError(`Expected file <= ${options.maxBytes} bytes`);
  }
  if (options.mime && !options.mime.includes(input.type)) {
    throw validationError(`Expected file type ${options.mime.join(', ')}`);
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
  if (input instanceof FormData) {
    return entriesToRecord(input.entries());
  }

  if (typeof input === 'object' && input !== null) return input as Record<string, unknown>;
  throw validationError('Expected object input');
}

function validationError(message: string, path: readonly string[] = []): SchemaValidationError {
  return new SchemaValidationError([{ message, path }]);
}

function validationErrorFrom(error: unknown, pathPrefix: readonly string[]): SchemaValidationError {
  if (isSchemaValidationError(error)) {
    return new SchemaValidationError(
      error.issues.map((issue) => ({
        message: issue.message,
        path: [...pathPrefix, ...issue.path],
      })),
    );
  }

  return validationError(error instanceof Error ? error.message : String(error), pathPrefix);
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
  const record: Record<string, unknown> = {};

  for (const [key, value] of entries) {
    appendRecordValue(record, key, value);
  }

  return record;
}

function appendRecordValue(record: Record<string, unknown>, key: string, value: unknown): void {
  const existing = record[key];

  if (existing === undefined) {
    record[key] = value;
  } else if (Array.isArray(existing)) {
    existing.push(value);
  } else {
    record[key] = [existing, value];
  }
}
