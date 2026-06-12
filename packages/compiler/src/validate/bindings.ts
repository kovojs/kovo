import { diagnosticDefinitions } from '@jiso/core';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import { dedupeBy } from '../shared.js';
import {
  componentOptionObjectKeys,
  jsxElements,
  type ComponentModuleModel,
  type JsxElementModel,
} from '../scan/parse.js';
import type {
  CompileComponentOptions,
  QueryShape,
  QueryShapeFact,
  QueryShapeWrapper,
  QueryTemplateStampFact,
} from '../types.js';

interface DataBindAttribute {
  index: number;
  length: number;
  name: string;
  path: string;
}

interface TemplateBody {
  offset: number;
  source: string;
}

export function validateDataBindings(
  source: string,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const queryShapes = componentQueryShapes(options);
  if (!queryShapes) return [];

  const listStamps = dataBindListStamps(source, model);
  const listBindings = dataBindListAttributes(model);
  const bindingAttributes = dataBindAttributes(model);

  const bindingDiagnostics = bindingAttributes
    .filter((binding) => !binding.path.startsWith('.'))
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

  return bindingExpressionStamps(source, model)
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

export function dataBindListTemplateBodies(
  source: string,
  model: ComponentModuleModel,
): TemplateBody[] {
  const elements = jsxElements(model);

  return elements.flatMap((element) => {
    if (jsxStaticAttributeValue(element, 'data-bind-list') === undefined) return [];

    const template = templateStamp(source, elements, element);
    return template ? [template] : [];
  });
}

function bindingExpressionStamps(
  source: string,
  model: ComponentModuleModel,
): Array<{ binding: string; expression: string; index: number; length: number }> {
  return jsxElements(model).flatMap((element) => {
    const attribute = element.attributes.find((item) => item.name === 'data-bind');
    const binding = attribute?.value;
    if (!attribute || !binding) return [];
    if (element.selfClosing) return [];

    const expression = soleWrappedQueryExpression(
      source.slice(element.openingEnd, element.closingStart),
    );
    return expression
      ? [{ binding, expression, index: attribute.start, length: attribute.end - attribute.start }]
      : [];
  });
}

function soleWrappedQueryExpression(source: string): string | null {
  const match = /^\s*\{\s*(?<path>[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+)\s*\}\s*$/.exec(
    source,
  );
  return match?.groups?.path ?? null;
}

function knownQueryNames(
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): Set<string> {
  return new Set([
    ...componentQueryNames(model),
    ...Object.keys(options.registryFacts?.queries ?? {}),
    ...Object.keys(componentQueryShapes(options) ?? {}),
  ]);
}

function componentQueryNames(model: ComponentModuleModel): string[] {
  return componentOptionObjectKeys(model, 'queries');
}

function queryNameFromPath(path: string): string | null {
  return path.split('.', 1)[0] ?? null;
}

function queryPathUsesKnownQuery(path: string, knownQueries: ReadonlySet<string>): boolean {
  const query = queryNameFromPath(path);
  return query !== null && knownQueries.has(query);
}

function dataBindAttributes(model: ComponentModuleModel): DataBindAttribute[] {
  return jsxAttributes(model)
    .filter(
      (attribute) =>
        isBindingAttribute(attribute.name) &&
        attribute.value !== undefined &&
        attribute.value !== '',
    )
    .map((attribute) => ({
      index: attribute.start,
      length: attribute.end - attribute.start,
      name: attribute.name,
      path: attribute.value ?? '',
    }));
}

function dataBindListAttributes(model: ComponentModuleModel): DataBindAttribute[] {
  return jsxAttributes(model)
    .filter(
      (attribute) =>
        attribute.name === 'data-bind-list' &&
        attribute.value !== undefined &&
        attribute.value !== '',
    )
    .map((attribute) => ({
      index: attribute.start,
      length: attribute.end - attribute.start,
      name: attribute.name,
      path: attribute.value ?? '',
    }));
}

function dataBindListStamps(source: string, model: ComponentModuleModel): QueryTemplateStampFact[] {
  const elements = jsxElements(model);

  return elements
    .flatMap((element) => {
      const list = jsxStaticAttributeValue(element, 'data-bind-list');
      const key = jsxStaticAttributeValue(element, 'fw-key');
      if (!list || !key) return [];

      const template = templateStampContent(source, elements, element);

      return [
        {
          itemBindings: elements
            .filter((candidate) => isWithinElement(candidate, element))
            .flatMap((candidate) => candidate.attributes)
            .filter(
              (attribute) =>
                isBindingAttribute(attribute.name) &&
                attribute.value !== undefined &&
                attribute.value !== '',
            )
            .map((attribute) => attribute.value ?? '')
            .filter((path) => path.startsWith('.'))
            .sort(),
          key,
          list,
          selector: `[data-bind-list="${list}"]`,
          template,
        },
      ];
    })
    .filter((stamp) => stamp.itemBindings.length > 0);
}

function templateStampContent(
  source: string,
  elements: readonly JsxElementModel[],
  container: JsxElementModel,
): string {
  return templateStamp(source, elements, container)?.source ?? '';
}

function templateStamp(
  source: string,
  elements: readonly JsxElementModel[],
  container: JsxElementModel,
): TemplateBody | null {
  const template = elements.find(
    (element) =>
      element.tag === 'template' &&
      isWithinElement(element, container) &&
      hasJsxAttribute(element, 'fw-stamp'),
  );
  if (!template || template.selfClosing) return null;

  const raw = source.slice(template.openingEnd, template.closingStart);
  const leadingWhitespace = /^\s*/.exec(raw)?.[0].length ?? 0;

  return {
    offset: template.openingEnd + leadingWhitespace,
    source: raw.trim(),
  };
}

interface NullableTraversal {
  segment: string;
}

interface PathShapeValidation {
  exists: boolean;
  nullableTraversal?: NullableTraversal;
}

function validateListStampInQueryShapes(
  stamp: QueryTemplateStampFact,
  queryShapes: Record<string, QueryShape>,
): PathShapeValidation {
  const [querySegment, ...segments] = parseBindingPath(stamp.list);
  const queryName = querySegment?.name;
  if (!queryName || segments.length === 0) return { exists: false };

  const listShape = queryShapes[queryName];
  if (!listShape) return { exists: false };

  const shapeAtList = queryShapeAtPath(listShape, segments);
  if (!isArrayShape(shapeAtList)) return { exists: false };

  const itemShape = shapeAtList[0];
  if (itemShape === undefined) return { exists: false };
  if (!validatePathInShape(itemShape, [requiredPathSegment(stamp.key)]).exists) {
    return { exists: false };
  }

  const listValidation = validatePathInShape(listShape, segments);
  if (!listValidation.exists) return { exists: false };
  if (listValidation.nullableTraversal) return listValidation;

  for (const path of stamp.itemBindings) {
    if (!validatePathInShape(itemShape, parseBindingPath(path.slice(1))).exists) {
      return { exists: false };
    }
  }

  return { exists: true };
}

function queryShapeAtPath(shape: QueryShape, segments: readonly BindingPathSegment[]): QueryShape {
  const current = unwrapQueryShape(shape);
  if (segments.length === 0) return current;
  if (isArrayShape(current)) return queryShapeAtPath(current[0] ?? 'object', segments);
  if (!isQueryShapeObject(current)) return 'object';

  const [head, ...tail] = segments;
  if (!head) return current;
  return queryShapeAtPath(current[head.name] ?? 'object', tail);
}

function componentQueryShapes(options: CompileComponentOptions): Record<string, QueryShape> | null {
  return (
    options.queryShapes ??
    (options.queryShapeFacts ? queryShapesFromFacts(options.queryShapeFacts) : null)
  );
}

function queryShapesFromFacts(facts: readonly QueryShapeFact[]): Record<string, QueryShape> {
  return Object.fromEntries(facts.map((fact) => [fact.query, fact.shape]));
}

function validatePathInQueryShapes(
  path: string,
  queryShapes: Record<string, QueryShape>,
): PathShapeValidation {
  const [querySegment, ...segments] = parseBindingPath(path);
  const queryName = querySegment?.name;
  if (!queryName) return { exists: false };

  const shape = queryShapes[queryName];
  if (!shape || segments.length === 0) return { exists: Boolean(shape) };

  return validatePathInShape(shape, segments);
}

function validatePathInShape(
  shape: QueryShape,
  segments: readonly BindingPathSegment[],
): PathShapeValidation {
  const current = unwrapQueryShape(shape);
  if (segments.length === 0) return { exists: true };

  if (isArrayShape(current)) {
    const itemShape = current[0];
    return itemShape === undefined ? { exists: false } : validatePathInShape(itemShape, segments);
  }

  if (!isQueryShapeObject(current)) return { exists: false };

  const [head, ...tail] = segments;
  if (!head || !(head.name in current)) return { exists: false };

  const child = current[head.name] ?? 'object';
  const nullableTraversal = tail.length > 0 && isQueryShapeWrapper(child) && !head.optional;
  if (nullableTraversal) {
    const childValidation = validatePathInShape(child, tail);
    return childValidation.exists
      ? { exists: true, nullableTraversal: { segment: head.name } }
      : { exists: false };
  }

  return validatePathInShape(child, tail);
}

interface BindingPathSegment {
  name: string;
  optional: boolean;
}

function parseBindingPath(path: string): BindingPathSegment[] {
  return path
    .split('.')
    .filter((segment) => segment !== '')
    .map((segment) => ({
      name: segment.endsWith('?') ? segment.slice(0, -1) : segment,
      optional: segment.endsWith('?'),
    }));
}

function requiredPathSegment(name: string): BindingPathSegment {
  return { name, optional: false };
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
    const [querySegment, ...segments] = parseBindingPath(stamp.list);
    const queryName = querySegment?.name;
    const listShape = queryName ? queryShapes[queryName] : undefined;
    if (!listShape) continue;

    const shapeAtList = queryShapeAtPath(listShape, segments);
    if (!isArrayShape(shapeAtList)) continue;

    const itemShape = shapeAtList[0];
    if (itemShape === undefined) continue;

    const containers = elements.filter(
      (element) =>
        jsxStaticAttributeValue(element, 'data-bind-list') === stamp.list &&
        jsxStaticAttributeValue(element, 'fw-key') === stamp.key,
    );

    for (const container of containers) {
      for (const binding of bindingAttributes.filter((candidate) =>
        candidate.path.startsWith('.'),
      )) {
        const element = elements.find((candidate) =>
          candidate.attributes.some(
            (attribute) =>
              attribute.start === binding.index && attribute.end === binding.index + binding.length,
          ),
        );
        if (!element || !isWithinElement(element, container)) continue;

        const result = validatePathInShape(itemShape, parseBindingPath(binding.path.slice(1)));
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
  traversal: NullableTraversal,
): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'FW227', source, binding.index, binding.length),
    help: diagnosticDefinitions.FW227.help,
    message: `${diagnosticDefinitions.FW227.message} ${binding.path} (segment: ${traversal.segment})`,
  };
}

function isArrayShape(shape: QueryShape): shape is readonly QueryShape[] {
  return Array.isArray(shape);
}

function unwrapQueryShape(shape: QueryShape): QueryShape {
  let current = shape;
  while (isQueryShapeWrapper(current)) current = current.shape;
  return current;
}

function isQueryShapeWrapper(shape: QueryShape): shape is QueryShapeWrapper {
  if (typeof shape !== 'object' || shape === null || Array.isArray(shape)) return false;
  const record = shape as Record<string, unknown>;
  return (record.kind === 'nullable' || record.kind === 'optional') && 'shape' in shape;
}

function isQueryShapeObject(shape: QueryShape): shape is { readonly [key: string]: QueryShape } {
  return (
    typeof shape === 'object' &&
    shape !== null &&
    !Array.isArray(shape) &&
    !isQueryShapeWrapper(shape)
  );
}

function jsxAttributes(model: ComponentModuleModel) {
  return jsxElements(model).flatMap((element) => [...element.attributes]);
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

function isBindingAttribute(name: string): boolean {
  return name === 'data-bind' || name.startsWith('data-bind:');
}
