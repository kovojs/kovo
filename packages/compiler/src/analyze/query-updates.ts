import { dedupeBy } from '../shared.js';
import {
  callExpressions,
  componentOptionObjectKeys,
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
  QueryStampFact,
  QueryTemplateStampFact,
  QueryUpdateCoverageFact,
  QueryUpdatePlanFact,
} from '../types.js';

interface DataBindAttribute {
  name: string;
  path: string;
}

interface QueryPathExpressionFact {
  end: number;
  path: string;
  start: number;
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

  const deriveStamps = dataDeriveStamps(model, exportedDerives(model));

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

  if (componentOptionSource(model, 'isomorphic')?.trim() === 'true') {
    for (const expression of jsxQueryExpressionPaths(model, knownQueries)) {
      const path = expression.path;
      if (coveredPaths.has(path)) continue;

      facts.push({
        componentName,
        detail: 'declared isomorphic island',
        position: 'expression',
        query: path,
        status: 'isomorphic',
      });
      coveredPaths.add(path);
    }
  }

  for (const expression of jsxQueryExpressionPaths(model, knownQueries)) {
    const path = expression.path;
    if (coveredPaths.has(path)) continue;

    facts.push({
      componentName,
      detail: 'query expression has no data-bind, renderOnce, fragment, or isomorphic status',
      position: 'expression',
      query: path,
      sourceSpan: { length: expression.end - expression.start, start: expression.start },
      status: 'UNHANDLED',
    });
    coveredPaths.add(path);
  }

  return dedupeBy(facts, updateCoverageKey);
}

function exportedDerives(
  model: ComponentModuleModel,
): Map<string, Omit<QueryDeriveFact, 'selector'>> {
  const derives = new Map<string, Omit<QueryDeriveFact, 'selector'>>();

  for (const call of callExpressions(model)) {
    if (call.name !== 'derive' || !call.exportedConstName) continue;

    const [inputArgument, deriveArgument] = call.arguments;
    const input = deriveInputName(inputArgument);
    const derive = deriveArrowParts(deriveArgument);
    if (!input || !derive) continue;
    const exportName = call.exportedConstName;

    derives.set(exportName, {
      exportName,
      expression: derive.expression,
      input,
      name: exportName,
      param: derive.param,
    });
  }

  return derives;
}

function deriveInputName(argument: string | undefined): string | null {
  const match = /^\[\s*(['"])([A-Za-z_$][\w$]*)\1\s*\]$/.exec(argument?.trim() ?? '');
  return match?.[2] ?? null;
}

function deriveArrowParts(
  argument: string | undefined,
): { expression: string; param: string } | null {
  const match = /^\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*([\s\S]+)$/.exec(argument?.trim() ?? '');
  if (!match?.[1] || !match[2]) return null;

  return { expression: match[2].trim(), param: match[1] };
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

function componentQueryShapes(options: CompileComponentOptions): Record<string, QueryShape> | null {
  return (
    options.queryShapes ??
    (options.queryShapeFacts ? queryShapesFromFacts(options.queryShapeFacts) : null)
  );
}

function queryShapesFromFacts(facts: readonly QueryShapeFact[]): Record<string, QueryShape> {
  return Object.fromEntries(facts.map((fact) => [fact.query, fact.shape]));
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
    /^(?<path>[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+)$/.exec(expression)?.groups?.path ?? null
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

function updateCoverageKey(fact: QueryUpdateCoverageFact): string {
  return [fact.componentName, fact.query, fact.position, fact.status, fact.detail ?? ''].join('\0');
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
  const template = elements.find(
    (element) =>
      element.tag === 'template' &&
      isWithinElement(element, container) &&
      hasJsxAttribute(element, 'fw-stamp'),
  );
  if (!template || template.selfClosing) return '';

  return source.slice(template.openingEnd, template.closingStart).trim();
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
