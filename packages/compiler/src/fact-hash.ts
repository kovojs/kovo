import { canonicalJson } from './canonical-json.js';
import { compilerSha256Hex } from './compiler-security-intrinsics.js';

/** @internal Stable structural fact hash shared by HMR and compiler fact identities. */
export function factHash(value: unknown): string {
  // SPEC.md §5.2.1: graph/HMR identities are collision-resistant and consume the exact
  // canonical preimage through the compiler's bootstrap-pinned crypto control.
  return compilerSha256Hex(canonicalJson(value));
}
