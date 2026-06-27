import { deriveRegistryIdentity } from './registry-identities.js';

/** @internal Source-derived mutation key for `export const name = mutation({ ... })`. */
export function deriveMutationKey(fileName: string, localName: string): string {
  return deriveRegistryIdentity(fileName, localName).key;
}
