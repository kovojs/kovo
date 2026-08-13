import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { performanceExecutionIdentity } from './lib/perf-execution.mjs';
import { performanceHostFingerprint } from './lib/perf-host.mjs';
import { ratifyPerformanceBaseline } from './perf-baseline-ratify.mjs';
import {
  PERF_DEV_BUDGET_SCHEMA,
  PERF_DEV_EVALUATION_SCHEMA,
  deriveDevPerformanceBudget,
  devBudgetBaselineFindings,
  devBudgetFindings,
  evaluateDevPerformanceBudget,
} from './perf-dev-budget.mjs';
import { canonicalJson } from './perf-regression-check.mjs';

const EDIT_CLASSES = ['leaf', 'entry', 'data', 'syntaxError', 'recovery'];
const PERFORMANCE_SUFFIXES = [
  'edit.leafMs',
  'edit.entryMs',
  'edit.syntaxErrorMs',
  'edit.recoveryMs',
  'edit.peakRssBytes',
  'ready.durationMs',
  'ready.peakRssBytes',
];
const AVAILABILITY_SUFFIXES = [
  ...EDIT_CLASSES.map((editClass) => `edit.${editClass}StateSurvived`),
  'edit.sampleAvailable',
  'edit.syntaxErrorDiagnosticAvailable',
  'ready.successAvailable',
];

describe('ratified developer performance budgets', () => {
  it.each([24, 216])(
    'derives data-backed N=%s ceilings and evaluates a distinct clean source commit',
    (corpusSize) => {
      const baseline = ratifiedBaseline(corpusSize);
      const budget = deriveDevPerformanceBudget(baseline);
      const candidate = comparisonReport({ corpusSize, run: 5, sourceCommit: 'b'.repeat(40) });
      const result = evaluateDevPerformanceBudget(budget, candidate);
      const leaf = metricKey(corpusSize, 'edit.leafMs');

      expect(devBudgetBaselineFindings(baseline)).toEqual([]);
      expect(budget).toMatchObject({
        policy: {
          maxRegressionPct: 5,
          targets: {
            entryMedianVsNextMaximumRatio: 3,
            leafMedianVsNextMaximumRatio: 2,
            readyMedianVsNextMaximumRatio: 2,
            recoveryP95MaximumMs: 2_000,
            syntaxErrorP95MaximumMs: 1_000,
          },
        },
        schema: PERF_DEV_BUDGET_SCHEMA,
        subject: { corpusSize },
      });
      expect(budget.metrics[leaf]).toMatchObject({
        baseline: { median: 102, p95: 112, runs: 5 },
        p95Maximum: 117.60000000000001,
      });
      expect(budget.metrics[leaf].medianMaximum).toBeCloseTo(107.1);
      expect(devBudgetFindings(budget)).toEqual([]);
      expect(result.schema).toBe(PERF_DEV_EVALUATION_SCHEMA);
      expect(result.candidate.sourceCommit).toBe('b'.repeat(40));
      expect(result.verdict).toEqual({ failures: [], reasons: [], status: 'pass' });
      expect(result.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: `${leaf}.median`, status: 'pass' }),
          expect.objectContaining({
            id: `${metricKey(corpusSize, 'edit.syntaxErrorMs')}.p95-target`,
            limit: 1_000,
            status: 'pass',
          }),
          expect.objectContaining({
            id: `${metricKey(corpusSize, 'edit.recoveryMs')}.p95-target`,
            limit: 2_000,
            status: 'pass',
          }),
        ]),
      );
    },
  );

  it('reports latency, p95, RSS, and plan-target regressions independently', () => {
    const baseline = ratifiedBaseline(24);
    const budget = deriveDevPerformanceBudget(baseline);
    const candidate = comparisonReport({ corpusSize: 24, run: 30, sourceCommit: 'b'.repeat(40) });
    candidate.analysis[metricKey(24, 'edit.leafMs')].kovo.median = 108;
    candidate.analysis[metricKey(24, 'edit.leafMs')].kovo.p95 = 119;
    candidate.analysis[metricKey(24, 'edit.peakRssBytes')].kovo.p95 = 1_200;
    candidate.analysis[metricKey(24, 'edit.syntaxErrorMs')].kovo.p95 = 1_001;
    candidate.analysis[metricKey(24, 'edit.recoveryMs')].kovo.p95 = 2_001;

    const result = evaluateDevPerformanceBudget(budget, candidate);

    expect(result.verdict.status).toBe('regression');
    expect(result.verdict.reasons).toEqual([]);
    expect(result.verdict.failures).toEqual(
      expect.arrayContaining([
        `${metricKey(24, 'edit.leafMs')}.median`,
        `${metricKey(24, 'edit.leafMs')}.p95`,
        `${metricKey(24, 'edit.peakRssBytes')}.p95`,
        `${metricKey(24, 'edit.syntaxErrorMs')}.p95-target`,
        `${metricKey(24, 'edit.recoveryMs')}.p95-target`,
      ]),
    );
  });

  it('fails closed on tampering, identity drift, or raw state/diagnostic loss', () => {
    const baseline = ratifiedBaseline(24);
    const budget = deriveDevPerformanceBudget(baseline);
    const candidate = comparisonReport({ corpusSize: 24, run: 40, sourceCommit: 'b'.repeat(40) });
    candidate.source.locks['pnpm-lock.yaml'] = digest('drift');
    candidate.rawCells[0].report.samples[0].leafStateSurvived = false;
    candidate.rawCells[0].report.samples[0].syntaxErrorDiagnosticSignal = '';

    const result = evaluateDevPerformanceBudget(budget, candidate);

    expect(result.verdict.status).toBe('unproven');
    expect(result.verdict.reasons).toEqual(
      expect.arrayContaining([
        'candidate dependency lock identity differs from the ratified budget',
        'candidate kovo leaf state survival is incomplete',
        'candidate kovo syntax-error diagnostic availability is incomplete',
      ]),
    );
    expect(result.checks).toEqual([]);

    budget.metrics[metricKey(24, 'edit.leafMs')].medianMaximum = 1_000_000;
    expect(devBudgetFindings(budget)).toContain('budget digest is not derived from its facts');
  });

  it('refuses to derive ceilings from short or incomplete baseline evidence', () => {
    const baseline = ratifiedBaseline(24);
    baseline.verdict.status = 'unproven';
    delete baseline.metrics[metricKey(24, 'ready.peakRssBytes')];

    expect(() => deriveDevPerformanceBudget(baseline)).toThrow(
      /ready\.peakRssBytes[\s\S]*baseline verdict is not ratified/u,
    );
  });
});

function ratifiedBaseline(corpusSize) {
  const entries = Array.from({ length: 5 }, (_, run) => {
    const report = comparisonReport({ corpusSize, run, sourceCommit: 'a'.repeat(40) });
    return {
      contentDigest: digest(JSON.stringify(report)),
      location: `artifacts/dev-n${String(corpusSize)}-run-${String(run)}/comparison.json`,
      report,
    };
  });
  const baseline = ratifyPerformanceBaseline(entries);
  expect(baseline.verdict.status).toBe('ratified');
  return baseline;
}

function comparisonReport({ corpusSize, run, sourceCommit }) {
  const host = performanceHostFingerprint({ runnerImage: 'ubuntu-24.04@sha256:fixture' });
  const workloadFacts = workloadIdentity(corpusSize);
  const workload = {
    complete: true,
    digest: digest(canonicalJson(workloadFacts)),
    identity: workloadFacts,
    schema: 'kovo-performance-workload-identity/v1',
  };
  const locks = {
    'benchmarks/harness/pnpm-lock.yaml': digest('harness-lock'),
    'benchmarks/nextjs/pnpm-lock.yaml': digest('next-lock'),
    'pnpm-lock.yaml': digest('root-lock'),
  };
  const execution = performanceExecutionIdentity({
    env: {
      GITHUB_JOB: 'dev-performance',
      GITHUB_REPOSITORY: 'kovojs/kovo',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_RUN_ID: `${String(corpusSize)}${String(run).padStart(3, '0')}`,
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_SHA: sourceCommit,
      GITHUB_WORKFLOW_REF: `kovojs/kovo/.github/workflows/perf-realistic.yml@${sourceCommit}`,
    },
    startedAt: `2026-08-13T12:00:${String(run).padStart(2, '0')}.000Z`,
  });
  const analysis = {};
  const values = {
    'edit.entryMs': [150 + run, 75 + run],
    'edit.leafMs': [100 + run, 75 + run],
    'edit.peakRssBytes': [1_000 + run, 900 + run],
    'edit.recoveryMs': [800 + run, 700 + run],
    'edit.syntaxErrorMs': [500 + run, 400 + run],
    'ready.durationMs': [100 + run, 80 + run],
    'ready.peakRssBytes': [1_100 + run, 1_000 + run],
  };
  for (const suffix of PERFORMANCE_SUFFIXES) {
    const samples = suffix === 'edit.peakRssBytes' ? 2 : suffix.startsWith('ready.') ? 15 : 30;
    analysis[metricKey(corpusSize, suffix)] = metricSummary(...values[suffix], samples);
  }
  for (const suffix of AVAILABILITY_SUFFIXES) {
    const samples = suffix.startsWith('ready.') ? 15 : 30;
    analysis[metricKey(corpusSize, suffix)] = metricSummary(1, 1, samples, { p95Offset: 0 });
  }
  return {
    analysis,
    execution,
    generatedAt: execution.startedAt,
    host,
    hostSamples: [{ ceiling: 1, loadAverage: [1, 1, 1], loadPerCpu: 0.1 }],
    integrity: {
      comparatorMatched: true,
      executionAuthenticated: true,
      publishable: true,
      serialized: true,
      sourceStable: true,
      workloadAuthenticated: true,
    },
    policy: workloadFacts.policies,
    rawCells: rawDevCells(corpusSize, {
      locks,
      shapeDigest: workloadFacts.corpus.kovo.shapeDigest.slice('sha256:'.length),
      sourceCommit,
    }),
    schema: 'kovo-next-performance-comparison/v1',
    source: { commit: sourceCommit, dirty: false, dirtyPaths: [], locks },
    verdict: { reasons: [], status: 'measured' },
    workloadIdentity: workload,
  };
}

function workloadIdentity(corpusSize) {
  const shapeDigest = digest(`shape-${String(corpusSize)}`);
  const schedule = devSchedule();
  return {
    adapters: { compare: 'kovo-next-performance-comparison/v1', dev: 'kovo-dev-loop-report/v1' },
    cells: ['dev'],
    corpus: {
      kovo: {
        manifestDigest: digest(`kovo-manifest-${String(corpusSize)}`),
        shapeDigest,
        sourceDigest: digest(`kovo-source-${String(corpusSize)}`),
      },
      nextjs: {
        manifestDigest: digest(`next-manifest-${String(corpusSize)}`),
        shapeDigest,
        sourceDigest: digest(`next-source-${String(corpusSize)}`),
      },
    },
    lanes: ['default', 'matched-l0', 'matched-l1'],
    policies: {
      bfcacheIterations: 10,
      browserSamples: 30,
      buildModes: ['clean', 'unchanged', 'edit'],
      corpusSize,
      devEditSamples: 30,
      devEditSessionSamples: 2,
      devOccurrenceSchedule: schedule,
      devReadySamples: 15,
      devWarmups: 3,
      lighthouseRuns: 5,
      server: { samples: 7 },
      warmups: 3,
    },
  };
}

function rawDevCells(corpusSize, { locks, shapeDigest, sourceCommit }) {
  return devSchedule().map((schedule) => {
    const samples = Array.from({ length: schedule.editSamples }, (_, iteration) => ({
      dataMs: 100,
      dataStateSurvived: true,
      entryMs: 100,
      entryStateSurvived: true,
      iteration,
      leafMs: 100,
      leafStateSurvived: true,
      recoveryMs: 100,
      recoveryStateSurvived: true,
      syntaxErrorDiagnosticSignal: 'overlay:parse error',
      syntaxErrorMs: 100,
      syntaxErrorStateSurvived: true,
    }));
    const readySamples = Array.from({ length: schedule.readySamples }, (_, iteration) => ({
      durationMs: 100,
      iteration,
      peakRssBytes: 1_000,
      rssSamples: 10,
      success: true,
    }));
    return {
      cell: 'dev',
      framework: schedule.framework,
      lane: `corpus-n${String(corpusSize)}`,
      occurrence: schedule.occurrence,
      report: {
        corpus: { shapeDigest },
        editSession: { peakRssBytes: 1_000, rssSamples: 10 },
        framework: schedule.framework,
        integrity: {
          browser: { requestFailedCount: 0, responseCount: 10, unexpectedErrorCount: 0 },
          complete: true,
          editCounts: Object.fromEntries(
            EDIT_CLASSES.map((editClass) => [editClass, schedule.editSamples]),
          ),
          iterations: schedule.editSamples,
          misses: 0,
          readyIterations: schedule.readySamples,
          source: { stable: true },
          warmups: schedule.warmups,
        },
        readySamples,
        samples,
        source: { commit: sourceCommit, dirty: false, dirtyPaths: [], locks },
        sourceAfter: { commit: sourceCommit, dirty: false, dirtyPaths: [], locks },
        verdict: { status: 'measured' },
      },
      schedule,
    };
  });
}

function devSchedule() {
  return [
    scheduleEntry('kovo', 0, 0, 15, 8, 2),
    scheduleEntry('nextjs', 0, 1, 15, 8, 2),
    scheduleEntry('nextjs', 1, 2, 15, 7, 1),
    scheduleEntry('kovo', 1, 3, 15, 7, 1),
  ];
}

function scheduleEntry(framework, occurrence, scheduleIndex, editSamples, readySamples, warmups) {
  return { editSamples, framework, occurrence, readySamples, scheduleIndex, warmups };
}

function metricSummary(kovo, nextjs, samples, { p95Offset = 10 } = {}) {
  return {
    kovo: { mad: 1, median: kovo, p95: kovo + p95Offset, samples },
    nextjs: { mad: 1, median: nextjs, p95: nextjs + p95Offset, samples },
    pairedDifference: {
      bootstrap95Ci: [kovo - nextjs - 1, kovo - nextjs + 1],
      direction: 'kovo-minus-nextjs',
      median: kovo - nextjs,
      samples,
    },
  };
}

function metricKey(corpusSize, suffix) {
  return `corpus-n${String(corpusSize)}/dev//${suffix}`;
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
