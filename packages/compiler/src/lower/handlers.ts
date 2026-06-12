import { diagnosticDefinitions } from '@jiso/core';
import ts from 'typescript';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import {
  jsxElements,
  expressionUsageType,
  type ComponentModuleModel,
  type PropertyAccessPathModel,
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
      : extractElementParams(
          expression,
          eventAttribute.zeroArgArrow,
          eventAttribute.expressionPropertyAccesses,
        );
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

    if (
      capturesUnserializableReferences(
        eventAttribute.zeroArgArrow?.references ?? eventAttribute.expressionReferences ?? [],
      )
    ) {
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
              propertyAccesses: eventAttribute.zeroArgArrow.bodyPropertyAccesses.map((access) => ({
                end: access.end - eventAttribute.zeroArgArrow!.bodySourceStart,
                path: access.path,
                start: access.start - eventAttribute.zeroArgArrow!.bodySourceStart,
              })),
              references: eventAttribute.zeroArgArrow.bodyReferences.map((reference) => ({
                end: reference.end - eventAttribute.zeroArgArrow!.bodySourceStart,
                name: reference.name,
                start: reference.start - eventAttribute.zeroArgArrow!.bodySourceStart,
              })),
              source: eventAttribute.zeroArgArrow.body,
              sourceStart: eventAttribute.zeroArgArrow.bodySourceStart,
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
  expressionPropertyAccesses?: readonly PropertyAccessPathModel[];
  expressionReferences?: readonly string[];
  tag: string;
  zeroArgArrow?: ZeroArgArrowModel;
}> {
  const attributes: Array<{
    attributeEnd: number;
    attributeStart: number;
    event: string;
    expression: string;
    expressionPropertyAccesses?: readonly PropertyAccessPathModel[];
    expressionReferences?: readonly string[];
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
        ...(attribute.expressionPropertyAccesses
          ? { expressionPropertyAccesses: attribute.expressionPropertyAccesses }
          : {}),
        ...(attribute.expressionReferences
          ? { expressionReferences: attribute.expressionReferences }
          : {}),
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

export function capturesUnserializableReferences(references: readonly string[]): boolean {
  const referenceSet = new Set(references);
  return ['window', 'document', 'db', 'request', 'response', 'Date', 'Map', 'Set'].some((name) =>
    referenceSet.has(name),
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
  parsedPropertyAccesses?: readonly PropertyAccessPathModel[],
): ElementParam[] {
  const callArguments = zeroArgArrow?.callArguments;
  const expressions = callArguments
    ? callArguments
        .map((arg) => arg.trim())
        .flatMap((arg, index) => {
          if (arg.length === 0 || arg === 'state') return [];
          if (zeroArgArrow?.callArgumentStaticValues?.[index] !== undefined) return [];
          const members =
            zeroArgArrow?.callArgumentPropertyAccesses?.[index]
              ?.map((access) => access.path)
              .filter(serializableMemberExpression) ?? [];
          return members.length > 0 ? members : [arg];
        })
    : serializableMemberExpressions(zeroArgArrow, parsedPropertyAccesses);

  return dedupeStrings(expressions).map((arg) => ({
    attributeName: `data-p-${paramNameForExpression(arg)}`,
    type: inferElementParamType(expression, arg, zeroArgArrow, parsedPropertyAccesses),
    value: `{${arg}}`,
  }));
}

function inferElementParamType(
  expression: string,
  sourceExpression: string,
  zeroArgArrow?: ZeroArgArrowModel,
  parsedPropertyAccesses?: readonly PropertyAccessPathModel[],
): ElementParamType {
  const propertyAccesses = zeroArgArrow?.bodyPropertyAccesses ?? parsedPropertyAccesses ?? [];
  const parsedType = propertyAccesses.find(
    (access) => access.path === sourceExpression && access.inferredType !== undefined,
  )?.inferredType;
  if (parsedType) return parsedType;
  if (parsedPropertyAccesses) return 'string';
  if (usedAsBoolean(expression, sourceExpression)) return 'boolean';
  if (usedAsNumber(expression, sourceExpression)) return 'number';

  return 'string';
}

function usedAsBoolean(expression: string, sourceExpression: string): boolean {
  return expressionUsesParam(
    expression,
    sourceExpression,
    (node, sourceFile) => expressionUsageType(sourceFile, node) === 'boolean',
  );
}

function usedAsNumber(expression: string, sourceExpression: string): boolean {
  return expressionUsesParam(
    expression,
    sourceExpression,
    (node, sourceFile) => expressionUsageType(sourceFile, node) === 'number',
  );
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

function serializableMemberExpressions(
  zeroArgArrow?: ZeroArgArrowModel,
  parsedPropertyAccesses?: readonly PropertyAccessPathModel[],
): string[] {
  return collectSerializableMemberExpressions(zeroArgArrow, parsedPropertyAccesses).filter(
    serializableMemberExpression,
  );
}

function serializableMemberExpression(member: string): boolean {
  return (
    !member.startsWith('state.') &&
    !member.startsWith('ctx.') &&
    !member.startsWith('document.') &&
    !member.startsWith('window.')
  );
}

function collectSerializableMemberExpressions(
  zeroArgArrow?: ZeroArgArrowModel,
  parsedPropertyAccesses?: readonly PropertyAccessPathModel[],
): string[] {
  if (zeroArgArrow) return zeroArgArrow.bodyPropertyAccesses.map((access) => access.path);
  if (parsedPropertyAccesses) return parsedPropertyAccesses.map((access) => access.path);

  return [];
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
