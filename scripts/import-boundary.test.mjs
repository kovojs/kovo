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
import { trackedGeneratedViolations } from './no-committed-generated.mjs';

describe('import-boundary check', () => {
  it('extracts static imports, re-exports, and string-literal dynamic imports', () => {
    expect(
      importSpecifiers(`
import { component } from '@kovojs/core';
import type { KovoExplainInput } from '@kovojs/core/internal/graph';
export { escapeHtml } from '@kovojs/server/internal/html';
const runtime = () => import('@kovojs/browser/generated');
`),
    ).toEqual([
      '@kovojs/core',
      '@kovojs/core/internal/graph',
      '@kovojs/server/internal/html',
      '@kovojs/browser/generated',
    ]);
  });

  it('classifies non-public Kovo import tiers', () => {
    expect(nonPublicKovoImportTier('@kovojs/compiler')).toBe('internal');
    expect(nonPublicKovoImportTier('@kovojs/compiler/graph')).toBe('internal');
    expect(nonPublicKovoImportTier('@kovojs/compiler/package-styles')).toBe('internal');
    expect(nonPublicKovoImportTier('@kovojs/core/internal/graph')).toBe('internal');
    expect(nonPublicKovoImportTier('@kovojs/browser/generated')).toBe('generated');
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

  it('fails app-facing generated imports even in explicit artifact tests and fixtures', async () => {
    const rootDir = await fixtureRoot();
    await writeFixture(
      rootDir,
      'examples/demo/src/app.ts',
      "import { hidden } from '@kovojs/core/internal/graph';\n",
    );
    await writeFixture(
      rootDir,
      'examples/demo/src/mutations.ts',
      "import { optimistic } from './generated/optimistic/cart-add.js';\n",
    );
    await writeFixture(
      rootDir,
      'examples/demo/src/generated/app.client.js',
      "import { handler } from '@kovojs/browser/generated';\n",
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
      'examples/demo/src/runtime.test.ts',
      "import { runtime } from '@kovojs/browser/generated';\n",
    );
    await writeFixture(
      rootDir,
      'examples/demo/src/app.generated.browser.test.ts',
      "import { createApp } from './generated/app.kovo-route.js';\n",
    );
    await writeFixture(
      rootDir,
      'examples/demo/src/app.generated-browser-fixtures.ts',
      "import * as client from './generated/app.client.js';\n",
    );
    await writeFixture(
      rootDir,
      'examples/demo/src/app-browser-fixtures.ts',
      "import * as client from './generated/app.client.js';\n",
    );
    await writeFixture(
      rootDir,
      'examples/demo/scripts/emit-demo.mjs',
      "import { createApp } from '../src/generated/app.kovo-route.js';\n",
    );
    await writeFixture(
      rootDir,
      'packages/create-kovo/templates/src/component.tsx',
      "const runtime = () => import('@kovojs/browser/generated');\n",
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
        fileName: 'examples/demo/scripts/emit-demo.mjs',
        specifier: '../src/generated/app.kovo-route.js',
        tier: 'app-local-generated',
      },
      {
        fileName: 'examples/demo/src/app-browser-fixtures.ts',
        specifier: './generated/app.client.js',
        tier: 'app-local-generated',
      },
      {
        fileName: 'examples/demo/src/app.generated-browser-fixtures.ts',
        specifier: './generated/app.client.js',
        tier: 'app-local-generated',
      },
      {
        fileName: 'examples/demo/src/app.generated.browser.test.ts',
        specifier: './generated/app.kovo-route.js',
        tier: 'app-local-generated',
      },
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
        fileName: 'examples/demo/src/mutations.ts',
        specifier: './generated/optimistic/cart-add.js',
        tier: 'app-local-generated',
      },
      {
        fileName: 'examples/demo/src/runtime.test.ts',
        specifier: '@kovojs/browser/generated',
        tier: 'generated',
      },
      {
        fileName: 'packages/create-kovo/templates/src/component.tsx',
        specifier: '@kovojs/browser/generated',
        tier: 'generated',
      },
      {
        fileName: 'site/scripts/emit-routes.mjs',
        specifier: '@kovojs/compiler/graph',
        tier: 'internal',
      },
    ]);
  });

  it('detects committed generated artifacts in app-local roots only', () => {
    expect(
      trackedGeneratedViolations([
        'examples/commerce/src/generated/graph.json',
        'site/src/generated/kovo-ui.css',
        'site/tutorial/steps/02-islands/src/generated/product-actions.tsx',
        'packages/create-kovo/templates/graph.json',
        '.deepsec/examples/commerce/src/generated/graph.json',
        'packages/compiler/src/generated/primitive-reactive-attrs.ts',
        'examples/devtool/__screenshots__/generated.png',
      ]),
    ).toEqual([
      'examples/commerce/src/generated/graph.json',
      'site/src/generated/kovo-ui.css',
      'site/tutorial/steps/02-islands/src/generated/product-actions.tsx',
      'packages/create-kovo/templates/graph.json',
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
