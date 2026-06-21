import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as cacheIdentity from './cache-identity.js';
import {
  persistentCompileCacheDir,
  prunePersistentCompileCache,
  readPersistentCompileCacheEntry,
  readPersistentCompileCacheManifest,
  writePersistentCompileCacheEntry,
} from './persistent-compile-cache.js';

const tempRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('persistent compile cache format', () => {
  it('uses the gitignored .kovo/cache compiler directory', async () => {
    const root = await tempRoot();
    expect(persistentCompileCacheDir(root)).toBe(join(root, '.kovo/cache/compiler'));
  });

  it('writes a versioned manifest entry and content-addressed result blob atomically', async () => {
    const cacheDir = persistentCompileCacheDir(await tempRoot());
    const entry = await writePersistentCompileCacheEntry(cacheDir, {
      cacheKey: 'cache-key-a',
      footprint: {
        queryShapes: { cart: { count: 'number' } },
        reads: { queryShapeNames: ['cart'] },
      },
      result: {
        files: [{ fileName: 'cart.server.js', source: 'export {};' }],
      },
    });

    expect(entry.cacheKey).toBe('cache-key-a');
    expect(entry.artifactRefs.result).toMatch(/^blobs\/[0-9a-f]{64}\.json$/);
    const manifest = await readPersistentCompileCacheManifest(cacheDir);
    expect(manifest).toEqual({
      entries: { 'cache-key-a': { ...entry, updatedAtMs: expect.any(Number) } },
      version: 'kovo-compile-cache/v1',
    });
    await expect(readFile(join(cacheDir, entry.artifactRefs.result), 'utf8')).resolves.toContain(
      'cart.server.js',
    );
    await expect(readPersistentCompileCacheEntry(cacheDir, 'cache-key-a')).resolves.toEqual({
      files: [{ fileName: 'cart.server.js', source: 'export {};' }],
    });
  });

  it('preserves parallel per-entry writes and prunes older entries', async () => {
    const cacheDir = persistentCompileCacheDir(await tempRoot());
    await Promise.all([
      writePersistentCompileCacheEntry(cacheDir, {
        cacheKey: 'cache-key-a',
        footprint: { reads: { queryShapeNames: ['a'] } },
        result: { value: 'a' },
      }),
      writePersistentCompileCacheEntry(cacheDir, {
        cacheKey: 'cache-key-b',
        footprint: { reads: { queryShapeNames: ['b'] } },
        result: { value: 'b' },
      }),
    ]);

    const manifest = await readPersistentCompileCacheManifest(cacheDir);
    expect(Object.keys(manifest.entries).sort()).toEqual(['cache-key-a', 'cache-key-b']);

    await prunePersistentCompileCache(cacheDir, { maxEntries: 1 });
    const pruned = await readPersistentCompileCacheManifest(cacheDir);
    expect(Object.keys(pruned.entries)).toHaveLength(1);
  });

  it('misses an entry written by a different compiler build id (upgrade simulation)', async () => {
    // B1 (plans/bug-and-testing-part3.md): a compiler upgrade changes
    // compilerBuildId(), and an entry stamped by the prior compiler MUST NOT be
    // served as a hit (SPEC.md §5.2 / §5.2.1) — that would emit stale modules
    // from a previous implementation.
    const cacheDir = persistentCompileCacheDir(await tempRoot());
    await writePersistentCompileCacheEntry(cacheDir, {
      cacheKey: 'cache-key-a',
      footprint: { reads: { queryShapeNames: ['a'] } },
      result: { value: 'a' },
    });
    // Same build id → hit.
    await expect(readPersistentCompileCacheEntry(cacheDir, 'cache-key-a')).resolves.toEqual({
      value: 'a',
    });

    // Simulate the compiler being upgraded: compilerBuildId() now reports a new
    // namespace, so the previously written entry is a clean miss.
    vi.spyOn(cacheIdentity, 'compilerBuildId').mockReturnValue('@kovojs/compiler@9.9.9/deadbeef');
    await expect(readPersistentCompileCacheEntry(cacheDir, 'cache-key-a')).resolves.toBeNull();
  });

  it('keeps a result blob shared by a surviving entry when pruning evicts its twin', async () => {
    // B3 (plans/bug-and-testing-part3.md): result blobs are content-addressed,
    // so two entries with identical results share one blob. Pruning the older
    // entry must not delete the shared blob the kept entry still references.
    const cacheDir = persistentCompileCacheDir(await tempRoot());
    const sharedResult = { files: [{ fileName: 'shared.server.js', source: 'export {};' }] };

    const older = await writePersistentCompileCacheEntry(cacheDir, {
      cacheKey: 'cache-key-old',
      footprint: { reads: { queryShapeNames: ['a'] } },
      result: sharedResult,
    });
    // Ensure a strictly newer timestamp so the kept entry is deterministic.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await writePersistentCompileCacheEntry(cacheDir, {
      cacheKey: 'cache-key-new',
      footprint: { reads: { queryShapeNames: ['b'] } },
      result: sharedResult,
    });
    // Both entries point at the same content-addressed blob.
    expect(older.artifactRefs.result).toBe(newer.artifactRefs.result);

    await prunePersistentCompileCache(cacheDir, { maxEntries: 1 });

    const pruned = await readPersistentCompileCacheManifest(cacheDir);
    expect(Object.keys(pruned.entries)).toEqual(['cache-key-new']);
    // The kept entry's shared blob must survive: reading it still returns the result.
    await expect(readPersistentCompileCacheEntry(cacheDir, 'cache-key-new')).resolves.toEqual(
      sharedResult,
    );
    await expect(readFile(join(cacheDir, newer.artifactRefs.result), 'utf8')).resolves.toContain(
      'shared.server.js',
    );
  });

  it('treats a missing or corrupt manifest as an empty cache miss', async () => {
    const cacheDir = persistentCompileCacheDir(await tempRoot());
    await expect(readPersistentCompileCacheManifest(cacheDir)).resolves.toEqual({
      entries: {},
      version: 'kovo-compile-cache/v1',
    });

    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, 'manifest.json'), '{not-json');
    await expect(readPersistentCompileCacheManifest(cacheDir)).resolves.toEqual({
      entries: {},
      version: 'kovo-compile-cache/v1',
    });
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kovo-persistent-cache-'));
  tempRoots.push(root);
  return root;
}
