import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { canonicalJson } from './canonical-json.js';
import { compilerBuildId } from './cache-identity.js';
import type { CompileDependencyFootprint } from './types.js';

const persistentCompileCacheFormat = 'kovo-compile-cache/v1';

/** @internal On-disk manifest entry for one content-addressed compile result. */
export interface PersistentCompileCacheEntry {
  artifactRefs: {
    result: string;
  };
  cacheKey: string;
  compilerBuildId: string;
  footprint: CompileDependencyFootprint;
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
  for (const entry of await readEntryFiles(cacheDir)) manifest.entries[entry.cacheKey] = entry;
  return manifest;
}

async function readManifestFile(cacheDir: string): Promise<PersistentCompileCacheManifest> {
  try {
    const parsed = JSON.parse(await readFile(manifestPath(cacheDir), 'utf8')) as unknown;
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

  const entries = await Promise.all(
    fileNames
      .filter((fileName) => fileName.endsWith('.json'))
      .map(async (fileName) => {
        try {
          const parsed = JSON.parse(
            await readFile(join(cacheDir, 'entries', fileName), 'utf8'),
          ) as unknown;
          return isPersistentCompileCacheEntry(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }),
  );
  return entries.filter((entry): entry is PersistentCompileCacheEntry => entry !== null);
}

/** @internal Read one cached result blob, returning null on miss, stale compiler id, or corruption. */
export async function readPersistentCompileCacheEntry<Result>(
  cacheDir: string,
  cacheKey: string,
): Promise<Result | null> {
  const manifest = await readPersistentCompileCacheManifest(cacheDir);
  const entry = manifest.entries[cacheKey];
  if (!entry || entry.compilerBuildId !== compilerBuildId()) return null;

  try {
    const resultRef = entry.artifactRefs.result;
    const digest = persistentCompileCacheBlobDigest(resultRef);
    if (digest === null) return null;
    const resultJson = await readFile(join(cacheDir, resultRef), 'utf8');
    if (sha256(resultJson) !== digest) return null;
    return JSON.parse(resultJson) as Result;
  } catch {
    return null;
  }
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

  const manifest = await readPersistentCompileCacheManifest(cacheDir);
  const manifestEntry: PersistentCompileCacheEntry = {
    artifactRefs: { result: resultRef },
    cacheKey: entry.cacheKey,
    compilerBuildId: compilerBuildId(),
    footprint: entry.footprint,
    updatedAtMs: Date.now(),
  };
  await atomicWriteFile(entryPath(cacheDir, entry.cacheKey), `${canonicalJson(manifestEntry)}\n`);
  manifest.entries[entry.cacheKey] = manifestEntry;
  await atomicWriteFile(manifestPath(cacheDir), `${canonicalJson(manifest)}\n`);
  return manifestEntry;
}

function emptyPersistentCompileCacheManifest(): PersistentCompileCacheManifest {
  return { entries: {}, version: persistentCompileCacheFormat };
}

function isPersistentCompileCacheManifest(value: unknown): value is PersistentCompileCacheManifest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as PersistentCompileCacheManifest;
  if (candidate.version !== persistentCompileCacheFormat) return false;
  return Boolean(candidate.entries && typeof candidate.entries === 'object');
}

function isPersistentCompileCacheEntry(value: unknown): value is PersistentCompileCacheEntry {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as PersistentCompileCacheEntry;
  return (
    typeof candidate.cacheKey === 'string' &&
    typeof candidate.compilerBuildId === 'string' &&
    typeof candidate.updatedAtMs === 'number' &&
    Boolean(candidate.artifactRefs && typeof candidate.artifactRefs.result === 'string') &&
    Boolean(candidate.footprint && typeof candidate.footprint === 'object')
  );
}

function persistentCompileCacheBlobDigest(ref: string): string | null {
  const match = /^blobs\/([0-9a-f]{64})\.json$/.exec(ref);
  return match?.[1] ?? null;
}

async function atomicWriteFile(fileName: string, source: string): Promise<void> {
  await mkdir(dirname(fileName), { recursive: true });
  const tempFileName = `${fileName}.${process.pid}.${randomUUID()}.tmp`;
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
  return createHash('sha256').update(source).digest('hex');
}
