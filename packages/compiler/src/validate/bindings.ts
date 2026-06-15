import { diagnosticDefinitions } from '@jiso/core';

import { collectDataBindListStamps } from '../analyze/query-updates.js';
import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import { dedupeBy } from '../shared.js';
import {
  jsxElements,
  soleJsxExpressionChild,
  type ComponentModuleModel,
  type JsxElementModel,
} from '../scan/parse.js';
import {
  componentQueryShapes,
  isRelativeBindingPath,
  knownQueryNames,
  listItemShapeAtBindingPath,
  parseBindingPath,
  queryNameFromPath,
  queryPathUsesKnownQuery,
  relativeBindingPath,
  validateListBindingInQueryShapes,
  validatePathInQueryShapes,
  validatePathInShape,
} from '../analyze/query-shapes.js';
import type { CompileComponentOptions, QueryShape, QueryTemplateStampFact } from '../types.js';

interface DataBindAttribute {
  index: number;
  length: number;
  name: string;
  path: string;
  query: string | null;
  relativeReadPath: string | null;
}

export function validateDataBindings(
  source: string,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const queryShapes = componentQueryShapes(options);
  if (!queryShapes) return [];

  const listStamps = collectDataBindListStamps(model);
  const listBindings = dataBindListAttributes(model);
  const bindingAttributes = dataBindAttributes(model);

  const bindingDiagnostics = bindingAttributes
    .filter((binding) => binding.query !== null && binding.query !== 'state')
    .flatMap((binding) => {
      const result = validatePathInQueryShapes(binding.path, queryShapes);
      if (!result.exists) {
        return [
          {
            ...diagnosticFor(options.fileName, 'FW302', source, binding.index, binding.length),
            message: `${diagnosticDefinitions.FW302.message} ${binding.path}`,
          },
        ];
      }

      return result.nullableTraversal
        ? [fw227Diagnostic(source, options.fileName, binding, result.nullableTraversal)]
        : [];
    });

  const listDiagnostics = listStamps.flatMap((stamp) => {
    const binding = listBindings.find((candidate) => candidate.path === stamp.list);
    const result = validateListStampInQueryShapes(stamp, queryShapes);
    if (!result.exists) {
      return [
        {
          ...diagnosticFor(options.fileName, 'FW302', source, binding?.index, binding?.length),
          message: `${diagnosticDefinitions.FW302.message} ${stamp.list}`,
        },
      ];
    }

    return result.nullableTraversal && binding
      ? [fw227Diagnostic(source, options.fileName, binding, result.nullableTraversal)]
      : [];
  });

  const itemDiagnostics = nullableItemBindingDiagnostics(
    source,
    model,
    bindingAttributes,
    listStamps,
    queryShapes,
    options.fileName,
  );

  return bindingDiagnostics.concat(listDiagnostics, itemDiagnostics);
}

export function validateStampExpressionDrift(
  source: string,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const knownQueries = knownQueryNames(model, options);

  return bindingExpressionStamps(model)
    .filter(
      (stamp) =>
        queryPathUsesKnownQuery(stamp.binding, knownQueries) &&
        queryPathUsesKnownQuery(stamp.expression, knownQueries),
    )
    .map((stamp) => {
      const code = stamp.binding === stamp.expression ? 'FW223' : 'FW222';

      return {
        ...diagnosticFor(options.fileName, code, source, stamp.index, stamp.length),
        message: `${diagnosticDefinitions[code].message} data-bind="${stamp.binding}" wraps {${stamp.expression}}`,
      };
    });
}

function bindingExpressionStamps(
  model: ComponentModuleModel,
): Array<{ binding: string; expression: string; index: number; length: number }> {
  return jsxElements(model).flatMap((element) => {
    const attribute = element.attributes.find((item) => item.name === 'data-bind');
    const binding = attribute?.value;
    if (!attribute || !binding) return [];
    if (element.selfClosing) return [];

    const expression = soleJsxExpressionChild(element, model)?.solePropertyAccessPath ?? null;
    return expression
      ? [{ binding, expression, index: attribute.start, length: attribute.end - attribute.start }]
      : [];
  });
}

function dataBindAttributes(model: ComponentModuleModel): DataBindAttribute[] {
  return jsxAttributes(model)
    .filter(
      (attribute) =>
        isBindingAttribute(attribute.name) &&
        attribute.value !== undefined &&
        attribute.value !== '',
    )
    .map((attribute) => dataBindAttributeFact(attribute.name, attribute.value ?? '', attribute));
}

function dataBindListAttributes(model: ComponentModuleModel): DataBindAttribute[] {
  return jsxAttributes(model)
    .filter(
      (attribute) =>
        attribute.name === 'data-bind-list' &&
        attribute.value !== undefined &&
        attribute.value !== '',
    )
    .map((attribute) => dataBindAttributeFact(attribute.name, attribute.value ?? '', attribute));
}

function dataBindAttributeFact(
  name: string,
  path: string,
  attribute: { end: number; start: number },
): DataBindAttribute {
  return {
    index: attribute.start,
    length: attribute.end - attribute.start,
    name,
    path,
    query: isRelativeBindingPath(path) ? null : queryNameFromPath(path),
    relativeReadPath: isRelativeBindingPath(path) ? relativeBindingPath(path) : null,
  };
}

function validateListStampInQueryShapes(
  stamp: QueryTemplateStampFact,
  queryShapes: Record<string, QueryShape>,
): ReturnType<typeof validateListBindingInQueryShapes> {
  return validateListBindingInQueryShapes(
    stamp.list,
    stamp.key,
    stamp.itemBindingPlaceholders?.map((placeholder) => placeholder.path) ?? [],
    queryShapes,
  );
}

function nullableItemBindingDiagnostics(
  source: string,
  model: ComponentModuleModel,
  bindingAttributes: readonly DataBindAttribute[],
  listStamps: readonly QueryTemplateStampFact[],
  queryShapes: Record<string, QueryShape>,
  fileName: string,
): CompilerDiagnostic[] {
  const elements = jsxElements(model);
  const diagnostics: CompilerDiagnostic[] = [];

  for (const stamp of listStamps) {
    const itemShape = listItemShapeAtBindingPath(stamp.list, queryShapes);
    if (itemShape === undefined) continue;

    const containers = elements.filter(
      (element) =>
        jsxStaticAttributeValue(element, 'data-bind-list') === stamp.list &&
        jsxStaticAttributeValue(element, 'fw-key') === stamp.key,
    );

    for (const container of containers) {
      for (const binding of bindingAttributes.filter(
        (candidate) => candidate.relativeReadPath !== null,
      )) {
        const element = elements.find((candidate) =>
          candidate.attributes.some(
            (attribute) =>
              attribute.start === binding.index && attribute.end === binding.index + binding.length,
          ),
        );
        if (!element || !isWithinElement(element, container)) continue;

        const result = validatePathInShape(
          itemShape,
          parseBindingPath(binding.relativeReadPath ?? ''),
        );
        if (result.exists && result.nullableTraversal) {
          diagnostics.push(fw227Diagnostic(source, fileName, binding, result.nullableTraversal));
        }
      }
    }
  }

  return dedupeBy(diagnostics, (diagnostic) =>
    [diagnostic.code, diagnostic.fileName, diagnostic.start?.line, diagnostic.start?.column].join(
      ':',
    ),
  );
}

function fw227Diagnostic(
  source: string,
  fileName: string,
  binding: DataBindAttribute,
  traversal: { segment: string },
): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'FW227', source, binding.index, binding.length),
    help: diagnosticDefinitions.FW227.help,
    message: `${diagnosticDefinitions.FW227.message} ${binding.path} (segment: ${traversal.segment})`,
  };
}

function jsxAttributes(model: ComponentModuleModel) {
  return jsxElements(model).flatMap((element) => [...element.attributes]);
}

function jsxStaticAttributeValue(element: JsxElementModel, name: string): string | undefined {
  return element.attributes.find((attribute) => attribute.name === name)?.value;
}

function isWithinElement(candidate: JsxElementModel, container: JsxElementModel): boolean {
  return candidate.start > container.start && candidate.end < container.end;
}

function isBindingAttribute(name: string): boolean {
  return name === 'data-bind' || name.startsWith('data-bind:');
}
