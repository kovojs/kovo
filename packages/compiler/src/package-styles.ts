import {
  dirname as builtinPathDirname,
  extname as builtinPathExtname,
  isAbsolute as builtinPathIsAbsolute,
  relative as builtinPathRelative,
  resolve as builtinPathResolve,
  sep as pathSeparator,
} from 'node:path';

import { isUnitlessCssProperty } from '@kovojs/style/internal';

import { dedupeCss } from './css.js';
import {
  cssRouteSplitTargetsFromRouteFacts,
  type ComponentCssAsset,
  type CssRouteSplitTarget,
} from './css.js';
import { deriveComponentNames } from './component-names.js';
import { findFragmentTargetFacts } from './app-graph.js';
import { cssIrHeader } from './ir.js';
import {
  compilerArrayAppend,
  compilerCreateMap,
  compilerCreateSet,
  compilerJsonParse,
  compilerMapGet,
  compilerMapSet,
  compilerObjectKeys,
  compilerOwnDataValue,
  compilerRegExpReplace,
  compilerSetAdd,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerSnapshotJsonValue,
  compilerStringEndsWith,
  compilerStringIncludes,
  compilerStringSlice,
  compilerStringStartsWith,
} from './compiler-security-intrinsics.js';
import {
  resolvePackageManifestPath,
  type PackageComponentPrefixDiscoveryOptions,
} from './package-prefixes.js';
import { firstComponentModel, parseComponentModule } from './scan/parse.js';
import { compileRouteModule } from './scan/route-pages.js';
import { uniqueSorted } from './shared.js';
import {
  createCompilerSourceFileSystem,
  type CompilerSourceFileSystem,
} from './source-filesystem.js';
import { extractKovoStyles } from './style.js';
import type { RoutePageFact } from './types.js';

const nativePathDirname = builtinPathDirname;
const nativePathExtname = builtinPathExtname;
const nativePathIsAbsolute = builtinPathIsAbsolute;
const nativePathRelative = builtinPathRelative;
const nativePathResolve = builtinPathResolve;

// SPEC §6.1.1 + §13.1: a first-party component package (one that declares a
// `kovo.prefix`, e.g. `@kovojs/ui` → `kovo-ui-`) authors its styled components
// with `@kovojs/style` `style.create(...)`. The compiler's StyleX extraction
// (`extractKovoStyles`) normally runs only on the app source it compiles, so a
// consuming app that imports a prebuilt package component gets the package's
// deterministic `kv-*` class names with no CSS. This pass re-extracts the
// package's component CSS so the app build can serve it. It is styling-only: it
// does not lower the package's `<Component>` JSX into prefixed hosts or stamp
// `kovo-c`/behavior attributes (no package-component host-lowering exists yet).

/** Diagnostic emitted by the first-party package CSS extraction build helper. */
export interface PackageComponentCssDiagnostic {
  /** Package-relative source file whose `style.create(...)` produced no CSS. */
  readonly fileName: string;
  readonly message: string;
}

/** Result returned by the first-party package CSS extraction build helper. */
export interface PackageComponentCssResult {
  /** Deduped CSS across every styled component file in the package. */
  readonly css: string | null;
  /** Per-source CSS assets retained for build splitting. */
  readonly cssAssets: readonly ComponentCssAsset[];
  /**
   * Files that import `@kovojs/style` and call `style.create(...)` but yielded
   * no extracted CSS — the conservative extractor bailed (spreads, computed
   * keys, non-static values). These would render silently unstyled (A5 gate).
   */
  readonly diagnostics: readonly PackageComponentCssDiagnostic[];
  /** Absolute `.tsx` entry files that were scanned, in stable order. */
  readonly sourceFiles: readonly string[];
}

/** Result returned by the app-source CSS extraction build helper. */
export interface AppComponentCssResult {
  /** Deduped CSS across every styled app source file. */
  readonly css: string | null;
  /** Per-source CSS assets retained for build splitting. */
  readonly cssAssets: readonly ComponentCssAsset[];
  /** Styled files whose CSS could not be statically lowered. */
  readonly diagnostics: readonly PackageComponentCssDiagnostic[];
  /** Absolute app source files scanned, in stable order. */
  readonly sourceFiles: readonly string[];
}

/** Result returned by the app route CSS target extraction helper. */
export interface AppRouteCssTargetsResult {
  readonly routePageFacts: readonly RoutePageFact[];
  readonly routeTargets: readonly CssRouteSplitTarget[];
  readonly sourceFiles: readonly string[];
}

interface ResolvedPackage {
  readonly fileSystem: CompilerSourceFileSystem;
  readonly manifest: { readonly exports?: unknown; readonly name?: string };
  readonly packageDir: string;
}

/**
 * Extract the StyleX CSS for every styled component file reachable through a
 * package's `exports` map. Returns deduped CSS ready to serve as one stylesheet
 * asset, plus coverage diagnostics for files whose styles could not be lowered.
 *
 * Public first-party build API for package CSS extraction in app/site build scripts.
 */
export function extractPackageComponentCss(
  packageName: string,
  options: PackageComponentPrefixDiscoveryOptions,
): PackageComponentCssResult {
  const resolved = resolvePackage(packageName, options);
  if (!resolved) {
    return { css: null, cssAssets: [], diagnostics: [], sourceFiles: [] };
  }

  return extractComponentCssFromFiles(packageComponentSourceFiles(resolved), {
    fileSystem: resolved.fileSystem,
    rootDir: resolved.packageDir,
    resolveStaticImport: resolveLocalStaticImport(resolved.fileSystem),
  });
}

/**
 * Extract the StyleX CSS for authored app source files under the app entry's
 * directory. This covers app/layout modules that use `style.create(...)` but are
 * not themselves compiled component modules, so build-owned CSS does not depend
 * on hand-authored `emitAtomicCss(... __rules ...)` exports.
 */
export function extractAppComponentCss(
  options: PackageComponentPrefixDiscoveryOptions,
): AppComponentCssResult {
  const rootDir = nativePathDirname(nativePathResolve(options.fileName));
  const fileSystem = createCompilerSourceFileSystem(rootDir);
  if (fileSystem === null) {
    return { css: null, cssAssets: [], diagnostics: [], sourceFiles: [] };
  }
  return extractComponentCssFromFiles(appComponentSourceFiles(rootDir, fileSystem), {
    defaultStyleIdentity: {
      keyframes: 'keyframes',
      styles: 'style',
      theme: 'theme',
      vars: 'tokens',
    },
    fileSystem,
    rootDir,
    resolveStaticImport: resolveLocalStaticImport(fileSystem),
  });
}

/** Extract route-level CSS split targets from authored app source files. */
export function extractAppRouteCssTargets(
  options: PackageComponentPrefixDiscoveryOptions,
): AppRouteCssTargetsResult {
  const rootDir = nativePathDirname(nativePathResolve(options.fileName));
  const fileSystem = createCompilerSourceFileSystem(rootDir);
  if (fileSystem === null) return { routePageFacts: [], routeTargets: [], sourceFiles: [] };
  const sourceFiles = appComponentSourceFiles(rootDir, fileSystem);
  const routePageFacts: RoutePageFact[] = [];

  const sourceFileSnapshot = compilerSnapshotDenseArray(
    sourceFiles,
    'Compiler app route CSS source files',
  );
  for (let index = 0; index < sourceFileSnapshot.length; index += 1) {
    const fileName = sourceFileSnapshot[index]!;
    const source = fileSystem.readFile(fileName);
    if (source === null) continue;
    if (
      !compilerStringIncludes(source, 'route(') &&
      !compilerStringIncludes(source, '@kovojs/server')
    ) {
      continue;
    }

    const compiledFacts = compilerSnapshotDenseArray(
      compileRouteModule({
        fileName: relativeToRoot(rootDir, fileName),
        source,
      }).routePageFacts,
      'Compiler app route CSS facts',
    );
    for (let factIndex = 0; factIndex < compiledFacts.length; factIndex += 1) {
      compilerArrayAppend(
        routePageFacts,
        compiledFacts[factIndex]!,
        'Compiler app route CSS facts',
      );
    }
  }

  const enrichedRoutePageFacts = routePageFactsWithFragmentTargets(
    routePageFacts,
    appFragmentTargetsByCssSourceFileName(sourceFiles, rootDir, fileSystem),
  );

  return {
    routePageFacts: enrichedRoutePageFacts,
    routeTargets: cssRouteSplitTargetsFromRouteFacts(enrichedRoutePageFacts),
    sourceFiles,
  };
}

interface ExtractComponentCssFromFilesOptions {
  readonly defaultStyleIdentity?: {
    readonly keyframes?: string;
    readonly styles?: string;
    readonly theme?: string;
    readonly vars?: string;
  };
  readonly fileSystem: CompilerSourceFileSystem;
  readonly resolveStaticImport: (fromFileName: string, specifier: string) => string | null;
  readonly rootDir: string;
}

function extractComponentCssFromFiles(
  sourceFiles: readonly string[],
  options: ExtractComponentCssFromFilesOptions,
): PackageComponentCssResult {
  const chunks: string[] = [];
  const cssAssets: ComponentCssAsset[] = [];
  const diagnostics: PackageComponentCssDiagnostic[] = [];

  const sourceFileSnapshot = compilerSnapshotDenseArray(
    sourceFiles,
    'Compiler component CSS source files',
  );
  for (let index = 0; index < sourceFileSnapshot.length; index += 1) {
    const fileName = sourceFileSnapshot[index]!;
    const source = options.fileSystem.readFile(fileName);
    if (source === null) continue;
    // Cheap pre-filter so non-styled entries (behavior-only re-exports) are skipped.
    if (
      !compilerStringIncludes(source, '@kovojs/style') ||
      !compilerStringIncludes(source, 'style.create')
    ) {
      continue;
    }

    const model = parseComponentModule(fileName, source);
    const extraction = extractKovoStyles(fileName, source, model, 'Component', {
      ...(options.defaultStyleIdentity === undefined
        ? {}
        : { defaultStyleIdentity: options.defaultStyleIdentity }),
      resolveStaticImport: options.resolveStaticImport,
    });
    if (extraction.css) {
      compilerArrayAppend(chunks, extraction.css, 'Compiler component CSS chunks');
      compilerArrayAppend(
        cssAssets,
        componentCssAssetForSource(
          fileName,
          options.rootDir,
          extraction.css,
          fragmentTargetsForSource(relativeToRoot(options.rootDir, fileName), model),
          extraction.ruleUsages,
        ),
        'Compiler component CSS assets',
      );
    } else {
      compilerArrayAppend(
        diagnostics,
        {
          fileName: relativeToRoot(options.rootDir, fileName),
          message:
            'style.create(...) present but no CSS was extracted; the component would render ' +
            'unstyled. Ensure styles are static so identity can be derived from the binding and file.',
        },
        'Compiler component CSS diagnostics',
      );
    }
  }

  if (chunks.length === 0) {
    return { css: null, cssAssets, diagnostics, sourceFiles };
  }

  return {
    css: `${cssIrHeader}\n${dedupeKeyframeBlocks(normalizeServedCss(dedupeCss(chunks)))}`,
    cssAssets,
    diagnostics,
    sourceFiles,
  };
}

/**
 * Drop duplicate `@keyframes <name> { … }` blocks from the combined stylesheet,
 * keeping the first occurrence. Each styled component file emits its own
 * `@keyframes` block (from `style.keyframes`) into its CSS chunk, so a keyframe
 * shared by several components would otherwise appear once per file after the
 * chunks are concatenated. Dedup is by animation-name (deterministic
 * `kv-<slug>-<hash>`), so distinct keyframes are preserved (SPEC.md §13.1).
 */
function dedupeKeyframeBlocks(css: string): string {
  const seen = compilerCreateSet<string>();
  return compilerRegExpReplace(
    /@keyframes\s+([\w-]+)\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g,
    css,
    (match, name) => {
      if (compilerSetHas(seen, name)) return '';
      compilerSetAdd(seen, name);
      return match;
    },
  );
}

function componentCssAssetForSource(
  fileName: string,
  rootDir: string,
  css: string,
  fragmentTargets: readonly string[] = [],
  styleRuleUsages: ReturnType<typeof extractKovoStyles>['ruleUsages'] = [],
): ComponentCssAsset {
  const sourceFileName = replaceSourceExtension(relativeToRoot(rootDir, fileName), '.css');
  return {
    componentName: compilerRegExpReplace(/\.css$/, sourceFileName, ''),
    criticalCss: `${cssIrHeader}\n${normalizeServedCss(css)}`,
    fragmentTargets,
    href: `/assets/${sourceFileName}`,
    sourceFileName,
    ...(styleRuleUsages.length === 0 ? {} : { styleRuleUsages }),
  };
}

function fragmentTargetsForSource(
  fileName: string,
  model: ReturnType<typeof parseComponentModule>,
): string[] {
  const { registryKey } = deriveComponentNames(fileName, firstComponentModel(model));
  const facts = compilerSnapshotDenseArray(
    findFragmentTargetFacts(registryKey, model),
    'Compiler fragment target facts',
  );
  const targets: string[] = [];
  for (let index = 0; index < facts.length; index += 1) {
    compilerArrayAppend(targets, facts[index]!.target, 'Compiler component CSS fragment targets');
  }
  return targets;
}

function routePageFactsWithFragmentTargets(
  routePageFacts: readonly RoutePageFact[],
  fragmentTargetsBySourceFileName: ReadonlyMap<string, readonly string[]>,
): RoutePageFact[] {
  const facts = compilerSnapshotDenseArray(routePageFacts, 'Compiler route page CSS facts');
  const output: RoutePageFact[] = [];
  for (let index = 0; index < facts.length; index += 1) {
    const fact = facts[index]!;
    const sourceFileNames = compilerSnapshotDenseArray(
      fact.css?.sourceFileNames ?? [],
      'Compiler route CSS source file names',
    );
    const combinedTargets: string[] = [];
    const declaredTargets = compilerSnapshotDenseArray(
      fact.css?.fragmentTargets ?? [],
      'Compiler route CSS fragment targets',
    );
    for (let targetIndex = 0; targetIndex < declaredTargets.length; targetIndex += 1) {
      compilerArrayAppend(
        combinedTargets,
        declaredTargets[targetIndex]!,
        'Compiler route CSS combined fragment targets',
      );
    }
    for (let sourceIndex = 0; sourceIndex < sourceFileNames.length; sourceIndex += 1) {
      const targets = compilerSnapshotDenseArray(
        compilerMapGet(fragmentTargetsBySourceFileName, sourceFileNames[sourceIndex]!) ?? [],
        'Compiler source CSS fragment targets',
      );
      for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
        compilerArrayAppend(
          combinedTargets,
          targets[targetIndex]!,
          'Compiler route CSS combined fragment targets',
        );
      }
    }
    const fragmentTargets = uniqueSorted(combinedTargets);
    compilerArrayAppend(
      output,
      fragmentTargets.length === 0
        ? fact
        : {
            ...fact,
            css: {
              ...fact.css,
              fragmentTargets,
            },
          },
      'Compiler route page CSS output facts',
    );
  }
  return output;
}

function appFragmentTargetsByCssSourceFileName(
  sourceFiles: readonly string[],
  rootDir: string,
  fileSystem: CompilerSourceFileSystem,
): ReadonlyMap<string, readonly string[]> {
  const fragmentTargetsBySourceFileName = compilerCreateMap<string, readonly string[]>();

  const sourceFileSnapshot = compilerSnapshotDenseArray(
    sourceFiles,
    'Compiler app fragment CSS source files',
  );
  for (let index = 0; index < sourceFileSnapshot.length; index += 1) {
    const fileName = sourceFileSnapshot[index]!;
    const source = fileSystem.readFile(fileName);
    if (source === null || !compilerStringIncludes(source, 'component(')) continue;

    const relativeFileName = relativeToRoot(rootDir, fileName);
    const fragmentTargets = fragmentTargetsForSource(
      relativeFileName,
      parseComponentModule(fileName, source),
    );
    if (fragmentTargets.length === 0) continue;
    compilerMapSet(
      fragmentTargetsBySourceFileName,
      replaceSourceExtension(relativeFileName, '.css'),
      compilerSnapshotDenseArray(fragmentTargets, 'Compiler app CSS fragment targets'),
    );
  }

  return fragmentTargetsBySourceFileName;
}

function resolveLocalStaticImport(
  fileSystem: CompilerSourceFileSystem,
): (fromFileName: string, specifier: string) => string | null {
  return (fromFileName, specifier) => {
    if (!compilerStringStartsWith(specifier, '.')) return null;
    const absolute = nativePathResolve(nativePathDirname(fromFileName), specifier);
    if (!isInsideDirectory(fileSystem.root, absolute)) return null;
    const candidates = compilerSnapshotDenseArray(
      staticImportCandidates(absolute),
      'Compiler static import candidates',
    );
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]!;
      if (!isInsideDirectory(fileSystem.root, candidate)) continue;
      const source = fileSystem.readFile(candidate);
      if (source !== null) return source;
    }
    return null;
  };
}

function staticImportCandidates(absoluteSpecifier: string): string[] {
  const withoutJs = compilerStringEndsWith(absoluteSpecifier, '.js')
    ? compilerStringSlice(absoluteSpecifier, 0, -'.js'.length)
    : absoluteSpecifier;
  return [
    absoluteSpecifier,
    `${withoutJs}.ts`,
    `${withoutJs}.tsx`,
    nativePathResolve(withoutJs, 'index.ts'),
    nativePathResolve(withoutJs, 'index.tsx'),
  ];
}

function isInsideDirectory(root: string, target: string): boolean {
  const relativeTarget = nativePathRelative(root, target);
  return (
    relativeTarget === '' ||
    (relativeTarget !== '..' &&
      !compilerStringStartsWith(relativeTarget, `..${pathSeparator}`) &&
      !nativePathIsAbsolute(relativeTarget))
  );
}

/**
 * Make `@kovojs/style`-emitted atomic CSS valid for a real CSS parser/browser.
 * Two latent engine gaps surface only once this CSS is actually served (no app
 * has consumed @kovojs/ui's StyleX output before): bare-number lengths and
 * digit-leading `@layer` sub-names. Both are fixed in the served text only, so
 * the runtime `style.attrs` class names (which hash the raw value) are unchanged.
 * Tracked as upstream @kovojs/style fixes; normalized here to unblock examples.
 */
function normalizeServedCss(css: string): string {
  return normalizeNumericLengths(normalizeLayerNames(dropInvalidSelectorRules(css)));
}

/**
 * Drop atomic rules whose selector embeds a `&` (CSS nesting / Tailwind
 * arbitrary-variant syntax, e.g. table.tsx's `'[&_tr:last-child]'` key). StyleX
 * has no nesting, so it lowers these to an invalid attribute selector that a real
 * parser rejects. Dropping the rule keeps the rest of the stylesheet valid; the
 * affected styling is a cosmetic edge (e.g. last-row border) the demo can live
 * without. Tracked as an upstream component-authoring fix.
 */
function dropInvalidSelectorRules(css: string): string {
  return compilerRegExpReplace(/\.[\w-]+\[[^\]]*&[^\]]*\]\{[^}]*\}/g, css, '');
}

/**
 * `@layer kovo-style.2000` is invalid CSS — a layer name segment cannot start
 * with a digit (a parser reads `.2000` as the number `0.2`). Flatten the numeric
 * priority sub-name to a valid ident (`kovo-style-2000`); cascade order is
 * preserved because layers still order by first declaration.
 */
function normalizeLayerNames(css: string): string {
  return compilerRegExpReplace(
    /@layer\s+kovo-style\.(\d+)/g,
    css,
    (_match, priority) => `@layer kovo-style-${priority}`,
  );
}

/**
 * Append `px` to single-value bare-number length declarations (`padding:8` →
 * `padding:8px`). Only matches a number that ends the declaration (`;`/`}`), so
 * multi-token values (`box-shadow:0 4px ...`) and already-unit'd values are left
 * untouched. Unitless properties (opacity, z-index, line-height, …) are skipped
 * via the shared `isUnitlessCssProperty` classifier from `@kovojs/style/internal`.
 *
 * `@kovojs/style`'s `emitAtomicCss` now appends the unit at the source (see
 * `cssLengthValue`), so for engine-emitted CSS this pass is an idempotent no-op
 * (`:12px}` no longer matches the bare-number pattern). It is kept as a
 * defense-in-depth normalizer for any CSS text that reaches the served bundle by
 * another path, and so the two stay provably in lockstep through the shared set.
 *
 * CSS custom properties (`--kovo-ns-token:1.5`, emitted raw by `defineVars` via
 * engine.ts:353) are NOT lengths — their value is opaque and substituted by
 * `var()`. The capture `[a-z-]+` would match `--kovo-t-ratio` and px-ify it,
 * producing invalid `--kovo-t-ratio:1.5px`, so declarations whose property begins
 * with `--` are skipped (mirrors `cssLengthValue`'s `--` guard in
 * `@kovojs/style`). (SPEC.md §13.1)
 *
 * @internal Exported for the served-CSS normalizer conformance test only; not
 * part of the app-facing public surface (rules/api-surface.md).
 */
export function normalizeNumericLengths(css: string): string {
  return compilerRegExpReplace(
    /([a-z-]+):(-?\d+(?:\.\d+)?)([;}])/g,
    css,
    (match, property: string, value: string, terminator: string) =>
      compilerStringStartsWith(property, '--') ||
      isUnitlessCssProperty(property) ||
      value === '0'
        ? match
        : `${property}:${value}px${terminator}`,
  );
}

function resolvePackage(
  packageName: string,
  options: PackageComponentPrefixDiscoveryOptions,
): ResolvedPackage | null {
  const manifestPath = resolvePackageManifestPath(packageName, options);
  if (!manifestPath) return null;
  try {
    const packageDir = nativePathDirname(manifestPath);
    const fileSystem = createCompilerSourceFileSystem(packageDir);
    const manifestSource = fileSystem?.readFile(manifestPath);
    if (fileSystem === null || manifestSource === null || manifestSource === undefined) return null;
    const manifest = compilerSnapshotJsonValue(
      compilerJsonParse(manifestSource),
      'Compiler package manifest',
    );
    if (typeof manifest !== 'object' || manifest === null) return null;
    return {
      fileSystem,
      manifest: manifest as ResolvedPackage['manifest'],
      packageDir,
    };
  } catch {
    return null;
  }
}

/**
 * Collect the `.tsx` files a package publishes through its `exports` map. We use
 * `exports` (not a glob) so only the package's public component surface is
 * scanned, matching how an app actually imports it (`@kovojs/ui/button`).
 */
function packageComponentSourceFiles(resolved: ResolvedPackage): string[] {
  const exportsMap = compilerOwnDataValue(
    resolved.manifest,
    'exports',
    'Compiler package manifest',
  );
  if (!exportsMap || typeof exportsMap !== 'object') return [];

  const files: string[] = [];
  const keys = compilerSnapshotDenseArray(
    compilerObjectKeys(exportsMap),
    'Compiler package export keys',
  );
  for (let index = 0; index < keys.length; index += 1) {
    const target = compilerOwnDataValue(exportsMap, keys[index]!, 'Compiler package exports');
    const targetPath = exportTargetPath(target, 0);
    if (!targetPath || !compilerStringEndsWith(targetPath, '.tsx')) continue;
    const absolute = nativePathResolve(resolved.packageDir, targetPath);
    if (
      isInsideDirectory(resolved.packageDir, absolute) &&
      resolved.fileSystem.kind(absolute) === 'file'
    ) {
      compilerArrayAppend(files, absolute, 'Compiler package component source files');
    }
  }
  return uniqueSorted(files);
}

function appComponentSourceFiles(rootDir: string, fileSystem: CompilerSourceFileSystem): string[] {
  const files: string[] = [];
  collectAppComponentSourceFiles(rootDir, fileSystem, files);
  return uniqueSorted(files);
}

function collectAppComponentSourceFiles(
  dir: string,
  fileSystem: CompilerSourceFileSystem,
  files: string[],
): void {
  const entries = compilerSnapshotDenseArray(
    fileSystem.entries(dir),
    'Compiler app source directory entries',
  );
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const absolute = nativePathResolve(dir, entry);
    const kind = fileSystem.kind(absolute);
    if (kind === 'directory') {
      if (ignoredAppSourceDirectory(entry)) continue;
      collectAppComponentSourceFiles(absolute, fileSystem, files);
      continue;
    }
    if (kind !== 'file' || !appSourceExtension(absolute)) continue;
    compilerArrayAppend(files, absolute, 'Compiler app component source files');
  }
}

function ignoredAppSourceDirectory(name: string): boolean {
  return (
    name === 'generated' ||
    name === 'node_modules' ||
    name === 'dist' ||
    compilerStringStartsWith(name, '.')
  );
}

function appSourceExtension(fileName: string): boolean {
  const extension = nativePathExtname(fileName);
  return extension === '.js' || extension === '.jsx' || extension === '.ts' || extension === '.tsx';
}

function replaceSourceExtension(fileName: string, extension: string): string {
  const currentExtension = nativePathExtname(fileName);
  return currentExtension
    ? `${compilerStringSlice(fileName, 0, -currentExtension.length)}${extension}`
    : `${fileName}${extension}`;
}

function exportTargetPath(target: unknown, depth: number): string | null {
  if (depth > 64) return null;
  if (typeof target === 'string') return target;
  // Conditional exports object ({ import, default, ... }): take the first string.
  if (target && typeof target === 'object') {
    const keys = compilerSnapshotDenseArray(
      compilerObjectKeys(target),
      'Compiler conditional package export keys',
    );
    for (let index = 0; index < keys.length; index += 1) {
      const value = compilerOwnDataValue(
        target,
        keys[index]!,
        'Compiler conditional package export',
      );
      const nested = exportTargetPath(value, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function relativeToRoot(rootDir: string, fileName: string): string {
  if (!isInsideDirectory(rootDir, fileName)) return fileName;
  const relativeFileName = nativePathRelative(rootDir, fileName);
  return relativeFileName === '' ? fileName : relativeFileName;
}
