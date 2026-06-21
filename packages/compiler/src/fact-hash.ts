import { canonicalJson } from './canonical-json.js';

/** @internal Stable structural fact hash shared by HMR and incremental cache invalidation. */
export function factHash(value: unknown): string {
  return fnv1a(canonicalJson(value));
}

function fnv1a(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}
