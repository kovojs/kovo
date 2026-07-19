#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { collectFiles } from './lib/source-files.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const repoRoot = findRepoRoot();
export const cryptoAcquisitionLedgerFile = 'security/crypto-acquisition-doors.json';

const sourceRoots = ['examples', 'packages', 'scripts', 'site/src'];
const sourcePattern = /\.(?:[cm]?[jt]sx?)$/u;
const testPattern = /(?:^|\/)(?:__tests__|test-support|testing-fixtures)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/u;
const excludedFiles = new Set([
  // Despite its production-looking suffix this is a generated-runtime adversarial test harness.
  'packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime-gate.ts',
]);
const excludedPathFragments = [
  '/conformance-fixtures/',
  '/test/src/integration/',
];
const digestOperations = new Set(['createHash', 'hash']);
const cryptoSpecifiers = new Set(['crypto', 'node:crypto', '@node-rs/argon2']);

export function checkCryptoBoundary(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.resolve(root, relativePath), 'utf8'));
  const sourceFiles =
    options.sourceFiles ??
    collectFiles(root, sourceRoots, {
      includeFile: ({ relativePath }) =>
        sourcePattern.test(relativePath) &&
        !relativePath.endsWith('.d.ts') &&
        !testPattern.test(relativePath) &&
        !relativePath.includes('/dist/') &&
        !relativePath.includes('/node_modules/') &&
        !relativePath.includes('.security-fixture.') &&
        !relativePath.includes('.test-support.') &&
        !excludedPathFragments.some((fragment) => relativePath.includes(fragment)) &&
        !excludedFiles.has(relativePath),
      skipDirectory: ({ name }) =>
        name === '.git' || name === 'dist' || name === 'node_modules' || name === 'coverage',
    });
  const ledger =
    options.entries === undefined
      ? JSON.parse(readText(cryptoAcquisitionLedgerFile))
      : {
          entries: options.entries,
          maximumCryptoAcquisitionFiles: options.maximumCryptoAcquisitionFiles ?? 0,
        };
  const entries = Array.isArray(ledger.entries) ? ledger.entries : [];
  const maximumCryptoAcquisitionFiles =
    options.maximumCryptoAcquisitionFiles ?? ledger.maximumCryptoAcquisitionFiles;
  const findings = [];
  if (!Number.isInteger(maximumCryptoAcquisitionFiles) || maximumCryptoAcquisitionFiles < 0) {
    findings.push(`${cryptoAcquisitionLedgerFile}: maximumCryptoAcquisitionFiles must be a non-negative integer`);
  }

  const discovered = [];
  for (const file of sourceFiles) {
    const row = discoverCryptoAcquisition(file, readText(file));
    if (row !== undefined) discovered.push(row);
  }
  discovered.sort(compareRows);

  const reviewedByFile = new Map();
  for (const entry of entries) {
    if (!isLedgerEntry(entry)) {
      findings.push(`${cryptoAcquisitionLedgerFile}: malformed crypto acquisition row`);
      continue;
    }
    if (reviewedByFile.has(entry.file)) {
      findings.push(`${cryptoAcquisitionLedgerFile}: duplicate crypto acquisition row ${entry.file}`);
      continue;
    }
    reviewedByFile.set(entry.file, entry);
  }

  const actualByFile = new Map(discovered.map((row) => [row.file, row]));
  for (const row of discovered) {
    const reviewed = reviewedByFile.get(row.file);
    if (reviewed === undefined) {
      findings.push(`${row.file}: unreviewed ${row.kind} (${row.operations.join(', ')})`);
      continue;
    }
    if (reviewed.kind === 'digest' && row.kind === 'crypto-acquisition') {
      findings.push(
        `${row.file}: reviewed digest row widened to crypto-acquisition (${row.operations.join(', ')})`,
      );
      continue;
    }
    if (reviewed.kind !== row.kind) {
      findings.push(`${row.file}: crypto acquisition class is ${row.kind}, reviewed ${reviewed.kind}`);
    }
    if (!sameStrings(reviewed.operations, row.operations)) {
      findings.push(
        `${row.file}: crypto operation set is [${row.operations.join(', ')}], reviewed [${reviewed.operations.join(', ')}]`,
      );
    }
  }
  for (const entry of reviewedByFile.values()) {
    if (!actualByFile.has(entry.file)) {
      findings.push(`${entry.file}: stale ratchet row must be removed after routing through the authority`);
    }
  }

  const highCount = discovered.filter((row) => row.kind === 'crypto-acquisition').length;
  if (
    Number.isInteger(maximumCryptoAcquisitionFiles) &&
    highCount > maximumCryptoAcquisitionFiles
  ) {
    findings.push(
      `${cryptoAcquisitionLedgerFile}: crypto-acquisition file count ${highCount} exceeds non-increasing ceiling ${maximumCryptoAcquisitionFiles}`,
    );
  }

  return {
    discovered,
    findings: findings.sort((left, right) => left.localeCompare(right)),
    ok: findings.length === 0,
    summary:
      findings.length === 0
        ? `OK crypto acquisition rows=${discovered.length} high=${highCount}`
        : `${findings.length} crypto boundary violation(s)`,
  };
}

export function discoverCryptoAcquisition(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const operations = new Set();
  let highAuthority = false;

  const recordImport = (specifier, names) => {
    if (!cryptoSpecifiers.has(specifier)) return;
    if (specifier === '@node-rs/argon2') highAuthority = true;
    for (const name of names) {
      operations.add(name);
      if (!digestOperations.has(name) || specifier === '@node-rs/argon2') highAuthority = true;
    }
  };

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      if (statement.importClause?.isTypeOnly) continue;
      const names = runtimeImportNames(statement.importClause);
      if (names.length > 0) recordImport(statement.moduleSpecifier.text, names);
      continue;
    }
    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const names = runtimeExportNames(statement.exportClause);
      recordImport(statement.moduleSpecifier.text, names);
    }
  }

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteralLike(argument)) recordImport(argument.text, ['*']);
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteralLike(argument)) recordImport(argument.text, ['*']);
      }
    }
    if (isOutermostAccess(node)) {
      const parts = accessParts(node);
      const cryptoIndex = parts.indexOf('crypto');
      if (cryptoIndex >= 0) {
        const suffix = parts.slice(cryptoIndex + 1);
        operations.add(suffix.length === 0 ? '*' : suffix.join('.'));
        highAuthority = true;
      }
    } else if (
      ts.isIdentifier(node) &&
      (node.text === 'Crypto' || node.text === 'SubtleCrypto') &&
      identifierIsRuntimeReference(node)
    ) {
      operations.add(node.text);
      highAuthority = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  // Generated inline-loader source is an executable projection held in a template string. Keep it
  // in the same exact-path ratchet even though TypeScript correctly parses the projection as data.
  if (file === 'packages/browser/src/inline-loader.ts' && /\bscope\.crypto\b/u.test(source)) {
    operations.add('generated:scope.crypto');
    highAuthority = true;
  }

  if (operations.size === 0) return undefined;
  const sortedOperations = [...operations].sort((left, right) => left.localeCompare(right));
  return {
    file,
    kind:
      highAuthority || sortedOperations.some((operation) => !digestOperations.has(operation))
        ? 'crypto-acquisition'
        : 'digest',
    operations: sortedOperations,
  };
}

function runtimeImportNames(clause) {
  if (clause === undefined) return ['<module>'];
  const names = [];
  if (clause.name) names.push('default');
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) names.push('*');
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    for (const element of clause.namedBindings.elements) {
      if (!element.isTypeOnly) names.push(element.propertyName?.text ?? element.name.text);
    }
  }
  return names;
}

function runtimeExportNames(clause) {
  if (clause === undefined || ts.isNamespaceExport(clause)) return ['*'];
  const names = [];
  for (const element of clause.elements) {
    if (!element.isTypeOnly) names.push(element.propertyName?.text ?? element.name.text);
  }
  return names.length === 0 ? ['<module>'] : names;
}

function isOutermostAccess(node) {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
  const parent = node.parent;
  return !(
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === node
  );
}

function accessParts(expression) {
  const parts = [];
  let current = expression;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    if (ts.isPropertyAccessExpression(current)) parts.unshift(current.name.text);
    else if (current.argumentExpression && ts.isStringLiteralLike(current.argumentExpression)) {
      parts.unshift(current.argumentExpression.text);
    } else {
      parts.unshift('<computed>');
    }
    current = current.expression;
  }
  if (ts.isIdentifier(current)) parts.unshift(current.text);
  return parts;
}

function identifierIsRuntimeReference(node) {
  const parent = node.parent;
  return !(
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isTypeReferenceNode(parent) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node)
  );
}

function isLedgerEntry(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.file === 'string' &&
    (value.kind === 'crypto-acquisition' || value.kind === 'digest') &&
    Array.isArray(value.operations) &&
    value.operations.every((operation) => typeof operation === 'string') &&
    sameStrings(value.operations, [...new Set(value.operations)].sort((a, b) => a.localeCompare(b)))
  );
}

function sameStrings(left, right) {
  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
}

function compareRows(left, right) {
  return left.file.localeCompare(right.file);
}

function scriptKind(file) {
  if (/\.tsx$/u.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/u.test(file)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/u.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

export function main(args = process.argv.slice(2)) {
  if (args.includes('--print-discovered')) {
    const result = checkCryptoBoundary({ entries: [], maximumCryptoAcquisitionFiles: 100_000 });
    process.stdout.write(`${JSON.stringify(result.discovered, null, 2)}\n`);
    return true;
  }
  const result = checkCryptoBoundary();
  process.stdout.write(`check-crypto-boundary/v1 ${result.summary}\n`);
  for (const finding of result.findings) process.stderr.write(`${finding}\n`);
  return result.ok;
}

if (isMainEntry(import.meta.url)) await runGate(main);
