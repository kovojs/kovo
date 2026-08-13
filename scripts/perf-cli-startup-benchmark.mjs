#!/usr/bin/env node
/**
 * Authenticated packed-versus-source CLI startup benchmark (plans/good-perf.md Phase 1).
 *
 * The packed lane is product DevEx: it builds and packs the real public packages, installs them
 * through a frozen lock in a consumer outside the workspace, and proves every loaded file resolves
 * inside that consumer. The source-checkout lane is maintainer performance. Both execute the same
 * deterministic `kovo --version` workload through the same Node binary and process-tree RSS
 * supervisor. SPEC §1.1 goal 3 requires fast loading; this tool keeps the artifact boundary honest
 * before using startup measurements to prioritize product work.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import {
  deterministicPackEnvironment,
  readPackageTarballSnapshot,
  validatedPackageTarballEntries,
} from './lib/deterministic-tarball.mjs';
import { packWithoutLifecycleScripts } from './lib/pack-without-lifecycle.mjs';
import { performanceHostFingerprint } from './lib/perf-host.mjs';
import { collectPerformanceProvenance } from './lib/perf-provenance.mjs';
import { measureProcessTreeCommand } from './lib/process-tree-rss.mjs';
import {
  assertNoWorkspaceProtocols,
  assertPackedManifestMatchesSource,
  releasePackages,
} from './release-packages.mjs';

export const CLI_STARTUP_BENCHMARK_SCHEMA = 'kovo-cli-startup-comparison/v1';
export const CLI_STARTUP_PREPARE_SCHEMA = 'kovo-cli-startup-prepare/v1';
export const CLI_STARTUP_WORKLOAD_SCHEMA = 'kovo-cli-version-startup/v1';

const DEFAULT_BOOTSTRAP_ITERATIONS = 10_000;
const DEFAULT_SAMPLES = 15;
const DEFAULT_WARMUPS = 3;
const LOCK_FILES = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);
const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_TRACE_BYTES = 2 * 1024 * 1024;
const TIMING_LANES = Object.freeze(['source-checkout', 'packed']);
const TIMING_ORDER = Object.freeze(['source-checkout', 'packed', 'packed', 'source-checkout']);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export function cliStartupSchedule(samples = DEFAULT_SAMPLES) {
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 100) {
    throw new TypeError('CLI startup samples must be an integer from 1 through 100');
  }
  const counts = Object.fromEntries(TIMING_LANES.map((lane) => [lane, 0]));
  const schedule = [];
  while (TIMING_LANES.some((lane) => counts[lane] < samples)) {
    for (const lane of TIMING_ORDER) {
      if (counts[lane] >= samples) continue;
      schedule.push({ lane, occurrence: counts[lane] });
      counts[lane] += 1;
    }
  }
  return schedule;
}

export function summarizeCliSamples(samples) {
  const valid = samples.filter(
    (sample) => sample.valid === true && finiteNonNegative(sample.durationMs),
  );
  return {
    durationMs: summarizeMetric(valid.map((sample) => sample.durationMs)),
    peakRssBytes: summarizeMetric(valid.map((sample) => sample.peakRssBytes)),
  };
}

export function pairedBootstrapConfidenceInterval(
  baseline,
  spike,
  { iterations = DEFAULT_BOOTSTRAP_ITERATIONS, seed = 1 } = {},
) {
  if (!Array.isArray(baseline) || !Array.isArray(spike) || baseline.length !== spike.length) {
    throw new TypeError('paired bootstrap inputs must have the same sample count');
  }
  if (baseline.length === 0) return [null, null];
  boundedInteger(iterations, 100, 1_000_000, 'bootstrap iterations');
  const pairs = baseline.map((value, index) => {
    if (!Number.isFinite(value) || !Number.isFinite(spike[index])) {
      throw new TypeError('paired bootstrap inputs must be finite numbers');
    }
    return spike[index] - value;
  });
  const random = seededRandom(seed);
  const medians = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const resampled = Array.from(
      { length: pairs.length },
      () => pairs[Math.floor(random() * pairs.length)],
    );
    medians.push(quantile(resampled, 0.5));
  }
  return [quantile(medians, 0.025), quantile(medians, 0.975)];
}

export function classifyCliStartup({ complete, packedFastBudgetMs = null, summary }) {
  const lanes = {
    packed: {
      audience: 'product',
      reason:
        'ordinary users execute the installed dist/bin.mjs from the authenticated published artifact',
    },
    'source-checkout': {
      audience: 'maintainer',
      reason:
        'only repository contributors execute src/bin.ts and pay Node type transformation plus its bootstrap respawn',
    },
  };
  if (!complete) {
    return {
      lanes,
      metric: 'packed.durationMs.p95',
      packedFastBudgetMs,
      recommendation: 'defer-prioritization-until-evidence-is-complete',
      status: 'unproven',
    };
  }
  if (packedFastBudgetMs === null) {
    return {
      lanes,
      metric: 'packed.durationMs.p95',
      packedFastBudgetMs,
      recommendation: 'ratify-an-absolute-packed-startup-budget-before-reclassifying-work',
      status: 'budget-required',
    };
  }
  if (summary.packed.durationMs.p95 <= packedFastBudgetMs) {
    return {
      lanes,
      metric: 'packed.durationMs.p95',
      observedMs: summary.packed.durationMs.p95,
      packedFastBudgetMs,
      recommendation:
        'treat-source-transformation-or-prebuilt-checkout-work-as-maintainer-performance',
      status: 'packed-product-lane-fast',
    };
  }
  return {
    lanes,
    metric: 'packed.durationMs.p95',
    observedMs: summary.packed.durationMs.p95,
    packedFastBudgetMs,
    recommendation: 'prioritize-packed-cli-startup-as-product-devex',
    status: 'packed-product-lane-over-budget',
  };
}

export async function preparePackedCliBenchmark(options = {}, dependencies = {}) {
  const packages = releasePackages();
  const packedPackages = packedCliPackageClosure(packages);
  const releaseVersions = new Map(packages.map((pkg) => [pkg.name, pkg.version]));
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-cli-startup-'));
  const tarballRoot = path.join(temporaryRoot, 'tarballs');
  const consumerRoot = path.join(temporaryRoot, 'consumer');
  mkdirSync(tarballRoot, { mode: 0o700 });
  mkdirSync(consumerRoot, { mode: 0o700 });
  const exec = dependencies.exec ?? execFileSync;
  const capture = dependencies.capture ?? spawnSync;
  const buildCommands = [];
  const packCommands = [];
  try {
    const rootManifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const pnpmVersion = String(
      runCheckedExec(exec, 'pnpm', ['--version'], { cwd: repoRoot, env: process.env }),
    ).trim();
    if (rootManifest.packageManager !== `pnpm@${pnpmVersion}`) {
      throw new Error(
        `active pnpm ${pnpmVersion} does not match packageManager ${String(
          rootManifest.packageManager,
        )}`,
      );
    }
    const buildEnvironment = deterministicPackEnvironment({
      ...process.env,
      KOVO_REPRODUCIBLE_BUILD_ID: 'cli-startup-benchmark',
    });
    const rootFrozenInstallArgs = ['install', '--offline', '--frozen-lockfile', '--ignore-scripts'];
    runCheckedCapture(capture, 'pnpm', rootFrozenInstallArgs, {
      cwd: repoRoot,
      env: buildEnvironment,
      label: 'frozen repository install',
      timeoutMs: options.installTimeoutMs ?? 10 * 60 * 1_000,
    });
    for (const pkg of packedPackages) {
      const args = ['--filter', pkg.name, 'run', 'build:dist'];
      runCheckedExec(exec, 'pnpm', args, {
        cwd: repoRoot,
        env: buildEnvironment,
      });
      buildCommands.push({ argv: ['pnpm', ...args], package: pkg.name });
    }

    const runtimeArtifacts = [];
    for (const pkg of packedPackages) {
      const tarballPath = packWithoutLifecycleScripts(pkg, tarballRoot, {
        env: buildEnvironment,
        exec(command, args, commandOptions) {
          runCheckedExec(exec, command, args, commandOptions);
        },
      });
      packCommands.push({
        argv: [
          'pnpm',
          '--config.ignore-scripts=true',
          'pack',
          '--pack-destination',
          '<temporary-tarballs>',
        ],
        package: pkg.name,
      });
      runtimeArtifacts.push(authenticatePackedPackage({ pkg, releaseVersions, tarballPath }));
    }

    const cliArtifact = runtimeArtifacts.find((artifact) => artifact.name === '@kovojs/cli');
    if (cliArtifact === undefined) throw new Error('packed closure omitted @kovojs/cli');
    const tarballUrls = Object.fromEntries(
      runtimeArtifacts.map((artifact) => [artifact.name, pathToFileURL(artifact.tarballPath).href]),
    );
    const consumerManifest = {
      // Declare the whole authenticated closure directly as well as overriding transitive edges.
      // pnpm auto-installs non-optional peers as root dependencies; direct file subjects prevent
      // that peer materialization from silently falling back to an older public registry version.
      dependencies: tarballUrls,
      name: 'kovo-cli-startup-consumer',
      packageManager: rootManifest.packageManager,
      pnpm: { overrides: tarballUrls },
      private: true,
      version: '0.0.0',
    };
    const consumerManifestBytes = `${JSON.stringify(consumerManifest, null, 2)}\n`;
    writeFileSync(path.join(consumerRoot, 'package.json'), consumerManifestBytes, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    const storeDir = path.join(consumerRoot, '.pnpm-store');
    const installEnvironment = cleanCliEnvironment({
      ...process.env,
      CI: '1',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    });
    const resolutionArgs = [
      'install',
      '--prod',
      '--ignore-scripts',
      '--ignore-workspace',
      '--no-frozen-lockfile',
      '--strict-peer-dependencies',
      '--store-dir',
      storeDir,
    ];
    runCheckedCapture(capture, 'pnpm', resolutionArgs, {
      cwd: consumerRoot,
      env: installEnvironment,
      label: 'isolated consumer lock resolution',
      timeoutMs: options.installTimeoutMs ?? 10 * 60 * 1_000,
    });
    const lockPath = path.join(consumerRoot, 'pnpm-lock.yaml');
    const lockBefore = sha256File(lockPath);
    rmSync(path.join(consumerRoot, 'node_modules'), { force: true, recursive: true });
    const frozenArgs = [
      'install',
      '--prod',
      '--ignore-scripts',
      '--ignore-workspace',
      '--offline',
      '--frozen-lockfile',
      '--strict-peer-dependencies',
      '--store-dir',
      storeDir,
    ];
    runCheckedCapture(capture, 'pnpm', frozenArgs, {
      cwd: consumerRoot,
      env: installEnvironment,
      label: 'isolated frozen consumer install',
      timeoutMs: options.installTimeoutMs ?? 10 * 60 * 1_000,
    });
    const lockAfter = sha256File(lockPath);
    if (lockAfter !== lockBefore) {
      throw new Error('frozen consumer install changed pnpm-lock.yaml');
    }

    const installation = assertInstalledPackedPackages(consumerRoot, runtimeArtifacts);
    const expectedStdout = `kovo ${cliArtifact.version}\n`;
    const resolutionProof = runPackedResolutionProof(
      {
        consumerRoot,
        expectedStdout,
        installedCli: installation.installedCli,
      },
      { capture },
    );
    if (resolutionProof.workspaceSourceLoaded) {
      throw new Error('packed CLI resolution proof loaded a repository workspace file');
    }
    const artifactEvidence = runtimeArtifacts.map((artifact) => artifact.evidence);
    const packedCommand = {
      argv: [process.execPath, installation.installedCli, '--version'],
      cwd: consumerRoot,
      env: cleanCliEnvironment(process.env),
    };
    const sourceCommand = {
      argv: [
        process.execPath,
        path.join(repoRoot, 'packages', 'cli', 'src', 'bin.ts'),
        '--version',
      ],
      cwd: repoRoot,
      env: cleanCliEnvironment(process.env),
    };
    return {
      cleanup() {
        rmSync(temporaryRoot, { force: true, recursive: true });
      },
      commands: { packed: packedCommand, 'source-checkout': sourceCommand },
      evidence: {
        artifacts: artifactEvidence,
        build: {
          commands: buildCommands,
          packages: packedPackages.map((pkg) => pkg.name),
          rootFrozenInstall: { argv: ['pnpm', ...rootFrozenInstallArgs] },
        },
        consumer: {
          frozenInstall: {
            argv: [
              'pnpm',
              ...frozenArgs.map((arg) => (arg === storeDir ? '<isolated-store>' : arg)),
            ],
            lockSha256: lockAfter,
          },
          lockResolution: {
            argv: [
              'pnpm',
              ...resolutionArgs.map((arg) => (arg === storeDir ? '<isolated-store>' : arg)),
            ],
          },
          manifestSha256: sha256(Buffer.from(consumerManifestBytes)),
          packageCensusMatched: installation.packageCensusMatched,
          packageFilesMatched: installation.packageFilesMatched,
          packageManager: rootManifest.packageManager,
          pnpmVersion,
          root: '<isolated-consumer>',
        },
        integrity: {
          artifactAuthenticated: true,
          consumerFrozen: true,
          installedBytesMatchTarballs: true,
          packedResolutionConfined: resolutionProof.confined,
          workspaceSourceLoaded: resolutionProof.workspaceSourceLoaded,
        },
        pack: { commands: packCommands },
        primaryCli: {
          installedBin: 'node_modules/@kovojs/cli/dist/bin.mjs',
          installedBinSha256: installation.installedCliSha256,
          name: cliArtifact.name,
          packageContentSha256: cliArtifact.evidence.packageContentSha256,
          tarballSha256: cliArtifact.evidence.tarballSha256,
          version: cliArtifact.version,
        },
        resolutionProof,
      },
      expectedStdout,
    };
  } catch (error) {
    rmSync(temporaryRoot, { force: true, recursive: true });
    throw error;
  }
}

export function assertInstalledPackedPackages(consumerRoot, artifacts) {
  const nodeModules = path.join(consumerRoot, 'node_modules');
  assertNonSymlinkDirectory(nodeModules, 'isolated consumer node_modules');
  const realNodeModules = realpathSync(nodeModules);
  let packageFilesMatched = 0;
  for (const artifact of artifacts) {
    const packageRoot = realpathSync(packagePath(nodeModules, artifact.name));
    assertContainedPath(realNodeModules, packageRoot, `installed ${artifact.name}`);
    const expectedPaths = [];
    for (const entry of artifact.entries) {
      const relative = entry.name.slice('package/'.length);
      const installed = path.join(packageRoot, ...relative.split('/'));
      assertContainedPath(packageRoot, realpathSync(installed), `${artifact.name}/${relative}`);
      const stat = lstatSync(installed);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`${artifact.name}/${relative} is not an installed regular package file`);
      }
      if (!readFileSync(installed).equals(entry.data)) {
        throw new Error(`${artifact.name}/${relative} differs from its authenticated tarball`);
      }
      expectedPaths.push(relative);
      packageFilesMatched += 1;
    }
    const observedPaths = regularFileCensus(packageRoot);
    if (!sameStringList(expectedPaths, observedPaths)) {
      const expected = new Set(expectedPaths);
      const observed = new Set(observedPaths);
      const missing = expectedPaths.filter((file) => !observed.has(file)).slice(0, 20);
      const extra = observedPaths.filter((file) => !expected.has(file)).slice(0, 20);
      throw new Error(
        `${artifact.name} installed file census differs from its authenticated tarball: missing=${JSON.stringify(
          missing,
        )} extra=${JSON.stringify(extra)}`,
      );
    }
  }
  const cli = artifacts.find((artifact) => artifact.name === '@kovojs/cli');
  if (cli === undefined) throw new Error('installed package proof omitted @kovojs/cli');
  const installedCli = realpathSync(
    path.join(packagePath(nodeModules, '@kovojs/cli'), 'dist', 'bin.mjs'),
  );
  assertContainedPath(realNodeModules, installedCli, 'installed @kovojs/cli executable');
  const authenticatedCli = cli.entries.find((entry) => entry.name === 'package/dist/bin.mjs');
  if (authenticatedCli === undefined) throw new Error('CLI tarball omitted dist/bin.mjs');
  const installedCliSha256 = sha256File(installedCli);
  if (installedCliSha256 !== sha256(authenticatedCli.data)) {
    throw new Error('installed CLI executable digest differs from its authenticated tarball');
  }
  return {
    installedCli,
    installedCliSha256,
    packageCensusMatched: artifacts.length,
    packageFilesMatched,
  };
}

export function runPackedResolutionProof(options, dependencies = {}) {
  const capture = dependencies.capture ?? spawnSync;
  const proofPath = path.join(options.consumerRoot, '.packed-resolution-proof.mjs');
  const tracePath = path.join(options.consumerRoot, '.packed-resolution-trace.jsonl');
  writeFileSync(proofPath, packedResolutionProofSource(), { encoding: 'utf8', flag: 'wx' });
  writeFileSync(tracePath, '', { encoding: 'utf8', flag: 'wx' });
  const environment = cleanCliEnvironment({
    ...process.env,
    KOVO_PACKED_CLI_ENTRY: options.installedCli,
    KOVO_PACKED_CLI_TRACE: tracePath,
  });
  const result = capture(process.execPath, [proofPath, '--version'], {
    cwd: options.consumerRoot,
    encoding: 'utf8',
    env: environment,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  const stdout = String(result.stdout ?? '');
  const stderr = String(result.stderr ?? '');
  if (result.error || result.signal || result.status !== 0) {
    const commandOutput = `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`.trim();
    throw new Error(
      `packed resolution proof failed: ${boundedDiagnostic(
        result.error?.message ??
          (commandOutput || `exit ${String(result.status)} signal ${String(result.signal)}`),
      )}`,
    );
  }
  if (stdout !== options.expectedStdout || stderr !== '') {
    throw new Error('packed resolution proof did not produce the exact CLI version contract');
  }
  const traceBytes = readFileSync(tracePath);
  if (traceBytes.byteLength === 0 || traceBytes.byteLength > MAX_TRACE_BYTES) {
    throw new Error('packed resolution proof trace is empty or exceeds its evidence bound');
  }
  const traceEntries = traceBytes
    .toString('utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));
  if (
    traceEntries.some(
      (entry) =>
        typeof entry?.path !== 'string' ||
        typeof entry?.url !== 'string' ||
        !entry.url.startsWith('file:'),
    )
  ) {
    throw new Error('packed resolution proof emitted malformed trace evidence');
  }
  const loadedFiles = [...new Set(traceEntries.map((entry) => entry.path))].sort(bytewise);
  if (!loadedFiles.includes(relativeNodeModulesPath(options.consumerRoot, options.installedCli))) {
    throw new Error('packed resolution proof did not observe the authenticated CLI entry');
  }
  return {
    confined: true,
    loadedFileCount: loadedFiles.length,
    loadedFiles,
    schema: 'kovo-packed-cli-resolution-proof/v1',
    traceSha256: sha256(traceBytes),
    workspaceSourceLoaded: traceEntries.some((entry) =>
      containedOrEqual(repoRoot, fileURLToPath(entry.url)),
    ),
  };
}

export async function runCliStartupBenchmark(options = {}, dependencies = {}) {
  const policy = normalizedOptions(options);
  const provenance = dependencies.provenance ?? collectPerformanceProvenance;
  const source = provenance({ lockFiles: LOCK_FILES, repoRoot });
  if (source.dirty && policy.allowDirty !== true) {
    throw new Error(
      `CLI startup benchmark requires a clean committed worktree: ${source.dirtyPaths.join(', ')}`,
    );
  }
  if (!validLockEvidence(source.locks)) {
    throw new Error('CLI startup benchmark requires exact root, Next.js, and harness lock digests');
  }
  const prepare = dependencies.prepare ?? preparePackedCliBenchmark;
  const prepared = await prepare(policy, dependencies.preparationDependencies ?? {});
  let sourceAfter;
  try {
    if (policy.prepareOnly) {
      sourceAfter = provenance({ lockFiles: LOCK_FILES, repoRoot });
      const sourceStable = sameSourceState(source, sourceAfter);
      const evidenceComplete =
        sourceStable &&
        prepared.evidence.integrity.artifactAuthenticated === true &&
        prepared.evidence.integrity.consumerFrozen === true &&
        prepared.evidence.integrity.installedBytesMatchTarballs === true &&
        prepared.evidence.integrity.packedResolutionConfined === true &&
        prepared.evidence.integrity.workspaceSourceLoaded === false;
      const complete = evidenceComplete && !source.dirty;
      return {
        host: (dependencies.hostFingerprint ?? performanceHostFingerprint)(),
        integrity: {
          complete,
          evidenceComplete,
          publishable: complete,
          sourceStable,
        },
        mode: 'prepare-only',
        preparation: prepared.evidence,
        schema: CLI_STARTUP_PREPARE_SCHEMA,
        source,
        sourceAfter,
        verdict: benchmarkVerdict({ evidenceComplete, source, sourceStable }),
      };
    }

    const hostFingerprint = (dependencies.hostFingerprint ?? performanceHostFingerprint)();
    const sampleHost = dependencies.sampleHost ?? sampleHostLoad;
    const hostSamples = [];
    const executionErrors = [];
    const warmupSamples = [];
    const samples = [];
    const initialHost = sampleHost('pre-timing', policy.maxLoadPerCpu);
    hostSamples.push(initialHost);
    if (!initialHost.comparable) {
      throw new Error(
        `host load ${initialHost.loadPerCpu.toFixed(3)} per CPU exceeds ceiling ${String(
          policy.maxLoadPerCpu,
        )}; no timing command was started`,
      );
    }
    const acquireLock = dependencies.acquireLock ?? acquireTimingLock;
    const timingLock = acquireLock(policy.timingLockPath);
    try {
      const warmupSchedule = policy.warmups === 0 ? [] : cliStartupSchedule(policy.warmups);
      executeSchedule({
        commands: prepared.commands,
        errors: executionErrors,
        expectedStdout: prepared.expectedStdout,
        hostSamples,
        kind: 'warmup',
        maxLoadPerCpu: policy.maxLoadPerCpu,
        measure: dependencies.measure ?? measureProcessTreeCommand,
        policy,
        sampleHost,
        samples: warmupSamples,
        schedule: warmupSchedule,
      });
      if (executionErrors.length === 0) {
        executeSchedule({
          commands: prepared.commands,
          errors: executionErrors,
          expectedStdout: prepared.expectedStdout,
          hostSamples,
          kind: 'measured',
          maxLoadPerCpu: policy.maxLoadPerCpu,
          measure: dependencies.measure ?? measureProcessTreeCommand,
          policy,
          sampleHost,
          samples,
          schedule: cliStartupSchedule(policy.samples),
        });
      }
    } finally {
      timingLock.release();
      const postTimingHost = sampleHost('post-timing', policy.maxLoadPerCpu);
      hostSamples.push(postTimingHost);
      if (!postTimingHost.comparable) {
        executionErrors.push(
          `post-timing host load ${postTimingHost.loadPerCpu.toFixed(
            3,
          )} per CPU exceeded ceiling ${String(policy.maxLoadPerCpu)}`,
        );
      }
    }

    sourceAfter = provenance({ lockFiles: LOCK_FILES, repoRoot });
    const sourceStable = sameSourceState(source, sourceAfter);
    const validSamples = samples.filter((sample) => sample.valid).length;
    const validWarmups = warmupSamples.filter((sample) => sample.valid).length;
    const expectedSamples = policy.samples * TIMING_LANES.length;
    const expectedWarmups = policy.warmups * TIMING_LANES.length;
    const zeroDurationSamples = samples.filter((sample) => sample.durationMs === 0).length;
    const zeroRssSamples = samples.filter((sample) => sample.peakRssBytes === 0).length;
    const loadCeilingSatisfied = hostSamples.every((sample) => sample.comparable);
    const preparationComplete =
      prepared.evidence.integrity.artifactAuthenticated === true &&
      prepared.evidence.integrity.consumerFrozen === true &&
      prepared.evidence.integrity.installedBytesMatchTarballs === true &&
      prepared.evidence.integrity.packedResolutionConfined === true &&
      prepared.evidence.integrity.workspaceSourceLoaded === false;
    const evidenceComplete =
      preparationComplete &&
      sourceStable &&
      loadCeilingSatisfied &&
      executionErrors.length === 0 &&
      validSamples === expectedSamples &&
      validWarmups === expectedWarmups &&
      zeroDurationSamples === 0 &&
      zeroRssSamples === 0;
    const complete = evidenceComplete && !source.dirty;
    const summary = comparisonSummary(samples, {
      bootstrapIterations: policy.bootstrapIterations,
      seed: policy.seed,
    });
    const integrity = {
      complete,
      errorCount: executionErrors.length,
      errors: executionErrors,
      evidenceComplete,
      expectedSamples,
      expectedWarmups,
      loadCeilingSatisfied,
      misses: expectedSamples - validSamples,
      preparationComplete,
      publishable: complete,
      serialized: true,
      sourceStable,
      validSamples,
      validWarmups,
      zeroDurationSamples,
      zeroRssSamples,
    };
    return {
      classification: classifyCliStartup({
        complete,
        packedFastBudgetMs: policy.packedFastBudgetMs,
        summary,
      }),
      host: hostFingerprint,
      hostSamples,
      integrity,
      policy: {
        bootstrapIterations: policy.bootstrapIterations,
        maxLoadPerCpu: policy.maxLoadPerCpu,
        order: TIMING_ORDER,
        packedFastBudgetMs: policy.packedFastBudgetMs,
        processTreeSampleIntervalMs: policy.sampleIntervalMs,
        samplesPerLane: policy.samples,
        seed: policy.seed,
        timingLock: '<os-temp>/kovo-performance-timing.lock',
        warmupsPerLane: policy.warmups,
      },
      preparation: prepared.evidence,
      samples,
      schema: CLI_STARTUP_BENCHMARK_SCHEMA,
      source,
      sourceAfter,
      summary,
      verdict: benchmarkVerdict({ evidenceComplete, source, sourceStable }),
      warmups: warmupSamples,
      workload: {
        args: ['--version'],
        expectedStdout: prepared.expectedStdout,
        packedCommand: [
          'node',
          '<isolated-consumer>/node_modules/@kovojs/cli/dist/bin.mjs',
          '--version',
        ],
        schema: CLI_STARTUP_WORKLOAD_SCHEMA,
        sourceCheckoutCommand: ['node', 'packages/cli/src/bin.ts', '--version'],
      },
    };
  } finally {
    prepared.cleanup();
  }
}

export function parseCliStartupArgs(argv) {
  const options = {};
  const valueFlags = new Set([
    '--bootstrap-iterations',
    '--install-timeout-ms',
    '--max-load-per-cpu',
    '--out',
    '--packed-fast-budget-ms',
    '--sample-interval-ms',
    '--samples',
    '--seed',
    '--timeout-ms',
    '--warmups',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--allow-dirty') options.allowDirty = true;
    else if (flag === '--prepare-only') options.prepareOnly = true;
    else if (flag === '--quick-smoke') options.quickSmoke = true;
    else if (valueFlags.has(flag)) {
      const value = argv[++index];
      if (value === undefined) throw new TypeError(`${flag} requires a value`);
      const key = flag.slice(2).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
      options[key] = flag === '--out' ? value : Number(value);
    } else {
      throw new TypeError(`unsupported CLI startup benchmark option: ${String(flag)}`);
    }
  }
  return options;
}

function authenticatePackedPackage({ pkg, releaseVersions, tarballPath }) {
  const tarballBytes = readPackageTarballSnapshot(tarballPath);
  const entries = validatedPackageTarballEntries(tarballBytes);
  const manifestEntry = entries.find((entry) => entry.name === 'package/package.json');
  if (manifestEntry === undefined) throw new Error(`${pkg.name} tarball omitted package.json`);
  const manifest = JSON.parse(manifestEntry.data.toString('utf8'));
  assertPackedManifestMatchesSource(manifest, pkg.manifest, releaseVersions, pkg.name);
  assertNoWorkspaceProtocols(manifest, `${pkg.name} packed manifest`);
  const packageContentHash = createHash('sha256');
  let unpackedBytes = 0;
  for (const entry of entries) {
    packageContentHash.update(entry.name);
    packageContentHash.update('\0');
    packageContentHash.update(entry.executable ? 'x' : '-');
    packageContentHash.update('\0');
    packageContentHash.update(String(entry.data.byteLength));
    packageContentHash.update('\0');
    packageContentHash.update(entry.data);
    unpackedBytes += entry.data.byteLength;
  }
  return {
    entries,
    evidence: {
      files: entries.length,
      manifestSha256: sha256(manifestEntry.data),
      name: manifest.name,
      packageContentSha256: `sha256:${packageContentHash.digest('hex')}`,
      tarballBytes: tarballBytes.byteLength,
      tarballFile: path.basename(tarballPath),
      tarballSha256: sha256(tarballBytes),
      unpackedBytes,
      version: manifest.version,
    },
    name: manifest.name,
    tarballPath,
    version: manifest.version,
  };
}

function packedCliPackageClosure(packages) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const included = new Set();
  const visit = (name) => {
    if (included.has(name)) return;
    const pkg = byName.get(name);
    if (pkg === undefined) throw new Error(`public package inventory omitted ${name}`);
    included.add(name);
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [dependency, range] of Object.entries(pkg.manifest[field] ?? {})) {
        if (
          field === 'peerDependencies' &&
          pkg.manifest.peerDependenciesMeta?.[dependency]?.optional === true
        ) {
          continue;
        }
        if (typeof range === 'string' && range.startsWith('workspace:') && byName.has(dependency)) {
          visit(dependency);
        }
      }
    }
  };
  visit('@kovojs/cli');
  return packages.filter((pkg) => included.has(pkg.name));
}

function executeSchedule(options) {
  for (const [scheduleIndex, scheduled] of options.schedule.entries()) {
    const host = options.sampleHost(
      `${options.kind}-${String(scheduleIndex)}-${scheduled.lane}`,
      options.maxLoadPerCpu,
    );
    options.hostSamples.push(host);
    if (!host.comparable) {
      options.errors.push(
        `${options.kind} ${String(scheduleIndex + 1)} host load ${host.loadPerCpu.toFixed(
          3,
        )} per CPU exceeded ceiling ${String(options.maxLoadPerCpu)}`,
      );
      break;
    }
    const command = options.commands[scheduled.lane];
    const measured = options.measure(command.argv, {
      cwd: command.cwd,
      env: command.env,
      sampleIntervalMs: options.policy.sampleIntervalMs,
      timeoutMs: options.policy.timeoutMs,
    });
    const findings = commandFindings(measured, options.expectedStdout);
    const sample = {
      durationMs: measured.durationMs,
      error: measured.error,
      exitCode: measured.exitCode,
      kind: options.kind,
      lane: scheduled.lane,
      occurrence: scheduled.occurrence,
      output: {
        stderrBytes: Buffer.byteLength(measured.stderr ?? ''),
        stderrSha256: sha256(Buffer.from(measured.stderr ?? '')),
        stdoutBytes: Buffer.byteLength(measured.stdout ?? ''),
        stdoutSha256: sha256(Buffer.from(measured.stdout ?? '')),
      },
      peakRssBytes: measured.peakRssBytes,
      processTreeSamples: measured.sampleCount,
      scheduleIndex,
      signal: measured.signal,
      valid: findings.length === 0,
    };
    options.samples.push(sample);
    if (findings.length > 0) {
      options.errors.push(
        `${options.kind} ${String(scheduleIndex + 1)} ${scheduled.lane}: ${findings.join('; ')}`,
      );
      break;
    }
  }
}

function comparisonSummary(samples, { bootstrapIterations, seed }) {
  const source = samples.filter((sample) => sample.lane === 'source-checkout' && sample.valid);
  const packed = samples.filter((sample) => sample.lane === 'packed' && sample.valid);
  const output = {
    packed: summarizeCliSamples(packed),
    'source-checkout': summarizeCliSamples(source),
  };
  output.paired = {
    durationMs: pairedMetric(source, packed, 'durationMs', bootstrapIterations, seed),
    peakRssBytes: pairedMetric(source, packed, 'peakRssBytes', bootstrapIterations, seed + 1),
  };
  const sourceMedian = output['source-checkout'].durationMs.median;
  const packedMedian = output.packed.durationMs.median;
  output.packedDurationImprovementPercent =
    sourceMedian === null || packedMedian === null || sourceMedian === 0
      ? null
      : ((sourceMedian - packedMedian) / sourceMedian) * 100;
  return output;
}

function pairedMetric(baseline, spike, key, iterations, seed) {
  const baselineByOccurrence = new Map(baseline.map((sample) => [sample.occurrence, sample[key]]));
  const spikeByOccurrence = new Map(spike.map((sample) => [sample.occurrence, sample[key]]));
  const occurrences = [...baselineByOccurrence.keys()]
    .filter((occurrence) => spikeByOccurrence.has(occurrence))
    .sort((left, right) => left - right);
  const baselineValues = occurrences.map((occurrence) => baselineByOccurrence.get(occurrence));
  const spikeValues = occurrences.map((occurrence) => spikeByOccurrence.get(occurrence));
  const differences = baselineValues.map((value, index) => spikeValues[index] - value);
  return {
    bootstrap95Ci: pairedBootstrapConfidenceInterval(baselineValues, spikeValues, {
      iterations,
      seed,
    }),
    direction: 'packed-minus-source-checkout',
    medianDifference: differences.length === 0 ? null : quantile(differences, 0.5),
    samples: differences.length,
  };
}

function normalizedOptions(options) {
  const quick = options.quickSmoke === true;
  const samples = boundedInteger(
    options.samples ?? (quick ? 2 : DEFAULT_SAMPLES),
    1,
    100,
    '--samples',
  );
  const warmups = boundedInteger(
    options.warmups ?? (quick ? 0 : DEFAULT_WARMUPS),
    0,
    20,
    '--warmups',
  );
  const bootstrapIterations = boundedInteger(
    options.bootstrapIterations ?? (quick ? 500 : DEFAULT_BOOTSTRAP_ITERATIONS),
    100,
    1_000_000,
    '--bootstrap-iterations',
  );
  const packedFastBudgetMs =
    options.packedFastBudgetMs === undefined
      ? null
      : finitePositive(options.packedFastBudgetMs, '--packed-fast-budget-ms');
  return {
    allowDirty: options.allowDirty === true,
    bootstrapIterations,
    installTimeoutMs: boundedInteger(
      options.installTimeoutMs ?? 10 * 60 * 1_000,
      1_000,
      60 * 60 * 1_000,
      '--install-timeout-ms',
    ),
    maxLoadPerCpu: finitePositive(options.maxLoadPerCpu ?? 1, '--max-load-per-cpu'),
    packedFastBudgetMs,
    prepareOnly: options.prepareOnly === true,
    sampleIntervalMs: boundedInteger(
      options.sampleIntervalMs ?? 10,
      10,
      1_000,
      '--sample-interval-ms',
    ),
    samples,
    seed: boundedInteger(options.seed ?? 1, 0, 0xffff_ffff, '--seed'),
    timeoutMs: boundedInteger(options.timeoutMs ?? 60_000, 1_000, 10 * 60 * 1_000, '--timeout-ms'),
    timingLockPath:
      options.timingLockPath ?? path.join(os.tmpdir(), 'kovo-performance-timing.lock'),
    warmups,
  };
}

function sampleHostLoad(label, ceiling) {
  const loadAverage = os.loadavg();
  const cpuCount = os.cpus().length;
  const loadPerCpu = loadAverage[0] / cpuCount;
  return {
    at: new Date().toISOString(),
    ceiling,
    comparable: loadPerCpu <= ceiling,
    cpuCount,
    label,
    loadAverage,
    loadPerCpu,
  };
}

function acquireTimingLock(lockPath) {
  const resolved = path.resolve(lockPath);
  let descriptor;
  try {
    descriptor = openSync(resolved, 'wx', 0o600);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    let owner = 'unknown owner';
    try {
      owner = readFileSync(resolved, 'utf8').trim() || owner;
    } catch {}
    throw new Error(`another performance timing lane owns ${resolved}: ${owner}`);
  }
  writeFileSync(
    descriptor,
    `${JSON.stringify({ pid: process.pid, schema: 'kovo-perf-lock/v1' })}\n`,
  );
  closeSync(descriptor);
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      unlinkSync(resolved);
    },
  };
}

function packedResolutionProofSource() {
  return `import { appendFileSync, realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const entry = realpathSync(process.env.KOVO_PACKED_CLI_ENTRY);
const trace = process.env.KOVO_PACKED_CLI_TRACE;
const nodeModules = realpathSync(new URL('./node_modules', import.meta.url));
const seen = new Set();

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    if (resolved.url.startsWith('file:')) {
      const candidate = realpathSync(fileURLToPath(resolved.url));
      if (!contained(nodeModules, candidate)) {
        throw new Error('packed CLI resolved outside isolated node_modules: ' + candidate);
      }
      if (!seen.has(candidate)) {
        seen.add(candidate);
        appendFileSync(trace, JSON.stringify({ path: path.relative(nodeModules, candidate).split(path.sep).join('/'), url: pathToFileURL(candidate).href }) + '\\n');
      }
    }
    return resolved;
  },
});

await import(pathToFileURL(entry).href);
`;
}

function commandFindings(measured, expectedStdout) {
  const findings = [];
  if (measured.error !== null) findings.push(`process-tree error: ${String(measured.error)}`);
  if (measured.exitCode !== 0) findings.push(`exit ${String(measured.exitCode)}`);
  if (measured.signal !== null) findings.push(`signal ${String(measured.signal)}`);
  if (measured.stdout !== expectedStdout)
    findings.push('stdout differed from exact version contract');
  if (measured.stderr !== '') findings.push('stderr was not empty');
  if (!Number.isFinite(measured.durationMs) || measured.durationMs <= 0) {
    findings.push('duration was not finite and positive');
  }
  if (!Number.isFinite(measured.peakRssBytes) || measured.peakRssBytes <= 0) {
    findings.push('peak RSS was not finite and positive');
  }
  if (!Number.isSafeInteger(measured.sampleCount) || measured.sampleCount < 1) {
    findings.push('process-tree RSS sample count was missing');
  }
  return findings;
}

function benchmarkVerdict({ evidenceComplete, source, sourceStable }) {
  const reasons = [];
  if (!evidenceComplete) reasons.push('benchmark evidence is incomplete');
  if (source.dirty) reasons.push('source provenance is dirty');
  if (!sourceStable) reasons.push('source provenance changed during the run');
  return { reasons, status: reasons.length === 0 ? 'measured' : 'unproven' };
}

function runCheckedExec(exec, command, args, options) {
  try {
    return exec(command, args, {
      ...options,
      encoding: 'utf8',
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = boundedDiagnostic(
      `${String(error?.stdout ?? '')}\n${String(error?.stderr ?? '')}`.trim() || error?.message,
    );
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
  }
}

function runCheckedCapture(capture, command, args, options) {
  const result = capture(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs,
  });
  if (result.error || result.signal || result.status !== 0) {
    const commandOutput = `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`.trim();
    throw new Error(
      `${options.label} failed: ${boundedDiagnostic(
        result.error?.message ??
          (commandOutput || `exit ${String(result.status)} signal ${String(result.signal)}`),
      )}`,
    );
  }
  return result;
}

function cleanCliEnvironment(base) {
  const env = { ...base };
  for (const name of ['KOVO_CLI_TRANSFORM_TYPES', 'NODE_OPTIONS', 'NODE_PATH']) delete env[name];
  env.CI = '1';
  env.FORCE_COLOR = '0';
  env.LANG = 'C';
  env.LC_ALL = 'C';
  env.NO_COLOR = '1';
  env.TZ = 'UTC';
  return env;
}

function regularFileCensus(root) {
  const files = [];
  const visit = (directory, packageRoot = false) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      // pnpm materializes dependency links and command shims here after extracting the package.
      // They are authenticated separately by the frozen consumer lock and resolution proof, not
      // part of the package tarball's own exact file census.
      if (packageRoot && entry.name === 'node_modules') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`installed package contains symlink ${absolute}`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join('/'));
      else throw new Error(`installed package contains non-regular entry ${absolute}`);
    }
  };
  visit(root, true);
  return files.sort(bytewise);
}

function packagePath(nodeModules, packageName) {
  return path.join(nodeModules, ...packageName.split('/'));
}

function relativeNodeModulesPath(consumerRoot, candidate) {
  const nodeModules = realpathSync(path.join(consumerRoot, 'node_modules'));
  const resolved = realpathSync(candidate);
  assertContainedPath(nodeModules, resolved, 'packed resolution candidate');
  return path.relative(nodeModules, resolved).split(path.sep).join('/');
}

function assertNonSymlinkDirectory(directory, label) {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a non-symlink directory`);
  }
}

function assertContainedPath(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} resolves outside its authenticated root`);
  }
}

function containedOrEqual(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function sameStringList(left, right) {
  const first = [...left].sort(bytewise);
  const second = [...right].sort(bytewise);
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function sameSourceState(left, right) {
  return (
    left.commit === right.commit &&
    JSON.stringify(left.dirtyPaths) === JSON.stringify(right.dirtyPaths) &&
    JSON.stringify(left.locks) === JSON.stringify(right.locks)
  );
}

function validLockEvidence(locks) {
  return LOCK_FILES.every((file) => /^sha256:[0-9a-f]{64}$/u.test(locks?.[file] ?? ''));
}

function summarizeMetric(values) {
  if (values.length === 0) return { mad: null, median: null, p95: null, samples: 0 };
  const median = quantile(values, 0.5);
  return {
    mad: quantile(
      values.map((value) => Math.abs(value - median)),
      0.5,
    ),
    median,
    p95: quantile(values, 0.95),
    samples: values.length,
  };
}

function quantile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function finitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${label} must be positive`);
  return value;
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function sha256File(file) {
  return sha256(readFileSync(file));
}

function bytewise(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function boundedDiagnostic(value) {
  const text = String(value ?? '').trim() || '<no output>';
  return text.length <= 4_096 ? text : `${text.slice(0, 4_096)}\n... truncated ...`;
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseCliStartupArgs(argv);
  const report = await runCliStartupBenchmark(parsed);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (parsed.out !== undefined) writeFileSync(path.resolve(parsed.out), serialized, 'utf8');
  process.stdout.write(serialized);
  return report.integrity.complete ? 0 : 1;
}

if (isMainEntry(import.meta.url)) await runGate(() => main());
