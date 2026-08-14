import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ratifyPerformanceBaseline } from './perf-baseline-ratify.mjs';
import {
  PERF_COMPARISON_BUDGET_SCHEMA,
  comparisonBudgetBaselineFindings,
  comparisonBudgetFindings,
  deriveComparisonPerformanceBudget,
  evaluateComparisonPerformanceBudget,
  renderComparisonBudgetMarkdown,
} from './perf-comparison-budget.mjs';
import { canonicalJson } from './perf-regression-check.mjs';

describe('browser/server comparison budgets', () => {
  it('derives directional browser budgets from five linked raw reports', () => {
    const entries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    const baseline = ratifyPerformanceBaseline(entries);

    const budget = deriveComparisonPerformanceBudget(baseline, { baselineEntries: entries });

    expect(budget.schema).toBe(PERF_COMPARISON_BUDGET_SCHEMA);
    expect(comparisonBudgetBaselineFindings(baseline, entries)).toEqual([]);
    expect(comparisonBudgetFindings(budget)).toEqual([]);
    expect(budget.targetAssessment).toMatchObject({ failures: [], status: 'pass' });
    expect(budget.metrics['matched-l1/browser//mobile.navigation.navToPaintMs']).toMatchObject({
      direction: 'lower-is-better',
      kind: 'ratified-regression-ceiling',
    });
    expect(
      budget.metrics['matched-l1/browser//lighthouse.mobile.listing.performanceScore'],
    ).toMatchObject({
      direction: 'higher-is-better',
      kind: 'ratified-regression-floor',
    });
    expect(budget.metrics['matched-l1/browser//bfcache.evidenceComplete']).toMatchObject({
      kind: 'exact-availability-floor',
      minimum: 1,
    });
    expect(budget.metrics['matched-l1/browser//bfcache.restored']).toMatchObject({
      direction: 'higher-is-better',
      kind: 'ratified-regression-floor',
    });
    expect(budget.metrics['matched-l1/browser//bfcache.applicable']).toMatchObject({
      direction: null,
      kind: 'informational',
    });
    const markdown = renderComparisonBudgetMarkdown(budget);
    expect(markdown).toContain('# Ratified browser performance baseline');
    expect(markdown).toContain(entries[0].location);
    expect(markdown).toContain('capability-matched');
    expect(markdown).toContain('same-document navigation');
    expect(markdown).toContain('bfcache.applicable');
  });

  it('evaluates a new same-subject report and enforces the matched L1 navigation target', () => {
    const entries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    const baseline = ratifyPerformanceBaseline(entries);
    const budget = deriveComparisonPerformanceBudget(baseline, { baselineEntries: entries });
    const candidate = reportEntry(5, 'browser').report;

    expect(evaluateComparisonPerformanceBudget(budget, candidate).verdict.status).toBe('pass');
    candidate.analysis['matched-l1/browser//mobile.navigation.navToPaintMs'].kovo.median = 250;
    expect(evaluateComparisonPerformanceBudget(budget, candidate).verdict).toMatchObject({
      status: 'regression',
    });
  });

  it('derives and enforces server throughput targets separately by posture', () => {
    const entries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'server'));
    const baseline = ratifyPerformanceBaseline(entries);
    const budget = deriveComparisonPerformanceBudget(baseline, { baselineEntries: entries });
    const candidate = reportEntry(5, 'server').report;

    expect(comparisonBudgetFindings(budget)).toEqual([]);
    expect(budget.targetAssessment).toMatchObject({ failures: [], status: 'pass' });
    expect(evaluateComparisonPerformanceBudget(budget, candidate).verdict.status).toBe('pass');
    candidate.analysis[
      'matched-runtime/server/dynamic-listing-identity-c1/requestsPerSecond'
    ].kovo.median = 70;
    expect(evaluateComparisonPerformanceBudget(budget, candidate).verdict.failures).toContain(
      'matched-runtime/server/dynamic-listing-identity-c1/requestsPerSecond.median-vs-next',
    );
  });

  it('refuses derivation when a downloaded report no longer matches its ratified digest', () => {
    const entries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    const baseline = ratifyPerformanceBaseline(entries);
    entries[0] = { ...entries[0], rawText: `${entries[0].rawText} ` };

    expect(() => deriveComparisonPerformanceBudget(baseline, { baselineEntries: entries })).toThrow(
      'does not match its ratified content/link identity',
    );
  });
});

function reportEntry(index, subject) {
  const runId = String(5001 + index);
  const source = {
    commit: 'd'.repeat(40),
    dirty: false,
    dirtyPaths: [],
    locks: {
      'benchmarks/harness/pnpm-lock.yaml': digest('harness lock'),
      'benchmarks/nextjs/pnpm-lock.yaml': digest('next lock'),
      'pnpm-lock.yaml': digest('root lock'),
    },
  };
  const hostFacts = {
    arch: 'x64',
    browsers: subject === 'browser' ? ['chromium 148'] : [],
    cpu: { count: 4, model: 'Fixture CPU' },
    memoryCapacityClassBytes: 16 * 1024 ** 3,
    node: 'v24.19.0',
    platform: 'linux',
    release: '6.11.0',
    runnerImage: 'github-actions/ubuntu-24.04 ImageVersionDigest=sha256:fixture',
  };
  const policies =
    subject === 'browser'
      ? {
          bfcacheIterations: 10,
          browserSamples: 30,
          buildSamples: 30,
          corpusSize: 24,
          devEditSamples: 30,
          devReadySamples: 15,
          lighthouseRuns: 5,
          server: { samples: 7 },
        }
      : {
          bfcacheIterations: 10,
          browserSamples: 30,
          buildSamples: 30,
          corpusSize: 24,
          devEditSamples: 30,
          devReadySamples: 15,
          lighthouseRuns: 5,
          server: { samples: 7 },
        };
  const workloadFacts = {
    adapters: { compare: 'kovo-next-performance-comparison/v1' },
    cells: [subject],
    corpus: {},
    lanes: subject === 'browser' ? ['default', 'matched-l0', 'matched-l1'] : ['matched-runtime'],
    policies,
  };
  const github = {
    eventSha: 'd'.repeat(40),
    job: `${subject}-matrix`,
    repository: 'kovojs/kovo',
    runAttempt: '1',
    runId,
    runUrl: `https://github.com/kovojs/kovo/actions/runs/${runId}`,
    serverUrl: 'https://github.com',
    sha: 'd'.repeat(40),
    workflowRef: `kovojs/kovo/.github/workflows/perf-realistic.yml@${'d'.repeat(40)}`,
  };
  const executionFacts = {
    complete: true,
    github,
    provider: 'github-actions',
    startedAt: `2026-08-14T00:00:${String(index).padStart(2, '0')}.000Z`,
  };
  const analysis =
    subject === 'browser'
      ? {
          'matched-l1/browser//bfcache.applicable': booleanMetric(0, 1, 10),
          'matched-l1/browser//bfcache.evidenceComplete': booleanMetric(1, 1, 10),
          'matched-l1/browser//bfcache.restored': booleanMetric(1, 0, 10),
          'matched-l1/browser//lighthouse.mobile.listing.lcpMs': metric(200 + index, 300, 5),
          'matched-l1/browser//lighthouse.mobile.listing.performanceScore': metric(0.9, 0.8, 5),
          'matched-l1/browser//mobile.navigation.navToPaintMs': metric(100 + index, 120, 30),
        }
      : {
          'matched-runtime/server/dynamic-listing-identity-c1/p95Ms': metric(
            10 + index / 10,
            12,
            7,
          ),
          'matched-runtime/server/dynamic-listing-identity-c1/requestsPerSecond': metric(
            95 + index,
            100,
            7,
          ),
          'matched-runtime/server/hit-listing-br-c1/requestsPerSecond': metric(120 + index, 125, 7),
        };
  const report = {
    analysis,
    execution: {
      ...executionFacts,
      digest: digest(canonicalJson(executionFacts)),
      schema: 'kovo-performance-execution/v1',
    },
    generatedAt: executionFacts.startedAt,
    host: {
      ...hostFacts,
      digest: digest(canonicalJson(hostFacts)),
      schema: 'kovo-performance-host/v2',
      totalMemoryBytes: 16 * 1024 ** 3,
    },
    hostSamples: [{ ceiling: 1, loadAverage: [0.2, 0.2, 0.2], loadPerCpu: 0.05 }],
    integrity: {
      comparatorMatched: true,
      executionAuthenticated: true,
      publishable: true,
      serialized: true,
      sourceStable: true,
      workloadAuthenticated: true,
    },
    schema: 'kovo-next-performance-comparison/v1',
    source,
    verdict: { reasons: [], status: 'measured' },
    workloadIdentity: {
      complete: true,
      digest: digest(canonicalJson(workloadFacts)),
      identity: workloadFacts,
      schema: 'kovo-performance-workload-identity/v1',
    },
  };
  const rawText = `${JSON.stringify(report)}\n`;
  return {
    contentDigest: digest(rawText),
    location: `https://github.com/kovojs/kovo/actions/runs/${runId}/artifacts/${String(6001 + index)}`,
    rawText,
    report,
  };
}

function metric(kovo, nextjs, samples) {
  return {
    kovo: { mad: 1, median: kovo, p95: kovo + 1, samples },
    nextjs: { mad: 1, median: nextjs, p95: nextjs + 1, samples },
    pairedDifference: {
      bootstrap95Ci: [kovo - nextjs - 1, kovo - nextjs + 1],
      direction: 'kovo-minus-nextjs',
      median: kovo - nextjs,
      samples,
    },
  };
}

function booleanMetric(kovo, nextjs, samples) {
  return {
    kovo: { mad: 0, median: kovo, p95: kovo, samples },
    nextjs: { mad: 0, median: nextjs, p95: nextjs, samples },
    pairedDifference: {
      bootstrap95Ci: [kovo - nextjs, kovo - nextjs],
      direction: 'kovo-minus-nextjs',
      median: kovo - nextjs,
      samples,
    },
  };
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
