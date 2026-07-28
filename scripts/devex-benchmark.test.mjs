import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DEVEX_BENCHMARK_REPORT_SCHEMA,
  DEVEX_PACKED_PROFILE_COMMAND_DIGEST,
  benchmarkScenarioDigest,
  browserBootstrapBytes,
  createRunnerFingerprint,
  evaluateBudgets,
  median,
  medianAbsoluteDeviation,
  percentile,
  ratifyBudgets,
  runBenchmarkScenario,
  validateBudgets,
  validateKovoBrowserWorkload,
} from './devex-benchmark.mjs';
import { validatedPackageTarballEntries } from './lib/deterministic-tarball.mjs';
import { packWithoutLifecycleScripts } from './lib/pack-without-lifecycle.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const fixtureRoot = fileURLToPath(new URL('./fixtures/devex-benchmark/', import.meta.url));
const scenario = JSON.parse(readFileSync(path.join(fixtureRoot, 'scenario.json'), 'utf8'));
const budgets = JSON.parse(readFileSync(path.join(repoRoot, 'devex-budgets.json'), 'utf8'));
const kovoScenarioRecipe = JSON.parse(
  readFileSync(path.join(repoRoot, 'scripts/devex-scenarios/kovo-packed-check.json'), 'utf8'),
);
const kovoPackedProfileSource = readFileSync(
  path.join(repoRoot, 'scripts/devex-workloads/kovo-packed-check/package/profile.mjs'),
  'utf8',
);
const kovoPackedWorkloadSource = readFileSync(
  path.join(repoRoot, 'scripts/devex-workloads/kovo-packed-check/package/workload.mjs'),
  'utf8',
);
const kovoPackedBrowserBuildSource = readFileSync(
  path.join(repoRoot, 'scripts/devex-workloads/kovo-packed-check/package/build-browser.mjs'),
  'utf8',
);
const devexBenchmarkSource = readFileSync(
  path.join(repoRoot, 'scripts/devex-benchmark.mjs'),
  'utf8',
);
const observedEnvironment = {
  ...scenario.environment,
  sourceCommit: scenario.provenance.sourceCommit,
  sourceTree: 'clean',
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
    const stageRoots = new Set();
    const invocations = [];
    const report = runBenchmarkScenario(scenario, {
      root: fixtureRoot,
      samples: 5,
      observedEnvironment,
      allowFixtureScenario: true,
      measure(command, context) {
        expect(command).toEqual(['node', 'profile.mjs', context.executionPhase]);
        expect(path.basename(context.cwd)).toMatch(/^kovo-devex-benchmark-/u);
        stageRoots.add(context.stageRoot);
        invocations.push({
          phase: context.phase,
          role: context.role,
          sampleIndex: context.sampleIndex,
          baseline: context.env?.KOVO_DEVEX_EDIT_BASELINE ?? null,
        });
        expect(readFileSync(path.join(context.cwd, 'profile.mjs'), 'utf8')).toContain(
          'kovo-check-input',
        );
        expect(
          JSON.parse(readFileSync(path.join(context.cwd, 'package.json'), 'utf8')),
        ).toMatchObject({ name: '@fixture/kovo-packed-benchmark' });
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
      sourceTree: 'clean',
      packageManager: scenario.environment.packageManager,
      osImage: scenario.environment.osImage,
      workloadManifest: scenario.provenance.workloadManifest,
      commandDigest: DEVEX_PACKED_PROFILE_COMMAND_DIGEST,
      packedArtifacts: scenario.provenance.packedArtifacts,
      supportFiles: scenario.provenance.supportFiles,
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
    expect(stageRoots.size).toBe(15);
    expect(invocations.filter((item) => item.role === 'prime')).toHaveLength(10);
    expect(report.phaseCensus).toEqual({
      schema: 'kovo-devex-phase-census/v2',
      samples: 5,
      counts: {
        cold: { prime: 0, timed: 5 },
        warm: { prime: 5, timed: 5 },
        oneFileIncremental: { prime: 5, timed: 5 },
      },
      incrementalRevisions: [1, 0, 1, 0, 1],
      analysisInputs: fixtureAnalysisInputs(5),
    });
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
    expect(report.commands).toEqual({
      cold: { command: ['node', 'profile.mjs', 'cold'], cwd: '.' },
      warm: { command: ['node', 'profile.mjs', 'warm'], cwd: '.' },
      oneFileIncremental: {
        command: ['node', 'profile.mjs', 'oneFileIncremental'],
        cwd: '.',
      },
    });
  });

  it('refuses forged source and packed-artifact provenance before measuring', () => {
    const wrongCommit = structuredClone(scenario);
    wrongCommit.provenance.sourceCommit = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    expect(() =>
      runBenchmarkScenario(wrongCommit, {
        root: fixtureRoot,
        observedEnvironment,
        allowFixtureScenario: true,
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
        allowFixtureScenario: true,
        measure: () => {
          throw new Error('measurement must not start');
        },
      }),
    ).toThrow('workload manifest artifacts do not match scenario provenance');

    const dirtySource = structuredClone(observedEnvironment);
    dirtySource.sourceTree = 'dirty';
    expect(() =>
      runBenchmarkScenario(scenario, {
        root: fixtureRoot,
        observedEnvironment: dirtySource,
        allowFixtureScenario: true,
        measure: () => {
          throw new Error('measurement must not start');
        },
      }),
    ).toThrow('observedEnvironment.sourceTree must be clean');
  });

  it('authenticates, parses, and unpacks a canonical tarball instead of accepting decoy bytes', () => {
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-benchmark-decoy-'));
    const copiedFixture = path.join(temporaryRoot, 'fixture');
    try {
      cpSync(fixtureRoot, copiedFixture, { recursive: true });
      const tarballPath = path.join(copiedFixture, 'packed-fixture.tgz');
      const decoy = Buffer.from('not a tarball');
      writeFileSync(tarballPath, decoy);
      const decoyDigest = digest(decoy);
      const manifestPath = path.join(copiedFixture, 'packed-workload.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.artifacts[0].sha256 = decoyDigest;
      const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
      writeFileSync(manifestPath, manifestBytes);
      const decoyScenario = structuredClone(scenario);
      decoyScenario.provenance.packedArtifacts[0].sha256 = decoyDigest;
      decoyScenario.provenance.workloadManifest.sha256 = digest(manifestBytes);

      expect(() =>
        runBenchmarkScenario(decoyScenario, {
          root: copiedFixture,
          observedEnvironment,
          allowFixtureScenario: true,
          measure: () => {
            throw new Error('measurement must not start');
          },
        }),
      ).toThrow('invalid canonical package tarball');
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('rejects a canonical forged CLI plus coherent ignored self-attestation on clean HEAD', () => {
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-benchmark-forged-release-'));
    const packageRoot = path.join(temporaryRoot, 'fake-cli');
    const ignoredReleaseRoot = path.join(temporaryRoot, '.release');
    const ignoredTarballRoot = path.join(ignoredReleaseRoot, 'tarballs');
    const scenarioRoot = path.join(ignoredReleaseRoot, 'devex');
    const scenarioTarballRoot = path.join(scenarioRoot, 'tarballs');
    let measured = false;
    let disposed = false;
    try {
      mkdirSync(packageRoot, { recursive: true });
      mkdirSync(ignoredTarballRoot, { recursive: true });
      mkdirSync(scenarioTarballRoot, { recursive: true });
      const fakePackageManifest = {
        name: '@kovojs/cli',
        version: '0.2.0',
        type: 'module',
        files: ['boot.mjs', 'profile.mjs'],
      };
      writeFileSync(
        path.join(packageRoot, 'package.json'),
        `${JSON.stringify(fakePackageManifest, null, 2)}\n`,
      );
      writeFileSync(path.join(packageRoot, 'boot.mjs'), "document.body.dataset.forged = 'true';\n");
      writeFileSync(
        path.join(packageRoot, 'profile.mjs'),
        "process.stdout.write('forged metrics input must never execute\\n');\n",
      );
      const ignoredTarball = packWithoutLifecycleScripts(
        {
          name: '@kovojs/cli',
          version: '0.2.0',
          dirPath: packageRoot,
        },
        ignoredTarballRoot,
      );
      const tarballBytes = readFileSync(ignoredTarball);
      const entries = validatedPackageTarballEntries(tarballBytes);
      const packedManifest = JSON.parse(
        entries.find((entry) => entry.name === 'package/package.json').data.toString('utf8'),
      );
      const scenarioTarball = path.join(scenarioTarballRoot, path.basename(ignoredTarball));
      cpSync(ignoredTarball, scenarioTarball);
      const files = entries.map((entry) => ({
        path: entry.name.slice('package/'.length),
        sha256: digest(entry.data),
        executable: entry.executable,
      }));
      const artifact = {
        name: '@kovojs/cli',
        role: 'consumer',
        path: `tarballs/${path.basename(scenarioTarball)}`,
        sha256: digest(tarballBytes),
        files,
      };
      const fakeWorkload = {
        schema: 'kovo-devex-packed-workload/v2',
        profile: {
          id: 'kovo-packed-check/v2',
          commandDigest: DEVEX_PACKED_PROFILE_COMMAND_DIGEST,
        },
        entrypoint: 'profile.mjs',
        artifacts: [artifact],
        browserBootstrap: ['boot.mjs'],
      };
      const fakeWorkloadBytes = Buffer.from(`${JSON.stringify(fakeWorkload, null, 2)}\n`);
      writeFileSync(path.join(scenarioRoot, 'packed-workload.json'), fakeWorkloadBytes);
      const ignoredManifest = {
        schema: 'kovo.packed-public-packages/v2',
        packages: [
          {
            name: '@kovojs/cli',
            version: '0.2.0',
            tarball: `.release/tarballs/${path.basename(ignoredTarball)}`,
            sha512: `sha512-${createHash('sha512').update(tarballBytes).digest('base64')}`,
            files: entries.map((entry) => entry.name),
            manifest: packedManifest,
          },
        ],
      };
      writeFileSync(
        path.join(ignoredReleaseRoot, 'packed-packages.json'),
        `${JSON.stringify(ignoredManifest, null, 2)}\n`,
      );
      const forgedScenario = structuredClone(scenario);
      forgedScenario.name = 'kovo-packed-check';
      forgedScenario.provenance.workloadManifest = {
        path: 'packed-workload.json',
        sha256: digest(fakeWorkloadBytes),
      };
      forgedScenario.provenance.packedArtifacts = [
        {
          name: artifact.name,
          path: artifact.path,
          sha256: artifact.sha256,
        },
      ];
      forgedScenario.provenance.supportFiles = files;
      const freshScenario = structuredClone(forgedScenario);
      freshScenario.provenance.packedArtifacts[0].sha256 = `sha256:${'f'.repeat(64)}`;

      expect(
        ignoredManifest.packages[0],
        'the attack fixture must be coherent enough to self-attest its canonical fake tarball',
      ).toMatchObject({
        name: '@kovojs/cli',
        sha512: `sha512-${createHash('sha512').update(tarballBytes).digest('base64')}`,
        files: entries.map((entry) => entry.name),
        manifest: packedManifest,
      });
      expect(() =>
        runBenchmarkScenario(forgedScenario, {
          root: scenarioRoot,
          observedEnvironment,
          acquireFreshKovoScenario: () => ({
            producer: 'kovo-clean-source-pack/v1',
            sourceCommit: observedEnvironment.sourceCommit,
            scenario: freshScenario,
            root: scenarioRoot,
            repositoryRoot: repoRoot,
            dispose() {
              disposed = true;
            },
          }),
          measure: () => {
            measured = true;
            throw new Error('forged workload must not drive measurement');
          },
        }),
      ).toThrow('exact code-owned Kovo release and benchmark consumer census');
      expect(measured).toBe(false);
      expect(disposed).toBe(false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('executes every code-owned profile from the unpacked consumer', () => {
    const report = runBenchmarkScenario(scenario, {
      root: fixtureRoot,
      samples: 1,
      observedEnvironment,
      allowFixtureScenario: true,
    });
    for (const phase of ['cold', 'warm', 'oneFileIncremental']) {
      expect(report.metrics[`check.${phase}.durationMs`].samples).toHaveLength(1);
      expect(report.metrics[`check.${phase}.durationMs`].samples[0]).toBeGreaterThan(0);
    }
  });

  it('keeps fixture scenarios behind an explicit test-only seam', () => {
    expect(() =>
      runBenchmarkScenario(scenario, {
        root: fixtureRoot,
        observedEnvironment,
        measure: () => {
          throw new Error('non-Kovo fixture must not drive production measurement');
        },
      }),
    ).toThrow('production benchmark measurement accepts only the code-owned fresh Kovo scenario');
  });

  it('ships a real Kovo packed-check recipe whose profile invokes only the staged CLI', () => {
    expect(kovoScenarioRecipe).toEqual({
      schema: 'kovo-devex-scenario-recipe/v1',
      name: 'kovo-packed-check',
      profile: 'kovo-packed-check/v2',
      producer: 'kovo-clean-source-pack/v1',
      consumerSource: 'scripts/devex-workloads/kovo-packed-check/package',
      output: '.release/devex/kovo-packed-scenario.json',
    });
    expect(kovoPackedWorkloadSource).toContain(
      "path.resolve('node_modules/@kovojs/cli/dist/bin.mjs')",
    );
    expect(kovoPackedWorkloadSource).toContain(
      "SOURCE_PATH = 'src/components/counter-island.tsx'",
    );
    expect(kovoPackedWorkloadSource).toContain("'build', './src/app.tsx'");
    expect(kovoPackedWorkloadSource).toContain("'dist/.kovo/graph.json'");
    expect(kovoPackedProfileSource).toContain("phase === 'oneFileIncremental'");
    expect(kovoPackedProfileSource).toContain('kovo-benchmark-phase/v2');
    expect(kovoPackedProfileSource).not.toContain('packages/cli');
    expect(kovoPackedWorkloadSource).not.toContain("writeFileSync('graph.json'");
    expect(kovoPackedBrowserBuildSource).toContain('emitQueryPlanBootstrapModule');
    expect(kovoPackedBrowserBuildSource).toContain("'generated/app.client.js'");
    expect(devexBenchmarkSource).toContain(
      "browserBootstrap: ['dist/.kovo/client/generated/app.client.js']",
    );
    expect(kovoPackedProfileSource).not.toContain('workspace:');
    expect(devexBenchmarkSource).toContain("['worktree', 'add', '--detach'");
    expect(devexBenchmarkSource).toContain(
      "['install', '--offline', '--frozen-lockfile', '--ignore-scripts']",
    );
    expect(devexBenchmarkSource).toContain("['run', 'check:publish']");
  });

  it('keeps every provisional budget non-binding before baseline ratification', () => {
    expect(validateBudgets(budgets)).toEqual([]);
    expect(Object.values(budgets.metrics).every((metric) => metric.ratification === null)).toBe(
      true,
    );
    expect(budgets.runner.status).toBe('unratified');
  });

  it('closes the v5 metric vocabulary against invented and deleted gates', () => {
    expect(budgets.schema).toBe('kovo-devex-budgets/v5');
    expect(budgets.metrics).toMatchObject({
      'create.install.cold.durationMs': {
        unit: 'ms',
        sampling: 'statistical',
        ratification: null,
      },
      'create.install.installedBytes': {
        unit: 'bytes',
        sampling: 'deterministic',
        ratification: null,
      },
      'dev.editToDiagnostic.durationMs': {
        unit: 'ms',
        provisionalTarget: 1000,
        ratification: null,
      },
      'dev.editToServedResult.durationMs': {
        unit: 'ms',
        provisionalTarget: 500,
        ratification: null,
      },
      'dev.ready.cold.durationMs': {
        unit: 'ms',
        provisionalTarget: 15000,
        ratification: null,
      },
      'dev.ready.warm.durationMs': {
        unit: 'ms',
        provisionalTarget: 5000,
        ratification: null,
      },
    });
    const invented = structuredClone(budgets);
    invented.metrics['invented.fastEnough'] = {
      unit: 'ms',
      direction: 'max',
      sampling: 'statistical',
      provisionalTarget: 1,
      ratification: null,
    };
    expect(validateBudgets(invented)).toContainEqual(
      expect.stringContaining('must contain the exact kovo-devex-budgets/v5 vocabulary'),
    );

    const deleted = structuredClone(budgets);
    delete deleted.metrics['check.cold.durationMs'];
    expect(validateBudgets(deleted)).toContainEqual(
      expect.stringContaining('must contain the exact kovo-devex-budgets/v5 vocabulary'),
    );
  });

  it('rejects source bootstrap stubs in place of emitted browser assets', () => {
    const sourceFiles = [
      { path: 'browser-bootstrap.mjs', sha256: `sha256:${'a'.repeat(64)}`, executable: false },
      ...[
        'build-browser.mjs',
        'profile.mjs',
        'src/app.tsx',
        'src/components/counter-island.tsx',
        'workload.mjs',
      ].map((file) => ({
        path: file,
        sha256: `sha256:${'b'.repeat(64)}`,
        executable: false,
      })),
    ];
    expect(
      validateKovoBrowserWorkload(
        {
          browserBuild: { command: ['node', 'build-browser.mjs'], cwd: '.' },
          browserBootstrap: ['browser-bootstrap.mjs'],
        },
        sourceFiles,
      ),
    ).toContain(
      'Kovo packed workload browser bootstrap must name emitted client assets, not packed source files',
    );
    expect(
      validateKovoBrowserWorkload(
        {
          browserBuild: { command: ['node', 'build-browser.mjs'], cwd: '.' },
          browserBootstrap: ['dist/.kovo/client/generated/app.client.js'],
        },
        sourceFiles,
      ),
    ).toEqual([]);
  });

  it('rejects a renamed fixture report as a production Kovo baseline', () => {
    const forgedDefinition = structuredClone(scenario);
    forgedDefinition.name = 'kovo-packed-check';
    const forged = benchmarkReport(
      { 'check.cold.durationMs': [1, 1, 1, 1, 1] },
      { definition: forgedDefinition },
    );
    const source = baselineOptions(forged);
    expect(() =>
      ratifyBudgets(
        budgets,
        forged,
        {
          schema: 'kovo-devex-budget-proposal/v5',
          runnerFingerprint: forged.runner,
          metrics: {
            'check.cold.durationMs': {
              budget: 1,
              noiseMultiplier: 0,
              targetRationale: 'A cheap fixture must not become a production baseline.',
            },
          },
        },
        source.ratificationOptions,
      ),
    ).toThrow(
      'budget ratification requires the exact production scenario authenticated by the fresh code-owned pack producer',
    );
  });

  it('represents deterministic documentation snapshot sizes without inventing thresholds', () => {
    for (const metricId of ['docs.snapshot.compressedBytes', 'docs.snapshot.installedBytes']) {
      expect(budgets.metrics[metricId]).toEqual({
        unit: 'bytes',
        direction: 'max',
        sampling: 'deterministic',
        provisionalTarget: null,
        ratification: null,
      });
    }
  });

  it('rejects bootstrap traversal, direct symlinks, and symlink-parent escapes', () => {
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-bootstrap-boundary-'));
    const scenarioRoot = path.join(temporaryRoot, 'scenario');
    const outsideRoot = path.join(temporaryRoot, 'outside');
    try {
      cpSync(fixtureRoot, scenarioRoot, { recursive: true });
      cpSync(path.join(fixtureRoot, 'package'), outsideRoot, { recursive: true });
      symlinkSync(
        path.join(outsideRoot, 'bootstrap-a.mjs'),
        path.join(scenarioRoot, 'linked-bootstrap.mjs'),
      );
      symlinkSync(outsideRoot, path.join(scenarioRoot, 'linked-parent'), 'dir');
      symlinkSync(path.join(scenarioRoot, 'package'), path.join(scenarioRoot, 'alias'), 'dir');

      expect(() =>
        browserBootstrapBytes(['../outside/bootstrap-a.mjs'], { root: scenarioRoot }),
      ).toThrow('must be a canonical relative path');
      expect(() =>
        browserBootstrapBytes(['linked-parent\\bootstrap-a.mjs'], { root: scenarioRoot }),
      ).toThrow('must be a canonical relative path');
      expect(() => browserBootstrapBytes(['linked-bootstrap.mjs'], { root: scenarioRoot })).toThrow(
        'contains a symbolic-link path segment',
      );
      expect(() =>
        browserBootstrapBytes(['linked-parent/bootstrap-a.mjs'], { root: scenarioRoot }),
      ).toThrow('contains a symbolic-link path segment');
      expect(() =>
        browserBootstrapBytes(['alias/bootstrap-a.mjs'], { root: scenarioRoot }),
      ).toThrow('contains a symbolic-link path segment');
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
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
    expect(() =>
      ratifyFixtureBudgets(report, {
        'check.cold.durationMs': {
          budget: 90,
          noiseMultiplier: 3,
          targetRationale: 'A target that still needs a real baseline sample set.',
        },
      }),
    ).toThrow('has 1 baseline samples; 5 required');
  });

  it('refuses to ratify or evaluate a differently pinned runner/scenario identity', () => {
    const defaultReport = benchmarkReport({
      'check.cold.durationMs': [100, 101, 102, 103, 104],
    });
    const proposal = {
      schema: 'kovo-devex-budget-proposal/v5',
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
    ).toThrow(
      'budget ratification requires the exact production scenario authenticated by the fresh code-owned pack producer',
    );

    const source = baselineOptions(defaultReport);
    const { ratified } = ratifyFixtureBudgets(defaultReport, proposal.metrics);
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
    cheapScenario.phases = {
      cold: { command: ['node', '-e', 'void 0'], cwd: '../../outside' },
    };
    const cheapReport = benchmarkReport(
      { 'check.cold.durationMs': [1, 1, 1, 1, 1] },
      { definition: cheapScenario },
    );
    expect(() => evaluateBudgets(ratified, cheapReport, validationOptions)).toThrow(
      'report.scenario.phases is not part of the packed benchmark contract',
    );

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

    const forgedPhaseCensus = benchmarkReport({
      'check.cold.durationMs': [90, 91, 92, 93, 94],
    });
    forgedPhaseCensus.phaseCensus.incrementalRevisions = [0, 0, 0, 0, 0];
    expect(() => evaluateBudgets(ratified, forgedPhaseCensus, validationOptions)).toThrow(
      'report.phaseCensus.incrementalRevisions must prove alternating restored source edits',
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

function fixtureAnalysisInputs(sampleCount) {
  const inputs = [];
  for (const phase of ['cold', 'warm', 'oneFileIncremental']) {
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const baseline = sampleIndex % 2;
      if (phase !== 'cold') {
        const revision = phase === 'oneFileIncremental' ? baseline : 0;
        inputs.push({
          phase,
          role: 'prime',
          sampleIndex,
          revision,
          analysisDigest: `sha256:${String(revision).repeat(64)}`,
          clientDigest: 'f'.repeat(64),
        });
      }
      const revision =
        phase === 'oneFileIncremental' ? (baseline === 0 ? 1 : 0) : 0;
      inputs.push({
        phase,
        role: 'timed',
        sampleIndex,
        revision,
        analysisDigest: `sha256:${String(revision).repeat(64)}`,
        clientDigest: 'f'.repeat(64),
      });
    }
  }
  return inputs;
}

function benchmarkReport(metricSamples, options = {}) {
  const definition = structuredClone(options.definition ?? scenario);
  const sampleCount = Math.max(...Object.values(metricSamples).map((samples) => samples.length));
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
      sourceTree: definition.provenance.sourceTree,
      packageManager: definition.environment.packageManager,
      osImage: definition.environment.osImage,
      workloadManifest: structuredClone(definition.provenance.workloadManifest),
      commandDigest: definition.profile.commandDigest,
      packedArtifacts: structuredClone(definition.provenance.packedArtifacts),
      supportFiles: structuredClone(definition.provenance.supportFiles),
      ...(definition.provenance.producerAttestation === undefined
        ? {}
        : { producerAttestation: structuredClone(definition.provenance.producerAttestation) }),
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
    sampleCount,
    phaseCensus: {
      schema: 'kovo-devex-phase-census/v2',
      samples: sampleCount,
      counts: {
        cold: { prime: 0, timed: sampleCount },
        warm: { prime: sampleCount, timed: sampleCount },
        oneFileIncremental: { prime: sampleCount, timed: sampleCount },
      },
      incrementalRevisions: Array.from({ length: sampleCount }, (_, index) =>
        index % 2 === 0 ? 1 : 0,
      ),
      analysisInputs: fixtureAnalysisInputs(sampleCount),
    },
    commands: {
      cold: { command: ['node', 'profile.mjs', 'cold'], cwd: '.' },
      warm: { command: ['node', 'profile.mjs', 'warm'], cwd: '.' },
      oneFileIncremental: {
        command: ['node', 'profile.mjs', 'oneFileIncremental'],
        cwd: '.',
      },
    },
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
  const ratified = structuredClone(budgets);
  const workloadIdentity = {
    scenario: {
      name: report.scenario.name,
      digest: report.scenario.digest,
    },
    provenance: structuredClone(report.provenance),
  };
  ratified.runner = {
    status: 'ratified',
    fingerprint: structuredClone(report.runner),
  };
  ratified.workload = {
    status: 'ratified',
    identity: workloadIdentity,
  };
  for (const [metricId, proposal] of Object.entries(metrics)) {
    const metric = ratified.metrics[metricId];
    const samples = report.metrics?.[metricId]?.samples;
    const requiredSamples =
      metric.sampling === 'deterministic' ? 1 : ratified.procedure.minimumStatisticalSamples;
    if (!Array.isArray(samples) || samples.length < requiredSamples) {
      throw new Error(
        `${metricId} has ${samples?.length ?? 0} baseline samples; ${requiredSamples} required`,
      );
    }
    const statistic = proposal.statistic ?? ratified.procedure.statistic;
    const baseline = statistic === 'p95' ? percentile(samples, 0.95) : median(samples);
    const noise = metric.sampling === 'deterministic' ? 0 : medianAbsoluteDeviation(samples);
    metric.ratification = {
      runnerFingerprint: structuredClone(report.runner),
      workloadIdentity: structuredClone(workloadIdentity),
      baselineReport: {
        path: source.ratificationOptions.baselineReportPath,
        sha256: digest(source.ratificationOptions.baselineReportBytes),
        schema: report.schema,
        scenarioName: report.scenario.name,
        scenarioDigest: report.scenario.digest,
      },
      sampleCount: samples.length,
      statistic,
      baseline,
      targetRationale: proposal.targetRationale,
      budget: proposal.budget,
      noiseStatistic: ratified.procedure.noiseStatistic,
      noise,
      noiseMultiplier: proposal.noiseMultiplier,
      threshold: proposal.budget + proposal.noiseMultiplier * noise,
    };
  }
  return {
    ratified,
    validationOptions: source.validationOptions,
  };
}

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
