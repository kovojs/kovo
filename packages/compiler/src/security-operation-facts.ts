import {
  securitySemanticGraphSchema,
  type SecurityOperationIr,
  type SecuritySemanticGraph,
  type SecuritySemanticRoot,
} from '@kovojs/core/internal/security-operation-ir';

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
import { serverSecuritySemanticBudgets } from './scan/security-operation-ir.js';
import type { BrowserSecurityOperationFact, HandlerLowering } from './types.js';

/** Spanful compiler sibling facts retained solely for TASK B terminal correspondence. @internal */
export interface CompilerTaskBSourceOperation {
  readonly door: ServerSecurityOperationModel['door'];
  readonly kind: ServerSecurityOperationModel['kind'];
  readonly root: string;
  readonly span: Readonly<ServerSecurityOperationModel['span']>;
  readonly target?: string;
}

/**
 * Preserve the exact per-root source operations before the public graph projection strips spans.
 * TASK B binds this sibling denominator into its finite-verdict digest and independently compares
 * it with every proved semantic terminal (SPEC §6.6).
 *
 * @internal
 */
export function componentTaskBSourceOperationFacts(
  model: ComponentModuleModel,
): CompilerTaskBSourceOperation[] {
  const operations: CompilerTaskBSourceOperation[] = [];
  appendTaskBHandlerSourceOperations(operations, model.mutationHandlers, 'Mutation TASK B source');
  appendTaskBHandlerSourceOperations(operations, model.endpointHandlers, 'Endpoint TASK B source');
  appendTaskBHandlerSourceOperations(operations, model.queryHandlers, 'Query TASK B source');
  appendTaskBHandlerSourceOperations(operations, model.webhookHandlers, 'Webhook TASK B source');
  appendTaskBHandlerSourceOperations(operations, model.taskRunHandlers, 'Task TASK B source');
  appendTaskBHandlerSourceOperations(operations, model.agentHandlers, 'Agent TASK B source');
  return operations;
}

function appendTaskBHandlerSourceOperations(
  target: CompilerTaskBSourceOperation[],
  handlers: readonly MutationHandlerModel[],
  label: string,
): void {
  const handlerSnapshot = compilerSnapshotDenseArray(handlers, `${label} handlers`);
  for (let handlerIndex = 0; handlerIndex < handlerSnapshot.length; handlerIndex += 1) {
    const handler = handlerSnapshot[handlerIndex]!;
    const operationSnapshot = compilerSnapshotDenseArray(
      handler.securityOperations ?? [],
      `${label} operations`,
    );
    if (operationSnapshot.length === 0) continue;
    const root = handler.securitySemanticRoot?.root;
    if (root === undefined) {
      throw new TypeError(`${label}[${handlerIndex}] has operations without one semantic root.`);
    }
    for (let operationIndex = 0; operationIndex < operationSnapshot.length; operationIndex += 1) {
      const operation = operationSnapshot[operationIndex]! as ServerSecurityOperationModel;
      compilerArrayAppend(
        target,
        {
          door: operation.door,
          kind: operation.kind,
          root,
          span: { end: operation.span.end, start: operation.span.start },
          ...(operation.target === undefined ? {} : { target: operation.target }),
        },
        label,
      );
    }
  }
}

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
  appendHandlerSecurityOperations(operations, seen, model.queryHandlers, 'Query security IR');
  appendHandlerSecurityOperations(operations, seen, model.webhookHandlers, 'Webhook security IR');
  appendHandlerSecurityOperations(operations, seen, model.taskRunHandlers, 'Task security IR');
  appendHandlerSecurityOperations(operations, seen, model.agentHandlers, 'Agent security IR');
  return operations;
}

/** Compiler-owned normalized helper summaries and root-to-sink provenance for graph/explain. */
export function componentSecuritySemanticGraphFacts(
  model: ComponentModuleModel,
): SecuritySemanticGraph | undefined {
  const roots: SecuritySemanticRoot[] = [];
  const seen = compilerCreateSet<string>();
  appendHandlerSemanticRoots(roots, seen, model.mutationHandlers, 'Mutation semantic roots');
  appendHandlerSemanticRoots(roots, seen, model.endpointHandlers, 'Endpoint semantic roots');
  appendHandlerSemanticRoots(roots, seen, model.queryHandlers, 'Query semantic roots');
  appendHandlerSemanticRoots(roots, seen, model.webhookHandlers, 'Webhook semantic roots');
  appendHandlerSemanticRoots(roots, seen, model.taskRunHandlers, 'Task semantic roots');
  appendHandlerSemanticRoots(roots, seen, model.agentHandlers, 'Agent semantic roots');
  if (roots.length === 0) return undefined;
  return {
    budgets: serverSecuritySemanticBudgets(),
    roots,
    schema: securitySemanticGraphSchema,
    sourceFile: model.sourceFile.fileName,
  };
}

function appendHandlerSemanticRoots(
  target: SecuritySemanticRoot[],
  seen: Set<string>,
  handlers: readonly MutationHandlerModel[],
  label: string,
): void {
  const handlerSnapshot = compilerSnapshotDenseArray(handlers, `${label} handlers`);
  for (let index = 0; index < handlerSnapshot.length; index += 1) {
    const root = handlerSnapshot[index]!.securitySemanticRoot;
    if (root === undefined) continue;
    const key = compilerJsonStringify(root);
    if (key === undefined) throw new TypeError(`${label}[${index}] must be JSON-serializable.`);
    if (compilerSetHas(seen, key)) continue;
    compilerSetAdd(seen, key);
    compilerArrayAppend(target, root, label);
  }
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
          ...(operation.root === undefined ? {} : { root: operation.root }),
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
    ...('root' in operation && operation.root !== undefined ? { root: operation.root } : {}),
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
