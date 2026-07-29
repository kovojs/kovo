/**
 * Object-storage capabilities and concrete app adapters (SPEC §10.3).
 *
 * Framework erasure inspection and adapter implementation records stay behind
 * `@kovojs/core/internal/storage`.
 */
import {
  createS3CompatibleStorage as createStorageFromImplementation,
  type S3CompatibleObjectClient as S3CompatibleObjectClientImplementation,
  type StorageBody,
  type StorageCapability,
  type StorageGetResult,
  type StorageObjectInfo,
  type StoragePutOptions,
  type StoragePutResult,
  type StorageStreamResult,
} from './storage.js';
import {
  freezeSecurityValue,
  securityArrayAppend,
  securityGetOwnPropertyDescriptor,
  securityHasInstance,
  securityIsArray,
  securityOwnArrayEntry,
  securityWeakMap,
  securityWeakMapGet,
  securityWeakMapSet,
} from './internal/security-witness-intrinsics.js';

export { createFileSystemStorage, createMemoryStorage } from './storage.js';
export type {
  FileSystemStorageOptions,
  MemoryStorageOptions,
  StorageBody,
  StorageCapability,
  StorageDeleteCapability,
  StorageGetResult,
  StorageObjectInfo,
  StoragePutCapability,
  StoragePutOptions,
  StoragePutResult,
  StorageReadCapability,
  StorageStreamResult,
} from './storage.js';

/**
 * Provider-local operations used to construct an opaque {@link S3CompatibleObjectClient}.
 *
 * The shape speaks only Kovo's stable storage vocabulary; AWS/R2/MinIO request and response
 * records remain inside the adapter module.
 */
export type S3CompatibleObjectOperations = {
  delete(bucket: string, key: string): Promise<void>;
  get(bucket: string, key: string): Promise<StorageGetResult | StorageStreamResult | undefined>;
  list(
    bucket: string,
    prefix: string,
    cursor?: string,
  ): Promise<{ cursor?: string; keys: readonly string[] }>;
  put(
    bucket: string,
    key: string,
    body: StorageBody,
    options?: StoragePutOptions,
  ): Promise<StoragePutResult>;
  stat(bucket: string, key: string): Promise<StorageObjectInfo | undefined>;
};

const s3CompatibleClientConstructorToken = freezeSecurityValue({
  kind: 'kovo-s3-compatible-client-constructor',
});
const s3CompatibleClientImplementations = securityWeakMap<
  S3CompatibleObjectClient,
  S3CompatibleObjectClientImplementation
>();
const maximumS3CompatibleListKeys = 1_000;

/**
 * Opaque, runtime-validated adapter for an S3-compatible object service.
 *
 * App adapters translate their SDK into Kovo's stable storage records once.
 * Raw SDK request/response and inspection records never become recursively
 * public through the retained client (SPEC §6.6 and §10.3).
 */
export class S3CompatibleObjectClient {
  private constructor(token: typeof s3CompatibleClientConstructorToken) {
    if (token !== s3CompatibleClientConstructorToken) {
      throw new TypeError(
        'S3CompatibleObjectClient must be created by S3CompatibleObjectClient.create().',
      );
    }
    freezeSecurityValue(this);
  }

  /**
   * Validate and snapshot the five operations Kovo needs from an object SDK.
   *
   * The operation methods use positional bucket/key arguments and Kovo storage
   * results, so provider-specific request and metadata carriers stay local.
   */
  static create(operations: S3CompatibleObjectOperations): S3CompatibleObjectClient {
    if (typeof operations !== 'object' || operations === null || securityIsArray(operations)) {
      throw new TypeError('S3-compatible operations must be an object.');
    }
    const snapshot: S3CompatibleObjectOperations = freezeSecurityValue({
      delete: stableOperation(operations, 'delete'),
      get: stableOperation(operations, 'get'),
      list: stableOperation(operations, 'list'),
      put: stableOperation(operations, 'put'),
      stat: stableOperation(operations, 'stat'),
    });
    const client = new S3CompatibleObjectClient(s3CompatibleClientConstructorToken);
    securityWeakMapSet(s3CompatibleClientImplementations, client, implementationClient(snapshot));
    return client;
  }
}

/** App wiring for one S3-compatible bucket and optional physical-key prefix. */
export interface S3CompatibleStorageOptions {
  bucket: string;
  client: S3CompatibleObjectClient;
  prefix?: string;
}

/**
 * Adapt one validated S3-compatible client to Kovo's scoped storage capability.
 */
export function createS3CompatibleStorage(options: S3CompatibleStorageOptions): StorageCapability {
  const client = ownOption(options, 'client');
  if (!securityHasInstance(S3CompatibleObjectClient, client)) {
    throw new TypeError('S3 storage client must be created by S3CompatibleObjectClient.create().');
  }
  const validatedClient = client as S3CompatibleObjectClient;
  const implementation = securityWeakMapGet(s3CompatibleClientImplementations, validatedClient);
  if (implementation === undefined) {
    throw new TypeError(
      'S3 storage client must come from this installed copy of @kovojs/core/storage.',
    );
  }
  const bucket = ownOption(options, 'bucket');
  const prefix = ownOptionalOption(options, 'prefix');
  return createStorageFromImplementation({
    bucket: typeof bucket === 'string' ? bucket : invalidString('S3 storage bucket'),
    client: implementation,
    ...(prefix === undefined
      ? {}
      : { prefix: typeof prefix === 'string' ? prefix : invalidString('S3 storage prefix') }),
  });
}

function implementationClient(
  operations: S3CompatibleObjectOperations,
): S3CompatibleObjectClientImplementation {
  const implementation: S3CompatibleObjectClientImplementation = {
    async deleteObject({ bucket, key }) {
      await operations.delete(bucket, key);
    },
    async getObject({ bucket, key }) {
      const result = await operations.get(bucket, key);
      return result === undefined ? undefined : toImplementationOutput(result);
    },
    async headObject({ bucket, key }) {
      const result = await operations.stat(bucket, key);
      return result === undefined ? undefined : toImplementationMetadata(result);
    },
    async listObjects({ bucket, cursor, prefix }) {
      const result = await operations.list(bucket, prefix, cursor);
      const resultKeys = requiredOwnData<readonly string[]>(
        result,
        'keys',
        'S3-compatible list result',
      );
      const resultCursor = optionalOwnData<string>(result, 'cursor', 'S3-compatible list result');
      if (!securityIsArray(resultKeys)) {
        throw new TypeError('S3-compatible list result keys must be a dense own-data array.');
      }
      const length = ownArrayLength(resultKeys, 'S3-compatible list result keys');
      if (length > maximumS3CompatibleListKeys) {
        throw new TypeError(
          `S3-compatible list result keys must contain at most ${maximumS3CompatibleListKeys} entries.`,
        );
      }
      const objects: { key: string }[] = [];
      for (let index = 0; index < length; index += 1) {
        const entry = securityOwnArrayEntry(resultKeys, index);
        if (!entry.ok || typeof entry.value !== 'string') {
          throw new TypeError(
            'S3-compatible list result keys must be a dense own-data array of strings.',
          );
        }
        securityArrayAppend(objects, freezeSecurityValue({ key: entry.value }));
      }
      return {
        ...(resultCursor === undefined ? {} : { cursor: resultCursor }),
        objects: freezeSecurityValue(objects),
      };
    },
    async putObject({ body, bucket, contentType, etag, key, metadata }) {
      const result = await operations.put(bucket, key, body, {
        ...(contentType === undefined ? {} : { contentType }),
        ...(etag === undefined ? {} : { etag }),
        ...(metadata === undefined ? {} : { metadata }),
      });
      const size = optionalOwnData<number>(result, 'size', 'S3-compatible put result');
      return {
        ...toImplementationMetadata(result),
        ...(size === undefined ? {} : { size }),
      };
    },
  };
  return freezeSecurityValue(implementation);
}

function toImplementationOutput(result: StorageGetResult | StorageStreamResult) {
  return {
    body: requiredOwnData<StorageBody>(result, 'body', 'S3-compatible get result'),
    ...toImplementationMetadata(result),
  };
}

function toImplementationMetadata(info: StorageObjectInfo) {
  const size = optionalOwnData<number>(info, 'size', 'S3-compatible object metadata');
  const contentType = optionalOwnData<string>(info, 'contentType', 'S3-compatible object metadata');
  const etag = optionalOwnData<string>(info, 'etag', 'S3-compatible object metadata');
  const lastModified = optionalOwnData<Date>(info, 'lastModified', 'S3-compatible object metadata');
  const metadata = optionalOwnData<Readonly<Record<string, string>>>(
    info,
    'metadata',
    'S3-compatible object metadata',
  );
  return {
    ...(size === undefined ? {} : { contentLength: size }),
    ...(contentType === undefined ? {} : { contentType }),
    ...(etag === undefined ? {} : { etag }),
    ...(lastModified === undefined ? {} : { lastModified }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function stableOperation<Key extends keyof S3CompatibleObjectOperations>(
  operations: S3CompatibleObjectOperations,
  key: Key,
): S3CompatibleObjectOperations[Key] {
  const first = securityGetOwnPropertyDescriptor(operations, key);
  const second = securityGetOwnPropertyDescriptor(operations, key);
  if (
    first === undefined ||
    second === undefined ||
    !('value' in first) ||
    !('value' in second) ||
    first.value !== second.value ||
    typeof first.value !== 'function'
  ) {
    throw new TypeError(`S3-compatible operation ${key} must be a stable own method.`);
  }
  return first.value as S3CompatibleObjectOperations[Key];
}

function ownOption(options: S3CompatibleStorageOptions, key: 'bucket' | 'client'): unknown {
  if (typeof options !== 'object' || options === null || securityIsArray(options)) {
    throw new TypeError('S3 storage options must be an object.');
  }
  const descriptor = securityGetOwnPropertyDescriptor(options, key);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`S3 storage ${key} must be an own data property.`);
  }
  return descriptor.value;
}

function ownOptionalOption(options: S3CompatibleStorageOptions, key: 'prefix'): unknown {
  const descriptor = securityGetOwnPropertyDescriptor(options, key);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw new TypeError(`S3 storage ${key} must be an own data property when provided.`);
  }
  return descriptor.value;
}

function invalidString(label: string): never {
  throw new TypeError(`${label} must be a string.`);
}

function requiredOwnData<Value>(value: unknown, key: PropertyKey, label: string): Value {
  if (typeof value !== 'object' || value === null || securityIsArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const descriptor = securityGetOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`${label}.${String(key)} must be an own data property.`);
  }
  return descriptor.value as Value;
}

function optionalOwnData<Value>(
  value: unknown,
  key: PropertyKey,
  label: string,
): Value | undefined {
  if (typeof value !== 'object' || value === null || securityIsArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const descriptor = securityGetOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw new TypeError(`${label}.${String(key)} must be an own data property when provided.`);
  }
  return descriptor.value as Value;
}

function ownArrayLength(values: readonly unknown[], label: string): number {
  const descriptor = securityGetOwnPropertyDescriptor(values, 'length');
  const length = descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
  if (typeof length !== 'number' || length % 1 !== 0 || length < 0) {
    throw new TypeError(`${label} must have a stable non-negative integer length.`);
  }
  return length;
}
