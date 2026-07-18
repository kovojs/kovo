import {
  isBrowserSecurityOperationKind,
  isServerSecurityOperationKind,
  securityOperationDoorForKind,
  securityOperationNeedsJustification,
} from '@kovojs/core/internal/security-operation-ir';
import { securityClassifier } from '@kovojs/core/internal/security-markers';

import type { CompilerDiagnostic, DiagnosticFactory } from '../diagnostics.js';
import {
  compilerArrayAppend,
  compilerArrayLength,
  compilerFailClosed,
  compilerOwnDataValue,
  compilerSetHas,
  compilerStringTrim,
} from '../compiler-security-intrinsics.js';
import { jsxElements, type ComponentModuleModel } from '../scan/parse.js';
import type {
  BrowserSecurityOperationModel,
  CallExpressionModel,
  JsxAttributeModel,
  JsxElementModel,
  MutationHandlerModel,
  SecurityOperationViolationModel,
  ServerSecurityOperationModel,
  SourceSpan,
} from '../scan/model.js';
import { analyzeClientCaptures } from './client-capture.js';

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
        appendViolations(found, diagnostics, arrow.securityOperationViolations);
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

/** SPEC §6.6 finite structured-server effect boundary and named exceptional doors. */
export const validateFiniteServerSecurityOperations = securityClassifier(
  'compiler.security-operation-ir.validate-server',
  function (diagnostics: DiagnosticFactory, model: ComponentModuleModel): CompilerDiagnostic[] {
    const found: CompilerDiagnostic[] = [];
    validateHandlerCollection(found, diagnostics, model.mutationHandlers, 'mutation');
    validateHandlerCollection(found, diagnostics, model.endpointHandlers, 'endpoint');
    validateHandlerCollection(found, diagnostics, model.webhookHandlers, 'webhook');
    validateHandlerCollection(found, diagnostics, model.taskRunHandlers, 'task');
    return found;
  },
);

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
    appendFiniteIrDiagnostic(found, diagnostics, violation.span, violation.detail + '.');
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
    diagnostics.at(
      'KV449',
      { length: measuredLength > 0 ? measuredLength : 1, start: span.start },
      detail,
    ),
    'Finite security-IR diagnostics',
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
