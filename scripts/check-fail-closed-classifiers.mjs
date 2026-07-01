#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';
import { collectSourceFiles, productionSourceRoots } from './lib/source-files.mjs';

export const repoRoot = findRepoRoot();

const SECURITY_MARKERS_MODULE = '@kovojs/core/internal/security-markers';
const SECURITY_CLASSIFIER_EXPORT = 'securityClassifier';
const PERMISSIVE_STRING_VALUES = new Set(['', 'allow', 'allowed', 'ok', 'pass', 'safe', 'clean']);

export function checkFailClosedClassifiers(options = {}) {
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
    const text = readText(file);
    const sourceFile = ts.createSourceFile(
      file,
      text,
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
        : `${findings.length} fail-closed classifier violation(s)`,
  };
}

export function main(options = {}) {
  const result = checkFailClosedClassifiers(options);
  process.stdout.write(`check-fail-closed-classifiers/v1 ${result.summary}\n`);
  for (const finding of result.findings) process.stderr.write(`${finding}\n`);
  return result.ok;
}

function classifySourceFile(sourceFile) {
  const classifierNames = importedSecurityClassifierNames(sourceFile);
  if (classifierNames.size === 0) return [];

  const findings = [];
  const visit = (node) => {
    const call = unwrapCallExpression(node);
    if (call && isSecurityClassifierCall(call, classifierNames)) {
      const fn = securityClassifierFunction(call);
      if (fn) {
        findings.push(
          ...lintClassifierFunction(sourceFile, fn, {
            name: classifierDisplayName(call),
            decisionName: securityClassifierDecisionName(call),
          }),
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

function lintClassifierFunction(sourceFile, fn, classifier) {
  const findings = [];

  if (!ts.isBlock(fn.body)) {
    collectShortCircuitFallbackFindings(sourceFile, fn.body, classifier, findings);
    collectReturnedExpressionFindings(
      sourceFile,
      fn.body,
      classifier,
      'expression-body fallback',
      findings,
    );
    return findings;
  }

  const visit = (node) => {
    if (node !== fn.body && isFunctionLike(node)) return;

    if (ts.isSwitchStatement(node)) {
      for (const clause of node.caseBlock.clauses) {
        if (!ts.isDefaultClause(clause)) continue;
        for (const returnStatement of returnStatementsIn(clause)) {
          collectReturnedExpressionFindings(
            sourceFile,
            returnStatement.expression,
            classifier,
            'switch default',
            findings,
          );
        }
      }
    }

    if (ts.isReturnStatement(node)) {
      collectShortCircuitFallbackFindings(sourceFile, node.expression, classifier, findings);
      if (isNegatedProofReturn(node)) {
        collectReturnedExpressionFindings(
          sourceFile,
          node.expression,
          classifier,
          'negated-proof branch',
          findings,
        );
      }
      if (isTerminalFallbackReturn(fn.body, node)) {
        collectReturnedExpressionFindings(
          sourceFile,
          node.expression,
          classifier,
          'terminal fallback',
          findings,
        );
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(fn.body);

  return dedupeFindings(findings);
}

function collectReturnedExpressionFindings(sourceFile, expression, classifier, arm, findings) {
  if (!expression) return;
  const unwrapped = unwrapExpression(expression);
  const permissive = permissiveValueDescription(unwrapped);
  if (!permissive) return;
  findings.push(
    `${sourceFile.fileName}:${lineOf(sourceFile, expression)}: ${classifier.name} (${classifier.decisionName}) returns permissive ${permissive} from ${arm}; DEC2 requires a closed default and only positively proven allow branches`,
  );
}

function collectShortCircuitFallbackFindings(sourceFile, expression, classifier, findings) {
  if (!expression) return;
  const visit = (node) => {
    if (ts.isBinaryExpression(node) && isFallbackOperator(node.operatorToken.kind)) {
      const permissive = permissiveValueDescription(unwrapExpression(node.right));
      if (permissive) {
        findings.push(
          `${sourceFile.fileName}:${lineOf(sourceFile, node.right)}: ${classifier.name} (${classifier.decisionName}) uses ${operatorText(node.operatorToken.kind)} with permissive ${permissive}; DEC2 requires unresolved classifier flow to stay closed`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
}

function importedSecurityClassifierNames(sourceFile) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== SECURITY_MARKERS_MODULE) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      if (imported === SECURITY_CLASSIFIER_EXPORT) names.add(specifier.name.text);
    }
  }
  return names;
}

function unwrapCallExpression(node) {
  if (!ts.isCallExpression(node)) return undefined;
  return unwrapExpression(node);
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

function isSecurityClassifierCall(call, classifierNames) {
  const expression = unwrapExpression(call.expression);
  return ts.isIdentifier(expression) && classifierNames.has(expression.text);
}

function securityClassifierFunction(call) {
  const fn = call.arguments[1];
  if (!fn) return undefined;
  const unwrapped = unwrapExpression(fn);
  return ts.isFunctionExpression(unwrapped) || ts.isArrowFunction(unwrapped)
    ? unwrapped
    : undefined;
}

function classifierDisplayName(call) {
  const parent = call.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (
    ts.isAsExpression(parent) &&
    ts.isVariableDeclaration(parent.parent) &&
    ts.isIdentifier(parent.parent.name)
  ) {
    return parent.parent.name.text;
  }
  return '<anonymous securityClassifier>';
}

function securityClassifierDecisionName(call) {
  const name = call.arguments[0];
  return name && ts.isStringLiteralLike(name) ? name.text : '<dynamic-name>';
}

function returnStatementsIn(node) {
  const returns = [];
  const visit = (child) => {
    if (child !== node && isFunctionLike(child)) return;
    if (ts.isReturnStatement(child)) returns.push(child);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return returns;
}

function permissiveValueDescription(expression) {
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return '`true`';
  if (ts.isArrayLiteralExpression(expression) && expression.elements.length === 0) return '`[]`';
  if (ts.isObjectLiteralExpression(expression) && expression.properties.length === 0) return '`{}`';
  if (ts.isStringLiteralLike(expression) && PERMISSIVE_STRING_VALUES.has(expression.text)) {
    return `\`${JSON.stringify(expression.text).slice(1, -1)}\``;
  }
  return undefined;
}

function isNegatedProofReturn(statement) {
  const parent = statement.parent;
  if (!ts.isIfStatement(parent) || parent.thenStatement !== statement) return false;
  const condition = unwrapExpression(parent.expression);
  return (
    ts.isPrefixUnaryExpression(condition) && condition.operator === ts.SyntaxKind.ExclamationToken
  );
}

function isTerminalFallbackReturn(body, statement) {
  return body.statements[body.statements.length - 1] === statement;
}

function isFallbackOperator(kind) {
  return kind === ts.SyntaxKind.BarBarToken || kind === ts.SyntaxKind.QuestionQuestionToken;
}

function operatorText(kind) {
  return kind === ts.SyntaxKind.BarBarToken ? '`||`' : '`??`';
}

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
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

function dedupeFindings(findings) {
  return [...new Set(findings)];
}

if (isMainEntry(import.meta.url)) await runGate(main);
