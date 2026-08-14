import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { performanceExecutionIdentity } from './lib/perf-execution.mjs';
import { performanceHostFingerprint } from './lib/perf-host.mjs';
import { ratifyPerformanceBaseline } from './perf-baseline-ratify.mjs';
import {
  PERF_BUILD_BUDGET_SCHEMA,
  PERF_BUILD_EVALUATION_SCHEMA,
  buildBudgetBaselineFindings,
  buildBudgetFindings,
  deriveBuildPerformanceBudget,
  evaluateBuildPerformanceBudget,
} from './perf-build-budget.mjs';
import {
  KOVO_BUILD_PHASE_ATTRIBUTION_SCHEMA,
  KOVO_BUILD_SOURCE_PHASES,
  KOVO_BUILD_WORKER_PHASES,
} from './perf-build-benchmark.mjs';
import { canonicalJson } from './perf-regression-check.mjs';

const BUILD_MODES = ['clean', 'unchanged', 'edit'];

describe('ratified production-build performance budgets', () => {
  it.each([24, 216])(
    'derives all N=%s mode/metric ceilings and evaluates a distinct clean source commit',
    (corpusSize) => {
      const { baseline, entries } = ratifiedBuildBaseline(corpusSize);
      const budget = deriveBuildPerformanceBudget(baseline, { baselineEntries: entries });
      const candidate = comparisonReport({ corpusSize, run: 7, sourceCommit: 'b'.repeat(40) });
      const result = evaluateBuildPerformanceBudget(budget, candidate);
      const wall = metricKey(corpusSize, 'clean', 'durationMs');

      expect(buildBudgetBaselineFindings(baseline, entries)).toEqual([]);
      expect(budget).toMatchObject({
        policy: {
          maxRegressionPct: 5,
          targets: {
            peakRssMedianVsNextMaximumRatio: 2,
            wallMedianVsNextMaximumRatio: 6,
          },
        },
        schema: PERF_BUILD_BUDGET_SCHEMA,
        subject: { corpusSize },
      });
      expect(Object.keys(budget.metrics)).toHaveLength(9);
      expect(budget.metrics[wall]).toMatchObject({
        baseline: {
          median: 502,
          nextMedian: 102,
          nextP95: 122,
          pairedMedian: 400,
          p95: 522,
          runs: 5,
        },
        p95Maximum: 548.1,
      });
      expect(budget.metrics[wall].medianMaximum).toBeCloseTo(527.1);
      expect(buildBudgetFindings(budget)).toEqual([]);
      expect(
        deriveBuildPerformanceBudget(baseline, { baselineEntries: [...entries].reverse() }).digest,
      ).toBe(budget.digest);
      expect(result.schema).toBe(PERF_BUILD_EVALUATION_SCHEMA);
      expect(result.candidate.sourceCommit).toBe('b'.repeat(40));
      expect(result.verdict).toEqual({ failures: [], reasons: [], status: 'pass' });
      expect(result.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: `${wall}.median`, status: 'pass' }),
          expect.objectContaining({ id: `${wall}.p95`, status: 'pass' }),
          expect.objectContaining({
            id: `corpus-n${String(corpusSize)}/build/clean/durationMs.median-vs-next`,
            limit: 6,
            status: 'pass',
          }),
          expect.objectContaining({
            id: `corpus-n${String(corpusSize)}/build/clean/peakRssBytes.median-vs-next`,
            limit: 2,
            status: 'pass',
          }),
        ]),
      );
    },
  );

  it('reports wall median/p95, RSS, artifact, and milestone regressions independently', () => {
    const { baseline, entries } = ratifiedBuildBaseline(24);
    const budget = deriveBuildPerformanceBudget(baseline, { baselineEntries: entries });
    const candidate = comparisonReport({ corpusSize: 24, run: 8, sourceCommit: 'b'.repeat(40) });
    const wall = metricKey(24, 'clean', 'durationMs');
    const rss = metricKey(24, 'clean', 'peakRssBytes');
    const artifact = metricKey(24, 'edit', 'artifactBytes');
    candidate.analysis[wall].kovo.median = 528;
    candidate.analysis[wall].kovo.p95 = 549;
    candidate.analysis[rss].kovo.median = 220;
    candidate.analysis[rss].kovo.p95 = 230;
    candidate.analysis[artifact].kovo.p95 = 1_100;

    const result = evaluateBuildPerformanceBudget(budget, candidate);

    expect(result.verdict.status).toBe('regression');
    expect(result.verdict.reasons).toEqual([]);
    expect(result.verdict.failures).toEqual(
      expect.arrayContaining([
        `${wall}.median`,
        `${wall}.p95`,
        `${rss}.median`,
        `${rss}.p95`,
        `${artifact}.p95`,
        'corpus-n24/build/clean/peakRssBytes.median-vs-next',
      ]),
    );
  });

  it('fails closed on lock drift, missing phase census, or forged CLI/startup subtraction', () => {
    const { baseline, entries } = ratifiedBuildBaseline(24);
    const budget = deriveBuildPerformanceBudget(baseline, { baselineEntries: entries });
    const candidate = comparisonReport({ corpusSize: 24, run: 9, sourceCommit: 'b'.repeat(40) });
    candidate.source.locks['pnpm-lock.yaml'] = digest('drift');
    const firstKovo = candidate.rawCells.find(({ framework }) => framework === 'kovo');
    firstKovo.report.samples[0].phaseCensus.source.phases.pop();
    firstKovo.report.samples[1].phaseAttribution.cliStartupTail.durationMs = 0;

    const result = evaluateBuildPerformanceBudget(budget, candidate);

    expect(result.verdict.status).toBe('unproven');
    expect(result.verdict.reasons).toEqual(
      expect.arrayContaining([
        'candidate dependency lock identity differs from the ratified budget',
        'candidate Kovo build clean source-check census is incomplete',
        'candidate Kovo build clean CLI/startup residual is not derived from the authenticated envelope',
      ]),
    );
    expect(result.checks).toEqual([]);

    budget.metrics[metricKey(24, 'clean', 'durationMs')].medianMaximum = 1_000_000;
    expect(buildBudgetFindings(budget)).toContain('budget digest is not derived from its facts');
  });

  it('refuses short, unlinked, or metric-tampered baseline evidence', () => {
    const { baseline, entries } = ratifiedBuildBaseline(24);
    expect(() => deriveBuildPerformanceBudget(baseline)).toThrow(
      /baseline raw build reports are unavailable/u,
    );

    entries[0].rawText = `${entries[0].rawText} `;
    expect(() => deriveBuildPerformanceBudget(baseline, { baselineEntries: entries })).toThrow(
      /does not match its ratified content\/link identity/u,
    );

    const restored = ratifiedBuildBaseline(24);
    restored.baseline.metrics[metricKey(24, 'clean', 'durationMs')].kovo.median += 1;
    expect(() =>
      deriveBuildPerformanceBudget(restored.baseline, { baselineEntries: restored.entries }),
    ).toThrow(/baseline metrics is not reproduced by its linked raw reports/u);
  });

  it('derives through the CLI from local downloads linked to durable artifact URLs', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'kovo-build-budget-cli-'));
    try {
      const { baseline, entries } = ratifiedBuildBaseline(24, { durableLocations: true });
      const baselinePath = path.join(root, 'baseline.json');
      const outputPath = path.join(root, 'budget.json');
      writeFileSync(baselinePath, `${JSON.stringify(baseline)}\n`);
      const reportPaths = entries.map((entry, index) => {
        const reportPath = path.join(root, `download-${String(index)}.json`);
        writeFileSync(reportPath, entry.rawText);
        return reportPath;
      });
      const script = fileURLToPath(new URL('./perf-build-budget.mjs', import.meta.url));
      const result = spawnSync(
        process.execPath,
        [
          script,
          'derive',
          '--baseline',
          baselinePath,
          ...reportPaths.flatMap((reportPath) => ['--report', reportPath]),
          '--out',
          outputPath,
        ],
        { encoding: 'utf8' },
      );

      expect(result).toMatchObject({ status: 0, stderr: '' });
      const budget = JSON.parse(readFileSync(outputPath, 'utf8'));
      expect(budget.schema).toBe(PERF_BUILD_BUDGET_SCHEMA);
      expect(budget.baseline.reports.map(({ location }) => location)).toEqual(
        baseline.reports.map(({ location }) => location),
      );
      expect(budget.baseline.reports.every(({ location }) => location.startsWith('https://'))).toBe(
        true,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

function ratifiedBuildBaseline(corpusSize, { durableLocations = false } = {}) {
  const entries = Array.from({ length: 5 }, (_, run) => {
    const report = comparisonReport({ corpusSize, run, sourceCommit: 'a'.repeat(40) });
    const rawText = JSON.stringify(report);
    return {
      contentDigest: digest(rawText),
      location: durableLocations
        ? `https://github.com/kovojs/kovo/actions/runs/${String(corpusSize)}${String(run + 1)}/artifacts/${String(corpusSize)}${String(run + 101)}`
        : `artifacts/build-n${String(corpusSize)}-run-${String(run)}/comparison.json`,
      rawText,
      report,
    };
  });
  const baseline = ratifyPerformanceBaseline(entries);
  expect(baseline.verdict.status).toBe('ratified');
  return { baseline, entries };
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
      GITHUB_JOB: 'build-performance',
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
  for (const mode of BUILD_MODES) {
    analysis[metricKey(corpusSize, mode, 'durationMs')] = metricSummary(500 + run, 100 + run);
    analysis[metricKey(corpusSize, mode, 'peakRssBytes')] = metricSummary(180 + run, 100 + run);
    analysis[metricKey(corpusSize, mode, 'artifactBytes')] = metricSummary(1_000 + run, 900 + run);
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
    rawCells: rawBuildCells(corpusSize, {
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
  return {
    adapters: {
      build: 'kovo-build-benchmark/v1',
      compare: 'kovo-next-performance-comparison/v1',
    },
    cells: ['build'],
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
      buildModes: BUILD_MODES,
      buildSamples: 10,
      corpusSize,
      devEditSamples: 30,
      devReadySamples: 15,
      devWarmups: 3,
      lighthouseRuns: 5,
      server: { samples: 7 },
      warmups: 3,
    },
  };
}

function rawBuildCells(corpusSize, { locks, shapeDigest, sourceCommit }) {
  return BUILD_MODES.flatMap((mode) =>
    buildSchedule().map(({ framework, occurrence, samples, warmups }) => ({
      cell: 'build',
      framework,
      lane: `corpus-n${String(corpusSize)}`,
      mode,
      occurrence,
      report: buildReport({
        framework,
        locks,
        mode,
        samples,
        shapeDigest,
        sourceCommit,
        warmups,
      }),
    })),
  );
}

function buildReport({ framework, locks, mode, samples, shapeDigest, sourceCommit, warmups }) {
  const observed = Array.from({ length: samples }, (_, iteration) => {
    const durationMs = framework === 'kovo' ? 500 + iteration : 100 + iteration;
    return {
      artifactBytes: framework === 'kovo' ? 1_000 : 900,
      corpus: { afterDigest: digest('corpus'), beforeDigest: digest('corpus'), stable: true },
      durationMs,
      exitCode: 0,
      loadAverage: 0.1,
      outputCensus: { complete: true, totalBytes: framework === 'kovo' ? 1_000 : 900 },
      peakRssBytes: framework === 'kovo' ? 180 : 100,
      ...(framework === 'kovo'
        ? kovoPhaseEvidence(durationMs)
        : { phaseAttribution: null, phaseCensus: null }),
    };
  });
  const source = { commit: sourceCommit, dirty: false, dirtyPaths: [], locks };
  return {
    corpus: { shapeDigest },
    framework,
    integrity: {
      complete: true,
      corpus: { stable: true },
      errors: [],
      iterations: samples,
      misses: 0,
      source: { stable: true },
      warmups,
    },
    mode,
    samples: observed,
    schema: 'kovo-build-benchmark/v1',
    source,
    sourceAfter: structuredClone(source),
  };
}

function kovoPhaseEvidence(durationMs) {
  const workerDuration = durationMs / 5;
  const totalWorkerMs = workerDuration * 4;
  const phaseCensus = {
    source: {
      checkGraphDigest: digest('check-graph'),
      complete: true,
      phases: KOVO_BUILD_SOURCE_PHASES.map((name) => ({
        durationMs: 1,
        name,
        status: 'executed',
      })),
      schema: 'kovo-build-source-phase-census/v1',
      source: {
        codeUnitLength: 100,
        contentHash: digest('source'),
        encoding: 'utf16le',
        path: 'src/app.tsx',
      },
      sourceSetDigest: digest('source-set'),
    },
    workers: {
      complete: true,
      phases: KOVO_BUILD_WORKER_PHASES.map((name) => ({
        durationMs: workerDuration,
        name,
        status: 0,
      })),
      schema: 'kovo-build-worker-phase-census/v1',
      sourcePath: 'src/app.tsx',
      totalWorkerMs,
    },
  };
  return {
    phaseAttribution: {
      cliStartupTail: {
        durationMs: durationMs - totalWorkerMs,
        source: {
          envelope: 'kovo-build-worker-phase-census/v1.totalWorkerMs',
          operation: 'wall-minus-sequential-worker-envelope',
          wall: 'measureProcessTreeCommand.durationMs',
        },
        status: 'measured-residual',
      },
      complete: true,
      errors: [],
      phaseEnvelope: {
        durationMs: totalWorkerMs,
        phases: KOVO_BUILD_WORKER_PHASES,
        source: 'kovo-build-worker-phase-census/v1.totalWorkerMs',
        status: 'authenticated-sequential',
      },
      schema: KOVO_BUILD_PHASE_ATTRIBUTION_SCHEMA,
      sourceCheck: {
        nestedWithin: 'analyze',
        phases: KOVO_BUILD_SOURCE_PHASES,
        source: 'kovo-build-source-phase-census/v1',
        status: 'authenticated-nested',
      },
      wallDurationMs: durationMs,
    },
    phaseCensus,
  };
}

function buildSchedule() {
  return [
    { framework: 'kovo', occurrence: 0, samples: 5, warmups: 2 },
    { framework: 'nextjs', occurrence: 0, samples: 5, warmups: 2 },
    { framework: 'nextjs', occurrence: 1, samples: 5, warmups: 1 },
    { framework: 'kovo', occurrence: 1, samples: 5, warmups: 1 },
  ];
}

function metricSummary(kovo, nextjs) {
  return {
    kovo: { mad: 1, median: kovo, p95: kovo + 20, samples: 10 },
    nextjs: { mad: 1, median: nextjs, p95: nextjs + 20, samples: 10 },
    pairedDifference: {
      bootstrap95Ci: [kovo - nextjs - 1, kovo - nextjs + 1],
      direction: 'kovo-minus-nextjs',
      median: kovo - nextjs,
      samples: 10,
    },
  };
}

function metricKey(corpusSize, mode, suffix) {
  return `corpus-n${String(corpusSize)}/build/${mode}/${suffix}`;
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
