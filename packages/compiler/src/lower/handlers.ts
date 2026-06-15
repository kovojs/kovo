import { diagnosticDefinitions } from '@jiso/core';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import {
  componentRenderInputs,
  jsxElements,
  type ComponentModuleModel,
  type IdentifierReferenceModel,
  type ModuleScopeBindingModel,
  type NamedImportModel,
  type PropertyAccessPathModel,
  type ZeroArgArrowModel,
} from '../scan/parse.js';
import { replaceExtension } from '../shared.js';
import type {
  ClientImportDependency,
  ClientConstantDependency,
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
    const { attributeEnd, attributeStart, eventName, tag } = eventAttribute;
    // SPEC §5.2: branch on the typed parser fact, not a regex over the raw attribute snippet, and
    // use the typed bare-identifier NAME (parenthesization-resistant) for the lowered export name
    // and the emitted call-through. The raw `expression` is reserved for diagnostic help text.
    const namedHandler = eventAttribute.expressionIsBareIdentifier === true;
    const namedHandlerName = eventAttribute.expressionBareIdentifierName;
    const expression =
      namedHandler && namedHandlerName !== undefined ? namedHandlerName : eventAttribute.expression;
    const params = namedHandler
      ? []
      : extractElementParams(
          eventAttribute.zeroArgArrow,
          eventAttribute.expressionPropertyAccesses,
          new Set(componentRenderInputs(model)),
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

    if (capturesUnserializableReferences(eventAttributeReferences(eventAttribute), model, params)) {
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
      ...clientConstantDependencies(
        model.moduleScopeBindings,
        handlerReferenceNames(eventAttribute),
      ),
      ...clientImportDependencies(model.namedImports, handlerReferenceNames(eventAttribute)),
      ...(primaryDiagnostic ? { diagnostic: primaryDiagnostic, diagnostics } : {}),
      expression,
      exportName,
      isBareNamedHandler: namedHandler,
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

function eventAttributeReferences(eventAttribute: {
  expressionReferences?: readonly string[];
  zeroArgArrow?: ZeroArgArrowModel;
}): readonly string[] {
  return eventAttribute.zeroArgArrow?.references ?? eventAttribute.expressionReferences ?? [];
}

function handlerReferenceNames(eventAttribute: {
  expressionReferences?: readonly string[];
  expressionIsBareIdentifier?: boolean;
  expressionBareIdentifierName?: string;
  zeroArgArrow?: ZeroArgArrowModel;
}): ReadonlySet<string> {
  return new Set([
    ...(eventAttribute.zeroArgArrow?.bodyReferences.map((reference) => reference.name) ?? []),
    ...(eventAttribute.expressionReferences ?? []),
    ...(eventAttribute.expressionIsBareIdentifier === true &&
    eventAttribute.expressionBareIdentifierName !== undefined
      ? [eventAttribute.expressionBareIdentifierName]
      : []),
  ]);
}

function clientImportDependencies(
  namedImports: readonly NamedImportModel[],
  references: ReadonlySet<string>,
): { clientImports: readonly ClientImportDependency[] } | {} {
  const clientImports = namedImports.filter((item) => references.has(item.localName));

  return clientImports.length > 0 ? { clientImports } : {};
}

function clientConstantDependencies(
  moduleScopeBindings: readonly ModuleScopeBindingModel[],
  references: ReadonlySet<string>,
): { clientConstants: readonly ClientConstantDependency[] } | {} {
  const clientConstants = moduleScopeBindings
    .filter((item) => references.has(item.name))
    .map((item) => ({
      name: item.name,
      source: item.source,
    }));

  return clientConstants.length > 0 ? { clientConstants } : {};
}

function eventAttributes(model: ComponentModuleModel): Array<{
  attributeEnd: number;
  attributeStart: number;
  eventName: string;
  expression: string;
  expressionIsBareIdentifier?: boolean;
  expressionBareIdentifierName?: string;
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
    expressionIsBareIdentifier?: boolean;
    expressionBareIdentifierName?: string;
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
        ...(attribute.expressionIsBareIdentifier === undefined
          ? {}
          : { expressionIsBareIdentifier: attribute.expressionIsBareIdentifier }),
        ...(attribute.expressionBareIdentifierName === undefined
          ? {}
          : { expressionBareIdentifierName: attribute.expressionBareIdentifierName }),
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

export function capturesUnserializableReferences(
  references: readonly string[],
  model?: ComponentModuleModel,
  params: readonly ElementParam[] = [],
): boolean {
  if (!model) {
    const referenceSet = new Set(references);
    return ['window', 'document', 'db', 'request', 'response', 'Date', 'Map', 'Set'].some((name) =>
      referenceSet.has(name),
    );
  }

  const allowed = new Set([
    'ctx',
    'event',
    'state',
    ...params.flatMap((param) => referenceRootsForElementParam(param)),
    ...(model?.namedImports.map((item) => item.localName) ?? []),
    ...(model?.moduleScopeBindings.map((item) => item.name) ?? []),
  ]);

  return references.some((name) => !allowed.has(name));
}

function referenceRootsForElementParam(param: ElementParam): string[] {
  const [root] = param.expression.split('.');
  return root ? [root] : [];
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

// SPEC §5.2: element-param eligibility is decided from typed per-argument kinds and the parsed
// reference/property-access facts, never by trimming or string-comparing the raw argument source.
function extractElementParams(
  zeroArgArrow?: ZeroArgArrowModel,
  parsedPropertyAccesses?: readonly PropertyAccessPathModel[],
  eligibleBareReferenceNames: ReadonlySet<string> = new Set(),
): ElementParam[] {
  const callArgumentKinds = zeroArgArrow?.callArgumentKinds;
  const localNames = new Set(zeroArgArrow?.bodyLocalNames ?? []);
  const candidates = callArgumentKinds
    ? callArgumentKinds.flatMap((kind, index) => {
        // 'empty'/'state'/'static' arguments never become element params (these typed kinds replace
        // the old `arg.length === 0`, `arg === 'state'`, and static-value source comparisons).
        if (kind === 'empty' || kind === 'state' || kind === 'static') return [];

        // Any remaining argument (a bare member, or an object/expression that embeds serializable
        // member accesses such as `{ id: item.id }`) contributes its parsed property accesses.
        const members =
          zeroArgArrow?.callArgumentPropertyAccesses?.[index]
            ?.filter((access) => serializableMemberExpression(access.path, localNames))
            .map(elementParamCandidateFromAccess) ?? [];
        if (members.length > 0) return members;

        // Otherwise, only a bare-identifier argument (`kind === 'reference'`) becomes a param, using
        // its parsed reference name. A nested call like `getQuantity()` is 'other' with no accesses
        // and is correctly dropped.
        if (kind === 'reference') {
          const reference = simpleCallArgumentReference(
            zeroArgArrow?.callArgumentReferences?.[index] ?? [],
          );
          return reference && eligibleBareReferenceNames.has(reference)
            ? [{ expression: reference, terminalName: reference }]
            : [];
        }

        return [];
      })
    : [
        ...serializableMemberExpressions(zeroArgArrow, parsedPropertyAccesses, localNames),
        ...serializableBareReferences(zeroArgArrow, eligibleBareReferenceNames, localNames),
      ];

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

// SPEC §5.2: a bare-reference call argument yields exactly one parsed identifier reference; use its
// typed name as the element-param expression instead of slicing the raw argument source.
function simpleCallArgumentReference(
  references: readonly IdentifierReferenceModel[],
): string | null {
  const [reference] = references;
  return reference && references.length === 1 ? reference.name : null;
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
  localNames: ReadonlySet<string> = new Set(),
): ElementParamCandidate[] {
  return collectSerializableMemberExpressions(zeroArgArrow, parsedPropertyAccesses)
    .filter((access) => serializableMemberExpression(access.path, localNames))
    .map(elementParamCandidateFromAccess);
}

function serializableBareReferences(
  zeroArgArrow: ZeroArgArrowModel | undefined,
  eligibleBareReferenceNames: ReadonlySet<string>,
  localNames: ReadonlySet<string>,
): ElementParamCandidate[] {
  return (zeroArgArrow?.bodyReferences ?? [])
    .filter(
      (reference) =>
        eligibleBareReferenceNames.has(reference.name) && !localNames.has(reference.name),
    )
    .map((reference) => ({
      expression: reference.name,
      terminalName: reference.name,
    }));
}

function serializableMemberExpression(
  member: string,
  localNames: ReadonlySet<string> = new Set(),
): boolean {
  const root = /^[A-Za-z_$][\w$]*/.exec(member)?.[0];
  return (
    (root === undefined || !localNames.has(root)) &&
    !member.startsWith('state.') &&
    !member.startsWith('ctx.') &&
    !member.startsWith('event.') &&
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
