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

function drizzleCompatibilityBarrelSource(): string {
  return readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');
}

describe('@jiso/drizzle runtime surface', () => {
  it('keeps the runtime annotation entrypoint separate from static extraction', async () => {
    const runtime = await import('@jiso/drizzle');
    const staticExtraction = await import('@jiso/drizzle/static');
    const packageJson = drizzlePackageJson();
    const compatibilityBarrelSource = drizzleCompatibilityBarrelSource();
    const runtimeSource = drizzleRuntimeSource();
    const staticSource = drizzleStaticSource();

    expect(runtime.jiso({ domain: 'cart', key: 'id' }).domain).toBe('cart');
    expect('extractTouchGraphFromSource' in runtime).toBe(false);
    expect(staticExtraction.extractTouchGraphFromSource).toBeTypeOf('function');
    expect(packageJson.exports).toEqual({
      '.': './src/runtime.ts',
      './static': './src/static.ts',
    });
    expect(packageJson.dependencies?.['ts-morph']).toBeUndefined();
    expect(packageJson.devDependencies?.['ts-morph']).toBe('^28.0.0');
    expect(runtimeSource).not.toContain('ts-morph');
    expect(runtimeSource).not.toContain('./index.js');
    expect(runtimeSource).not.toContain('./static.js');
    expect(runtimeSource).not.toContain('./graph.js');
    expect(runtimeSource).not.toContain('./invalidation.js');
    expect(staticSource).toContain("from 'ts-morph'");
    expect(compatibilityBarrelSource).not.toContain('ts-morph');
    expect(compatibilityBarrelSource).toContain("from './static.js'");
  });
});
