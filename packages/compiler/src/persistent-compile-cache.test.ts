import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as cacheIdentity from './cache-identity.js';
import {
  persistentCompileCacheDir,
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

  it('preserves parallel per-entry writes', async () => {
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

  it('misses cache entries whose blob ref escapes or is not content-addressed', async () => {
    const cacheDir = persistentCompileCacheDir(await tempRoot());
    const entry = await writePersistentCompileCacheEntry(cacheDir, {
      cacheKey: 'cache-key-a',
      footprint: { reads: { queryShapeNames: ['a'] } },
      result: { value: 'a' },
    });
    const manifest = await readPersistentCompileCacheManifest(cacheDir);
    manifest.entries['cache-key-a'] = {
      ...entry,
      artifactRefs: { result: '../../../../outside.json' },
    };
    await writeFile(join(cacheDir, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
    const [entryFile] = await readdir(join(cacheDir, 'entries'));
    await writeFile(
      join(cacheDir, 'entries', entryFile ?? ''),
      `${JSON.stringify(manifest.entries['cache-key-a'])}\n`,
    );

    await expect(readPersistentCompileCacheEntry(cacheDir, 'cache-key-a')).resolves.toBeNull();
  });

  it('misses cache entries whose blob contents do not match the content-addressed ref', async () => {
    const cacheDir = persistentCompileCacheDir(await tempRoot());
    const entry = await writePersistentCompileCacheEntry(cacheDir, {
      cacheKey: 'cache-key-a',
      footprint: { reads: { queryShapeNames: ['a'] } },
      result: { value: 'a' },
    });
    await writeFile(join(cacheDir, entry.artifactRefs.result), '{"value":"tampered"}');

    await expect(readPersistentCompileCacheEntry(cacheDir, 'cache-key-a')).resolves.toBeNull();
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kovo-persistent-cache-'));
  tempRoots.push(root);
  return root;
}
