export type {
  FileSystemStorageOptions,
  MemoryStorageOptions,
  S3CompatibleDeleteObjectInput,
  S3CompatibleGetObjectInput,
  S3CompatibleGetObjectOutput,
  S3CompatibleHeadObjectInput,
  S3CompatibleListedObject,
  S3CompatibleListObjectsInput,
  S3CompatibleListObjectsOutput,
  S3CompatibleObjectClient,
  S3CompatibleObjectMetadata,
  S3CompatiblePutObjectInput,
  S3CompatiblePutObjectOutput,
  S3CompatibleStorageOptions,
  StorageDeleteCapability,
  StoragePutCapability,
  StorageReadCapability,
  PrincipalStorageErasureResult,
} from '../storage.js';
export type { FrameworkScopedKeyPosture, ScopedKey, ScopedKeyFacts } from '../scoped-key.js';
export {
  createReadOnlyStorageCapability,
  countPrincipalStorageObjects,
  createFileSystemStorage,
  createMemoryStorage,
  createS3CompatibleStorage,
  erasePrincipalStorageObjects,
  normalizeStorageKey,
  storageBodyToBytes,
} from '../storage.js';
export {
  frameworkScopedKey,
  isScopedKey,
  principalScopedKey,
  restoreScopedKey,
  scopedKeyFactsFor,
  scopedKeysEqual,
} from '../scoped-key.js';
