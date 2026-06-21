import type { GeneratedOutputWriteFact } from './output-context-facts.js';
import type { SourceSpan } from './scan/parse.js';
import type { QueryUpdateCoverageFact, QueryUpdatePlanFact } from './types.js';

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
  const byQuery = new Map<string, QueryUpdatePlanFact[]>();
  for (const plan of plans) {
    byQuery.set(plan.query, [...(byQuery.get(plan.query) ?? []), plan]);
  }

  return [...byQuery.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([query, queryPlans]) => ({
      componentName: queryPlans[0]?.componentName ?? 'Component',
      query,
      paths: [...new Set(queryPlans.flatMap((plan) => plan.paths))].sort(),
      ...(queryPlans.some((plan) => (plan.outputContexts?.length ?? 0) > 0)
        ? {
            outputContexts: dedupeOutputContextFacts(
              queryPlans.flatMap((plan) => [...(plan.outputContexts ?? [])]),
            ),
          }
        : {}),
      ...(queryPlans.some((plan) => (plan.derives?.length ?? 0) > 0)
        ? {
            derives: dedupeByKey(
              queryPlans.flatMap((plan) => [...(plan.derives ?? [])]),
              (derive) => derive.exportName,
            ).sort((left, right) => left.name.localeCompare(right.name)),
          }
        : {}),
      ...(queryPlans.some((plan) => (plan.stamps?.length ?? 0) > 0)
        ? {
            stamps: dedupeByKey(
              queryPlans.flatMap((plan) => [...(plan.stamps ?? [])]),
              (stamp) => `${stamp.attr}\0${stamp.selector}\0${stamp.derive.exportName}`,
            ).sort((left, right) => left.attr.localeCompare(right.attr)),
          }
        : {}),
      ...(queryPlans.some((plan) => (plan.templateStamps?.length ?? 0) > 0)
        ? {
            templateStamps: dedupeByKey(
              queryPlans.flatMap((plan) => [...(plan.templateStamps ?? [])]),
              (stamp) => `${stamp.key}\0${stamp.selector}\0${stamp.list}`,
            ).sort((left, right) => left.list.localeCompare(right.list)),
          }
        : {}),
    }));
}

/** @internal Dedupe generated output-context facts by full structural identity. */
export function dedupeOutputContextFacts(
  facts: readonly GeneratedOutputWriteFact[],
): GeneratedOutputWriteFact[] {
  return dedupeByKey(facts, (fact) => JSON.stringify(fact));
}

/** @internal Fold style-extraction coverage over the base coverage, dropping base UNHANDLED facts the style pass owns. */
export function mergeStyleUpdateCoverage(
  coverage: readonly QueryUpdateCoverageFact[],
  styleCoverage: readonly QueryUpdateCoverageFact[],
  handledSpans: readonly SourceSpan[],
): QueryUpdateCoverageFact[] {
  if (styleCoverage.length === 0) return [...coverage];

  return [
    ...coverage.filter((fact) => {
      const sourceSpan = fact.sourceSpan;
      return (
        fact.status !== 'UNHANDLED' ||
        !sourceSpan ||
        !handledSpans.some((span) => containsSourceSpan(span, sourceSpan))
      );
    }),
    ...styleCoverage,
  ];
}

function containsSourceSpan(outer: SourceSpan, inner: { length: number; start: number }): boolean {
  return inner.start >= outer.start && inner.start + inner.length <= outer.end;
}

/** @internal Stable first-wins dedupe by a derived string key. */
export function dedupeByKey<Value>(
  values: readonly Value[],
  keyFor: (value: Value) => string,
): Value[] {
  const seen = new Set<string>();
  const deduped: Value[] = [];
  for (const value of values) {
    const key = keyFor(value);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }
  return deduped;
}
