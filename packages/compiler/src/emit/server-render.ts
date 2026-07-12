import { formatKovoModuleRef, parseKovoModuleRef } from '@kovojs/core/internal/module-ref';

import { compilerIrHeader } from '../ir.js';
import {
  compilerCreateSet,
  compilerSetAdd,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerStringStartsWith,
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
  const diagnostics: CompilerDiagnostic[] = [];
  const host = componentRenderHost(model);
  const patches: SourceReplacement[] = [];
  const outputContexts: GeneratedOutputWriteFact[] = [];
  const stampWrites: ServerRenderStampWriteFact[] = [];
  const chained = chainedPrimitiveHandlerPatches(handlers, model);
  const chainedHandlers = new Set(chained.handlers);
  patches.push(...chained.patches);
  outputContexts.push(...chained.outputContexts);
  if (options) diagnostics.push(...handlerStampConflictDiagnostics(handlers, model, options));
  const formLowering = enhancedMutationFormRenderLowering(model, options);
  diagnostics.push(...formLowering.diagnostics);
  patches.push(...formLowering.replacements);
  outputContexts.push(...formLowering.outputContexts);
  const streamTextLowering = streamTextTargetRenderLowering(model, options);
  diagnostics.push(...streamTextLowering.diagnostics);
  patches.push(...streamTextLowering.replacements);
  outputContexts.push(...streamTextLowering.outputContexts);
  const formErrorLowering = mutationFormErrorRenderLowering(model, options);
  diagnostics.push(...formErrorLowering.diagnostics);
  patches.push(...formErrorLowering.replacements);
  const triggerLowering = executionTriggerRenderLowering(model, options);
  patches.push(...triggerLowering.replacements);
  outputContexts.push(...triggerLowering.outputContexts);
  const hostHandlers = host
    ? handlers.filter(
        (handler) => handler.attributeStart >= host.start && handler.attributeEnd <= host.end,
      )
    : [];

  for (const handler of handlers) {
    if (chainedHandlers.has(handler)) continue;
    if (hostHandlers.includes(handler)) continue;
    patches.push({
      end: handler.attributeEnd,
      replacement: handlerAttributeReplacement(handler),
      start: handler.attributeStart,
    });
    outputContexts.push(...handlerOutputContexts(handler));
  }

  if (host) {
    const hostElement = componentRenderHostElement(model);
    if (hostElement) {
      patches.push(
        ...hostHandlers
          .filter((handler) => !chainedHandlers.has(handler))
          .map(handlerSourceReplacement),
      );
      outputContexts.push(
        ...hostHandlers
          .filter((handler) => !chainedHandlers.has(handler))
          .flatMap((handler) => handlerOutputContexts(handler)),
      );
    }
  }

  for (const target of serverRenderComponentStampTargets(model, domComponentName, options)) {
    const hostElement = componentRenderHostElementFor(model, target.component);
    if (!hostElement) continue;

    const hostStamps = renderHostStampWrites(target.component, hostElement, target);
    stampWrites.push(...hostStamps.writes);
    patches.push(...renderHostStampPatches(hostElement, hostStamps.writes));
    outputContexts.push(...renderHostStampOutputContexts(hostStamps.writes));
    if (options)
      diagnostics.push(...renderHostStampConflictDiagnostics(hostStamps.conflicts, options));
  }

  return { diagnostics, outputContexts, replacements: patches, stampWrites };
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
  for (const element of model.jsxElements) {
    for (const attribute of element.attributes) {
      if (attribute.executionTriggerName === undefined || attribute.value === undefined) continue;
      const ref = parseKovoModuleRef(attribute.value, 'handler');
      if (!ref || ref.url !== unversionedHref) continue;

      const value = formatKovoModuleRef({ ...ref, url: options.clientHref });
      replacements.push({
        end: attribute.end,
        replacement: `${attribute.name}="${escapeAttribute(value)}" ${clientModuleAllowlistAttribute([value])}`,
        start: attribute.start,
      });
      outputContexts.push({
        context: outputContextForAttribute(attribute.name),
        expression: value,
        sink: attribute.name,
        source: 'server-render',
        writer: 'execution trigger URL versioning',
      });
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

  for (const element of model.jsxElements) {
    const elementHandlers = handlers.filter(
      (handler) =>
        handler.attributeStart >= element.start && handler.attributeEnd <= element.openingEnd,
    );
    if (elementHandlers.length === 0) continue;

    for (const attribute of element.attributes) {
      if (!attribute.name.startsWith('on:') || !attribute.value) continue;

      const attributeHandlers = elementHandlers.filter(
        (handler) => handler.attributeName === attribute.name,
      );
      if (attributeHandlers.length === 0) continue;

      // SPEC.md §4.6: primitive composition chains on:* refs author-first, then primitive.
      patches.push({
        end: attribute.end,
        replacement: chainedPrimitiveHandlerAttribute(
          attribute.name,
          attribute.value,
          attributeHandlers,
        ),
        start: attribute.start,
      });
      outputContexts.push(
        {
          context: 'attribute',
          expression: attribute.value,
          sink: attribute.name,
          source: 'server-render',
          writer: 'primitive handler chain',
        },
        ...attributeHandlers.flatMap((handler) => handlerOutputContexts(handler)),
      );
      for (const handler of attributeHandlers) {
        patches.push({ end: handler.attributeEnd, replacement: '', start: handler.attributeStart });
        chainedHandlers.push(handler);
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

  for (const write of writes) {
    const rendered = renderHostStampAttribute(write);
    if (write.mode === 'insert') {
      insertedAttributes.push(rendered);
      continue;
    }
    if (write.mode === 'replace') {
      const existing = hostElement.attributes.find((attribute) => attribute.name === write.attr);
      if (!existing) continue;
      patches.push({
        end: existing.end,
        replacement: rendered,
        start: existing.start,
      });
    }
  }

  if (insertedAttributes.length > 0) {
    const insertion = openingTagAttributeInsertion(hostElement, insertedAttributes);
    patches.push({
      end: insertion.position,
      replacement: insertion.replacement,
      start: insertion.position,
    });
  }

  return patches;
}

function renderHostStampOutputContexts(
  writes: readonly ServerRenderStampWriteFact[],
): GeneratedOutputWriteFact[] {
  return writes.map((write) => ({
    context: 'attribute',
    expression: write.value,
    sink: write.attr,
    source: 'server-render',
    writer: write.writer,
  }));
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
      const existing = hostElement.attributes.find((attribute) => attribute.name === 'kovo-c');
      if (existing) {
        conflicts.push({ attribute: existing, attr: 'kovo-c', writer: 'host identity stamp' });
      }
    }
    writes.push(componentIdentity);
  }
  if (declaredQueryDeps) {
    writes.push(declaredQueryDeps);
  }
  if (fragmentTarget) {
    if (fragmentTarget.mode === 'replace') {
      const existing = hostElement.attributes.find(
        (attribute) => attribute.name === 'kovo-fragment-target',
      );
      if (existing) {
        conflicts.push({
          attribute: existing,
          attr: 'kovo-fragment-target',
          writer: 'host fragment target stamp',
        });
      }
    }
    writes.push(fragmentTarget);
  }
  if (liveComponent) {
    writes.push(liveComponent);
  }
  if (stateJson) {
    const existing = hostElement.attributes.find((attribute) => attribute.name === 'kovo-state');
    if (existing) {
      if (!sameEscapedOrRawAttributeValue(existing.value, stateJson)) {
        conflicts.push({ attribute: existing, attr: 'kovo-state', writer: 'host state stamp' });
      }
      writes.push({
        attr: 'kovo-state',
        mode: 'preserve',
        value: stateJson,
        writer: 'host state stamp',
      });
    } else {
      writes.push({
        attr: 'kovo-state',
        mode: 'insert',
        value: stateJson,
        writer: 'host state stamp',
      });
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

  const existing = hostElement.attributes.find(
    (attribute) => attribute.name === 'kovo-fragment-target',
  );
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
  if (tagName !== tagName.toLowerCase()) return null;
  if (tagName === domComponentName || tagName.includes('-')) return null;
  const existing = hostElement.attributes.find((attribute) => attribute.name === 'kovo-c');
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

  const existing = hostElement.attributes.find((attribute) => attribute.name === 'kovo-deps');
  const existingDeps = splitDepValue(existing?.value ?? '');
  const mergedDeps = mergeDepValues(
    existingDeps.map((value) => ({ value })),
    deps,
  );
  const depValue = renderQueryDependencyTokens(mergedDeps);
  return {
    attr: 'kovo-deps',
    mode: existing ? 'replace' : 'insert',
    value: depValue,
    ...(mergedDeps.some((dep) => dep.kind === 'expression') ? { valueKind: 'expression' } : {}),
    writer: 'host dependency stamp',
  };
}

type QueryDependencyToken =
  | { kind?: 'literal'; value: string }
  | { fallback: string; kind: 'expression'; value: string };

function componentQueryDependencyTokens(component: ComponentModel): QueryDependencyToken[] {
  return componentOptionObjectEntriesFor(component, 'queries').map((entry) => {
    const expression = queryKeyExpressionForBinding(entry);
    return expression
      ? { fallback: entry.key, kind: 'expression', value: expression }
      : { value: entry.key };
  });
}

function queryKeyExpressionForBinding(entry: ObjectLiteralEntry): string | null {
  const queryExpression = entry.value ? queryExpressionFromBinding(entry.value) : null;
  if (!queryExpression) return null;
  if (queryExpression === entry.key || queryExpression === `${entry.key}Query`) return null;
  return `${queryExpression}.key ?? ${JSON.stringify(entry.key)}`;
}

function mergeDepValues(
  existing: readonly QueryDependencyToken[],
  declared: readonly QueryDependencyToken[],
): QueryDependencyToken[] {
  const seen = new Set<string>();
  const merged: QueryDependencyToken[] = [];
  for (const dep of [...existing, ...declared]) {
    const key = dep.kind === 'expression' ? `expr:${dep.value}` : `lit:${dep.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(dep);
  }
  return merged;
}

function renderQueryDependencyTokens(deps: readonly QueryDependencyToken[]): string {
  if (!deps.some((dep) => dep.kind === 'expression')) {
    return deps.map((dep) => dep.value).join(' ');
  }
  return `[${deps.map(renderQueryDependencyExpressionElement).join(', ')}].join(' ')`;
}

function renderQueryDependencyExpressionElement(dep: QueryDependencyToken): string {
  return dep.kind === 'expression' ? `(${dep.value})` : JSON.stringify(dep.value);
}

function staticStateJson(component: ComponentModel): string | null {
  const stateObject = component.stateReturnObject ?? null;
  return stateObject?.staticValue ? JSON.stringify(stateObject.staticValue) : null;
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
  return conflicts.map((conflict) =>
    writerConflictDiagnostic(
      options,
      conflict.attribute,
      conflict.attr,
      'author JSX',
      conflict.writer,
    ),
  );
}

function handlerStampConflictDiagnostics(
  handlers: readonly HandlerLowering[],
  model: ComponentModuleModel,
  options: { fileName: string; source: string },
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  for (const handler of handlers) {
    const element = model.jsxElements.find(
      (candidate) =>
        handler.attributeStart >= candidate.start && handler.attributeEnd <= candidate.openingEnd,
    );
    if (!element) continue;

    const generatedAttrs = [
      ...handler.params.map((param) => param.attributeName),
      ...(emitElementParamTypes(handler.params) ? ['kovo-param-types'] : []),
    ];
    for (const name of generatedAttrs) {
      const existing = element.attributes.find((attribute) => attribute.name === name);
      if (!existing) continue;
      diagnostics.push(
        writerConflictDiagnostic(
          options,
          existing,
          name,
          'author JSX',
          'event handler param lowering',
        ),
      );
    }
  }

  return diagnostics;
}

function openingTagAttributeInsertion(
  hostElement: JsxElementModel,
  attributes: readonly string[],
): { position: number; replacement: string } {
  const attributeSource = attributes.join(' ');
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
  return `\`${value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')}\``;
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
