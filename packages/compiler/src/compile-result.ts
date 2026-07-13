import type { GeneratedOutputWriteFact } from './output-context-facts.js';
import type { SourceSpan } from './scan/parse.js';
import type { QueryUpdateCoverageFact, QueryUpdatePlanFact } from './types.js';
import { canonicalJson } from './canonical-json.js';
import {
  compilerArrayAppend,
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
    compilerArrayAppend(
      queryPlans,
      plan,
      'Compiler packages/compiler/src/compile-result.ts collection',
    );
    compilerMapSet(byQuery, plan.query, queryPlans);
  }

  const entries: [string, QueryUpdatePlanFact[]][] = [];
  compilerMapForEach(byQuery, (queryPlans, query) => {
    compilerArrayAppend(
      entries,
      [query, queryPlans],
      'Compiler packages/compiler/src/compile-result.ts collection',
    );
  });
  stableSort(entries, ([left], [right]) => compilerStringLocaleCompare(left, right));

  const merged: QueryUpdatePlanFact[] = [];
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const [query, queryPlans] = entries[entryIndex]!;
    const paths = stableSort(
      dedupeBy(
        flattenPlanFacts(queryPlans, 'paths', (plan) => plan.paths),
        (path) => path,
      ),
      (left, right) => (left < right ? -1 : left > right ? 1 : 0),
    );
    const outputContexts = flattenPlanFacts(
      queryPlans,
      'outputContexts',
      (plan) => plan.outputContexts,
    );
    const derives = flattenPlanFacts(queryPlans, 'derives', (plan) => plan.derives);
    const stamps = flattenPlanFacts(queryPlans, 'stamps', (plan) => plan.stamps);
    const templateStamps = flattenPlanFacts(
      queryPlans,
      'templateStamps',
      (plan) => plan.templateStamps,
    );
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
    compilerArrayAppend(
      merged,
      result,
      'Compiler packages/compiler/src/compile-result.ts collection',
    );
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
  const coverageSnapshot = compilerSnapshotDenseArray(
    compilerSnapshotJsonValue(coverage, 'Query update coverage'),
    'Query update coverage',
  );
  const styleSnapshot = compilerSnapshotDenseArray(
    compilerSnapshotJsonValue(styleCoverage, 'Style update coverage'),
    'Style update coverage',
  );
  const spanSnapshot = compilerSnapshotDenseArray(
    compilerSnapshotJsonValue(handledSpans, 'Handled source spans'),
    'Handled source spans',
  );
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
    if (fact.status !== 'UNHANDLED' || sourceSpan === undefined || !handled) {
      compilerArrayAppend(
        merged,
        fact,
        'Compiler packages/compiler/src/compile-result.ts collection',
      );
    }
  }
  for (let index = 0; index < styleSnapshot.length; index += 1) {
    compilerArrayAppend(
      merged,
      styleSnapshot[index]!,
      'Compiler packages/compiler/src/compile-result.ts collection',
    );
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

function flattenPlanFacts<Value>(
  plans: readonly QueryUpdatePlanFact[],
  label: string,
  valuesFor: (plan: QueryUpdatePlanFact) => readonly Value[] | undefined,
): Value[] {
  const flattened: Value[] = [];
  const planSnapshot = compilerSnapshotDenseArray(plans, 'Query update plans');
  for (let planIndex = 0; planIndex < planSnapshot.length; planIndex += 1) {
    const values = valuesFor(planSnapshot[planIndex]!);
    if (values === undefined) continue;
    const snapshot = compilerSnapshotDenseArray(values, `Query update plan.${label}`);
    for (let valueIndex = 0; valueIndex < snapshot.length; valueIndex += 1) {
      compilerArrayAppend(
        flattened,
        snapshot[valueIndex]!,
        'Compiler packages/compiler/src/compile-result.ts collection',
      );
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
    outputContexts: snapshotOutputContextFacts(outputContexts, `${label}.outputContexts`),
  };
}

function snapshotOutputContextFacts(value: unknown[], label: string): GeneratedOutputWriteFact[] {
  const source = compilerSnapshotDenseArray(value, label);
  const result: GeneratedOutputWriteFact[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const fact = source[index];
    if (typeof fact !== 'object' || fact === null) {
      throw new TypeError(`${label}[${index}] must be an object.`);
    }
    const factLabel = `${label}[${index}]`;
    const context = compilerOwnDataValue(fact, 'context', factLabel);
    const expression = compilerOwnDataValue(fact, 'expression', factLabel);
    const sink = compilerOwnDataValue(fact, 'sink', factLabel);
    const sourceKind = compilerOwnDataValue(fact, 'source', factLabel);
    const writer = compilerOwnDataValue(fact, 'writer', factLabel);
    if (!isOutputContext(context)) {
      throw new TypeError(`${factLabel}.context is invalid.`);
    }
    if (expression !== undefined && typeof expression !== 'string') {
      throw new TypeError(`${factLabel}.expression must be a string when present.`);
    }
    if (typeof sink !== 'string' || typeof writer !== 'string') {
      throw new TypeError(`${factLabel} must contain string sink and writer facts.`);
    }
    if (!isOutputContextSource(sourceKind)) {
      throw new TypeError(`${factLabel}.source is invalid.`);
    }
    compilerArrayAppend(
      result,
      {
        context,
        ...(expression === undefined ? {} : { expression }),
        sink,
        source: sourceKind,
        writer,
      },
      label,
    );
  }
  return result;
}

function isOutputContext(value: unknown): value is GeneratedOutputWriteFact['context'] {
  return (
    value === 'text' ||
    value === 'attribute' ||
    value === 'boolean-attribute' ||
    value === 'url-attribute' ||
    value === 'style-property' ||
    value === 'css-text' ||
    value === 'html-fragment' ||
    value === 'script-text' ||
    value === 'trusted-html'
  );
}

function isOutputContextSource(value: unknown): value is GeneratedOutputWriteFact['source'] {
  return (
    value === 'client-query' ||
    value === 'client-state' ||
    value === 'server-render' ||
    value === 'style-extraction' ||
    value === 'template-stamp'
  );
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
