#!/usr/bin/env node
/**
 * Authenticated serialized A/B runner for loader-runtime selection memoization.
 *
 * Each arm is an independently built clean worktree. The spike must be one direct commit above the
 * baseline, and this runner binds its exact binary patch, object identities, source/lock state,
 * benchmark workload, and adapter bytes before any timing is admitted. Unprofiled B,S,S,B windows
 * own timing claims; Inspector profiles are diagnostic-only and run after the matrix.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { bootstrapMedianCi, summarize } from '../benchmarks/compare.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { performanceExecutionIdentity } from './lib/perf-execution.mjs';
import { canonicalJson, performanceHostFingerprint } from './lib/perf-host.mjs';

export const LOADER_RUNTIME_MEMO_AB_SCHEMA = 'kovo-loader-runtime-memo-ab/v1';
export const LOADER_RUNTIME_MEMO_PREPARE_SCHEMA = 'kovo-loader-runtime-memo-prepare/v1';
export const LOADER_RUNTIME_MEMO_BINDING_SCHEMA = 'kovo-loader-runtime-memo-candidate/v1';
export const LOADER_RUNTIME_MEMO_ORDER = Object.freeze(['baseline', 'spike', 'spike', 'baseline']);
export const LOADER_RUNTIME_MEMO_ROUTES = Object.freeze(['listing', 'detail']);
export const LOADER_RUNTIME_MEMO_CONCURRENCIES = Object.freeze([1, 8, 32]);
export const HISTORICAL_LOADER_RUNTIME_MEMO = Object.freeze({
  baseline: 'ce327123caf5b73a205d8c537f89191413a6edb4',
  candidate: 'b545756ae94e0717d5e043b9f9b60e23014130a8',
  fixtureOnly: 'e54c595b5906df9ab9b9b5e3fbf18e76c99e79b9',
  originManifest: 'docs/performance/loader-runtime-memo-origin.json',
  originManifestSha256: 'sha256:fddc249bea4184ec294bace39e0531d4ad7afd74b4cfe9a923a103eba7be1d85',
  patchSha256: 'sha256:0c5bd1a78d29316d3a90fec9b1ddc23a5fe0a706b634ff6cc96287045795091f',
  posture: '3279995d3469d045ec8f37fe9ddbcff79f8230f8',
  stablePatchId: 'c36f0151ec4fa0524c094d1b7700e727753bac70',
});

const ADAPTER_SCHEMA = 'kovo-server-benchmark/v1';
const PREPARE_SCHEMA = 'kovo-server-benchmark-prepare/v1';
const PROFILE_SCHEMA = 'kovo-forced-dynamic-ssr-profile/v1';
const LOCK_FILES = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);
const TOOLING_FILES = Object.freeze([
  'benchmarks/kovo/src/app.tsx',
  'docs/performance/loader-runtime-memo-origin.json',
  'scripts/perf-loader-runtime-memo-ab.mjs',
  'scripts/perf-server-benchmark.mjs',
  'scripts/perf-server-profile.mjs',
  'scripts/lib/perf-cpu-profile-launcher.mjs',
  'scripts/lib/perf-host.mjs',
  'scripts/lib/perf-provenance.mjs',
  'scripts/lib/process-tree-metrics.mjs',
  'scripts/lib/process-tree-rss.mjs',
]);
const DEFAULT_BOOTSTRAP_ITERATIONS = 10_000;
const DEFAULT_DURATION_MS = 15_000;
const DEFAULT_HOST_SETTLE_MAX_MS = 30_000;
const DEFAULT_HOST_SETTLE_POLL_MS = 1_000;
const DEFAULT_MAX_LOAD_PER_CPU = 0.75;
const DEFAULT_SAMPLES = 7;
const DEFAULT_WARMUP_MS = 5_000;
const HISTORICAL_PATCH_COMMAND = Object.freeze([
  'git',
  '-C',
  '<repository-root>',
  'diff',
  '--binary',
  '--full-index',
  '--no-ext-diff',
  HISTORICAL_LOADER_RUNTIME_MEMO.baseline,
  HISTORICAL_LOADER_RUNTIME_MEMO.candidate,
]);
const MAX_CAPTURE_BYTES = 1024 * 1024;
const MAX_REPORT_BYTES = 64 * 1024 * 1024;
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const METRICS = Object.freeze([
  Object.freeze({ higherIsBetter: true, name: 'requestsPerSecond' }),
  Object.freeze({ higherIsBetter: false, name: 'p50Ms' }),
  Object.freeze({ higherIsBetter: false, name: 'p95Ms' }),
  Object.freeze({ higherIsBetter: false, name: 'p99Ms' }),
  Object.freeze({ higherIsBetter: false, name: 'serverCpuMs' }),
  Object.freeze({ higherIsBetter: false, name: 'serverCpuPercent' }),
  Object.freeze({ higherIsBetter: false, name: 'peakRssBytes' }),
]);

export function loaderRuntimeMemoSchedule(samples = DEFAULT_SAMPLES) {
  boundedInteger(samples, 1, 100, 'samples');
  const counts = { baseline: 0, spike: 0 };
  const schedule = [];
  while (counts.baseline < samples || counts.spike < samples) {
    for (const lane of LOADER_RUNTIME_MEMO_ORDER) {
      if (counts[lane] >= samples) continue;
      schedule.push({ lane, occurrence: counts[lane] });
      counts[lane] += 1;
    }
  }
  return schedule;
}

export function authenticateLoaderRuntimeMemoRoots(options, dependencies = {}) {
  const git = dependencies.git ?? gitOutput;
  const patch = dependencies.patch ?? gitPatchBytes;
  const patchId = dependencies.patchId ?? gitPatchId;
  const baselineRoot = canonicalGitRoot(options.baselineRoot, git);
  const spikeRoot = canonicalGitRoot(options.spikeRoot, git);
  if (baselineRoot === spikeRoot) throw new TypeError('baseline and spike roots must be distinct');
  const baselineCommit = git(baselineRoot, ['rev-parse', 'HEAD']);
  const spikeCommit = git(spikeRoot, ['rev-parse', 'HEAD']);
  const baselineDirtyPaths = gitDirtyPaths(baselineRoot, git);
  const spikeDirtyPaths = gitDirtyPaths(spikeRoot, git);
  if (baselineDirtyPaths.length > 0 || spikeDirtyPaths.length > 0) {
    throw new Error(
      `candidate worktrees must be clean: baseline=${JSON.stringify(
        baselineDirtyPaths,
      )} spike=${JSON.stringify(spikeDirtyPaths)}`,
    );
  }
  if (git(spikeRoot, ['rev-parse', 'HEAD^']) !== baselineCommit) {
    throw new Error('spike HEAD must be one direct commit atop baseline HEAD');
  }
  if (git(spikeRoot, ['merge-base', baselineCommit, spikeCommit]) !== baselineCommit) {
    throw new Error('baseline must be the exact merge base of the spike');
  }
  if (git(spikeRoot, ['rev-list', '--count', `${baselineCommit}..${spikeCommit}`]) !== '1') {
    throw new Error('spike range must contain exactly one commit');
  }
  const changed = changedPaths(spikeRoot, baselineCommit, spikeCommit, git);
  const allowedProduction = new Set([
    'packages/server/src/client-modules.ts',
    'packages/server/src/client-modules.test.ts',
    'packages/server/src/loader-runtime-client-module.ts',
    'packages/compiler/src/security/framework-public-runtime-export-posture.generated.ts',
    'security/framework-public-runtime-export-posture.json',
    'scripts/pack-security.files.json',
  ]);
  const unexpected = changed.filter((file) => !allowedProduction.has(file));
  const required = [
    'packages/server/src/client-modules.ts',
    'packages/server/src/client-modules.test.ts',
    'packages/server/src/loader-runtime-client-module.ts',
  ];
  if (unexpected.length > 0 || required.some((file) => !changed.includes(file))) {
    throw new Error(
      `candidate path census is outside the reviewed production slice: ${changed.join(', ')}`,
    );
  }
  const patchBytes = patch(spikeRoot, baselineCommit, spikeCommit);
  return {
    baseline: { commit: baselineCommit, root: baselineRoot },
    historical: authenticateHistoricalOrigin({ git, patch, patchId, requireCommitObjects: true }),
    patch: {
      bytes: patchBytes.byteLength,
      sha256: sha256(patchBytes),
      stablePatchId: patchId(spikeRoot, spikeCommit),
      paths: changed,
    },
    schema: LOADER_RUNTIME_MEMO_BINDING_SCHEMA,
    spike: { commit: spikeCommit, parent: baselineCommit, root: spikeRoot },
  };
}

export function authenticateHistoricalOrigin(dependencies = {}) {
  const git = dependencies.git ?? gitOutput;
  const patch = dependencies.patch ?? gitPatchBytes;
  const patchId = dependencies.patchId ?? gitPatchId;
  const root = dependencies.root ?? repoRoot;
  const originPath = path.join(root, HISTORICAL_LOADER_RUNTIME_MEMO.originManifest);
  const manifest = JSON.parse(readFileSync(originPath, 'utf8'));
  const commits = manifest?.historical?.commits;
  const artifacts = manifest?.scratchpad?.artifacts;
  const observed = { manifestSha256: sha256(readFileSync(originPath)) };
  if (
    manifest?.schema !== 'kovo-loader-runtime-memo-origin/v1' ||
    observed.manifestSha256 !== HISTORICAL_LOADER_RUNTIME_MEMO.originManifestSha256 ||
    !/^2026-08-13T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/u.test(manifest?.authenticatedAt ?? '') ||
    commits?.baseline !== HISTORICAL_LOADER_RUNTIME_MEMO.baseline ||
    commits?.productionCandidate !== HISTORICAL_LOADER_RUNTIME_MEMO.candidate ||
    commits?.postureRefresh !== HISTORICAL_LOADER_RUNTIME_MEMO.posture ||
    commits?.fixtureOnlyAdmission !== HISTORICAL_LOADER_RUNTIME_MEMO.fixtureOnly ||
    canonicalJson(manifest?.historical?.productionPatch?.serialization?.command) !==
      canonicalJson(HISTORICAL_PATCH_COMMAND) ||
    manifest?.historical?.productionPatch?.sha256 !== HISTORICAL_LOADER_RUNTIME_MEMO.patchSha256 ||
    manifest?.historical?.productionPatch?.stablePatchId !==
      HISTORICAL_LOADER_RUNTIME_MEMO.stablePatchId ||
    !Array.isArray(artifacts) ||
    artifacts.length !== 13 ||
    artifacts.some(
      (artifact) =>
        typeof artifact?.path !== 'string' ||
        !Number.isSafeInteger(artifact?.bytes) ||
        artifact.bytes <= 0 ||
        !isSha256(artifact?.sha256),
    )
  ) {
    throw new Error('historical loader-runtime memo manifest could not be authenticated');
  }
  let commitObjects = { status: 'unavailable-in-current-clone' };
  let historicalObjectsAvailable = true;
  for (const commit of [
    HISTORICAL_LOADER_RUNTIME_MEMO.baseline,
    HISTORICAL_LOADER_RUNTIME_MEMO.candidate,
    HISTORICAL_LOADER_RUNTIME_MEMO.posture,
    HISTORICAL_LOADER_RUNTIME_MEMO.fixtureOnly,
  ]) {
    try {
      git(root, ['cat-file', '-e', `${commit}^{commit}`]);
    } catch {
      historicalObjectsAvailable = false;
      break;
    }
  }
  if (historicalObjectsAvailable) {
    const candidate = git(root, [
      'rev-parse',
      `${HISTORICAL_LOADER_RUNTIME_MEMO.candidate}^{commit}`,
    ]);
    const parent = git(root, ['rev-parse', `${HISTORICAL_LOADER_RUNTIME_MEMO.candidate}^`]);
    const postureParent = git(root, ['rev-parse', `${HISTORICAL_LOADER_RUNTIME_MEMO.posture}^`]);
    const fixtureParent = git(root, [
      'rev-parse',
      `${HISTORICAL_LOADER_RUNTIME_MEMO.fixtureOnly}^`,
    ]);
    const bytes = patch(
      root,
      HISTORICAL_LOADER_RUNTIME_MEMO.baseline,
      HISTORICAL_LOADER_RUNTIME_MEMO.candidate,
    );
    const patchSha256 = sha256(bytes);
    const stablePatchId = patchId(root, candidate);
    if (
      candidate !== HISTORICAL_LOADER_RUNTIME_MEMO.candidate ||
      parent !== HISTORICAL_LOADER_RUNTIME_MEMO.baseline ||
      postureParent !== candidate ||
      fixtureParent !== HISTORICAL_LOADER_RUNTIME_MEMO.posture ||
      patchSha256 !== HISTORICAL_LOADER_RUNTIME_MEMO.patchSha256 ||
      stablePatchId !== HISTORICAL_LOADER_RUNTIME_MEMO.stablePatchId
    ) {
      throw new Error('historical loader-runtime memo commit chain differs from its manifest');
    }
    commitObjects = {
      parent,
      patchBytes: bytes.byteLength,
      patchSha256,
      stablePatchId,
      status: 'authenticated',
    };
  } else if (dependencies.requireCommitObjects === true) {
    throw new Error('historical loader-runtime memo commit objects are unavailable');
  }
  const scratchpad = authenticateHistoricalScratchpad(manifest, dependencies);
  return {
    ...HISTORICAL_LOADER_RUNTIME_MEMO,
    ...observed,
    commitObjects,
    scratchpad,
  };
}

export function authenticateHistoricalScratchpad(manifest, dependencies = {}) {
  const root = dependencies.scratchpadRoot ?? manifest?.scratchpad?.root;
  if (typeof root !== 'string' || !existsSync(root)) {
    return { root: root ?? null, status: 'unavailable-on-current-host' };
  }
  const artifacts = manifest?.scratchpad?.artifacts;
  if (!Array.isArray(artifacts))
    throw new TypeError('historical scratchpad artifact census is missing');
  const authenticated = [];
  for (const artifact of artifacts) {
    const absolute = path.resolve(root, artifact.path);
    if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) {
      throw new Error(`historical scratchpad path escapes its root: ${artifact.path}`);
    }
    const bytes = readFileSync(absolute);
    if (bytes.byteLength !== artifact.bytes || sha256(bytes) !== artifact.sha256) {
      throw new Error(`historical scratchpad artifact differs: ${artifact.path}`);
    }
    authenticated.push(artifact.path);
  }
  return { artifacts: authenticated, root: path.resolve(root), status: 'authenticated' };
}

export function analyzeLoaderRuntimeMemoSamples(
  rawSamples,
  { bootstrapIterations = DEFAULT_BOOTSTRAP_ITERATIONS, seed = 0x4c524d41 } = {},
) {
  const analysis = {};
  for (const key of [...new Set(rawSamples.map((cell) => cell.condition.key))].sort()) {
    const cells = rawSamples.filter((cell) => cell.condition.key === key);
    const pairs = pairedSamples(cells);
    const metrics = {};
    for (const metric of METRICS) {
      const baseline = pairs.map((pair) =>
        finiteNonNegative(pair.baseline[metric.name], metric.name),
      );
      const spike = pairs.map((pair) => finiteNonNegative(pair.spike[metric.name], metric.name));
      const improvements = baseline.map((value, index) =>
        metric.higherIsBetter ? spike[index] - value : value - spike[index],
      );
      const percents = baseline.map((value, index) => {
        if (value <= 0) throw new TypeError(`${key}/${metric.name} baseline must be positive`);
        return (improvements[index] / value) * 100;
      });
      metrics[metric.name] = {
        baseline: summarize(baseline),
        pairedImprovement: {
          bootstrap95Ci: bootstrapMedianCi(improvements, {
            iterations: bootstrapIterations,
            seed: seed++,
          }),
          direction: 'positive-favors-memoized-spike',
          median: summarize(improvements).median,
          percent: {
            bootstrap95Ci: bootstrapMedianCi(percents, {
              iterations: bootstrapIterations,
              seed: seed++,
            }),
            median: summarize(percents).median,
          },
          samples: pairs.length,
        },
        spike: summarize(spike),
      };
    }
    analysis[key] = {
      condition: cells[0].condition,
      metrics,
      pairedOccurrences: pairs.map((p) => p.occurrence),
    };
  }
  return analysis;
}

export function evaluateLoaderRuntimeMemoAcceptance(
  rawSamples,
  { bootstrapIterations = DEFAULT_BOOTSTRAP_ITERATIONS, seed = 0x4c524d41 } = {},
) {
  const expected = loaderRuntimeMemoConditions().map((condition) => condition.key);
  const observedKeys = [...new Set(rawSamples.map((cell) => cell.condition.key))].sort();
  const throughputImprovements = [];
  const p95RegressionByCondition = {};
  const rssRegressionByCondition = {};
  for (const key of expected) {
    const pairs = pairedSamples(rawSamples.filter((cell) => cell.condition.key === key));
    const p95Regressions = [];
    const rssRegressions = [];
    for (const pair of pairs) {
      const baselineThroughput = finitePositive(
        pair.baseline?.requestsPerSecond,
        `${key}/baseline requestsPerSecond`,
      );
      throughputImprovements.push(
        ((finiteNonNegative(pair.spike?.requestsPerSecond, `${key}/spike requestsPerSecond`) -
          baselineThroughput) /
          baselineThroughput) *
          100,
      );
      const baselineP95 = finitePositive(pair.baseline?.p95Ms, `${key}/baseline p95Ms`);
      p95Regressions.push(
        ((finiteNonNegative(pair.spike?.p95Ms, `${key}/spike p95Ms`) - baselineP95) / baselineP95) *
          100,
      );
      const baselineRss = finitePositive(
        pair.baseline?.peakRssBytes,
        `${key}/baseline peakRssBytes`,
      );
      rssRegressions.push(
        ((finiteNonNegative(pair.spike?.peakRssBytes, `${key}/spike peakRssBytes`) - baselineRss) /
          baselineRss) *
          100,
      );
    }
    if (pairs.length > 0) {
      p95RegressionByCondition[key] = summarize(p95Regressions).median;
      rssRegressionByCondition[key] = summarize(rssRegressions).median;
    }
  }
  const reasons = [];
  if (canonicalJson(observedKeys) !== canonicalJson([...expected].sort())) {
    reasons.push('forced-dynamic listing/detail c=1,8,32 condition census is incomplete');
  }
  if (throughputImprovements.length === 0) {
    reasons.push('paired forced-dynamic throughput samples are unavailable');
    return {
      accepted: false,
      criterion: null,
      observed: null,
      reasons,
      thresholds: loaderRuntimeMemoAcceptanceThresholds(),
    };
  }
  const throughputMedianPercent = summarize(throughputImprovements).median;
  const throughputBootstrap95Ci = bootstrapMedianCi(throughputImprovements, {
    iterations: bootstrapIterations,
    seed,
  });
  const maxP95RegressionPercent = Math.max(...Object.values(p95RegressionByCondition));
  const maxRssRegressionPercent = Math.max(...Object.values(rssRegressionByCondition));
  const confidencePositive = throughputBootstrap95Ci[0] > 0;
  const criterionA = throughputMedianPercent >= 10 && confidencePositive;
  const criterionB =
    throughputMedianPercent >= 5 &&
    confidencePositive &&
    maxP95RegressionPercent <= 5 &&
    maxRssRegressionPercent <= 5;
  if (throughputMedianPercent < 5) reasons.push('median throughput improvement is below 5%');
  if (!confidencePositive) reasons.push('paired bootstrap 95% CI does not exclude zero');
  if (!criterionA && maxP95RegressionPercent > 5) {
    reasons.push('a forced-dynamic cell regressed median p95 latency by more than 5%');
  }
  if (!criterionA && maxRssRegressionPercent > 5) {
    reasons.push('a forced-dynamic cell regressed median peak RSS by more than 5%');
  }
  return {
    accepted: reasons.length === 0 && (criterionA || criterionB),
    criterion: criterionA ? 'a' : criterionB ? 'b' : null,
    observed: {
      maxP95RegressionPercent,
      maxRssRegressionPercent,
      p95RegressionByCondition,
      rssRegressionByCondition,
      throughputBootstrap95Ci,
      throughputMedianPercent,
      throughputPairs: throughputImprovements.length,
    },
    reasons,
    thresholds: loaderRuntimeMemoAcceptanceThresholds(),
  };
}

function loaderRuntimeMemoAcceptanceThresholds() {
  return {
    criterionA: 'median throughput improvement >=10% and paired bootstrap 95% CI lower bound >0',
    criterionB:
      'median throughput improvement >=5%, paired bootstrap 95% CI lower bound >0, and every forced-dynamic cell median p95/RSS regression <=5%',
    correctness: 'zero status/content/representation/transport misses in every sample',
    matrix: 'forced-dynamic identity listing/detail at c=1,8,32',
  };
}

export function analyzeLoaderRuntimeMemoProfile(profile) {
  if (!profile || !Array.isArray(profile.nodes) || !Array.isArray(profile.samples)) {
    throw new TypeError('CPU profile is malformed');
  }
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parents.set(child, node.id);
  const matchingRootIds = new Set(
    profile.nodes
      .filter((node) => node.callFrame?.functionName === 'ensureKovoLoaderRuntimeClientModule')
      .map((node) => node.id),
  );
  const topRootIds = [...matchingRootIds].filter((id) => {
    let parent = parents.get(id);
    while (parent !== undefined) {
      if (matchingRootIds.has(parent)) return false;
      parent = parents.get(parent);
    }
    return true;
  });
  const idleNames = new Set(['(idle)', '(program)', '(garbage collector)', '(root)']);
  let busyHits = 0;
  let totalHits = 0;
  for (const node of profile.nodes) {
    const hits = finiteNonNegative(node.hitCount ?? 0, 'CPU profile node hitCount');
    totalHits += hits;
    if (!idleNames.has(node.callFrame?.functionName)) busyHits += hits;
  }
  const seen = new Set();
  let subtreeHits = 0;
  for (const rootId of topRootIds) {
    const pending = [rootId];
    while (pending.length > 0) {
      const id = pending.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const node = nodes.get(id);
      if (!node) continue;
      subtreeHits += finiteNonNegative(node.hitCount ?? 0, 'CPU profile node hitCount');
      pending.push(...(node.children ?? []));
    }
  }
  return {
    busyHits,
    loaderRuntimeSelection: {
      busyPercent: busyHits === 0 ? null : (subtreeHits / busyHits) * 100,
      matchingRoots: matchingRootIds.size,
      subtreeHits,
      topMatchingRoots: topRootIds.length,
    },
    sampledNodeIds: profile.samples.length,
    totalHits,
  };
}

export async function runLoaderRuntimeMemoAb(options = {}, dependencies = {}) {
  const policy = normalizeOptions(options);
  try {
    return await runNormalizedLoaderRuntimeMemoAb(policy, dependencies);
  } finally {
    rmSync(policy.scratchRoot, { force: true, recursive: true });
  }
}

async function runNormalizedLoaderRuntimeMemoAb(policy, dependencies) {
  const authenticate = dependencies.authenticateRoots ?? authenticateLoaderRuntimeMemoRoots;
  const binding = authenticate({ baselineRoot: policy.baselineRoot, spikeRoot: policy.spikeRoot });
  const collect = dependencies.collectState ?? collectWorktreeState;
  const identifyWorkload = dependencies.identifyWorkload ?? workloadIdentity;
  const install = dependencies.installWorktree ?? installWorktree;
  const run = dependencies.runAdapter ?? runAdapter;
  const before = { baseline: collect(binding.baseline.root), spike: collect(binding.spike.root) };
  const errors = validateSourcePair(before, binding);
  const workload = identifyWorkload(binding, before);
  const installation = {};
  const preparation = {};
  for (const lane of ['baseline', 'spike']) {
    if (errors.length > 0) break;
    try {
      installation[lane] = await install(binding[lane].root);
    } catch (error) {
      errors.push(`${lane} frozen dependency installation: ${errorMessage(error)}`);
      break;
    }
  }
  const installedAfter = {
    baseline: collect(binding.baseline.root),
    spike: collect(binding.spike.root),
  };
  errors.push(...sourceStabilityFindings(before, installedAfter));
  for (const lane of ['baseline', 'spike']) {
    if (errors.length > 0) break;
    const result = await run({
      args: ['--framework', 'kovo', '--prepare-only', '--port', String(policy.port)],
      outPath: path.join(policy.scratchRoot, `prepare-${lane}.json`),
      root: binding[lane].root,
      script: 'scripts/perf-server-benchmark.mjs',
    });
    preparation[lane] = result.report;
    errors.push(...validatePreparation(result, before[lane], lane));
  }
  const preparedAfter = {
    baseline: collect(binding.baseline.root),
    spike: collect(binding.spike.root),
  };
  errors.push(...sourceStabilityFindings(before, preparedAfter));
  const preparationReport = buildPrepareReport({
    binding,
    errors,
    installation,
    policy,
    preparation,
    source: before,
    workload,
  });
  if (policy.prepareOnly) return preparationReport;
  if (errors.length > 0)
    return buildMeasurementReport({
      binding,
      errors,
      installation,
      policy,
      preparation,
      profiles: {},
      rawSamples: [],
      source: before,
      workload,
    });

  const lock = acquireTimingLock(policy.timingLockPath);
  const rawSamples = [];
  const profiles = {};
  const hostSamples = [];
  try {
    const schedule = loaderRuntimeMemoSchedule(policy.samples);
    for (const condition of loaderRuntimeMemoConditions(policy)) {
      for (const scheduled of schedule) {
        const context = `${condition.key}/${scheduled.lane}/${String(scheduled.occurrence)}`;
        if (!(await settleQuietHost(context, policy, hostSamples, dependencies))) {
          errors.push(`${context}: quiet-host admission failed`);
          break;
        }
        const lane = scheduled.lane;
        const result = await run({
          args: [
            '--framework',
            'kovo',
            '--mode',
            'dynamic',
            '--route',
            condition.route,
            '--encoding',
            'identity',
            '--concurrency',
            String(condition.concurrency),
            '--warmup-ms',
            String(policy.warmupMs),
            '--duration-ms',
            String(policy.durationMs),
            '--port',
            String(policy.port),
            '--skip-build',
          ],
          outPath: path.join(
            policy.scratchRoot,
            `sample-${condition.key}-${lane}-${String(scheduled.occurrence)}.json`,
          ),
          root: binding[lane].root,
          script: 'scripts/perf-server-benchmark.mjs',
        });
        rawSamples.push({
          condition,
          lane,
          occurrence: scheduled.occurrence,
          report: result.report,
          sample: result.report?.samples?.[0] ?? null,
        });
        errors.push(...validateSample(result, before[lane], condition, lane));
        hostSamples.push(hostObservation(`after/${context}`));
        if (errors.length > 0) break;
      }
      if (errors.length > 0) break;
    }
    if (errors.length === 0) {
      mkdirSync(policy.profileDir, { recursive: true });
      for (const route of policy.routes) {
        for (const lane of ['baseline', 'spike']) {
          if (
            !(await settleQuietHost(`profile/${route}/${lane}`, policy, hostSamples, dependencies))
          ) {
            errors.push(`profile/${route}/${lane}: quiet-host admission failed`);
            break;
          }
          const rawPath = path.join(policy.profileDir, `${lane}-${route}-c32.cpuprofile`);
          const reportPath = path.join(policy.profileDir, `${lane}-${route}-c32.json`);
          const result = await run({
            args: [
              '--route',
              route,
              '--warmup-ms',
              String(policy.warmupMs),
              '--duration-ms',
              String(policy.durationMs),
              '--port',
              String(policy.profilePort),
              '--profile-out',
              rawPath,
            ],
            outPath: reportPath,
            root: binding[lane].root,
            script: 'scripts/perf-server-profile.mjs',
          });
          const profileBytes = existsSync(rawPath) ? readFileSync(rawPath) : null;
          profiles[`${route}/${lane}`] = {
            analysis:
              profileBytes === null
                ? null
                : analyzeLoaderRuntimeMemoProfile(JSON.parse(profileBytes)),
            artifact:
              profileBytes === null
                ? null
                : {
                    bytes: profileBytes.byteLength,
                    path: path.relative(policy.outputRoot, rawPath).split(path.sep).join('/'),
                    sha256: sha256(profileBytes),
                  },
            report: result.report,
          };
          errors.push(...validateProfile(result, before[lane], route, lane, profileBytes));
        }
      }
    }
  } finally {
    lock.release();
  }
  const after = { baseline: collect(binding.baseline.root), spike: collect(binding.spike.root) };
  errors.push(...sourceStabilityFindings(before, after));
  errors.push(...matrixIntegrityFindings(rawSamples, policy));
  return buildMeasurementReport({
    binding,
    errors,
    hostSamples,
    installation,
    policy,
    preparation,
    profiles,
    rawSamples,
    source: before,
    sourceAfter: after,
    workload,
  });
}

function buildPrepareReport({
  binding,
  errors,
  installation,
  policy,
  preparation,
  source,
  workload,
}) {
  const complete = errors.length === 0;
  return {
    candidate: binding,
    environment: { host: performanceHostFingerprint() },
    execution: performanceExecutionIdentity(),
    installation,
    integrity: { complete, errors: [...new Set(errors)], sourceStable: complete },
    mode: 'prepare-only',
    policy: reportPolicy(policy),
    preparation,
    schema: LOADER_RUNTIME_MEMO_PREPARE_SCHEMA,
    source,
    verdict: { reasons: [...new Set(errors)], status: complete ? 'prepared' : 'unproven' },
    workload,
  };
}

function buildMeasurementReport({
  binding,
  errors,
  hostSamples = [],
  installation,
  policy,
  preparation,
  profiles,
  rawSamples,
  source,
  sourceAfter = null,
  workload,
}) {
  const uniqueErrors = [...new Set(errors)];
  let analysis = null;
  let acceptance = null;
  if (uniqueErrors.length === 0) {
    try {
      analysis = analyzeLoaderRuntimeMemoSamples(rawSamples, {
        bootstrapIterations: policy.bootstrapIterations,
        seed: policy.seed,
      });
      acceptance = evaluateLoaderRuntimeMemoAcceptance(rawSamples, {
        bootstrapIterations: policy.bootstrapIterations,
        seed: policy.seed,
      });
    } catch (error) {
      uniqueErrors.push(`analysis: ${errorMessage(error)}`);
    }
  }
  const fullPolicy = isFullPolicy(policy);
  const complete = uniqueErrors.length === 0 && analysis !== null && acceptance !== null;
  const publishable = complete && fullPolicy;
  const status = !complete
    ? 'unproven'
    : !fullPolicy
      ? 'smoke'
      : acceptance.accepted
        ? 'accept'
        : 'reject';
  const report = {
    acceptance: { eligible: publishable, evaluation: acceptance },
    analysis,
    candidate: binding,
    environment: { host: performanceHostFingerprint(), hostSamples },
    execution: performanceExecutionIdentity(),
    installation,
    integrity: {
      complete,
      errors: uniqueErrors,
      expectedSamples:
        loaderRuntimeMemoConditions(policy).length *
        loaderRuntimeMemoSchedule(policy.samples).length,
      observedSamples: rawSamples.length,
      serialized: true,
      sourceStable:
        sourceAfter === null ? false : sourceStabilityFindings(source, sourceAfter).length === 0,
    },
    policy: reportPolicy(policy),
    preparation,
    profiles,
    rawSamples,
    schema: LOADER_RUNTIME_MEMO_AB_SCHEMA,
    source,
    sourceAfter,
    verdict: {
      reasons: [
        ...uniqueErrors,
        ...(!fullPolicy ? ['non-default policy is smoke-only'] : []),
        ...(acceptance?.reasons ?? []),
      ],
      status,
    },
    workload,
  };
  report.evidenceDigest = sha256(Buffer.from(canonicalJson(report)));
  return report;
}

export function loaderRuntimeMemoConditions(policy = {}) {
  const routes = policy.routes ?? LOADER_RUNTIME_MEMO_ROUTES;
  const concurrencies = policy.concurrencies ?? LOADER_RUNTIME_MEMO_CONCURRENCIES;
  return routes.flatMap((route) =>
    concurrencies.map((concurrency) => ({
      concurrency,
      encoding: 'identity',
      key: `dynamic-${route}-identity-c${String(concurrency)}`,
      mode: 'dynamic',
      path:
        route === 'listing'
          ? '/matched/runtime/dynamic'
          : '/matched/runtime/dynamic/product/linen-field-jacket',
      route,
    })),
  );
}

function pairedSamples(cells) {
  const baseline = new Map(
    cells.filter((cell) => cell.lane === 'baseline').map((cell) => [cell.occurrence, cell.sample]),
  );
  const spike = new Map(
    cells.filter((cell) => cell.lane === 'spike').map((cell) => [cell.occurrence, cell.sample]),
  );
  return [...baseline.keys()]
    .filter((occurrence) => spike.has(occurrence))
    .sort((a, b) => a - b)
    .map((occurrence) => ({
      baseline: baseline.get(occurrence),
      occurrence,
      spike: spike.get(occurrence),
    }));
}

function validatePreparation(result, expected, lane) {
  const report = result.report;
  const findings = [];
  if (result.error) findings.push(`${lane} prepare process: ${result.error}`);
  if (report?.schema !== PREPARE_SCHEMA || report?.framework !== 'kovo')
    findings.push(`${lane} prepare schema/framework mismatch`);
  if (report?.integrity?.complete !== true || report?.verdict?.status !== 'measured')
    findings.push(`${lane} prepare is incomplete`);
  if (!sameSource(report?.source, expected) || !sameSource(report?.sourceAfter, expected))
    findings.push(`${lane} prepare source mismatch`);
  return findings;
}

function validateSample(result, expected, condition, lane) {
  const report = result.report;
  const sample = report?.samples?.[0];
  const findings = [];
  if (result.error) findings.push(`${condition.key}/${lane} process: ${result.error}`);
  if (report?.schema !== ADAPTER_SCHEMA || report?.framework !== 'kovo')
    findings.push(`${condition.key}/${lane} schema/framework mismatch`);
  if (canonicalJson(report?.condition) !== canonicalJson(condition))
    findings.push(`${condition.key}/${lane} condition mismatch`);
  if (
    report?.integrity?.complete !== true ||
    report?.verdict?.status !== 'measured' ||
    report?.integrity?.misses !== 0 ||
    (report?.integrity?.errors?.length ?? 0) > 0
  )
    findings.push(`${condition.key}/${lane} correctness failure`);
  if (!sameSource(report?.source, expected) || !sameSource(report?.sourceAfter, expected))
    findings.push(`${condition.key}/${lane} source mismatch`);
  if (
    !sample ||
    !(sample.requests > 0) ||
    sample.failedRequests !== 0 ||
    sample.misses !== 0 ||
    sample.statusCounts?.['200'] !== sample.requests
  )
    findings.push(`${condition.key}/${lane} status/content miss`);
  if (
    !(sample?.serverCpuMs > 0) ||
    !(sample?.serverCpuPercent > 0) ||
    !(sample?.peakRssBytes > 0) ||
    !(sample?.processTreeSamples > 0)
  ) {
    findings.push(`${condition.key}/${lane} process-tree CPU/RSS evidence is missing`);
  }
  if (
    report?.correctness?.contentEncoding !== null ||
    !isSha256(report?.correctness?.bodySha256) ||
    report?.correctness?.status !== 200
  )
    findings.push(`${condition.key}/${lane} representation mismatch`);
  return findings;
}

function validateProfile(result, expected, route, lane, bytes) {
  const report = result.report;
  const findings = [];
  if (result.error) findings.push(`profile/${route}/${lane} process: ${result.error}`);
  if (
    report?.schema !== PROFILE_SCHEMA ||
    report?.verdict?.status !== 'diagnostic' ||
    report?.integrity?.complete !== true
  )
    findings.push(`profile/${route}/${lane} is incomplete`);
  if (!sameSource(report?.source, expected) || !sameSource(report?.sourceAfter, expected))
    findings.push(`profile/${route}/${lane} source mismatch`);
  if (
    report?.benchmarkEvidence?.condition?.route !== route ||
    report?.benchmarkEvidence?.condition?.concurrency !== 32 ||
    report?.benchmarkEvidence?.condition?.mode !== 'dynamic'
  )
    findings.push(`profile/${route}/${lane} condition mismatch`);
  if (bytes === null || bytes.byteLength === 0 || report?.profileArtifact?.sha256 !== sha256(bytes))
    findings.push(`profile/${route}/${lane} artifact mismatch`);
  return findings;
}

function matrixIntegrityFindings(rawSamples, policy) {
  const findings = [];
  const schedule = loaderRuntimeMemoSchedule(policy.samples);
  for (const condition of loaderRuntimeMemoConditions(policy)) {
    const cells = rawSamples.filter((cell) => cell.condition.key === condition.key);
    if (
      cells.length !== schedule.length ||
      cells.some(
        (cell, index) =>
          cell.lane !== schedule[index].lane || cell.occurrence !== schedule[index].occurrence,
      )
    ) {
      findings.push(`${condition.key}: serialized B,S,S,B sample census is incomplete`);
      continue;
    }
    const bodies = new Set(cells.map((cell) => cell.report?.correctness?.bodySha256));
    const bytes = new Set(cells.map((cell) => cell.report?.correctness?.bodyBytes));
    const types = new Set(cells.map((cell) => cell.report?.correctness?.contentType));
    if (bodies.size !== 1 || bytes.size !== 1 || types.size !== 1 || !isSha256([...bodies][0])) {
      findings.push(`${condition.key}: baseline/spike rendered documents are not byte-identical`);
    }
  }
  return findings;
}

function collectWorktreeState(root) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const dirtyPaths = gitDirtyPaths(root, gitOutput);
  const pnpmVersion = String(runChecked('pnpm', ['--version'], root)).trim();
  return {
    commit: gitOutput(root, ['rev-parse', 'HEAD']),
    dirty: dirtyPaths.length > 0,
    dirtyPaths,
    locks: Object.fromEntries(
      LOCK_FILES.map((file) => [file, sha256(readFileSync(path.join(root, file)))]),
    ),
    packageManager: manifest.packageManager,
    pnpmVersion,
  };
}

async function installWorktree(root) {
  runChecked('pnpm', ['install', '--offline', '--frozen-lockfile', '--ignore-scripts'], root);
  return {
    command: ['pnpm', 'install', '--offline', '--frozen-lockfile', '--ignore-scripts'],
    network: 'offline',
    status: 'installed',
  };
}

function validateSourcePair(source, binding) {
  const findings = [];
  for (const lane of ['baseline', 'spike']) {
    if (source[lane].dirty || source[lane].commit !== binding[lane].commit)
      findings.push(`${lane} source is dirty or at the wrong commit`);
    if (source[lane].packageManager !== `pnpm@${source[lane].pnpmVersion}`)
      findings.push(`${lane} package manager differs from package.json`);
  }
  if (canonicalJson(source.baseline.locks) !== canonicalJson(source.spike.locks))
    findings.push('baseline/spike frozen lock digests differ');
  if (source.baseline.packageManager !== source.spike.packageManager)
    findings.push('baseline/spike package manager identities differ');
  return findings;
}

function sourceStabilityFindings(before, after) {
  const findings = [];
  for (const lane of ['baseline', 'spike']) {
    if (canonicalJson(before[lane]) !== canonicalJson(after[lane])) {
      findings.push(`${lane} source changed during the comparison`);
    }
  }
  return findings;
}

function workloadIdentity(binding, source) {
  const arms = {};
  for (const lane of ['baseline', 'spike']) {
    const root = binding[lane].root;
    arms[lane] = Object.fromEntries(
      TOOLING_FILES.map((file) => [file, sha256(readFileSync(path.join(root, file)))]),
    );
  }
  if (canonicalJson(arms.baseline) !== canonicalJson(arms.spike))
    throw new Error('baseline/spike benchmark tooling differs');
  const facts = {
    adapterSchema: ADAPTER_SCHEMA,
    concurrencies: [...LOADER_RUNTIME_MEMO_CONCURRENCIES],
    encoding: 'identity',
    locks: source.baseline.locks,
    mode: 'dynamic',
    routes: [...LOADER_RUNTIME_MEMO_ROUTES],
    schema: 'kovo-loader-runtime-memo-workload/v1',
    tooling: arms.baseline,
  };
  return { ...facts, digest: sha256(Buffer.from(canonicalJson(facts))) };
}

function normalizeOptions(options) {
  if (options.measure === options.prepareOnly)
    throw new TypeError('exactly one of --measure or --prepare-only is required');
  const quick = options.quickSmoke === true;
  const output = path.resolve(requiredString(options.out, '--out'));
  const outputRoot = path.dirname(output);
  const profileDir = path.resolve(options.profileDir ?? path.join(outputRoot, 'profiles'));
  const relativeProfileDir = path.relative(outputRoot, profileDir);
  if (
    relativeProfileDir === '..' ||
    relativeProfileDir.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeProfileDir)
  ) {
    throw new TypeError('--profile-dir must be contained by the report artifact directory');
  }
  const scratchRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-loader-runtime-memo-ab-'));
  return {
    baselineRoot: canonicalDirectory(requiredString(options.baselineRoot, '--baseline-root')),
    bootstrapIterations: boundedInteger(
      options.bootstrapIterations ?? (quick ? 500 : DEFAULT_BOOTSTRAP_ITERATIONS),
      100,
      1_000_000,
      '--bootstrap-iterations',
    ),
    concurrencies: validatedChoiceList(
      options.concurrencies ?? LOADER_RUNTIME_MEMO_CONCURRENCIES,
      LOADER_RUNTIME_MEMO_CONCURRENCIES,
      '--concurrencies',
    ),
    durationMs: boundedInteger(
      options.durationMs ?? (quick ? 50 : DEFAULT_DURATION_MS),
      25,
      60_000,
      '--duration-ms',
    ),
    hostSettleMaxMs: boundedInteger(
      options.hostSettleMaxMs ?? DEFAULT_HOST_SETTLE_MAX_MS,
      0,
      300_000,
      '--host-settle-max-ms',
    ),
    hostSettlePollMs: boundedInteger(
      options.hostSettlePollMs ?? DEFAULT_HOST_SETTLE_POLL_MS,
      10,
      60_000,
      '--host-settle-poll-ms',
    ),
    maxLoadPerCpu: finitePositive(
      options.maxLoadPerCpu ?? DEFAULT_MAX_LOAD_PER_CPU,
      '--max-load-per-cpu',
    ),
    measure: options.measure === true,
    out: output,
    outputRoot,
    port: boundedInteger(options.port ?? 50_340, 1024, 65_534, '--port'),
    prepareOnly: options.prepareOnly === true,
    profileDir,
    profilePort: boundedInteger(options.profilePort ?? 50_341, 1024, 65_535, '--profile-port'),
    quickSmoke: quick,
    routes: validatedChoiceList(
      options.routes ?? LOADER_RUNTIME_MEMO_ROUTES,
      LOADER_RUNTIME_MEMO_ROUTES,
      '--routes',
    ),
    samples: boundedInteger(options.samples ?? (quick ? 2 : DEFAULT_SAMPLES), 1, 100, '--samples'),
    scratchRoot,
    seed: boundedInteger(options.seed ?? 0x4c524d41, 0, 0xffff_ffff, '--seed'),
    spikeRoot: canonicalDirectory(requiredString(options.spikeRoot, '--spike-root')),
    timingLockPath: path.resolve(
      options.timingLockPath ?? path.join(os.tmpdir(), 'kovo-performance-timing.lock'),
    ),
    warmupMs: boundedInteger(
      options.warmupMs ?? (quick ? 50 : DEFAULT_WARMUP_MS),
      25,
      60_000,
      '--warmup-ms',
    ),
  };
}

function reportPolicy(policy) {
  return {
    bootstrapIterations: policy.bootstrapIterations,
    concurrencies: policy.concurrencies,
    durationMs: policy.durationMs,
    encoding: 'identity',
    hostSettleMaxMs: policy.hostSettleMaxMs,
    hostSettlePollMs: policy.hostSettlePollMs,
    maxLoadPerCpu: policy.maxLoadPerCpu,
    mode: 'dynamic',
    order: [...LOADER_RUNTIME_MEMO_ORDER],
    profiles: { concurrency: 32, routes: policy.routes, timingClaims: false },
    routes: policy.routes,
    samplesPerArm: policy.samples,
    timingAuthorization: policy.measure ? 'explicit-measure' : 'prepare-only',
    warmupMs: policy.warmupMs,
  };
}

function isFullPolicy(policy) {
  return (
    policy.bootstrapIterations === DEFAULT_BOOTSTRAP_ITERATIONS &&
    canonicalJson(policy.concurrencies) === canonicalJson(LOADER_RUNTIME_MEMO_CONCURRENCIES) &&
    policy.durationMs === DEFAULT_DURATION_MS &&
    policy.hostSettleMaxMs === DEFAULT_HOST_SETTLE_MAX_MS &&
    policy.hostSettlePollMs === DEFAULT_HOST_SETTLE_POLL_MS &&
    policy.maxLoadPerCpu === DEFAULT_MAX_LOAD_PER_CPU &&
    policy.quickSmoke === false &&
    canonicalJson(policy.routes) === canonicalJson(LOADER_RUNTIME_MEMO_ROUTES) &&
    policy.samples === DEFAULT_SAMPLES &&
    policy.seed === 0x4c524d41 &&
    policy.warmupMs === DEFAULT_WARMUP_MS
  );
}

async function settleQuietHost(context, policy, samples, dependencies) {
  const observe = dependencies.hostObservation ?? hostObservation;
  const wait = dependencies.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = dependencies.now ?? Date.now;
  const started = now();
  while (true) {
    const sample = observe(`before/${context}`);
    const waitedMs = Math.max(0, now() - started);
    samples.push({ ...sample, waitedMs });
    if (sample.loadPerCpu <= policy.maxLoadPerCpu) return true;
    if (waitedMs >= policy.hostSettleMaxMs) return false;
    await wait(Math.min(policy.hostSettlePollMs, policy.hostSettleMaxMs - waitedMs));
  }
}

function hostObservation(label) {
  const cpuCount = os.cpus().length;
  const loadAverage = os.loadavg();
  return {
    at: new Date().toISOString(),
    cpuCount,
    label,
    loadAverage,
    loadPerCpu: loadAverage[0] / cpuCount,
  };
}

async function runAdapter({ args, outPath, root, script }) {
  mkdirSync(path.dirname(outPath), { recursive: true });
  const result = await spawnCaptured(
    process.execPath,
    [path.join(root, script), ...args, '--out', outPath],
    { cwd: root, env: cleanEnvironment(process.env) },
  );
  let report = null;
  if (existsSync(outPath)) {
    const bytes = readFileSync(outPath);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_REPORT_BYTES)
      return { error: 'adapter report is empty or over its bound', report: null };
    try {
      report = JSON.parse(bytes);
    } catch (error) {
      return { error: `adapter report is invalid JSON: ${errorMessage(error)}`, report: null };
    }
  }
  const error =
    result.code === 0 && result.signal === null
      ? null
      : (result.error ?? result.stderr.trim() ?? `exit ${String(result.code)}`);
  return { error, report };
}

function spawnCaptured(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      ...options,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let error = null;
    const append = (current, chunk) => `${current}${String(chunk)}`.slice(-MAX_CAPTURE_BYTES);
    child.stdout.on('data', (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.once('error', (caught) => {
      error = errorMessage(caught);
    });
    const stop = () => {
      try {
        if (process.platform === 'win32') child.kill('SIGTERM');
        else process.kill(-child.pid, 'SIGTERM');
      } catch {}
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    child.once('close', (code, signal) => {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      resolve({ code, error, signal, stderr, stdout });
    });
  });
}

function acquireTimingLock(file) {
  mkdirSync(path.dirname(file), { recursive: true });
  let descriptor;
  try {
    descriptor = openSync(file, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`another performance timing lane owns ${file}`);
    throw error;
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
      unlinkSync(file);
    },
  };
}

function cleanEnvironment(base) {
  const env = {
    ...base,
    CI: '1',
    FORCE_COLOR: '0',
    LANG: 'C',
    LC_ALL: 'C',
    NO_COLOR: '1',
    TZ: 'UTC',
  };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  return env;
}

function canonicalGitRoot(value, git) {
  const root = canonicalDirectory(requiredString(value, 'worktree root'));
  if (canonicalDirectory(git(root, ['rev-parse', '--show-toplevel'])) !== root)
    throw new TypeError(`${root} is not an exact Git worktree root`);
  return root;
}

function canonicalDirectory(value) {
  const absolute = path.resolve(value);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new TypeError(`${value} must be a non-symlink directory`);
  return realpathSync(absolute);
}

function gitOutput(root, args) {
  return String(runChecked('git', ['-C', root, ...args], root)).trim();
}

function runChecked(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: cleanEnvironment(process.env),
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitDirtyPaths(root, git) {
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  return status === '' ? [] : status.split(/\r?\n/u);
}

function gitPatchBytes(root, from, to) {
  return Buffer.from(
    execFileSync(
      'git',
      ['-C', root, 'diff', '--binary', '--full-index', '--no-ext-diff', from, to],
      { encoding: null, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    ),
  );
}

function gitPatchId(root, commit) {
  const patch = execFileSync(
    'git',
    ['-C', root, 'show', '--pretty=format:', '--binary', '--no-ext-diff', commit],
    { encoding: null, maxBuffer: 16 * 1024 * 1024 },
  );
  const result = execFileSync('git', ['patch-id', '--stable'], { encoding: 'utf8', input: patch });
  const match = /^([0-9a-f]{40})\s+[0-9a-f]{40}$/u.exec(result.trim());
  if (!match) throw new Error('git patch-id returned malformed evidence');
  return match[1];
}

function changedPaths(root, from, to, git) {
  const output = git(root, ['diff', '--name-status', '--no-renames', from, to]);
  return output === ''
    ? []
    : output.split(/\r?\n/u).map((line) => {
        const [status, file, extra] = line.split('\t');
        if (!['A', 'M'].includes(status) || !file || extra !== undefined)
          throw new Error(`candidate path change is not an add/modify: ${line}`);
        return file;
      });
}

function sameSource(left, right) {
  return (
    left?.commit === right?.commit &&
    left?.dirty === right?.dirty &&
    canonicalJson(left?.dirtyPaths) === canonicalJson(right?.dirtyPaths) &&
    canonicalJson(left?.locks) === canonicalJson(right?.locks)
  );
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
function isSha256(value) {
  return /^sha256:[0-9a-f]{64}$/u.test(String(value ?? ''));
}
function requiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is required`);
  return value;
}
function boundedInteger(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new TypeError(`${label} must be an integer from ${String(min)} through ${String(max)}`);
  return value;
}
function finitePositive(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw new TypeError(`${label} must be finite and positive`);
  return value;
}
function finiteNonNegative(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new TypeError(`${label} must be finite and non-negative`);
  return value;
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function validatedChoiceList(values, allowed, label) {
  if (!Array.isArray(values) || values.length === 0 || new Set(values).size !== values.length) {
    throw new TypeError(`${label} must be a non-empty list without duplicates`);
  }
  for (const value of values) {
    if (!allowed.includes(value)) {
      throw new TypeError(`${label} contains unsupported value ${String(value)}`);
    }
  }
  return [...values];
}

export function parseLoaderRuntimeMemoArgs(argv) {
  const options = {};
  const seen = new Set();
  const booleanFlags = new Set(['--measure', '--prepare-only', '--quick-smoke']);
  const listFlags = new Set(['--concurrencies', '--routes']);
  const stringFlags = new Set([
    '--baseline-root',
    '--spike-root',
    '--out',
    '--profile-dir',
    '--timing-lock-path',
  ]);
  const numberFlags = new Set([
    '--bootstrap-iterations',
    '--duration-ms',
    '--host-settle-max-ms',
    '--host-settle-poll-ms',
    '--max-load-per-cpu',
    '--port',
    '--profile-port',
    '--samples',
    '--seed',
    '--warmup-ms',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') {
      if (argv.length !== 1) throw new TypeError('--help cannot be combined with other arguments');
      options.help = true;
    } else if (
      booleanFlags.has(argument) ||
      listFlags.has(argument) ||
      stringFlags.has(argument) ||
      numberFlags.has(argument)
    ) {
      if (seen.has(argument)) throw new TypeError(`${argument} may be provided only once`);
      seen.add(argument);
      const key = argument.slice(2).replace(/-([a-z])/gu, (_m, c) => c.toUpperCase());
      if (booleanFlags.has(argument)) {
        options[key] = true;
        continue;
      }
      const value = argv[++index];
      if (value === undefined) throw new TypeError(`${argument} requires a value`);
      if (argument === '--concurrencies') options.concurrencies = value.split(',').map(Number);
      else if (argument === '--routes') options.routes = value.split(',');
      else options[key] = stringFlags.has(argument) ? value : Number(value);
    } else {
      throw new TypeError(`unknown argument ${argument}`);
    }
  }
  return options;
}

function usage() {
  return [
    'Usage: node scripts/perf-loader-runtime-memo-ab.mjs --baseline-root <worktree> --spike-root <worktree> --out <report.json> --profile-dir <dir> (--prepare-only|--measure)',
    '',
    'Full defaults: B,S,S,B; 7 samples/arm; 5s warmup; 15s measured; forced-dynamic',
    'identity listing/detail at c=1,8,32; diagnostic before/after profiles at c=32.',
  ].join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseLoaderRuntimeMemoArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const report = await runLoaderRuntimeMemoAb(options);
  mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
  writeFileSync(path.resolve(options.out), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${report.schema} ${report.verdict.status} ${path.resolve(options.out)}\n`);
  return ['prepared', 'accept', 'reject', 'smoke'].includes(report.verdict.status) ? 0 : 2;
}

if (isMainEntry(import.meta.url)) await runGate(() => main());
