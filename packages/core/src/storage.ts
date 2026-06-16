/** The accepted body shapes when writing an object: a string, raw bytes, or a byte stream. */
export type StorageBody = string | ArrayBuffer | ArrayBufferView | ReadableStream<Uint8Array>;

/** Optional metadata to attach when writing an object: content type, etag, and custom key/value metadata. */
export interface StoragePutOptions {
  contentType?: string;
  etag?: string;
  metadata?: Readonly<Record<string, string>>;
}

/** Descriptive information about a stored object: its key, size, and optional content type, etag, modified time, and metadata. */
export interface StorageObjectInfo {
  contentType?: string;
  etag?: string;
  key: string;
  lastModified?: Date;
  metadata?: Readonly<Record<string, string>>;
  size: number;
}

/** Result of writing an object: the stored object's descriptive information. */
export interface StoragePutResult extends StorageObjectInfo {}

/** Result of reading an object fully into memory: its descriptive information plus the object bytes. */
export interface StorageGetResult extends StorageObjectInfo {
  body: Uint8Array;
}

/** Result of opening an object as a stream: its descriptive information plus a readable byte stream of the body. */
export interface StorageStreamResult extends StorageObjectInfo {
  body: ReadableStream<Uint8Array>;
}

/** The object-storage interface an app uses to read, write, stat, and stream objects by key. */
export interface StorageCapability {
  get(key: string): Promise<StorageGetResult | undefined>;
  put(key: string, body: StorageBody, options?: StoragePutOptions): Promise<StoragePutResult>;
  stat(key: string): Promise<StorageObjectInfo | undefined>;
  stream(key: string): Promise<StorageStreamResult | undefined>;
}

/** Options for the filesystem-backed storage: the root directory objects are stored under. */
export interface FileSystemStorageOptions {
  root: string;
}

/** Options for the in-memory storage: an optional clock used for deterministic modified times. */
export interface MemoryStorageOptions {
  now?: () => Date;
}

/** Input to an S3-compatible put-object call: target bucket and key, the body, and optional content type and metadata. */
export interface S3CompatiblePutObjectInput {
  body: StorageBody;
  bucket: string;
  contentType?: string;
  key: string;
  metadata?: Readonly<Record<string, string>>;
}

/** Input to an S3-compatible get-object call: the target bucket and key. */
export interface S3CompatibleGetObjectInput {
  bucket: string;
  key: string;
}

/** Input to an S3-compatible head-object call: the target bucket and key. */
export interface S3CompatibleHeadObjectInput {
  bucket: string;
  key: string;
}

/** Object metadata returned by an S3-compatible client: content length, content type, etag, modified time, and custom metadata. */
export interface S3CompatibleObjectMetadata {
  contentLength?: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date | string;
  metadata?: Readonly<Record<string, string>>;
}

/** Output of an S3-compatible put-object call: the object metadata plus an optional size. */
export interface S3CompatiblePutObjectOutput extends S3CompatibleObjectMetadata {
  size?: number;
}

/** Output of an S3-compatible get-object call: the object metadata plus the object body. */
export interface S3CompatibleGetObjectOutput extends S3CompatibleObjectMetadata {
  body: StorageBody;
}

/** The minimal S3-compatible client an app supplies: get, head, and put object operations. */
export interface S3CompatibleObjectClient {
  getObject(input: S3CompatibleGetObjectInput): Promise<S3CompatibleGetObjectOutput | undefined>;
  headObject(input: S3CompatibleHeadObjectInput): Promise<S3CompatibleObjectMetadata | undefined>;
  putObject(input: S3CompatiblePutObjectInput): Promise<S3CompatiblePutObjectOutput>;
}

/** Options for S3-compatible storage: the bucket, the underlying object client, and an optional key prefix. */
export interface S3CompatibleStorageOptions {
  bucket: string;
  client: S3CompatibleObjectClient;
  prefix?: string;
}

interface StoredMemoryObject {
  body: Uint8Array;
  info: StorageObjectInfo;
}

interface FileSystemMetadataRecord {
  contentType?: string;
  etag?: string;
  lastModified: string;
  metadata?: Readonly<Record<string, string>>;
  size: number;
}

const textEncoder = new TextEncoder();
const sidecarSuffix = '.kovo-storage.json';

/**
 * Create an in-memory object store implementing `StorageCapability`. Useful for
 * tests and local development where uploads should not touch disk or a bucket.
 *
 * @param options - Optional `now` clock for deterministic `lastModified` values.
 * @returns A `StorageCapability` backed by a `Map`.
 * @example
 * import { createMemoryStorage } from '@kovojs/core';
 *
 * const storage = createMemoryStorage();
 * await storage.put('avatars/1.png', new Uint8Array([1, 2, 3]));
 */
export function createMemoryStorage(options: MemoryStorageOptions = {}): StorageCapability {
  const objects = new Map<string, StoredMemoryObject>();
  const now = options.now ?? (() => new Date());

  return {
    async get(key) {
      const normalizedKey = normalizeStorageKey(key);
      const object = objects.get(normalizedKey);
      if (object === undefined) return undefined;

      return {
        ...copyInfo(object.info),
        body: copyBytes(object.body),
      };
    },
    async put(key, body, putOptions = {}) {
      const normalizedKey = normalizeStorageKey(key);
      const bytes = await storageBodyToBytes(body);
      const info = objectInfo(normalizedKey, bytes.byteLength, putOptions, now());
      objects.set(normalizedKey, {
        body: copyBytes(bytes),
        info,
      });
      return copyInfo(info);
    },
    async stat(key) {
      const normalizedKey = normalizeStorageKey(key);
      const object = objects.get(normalizedKey);
      return object === undefined ? undefined : copyInfo(object.info);
    },
    async stream(key) {
      const normalizedKey = normalizeStorageKey(key);
      const object = objects.get(normalizedKey);
      if (object === undefined) return undefined;

      return {
        ...copyInfo(object.info),
        body: bytesToReadableStream(object.body),
      };
    },
  };
}

/**
 * Create an object store backed by a directory on the local filesystem. Object
 * metadata is kept in sidecar JSON files alongside each blob.
 *
 * @param options - The `root` directory under which objects are stored.
 * @returns A `StorageCapability` backed by the filesystem.
 * @example
 * import { createFileSystemStorage } from '@kovojs/core';
 *
 * const storage = createFileSystemStorage({ root: './uploads' });
 */
export function createFileSystemStorage(options: FileSystemStorageOptions): StorageCapability {
  const root = options.root;

  return {
    async get(key) {
      const normalizedKey = normalizeStorageKey(key);
      const { readFile } = await import('node:fs/promises');
      const filePath = await storageFilePath(root, normalizedKey);
      const [bytes, info] = await Promise.all([
        readFile(filePath).catch((error: unknown) => {
          if (isNotFoundError(error)) return undefined;
          throw error;
        }),
        fileSystemStat(root, normalizedKey),
      ]);
      if (bytes === undefined || info === undefined) return undefined;

      return {
        ...info,
        body: new Uint8Array(bytes),
      };
    },
    async put(key, body, putOptions = {}) {
      const normalizedKey = normalizeStorageKey(key);
      const { mkdir, writeFile } = await import('node:fs/promises');
      const path = await import('node:path');
      const filePath = await storageFilePath(root, normalizedKey);
      const bytes = await storageBodyToBytes(body);
      const lastModified = new Date();
      const info = objectInfo(normalizedKey, bytes.byteLength, putOptions, lastModified);

      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, bytes);
      await writeFile(metadataFilePath(filePath), JSON.stringify(metadataRecord(info)), 'utf8');

      return info;
    },
    async stat(key) {
      return fileSystemStat(root, normalizeStorageKey(key));
    },
    async stream(key) {
      const normalizedKey = normalizeStorageKey(key);
      const { createReadStream } = await import('node:fs');
      const { Readable } = await import('node:stream');
      const filePath = await storageFilePath(root, normalizedKey);
      const info = await fileSystemStat(root, normalizedKey);
      if (info === undefined) return undefined;

      return {
        ...info,
        body: Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>,
      };
    },
  };
}

/**
 * Adapt any S3-compatible object client (AWS S3, R2, MinIO, …) to the
 * `StorageCapability` interface, so the same upload code works across backends.
 *
 * @param options - The bucket and an `S3CompatibleObjectClient` implementation.
 * @returns A `StorageCapability` backed by the given client and bucket.
 */
export function createS3CompatibleStorage(options: S3CompatibleStorageOptions): StorageCapability {
  const prefix = options.prefix === undefined ? undefined : normalizeStoragePrefix(options.prefix);

  return {
    async get(key) {
      const normalizedKey = normalizeStorageKey(key);
      const output = await options.client.getObject({
        bucket: options.bucket,
        key: s3ObjectKey(prefix, normalizedKey),
      });
      if (output === undefined) return undefined;

      const body = await storageBodyToBytes(output.body);
      return {
        ...s3ObjectInfo(normalizedKey, output, body.byteLength),
        body,
      };
    },
    async put(key, body, putOptions = {}) {
      const normalizedKey = normalizeStorageKey(key);
      const size = storageBodySize(body);
      const output = await options.client.putObject({
        bucket: options.bucket,
        key: s3ObjectKey(prefix, normalizedKey),
        body,
        ...(putOptions.contentType === undefined ? {} : { contentType: putOptions.contentType }),
        ...(putOptions.metadata === undefined ? {} : { metadata: putOptions.metadata }),
      });

      return s3ObjectInfo(normalizedKey, output, output.size ?? size ?? 0, putOptions.etag);
    },
    async stat(key) {
      const normalizedKey = normalizeStorageKey(key);
      const output = await options.client.headObject({
        bucket: options.bucket,
        key: s3ObjectKey(prefix, normalizedKey),
      });
      return output === undefined ? undefined : s3ObjectInfo(normalizedKey, output, 0);
    },
    async stream(key) {
      const normalizedKey = normalizeStorageKey(key);
      const output = await options.client.getObject({
        bucket: options.bucket,
        key: s3ObjectKey(prefix, normalizedKey),
      });
      if (output === undefined) return undefined;

      return {
        ...s3ObjectInfo(normalizedKey, output, 0),
        body: storageBodyToReadableStream(output.body),
      };
    },
  };
}

/**
 * Normalize a storage key: trim, collapse slashes, and reject path-traversal so
 * keys cannot escape their prefix.
 *
 * @param key - The raw object key.
 * @returns The normalized key.
 * @example
 * import { normalizeStorageKey } from '@kovojs/core';
 *
 * const key: string = normalizeStorageKey('/avatars//1.png');
 */
export function normalizeStorageKey(key: string): string {
  if (key.length === 0) throw new Error('Storage key must not be empty.');
  if (key.includes('\0')) throw new Error('Storage key must not contain null bytes.');
  if (key.startsWith('/')) throw new Error('Storage key must be relative.');

  const parts = key.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw new Error('Storage key must not contain empty, current, or parent path segments.');
  }

  return parts.join('/');
}

/**
 * Materialize any `StorageBody` (string, ArrayBuffer, typed array, or stream)
 * into a single `Uint8Array`.
 *
 * @param body - The storage body to read.
 * @returns The body's bytes as a `Uint8Array`.
 * @example
 * import { storageBodyToBytes } from '@kovojs/core';
 *
 * const bytes: Uint8Array = await storageBodyToBytes('hello');
 */
export async function storageBodyToBytes(body: StorageBody): Promise<Uint8Array> {
  if (typeof body === 'string') return textEncoder.encode(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  while (true) {
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
    length += result.value.byteLength;
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

function objectInfo(
  key: string,
  size: number,
  options: StoragePutOptions,
  lastModified: Date,
): StorageObjectInfo {
  return {
    key,
    lastModified,
    size,
    ...(options.contentType === undefined ? {} : { contentType: options.contentType }),
    ...(options.etag === undefined
      ? { etag: storageEtag(key, size, lastModified) }
      : { etag: options.etag }),
    ...(options.metadata === undefined ? {} : { metadata: { ...options.metadata } }),
  };
}

function metadataRecord(info: StorageObjectInfo): FileSystemMetadataRecord {
  return {
    lastModified: info.lastModified?.toISOString() ?? new Date().toISOString(),
    size: info.size,
    ...(info.contentType === undefined ? {} : { contentType: info.contentType }),
    ...(info.etag === undefined ? {} : { etag: info.etag }),
    ...(info.metadata === undefined ? {} : { metadata: info.metadata }),
  };
}

async function fileSystemStat(root: string, key: string): Promise<StorageObjectInfo | undefined> {
  const { readFile, stat: fsStat } = await import('node:fs/promises');
  const filePath = await storageFilePath(root, key);
  const fileStats = await fsStat(filePath).catch((error: unknown) => {
    if (isNotFoundError(error)) return undefined;
    throw error;
  });
  if (fileStats === undefined) return undefined;

  const record = await readFile(metadataFilePath(filePath), 'utf8')
    .then((value) => JSON.parse(value) as Partial<FileSystemMetadataRecord>)
    .catch((error: unknown) => {
      if (isNotFoundError(error)) return undefined;
      throw error;
    });

  return {
    key,
    lastModified:
      record?.lastModified === undefined ? fileStats.mtime : new Date(record.lastModified),
    size: fileStats.size,
    ...(record?.contentType === undefined ? {} : { contentType: record.contentType }),
    ...(record?.etag === undefined ? {} : { etag: record.etag }),
    ...(record?.metadata === undefined ? {} : { metadata: record.metadata }),
  };
}

async function storageFilePath(root: string, key: string): Promise<string> {
  const path = await import('node:path');
  const resolvedRoot = path.resolve(root);
  const filePath = path.resolve(resolvedRoot, key);
  const relativePath = path.relative(resolvedRoot, filePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Storage key resolves outside the storage root.');
  }
  return filePath;
}

function metadataFilePath(filePath: string): string {
  return `${filePath}${sidecarSuffix}`;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function storageEtag(key: string, size: number, lastModified: Date): string {
  return `"kovo-${encodeURIComponent(key)}-${size}-${lastModified.getTime()}"`;
}

function copyInfo(info: StorageObjectInfo): StorageObjectInfo {
  return {
    ...info,
    ...(info.lastModified === undefined ? {} : { lastModified: new Date(info.lastModified) }),
    ...(info.metadata === undefined ? {} : { metadata: { ...info.metadata } }),
  };
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function bytesToReadableStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(copyBytes(bytes));
      controller.close();
    },
  });
}

function storageBodyToReadableStream(body: StorageBody): ReadableStream<Uint8Array> {
  if (typeof body === 'string' || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(await storageBodyToBytes(body));
        controller.close();
      },
    });
  }

  return body;
}

function storageBodySize(body: StorageBody): number | undefined {
  if (typeof body === 'string') return textEncoder.encode(body).byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  return undefined;
}

function normalizeStoragePrefix(prefix: string): string {
  return prefix
    .split('/')
    .filter((part) => part.length > 0)
    .map(normalizeStorageKey)
    .join('/');
}

function s3ObjectKey(prefix: string | undefined, key: string): string {
  return prefix === undefined || prefix.length === 0 ? key : `${prefix}/${key}`;
}

function s3ObjectInfo(
  key: string,
  metadata: S3CompatibleObjectMetadata,
  fallbackSize: number,
  fallbackEtag?: string,
): StorageObjectInfo {
  return {
    key,
    size: metadata.contentLength ?? fallbackSize,
    ...(metadata.contentType === undefined ? {} : { contentType: metadata.contentType }),
    ...(metadata.etag === undefined
      ? fallbackEtag === undefined
        ? {}
        : { etag: fallbackEtag }
      : { etag: metadata.etag }),
    ...(metadata.lastModified === undefined
      ? {}
      : { lastModified: new Date(metadata.lastModified) }),
    ...(metadata.metadata === undefined ? {} : { metadata: { ...metadata.metadata } }),
  };
}
