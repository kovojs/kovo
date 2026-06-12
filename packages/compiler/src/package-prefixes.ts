import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { packageComponentPrefixFactFromPackageManifest } from '@jiso/core';
import ts from 'typescript';

import type { PackageComponentPrefixFact } from './types.js';

export interface PackageComponentPrefixDiscoveryOptions {
  fileName: string;
  packagePrefixDiscoveryRoot?: string;
  source: string;
}

export function packageComponentPrefixesForModule(
  options: PackageComponentPrefixDiscoveryOptions,
): PackageComponentPrefixFact[] {
  // SPEC §6.1.1 makes package.json jiso.prefix the source of package wire names.
  return staticImportPackageNames(options.fileName, options.source).flatMap((packageName) => {
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

function staticImportPackageNames(fileName: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const packageNames = new Set<string>();

  const visit = (node: ts.Node): void => {
    const specifier = moduleSpecifierText(node);
    const packageName = specifier ? packageNameFromSpecifier(specifier) : null;
    if (packageName) packageNames.add(packageName);

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return [...packageNames].sort((left, right) => left.localeCompare(right));
}

function moduleSpecifierText(node: ts.Node): string | null {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier &&
    ts.isStringLiteralLike(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text;
  }

  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const [argument] = node.arguments;
    if (argument && ts.isStringLiteralLike(argument)) return argument.text;
  }

  return null;
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
