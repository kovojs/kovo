import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { packageComponentPrefixFactFromPackageManifest } from '@kovojs/core/internal/package-prefix';

import type { ComponentModuleModel } from './scan/parse.js';
import type { PackageComponentPrefixFact } from './types.js';

export interface PackageComponentPrefixDiscoveryOptions {
  fileName: string;
  packagePrefixDiscoveryRoot?: string;
  source: string;
}

export function packageComponentPrefixesForModule(
  options: PackageComponentPrefixDiscoveryOptions,
  model: ComponentModuleModel,
): PackageComponentPrefixFact[] {
  // SPEC §6.1.1 makes package.json kovo.prefix the source of package wire names.
  return staticImportPackageNames(model).flatMap((packageName) => {
    const manifest = readPackageManifest(packageName, options);
    const fact = packageComponentPrefixFactFromPackageManifest(manifest);
    return fact ? [fact] : [];
  });
}

export function mergePackageComponentPrefixFacts(
  discoveredFacts: readonly PackageComponentPrefixFact[],
  explicitFacts: readonly PackageComponentPrefixFact[] | undefined,
): PackageComponentPrefixFact[] {
  const facts = new Map<string, PackageComponentPrefixFact>();

  for (const fact of discoveredFacts) facts.set(fact.packageName, fact);
  for (const fact of explicitFacts ?? []) {
    const discovered = facts.get(fact.packageName);
    facts.set(fact.packageName, { ...discovered, ...fact });
  }

  return [...facts.values()].sort((left, right) =>
    left.packageName.localeCompare(right.packageName),
  );
}

/**
 * Resolve an installed package's `package.json` path from the importing module,
 * walking up `node_modules` like {@link packageComponentPrefixesForModule} does.
 * Exported so the package-style extraction pass (`package-styles.ts`) can locate
 * a `kovo.prefix` component package's source `.tsx` files (SPEC §6.1.1, §13.1).
 */
export function resolvePackageManifestPath(
  packageName: string,
  options: PackageComponentPrefixDiscoveryOptions,
): string | null {
  return findPackageManifestPath(packageName, options);
}

function readPackageManifest(
  packageName: string,
  options: PackageComponentPrefixDiscoveryOptions,
): unknown {
  const manifestPath = findPackageManifestPath(packageName, options);
  if (!manifestPath) return null;

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function findPackageManifestPath(
  packageName: string,
  options: PackageComponentPrefixDiscoveryOptions,
): string | null {
  const start = moduleContainingDirectory(options.fileName, options.packagePrefixDiscoveryRoot);
  for (let dir = start; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', ...packageName.split('/'), 'package.json');
    if (existsSync(candidate)) return candidate;

    const parent = dirname(dir);
    if (parent === dir) return null;
  }
}

function moduleContainingDirectory(fileName: string, root: string | undefined): string {
  const absoluteFileName = isAbsolute(fileName)
    ? fileName
    : resolve(root ?? process.cwd(), fileName);
  return dirname(absoluteFileName);
}

function staticImportPackageNames(model: ComponentModuleModel): string[] {
  const packageNames = new Set<string>();
  for (const { specifier } of model.moduleSpecifiers) {
    const packageName = packageNameFromSpecifier(specifier);
    if (packageName) packageNames.add(packageName);
  }
  return [...packageNames].sort((left, right) => left.localeCompare(right));
}

function packageNameFromSpecifier(specifier: string): string | null {
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('#') ||
    /^[a-z][a-z0-9+.-]*:/.test(specifier)
  ) {
    return null;
  }

  const [first, second] = specifier.split('/');
  if (!first) return null;
  if (first.startsWith('@')) return second ? `${first}/${second}` : null;
  return first;
}
