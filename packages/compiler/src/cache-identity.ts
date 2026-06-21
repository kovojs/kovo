import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from './canonical-json.js';

const compilerBuildIdVersion = 'compiler-build-id/v1';
const compilerPackageName = '@kovojs/compiler';

/**
 * @internal Resolve this compiler's own identity (name + version) from its
 * package.json at module load.
 *
 * B1 (plans/bug-and-testing-part3.md): the version MUST NOT be a hardcoded
 * literal. A literal lets the persistent incremental cache (§5.2.1 / §5.2)
 * survive a compiler upgrade and serve stale emitted modules from a previous
 * implementation. Deriving from the real package.json makes any version bump a
 * guaranteed cache miss. Resolution is ESM-safe: it walks up from this module's
 * own URL to the nearest `@kovojs/compiler` package.json, so it works both from
 * `src/*.ts` (vitest) and from the bundled `dist/*.mjs` artifact.
 */
function resolveCompilerPackageIdentity(): { name: string; version: string; manifestDir: string } {
  let dir = dirname(fileURLToPath(import.meta.url));
  // Walk up to the filesystem root looking for our own package manifest.
  for (;;) {
    const manifestPath = join(dir, 'package.json');
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        name?: unknown;
        version?: unknown;
      };
      if (parsed.name === compilerPackageName && typeof parsed.version === 'string') {
        return { manifestDir: dir, name: parsed.name, version: parsed.version };
      }
    } catch {
      // Not a readable/parseable manifest here; keep climbing.
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Defensive fallback: identity is unknown rather than silently a wrong literal.
  return { manifestDir: dir, name: compilerPackageName, version: '0.0.0-unresolved' };
}

const { version: compilerPackageVersion, manifestDir } = resolveCompilerPackageIdentity();

/**
 * @internal Best-effort content hash of the emitted compiler `dist`, computed
 * once at module load.
 *
 * Folding the dist contents (not just the package.json version) makes the cache
 * namespace move even for an unpublished local rebuild whose version string did
 * not change (B1). It is best-effort: when no `dist` directory exists (dev/test
 * running from `src`), this contributes nothing, and the package.json version
 * alone still guarantees an upgrade is a clean miss. Hashing a sorted manifest
 * of `(relPath, size, mtimeMs)` keeps it cheap and deterministic for a fixed
 * dist tree without reading every byte.
 */
function resolveDistContentHash(): string | undefined {
  const distDir = join(manifestDir, 'dist');
  try {
    const lines: string[] = [];
    collectDistManifest(distDir, distDir, lines);
    if (lines.length === 0) return undefined;
    lines.sort();
    return sha256(lines.join('\n')).slice(0, 16);
  } catch {
    return undefined;
  }
}

function collectDistManifest(rootDir: string, dir: string, lines: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const absolute = join(dir, name);
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      collectDistManifest(rootDir, absolute, lines);
    } else if (stats.isFile()) {
      const relative = absolute.slice(rootDir.length + 1);
      lines.push(`${relative}:${stats.size}:${Math.trunc(stats.mtimeMs)}`);
    }
  }
}

const compilerDistContentHash = resolveDistContentHash();

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
 * to filesystem layout. The package version (and a best-effort dist content
 * hash) are derived at module load (B1), so an upgraded compiler is guaranteed
 * to produce a different build id.
 */
export function compilerBuildId(input: CompilerBuildIdInput = {}): string {
  const payload = {
    distContentHash: compilerDistContentHash ?? null,
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
