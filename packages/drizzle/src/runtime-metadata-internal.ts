import { isKovoRuntimeMetadataCollectionFacade } from './runtime-security-intrinsics.js';

export { extractCompilerBoundKovoRuntimeDbMetadata } from './runtime-metadata.js';
export type {
  KovoRuntimeTableSecurityManifestAuthzPolicy,
  KovoRuntimeTableSecurityManifest,
  KovoRuntimeTableSecurityManifestColumn,
  KovoRuntimeTableSecurityManifestOwner,
  KovoRuntimeTableSecurityManifestOwnerVia,
  KovoRuntimeTableSecurityManifestTable,
} from './runtime-metadata.js';

/** @internal Server-side provenance check for Drizzle runtime-metadata collection facades. */
export function isKovoRuntimeMetadataCollection(value: unknown): value is object {
  return isKovoRuntimeMetadataCollectionFacade(value);
}
