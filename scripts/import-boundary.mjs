import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import {
  GENERATED_ARTIFACT_CATEGORIES,
  generatedArtifactCategoriesForPath,
  isGeneratedArtifactPathInCategory,
} from './generated-artifacts.mjs';

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
  // Framework-owned gallery L1 adapter keeps demo components off direct primitive reducer imports
  // while exercising the same internal reducer ABI the generated handler tier composes with.
  'examples/gallery/src/primitive-actions.ts -> @kovojs/headless-ui/internal/primitive',
]);
const explicitlyAllowedGeneratedImports = new Set([
  // Framework-owned gallery L1 adapter; ordinary app-authored source remains blocked from
  // generated ABI imports by the default zero-exception rule.
  'examples/gallery/src/primitive-actions.ts -> @kovojs/headless-ui/generated',
]);

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

    for (const specifier of new Set(importSpecifiers(source, { fileName: relativePath }))) {
      const tier = importBoundaryTier(specifier, relativePath);
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

export function appLocalGeneratedImportTier(specifier, importerPath = null) {
  const resolvedPath = appLocalGeneratedImportPath(specifier, importerPath);
  if (!resolvedPath) return null;
  return isGeneratedArtifactPathInCategory(
    resolvedPath,
    GENERATED_ARTIFACT_CATEGORIES.appLocalGeneratedOutput,
  )
    ? 'app-local-generated'
    : null;
}

function importBoundaryTier(specifier, importerPath) {
  return nonPublicKovoImportTier(specifier) ?? appLocalGeneratedImportTier(specifier, importerPath);
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

export function importSpecifiers(source, { fileName = 'source.ts' } = {}) {
  if (path.extname(fileName) === '.md') return markdownImportSpecifiers(source);
  return sourceImportSpecifiers(source, fileName);
}

function sourceImportSpecifiers(source, fileName) {
  const specifiers = [];
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForFileName(fileName),
  );

  const pushStringLiteral = (node) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text);
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      pushStringLiteral(node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument)) pushStringLiteral(argument.literal);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      pushStringLiteral(node.arguments[0]);
    } else if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference;
      if (ts.isExternalModuleReference(reference)) pushStringLiteral(reference.expression);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
}

function markdownImportSpecifiers(source) {
  const specifiers = [];
  const fence = /^```([^\n`]*)\n([\s\S]*?)^```/gm;
  for (const match of source.matchAll(fence)) {
    const info = (match[1] ?? '').trim().split(/\s+/)[0] ?? '';
    const extension = markdownFenceExtension(info);
    if (extension === null) continue;
    specifiers.push(...sourceImportSpecifiers(match[2] ?? '', `fence.${extension}`));
  }
  return specifiers;
}

function markdownFenceExtension(info) {
  const normalized = info.toLowerCase();
  if (['js', 'javascript', 'mjs', 'cjs'].includes(normalized)) return 'js';
  if (['jsx'].includes(normalized)) return 'jsx';
  if (['ts', 'typescript', 'mts', 'cts'].includes(normalized)) return 'ts';
  if (['tsx'].includes(normalized)) return 'tsx';
  return null;
}

function scriptKindForFileName(fileName) {
  if (/\.[cm]?tsx$/.test(fileName)) return ts.ScriptKind.TSX;
  if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?ts$/.test(fileName)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
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
  const categories = generatedArtifactCategoriesForPath(relativePath);
  if (
    categories.includes(GENERATED_ARTIFACT_CATEGORIES.appLocalGeneratedOutput) ||
    categories.includes(GENERATED_ARTIFACT_CATEGORIES.frameworkGeneratedSource) ||
    categories.includes(GENERATED_ARTIFACT_CATEGORIES.generatedPackageMetadata)
  ) {
    return true;
  }
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

function appLocalGeneratedImportPath(specifier, importerPath) {
  if (!importerPath || !specifier.startsWith('.')) return null;
  return slash(path.posix.normalize(path.posix.join(path.posix.dirname(importerPath), specifier)));
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
