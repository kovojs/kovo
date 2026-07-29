import type {
  AgentExplainFact,
  AgentToolExplainFact,
  SourceAnchor,
} from '@kovojs/core/internal/graph';
import {
  agentMinimumIntegrityForOperations,
  isServerSecurityOperationKind,
  securityOperationDoorForKind,
  type ServerSecurityOperationFact,
} from '@kovojs/core/internal/security-operation-ir';

import {
  compilerArrayAppend,
  compilerCreateSet,
  compilerJsonStringify,
  compilerSetAdd,
  compilerSetHas,
  compilerSnapshotDenseArray,
} from './compiler-security-intrinsics.js';
import type { ComponentModuleModel, MutationHandlerModel } from './scan/model.js';

/** Build exact per-agent/per-tool closures from the same finite L2 operation facts as HTTP roots. */
export function agentGraphFactsFromModel(
  model: ComponentModuleModel,
  fileName: string,
): AgentExplainFact[] {
  const facts: AgentExplainFact[] = [];
  const definitions = compilerSnapshotDenseArray(model.agentDefinitions, 'Agent definitions');
  const tools = compilerSnapshotDenseArray(model.agentTools, 'Agent tools');
  for (let definitionIndex = 0; definitionIndex < definitions.length; definitionIndex += 1) {
    const definition = definitions[definitionIndex]!;
    const toolFacts: AgentToolExplainFact[] = [];
    const bindings = compilerSnapshotDenseArray(definition.toolBindings, 'Agent tool bindings');
    for (let bindingIndex = 0; bindingIndex < bindings.length; bindingIndex += 1) {
      const reference = bindings[bindingIndex]!;
      const toolFact = agentToolFactForBinding(
        model,
        reference.binding,
        tools,
        fileName,
        reference.span,
      );
      if (toolFact !== undefined)
        compilerArrayAppend(toolFacts, toolFact, 'Agent tool graph facts');
    }
    compilerArrayAppend(
      facts,
      {
        modelOperations: terminalOperationFacts(definition.modelHandler),
        name: definition.name,
        source: sourceAnchor(fileName, definition.callSpan),
        tools: toolFacts,
      },
      'Agent graph facts',
    );
  }
  return facts;
}

/** Exact model-operation witness keyed by the immutable source binding, never a display name. */
export function agentModelOperationsForBinding(
  model: ComponentModuleModel,
  binding: string,
): readonly ServerSecurityOperationFact[] | undefined {
  const definitions = compilerSnapshotDenseArray(model.agentDefinitions, 'Agent definitions');
  for (let index = 0; index < definitions.length; index += 1) {
    if (definitions[index]!.binding === binding) {
      return terminalOperationFacts(definitions[index]!.modelHandler);
    }
  }
  return undefined;
}

/** Exact tool-operation witness keyed by the immutable source binding, never a display name. */
export function agentToolOperationsForBinding(
  model: ComponentModuleModel,
  binding: string,
): readonly ServerSecurityOperationFact[] | undefined {
  const toolModel = agentToolModelForBinding(
    binding,
    compilerSnapshotDenseArray(model.agentTools, 'Agent tools'),
  );
  if (toolModel?.mutationBinding === undefined || (toolModel.violations?.length ?? 0) > 0) {
    return undefined;
  }
  const mutationHandler = handlerForMutationBinding(model, toolModel.mutationBinding);
  const mutationKey = mutationHandler?.mutationOwner?.value;
  return mutationHandler === undefined || mutationKey === undefined || mutationKey === 'UNRESOLVED'
    ? undefined
    : terminalOperationFacts(mutationHandler);
}

function agentToolFactForBinding(
  model: ComponentModuleModel,
  binding: string,
  tools: readonly ComponentModuleModel['agentTools'][number][],
  fileName: string,
  bindingSpan: { readonly end: number; readonly start: number },
): AgentToolExplainFact | undefined {
  const toolModel = agentToolModelForBinding(binding, tools);
  if (
    toolModel?.name === undefined ||
    toolModel.mutationBinding === undefined ||
    toolModel.mutationBindingSpan === undefined ||
    (toolModel.violations?.length ?? 0) > 0
  ) {
    return undefined;
  }
  const mutationHandler = handlerForMutationBinding(model, toolModel.mutationBinding);
  const mutationKey = mutationHandler?.mutationOwner?.value;
  if (mutationHandler === undefined || mutationKey === undefined || mutationKey === 'UNRESOLVED') {
    return undefined;
  }
  const operations = terminalOperationFacts(mutationHandler);
  return {
    bindingSource: sourceAnchor(fileName, bindingSpan),
    minimumIntegrity: agentMinimumIntegrityForOperations(operations),
    mutation: mutationKey,
    mutationSource: sourceAnchor(fileName, toolModel.mutationBindingSpan),
    name: toolModel.name,
    operations,
    resultIntegrity: toolModel.resultIntegrity,
    source: sourceAnchor(fileName, toolModel.callSpan),
  };
}

function agentToolModelForBinding(
  binding: string,
  tools: readonly ComponentModuleModel['agentTools'][number][],
): ComponentModuleModel['agentTools'][number] | undefined {
  for (let toolIndex = 0; toolIndex < tools.length; toolIndex += 1) {
    if (tools[toolIndex]!.binding === binding) return tools[toolIndex]!;
  }
  return undefined;
}

function sourceAnchor(
  file: string,
  span: { readonly end: number; readonly start: number },
): SourceAnchor {
  return { end: span.end, file, start: span.start };
}

function handlerForMutationBinding(
  model: ComponentModuleModel,
  binding: string,
): MutationHandlerModel | undefined {
  const calls = compilerSnapshotDenseArray(model.calls, 'Framework calls');
  let callStart: number | undefined;
  let callEnd: number | undefined;
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index]!;
    if (call.frameworkFactory === 'mutation' && call.exportedConstName === binding) {
      callStart = call.start;
      callEnd = call.end;
      break;
    }
  }
  if (callStart === undefined || callEnd === undefined) return undefined;
  const handlers = compilerSnapshotDenseArray(model.mutationHandlers, 'Mutation handlers');
  for (let index = 0; index < handlers.length; index += 1) {
    const span = handlers[index]!.securitySemanticRoot?.binding.factoryCallSpan;
    if (span?.start === callStart && span.end === callEnd) return handlers[index]!;
  }
  return undefined;
}

function terminalOperationFacts(handler: MutationHandlerModel): ServerSecurityOperationFact[] {
  const result: ServerSecurityOperationFact[] = [];
  const seen = compilerCreateSet<string>();
  const operations = compilerSnapshotDenseArray(
    handler.securityOperations ?? [],
    'Agent terminal operations',
  );
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index]!;
    if (operation.kind === 'server.handler.root' || operation.kind === 'server.helper.call')
      continue;
    appendTerminalOperation(result, seen, operation);
  }
  const traces = compilerSnapshotDenseArray(
    handler.securitySemanticRoot?.traces ?? [],
    'Agent semantic traces',
  );
  for (let index = 0; index < traces.length; index += 1) {
    const trace = traces[index]!;
    if (trace.verdict !== 'proved') continue;
    appendTerminalOperation(result, seen, trace.sink);
  }
  return result;
}

function appendTerminalOperation(
  target: ServerSecurityOperationFact[],
  seen: Set<string>,
  operation: {
    readonly door: unknown;
    readonly justification?: string;
    readonly kind: unknown;
    readonly target?: string;
  },
): void {
  if (
    !isServerSecurityOperationKind(operation.kind) ||
    operation.door !== securityOperationDoorForKind(operation.kind)
  ) {
    return;
  }
  const fact: ServerSecurityOperationFact = {
    door: securityOperationDoorForKind(operation.kind),
    kind: operation.kind,
    ...(operation.target === undefined ? {} : { target: operation.target }),
    ...(operation.justification === undefined ? {} : { justification: operation.justification }),
  };
  const key = compilerJsonStringify(fact);
  if (key === undefined || compilerSetHas(seen, key)) return;
  compilerSetAdd(seen, key);
  compilerArrayAppend(target, fact, 'Agent terminal operation facts');
}

/** Exact exported mutation bindings eligible for tool linkage. */
export function agentMutationBindings(model: ComponentModuleModel): ReadonlySet<string> {
  const result = compilerCreateSet<string>();
  const calls = compilerSnapshotDenseArray(model.calls, 'Framework calls');
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index]!;
    if (call.frameworkFactory === 'mutation' && call.exportedConstName !== undefined) {
      compilerSetAdd(result, call.exportedConstName);
    }
  }
  return result;
}
