import { compilerIrHeader } from '../ir.js';
import {
  outputContextForAttribute,
  type GeneratedOutputWriteFact,
} from '../output-context-facts.js';
import {
  componentHasInferredServerRefreshTarget,
  componentOptionObjectKeys,
  componentRenderHost,
  componentRenderHostElement,
  componentStateReturnObjectModel,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
} from '../scan/parse.js';
import { escapeAttribute, splitDepValue, type SourceReplacement } from '../shared.js';
import {
  emitElementParamTypes,
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
    if (!hostElement) return { diagnostics, outputContexts, replacements: patches, stampWrites };

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
    const hostStamps = renderHostStampWrites(
      model,
      hostElement,
      domComponentName,
      options?.registryComponentName ?? domComponentName,
    );
    stampWrites.push(...hostStamps.writes);
    patches.push(...renderHostStampPatches(hostElement, hostStamps.writes));
    outputContexts.push(...renderHostStampOutputContexts(hostStamps.writes));
    if (options)
      diagnostics.push(...renderHostStampConflictDiagnostics(hostStamps.conflicts, options));
  }

  return { diagnostics, outputContexts, replacements: patches, stampWrites };
}

function handlerOutputContexts(handler: HandlerLowering): GeneratedOutputWriteFact[] {
  return [
    {
      context: outputContextForAttribute(handler.attributeName),
      expression: handler.attributeValue,
      sink: handler.attributeName,
      source: 'server-render',
      writer: 'event handler lowering',
    },
    ...handler.params.map((param) => ({
      context: outputContextForAttribute(param.attributeName),
      expression: param.value,
      sink: param.attributeName,
      source: 'server-render' as const,
      writer: 'event handler param lowering',
    })),
  ];
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
  return [
    `${name}="${escapeAttribute(
      [
        ...handlers.map((handler) => handler.attributeValue),
        ...primitiveRefs.split(/\s+/).filter(Boolean),
      ].join(' '),
    )}"`,
    emitElementParamTypes(handlers.flatMap((handler) => handler.params)),
    ...handlers.flatMap((handler) =>
      handler.params.map((param) => `${param.attributeName}="${escapeAttribute(param.value)}"`),
    ),
  ]
    .filter(Boolean)
    .join(' ');
}

function handlerSourceReplacement(handler: HandlerLowering): SourceReplacement {
  return {
    end: handler.attributeEnd,
    replacement: handlerAttributeReplacement(handler),
    start: handler.attributeStart,
  };
}

function handlerAttributeReplacement(handler: HandlerLowering): string {
  return [
    `${handler.attributeName}="${handler.attributeValue}"`,
    emitElementParamTypes(handler.params),
    ...handler.params.map((param) => `${param.attributeName}="${escapeAttribute(param.value)}"`),
  ]
    .filter(Boolean)
    .join(' ');
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
  model: ComponentModuleModel,
  hostElement: JsxElementModel,
  domComponentName: string,
  registryComponentName: string,
): {
  conflicts: readonly HostStampConflict[];
  writes: readonly ServerRenderStampWriteFact[];
} {
  const conflicts: HostStampConflict[] = [];
  const writes: ServerRenderStampWriteFact[] = [];
  const componentIdentity = componentIdentityStamp(hostElement, domComponentName);
  const declaredQueryDeps = declaredQueryDepsStamp(model, hostElement);
  const fragmentTarget = inferredFragmentTargetStamp(model, hostElement, domComponentName);
  const liveComponent = liveComponentStamp(model, registryComponentName);
  const componentProps = componentPropsStamp(model, hostElement);
  const stateJson = staticStateJson(model);

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
  if (componentProps) {
    if (componentProps.mode === 'replace') {
      const existing = hostElement.attributes.find((attribute) => attribute.name === 'kovo-props');
      if (existing) {
        conflicts.push({ attribute: existing, attr: 'kovo-props', writer: 'host props stamp' });
      }
    }
    writes.push(componentProps);
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

function componentPropsStamp(
  model: ComponentModuleModel,
  hostElement: JsxElementModel,
): ServerRenderStampWriteFact | null {
  if (!componentHasInferredServerRefreshTarget(model)) return null;

  const props = componentOptionObjectKeys(model, 'props');
  if (props.length === 0) return null;

  const existing = hostElement.attributes.find((attribute) => attribute.name === 'kovo-props');
  return {
    attr: 'kovo-props',
    mode: existing ? 'replace' : 'insert',
    value: `JSON.stringify({ ${props.join(', ')} })`,
    valueKind: 'expression',
    writer: 'host props stamp',
  };
}

function liveComponentStamp(
  model: ComponentModuleModel,
  registryComponentName: string,
): ServerRenderStampWriteFact | null {
  if (!componentHasInferredServerRefreshTarget(model)) return null;

  return {
    attr: 'kovo-live-component',
    mode: 'insert',
    value: registryComponentName,
    writer: 'host live component stamp',
  };
}

function inferredFragmentTargetStamp(
  model: ComponentModuleModel,
  hostElement: JsxElementModel,
  domComponentName: string,
): ServerRenderStampWriteFact | null {
  if (!componentHasInferredServerRefreshTarget(model)) return null;

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
  model: ComponentModuleModel,
  hostElement: JsxElementModel,
): ServerRenderStampWriteFact | null {
  const deps = componentOptionObjectKeys(model, 'queries');
  if (deps.length === 0) return null;

  const existing = hostElement.attributes.find((attribute) => attribute.name === 'kovo-deps');
  const existingDeps = splitDepValue(existing?.value ?? '');
  const depValue = mergeDepValues(existingDeps, deps).join(' ');
  return {
    attr: 'kovo-deps',
    mode: existing ? 'replace' : 'insert',
    value: depValue,
    writer: 'host dependency stamp',
  };
}

function mergeDepValues(existing: readonly string[], declared: readonly string[]): string[] {
  return [...new Set([...existing, ...declared])];
}

function staticStateJson(model: ComponentModuleModel): string | null {
  const stateObject = componentStateReturnObjectModel(model);
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
