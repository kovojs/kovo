import { createRequire } from 'node:module';
import * as ts from 'typescript';

import type { LiveTargetQueryBindingFact } from '../types.js';

const mutableTs = ts as unknown as Record<string, unknown>;
if (!('ScriptTarget' in mutableTs))
  Object.assign(mutableTs, createRequire(import.meta.url)('typescript') as typeof ts);

/**
 * @internal FN7 (plans/compiler-refactoring.md): the query-binding expression parser, relocated
 * into the scan/ source-reading boundary and shared by `app-graph` (which needs the full
 * {@link LiveTargetQueryBindingFact}) and `emit/server-render` (which needs only the readable
 * query-key expression). Previously each carried an identical copy of these helpers + its own
 * `ts.createSourceFile`; consolidating them here keeps the source read inside scan/ (SPEC.md §5.2
 * rule 9) and removes the duplication. Behavior-neutral: the functions are moved verbatim.
 */

/** @internal Parse a query-binding initializer into the live-target fact shape (sans `name`). */
export function queryBindingFromExpression(
  expressionSource: string,
): Omit<LiveTargetQueryBindingFact, 'name'> | null {
  const sourceFile = ts.createSourceFile(
    'query-binding.tsx',
    `const __binding = ${expressionSource};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const statement = sourceFile.statements[0];
  if (!statement || !ts.isVariableStatement(statement)) return null;
  const expression = statement.declarationList.declarations[0]?.initializer;
  if (!expression) return null;

  return queryBindingFromParsedExpression(sourceFile, expression);
}

/** @internal Extract the readable query-key expression (or null for object-literal keys). */
export function queryExpressionFromBinding(expressionSource: string): string | null {
  const sourceFile = ts.createSourceFile(
    'query-binding.tsx',
    `const __binding = ${expressionSource};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const statement = sourceFile.statements[0];
  if (!statement || !ts.isVariableStatement(statement)) return null;
  const expression = statement.declarationList.declarations[0]?.initializer;
  if (!expression) return null;

  const unwrappedExpression = unwrapQueryRefreshExpression(expression);
  if (
    ts.isCallExpression(unwrappedExpression) &&
    ts.isPropertyAccessExpression(unwrappedExpression.expression) &&
    unwrappedExpression.expression.name.text === 'args'
  ) {
    return queryKeyReadableExpression(
      unwrapQueryRefreshExpression(unwrappedExpression.expression.expression),
      sourceFile,
    );
  }

  return queryKeyReadableExpression(unwrappedExpression, sourceFile);
}

function queryBindingFromParsedExpression(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): Omit<LiveTargetQueryBindingFact, 'name'> | null {
  const unwrappedExpression = unwrapQueryRefreshExpression(expression);
  const hasRefresh = expressionHasQueryRefresh(expression);

  if (
    ts.isCallExpression(unwrappedExpression) &&
    ts.isPropertyAccessExpression(unwrappedExpression.expression) &&
    unwrappedExpression.expression.name.text === 'args'
  ) {
    const [mapper] = unwrappedExpression.arguments;
    const arrow = mapper && ts.isArrowFunction(mapper) ? mapper : null;
    return {
      ...(arrow ? queryArgsArrowFacts(sourceFile, arrow) : {}),
      ...(hasRefresh ? { hasRefresh } : {}),
      queryExpression: unwrapQueryRefreshExpression(
        unwrappedExpression.expression.expression,
      ).getText(sourceFile),
    };
  }

  return {
    ...(hasRefresh ? { hasRefresh } : {}),
    queryExpression: unwrappedExpression.getText(sourceFile),
  };
}

function unwrapQueryRefreshExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === 'refresh'
  ) {
    return unwrapQueryRefreshExpression(expression.expression.expression);
  }
  return expression;
}

function expressionHasQueryRefresh(expression: ts.Expression): boolean {
  if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
    if (expression.expression.name.text === 'refresh') return true;
    return expressionHasQueryRefresh(expression.expression.expression);
  }
  return false;
}

function queryArgsArrowFacts(
  sourceFile: ts.SourceFile,
  arrow: ts.ArrowFunction,
): Pick<LiveTargetQueryBindingFact, 'argsExpression' | 'argsParam' | 'argsPropertyAccesses'> {
  const param = arrow.parameters[0];
  const argsParam = param && ts.isIdentifier(param.name) ? param.name.text : undefined;
  const body = arrow.body;
  const argsExpression = body.getText(sourceFile);
  const propertyAccesses = propertyAccessPaths(body);

  return {
    argsExpression,
    ...(argsParam === undefined ? {} : { argsParam }),
    ...(propertyAccesses.length === 0 ? {} : { argsPropertyAccesses: propertyAccesses }),
  };
}

function propertyAccessPaths(node: ts.Node): string[] {
  const paths: string[] = [];
  const visit = (current: ts.Node): void => {
    if (ts.isPropertyAccessExpression(current)) {
      const path = propertyAccessPath(current);
      if (path) paths.push(path);
    }
    ts.forEachChild(current, visit);
  };

  visit(node);
  return [...new Set(paths)];
}

function propertyAccessPath(expression: ts.PropertyAccessExpression): string | null {
  const receiver = propertyAccessReceiverSegments(expression.expression);
  if (!receiver) return null;
  return [...receiver, expression.name.text].join('.');
}

function propertyAccessReceiverSegments(expression: ts.Expression): string[] | null {
  if (ts.isIdentifier(expression)) return [expression.text];
  if (!ts.isPropertyAccessExpression(expression)) return null;
  const path = propertyAccessPath(expression);
  return path ? path.split('.') : null;
}

function queryKeyReadableExpression(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): string | null {
  if (ts.isObjectLiteralExpression(expression)) return null;
  return expression.getText(sourceFile);
}
