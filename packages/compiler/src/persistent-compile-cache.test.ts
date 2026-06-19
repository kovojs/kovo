import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  persistentCompileCacheDir,
  prunePersistentCompileCache,
  readPersistentCompileCacheEntry,
  readPersistentCompileCacheManifest,
  writePersistentCompileCacheEntry,
} from './persistent-compile-cache.js';

const tempRoots: string[] = [];

afterEach(async () => {
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
