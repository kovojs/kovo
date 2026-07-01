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

export function propertyAccessPath(expression: ts.PropertyAccessExpression): string | null {
  const receiver = propertyAccessReceiverSegments(expression.expression);
  if (!receiver) return null;

  const segments = expression.questionDotToken ? markLastOptional(receiver) : receiver;
  segments.push(expression.name.text);
  return segments.join('.');
}

function propertyAccessReceiverSegments(expression: ts.Expression): string[] | null {
  if (ts.isIdentifier(expression)) return [expression.text];
  const callReceiver = callExpressionReceiverSegments(expression);
  if (callReceiver) return callReceiver;

  if (ts.isElementAccessExpression(expression)) {
    const path = literalElementAccessPath(expression);
    return path ? path.split('.') : null;
  }

  if (!ts.isPropertyAccessExpression(expression)) return null;

  return propertyAccessPath(expression)?.split('.') ?? null;
}

export function callExpressionReceiverSegments(expression: ts.Expression): string[] | null {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isCallExpression(unwrapped) || unwrapped.arguments.length !== 0) return null;
  if (ts.isIdentifier(unwrapped.expression)) return [`${unwrapped.expression.text}()`];
  if (ts.isPropertyAccessExpression(unwrapped.expression)) {
    const receiver = propertyAccessPath(unwrapped.expression);
    return receiver ? [`${receiver}()`] : null;
  }
  if (ts.isElementAccessExpression(unwrapped.expression)) {
    const receiver = literalElementAccessPath(unwrapped.expression);
    return receiver ? [`${receiver}()`] : null;
  }
  return null;
}

function literalElementAccessPath(expression: ts.ElementAccessExpression): string | null {
  const member = literalElementAccessMember(expression);
  if (!member) return null;
  const receiver = propertyAccessReceiverSegments(expression.expression);
  if (!receiver) return null;
  return [...receiver, member].join('.');
}

function literalElementAccessMember(expression: ts.ElementAccessExpression): string | undefined {
  return ts.isStringLiteralLike(expression.argumentExpression)
    ? expression.argumentExpression.text
    : undefined;
}

function markLastOptional(segments: readonly string[]): string[] {
  const result = [...segments];
  const last = result.at(-1);
  if (last) result[result.length - 1] = last.endsWith('?') ? last : `${last}?`;
  return result;
}
