// Coverage push-loop support: expression-path collection, the
// `statusCoveredPaths` / `planCoveredPaths` precedence checks, and dedupe keys.
// Extracted verbatim from `analyze/query-updates.ts` for the FN10 decomposition.
// SPEC.md §5.x query-update facts. Behavior-neutral: emitted bytes unchanged.
import {
  queryNameFromPath,
  queryPathUsesKnownQuery,
} from './query-shapes.js';
import { isStatePath } from './query-internal.js';
import {
  callExpressions,
  jsxElements,
  jsxExpressions,
  type ComponentModuleModel,
  type JsxElementModel,
} from '../scan/parse.js';
import type { QueryUpdateCoverageFact } from '../types.js';

export interface QueryPathExpressionFact {
  end: number;
  path: string;
  start: number;
}

export function renderOnceQueryPaths(
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

export function renderOnceStatePaths(model: ComponentModuleModel): string[] {
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

export function jsxQueryExpressionPaths(
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

export function jsxStateExpressionPaths(model: ComponentModuleModel): QueryPathExpressionFact[] {
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

export function queryExpressionCoveredByDataBind(
  expression: { end: number; start: number },
  model: ComponentModuleModel,
): boolean {
  if (queryAttributeExpressionCoveredByDataBind(expression, model)) return true;

  const element = innermostContainingElement(expression, model);
  const binding = element?.attributes.find(
    (attribute) => attribute.name === 'data-bind' && isQueryBindingPath(attribute.value),
  );
  return binding !== undefined;
}

function queryAttributeExpressionCoveredByDataBind(
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
        isQueryBindingPath(attribute.value),
    );
  }

  return false;
}

export function stateExpressionCoveredByDataBind(
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

export function updateCoverageKey(fact: QueryUpdateCoverageFact): string {
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

function isQueryBindingPath(path: string | undefined): boolean {
  const query = path ? queryNameFromPath(path) : null;
  return query !== null && query !== 'state';
}
