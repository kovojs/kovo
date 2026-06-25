import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appFacingRoots = [
  'examples',
  'packages/create-kovo/templates',
  'site/content',
  'site/scripts',
  'site/src',
  'site/tutorial',
];

const checkedExtensions = new Set(['.js', '.jsx', '.mjs', '.md', '.ts', '.tsx']);

const explicitlyAllowedInternalImports = new Set([
  // Framework-owned static docs export emits kovo-rules.md from the same internal
  // source used by create-kovo and `kovo update-docs`; app-authored site/content
  // remains covered by the zero-exception default.
  'site/src/aux.ts -> @kovojs/core/internal/agent-docs',
]);
const explicitlyAllowedGeneratedImports = new Set([]);

export async function collectImportBoundaryViolations({
  generatedExceptions = explicitlyAllowedGeneratedImports,
  internalExceptions = explicitlyAllowedInternalImports,
  rootDir = repoRootFromScript(),
  checkStaleExceptions = path.resolve(rootDir) === repoRootFromScript(),
  roots = appFacingRoots,
} = {}) {
  const files = [];
  for (const root of roots) {
    const absoluteRoot = path.join(rootDir, root);
    if (existsSync(absoluteRoot)) files.push(...(await collectFiles(absoluteRoot)));
  }

  const violations = [];
  const matchedExceptions = new Set();
  for (const filePath of files) {
    const relativePath = slash(path.relative(rootDir, filePath));
    if (!shouldCheckFile(relativePath)) continue;

    const source = await readFile(filePath, 'utf8');
    if (isGeneratedArtifact(relativePath, source)) continue;

    for (const specifier of new Set(importSpecifiers(source))) {
      const tier = importBoundaryTier(specifier);
      if (tier === null) continue;
      if (tier === 'internal' && isTestFile(relativePath)) continue;
      const allowKey = `${relativePath} -> ${specifier}`;
      const allowed = allowedImportBoundaryException(tier, allowKey, {
        generatedExceptions,
        internalExceptions,
      });
      if (allowed) matchedExceptions.add(allowKey);
      if (!allowed) {
        violations.push({
          fileName: relativePath,
          specifier,
          tier,
        });
      }
    }
  }

  if (checkStaleExceptions) {
    for (const exception of explicitImportBoundaryExceptions({
      generatedExceptions,
      internalExceptions,
    })) {
      if (matchedExceptions.has(exception.allowKey)) continue;
      violations.push({
        fileName: exception.fileName,
        specifier: exception.specifier,
        staleException: true,
        tier: exception.tier,
      });
    }
  }

  return violations.sort(
    (left, right) =>
      left.fileName.localeCompare(right.fileName) ||
      left.specifier.localeCompare(right.specifier) ||
      left.tier.localeCompare(right.tier),
  );
}

export function nonPublicKovoImportTier(specifier) {
  if (specifier.startsWith('@kovojs/compiler/')) return 'internal';
  if (/^@kovojs\/[^/]+\/internal(?:\/|$)/.test(specifier)) return 'internal';
  if (/^@kovojs\/[^/]+\/generated(?:\/|$)/.test(specifier)) return 'generated';
  return null;
}

export function appLocalGeneratedImportTier(specifier) {
  return /^\.{1,2}\/(?:.*\/)?generated\//.test(specifier) ? 'app-local-generated' : null;
}

function importBoundaryTier(specifier) {
  return nonPublicKovoImportTier(specifier) ?? appLocalGeneratedImportTier(specifier);
}

function allowedImportBoundaryException(
  tier,
  allowKey,
  { generatedExceptions, internalExceptions },
) {
  if (tier === 'internal') return internalExceptions.has(allowKey);
  if (tier === 'generated') return generatedExceptions.has(allowKey);
  if (tier === 'app-local-generated') return false;
  return false;
}

function explicitImportBoundaryExceptions({ generatedExceptions, internalExceptions }) {
  return [
    ...[...internalExceptions].map((allowKey) =>
      explicitImportBoundaryException('internal', allowKey),
    ),
    ...[...generatedExceptions].map((allowKey) =>
      explicitImportBoundaryException('generated', allowKey),
    ),
  ];
}

function explicitImportBoundaryException(tier, allowKey) {
  const separator = ' -> ';
  const separatorIndex = allowKey.indexOf(separator);
  return {
    allowKey,
    fileName: separatorIndex === -1 ? allowKey : allowKey.slice(0, separatorIndex),
    specifier: separatorIndex === -1 ? '' : allowKey.slice(separatorIndex + separator.length),
    tier,
  };
}

export function importSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?[^'"()]*?\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function shouldCheckFile(relativePath) {
  if (relativePath.includes('/node_modules/')) return false;
  if (relativePath.includes('/dist/')) return false;

  return checkedExtensions.has(path.extname(relativePath));
}

function isTestFile(relativePath) {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relativePath);
}

function isGeneratedArtifact(relativePath, source) {
  if (relativePath.includes('/generated/')) return true;
  return (
    source.startsWith('// @kovojs-ir') ||
    source.startsWith('/* @kovojs-ir */') ||
    source.includes('DO NOT EDIT') ||
    source.includes('generated by @kovojs')
  );
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      files.push(...(await collectFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function repoRootFromScript() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function slash(value) {
  return value.split(path.sep).join('/');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = await collectImportBoundaryViolations();
  if (violations.length > 0) {
    console.error('import-boundary: app-facing code imports non-public Kovo subpaths:');
    for (const violation of violations) {
      const reason = violation.staleException
        ? `stale ${violation.tier} exception`
        : violation.tier;
      console.error(`- ${violation.fileName}: ${violation.specifier} (${reason})`);
    }
    process.exitCode = 1;
  }
}
