#!/usr/bin/env node
/**
 * Serialized baseline/spike adapter for the authenticated packed `kovo check --watch` workload.
 *
 * Each arm is a clean, prepared `kovo-packed-check` scenario. The adapter installs only that
 * scenario's authenticated product tarballs into a temporary stage, but supplies the same current
 * code-owned workload/harness bytes to both arms. It then runs baseline, spike, spike, baseline,
 * refusing timing above the declared host-load ceiling. Durations are the workload's edit-to-JSONL
 * clock, not process startup or this adapter's validation time.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { bootstrapMedianCi, summarize } from '../benchmarks/compare.mjs';
import {
  DEVEX_BENCHMARK_SCENARIO_SCHEMA,
  DEVEX_PACKED_WORKLOAD_SCHEMA,
  validateBenchmarkScenario,
  validateIncrementalSessionMarkerForTesting,
} from './devex-benchmark.mjs';
import {
  readPackageTarballSnapshot,
  validatedPackageTarballEntries,
} from './lib/deterministic-tarball.mjs';

export const CHECK_WATCH_SPIKE_SCHEMA = 'kovo-check-watch-spike-comparison/v1';
export const CHECK_WATCH_SPIKE_ORDER = Object.freeze(['baseline', 'spike', 'spike', 'baseline']);

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const workloadRoot = path.join(repoRoot, 'scripts/devex-workloads/kovo-packed-check/package');
const defaultTimeoutMs = 30 * 60 * 1_000;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

export function checkWatchSpikeSchedule(samples) {
  if (!Number.isSafeInteger(samples) || samples < 2) {
    throw new TypeError('check-watch spike samples must be an integer of at least two');
  }
  const counts = [Math.ceil(samples / 2), Math.floor(samples / 2)];
  const occurrences = { baseline: 0, spike: 0 };
  return CHECK_WATCH_SPIKE_ORDER.map((arm) => {
    const occurrence = occurrences[arm];
    occurrences[arm] += 1;
    return Object.freeze({ arm, occurrence, samples: counts[occurrence] });
  });
}

export function pairedCheckWatchAnalysis(
  baseline,
  spike,
  { bootstrapIterations = 10_000, seed = 0x4b4f564f } = {},
) {
  if (baseline.length !== spike.length || baseline.length === 0) {
    throw new TypeError('paired check-watch analysis requires equal non-empty arms');
  }
  const durationDifferences = [];
  const durationImprovementPercent = [];
  const rssDifferences = [];
  for (let index = 0; index < baseline.length; index += 1) {
    const baselineDuration = finiteNonNegative(baseline[index]?.durationMs, 'baseline duration');
    const spikeDuration = finiteNonNegative(spike[index]?.durationMs, 'spike duration');
    if (baselineDuration === 0) {
      throw new TypeError('paired check-watch baseline duration must be nonzero');
    }
    durationDifferences.push(baselineDuration - spikeDuration);
    durationImprovementPercent.push(((baselineDuration - spikeDuration) / baselineDuration) * 100);
    const baselineRss = finiteNonNegative(baseline[index]?.peakRssBytes, 'baseline peak RSS');
    const spikeRss = finiteNonNegative(spike[index]?.peakRssBytes, 'spike peak RSS');
    rssDifferences.push(baselineRss - spikeRss);
  }
  const baselineDurations = baseline.map((sample) => sample.durationMs);
  const spikeDurations = spike.map((sample) => sample.durationMs);
  const baselineRss = baseline.map((sample) => sample.peakRssBytes);
  const spikeRss = spike.map((sample) => sample.peakRssBytes);
  const baselineSummary = summarize(baselineDurations);
  const spikeSummary = summarize(spikeDurations);
  return Object.freeze({
    baseline: Object.freeze({
      durationMs: summarize(baselineDurations),
      peakRssBytes: summarize(baselineRss),
    }),
    paired: Object.freeze({
      durationDifferenceMs: Object.freeze({
        bootstrap95Ci: bootstrapMedianCi(durationDifferences, {
          iterations: bootstrapIterations,
          seed,
        }),
        direction: 'baseline-minus-spike',
        median: summarize(durationDifferences).median,
      }),
      durationImprovementPercent: Object.freeze({
        bootstrap95Ci: bootstrapMedianCi(durationImprovementPercent, {
          iterations: bootstrapIterations,
          seed: seed + 1,
        }),
        direction: 'positive-is-faster',
        median: summarize(durationImprovementPercent).median,
      }),
      peakRssDifferenceBytes: Object.freeze({
        bootstrap95Ci: bootstrapMedianCi(rssDifferences, {
          iterations: bootstrapIterations,
          seed: seed + 2,
        }),
        direction: 'baseline-minus-spike',
        median: summarize(rssDifferences).median,
      }),
      samples: baseline.length,
    }),
    spike: Object.freeze({
      durationMs: spikeSummary,
      peakRssBytes: summarize(spikeRss),
    }),
    summaryMedianImprovementPercent:
      ((baselineSummary.median - spikeSummary.median) / baselineSummary.median) * 100,
  });
}

export function runCheckWatchSpikeComparison(options) {
  const samples = positiveInteger(options.samples ?? 30, 'samples');
  if (samples < 2) throw new TypeError('samples must be at least two');
  const warmups = nonNegativeInteger(options.warmups ?? 3, 'warmups');
  const bootstrapIterations = positiveInteger(
    options.bootstrapIterations ?? 10_000,
    'bootstrapIterations',
  );
  const maxLoadPerCpu = finitePositive(options.maxLoadPerCpu ?? 0.75, 'maxLoadPerCpu');
  const timeoutMs = positiveInteger(options.timeoutMs ?? defaultTimeoutMs, 'timeoutMs');
  const prepareArm = options.prepareArm ?? preparePackedArm;
  const runSession = options.runSession ?? runPackedIncrementalSession;
  const sampleHost = options.sampleHost ?? hostObservation;
  const schedule = checkWatchSpikeSchedule(samples);
  const errors = [];
  const hostSamples = [];
  const rawCells = [];
  const measured = { baseline: [[], []], spike: [[], []] };
  const prepared = [];
  let baseline;
  let spike;

  try {
    baseline = prepareArm('baseline', {
      repositoryRoot: options.baselineRepositoryRoot,
      scenarioPath: options.baselineScenario,
    });
    prepared.push(baseline);
    spike = prepareArm('spike', {
      repositoryRoot: options.spikeRepositoryRoot,
      scenarioPath: options.spikeScenario,
    });
    prepared.push(spike);
    if (baseline.workloadDigest !== spike.workloadDigest) {
      errors.push('baseline and spike stages do not carry the same workload digest');
    }
    if (baseline.lockDigest !== spike.lockDigest) {
      errors.push('baseline and spike stages do not carry the same frozen lock digest');
    }

    for (
      let scheduleIndex = 0;
      errors.length === 0 && scheduleIndex < schedule.length;
      scheduleIndex += 1
    ) {
      const cell = schedule[scheduleIndex];
      const hostBefore = sampleHost();
      hostSamples.push({
        arm: cell.arm,
        occurrence: cell.occurrence,
        position: 'before',
        ...hostBefore,
      });
      if (!Number.isFinite(hostBefore.loadPerCpu) || hostBefore.loadPerCpu > maxLoadPerCpu) {
        errors.push(
          `host load ${String(hostBefore.loadPerCpu)} per CPU exceeded ceiling ${String(maxLoadPerCpu)} before ${cell.arm}/${String(cell.occurrence)}`,
        );
        break;
      }
      const arm = cell.arm === 'baseline' ? baseline : spike;
      try {
        const requestedEdits = warmups + cell.samples;
        const session = runSession(arm, {
          requestedEdits,
          timeoutMs,
        });
        const validated = validateIncrementalSessionMarkerForTesting(session, requestedEdits);
        const observations = validated.observations.slice(warmups + 1);
        if (observations.length !== cell.samples) {
          throw new Error(
            `${cell.arm}/${String(cell.occurrence)} returned ${String(observations.length)} measured edits, expected ${String(cell.samples)}`,
          );
        }
        measured[cell.arm][cell.occurrence].push(...observations);
        rawCells.push({
          arm: cell.arm,
          occurrence: cell.occurrence,
          samples: observations,
          session: {
            observedRevisions: validated.observations.length,
            requestedEdits,
            sessionDigest: validated.sessionDigest,
            warmups,
          },
        });
      } catch (error) {
        errors.push(
          `${cell.arm}/${String(cell.occurrence)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const hostAfter = sampleHost();
      hostSamples.push({
        arm: cell.arm,
        occurrence: cell.occurrence,
        position: 'after',
        ...hostAfter,
      });
      if (
        errors.length === 0 &&
        (!Number.isFinite(hostAfter.loadPerCpu) || hostAfter.loadPerCpu > maxLoadPerCpu)
      ) {
        errors.push(
          `host load ${String(hostAfter.loadPerCpu)} per CPU exceeded ceiling ${String(maxLoadPerCpu)} after ${cell.arm}/${String(cell.occurrence)}`,
        );
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    for (let index = prepared.length - 1; index >= 0; index -= 1) {
      try {
        prepared[index].verifyStable?.();
      } catch (error) {
        errors.push(`source stability: ${error instanceof Error ? error.message : String(error)}`);
      }
      try {
        prepared[index].dispose();
      } catch (error) {
        errors.push(`stage cleanup: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const baselineSamples = measured.baseline.flat();
  const spikeSamples = measured.spike.flat();
  const misses = {
    baseline: samples - baselineSamples.length,
    spike: samples - spikeSamples.length,
  };
  let analysis = null;
  if (errors.length === 0 && misses.baseline === 0 && misses.spike === 0) {
    try {
      analysis = pairedCheckWatchAnalysis(baselineSamples, spikeSamples, {
        bootstrapIterations,
        seed: options.seed ?? 0x4b4f564f,
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  const zeroCounts = {
    baseline: baselineSamples.filter((sample) => sample.durationMs === 0).length,
    spike: spikeSamples.filter((sample) => sample.durationMs === 0).length,
  };
  const complete =
    errors.length === 0 &&
    misses.baseline === 0 &&
    misses.spike === 0 &&
    zeroCounts.baseline === 0 &&
    zeroCounts.spike === 0 &&
    rawCells.map((cell) => cell.arm).join(',') === CHECK_WATCH_SPIKE_ORDER.join(',');
  const medianImprovement = analysis?.summaryMedianImprovementPercent ?? null;
  const pairedCi = analysis?.paired.durationImprovementPercent.bootstrap95Ci ?? [null, null];
  const accepted =
    complete && medianImprovement >= 10 && Number.isFinite(pairedCi[0]) && pairedCi[0] > 0;
  const measuredButRejected = complete && !accepted;

  return {
    analysis,
    generatedAt: new Date().toISOString(),
    hostSamples,
    integrity: {
      complete,
      errors,
      executionOrder: rawCells.map((cell) => cell.arm),
      expectedOrder: CHECK_WATCH_SPIKE_ORDER,
      hostLoadCeilingPerCpu: maxLoadPerCpu,
      misses,
      serialized: true,
      zeroCounts,
    },
    policy: {
      acceptance: '>=10% median improvement and paired bootstrap 95% CI above zero',
      bootstrapIterations,
      samplesPerArm: samples,
      schedule,
      warmupsPerOccurrence: warmups,
    },
    provenance: {
      baseline: baseline?.identity ?? null,
      spike: spike?.identity ?? null,
      workloadDigest: baseline?.workloadDigest ?? null,
      frozenLockDigest: baseline?.lockDigest ?? null,
    },
    rawCells,
    schema: CHECK_WATCH_SPIKE_SCHEMA,
    verdict: {
      accepted,
      reasons: !complete
        ? ['measurement integrity is incomplete']
        : measuredButRejected
          ? [
              `median improvement ${String(medianImprovement)}% or paired CI ${JSON.stringify(pairedCi)} did not meet acceptance`,
            ]
          : [],
      status: accepted ? 'accepted' : measuredButRejected ? 'rejected' : 'unmeasured',
    },
  };
}

function preparePackedArm(arm, options) {
  const scenarioPath = requiredPath(options.scenarioPath, `${arm} scenario`);
  const repositoryRoot = requiredPath(options.repositoryRoot, `${arm} repository root`);
  const repositoryIdentity = cleanRepositoryIdentity(repositoryRoot);
  const scenarioBytes = readFileSync(scenarioPath);
  const scenario = JSON.parse(scenarioBytes.toString('utf8'));
  const scenarioFindings = validateBenchmarkScenario(scenario);
  if (scenarioFindings.length > 0) {
    throw new Error(`${arm} scenario is invalid: ${scenarioFindings.join('; ')}`);
  }
  if (
    scenario?.schema !== DEVEX_BENCHMARK_SCENARIO_SCHEMA ||
    scenario?.name !== 'kovo-packed-check' ||
    scenario?.provenance?.sourceCommit !== repositoryIdentity.commit ||
    !digestPattern.test(scenario?.provenance?.workloadManifest?.sha256 ?? '')
  ) {
    throw new Error(`${arm} scenario does not bind its clean repository HEAD`);
  }
  const scenarioRoot = path.dirname(scenarioPath);
  const manifestPath = confinedPath(
    scenarioRoot,
    scenario.provenance.workloadManifest.path,
    `${arm} workload manifest`,
  );
  const manifestBytes = readFileSync(manifestPath);
  if (sha256(manifestBytes) !== scenario.provenance.workloadManifest.sha256) {
    throw new Error(`${arm} workload manifest digest mismatch`);
  }
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (
    manifest?.schema !== DEVEX_PACKED_WORKLOAD_SCHEMA ||
    manifest?.profile?.id !== 'kovo-packed-check/v3' ||
    !Array.isArray(manifest?.artifacts)
  ) {
    throw new Error(`${arm} workload manifest is invalid`);
  }
  const declaredArtifacts = manifest.artifacts.map(
    ({ name, path: artifactPath, sha256: digest }) => ({
      name,
      path: artifactPath,
      sha256: digest,
    }),
  );
  if (!isDeepStrictEqual(declaredArtifacts, scenario.provenance.packedArtifacts)) {
    throw new Error(`${arm} scenario artifact provenance mismatch`);
  }

  const stageRoot = mkdtempSync(path.join(os.tmpdir(), `kovo-check-watch-${arm}-`));
  try {
    copyRegularTree(workloadRoot, stageRoot);
    const commonLockPath = path.join(repoRoot, 'pnpm-lock.yaml');
    const armLockPath = path.join(repositoryRoot, 'pnpm-lock.yaml');
    const commonLockDigest = sha256(readFileSync(commonLockPath));
    if (commonLockDigest !== sha256(readFileSync(armLockPath))) {
      throw new Error(`${arm} repository lock differs from the comparator's frozen lock`);
    }
    copyFileSync(commonLockPath, path.join(stageRoot, 'benchmark-lock.yaml'));
    const packageDigests = [];
    const nodeModules = path.join(stageRoot, 'node_modules');
    mkdirSync(path.join(nodeModules, '@kovojs'), { recursive: true });
    for (const artifact of manifest.artifacts) {
      const artifactPath = confinedPath(scenarioRoot, artifact.path, `${arm} artifact`);
      const compressed = readPackageTarballSnapshot(artifactPath);
      if (sha256(compressed) !== artifact.sha256) {
        throw new Error(`${arm} artifact digest mismatch for ${artifact.name}`);
      }
      const entries = validatedPackageTarballEntries(compressed);
      const observedFiles = entries.map((entry) => ({
        executable: entry.executable,
        path: entry.name.slice('package/'.length),
        sha256: sha256(entry.data),
      }));
      if (!isDeepStrictEqual(observedFiles, artifact.files)) {
        throw new Error(`${arm} artifact file census mismatch for ${artifact.name}`);
      }
      if (artifact.role !== 'package') continue;
      const destination = packageDestination(nodeModules, artifact.name);
      mkdirSync(destination, { recursive: true });
      for (const entry of entries) {
        const relative = entry.name.slice('package/'.length);
        const output = confinedPath(destination, relative, `${arm} ${artifact.name} entry`);
        mkdirSync(path.dirname(output), { recursive: true });
        writeFileSync(output, entry.data, { flag: 'wx' });
        chmodSync(output, entry.executable ? 0o755 : 0o644);
      }
      packageDigests.push({ name: artifact.name, sha256: artifact.sha256 });
    }
    // The product packages vary by arm; every third-party dependency comes from one shared,
    // frozen-lock install so divergent worktree installs cannot manufacture an arm difference.
    linkExternalDependencies(repoRoot, nodeModules);
    const workloadDigest = treeDigest(stageRoot, (relative) => {
      return relative !== 'benchmark-lock.yaml' && !relative.startsWith('node_modules/');
    });
    const lockDigest = sha256(readFileSync(path.join(stageRoot, 'benchmark-lock.yaml')));
    return {
      dispose() {
        rmSync(stageRoot, { force: true, recursive: true });
      },
      identity: {
        packages: packageDigests,
        repository: repositoryIdentity,
        scenarioDigest: sha256(scenarioBytes),
        scenarioPath,
      },
      lockDigest,
      root: stageRoot,
      verifyStable() {
        const current = cleanRepositoryIdentity(repositoryRoot);
        if (current.commit !== repositoryIdentity.commit) {
          throw new Error(`${arm} repository identity changed during measurement`);
        }
      },
      workloadDigest,
    };
  } catch (error) {
    rmSync(stageRoot, { force: true, recursive: true });
    throw error;
  }
}

function runPackedIncrementalSession(arm, options) {
  // Execute the staged profile whose bytes are covered by workloadDigest, not an unstaged helper
  // path in the comparator checkout.
  const result = spawnSync(
    process.execPath,
    [path.join(arm.root, 'profile.mjs'), 'oneFileIncremental'],
    {
      cwd: arm.root,
      encoding: 'utf8',
      env: {
        ...process.env,
        KOVO_DEVEX_INCREMENTAL_SAMPLES: String(options.requestedEdits),
      },
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeoutMs,
    },
  );
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error(
      result.error?.message ??
        result.signal ??
        result.stderr?.trim() ??
        `packed incremental session exited ${String(result.status)}`,
    );
  }
  const marker = /^kovo-benchmark-incremental-session\/v1 ([A-Za-z0-9_-]+)\r?\n?$/u.exec(
    result.stdout ?? '',
  );
  if (marker === null) throw new Error('packed incremental session omitted its exact marker');
  return JSON.parse(Buffer.from(marker[1], 'base64url').toString('utf8'));
}

function cleanRepositoryIdentity(root) {
  const commit = gitOutput(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const topLevel = realpathSync(gitOutput(root, ['rev-parse', '--show-toplevel']));
  if (topLevel !== realpathSync(root)) throw new Error(`${root} is not a Git worktree root`);
  const dirtyPaths = gitOutput(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (dirtyPaths !== '') throw new Error(`${root} is not clean`);
  return { commit, dirtyPaths: [], root };
}

function gitOutput(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error(`git ${args.join(' ')} failed for ${root}`);
  }
  return result.stdout.trim();
}

function linkExternalDependencies(repositoryRoot, nodeModules) {
  const source = path.join(repositoryRoot, 'node_modules');
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === '@kovojs') continue;
    const destination = path.join(nodeModules, entry.name);
    symlinkSync(realpathSync(path.join(source, entry.name)), destination, 'dir');
  }
}

function packageDestination(nodeModules, name) {
  const match = /^@([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*)$/u.exec(name);
  if (match === null) throw new TypeError(`unsupported packed package name ${String(name)}`);
  return path.join(nodeModules, `@${match[1]}`, match[2]);
}

function copyRegularTree(source, destination) {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`benchmark workload contains symlink ${from}`);
    if (entry.isDirectory()) {
      mkdirSync(to, { recursive: true });
      copyRegularTree(from, to);
    } else if (entry.isFile()) {
      copyFileSync(from, to);
      chmodSync(to, lstatSync(from).mode & 0o777);
    } else {
      throw new Error(`benchmark workload contains non-regular entry ${from}`);
    }
  }
}

function treeDigest(root, include) {
  const rows = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (relative !== 'node_modules') visit(absolute);
      } else if (entry.isFile() && include(relative)) {
        const bytes = readFileSync(absolute);
        rows.push(`${relative}\0${bytes.byteLength}\0${sha256(bytes)}`);
      }
    }
  };
  visit(root);
  return sha256(Buffer.from(rows.join('\n'), 'utf8'));
}

function confinedPath(root, relative, label) {
  if (
    typeof relative !== 'string' ||
    relative.length === 0 ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/u).some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new TypeError(`${label} must be a canonical relative path`);
  }
  const resolved = path.resolve(root, ...relative.split('/'));
  if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) {
    throw new TypeError(`${label} escapes its root`);
  }
  return resolved;
}

function hostObservation() {
  const logicalCpuCount = os.cpus().length;
  const loadAverage = os.loadavg();
  return {
    at: new Date().toISOString(),
    loadAverage,
    loadPerCpu: loadAverage[0] / logicalCpuCount,
    logicalCpuCount,
  };
}

function finiteNonNegative(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be finite and non-negative`);
  }
  return value;
}

function finitePositive(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be finite and positive`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value;
}

function requiredPath(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} is required`);
  }
  return path.resolve(value);
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--baseline-scenario') options.baselineScenario = argv[++index];
    else if (argument === '--spike-scenario') options.spikeScenario = argv[++index];
    else if (argument === '--baseline-repo') options.baselineRepositoryRoot = argv[++index];
    else if (argument === '--spike-repo') options.spikeRepositoryRoot = argv[++index];
    else if (argument === '--samples') options.samples = Number(argv[++index]);
    else if (argument === '--warmups') options.warmups = Number(argv[++index]);
    else if (argument === '--bootstrap-iterations') {
      options.bootstrapIterations = Number(argv[++index]);
    } else if (argument === '--max-load-per-cpu') options.maxLoadPerCpu = Number(argv[++index]);
    else if (argument === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (argument === '--seed') options.seed = Number(argv[++index]);
    else if (argument === '--out') options.output = argv[++index];
    else if (argument === '--help') options.help = true;
    else throw new TypeError(`unknown argument ${String(argument)}`);
  }
  return options;
}

function usage() {
  return (
    'Usage: node scripts/perf-check-watch-spike.mjs ' +
    '--baseline-scenario <json> --baseline-repo <worktree> ' +
    '--spike-scenario <json> --spike-repo <worktree> --out <json> ' +
    '[--samples 30] [--warmups 3] [--max-load-per-cpu 0.75]\n'
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let options;
  let report;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage());
    } else {
      if (typeof options.output !== 'string') throw new TypeError('--out is required');
      report = runCheckWatchSpikeComparison(options);
      writeFileSync(path.resolve(options.output), `${JSON.stringify(report, null, 2)}\n`);
      process.stdout.write(
        `${CHECK_WATCH_SPIKE_SCHEMA} ${report.verdict.status} ${path.resolve(options.output)}\n`,
      );
      if (!report.verdict.accepted) process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.stderr.write(usage());
    process.exitCode = 1;
  }
}
