export const GENERATED_ARTIFACT_CATEGORIES = Object.freeze({
  mustNotCommit: 'must_not_commit',
  mustBeReadable: 'must_be_readable',
  mustMatchEmitContract: 'must_match_emit_contract',
});

export const generatedArtifactInventory = Object.freeze([
  {
    id: 'example-app-local-generated',
    categories: Object.freeze([GENERATED_ARTIFACT_CATEGORIES.mustNotCommit]),
    gitPathspecs: Object.freeze(['examples/*/src/generated/**']),
    pathPatterns: Object.freeze([/^examples\/[^/]+\/src\/generated\//]),
    spec: 'SPEC.md §5.2 rule 8',
  },
  {
    id: 'site-app-local-generated',
    categories: Object.freeze([GENERATED_ARTIFACT_CATEGORIES.mustNotCommit]),
    gitPathspecs: Object.freeze(['site/src/generated/**']),
    pathPatterns: Object.freeze([/^site\/src\/generated\//]),
    spec: 'SPEC.md §5.2 rule 8',
  },
  {
    id: 'tutorial-app-local-generated',
    categories: Object.freeze([GENERATED_ARTIFACT_CATEGORIES.mustNotCommit]),
    gitPathspecs: Object.freeze(['site/tutorial/steps/*/src/generated/**']),
    pathPatterns: Object.freeze([/^site\/tutorial\/steps\/[^/]+\/src\/generated\//]),
    spec: 'SPEC.md §5.2 rule 8',
  },
  {
    id: 'create-kovo-template-graph',
    categories: Object.freeze([GENERATED_ARTIFACT_CATEGORIES.mustNotCommit]),
    gitPathspecs: Object.freeze(['packages/create-kovo/templates/graph.json']),
    pathPatterns: Object.freeze([/^packages\/create-kovo\/templates\/graph\.json$/]),
    spec: 'SPEC.md §5.2 rule 8',
  },
  {
    id: 'component-server-module',
    categories: Object.freeze([
      GENERATED_ARTIFACT_CATEGORIES.mustBeReadable,
      GENERATED_ARTIFACT_CATEGORIES.mustMatchEmitContract,
    ]),
    pathPatterns: Object.freeze([/^.+\.server\.js$/]),
    emitKind: 'server',
    spec: 'SPEC.md §5.2 rules 2-3, 7',
  },
  {
    id: 'component-client-module',
    categories: Object.freeze([
      GENERATED_ARTIFACT_CATEGORIES.mustBeReadable,
      GENERATED_ARTIFACT_CATEGORIES.mustMatchEmitContract,
    ]),
    pathPatterns: Object.freeze([/^.+\.client\.js$/]),
    emitKind: 'client',
    spec: 'SPEC.md §5.2 rules 2-3, 7',
  },
  {
    id: 'generated-registry-declaration',
    categories: Object.freeze([
      GENERATED_ARTIFACT_CATEGORIES.mustBeReadable,
      GENERATED_ARTIFACT_CATEGORIES.mustMatchEmitContract,
    ]),
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
            /on:click="\/c\/__v\/[0-9a-f]{16}-[0-9a-f]{8}\/routes\/products\/product-card\.client\.js#ProductCard\$button_click"/,
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
          pattern: /export const ProductCard\$button_click = handler/,
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
