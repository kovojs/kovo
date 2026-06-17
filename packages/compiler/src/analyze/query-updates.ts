import { dedupeBy } from '../shared.js';
import {
  knownQueryNames,
  isRelativeBindingPath,
  parseBindingPath,
  queryNameFromPath,
  queryPathUsesKnownQuery,
  relativeBindingPath,
} from './query-shapes.js';
import {
  callExpressions,
  componentHasInferredServerRefreshTarget,
  componentOptionStaticValue,
  jsxElementChildBody,
  jsxElements,
  jsxExpressions,
  type ComponentModuleModel,
  type JsxElementChildBody,
  type JsxElementModel,
} from '../scan/parse.js';
import {
  outputContextForAttribute,
  type GeneratedOutputWriteFact,
} from '../output-context-facts.js';
import type {
  BindingPathSegmentFact,
  CompileComponentOptions,
  QueryDeriveFact,
  QueryTemplateStampBindingPlaceholder,
  QueryStampFact,
  QueryTemplateStampFact,
  QueryUpdateCoverageFact,
  QueryUpdatePlanFact,
} from '../types.js';

interface DataBindAttribute {
  name: string;
  path: string;
  query: string | null;
  relativeReadPath: string | null;
}

interface QueryPathExpressionFact {
  end: number;
  path: string;
  start: number;
}

export function collectQueryUpdatePlans(
  model: ComponentModuleModel,
  componentName: string,
): QueryUpdatePlanFact[] {
  const pathsByQuery = new Map<string, Set<string>>();
  const outputContextsByQuery = new Map<string, GeneratedOutputWriteFact[]>();
  const derivesByQuery = new Map<string, QueryDeriveFact[]>();
  const stampsByQuery = new Map<string, QueryStampFact[]>();
  const listStampsByQuery = new Map<string, QueryTemplateStampFact[]>();

  for (const binding of dataBindAttributes(model)) {
    const { path, query } = binding;
    if (!query || query === 'state') continue;

    const paths = pathsByQuery.get(query) ?? new Set<string>();
    paths.add(path);
    pathsByQuery.set(query, paths);
    pushOutputContext(outputContextsByQuery, query, dataBindOutputContextFact(binding));
  }

  for (const stamp of collectDataBindListStamps(model)) {
    const query = queryNameFromPath(stamp.list);
    if (!query || query === 'state') continue;

    const paths = pathsByQuery.get(query) ?? new Set<string>();
    paths.add(stamp.list);
    pathsByQuery.set(query, paths);
    listStampsByQuery.set(query, [...(listStampsByQuery.get(query) ?? []), stamp]);
    pushOutputContext(outputContextsByQuery, query, stamp.outputContext);
    for (const placeholder of stamp.itemBindingPlaceholders ?? []) {
      pushOutputContext(outputContextsByQuery, query, placeholder.outputContext);
    }
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
    pushOutputContext(outputContextsByQuery, stamp.derive.input, stamp.outputContext);
  }

  const queries = new Set([
    ...pathsByQuery.keys(),
    ...listStampsByQuery.keys(),
    ...derivesByQuery.keys(),
    ...stampsByQuery.keys(),
  ]);

  return [...queries]
    .sort((left, right) => left.localeCompare(right))
    .map((query) => {
      const plan: QueryUpdatePlanFact = {
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
      };
      return outputContextsByQuery.has(query)
        ? withOutputContexts(plan, outputContextsByQuery.get(query) ?? [])
        : plan;
    });
}

export function collectQueryUpdateCoverage(
  model: ComponentModuleModel,
  options: CompileComponentOptions,
  componentName: string,
): QueryUpdateCoverageFact[] {
  const facts: QueryUpdateCoverageFact[] = [];
  const coveredPaths = new Set<string>();
  const knownQueries = knownQueryNames(model, options);

  for (const binding of dataBindAttributes(model).filter((item) => item.query !== null)) {
    const path = binding.path;
    const query = binding.query;
    if (!query) continue;

    facts.push({
      componentName,
      detail: binding.name,
      position: binding.name === 'data-bind' ? 'binding' : 'attribute',
      query: path,
      ...(query === 'state' ? { source: 'state' as const } : {}),
      status: 'plan',
    });
    coveredPaths.add(coveragePathKey(query === 'state' ? 'state' : 'query', path));
  }

  for (const stamp of collectDataBindListStamps(model)) {
    if (queryNameFromPath(stamp.list) === 'state') continue;

    facts.push({
      componentName,
      detail: 'data-bind-list',
      position: 'template',
      query: stamp.list,
      status: 'plan',
    });
    coveredPaths.add(coveragePathKey('query', stamp.list));
  }

  for (const path of renderOnceQueryPaths(model, knownQueries)) {
    facts.push({
      componentName,
      detail: 'declared renderOnce',
      position: 'expression',
      query: path,
      status: 'renderOnce',
    });
    coveredPaths.add(coveragePathKey('query', path));
  }

  for (const path of renderOnceStatePaths(model)) {
    facts.push({
      componentName,
      detail: 'declared renderOnce',
      position: 'expression',
      query: path,
      source: 'state',
      status: 'renderOnce',
    });
    coveredPaths.add(coveragePathKey('state', path));
  }

  if (componentOptionStaticValue(model, 'isomorphic') === true) {
    for (const expression of jsxQueryExpressionPaths(model, knownQueries)) {
      const path = expression.path;
      if (coveredPaths.has(coveragePathKey('query', path))) continue;

      facts.push({
        componentName,
        detail: 'declared isomorphic island',
        position: 'expression',
        query: path,
        status: 'isomorphic',
      });
      coveredPaths.add(coveragePathKey('query', path));
    }

    for (const expression of jsxStateExpressionPaths(model)) {
      const path = expression.path;
      if (coveredPaths.has(coveragePathKey('state', path))) continue;

      facts.push({
        componentName,
        detail: 'declared isomorphic island',
        position: 'expression',
        query: path,
        source: 'state',
        status: 'isomorphic',
      });
      coveredPaths.add(coveragePathKey('state', path));
    }
  }

  if (componentHasInferredServerRefreshTarget(model)) {
    for (const expression of jsxQueryExpressionPaths(model, knownQueries)) {
      const path = expression.path;
      if (coveredPaths.has(coveragePathKey('query', path))) continue;

      facts.push({
        componentName,
        detail: 'inferred query-backed server refresh target',
        position: 'expression',
        query: path,
        status: 'fragment',
      });
      coveredPaths.add(coveragePathKey('query', path));
    }
  }

  for (const expression of jsxQueryExpressionPaths(model, knownQueries)) {
    const path = expression.path;
    if (coveredPaths.has(coveragePathKey('query', path))) continue;

    facts.push({
      componentName,
      detail: 'query expression has no data-bind, renderOnce, fragment, or isomorphic status',
      position: 'expression',
      query: path,
      sourceSpan: { length: expression.end - expression.start, start: expression.start },
      status: 'UNHANDLED',
    });
  }

  for (const expression of jsxStateExpressionPaths(model)) {
    const path = expression.path;
    if (coveredPaths.has(coveragePathKey('state', path))) continue;
    if (stateExpressionCoveredByDataBind(expression, model)) continue;

    facts.push({
      componentName,
      detail: 'state expression has no data-bind, renderOnce, or isomorphic status',
      position: 'expression',
      query: path,
      source: 'state',
      sourceSpan: { length: expression.end - expression.start, start: expression.start },
      status: 'UNHANDLED',
    });
  }

  return dedupeBy(facts, updateCoverageKey);
}

function exportedDerives(
  model: ComponentModuleModel,
): Map<string, Omit<QueryDeriveFact, 'selector'>> {
  const derives = new Map<string, Omit<QueryDeriveFact, 'selector'>>();

  for (const call of callExpressions(model)) {
    if (call.name !== 'derive' || !call.exportedConstName) continue;

    const input = deriveInputName(call.argumentStringLiteralArrayValues[0]);
    const derive = call.argumentArrowFunctionParts[1];
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

function deriveInputName(values: readonly string[] | null | undefined): string | null {
  const [input] = values ?? [];
  return values?.length === 1 && input ? input : null;
}

function dataDeriveStamps(
  model: ComponentModuleModel,
  derives: Map<string, Omit<QueryDeriveFact, 'selector'>>,
): { derives: QueryDeriveFact[]; stamps: QueryStampFact[] } {
  const deriveFacts: QueryDeriveFact[] = [];
  const stampFacts: QueryStampFact[] = [];

  for (const element of jsxElements(model)) {
    for (const attribute of element.attributes.filter(
      (item) => item.name.startsWith('data-bind:') && item.value,
    )) {
      if (!attribute.value) continue;

      const [inputSegment, nameSegment, ...extraSegments] = parseBindingPath(attribute.value);
      if (!inputSegment || !nameSegment || extraSegments.length > 0) continue;

      const derive = derives.get(nameSegment.name);
      if (!derive || derive.input !== inputSegment.name || derive.input === 'state') continue;

      const attr = attribute.name.slice('data-bind:'.length);
      stampFacts.push(
        withOutputContext(
          {
            attr,
            derive: {
              ...derive,
              selector: `[${attribute.name}="${attribute.value}"]`,
            },
            selector: `[${attribute.name}="${attribute.value}"]`,
          },
          {
            context: outputContextForAttribute(attr),
            expression: derive.expression,
            sink: attr,
            source: 'client-query',
            writer: 'query attribute binding',
          },
        ),
      );
    }

    const deriveAttribute = element.attributes.find(
      (attribute) => attribute.name === 'data-derive' && attribute.value,
    );
    if (!deriveAttribute?.value) continue;

    const attr = element.attributes.find(
      (attribute) => attribute.name === 'data-derive-attr' && attribute.value,
    )?.value;

    const [inputSegment, nameSegment, ...extraSegments] = parseBindingPath(deriveAttribute.value);
    if (!inputSegment || !nameSegment || extraSegments.length > 0) continue;
    const input = inputSegment.name;
    const name = nameSegment.name;

    const derive = derives.get(name);
    if (!derive || derive.input !== input) continue;

    const deriveFact = {
      ...derive,
      selector: `[data-derive="${input}.${name}"]`,
    };

    if (attr) {
      stampFacts.push(
        withOutputContext(
          {
            attr,
            derive: deriveFact,
            selector: deriveFact.selector,
          },
          {
            context: outputContextForAttribute(attr),
            expression: derive.expression,
            sink: attr,
            source: 'client-query',
            writer: 'query attribute stamp',
          },
        ),
      );
    } else {
      deriveFacts.push(deriveFact);
    }
  }

  return {
    derives: deriveFacts,
    stamps: stampFacts,
  };
}

function renderOnceQueryPaths(
  model: ComponentModuleModel,
  knownQueries: ReadonlySet<string>,
): string[] {
  const paths: string[] = [];

  for (const call of callExpressions(model).filter((item) => item.name === 'renderOnce')) {
    paths.push(
      ...call.argumentPropertyAccesses
        .flat()
        .map((access) => access.path)
        .filter((path) => queryPathUsesKnownQuery(path, knownQueries)),
    );
  }

  return [...new Set(paths)];
}

function renderOnceStatePaths(model: ComponentModuleModel): string[] {
  const paths: string[] = [];

  for (const call of callExpressions(model).filter((item) => item.name === 'renderOnce')) {
    paths.push(
      ...call.argumentPropertyAccesses
        .flat()
        .map((access) => access.path)
        .filter(isStatePath),
    );
  }

  return [...new Set(paths)];
}

function jsxQueryExpressionPaths(
  model: ComponentModuleModel,
  knownQueries: ReadonlySet<string>,
): QueryPathExpressionFact[] {
  return jsxExpressions(model)
    .filter((expression) => !isJsxEventAttributeExpression(expression, model))
    .flatMap((expression) => {
      const queryPaths = [...new Set(expression.propertyAccesses.map((path) => path.path))].filter(
        (path) => queryPathUsesKnownQuery(path, knownQueries),
      );
      return queryPaths.map((path) => ({
        end: expression.end,
        path,
        start: expression.start,
      }));
    });
}

function jsxStateExpressionPaths(model: ComponentModuleModel): QueryPathExpressionFact[] {
  return jsxExpressions(model)
    .filter((expression) => !isJsxEventAttributeExpression(expression, model))
    .flatMap((expression) => {
      const statePaths = [...new Set(expression.propertyAccesses.map((path) => path.path))].filter(
        isStatePath,
      );
      return statePaths.map((path) => ({
        end: expression.end,
        path,
        start: expression.start,
      }));
    });
}

function stateExpressionCoveredByDataBind(
  expression: { end: number; start: number },
  model: ComponentModuleModel,
): boolean {
  if (stateAttributeExpressionCoveredByDataBind(expression, model)) return true;

  const element = innermostContainingElement(expression, model);
  const binding = element?.attributes.find(
    (attribute) => attribute.name === 'data-bind' && attribute.value?.startsWith('state.'),
  );
  return binding !== undefined;
}

function stateAttributeExpressionCoveredByDataBind(
  expression: { end: number; start: number },
  model: ComponentModuleModel,
): boolean {
  for (const element of jsxElements(model)) {
    const sourceAttribute = element.attributes.find(
      (attribute) =>
        attribute.expressionStart !== undefined &&
        attribute.expressionEnd !== undefined &&
        expression.start >= attribute.expressionStart &&
        expression.end <= attribute.expressionEnd,
    );
    if (!sourceAttribute) continue;

    return element.attributes.some(
      (attribute) =>
        attribute.name === `data-bind:${sourceAttribute.name}` &&
        attribute.value?.startsWith('state.'),
    );
  }

  return false;
}

function innermostContainingElement(
  expression: { end: number; start: number },
  model: ComponentModuleModel,
): JsxElementModel | null {
  return (
    jsxElements(model)
      .filter(
        (element) =>
          !element.selfClosing &&
          expression.start >= element.openingEnd &&
          expression.end <= element.closingStart,
      )
      .sort((left, right) => left.end - left.start - (right.end - right.start))[0] ?? null
  );
}

function isJsxEventAttributeExpression(
  expression: { end: number; start: number },
  model: ComponentModuleModel,
): boolean {
  return jsxElements(model).some((element) =>
    element.attributes.some(
      (attribute) =>
        (attribute.domEventName !== undefined || attribute.executionTriggerName !== undefined) &&
        attribute.expressionStart !== undefined &&
        attribute.expressionEnd !== undefined &&
        expression.start >= attribute.expressionStart &&
        expression.end <= attribute.expressionEnd,
    ),
  );
}

function updateCoverageKey(fact: QueryUpdateCoverageFact): string {
  return [
    fact.componentName,
    fact.source ?? 'query',
    fact.query,
    fact.position,
    fact.status,
    fact.detail ?? '',
    fact.sourceSpan?.start ?? '',
    fact.sourceSpan?.length ?? '',
  ].join('\0');
}

function coveragePathKey(source: 'query' | 'state', path: string): string {
  return `${source}\0${path}`;
}

function dataBindAttributes(model: ComponentModuleModel): DataBindAttribute[] {
  return jsxAttributes(model)
    .filter(
      (attribute) =>
        isBindingAttribute(attribute.name) &&
        attribute.value !== undefined &&
        attribute.value !== '',
    )
    .map((attribute) => dataBindAttributeFact(attribute.name, attribute.value ?? ''));
}

function dataBindAttributeFact(name: string, path: string): DataBindAttribute {
  return {
    name,
    path,
    query: isRelativeBindingPath(path) ? null : queryNameFromPath(path),
    relativeReadPath: isRelativeBindingPath(path) ? relativeBindingPath(path) : null,
  };
}

function dataBindOutputContextFact(binding: DataBindAttribute): GeneratedOutputWriteFact {
  if (binding.name === 'data-bind') {
    return {
      context: 'text',
      expression: binding.path,
      sink: 'textContent',
      source: 'client-query',
      writer: 'query text binding',
    };
  }

  const attr = binding.name.slice('data-bind:'.length);
  return {
    context: outputContextForAttribute(attr),
    expression: binding.path,
    sink: attr,
    source: 'client-query',
    writer: 'query attribute binding',
  };
}

function pushOutputContext(
  factsByQuery: Map<string, GeneratedOutputWriteFact[]>,
  query: string,
  fact: GeneratedOutputWriteFact,
): void {
  factsByQuery.set(query, [...(factsByQuery.get(query) ?? []), fact]);
}

export function collectDataBindListStamps(model: ComponentModuleModel): QueryTemplateStampFact[] {
  const elements = jsxElements(model);

  return elements
    .flatMap((element) => {
      const list = jsxStaticAttributeValue(element, 'data-bind-list');
      const key = jsxStaticAttributeValue(element, 'kovo-key');
      if (!list || !key) return [];

      const template = templateStampElement(elements, element);
      const templateBody = template ? jsxElementChildBody(template) : null;
      const itemBindingPlaceholders =
        template && templateBody
          ? templateItemBindingPlaceholders(elements, template, templateBody)
          : [];

      return [
        withOutputContext(
          {
            itemBindingPlaceholders,
            key,
            list,
            listReadPath: queryRelativePath(list),
            listReadSegments: queryRelativeSegments(list),
            selector: `[data-bind-list="${list}"]`,
            template: templateBody?.source ?? '',
          },
          {
            context: 'html-fragment',
            expression: list,
            sink: 'template.innerHTML',
            source: 'template-stamp',
            writer: 'template stamp assembly',
          },
        ),
      ];
    })
    .filter((stamp) => (stamp.itemBindingPlaceholders?.length ?? 0) > 0);
}

function queryRelativePath(path: string): string {
  return bindingPathSegmentsToPath(queryRelativeSegments(path));
}

function queryRelativeSegments(path: string): BindingPathSegmentFact[] {
  return parseBindingPath(path).slice(1);
}

function bindingPathSegmentsToPath(segments: readonly BindingPathSegmentFact[]): string {
  return segments
    .map((segment) => (segment.optional ? `${segment.name}?` : segment.name))
    .join('.');
}

function templateItemBindingPlaceholders(
  elements: readonly JsxElementModel[],
  template: JsxElementModel,
  templateBody: JsxElementChildBody,
): QueryTemplateStampBindingPlaceholder[] {
  return elements
    .filter((candidate) => isWithinElement(candidate, template))
    .flatMap((candidate) =>
      candidate.attributes
        .filter(
          (attribute) =>
            isBindingAttribute(attribute.name) &&
            attribute.value !== undefined &&
            attribute.value !== '' &&
            dataBindAttributeFact(attribute.name, attribute.value).relativeReadPath !== null,
        )
        .map((attribute) => {
          const fact = dataBindAttributeFact(attribute.name, attribute.value ?? '');
          const childBody = jsxElementChildBody(candidate);
          const templateStart = childBody ? childBody.offset - templateBody.offset : 0;
          const templateEnd = templateStart + (childBody?.source.length ?? 0);
          return withOutputContext(
            {
              path: fact.path,
              readPath: fact.relativeReadPath ?? '',
              readSegments: parseBindingPath(fact.relativeReadPath ?? ''),
              templateEnd,
              templateStart,
              value: childBody?.source ?? '',
            },
            {
              context: 'html-fragment',
              expression: fact.path,
              sink: 'template item placeholder',
              source: 'template-stamp',
              writer: 'template stamp interpolation',
            },
          );
        }),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
}

function withOutputContext<Value extends object>(
  value: Value,
  outputContext: GeneratedOutputWriteFact,
): Value & { outputContext: GeneratedOutputWriteFact } {
  Object.defineProperty(value, 'outputContext', { enumerable: false, value: outputContext });
  return value as Value & { outputContext: GeneratedOutputWriteFact };
}

function withOutputContexts<Value extends object>(
  value: Value,
  outputContexts: readonly GeneratedOutputWriteFact[],
): Value & { outputContexts: readonly GeneratedOutputWriteFact[] } {
  Object.defineProperty(value, 'outputContexts', { enumerable: false, value: outputContexts });
  return value as Value & { outputContexts: readonly GeneratedOutputWriteFact[] };
}

function templateStampElement(
  elements: readonly JsxElementModel[],
  container: JsxElementModel,
): JsxElementModel | undefined {
  return elements.find(
    (element) =>
      element.tag === 'template' &&
      isWithinElement(element, container) &&
      hasJsxAttribute(element, 'kovo-stamp'),
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

function isStatePath(path: string): boolean {
  return path.startsWith('state.');
}
