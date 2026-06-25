import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import { deriveComponentNames } from '../component-names.js';
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

const navigationSegmentStampAttributes = new Set([
  'kovo-nav-components',
  'kovo-nav-kind',
  'kovo-nav-name',
  'kovo-nav-queries',
  'kovo-nav-segment',
]);

export function validateIdrefs(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  packageComponentPrefixes?: readonly PackageComponentPrefixFact[],
): CompilerDiagnostic[] {
  const found = componentElementScopes(model).flatMap((elements) =>
    validateIdrefsInElementScope(diagnostics, elements, packageComponentPrefixes),
  );
  return dedupeBy(found, diagnosticKey);
}

export function validateStaticIds(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];
  const seen = new Set<string>();

  for (const id of literalIdValues(model)) {
    if (seen.has(id.value)) {
      found.push(kv224Diagnostic(diagnostics, `duplicate id="${id.value}"`, id));
    }
    seen.add(id.value);
  }

  for (const id of repeatableLiteralIds(model)) {
    found.push(kv224Diagnostic(diagnostics, `repeatable id="${id.value}"`, id));
  }

  return dedupeBy(found, diagnosticKey);
}

export function validateHandAuthoredNavigationSegmentStamps(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];

  for (const element of jsxElements(model)) {
    for (const attribute of element.attributes) {
      if (!navigationSegmentStampAttributes.has(attribute.name)) continue;
      found.push({
        ...diagnostics.at(
          'KV235',
          { start: attribute.start, length: attribute.end - attribute.start },
          `hand-authored navigation segment stamp ${attribute.name}.`,
        ),
        help: [
          diagnosticDefinitions.KV235.help,
          'Navigation segment stamps are compiler-derived from route(), layout(), and the target document used by enhanced navigation.',
          'Fix: remove the kovo-nav-* attribute and declare sibling route/layout regions with the public route({ regions }) API.',
          'SPEC §8 makes enhanced navigation loader-owned; app TSX does not author segment stamps or persistence policy.',
        ].join('\n'),
      });
    }
  }

  return dedupeBy(found, diagnosticKey);
}

const blockTagsThatCloseParagraph = new Set([
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
]);

export function validateHtmlContentModel(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];
  const elements = jsxElements(model);

  for (const element of elements) {
    const tag = element.tag.toLowerCase();
    if (!isNativeHtmlTag(tag)) continue;

    if (blockTagsThatCloseParagraph.has(tag) && hasJsxAncestor(element, 'p')) {
      found.push(
        htmlContentModelDiagnostic(diagnostics, element, `<${tag}> cannot appear inside <p>`),
      );
    }

    if (
      tag === 'tr' &&
      !hasJsxAttribute(element, 'kovo-c') &&
      !hasAnyJsxAncestor(element, ['table', 'tbody', 'thead', 'tfoot'])
    ) {
      found.push(
        htmlContentModelDiagnostic(
          diagnostics,
          element,
          '<tr> must be inside a table section or table',
        ),
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
  const knownQueries = new Set([
    ...Object.keys(options.registryFacts?.queries ?? {}),
    ...componentQueryNames(model),
  ]);
  const knownComponents = new Set([
    ...model.components.map(
      (component) => deriveComponentNames(options.fileName, component).domName,
    ),
    ...(options.registryFacts?.components ?? []),
  ]);
  for (const attribute of jsxAttributes(model)) {
    if (attribute.name === 'kovo-c') {
      const component = attribute.value;
      if (component && !knownComponents.has(component)) {
        found.push(
          kv226Diagnostic(
            diagnostics,
            `kovo-c="${component}"`,
            attribute.start,
            attribute.end - attribute.start,
          ),
        );
      }
    }

    if (attribute.name !== 'kovo-deps') continue;

    for (const dep of splitDepValue(attribute.value ?? '')) {
      const query = dep.split(':', 1)[0] ?? dep;
      if (!knownQueries.has(query)) {
        found.push(
          kv226Diagnostic(
            diagnostics,
            `kovo-deps="${dep}"`,
            attribute.start,
            attribute.end - attribute.start,
          ),
        );
      }
    }
  }

  return dedupeBy(found, diagnosticKey);
}

const ambiguousRelationshipAttributes = new Set([
  'aria-activedescendant',
  'aria-controls',
  'aria-describedby',
  'aria-labelledby',
  'aria-owns',
  'commandfor',
  'for',
  'htmlFor',
  'popovertarget',
]);

const primitiveOwnedOverrideAttributes = new Set(['role', 'data-state']);

export function validateAttributeMergeConflicts(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];

  for (const element of jsxElements(model)) {
    const attrs = element.attributes.map((attribute) => attribute.name);
    const counts = countValues(attrs);

    for (const [name, count] of counts) {
      if (count < 2) continue;
      const duplicateAttributes = element.attributes.filter((item) => item.name === name);
      const attribute = duplicateAttributes[0];
      if (!attribute) continue;

      if (isBindingAttribute(name)) {
        found.push(attributeMergeDiagnostic(diagnostics, 'KV233', name, attribute));
        continue;
      }

      if (
        ambiguousRelationshipAttributes.has(name) ||
        name.startsWith('data-p-') ||
        name === 'kovo-c' ||
        name === 'kovo-state'
      ) {
        found.push(attributeMergeDiagnostic(diagnostics, 'KV231', name, attribute));
        continue;
      }

      if (name.startsWith('aria-') || primitiveOwnedOverrideAttributes.has(name)) {
        found.push(
          attributeMergeDiagnostic(diagnostics, 'KV232', name, duplicateAttributes[1] ?? attribute),
        );
      }
    }
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
  return elements.flatMap((element) =>
    element.attributes.flatMap((attribute) =>
      attribute.name === 'id' && attribute.value
        ? [
            {
              element,
              index: offset + attribute.start,
              length: attribute.end - attribute.start,
              value: attribute.value,
            },
          ]
        : [],
    ),
  );
}

function validateIdrefsInElementScope(
  diagnostics: DiagnosticFactory,
  elements: readonly JsxElementModel[],
  packageComponentPrefixes?: readonly PackageComponentPrefixFact[],
): CompilerDiagnostic[] {
  const ids = new Set(literalIdValuesForElements(elements).map((id) => id.value));
  const values = idrefValuesForElements(elements, packageComponentPrefixes);
  const missing = ids.size === 0 ? values : values.filter((value) => !ids.has(value.value));

  return dedupeBy(missing, (value) => `${value.index}\0${value.value}`).map((value) =>
    kv221Diagnostic(diagnostics, value),
  );
}

function repeatableLiteralIds(model: ComponentModuleModel): LiteralIdValue[] {
  const ids = literalIdValues(model);
  const elements = jsxElements(model);
  const repeatableTemplateSpans = elements
    .filter((element) => jsxStaticAttributeValue(element, 'data-bind-list') !== undefined)
    .flatMap((container) =>
      elements.filter(
        (element) =>
          element.tag === 'template' &&
          !element.selfClosing &&
          isWithinElement(element, container) &&
          hasJsxAttribute(element, 'kovo-stamp'),
      ),
    )
    .map((template) => ({ end: template.closingStart, start: template.openingEnd }));

  return ids.filter(
    (id) =>
      id.element.repeatable ||
      repeatableTemplateSpans.some((span) => id.index >= span.start && id.index < span.end),
  );
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

function countValues(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return counts;
}

function isBindingAttribute(name: string): boolean {
  return name === 'data-bind' || name.startsWith('data-bind:');
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
  const idrefAttributes = new Set([
    'aria-activedescendant',
    'aria-controls',
    'aria-describedby',
    'aria-labelledby',
    'aria-owns',
    'commandfor',
    'for',
    'htmlFor',
    'popovertarget',
  ]);
  const packageIdrefAttributes = packageBehaviorIdrefAttributeNames(packageComponentPrefixes);

  for (const attribute of jsxAttributesForElements(elements)) {
    if (!idrefAttributes.has(attribute.name) && !packageIdrefAttributes.has(attribute.name)) {
      continue;
    }
    const rawValue = attribute.value;
    if (!rawValue) continue;

    const multiValue =
      attribute.name.startsWith('aria-') && attribute.name !== 'aria-activedescendant';
    values.push(
      ...(multiValue
        ? rawValue
            .split(/\s+/)
            .filter(Boolean)
            .map((value) => ({
              index: attribute.start,
              length: attribute.end - attribute.start,
              value,
            }))
        : [
            {
              index: attribute.start,
              length: attribute.end - attribute.start,
              value: rawValue,
            },
          ]),
    );
  }

  return values;
}

function componentElementScopes(model: ComponentModuleModel): JsxElementModel[][] {
  const elements = jsxElements(model);
  const scopes = model.components.flatMap((component) => {
    const host = component.renderHost
      ? elements.find(
          (element) =>
            element.start === component.renderHost?.start &&
            element.openingEnd === component.renderHost.end,
        )
      : undefined;
    return host
      ? [elements.filter((element) => element.start >= host.start && element.end <= host.end)]
      : [];
  });

  return scopes.length > 0 ? scopes : [elements];
}

function packageBehaviorIdrefAttributeNames(
  facts: readonly PackageComponentPrefixFact[] | undefined,
): Set<string> {
  const names = new Set<string>();
  if (!facts) return names;

  for (const fact of facts) {
    const prefix = fact.effectivePrefix ?? fact.prefix;
    if (!prefix || prefix.startsWith('kovo-')) continue;

    for (const behaviorName of fact.idrefBehaviorAttributes ?? []) {
      names.add(`${prefix}${behaviorName}`);
    }
  }

  return names;
}

function jsxAttributes(model: ComponentModuleModel): JsxAttributeModel[] {
  return jsxAttributesForElements(jsxElements(model));
}

function jsxAttributesForElements(elements: readonly JsxElementModel[]): JsxAttributeModel[] {
  return elements.flatMap((element) => [...element.attributes]);
}

function hasJsxAttribute(element: JsxElementModel, name: string): boolean {
  return element.attributes.some((attribute) => attribute.name === name);
}

function jsxStaticAttributeValue(element: JsxElementModel, name: string): string | undefined {
  return element.attributes.find((attribute) => attribute.name === name)?.value;
}

function isWithinElement(candidate: JsxElementModel, container: JsxElementModel): boolean {
  return candidate.start > container.start && candidate.end < container.end;
}

function hasJsxAncestor(element: JsxElementModel, tag: string): boolean {
  return hasAnyJsxAncestor(element, [tag]);
}

function hasAnyJsxAncestor(element: JsxElementModel, tags: readonly string[]): boolean {
  return element.ancestorTags.some((ancestor) => tags.includes(ancestor.toLowerCase()));
}

function isNativeHtmlTag(tag: string): boolean {
  return tag === tag.toLowerCase() && !tag.includes('-');
}
