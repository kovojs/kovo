#!/usr/bin/env node
/**
 * Authenticated serialized A/B runner for the historical narrow fresh-generation candidate.
 *
 * The real browser-visible adapter owns edit observation and process-tree RSS. This runner owns
 * candidate identity, matched corpus/frozen-lock preparation, B,S,S,B serialization, quiet-host
 * admission, paired analysis, and the acceptance rule from plans/good-perf.md Phase 1. Bundle
 * bytes and module-count proxies are recorded nowhere in the acceptance path.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { performanceHostFingerprint } from './lib/perf-host.mjs';

export const DEV_GENERATION_SPIKE_SCHEMA = 'kovo-dev-generation-spike-comparison/v1';
export const DEV_GENERATION_SPIKE_PREPARE_SCHEMA = 'kovo-dev-generation-spike-prepare/v1';
export const HISTORICAL_GENERATION_CANDIDATE = Object.freeze({
  commit: '44da3f3449dcbac2cc29951604b89488c90faa6f',
  parent: 'f99e75db0ed556125fe3b5b1d78dcc11adf1fbc9',
  patchId: '720cc725f5ef5707db3097d6d70476ff89710a66',
  patchSha256: 'sha256:e468dfbf2d7d2e0dca95db51a4c9fbd607316896a508db56f97b9d3eb5c4e5d4',
  paths: Object.freeze([
    'packages/cli/src/commands/dev.ts',
    'packages/server/src/internal/vite-security-profile.ts',
    'packages/server/src/security-bootstrap.test.ts',
  ]),
});

const ADAPTER_SCHEMA = 'kovo-dev-loop-report/v1';
const CORPUS_SCHEMA = 'kovo-dev-corpus/v1';
const DEFAULT_BOOTSTRAP_ITERATIONS = 10_000;
const DEFAULT_EDIT_SAMPLES = 30;
const DEFAULT_READY_SAMPLES = 15;
const DEFAULT_READY_TIMEOUT_MS = 10 * 60 * 1_000;
const DEFAULT_WARMUPS = 3;
const EDIT_CLASSES = Object.freeze(['leaf', 'entry', 'data', 'syntaxError', 'recovery']);
const LOCK_FILES = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);
const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_REPORT_BYTES = 64 * 1024 * 1024;
const PRIMARY_METRICS = Object.freeze(EDIT_CLASSES.map((editClass) => `${editClass}Ms`));
const SCHEDULE_LANES = Object.freeze(['baseline', 'spike', 'spike', 'baseline']);
const SUPPORTED_SIZES = Object.freeze([24, 216]);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export function devGenerationSchedule({ editSamples, readySamples, warmups }) {
  const editCounts = splitAcrossOccurrences(boundedInteger(editSamples, 2, 100, 'edit samples'));
  const readyCounts = splitAcrossOccurrences(boundedInteger(readySamples, 2, 100, 'ready samples'));
  const warmupCounts = splitAcrossOccurrences(boundedInteger(warmups, 0, 10, 'warmups'));
  const occurrences = { baseline: 0, spike: 0 };
  return SCHEDULE_LANES.map((lane, scheduleIndex) => {
    const occurrence = occurrences[lane]++;
    return {
      editSamples: editCounts[occurrence],
      lane,
      occurrence,
      readySamples: readyCounts[occurrence],
      scheduleIndex,
      warmups: warmupCounts[occurrence],
    };
  });
}

export function summarizeDevMetric(values) {
  const numbers = values.filter(finitePositive);
  if (numbers.length === 0) return { mad: null, median: null, p95: null, samples: 0 };
  const median = percentile(numbers, 50);
  return {
    mad: percentile(
      numbers.map((value) => Math.abs(value - median)),
      50,
    ),
    median,
    p95: percentile(numbers, 95),
    samples: numbers.length,
  };
}

export function pairedBootstrapImprovementCi(
  baseline,
  spike,
  { iterations = DEFAULT_BOOTSTRAP_ITERATIONS, seed = 1 } = {},
) {
  if (!Array.isArray(baseline) || !Array.isArray(spike) || baseline.length !== spike.length) {
    throw new TypeError('paired bootstrap inputs must have identical sample counts');
  }
  if (baseline.length === 0) return [null, null];
  boundedInteger(iterations, 100, 1_000_000, 'bootstrap iterations');
  const differences = baseline.map((value, index) => {
    if (!finitePositive(value) || !finitePositive(spike[index])) {
      throw new TypeError('paired bootstrap values must be finite and positive');
    }
    return value - spike[index];
  });
  const random = seededRandom(seed);
  const medians = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const resample = Array.from(
      { length: differences.length },
      () => differences[Math.floor(random() * differences.length)],
    );
    medians.push(percentile(resample, 50));
  }
  return [percentile(medians, 2.5), percentile(medians, 97.5)];
}

export function authenticateGenerationCandidateRoots(options, dependencies = {}) {
  const git = dependencies.git ?? gitOutput;
  const patch = dependencies.patch ?? gitPatchBytes;
  const patchId = dependencies.patchId ?? gitPatchId;
  const candidate = options.candidate ?? HISTORICAL_GENERATION_CANDIDATE;
  const candidateRepository = canonicalDirectory(options.candidateRepository ?? repoRoot);
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

  const candidateCommit = git(candidateRepository, ['rev-parse', `${candidate.commit}^{commit}`]);
  const candidateParent = git(candidateRepository, ['rev-parse', `${candidate.commit}^`]);
  if (candidateCommit !== candidate.commit || candidateParent !== candidate.parent) {
    throw new Error('historical candidate object identity is unavailable or unexpected');
  }
  const expectedPatch = patch(candidateRepository, candidate.parent, candidate.commit);
  const observedPatch = patch(spikeRoot, baselineCommit, spikeCommit);
  const expectedPatchSha256 = sha256(expectedPatch);
  const observedPatchSha256 = sha256(observedPatch);
  const expectedPatchId = patchId(candidateRepository, candidate.commit);
  const observedPatchId = patchId(spikeRoot, spikeCommit);
  if (
    expectedPatchSha256 !== candidate.patchSha256 ||
    expectedPatchId !== candidate.patchId ||
    observedPatchSha256 !== candidate.patchSha256 ||
    observedPatchId !== candidate.patchId ||
    !observedPatch.equals(expectedPatch)
  ) {
    throw new Error(
      `spike patch does not exactly match ${candidate.commit}: expected ${candidate.patchSha256}/${candidate.patchId}, observed ${observedPatchSha256}/${observedPatchId}`,
    );
  }
  const expectedPaths = candidate.paths;
  const observedPaths = changedPaths(spikeRoot, baselineCommit, spikeCommit, git);
  if (!sameStrings(observedPaths, expectedPaths)) {
    throw new Error(
      `spike path census differs from historical candidate: ${observedPaths.join(', ')}`,
    );
  }
  return {
    baseline: { commit: baselineCommit, root: baselineRoot },
    candidate: {
      commit: candidate.commit,
      parent: candidate.parent,
      patchBytes: expectedPatch.byteLength,
      patchId: candidate.patchId,
      patchSha256: candidate.patchSha256,
      paths: [...candidate.paths],
    },
    schema: 'kovo-dev-generation-candidate-binding/v1',
    spike: { commit: spikeCommit, parent: baselineCommit, root: spikeRoot },
  };
}

export function inspectGeneratedDevCorpus(manifestPath, root) {
  const absolute = path.resolve(manifestPath);
  const expectedRoot = path.resolve(root);
  if (!isWithin(expectedRoot, absolute)) throw new TypeError('corpus manifest escapes worktree');
  const bytes = readFileSync(absolute);
  const manifest = JSON.parse(bytes.toString('utf8'));
  const expectedEdits = EDIT_CLASSES;
  if (
    manifest?.schema !== CORPUS_SCHEMA ||
    manifest.framework !== 'kovo' ||
    !SUPPORTED_SIZES.includes(manifest.modules) ||
    manifest.routes !== 4 ||
    manifest.workload?.componentImportFanout !== manifest.modules ||
    manifest.workload?.workloadModules !== manifest.modules ||
    manifest.workload?.routes !== manifest.routes ||
    manifest.workload?.buildOutputContract !== 'required-nonempty-and-cleanup-absent/v1' ||
    !sameStrings(manifest.workload?.editClasses ?? [], expectedEdits) ||
    manifest.workload?.stateSurface !== 'local-counter'
  ) {
    throw new TypeError('generated Kovo corpus has an unexpected workload contract');
  }
  const calculatedShape = createHash('sha256')
    .update(JSON.stringify(manifest.workload))
    .digest('hex');
  if (manifest.shapeDigest !== calculatedShape) {
    throw new TypeError('generated corpus shape digest does not authenticate its workload');
  }
  if (
    !Array.isArray(manifest.sourceFiles) ||
    !/^sha256:[0-9a-f]{64}$/u.test(manifest.sourceDigest ?? '') ||
    sha256(JSON.stringify(manifest.sourceFiles)) !== manifest.sourceDigest
  ) {
    throw new TypeError('generated corpus source digest does not authenticate its source census');
  }
  const argv = manifest.dev?.command?.argv;
  if (
    !Array.isArray(argv) ||
    !argv.includes('localhost') ||
    argv.includes('127.0.0.1') ||
    argv.filter((value) => value === '{port}').length !== 1
  ) {
    throw new TypeError('generated corpus dev command must bind literal localhost');
  }
  return {
    editClasses: [...manifest.workload.editClasses],
    manifestDigest: sha256(bytes),
    manifestPath: path.relative(expectedRoot, absolute).split(path.sep).join('/'),
    modules: manifest.modules,
    routes: manifest.routes,
    schema: manifest.schema,
    shapeDigest: `sha256:${manifest.shapeDigest}`,
    sourceDigest: manifest.sourceDigest,
    stateSurface: manifest.workload.stateSurface,
  };
}

export function validateDevGenerationCell(cell, expected) {
  const report = cell.report;
  const findings = [];
  const key = `${cell.lane}[${String(cell.occurrence)}]`;
  if (report?.schema !== ADAPTER_SCHEMA) findings.push(`${key} adapter schema mismatch`);
  if (report?.framework !== 'kovo') findings.push(`${key} framework mismatch`);
  if (report?.integrity?.complete !== true || report?.verdict?.status !== 'measured') {
    findings.push(`${key} adapter evidence is unproven`);
  }
  if (
    report?.integrity?.iterations !== cell.editSamples ||
    report?.integrity?.readyIterations !== cell.readySamples ||
    report?.integrity?.warmups !== cell.warmups
  ) {
    findings.push(`${key} sample policy mismatch`);
  }
  if (
    report?.source?.commit !== expected.commit ||
    report?.source?.dirty !== false ||
    report?.sourceAfter?.commit !== expected.commit ||
    report?.sourceAfter?.dirty !== false ||
    report?.integrity?.source?.stable !== true ||
    !sameJson(report?.source?.locks, expected.locks) ||
    !sameJson(report?.sourceAfter?.locks, expected.locks)
  ) {
    findings.push(`${key} source/lock stability failure`);
  }
  if (
    report?.corpus?.modules !== expected.corpus.modules ||
    report?.corpus?.routes !== expected.corpus.routes ||
    report?.corpus?.manifestDigest !== expected.corpus.manifestDigest ||
    `sha256:${report?.corpus?.shapeDigest ?? ''}` !== expected.corpus.shapeDigest ||
    report?.corpus?.sourceDigest !== expected.corpus.sourceDigest
  ) {
    findings.push(`${key} corpus identity mismatch`);
  }
  try {
    const origin = new URL(report?.integrity?.command?.origin);
    if (origin.hostname !== 'localhost' || Number(origin.port) !== cell.port) {
      findings.push(`${key} browser origin is not the scheduled localhost port`);
    }
  } catch {
    findings.push(`${key} browser origin is invalid`);
  }
  const commandArgv = report?.integrity?.command?.argv;
  if (
    !Array.isArray(commandArgv) ||
    !commandArgv.includes('localhost') ||
    commandArgv.includes('127.0.0.1') ||
    commandArgv.filter((value) => value === String(cell.port)).length !== 1
  ) {
    findings.push(`${key} command did not preserve localhost`);
  }
  if (
    report?.integrity?.errors?.length !== 0 ||
    report?.integrity?.misses !== 0 ||
    report?.integrity?.browser?.unexpectedErrorCount !== 0 ||
    report?.integrity?.browser?.requestFailedCount !== 0 ||
    !(report?.integrity?.browser?.responseCount > 0)
  ) {
    findings.push(`${key} adapter correctness failure`);
  }
  if (
    !Array.isArray(report?.readySamples) ||
    report.readySamples.length !== cell.readySamples ||
    report.readySamples.some(
      (sample, index) =>
        sample?.iteration !== index ||
        sample.success !== true ||
        !finitePositive(sample.durationMs) ||
        !finitePositive(sample.peakRssBytes) ||
        !(sample.rssSamples > 0),
    )
  ) {
    findings.push(`${key} fresh-ready evidence is incomplete`);
  }
  if (!Array.isArray(report?.samples) || report.samples.length !== cell.editSamples) {
    findings.push(`${key} edit sample count mismatch`);
  } else {
    for (const [index, sample] of report.samples.entries()) {
      if (sample?.iteration !== index)
        findings.push(`${key} edit sample ${String(index)} identity`);
      for (const editClass of EDIT_CLASSES) {
        if (!finitePositive(sample?.[`${editClass}Ms`])) {
          findings.push(`${key} edit sample ${String(index)} missing ${editClass} latency`);
        }
        if (sample?.[`${editClass}StateSurvived`] !== true) {
          findings.push(`${key} edit sample ${String(index)} lost state during ${editClass}`);
        }
      }
      if (!nonEmptyString(sample?.syntaxErrorDiagnosticSignal)) {
        findings.push(`${key} edit sample ${String(index)} lacks syntax diagnostic`);
      }
    }
  }
  if (
    !finitePositive(report?.editSession?.peakRssBytes) ||
    !(report?.editSession?.rssSamples > 0)
  ) {
    findings.push(`${key} edit-session RSS evidence is incomplete`);
  }
  for (const editClass of EDIT_CLASSES) {
    if (report?.integrity?.editCounts?.[editClass] !== cell.editSamples) {
      findings.push(`${key} ${editClass} count mismatch`);
    }
  }
  return findings;
}

export function aggregateDevGenerationCells(cells, policy) {
  const metrics = {};
  let seed = policy.seed;
  metrics.readyMs = analyzePairedMetric(cells, (report) => report.readySamples, 'durationMs', {
    bootstrapIterations: policy.bootstrapIterations,
    seed: seed++,
  });
  metrics.readyPeakRssBytes = analyzePairedMetric(
    cells,
    (report) => report.readySamples,
    'peakRssBytes',
    { bootstrapIterations: policy.bootstrapIterations, seed: seed++ },
  );
  for (const editClass of EDIT_CLASSES) {
    metrics[`${editClass}Ms`] = analyzePairedMetric(
      cells,
      (report) => report.samples,
      `${editClass}Ms`,
      { bootstrapIterations: policy.bootstrapIterations, seed: seed++ },
    );
    metrics[`${editClass}ServerGenerationMs`] = analyzePairedMetric(
      cells,
      (report) => report.samples,
      `${editClass}ServerGenerationMs`,
      { bootstrapIterations: policy.bootstrapIterations, seed: seed++, optional: true },
    );
  }
  metrics.editPeakRssBytes = analyzePairedMetric(
    cells,
    (report) => [report.editSession],
    'peakRssBytes',
    { bootstrapIterations: policy.bootstrapIterations, seed: seed++ },
  );

  const correctness = correctnessSummary(cells);
  const metricAcceptance = Object.fromEntries(
    PRIMARY_METRICS.map((name) => [name, metricAcceptanceResult(metrics[name])]),
  );
  const guardrailMetrics = ['readyMs', 'readyPeakRssBytes', 'editPeakRssBytes'];
  const guardrails = Object.fromEntries(
    guardrailMetrics.map((name) => [name, noMedianRegressionOver(metrics[name], 5)]),
  );
  const candidateAccepted =
    correctness.complete &&
    Object.values(metricAcceptance).every((value) => value.passed) &&
    Object.values(guardrails).every((value) => value.passed);
  return {
    acceptance: {
      candidateAccepted,
      correctnessRequired: true,
      excludedProxyEvidence: ['bundleBytes', 'emittedBytes', 'moduleCount'],
      guardrails,
      metricAcceptance,
      requiredBrowserVisibleMetrics: [...PRIMARY_METRICS],
      rule: 'each-required-metric>=10%-median-and-paired-ci-lower>0/v1',
    },
    correctness,
    metrics,
  };
}

export async function prepareDevGenerationSpike(options, dependencies = {}) {
  const candidateBinding = (dependencies.authenticateRoots ?? authenticateGenerationCandidateRoots)(
    {
      baselineRoot: options.baselineRoot,
      candidateRepository: options.candidateRepository ?? repoRoot,
      spikeRoot: options.spikeRoot,
    },
  );
  const collectState = dependencies.collectState ?? collectWorktreeState;
  const inspectCorpus = dependencies.inspectCorpus ?? verifyGeneratedDevCorpus;
  const run = dependencies.runCommand ?? runCheckedCommand;
  const roots = {
    baseline: candidateBinding.baseline.root,
    spike: candidateBinding.spike.root,
  };
  const before = {
    baseline: collectState(roots.baseline),
    spike: collectState(roots.spike),
  };
  validatePreparedSourcePair(before, candidateBinding);
  for (const lane of ['baseline', 'spike']) {
    const root = roots[lane];
    const packageManager = JSON.parse(
      readFileSync(path.join(root, 'package.json'), 'utf8'),
    ).packageManager;
    const pnpmVersion = String(run('pnpm', ['--version'], { cwd: root })).trim();
    if (packageManager !== `pnpm@${pnpmVersion}`) {
      throw new Error(
        `${lane} active pnpm ${pnpmVersion} does not match ${String(packageManager)}`,
      );
    }
    run('pnpm', ['install', '--offline', '--frozen-lockfile', '--ignore-scripts'], {
      cwd: root,
      timeoutMs: options.installTimeoutMs,
    });
    run(
      process.execPath,
      [path.join(root, 'benchmarks/corpora/generate.mjs'), '--sizes', String(options.size)],
      { cwd: root, timeoutMs: options.installTimeoutMs },
    );
  }
  const manifest = (root) =>
    path.join(
      root,
      'benchmarks',
      'kovo',
      '.corpora',
      'kovo',
      `n${String(options.size)}`,
      'manifest.json',
    );
  const corpus = {
    baseline: await inspectCorpus(manifest(roots.baseline), roots.baseline),
    spike: await inspectCorpus(manifest(roots.spike), roots.spike),
  };
  if (
    corpus.baseline.modules !== options.size ||
    corpus.spike.modules !== options.size ||
    !sameCorpus(corpus.baseline, corpus.spike)
  ) {
    throw new Error('baseline and spike generated corpus identities differ');
  }
  const tooling = {
    baseline: toolingEvidence(roots.baseline),
    spike: toolingEvidence(roots.spike),
  };
  if (!sameJson(tooling.baseline, tooling.spike)) {
    throw new Error('baseline and spike do not use byte-identical corpus/dev-loop adapters');
  }
  const after = {
    baseline: collectState(roots.baseline),
    spike: collectState(roots.spike),
  };
  const stabilityFindings = sourcePairStabilityFindings(before, after, candidateBinding);
  if (stabilityFindings.length > 0) {
    throw new Error(`source changed during preparation: ${stabilityFindings.join('; ')}`);
  }
  return {
    candidateBinding,
    corpus,
    frozenInstall: {
      argv: ['pnpm', 'install', '--offline', '--frozen-lockfile', '--ignore-scripts'],
      packageManager: before.baseline.packageManager,
      pnpmVersion: before.baseline.pnpmVersion,
    },
    manifestPaths: { baseline: manifest(roots.baseline), spike: manifest(roots.spike) },
    roots,
    source: { after, before, stable: true },
    tooling,
  };
}

export async function runDevGenerationSpike(options = {}, dependencies = {}) {
  const policy = normalizeOptions(options);
  const prepare = dependencies.prepare ?? prepareDevGenerationSpike;
  const prepared = await prepare(policy, dependencies.preparationDependencies ?? {});
  if (policy.prepareOnly) return prepareReport(prepared, policy, dependencies);

  const hostFingerprint = (dependencies.hostFingerprint ?? performanceHostFingerprint)();
  const sampleHost = dependencies.sampleHost ?? sampleHostLoad;
  const collectState = dependencies.collectState ?? collectWorktreeState;
  const runAdapter = dependencies.runAdapter ?? runDevLoopAdapter;
  const hostSamples = [];
  const cells = [];
  const errors = [];
  const ephemeralScratch = policy.adapterEvidenceRoot === null;
  const scratch = ephemeralScratch
    ? mkdtempSync(path.join(os.tmpdir(), 'kovo-dev-generation-ab-'))
    : prepareAdapterEvidenceRoot(policy.adapterEvidenceRoot);
  try {
    const schedule = devGenerationSchedule(policy);
    const initialHost = sampleHost('pre-timing', policy.maxLoadPerCpu);
    hostSamples.push(initialHost);
    if (!initialHost.comparable) {
      throw new Error(
        `host load ${initialHost.loadPerCpu.toFixed(3)} per CPU exceeds ceiling ${String(
          policy.maxLoadPerCpu,
        )}; no timing process was started`,
      );
    }
    const acquireLock = dependencies.acquireLock ?? acquireTimingLock;
    const timingLock = acquireLock(policy.timingLockPath);
    try {
      for (const scheduled of schedule) {
        const host = sampleHost(
          `block-${String(scheduled.scheduleIndex)}-${scheduled.lane}`,
          policy.maxLoadPerCpu,
        );
        hostSamples.push(host);
        if (!host.comparable) {
          errors.push(
            `block ${String(scheduled.scheduleIndex)} load ${host.loadPerCpu.toFixed(
              3,
            )} per CPU exceeded ceiling ${String(policy.maxLoadPerCpu)}`,
          );
          break;
        }
        const root = prepared.roots[scheduled.lane];
        const beforeBlock = collectState(root);
        const expectedState = prepared.source.before[scheduled.lane];
        const stateFindings = worktreeStabilityFindings(expectedState, beforeBlock, scheduled.lane);
        if (stateFindings.length > 0) {
          errors.push(...stateFindings);
          break;
        }
        const port = policy.portBase + scheduled.scheduleIndex;
        const resultFile = path.join(
          scratch,
          `${String(scheduled.scheduleIndex)}-${scheduled.lane}.json`,
        );
        let report;
        try {
          report = await runAdapter({
            editSamples: scheduled.editSamples,
            manifestPath: prepared.manifestPaths[scheduled.lane],
            outPath: resultFile,
            port,
            readySamples: scheduled.readySamples,
            readyTimeoutMs: policy.readyTimeoutMs,
            root,
            timeoutMs: policy.timeoutMs,
            warmups: scheduled.warmups,
          });
        } catch (error) {
          errors.push(
            `block ${String(scheduled.scheduleIndex)} ${scheduled.lane}: ${errorMessage(error)}`,
          );
          break;
        }
        const cell = { ...scheduled, port, report };
        const findings = validateDevGenerationCell(cell, {
          commit: expectedState.commit,
          corpus: prepared.corpus[scheduled.lane],
          locks: expectedState.locks,
        });
        cells.push(cell);
        if (findings.length > 0) {
          errors.push(...findings);
          break;
        }
        const afterBlock = collectState(root);
        const afterFindings = worktreeStabilityFindings(expectedState, afterBlock, scheduled.lane);
        if (afterFindings.length > 0) {
          errors.push(...afterFindings);
          break;
        }
      }
    } finally {
      timingLock.release();
      const postHost = sampleHost('post-timing', policy.maxLoadPerCpu);
      hostSamples.push(postHost);
      if (!postHost.comparable) {
        errors.push(
          `post-timing load ${postHost.loadPerCpu.toFixed(3)} per CPU exceeded ceiling ${String(
            policy.maxLoadPerCpu,
          )}`,
        );
      }
    }

    const sourceAfter = {
      baseline: collectState(prepared.roots.baseline),
      spike: collectState(prepared.roots.spike),
    };
    const sourceFindings = sourcePairStabilityFindings(
      prepared.source.before,
      sourceAfter,
      prepared.candidateBinding,
    );
    errors.push(...sourceFindings);
    const analysis = aggregateDevGenerationCells(cells, policy);
    const complete =
      errors.length === 0 &&
      cells.length === schedule.length &&
      analysis.correctness.complete === true &&
      hostSamples.every((sample) => sample.comparable);
    return {
      analysis,
      candidate: prepared.candidateBinding,
      cells,
      finishedAt: new Date().toISOString(),
      host: hostFingerprint,
      hostSamples,
      integrity: {
        complete,
        errors,
        matchedCorpus: sameCorpus(prepared.corpus.baseline, prepared.corpus.spike),
        misses: analysis.correctness.misses,
        serialized: true,
        sourceStable: sourceFindings.length === 0,
      },
      policy: reportPolicy(policy),
      preparation: preparationEvidence(prepared),
      schema: DEV_GENERATION_SPIKE_SCHEMA,
      sourceAfter,
      startedAt: hostSamples[0]?.at ?? null,
      verdict: {
        reasons: [
          ...errors,
          ...(complete && !analysis.acceptance.candidateAccepted
            ? ['candidate did not satisfy every browser-visible acceptance cell and guardrail']
            : []),
        ],
        status: !complete
          ? 'unproven'
          : analysis.acceptance.candidateAccepted
            ? 'accept'
            : 'reject',
      },
    };
  } finally {
    if (ephemeralScratch) rmSync(scratch, { force: true, recursive: true });
  }
}

export function parseDevGenerationSpikeArgs(argv) {
  const options = {};
  const booleanFlags = new Set(['--measure', '--prepare-only', '--quick-smoke']);
  const valueFlags = new Set([
    '--baseline-root',
    '--bootstrap-iterations',
    '--edit-samples',
    '--install-timeout-ms',
    '--max-load-per-cpu',
    '--out',
    '--port-base',
    '--ready-samples',
    '--ready-timeout-ms',
    '--seed',
    '--size',
    '--spike-root',
    '--timeout-ms',
    '--warmups',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (booleanFlags.has(flag)) {
      const key = camelFlag(flag);
      if (options[key] === true) throw new TypeError(`duplicate ${flag}`);
      options[key] = true;
    } else if (valueFlags.has(flag)) {
      const value = argv[++index];
      if (value === undefined) throw new TypeError(`${flag} requires a value`);
      const key = camelFlag(flag);
      if (Object.hasOwn(options, key)) throw new TypeError(`duplicate ${flag}`);
      options[key] = ['--baseline-root', '--out', '--spike-root'].includes(flag)
        ? value
        : Number(value);
    } else {
      throw new TypeError(`unsupported dev generation benchmark option: ${String(flag)}`);
    }
  }
  if (options.measure === true && options.prepareOnly === true) {
    throw new TypeError('--measure and --prepare-only are mutually exclusive');
  }
  if (options.measure !== true && options.prepareOnly !== true) {
    throw new TypeError('choose --prepare-only or explicitly authorize timing with --measure');
  }
  return options;
}

function analyzePairedMetric(cells, selectRows, key, options) {
  const laneValues = { baseline: [], spike: [] };
  const pairs = [];
  for (const occurrence of [0, 1]) {
    const baselineCell = cells.find(
      (cell) => cell.lane === 'baseline' && cell.occurrence === occurrence,
    );
    const spikeCell = cells.find((cell) => cell.lane === 'spike' && cell.occurrence === occurrence);
    const baseline = (baselineCell ? selectRows(baselineCell.report) : [])
      .map((row) => row?.[key])
      .filter(finitePositive);
    const spike = (spikeCell ? selectRows(spikeCell.report) : [])
      .map((row) => row?.[key])
      .filter(finitePositive);
    laneValues.baseline.push(...baseline);
    laneValues.spike.push(...spike);
    if (baseline.length !== spike.length) {
      if (options.optional && baseline.length === 0 && spike.length === 0) continue;
      continue;
    }
    for (let index = 0; index < baseline.length; index += 1) {
      pairs.push({ baseline: baseline[index], spike: spike[index] });
    }
  }
  const baselineSummary = summarizeDevMetric(laneValues.baseline);
  const spikeSummary = summarizeDevMetric(laneValues.spike);
  const baselinePairs = pairs.map((pair) => pair.baseline);
  const spikePairs = pairs.map((pair) => pair.spike);
  const differences = pairs.map((pair) => pair.baseline - pair.spike);
  const improvementPercent =
    baselineSummary.median === null || spikeSummary.median === null
      ? null
      : ((baselineSummary.median - spikeSummary.median) / baselineSummary.median) * 100;
  return {
    baseline: baselineSummary,
    pairedImprovement: {
      bootstrap95Ci: pairedBootstrapImprovementCi(baselinePairs, spikePairs, {
        iterations: options.bootstrapIterations,
        seed: options.seed,
      }),
      direction: 'baseline-minus-spike',
      median: differences.length === 0 ? null : percentile(differences, 50),
      samples: pairs.length,
    },
    spike: spikeSummary,
    spikeMedianImprovementPercent: improvementPercent,
  };
}

function correctnessSummary(cells) {
  const state = Object.fromEntries(
    EDIT_CLASSES.map((editClass) => [editClass, { survived: 0, total: 0 }]),
  );
  let adapterErrors = 0;
  let browserRequestFailures = 0;
  let browserUnexpectedErrors = 0;
  let misses = 0;
  let syntaxDiagnostics = 0;
  for (const cell of cells) {
    adapterErrors += cell.report?.integrity?.errors?.length ?? 0;
    misses += cell.report?.integrity?.misses ?? 0;
    browserRequestFailures += cell.report?.integrity?.browser?.requestFailedCount ?? 0;
    browserUnexpectedErrors += cell.report?.integrity?.browser?.unexpectedErrorCount ?? 0;
    for (const sample of cell.report?.samples ?? []) {
      for (const editClass of EDIT_CLASSES) {
        state[editClass].total += 1;
        if (sample?.[`${editClass}StateSurvived`] === true) state[editClass].survived += 1;
      }
      if (nonEmptyString(sample?.syntaxErrorDiagnosticSignal)) syntaxDiagnostics += 1;
    }
  }
  const stateLost = Object.values(state).reduce(
    (total, value) => total + value.total - value.survived,
    0,
  );
  const expectedSyntaxDiagnostics = cells.reduce(
    (total, cell) => total + (cell.report?.samples?.length ?? 0),
    0,
  );
  return {
    adapterErrors,
    browserRequestFailures,
    browserUnexpectedErrors,
    complete:
      adapterErrors === 0 &&
      misses === 0 &&
      browserRequestFailures === 0 &&
      browserUnexpectedErrors === 0 &&
      stateLost === 0 &&
      syntaxDiagnostics === expectedSyntaxDiagnostics,
    misses,
    state,
    stateLost,
    syntaxDiagnostics,
  };
}

function metricAcceptanceResult(metric) {
  const improvement = metric?.spikeMedianImprovementPercent;
  const lower = metric?.pairedImprovement?.bootstrap95Ci?.[0];
  return {
    improvementAtLeast10Percent: Number.isFinite(improvement) && improvement >= 10,
    pairedCiLowerPositive: Number.isFinite(lower) && lower > 0,
    passed:
      Number.isFinite(improvement) && improvement >= 10 && Number.isFinite(lower) && lower > 0,
  };
}

function noMedianRegressionOver(metric, percent) {
  const improvement = metric?.spikeMedianImprovementPercent;
  return {
    maximumRegressionPercent: percent,
    observedImprovementPercent: improvement,
    passed: Number.isFinite(improvement) && improvement >= -percent,
  };
}

function prepareReport(prepared, policy, dependencies) {
  const complete = prepared.source.stable === true;
  return {
    candidate: prepared.candidateBinding,
    host: (dependencies.hostFingerprint ?? performanceHostFingerprint)(),
    integrity: { complete, matchedCorpus: true, sourceStable: true },
    mode: 'prepare-only',
    policy: reportPolicy(policy),
    preparation: preparationEvidence(prepared),
    schema: DEV_GENERATION_SPIKE_PREPARE_SCHEMA,
    verdict: { reasons: [], status: complete ? 'prepared' : 'unproven' },
  };
}

function preparationEvidence(prepared) {
  return {
    corpus: prepared.corpus,
    frozenInstall: prepared.frozenInstall,
    source: prepared.source,
    tooling: prepared.tooling,
  };
}

function reportPolicy(policy) {
  return {
    adapterTimeoutMs: policy.timeoutMs,
    bootstrapIterations: policy.bootstrapIterations,
    editSamplesPerLane: policy.editSamples,
    maxLoadPerCpu: policy.maxLoadPerCpu,
    order: [...SCHEDULE_LANES],
    portBase: policy.portBase,
    readySamplesPerLane: policy.readySamples,
    readyTimeoutMs: policy.readyTimeoutMs,
    rawAdapterEvidence: policy.adapterEvidenceRoot === null ? 'ephemeral' : '<out-dir>/raw',
    size: policy.size,
    timingAuthorization: policy.prepareOnly ? 'prepare-only' : 'explicit-measure',
    timingLock: '<os-temp>/kovo-performance-timing.lock',
    warmupsPerLane: policy.warmups,
  };
}

function normalizeOptions(options) {
  const quick = options.quickSmoke === true;
  const measure = options.measure === true;
  const prepareOnly = options.prepareOnly === true;
  if (measure === prepareOnly) {
    throw new TypeError('exactly one of measure or prepareOnly must be true');
  }
  const baselineRoot = canonicalDirectory(requiredString(options.baselineRoot, '--baseline-root'));
  const spikeRoot = canonicalDirectory(requiredString(options.spikeRoot, '--spike-root'));
  const size = Number(options.size ?? 24);
  if (!SUPPORTED_SIZES.includes(size)) throw new TypeError('--size must be 24 or 216');
  const portBase = boundedInteger(options.portBase ?? 49_750, 1_024, 65_532, '--port-base');
  const outPath = options.out === undefined ? null : path.resolve(options.out);
  return {
    adapterEvidenceRoot: outPath === null ? null : path.join(path.dirname(outPath), 'raw'),
    baselineRoot,
    bootstrapIterations: boundedInteger(
      options.bootstrapIterations ?? (quick ? 500 : DEFAULT_BOOTSTRAP_ITERATIONS),
      100,
      1_000_000,
      '--bootstrap-iterations',
    ),
    editSamples: boundedInteger(
      options.editSamples ?? (quick ? 2 : DEFAULT_EDIT_SAMPLES),
      2,
      100,
      '--edit-samples',
    ),
    installTimeoutMs: boundedInteger(
      options.installTimeoutMs ?? 10 * 60 * 1_000,
      1_000,
      60 * 60 * 1_000,
      '--install-timeout-ms',
    ),
    maxLoadPerCpu: finitePositiveNumber(options.maxLoadPerCpu ?? 1, '--max-load-per-cpu'),
    measure,
    portBase,
    prepareOnly,
    readySamples: boundedInteger(
      options.readySamples ?? (quick ? 2 : DEFAULT_READY_SAMPLES),
      2,
      100,
      '--ready-samples',
    ),
    readyTimeoutMs: boundedInteger(
      options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
      1_000,
      30 * 60 * 1_000,
      '--ready-timeout-ms',
    ),
    seed: boundedInteger(options.seed ?? 1, 0, 0xffff_ffff, '--seed'),
    size,
    spikeRoot,
    timeoutMs: boundedInteger(
      options.timeoutMs ?? 30 * 60 * 1_000,
      60_000,
      60 * 60 * 1_000,
      '--timeout-ms',
    ),
    timingLockPath:
      options.timingLockPath ?? path.join(os.tmpdir(), 'kovo-performance-timing.lock'),
    warmups: boundedInteger(options.warmups ?? (quick ? 0 : DEFAULT_WARMUPS), 0, 10, '--warmups'),
  };
}

async function runDevLoopAdapter(options) {
  const adapter = path.join(options.root, 'benchmarks', 'corpora', 'dev-loop.mjs');
  const result = spawnSync(
    process.execPath,
    [
      adapter,
      '--manifest',
      options.manifestPath,
      '--iterations',
      String(options.editSamples),
      '--ready-iterations',
      String(options.readySamples),
      '--ready-timeout-ms',
      String(options.readyTimeoutMs),
      '--warmups',
      String(options.warmups),
      '--port',
      String(options.port),
      '--out',
      options.outPath,
    ],
    {
      cwd: options.root,
      encoding: 'utf8',
      env: cleanBenchmarkEnvironment(process.env),
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeoutMs,
    },
  );
  const adapterEvidence = readAdapterEvidence(options.outPath);
  if (result.error || result.signal || result.status !== 0) {
    const output = `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`.trim();
    throw new Error(
      `dev-loop adapter failed: ${boundedDiagnostic(
        [
          adapterProcessExit(result),
          adapterEvidence.failureDiagnostic,
          result.error?.message,
          output,
        ]
          .filter(nonEmptyString)
          .join('; '),
      )}`,
    );
  }
  if (adapterEvidence.error !== null) throw new Error(adapterEvidence.error);
  return adapterEvidence.report;
}

function prepareAdapterEvidenceRoot(root) {
  mkdirSync(root, { mode: 0o700, recursive: true });
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new TypeError('raw adapter evidence root must be a non-symlink directory');
  }
  if (readdirSync(root).length > 0) {
    throw new Error('raw adapter evidence root must be empty before measurement');
  }
  return realpathSync(root);
}

function readAdapterEvidence(outPath) {
  let bytes;
  try {
    bytes = readFileSync(outPath);
  } catch (error) {
    const message = `dev-loop adapter report is unavailable: ${errorMessage(error)}`;
    return { error: message, failureDiagnostic: message, report: null };
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_REPORT_BYTES) {
    const message = 'dev-loop adapter report is empty or exceeds its evidence bound';
    return { error: message, failureDiagnostic: message, report: null };
  }
  let report;
  try {
    report = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    const message = `dev-loop adapter report is invalid JSON: ${errorMessage(error)}`;
    return { error: message, failureDiagnostic: message, report: null };
  }
  return {
    error: null,
    failureDiagnostic: JSON.stringify(summarizeFailedAdapterReport(report, bytes)),
    report,
  };
}

export function summarizeFailedAdapterReport(report, bytes) {
  return {
    editSessionError: report?.editSession?.error ?? null,
    integrityErrors: (report?.integrity?.errors ?? []).slice(0, 12),
    readyFailures: (report?.readySamples ?? [])
      .filter((sample) => sample?.success !== true)
      .slice(0, 12)
      .map((sample) => ({ error: sample?.error ?? null, iteration: sample?.iteration ?? null })),
    reportBytes: bytes.byteLength,
    reportSha256: sha256(bytes),
    schema: report?.schema ?? null,
    verdict: report?.verdict?.status ?? null,
  };
}

function adapterProcessExit(result) {
  return `exit ${String(result.status)} signal ${String(result.signal)}`;
}

function collectWorktreeState(root) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const pnpmVersion = String(runCheckedCommand('pnpm', ['--version'], { cwd: root })).trim();
  const dirtyPaths = gitDirtyPaths(root, gitOutput);
  return {
    commit: gitOutput(root, ['rev-parse', 'HEAD']),
    dirty: dirtyPaths.length > 0,
    dirtyPaths,
    locks: Object.fromEntries(
      LOCK_FILES.map((file) => {
        const target = path.join(root, file);
        return [file, lstatSync(target).isFile() ? sha256(readFileSync(target)) : null];
      }),
    ),
    packageManager: manifest.packageManager,
    pnpmVersion,
  };
}

function validatePreparedSourcePair(states, candidateBinding) {
  if (
    states.baseline.dirty ||
    states.spike.dirty ||
    states.baseline.commit !== candidateBinding.baseline.commit ||
    states.spike.commit !== candidateBinding.spike.commit
  ) {
    throw new Error('prepared source pair is dirty or does not match candidate binding');
  }
  if (!sameJson(states.baseline.locks, states.spike.locks) || !validLocks(states.baseline.locks)) {
    throw new Error('baseline/spike root, Next.js, and harness lock identities do not match');
  }
  if (
    states.baseline.packageManager !== states.spike.packageManager ||
    states.baseline.pnpmVersion !== states.spike.pnpmVersion ||
    states.baseline.packageManager !== `pnpm@${states.baseline.pnpmVersion}`
  ) {
    throw new Error('baseline/spike package-manager identities do not match');
  }
}

function sourcePairStabilityFindings(before, after, candidateBinding) {
  return [
    ...worktreeStabilityFindings(before.baseline, after.baseline, 'baseline'),
    ...worktreeStabilityFindings(before.spike, after.spike, 'spike'),
    ...(after.baseline.commit === candidateBinding.baseline.commit
      ? []
      : ['baseline commit drift']),
    ...(after.spike.commit === candidateBinding.spike.commit ? [] : ['spike commit drift']),
  ];
}

function worktreeStabilityFindings(before, after, lane) {
  const findings = [];
  if (after?.dirty !== false) findings.push(`${lane} source is dirty`);
  if (before?.commit !== after?.commit) findings.push(`${lane} source commit changed`);
  if (!sameJson(before?.locks, after?.locks)) findings.push(`${lane} lock digests changed`);
  if (!sameJson(before?.dirtyPaths, after?.dirtyPaths))
    findings.push(`${lane} dirty paths changed`);
  return findings;
}

function toolingEvidence(root) {
  return {
    corpusGeneratorSha256: sha256(readFileSync(path.join(root, 'benchmarks/corpora/generate.mjs'))),
    devLoopAdapterSha256: sha256(readFileSync(path.join(root, 'benchmarks/corpora/dev-loop.mjs'))),
    devLoopSchema: ADAPTER_SCHEMA,
  };
}

function sameCorpus(left, right) {
  const comparable = (value) => ({
    editClasses: value.editClasses,
    manifestDigest: value.manifestDigest,
    modules: value.modules,
    routes: value.routes,
    schema: value.schema,
    shapeDigest: value.shapeDigest,
    sourceDigest: value.sourceDigest,
    stateSurface: value.stateSurface,
  });
  return sameJson(comparable(left), comparable(right));
}

function canonicalGitRoot(value, git) {
  const root = canonicalDirectory(requiredString(value, 'worktree root'));
  const topLevel = canonicalDirectory(git(root, ['rev-parse', '--show-toplevel']));
  if (root !== topLevel) throw new TypeError(`${root} is not an exact git worktree root`);
  return root;
}

function canonicalDirectory(value) {
  const absolute = path.resolve(value);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new TypeError(`${value} must resolve to a non-symlink directory`);
  }
  return realpathSync(absolute);
}

async function verifyGeneratedDevCorpus(manifestPath, root) {
  const adapterPath = path.join(root, 'benchmarks', 'corpora', 'dev-loop.mjs');
  const adapter = await import(pathToFileURL(adapterPath).href);
  const loaded = await adapter.loadCorpusManifest(manifestPath);
  await adapter.verifyCorpusSources(loaded);
  return inspectGeneratedDevCorpus(manifestPath, root);
}

function gitOutput(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error(`git ${args.join(' ')} failed: ${boundedDiagnostic(result.stderr)}`);
  }
  return String(result.stdout).trim();
}

function gitDirtyPaths(root, git) {
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  return status === '' ? [] : status.split(/\r?\n/u);
}

function gitPatchBytes(root, from, to) {
  const result = spawnSync(
    'git',
    ['-C', root, 'diff', '--binary', '--full-index', '--no-ext-diff', from, to],
    { encoding: null, maxBuffer: MAX_COMMAND_OUTPUT_BYTES, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error(`could not read candidate patch: ${boundedDiagnostic(result.stderr)}`);
  }
  return Buffer.from(result.stdout);
}

function gitPatchId(root, commit) {
  const patch = spawnSync(
    'git',
    ['-C', root, 'show', '--pretty=format:', '--binary', '--no-ext-diff', commit],
    { encoding: null, maxBuffer: MAX_COMMAND_OUTPUT_BYTES, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (patch.status !== 0 || patch.signal || patch.error) {
    throw new Error(`could not read patch-id input: ${boundedDiagnostic(patch.stderr)}`);
  }
  const result = spawnSync('git', ['patch-id', '--stable'], {
    encoding: 'utf8',
    input: patch.stdout,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error(`could not calculate patch-id: ${boundedDiagnostic(result.stderr)}`);
  }
  const match = /^([0-9a-f]{40})\s+[0-9a-f]{40}$/u.exec(String(result.stdout).trim());
  if (match === null) throw new Error('git patch-id returned malformed evidence');
  return match[1];
}

function changedPaths(root, from, to, git) {
  const lines = git(root, ['diff', '--name-status', '--no-renames', from, to]);
  if (lines === '') return [];
  return lines.split(/\r?\n/u).map((line) => {
    const [status, file, extra] = line.split('\t');
    if (status !== 'M' || !nonEmptyString(file) || extra !== undefined) {
      throw new Error(`candidate path change is not a simple modification: ${line}`);
    }
    return file;
  });
}

function runCheckedCommand(command, args, options) {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      env: cleanBenchmarkEnvironment(process.env),
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeoutMs ?? 10 * 60 * 1_000,
    });
  } catch (error) {
    throw new Error(
      `${command} ${args.join(' ')} failed: ${boundedDiagnostic(
        `${String(error?.stdout ?? '')}\n${String(error?.stderr ?? '')}`.trim() || error?.message,
      )}`,
    );
  }
}

function cleanBenchmarkEnvironment(base) {
  const env = { ...base };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  env.CI = '1';
  env.FORCE_COLOR = '0';
  env.LANG = 'C';
  env.LC_ALL = 'C';
  env.NO_COLOR = '1';
  env.TZ = 'UTC';
  return env;
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

function acquireTimingLock(file) {
  const resolved = path.resolve(file);
  let descriptor;
  try {
    descriptor = openSync(resolved, 'wx', 0o600);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    throw new Error(`another performance timing lane owns ${resolved}`);
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

function splitAcrossOccurrences(total) {
  return [Math.ceil(total / 2), Math.floor(total / 2)];
}

function validLocks(locks) {
  return LOCK_FILES.every((file) => /^sha256:[0-9a-f]{64}$/u.test(locks?.[file] ?? ''));
}

function percentile(values, percentage) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil((percentage / 100) * sorted.length) - 1)];
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

function sameStrings(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function finitePositive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function finitePositiveNumber(value, label) {
  if (!finitePositive(value)) throw new TypeError(`${label} must be finite and positive`);
  return value;
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function requiredString(value, label) {
  if (!nonEmptyString(value)) throw new TypeError(`${label} is required`);
  return value;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function camelFlag(flag) {
  return flag.slice(2).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
}

function boundedDiagnostic(value) {
  const text = String(value ?? '').trim() || '<no output>';
  return text.length <= 4_096 ? text : `${text.slice(0, 4_096)}\n... truncated ...`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseDevGenerationSpikeArgs(argv);
  const report = await runDevGenerationSpike(parsed);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (parsed.out !== undefined) writeFileSync(path.resolve(parsed.out), serialized, 'utf8');
  process.stdout.write(serialized);
  return ['prepared', 'accept'].includes(report.verdict.status) ? 0 : 1;
}

if (isMainEntry(import.meta.url)) await runGate(() => main());
