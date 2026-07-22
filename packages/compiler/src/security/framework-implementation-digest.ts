const sourceDigestPattern = /^kovo-source-tree-sha256:[a-f0-9]{64}$/u;
const packedDigestPattern = /^kovo-packed-tree-sha256:[a-f0-9]{64}$/u;

/** Validate one externally observed framework implementation identity. @internal */
export function canonicalFrameworkImplementationDigest(digest: string): string | undefined {
  if (sourceDigestPattern.test(digest) || packedDigestPattern.test(digest)) return digest;
  return undefined;
}

/** Exact fail-closed installed/reviewed implementation comparison (SPEC §6.6; C13). */
export function frameworkImplementationDigestMatches(
  reviewedDigests: readonly string[],
  installedDigest: string | undefined,
): boolean {
  return installedDigest !== undefined && reviewedDigests.includes(installedDigest);
}
