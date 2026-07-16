import { isGeneratedOnlySemanticAttribute } from '@kovojs/core/internal/semantic-attributes';

import { compilerIrHeader } from '../ir.js';
import {
  compilerArrayAppend,
  compilerCreateMap,
  compilerCreateNullRecord,
  compilerCreateSet,
  compilerDefineOwnDataProperty,
  compilerJsonStringify,
  compilerMapGet,
  compilerMapSet,
  compilerObjectKeys,
  compilerOwnDataValue,
  compilerRegExpExec,
  compilerRegExpReplace,
  compilerRegExpTest,
  compilerSetAdd,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerStringCharCodeAt,
  compilerStringEndsWith,
  compilerStringIncludes,
  compilerStringIndexOf,
  compilerStringLocaleCompare,
  compilerStringSlice,
  compilerStringSplit,
  compilerStringStartsWith,
  compilerStringToLowerCase,
  compilerStringTrim,
} from '../compiler-security-intrinsics.js';
import {
  authorJsxAttributes,
  mergePrimitiveAndAuthorAttributes,
  primitiveObjectEntryAttributes,
  renderMergedAttributes,
} from '../lower/attribute-merge.js';
import { buildStaticHref } from '../lower/navigation.js';
import { isIntrinsicHtmlElement } from '../mutation-form-provenance.js';
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

const executableRenderSourcePrefix = `${compilerIrHeader}\nfunction renderSource() {\n  return \``;
const executableRenderSourceSuffix = '`;\n}\n';

function appendSemanticValue<Value>(target: Value[], value: Value): void {
  compilerArrayAppend(
    target,
    value,
    'Compiler packages/compiler/src/emit/render-equivalence.ts collection',
  );
}

function joinSemanticStrings(values: readonly string[], separator: string): string {
  let output = '';
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) output += separator;
    output += values[index]!;
  }
  return output;
}

function semanticAttribute(element: JsxElementModel, name: string): JsxAttributeModel | undefined {
  const attributes = compilerSnapshotDenseArray(element.attributes, 'Semantic JSX attributes');
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]!;
    if (
      attribute.name === name ||
      (element.intrinsicTagName !== undefined && compilerStringToLowerCase(attribute.name) === name)
    ) {
      return attribute;
    }
  }
  return undefined;
}

function semanticJsonSource(value: unknown, label: string): string {
  const source = compilerJsonStringify(value);
  if (source === undefined) throw new TypeError(`${label} must be JSON-serializable.`);
  return source;
}

function stableSemanticSort<Value>(
  values: readonly Value[],
  compare: (left: Value, right: Value) => number,
  label: string,
): Value[] {
  const sorted = compilerSnapshotDenseArray(values, label);
  for (let index = 1; index < sorted.length; index += 1) {
    const value = sorted[index]!;
    let insertion = index;
    while (insertion > 0 && compare(sorted[insertion - 1]!, value) > 0) {
      sorted[insertion] = sorted[insertion - 1]!;
      insertion -= 1;
    }
    sorted[insertion] = value;
  }
  return sorted;
}

export function semanticRenderEquivalenceCheck(
  artifact: string,
  expectedModel: ComponentModuleModel,
  executableSource: string,
  options: SemanticRenderContext = {},
): RenderEquivalenceCheck {
  const expected = semanticRenderModel(expectedModel, options);
  const actualSource = emittedServerRenderSource(executableSource);
  if (actualSource === null) {
    return {
      actual: '',
      artifact,
      detail:
        'SPEC §5.2 semantic render differential: render(src) differed from render(compile(src)).',
      expected,
      ok: false,
    };
  }
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
    actual: joinSemanticStrings(lowered, ' '),
    artifact,
    detail:
      'SPEC §5.2 rule 3 (authored→lowered): authored literal text must survive lowering. ' +
      (ok
        ? 'authored text is an ordered subsequence of the lowered render.'
        : `lowering dropped or reordered authored text token ${semanticJsonSource(missing, 'Missing authored text token')}.`),
    expected: joinSemanticStrings(authored, ' '),
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
  const withoutTags = compilerRegExpReplace(/<[^>]*>/g, html, ' ');
  let withoutExpressions = '';
  let depth = 0;
  for (let index = 0; index < withoutTags.length; index += 1) {
    const char = withoutTags[index]!;
    if (char === '{') depth += 1;
    else if (char === '}') depth = depth > 0 ? depth - 1 : 0;
    else if (depth === 0) withoutExpressions += char;
  }
  const parts = compilerStringSplit(compilerRegExpReplace(/\s+/g, withoutExpressions, '\n'), '\n');
  const tokens: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const token = compilerStringTrim(parts[index]!);
    if (token.length > 0) appendSemanticValue(tokens, token);
  }
  return tokens;
}

/** Return the first `needle` token that is not present as an ordered subsequence of `haystack`. */
function firstMissingSubsequenceToken(needle: string[], haystack: string[]): string | null {
  let cursor = 0;
  const needleSnapshot = compilerSnapshotDenseArray(needle, 'Authored semantic tokens');
  const haystackSnapshot = compilerSnapshotDenseArray(haystack, 'Lowered semantic tokens');
  for (let index = 0; index < needleSnapshot.length; index += 1) {
    const token = needleSnapshot[index]!;
    let found = false;
    while (cursor < haystackSnapshot.length) {
      const current = haystackSnapshot[cursor];
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

function emittedServerRenderSource(serverSource: string): string | null {
  // SPEC §5.2 permits generated-artifact verification here. The server emitter has one exact
  // executable grammar and escapes only backslash, backtick, and `${`. Decode that closed grammar
  // without executing generated JavaScript; any extra statement, template substitution, or
  // noncanonical JavaScript escape fails closed instead of gaining compiler-process execution.
  if (
    !compilerStringStartsWith(serverSource, executableRenderSourcePrefix) ||
    !compilerStringEndsWith(serverSource, executableRenderSourceSuffix)
  ) {
    return null;
  }

  const encoded = compilerStringSlice(
    serverSource,
    executableRenderSourcePrefix.length,
    serverSource.length - executableRenderSourceSuffix.length,
  );
  let decoded = '';
  let segmentStart = 0;
  for (let index = 0; index < encoded.length; index += 1) {
    const char = encoded[index]!;
    if (
      char === '`' ||
      (char === '$' && index + 1 < encoded.length && encoded[index + 1] === '{')
    ) {
      return null;
    }
    if (char === '\r') {
      decoded += compilerStringSlice(encoded, segmentStart, index);
      if (index + 1 < encoded.length && encoded[index + 1] === '\n') index += 1;
      decoded += '\n';
      segmentStart = index + 1;
      continue;
    }
    if (char !== '\\') continue;

    decoded += compilerStringSlice(encoded, segmentStart, index);
    if (index + 1 >= encoded.length) return null;
    const escaped = encoded[index + 1];
    if (escaped === '\\' || escaped === '`') {
      decoded += escaped;
      index += 1;
      segmentStart = index + 1;
      continue;
    }
    if (escaped === '$' && index + 2 < encoded.length && encoded[index + 2] === '{') {
      decoded += '${';
      index += 2;
      segmentStart = index + 1;
      continue;
    }
    return null;
  }
  return decoded + compilerStringSlice(encoded, segmentStart);
}

function normalizeSemanticHtmlForComparison(html: string): string {
  return compilerRegExpReplace(/<[^>]*>/g, html, (tag) => normalizeSemanticTagForComparison(tag));
}

function normalizeSemanticTagForComparison(tag: string): string {
  if (!compilerStringStartsWith(tag, '<') || !compilerStringEndsWith(tag, '>')) return tag;
  const body = compilerStringSlice(tag, 1, -1);
  if (
    compilerStringStartsWith(body, '/') ||
    compilerStringStartsWith(body, '!') ||
    compilerStringTrim(body) === ''
  ) {
    return tag;
  }

  const match = compilerRegExpExec(/^([^\s/>]+)([\s\S]*)$/, body);
  if (!match) return tag;

  const name = match[1]!;
  const rest = match[2] ?? '';
  const attributes = splitSemanticTagAttributes(compilerStringTrim(rest));
  if (attributes.length <= 1) return tag;

  const sorted = stableSemanticSort(
    attributes,
    (left, right) => {
      const nameOrder = compilerStringLocaleCompare(
        semanticAttributeName(left),
        semanticAttributeName(right),
      );
      return nameOrder === 0 ? compilerStringLocaleCompare(left, right) : nameOrder;
    },
    'Semantic tag attributes',
  );
  return `<${name} ${joinSemanticStrings(sorted, ' ')}>`;
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
    if (compilerRegExpTest(/\s/, char)) {
      const attribute = compilerStringTrim(compilerStringSlice(source, start, index));
      if (attribute) appendSemanticValue(attributes, attribute);
      start = index + 1;
    }
  }

  const tail = compilerStringTrim(compilerStringSlice(source, start));
  if (tail) appendSemanticValue(attributes, tail);
  return attributes;
}

function semanticAttributeName(attribute: string): string {
  const equalsIndex = compilerStringIndexOf(attribute, '=');
  return equalsIndex === -1 ? attribute : compilerStringSlice(attribute, 0, equalsIndex);
}

const voidElements = compilerCreateSet<string>();
const semanticVoidElementNames = [
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
];
for (let index = 0; index < semanticVoidElementNames.length; index += 1) {
  compilerSetAdd(voidElements, semanticVoidElementNames[index]!);
}

interface SemanticRenderContext {
  fileName?: string;
  registryFacts?: RegistryFacts;
}

type SemanticExpressionModel = ComponentModuleModel['jsxExpressions'][number];

interface SemanticRenderIndex {
  readonly directChildren: Map<JsxElementModel, readonly JsxElementModel[]>;
  readonly elements: readonly JsxElementModel[];
  readonly expressionsByStart: Map<number, Map<number, SemanticExpressionModel>>;
}

interface SemanticParentFrame {
  readonly element: JsxElementModel;
  readonly previous: SemanticParentFrame | null;
}

interface SemanticRenderState extends SemanticRenderContext {
  readonly index: SemanticRenderIndex;
}

interface SemanticElementOptions extends SemanticRenderState {
  forcedAttributes?: string;
}

function semanticRenderModel(
  model: ComponentModuleModel,
  options: SemanticRenderContext = {},
): string {
  const host = componentRenderHostElement(model);
  if (!host) return '';

  return renderSemanticElement(model, host, {
    ...options,
    index: createSemanticRenderIndex(model),
  });
}

/**
 * Snapshot and index the scanner-owned render model once for the complete differential pass.
 * SPEC.md §5.2 keeps those typed facts authoritative; rebuilding a descriptor-checked copy of the
 * full JSX model for every recursively rendered element made a nested component superlinear.
 */
function createSemanticRenderIndex(model: ComponentModuleModel): SemanticRenderIndex {
  const elements = compilerSnapshotDenseArray(
    model.jsxElements,
    'Semantic render indexed elements',
  );
  const directChildren = compilerCreateMap<JsxElementModel, JsxElementModel[]>();
  let activeParent: SemanticParentFrame | null = null;
  for (let childIndex = 0; childIndex < elements.length; childIndex += 1) {
    const child = elements[childIndex]!;
    while (activeParent !== null && activeParent.element.end <= child.start) {
      activeParent = activeParent.previous;
    }

    // The scanner emits JSX elements in source/preorder. Walk only the active ancestor chain to
    // find the narrowest semantic child-body parent; JSX nested in an opening-tag expression must
    // not become a rendered child. This preserves the previous span rule without comparing every
    // element with every other element.
    let parent = activeParent;
    while (
      parent !== null &&
      (child.start < parent.element.openingEnd || child.end > parent.element.closingStart)
    ) {
      parent = parent.previous;
    }
    if (parent !== null) {
      const siblings = compilerMapGet(directChildren, parent.element) ?? [];
      appendSemanticValue(siblings, child);
      compilerMapSet(directChildren, parent.element, siblings);
    }
    activeParent = { element: child, previous: activeParent };
  }

  const expressions = compilerSnapshotDenseArray(
    model.jsxExpressions,
    'Semantic render indexed expressions',
  );
  const expressionsByStart = compilerCreateMap<number, Map<number, SemanticExpressionModel>>();
  for (let index = 0; index < expressions.length; index += 1) {
    const expression = expressions[index]!;
    const byEnd =
      compilerMapGet(expressionsByStart, expression.containerStart) ??
      compilerCreateMap<number, SemanticExpressionModel>();
    compilerMapSet(byEnd, expression.containerEnd, expression);
    compilerMapSet(expressionsByStart, expression.containerStart, byEnd);
  }

  return { directChildren, elements, expressionsByStart };
}

function renderSemanticElement(
  model: ComponentModuleModel,
  element: JsxElementModel,
  options: SemanticElementOptions,
): string {
  const formError = semanticMutationFormErrorExpression(model, element);
  if (formError) return formError;

  const primitiveChild = semanticPrimitiveChild(model, element, options.index);
  if (primitiveChild) {
    return renderSemanticElement(model, primitiveChild.child, { ...options, ...primitiveChild });
  }

  const tag = semanticElementTag(element);
  const attributes = options.forcedAttributes ?? renderSemanticAttributes(model, element, options);

  if (compilerSetHas(voidElements, tag)) return `<${tag}${attributes}>`;

  return `<${tag}${attributes}>${renderSemanticChildren(model, element, options)}</${tag}>`;
}

function semanticElementTag(element: JsxElementModel): string {
  return element.tag === 'Link' ? 'a' : element.tag;
}

function renderSemanticAttributes(
  model: ComponentModuleModel,
  element: JsxElementModel,
  options: SemanticRenderState,
): string {
  if (element.tag === 'Link') {
    const rendered: string[] = [];
    const href = semanticLinkHrefAttribute(element);
    if (href !== null) appendSemanticValue(rendered, href);
    const attributes = compilerSnapshotDenseArray(element.attributes, 'Semantic link attributes');
    for (let index = 0; index < attributes.length; index += 1) {
      const attribute = attributes[index]!;
      if (attribute.name === 'params' || attribute.name === 'search' || attribute.name === 'to') {
        continue;
      }
      const value = renderSemanticAttribute(attribute);
      if (value !== null) appendSemanticValue(rendered, value);
    }
    return joinSemanticStrings(rendered, '');
  }

  const mutationFormOptions: SemanticRenderContext = {};
  if (options.fileName !== undefined) mutationFormOptions.fileName = options.fileName;
  if (options.registryFacts !== undefined)
    mutationFormOptions.registryFacts = options.registryFacts;
  const formMutation = enhancedMutationFormLowering(model, element, mutationFormOptions);
  const viewTransitionStyle = semanticViewTransitionStyle(element);
  const fieldErrorDescribedBy = semanticFieldErrorDescribedByAttribute(
    model,
    element,
    options.index,
  );
  const semanticAttributes: string[] = [];
  const attributes = compilerSnapshotDenseArray(element.attributes, 'Semantic render attributes');
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]!;
    if (attribute.name === 'viewTransitionName' || isQueryExpressionAttribute(model, attribute)) {
      continue;
    }
    if (
      isIntrinsicHtmlElement(element, 'form') &&
      attribute.name === 'mutation' &&
      hasGeneratedMutationFormAttributes(element)
    ) {
      continue;
    }
    if (
      formMutation !== null &&
      formMutation !== undefined &&
      compilerSetHas(formMutation.generatedAttributeNames, attribute.name)
    ) {
      if (attribute.name === 'mutation') {
        const generated = compilerSnapshotDenseArray(
          formMutation.semanticAttributes,
          'Semantic mutation form attributes',
        );
        for (let generatedIndex = 0; generatedIndex < generated.length; generatedIndex += 1) {
          appendSemanticValue(semanticAttributes, generated[generatedIndex]!);
        }
      }
      continue;
    }
    const rendered =
      attribute.name === 'style' && viewTransitionStyle
        ? renderSemanticStyleAttribute(attribute, viewTransitionStyle)
        : attribute.name === 'streamText'
          ? renderSemanticAttributeWithName('data-stream-text', attribute)
          : renderSemanticAttribute(attribute);
    if (rendered) appendSemanticValue(semanticAttributes, rendered);
  }
  if (viewTransitionStyle && semanticAttribute(element, 'style') === undefined) {
    appendSemanticValue(semanticAttributes, ` style="${escapeAttribute(viewTransitionStyle)}"`);
  }
  if (fieldErrorDescribedBy && semanticAttribute(element, 'aria-describedby') === undefined) {
    appendSemanticValue(semanticAttributes, fieldErrorDescribedBy);
  }
  return joinSemanticStrings(semanticAttributes, '');
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
  index: SemanticRenderIndex,
): string | null {
  if (
    !isIntrinsicHtmlElement(control, 'input') &&
    !isIntrinsicHtmlElement(control, 'select') &&
    !isIntrinsicHtmlElement(control, 'textarea')
  )
    return null;
  const name = staticStringAttributeValue(semanticAttribute(control, 'name'));
  if (!name) return null;

  const elements = index.elements;
  let form: JsxElementModel | undefined;
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (
      isIntrinsicHtmlElement(element, 'form') &&
      control.start >= element.openingEnd &&
      control.end <= element.closingStart &&
      (form === undefined || element.start > form.start)
    ) {
      form = element;
    }
  }
  if (!form) return null;

  let fieldError: JsxElementModel | undefined;
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (
      element.tag === 'FieldError' &&
      element.start >= form.openingEnd &&
      element.end <= form.closingStart &&
      staticStringAttributeValue(semanticAttribute(element, 'name')) === name
    ) {
      fieldError = element;
      break;
    }
  }
  if (!fieldError) return null;

  const explicitId = staticStringAttributeValue(semanticAttribute(fieldError, 'id'));
  const binding = enhancedMutationFormBinding(form);
  const slotName = binding ? componentMutationSlotName(model, binding.localName) : null;
  const id = explicitId
    ? {
        expression: semanticJsonSource(explicitId, 'Semantic field-error id'),
        source: semanticJsonSource(explicitId, 'Semantic field-error id'),
      }
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
  const queryNames = compilerCreateSet<string>();
  const keys = compilerSnapshotDenseArray(
    componentOptionObjectKeys(model, 'queries'),
    'Semantic query names',
  );
  for (let index = 0; index < keys.length; index += 1) compilerSetAdd(queryNames, keys[index]!);
  const accesses = compilerSnapshotDenseArray(
    attribute.expressionPropertyAccesses ?? [],
    'Semantic query property accesses',
  );
  for (let index = 0; index < accesses.length; index += 1) {
    const root = compilerStringSplit(accesses[index]!.path, '.')[0];
    if (root !== undefined && compilerSetHas(queryNames, root)) return true;
  }
  return false;
}

function semanticPrimitiveChild(
  model: ComponentModuleModel,
  element: JsxElementModel,
  index: SemanticRenderIndex,
): { child: JsxElementModel; forcedAttributes: string } | null {
  if (semanticAttribute(element, 'asChild') === undefined) return null;
  const attrs = semanticAttribute(element, 'attrs')?.expressionObjectEntries;
  if (!attrs) return null;
  const primitiveAttributes = primitiveObjectEntryAttributes(attrs);
  if (!primitiveAttributes) return null;
  const child = directChildElements(index, element)[0];
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
  const to = semanticAttribute(element, 'to');
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
  const value = semanticAttribute(element, name)?.expressionStaticValue;
  if (!value || typeof value !== 'object') return null;
  const result = compilerCreateNullRecord<string | number | boolean | null>();
  const keys = compilerObjectKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const entryValue = compilerOwnDataValue(value, key, 'Semantic static object attribute');
    if (
      entryValue === null ||
      typeof entryValue === 'boolean' ||
      typeof entryValue === 'number' ||
      typeof entryValue === 'string'
    ) {
      compilerDefineOwnDataProperty(result, key, entryValue);
    }
  }
  return result;
}

function semanticViewTransitionStyle(element: JsxElementModel): string | null {
  const transition = semanticAttribute(element, 'viewTransitionName')?.value;
  return transition ? `view-transition-name: ${transition}` : null;
}

function renderSemanticStyleAttribute(
  attribute: JsxAttributeModel,
  extraStyle: string,
): string | null {
  const rendered = renderSemanticAttribute(attribute);
  if (!rendered) return null;
  if (attribute.value === undefined) return rendered;
  const existing = compilerStringTrim(attribute.value);
  const separator = existing === '' || compilerStringEndsWith(existing, ';') ? '' : ';';
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
  if (isGeneratedOnlySemanticAttribute(attribute.name)) return null;
  if (attribute.domEventName) return null;
  if (compilerStringStartsWith(attribute.name, 'on') && attribute.name.length > 2) {
    const eventInitial = compilerStringCharCodeAt(attribute.name, 2);
    if (
      eventInitial >= 0x41 &&
      eventInitial <= 0x5a &&
      compilerRegExpTest(/^on[A-Z][\w-]*$/, attribute.name)
    ) {
      return null;
    }
  }

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
  if (typeof value === 'string') {
    return ` ${name}="${escapeAttribute(value)}"`;
  }
  if (typeof value === 'number') {
    return ` ${name}="${escapeAttribute(semanticJsonSource(value, 'Semantic numeric attribute'))}"`;
  }

  return ` ${name}="${escapeAttribute(semanticJsonSource(value, 'Semantic static attribute'))}"`;
}

function renderSemanticChildren(
  model: ComponentModuleModel,
  element: JsxElementModel,
  options: SemanticRenderState,
): string {
  const body = element.childBody;
  if (!body) return '';

  const bodyEnd = body.offset + body.source.length;
  const tokens: { end: number; render: () => string; start: number }[] = [];
  const children = directChildElements(options.index, element);
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    appendSemanticValue(tokens, {
      end: child.end,
      render: () => renderSemanticElement(model, child, options),
      start: child.start,
    });
  }
  const containers = compilerSnapshotDenseArray(
    element.childExpressionContainers,
    'Semantic child expression containers',
  );
  for (let index = 0; index < containers.length; index += 1) {
    const container = containers[index]!;
    appendSemanticValue(tokens, {
      end: container.end,
      render: () => renderSemanticExpression(options.index, container),
      start: container.start,
    });
  }
  const sortedTokens = stableSemanticSort(
    tokens,
    (left, right) => left.start - right.start || left.end - right.end,
    'Semantic child tokens',
  );

  let output = '';
  let cursor = body.offset;

  for (let index = 0; index < sortedTokens.length; index += 1) {
    const token = sortedTokens[index]!;
    if (token.start < body.offset || token.end > bodyEnd || token.start < cursor) continue;
    output += childBodySlice(body, cursor, token.start);
    output += token.render();
    cursor = token.end;
  }

  output += childBodySlice(body, cursor, bodyEnd);
  return output;
}

function directChildElements(
  index: SemanticRenderIndex,
  parent: JsxElementModel,
): readonly JsxElementModel[] {
  return compilerMapGet(index.directChildren, parent) ?? [];
}

function renderSemanticExpression(index: SemanticRenderIndex, container: SourceSpan): string {
  const byEnd = compilerMapGet(index.expressionsByStart, container.start);
  const expression = byEnd === undefined ? undefined : compilerMapGet(byEnd, container.end);
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
  if (!compilerStringIncludes(expression, '__kovoRenderMutation')) return expression;
  return compilerRegExpReplace(
    /\b__kovoRenderMutationIdemField\(\)/g,
    compilerRegExpReplace(/\b__kovoRenderMutationCsrfField\([^()]*\)/g, expression, ''),
    '',
  );
}

function hasGeneratedMutationFormAttributes(element: JsxElementModel): boolean {
  return (
    semanticAttribute(element, 'action') !== undefined &&
    semanticAttribute(element, 'data-mutation') !== undefined
  );
}

function childBodySlice(
  body: NonNullable<JsxElementModel['childBody']>,
  start: number,
  end: number,
): string {
  return compilerStringSlice(body.source, start - body.offset, end - body.offset);
}
