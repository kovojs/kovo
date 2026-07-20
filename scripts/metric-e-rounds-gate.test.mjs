import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildMetricERound,
  buildMetricESeries,
  defaultEscapeCensusBaselinePath,
  defaultMetricERoundsPath,
  validateMetricESeries,
} from './metric-e-rounds-gate.mjs';
import { repoRoot } from './lib/repo-root.mjs';
import { canonicalJson, sha256 } from './lib/security-evidence-subject.mjs';

const root = repoRoot();
const baseline = JSON.parse(readFileSync(`${root}/${defaultEscapeCensusBaselinePath}`, 'utf8'));

const reviewEvidencePaths = [
  'scripts/escape-census-baseline.test.mjs',
  'scripts/escape-census-gate.test.mjs',
  'scripts/metric-e-rounds-gate.test.mjs',
];

function round(number, codeSubjectSha, predecessor = null, previousRound) {
  return buildMetricERound({
    baseline,
    codeSubjectSha,
    date: `2026-07-${String(19 + number).padStart(2, '0')}`,
    number,
    predecessor,
    previousRound,
    reviewEvidencePath: reviewEvidencePaths[number - 1],
    reviewedAt: `2026-07-${String(19 + number).padStart(2, '0')}T12:00:00Z`,
    reviewer: `independent-reviewer-${number}`,
  });
}

function predecessor(value) {
  return {
    codeSubjectSha: value.codeSubjectSha,
    reportSha256: value.report.sha256,
    round: value.number,
  };
}

describe('Metric E comparable-round series', () => {
  it('records the current baseline honestly as round one with two future rounds remaining', () => {
    const document = JSON.parse(readFileSync(`${root}/${defaultMetricERoundsPath}`, 'utf8'));
    expect(validateMetricESeries(document, { baseline })).toEqual({
      findings: [],
      ok: true,
      summary: { completed: 1, remaining: 2, required: 3 },
    });
    expect(document).toMatchObject({
      rounds: [
        {
          number: 1,
          predecessor: null,
          result: { ceilingIncreases: 0, observedIncreases: 0, unsignedEscapes: 0 },
          reviewer: { independence: 'independent-review-pass' },
        },
      ],
      status: {
        completedComparableRounds: 1,
        remainingComparableRounds: 2,
        requiredComparableRounds: 3,
        verdict: 'waiting-for-independent-comparable-rounds',
      },
    });
  });

  it('accepts three distinct chained rounds with distinct retained review evidence', () => {
    const first = round(1, '1'.repeat(40));
    const second = round(2, '2'.repeat(40), predecessor(first), first);
    const third = round(3, '3'.repeat(40), predecessor(second), second);
    const document = buildMetricESeries({ rounds: [first, second, third] });
    expect(validateMetricESeries(document, { baseline })).toMatchObject({
      findings: [],
      ok: true,
      summary: { completed: 3, remaining: 0, required: 3 },
    });
  });

  it('rejects reused subjects, broken predecessors, ceiling raises, unsigned roots, and digest drift', () => {
    const first = round(1, '1'.repeat(40));
    const second = round(2, '2'.repeat(40), predecessor(first), first);
    const base = buildMetricESeries({ rounds: [first, second] });
    for (const mutate of [
      (document) => (document.rounds[1].codeSubjectSha = document.rounds[0].codeSubjectSha),
      (document) => (document.rounds[1].predecessor.reportSha256 = '0'.repeat(64)),
      (document) =>
        (document.rounds[1].ceilings.snapshot.packages[
          '@kovojs/security-metric-e-app'
        ].trustedHtml += 1),
      (document) => (document.rounds[1].result.unsignedEscapes = 1),
      (document) => (document.rounds[1].report.sha256 = '0'.repeat(64)),
    ]) {
      const mutant = structuredClone(base);
      mutate(mutant);
      expect(validateMetricESeries(mutant, { baseline }).ok).toBe(false);
    }
  });

  it('rejects an observed root-count increase below an unchanged ceiling', () => {
    const first = structuredClone(round(1, '1'.repeat(40)));
    const packageReport = first.report.snapshot.packages[0];
    packageReport.doors.trustedHtml = 0;
    packageReport.roots.trustedHtml = [];
    first.report.sha256 = sha256(canonicalJson(first.report.snapshot));
    const second = round(2, '2'.repeat(40), predecessor(first), first);
    const document = buildMetricESeries({ rounds: [first, second] });
    expect(validateMetricESeries(document, { baseline }).findings).toContain(
      'Metric E round 2 increases observed @kovojs/security-metric-e-app/trustedHtml escaped roots',
    );
  });

  it('rejects a silent corpus, door-vocabulary, counting-rule, or status change', () => {
    const first = round(1, '1'.repeat(40));
    const base = buildMetricESeries({ rounds: [first] });
    for (const mutate of [
      (document) => (document.series.comparability.censusSchema = 'v2'),
      (document) => document.series.comparability.doorVocabulary.values.pop(),
      (document) => (document.series.comparability.countingRule.id = 'new-rule'),
      (document) => (document.status.remainingComparableRounds = 0),
      (document) => (document.subjectProtocol.evidenceCommit = 'embedded self hash'),
    ]) {
      const mutant = structuredClone(base);
      mutate(mutant);
      expect(validateMetricESeries(mutant, { baseline }).ok).toBe(false);
    }
  });
});
