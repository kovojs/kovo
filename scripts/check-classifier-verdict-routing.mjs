#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';
import { collectSourceFiles, productionSourceRoots } from './lib/source-files.mjs';

export const repoRoot = findRepoRoot();

export function checkClassifierVerdictRouting(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const roots = options.roots ?? productionSourceRoots;
  const files =
    options.files ??
    collectSourceFiles(root, roots, {
      productionRoots: options.productionRoots ?? roots,
    });
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const findings = [];

  for (const file of files) {
    const sourceFile = ts.createSourceFile(
      file,
      readText(file),
      ts.ScriptTarget.Latest,
      true,
      scriptKind(file),
    );
    findings.push(...classifySourceFile(sourceFile));
  }

  return {
    findings,
    ok: findings.length === 0,
    summary:
      findings.length === 0
        ? `OK ${files.length} source file(s) scanned`
        : `${findings.length} classifier verdict routing violation(s)`,
  };
}

export function main(options = {}) {
  const result = checkClassifierVerdictRouting(options);
  process.stdout.write(`check-classifier-verdict-routing/v1 ${result.summary}\n`);
  for (const finding of result.findings) process.stderr.write(`${finding}\n`);
  return result.ok;
}

function classifySourceFile(sourceFile) {
  const findings = [];
  const visit = (node) => {
    if (ts.isIfStatement(node)) collectIfStatementFinding(sourceFile, node, findings);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...new Set(findings)];
}

function collectIfStatementFinding(sourceFile, statement, findings) {
  const unsafeVariables = provenUnsafeKindVariables(statement.expression);
  if (unsafeVariables.size === 0) return;
  if (conditionClosesUnproven(statement.expression, unsafeVariables)) return;
  if (elseBranchClosesUnproven(statement.elseStatement, unsafeVariables)) return;

  findings.push(
    `${sourceFile.fileName}:${lineOf(sourceFile, statement.expression)}: ClassifierVerdict branch closes proven-unsafe without an unproven companion branch; SPEC §10.3/§11.2 require UNPROVEN to route to the same closed action`,
  );
}

function provenUnsafeKindVariables(expression) {
  const variables = new Set();
  const visit = (node) => {
    const match = kindComparison(node, 'proven-unsafe');
    if (match) variables.add(match);
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return variables;
}

function conditionClosesUnproven(expression, unsafeVariables) {
  let closes = false;
  const visit = (node) => {
    const match = kindComparison(node, 'unproven');
    if (match && unsafeVariables.has(match)) closes = true;
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return closes;
}

function elseBranchClosesUnproven(statement, unsafeVariables) {
  if (!statement) return false;
  let closes = false;
  const visit = (node) => {
    if (ts.isIfStatement(node) && conditionClosesUnproven(node.expression, unsafeVariables)) {
      closes = statementCloses(node.thenStatement);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(statement);
  return closes;
}

function statementCloses(statement) {
  if (ts.isThrowStatement(statement)) return true;
  if (ts.isBlock(statement)) return statement.statements.some((child) => ts.isThrowStatement(child));
  return false;
}

function kindComparison(node, expected) {
  if (!ts.isBinaryExpression(node)) return undefined;
  if (!isEqualityOperator(node.operatorToken.kind)) return undefined;
  return (
    kindComparisonSide(node.left, node.right, expected) ??
    kindComparisonSide(node.right, node.left, expected)
  );
}

function kindComparisonSide(left, right, expected) {
  const kindAccess = unwrapExpression(left);
  const literal = unwrapExpression(right);
  if (!ts.isPropertyAccessExpression(kindAccess) || kindAccess.name.text !== 'kind') return undefined;
  if (!ts.isStringLiteralLike(literal) || literal.text !== expected) return undefined;
  const expression = unwrapExpression(kindAccess.expression);
  return ts.isIdentifier(expression) ? expression.text : undefined;
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isEqualityOperator(kind) {
  return (
    kind === ts.SyntaxKind.EqualsEqualsToken ||
    kind === ts.SyntaxKind.EqualsEqualsEqualsToken
  );
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function scriptKind(file) {
  if (file.endsWith('.tsx') || file.endsWith('.mtsx') || file.endsWith('.ctsx')) {
    return ts.ScriptKind.TSX;
  }
  return ts.ScriptKind.TS;
}

if (isMainEntry(import.meta.url)) await runGate(main);
