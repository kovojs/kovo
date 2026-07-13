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
import {
  compilerArrayAppend,
  compilerCreateMap,
  compilerCreateSet,
  compilerMapForEach,
  compilerMapGet,
  compilerMapSet,
  compilerSetAdd,
  compilerSetForEach,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerStringLocaleCompare,
  compilerStringStartsWith,
} from '../compiler-security-intrinsics.js';
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
  createQueryCoverageContext,
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
  const pathsByQuery = compilerCreateMap<string, Set<string>>();
  const outputContextsByQuery = compilerCreateMap<string, GeneratedOutputWriteFact[]>();
  const derivesByQuery = compilerCreateMap<string, QueryDeriveFact[]>();
  const stampsByQuery = compilerCreateMap<string, QueryStampFact[]>();
  const listStampsByQuery = compilerCreateMap<string, QueryTemplateStampFact[]>();

  const bindings = compilerSnapshotDenseArray(
    dataBindAttributes(model),
    'Compiler query-plan bindings',
  );
  for (let index = 0; index < bindings.length; index += 1) {
    const binding = bindings[index]!;
    const { path, query } = binding;
    if (!query || query === 'state') continue;

    const paths = compilerMapGet(pathsByQuery, query) ?? compilerCreateSet<string>();
    compilerSetAdd(paths, path);
    compilerMapSet(pathsByQuery, query, paths);
    pushOutputContext(outputContextsByQuery, query, dataBindOutputContextFact(binding));
  }

  const listStamps = compilerSnapshotDenseArray(
    collectDataBindListStamps(model),
    'Compiler query-plan list stamps',
  );
  for (let index = 0; index < listStamps.length; index += 1) {
    const stamp = listStamps[index]!;
    const query = queryNameFromPath(stamp.list);
    if (!query || query === 'state') continue;

    const paths = compilerMapGet(pathsByQuery, query) ?? compilerCreateSet<string>();
    compilerSetAdd(paths, stamp.list);
    compilerMapSet(pathsByQuery, query, paths);
    appendMapArray(listStampsByQuery, query, stamp, 'Compiler query-plan list stamps');
    pushOutputContext(outputContextsByQuery, query, stamp.outputContext);
    const placeholders = compilerSnapshotDenseArray(
      stamp.itemBindingPlaceholders ?? [],
      'Compiler query-plan list placeholders',
    );
    for (let placeholderIndex = 0; placeholderIndex < placeholders.length; placeholderIndex += 1) {
      pushOutputContext(
        outputContextsByQuery,
        query,
        placeholders[placeholderIndex]!.outputContext,
      );
    }
  }

  const deriveStamps = dataDeriveStamps(model, exportedDerives(model));

  const derives = compilerSnapshotDenseArray(deriveStamps.derives, 'Compiler query-plan derives');
  for (let deriveIndex = 0; deriveIndex < derives.length; deriveIndex += 1) {
    const derive = derives[deriveIndex]!;
    const inputs = compilerSnapshotDenseArray(
      derivePlanInputs(derive),
      'Compiler query-plan derive inputs',
    );
    for (let inputIndex = 0; inputIndex < inputs.length; inputIndex += 1) {
      const input = inputs[inputIndex]!;
      appendMapArray(derivesByQuery, input, { ...derive, input }, 'Compiler query-plan derives');
    }
  }

  const stamps = compilerSnapshotDenseArray(
    deriveStamps.stamps,
    'Compiler query-plan derive stamps',
  );
  for (let stampIndex = 0; stampIndex < stamps.length; stampIndex += 1) {
    const stamp = stamps[stampIndex]!;
    const inputs = compilerSnapshotDenseArray(
      derivePlanInputs(stamp.derive),
      'Compiler query-plan stamp inputs',
    );
    for (let inputIndex = 0; inputIndex < inputs.length; inputIndex += 1) {
      const input = inputs[inputIndex]!;
      appendMapArray(
        stampsByQuery,
        input,
        { ...stamp, derive: { ...stamp.derive, input } },
        'Compiler query-plan derive stamps',
      );
      pushOutputContext(outputContextsByQuery, input, stamp.outputContext);
    }
  }

  const queries = compilerCreateSet<string>();
  addMapKeys(queries, pathsByQuery);
  addMapKeys(queries, listStampsByQuery);
  addMapKeys(queries, derivesByQuery);
  addMapKeys(queries, stampsByQuery);
  const queryNames = setValues(queries, 'Compiler query-plan names');
  sortValues(queryNames, compilerStringLocaleCompare);
  const output: QueryUpdatePlanFact[] = [];
  for (let index = 0; index < queryNames.length; index += 1) {
    const query = queryNames[index]!;
    const queryDerives = compilerMapGet(derivesByQuery, query);
    const queryStamps = compilerMapGet(stampsByQuery, query);
    const queryTemplateStamps = compilerMapGet(listStampsByQuery, query);
    const plan: QueryUpdatePlanFact = {
      componentName,
      ...(queryDerives === undefined
        ? {}
        : {
            derives: sortedValues(
              queryDerives,
              (left, right) => compilerStringLocaleCompare(left.name, right.name),
              'Compiler query-plan derives',
            ),
          }),
      paths: sortedSetStrings(compilerMapGet(pathsByQuery, query)),
      query,
      ...(queryStamps === undefined
        ? {}
        : {
            stamps: sortedValues(
              queryStamps,
              (left, right) => compilerStringLocaleCompare(left.attr, right.attr),
              'Compiler query-plan stamps',
            ),
          }),
      ...(queryTemplateStamps === undefined
        ? {}
        : {
            templateStamps: sortedValues(
              queryTemplateStamps,
              (left, right) => compilerStringLocaleCompare(left.list, right.list),
              'Compiler query-plan template stamps',
            ),
          }),
    };
    const outputContexts = compilerMapGet(outputContextsByQuery, query);
    compilerArrayAppend(
      output,
      outputContexts === undefined ? plan : withOutputContexts(plan, outputContexts),
      'Compiler query update plans',
    );
  }
  return output;
}

export function collectQueryUpdateCoverage(
  model: ComponentModuleModel,
  options: CompileComponentOptions,
  componentName: string,
  stateDerives: readonly StateDeriveFact[] = [],
  sourceOffsetMap?: SourceOffsetMap,
): QueryUpdateCoverageFact[] {
  const facts: QueryUpdateCoverageFact[] = [];
  const coveredPaths = compilerCreateSet<string>();
  const planCoveredPaths = compilerCreateSet<string>();
  const statusCoveredPaths = compilerCreateSet<string>();
  const knownQueries = knownQueryNames(model, options);
  const coverageContext = createQueryCoverageContext(model);

  const bindings = compilerSnapshotDenseArray(
    dataBindAttributes(model),
    'Compiler query coverage bindings',
  );
  for (let index = 0; index < bindings.length; index += 1) {
    const binding = bindings[index]!;
    if (binding.query === null) continue;
    const path = binding.path;
    const query = binding.query;
    if (!query) continue;
    const ownerName = componentNameForSpan(model, componentName, {
      end: binding.end ?? binding.start ?? 0,
      start: binding.start ?? 0,
    });

    compilerArrayAppend(
      facts,
      {
        componentName: ownerName,
        detail: binding.name,
        position: binding.name === 'data-bind' ? 'binding' : 'attribute',
        query: path,
        ...(query === 'state' ? { source: 'state' as const } : {}),
        status: 'plan',
      },
      'Compiler query coverage facts',
    );
    const key = componentCoveragePathKey(ownerName, query === 'state' ? 'state' : 'query', path);
    compilerSetAdd(coveredPaths, key);
    compilerSetAdd(planCoveredPaths, key);
  }

  const listStamps = compilerSnapshotDenseArray(
    collectDataBindListStamps(model),
    'Compiler query coverage list stamps',
  );
  for (let index = 0; index < listStamps.length; index += 1) {
    const stamp = listStamps[index]!;
    if (queryNameFromPath(stamp.list) === 'state') continue;

    compilerArrayAppend(
      facts,
      {
        componentName,
        detail: 'data-bind-list',
        position: 'template',
        query: stamp.list,
        status: 'plan',
      },
      'Compiler query coverage facts',
    );
    const key = componentCoveragePathKey(componentName, 'query', stamp.list);
    compilerSetAdd(coveredPaths, key);
    compilerSetAdd(planCoveredPaths, key);
  }

  const renderOnceQueries = compilerSnapshotDenseArray(
    renderOnceQueryPaths(model, knownQueries),
    'Compiler renderOnce query paths',
  );
  for (let index = 0; index < renderOnceQueries.length; index += 1) {
    const path = renderOnceQueries[index]!;
    compilerArrayAppend(
      facts,
      {
        componentName,
        detail: 'declared renderOnce',
        position: 'expression',
        query: path,
        status: 'renderOnce',
      },
      'Compiler query coverage facts',
    );
    const key = componentCoveragePathKey(componentName, 'query', path);
    compilerSetAdd(coveredPaths, key);
    compilerSetAdd(statusCoveredPaths, key);
  }

  const renderOnceStates = compilerSnapshotDenseArray(
    renderOnceStatePaths(model),
    'Compiler renderOnce state paths',
  );
  for (let index = 0; index < renderOnceStates.length; index += 1) {
    const path = renderOnceStates[index]!;
    compilerArrayAppend(
      facts,
      {
        componentName,
        detail: 'declared renderOnce',
        position: 'expression',
        query: path,
        source: 'state',
        status: 'renderOnce',
      },
      'Compiler query coverage facts',
    );
    const key = componentCoveragePathKey(componentName, 'state', path);
    compilerSetAdd(coveredPaths, key);
    compilerSetAdd(statusCoveredPaths, key);
  }

  const queryExpressions = compilerSnapshotDenseArray(
    jsxQueryExpressionPaths(model, knownQueries, coverageContext),
    'Compiler query coverage expressions',
  );
  for (let index = 0; index < queryExpressions.length; index += 1) {
    const expression = queryExpressions[index]!;
    const owner = componentForSpan(model, expression);
    if (!owner || componentOptionStaticValueFor(owner, 'isomorphic') !== true) continue;
    const ownerName = owner?.localName ?? componentName;
    const path = expression.path;
    const key = componentCoveragePathKey(ownerName, 'query', path);
    if (compilerSetHas(coveredPaths, key)) continue;

    compilerArrayAppend(
      facts,
      {
        componentName: ownerName,
        detail: 'declared isomorphic island',
        position: 'expression',
        query: path,
        status: 'isomorphic',
      },
      'Compiler query coverage facts',
    );
    compilerSetAdd(coveredPaths, key);
    compilerSetAdd(statusCoveredPaths, key);
  }

  const stateExpressions = compilerSnapshotDenseArray(
    jsxStateExpressionPaths(model, coverageContext),
    'Compiler state coverage expressions',
  );
  for (let index = 0; index < stateExpressions.length; index += 1) {
    const expression = stateExpressions[index]!;
    const owner = componentForSpan(model, expression);
    if (!owner || componentOptionStaticValueFor(owner, 'isomorphic') !== true) continue;
    const ownerName = owner?.localName ?? componentName;
    const path = expression.path;
    const key = componentCoveragePathKey(ownerName, 'state', path);
    if (compilerSetHas(coveredPaths, key)) continue;

    compilerArrayAppend(
      facts,
      {
        componentName: ownerName,
        detail: 'declared isomorphic island',
        position: 'expression',
        query: path,
        source: 'state',
        status: 'isomorphic',
      },
      'Compiler state coverage facts',
    );
    compilerSetAdd(coveredPaths, key);
    compilerSetAdd(statusCoveredPaths, key);
  }

  for (let index = 0; index < queryExpressions.length; index += 1) {
    const expression = queryExpressions[index]!;
    const owner = componentForSpan(model, expression);
    const fragmentTarget =
      owner && componentHasInferredFragmentTarget(owner)
        ? owner
        : fragmentTargetComponentReferenceForSpan(model, expression);
    if (!fragmentTarget) continue;
    const ownerName = owner?.localName ?? componentName;
    const path = expression.path;
    const key = componentCoveragePathKey(ownerName, 'query', path);
    if (compilerSetHas(coveredPaths, key)) continue;

    compilerArrayAppend(
      facts,
      {
        componentName: ownerName,
        detail: 'inferred query-backed server refresh target',
        position: 'expression',
        query: path,
        status: 'fragment',
      },
      'Compiler query coverage facts',
    );
    compilerSetAdd(coveredPaths, key);
    compilerSetAdd(statusCoveredPaths, key);
  }

  for (let index = 0; index < queryExpressions.length; index += 1) {
    const expression = queryExpressions[index]!;
    const ownerName = componentNameForSpan(model, componentName, expression);
    const path = expression.path;
    const key = componentCoveragePathKey(ownerName, 'query', path);
    if (
      compilerSetHas(statusCoveredPaths, key) ||
      (compilerSetHas(planCoveredPaths, key) &&
        queryExpressionCoveredByDataBind(expression, model, coverageContext))
    ) {
      continue;
    }

    compilerArrayAppend(
      facts,
      {
        componentName: ownerName,
        detail: 'query expression has no data-bind, renderOnce, fragment, or isomorphic status',
        position: 'expression',
        query: path,
        sourceSpan: { length: expression.end - expression.start, start: expression.start },
        status: 'UNHANDLED',
      },
      'Compiler query coverage facts',
    );
  }

  for (let index = 0; index < stateExpressions.length; index += 1) {
    const expression = stateExpressions[index]!;
    const ownerName = componentNameForSpan(model, componentName, expression);
    const path = expression.path;
    const key = componentCoveragePathKey(ownerName, 'state', path);
    if (
      compilerSetHas(statusCoveredPaths, key) ||
      (compilerSetHas(planCoveredPaths, key) &&
        stateExpressionCoveredByDataBind(expression, model, coverageContext))
    ) {
      continue;
    }
    if (stateExpressionCoveredByDataBind(expression, model, coverageContext)) continue;
    if (stateExpressionCoveredByGeneratedDerive(expression, stateDerives, sourceOffsetMap)) {
      continue;
    }

    compilerArrayAppend(
      facts,
      {
        componentName: ownerName,
        detail: 'state expression has no data-bind, renderOnce, or isomorphic status',
        position: 'expression',
        query: path,
        source: 'state',
        sourceSpan: { length: expression.end - expression.start, start: expression.start },
        status: 'UNHANDLED',
      },
      'Compiler state coverage facts',
    );
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
  const derives = compilerSnapshotDenseArray(stateDerives, 'Compiler generated state derives');
  for (let index = 0; index < derives.length; index += 1) {
    const derive = derives[index]!;
    if (
      derive.sourceSpan !== undefined &&
      deriveSourcePathsCoverExpression(derive.sourcePaths, expression.path) &&
      derive.sourceSpan.start >= span.start &&
      derive.sourceSpan.end <= span.end
    ) {
      return true;
    }
  }
  return false;
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

function deriveSourcePathsCoverExpression(
  sourcePaths: readonly string[] | undefined,
  path: string,
): boolean {
  const paths = compilerSnapshotDenseArray(sourcePaths ?? [], 'Compiler state derive source paths');
  for (let index = 0; index < paths.length; index += 1) {
    if (statePathCovers(paths[index]!, path)) return true;
  }
  return false;
}

function statePathCovers(sourcePath: string, path: string): boolean {
  return (
    sourcePath === path ||
    compilerStringStartsWith(sourcePath, `${path}.`) ||
    compilerStringStartsWith(sourcePath, `${path}[`)
  );
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
  const fragmentTargetsByLocalName = compilerCreateMap<string, ComponentModel>();
  let hasFragmentTarget = false;
  const components = compilerSnapshotDenseArray(
    model.components,
    'Compiler fragment target components',
  );
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index]!;
    if (!component.localName || !componentHasInferredFragmentTarget(component)) continue;
    compilerMapSet(fragmentTargetsByLocalName, component.localName, component);
    hasFragmentTarget = true;
  }
  if (!hasFragmentTarget) return null;

  const elements = compilerSnapshotDenseArray(
    jsxElements(model),
    'Compiler fragment target elements',
  );
  let containingTarget: (typeof elements)[number] | undefined;
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (
      span.start < element.start ||
      span.end > element.end ||
      compilerMapGet(fragmentTargetsByLocalName, element.tag) === undefined
    ) {
      continue;
    }
    if (
      containingTarget === undefined ||
      element.end - element.start < containingTarget.end - containingTarget.start
    ) {
      containingTarget = element;
    }
  }

  return containingTarget
    ? (compilerMapGet(fragmentTargetsByLocalName, containingTarget.tag) ?? null)
    : null;
}

function appendMapArray<Key, Value>(
  map: Map<Key, Value[]>,
  key: Key,
  value: Value,
  label: string,
): void {
  const values = compilerSnapshotDenseArray(compilerMapGet(map, key) ?? [], label);
  compilerArrayAppend(values, value, label);
  compilerMapSet(map, key, values);
}

function addMapKeys<Key>(target: Set<Key>, map: ReadonlyMap<Key, unknown>): void {
  compilerMapForEach(map, (_value, key) => {
    compilerSetAdd(target, key);
  });
}

function setValues<Value>(values: ReadonlySet<Value>, label: string): Value[] {
  const output: Value[] = [];
  compilerSetForEach(values, (value) => {
    compilerArrayAppend(output, value, label);
  });
  return output;
}

function sortedSetStrings(values: ReadonlySet<string> | undefined): string[] {
  const output = values === undefined ? [] : setValues(values, 'Compiler query-plan paths');
  sortValues(output, compilerStringLocaleCompare);
  return output;
}

function sortedValues<Value>(
  values: readonly Value[],
  compare: (left: Value, right: Value) => number,
  label: string,
): Value[] {
  const output = compilerSnapshotDenseArray(values, label);
  sortValues(output, compare);
  return output;
}

function sortValues<Value>(values: Value[], compare: (left: Value, right: Value) => number): void {
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index]!;
    let insertion = index;
    while (insertion > 0 && compare(value, values[insertion - 1]!) < 0) {
      values[insertion] = values[insertion - 1]!;
      insertion -= 1;
    }
    values[insertion] = value;
  }
}
