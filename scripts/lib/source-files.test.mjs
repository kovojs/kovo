import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectFiles,
  collectSourceFiles,
  isProductionSourceFile,
  securityMarkerSourceRoots,
} from './source-files.mjs';

describe('source file collection', () => {
  it('classifies production TypeScript source without tests or declarations', () => {
    expect(isProductionSourceFile('packages/server/src/route.ts')).toBe(true);
    expect(isProductionSourceFile('packages/server/src/view.tsx')).toBe(true);
    expect(isProductionSourceFile('packages/server/src/types.d.ts')).toBe(false);
    expect(isProductionSourceFile('packages/server/src/route.test.ts')).toBe(false);
    expect(isProductionSourceFile('packages/server/src/route.spec.tsx')).toBe(false);
    expect(isProductionSourceFile('packages/browser/src/client.ts')).toBe(false);
    expect(isProductionSourceFile('packages/server/src/runtime.js')).toBe(false);
  });

  it('recursively collects canonical source files with stable relative paths', async () => {
    const root = await fixtureRoot();
    await writeFixture(root, 'packages/server/src/route.ts', 'export {};\n');
    await writeFixture(root, 'packages/server/src/nested/view.tsx', 'export {};\n');
    await writeFixture(root, 'packages/server/src/route.test.ts', 'export {};\n');
    await writeFixture(root, 'packages/server/src/types.d.ts', 'export {};\n');
    await writeFixture(root, 'packages/server/src/runtime.js', 'export {};\n');
    await writeFixture(root, 'packages/browser/src/client.ts', 'export {};\n');

    expect(collectSourceFiles(root, ['packages/server/src'])).toEqual([
      'packages/server/src/nested/view.tsx',
      'packages/server/src/route.ts',
    ]);
  });

  it('supports caller-owned traversal policies without silently escaping files', async () => {
    const root = await fixtureRoot();
    await writeFixture(root, 'src/app.ts', 'export {};\n');
    await writeFixture(root, 'src/app.test.ts', 'export {};\n');
    await writeFixture(root, 'src/dist/generated.ts', 'export {};\n');
    await writeFixture(root, 'src/node_modules/pkg/index.ts', 'export {};\n');

    expect(
      collectFiles(root, ['src'], {
        includeFile: ({ relativePath }) => relativePath.endsWith('.ts'),
        skipDirectory: ({ name }) => name === 'node_modules' || name === 'dist',
      }),
    ).toEqual(['src/app.test.ts', 'src/app.ts']);
  });

  it('derives security classifier scan roots from packages importing security markers', async () => {
    const root = await fixtureRoot();
    await writeFixture(
      root,
      'packages/compiler/src/validate/trusted-html-provenance.ts',
      "import { securityClassifier } from '@kovojs/core/internal/security-markers';\n",
    );
    await writeFixture(root, 'packages/browser/src/client.ts', 'export {};\n');
    await writeFixture(
      root,
      'packages/server/src/runtime.ts',
      "import { wireEmitter } from '@kovojs/core/internal/security-markers';\n",
    );
    await writeFixture(
      root,
      'packages/conformance-fixtures/src/canary.ts',
      "import { securityClassifier } from '@kovojs/core/internal/security-markers';\n",
    );

    expect(securityMarkerSourceRoots(root, { baseRoots: ['packages/core/src'] })).toEqual([
      'packages/compiler/src',
      'packages/core/src',
      'packages/server/src',
    ]);
  });
});

async function fixtureRoot() {
  return mkdir(path.join(tmpdir(), `kovo-source-files-${process.pid}-${Date.now()}`), {
    recursive: true,
  });
}

async function writeFixture(rootDir, relativePath, source) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, source);
}
