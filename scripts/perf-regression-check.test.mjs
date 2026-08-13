import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  PERF_REGRESSION_SCHEMA,
  canonicalJson,
  comparePerformanceReports,
  hostFingerprintFindings,
  performanceReportFindings,
  workloadIdentityFindings,
} from './perf-regression-check.mjs';

describe('performance regression comparator', () => {
  it('passes only same-subject reports within the reviewed regression ceiling', () => {
    const baseline = reportFixture();
    const candidate = reportFixture({
      durationMs: 104,
      p95Ms: 104,
      requestsPerSecond: 980,
      serverCpuPercent: 104,
    });

    const result = comparePerformanceReports(baseline, candidate);

    expect(result.schema).toBe(PERF_REGRESSION_SCHEMA);
    expect(result.verdict).toEqual({ reasons: [], regressions: [], status: 'pass' });
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: 'lower-is-better',
          metric: 'matched-runtime/server/dynamic.durationMs',
          regressionPct: 4,
          status: 'pass',
        }),
        expect.objectContaining({
          direction: 'higher-is-better',
          metric: 'matched-runtime/server/hit.requestsPerSecond',
          regressionPct: 2,
          status: 'pass',
        }),
        expect.objectContaining({
          direction: 'lower-is-better',
          metric: 'matched-runtime/server/hit.p95Ms',
          regressionPct: 4,
        }),
        expect.objectContaining({
          direction: 'lower-is-better',
          metric: 'matched-runtime/server/hit.serverCpuPercent',
          regressionPct: 4,
        }),
      ]),
    );
  });

  it('reports a measured regression separately from unproven evidence', () => {
    const result = comparePerformanceReports(reportFixture(), reportFixture({ durationMs: 106 }));

    expect(result.verdict.status).toBe('regression');
    expect(result.verdict.reasons).toEqual([]);
    expect(result.verdict.regressions).toContain('matched-runtime/server/dynamic.durationMs');
  });

  it('refuses source, lock, host, workload, and analysis census drift', () => {
    const baseline = reportFixture();
    const candidate = reportFixture();
    candidate.source.commit = 'b'.repeat(40);
    candidate.source.locks['pnpm-lock.yaml'] = digest('different lock');
    candidate.host.cpu.model = 'different CPU';
    candidate.workloadIdentity.identity.policies.browserSamples = 29;
    delete candidate.analysis['matched-runtime/server/hit.requestsPerSecond'];

    const result = comparePerformanceReports(baseline, candidate);

    expect(result.verdict.status).toBe('unproven');
    expect(result.verdict.reasons).toEqual(
      expect.arrayContaining([
        'analysis metric census differs',
        'candidate host digest is not derived from its facts',
        'candidate workload digest is not derived from its facts',
        'dependency lock identity differs',
        'source commit identity differs',
        'workload identity differs',
      ]),
    );
    expect(result.metrics).toEqual([]);
  });

  it('returns unproven for busy, dirty, short, or incomplete reports', () => {
    const report = reportFixture();
    report.source.dirty = true;
    report.source.dirtyPaths = [' M packages/server/src/node.ts'];
    report.hostSamples[0].loadPerCpu = 1.1;
    report.integrity.comparatorMatched = false;
    report.analysis['matched-runtime/server/dynamic.durationMs'].kovo.samples = 4;

    expect(performanceReportFindings(report, 'candidate')).toEqual(
      expect.arrayContaining([
        'candidate source is dirty',
        'candidate integrity.comparatorMatched is not true',
        'candidate host sample 0 exceeds the load ceiling',
        'candidate matched-runtime/server/dynamic.durationMs kovo summary is short or malformed',
      ]),
    );
    expect(comparePerformanceReports(reportFixture(), report).verdict.status).toBe('unproven');
  });

  it('re-derives canonical host and workload digests instead of trusting labels', () => {
    const report = reportFixture();
    expect(hostFingerprintFindings(report.host)).toEqual([]);
    expect(workloadIdentityFindings(report.workloadIdentity)).toEqual([]);

    report.host.totalMemoryBytes += 1;
    report.workloadIdentity.identity.cells.push('invented');
    expect(hostFingerprintFindings(report.host)).toContain(
      'report host digest is not derived from its facts',
    );
    expect(workloadIdentityFindings(report.workloadIdentity)).toContain(
      'report workload digest is not derived from its facts',
    );
  });

  it('treats dev sample declarations as totals and accepts two occurrence-level RSS peaks', () => {
    const report = reportFixture();
    report.workloadIdentity.identity.cells = ['dev'];
    report.workloadIdentity.identity.policies.devEditSamples = 30;
    report.workloadIdentity.identity.policies.devEditSessionSamples = 2;
    report.workloadIdentity.identity.policies.devReadySamples = 15;
    report.workloadIdentity.digest = digest(canonicalJson(report.workloadIdentity.identity));
    report.analysis = {
      'corpus-n24/dev//edit.leafMs': metricFixture(100, 30),
      'corpus-n24/dev//edit.peakRssBytes': metricFixture(1_000, 2),
      'corpus-n24/dev//ready.durationMs': metricFixture(500, 15),
    };

    expect(performanceReportFindings(report, 'candidate')).toEqual([]);
    report.analysis['corpus-n24/dev//edit.leafMs'] = metricFixture(100, 60);
    expect(performanceReportFindings(report, 'candidate')).toContain(
      'candidate corpus-n24/dev//edit.leafMs kovo summary is short or malformed',
    );
  });
});

function reportFixture({
  durationMs = 100,
  p95Ms = 100,
  requestsPerSecond = 1_000,
  serverCpuPercent = 100,
} = {}) {
  const hostFacts = {
    arch: 'arm64',
    browsers: ['chromium 148'],
    cpu: { count: 10, model: 'Fixture CPU' },
    node: 'v24.19.0',
    platform: 'darwin',
    release: '25.2.0',
    runnerImage: null,
    totalMemoryBytes: 16 * 1024 * 1024 * 1024,
  };
  const workloadFacts = {
    adapters: {
      browser: digest('browser'),
      build: digest('build'),
      compare: digest('compare'),
      dev: digest('dev'),
      server: digest('server'),
      serverPrepare: digest('server prepare'),
    },
    cells: ['server'],
    corpus: { kovo: null, nextjs: null },
    lanes: ['matched-runtime'],
    policies: {
      bfcacheIterations: 10,
      browserSamples: 30,
      buildModes: ['clean', 'unchanged', 'edit'],
      corpusSize: 216,
      devEditSamples: 30,
      devReadySamples: 15,
      devWarmups: 3,
      lighthouseRuns: 5,
      server: {
        concurrencies: [1, 8, 32],
        durationMs: 15_000,
        encodings: ['identity', 'br'],
        modes: ['hit', '304', 'dynamic'],
        routes: ['listing', 'detail'],
        samples: 7,
        warmupMs: 5_000,
      },
      warmups: 3,
    },
  };
  return {
    analysis: {
      'matched-runtime/server/dynamic.durationMs': metricFixture(durationMs),
      'matched-runtime/server/hit.p95Ms': metricFixture(p95Ms),
      'matched-runtime/server/hit.requestsPerSecond': metricFixture(requestsPerSecond),
      'matched-runtime/server/hit.serverCpuPercent': metricFixture(serverCpuPercent),
    },
    generatedAt: '2026-08-13T12:00:00.000Z',
    execution: executionFixture(
      `${String(durationMs)}:${String(p95Ms)}:${String(requestsPerSecond)}:${String(serverCpuPercent)}:${String(reportSequence++)}`,
    ),
    host: {
      ...hostFacts,
      digest: digest(canonicalJson(hostFacts)),
      schema: 'kovo-performance-host/v1',
    },
    hostSamples: [
      {
        at: '2026-08-13T12:00:00.000Z',
        ceiling: 1,
        loadAverage: [1, 1, 1],
        loadPerCpu: 0.1,
      },
    ],
    integrity: {
      comparatorMatched: true,
      executionAuthenticated: true,
      publishable: true,
      serialized: true,
      sourceStable: true,
      workloadAuthenticated: true,
    },
    policy: workloadFacts.policies,
    rawCells: [{ cell: 'server' }],
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
}

let reportSequence = 0;

function executionFixture(seed) {
  const facts = {
    complete: true,
    local: { nonce: digest(seed).slice('sha256:'.length, 'sha256:'.length + 32), pid: 42 },
    provider: 'local',
    startedAt: '2026-08-13T12:00:00.000Z',
  };
  return {
    ...facts,
    digest: digest(canonicalJson(facts)),
    schema: 'kovo-performance-execution/v1',
  };
}

function metricFixture(value, samples = 7) {
  return {
    kovo: { mad: 1, median: value, p95: value + 2, samples },
    nextjs: { mad: 1, median: value, p95: value + 2, samples },
    pairedDifference: {
      bootstrap95Ci: [-1, 1],
      direction: 'kovo-minus-nextjs',
      median: 0,
      samples,
    },
  };
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
