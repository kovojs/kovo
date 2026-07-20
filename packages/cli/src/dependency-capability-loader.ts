import { existsSync, realpathSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  AppDependencyCapability,
  AppDependencyCapabilityManifest,
  ResolvedCapabilityPackage,
} from '@kovojs/compiler/internal';
import { elementContextSecurityStaticValueIssue } from '@kovojs/core/internal/sink-policy';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import type { Plugin } from 'vite-plus';

import {
  capabilityPackageResolvedTargetRoot,
  resolveCapabilityPackageImport,
} from './capability-closure-packages.js';

export type { AppDependencyCapabilityManifest } from '@kovojs/compiler/internal';

const expectedSchema = 'kovo-app-dependency-capabilities/v1';
const dependencyCapabilities = new Set([
  'crypto-acquisition',
  'database-driver',
  'digest',
  'dynamic-loader',
  'filesystem',
  'network',
  'process',
  'vm',
  'worker',
]);
const dependencyDispositions = new Set([
  'authority-free',
  'framework-door',
  'pure',
  'raw',
  'request-closed',
]);
const dependencyRootKinds = new Set([
  'agent-tool-callback',
  'application',
  'durable-task',
  'endpoint',
  'layout',
  'mutation',
  'query',
  'route',
  'scheduled-task',
  'serialized-browser-handler',
  'webhook',
]);
const htmlExecutableUrlAttributes = new Set([
  'action',
  'archive',
  'background',
  'cite',
  'classid',
  'codebase',
  'data',
  'formaction',
  'href',
  'longdesc',
  'manifest',
  'poster',
  'src',
  'usemap',
]);
const htmlSvgSmilExecutionElements = new Set([
  'animate',
  'animatecolor',
  'animatemotion',
  'animatetransform',
  'discard',
  'set',
]);
const reviewedPackageResolveExtensions = [
  '.mjs',
  '.js',
  '.mts',
  '.ts',
  '.jsx',
  '.tsx',
  '.json',
] as const;
const reviewedPackageModuleSuffixes = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);

interface ApprovedDependencySource {
  readonly fileName: string;
  readonly source: string;
}

export type DependencyCapabilityLoaderLane =
  | 'build-app'
  | 'build-client'
  | 'build-server'
  | 'export'
  | 'test';

interface DependencyCapabilityLoaderOptions {
  readonly allowNodeBuiltins?: boolean;
  readonly allowRuntimeExternal?: (specifier: string) => boolean;
}

/**
 * Bind package imports from the exact preflight-owned app graph to its derived manifest.
 *
 * Relative app-source byte ownership remains the adjacent approved-source plugin's job. This hook
 * owns only bare package specifiers and re-resolves their installed identity immediately before
 * Vite admits the import (SPEC §6.6).
 * @internal
 */
export function dependencyCapabilityLoaderVitePlugin(
  appModulePath: string,
  approvedSourceFiles: readonly ApprovedDependencySource[],
  manifest: AppDependencyCapabilityManifest,
  lane: DependencyCapabilityLoaderLane = 'test',
  options: DependencyCapabilityLoaderOptions = {},
): Plugin {
  assertDependencyCapabilityManifestShape(manifest);
  const sourceRoot = dirname(appModulePath);
  const approvedPaths = new Map<string, string>();
  for (const file of approvedSourceFiles) {
    approvedPaths.set(
      canonicalSourcePath(resolve(sourceRoot, file.fileName)),
      normalizeModuleName(file.fileName),
    );
  }
  const admittedSpecifiers = new Set(
    manifest.dependencies
      .filter((dependency) => dependency.verdict === 'open')
      .flatMap((dependency) => dependency.entries.map((entry) => entry.specifier)),
  );
  const reviewedThirdPartyRoots = new Map<string, string>();
  const loadedHtmlPaths = new Set<string>();
  let configuredRoot = sourceRoot;
  let configuredPublicDir: string | undefined;
  let configuredAliases: readonly { find: string | RegExp; replacement: string }[] = [];

  const rememberLoadedHtml = (id: string): void => {
    const sourcePath = viteSourcePath(id);
    if (sourcePath !== undefined && isHtmlSourcePath(sourcePath)) {
      loadedHtmlPaths.add(sourcePath);
    }
  };

  return {
    configResolved(config) {
      configuredRoot = canonicalSourcePath(config.root);
      configuredPublicDir =
        typeof config.publicDir === 'string' ? canonicalSourcePath(config.publicDir) : undefined;
      configuredAliases = config.resolve.alias;
      if (
        admittedSpecifiers.size > 0 &&
        (config.resolve.extensions.length !== reviewedPackageResolveExtensions.length ||
          config.resolve.extensions.some(
            (extension, index) => extension !== reviewedPackageResolveExtensions[index],
          ))
      ) {
        throw dependencyCapabilityError(
          'custom Vite resolve extensions can retarget reviewed package child identity',
        );
      }
      for (const specifier of admittedSpecifiers) {
        if (
          config.ssr.external === true ||
          config.ssr.external?.some((external) => dependencySpecifierMatches(specifier, external))
        ) {
          throw dependencyCapabilityError(
            `${specifier} overlaps a trusted SSR external and cannot be admitted as an app dependency in ${lane}`,
          );
        }
        for (const alias of config.resolve.alias) {
          const replacement = aliasReplacementFor(specifier, alias.find, alias.replacement);
          if (replacement === undefined) continue;
          for (const importerPath of approvedPaths.keys()) {
            if (
              capabilityPackageResolvedTargetRoot(specifier, importerPath, replacement) ===
              undefined
            ) {
              throw dependencyCapabilityError(
                `${specifier} alias resolves outside its exact package export target in ${lane}`,
              );
            }
          }
        }
      }
    },
    enforce: 'pre',
    load(id) {
      rememberLoadedHtml(id);
      return null;
    },
    name: 'kovo-dependency-capability-loader',
    transform(source, id) {
      rememberLoadedHtml(id);
      if (isViteInlineHtmlModuleProxy(id)) {
        throw dependencyCapabilityError(
          'inline HTML module is outside the immutable approved-source snapshot',
        );
      }
      const sourcePath = viteSourcePath(id);
      if (lane === 'build-client' && sourcePath !== undefined && isHtmlSourcePath(sourcePath)) {
        assertHtmlExecutableSources(
          source,
          sourcePath,
          configuredRoot,
          configuredPublicDir,
          approvedPaths,
        );
      }
      const reviewedPackage =
        sourcePath === undefined
          ? undefined
          : packageOwnerForSource(sourcePath, reviewedThirdPartyRoots);
      if (reviewedPackage !== undefined) {
        let ast: unknown;
        try {
          ast = this.parse(source);
        } catch {
          throw dependencyCapabilityError(
            `reviewed package ${reviewedPackage.packageName} contains source the pre-evaluation module-edge census cannot parse`,
          );
        }
        if (aliasesCommonJsLoaderAuthority(ast)) {
          throw dependencyCapabilityError(
            `reviewed package ${reviewedPackage.packageName} aliases CommonJS loader authority before app evaluation`,
          );
        }
        const workerConstructor = reviewedWorkerConstructor(ast);
        if (workerConstructor !== undefined) {
          throw dependencyCapabilityError(
            `reviewed package ${reviewedPackage.packageName} creates a ${workerConstructor} subgraph outside the dependency closure plugin`,
          );
        }
        const executableAssetCarrier = reviewedExecutableAssetCarrier(ast);
        if (executableAssetCarrier !== undefined) {
          throw dependencyCapabilityError(
            `reviewed package ${reviewedPackage.packageName} creates ${executableAssetCarrier === 'opaque new-URL' ? 'an' : 'a'} ${executableAssetCarrier} executable asset outside the dependency closure plugin`,
          );
        }
        for (const edge of parsedModuleEdges(ast)) {
          if (edge.specifier === undefined) {
            throw dependencyCapabilityError(
              `reviewed package ${reviewedPackage.packageName} contains a non-literal module edge before app evaluation`,
            );
          }
          if (specifierHasUnsupportedSubgraphSuffix(edge.specifier)) {
            throw dependencyCapabilityError(
              `reviewed package ${reviewedPackage.packageName} child edge ${edge.specifier} carries a query or fragment without a Kovo-owned subgraph proof`,
            );
          }
          if (
            configuredAliases.some(
              (alias) =>
                aliasReplacementFor(edge.specifier!, alias.find, alias.replacement) !== undefined,
            )
          ) {
            throw dependencyCapabilityError(
              `Vite alias matches reviewed package ${reviewedPackage.packageName} child edge ${edge.specifier}`,
            );
          }
          if (isBareDependencySpecifier(edge.specifier)) {
            throw dependencyCapabilityError(
              `uncensused transitive dependency ${edge.specifier} imported by reviewed package ${reviewedPackage.packageName}`,
            );
          }
        }
      }
      return null;
    },
    async resolveId(specifier, importer) {
      const importerPath = importer === undefined ? undefined : viteSourcePath(importer);
      if (
        lane === 'build-client' &&
        importerPath !== undefined &&
        loadedHtmlPaths.has(importerPath)
      ) {
        if (isViteInlineHtmlModuleProxy(specifier)) {
          throw dependencyCapabilityError(
            'inline HTML module is outside the immutable approved-source snapshot',
          );
        }
        if (isReviewedViteHtmlVirtualSpecifier(specifier)) return null;
        const resolved = await this.resolve(specifier, importer, { skipSelf: true });
        const resolvedPath =
          resolved === null || resolved.external === true ? undefined : viteSourcePath(resolved.id);
        if (resolvedPath === undefined || !approvedPaths.has(resolvedPath)) {
          throw dependencyCapabilityError(
            `HTML module ${specifier} resolves outside the immutable approved-source snapshot in ${lane}`,
          );
        }
        return resolved;
      }
      const importerName = importerPath === undefined ? undefined : approvedPaths.get(importerPath);
      const reviewedPackage =
        importerPath === undefined
          ? undefined
          : packageOwnerForSource(importerPath, reviewedThirdPartyRoots);
      if (importerName !== undefined && specifierHasUnsupportedSubgraphSuffix(specifier)) {
        throw dependencyCapabilityError(
          `approved app source ${importerName} edge ${specifier} carries a query or fragment without a Kovo-owned subgraph proof`,
        );
      }
      if (reviewedPackage !== undefined && specifierHasUnsupportedSubgraphSuffix(specifier)) {
        throw dependencyCapabilityError(
          `reviewed package ${reviewedPackage.packageName} child edge ${specifier} carries a query or fragment without a Kovo-owned subgraph proof`,
        );
      }
      if (reviewedPackage !== undefined && !isBareDependencySpecifier(specifier)) {
        if (
          configuredAliases.some(
            (alias) => aliasReplacementFor(specifier, alias.find, alias.replacement) !== undefined,
          )
        ) {
          throw dependencyCapabilityError(
            `Vite alias matches reviewed package ${reviewedPackage.packageName} child edge ${specifier}`,
          );
        }
        const resolved = await this.resolve(specifier, importer, { skipSelf: true });
        const resolvedLexicalPath =
          resolved === null || resolved.external === true
            ? undefined
            : viteLexicalSourcePath(resolved.id);
        const resolvedPath =
          resolved === null || resolved.external === true ? undefined : viteSourcePath(resolved.id);
        if (
          resolvedLexicalPath !== undefined &&
          !isReviewedPackageCodeModule(resolvedLexicalPath)
        ) {
          throw dependencyCapabilityError(
            `reviewed package ${reviewedPackage.packageName} resolved lexical module path ${relative(reviewedPackage.root, resolvedLexicalPath)} outside the closed module suffix set`,
          );
        }
        if (resolvedPath !== undefined && !isReviewedPackageCodeModule(resolvedPath)) {
          throw dependencyCapabilityError(
            `reviewed package ${reviewedPackage.packageName} resolved non-code resource ${relative(reviewedPackage.root, resolvedPath)} outside the closed module suffix set`,
          );
        }
        if (
          relativePackageImportCrossesNestedBoundary(
            reviewedPackage.root,
            importerPath,
            specifier,
          ) ||
          (resolvedPath !== undefined &&
            sourceIsWithinRoot(reviewedPackage.root, resolvedPath) &&
            !sourceBelongsToPackageRoot(reviewedPackage.root, resolvedPath))
        ) {
          throw dependencyCapabilityError(
            `relative import crosses a nested package boundary inside reviewed package ${reviewedPackage.packageName}`,
          );
        }
        if (
          resolved === null ||
          resolved.external === true ||
          resolvedPath === undefined ||
          !sourceBelongsToPackageRoot(reviewedPackage.root, resolvedPath)
        ) {
          const escapeKind = packageImportEscapeKind(specifier, importerPath, reviewedPackage.root);
          throw dependencyCapabilityError(
            `reviewed package ${reviewedPackage.packageName} ${escapeKind} import escapes its exact package root`,
          );
        }
        return resolved;
      }
      if (!isBareDependencySpecifier(specifier)) return null;
      if (importer !== undefined && isViteInlineHtmlModuleProxy(importer)) {
        throw dependencyCapabilityError(
          'inline HTML module is outside the immutable approved-source snapshot',
        );
      }
      if (importerPath === undefined) return null;
      if (importerName === undefined) {
        if (reviewedPackage !== undefined) {
          throw dependencyCapabilityError(
            `uncensused transitive dependency ${specifier} imported by reviewed package ${reviewedPackage.packageName}`,
          );
        }
        return null;
      }
      const installed = resolveCapabilityPackageImport(specifier, importerPath);
      assertDependencyCapabilityImport(manifest, specifier, installed, importerName);
      const resolved = await this.resolve(specifier, importer, { skipSelf: true });
      const resolvedLexicalPath =
        resolved === null || resolved.external === true
          ? undefined
          : viteLexicalSourcePath(resolved.id);
      const resolvedPath =
        resolved === null || resolved.external === true ? undefined : viteSourcePath(resolved.id);
      const packageRoot =
        resolved === null || resolved.external === true
          ? undefined
          : capabilityPackageResolvedTargetRoot(specifier, importerPath, resolved.id);
      if (
        resolvedLexicalPath !== undefined &&
        packageRoot !== undefined &&
        !isReviewedPackageCodeModule(resolvedLexicalPath)
      ) {
        throw dependencyCapabilityError(
          `reviewed package ${specifier} direct export lexical module path ${relative(packageRoot, resolvedLexicalPath)} is outside the closed module suffix set`,
        );
      }
      if (
        resolvedPath !== undefined &&
        packageRoot !== undefined &&
        !isReviewedPackageCodeModule(resolvedPath)
      ) {
        throw dependencyCapabilityError(
          `reviewed package ${specifier} direct export target ${relative(packageRoot, resolvedPath)} is outside the closed module suffix set`,
        );
      }
      if (
        resolved === null ||
        resolved.external === true ||
        resolvedPath === undefined ||
        packageRoot === undefined ||
        !sourceBelongsToPackageRoot(packageRoot, resolvedPath)
      ) {
        throw dependencyCapabilityError(
          `${specifier} resolved outside its exact package export target in ${lane}`,
        );
      }
      if (installed?.implementationDigest === undefined) {
        reviewedThirdPartyRoots.set(packageRoot, installed?.packageName ?? specifier);
      }
      // Classify and pin: Vite consumes the exact resolution checked above rather than running a
      // second resolver pass whose aliases/conditions could select different authority.
      return resolved;
    },
    generateBundle(_options, bundle) {
      const bundleOwnedChunkFileNames = new Set(
        Object.values(bundle).flatMap((output) =>
          output.type === 'chunk' ? [output.fileName] : [],
        ),
      );
      const bundleOwnedAssetFileNames = new Set(
        Object.values(bundle).flatMap((output) =>
          output.type === 'asset' ? [output.fileName] : [],
        ),
      );
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        let outputAst: unknown;
        try {
          outputAst = this.parse(output.code);
        } catch {
          throw dependencyCapabilityError(
            `supported ${lane} artifact ${output.fileName} cannot be parsed for retained module edges`,
          );
        }
        const workerConstructor = reviewedWorkerConstructor(outputAst);
        if (workerConstructor !== undefined) {
          throw dependencyCapabilityError(
            `supported ${lane} artifact ${output.fileName} retains a ${workerConstructor} constructor outside the dependency closure plugin`,
          );
        }
        const executableAssetCarrier = reviewedExecutableAssetCarrier(outputAst);
        if (executableAssetCarrier !== undefined) {
          throw dependencyCapabilityError(
            `supported ${lane} artifact ${output.fileName} retains ${executableAssetCarrier === 'opaque new-URL' ? 'an' : 'a'} ${executableAssetCarrier} executable asset outside the dependency closure plugin`,
          );
        }
        const artifactModuleEdges = parsedModuleEdges(outputAst);
        if (artifactModuleEdges.some((edge) => edge.specifier === undefined)) {
          throw dependencyCapabilityError(
            `supported ${lane} artifact ${output.fileName} retains a non-literal module edge outside the immutable dependency closure`,
          );
        }
        const retainedSpecifiers = new Set([
          ...literalRequireSpecifiers(output.code),
          ...artifactModuleEdges.flatMap((edge) =>
            edge.specifier === undefined ? [] : [edge.specifier],
          ),
        ]);
        for (const specifier of retainedSpecifiers) {
          if (artifactRelativeSpecifierHasRuntimeUrlAmbiguity(specifier)) {
            throw dependencyCapabilityError(
              `ambiguous runtime URL module target ${specifier} remains in supported ${lane} artifact ${output.fileName}`,
            );
          }
          if (
            artifactSpecifierIsBundleOwned(output.fileName, specifier, bundleOwnedChunkFileNames)
          ) {
            continue;
          }
          if (
            artifactSpecifierIsBundleOwned(output.fileName, specifier, bundleOwnedAssetFileNames)
          ) {
            throw dependencyCapabilityError(
              `module import ${specifier} from ${output.fileName} resolves to a bundle-owned non-chunk asset outside the executable module closure`,
            );
          }
          assertSupportedArtifactExternal(specifier, lane, options, 'module import');
        }
        for (const importedFileName of [...output.imports, ...output.dynamicImports]) {
          if (bundleOwnedChunkFileNames.has(importedFileName)) continue;
          if (bundleOwnedAssetFileNames.has(importedFileName)) {
            throw dependencyCapabilityError(
              `module import ${importedFileName} from ${output.fileName} resolves to a bundle-owned non-chunk asset outside the executable module closure`,
            );
          }
          assertSupportedArtifactExternal(importedFileName, lane, options, 'module import');
        }
      }
      for (const id of this.getModuleIds()) {
        const importerPath = viteSourcePath(id);
        if (importerPath === undefined) continue;
        const approvedImporter = approvedPaths.has(importerPath);
        const reviewedPackage = packageOwnerForSource(importerPath, reviewedThirdPartyRoots);
        if (!approvedImporter && reviewedPackage === undefined) continue;
        const info = this.getModuleInfo(id);
        for (const importedId of [
          ...(info?.importedIds ?? []),
          ...(info?.dynamicallyImportedIds ?? []),
        ]) {
          if (!isBareDependencySpecifier(importedId)) {
            const importedPath = viteSourcePath(importedId);
            if (
              reviewedPackage !== undefined &&
              (importedPath === undefined ||
                !sourceBelongsToPackageRoot(reviewedPackage.root, importedPath))
            ) {
              throw dependencyCapabilityError(
                `reviewed package ${reviewedPackage.packageName} resolved import escapes its exact package root`,
              );
            }
            continue;
          }
          if (reviewedPackage !== undefined) {
            throw dependencyCapabilityError(
              `uncensused transitive dependency ${importedId} imported by reviewed package ${reviewedPackage.packageName}`,
            );
          }
          throw dependencyCapabilityError(
            `${importedId} remained unresolved in the supported ${lane} module graph`,
          );
        }
      }
    },
  };
}

/**
 * Re-witness one package import at the supported loader boundary (SPEC §6.6).
 *
 * This is deliberately labelled a fail-closed floor: it stops post-census loader broadening in
 * supported runners, but it is not a JavaScript sandbox against privileged same-realm code.
 * @internal
 */
export function assertDependencyCapabilityImport(
  manifest: AppDependencyCapabilityManifest,
  specifier: string,
  installed: ResolvedCapabilityPackage | undefined,
  importer?: string,
): AppDependencyCapability {
  assertDependencyCapabilityManifestShape(manifest);

  const matches: Array<{
    dependency: AppDependencyCapability;
    entry: AppDependencyCapability['entries'][number];
  }> = [];
  for (
    let dependencyIndex = 0;
    dependencyIndex < manifest.dependencies.length;
    dependencyIndex += 1
  ) {
    const dependency = manifest.dependencies[dependencyIndex];
    if (dependency === undefined || !Array.isArray(dependency.entries)) {
      throw dependencyCapabilityError('manifest contains a malformed dependency row');
    }
    for (let entryIndex = 0; entryIndex < dependency.entries.length; entryIndex += 1) {
      const entry = dependency.entries[entryIndex];
      if (
        entry?.specifier === specifier &&
        Array.isArray(entry.importers) &&
        (importer === undefined || entry.importers.includes(importer))
      ) {
        matches.push({ dependency, entry });
      }
    }
  }

  if (matches.length !== 1) {
    throw dependencyCapabilityError(
      `${specifier} is absent from the compiler-derived dependency manifest`,
    );
  }
  const { dependency, entry } = matches[0]!;
  if (dependency.verdict !== 'open') {
    throw dependencyCapabilityError(`${specifier} does not carry an open least-authority verdict`);
  }
  if (
    installed === undefined ||
    installed.exportStatus !== 'resolved' ||
    installed.specifier !== specifier ||
    installed.packageName !== dependency.packageName ||
    installed.packageVersion !== dependency.packageVersion ||
    installed.manifestFingerprint !== dependency.manifestFingerprint ||
    !sameStrings(installed.conditions, entry.conditions) ||
    (dependency.implementationDigest !== undefined &&
      installed.implementationDigest !== dependency.implementationDigest)
  ) {
    throw dependencyCapabilityError(`${specifier} identity drifted after capability census`);
  }

  for (let importIndex = 0; importIndex < entry.imports.length; importIndex += 1) {
    const imported = entry.imports[importIndex];
    if (
      imported === undefined ||
      imported.disposition === 'raw' ||
      imported.disposition === 'request-closed'
    ) {
      throw dependencyCapabilityError(
        `${specifier} does not carry an open least-authority verdict`,
      );
    }
  }
  return dependency;
}

function assertDependencyCapabilityManifestShape(manifest: AppDependencyCapabilityManifest): void {
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    manifest.schema !== expectedSchema ||
    !Array.isArray(manifest.dependencies)
  ) {
    throw dependencyCapabilityError('manifest is malformed or uses an unsupported schema');
  }
  for (
    let dependencyIndex = 0;
    dependencyIndex < manifest.dependencies.length;
    dependencyIndex += 1
  ) {
    const dependency = manifest.dependencies[dependencyIndex];
    const label = `manifest dependency[${dependencyIndex}]`;
    if (
      typeof dependency !== 'object' ||
      dependency === null ||
      !Array.isArray(dependency.entries) ||
      dependency.entries.length === 0 ||
      typeof dependency.packageName !== 'string' ||
      dependency.packageName.length === 0 ||
      typeof dependency.packageVersion !== 'string' ||
      dependency.packageVersion.length === 0 ||
      (dependency.verdict !== 'closed' && dependency.verdict !== 'open') ||
      (dependency.implementationDigest !== undefined &&
        typeof dependency.implementationDigest !== 'string') ||
      (dependency.manifestFingerprint !== undefined &&
        typeof dependency.manifestFingerprint !== 'string') ||
      (dependency.summaryVersion !== undefined && typeof dependency.summaryVersion !== 'string') ||
      (dependency.verdict === 'open' &&
        (dependency.manifestFingerprint === undefined || dependency.summaryVersion === undefined))
    ) {
      throw dependencyCapabilityError(`${label} is malformed`);
    }
    for (let entryIndex = 0; entryIndex < dependency.entries.length; entryIndex += 1) {
      const entry = dependency.entries[entryIndex];
      const entryLabel = `${label} entry[${entryIndex}]`;
      if (
        typeof entry !== 'object' ||
        entry === null ||
        typeof entry.specifier !== 'string' ||
        entry.specifier.length === 0 ||
        !stringArray(entry.conditions, false) ||
        !stringArray(entry.importers, true) ||
        !stringArray(entry.rootKinds, false, dependencyRootKinds) ||
        !stringArray(entry.sites, true) ||
        !Array.isArray(entry.imports) ||
        entry.imports.length === 0
      ) {
        throw dependencyCapabilityError(`${entryLabel} is malformed`);
      }
      for (let importIndex = 0; importIndex < entry.imports.length; importIndex += 1) {
        const imported = entry.imports[importIndex];
        if (
          typeof imported !== 'object' ||
          imported === null ||
          typeof imported.name !== 'string' ||
          imported.name.length === 0 ||
          !dependencyDispositions.has(imported.disposition) ||
          !stringArray(imported.capabilities, false, dependencyCapabilities)
        ) {
          throw dependencyCapabilityError(`${entryLabel} import[${importIndex}] is malformed`);
        }
      }
    }
  }
}

function stringArray(
  value: unknown,
  requireValue: boolean,
  vocabulary?: ReadonlySet<string>,
): value is readonly string[] {
  if (!Array.isArray(value) || (requireValue && value.length === 0)) return false;
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (
      typeof item !== 'string' ||
      item.length === 0 ||
      seen.has(item) ||
      (vocabulary !== undefined && !vocabulary.has(item))
    ) {
      return false;
    }
    seen.add(item);
  }
  return true;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function isBareDependencySpecifier(specifier: string): boolean {
  return (
    specifier.length > 0 &&
    specifier[0] !== '\0' &&
    !specifier.startsWith('./') &&
    !specifier.startsWith('../') &&
    !specifier.startsWith('file:') &&
    !isAbsolute(specifier)
  );
}

function specifierHasUnsupportedSubgraphSuffix(specifier: string): boolean {
  return specifier.includes('?') || specifier.includes('#');
}

function isReviewedPackageCodeModule(sourcePath: string): boolean {
  return reviewedPackageModuleSuffixes.has(extname(sourcePath));
}

function dependencySpecifierMatches(specifier: string, packageName: string): boolean {
  return specifier === packageName || specifier.startsWith(`${packageName}/`);
}

function viteSourcePath(id: string): string | undefined {
  const lexicalPath = viteLexicalSourcePath(id);
  return lexicalPath === undefined ? undefined : canonicalSourcePath(lexicalPath);
}

function viteLexicalSourcePath(id: string): string | undefined {
  let value = id.split(/[?#]/u, 1)[0] ?? id;
  if (value.startsWith('/@fs/')) value = value.slice('/@fs'.length);
  if (value.startsWith('file:')) {
    try {
      value = fileURLToPath(value);
    } catch {
      return undefined;
    }
  }
  return isAbsolute(value) ? resolve(value) : undefined;
}

function canonicalSourcePath(value: string): string {
  try {
    return realpathSync(value);
  } catch {
    return resolve(value);
  }
}

function packageOwnerForSource(
  sourcePath: string,
  reviewedRoots: ReadonlyMap<string, string>,
): { packageName: string; root: string } | undefined {
  for (const [root, packageName] of reviewedRoots) {
    if (sourceBelongsToPackageRoot(root, sourcePath)) return { packageName, root };
  }
  return undefined;
}

function sourceIsWithinRoot(root: string, sourcePath: string): boolean {
  const candidate = relative(root, sourcePath).replaceAll('\\', '/');
  return (
    candidate !== '' && candidate !== '..' && !candidate.startsWith('../') && !isAbsolute(candidate)
  );
}

function sourceBelongsToPackageRoot(root: string, sourcePath: string): boolean {
  if (
    !sourceIsWithinRoot(root, sourcePath) ||
    sourceCrossesNestedNodeModulesBoundary(root, sourcePath)
  ) {
    return false;
  }
  const canonicalRoot = canonicalSourcePath(root);
  let directory = dirname(sourcePath);
  while (true) {
    if (existsSync(resolve(directory, 'package.json'))) {
      return canonicalSourcePath(directory) === canonicalRoot;
    }
    if (canonicalSourcePath(directory) === canonicalRoot) return false;
    const parent = dirname(directory);
    if (parent === directory || !sourceIsWithinRoot(canonicalRoot, directory)) return false;
    directory = parent;
  }
}

function sourceCrossesNestedNodeModulesBoundary(root: string, sourcePath: string): boolean {
  return relative(root, sourcePath)
    .replaceAll('\\', '/')
    .split('/')
    .some((part) => part.toLowerCase() === 'node_modules');
}

function relativePackageImportCrossesNestedBoundary(
  root: string,
  importerPath: string,
  specifier: string,
): boolean {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false;
  const lexicalTarget = resolve(dirname(importerPath), specifier.split(/[?#]/u, 1)[0] ?? specifier);
  return (
    sourceIsWithinRoot(root, lexicalTarget) &&
    (sourceCrossesNestedNodeModulesBoundary(root, lexicalTarget) ||
      lexicalTargetCrossesNestedPackageManifest(root, lexicalTarget))
  );
}

function lexicalTargetCrossesNestedPackageManifest(root: string, lexicalTarget: string): boolean {
  const normalizedRoot = resolve(root);
  let candidate = resolve(lexicalTarget);
  while (candidate !== normalizedRoot && sourceIsWithinRoot(normalizedRoot, candidate)) {
    if (existsSync(resolve(candidate, 'package.json'))) return true;
    const parent = dirname(candidate);
    if (parent === candidate) return false;
    candidate = parent;
  }
  return false;
}

function packageImportEscapeKind(
  specifier: string,
  importerPath: string,
  packageRoot: string,
): 'relative' | 'resolved' | 'symlink' {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const lexicalTarget = resolve(
      dirname(importerPath),
      specifier.split(/[?#]/u, 1)[0] ?? specifier,
    );
    return sourceIsWithinRoot(packageRoot, lexicalTarget) ? 'symlink' : 'relative';
  }
  return 'resolved';
}

function isViteInlineHtmlModuleProxy(id: string): boolean {
  return id.includes('?html-proxy') || id.includes('&html-proxy');
}

function isHtmlSourcePath(value: string): boolean {
  return value.toLowerCase().endsWith('.html');
}

function assertHtmlExecutableSources(
  source: string,
  htmlPath: string,
  root: string,
  publicDir: string | undefined,
  approvedPaths: ReadonlyMap<string, string>,
): void {
  // Parse in both Vite's scripting-disabled state and the browser's ordinary scripting-enabled
  // state. The union closes tokenizer-state differences such as <noscript>, RCDATA/RAWTEXT, SVG,
  // quoted attributes, and browser-valid non-canonical comments without maintaining a second HTML
  // grammar beside the exact pinned parser used by the build tool (SPEC §6.6).
  for (const scriptingEnabled of [false, true]) {
    const document = parse(source, { scriptingEnabled });
    for (const element of htmlElements(document)) {
      assertHtmlElementExecution(element, htmlPath, root, publicDir, approvedPaths);
    }
  }
}

function assertHtmlElementExecution(
  element: DefaultTreeAdapterTypes.Element,
  htmlPath: string,
  root: string,
  publicDir: string | undefined,
  approvedPaths: ReadonlyMap<string, string>,
): void {
  if (
    element.namespaceURI === 'http://www.w3.org/2000/svg' &&
    htmlSvgSmilExecutionElements.has(element.tagName.toLowerCase())
  ) {
    throw dependencyCapabilityError(
      'raw SVG SMIL execution transfer is outside compiler-owned JSX lowering',
    );
  }
  for (const attribute of element.attrs) {
    if (htmlExecutableUrlAttributes.has(attribute.name) && htmlJavascriptUrl(attribute.value)) {
      throw dependencyCapabilityError(
        `raw HTML javascript URL in ${attribute.name} is outside compiler-owned JSX lowering`,
      );
    }
    if (attribute.name.toLowerCase().startsWith('on')) {
      throw dependencyCapabilityError(
        `raw HTML event handler ${attribute.name} is outside compiler-owned JSX lowering`,
      );
    }
    const contextIssue = elementContextSecurityStaticValueIssue(
      element.tagName,
      attribute.name,
      attribute.value,
    );
    if (contextIssue !== undefined) {
      throw dependencyCapabilityError(
        `raw HTML element control ${element.tagName}[${attribute.name}] is outside compiler-owned JSX lowering: ${contextIssue}`,
      );
    }
  }

  if (element.tagName === 'base') {
    if (htmlAttribute(element, 'href') !== undefined) {
      throw dependencyCapabilityError(
        'raw HTML base URL can retarget emitted modules outside the immutable approved-source snapshot',
      );
    }
    if (htmlAttribute(element, 'target') !== undefined) {
      throw dependencyCapabilityError(
        'raw HTML base target can retarget browsing contexts outside the immutable approved-source snapshot',
      );
    }
  }

  if (
    element.tagName === 'iframe' ||
    element.tagName === 'frame' ||
    element.tagName === 'frameset' ||
    element.tagName === 'object' ||
    element.tagName === 'embed'
  ) {
    throw dependencyCapabilityError(
      `raw ${element.tagName} nested HTML document is outside the immutable approved-source snapshot`,
    );
  }

  if (element.tagName !== 'script') return;
  if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
    throw dependencyCapabilityError(
      'foreign-namespace HTML script is outside the immutable approved-source snapshot',
    );
  }

  const src = htmlAttribute(element, 'src');
  const rawType = htmlAttribute(element, 'type');
  const type = rawType?.trim().toLowerCase();
  const moduleScript = type === 'module';
  if (src !== undefined) {
    if (moduleScript) {
      const target = htmlApprovedModuleTarget(src, htmlPath, root);
      if (target === undefined || !approvedPaths.has(target)) {
        throw dependencyCapabilityError(
          `HTML module URL ${src} is outside the immutable approved-source snapshot`,
        );
      }
      const publicTarget = htmlPublicModuleTarget(src, htmlPath, root, publicDir);
      if (publicTarget !== undefined && existsSync(publicTarget)) {
        throw dependencyCapabilityError(
          `public asset shadows approved HTML module ${src} before Vite resolution`,
        );
      }
      if (rawType !== 'module') {
        throw dependencyCapabilityError(
          'browser-recognized HTML module type is not the exact lowercase module spelling Vite resolves',
        );
      }
      if (htmlAttribute(element, 'vite-ignore') !== undefined) {
        throw dependencyCapabilityError(
          'vite-ignore cannot suppress immutable approved-source resolution for an HTML module',
        );
      }
    } else {
      throw dependencyCapabilityError(
        'HTML script source is outside the immutable approved-source snapshot unless it is an exact approved module',
      );
    }
  } else if (type !== 'application/json' && type !== 'application/ld+json') {
    throw dependencyCapabilityError(
      moduleScript
        ? 'inline HTML module is outside the immutable approved-source snapshot'
        : 'inline HTML script is outside the immutable approved-source snapshot unless it is an explicit JSON data block',
    );
  }
}

function htmlJavascriptUrl(value: string): boolean {
  return value
    .replace(/[\u0000-\u0020\u007f]/gu, '')
    .toLowerCase()
    .startsWith('javascript:');
}

function htmlElements(
  document: DefaultTreeAdapterTypes.Document,
): DefaultTreeAdapterTypes.Element[] {
  const elements: DefaultTreeAdapterTypes.Element[] = [];
  const pending: DefaultTreeAdapterTypes.Node[] = [document];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if ('tagName' in node) {
      elements.push(node);
      if (node.tagName === 'template') pending.push(node.content);
    }
    if ('childNodes' in node) pending.push(...node.childNodes);
  }
  return elements;
}

function htmlAttribute(element: DefaultTreeAdapterTypes.Element, name: string): string | undefined {
  return element.attrs.find(
    (attribute) =>
      attribute.name === name &&
      attribute.namespace === undefined &&
      attribute.prefix === undefined,
  )?.value;
}

function htmlApprovedModuleTarget(
  value: string,
  htmlPath: string,
  root: string,
): string | undefined {
  const source = value.trim();
  if (
    source.length === 0 ||
    source.includes('&') ||
    source.includes('%') ||
    source.includes('\\') ||
    source.startsWith('//') ||
    source.startsWith('#') ||
    source.startsWith('?') ||
    source.includes('#') ||
    source.includes('?') ||
    /[\u0000-\u0020\u007f]/u.test(source)
  ) {
    return undefined;
  }
  if (source.includes(':')) return undefined;
  return canonicalSourcePath(
    source.startsWith('/') ? resolve(root, `.${source}`) : resolve(dirname(htmlPath), source),
  );
}

function htmlPublicModuleTarget(
  value: string,
  htmlPath: string,
  root: string,
  publicDir: string | undefined,
): string | undefined {
  if (publicDir === undefined) return undefined;
  const source = value.trim();
  const target = source.startsWith('/')
    ? resolve(publicDir, `.${source}`)
    : resolve(publicDir, relative(root, dirname(htmlPath)), source);
  return sourceIsWithinRoot(publicDir, target) ? canonicalSourcePath(target) : undefined;
}

function isReviewedViteHtmlVirtualSpecifier(specifier: string): boolean {
  return (
    specifier === 'vite/modulepreload-polyfill' || specifier === '\0vite/modulepreload-polyfill.js'
  );
}

function literalRequireSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /\b(?:require|__require)\(\s*(['"])([^'"\\\r\n]+)\1/gu;
  for (const match of source.matchAll(pattern)) {
    if (match[2] !== undefined) specifiers.push(match[2]);
  }
  return specifiers;
}

interface ParsedModuleEdge {
  readonly specifier?: string;
}

function reviewedWorkerConstructor(ast: unknown): 'SharedWorker' | 'Worker' | undefined {
  const pending: unknown[] = [ast];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value !== 'object' || value === null || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
      continue;
    }
    const record = value as Record<string, unknown>;
    if (record.type === 'NewExpression') {
      const callee = record.callee;
      if (typeof callee === 'object' && callee !== null) {
        const calleeRecord = callee as Record<string, unknown>;
        if (
          calleeRecord.type === 'Identifier' &&
          (calleeRecord.name === 'Worker' || calleeRecord.name === 'SharedWorker')
        ) {
          return calleeRecord.name;
        }
      }
    }
    for (const child of Object.values(record)) pending.push(child);
  }
  return undefined;
}

function reviewedExecutableAssetCarrier(
  ast: unknown,
): 'audio worklet' | 'opaque new-URL' | 'paint worklet' | 'service worker' | 'worklet' | undefined {
  const pending: unknown[] = [ast];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value !== 'object' || value === null || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
      continue;
    }
    const record = value as Record<string, unknown>;
    if (record.type === 'CallExpression' && callContainsImportMetaUrl(record)) {
      const callee = record.callee;
      if (typeof callee === 'object' && callee !== null) {
        const calleeRecord = callee as Record<string, unknown>;
        const method = staticMemberPropertyName(calleeRecord);
        const receiver =
          typeof calleeRecord.object === 'object' && calleeRecord.object !== null
            ? staticMemberPropertyName(calleeRecord.object as Record<string, unknown>)
            : undefined;
        if (method === 'register' && receiver === 'serviceWorker') return 'service worker';
        if (method === 'addModule' && receiver === 'paintWorklet') return 'paint worklet';
        if (method === 'addModule' && receiver === 'audioWorklet') return 'audio worklet';
        if (method === 'addModule') return 'worklet';
      }
    }
    for (const child of Object.values(record)) pending.push(child);
  }
  return containsImportMetaUrlConstructor(ast) ? 'opaque new-URL' : undefined;
}

function callContainsImportMetaUrl(call: Readonly<Record<string, unknown>>): boolean {
  return containsImportMetaUrlConstructor(call.arguments);
}

function containsImportMetaUrlConstructor(value: unknown): boolean {
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value !== 'object' || value === null || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
      continue;
    }
    const record = value as Record<string, unknown>;
    if (
      record.type === 'NewExpression' &&
      typeof record.callee === 'object' &&
      record.callee !== null &&
      (record.callee as Record<string, unknown>).type === 'Identifier' &&
      (record.callee as Record<string, unknown>).name === 'URL' &&
      objectContainsImportMeta(record)
    ) {
      return true;
    }
    for (const child of Object.values(record)) pending.push(child);
  }
  return false;
}

function objectContainsImportMeta(value: object): boolean {
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (typeof candidate !== 'object' || candidate === null || seen.has(candidate)) continue;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      for (const item of candidate) pending.push(item);
      continue;
    }
    const record = candidate as Record<string, unknown>;
    if (
      record.type === 'MetaProperty' &&
      typeof record.meta === 'object' &&
      record.meta !== null &&
      (record.meta as Record<string, unknown>).name === 'import'
    ) {
      return true;
    }
    for (const child of Object.values(record)) pending.push(child);
  }
  return false;
}

function staticMemberPropertyName(member: Readonly<Record<string, unknown>>): string | undefined {
  if (member.type !== 'MemberExpression' || member.computed === true) return undefined;
  const property = member.property;
  if (typeof property !== 'object' || property === null) return undefined;
  const record = property as Record<string, unknown>;
  return record.type === 'Identifier' && typeof record.name === 'string' ? record.name : undefined;
}

/**
 * Extract every source-level module edge from Rollup's parser-owned AST before Vite can externalize
 * or execute it. Unknown/dynamic forms deliberately retain an undefined specifier and close at the
 * caller (SPEC §6.6; C13).
 */
function parsedModuleEdges(ast: unknown): ParsedModuleEdge[] {
  const edges: ParsedModuleEdge[] = [];
  const pending: unknown[] = [ast];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value !== 'object' || value === null || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
      continue;
    }

    const record = value as Record<string, unknown>;
    const type = typeof record.type === 'string' ? record.type : undefined;
    if (
      type === 'ImportDeclaration' ||
      type === 'ExportAllDeclaration' ||
      type === 'ExportNamedDeclaration'
    ) {
      if (record.source !== null && record.source !== undefined) {
        edges.push({ specifier: literalAstString(record.source) });
      }
    } else if (type === 'ImportExpression') {
      edges.push({ specifier: literalAstString(record.source) });
    } else if (type === 'CallExpression' && isModuleLoaderCall(record.callee)) {
      const args = Array.isArray(record.arguments) ? record.arguments : [];
      edges.push({ specifier: args.length === 1 ? literalAstString(args[0]) : undefined });
    }

    for (const [key, child] of Object.entries(record)) {
      if (
        key === 'type' ||
        key === 'start' ||
        key === 'end' ||
        key === 'loc' ||
        key === 'range' ||
        key === 'raw'
      ) {
        continue;
      }
      pending.push(child);
    }
  }
  return edges;
}

function aliasesCommonJsLoaderAuthority(ast: unknown): boolean {
  const pending: Array<{
    key?: string;
    parent?: Record<string, unknown>;
    value: unknown;
  }> = [{ value: ast }];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const item = pending.pop()!;
    const value = item.value;
    if (typeof value !== 'object' || value === null || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const child of value) pending.push({ value: child });
      continue;
    }
    const record = value as Record<string, unknown>;
    if (isCommonJsLoaderMember(record)) {
      if (!isDirectCallCallee(item.parent, item.key, record)) return true;
    } else if (
      record.type === 'Identifier' &&
      (record.name === 'require' || record.name === '__require') &&
      !isNonComputedMemberProperty(item.parent, item.key) &&
      !isDirectCallCallee(item.parent, item.key, record)
    ) {
      return true;
    }

    for (const [key, child] of Object.entries(record)) {
      if (
        key === 'type' ||
        key === 'start' ||
        key === 'end' ||
        key === 'loc' ||
        key === 'range' ||
        key === 'raw'
      ) {
        continue;
      }
      pending.push({ key, parent: record, value: child });
    }
  }
  return false;
}

function isDirectCallCallee(
  parent: Record<string, unknown> | undefined,
  key: string | undefined,
  value: Record<string, unknown>,
): boolean {
  return parent?.type === 'CallExpression' && key === 'callee' && parent.callee === value;
}

function isNonComputedMemberProperty(
  parent: Record<string, unknown> | undefined,
  key: string | undefined,
): boolean {
  return parent?.type === 'MemberExpression' && parent.computed !== true && key === 'property';
}

function isCommonJsLoaderMember(record: Record<string, unknown>): boolean {
  if (record.type !== 'MemberExpression') return false;
  const object = record.object;
  const property = record.property;
  if (
    typeof object !== 'object' ||
    object === null ||
    (object as Record<string, unknown>).type !== 'Identifier' ||
    (object as Record<string, unknown>).name !== 'module' ||
    typeof property !== 'object' ||
    property === null
  ) {
    return false;
  }
  const propertyRecord = property as Record<string, unknown>;
  return record.computed === true
    ? propertyRecord.type === 'Literal' && propertyRecord.value === 'require'
    : propertyRecord.type === 'Identifier' && propertyRecord.name === 'require';
}

function literalAstString(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record.type === 'Literal' && typeof record.value === 'string') return record.value;
  if (
    record.type === 'TemplateLiteral' &&
    Array.isArray(record.expressions) &&
    record.expressions.length === 0 &&
    Array.isArray(record.quasis) &&
    record.quasis.length === 1
  ) {
    const quasi = record.quasis[0];
    if (typeof quasi !== 'object' || quasi === null) return undefined;
    const cooked = (quasi as { value?: { cooked?: unknown } }).value?.cooked;
    return typeof cooked === 'string' ? cooked : undefined;
  }
  return undefined;
}

function isModuleLoaderCall(callee: unknown): boolean {
  if (typeof callee !== 'object' || callee === null) return false;
  const record = callee as Record<string, unknown>;
  if (record.type === 'Import') return true;
  if (record.type === 'Identifier') {
    return record.name === 'require' || record.name === '__require';
  }
  return isCommonJsLoaderMember(record);
}

function assertSupportedArtifactExternal(
  specifier: string,
  lane: DependencyCapabilityLoaderLane,
  options: DependencyCapabilityLoaderOptions,
  form: 'module import',
): void {
  if (isBareDependencySpecifier(specifier)) {
    if (options.allowNodeBuiltins === true && isNodeBuiltinSpecifier(specifier)) return;
    if (options.allowRuntimeExternal?.(specifier) === true) return;
    throw dependencyCapabilityError(
      `uncensused dependency ${specifier} escaped the supported ${lane} artifact as a ${form}`,
    );
  }
  throw dependencyCapabilityError(
    `unresolved module target ${specifier} escaped the supported ${lane} bundle-owned artifact`,
  );
}

function artifactSpecifierIsBundleOwned(
  importerFileName: string,
  specifier: string,
  bundleOwnedFileNames: ReadonlySet<string>,
): boolean {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false;
  const target = normalizeModuleName(`${dirname(importerFileName)}/${specifier}`);
  return bundleOwnedFileNames.has(target);
}

function artifactRelativeSpecifierHasRuntimeUrlAmbiguity(specifier: string): boolean {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false;
  if (
    specifier.includes('%') ||
    specifier.includes('\\') ||
    specifier.includes('?') ||
    specifier.includes('#') ||
    specifier.includes('//')
  ) {
    return true;
  }
  for (let index = 0; index < specifier.length; index += 1) {
    const code = specifier.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

function isNodeBuiltinSpecifier(specifier: string): boolean {
  if (specifier.startsWith('node:')) return true;
  return builtinModules.includes(specifier);
}

function normalizeModuleName(value: string): string {
  const normalized: string[] = [];
  for (const part of value.replaceAll('\\', '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' && normalized.length > 0 && normalized.at(-1) !== '..') normalized.pop();
    else normalized.push(part);
  }
  return normalized.join('/') || '.';
}

function aliasReplacementFor(
  specifier: string,
  find: string | RegExp,
  replacement: string,
): string | undefined {
  if (typeof find === 'string') {
    if (specifier !== find && !specifier.startsWith(`${find}/`)) return undefined;
    return `${replacement}${specifier.slice(find.length)}`;
  }
  find.lastIndex = 0;
  if (!find.test(specifier)) return undefined;
  find.lastIndex = 0;
  return specifier.replace(find, replacement);
}

function dependencyCapabilityError(reason: string): TypeError {
  return new TypeError(`KV448 dependency loader closed: ${reason} (SPEC §6.6).`);
}
