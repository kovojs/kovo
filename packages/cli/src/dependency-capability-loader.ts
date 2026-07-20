import { realpathSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  AppDependencyCapability,
  AppDependencyCapabilityManifest,
  ResolvedCapabilityPackage,
} from '@kovojs/compiler/internal';
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

  const rememberLoadedHtml = (id: string): void => {
    const sourcePath = viteSourcePath(id);
    if (sourcePath !== undefined && isHtmlSourcePath(sourcePath)) {
      loadedHtmlPaths.add(sourcePath);
    }
  };

  return {
    configResolved(config) {
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
        for (const edge of parsedModuleEdges(ast)) {
          if (edge.specifier === undefined) {
            throw dependencyCapabilityError(
              `reviewed package ${reviewedPackage.packageName} contains a non-literal module edge before app evaluation`,
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
            `external HTML module ${specifier} is outside the immutable approved-source snapshot in ${lane}`,
          );
        }
        return resolved;
      }
      const importerName = importerPath === undefined ? undefined : approvedPaths.get(importerPath);
      const reviewedPackage =
        importerPath === undefined
          ? undefined
          : packageOwnerForSource(importerPath, reviewedThirdPartyRoots);
      if (reviewedPackage !== undefined && !isBareDependencySpecifier(specifier)) {
        const resolved = await this.resolve(specifier, importer, { skipSelf: true });
        const resolvedPath =
          resolved === null || resolved.external === true ? undefined : viteSourcePath(resolved.id);
        if (
          resolved === null ||
          resolved.external === true ||
          resolvedPath === undefined ||
          !sourceIsWithinRoot(reviewedPackage.root, resolvedPath)
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
      const packageRoot =
        resolved === null || resolved.external === true
          ? undefined
          : capabilityPackageResolvedTargetRoot(specifier, importerPath, resolved.id);
      if (resolved === null || resolved.external === true || packageRoot === undefined) {
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
      const bundleOwnedFileNames = new Set(Object.keys(bundle));
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const specifier of [...output.imports, ...output.dynamicImports]) {
          if (bundleOwnedFileNames.has(specifier)) continue;
          assertSupportedArtifactExternal(specifier, lane, options, 'bare import');
        }
        for (const specifier of literalRequireSpecifiers(output.code)) {
          assertSupportedArtifactExternal(specifier, lane, options, 'literal require');
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
                !sourceIsWithinRoot(reviewedPackage.root, importedPath))
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

function dependencySpecifierMatches(specifier: string, packageName: string): boolean {
  return specifier === packageName || specifier.startsWith(`${packageName}/`);
}

function viteSourcePath(id: string): string | undefined {
  let value = id.split(/[?#]/u, 1)[0] ?? id;
  if (value.startsWith('/@fs/')) value = value.slice('/@fs'.length);
  if (value.startsWith('file:')) {
    try {
      value = fileURLToPath(value);
    } catch {
      return undefined;
    }
  }
  return isAbsolute(value) ? canonicalSourcePath(value) : undefined;
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
    if (sourceIsWithinRoot(root, sourcePath)) return { packageName, root };
  }
  return undefined;
}

function sourceIsWithinRoot(root: string, sourcePath: string): boolean {
  const candidate = relative(root, sourcePath).replaceAll('\\', '/');
  return (
    candidate !== '' && candidate !== '..' && !candidate.startsWith('../') && !isAbsolute(candidate)
  );
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
  if (record.type !== 'MemberExpression' || record.computed === true) return false;
  const object = record.object;
  const property = record.property;
  return (
    typeof object === 'object' &&
    object !== null &&
    (object as Record<string, unknown>).type === 'Identifier' &&
    (object as Record<string, unknown>).name === 'module' &&
    typeof property === 'object' &&
    property !== null &&
    (property as Record<string, unknown>).type === 'Identifier' &&
    (property as Record<string, unknown>).name === 'require'
  );
}

function assertSupportedArtifactExternal(
  specifier: string,
  lane: DependencyCapabilityLoaderLane,
  options: DependencyCapabilityLoaderOptions,
  form: 'bare import' | 'literal require',
): void {
  if (!isBareDependencySpecifier(specifier)) return;
  if (options.allowNodeBuiltins === true && isNodeBuiltinSpecifier(specifier)) return;
  if (options.allowRuntimeExternal?.(specifier) === true) return;
  throw dependencyCapabilityError(
    `uncensused dependency ${specifier} escaped the supported ${lane} artifact as a ${form}`,
  );
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
