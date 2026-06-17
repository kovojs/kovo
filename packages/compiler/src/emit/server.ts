import { runInNewContext } from 'node:vm';

import { diagnosticDefinitions } from '@kovojs/core';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import { compilerIrHeader } from '../ir.js';
import {
  authorJsxAttributes,
  mergePrimitiveAndAuthorAttributes,
  primitiveObjectEntryAttributes,
  renderMergedAttributes,
} from '../lower/attribute-merge.js';
import { buildStaticHref } from '../lower/navigation.js';
import {
  outputContextForAttribute,
  type GeneratedOutputWriteFact,
} from '../output-context-facts.js';
import {
  componentOptionObjectKeys,
  componentHasInferredServerRefreshTarget,
  componentRenderHost,
  componentRenderHostElement,
  componentStateReturnObjectModel,
  parseComponentModule,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
  type SourceSpan,
} from '../scan/parse.js';
import { escapeAttribute, splitDepValue, type SourceReplacement } from '../shared.js';
import {
  emitElementParamTypes,
  type HandlerLowering,
  type RenderEquivalenceCheck,
} from '../types.js';

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
  attr: 'kovo-c' | 'kovo-deps' | 'kovo-fragment-target' | 'kovo-state';
  mode: 'insert' | 'preserve' | 'replace';
  value: string;
  writer:
    | 'host dependency stamp'
    | 'host fragment target stamp'
    | 'host identity stamp'
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
  options?: { fileName: string; source: string },
): ServerRenderLowering {
  return serverRenderPatches(handlers, model, domComponentName, options);
}

export function semanticRenderEquivalenceCheck(
  artifact: string,
  expectedModel: ComponentModuleModel,
  executableSource: string,
): RenderEquivalenceCheck {
  const expected = semanticRenderModel(expectedModel);
  const actualSource = emittedServerRenderSource(executableSource);
  const actualModel = parseComponentModule(artifact, actualSource);
  const actual = semanticRenderModel(actualModel);

  return {
    actual,
    artifact,
    detail:
      'SPEC §5.2 semantic render differential: render(src) differed from render(compile(src)).',
    expected,
    ok: actual === expected,
  };
}

function emittedServerRenderSource(serverSource: string): string {
  try {
    const actual = runInNewContext(`${serverSource}\n;renderSource();`, {}, { timeout: 1000 });
    return typeof actual === 'string' ? actual : '';
  } catch {
    return '';
  }
}

const voidElements = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

function semanticRenderModel(model: ComponentModuleModel): string {
  const host = componentRenderHostElement(model);
  if (!host) return '';

  return renderSemanticElement(model, host);
}

function renderSemanticElement(
  model: ComponentModuleModel,
  element: JsxElementModel,
  options: { forcedAttributes?: string } = {},
): string {
  const primitiveChild = semanticPrimitiveChild(model, element);
  if (primitiveChild) return renderSemanticElement(model, primitiveChild.child, primitiveChild);

  const tag = semanticElementTag(element);
  const attributes = options.forcedAttributes ?? renderSemanticAttributes(model, element);

  if (voidElements.has(tag)) return `<${tag}${attributes}>`;

  return `<${tag}${attributes}>${renderSemanticChildren(model, element)}</${tag}>`;
}

function semanticElementTag(element: JsxElementModel): string {
  return element.tag === 'Link' ? 'a' : element.tag;
}

function renderSemanticAttributes(model: ComponentModuleModel, element: JsxElementModel): string {
  if (element.tag === 'Link') {
    return [
      semanticLinkHrefAttribute(element),
      ...element.attributes
        .filter((attribute) => !['params', 'search', 'to'].includes(attribute.name))
        .map(renderSemanticAttribute),
    ]
      .filter((attribute): attribute is string => attribute !== null)
      .join('');
  }

  const viewTransitionStyle = semanticViewTransitionStyle(element);
  return element.attributes
    .filter((attribute) => attribute.name !== 'viewTransitionName')
    .filter((attribute) => !isQueryExpressionAttribute(model, attribute))
    .map((attribute) =>
      attribute.name === 'style' && viewTransitionStyle
        ? renderSemanticStyleAttribute(attribute, viewTransitionStyle)
        : renderSemanticAttribute(attribute),
    )
    .concat(
      viewTransitionStyle && !element.attributes.some((attribute) => attribute.name === 'style')
        ? [` style="${escapeAttribute(viewTransitionStyle)}"`]
        : [],
    )
    .filter((attribute): attribute is string => attribute !== null)
    .join('');
}

function isQueryExpressionAttribute(
  model: ComponentModuleModel,
  attribute: JsxAttributeModel,
): boolean {
  if (attribute.expression === undefined) return false;
  const queryNames = new Set(componentOptionObjectKeys(model, 'queries'));
  return (attribute.expressionPropertyAccesses ?? []).some((access) => {
    const [root] = access.path.split('.');
    return root !== undefined && queryNames.has(root);
  });
}

function semanticPrimitiveChild(
  model: ComponentModuleModel,
  element: JsxElementModel,
): { child: JsxElementModel; forcedAttributes: string } | null {
  if (!element.attributes.some((attribute) => attribute.name === 'asChild')) return null;
  const attrs = element.attributes.find((attribute) => attribute.name === 'attrs')
    ?.expressionObjectEntries;
  if (!attrs) return null;
  const primitiveAttributes = primitiveObjectEntryAttributes(attrs);
  if (!primitiveAttributes) return null;
  const [child] = directChildElements(model, element);
  if (!child) return null;
  const merge = mergePrimitiveAndAuthorAttributes(primitiveAttributes, authorJsxAttributes(child.attributes), {
    fileName: 'semantic-render',
    source: '',
  });
  const forcedAttributes = renderMergedAttributes(merge.attributes);
  return { child, forcedAttributes: forcedAttributes ? ` ${forcedAttributes}` : '' };
}

function semanticLinkHrefAttribute(element: JsxElementModel): string | null {
  const to = element.attributes.find((attribute) => attribute.name === 'to');
  if (!to) return null;
  const target =
    to.value ??
    (typeof to.expressionStaticValue === 'string' ? to.expressionStaticValue : undefined);
  if (target) {
    const params = semanticStaticObjectAttribute(element, 'params') ?? {};
    const search = semanticStaticObjectAttribute(element, 'search') ?? {};
    return ` href="${escapeAttribute(buildStaticHref(target, params, search))}"`;
  }
  if (to.expression !== undefined) return ` href="${escapeAttribute(`{${to.expression}}`)}"`;
  return null;
}

function semanticStaticObjectAttribute(
  element: JsxElementModel,
  name: string,
): Record<string, string | number | boolean | null> | null {
  const value = element.attributes.find((attribute) => attribute.name === name)
    ?.expressionStaticValue;
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string | number | boolean | null] => {
      const entryValue = entry[1];
      return entryValue === null || ['boolean', 'number', 'string'].includes(typeof entryValue);
    }),
  );
}

function semanticViewTransitionStyle(element: JsxElementModel): string | null {
  const transition = element.attributes.find(
    (attribute) => attribute.name === 'viewTransitionName' && attribute.value !== undefined,
  )?.value;
  return transition ? `view-transition-name: ${transition}` : null;
}

function renderSemanticStyleAttribute(
  attribute: JsxAttributeModel,
  extraStyle: string,
): string | null {
  const rendered = renderSemanticAttribute(attribute);
  if (!rendered) return null;
  if (attribute.value === undefined) return rendered;
  const existing = attribute.value.trim();
  const separator = existing === '' || existing.endsWith(';') ? '' : ';';
  const value = existing === '' ? extraStyle : `${existing}${separator} ${extraStyle}`;
  return ` style="${escapeAttribute(value)}"`;
}

function renderSemanticAttribute(attribute: JsxAttributeModel): string | null {
  if (isGeneratedOnlyRenderAttribute(attribute.name)) return null;
  if (attribute.domEventName || /^on[A-Z][\w-]*$/.test(attribute.name)) return null;

  if (attribute.value !== undefined) {
    return ` ${attribute.name}="${escapeAttribute(attribute.value)}"`;
  }

  if (attribute.expressionStaticValue !== undefined) {
    return renderStaticAttributeValue(attribute.name, attribute.expressionStaticValue);
  }

  if (attribute.expression !== undefined) {
    return ` ${attribute.name}="${escapeAttribute(`{${attribute.expression}}`)}"`;
  }

  return ` ${attribute.name}`;
}

function renderStaticAttributeValue(
  name: string,
  value: Exclude<JsxAttributeModel['expressionStaticValue'], undefined>,
): string | null {
  if (value === false || value === null) return null;
  if (value === true) return ` ${name}`;
  if (typeof value === 'string' || typeof value === 'number') {
    return ` ${name}="${escapeAttribute(value.toString())}"`;
  }

  return ` ${name}="${escapeAttribute(JSON.stringify(value) ?? '')}"`;
}

function renderSemanticChildren(model: ComponentModuleModel, element: JsxElementModel): string {
  const body = element.childBody;
  if (!body) return '';

  const bodyEnd = body.offset + body.source.length;
  const tokens = [
    ...directChildElements(model, element).map((child) => ({
      end: child.end,
      render: () => renderSemanticElement(model, child),
      start: child.start,
    })),
    ...element.childExpressionContainers.map((container) => ({
      end: container.end,
      render: () => renderSemanticExpression(model, container),
      start: container.start,
    })),
  ].toSorted((left, right) => left.start - right.start || left.end - right.end);

  let output = '';
  let cursor = body.offset;

  for (const token of tokens) {
    if (token.start < body.offset || token.end > bodyEnd || token.start < cursor) continue;
    output += childBodySlice(body, cursor, token.start);
    output += token.render();
    cursor = token.end;
  }

  output += childBodySlice(body, cursor, bodyEnd);
  return output;
}

function directChildElements(
  model: ComponentModuleModel,
  parent: JsxElementModel,
): JsxElementModel[] {
  const candidates = model.jsxElements.filter(
    (element) =>
      element !== parent &&
      element.start >= parent.openingEnd &&
      element.end <= parent.closingStart,
  );

  return candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) =>
          other !== candidate && candidate.start >= other.openingEnd && candidate.end <= other.end,
      ),
  );
}

function renderSemanticExpression(model: ComponentModuleModel, container: SourceSpan): string {
  const expression = model.jsxExpressions.find(
    (candidate) =>
      candidate.containerStart === container.start && candidate.containerEnd === container.end,
  );
  return expression ? `{${normalizeGeneratedSemanticExpression(expression.expression)}}` : '';
}

function normalizeGeneratedSemanticExpression(expression: string): string {
  return expression.replace(/\bescapeText\(([^()]+)\)/g, '$1');
}

function childBodySlice(
  body: NonNullable<JsxElementModel['childBody']>,
  start: number,
  end: number,
): string {
  return body.source.slice(start - body.offset, end - body.offset);
}

function isGeneratedOnlyRenderAttribute(name: string): boolean {
  // SPEC §5.2 rule 3 permits the semantic gate to ignore generated-only stamps while requiring
  // byte-identical visible HTML. SPEC §4.8 defines binding stamps as compiler-derived IR.
  return (
    name === 'kovo-c' ||
    name === 'kovo-deps' ||
    name === 'kovo-fragment-target' ||
    name === 'kovo-state' ||
    name === 'kovo-param-types' ||
    name === 'data-bind' ||
    name === 'data-derive' ||
    name === 'data-derive-attr' ||
    name.startsWith('data-bind:') ||
    name.startsWith('data-p-') ||
    name.startsWith('on:')
  );
}

function serverRenderPatches(
  handlers: readonly HandlerLowering[],
  model: ComponentModuleModel,
  domComponentName: string,
  options?: { fileName: string; source: string },
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
    const hostStamps = renderHostStampWrites(model, hostElement, domComponentName);
    stampWrites.push(...hostStamps.writes);
    patches.push(...renderHostStampPatches(hostElement, hostStamps.writes));
    outputContexts.push(...renderHostStampOutputContexts(hostStamps.writes));
    if (options) diagnostics.push(...renderHostStampConflictDiagnostics(hostStamps.conflicts, options));
  }

  return { diagnostics, outputContexts, replacements: patches, stampWrites };
}

function handlerOutputContexts(
  handler: HandlerLowering,
): GeneratedOutputWriteFact[] {
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
): {
  conflicts: readonly HostStampConflict[];
  writes: readonly ServerRenderStampWriteFact[];
} {
  const conflicts: HostStampConflict[] = [];
  const writes: ServerRenderStampWriteFact[] = [];
  const componentIdentity = componentIdentityStamp(hostElement, domComponentName);
  const declaredQueryDeps = declaredQueryDepsStamp(model, hostElement);
  const fragmentTarget = inferredFragmentTargetStamp(model, hostElement, domComponentName);
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
  attr: 'kovo-c' | 'kovo-fragment-target' | 'kovo-state';
  attribute: JsxAttributeModel;
  writer: 'host fragment target stamp' | 'host identity stamp' | 'host state stamp';
}

function renderHostStampAttribute(write: ServerRenderStampWriteFact): string {
  return `${write.attr}="${escapeAttribute(write.value)}"`;
}

function sameEscapedOrRawAttributeValue(
  actual: string | undefined,
  expectedRaw: string,
): boolean {
  return actual === expectedRaw || actual === escapeAttribute(expectedRaw);
}

function renderHostStampConflictDiagnostics(
  conflicts: readonly HostStampConflict[],
  options: { fileName: string; source: string },
): CompilerDiagnostic[] {
  return conflicts.map((conflict) =>
    writerConflictDiagnostic(options, conflict.attribute, conflict.attr, 'author JSX', conflict.writer),
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
        writerConflictDiagnostic(options, existing, name, 'author JSX', 'event handler param lowering'),
      );
    }
  }

  return diagnostics;
}

function writerConflictDiagnostic(
  options: { fileName: string; source: string },
  attribute: JsxAttributeModel,
  detail: string,
  firstWriter: string,
  secondWriter: string,
): CompilerDiagnostic {
  return {
    ...diagnosticFor(
      options.fileName,
      'KV231',
      options.source,
      attribute.start,
      attribute.end - attribute.start,
    ),
    message: `${diagnosticDefinitions.KV231.message} ${detail} (writers: ${firstWriter}, ${secondWriter})`,
  };
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
