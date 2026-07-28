import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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

  it('keeps side-effect, wildcard, namespace-container, and dynamic imports at entrypoint level', () => {
    const evidenceRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-public-inventory-evidence-'));
    try {
      cpSync(fixtureRoot, evidenceRoot, { recursive: true });
      const evidenceFiles = {
        'examples/evidence/side-effect.ts': "import '@fixture/api/feature';\n",
        'examples/evidence/wildcard.ts': "export * from '@fixture/api/feature';\n",
        'examples/evidence/dynamic.ts': "void import('@fixture/api/feature');\n",
        'examples/evidence/namespace-container.ts':
          "import * as api from '@fixture/api/feature';\nvoid api;\n",
        'examples/evidence/namespace-exact.ts':
          "import * as api from '@fixture/api/feature';\nconst value: api.Feature = api.feature();\nvoid value;\n",
        'examples/evidence/commonjs-exact.cjs':
          "const { Feature, feature: makeFeature } = require('@fixture/api/feature');\nconst direct = require('@fixture/api/feature').feature;\nvoid Feature; void makeFeature; void direct;\n",
        'examples/evidence/commonjs-namespace.cjs':
          "const api = require('@fixture/api/feature');\nconst alias = api;\nconst { Feature } = alias;\nconst direct = alias.feature;\nvoid Feature; void direct;\n",
        'examples/evidence/commonjs-dynamic.cjs':
          "const name = 'feature';\nconst dynamicSpecifier = '@fixture/api/feature';\nconst dynamic = require(dynamicSpecifier);\nconst api = require('@fixture/api/feature');\nvoid dynamic.feature; void api[name];\n",
        'examples/evidence/commonjs-shadowed.cjs':
          "const api = require('@fixture/api/feature');\nfunction inspect(api) { return api.feature; }\nvoid api; void inspect;\n",
      };
      for (const [relative, source] of Object.entries(evidenceFiles)) {
        const absolute = path.join(evidenceRoot, relative);
        mkdirSync(path.dirname(absolute), { recursive: true });
        writeFileSync(absolute, source);
      }

      const inventory = buildPublicApiInventory({ repoRoot: evidenceRoot });
      expect(inventory.findings).toEqual([]);
      const declarations = inventory.exportedDeclarations.filter(
        (item) => item.specifier === '@fixture/api/feature',
      );
      const entrypoint = inventory.analyzedTypeScriptEntrypoints.find(
        (item) => item.specifier === '@fixture/api/feature',
      );
      const entrypointOnly = [
        'examples/evidence/side-effect.ts',
        'examples/evidence/wildcard.ts',
        'examples/evidence/dynamic.ts',
        'examples/evidence/namespace-container.ts',
      ];
      expect(entrypoint?.consumers.authoredExamples.files).toEqual(
        expect.arrayContaining([...entrypointOnly, 'examples/evidence/namespace-exact.ts']),
      );
      for (const declaration of declarations) {
        for (const relative of entrypointOnly) {
          expect(declaration.consumers.authoredExamples.files).not.toContain(relative);
        }
      }
      for (const symbol of ['Feature', 'feature']) {
        expect(
          declarations.find((declaration) => declaration.symbol === symbol)?.consumers
            .authoredExamples.files,
        ).toEqual(
          expect.arrayContaining([
            'examples/evidence/commonjs-exact.cjs',
            'examples/evidence/commonjs-namespace.cjs',
            'examples/evidence/namespace-exact.ts',
          ]),
        );
      }
      for (const declaration of declarations) {
        for (const relative of [
          'examples/evidence/commonjs-dynamic.cjs',
          'examples/evidence/commonjs-shadowed.cjs',
        ]) {
          expect(declaration.consumers.authoredExamples.files).not.toContain(relative);
        }
      }
    } finally {
      rmSync(evidenceRoot, { recursive: true, force: true });
    }
  });

  it('uses objective/declared exclusions while preserving coincidentally named authored consumers', () => {
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
      const coincidentalAuthoredFiles = [
        'examples/packed-release-notes/authored.ts',
        'examples/throwaway-ideas/authored.ts',
        'examples/scratch/authored.ts',
        'examples/temp-app/authored.ts',
        'examples/tmp-app/authored.ts',
        'examples/tarball-consumer/authored.ts',
      ];
      for (const relative of coincidentalAuthoredFiles) {
        const absolute = path.join(hostileRoot, relative);
        mkdirSync(path.dirname(absolute), { recursive: true });
        writeFileSync(absolute, "import { feature } from '@fixture/api/feature';\nvoid feature;\n");
      }
      const declaredPacked = path.join(hostileRoot, 'examples/release-consumer-shadow');
      mkdirSync(declaredPacked, { recursive: true });
      writeFileSync(
        path.join(declaredPacked, 'hostile.ts'),
        "import { feature } from '@fixture/api/feature';\nvoid feature;\n",
      );
      const declaredThrowaway = path.join(hostileRoot, 'examples/local-evaluation-copy');
      mkdirSync(declaredThrowaway, { recursive: true });
      writeFileSync(
        path.join(declaredThrowaway, 'package.json'),
        `${JSON.stringify({
          name: 'innocently-named-copy',
          private: true,
        })}\n`,
      );
      writeFileSync(
        path.join(declaredThrowaway, 'hostile.ts'),
        "import { feature } from '@fixture/api/feature';\nvoid feature;\n",
      );
      symlinkSync(
        path.join(hostileRoot, 'examples/authored/src'),
        path.join(hostileRoot, 'examples/authored/dependency-copy'),
        'dir',
      );
      const exclusionsPath = path.join(hostileRoot, 'public-api-inventory-exclusions.json');
      const exclusions = JSON.parse(readFileSync(exclusionsPath, 'utf8'));
      exclusions.directories.push(
        {
          path: 'examples/release-consumer-shadow',
          kind: 'packed-fixture',
          rationale: 'Generated release-consumer fixture excluded by central review.',
        },
        {
          path: 'examples/local-evaluation-copy',
          kind: 'throwaway-app',
          rationale: 'Disposable evaluation copy excluded by central review.',
        },
      );
      writeFileSync(exclusionsPath, `${JSON.stringify(exclusions, null, 2)}\n`);

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
          ['examples/packed-app', 'declared-packed-fixture'],
          ['examples/throwaway-app', 'declared-throwaway-app'],
          ['examples/release-consumer-shadow', 'declared-packed-fixture'],
          ['examples/local-evaluation-copy', 'declared-throwaway-app'],
          ['examples/authored/dependency-copy', 'symbolic-link'],
        ]),
      );
      const feature = inventory.exportedDeclarations.find(
        (item) => item.specifier === '@fixture/api/feature' && item.symbol === 'feature',
      );
      expect(feature?.consumerImports).toBe(11);
      expect(feature?.consumers.authoredExamples.files).toEqual(
        expect.arrayContaining(coincidentalAuthoredFiles),
      );
      for (const relative of coincidentalAuthoredFiles) {
        expect(excluded.some(([directory]) => relative.startsWith(`${directory}/`))).toBe(false);
      }
      expect(JSON.stringify(feature?.consumers)).not.toContain('hostile');
    } finally {
      rmSync(hostileRoot, { recursive: true, force: true });
    }
  });

  it('rejects local exclusion markers and package declarations under authored roots', () => {
    const hostileRoot = mkdtempSync(
      path.join(os.tmpdir(), 'kovo-public-inventory-local-exclusion-'),
    );
    try {
      cpSync(fixtureRoot, hostileRoot, { recursive: true });
      const hiddenRoot = path.join(hostileRoot, 'examples/authored-hidden');
      mkdirSync(hiddenRoot, { recursive: true });
      writeFileSync(
        path.join(hiddenRoot, '.kovo-public-api-inventory.json'),
        `${JSON.stringify({
          schema: 'kovo-public-api-inventory-exclusion/v1',
          kind: 'packed-fixture',
        })}\n`,
      );
      writeFileSync(
        path.join(hiddenRoot, 'hostile.ts'),
        "import { feature } from '@fixture/api/feature';\nvoid feature;\n",
      );

      expect(() => buildPublicApiInventory({ repoRoot: hostileRoot })).toThrow(
        'local inventory exclusion markers are forbidden',
      );

      rmSync(path.join(hiddenRoot, '.kovo-public-api-inventory.json'));
      writeFileSync(
        path.join(hiddenRoot, 'package.json'),
        `${JSON.stringify({
          name: 'hostile-authored-copy',
          private: true,
          kovoInventory: { consumerKind: 'throwaway-app' },
        })}\n`,
      );
      expect(() => buildPublicApiInventory({ repoRoot: hostileRoot })).toThrow(
        'local kovoInventory exclusions are forbidden',
      );
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

  it('surfaces malformed consumer and public-entrypoint TypeScript and makes --check red', () => {
    const diagnosticsRoot = mkdtempSync(
      path.join(os.tmpdir(), 'kovo-public-inventory-diagnostics-'),
    );
    try {
      cpSync(fixtureRoot, diagnosticsRoot, { recursive: true });
      writeFileSync(
        path.join(diagnosticsRoot, 'examples/authored/src/broken.ts'),
        "import { feature from '@fixture/api/feature';\n",
      );
      writeFileSync(
        path.join(diagnosticsRoot, 'packages/api/src/feature.ts'),
        'export const broken: MissingPublicType = 1;\n',
      );

      const inventory = buildPublicApiInventory({ repoRoot: diagnosticsRoot });
      expect(inventory.findings).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            'TypeScript consumer parse diagnostic: examples/authored/src/broken.ts',
          ),
          expect.stringContaining(
            "TypeScript program diagnostic: packages/api/src/feature.ts:1:22 TS2304 Cannot find name 'MissingPublicType'.",
          ),
        ]),
      );
      const command = spawnSync(
        'node',
        [
          fileURLToPath(new URL('./public-api-inventory.mjs', import.meta.url)),
          '--repo-root',
          diagnosticsRoot,
          '--check',
        ],
        { cwd: fixtureRoot, encoding: 'utf8' },
      );
      expect(command.status).toBe(1);
      expect(command.stderr).toContain('TypeScript consumer parse diagnostic');
      expect(command.stderr).toContain(
        "TypeScript program diagnostic: packages/api/src/feature.ts:1:22 TS2304 Cannot find name 'MissingPublicType'.",
      );
    } finally {
      rmSync(diagnosticsRoot, { recursive: true, force: true });
    }
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
