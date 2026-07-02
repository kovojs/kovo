// Thin composition entrypoints for query-update analysis. The five concerns this
// file used to mix were split (FN10) into:
//   - `query-bindings.ts`  — data-bind collection + data-bind-list template-stamp assembly.
//   - `query-derives.ts`   — `derive()` / `data-derive` stamp collection.
//   - `query-coverage.ts`  — coverage push-loop support + status/plan precedence checks.
//   - `query-internal.ts`  — shared helpers, incl. the hidden non-enumerable
//                            `outputContext` / `outputContexts` side-channel.
// `collectQueryUpdatePlans` / `collectQueryUpdateCoverage` remain here as the
// composition entrypoints the rest of the compiler imports; `collectDataBindListStamps`
// is re-exported so existing importers stay unchanged. SPEC.md §5.x query-update facts.
// Behavior-neutral: emitted `QueryUpdatePlanFact` / `QueryUpdateCoverageFact` bytes and
// `factHash` output are identical to the pre-split module.
import { dedupeBy } from '../shared.js';
import { knownQueryNames, queryNameFromPath } from './query-shapes.js';
import { coveragePathKey, withOutputContexts } from './query-internal.js';
import {
  collectDataBindListStamps,
  dataBindAttributes,
  dataBindOutputContextFact,
  pushOutputContext,
} from './query-bindings.js';
import { dataDeriveStamps, derivePlanInputs, exportedDerives } from './query-derives.js';
import {
  jsxQueryExpressionPaths,
  jsxStateExpressionPaths,
  queryExpressionCoveredByDataBind,
  renderOnceQueryPaths,
  renderOnceStatePaths,
  stateExpressionCoveredByDataBind,
  updateCoverageKey,
} from './query-coverage.js';
import {
  componentHasInferredFragmentTarget,
  componentModelForSourceSpan,
  componentOptionStaticValueFor,
  jsxElements,
  type ComponentModel,
  type ComponentModuleModel,
} from '../scan/parse.js';
import { generatedOffsetToOriginal, type SourceOffsetMap } from '../shared.js';
import type { GeneratedOutputWriteFact } from '../output-context-facts.js';
import type {
  CompileComponentOptions,
  QueryDeriveFact,
  QueryStampFact,
  QueryTemplateStampFact,
  QueryUpdateCoverageFact,
  QueryUpdatePlanFact,
  StateDeriveFact,
} from '../types.js';

export { collectDataBindListStamps } from './query-bindings.js';

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
    for (const input of derivePlanInputs(derive)) {
      const derives = derivesByQuery.get(input) ?? [];
      derives.push({ ...derive, input });
      derivesByQuery.set(input, derives);
    }
  }

  for (const stamp of deriveStamps.stamps) {
    for (const input of derivePlanInputs(stamp.derive)) {
      const stamps = stampsByQuery.get(input) ?? [];
      stamps.push({ ...stamp, derive: { ...stamp.derive, input } });
      stampsByQuery.set(input, stamps);
      pushOutputContext(outputContextsByQuery, input, stamp.outputContext);
    }
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
  stateDerives: readonly StateDeriveFact[] = [],
  sourceOffsetMap?: SourceOffsetMap,
): QueryUpdateCoverageFact[] {
  const facts: QueryUpdateCoverageFact[] = [];
  const coveredPaths = new Set<string>();
  const planCoveredPaths = new Set<string>();
  const statusCoveredPaths = new Set<string>();
  const knownQueries = knownQueryNames(model, options);

  for (const binding of dataBindAttributes(model).filter((item) => item.query !== null)) {
    const path = binding.path;
    const query = binding.query;
    if (!query) continue;
    const ownerName = componentNameForSpan(model, componentName, {
      end: binding.end ?? binding.start ?? 0,
      start: binding.start ?? 0,
    });

    facts.push({
      componentName: ownerName,
      detail: binding.name,
      position: binding.name === 'data-bind' ? 'binding' : 'attribute',
      query: path,
      ...(query === 'state' ? { source: 'state' as const } : {}),
      status: 'plan',
    });
    const key = componentCoveragePathKey(ownerName, query === 'state' ? 'state' : 'query', path);
    coveredPaths.add(key);
    planCoveredPaths.add(key);
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
    const key = componentCoveragePathKey(componentName, 'query', stamp.list);
    coveredPaths.add(key);
    planCoveredPaths.add(key);
  }

  for (const path of renderOnceQueryPaths(model, knownQueries)) {
    facts.push({
      componentName,
      detail: 'declared renderOnce',
      position: 'expression',
      query: path,
      status: 'renderOnce',
    });
    const key = componentCoveragePathKey(componentName, 'query', path);
    coveredPaths.add(key);
    statusCoveredPaths.add(key);
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
    const key = componentCoveragePathKey(componentName, 'state', path);
    coveredPaths.add(key);
    statusCoveredPaths.add(key);
  }

  for (const expression of jsxQueryExpressionPaths(model, knownQueries)) {
    const owner = componentForSpan(model, expression);
    if (!owner || componentOptionStaticValueFor(owner, 'isomorphic') !== true) continue;
    const ownerName = owner?.localName ?? componentName;
    const path = expression.path;
    const key = componentCoveragePathKey(ownerName, 'query', path);
    if (coveredPaths.has(key)) continue;

    facts.push({
      componentName: ownerName,
      detail: 'declared isomorphic island',
      position: 'expression',
      query: path,
      status: 'isomorphic',
    });
    coveredPaths.add(key);
    statusCoveredPaths.add(key);
  }

  for (const expression of jsxStateExpressionPaths(model)) {
    const owner = componentForSpan(model, expression);
    if (!owner || componentOptionStaticValueFor(owner, 'isomorphic') !== true) continue;
    const ownerName = owner?.localName ?? componentName;
    const path = expression.path;
    const key = componentCoveragePathKey(ownerName, 'state', path);
    if (coveredPaths.has(key)) continue;

    facts.push({
      componentName: ownerName,
      detail: 'declared isomorphic island',
      position: 'expression',
      query: path,
      source: 'state',
      status: 'isomorphic',
    });
    coveredPaths.add(key);
    statusCoveredPaths.add(key);
  }

  for (const expression of jsxQueryExpressionPaths(model, knownQueries)) {
    const owner = componentForSpan(model, expression);
    const fragmentTarget =
      owner && componentHasInferredFragmentTarget(owner)
        ? owner
        : fragmentTargetComponentReferenceForSpan(model, expression);
    if (!fragmentTarget) continue;
    const ownerName = owner?.localName ?? componentName;
    const path = expression.path;
    const key = componentCoveragePathKey(ownerName, 'query', path);
    if (coveredPaths.has(key)) continue;

    facts.push({
      componentName: ownerName,
      detail: 'inferred query-backed server refresh target',
      position: 'expression',
      query: path,
      status: 'fragment',
    });
    coveredPaths.add(key);
    statusCoveredPaths.add(key);
  }

  for (const expression of jsxQueryExpressionPaths(model, knownQueries)) {
    const ownerName = componentNameForSpan(model, componentName, expression);
    const path = expression.path;
    const key = componentCoveragePathKey(ownerName, 'query', path);
    if (
      statusCoveredPaths.has(key) ||
      (planCoveredPaths.has(key) && queryExpressionCoveredByDataBind(expression, model))
    ) {
      continue;
    }

    facts.push({
      componentName: ownerName,
      detail: 'query expression has no data-bind, renderOnce, fragment, or isomorphic status',
      position: 'expression',
      query: path,
      sourceSpan: { length: expression.end - expression.start, start: expression.start },
      status: 'UNHANDLED',
    });
  }

  for (const expression of jsxStateExpressionPaths(model)) {
    const ownerName = componentNameForSpan(model, componentName, expression);
    const path = expression.path;
    const key = componentCoveragePathKey(ownerName, 'state', path);
    if (
      statusCoveredPaths.has(key) ||
      (planCoveredPaths.has(key) && stateExpressionCoveredByDataBind(expression, model))
    ) {
      continue;
    }
    if (stateExpressionCoveredByDataBind(expression, model)) continue;
    if (stateExpressionCoveredByGeneratedDerive(expression, stateDerives, sourceOffsetMap)) {
      continue;
    }

    facts.push({
      componentName: ownerName,
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

function stateExpressionCoveredByGeneratedDerive(
  expression: { end: number; path: string; start: number },
  stateDerives: readonly StateDeriveFact[],
  sourceOffsetMap: SourceOffsetMap | undefined,
): boolean {
  const span = originalSpanForGeneratedExpression(expression, sourceOffsetMap);
  if (!span) return false;
  return stateDerives.some(
    (derive) =>
      derive.sourceSpan !== undefined &&
      deriveExpressionReferencesPath(derive.expression, expression.path) &&
      derive.sourceSpan.start >= span.start &&
      derive.sourceSpan.end <= span.end,
  );
}

function originalSpanForGeneratedExpression(
  expression: { end: number; start: number },
  sourceOffsetMap: SourceOffsetMap | undefined,
): { end: number; start: number } | null {
  if (sourceOffsetMap === undefined) return expression;
  const start = generatedOffsetToOriginal(sourceOffsetMap, expression.start);
  const mappedEnd =
    generatedOffsetToOriginal(sourceOffsetMap, expression.end) ??
    endOffsetAfterMappedLastCharacter(sourceOffsetMap, expression.end);
  if (start === undefined || mappedEnd === undefined) return null;
  return { end: mappedEnd, start };
}

function endOffsetAfterMappedLastCharacter(
  sourceOffsetMap: SourceOffsetMap,
  generatedEnd: number,
): number | undefined {
  if (generatedEnd <= 0) return undefined;
  const previous = generatedOffsetToOriginal(sourceOffsetMap, generatedEnd - 1);
  return previous === undefined ? undefined : previous + 1;
}

function deriveExpressionReferencesPath(expression: string, path: string): boolean {
  const start = expression.indexOf(path);
  if (start === -1) return false;
  const next = expression[start + path.length];
  return next === undefined || !/[$\w]/u.test(next);
}

function componentForSpan(
  model: ComponentModuleModel,
  span: { end: number; start: number },
): ComponentModel | null {
  return componentModelForSourceSpan(model, span);
}

function componentNameForSpan(
  model: ComponentModuleModel,
  fallback: string,
  span: { end: number; start: number },
): string {
  return componentForSpan(model, span)?.localName ?? fallback;
}

function componentCoveragePathKey(
  componentName: string,
  source: 'query' | 'state',
  path: string,
): string {
  return `${componentName}\0${coveragePathKey(source, path)}`;
}

function fragmentTargetComponentReferenceForSpan(
  model: ComponentModuleModel,
  span: { end: number; start: number },
): ComponentModel | null {
  const fragmentTargetsByLocalName = new Map(
    model.components.flatMap((component) =>
      component.localName && componentHasInferredFragmentTarget(component)
        ? [[component.localName, component]]
        : [],
    ),
  );
  if (fragmentTargetsByLocalName.size === 0) return null;

  const containingTarget = jsxElements(model)
    .filter(
      (element) =>
        span.start >= element.start &&
        span.end <= element.end &&
        fragmentTargetsByLocalName.has(element.tag),
    )
    .sort((left, right) => left.end - left.start - (right.end - right.start))[0];

  return containingTarget ? (fragmentTargetsByLocalName.get(containingTarget.tag) ?? null) : null;
}
