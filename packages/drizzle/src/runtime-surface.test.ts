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

describe('@jiso/drizzle runtime surface', () => {
  it('keeps the runtime annotation entrypoint separate from static extraction', async () => {
    const runtime = await import('@jiso/drizzle');
    const staticExtraction = await import('@jiso/drizzle/static');
    const packageJson = drizzlePackageJson();

    expect(runtime.jiso({ domain: 'cart', key: 'id' }).domain).toBe('cart');
    expect('extractTouchGraphFromSource' in runtime).toBe(false);
    expect(staticExtraction.extractTouchGraphFromSource).toBeTypeOf('function');
    expect(packageJson.exports).toEqual({
      '.': './src/runtime.ts',
      './static': './src/index.ts',
    });
    expect(packageJson.dependencies?.['ts-morph']).toBeUndefined();
    expect(packageJson.devDependencies?.['ts-morph']).toBe('^28.0.0');
  });
});
