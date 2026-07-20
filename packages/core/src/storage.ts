import { createHash, randomUUID as builtinRandomUuid } from 'node:crypto';

import {
  createFrameworkOutputFileSystemBoundary,
  type FrameworkOutputFileSystemBoundary,
} from './internal/filesystem.js';
import { emitCoreSecurityDecision } from './internal/security-decision.js';
import { restoreScopedKey, scopedKeyFactsFor, type ScopedKey } from './scoped-key.js';
import {
  securityArrayAppend,
  securityApply,
  securityDefineProperty,
  securityEncodeURIComponent,
  securityGetOwnPropertyDescriptor,
  securityHasInstance,
  securityIsArray,
  securityMapForEach,
  securityNullRecord,
  securityObjectKeys,
  securityStringSlice,
  securityWeakMap,
  securityWeakMapGet,
  securityWeakMapSet,
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
  get(key: ScopedKey): Promise<StorageGetResult | undefined>;
  stat(key: ScopedKey): Promise<StorageObjectInfo | undefined>;
  stream(key: ScopedKey): Promise<StorageStreamResult | undefined>;
}

/** Write authority for storing upload bytes by key. */
export interface StoragePutCapability {
  put(key: ScopedKey, body: StorageBody, options?: StoragePutOptions): Promise<StoragePutResult>;
}

/** Write authority for deleting stored objects by key. */
export interface StorageDeleteCapability {
  delete(key: ScopedKey): Promise<void>;
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

/** Input to one bounded S3-compatible list page used by Kovo's erasure absence proof. */
export interface S3CompatibleListObjectsInput {
  bucket: string;
  /** Opaque continuation cursor returned by the preceding page. */
  cursor?: string;
  /** Framework-owned physical key prefix. */
  prefix: string;
}

/** One physical object identity returned by an S3-compatible list operation. */
export interface S3CompatibleListedObject {
  key: string;
}

/** One bounded, dense S3-compatible list page. */
export interface S3CompatibleListObjectsOutput {
  cursor?: string;
  objects: readonly S3CompatibleListedObject[];
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

/**
 * The minimal S3-compatible client an app supplies.
 *
 * `listObjects` is mandatory because SPEC §10.3 principal erasure must re-enumerate every blob
 * sink and fail closed when absence cannot be proved. The listing remains adapter-internal: the
 * returned {@link StorageCapability} does not grant app code ambient bucket-list authority.
 */
export interface S3CompatibleObjectClient {
  deleteObject(input: S3CompatibleDeleteObjectInput): Promise<void>;
  getObject(input: S3CompatibleGetObjectInput): Promise<S3CompatibleGetObjectOutput | undefined>;
  headObject(input: S3CompatibleHeadObjectInput): Promise<S3CompatibleObjectMetadata | undefined>;
  listObjects(input: S3CompatibleListObjectsInput): Promise<S3CompatibleListObjectsOutput>;
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
  generation: string;
  lastModified: string;
  scopedKeyFrame: string;
  metadata?: Readonly<Record<string, string>>;
  size: number;
}

const sidecarSuffix = '.kovo-storage.json';
const fileSystemObjectPrefix = 'kovo-storage-v1';
const s3ScopedKeyFrameMetadata = 'kovo-scoped-key-frame';
const S3_ERASURE_MAX_PAGE_OBJECTS = 1_000;
const S3_ERASURE_MAX_PAGES = 100_000;
const fileSystemObjectLocks = createFileSystemMap<string, Promise<void>>();
const storageRandomUuid = builtinRandomUuid;
const IntrinsicDate = globalThis.Date;
const intrinsicDateGetTime = IntrinsicDate.prototype.getTime;
const intrinsicDateToISOString = IntrinsicDate.prototype.toISOString;

interface StorageKeyIdentity {
  frame: string;
  logicalKey: string;
}

/** @internal Result of deleting one principal's objects from an exact built-in adapter. */
export interface PrincipalStorageErasureResult {
  readonly deleted: number;
  readonly remaining: number;
}

interface PrincipalStorageErasureAuthority {
  enumerate(principal: string): Promise<readonly ScopedKey[]>;
  remove(key: ScopedKey): Promise<void>;
}

const principalStorageErasureAuthorities = securityWeakMap<
  StorageCapability,
  PrincipalStorageErasureAuthority
>();

/**
 * @internal Delete and then independently re-enumerate one principal in a framework-built store.
 * Custom structural adapters are rejected because a type assertion cannot prove listing
 * completeness (SPEC §10.3/C9).
 */
export async function erasePrincipalStorageObjects(
  storage: StorageCapability,
  principal: string,
): Promise<PrincipalStorageErasureResult> {
  const authority = securityWeakMapGet(principalStorageErasureAuthorities, storage);
  if (authority === undefined) {
    throw new TypeError(
      'Principal erasure requires an exact enumerable storage capability returned by Kovo.',
    );
  }
  const matches = await authority.enumerate(principal);
  for (let index = 0; index < matches.length; index += 1) {
    await authority.remove(matches[index]!);
  }
  const remaining = await authority.enumerate(principal);
  return fileSystemFreeze({ deleted: matches.length, remaining: remaining.length });
}

/** @internal Re-enumerate an exact built-in storage adapter for one principal. */
export async function countPrincipalStorageObjects(
  storage: StorageCapability,
  principal: string,
): Promise<number> {
  const authority = securityWeakMapGet(principalStorageErasureAuthorities, storage);
  if (authority === undefined) {
    throw new TypeError(
      'Principal erasure requires an exact enumerable storage capability returned by Kovo.',
    );
  }
  return (await authority.enumerate(principal)).length;
}

function storageKeyIdentity(value: unknown): StorageKeyIdentity {
  let facts: ReturnType<typeof scopedKeyFactsFor>;
  try {
    facts = scopedKeyFactsFor(value);
  } catch (error) {
    emitStorageKeyDecision('deny');
    throw error;
  }
  emitStorageKeyDecision('allow', facts);
  return fileSystemFreeze({
    frame: facts.frame,
    logicalKey: normalizeStorageKey(facts.key),
  });
}

function emitStorageKeyDecision(
  outcome: 'allow' | 'deny',
  facts?: ReturnType<typeof scopedKeyFactsFor>,
): void {
  // @kovo-security-decision storage scoped-key-admission
  emitCoreSecurityDecision({
    decisionSite: 'framework:storage:scoped-key-admission',
    door: 'storage',
    outcome,
    principal:
      facts === undefined
        ? {
            epoch: null,
            id: null,
            kind: 'unresolved',
            reason: 'principal-not-proven',
            tenant: null,
          }
        : facts.posture === 'public'
          ? { epoch: null, id: null, kind: 'anonymous', tenant: null }
          : facts.posture === 'system'
            ? {
                epoch: null,
                id: facts.authority,
                kind: 'system',
                tenant: null,
              }
            : {
                epoch: null,
                id: facts.authority,
                kind: 'unresolved',
                reason: 'epoch-unavailable',
                tenant: null,
              },
    resourceScope: {
      identity:
        facts === undefined
          ? 'global'
          : `sha256:${storageSha256Hex(fileSystemUtf8Encode(facts.frame))}`,
      kind: 'object',
    },
    type: 'security-decision',
  });
}

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

  const capability: StorageCapability = fileSystemFreeze({
    async delete(key) {
      fileSystemMapDelete(objects, storageKeyIdentity(key).frame);
    },
    async get(key) {
      const identity = storageKeyIdentity(key);
      const object = fileSystemMapGet(objects, identity.frame);
      if (object === undefined) return undefined;

      return storageReadResult(copyInfo(object.info), copyBytes(object.body));
    },
    async put(key, body, putOptions = {}) {
      const identity = storageKeyIdentity(key);
      const optionsSnapshot = snapshotStoragePutOptions(putOptions);
      const bytes = await storageBodyToBytes(body);
      const info = objectInfo(
        identity.logicalKey,
        fileSystemArrayBufferViewByteLength(bytes),
        optionsSnapshot,
        readNow(),
      );
      fileSystemMapSet(objects, identity.frame, {
        body: copyBytes(bytes),
        info,
      });
      return copyInfo(info);
    },
    async stat(key) {
      const identity = storageKeyIdentity(key);
      const object = fileSystemMapGet(objects, identity.frame);
      return object === undefined ? undefined : copyInfo(object.info);
    },
    async stream(key) {
      const identity = storageKeyIdentity(key);
      const object = fileSystemMapGet(objects, identity.frame);
      if (object === undefined) return undefined;

      return storageReadResult(copyInfo(object.info), bytesToReadableStream(object.body));
    },
  });
  securityWeakMapSet(principalStorageErasureAuthorities, capability, {
    async enumerate(principal) {
      const matches: ScopedKey[] = [];
      securityMapForEach(objects, (_object, frame) => {
        const key = restoreScopedKey(frame);
        const facts = scopedKeyFactsFor(key);
        if (facts.posture === 'principal' && facts.authority === principal) {
          securityArrayAppend(matches, key);
        }
      });
      return fileSystemFreeze(matches);
    },
    async remove(key) {
      fileSystemMapDelete(objects, storageKeyIdentity(key).frame);
    },
  });
  return capability;
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

  const capability: StorageCapability = fileSystemFreeze({
    async delete(key) {
      const identity = storageKeyIdentity(key);
      const physicalKey = fileSystemStorageKey(identity.frame);
      const filePath = storageFilePath(fileSystem, physicalKey);
      await withFileSystemObjectLock(filePath, async () => {
        const record = await readFileSystemMetadataRecord(fileSystem, physicalKey);
        // SPEC §6.6 object-exact capability binding: deletion is a sink too. A missing, malformed,
        // or differently-owned sidecar cannot authorize removing bytes from an aliased host path.
        if (record?.scopedKeyFrame !== identity.frame) return;
        try {
          // Unpublish the atomic pointer before reclaiming its immutable generation. If the
          // filesystem reports failure after committing this unlink, verification below still
          // reclaims the now-unreachable body instead of permanently orphaning secret bytes.
          await fileSystem.deleteFile(metadataStorageKey(physicalKey));
        } catch (error) {
          let observed: FileSystemMetadataRecord | undefined;
          let observedReadSucceeded = false;
          try {
            observed = await readFileSystemMetadataRecord(fileSystem, physicalKey);
            observedReadSucceeded = true;
          } catch {
            observed = undefined;
          }
          if (
            observedReadSucceeded &&
            (observed?.scopedKeyFrame !== identity.frame ||
              observed.generation !== record.generation)
          ) {
            await reclaimUnpublishedFileSystemGeneration(fileSystem, physicalKey, record);
          }
          throw error;
        }
        const reclamation = await reclaimUnpublishedFileSystemGeneration(
          fileSystem,
          physicalKey,
          record,
        );
        if (reclamation.failed) throw reclamation.error;
      });
    },
    async get(key) {
      const identity = storageKeyIdentity(key);
      const physicalKey = fileSystemStorageKey(identity.frame);
      const filePath = storageFilePath(fileSystem, physicalKey);
      return withFileSystemObjectLock(filePath, async () => {
        const object = await readFileSystemObject(fileSystem, identity, physicalKey);
        return object === undefined
          ? undefined
          : storageReadResult(object.info, copyBytes(object.bytes));
      });
    },
    async put(key, body, putOptions = {}) {
      const identity = storageKeyIdentity(key);
      const physicalKey = fileSystemStorageKey(identity.frame);
      const filePath = storageFilePath(fileSystem, physicalKey);
      const optionsSnapshot = snapshotStoragePutOptions(putOptions);
      const bytes = await storageBodyToBytes(body);
      const lastModified = new IntrinsicDate();
      const info = objectInfo(
        identity.logicalKey,
        fileSystemArrayBufferViewByteLength(bytes),
        optionsSnapshot,
        lastModified,
      );

      await withFileSystemObjectLock(filePath, async () => {
        const previous = await assertFileSystemStorageSlotOwnership(
          fileSystem,
          physicalKey,
          identity.frame,
        );
        // SPEC §12/§13: immutable generation bytes are committed first, then one atomically-renamed
        // sidecar publishes body + metadata together. A crash/failure before the sidecar commit can
        // leave only an unreachable generation, never new bytes authorized by stale metadata.
        const generation = fileSystemStorageGeneration();
        const generationKey = generationStorageKey(physicalKey, generation);
        await fileSystem.writeFile(generationKey, bytes);
        try {
          await fileSystem.writeFile(
            metadataStorageKey(physicalKey),
            fileSystemJsonStringify(metadataRecord(info, generation, identity.frame)),
          );
        } catch (error) {
          // Best-effort orphan cleanup. If the atomic sidecar write did commit before reporting an
          // error, retain the generation so the published pointer never dangles.
          let observed: FileSystemMetadataRecord | undefined;
          let observedReadSucceeded = false;
          try {
            observed = await readFileSystemMetadataRecord(fileSystem, physicalKey);
            observedReadSucceeded = true;
          } catch {
            observed = undefined;
          }
          if (observedReadSucceeded) {
            if (observed?.generation === generation && observed.scopedKeyFrame === identity.frame) {
              // The pointer read proves the supposedly-failed commit published this generation.
              // Retire the previous immutable body just as the normal success path would.
              if (previous !== undefined && previous.generation !== generation) {
                await bestEffortDeleteFile(
                  fileSystem,
                  generationStorageKey(physicalKey, previous.generation),
                );
              }
            } else {
              await bestEffortDeleteFile(fileSystem, generationKey);
            }
          }
          throw error;
        }
        if (previous !== undefined && previous.generation !== generation) {
          await bestEffortDeleteFile(
            fileSystem,
            generationStorageKey(physicalKey, previous.generation),
          );
        }
      });

      return info;
    },
    async stat(key) {
      const identity = storageKeyIdentity(key);
      const physicalKey = fileSystemStorageKey(identity.frame);
      const filePath = storageFilePath(fileSystem, physicalKey);
      return withFileSystemObjectLock(filePath, () =>
        fileSystemStat(fileSystem, identity, physicalKey),
      );
    },
    async stream(key) {
      const identity = storageKeyIdentity(key);
      const physicalKey = fileSystemStorageKey(identity.frame);
      const filePath = storageFilePath(fileSystem, physicalKey);
      return withFileSystemObjectLock(filePath, async () => {
        const object = await readFileSystemObject(fileSystem, identity, physicalKey);
        return object === undefined
          ? undefined
          : storageReadResult(object.info, bytesToReadableStream(object.bytes));
      });
    },
  });
  securityWeakMapSet(principalStorageErasureAuthorities, capability, {
    enumerate: (principal) => enumerateFileSystemPrincipalKeys(fileSystem, principal),
    remove: (key) => capability.delete(key),
  });
  return capability;
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
  const listObjects = fileSystemStableMethod(
    client,
    'listObjects',
    'S3 storage client.listObjects',
  ) as S3CompatibleObjectClient['listObjects'];
  const putObject = fileSystemStableMethod(
    client,
    'putObject',
    'S3 storage client.putObject',
  ) as S3CompatibleObjectClient['putObject'];

  const capability: StorageCapability = fileSystemFreeze({
    async delete(key) {
      const identity = storageKeyIdentity(key);
      await fileSystemReflectApply<ReturnType<S3CompatibleObjectClient['deleteObject']>>(
        deleteObject,
        client,
        [{ bucket, key: s3ObjectKey(prefix, scopedStoragePhysicalKey(identity.frame)) }],
      );
    },
    async get(key) {
      const identity = storageKeyIdentity(key);
      const output = await fileSystemReflectApply<
        ReturnType<S3CompatibleObjectClient['getObject']>
      >(getObject, client, [
        { bucket, key: s3ObjectKey(prefix, scopedStoragePhysicalKey(identity.frame)) },
      ]);
      if (output === undefined) return undefined;

      const outputBody = s3OutputBody(output);
      const body = await storageBodyToBytes(outputBody);
      return storageReadResult(
        s3ObjectInfo(identity.logicalKey, output, fileSystemArrayBufferViewByteLength(body)),
        body,
      );
    },
    async put(key, body, putOptions = {}) {
      const identity = storageKeyIdentity(key);
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
          key: s3ObjectKey(prefix, scopedStoragePhysicalKey(identity.frame)),
          body: bytes,
          ...(optionsSnapshot.contentType === undefined
            ? {}
            : { contentType: optionsSnapshot.contentType }),
          // Forward caller etag so a conforming client can persist + echo it (Part 3 bug L2 parity).
          ...(optionsSnapshot.etag === undefined ? {} : { etag: optionsSnapshot.etag }),
          metadata: s3StorageMetadata(optionsSnapshot.metadata, identity.frame),
        },
      ]);

      // `size` (the materialized body length) is the out-of-band fallback; `s3ObjectInfo` prefers the
      // client's `contentLength`. Caller etag is honored uniformly (Part 3 bug L2).
      return s3ObjectInfo(
        identity.logicalKey,
        output,
        s3PutFallbackSize(output, size),
        optionsSnapshot.etag,
      );
    },
    async stat(key) {
      const identity = storageKeyIdentity(key);
      const output = await fileSystemReflectApply<
        ReturnType<S3CompatibleObjectClient['headObject']>
      >(headObject, client, [
        { bucket, key: s3ObjectKey(prefix, scopedStoragePhysicalKey(identity.frame)) },
      ]);
      // No body is materialized on a head, so size is whatever the client reports; never fabricate 0
      // for a content-length-blind client (Part 3 bug L2-storage-3).
      return output === undefined
        ? undefined
        : s3ObjectInfo(identity.logicalKey, output, undefined);
    },
    async stream(key) {
      const identity = storageKeyIdentity(key);
      const output = await fileSystemReflectApply<
        ReturnType<S3CompatibleObjectClient['getObject']>
      >(getObject, client, [
        { bucket, key: s3ObjectKey(prefix, scopedStoragePhysicalKey(identity.frame)) },
      ]);
      if (output === undefined) return undefined;

      // Streaming does not pre-buffer the body, so size is the client-reported length or unknown
      // (undefined) — never a fabricated 0 (Part 3 bug L2-storage-3).
      return storageReadResult(
        s3ObjectInfo(identity.logicalKey, output, undefined),
        storageBodyToReadableStream(s3OutputBody(output)),
      );
    },
  });
  securityWeakMapSet(principalStorageErasureAuthorities, capability, {
    enumerate: (principal) =>
      enumerateS3PrincipalKeys({
        bucket,
        client,
        headObject,
        listObjects,
        prefix,
        principal,
      }),
    remove: (key) => capability.delete(key),
  });
  return capability;
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
    get(key: ScopedKey) {
      return fileSystemReflectApply<ReturnType<StorageReadCapability['get']>>(get, storage, [key]);
    },
    stat(key: ScopedKey) {
      return fileSystemReflectApply<ReturnType<StorageReadCapability['stat']>>(stat, storage, [
        key,
      ]);
    },
    stream(key: ScopedKey) {
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

function metadataRecord(
  info: StorageObjectInfo,
  generation: string,
  scopedKeyFrame: string,
): FileSystemMetadataRecord {
  storageRequiredOwnData(info, 'key', 'Storage object key');
  const size = storageRequiredOwnData(info, 'size', 'Storage object size');
  if (typeof size !== 'number' || !storageIsSafeInteger(size) || size < 0) {
    throw new TypeError('Filesystem storage object size must be a non-negative safe integer.');
  }
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
  defineStorageData(record, 'generation', generation);
  defineStorageData(record, 'scopedKeyFrame', scopedKeyFrame);
  defineStorageData(record, 'size', size);
  copyOptionalStorageInfoProperty(record, info, 'contentType');
  copyOptionalStorageInfoProperty(record, info, 'etag');
  copyOptionalStorageInfoProperty(record, info, 'metadata');
  return record as unknown as FileSystemMetadataRecord;
}

async function fileSystemStat(
  fileSystem: ReturnType<typeof createFrameworkOutputFileSystemBoundary>,
  identity: StorageKeyIdentity,
  physicalKey = fileSystemStorageKey(identity.frame),
): Promise<StorageObjectInfo | undefined> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const record = await readFileSystemMetadataRecord(fileSystem, physicalKey);
    // The lowercase ASCII physical name is only an index. The exact ScopedKey frame in the atomic
    // sidecar is the authority that closes digest/host aliasing and selects one immutable body.
    if (record?.scopedKeyFrame !== identity.frame) return undefined;
    const fileStats = await fileSystem.statFile(
      generationStorageKey(physicalKey, record.generation),
    );
    if (fileStats !== undefined && record.size === fileStats.size) {
      return fileSystemInfoFromRecord(identity.logicalKey, fileStats.size, record);
    }
    const latest = await readFileSystemMetadataRecord(fileSystem, physicalKey);
    if (latest?.scopedKeyFrame === identity.frame && latest.generation !== record.generation) {
      continue;
    }
    return undefined;
  }
  return undefined;
}

async function readFileSystemObject(
  fileSystem: ReturnType<typeof createFrameworkOutputFileSystemBoundary>,
  identity: StorageKeyIdentity,
  physicalKey: string,
): Promise<{ bytes: Uint8Array; info: StorageObjectInfo } | undefined> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const record = await readFileSystemMetadataRecord(fileSystem, physicalKey);
    if (record?.scopedKeyFrame !== identity.frame) return undefined;
    const bytes = await fileSystem.fileBytes(generationStorageKey(physicalKey, record.generation));
    if (bytes !== undefined) {
      const size = fileSystemArrayBufferViewByteLength(bytes);
      if (record.size !== size) return undefined;
      return { bytes, info: fileSystemInfoFromRecord(identity.logicalKey, size, record) };
    }
    const latest = await readFileSystemMetadataRecord(fileSystem, physicalKey);
    if (latest?.scopedKeyFrame === identity.frame && latest.generation !== record.generation) {
      continue;
    }
    return undefined;
  }
  return undefined;
}

function fileSystemInfoFromRecord(
  key: string,
  size: number,
  record: FileSystemMetadataRecord,
): StorageObjectInfo {
  return storageInfoRecord(
    key,
    size,
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

function scopedStoragePhysicalKey(frame: string): string {
  return `${fileSystemObjectPrefix}/${storageSha256Hex(fileSystemUtf8Encode(frame))}`;
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
    if (securityApply(intrinsicStorageHashUpdate, hash, [fileSystemUtf8Encode('Kovo')]) !== hash) {
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
  const scopedKeyFrame = fileSystemOwnDataProperty(
    value,
    'scopedKeyFrame',
    'Filesystem metadata ScopedKey frame',
  );
  const generation = fileSystemOwnDataProperty(
    value,
    'generation',
    'Filesystem metadata generation',
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
  if (!scopedKeyFrame.found || typeof scopedKeyFrame.value !== 'string') return undefined;
  try {
    scopedKeyFactsFor(restoreScopedKey(scopedKeyFrame.value));
  } catch {
    return undefined;
  }
  if (!generation.found || !isFileSystemStorageGeneration(generation.value)) return undefined;
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
    !size.found ||
    typeof size.value !== 'number' ||
    !storageIsSafeInteger(size.value) ||
    size.value < 0
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
  defineStorageData(record, 'generation', generation.value);
  defineStorageData(record, 'scopedKeyFrame', scopedKeyFrame.value);
  defineStorageData(record, 'lastModified', lastModified.value);
  if (contentType.found && contentType.value !== undefined) {
    defineStorageData(record, 'contentType', contentType.value);
  }
  if (etag.found && etag.value !== undefined) defineStorageData(record, 'etag', etag.value);
  defineStorageData(record, 'size', size.value);
  if (metadataSnapshot !== undefined) defineStorageData(record, 'metadata', metadataSnapshot);
  return fileSystemFreeze(record) as unknown as FileSystemMetadataRecord;
}

interface EnumeratedFileSystemStorageRecord {
  readonly generationPath: string;
  readonly key: ScopedKey;
  readonly sidecarPath: string;
}

async function enumerateFileSystemPrincipalKeys(
  fileSystem: FrameworkOutputFileSystemBoundary,
  principal: string,
): Promise<readonly ScopedKey[]> {
  const records: EnumeratedFileSystemStorageRecord[] = [];
  const generationPaths: string[] = [];
  const shards = await fileSystem.entries(fileSystemObjectPrefix);
  for (let shardIndex = 0; shardIndex < shards.length; shardIndex += 1) {
    const shard = shards[shardIndex]!;
    if (shard.kind !== 'directory' || !isLowercaseHexText(shard.name, 2)) {
      throw new Error(`Filesystem storage erasure cannot classify entry '${shard.relativePath}'.`);
    }
    const entries = await fileSystem.entriesOf(shard);
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex]!;
      if (entry.kind !== 'file') {
        throw new Error(
          `Filesystem storage erasure cannot classify entry '${entry.relativePath}'.`,
        );
      }
      if (fileSystemStringEndsWith(entry.name, sidecarSuffix)) {
        const bytes = await fileSystem.fileBytesOf(entry);
        let parsed: unknown;
        try {
          parsed = fileSystemJsonParse(fileSystemUtf8Decode(bytes));
        } catch (cause) {
          throw new Error(
            `Filesystem storage erasure found malformed metadata '${entry.relativePath}'.`,
            { cause },
          );
        }
        const record = parseFileSystemMetadataRecord(parsed);
        if (record === undefined) {
          throw new Error(
            `Filesystem storage erasure found invalid metadata '${entry.relativePath}'.`,
          );
        }
        const key = restoreScopedKey(record.scopedKeyFrame);
        const expectedPhysicalKey = fileSystemStorageKey(record.scopedKeyFrame);
        if (metadataStorageKey(expectedPhysicalKey) !== entry.relativePath) {
          throw new Error(
            `Filesystem storage erasure found a physical-key ownership mismatch at '${entry.relativePath}'.`,
          );
        }
        securityArrayAppend(records, {
          generationPath: generationStorageKey(expectedPhysicalKey, record.generation),
          key,
          sidecarPath: entry.relativePath,
        });
        continue;
      }
      if (fileSystemStringIncludes(entry.name, '.kovo-generation-')) {
        securityArrayAppend(generationPaths, entry.relativePath);
        continue;
      }
      throw new Error(`Filesystem storage erasure cannot classify entry '${entry.relativePath}'.`);
    }
  }

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (!fileSystemArraySome(generationPaths, (path) => path === record.generationPath)) {
      throw new Error(
        `Filesystem storage erasure found metadata without its immutable generation at '${record.sidecarPath}'.`,
      );
    }
  }
  for (let index = 0; index < generationPaths.length; index += 1) {
    const path = generationPaths[index]!;
    if (!fileSystemArraySome(records, (record) => record.generationPath === path)) {
      throw new Error(
        `Filesystem storage erasure found an unindexed immutable generation at '${path}'.`,
      );
    }
  }

  const matches: ScopedKey[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const key = records[index]!.key;
    const facts = scopedKeyFactsFor(key);
    if (facts.posture === 'principal' && facts.authority === principal) {
      securityArrayAppend(matches, key);
    }
  }
  return fileSystemFreeze(matches);
}

function isLowercaseHexText(value: string, length: number): boolean {
  if (value.length !== length) return false;
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

async function assertFileSystemStorageSlotOwnership(
  fileSystem: ReturnType<typeof createFrameworkOutputFileSystemBoundary>,
  physicalKey: string,
  scopedKeyFrame: string,
): Promise<FileSystemMetadataRecord | undefined> {
  const fileStats = await fileSystem.statFile(physicalKey);
  const sidecarBytes = await fileSystem.fileBytes(metadataStorageKey(physicalKey));
  if (fileStats === undefined && sidecarBytes === undefined) return undefined;

  const record = await readFileSystemMetadataRecord(fileSystem, physicalKey);
  if (record?.scopedKeyFrame === scopedKeyFrame) return record;
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

function generationStorageKey(key: string, generation: string): string {
  return `${key}.kovo-generation-${generation}`;
}

function fileSystemStorageGeneration(): string {
  const generation = storageRandomUuid();
  if (!isFileSystemStorageGeneration(generation)) {
    throw new TypeError('Filesystem storage generation source returned an invalid UUID.');
  }
  return generation;
}

function isFileSystemStorageGeneration(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 36) return false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (index === 8 || index === 13 || index === 18 || index === 23) {
      if (character !== '-') return false;
      continue;
    }
    if (
      character === undefined ||
      !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f'))
    ) {
      return false;
    }
  }
  return true;
}

async function withFileSystemObjectLock<T>(filePath: string, run: () => Promise<T>): Promise<T> {
  const previous =
    fileSystemMapGet(fileSystemObjectLocks, filePath) ??
    fileSystemCreatePromise<void>((resolve) => resolve(undefined));
  let releaseCurrent: () => void = () => undefined;
  const current = fileSystemCreatePromise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  // Keep the queue tail as the private gate itself. Promise-resolution assimilation of a gate
  // returned from a chained callback would dispatch through mutable Promise.prototype.then and
  // could let authored code enter this exact-key critical section before releaseCurrent().
  fileSystemMapSet(fileSystemObjectLocks, filePath, current);
  await fileSystemPromiseThen(
    previous,
    () => undefined,
    () => undefined,
  );
  try {
    return await run();
  } finally {
    releaseCurrent();
    if (fileSystemMapGet(fileSystemObjectLocks, filePath) === current) {
      fileSystemMapDelete(fileSystemObjectLocks, filePath);
    }
  }
}

async function bestEffortDeleteFile(
  fileSystem: ReturnType<typeof createFrameworkOutputFileSystemBoundary>,
  key: string,
): Promise<void> {
  try {
    await fileSystem.deleteFile(key);
  } catch {
    // An unreachable generation is preferable to rolling back an already-published atomic pointer.
  }
}

async function reclaimUnpublishedFileSystemGeneration(
  fileSystem: ReturnType<typeof createFrameworkOutputFileSystemBoundary>,
  physicalKey: string,
  record: FileSystemMetadataRecord,
): Promise<{ failed: false } | { error: unknown; failed: true }> {
  const generationKey = generationStorageKey(physicalKey, record.generation);
  try {
    await fileSystem.deleteFile(generationKey);
    return { failed: false };
  } catch (error) {
    // An unlink may commit before its Promise reports failure. Absence proves reclamation; when
    // bytes may remain, restore the captured pointer if the slot is still empty so a later delete
    // can retry rather than losing the only reference to the generation.
    try {
      if ((await fileSystem.statFile(generationKey)) === undefined) return { failed: false };
    } catch {
      // Preserve the original deletion failure after the best-effort pointer restoration below.
    }
    try {
      const current = await readFileSystemMetadataRecord(fileSystem, physicalKey);
      if (current === undefined) {
        await fileSystem.writeFile(
          metadataStorageKey(physicalKey),
          fileSystemJsonStringify(record),
        );
      }
    } catch {
      // Do not overwrite a pointer whose current ownership cannot be proven absent.
    }
    return { error, failed: true };
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
    s3PublicMetadata(customMetadata),
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

function s3StorageMetadata(
  callerMetadata: Readonly<Record<string, string>> | undefined,
  scopedKeyFrame: string,
): Readonly<Record<string, string>> {
  const snapshot =
    callerMetadata === undefined ? undefined : snapshotStorageMetadata(callerMetadata);
  const output = securityNullRecord<string>();
  if (snapshot !== undefined) {
    const keys = securityObjectKeys(snapshot);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (fileSystemStringToLowerCase(key) === s3ScopedKeyFrameMetadata) {
        throw new TypeError(
          `S3 storage metadata key '${s3ScopedKeyFrameMetadata}' is reserved for principal erasure.`,
        );
      }
      defineStorageData(output, key, storageRequiredOwnData(snapshot, key, 'S3 storage metadata'));
    }
  }
  defineStorageData(output, s3ScopedKeyFrameMetadata, scopedKeyFrame);
  return fileSystemFreeze(output);
}

function s3PublicMetadata(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  const snapshot = snapshotStorageMetadata(value);
  const output = securityNullRecord<string>();
  const keys = securityObjectKeys(snapshot);
  let count = 0;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (fileSystemStringToLowerCase(key) === s3ScopedKeyFrameMetadata) continue;
    defineStorageData(output, key, storageRequiredOwnData(snapshot, key, 'S3 object metadata'));
    count += 1;
  }
  return count === 0 ? undefined : fileSystemFreeze(output);
}

async function enumerateS3PrincipalKeys(options: {
  readonly bucket: string;
  readonly client: S3CompatibleObjectClient;
  readonly headObject: S3CompatibleObjectClient['headObject'];
  readonly listObjects: S3CompatibleObjectClient['listObjects'];
  readonly prefix: string | undefined;
  readonly principal: string;
}): Promise<readonly ScopedKey[]> {
  const physicalPrefix = `${s3ObjectKey(options.prefix, fileSystemObjectPrefix)}/`;
  const seenKeys: string[] = [];
  const seenCursors: string[] = [];
  const matches: ScopedKey[] = [];
  let cursor: string | undefined;
  for (let pageIndex = 0; pageIndex < S3_ERASURE_MAX_PAGES; pageIndex += 1) {
    const output = await fileSystemReflectApply<
      ReturnType<S3CompatibleObjectClient['listObjects']>
    >(options.listObjects, options.client, [
      {
        bucket: options.bucket,
        prefix: physicalPrefix,
        ...(cursor === undefined ? {} : { cursor }),
      },
    ]);
    if (typeof output !== 'object' || output === null || securityIsArray(output)) {
      throw new TypeError('S3 storage listObjects must return an object.');
    }
    const objects = storageRequiredOwnData(output, 'objects', 'S3 storage listObjects output');
    if (!securityIsArray(objects) || objects.length > S3_ERASURE_MAX_PAGE_OBJECTS) {
      throw new TypeError(
        `S3 storage listObjects objects must be a dense array of at most ${S3_ERASURE_MAX_PAGE_OBJECTS} entries.`,
      );
    }
    for (let index = 0; index < objects.length; index += 1) {
      const descriptor = securityGetOwnPropertyDescriptor(objects, index);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new TypeError('S3 storage listObjects objects must be a dense own-data array.');
      }
      const listed = descriptor.value;
      if (typeof listed !== 'object' || listed === null || securityIsArray(listed)) {
        throw new TypeError('S3 storage listObjects entries must be objects.');
      }
      const objectKey = storageRequiredOwnData(listed, 'key', 'S3 listed object');
      if (
        typeof objectKey !== 'string' ||
        !fileSystemStringStartsWith(objectKey, physicalPrefix) ||
        fileSystemArraySome(seenKeys, (seen) => seen === objectKey)
      ) {
        throw new Error('S3 storage listing returned an invalid or duplicate physical key.');
      }
      securityArrayAppend(seenKeys, objectKey);
      const head = await fileSystemReflectApply<ReturnType<S3CompatibleObjectClient['headObject']>>(
        options.headObject,
        options.client,
        [{ bucket: options.bucket, key: objectKey }],
      );
      if (head === undefined) {
        throw new Error(`S3 storage object '${objectKey}' disappeared during erasure enumeration.`);
      }
      const metadata = storageOptionalOwnData(head, 'metadata', 'S3 object metadata');
      if (metadata === undefined) {
        throw new Error(`S3 storage object '${objectKey}' has no reconstructive key metadata.`);
      }
      const metadataSnapshot = snapshotStorageMetadata(metadata);
      const frame = storageOptionalOwnData(
        metadataSnapshot,
        s3ScopedKeyFrameMetadata,
        'S3 object ScopedKey metadata',
      );
      if (typeof frame !== 'string') {
        throw new Error(`S3 storage object '${objectKey}' has no reconstructive key frame.`);
      }
      const key = restoreScopedKey(frame);
      if (s3ObjectKey(options.prefix, scopedStoragePhysicalKey(frame)) !== objectKey) {
        throw new Error(`S3 storage object '${objectKey}' failed physical-key validation.`);
      }
      const facts = scopedKeyFactsFor(key);
      if (facts.posture === 'principal' && facts.authority === options.principal) {
        securityArrayAppend(matches, key);
      }
    }
    const nextCursor = storageOptionalOwnData(output, 'cursor', 'S3 storage listObjects output');
    if (nextCursor === undefined) return fileSystemFreeze(matches);
    if (
      typeof nextCursor !== 'string' ||
      nextCursor.length === 0 ||
      nextCursor.length > 4_096 ||
      nextCursor === cursor ||
      fileSystemArraySome(seenCursors, (seen) => seen === nextCursor)
    ) {
      throw new Error('S3 storage listing returned an invalid or repeated continuation cursor.');
    }
    securityArrayAppend(seenCursors, nextCursor);
    cursor = nextCursor;
  }
  throw new Error('S3 storage listing exceeded the erasure pagination bound.');
}
