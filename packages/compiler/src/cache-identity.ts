import {
  readFileSync as builtinReadFileSync,
  readdirSync as builtinReaddirSync,
  statSync as builtinStatSync,
} from 'node:fs';
import { dirname as builtinDirname, join as builtinJoin, sep } from 'node:path';
import { fileURLToPath as builtinFileUrlToPath } from 'node:url';

import { canonicalJson } from './canonical-json.js';
import {
  compilerArrayAppend,
  compilerArrayLength,
  compilerJsonParse,
  compilerOwnDataValue,
  compilerRandomUuid,
  compilerSha256Hex,
  compilerStatsIsDirectory,
  compilerStatsIsFile,
  compilerStringEndsWith,
  compilerStringSlice,
  compilerStringStartsWith,
} from './compiler-security-intrinsics.js';

const readFileSync = builtinReadFileSync;
const readdirSync = builtinReaddirSync;
const statSync = builtinStatSync;
const dirname = builtinDirname;
const join = builtinJoin;
const fileURLToPath = builtinFileUrlToPath;

const compilerBuildIdVersion = 'compiler-build-id/v2';
const compilerBuildCacheIdentityVersion = 'compiler-build-cache-identity/v2';
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
function resolveCompilerPackageIdentity(): {
  manifestDir: string;
  moduleDir: string;
  name: string;
  resolved: boolean;
  version: string;
} {
  const initialDir = dirname(fileURLToPath(import.meta.url));
  let dir = initialDir;
  // Walk up to the filesystem root looking for our own package manifest.
  for (;;) {
    const packageManifest = readCompilerPackageManifest(join(dir, 'package.json'));
    if (packageManifest) {
      return {
        manifestDir: dir,
        moduleDir: initialDir,
        name: packageManifest.name,
        resolved: true,
        version: packageManifest.version,
      };
    }

    const workspaceManifestDir = join(dir, 'packages/compiler');
    const workspaceManifest = readCompilerPackageManifest(
      join(workspaceManifestDir, 'package.json'),
    );
    if (workspaceManifest) {
      return {
        manifestDir: workspaceManifestDir,
        moduleDir: initialDir,
        name: workspaceManifest.name,
        resolved: true,
        version: workspaceManifest.version,
      };
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Defensive fallback: identity is unknown rather than silently a wrong literal, but the
  // cache still moves with the current bundle/source directory when possible.
  return {
    manifestDir: initialDir,
    moduleDir: initialDir,
    name: compilerPackageName,
    resolved: false,
    version: '0.0.0-unresolved',
  };
}

function readCompilerPackageManifest(
  manifestPath: string,
): { name: typeof compilerPackageName; version: string } | null {
  try {
    const parsed = compilerJsonParse(readFileSync(manifestPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const name = compilerOwnDataValue(parsed, 'name', 'Compiler package manifest');
    const version = compilerOwnDataValue(parsed, 'version', 'Compiler package manifest');
    if (name === compilerPackageName && typeof version === 'string') {
      return { name, version };
    }
  } catch {
    // Not a readable/parseable compiler manifest.
  }
  return null;
}

function isWithinPath(child: string, parent: string): boolean {
  return (
    child === parent ||
    compilerStringStartsWith(
      child,
      compilerStringEndsWith(parent, sep) ? parent : `${parent}${sep}`,
    )
  );
}

const compilerPackageIdentity = resolveCompilerPackageIdentity();
const compilerPackageVersion = compilerPackageIdentity.version;

/**
 * Exact implementation identity used to AUTHORIZE cache hits. Digests are locators/display only:
 * source-mode execution records every byte below `src`, packaged execution every byte below
 * `dist`, plus the exact package manifest. If discovery is incomplete, a process-unique identity
 * deliberately disables cross-process reuse instead of falling back to version-only stale hits.
 */
function resolveCompilerBuildCacheIdentity(): string {
  try {
    if (!compilerPackageIdentity.resolved) throw new Error('Compiler package root is unresolved.');
    const sourceRoot = join(compilerPackageIdentity.manifestDir, 'src');
    const distRoot = join(compilerPackageIdentity.manifestDir, 'dist');
    const implementationRoot = isWithinPath(compilerPackageIdentity.moduleDir, sourceRoot)
      ? sourceRoot
      : isWithinPath(compilerPackageIdentity.moduleDir, distRoot)
        ? distRoot
        : compilerPackageIdentity.moduleDir;
    const implementationFiles: Array<{ path: string; sourceBase64: string }> = [];
    collectImplementationFiles(implementationRoot, implementationRoot, implementationFiles);
    if (implementationFiles.length === 0) throw new Error('Compiler implementation is empty.');
    return canonicalJson({
      implementationFiles,
      packageManifestSource: readFileSync(
        join(compilerPackageIdentity.manifestDir, 'package.json'),
        'utf8',
      ),
      packageName: compilerPackageName,
      packageVersion: compilerPackageVersion,
      version: compilerBuildCacheIdentityVersion,
    });
  } catch {
    return canonicalJson({
      processIdentity: compilerRandomUuid(),
      version: `${compilerBuildCacheIdentityVersion}/process-only`,
    });
  }
}

function collectImplementationFiles(
  rootDir: string,
  dir: string,
  files: Array<{ path: string; sourceBase64: string }>,
): void {
  const names = readdirSync(dir);
  sortStrings(names);
  const length = compilerArrayLength(names, 'Compiler implementation directory entries');
  for (let index = 0; index < length; index += 1) {
    const name = compilerOwnDataValue(names, index, 'Compiler implementation directory entries');
    if (typeof name !== 'string') {
      throw new TypeError('Compiler implementation entry names must be strings.');
    }
    const absolute = join(dir, name);
    const stats = statSync(absolute);
    if (compilerStatsIsDirectory(stats)) {
      collectImplementationFiles(rootDir, absolute, files);
    } else if (compilerStatsIsFile(stats)) {
      const relative = compilerStringSlice(absolute, rootDir.length + 1);
      compilerArrayAppend(
        files,
        {
          path: relative,
          sourceBase64: readFileSync(absolute, 'base64'),
        },
        'Compiler packages/compiler/src/cache-identity.ts collection',
      );
    }
  }
}

function sortStrings(values: string[]): void {
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index]!;
    let insertAt = index;
    while (insertAt > 0 && value < values[insertAt - 1]!) {
      values[insertAt] = values[insertAt - 1]!;
      insertAt -= 1;
    }
    values[insertAt] = value;
  }
}

const resolvedCompilerBuildCacheIdentity = resolveCompilerBuildCacheIdentity();

/** @internal Full canonical implementation preimage used for exact cache-hit authorization. */
export function compilerBuildCacheIdentity(): string {
  return resolvedCompilerBuildCacheIdentity;
}

/** @internal Input that contributes to the incremental compiler cache namespace. */
export interface CompilerBuildIdInput {
  /**
   * Optional content fingerprints for compiler source/dist files or pinned dependencies.
   * Callers should pass stable path -> digest pairs; ordering is canonicalized here.
   */
  readonly sourceFingerprints?: Readonly<Record<string, string>>;
}

function computeCompilerBuildId(sourceFingerprints: Readonly<Record<string, string>>): string {
  const payload = {
    compilerBuildCacheIdentity: resolvedCompilerBuildCacheIdentity,
    packageName: compilerPackageName,
    packageVersion: compilerPackageVersion,
    sourceFingerprints,
    version: compilerBuildIdVersion,
  };
  return `${compilerPackageName}@${compilerPackageVersion}/${sha256(canonicalJson(payload))}`;
}

function sha256(value: string): string {
  return compilerSha256Hex(value);
}

// The exact implementation preimage is resolved once at module bootstrap and cannot change during
// this process. Re-serializing and hashing that multi-megabyte preimage for every cache lookup made
// a confirmed warm hit scale with compiler source size rather than with the changed app file.
const defaultCompilerBuildId = computeCompilerBuildId({});

/**
 * @internal Stable compiler/dependency identity for incremental cache keys.
 *
 * SPEC.md §5.2 keeps emitted artifacts deterministic; the incremental cache must
 * also be versioned so a compiler implementation change becomes a clean miss. This compact token
 * is for display/path names; cache correctness compares {@link compilerBuildCacheIdentity} exactly.
 */
export function compilerBuildId(input: CompilerBuildIdInput = {}): string {
  return input.sourceFingerprints === undefined
    ? defaultCompilerBuildId
    : computeCompilerBuildId(input.sourceFingerprints);
}
