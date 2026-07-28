import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DEVEX_BENCHMARK_REPORT_SCHEMA,
  evaluateBudgets,
  median,
  medianAbsoluteDeviation,
  percentile,
  ratifyBudgets,
  runBenchmarkScenario,
  validateBudgets,
} from './devex-benchmark.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const fixtureRoot = fileURLToPath(new URL('./fixtures/devex-benchmark/', import.meta.url));
const scenario = JSON.parse(readFileSync(path.join(fixtureRoot, 'scenario.json'), 'utf8'));
const budgets = JSON.parse(readFileSync(path.join(repoRoot, 'devex-budgets.json'), 'utf8'));

describe('DevEx benchmark foundation', () => {
  it('computes the registered robust statistics deterministically', () => {
    expect(median([9, 1, 5, 3, 7])).toBe(5);
    expect(median([1, 3, 5, 7])).toBe(4);
    expect(percentile([1, 2, 3, 4, 100], 0.95)).toBe(100);
    expect(medianAbsoluteDeviation([8, 9, 10, 11, 40])).toBe(1);
  });

  it('records cold, warm, one-file, RSS, and browser-byte metrics as separate units', () => {
    const phaseValues = {
      cold: { durationMs: 30, peakRssBytes: 3000 },
      warm: { durationMs: 10, peakRssBytes: 2000 },
      oneFileIncremental: { durationMs: 2, peakRssBytes: 1000 },
    };
    const report = runBenchmarkScenario(scenario, {
      root: fixtureRoot,
      samples: 5,
      measure(_command, context) {
        const base = phaseValues[context.phase];
        return {
          ...base,
          durationMs: base.durationMs + context.sampleIndex,
          peakRssBytes: base.peakRssBytes + context.sampleIndex,
          exitCode: 0,
          signal: null,
          error: null,
        };
      },
    });

    expect(report.schema).toBe(DEVEX_BENCHMARK_REPORT_SCHEMA);
    expect(report.metrics['check.cold.durationMs'].samples).toEqual([30, 31, 32, 33, 34]);
    expect(report.metrics['check.warm.peakRssBytes'].summary).toMatchObject({
      count: 5,
      median: 2002,
      medianAbsoluteDeviation: 1,
    });
    expect(report.metrics['check.oneFileIncremental.durationMs'].summary.median).toBe(4);
    expect(report.metrics['browser.bootstrapBytes']).toEqual({
      unit: 'bytes',
      samples: [49],
      summary: {
        count: 1,
        min: 49,
        median: 49,
        p95: 49,
        max: 49,
        medianAbsoluteDeviation: 0,
      },
      files: [
        { path: 'bootstrap-a.mjs', bytes: 27 },
        { path: 'bootstrap-b.css', bytes: 22 },
      ],
    });
  });

  it('keeps every provisional budget non-binding before baseline ratification', () => {
    expect(validateBudgets(budgets)).toEqual([]);
    expect(Object.values(budgets.metrics).every((metric) => metric.ratification === null)).toBe(
      true,
    );
    expect(budgets.runner.status).toBe('unratified');
  });

  it('ratifies only from a prior multi-sample baseline plus an explicit target proposal', () => {
    const report = benchmarkReport({
      'check.cold.durationMs': [100, 101, 102, 103, 130],
    });
    const ratified = ratifyBudgets(budgets, report, {
      schema: 'kovo-devex-budget-proposal/v1',
      runner: 'pinned-linux-x64',
      metrics: {
        'check.cold.durationMs': {
          budget: 90,
          noiseMultiplier: 3,
          statistic: 'median',
          targetRationale: 'Keep the packed cold check below the measured baseline.',
        },
      },
    });

    expect(ratified.metrics['check.cold.durationMs'].ratification).toMatchObject({
      runner: 'pinned-linux-x64',
      baseline: 102,
      sampleCount: 5,
      statistic: 'median',
      budget: 90,
      noise: 1,
      noiseMultiplier: 3,
      threshold: 93,
    });
    expect(validateBudgets(ratified)).toEqual([]);
  });

  it('refuses to ratify a statistical metric from a single noisy sample', () => {
    expect(() =>
      ratifyBudgets(budgets, benchmarkReport({ 'check.cold.durationMs': [100] }), {
        schema: 'kovo-devex-budget-proposal/v1',
        runner: 'pinned-linux-x64',
        metrics: {
          'check.cold.durationMs': {
            budget: 90,
            noiseMultiplier: 3,
            targetRationale: 'A target that still needs a real baseline sample set.',
          },
        },
      }),
    ).toThrow('has 1 baseline samples; 5 required');
  });

  it('refuses to ratify or evaluate measurements from a differently named runner', () => {
    const proposal = {
      schema: 'kovo-devex-budget-proposal/v1',
      runner: 'pinned-linux-x64',
      metrics: {
        'check.cold.durationMs': {
          budget: 100,
          noiseMultiplier: 2,
          targetRationale: 'Hold the packed cold check near the measured median.',
        },
      },
    };
    expect(() =>
      ratifyBudgets(
        budgets,
        benchmarkReport({ 'check.cold.durationMs': [100, 101, 102, 103, 104] }, 'another-runner'),
        proposal,
      ),
    ).toThrow('does not match proposal runner');

    const ratified = ratifyBudgets(
      budgets,
      benchmarkReport({ 'check.cold.durationMs': [100, 101, 102, 103, 104] }),
      proposal,
    );
    const evaluation = evaluateBudgets(
      ratified,
      benchmarkReport({ 'check.cold.durationMs': [90, 91, 92, 93, 94] }, 'another-runner'),
    );
    expect(evaluation.pass).toBe(false);
    expect(
      evaluation.results.find((result) => result.metric === 'check.cold.durationMs'),
    ).toMatchObject({
      status: 'runner-mismatch',
      expectedRunner: 'pinned-linux-x64',
      actualRunner: 'another-runner',
    });
  });

  it('gates only ratified metrics and detects a statistically derived breach', () => {
    const ratified = ratifyBudgets(
      budgets,
      benchmarkReport({ 'check.cold.durationMs': [100, 101, 102, 103, 104] }),
      {
        schema: 'kovo-devex-budget-proposal/v1',
        runner: 'pinned-linux-x64',
        metrics: {
          'check.cold.durationMs': {
            budget: 100,
            noiseMultiplier: 2,
            targetRationale: 'Hold the packed cold check near the measured median.',
          },
        },
      },
    );
    const passing = evaluateBudgets(
      ratified,
      benchmarkReport({ 'check.cold.durationMs': [99, 100, 101, 102, 103] }),
    );
    const breach = evaluateBudgets(
      ratified,
      benchmarkReport({ 'check.cold.durationMs': [110, 111, 112, 113, 114] }),
    );

    expect(passing.pass).toBe(true);
    expect(
      passing.results.find((result) => result.metric === 'browser.bootstrapBytes')?.status,
    ).toBe('unratified');
    expect(breach.pass).toBe(false);
    expect(
      breach.results.find((result) => result.metric === 'check.cold.durationMs'),
    ).toMatchObject({ status: 'breach', observed: 112, threshold: 102 });
  });
});

function benchmarkReport(metricSamples, runnerName = 'pinned-linux-x64') {
  return {
    schema: DEVEX_BENCHMARK_REPORT_SCHEMA,
    scenario: 'fixture',
    runner: {
      name: runnerName,
      platform: 'linux',
      arch: 'x64',
      node: 'v24.0.0',
      cpuModel: 'fixture',
    },
    metrics: Object.fromEntries(
      Object.entries(metricSamples).map(([metric, samples]) => [
        metric,
        { unit: metric.endsWith('Bytes') ? 'bytes' : 'ms', samples },
      ]),
    ),
  };
}
