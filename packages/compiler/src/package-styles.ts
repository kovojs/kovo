import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { dedupeCss } from './css.js';
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

export interface PackageComponentCssDiagnostic {
  /** Package-relative source file whose `style.create(...)` produced no CSS. */
  readonly fileName: string;
  readonly message: string;
}

export interface PackageComponentCssResult {
  /** Deduped CSS across every styled component file in the package. */
  readonly css: string | null;
  /**
   * Files that import `@kovojs/style` and call `style.create(...)` but yielded
   * no extracted CSS — the conservative extractor bailed (spreads, computed
   * keys, non-static values). These would render silently unstyled (A5 gate).
   */
  readonly diagnostics: readonly PackageComponentCssDiagnostic[];
  /** Absolute `.tsx` entry files that were scanned, in stable order. */
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
 */
export function extractPackageComponentCss(
  packageName: string,
  options: PackageComponentPrefixDiscoveryOptions,
): PackageComponentCssResult {
  const resolved = resolvePackage(packageName, options);
  if (!resolved) {
    return { css: null, diagnostics: [], sourceFiles: [] };
  }

  const sourceFiles = packageComponentSourceFiles(resolved);
  const chunks: string[] = [];
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
    const extraction = extractKovoStyles(fileName, source, model);
    if (extraction.css) {
      chunks.push(extraction.css);
    } else {
      diagnostics.push({
        fileName: relativeToPackage(resolved.packageDir, fileName),
        message:
          'style.create(...) present but no CSS was extracted; the component would render ' +
          'unstyled. Ensure styles are static and pin explicit { namespace, source }.',
      });
    }
  }

  if (chunks.length === 0) {
    return { css: null, diagnostics, sourceFiles };
  }

  return {
    css: `${cssIrHeader}\n${dedupeCss(chunks)}`,
    diagnostics,
    sourceFiles,
  };
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

function relativeToPackage(packageDir: string, fileName: string): string {
  return fileName.startsWith(packageDir) ? fileName.slice(packageDir.length + 1) : fileName;
}
