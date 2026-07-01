import * as ts from 'typescript';

export interface PropertyNameTextOptions {
  readonly staticStringValues?: ReadonlyMap<string, string>;
}

export interface UnwrapExpressionOptions {
  readonly await?: boolean;
}

/** @internal Normalize authored AST wrappers while preserving decisions on typed nodes. */
export function unwrapExpression(
  expression: ts.Expression,
  options: UnwrapExpressionOptions = {},
): ts.Expression {
  const unwrapAwait = options.await ?? true;
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    (unwrapAwait && ts.isAwaitExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

export function propertyNameText(
  name: ts.PropertyName | undefined,
  options: PropertyNameTextOptions = {},
): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  if (ts.isComputedPropertyName(name)) {
    if (ts.isStringLiteralLike(name.expression) || ts.isNumericLiteral(name.expression)) {
      return name.expression.text;
    }
    if (ts.isIdentifier(name.expression)) {
      return options.staticStringValues?.get(name.expression.text) ?? null;
    }
  }

  return null;
}
