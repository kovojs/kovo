import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

export const productionSourceRoots = [
  'packages/core/src',
  'packages/drizzle/src',
  'packages/server/src',
  'packages/cli/src',
];

export const securityMarkersModule = '@kovojs/core/internal/security-markers';
const workspacePackageRoot = 'packages';
const defaultIgnoredSecurityMarkerPackages = new Set(['conformance-fixtures']);
const productionSourcePattern = /\.[cm]?tsx?$/u;
const productionTestPattern = /\.(?:test|spec)\.[cm]?tsx?$/u;

export function isProductionSourceFile(filePath, options = {}) {
  const relativePath = slash(filePath);
  const roots = options.roots ?? productionSourceRoots;
  if (!productionSourcePattern.test(relativePath)) return false;
  if (relativePath.endsWith('.d.ts')) return false;
  if (productionTestPattern.test(relativePath)) return false;
  return roots.some((root) => relativePath.startsWith(`${slash(root).replace(/\/$/u, '')}/`));
}

export function collectSourceFiles(root, roots, options = {}) {
  return collectFiles(root, roots, {
    ...options,
    includeFile:
      options.includeFile ??
      (({ relativePath }) =>
        isProductionSourceFile(relativePath, { roots: options.productionRoots ?? roots })),
  });
}

export function securityMarkerSourceRoots(root, options = {}) {
  const packageRoot = options.packageRoot ?? workspacePackageRoot;
  const ignoredPackages = options.ignoredPackages ?? defaultIgnoredSecurityMarkerPackages;
  const roots = new Set(options.baseRoots ?? productionSourceRoots);
  const sourceRoots = workspacePackageSourceRoots(root, packageRoot, ignoredPackages);
  for (const sourceRoot of sourceRoots) {
    const files = collectSourceFiles(root, [sourceRoot], { productionRoots: [sourceRoot] });
    if (files.some((file) => sourceFileImportsSecurityMarkers(root, file))) {
      roots.add(sourceRoot);
    }
  }
  return sortFiles([...roots]);
}

export async function collectSourceFilesAsync(root, roots, options = {}) {
  return collectFilesAsync(root, roots, {
    ...options,
    includeFile:
      options.includeFile ??
      (({ relativePath }) =>
        isProductionSourceFile(relativePath, { roots: options.productionRoots ?? roots })),
  });
}

function workspacePackageSourceRoots(root, packageRoot, ignoredPackages) {
  const absolutePackageRoot = path.resolve(root, packageRoot);
  let entries;
  try {
    entries = readdirSync(absolutePackageRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const roots = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (ignoredPackages.has(entry.name)) continue;
    const sourceRoot = slash(path.join(packageRoot, entry.name, 'src'));
    if (existsSync(path.resolve(root, sourceRoot))) roots.push(sourceRoot);
  }
  return sortFiles(roots);
}

function sourceFileImportsSecurityMarkers(root, relativePath) {
  const text = readFileSync(path.resolve(root, relativePath), 'utf8');
  return (
    text.includes(`from '${securityMarkersModule}'`) ||
    text.includes(`from "${securityMarkersModule}"`)
  );
}

export function collectFiles(root, roots, options = {}) {
  const rootDir = path.resolve(root);
  const files = [];
  for (const sourceRoot of roots) {
    const absoluteRoot = path.resolve(rootDir, sourceRoot);
    if (!existsSync(absoluteRoot)) continue;
    collectFilesInto(rootDir, absoluteRoot, files, options);
  }
  return sortFiles(files);
}

export async function collectFilesAsync(root, roots, options = {}) {
  const rootDir = path.resolve(root);
  const files = [];
  for (const sourceRoot of roots) {
    const absoluteRoot = path.resolve(rootDir, sourceRoot);
    await collectFilesIntoAsync(rootDir, absoluteRoot, files, options);
  }
  return sortFiles(files);
}

function collectFilesInto(rootDir, absoluteDir, files, options) {
  let entries;
  try {
    entries = readdirSync(absoluteDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    const absolutePath = path.join(absoluteDir, entry.name);
    const relativePath = slash(path.relative(rootDir, absolutePath));
    if (entry.isDirectory()) {
      if (!shouldSkipDirectory(entry, relativePath, options)) {
        collectFilesInto(rootDir, absolutePath, files, options);
      }
      continue;
    }
    if (!entry.isFile()) continue;
    pushIfIncluded(files, { absolutePath, relativePath }, options);
  }
}

async function collectFilesIntoAsync(rootDir, absoluteDir, files, options) {
  let entries;
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    const absolutePath = path.join(absoluteDir, entry.name);
    const relativePath = slash(path.relative(rootDir, absolutePath));
    if (entry.isDirectory()) {
      if (!shouldSkipDirectory(entry, relativePath, options)) {
        await collectFilesIntoAsync(rootDir, absolutePath, files, options);
      }
      continue;
    }
    if (!entry.isFile()) continue;
    pushIfIncluded(files, { absolutePath, relativePath }, options);
  }
}

function shouldSkipDirectory(entry, relativePath, options) {
  return (
    options.skipDirectory?.({
      name: entry.name,
      relativePath,
    }) === true
  );
}

function pushIfIncluded(files, file, options) {
  if (options.includeFile?.(file) === false) return;
  files.push(options.absolute === true ? file.absolutePath : file.relativePath);
}

function sortFiles(files) {
  return files.sort((left, right) => left.localeCompare(right));
}

function slash(value) {
  return value.split(path.sep).join('/');
}
