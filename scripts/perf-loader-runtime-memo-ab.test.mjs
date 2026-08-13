import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  analyzeLoaderRuntimeMemoProfile,
  analyzeLoaderRuntimeMemoSamples,
  authenticateHistoricalOrigin,
  authenticateHistoricalScratchpad,
  evaluateLoaderRuntimeMemoAcceptance,
  HISTORICAL_LOADER_RUNTIME_MEMO,
  loaderRuntimeMemoConditions,
  loaderRuntimeModuleSourceEvidence,
  loaderRuntimeMemoSchedule,
  LOADER_RUNTIME_MEMO_ORDER,
  parseLoaderRuntimeMemoArgs,
  runLoaderRuntimeMemoAb,
} from './perf-loader-runtime-memo-ab.mjs';

const temporaryDirectories = [];
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('loader-runtime memo authenticated A/B runner', () => {
  it('authenticates the located historical manifest, commit chain when present, and raw artifacts', () => {
    const origin = authenticateHistoricalOrigin();
    expect(origin).toMatchObject({
      baseline: 'ce327123caf5b73a205d8c537f89191413a6edb4',
      candidate: 'b545756ae94e0717d5e043b9f9b60e23014130a8',
      fixtureOnly: 'e54c595b5906df9ab9b9b5e3fbf18e76c99e79b9',
      patchSha256: 'sha256:0c5bd1a78d29316d3a90fec9b1ddc23a5fe0a706b634ff6cc96287045795091f',
      posture: '3279995d3469d045ec8f37fe9ddbcff79f8230f8',
      stablePatchId: 'c36f0151ec4fa0524c094d1b7700e727753bac70',
    });
    expect(['authenticated', 'unavailable-in-current-clone']).toContain(
      origin.commitObjects.status,
    );
    expect(origin.authenticatedExploratoryFacts.repeatedModuleSourceBytes).toBe(276_420);
    if (origin.scratchpad.status === 'authenticated') {
      expect(origin.scratchpad.artifacts).toHaveLength(13);
    } else {
      expect(origin.scratchpad.status).toBe('unavailable-on-current-host');
    }

    const root = temporaryDirectory('kovo-loader-origin-');
    writeFileSync(path.join(root, 'raw.json'), '{"real":true}\n');
    const manifest = {
      scratchpad: {
        artifacts: [
          {
            bytes: readFileSync(path.join(root, 'raw.json')).byteLength,
            path: 'raw.json',
            sha256: digest(readFileSync(path.join(root, 'raw.json'))),
          },
        ],
        root,
      },
    };
    expect(authenticateHistoricalScratchpad(manifest)).toMatchObject({
      artifacts: ['raw.json'],
      status: 'authenticated',
    });
    writeFileSync(path.join(root, 'raw.json'), '{"real":false}\n');
    expect(() => authenticateHistoricalScratchpad(manifest)).toThrow(
      /historical scratchpad artifact differs/u,
    );
  });

  it('re-authenticates the exact constant runtime module source under test', () => {
    expect(loaderRuntimeModuleSourceEvidence()).toEqual({
      bytes: 276_420,
      exportName: 'kovoDeferredRuntimeModuleSource',
      path: 'packages/browser/src/inline-loader.ts',
      sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
  });

  it('uses the exact repeated B,S,S,B schedule with seven occurrences per arm', () => {
    const schedule = loaderRuntimeMemoSchedule();
    expect(LOADER_RUNTIME_MEMO_ORDER).toEqual(['baseline', 'spike', 'spike', 'baseline']);
    expect(schedule).toHaveLength(14);
    expect(schedule.map(({ lane }) => lane)).toEqual([
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
    expect(
      schedule.filter(({ lane }) => lane === 'baseline').map(({ occurrence }) => occurrence),
    ).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(
      schedule.filter(({ lane }) => lane === 'spike').map(({ occurrence }) => occurrence),
    ).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('reports throughput, p50/p95/p99, process-tree CPU/RSS, and exact plan acceptance', () => {
    const raw = acceptanceCells({ p95: 104, requestsPerSecond: 106, rss: 1_040 });
    const analysis = analyzeLoaderRuntimeMemoSamples(raw, {
      bootstrapIterations: 1_000,
      seed: 7,
    });
    expect(Object.keys(analysis)).toHaveLength(6);
    expect(analysis['dynamic-detail-identity-c32'].metrics).toMatchObject({
      p50Ms: { pairedImprovement: { median: 1 } },
      p95Ms: { pairedImprovement: { median: -4 } },
      p99Ms: { pairedImprovement: { median: 1 } },
      peakRssBytes: { pairedImprovement: { median: -40 } },
      requestsPerSecond: { pairedImprovement: { median: 6 } },
      serverCpuMs: { pairedImprovement: { median: 10 } },
      serverCpuPercent: { pairedImprovement: { median: 10 } },
    });
    expect(
      evaluateLoaderRuntimeMemoAcceptance(raw, { bootstrapIterations: 1_000, seed: 9 }),
    ).toMatchObject({
      accepted: true,
      criterion: 'b',
      observed: {
        maxP95RegressionPercent: 4,
        maxRssRegressionPercent: 4,
        throughputBootstrap95Ci: [6, 6],
        throughputMedianPercent: 6,
        throughputPairs: 18,
      },
      reasons: [],
    });

    const guardedFailure = acceptanceCells({ p95: 106, requestsPerSecond: 106, rss: 1_040 });
    expect(
      evaluateLoaderRuntimeMemoAcceptance(guardedFailure, {
        bootstrapIterations: 1_000,
        seed: 9,
      }),
    ).toMatchObject({
      accepted: false,
      criterion: null,
      reasons: ['a forced-dynamic cell regressed median p95 latency by more than 5%'],
    });

    const criterionA = acceptanceCells({ p95: 150, requestsPerSecond: 111, rss: 2_000 });
    expect(
      evaluateLoaderRuntimeMemoAcceptance(criterionA, {
        bootstrapIterations: 1_000,
        seed: 9,
      }),
    ).toMatchObject({ accepted: true, criterion: 'a', reasons: [] });
  });

  it('computes the historical busy-hit subtree definition without double counting', () => {
    const profile = {
      nodes: [
        node(1, '(root)', 10, [2, 5]),
        node(2, 'ensureKovoLoaderRuntimeClientModule', 200, [3]),
        node(3, 'moduleHref', 1_500, [4]),
        node(4, 'ensureKovoLoaderRuntimeClientModule', 0),
        node(5, 'renderDocument', 4_798),
      ],
      samples: [2, 3, 5],
    };
    expect(analyzeLoaderRuntimeMemoProfile(profile)).toEqual({
      busyHits: 6_498,
      loaderRuntimeSelection: {
        busyPercent: (1_700 / 6_498) * 100,
        matchingRoots: 2,
        subtreeHits: 1_700,
        topMatchingRoots: 1,
      },
      sampledNodeIds: 3,
      totalHits: 6_508,
    });
  });

  it('runs a serialized six-cell smoke matrix and profiles both routes before and after', async () => {
    const root = temporaryDirectory('kovo-loader-runner-');
    const baselineRoot = path.join(root, 'baseline');
    const spikeRoot = path.join(root, 'spike');
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(baselineRoot);
    mkdirSync(spikeRoot);
    const source = {
      baseline: sourceFixture('a'),
      spike: sourceFixture('b'),
    };
    const calls = [];
    const installWorktree = vi.fn(async () => ({ status: 'installed' }));
    const authenticateRoots = vi.fn(() => ({
      baseline: { commit: source.baseline.commit, root: baselineRoot },
      historical: { status: 'authenticated-fixture' },
      patch: {
        bytes: 10,
        paths: [
          'packages/server/src/client-modules.ts',
          'packages/server/src/client-modules.test.ts',
          'packages/server/src/loader-runtime-client-module.ts',
        ],
        sha256: `sha256:${'c'.repeat(64)}`,
        stablePatchId: 'd'.repeat(40),
      },
      schema: 'kovo-loader-runtime-memo-candidate/v1',
      spike: {
        commit: source.spike.commit,
        parent: source.baseline.commit,
        root: spikeRoot,
      },
    }));
    const report = await runLoaderRuntimeMemoAb(
      {
        baselineRoot,
        measure: true,
        out: path.join(artifactRoot, 'report.json'),
        profileDir: path.join(artifactRoot, 'profiles'),
        quickSmoke: true,
        spikeRoot,
        timingLockPath: path.join(root, 'timing.lock'),
      },
      {
        authenticateRoots,
        collectState: (laneRoot) =>
          structuredClone(laneRoot === baselineRoot ? source.baseline : source.spike),
        hostObservation: (label) => ({
          at: '2026-08-13T00:00:00Z',
          cpuCount: 8,
          label,
          loadAverage: [0.1, 0.1, 0.1],
          loadPerCpu: 0.0125,
        }),
        identifyWorkload: () => ({
          digest: `sha256:${'f'.repeat(64)}`,
          schema: 'fixture-workload/v1',
        }),
        installWorktree,
        runAdapter: async (call) => {
          calls.push(call);
          const lane = call.root === baselineRoot ? 'baseline' : 'spike';
          if (call.args.includes('--prepare-only')) {
            return { error: null, report: preparationFixture(source[lane]) };
          }
          if (call.script === 'scripts/perf-server-profile.mjs') {
            const route = argumentValue(call.args, '--route');
            const profilePath = argumentValue(call.args, '--profile-out');
            const bytes = Buffer.from(
              JSON.stringify(
                lane === 'baseline'
                  ? { nodes: [node(1, 'ensureKovoLoaderRuntimeClientModule', 20)], samples: [1] }
                  : { nodes: [node(1, 'renderDocument', 20)], samples: [1] },
              ),
            );
            mkdirSync(path.dirname(profilePath), { recursive: true });
            writeFileSync(profilePath, bytes);
            return {
              error: null,
              report: profileFixture({
                artifactSha256: digest(bytes),
                route,
                source: source[lane],
              }),
            };
          }
          const condition = loaderRuntimeMemoConditions().find(
            ({ concurrency, route }) =>
              concurrency === Number(argumentValue(call.args, '--concurrency')) &&
              route === argumentValue(call.args, '--route'),
          );
          return {
            error: null,
            report: adapterFixture({ condition, lane, source: source[lane] }),
          };
        },
      },
    );

    expect(authenticateRoots).toHaveBeenCalledWith({
      baselineRoot: realpathSync(baselineRoot),
      spikeRoot: realpathSync(spikeRoot),
    });
    expect(installWorktree).toHaveBeenNthCalledWith(1, baselineRoot);
    expect(installWorktree).toHaveBeenNthCalledWith(2, spikeRoot);
    expect(calls).toHaveLength(30);
    expect(
      calls
        .filter(({ script }) => script === 'scripts/perf-server-benchmark.mjs')
        .slice(2)
        .map(({ root }) => (root === baselineRoot ? 'baseline' : 'spike')),
    ).toEqual(
      loaderRuntimeMemoConditions().flatMap(() => ['baseline', 'spike', 'spike', 'baseline']),
    );
    expect(report.rawSamples).toHaveLength(24);
    expect(Object.keys(report.profiles).sort()).toEqual([
      'detail/baseline',
      'detail/spike',
      'listing/baseline',
      'listing/spike',
    ]);
    expect(report.profiles['listing/baseline'].analysis.loaderRuntimeSelection.busyPercent).toBe(
      100,
    );
    expect(report.profiles['listing/spike'].analysis.loaderRuntimeSelection.busyPercent).toBe(0);
    expect(report.integrity).toMatchObject({
      complete: true,
      errors: [],
      expectedSamples: 24,
      observedSamples: 24,
      serialized: true,
      sourceStable: true,
    });
    expect(report.verdict).toMatchObject({
      reasons: ['non-default policy is smoke-only'],
      status: 'smoke',
    });
  });

  it('rejects unknown/duplicate CLI flags and unsupported matrix overrides', async () => {
    expect(() => parseLoaderRuntimeMemoArgs(['--surprise', '1'])).toThrow(/unknown argument/u);
    expect(() => parseLoaderRuntimeMemoArgs(['--measure', '--measure'])).toThrow(
      /provided only once/u,
    );
    expect(() =>
      parseLoaderRuntimeMemoArgs(['--concurrencies', '1,8', '--concurrencies', '32']),
    ).toThrow(/provided only once/u);

    const root = temporaryDirectory('kovo-loader-options-');
    const baselineRoot = path.join(root, 'baseline');
    const spikeRoot = path.join(root, 'spike');
    mkdirSync(baselineRoot);
    mkdirSync(spikeRoot);
    await expect(
      runLoaderRuntimeMemoAb({
        baselineRoot,
        concurrencies: [1, 64],
        measure: true,
        out: path.join(root, 'artifacts', 'report.json'),
        routes: ['listing'],
        spikeRoot,
      }),
    ).rejects.toThrow(/unsupported value 64/u);
    await expect(
      runLoaderRuntimeMemoAb({
        baselineRoot,
        measure: true,
        out: path.join(root, 'artifacts', 'report.json'),
        routes: ['listing', 'listing'],
        spikeRoot,
      }),
    ).rejects.toThrow(/without duplicates/u);
  });
});

function temporaryDirectory(prefix) {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function acceptanceCells({ p95, requestsPerSecond, rss }) {
  const cells = [];
  for (const condition of loaderRuntimeMemoConditions()) {
    for (let occurrence = 0; occurrence < 3; occurrence += 1) {
      cells.push(
        {
          condition,
          lane: 'baseline',
          occurrence,
          sample: sampleFixture({ p95: 100, requestsPerSecond: 100, rss: 1_000 }),
        },
        {
          condition,
          lane: 'spike',
          occurrence,
          sample: sampleFixture({ p95, requestsPerSecond, rss }),
        },
      );
    }
  }
  return cells;
}

function sampleFixture({ p95, requestsPerSecond, rss }) {
  return {
    durationMs: 50,
    failedRequests: 0,
    misses: 0,
    p50Ms: requestsPerSecond === 100 ? 10 : 9,
    p95Ms: p95,
    p99Ms: requestsPerSecond === 100 ? 20 : 19,
    peakRssBytes: rss,
    processTreeSamples: 10,
    requests: 100,
    requestsPerSecond,
    serverCpuMs: requestsPerSecond === 100 ? 100 : 90,
    serverCpuPercent: requestsPerSecond === 100 ? 100 : 90,
    statusCounts: { 200: 100 },
  };
}

function sourceFixture(character) {
  return {
    commit: character.repeat(40),
    dirty: false,
    dirtyPaths: [],
    locks: { 'pnpm-lock.yaml': `sha256:${'e'.repeat(64)}` },
    packageManager: 'pnpm@10.12.1',
    pnpmVersion: '10.12.1',
  };
}

function preparationFixture(source) {
  return {
    framework: 'kovo',
    integrity: { complete: true },
    schema: 'kovo-server-benchmark-prepare/v1',
    source: structuredClone(source),
    sourceAfter: structuredClone(source),
    verdict: { status: 'measured' },
  };
}

function adapterFixture({ condition, lane, source }) {
  const sample = sampleFixture({
    p95: lane === 'baseline' ? 100 : 80,
    requestsPerSecond: lane === 'baseline' ? 100 : 120,
    rss: lane === 'baseline' ? 1_000 : 900,
  });
  return {
    condition,
    correctness: {
      bodyBytes: 1_000,
      bodySha256: `sha256:${'1'.repeat(64)}`,
      contentEncoding: null,
      contentType: 'text/html; charset=utf-8',
      status: 200,
    },
    framework: 'kovo',
    integrity: { complete: true, errors: [], misses: 0 },
    samples: [sample],
    schema: 'kovo-server-benchmark/v1',
    source: structuredClone(source),
    sourceAfter: structuredClone(source),
    verdict: { status: 'measured' },
  };
}

function profileFixture({ artifactSha256, route, source }) {
  return {
    benchmarkEvidence: {
      condition: { concurrency: 32, encoding: 'identity', mode: 'dynamic', route },
    },
    integrity: { complete: true },
    profileArtifact: { sha256: artifactSha256 },
    schema: 'kovo-forced-dynamic-ssr-profile/v1',
    source: structuredClone(source),
    sourceAfter: structuredClone(source),
    verdict: { status: 'diagnostic' },
  };
}

function node(id, functionName, hitCount, children = []) {
  return { callFrame: { functionName }, children, hitCount, id };
}

function argumentValue(args, flag) {
  return args[args.indexOf(flag) + 1];
}
