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
  componentHasInferredServerRefreshTarget,
  componentOptionStaticValue,
  type ComponentModuleModel,
} from '../scan/parse.js';
import type { GeneratedOutputWriteFact } from '../output-context-facts.js';
import type {
  CompileComponentOptions,
  QueryDeriveFact,
  QueryStampFact,
  QueryTemplateStampFact,
  QueryUpdateCoverageFact,
  QueryUpdatePlanFact,
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

    facts.push({
      componentName,
      detail: binding.name,
      position: binding.name === 'data-bind' ? 'binding' : 'attribute',
      query: path,
      ...(query === 'state' ? { source: 'state' as const } : {}),
      status: 'plan',
    });
    const key = coveragePathKey(query === 'state' ? 'state' : 'query', path);
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
    const key = coveragePathKey('query', stamp.list);
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
    const key = coveragePathKey('query', path);
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
    const key = coveragePathKey('state', path);
    coveredPaths.add(key);
    statusCoveredPaths.add(key);
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
      const key = coveragePathKey('query', path);
      coveredPaths.add(key);
      statusCoveredPaths.add(key);
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
      const key = coveragePathKey('state', path);
      coveredPaths.add(key);
      statusCoveredPaths.add(key);
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
      const key = coveragePathKey('query', path);
      coveredPaths.add(key);
      statusCoveredPaths.add(key);
    }
  }

  for (const expression of jsxQueryExpressionPaths(model, knownQueries)) {
    const path = expression.path;
    const key = coveragePathKey('query', path);
    if (
      statusCoveredPaths.has(key) ||
      (planCoveredPaths.has(key) && queryExpressionCoveredByDataBind(expression, model))
    ) {
      continue;
    }

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
    const key = coveragePathKey('state', path);
    if (
      statusCoveredPaths.has(key) ||
      (planCoveredPaths.has(key) && stateExpressionCoveredByDataBind(expression, model))
    ) {
      continue;
    }
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
