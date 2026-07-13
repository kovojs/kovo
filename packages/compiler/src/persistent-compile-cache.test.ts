import { Buffer as NativeBuffer } from 'node:buffer';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as cacheIdentity from './cache-identity.js';
import { compileCacheKey, compileComponentCacheKeyInput } from './compile-cache.js';
import {
  compileComponentModuleForPersistentCache,
  persistentCompileCacheDir,
  readPersistentCompileCacheEntry,
  readPersistentCompileCacheEntryForInput,
  readPersistentCompileCacheManifest,
  writePersistentCompileCacheEntry,
} from './persistent-compile-cache.js';
import type {
  CompileComponentOptions,
  CompileDependencyFootprint,
  CompileResult,
} from './types.js';

const tempRoots: string[] = [];
const cacheKeysByResult = new WeakMap<CompileResult, string>();

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
    const result = cacheResult('cart');
    const cacheKey = cacheKeyForResult(result);
    const entry = requiredCacheEntry(
      await writePersistentCompileCacheEntry(cacheDir, {
        cacheKey,
        footprint: result.dependencyFootprint,
        result,
      }),
    );

    expect(entry.cacheKey).toBe(cacheKey);
    expect(entry.artifactRefs.result).toMatch(/^blobs\/[0-9a-f]{64}\.json$/);
    expect(entry.compilerBuildIdentityRef).toMatch(
      /^builds\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/,
    );
    expect(entry.resultPreimage).toContain('Cached');
    const manifest = await readPersistentCompileCacheManifest(cacheDir);
    expect(manifest).toEqual({
      entries: { [cacheKey]: { ...entry, updatedAtMs: expect.any(Number) } },
      version: 'kovo-compile-cache/v4',
    });
    await expect(readFile(join(cacheDir, entry.artifactRefs.result), 'utf8')).resolves.toContain(
      'Cached',
    );
    await expect(readFile(join(cacheDir, entry.compilerBuildIdentityRef), 'utf8')).resolves.toBe(
      cacheIdentity.compilerBuildCacheIdentity(),
    );
    await expect(readPersistentCompileCacheEntry(cacheDir, cacheKey)).resolves.toEqual(result);
  });

  it('does not write cache artifacts through a symlinked cache root', async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    const cacheDir = persistentCompileCacheDir(root);
    await mkdir(join(root, '.kovo/cache'), { recursive: true });
    await symlink(outside, cacheDir, 'dir');
    const result = cacheResult('outside');

    await expect(
      writePersistentCompileCacheEntry(cacheDir, {
        cacheKey: cacheKeyForResult(result),
        footprint: result.dependencyFootprint,
        result,
      }),
    ).rejects.toThrow(/symbolic-link|symbolic link|cannot use/u);
    await expect(readdir(outside)).resolves.toEqual([]);
  });

  it('atomically replaces symlinked and hardlinked cache artifact leaves', async () => {
    const cacheDir = persistentCompileCacheDir(await tempRoot());
    const outside = await tempRoot();
    const result = cacheResult('leaf-alias');
    const input = {
      cacheKey: cacheKeyForResult(result),
      footprint: result.dependencyFootprint,
      result,
    } satisfies Parameters<typeof writePersistentCompileCacheEntry>[1];
    const entry = requiredCacheEntry(await writePersistentCompileCacheEntry(cacheDir, input));
    const [entryFile] = await readdir(join(cacheDir, 'entries'));
    if (entryFile === undefined) throw new Error('expected persistent cache entry file');
    const aliases = [
      { kind: 'symlink', relativePath: entry.artifactRefs.result },
      { kind: 'hardlink', relativePath: entry.compilerBuildIdentityRef },
      { kind: 'hardlink', relativePath: `entries/${entryFile}` },
      { kind: 'symlink', relativePath: 'manifest.json' },
    ] as const;

    for (let index = 0; index < aliases.length; index += 1) {
      const alias = aliases[index]!;
      const target = join(cacheDir, alias.relativePath);
      const referent = join(outside, `outside-${index}.json`);
      await writeFile(referent, `outside-${index}\n`);
      await unlink(target);
      if (alias.kind === 'symlink') await symlink(referent, target);
      else await link(referent, target);
    }

    await writePersistentCompileCacheEntry(cacheDir, input);
    for (let index = 0; index < aliases.length; index += 1) {
      const alias = aliases[index]!;
      const target = join(cacheDir, alias.relativePath);
      const referent = join(outside, `outside-${index}.json`);
      await expect(readFile(referent, 'utf8')).resolves.toBe(`outside-${index}\n`);
      const targetStatus = await lstat(target);
      const referentStatus = await lstat(referent);
      expect(targetStatus.isSymbolicLink()).toBe(false);
      expect(targetStatus.ino).not.toBe(referentStatus.ino);
    }
  });

  it('treats symlinked cache entry, blob, and build-identity leaves as misses', async () => {
    const cacheDir = persistentCompileCacheDir(await tempRoot());
    const outside = await tempRoot();
    const result = cacheResult('read-leaf-alias');
    const cacheKey = cacheKeyForResult(result);
    const entry = requiredCacheEntry(
      await writePersistentCompileCacheEntry(cacheDir, {
        cacheKey,
        footprint: result.dependencyFootprint,
        result,
      }),
    );
    const [entryFile] = await readdir(join(cacheDir, 'entries'));
    if (entryFile === undefined) throw new Error('expected persistent cache entry file');
    const targets = [
      entry.artifactRefs.result,
      entry.compilerBuildIdentityRef,
      `entries/${entryFile}`,
    ];

    for (let index = 0; index < targets.length; index += 1) {
      const target = join(cacheDir, targets[index]!);
      const original = await readFile(target);
      const referent = join(outside, `outside-read-${index}.json`);
      await writeFile(referent, original);
      await unlink(target);
      await symlink(referent, target);
      await expect(readPersistentCompileCacheEntry(cacheDir, cacheKey)).resolves.toBeNull();
      await unlink(target);
      await writeFile(target, original);
    }
  });

  it('uses boot-pinned UTF-8 and clock controls after late mutation', async () => {
    const cacheDir = persistentCompileCacheDir(await tempRoot());
    const nativeBufferToString = NativeBuffer.prototype.toString;
    const nativeDateNow = Date.now;
    NativeBuffer.prototype.toString = (() => {
      throw new Error('late Buffer.prototype.toString replacement must not run');
    }) as typeof NativeBuffer.prototype.toString;
    Date.now = () => -1;

    try {
      const result = cacheResult('late-intrinsics');
      const cacheKey = cacheKeyForResult(result);
      const entry = requiredCacheEntry(
        await writePersistentCompileCacheEntry(cacheDir, {
          cacheKey,
          footprint: result.dependencyFootprint,
          result,
        }),
      );
      expect(entry.updatedAtMs).toBeGreaterThan(0);
      await expect(readPersistentCompileCacheEntry(cacheDir, cacheKey)).resolves.toEqual(result);
    } finally {
      NativeBuffer.prototype.toString = nativeBufferToString;
      Date.now = nativeDateNow;
    }
  });

  it('preserves parallel per-entry writes', async () => {
    const cacheDir = persistentCompileCacheDir(await tempRoot());
    const resultA = cacheResult('parallel-a');
    const resultB = cacheResult('parallel-b');
    const cacheKeyA = cacheKeyForResult(resultA);
    const cacheKeyB = cacheKeyForResult(resultB);
    const entries = await Promise.all([
      writePersistentCompileCacheEntry(cacheDir, {
        cacheKey: cacheKeyA,
        footprint: resultA.dependencyFootprint,
        result: resultA,
      }),
      writePersistentCompileCacheEntry(cacheDir, {
        cacheKey: cacheKeyB,
        footprint: resultB.dependencyFootprint,
        result: resultB,
      }),
    ]);

    const manifest = await readPersistentCompileCacheManifest(cacheDir);
    expect(Object.keys(manifest.entries).sort()).toEqual([cacheKeyA, cacheKeyB].sort());
    expect(requiredCacheEntry(entries[0]).compilerBuildIdentityRef).toBe(
      requiredCacheEntry(entries[1]).compilerBuildIdentityRef,
    );
    await expect(readFile(join(cacheDir, 'manifest.json'), 'utf8')).resolves.toBe(
      '{"entries":{},"version":"kovo-compile-cache/v4"}\n',
    );
  });

  it('misses an entry written by a different exact compiler build identity', async () => {
    // B1 (plans/bug-and-testing-part3.md): a compiler upgrade changes
    // compilerBuildCacheIdentity(), and an entry stamped by the prior compiler MUST NOT be
    // served as a hit (SPEC.md §5.2 / §5.2.1) — that would emit stale modules
    // from a previous implementation.
    const cacheDir = persistentCompileCacheDir(await tempRoot());
    const result = cacheResult('build-identity');
    const cacheKey = cacheKeyForResult(result);
    await writePersistentCompileCacheEntry(cacheDir, {
      cacheKey,
      footprint: result.dependencyFootprint,
      result,
    });
    // Same exact build identity → hit.
    await expect(readPersistentCompileCacheEntry(cacheDir, cacheKey)).resolves.toEqual(result);

    // Simulate the compiler being upgraded: the exact implementation identity now reports a new
    // namespace, so the previously written entry is a clean miss.
    vi.spyOn(cacheIdentity, 'compilerBuildCacheIdentity').mockReturnValue(
      '{"version":"compiler-build-cache-identity/v2","changed":true}',
    );
    await expect(readPersistentCompileCacheEntry(cacheDir, cacheKey)).resolves.toBeNull();
  });

  it('treats a missing or corrupt manifest as an empty cache miss', async () => {
    const cacheDir = persistentCompileCacheDir(await tempRoot());
    await expect(readPersistentCompileCacheManifest(cacheDir)).resolves.toEqual({
      entries: {},
      version: 'kovo-compile-cache/v4',
    });

    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, 'manifest.json'), '{not-json');
    await expect(readPersistentCompileCacheManifest(cacheDir)).resolves.toEqual({
      entries: {},
      version: 'kovo-compile-cache/v4',
    });
  });

  it('misses cache entries whose blob ref escapes or is not content-addressed', async () => {
    const cacheDir = persistentCompileCacheDir(await tempRoot());
    const result = cacheResult('escaping-ref');
    const cacheKey = cacheKeyForResult(result);
    const entry = requiredCacheEntry(
      await writePersistentCompileCacheEntry(cacheDir, {
        cacheKey,
        footprint: result.dependencyFootprint,
        result,
      }),
    );
    const manifest = await readPersistentCompileCacheManifest(cacheDir);
    manifest.entries[cacheKey] = {
      ...entry,
      artifactRefs: { result: '../../../../outside.json' },
    };
    await writeFile(join(cacheDir, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
    const [entryFile] = await readdir(join(cacheDir, 'entries'));
    await writeFile(
      join(cacheDir, 'entries', entryFile ?? ''),
      `${JSON.stringify(manifest.entries[cacheKey])}\n`,
    );

    await expect(readPersistentCompileCacheEntry(cacheDir, cacheKey)).resolves.toBeNull();
  });

  it('rejects an escaping blob ref despite a selective RegExp.exec replacement', async () => {
    const cacheDir = persistentCompileCacheDir(await tempRoot());
    const result = cacheResult('regexp-ref');
    const cacheKey = cacheKeyForResult(result);
    const entry = requiredCacheEntry(
      await writePersistentCompileCacheEntry(cacheDir, {
        cacheKey,
        footprint: result.dependencyFootprint,
        result,
      }),
    );
    const attackerJson = '{"files":[{"kind":"client","source":"export const adminToken = leak;"}]}';
    const maliciousRef = '../attacker.json';
    const require = createRequire(import.meta.url);
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    const attackerDigest = createHash('sha256').update(attackerJson).digest('hex');
    await writeFile(join(cacheDir, maliciousRef), attackerJson);
    const maliciousEntry = { ...entry, artifactRefs: { result: maliciousRef } };
    const manifest = await readPersistentCompileCacheManifest(cacheDir);
    manifest.entries[cacheKey] = maliciousEntry;
    await writeFile(join(cacheDir, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
    const [entryFile] = await readdir(join(cacheDir, 'entries'));
    if (entryFile === undefined) throw new Error('expected persistent cache entry file');
    await writeFile(join(cacheDir, 'entries', entryFile), `${JSON.stringify(maliciousEntry)}\n`);
    const nativeExec = RegExp.prototype.exec;
    RegExp.prototype.exec = function poisonedBlobRefExec(value: string): RegExpExecArray | null {
      if (value === maliciousRef && this.source.includes('blobs')) {
        return Object.assign([value, attackerDigest], {
          index: 0,
          input: value,
        }) as RegExpExecArray;
      }
      return Reflect.apply(nativeExec, this, [value]);
    };

    try {
      await expect(readPersistentCompileCacheEntry(cacheDir, cacheKey)).resolves.toBeNull();
    } finally {
      RegExp.prototype.exec = nativeExec;
    }
  });

  it('misses cache entries whose blob contents do not match the content-addressed ref', async () => {
    const cacheDir = persistentCompileCacheDir(await tempRoot());
    const result = cacheResult('blob-content');
    const cacheKey = cacheKeyForResult(result);
    const entry = requiredCacheEntry(
      await writePersistentCompileCacheEntry(cacheDir, {
        cacheKey,
        footprint: result.dependencyFootprint,
        result,
      }),
    );
    await writeFile(join(cacheDir, entry.artifactRefs.result), '{"value":"tampered"}');

    await expect(readPersistentCompileCacheEntry(cacheDir, cacheKey)).resolves.toBeNull();
  });

  it('rejects coordinated entry and blob tampering without a process-local cache authenticator', async () => {
    const cacheDir = persistentCompileCacheDir(await tempRoot());
    const result = cacheResult('coordinated-tamper');
    const cacheKey = cacheKeyForResult(result);
    const entry = requiredCacheEntry(
      await writePersistentCompileCacheEntry(cacheDir, {
        cacheKey,
        footprint: result.dependencyFootprint,
        result,
      }),
    );
    const attackerJson = '{"files":[{"kind":"client","source":"export const adminToken = leak;"}]}';
    await writeFile(join(cacheDir, entry.artifactRefs.result), attackerJson);

    const [entryFile] = await readdir(join(cacheDir, 'entries'));
    if (entryFile === undefined) throw new Error('expected persistent cache entry file');
    const entryPath = join(cacheDir, 'entries', entryFile);
    const tamperedEntry = JSON.parse(await readFile(entryPath, 'utf8')) as {
      resultPreimage: string;
    };
    tamperedEntry.resultPreimage = attackerJson;
    await writeFile(entryPath, `${JSON.stringify(tamperedEntry)}\n`);

    // A cache-directory writer can coordinate every stored preimage, but it cannot mint the
    // process-local authenticator captured before app/plugin evaluation (SPEC §5.2.1).
    await expect(readPersistentCompileCacheEntry(cacheDir, cacheKey)).resolves.toBeNull();
  });

  it('treats a blob-locator collision as a miss instead of cross-binding results', async () => {
    const cacheDir = persistentCompileCacheDir(await tempRoot());
    const firstResult = cacheResult('collision-a');
    const secondResult = cacheResult('collision-b');
    const firstKey = cacheKeyForResult(firstResult);
    const secondKey = cacheKeyForResult(secondResult);
    const first = requiredCacheEntry(
      await writePersistentCompileCacheEntry(cacheDir, {
        cacheKey: firstKey,
        footprint: firstResult.dependencyFootprint,
        result: firstResult,
      }),
    );
    const second = requiredCacheEntry(
      await writePersistentCompileCacheEntry(cacheDir, {
        cacheKey: secondKey,
        footprint: secondResult.dependencyFootprint,
        result: secondResult,
      }),
    );
    const manifest = await readPersistentCompileCacheManifest(cacheDir);
    const collided = { ...second, artifactRefs: first.artifactRefs };
    manifest.entries[secondKey] = collided;
    await writeFile(join(cacheDir, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
    const entryFiles = await readdir(join(cacheDir, 'entries'));
    for (const entryFile of entryFiles) {
      const path = join(cacheDir, 'entries', entryFile);
      const parsed = JSON.parse(await readFile(path, 'utf8')) as { cacheKey?: string };
      if (parsed.cacheKey === secondKey) {
        await writeFile(path, `${JSON.stringify(collided)}\n`);
      }
    }

    await expect(readPersistentCompileCacheEntry(cacheDir, firstKey)).resolves.toEqual(firstResult);
    await expect(readPersistentCompileCacheEntry(cacheDir, secondKey)).resolves.toBeNull();
  });

  it('rejects a tampered compiler blob despite a synchronized selective createHash replacement', async () => {
    const cacheDir = persistentCompileCacheDir(await tempRoot());
    const result = cacheResult('hash-tamper');
    const cacheKey = cacheKeyForResult(result);
    const entry = requiredCacheEntry(
      await writePersistentCompileCacheEntry(cacheDir, {
        cacheKey,
        footprint: result.dependencyFootprint,
        result,
      }),
    );
    const tampered = '{"files":[{"kind":"client","source":"export const adminToken = leak;"}]}';
    await writeFile(join(cacheDir, entry.artifactRefs.result), tampered);
    const storedDigest = /blobs\/([0-9a-f]{64})\.json$/u.exec(entry.artifactRefs.result)?.[1];
    expect(storedDigest).toBeDefined();

    const require = createRequire(import.meta.url);
    const mutableCrypto = require('node:crypto') as {
      createHash: (typeof import('node:crypto'))['createHash'];
    };
    const nativeCreateHash = mutableCrypto.createHash;
    mutableCrypto.createHash = ((algorithm: string, options?: unknown) => {
      const real = nativeCreateHash(algorithm, options as never);
      let input = '';
      return {
        digest(encoding: import('node:crypto').BinaryToTextEncoding) {
          if (input === tampered && encoding === 'hex') return storedDigest!;
          return real.digest(encoding);
        },
        update(value: string) {
          input += value;
          real.update(value);
          return this;
        },
      };
    }) as unknown as typeof mutableCrypto.createHash;
    syncBuiltinESMExports();

    try {
      await expect(readPersistentCompileCacheEntry(cacheDir, cacheKey)).resolves.toBeNull();
    } finally {
      mutableCrypto.createHash = nativeCreateHash;
      syncBuiltinESMExports();
    }
  });

  it('replays learned footprints without crossing production render-plan gates', async () => {
    const cacheDir = persistentCompileCacheDir(await tempRoot());
    const compileInput: CompileComponentOptions = {
      fileName: 'cart.tsx',
      queryShapes: { cart: { count: 'number' }, ignored: { name: 'string' } },
      source: `
export const CachedCart = component({
  queries: { cart: {} },
  render: () => <span>cart</span>,
});
`,
    };
    const result = compileComponentModuleForPersistentCache(compileInput);
    const footprint: CompileDependencyFootprint = result.dependencyFootprint;
    const cacheKey = compileCacheKey(compileComponentCacheKeyInput(compileInput, footprint));

    await writePersistentCompileCacheEntry(cacheDir, {
      cacheKey,
      footprint,
      result,
    });

    await expect(
      readPersistentCompileCacheEntryForInput(
        cacheDir,
        compileComponentCacheKeyInput({
          ...compileInput,
          queryShapes: { cart: { count: 'number' }, ignored: { title: 'string' } },
        }),
      ),
    ).resolves.toEqual(result);

    await expect(
      readPersistentCompileCacheEntryForInput(
        cacheDir,
        compileComponentCacheKeyInput({
          ...compileInput,
          productionRenderPlanGate: { previous: { cart: 'tok-1' } },
        }),
      ),
    ).resolves.toBeNull();
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kovo-persistent-cache-'));
  tempRoots.push(root);
  return root;
}

function cacheResult(label: string): CompileResult {
  const options: CompileComponentOptions = {
    fileName: `src/cache-${label}.tsx`,
    source: `
export const Cached = component({
  render: () => <span>{${JSON.stringify(label)}}</span>,
});
`,
  };
  const result = compileComponentModuleForPersistentCache(options);
  cacheKeysByResult.set(result, compileCacheKey(compileComponentCacheKeyInput(options)));
  return result;
}

function cacheKeyForResult(result: CompileResult): string {
  const cacheKey = cacheKeysByResult.get(result);
  if (cacheKey === undefined) throw new Error('expected test compile-result cache key');
  return cacheKey;
}

function requiredCacheEntry(
  entry: Awaited<ReturnType<typeof writePersistentCompileCacheEntry>>,
): NonNullable<typeof entry> {
  if (entry === null) throw new Error('expected an authorized persistent cache entry');
  return entry;
}
