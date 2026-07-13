import {
  dirname as builtinPathDirname,
  isAbsolute as builtinPathIsAbsolute,
  join as builtinPathJoin,
  resolve as builtinPathResolve,
} from 'node:path';

import { packageComponentPrefixFactFromPackageManifest } from '@kovojs/core/internal/package-prefix';

import {
  compilerArrayAppend,
  compilerCreateMap,
  compilerCreateSet,
  compilerFailClosed,
  compilerJsonParse,
  compilerMapForEach,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerRegExpTest,
  compilerSetAdd,
  compilerSetForEach,
  compilerSnapshotDenseArray,
  compilerStringIncludes,
  compilerStringIndexOf,
  compilerStringLocaleCompare,
  compilerStringSlice,
  compilerStringSplit,
  compilerStringStartsWith,
} from './compiler-security-intrinsics.js';
import type { ComponentModuleModel } from './scan/parse.js';
import { createCompilerSourceFileSystem } from './source-filesystem.js';
import type { PackageComponentPrefixFact } from './types.js';

const nativePathDirname = builtinPathDirname;
const nativePathIsAbsolute = builtinPathIsAbsolute;
const nativePathJoin = builtinPathJoin;
const nativePathResolve = builtinPathResolve;
const packagePrefixBootCwd = process.cwd();

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
  const packageNames = compilerSnapshotDenseArray(
    staticImportPackageNames(model),
    'Compiler static import package names',
  );
  const facts: PackageComponentPrefixFact[] = [];
  for (let index = 0; index < packageNames.length; index += 1) {
    const packageName = packageNames[index]!;
    const manifest = readPackageManifest(packageName, options);
    const fact = packageComponentPrefixFactFromPackageManifest(manifest);
    if (fact) {
      compilerArrayAppend(facts, fact, 'Compiler package component prefix facts');
    }
  }
  return facts;
}

export function mergePackageComponentPrefixFacts(
  discoveredFacts: readonly PackageComponentPrefixFact[],
  explicitFacts: readonly PackageComponentPrefixFact[] | undefined,
): PackageComponentPrefixFact[] {
  const facts = compilerCreateMap<string, PackageComponentPrefixFact>();

  const discoveredSnapshot = compilerSnapshotDenseArray(
    discoveredFacts,
    'Compiler discovered package component prefix facts',
  );
  for (let index = 0; index < discoveredSnapshot.length; index += 1) {
    const fact = discoveredSnapshot[index]!;
    compilerMapSet(facts, packageFactName(fact), fact);
  }
  const explicitSnapshot = compilerSnapshotDenseArray(
    explicitFacts ?? [],
    'Compiler explicit package component prefix facts',
  );
  for (let index = 0; index < explicitSnapshot.length; index += 1) {
    const fact = explicitSnapshot[index]!;
    const packageName = packageFactName(fact);
    const discovered = compilerMapGet(facts, packageName);
    compilerMapSet(facts, packageName, { ...discovered, ...fact });
  }

  const output: PackageComponentPrefixFact[] = [];
  compilerMapForEach(facts, (fact) => {
    compilerArrayAppend(output, fact, 'Compiler merged package component prefix facts');
  });
  for (let index = 1; index < output.length; index += 1) {
    const fact = output[index]!;
    let insertion = index;
    while (
      insertion > 0 &&
      compilerStringLocaleCompare(packageFactName(output[insertion - 1]!), packageFactName(fact)) >
        0
    ) {
      output[insertion] = output[insertion - 1]!;
      insertion -= 1;
    }
    output[insertion] = fact;
  }
  return output;
}

function packageFactName(fact: PackageComponentPrefixFact): string {
  const packageName = compilerOwnDataValue(
    fact,
    'packageName',
    'Compiler package component prefix fact',
  );
  if (typeof packageName !== 'string') {
    return compilerFailClosed('Compiler package component prefix fact requires a package name.');
  }
  return packageName;
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
    const fileSystem = createCompilerSourceFileSystem(nativePathDirname(manifestPath));
    const source = fileSystem?.readFile(manifestPath);
    return source === null || source === undefined ? null : compilerJsonParse(source);
  } catch {
    return null;
  }
}

function findPackageManifestPath(
  packageName: string,
  options: PackageComponentPrefixDiscoveryOptions,
): string | null {
  const packageNameParts = safePackageNameParts(packageName);
  if (packageNameParts === null) return null;
  const start = moduleContainingDirectory(options.fileName, options.packagePrefixDiscoveryRoot);
  for (let dir = start; ; dir = nativePathDirname(dir)) {
    let packageDir = nativePathJoin(dir, 'node_modules');
    for (let index = 0; index < packageNameParts.length; index += 1) {
      packageDir = nativePathJoin(packageDir, packageNameParts[index]!);
    }
    const candidate = nativePathJoin(packageDir, 'package.json');
    if (createCompilerSourceFileSystem(packageDir)?.kind(candidate) === 'file') return candidate;

    const parent = nativePathDirname(dir);
    if (parent === dir) return null;
  }
}

function moduleContainingDirectory(fileName: string, root: string | undefined): string {
  const absoluteFileName = nativePathIsAbsolute(fileName)
    ? fileName
    : nativePathResolve(root ?? packagePrefixBootCwd, fileName);
  return nativePathDirname(absoluteFileName);
}

function staticImportPackageNames(model: ComponentModuleModel): string[] {
  const packageNames = compilerCreateSet<string>();
  const moduleSpecifiers = compilerSnapshotDenseArray(
    model.moduleSpecifiers,
    'Compiler package-prefix module specifiers',
  );
  for (let index = 0; index < moduleSpecifiers.length; index += 1) {
    const specifier = compilerOwnDataValue(
      moduleSpecifiers[index]!,
      'specifier',
      'Compiler package-prefix module specifier',
    );
    if (typeof specifier !== 'string') continue;
    const packageName = packageNameFromSpecifier(specifier);
    if (packageName) compilerSetAdd(packageNames, packageName);
  }
  const names: string[] = [];
  compilerSetForEach(packageNames, (packageName) => {
    compilerArrayAppend(names, packageName, 'Compiler static import package names');
  });
  for (let index = 1; index < names.length; index += 1) {
    const packageName = names[index]!;
    let insertion = index;
    while (insertion > 0 && compilerStringLocaleCompare(names[insertion - 1]!, packageName) > 0) {
      names[insertion] = names[insertion - 1]!;
      insertion -= 1;
    }
    names[insertion] = packageName;
  }
  return names;
}

function packageNameFromSpecifier(specifier: string): string | null {
  if (
    compilerStringStartsWith(specifier, '.') ||
    compilerStringStartsWith(specifier, '/') ||
    compilerStringStartsWith(specifier, '#') ||
    compilerRegExpTest(/^[a-z][a-z0-9+.-]*:/, specifier)
  ) {
    return null;
  }

  const parts = safePackageNamePartsFromSpecifier(specifier);
  if (parts === null) return null;
  const first = parts[0];
  const second = parts[1];
  if (!first) return null;
  if (compilerStringStartsWith(first, '@')) return second ? `${first}/${second}` : null;
  return first;
}

function safePackageNamePartsFromSpecifier(specifier: string): string[] | null {
  const slash = compilerStringIndexOf(specifier, '/');
  if (!compilerStringStartsWith(specifier, '@')) {
    return safePackageNameParts(slash < 0 ? specifier : compilerStringSlice(specifier, 0, slash));
  }
  if (slash < 0) return null;
  const secondSlash = compilerStringIndexOf(specifier, '/', slash + 1);
  return safePackageNameParts(
    secondSlash < 0 ? specifier : compilerStringSlice(specifier, 0, secondSlash),
  );
}

function safePackageNameParts(packageName: string): string[] | null {
  if (
    packageName.length === 0 ||
    compilerStringIncludes(packageName, '\0') ||
    compilerStringIncludes(packageName, '\\') ||
    nativePathIsAbsolute(packageName)
  ) {
    return null;
  }
  const parts = compilerStringSplit(packageName, '/');
  if (
    parts.length < 1 ||
    parts.length > 2 ||
    (parts.length === 2 && !compilerStringStartsWith(parts[0] ?? '', '@')) ||
    (parts.length === 1 && compilerStringStartsWith(parts[0] ?? '', '@'))
  ) {
    return null;
  }
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part || part === '.' || part === '..' || nativePathIsAbsolute(part)) return null;
  }
  return parts;
}
