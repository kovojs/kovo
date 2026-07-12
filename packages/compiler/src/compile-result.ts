import type { GeneratedOutputWriteFact } from './output-context-facts.js';
import type { SourceSpan } from './scan/parse.js';
import type { QueryUpdateCoverageFact, QueryUpdatePlanFact } from './types.js';
import { canonicalJson } from './canonical-json.js';
import {
  compilerArrayIsArray,
  compilerCreateMap,
  compilerMapForEach,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerSnapshotDenseArray,
  compilerSnapshotJsonValue,
  compilerStringLocaleCompare,
} from './compiler-security-intrinsics.js';
import { dedupeBy } from './shared.js';

/**
 * @internal FN5 (plans/compiler-refactoring.md): the canonical per-fact-category merge,
 * dedupe, and sort rules the compile orchestrator applies when assembling a
 * {@link import('./types.js').CompileResult}. Extracted from `compile.ts` so the result
 * assembly is one named, testable unit rather than inline helpers in the orchestrator.
 * Behavior-neutral: moved verbatim; outputs are byte-identical.
 */

/** @internal Merge per-query update plans, deduping derives/stamps/templateStamps/output contexts. */
export function mergeQueryUpdatePlans(
  plans: readonly QueryUpdatePlanFact[],
): QueryUpdatePlanFact[] {
  const sourcePlans = compilerSnapshotDenseArray(plans, 'Query update plans');
  const snapshot: QueryUpdatePlanFact[] = [];
  for (let index = 0; index < sourcePlans.length; index += 1) {
    snapshot[index] = snapshotQueryUpdatePlan(sourcePlans[index]!, index);
  }
  const byQuery = compilerCreateMap<string, QueryUpdatePlanFact[]>();
  for (let index = 0; index < snapshot.length; index += 1) {
    const plan = snapshot[index]!;
    const queryPlans = compilerMapGet(byQuery, plan.query) ?? [];
    queryPlans[queryPlans.length] = plan;
    compilerMapSet(byQuery, plan.query, queryPlans);
  }

  const entries: [string, QueryUpdatePlanFact[]][] = [];
  compilerMapForEach(byQuery, (queryPlans, query) => {
    entries[entries.length] = [query, queryPlans];
  });
  stableSort(entries, ([left], [right]) => compilerStringLocaleCompare(left, right));

  const merged: QueryUpdatePlanFact[] = [];
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const [query, queryPlans] = entries[entryIndex]!;
    const paths = stableSort(
      dedupeBy(flattenPlanFacts(queryPlans, 'paths'), (path) => path),
      (left, right) => (left < right ? -1 : left > right ? 1 : 0),
    );
    const outputContexts = flattenPlanFacts(queryPlans, 'outputContexts');
    const derives = flattenPlanFacts(queryPlans, 'derives');
    const stamps = flattenPlanFacts(queryPlans, 'stamps');
    const templateStamps = flattenPlanFacts(queryPlans, 'templateStamps');
    const result: QueryUpdatePlanFact = {
      componentName: queryPlans[0]?.componentName ?? 'Component',
      query,
      paths,
      ...(outputContexts.length === 0
        ? {}
        : { outputContexts: dedupeOutputContextFacts(outputContexts) }),
      ...(derives.length === 0
        ? {}
        : {
            derives: stableSort(
              dedupeByKey(derives, (derive) => derive.exportName),
              (left, right) => compilerStringLocaleCompare(left.name, right.name),
            ),
          }),
      ...(stamps.length === 0
        ? {}
        : {
            stamps: stableSort(
              dedupeByKey(
                stamps,
                (stamp) => `${stamp.attr}\0${stamp.selector}\0${stamp.derive.exportName}`,
              ),
              (left, right) => compilerStringLocaleCompare(left.attr, right.attr),
            ),
          }),
      ...(templateStamps.length === 0
        ? {}
        : {
            templateStamps: stableSort(
              dedupeByKey(
                templateStamps,
                (stamp) => `${stamp.key}\0${stamp.selector}\0${stamp.list}`,
              ),
              (left, right) => compilerStringLocaleCompare(left.list, right.list),
            ),
          }),
    };
    merged[merged.length] = result;
  }
  return merged;
}

/** @internal Dedupe generated output-context facts by full structural identity. */
export function dedupeOutputContextFacts(
  facts: readonly GeneratedOutputWriteFact[],
): GeneratedOutputWriteFact[] {
  return dedupeByKey(facts, canonicalJson);
}

/** @internal Fold style-extraction coverage over the base coverage, dropping base UNHANDLED facts the style pass owns. */
export function mergeStyleUpdateCoverage(
  coverage: readonly QueryUpdateCoverageFact[],
  styleCoverage: readonly QueryUpdateCoverageFact[],
  handledSpans: readonly SourceSpan[],
): QueryUpdateCoverageFact[] {
  const coverageSnapshot = compilerSnapshotJsonValue(coverage, 'Query update coverage');
  const styleSnapshot = compilerSnapshotJsonValue(styleCoverage, 'Style update coverage');
  const spanSnapshot = compilerSnapshotJsonValue(handledSpans, 'Handled source spans');
  if (styleSnapshot.length === 0) return coverageSnapshot;

  const merged: QueryUpdateCoverageFact[] = [];
  for (let factIndex = 0; factIndex < coverageSnapshot.length; factIndex += 1) {
    const fact = coverageSnapshot[factIndex]!;
      const sourceSpan = fact.sourceSpan;
      let handled = false;
      if (sourceSpan !== undefined) {
        for (let spanIndex = 0; spanIndex < spanSnapshot.length; spanIndex += 1) {
          if (containsSourceSpan(spanSnapshot[spanIndex]!, sourceSpan)) {
            handled = true;
            break;
          }
        }
      }
      if (
        fact.status !== 'UNHANDLED' ||
        sourceSpan === undefined ||
        !handled
      ) {
        merged[merged.length] = fact;
      }
  }
  for (let index = 0; index < styleSnapshot.length; index += 1) {
    merged[merged.length] = styleSnapshot[index]!;
  }
  return merged;
}

function containsSourceSpan(outer: SourceSpan, inner: { length: number; start: number }): boolean {
  return inner.start >= outer.start && inner.start + inner.length <= outer.end;
}

/** @internal Stable first-wins dedupe by a derived string key. */
export function dedupeByKey<Value>(
  values: readonly Value[],
  keyFor: (value: Value) => string,
): Value[] {
  return dedupeBy(values, keyFor);
}

function flattenPlanFacts<
  Key extends 'derives' | 'outputContexts' | 'paths' | 'stamps' | 'templateStamps',
>(
  plans: readonly QueryUpdatePlanFact[],
  key: Key,
): NonNullable<QueryUpdatePlanFact[Key]>[number][] {
  const flattened: NonNullable<QueryUpdatePlanFact[Key]>[number][] = [];
  for (let planIndex = 0; planIndex < plans.length; planIndex += 1) {
    const values = plans[planIndex]![key];
    if (values === undefined) continue;
    const snapshot = compilerSnapshotDenseArray(values, `Query update plan.${key}`);
    for (let valueIndex = 0; valueIndex < snapshot.length; valueIndex += 1) {
      flattened[flattened.length] = snapshot[valueIndex]!;
    }
  }
  return flattened;
}

function snapshotQueryUpdatePlan(plan: QueryUpdatePlanFact, index: number): QueryUpdatePlanFact {
  const label = `Query update plans[${index}]`;
  const snapshot = compilerSnapshotJsonValue(plan, label);
  const outputContexts = compilerOwnDataValue(plan, 'outputContexts', label);
  if (outputContexts === undefined) return snapshot;
  if (!compilerArrayIsArray(outputContexts)) {
    throw new TypeError(`${label}.outputContexts must be an array.`);
  }
  return {
    ...snapshot,
    outputContexts: compilerSnapshotJsonValue(outputContexts, `${label}.outputContexts`),
  };
}

function stableSort<Value>(
  values: readonly Value[],
  compare: (left: Value, right: Value) => number,
): Value[] {
  const sorted = compilerSnapshotDenseArray(values, 'Compiler sorted facts');
  for (let index = 1; index < sorted.length; index += 1) {
    const value = sorted[index]!;
    let insertion = index;
    while (insertion > 0 && compare(sorted[insertion - 1]!, value) > 0) {
      sorted[insertion] = sorted[insertion - 1]!;
      insertion -= 1;
    }
    sorted[insertion] = value;
  }
  return sorted;
}
