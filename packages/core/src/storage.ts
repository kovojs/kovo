import { createHash } from 'node:crypto';

import { createFrameworkOutputFileSystemBoundary } from './internal/filesystem.js';
import {
  securityArrayAppend,
  securityApply,
  securityDefineProperty,
  securityEncodeURIComponent,
  securityGetOwnPropertyDescriptor,
  securityHasInstance,
  securityIsArray,
  securityNullRecord,
  securityObjectKeys,
  securityStringSlice,
} from './internal/security-witness-intrinsics.js';
import {
  createFileSystemMap,
  createFileSystemReadableStream,
  fileSystemArrayBufferViewByteLength,
  fileSystemArrayJoin,
  fileSystemArraySome,
  fileSystemCopyArrayBuffer,
  fileSystemCopyArrayBufferView,
  fileSystemCreatePromise,
  fileSystemCreateUint8Array,
  fileSystemFreeze,
  fileSystemIsArrayBuffer,
  fileSystemIsArrayBufferView,
  fileSystemJsonParse,
  fileSystemJsonStringify,
  fileSystemMapDelete,
  fileSystemMapGet,
  fileSystemMapSet,
  fileSystemOwnDataProperty,
  fileSystemPromiseThen,
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

const storageHashProbe = createHash('sha256');
const intrinsicStorageHashUpdate = storageHashProbe.update;
const intrinsicStorageHashDigest = storageHashProbe.digest;
const storageHashControlsSound = verifyStorageHashControls();

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
const IntrinsicDate = globalThis.Date;
const intrinsicDateGetTime = IntrinsicDate.prototype.getTime;
const intrinsicDateToISOString = IntrinsicDate.prototype.toISOString;

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
  const nowProperty = fileSystemOwnDataProperty(options, 'now', 'Memory storage now');
  if (
    nowProperty.found &&
    nowProperty.value !== undefined &&
    typeof nowProperty.value !== 'function'
  ) {
    throw new TypeError('Memory storage now must be an own function data property when provided.');
  }
  const now = (nowProperty.found ? nowProperty.value : undefined) as (() => Date) | undefined;
  const readNow = now ?? (() => new IntrinsicDate());

  return {
    async delete(key) {
      fileSystemMapDelete(objects, normalizeStorageKey(key));
    },
    async get(key) {
      const normalizedKey = normalizeStorageKey(key);
      const object = fileSystemMapGet(objects, normalizedKey);
      if (object === undefined) return undefined;

      return storageReadResult(copyInfo(object.info), copyBytes(object.body));
    },
    async put(key, body, putOptions = {}) {
      const normalizedKey = normalizeStorageKey(key);
      const optionsSnapshot = snapshotStoragePutOptions(putOptions);
      const bytes = await storageBodyToBytes(body);
      const info = objectInfo(
        normalizedKey,
        fileSystemArrayBufferViewByteLength(bytes),
        optionsSnapshot,
        readNow(),
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

      return storageReadResult(copyInfo(object.info), bytesToReadableStream(object.body));
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
  const rootProperty = fileSystemOwnDataProperty(options, 'root', 'Filesystem storage root');
  if (!rootProperty.found || typeof rootProperty.value !== 'string') {
    throw new TypeError('Filesystem storage root must be an own string data property.');
  }
  const fileSystem = createFrameworkOutputFileSystemBoundary(rootProperty.value);
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
        await fileSystem.deleteFile(physicalKey);
        await fileSystem.deleteFile(metadataStorageKey(physicalKey));
      });
    },
    async get(key) {
      const normalizedKey = normalizeStorageKey(key);
      const info = await fileSystemStat(fileSystem, normalizedKey);
      if (info === undefined) return undefined;
      const bytes = await fileSystem.fileBytes(fileSystemStorageKey(normalizedKey));
      if (bytes === undefined) return undefined;

      return storageReadResult(info, copyBytes(bytes));
    },
    async put(key, body, putOptions = {}) {
      const normalizedKey = normalizeStorageKey(key);
      const physicalKey = fileSystemStorageKey(normalizedKey);
      const filePath = storageFilePath(fileSystem, physicalKey);
      const optionsSnapshot = snapshotStoragePutOptions(putOptions);
      const bytes = await storageBodyToBytes(body);
      const lastModified = new IntrinsicDate();
      const info = objectInfo(
        normalizedKey,
        fileSystemArrayBufferViewByteLength(bytes),
        optionsSnapshot,
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

      return storageReadResult(info, bytesToReadableStream(bytes));
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
  // SPEC §6.6 object-exact capability binding: close the adapter over one stable client, bucket,
  // prefix, and method set. A later write through the caller-owned options/client objects must not
  // redirect an already-constructed storage capability to another tenant or backend.
  const bucketProperty = fileSystemOwnDataProperty(options, 'bucket', 'S3 storage bucket');
  const clientProperty = fileSystemOwnDataProperty(options, 'client', 'S3 storage client');
  const prefixProperty = fileSystemOwnDataProperty(options, 'prefix', 'S3 storage prefix');
  if (!bucketProperty.found || typeof bucketProperty.value !== 'string') {
    throw new TypeError('S3 storage bucket must be an own string data property.');
  }
  if (
    !clientProperty.found ||
    (typeof clientProperty.value !== 'object' && typeof clientProperty.value !== 'function') ||
    clientProperty.value === null
  ) {
    throw new TypeError('S3 storage client must be an own object data property.');
  }
  const prefixValue = prefixProperty.found ? prefixProperty.value : undefined;
  if (prefixValue !== undefined && typeof prefixValue !== 'string') {
    throw new TypeError('S3 storage prefix must be an own string data property when provided.');
  }
  const bucket = bucketProperty.value;
  const client = clientProperty.value as S3CompatibleObjectClient;
  const prefix = prefixValue === undefined ? undefined : normalizeStoragePrefix(prefixValue);
  const deleteObject = fileSystemStableMethod(
    client,
    'deleteObject',
    'S3 storage client.deleteObject',
  ) as S3CompatibleObjectClient['deleteObject'];
  const getObject = fileSystemStableMethod(
    client,
    'getObject',
    'S3 storage client.getObject',
  ) as S3CompatibleObjectClient['getObject'];
  const headObject = fileSystemStableMethod(
    client,
    'headObject',
    'S3 storage client.headObject',
  ) as S3CompatibleObjectClient['headObject'];
  const putObject = fileSystemStableMethod(
    client,
    'putObject',
    'S3 storage client.putObject',
  ) as S3CompatibleObjectClient['putObject'];

  return fileSystemFreeze({
    async delete(key) {
      const normalizedKey = normalizeStorageKey(key);
      await fileSystemReflectApply<ReturnType<S3CompatibleObjectClient['deleteObject']>>(
        deleteObject,
        client,
        [{ bucket, key: s3ObjectKey(prefix, normalizedKey) }],
      );
    },
    async get(key) {
      const normalizedKey = normalizeStorageKey(key);
      const output = await fileSystemReflectApply<
        ReturnType<S3CompatibleObjectClient['getObject']>
      >(getObject, client, [{ bucket, key: s3ObjectKey(prefix, normalizedKey) }]);
      if (output === undefined) return undefined;

      const outputBody = s3OutputBody(output);
      const body = await storageBodyToBytes(outputBody);
      return storageReadResult(
        s3ObjectInfo(normalizedKey, output, fileSystemArrayBufferViewByteLength(body)),
        body,
      );
    },
    async put(key, body, putOptions = {}) {
      const normalizedKey = normalizeStorageKey(key);
      const optionsSnapshot = snapshotStoragePutOptions(putOptions);
      // SPEC §6.6/§12: snapshot every accepted carrier through boot-pinned byte controls before
      // handing it to an adapter. The client must never observe bytes different from the body Kovo
      // classified merely because app code replaced ArrayBuffer/stream prototype operations.
      const bytes = await storageBodyToBytes(body);
      const size = fileSystemArrayBufferViewByteLength(bytes);
      const output = await fileSystemReflectApply<
        ReturnType<S3CompatibleObjectClient['putObject']>
      >(putObject, client, [
        {
          bucket,
          key: s3ObjectKey(prefix, normalizedKey),
          body: bytes,
          ...(optionsSnapshot.contentType === undefined
            ? {}
            : { contentType: optionsSnapshot.contentType }),
          // Forward caller etag so a conforming client can persist + echo it (Part 3 bug L2 parity).
          ...(optionsSnapshot.etag === undefined ? {} : { etag: optionsSnapshot.etag }),
          ...(optionsSnapshot.metadata === undefined ? {} : { metadata: optionsSnapshot.metadata }),
        },
      ]);

      // `size` (the materialized body length) is the out-of-band fallback; `s3ObjectInfo` prefers the
      // client's `contentLength`. Caller etag is honored uniformly (Part 3 bug L2).
      return s3ObjectInfo(
        normalizedKey,
        output,
        s3PutFallbackSize(output, size),
        optionsSnapshot.etag,
      );
    },
    async stat(key) {
      const normalizedKey = normalizeStorageKey(key);
      const output = await fileSystemReflectApply<
        ReturnType<S3CompatibleObjectClient['headObject']>
      >(headObject, client, [{ bucket, key: s3ObjectKey(prefix, normalizedKey) }]);
      // No body is materialized on a head, so size is whatever the client reports; never fabricate 0
      // for a content-length-blind client (Part 3 bug L2-storage-3).
      return output === undefined ? undefined : s3ObjectInfo(normalizedKey, output, undefined);
    },
    async stream(key) {
      const normalizedKey = normalizeStorageKey(key);
      const output = await fileSystemReflectApply<
        ReturnType<S3CompatibleObjectClient['getObject']>
      >(getObject, client, [{ bucket, key: s3ObjectKey(prefix, normalizedKey) }]);
      if (output === undefined) return undefined;

      // Streaming does not pre-buffer the body, so size is the client-reported length or unknown
      // (undefined) — never a fabricated 0 (Part 3 bug L2-storage-3).
      return storageReadResult(
        s3ObjectInfo(normalizedKey, output, undefined),
        storageBodyToReadableStream(s3OutputBody(output)),
      );
    },
  });
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

function snapshotStoragePutOptions(options: StoragePutOptions): StoragePutOptions {
  const contentType = fileSystemOwnDataProperty(options, 'contentType', 'Storage put contentType');
  const etag = fileSystemOwnDataProperty(options, 'etag', 'Storage put etag');
  const metadata = fileSystemOwnDataProperty(options, 'metadata', 'Storage put metadata');
  if (
    contentType.found &&
    contentType.value !== undefined &&
    typeof contentType.value !== 'string'
  ) {
    throw new TypeError('Storage put contentType must be an own string data property.');
  }
  if (etag.found && etag.value !== undefined && typeof etag.value !== 'string') {
    throw new TypeError('Storage put etag must be an own string data property.');
  }
  const snapshot = securityNullRecord<unknown>();
  if (contentType.found && contentType.value !== undefined) {
    defineStorageData(snapshot, 'contentType', contentType.value);
  }
  if (etag.found && etag.value !== undefined) defineStorageData(snapshot, 'etag', etag.value);
  if (metadata.found && metadata.value !== undefined) {
    defineStorageData(snapshot, 'metadata', snapshotStorageMetadata(metadata.value));
  }
  return fileSystemFreeze(snapshot) as StoragePutOptions;
}

function snapshotStorageMetadata(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null || securityIsArray(value)) {
    throw new TypeError('Storage metadata must be an object with own string data properties.');
  }
  const snapshot = securityNullRecord<string>();
  const keys = securityObjectKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const keyDescriptor = securityGetOwnPropertyDescriptor(keys, index);
    if (
      keyDescriptor === undefined ||
      !('value' in keyDescriptor) ||
      typeof keyDescriptor.value !== 'string'
    ) {
      throw new TypeError('Storage metadata keys must be dense own strings.');
    }
    const key = keyDescriptor.value;
    const entry = fileSystemOwnDataProperty(value, key, `Storage metadata ${key}`);
    if (!entry.found || typeof entry.value !== 'string') {
      throw new TypeError('Storage metadata values must be own string data properties.');
    }
    defineStorageData(snapshot, key, entry.value);
  }
  return fileSystemFreeze(snapshot);
}

function defineStorageData(target: object, key: PropertyKey, value: unknown): void {
  securityDefineProperty(target, key, {
    configurable: false,
    enumerable: true,
    value,
    writable: false,
  });
  const committed = securityGetOwnPropertyDescriptor(target, key);
  if (committed === undefined || !('value' in committed) || committed.value !== value) {
    throw new TypeError('Storage metadata own-data commit failed.');
  }
}

function snapshotStorageDate(value: unknown, label: string): Date {
  const snapshot = trySnapshotStorageDate(value);
  if (snapshot === undefined) throw new TypeError(`${label} must be a valid Date or date string.`);
  return snapshot;
}

function trySnapshotStorageDate(value: unknown): Date | undefined {
  let time: number;
  if (typeof value === 'string') {
    const parsed = new IntrinsicDate(value);
    time = storageDateGetTime(parsed);
  } else {
    if (!securityHasInstance(IntrinsicDate, value)) return undefined;
    try {
      time = storageDateGetTime(value as Date);
    } catch {
      return undefined;
    }
  }
  return storageIsFiniteNumber(time) ? new IntrinsicDate(time) : undefined;
}

function storageDateGetTime(value: Date): number {
  return securityApply<number>(intrinsicDateGetTime, value, []);
}

function storageDateToISOString(value: Date): string {
  return securityApply<string>(intrinsicDateToISOString, value, []);
}

function storageIsFiniteNumber(value: number): boolean {
  return value === value && value !== Infinity && value !== -Infinity;
}

function storageIsSafeInteger(value: number): boolean {
  return (
    storageIsFiniteNumber(value) &&
    value % 1 === 0 &&
    value >= -9_007_199_254_740_991 &&
    value <= 9_007_199_254_740_991
  );
}

function objectInfo(
  key: string,
  size: number,
  options: StoragePutOptions,
  lastModified: Date,
): StorageObjectInfo {
  const lastModifiedSnapshot = snapshotStorageDate(lastModified, 'Storage lastModified');
  const contentType = storageOptionalOwnData(options, 'contentType', 'Storage put contentType');
  const callerEtag = storageOptionalOwnData(options, 'etag', 'Storage put etag');
  const metadata = storageOptionalOwnData(options, 'metadata', 'Storage put metadata');
  return storageInfoRecord(
    key,
    size,
    contentType as string | undefined,
    callerEtag === undefined
      ? storageEtag(key, size, lastModifiedSnapshot)
      : (callerEtag as string),
    lastModifiedSnapshot,
    metadata as Readonly<Record<string, string>> | undefined,
  );
}

function metadataRecord(info: StorageObjectInfo): FileSystemMetadataRecord {
  const key = storageRequiredOwnData(info, 'key', 'Storage object key');
  const lastModified = storageOptionalOwnData(info, 'lastModified', 'Storage lastModified');
  const record = securityNullRecord<unknown>();
  defineStorageData(
    record,
    'lastModified',
    storageDateToISOString(
      lastModified === undefined
        ? new IntrinsicDate()
        : snapshotStorageDate(lastModified, 'Storage lastModified'),
    ),
  );
  defineStorageData(record, 'logicalKey', key);
  copyOptionalStorageInfoProperty(record, info, 'size');
  copyOptionalStorageInfoProperty(record, info, 'contentType');
  copyOptionalStorageInfoProperty(record, info, 'etag');
  copyOptionalStorageInfoProperty(record, info, 'metadata');
  return record as unknown as FileSystemMetadataRecord;
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

  return storageInfoRecord(
    key,
    fileStats.size,
    storageOptionalOwnData(record, 'contentType', 'Filesystem metadata contentType') as
      | string
      | undefined,
    storageOptionalOwnData(record, 'etag', 'Filesystem metadata etag') as string | undefined,
    snapshotStorageDate(
      storageRequiredOwnData(record, 'lastModified', 'Filesystem metadata lastModified'),
      'Filesystem metadata lastModified',
    ),
    storageOptionalOwnData(record, 'metadata', 'Filesystem metadata custom metadata') as
      | Readonly<Record<string, string>>
      | undefined,
  );
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
  const digest = storageSha256Hex(fileSystemUtf8Encode(key));
  return `${fileSystemObjectPrefix}/${securityStringSlice(digest, 0, 2)}/${securityStringSlice(
    digest,
    2,
  )}`;
}

function storageSha256Hex(value: Uint8Array): string {
  if (!storageHashControlsSound) {
    throw new TypeError(
      'Kovo storage hashing controls are unavailable because realm intrinsics were modified before framework initialization.',
    );
  }
  const hash = createHash('sha256');
  if (securityApply(intrinsicStorageHashUpdate, hash, [value]) !== hash) {
    throw new TypeError('Kovo storage hash update changed digest authority.');
  }
  const digest = securityApply<unknown>(intrinsicStorageHashDigest, hash, ['hex']);
  if (!isLowercaseSha256Hex(digest)) {
    throw new TypeError('Kovo storage hash digest returned an invalid SHA-256 value.');
  }
  return digest;
}

function verifyStorageHashControls(): boolean {
  try {
    const hash = createHash('sha256');
    if (
      securityApply(intrinsicStorageHashUpdate, hash, [fileSystemUtf8Encode('Kovo')]) !== hash
    ) {
      return false;
    }
    return (
      securityApply(intrinsicStorageHashDigest, hash, ['hex']) ===
      '5414b0a8f893b1bcbfbf289673e27af6e63889eb9e764f992f90aa30bb9ee6b2'
    );
  } catch {
    return false;
  }
}

function isLowercaseSha256Hex(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 64) return false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (
      character === undefined ||
      !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f'))
    ) {
      return false;
    }
  }
  return true;
}

async function readFileSystemMetadataRecord(
  fileSystem: ReturnType<typeof createFrameworkOutputFileSystemBoundary>,
  physicalKey: string,
): Promise<FileSystemMetadataRecord | undefined> {
  const bytes = await fileSystem.fileBytes(metadataStorageKey(physicalKey));
  if (bytes === undefined) return undefined;
  try {
    const value: unknown = fileSystemJsonParse(fileSystemUtf8Decode(bytes));
    return parseFileSystemMetadataRecord(value);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function parseFileSystemMetadataRecord(value: unknown): FileSystemMetadataRecord | undefined {
  if (typeof value !== 'object' || value === null || securityIsArray(value)) return undefined;
  const logicalKey = fileSystemOwnDataProperty(
    value,
    'logicalKey',
    'Filesystem metadata logicalKey',
  );
  const lastModified = fileSystemOwnDataProperty(
    value,
    'lastModified',
    'Filesystem metadata lastModified',
  );
  const contentType = fileSystemOwnDataProperty(
    value,
    'contentType',
    'Filesystem metadata contentType',
  );
  const etag = fileSystemOwnDataProperty(value, 'etag', 'Filesystem metadata etag');
  const size = fileSystemOwnDataProperty(value, 'size', 'Filesystem metadata size');
  const metadata = fileSystemOwnDataProperty(
    value,
    'metadata',
    'Filesystem metadata custom metadata',
  );
  if (!logicalKey.found || typeof logicalKey.value !== 'string') return undefined;
  if (!lastModified.found || typeof lastModified.value !== 'string') {
    return undefined;
  }
  if (trySnapshotStorageDate(lastModified.value) === undefined) return undefined;
  if (
    contentType.found &&
    contentType.value !== undefined &&
    typeof contentType.value !== 'string'
  ) {
    return undefined;
  }
  if (etag.found && etag.value !== undefined && typeof etag.value !== 'string') return undefined;
  if (
    size.found &&
    size.value !== undefined &&
    (typeof size.value !== 'number' || !storageIsSafeInteger(size.value) || size.value < 0)
  ) {
    return undefined;
  }
  let metadataSnapshot: Readonly<Record<string, string>> | undefined;
  if (metadata.found && metadata.value !== undefined) {
    try {
      metadataSnapshot = snapshotStorageMetadata(metadata.value);
    } catch (error) {
      if (error instanceof TypeError) return undefined;
      throw error;
    }
  }
  const record = securityNullRecord<unknown>();
  defineStorageData(record, 'logicalKey', logicalKey.value);
  defineStorageData(record, 'lastModified', lastModified.value);
  if (contentType.found && contentType.value !== undefined) {
    defineStorageData(record, 'contentType', contentType.value);
  }
  if (etag.found && etag.value !== undefined) defineStorageData(record, 'etag', etag.value);
  if (size.found && size.value !== undefined) defineStorageData(record, 'size', size.value);
  if (metadataSnapshot !== undefined) defineStorageData(record, 'metadata', metadataSnapshot);
  return fileSystemFreeze(record) as unknown as FileSystemMetadataRecord;
}

async function assertFileSystemStorageSlotOwnership(
  fileSystem: ReturnType<typeof createFrameworkOutputFileSystemBoundary>,
  physicalKey: string,
  logicalKey: string,
): Promise<void> {
  const fileStats = await fileSystem.statFile(physicalKey);
  const sidecarBytes = await fileSystem.fileBytes(metadataStorageKey(physicalKey));
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
  const previous =
    fileSystemMapGet(locks, filePath) ??
    fileSystemCreatePromise<void>((resolve) => resolve(undefined));
  let releaseCurrent: () => void = () => undefined;
  const current = fileSystemCreatePromise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const lock = fileSystemPromiseThen(
    previous,
    () => current,
    () => current,
  );
  fileSystemMapSet(locks, filePath, lock);
  await fileSystemPromiseThen(
    previous,
    () => undefined,
    () => undefined,
  );
  try {
    return await run();
  } finally {
    releaseCurrent();
    if (fileSystemMapGet(locks, filePath) === lock) fileSystemMapDelete(locks, filePath);
  }
}

function storageEtag(key: string, size: number, lastModified: Date): string {
  return `"kovo-${securityEncodeURIComponent(key)}-${size}-${storageDateGetTime(lastModified)}"`;
}

function copyInfo(info: StorageObjectInfo): StorageObjectInfo {
  const key = storageRequiredOwnData(info, 'key', 'Storage object key');
  if (typeof key !== 'string') throw new TypeError('Storage object key must be an own string.');
  const size = storageOptionalOwnData(info, 'size', 'Storage object size');
  const contentType = storageOptionalOwnData(info, 'contentType', 'Storage object contentType');
  const etag = storageOptionalOwnData(info, 'etag', 'Storage object etag');
  const lastModified = storageOptionalOwnData(info, 'lastModified', 'Storage object lastModified');
  const metadata = storageOptionalOwnData(info, 'metadata', 'Storage object metadata');
  return storageInfoRecord(
    key,
    size as number | undefined,
    contentType as string | undefined,
    etag as string | undefined,
    lastModified as Date | undefined,
    metadata as Readonly<Record<string, string>> | undefined,
  );
}

function storageInfoRecord(
  key: string,
  size: number | undefined,
  contentType: string | undefined,
  etag: string | undefined,
  lastModified: Date | string | undefined,
  metadata: Readonly<Record<string, string>> | undefined,
): StorageObjectInfo {
  const record = securityNullRecord<unknown>();
  defineStorageData(record, 'key', key);
  if (size !== undefined) defineStorageData(record, 'size', size);
  if (contentType !== undefined) defineStorageData(record, 'contentType', contentType);
  if (etag !== undefined) defineStorageData(record, 'etag', etag);
  if (lastModified !== undefined) {
    defineStorageData(
      record,
      'lastModified',
      snapshotStorageDate(lastModified, 'Storage lastModified'),
    );
  }
  if (metadata !== undefined) {
    defineStorageData(record, 'metadata', snapshotStorageMetadata(metadata));
  }
  return record as unknown as StorageObjectInfo;
}

function storageReadResult(info: StorageObjectInfo, body: Uint8Array): StorageGetResult;
function storageReadResult(
  info: StorageObjectInfo,
  body: ReadableStream<Uint8Array>,
): StorageStreamResult;
function storageReadResult(
  info: StorageObjectInfo,
  body: Uint8Array | ReadableStream<Uint8Array>,
): StorageGetResult | StorageStreamResult {
  const result = copyInfo(info) as StorageObjectInfo & { body?: unknown };
  defineStorageData(result, 'body', body);
  return result as StorageGetResult | StorageStreamResult;
}

function storageOptionalOwnData(value: object, property: PropertyKey, label: string): unknown {
  const own = fileSystemOwnDataProperty(value, property, label);
  return own.found ? own.value : undefined;
}

function storageRequiredOwnData(value: object, property: PropertyKey, label: string): unknown {
  const own = fileSystemOwnDataProperty(value, property, label);
  if (!own.found) throw new TypeError(`${label} must be an own data property.`);
  return own.value;
}

function copyOptionalStorageInfoProperty(
  target: object,
  info: StorageObjectInfo,
  property: keyof StorageObjectInfo,
): void {
  const own = fileSystemOwnDataProperty(info, property, `Storage object ${property}`);
  if (own.found && own.value !== undefined) defineStorageData(target, property, own.value);
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
    if (part.length > 0) securityArrayAppend(normalizedParts, normalizeStorageKey(part));
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
  const contentLength = storageOptionalOwnData(
    metadata,
    'contentLength',
    'S3 object contentLength',
  );
  const contentType = storageOptionalOwnData(metadata, 'contentType', 'S3 object contentType');
  const serverEtag = storageOptionalOwnData(metadata, 'etag', 'S3 object etag');
  const lastModified = storageOptionalOwnData(metadata, 'lastModified', 'S3 object lastModified');
  const customMetadata = storageOptionalOwnData(metadata, 'metadata', 'S3 object metadata');
  if (
    contentLength !== undefined &&
    (typeof contentLength !== 'number' || !storageIsSafeInteger(contentLength) || contentLength < 0)
  ) {
    throw new TypeError('S3 object contentLength must be a non-negative safe integer.');
  }
  if (contentType !== undefined && typeof contentType !== 'string') {
    throw new TypeError('S3 object contentType must be a string.');
  }
  if (serverEtag !== undefined && typeof serverEtag !== 'string') {
    throw new TypeError('S3 object etag must be a string.');
  }
  if (
    lastModified !== undefined &&
    typeof lastModified !== 'string' &&
    !securityHasInstance(IntrinsicDate, lastModified)
  ) {
    throw new TypeError('S3 object lastModified must be a Date or date string.');
  }
  return storageInfoRecord(
    key,
    (contentLength as number | undefined) ?? fallbackSize,
    contentType as string | undefined,
    callerEtag ?? (serverEtag as string | undefined),
    lastModified as Date | string | undefined,
    customMetadata as Readonly<Record<string, string>> | undefined,
  );
}

function s3OutputBody(output: S3CompatibleGetObjectOutput): StorageBody {
  return storageRequiredOwnData(output, 'body', 'S3 get object body') as StorageBody;
}

function s3PutFallbackSize(output: S3CompatiblePutObjectOutput, bodySize: number): number {
  const size = storageOptionalOwnData(output, 'size', 'S3 put object size');
  if (size === undefined) return bodySize;
  if (typeof size !== 'number' || !storageIsSafeInteger(size) || size < 0) {
    throw new TypeError('S3 put object size must be a non-negative safe integer.');
  }
  return size;
}
