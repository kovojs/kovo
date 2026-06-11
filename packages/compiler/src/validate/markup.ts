import { diagnosticDefinitions } from '@jiso/core';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import type { RegistryFacts } from '../graph.js';
import {
  componentExplicitNames,
  componentOptionSource,
  jsxElements,
  parseComponentModule as parseComponentModuleModel,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
} from '../scan/parse.js';
import { dedupeBy, kebabCase, splitDepValue } from '../shared.js';
import { topLevelObjectKeys } from '../scan/object.js';
import { dataBindListTemplateBodies } from './bindings.js';

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
): CompilerDiagnostic[] {
  const ids = new Set(literalIdValues(model).map((id) => id.value));
  if (ids.size === 0) {
    return idrefValues(model).map((value) => fw221Diagnostic(fileName, source, value));
  }

  const missing = idrefValues(model).filter((value) => !ids.has(value.value));
  return dedupeBy(missing, (value) => value.value).map((value) =>
    fw221Diagnostic(fileName, source, value),
  );
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

  for (const id of repeatableLiteralIds(source, model)) {
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

    if (blockTagsThatCloseParagraph.has(tag) && hasJsxAncestor(element, 'p', elements)) {
      diagnostics.push(
        htmlContentModelDiagnostic(source, fileName, element, `<${tag}> cannot appear inside <p>`),
      );
    }

    if (
      tag === 'tr' &&
      !hasJsxAttribute(element, 'fw-c') &&
      !hasAnyJsxAncestor(element, ['table', 'tbody', 'thead', 'tfoot'], elements)
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
      const attribute = element.attributes.find((item) => item.name === name);
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
        diagnostics.push(attributeMergeDiagnostic(source, fileName, 'FW232', name, attribute));
      }
    }
  }

  return dedupeBy(diagnostics, diagnosticKey);
}

function literalIdValues(model: ComponentModuleModel, offset = 0): LiteralIdValue[] {
  return jsxAttributes(model).flatMap((attribute) =>
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

function repeatableLiteralIds(source: string, model: ComponentModuleModel): LiteralIdValue[] {
  return dataBindListTemplateBodies(source, model).flatMap((body) =>
    literalIdValues(parseComponentModuleModel('component.tsx', body.source), body.offset),
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
  return topLevelObjectKeys(componentOptionSource(model, 'queries') ?? '{}');
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

function idrefValues(model: ComponentModuleModel): IdrefValue[] {
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

  for (const attribute of jsxAttributes(model)) {
    if (!idrefAttributes.has(attribute.name)) continue;
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

function jsxAttributes(model: ComponentModuleModel): JsxAttributeModel[] {
  return jsxElements(model).flatMap((element) => [...element.attributes]);
}

function hasJsxAttribute(element: JsxElementModel, name: string): boolean {
  return element.attributes.some((attribute) => attribute.name === name);
}

function isWithinElement(candidate: JsxElementModel, container: JsxElementModel): boolean {
  return candidate.start > container.start && candidate.end < container.end;
}

function hasJsxAncestor(
  element: JsxElementModel,
  tag: string,
  elements: readonly JsxElementModel[],
): boolean {
  return hasAnyJsxAncestor(element, [tag], elements);
}

function hasAnyJsxAncestor(
  element: JsxElementModel,
  tags: readonly string[],
  elements: readonly JsxElementModel[],
): boolean {
  return elements.some(
    (candidate) =>
      candidate !== element &&
      isWithinElement(element, candidate) &&
      tags.includes(candidate.tag.toLowerCase()),
  );
}

function isNativeHtmlTag(tag: string): boolean {
  return tag === tag.toLowerCase() && !tag.includes('-');
}
