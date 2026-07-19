const sourceDigestPattern = /^kovo-source-tree-sha256:[a-f0-9]{64}$/u;
const packedDigestPattern = /^kovo-packed-tree-sha256:[a-f0-9]{64}$/u;
const compilerSelfSourceDigestPattern = /^kovo-compiler-self-source-tree-sha256:[a-f0-9]{64}$/u;
const compilerSelfPackedDigestPattern = /^kovo-compiler-self-packed-tree-sha256:[a-f0-9]{64}$/u;
const compilerSelfSourcePrefix = 'kovo-compiler-self-source-tree-sha256:';
const compilerSelfPackedPrefix = 'kovo-compiler-self-packed-tree-sha256:';
const sourcePrefix = 'kovo-source-tree-sha256:';
const packedPrefix = 'kovo-packed-tree-sha256:';

/**
 * Validate and canonicalize one compiler-owned framework implementation identity.
 * The self marker is accepted only for the compiler package's generated packed-catalog entry.
 * @internal
 */
export function canonicalFrameworkImplementationDigest(
  packageName: string,
  digest: string,
): string | undefined {
  if (sourceDigestPattern.test(digest) || packedDigestPattern.test(digest)) return digest;
  if (packageName === '@kovojs/compiler') {
    if (compilerSelfSourceDigestPattern.test(digest)) {
      return `${sourcePrefix}${digest.slice(compilerSelfSourcePrefix.length)}`;
    }
    if (compilerSelfPackedDigestPattern.test(digest)) {
      return `${packedPrefix}${digest.slice(compilerSelfPackedPrefix.length)}`;
    }
  }
  return undefined;
}

/** Exact fail-closed installed/reviewed implementation comparison (SPEC §6.6; C13). */
export function frameworkImplementationDigestMatches(
  reviewedDigests: readonly string[],
  installedDigest: string | undefined,
): boolean {
  return installedDigest !== undefined && reviewedDigests.includes(installedDigest);
}
