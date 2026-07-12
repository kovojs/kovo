import { createHash } from 'node:crypto';

import { createFrameworkOutputFileSystemBoundary } from './internal/filesystem.js';
import {
  createFileSystemMap,
  createFileSystemReadableStream,
  fileSystemArrayBufferViewByteLength,
  fileSystemArrayJoin,
  fileSystemArraySome,
  fileSystemCopyArrayBuffer,
  fileSystemCopyArrayBufferView,
  fileSystemCreateUint8Array,
  fileSystemFreeze,
  fileSystemIsArrayBuffer,
  fileSystemIsArrayBufferView,
  fileSystemJsonParse,
  fileSystemJsonStringify,
  fileSystemMapDelete,
  fileSystemMapGet,
  fileSystemMapSet,
  fileSystemObjectValues,
  fileSystemReadableStreamClose,
  fileSystemReadableStreamEnqueue,
  fileSystemReadableStreamError,
  fileSystemReadableStreamGetReader,
  fileSystemReadableStreamReadChunk,
  fileSystemReadableStreamReleaseLock,
  fileSystemReflectApply,
  fileSystemStableMethod,
  fileSystemStringEndsWith,
  fileSystemStringIncludes,
  fileSystemStringSplit,
  fileSystemStringStartsWith,
  fileSystemStringToLowerCase,
  fileSystemUint8ArraySet,
  fileSystemUtf8Decode,
  fileSystemUtf8Encode,
} from './internal/filesystem-intrinsics.js';

/** The accepted body shapes when writing an object: a string, raw bytes, or a byte stream. */
export type StorageBody = string | ArrayBuffer | ArrayBufferView | ReadableStream<Uint8Array>;

/** Optional metadata to attach when writing an object: content type, etag, and custom key/value metadata. */
export interface StoragePutOptions {
  contentType?: string;
  etag?: string;
  metadata?: Readonly<Record<string, string>>;
}

/**
 * Descriptive information about a stored object: its key and optional size, content type, etag,
 * modified time, and metadata.
 *
 * `size` is the object's byte length when known. It is `undefined` only when a backend genuinely
 * cannot report it (e.g. an S3-compatible client that omits `contentLength` on a head/stream, where
 * no body is materialized); the framework never fabricates `size: 0` for a non-empty object so that
 * the memory, filesystem, and S3 adapters agree on observable info (SPEC §12/§13 parity; Part 3 bug
 * L2-storage-3). Memory and filesystem always know the length, so `size` is always present there.
 */
export interface StorageObjectInfo {
  contentType?: string;
  etag?: string;
  key: string;
  lastModified?: Date;
  metadata?: Readonly<Record<string, string>>;
  size?: number;
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

/** Read-only object-storage authority: fetch, stat, and stream objects by key. */
export interface StorageReadCapability {
  get(key: string): Promise<StorageGetResult | undefined>;
  stat(key: string): Promise<StorageObjectInfo | undefined>;
  stream(key: string): Promise<StorageStreamResult | undefined>;
}

/** Write authority for storing upload bytes by key. */
export interface StoragePutCapability {
  put(key: string, body: StorageBody, options?: StoragePutOptions): Promise<StoragePutResult>;
}

/** Write authority for deleting stored objects by key. */
export interface StorageDeleteCapability {
  delete(key: string): Promise<void>;
}

/** The full object-storage interface an app wires into upload, delete, and download surfaces. */
export interface StorageCapability
  extends StorageDeleteCapability, StoragePutCapability, StorageReadCapability {}

/** Options for the filesystem-backed storage adapter: the root directory objects are stored under. */
export interface FileSystemStorageOptions {
  root: string;
}

/** Options for the in-memory storage adapter: an optional clock used for deterministic modified times. */
export interface MemoryStorageOptions {
  now?: () => Date;
}

/**
 * Input to an S3-compatible put-object call: target bucket and key, the body, and optional
 * content type, caller-supplied etag, and metadata.
 *
 * `etag` is the caller-provided etag from `StoragePutOptions`. SPEC §12/§13 cross-backend parity
 * (Part 3 bug L2): memory and filesystem honor a caller etag, so a conforming S3-compatible client
 * SHOULD persist this value (e.g. as object user-metadata) and echo it back as `metadata.etag` on
 * subsequent get/head, so the same input yields the same observable etag on every backend.
 */
export interface S3CompatiblePutObjectInput {
  body: StorageBody;
  bucket: string;
  contentType?: string;
  etag?: string;
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

/** Input to an S3-compatible delete-object call: the target bucket and key. */
export interface S3CompatibleDeleteObjectInput {
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
  deleteObject(input: S3CompatibleDeleteObjectInput): Promise<void>;
  getObject(input: S3CompatibleGetObjectInput): Promise<S3CompatibleGetObjectOutput | undefined>;
  headObject(input: S3CompatibleHeadObjectInput): Promise<S3CompatibleObjectMetadata | undefined>;
  putObject(input: S3CompatiblePutObjectInput): Promise<S3CompatiblePutObjectOutput>;
}

/** Options for the S3-compatible storage adapter: the bucket, the underlying object client, and an optional key prefix. */
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
  logicalKey: string;
  metadata?: Readonly<Record<string, string>>;
  size?: number;
}

const sidecarSuffix = '.kovo-storage.json';
const fileSystemObjectPrefix = 'kovo-storage-v1';

/**
 * Create an in-memory object store implementing `StorageCapability`.
 * Useful for tests and local development where uploads should not touch disk or
 * a bucket. Apps can pass the returned capability to upload and download sinks.
 *
 * @param options - Optional `now` clock for deterministic `lastModified` values.
 * @returns A `StorageCapability` backed by a `Map`.
 */
export function createMemoryStorage(options: MemoryStorageOptions = {}): StorageCapability {
  const objects = createFileSystemMap<string, StoredMemoryObject>();
  const now = options.now ?? (() => new Date());

  return {
    async delete(key) {
      fileSystemMapDelete(objects, normalizeStorageKey(key));
    },
    async get(key) {
      const normalizedKey = normalizeStorageKey(key);
      const object = fileSystemMapGet(objects, normalizedKey);
      if (object === undefined) return undefined;

      return {
        ...copyInfo(object.info),
        body: copyBytes(object.body),
      };
    },
    async put(key, body, putOptions = {}) {
      const normalizedKey = normalizeStorageKey(key);
      const bytes = await storageBodyToBytes(body);
      const info = objectInfo(
        normalizedKey,
        fileSystemArrayBufferViewByteLength(bytes),
        putOptions,
        now(),
      );
      fileSystemMapSet(objects, normalizedKey, {
        body: copyBytes(bytes),
        info,
      });
      return copyInfo(info);
    },
    async stat(key) {
      const normalizedKey = normalizeStorageKey(key);
      const object = fileSystemMapGet(objects, normalizedKey);
      return object === undefined ? undefined : copyInfo(object.info);
    },
    async stream(key) {
      const normalizedKey = normalizeStorageKey(key);
      const object = fileSystemMapGet(objects, normalizedKey);
      if (object === undefined) return undefined;

      return {
        ...copyInfo(object.info),
        body: bytesToReadableStream(object.body),
      };
    },
  };
}

/**
 * Create an object store backed by a directory on the local
 * filesystem. Object metadata is kept in sidecar JSON files alongside each
 * blob. Apps can pass the returned capability to upload and download sinks.
 *
 * @param options - The `root` directory under which objects are stored.
 * @returns A `StorageCapability` backed by the filesystem.
 */
export function createFileSystemStorage(options: FileSystemStorageOptions): StorageCapability {
  const fileSystem = createFrameworkOutputFileSystemBoundary(options.root);
  const writeLocks = createFileSystemMap<string, Promise<void>>();

  return {
    async delete(key) {
      const normalizedKey = normalizeStorageKey(key);
      const physicalKey = fileSystemStorageKey(normalizedKey);
      const filePath = storageFilePath(fileSystem, physicalKey);
      await withFileSystemWriteLock(writeLocks, filePath, async () => {
        const record = await readFileSystemMetadataRecord(fileSystem, physicalKey);
        // SPEC §6.6 object-exact capability binding: deletion is a sink too. A missing, malformed,
        // or differently-owned sidecar cannot authorize removing bytes from an aliased host path.
        if (record?.logicalKey !== normalizedKey) return;
        await Promise.all([
          fileSystem.deleteFile(physicalKey),
          fileSystem.deleteFile(metadataStorageKey(physicalKey)),
        ]);
      });
    },
    async get(key) {
      const normalizedKey = normalizeStorageKey(key);
      const info = await fileSystemStat(fileSystem, normalizedKey);
      if (info === undefined) return undefined;
      const bytes = await fileSystem.fileBytes(fileSystemStorageKey(normalizedKey));
      if (bytes === undefined) return undefined;

      return {
        ...info,
        body: copyBytes(bytes),
      };
    },
    async put(key, body, putOptions = {}) {
      const normalizedKey = normalizeStorageKey(key);
      const physicalKey = fileSystemStorageKey(normalizedKey);
      const filePath = storageFilePath(fileSystem, physicalKey);
      const bytes = await storageBodyToBytes(body);
      const lastModified = new Date();
      const info = objectInfo(
        normalizedKey,
        fileSystemArrayBufferViewByteLength(bytes),
        putOptions,
        lastModified,
      );

      await withFileSystemWriteLock(writeLocks, filePath, async () => {
        await assertFileSystemStorageSlotOwnership(fileSystem, physicalKey, normalizedKey);
        // SPEC §12/§13 storage parity: filesystem writes must not expose half-written blobs or
        // mismatched blob/sidecar metadata under concurrent puts to the same object.
        await fileSystem.writeFile(physicalKey, bytes);
        await fileSystem.writeFile(
          metadataStorageKey(physicalKey),
          fileSystemJsonStringify(metadataRecord(info)),
        );
      });

      return info;
    },
    async stat(key) {
      return fileSystemStat(fileSystem, normalizeStorageKey(key));
    },
    async stream(key) {
      const normalizedKey = normalizeStorageKey(key);
      const info = await fileSystemStat(fileSystem, normalizedKey);
      if (info === undefined) return undefined;
      const bytes = await fileSystem.fileBytes(fileSystemStorageKey(normalizedKey));
      if (bytes === undefined) return undefined;

      return {
        ...info,
        body: bytesToReadableStream(bytes),
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
    async delete(key) {
      const normalizedKey = normalizeStorageKey(key);
      await options.client.deleteObject({
        bucket: options.bucket,
        key: s3ObjectKey(prefix, normalizedKey),
      });
    },
    async get(key) {
      const normalizedKey = normalizeStorageKey(key);
      const output = await options.client.getObject({
        bucket: options.bucket,
        key: s3ObjectKey(prefix, normalizedKey),
      });
      if (output === undefined) return undefined;

      const body = await storageBodyToBytes(output.body);
      return {
        ...s3ObjectInfo(
          normalizedKey,
          output,
          fileSystemArrayBufferViewByteLength(body),
        ),
        body,
      };
    },
    async put(key, body, putOptions = {}) {
      const normalizedKey = normalizeStorageKey(key);
      // SPEC §6.6/§12: snapshot every accepted carrier through boot-pinned byte controls before
      // handing it to an adapter. The client must never observe bytes different from the body Kovo
      // classified merely because app code replaced ArrayBuffer/stream prototype operations.
      const bytes = await storageBodyToBytes(body);
      const size = fileSystemArrayBufferViewByteLength(bytes);
      const output = await options.client.putObject({
        bucket: options.bucket,
        key: s3ObjectKey(prefix, normalizedKey),
        body: bytes,
        ...(putOptions.contentType === undefined ? {} : { contentType: putOptions.contentType }),
        // Forward the caller etag so a conforming client can persist + echo it (Part 3 bug L2 parity).
        ...(putOptions.etag === undefined ? {} : { etag: putOptions.etag }),
        ...(putOptions.metadata === undefined ? {} : { metadata: putOptions.metadata }),
      });

      // `size` (the materialized body length) is the out-of-band fallback; `s3ObjectInfo` prefers the
      // client's `contentLength`. Caller etag is honored uniformly (Part 3 bug L2).
      return s3ObjectInfo(normalizedKey, output, output.size ?? size, putOptions.etag);
    },
    async stat(key) {
      const normalizedKey = normalizeStorageKey(key);
      const output = await options.client.headObject({
        bucket: options.bucket,
        key: s3ObjectKey(prefix, normalizedKey),
      });
      // No body is materialized on a head, so size is whatever the client reports; never fabricate 0
      // for a content-length-blind client (Part 3 bug L2-storage-3).
      return output === undefined ? undefined : s3ObjectInfo(normalizedKey, output, undefined);
    },
    async stream(key) {
      const normalizedKey = normalizeStorageKey(key);
      const output = await options.client.getObject({
        bucket: options.bucket,
        key: s3ObjectKey(prefix, normalizedKey),
      });
      if (output === undefined) return undefined;

      return {
        // Streaming does not pre-buffer the body, so size is the client-reported length or unknown
        // (undefined) — never a fabricated 0 (Part 3 bug L2-storage-3).
        ...s3ObjectInfo(normalizedKey, output, undefined),
        body: storageBodyToReadableStream(output.body),
      };
    },
  };
}

/**
 * @internal Create a runtime read-only storage view for GET/read surfaces.
 *
 * SPEC §6.6 honesty boundary: the narrowed TypeScript type is only author-time ergonomics. The
 * façade keeps the sink fail-closed if same-process code casts the read view back to a write shape.
 */
export function createReadOnlyStorageCapability(
  storage: StorageReadCapability,
): StorageReadCapability {
  const get = fileSystemStableMethod(storage, 'get', 'storage.get') as StorageReadCapability['get'];
  const stat = fileSystemStableMethod(
    storage,
    'stat',
    'storage.stat',
  ) as StorageReadCapability['stat'];
  const stream = fileSystemStableMethod(
    storage,
    'stream',
    'storage.stream',
  ) as StorageReadCapability['stream'];
  const denyWrite = async (): Promise<never> => {
    throw new Error(
      'KV433: read-only storage capability cannot write from a query or public GET path ' +
        '(SPEC §6.6/§9.4). Route upload/store/delete work through mutation(), endpoint(), or an ' +
        'audited capability surface.',
    );
  };
  const readOnly = fileSystemFreeze({
    get(key: string) {
      return fileSystemReflectApply<ReturnType<StorageReadCapability['get']>>(get, storage, [key]);
    },
    stat(key: string) {
      return fileSystemReflectApply<ReturnType<StorageReadCapability['stat']>>(stat, storage, [
        key,
      ]);
    },
    stream(key: string) {
      return fileSystemReflectApply<ReturnType<StorageReadCapability['stream']>>(stream, storage, [
        key,
      ]);
    },
    // Deliberately present only at runtime so `as any` cannot recover known write authority from a
    // read view. The public type omits these methods.
    delete: denyWrite,
    put: denyWrite,
    store: denyWrite,
    upload: denyWrite,
  });
  return readOnly as StorageReadCapability;
}

/**
 * @internal Normalize a storage key: trim, collapse slashes, and reject
 * path-traversal so keys cannot escape their prefix. Repo-internal helper used
 * by the storage adapters.
 *
 * @param key - The raw object key.
 * @returns The normalized key.
 */
export function normalizeStorageKey(key: string): string {
  if (key.length === 0) throw new Error('Storage key must not be empty.');
  if (fileSystemStringIncludes(key, '\0'))
    throw new Error('Storage key must not contain null bytes.');
  if (fileSystemStringStartsWith(key, '/')) throw new Error('Storage key must be relative.');

  const parts = fileSystemStringSplit(key, '/');
  if (fileSystemArraySome(parts, (part) => part.length === 0 || part === '.' || part === '..')) {
    throw new Error('Storage key must not contain empty, current, or parent path segments.');
  }

  // SPEC §12/§13 cross-backend parity: the filesystem adapter persists each object's metadata in a
  // sidecar at `<blob>.kovo-storage.json` (see `metadataFilePath`). A user key whose FINAL segment
  // ends with that suffix would alias another object's sidecar — letting an attacker overwrite a
  // victim's metadata (contentType/etag spoofing) or read it back as a body (metadata disclosure).
  // Memory and S3 have no sidecar, so the keys would silently coexist there; the adapters would then
  // disagree on whether the keys can exist. Reject the reserved suffix here so the rule is uniform
  // across all three adapters regardless of backend (Part 3 bug L1).
  const finalSegment = parts[parts.length - 1] ?? '';
  if (
    fileSystemStringEndsWith(
      fileSystemStringToLowerCase(finalSegment),
      fileSystemStringToLowerCase(sidecarSuffix),
    )
  ) {
    throw new Error(`Storage key must not end with the reserved suffix "${sidecarSuffix}".`);
  }

  return fileSystemArrayJoin(parts, '/');
}

/**
 * @internal Materialize any `StorageBody` (string, ArrayBuffer, typed array, or
 * stream) into a single `Uint8Array`. Repo-internal helper used by the storage
 * adapters.
 *
 * @param body - The storage body to read.
 * @returns The body's bytes as a `Uint8Array`.
 */
export async function storageBodyToBytes(body: StorageBody): Promise<Uint8Array> {
  if (typeof body === 'string') return fileSystemUtf8Encode(body);
  if (fileSystemIsArrayBuffer(body)) return fileSystemCopyArrayBuffer(body);
  if (fileSystemIsArrayBufferView(body)) return fileSystemCopyArrayBufferView(body);

  const reader = fileSystemReadableStreamGetReader(body);
  const chunks = createFileSystemMap<number, Uint8Array>();
  let chunkCount = 0;
  let length = 0;

  try {
    for (; chunkCount <= 1_000_000; chunkCount += 1) {
      const chunk = await fileSystemReadableStreamReadChunk(reader);
      if (chunk === undefined) break;
      const chunkLength = fileSystemArrayBufferViewByteLength(chunk);
      if (chunkLength > 9_007_199_254_740_991 - length) {
        throw new TypeError('Kovo storage refused an unbounded byte stream.');
      }
      fileSystemMapSet(chunks, chunkCount, chunk);
      length += chunkLength;
      if (chunkCount === 1_000_000) {
        throw new TypeError('Kovo storage refused a byte stream with too many chunks.');
      }
    }
  } finally {
    fileSystemReadableStreamReleaseLock(reader);
  }

  const bytes = fileSystemCreateUint8Array(length);
  let offset = 0;
  for (let index = 0; index < chunkCount; index += 1) {
    const chunk = fileSystemMapGet(chunks, index);
    if (chunk === undefined) throw new TypeError('Kovo storage lost a snapshotted byte chunk.');
    fileSystemUint8ArraySet(bytes, chunk, offset);
    offset += fileSystemArrayBufferViewByteLength(chunk);
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
    logicalKey: info.key,
    ...(info.size === undefined ? {} : { size: info.size }),
    ...(info.contentType === undefined ? {} : { contentType: info.contentType }),
    ...(info.etag === undefined ? {} : { etag: info.etag }),
    ...(info.metadata === undefined ? {} : { metadata: info.metadata }),
  };
}

async function fileSystemStat(
  fileSystem: ReturnType<typeof createFrameworkOutputFileSystemBoundary>,
  key: string,
): Promise<StorageObjectInfo | undefined> {
  const physicalKey = fileSystemStorageKey(key);
  const record = await readFileSystemMetadataRecord(fileSystem, physicalKey);
  // The lowercase ASCII physical name is only an index. The exact logical key in the sidecar is
  // the authority that closes hash collisions, ill-formed UTF-16 replacement collisions, and any
  // host filesystem aliasing. Missing/malformed/mismatched ownership fails closed as not found.
  if (record?.logicalKey !== key) return undefined;

  const fileStats = await fileSystem.statFile(physicalKey);
  if (fileStats === undefined) return undefined;

  return {
    key,
    lastModified: new Date(record.lastModified),
    size: fileStats.size,
    ...(record.contentType === undefined ? {} : { contentType: record.contentType }),
    ...(record.etag === undefined ? {} : { etag: record.etag }),
    ...(record.metadata === undefined ? {} : { metadata: record.metadata }),
  };
}

/**
 * Map an exact logical UTF-8 key to a host-stable physical path (SPEC §6.6).
 *
 * Only lowercase ASCII hex reaches the filesystem, so case folding, Unicode normalization,
 * Windows reserved basenames, and trailing-dot/space trimming cannot alias distinct logical keys.
 * The sidecar still stores and verifies the exact logical string because a digest is an index, not
 * an authorization proof.
 */
function fileSystemStorageKey(key: string): string {
  const digest = createHash('sha256').update(fileSystemUtf8Encode(key)).digest('hex');
  return `${fileSystemObjectPrefix}/${digest.slice(0, 2)}/${digest.slice(2)}`;
}

async function readFileSystemMetadataRecord(
  fileSystem: ReturnType<typeof createFrameworkOutputFileSystemBoundary>,
  physicalKey: string,
): Promise<FileSystemMetadataRecord | undefined> {
  const bytes = await fileSystem.fileBytes(metadataStorageKey(physicalKey));
  if (bytes === undefined) return undefined;
  try {
    const value: unknown = fileSystemJsonParse(fileSystemUtf8Decode(bytes));
    return isFileSystemMetadataRecord(value) ? value : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function isFileSystemMetadataRecord(value: unknown): value is FileSystemMetadataRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Partial<FileSystemMetadataRecord>;
  if (typeof record.logicalKey !== 'string' || typeof record.lastModified !== 'string')
    return false;
  if (!Number.isFinite(Date.parse(record.lastModified))) return false;
  if (record.contentType !== undefined && typeof record.contentType !== 'string') return false;
  if (record.etag !== undefined && typeof record.etag !== 'string') return false;
  if (record.size !== undefined && (!Number.isSafeInteger(record.size) || record.size < 0))
    return false;
  if (
    record.metadata !== undefined &&
    (typeof record.metadata !== 'object' ||
      record.metadata === null ||
      Array.isArray(record.metadata) ||
      fileSystemArraySome(
        fileSystemObjectValues(record.metadata),
        (entry) => typeof entry !== 'string',
      ))
  )
    return false;
  return true;
}

async function assertFileSystemStorageSlotOwnership(
  fileSystem: ReturnType<typeof createFrameworkOutputFileSystemBoundary>,
  physicalKey: string,
  logicalKey: string,
): Promise<void> {
  const [fileStats, sidecarBytes] = await Promise.all([
    fileSystem.statFile(physicalKey),
    fileSystem.fileBytes(metadataStorageKey(physicalKey)),
  ]);
  if (fileStats === undefined && sidecarBytes === undefined) return;

  const record = await readFileSystemMetadataRecord(fileSystem, physicalKey);
  if (record?.logicalKey === logicalKey) return;
  throw new Error(
    'Filesystem storage physical-key collision or metadata ownership mismatch; refusing to overwrite.',
  );
}

function storageFilePath(
  fileSystem: ReturnType<typeof createFrameworkOutputFileSystemBoundary>,
  key: string,
): string {
  const filePath = fileSystem.confinedPath(key);
  if (filePath === undefined) throw new Error('Storage key resolves outside the storage root.');
  return filePath;
}

function metadataStorageKey(key: string): string {
  return `${key}${sidecarSuffix}`;
}

async function withFileSystemWriteLock<T>(
  locks: Map<string, Promise<void>>,
  filePath: string,
  run: () => Promise<T>,
): Promise<T> {
  const previous = fileSystemMapGet(locks, filePath) ?? Promise.resolve();
  let releaseCurrent: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const lock = previous.then(
    () => current,
    () => current,
  );
  fileSystemMapSet(locks, filePath, lock);
  await previous.catch(() => undefined);
  try {
    return await run();
  } finally {
    releaseCurrent();
    if (fileSystemMapGet(locks, filePath) === lock) fileSystemMapDelete(locks, filePath);
  }
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
  return fileSystemCopyArrayBufferView(bytes);
}

function bytesToReadableStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const snapshot = copyBytes(bytes);
  return createFileSystemReadableStream<Uint8Array>({
    start(controller) {
      fileSystemReadableStreamEnqueue(controller, snapshot);
      fileSystemReadableStreamClose(controller);
    },
  });
}

function storageBodyToReadableStream(body: StorageBody): ReadableStream<Uint8Array> {
  return createFileSystemReadableStream<Uint8Array>({
    async start(controller) {
      try {
        fileSystemReadableStreamEnqueue(controller, await storageBodyToBytes(body));
        fileSystemReadableStreamClose(controller);
      } catch (error) {
        fileSystemReadableStreamError(controller, error);
      }
    },
  });
}

function normalizeStoragePrefix(prefix: string): string {
  const rawParts = fileSystemStringSplit(prefix, '/');
  const normalizedParts: string[] = [];
  for (let index = 0; index < rawParts.length; index += 1) {
    const part = rawParts[index]!;
    if (part.length > 0) normalizedParts[normalizedParts.length] = normalizeStorageKey(part);
  }
  return fileSystemArrayJoin(normalizedParts, '/');
}

function s3ObjectKey(prefix: string | undefined, key: string): string {
  return prefix === undefined || prefix.length === 0 ? key : `${prefix}/${key}`;
}

/**
 * @internal Project an S3-compatible client's metadata onto `StorageObjectInfo`.
 *
 * SPEC §12/§13 cross-backend parity (Part 3 bugs L2 / L2-storage-3):
 * - `callerEtag` (the `options.etag` a caller passed to `put`) is honored UNIFORMLY across all three
 *   adapters: when provided it OVERRIDES the server-assigned `metadata.etag`, matching memory/FS
 *   (`objectInfo` at `:368-370`). Real S3 clients always return a server etag, so without this the
 *   caller etag would be silently discarded only on the production backend.
 * - `fallbackSize` is the size resolved out-of-band (a materialized body length, etc.) or `undefined`
 *   when genuinely unknown. The adapter never fabricates `size: 0`: if neither the client's
 *   `contentLength` nor a known fallback is available, `size` is left `undefined` rather than
 *   misreporting a non-empty object as empty.
 */
function s3ObjectInfo(
  key: string,
  metadata: S3CompatibleObjectMetadata,
  fallbackSize: number | undefined,
  callerEtag?: string,
): StorageObjectInfo {
  const size = metadata.contentLength ?? fallbackSize;
  const etag = callerEtag ?? metadata.etag;
  return {
    key,
    ...(size === undefined ? {} : { size }),
    ...(metadata.contentType === undefined ? {} : { contentType: metadata.contentType }),
    ...(etag === undefined ? {} : { etag }),
    ...(metadata.lastModified === undefined
      ? {}
      : { lastModified: new Date(metadata.lastModified) }),
    ...(metadata.metadata === undefined ? {} : { metadata: { ...metadata.metadata } }),
  };
}
