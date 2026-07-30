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
  DEVEX_DETERMINISTIC_ARTIFACT_REPORT_SCHEMA,
  DEVEX_PACKED_PROFILE_COMMAND_DIGEST,
  benchmarkWorkloadContractIdentity,
  benchmarkScenarioDigest,
  browserBootstrapBytes,
  createRunnerFingerprint,
  evaluateBudgets,
  median,
  medianAbsoluteDeviation,
  packedArtifactBinding,
  percentile,
  ratifyBudgets,
  runBenchmarkScenario,
  validateBudgets,
  validateDeterministicArtifactReportIdentity,
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
const kovoPackedDevProfileSource = readFileSync(
  path.join(repoRoot, 'scripts/devex-workloads/kovo-packed-check/package/dev-profile.mjs'),
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

  it('records check, ready, edit, RSS, and browser-byte metrics as separate units', () => {
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
      measureDev(command, context) {
        expect(command).toEqual(['node', 'dev-profile.mjs']);
        expect(context).toMatchObject({
          executionPhase: 'dev',
          phase: 'dev',
          role: 'timed',
        });
        expect(readFileSync(path.join(context.cwd, 'dev-profile.mjs'), 'utf8')).toContain(
          'kovo-dev-profile/v1',
        );
        return fixtureDevProfileResult(context.sampleIndex);
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
    expect(report.metrics['dev.ready.cold.durationMs'].samples).toEqual([12, 13, 14, 15, 16]);
    expect(report.metrics['dev.ready.warm.durationMs'].samples).toEqual([5, 6, 7, 8, 9]);
    expect(report.metrics['dev.editToDiagnostic.durationMs'].samples).toEqual([3, 4, 5, 6, 7]);
    expect(report.metrics['dev.editToServedResult.durationMs'].samples).toEqual([4, 5, 6, 7, 8]);
    expect(stageRoots.size).toBe(15);
    expect(invocations.filter((item) => item.role === 'prime')).toHaveLength(10);
    expect(report.phaseCensus).toEqual({
      schema: 'kovo-devex-phase-census/v4',
      samples: 5,
      counts: {
        cold: { prime: 0, timed: 5 },
        warm: { prime: 5, timed: 5 },
        oneFileIncremental: { prime: 5, timed: 5 },
      },
      incrementalRevisions: [1, 0, 1, 0, 1],
      analysisInputs: fixtureAnalysisInputs(5),
    });
    expect(report.devPhaseCensus).toEqual({
      schema: 'kovo-devex-dev-phase-census/v1',
      samples: 5,
      observations: fixtureDevObservations(5),
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
      dev: { command: ['node', 'dev-profile.mjs'], cwd: '.' },
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
          id: 'kovo-packed-check/v3',
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
    for (const metric of [
      'dev.ready.cold.durationMs',
      'dev.ready.warm.durationMs',
      'dev.editToDiagnostic.durationMs',
      'dev.editToServedResult.durationMs',
    ]) {
      expect(report.metrics[metric].samples).toHaveLength(1);
      expect(report.metrics[metric].samples[0]).toBeGreaterThanOrEqual(0);
    }
  });

  it('rejects forged dev transition evidence before it reaches report metrics', () => {
    const forged = fixtureDevEvidence(0);
    forged.served.sourceDigest = forged.diagnostic.sourceDigest;
    expect(() =>
      runBenchmarkScenario(scenario, {
        root: fixtureRoot,
        samples: 1,
        observedEnvironment,
        allowFixtureScenario: true,
        measure: () => ({
          durationMs: 1,
          peakRssBytes: 1024,
          exitCode: 0,
          signal: null,
          error: null,
          stderr: '',
          stdout: '',
        }),
        measureDev: () => ({
          durationMs: 1,
          peakRssBytes: 1024,
          exitCode: 0,
          signal: null,
          error: null,
          stderr: '',
          stdout: `kovo-dev-profile/v1 ${JSON.stringify(forged)}\n`,
        }),
      }),
    ).toThrow('returned invalid transition evidence');
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
      profile: 'kovo-packed-check/v3',
      producer: 'kovo-clean-source-pack/v1',
      consumerSource: 'scripts/devex-workloads/kovo-packed-check/package',
      output: '.release/devex/kovo-packed-scenario.json',
    });
    expect(kovoPackedWorkloadSource).toContain(
      "path.resolve('node_modules/@kovojs/cli/dist/bin.mjs')",
    );
    expect(kovoPackedWorkloadSource).toContain("SOURCE_PATH = 'src/components/counter-island.tsx'");
    expect(kovoPackedWorkloadSource).toContain("'build', './src/app.tsx'");
    expect(kovoPackedWorkloadSource).toContain("'dist/.kovo/graph.json'");
    expect(kovoPackedProfileSource).toContain("phase === 'oneFileIncremental'");
    expect(kovoPackedProfileSource).toContain('kovo-benchmark-phase/v4');
    expect(kovoPackedProfileSource).toContain('runVerifiedCheck');
    expect(kovoPackedProfileSource).toContain('graph=${evidence.checkGraphDigest}');
    expect(kovoPackedWorkloadSource).toContain("'check', 'source', './src/app.tsx'");
    expect(kovoPackedWorkloadSource).toContain('KOVO_DEVEX_CHECK_PHASE_CENSUS_SOURCE');
    expect(kovoPackedWorkloadSource).toContain('kovo-check-phase-census/v1');
    expect(kovoPackedWorkloadSource).toContain("import { app } from '../kovo.js'");
    expect(kovoPackedWorkloadSource).toContain('app.query({');
    expect(kovoPackedWorkloadSource).not.toContain(
      "import { publicAccess, query, s } from '@kovojs/server'",
    );
    expect(kovoPackedProfileSource).toContain('duration=');
    expect(kovoPackedProfileSource).toContain('rss=');
    expect(kovoPackedDevProfileSource).toContain("'dev',");
    expect(kovoPackedDevProfileSource).toContain('kovo-dev-profile/v1');
    expect(kovoPackedDevProfileSource).toContain('KV235');
    expect(kovoPackedDevProfileSource).toContain('data-revision');
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

  it('keeps runner-bound provisional budgets non-binding before runner ratification', () => {
    expect(validateBudgets(budgets, { repoRoot })).toEqual([]);
    expect(
      Object.entries(budgets.metrics)
        .filter(([metricId]) => !metricId.startsWith('docs.snapshot.'))
        .every(([, metric]) => metric.ratification === null),
    ).toBe(true);
    expect(
      ['docs.snapshot.compressedBytes', 'docs.snapshot.installedBytes'].every(
        (metricId) => budgets.metrics[metricId].ratification !== null,
      ),
    ).toBe(true);
    expect(budgets.runner.status).toBe('unratified');
  });

  it('closes the v5 metric vocabulary against invented and deleted gates', () => {
    expect(budgets.schema).toBe('kovo-devex-budgets/v8');
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
      expect.stringContaining('must contain the exact kovo-devex-budgets/v8 vocabulary'),
    );

    const deleted = structuredClone(budgets);
    delete deleted.metrics['check.cold.durationMs'];
    expect(validateBudgets(deleted)).toContainEqual(
      expect.stringContaining('must contain the exact kovo-devex-budgets/v8 vocabulary'),
    );
  });

  it('rejects source bootstrap stubs in place of emitted browser assets', () => {
    const sourceFiles = [
      { path: 'browser-bootstrap.mjs', sha256: `sha256:${'a'.repeat(64)}`, executable: false },
      ...[
        'benchmark-lock.yaml',
        'build-browser.mjs',
        'dev-profile.mjs',
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
          schema: 'kovo-devex-budget-proposal/v7',
          runnerFingerprint: forged.runner,
          metrics: {
            'check.cold.durationMs': {
              budget: 1,
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
    for (const [metricId, baseline, budget] of [
      ['docs.snapshot.compressedBytes', 1_077_819, 1_310_720],
      ['docs.snapshot.installedBytes', 4_291_085, 5_242_880],
    ]) {
      expect(budgets.metrics[metricId]).toMatchObject({
        unit: 'bytes',
        direction: 'max',
        sampling: 'deterministic',
        binding: 'packed-artifact',
        provisionalTarget: null,
        ratification: {
          baseline,
          budget,
          noise: 0,
          noiseMultiplier: 0,
          runnerFingerprint: null,
          sampleCount: 1,
          threshold: budget,
          workloadIdentity: null,
          baselineReport: {
            path: 'baselines/devex-docs-snapshot-v1.json',
            schema: DEVEX_DETERMINISTIC_ARTIFACT_REPORT_SCHEMA,
          },
          binding: {
            kind: 'packed-artifact',
            schema: 'kovo-devex-packed-artifact-binding/v2',
          },
        },
      });
    }
    const forgedStatisticalBinding = structuredClone(budgets);
    forgedStatisticalBinding.metrics['check.cold.durationMs'].binding = 'packed-artifact';
    expect(validateBudgets(forgedStatisticalBinding)).toEqual(
      expect.arrayContaining([
        'check.cold.durationMs.binding must be runner',
        'check.cold.durationMs cannot claim packed-artifact binding unless deterministic',
      ]),
    );
  });

  it('binds docs bytes to a deterministic packed report without ratifying a runner', () => {
    const docsScenario = structuredClone(scenario);
    const cliSha = `sha256:${'c'.repeat(64)}`;
    docsScenario.provenance.packedArtifacts.push({
      name: '@kovojs/cli',
      path: 'kovojs-cli-0.2.0.tgz',
      sha256: cliSha,
    });
    const evidence = {
      schema: 'kovo-devex-packed-docs-evidence/v1',
      workloadManifestSha256: docsScenario.provenance.workloadManifest.sha256,
      package: {
        name: '@kovojs/cli',
        sha256: cliSha,
        version: '0.2.0',
      },
      snapshot: {
        compressedBytes: 1_000,
        files: 77,
        installedBytes: 4_000,
        publicManifestDigest: `sha256:${'d'.repeat(64)}`,
        snapshotDigest: `sha256:${'e'.repeat(64)}`,
        sourceCommit: docsScenario.provenance.sourceCommit,
        version: '0.2.0',
      },
    };
    const report = deterministicArtifactReport(
      {
        'docs.snapshot.compressedBytes': [evidence.snapshot.compressedBytes],
        'docs.snapshot.installedBytes': [evidence.snapshot.installedBytes],
      },
      { definition: docsScenario },
    );
    report.metrics['docs.snapshot.compressedBytes'].evidence = structuredClone(evidence);
    report.metrics['docs.snapshot.installedBytes'].evidence = structuredClone(evidence);
    expect(validateDeterministicArtifactReportIdentity(report)).toEqual([]);
    const source = baselineOptions(report);
    const artifactBudgets = unratifiedBudgetFixture();
    for (const [metricId, budget] of [
      ['docs.snapshot.compressedBytes', 1_100],
      ['docs.snapshot.installedBytes', 4_500],
    ]) {
      const samples = report.metrics[metricId].samples;
      artifactBudgets.metrics[metricId].ratification = {
        baseline: samples[0],
        baselineReport: {
          path: source.ratificationOptions.baselineReportPath,
          sha256: digest(source.ratificationOptions.baselineReportBytes),
          schema: report.schema,
          scenarioName: report.scenario.name,
          scenarioDigest: report.scenario.digest,
        },
        binding: packedArtifactBinding(evidence),
        budget,
        noise: 0,
        noiseMultiplier: 0,
        noiseStatistic: artifactBudgets.procedure.noiseStatistic,
        runnerFingerprint: null,
        sampleCount: 1,
        statistic: 'median',
        targetRationale:
          'Bound the exact packed documentation payload with reviewed growth headroom.',
        threshold: budget,
        workloadIdentity: null,
      };
    }

    expect(artifactBudgets.runner).toMatchObject({ status: 'unratified', fingerprint: null });
    expect(validateBudgets(artifactBudgets, source.validationOptions)).toEqual([]);

    const anotherRunnerScenario = structuredClone(docsScenario);
    anotherRunnerScenario.environment.runnerName = 'another-fixture-runner';
    anotherRunnerScenario.environment.cpuModel = 'another-fixture-cpu';
    anotherRunnerScenario.environment.osImage =
      'another-fixture-linux@sha256:2222222222222222222222222222222222222222222222222222222222222222';
    const anotherRunnerReport = benchmarkReport(
      {
        'docs.snapshot.compressedBytes': [evidence.snapshot.compressedBytes],
        'docs.snapshot.installedBytes': [evidence.snapshot.installedBytes],
      },
      { definition: anotherRunnerScenario },
    );
    anotherRunnerReport.metrics['docs.snapshot.compressedBytes'].evidence =
      structuredClone(evidence);
    anotherRunnerReport.metrics['docs.snapshot.installedBytes'].evidence =
      structuredClone(evidence);
    const evaluation = evaluateBudgets(
      artifactBudgets,
      anotherRunnerReport,
      source.validationOptions,
    );
    expect(evaluation.pass).toBe(true);
    expect(
      evaluation.results.filter((result) => result.metric.startsWith('docs.snapshot')),
    ).toEqual([
      expect.objectContaining({ status: 'pass' }),
      expect.objectContaining({ status: 'pass' }),
    ]);

    for (const metricId of ['docs.snapshot.compressedBytes', 'docs.snapshot.installedBytes']) {
      anotherRunnerReport.metrics[metricId].evidence.snapshot.snapshotDigest =
        `sha256:${'f'.repeat(64)}`;
    }
    expect(
      evaluateBudgets(artifactBudgets, anotherRunnerReport, source.validationOptions).results.find(
        (result) => result.metric === 'docs.snapshot.compressedBytes',
      ),
    ).toMatchObject({ status: 'pass' });
  });

  it('reserves deterministic artifact reports for packed-artifact metrics', () => {
    const report = benchmarkReport({
      'check.cold.durationMs': [100, 101, 102, 103, 104],
    });
    const { ratified } = ratifyFixtureBudgets(report, {
      'check.cold.durationMs': {
        budget: 100,
        targetRationale: 'Hold the packed cold check near the measured median.',
      },
    });
    const artifactReport = deterministicArtifactReport(
      {
        'docs.snapshot.compressedBytes': [1_000],
        'docs.snapshot.installedBytes': [4_000],
      },
      { definition: scenario },
    );
    const artifactBytes = Buffer.from(`${JSON.stringify(artifactReport, null, 2)}\n`);
    const record = ratified.metrics['check.cold.durationMs'].ratification;
    record.baselineReport = {
      path: 'baselines/artifact-only.json',
      sha256: digest(artifactBytes),
      schema: artifactReport.schema,
      scenarioName: artifactReport.scenario.name,
      scenarioDigest: artifactReport.scenario.digest,
    };

    expect(
      validateBudgets(ratified, {
        baselineReports: new Map([[record.baselineReport.path, artifactBytes]]),
      }),
    ).toContain(
      `check.cold.durationMs.ratification.baselineReport.schema must be ${DEVEX_BENCHMARK_REPORT_SCHEMA}`,
    );
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
    expect(budgets.runner.machineClass).toMatchObject({
      repositoryVisibility: 'public',
      label: 'ubuntu-24.04',
      vcpus: 4,
      memoryBytes: 16 * 1024 * 1024 * 1024,
      ephemeralStorageBytes: 14 * 1024 * 1024 * 1024,
    });
    expect(budgets.procedure).toMatchObject({
      minimumBaselineStatisticalSamples: 5,
      minimumEvaluationStatisticalSamples: 5,
      deterministicSamples: 1,
      noiseMultipliers: {
        deterministic: 0,
        statistical: 3,
      },
    });

    const tooFew = structuredClone(budgets);
    tooFew.procedure.minimumBaselineStatisticalSamples = 4;
    expect(validateBudgets(tooFew)).toContain(
      'procedure.minimumBaselineStatisticalSamples must be at least 5',
    );
    tooFew.procedure.minimumBaselineStatisticalSamples = 5;
    tooFew.procedure.minimumEvaluationStatisticalSamples = 4;
    expect(validateBudgets(tooFew)).toContain(
      'procedure.minimumEvaluationStatisticalSamples must be at least 5',
    );

    const driftedMachine = structuredClone(budgets);
    driftedMachine.runner.machineClass.vcpus = 8;
    expect(validateBudgets(driftedMachine)).toContain(
      'runner.machineClass must bind the public GitHub-hosted ubuntu-24.04 4-vCPU/16-GiB/14-GiB class',
    );

    const driftedNoise = structuredClone(budgets);
    driftedNoise.procedure.noiseMultipliers.statistical = 2;
    expect(validateBudgets(driftedNoise)).toContain(
      'procedure.noiseMultipliers must fix deterministic=0 and statistical=3',
    );

    const overriddenArtifactNoise = structuredClone(budgets);
    overriddenArtifactNoise.metrics['docs.snapshot.compressedBytes'].ratification.noiseMultiplier =
      1;
    expect(validateBudgets(overriddenArtifactNoise, { repoRoot })).toContain(
      'docs.snapshot.compressedBytes.ratification.noiseMultiplier must match procedure.noiseMultipliers.deterministic',
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

  it('binds edit latency to p95 rather than a median that can hide tail regressions', () => {
    const report = benchmarkReport({
      'dev.editToDiagnostic.durationMs': [3, 4, 5, 6, 7],
    });
    const { ratified, validationOptions } = ratifyFixtureBudgets(report, {
      'dev.editToDiagnostic.durationMs': {
        budget: 5,
        targetRationale: 'Keep the edit-to-diagnostic p95 inside the daily-loop target.',
      },
    });

    expect(ratified.metrics['dev.editToDiagnostic.durationMs'].ratification).toMatchObject({
      baseline: 7,
      statistic: 'p95',
    });
    const weakened = structuredClone(ratified);
    weakened.metrics['dev.editToDiagnostic.durationMs'].ratification.statistic = 'median';
    expect(validateBudgets(weakened, validationOptions)).toContain(
      'dev.editToDiagnostic.durationMs.ratification.statistic must match the metric contract',
    );
  });

  it('compares later authenticated revisions under the same benchmark contract', () => {
    const baseline = benchmarkReport({
      'check.cold.durationMs': [100, 101, 102, 103, 104],
    });
    const { ratified, validationOptions } = ratifyFixtureBudgets(baseline, {
      'check.cold.durationMs': {
        budget: 100,
        targetRationale: 'Hold the packed cold check near the measured median.',
      },
    });
    const laterRevision = structuredClone(scenario);
    laterRevision.provenance.sourceCommit = 'b'.repeat(40);
    laterRevision.provenance.workloadManifest.sha256 = `sha256:${'c'.repeat(64)}`;
    laterRevision.provenance.packedArtifacts[0].sha256 = `sha256:${'d'.repeat(64)}`;
    const evaluation = evaluateBudgets(
      ratified,
      benchmarkReport(
        { 'check.cold.durationMs': [99, 100, 101, 102, 103] },
        { definition: laterRevision },
      ),
      validationOptions,
    );

    expect(evaluation.pass).toBe(true);
    expect(
      evaluation.results.find((result) => result.metric === 'check.cold.durationMs'),
    ).toMatchObject({ observed: 101, status: 'pass' });

    laterRevision.provenance.supportFiles[0].sha256 = `sha256:${'e'.repeat(64)}`;
    const changedContract = evaluateBudgets(
      ratified,
      benchmarkReport(
        { 'check.cold.durationMs': [99, 100, 101, 102, 103] },
        { definition: laterRevision },
      ),
      validationOptions,
    );
    expect(
      changedContract.results.find((result) => result.metric === 'check.cold.durationMs'),
    ).toMatchObject({ status: 'scenario-mismatch' });
  });

  it('rejects ratification records that are not bound to the recorded baseline bytes', () => {
    const report = benchmarkReport({
      'check.cold.durationMs': [100, 101, 102, 103, 104],
    });
    const { ratified, validationOptions } = ratifyFixtureBudgets(report, {
      'check.cold.durationMs': {
        budget: 100,
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
          targetRationale: 'A target that still needs a real baseline sample set.',
        },
      }),
    ).toThrow('has 1 baseline samples; 5 required');
  });

  it('refuses to ratify or evaluate a differently pinned runner identity', () => {
    const defaultReport = benchmarkReport({
      'check.cold.durationMs': [100, 101, 102, 103, 104],
    });
    const proposal = {
      schema: 'kovo-devex-budget-proposal/v7',
      runnerFingerprint: defaultReport.runner,
      metrics: {
        'check.cold.durationMs': {
          budget: 100,
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
      status: 'runner-mismatch',
      expectedRunner: defaultReport.runner,
    });
  });

  it('rejects a cheap scenario on the same runner and forged report provenance', () => {
    const baseline = benchmarkReport({
      'check.cold.durationMs': [100, 101, 102, 103, 104],
    });
    const { ratified, validationOptions } = ratifyFixtureBudgets(baseline, {
      'check.cold.durationMs': {
        budget: 100,
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
    const droppedDiagnosticPhase = benchmarkReport({
      'check.cold.durationMs': [90, 91, 92, 93, 94],
    });
    droppedDiagnosticPhase.phaseCensus.analysisInputs[0].diagnosticPhases.pop();
    expect(() => evaluateBudgets(ratified, droppedDiagnosticPhase, validationOptions)).toThrow(
      'must contain all 11 packed-check diagnostic phases',
    );
    const forgedCheckGraph = benchmarkReport({
      'check.cold.durationMs': [90, 91, 92, 93, 94],
    });
    forgedCheckGraph.phaseCensus.analysisInputs[0].checkGraphDigest =
      forgedCheckGraph.phaseCensus.analysisInputs.find(
        (observation) => observation.revision === 1,
      ).checkGraphDigest;
    expect(() => evaluateBudgets(ratified, forgedCheckGraph, validationOptions)).toThrow(
      'maps one revision to multiple check-graph digests',
    );

    const forgedPhaseMetric = benchmarkReport({
      'check.cold.durationMs': [90, 91, 92, 93, 94],
    });
    forgedPhaseMetric.metrics['check.cold.durationMs'].samples[0] = 1;
    expect(() => evaluateBudgets(ratified, forgedPhaseMetric, validationOptions)).toThrow(
      'report.metrics.check.cold.durationMs does not match its phase census',
    );

    const forgedDevMetric = benchmarkReport({
      'check.cold.durationMs': [90, 91, 92, 93, 94],
      'dev.editToDiagnostic.durationMs': [3, 4, 5, 6, 7],
    });
    forgedDevMetric.metrics['dev.editToDiagnostic.durationMs'].samples[0] = 999;
    expect(() => evaluateBudgets(ratified, forgedDevMetric, validationOptions)).toThrow(
      'report.metrics.dev.editToDiagnostic.durationMs does not match its dev phase census',
    );
  });

  it('gates only ratified metrics and detects a statistically derived breach', () => {
    const report = benchmarkReport({
      'check.cold.durationMs': [100, 101, 102, 103, 104],
    });
    const { ratified, validationOptions } = ratifyFixtureBudgets(report, {
      'check.cold.durationMs': {
        budget: 100,
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
    ).toMatchObject({ status: 'breach', observed: 112, threshold: 103 });
  });

  it('can collect an unratified report while making the release invocation fail closed', () => {
    const report = benchmarkReport({
      'check.cold.durationMs': [100, 101, 102, 103, 104],
    });
    const informational = evaluateBudgets(unratifiedBudgetFixture(), report);
    const release = evaluateBudgets(unratifiedBudgetFixture(), report, {
      requireRatified: true,
    });

    expect(informational.pass).toBe(true);
    expect(
      informational.results.find((result) => result.metric === 'check.cold.durationMs'),
    ).toMatchObject({ status: 'unratified' });
    expect(release.pass).toBe(false);
    expect(
      release.results.find((result) => result.metric === 'check.cold.durationMs'),
    ).toMatchObject({ status: 'unratified-required' });
    expect(
      release.results.find((result) => result.metric === 'dev.ready.cold.durationMs'),
    ).toMatchObject({ status: 'not-applicable', source: 'golden-journey' });
  });

  it('makes evaluation red when a statistical report has fewer than five samples', () => {
    const report = benchmarkReport({
      'check.cold.durationMs': [100, 101, 102, 103, 104],
    });
    const { ratified, validationOptions } = ratifyFixtureBudgets(report, {
      'check.cold.durationMs': {
        budget: 100,
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

function fixtureAnalysisInputs(sampleCount, metricSamples = {}) {
  const phaseValues = {
    cold: { durationMs: 30, peakRssBytes: 3000 },
    warm: { durationMs: 10, peakRssBytes: 2000 },
    oneFileIncremental: { durationMs: 2, peakRssBytes: 1000 },
  };
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
          checkGraphDigest: `sha256:${revision === 0 ? 'a'.repeat(64) : 'b'.repeat(64)}`,
          diagnosticPhases: fixturePackedCheckPhases(),
          durationMs: phaseValues[phase].durationMs + sampleIndex,
          peakRssBytes: phaseValues[phase].peakRssBytes + sampleIndex,
        });
      }
      const revision = phase === 'oneFileIncremental' ? (baseline === 0 ? 1 : 0) : 0;
      const duration =
        metricSamples[`check.${phase}.durationMs`]?.[sampleIndex] ??
        phaseValues[phase].durationMs + sampleIndex;
      const peakRss =
        metricSamples[`check.${phase}.peakRssBytes`]?.[sampleIndex] ??
        phaseValues[phase].peakRssBytes + sampleIndex;
      inputs.push({
        phase,
        role: 'timed',
        sampleIndex,
        revision,
        analysisDigest: `sha256:${String(revision).repeat(64)}`,
        checkGraphDigest: `sha256:${revision === 0 ? 'a'.repeat(64) : 'b'.repeat(64)}`,
        diagnosticPhases: fixturePackedCheckPhases(),
        durationMs: duration,
        peakRssBytes: peakRss,
      });
    }
  }
  return inputs;
}

function fixturePackedCheckPhases() {
  return [
    ['lifecycle-policy', 'not-applicable'],
    ['config-trust', 'executed'],
    ['typescript', 'not-applicable'],
    ['project-quality', 'not-applicable'],
    ['sound-subset', 'not-applicable'],
    ['session-authority', 'executed'],
    ['app-source-trust', 'executed'],
    ['app-evaluation', 'executed'],
    ['stylesheet', 'executed'],
    ['build-check-graph', 'executed'],
    ['graph-diagnostics', 'executed'],
  ].map(([name, status]) => ({ durationMs: 0, name, status }));
}

function fixtureDevEvidence(sampleIndex) {
  return {
    cold: {
      bodyDigest: `sha256:${'a'.repeat(64)}`,
      durationMs: 12 + sampleIndex,
    },
    diagnostic: {
      bodyDigest: `sha256:${'c'.repeat(64)}`,
      code: 'KV235',
      durationMs: 3 + sampleIndex,
      sourceDigest: `sha256:${'e'.repeat(64)}`,
    },
    served: {
      bodyDigest: `sha256:${'d'.repeat(64)}`,
      durationMs: 4 + sampleIndex,
      revision: 1,
      sourceDigest: `sha256:${'f'.repeat(64)}`,
    },
    warm: {
      bodyDigest: `sha256:${'b'.repeat(64)}`,
      durationMs: 5 + sampleIndex,
    },
  };
}

function fixtureDevObservations(sampleCount) {
  return Array.from({ length: sampleCount }, (_, sampleIndex) => ({
    sampleIndex,
    ...fixtureDevEvidence(sampleIndex),
  }));
}

function fixtureDevProfileResult(sampleIndex) {
  return {
    durationMs: 100 + sampleIndex,
    peakRssBytes: 10_000 + sampleIndex,
    exitCode: 0,
    signal: null,
    error: null,
    stderr: '',
    stdout: `kovo-dev-profile/v1 ${JSON.stringify(fixtureDevEvidence(sampleIndex))}\n`,
  };
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
      schema: 'kovo-devex-phase-census/v4',
      samples: sampleCount,
      counts: {
        cold: { prime: 0, timed: sampleCount },
        warm: { prime: sampleCount, timed: sampleCount },
        oneFileIncremental: { prime: sampleCount, timed: sampleCount },
      },
      incrementalRevisions: Array.from({ length: sampleCount }, (_, index) =>
        index % 2 === 0 ? 1 : 0,
      ),
      analysisInputs: fixtureAnalysisInputs(sampleCount, metricSamples),
    },
    devPhaseCensus: {
      schema: 'kovo-devex-dev-phase-census/v1',
      samples: sampleCount,
      observations: fixtureDevObservations(sampleCount),
    },
    commands: {
      cold: { command: ['node', 'profile.mjs', 'cold'], cwd: '.' },
      warm: { command: ['node', 'profile.mjs', 'warm'], cwd: '.' },
      oneFileIncremental: {
        command: ['node', 'profile.mjs', 'oneFileIncremental'],
        cwd: '.',
      },
      dev: { command: ['node', 'dev-profile.mjs'], cwd: '.' },
    },
    metrics: Object.fromEntries(
      Object.entries(metricSamples).map(([metric, samples]) => [
        metric,
        { unit: metric.endsWith('Bytes') ? 'bytes' : 'ms', samples },
      ]),
    ),
  };
}

function deterministicArtifactReport(metricSamples, options = {}) {
  const fullReport = benchmarkReport(metricSamples, options);
  return {
    schema: DEVEX_DETERMINISTIC_ARTIFACT_REPORT_SCHEMA,
    subject: 'packed-docs-snapshot',
    scenario: fullReport.scenario,
    provenance: fullReport.provenance,
    metrics: Object.fromEntries(
      Object.entries(fullReport.metrics).map(([metricId, metric]) => {
        const [value] = metric.samples;
        return [
          metricId,
          {
            ...metric,
            summary: {
              count: 1,
              min: value,
              median: value,
              p95: value,
              max: value,
              medianAbsoluteDeviation: 0,
            },
          },
        ];
      }),
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
  const ratified = unratifiedBudgetFixture();
  const workloadIdentity = benchmarkWorkloadContractIdentity(report);
  ratified.runner = {
    machineClass: structuredClone(ratified.runner.machineClass),
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
      metric.sampling === 'deterministic'
        ? ratified.procedure.deterministicSamples
        : ratified.procedure.minimumBaselineStatisticalSamples;
    if (!Array.isArray(samples) || samples.length < requiredSamples) {
      throw new Error(
        `${metricId} has ${samples?.length ?? 0} baseline samples; ${requiredSamples} required`,
      );
    }
    const statistic = proposal.statistic ?? metric.statistic;
    const baseline = statistic === 'p95' ? percentile(samples, 0.95) : median(samples);
    const noise = metric.sampling === 'deterministic' ? 0 : medianAbsoluteDeviation(samples);
    const noiseMultiplier = ratified.procedure.noiseMultipliers[metric.sampling];
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
      noiseMultiplier,
      threshold: proposal.budget + noiseMultiplier * noise,
    };
  }
  return {
    ratified,
    validationOptions: source.validationOptions,
  };
}

function unratifiedBudgetFixture() {
  const value = structuredClone(budgets);
  value.runner = {
    machineClass: structuredClone(value.runner.machineClass),
    status: 'unratified',
    fingerprint: null,
  };
  value.workload = { status: 'unratified', identity: null };
  for (const metric of Object.values(value.metrics)) metric.ratification = null;
  return value;
}

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
