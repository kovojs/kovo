import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';

import { UNITLESS_CSS_PROPERTIES } from '@kovojs/style/internal';

import { dedupeCss } from './css.js';
import type { ComponentCssAsset } from './css.js';
import { cssIrHeader } from './ir.js';
import {
  resolvePackageManifestPath,
  type PackageComponentPrefixDiscoveryOptions,
} from './package-prefixes.js';
import { parseComponentModule } from './scan/parse.js';
import { extractKovoStyles } from './style.js';

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

interface ResolvedPackage {
  readonly manifest: { exports?: Record<string, unknown>; name?: string };
  readonly packageDir: string;
}

/**
 * Extract the StyleX CSS for every styled component file reachable through a
 * package's `exports` map. Returns deduped CSS ready to serve as one stylesheet
 * asset, plus coverage diagnostics for files whose styles could not be lowered.
 *
 * Public first-party build API for example/app `emit-ui-css` scripts.
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
    rootDir: resolved.packageDir,
    resolveStaticImport: resolveLocalStaticImport(resolved.packageDir),
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
  const rootDir = dirname(resolve(options.fileName));
  return extractComponentCssFromFiles(appComponentSourceFiles(rootDir), {
    rootDir,
    resolveStaticImport: resolveLocalStaticImport(rootDir),
  });
}

interface ExtractComponentCssFromFilesOptions {
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

  for (const fileName of sourceFiles) {
    let source: string;
    try {
      source = readFileSync(fileName, 'utf8');
    } catch {
      continue;
    }
    // Cheap pre-filter so non-styled entries (behavior-only re-exports) are skipped.
    if (!source.includes('@kovojs/style') || !source.includes('style.create')) continue;

    const model = parseComponentModule(fileName, source);
    const extraction = extractKovoStyles(fileName, source, model, 'Component', {
      resolveStaticImport: options.resolveStaticImport,
    });
    if (extraction.css) {
      chunks.push(extraction.css);
      cssAssets.push(componentCssAssetForSource(fileName, options.rootDir, extraction.css));
    } else {
      diagnostics.push({
        fileName: relativeToRoot(options.rootDir, fileName),
        message:
          'style.create(...) present but no CSS was extracted; the component would render ' +
          'unstyled. Ensure styles are static so identity can be derived from the binding and file.',
      });
    }
  }

  if (chunks.length === 0) {
    return { css: null, cssAssets, diagnostics, sourceFiles };
  }

  return {
    css: `${cssIrHeader}\n${normalizeServedCss(dedupeCss(chunks))}`,
    cssAssets,
    diagnostics,
    sourceFiles,
  };
}

function componentCssAssetForSource(
  fileName: string,
  rootDir: string,
  css: string,
): ComponentCssAsset {
  const sourceFileName = replaceSourceExtension(relativeToRoot(rootDir, fileName), '.css');
  return {
    componentName: sourceFileName.replace(/\.css$/, ''),
    criticalCss: `${cssIrHeader}\n${normalizeServedCss(css)}`,
    fragmentTargets: [],
    href: `/assets/${sourceFileName}`,
    sourceFileName,
  };
}

function resolveLocalStaticImport(
  rootDir: string,
): (fromFileName: string, specifier: string) => string | null {
  return (fromFileName, specifier) => {
    if (!specifier.startsWith('.')) return null;
    const absolute = resolve(dirname(fromFileName), specifier);
    if (!isInsideDirectory(rootDir, absolute)) return null;
    for (const candidate of staticImportCandidates(absolute)) {
      if (!isInsideDirectory(rootDir, candidate)) continue;
      if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
    }
    return null;
  };
}

function staticImportCandidates(absoluteSpecifier: string): string[] {
  const withoutJs = absoluteSpecifier.endsWith('.js')
    ? absoluteSpecifier.slice(0, -'.js'.length)
    : absoluteSpecifier;
  return [
    absoluteSpecifier,
    `${withoutJs}.ts`,
    `${withoutJs}.tsx`,
    resolve(withoutJs, 'index.ts'),
    resolve(withoutJs, 'index.tsx'),
  ];
}

function isInsideDirectory(root: string, target: string): boolean {
  const relativeTarget = relative(root, target);
  return relativeTarget === '' || (!relativeTarget.startsWith('..') && !isAbsolute(relativeTarget));
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
  return css.replace(/\.[\w-]+\[[^\]]*&[^\]]*\]\{[^}]*\}/g, '');
}

/**
 * `@layer kovo-style.2000` is invalid CSS — a layer name segment cannot start
 * with a digit (a parser reads `.2000` as the number `0.2`). Flatten the numeric
 * priority sub-name to a valid ident (`kovo-style-2000`); cascade order is
 * preserved because layers still order by first declaration.
 */
function normalizeLayerNames(css: string): string {
  return css.replace(/@layer\s+kovo-style\.(\d+)/g, '@layer kovo-style-$1');
}

/**
 * Append `px` to single-value bare-number length declarations (`padding:8` →
 * `padding:8px`). Only matches a number that ends the declaration (`;`/`}`), so
 * multi-token values (`box-shadow:0 4px ...`) and already-unit'd values are left
 * untouched. Unitless properties (opacity, z-index, line-height, …) are skipped
 * via the shared `UNITLESS_CSS_PROPERTIES` set from `@kovojs/style/internal`.
 *
 * `@kovojs/style`'s `emitAtomicCss` now appends the unit at the source (see
 * `cssLengthValue`), so for engine-emitted CSS this pass is an idempotent no-op
 * (`:12px}` no longer matches the bare-number pattern). It is kept as a
 * defense-in-depth normalizer for any CSS text that reaches the served bundle by
 * another path, and so the two stay provably in lockstep through the shared set.
 */
function normalizeNumericLengths(css: string): string {
  return css.replace(
    /([a-z-]+):(-?\d+(?:\.\d+)?)([;}])/g,
    (match, property: string, value: string, terminator: string) =>
      UNITLESS_CSS_PROPERTIES.has(property) || value === '0'
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
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ResolvedPackage['manifest'];
    return { manifest, packageDir: dirname(manifestPath) };
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
  const exportsMap = resolved.manifest.exports;
  if (!exportsMap || typeof exportsMap !== 'object') return [];

  const files = new Set<string>();
  for (const target of Object.values(exportsMap)) {
    const targetPath = exportTargetPath(target);
    if (!targetPath || !targetPath.endsWith('.tsx')) continue;
    const absolute = resolve(resolved.packageDir, targetPath);
    if (existsSync(absolute)) files.add(absolute);
  }
  return [...files].sort((left, right) => left.localeCompare(right));
}

function appComponentSourceFiles(rootDir: string): string[] {
  const files: string[] = [];
  collectAppComponentSourceFiles(rootDir, files);
  return files.sort((left, right) => left.localeCompare(right));
}

function collectAppComponentSourceFiles(dir: string, files: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const absolute = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (ignoredAppSourceDirectory(entry.name)) continue;
      collectAppComponentSourceFiles(absolute, files);
      continue;
    }
    if (!entry.isFile() || !appSourceExtension(absolute)) continue;
    files.push(absolute);
  }
}

function ignoredAppSourceDirectory(name: string): boolean {
  return name === 'generated' || name === 'node_modules' || name === 'dist' || name.startsWith('.');
}

function appSourceExtension(fileName: string): boolean {
  return ['.js', '.jsx', '.ts', '.tsx'].includes(extname(fileName));
}

function replaceSourceExtension(fileName: string, extension: string): string {
  const currentExtension = extname(fileName);
  return currentExtension
    ? `${fileName.slice(0, -currentExtension.length)}${extension}`
    : `${fileName}${extension}`;
}

function exportTargetPath(target: unknown): string | null {
  if (typeof target === 'string') return target;
  // Conditional exports object ({ import, default, ... }): take the first string.
  if (target && typeof target === 'object') {
    for (const value of Object.values(target as Record<string, unknown>)) {
      const nested = exportTargetPath(value);
      if (nested) return nested;
    }
  }
  return null;
}

function relativeToRoot(rootDir: string, fileName: string): string {
  return fileName.startsWith(rootDir) ? fileName.slice(rootDir.length + 1) : fileName;
}
