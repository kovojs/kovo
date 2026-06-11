import { diagnosticDefinitions } from '@jiso/core';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import {
  callExpressions,
  componentOptionSource,
  jsxElements,
  jsxExpressions,
  propertyAccessPaths,
  type ComponentModuleModel,
  type JsxElementModel,
} from '../scan/parse.js';
import type {
  CompileComponentOptions,
  QueryDeriveFact,
  QueryShape,
  QueryShapeFact,
  QueryShapeWrapper,
  QueryStampFact,
  QueryTemplateStampFact,
  QueryUpdateCoverageFact,
  QueryUpdatePlanFact,
} from '../index.js';

interface DataBindAttribute {
  index: number;
  length: number;
  name: string;
  path: string;
}

interface QueryPathExpressionFact {
  end: number;
  path: string;
  start: number;
}

interface TemplateBody {
  offset: number;
  source: string;
}

const updateCoverageSpans = new WeakMap<
  QueryUpdateCoverageFact,
  { length: number; start: number }
>();

export function validateDataBindings(
  source: string,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const queryShapes = componentQueryShapes(options);
  if (!queryShapes) return [];

  const listStamps = dataBindListStamps(source, model);
  const listBindings = dataBindListAttributes(model);

  return dataBindAttributes(model)
    .filter((binding) => !binding.path.startsWith('.'))
    .filter((binding) => !pathExistsInQueryShapes(binding.path, queryShapes))
    .map((binding) => ({
      ...diagnosticFor(options.fileName, 'FW302', source, binding.index, binding.length),
      message: `${diagnosticDefinitions.FW302.message} ${binding.path}`,
    }))
    .concat(
      listStamps
        .filter((stamp) => !listStampExistsInQueryShapes(stamp, queryShapes))
        .map((stamp) => {
          const binding = listBindings.find((candidate) => candidate.path === stamp.list);
          return {
            ...diagnosticFor(options.fileName, 'FW302', source, binding?.index, binding?.length),
            message: `${diagnosticDefinitions.FW302.message} ${stamp.list}`,
          };
        }),
    );
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

export function collectQueryUpdatePlans(
  source: string,
  model: ComponentModuleModel,
  componentName: string,
): QueryUpdatePlanFact[] {
  const pathsByQuery = new Map<string, Set<string>>();
  const derivesByQuery = new Map<string, QueryDeriveFact[]>();
  const stampsByQuery = new Map<string, QueryStampFact[]>();
  const listStampsByQuery = new Map<string, QueryTemplateStampFact[]>();

  for (const { path } of dataBindAttributes(model)) {
    if (path.startsWith('.')) continue;
    const [query] = path.split('.');
    if (!query) continue;

    const paths = pathsByQuery.get(query) ?? new Set<string>();
    paths.add(path);
    pathsByQuery.set(query, paths);
  }

  for (const stamp of dataBindListStamps(source, model)) {
    const [query] = stamp.list.split('.');
    if (!query) continue;

    const paths = pathsByQuery.get(query) ?? new Set<string>();
    paths.add(stamp.list);
    pathsByQuery.set(query, paths);
    listStampsByQuery.set(query, [...(listStampsByQuery.get(query) ?? []), stamp]);
  }

  const deriveStamps = dataDeriveStamps(model, exportedDerives(source));

  for (const derive of deriveStamps.derives) {
    const derives = derivesByQuery.get(derive.input) ?? [];
    derives.push(derive);
    derivesByQuery.set(derive.input, derives);
  }

  for (const stamp of deriveStamps.stamps) {
    const stamps = stampsByQuery.get(stamp.derive.input) ?? [];
    stamps.push(stamp);
    stampsByQuery.set(stamp.derive.input, stamps);
  }

  const queries = new Set([
    ...pathsByQuery.keys(),
    ...listStampsByQuery.keys(),
    ...derivesByQuery.keys(),
    ...stampsByQuery.keys(),
  ]);

  return [...queries]
    .sort((left, right) => left.localeCompare(right))
    .map((query) => ({
      componentName,
      ...(derivesByQuery.has(query)
        ? {
            derives: [...(derivesByQuery.get(query) ?? [])].sort((left, right) =>
              left.name.localeCompare(right.name),
            ),
          }
        : {}),
      paths: [...(pathsByQuery.get(query) ?? [])].sort(),
      query,
      ...(stampsByQuery.has(query)
        ? {
            stamps: [...(stampsByQuery.get(query) ?? [])].sort((left, right) =>
              left.attr.localeCompare(right.attr),
            ),
          }
        : {}),
      ...(listStampsByQuery.has(query)
        ? {
            templateStamps: [...(listStampsByQuery.get(query) ?? [])].sort((left, right) =>
              left.list.localeCompare(right.list),
            ),
          }
        : {}),
    }));
}

function exportedDerives(source: string): Map<string, Omit<QueryDeriveFact, 'selector'>> {
  const derives = new Map<string, Omit<QueryDeriveFact, 'selector'>>();
  const pattern =
    /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*derive\s*\(\s*\[\s*(['"])([A-Za-z_$][\w$]*)\2\s*\]\s*,\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*([^;]+?)\s*\)\s*;/g;

  for (const match of source.matchAll(pattern)) {
    const [, exportName, , input, param, expression] = match;
    if (!exportName || !input || !param || !expression) continue;

    derives.set(exportName, {
      exportName,
      expression: expression.trim(),
      input,
      name: exportName,
      param,
    });
  }

  return derives;
}

function dataDeriveStamps(
  model: ComponentModuleModel,
  derives: Map<string, Omit<QueryDeriveFact, 'selector'>>,
): { derives: QueryDeriveFact[]; stamps: QueryStampFact[] } {
  const deriveFacts: QueryDeriveFact[] = [];
  const stampFacts: QueryStampFact[] = [];

  for (const element of jsxElements(model)) {
    const deriveAttribute = element.attributes.find(
      (attribute) => attribute.name === 'data-derive' && attribute.value,
    );
    if (!deriveAttribute?.value) continue;

    const attr = element.attributes.find(
      (attribute) => attribute.name === 'data-derive-attr' && attribute.value,
    )?.value;

    const [input, name] = deriveAttribute.value.split('.');
    if (!input || !name) continue;

    const derive = derives.get(name);
    if (!derive || derive.input !== input) continue;

    const deriveFact = {
      ...derive,
      selector: `[data-derive="${input}.${name}"]`,
    };

    if (attr) {
      stampFacts.push({
        attr,
        derive: deriveFact,
        selector: deriveFact.selector,
      });
    } else {
      deriveFacts.push(deriveFact);
    }
  }

  return {
    derives: deriveFacts,
    stamps: stampFacts,
  };
}

export function collectQueryUpdateCoverage(
  source: string,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
  componentName: string,
): QueryUpdateCoverageFact[] {
  const facts: QueryUpdateCoverageFact[] = [];
  const coveredPaths = new Set<string>();
  const knownQueries = knownQueryNames(model, options);

  for (const binding of dataBindAttributes(model).filter((item) => !item.path.startsWith('.'))) {
    const path = binding.path;
    const query = queryNameFromPath(path);
    if (!query) continue;

    facts.push({
      componentName,
      detail: binding.name,
      position: binding.name === 'data-bind' ? 'binding' : 'attribute',
      query: path,
      status: 'plan',
    });
    coveredPaths.add(path);
  }

  for (const stamp of dataBindListStamps(source, model)) {
    facts.push({
      componentName,
      detail: 'data-bind-list',
      position: 'template',
      query: stamp.list,
      status: 'plan',
    });
    coveredPaths.add(stamp.list);
  }

  for (const path of renderOnceQueryPaths(model, knownQueries)) {
    facts.push({
      componentName,
      detail: 'declared renderOnce',
      position: 'expression',
      query: path,
      status: 'renderOnce',
    });
    coveredPaths.add(path);
  }

  for (const expression of jsxQueryExpressionPaths(model, knownQueries)) {
    const path = expression.path;
    if (coveredPaths.has(path)) continue;

    const fact = withUpdateCoverageSpan(
      {
        componentName,
        detail: 'query expression has no data-bind, renderOnce, fragment, or isomorphic status',
        position: 'expression',
        query: path,
        status: 'UNHANDLED',
      },
      expression.start,
      expression.end - expression.start,
    );
    facts.push(fact);
    coveredPaths.add(path);
  }

  return dedupeUpdateCoverage(facts);
}

export function queryUpdateCoverageSpan(
  fact: QueryUpdateCoverageFact,
): { length: number; start: number } | undefined {
  return updateCoverageSpans.get(fact);
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
  const match = /^\s*\{\s*(?<path>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*\}\s*$/.exec(source);
  return match?.groups?.path ?? null;
}

function withUpdateCoverageSpan(
  fact: QueryUpdateCoverageFact,
  start: number,
  length: number,
): QueryUpdateCoverageFact {
  updateCoverageSpans.set(fact, { length, start });
  return fact;
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
  return topLevelObjectKeys(componentOptionSource(model, 'queries') ?? '{}');
}

function queryNameFromPath(path: string): string | null {
  return path.split('.', 1)[0] ?? null;
}

function renderOnceQueryPaths(
  model: ComponentModuleModel,
  knownQueries: ReadonlySet<string>,
): string[] {
  const paths: string[] = [];

  for (const call of callExpressions(model).filter((item) => item.name === 'renderOnce')) {
    paths.push(...queryPathsInExpression(call.arguments.join(', '), knownQueries));
  }

  return [...new Set(paths)];
}

function jsxQueryExpressionPaths(
  model: ComponentModuleModel,
  knownQueries: ReadonlySet<string>,
): QueryPathExpressionFact[] {
  return jsxExpressions(model)
    .map((expression) => {
      const path = soleQueryPathExpression(expression.expression);
      return path === null
        ? null
        : {
            end: expression.end,
            path,
            start: expression.start,
          };
    })
    .filter((expression): expression is QueryPathExpressionFact => expression !== null)
    .filter((expression) => queryPathUsesKnownQuery(expression.path, knownQueries));
}

function soleQueryPathExpression(expression: string): string | null {
  return (
    /^(?<path>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)$/.exec(expression)?.groups?.path ?? null
  );
}

function queryPathsInExpression(expression: string, knownQueries: ReadonlySet<string>): string[] {
  return propertyAccessPaths('expression.tsx', expression).filter((path) =>
    queryPathUsesKnownQuery(path, knownQueries),
  );
}

function queryPathUsesKnownQuery(path: string, knownQueries: ReadonlySet<string>): boolean {
  const query = queryNameFromPath(path);
  return query !== null && knownQueries.has(query);
}

function dedupeUpdateCoverage(
  facts: readonly QueryUpdateCoverageFact[],
): QueryUpdateCoverageFact[] {
  return dedupeBy(facts, (fact) =>
    [fact.componentName, fact.query, fact.position, fact.status, fact.detail ?? ''].join('\0'),
  );
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

function listStampExistsInQueryShapes(
  stamp: QueryTemplateStampFact,
  queryShapes: Record<string, QueryShape>,
): boolean {
  const [queryName, ...segments] = stamp.list.split('.');
  if (!queryName || segments.length === 0) return false;

  const listShape = queryShapes[queryName];
  if (!listShape) return false;

  const shapeAtList = queryShapeAtPath(listShape, segments);
  if (!isArrayShape(shapeAtList)) return false;

  const itemShape = shapeAtList[0];
  if (itemShape === undefined) return false;
  if (!pathExistsInShape(itemShape, [stamp.key])) return false;

  return stamp.itemBindings.every((path) => pathExistsInShape(itemShape, path.slice(1).split('.')));
}

function queryShapeAtPath(shape: QueryShape, segments: readonly string[]): QueryShape {
  const current = unwrapQueryShape(shape);
  if (segments.length === 0) return current;
  if (isArrayShape(current)) return queryShapeAtPath(current[0] ?? 'object', segments);
  if (!isQueryShapeObject(current)) return 'object';

  const [head, ...tail] = segments;
  if (!head) return current;
  return queryShapeAtPath(current[head] ?? 'object', tail);
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

function pathExistsInQueryShapes(path: string, queryShapes: Record<string, QueryShape>): boolean {
  const [queryName, ...segments] = path.split('.');
  if (!queryName) return false;

  const shape = queryShapes[queryName];
  if (!shape || segments.length === 0) return Boolean(shape);

  return pathExistsInShape(shape, segments);
}

function pathExistsInShape(shape: QueryShape, segments: readonly string[]): boolean {
  const current = unwrapQueryShape(shape);
  if (segments.length === 0) return true;

  if (isArrayShape(current)) {
    const itemShape = current[0];
    return itemShape !== undefined && pathExistsInShape(itemShape, segments);
  }

  if (!isQueryShapeObject(current)) return false;

  const [head, ...tail] = segments;
  if (!head || !(head in current)) return false;

  return pathExistsInShape(current[head] ?? 'object', tail);
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

function topLevelObjectKeys(objectSource: string): string[] {
  const keys: string[] = [];
  let index = 1;

  while (index < objectSource.length - 1) {
    index = skipWhitespaceAndComments(objectSource, index);
    if (objectSource[index] === ',') {
      index += 1;
      continue;
    }

    const key = readObjectKey(objectSource, index);
    if (!key) {
      index = skipObjectValue(objectSource, index);
      continue;
    }

    const afterKey = skipWhitespaceAndComments(objectSource, key.end);
    if (objectSource[afterKey] === ':') {
      keys.push(key.name);
      index = skipObjectValue(objectSource, afterKey + 1);
      continue;
    }

    keys.push(key.name);
    index = skipObjectValue(objectSource, afterKey);
  }

  return keys;
}

function readObjectKey(source: string, start: number): { name: string; end: number } | null {
  const char = source[start];
  if (char === '"' || char === "'") {
    const end = findStringEnd(source, start, char);
    if (end === -1) return null;

    return {
      end: end + 1,
      name: source.slice(start + 1, end),
    };
  }

  const identifier = /^[A-Za-z_$][\w$]*/.exec(source.slice(start));
  if (!identifier?.[0]) return null;

  return {
    end: start + identifier[0].length,
    name: identifier[0],
  };
}

function skipObjectValue(source: string, start: number): number {
  let index = start;
  let curlyDepth = 0;
  let squareDepth = 0;
  let parenDepth = 0;

  while (index < source.length - 1) {
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      const end = findStringEnd(source, index, char);
      index = end === -1 ? source.length - 1 : end + 1;
      continue;
    }

    if (char === '/' && source[index + 1] === '/') {
      const nextLine = source.indexOf('\n', index + 2);
      index = nextLine === -1 ? source.length - 1 : nextLine + 1;
      continue;
    }

    if (char === '/' && source[index + 1] === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      index = commentEnd === -1 ? source.length - 1 : commentEnd + 2;
      continue;
    }

    if (char === '{') curlyDepth += 1;
    if (char === '}') {
      if (curlyDepth === 0 && squareDepth === 0 && parenDepth === 0) return index;
      curlyDepth -= 1;
    }

    if (char === '[') squareDepth += 1;
    if (char === ']') squareDepth -= 1;
    if (char === '(') parenDepth += 1;
    if (char === ')') parenDepth -= 1;

    if (char === ',' && curlyDepth === 0 && squareDepth === 0 && parenDepth === 0) {
      return index + 1;
    }

    index += 1;
  }

  return index;
}

function skipWhitespaceAndComments(source: string, start: number): number {
  let index = start;

  while (index < source.length) {
    if (/\s/.test(source[index] ?? '')) {
      index += 1;
      continue;
    }

    if (source[index] === '/' && source[index + 1] === '/') {
      const nextLine = source.indexOf('\n', index + 2);
      index = nextLine === -1 ? source.length : nextLine + 1;
      continue;
    }

    if (source[index] === '/' && source[index + 1] === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 2;
      continue;
    }

    return index;
  }

  return index;
}

function findStringEnd(source: string, start: number, quote: string): number {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
      continue;
    }

    if (source[index] === quote) return index;
  }

  return -1;
}

function dedupeBy<Value>(values: readonly Value[], keyFor: (value: Value) => string): Value[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = keyFor(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
