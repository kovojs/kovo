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
const RECOGNIZER_NAME_PATTERN =
  /(?:recogn|resolv|parse|classif|sink|lookup|find|detect|match|write.*tables?|^is[A-Z])/u;
const DEFAULT_EXTRA_SOURCE_FILES = ['packages/compiler/src/validate/trusted-html-provenance.ts'];

export function checkFailClosedClassifiers(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const roots = options.roots ?? productionSourceRoots;
  const files =
    options.files ??
    uniqueSortedFiles([
      ...collectSourceFiles(root, roots, {
        productionRoots: options.productionRoots ?? roots,
      }),
      ...DEFAULT_EXTRA_SOURCE_FILES,
    ]);
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
  findings.push(...lintKnownSecurityHelperFunctions(sourceFile));
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

  const recognizerResults = collectRecognizerResultNames(fn.body);
  const recognitionSkipKeys = new Set();
  const visit = (node, nestedFunctionDepth = 0) => {
    const inNestedFunction = nestedFunctionDepth > 0;

    if (!inNestedFunction && ts.isSwitchStatement(node)) {
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

    if (!inNestedFunction && ts.isReturnStatement(node)) {
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

    if (ts.isIfStatement(node)) {
      const before = findings.length;
      collectRecognitionSkipFindings(sourceFile, node, classifier, recognizerResults, findings);
      if (findings.length > before) {
        const key = `${sourceFile.fileName}:${classifier.name}`;
        if (recognitionSkipKeys.has(key)) findings.pop();
        else recognitionSkipKeys.add(key);
      }
    }

    ts.forEachChild(node, (child) => {
      visit(child, nestedFunctionDepth + (child !== fn.body && isFunctionLike(child) ? 1 : 0));
    });
  };
  visit(fn.body);

  return dedupeFindings(findings);
}

function lintKnownSecurityHelperFunctions(sourceFile) {
  const findings = [];
  const visit = (node) => {
    if (!isNamedFunction(node)) {
      ts.forEachChild(node, visit);
      return;
    }
    const name = node.name.text;
    if (!isSecurityHelperFunctionName(name) || !ts.isBlock(node.body)) return;
    const recognizerResults = collectRecognizerResultNames(node.body);
    const helperClassifier = {
      decisionName: 'security helper',
      name,
    };
    const helperSkipKeys = new Set();
    const visitBody = (child) => {
      if (child !== node.body && isFunctionLike(child)) return;
      if (ts.isIfStatement(child)) {
        const before = findings.length;
        collectRecognitionSkipFindings(
          sourceFile,
          child,
          helperClassifier,
          recognizerResults,
          findings,
        );
        if (findings.length > before) {
          const key = `${sourceFile.fileName}:${name}`;
          if (helperSkipKeys.has(key)) findings.pop();
          else helperSkipKeys.add(key);
        }
      }
      ts.forEachChild(child, visitBody);
    };
    visitBody(node.body);
  };
  visit(sourceFile);
  return dedupeFindings(findings);
}

function collectRecognitionSkipFindings(sourceFile, statement, classifier, recognizerResults, findings) {
  const skip = recognitionSkipDescription(statement, recognizerResults);
  if (!skip) return;
  findings.push(
    `${sourceFile.fileName}:${lineOf(sourceFile, statement.expression)}: ${classifier.name} (${classifier.decisionName}) skips on unproven recognizer result ${skip}; fail-closed classifiers must return an unproven/closed verdict instead of allowing recognition failure to continue`,
  );
}

function recognitionSkipDescription(statement, recognizerResults) {
  const condition = unwrapExpression(statement.expression);
  const nullishSkip = nullishOrEmptySkipName(condition, recognizerResults);
  if (nullishSkip && statementSkipsOrAllows(statement.thenStatement)) return `\`${nullishSkip}\``;

  const positiveGuard = positiveRecognizerGuardName(condition, recognizerResults);
  if (
    positiveGuard &&
    statement.elseStatement === undefined &&
    branchIsNonEmpty(statement.thenStatement) &&
    !branchReturns(statement.thenStatement)
  ) {
    return `\`${positiveGuard}\` via implicit else skip`;
  }

  return undefined;
}

function collectRecognizerResultNames(body) {
  const names = new Set();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const initializer = node.initializer ? unwrapExpression(node.initializer) : undefined;
      if (
        RECOGNIZER_NAME_PATTERN.test(node.name.text) ||
        (initializer && expressionLooksLikeRecognizer(initializer))
      ) {
        names.add(node.name.text);
      }
    }
    if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
      const left = unwrapExpression(node.left);
      if (ts.isIdentifier(left) && expressionLooksLikeRecognizer(unwrapExpression(node.right))) {
        names.add(left.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return names;
}

function expressionLooksLikeRecognizer(expression) {
  if (ts.isCallExpression(expression)) {
    return expressionNameLooksLikeRecognizer(expression.expression);
  }
  if (ts.isAwaitExpression(expression)) return expressionLooksLikeRecognizer(unwrapExpression(expression.expression));
  return false;
}

function expressionNameLooksLikeRecognizer(expression) {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) return RECOGNIZER_NAME_PATTERN.test(unwrapped.text);
  if (ts.isPropertyAccessExpression(unwrapped)) {
    return RECOGNIZER_NAME_PATTERN.test(unwrapped.name.text);
  }
  if (ts.isElementAccessExpression(unwrapped)) return true;
  return false;
}

function nullishOrEmptySkipName(condition, recognizerResults) {
  const unwrapped = unwrapExpression(condition);
  if (ts.isBinaryExpression(unwrapped)) {
    if (
      unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      return (
        nullishOrEmptySkipName(unwrapped.left, recognizerResults) ??
        nullishOrEmptySkipName(unwrapped.right, recognizerResults)
      );
    }
    return nullishOrEmptyComparisonName(unwrapped, recognizerResults);
  }
  if (ts.isPrefixUnaryExpression(unwrapped) && unwrapped.operator === ts.SyntaxKind.ExclamationToken) {
    const operand = unwrapExpression(unwrapped.operand);
    if (ts.isIdentifier(operand) && recognizerResults.has(operand.text)) return operand.text;
    if (ts.isCallExpression(operand) && expressionNameLooksLikeRecognizer(operand.expression)) {
      return operand.expression.getText();
    }
  }
  if (ts.isCallExpression(unwrapped) && expressionNameLooksLikeRecognizer(unwrapped.expression)) {
    return unwrapped.expression.getText();
  }
  return undefined;
}

function nullishOrEmptyComparisonName(expression, recognizerResults) {
  if (!isEqualityOperator(expression.operatorToken.kind)) return undefined;
  return (
    recognizerComparedToNullishOrEmpty(expression.left, expression.right, recognizerResults) ??
    recognizerComparedToNullishOrEmpty(expression.right, expression.left, recognizerResults)
  );
}

function recognizerComparedToNullishOrEmpty(candidate, sentinel, recognizerResults) {
  const unwrappedCandidate = unwrapExpression(candidate);
  const unwrappedSentinel = unwrapExpression(sentinel);
  const candidateName = recognizerCandidateName(unwrappedCandidate, recognizerResults);
  if (!candidateName) return undefined;
  if (isNullishSentinel(unwrappedSentinel)) return candidateName;
  if (numericLiteralValue(unwrappedSentinel) === 0) return candidateName;
  return undefined;
}

function recognizerCandidateName(candidate, recognizerResults) {
  if (ts.isIdentifier(candidate) && recognizerResults.has(candidate.text)) return candidate.text;
  if (
    ts.isPropertyAccessExpression(candidate) &&
    candidate.name.text === 'length' &&
    ts.isIdentifier(unwrapExpression(candidate.expression)) &&
    recognizerResults.has(unwrapExpression(candidate.expression).text)
  ) {
    return unwrapExpression(candidate.expression).text;
  }
  if (ts.isCallExpression(candidate) && expressionNameLooksLikeRecognizer(candidate.expression)) {
    return candidate.expression.getText();
  }
  return undefined;
}

function positiveRecognizerGuardName(condition, recognizerResults) {
  const unwrapped = unwrapExpression(condition);
  if (ts.isBinaryExpression(unwrapped)) {
    if (
      unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken
    ) {
      return (
        positiveRecognizerGuardName(unwrapped.left, recognizerResults) ??
        positiveRecognizerGuardName(unwrapped.right, recognizerResults)
      );
    }
    if (!isInequalityOperator(unwrapped.operatorToken.kind)) return undefined;
    return (
      recognizerComparedToNullishOrEmpty(unwrapped.left, unwrapped.right, recognizerResults) ??
      recognizerComparedToNullishOrEmpty(unwrapped.right, unwrapped.left, recognizerResults)
    );
  }
  if (ts.isIdentifier(unwrapped) && recognizerResults.has(unwrapped.text)) return unwrapped.text;
  return undefined;
}

function statementSkipsOrAllows(statement) {
  if (ts.isReturnStatement(statement)) return permissiveReturn(statement);
  if (ts.isContinueStatement(statement)) return true;
  if (!ts.isBlock(statement)) return false;
  return statement.statements.some((child) => {
    if (ts.isReturnStatement(child)) return permissiveReturn(child);
    return ts.isContinueStatement(child);
  });
}

function permissiveReturn(statement) {
  if (!statement.expression) return true;
  return permissiveValueDescription(unwrapExpression(statement.expression)) !== undefined;
}

function branchIsNonEmpty(statement) {
  return ts.isBlock(statement) ? statement.statements.length > 0 : true;
}

function branchReturns(statement) {
  if (ts.isReturnStatement(statement)) return true;
  if (!ts.isBlock(statement)) return false;
  return statement.statements.some((child) => ts.isReturnStatement(child));
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

function isNamedFunction(node) {
  return ts.isFunctionDeclaration(node) && node.name !== undefined;
}

function isSecurityHelperFunctionName(name) {
  return /(?:wire.*alias.*roots?|trust.*sink|raw.*sink|write.*tables?|parse.*sql)/iu.test(name);
}

function isEqualityOperator(kind) {
  return (
    kind === ts.SyntaxKind.EqualsEqualsToken ||
    kind === ts.SyntaxKind.EqualsEqualsEqualsToken
  );
}

function isInequalityOperator(kind) {
  return (
    kind === ts.SyntaxKind.ExclamationEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
  );
}

function isNullishSentinel(expression) {
  return (
    expression.kind === ts.SyntaxKind.NullKeyword ||
    expression.kind === ts.SyntaxKind.UndefinedKeyword ||
    (ts.isIdentifier(expression) && expression.text === 'undefined')
  );
}

function numericLiteralValue(expression) {
  return ts.isNumericLiteral(expression) ? Number(expression.text) : undefined;
}

function isAssignmentOperator(kind) {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
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

function uniqueSortedFiles(files) {
  return [...new Set(files)].sort((left, right) => left.localeCompare(right));
}

if (isMainEntry(import.meta.url)) await runGate(main);
