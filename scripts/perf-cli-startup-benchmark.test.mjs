import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CLI_STARTUP_BENCHMARK_SCHEMA,
  assertInstalledPackedPackages,
  classifyCliStartup,
  cliStartupSchedule,
  pairedBootstrapConfidenceInterval,
  parseCliStartupArgs,
  runCliStartupBenchmark,
  runPackedResolutionProof,
  summarizeCliSamples,
} from './perf-cli-startup-benchmark.mjs';

const temporaryRoots = [];
const lockDigest = `sha256:${'a'.repeat(64)}`;

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop(), { force: true, recursive: true });
  }
});

function temporaryRoot(label = 'kovo-cli-startup-test-') {
  const root = mkdtempSync(path.join(tmpdir(), label));
  temporaryRoots.push(root);
  return root;
}

function cleanProvenance(commit = '1'.repeat(40)) {
  return {
    commit,
    dirty: false,
    dirtyPaths: [],
    locks: {
      'benchmarks/harness/pnpm-lock.yaml': lockDigest,
      'benchmarks/nextjs/pnpm-lock.yaml': lockDigest,
      'pnpm-lock.yaml': lockDigest,
    },
  };
}

function fakePrepared(onCleanup = () => {}) {
  return {
    cleanup: onCleanup,
    commands: {
      packed: { argv: ['packed'], cwd: '/tmp', env: {} },
      'source-checkout': { argv: ['source-checkout'], cwd: '/tmp', env: {} },
    },
    evidence: {
      integrity: {
        artifactAuthenticated: true,
        consumerFrozen: true,
        installedBytesMatchTarballs: true,
        packedResolutionConfined: true,
        workspaceSourceLoaded: false,
      },
    },
    expectedStdout: 'kovo 0.3.0\n',
  };
}

function lowLoad(label, ceiling) {
  return {
    at: '2026-08-13T00:00:00.000Z',
    ceiling,
    comparable: true,
    cpuCount: 10,
    label,
    loadAverage: [0.5, 0.5, 0.5],
    loadPerCpu: 0.05,
  };
}

describe('packed versus source-checkout CLI startup benchmark', () => {
  it('uses a balanced baseline, spike, spike, baseline schedule', () => {
    expect(cliStartupSchedule(2)).toEqual([
      { lane: 'source-checkout', occurrence: 0 },
      { lane: 'packed', occurrence: 0 },
      { lane: 'packed', occurrence: 1 },
      { lane: 'source-checkout', occurrence: 1 },
    ]);
    expect(cliStartupSchedule(3).map((sample) => sample.lane)).toEqual([
      'source-checkout',
      'packed',
      'packed',
      'source-checkout',
      'source-checkout',
      'packed',
    ]);
    expect(() => cliStartupSchedule(0)).toThrow(/1 through 100/u);
  });

  it('reports median, MAD, interpolated p95, RSS, and deterministic paired bootstrap CI', () => {
    const samples = [
      { durationMs: 10, peakRssBytes: 100, valid: true },
      { durationMs: 20, peakRssBytes: 300, valid: true },
      { durationMs: 40, peakRssBytes: 200, valid: true },
      { durationMs: 1, peakRssBytes: 1, valid: false },
    ];
    expect(summarizeCliSamples(samples)).toEqual({
      durationMs: { mad: 10, median: 20, p95: 38, samples: 3 },
      peakRssBytes: { mad: 100, median: 200, p95: 290, samples: 3 },
    });
    expect(
      pairedBootstrapConfidenceInterval([100, 120], [40, 50], {
        iterations: 500,
        seed: 7,
      }),
    ).toEqual([-70, -60]);
  });

  it('keeps lane ownership fixed and requires an explicit packed fast-start budget', () => {
    const summary = {
      packed: { durationMs: { median: 45, p95: 49.5 } },
      'source-checkout': { durationMs: { median: 110, p95: 119 } },
    };
    expect(classifyCliStartup({ complete: true, summary })).toMatchObject({
      lanes: {
        packed: { audience: 'product' },
        'source-checkout': { audience: 'maintainer' },
      },
      metric: 'packed.durationMs.p95',
      recommendation: 'ratify-an-absolute-packed-startup-budget-before-reclassifying-work',
      status: 'budget-required',
    });
    expect(classifyCliStartup({ complete: true, packedFastBudgetMs: 50, summary })).toMatchObject({
      observedMs: 49.5,
      recommendation:
        'treat-source-transformation-or-prebuilt-checkout-work-as-maintainer-performance',
      status: 'packed-product-lane-fast',
    });
    expect(classifyCliStartup({ complete: true, packedFastBudgetMs: 40, summary })).toMatchObject({
      recommendation: 'prioritize-packed-cli-startup-as-product-devex',
      status: 'packed-product-lane-over-budget',
    });
  });

  it('runs quick smoke as one serialized B,S,S,B block with complete authenticated evidence', async () => {
    const commandOrder = [];
    const occurrence = { packed: 0, 'source-checkout': 0 };
    let cleaned = false;
    const durations = { packed: [40, 50], 'source-checkout': [100, 120] };
    const report = await runCliStartupBenchmark(
      { packedFastBudgetMs: 60, quickSmoke: true },
      {
        acquireLock: () => ({ release() {} }),
        hostFingerprint: () => ({ node: process.version, schema: 'test-host/v1' }),
        measure(argv) {
          const lane = argv[0];
          commandOrder.push(lane);
          const index = occurrence[lane]++;
          return {
            durationMs: durations[lane][index],
            error: null,
            exitCode: 0,
            peakRssBytes: lane === 'packed' ? 80 : 160,
            sampleCount: 2,
            signal: null,
            stderr: '',
            stdout: 'kovo 0.3.0\n',
          };
        },
        prepare: async () =>
          fakePrepared(() => {
            cleaned = true;
          }),
        provenance: () => cleanProvenance(),
        sampleHost: lowLoad,
      },
    );

    expect(commandOrder).toEqual(['source-checkout', 'packed', 'packed', 'source-checkout']);
    expect(cleaned).toBe(true);
    expect(report).toMatchObject({
      classification: {
        recommendation:
          'treat-source-transformation-or-prebuilt-checkout-work-as-maintainer-performance',
        status: 'packed-product-lane-fast',
      },
      integrity: {
        complete: true,
        errorCount: 0,
        errors: [],
        evidenceComplete: true,
        expectedSamples: 4,
        misses: 0,
        publishable: true,
        serialized: true,
        sourceStable: true,
        zeroDurationSamples: 0,
        zeroRssSamples: 0,
      },
      schema: CLI_STARTUP_BENCHMARK_SCHEMA,
      summary: {
        packed: { durationMs: { median: 45, samples: 2 } },
        paired: {
          durationMs: {
            bootstrap95Ci: [-70, -60],
            direction: 'packed-minus-source-checkout',
            medianDifference: -65,
            samples: 2,
          },
        },
        'source-checkout': { durationMs: { median: 110, samples: 2 } },
      },
      verdict: { reasons: [], status: 'measured' },
    });
  });

  it('marks an otherwise valid run unproven when source identity changes', async () => {
    let provenanceCall = 0;
    const report = await runCliStartupBenchmark(
      { quickSmoke: true },
      {
        acquireLock: () => ({ release() {} }),
        hostFingerprint: () => ({ schema: 'test-host/v1' }),
        measure() {
          return {
            durationMs: 10,
            error: null,
            exitCode: 0,
            peakRssBytes: 100,
            sampleCount: 1,
            signal: null,
            stderr: '',
            stdout: 'kovo 0.3.0\n',
          };
        },
        prepare: async () => fakePrepared(),
        provenance: () => cleanProvenance(String(++provenanceCall).repeat(40).slice(0, 40)),
        sampleHost: lowLoad,
      },
    );
    expect(report.integrity).toMatchObject({ complete: false, sourceStable: false });
    expect(report.classification.status).toBe('unproven');
    expect(report.verdict).toMatchObject({
      reasons: expect.arrayContaining(['source provenance changed during the run']),
      status: 'unproven',
    });
  });

  it('allows exploratory dirty runs but never classifies or publishes them', async () => {
    const dirty = {
      ...cleanProvenance(),
      dirty: true,
      dirtyPaths: [' M packages/cli/src/bin.ts'],
    };
    const report = await runCliStartupBenchmark(
      { allowDirty: true, packedFastBudgetMs: 100, quickSmoke: true },
      {
        acquireLock: () => ({ release() {} }),
        hostFingerprint: () => ({ schema: 'test-host/v1' }),
        measure() {
          return {
            durationMs: 10,
            error: null,
            exitCode: 0,
            peakRssBytes: 100,
            sampleCount: 1,
            signal: null,
            stderr: '',
            stdout: 'kovo 0.3.0\n',
          };
        },
        prepare: async () => fakePrepared(),
        provenance: () => dirty,
        sampleHost: lowLoad,
      },
    );
    expect(report.integrity).toMatchObject({
      complete: false,
      evidenceComplete: true,
      publishable: false,
    });
    expect(report.classification.status).toBe('unproven');
    expect(report.verdict).toMatchObject({
      reasons: expect.arrayContaining(['source provenance is dirty']),
      status: 'unproven',
    });
  });

  it('authenticates installed bytes and confines runtime resolution to consumer node_modules', () => {
    const consumerRoot = temporaryRoot();
    const packageRoot = path.join(consumerRoot, 'node_modules', '@kovojs', 'cli');
    mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
    const manifestBytes = Buffer.from(
      `${JSON.stringify({ name: '@kovojs/cli', version: '0.0.0' })}\n`,
    );
    const chunkBytes = Buffer.from('export const loaded = true;\n');
    const binBytes = Buffer.from("import './chunk.mjs';\nprocess.stdout.write('kovo 0.0.0\\n');\n");
    writeFileSync(path.join(packageRoot, 'package.json'), manifestBytes);
    writeFileSync(path.join(packageRoot, 'dist', 'bin.mjs'), binBytes);
    writeFileSync(path.join(packageRoot, 'dist', 'chunk.mjs'), chunkBytes);
    mkdirSync(path.join(packageRoot, 'node_modules', '.bin'), { recursive: true });
    writeFileSync(path.join(packageRoot, 'node_modules', '.bin', 'pnpm-generated-shim'), 'shim\n');
    const artifacts = [
      {
        entries: [
          { data: manifestBytes, name: 'package/package.json' },
          { data: binBytes, name: 'package/dist/bin.mjs' },
          { data: chunkBytes, name: 'package/dist/chunk.mjs' },
        ],
        name: '@kovojs/cli',
      },
    ];
    const installation = assertInstalledPackedPackages(consumerRoot, artifacts);
    expect(installation).toMatchObject({
      packageCensusMatched: 1,
      packageFilesMatched: 3,
    });
    const proof = runPackedResolutionProof({
      consumerRoot,
      expectedStdout: 'kovo 0.0.0\n',
      installedCli: installation.installedCli,
    });
    expect(proof).toMatchObject({
      confined: true,
      loadedFiles: ['@kovojs/cli/dist/bin.mjs', '@kovojs/cli/dist/chunk.mjs'],
      workspaceSourceLoaded: false,
    });

    writeFileSync(path.join(packageRoot, 'dist', 'bin.mjs'), 'tampered\n');
    expect(() => assertInstalledPackedPackages(consumerRoot, artifacts)).toThrow(
      /differs from its authenticated tarball/u,
    );
  });

  it('rejects a packed entry that resolves a file outside isolated node_modules', () => {
    const consumerRoot = temporaryRoot();
    const distRoot = path.join(consumerRoot, 'node_modules', '@kovojs', 'cli', 'dist');
    mkdirSync(distRoot, { recursive: true });
    const outside = path.join(consumerRoot, 'workspace-source.mjs');
    writeFileSync(outside, 'export const outside = true;\n');
    const installedCli = path.join(distRoot, 'bin.mjs');
    writeFileSync(
      installedCli,
      `import ${JSON.stringify(pathToFileURL(outside).href)};\nprocess.stdout.write('kovo 0.0.0\\n');\n`,
    );
    expect(() =>
      runPackedResolutionProof({
        consumerRoot,
        expectedStdout: 'kovo 0.0.0\n',
        installedCli,
      }),
    ).toThrow(/resolved outside isolated node_modules/u);
  });

  it('parses bounded smoke, evidence, and classification options', () => {
    expect(
      parseCliStartupArgs([
        '--quick-smoke',
        '--allow-dirty',
        '--packed-fast-budget-ms',
        '75',
        '--out',
        '/tmp/report.json',
      ]),
    ).toEqual({
      allowDirty: true,
      out: '/tmp/report.json',
      packedFastBudgetMs: 75,
      quickSmoke: true,
    });
    expect(() => parseCliStartupArgs(['--samples'])).toThrow(/requires a value/u);
    expect(() => parseCliStartupArgs(['--unknown'])).toThrow(/unsupported/u);
  });
});
