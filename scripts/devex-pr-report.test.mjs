import { describe, expect, it } from 'vitest';

import { benchmarkWorkloadContractIdentity } from './devex-benchmark.mjs';
import {
  DEVEX_PR_REPORT_SCHEMA,
  buildDevexPrReport,
  renderDevexPrReport,
  speedDeltas,
} from './devex-pr-report.mjs';

const budgets = {
  metrics: {
    'check.cold.durationMs': { provisionalTarget: 30_000 },
    'check.warm.durationMs': { provisionalTarget: 10_000 },
    'docs.snapshot.compressedBytes': {
      ratification: { threshold: 1_310_720 },
    },
    'docs.snapshot.installedBytes': {
      ratification: { threshold: 5_242_880 },
    },
  },
};

describe('DevEx PR report', () => {
  it('publishes bounded surface, current-docs, and baseline speed evidence', () => {
    const report = buildDevexPrReport({
      baselineBenchmark: benchmark([100, 110, 120, 130, 140]),
      budgets,
      currentBenchmark: benchmark([110]),
      freshDocs: docs(),
      installedDocs: docs().snapshot,
      inventory: inventory(),
    });
    const markdown = renderDevexPrReport(report);

    expect(report.schema).toBe(DEVEX_PR_REPORT_SCHEMA);
    expect(report.pass).toBe(true);
    expect(report.docs.status).toBe('current');
    expect(report.docs.budgetStatus).toBe('pass');
    expect(report.speed).toMatchObject({
      status: 'reported',
      comparison: 'nightly-candidate',
      baselineSampleCount: 5,
      currentSampleCount: 1,
    });
    expect(report.speed.metrics[0]).toMatchObject({
      metric: 'check.cold.durationMs',
      current: 110,
      delta: -10,
    });
    expect(markdown).toContain('## Kovo DevEx scorecard');
    expect(markdown).toContain('1,842 declarations');
    expect(markdown).toContain('current/pass');
    expect(markdown).toContain('-8.3%');
    expect(markdown.length).toBeLessThan(8_000);
  });

  it('fails closed for stale installed docs or inventory findings', () => {
    const installed = structuredClone(docs().snapshot);
    installed.snapshotDigest = `sha256:${'f'.repeat(64)}`;
    const stale = buildDevexPrReport({
      budgets,
      currentBenchmark: null,
      freshDocs: docs(),
      installedDocs: installed,
      inventory: inventory(['manifest export cannot be analyzed']),
    });

    expect(stale.pass).toBe(false);
    expect(stale.docs.status).toBe('stale');
    expect(stale.speed).toMatchObject({
      status: 'unavailable',
      comparison: 'none',
    });
  });

  it('fails closed when the current packed docs payload exceeds its ratified cap', () => {
    const tinyDocsBudget = structuredClone(budgets);
    tinyDocsBudget.metrics['docs.snapshot.compressedBytes'].ratification.threshold = 1;
    const report = buildDevexPrReport({
      budgets: tinyDocsBudget,
      currentBenchmark: benchmark([100]),
      freshDocs: docs(),
      installedDocs: docs().snapshot,
      inventory: inventory(),
    });

    expect(report.pass).toBe(false);
    expect(report.docs.budgetStatus).toBe('breach');
    expect(report.docs.budgets).toContainEqual({
      metric: 'docs.snapshot.compressedBytes',
      observed: 25,
      status: 'breach',
      threshold: 1,
    });
  });

  it('labels provisional-target deltas as non-binding when no baseline is available', () => {
    const speed = speedDeltas(benchmark([28_000]), null, budgets);
    expect(speed).toMatchObject({
      status: 'reported',
      comparison: 'provisional-target',
    });
    expect(speed.reason).toContain('non-binding provisional targets');
    expect(speed.metrics[0]).toMatchObject({
      reference: { kind: 'provisional-target', value: 30_000 },
      delta: -2_000,
    });
  });

  it('uses the metric-owned statistic for PR deltas', () => {
    const p95Budgets = structuredClone(budgets);
    p95Budgets.metrics['check.cold.durationMs'].statistic = 'p95';
    const speed = speedDeltas(
      benchmark([110, 200]),
      benchmark([100, 110, 120, 130, 140]),
      p95Budgets,
    );

    expect(speed.metrics[0]).toMatchObject({
      current: 200,
      statistic: 'p95',
      reference: { value: 140 },
    });
  });

  it('labels a baseline binding only for the exact ratified runner and workload identity', () => {
    const baseline = benchmark([100, 110, 120, 130, 140]);
    baseline.scenario = {
      name: 'kovo-packed-check',
      digest: `sha256:${'e'.repeat(64)}`,
      definition: {
        name: 'kovo-packed-check',
        profile: {
          id: 'kovo-packed-check/v3',
          commandDigest: `sha256:${'1'.repeat(64)}`,
        },
        provenance: {
          producerAttestation: {
            schema: 'fixture',
            producer: 'fixture',
            consumer: 'fixture',
            releasePackages: [],
            profileCommandDigest: `sha256:${'1'.repeat(64)}`,
            browserBuildCommandDigest: `sha256:${'2'.repeat(64)}`,
          },
          supportFiles: [],
        },
      },
    };
    baseline.provenance = { sourceCommit: 'f'.repeat(40) };
    const ratified = {
      ...budgets,
      procedure: { minimumBaselineStatisticalSamples: 5 },
      runner: { status: 'ratified', fingerprint: baseline.runner },
      workload: {
        status: 'ratified',
        identity: benchmarkWorkloadContractIdentity(baseline),
      },
    };
    const current = benchmark([105]);
    current.scenario = structuredClone(baseline.scenario);
    current.provenance = structuredClone(baseline.provenance);

    expect(speedDeltas(current, baseline, ratified).comparison).toBe('ratified-baseline');
    ratified.runner = {
      status: 'ratified',
      fingerprint: { id: `sha256:${'a'.repeat(64)}` },
    };
    const mismatched = speedDeltas(current, baseline, ratified);
    expect(mismatched.comparison).toBe('nightly-candidate');
    expect(mismatched.reason).toContain('exact runner-and-workload');
  });
});

function inventory(findings = []) {
  return {
    findings,
    summary: {
      manifestPublicSubpaths: 1_839,
      analyzedTypeScriptEntrypoints: 102,
      exportedDeclarations: 1_842,
      generatedFamilyMembers: 1_737,
      consumerFiles: {},
      excludedDirectories: 45,
    },
  };
}

function docs() {
  const snapshot = {
    files: [
      { bytes: 20, path: 'spec.md' },
      { bytes: 30, path: 'llms.txt' },
    ],
    publicManifestDigest: `sha256:${'a'.repeat(64)}`,
    schema: 'kovo.agent-docs-snapshot/v1',
    snapshotDigest: `sha256:${'b'.repeat(64)}`,
    sourceCommit: 'c'.repeat(40),
    version: '0.2.0',
  };
  return { compressed: Buffer.alloc(25), snapshot };
}

function benchmark(coldSamples) {
  return {
    schema: 'kovo-devex-benchmark-report/v5',
    runner: { id: `sha256:${'d'.repeat(64)}` },
    sampleCount: coldSamples.length,
    metrics: {
      'check.cold.durationMs': {
        unit: 'ms',
        samples: coldSamples,
      },
      'check.warm.durationMs': {
        unit: 'ms',
        samples: coldSamples.map((sample) => sample / 2),
      },
    },
  };
}
