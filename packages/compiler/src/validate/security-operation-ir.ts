import {
  isBrowserSecurityOperationKind,
  isServerSecurityOperationKind,
  securityOperationDoorForKind,
  securityOperationNeedsJustification,
} from '@kovojs/core/internal/security-operation-ir';
import { securityClassifier } from '@kovojs/core/internal/security-markers';

import { diagnosticAt, type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';
import {
  kovoExecutableReferenceAttributeKind,
  type KovoExecutableReferenceAttributeKind,
} from '../executable-reference-attributes.js';
import {
  compilerArrayAppend,
  compilerArrayLength,
  compilerCreateSet,
  compilerFailClosed,
  compilerOwnDataValue,
  compilerSetAdd,
  compilerSetHas,
  compilerStringTrim,
} from '../compiler-security-intrinsics.js';
import { jsxElements, type ComponentModuleModel } from '../scan/parse.js';
import type {
  BrowserSecurityOperationModel,
  AgentDefinitionModel,
  AgentToolModel,
  CallExpressionModel,
  JsxAttributeModel,
  JsxElementModel,
  JsxSpreadAttributeModel,
  MutationHandlerModel,
  ObjectLiteralEntry,
  SecurityOperationViolationModel,
  ServerSecurityOperationModel,
  SourceSpan,
  StaticJsxWireAttributeEntry,
} from '../scan/model.js';
import { analyzeClientCaptures } from './client-capture.js';
import { agentMutationBindings } from '../agent-tool-facts.js';

/**
 * SPEC §4.3/§5.2 finite browser effect boundary. Authored handler source may compute ordinary
 * values, but every security-relevant effect has to scan to an exact compiler-owned operation.
 */
export const validateFiniteBrowserSecurityOperations = securityClassifier(
  'compiler.security-operation-ir.validate-browser',
  function (diagnostics: DiagnosticFactory, model: ComponentModuleModel): CompilerDiagnostic[] {
    const found: CompilerDiagnostic[] = [];
    const analysis = analyzeClientCaptures(model);
    const elements = jsxElements(model);
    const elementLength = compilerArrayLength(elements, 'Security-IR JSX elements');
    for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
      const element = compilerOwnDataValue(elements, elementIndex, 'Security-IR JSX elements') as
        | JsxElementModel
        | undefined;
      if (!element) compilerFailClosed(`Security-IR JSX elements[${elementIndex}] must be dense.`);
      appendRuntimeSelectedExecutableReferenceDiagnostics(found, diagnostics, element);
      const attributeLength = compilerArrayLength(element.attributes, 'Security-IR JSX attributes');
      for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
        const attribute = compilerOwnDataValue(
          element.attributes,
          attributeIndex,
          'Security-IR JSX attributes',
        ) as JsxAttributeModel | undefined;
        if (!attribute) {
          compilerFailClosed(`Security-IR JSX attributes[${attributeIndex}] must be dense.`);
        }
        if (
          attribute.domEventName === undefined ||
          attribute.componentEventProp === true ||
          attribute.expression === undefined
        ) {
          continue;
        }

        if (attribute.expressionIsBareIdentifier === true) {
          const name = attribute.expressionBareIdentifierName;
          if (name === undefined || !compilerSetHas(analysis.emitAllowed, name)) {
            appendFiniteIrDiagnostic(
              found,
              diagnostics,
              { end: attribute.end, start: attribute.start },
              `browser handler call ${name ?? '<unknown>'} is not an exact reviewed client export.`,
            );
          }
          continue;
        }

        const arrow = attribute.zeroArgArrow;
        if (!arrow) {
          appendFiniteIrDiagnostic(
            found,
            diagnostics,
            { end: attribute.end, start: attribute.start },
            'browser handler expression is not a lowerable zero-argument arrow.',
          );
          continue;
        }
        appendBrowserViolations(
          found,
          diagnostics,
          arrow.securityOperationViolations,
          `serialized-browser-handler:${attribute.name}@${attribute.start}`,
        );
        const operations = arrow.securityOperations;
        if (operations === undefined) continue;
        const operationLength = compilerArrayLength(operations, 'Browser security-IR operations');
        for (let operationIndex = 0; operationIndex < operationLength; operationIndex += 1) {
          const operation = compilerOwnDataValue(
            operations,
            operationIndex,
            'Browser security-IR operations',
          ) as BrowserSecurityOperationModel | undefined;
          if (!operation) {
            compilerFailClosed(
              `Browser security-IR operations[${operationIndex}] must be dense own data.`,
            );
          }
          if (
            !isBrowserSecurityOperationKind(operation.kind) ||
            operation.door !== securityOperationDoorForKind(operation.kind)
          ) {
            appendFiniteIrDiagnostic(
              found,
              diagnostics,
              operation.span,
              `browser operation ${operation.kind} has an invalid door.`,
            );
            continue;
          }
          if (
            operation.kind === 'browser.framework.call' &&
            (operation.target === undefined ||
              !compilerSetHas(analysis.emitAllowed, operation.target))
          ) {
            appendFiniteIrDiagnostic(
              found,
              diagnostics,
              operation.span,
              `browser call ${operation.target ?? '<computed>'} is not an exact reviewed client export.`,
            );
          }
        }
      }
    }
    return found;
  },
);

/**
 * SPEC §4.3/§4.8/§5.2/§6.6: handler, derive, stream-renderer, and client-module allowlist
 * attributes select executable authority; they are not ordinary rendered data. Compiler and
 * headless-primitive references are exact static strings. A request/query-derived value could
 * otherwise replay or swap to a sibling export in an already allowlisted client module, or widen
 * the module allowlist itself, bypassing the exact source root reviewed during compilation.
 */
function appendRuntimeSelectedExecutableReferenceDiagnostics(
  found: CompilerDiagnostic[],
  diagnostics: DiagnosticFactory,
  element: JsxElementModel,
): void {
  const attributeLength = compilerArrayLength(
    element.attributes,
    'Runtime-selected executable-ref JSX attributes',
  );
  for (let index = 0; index < attributeLength; index += 1) {
    const attribute = compilerOwnDataValue(
      element.attributes,
      index,
      'Runtime-selected executable-ref JSX attributes',
    ) as JsxAttributeModel | undefined;
    if (!attribute) {
      compilerFailClosed(`Runtime-selected executable-ref JSX attributes[${index}] must be dense.`);
    }
    const kind = kovoExecutableReferenceAttributeKind(attribute.name);
    if (
      kind === undefined ||
      attribute.expression === undefined ||
      attribute.expressionStaticValue !== undefined
    ) {
      continue;
    }
    appendRuntimeSelectedExecutableReferenceDiagnostic(
      found,
      diagnostics,
      attribute.name,
      kind,
      attribute,
    );
  }

  const spreadLength = compilerArrayLength(
    element.spreadAttributes,
    'Runtime-selected executable-ref JSX spreads',
  );
  for (let index = 0; index < spreadLength; index += 1) {
    const spread = compilerOwnDataValue(
      element.spreadAttributes,
      index,
      'Runtime-selected executable-ref JSX spreads',
    ) as JsxSpreadAttributeModel | undefined;
    if (!spread) {
      compilerFailClosed(`Runtime-selected executable-ref JSX spreads[${index}] must be dense.`);
    }
    if (spread.staticWireAttributeEntries !== undefined) {
      appendRuntimeSelectedStaticWireSpreadDiagnostics(found, diagnostics, spread);
      continue;
    }
    if (spread.objectEntries !== undefined) {
      appendRuntimeSelectedLegacySpreadDiagnostics(found, diagnostics, spread);
    }
    // An unresolved dynamic spread is reconstructed through kovoSafeJsxSpread(), whose runtime
    // control-attribute census strips every ASCII-case executable-selector spelling before JSX
    // serialization.
  }
}

function appendRuntimeSelectedStaticWireSpreadDiagnostics(
  found: CompilerDiagnostic[],
  diagnostics: DiagnosticFactory,
  spread: JsxSpreadAttributeModel,
): void {
  const entries = spread.staticWireAttributeEntries;
  if (entries === undefined) return;
  const length = compilerArrayLength(entries, 'Static executable-ref wire spread entries');
  for (let index = 0; index < length; index += 1) {
    const entry = compilerOwnDataValue(
      entries,
      index,
      'Static executable-ref wire spread entries',
    ) as StaticJsxWireAttributeEntry | undefined;
    if (!entry) {
      compilerFailClosed(`Static executable-ref wire spread entries[${index}] must be dense.`);
    }
    const kind = kovoExecutableReferenceAttributeKind(entry.key);
    if (kind === undefined || entry.value.kind !== 'unknown') {
      continue;
    }
    appendRuntimeSelectedExecutableReferenceDiagnostic(found, diagnostics, entry.key, kind, spread);
  }
}

function appendRuntimeSelectedLegacySpreadDiagnostics(
  found: CompilerDiagnostic[],
  diagnostics: DiagnosticFactory,
  spread: JsxSpreadAttributeModel,
): void {
  const entries = spread.objectEntries;
  if (entries === undefined) return;
  const length = compilerArrayLength(entries, 'Legacy executable-ref spread entries');
  for (let index = 0; index < length; index += 1) {
    const entry = compilerOwnDataValue(entries, index, 'Legacy executable-ref spread entries') as
      | ObjectLiteralEntry
      | undefined;
    if (!entry) {
      compilerFailClosed(`Legacy executable-ref spread entries[${index}] must be dense.`);
    }
    const kind = kovoExecutableReferenceAttributeKind(entry.key);
    if (kind === undefined || entry.staticStringValue !== undefined) {
      continue;
    }
    appendRuntimeSelectedExecutableReferenceDiagnostic(found, diagnostics, entry.key, kind, spread);
  }
}

function appendRuntimeSelectedExecutableReferenceDiagnostic(
  found: CompilerDiagnostic[],
  diagnostics: DiagnosticFactory,
  name: string,
  kind: KovoExecutableReferenceAttributeKind,
  span: SourceSpan,
): void {
  const description =
    kind === 'handler'
      ? 'runtime-selected on:* handler reference'
      : 'runtime-selected executable reference';
  appendFiniteIrDiagnostic(
    found,
    diagnostics,
    span,
    `${description} is not compiler-authorized; semantic root=rendered-${kind}-ref:${name}@${span.start}; transfers=<runtime-value>; sink=${name}; verdict=closed:opaque-transfer.`,
  );
}

/** SPEC §6.6 finite structured-server effect boundary and named exceptional doors. */
export const validateFiniteServerSecurityOperations = securityClassifier(
  'compiler.security-operation-ir.validate-server',
  function (diagnostics: DiagnosticFactory, model: ComponentModuleModel): CompilerDiagnostic[] {
    const found: CompilerDiagnostic[] = [];
    validateHandlerCollection(found, diagnostics, model.mutationHandlers, 'mutation');
    validateHandlerCollection(found, diagnostics, model.endpointHandlers, 'endpoint');
    validateHandlerCollection(found, diagnostics, model.queryHandlers, 'query');
    validateHandlerCollection(found, diagnostics, model.webhookHandlers, 'webhook');
    validateHandlerCollection(found, diagnostics, model.taskRunHandlers, 'task');
    validateHandlerCollection(found, diagnostics, model.agentHandlers, 'agent');
    validateAgentModelEffectDoor(found, diagnostics, model.agentHandlers);
    const toolBindings = compilerCreateSet<string>();
    const mutationBindings = agentMutationBindings(model);
    const toolLength = compilerArrayLength(model.agentTools, 'Agent tool declarations');
    for (let toolIndex = 0; toolIndex < toolLength; toolIndex += 1) {
      const tool = compilerOwnDataValue(
        model.agentTools,
        toolIndex,
        'Agent tool declarations',
      ) as AgentToolModel;
      compilerSetAdd(toolBindings, tool.binding);
      appendViolations(found, diagnostics, tool.violations);
      if (
        tool.mutationBinding !== undefined &&
        !compilerSetHas(mutationBindings, tool.mutationBinding)
      ) {
        appendFiniteIrDiagnostic(
          found,
          diagnostics,
          tool.callSpan,
          `agent tool mutation ${tool.mutationBinding} is not an exact exported same-file mutation.`,
        );
      }
    }
    const definitionLength = compilerArrayLength(model.agentDefinitions, 'Agent definitions');
    const agentNames = compilerCreateSet<string>();
    for (let definitionIndex = 0; definitionIndex < definitionLength; definitionIndex += 1) {
      const definition = compilerOwnDataValue(
        model.agentDefinitions,
        definitionIndex,
        'Agent definitions',
      ) as AgentDefinitionModel;
      if (compilerSetHas(agentNames, definition.name)) {
        appendFiniteIrDiagnostic(
          found,
          diagnostics,
          { end: definition.modelHandler.bodyEnd, start: definition.modelHandler.bodyStart },
          `agent name ${definition.name} is duplicated; effect-closure identities must be unique.`,
        );
      }
      compilerSetAdd(agentNames, definition.name);
      const bindingLength = compilerArrayLength(definition.toolBindings, 'Agent tool bindings');
      const agentToolBindings = compilerCreateSet<string>();
      const agentToolNames = compilerCreateSet<string>();
      for (let bindingIndex = 0; bindingIndex < bindingLength; bindingIndex += 1) {
        const binding = compilerOwnDataValue(
          definition.toolBindings,
          bindingIndex,
          'Agent tool bindings',
        ) as string;
        if (compilerSetHas(agentToolBindings, binding)) {
          appendFiniteIrDiagnostic(
            found,
            diagnostics,
            { end: definition.modelHandler.bodyEnd, start: definition.modelHandler.bodyStart },
            `agent tool binding ${binding} is duplicated.`,
          );
        }
        compilerSetAdd(agentToolBindings, binding);
        if (!compilerSetHas(toolBindings, binding)) {
          appendFiniteIrDiagnostic(
            found,
            diagnostics,
            { end: definition.modelHandler.bodyEnd, start: definition.modelHandler.bodyStart },
            `agent tool ${binding} is not an exact same-file tool declaration.`,
          );
          continue;
        }
        let toolName: string | undefined;
        for (let toolIndex = 0; toolIndex < toolLength; toolIndex += 1) {
          const tool = compilerOwnDataValue(
            model.agentTools,
            toolIndex,
            'Agent tool declarations',
          ) as AgentToolModel;
          if (tool.binding === binding) {
            toolName = tool.name;
            break;
          }
        }
        if (toolName !== undefined) {
          if (compilerSetHas(agentToolNames, toolName)) {
            appendFiniteIrDiagnostic(
              found,
              diagnostics,
              { end: definition.modelHandler.bodyEnd, start: definition.modelHandler.bodyStart },
              `agent tool name ${toolName} is duplicated inside ${definition.name}.`,
            );
          }
          compilerSetAdd(agentToolNames, toolName);
        }
      }
    }
    return found;
  },
);

function validateAgentModelEffectDoor(
  found: CompilerDiagnostic[],
  diagnostics: DiagnosticFactory,
  handlers: readonly MutationHandlerModel[],
): void {
  const handlerLength = compilerArrayLength(handlers, 'Agent model effect-door handlers');
  for (let handlerIndex = 0; handlerIndex < handlerLength; handlerIndex += 1) {
    const handler = compilerOwnDataValue(
      handlers,
      handlerIndex,
      'Agent model effect-door handlers',
    ) as MutationHandlerModel;
    const operations = handler.securityOperations ?? [];
    const operationLength = compilerArrayLength(operations, 'Agent model effect-door operations');
    for (let operationIndex = 0; operationIndex < operationLength; operationIndex += 1) {
      const operation = compilerOwnDataValue(
        operations,
        operationIndex,
        'Agent model effect-door operations',
      ) as ServerSecurityOperationModel;
      if (
        operation.kind !== 'server.handler.root' &&
        operation.kind !== 'server.helper.call' &&
        operation.kind !== 'server.egress.request'
      ) {
        appendFiniteIrDiagnostic(
          found,
          diagnostics,
          operation.span,
          `agent model effect ${operation.kind} is outside ctx.fetch; return a witnessed tool decision instead.`,
        );
      }
    }
    const traces = handler.securitySemanticRoot?.traces ?? [];
    const traceLength = compilerArrayLength(traces, 'Agent model semantic traces');
    for (let traceIndex = 0; traceIndex < traceLength; traceIndex += 1) {
      const trace = compilerOwnDataValue(
        traces,
        traceIndex,
        'Agent model semantic traces',
      ) as (typeof traces)[number];
      if (trace.verdict === 'proved' && trace.sink.kind !== 'server.egress.request') {
        appendFiniteIrDiagnostic(
          found,
          diagnostics,
          { end: handler.bodyEnd, start: handler.bodyStart },
          `agent model helper reaches ${trace.sink.kind} outside ctx.fetch; return a witnessed tool decision instead.`,
        );
      }
    }
  }
}

/**
 * SPEC §9.1: a mutation form's CSRF and canonical idempotency controls are one compiler/server-
 * owned bundle. Standalone CSRF helpers remain available for custom-audience endpoint forms, but
 * cannot present a supported-looking half mutation form.
 */
export const validateCompleteMutationFormSecurityFields = securityClassifier(
  'compiler.security-operation-ir.validate-mutation-form-fields',
  function (diagnostics: DiagnosticFactory, model: ComponentModuleModel): CompilerDiagnostic[] {
    const found: CompilerDiagnostic[] = [];
    const callLength = compilerArrayLength(model.calls, 'Security helper calls');
    for (let callIndex = 0; callIndex < callLength; callIndex += 1) {
      const call = compilerOwnDataValue(model.calls, callIndex, 'Security helper calls') as
        | CallExpressionModel
        | undefined;
      if (!call) compilerFailClosed(`Security helper calls[${callIndex}] must be dense own data.`);
      if (call.frameworkSecurityOperation === undefined) continue;
      const argumentLength = compilerArrayLength(
        call.argumentObjectLiteralPaths,
        'Security helper argument paths',
      );
      for (let argumentIndex = 0; argumentIndex < argumentLength; argumentIndex += 1) {
        const paths = compilerOwnDataValue(
          call.argumentObjectLiteralPaths,
          argumentIndex,
          'Security helper argument paths',
        ) as readonly string[] | undefined;
        if (!paths) {
          compilerFailClosed(
            `Security helper argument paths[${argumentIndex}] must be dense own data.`,
          );
        }
        if (!containsExactPath(paths, 'mutation')) continue;
        const span = compilerOwnDataValue(
          call.argumentSpans,
          argumentIndex,
          'Security helper argument spans',
        ) as SourceSpan | undefined;
        appendFiniteIrDiagnostic(
          found,
          diagnostics,
          span ?? { end: call.end, start: call.start },
          `${call.frameworkSecurityOperation} cannot target a mutation; use typed <form mutation={definition}> so CSRF and Kovo-Idem are emitted together.`,
        );
      }
    }
    return found;
  },
);

function validateHandlerCollection(
  found: CompilerDiagnostic[],
  diagnostics: DiagnosticFactory,
  handlers: readonly MutationHandlerModel[],
  expectedSurface: SecurityOperationViolationModel['surface'],
): void {
  const handlerLength = compilerArrayLength(handlers, `${expectedSurface} security-IR handlers`);
  for (let handlerIndex = 0; handlerIndex < handlerLength; handlerIndex += 1) {
    const handler = compilerOwnDataValue(
      handlers,
      handlerIndex,
      `${expectedSurface} security-IR handlers`,
    ) as MutationHandlerModel | undefined;
    if (!handler) {
      compilerFailClosed(
        `${expectedSurface} security-IR handlers[${handlerIndex}] must be dense own data.`,
      );
    }
    appendViolations(found, diagnostics, handler.securityOperationViolations);
    const operations = handler.securityOperations;
    if (operations === undefined) continue;
    const operationLength = compilerArrayLength(
      operations,
      `${expectedSurface} security-IR operations`,
    );
    for (let operationIndex = 0; operationIndex < operationLength; operationIndex += 1) {
      const operation = compilerOwnDataValue(
        operations,
        operationIndex,
        `${expectedSurface} security-IR operations`,
      ) as ServerSecurityOperationModel | undefined;
      if (!operation) {
        compilerFailClosed(
          `${expectedSurface} security-IR operations[${operationIndex}] must be dense own data.`,
        );
      }
      if (
        !isServerSecurityOperationKind(operation.kind) ||
        operation.door !== securityOperationDoorForKind(operation.kind)
      ) {
        appendFiniteIrDiagnostic(
          found,
          diagnostics,
          operation.span,
          `server operation ${operation.kind} has an invalid door.`,
        );
        continue;
      }
      if (
        operation.kind === 'server.helper.call' &&
        (operation.root === undefined || compilerStringTrim(operation.root).length === 0)
      ) {
        appendFiniteIrDiagnostic(
          found,
          diagnostics,
          operation.span,
          'server helper call edge is missing its enrolled handler root.',
        );
        continue;
      }
      if (
        securityOperationNeedsJustification(operation.kind) &&
        (operation.justification === undefined ||
          operation.justification === 'missing' ||
          compilerStringTrim(operation.justification).length === 0)
      ) {
        appendFiniteIrDiagnostic(
          found,
          diagnostics,
          operation.span,
          `${operation.door} requires a non-empty static justification or access/CSRF posture.`,
        );
      }
    }
  }
}

function appendViolations(
  found: CompilerDiagnostic[],
  diagnostics: DiagnosticFactory,
  violations: readonly SecurityOperationViolationModel[] | undefined,
): void {
  if (violations === undefined) return;
  const violationLength = compilerArrayLength(violations, 'Security-IR violations');
  for (let index = 0; index < violationLength; index += 1) {
    const violation = compilerOwnDataValue(violations, index, 'Security-IR violations') as
      | SecurityOperationViolationModel
      | undefined;
    if (!violation) {
      compilerFailClosed(`Security-IR violations[${index}] must be dense own data.`);
    }
    if (violation.kind === 'unscoped-state-key') {
      appendScopedKeyDiagnostic(found, diagnostics, violation.span, violation.detail + '.');
    } else if (
      violation.kind === 'derived-dataset-scope' ||
      violation.kind === 'governed-data-persistence'
    ) {
      appendDerivedDatasetDiagnostic(found, diagnostics, violation.span, violation.detail + '.');
    } else {
      appendFiniteIrDiagnostic(found, diagnostics, violation.span, violation.detail + '.');
    }
  }
}

function appendBrowserViolations(
  found: CompilerDiagnostic[],
  diagnostics: DiagnosticFactory,
  violations: readonly SecurityOperationViolationModel[] | undefined,
  root: string,
): void {
  if (violations === undefined) return;
  const violationLength = compilerArrayLength(violations, 'Browser security-IR violations');
  for (let index = 0; index < violationLength; index += 1) {
    const violation = compilerOwnDataValue(violations, index, 'Browser security-IR violations') as
      | SecurityOperationViolationModel
      | undefined;
    if (!violation) {
      compilerFailClosed(`Browser security-IR violations[${index}] must be dense own data.`);
    }
    const reason =
      violation.kind === 'computed-security-operation'
        ? 'opaque-transfer'
        : violation.kind === 'unknown-security-operation'
          ? 'unknown-operation'
          : 'unsupported-authority-use';
    appendFiniteIrDiagnostic(
      found,
      diagnostics,
      violation.span,
      `semantic root=${root}; transfers=<direct>; sink=${violation.detail}; verdict=closed:${reason}.`,
    );
  }
}

function appendFiniteIrDiagnostic(
  found: CompilerDiagnostic[],
  diagnostics: DiagnosticFactory,
  span: SourceSpan,
  detail: string,
): void {
  const measuredLength = span.end - span.start;
  compilerArrayAppend(
    found,
    diagnosticAt(
      diagnostics,
      'KV449',
      { length: measuredLength > 0 ? measuredLength : 1, start: span.start },
      detail,
    ),
    'Finite security-IR diagnostics',
  );
}

function appendScopedKeyDiagnostic(
  found: CompilerDiagnostic[],
  diagnostics: DiagnosticFactory,
  span: SourceSpan,
  detail: string,
): void {
  const measuredLength = span.end - span.start;
  compilerArrayAppend(
    found,
    diagnosticAt(
      diagnostics,
      'KV450',
      { length: measuredLength > 0 ? measuredLength : 1, start: span.start },
      detail,
    ),
    'Scoped-key diagnostics',
  );
}

function appendDerivedDatasetDiagnostic(
  found: CompilerDiagnostic[],
  diagnostics: DiagnosticFactory,
  span: SourceSpan,
  detail: string,
): void {
  const measuredLength = span.end - span.start;
  compilerArrayAppend(
    found,
    diagnosticAt(
      diagnostics,
      'KV452',
      { length: measuredLength > 0 ? measuredLength : 1, start: span.start },
      detail,
    ),
    'Derived-dataset diagnostics',
  );
}

function containsExactPath(paths: readonly string[], expected: string): boolean {
  const length = compilerArrayLength(paths, 'Security helper option paths');
  for (let index = 0; index < length; index += 1) {
    const path = compilerOwnDataValue(paths, index, 'Security helper option paths');
    if (path === expected) return true;
  }
  return false;
}
