// @kovo-security-classifier-corpus finite-security-operation-ir
import { describe, expect, it } from 'vitest';

import { evaluateAnalyzableFragment, loadAnalyzableFragmentInput } from './analyzable-fragment.mjs';

const baseline = loadAnalyzableFragmentInput();

describe('SPEC §6.6 analyzable-fragment generated ledger', () => {
  // @kovo-security-certifies C13 analyzable-fragment-artifact-drift
  it('binds nine prohibitions, eight closed reasons, four budgets, fixtures, and generated SPEC', () => {
    expect(evaluateAnalyzableFragment(baseline)).toMatchObject({
      findings: [],
      ok: true,
      summary: {
        budgets: 4,
        closedReasons: 8,
        prohibitions: 9,
        realRoots: 29,
      },
    });
  });

  it('kills omission, classification, closed-reason, fixture, budget, and SPEC-table drift', () => {
    const omitted = structuredClone(baseline.document);
    omitted.prohibitions.pop();
    expect(evaluateAnalyzableFragment({ ...baseline, document: omitted }).ok).toBe(false);

    const reclassified = structuredClone(baseline.document);
    reclassified.prohibitions[0].classification = 'BUDGETED';
    expect(evaluateAnalyzableFragment({ ...baseline, document: reclassified }).ok).toBe(false);

    const relabelled = structuredClone(baseline.document);
    relabelled.prohibitions[0].closedReason = 'helper-cycle';
    expect(evaluateAnalyzableFragment({ ...baseline, document: relabelled }).ok).toBe(false);

    const missingFixture = new Map(baseline.witnessSources);
    missingFixture.delete(baseline.document.prohibitions[0].witness.file);
    expect(evaluateAnalyzableFragment({ ...baseline, witnessSources: missingFixture }).ok).toBe(
      false,
    );

    const widenedBudget = structuredClone(baseline.document);
    widenedBudget.budgetBindingMeasurement.budgets[0].limit += 1;
    expect(evaluateAnalyzableFragment({ ...baseline, document: widenedBudget }).ok).toBe(false);

    const staleSpec = baseline.specMarkdown.replace('Returning authority', 'Returning capability');
    expect(evaluateAnalyzableFragment({ ...baseline, specMarkdown: staleSpec }).ok).toBe(false);
  });
});
