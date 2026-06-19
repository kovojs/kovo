import { createHash } from 'node:crypto';

const compilerBuildIdVersion = 'compiler-build-id/v1';
const compilerPackageName = '@kovojs/compiler';
const compilerPackageVersion = '0.1.0';

/** @internal Input that contributes to the incremental compiler cache namespace. */
export interface CompilerBuildIdInput {
  /**
   * Optional content fingerprints for compiler source/dist files or pinned dependencies.
   * Callers should pass stable path -> digest pairs; ordering is canonicalized here.
   */
  readonly sourceFingerprints?: Readonly<Record<string, string>>;
}

/**
 * @internal Stable compiler/dependency identity for incremental cache keys.
 *
 * SPEC.md §5.2 keeps emitted artifacts deterministic; the incremental cache must
 * also be versioned so a compiler implementation change becomes a clean miss,
 * never a stale hit. This helper defines that namespace without tying the cache
 * to filesystem layout.
 */
export function compilerBuildId(input: CompilerBuildIdInput = {}): string {
  const payload = {
    packageName: compilerPackageName,
    packageVersion: compilerPackageVersion,
    sourceFingerprints: input.sourceFingerprints ?? {},
    version: compilerBuildIdVersion,
  };
  return `${compilerPackageName}@${compilerPackageVersion}/${sha256(canonicalJson(payload)).slice(0, 16)}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}
