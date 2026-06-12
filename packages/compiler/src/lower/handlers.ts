import { diagnosticDefinitions } from '@jiso/core';
import ts from 'typescript';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import { literalValue } from '../scan/object.js';
import {
  functionBodyPropertyAccessPaths,
  identifierReferences,
  jsxElements,
  type ComponentModuleModel,
  type ZeroArgArrowModel,
} from '../scan/parse.js';
import { replaceExtension } from '../shared.js';
import type {
  CompileComponentOptions,
  ElementParam,
  ElementParamType,
  HandlerLowering,
} from '../types.js';

export function lowerEventHandlers(
  options: CompileComponentOptions,
  componentName: string,
  model: ComponentModuleModel,
): HandlerLowering[] {
  const handlers: HandlerLowering[] = [];
  const anonymousNameCounts = new Map<string, number>();

  for (const eventAttribute of eventAttributes(model)) {
    const { attributeEnd, attributeStart, event, expression, tag } = eventAttribute;
    const namedHandler = /^[A-Za-z_$][\w$]*$/.test(expression);
    const params = namedHandler
      ? []
      : extractElementParams(expression, eventAttribute.zeroArgArrow);
    const eventName = event.toLowerCase();
    const exportName = namedHandler
      ? `${componentName}$${expression}`
      : uniqueAnonymousHandlerName(componentName, tag, eventName, anonymousNameCounts);

    const diagnostics: CompilerDiagnostic[] = [];
    if (!namedHandler) {
      diagnostics.push(
        diagnosticFor(options.fileName, 'FW210', options.source, attributeStart, event.length),
      );
    }

    if (capturesUnserializableValue(expression, eventAttribute.zeroArgArrow?.references)) {
      diagnostics.push(
        fw201Diagnostic(options.fileName, options.source, attributeStart, {
          attributeName: `on:${eventName}`,
          exportName,
          expression,
          params,
        }),
      );
    }

    const primaryDiagnostic = diagnostics[diagnostics.length - 1];
    handlers.push({
      attributeName: `on:${eventName}`,
      attributeEnd,
      attributeStart,
      attributeValue: `${clientModuleUrl(options.fileName)}#${exportName}`,
      ...(eventAttribute.zeroArgArrow
        ? {
            arrowBody: {
              kind: eventAttribute.zeroArgArrow.bodyKind,
              source: eventAttribute.zeroArgArrow.body,
            },
          }
        : {}),
      ...(primaryDiagnostic ? { diagnostic: primaryDiagnostic, diagnostics } : {}),
      expression,
      exportName,
      params,
    });
  }

  return handlers;
}

export function versionHandlerLowering(
  handler: HandlerLowering,
  fileName: string,
  clientHref: string,
): HandlerLowering {
  const unversionedHref = clientModuleUrl(fileName);
  const versionedAttributeValue = `${clientHref}#${handler.exportName}`;
  return {
    ...handler,
    attributeValue: versionedAttributeValue,
    ...(handler.diagnostics
      ? {
          diagnostics: handler.diagnostics.map((diagnostic) =>
            diagnostic.help
              ? {
                  ...diagnostic,
                  help: diagnostic.help.replaceAll(`${unversionedHref}#`, `${clientHref}#`),
                }
              : diagnostic,
          ),
        }
      : {}),
    ...(handler.diagnostic
      ? {
          diagnostic: {
            ...handler.diagnostic,
            ...(handler.diagnostic.help
              ? {
                  help: handler.diagnostic.help.replaceAll(`${unversionedHref}#`, `${clientHref}#`),
                }
              : {}),
          },
        }
      : {}),
  };
}

export function clientModuleUrl(fileName: string, version?: string): string {
  const href = `/c/${replaceExtension(fileName, '.client.js').replace(/^\/+/, '')}`;
  return version ? `${href}?v=${version}` : href;
}

export function clientModuleVersion(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

function eventAttributes(model: ComponentModuleModel): Array<{
  attributeEnd: number;
  attributeStart: number;
  event: string;
  expression: string;
  tag: string;
  zeroArgArrow?: ZeroArgArrowModel;
}> {
  const attributes: Array<{
    attributeEnd: number;
    attributeStart: number;
    event: string;
    expression: string;
    tag: string;
    zeroArgArrow?: ZeroArgArrowModel;
  }> = [];

  for (const element of jsxElements(model)) {
    for (const attribute of element.attributes) {
      const event = jsxEventAttributeName(attribute.name);
      if (!event || attribute.expression === undefined) continue;
      attributes.push({
        attributeEnd: attribute.end,
        attributeStart: attribute.start,
        event,
        expression: attribute.expression,
        tag: element.tag,
        ...(attribute.zeroArgArrow ? { zeroArgArrow: attribute.zeroArgArrow } : {}),
      });
    }
  }

  return attributes;
}

function jsxEventAttributeName(name: string): string | null {
  if (!/^on[A-Z][A-Za-z0-9]*$/.test(name)) return null;
  return name.slice(2);
}

function uniqueAnonymousHandlerName(
  componentName: string,
  tag: string,
  eventName: string,
  counts: Map<string, number>,
): string {
  const base = `${componentName}$${tag}_${eventName}`;
  const count = (counts.get(base) ?? 0) + 1;
  counts.set(base, count);

  return count === 1 ? base : `${base}_${count}`;
}

export function capturesUnserializableValue(
  expression: string,
  parsedReferences?: readonly string[],
): boolean {
  const references = new Set(
    parsedReferences ?? identifierReferences('expression.tsx', expression),
  );
  return ['window', 'document', 'db', 'request', 'response', 'Date', 'Map', 'Set'].some((name) =>
    references.has(name),
  );
}

function fw201Diagnostic(
  fileName: string,
  source: string,
  offset: number,
  lowering: {
    attributeName: string;
    exportName: string;
    expression: string;
    params: readonly ElementParam[];
  },
): CompilerDiagnostic {
  const definition = diagnosticDefinitions.FW201;
  const labels = definition.detailLabels;
  return {
    ...diagnosticFor(fileName, 'FW201', source, offset, lowering.attributeName.length),
    help: [
      `${labels.handlerLowering} ${lowering.attributeName}="${clientModuleUrl(fileName)}#${lowering.exportName}"`,
      `${labels.blockedExpression} ${lowering.expression}`,
      `${labels.elementParams} ${lowering.params.map((param) => param.attributeName).join(', ') || '-'}`,
      definition.help ?? '',
    ].join('\n'),
  };
}

function extractElementParams(
  expression: string,
  zeroArgArrow?: ZeroArgArrowModel,
): ElementParam[] {
  const callArguments = zeroArgArrow?.callArguments ?? zeroArgArrowCallArguments(expression);
  const expressions = callArguments
    ? callArguments
        .map((arg) => arg.trim())
        .filter((arg) => arg.length > 0 && arg !== 'state')
        .flatMap((arg) => {
          if (literalValue(arg) !== undefined) return [];
          const members = serializableMemberExpressions(arg);
          return members.length > 0 ? members : [arg];
        })
    : serializableMemberExpressions(expression, zeroArgArrow);

  return dedupeStrings(expressions).map((arg) => ({
    attributeName: `data-p-${paramNameForExpression(arg)}`,
    type: inferElementParamType(expression, arg),
    value: `{${arg}}`,
  }));
}

function zeroArgArrowCallArguments(expression: string): string[] | null {
  const sourceFile = ts.createSourceFile(
    'handler-expression.ts',
    `const __jiso_handler__ = ${expression};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let callArguments: string[] | null = null;

  const visit = (node: ts.Node): void => {
    if (callArguments !== null) return;

    if (
      ts.isArrowFunction(node) &&
      node.parameters.length === 0 &&
      ts.isCallExpression(node.body)
    ) {
      callArguments = node.body.arguments.map((argument) => argument.getText(sourceFile));
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return callArguments;
}

function inferElementParamType(expression: string, sourceExpression: string): ElementParamType {
  if (usedAsBoolean(expression, sourceExpression)) return 'boolean';
  if (usedAsNumber(expression, sourceExpression)) return 'number';

  return 'string';
}

function usedAsBoolean(expression: string, sourceExpression: string): boolean {
  return expressionUsesParam(expression, sourceExpression, (node, sourceFile) => {
    const parent = node.parent;

    if (ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken) {
      return parent.operand === node;
    }

    if (ts.isConditionalExpression(parent) && parent.condition === node) return true;
    if (ts.isIfStatement(parent) && parent.expression === node) return true;
    if (ts.isWhileStatement(parent) && parent.expression === node) return true;
    if (ts.isDoStatement(parent) && parent.expression === node) return true;

    if (!ts.isBinaryExpression(parent)) return false;

    if (
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      parent.operatorToken.kind === ts.SyntaxKind.BarBarToken
    ) {
      return parent.left === node || parent.right === node;
    }

    return (
      isEqualityOperator(parent.operatorToken.kind) &&
      ((parent.left === node && isBooleanLiteral(parent.right, sourceFile)) ||
        (parent.right === node && isBooleanLiteral(parent.left, sourceFile)))
    );
  });
}

function usedAsNumber(expression: string, sourceExpression: string): boolean {
  return expressionUsesParam(expression, sourceExpression, (node, sourceFile) => {
    const parent = node.parent;
    if (!ts.isBinaryExpression(parent)) return false;

    if (
      isArithmeticOperator(parent.operatorToken.kind) ||
      isArithmeticAssignmentOperator(parent.operatorToken.kind)
    ) {
      return parent.left === node || parent.right === node;
    }

    return (
      (isEqualityOperator(parent.operatorToken.kind) ||
        isOrderingOperator(parent.operatorToken.kind)) &&
      ((parent.left === node && isNumericLiteral(parent.right, sourceFile)) ||
        (parent.right === node && isNumericLiteral(parent.left, sourceFile)))
    );
  });
}

function expressionUsesParam(
  expression: string,
  sourceExpression: string,
  predicate: (node: ts.Node, sourceFile: ts.SourceFile) => boolean,
): boolean {
  const sourceFile = handlerExpressionSourceFile(expression);
  let matched = false;

  const visit = (node: ts.Node): void => {
    if (matched) return;
    if (node.getText(sourceFile) === sourceExpression && predicate(node, sourceFile)) {
      matched = true;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return matched;
}

function isEqualityOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    kind === ts.SyntaxKind.EqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsToken
  );
}

function isOrderingOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.LessThanToken ||
    kind === ts.SyntaxKind.LessThanEqualsToken ||
    kind === ts.SyntaxKind.GreaterThanToken ||
    kind === ts.SyntaxKind.GreaterThanEqualsToken
  );
}

function isArithmeticOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.MinusToken ||
    kind === ts.SyntaxKind.AsteriskToken ||
    kind === ts.SyntaxKind.SlashToken ||
    kind === ts.SyntaxKind.PercentToken
  );
}

function isArithmeticAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.PlusEqualsToken ||
    kind === ts.SyntaxKind.MinusEqualsToken ||
    kind === ts.SyntaxKind.AsteriskEqualsToken ||
    kind === ts.SyntaxKind.SlashEqualsToken ||
    kind === ts.SyntaxKind.PercentEqualsToken
  );
}

function isBooleanLiteral(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const text = node.getText(sourceFile);
  return text === 'true' || text === 'false';
}

function isNumericLiteral(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  return /^-?\d(?:\d|\.)*$/.test(node.getText(sourceFile));
}

function serializableMemberExpressions(
  expression: string,
  zeroArgArrow?: ZeroArgArrowModel,
): string[] {
  return collectSerializableMemberExpressions(expression, zeroArgArrow).filter(
    (member) =>
      !member.startsWith('state.') &&
      !member.startsWith('ctx.') &&
      !member.startsWith('document.') &&
      !member.startsWith('window.'),
  );
}

function collectSerializableMemberExpressions(
  expression: string,
  zeroArgArrow?: ZeroArgArrowModel,
): string[] {
  if (zeroArgArrow) return zeroArgArrow.bodyPropertyAccesses.map((access) => access.path);

  return functionBodyPropertyAccessPaths('handler-expression.ts', expression);
}

function handlerExpressionSourceFile(expression: string): ts.SourceFile {
  return ts.createSourceFile(
    'handler-expression.ts',
    `function __jiso_handler__() {\n${expression}\n}`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function paramNameForExpression(expression: string): string {
  const segments = expression
    .replace(/\[['"]([^'"]+)['"]\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  const last = segments.at(-1) ?? expression;
  return last
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}
