import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { PERF_BASELINE_SCHEMA, ratifyPerformanceBaseline } from './perf-baseline-ratify.mjs';
import { canonicalJson } from './perf-regression-check.mjs';

describe('performance baseline ratification', () => {
  it('ratifies five independent, linked reports for one exact subject', () => {
    const entries = [100, 102, 104, 106, 108].map((durationMs, index) =>
      entryFixture(index, durationMs),
    );

    const result = ratifyPerformanceBaseline(entries, { requireProvider: 'any' });

    expect(result.schema).toBe(PERF_BASELINE_SCHEMA);
    expect(result.verdict).toEqual({ reasons: [], status: 'ratified' });
    expect(result.metrics['matched-runtime/server/dynamic.durationMs'].kovo).toEqual({
      mad: 2,
      median: 104,
      p95: 108,
      runs: 5,
      sampleP95: {
        mad: 2,
        median: 106,
        p95: 110,
        runs: 5,
      },
    });
    expect(result.subject).toMatchObject({
      host: { digest: result.identity.host },
      locks: result.identity.locks,
      sourceCommit: result.identity.source,
      workloadIdentity: { digest: result.identity.workload },
    });
    expect(result.reports).toHaveLength(5);
  });

  it('rejects short, duplicate, or identity-drifted evidence', () => {
    const entries = [100, 102, 104, 106].map((durationMs, index) =>
      entryFixture(index, durationMs),
    );
    entries.push(entries[0]);
    entries[1].report.source.commit = 'b'.repeat(40);

    const result = ratifyPerformanceBaseline(entries, { requireProvider: 'any' });

    expect(result.verdict.status).toBe('unproven');
    expect(result.verdict.reasons).toEqual(
      expect.arrayContaining([
        'duplicate execution identity',
        'duplicate report content',
        'duplicate report location',
        'source commit differs across reports',
      ]),
    );
    expect(result.metrics).toEqual({});
  });

  it('requires five reports and the configured execution provider', () => {
    const result = ratifyPerformanceBaseline([entryFixture(0, 100)], {
      requireProvider: 'github-actions',
    });
    expect(result.verdict.status).toBe('unproven');
    expect(result.verdict.reasons).toEqual(
      expect.arrayContaining([
        'received 1 reports; policy requires 5',
        'report[0] execution provider is local, expected github-actions',
      ]),
    );
  });
});

function entryFixture(index, durationMs) {
  const hostFacts = {
    arch: 'arm64',
    browsers: [],
    cpu: { count: 10, model: 'Fixture CPU' },
    node: 'v24.19.0',
    platform: 'darwin',
    release: '25.2.0',
    runnerImage: 'fixture-runner@sha256:one',
    totalMemoryBytes: 16 * 1024 * 1024 * 1024,
  };
  const workloadFacts = {
    adapters: { server: 'kovo-server-benchmark/v1' },
    cells: ['server'],
    corpus: {},
    lanes: ['matched-runtime'],
    policies: {
      browserSamples: 30,
      server: { samples: 7 },
    },
  };
  const executionFacts = {
    complete: true,
    local: {
      nonce: createHash('sha256').update(String(index)).digest('hex').slice(0, 32),
      pid: 42,
    },
    provider: 'local',
    startedAt: `2026-08-13T12:00:0${String(index)}.000Z`,
  };
  const report = {
    analysis: {
      'matched-runtime/server/dynamic.durationMs': metricFixture(durationMs),
    },
    execution: {
      ...executionFacts,
      digest: digest(canonicalJson(executionFacts)),
      schema: 'kovo-performance-execution/v1',
    },
    generatedAt: executionFacts.startedAt,
    host: {
      ...hostFacts,
      digest: digest(canonicalJson(hostFacts)),
      schema: 'kovo-performance-host/v1',
    },
    hostSamples: [{ ceiling: 1, loadPerCpu: 0.1 }],
    integrity: {
      comparatorMatched: true,
      executionAuthenticated: true,
      publishable: true,
      serialized: true,
      sourceStable: true,
      workloadAuthenticated: true,
    },
    schema: 'kovo-next-performance-comparison/v1',
    source: {
      commit: 'a'.repeat(40),
      dirty: false,
      dirtyPaths: [],
      locks: {
        'benchmarks/harness/pnpm-lock.yaml': digest('harness lock'),
        'benchmarks/nextjs/pnpm-lock.yaml': digest('next lock'),
        'pnpm-lock.yaml': digest('root lock'),
      },
    },
    verdict: { reasons: [], status: 'measured' },
    workloadIdentity: {
      complete: true,
      digest: digest(canonicalJson(workloadFacts)),
      identity: workloadFacts,
      schema: 'kovo-performance-workload-identity/v1',
    },
  };
  const text = JSON.stringify(report);
  return {
    contentDigest: digest(text),
    location: `artifacts/run-${String(index)}/comparison.json`,
    report,
  };
}

function metricFixture(value) {
  return {
    kovo: { mad: 1, median: value, p95: value + 2, samples: 7 },
    nextjs: { mad: 1, median: value + 10, p95: value + 12, samples: 7 },
    pairedDifference: {
      bootstrap95Ci: [-12, -8],
      direction: 'kovo-minus-nextjs',
      median: -10,
      samples: 7,
    },
  };
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
