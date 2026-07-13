// Coverage push-loop support: expression-path collection, the
// `statusCoveredPaths` / `planCoveredPaths` precedence checks, and dedupe keys.
// Extracted verbatim from `analyze/query-updates.ts` for the FN10 decomposition.
// SPEC.md §5.x query-update facts. Behavior-neutral: emitted bytes unchanged.
import { queryNameFromPath, queryPathUsesKnownQuery } from './query-shapes.js';
import { isStatePath } from './query-internal.js';
import { reactivePropertyAccessesForJsxExpression } from './reactive-aliases.js';
import {
  compilerArrayAppend,
  compilerCreateSet,
  compilerSetAdd,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerStringStartsWith,
} from '../compiler-security-intrinsics.js';
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
  const seen = compilerCreateSet<string>();

  const calls = compilerSnapshotDenseArray(callExpressions(model), 'Compiler renderOnce calls');
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index]!;
    if (call.name !== 'renderOnce') continue;
    appendCallPropertyPaths(call.argumentPropertyAccesses, paths, seen, (path) =>
      queryPathUsesKnownQuery(path, knownQueries),
    );
  }

  return paths;
}

export function renderOnceStatePaths(model: ComponentModuleModel): string[] {
  const paths: string[] = [];
  const seen = compilerCreateSet<string>();

  const calls = compilerSnapshotDenseArray(callExpressions(model), 'Compiler renderOnce calls');
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index]!;
    if (call.name !== 'renderOnce') continue;
    appendCallPropertyPaths(call.argumentPropertyAccesses, paths, seen, isStatePath);
  }

  return paths;
}

export function jsxQueryExpressionPaths(
  model: ComponentModuleModel,
  knownQueries: ReadonlySet<string>,
): QueryPathExpressionFact[] {
  return jsxExpressionPaths(model, (path) => queryPathUsesKnownQuery(path, knownQueries));
}

export function jsxStateExpressionPaths(model: ComponentModuleModel): QueryPathExpressionFact[] {
  return jsxExpressionPaths(model, isStatePath);
}

export function queryExpressionCoveredByDataBind(
  expression: { end: number; start: number },
  model: ComponentModuleModel,
): boolean {
  if (queryAttributeExpressionCoveredByDataBind(expression, model)) return true;

  const element = innermostContainingElement(expression, model);
  return element === null
    ? false
    : hasAttribute(
        element,
        (attribute) => attribute.name === 'data-bind' && isQueryBindingPath(attribute.value),
      );
}

function queryAttributeExpressionCoveredByDataBind(
  expression: { end: number; start: number },
  model: ComponentModuleModel,
): boolean {
  const elements = compilerSnapshotDenseArray(
    jsxElements(model),
    'Compiler query coverage elements',
  );
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    const sourceAttribute = findAttribute(
      element,
      (attribute) =>
        attribute.expressionStart !== undefined &&
        attribute.expressionEnd !== undefined &&
        expression.start >= attribute.expressionStart &&
        expression.end <= attribute.expressionEnd,
    );
    if (!sourceAttribute) continue;

    return hasAttribute(
      element,
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
  return element === null
    ? false
    : hasAttribute(
        element,
        (attribute) =>
          attribute.name === 'data-bind' &&
          attribute.value !== undefined &&
          compilerStringStartsWith(attribute.value, 'state.'),
      );
}

function stateAttributeExpressionCoveredByDataBind(
  expression: { end: number; start: number },
  model: ComponentModuleModel,
): boolean {
  const elements = compilerSnapshotDenseArray(
    jsxElements(model),
    'Compiler state coverage elements',
  );
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    const sourceAttribute = findAttribute(
      element,
      (attribute) =>
        attribute.expressionStart !== undefined &&
        attribute.expressionEnd !== undefined &&
        expression.start >= attribute.expressionStart &&
        expression.end <= attribute.expressionEnd,
    );
    if (!sourceAttribute) continue;

    return hasAttribute(
      element,
      (attribute) =>
        attribute.name === `data-bind:${sourceAttribute.name}` &&
        attribute.value !== undefined &&
        compilerStringStartsWith(attribute.value, 'state.'),
    );
  }

  return false;
}

function innermostContainingElement(
  expression: { end: number; start: number },
  model: ComponentModuleModel,
): JsxElementModel | null {
  const elements = compilerSnapshotDenseArray(
    jsxElements(model),
    'Compiler containing JSX elements',
  );
  let selected: JsxElementModel | null = null;
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (
      element.selfClosing ||
      expression.start < element.openingEnd ||
      expression.end > element.closingStart
    ) {
      continue;
    }
    if (selected === null || element.end - element.start < selected.end - selected.start) {
      selected = element;
    }
  }
  return selected;
}

function isJsxEventAttributeExpression(
  expression: { end: number; start: number },
  model: ComponentModuleModel,
): boolean {
  const elements = compilerSnapshotDenseArray(
    jsxElements(model),
    'Compiler event-attribute elements',
  );
  for (let index = 0; index < elements.length; index += 1) {
    if (
      hasAttribute(
        elements[index]!,
        (attribute) =>
          (attribute.domEventName !== undefined || attribute.executionTriggerName !== undefined) &&
          attribute.expressionStart !== undefined &&
          attribute.expressionEnd !== undefined &&
          expression.start >= attribute.expressionStart &&
          expression.end <= attribute.expressionEnd,
      )
    ) {
      return true;
    }
  }
  return false;
}

export function updateCoverageKey(fact: QueryUpdateCoverageFact): string {
  return `${fact.componentName}\0${fact.source ?? 'query'}\0${fact.query}\0${fact.position}\0${fact.status}\0${fact.detail ?? ''}\0${fact.sourceSpan?.start ?? ''}\0${fact.sourceSpan?.length ?? ''}`;
}

function isQueryBindingPath(path: string | undefined): boolean {
  const query = path ? queryNameFromPath(path) : null;
  return query !== null && query !== 'state';
}

function appendCallPropertyPaths(
  groups: readonly (readonly { readonly path: string }[])[],
  output: string[],
  seen: Set<string>,
  keep: (path: string) => boolean,
): void {
  const sourceGroups = compilerSnapshotDenseArray(groups, 'Compiler call property-access groups');
  for (let groupIndex = 0; groupIndex < sourceGroups.length; groupIndex += 1) {
    const accesses = compilerSnapshotDenseArray(
      sourceGroups[groupIndex]!,
      'Compiler call property accesses',
    );
    for (let index = 0; index < accesses.length; index += 1) {
      const path = accesses[index]!.path;
      if (!keep(path) || compilerSetHas(seen, path)) continue;
      compilerSetAdd(seen, path);
      compilerArrayAppend(output, path, 'Compiler call property paths');
    }
  }
}

function jsxExpressionPaths(
  model: ComponentModuleModel,
  keep: (path: string) => boolean,
): QueryPathExpressionFact[] {
  const output: QueryPathExpressionFact[] = [];
  const expressions = compilerSnapshotDenseArray(
    jsxExpressions(model),
    'Compiler JSX coverage expressions',
  );
  for (let index = 0; index < expressions.length; index += 1) {
    const expression = expressions[index]!;
    if (isJsxEventAttributeExpression(expression, model)) continue;
    const seen = compilerCreateSet<string>();
    const accesses = compilerSnapshotDenseArray(
      reactivePropertyAccessesForJsxExpression(expression, model),
      'Compiler reactive expression paths',
    );
    for (let accessIndex = 0; accessIndex < accesses.length; accessIndex += 1) {
      const path = accesses[accessIndex]!.path;
      if (!keep(path) || compilerSetHas(seen, path)) continue;
      compilerSetAdd(seen, path);
      compilerArrayAppend(
        output,
        { end: expression.end, path, start: expression.start },
        'Compiler JSX coverage expression paths',
      );
    }
  }
  return output;
}

type JsxAttribute = JsxElementModel['attributes'][number];

function findAttribute(
  element: JsxElementModel,
  predicate: (attribute: JsxAttribute) => boolean,
): JsxAttribute | undefined {
  const attributes = compilerSnapshotDenseArray(
    element.attributes,
    'Compiler coverage JSX attributes',
  );
  for (let index = 0; index < attributes.length; index += 1) {
    if (predicate(attributes[index]!)) return attributes[index]!;
  }
  return undefined;
}

function hasAttribute(
  element: JsxElementModel,
  predicate: (attribute: JsxAttribute) => boolean,
): boolean {
  return findAttribute(element, predicate) !== undefined;
}
