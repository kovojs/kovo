import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import { collectDataBindListStamps } from '../analyze/query-updates.js';
import { type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';
import { dedupeBy } from '../shared.js';
import {
  callExpressions,
  componentStateReturnObjectModel,
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
  type PathShapeValidation,
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
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const queryShapes = componentQueryShapes(options);

  const listStamps = collectDataBindListStamps(model);
  const listBindings = dataBindListAttributes(model);
  const bindingAttributes = dataBindAttributes(model);

  const bindingDiagnostics = bindingAttributes
    .filter((binding) => queryShapes && binding.query !== null && binding.query !== 'state')
    .flatMap((binding) => {
      const result = validatePathInQueryShapes(binding.path, queryShapes ?? {});
      if (!result.exists) {
        return [
          diagnostics.at('KV302', { start: binding.index, length: binding.length }, binding.path),
        ];
      }

      return result.nullableTraversal
        ? [kv227Diagnostic(diagnostics, binding, result.nullableTraversal)]
        : [];
    });

  const stateDiagnostics = bindingAttributes
    .filter((binding) => binding.query === 'state')
    .flatMap((binding) => {
      const result = validateStateBindingPath(binding.path, model);
      if (result.exists) return [];

      return [
        diagnostics.at('KV302', { start: binding.index, length: binding.length }, binding.path),
      ];
    });

  const listDiagnostics = queryShapes
    ? listStamps.flatMap((stamp) => {
        const binding = listBindings.find((candidate) => candidate.path === stamp.list);
        const result = validateListStampInQueryShapes(stamp, queryShapes);
        if (!result.exists) {
          return [
            diagnostics.at('KV302', { start: binding?.index, length: binding?.length }, stamp.list),
          ];
        }

        return result.nullableTraversal && binding
          ? [kv227Diagnostic(diagnostics, binding, result.nullableTraversal)]
          : [];
      })
    : [];

  const itemDiagnostics = queryShapes
    ? nullableItemBindingDiagnostics(diagnostics, model, bindingAttributes, listStamps, queryShapes)
    : [];

  return bindingDiagnostics.concat(stateDiagnostics, listDiagnostics, itemDiagnostics);
}

export function validateStampExpressionDrift(
  diagnostics: DiagnosticFactory,
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
      const code = stamp.binding === stamp.expression ? 'KV223' : 'KV222';

      return diagnostics.at(
        code,
        { start: stamp.index, length: stamp.length },
        `data-bind="${stamp.binding}" wraps {${stamp.expression}}`,
      );
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

function validateStateBindingPath(path: string, model: ComponentModuleModel): PathShapeValidation {
  const [root, firstSegment] = parseBindingPath(path);
  if (root?.name !== 'state') return { exists: true };

  const stateObject = componentStateReturnObjectModel(model);
  const allowedRoots = new Set([
    ...(stateObject?.entries.map((entry) => entry.key) ?? []),
    ...exportedStateDeriveNames(model),
  ]);
  if (firstSegment === undefined) return { exists: allowedRoots.size > 0 };

  return { exists: allowedRoots.has(firstSegment.name) };
}

function exportedStateDeriveNames(model: ComponentModuleModel): string[] {
  return callExpressions(model)
    .filter((call) => call.name === 'derive' && call.exportedConstName)
    .filter((call) => call.argumentStringLiteralArrayValues[0]?.[0] === 'state')
    .map((call) => call.exportedConstName)
    .filter((name): name is string => name !== undefined);
}

function nullableItemBindingDiagnostics(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  bindingAttributes: readonly DataBindAttribute[],
  listStamps: readonly QueryTemplateStampFact[],
  queryShapes: Record<string, QueryShape>,
): CompilerDiagnostic[] {
  const elements = jsxElements(model);
  const found: CompilerDiagnostic[] = [];

  for (const stamp of listStamps) {
    const itemShape = listItemShapeAtBindingPath(stamp.list, queryShapes);
    if (itemShape === undefined) continue;

    const containers = elements.filter(
      (element) =>
        jsxStaticAttributeValue(element, 'data-bind-list') === stamp.list &&
        jsxStaticAttributeValue(element, 'kovo-key') === stamp.key,
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
          found.push(kv227Diagnostic(diagnostics, binding, result.nullableTraversal));
        }
      }
    }
  }

  return dedupeBy(found, (diagnostic) =>
    [diagnostic.code, diagnostic.fileName, diagnostic.start?.line, diagnostic.start?.column].join(
      ':',
    ),
  );
}

function kv227Diagnostic(
  diagnostics: DiagnosticFactory,
  binding: DataBindAttribute,
  traversal: { segment: string },
): CompilerDiagnostic {
  return {
    ...diagnostics.at(
      'KV227',
      { start: binding.index, length: binding.length },
      `${binding.path} (segment: ${traversal.segment})`,
    ),
    help: diagnosticDefinitions.KV227.help,
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
