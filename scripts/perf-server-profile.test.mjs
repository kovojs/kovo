import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  analyzeCpuProfile,
  createProfiledServerSpawner,
  HISTORICAL_SSR_HYPOTHESES,
  runForcedDynamicServerProfile,
  SERVER_PROFILE_REPORT_SCHEMA,
  validateServerProfileReport,
} from './perf-server-profile.mjs';
import { SERVER_BENCHMARK_SCHEMA, SERVER_PREPARE_SCHEMA } from './perf-server-benchmark.mjs';

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('forced-dynamic SSR profile', () => {
  it('ranks top-five paths/categories and explicitly retests every historical hypothesis', () => {
    const analysis = analyzeCpuProfile(syntheticCpuProfile());

    expect(analysis.topHotPaths).toHaveLength(5);
    expect(analysis.topHotPaths[0]).toMatchObject({
      functionName: 'formHelperSnapshotRecord',
      rank: 1,
    });
    expect(analysis.topCategories.map((entry) => entry.category)).toContain(
      'form-property-snapshot',
    );
    expect(analysis.hypotheses.map((entry) => entry.id)).toEqual(
      HISTORICAL_SSR_HYPOTHESES.map((entry) => entry.id),
    );
    expect(analysis.hypotheses.find((entry) => entry.id === 'jsx-lowering')).toMatchObject({
      observedSelfPercent: 0,
      ruling: 'refuted-as-current-top-five-hot-path',
      selfSamples: 0,
    });
    expect(analysis.hypotheses.find((entry) => entry.id === 'reflect-apply')).toMatchObject({
      historicalClaimPercent: 38,
      ruling: 'refuted-as-current-top-five-hot-path',
      selfSamples: 1,
      topFiveRanks: [],
    });
  });

  it('matches the current symbols behind all six historical hypotheses', () => {
    const analysis = analyzeCpuProfile(historicalHypothesisCpuProfile());

    expect(
      Object.fromEntries(
        analysis.hypotheses.map((hypothesis) => [
          hypothesis.id,
          {
            ruling: hypothesis.ruling,
            selfSamples: hypothesis.selfSamples,
          },
        ]),
      ),
    ).toEqual({
      'csp-rescan': { ruling: 'present-in-current-top-five', selfSamples: 2 },
      'head-serialization': { ruling: 'present-in-current-top-five', selfSamples: 3 },
      'hkdf-hmac': { ruling: 'present-in-current-top-five', selfSamples: 5 },
      'jsx-lowering': { ruling: 'present-in-current-top-five', selfSamples: 6 },
      'reflect-apply': { ruling: 'refuted-as-current-top-five-hot-path', selfSamples: 1 },
      'request-proxy': { ruling: 'present-in-current-top-five', selfSamples: 4 },
    });
  });

  it('wraps only the generated server Node process with the flushing Inspector launcher', () => {
    const calls = [];
    const sentinel = {};
    const profiledSpawn = createProfiledServerSpawner(
      { profilePath: '/tmp/kovo-profile.cpuprofile', samplingIntervalMicros: 750 },
      {
        launcherPath: '/repo/scripts/lib/profile-launcher.mjs',
        spawnProcess: (...args) => {
          calls.push(args);
          return sentinel;
        },
      },
    );
    const result = profiledSpawn(process.execPath, ['dist/server/server.mjs'], {
      cwd: '/repo/benchmarks/kovo',
      env: { PORT: '50330' },
    });

    expect(result).toBe(sentinel);
    expect(calls).toEqual([
      [
        process.execPath,
        ['/repo/scripts/lib/profile-launcher.mjs', '/repo/benchmarks/kovo/dist/server/server.mjs'],
        {
          cwd: '/repo/benchmarks/kovo',
          env: {
            KOVO_PERF_CPU_PROFILE_INTERVAL_US: '750',
            KOVO_PERF_CPU_PROFILE_PATH: '/tmp/kovo-profile.cpuprofile',
            PORT: '50330',
          },
        },
      ],
    ]);
    expect(() => profiledSpawn('node-from-path', ['server.mjs'], { cwd: '/', env: {} })).toThrow(
      /current Node/u,
    );
  });

  it('flushes an actual Chrome CPU profile before SIGTERM exit', async () => {
    const root = await temporaryRoot();
    const profilePath = path.join(root, 'raw.cpuprofile');
    const launcherPath = new URL('./lib/perf-cpu-profile-launcher.mjs', import.meta.url);
    const entry = `data:text/javascript,${encodeURIComponent(
      'let total=0;setInterval(()=>{for(let index=0;index<200000;index+=1)total+=index},1)',
    )}`;
    const child = spawn(process.execPath, [launcherPath.pathname, entry], {
      env: {
        ...process.env,
        KOVO_PERF_CPU_PROFILE_INTERVAL_US: '500',
        KOVO_PERF_CPU_PROFILE_PATH: profilePath,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    child.kill('SIGTERM');
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });

    expect(exit, stderr).toEqual({ code: 0, signal: null });
    const profile = JSON.parse(await readFile(profilePath, 'utf8'));
    expect(profile.nodes.length).toBeGreaterThan(0);
    expect(profile.samples.length).toBeGreaterThan(0);
    expect(analyzeCpuProfile(profile).census.activeSamples).toBeGreaterThan(0);
  });

  it('emits a source-bound diagnostic report without profiler-perturbed timing claims', async () => {
    const root = await temporaryRoot();
    const profilePath = path.join(root, 'forced-dynamic.cpuprofile');
    const source = cleanSource();
    const benchmarkRunner = async (options) => {
      if (options.prepareOnly) {
        return {
          integrity: { complete: true },
          schema: SERVER_PREPARE_SCHEMA,
          source,
          sourceAfter: source,
        };
      }
      await writeFile(profilePath, `${JSON.stringify(syntheticCpuProfile())}\n`);
      return {
        condition: {
          concurrency: 32,
          encoding: 'identity',
          key: 'dynamic-listing-identity-c32',
          mode: 'dynamic',
          path: '/matched/runtime/dynamic',
          route: 'listing',
        },
        correctness: {
          bodySha256: `sha256:${'b'.repeat(64)}`,
          cacheControl: 'private, no-store',
          contentEncoding: null,
          status: 200,
        },
        environment: { host: { digest: `sha256:${'c'.repeat(64)}` } },
        framework: 'kovo',
        integrity: { complete: true, errors: [], misses: 0 },
        samples: [{ requestsPerSecond: 1234, p95Ms: 1.2 }],
        schema: SERVER_BENCHMARK_SCHEMA,
        source,
        sourceAfter: source,
        verdict: { reasons: [], status: 'measured' },
      };
    };
    const report = await runForcedDynamicServerProfile(
      { durationMs: 25, profileOut: profilePath, warmupMs: 25 },
      { benchmarkRunner },
    );

    expect(report.schema).toBe(SERVER_PROFILE_REPORT_SCHEMA);
    expect(report.verdict.status).toBe('diagnostic');
    expect(report.integrity).toMatchObject({
      complete: true,
      sourceClean: true,
      sourceStable: true,
    });
    expect(report.diagnosticOnly).toMatchObject({
      profilerPerturbsRuntime: true,
      publishTimingClaims: false,
    });
    expect(JSON.stringify(report)).not.toContain('requestsPerSecond');
    expect(JSON.stringify(report)).not.toContain('p95Ms');
    expect(validateServerProfileReport(report)).toEqual([]);

    const forged = structuredClone(report);
    forged.workload.digest = `sha256:${'f'.repeat(64)}`;
    expect(validateServerProfileReport(forged)).toContain('workload digest is invalid');

    const mismatchedPreparation = structuredClone(report);
    mismatchedPreparation.preparation.sourceAfter = {
      ...mismatchedPreparation.preparation.sourceAfter,
      commit: 'e'.repeat(40),
    };
    expect(validateServerProfileReport(mismatchedPreparation)).toContain(
      'production preparation identity is missing or unstable',
    );
  });
});

function syntheticCpuProfile() {
  const frames = [
    ['(root)', '', 0],
    ['(idle)', '', 0],
    ['formHelperSnapshotRecord', 'file:///repo/benchmarks/kovo/dist/server/server.mjs', 100],
    ['renderJsxAttributes', 'file:///repo/benchmarks/kovo/dist/server/server.mjs', 200],
    ['routeDocument', 'file:///repo/benchmarks/kovo/dist/server/server.mjs', 300],
    ['(garbage collector)', '', 0],
    ['nativeWrite', 'node:stream', 10],
    ['apply$12', 'file:///repo/benchmarks/kovo/dist/server/server.mjs', 400],
  ];
  const nodes = frames.map(([functionName, url, lineNumber], index) => ({
    callFrame: { columnNumber: 0, functionName, lineNumber, scriptId: String(index), url },
    id: index + 1,
  }));
  const samples = [
    ...Array(12).fill(3),
    ...Array(8).fill(4),
    ...Array(6).fill(5),
    ...Array(4).fill(6),
    ...Array(2).fill(7),
    8,
    ...Array(5).fill(2),
  ];
  return {
    endTime: 2_000,
    nodes,
    samples,
    startTime: 1_000,
    timeDeltas: samples.map(() => 500),
  };
}

function historicalHypothesisCpuProfile() {
  const names = [
    'compileComponentModule',
    'createHmac',
    'pinnedRequestCarrier',
    'renderHeadChildren',
    'styleAttributeCspInlineMetadata',
    'securityApply',
  ];
  const nodes = names.map((functionName, index) => ({
    callFrame: {
      columnNumber: 0,
      functionName,
      lineNumber: index + 1,
      scriptId: String(index),
      url: 'file:///repo/benchmarks/kovo/dist/server/server.mjs',
    },
    id: index + 1,
  }));
  const samples = names.flatMap((_, index) => Array(6 - index).fill(index + 1));
  return {
    endTime: 2_000,
    nodes,
    samples,
    startTime: 1_000,
    timeDeltas: samples.map(() => 500),
  };
}

function cleanSource() {
  return {
    commit: 'a'.repeat(40),
    dirty: false,
    dirtyPaths: [],
    locks: { 'pnpm-lock.yaml': `sha256:${'d'.repeat(64)}` },
  };
}

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-server-profile-test-'));
  temporaryRoots.push(root);
  return root;
}
