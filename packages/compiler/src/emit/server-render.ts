import { formatKovoModuleRef, parseKovoModuleRef } from '@kovojs/core/internal/module-ref';

import { compilerIrHeader } from '../ir.js';
import {
  compilerCreateSet,
  compilerJsonStringify,
  compilerSetAdd,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerStringIncludes,
  compilerStringReplaceAll,
  compilerStringStartsWith,
  compilerStringToLowerCase,
} from '../compiler-security-intrinsics.js';
import {
  outputContextForAttribute,
  type GeneratedOutputWriteFact,
} from '../output-context-facts.js';
import {
  componentHasInferredFragmentTarget,
  componentOptionObjectEntriesFor,
  componentRenderHost,
  componentRenderHostElement,
  componentRenderHostElementFor,
  type ComponentModel,
  type ObjectLiteralEntry,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
} from '../scan/parse.js';
import { escapeAttribute, splitDepValue, type SourceReplacement } from '../shared.js';
import {
  emitElementParamTypes,
  type ElementParam,
  type HandlerLowering,
  type RegistryFacts,
} from '../types.js';
import type { CompilerDiagnostic } from '../diagnostics.js';
import {
  enhancedMutationFormRenderLowering,
  mutationFormErrorRenderLowering,
  streamTextTargetRenderLowering,
} from './mutation-form.js';
import { writerConflictDiagnostic } from './server-emit-shared.js';
import { queryExpressionFromBinding } from '../scan/query-binding.js';
import { clientModuleUrl } from '../lower/handlers.js';

export interface EmittedServerModule {
  executableSource: string;
  source: string;
}

export interface ServerRenderLowering {
  diagnostics: readonly CompilerDiagnostic[];
  outputContexts: readonly GeneratedOutputWriteFact[];
  replacements: readonly SourceReplacement[];
  stampWrites: readonly ServerRenderStampWriteFact[];
}

export interface ServerRenderStampWriteFact {
  attr:
    | 'kovo-c'
    | 'kovo-deps'
    | 'kovo-fragment-target'
    | 'kovo-live-component'
    | 'kovo-props'
    | 'kovo-state';
  mode: 'insert' | 'preserve' | 'replace';
  value: string;
  valueKind?: 'expression' | 'literal';
  writer:
    | 'host dependency stamp'
    | 'host fragment target stamp'
    | 'host identity stamp'
    | 'host live component stamp'
    | 'host props stamp'
    | 'host state stamp';
}

export interface ServerRenderComponentStampTarget {
  component: ComponentModel;
  domComponentName: string;
  registryComponentName: string;
}

export function emitServerModule(renderedSource: string): EmittedServerModule {
  return {
    executableSource: renderSourceModule(renderedSource, ''),
    source: renderSourceModule(renderedSource, 'export '),
  };
}

export function serverRenderLowering(
  handlers: readonly HandlerLowering[],
  model: ComponentModuleModel,
  domComponentName: string,
  options?: {
    clientHref?: string;
    componentStampTargets?: readonly ServerRenderComponentStampTarget[];
    fileName: string;
    registryComponentName?: string;
    registryFacts?: RegistryFacts;
    source: string;
  },
): ServerRenderLowering {
  return serverRenderPatches(handlers, model, domComponentName, options);
}

function serverRenderPatches(
  handlers: readonly HandlerLowering[],
  model: ComponentModuleModel,
  domComponentName: string,
  options?: {
    clientHref?: string;
    componentStampTargets?: readonly ServerRenderComponentStampTarget[];
    fileName: string;
    registryComponentName?: string;
    registryFacts?: RegistryFacts;
    source: string;
  },
): ServerRenderLowering {
  const handlerSnapshot = compilerSnapshotDenseArray(handlers, 'Server render handlers');
  const diagnostics: CompilerDiagnostic[] = [];
  const host = componentRenderHost(model);
  const patches: SourceReplacement[] = [];
  const outputContexts: GeneratedOutputWriteFact[] = [];
  const stampWrites: ServerRenderStampWriteFact[] = [];
  const chained = chainedPrimitiveHandlerPatches(handlerSnapshot, model);
  const chainedHandlers = compilerCreateSet<HandlerLowering>();
  const chainedHandlerSnapshot = compilerSnapshotDenseArray(
    chained.handlers,
    'Chained server handlers',
  );
  for (let index = 0; index < chainedHandlerSnapshot.length; index += 1) {
    compilerSetAdd(chainedHandlers, chainedHandlerSnapshot[index]!);
  }
  appendServerValues(patches, chained.patches, 'Chained handler patches');
  appendServerValues(outputContexts, chained.outputContexts, 'Chained handler output contexts');
  if (options) {
    appendServerValues(
      diagnostics,
      handlerStampConflictDiagnostics(handlerSnapshot, model, options),
      'Handler stamp diagnostics',
    );
  }
  const formLowering = enhancedMutationFormRenderLowering(model, options);
  appendServerValues(diagnostics, formLowering.diagnostics, 'Mutation form diagnostics');
  appendServerValues(patches, formLowering.replacements, 'Mutation form patches');
  appendServerValues(outputContexts, formLowering.outputContexts, 'Mutation form output contexts');
  const streamTextLowering = streamTextTargetRenderLowering(model, options);
  appendServerValues(diagnostics, streamTextLowering.diagnostics, 'Stream text diagnostics');
  appendServerValues(patches, streamTextLowering.replacements, 'Stream text patches');
  appendServerValues(
    outputContexts,
    streamTextLowering.outputContexts,
    'Stream text output contexts',
  );
  const formErrorLowering = mutationFormErrorRenderLowering(model, options);
  appendServerValues(diagnostics, formErrorLowering.diagnostics, 'Mutation error diagnostics');
  appendServerValues(patches, formErrorLowering.replacements, 'Mutation error patches');
  const triggerLowering = executionTriggerRenderLowering(model, options);
  appendServerValues(patches, triggerLowering.replacements, 'Execution trigger patches');
  appendServerValues(
    outputContexts,
    triggerLowering.outputContexts,
    'Execution trigger output contexts',
  );
  const hostHandlers: HandlerLowering[] = [];
  if (host) {
    for (let index = 0; index < handlerSnapshot.length; index += 1) {
      const handler = handlerSnapshot[index]!;
      if (handler.attributeStart >= host.start && handler.attributeEnd <= host.end) {
        hostHandlers[hostHandlers.length] = handler;
      }
    }
  }

  for (let index = 0; index < handlerSnapshot.length; index += 1) {
    const handler = handlerSnapshot[index]!;
    if (compilerSetHas(chainedHandlers, handler)) continue;
    if (serverArrayIncludesIdentity(hostHandlers, handler)) continue;
    patches[patches.length] = {
      end: handler.attributeEnd,
      replacement: handlerAttributeReplacement(handler),
      start: handler.attributeStart,
    };
    appendServerValues(
      outputContexts,
      handlerOutputContexts(handler),
      'Server handler output contexts',
    );
  }

  if (host) {
    const hostElement = componentRenderHostElement(model);
    if (hostElement) {
      for (let index = 0; index < hostHandlers.length; index += 1) {
        const handler = hostHandlers[index]!;
        if (compilerSetHas(chainedHandlers, handler)) continue;
        patches[patches.length] = handlerSourceReplacement(handler);
        appendServerValues(
          outputContexts,
          handlerOutputContexts(handler),
          'Host handler output contexts',
        );
      }
    }
  }

  const stampTargets = compilerSnapshotDenseArray(
    serverRenderComponentStampTargets(model, domComponentName, options),
    'Server component stamp targets',
  );
  for (let index = 0; index < stampTargets.length; index += 1) {
    const target = stampTargets[index]!;
    const hostElement = componentRenderHostElementFor(model, target.component);
    if (!hostElement) continue;

    const hostStamps = renderHostStampWrites(target.component, hostElement, target);
    appendServerValues(stampWrites, hostStamps.writes, 'Host stamp writes');
    appendServerValues(
      patches,
      renderHostStampPatches(hostElement, hostStamps.writes),
      'Host stamp patches',
    );
    appendServerValues(
      outputContexts,
      renderHostStampOutputContexts(hostStamps.writes),
      'Host stamp output contexts',
    );
    if (options) {
      appendServerValues(
        diagnostics,
        renderHostStampConflictDiagnostics(hostStamps.conflicts, options),
        'Host stamp conflict diagnostics',
      );
    }
  }

  return { diagnostics, outputContexts, replacements: patches, stampWrites };
}

function appendServerValues<Value>(target: Value[], values: readonly Value[], label: string): void {
  const snapshot = compilerSnapshotDenseArray(values, label);
  for (let index = 0; index < snapshot.length; index += 1) {
    target[target.length] = snapshot[index]!;
  }
}

function serverArrayIncludesIdentity<Value>(values: readonly Value[], expected: Value): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === expected) return true;
  }
  return false;
}

function serverRenderComponentStampTargets(
  model: ComponentModuleModel,
  domComponentName: string,
  options:
    | {
        componentStampTargets?: readonly ServerRenderComponentStampTarget[];
        registryComponentName?: string;
      }
    | undefined,
): readonly ServerRenderComponentStampTarget[] {
  if (options?.componentStampTargets) return options.componentStampTargets;

  const component = model.components[0];
  if (!component) return [];
  return [
    {
      component,
      domComponentName,
      registryComponentName: options?.registryComponentName ?? domComponentName,
    },
  ];
}

function executionTriggerRenderLowering(
  model: ComponentModuleModel,
  options:
    | {
        clientHref?: string;
        fileName: string;
      }
    | undefined,
): {
  outputContexts: readonly GeneratedOutputWriteFact[];
  replacements: readonly SourceReplacement[];
} {
  if (!options?.clientHref) return { outputContexts: [], replacements: [] };

  const unversionedHref = clientModuleUrl(options.fileName);
  const replacements: SourceReplacement[] = [];
  const outputContexts: GeneratedOutputWriteFact[] = [];
  const elements = compilerSnapshotDenseArray(model.jsxElements, 'Execution-trigger JSX elements');
  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const element = elements[elementIndex]!;
    const attributes = compilerSnapshotDenseArray(
      element.attributes,
      'Execution-trigger JSX attributes',
    );
    for (let attributeIndex = 0; attributeIndex < attributes.length; attributeIndex += 1) {
      const attribute = attributes[attributeIndex]!;
      if (attribute.executionTriggerName === undefined || attribute.value === undefined) continue;
      const ref = parseKovoModuleRef(attribute.value, 'handler');
      if (!ref || ref.url !== unversionedHref) continue;

      const value = formatKovoModuleRef({ ...ref, url: options.clientHref });
      replacements[replacements.length] = {
        end: attribute.end,
        replacement: `${attribute.name}="${escapeAttribute(value)}" ${clientModuleAllowlistAttribute([value])}`,
        start: attribute.start,
      };
      outputContexts[outputContexts.length] = {
        context: outputContextForAttribute(attribute.name),
        expression: value,
        sink: attribute.name,
        source: 'server-render',
        writer: 'execution trigger URL versioning',
      };
    }
  }

  return { outputContexts, replacements };
}

function handlerOutputContexts(handler: HandlerLowering): GeneratedOutputWriteFact[] {
  const contexts: GeneratedOutputWriteFact[] = [
    {
      context: outputContextForAttribute(handler.attributeName),
      expression: handler.attributeValue,
      sink: handler.attributeName,
      source: 'server-render',
      writer: 'event handler lowering',
    },
  ];
  const params = compilerSnapshotDenseArray(handler.params, 'Server handler parameters');
  for (let index = 0; index < params.length; index += 1) {
    const param = params[index]!;
    contexts[contexts.length] = {
      context: outputContextForAttribute(param.attributeName),
      expression: param.value,
      sink: param.attributeName,
      source: 'server-render' as const,
      writer: 'event handler param lowering',
    };
  }
  return contexts;
}

function chainedPrimitiveHandlerPatches(
  handlers: readonly HandlerLowering[],
  model: ComponentModuleModel,
): {
  handlers: readonly HandlerLowering[];
  outputContexts: readonly GeneratedOutputWriteFact[];
  patches: readonly SourceReplacement[];
} {
  const patches: SourceReplacement[] = [];
  const chainedHandlers: HandlerLowering[] = [];
  const outputContexts: GeneratedOutputWriteFact[] = [];
  const handlerSnapshot = compilerSnapshotDenseArray(handlers, 'Primitive-chain handlers');
  const elements = compilerSnapshotDenseArray(model.jsxElements, 'Primitive-chain JSX elements');

  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const element = elements[elementIndex]!;
    const elementHandlers: HandlerLowering[] = [];
    for (let index = 0; index < handlerSnapshot.length; index += 1) {
      const handler = handlerSnapshot[index]!;
      if (handler.attributeStart >= element.start && handler.attributeEnd <= element.openingEnd) {
        elementHandlers[elementHandlers.length] = handler;
      }
    }
    if (elementHandlers.length === 0) continue;

    const attributes = compilerSnapshotDenseArray(
      element.attributes,
      'Primitive-chain JSX attributes',
    );
    for (let attributeIndex = 0; attributeIndex < attributes.length; attributeIndex += 1) {
      const attribute = attributes[attributeIndex]!;
      if (!compilerStringStartsWith(attribute.name, 'on:') || !attribute.value) continue;

      const attributeHandlers: HandlerLowering[] = [];
      for (let index = 0; index < elementHandlers.length; index += 1) {
        const handler = elementHandlers[index]!;
        if (handler.attributeName === attribute.name) {
          attributeHandlers[attributeHandlers.length] = handler;
        }
      }
      if (attributeHandlers.length === 0) continue;

      // SPEC.md §4.6: primitive composition chains on:* refs author-first, then primitive.
      patches[patches.length] = {
        end: attribute.end,
        replacement: chainedPrimitiveHandlerAttribute(
          attribute.name,
          attribute.value,
          attributeHandlers,
        ),
        start: attribute.start,
      };
      outputContexts[outputContexts.length] = {
        context: 'attribute',
        expression: attribute.value,
        sink: attribute.name,
        source: 'server-render',
        writer: 'primitive handler chain',
      };
      for (let index = 0; index < attributeHandlers.length; index += 1) {
        const handler = attributeHandlers[index]!;
        appendServerValues(
          outputContexts,
          handlerOutputContexts(handler),
          'Primitive-chain handler output contexts',
        );
        patches[patches.length] = {
          end: handler.attributeEnd,
          replacement: '',
          start: handler.attributeStart,
        };
        chainedHandlers[chainedHandlers.length] = handler;
      }
    }
  }

  return { handlers: chainedHandlers, outputContexts, patches };
}

function chainedPrimitiveHandlerAttribute(
  name: string,
  primitiveRefs: string,
  handlers: readonly HandlerLowering[],
): string {
  const handlerSnapshot = compilerSnapshotDenseArray(handlers, 'Chained primitive handlers');
  const refValues: string[] = [];
  const params: ElementParam[] = [];
  for (let handlerIndex = 0; handlerIndex < handlerSnapshot.length; handlerIndex += 1) {
    const handler = handlerSnapshot[handlerIndex]!;
    refValues[refValues.length] = handler.attributeValue;
    const handlerParams = compilerSnapshotDenseArray(
      handler.params,
      'Chained primitive handler parameters',
    );
    for (let paramIndex = 0; paramIndex < handlerParams.length; paramIndex += 1) {
      params[params.length] = handlerParams[paramIndex]!;
    }
  }
  const primitiveTokens = splitDepValue(primitiveRefs);
  for (let index = 0; index < primitiveTokens.length; index += 1) {
    refValues[refValues.length] = primitiveTokens[index]!;
  }

  const parts = [
    `${name}="${escapeAttribute(joinServerStrings(refValues, ' '))}"`,
    clientModuleAllowlistAttribute(refValues),
    emitElementParamTypes(params),
  ];
  appendHandlerParamAttributes(parts, params);
  return joinNonEmptyServerStrings(parts, ' ');
}

function handlerSourceReplacement(handler: HandlerLowering): SourceReplacement {
  return {
    end: handler.attributeEnd,
    replacement: handlerAttributeReplacement(handler),
    start: handler.attributeStart,
  };
}

function handlerAttributeReplacement(handler: HandlerLowering): string {
  const params = compilerSnapshotDenseArray(handler.params, 'Server handler parameters');
  const parts = [
    `${handler.attributeName}="${handler.attributeValue}"`,
    clientModuleAllowlistAttribute([handler.attributeValue]),
    emitElementParamTypes(params),
  ];
  appendHandlerParamAttributes(parts, params);
  return joinNonEmptyServerStrings(parts, ' ');
}

function clientModuleAllowlistAttribute(refValues: readonly string[]): string {
  const urls = compilerCreateSet<string>();
  const orderedUrls: string[] = [];
  const values = compilerSnapshotDenseArray(refValues, 'Client module reference values');
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    const ref = parseKovoModuleRef(value, 'handler');
    if (
      ref !== null &&
      compilerStringStartsWith(ref.url, '/c/') &&
      !compilerSetHas(urls, ref.url)
    ) {
      compilerSetAdd(urls, ref.url);
      orderedUrls[orderedUrls.length] = ref.url;
    }
  }
  return orderedUrls.length > 0
    ? `data-kovo-module-allowlist="${escapeAttribute(joinServerStrings(orderedUrls, ' '))}"`
    : '';
}

function appendHandlerParamAttributes(
  target: string[],
  params: readonly ElementParam[],
): void {
  for (let index = 0; index < params.length; index += 1) {
    const param = params[index]!;
    target[target.length] = `${param.attributeName}="${escapeAttribute(param.value)}"`;
  }
}

function joinNonEmptyServerStrings(values: readonly string[], separator: string): string {
  let output = '';
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (value.length === 0) continue;
    if (output.length > 0) output += separator;
    output += value;
  }
  return output;
}

function joinServerStrings(values: readonly string[], separator: string): string {
  let output = '';
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) output += separator;
    output += values[index]!;
  }
  return output;
}

function renderHostStampPatches(
  hostElement: JsxElementModel,
  writes: readonly ServerRenderStampWriteFact[],
): SourceReplacement[] {
  const patches: SourceReplacement[] = [];
  const insertedAttributes: string[] = [];
  const writeSnapshot = compilerSnapshotDenseArray(writes, 'Rendered host stamp writes');

  for (let index = 0; index < writeSnapshot.length; index += 1) {
    const write = writeSnapshot[index]!;
    const rendered = renderHostStampAttribute(write);
    if (write.mode === 'insert') {
      insertedAttributes[insertedAttributes.length] = rendered;
      continue;
    }
    if (write.mode === 'replace') {
      const existing = serverElementAttribute(hostElement, write.attr);
      if (!existing) continue;
      patches[patches.length] = {
        end: existing.end,
        replacement: rendered,
        start: existing.start,
      };
    }
  }

  if (insertedAttributes.length > 0) {
    const insertion = openingTagAttributeInsertion(hostElement, insertedAttributes);
    patches[patches.length] = {
      end: insertion.position,
      replacement: insertion.replacement,
      start: insertion.position,
    };
  }

  return patches;
}

function renderHostStampOutputContexts(
  writes: readonly ServerRenderStampWriteFact[],
): GeneratedOutputWriteFact[] {
  const snapshot = compilerSnapshotDenseArray(writes, 'Host stamp output-context writes');
  const contexts: GeneratedOutputWriteFact[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const write = snapshot[index]!;
    contexts[contexts.length] = {
      context: 'attribute',
      expression: write.value,
      sink: write.attr,
      source: 'server-render',
      writer: write.writer,
    };
  }
  return contexts;
}

function renderHostStampWrites(
  component: ComponentModel,
  hostElement: JsxElementModel,
  target: Pick<ServerRenderComponentStampTarget, 'domComponentName' | 'registryComponentName'>,
): {
  conflicts: readonly HostStampConflict[];
  writes: readonly ServerRenderStampWriteFact[];
} {
  const conflicts: HostStampConflict[] = [];
  const writes: ServerRenderStampWriteFact[] = [];
  const componentIdentity = componentIdentityStamp(hostElement, target.domComponentName);
  const declaredQueryDeps = declaredQueryDepsStamp(component, hostElement);
  const fragmentTarget = inferredFragmentTargetStamp(
    component,
    hostElement,
    target.domComponentName,
  );
  const liveComponent = liveComponentStamp(component, target.registryComponentName);
  const stateJson = staticStateJson(component);

  if (componentIdentity) {
    if (componentIdentity.mode === 'replace') {
      const existing = serverElementAttribute(hostElement, 'kovo-c');
      if (existing) {
        conflicts[conflicts.length] = {
          attribute: existing,
          attr: 'kovo-c',
          writer: 'host identity stamp',
        };
      }
    }
    writes[writes.length] = componentIdentity;
  }
  if (declaredQueryDeps) {
    writes[writes.length] = declaredQueryDeps;
  }
  if (fragmentTarget) {
    if (fragmentTarget.mode === 'replace') {
      const existing = serverElementAttribute(hostElement, 'kovo-fragment-target');
      if (existing) {
        conflicts[conflicts.length] = {
          attribute: existing,
          attr: 'kovo-fragment-target',
          writer: 'host fragment target stamp',
        };
      }
    }
    writes[writes.length] = fragmentTarget;
  }
  if (liveComponent) {
    writes[writes.length] = liveComponent;
  }
  if (stateJson) {
    const existing = serverElementAttribute(hostElement, 'kovo-state');
    if (existing) {
      if (!sameEscapedOrRawAttributeValue(existing.value, stateJson)) {
        conflicts[conflicts.length] = {
          attribute: existing,
          attr: 'kovo-state',
          writer: 'host state stamp',
        };
      }
      writes[writes.length] = {
        attr: 'kovo-state',
        mode: 'preserve',
        value: stateJson,
        writer: 'host state stamp',
      };
    } else {
      writes[writes.length] = {
        attr: 'kovo-state',
        mode: 'insert',
        value: stateJson,
        writer: 'host state stamp',
      };
    }
  }

  return { conflicts, writes };
}

function liveComponentStamp(
  component: ComponentModel,
  registryComponentName: string,
): ServerRenderStampWriteFact | null {
  if (!componentHasInferredFragmentTarget(component)) return null;

  return {
    attr: 'kovo-live-component',
    mode: 'insert',
    value: registryComponentName,
    writer: 'host live component stamp',
  };
}

function inferredFragmentTargetStamp(
  component: ComponentModel,
  hostElement: JsxElementModel,
  domComponentName: string,
): ServerRenderStampWriteFact | null {
  if (!componentHasInferredFragmentTarget(component)) return null;

  const existing = serverElementAttribute(hostElement, 'kovo-fragment-target');
  if (existing) {
    return {
      attr: 'kovo-fragment-target',
      mode: existing.value === domComponentName ? 'preserve' : 'replace',
      value: domComponentName,
      writer: 'host fragment target stamp',
    };
  }

  return {
    attr: 'kovo-fragment-target',
    mode: 'insert',
    value: domComponentName,
    writer: 'host fragment target stamp',
  };
}

function componentIdentityStamp(
  hostElement: JsxElementModel,
  domComponentName: string,
): ServerRenderStampWriteFact | null {
  const tagName = hostElement.tag;
  if (tagName !== compilerStringToLowerCase(tagName)) return null;
  if (tagName === domComponentName || compilerStringIncludes(tagName, '-')) return null;
  const existing = serverElementAttribute(hostElement, 'kovo-c');
  if (existing) {
    return {
      attr: 'kovo-c',
      mode: existing.value === domComponentName ? 'preserve' : 'replace',
      value: domComponentName,
      writer: 'host identity stamp',
    };
  }

  return {
    attr: 'kovo-c',
    mode: 'insert',
    value: domComponentName,
    writer: 'host identity stamp',
  };
}

function declaredQueryDepsStamp(
  component: ComponentModel,
  hostElement: JsxElementModel,
): ServerRenderStampWriteFact | null {
  const deps = componentQueryDependencyTokens(component);
  if (deps.length === 0) return null;

  const existing = serverElementAttribute(hostElement, 'kovo-deps');
  const existingDeps = splitDepValue(existing?.value ?? '');
  const existingTokens: QueryDependencyToken[] = [];
  for (let index = 0; index < existingDeps.length; index += 1) {
    existingTokens[existingTokens.length] = { value: existingDeps[index]! };
  }
  const mergedDeps = mergeDepValues(existingTokens, deps);
  const depValue = renderQueryDependencyTokens(mergedDeps);
  let hasExpression = false;
  for (let index = 0; index < mergedDeps.length; index += 1) {
    if (mergedDeps[index]!.kind === 'expression') {
      hasExpression = true;
      break;
    }
  }
  if (hasExpression) {
    return {
      attr: 'kovo-deps',
      mode: existing ? 'replace' : 'insert',
      value: depValue,
      valueKind: 'expression',
      writer: 'host dependency stamp',
    };
  }
  return {
    attr: 'kovo-deps',
    mode: existing ? 'replace' : 'insert',
    value: depValue,
    writer: 'host dependency stamp',
  };
}

type QueryDependencyToken =
  | { kind?: 'literal'; value: string }
  | { fallback: string; kind: 'expression'; value: string };

function componentQueryDependencyTokens(component: ComponentModel): QueryDependencyToken[] {
  const entries = compilerSnapshotDenseArray(
    componentOptionObjectEntriesFor(component, 'queries'),
    'Component query dependency entries',
  );
  const tokens: QueryDependencyToken[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const expression = queryKeyExpressionForBinding(entry);
    tokens[tokens.length] = expression
      ? { fallback: entry.key, kind: 'expression', value: expression }
      : { value: entry.key };
  }
  return tokens;
}

function queryKeyExpressionForBinding(entry: ObjectLiteralEntry): string | null {
  const queryExpression = entry.value ? queryExpressionFromBinding(entry.value) : null;
  if (!queryExpression) return null;
  if (queryExpression === entry.key || queryExpression === `${entry.key}Query`) return null;
  return `${queryExpression}.key ?? ${serverJsonSource(entry.key, 'Query dependency key')}`;
}

function mergeDepValues(
  existing: readonly QueryDependencyToken[],
  declared: readonly QueryDependencyToken[],
): QueryDependencyToken[] {
  const seen = compilerCreateSet<string>();
  const merged: QueryDependencyToken[] = [];
  const groups = [existing, declared];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = compilerSnapshotDenseArray(groups[groupIndex]!, 'Query dependency tokens');
    for (let index = 0; index < group.length; index += 1) {
      const dep = group[index]!;
      const key = dep.kind === 'expression' ? `expr:${dep.value}` : `lit:${dep.value}`;
      if (compilerSetHas(seen, key)) continue;
      compilerSetAdd(seen, key);
      merged[merged.length] = dep;
    }
  }
  return merged;
}

function renderQueryDependencyTokens(deps: readonly QueryDependencyToken[]): string {
  const snapshot = compilerSnapshotDenseArray(deps, 'Rendered query dependency tokens');
  let hasExpression = false;
  for (let index = 0; index < snapshot.length; index += 1) {
    if (snapshot[index]!.kind === 'expression') {
      hasExpression = true;
      break;
    }
  }
  const values: string[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const dep = snapshot[index]!;
    values[values.length] = hasExpression ? renderQueryDependencyExpressionElement(dep) : dep.value;
  }
  return hasExpression
    ? `[${joinServerStrings(values, ', ')}].join(' ')`
    : joinServerStrings(values, ' ');
}

function renderQueryDependencyExpressionElement(dep: QueryDependencyToken): string {
  return dep.kind === 'expression'
    ? `(${dep.value})`
    : serverJsonSource(dep.value, 'Query dependency literal');
}

function staticStateJson(component: ComponentModel): string | null {
  const stateObject = component.stateReturnObject ?? null;
  return stateObject?.staticValue
    ? serverJsonSource(stateObject.staticValue, 'Static component state')
    : null;
}

function serverJsonSource(value: unknown, label: string): string {
  const source = compilerJsonStringify(value);
  if (source === undefined) throw new TypeError(`${label} must be JSON-serializable.`);
  return source;
}

interface HostStampConflict {
  attr: 'kovo-c' | 'kovo-fragment-target' | 'kovo-props' | 'kovo-state';
  attribute: JsxAttributeModel;
  writer:
    | 'host fragment target stamp'
    | 'host identity stamp'
    | 'host props stamp'
    | 'host state stamp';
}

function renderHostStampAttribute(write: ServerRenderStampWriteFact): string {
  if (write.valueKind === 'expression') {
    return `${write.attr}={${write.value}}`;
  }
  return `${write.attr}="${escapeAttribute(write.value)}"`;
}

function sameEscapedOrRawAttributeValue(actual: string | undefined, expectedRaw: string): boolean {
  return actual === expectedRaw || actual === escapeAttribute(expectedRaw);
}

function renderHostStampConflictDiagnostics(
  conflicts: readonly HostStampConflict[],
  options: { fileName: string; source: string },
): CompilerDiagnostic[] {
  const snapshot = compilerSnapshotDenseArray(conflicts, 'Host stamp conflicts');
  const diagnostics: CompilerDiagnostic[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const conflict = snapshot[index]!;
    diagnostics[diagnostics.length] = writerConflictDiagnostic(
      options,
      conflict.attribute,
      conflict.attr,
      'author JSX',
      conflict.writer,
    );
  }
  return diagnostics;
}

function handlerStampConflictDiagnostics(
  handlers: readonly HandlerLowering[],
  model: ComponentModuleModel,
  options: { fileName: string; source: string },
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const handlerSnapshot = compilerSnapshotDenseArray(handlers, 'Handler stamp conflict handlers');
  const elements = compilerSnapshotDenseArray(model.jsxElements, 'Handler stamp conflict elements');

  for (let handlerIndex = 0; handlerIndex < handlerSnapshot.length; handlerIndex += 1) {
    const handler = handlerSnapshot[handlerIndex]!;
    let element: JsxElementModel | undefined;
    for (let index = 0; index < elements.length; index += 1) {
      const candidate = elements[index]!;
      if (
        handler.attributeStart >= candidate.start &&
        handler.attributeEnd <= candidate.openingEnd
      ) {
        element = candidate;
        break;
      }
    }
    if (!element) continue;

    const params = compilerSnapshotDenseArray(handler.params, 'Handler conflict parameters');
    const generatedAttrs: string[] = [];
    for (let index = 0; index < params.length; index += 1) {
      generatedAttrs[generatedAttrs.length] = params[index]!.attributeName;
    }
    if (emitElementParamTypes(params).length > 0) {
      generatedAttrs[generatedAttrs.length] = 'kovo-param-types';
    }
    for (let index = 0; index < generatedAttrs.length; index += 1) {
      const name = generatedAttrs[index]!;
      const existing = serverElementAttribute(element, name);
      if (!existing) continue;
      diagnostics[diagnostics.length] = writerConflictDiagnostic(
        options,
        existing,
        name,
        'author JSX',
        'event handler param lowering',
      );
    }
  }

  return diagnostics;
}

function serverElementAttribute(
  element: JsxElementModel,
  name: string,
): JsxAttributeModel | undefined {
  const attributes = compilerSnapshotDenseArray(element.attributes, 'Server JSX attributes');
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]!;
    if (attribute.name === name) return attribute;
  }
  return undefined;
}

function openingTagAttributeInsertion(
  hostElement: JsxElementModel,
  attributes: readonly string[],
): { position: number; replacement: string } {
  const attributeSource = joinServerStrings(
    compilerSnapshotDenseArray(attributes, 'Opening-tag attributes'),
    ' ',
  );
  if (!hostElement.selfClosing) {
    return { position: hostElement.openingEnd - 1, replacement: ` ${attributeSource}` };
  }

  const position = hostElement.openingEnd - 2;
  return {
    position,
    replacement: hostElement.selfClosingSlashHasLeadingWhitespace
      ? `${attributeSource} `
      : ` ${attributeSource} `,
  };
}

function templateLiteral(value: string): string {
  return `\`${compilerStringReplaceAll(
    compilerStringReplaceAll(compilerStringReplaceAll(value, '\\', '\\\\'), '`', '\\`'),
    '${',
    '\\${',
  )}\``;
}

function renderSourceModule(renderedSource: string, exportPrefix: '' | 'export '): string {
  // Build the executable variant from the same lowered source facts instead of reparsing the
  // emitted artifact. This is a generated renderSource round-trip helper, not the SPEC §5.2
  // authored-vs-lowered semantic gate.
  return `${compilerIrHeader}
${exportPrefix}function renderSource() {
  return ${templateLiteral(renderedSource)};
}
`;
}
