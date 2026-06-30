import { describe, expect, it } from 'vitest';

import {
  GENERATED_ARTIFACT_CATEGORIES,
  GENERATED_ARTIFACT_GENERATORS,
  generatedArtifactCategoriesForPath,
  generatedArtifactGeneratorCheckCommand,
  generatedArtifactPoliciesForGenerator,
  generatedArtifactPathspecs,
  validateGeneratedEmitContract,
} from './generated-artifacts.mjs';

const C = GENERATED_ARTIFACT_CATEGORIES;

describe('generated-artifacts policy manifest', () => {
  it('classifies generated artifact paths by policy category', () => {
    const cases = [
      {
        path: 'examples/commerce/src/generated/graph.json',
        categories: [C.appLocalGeneratedOutput, C.mustNotCommit],
      },
      {
        path: 'site/src/generated/kovo-ui.css',
        categories: [C.appLocalGeneratedOutput, C.mustNotCommit],
      },
      {
        path: 'site/tutorial/steps/02-islands/src/generated/product-actions.tsx',
        categories: [C.appLocalGeneratedOutput, C.mustNotCommit],
      },
      {
        path: 'packages/create-kovo/templates/graph.json',
        categories: [C.appLocalGeneratedOutput, C.mustNotCommit],
      },
      {
        path: 'packages/icons/src/arrow-right.tsx',
        categories: [C.frameworkGeneratedSource, C.mustMatchGenerator],
      },
      {
        path: 'packages/icons/package.json',
        categories: [C.generatedPackageMetadata, C.mustMatchGenerator],
      },
      {
        path: 'public-packages.json',
        categories: [C.generatedPackageMetadata, C.mustMatchGenerator],
      },
      {
        path: 'packages/headless-ui/src/generated.ts',
        categories: [C.frameworkGeneratedSource, C.mustMatchGenerator],
      },
      {
        path: 'packages/ui/registry.json',
        categories: [C.generatedPackageMetadata, C.mustMatchGenerator],
      },
      {
        path: 'routes/products/product-card.server.js',
        categories: [C.frameworkGeneratedSource, C.mustBeReadable, C.mustMatchEmitContract],
      },
      {
        path: 'routes/products/product-card.client.js',
        categories: [C.frameworkGeneratedSource, C.mustBeReadable, C.mustMatchEmitContract],
      },
      {
        path: 'generated/registries.d.ts',
        categories: [C.generatedPackageMetadata, C.mustBeReadable, C.mustMatchEmitContract],
      },
      {
        path: '.deepsec/examples/commerce/src/generated/graph.json',
        categories: [],
      },
      {
        path: 'packages/compiler/src/generated/primitive-reactive-attrs.ts',
        categories: [],
      },
    ];

    for (const { path, categories } of cases) {
      expect(generatedArtifactCategoriesForPath(path), path).toEqual(categories);
    }
  });

  it('derives must-not-commit git pathspecs from the same policy', () => {
    expect(generatedArtifactPathspecs(C.mustNotCommit)).toEqual([
      'examples/*/src/generated/**',
      'site/src/generated/**',
      'site/tutorial/steps/*/src/generated/**',
      'packages/create-kovo/templates/graph.json',
    ]);
  });

  it('routes committed generated framework artifacts to their generator checks', () => {
    expect(
      generatedArtifactPoliciesForGenerator(GENERATED_ARTIFACT_GENERATORS.icons).map(
        (entry) => entry.id,
      ),
    ).toEqual(['icon-generated-components', 'icon-generated-package-metadata']);
    expect(generatedArtifactGeneratorCheckCommand(GENERATED_ARTIFACT_GENERATORS.icons)).toEqual([
      'pnpm',
      '--filter',
      '@kovojs/icons',
      'run',
      'build:icons',
      '--',
      '--check',
    ]);

    expect(
      generatedArtifactPoliciesForGenerator(GENERATED_ARTIFACT_GENERATORS.uiRegistry).map(
        (entry) => entry.id,
      ),
    ).toEqual(['headless-ui-generated-source', 'ui-generated-registry']);
    expect(
      generatedArtifactGeneratorCheckCommand(GENERATED_ARTIFACT_GENERATORS.uiRegistry),
    ).toEqual(['node', 'packages/ui/scripts/build-registry.mjs']);
  });

  it('validates readable generated emit artifacts against the shared contract', () => {
    expect(validateGeneratedEmitContract(validProdEmitFiles())).toEqual([]);
  });

  it('reports filename, readability, and source assertion drift from the shared contract', () => {
    const findings = validateGeneratedEmitContract([
      {
        fileName: 'routes/products/product-card.server.js',
        kind: 'server',
        source: '',
      },
      {
        fileName: 'routes/products/product-card.client.abcdef12.js',
        kind: 'client',
        source: 'export const ProductCard$button_click = handler;',
      },
      {
        fileName: 'generated/registries.d.ts',
        kind: 'registry',
        source: 'export {};',
      },
    ]);

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Expected emitted files'),
        expect.stringContaining('product-card.client.abcdef12.js'),
        expect.stringContaining('product-card.server.js must be a readable generated artifact'),
        expect.stringContaining('product-card.server.js missing stable source-derived handler'),
      ]),
    );
  });
});

function validProdEmitFiles() {
  return [
    {
      fileName: 'routes/products/product-card.server.js',
      kind: 'server',
      source:
        '<button on:click="/c/__v/0123456789abcdef-12345678/routes/products/product-card.client.js#ProductCard$button_click">Add</button>',
    },
    {
      fileName: 'routes/products/product-card.client.js',
      kind: 'client',
      source: 'export const ProductCard$button_click = handler;',
    },
    {
      fileName: 'generated/registries.d.ts',
      kind: 'registry',
      source: 'export interface Registries {}',
    },
  ];
}
