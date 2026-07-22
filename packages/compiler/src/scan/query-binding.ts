import * as ts from 'typescript';

import { propertyAccessPath } from './ast.js';
import { ensureTypescriptRuntime } from '../ts-api.js';
import type { QueryBindingModel } from './model.js';

ensureTypescriptRuntime(ts);

/**
 * @internal FN7 (plans/compiler-refactoring.md): the query-binding expression parser, relocated
 * into the scan/ source-reading boundary and shared by `app-graph` (which needs the full
 * {@link LiveTargetQueryBindingFact}) and `emit/server-render` (which needs only the readable
 * query-key expression). Previously each carried an identical copy of these helpers + its own
 * `ts.createSourceFile`; consolidating them here keeps the source read inside scan/ (SPEC.md §5.2
 * rule 9) and removes the duplication. Behavior-neutral: the functions are moved verbatim.
 */

/** @internal Build query-binding facts from the scanner's one authoritative AST. */
export function queryBindingFromParsedExpression(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): QueryBindingModel {
  // Query binding strings are compiler-authored structural grammar. `.refresh()` and `.args()`
  // are chain modifiers on the serialized binding expression, not framework API authority checks.
  const unwrappedExpression = unwrapQueryRefreshExpression(expression);
  const hasRefresh = expressionHasQueryRefresh(expression);

  if (
    ts.isCallExpression(unwrappedExpression) &&
    ts.isPropertyAccessExpression(unwrappedExpression.expression) &&
    unwrappedExpression.expression.name.text === 'args'
  ) {
    const [mapper] = unwrappedExpression.arguments;
    const arrow = mapper && ts.isArrowFunction(mapper) ? mapper : null;
    const queryExpression = unwrapQueryRefreshExpression(unwrappedExpression.expression.expression);
    const queryKeyExpression = queryKeyReadableExpression(queryExpression, sourceFile);
    return {
      ...(arrow ? queryArgsArrowFacts(sourceFile, arrow) : {}),
      ...(hasRefresh ? { hasRefresh } : {}),
      executable: isRuntimeQueryReference(queryExpression),
      ...(queryKeyExpression === null ? {} : { queryKeyExpression }),
      queryExpression: queryExpression.getText(sourceFile),
    };
  }

  const queryKeyExpression = queryKeyReadableExpression(unwrappedExpression, sourceFile);
  return {
    ...(hasRefresh ? { hasRefresh } : {}),
    executable: isRuntimeQueryReference(unwrappedExpression),
    ...(queryKeyExpression === null ? {} : { queryKeyExpression }),
    queryExpression: unwrappedExpression.getText(sourceFile),
  };
}

function isRuntimeQueryReference(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)) return true;
  return ts.isCallExpression(expression) && isRuntimeQueryReference(expression.expression);
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
): Pick<QueryBindingModel, 'argsExpression' | 'argsParam' | 'argsPropertyAccesses'> {
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

function queryKeyReadableExpression(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): string | null {
  if (ts.isObjectLiteralExpression(expression)) return null;
  return expression.getText(sourceFile);
}
