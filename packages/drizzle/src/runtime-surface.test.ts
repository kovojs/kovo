import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface DrizzlePackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: Record<string, string>;
}

function drizzlePackageJson(): DrizzlePackageJson {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as DrizzlePackageJson;
}

function drizzleRuntimeSource(): string {
  return readFileSync(fileURLToPath(new URL('./runtime.ts', import.meta.url)), 'utf8');
}

function drizzleStaticSource(): string {
  return readFileSync(fileURLToPath(new URL('./static.ts', import.meta.url)), 'utf8');
}

function drizzleDeriveSource(): string {
  return readFileSync(fileURLToPath(new URL('./derive.ts', import.meta.url)), 'utf8');
}

function drizzleCompatibilityBarrelSource(): string {
  return readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');
}

describe('@kovojs/drizzle runtime surface', () => {
  it('keeps the runtime annotation entrypoint separate from static extraction', async () => {
    const runtime = await import('@kovojs/drizzle');
    const staticExtraction = await import('@kovojs/drizzle/static');
    const compatibilityBarrel = await import('./index.js');
    const packageJson = drizzlePackageJson();
    const compatibilityBarrelSource = drizzleCompatibilityBarrelSource();
    const runtimeSource = drizzleRuntimeSource();
    const staticSource = drizzleStaticSource();

    expect(runtime.kovo({ domain: 'cart', key: 'id' }).domain).toBe('cart');
    expect('extractTouchGraphFromSource' in runtime).toBe(false);
    expect(compatibilityBarrel.kovo({ domain: 'cart', key: 'id' }).domain).toBe('cart');
    expect('extractTouchGraphFromSource' in compatibilityBarrel).toBe(false);
    // SPEC §11.1 (v1 scope): source-mode extraction was removed in v1-cleanup item 4; only the
    // project-mode ts-morph entry points remain on the static surface.
    expect('extractTouchGraphFromSource' in staticExtraction).toBe(false);
    expect('extractQueryFactsFromSource' in staticExtraction).toBe(false);
    expect(staticExtraction.extractTouchGraphFromProject).toBeTypeOf('function');
    expect(staticExtraction.extractQueryFactsFromProject).toBeTypeOf('function');
    expect(packageJson.exports).toEqual({
      '.': './src/runtime.ts',
      // SPEC.md §10.5: the source-agnostic derivation algebra is a ts-morph-free
      // entrypoint (it consumes the shared IR, not Drizzle source).
      './derive': './src/derive.ts',
      './static': './src/static.ts',
    });
    expect(drizzleDeriveSource()).not.toContain('ts-morph');
    // api-cleanup Phase 6: `./static` is a published, app-build-consumed entry that
    // imports ts-morph, so ts-morph must be a real dependency (not a devDep) — while
    // the runtime/derive entrypoints below stay ts-morph-free.
    expect(packageJson.dependencies?.['ts-morph']).toBe('^28.0.0');
    expect(packageJson.devDependencies?.['ts-morph']).toBeUndefined();
    expect(runtimeSource).not.toContain('ts-morph');
    expect(runtimeSource).not.toContain('./index.js');
    expect(runtimeSource).not.toContain('./static.js');
    expect(runtimeSource).not.toContain('./graph.js');
    expect(runtimeSource).not.toContain('./invalidation.js');
    expect(staticSource).toContain("from 'ts-morph'");
    expect(staticSource).not.toContain('SOURCE_EXTRACTION_FILE_NAME');
    expect(staticSource).not.toContain('__kovo_source.ts');
    expect(staticSource).toContain(
      'createSourceFile(projectSourceFileName(file.fileName), file.source',
    );
    expect(staticSource).toContain('function projectSourceFileName(fileName: string): string');
    expect(compatibilityBarrelSource).not.toContain('ts-morph');
    expect(compatibilityBarrelSource).not.toContain('./static.js');
    expect(compatibilityBarrelSource).not.toContain('./graph.js');
    expect(compatibilityBarrelSource).not.toContain('./invalidation.js');
    expect(compatibilityBarrelSource).toContain("from './runtime.js'");
  });
});
