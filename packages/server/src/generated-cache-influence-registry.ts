import {
  snapshotCacheInfluenceManifest,
  type CacheInfluenceManifest,
  type CacheInfluenceManifestEntry,
} from '@kovojs/core/internal/cache-influence';

import { buildSecuritySourceLiteral } from './build-security-intrinsics.js';
import { witnessGetOwnPropertyDescriptor } from './security-witness-intrinsics.js';

let registeredManifest: CacheInfluenceManifest | undefined;
let registeredLiteral: string | undefined;
let registeredPermanent = false;

/** Register the compiler-owned cache manifest before authored modules evaluate. @internal */
export function registerGeneratedCacheInfluenceManifest(
  manifest: CacheInfluenceManifest,
): CacheInfluenceManifest {
  const snapshot = snapshotCacheInfluenceManifest(manifest);
  const literal = buildSecuritySourceLiteral(snapshot);
  if (registeredManifest !== undefined) {
    if (literal !== registeredLiteral) {
      throw new TypeError(
        'Generated cache-influence manifest is already registered for this boot.',
      );
    }
    registeredPermanent = true;
    return snapshot;
  }
  registeredManifest = snapshot;
  registeredLiteral = literal;
  registeredPermanent = true;
  return snapshot;
}

/** Install compiler facts for one command/test lifetime while preserving first-registration wins. */
export function installGeneratedCacheInfluenceManifestForCommand(
  manifest: CacheInfluenceManifest,
): () => void {
  const snapshot = snapshotCacheInfluenceManifest(manifest);
  const literal = buildSecuritySourceLiteral(snapshot);
  if (registeredManifest !== undefined) {
    if (literal !== registeredLiteral) {
      throw new TypeError(
        'Generated cache-influence manifest is already registered for this boot.',
      );
    }
    return () => {};
  }
  registeredManifest = snapshot;
  registeredLiteral = literal;
  registeredPermanent = false;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    if (!registeredPermanent && registeredManifest === snapshot && registeredLiteral === literal) {
      registeredManifest = undefined;
      registeredLiteral = undefined;
    }
  };
}

/** Exact compiler verdict for one query/endpoint root, or undefined when no proof was registered. */
export function registeredCacheInfluenceForRoot(
  root: string,
): CacheInfluenceManifestEntry | undefined {
  const entries = registeredManifest?.entries;
  if (entries === undefined) return undefined;
  for (let index = 0; index < entries.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(entries, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Generated cache-influence entries must remain dense own data.');
    }
    if (descriptor.value.root === root) return descriptor.value;
  }
  return undefined;
}
