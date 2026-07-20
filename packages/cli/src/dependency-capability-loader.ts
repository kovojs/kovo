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
  | 'component-scan'
  | 'export'
  | 'test';

interface DependencyCapabilityLoaderOptions {
  readonly allowNodeBuiltins?: boolean;
  readonly allowRuntimeExternal?: (specifier: string) => boolean;
}

interface ReviewedThirdPartyModule {
  readonly packageName: string;
  readonly root: string;
}

/**
 * Bind package imports from the exact preflight-owned app graph to its derived manifest.
 *
 * App-source byte ownership is shared with the adjacent approved-source plugin. This hook closes
 * every resolved local edge over that immutable snapshot and re-resolves bare package identities
 * immediately before Vite admits the import (SPEC §6.6).
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
  // Track the exact app-admitted package subgraph, not every file under a shared package root.
  // Framework-owned code may import a different export of the same package (for example a
  // Drizzle driver) without turning that framework edge into app dependency authority. Relative
  // children are enrolled below as the reviewed app subgraph is resolved (SPEC §6.6; C13).
  const reviewedThirdPartyModules = new Map<string, ReviewedThirdPartyModule>();
  const approvedPackageEntryModules = new Set<string>();
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
    renderChunk(code) {
      // A pinned dependency can preserve a finite target through generated `const target =
      // 'node:sqlite'; import(target)` syntax. Canonicalize only an exact same-block immutable
      // string binding into a literal edge so the emitted artifact itself carries the closed
      // module identity. Captures, expressions, mutation, and ambiguous scope stay non-literal and
      // fail in generateBundle below (SPEC §6.6; C13).
      let ast: unknown;
      try {
        ast = this.parse(code);
      } catch {
        return null;
      }
      const canonical = canonicalizeFiniteArtifactModuleEdges(code, ast);
      return canonical === code ? null : { code: canonical, map: null };
    },
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
        sourcePath === undefined ? undefined : reviewedThirdPartyModules.get(sourcePath);
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
        const browserCarrier = reviewedExecutableBrowserCarrier(ast);
        if (browserCarrier?.kind === 'worker') {
          throw dependencyCapabilityError(
            `reviewed package ${reviewedPackage.packageName} creates a ${browserCarrier.name} subgraph outside the dependency closure plugin`,
          );
        }
        const executableAssetCarrier =
          browserCarrier?.kind === 'asset'
            ? browserCarrier.name
            : containsImportMetaUrlConstructor(ast)
              ? 'opaque new-URL'
              : undefined;
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
        importerPath === undefined ? undefined : reviewedThirdPartyModules.get(importerPath);
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
      if (importerName !== undefined && isReviewedViteBuildVirtualSpecifier(specifier)) {
        return null;
      }
      if (importerName !== undefined && !isBareDependencySpecifier(specifier)) {
        const resolved = await this.resolve(specifier, importer, { skipSelf: true });
        const resolvedPath =
          resolved === null || resolved.external === true ? undefined : viteSourcePath(resolved.id);
        if (resolvedPath === undefined || !approvedPaths.has(resolvedPath)) {
          throw dependencyCapabilityError(
            `approved app source ${importerName} edge ${specifier} resolves outside the immutable approved-source snapshot in ${lane}`,
          );
        }
        return resolved;
      }
      if (reviewedPackage !== undefined && !isBareDependencySpecifier(specifier)) {
        if (importerPath === undefined) {
          throw dependencyCapabilityError(
            `reviewed package ${reviewedPackage.packageName} child edge has no canonical importer path`,
          );
        }
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
        reviewedThirdPartyModules.set(resolvedPath, reviewedPackage);
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
        reviewedThirdPartyModules.set(resolvedPath, {
          packageName: installed?.packageName ?? specifier,
          root: packageRoot,
        });
      }
      approvedPackageEntryModules.add(resolvedPath);
      // Classify and pin: Vite consumes the exact resolution checked above rather than running a
      // second resolver pass whose aliases/conditions could select different authority.
      return resolved;
    },
    generateBundle(_options, bundle) {
      // buildKovoComponentClientModules performs an SSR compiler census, consumes only the
      // compiler plugin's in-memory client-module facts, and deletes every emitted byte. Source
      // resolution above still closes app/package edges before Rollup loads them; retained-edge
      // checks belong only to artifacts that can execute or ship (SPEC §5.2/§6.6).
      if (lane === 'component-scan') return;
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
        const browserCarrier = reviewedExecutableBrowserCarrier(outputAst);
        if (browserCarrier?.kind === 'worker') {
          throw dependencyCapabilityError(
            `supported ${lane} artifact ${output.fileName} retains a ${browserCarrier.name} constructor outside the dependency closure plugin`,
          );
        }
        const executableAssetCarrier =
          browserCarrier?.kind === 'asset'
            ? browserCarrier.name
            : containsImportMetaUrlConstructor(outputAst)
              ? 'opaque new-URL'
              : undefined;
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
        const reviewedPackage = reviewedThirdPartyModules.get(importerPath);
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
            if (
              approvedImporter &&
              !isReviewedViteBuildVirtualSpecifier(importedId) &&
              (importedPath === undefined ||
                (!approvedPaths.has(importedPath) &&
                  !approvedPackageEntryModules.has(importedPath) &&
                  !reviewedThirdPartyModules.has(importedPath)))
            ) {
              throw dependencyCapabilityError(
                `approved app source ${approvedPaths.get(importerPath)} resolved import ${importedId} escapes the immutable approved-source snapshot`,
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
      if (isHtmlTemplateNode(node)) pending.push(node.content);
    }
    if ('childNodes' in node) pending.push(...node.childNodes);
  }
  return elements;
}

function isHtmlTemplateNode(
  node: DefaultTreeAdapterTypes.Node,
): node is DefaultTreeAdapterTypes.Template {
  return 'tagName' in node && node.tagName === 'template' && 'content' in node;
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

function isReviewedViteBuildVirtualSpecifier(specifier: string): boolean {
  // Vite injects this exact authority-free helper while lowering browser dynamic imports. Keep the
  // finite spelling explicit; arbitrary virtual IDs remain outside the app snapshot closure.
  return specifier === '\0vite/preload-helper.js';
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

type ReviewedExecutableAssetCarrier =
  | 'audio worklet'
  | 'opaque browser executable carrier'
  | 'paint worklet'
  | 'service worker'
  | 'worklet';

type ReviewedExecutableBrowserCarrier =
  | { readonly kind: 'asset'; readonly name: ReviewedExecutableAssetCarrier }
  | { readonly kind: 'worker'; readonly name: 'SharedWorker' | 'Worker' };

type BrowserStaticAtom =
  | {
      readonly kind: 'array';
      readonly node: Record<string, unknown>;
      readonly scope: BrowserStaticScope;
    }
  | { readonly kind: 'closed' }
  | { readonly kind: 'constructor-value' }
  | { readonly kind: 'css' }
  | { readonly kind: 'document' }
  | { readonly kind: 'dynamic-code'; readonly name: 'Function' | 'eval' }
  | { readonly kind: 'frames' }
  | { readonly kind: 'global' }
  | {
      readonly constructor: {
        readonly kind: 'namespace';
        readonly node: Record<string, unknown>;
        readonly scope: BrowserStaticScope;
      };
      readonly kind: 'instance';
    }
  | { readonly kind: 'navigator' }
  | {
      readonly kind: 'namespace';
      readonly node: Record<string, unknown>;
      readonly scope: BrowserStaticScope;
    }
  | { readonly kind: 'object-builtin' }
  | { readonly kind: 'object-define-property' }
  | { readonly kind: 'object-freeze' }
  | {
      readonly kind: 'object';
      readonly node: Record<string, unknown>;
      readonly scope: BrowserStaticScope;
    }
  | { readonly kind: 'reflect' }
  | { readonly kind: 'reflect-get' }
  | {
      readonly callArgumentIndex?: number;
      readonly callReceiver?: true;
      readonly kind: 'plain';
    }
  | { readonly kind: 'proxy-constructor' }
  | {
      readonly constructor: {
        readonly kind: 'namespace';
        readonly node: Record<string, unknown>;
        readonly scope: BrowserStaticScope;
      };
      readonly kind: 'prototype';
    }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'timer'; readonly name: 'setInterval' | 'setTimeout' }
  | { readonly carrier: ReviewedExecutableAssetCarrier; readonly kind: 'asset' }
  | { readonly kind: 'worker'; readonly name: 'SharedWorker' | 'Worker' };

interface BrowserBindingProjection {
  readonly expression?: unknown;
  readonly property?: string;
  readonly scope?: BrowserStaticScope;
}

interface BrowserBindingSource {
  readonly expression: unknown;
  readonly projections: readonly BrowserBindingProjection[];
  readonly scope: BrowserStaticScope;
}

interface BrowserStaticBinding {
  readonly scope: BrowserStaticScope;
  readonly sources: BrowserBindingSource[];
  opaque: boolean;
}

interface BrowserStaticScope {
  readonly bindings: Map<string, BrowserStaticBinding>;
  readonly kind: 'block' | 'function' | 'program';
  readonly parent?: BrowserStaticScope;
}

interface BrowserStaticIndex {
  readonly bindings: BrowserStaticBinding[];
  readonly bindingIdentifiers: WeakSet<object>;
  readonly callableEffects: WeakMap<object, BrowserStaticCallableEffects>;
  readonly memberSources: WeakMap<object, Map<string, BrowserBindingSource[]>>;
  readonly opaqueMemberSources: WeakSet<object>;
  readonly opaquePrototypeProperties: WeakMap<object, Set<string>>;
  readonly opaquePrototypes: WeakSet<object>;
  readonly root: BrowserStaticScope;
  readonly scopeByNode: WeakMap<object, BrowserStaticScope>;
  effectAnalysisClosed: boolean;
}

interface BrowserStaticEvaluationState {
  readonly bindingStack: Set<BrowserStaticBinding>;
  readonly budget?: BrowserStaticEvaluationBudget;
  readonly callReceiver?: true;
  readonly depth: number;
  readonly overrides?: ReadonlyMap<BrowserStaticBinding, readonly BrowserStaticAtom[]>;
}

interface BrowserStaticCallableEffects {
  readonly parameterIndexes: readonly number[];
  readonly receiver: boolean;
  readonly variadic: boolean;
}

interface BrowserStaticEvaluationBudget {
  exhausted: boolean;
  recursive: boolean;
}

function nextBrowserStaticEvaluationState(
  state: BrowserStaticEvaluationState,
  bindingStack: Set<BrowserStaticBinding> = state.bindingStack,
): BrowserStaticEvaluationState {
  return {
    bindingStack,
    ...(state.budget === undefined ? {} : { budget: state.budget }),
    ...(state.callReceiver === true ? { callReceiver: true as const } : {}),
    depth: state.depth + 1,
    ...(state.overrides === undefined ? {} : { overrides: state.overrides }),
  };
}

const browserAstMetadataKeys = new Set(['type', 'start', 'end', 'loc', 'range', 'raw']);
const maxBrowserFiniteStaticStrings = 32;

/**
 * Close Vite's executable browser carriers over a small, explicit expression language.
 *
 * The language follows lexical bindings through immutable/mutable local aliases, finite string
 * expressions, object/array projections, nested browser-global aliases, and exact Reflect.get.
 * Every value has an explicit verdict: PLAIN values are proved local, AUTHORITY atoms name a known
 * browser carrier, and CLOSED values are unsupported or may transfer authority. CLOSED values fail
 * at executable-constructor and browser-registration sinks rather than collapsing to a safe local
 * value. This loader check is a defense-in-depth build bound for the supported subset, not the
 * authoritative pre-evaluation proof or a same-realm JavaScript sandbox (SPEC §6.6; C13).
 */
function reviewedExecutableBrowserCarrier(
  ast: unknown,
): ReviewedExecutableBrowserCarrier | undefined {
  if (!isAstRecord(ast)) return undefined;
  const index = buildBrowserStaticIndex(ast);
  if (index.effectAnalysisClosed) {
    return { kind: 'asset', name: 'opaque browser executable carrier' };
  }

  const visit = (
    value: unknown,
    parent?: Readonly<Record<string, unknown>>,
    key?: string,
  ): ReviewedExecutableBrowserCarrier | undefined => {
    if (typeof value !== 'object' || value === null) return undefined;
    if (Array.isArray(value)) {
      for (const child of value) {
        const finding = visit(child, parent, key);
        if (finding !== undefined) return finding;
      }
      return undefined;
    }
    const record = value as Record<string, unknown>;
    const scope = index.scopeByNode.get(record) ?? index.root;
    if (
      record.type === 'MemberExpression' ||
      record.type === 'CallExpression' ||
      (record.type === 'Identifier' &&
        browserIdentifierIsValueReference(record, parent, key, index.bindingIdentifiers))
    ) {
      const finding = browserCarrierFromAtoms(
        evaluateBrowserStaticValue(record, scope, index, { bindingStack: new Set(), depth: 0 }),
      );
      if (finding !== undefined) return finding;
    }
    if (record.type === 'NewExpression') {
      const finding = browserExecutableConstructor(record, scope, index);
      if (finding !== undefined) return finding;
    }
    if (record.type === 'CallExpression') {
      const finding = browserExecutableMethodCall(record, scope, index);
      if (finding !== undefined) return finding;
    }
    for (const [childKey, child] of Object.entries(record)) {
      if (browserAstMetadataKeys.has(childKey)) continue;
      const finding = visit(child, record, childKey);
      if (finding !== undefined) return finding;
    }
    return undefined;
  };

  const directFinding = visit(ast);
  if (directFinding !== undefined) return directFinding;
  // Destructuring can acquire a carrier without spelling a MemberExpression. Re-evaluate every
  // binding projection so `{ Worker: W } = globalThis` and its finite computed variants close even
  // when W is otherwise unused, while projections from proven local object literals remain safe.
  for (const binding of index.bindings) {
    const finding = browserCarrierFromAtoms(
      evaluateBrowserBinding(binding, index, { bindingStack: new Set(), depth: 0 }),
    );
    if (finding !== undefined) return finding;
  }
  return undefined;
}

function browserExecutableConstructor(
  expression: Readonly<Record<string, unknown>>,
  scope: BrowserStaticScope,
  index: BrowserStaticIndex,
): ReviewedExecutableBrowserCarrier | undefined {
  const state: BrowserStaticEvaluationState = { bindingStack: new Set(), depth: 0 };
  const callee = expression.callee;
  const calleeAtoms = evaluateBrowserStaticValue(callee, scope, index, state);
  const direct = browserCarrierFromAtoms(calleeAtoms);
  if (direct?.kind === 'worker') return direct;
  if (calleeAtoms.some((atom) => atom.kind === 'closed' || atom.kind === 'dynamic-code')) {
    return { kind: 'asset', name: 'opaque browser executable carrier' };
  }
  if (!isAstRecord(callee) || callee.type !== 'MemberExpression') return undefined;
  const properties = browserStaticPropertyNames(callee, scope, index, state);
  const workerName = properties?.find(
    (property): property is 'SharedWorker' | 'Worker' =>
      property === 'Worker' || property === 'SharedWorker',
  );
  if (workerName === undefined) return undefined;
  const receiver = evaluateBrowserStaticValue(callee.object, scope, index, state);
  return browserReceiverIsProvenPlain(receiver) ? undefined : { kind: 'worker', name: workerName };
}

function browserCarrierFromAtoms(
  atoms: readonly BrowserStaticAtom[],
): ReviewedExecutableBrowserCarrier | undefined {
  for (const atom of atoms) {
    if (atom.kind === 'worker') return { kind: 'worker', name: atom.name };
    if (atom.kind === 'asset') return { kind: 'asset', name: atom.carrier };
  }
  return undefined;
}

function browserExecutableMethodCall(
  call: Readonly<Record<string, unknown>>,
  scope: BrowserStaticScope,
  index: BrowserStaticIndex,
): ReviewedExecutableBrowserCarrier | undefined {
  const callee = call.callee;
  const calleeAtoms = evaluateBrowserStaticValue(callee, scope, index, {
    bindingStack: new Set(),
    depth: 0,
  });
  if (calleeAtoms.some((atom) => atom.kind === 'dynamic-code')) {
    return { kind: 'asset', name: 'opaque browser executable carrier' };
  }
  if (calleeAtoms.some((atom) => atom.kind === 'timer')) {
    const args = Array.isArray(call.arguments) ? call.arguments : [];
    const callback = evaluateBrowserStaticValue(args[0], scope, index, {
      bindingStack: new Set(),
      depth: 0,
    });
    if (callback.some((atom) => atom.kind === 'closed' || atom.kind === 'string')) {
      return { kind: 'asset', name: 'opaque browser executable carrier' };
    }
  }
  if (!isAstRecord(callee) || callee.type !== 'MemberExpression') return undefined;
  const properties = browserStaticPropertyNames(callee, scope, index, {
    bindingStack: new Set(),
    depth: 0,
  });
  if (properties === undefined) return undefined;
  const receiver = evaluateBrowserStaticValue(callee.object, scope, index, {
    bindingStack: new Set(),
    depth: 0,
  });
  if (properties.includes('register')) {
    if (receiver.some((atom) => atom.kind === 'asset' && atom.carrier === 'service worker')) {
      return { kind: 'asset', name: 'service worker' };
    }
    if (
      browserExpressionAcquiresProperty(callee.object, 'serviceWorker', scope, index) &&
      !browserReceiverIsProvenPlain(receiver)
    ) {
      return { kind: 'asset', name: 'service worker' };
    }
    if (receiver.some((atom) => atom.kind === 'closed')) {
      return { kind: 'asset', name: 'service worker' };
    }
  }
  if (!properties.includes('addModule')) return undefined;
  for (const atom of receiver) {
    if (atom.kind !== 'asset') continue;
    if (
      atom.carrier === 'audio worklet' ||
      atom.carrier === 'paint worklet' ||
      atom.carrier === 'worklet'
    ) {
      return { kind: 'asset', name: atom.carrier };
    }
  }
  if (receiver.some((atom) => atom.kind === 'closed')) {
    return { kind: 'asset', name: 'worklet' };
  }
  return undefined;
}

function browserExpressionAcquiresProperty(
  value: unknown,
  expectedProperty: string,
  scope: BrowserStaticScope,
  index: BrowserStaticIndex,
): boolean {
  if (!isAstRecord(value)) return false;
  const state: BrowserStaticEvaluationState = { bindingStack: new Set(), depth: 0 };
  if (value.type === 'MemberExpression') {
    return (
      browserStaticPropertyNames(value, scope, index, state)?.includes(expectedProperty) === true
    );
  }
  if (value.type !== 'CallExpression') return false;
  const callee = evaluateBrowserStaticValue(value.callee, scope, index, state);
  if (!callee.some((atom) => atom.kind === 'reflect-get')) return false;
  const args = Array.isArray(value.arguments) ? value.arguments : [];
  return (
    browserFiniteStaticStrings(args[1], scope, index, state)?.includes(expectedProperty) === true
  );
}

function browserReceiverIsProvenPlain(receivers: readonly BrowserStaticAtom[]): boolean {
  return (
    receivers.length > 0 &&
    receivers.every(
      (receiver) =>
        receiver.kind === 'array' ||
        receiver.kind === 'namespace' ||
        receiver.kind === 'object' ||
        receiver.kind === 'plain',
    )
  );
}

function buildBrowserStaticIndex(ast: Record<string, unknown>): BrowserStaticIndex {
  const root: BrowserStaticScope = { bindings: new Map(), kind: 'program' };
  const index: BrowserStaticIndex = {
    bindings: [],
    bindingIdentifiers: new WeakSet(),
    callableEffects: new WeakMap(),
    effectAnalysisClosed: false,
    memberSources: new WeakMap(),
    opaqueMemberSources: new WeakSet(),
    opaquePrototypeProperties: new WeakMap(),
    opaquePrototypes: new WeakSet(),
    root,
    scopeByNode: new WeakMap(),
  };

  const collect = (value: unknown, scope: BrowserStaticScope): void => {
    if (typeof value !== 'object' || value === null) return;
    if (Array.isArray(value)) {
      for (const child of value) collect(child, scope);
      return;
    }
    const record = value as Record<string, unknown>;
    const type = typeof record.type === 'string' ? record.type : undefined;
    if (type === 'ClassDeclaration' || type === 'ClassExpression') {
      const body =
        isAstRecord(record.body) && record.body.type === 'ClassBody' ? record.body : undefined;
      const elements = body !== undefined && Array.isArray(body.body) ? body.body : [];
      if (elements.some((element) => isAstRecord(element) && element.type === 'StaticBlock')) {
        // Static blocks are eagerly executed with the class constructor as `this`; keep that
        // general-JS mutation surface closed rather than losing its implicit receiver effects.
        index.opaqueMemberSources.add(record);
      }
    }
    if (type === 'Program') {
      index.scopeByNode.set(record, scope);
      collectBrowserAstChildren(record, scope, collect);
      return;
    }
    if (type === 'BlockStatement') {
      const blockScope: BrowserStaticScope = { bindings: new Map(), kind: 'block', parent: scope };
      index.scopeByNode.set(record, blockScope);
      collectBrowserAstChildren(record, blockScope, collect);
      return;
    }
    if (
      type === 'ForStatement' ||
      type === 'ForInStatement' ||
      type === 'ForOfStatement' ||
      type === 'StaticBlock' ||
      type === 'SwitchStatement'
    ) {
      const controlScope: BrowserStaticScope = {
        bindings: new Map(),
        kind: 'block',
        parent: scope,
      };
      index.scopeByNode.set(record, controlScope);
      collectBrowserAstChildren(record, controlScope, collect);
      return;
    }
    if (browserAstFunctionType(type)) {
      index.scopeByNode.set(record, scope);
      if (type === 'FunctionDeclaration') {
        addBrowserPatternBindings(
          record.id,
          scope,
          { expression: record, projections: [], scope },
          index,
        );
      }
      const functionScope: BrowserStaticScope = {
        bindings: new Map(),
        kind: 'function',
        parent: scope,
      };
      if (type === 'FunctionExpression') {
        addBrowserPatternBindings(
          record.id,
          functionScope,
          { expression: record, projections: [], scope },
          index,
        );
      }
      const parameters = Array.isArray(record.params) ? record.params : [];
      for (const parameter of parameters) addOpaqueBrowserPattern(parameter, functionScope, index);
      for (const [childKey, child] of Object.entries(record)) {
        if (browserAstMetadataKeys.has(childKey) || childKey === 'id') continue;
        collect(child, functionScope);
      }
      return;
    }
    if (type === 'CatchClause') {
      const catchScope: BrowserStaticScope = { bindings: new Map(), kind: 'block', parent: scope };
      index.scopeByNode.set(record, catchScope);
      addOpaqueBrowserPattern(record.param, catchScope, index);
      for (const [childKey, child] of Object.entries(record)) {
        if (browserAstMetadataKeys.has(childKey) || childKey === 'param') continue;
        collect(child, catchScope);
      }
      return;
    }
    if (type === 'ClassExpression') {
      index.scopeByNode.set(record, scope);
      const classScope: BrowserStaticScope = { bindings: new Map(), kind: 'block', parent: scope };
      addOpaqueBrowserPattern(record.id, classScope, index);
      for (const [childKey, child] of Object.entries(record)) {
        if (browserAstMetadataKeys.has(childKey) || childKey === 'id') continue;
        collect(child, classScope);
      }
      return;
    }
    index.scopeByNode.set(record, scope);
    if (type === 'VariableDeclaration') {
      const target = record.kind === 'var' ? nearestBrowserFunctionScope(scope) : scope;
      const declarations = Array.isArray(record.declarations) ? record.declarations : [];
      for (const declaration of declarations) {
        if (!isAstRecord(declaration)) continue;
        addBrowserPatternBindings(
          declaration.id,
          target,
          declaration.init === null || declaration.init === undefined
            ? undefined
            : { expression: declaration.init, projections: [], scope },
          index,
        );
      }
    } else if (type === 'ClassDeclaration') {
      addBrowserPatternBindings(
        record.id,
        scope,
        { expression: record, projections: [], scope },
        index,
      );
    } else if (
      type === 'ImportSpecifier' ||
      type === 'ImportDefaultSpecifier' ||
      type === 'ImportNamespaceSpecifier'
    ) {
      addPlainBrowserPattern(record.local, scope, index);
    }
    collectBrowserAstChildren(record, scope, collect);
  };

  collect(ast, root);
  collectBrowserAssignmentSources(ast, index);
  return index;
}

function collectBrowserAstChildren(
  record: Readonly<Record<string, unknown>>,
  scope: BrowserStaticScope,
  collect: (value: unknown, scope: BrowserStaticScope) => void,
): void {
  for (const [key, child] of Object.entries(record)) {
    if (browserAstMetadataKeys.has(key)) continue;
    collect(child, scope);
  }
}

function browserAstFunctionType(type: string | undefined): boolean {
  return (
    type === 'ArrowFunctionExpression' ||
    type === 'FunctionDeclaration' ||
    type === 'FunctionExpression'
  );
}

function nearestBrowserFunctionScope(scope: BrowserStaticScope): BrowserStaticScope {
  let candidate = scope;
  while (candidate.kind === 'block' && candidate.parent !== undefined) {
    candidate = candidate.parent;
  }
  return candidate;
}

function ensureBrowserBinding(
  name: string,
  scope: BrowserStaticScope,
  index: BrowserStaticIndex,
): BrowserStaticBinding {
  const existing = scope.bindings.get(name);
  if (existing !== undefined) return existing;
  const binding: BrowserStaticBinding = { opaque: false, scope, sources: [] };
  scope.bindings.set(name, binding);
  index.bindings.push(binding);
  return binding;
}

function addOpaqueBrowserPattern(
  pattern: unknown,
  scope: BrowserStaticScope,
  index: BrowserStaticIndex,
): void {
  addBrowserPatternBindings(pattern, scope, undefined, index);
}

function addPlainBrowserPattern(
  pattern: unknown,
  scope: BrowserStaticScope,
  index: BrowserStaticIndex,
): void {
  addBrowserPatternBindings(
    pattern,
    scope,
    { expression: { type: 'Literal', value: null }, projections: [], scope },
    index,
  );
}

function addBrowserPatternBindings(
  pattern: unknown,
  scope: BrowserStaticScope,
  source: BrowserBindingSource | undefined,
  index: BrowserStaticIndex,
): void {
  if (!isAstRecord(pattern)) return;
  if (pattern.type === 'Identifier' && typeof pattern.name === 'string') {
    index.bindingIdentifiers.add(pattern);
    const binding = ensureBrowserBinding(pattern.name, scope, index);
    if (source === undefined) binding.opaque = true;
    else binding.sources.push(source);
    return;
  }
  if (pattern.type === 'AssignmentPattern') {
    addBrowserPatternBindings(pattern.left, scope, source, index);
    addBrowserPatternBindings(
      pattern.left,
      scope,
      pattern.right === undefined
        ? undefined
        : { expression: pattern.right, projections: [], scope },
      index,
    );
    return;
  }
  if (pattern.type === 'RestElement') {
    addOpaqueBrowserPattern(pattern.argument, scope, index);
    return;
  }
  if (pattern.type === 'ObjectPattern') {
    const properties = Array.isArray(pattern.properties) ? pattern.properties : [];
    for (const property of properties) {
      if (!isAstRecord(property) || property.type !== 'Property') {
        if (isAstRecord(property)) addOpaqueBrowserPattern(property.argument, scope, index);
        continue;
      }
      const propertyName = staticObjectPropertyName(property);
      if (source === undefined) {
        addOpaqueBrowserPattern(property.value, scope, index);
        continue;
      }
      const projection: BrowserBindingProjection =
        propertyName !== undefined
          ? { property: propertyName }
          : property.computed === true && property.key !== undefined
            ? { expression: property.key, scope }
            : {};
      addBrowserPatternBindings(
        property.value,
        scope,
        {
          expression: source.expression,
          projections: [...source.projections, projection],
          scope: source.scope,
        },
        index,
      );
    }
    return;
  }
  if (pattern.type === 'ArrayPattern') {
    const elements = Array.isArray(pattern.elements) ? pattern.elements : [];
    for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
      const element = elements[elementIndex];
      if (element === null || element === undefined) continue;
      if (source === undefined) addOpaqueBrowserPattern(element, scope, index);
      else {
        addBrowserPatternBindings(
          element,
          scope,
          {
            expression: source.expression,
            projections: [...source.projections, { property: String(elementIndex) }],
            scope: source.scope,
          },
          index,
        );
      }
    }
  }
}

function collectBrowserAssignmentSources(ast: unknown, index: BrowserStaticIndex): void {
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (typeof value !== 'object' || value === null || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    const record = value as Record<string, unknown>;
    const scope = index.scopeByNode.get(record) ?? index.root;
    if (record.type === 'AssignmentExpression') {
      if (isAstRecord(record.left) && record.left.type === 'MemberExpression') {
        if (record.operator === '=') {
          collectBrowserSetterAssignment(record.left, record.right, scope, index);
        }
        collectBrowserMemberAssignment(
          record.left,
          record.right,
          record.operator === '=',
          scope,
          index,
        );
      }
      if (record.operator === '=') {
        addBrowserAssignmentPattern(record.left, record.right, scope, index);
      } else {
        markBrowserAssignmentPatternOpaque(record.left, scope, index);
      }
    } else if (record.type === 'UpdateExpression') {
      if (isAstRecord(record.argument) && record.argument.type === 'MemberExpression') {
        collectBrowserMemberAssignment(record.argument, undefined, false, scope, index);
      }
      markBrowserAssignmentPatternOpaque(record.argument, scope, index);
    } else if (
      (record.type === 'ForInStatement' || record.type === 'ForOfStatement') &&
      isAstRecord(record.left) &&
      record.left.type !== 'VariableDeclaration'
    ) {
      // Iteration assigns an element/key rather than the right-hand collection itself. Keep that
      // unsupported transform closed instead of attaching a falsely precise collection source.
      markBrowserAssignmentPatternOpaque(record.left, scope, index);
      markBrowserStructuredArgumentOpaque(record.right, scope, index, {
        bindingStack: new Set(),
        depth: 0,
      });
    }
    if (record.type === 'CallExpression') {
      collectBrowserOpaqueCallArguments(record, scope, index);
    } else if (record.type === 'NewExpression') {
      collectBrowserOpaqueConstructorArguments(record, scope, index);
    } else if (record.type === 'TaggedTemplateExpression') {
      const state: BrowserStaticEvaluationState = { bindingStack: new Set(), depth: 0 };
      markBrowserStructuredArgumentOpaque(record.tag, scope, index, state);
      if (isAstRecord(record.tag) && record.tag.type === 'MemberExpression') {
        markBrowserStructuredArgumentOpaque(record.tag.object, scope, index, state);
      }
      const quasi = isAstRecord(record.quasi) ? record.quasi : undefined;
      const expressions =
        quasi !== undefined && Array.isArray(quasi.expressions) ? quasi.expressions : [];
      for (const expression of expressions) {
        markBrowserStructuredArgumentOpaque(expression, scope, index, state);
      }
    }
    for (const [key, child] of Object.entries(record)) {
      if (!browserAstMetadataKeys.has(key)) visit(child);
    }
  };
  visit(ast);
}

function collectBrowserOpaqueCallArguments(
  call: Readonly<Record<string, unknown>>,
  scope: BrowserStaticScope,
  index: BrowserStaticIndex,
): void {
  const state: BrowserStaticEvaluationState = { bindingStack: new Set(), depth: 0 };
  const calleeMember =
    isAstRecord(call.callee) && call.callee.type === 'MemberExpression' ? call.callee : undefined;
  const calleeProperties =
    calleeMember === undefined
      ? undefined
      : browserStaticPropertyNames(calleeMember, scope, index, state);
  const args = Array.isArray(call.arguments) ? call.arguments : [];
  if (
    calleeMember !== undefined &&
    (calleeProperties === undefined ||
      calleeProperties.some((property) =>
        ['__defineGetter__', '__defineSetter__', 'apply', 'bind', 'call'].includes(property),
      ))
  ) {
    // Legacy accessor mutation and indirect invocation are outside the finite effect language.
    // Close both the receiver and structured arguments instead of treating a plain-looking member
    // name as proof that authority cannot be transferred (SPEC §6.6; C13).
    markBrowserStructuredArgumentOpaque(calleeMember.object, scope, index, state);
    for (const argument of args) markBrowserStructuredArgumentOpaque(argument, scope, index, state);
    return;
  }
  const callee = evaluateBrowserStaticValue(call.callee, scope, index, state);
  if (callee.length > 0 && callee.every((atom) => atom.kind === 'object-define-property')) {
    collectBrowserDefinePropertyEffects(call, scope, index, state);
    return;
  }
  if (callee.length > 0 && callee.every((atom) => atom.kind === 'object-freeze')) return;
  const affectedArguments = new Set<number>();
  const callHasUnsupportedTarget =
    callee.length === 0 ||
    callee.some(
      (atom) => atom.kind !== 'namespace' || !browserAstFunctionType(String(atom.node.type)),
    );
  if (callHasUnsupportedTarget) {
    for (let argumentIndex = 0; argumentIndex < args.length; argumentIndex += 1) {
      affectedArguments.add(argumentIndex);
    }
  }
  const localCallables = callee.filter(
    (atom): atom is Extract<BrowserStaticAtom, { kind: 'namespace' }> =>
      atom.kind === 'namespace' && browserAstFunctionType(String(atom.node.type)),
  );
  const receiverAffected = collectBrowserAffectedInvocationArguments(
    localCallables,
    args,
    scope,
    index,
    state,
    affectedArguments,
  );
  for (const argumentIndex of affectedArguments) {
    markBrowserStructuredArgumentOpaque(args[argumentIndex], scope, index, state);
  }
  const narrowedArrayJoin =
    callHasUnsupportedTarget &&
    calleeMember !== undefined &&
    calleeProperties?.length === 1 &&
    calleeProperties[0] === 'join' &&
    callee.length === 1 &&
    callee[0]?.kind === 'plain' &&
    collectBrowserArrayJoinCoercionEffects(calleeMember.object, scope, index, state);
  if (
    (receiverAffected || (callHasUnsupportedTarget && !narrowedArrayJoin)) &&
    calleeMember !== undefined
  ) {
    markBrowserStructuredArgumentOpaque(calleeMember.object, scope, index, state);
  }
}

function collectBrowserArrayJoinCoercionEffects(
  receiver: unknown,
  scope: BrowserStaticScope,
  index: BrowserStaticIndex,
  state: BrowserStaticEvaluationState,
): boolean {
  const arrays = evaluateBrowserStaticValue(receiver, scope, index, state);
  if (
    arrays.length === 0 ||
    !arrays.every(
      (atom): atom is Extract<BrowserStaticAtom, { kind: 'array' }> => atom.kind === 'array',
    )
  ) {
    return false;
  }
  const seen = new Set<object>();
  const markCoercedValue = (
    value: unknown,
    valueScope: BrowserStaticScope,
    depth: number,
  ): void => {
    if (depth > 48) {
      index.effectAnalysisClosed = true;
      return;
    }
    const expression =
      isAstRecord(value) && value.type === 'SpreadElement' ? value.argument : value;
    for (const atom of evaluateBrowserStaticValue(expression, valueScope, index, state)) {
      if (atom.kind === 'array') {
        if (seen.has(atom.node)) continue;
        seen.add(atom.node);
        index.opaqueMemberSources.add(atom.node);
        const elements = Array.isArray(atom.node.elements) ? atom.node.elements : [];
        for (const element of elements) markCoercedValue(element, atom.scope, depth + 1);
      } else if (atom.kind === 'namespace' || atom.kind === 'object') {
        index.opaqueMemberSources.add(atom.node);
      } else if (atom.kind === 'prototype') {
        index.opaquePrototypes.add(atom.constructor.node);
      } else if (atom.kind === 'instance') {
        index.opaqueMemberSources.add(atom.constructor.node);
      }
    }
  };
  for (const array of arrays) {
    const elements = Array.isArray(array.node.elements) ? array.node.elements : [];
    for (const element of elements) markCoercedValue(element, array.scope, 0);
  }
  return true;
}

function collectBrowserDefinePropertyEffects(
  call: Readonly<Record<string, unknown>>,
  scope: BrowserStaticScope,
  index: BrowserStaticIndex,
  state: BrowserStaticEvaluationState,
): void {
  const args = Array.isArray(call.arguments) ? call.arguments : [];
  const targets = evaluateBrowserStaticValue(args[0], scope, index, state);
  const properties = browserFiniteStaticStrings(args[1], scope, index, state);
  let closed = targets.length === 0;
  for (const target of targets) {
    if (target.kind === 'prototype') {
      if (properties === undefined) {
        index.opaquePrototypes.add(target.constructor.node);
      } else {
        let opaque = index.opaquePrototypeProperties.get(target.constructor.node);
        if (opaque === undefined) {
          opaque = new Set();
          index.opaquePrototypeProperties.set(target.constructor.node, opaque);
        }
        for (const property of properties) opaque.add(property);
      }
    } else if (target.kind === 'array' || target.kind === 'namespace' || target.kind === 'object') {
      index.opaqueMemberSources.add(target.node);
    } else if (target.kind === 'instance') {
      index.opaqueMemberSources.add(target.constructor.node);
    } else {
      closed = true;
    }
  }
  markBrowserStructuredArgumentOpaque(args[2], scope, index, state);
  if (!closed) return;
  for (const argument of args) {
    markBrowserStructuredArgumentOpaque(argument, scope, index, state);
  }
}

function collectBrowserOpaqueConstructorArguments(
  expression: Readonly<Record<string, unknown>>,
  scope: BrowserStaticScope,
  index: BrowserStaticIndex,
): void {
  const state: BrowserStaticEvaluationState = { bindingStack: new Set(), depth: 0 };
  const callee = evaluateBrowserStaticValue(expression.callee, scope, index, state);
  const args = Array.isArray(expression.arguments) ? expression.arguments : [];
  const affectedArguments = new Set<number>();
  const callables: Extract<BrowserStaticAtom, { kind: 'namespace' }>[] = [];
  let closed = callee.length === 0;
  for (const atom of callee) {
    if (atom.kind !== 'namespace') {
      closed = true;
      continue;
    }
    const constructors = browserStaticConstructorCallables(atom, index, state, new Set(), 0);
    if (constructors === undefined) closed = true;
    else callables.push(...constructors);
  }
  if (closed) {
    for (let argumentIndex = 0; argumentIndex < args.length; argumentIndex += 1) {
      affectedArguments.add(argumentIndex);
    }
  }
  collectBrowserAffectedInvocationArguments(
    callables,
    args,
    scope,
    index,
    state,
    affectedArguments,
  );
  for (const argumentIndex of affectedArguments) {
    markBrowserStructuredArgumentOpaque(args[argumentIndex], scope, index, state);
  }
}

function collectBrowserAffectedInvocationArguments(
  callables: readonly Extract<BrowserStaticAtom, { kind: 'namespace' }>[],
  args: readonly unknown[],
  scope: BrowserStaticScope,
  index: BrowserStaticIndex,
  state: BrowserStaticEvaluationState,
  affectedArguments: Set<number>,
): boolean {
  let receiverAffected = false;
  for (const callable of callables) {
    const parameters = Array.isArray(callable.node.params) ? callable.node.params : [];
    const effects = browserStaticCallableEffects(callable, index, new Set());
    receiverAffected ||= effects.receiver;
    if (effects.variadic) {
      for (let argumentIndex = 0; argumentIndex < args.length; argumentIndex += 1) {
        affectedArguments.add(argumentIndex);
      }
    }
    for (const parameterIndex of effects.parameterIndexes) {
      const parameter = parameters[parameterIndex];
      if (isAstRecord(parameter) && parameter.type === 'RestElement') {
        for (let argumentIndex = parameterIndex; argumentIndex < args.length; argumentIndex += 1) {
          affectedArguments.add(argumentIndex);
        }
      } else if (parameterIndex < args.length) {
        affectedArguments.add(parameterIndex);
      }
    }
  }
  return receiverAffected;
}

function browserStaticConstructorCallables(
  constructor: Extract<BrowserStaticAtom, { kind: 'namespace' }>,
  index: BrowserStaticIndex,
  state: BrowserStaticEvaluationState,
  active: Set<object>,
  depth: number,
): readonly Extract<BrowserStaticAtom, { kind: 'namespace' }>[] | undefined {
  if (depth > 48 || active.has(constructor.node)) return undefined;
  if (browserAstFunctionType(String(constructor.node.type))) return [constructor];
  if (constructor.node.type !== 'ClassDeclaration' && constructor.node.type !== 'ClassExpression') {
    return undefined;
  }
  const body = constructor.node.body;
  if (!isAstRecord(body) || body.type !== 'ClassBody') return undefined;
  active.add(constructor.node);
  const constructors = (Array.isArray(body.body) ? body.body : []).filter(
    (element): element is Record<string, unknown> =>
      isAstRecord(element) &&
      element.type === 'MethodDefinition' &&
      element.kind === 'constructor' &&
      element.static !== true,
  );
  if (constructors.length > 1) {
    active.delete(constructor.node);
    return undefined;
  }
  const explicit = constructors[0];
  if (explicit !== undefined) {
    const value = explicit.value;
    active.delete(constructor.node);
    if (!isAstRecord(value) || !browserAstFunctionType(String(value.type))) return undefined;
    return [
      {
        kind: 'namespace',
        node: value,
        scope: index.scopeByNode.get(value) ?? constructor.scope,
      },
    ];
  }
  const superClass = constructor.node.superClass;
  if (superClass === null || superClass === undefined) {
    active.delete(constructor.node);
    return [];
  }
  const supers = evaluateBrowserStaticValue(superClass, constructor.scope, index, state);
  const inherited: Extract<BrowserStaticAtom, { kind: 'namespace' }>[] = [];
  for (const candidate of supers) {
    if (candidate.kind !== 'namespace') {
      active.delete(constructor.node);
      return undefined;
    }
    const callables = browserStaticConstructorCallables(
      candidate,
      index,
      nextBrowserStaticEvaluationState(state),
      active,
      depth + 1,
    );
    if (callables === undefined) {
      active.delete(constructor.node);
      return undefined;
    }
    inherited.push(...callables);
  }
  active.delete(constructor.node);
  return inherited;
}

/**
 * Summarize only which parameters a local callable may mutate or escape. A parameter-origin atom
 * survives finite aliases and member projections, so direct writes and nested helper effects map
 * back to the corresponding call arguments. Effects on freshly created locals do not taint an
 * unrelated argument. A callable returned from the helper is an escape only for outer parameters
 * that its closure actually captures; ordinary projected return values remain owned by
 * evaluateBrowserStaticCallable. This is a conservative post-bundle backstop, not general
 * JavaScript effect analysis (SPEC §6.6; C13).
 */
function browserStaticCallableEffects(
  callable: Extract<BrowserStaticAtom, { kind: 'namespace' }>,
  index: BrowserStaticIndex,
  active: Set<object>,
): BrowserStaticCallableEffects {
  const cached = index.callableEffects.get(callable.node);
  if (cached !== undefined) return cached;
  const parameters = Array.isArray(callable.node.params) ? callable.node.params : [];
  const allParameters = parameters.map((_, parameterIndex) => parameterIndex);
  const closedEffects: BrowserStaticCallableEffects = {
    parameterIndexes: allParameters,
    receiver: true,
    variadic: true,
  };
  if (active.has(callable.node)) return closedEffects;
  const body = callable.node.body;
  if (!isAstRecord(body)) return closedEffects;
  active.add(callable.node);
  const callableScope = index.scopeByNode.get(body) ?? callable.scope;
  const callableFunctionScope = nearestBrowserFunctionScope(callableScope);
  const overrides = new Map<BrowserStaticBinding, readonly BrowserStaticAtom[]>();
  for (let parameterIndex = 0; parameterIndex < parameters.length; parameterIndex += 1) {
    addBrowserCallArgumentOverrides(
      parameters[parameterIndex],
      parameterIndex,
      callableScope,
      overrides,
    );
  }
  const budget: BrowserStaticEvaluationBudget = { exhausted: false, recursive: false };
  const state: BrowserStaticEvaluationState = {
    bindingStack: new Set(),
    budget,
    callReceiver: true,
    depth: 0,
    overrides,
  };
  const affected = new Set<number>();
  let receiverAffected = false;

  const addDirectOrigins = (value: unknown, valueScope: BrowserStaticScope): void => {
    for (const atom of evaluateBrowserStaticValue(value, valueScope, index, state)) {
      if (atom.kind === 'plain' && atom.callArgumentIndex !== undefined) {
        affected.add(atom.callArgumentIndex);
      }
      if (atom.kind === 'plain' && atom.callReceiver === true) receiverAffected = true;
    }
  };

  const addDeepOrigins = (value: unknown, valueScope: BrowserStaticScope): void => {
    const seen = new Set<object>();
    const visitOrigin = (
      candidate: unknown,
      candidateScope: BrowserStaticScope,
      depth: number,
    ): void => {
      if (depth > 48) {
        budget.exhausted = true;
        return;
      }
      if (typeof candidate !== 'object' || candidate === null) return;
      if (Array.isArray(candidate)) {
        for (const child of candidate) {
          const childScope = isAstRecord(child)
            ? (index.scopeByNode.get(child) ?? candidateScope)
            : candidateScope;
          visitOrigin(child, childScope, depth + 1);
        }
        return;
      }
      const record = candidate as Record<string, unknown>;
      if (seen.has(record)) return;
      seen.add(record);
      const expression = record.type === 'SpreadElement' ? record.argument : record;
      for (const atom of evaluateBrowserStaticValue(expression, candidateScope, index, state)) {
        if (atom.kind === 'plain' && atom.callArgumentIndex !== undefined) {
          affected.add(atom.callArgumentIndex);
        }
        if (atom.kind === 'plain' && atom.callReceiver === true) receiverAffected = true;
        if (
          (atom.kind === 'array' || atom.kind === 'namespace' || atom.kind === 'object') &&
          atom.node !== record
        ) {
          visitOrigin(atom.node, atom.scope, depth + 1);
        }
      }
      for (const [key, child] of Object.entries(record)) {
        if (browserAstMetadataKeys.has(key)) continue;
        const childScope = isAstRecord(child)
          ? (index.scopeByNode.get(child) ?? candidateScope)
          : candidateScope;
        visitOrigin(child, childScope, depth + 1);
      }
    };
    visitOrigin(value, valueScope, 0);
  };

  const visit = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    const record = value as Record<string, unknown>;
    const type = typeof record.type === 'string' ? record.type : undefined;
    if (record !== body && browserAstFunctionType(type)) return;
    if (type === 'ClassDeclaration' || type === 'ClassExpression') return;
    const recordScope = index.scopeByNode.get(record) ?? callableScope;
    if (type === 'AssignmentExpression') {
      if (isAstRecord(record.left) && record.left.type === 'MemberExpression') {
        addDirectOrigins(record.left.object, recordScope);
        addDeepOrigins(record.right, recordScope);
      } else if (!browserAssignmentTargetIsLocal(record.left, recordScope, callableFunctionScope)) {
        addDeepOrigins(record.right, recordScope);
      }
    } else if (type === 'UpdateExpression') {
      if (isAstRecord(record.argument) && record.argument.type === 'MemberExpression') {
        addDirectOrigins(record.argument.object, recordScope);
      }
    } else if (type === 'UnaryExpression' && record.operator === 'delete') {
      if (isAstRecord(record.argument) && record.argument.type === 'MemberExpression') {
        addDirectOrigins(record.argument.object, recordScope);
      }
    } else if (type === 'CallExpression') {
      const callScope = index.scopeByNode.get(record) ?? callable.scope;
      const callee = evaluateBrowserStaticValue(record.callee, callScope, index, state);
      const args = Array.isArray(record.arguments) ? record.arguments : [];
      let callHasUnsupportedTarget = callee.length === 0;
      for (const atom of callee) {
        if (atom.kind === 'object-freeze' || atom.kind === 'reflect-get') continue;
        if (atom.kind === 'namespace' && browserAstFunctionType(String(atom.node.type))) {
          const callableWasActive = active.has(atom.node);
          const nestedParameters = Array.isArray(atom.node.params) ? atom.node.params : [];
          const nestedEffects = browserStaticCallableEffects(atom, index, active);
          if (
            nestedEffects.receiver &&
            isAstRecord(record.callee) &&
            record.callee.type === 'MemberExpression'
          ) {
            addDeepOrigins(record.callee.object, callScope);
          }
          if (nestedEffects.variadic) {
            for (const argument of args) addDeepOrigins(argument, callScope);
          }
          for (const parameterIndex of nestedEffects.parameterIndexes) {
            const parameter = nestedParameters[parameterIndex];
            if (isAstRecord(parameter) && parameter.type === 'RestElement') {
              for (
                let argumentIndex = parameterIndex;
                argumentIndex < args.length;
                argumentIndex += 1
              ) {
                addDeepOrigins(args[argumentIndex], callScope);
              }
            } else if (parameterIndex < args.length) {
              addDeepOrigins(args[parameterIndex], callScope);
            }
          }
          if (!callableWasActive && isAstRecord(atom.node.body)) {
            active.add(atom.node);
            visit(atom.node.body);
            active.delete(atom.node);
          }
          continue;
        }
        callHasUnsupportedTarget = true;
      }
      if (callHasUnsupportedTarget) {
        addDeepOrigins(record.callee, callScope);
        for (const argument of args) addDeepOrigins(argument, callScope);
      }
    } else if (
      type === 'ReturnStatement' &&
      record.argument !== null &&
      record.argument !== undefined
    ) {
      const returned = evaluateBrowserStaticValue(record.argument, recordScope, index, state);
      for (const atom of returned) {
        if (
          atom.kind === 'namespace' &&
          (browserAstFunctionType(String(atom.node.type)) ||
            atom.node.type === 'ClassDeclaration' ||
            atom.node.type === 'ClassExpression')
        ) {
          addDeepOrigins(atom.node, atom.scope);
        }
      }
    } else if (type === 'NewExpression') {
      addDeepOrigins(record.callee, recordScope);
      const args = Array.isArray(record.arguments) ? record.arguments : [];
      for (const argument of args) addDeepOrigins(argument, recordScope);
    } else if (
      type === 'AwaitExpression' ||
      type === 'YieldExpression' ||
      type === 'ThrowStatement' ||
      type === 'TaggedTemplateExpression' ||
      type === 'ImportExpression'
    ) {
      addDeepOrigins(record, recordScope);
    }
    for (const [key, child] of Object.entries(record)) {
      if (!browserAstMetadataKeys.has(key)) visit(child);
    }
  };

  for (const parameter of parameters) visit(parameter);
  visit(body);
  active.delete(callable.node);
  const closed = budget.exhausted || budget.recursive;
  const result: BrowserStaticCallableEffects = {
    parameterIndexes: closed ? allParameters : [...affected].sort((left, right) => left - right),
    receiver: closed || receiverAffected,
    variadic: closed || browserStaticCallableUsesArguments(body, index),
  };
  index.callableEffects.set(callable.node, result);
  return result;
}

function browserStaticCallableUsesArguments(
  body: Readonly<Record<string, unknown>>,
  index: BrowserStaticIndex,
): boolean {
  let found = false;
  const visit = (
    value: unknown,
    parent?: Readonly<Record<string, unknown>>,
    key?: string,
  ): void => {
    if (found || typeof value !== 'object' || value === null) return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child, parent, key);
      return;
    }
    const record = value as Record<string, unknown>;
    if (
      record !== body &&
      browserAstFunctionType(String(record.type)) &&
      record.type !== 'ArrowFunctionExpression'
    ) {
      return;
    }
    if (record.type === 'ClassDeclaration' || record.type === 'ClassExpression') return;
    if (
      record.type === 'Identifier' &&
      record.name === 'arguments' &&
      browserIdentifierIsValueReference(record, parent, key, index.bindingIdentifiers)
    ) {
      found = true;
      return;
    }
    for (const [childKey, child] of Object.entries(record)) {
      if (!browserAstMetadataKeys.has(childKey)) visit(child, record, childKey);
    }
  };
  visit(body);
  return found;
}

function addBrowserCallArgumentOverrides(
  pattern: unknown,
  parameterIndex: number,
  scope: BrowserStaticScope,
  overrides: Map<BrowserStaticBinding, readonly BrowserStaticAtom[]>,
): void {
  if (!isAstRecord(pattern)) return;
  if (pattern.type === 'Identifier' && typeof pattern.name === 'string') {
    const binding = lookupBrowserBinding(pattern.name, scope);
    if (binding !== undefined) {
      overrides.set(binding, [{ callArgumentIndex: parameterIndex, kind: 'plain' }]);
    }
    return;
  }
  if (pattern.type === 'AssignmentPattern' || pattern.type === 'RestElement') {
    addBrowserCallArgumentOverrides(
      pattern.left ?? pattern.argument,
      parameterIndex,
      scope,
      overrides,
    );
    return;
  }
  if (pattern.type === 'ObjectPattern') {
    const properties = Array.isArray(pattern.properties) ? pattern.properties : [];
    for (const property of properties) {
      if (!isAstRecord(property)) continue;
      addBrowserCallArgumentOverrides(
        property.type === 'Property' ? property.value : property.argument,
        parameterIndex,
        scope,
        overrides,
      );
    }
    return;
  }
  if (pattern.type === 'ArrayPattern') {
    const elements = Array.isArray(pattern.elements) ? pattern.elements : [];
    for (const element of elements) {
      addBrowserCallArgumentOverrides(element, parameterIndex, scope, overrides);
    }
  }
}

function browserAssignmentTargetIsLocal(
  pattern: unknown,
  scope: BrowserStaticScope,
  callableFunctionScope: BrowserStaticScope,
): boolean {
  if (!isAstRecord(pattern)) return false;
  if (pattern.type === 'Identifier' && typeof pattern.name === 'string') {
    const binding = lookupBrowserBinding(pattern.name, scope);
    return binding !== undefined && browserScopeIsWithin(binding.scope, callableFunctionScope);
  }
  if (pattern.type === 'AssignmentPattern' || pattern.type === 'RestElement') {
    return browserAssignmentTargetIsLocal(
      pattern.left ?? pattern.argument,
      scope,
      callableFunctionScope,
    );
  }
  if (pattern.type === 'ObjectPattern') {
    const properties = Array.isArray(pattern.properties) ? pattern.properties : [];
    return properties.every(
      (property) =>
        isAstRecord(property) &&
        browserAssignmentTargetIsLocal(
          property.type === 'Property' ? property.value : property.argument,
          scope,
          callableFunctionScope,
        ),
    );
  }
  if (pattern.type === 'ArrayPattern') {
    const elements = Array.isArray(pattern.elements) ? pattern.elements : [];
    return elements.every(
      (element) =>
        element === null ||
        element === undefined ||
        browserAssignmentTargetIsLocal(element, scope, callableFunctionScope),
    );
  }
  return false;
}

function browserScopeIsWithin(scope: BrowserStaticScope, ancestor: BrowserStaticScope): boolean {
  let candidate: BrowserStaticScope | undefined = scope;
  while (candidate !== undefined) {
    if (candidate === ancestor) return true;
    candidate = candidate.parent;
  }
  return false;
}

function markBrowserStructuredArgumentOpaque(
  value: unknown,
  scope: BrowserStaticScope,
  index: BrowserStaticIndex,
  state: BrowserStaticEvaluationState,
): void {
  const seen = new Set<object>();
  const visit = (candidate: unknown, candidateScope: BrowserStaticScope, depth: number): void => {
    if (depth > 48) {
      index.effectAnalysisClosed = true;
      return;
    }
    if (typeof candidate !== 'object' || candidate === null) return;
    if (Array.isArray(candidate)) {
      for (const child of candidate) visit(child, candidateScope, depth + 1);
      return;
    }
    const record = candidate as Record<string, unknown>;
    if (seen.has(record)) return;
    seen.add(record);
    const expression = record.type === 'SpreadElement' ? record.argument : record;
    for (const atom of evaluateBrowserStaticValue(expression, candidateScope, index, state)) {
      if (atom.kind === 'array' || atom.kind === 'namespace' || atom.kind === 'object') {
        index.opaqueMemberSources.add(atom.node);
        if (atom.node !== record) visit(atom.node, atom.scope, depth + 1);
      } else if (atom.kind === 'prototype') {
        index.opaquePrototypes.add(atom.constructor.node);
      } else if (atom.kind === 'instance') {
        index.opaqueMemberSources.add(atom.constructor.node);
      }
    }
    for (const [key, child] of Object.entries(record)) {
      if (browserAstMetadataKeys.has(key)) continue;
      const childScope = isAstRecord(child)
        ? (index.scopeByNode.get(child) ?? candidateScope)
        : candidateScope;
      visit(child, childScope, depth + 1);
    }
  };
  visit(value, scope, 0);
}

interface BrowserStaticSetterResolution {
  readonly callables: Extract<BrowserStaticAtom, { kind: 'namespace' }>[];
  closed: boolean;
}

function collectBrowserSetterAssignment(
  member: Readonly<Record<string, unknown>>,
  expression: unknown,
  scope: BrowserStaticScope,
  index: BrowserStaticIndex,
): void {
  const state: BrowserStaticEvaluationState = { bindingStack: new Set(), depth: 0 };
  const receivers = evaluateBrowserStaticValue(member.object, scope, index, state);
  const properties = browserStaticPropertyNames(member, scope, index, state);
  const resolution: BrowserStaticSetterResolution = { callables: [], closed: false };
  if (properties === undefined) {
    resolution.closed = true;
  } else {
    collectBrowserStaticSetterCallables(
      receivers,
      properties,
      index,
      state,
      resolution,
      new Set(),
      0,
    );
  }
  const affectedArguments = new Set<number>();
  if (resolution.closed) affectedArguments.add(0);
  const receiverAffected = collectBrowserAffectedInvocationArguments(
    resolution.callables,
    [expression],
    scope,
    index,
    state,
    affectedArguments,
  );
  if (affectedArguments.has(0)) {
    markBrowserStructuredArgumentOpaque(expression, scope, index, state);
  }
  if (receiverAffected) {
    markBrowserStructuredArgumentOpaque(member.object, scope, index, state);
  }
}

function collectBrowserStaticSetterCallables(
  receivers: readonly BrowserStaticAtom[],
  properties: readonly string[],
  index: BrowserStaticIndex,
  state: BrowserStaticEvaluationState,
  resolution: BrowserStaticSetterResolution,
  active: Set<object>,
  depth: number,
): void {
  if (depth > 48) {
    resolution.closed = true;
    return;
  }
  for (const receiver of receivers) {
    if (receiver.kind === 'object') {
      collectBrowserObjectSetterCallables(
        receiver,
        properties,
        index,
        state,
        resolution,
        active,
        depth,
      );
    } else if (receiver.kind === 'namespace') {
      collectBrowserClassSetterCallables(
        receiver,
        properties,
        true,
        index,
        state,
        resolution,
        active,
        depth,
      );
    } else if (receiver.kind === 'instance') {
      collectBrowserClassSetterCallables(
        receiver.constructor,
        properties,
        false,
        index,
        state,
        resolution,
        active,
        depth,
      );
    } else if (receiver.kind === 'prototype') {
      if (
        index.opaquePrototypes.has(receiver.constructor.node) ||
        properties.some((property) =>
          index.opaquePrototypeProperties.get(receiver.constructor.node)?.has(property),
        )
      ) {
        resolution.closed = true;
      }
    } else if (receiver.kind === 'array') {
      if (index.opaqueMemberSources.has(receiver.node)) resolution.closed = true;
    } else {
      resolution.closed = true;
    }
  }
}

function collectBrowserObjectSetterCallables(
  object: Extract<BrowserStaticAtom, { kind: 'object' }>,
  properties: readonly string[],
  index: BrowserStaticIndex,
  state: BrowserStaticEvaluationState,
  resolution: BrowserStaticSetterResolution,
  active: Set<object>,
  depth: number,
): void {
  if (active.has(object.node) || index.opaqueMemberSources.has(object.node)) {
    resolution.closed = true;
    return;
  }
  active.add(object.node);
  const elements = Array.isArray(object.node.properties) ? object.node.properties : [];
  for (const propertyName of properties) {
    let selected: Record<string, unknown> | undefined;
    const prototypes: BrowserStaticAtom[] = [];
    for (const element of elements) {
      if (!isAstRecord(element) || element.type !== 'Property') {
        resolution.closed = true;
        continue;
      }
      const names = browserObjectPropertyNames(element, object.scope, index, state);
      if (names === undefined) {
        resolution.closed = true;
        continue;
      }
      if (names.includes('__proto__') && element.computed !== true && element.kind === 'init') {
        prototypes.push(...evaluateBrowserStaticValue(element.value, object.scope, index, state));
      }
      if (names.includes(propertyName)) selected = element;
    }
    if (selected?.kind === 'set') {
      addBrowserStaticSetterCallable(selected.value, object.scope, index, resolution);
    } else if (selected === undefined && prototypes.length > 0) {
      collectBrowserStaticSetterCallables(
        prototypes,
        [propertyName],
        index,
        nextBrowserStaticEvaluationState(state),
        resolution,
        active,
        depth + 1,
      );
    }
  }
  active.delete(object.node);
}

function collectBrowserClassSetterCallables(
  constructor: Extract<BrowserStaticAtom, { kind: 'namespace' }>,
  properties: readonly string[],
  staticMember: boolean,
  index: BrowserStaticIndex,
  state: BrowserStaticEvaluationState,
  resolution: BrowserStaticSetterResolution,
  active: Set<object>,
  depth: number,
): void {
  if (active.has(constructor.node) || index.opaqueMemberSources.has(constructor.node)) {
    resolution.closed = true;
    return;
  }
  if (!staticMember && browserStaticConstructorMayReplaceInstance(constructor, index, state)) {
    resolution.closed = true;
  }
  if (browserAstFunctionType(String(constructor.node.type))) {
    if (staticMember) return;
    const prototypes = browserPlainNamespaceMember(constructor, 'prototype', index, state).filter(
      (atom) => atom.kind !== 'plain',
    );
    if (prototypes.length > 0) {
      collectBrowserStaticSetterCallables(
        prototypes,
        properties,
        index,
        nextBrowserStaticEvaluationState(state),
        resolution,
        active,
        depth + 1,
      );
    }
    return;
  }
  if (constructor.node.type !== 'ClassDeclaration' && constructor.node.type !== 'ClassExpression') {
    resolution.closed = true;
    return;
  }
  const body = constructor.node.body;
  if (!isAstRecord(body) || body.type !== 'ClassBody') {
    resolution.closed = true;
    return;
  }
  active.add(constructor.node);
  const elements = Array.isArray(body.body) ? body.body : [];
  for (const propertyName of properties) {
    let selected: Record<string, unknown> | undefined;
    for (const element of elements) {
      if (!isAstRecord(element) || (element.static === true) !== staticMember) continue;
      const names = browserObjectPropertyNames(element, constructor.scope, index, state);
      if (names === undefined) {
        resolution.closed = true;
        continue;
      }
      if (names.includes(propertyName)) selected = element;
    }
    if (selected?.type === 'MethodDefinition' && selected.kind === 'set') {
      addBrowserStaticSetterCallable(selected.value, constructor.scope, index, resolution);
      continue;
    }
    if (selected !== undefined) continue;
    const superClass = constructor.node.superClass;
    if (superClass === null || superClass === undefined) continue;
    const supers = evaluateBrowserStaticValue(superClass, constructor.scope, index, state);
    for (const candidate of supers) {
      if (candidate.kind !== 'namespace') {
        resolution.closed = true;
        continue;
      }
      collectBrowserClassSetterCallables(
        candidate,
        [propertyName],
        staticMember,
        index,
        nextBrowserStaticEvaluationState(state),
        resolution,
        active,
        depth + 1,
      );
    }
  }
  active.delete(constructor.node);
}

function browserStaticConstructorMayReplaceInstance(
  constructor: Extract<BrowserStaticAtom, { kind: 'namespace' }>,
  index: BrowserStaticIndex,
  state: BrowserStaticEvaluationState,
): boolean {
  const callables = browserStaticConstructorCallables(constructor, index, state, new Set(), 0);
  if (callables === undefined) return true;
  return callables.some((callable) => {
    const returns = browserStaticCallableReturns(callable.node);
    return returns === undefined || returns.length > 0;
  });
}

function addBrowserStaticSetterCallable(
  value: unknown,
  fallbackScope: BrowserStaticScope,
  index: BrowserStaticIndex,
  resolution: BrowserStaticSetterResolution,
): void {
  if (!isAstRecord(value) || !browserAstFunctionType(String(value.type))) {
    resolution.closed = true;
    return;
  }
  resolution.callables.push({
    kind: 'namespace',
    node: value,
    scope: index.scopeByNode.get(value) ?? fallbackScope,
  });
}

function collectBrowserMemberAssignment(
  member: Readonly<Record<string, unknown>>,
  expression: unknown,
  exact: boolean,
  scope: BrowserStaticScope,
  index: BrowserStaticIndex,
): void {
  const receivers = evaluateBrowserStaticValue(member.object, scope, index, {
    bindingStack: new Set(),
    depth: 0,
  });
  const targets = receivers.filter(
    (
      receiver,
    ): receiver is Extract<BrowserStaticAtom, { kind: 'array' | 'namespace' | 'object' }> =>
      receiver.kind === 'array' || receiver.kind === 'namespace' || receiver.kind === 'object',
  );
  if (targets.length === 0) return;
  const properties = browserStaticPropertyNames(member, scope, index, {
    bindingStack: new Set(),
    depth: 0,
  });
  for (const target of targets) {
    if (!exact || properties === undefined) {
      index.opaqueMemberSources.add(target.node);
      continue;
    }
    if (properties.includes('__proto__')) {
      index.opaqueMemberSources.add(target.node);
    }
    let sources = index.memberSources.get(target.node);
    if (sources === undefined) {
      sources = new Map();
      index.memberSources.set(target.node, sources);
    }
    for (const property of properties) {
      const propertySources = sources.get(property) ?? [];
      propertySources.push({ expression, projections: [], scope });
      sources.set(property, propertySources);
    }
  }
}

function addBrowserAssignmentPattern(
  pattern: unknown,
  expression: unknown,
  scope: BrowserStaticScope,
  index: BrowserStaticIndex,
): void {
  if (!isAstRecord(pattern)) return;
  if (pattern.type === 'Identifier' && typeof pattern.name === 'string') {
    const binding = lookupBrowserBinding(pattern.name, scope);
    if (binding !== undefined) {
      binding.sources.push({ expression, projections: [], scope });
    }
    return;
  }
  // Destructuring assignments retain the same finite property projection grammar as declarations.
  if (pattern.type === 'ObjectPattern' || pattern.type === 'ArrayPattern') {
    addBrowserAssignmentPatternSource(
      pattern,
      { expression, projections: [], scope },
      scope,
      index,
    );
  }
}

function addBrowserAssignmentPatternSource(
  pattern: unknown,
  source: BrowserBindingSource,
  scope: BrowserStaticScope,
  index: BrowserStaticIndex,
): void {
  if (!isAstRecord(pattern)) return;
  if (pattern.type === 'MemberExpression') {
    // Destructuring writes can invoke setters or mutate a projected object without ever exposing a
    // top-level AssignmentExpression member target. That general-JS effect is outside the finite
    // projection grammar, so close both sides instead of silently discarding it (SPEC §6.6; C13).
    const state: BrowserStaticEvaluationState = { bindingStack: new Set(), depth: 0 };
    markBrowserStructuredArgumentOpaque(pattern.object, scope, index, state);
    markBrowserStructuredArgumentOpaque(source.expression, source.scope, index, state);
    return;
  }
  if (pattern.type === 'Identifier' && typeof pattern.name === 'string') {
    const binding = lookupBrowserBinding(pattern.name, scope);
    if (binding !== undefined) binding.sources.push(source);
    return;
  }
  if (pattern.type === 'AssignmentPattern') {
    addBrowserAssignmentPatternSource(pattern.left, source, scope, index);
    return;
  }
  if (pattern.type === 'RestElement') {
    addBrowserAssignmentPatternSource(pattern.argument, source, scope, index);
    return;
  }
  if (pattern.type === 'ObjectPattern') {
    const properties = Array.isArray(pattern.properties) ? pattern.properties : [];
    for (const property of properties) {
      if (!isAstRecord(property) || property.type !== 'Property') {
        if (isAstRecord(property) && property.type === 'RestElement') {
          addBrowserAssignmentPatternSource(property.argument, source, scope, index);
        } else if (isAstRecord(property)) {
          markBrowserAssignmentPatternOpaque(property.argument, scope, index);
        }
        continue;
      }
      const propertyName = staticObjectPropertyName(property);
      const projection: BrowserBindingProjection =
        propertyName !== undefined
          ? { property: propertyName }
          : property.computed === true && property.key !== undefined
            ? { expression: property.key, scope }
            : {};
      addBrowserAssignmentPatternSource(
        property.value,
        {
          expression: source.expression,
          projections: [...source.projections, projection],
          scope: source.scope,
        },
        scope,
        index,
      );
    }
    return;
  }
  if (pattern.type === 'ArrayPattern') {
    const elements = Array.isArray(pattern.elements) ? pattern.elements : [];
    for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
      const element = elements[elementIndex];
      if (element === null || element === undefined) continue;
      addBrowserAssignmentPatternSource(
        element,
        {
          expression: source.expression,
          projections: [...source.projections, { property: String(elementIndex) }],
          scope: source.scope,
        },
        scope,
        index,
      );
    }
  }
}

function markBrowserAssignmentPatternOpaque(
  pattern: unknown,
  scope: BrowserStaticScope,
  index: BrowserStaticIndex,
): void {
  if (!isAstRecord(pattern)) return;
  if (pattern.type === 'Identifier' && typeof pattern.name === 'string') {
    const binding = lookupBrowserBinding(pattern.name, scope);
    if (binding !== undefined) binding.opaque = true;
    return;
  }
  if (pattern.type === 'MemberExpression') {
    markBrowserStructuredArgumentOpaque(pattern.object, scope, index, {
      bindingStack: new Set(),
      depth: 0,
    });
    return;
  }
  if (pattern.type === 'AssignmentPattern' || pattern.type === 'RestElement') {
    markBrowserAssignmentPatternOpaque(pattern.left ?? pattern.argument, scope, index);
    return;
  }
  if (pattern.type === 'ObjectPattern') {
    const properties = Array.isArray(pattern.properties) ? pattern.properties : [];
    for (const property of properties) {
      if (!isAstRecord(property)) continue;
      markBrowserAssignmentPatternOpaque(
        property.type === 'Property' ? property.value : property.argument,
        scope,
        index,
      );
    }
    return;
  }
  if (pattern.type === 'ArrayPattern') {
    const elements = Array.isArray(pattern.elements) ? pattern.elements : [];
    for (const element of elements) markBrowserAssignmentPatternOpaque(element, scope, index);
  }
}

function lookupBrowserBinding(
  name: string,
  scope: BrowserStaticScope,
): BrowserStaticBinding | undefined {
  let candidate: BrowserStaticScope | undefined = scope;
  while (candidate !== undefined) {
    const binding = candidate.bindings.get(name);
    if (binding !== undefined) return binding;
    candidate = candidate.parent;
  }
  return undefined;
}

function evaluateBrowserBinding(
  binding: BrowserStaticBinding,
  index: BrowserStaticIndex,
  state: BrowserStaticEvaluationState,
): BrowserStaticAtom[] {
  const override = state.overrides?.get(binding);
  if (override !== undefined) return [...override];
  if (state.depth > 48) {
    if (state.budget !== undefined) state.budget.exhausted = true;
    return [{ kind: 'closed' }];
  }
  if (state.bindingStack.has(binding)) {
    if (state.budget !== undefined) state.budget.recursive = true;
    return [{ kind: 'closed' }];
  }
  const bindingStack = new Set(state.bindingStack);
  bindingStack.add(binding);
  const nextState = nextBrowserStaticEvaluationState(state, bindingStack);
  const atoms: BrowserStaticAtom[] = binding.opaque ? [{ kind: 'closed' }] : [];
  for (const source of binding.sources) {
    let projected = evaluateBrowserStaticValue(source.expression, source.scope, index, nextState);
    for (const projection of source.projections) {
      const properties =
        projection.property !== undefined
          ? [projection.property]
          : projection.expression !== undefined && projection.scope !== undefined
            ? browserFiniteStaticStrings(projection.expression, projection.scope, index, nextState)
            : undefined;
      projected = browserMemberAtoms(projected, properties, index, nextState);
    }
    atoms.push(...projected);
  }
  return atoms.length === 0 ? [{ kind: 'closed' }] : atoms;
}

function evaluateBrowserStaticValue(
  value: unknown,
  scope: BrowserStaticScope,
  index: BrowserStaticIndex,
  state: BrowserStaticEvaluationState,
): BrowserStaticAtom[] {
  if (state.depth > 48) {
    if (state.budget !== undefined) state.budget.exhausted = true;
    return [{ kind: 'closed' }];
  }
  if (!isAstRecord(value)) return [{ kind: 'closed' }];
  const nextState = nextBrowserStaticEvaluationState(state);
  if (value.type === 'ThisExpression') {
    return state.callReceiver === true
      ? [{ callReceiver: true, kind: 'plain' }]
      : [{ kind: 'closed' }];
  }
  if (value.type === 'Identifier' && typeof value.name === 'string') {
    const binding = lookupBrowserBinding(value.name, scope);
    if (binding !== undefined) return evaluateBrowserBinding(binding, index, nextState);
    if (value.name === 'Worker' || value.name === 'SharedWorker') {
      return [{ kind: 'worker', name: value.name }];
    }
    if (value.name === 'Function' || value.name === 'eval') {
      return [{ kind: 'dynamic-code', name: value.name }];
    }
    if (value.name === 'Object') return [{ kind: 'object-builtin' }];
    if (value.name === 'Proxy') return [{ kind: 'proxy-constructor' }];
    if (value.name === 'setInterval' || value.name === 'setTimeout') {
      return [{ kind: 'timer', name: value.name }];
    }
    if (
      value.name === 'globalThis' ||
      value.name === 'self' ||
      value.name === 'window' ||
      value.name === 'top' ||
      value.name === 'parent'
    ) {
      return [{ kind: 'global' }];
    }
    if (value.name === 'frames') return [{ kind: 'frames' }];
    if (value.name === 'navigator') return [{ kind: 'navigator' }];
    if (value.name === 'CSS') return [{ kind: 'css' }];
    if (value.name === 'document') return [{ kind: 'document' }];
    if (value.name === 'Reflect') return [{ kind: 'reflect' }];
    return [{ kind: 'plain' }];
  }
  const literal = literalAstString(value);
  if (literal !== undefined) return [{ kind: 'string', value: literal }];
  if (value.type === 'Literal' && typeof value.value === 'number') {
    return [{ kind: 'string', value: String(value.value) }];
  }
  if (value.type === 'ObjectExpression') return [{ kind: 'object', node: value, scope }];
  if (value.type === 'ArrayExpression') return [{ kind: 'array', node: value, scope }];
  if (
    value.type === 'ArrowFunctionExpression' ||
    value.type === 'FunctionDeclaration' ||
    value.type === 'FunctionExpression' ||
    value.type === 'ClassDeclaration' ||
    value.type === 'ClassExpression'
  ) {
    return [{ kind: 'namespace', node: value, scope }];
  }
  if (value.type === 'MemberExpression') {
    const object = evaluateBrowserStaticValue(value.object, scope, index, nextState);
    const properties = browserStaticPropertyNames(value, scope, index, nextState);
    return browserMemberAtoms(object, properties, index, nextState);
  }
  if (value.type === 'CallExpression') {
    const callee = evaluateBrowserStaticValue(value.callee, scope, index, nextState);
    const args = Array.isArray(value.arguments) ? value.arguments : [];
    if (callee.some((atom) => atom.kind === 'reflect-get')) {
      if (args.length < 2) return [{ carrier: 'opaque browser executable carrier', kind: 'asset' }];
      const receiver = evaluateBrowserStaticValue(args[0], scope, index, nextState);
      const properties = browserFiniteStaticStrings(args[1], scope, index, nextState);
      return browserMemberAtoms(receiver, properties, index, nextState);
    }
    if (callee.some((atom) => atom.kind === 'object-freeze')) {
      return args.length === 0
        ? [{ kind: 'closed' }]
        : evaluateBrowserStaticValue(args[0], scope, index, nextState);
    }
    const callable = callee.filter(
      (atom): atom is Extract<BrowserStaticAtom, { kind: 'namespace' }> =>
        atom.kind === 'namespace' && browserAstFunctionType(String(atom.node.type)),
    );
    if (callable.length > 0 && callable.length === callee.length) {
      return callable.flatMap((atom) =>
        evaluateBrowserStaticCallable(atom, args, scope, index, nextState),
      );
    }
    return [{ kind: 'closed' }];
  }
  if (value.type === 'NewExpression') {
    const callee = evaluateBrowserStaticValue(value.callee, scope, index, nextState);
    const args = Array.isArray(value.arguments) ? value.arguments : [];
    if (callee.some((atom) => atom.kind === 'proxy-constructor')) {
      return args.length === 0
        ? [{ kind: 'closed' }]
        : evaluateBrowserStaticValue(args[0], scope, index, nextState);
    }
    const localConstructors = callee.filter(
      (atom): atom is Extract<BrowserStaticAtom, { kind: 'namespace' }> =>
        atom.kind === 'namespace' &&
        (browserAstFunctionType(String(atom.node.type)) ||
          atom.node.type === 'ClassDeclaration' ||
          atom.node.type === 'ClassExpression'),
    );
    if (localConstructors.length > 0 && localConstructors.length === callee.length) {
      return localConstructors.map((constructor) => ({ constructor, kind: 'instance' }));
    }
    return [{ kind: 'closed' }];
  }
  if (value.type === 'ChainExpression') {
    return evaluateBrowserStaticValue(value.expression, scope, index, nextState);
  }
  if (value.type === 'SequenceExpression') {
    const expressions = Array.isArray(value.expressions) ? value.expressions : [];
    return expressions.length === 0
      ? [{ kind: 'plain' }]
      : evaluateBrowserStaticValue(expressions.at(-1), scope, index, nextState);
  }
  if (value.type === 'ConditionalExpression') {
    return [
      ...evaluateBrowserStaticValue(value.consequent, scope, index, nextState),
      ...evaluateBrowserStaticValue(value.alternate, scope, index, nextState),
    ];
  }
  if (value.type === 'LogicalExpression') {
    return [
      ...evaluateBrowserStaticValue(value.left, scope, index, nextState),
      ...evaluateBrowserStaticValue(value.right, scope, index, nextState),
    ];
  }
  if (
    value.type === 'AssignmentExpression' ||
    value.type === 'AwaitExpression' ||
    value.type === 'YieldExpression'
  ) {
    const expression = value.type === 'AssignmentExpression' ? value.right : value.argument;
    return evaluateBrowserStaticValue(expression, scope, index, nextState);
  }
  if (value.type === 'BinaryExpression' && value.operator === '+') {
    const strings = browserFiniteStaticStrings(value, scope, index, nextState);
    return strings === undefined
      ? [{ kind: 'closed' }]
      : strings.map((stringValue) => ({ kind: 'string', value: stringValue }));
  }
  if (
    value.type === 'Literal' ||
    value.type === 'TemplateLiteral' ||
    value.type === 'UnaryExpression'
  ) {
    return [{ kind: 'plain' }];
  }
  return [{ kind: 'closed' }];
}

function evaluateBrowserStaticCallable(
  callable: Extract<BrowserStaticAtom, { kind: 'namespace' }>,
  args: readonly unknown[],
  callerScope: BrowserStaticScope,
  index: BrowserStaticIndex,
  state: BrowserStaticEvaluationState,
): BrowserStaticAtom[] {
  const parameters = Array.isArray(callable.node.params) ? callable.node.params : [];
  if (
    parameters.some(
      (parameter) =>
        !isAstRecord(parameter) ||
        (parameter.type !== 'Identifier' && parameter.type !== 'AssignmentPattern'),
    )
  ) {
    return [{ kind: 'closed' }];
  }
  const returns = browserStaticCallableReturns(callable.node);
  if (returns === undefined) return [{ kind: 'closed' }];
  if (returns.length === 0) return [{ kind: 'plain' }];
  const returnScope =
    returns
      .map((expression) =>
        isAstRecord(expression) ? index.scopeByNode.get(expression) : undefined,
      )
      .find((candidate) => candidate !== undefined) ?? callable.scope;
  const overrides = new Map(state.overrides ?? []);
  for (let parameterIndex = 0; parameterIndex < parameters.length; parameterIndex += 1) {
    const parameter = parameters[parameterIndex];
    if (!isAstRecord(parameter)) return [{ kind: 'closed' }];
    const identifier = parameter.type === 'AssignmentPattern' ? parameter.left : parameter;
    if (
      !isAstRecord(identifier) ||
      identifier.type !== 'Identifier' ||
      typeof identifier.name !== 'string'
    ) {
      return [{ kind: 'closed' }];
    }
    const binding = lookupBrowserBinding(identifier.name, returnScope);
    if (binding === undefined) return [{ kind: 'closed' }];
    const argument = args[parameterIndex];
    const argumentAtoms =
      argument === undefined
        ? parameter.type === 'AssignmentPattern'
          ? evaluateBrowserStaticValue(parameter.right, returnScope, index, state)
          : [{ kind: 'plain' } satisfies BrowserStaticAtom]
        : evaluateBrowserStaticValue(argument, callerScope, index, state);
    overrides.set(binding, argumentAtoms);
  }
  const returnState = {
    ...nextBrowserStaticEvaluationState(state),
    overrides,
  } satisfies BrowserStaticEvaluationState;
  return returns.flatMap((expression) => {
    const expressionScope =
      (isAstRecord(expression) ? index.scopeByNode.get(expression) : undefined) ?? returnScope;
    return evaluateBrowserStaticValue(expression, expressionScope, index, returnState);
  });
}

function browserStaticCallableReturns(
  callable: Readonly<Record<string, unknown>>,
): readonly unknown[] | undefined {
  const body = callable.body;
  if (!isAstRecord(body)) return undefined;
  if (body.type !== 'BlockStatement') return [body];
  const returns: unknown[] = [];
  const visit = (value: unknown): void => {
    if (!isAstRecord(value)) {
      if (Array.isArray(value)) for (const child of value) visit(child);
      return;
    }
    if (value !== body && browserAstFunctionType(String(value.type))) return;
    if (value.type === 'ClassDeclaration' || value.type === 'ClassExpression') return;
    if (value.type === 'ReturnStatement') {
      returns.push(value.argument ?? { type: 'Literal', value: undefined });
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (!browserAstMetadataKeys.has(key)) visit(child);
    }
  };
  visit(body);
  return returns;
}

function browserMemberAtoms(
  receivers: readonly BrowserStaticAtom[],
  properties: readonly string[] | undefined,
  index: BrowserStaticIndex,
  state: BrowserStaticEvaluationState,
): BrowserStaticAtom[] {
  const atoms: BrowserStaticAtom[] = [];
  for (const receiver of receivers) {
    if (properties === undefined) {
      if (
        receiver.kind === 'global' ||
        receiver.kind === 'navigator' ||
        receiver.kind === 'css' ||
        receiver.kind === 'reflect' ||
        receiver.kind === 'frames'
      ) {
        atoms.push({ carrier: 'opaque browser executable carrier', kind: 'asset' });
      } else if (receiver.kind === 'closed') {
        atoms.push({ kind: 'closed' });
      } else {
        atoms.push({ kind: 'plain' });
      }
      continue;
    }
    for (const property of properties) {
      if (receiver.kind === 'global') {
        if (property === 'Worker' || property === 'SharedWorker') {
          atoms.push({ kind: 'worker', name: property });
        } else if (
          property === 'globalThis' ||
          property === 'self' ||
          property === 'window' ||
          property === 'top' ||
          property === 'parent'
        ) {
          atoms.push({ kind: 'global' });
        } else if (property === 'frames') {
          atoms.push({ kind: 'frames' });
        } else if (property === 'navigator') {
          atoms.push({ kind: 'navigator' });
        } else if (property === 'CSS') {
          atoms.push({ kind: 'css' });
        } else if (property === 'document') {
          atoms.push({ kind: 'document' });
        } else if (property === 'Reflect') {
          atoms.push({ kind: 'reflect' });
        } else if (property === 'Function' || property === 'eval') {
          atoms.push({ kind: 'dynamic-code', name: property });
        } else if (property === 'Object') {
          atoms.push({ kind: 'object-builtin' });
        } else if (property === 'Proxy') {
          atoms.push({ kind: 'proxy-constructor' });
        } else if (property === 'setInterval' || property === 'setTimeout') {
          atoms.push({ kind: 'timer', name: property });
        } else if (property === 'constructor') {
          atoms.push({ kind: 'constructor-value' });
        } else {
          atoms.push({ kind: 'closed' });
        }
      } else if (receiver.kind === 'frames') {
        if (/^(?:0|[1-9][0-9]*)$/u.test(property)) {
          atoms.push({ kind: 'global' });
        } else {
          atoms.push(...browserMemberAtoms([{ kind: 'global' }], [property], index, state));
        }
      } else if (receiver.kind === 'navigator') {
        atoms.push(
          property === 'serviceWorker'
            ? { carrier: 'service worker', kind: 'asset' }
            : { kind: 'closed' },
        );
      } else if (receiver.kind === 'css') {
        if (property === 'paintWorklet') {
          atoms.push({ carrier: 'paint worklet', kind: 'asset' });
        } else if (property.toLowerCase().endsWith('worklet')) {
          atoms.push({ carrier: 'worklet', kind: 'asset' });
        } else {
          atoms.push({ kind: 'closed' });
        }
      } else if (receiver.kind === 'document') {
        atoms.push(property === 'defaultView' ? { kind: 'global' } : { kind: 'closed' });
      } else if (receiver.kind === 'reflect') {
        atoms.push(property === 'get' ? { kind: 'reflect-get' } : { kind: 'closed' });
      } else if (receiver.kind === 'object-builtin') {
        atoms.push(
          property === 'freeze'
            ? { kind: 'object-freeze' }
            : property === 'defineProperty'
              ? { kind: 'object-define-property' }
              : { kind: 'closed' },
        );
      } else if (receiver.kind === 'constructor-value') {
        atoms.push(
          property === 'constructor'
            ? { kind: 'dynamic-code', name: 'Function' }
            : { kind: 'closed' },
        );
      } else if (receiver.kind === 'object') {
        atoms.push(...browserPlainObjectMember(receiver, property, index, state));
      } else if (receiver.kind === 'namespace') {
        atoms.push(...browserPlainNamespaceMember(receiver, property, index, state));
      } else if (receiver.kind === 'array') {
        atoms.push(...browserPlainArrayMember(receiver, property, index, state));
      } else if (receiver.kind === 'instance') {
        atoms.push({ kind: 'closed' });
      } else if (receiver.kind === 'prototype') {
        atoms.push({ kind: 'closed' });
      } else if (receiver.kind === 'closed') {
        if (property === 'Worker' || property === 'SharedWorker') {
          atoms.push({ kind: 'worker', name: property });
        } else if (property === 'serviceWorker') {
          atoms.push({ carrier: 'service worker', kind: 'asset' });
        } else if (property === 'audioWorklet') {
          atoms.push({ carrier: 'audio worklet', kind: 'asset' });
        } else if (property === 'paintWorklet') {
          atoms.push({ carrier: 'paint worklet', kind: 'asset' });
        } else if (property.toLowerCase().endsWith('worklet')) {
          atoms.push({ carrier: 'worklet', kind: 'asset' });
        } else {
          atoms.push({ kind: 'closed' });
        }
      } else if (receiver.kind === 'plain') {
        if (receiver.callArgumentIndex !== undefined || receiver.callReceiver === true) {
          atoms.push(receiver);
        } else if (property === 'constructor') {
          atoms.push({ kind: 'constructor-value' });
        } else {
          atoms.push({ kind: 'plain' });
        }
      } else if (receiver.kind === 'string') {
        atoms.push({ kind: 'plain' });
      } else if (
        receiver.kind === 'proxy-constructor' ||
        receiver.kind === 'object-define-property' ||
        receiver.kind === 'object-freeze'
      ) {
        atoms.push({ kind: 'closed' });
      } else if (receiver.kind === 'dynamic-code') {
        atoms.push({ kind: 'closed' });
      } else if (receiver.kind === 'worker' || receiver.kind === 'asset') {
        atoms.push(receiver);
      } else {
        if (property === 'audioWorklet') {
          atoms.push({ carrier: 'audio worklet', kind: 'asset' });
        } else if (property === 'paintWorklet') {
          atoms.push({ carrier: 'paint worklet', kind: 'asset' });
        } else if (property.toLowerCase().endsWith('worklet') && property !== 'serviceWorker') {
          atoms.push({ carrier: 'worklet', kind: 'asset' });
        } else {
          atoms.push({ kind: 'closed' });
        }
      }
    }
  }
  return atoms.length === 0 ? [{ kind: 'closed' }] : atoms;
}

function browserPlainObjectMember(
  object: Extract<BrowserStaticAtom, { kind: 'object' }>,
  propertyName: string,
  index: BrowserStaticIndex,
  state: BrowserStaticEvaluationState,
): BrowserStaticAtom[] {
  const properties = Array.isArray(object.node.properties) ? object.node.properties : [];
  let selected: Record<string, unknown> | undefined;
  const prototypeAtoms: BrowserStaticAtom[] = [];
  for (const property of properties) {
    if (!isAstRecord(property) || property.type !== 'Property' || property.kind !== 'init') {
      return [{ kind: 'closed' }];
    }
    const names = browserObjectPropertyNames(property, object.scope, index, state);
    if (names === undefined) return [{ kind: 'closed' }];
    if (names.includes('__proto__') && property.computed !== true) {
      prototypeAtoms.push(
        ...evaluateBrowserStaticValue(property.value, object.scope, index, state),
      );
    }
    if (names.includes(propertyName)) selected = property;
  }
  const atoms: BrowserStaticAtom[] =
    selected === undefined
      ? propertyName === 'constructor'
        ? [{ kind: 'constructor-value' }]
        : [{ kind: 'plain' }]
      : evaluateBrowserStaticValue(selected.value, object.scope, index, state);
  if (prototypeAtoms.length > 0 && propertyName !== '__proto__') {
    atoms.push(...browserMemberAtoms(prototypeAtoms, [propertyName], index, state));
  }
  return browserAssignedMemberAtoms(atoms, object.node, propertyName, index, state);
}

function browserPlainNamespaceMember(
  namespace: Extract<BrowserStaticAtom, { kind: 'namespace' }>,
  propertyName: string,
  index: BrowserStaticIndex,
  state: BrowserStaticEvaluationState,
): BrowserStaticAtom[] {
  const atoms: BrowserStaticAtom[] = [];
  const classBody = isAstRecord(namespace.node.body) ? namespace.node.body : undefined;
  if (
    (namespace.node.type === 'ClassDeclaration' || namespace.node.type === 'ClassExpression') &&
    classBody?.type === 'ClassBody'
  ) {
    const elements = Array.isArray(classBody.body) ? classBody.body : [];
    for (const element of elements) {
      if (!isAstRecord(element) || element.static !== true) continue;
      const names = browserObjectPropertyNames(element, namespace.scope, index, state);
      if (names === undefined) {
        atoms.push({ kind: 'closed' });
        continue;
      }
      if (!names.includes(propertyName)) continue;
      if (element.type === 'MethodDefinition' && element.kind !== 'get') {
        atoms.push(...evaluateBrowserStaticValue(element.value, namespace.scope, index, state));
      } else if (element.type === 'PropertyDefinition' && element.value !== undefined) {
        atoms.push(...evaluateBrowserStaticValue(element.value, namespace.scope, index, state));
      } else {
        if (element.type === 'MethodDefinition' && element.kind === 'get') {
          // Accessor reads may mutate or return the implicit class receiver. The finite evaluator
          // does not execute getters, so close the constructor namespace once one is observed.
          index.opaqueMemberSources.add(namespace.node);
        }
        atoms.push({ kind: 'closed' });
      }
    }
    if (namespace.node.superClass !== null && namespace.node.superClass !== undefined) {
      const inherited = evaluateBrowserStaticValue(
        namespace.node.superClass,
        namespace.scope,
        index,
        state,
      );
      atoms.push(...browserMemberAtoms(inherited, [propertyName], index, state));
    }
  }
  if (atoms.length === 0) {
    atoms.push(
      propertyName === 'constructor'
        ? { kind: 'constructor-value' }
        : propertyName === 'prototype'
          ? { constructor: namespace, kind: 'prototype' }
          : { kind: 'plain' },
    );
  }
  return browserAssignedMemberAtoms(atoms, namespace.node, propertyName, index, state);
}

function browserAssignedMemberAtoms(
  initial: readonly BrowserStaticAtom[],
  node: object,
  propertyName: string,
  index: BrowserStaticIndex,
  state: BrowserStaticEvaluationState,
): BrowserStaticAtom[] {
  const atoms = [...initial];
  if (index.opaqueMemberSources.has(node)) atoms.push({ kind: 'closed' });
  const sources = index.memberSources.get(node)?.get(propertyName) ?? [];
  for (const source of sources) {
    atoms.push(...evaluateBrowserStaticValue(source.expression, source.scope, index, state));
  }
  return atoms;
}

function browserPlainArrayMember(
  array: Extract<BrowserStaticAtom, { kind: 'array' }>,
  propertyName: string,
  index: BrowserStaticIndex,
  state: BrowserStaticEvaluationState,
): BrowserStaticAtom[] {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(propertyName)) {
    const atoms: BrowserStaticAtom[] =
      propertyName === 'constructor' ? [{ kind: 'constructor-value' }] : [{ kind: 'plain' }];
    return browserAssignedMemberAtoms(atoms, array.node, propertyName, index, state);
  }
  const elements = Array.isArray(array.node.elements) ? array.node.elements : [];
  const element = elements[Number(propertyName)];
  const atoms: BrowserStaticAtom[] =
    element === null || element === undefined
      ? [{ kind: 'plain' }]
      : evaluateBrowserStaticValue(element, array.scope, index, state);
  return browserAssignedMemberAtoms(atoms, array.node, propertyName, index, state);
}

function browserObjectPropertyNames(
  property: Readonly<Record<string, unknown>>,
  scope: BrowserStaticScope,
  index: BrowserStaticIndex,
  state: BrowserStaticEvaluationState,
): readonly string[] | undefined {
  const key = property.key;
  if (!isAstRecord(key)) return undefined;
  if (property.computed === true) return browserFiniteStaticStrings(key, scope, index, state);
  if (key.type === 'Identifier' && typeof key.name === 'string') return [key.name];
  const literal = literalAstString(key);
  return literal === undefined ? undefined : [literal];
}

function browserStaticPropertyNames(
  member: Readonly<Record<string, unknown>>,
  scope: BrowserStaticScope,
  index: BrowserStaticIndex,
  state: BrowserStaticEvaluationState,
): readonly string[] | undefined {
  const property = member.property;
  if (!isAstRecord(property)) return undefined;
  if (member.computed === true) return browserFiniteStaticStrings(property, scope, index, state);
  return property.type === 'Identifier' && typeof property.name === 'string'
    ? [property.name]
    : undefined;
}

function browserFiniteStaticStrings(
  value: unknown,
  scope: BrowserStaticScope,
  index: BrowserStaticIndex,
  state: BrowserStaticEvaluationState,
): readonly string[] | undefined {
  if (state.depth > 48) {
    if (state.budget !== undefined) state.budget.exhausted = true;
    return undefined;
  }
  if (!isAstRecord(value)) return undefined;
  const literal = literalAstString(value);
  if (literal !== undefined) return [literal];
  if (value.type === 'Literal' && typeof value.value === 'number') return [String(value.value)];
  if (value.type === 'Identifier' && typeof value.name === 'string') {
    const binding = lookupBrowserBinding(value.name, scope);
    if (binding === undefined) return undefined;
    const atoms = evaluateBrowserBinding(binding, index, nextBrowserStaticEvaluationState(state));
    return browserOnlyStaticStrings(atoms);
  }
  if (value.type === 'BinaryExpression' && value.operator === '+') {
    const left = browserFiniteStaticStrings(
      value.left,
      scope,
      index,
      nextBrowserStaticEvaluationState(state),
    );
    const right = browserFiniteStaticStrings(
      value.right,
      scope,
      index,
      nextBrowserStaticEvaluationState(state),
    );
    if (
      left === undefined ||
      right === undefined ||
      left.length * right.length > maxBrowserFiniteStaticStrings
    ) {
      return undefined;
    }
    return left.flatMap((leftValue) => right.map((rightValue) => `${leftValue}${rightValue}`));
  }
  if (value.type === 'TemplateLiteral') {
    const expressions = Array.isArray(value.expressions) ? value.expressions : [];
    const quasis = Array.isArray(value.quasis) ? value.quasis : [];
    if (quasis.length !== expressions.length + 1) return undefined;
    let results = [''];
    for (let indexValue = 0; indexValue < quasis.length; indexValue += 1) {
      const quasi = quasis[indexValue];
      const cooked = isAstRecord(quasi)
        ? (quasi.value as { cooked?: unknown } | undefined)?.cooked
        : undefined;
      if (typeof cooked !== 'string') return undefined;
      results = results.map((result) => `${result}${cooked}`);
      if (indexValue >= expressions.length) continue;
      const expressionStrings = browserFiniteStaticStrings(
        expressions[indexValue],
        scope,
        index,
        nextBrowserStaticEvaluationState(state),
      );
      if (expressionStrings === undefined) return undefined;
      if (results.length * expressionStrings.length > maxBrowserFiniteStaticStrings) {
        return undefined;
      }
      results = results.flatMap((result) =>
        expressionStrings.map((expression) => `${result}${expression}`),
      );
    }
    return results;
  }
  if (value.type === 'ConditionalExpression') {
    const consequent = browserFiniteStaticStrings(value.consequent, scope, index, state);
    const alternate = browserFiniteStaticStrings(value.alternate, scope, index, state);
    if (
      consequent === undefined ||
      alternate === undefined ||
      consequent.length + alternate.length > maxBrowserFiniteStaticStrings
    ) {
      return undefined;
    }
    return [...consequent, ...alternate];
  }
  return undefined;
}

function browserOnlyStaticStrings(
  atoms: readonly BrowserStaticAtom[],
): readonly string[] | undefined {
  if (
    atoms.length === 0 ||
    atoms.length > maxBrowserFiniteStaticStrings ||
    atoms.some((atom) => atom.kind !== 'string')
  ) {
    return undefined;
  }
  return [...new Set(atoms.map((atom) => (atom.kind === 'string' ? atom.value : '')))];
}

function browserIdentifierIsValueReference(
  identifier: Readonly<Record<string, unknown>>,
  parent: Readonly<Record<string, unknown>> | undefined,
  key: string | undefined,
  bindingIdentifiers: WeakSet<object>,
): boolean {
  if (bindingIdentifiers.has(identifier as object) || parent === undefined) return false;
  if (parent.type === 'MemberExpression' && parent.computed !== true && key === 'property') {
    return false;
  }
  if (
    (parent.type === 'Property' ||
      parent.type === 'MethodDefinition' ||
      parent.type === 'PropertyDefinition') &&
    parent.computed !== true &&
    key === 'key'
  ) {
    return false;
  }
  if (
    ((parent.type === 'ImportSpecifier' ||
      parent.type === 'ImportDefaultSpecifier' ||
      parent.type === 'ImportNamespaceSpecifier' ||
      parent.type === 'ExportSpecifier') &&
      (key === 'local' || key === 'imported' || key === 'exported')) ||
    (parent.type === 'LabeledStatement' && key === 'label') ||
    ((parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') && key === 'label')
  ) {
    return false;
  }
  return true;
}

function isAstRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function staticObjectPropertyName(property: Readonly<Record<string, unknown>>): string | undefined {
  if (property.type !== 'Property') return undefined;
  const key = property.key;
  if (typeof key !== 'object' || key === null) return undefined;
  const record = key as Record<string, unknown>;
  if (property.computed === true) return finiteStaticMemberString(record);
  return record.type === 'Identifier' && typeof record.name === 'string' ? record.name : undefined;
}

function finiteStaticMemberString(value: unknown): string | undefined {
  const literal = literalAstString(value);
  if (literal !== undefined) return literal;
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record.type !== 'BinaryExpression' || record.operator !== '+') return undefined;
  const left = finiteStaticMemberString(record.left);
  const right = finiteStaticMemberString(record.right);
  return left === undefined || right === undefined ? undefined : `${left}${right}`;
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
        edges.push(parsedModuleEdge(record.source));
      }
    } else if (type === 'ImportExpression') {
      edges.push(parsedModuleEdge(record.source));
    } else if (type === 'CallExpression' && isModuleLoaderCall(record.callee)) {
      const args = Array.isArray(record.arguments) ? record.arguments : [];
      edges.push(parsedModuleEdge(args.length === 1 ? args[0] : undefined));
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

function parsedModuleEdge(value: unknown): ParsedModuleEdge {
  const specifier = literalAstString(value);
  return specifier === undefined ? {} : { specifier };
}

interface ArtifactModuleEdgeReplacement {
  readonly end: number;
  readonly source: string;
  readonly start: number;
}

function canonicalizeFiniteArtifactModuleEdges(source: string, ast: unknown): string {
  const replacements = finiteArtifactModuleEdgeReplacements(ast);
  replacements.sort((left, right) => right.start - left.start);
  let result = source;
  let previousStart = source.length;
  for (let index = 0; index < replacements.length; index += 1) {
    const replacement = replacements[index]!;
    if (
      replacement.start < 0 ||
      replacement.end <= replacement.start ||
      replacement.end > previousStart ||
      replacement.end > source.length
    ) {
      continue;
    }
    result = `${result.slice(0, replacement.start)}${JSON.stringify(replacement.source)}${result.slice(replacement.end)}`;
    previousStart = replacement.start;
  }
  return result;
}

function finiteArtifactModuleEdgeReplacements(ast: unknown): ArtifactModuleEdgeReplacement[] {
  const replacements: ArtifactModuleEdgeReplacement[] = [];
  const pending: Array<{ lexicalBody?: Record<string, unknown>; value: unknown }> = [
    { value: ast },
  ];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const item = pending.pop()!;
    const value = item.value;
    if (typeof value !== 'object' || value === null || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        pending.push({
          ...(item.lexicalBody === undefined ? {} : { lexicalBody: item.lexicalBody }),
          value: value[index],
        });
      }
      continue;
    }
    const record = value as Record<string, unknown>;
    const type = typeof record.type === 'string' ? record.type : undefined;
    const lexicalBody = type === 'Program' || type === 'BlockStatement' ? record : item.lexicalBody;
    if (type === 'ImportExpression') {
      const imported = record.source;
      if (typeof imported === 'object' && imported !== null && lexicalBody !== undefined) {
        const importedRecord = imported as Record<string, unknown>;
        if (
          importedRecord.type === 'Identifier' &&
          typeof importedRecord.name === 'string' &&
          typeof importedRecord.start === 'number' &&
          typeof importedRecord.end === 'number'
        ) {
          const constant = sameBodyConstantStringBinding(
            lexicalBody,
            importedRecord.name,
            importedRecord.start,
          );
          if (constant !== undefined) {
            replacements.push({
              end: importedRecord.end,
              source: constant,
              start: importedRecord.start,
            });
          }
        }
      }
    }
    const functionBoundary = isArtifactFunctionNode(type);
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
      const childLexicalBody = functionBoundary ? undefined : lexicalBody;
      pending.push({
        ...(childLexicalBody === undefined ? {} : { lexicalBody: childLexicalBody }),
        value: child,
      });
    }
  }
  return replacements;
}

function isArtifactFunctionNode(type: string | undefined): boolean {
  return (
    type === 'ArrowFunctionExpression' ||
    type === 'FunctionDeclaration' ||
    type === 'FunctionExpression'
  );
}

function sameBodyConstantStringBinding(
  lexicalBody: Record<string, unknown>,
  name: string,
  before: number,
): string | undefined {
  const statements = Array.isArray(lexicalBody.body) ? lexicalBody.body : [];
  let found: string | undefined;
  for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
    const statement = statements[statementIndex];
    if (typeof statement !== 'object' || statement === null) continue;
    const statementRecord = statement as Record<string, unknown>;
    if (typeof statementRecord.start !== 'number' || statementRecord.start >= before) continue;
    if (statementRecord.type !== 'VariableDeclaration') continue;
    const declarations = Array.isArray(statementRecord.declarations)
      ? statementRecord.declarations
      : [];
    for (let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex += 1) {
      const declaration = declarations[declarationIndex];
      if (typeof declaration !== 'object' || declaration === null) continue;
      const declarationRecord = declaration as Record<string, unknown>;
      if (
        typeof declarationRecord.start !== 'number' ||
        typeof declarationRecord.end !== 'number' ||
        declarationRecord.start >= before ||
        declarationRecord.end >= before
      ) {
        continue;
      }
      const id = declarationRecord.id;
      if (typeof id !== 'object' || id === null) continue;
      const idRecord = id as Record<string, unknown>;
      if (idRecord.type !== 'Identifier' || idRecord.name !== name) continue;
      if (statementRecord.kind !== 'const' || found !== undefined) return undefined;
      const constant = literalAstString(declarationRecord.init);
      if (constant === undefined) return undefined;
      found = constant;
    }
  }
  return found;
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
