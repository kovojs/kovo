import { join as builtinJoin } from 'node:path';

import { canonicalJson } from './canonical-json.js';
import { compilerBuildCacheIdentity } from './cache-identity.js';
import { compileComponentModule } from './compile.js';
import { snapshotCompileComponentOptions } from './compile-options.js';
import {
  compilerArrayAppend,
  compilerArrayIsArray,
  compilerCreateMap,
  compilerCreateWeakMap,
  compilerHmacSha256Hex,
  compilerJsonParse,
  compilerMapGet,
  compilerMapSet,
  compilerNowMs,
  compilerObjectKeys,
  compilerOwnDataValue,
  compilerRandomUuid,
  compilerSecureStringEqual,
  compilerSha256Hex,
  compilerSnapshotDenseArray,
  compilerStringCharCodeAt,
  compilerStringEndsWith,
  compilerStringSlice,
  compilerUtf8Text,
  compilerWeakMapGet,
  compilerWeakMapSet,
} from './compiler-security-intrinsics.js';
import {
  compileCacheKey,
  compileComponentCacheKeyInput,
  narrowCompileCacheKeyInput,
  type CompileCacheKeyInput,
} from './compile-cache.js';
import type {
  CompileComponentOptions,
  CompileDependencyFootprint,
  CompileResult,
} from './types.js';

const join = builtinJoin;

const persistentCompileCacheFormat = 'kovo-compile-cache/v4';
const persistentCompilerBuildIdentityRef = `builds/${compilerRandomUuid()}.json`;
const persistentCompileCacheMacKey = compilerRandomUuid();

interface CompilerProducedCacheAuthority {
  readonly exactCacheKey: string;
  readonly footprintCacheKey?: string;
  readonly footprintPreimage: string;
  readonly resultPreimage: string;
}

// This authority and the signer live in one already-evaluated module. Never delegate the decision
// through a late dynamic import: authored config can install a Node resolution hook and substitute
// the imported verifier after this module has captured its HMAC key (SPEC.md §2 / §5.2.1).
const compilerProducedCacheAuthorities = compilerCreateWeakMap<
  CompileResult,
  CompilerProducedCacheAuthority
>();

/** @internal Compile and bind an exact result/options preimage for the cache signer. */
export function compileComponentModuleForPersistentCache(
  rawOptions: CompileComponentOptions,
): CompileResult {
  const options = snapshotCompileComponentOptions(rawOptions);
  const result = compileComponentModule(options);
  const exactCacheKey = compileCacheKey(compileComponentCacheKeyInput(options));
  const footprint = result.dependencyFootprint;
  compilerWeakMapSet(compilerProducedCacheAuthorities, result, {
    exactCacheKey,
    ...(footprint === undefined
      ? {}
      : {
          footprintCacheKey: compileCacheKey(compileComponentCacheKeyInput(options, footprint)),
        }),
    footprintPreimage: canonicalJson(footprint),
    resultPreimage: canonicalJson(result),
  });
  return result;
}

function compilerProducedResultAuthorizesPersistentCacheEntry(
  result: unknown,
  cacheKey: unknown,
  footprint: unknown,
): boolean {
  if (typeof result !== 'object' || result === null || typeof cacheKey !== 'string') return false;
  const authority = compilerWeakMapGet(compilerProducedCacheAuthorities, result as CompileResult);
  if (
    authority === undefined ||
    (cacheKey !== authority.exactCacheKey && cacheKey !== authority.footprintCacheKey)
  ) {
    return false;
  }
  try {
    return (
      canonicalJson(footprint) === authority.footprintPreimage &&
      canonicalJson(result) === authority.resultPreimage
    );
  } catch {
    return false;
  }
}

/** @internal On-disk manifest entry for one content-addressed compile result. */
export interface PersistentCompileCacheEntry {
  artifactRefs: {
    result: string;
  };
  cacheKey: string;
  compilerBuildIdentityRef: string;
  footprint: CompileDependencyFootprint;
  integrity: string;
  resultPreimage: string;
  updatedAtMs: number;
}

/** @internal Versioned manifest stored under `.kovo/cache/compiler/manifest.json`. */
export interface PersistentCompileCacheManifest {
  entries: Record<string, PersistentCompileCacheEntry>;
  version: typeof persistentCompileCacheFormat;
}

/** @internal Default compiler cache directory below an app/build root. */
export function persistentCompileCacheDir(root: string): string {
  return join(root, '.kovo/cache/compiler');
}

/** @internal Corruption-tolerant manifest load: bad or partial JSON is a cache miss. */
export async function readPersistentCompileCacheManifest(
  cacheDir: string,
): Promise<PersistentCompileCacheManifest> {
  const manifest = await readManifestFile(cacheDir);
  const entryFiles = await readEntryFiles(cacheDir);
  for (let index = 0; index < entryFiles.length; index += 1) {
    const entry = entryFiles[index]!;
    manifest.entries[entry.cacheKey] = entry;
  }
  return manifest;
}

async function readManifestFile(cacheDir: string): Promise<PersistentCompileCacheManifest> {
  try {
    const source = await readPersistentCacheText(cacheDir, 'manifest.json');
    if (source === undefined) return emptyPersistentCompileCacheManifest();
    const parsed = compilerJsonParse(source);
    return isPersistentCompileCacheManifest(parsed)
      ? parsed
      : emptyPersistentCompileCacheManifest();
  } catch {
    return emptyPersistentCompileCacheManifest();
  }
}

async function readEntryFiles(cacheDir: string): Promise<PersistentCompileCacheEntry[]> {
  const fileSystem = await persistentCacheFileSystem(cacheDir);
  let fileEntries;
  try {
    fileEntries = compilerSnapshotDenseArray(
      await fileSystem.entries('entries'),
      'Persistent compiler cache entry files',
    );
  } catch {
    return [];
  }

  const entries: PersistentCompileCacheEntry[] = [];
  for (let index = 0; index < fileEntries.length; index += 1) {
    const fileEntry = fileEntries[index]!;
    if (fileEntry.kind !== 'file' || !compilerStringEndsWith(fileEntry.name, '.json')) continue;
    try {
      const source = compilerUtf8Text(await fileSystem.fileBytesOf(fileEntry));
      const parsed = compilerJsonParse(source);
      if (isPersistentCompileCacheEntry(parsed))
        compilerArrayAppend(
          entries,
          parsed,
          'Compiler packages/compiler/src/persistent-compile-cache.ts collection',
        );
    } catch {
      // A malformed entry is an untrusted cache miss.
    }
  }
  return entries;
}

/** @internal Read one cached result blob, returning null on miss, stale compiler id, or corruption. */
export async function readPersistentCompileCacheEntry<Result>(
  cacheDir: string,
  cacheKey: string,
): Promise<Result | null> {
  const manifest = await readPersistentCompileCacheManifest(cacheDir);
  const entry = ownManifestEntry(manifest, cacheKey);
  if (
    !entry ||
    !persistentCompileCacheEntryIntegrityIsValid(entry) ||
    !(await entryMatchesCurrentCompilerBuild(cacheDir, entry))
  ) {
    return null;
  }

  return readPersistentCompileCacheEntryResult(cacheDir, entry);
}

/**
 * @internal Read by exact key first, then replay stored dependency footprints against current
 * inputs so unrelated fact changes do not defeat cache reuse across process restarts.
 */
export async function readPersistentCompileCacheEntryForInput<Result>(
  cacheDir: string,
  input: CompileCacheKeyInput,
): Promise<Result | null> {
  const manifest = await readPersistentCompileCacheManifest(cacheDir);
  const compilerMatches = compilerCreateMap<string, boolean>();
  const exactKey = compileCacheKey(input);
  const exactEntry = ownManifestEntry(manifest, exactKey);
  if (
    exactEntry &&
    persistentCompileCacheEntryIntegrityIsValid(exactEntry) &&
    (await entryMatchesCurrentCompilerBuild(cacheDir, exactEntry, compilerMatches))
  ) {
    const exactResult = await readPersistentCompileCacheEntryResult<Result>(cacheDir, exactEntry);
    if (exactResult !== null) return exactResult;
  }

  const entryKeys = compilerObjectKeys(manifest.entries);
  for (let index = 0; index < entryKeys.length; index += 1) {
    const entry = ownManifestEntry(manifest, entryKeys[index]!);
    if (entry === undefined) continue;
    if (!persistentCompileCacheEntryIntegrityIsValid(entry)) continue;
    if (entry.cacheKey === exactKey) continue;
    if (!(await entryMatchesCurrentCompilerBuild(cacheDir, entry, compilerMatches))) continue;
    const narrowedKey = compileCacheKey(narrowCompileCacheKeyInput(input, entry.footprint));
    if (narrowedKey !== entry.cacheKey) continue;
    const result = await readPersistentCompileCacheEntryResult<Result>(cacheDir, entry);
    if (result !== null) return result;
  }

  return null;
}

async function readPersistentCompileCacheEntryResult<Result>(
  cacheDir: string,
  entry: PersistentCompileCacheEntry,
): Promise<Result | null> {
  try {
    const resultRef = entry.artifactRefs.result;
    if (persistentCompileCacheBlobDigest(resultRef) === null) return null;
    const resultJson = await readPersistentCacheText(cacheDir, resultRef);
    if (resultJson === undefined) return null;
    // The digest only locates a blob. Exact bytes authorize reuse, so a digest collision can evict
    // or overwrite an entry (cache miss) but cannot cross-bind another compile result.
    if (resultJson !== entry.resultPreimage) return null;
    return compilerJsonParse(resultJson) as Result;
  } catch {
    return null;
  }
}

async function entryMatchesCurrentCompilerBuild(
  cacheDir: string,
  entry: PersistentCompileCacheEntry,
  cached?: Map<string, boolean>,
): Promise<boolean> {
  try {
    if (!persistentCompilerBuildIdentityRefIsSafe(entry.compilerBuildIdentityRef)) return false;
    const previous = cached ? compilerMapGet(cached, entry.compilerBuildIdentityRef) : undefined;
    if (previous !== undefined) return previous;
    const storedIdentity = await readPersistentCacheText(cacheDir, entry.compilerBuildIdentityRef);
    if (storedIdentity === undefined) return false;
    // The UUID is only a bounded path locator. Exact implementation bytes authorize reuse, so no
    // digest collision or selectively wrapped hash primitive can cross-bind compiler versions.
    const matches = storedIdentity === compilerBuildCacheIdentity();
    if (cached) compilerMapSet(cached, entry.compilerBuildIdentityRef, matches);
    return matches;
  } catch {
    return false;
  }
}

function persistentCompilerBuildIdentityRefIsSafe(ref: string): boolean {
  const prefix = 'builds/';
  const suffix = '.json';
  if (ref.length !== prefix.length + 36 + suffix.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (compilerStringCharCodeAt(ref, index) !== compilerStringCharCodeAt(prefix, index)) {
      return false;
    }
  }
  const uuidStart = prefix.length;
  for (let index = 0; index < 36; index += 1) {
    const code = compilerStringCharCodeAt(ref, uuidStart + index);
    if (index === 8 || index === 13 || index === 18 || index === 23) {
      if (code !== 0x2d) return false;
    } else if (!((code >= 0x30 && code <= 0x39) || (code >= 0x61 && code <= 0x66))) {
      return false;
    }
  }
  const suffixStart = uuidStart + 36;
  for (let index = 0; index < suffix.length; index += 1) {
    if (
      compilerStringCharCodeAt(ref, suffixStart + index) !== compilerStringCharCodeAt(suffix, index)
    ) {
      return false;
    }
  }
  return true;
}

/** @internal Atomically write/update one manifest entry and its content-addressed result blob. */
export async function writePersistentCompileCacheEntry(
  cacheDir: string,
  entry: {
    cacheKey: string;
    footprint: CompileDependencyFootprint;
    result: unknown;
  },
): Promise<PersistentCompileCacheEntry | null> {
  // SPEC.md §2 / §5.2.1: config/app code can reach this process and may even locate private
  // distribution chunks. Only the exact result identity, bytes, footprint, and cache key bound by
  // the real compiler in this module are eligible for signing. Injected/test compilers remain
  // in-memory, and no late resolver-controlled import participates in this decision.
  const cacheKey = compilerOwnDataValue(entry, 'cacheKey', 'Persistent compiler cache write');
  const footprint = compilerOwnDataValue(entry, 'footprint', 'Persistent compiler cache write');
  const result = compilerOwnDataValue(entry, 'result', 'Persistent compiler cache write');
  if (!compilerProducedResultAuthorizesPersistentCacheEntry(result, cacheKey, footprint)) {
    return null;
  }
  // Capture every signed byte before the next await. An authored caller can retain and mutate the
  // result object while filesystem setup yields; persistence must use the exact preimages just
  // validated against the compiler's WeakMap authority, never re-read caller-owned carriers.
  const resultJson = canonicalJson(result);
  const persistentFootprint = compilerJsonParse(
    canonicalJson(footprint),
  ) as CompileDependencyFootprint;
  if (typeof cacheKey !== 'string') return null;
  const fileSystem = await persistentCacheFileSystem(cacheDir);
  await fileSystem.ensureDirectory();
  const resultRef = `blobs/${sha256(resultJson)}.json`;
  await fileSystem.writeFile(resultRef, resultJson);
  const compilerBuildIdentity = compilerBuildCacheIdentity();
  await fileSystem.writeFile(persistentCompilerBuildIdentityRef, compilerBuildIdentity);

  const unsignedEntry = {
    artifactRefs: { result: resultRef },
    cacheKey,
    compilerBuildIdentityRef: persistentCompilerBuildIdentityRef,
    footprint: persistentFootprint,
    resultPreimage: resultJson,
    updatedAtMs: compilerNowMs(),
  };
  const manifestEntry: PersistentCompileCacheEntry = {
    ...unsignedEntry,
    integrity: compilerHmacSha256Hex(persistentCompileCacheMacKey, canonicalJson(unsignedEntry)),
  };
  await fileSystem.writeFile(
    `entries/${sha256(cacheKey)}.json`,
    `${canonicalJson(manifestEntry)}\n`,
  );
  // Entry files are authoritative. Keep the compatibility manifest compact instead of duplicating
  // every exact compiler/source/result preimage into one ever-growing JSON object. Readers merge
  // the per-entry records, preserving parallel writes without quadratic manifest growth.
  await fileSystem.writeFile(
    'manifest.json',
    `${canonicalJson(emptyPersistentCompileCacheManifest())}\n`,
  );
  return manifestEntry;
}

function emptyPersistentCompileCacheManifest(): PersistentCompileCacheManifest {
  return { entries: {}, version: persistentCompileCacheFormat };
}

function isPersistentCompileCacheManifest(value: unknown): value is PersistentCompileCacheManifest {
  if (!value || typeof value !== 'object') return false;
  const version = compilerOwnDataValue(value, 'version', 'Persistent compile-cache manifest');
  const entries = compilerOwnDataValue(value, 'entries', 'Persistent compile-cache manifest');
  return (
    version === persistentCompileCacheFormat &&
    entries !== null &&
    typeof entries === 'object' &&
    !compilerArrayIsArray(entries)
  );
}

function isPersistentCompileCacheEntry(value: unknown): value is PersistentCompileCacheEntry {
  if (!value || typeof value !== 'object') return false;
  const artifactRefs = compilerOwnDataValue(value, 'artifactRefs', 'Persistent cache entry');
  const cacheKey = compilerOwnDataValue(value, 'cacheKey', 'Persistent cache entry');
  const buildIdentityRef = compilerOwnDataValue(
    value,
    'compilerBuildIdentityRef',
    'Persistent cache entry',
  );
  const footprint = compilerOwnDataValue(value, 'footprint', 'Persistent cache entry');
  const integrity = compilerOwnDataValue(value, 'integrity', 'Persistent cache entry');
  const resultPreimage = compilerOwnDataValue(value, 'resultPreimage', 'Persistent cache entry');
  const updatedAtMs = compilerOwnDataValue(value, 'updatedAtMs', 'Persistent cache entry');
  return (
    typeof cacheKey === 'string' &&
    typeof buildIdentityRef === 'string' &&
    typeof resultPreimage === 'string' &&
    typeof integrity === 'string' &&
    typeof updatedAtMs === 'number' &&
    artifactRefs !== null &&
    typeof artifactRefs === 'object' &&
    typeof compilerOwnDataValue(artifactRefs, 'result', 'Persistent cache artifact refs') ===
      'string' &&
    footprint !== null &&
    typeof footprint === 'object'
  );
}

function persistentCompileCacheEntryIntegrityIsValid(entry: PersistentCompileCacheEntry): boolean {
  const unsignedEntry = {
    artifactRefs: entry.artifactRefs,
    cacheKey: entry.cacheKey,
    compilerBuildIdentityRef: entry.compilerBuildIdentityRef,
    footprint: entry.footprint,
    resultPreimage: entry.resultPreimage,
    updatedAtMs: entry.updatedAtMs,
  };
  const expected = compilerHmacSha256Hex(
    persistentCompileCacheMacKey,
    canonicalJson(unsignedEntry),
  );
  return compilerSecureStringEqual(entry.integrity, expected);
}

function persistentCompileCacheBlobDigest(ref: string): string | null {
  if (ref.length !== 75) return null;
  const prefix = 'blobs/';
  const suffix = '.json';
  for (let index = 0; index < prefix.length; index += 1) {
    if (compilerStringCharCodeAt(ref, index) !== compilerStringCharCodeAt(prefix, index))
      return null;
  }
  for (let index = 0; index < suffix.length; index += 1) {
    if (
      compilerStringCharCodeAt(ref, ref.length - suffix.length + index) !==
      compilerStringCharCodeAt(suffix, index)
    ) {
      return null;
    }
  }
  const digest = compilerStringSlice(ref, prefix.length, prefix.length + 64);
  for (let index = 0; index < digest.length; index += 1) {
    const code = compilerStringCharCodeAt(digest, index);
    if (!((code >= 0x30 && code <= 0x39) || (code >= 0x61 && code <= 0x66))) return null;
  }
  return digest;
}

async function readPersistentCacheText(
  cacheDir: string,
  relativePath: string,
): Promise<string | undefined> {
  const bytes = await (await persistentCacheFileSystem(cacheDir)).fileBytes(relativePath);
  return bytes === undefined ? undefined : compilerUtf8Text(bytes);
}

async function persistentCacheFileSystem(cacheDir: string) {
  const { createFrameworkOutputFileSystemBoundary } =
    await import('@kovojs/core/internal/filesystem');
  return createFrameworkOutputFileSystemBoundary(cacheDir);
}

function sha256(source: string): string {
  return compilerSha256Hex(source);
}

function ownManifestEntry(
  manifest: PersistentCompileCacheManifest,
  cacheKey: string,
): PersistentCompileCacheEntry | undefined {
  const entry = compilerOwnDataValue(
    manifest.entries,
    cacheKey,
    'Persistent compile-cache manifest entries',
  );
  return isPersistentCompileCacheEntry(entry) && entry.cacheKey === cacheKey ? entry : undefined;
}
