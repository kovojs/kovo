import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { securityOperationDoorForKind } from '@kovojs/core/internal/security-operation-ir';
import { formatKovoModuleRef, kovoModuleRef } from '@kovojs/core/internal/module-ref';
import {
  clientModuleContentVersion,
  clientModuleHrefForSourceFile,
} from '@kovojs/core/internal/client-module-url';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import {
  compilerArrayAppend,
  compilerArrayJoin,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateSet,
  compilerDefineOwnDataProperty,
  compilerFailClosed,
  compilerFreeze,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerRegExpExec,
  compilerSetAdd,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerStringIndexOf,
  compilerStringReplaceAll,
  compilerStringSlice,
  compilerStringStartsWith,
} from '../compiler-security-intrinsics.js';
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
import type { BrowserSecurityOperationModel } from '../scan/model.js';
import { normalizeComponentFileName } from '../shared.js';
import { analyzeClientCaptures, type ClientCaptureAnalysis } from '../validate/client-capture.js';
import type {
  BrowserSecurityOperationFact,
  ClientImportDependency,
  ClientImportDependencyProvenance,
  ClientConstantDependency,
  CompileComponentOptions,
  ElementParam,
  ElementParamType,
  HandlerLowering,
} from '../types.js';
import {
  elementParamAttributeNameFromPath,
  elementParamAttributeNameFromPropertyName,
} from '../types.js';

export function lowerEventHandlers(
  options: CompileComponentOptions,
  componentName: string,
  model: ComponentModuleModel,
  clientCaptureAnalysis?: ClientCaptureAnalysis,
): HandlerLowering[] {
  const handlers: HandlerLowering[] = [];
  const anonymousNameCounts = compilerCreateMap<string, number>();
  // SPEC §6.6/§6.2 + secure-framework Phase 4 / Tier 0 item 3: fail-closed, whole-channel emit gate.
  // Re-emit a captured cross-module import only when it carries exact reviewed executable
  // provenance. `publishToClient` is deliberately not import authority: it can emit only a
  // compiler-proven same-file const primitive as literal data. Every closed handler is omitted
  // wholesale, so neither an unreviewed specifier nor an unbound body reaches browser artifacts.
  const analysis = clientCaptureAnalysis ?? analyzeClientCaptures(model);
  const emitAllowedImports = analysis.emitAllowed;
  const emitImportProvenance = analysis.emitImportProvenance;
  const emitAllowedModuleConstants = analysis.emitAllowedModuleConstants;

  const attributes = eventAttributes(model);
  const attributeLength = compilerArrayLength(attributes, 'Lowered event attributes');
  for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
    const eventAttribute = compilerOwnDataValue(
      attributes,
      attributeIndex,
      'Lowered event attributes',
    ) as (typeof attributes)[number] | undefined;
    if (!eventAttribute) {
      compilerFailClosed(`Lowered event attributes[${attributeIndex}] must be dense own data.`);
    }
    const { attributeEnd, attributeStart, eventName, tag } = eventAttribute;
    if (compilerSetHas(analysis.blockedHandlerAttributeStarts, attributeStart)) continue;
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
          compilerSetFromStrings(componentRenderInputs(model), 'Component render inputs'),
        );
    const exportName = namedHandler
      ? `${componentName}$${expression}`
      : uniqueAnonymousHandlerName(componentName, tag, eventName, anonymousNameCounts);

    const diagnostics: CompilerDiagnostic[] = [];
    if (!namedHandler) {
      appendHandlerFact(
        diagnostics,
        diagnosticFor(options.fileName, 'KV210', options.source, attributeStart, eventName.length),
        'Handler diagnostics',
      );
    }

    if (
      capturesUnserializableReferences(eventAttributeReferences(eventAttribute), {
        elementParams: params,
        model,
      })
    ) {
      appendHandlerFact(
        diagnostics,
        kv201Diagnostic(options.fileName, options.source, attributeStart, {
          attributeName: `on:${eventName}`,
          exportName,
          expression,
          params,
        }),
        'Handler diagnostics',
      );
    }

    const primaryDiagnostic = diagnostics[diagnostics.length - 1];
    appendHandlerFact(
      handlers,
      {
        attributeName: `on:${eventName}`,
        attributeEnd,
        attributeStart,
        attributeValue: formatKovoModuleRef(
          kovoModuleRef(clientModuleUrl(options.fileName), exportName, 'handler'),
        ),
        ...(eventAttribute.zeroArgArrow
          ? {
              arrowBody: {
                kind: eventAttribute.zeroArgArrow.bodyKind,
                propertyAccesses: loweredArrowPropertyAccesses(eventAttribute.zeroArgArrow),
                references: loweredArrowReferences(eventAttribute.zeroArgArrow),
                source: eventAttribute.zeroArgArrow.body,
                sourceStart: eventAttribute.zeroArgArrow.bodySourceStart,
              },
            }
          : {}),
        ...clientConstantDependencies(
          model.moduleScopeBindings,
          handlerReferenceNames(eventAttribute),
          emitAllowedModuleConstants,
        ),
        ...clientImportDependencies(
          model.namedImports,
          handlerReferenceNames(eventAttribute),
          emitAllowedImports,
          emitImportProvenance,
        ),
        ...(primaryDiagnostic ? { diagnostic: primaryDiagnostic, diagnostics } : {}),
        expression,
        exportName,
        isBareNamedHandler: namedHandler,
        params,
        securityOperations: loweredBrowserSecurityOperations(
          eventAttribute.zeroArgArrow,
          namedHandler ? expression : undefined,
        ),
      },
      'Lowered event handlers',
    );
  }

  return handlers;
}

function loweredBrowserSecurityOperations(
  arrow: ZeroArgArrowModel | undefined,
  namedHandler: string | undefined,
): BrowserSecurityOperationFact[] {
  if (namedHandler !== undefined) {
    const kind = 'browser.framework.call' as const;
    return [
      {
        door: securityOperationDoorForKind(kind),
        kind,
        target: namedHandler,
      },
    ];
  }
  const source = arrow?.securityOperations;
  if (source === undefined) return [];
  const result: BrowserSecurityOperationFact[] = [];
  const length = compilerArrayLength(source, 'Lowered browser security operations');
  for (let index = 0; index < length; index += 1) {
    const operation = compilerOwnDataValue(source, index, 'Lowered browser security operations') as
      | BrowserSecurityOperationModel
      | undefined;
    if (!operation) {
      compilerFailClosed(`Lowered browser security operations[${index}] must be dense own data.`);
    }
    appendHandlerFact(
      result,
      {
        door: operation.door,
        kind: operation.kind,
        ...(operation.target === undefined ? {} : { target: operation.target }),
      },
      'Lowered browser security operations',
    );
  }
  return result;
}

function loweredArrowPropertyAccesses(
  arrow: ZeroArgArrowModel,
): Array<{ end: number; path: string; start: number }> {
  const result: Array<{ end: number; path: string; start: number }> = [];
  const length = compilerArrayLength(arrow.bodyPropertyAccesses, 'Handler arrow property accesses');
  for (let index = 0; index < length; index += 1) {
    const access = compilerOwnDataValue(
      arrow.bodyPropertyAccesses,
      index,
      'Handler arrow property accesses',
    ) as PropertyAccessPathModel | undefined;
    if (!access) compilerFailClosed(`Handler arrow property accesses[${index}] must be dense.`);
    appendHandlerFact(
      result,
      {
        end: access.end - arrow.bodySourceStart,
        path: access.path,
        start: access.start - arrow.bodySourceStart,
      },
      'Handler arrow property accesses',
    );
  }
  return result;
}

function loweredArrowReferences(
  arrow: ZeroArgArrowModel,
): Array<{ end: number; name: string; start: number }> {
  const result: Array<{ end: number; name: string; start: number }> = [];
  const length = compilerArrayLength(arrow.bodyReferences, 'Handler arrow references');
  for (let index = 0; index < length; index += 1) {
    const reference = compilerOwnDataValue(
      arrow.bodyReferences,
      index,
      'Handler arrow references',
    ) as IdentifierReferenceModel | undefined;
    if (!reference) compilerFailClosed(`Handler arrow references[${index}] must be dense.`);
    appendHandlerFact(
      result,
      {
        end: reference.end - arrow.bodySourceStart,
        name: reference.name,
        start: reference.start - arrow.bodySourceStart,
      },
      'Handler arrow references',
    );
  }
  return result;
}

export function versionHandlerLowering(
  handler: HandlerLowering,
  fileName: string,
  clientHref: string,
): HandlerLowering {
  const unversionedHref = clientModuleUrl(fileName);
  const unversionedAttributeValue = formatKovoModuleRef(
    kovoModuleRef(unversionedHref, handler.exportName, 'handler'),
  );
  const versionedAttributeValue = formatKovoModuleRef(
    kovoModuleRef(clientHref, handler.exportName, 'handler'),
  );
  return {
    ...handler,
    attributeValue: versionedAttributeValue,
    ...(handler.diagnostics
      ? {
          diagnostics: versionHandlerDiagnostics(
            handler.diagnostics,
            unversionedAttributeValue,
            versionedAttributeValue,
          ),
        }
      : {}),
    ...(handler.diagnostic
      ? {
          diagnostic: {
            ...handler.diagnostic,
            ...(handler.diagnostic.help
              ? {
                  help: compilerStringReplaceAll(
                    handler.diagnostic.help,
                    unversionedAttributeValue,
                    versionedAttributeValue,
                  ),
                }
              : {}),
          },
        }
      : {}),
  };
}

function versionHandlerDiagnostics(
  diagnostics: readonly CompilerDiagnostic[],
  unversionedAttributeValue: string,
  versionedAttributeValue: string,
): CompilerDiagnostic[] {
  const source = compilerSnapshotDenseArray(diagnostics, 'Handler lowering diagnostics');
  const result: CompilerDiagnostic[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const diagnostic = source[index]!;
    appendHandlerFact(
      result,
      diagnostic.help
        ? {
            ...diagnostic,
            help: compilerStringReplaceAll(
              diagnostic.help,
              unversionedAttributeValue,
              versionedAttributeValue,
            ),
          }
        : diagnostic,
      'Handler lowering diagnostics',
    );
  }
  return result;
}

export function clientModuleUrl(fileName: string, version?: string): string {
  return clientModuleHrefForSourceFile(normalizeComponentFileName(fileName), version);
}

export function clientModuleVersion(source: string): string {
  return clientModuleContentVersion(source);
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
  const result = compilerCreateSet<string>();
  const bodyReferences = eventAttribute.zeroArgArrow?.bodyReferences ?? [];
  const bodyReferenceLength = compilerArrayLength(bodyReferences, 'Handler body references');
  for (let index = 0; index < bodyReferenceLength; index += 1) {
    const reference = compilerOwnDataValue(bodyReferences, index, 'Handler body references') as
      | IdentifierReferenceModel
      | undefined;
    if (!reference) compilerFailClosed(`Handler body references[${index}] must be own data.`);
    compilerSetAdd(result, reference.name);
  }
  const expressionReferences = eventAttribute.expressionReferences ?? [];
  const expressionReferenceLength = compilerArrayLength(
    expressionReferences,
    'Handler expression references',
  );
  for (let index = 0; index < expressionReferenceLength; index += 1) {
    const name = compilerOwnDataValue(expressionReferences, index, 'Handler expression references');
    if (typeof name !== 'string') {
      compilerFailClosed(`Handler expression references[${index}] must be an own string.`);
    }
    compilerSetAdd(result, name);
  }
  if (
    eventAttribute.expressionIsBareIdentifier === true &&
    eventAttribute.expressionBareIdentifierName !== undefined
  ) {
    compilerSetAdd(result, eventAttribute.expressionBareIdentifierName);
  }
  return result;
}

function clientImportDependencies(
  namedImports: readonly NamedImportModel[],
  references: ReadonlySet<string>,
  emitAllowedImports: ReadonlySet<string>,
  emitImportProvenance: ReadonlyMap<string, ClientImportDependencyProvenance>,
): { clientImports: readonly ClientImportDependency[] } | {} {
  // Fail-closed: a referenced named import is re-emitted ONLY when the whole-channel capture analysis
  // proved it carries an exact reviewed executable identity. A captured binding
  // (`() => sendPayment(STRIPE_SECRET_KEY)`) is value-position, so it is excluded from
  // `emitAllowedImports` and its `import { STRIPE_SECRET_KEY } from "…"` line is never written into
  // `*.client.js` — the bundler can no longer inline the evaluated secret. (KV437 from
  // validate/client-capture.ts.)
  const clientImports: ClientImportDependency[] = [];
  const length = compilerArrayLength(namedImports, 'Client handler named imports');
  for (let index = 0; index < length; index += 1) {
    const item = compilerOwnDataValue(namedImports, index, 'Client handler named imports') as
      | NamedImportModel
      | undefined;
    if (!item) compilerFailClosed(`Client handler named imports[${index}] must be own data.`);
    if (
      compilerSetHas(references, item.localName) &&
      compilerSetHas(emitAllowedImports, item.localName)
    ) {
      const provenance = compilerMapGet(
        emitImportProvenance as Map<string, ClientImportDependencyProvenance>,
        item.localName,
      );
      if (provenance === undefined) {
        compilerFailClosed(
          `Client handler import ${item.localName} was allowed without immutable provenance.`,
        );
      }
      appendHandlerFact(
        clientImports,
        compilerFreeze({
          importedName: item.importedName,
          localName: item.localName,
          moduleSpecifier: item.moduleSpecifier,
          provenance,
        }),
        'Client handler imports',
      );
    }
  }

  return clientImports.length > 0 ? { clientImports } : {};
}

function clientConstantDependencies(
  moduleScopeBindings: readonly ModuleScopeBindingModel[],
  references: ReadonlySet<string>,
  emitAllowedModuleConstants: ReadonlySet<string>,
): { clientConstants: readonly ClientConstantDependency[] } | {} {
  const clientConstants: ClientConstantDependency[] = [];
  const length = compilerArrayLength(moduleScopeBindings, 'Client handler module constants');
  for (let index = 0; index < length; index += 1) {
    const item = compilerOwnDataValue(
      moduleScopeBindings,
      index,
      'Client handler module constants',
    ) as ModuleScopeBindingModel | undefined;
    if (!item) compilerFailClosed(`Client handler module constants[${index}] must be own data.`);
    if (
      !compilerSetHas(references, item.name) ||
      !compilerSetHas(emitAllowedModuleConstants, item.name)
    ) {
      continue;
    }
    appendHandlerFact(
      clientConstants,
      {
        name: item.name,
        source: item.source,
      },
      'Client handler constants',
    );
  }

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

  const elements = jsxElements(model);
  const elementLength = compilerArrayLength(elements, 'Handler JSX elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(elements, elementIndex, 'Handler JSX elements') as
      | (typeof elements)[number]
      | undefined;
    if (!element) compilerFailClosed(`Handler JSX elements[${elementIndex}] must be own data.`);
    const attributeLength = compilerArrayLength(element.attributes, 'Handler JSX attributes');
    for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
      const attribute = compilerOwnDataValue(
        element.attributes,
        attributeIndex,
        'Handler JSX attributes',
      ) as (typeof element.attributes)[number] | undefined;
      if (!attribute) {
        compilerFailClosed(`Handler JSX attributes[${attributeIndex}] must be own data.`);
      }
      const eventName = attribute.domEventName;
      // SPEC §5.2: a DOM-style event on an unresolved component tag is a callback prop, not a
      // host event. The parser-owned fact keeps lowering from turning that closure into a client
      // module; validate/component-event-props.ts emits the matching teaching error.
      if (
        !eventName ||
        attribute.expression === undefined ||
        attribute.componentEventProp === true
      ) {
        continue;
      }
      appendHandlerFact(
        attributes,
        {
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
        },
        'Handler event attributes',
      );
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
  const count = (compilerMapGet(counts, base) ?? 0) + 1;
  compilerMapSet(counts, base, count);

  return count === 1 ? base : `${base}_${count}`;
}

interface CaptureReferenceContext {
  additionalAllowedReferences?: readonly string[];
  elementParams?: readonly ElementParam[];
  model: ComponentModuleModel;
}

export function capturesUnserializableReferences(
  references: readonly string[],
  context: CaptureReferenceContext,
): boolean {
  const allowed = compilerCreateSet<string>();
  appendAllowedStrings(allowed, SAFE_HANDLER_GLOBAL_REFERENCES, 'Safe handler globals');
  appendAllowedStrings(
    allowed,
    ['clearTimeout', 'ctx', 'event', 'setTimeout', 'state', 'undefined'],
    'Framework handler globals',
  );
  appendAllowedStrings(
    allowed,
    context.additionalAllowedReferences ?? [],
    'Additional handler references',
  );

  const elementParams = context.elementParams ?? [];
  const elementParamLength = compilerArrayLength(elementParams, 'Handler element params');
  for (let index = 0; index < elementParamLength; index += 1) {
    const param = compilerOwnDataValue(elementParams, index, 'Handler element params') as
      | ElementParam
      | undefined;
    if (!param) compilerFailClosed(`Handler element params[${index}] must be dense.`);
    const root = referenceRootForElementParam(param);
    if (root !== null) compilerSetAdd(allowed, root);
  }

  const namedImports = context.model.namedImports;
  const namedImportLength = compilerArrayLength(namedImports, 'Handler named imports');
  for (let index = 0; index < namedImportLength; index += 1) {
    const item = compilerOwnDataValue(namedImports, index, 'Handler named imports') as
      | NamedImportModel
      | undefined;
    if (!item || typeof item.localName !== 'string') {
      compilerFailClosed(`Handler named imports[${index}] must have a local name.`);
    }
    compilerSetAdd(allowed, item.localName);
  }

  const bindings = context.model.moduleScopeBindings;
  const bindingLength = compilerArrayLength(bindings, 'Handler module-scope bindings');
  for (let index = 0; index < bindingLength; index += 1) {
    const item = compilerOwnDataValue(bindings, index, 'Handler module-scope bindings') as
      | ModuleScopeBindingModel
      | undefined;
    if (!item || typeof item.name !== 'string') {
      compilerFailClosed(`Handler module-scope bindings[${index}] must have a name.`);
    }
    compilerSetAdd(allowed, item.name);
  }

  const referenceLength = compilerArrayLength(references, 'Handler capture references');
  for (let index = 0; index < referenceLength; index += 1) {
    const name = compilerOwnDataValue(references, index, 'Handler capture references');
    if (typeof name !== 'string') {
      compilerFailClosed(`Handler capture references[${index}] must be a string.`);
    }
    if (!compilerSetHas(allowed, name)) return true;
  }
  return false;
}

const SAFE_HANDLER_GLOBAL_REFERENCES = [
  'Array',
  'BigInt',
  'Boolean',
  'JSON',
  'Math',
  'Number',
  'Object',
  'Promise',
  'Set',
  'String',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',
] as const;

const SAFE_HANDLER_GLOBAL_REFERENCE_SET = compilerSetFromStrings(
  SAFE_HANDLER_GLOBAL_REFERENCES,
  'Safe handler globals',
);

function referenceRootForElementParam(param: ElementParam): string | null {
  const expression = compilerOwnDataValue(param, 'expression', 'Handler element param');
  if (typeof expression !== 'string') {
    compilerFailClosed('Handler element param.expression must be a string.');
  }
  const separator = compilerStringIndexOf(expression, '.');
  const root = separator < 0 ? expression : compilerStringSlice(expression, 0, separator);
  return root.length > 0 ? root : null;
}

function appendAllowedStrings(target: Set<string>, values: readonly string[], label: string): void {
  const length = compilerArrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    const value = compilerOwnDataValue(values, index, label);
    if (typeof value !== 'string') compilerFailClosed(`${label}[${index}] must be a string.`);
    compilerSetAdd(target, value);
  }
}

function compilerSetFromStrings(values: readonly string[], label: string): Set<string> {
  const result = compilerCreateSet<string>();
  appendAllowedStrings(result, values, label);
  return result;
}

interface ElementParamCandidate {
  expression: string;
  terminalName: string;
  type?: ElementParamType;
}

function kv201Diagnostic(
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
  const definition = diagnosticDefinitions.KV201;
  const labels = definition.detailLabels;
  const handlerRef = formatKovoModuleRef(
    kovoModuleRef(clientModuleUrl(fileName), lowering.exportName, 'handler'),
  );
  const elementParamNames: string[] = [];
  const paramLength = compilerArrayLength(lowering.params, 'KV201 element params');
  for (let index = 0; index < paramLength; index += 1) {
    const param = compilerOwnDataValue(lowering.params, index, 'KV201 element params') as
      | ElementParam
      | undefined;
    if (!param) compilerFailClosed(`KV201 element params[${index}] must be dense own data.`);
    compilerArrayAppend(
      elementParamNames,
      param.attributeName,
      'KV201 element-param attribute names',
    );
  }
  return {
    ...diagnosticFor(fileName, 'KV201', source, offset, lowering.attributeName.length),
    help: compilerArrayJoin(
      [
        `${labels.handlerLowering} ${lowering.attributeName}="${handlerRef}"`,
        `${labels.blockedExpression} ${lowering.expression}`,
        `${labels.elementParams} ${compilerArrayJoin(elementParamNames, ', ') || '-'}`,
        definition.help ?? '',
      ],
      '\n',
    ),
  };
}

// SPEC §5.2: element-param eligibility is decided from typed per-argument kinds and the parsed
// reference/property-access facts, never by trimming or string-comparing the raw argument source.
function extractElementParams(
  zeroArgArrow?: ZeroArgArrowModel,
  parsedPropertyAccesses?: readonly PropertyAccessPathModel[],
  eligibleBareReferenceNames: ReadonlySet<string> = compilerCreateSet(),
): ElementParam[] {
  const callArgumentKinds = zeroArgArrow?.callArgumentKinds;
  const localNames = compilerSetFromStrings(
    zeroArgArrow?.bodyLocalNames ?? [],
    'Handler body local names',
  );
  const candidates: ElementParamCandidate[] = [];
  if (callArgumentKinds) {
    const kindLength = compilerArrayLength(callArgumentKinds, 'Handler call argument kinds');
    for (let index = 0; index < kindLength; index += 1) {
      const kind = compilerOwnDataValue(callArgumentKinds, index, 'Handler call argument kinds');
      // 'empty'/'state'/'static' arguments never become element params (these typed kinds replace
      // the old `arg.length === 0`, `arg === 'state'`, and static-value source comparisons).
      if (kind === 'empty' || kind === 'state' || kind === 'static') continue;

      // Any remaining argument (a bare member, or an object/expression that embeds serializable
      // member accesses such as `{ id: item.id }`) contributes its parsed property accesses.
      const propertyAccessGroups = zeroArgArrow?.callArgumentPropertyAccesses;
      const propertyAccesses = propertyAccessGroups
        ? (compilerOwnDataValue(
            propertyAccessGroups,
            index,
            'Handler call argument property-access groups',
          ) as readonly PropertyAccessPathModel[] | undefined)
        : undefined;
      const candidateCountBefore = candidates.length;
      if (propertyAccesses) {
        const accessLength = compilerArrayLength(
          propertyAccesses,
          'Handler call argument property accesses',
        );
        for (let accessIndex = 0; accessIndex < accessLength; accessIndex += 1) {
          const access = compilerOwnDataValue(
            propertyAccesses,
            accessIndex,
            'Handler call argument property accesses',
          ) as PropertyAccessPathModel | undefined;
          if (!access) {
            compilerFailClosed(
              `Handler call argument property accesses[${accessIndex}] must be dense.`,
            );
          }
          if (serializableMemberExpression(access.path, localNames)) {
            appendHandlerFact(
              candidates,
              elementParamCandidateFromAccess(access),
              'Handler element-param candidates',
            );
          }
        }
      }
      if (candidates.length > candidateCountBefore) continue;

      // Otherwise, only a bare-identifier argument (`kind === 'reference'`) becomes a param, using
      // its parsed reference name. A nested call like `getQuantity()` is 'other' with no accesses
      // and is correctly dropped.
      if (kind === 'reference') {
        const referenceGroups = zeroArgArrow?.callArgumentReferences;
        const references = referenceGroups
          ? (compilerOwnDataValue(
              referenceGroups,
              index,
              'Handler call argument reference groups',
            ) as readonly IdentifierReferenceModel[] | undefined)
          : undefined;
        const reference = simpleCallArgumentReference(references ?? []);
        if (reference && compilerSetHas(eligibleBareReferenceNames, reference)) {
          appendHandlerFact(
            candidates,
            { expression: reference, terminalName: reference },
            'Handler element-param candidates',
          );
        }
      }
    }
  } else {
    appendElementParamCandidates(
      candidates,
      serializableMemberExpressions(zeroArgArrow, parsedPropertyAccesses, localNames),
    );
    appendElementParamCandidates(
      candidates,
      serializableBareReferences(zeroArgArrow, eligibleBareReferenceNames, localNames),
    );
  }

  const assigned = assignElementParamAttributeNames(dedupeElementParamCandidates(candidates));
  const params: ElementParam[] = [];
  for (let index = 0; index < assigned.length; index += 1) {
    const { attributeName, candidate } = assigned[index]!;
    appendHandlerFact(
      params,
      {
        attributeName,
        expression: candidate.expression,
        type:
          candidate.type ??
          inferElementParamType(candidate.expression, zeroArgArrow, parsedPropertyAccesses),
        value: `{${candidate.expression}}`,
      },
      'Handler element parameters',
    );
  }
  return params;
}

function appendElementParamCandidates(
  target: ElementParamCandidate[],
  values: readonly ElementParamCandidate[],
): void {
  const length = compilerArrayLength(values, 'Handler element-param candidates');
  for (let index = 0; index < length; index += 1) {
    const value = compilerOwnDataValue(values, index, 'Handler element-param candidates') as
      | ElementParamCandidate
      | undefined;
    if (!value) compilerFailClosed(`Handler element-param candidates[${index}] must be dense.`);
    appendHandlerFact(target, value, 'Handler element-param candidates');
  }
}

// SPEC §4.3 / §4.6 (KV231): assign each distinct member expression its OWN `data-p-*` attribute
// name. The default name comes from the terminal property; when two distinct expressions share a
// terminal (`item.id` vs `item.parent.id` → both `data-p-id`), the collision is resolved by deriving
// a path-based name (`data-p-parent-id`), with a numeric suffix as a last-resort tiebreaker. Candidates
// are already deduped by expression, so identical members still collapse to a single param/slot.
function assignElementParamAttributeNames(
  candidates: readonly ElementParamCandidate[],
): Array<{ attributeName: string; candidate: ElementParamCandidate }> {
  const used = compilerCreateSet<string>();
  const result: Array<{ attributeName: string; candidate: ElementParamCandidate }> = [];
  const length = compilerArrayLength(candidates, 'Handler element-param candidates');
  for (let index = 0; index < length; index += 1) {
    const candidate = compilerOwnDataValue(
      candidates,
      index,
      'Handler element-param candidates',
    ) as ElementParamCandidate | undefined;
    if (!candidate) {
      compilerFailClosed(`Handler element-param candidates[${index}] must be dense.`);
    }
    const preferred = elementParamAttributeNameFromPropertyName(candidate.terminalName);
    let attributeName = preferred;
    if (compilerSetHas(used, attributeName)) {
      attributeName = elementParamAttributeNameFromPath(candidate.expression);
    }
    if (compilerSetHas(used, attributeName)) {
      let suffix = 2;
      while (compilerSetHas(used, `${preferred}-${suffix}`)) suffix += 1;
      attributeName = `${preferred}-${suffix}`;
    }
    compilerSetAdd(used, attributeName);
    appendHandlerFact(result, { attributeName, candidate }, 'Assigned handler element params');
  }
  return result;
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
  const length = compilerArrayLength(references, 'Handler call argument references');
  if (length !== 1) return null;
  const reference = compilerOwnDataValue(references, 0, 'Handler call argument references') as
    | IdentifierReferenceModel
    | undefined;
  return reference && typeof reference.name === 'string' ? reference.name : null;
}

function inferElementParamType(
  sourceExpression: string,
  zeroArgArrow?: ZeroArgArrowModel,
  parsedPropertyAccesses?: readonly PropertyAccessPathModel[],
): ElementParamType {
  const propertyAccesses = zeroArgArrow?.bodyPropertyAccesses ?? parsedPropertyAccesses ?? [];
  const length = compilerArrayLength(propertyAccesses, 'Handler property accesses');
  for (let index = 0; index < length; index += 1) {
    const access = compilerOwnDataValue(propertyAccesses, index, 'Handler property accesses') as
      | PropertyAccessPathModel
      | undefined;
    if (!access) compilerFailClosed(`Handler property accesses[${index}] must be dense.`);
    if (access.path === sourceExpression && access.inferredType !== undefined) {
      return access.inferredType;
    }
  }

  return 'string';
}

function serializableMemberExpressions(
  zeroArgArrow?: ZeroArgArrowModel,
  parsedPropertyAccesses?: readonly PropertyAccessPathModel[],
  localNames: ReadonlySet<string> = compilerCreateSet(),
): ElementParamCandidate[] {
  const accesses = collectSerializableMemberExpressions(zeroArgArrow, parsedPropertyAccesses);
  const result: ElementParamCandidate[] = [];
  const length = compilerArrayLength(accesses, 'Serializable handler member expressions');
  for (let index = 0; index < length; index += 1) {
    const access = compilerOwnDataValue(
      accesses,
      index,
      'Serializable handler member expressions',
    ) as PropertyAccessPathModel | undefined;
    if (!access) {
      compilerFailClosed(`Serializable handler member expressions[${index}] must be dense.`);
    }
    if (serializableMemberExpression(access.path, localNames)) {
      appendHandlerFact(
        result,
        elementParamCandidateFromAccess(access),
        'Serializable handler member expressions',
      );
    }
  }
  return result;
}

function serializableBareReferences(
  zeroArgArrow: ZeroArgArrowModel | undefined,
  eligibleBareReferenceNames: ReadonlySet<string>,
  localNames: ReadonlySet<string>,
): ElementParamCandidate[] {
  const references = zeroArgArrow?.bodyReferences ?? [];
  const result: ElementParamCandidate[] = [];
  const length = compilerArrayLength(references, 'Serializable handler bare references');
  for (let index = 0; index < length; index += 1) {
    const reference = compilerOwnDataValue(
      references,
      index,
      'Serializable handler bare references',
    ) as IdentifierReferenceModel | undefined;
    if (!reference) {
      compilerFailClosed(`Serializable handler bare references[${index}] must be dense.`);
    }
    if (
      compilerSetHas(eligibleBareReferenceNames, reference.name) &&
      !compilerSetHas(localNames, reference.name)
    ) {
      appendHandlerFact(
        result,
        {
          expression: reference.name,
          terminalName: reference.name,
        },
        'Serializable handler bare references',
      );
    }
  }
  return result;
}

function serializableMemberExpression(
  member: string,
  localNames: ReadonlySet<string> = compilerCreateSet(),
): boolean {
  const root = compilerRegExpExec(/^[A-Za-z_$][\w$]*/, member)?.[0];
  if (root && compilerSetHas(SAFE_HANDLER_GLOBAL_REFERENCE_SET, root)) return false;
  return (
    (root === undefined || !compilerSetHas(localNames, root)) &&
    !compilerStringStartsWith(member, 'state.') &&
    !compilerStringStartsWith(member, 'ctx.') &&
    !compilerStringStartsWith(member, 'event.') &&
    !compilerStringStartsWith(member, 'document.') &&
    !compilerStringStartsWith(member, 'window.')
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
  const seen = compilerCreateSet<string>();
  const result: ElementParamCandidate[] = [];
  const length = compilerArrayLength(values, 'Handler element-param candidates');
  for (let index = 0; index < length; index += 1) {
    const value = compilerOwnDataValue(values, index, 'Handler element-param candidates') as
      | ElementParamCandidate
      | undefined;
    if (!value) compilerFailClosed(`Handler element-param candidates[${index}] must be dense.`);
    if (compilerSetHas(seen, value.expression)) continue;
    compilerSetAdd(seen, value.expression);
    appendHandlerFact(result, value, 'Deduped handler element params');
  }
  return result;
}

function appendHandlerFact<Value>(target: Value[], value: Value, label: string): void {
  compilerDefineOwnDataProperty(target, compilerArrayLength(target, label), value);
}
