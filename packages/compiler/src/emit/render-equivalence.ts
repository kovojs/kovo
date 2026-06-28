import { runInNewContext } from 'node:vm';

import {
  authorJsxAttributes,
  mergePrimitiveAndAuthorAttributes,
  primitiveObjectEntryAttributes,
  renderMergedAttributes,
} from '../lower/attribute-merge.js';
import { buildStaticHref } from '../lower/navigation.js';
import {
  componentOptionObjectKeys,
  componentRenderHostElement,
  componentRenderSlotsParam,
  parseComponentModule,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
  type SourceSpan,
} from '../scan/parse.js';
import { escapeAttribute } from '../shared.js';
import type { RenderEquivalenceCheck, RegistryFacts } from '../types.js';
import {
  componentMutationSlotName,
  enclosingEnhancedMutationForm,
  enhancedMutationFormBinding,
  enhancedMutationFormLowering,
  mutationFormErrorIdExpression,
  mutationFormErrorProps,
  staticStringAttributeValue,
} from './server-emit-shared.js';

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

/**
 * SPEC §5.2 rule 3 (authored → lowered leg): a conservative authored-vs-lowered structural
 * differential. The full byte-identical authored↔lowered gate is NOT achievable here, because
 * lowering legitimately rewrites the visible HTML in ways the semantic renderer does not replicate
 * for the authored model: `escapeText(...)` text wrapping, mixed-text `<span data-bind>` insertion,
 * and `style={…}` → `class="kv-…"` style extraction (verified empirically: 10/18 example components
 * diverge at the visible-HTML level even after stripping generated attributes). Re-deriving every
 * lowering pass inside the semantic renderer would be the forbidden source-normalization gate.
 *
 * Instead this check verifies the ONE authored→lowered invariant that is sound regardless of those
 * transforms: every literal (non-dynamic, non-generated) text token the AUTHOR wrote must still
 * appear, in order, in the lowered render. Lowering may ADD text (template stamps, generated spans)
 * but must never DROP or reorder author-written copy. A future lowering pass that mangles or loses
 * visible author text fails closed here, which the lowered-baseline {@link semanticRenderEquivalenceCheck}
 * cannot catch (both of its sides are already lowered). bugz-3 L5; coupled to bugz.md M2 (the
 * runtime escapeText single-escape, fixed in `@kovojs/server`).
 */
export function authoredStaticTextEquivalenceCheck(
  artifact: string,
  authoredModel: ComponentModuleModel,
  loweredModel: ComponentModuleModel,
  options: SemanticRenderContext = {},
): RenderEquivalenceCheck {
  const authored = staticTextTokens(semanticRenderModel(authoredModel, options));
  const lowered = staticTextTokens(semanticRenderModel(loweredModel, options));
  const missing = firstMissingSubsequenceToken(authored, lowered);
  const ok = missing === null;

  return {
    actual: lowered.join(' '),
    artifact,
    detail:
      'SPEC §5.2 rule 3 (authored→lowered): authored literal text must survive lowering. ' +
      (ok
        ? 'authored text is an ordered subsequence of the lowered render.'
        : `lowering dropped or reordered authored text token ${JSON.stringify(missing)}.`),
    expected: authored.join(' '),
    ok,
  };
}

/**
 * Literal static-text tokens of a semantic render: drop element tags and `{expr}` dynamic
 * containers, then split the remaining author-written copy on whitespace. Dynamic expressions are
 * intentionally excluded — only literal text the author typed (e.g. headings, labels) is compared,
 * so the check is robust to escapeText/span/style lowering of the dynamic parts.
 */
function staticTextTokens(html: string): string[] {
  const withoutTags = html.replace(/<[^>]*>/g, ' ');
  let withoutExpressions = '';
  let depth = 0;
  for (const char of withoutTags) {
    if (char === '{') depth += 1;
    else if (char === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) withoutExpressions += char;
  }
  return withoutExpressions
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/** Return the first `needle` token that is not present as an ordered subsequence of `haystack`. */
function firstMissingSubsequenceToken(needle: string[], haystack: string[]): string | null {
  let cursor = 0;
  for (const token of needle) {
    let found = false;
    while (cursor < haystack.length) {
      const current = haystack[cursor];
      cursor += 1;
      if (current === token) {
        found = true;
        break;
      }
    }
    if (!found) return token;
  }
  return null;
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
  fileName?: string;
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

  const mutationFormOptions: SemanticRenderContext = {};
  if (options.fileName !== undefined) mutationFormOptions.fileName = options.fileName;
  if (options.registryFacts !== undefined)
    mutationFormOptions.registryFacts = options.registryFacts;
  const formMutation = enhancedMutationFormLowering(model, element, mutationFormOptions);
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
  // S7-1 (plans/compiler-soundness.md): do NOT strip escapeText(x) → x here.
  // The gate must compare actual encoded output so that an escapeText presence/absence
  // asymmetry between authored and lowered sources is caught (fails closed), not silently
  // equated. The mutation-field helpers are generated-only with no authored equivalent and
  // are always stripped.
  return expression
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
    // SPEC §4.8 data-bind-prop: the live-property stamp is a non-attribute output
    // (the loader assigns el[prop]); it carries no visible HTML, so the §5.2 #3
    // render-equivalence gate treats it as generated-only like data-bind:*.
    name.startsWith('data-bind-prop:') ||
    name.startsWith('data-p-') ||
    name.startsWith('on:')
  );
}
