import { diagnosticDefinitions } from '@jiso/core';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import {
  componentExplicitNames,
  componentOptionObjectKeys,
  jsxElements,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
} from '../scan/parse.js';
import { dedupeBy, kebabCase, splitDepValue } from '../shared.js';
import type { PackageComponentPrefixFact, RegistryFacts } from '../types.js';

interface IdrefValue {
  index: number;
  length: number;
  value: string;
}

interface LiteralIdValue {
  index: number;
  length: number;
  value: string;
}

interface ResidualStampValidationOptions {
  fileName: string;
  registryFacts?: RegistryFacts;
}

export function validateIdrefs(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
  packageComponentPrefixes?: readonly PackageComponentPrefixFact[],
): CompilerDiagnostic[] {
  const diagnostics = componentElementScopes(model).flatMap((elements) =>
    validateIdrefsInElementScope(source, fileName, elements, packageComponentPrefixes),
  );
  return dedupeBy(diagnostics, diagnosticKey);
}

export function validateStaticIds(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const seen = new Set<string>();

  for (const id of literalIdValues(model)) {
    if (seen.has(id.value)) {
      diagnostics.push(fw224Diagnostic(fileName, source, `duplicate id="${id.value}"`, id));
    }
    seen.add(id.value);
  }

  for (const id of repeatableLiteralIds(model)) {
    diagnostics.push(fw224Diagnostic(fileName, source, `repeatable id="${id.value}"`, id));
  }

  return dedupeBy(diagnostics, diagnosticKey);
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
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const elements = jsxElements(model);

  for (const element of elements) {
    const tag = element.tag.toLowerCase();
    if (!isNativeHtmlTag(tag)) continue;

    if (blockTagsThatCloseParagraph.has(tag) && hasJsxAncestor(element, 'p')) {
      diagnostics.push(
        htmlContentModelDiagnostic(source, fileName, element, `<${tag}> cannot appear inside <p>`),
      );
    }

    if (
      tag === 'tr' &&
      !hasJsxAttribute(element, 'fw-c') &&
      !hasAnyJsxAncestor(element, ['table', 'tbody', 'thead', 'tfoot'])
    ) {
      diagnostics.push(
        htmlContentModelDiagnostic(
          source,
          fileName,
          element,
          '<tr> must be inside a table section or table',
        ),
      );
    }
  }

  return diagnostics;
}

export function validateResidualStamps(
  source: string,
  model: ComponentModuleModel,
  options: ResidualStampValidationOptions,
  componentName: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const knownQueries = new Set([
    ...Object.keys(options.registryFacts?.queries ?? {}),
    ...componentQueryNames(model),
  ]);
  const knownComponents = new Set([
    kebabCase(componentName),
    ...componentExplicitNames(model),
    ...(options.registryFacts?.components ?? []),
  ]);
  for (const attribute of jsxAttributes(model)) {
    if (attribute.name === 'fw-c') {
      const component = attribute.value;
      if (component && !knownComponents.has(component)) {
        diagnostics.push(
          fw226Diagnostic(
            options.fileName,
            source,
            `fw-c="${component}"`,
            attribute.start,
            attribute.end - attribute.start,
          ),
        );
      }
    }

    if (attribute.name !== 'fw-deps') continue;

    for (const dep of splitDepValue(attribute.value ?? '')) {
      const query = dep.split(':', 1)[0] ?? dep;
      if (!knownQueries.has(query)) {
        diagnostics.push(
          fw226Diagnostic(
            options.fileName,
            source,
            `fw-deps="${dep}"`,
            attribute.start,
            attribute.end - attribute.start,
          ),
        );
      }
    }
  }

  return dedupeBy(diagnostics, diagnosticKey);
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
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  for (const element of jsxElements(model)) {
    const attrs = element.attributes.map((attribute) => attribute.name);
    const counts = countValues(attrs);

    for (const [name, count] of counts) {
      if (count < 2) continue;
      const duplicateAttributes = element.attributes.filter((item) => item.name === name);
      const attribute = duplicateAttributes[0];
      if (!attribute) continue;

      if (isBindingAttribute(name)) {
        diagnostics.push(attributeMergeDiagnostic(source, fileName, 'FW233', name, attribute));
        continue;
      }

      if (
        ambiguousRelationshipAttributes.has(name) ||
        name.startsWith('data-p-') ||
        name === 'fw-c' ||
        name === 'fw-state'
      ) {
        diagnostics.push(attributeMergeDiagnostic(source, fileName, 'FW231', name, attribute));
        continue;
      }

      if (name.startsWith('aria-') || primitiveOwnedOverrideAttributes.has(name)) {
        diagnostics.push(
          attributeMergeDiagnostic(
            source,
            fileName,
            'FW232',
            name,
            duplicateAttributes[1] ?? attribute,
          ),
        );
      }
    }
  }

  return dedupeBy(diagnostics, diagnosticKey);
}

function literalIdValues(model: ComponentModuleModel, offset = 0): LiteralIdValue[] {
  return literalIdValuesForElements(jsxElements(model), offset);
}

function literalIdValuesForElements(
  elements: readonly JsxElementModel[],
  offset = 0,
): LiteralIdValue[] {
  return jsxAttributesForElements(elements).flatMap((attribute) =>
    attribute.name === 'id' && attribute.value
      ? [
          {
            index: offset + attribute.start,
            length: attribute.end - attribute.start,
            value: attribute.value,
          },
        ]
      : [],
  );
}

function validateIdrefsInElementScope(
  source: string,
  fileName: string,
  elements: readonly JsxElementModel[],
  packageComponentPrefixes?: readonly PackageComponentPrefixFact[],
): CompilerDiagnostic[] {
  const ids = new Set(literalIdValuesForElements(elements).map((id) => id.value));
  const values = idrefValuesForElements(elements, packageComponentPrefixes);
  const missing = ids.size === 0 ? values : values.filter((value) => !ids.has(value.value));

  return dedupeBy(missing, (value) => `${value.index}\0${value.value}`).map((value) =>
    fw221Diagnostic(fileName, source, value),
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
          hasJsxAttribute(element, 'fw-stamp'),
      ),
    )
    .map((template) => ({ end: template.closingStart, start: template.openingEnd }));

  return ids.filter((id) =>
    repeatableTemplateSpans.some((span) => id.index >= span.start && id.index < span.end),
  );
}

function fw224Diagnostic(
  fileName: string,
  source: string,
  detail: string,
  id: LiteralIdValue,
): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'FW224', source, id.index, id.length),
    message: `${diagnosticDefinitions.FW224.message} ${detail}`,
  };
}

function htmlContentModelDiagnostic(
  source: string,
  fileName: string,
  element: JsxElementModel,
  detail: string,
): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'FW225', source, element.start, element.openingEnd - element.start),
    message: `${diagnosticDefinitions.FW225.message} ${detail}`,
  };
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
  source: string,
  fileName: string,
  code: 'FW231' | 'FW232' | 'FW233',
  detail: string,
  attribute: JsxAttributeModel,
): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, code, source, attribute.start, attribute.end - attribute.start),
    message: `${diagnosticDefinitions[code].message} ${detail}`,
  };
}

function fw226Diagnostic(
  fileName: string,
  source: string,
  detail: string,
  index: number,
  length: number,
): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'FW226', source, index, length),
    message: `${diagnosticDefinitions.FW226.message} ${detail}`,
  };
}

function diagnosticKey(diagnostic: CompilerDiagnostic): string {
  return `${diagnostic.code}\0${diagnostic.message}`;
}

function fw221Diagnostic(fileName: string, source: string, value: IdrefValue): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'FW221', source, value.index, value.length),
    message: `${diagnosticDefinitions.FW221.message} ${value.value}`,
  };
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
    if (!prefix || prefix.startsWith('fw-')) continue;

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
