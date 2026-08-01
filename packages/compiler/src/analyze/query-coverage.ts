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
  jsxAttributeSemanticStringValue,
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

type JsxAttribute = JsxElementModel['attributes'][number];
type JsxExpression = ReturnType<typeof jsxExpressions>[number];

interface QueryCoverageElement {
  attributes: readonly JsxAttribute[];
  element: JsxElementModel;
}

export interface QueryCoverageContext {
  elements: readonly QueryCoverageElement[];
  expressions: readonly JsxExpression[];
}

/**
 * Snapshot the scanner-owned arrays once for the complete coverage pass. SPEC §5.2 keeps the typed
 * scanner model authoritative; amortizing these fail-closed snapshots avoids re-copying every JSX
 * element and attribute for every expression in a large component.
 */
export function createQueryCoverageContext(model: ComponentModuleModel): QueryCoverageContext {
  const sourceElements = compilerSnapshotDenseArray(
    jsxElements(model),
    'Compiler query coverage elements',
  );
  const elements: QueryCoverageElement[] = [];
  for (let index = 0; index < sourceElements.length; index += 1) {
    const element = sourceElements[index]!;
    compilerArrayAppend(
      elements,
      {
        attributes: compilerSnapshotDenseArray(
          element.attributes,
          'Compiler coverage JSX attributes',
        ),
        element,
      },
      'Compiler indexed query coverage elements',
    );
  }
  return {
    elements,
    expressions: compilerSnapshotDenseArray(
      jsxExpressions(model),
      'Compiler JSX coverage expressions',
    ),
  };
}

export function renderOnceQueryPaths(
  model: ComponentModuleModel,
  knownQueries: ReadonlySet<string>,
): string[] {
  return pathNames(
    renderOnceQueryPathFacts(model, knownQueries),
    'Compiler renderOnce query path names',
  );
}

export function renderOnceQueryPathFacts(
  model: ComponentModuleModel,
  knownQueries: ReadonlySet<string>,
): QueryPathExpressionFact[] {
  const paths: QueryPathExpressionFact[] = [];
  const seen = compilerCreateSet<string>();
  const calls = compilerSnapshotDenseArray(callExpressions(model), 'Compiler renderOnce calls');
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index]!;
    if (call.name !== 'renderOnce') continue;
    appendCallPropertyPathFacts(call.argumentPropertyAccesses, paths, seen, (path) =>
      queryPathUsesKnownQuery(path, knownQueries),
    );
  }

  return paths;
}

export function renderOnceStatePaths(model: ComponentModuleModel): string[] {
  return pathNames(renderOnceStatePathFacts(model), 'Compiler renderOnce state path names');
}

export function renderOnceStatePathFacts(model: ComponentModuleModel): QueryPathExpressionFact[] {
  const paths: QueryPathExpressionFact[] = [];
  const seen = compilerCreateSet<string>();
  const calls = compilerSnapshotDenseArray(callExpressions(model), 'Compiler renderOnce calls');
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index]!;
    if (call.name !== 'renderOnce') continue;
    appendCallPropertyPathFacts(call.argumentPropertyAccesses, paths, seen, isStatePath);
  }

  return paths;
}

export function jsxQueryExpressionPaths(
  model: ComponentModuleModel,
  knownQueries: ReadonlySet<string>,
  context: QueryCoverageContext = createQueryCoverageContext(model),
): QueryPathExpressionFact[] {
  return jsxExpressionPaths(model, (path) => queryPathUsesKnownQuery(path, knownQueries), context);
}

export function jsxStateExpressionPaths(
  model: ComponentModuleModel,
  context: QueryCoverageContext = createQueryCoverageContext(model),
): QueryPathExpressionFact[] {
  return jsxExpressionPaths(model, isStatePath, context);
}

export function queryExpressionCoveredByDataBind(
  expression: { end: number; start: number },
  model: ComponentModuleModel,
  context: QueryCoverageContext = createQueryCoverageContext(model),
): boolean {
  if (queryAttributeExpressionCoveredByDataBind(expression, context)) return true;

  const element = innermostContainingElement(expression, context);
  return element === null
    ? false
    : hasAttribute(
        element,
        (attribute) =>
          attribute.name === 'data-bind' &&
          isQueryBindingPath(jsxAttributeSemanticStringValue(attribute)),
      );
}

function queryAttributeExpressionCoveredByDataBind(
  expression: { end: number; start: number },
  context: QueryCoverageContext,
): boolean {
  const elements = context.elements;
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
        isQueryBindingPath(jsxAttributeSemanticStringValue(attribute)),
    );
  }

  return false;
}

export function stateExpressionCoveredByDataBind(
  expression: { end: number; start: number },
  model: ComponentModuleModel,
  context: QueryCoverageContext = createQueryCoverageContext(model),
): boolean {
  if (stateAttributeExpressionCoveredByDataBind(expression, context)) return true;

  const element = innermostContainingElement(expression, context);
  return element === null
    ? false
    : hasAttribute(element, (attribute) => {
        const value = jsxAttributeSemanticStringValue(attribute);
        return (
          attribute.name === 'data-bind' &&
          value !== undefined &&
          compilerStringStartsWith(value, 'state.')
        );
      });
}

function stateAttributeExpressionCoveredByDataBind(
  expression: { end: number; start: number },
  context: QueryCoverageContext,
): boolean {
  const elements = context.elements;
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

    return hasAttribute(element, (attribute) => {
      const value = jsxAttributeSemanticStringValue(attribute);
      return (
        attribute.name === `data-bind:${sourceAttribute.name}` &&
        value !== undefined &&
        compilerStringStartsWith(value, 'state.')
      );
    });
  }

  return false;
}

function innermostContainingElement(
  expression: { end: number; start: number },
  context: QueryCoverageContext,
): QueryCoverageElement | null {
  const elements = context.elements;
  let selected: QueryCoverageElement | null = null;
  for (let index = 0; index < elements.length; index += 1) {
    const candidate = elements[index]!;
    const element = candidate.element;
    if (
      element.selfClosing ||
      expression.start < element.openingEnd ||
      expression.end > element.closingStart
    ) {
      continue;
    }
    if (
      selected === null ||
      element.end - element.start < selected.element.end - selected.element.start
    ) {
      selected = candidate;
    }
  }
  return selected;
}

function isJsxEventAttributeExpression(
  expression: { end: number; start: number },
  context: QueryCoverageContext,
): boolean {
  const elements = context.elements;
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

function appendCallPropertyPathFacts(
  groups: readonly (readonly QueryPathExpressionFact[])[],
  output: QueryPathExpressionFact[],
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
      const access = accesses[index]!;
      const path = access.path;
      if (!keep(path) || compilerSetHas(seen, path)) continue;
      compilerSetAdd(seen, path);
      compilerArrayAppend(
        output,
        { end: access.end, path, start: access.start },
        'Compiler call property paths',
      );
    }
  }
}

function pathNames(facts: readonly QueryPathExpressionFact[], label: string): string[] {
  const source = compilerSnapshotDenseArray(facts, label);
  const names: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    compilerArrayAppend(names, source[index]!.path, label);
  }
  return names;
}

function jsxExpressionPaths(
  model: ComponentModuleModel,
  keep: (path: string) => boolean,
  context: QueryCoverageContext,
): QueryPathExpressionFact[] {
  const output: QueryPathExpressionFact[] = [];
  const expressions = context.expressions;
  for (let index = 0; index < expressions.length; index += 1) {
    const expression = expressions[index]!;
    if (isJsxEventAttributeExpression(expression, context)) continue;
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

function findAttribute(
  element: QueryCoverageElement,
  predicate: (attribute: JsxAttribute) => boolean,
): JsxAttribute | undefined {
  const attributes = element.attributes;
  for (let index = 0; index < attributes.length; index += 1) {
    if (predicate(attributes[index]!)) return attributes[index]!;
  }
  return undefined;
}

function hasAttribute(
  element: QueryCoverageElement,
  predicate: (attribute: JsxAttribute) => boolean,
): boolean {
  return findAttribute(element, predicate) !== undefined;
}
