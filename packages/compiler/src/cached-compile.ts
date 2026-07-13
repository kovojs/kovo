import { compileComponentModule } from './compile.js';
import { compileCacheKey, compileComponentCacheKeyInput } from './compile-cache.js';
import { snapshotCompileComponentOptions } from './compile-options.js';
import {
  compileComponentModuleForPersistentCache,
  persistentCompileCacheDir,
  readPersistentCompileCacheEntryForInput,
  writePersistentCompileCacheEntry,
} from './persistent-compile-cache.js';
import type { CompileComponentOptions, CompileResult } from './types.js';

/**
 * @internal Compile through the real compiler before authorizing a process-local persistent entry.
 *
 * SPEC.md §2 / §5.2: the cache signer's authority is deliberately module-private. Authored config
 * may request a compile, but it cannot sign caller-supplied diagnostics or emitted bytes.
 */
export async function compileComponentModuleCached(
  options: CompileComponentOptions,
  cache = true,
): Promise<CompileResult> {
  // Pin the complete carrier before the first await so the cache key, compilation, and persisted
  // result all observe the same source and fact authority.
  options = snapshotCompileComponentOptions(options);
  if (!cache) return compileComponentModule(options);

  const cacheInput = compileComponentCacheKeyInput(options);
  const cacheDir = persistentCompileCacheDir(options.packagePrefixDiscoveryRoot ?? process.cwd());
  const persistent = await readPersistentCompileCacheEntryForInput<CompileResult>(
    cacheDir,
    cacheInput,
  );
  if (persistent) return persistent;

  // Do not retain a result object after returning it to an internal caller: a caller could mutate
  // that identity, delete the disk entry, and otherwise make a later memory-cache hit sign the
  // changed bytes. Vite owns a private per-plugin memory cache around this safe function.
  const result = compileComponentModuleForPersistentCache(options);
  const cacheKey = compileCacheKey(
    compileComponentCacheKeyInput(options, result.dependencyFootprint),
  );
  const written = await writePersistentCompileCacheEntry(cacheDir, {
    cacheKey,
    footprint: result.dependencyFootprint,
    result,
  });
  if (written === null) {
    throw new TypeError('Kovo compiler refused to persist a result without exact provenance.');
  }
  return result;
}
