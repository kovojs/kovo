import type { SecurityOperationIr } from '@kovojs/core/internal/security-operation-ir';

import {
  compilerArrayAppend,
  compilerCreateSet,
  compilerJsonStringify,
  compilerSetAdd,
  compilerSetHas,
  compilerSnapshotDenseArray,
} from './compiler-security-intrinsics.js';
import type { ComponentModuleModel } from './scan/parse.js';
import type { MutationHandlerModel, ServerSecurityOperationModel } from './scan/model.js';
import type { BrowserSecurityOperationFact, HandlerLowering } from './types.js';

/** Compiler-owned, span-free operation facts suitable for generated artifacts and explain JSON. */
export function componentSecurityOperationFacts(
  model: ComponentModuleModel,
  handlers: readonly HandlerLowering[],
): SecurityOperationIr[] {
  const operations = serverSecurityOperationFacts(model);
  const seen = securityOperationFactKeys(operations, 'Server security-operation facts');
  const handlerSnapshot = compilerSnapshotDenseArray(handlers, 'Browser security-IR handlers');
  for (let handlerIndex = 0; handlerIndex < handlerSnapshot.length; handlerIndex += 1) {
    const operationSnapshot = compilerSnapshotDenseArray(
      handlerSnapshot[handlerIndex]!.securityOperations,
      'Browser security-IR operations',
    );
    for (let operationIndex = 0; operationIndex < operationSnapshot.length; operationIndex += 1) {
      appendSecurityOperationFact(
        operations,
        seen,
        operationSnapshot[operationIndex]!,
        'Browser security-operation facts',
      );
    }
  }
  return operations;
}

export function serverSecurityOperationFacts(model: ComponentModuleModel): SecurityOperationIr[] {
  const operations: SecurityOperationIr[] = [];
  const seen = compilerCreateSet<string>();
  appendHandlerSecurityOperations(operations, seen, model.mutationHandlers, 'Mutation security IR');
  appendHandlerSecurityOperations(operations, seen, model.endpointHandlers, 'Endpoint security IR');
  appendHandlerSecurityOperations(operations, seen, model.webhookHandlers, 'Webhook security IR');
  appendHandlerSecurityOperations(operations, seen, model.taskRunHandlers, 'Task security IR');
  return operations;
}

function appendHandlerSecurityOperations(
  target: SecurityOperationIr[],
  seen: Set<string>,
  handlers: readonly MutationHandlerModel[],
  label: string,
): void {
  const handlerSnapshot = compilerSnapshotDenseArray(handlers, `${label} handlers`);
  for (let handlerIndex = 0; handlerIndex < handlerSnapshot.length; handlerIndex += 1) {
    const operationSnapshot = compilerSnapshotDenseArray(
      handlerSnapshot[handlerIndex]!.securityOperations ?? [],
      `${label} operations`,
    );
    for (let operationIndex = 0; operationIndex < operationSnapshot.length; operationIndex += 1) {
      const operation = operationSnapshot[operationIndex]! as ServerSecurityOperationModel;
      appendSecurityOperationFact(
        target,
        seen,
        {
          door: operation.door,
          kind: operation.kind,
          ...(operation.target === undefined ? {} : { target: operation.target }),
          ...(operation.justification === undefined
            ? {}
            : { justification: operation.justification }),
        },
        label,
      );
    }
  }
}

function securityOperationFactKeys(
  operations: readonly SecurityOperationIr[],
  label: string,
): Set<string> {
  const seen = compilerCreateSet<string>();
  const snapshot = compilerSnapshotDenseArray(operations, label);
  for (let index = 0; index < snapshot.length; index += 1) {
    compilerSetAdd(seen, securityOperationFactKey(snapshot[index]!, label));
  }
  return seen;
}

function appendSecurityOperationFact(
  target: SecurityOperationIr[],
  seen: Set<string>,
  operation: BrowserSecurityOperationFact | SecurityOperationIr,
  label: string,
): void {
  const fact: SecurityOperationIr = {
    door: operation.door,
    kind: operation.kind,
    ...(operation.target === undefined ? {} : { target: operation.target }),
    ...('justification' in operation && operation.justification !== undefined
      ? { justification: operation.justification }
      : {}),
  };
  const key = securityOperationFactKey(fact, label);
  if (compilerSetHas(seen, key)) return;
  compilerSetAdd(seen, key);
  compilerArrayAppend(target, fact, label);
}

function securityOperationFactKey(operation: SecurityOperationIr, label: string): string {
  const source = compilerJsonStringify(operation);
  if (source === undefined) throw new TypeError(`${label} must be JSON-serializable.`);
  return source;
}
