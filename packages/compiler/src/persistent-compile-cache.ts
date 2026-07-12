import {
  mkdir as builtinMkdir,
  readFile as builtinReadFile,
  readdir as builtinReaddir,
  rename as builtinRename,
  writeFile as builtinWriteFile,
} from 'node:fs/promises';
import { dirname as builtinDirname, join as builtinJoin } from 'node:path';

import { canonicalJson } from './canonical-json.js';
import { compilerBuildCacheIdentity } from './cache-identity.js';
import {
  compilerArrayIsArray,
  compilerCreateMap,
  compilerHmacSha256Hex,
  compilerJsonParse,
  compilerMapGet,
  compilerMapSet,
  compilerObjectKeys,
  compilerOwnDataValue,
  compilerRandomUuid,
  compilerSecureStringEqual,
  compilerSha256Hex,
  compilerStringCharCodeAt,
  compilerStringEndsWith,
  compilerStringSlice,
} from './compiler-security-intrinsics.js';
import {
  compileCacheKey,
  narrowCompileCacheKeyInput,
  type CompileCacheKeyInput,
} from './compile-cache.js';
import type { CompileDependencyFootprint } from './types.js';

const mkdir = builtinMkdir;
const readFile = builtinReadFile;
const readdir = builtinReaddir;
const rename = builtinRename;
const writeFile = builtinWriteFile;
const dirname = builtinDirname;
const join = builtinJoin;

const persistentCompileCacheFormat = 'kovo-compile-cache/v4';
const persistentCompilerBuildIdentityRef = `builds/${compilerRandomUuid()}.json`;
const persistentCompileCacheMacKey = compilerRandomUuid();

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
    const parsed = compilerJsonParse(await readFile(manifestPath(cacheDir), 'utf8'));
    return isPersistentCompileCacheManifest(parsed)
      ? parsed
      : emptyPersistentCompileCacheManifest();
  } catch {
    return emptyPersistentCompileCacheManifest();
  }
}

async function readEntryFiles(cacheDir: string): Promise<PersistentCompileCacheEntry[]> {
  let fileNames: string[];
  try {
    fileNames = await readdir(join(cacheDir, 'entries'));
  } catch {
    return [];
  }

  const entries: PersistentCompileCacheEntry[] = [];
  for (let index = 0; index < fileNames.length; index += 1) {
    const fileName = fileNames[index]!;
    if (!compilerStringEndsWith(fileName, '.json')) continue;
    try {
      const parsed = compilerJsonParse(await readFile(join(cacheDir, 'entries', fileName), 'utf8'));
      if (isPersistentCompileCacheEntry(parsed)) entries[entries.length] = parsed;
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
    const resultJson = await readFile(join(cacheDir, resultRef), 'utf8');
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
    const storedIdentity = await readFile(join(cacheDir, entry.compilerBuildIdentityRef), 'utf8');
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
): Promise<PersistentCompileCacheEntry> {
  await mkdir(join(cacheDir, 'blobs'), { recursive: true });
  const resultJson = canonicalJson(entry.result);
  const resultRef = `blobs/${sha256(resultJson)}.json`;
  await atomicWriteFile(join(cacheDir, resultRef), resultJson);
  const compilerBuildIdentity = compilerBuildCacheIdentity();
  await atomicWriteFile(join(cacheDir, persistentCompilerBuildIdentityRef), compilerBuildIdentity);

  const unsignedEntry = {
    artifactRefs: { result: resultRef },
    cacheKey: entry.cacheKey,
    compilerBuildIdentityRef: persistentCompilerBuildIdentityRef,
    footprint: entry.footprint,
    resultPreimage: resultJson,
    updatedAtMs: Date.now(),
  };
  const manifestEntry: PersistentCompileCacheEntry = {
    ...unsignedEntry,
    integrity: compilerHmacSha256Hex(persistentCompileCacheMacKey, canonicalJson(unsignedEntry)),
  };
  await atomicWriteFile(entryPath(cacheDir, entry.cacheKey), `${canonicalJson(manifestEntry)}\n`);
  // Entry files are authoritative. Keep the compatibility manifest compact instead of duplicating
  // every exact compiler/source/result preimage into one ever-growing JSON object. Readers merge
  // the per-entry records, preserving parallel writes without quadratic manifest growth.
  await atomicWriteFile(
    manifestPath(cacheDir),
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

async function atomicWriteFile(fileName: string, source: string): Promise<void> {
  await mkdir(dirname(fileName), { recursive: true });
  const tempFileName = `${fileName}.${process.pid}.${compilerRandomUuid()}.tmp`;
  await writeFile(tempFileName, source);
  await rename(tempFileName, fileName);
}

function manifestPath(cacheDir: string): string {
  return join(cacheDir, 'manifest.json');
}

function entryPath(cacheDir: string, cacheKey: string): string {
  return join(cacheDir, 'entries', `${sha256(cacheKey)}.json`);
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
