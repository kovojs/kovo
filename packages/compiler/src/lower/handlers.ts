import { diagnosticDefinitions } from '@jiso/core';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import {
  jsxElements,
  type ComponentModuleModel,
  type IdentifierReferenceModel,
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
import { elementParamAttributeNameFromPropertyName } from '../types.js';

export function lowerEventHandlers(
  options: CompileComponentOptions,
  componentName: string,
  model: ComponentModuleModel,
): HandlerLowering[] {
  const handlers: HandlerLowering[] = [];
  const anonymousNameCounts = new Map<string, number>();

  for (const eventAttribute of eventAttributes(model)) {
    const { attributeEnd, attributeStart, eventName, expression, tag } = eventAttribute;
    const namedHandler = /^[A-Za-z_$][\w$]*$/.test(expression);
    const params = namedHandler
      ? []
      : extractElementParams(
          expression,
          eventAttribute.zeroArgArrow,
          eventAttribute.expressionPropertyAccesses,
        );
    const exportName = namedHandler
      ? `${componentName}$${expression}`
      : uniqueAnonymousHandlerName(componentName, tag, eventName, anonymousNameCounts);

    const diagnostics: CompilerDiagnostic[] = [];
    if (!namedHandler) {
      diagnostics.push(
        diagnosticFor(options.fileName, 'FW210', options.source, attributeStart, eventName.length),
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
  eventName: string;
  expression: string;
  expressionPropertyAccesses?: readonly PropertyAccessPathModel[];
  expressionReferences?: readonly string[];
  tag: string;
  zeroArgArrow?: ZeroArgArrowModel;
}> {
  const attributes: Array<{
    attributeEnd: number;
    attributeStart: number;
    eventName: string;
    expression: string;
    expressionPropertyAccesses?: readonly PropertyAccessPathModel[];
    expressionReferences?: readonly string[];
    tag: string;
    zeroArgArrow?: ZeroArgArrowModel;
  }> = [];

  for (const element of jsxElements(model)) {
    for (const attribute of element.attributes) {
      const eventName = attribute.domEventName;
      if (!eventName || attribute.expression === undefined) continue;
      attributes.push({
        attributeEnd: attribute.end,
        attributeStart: attribute.start,
        eventName,
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

interface ElementParamCandidate {
  expression: string;
  terminalName: string;
  type?: ElementParamType;
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
  const candidates = callArguments
    ? callArguments
        .map((arg) => arg.trim())
        .flatMap((arg, index) => {
          if (arg.length === 0 || arg === 'state') return [];
          if (zeroArgArrow?.callArgumentStaticValues?.[index] !== undefined) return [];
          const members =
            zeroArgArrow?.callArgumentPropertyAccesses?.[index]
              ?.filter((access) => serializableMemberExpression(access.path))
              .map(elementParamCandidateFromAccess) ?? [];
          const simpleReference = simpleCallArgumentReference(
            arg,
            zeroArgArrow?.callArgumentReferences?.[index] ?? [],
          );
          if (members.length > 0) return members;
          return simpleReference ? [{ expression: arg, terminalName: simpleReference }] : [];
        })
    : serializableMemberExpressions(zeroArgArrow, parsedPropertyAccesses);

  return dedupeElementParamCandidates(candidates).map((candidate) => ({
    attributeName: elementParamAttributeNameFromPropertyName(candidate.terminalName),
    expression: candidate.expression,
    type:
      candidate.type ??
      inferElementParamType(candidate.expression, zeroArgArrow, parsedPropertyAccesses),
    value: `{${candidate.expression}}`,
  }));
}

function elementParamCandidateFromAccess(access: PropertyAccessPathModel): ElementParamCandidate {
  return {
    expression: access.path,
    ...(access.inferredType ? { type: access.inferredType } : {}),
    terminalName: access.terminalName,
  };
}

function simpleCallArgumentReference(
  expression: string,
  references: readonly IdentifierReferenceModel[],
): string | null {
  const [reference] = references;
  return reference && references.length === 1 && reference.name === expression.trim()
    ? reference.name
    : null;
}

function inferElementParamType(
  sourceExpression: string,
  zeroArgArrow?: ZeroArgArrowModel,
  parsedPropertyAccesses?: readonly PropertyAccessPathModel[],
): ElementParamType {
  const propertyAccesses = zeroArgArrow?.bodyPropertyAccesses ?? parsedPropertyAccesses ?? [];
  const parsedType = propertyAccesses.find(
    (access) => access.path === sourceExpression && access.inferredType !== undefined,
  )?.inferredType;
  if (parsedType) return parsedType;

  return 'string';
}

function serializableMemberExpressions(
  zeroArgArrow?: ZeroArgArrowModel,
  parsedPropertyAccesses?: readonly PropertyAccessPathModel[],
): ElementParamCandidate[] {
  return collectSerializableMemberExpressions(zeroArgArrow, parsedPropertyAccesses)
    .filter((access) => serializableMemberExpression(access.path))
    .map(elementParamCandidateFromAccess);
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
): readonly PropertyAccessPathModel[] {
  if (zeroArgArrow) return zeroArgArrow.bodyPropertyAccesses;
  if (parsedPropertyAccesses) return parsedPropertyAccesses;

  return [];
}

function dedupeElementParamCandidates(
  values: readonly ElementParamCandidate[],
): ElementParamCandidate[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.expression)) return false;
    seen.add(value.expression);
    return true;
  });
}
