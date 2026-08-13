import { describe, expect, it, vi } from 'vitest';

import { performanceHostFingerprint } from './lib/perf-host.mjs';
import {
  PROVED_DOCUMENT_COMPRESSION_CACHE_DISABLE_ENV,
  serverConditionKey,
  serverConditionPath,
} from './perf-server-benchmark.mjs';
import {
  analyzeCompressedCacheSamples,
  COMPRESSED_CACHE_AB_ORDER,
  compressedCacheArmEnvironment,
  compressedCacheSampleSchedule,
  evaluateCompressedCacheAcceptance,
  runCompressedCacheAb,
} from './perf-compressed-cache-ab.mjs';

const digest = (character) => `sha256:${character.repeat(64).slice(0, 64)}`;

describe('compressed proved-document cache A/B runner', () => {
  it('uses B,S,S,B with seven occurrences per arm and an exact disable-only environment', () => {
    const schedule = compressedCacheSampleSchedule(7);
    expect(schedule).toHaveLength(14);
    expect(schedule.map((entry) => entry.arm)).toEqual([
      'baseline',
      'spike',
      'spike',
      'baseline',
      'baseline',
      'spike',
      'spike',
      'baseline',
      'baseline',
      'spike',
      'spike',
      'baseline',
      'baseline',
      'spike',
    ]);
    expect(COMPRESSED_CACHE_AB_ORDER).toEqual(['baseline', 'spike', 'spike', 'baseline']);
    expect(
      schedule.filter((entry) => entry.arm === 'baseline').map((entry) => entry.occurrence),
    ).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const baseline = compressedCacheArmEnvironment('baseline', {
      [PROVED_DOCUMENT_COMPRESSION_CACHE_DISABLE_ENV]: 'unexpected',
      SAFE: 'yes',
    });
    const spike = compressedCacheArmEnvironment('spike', baseline);
    expect(baseline).toMatchObject({
      [PROVED_DOCUMENT_COMPRESSION_CACHE_DISABLE_ENV]: '1',
      SAFE: 'yes',
    });
    expect(spike).toEqual({ SAFE: 'yes' });
  });

  it('reports paired medians, MAD/p95, bootstrap CI, CPU, and RSS', () => {
    const condition = conditionFixture();
    const rawSamples = [];
    for (let occurrence = 0; occurrence < 3; occurrence += 1) {
      rawSamples.push(
        rawCell('baseline', occurrence, condition, sampleFixture('baseline', occurrence)),
        rawCell('spike', occurrence, condition, sampleFixture('spike', occurrence)),
      );
    }
    const analysis = analyzeCompressedCacheSamples(rawSamples, {
      bootstrapIterations: 1_000,
      seed: 42,
    });
    expect(analysis[condition.key].metrics.requestsPerSecond).toMatchObject({
      baseline: { mad: 1, median: 101, p95: 102, samples: 3 },
      pairedImprovement: {
        bootstrap95Ci: [25, 25],
        direction: 'positive-favors-cache-enabled-spike',
        median: 25,
        samples: 3,
      },
      spike: { mad: 1, median: 126, p95: 127, samples: 3 },
    });
    expect(analysis[condition.key].metrics.p95Ms.pairedImprovement.median).toBe(5);
    expect(analysis[condition.key].metrics.serverCpuPercent.pairedImprovement.median).toBe(10);
    expect(analysis[condition.key].metrics.peakRssBytes.pairedImprovement.median).toBe(128);
  });

  it('implements the exact 10% or guarded 5% acceptance alternatives', () => {
    const condition = conditionFixture();
    const raw = [];
    for (let occurrence = 0; occurrence < 3; occurrence += 1) {
      raw.push(
        rawCell('baseline', occurrence, condition, {
          ...sampleFixture('baseline', occurrence),
          p95Ms: 100,
          peakRssBytes: 1_000,
          requestsPerSecond: 100,
        }),
        rawCell('spike', occurrence, condition, {
          ...sampleFixture('spike', occurrence),
          p95Ms: 104,
          peakRssBytes: 1_040,
          requestsPerSecond: 106,
        }),
      );
    }
    expect(
      evaluateCompressedCacheAcceptance(raw, { bootstrapIterations: 1_000, seed: 3 }),
    ).toMatchObject({
      criteriaAccepted: true,
      criterion: 'b',
      observed: {
        maxP95RegressionPercent: 4,
        maxRssRegressionPercent: 4,
        throughputBootstrap95Ci: [6, 6],
        throughputMedianPercent: 6,
      },
      reasons: [],
    });

    for (const cell of raw) {
      if (cell.arm === 'spike') cell.sample.p95Ms = 106;
    }
    expect(
      evaluateCompressedCacheAcceptance(raw, { bootstrapIterations: 1_000, seed: 3 }),
    ).toMatchObject({
      criteriaAccepted: false,
      criterion: null,
      observed: { maxP95RegressionPercent: 6 },
      reasons: ['a cached Brotli HIT cell regressed median p95 latency by more than 5%'],
    });

    for (const cell of raw) {
      if (cell.arm === 'spike') {
        cell.sample.p95Ms = 150;
        cell.sample.peakRssBytes = 2_000;
        cell.sample.requestsPerSecond = 110;
      }
    }
    expect(
      evaluateCompressedCacheAcceptance(raw, { bootstrapIterations: 1_000, seed: 3 }),
    ).toMatchObject({ criteriaAccepted: true, criterion: 'a' });
  });

  it('serializes a correctness-gated smoke matrix and retains raw arm reports', async () => {
    const source = sourceFixture();
    const workload = { digest: digest('f'), schema: 'fixture-workload/v1' };
    const calls = [];
    const report = await runCompressedCacheAb(
      {
        bootstrapIterations: 100,
        concurrencies: [1],
        durationMs: 25,
        encodings: ['br'],
        hostSettleMaxMs: 100,
        hostSettlePollMs: 10,
        maxLoadPerCpu: 0.5,
        modes: ['HIT'],
        routes: ['listing'],
        samples: 2,
        warmupMs: 25,
      },
      {
        collectProvenance: () => structuredClone(source),
        executeAdapter: async ({ args, env }) => {
          calls.push({ args, env });
          if (args.includes('--prepare-only')) {
            return { processError: null, report: preparationFixture(source) };
          }
          const arm =
            env[PROVED_DOCUMENT_COMPRESSION_CACHE_DISABLE_ENV] === '1' ? 'baseline' : 'spike';
          const condition = conditionFromArgs(args);
          const occurrence =
            calls.filter(
              (call) =>
                !call.args.includes('--prepare-only') &&
                (call.env[PROVED_DOCUMENT_COMPRESSION_CACHE_DISABLE_ENV] === '1') ===
                  (arm === 'baseline'),
            ).length - 1;
          return {
            processError: null,
            report: adapterFixture({ arm, condition, occurrence, source }),
          };
        },
        identifyWorkload: () => structuredClone(workload),
        sampleHost: () => ({
          at: '2026-08-13T00:00:00.000Z',
          cpuCount: 8,
          loadAverage: [0.8, 0.7, 0.6],
          loadPerCpu: 0.1,
        }),
      },
    );

    expect(calls).toHaveLength(5);
    expect(report.rawSamples.map((cell) => cell.arm)).toEqual([
      'baseline',
      'spike',
      'spike',
      'baseline',
    ]);
    expect(report.integrity).toMatchObject({
      complete: true,
      errors: [],
      expectedRawSamples: 4,
      observedRawSamples: 4,
      serialized: true,
      totals: {
        adapterErrors: 0,
        failedRequests: 0,
        misses: 0,
        reportErrors: 0,
        zeroRequestSamples: 0,
      },
    });
    expect(report.verdict).toMatchObject({
      reasons: ['non-default matrix is smoke-only'],
      status: 'smoke',
    });
    expect(report.acceptance).toMatchObject({
      accepted: false,
      eligible: false,
      evaluation: { criteriaAccepted: true, criterion: 'a' },
    });
    expect(
      report.analysis['hit-listing-br-c1'].metrics.requestsPerSecond.pairedImprovement,
    ).toMatchObject({
      bootstrap95Ci: [25, 25],
      median: 25,
      samples: 2,
    });
    expect(report.evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(report.environment.hostSamples.every((sample) => sample.phase)).toBe(true);
  });

  it('waits only to the configured host bound and runs no adapter while load stays high', async () => {
    const source = sourceFixture();
    const executeAdapter = vi.fn();
    let nowMs = 0;
    const report = await runCompressedCacheAb(
      {
        concurrencies: [1],
        durationMs: 25,
        encodings: ['br'],
        hostSettleMaxMs: 20,
        hostSettlePollMs: 10,
        maxLoadPerCpu: 0.5,
        modes: ['HIT'],
        routes: ['listing'],
        samples: 1,
        warmupMs: 25,
      },
      {
        collectProvenance: () => structuredClone(source),
        executeAdapter,
        identifyWorkload: () => ({ digest: digest('f'), schema: 'fixture-workload/v1' }),
        now: () => nowMs,
        sampleHost: () => ({ loadAverage: [8, 8, 8], loadPerCpu: 1 }),
        wait: async (milliseconds) => {
          nowMs += milliseconds;
        },
      },
    );

    expect(executeAdapter).not.toHaveBeenCalled();
    expect(report.environment.hostSamples).toHaveLength(3);
    expect(report.environment.hostSamples.map((sample) => sample.waitedMs)).toEqual([0, 10, 20]);
    expect(report.integrity.complete).toBe(false);
    expect(report.integrity.errors).toContain(
      'host/before/prepare: load 1 per CPU exceeded 0.5 after 20ms settle',
    );
    expect(report.integrity.errors).toContain(
      'hit-listing-br-c1: serialized sample census is incomplete',
    );
    expect(report.verdict.status).toBe('unproven');
  });
});

function sourceFixture() {
  return {
    commit: 'a'.repeat(40),
    dirty: false,
    dirtyPaths: [],
    locks: {
      'benchmarks/harness/pnpm-lock.yaml': digest('1'),
      'benchmarks/nextjs/pnpm-lock.yaml': digest('2'),
      'pnpm-lock.yaml': digest('3'),
    },
  };
}

function conditionFixture() {
  const condition = { concurrency: 1, encoding: 'br', mode: 'HIT', route: 'listing' };
  return {
    ...condition,
    key: serverConditionKey(condition),
    path: serverConditionPath(condition),
  };
}

function conditionFromArgs(args) {
  const read = (flag) => args[args.indexOf(flag) + 1];
  const condition = {
    concurrency: Number(read('--concurrency')),
    encoding: read('--encoding'),
    mode: read('--mode'),
    route: read('--route'),
  };
  return { ...condition, key: serverConditionKey(condition), path: serverConditionPath(condition) };
}

function preparationFixture(source) {
  return {
    framework: 'kovo',
    host: performanceHostFingerprint(),
    integrity: { artifactsPresent: true, complete: true, sourceStable: true },
    schema: 'kovo-server-benchmark-prepare/v1',
    source: structuredClone(source),
    sourceAfter: structuredClone(source),
    verdict: { status: 'measured' },
  };
}

function adapterFixture({ arm, condition, occurrence, source }) {
  const sample = sampleFixture(arm, occurrence);
  return {
    condition,
    correctness: {
      bodyBytes: 1_000,
      bodySha256: digest('a'),
      cacheControl: 'public, max-age=0, must-revalidate',
      contentEncoding: 'br',
      contentType: 'text/html; charset=utf-8',
      etag: '"fixture-v1"',
      exactResponseHeaders: { 'content-encoding': 'br' },
      kovoPad: 'required-fresh',
      requestAcceptEncoding: 'br',
      status: 200,
      wireBodyBytes: 400,
      wireBodySha256: digest('b'),
    },
    environment: { host: performanceHostFingerprint() },
    framework: 'kovo',
    integrity: {
      complete: true,
      errors: [],
      misses: 0,
      sourceStable: true,
      timingExcluded: false,
    },
    optimization: {
      provedDocumentCompressionCache: arm === 'baseline' ? 'disabled' : 'enabled',
    },
    policy: { durationMs: 25, warmupMs: 25 },
    samples: [sample],
    schema: 'kovo-server-benchmark/v1',
    source: structuredClone(source),
    sourceAfter: structuredClone(source),
    support: { status: 'supported' },
    verdict: { status: 'measured' },
  };
}

function sampleFixture(arm, occurrence) {
  const spike = arm === 'spike';
  return {
    durationMs: 25,
    failedRequests: 0,
    misses: 0,
    p50Ms: spike ? 10 + occurrence : 15 + occurrence,
    p95Ms: spike ? 15 + occurrence : 20 + occurrence,
    p99Ms: spike ? 20 + occurrence : 25 + occurrence,
    peakRssBytes: (spike ? 896 : 1_024) + occurrence,
    processTreeSamples: 2,
    requests: (spike ? 126 : 101) + occurrence,
    requestsPerSecond: (spike ? 125 : 100) + occurrence,
    reusedSockets: 10,
    serverCpuMs: (spike ? 40 : 50) + occurrence,
    serverCpuPercent: (spike ? 40 : 50) + occurrence,
  };
}

function rawCell(arm, occurrence, condition, sample) {
  return { arm, condition, occurrence, sample };
}
