import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

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
  try {
    const parsed = JSON.parse(await readFile(manifestPath(cacheDir), 'utf8')) as unknown;
    return isPersistentCompileCacheManifest(parsed) ? parsed : emptyPersistentCompileCacheManifest();
  } catch {
    return emptyPersistentCompileCacheManifest();
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
  const resultJson = stableJson(entry.result);
  const resultRef = `blobs/${sha256(resultJson)}.json`;
  await atomicWriteFile(join(cacheDir, resultRef), resultJson);

  const manifest = await readPersistentCompileCacheManifest(cacheDir);
  const manifestEntry: PersistentCompileCacheEntry = {
    artifactRefs: { result: resultRef },
    cacheKey: entry.cacheKey,
    compilerBuildId: compilerBuildId(),
    footprint: entry.footprint,
  };
  manifest.entries[entry.cacheKey] = manifestEntry;
  await atomicWriteFile(manifestPath(cacheDir), `${stableJson(manifest)}\n`);
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

async function atomicWriteFile(fileName: string, source: string): Promise<void> {
  await mkdir(dirname(fileName), { recursive: true });
  const tempFileName = `${fileName}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempFileName, source);
  await rename(tempFileName, fileName);
}

function manifestPath(cacheDir: string): string {
  return join(cacheDir, 'manifest.json');
}

function sha256(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}
