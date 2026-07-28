import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DEVEX_BENCHMARK_REPORT_SCHEMA,
  benchmarkScenarioDigest,
  createRunnerFingerprint,
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
const observedEnvironment = {
  ...scenario.environment,
  sourceCommit: scenario.provenance.sourceCommit,
};

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
      observedEnvironment,
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
    expect(report.scenario).toMatchObject({
      name: scenario.name,
      digest: benchmarkScenarioDigest(scenario),
      definition: scenario,
    });
    expect(report.provenance).toEqual({
      sourceCommit: scenario.provenance.sourceCommit,
      packageManager: scenario.environment.packageManager,
      osImage: scenario.environment.osImage,
      packedArtifacts: scenario.provenance.packedArtifacts,
    });
    expect(report.runner).toMatchObject({
      platform: 'linux',
      cpuModel: 'fixture-cpu',
      node: 'v24.0.0',
      packageManager: 'pnpm@10.12.1',
      osImage: scenario.environment.osImage,
    });
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

  it('refuses forged source and packed-artifact provenance before measuring', () => {
    const wrongCommit = structuredClone(scenario);
    wrongCommit.provenance.sourceCommit = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    expect(() =>
      runBenchmarkScenario(wrongCommit, {
        root: fixtureRoot,
        observedEnvironment,
        measure: () => {
          throw new Error('measurement must not start');
        },
      }),
    ).toThrow('does not match scenario.provenance.sourceCommit');

    const wrongArtifact = structuredClone(scenario);
    wrongArtifact.provenance.packedArtifacts[0].sha256 = `sha256:${'0'.repeat(64)}`;
    expect(() =>
      runBenchmarkScenario(wrongArtifact, {
        root: fixtureRoot,
        observedEnvironment,
        measure: () => {
          throw new Error('measurement must not start');
        },
      }),
    ).toThrow('packed artifact digest mismatch');
  });

  it('keeps every provisional budget non-binding before baseline ratification', () => {
    expect(validateBudgets(budgets)).toEqual([]);
    expect(Object.values(budgets.metrics).every((metric) => metric.ratification === null)).toBe(
      true,
    );
    expect(budgets.runner.status).toBe('unratified');
  });

  it('requires at least five statistical samples and validates the runner block', () => {
    const tooFew = structuredClone(budgets);
    tooFew.procedure.minimumStatisticalSamples = 4;
    expect(validateBudgets(tooFew)).toContain(
      'procedure.minimumStatisticalSamples must be at least 5',
    );

    const inventedRunner = structuredClone(budgets);
    inventedRunner.runner.fingerprint = createRunnerFingerprint({
      name: 'not-ratified',
      platform: 'linux',
      arch: 'x64',
      node: 'v24.0.0',
      cpuModel: 'fixture',
      packageManager: 'pnpm@10.12.1',
      osImage:
        'fixture-linux@sha256:1111111111111111111111111111111111111111111111111111111111111111',
    });
    expect(validateBudgets(inventedRunner)).toContain(
      'runner.fingerprint must be null until ratification',
    );
  });

  it('ratifies only from a prior multi-sample baseline plus an explicit target proposal', () => {
    const report = benchmarkReport({
      'check.cold.durationMs': [100, 101, 102, 103, 130],
    });
    const { ratified, validationOptions } = ratifyFixtureBudgets(report, {
      'check.cold.durationMs': {
        budget: 90,
        noiseMultiplier: 3,
        statistic: 'median',
        targetRationale: 'Keep the packed cold check below the measured baseline.',
      },
    });

    expect(ratified.metrics['check.cold.durationMs'].ratification).toMatchObject({
      runnerFingerprint: report.runner,
      baseline: 102,
      sampleCount: 5,
      statistic: 'median',
      budget: 90,
      noise: 1,
      noiseMultiplier: 3,
      threshold: 93,
      baselineReport: {
        path: 'baselines/fixture.json',
        schema: DEVEX_BENCHMARK_REPORT_SCHEMA,
        scenarioName: scenario.name,
        scenarioDigest: benchmarkScenarioDigest(scenario),
      },
    });
    expect(validateBudgets(ratified, validationOptions)).toEqual([]);
  });

  it('rejects ratification records that are not bound to the recorded baseline bytes', () => {
    const report = benchmarkReport({
      'check.cold.durationMs': [100, 101, 102, 103, 104],
    });
    const { ratified, validationOptions } = ratifyFixtureBudgets(report, {
      'check.cold.durationMs': {
        budget: 100,
        noiseMultiplier: 2,
        targetRationale: 'Hold the packed cold check near the measured median.',
      },
    });

    expect(validateBudgets(ratified)).toContain(
      'check.cold.durationMs.ratification baseline report provenance could not be verified: baselines/fixture.json',
    );
    const invented = structuredClone(ratified);
    invented.metrics['check.cold.durationMs'].ratification.baseline = 1;
    expect(validateBudgets(invented, validationOptions)).toContain(
      'check.cold.durationMs.ratification.baseline does not match its baseline report',
    );
    const changedRunner = structuredClone(ratified);
    changedRunner.runner.fingerprint.cpuModel = 'hand-edited';
    expect(validateBudgets(changedRunner, validationOptions)).toEqual(
      expect.arrayContaining([
        'runner.fingerprint.id does not match its OS/platform/CPU/Node/package-manager identity',
        'check.cold.durationMs.ratification runner differs from budgets.runner',
      ]),
    );
  });

  it('refuses to ratify a statistical metric from a single noisy sample', () => {
    const report = benchmarkReport({ 'check.cold.durationMs': [100] });
    const source = baselineOptions(report);
    expect(() =>
      ratifyBudgets(
        budgets,
        report,
        {
          schema: 'kovo-devex-budget-proposal/v2',
          runnerFingerprint: report.runner,
          metrics: {
            'check.cold.durationMs': {
              budget: 90,
              noiseMultiplier: 3,
              targetRationale: 'A target that still needs a real baseline sample set.',
            },
          },
        },
        source.ratificationOptions,
      ),
    ).toThrow('has 1 baseline samples; 5 required');
  });

  it('refuses to ratify or evaluate a differently pinned runner/scenario identity', () => {
    const defaultReport = benchmarkReport({
      'check.cold.durationMs': [100, 101, 102, 103, 104],
    });
    const proposal = {
      schema: 'kovo-devex-budget-proposal/v2',
      runnerFingerprint: defaultReport.runner,
      metrics: {
        'check.cold.durationMs': {
          budget: 100,
          noiseMultiplier: 2,
          targetRationale: 'Hold the packed cold check near the measured median.',
        },
      },
    };
    const anotherRunnerScenario = structuredClone(scenario);
    anotherRunnerScenario.environment.cpuModel = 'different-cpu';
    const anotherRunnerReport = benchmarkReport(
      { 'check.cold.durationMs': [100, 101, 102, 103, 104] },
      { definition: anotherRunnerScenario },
    );
    const anotherSource = baselineOptions(anotherRunnerReport);
    expect(() =>
      ratifyBudgets(budgets, anotherRunnerReport, proposal, anotherSource.ratificationOptions),
    ).toThrow('baseline runner fingerprint does not match proposal.runnerFingerprint');

    const source = baselineOptions(defaultReport);
    const ratified = ratifyBudgets(budgets, defaultReport, proposal, source.ratificationOptions);
    const anotherNodeScenario = structuredClone(scenario);
    anotherNodeScenario.environment.node = 'v25.0.0';
    const evaluation = evaluateBudgets(
      ratified,
      benchmarkReport(
        { 'check.cold.durationMs': [90, 91, 92, 93, 94] },
        { definition: anotherNodeScenario },
      ),
      source.validationOptions,
    );
    expect(evaluation.pass).toBe(false);
    expect(
      evaluation.results.find((result) => result.metric === 'check.cold.durationMs'),
    ).toMatchObject({
      status: 'scenario-mismatch',
      expectedWorkload: expect.objectContaining({
        scenario: expect.objectContaining({ digest: defaultReport.scenario.digest }),
      }),
      actualWorkload: expect.objectContaining({
        scenario: expect.objectContaining({ digest: benchmarkScenarioDigest(anotherNodeScenario) }),
      }),
    });
  });

  it('rejects a cheap scenario on the same runner and forged report provenance', () => {
    const baseline = benchmarkReport({
      'check.cold.durationMs': [100, 101, 102, 103, 104],
    });
    const { ratified, validationOptions } = ratifyFixtureBudgets(baseline, {
      'check.cold.durationMs': {
        budget: 100,
        noiseMultiplier: 2,
        targetRationale: 'Hold the packed cold check near the measured median.',
      },
    });
    const cheapScenario = structuredClone(scenario);
    cheapScenario.phases.cold.command = ['node', '-e', 'void 0'];
    const cheapReport = benchmarkReport(
      { 'check.cold.durationMs': [1, 1, 1, 1, 1] },
      { definition: cheapScenario },
    );
    const cheapEvaluation = evaluateBudgets(ratified, cheapReport, validationOptions);
    expect(cheapEvaluation.pass).toBe(false);
    expect(
      cheapEvaluation.results.find((result) => result.metric === 'check.cold.durationMs'),
    ).toMatchObject({ status: 'scenario-mismatch' });

    const forged = benchmarkReport({
      'check.cold.durationMs': [90, 91, 92, 93, 94],
    });
    forged.provenance.sourceCommit = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    expect(() => evaluateBudgets(ratified, forged, validationOptions)).toThrow(
      'report.provenance does not match its scenario definition',
    );
    const forgedArtifact = benchmarkReport({
      'check.cold.durationMs': [90, 91, 92, 93, 94],
    });
    forgedArtifact.provenance.packedArtifacts[0].sha256 = `sha256:${'f'.repeat(64)}`;
    expect(() => evaluateBudgets(ratified, forgedArtifact, validationOptions)).toThrow(
      'report.provenance does not match its scenario definition',
    );
    const forgedDigest = benchmarkReport({
      'check.cold.durationMs': [90, 91, 92, 93, 94],
    });
    forgedDigest.scenario.digest = `sha256:${'0'.repeat(64)}`;
    expect(() => evaluateBudgets(ratified, forgedDigest, validationOptions)).toThrow(
      'report.scenario.digest does not match its full definition',
    );
  });

  it('gates only ratified metrics and detects a statistically derived breach', () => {
    const report = benchmarkReport({
      'check.cold.durationMs': [100, 101, 102, 103, 104],
    });
    const { ratified, validationOptions } = ratifyFixtureBudgets(report, {
      'check.cold.durationMs': {
        budget: 100,
        noiseMultiplier: 2,
        targetRationale: 'Hold the packed cold check near the measured median.',
      },
    });
    const passing = evaluateBudgets(
      ratified,
      benchmarkReport({ 'check.cold.durationMs': [99, 100, 101, 102, 103] }),
      validationOptions,
    );
    const breach = evaluateBudgets(
      ratified,
      benchmarkReport({ 'check.cold.durationMs': [110, 111, 112, 113, 114] }),
      validationOptions,
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

  it('makes evaluation red when a statistical report has fewer than five samples', () => {
    const report = benchmarkReport({
      'check.cold.durationMs': [100, 101, 102, 103, 104],
    });
    const { ratified, validationOptions } = ratifyFixtureBudgets(report, {
      'check.cold.durationMs': {
        budget: 100,
        noiseMultiplier: 2,
        targetRationale: 'Hold the packed cold check near the measured median.',
      },
    });
    const evaluation = evaluateBudgets(
      ratified,
      benchmarkReport({ 'check.cold.durationMs': [99, 100, 101, 102] }),
      validationOptions,
    );

    expect(evaluation.pass).toBe(false);
    expect(
      evaluation.results.find((result) => result.metric === 'check.cold.durationMs'),
    ).toMatchObject({
      status: 'insufficient-samples',
      actualSamples: 4,
      requiredSamples: 5,
    });
  });
});

function benchmarkReport(metricSamples, options = {}) {
  const definition = structuredClone(options.definition ?? scenario);
  const runnerEnvironment = {
    ...definition.environment,
    ...options.runnerOverrides,
  };
  return {
    schema: DEVEX_BENCHMARK_REPORT_SCHEMA,
    scenario: {
      name: definition.name,
      digest: benchmarkScenarioDigest(definition),
      definition,
    },
    provenance: {
      sourceCommit: definition.provenance.sourceCommit,
      packageManager: definition.environment.packageManager,
      osImage: definition.environment.osImage,
      packedArtifacts: structuredClone(definition.provenance.packedArtifacts),
    },
    runner: createRunnerFingerprint({
      name: runnerEnvironment.runnerName,
      platform: runnerEnvironment.platform,
      arch: runnerEnvironment.arch,
      node: runnerEnvironment.node,
      cpuModel: runnerEnvironment.cpuModel,
      packageManager: runnerEnvironment.packageManager,
      osImage: runnerEnvironment.osImage,
    }),
    sampleCount: Math.max(...Object.values(metricSamples).map((samples) => samples.length)),
    commands: Object.fromEntries(
      ['cold', 'warm', 'oneFileIncremental'].map((phase) => [
        phase,
        {
          command: [...definition.phases[phase].command],
          cwd: definition.phases[phase].cwd ?? '.',
        },
      ]),
    ),
    metrics: Object.fromEntries(
      Object.entries(metricSamples).map(([metric, samples]) => [
        metric,
        { unit: metric.endsWith('Bytes') ? 'bytes' : 'ms', samples },
      ]),
    ),
  };
}

function baselineOptions(report) {
  const baselineReportPath = 'baselines/fixture.json';
  const baselineReportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  return {
    ratificationOptions: { baselineReportPath, baselineReportBytes },
    validationOptions: {
      baselineReports: new Map([[baselineReportPath, baselineReportBytes]]),
    },
  };
}

function ratifyFixtureBudgets(report, metrics) {
  const source = baselineOptions(report);
  return {
    ratified: ratifyBudgets(
      budgets,
      report,
      {
        schema: 'kovo-devex-budget-proposal/v2',
        runnerFingerprint: report.runner,
        metrics,
      },
      source.ratificationOptions,
    ),
    validationOptions: source.validationOptions,
  };
}
