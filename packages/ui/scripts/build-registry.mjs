#!/usr/bin/env node
// Checks or writes the generated UI/headless/gallery manifest artifacts.
//
// The manifest in primitive-component-manifest.mjs owns the ordered component catalog,
// interactive browser fixture list, and headless primitive handler ABI groups. This
// script derives the residual copy-in metadata from source and keeps every checked-in
// registry surface round-trip checked:
//   node packages/ui/scripts/build-registry.mjs            # check (default)
//   node packages/ui/scripts/build-registry.mjs --write    # rewrite generated artifacts

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { primitiveComponentManifest } from './primitive-component-manifest.mjs';

const pkgRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = path.resolve(pkgRoot, '../..');
const uiSrcDir = path.join(pkgRoot, 'src');
const headlessRoot = path.join(repoRoot, 'packages/headless-ui');
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
  headlessGenerated: path.join(headlessRoot, 'src', 'generated.ts'),
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
const uiDistributionMode = uiPackageDistributionMode();
const generatedUiRegistry = generateUiRegistry();
const generatedTargets = [
  {
    compare: 'json',
    label: 'packages/ui/registry.json',
    path: paths.uiRegistry,
    source: `${JSON.stringify(generatedUiRegistry, null, 2)}\n`,
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
    compare: 'text',
    label: 'examples/gallery/src/primitive-actions.ts',
    path: paths.galleryPrimitiveActions,
    source: generateGalleryPrimitiveActionsTs(),
  },
  {
    compare: 'text',
    label: 'examples/gallery/src/gallery-component-manifest.ts',
    path: paths.galleryComponentManifest,
    source: generateGalleryComponentManifestTs(),
  },
  {
    compare: 'text',
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

for (const target of generatedTargets) {
  if (writeMode) {
    writeFileSync(target.path, target.source);
    console.log(`Wrote ${target.label}.`);
  } else if (!targetMatchesFile(target)) {
    targetFindings.push(`${target.label} is out of date`);
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

    components.push({
      family: entry.family ?? {
        ids: [],
        parts: [],
        slots: [],
        state: [],
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
    `dependencies records the exact imported symbols per package, uiComponents lists sibling files to copy, and family metadata records manifest-owned ids, parts, slots, and state for ${countCopyInSensitiveFamilies(components)} copy-in-sensitive component families across ${components.length} components.`,
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
    `tracks family metadata for ${countCopyInSensitiveFamilies(components)} copy-in-sensitive wrappers, and`,
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

function countCopyInSensitiveFamilies(components) {
  return components.filter((component) =>
    Object.values(component.family).some((entries) => entries.length > 0),
  ).length;
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
    .filter((primitive) => primitive.handlers.length > 0)
    .map((primitive) =>
      formatNamedExport(primitive.handlers, `./primitives/${primitive.subpath}.js`),
    );

  return [
    generatedSourceComment,
    '// Handler ABI for compiler-emitted client modules. App-authored source must not import this subpath.',
    ...groups,
    '',
  ].join('\n');
}

function generateGalleryPrimitiveActionsTs() {
  return [
    generatedSourceComment,
    '// Gallery-local L1 interaction adapter for compiled demos.',
    "export * from '@kovojs/headless-ui/generated';",
    "export * from '@kovojs/headless-ui/internal/primitive';",
    ...primitiveComponentManifest.headlessPrimitives.map(
      (primitive) => `export * from '@kovojs/headless-ui/${primitive.subpath}';`,
    ),
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
  return [
    generatedSourceComment,
    '',
    "import { galleryComponentEntries, type GalleryComponent } from './gallery-component-manifest.js';",
    '',
    'export interface GalleryComponentEntry {',
    '  component: GalleryComponent;',
    '  summary: string;',
    '  title: string;',
    '}',
    '',
    'export const galleryComponentCatalog: readonly GalleryComponentEntry[] = Object.freeze(',
    '  galleryComponentEntries.map(({ component, summary, title }) => ({ component, summary, title })),',
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

  const headlessExportSubpaths = Object.keys(
    JSON.parse(readFileSync(path.join(headlessRoot, 'package.json'), 'utf8')).exports,
  )
    .filter(
      (subpath) =>
        subpath.startsWith('./') &&
        !['./generated', './internal', './internal/primitive', './types'].includes(subpath),
    )
    .map((subpath) => subpath.slice(2));
  addSetDrift(
    findings,
    'headless package public primitive subpaths',
    primitiveComponentManifest.headlessPrimitives.map((entry) => entry.subpath),
    headlessExportSubpaths,
  );

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

/** Exported `component({ ... })` definitions in a component file. */
function parseExportedComponents(source) {
  const re = /export const (\w+) = component\s*\(\s*\{/g;
  const names = [];
  let match;
  while ((match = re.exec(source)) !== null) names.push(match[1]);
  return names;
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

  return current === target.source;
}

function formatNamedExport(names, moduleSpecifier) {
  const oneLine = `export { ${names.join(', ')} } from '${moduleSpecifier}';`;
  if (oneLine.length <= 100) return oneLine;

  return [`export {`, ...names.map((name) => `  ${name},`), `} from '${moduleSpecifier}';`].join(
    '\n',
  );
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
