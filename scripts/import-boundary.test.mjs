import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  appLocalGeneratedImportTier,
  collectImportBoundaryViolations,
  importSpecifiers,
  nonPublicKovoImportTier,
} from './import-boundary.mjs';

describe('import-boundary check', () => {
  it('extracts static imports, re-exports, and string-literal dynamic imports', () => {
    expect(
      importSpecifiers(`
import { component } from '@kovojs/core';
import type { KovoExplainInput } from '@kovojs/core/internal/graph';
export { escapeHtml } from '@kovojs/server/internal/html';
const runtime = () => import('@kovojs/runtime/generated');
`),
    ).toEqual([
      '@kovojs/core',
      '@kovojs/core/internal/graph',
      '@kovojs/server/internal/html',
      '@kovojs/runtime/generated',
    ]);
  });

  it('classifies non-public Kovo import tiers', () => {
    expect(nonPublicKovoImportTier('@kovojs/compiler')).toBe('internal');
    expect(nonPublicKovoImportTier('@kovojs/compiler/graph')).toBe('internal');
    expect(nonPublicKovoImportTier('@kovojs/compiler/package-styles')).toBe('internal');
    expect(nonPublicKovoImportTier('@kovojs/core/internal/graph')).toBe('internal');
    expect(nonPublicKovoImportTier('@kovojs/runtime/generated')).toBe('generated');
    expect(nonPublicKovoImportTier('@kovojs/cli/internal')).toBe('internal');
    expect(nonPublicKovoImportTier('@kovojs/core')).toBeNull();
    expect(appLocalGeneratedImportTier('./generated/app.kovo-route.js')).toBe(
      'app-local-generated',
    );
    expect(appLocalGeneratedImportTier('../generated/optimistic/cart-add.js')).toBe(
      'app-local-generated',
    );
    expect(appLocalGeneratedImportTier('./components/cart.js')).toBeNull();
  });

  it('fails app-facing authored code but exempts generated artifacts and tests', async () => {
    const rootDir = await fixtureRoot();
    await writeFixture(
      rootDir,
      'examples/demo/src/app.ts',
      "import { hidden } from '@kovojs/core/internal/graph';\n",
    );
    await writeFixture(
      rootDir,
      'examples/demo/src/generated/app.client.js',
      "import { handler } from '@kovojs/runtime/generated';\n",
    );
    await writeFixture(
      rootDir,
      'site/tutorial/steps/01/src/app.test.ts',
      "import { main } from '@kovojs/cli/internal';\n",
    );
    await writeFixture(
      rootDir,
      'examples/demo/src/app.test.ts',
      "import { createApp } from './generated/app.kovo-route.js';\n",
    );
    await writeFixture(
      rootDir,
      'examples/demo/src/app.generated.test.ts',
      "import { createApp } from './generated/app.kovo-route.js';\n",
    );
    await writeFixture(
      rootDir,
      'packages/create-kovo/templates/src/component.tsx',
      "const runtime = () => import('@kovojs/runtime/generated');\n",
    );
    await writeFixture(
      rootDir,
      'site/scripts/emit-routes.mjs',
      "const compiler = await import('@kovojs/compiler/graph');\n",
    );

    await expect(
      collectImportBoundaryViolations({
        rootDir,
        roots: ['examples', 'packages/create-kovo/templates', 'site/scripts', 'site/tutorial'],
      }),
    ).resolves.toEqual([
      {
        fileName: 'examples/demo/src/app.test.ts',
        specifier: './generated/app.kovo-route.js',
        tier: 'app-local-generated',
      },
      {
        fileName: 'examples/demo/src/app.ts',
        specifier: '@kovojs/core/internal/graph',
        tier: 'internal',
      },
      {
        fileName: 'packages/create-kovo/templates/src/component.tsx',
        specifier: '@kovojs/runtime/generated',
        tier: 'generated',
      },
      {
        fileName: 'site/scripts/emit-routes.mjs',
        specifier: '@kovojs/compiler/graph',
        tier: 'internal',
      },
    ]);
  });
});

async function fixtureRoot() {
  return mkdir(path.join(tmpdir(), `kovo-import-boundary-${process.pid}-${Date.now()}`), {
    recursive: true,
  });
}

async function writeFixture(rootDir, relativePath, source) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, source);
}
