export const GENERATED_ARTIFACT_CATEGORIES = Object.freeze({
  appLocalGeneratedOutput: 'app_local_generated_output',
  frameworkGeneratedSource: 'framework_generated_source',
  generatedPackageMetadata: 'generated_package_metadata',
  mustNotCommit: 'must_not_commit',
  mustBeReadable: 'must_be_readable',
  mustMatchGenerator: 'must_match_generator',
  mustMatchEmitContract: 'must_match_emit_contract',
});

export const GENERATED_ARTIFACT_GENERATORS = Object.freeze({
  icons: 'icons',
  uiRegistry: 'ui-registry',
  prodEmit: 'prod-emit',
});

export const generatedArtifactInventory = Object.freeze([
  {
    id: 'example-app-local-generated',
    categories: Object.freeze([
      GENERATED_ARTIFACT_CATEGORIES.appLocalGeneratedOutput,
      GENERATED_ARTIFACT_CATEGORIES.mustNotCommit,
    ]),
    gitPathspecs: Object.freeze(['examples/*/src/generated/**']),
    pathPatterns: Object.freeze([/^examples\/[^/]+\/src\/generated\//]),
    spec: 'SPEC.md §5.2 rule 8',
  },
  {
    id: 'site-app-local-generated',
    categories: Object.freeze([
      GENERATED_ARTIFACT_CATEGORIES.appLocalGeneratedOutput,
      GENERATED_ARTIFACT_CATEGORIES.mustNotCommit,
    ]),
    gitPathspecs: Object.freeze(['site/src/generated/**']),
    pathPatterns: Object.freeze([/^site\/src\/generated\//]),
    spec: 'SPEC.md §5.2 rule 8',
  },
  {
    id: 'tutorial-app-local-generated',
    categories: Object.freeze([
      GENERATED_ARTIFACT_CATEGORIES.appLocalGeneratedOutput,
      GENERATED_ARTIFACT_CATEGORIES.mustNotCommit,
    ]),
    gitPathspecs: Object.freeze(['site/tutorial/steps/*/src/generated/**']),
    pathPatterns: Object.freeze([/^site\/tutorial\/steps\/[^/]+\/src\/generated\//]),
    spec: 'SPEC.md §5.2 rule 8',
  },
  {
    id: 'create-kovo-template-graph',
    categories: Object.freeze([
      GENERATED_ARTIFACT_CATEGORIES.appLocalGeneratedOutput,
      GENERATED_ARTIFACT_CATEGORIES.mustNotCommit,
    ]),
    gitPathspecs: Object.freeze(['packages/create-kovo/templates/graph.json']),
    pathPatterns: Object.freeze([/^packages\/create-kovo\/templates\/graph\.json$/]),
    spec: 'SPEC.md §5.2 rule 8',
  },
  {
    id: 'icon-generated-components',
    categories: Object.freeze([
      GENERATED_ARTIFACT_CATEGORIES.frameworkGeneratedSource,
      GENERATED_ARTIFACT_CATEGORIES.mustMatchGenerator,
    ]),
    generatorId: GENERATED_ARTIFACT_GENERATORS.icons,
    generatorCheckCommand: Object.freeze([
      'pnpm',
      '--filter',
      '@kovojs/icons',
      'run',
      'build:icons',
      '--',
      '--check',
    ]),
    pathPatterns: Object.freeze([/^packages\/icons\/src\/[^/]+\.tsx$/]),
    spec: 'SPEC.md §5.2 rules 7-8',
  },
  {
    id: 'icon-generated-package-metadata',
    categories: Object.freeze([
      GENERATED_ARTIFACT_CATEGORIES.generatedPackageMetadata,
      GENERATED_ARTIFACT_CATEGORIES.mustMatchGenerator,
    ]),
    generatorId: GENERATED_ARTIFACT_GENERATORS.icons,
    generatorCheckCommand: Object.freeze([
      'pnpm',
      '--filter',
      '@kovojs/icons',
      'run',
      'build:icons',
      '--',
      '--check',
    ]),
    pathPatterns: Object.freeze([/^packages\/icons\/package\.json$/, /^public-packages\.json$/]),
    spec: 'rules/api-surface.md distribution metadata',
  },
  {
    id: 'headless-ui-generated-source',
    categories: Object.freeze([
      GENERATED_ARTIFACT_CATEGORIES.frameworkGeneratedSource,
      GENERATED_ARTIFACT_CATEGORIES.mustMatchGenerator,
    ]),
    generatorId: GENERATED_ARTIFACT_GENERATORS.uiRegistry,
    generatorCheckCommand: Object.freeze(['node', 'packages/ui/scripts/build-registry.mjs']),
    pathPatterns: Object.freeze([/^packages\/headless-ui\/src\/generated\.ts$/]),
    spec: 'SPEC.md §5.2 rules 7-8',
  },
  {
    id: 'gallery-primitive-actions-generated-source',
    categories: Object.freeze([
      GENERATED_ARTIFACT_CATEGORIES.frameworkGeneratedSource,
      GENERATED_ARTIFACT_CATEGORIES.mustMatchGenerator,
    ]),
    generatorId: GENERATED_ARTIFACT_GENERATORS.uiRegistry,
    generatorCheckCommand: Object.freeze(['node', 'packages/ui/scripts/build-registry.mjs']),
    pathPatterns: Object.freeze([/^examples\/gallery\/src\/primitive-actions\.generated\.ts$/]),
    spec: 'SPEC.md §5.2 rules 7-8',
  },
  {
    id: 'ui-generated-registry',
    categories: Object.freeze([
      GENERATED_ARTIFACT_CATEGORIES.generatedPackageMetadata,
      GENERATED_ARTIFACT_CATEGORIES.mustMatchGenerator,
    ]),
    generatorId: GENERATED_ARTIFACT_GENERATORS.uiRegistry,
    generatorCheckCommand: Object.freeze(['node', 'packages/ui/scripts/build-registry.mjs']),
    pathPatterns: Object.freeze([/^packages\/ui\/registry\.json$/]),
    spec: 'rules/api-surface.md starter/package metadata',
  },
  {
    id: 'component-server-module',
    categories: Object.freeze([
      GENERATED_ARTIFACT_CATEGORIES.frameworkGeneratedSource,
      GENERATED_ARTIFACT_CATEGORIES.mustBeReadable,
      GENERATED_ARTIFACT_CATEGORIES.mustMatchEmitContract,
    ]),
    generatorId: GENERATED_ARTIFACT_GENERATORS.prodEmit,
    pathPatterns: Object.freeze([/^.+\.server\.js$/]),
    emitKind: 'server',
    spec: 'SPEC.md §5.2 rules 2-3, 7',
  },
  {
    id: 'component-client-module',
    categories: Object.freeze([
      GENERATED_ARTIFACT_CATEGORIES.frameworkGeneratedSource,
      GENERATED_ARTIFACT_CATEGORIES.mustBeReadable,
      GENERATED_ARTIFACT_CATEGORIES.mustMatchEmitContract,
    ]),
    generatorId: GENERATED_ARTIFACT_GENERATORS.prodEmit,
    pathPatterns: Object.freeze([/^.+\.client\.js$/]),
    emitKind: 'client',
    spec: 'SPEC.md §5.2 rules 2-3, 7',
  },
  {
    id: 'generated-registry-declaration',
    categories: Object.freeze([
      GENERATED_ARTIFACT_CATEGORIES.generatedPackageMetadata,
      GENERATED_ARTIFACT_CATEGORIES.mustBeReadable,
      GENERATED_ARTIFACT_CATEGORIES.mustMatchEmitContract,
    ]),
    generatorId: GENERATED_ARTIFACT_GENERATORS.prodEmit,
    pathPatterns: Object.freeze([/^generated\/registries\.d\.ts$/]),
    emitKind: 'registry',
    spec: 'SPEC.md §5.2 rules 3, 6-8',
  },
]);

export const generatedProdEmitInput = Object.freeze({
  fileName: 'routes/products/product-card.tsx',
  source: `
import { component } from '@kovojs/core';

export const ProductCard = component({
  render: () => (
    <article>
      <button onClick={() => addToCart(product.id)}>Add</button>
    </article>
  ),
});
`,
});

export const generatedProdEmitContract = Object.freeze({
  expectedFileNames: Object.freeze([
    'routes/products/product-card.server.js',
    'routes/products/product-card.client.js',
    'generated/registries.d.ts',
  ]),
  disallowedFileNamePattern: /chunk|[a-f0-9]{8,}/i,
  artifacts: Object.freeze([
    {
      fileName: 'routes/products/product-card.server.js',
      kind: 'server',
      categories: Object.freeze([
        GENERATED_ARTIFACT_CATEGORIES.mustBeReadable,
        GENERATED_ARTIFACT_CATEGORIES.mustMatchEmitContract,
      ]),
      sourceAssertions: Object.freeze([
        {
          label: 'stable source-derived handler module URL',
          pattern:
            /on:click="\/c\/__v\/[0-9a-f]{16}-[0-9a-f]{64}\/routes\/products\/product-card\.client\.js#ProductCard\$button_click"/,
        },
      ]),
    },
    {
      fileName: 'routes/products/product-card.client.js',
      kind: 'client',
      categories: Object.freeze([
        GENERATED_ARTIFACT_CATEGORIES.mustBeReadable,
        GENERATED_ARTIFACT_CATEGORIES.mustMatchEmitContract,
      ]),
      sourceAssertions: Object.freeze([
        {
          label: 'stable source-derived handler export',
          pattern: /export const ProductCard\$button_click = securityHandler/,
        },
      ]),
    },
    {
      fileName: 'generated/registries.d.ts',
      kind: 'registry',
      categories: Object.freeze([
        GENERATED_ARTIFACT_CATEGORIES.mustBeReadable,
        GENERATED_ARTIFACT_CATEGORIES.mustMatchEmitContract,
      ]),
      sourceAssertions: Object.freeze([]),
    },
  ]),
});

export function generatedArtifactPoliciesForCategory(category) {
  return generatedArtifactInventory.filter((entry) => entry.categories.includes(category));
}

export function generatedArtifactPoliciesForGenerator(generatorId) {
  return generatedArtifactInventory.filter((entry) => entry.generatorId === generatorId);
}

export function generatedArtifactGeneratorCheckCommand(generatorId) {
  const commandsByKey = new Map();
  for (const command of generatedArtifactPoliciesForGenerator(generatorId)
    .map((entry) => entry.generatorCheckCommand)
    .filter(Boolean)) {
    commandsByKey.set(JSON.stringify(command), command);
  }
  const commands = [...commandsByKey.values()];
  if (commands.length === 0) return null;
  if (commands.length > 1) {
    throw new Error(`Generated artifact generator ${generatorId} has conflicting check commands`);
  }
  return commands[0];
}

export function generatedArtifactPathspecs(category) {
  return generatedArtifactPoliciesForCategory(category).flatMap(
    (entry) => entry.gitPathspecs ?? [],
  );
}

export function classifyGeneratedArtifactPath(fileName) {
  const normalized = normalizePath(fileName);
  return generatedArtifactInventory.filter((entry) =>
    (entry.pathPatterns ?? []).some((pattern) => pattern.test(normalized)),
  );
}

export function generatedArtifactCategoriesForPath(fileName) {
  return uniqueInOrder(
    classifyGeneratedArtifactPath(fileName).flatMap((entry) => entry.categories),
  );
}

export function generatedArtifactPathsInCategory(files, category) {
  return files.filter((file) => generatedArtifactCategoriesForPath(file).includes(category));
}

export function isGeneratedArtifactPathInCategory(fileName, category) {
  return generatedArtifactCategoriesForPath(fileName).includes(category);
}

export function validateGeneratedEmitContract(files, contract = generatedProdEmitContract) {
  const findings = [];
  const actualFileNames = files.map((file) => file.fileName);
  if (!sameArray(actualFileNames, contract.expectedFileNames)) {
    findings.push(
      `Expected emitted files ${JSON.stringify(contract.expectedFileNames)}, got ${JSON.stringify(
        actualFileNames,
      )}`,
    );
  }

  for (const file of files) {
    if (contract.disallowedFileNamePattern?.test(file.fileName)) {
      findings.push(
        `Emitted file name must stay source-derived without chunks or hashes: ${file.fileName}`,
      );
    }
  }

  const filesByName = new Map(files.map((file) => [file.fileName, file]));
  for (const expected of contract.artifacts) {
    const file = filesByName.get(expected.fileName);
    if (!file) continue;

    const categories = generatedArtifactCategoriesForPath(expected.fileName);
    for (const category of expected.categories ?? []) {
      if (!categories.includes(category)) {
        findings.push(`${expected.fileName} is not classified as ${category}`);
      }
    }

    if (expected.kind && file.kind !== expected.kind) {
      findings.push(`${expected.fileName} expected kind ${expected.kind}, got ${file.kind}`);
    }

    if (
      (expected.categories ?? []).includes(GENERATED_ARTIFACT_CATEGORIES.mustBeReadable) &&
      !isReadableGeneratedSource(file.source)
    ) {
      findings.push(`${expected.fileName} must be a readable generated artifact`);
    }

    for (const assertion of expected.sourceAssertions ?? []) {
      if (!assertion.pattern.test(file.source ?? '')) {
        findings.push(`${expected.fileName} missing ${assertion.label}`);
      }
    }
  }

  return findings;
}

function normalizePath(fileName) {
  return fileName.replace(/\\/g, '/').replace(/^\.?\//, '');
}

function uniqueInOrder(values) {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isReadableGeneratedSource(source) {
  return typeof source === 'string' && source.trim().length > 0 && !source.includes('\0');
}
