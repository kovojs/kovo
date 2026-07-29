#!/usr/bin/env node
// Checks or writes the generated UI/headless/gallery manifest artifacts.
//
// The manifest in primitive-component-manifest.mjs owns the ordered component catalog,
// interactive browser fixture list, headless primitive handler ABI groups, headless
// public facades, and headless package/API-boundary metadata. This script derives the
// residual copy-in metadata from source and keeps every checked-in registry surface
// round-trip checked:
//   node packages/ui/scripts/build-registry.mjs            # check (default)
//   node packages/ui/scripts/build-registry.mjs --write    # rewrite generated artifacts

import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import {
  COMPONENT_CATALOG_SCHEMA,
  validateComponentCatalogDocument,
} from '../../../scripts/component-catalog-schema.mjs';
import { primitiveComponentManifest } from './primitive-component-manifest.mjs';

const pkgRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = path.resolve(pkgRoot, '../..');
const uiSrcDir = path.join(pkgRoot, 'src');
const headlessRoot = path.join(repoRoot, 'packages/headless-ui');
const compilerRoot = path.join(repoRoot, 'packages/compiler');
const coreRoot = path.join(repoRoot, 'packages/core');
const galleryRoot = path.join(repoRoot, 'examples/gallery');
const publicPackagesPath = path.join(repoRoot, 'public-packages.json');
const componentsGuidePath = path.join(repoRoot, 'site', 'content', 'guides', 'components.md');

const registryGuideStartMarker = '<!-- GENERATED:ui-registry-copy:start -->';
const registryGuideEndMarker = '<!-- GENERATED:ui-registry-copy:end -->';

const generatedSourceComment =
  '// Generated from packages/ui/scripts/primitive-component-manifest.mjs. Run `node packages/ui/scripts/build-registry.mjs --write`.';

const paths = {
  galleryBrowserFixtureManifest: path.join(
    galleryRoot,
    'src',
    'interactive-gallery.browser-manifest.ts',
  ),
  galleryComponentCatalog: path.join(galleryRoot, 'src', 'component-catalog.ts'),
  galleryComponentManifest: path.join(galleryRoot, 'src', 'gallery-component-manifest.ts'),
  galleryPrimitiveActions: path.join(galleryRoot, 'src', 'primitive-actions.ts'),
  galleryPrimitiveActionsGenerated: path.join(galleryRoot, 'src', 'primitive-actions.generated.ts'),
  headlessClientHelperAbi: path.join(headlessRoot, 'src', 'client-helper-abi.ts'),
  headlessGenerated: path.join(headlessRoot, 'src', 'generated.ts'),
  compilerHeadlessClientExecutables: path.join(
    compilerRoot,
    'src',
    'generated',
    'headless-ui-client-executables.ts',
  ),
  coreHeadlessClientExecutableIdentities: path.join(
    coreRoot,
    'src',
    'internal',
    'generated-headless-client-executable-identities.ts',
  ),
  headlessPackageJson: path.join(headlessRoot, 'package.json'),
  headlessPublicDir: path.join(headlessRoot, 'src', 'public'),
  headlessRuntimeHelperAudit: path.join(headlessRoot, 'runtime-helper-audit.json'),
  headlessTransitionAbiAudit: path.join(headlessRoot, 'transition-abi-audit.json'),
  uiCatalog: path.join(pkgRoot, 'catalog.json'),
  uiRegistry: path.join(pkgRoot, 'registry.json'),
  componentsGuide: componentsGuidePath,
};

const allowedArgs = new Set(['--write']);
const unknownArg = process.argv.slice(2).find((arg) => !allowedArgs.has(arg));
if (unknownArg) {
  console.error(`Unknown option ${unknownArg}`);
  process.exit(2);
}

const writeMode = process.argv.includes('--write');
const manifestComponents = componentManifestEntries();
const headlessPrimitiveSubpaths = primitiveComponentManifest.headlessPrimitives.map(
  (primitive) => primitive.subpath,
);
const uiDistributionMode = uiPackageDistributionMode();
const generatedUiRegistry = generateUiRegistry();
const generatedUiCatalog = generateUiCatalog();
const generatedTargets = [
  {
    compare: 'json',
    label: 'packages/ui/catalog.json',
    path: paths.uiCatalog,
    source: `${JSON.stringify(generatedUiCatalog, null, 2)}\n`,
  },
  {
    compare: 'json',
    label: 'packages/ui/registry.json',
    path: paths.uiRegistry,
    source: `${JSON.stringify(generatedUiRegistry, null, 2)}\n`,
  },
  {
    compare: 'text',
    label: 'public-packages.json',
    path: publicPackagesPath,
    source: generatePublicPackagesJson(),
  },
  {
    compare: 'text',
    label: 'site/content/guides/components.md',
    path: paths.componentsGuide,
    source: generateComponentsGuide(),
  },
  {
    compare: 'text',
    label: 'packages/headless-ui/src/generated.ts',
    path: paths.headlessGenerated,
    source: generateHeadlessGeneratedTs(),
  },
  {
    compare: 'json',
    label: 'packages/headless-ui/runtime-helper-audit.json',
    path: paths.headlessRuntimeHelperAudit,
    source: `${JSON.stringify(generateHeadlessRuntimeHelperAudit(), null, 2)}\n`,
  },
  {
    compare: 'json',
    label: 'packages/headless-ui/transition-abi-audit.json',
    path: paths.headlessTransitionAbiAudit,
    source: `${JSON.stringify(generateHeadlessTransitionAbiAudit(), null, 2)}\n`,
  },
  {
    compare: 'text',
    label: 'packages/compiler/src/generated/headless-ui-client-executables.ts',
    path: paths.compilerHeadlessClientExecutables,
    source: generateCompilerHeadlessClientExecutablesTs(),
  },
  {
    compare: 'text',
    label: 'packages/core/src/internal/generated-headless-client-executable-identities.ts',
    path: paths.coreHeadlessClientExecutableIdentities,
    source: generateCoreHeadlessClientExecutableIdentitiesTs(),
  },
  {
    compare: 'json',
    label: 'packages/headless-ui/package.json',
    path: paths.headlessPackageJson,
    source: generateHeadlessPackageJson(),
  },
  ...generateHeadlessPublicFacadeTargets(),
  {
    compare: 'text',
    label: 'examples/gallery/src/primitive-actions.ts',
    path: paths.galleryPrimitiveActions,
    source: generateGalleryPrimitiveActionsTs(),
  },
  {
    compare: 'text',
    label: 'examples/gallery/src/primitive-actions.generated.ts',
    path: paths.galleryPrimitiveActionsGenerated,
    source: generateGalleryGeneratedPrimitiveActionsTs(),
  },
  {
    compare: 'text',
    label: 'examples/gallery/src/gallery-component-manifest.ts',
    path: paths.galleryComponentManifest,
    source: generateGalleryComponentManifestTs(),
  },
  {
    compare: 'typescript',
    label: 'examples/gallery/src/component-catalog.ts',
    path: paths.galleryComponentCatalog,
    source: generateGalleryComponentCatalogTs(),
  },
  {
    compare: 'text',
    label: 'examples/gallery/src/interactive-gallery.browser-manifest.ts',
    path: paths.galleryBrowserFixtureManifest,
    source: generateGalleryBrowserFixtureManifestTs(),
  },
];

const validationFindings = validateManifestDrift();
const targetFindings = [];
const staleGeneratedTargets = staleHeadlessPublicFacadeTargets();

for (const target of generatedTargets) {
  if (writeMode) {
    writeFileSync(target.path, target.source);
    console.log(`Wrote ${target.label}.`);
  } else if (!targetMatchesFile(target)) {
    targetFindings.push(`${target.label} is out of date`);
  }
}

for (const target of staleGeneratedTargets) {
  if (writeMode) {
    unlinkSync(target.path);
    console.log(`Removed ${target.label}.`);
  } else {
    targetFindings.push(`${target.label} is stale`);
  }
}

if (validationFindings.length || targetFindings.length) {
  console.error('primitive/component manifest findings:');
  for (const finding of [...validationFindings, ...targetFindings]) {
    console.error(`  - ${finding}`);
  }
  if (!writeMode && targetFindings.length) {
    console.error('Run: node packages/ui/scripts/build-registry.mjs --write');
  }
  process.exit(validationFindings.length ? 2 : 1);
}

if (!writeMode) {
  console.log(
    `ui/headless/gallery manifest artifacts are up to date (${manifestComponents.length} components, ${primitiveComponentManifest.headlessPrimitives.length} headless primitives).`,
  );
}

/** Deterministic string sort (explicit comparator for the repo lint rule). */
function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function componentManifestEntries() {
  return primitiveComponentManifest.components.map((entry) => ({
    ...entry,
    demoFunction: `${pascalCase(entry.component)}Demo`,
    path: `/components/${entry.component}`,
    visualFixture: `${entry.component}.html.txt`,
  }));
}

function uiPackageDistributionMode() {
  const manifest = JSON.parse(readFileSync(publicPackagesPath, 'utf8'));
  const uiPackage = manifest.packages?.find((entry) => entry.name === '@kovojs/ui');
  if (uiPackage?.distributionMode !== 'package-and-copy-in') {
    throw new Error(
      'public-packages.json must declare @kovojs/ui distributionMode "package-and-copy-in"',
    );
  }
  return uiPackage.distributionMode;
}

function generateUiRegistryJson() {
  const components = [];
  const findings = [];
  const manifestNames = new Set(manifestComponents.map((entry) => entry.component));
  const sourceComponentNames = new Set(uiSourceComponentNames());

  for (const name of sorted(sourceComponentNames)) {
    if (!manifestNames.has(name)) {
      findings.push(`${name}.tsx exists in @kovojs/ui but is missing from the manifest`);
    }
  }

  for (const entry of manifestComponents) {
    const name = entry.component;
    const file = `${name}.tsx`;
    if (!sourceComponentNames.has(name)) {
      findings.push(`${file} is declared in the manifest but missing from @kovojs/ui`);
      continue;
    }

    const source = readFileSync(path.join(uiSrcDir, file), 'utf8');
    const imports = parseImports(source);
    const exportedComponents = parseExportedComponents(source);
    const exportedLeafNames = new Set(exportedComponents.map(bindingToLeafName));

    const headlessUiSymbols = new Set();
    const styleSymbols = new Set();
    const serverSymbols = new Set();
    const coreSymbols = new Set();
    const iconsSymbols = new Set();
    const uiComponents = new Set();
    const otherDeps = new Set();

    for (const { module, symbols } of imports) {
      if (module === '@kovojs/headless-ui' || module.startsWith('@kovojs/headless-ui/')) {
        symbols.forEach((symbol) => headlessUiSymbols.add(symbol));
      } else if (module === '@kovojs/style') {
        if (symbols.length > 0) {
          symbols.forEach((symbol) => styleSymbols.add(symbol));
        } else {
          styleSymbols.add('*');
        }
      } else if (module === '@kovojs/server') {
        symbols.forEach((symbol) => serverSymbols.add(symbol));
      } else if (module === '@kovojs/core') {
        symbols.forEach((symbol) => coreSymbols.add(symbol));
      } else if (module === '@kovojs/icons' || module.startsWith('@kovojs/icons/')) {
        symbols.forEach((symbol) => iconsSymbols.add(symbol));
      } else if (module === '@kovojs/ui' || module.startsWith('@kovojs/ui/')) {
        findings.push(`${file}: imports @kovojs/ui itself (${module}) - not copy-in safe`);
        otherDeps.add(module);
      } else if (module.startsWith('./') || module.startsWith('../')) {
        uiComponents.add(module.replace(/^\.\//, '').replace(/\.(tsx|ts|js)$/, ''));
      } else if (module.startsWith('@kovojs/')) {
        if (!PUBLIC_KOVO_DEPS.has(module)) {
          findings.push(`${file}: imports non-allowlisted @kovojs package ${module}`);
          otherDeps.add(module);
        }
      }
    }

    if (!exportedComponents.length) {
      findings.push(`${file}: does not export any component({ ... }) definitions`);
    } else if (!exportedLeafNames.has(name)) {
      findings.push(
        `${file}: registry name "${name}" is not derived from an exported component binding (${sorted(
          exportedComponents,
        ).join(', ')})`,
      );
    }

    const sourceParts = componentParts(name, exportedComponents);
    if (!sameArray(entry.parts, sourceParts)) {
      findings.push(
        `${file}: manifest parts ${JSON.stringify(entry.parts)} do not match exported component anatomy ${JSON.stringify(sourceParts)}`,
      );
    }

    components.push({
      anatomy: {
        ids: entry.ids,
        parts: entry.parts,
        slots: entry.slots,
        stateInputs: entry.stateInputs,
      },
      enhancement: {
        accessibility: entry.accessibility,
        keyboard: entry.keyboardBehavior,
        roles: entry.roles,
        tier: entry.enhancementTier,
      },
      name,
      title: exportedComponents[0] ?? pascalCase(name),
      files: [`src/${file}`],
      exports: exportedComponents,
      dependencies: {
        '@kovojs/headless-ui': sorted(headlessUiSymbols),
        ...(styleSymbols.size ? { '@kovojs/style': sorted(styleSymbols) } : {}),
        ...(coreSymbols.size ? { '@kovojs/core': sorted(coreSymbols) } : {}),
        ...(serverSymbols.size ? { '@kovojs/server': sorted(serverSymbols) } : {}),
        ...(iconsSymbols.size ? { '@kovojs/icons': sorted(iconsSymbols) } : {}),
        ...(otherDeps.size ? { other: sorted(otherDeps) } : {}),
      },
      uiComponents: sorted(uiComponents),
    });
  }

  if (findings.length) {
    throw new Error(`Unable to generate packages/ui/registry.json:\n${findings.join('\n')}`);
  }

  const registryDependencies = orderedPublicPackageNames(
    new Set(
      components.flatMap((component) =>
        Object.keys(component.dependencies).filter((dependency) => dependency !== 'other'),
      ),
    ),
  );

  return {
    $comment: uiRegistryComment({
      components,
      registryDependencies,
    }),
    distributionMode: uiDistributionMode,
    registryDependencies,
    components,
  };
}

function generateUiRegistry() {
  return generateUiRegistryJson();
}

function generateUiCatalog() {
  const entries = manifestComponents
    .map((entry) => ({
      anatomy: {
        ids: entry.ids,
        parts: entry.parts,
        slots: entry.slots,
        stateInputs: entry.stateInputs,
      },
      copyCommand: `kovo add ${entry.component}`,
      enhancement: {
        accessibility: entry.accessibility,
        keyboard: entry.keyboardBehavior,
        roles: entry.roles,
        tier: entry.enhancementTier,
      },
      headlessImport: headlessPrimitiveSubpaths.includes(entry.component)
        ? `@kovojs/headless-ui/${entry.component}`
        : null,
      id: `component:${entry.component}`,
      kind: 'component',
      name: entry.component,
      packageImport: `@kovojs/ui/${entry.component}`,
      searchText: [
        entry.component,
        entry.title,
        entry.summary,
        `@kovojs/ui/${entry.component}`,
        `kovo add ${entry.component}`,
        ...entry.parts,
        ...entry.roles,
        entry.keyboardBehavior,
        entry.accessibility,
      ].join(' '),
      summary: entry.summary,
      title: entry.title,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const document = {
    schema: COMPONENT_CATALOG_SCHEMA,
    owner: '@kovojs/ui',
    entries,
  };
  const findings = validateComponentCatalogDocument(document);
  if (findings.length > 0) {
    throw new Error(`Unable to generate packages/ui/catalog.json:\n${findings.join('\n')}`);
  }
  return document;
}

function generateComponentsGuide() {
  const current = readFileSync(paths.componentsGuide, 'utf8');
  return replaceMarkedSection(
    current,
    registryGuideStartMarker,
    registryGuideEndMarker,
    uiRegistryGuideSnippet({
      components: generatedUiRegistry.components,
      registryDependencies: generatedUiRegistry.registryDependencies,
    }),
  );
}

function uiRegistryComment({ components, registryDependencies }) {
  return [
    `Generated copy-in registry for @kovojs/ui. public-packages.json declares distributionMode "${uiDistributionMode}", so apps can install versioned @kovojs/ui/<component> subpaths or copy component TSX into app-owned source with kovo add.`,
    `registryDependencies lists the public packages copied source may import: ${formatPackageList(registryDependencies)}.`,
    `dependencies records the exact imported symbols per package, uiComponents lists sibling files to copy, and anatomy/enhancement metadata records manifest-owned ids, parts, slots, state inputs, roles, keyboard behavior, and enhancement tier for all ${components.length} components.`,
    'Regenerate with `node packages/ui/scripts/build-registry.mjs --write`.',
  ].join(' ');
}

function uiRegistryGuideSnippet({ components, registryDependencies }) {
  return [
    'The package ships a machine-readable manifest, `packages/ui/registry.json`, listing every component:',
    'its source file(s), exported symbols, and the exact public package symbols it imports (plus any',
    'sibling files to copy alongside it). `public-packages.json` declares `@kovojs/ui` distribution',
    `mode as \`${uiDistributionMode}\`, so the generated registry records both the package-managed and copy-in`,
    `paths from the same source of truth. The current registry spans ${components.length} components,`,
    'tracks anatomy, enhancement, keyboard, and accessibility metadata for every component, and',
    `limits copied source imports to ${formatPackageList(registryDependencies)}. This is the data`,
    '`kovo add <component>` consumes to copy a component and its dependencies into your app. It is',
    'also enforced: a copy-in smoke test typechecks representative components against the public',
    'packages alone, so a component cannot start depending on a non-public symbol without the build',
    'catching it.',
  ].join('\n');
}

function formatPackageList(packageNames) {
  if (packageNames.length === 1) {
    return `\`${packageNames[0]}\``;
  }
  if (packageNames.length === 2) {
    return `\`${packageNames[0]}\` and \`${packageNames[1]}\``;
  }
  return `${packageNames
    .slice(0, -1)
    .map((name) => `\`${name}\``)
    .join(', ')}, and \`${packageNames.at(-1)}\``;
}

function orderedPublicPackageNames(packageNames) {
  const manifest = JSON.parse(readFileSync(publicPackagesPath, 'utf8'));
  const packages = manifest.packages ?? [];
  const ordered = [];
  for (const entry of packages) {
    if (!packageNames.has(entry.name)) {
      continue;
    }
    if (entry.visibility !== 'public') {
      throw new Error(
        `UI registry dependency ${entry.name} must be public in public-packages.json`,
      );
    }
    ordered.push(entry.name);
    packageNames.delete(entry.name);
  }
  if (packageNames.size > 0) {
    throw new Error(
      `UI registry dependency metadata missing from public-packages.json: ${sorted(packageNames).join(', ')}`,
    );
  }
  return ordered;
}

function generatePublicPackagesJson() {
  const source = readFileSync(publicPackagesPath, 'utf8');
  const packageNameIndex = source.indexOf('"name": "@kovojs/headless-ui"');
  if (packageNameIndex === -1) {
    throw new Error('Unable to generate public-packages.json: missing @kovojs/headless-ui');
  }

  const packageObjectStart = source.lastIndexOf('{', packageNameIndex);
  if (packageObjectStart === -1) {
    throw new Error(
      'Unable to generate public-packages.json: missing @kovojs/headless-ui package object',
    );
  }
  const packageObjectEnd = matchingJsonObjectEnd(source, packageObjectStart);
  const packageSource = source.slice(packageObjectStart, packageObjectEnd + 1);
  const boundaryKeyIndex = packageSource.indexOf('"apiBoundary":');
  if (boundaryKeyIndex === -1) {
    throw new Error(
      'Unable to generate public-packages.json: missing @kovojs/headless-ui apiBoundary',
    );
  }

  const boundaryObjectStart = packageSource.indexOf('{', boundaryKeyIndex);
  if (boundaryObjectStart === -1) {
    throw new Error(
      'Unable to generate public-packages.json: missing @kovojs/headless-ui apiBoundary object',
    );
  }
  const boundaryObjectEnd = matchingJsonObjectEnd(packageSource, boundaryObjectStart);

  const absoluteBoundaryKeyIndex = packageObjectStart + boundaryKeyIndex;
  const absoluteBoundaryObjectEnd = packageObjectStart + boundaryObjectEnd;

  return [
    source.slice(0, absoluteBoundaryKeyIndex),
    formatHeadlessApiBoundaryProperty('      '),
    source.slice(absoluteBoundaryObjectEnd + 1),
  ].join('');
}

function formatHeadlessApiBoundaryProperty(indent) {
  const boundary = headlessApiBoundary();
  const publicSubpaths = boundary.public.map((subpath, index) => {
    const suffix = index === boundary.public.length - 1 ? '' : ',';
    return `${indent}    ${JSON.stringify(subpath)}${suffix}`;
  });
  return [
    '"apiBoundary": {',
    `${indent}  "public": [`,
    ...publicSubpaths,
    `${indent}  ],`,
    `${indent}  "generated": ${formatInlineJsonArray(boundary.generated)},`,
    `${indent}  "internal": ${formatInlineJsonArray(boundary.internal)}`,
    `${indent}}`,
  ].join('\n');
}

function headlessApiBoundary() {
  return {
    public: [...headlessPrimitiveSubpaths.map((subpath) => `./${subpath}`), './types'],
    generated: ['./generated'],
    internal: ['./internal', './internal/primitive'],
  };
}

function matchingJsonObjectEnd(source, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new Error('Unable to find matching JSON object boundary');
}

function formatInlineJsonArray(values) {
  return `[${values.map((value) => JSON.stringify(value)).join(', ')}]`;
}

function replaceMarkedSection(source, startMarker, endMarker, replacement) {
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(
      `Unable to update ${path.relative(repoRoot, paths.componentsGuide)}: missing ${startMarker}/${endMarker} markers`,
    );
  }
  const before = source.slice(0, startIndex + startMarker.length);
  const after = source.slice(endIndex);
  return `${before}\n\n${replacement}\n\n${after}`;
}

function generateHeadlessGeneratedTs() {
  const groups = primitiveComponentManifest.headlessPrimitives
    .filter((primitive) => primitiveDirectGeneratedCallables(primitive).length > 0)
    .map((primitive) =>
      formatNamedExport(
        primitiveDirectGeneratedCallables(primitive),
        `./primitives/${primitive.subpath}.js`,
      ),
    );
  const wrappedClientHelpers = primitiveComponentManifest.headlessPrimitives.flatMap(
    (primitive) => primitive.generatedClientHelperWrappers ?? [],
  );

  return [
    generatedSourceComment,
    '// Browser-callable ABI for compiler-emitted client modules. App-authored source must not import this subpath.',
    ...groups,
    ...(wrappedClientHelpers.length > 0
      ? [formatNamedExport(wrappedClientHelpers, './client-helper-abi.js')]
      : []),
    '',
  ].join('\n');
}

function generateCompilerHeadlessClientExecutablesTs() {
  const entries = primitiveComponentManifest.headlessPrimitives
    .filter((primitive) => primitiveClientCallables(primitive).length > 0)
    .map((primitive) => {
      const summaries = primitiveClientCallables(primitive).map((exportName) =>
        headlessClientCallableSummary(primitive, exportName),
      );
      return [
        '  {',
        `    moduleSpecifier: '@kovojs/headless-ui/${primitive.subpath}',`,
        formatGeneratedHandlerNames(primitiveClientCallables(primitive)),
        '    summaries: [',
        ...summaries.flatMap((summary) => [
          '      {',
          `        exportName: ${formatTypeScriptString(summary.exportName)},`,
          `        eventArgument: ${
            summary.eventArgument === undefined ? 'undefined' : summary.eventArgument
          },`,
          `        maxArguments: ${summary.maxArguments},`,
          `        minArguments: ${summary.minArguments},`,
          "        returnKind: 'plain-data',",
          '      },',
        ]),
        '    ],',
        '  },',
      ].join('\n');
    });

  return [
    generatedSourceComment,
    '// Exact authored-import identities that may normalize to the compiler-owned browser handler ABI.',
    'export const headlessUiClientExecutableImports = [',
    ...entries,
    '] as const;',
    '',
  ].join('\n');
}

function headlessClientCallableSummary(primitive, exportName) {
  const sourcePaths = [
    path.join(headlessRoot, 'src', 'primitives', `${primitive.subpath}.ts`),
    path.join(headlessRoot, 'src', 'primitives', 'browser-event.ts'),
  ];
  let declaration;
  for (const sourcePath of sourcePaths) {
    const sourceText = readFileSync(sourcePath, 'utf8');
    const sourceFile = ts.createSourceFile(
      sourcePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    declaration = sourceFile.statements.find(
      (statement) =>
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text === exportName &&
        statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
    );
    if (declaration) break;
  }
  if (!declaration || !ts.isFunctionDeclaration(declaration)) {
    throw new Error(
      `${primitive.subpath}: cannot derive exact client-callable signature for ${exportName}`,
    );
  }
  const parameters = [...declaration.parameters];
  if (parameters.some((parameter) => parameter.dotDotDotToken !== undefined)) {
    throw new Error(
      `${primitive.subpath}#${exportName}: rest parameters are not finite-summary ABI`,
    );
  }
  const firstParameter = parameters[0];
  const eventArgument =
    firstParameter && ts.isIdentifier(firstParameter.name) && firstParameter.name.text === 'event'
      ? 0
      : undefined;
  return {
    eventArgument,
    exportName,
    maxArguments: parameters.length,
    minArguments: parameters.filter(
      (parameter) => parameter.questionToken === undefined && parameter.initializer === undefined,
    ).length,
  };
}

function generateCoreHeadlessClientExecutableIdentitiesTs() {
  const entries = primitiveComponentManifest.headlessPrimitives.flatMap((primitive) =>
    primitiveClientCallables(primitive).map((exportName) => {
      const formattedExportName = formatTypeScriptString(exportName);
      const specifier = `'@kovojs/headless-ui/${primitive.subpath}'`;
      const inline = `  { exportName: ${formattedExportName}, specifier: ${specifier} },`;
      return inline.length <= 100
        ? inline
        : [
            '  {',
            `    exportName: ${formattedExportName},`,
            `    specifier: ${specifier},`,
            '  },',
          ].join('\n');
    }),
  );

  return [
    generatedSourceComment,
    '// Exact Headless UI browser-callable identities consumed by the framework provenance resolver.',
    'export const generatedHeadlessClientExecutableIdentities = [',
    ...entries,
    '] as const;',
    '',
  ].join('\n');
}

function primitiveClientCallables(primitive) {
  return [...primitive.handlers, ...(primitive.clientHelpers ?? [])];
}

function primitiveDirectGeneratedCallables(primitive) {
  const wrapped = new Set(primitive.generatedClientHelperWrappers ?? []);
  return [
    ...primitive.handlers,
    ...(primitive.clientHelpers ?? []).filter((helper) => !wrapped.has(helper)),
  ];
}

function formatGeneratedHandlerNames(names) {
  const values = names.map(formatTypeScriptString);
  const inline = `[${values.join(', ')}]`;
  if (`    importedNames: ${inline},`.length <= 100) {
    return `    importedNames: ${inline},`;
  }
  return ['    importedNames: [', ...values.map((value) => `      ${value},`), '    ],'].join('\n');
}

function formatTypeScriptString(value) {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function generateHeadlessPackageJson() {
  const packageJson = JSON.parse(readFileSync(paths.headlessPackageJson, 'utf8'));
  packageJson.exports = generateHeadlessDevelopmentExports();
  packageJson.publishConfig = {
    ...packageJson.publishConfig,
    exports: generateHeadlessPublishExports(),
  };
  packageJson.scripts = {
    ...packageJson.scripts,
    'build:dist': generateHeadlessPackCommand(),
  };
  return `${JSON.stringify(packageJson, null, 2)}\n`;
}

function generateHeadlessDevelopmentExports() {
  return {
    ...Object.fromEntries(
      headlessPrimitiveSubpaths.map((subpath) => [`./${subpath}`, `./src/public/${subpath}.ts`]),
    ),
    './types': './src/types.ts',
    './generated': './src/generated.ts',
    './internal': './src/internal.ts',
    './internal/primitive': './src/primitive-internal.ts',
  };
}

function generateHeadlessPublishExports() {
  return {
    ...Object.fromEntries(
      headlessPrimitiveSubpaths.map((subpath) => [
        `./${subpath}`,
        {
          types: `./dist/public/${subpath}.d.mts`,
          default: `./dist/public/${subpath}.mjs`,
        },
      ]),
    ),
    './types': {
      types: './dist/types.d.mts',
      default: './dist/types.mjs',
    },
    './generated': {
      types: './dist/generated.d.mts',
      default: './dist/generated.mjs',
    },
    './internal': {
      types: './dist/internal.d.mts',
      default: './dist/internal.mjs',
    },
    './internal/primitive': {
      types: './dist/primitive-internal.d.mts',
      default: './dist/primitive-internal.mjs',
    },
  };
}

function generateHeadlessPackCommand() {
  return `vp pack ${headlessPackEntryPoints().join(' ')} --dts`;
}

function headlessPackEntryPoints() {
  return [
    'src/generated.ts',
    'src/internal.ts',
    'src/primitive-internal.ts',
    ...headlessPrimitiveSubpaths.map((subpath) => `src/public/${subpath}.ts`),
    'src/types.ts',
  ];
}

function generateHeadlessPublicFacadeTargets() {
  return headlessPrimitiveSubpaths.map((subpath) => ({
    compare: 'text',
    label: `packages/headless-ui/src/public/${subpath}.ts`,
    path: path.join(paths.headlessPublicDir, `${subpath}.ts`),
    source: generateHeadlessPublicFacadeTs(subpath),
  }));
}

function generateHeadlessPublicFacadeTs(subpath) {
  const primitivePath = path.join(headlessRoot, 'src', 'primitives', `${subpath}.ts`);
  const { types, values } = publicPrimitiveExportsFromSource(
    `packages/headless-ui/src/primitives/${subpath}.ts`,
    subpath,
    readFileSync(primitivePath, 'utf8'),
  );
  const moduleSpecifier = `../primitives/${subpath}.js`;
  return [
    generatedSourceComment,
    `// Public facade for @kovojs/headless-ui/${subpath}; implementation-only helpers stay in src/primitives.`,
    ...(values.length > 0 ? [formatNamedExport(values, moduleSpecifier)] : []),
    ...(types.length > 0 ? [formatNamedExport(types, moduleSpecifier, { typeOnly: true })] : []),
    '',
  ].join('\n');
}

function generateHeadlessRuntimeHelperAudit() {
  const entries = primitiveComponentManifest.headlessPrimitives
    .flatMap((primitive) => {
      const generatedHelpers = new Set(primitive.clientHelpers ?? []);
      return primitive.internalRuntimeHelpers.map((symbol) => ({
        decision: generatedHelpers.has(symbol) ? 'generated-only' : 'internalize',
        evidence: {
          declarationTag: generatedHelpers.has(symbol) ? '@generated' : '@internal',
          generatedAbiReference: generatedHelpers.has(symbol),
          publicNamedImports: {
            authoredDocs: 0,
            authoredExamples: 0,
            conformance: 0,
            packageConsumers: 0,
          },
        },
        reason: generatedHelpers.has(symbol)
          ? 'Compiler-emitted client modules call this helper through @kovojs/headless-ui/generated; app-authored code has no runtime assembly task for it.'
          : 'The helper is an implementation projection used to construct public attributes; copied and package-managed components consume the attribute builder instead.',
        specifier: `@kovojs/headless-ui/${primitive.subpath}`,
        symbol,
      }));
    })
    .sort(
      (left, right) =>
        left.specifier.localeCompare(right.specifier) || left.symbol.localeCompare(right.symbol),
    );
  if (entries.length !== 38) {
    throw new Error(`Headless runtime-helper audit must contain 38 entries, got ${entries.length}`);
  }
  return {
    schema: 'kovo-headless-runtime-helper-audit/v1',
    reviewedAt: '2026-07-28',
    inventory: 'kovo-public-api-inventory/v1',
    auditedCount: entries.length,
    entries,
  };
}

function generateHeadlessTransitionAbiAudit() {
  const primitives = primitiveComponentManifest.headlessPrimitives.map((primitive) => {
    const fileName = `packages/headless-ui/src/primitives/${primitive.subpath}.ts`;
    const source = readFileSync(path.join(repoRoot, fileName), 'utf8');
    const declarations = primitiveExportDeclarations(fileName, primitive.subpath, source);
    const transitionTypes = [...declarations.values()]
      .filter(
        (declaration) =>
          isTypeDeclarationKind(declaration.kind) &&
          isTransitionMachineOnlyDeclaration(declaration.name),
      )
      .map((declaration) => declaration.name)
      .sort((left, right) => left.localeCompare(right));
    const publicExports = publicPrimitiveExportsFromSource(fileName, primitive.subpath, source);
    const publicNames = new Set([...publicExports.types, ...publicExports.values]);
    const facade = generateHeadlessPublicFacadeTs(primitive.subpath);
    const publicReachable = transitionTypes.filter(
      (name) =>
        new RegExp(`\\b${escapeRegExp(name)}\\b`).test(facade) ||
        publicSignatureReferences(publicNames, name, declarations),
    );
    return {
      primitive: primitive.subpath,
      transitionTypes,
      publicReachable,
    };
  });
  const generatedFacade = generateHeadlessGeneratedTs();
  const allTransitionTypes = primitives.flatMap((entry) => entry.transitionTypes);
  const generatedFacadeReachable = allTransitionTypes.filter((name) =>
    new RegExp(`\\b${escapeRegExp(name)}\\b`).test(generatedFacade),
  );
  const publicReachable = primitives.flatMap((entry) => entry.publicReachable);
  if (publicReachable.length > 0 || generatedFacadeReachable.length > 0) {
    throw new Error(
      `Transition ABI leaked through a public/generated facade: ${sorted([
        ...publicReachable,
        ...generatedFacadeReachable,
      ]).join(', ')}`,
    );
  }
  return {
    schema: 'kovo-headless-transition-abi-audit/v1',
    reviewedAt: '2026-07-28',
    sourceDeclarationCount: allTransitionTypes.length,
    publicReachable,
    generatedFacadeReachable,
    classification: 'internal primitive transition machinery',
    primitives,
  };
}

function staleHeadlessPublicFacadeTargets() {
  const expectedFileNames = new Set(headlessPrimitiveSubpaths.map((subpath) => `${subpath}.ts`));
  return readdirSync(paths.headlessPublicDir)
    .filter((fileName) => fileName.endsWith('.ts') && !expectedFileNames.has(fileName))
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => ({
      label: `packages/headless-ui/src/public/${fileName}`,
      path: path.join(paths.headlessPublicDir, fileName),
    }));
}

function generateGalleryPrimitiveActionsTs() {
  return [
    generatedSourceComment,
    '// Gallery-local L1 interaction adapter for compiled demos.',
    "export * from './primitive-actions.generated.js';",
    ...primitiveComponentManifest.headlessPrimitives.map(
      (primitive) => `export * from '@kovojs/headless-ui/${primitive.subpath}';`,
    ),
    '',
  ].join('\n');
}

function generateGalleryGeneratedPrimitiveActionsTs() {
  return [
    generatedSourceComment,
    '// Gallery-generated ABI adapter for compiled primitive demos. App-authored source imports ../primitive-actions.js instead.',
    "export * from '@kovojs/headless-ui/generated';",
    '',
  ].join('\n');
}

function generateGalleryComponentManifestTs() {
  return [
    generatedSourceComment,
    '',
    'export const galleryComponentEntries = Object.freeze([',
    manifestComponents.map(formatGalleryComponentEntry).join('\n'),
    '] as const);',
    '',
    "export type GalleryComponent = (typeof galleryComponentEntries)[number]['component'];",
    "export type GalleryComponentPath = (typeof galleryComponentEntries)[number]['path'];",
    '',
  ].join('\n');
}

function generateGalleryComponentCatalogTs() {
  const entries = generatedUiCatalog.entries.map((entry) => ({
    anatomy: entry.anatomy,
    component: entry.name,
    copyCommand: entry.copyCommand,
    enhancement: entry.enhancement,
    headlessImport: entry.headlessImport,
    packageImport: entry.packageImport,
    searchText: entry.searchText,
    summary: entry.summary,
    title: entry.title,
  }));
  return [
    generatedSourceComment,
    '',
    "import type { GalleryComponent } from './gallery-component-manifest.js';",
    '',
    'export interface GalleryComponentEntry {',
    '  anatomy: {',
    '    ids: readonly string[];',
    '    parts: readonly string[];',
    '    slots: readonly string[];',
    '    stateInputs: readonly string[];',
    '  };',
    '  component: GalleryComponent;',
    '  copyCommand: string;',
    '  enhancement: {',
    '    accessibility: string;',
    '    keyboard: string;',
    '    roles: readonly string[];',
    "    tier: 'none' | 'native' | 'progressive' | 'scripted';",
    '  };',
    '  headlessImport: string | null;',
    '  packageImport: string;',
    '  searchText: string;',
    '  summary: string;',
    '  title: string;',
    '}',
    '',
    'export const galleryComponentCatalog: readonly GalleryComponentEntry[] = Object.freeze(',
    `${JSON.stringify(entries, null, 2)} as readonly GalleryComponentEntry[],`,
    ');',
    '',
  ].join('\n');
}

function generateGalleryBrowserFixtureManifestTs() {
  const imports = manifestComponents.map(
    (entry) =>
      `import ${staticFixtureVariable(entry.component)} from './visual-fixtures/${entry.visualFixture}?raw';`,
  );
  const pathUnion = manifestComponents.map((entry) => `  | '${entry.path}'`);
  const htmlEntries = manifestComponents.map(
    (entry) => `  '${entry.path}': ${staticFixtureVariable(entry.component)},`,
  );
  const interactiveEntries = primitiveComponentManifest.interactiveDemos.map(
    (demo) => `  '${demo}',`,
  );

  return [
    generatedSourceComment,
    ...imports,
    '',
    'export type StaticVisualFixturePath =',
    ...pathUnion.map((line, index) => (index === pathUnion.length - 1 ? `${line};` : line)),
    '',
    'export const staticVisualFixtureHtml: Record<StaticVisualFixturePath, string> = {',
    ...htmlEntries,
    '};',
    '',
    'export const interactiveClientModuleNames = [',
    ...interactiveEntries,
    '] as const;',
    '',
  ].join('\n');
}

function validateManifestDrift() {
  const findings = [];

  addDuplicateFindings(
    findings,
    'component manifest entries',
    primitiveComponentManifest.components.map((entry) => entry.component),
  );
  addDuplicateFindings(
    findings,
    'headless primitive manifest entries',
    primitiveComponentManifest.headlessPrimitives.map((entry) => entry.subpath),
  );
  addDuplicateFindings(findings, 'interactive demos', primitiveComponentManifest.interactiveDemos);

  for (const component of primitiveComponentManifest.components) {
    for (const field of ['ids', 'parts', 'roles', 'slots', 'stateInputs']) {
      const values = component[field];
      if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
        findings.push(`${component.component}: ${field} must be a string array`);
      } else {
        addDuplicateFindings(findings, `${component.component}: ${field}`, values);
      }
    }
    if (component.parts.length === 0 || component.slots.length === 0) {
      findings.push(`${component.component}: parts and slots must not be empty`);
    }
    if (!['none', 'native', 'progressive', 'scripted'].includes(component.enhancementTier)) {
      findings.push(`${component.component}: invalid enhancement tier`);
    }
    if (
      typeof component.keyboardBehavior !== 'string' ||
      component.keyboardBehavior.trim().length < 12 ||
      typeof component.accessibility !== 'string' ||
      component.accessibility.trim().length < 12
    ) {
      findings.push(`${component.component}: keyboard and accessibility contracts are required`);
    }
  }

  const generatedClientHelperWrappers = primitiveComponentManifest.headlessPrimitives.flatMap(
    (primitive) => primitive.generatedClientHelperWrappers ?? [],
  );
  addDuplicateFindings(
    findings,
    'generated client helper ABI wrappers',
    generatedClientHelperWrappers,
  );
  for (const primitive of primitiveComponentManifest.headlessPrimitives) {
    const clientHelpers = new Set(primitive.clientHelpers ?? []);
    for (const wrapper of primitive.generatedClientHelperWrappers ?? []) {
      if (!clientHelpers.has(wrapper)) {
        findings.push(
          `${primitive.subpath}: generated client helper wrapper ${wrapper} is not a declared client helper`,
        );
      }
    }
  }
  addSetDrift(
    findings,
    'client-helper-abi @kovoGeneratedClientHelper exports',
    generatedClientHelperWrappers,
    clientHelperAbiExportsFromSource(readFileSync(paths.headlessClientHelperAbi, 'utf8')),
  );

  const auditedRuntimeHelpers = primitiveComponentManifest.headlessPrimitives.flatMap(
    (primitive) => primitive.internalRuntimeHelpers,
  );
  addDuplicateFindings(findings, 'audited headless runtime helpers', auditedRuntimeHelpers);
  if (auditedRuntimeHelpers.length !== 38) {
    findings.push(
      `audited headless runtime helper count must remain 38 until a new evidence review, got ${auditedRuntimeHelpers.length}`,
    );
  }
  for (const primitive of primitiveComponentManifest.headlessPrimitives) {
    const primitivePath = path.join(headlessRoot, 'src', 'primitives', `${primitive.subpath}.ts`);
    if (!existsSync(primitivePath)) continue;
    const declarations = primitiveExportDeclarations(
      `packages/headless-ui/src/primitives/${primitive.subpath}.ts`,
      primitive.subpath,
      readFileSync(primitivePath, 'utf8'),
    );
    for (const helper of primitive.internalRuntimeHelpers) {
      const declaration = declarations.get(helper);
      const generatedOnly = new Set(primitive.clientHelpers ?? []).has(helper);
      const expectedTag = generatedOnly ? '@generated' : '@internal';
      if (declaration === undefined) {
        findings.push(`${primitive.subpath}: audited runtime helper ${helper} no longer exists`);
      } else if (!declaration.jsdoc?.includes(expectedTag)) {
        findings.push(
          `${primitive.subpath}: audited runtime helper ${helper} must carry an immediate ${expectedTag} declaration tag`,
        );
      }
    }
  }

  const headlessPackageJson = JSON.parse(readFileSync(paths.headlessPackageJson, 'utf8'));
  const headlessExportSubpaths = Object.keys(headlessPackageJson.exports)
    .filter(
      (subpath) =>
        subpath.startsWith('./') &&
        !['./generated', './internal', './internal/primitive', './types'].includes(subpath),
    )
    .map((subpath) => subpath.slice(2));
  addSetDrift(
    findings,
    'headless package public primitive subpaths',
    headlessPrimitiveSubpaths,
    headlessExportSubpaths,
  );

  const publicPackagesJson = JSON.parse(readFileSync(publicPackagesPath, 'utf8'));
  const headlessPublicPackage = publicPackagesJson.packages?.find(
    (entry) => entry.name === '@kovojs/headless-ui',
  );
  if (headlessPublicPackage === undefined) {
    findings.push('public-packages.json is missing @kovojs/headless-ui');
  } else {
    const boundary = headlessApiBoundary();
    addSetDrift(
      findings,
      'public-packages @kovojs/headless-ui apiBoundary.public',
      boundary.public,
      (headlessPublicPackage.apiBoundary?.public ?? []).map(String),
    );
    addSetDrift(
      findings,
      'public-packages @kovojs/headless-ui apiBoundary.generated',
      boundary.generated,
      (headlessPublicPackage.apiBoundary?.generated ?? []).map(String),
    );
    addSetDrift(
      findings,
      'public-packages @kovojs/headless-ui apiBoundary.internal',
      boundary.internal,
      (headlessPublicPackage.apiBoundary?.internal ?? []).map(String),
    );
  }

  const packageJson = JSON.parse(readFileSync(path.join(galleryRoot, 'package.json'), 'utf8'));
  addSetDrift(
    findings,
    'examples/gallery package.json interactiveGallery.compiledDemos',
    primitiveComponentManifest.interactiveDemos,
    (packageJson.kovo?.interactiveGallery?.compiledDemos ?? []).map(String),
  );

  addSetDrift(
    findings,
    'gallery interactive demo source files',
    primitiveComponentManifest.interactiveDemos,
    readdirSync(path.join(galleryRoot, 'src', 'interactive'))
      .filter((fileName) => fileName.endsWith('-demo.tsx'))
      .map((fileName) => fileName.replace(/\.tsx$/, ''))
      .sort((a, b) => a.localeCompare(b)),
  );

  addSetDrift(
    findings,
    'gallery static visual fixture files',
    manifestComponents.map((entry) => entry.visualFixture),
    readdirSync(path.join(galleryRoot, 'src', 'visual-fixtures'))
      .filter((fileName) => fileName.endsWith('.html.txt'))
      .sort((a, b) => a.localeCompare(b)),
  );

  for (const primitive of primitiveComponentManifest.headlessPrimitives) {
    const primitivePath = path.join(headlessRoot, 'src', 'primitives', `${primitive.subpath}.ts`);
    if (!existsSync(primitivePath)) {
      findings.push(`${primitive.subpath}: headless primitive source file is missing`);
      continue;
    }

    const sourceHandlers = primitiveHandlerExportsFromSource(
      `packages/headless-ui/src/primitives/${primitive.subpath}.ts`,
      readFileSync(primitivePath, 'utf8'),
    );
    addSetDrift(
      findings,
      `${primitive.subpath}: @kovoPrimitiveHandler exports`,
      primitive.handlers,
      sourceHandlers,
    );
  }

  return findings;
}

const PUBLIC_KOVO_DEPS = new Set([
  '@kovojs/core',
  '@kovojs/headless-ui',
  '@kovojs/icons',
  '@kovojs/server',
  '@kovojs/style',
]);

/** Parse every `import ... from '<mod>'` statement, returning { module, symbols[] }. */
function parseImports(source) {
  const results = [];
  const re = /^\s*import\s+(?:type\s+)?([^;]*?)\s+from\s+'([^']+)';/gm;
  let match;
  while ((match = re.exec(source)) !== null) {
    const clause = match[1].trim();
    const module = match[2];
    const symbols = [];
    const braced = clause.match(/\{([^}]*)\}/s);
    if (braced) {
      for (const part of braced[1].split(',')) {
        const name = part
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
          .trim();
        if (name) symbols.push(name);
      }
    }
    results.push({ module, symbols });
  }
  return results;
}

/** Convert an exported component binding to its derived DOM leaf name. */
function bindingToLeafName(binding) {
  return binding
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function componentParts(component, bindings) {
  const prefix = pascalCase(component);
  return [
    ...new Set(
      bindings.map((binding) => {
        if (binding === prefix) return 'root';
        const suffix = binding.startsWith(prefix) ? binding.slice(prefix.length) : binding;
        return `${suffix[0]?.toLowerCase() ?? ''}${suffix.slice(1)}`;
      }),
    ),
  ];
}

/** Exported `component({ ... })` definitions in a component file. */
function parseExportedComponents(source) {
  const re = /export const (\w+) = component\s*\(\s*\{/g;
  const names = [];
  let match;
  while ((match = re.exec(source)) !== null) names.push(match[1]);
  return names;
}

function publicPrimitiveExportsFromSource(fileName, subpath, source) {
  const declarations = primitiveExportDeclarations(fileName, subpath, source);
  const unclassified = [];

  for (const declaration of declarations.values()) {
    if (declaration.jsdoc === undefined) {
      unclassified.push(declaration.name);
    }
  }

  if (unclassified.length > 0) {
    throw new Error(
      `${fileName}: exported declarations must carry public-subpath docs, @internal, or @kovoPrimitiveHandler before they can be generated into a facade: ${sorted(
        unclassified,
      ).join(', ')}`,
    );
  }

  const publicNames = new Set(
    [...declarations.values()]
      .filter(
        (declaration) =>
          declaration.isPublic &&
          !isTransitionMachineOnlyDeclaration(declaration.name) &&
          !internalRuntimeHelperNames(subpath).has(declaration.name),
      )
      .map((declaration) => declaration.name),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations.values()) {
      if (publicNames.has(declaration.name) || declaration.isImplementationOnly) continue;
      if (isTransitionMachineOnlyDeclaration(declaration.name)) continue;
      if (!isTypeDeclarationKind(declaration.kind)) continue;
      if (!publicSignatureReferences(publicNames, declaration.name, declarations)) continue;
      publicNames.add(declaration.name);
      changed = true;
    }
  }

  const values = [];
  const types = [];
  for (const declaration of declarations.values()) {
    if (!publicNames.has(declaration.name)) continue;
    if (declaration.kind === 'type' || declaration.kind === 'interface') {
      types.push(declaration.name);
    } else {
      values.push(declaration.name);
    }
  }

  return { types, values };
}

function internalRuntimeHelperNames(subpath) {
  const primitive = primitiveComponentManifest.headlessPrimitives.find(
    (entry) => entry.subpath === subpath,
  );
  if (primitive === undefined) {
    throw new Error(`Missing headless primitive manifest entry for ${subpath}`);
  }
  return new Set(primitive.internalRuntimeHelpers);
}

function isTransitionMachineOnlyDeclaration(name) {
  if (name === 'ToastChangeReason') {
    return false;
  }
  if (/^Toast(?:Show|Dismiss)?Event/.test(name) || /^toast(?:Show|Dismiss)?Event/.test(name)) {
    return false;
  }
  if (name.endsWith('FocusEvent')) {
    return false;
  }
  return new RegExp(
    [
      'Change(?:Reason|Detail|Options|Result)',
      'OpenChange(?:Reason|Detail|Result)',
      'ValueChange(?:Reason|Detail|Result)',
      'InputChange(?:Reason|Detail|Result)',
      'Select(?:Reason|Detail|Result)',
      'KeyboardResult',
      'OptionSelectResult',
      'SelectResult',
      'PointerDragOptions',
      'KeyDownOptions',
      'Event',
    ].join('|') + '$',
  ).test(name);
}

function primitiveExportDeclarations(fileName, subpath, source) {
  const exportRe = /^\s*export\s+(type|interface|function|const|class|enum)\s+(\w+)/gm;
  const matches = [...source.matchAll(exportRe)];
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const astDeclarations = exportedAstDeclarations(sourceFile);
  const declarations = new Map();

  for (const match of matches) {
    const kind = match[1];
    const name = match[2];
    if (kind === undefined || name === undefined || match.index === undefined) continue;

    const astDeclaration = astDeclarations.get(name);
    if (astDeclaration === undefined) {
      throw new Error(`Unable to resolve exported declaration ${name} from ${fileName}`);
    }
    const jsdoc = immediateJsdocBefore(source, match.index);
    const fullDeclarationSource = source.slice(match.index, astDeclaration.node.end);
    const isImplementationOnly =
      jsdoc?.includes('@internal') === true ||
      jsdoc?.includes('@generated') === true ||
      jsdoc?.includes('@kovoPrimitiveHandler') === true;
    declarations.set(name, {
      fullDeclarationSource,
      isImplementationOnly,
      isPublic: jsdoc?.includes(`@kovojs/headless-ui/${subpath}`) === true && !isImplementationOnly,
      kind,
      name,
      publicSignatureSource: source.slice(match.index, astDeclaration.signatureEnd),
      jsdoc,
    });
  }

  return declarations;
}

function exportedAstDeclarations(sourceFile) {
  const declarations = new Map();
  for (const statement of sourceFile.statements) {
    if (!hasExportModifier(statement)) continue;

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        declarations.set(declaration.name.text, {
          node: statement,
          signatureEnd: declaration.initializer?.getStart(sourceFile) ?? statement.end,
        });
      }
      continue;
    }

    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      declarations.set(statement.name.text, {
        node: statement,
        signatureEnd:
          ts.isFunctionDeclaration(statement) && statement.body !== undefined
            ? statement.body.getStart(sourceFile)
            : statement.end,
      });
    }
  }
  return declarations;
}

function hasExportModifier(node) {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
}

function immediateJsdocBefore(source, exportIndex) {
  const prefix = source.slice(0, exportIndex);
  const endIndex = prefix.lastIndexOf('*/');
  if (endIndex === -1 || prefix.slice(endIndex + 2).trim() !== '') return undefined;
  const startIndex = prefix.lastIndexOf('/**', endIndex);
  if (startIndex === -1) return undefined;
  return prefix.slice(startIndex + 3, endIndex);
}

function publicSignatureReferences(publicNames, candidateName, declarations) {
  const pattern = new RegExp(`\\b${escapeRegExp(candidateName)}\\b`);
  for (const publicName of publicNames) {
    const declaration = declarations.get(publicName);
    if (declaration !== undefined && pattern.test(declaration.publicSignatureSource)) return true;
  }
  return false;
}

function isTypeDeclarationKind(kind) {
  return kind === 'class' || kind === 'enum' || kind === 'interface' || kind === 'type';
}

function primitiveHandlerExportsFromSource(fileName, source) {
  const names = [];
  const re =
    /\/\*\*[\s\S]*?@kovoPrimitiveHandler[\s\S]*?\*\/\s*export\s+(?:function\s+(\w+)|const\s+(\w+)\s*=)/g;
  let match;

  while ((match = re.exec(source)) !== null) {
    const name = match[1] ?? match[2];
    if (name) names.push(name);
  }

  if (source.includes('@kovoPrimitiveHandler') && names.length === 0) {
    throw new Error(`Unable to parse @kovoPrimitiveHandler exports from ${fileName}`);
  }
  return names;
}

function clientHelperAbiExportsFromSource(source) {
  const names = [];
  const re = /\/\*\*[\s\S]*?@kovoGeneratedClientHelper[\s\S]*?\*\/\s*export\s+const\s+(\w+)\s*:/g;
  let match;

  while ((match = re.exec(source)) !== null) {
    const name = match[1];
    if (name) names.push(name);
  }

  if (source.includes('@kovoGeneratedClientHelper') && names.length === 0) {
    throw new Error('Unable to parse @kovoGeneratedClientHelper exports from client-helper-abi.ts');
  }
  return names;
}

function uiSourceComponentNames() {
  return readdirSync(uiSrcDir)
    .filter((fileName) => fileName.endsWith('.tsx'))
    .filter((fileName) => !fileName.includes('.test.') && fileName !== 'index.tsx')
    .map((fileName) => fileName.replace(/\.tsx$/, ''));
}

function targetMatchesFile(target) {
  let current = '';
  try {
    current = readFileSync(target.path, 'utf8');
  } catch {
    return false;
  }

  if (target.compare === 'json') {
    try {
      return JSON.stringify(JSON.parse(current)) === JSON.stringify(JSON.parse(target.source));
    } catch {
      return false;
    }
  }
  if (target.compare === 'typescript') {
    return canonicalTypeScriptAst(current) === canonicalTypeScriptAst(target.source);
  }

  return current === target.source;
}

function canonicalTypeScriptAst(source) {
  const sourceFile = ts.createSourceFile(
    'generated.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) return undefined;
  return JSON.stringify(canonicalTypeScriptNode(sourceFile));
}

function canonicalTypeScriptNode(node) {
  if (ts.isIdentifier(node)) return ['identifier', node.text];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return ['string', node.text];
  }
  if (ts.isNumericLiteral(node)) return ['number', node.text];
  if (ts.isPropertyAssignment(node)) {
    return ['property', propertyNameText(node.name), canonicalTypeScriptNode(node.initializer)];
  }
  const children = [];
  node.forEachChild((child) => {
    children.push(canonicalTypeScriptNode(child));
  });
  return [node.kind, children];
}

function propertyNameText(name) {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }
  return canonicalTypeScriptNode(name);
}

function formatNamedExport(names, moduleSpecifier, options = {}) {
  const typeKeyword = options.typeOnly === true ? ' type' : '';
  const oneLine = `export${typeKeyword} { ${names.join(', ')} } from '${moduleSpecifier}';`;
  if (oneLine.length <= 100) return oneLine;

  return [
    `export${typeKeyword} {`,
    ...names.map((name) => `  ${name},`),
    `} from '${moduleSpecifier}';`,
  ].join('\n');
}

function formatGalleryComponentEntry(entry) {
  return [
    '  {',
    formatObjectStringProperty('component', entry.component),
    formatObjectStringProperty('demoFunction', entry.demoFunction),
    formatObjectStringProperty('path', entry.path),
    formatObjectStringProperty('summary', entry.summary),
    formatObjectStringProperty('title', entry.title),
    formatObjectStringProperty('visualFixture', entry.visualFixture),
    '  },',
  ].join('\n');
}

function formatObjectStringProperty(name, value) {
  const literal = tsString(value);
  const line = `    ${name}: ${literal},`;
  if (line.length <= 100) return line;

  return `    ${name}:\n      ${literal},`;
}

function staticFixtureVariable(component) {
  return `${camelCase(component)}StaticRouteHtml`;
}

function pascalCase(value) {
  return value
    .split('-')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('');
}

function camelCase(value) {
  const pascal = pascalCase(value);
  return `${pascal[0]?.toLowerCase() ?? ''}${pascal.slice(1)}`;
}

function tsString(value) {
  if (value.includes("'") && !value.includes('"')) {
    return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  }

  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addDuplicateFindings(findings, label, values) {
  for (const value of values) {
    if (values.indexOf(value) !== values.lastIndexOf(value)) {
      findings.push(`${label} contains duplicate "${value}"`);
    }
  }
}

function addSetDrift(findings, label, expected, actual) {
  const sortedExpected = sorted(expected);
  const sortedActual = sorted(actual);
  if (sameArray(sortedExpected, sortedActual)) return;
  findings.push(
    `${label} drifted. expected=${JSON.stringify(sortedExpected)} actual=${JSON.stringify(
      sortedActual,
    )}`,
  );
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
