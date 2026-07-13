import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import { deriveComponentNames } from '../component-names.js';
import {
  compilerArrayAppend,
  compilerArrayIsArray,
  compilerArrayJoin,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateSet,
  compilerDefineOwnDataProperty,
  compilerFailClosed,
  compilerMapForEach,
  compilerMapGet,
  compilerMapSet,
  compilerObjectKeys,
  compilerOwnDataValue,
  compilerRegExpReplace,
  compilerSetAdd,
  compilerSetHas,
  compilerStringIndexOf,
  compilerStringSlice,
  compilerStringSplit,
  compilerStringStartsWith,
  compilerStringToLowerCase,
} from '../compiler-security-intrinsics.js';
import { type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';
import {
  componentOptionObjectKeys,
  jsxElements,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
} from '../scan/parse.js';
import { dedupeBy, splitDepValue } from '../shared.js';
import type { PackageComponentPrefixFact, RegistryFacts } from '../types.js';

interface IdrefValue {
  index: number;
  length: number;
  value: string;
}

interface LiteralIdValue {
  element: JsxElementModel;
  index: number;
  length: number;
  value: string;
}

interface ResidualStampValidationOptions {
  fileName: string;
  registryFacts?: RegistryFacts;
}

const navigationSegmentStampAttributes = compilerCreateSet<string>();
compilerSetAdd(navigationSegmentStampAttributes, 'kovo-nav-components');
compilerSetAdd(navigationSegmentStampAttributes, 'kovo-nav-kind');
compilerSetAdd(navigationSegmentStampAttributes, 'kovo-nav-name');
compilerSetAdd(navigationSegmentStampAttributes, 'kovo-nav-queries');
compilerSetAdd(navigationSegmentStampAttributes, 'kovo-nav-segment');

export function validateIdrefs(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  packageComponentPrefixes?: readonly PackageComponentPrefixFact[],
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];
  const scopes = componentElementScopes(model);
  const scopeLength = compilerArrayLength(scopes, 'Component element scopes');
  for (let scopeIndex = 0; scopeIndex < scopeLength; scopeIndex += 1) {
    const scope = ownArrayEntry(scopes, scopeIndex, 'Component element scopes');
    appendArray(
      found,
      validateIdrefsInElementScope(diagnostics, scope, packageComponentPrefixes),
      'IDREF diagnostics',
    );
  }
  return dedupeBy(found, diagnosticKey);
}

export function validateStaticIds(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];
  const seen = compilerCreateSet<string>();

  const ids = literalIdValues(model);
  const idLength = compilerArrayLength(ids, 'Literal id values');
  for (let index = 0; index < idLength; index += 1) {
    const id = ownArrayEntry(ids, index, 'Literal id values');
    if (compilerSetHas(seen, id.value)) {
      appendMarkupFact(
        found,
        kv224Diagnostic(diagnostics, `duplicate id="${id.value}"`, id),
        'Static id diagnostics',
      );
    }
    compilerSetAdd(seen, id.value);
  }

  const repeatableIds = repeatableLiteralIds(model);
  const repeatableLength = compilerArrayLength(repeatableIds, 'Repeatable literal id values');
  for (let index = 0; index < repeatableLength; index += 1) {
    const id = ownArrayEntry(repeatableIds, index, 'Repeatable literal id values');
    appendMarkupFact(
      found,
      kv224Diagnostic(diagnostics, `repeatable id="${id.value}"`, id),
      'Static id diagnostics',
    );
  }

  return dedupeBy(found, diagnosticKey);
}

export function validateHandAuthoredNavigationSegmentStamps(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];
  const elements = jsxElements(model);
  const elementLength = compilerArrayLength(elements, 'Navigation-stamp JSX elements');

  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(
      elements,
      elementIndex,
      'Navigation-stamp JSX elements',
    ) as JsxElementModel | undefined;
    if (element === undefined) {
      compilerFailClosed(`Navigation-stamp JSX elements[${elementIndex}] must be dense.`);
    }
    const attributeLength = compilerArrayLength(
      element.attributes,
      `Navigation-stamp JSX element ${elementIndex} attributes`,
    );
    for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
      const attribute = compilerOwnDataValue(
        element.attributes,
        attributeIndex,
        `Navigation-stamp JSX element ${elementIndex} attributes`,
      ) as JsxAttributeModel | undefined;
      if (attribute === undefined) {
        compilerFailClosed(
          `Navigation-stamp JSX element ${elementIndex} attributes[${attributeIndex}] must be dense.`,
        );
      }
      if (!compilerSetHas(navigationSegmentStampAttributes, attribute.name)) continue;
      compilerArrayAppend(
        found,
        {
          ...diagnostics.at(
            'KV235',
            { start: attribute.start, length: attribute.end - attribute.start },
            `hand-authored navigation segment stamp ${attribute.name}.`,
          ),
          help: compilerArrayJoin(
            [
              diagnosticDefinitions.KV235.help,
              'Navigation segment stamps are compiler-derived from route(), layout(), and the target document used by enhanced navigation.',
              'Fix: remove the kovo-nav-* attribute and declare sibling route/layout regions with the public route({ regions }) API.',
              'SPEC §8 makes enhanced navigation loader-owned; app TSX does not author segment stamps or persistence policy.',
            ],
            '\n',
          ),
        },
        'Markup idref values',
      );
    }
  }

  return dedupeBy(found, diagnosticKey);
}

const blockTagsThatCloseParagraph = stringSetFromArray(
  [
    'address',
    'article',
    'aside',
    'blockquote',
    'div',
    'dl',
    'fieldset',
    'footer',
    'form',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'header',
    'hr',
    'main',
    'nav',
    'ol',
    'p',
    'pre',
    'section',
    'table',
    'ul',
  ],
  'Paragraph-closing block tags',
);

export function validateHtmlContentModel(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];
  const elements = jsxElements(model);

  const elementLength = compilerArrayLength(elements, 'HTML content-model elements');
  for (let index = 0; index < elementLength; index += 1) {
    const element = ownArrayEntry(elements, index, 'HTML content-model elements');
    const tag = compilerStringToLowerCase(element.tag);
    if (!isNativeHtmlTag(tag)) continue;

    if (compilerSetHas(blockTagsThatCloseParagraph, tag) && hasJsxAncestor(element, 'p')) {
      appendMarkupFact(
        found,
        htmlContentModelDiagnostic(diagnostics, element, `<${tag}> cannot appear inside <p>`),
        'HTML content-model diagnostics',
      );
    }

    if (
      tag === 'tr' &&
      !hasJsxAttribute(element, 'kovo-c') &&
      !hasAnyJsxAncestor(element, ['table', 'tbody', 'thead', 'tfoot'])
    ) {
      appendMarkupFact(
        found,
        htmlContentModelDiagnostic(
          diagnostics,
          element,
          '<tr> must be inside a table section or table',
        ),
        'HTML content-model diagnostics',
      );
    }
  }

  return found;
}

export function validateResidualStamps(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  options: ResidualStampValidationOptions,
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];
  const knownQueries = compilerCreateSet<string>();
  const registryQueries = registryObject(options.registryFacts, 'queries');
  if (registryQueries) {
    addStringsToSet(knownQueries, compilerObjectKeys(registryQueries), 'Registry query names');
  }
  addStringsToSet(knownQueries, componentQueryNames(model), 'Component query names');

  const knownComponents = compilerCreateSet<string>();
  const componentLength = compilerArrayLength(model.components, 'Residual-stamp components');
  for (let index = 0; index < componentLength; index += 1) {
    const component = ownArrayEntry(model.components, index, 'Residual-stamp components');
    compilerSetAdd(knownComponents, deriveComponentNames(options.fileName, component).domName);
  }
  addStringsToSet(
    knownComponents,
    registryStringArray(options.registryFacts, 'components'),
    'Registry component names',
  );

  const attributes = jsxAttributes(model);
  const attributeLength = compilerArrayLength(attributes, 'Residual-stamp attributes');
  for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
    const attribute = ownArrayEntry(attributes, attributeIndex, 'Residual-stamp attributes');
    if (attribute.name === 'kovo-c') {
      const component = attribute.value;
      if (component && !compilerSetHas(knownComponents, component)) {
        appendMarkupFact(
          found,
          kv226Diagnostic(
            diagnostics,
            `kovo-c="${component}"`,
            attribute.start,
            attribute.end - attribute.start,
          ),
          'Residual-stamp diagnostics',
        );
      }
    }

    if (attribute.name !== 'kovo-deps') continue;

    const dependencies = splitDepValue(attribute.value ?? '');
    const dependencyLength = compilerArrayLength(dependencies, 'Residual-stamp dependencies');
    for (let dependencyIndex = 0; dependencyIndex < dependencyLength; dependencyIndex += 1) {
      const dep = ownArrayEntry(dependencies, dependencyIndex, 'Residual-stamp dependencies');
      const separator = compilerStringIndexOf(dep, ':');
      const query = separator < 0 ? dep : compilerStringSlice(dep, 0, separator);
      if (!compilerSetHas(knownQueries, query)) {
        appendMarkupFact(
          found,
          kv226Diagnostic(
            diagnostics,
            `kovo-deps="${dep}"`,
            attribute.start,
            attribute.end - attribute.start,
          ),
          'Residual-stamp diagnostics',
        );
      }
    }
  }

  return dedupeBy(found, diagnosticKey);
}

const ambiguousRelationshipAttributes = compilerCreateSet<string>();
compilerSetAdd(ambiguousRelationshipAttributes, 'aria-activedescendant');
compilerSetAdd(ambiguousRelationshipAttributes, 'aria-controls');
compilerSetAdd(ambiguousRelationshipAttributes, 'aria-describedby');
compilerSetAdd(ambiguousRelationshipAttributes, 'aria-labelledby');
compilerSetAdd(ambiguousRelationshipAttributes, 'aria-owns');
compilerSetAdd(ambiguousRelationshipAttributes, 'commandfor');
compilerSetAdd(ambiguousRelationshipAttributes, 'for');
compilerSetAdd(ambiguousRelationshipAttributes, 'htmlFor');
compilerSetAdd(ambiguousRelationshipAttributes, 'popovertarget');

const primitiveOwnedOverrideAttributes = compilerCreateSet<string>();
compilerSetAdd(primitiveOwnedOverrideAttributes, 'role');
compilerSetAdd(primitiveOwnedOverrideAttributes, 'data-state');

export function validateAttributeMergeConflicts(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];
  const elements = jsxElements(model);
  const elementLength = compilerArrayLength(elements, 'Attribute merge JSX elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(
      elements,
      elementIndex,
      'Attribute merge JSX elements',
    ) as JsxElementModel;
    const counts = countAttributeNames(element.attributes);

    compilerMapForEach(counts, (count, name) => {
      if (count < 2) return;
      const duplicateAttributes = attributesNamed(element.attributes, name);
      const attribute = compilerOwnDataValue(duplicateAttributes, 0, 'Duplicate JSX attributes') as
        | JsxAttributeModel
        | undefined;
      if (!attribute) return;

      if (isBindingAttribute(name)) {
        appendMarkupFact(
          found,
          attributeMergeDiagnostic(diagnostics, 'KV233', name, attribute),
          'Attribute merge diagnostics',
        );
        return;
      }

      if (
        compilerSetHas(ambiguousRelationshipAttributes, name) ||
        compilerStringStartsWith(name, 'data-p-') ||
        name === 'kovo-c' ||
        name === 'kovo-state'
      ) {
        appendMarkupFact(
          found,
          attributeMergeDiagnostic(diagnostics, 'KV231', name, attribute),
          'Attribute merge diagnostics',
        );
        return;
      }

      if (
        compilerStringStartsWith(name, 'aria-') ||
        compilerSetHas(primitiveOwnedOverrideAttributes, name)
      ) {
        const second = compilerOwnDataValue(duplicateAttributes, 1, 'Duplicate JSX attributes') as
          | JsxAttributeModel
          | undefined;
        appendMarkupFact(
          found,
          attributeMergeDiagnostic(diagnostics, 'KV232', name, second ?? attribute),
          'Attribute merge diagnostics',
        );
      }
    });
  }

  return dedupeBy(found, diagnosticKey);
}

function literalIdValues(model: ComponentModuleModel, offset = 0): LiteralIdValue[] {
  return literalIdValuesForElements(jsxElements(model), offset);
}

function literalIdValuesForElements(
  elements: readonly JsxElementModel[],
  offset = 0,
): LiteralIdValue[] {
  const ids: LiteralIdValue[] = [];
  const elementLength = compilerArrayLength(elements, 'Literal-id elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = ownArrayEntry(elements, elementIndex, 'Literal-id elements');
    const attributeLength = compilerArrayLength(element.attributes, 'Literal-id attributes');
    for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
      const attribute = ownArrayEntry(element.attributes, attributeIndex, 'Literal-id attributes');
      if (attribute.name !== 'id' || !attribute.value) continue;
      appendMarkupFact(
        ids,
        {
          element,
          index: offset + attribute.start,
          length: attribute.end - attribute.start,
          value: attribute.value,
        },
        'Literal id values',
      );
    }
  }
  return ids;
}

function validateIdrefsInElementScope(
  diagnostics: DiagnosticFactory,
  elements: readonly JsxElementModel[],
  packageComponentPrefixes?: readonly PackageComponentPrefixFact[],
): CompilerDiagnostic[] {
  const ids = compilerCreateSet<string>();
  const literalIds = literalIdValuesForElements(elements);
  const literalIdLength = compilerArrayLength(literalIds, 'Scoped literal id values');
  for (let index = 0; index < literalIdLength; index += 1) {
    compilerSetAdd(ids, ownArrayEntry(literalIds, index, 'Scoped literal id values').value);
  }
  const values = idrefValuesForElements(elements, packageComponentPrefixes);
  const found: CompilerDiagnostic[] = [];
  const valueLength = compilerArrayLength(values, 'Scoped IDREF values');
  for (let index = 0; index < valueLength; index += 1) {
    const value = ownArrayEntry(values, index, 'Scoped IDREF values');
    if (compilerSetHas(ids, value.value)) continue;
    appendMarkupFact(found, kv221Diagnostic(diagnostics, value), 'IDREF diagnostics');
  }
  return dedupeBy(found, diagnosticKey);
}

function repeatableLiteralIds(model: ComponentModuleModel): LiteralIdValue[] {
  const ids = literalIdValues(model);
  const elements = jsxElements(model);
  const repeatableTemplateSpans: Array<{ end: number; start: number }> = [];
  const elementLength = compilerArrayLength(elements, 'Repeatable-id elements');
  for (let containerIndex = 0; containerIndex < elementLength; containerIndex += 1) {
    const container = ownArrayEntry(elements, containerIndex, 'Repeatable-id elements');
    if (jsxStaticAttributeValue(container, 'data-bind-list') === undefined) continue;
    for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
      const element = ownArrayEntry(elements, elementIndex, 'Repeatable-id elements');
      if (
        element.tag === 'template' &&
        !element.selfClosing &&
        isWithinElement(element, container) &&
        hasJsxAttribute(element, 'kovo-stamp')
      ) {
        appendMarkupFact(
          repeatableTemplateSpans,
          { end: element.closingStart, start: element.openingEnd },
          'Repeatable template spans',
        );
      }
    }
  }

  const repeatableIds: LiteralIdValue[] = [];
  const idLength = compilerArrayLength(ids, 'Literal id values');
  for (let idIndex = 0; idIndex < idLength; idIndex += 1) {
    const id = ownArrayEntry(ids, idIndex, 'Literal id values');
    if (id.element.repeatable || positionWithinSpans(id.index, repeatableTemplateSpans)) {
      appendMarkupFact(repeatableIds, id, 'Repeatable literal id values');
    }
  }
  return repeatableIds;
}

function kv224Diagnostic(
  diagnostics: DiagnosticFactory,
  detail: string,
  id: LiteralIdValue,
): CompilerDiagnostic {
  return diagnostics.at('KV224', { start: id.index, length: id.length }, detail);
}

function htmlContentModelDiagnostic(
  diagnostics: DiagnosticFactory,
  element: JsxElementModel,
  detail: string,
): CompilerDiagnostic {
  return diagnostics.at(
    'KV225',
    { start: element.start, length: element.openingEnd - element.start },
    detail,
  );
}

function componentQueryNames(model: ComponentModuleModel): string[] {
  return componentOptionObjectKeys(model, 'queries');
}

function countAttributeNames(attributes: readonly JsxAttributeModel[]): Map<string, number> {
  const counts = compilerCreateMap<string, number>();
  const length = compilerArrayLength(attributes, 'Attribute merge JSX attributes');
  for (let index = 0; index < length; index += 1) {
    const attribute = ownArrayEntry(attributes, index, 'Attribute merge JSX attributes');
    compilerMapSet(counts, attribute.name, (compilerMapGet(counts, attribute.name) ?? 0) + 1);
  }
  return counts;
}

function attributesNamed(
  attributes: readonly JsxAttributeModel[],
  name: string,
): JsxAttributeModel[] {
  const matches: JsxAttributeModel[] = [];
  const length = compilerArrayLength(attributes, 'Attribute merge JSX attributes');
  for (let index = 0; index < length; index += 1) {
    const attribute = ownArrayEntry(attributes, index, 'Attribute merge JSX attributes');
    if (attribute.name === name) {
      appendMarkupFact(matches, attribute, 'Duplicate JSX attributes');
    }
  }
  return matches;
}

function appendMarkupFact<Value>(target: Value[], value: Value, label: string): void {
  compilerDefineOwnDataProperty(target, compilerArrayLength(target, label), value);
}

function isBindingAttribute(name: string): boolean {
  return name === 'data-bind' || compilerStringStartsWith(name, 'data-bind:');
}

function attributeMergeDiagnostic(
  diagnostics: DiagnosticFactory,
  code: 'KV231' | 'KV232' | 'KV233',
  detail: string,
  attribute: JsxAttributeModel,
): CompilerDiagnostic {
  return diagnostics.at(
    code,
    { start: attribute.start, length: attribute.end - attribute.start },
    detail,
  );
}

function kv226Diagnostic(
  diagnostics: DiagnosticFactory,
  detail: string,
  index: number,
  length: number,
): CompilerDiagnostic {
  return diagnostics.at('KV226', { start: index, length }, detail);
}

function diagnosticKey(diagnostic: CompilerDiagnostic): string {
  return `${diagnostic.code}\0${diagnostic.message}`;
}

function kv221Diagnostic(diagnostics: DiagnosticFactory, value: IdrefValue): CompilerDiagnostic {
  return diagnostics.at('KV221', { start: value.index, length: value.length }, value.value);
}

function idrefValuesForElements(
  elements: readonly JsxElementModel[],
  packageComponentPrefixes?: readonly PackageComponentPrefixFact[],
): IdrefValue[] {
  const values: IdrefValue[] = [];
  const idrefAttributes = stringSetFromArray(
    [
      'aria-activedescendant',
      'aria-controls',
      'aria-describedby',
      'aria-labelledby',
      'aria-owns',
      'commandfor',
      'for',
      'htmlFor',
      'popovertarget',
    ],
    'Built-in IDREF attributes',
  );
  const packageIdrefAttributes = packageBehaviorIdrefAttributeNames(packageComponentPrefixes);

  const attributes = jsxAttributesForElements(elements);
  const attributeLength = compilerArrayLength(attributes, 'IDREF attributes');
  for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
    const attribute = ownArrayEntry(attributes, attributeIndex, 'IDREF attributes');
    if (
      !compilerSetHas(idrefAttributes, attribute.name) &&
      !compilerSetHas(packageIdrefAttributes, attribute.name)
    ) {
      continue;
    }
    const rawValue = attribute.value;
    if (!rawValue) continue;

    const multiValue =
      compilerStringStartsWith(attribute.name, 'aria-') &&
      attribute.name !== 'aria-activedescendant';
    if (!multiValue) {
      appendMarkupFact(
        values,
        {
          index: attribute.start,
          length: attribute.end - attribute.start,
          value: rawValue,
        },
        'IDREF values',
      );
      continue;
    }

    const rawParts = compilerStringSplit(compilerRegExpReplace(/\s+/gu, rawValue, '\n'), '\n');
    const partLength = compilerArrayLength(rawParts, 'Multi-value IDREF parts');
    for (let partIndex = 0; partIndex < partLength; partIndex += 1) {
      const value = ownArrayEntry(rawParts, partIndex, 'Multi-value IDREF parts');
      if (!value) continue;
      appendMarkupFact(
        values,
        {
          index: attribute.start,
          length: attribute.end - attribute.start,
          value,
        },
        'IDREF values',
      );
    }
  }

  return values;
}

function componentElementScopes(model: ComponentModuleModel): JsxElementModel[][] {
  const elements = jsxElements(model);
  const scopes: JsxElementModel[][] = [];
  const componentLength = compilerArrayLength(model.components, 'IDREF component models');
  const elementLength = compilerArrayLength(elements, 'IDREF JSX elements');
  for (let componentIndex = 0; componentIndex < componentLength; componentIndex += 1) {
    const component = ownArrayEntry(model.components, componentIndex, 'IDREF component models');
    if (!component.renderHost) continue;
    let host: JsxElementModel | undefined;
    for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
      const element = ownArrayEntry(elements, elementIndex, 'IDREF JSX elements');
      if (
        element.start === component.renderHost.start &&
        element.openingEnd === component.renderHost.end
      ) {
        host = element;
        break;
      }
    }
    if (!host) continue;
    const scopedElements: JsxElementModel[] = [];
    for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
      const element = ownArrayEntry(elements, elementIndex, 'IDREF JSX elements');
      if (element.start >= host.start && element.end <= host.end) {
        appendMarkupFact(scopedElements, element, 'Scoped JSX elements');
      }
    }
    appendMarkupFact(scopes, scopedElements, 'Component element scopes');
  }

  if (scopes.length > 0) return scopes;
  appendMarkupFact(scopes, elements, 'Component element scopes');
  return scopes;
}

function packageBehaviorIdrefAttributeNames(
  facts: readonly PackageComponentPrefixFact[] | undefined,
): Set<string> {
  const names = compilerCreateSet<string>();
  if (!facts) return names;

  const factLength = compilerArrayLength(facts, 'Package component prefix facts');
  for (let factIndex = 0; factIndex < factLength; factIndex += 1) {
    const fact = ownArrayEntry(facts, factIndex, 'Package component prefix facts');
    const effectivePrefix = compilerOwnDataValue(
      fact,
      'effectivePrefix',
      'Package component prefix fact',
    );
    const declaredPrefix = compilerOwnDataValue(fact, 'prefix', 'Package component prefix fact');
    const prefix = effectivePrefix ?? declaredPrefix;
    if (prefix !== undefined && prefix !== null && typeof prefix !== 'string') {
      compilerFailClosed(`Package component prefix fact prefix must be a string.`);
    }
    if (!prefix || compilerStringStartsWith(prefix, 'kovo-')) continue;

    const behaviorAttributes = compilerOwnDataValue(
      fact,
      'idrefBehaviorAttributes',
      'Package component prefix fact',
    );
    if (behaviorAttributes === undefined) continue;
    if (!compilerArrayIsArray(behaviorAttributes)) {
      compilerFailClosed(`Package idrefBehaviorAttributes must be an array.`);
    }
    const behaviorLength = compilerArrayLength(
      behaviorAttributes,
      'Package IDREF behavior attributes',
    );
    for (let behaviorIndex = 0; behaviorIndex < behaviorLength; behaviorIndex += 1) {
      const behaviorName = compilerOwnDataValue(
        behaviorAttributes,
        behaviorIndex,
        'Package IDREF behavior attributes',
      );
      if (typeof behaviorName !== 'string') {
        compilerFailClosed(`Package IDREF behavior attributes[${behaviorIndex}] invalid.`);
      }
      compilerSetAdd(names, `${prefix}${behaviorName}`);
    }
  }

  return names;
}

function jsxAttributes(model: ComponentModuleModel): JsxAttributeModel[] {
  return jsxAttributesForElements(jsxElements(model));
}

function jsxAttributesForElements(elements: readonly JsxElementModel[]): JsxAttributeModel[] {
  const attributes: JsxAttributeModel[] = [];
  const elementLength = compilerArrayLength(elements, 'JSX attribute elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = ownArrayEntry(elements, elementIndex, 'JSX attribute elements');
    appendArray(attributes, element.attributes, 'JSX attributes');
  }
  return attributes;
}

function hasJsxAttribute(element: JsxElementModel, name: string): boolean {
  return jsxAttributeNamed(element, name) !== undefined;
}

function jsxStaticAttributeValue(element: JsxElementModel, name: string): string | undefined {
  return jsxAttributeNamed(element, name)?.value;
}

function jsxAttributeNamed(element: JsxElementModel, name: string): JsxAttributeModel | undefined {
  const attributeLength = compilerArrayLength(element.attributes, 'JSX element attributes');
  for (let index = 0; index < attributeLength; index += 1) {
    const attribute = ownArrayEntry(element.attributes, index, 'JSX element attributes');
    if (attribute.name === name) return attribute;
  }
  return undefined;
}

function isWithinElement(candidate: JsxElementModel, container: JsxElementModel): boolean {
  return candidate.start > container.start && candidate.end < container.end;
}

function hasJsxAncestor(element: JsxElementModel, tag: string): boolean {
  return hasAnyJsxAncestor(element, [tag]);
}

function hasAnyJsxAncestor(element: JsxElementModel, tags: readonly string[]): boolean {
  const ancestorLength = compilerArrayLength(element.ancestorTags, 'JSX ancestor tags');
  const tagLength = compilerArrayLength(tags, 'Expected JSX ancestor tags');
  for (let ancestorIndex = 0; ancestorIndex < ancestorLength; ancestorIndex += 1) {
    const ancestor = compilerStringToLowerCase(
      ownArrayEntry(element.ancestorTags, ancestorIndex, 'JSX ancestor tags'),
    );
    for (let tagIndex = 0; tagIndex < tagLength; tagIndex += 1) {
      if (ancestor === ownArrayEntry(tags, tagIndex, 'Expected JSX ancestor tags')) return true;
    }
  }
  return false;
}

function isNativeHtmlTag(tag: string): boolean {
  return tag === compilerStringToLowerCase(tag) && compilerStringIndexOf(tag, '-') < 0;
}

function positionWithinSpans(
  position: number,
  spans: readonly { end: number; start: number }[],
): boolean {
  const spanLength = compilerArrayLength(spans, 'Repeatable template spans');
  for (let index = 0; index < spanLength; index += 1) {
    const span = ownArrayEntry(spans, index, 'Repeatable template spans');
    if (position >= span.start && position < span.end) return true;
  }
  return false;
}

function stringSetFromArray(values: readonly string[], label: string): Set<string> {
  const set = compilerCreateSet<string>();
  addStringsToSet(set, values, label);
  return set;
}

function addStringsToSet(set: Set<string>, values: readonly string[], label: string): void {
  const valueLength = compilerArrayLength(values, label);
  for (let index = 0; index < valueLength; index += 1) {
    const value = compilerOwnDataValue(values, index, label);
    if (typeof value !== 'string') compilerFailClosed(`${label}[${index}] must be a string.`);
    compilerSetAdd(set, value);
  }
}

function appendArray<Value>(target: Value[], values: readonly Value[], label: string): void {
  const valueLength = compilerArrayLength(values, label);
  for (let index = 0; index < valueLength; index += 1) {
    appendMarkupFact(target, ownArrayEntry(values, index, label), label);
  }
}

function ownArrayEntry<Value>(values: readonly Value[], index: number, label: string): Value {
  const value = compilerOwnDataValue(values, index, label) as Value | undefined;
  if (value === undefined) compilerFailClosed(`${label}[${index}] must be own data.`);
  return value;
}

function registryObject(
  facts: RegistryFacts | undefined,
  property: 'queries',
): Record<string, unknown> | undefined {
  if (!facts) return undefined;
  const value = compilerOwnDataValue(facts, property, 'Residual-stamp registry facts');
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || compilerArrayIsArray(value)) {
    compilerFailClosed(`Residual-stamp registry facts.${property} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function registryStringArray(facts: RegistryFacts | undefined, property: 'components'): string[] {
  if (!facts) return [];
  const value = compilerOwnDataValue(facts, property, 'Residual-stamp registry facts');
  if (value === undefined) return [];
  if (!compilerArrayIsArray(value)) {
    compilerFailClosed(`Residual-stamp registry facts.${property} must be an array.`);
  }
  const result: string[] = [];
  const valueLength = compilerArrayLength(value, `Residual-stamp registry facts.${property}`);
  for (let index = 0; index < valueLength; index += 1) {
    const entry = compilerOwnDataValue(value, index, `Residual-stamp registry facts.${property}`);
    if (typeof entry !== 'string') {
      compilerFailClosed(`Residual-stamp registry facts.${property}[${index}] must be a string.`);
    }
    appendMarkupFact(result, entry, `Residual-stamp registry facts.${property}`);
  }
  return result;
}
