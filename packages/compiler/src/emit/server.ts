import { runInNewContext } from 'node:vm';

import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import type * as CoreGraph from '@kovojs/core/internal/graph';

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
import { mutationInputFactsFromSource, type LocalMutationInputFact } from '../mutation-inputs.js';
import {
  componentOptionObjectEntries,
  componentOptionObjectKeys,
  componentHasInferredServerRefreshTarget,
  componentRenderHost,
  componentRenderHostElement,
  componentRenderSlotsParam,
  componentStateReturnObjectModel,
  parseComponentModule,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
  type SourceSpan,
} from '../scan/parse.js';
import { escapeAttribute, kebabCase, splitDepValue, type SourceReplacement } from '../shared.js';
import {
  emitElementParamTypes,
  type HandlerLowering,
  type RenderEquivalenceCheck,
  type RegistryFacts,
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

export function semanticRenderEquivalenceCheck(
  artifact: string,
  expectedModel: ComponentModuleModel,
  executableSource: string,
  options: SemanticRenderContext = {},
): RenderEquivalenceCheck {
  const expected = semanticRenderModel(expectedModel, options);
  const actualSource = emittedServerRenderSource(executableSource);
  const actualModel = parseComponentModule(artifact, actualSource);
  const actual = semanticRenderModel(actualModel);
  const normalizedExpected = normalizeSemanticHtmlForComparison(expected);
  const normalizedActual = normalizeSemanticHtmlForComparison(actual);
  const ok = normalizedActual === normalizedExpected;

  return {
    actual: ok ? normalizedActual : actual,
    artifact,
    detail:
      'SPEC §5.2 semantic render differential: render(src) differed from render(compile(src)).',
    expected: ok ? normalizedExpected : expected,
    ok,
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

function normalizeSemanticHtmlForComparison(html: string): string {
  return html.replace(/<[^>]*>/g, (tag) => normalizeSemanticTagForComparison(tag));
}

function normalizeSemanticTagForComparison(tag: string): string {
  if (!tag.startsWith('<') || !tag.endsWith('>')) return tag;
  const body = tag.slice(1, -1);
  if (body.startsWith('/') || body.startsWith('!') || body.trim() === '') return tag;

  const match = /^([^\s/>]+)([\s\S]*)$/.exec(body);
  if (!match) return tag;

  const [, name, rest = ''] = match;
  const attributes = splitSemanticTagAttributes(rest.trim());
  if (attributes.length <= 1) return tag;

  const sorted = [...attributes].sort((left, right) => {
    const nameOrder = semanticAttributeName(left).localeCompare(semanticAttributeName(right));
    return nameOrder === 0 ? left.localeCompare(right) : nameOrder;
  });
  return `<${name} ${sorted.join(' ')}>`;
}

function splitSemanticTagAttributes(source: string): string[] {
  if (source.length === 0) return [];

  const attributes: string[] = [];
  let start = 0;
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === undefined) continue;
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      const attribute = source.slice(start, index).trim();
      if (attribute) attributes.push(attribute);
      start = index + 1;
    }
  }

  const tail = source.slice(start).trim();
  if (tail) attributes.push(tail);
  return attributes;
}

function semanticAttributeName(attribute: string): string {
  const equalsIndex = attribute.indexOf('=');
  return equalsIndex === -1 ? attribute : attribute.slice(0, equalsIndex);
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

interface SemanticRenderContext {
  registryFacts?: RegistryFacts;
}

interface SemanticElementOptions extends SemanticRenderContext {
  forcedAttributes?: string;
}

function semanticRenderModel(
  model: ComponentModuleModel,
  options: SemanticRenderContext = {},
): string {
  const host = componentRenderHostElement(model);
  if (!host) return '';

  return renderSemanticElement(model, host, options);
}

function renderSemanticElement(
  model: ComponentModuleModel,
  element: JsxElementModel,
  options: SemanticElementOptions = {},
): string {
  const formError = semanticMutationFormErrorExpression(model, element);
  if (formError) return formError;

  const primitiveChild = semanticPrimitiveChild(model, element);
  if (primitiveChild) {
    return renderSemanticElement(model, primitiveChild.child, { ...options, ...primitiveChild });
  }

  const tag = semanticElementTag(element);
  const attributes = options.forcedAttributes ?? renderSemanticAttributes(model, element, options);

  if (voidElements.has(tag)) return `<${tag}${attributes}>`;

  return `<${tag}${attributes}>${renderSemanticChildren(model, element, options)}</${tag}>`;
}

function semanticElementTag(element: JsxElementModel): string {
  return element.tag === 'Link' ? 'a' : element.tag;
}

function renderSemanticAttributes(
  model: ComponentModuleModel,
  element: JsxElementModel,
  options: SemanticRenderContext = {},
): string {
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

  const formMutation = enhancedMutationFormLowering(model, element, options.registryFacts);
  const viewTransitionStyle = semanticViewTransitionStyle(element);
  const fieldErrorDescribedBy = semanticFieldErrorDescribedByAttribute(model, element);
  const semanticAttributes: string[] = [];
  for (const attribute of element.attributes) {
    if (attribute.name === 'viewTransitionName' || isQueryExpressionAttribute(model, attribute)) {
      continue;
    }
    if (
      element.tag === 'form' &&
      attribute.name === 'mutation' &&
      hasGeneratedMutationFormAttributes(element)
    ) {
      continue;
    }
    if (formMutation?.generatedAttributeNames.has(attribute.name)) {
      if (attribute.name === 'mutation')
        semanticAttributes.push(...formMutation.semanticAttributes);
      continue;
    }
    const rendered =
      attribute.name === 'style' && viewTransitionStyle
        ? renderSemanticStyleAttribute(attribute, viewTransitionStyle)
        : attribute.name === 'streamText'
          ? renderSemanticAttributeWithName('data-stream-text', attribute)
          : renderSemanticAttribute(attribute);
    if (rendered) semanticAttributes.push(rendered);
  }
  return semanticAttributes
    .concat(
      viewTransitionStyle && !element.attributes.some((attribute) => attribute.name === 'style')
        ? [` style="${escapeAttribute(viewTransitionStyle)}"`]
        : [],
      fieldErrorDescribedBy &&
        !element.attributes.some((attribute) => attribute.name === 'aria-describedby')
        ? [fieldErrorDescribedBy]
        : [],
    )
    .join('');
}

function semanticMutationFormErrorExpression(
  model: ComponentModuleModel,
  element: JsxElementModel,
): string | null {
  if (element.tag !== 'FieldError' && element.tag !== 'FormError') return null;

  const form = enclosingEnhancedMutationForm(model, element);
  const binding = form ? enhancedMutationFormBinding(form) : null;
  const slotsParam = componentRenderSlotsParam(model);
  const slotName = binding ? componentMutationSlotName(model, binding.localName) : null;
  if (!form || !binding || !slotName) return '';
  if (!slotsParam) return null;

  return `{${element.tag}(${mutationFormErrorProps(element, form, slotName, slotsParam.name)})}`;
}

function semanticFieldErrorDescribedByAttribute(
  model: ComponentModuleModel,
  control: JsxElementModel,
): string | null {
  if (!['input', 'select', 'textarea'].includes(control.tag)) return null;
  const name = staticStringAttributeValue(
    control.attributes.find((attribute) => attribute.name === 'name'),
  );
  if (!name) return null;

  const form = model.jsxElements
    .filter(
      (element) =>
        element.tag === 'form' &&
        control.start >= element.openingEnd &&
        control.end <= element.closingStart,
    )
    .sort((left, right) => right.start - left.start)[0];
  if (!form) return null;

  const fieldError = model.jsxElements.find(
    (element) =>
      element.tag === 'FieldError' &&
      element.start >= form.openingEnd &&
      element.end <= form.closingStart &&
      staticStringAttributeValue(
        element.attributes.find((attribute) => attribute.name === 'name'),
      ) === name,
  );
  if (!fieldError) return null;

  const explicitId = staticStringAttributeValue(
    fieldError.attributes.find((attribute) => attribute.name === 'id'),
  );
  const binding = enhancedMutationFormBinding(form);
  const slotName = binding ? componentMutationSlotName(model, binding.localName) : null;
  const id = explicitId
    ? { expression: JSON.stringify(explicitId), source: JSON.stringify(explicitId) }
    : slotName
      ? mutationFormErrorIdExpression(form, slotName, name)
      : null;
  if (!id) return null;

  return ` aria-describedby="${escapeAttribute(`{${id.expression}}`)}"`;
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
  const attrs = element.attributes.find(
    (attribute) => attribute.name === 'attrs',
  )?.expressionObjectEntries;
  if (!attrs) return null;
  const primitiveAttributes = primitiveObjectEntryAttributes(attrs);
  if (!primitiveAttributes) return null;
  const [child] = directChildElements(model, element);
  if (!child) return null;
  const merge = mergePrimitiveAndAuthorAttributes(
    primitiveAttributes,
    authorJsxAttributes(child.attributes),
    {
      fileName: 'semantic-render',
      source: '',
    },
  );
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
  const value = element.attributes.find(
    (attribute) => attribute.name === name,
  )?.expressionStaticValue;
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
  return renderSemanticAttributeWithName(attribute.name, attribute);
}

function renderSemanticAttributeWithName(
  name: string,
  attribute: JsxAttributeModel,
): string | null {
  if (isGeneratedOnlyRenderAttribute(attribute.name)) return null;
  if (attribute.domEventName || /^on[A-Z][\w-]*$/.test(attribute.name)) return null;

  if (attribute.value !== undefined) {
    return ` ${name}="${escapeAttribute(attribute.value)}"`;
  }

  if (attribute.expressionStaticValue !== undefined) {
    return renderStaticAttributeValue(name, attribute.expressionStaticValue);
  }

  if (attribute.expression !== undefined) {
    return ` ${name}="${escapeAttribute(`{${attribute.expression}}`)}"`;
  }

  return ` ${name}`;
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

function renderSemanticChildren(
  model: ComponentModuleModel,
  element: JsxElementModel,
  options: SemanticRenderContext = {},
): string {
  const body = element.childBody;
  if (!body) return '';

  const bodyEnd = body.offset + body.source.length;
  const tokens = [
    ...directChildElements(model, element).map((child) => ({
      end: child.end,
      render: () => renderSemanticElement(model, child, options),
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
  if (!expression) return '';
  const normalized = normalizeGeneratedSemanticExpression(expression.expression);
  return normalized === '' ? '' : `{${normalized}}`;
}

function normalizeGeneratedSemanticExpression(expression: string): string {
  return expression
    .replace(/\bescapeText\(([^()]+)\)/g, '$1')
    .replace(/\b__kovoRenderMutationCsrfField\([^()]*\)/g, '')
    .replace(/\b__kovoRenderMutationIdemField\(\)/g, '');
}

function hasGeneratedMutationFormAttributes(element: JsxElementModel): boolean {
  return (
    element.attributes.some((attribute) => attribute.name === 'action') &&
    element.attributes.some((attribute) => attribute.name === 'data-mutation')
  );
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
    name === 'kovo-live-component' ||
    name === 'kovo-props' ||
    name === 'kovo-key' ||
    name === 'kovo-state' ||
    name === 'kovo-param-types' ||
    name === 'data-bind' ||
    name === 'data-derive' ||
    name === 'data-derive-attr' ||
    name === 'command' ||
    name === 'commandfor' ||
    name === 'popovertarget' ||
    name === 'popovertargetaction' ||
    name.startsWith('data-bind:') ||
    name.startsWith('data-p-') ||
    name.startsWith('on:')
  );
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

function mutationFormErrorRenderLowering(
  model: ComponentModuleModel,
  options?: { fileName: string; registryFacts?: RegistryFacts; source: string },
): {
  diagnostics: readonly CompilerDiagnostic[];
  replacements: readonly SourceReplacement[];
} {
  if (!options) return { diagnostics: [], replacements: [] };

  const diagnostics: CompilerDiagnostic[] = [];
  const replacements: SourceReplacement[] = [];

  for (const element of model.jsxElements) {
    if (element.tag !== 'FieldError' && element.tag !== 'FormError') continue;

    const form = enclosingEnhancedMutationForm(model, element);
    if (!form) {
      diagnostics.push(
        formFieldDiagnostic(
          options,
          element.openingTagNameStart,
          element.openingTagNameEnd - element.openingTagNameStart,
          `<${element.tag}> must be rendered inside an enhanced mutation form`,
        ),
      );
      continue;
    }

    const binding = enhancedMutationFormBinding(form);
    if (!binding) {
      diagnostics.push(
        formFieldDiagnostic(
          options,
          element.openingTagNameStart,
          element.openingTagNameEnd - element.openingTagNameStart,
          `<${element.tag}> must be rendered inside a form with mutation={...} or mutationFormAttributes(...)`,
        ),
      );
      continue;
    }

    const slotsParam = componentRenderSlotsParam(model);
    const slotName = componentMutationSlotName(model, binding.localName);
    if (!slotName) {
      diagnostics.push(
        formFieldDiagnostic(
          options,
          element.openingTagNameStart,
          element.openingTagNameEnd - element.openingTagNameStart,
          `<${element.tag}> could not resolve the component-local mutation slot for ${binding.localName}`,
        ),
      );
      continue;
    }

    if (element.tag === 'FieldError') {
      diagnostics.push(...fieldErrorDiagnostics(model, element, binding.localName, options));
    }
    if (!slotsParam) continue;

    const lowered = lowerMutationFormErrorElement(model, element, form, slotName, slotsParam.name);
    replacements.push(...lowered.replacements);
  }

  return { diagnostics, replacements };
}

function componentMutationSlotName(
  model: ComponentModuleModel,
  mutationLocalName: string,
): string | null {
  const entries = componentOptionObjectEntries(model, 'mutations');
  const exact = entries.find((entry) => entry.key === mutationLocalName);
  if (exact) return exact.key;

  const valueMatch = entries.find((entry) => entry.value === mutationLocalName);
  if (valueMatch) return valueMatch.key;

  if (entries.length === 1) return entries[0]?.key ?? null;
  return mutationLocalName;
}

export function mutationFormExplainFacts(
  model: ComponentModuleModel,
  options: { fileName: string; registryFacts?: RegistryFacts; source: string },
): CoreGraph.MutationFormExplain[] {
  const forms: CoreGraph.MutationFormExplain[] = [];

  for (const form of model.jsxElements) {
    if (form.tag !== 'form') continue;
    const binding = enhancedMutationFormBinding(form);
    if (!binding) continue;

    const mutationKey = localMutationKey(model, binding.localName, options.registryFacts);
    const mutationInput = mutationInputFactForForm(model, binding.localName, options);
    if (!mutationKey && !mutationInput) continue;

    const slot = componentMutationSlotName(model, binding.localName) ?? binding.localName;
    const fieldErrors = mutationFormFieldErrorFacts(model, form, slot);
    const formErrors = mutationFormErrorFacts(model, form);

    forms.push({
      ...(fieldErrors.length === 0 ? {} : { fieldErrors }),
      ...(mutationInput === null
        ? {}
        : { fields: mutationInput.fields.map((field) => field.name) }),
      ...(formErrors.length === 0 ? {} : { formErrors }),
      mutation: mutationInput?.key ?? mutationKey ?? binding.localName,
      slot,
    });
  }

  return forms;
}

function mutationFormFieldErrorFacts(
  model: ComponentModuleModel,
  form: JsxElementModel,
  slot: string,
): CoreGraph.MutationFormFieldErrorExplain[] {
  return model.jsxElements
    .filter(
      (element) =>
        element.tag === 'FieldError' && enclosingEnhancedMutationForm(model, element) === form,
    )
    .flatMap((element) => {
      const name = staticStringAttributeValue(
        element.attributes.find((attribute) => attribute.name === 'name'),
      );
      if (!name) return [];
      const authoredId = staticStringAttributeValue(
        element.attributes.find((attribute) => attribute.name === 'id'),
      );
      const generatedId = mutationFormErrorIdExpression(form, slot, name).source;
      const id = authoredId ?? generatedId.replace(/^"|"$/g, '');

      return [{ id, name }];
    });
}

function mutationFormErrorFacts(
  model: ComponentModuleModel,
  form: JsxElementModel,
): CoreGraph.MutationFormErrorExplain[] {
  return model.jsxElements
    .filter(
      (element) =>
        element.tag === 'FormError' && enclosingEnhancedMutationForm(model, element) === form,
    )
    .map((element) => {
      const code = staticStringAttributeValue(
        element.attributes.find((attribute) => attribute.name === 'code'),
      );
      return code ? { code } : {};
    });
}

function enclosingEnhancedMutationForm(
  model: ComponentModuleModel,
  child: JsxElementModel,
): JsxElementModel | null {
  const forms = model.jsxElements
    .filter(
      (element) =>
        element.tag === 'form' &&
        child.start >= element.openingEnd &&
        child.end <= element.closingStart &&
        enhancedMutationFormBinding(element),
    )
    .sort((left, right) => right.start - left.start);

  return forms[0] ?? null;
}

function fieldErrorDiagnostics(
  model: ComponentModuleModel,
  element: JsxElementModel,
  localName: string,
  options: { fileName: string; registryFacts?: RegistryFacts; source: string },
): CompilerDiagnostic[] {
  const nameAttribute = element.attributes.find((attribute) => attribute.name === 'name');
  if (!nameAttribute) {
    return [
      formFieldDiagnostic(
        options,
        element.openingTagNameStart,
        element.openingTagNameEnd - element.openingTagNameStart,
        '<FieldError> requires a literal name from the enclosing mutation input schema',
      ),
    ];
  }

  const name = staticStringAttributeValue(nameAttribute);
  if (!name) {
    return [
      formFieldDiagnostic(
        options,
        nameAttribute.start,
        nameAttribute.end - nameAttribute.start,
        'dynamic field error names are not supported; use a literal name from the mutation input schema',
      ),
    ];
  }

  const mutation = mutationInputFactForForm(model, localName, options);
  if (!mutation) return [];

  const fieldNames = new Set(mutation.fields.map((field) => field.name));
  if (fieldNames.has(name)) return [];

  return [
    formFieldDiagnostic(
      options,
      nameAttribute.start,
      nameAttribute.end - nameAttribute.start,
      `unknown field "${name}" for mutation "${mutation.key}". Expected fields: ${[
        ...fieldNames,
      ].join(', ')}`,
    ),
  ];
}

function lowerMutationFormErrorElement(
  model: ComponentModuleModel,
  element: JsxElementModel,
  form: JsxElementModel,
  localName: string,
  slotsParamName: string,
): { replacements: readonly SourceReplacement[] } {
  const props = mutationFormErrorProps(element, form, localName, slotsParamName);
  const replacements: SourceReplacement[] = [
    {
      end: element.end,
      replacement: `{${element.tag}(${props})}`,
      start: element.start,
    },
  ];

  if (element.tag === 'FieldError') {
    const name = staticStringAttributeValue(
      element.attributes.find((attribute) => attribute.name === 'name'),
    );
    const id = staticStringAttributeValue(
      element.attributes.find((attribute) => attribute.name === 'id'),
    );
    if (name) {
      const errorId = id
        ? { expression: JSON.stringify(id), source: JSON.stringify(id) }
        : mutationFormErrorIdExpression(form, localName, name);
      replacements.push(...fieldControlDescribedByReplacements(model, form, name, errorId));
    }
  }

  return { replacements };
}

function mutationFormErrorProps(
  element: JsxElementModel,
  form: JsxElementModel,
  localName: string,
  slotsParamName: string,
): string {
  const entries = [
    `"failure": ${slotsParamName}.forms.${localName}.failure`,
    ...element.attributes.map((attribute) => jsxAttributeObjectEntry(attribute)),
  ];
  if (!element.attributes.some((attribute) => attribute.name === 'id')) {
    const name = staticStringAttributeValue(
      element.attributes.find((attribute) => attribute.name === 'name'),
    );
    if (name)
      entries.push(`"id": ${mutationFormErrorIdExpression(form, localName, name).expression}`);
  }
  const children = jsxElementChildrenExpression(element);
  if (children) entries.push(`"children": ${children}`);
  return `{ ${entries.filter(Boolean).join(', ')} }`;
}

function jsxAttributeObjectEntry(attribute: JsxAttributeModel): string {
  const key = JSON.stringify(attribute.name);
  if (attribute.value !== undefined) return `${key}: ${JSON.stringify(attribute.value)}`;
  if (attribute.expression !== undefined) return `${key}: ${attribute.expression}`;
  const staticValue = attribute.expressionStaticValue;
  if (staticValue !== undefined) return `${key}: ${JSON.stringify(staticValue)}`;
  return `${key}: true`;
}

function jsxElementChildrenExpression(element: JsxElementModel): string | null {
  if (element.selfClosing || !element.childBody) return null;
  const childSource = element.childBody.source.trim();
  if (!childSource) return null;
  if (!/[<{]/.test(childSource)) return JSON.stringify(childSource);
  return `<>${element.childBody.source}</>`;
}

function fieldControlDescribedByReplacements(
  model: ComponentModuleModel,
  form: JsxElementModel,
  name: string,
  errorId: { expression: string; source: string },
): SourceReplacement[] {
  return formControlElements(model, form, name).flatMap((control) => {
    if (control.attributes.some((attribute) => attribute.name === 'aria-describedby')) return [];
    const position = openingTagAttributePosition(control);
    return [
      {
        end: position,
        replacement: ` aria-describedby=${errorId.source}`,
        start: position,
      },
    ];
  });
}

function formControlElements(
  model: ComponentModuleModel,
  form: JsxElementModel,
  name: string,
): JsxElementModel[] {
  const formEnd = form.selfClosing ? form.end : form.closingStart;
  return model.jsxElements.filter((element) => {
    if (!['input', 'select', 'textarea'].includes(element.tag)) return false;
    if (element.start < form.openingEnd || element.end > formEnd) return false;
    if (element.attributes.some((attribute) => attribute.name === 'disabled')) return false;
    const type = staticStringAttributeValue(
      element.attributes.find((attribute) => attribute.name === 'type'),
    )?.toLowerCase();
    if (element.tag === 'input' && type === 'hidden') return false;
    return (
      staticStringAttributeValue(
        element.attributes.find((attribute) => attribute.name === 'name'),
      ) === name
    );
  });
}

function openingTagAttributePosition(element: JsxElementModel): number {
  if (!element.selfClosing) return element.openingEnd - 1;
  return element.openingEnd - (element.selfClosingSlashHasLeadingWhitespace ? 2 : 1);
}

function mutationFormErrorIdExpression(
  form: JsxElementModel,
  localName: string,
  fieldName: string,
): { expression: string; source: string } {
  const base = `${kebabCase(localName)}-${fieldName}-error`;
  const keyAttribute = form.attributes.find((attribute) => attribute.name === 'key');
  if (!keyAttribute) {
    const literal = JSON.stringify(base);
    return { expression: literal, source: literal };
  }

  const key = staticAttributeScalar(keyAttribute);
  if (key !== null) {
    const literal = JSON.stringify(`${base}-${key}`);
    return { expression: literal, source: literal };
  }

  const expression = `\`${escapeTemplateLiteral(base)}-\${${keyAttribute.expression ?? ''}}\``;
  return { expression, source: `{${expression}}` };
}

function enhancedMutationFormRenderLowering(
  model: ComponentModuleModel,
  options?: { fileName: string; registryFacts?: RegistryFacts; source: string },
): {
  diagnostics: readonly CompilerDiagnostic[];
  outputContexts: readonly GeneratedOutputWriteFact[];
  replacements: readonly SourceReplacement[];
} {
  const diagnostics: CompilerDiagnostic[] = [];
  const replacements: SourceReplacement[] = [];
  const outputContexts: GeneratedOutputWriteFact[] = [];
  let needsCsrfImport = false;

  for (const element of model.jsxElements) {
    const repeatableDiagnostic = repeatableMutationFormDiagnostic(model, element, options);
    if (repeatableDiagnostic) {
      diagnostics.push(repeatableDiagnostic);
      continue;
    }

    if (options) diagnostics.push(...mutationFormFieldDiagnostics(model, element, options));

    const lowering = enhancedMutationFormLowering(model, element, options?.registryFacts);
    if (!lowering) continue;

    replacements.push(...lowering.replacements);
    needsCsrfImport ||= lowering.importsMutationCsrfField;
    outputContexts.push(...lowering.outputContexts);
    if (options) {
      diagnostics.push(
        ...lowering.conflicts.map((conflict) =>
          writerConflictDiagnostic(
            options,
            conflict.attribute,
            conflict.attribute.name,
            'author JSX',
            'typed mutation form lowering',
          ),
        ),
      );
    }
  }

  if (needsCsrfImport && options && !importsMutationCsrfField(model)) {
    const start = compilerHelperImportInsertionOffset(options.source);
    replacements.push({
      end: start,
      // SPEC.md §10.3:1063/1065: also import renderMutationIdemField so each
      // emitted form body includes a per-submit idempotency token alongside CSRF.
      replacement:
        "import { renderMutationCsrfField as __kovoRenderMutationCsrfField, renderMutationIdemField as __kovoRenderMutationIdemField } from '@kovojs/server/internal/csrf';\n",
      start,
    });
  }

  return { diagnostics, outputContexts, replacements };
}

function streamTextTargetRenderLowering(
  model: ComponentModuleModel,
  options?: { fileName: string; registryFacts?: RegistryFacts; source: string },
): {
  diagnostics: readonly CompilerDiagnostic[];
  outputContexts: readonly GeneratedOutputWriteFact[];
  replacements: readonly SourceReplacement[];
} {
  const diagnostics: CompilerDiagnostic[] = [];
  const outputContexts: GeneratedOutputWriteFact[] = [];
  const replacements: SourceReplacement[] = [];

  for (const element of model.jsxElements) {
    const streamText = element.attributes.find((attribute) => attribute.name === 'streamText');
    const residual = element.attributes.find((attribute) => attribute.name === 'data-stream-text');

    if (streamText && residual && options) {
      diagnostics.push(
        writerConflictDiagnostic(
          options,
          residual,
          'data-stream-text',
          'author JSX',
          'stream text target lowering',
        ),
      );
    }

    const targetAttribute = streamText ?? residual;
    if (!targetAttribute) continue;

    const literalTarget = staticStringAttributeValue(targetAttribute);
    if (options && literalTarget !== null && !isValidStreamTextTarget(literalTarget)) {
      diagnostics.push(streamTextTargetDiagnostic(options, targetAttribute, literalTarget));
    }

    if (streamText) {
      replacements.push({
        end: streamText.end,
        replacement: renderAttributeWithName('data-stream-text', streamText),
        start: streamText.start,
      });
      outputContexts.push(
        formLoweringOutputContext(
          'data-stream-text',
          attributeValueExpression(streamText),
          'stream text target lowering',
        ),
      );
    }
  }

  return { diagnostics, outputContexts, replacements };
}

function isValidStreamTextTarget(target: string): boolean {
  return /^[A-Za-z][A-Za-z0-9-]*:[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(target);
}

function streamTextTargetDiagnostic(
  options: { fileName: string; source: string },
  attribute: JsxAttributeModel,
  target: string,
): CompilerDiagnostic {
  return {
    ...diagnosticFor(
      options.fileName,
      'KV243',
      options.source,
      attribute.start,
      attribute.end - attribute.start,
    ),
    message: `${diagnosticDefinitions.KV243.message} "${target}" is not a stream source id; expected "source:id", not a selector or unscoped id.`,
  };
}

interface EnhancedMutationFormConflict {
  attribute: JsxAttributeModel;
}

interface EnhancedMutationFormLowering {
  conflicts: readonly EnhancedMutationFormConflict[];
  generatedAttributeNames: ReadonlySet<string>;
  importsMutationCsrfField: boolean;
  outputContexts: readonly GeneratedOutputWriteFact[];
  replacements: readonly SourceReplacement[];
  semanticAttributes: readonly string[];
}

type MutationInputFact = LocalMutationInputFact;

function enhancedMutationFormLowering(
  model: ComponentModuleModel,
  element: JsxElementModel,
  registryFacts?: RegistryFacts,
): EnhancedMutationFormLowering | null {
  if (element.tag !== 'form') return null;

  const mutationAttribute = element.attributes.find((attribute) => attribute.name === 'mutation');
  if (!mutationAttribute?.expressionBareIdentifierName) return null;

  const mutationKey = localMutationKey(
    model,
    mutationAttribute.expressionBareIdentifierName,
    registryFacts,
  );
  if (!mutationKey) return null;

  const conflicts = enhancedMutationFormConflicts(element);
  if (conflicts.length > 0) {
    return {
      conflicts,
      generatedAttributeNames: new Set(),
      importsMutationCsrfField: false,
      outputContexts: [],
      replacements: [],
      semanticAttributes: [],
    };
  }

  const methodAttribute = element.attributes.find((attribute) => attribute.name === 'method');
  const keyAttribute = element.attributes.find((attribute) => attribute.name === 'key');
  const streamAttribute = element.attributes.find((attribute) => attribute.name === 'stream');
  const streaming = streamAttribute !== undefined;
  if (!keyAttribute && element.repeatable) return null;
  const preserveRuntimeMutation = !componentRenderSlotsParam(model);
  const targetBase = kebabCase(mutationAttribute.expressionBareIdentifierName);
  const generatedInMutationSlot = [
    ...(preserveRuntimeMutation
      ? [`mutation={${mutationAttribute.expressionBareIdentifierName}}`]
      : []),
    ...(methodAttribute ? [] : ['method="post"']),
    `action="${escapeAttribute(`/_m/${mutationKey}`)}"`,
    `data-mutation="${escapeAttribute(mutationKey)}"`,
    ...(streaming ? ['data-mutation-stream="true"'] : []),
    submittedFormTargetAttribute(targetBase, keyAttribute),
  ];
  const replacements = [
    {
      end: mutationAttribute.end,
      replacement: generatedInMutationSlot.join(' '),
      start: mutationAttribute.start,
    },
    ...(streamAttribute
      ? [
          {
            end: streamAttribute.end,
            replacement: '',
            start: streamAttribute.leadingStart,
          },
        ]
      : []),
    ...(keyAttribute ? [submittedFormKeyReplacement(keyAttribute)] : []),
    ...(preserveRuntimeMutation
      ? []
      : [submittedFormCsrfReplacement(element, mutationAttribute.expressionBareIdentifierName)]),
  ];
  const semanticAttributes = [
    ...(methodAttribute ? [] : [' method="post"']),
    ` action="${escapeAttribute(`/_m/${mutationKey}`)}"`,
    ` data-mutation="${escapeAttribute(mutationKey)}"`,
    ...(streaming ? [' data-mutation-stream="true"'] : []),
  ];
  const generatedAttributeNames = new Set([
    'action',
    'data-mutation',
    'data-mutation-stream',
    'key',
    'kovo-fragment-target',
    'kovo-key',
    'mutation',
    'stream',
    ...(methodAttribute ? [] : ['method']),
  ]);

  return {
    conflicts,
    generatedAttributeNames,
    importsMutationCsrfField: !preserveRuntimeMutation,
    outputContexts: [
      ...(methodAttribute
        ? []
        : [formLoweringOutputContext('method', 'post', 'typed mutation form lowering')]),
      formLoweringOutputContext('action', `/_m/${mutationKey}`, 'typed mutation form lowering'),
      formLoweringOutputContext('data-mutation', mutationKey, 'typed mutation form lowering'),
      ...(streaming
        ? [
            formLoweringOutputContext(
              'data-mutation-stream',
              'true',
              'streaming mutation form lowering',
            ),
          ]
        : []),
      formLoweringOutputContext(
        'kovo-fragment-target',
        submittedFormTargetExpression(targetBase, keyAttribute),
        'typed mutation form lowering',
      ),
      ...(keyAttribute
        ? [
            formLoweringOutputContext(
              'kovo-key',
              attributeValueExpression(keyAttribute),
              'typed mutation form lowering',
            ),
          ]
        : []),
    ],
    replacements,
    semanticAttributes,
  };
}

function importsMutationCsrfField(model: ComponentModuleModel): boolean {
  return model.namedImports.some(
    (entry) =>
      entry.moduleSpecifier === '@kovojs/server/internal/csrf' &&
      entry.importedName === 'renderMutationCsrfField',
  );
}

function compilerHelperImportInsertionOffset(source: string): number {
  const jsxImportSource = /^\/\*\* @jsxImportSource [\s\S]*?\*\/\s*/.exec(source);
  return jsxImportSource?.[0].length ?? 0;
}

function repeatableMutationFormDiagnostic(
  model: ComponentModuleModel,
  element: JsxElementModel,
  options: { fileName: string; registryFacts?: RegistryFacts; source: string } | undefined,
): CompilerDiagnostic | null {
  if (!options || element.tag !== 'form' || !element.repeatable) return null;
  if (element.attributes.some((attribute) => attribute.name === 'key')) return null;

  const binding = enhancedMutationFormBinding(element);
  if (!binding) return null;
  if (!localMutationKey(model, binding.localName, options.registryFacts)) {
    return null;
  }

  return {
    ...diagnosticFor(
      options.fileName,
      'KV238',
      options.source,
      binding.start,
      binding.end - binding.start,
    ),
    message: `${diagnosticDefinitions.KV238.message} repeatable enhanced mutation form needs authored key identity`,
  };
}

function enhancedMutationFormConflicts(element: JsxElementModel): EnhancedMutationFormConflict[] {
  return element.attributes
    .filter((attribute) =>
      [
        'action',
        'data-mutation',
        'data-mutation-stream',
        'kovo-fragment-target',
        'kovo-key',
      ].includes(attribute.name),
    )
    .map((attribute) => ({ attribute }));
}

function submittedFormCsrfReplacement(
  element: JsxElementModel,
  localName: string,
): SourceReplacement {
  const position = element.childBody
    ? element.childBody.offset + element.childBody.source.length
    : element.closingStart;
  // SPEC.md §10.3:1063/1065: emit both the CSRF token and a per-submit idem field
  // so the server replay store can deduplicate no-JS double-submits / Back-resubmits.
  return {
    end: position,
    replacement: `{__kovoRenderMutationCsrfField(${localName})}{__kovoRenderMutationIdemField()}`,
    start: position,
  };
}

function localMutationKey(
  model: ComponentModuleModel,
  localName: string,
  registryFacts?: RegistryFacts,
): string | null {
  const call = model.calls.find(
    (candidate) =>
      candidate.name === 'mutation' &&
      candidate.exportedConstName === localName &&
      typeof candidate.argumentStaticValues[0] === 'string',
  );
  const key = call?.argumentStaticValues[0];
  if (typeof key === 'string') return key;

  const registryEntry = Object.entries(registryFacts?.mutations ?? {}).find(
    ([, typeSource]) => typeSource.trim() === `typeof ${localName}`,
  );
  return registryEntry?.[0] ?? null;
}

function mutationFormFieldDiagnostics(
  model: ComponentModuleModel,
  element: JsxElementModel,
  options: { fileName: string; registryFacts?: RegistryFacts; source: string },
): CompilerDiagnostic[] {
  if (element.tag !== 'form') return [];

  const binding = enhancedMutationFormBinding(element);
  if (!binding) return [];

  const mutation = mutationInputFactForForm(model, binding.localName, options);
  if (!mutation) return [];

  const controls = successfulFormControls(model, element, options);
  const fieldNames = new Set(mutation.fields.map((field) => field.name));
  const controlNames = new Set(controls.map((control) => control.name));
  const diagnostics: CompilerDiagnostic[] = controls.flatMap((control) => control.diagnostics);

  for (const control of controls) {
    if (!control.name) continue;
    if (fieldNames.has(control.name)) continue;
    diagnostics.push(
      formFieldDiagnostic(
        options,
        control.start,
        control.length,
        `unknown field "${control.name}" for mutation "${mutation.key}". Expected fields: ${[
          ...fieldNames,
        ].join(', ')}`,
      ),
    );
  }

  for (const field of mutation.fields) {
    if (!field.required || controlNames.has(field.name)) continue;
    diagnostics.push(
      formFieldDiagnostic(
        options,
        binding.start,
        binding.end - binding.start,
        `missing required field "${field.name}" for mutation "${mutation.key}". Expected fields: ${[
          ...fieldNames,
        ].join(', ')}`,
      ),
    );
  }

  return diagnostics;
}

function enhancedMutationFormBinding(
  element: JsxElementModel,
): { end: number; localName: string; start: number } | null {
  const mutationAttribute = element.attributes.find((attribute) => attribute.name === 'mutation');
  if (mutationAttribute?.expressionBareIdentifierName) {
    return {
      end: mutationAttribute.end,
      localName: mutationAttribute.expressionBareIdentifierName,
      start: mutationAttribute.start,
    };
  }

  const spread = element.spreadAttributes.find(
    (attribute) =>
      attribute.expressionCallName === 'mutationFormAttributes' &&
      attribute.expressionCallArgumentBareIdentifierName,
  );
  if (!spread?.expressionCallArgumentBareIdentifierName) return null;

  return {
    end: spread.end,
    localName: spread.expressionCallArgumentBareIdentifierName,
    start: spread.start,
  };
}

function mutationInputFactForForm(
  model: ComponentModuleModel,
  localName: string,
  options: { fileName: string; registryFacts?: RegistryFacts; source: string },
): MutationInputFact | null {
  const localMutation = mutationInputFactsFromSource(options.fileName, options.source).get(
    localName,
  );
  if (localMutation) return localMutation;

  const mutationKey = localMutationKey(model, localName, options.registryFacts);
  const registryFields = mutationKey
    ? options.registryFacts?.mutationInputs?.[mutationKey]
    : undefined;
  if (!mutationKey || !registryFields) return null;

  return {
    fields: registryFields,
    key: mutationKey,
    localName,
  };
}

function formFieldDiagnostic(
  options: { fileName: string; source: string },
  start: number,
  length: number,
  detail: string,
): CompilerDiagnostic {
  return {
    ...diagnosticFor(options.fileName, 'KV242', options.source, start, length),
    message: `${diagnosticDefinitions.KV242.message} ${detail}`,
  };
}

function successfulFormControls(
  model: ComponentModuleModel,
  form: JsxElementModel,
  options: { fileName: string; source: string },
): { diagnostics: readonly CompilerDiagnostic[]; length: number; name: string; start: number }[] {
  const formEnd = form.selfClosing ? form.end : form.closingStart;
  const formId = staticStringAttributeValue(
    form.attributes.find((attribute) => attribute.name === 'id'),
  );
  const controls: {
    diagnostics: readonly CompilerDiagnostic[];
    length: number;
    name: string;
    start: number;
  }[] = [];

  for (const element of model.jsxElements) {
    if (element === form) continue;
    if (!['button', 'input', 'select', 'textarea'].includes(element.tag)) continue;
    if (element.attributes.some((attribute) => attribute.name === 'disabled')) continue;

    const descendant = element.start >= form.openingEnd && element.end <= formEnd;
    const externalFormAttribute = element.attributes.find((attribute) => attribute.name === 'form');
    const externalForm = staticStringAttributeValue(externalFormAttribute);
    if (!descendant && (!formId || externalForm !== formId)) continue;

    const nameAttribute = element.attributes.find((attribute) => attribute.name === 'name');
    const diagnostics: CompilerDiagnostic[] = [];
    if (!descendant || externalFormAttribute) {
      diagnostics.push(
        formFieldDiagnostic(
          options,
          (externalFormAttribute ?? element).start,
          (externalFormAttribute ?? element).end - (externalFormAttribute ?? element).start,
          'external form-associated controls are not supported for enhanced mutation field validation; keep controls inside the submitted form',
        ),
      );
    }

    const name = staticStringAttributeValue(nameAttribute);
    if (!nameAttribute) continue;
    if (!name) {
      diagnostics.push(
        formFieldDiagnostic(
          options,
          nameAttribute.start,
          nameAttribute.end - nameAttribute.start,
          'dynamic field names are not supported for enhanced mutation field validation; use a literal name from the mutation input schema',
        ),
      );
      controls.push({
        diagnostics,
        length: nameAttribute.end - nameAttribute.start,
        name: '',
        start: nameAttribute.start,
      });
      continue;
    }

    diagnostics.push(...unsupportedControlDiagnostics(element, name, nameAttribute, options));

    controls.push({
      diagnostics,
      length: nameAttribute.end - nameAttribute.start,
      name,
      start: nameAttribute.start,
    });
  }

  const counts = new Map<string, number>();
  for (const control of controls) {
    if (!control.name) continue;
    counts.set(control.name, (counts.get(control.name) ?? 0) + 1);
  }

  return controls.map((control) => {
    if (!control.name || (counts.get(control.name) ?? 0) <= 1) return control;
    return {
      ...control,
      diagnostics: [
        ...control.diagnostics,
        formFieldDiagnostic(
          options,
          control.start,
          control.length,
          `repeated field "${control.name}" is not supported for enhanced mutation field validation; declare one control per mutation input field`,
        ),
      ],
    };
  });
}

function unsupportedControlDiagnostics(
  element: JsxElementModel,
  name: string,
  nameAttribute: JsxAttributeModel,
  options: { fileName: string; source: string },
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const type = staticStringAttributeValue(
    element.attributes.find((attribute) => attribute.name === 'type'),
  )?.toLowerCase();

  if (/[.[\]]/.test(name)) {
    diagnostics.push(
      formFieldDiagnostic(
        options,
        nameAttribute.start,
        nameAttribute.end - nameAttribute.start,
        `nested field path "${name}" is not supported for enhanced mutation field validation; use a flat mutation input field name`,
      ),
    );
  }

  if (element.tag === 'input' && type === 'file') {
    diagnostics.push(
      formFieldDiagnostic(
        options,
        nameAttribute.start,
        nameAttribute.end - nameAttribute.start,
        `file input field "${name}" is not supported for enhanced mutation field validation`,
      ),
    );
  }

  if (element.tag === 'input' && (type === 'checkbox' || type === 'radio')) {
    diagnostics.push(
      formFieldDiagnostic(
        options,
        nameAttribute.start,
        nameAttribute.end - nameAttribute.start,
        `${type} field "${name}" is not supported for enhanced mutation field validation; use a single scalar input or a later multivalue form primitive`,
      ),
    );
  }

  if (
    element.tag === 'select' &&
    element.attributes.some((attribute) => attribute.name === 'multiple')
  ) {
    diagnostics.push(
      formFieldDiagnostic(
        options,
        nameAttribute.start,
        nameAttribute.end - nameAttribute.start,
        `multiple select field "${name}" is not supported for enhanced mutation field validation; use a single-value select or a later multivalue form primitive`,
      ),
    );
  }

  return diagnostics;
}

function staticStringAttributeValue(attribute: JsxAttributeModel | undefined): string | null {
  if (!attribute) return null;
  if (attribute.value !== undefined) return attribute.value;
  if (typeof attribute.expressionStaticValue === 'string') return attribute.expressionStaticValue;
  return null;
}

function submittedFormKeyReplacement(attribute: JsxAttributeModel): SourceReplacement {
  return {
    end: attribute.end,
    replacement: renderAttributeWithName('kovo-key', attribute),
    start: attribute.start,
  };
}

function submittedFormTargetAttribute(
  base: string,
  keyAttribute: JsxAttributeModel | undefined,
): string {
  const expression = submittedFormTargetExpression(base, keyAttribute);
  if (!keyAttribute || keyAttribute.expression !== undefined) {
    return keyAttribute?.expression === undefined
      ? `kovo-fragment-target="${escapeAttribute(expression)}"`
      : `kovo-fragment-target={\`${escapeTemplateLiteral(base)}:\${${keyAttribute.expression}}\`}`;
  }

  return `kovo-fragment-target="${escapeAttribute(expression)}"`;
}

function submittedFormTargetExpression(
  base: string,
  keyAttribute: JsxAttributeModel | undefined,
): string {
  if (!keyAttribute) return base;
  const key = staticAttributeScalar(keyAttribute);
  return key === null ? `${base}:\${${keyAttribute.expression ?? ''}}` : `${base}:${key}`;
}

function renderAttributeWithName(name: string, attribute: JsxAttributeModel): string {
  if (attribute.value !== undefined) {
    return `${name}="${escapeAttribute(attribute.value)}"`;
  }
  if (attribute.expression !== undefined) {
    return `${name}={${attribute.expression}}`;
  }
  const staticValue = attribute.expressionStaticValue;
  if (
    staticValue !== undefined &&
    staticValue !== true &&
    staticValue !== false &&
    staticValue !== null
  ) {
    return `${name}="${escapeAttribute(staticAttributeScalar(attribute) ?? '')}"`;
  }
  return name;
}

function attributeValueExpression(attribute: JsxAttributeModel): string {
  const staticValue = staticAttributeScalar(attribute);
  if (staticValue !== null) return staticValue;
  return attribute.expression ?? '';
}

function staticAttributeScalar(attribute: JsxAttributeModel): string | null {
  if (attribute.value !== undefined) return attribute.value;
  const staticValue = attribute.expressionStaticValue;
  if (typeof staticValue === 'string' || typeof staticValue === 'number')
    return String(staticValue);
  return null;
}

function escapeTemplateLiteral(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
}

function formLoweringOutputContext(
  sink: string,
  expression: string,
  writer: GeneratedOutputWriteFact['writer'],
): GeneratedOutputWriteFact {
  return {
    context: outputContextForAttribute(sink),
    expression,
    sink,
    source: 'server-render',
    writer,
  };
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
