import { isKovoRuntimeMetadataCollectionFacade } from './runtime-security-intrinsics.js';

/** @internal Server-side provenance check for Drizzle runtime-metadata collection facades. */
export function isKovoRuntimeMetadataCollection(value: unknown): value is object {
  return isKovoRuntimeMetadataCollectionFacade(value);
}
