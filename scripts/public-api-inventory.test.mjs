import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildPublicApiInventory,
  renderPublicApiInventoryMarkdown,
  resolveManifestSubpath,
} from './public-api-inventory.mjs';

const fixtureRoot = fileURLToPath(new URL('./fixtures/public-api-inventory/', import.meta.url));

describe('public API inventory', () => {
  it('keeps manifest subpaths, analyzed entrypoints, declarations, and generated members distinct', () => {
    const inventory = buildPublicApiInventory({ repoRoot: fixtureRoot });

    expect(inventory.findings).toEqual([]);
    expect(inventory.summary).toMatchObject({
      manifestPublicSubpaths: 5,
      analyzedTypeScriptEntrypoints: 3,
      exportedDeclarations: 4,
      generatedFamilyMembers: 2,
    });
    expect(inventory.generatedFamilies).toEqual([
      expect.objectContaining({
        package: '@fixture/glyphs',
        exportPattern: './*',
        memberCount: 2,
        members: [
          expect.objectContaining({ specifier: '@fixture/glyphs/alpha' }),
          expect.objectContaining({ specifier: '@fixture/glyphs/beta' }),
        ],
      }),
    ]);
  });

  it('reports consumer areas independently without treating generated output as authored demand', () => {
    const inventory = buildPublicApiInventory({ repoRoot: fixtureRoot });
    const feature = inventory.exportedDeclarations.find(
      (item) => item.specifier === '@fixture/api/feature' && item.symbol === 'feature',
    );

    expect(feature?.consumers).toEqual({
      authoredExamples: {
        imports: 1,
        files: ['examples/authored/src/app.ts'],
      },
      authoredDocs: { imports: 0, files: [] },
      packageInternals: {
        imports: 1,
        files: ['packages/consumer/src/index.ts'],
      },
      generatedEmit: {
        imports: 1,
        files: ['packages/create-kovo/templates/src/app.ts'],
      },
      conformance: {
        imports: 1,
        files: ['conformance/pin/src/case.ts'],
      },
      tests: {
        imports: 1,
        files: ['tests/api.test.ts'],
      },
    });
    expect(inventory.summary.consumerFiles).toEqual({
      authoredExamples: 1,
      authoredDocs: 1,
      packageInternals: 1,
      generatedEmit: 1,
      conformance: 1,
      tests: 1,
    });
  });

  it('excludes hostile nested dependencies and generated, dist, cache, packed, and throwaway trees', () => {
    const hostileRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-public-inventory-hostile-'));
    try {
      cpSync(fixtureRoot, hostileRoot, { recursive: true });
      for (const relative of [
        'examples/authored/node_modules/dependency/hostile.ts',
        'examples/authored/dist/hostile.ts',
      ]) {
        const absolute = path.join(hostileRoot, relative);
        mkdirSync(path.dirname(absolute), { recursive: true });
        writeFileSync(absolute, "import { feature } from '@fixture/api/feature';\nvoid feature;\n");
      }

      const inventory = buildPublicApiInventory({ repoRoot: hostileRoot });
      const excluded = inventory.exclusions.map((entry) => [
        entry.path.split(path.sep).join('/'),
        entry.reason,
      ]);

      expect(excluded).toEqual(
        expect.arrayContaining([
          ['examples/authored/node_modules', 'nested-dependency'],
          ['examples/authored/dist', 'generated-dist-cache'],
          ['examples/authored/generated', 'generated-dist-cache'],
          ['examples/authored/.cache', 'generated-dist-cache'],
          ['examples/packed-app', 'packed-or-throwaway'],
          ['examples/throwaway-app', 'packed-or-throwaway'],
        ]),
      );
      const feature = inventory.exportedDeclarations.find(
        (item) => item.specifier === '@fixture/api/feature' && item.symbol === 'feature',
      );
      expect(feature?.consumerImports).toBe(5);
      expect(JSON.stringify(feature?.consumers)).not.toContain('hostile');
    } finally {
      rmSync(hostileRoot, { recursive: true, force: true });
    }
  });

  it('resolves exact conditional exports before wildcard-generated families', () => {
    const exportsMap = {
      '.': './src/index.ts',
      './feature': { source: './src/feature.ts', default: './dist/feature.mjs' },
      './*': './src/*.ts',
    };

    expect(resolveManifestSubpath(exportsMap, './feature')).toEqual({
      exportPattern: './feature',
      generatedFamilyMember: false,
      target: './src/feature.ts',
    });
    expect(resolveManifestSubpath(exportsMap, './alpha')).toEqual({
      exportPattern: './*',
      generatedFamilyMember: true,
      target: './src/alpha.ts',
    });
  });

  it('renders the four inventory units and separated consumer areas', () => {
    const markdown = renderPublicApiInventoryMarkdown(
      buildPublicApiInventory({ repoRoot: fixtureRoot }),
    );
    expect(markdown).toContain('| Manifest-public subpaths | 5 |');
    expect(markdown).toContain('| Analyzed TypeScript entrypoints | 3 |');
    expect(markdown).toContain('| Exported declarations | 4 |');
    expect(markdown).toContain('| Generated-family members | 2 |');
    expect(markdown).toContain('| generatedEmit | 1 |');
  });
});
