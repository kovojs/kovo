import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { compileCacheKey, compileComponentCacheKeyInput } from './compile-cache.js';
import {
  compileComponentModuleForPersistentCache,
  persistentCompileCacheDir,
  writePersistentCompileCacheEntry,
} from './persistent-compile-cache.js';
import { createKovoVitePlugin } from './vite.js';

const source = `
import { component } from '@kovojs/core';
export const Card = component({ render() { return <article>Card</article>; } });
`;

describe('Vite compiler option authority', () => {
  it('does not expose arbitrary-result persistent cache signing to authored config', async () => {
    const internal = (await import('./internal.js')) as Record<string, unknown>;

    expect(internal.writePersistentCompileCacheEntry).toBeUndefined();
    expect(internal.compileComponentModuleCached).toBeTypeOf('function');
  });

  it('does not sign a forged result even when authored config locates the private writer', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-cache-authority-'));
    const fileName = 'src/forged.tsx';
    const dependencyFootprint = {};
    const cacheKey = compileCacheKey(
      compileComponentCacheKeyInput(
        { fileName, packagePrefixDiscoveryRoot: root, source },
        dependencyFootprint,
      ),
    );
    try {
      await expect(
        writePersistentCompileCacheEntry(persistentCompileCacheDir(root), {
          cacheKey,
          footprint: dependencyFootprint,
          result: {
            dependencyFootprint,
            diagnostics: [],
            files: [{ kind: 'server', source: 'export const forged = true;' }],
          },
        }),
      ).resolves.toBeNull();

      const plugin = createKovoVitePlugin(() => {
        throw new Error('real compiler reached');
      });
      plugin.configResolved?.({ root });
      await expect(plugin.transform(source, fileName)).rejects.toThrow('real compiler reached');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not delegate signing authority through an authored resolution hook', () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-cache-hook-authority-'));
    const moduleUrl = new URL('./persistent-compile-cache.ts', import.meta.url).href;
    const probe = `
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const tsUrl = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
      if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});
const cache = await import(${JSON.stringify(moduleUrl)});
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@kovojs/compiler/internal') {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export%20function%20compilerProducedResultAuthorizesPersistentCacheEntry()%7Breturn%20true%7D',
      };
    }
    return nextResolve(specifier, context);
  },
});
const written = await cache.writePersistentCompileCacheEntry(${JSON.stringify(
      join(root, '.kovo/cache/compiler'),
    )}, {
  cacheKey: 'forged',
  footprint: {},
  result: { files: [{ source: 'export const forged = true;' }] },
});
process.stdout.write(written === null ? 'rejected' : 'signed');
`;

    try {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe('rejected');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('binds cache authority to the exact compiler result bytes, footprint, and key', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-cache-binding-'));
    const options = {
      fileName: 'src/bound.tsx',
      packagePrefixDiscoveryRoot: root,
      source,
    };
    const cacheDir = persistentCompileCacheDir(root);
    try {
      const wrongKeyResult = compileComponentModuleForPersistentCache(options);
      const cacheKey = compileCacheKey(compileComponentCacheKeyInput(options));
      await expect(
        writePersistentCompileCacheEntry(cacheDir, {
          cacheKey: `${cacheKey}-forged`,
          footprint: wrongKeyResult.dependencyFootprint,
          result: wrongKeyResult,
        }),
      ).resolves.toBeNull();

      const wrongFootprintResult = compileComponentModuleForPersistentCache(options);
      await expect(
        writePersistentCompileCacheEntry(cacheDir, {
          cacheKey,
          footprint: { reads: { queryShapeNames: ['forged'] } },
          result: wrongFootprintResult,
        }),
      ).resolves.toBeNull();

      const mutatedResult = compileComponentModuleForPersistentCache(options);
      const firstFile = mutatedResult.files[0];
      if (firstFile === undefined) throw new Error('expected compiler output');
      (firstFile as { source: string }).source = 'export const forged = true;';
      await expect(
        writePersistentCompileCacheEntry(cacheDir, {
          cacheKey,
          footprint: mutatedResult.dependencyFootprint,
          result: mutatedResult,
        }),
      ).resolves.toBeNull();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not let app code forge emitted-module re-entry authority', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-reentry-authority-'));
    const id = join(root, 'src/forged.tsx');
    const publicRegistryKey = Symbol.for('@kovojs/compiler:cleanlyCompiledComponentIds');
    const host = globalThis as { [publicRegistryKey]?: Set<string> };
    const previousRegistryDescriptor = Object.getOwnPropertyDescriptor(host, publicRegistryKey);
    const forgedRegistry = (host[publicRegistryKey] ??= new Set<string>());
    const forgedIds = [id, 'src/forged.tsx', id.replaceAll('\\', '/')];
    for (const forgedId of forgedIds) forgedRegistry.add(forgedId);
    let compileCalls = 0;

    try {
      const plugin = createKovoVitePlugin(() => {
        compileCalls += 1;
        throw new Error('KV235 compiler gate reached');
      });
      plugin.configResolved?.({ root });

      await expect(
        Promise.resolve(
          plugin.transform(
            `
import { escapeHtml } from '@kovojs/server/internal/escape';
import { component } from '@kovojs/core';
export const Forged = component({ render: () => <article>{escapeHtml('x')}</article> });
`,
            id,
          ),
        ),
      ).rejects.toThrow('KV235 compiler gate reached');
      expect(compileCalls).toBe(1);
    } finally {
      for (const forgedId of forgedIds) forgedRegistry.delete(forgedId);
      if (previousRegistryDescriptor === undefined) {
        Reflect.deleteProperty(host, publicRegistryKey);
      } else {
        Object.defineProperty(host, publicRegistryKey, previousRegistryDescriptor);
      }
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects plugin option accessors without invoking them', () => {
    let reads = 0;
    expect(() =>
      createKovoVitePlugin(() => ({ diagnostics: [], files: [] }), {
        get cache() {
          reads += 1;
          return false;
        },
      }),
    ).toThrow(/cache.*changed while/u);
    expect(reads).toBe(0);
  });

  it('does not dispatch plugin snapshots through inherited option setters', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'cache');
    let poisonHits = 0;
    try {
      Object.defineProperty(Object.prototype, 'cache', {
        configurable: true,
        set() {
          poisonHits += 1;
        },
      });
      expect(() =>
        createKovoVitePlugin(() => ({ diagnostics: [], files: [] }), { cache: false }),
      ).not.toThrow();
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(Object.prototype, 'cache');
      else Object.defineProperty(Object.prototype, 'cache', descriptor);
    }
    expect(poisonHits).toBe(0);
  });

  it('uses one pinned compile carrier across persistent lookup and compilation', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-vite-option-authority-'));
    const prefixes = [{ packageName: '@example/ui', prefix: 'reviewed-' }];
    let compiledPrefix: string | null | undefined;
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      const plugin = createKovoVitePlugin(
        (options) => {
          compiledPrefix = options.packageComponentPrefixes?.[0]?.prefix;
          return { diagnostics: [], files: [{ kind: 'server', source: 'export {};\n' }] };
        },
        { packageComponentPrefixes: prefixes },
      );
      plugin.configResolved?.({ root });

      const pending = plugin.transform(source, join(root, 'src/card.tsx'));
      prefixes[0]!.prefix = 'substituted-';
      await pending;

      expect(compiledPrefix).toBe('reviewed-');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
