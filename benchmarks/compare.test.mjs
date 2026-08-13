import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../scripts/lib/perf-host.mjs';
import { performanceHostFingerprint } from '../scripts/lib/perf-host.mjs';

import {
  bootstrapMedianCi,
  browserReportIntegrityFindings,
  classifyServerMatrixCells,
  comparisonVerdict,
  EXECUTION_ORDER,
  fixtureProof,
  pairedAnalysis,
  performanceWorkloadIdentity,
  runComparison,
  serverSampleSchedule,
  summarize,
  ttiInteractionProof,
  validateDevCell,
  validateServerCell,
  validHostFingerprint,
  waitForServerHost,
} from './compare.mjs';

describe('serialized comparison analysis', () => {
  it('rejects stale production artifacts before a browser/server comparison starts', async () => {
    await expect(runComparison({ cells: ['server'], skipBuild: true })).rejects.toThrow(
      /prepares fresh production artifacts once/u,
    );
    await expect(runComparison({ cells: ['browser'], skipBuild: true })).rejects.toThrow(
      /prepares fresh production artifacts once/u,
    );
  });

  it('pins the alternating K,N,N,K execution order', () => {
    expect(EXECUTION_ORDER).toEqual(['kovo', 'nextjs', 'nextjs', 'kovo']);
  });

  it('extends K,N,N,K to seven paired server occurrences without concurrency', () => {
    const schedule = serverSampleSchedule(7);
    expect(schedule.map((entry) => entry.framework)).toEqual([
      'kovo',
      'nextjs',
      'nextjs',
      'kovo',
      'kovo',
      'nextjs',
      'nextjs',
      'kovo',
      'kovo',
      'nextjs',
      'nextjs',
      'kovo',
      'kovo',
      'nextjs',
    ]);
    expect(
      schedule.filter((entry) => entry.framework === 'kovo').map((entry) => entry.occurrence),
    ).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(
      schedule.filter((entry) => entry.framework === 'nextjs').map((entry) => entry.occurrence),
    ).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(() => serverSampleSchedule(0)).toThrow(/between 1 and 100/u);
  });

  it('settles residual server load within a bound and preserves every rejected observation', async () => {
    const samples = [];
    const loads = [4, 1];
    let nowMs = 0;
    const result = await waitForServerHost(samples, 0.5, {
      context: 'hit-listing-br-c1/kovo/0',
      maxWaitMs: 100,
      now: () => nowMs,
      pollMs: 50,
      readLoad: () => ({ loadAverage: [loads.shift(), 0, 0], logicalCpuCount: 4 }),
      wait: async (milliseconds) => {
        nowMs += milliseconds;
      },
    });
    expect(result).toMatchObject({ comparable: true, loadPerCpu: 0.25, waitedMs: 50 });
    expect(samples).toMatchObject([
      { attempt: 0, loadPerCpu: 1, phase: 'server-quiet-host-settle', waitedMs: 0 },
      { attempt: 1, loadPerCpu: 0.25, phase: 'server-quiet-host-settle', waitedMs: 50 },
    ]);

    const refused = [];
    nowMs = 0;
    const blocked = await waitForServerHost(refused, 0.5, {
      maxWaitMs: 100,
      now: () => nowMs,
      pollMs: 50,
      readLoad: () => ({ loadAverage: [4, 0, 0], logicalCpuCount: 4 }),
      wait: async (milliseconds) => {
        nowMs += milliseconds;
      },
    });
    expect(blocked).toMatchObject({ comparable: false, waitedMs: 100 });
    expect(refused).toHaveLength(3);
  });

  it('authenticates a server-only workload without requiring generated dev corpora', async () => {
    const workload = await performanceWorkloadIdentity(
      {
        serverConcurrencies: [1],
        serverDurationMs: 25,
        serverEncodings: ['identity'],
        serverModes: ['HIT'],
        serverRoutes: ['listing'],
        serverSamples: 1,
        serverWarmupMs: 25,
      },
      ['server'],
    );
    expect(workload).toMatchObject({
      complete: true,
      schema: 'kovo-performance-workload-identity/v1',
      identity: {
        cells: ['server'],
        policies: {
          server: {
            concurrencies: [1],
            durationMs: 25,
            encodings: ['identity'],
            modes: ['HIT'],
            routes: ['listing'],
            samples: 1,
            warmupMs: 25,
          },
        },
      },
    });
    expect(workload.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(workload.digest).toBe(
      `sha256:${createHash('sha256').update(canonicalJson(workload.identity)).digest('hex')}`,
    );
  });

  it('recomputes host digests instead of trusting their presence', () => {
    const host = performanceHostFingerprint({ runnerImage: 'runner@sha256:fixture' });
    expect(validHostFingerprint(host)).toBe(true);
    expect(validHostFingerprint({ ...host, node: 'v0.0.0' })).toBe(false);
  });

  it('reports raw-summary statistics without dropping sample counts', () => {
    expect(summarize([1, 2, 3, 4, 100])).toEqual({ mad: 1, median: 3, p95: 100, samples: 5 });
  });

  it('computes a deterministic paired bootstrap interval', () => {
    expect(bootstrapMedianCi([1, 2, 3, 4], { iterations: 1_000, seed: 42 })).toEqual([1, 4]);
  });

  it('pairs raw browser samples by lane/cell/metric', () => {
    const cells = [
      browserCell('kovo', 0, [10, 12]),
      browserCell('nextjs', 0, [20, 22]),
      browserCell('nextjs', 1, [40]),
      browserCell('kovo', 1, [30]),
    ];
    const analysis = pairedAnalysis(cells, { bootstrapIterations: 100, seed: 3 });
    expect(analysis['matched-l1/browser//desktop.navigation.navToPaintMs']).toMatchObject({
      kovo: { median: 12, samples: 3 },
      nextjs: { median: 22, samples: 3 },
      pairedDifference: { direction: 'kovo-minus-nextjs', median: -10, samples: 3 },
    });
  });

  it('pairs dev edit and independent fresh-ready samples', () => {
    const cells = [
      devCell('kovo', 0, [10, 12], [100]),
      devCell('nextjs', 0, [20, 22], [200]),
      devCell('nextjs', 1, [40], [400]),
      devCell('kovo', 1, [30], [300]),
    ];
    const analysis = pairedAnalysis(cells, { bootstrapIterations: 100, seed: 4 });
    expect(analysis['corpus-n24/dev//edit.leafMs'].pairedDifference).toMatchObject({
      median: -10,
      samples: 3,
    });
    expect(analysis['corpus-n24/dev//ready.durationMs'].pairedDifference).toMatchObject({
      median: -100,
      samples: 2,
    });
  });

  it('pairs all seven single-sample server occurrences', () => {
    const cells = [];
    for (let occurrence = 0; occurrence < 7; occurrence += 1) {
      cells.push(serverCell('kovo', occurrence, 100 + occurrence));
      cells.push(serverCell('nextjs', occurrence, 90 + occurrence));
    }
    const analysis = pairedAnalysis(cells, { bootstrapIterations: 100, seed: 8 });
    expect(
      analysis['matched-runtime/server/hit-listing-identity-c1/requestsPerSecond'].pairedDifference,
    ).toMatchObject({ median: 10, samples: 7 });
  });

  it('excludes a consistently unsupported server capability while retaining a complete supported matrix', () => {
    const cells = [];
    for (let occurrence = 0; occurrence < 2; occurrence += 1) {
      cells.push({
        ...serverCell('kovo', occurrence, 100 + occurrence),
        mode: 'hit-listing-br-c1',
        report: {
          samples: [{ requestsPerSecond: 100 + occurrence }],
          support: { status: 'supported' },
        },
      });
      cells.push({
        ...serverCell('nextjs', occurrence, 0),
        mode: 'hit-listing-br-c1',
        report: { samples: [], support: { status: 'unsupported' } },
      });
    }
    expect(
      classifyServerMatrixCells(cells, {
        conditionKeys: ['hit-listing-br-c1'],
        samples: 2,
      }),
    ).toEqual({
      completeSupportedMatrix: true,
      excludedUnsupported: [{ condition: 'hit-listing-br-c1', unsupportedFrameworks: ['nextjs'] }],
      findings: [],
      supported: [],
    });
    expect(pairedAnalysis(cells, { bootstrapIterations: 100, seed: 9 })).toEqual({});
  });

  it('requires exact structured identity evidence before accepting an unsupported server cell', () => {
    const host = performanceHostFingerprint();
    const bodyDigest = `sha256:${'a'.repeat(64)}`;
    const report = {
      condition: {
        concurrency: 1,
        encoding: 'br',
        key: 'hit-listing-br-c1',
        mode: 'HIT',
        path: '/matched/l0',
        route: 'listing',
      },
      correctness: {
        bodyBytes: 100,
        bodySha256: bodyDigest,
        contentEncoding: null,
        exactResponseHeaders: { 'content-encoding': null },
        identityResponse: { bodySha256: bodyDigest, status: 200 },
        requestAcceptEncoding: 'br',
        requestIfNoneMatch: null,
        selectedResponse: {
          bodySha256: bodyDigest,
          contentEncoding: null,
          exactResponseHeaders: { 'content-encoding': null },
          status: 200,
        },
        status: 200,
        wireBodyBytes: 100,
        wireBodySha256: bodyDigest,
      },
      environment: { host },
      framework: 'nextjs',
      integrity: {
        complete: true,
        errors: [],
        misses: 0,
        sourceStable: true,
        timingExcluded: true,
      },
      optimization: { provedDocumentCompressionCache: 'not-applicable' },
      policy: { durationMs: 15_000, warmupMs: 5_000 },
      samples: [],
      schema: 'kovo-server-benchmark/v1',
      source: { commit: 'a'.repeat(40), dirty: false, locks: {} },
      sourceAfter: { commit: 'a'.repeat(40), dirty: false, locks: {} },
      support: {
        observedContentEncoding: null,
        reason: 'requested Brotli returned the identity representation',
        requestedContentEncoding: 'br',
        status: 'unsupported',
      },
      verdict: { status: 'unsupported' },
    };
    const cell = {
      cell: 'server',
      framework: 'nextjs',
      lane: 'matched-runtime',
      mode: 'hit-listing-br-c1',
      occurrence: 0,
      report,
      serverCondition: report.condition,
    };
    const reasons = [];
    validateServerCell(cell, {
      policy: { serverDurationMs: 15_000, serverWarmupMs: 5_000 },
      reasons,
    });
    expect(reasons).toEqual([]);

    report.correctness.contentEncoding = 'br';
    const forgedReasons = [];
    validateServerCell(cell, {
      policy: { serverDurationMs: 15_000, serverWarmupMs: 5_000 },
      reasons: forgedReasons,
    });
    expect(forgedReasons).toContain(
      'matched-runtime/nextjs/hit-listing-br-c1 unsupported response proof failure',
    );
  });

  it('marks provenance or comparator mismatches unproven', () => {
    expect(
      comparisonVerdict({
        integrity: { comparatorMatched: false, serialized: true, sourceStable: false },
        source: { dirty: true },
      }),
    ).toEqual({
      reasons: [
        'source provenance is dirty',
        'source provenance changed during run',
        'comparator pairing is incomplete',
        'execution identity is incomplete',
        'workload identity is incomplete',
      ],
      status: 'unproven',
    });
  });

  it('uses truthful per-framework script contracts for default and matched fixtures', () => {
    const zeroScriptFixture = {
      fixtureBootstrapValid: 1,
      fixtureContentValid: 1,
      fixtureControlsValid: 1,
      fixtureCssValid: 1,
      fixtureLaneValid: 1,
      fixtureScriptCount: 0,
    };
    expect(fixtureProof(zeroScriptFixture, { framework: 'kovo', lane: 'default' })).toBe(true);
    expect(fixtureProof(zeroScriptFixture, { framework: 'kovo', lane: 'matched-l0' })).toBe(true);
    expect(fixtureProof(zeroScriptFixture, { framework: 'kovo', lane: 'matched-l1' })).toBe(false);
    expect(fixtureProof(zeroScriptFixture, { framework: 'nextjs', lane: 'default' })).toBe(false);
    expect(
      fixtureProof(
        { ...zeroScriptFixture, fixtureScriptCount: 1 },
        { framework: 'nextjs', lane: 'default' },
      ),
    ).toBe(true);
  });

  it('accepts native default checkout without inventing matched-L1 state evidence', () => {
    expect(
      ttiInteractionProof({ checkoutConfirmed: 1, stateMutationConfirmed: 0 }, 'default'),
    ).toBe(true);
    expect(
      ttiInteractionProof({ checkoutConfirmed: 1, stateMutationConfirmed: 0 }, 'matched-l1'),
    ).toBe(false);
  });

  it('requires a complete browser-adapter integrity verdict and exact policy', () => {
    const policy = {
      bfcacheIterations: 5,
      iterations: 15,
      lighthouseRepeats: 3,
      listingPath: '/',
      scenarios: ['coldLoad', 'ttiProbe', 'navigation'],
      warmups: 2,
    };
    expect(
      browserReportIntegrityFindings({ integrity: { complete: true, errors: [], policy } }, policy),
    ).toEqual([]);
    expect(
      browserReportIntegrityFindings(
        { integrity: { complete: false, errors: ['page error'], policy } },
        { ...policy, iterations: 14 },
      ),
    ).toEqual([
      'browser integrity verdict is incomplete',
      'browser integrity errors are present or unavailable',
      'browser integrity policy iterations mismatch',
    ]);
  });

  it('requires exact dev ready/edit counts, stable source, and clean browser evidence', () => {
    const reasons = [];
    validateDevCell(
      {
        framework: 'kovo',
        lane: 'corpus-n24',
        report: {
          framework: 'kovo',
          integrity: {
            browser: { requestFailedCount: 0, responseCount: 1, unexpectedErrorCount: 0 },
            editCounts: { data: 30, entry: 30, leaf: 30, recovery: 30, syntaxError: 30 },
            iterations: 30,
            readyIterations: 15,
            source: { stable: true },
            warmups: 3,
          },
          readySamples: Array.from({ length: 15 }, () => ({})),
          source: { commit: 'abc', dirty: false, locks: { root: 'one' } },
          sourceAfter: { commit: 'abc', dirty: false, locks: { root: 'one' } },
        },
      },
      { iterations: 30, readyIterations: 15, reasons, warmups: 3 },
    );
    expect(reasons).toEqual([]);

    const mismatched = [];
    validateDevCell(
      {
        framework: 'kovo',
        lane: 'corpus-n24',
        report: {
          framework: 'kovo',
          integrity: {
            browser: { requestFailedCount: 1, responseCount: 0, unexpectedErrorCount: 1 },
            editCounts: {},
            iterations: 29,
            readyIterations: 14,
            source: { stable: false },
            warmups: 2,
          },
          readySamples: [],
          source: { commit: 'abc', dirty: false, locks: {} },
          sourceAfter: { commit: 'def', dirty: true, locks: {} },
        },
      },
      { iterations: 30, readyIterations: 15, reasons: mismatched, warmups: 3 },
    );
    expect(mismatched).toContain('corpus-n24/kovo/dev ready iteration policy mismatch');
    expect(mismatched).toContain('corpus-n24/kovo/dev source stability failure');
    expect(mismatched).toContain('corpus-n24/kovo/dev browser error evidence');
  });
});

function browserCell(framework, occurrence, values) {
  return {
    cell: 'browser',
    framework,
    lane: 'matched-l1',
    occurrence,
    report: {
      schema: 'kovo-browser-benchmark/v1',
      apps: [
        {
          conditions: {
            desktop: {
              navigation: { iterations: values.map((navToPaintMs) => ({ navToPaintMs })) },
            },
          },
        },
      ],
    },
  };
}

function devCell(framework, occurrence, editValues, readyValues) {
  return {
    cell: 'dev',
    framework,
    lane: 'corpus-n24',
    occurrence,
    report: {
      readySamples: readyValues.map((durationMs) => ({ durationMs })),
      samples: editValues.map((leafMs) => ({ leafMs })),
    },
  };
}

function serverCell(framework, occurrence, requestsPerSecond) {
  return {
    cell: 'server',
    framework,
    lane: 'matched-runtime',
    mode: 'hit-listing-identity-c1',
    occurrence,
    report: { samples: [{ requestsPerSecond }] },
  };
}
