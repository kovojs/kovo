#!/usr/bin/env node
/**
 * Authenticated serialized A/B runner for the reviewed profile-driven development critical-path
 * candidate.
 *
 * The real browser-visible adapter owns edit observation and process-tree RSS. This runner owns
 * candidate identity, separate packed-product/frozen-consumer preparation, matched external corpus
 * generation, B,S,S,B serialization, quiet-host admission, paired analysis, and the acceptance
 * rule from plans/good-perf.md Phase 1. Bundle bytes and module-count proxies are recorded nowhere
 * in the acceptance path.
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

import {
  DEV_PORT_ALLOCATION_POSTURE,
  DEV_SESSION_PORT_STRIDE as DEV_GENERATION_CELL_PORT_STRIDE,
} from '../benchmarks/corpora/generate.mjs';
import {
  DEFAULT_DEV_PORT_BASE,
  inspectDevPortAllocation,
  validateDevPortAllocationEvidence,
} from '../benchmarks/harness/dev-port-allocation.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { devSessionHandoffFindings } from './lib/perf-dev-session-evidence.mjs';
import { canonicalJson, performanceHostFingerprint } from './lib/perf-host.mjs';
import {
  assertPackedCorpusIsolation,
  PACKED_KOVO_PRODUCT_IDENTITY_SCHEMA,
  packedKovoProductIdentityFindings,
} from './lib/perf-packed-kovo-product.mjs';
import { validReadyRouteProbe } from './lib/perf-ready-route.mjs';

export const DEV_GENERATION_SPIKE_SCHEMA = 'kovo-dev-generation-spike-comparison/v3';
export const DEV_GENERATION_SPIKE_PREPARE_SCHEMA = 'kovo-dev-generation-spike-prepare/v3';
export const DEV_GENERATION_ADAPTER_FAILURE_SCHEMA = 'kovo-dev-generation-adapter-failure/v3';
export const DEV_GENERATION_CANDIDATE_BINDING_SCHEMA = 'kovo-dev-generation-candidate-binding/v5';
export const DEV_GENERATION_PRODUCT_BOUNDARY_SCHEMA =
  'kovo-dev-generation-packed-product-boundary/v3';
export const DEV_GENERATION_PRODUCT_POLICY_SCHEMA = 'kovo-dev-generation-packed-product-policy/v3';
export const DEV_GENERATION_PRODUCT_POLICY = Object.freeze({
  artifactIdentity: PACKED_KOVO_PRODUCT_IDENTITY_SCHEMA,
  corpusGeneration: 'separate-per-lane-with-deferred-dependencies',
  corpusIsolation: 'fresh-external-os-tmpdir-without-ancestor-node-modules',
  laneIdentityComparison: 'concrete-identities-report-bound-but-not-required-equal',
  liveDescriptorVerification: 'separate-regular-consumer-descriptor-plus-adapter-before-and-after',
  preparationAdmission: 'quiet-host-before-preparation-and-before-each-timed-block',
  preparationTiming: 'build-pack-frozen-install-and-corpus-generation-outside-samples',
  rawReportBinding: 'exact-product-identity-required-before-and-after',
  schema: DEV_GENERATION_PRODUCT_POLICY_SCHEMA,
});
export { DEV_GENERATION_CELL_PORT_STRIDE };
export const DEV_CRITICAL_PATH_CANDIDATE = Object.freeze({
  commit: '1c591eca2fa7d1ba9c5cf90673cea36c54ee158f',
  parent: 'eb16f11734a2ab635a8207f2e6ece4612713f248',
  patchBytes: 113_296,
  patchId: '7ca973eed5467af294c601d41f3ddb1ade04fbff',
  patchSha256: 'sha256:ef119100be9f3a03d2de44a18a0114a988d0875cde324d23fa8b3cba60181c96',
  paths: Object.freeze([
    'packages/server/src/internal/data-plane-static-analysis.test.ts',
    'packages/server/src/internal/data-plane-static-analysis.ts',
    'packages/server/src/internal/runtime-registry-wire.ts',
    'packages/server/src/registry-facts.test.ts',
    'packages/server/src/vite-data-plane-gate.test.ts',
    'packages/server/src/vite.ts',
  ]),
  ref: 'refs/heads/perf-spike/dev-async-analysis-only-20260814',
  series: Object.freeze([
    Object.freeze({
      commit: '1aea7dd0678254ceeaa869c537b8f5317777cb08',
      parent: 'eb16f11734a2ab635a8207f2e6ece4612713f248',
      tree: '2b9ecbca08f6ebc7777a21163eead9dd9b3205e4',
    }),
    Object.freeze({
      commit: '07d6e5b23245df0d48fc071f78397329750705ee',
      parent: '1aea7dd0678254ceeaa869c537b8f5317777cb08',
      tree: '4c9a0aaa38ce39ddf73c839e083660f131bd951b',
    }),
    Object.freeze({
      commit: '1c591eca2fa7d1ba9c5cf90673cea36c54ee158f',
      parent: '07d6e5b23245df0d48fc071f78397329750705ee',
      tree: 'c409518713e7ae1451b4eb3d3524b17b4ac823fa',
    }),
  ]),
  tree: 'c409518713e7ae1451b4eb3d3524b17b4ac823fa',
});

const ADAPTER_SCHEMA = 'kovo-dev-loop-report/v1';
const CORPUS_SCHEMA = 'kovo-dev-corpus/v1';
const EDIT_SAVE_POSTURE = 'posix-sibling-.kovo-perf-save-*.tmp-write-rename+exact-watch-ignore/v2';
const DEFAULT_BOOTSTRAP_ITERATIONS = 10_000;
const DEFAULT_EDIT_SAMPLES = 30;
const DEFAULT_HOST_SETTLE_MAX_MS = 30_000;
const DEFAULT_HOST_SETTLE_POLL_MS = 1_000;
const DEFAULT_READY_SAMPLES = 15;
const DEFAULT_READY_TIMEOUT_MS = 10 * 60 * 1_000;
const DEFAULT_WARMUPS = 3;
const EDIT_CLASSES = Object.freeze(['leaf', 'entry', 'data', 'syntaxError', 'recovery']);
const CAUSAL_EDIT_METRICS = Object.freeze(['leafMs', 'entryMs', 'dataMs', 'recoveryMs']);
const LOCK_FILES = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);
const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_HOST_SETTLE_MAX_MS = 60_000;
const MAX_REPORT_BYTES = 64 * 1024 * 1024;
const DECISION_EDIT_SAMPLES = 30;
const DECISION_READY_SAMPLES = 15;
const DECISION_WARMUPS = 3;
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

export function devGenerationPackedCorpusOptions(externalRoot, size) {
  if (!SUPPORTED_SIZES.includes(size)) throw new TypeError('packed corpus size must be 24 or 216');
  return {
    dependencyMode: 'deferred',
    framework: 'kovo',
    outDir: canonicalDirectory(externalRoot),
    size,
  };
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
  const candidate = options.candidate ?? DEV_CRITICAL_PATH_CANDIDATE;
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
  if (!Array.isArray(candidate.series) || candidate.series.length !== 3) {
    throw new Error('profile-driven candidate must bind the exact three-commit series');
  }
  const series = candidate.series;
  if (
    candidate.parent !== series[0]?.parent ||
    candidate.commit !== series[series.length - 1]?.commit ||
    candidate.tree !== series[series.length - 1]?.tree ||
    series.some(
      (entry, index) =>
        entry.parent !== (index === 0 ? candidate.parent : series[index - 1].commit),
    )
  ) {
    throw new Error('profile-driven candidate series declaration is internally inconsistent');
  }
  if (git(spikeRoot, ['rev-parse', `HEAD~${series.length}`]) !== baselineCommit) {
    throw new Error(`spike HEAD must be exactly ${series.length} commits atop baseline HEAD`);
  }
  if (git(spikeRoot, ['merge-base', baselineCommit, spikeCommit]) !== baselineCommit) {
    throw new Error('baseline must be the exact merge base of the spike');
  }
  if (
    git(spikeRoot, ['rev-list', '--count', `${baselineCommit}..${spikeCommit}`]) !==
    String(series.length)
  ) {
    throw new Error(`spike range must contain exactly ${series.length} commits`);
  }
  const spikeSeries = git(spikeRoot, [
    'rev-list',
    '--reverse',
    `${baselineCommit}..${spikeCommit}`,
  ]).split(/\r?\n/u);
  if (spikeSeries.length !== series.length) {
    throw new Error('spike range does not expose the exact candidate series boundaries');
  }

  const candidateRefCommit = git(candidateRepository, [
    'rev-parse',
    '--verify',
    `${candidate.ref}^{commit}`,
  ]);
  const candidateCommit = git(candidateRepository, ['rev-parse', `${candidate.commit}^{commit}`]);
  const candidateTree = git(candidateRepository, ['rev-parse', `${candidate.commit}^{tree}`]);
  if (
    candidateRefCommit !== candidate.commit ||
    candidateCommit !== candidate.commit ||
    candidateTree !== candidate.tree
  ) {
    throw new Error('profile-driven candidate object identity is unavailable or unexpected');
  }
  const candidateRange = git(candidateRepository, [
    'rev-list',
    '--reverse',
    `${candidate.parent}..${candidate.commit}`,
  ]).split(/\r?\n/u);
  if (
    !sameStrings(
      candidateRange,
      series.map((entry) => entry.commit),
    )
  ) {
    throw new Error('profile-driven candidate ref does not contain the exact declared series');
  }
  for (const entry of series) {
    const commit = git(candidateRepository, ['rev-parse', `${entry.commit}^{commit}`]);
    const parent = git(candidateRepository, ['rev-parse', `${entry.commit}^`]);
    const tree = git(candidateRepository, ['rev-parse', `${entry.commit}^{tree}`]);
    if (commit !== entry.commit || parent !== entry.parent || tree !== entry.tree) {
      throw new Error(
        'profile-driven candidate series object identity is unavailable or unexpected',
      );
    }
  }
  for (const [index, entry] of series.entries()) {
    const expectedCommitPatch = patch(candidateRepository, entry.parent, entry.commit);
    const observedCommitPatch = patch(
      spikeRoot,
      index === 0 ? baselineCommit : spikeSeries[index - 1],
      spikeSeries[index],
    );
    if (!observedCommitPatch.equals(expectedCommitPatch)) {
      throw new Error('spike commits do not preserve the exact candidate series patch boundaries');
    }
  }
  const expectedPatch = patch(candidateRepository, candidate.parent, candidate.commit);
  const observedPatch = patch(spikeRoot, baselineCommit, spikeCommit);
  const expectedPatchSha256 = sha256(expectedPatch);
  const observedPatchSha256 = sha256(observedPatch);
  const expectedPatchId = patchId(candidateRepository, candidate.parent, candidate.commit);
  const observedPatchId = patchId(spikeRoot, baselineCommit, spikeCommit);
  if (
    expectedPatch.byteLength !== candidate.patchBytes ||
    observedPatch.byteLength !== candidate.patchBytes ||
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
      `spike path census differs from profile-driven candidate: ${observedPaths.join(', ')}`,
    );
  }
  return {
    baseline: { commit: baselineCommit, root: baselineRoot },
    candidate: {
      commit: candidate.commit,
      parent: candidate.parent,
      patchBytes: candidate.patchBytes,
      patchId: candidate.patchId,
      patchSha256: candidate.patchSha256,
      paths: [...candidate.paths],
      ref: candidate.ref,
      series: candidate.series.map((entry) => ({ ...entry })),
      tree: candidate.tree,
    },
    schema: DEV_GENERATION_CANDIDATE_BINDING_SCHEMA,
    spike: {
      commit: spikeCommit,
      parent: baselineCommit,
      root: spikeRoot,
      series: spikeSeries,
    },
  };
}

export function inspectGeneratedDevCorpus(manifestPath, root) {
  const absolute = path.resolve(manifestPath);
  const expectedRoot = path.resolve(root);
  if (!isWithin(expectedRoot, absolute)) {
    throw new TypeError('corpus manifest escapes its fresh external preparation root');
  }
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
    manifest.workload?.devPortAllocationPosture !== DEV_PORT_ALLOCATION_POSTURE ||
    manifest.workload?.editSavePosture !== EDIT_SAVE_POSTURE ||
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
    devPortAllocationPosture: manifest.workload.devPortAllocationPosture,
    editSavePosture: manifest.workload.editSavePosture,
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

export function inspectDevGenerationProductBoundary(report, expected) {
  const findings = [];
  if (canonicalJson(expected?.policy) !== canonicalJson(DEV_GENERATION_PRODUCT_POLICY)) {
    findings.push('packed dev A/B policy drift');
  }
  const expectedIdentity = expected?.identity;
  if (
    expectedIdentity?.schema !== PACKED_KOVO_PRODUCT_IDENTITY_SCHEMA ||
    expectedIdentity?.identity?.schema !== PACKED_KOVO_PRODUCT_IDENTITY_SCHEMA
  ) {
    findings.push('prepared packed product identity schema mismatch');
  }
  findings.push(
    ...packedKovoProductIdentityFindings(report?.productArtifact, report?.source).map(
      (finding) => `raw report packed product ${finding}`,
    ),
  );
  if (canonicalJson(report?.productArtifact) !== canonicalJson(expectedIdentity)) {
    findings.push('raw report product identity differs from its prepared lane');
  }
  if (
    canonicalJson(report?.integrity?.productArtifact) !==
    canonicalJson({ afterVerified: true, beforeVerified: true, required: true })
  ) {
    findings.push('raw report did not verify its required product before and after measurement');
  }
  if (report?.integrity?.command?.productArtifactDigest !== expectedIdentity?.digest) {
    findings.push('raw report command is not bound to its product digest');
  }
  const commandArgv = report?.integrity?.command?.argv;
  if (
    !Array.isArray(commandArgv) ||
    commandArgv[0] !== 'node' ||
    commandArgv[1] !== '<packed-kovo>/node_modules/@kovojs/cli/dist/bin.mjs'
  ) {
    findings.push('raw report command is not the normalized packed Kovo CLI');
  }

  const expectedManifest = path.resolve(String(expected?.manifestPath ?? ''));
  const expectedExternalRoot = path.resolve(String(expected?.externalRoot ?? ''));
  let reportManifest = null;
  try {
    reportManifest = path.resolve(requiredString(report?.corpus?.manifestPath, 'report manifest'));
    if (reportManifest !== expectedManifest) {
      findings.push('raw report corpus manifest differs from its prepared external corpus');
    }
    if (
      expectedExternalRoot === path.parse(expectedExternalRoot).root ||
      !isWithin(expectedExternalRoot, reportManifest)
    ) {
      findings.push('raw report corpus is outside its fresh external preparation root');
    }
    assertPackedCorpusIsolation(path.dirname(reportManifest));
  } catch (error) {
    findings.push(`raw report external corpus isolation: ${errorMessage(error)}`);
  }

  return {
    complete: findings.length === 0,
    corpus: {
      ancestorDependencyIsolationVerified: findings.every(
        (finding) => !finding.startsWith('raw report external corpus isolation:'),
      ),
      externalRoot: '<fresh-os-tmpdir>',
      manifest:
        reportManifest === null || !isWithin(expectedExternalRoot, reportManifest)
          ? null
          : path.relative(expectedExternalRoot, reportManifest).split(path.sep).join('/'),
      reportBound: reportManifest === expectedManifest,
    },
    errors: [...new Set(findings)],
    policy: DEV_GENERATION_PRODUCT_POLICY,
    productArtifact: {
      digest: expectedIdentity?.digest ?? null,
      reportBound: canonicalJson(report?.productArtifact) === canonicalJson(expectedIdentity),
      schema: expectedIdentity?.schema ?? null,
      verifiedBeforeAndAfter:
        canonicalJson(report?.integrity?.productArtifact) ===
        canonicalJson({ afterVerified: true, beforeVerified: true, required: true }),
    },
    schema: DEV_GENERATION_PRODUCT_BOUNDARY_SCHEMA,
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
  const productBoundary = inspectDevGenerationProductBoundary(report, expected.product);
  findings.push(...productBoundary.errors.map((finding) => `${key} ${finding}`));
  if (
    report?.corpus?.modules !== expected.corpus.modules ||
    report?.corpus?.routes !== expected.corpus.routes ||
    report?.corpus?.manifestDigest !== expected.corpus.manifestDigest ||
    report?.corpus?.editSavePosture !== expected.corpus.editSavePosture ||
    report?.corpus?.devPortAllocationPosture !== expected.corpus.devPortAllocationPosture ||
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
    !Array.isArray(report?.integrity?.errors) ||
    report.integrity.errors.length !== 0 ||
    report?.integrity?.misses !== 0 ||
    report?.integrity?.browser?.unexpectedErrorCount !== 0 ||
    report?.integrity?.browser?.requestFailedCount !== 0 ||
    !(report?.integrity?.browser?.responseCount > 0)
  ) {
    findings.push(`${key} adapter correctness failure`);
  }
  findings.push(
    ...devSessionHandoffFindings(report, {
      basePort: cell.port,
      readyIterations: cell.readySamples,
    }).map((finding) => `${key} ${finding}`),
  );
  if (
    !Array.isArray(report?.readySamples) ||
    report.readySamples.length !== cell.readySamples ||
    report.readySamples.some(
      (sample, index) =>
        sample?.iteration !== index ||
        sample.success !== true ||
        !finitePositive(sample.durationMs) ||
        !finitePositive(sample.peakRssBytes) ||
        sample.browserContextClosed !== true ||
        !validReadyRouteProbe(sample.readinessProbe) ||
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
    !(report?.editSession?.rssSamples > 0) ||
    report?.editSession?.browserContextClosed !== true ||
    !validReadyRouteProbe(report?.editSession?.readinessProbe)
  ) {
    findings.push(`${key} edit-session readiness or RSS evidence is incomplete`);
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
  metrics.readyMs = analyzePairedMetric(
    cells,
    (report) => evidenceRows(report?.readySamples),
    'durationMs',
    {
      bootstrapIterations: policy.bootstrapIterations,
      seed: seed++,
    },
  );
  metrics.readyPeakRssBytes = analyzePairedMetric(
    cells,
    (report) => evidenceRows(report?.readySamples),
    'peakRssBytes',
    { bootstrapIterations: policy.bootstrapIterations, seed: seed++ },
  );
  for (const editClass of EDIT_CLASSES) {
    metrics[`${editClass}Ms`] = analyzePairedMetric(
      cells,
      (report) => evidenceRows(report?.samples),
      `${editClass}Ms`,
      { bootstrapIterations: policy.bootstrapIterations, seed: seed++ },
    );
    metrics[`${editClass}ServerGenerationMs`] = analyzePairedMetric(
      cells,
      (report) => evidenceRows(report?.samples),
      `${editClass}ServerGenerationMs`,
      { bootstrapIterations: policy.bootstrapIterations, seed: seed++, optional: true },
    );
  }
  metrics.editPeakRssBytes = analyzePairedMetric(
    cells,
    (report) => (report?.editSession === undefined ? [] : [report.editSession]),
    'peakRssBytes',
    { bootstrapIterations: policy.bootstrapIterations, seed: seed++ },
  );

  const correctness = correctnessSummary(cells);
  const causalMetricAcceptance = Object.fromEntries(
    CAUSAL_EDIT_METRICS.map((name) => [name, metricAcceptanceResult(metrics[name])]),
  );
  const guardrailMetrics = ['syntaxErrorMs', 'readyMs', 'readyPeakRssBytes', 'editPeakRssBytes'];
  const guardrails = Object.fromEntries(
    guardrailMetrics.map((name) => [name, noMedianAndP95RegressionOver(metrics[name], 5)]),
  );
  const candidateP95Targets = {
    recoveryMs: candidateP95AtMost(metrics.recoveryMs, 2_000),
    syntaxErrorMs: candidateP95AtMost(metrics.syntaxErrorMs, 1_000),
  };
  const decisionSamplePolicy = inspectDecisionSamplePolicy(cells, policy);
  const candidateAccepted =
    correctness.complete &&
    decisionSamplePolicy.complete &&
    Object.values(causalMetricAcceptance).every((value) => value.passed) &&
    Object.values(guardrails).every((value) => value.passed) &&
    Object.values(candidateP95Targets).every((value) => value.passed);
  return {
    acceptance: {
      boundaryRequired: DEV_GENERATION_PRODUCT_BOUNDARY_SCHEMA,
      candidateAccepted,
      candidateP95Targets,
      causalMetricAcceptance,
      correctnessRequired: true,
      decisionSamplePolicy,
      excludedProxyEvidence: ['bundleBytes', 'emittedBytes', 'moduleCount'],
      guardrails,
      requiredBrowserVisibleMetrics: [...CAUSAL_EDIT_METRICS],
      rule: 'profiled-causal-edit-wins-and-noncausal-target-guardrails/packed-v3',
      syntaxErrorPosture: 'correctness-and-p95-guardrail-not-profiled-win/packed-v3',
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
  if (candidateBinding?.schema !== DEV_GENERATION_CANDIDATE_BINDING_SCHEMA) {
    throw new Error(
      `candidate binding schema must be ${DEV_GENERATION_CANDIDATE_BINDING_SCHEMA}; prior evidence cannot be reinterpreted`,
    );
  }
  const collectState = dependencies.collectState ?? collectWorktreeState;
  const preparePackedLane = dependencies.preparePackedLane ?? preparePackedDevGenerationLane;
  const roots = {
    baseline: candidateBinding.baseline.root,
    spike: candidateBinding.spike.root,
  };
  const before = {
    baseline: collectState(roots.baseline),
    spike: collectState(roots.spike),
  };
  validatePreparedSourcePair(before, candidateBinding);
  const lanes = {};
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    const errors = [];
    for (const lane of ['spike', 'baseline']) {
      try {
        lanes[lane]?.cleanup?.();
      } catch (error) {
        errors.push(`${lane}: ${errorMessage(error)}`);
      }
    }
    if (errors.length > 0) {
      throw new Error(`packed dev A/B cleanup failed: ${errors.join('; ')}`);
    }
  };
  try {
    for (const lane of ['baseline', 'spike']) {
      lanes[lane] = await preparePackedLane(
        {
          installTimeoutMs: options.installTimeoutMs,
          lane,
          root: roots[lane],
          size: options.size,
          source: before[lane],
        },
        {
          collectState,
          inspectCorpus: dependencies.inspectCorpus ?? verifyGeneratedDevCorpus,
        },
      );
      validatePreparedPackedLane(lanes[lane], { lane, root: roots[lane], size: options.size });
    }
    if (
      canonicalDirectory(lanes.baseline.externalRoot) ===
      canonicalDirectory(lanes.spike.externalRoot)
    ) {
      throw new Error('baseline and spike must use separate fresh external corpus roots');
    }
    if (
      canonicalDirectory(lanes.baseline.consumerRoot) ===
        canonicalDirectory(lanes.spike.consumerRoot) ||
      realpathSync(lanes.baseline.descriptorPath) === realpathSync(lanes.spike.descriptorPath) ||
      sameFileIdentity(
        lstatSync(lanes.baseline.descriptorPath),
        lstatSync(lanes.spike.descriptorPath),
      )
    ) {
      throw new Error('baseline and spike must use separate packed product consumers/descriptors');
    }
    const corpus = {
      baseline: lanes.baseline.corpus,
      spike: lanes.spike.corpus,
    };
    if (
      corpus.baseline.modules !== options.size ||
      corpus.spike.modules !== options.size ||
      !sameCorpus(corpus.baseline, corpus.spike)
    ) {
      throw new Error('baseline and spike generated corpus identities differ');
    }
    const tooling = {
      baseline: lanes.baseline.tooling,
      spike: lanes.spike.tooling,
    };
    if (!sameJson(tooling.baseline, tooling.spike)) {
      throw new Error(
        'baseline and spike do not use byte-identical packed-product, corpus, and dev-loop tooling',
      );
    }
    const after = {
      baseline: collectState(roots.baseline),
      spike: collectState(roots.spike),
    };
    const stabilityFindings = sourcePairStabilityFindings(before, after, candidateBinding);
    if (stabilityFindings.length > 0) {
      throw new Error(`source changed during preparation: ${stabilityFindings.join('; ')}`);
    }
    const productBoundary = {
      complete: true,
      identities: {
        baseline: lanes.baseline.identity,
        spike: lanes.spike.identity,
      },
      policy: DEV_GENERATION_PRODUCT_POLICY,
      schema: DEV_GENERATION_PRODUCT_BOUNDARY_SCHEMA,
      separateConsumersAndDescriptors: true,
      separatePreparationRoots: true,
    };
    return {
      candidateBinding,
      cleanup,
      corpus,
      frozenInstall: {
        baseline: lanes.baseline.identity.identity.consumer.frozenInstall,
        separatePerLane: true,
        spike: lanes.spike.identity.identity.consumer.frozenInstall,
      },
      manifestPaths: {
        baseline: lanes.baseline.manifestPath,
        spike: lanes.spike.manifestPath,
      },
      productBoundary,
      products: {
        baseline: packedLaneCapability(lanes.baseline),
        spike: packedLaneCapability(lanes.spike),
      },
      roots,
      source: { after, before, stable: true },
      tooling,
    };
  } catch (error) {
    try {
      cleanup();
    } catch (cleanupError) {
      throw new Error(`${errorMessage(error)}; ${errorMessage(cleanupError)}`);
    }
    throw error;
  }
}

export async function runDevGenerationSpike(options = {}, dependencies = {}) {
  const policy = normalizeOptions(options);
  const prepare = dependencies.prepare ?? prepareDevGenerationSpike;
  if (policy.prepareOnly) {
    const prepared = await prepare(policy, dependencies.preparationDependencies ?? {});
    try {
      return prepareReport(prepared, policy, dependencies);
    } finally {
      prepared.cleanup?.();
    }
  }

  const hostFingerprint = (dependencies.hostFingerprint ?? performanceHostFingerprint)();
  const sampleHost = dependencies.sampleHost ?? sampleHostLoad;
  const collectState = dependencies.collectState ?? collectWorktreeState;
  const runAdapter = dependencies.runAdapter ?? runDevLoopAdapter;
  const hostDiagnostics = [];
  const hostSamples = [];
  const cells = [];
  const errors = [];
  const schedule = devGenerationSchedule(policy);
  const allocatedPorts = schedule.flatMap((scheduled) => {
    const base = policy.portBase + scheduled.scheduleIndex * DEV_GENERATION_CELL_PORT_STRIDE;
    return Array.from({ length: scheduled.readySamples + 1 }, (_, index) => base + index);
  });
  const portAllocation = validateDevPortAllocationEvidence(
    await (dependencies.inspectPortAllocation ?? inspectDevPortAllocation)(
      { basePort: policy.portBase, inspectorPorts: [], ports: allocatedPorts },
      dependencies.portAllocationDependencies ?? {},
    ),
    { basePort: policy.portBase, inspectorPorts: [], ports: allocatedPorts },
  );
  if (!portAllocation.complete) {
    errors.push(...portAllocation.errors.map((error) => `dev port allocation preflight: ${error}`));
  }
  const hostAdmission = portAllocation.complete
    ? createDevGenerationHostAdmission({
        ceiling: policy.maxLoadPerCpu,
        maxWaitMs: policy.hostSettleMaxMs,
        pollMs: policy.hostSettlePollMs,
        sampleHost,
        wait: dependencies.waitForHost,
      })
    : null;
  if (hostAdmission !== null) {
    const initialHost = await hostAdmission.admit('pre-preparation');
    hostSamples.push(initialHost);
    if (!initialHost.comparable) {
      throw new Error(`${devGenerationHostFailure(initialHost)}; no timing process was started`);
    }
    hostAdmission.markBenchmarkWork();
  }

  const prepared = await prepare(policy, dependencies.preparationDependencies ?? {});
  const ephemeralScratch = policy.adapterEvidenceRoot === null;
  const scratch = ephemeralScratch
    ? mkdtempSync(path.join(os.tmpdir(), 'kovo-dev-generation-ab-'))
    : prepareAdapterEvidenceRoot(policy.adapterEvidenceRoot);
  try {
    if (portAllocation.complete && hostAdmission !== null) {
      const acquireLock = dependencies.acquireLock ?? acquireTimingLock;
      const timingLock = acquireLock(policy.timingLockPath);
      let adapterStarted = false;
      try {
        for (const scheduled of schedule) {
          const host = await hostAdmission.admit(
            `block-${String(scheduled.scheduleIndex)}-${scheduled.lane}`,
          );
          hostSamples.push(host);
          if (!host.comparable) {
            errors.push(
              `block ${String(scheduled.scheduleIndex)}: ${devGenerationHostFailure(host)}`,
            );
            break;
          }
          const root = prepared.roots[scheduled.lane];
          const beforeBlock = collectState(root);
          const expectedState = prepared.source.before[scheduled.lane];
          const stateFindings = worktreeStabilityFindings(
            expectedState,
            beforeBlock,
            scheduled.lane,
          );
          if (stateFindings.length > 0) {
            errors.push(...stateFindings);
            break;
          }
          const port = policy.portBase + scheduled.scheduleIndex * DEV_GENERATION_CELL_PORT_STRIDE;
          const resultFile = path.join(
            scratch,
            `${String(scheduled.scheduleIndex)}-${scheduled.lane}.json`,
          );
          let report;
          try {
            adapterStarted = true;
            report = await runAdapter({
              editSamples: scheduled.editSamples,
              manifestPath: prepared.manifestPaths[scheduled.lane],
              outPath: resultFile,
              packedProduct: prepared.products[scheduled.lane],
              port,
              readySamples: scheduled.readySamples,
              readyTimeoutMs: policy.readyTimeoutMs,
              root,
              timeoutMs: policy.timeoutMs,
              warmups: scheduled.warmups,
            });
          } catch (error) {
            const retainedFailure = retainedAdapterFailure(error);
            if (retainedFailure !== null) {
              const productBoundary = inspectDevGenerationProductBoundary(
                retainedFailure.report,
                prepared.products[scheduled.lane],
              );
              cells.push({
                ...scheduled,
                adapterFailure: retainedFailure.evidence,
                port,
                productBoundary,
                report: retainedFailure.report,
              });
            }
            errors.push(
              `block ${String(scheduled.scheduleIndex)} ${scheduled.lane}: ${errorMessage(error)}`,
            );
            break;
          }
          const productBoundary = inspectDevGenerationProductBoundary(
            report,
            prepared.products[scheduled.lane],
          );
          const cell = { ...scheduled, port, productBoundary, report };
          const findings = validateDevGenerationCell(cell, {
            commit: expectedState.commit,
            corpus: prepared.corpus[scheduled.lane],
            locks: expectedState.locks,
            product: prepared.products[scheduled.lane],
          });
          cells.push(cell);
          if (findings.length > 0) {
            errors.push(...findings);
            break;
          }
          const afterBlock = collectState(root);
          const afterFindings = worktreeStabilityFindings(
            expectedState,
            afterBlock,
            scheduled.lane,
          );
          if (afterFindings.length > 0) {
            errors.push(...afterFindings);
            break;
          }
        }
        if (adapterStarted) {
          // This is after every timed block. Keep the suite's own load tail, but do not use it to
          // retroactively reject blocks whose pre-timing admissions were quiet.
          hostDiagnostics.push(await hostAdmission.observe('post-timing'));
        }
      } finally {
        timingLock.release();
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
    if (errors.length === 0 && !analysis.acceptance.decisionSamplePolicy.complete) {
      errors.push(
        'measurement does not satisfy the preregistered packed v3 decision sample policy',
      );
    }
    const productBoundaryComplete =
      preparedProductBoundaryComplete(prepared) &&
      cells.length === schedule.length &&
      cells.every((cell) => cell.productBoundary?.complete === true);
    if (!productBoundaryComplete && !errors.some((error) => error.includes('packed product'))) {
      errors.push('packed v3 product boundary evidence is missing or drifted');
    }
    const complete =
      errors.length === 0 &&
      cells.length === schedule.length &&
      analysis.correctness.complete === true &&
      analysis.acceptance.decisionSamplePolicy.complete === true &&
      productBoundaryComplete &&
      hostSamples.every((sample) => sample.comparable);
    return {
      analysis,
      candidate: prepared.candidateBinding,
      cells,
      finishedAt: new Date().toISOString(),
      host: hostFingerprint,
      hostDiagnostics,
      hostSamples,
      integrity: {
        complete,
        errors,
        matchedCorpus: sameCorpus(prepared.corpus.baseline, prepared.corpus.spike),
        misses: analysis.correctness.misses,
        productBoundary: {
          complete: productBoundaryComplete,
          policy: DEV_GENERATION_PRODUCT_POLICY,
          verifiedCells: cells.filter((cell) => cell.productBoundary?.complete === true).length,
        },
        serialized: true,
        sourceStable: sourceFindings.length === 0,
      },
      policy: reportPolicy(policy),
      portAllocation,
      preparation: preparationEvidence(prepared),
      schema: DEV_GENERATION_SPIKE_SCHEMA,
      sourceAfter,
      startedAt: hostSamples[0]?.at ?? null,
      verdict: {
        reasons: [
          ...errors,
          ...(complete && !analysis.acceptance.candidateAccepted
            ? ['candidate did not satisfy every packed v3 causal win, p95 target, and guardrail']
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
    try {
      if (ephemeralScratch) rmSync(scratch, { force: true, recursive: true });
    } finally {
      prepared.cleanup?.();
    }
  }
}

export function parseDevGenerationSpikeArgs(argv) {
  const options = {};
  const booleanFlags = new Set(['--measure', '--prepare-only', '--quick-smoke']);
  const valueFlags = new Set([
    '--baseline-root',
    '--bootstrap-iterations',
    '--edit-samples',
    '--host-settle-max-ms',
    '--host-settle-poll-ms',
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
  const p95ImprovementPercent =
    baselineSummary.p95 === null || spikeSummary.p95 === null
      ? null
      : ((baselineSummary.p95 - spikeSummary.p95) / baselineSummary.p95) * 100;
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
    spikeP95ImprovementPercent: p95ImprovementPercent,
  };
}

function correctnessSummary(cells) {
  const state = Object.fromEntries(
    EDIT_CLASSES.map((editClass) => [editClass, { survived: 0, total: 0 }]),
  );
  let adapterErrors = 0;
  let adapterProcessFailures = 0;
  let adapterUnproven = 0;
  let browserRequestFailures = 0;
  let browserUnexpectedErrors = 0;
  let misses = 0;
  let productBoundaryFailures = 0;
  let syntaxDiagnostics = 0;
  for (const cell of cells) {
    const integrityErrors = cell.report?.integrity?.errors;
    adapterErrors += Array.isArray(integrityErrors) ? integrityErrors.length : 1;
    adapterProcessFailures += cell.adapterFailure === undefined ? 0 : 1;
    adapterUnproven +=
      cell.report?.integrity?.complete === true && cell.report?.verdict?.status === 'measured'
        ? 0
        : 1;
    misses += safeEvidenceCount(cell.report?.integrity?.misses) ?? 1;
    browserRequestFailures +=
      safeEvidenceCount(cell.report?.integrity?.browser?.requestFailedCount) ?? 1;
    browserUnexpectedErrors +=
      safeEvidenceCount(cell.report?.integrity?.browser?.unexpectedErrorCount) ?? 1;
    productBoundaryFailures += cell.productBoundary?.complete === true ? 0 : 1;
    for (const sample of evidenceRows(cell.report?.samples)) {
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
    (total, cell) => total + evidenceRows(cell.report?.samples).length,
    0,
  );
  const completeSchedule =
    cells.length === SCHEDULE_LANES.length &&
    cells.every(
      (cell, index) =>
        cell.scheduleIndex === index &&
        cell.lane === SCHEDULE_LANES[index] &&
        cell.occurrence === (index < 2 ? 0 : 1),
    );
  return {
    adapterErrors,
    adapterProcessFailures,
    adapterUnproven,
    browserRequestFailures,
    browserUnexpectedErrors,
    complete:
      completeSchedule &&
      adapterErrors === 0 &&
      adapterProcessFailures === 0 &&
      adapterUnproven === 0 &&
      misses === 0 &&
      browserRequestFailures === 0 &&
      browserUnexpectedErrors === 0 &&
      productBoundaryFailures === 0 &&
      stateLost === 0 &&
      syntaxDiagnostics === expectedSyntaxDiagnostics,
    completeSchedule,
    expectedCells: SCHEDULE_LANES.length,
    observedCells: cells.length,
    misses,
    productBoundaryFailures,
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

function noMedianAndP95RegressionOver(metric, percent) {
  const medianImprovement = metric?.spikeMedianImprovementPercent;
  const p95Improvement = metric?.spikeP95ImprovementPercent;
  return {
    maximumRegressionPercent: percent,
    median: {
      observedImprovementPercent: medianImprovement,
      passed: Number.isFinite(medianImprovement) && medianImprovement >= -percent,
    },
    p95: {
      observedImprovementPercent: p95Improvement,
      passed: Number.isFinite(p95Improvement) && p95Improvement >= -percent,
    },
    passed:
      Number.isFinite(medianImprovement) &&
      medianImprovement >= -percent &&
      Number.isFinite(p95Improvement) &&
      p95Improvement >= -percent,
  };
}

function candidateP95AtMost(metric, maximumMs) {
  const observedMs = metric?.spike?.p95;
  return {
    maximumMs,
    observedMs,
    passed: Number.isFinite(observedMs) && observedMs <= maximumMs,
  };
}

function inspectDecisionSamplePolicy(cells, policy) {
  const expected = {
    editSamplesPerLane: DECISION_EDIT_SAMPLES,
    readySamplesPerLane: DECISION_READY_SAMPLES,
    warmupsPerLane: DECISION_WARMUPS,
  };
  const declared = {
    editSamplesPerLane: policy.editSamples ?? null,
    readySamplesPerLane: policy.readySamples ?? null,
    warmupsPerLane: policy.warmups ?? null,
  };
  const expectedSchedule = devGenerationSchedule({
    editSamples: DECISION_EDIT_SAMPLES,
    readySamples: DECISION_READY_SAMPLES,
    warmups: DECISION_WARMUPS,
  });
  const observedSchedule = cells.map((cell) => ({
    editSamples: cell.editSamples,
    lane: cell.lane,
    occurrence: cell.occurrence,
    readySamples: cell.readySamples,
    scheduleIndex: cell.scheduleIndex,
    warmups: cell.warmups,
  }));
  const declaredComplete = sameJson(declared, expected);
  const observedComplete = sameJson(observedSchedule, expectedSchedule);
  return {
    complete: declaredComplete && observedComplete,
    declared,
    declaredComplete,
    expected,
    observedComplete,
    order: [...SCHEDULE_LANES],
  };
}

function prepareReport(prepared, policy, dependencies) {
  const errors = [
    ...(prepared.source.stable === true ? [] : ['source changed during packed v3 preparation']),
    ...(preparedProductBoundaryComplete(prepared)
      ? []
      : ['packed v3 preparation boundary evidence is missing or drifted']),
  ];
  const complete = errors.length === 0;
  return {
    candidate: prepared.candidateBinding,
    host: (dependencies.hostFingerprint ?? performanceHostFingerprint)(),
    integrity: {
      complete,
      errors,
      matchedCorpus: true,
      productBoundary: prepared.productBoundary,
      sourceStable: true,
    },
    mode: 'prepare-only',
    policy: reportPolicy(policy),
    preparation: preparationEvidence(prepared),
    schema: DEV_GENERATION_SPIKE_PREPARE_SCHEMA,
    verdict: { reasons: errors, status: complete ? 'prepared' : 'unproven' },
  };
}

function preparedProductBoundaryComplete(prepared) {
  return (
    prepared.productBoundary?.complete === true &&
    prepared.productBoundary?.schema === DEV_GENERATION_PRODUCT_BOUNDARY_SCHEMA &&
    prepared.productBoundary?.separateConsumersAndDescriptors === true &&
    prepared.productBoundary?.separatePreparationRoots === true &&
    canonicalJson(prepared.productBoundary?.policy) ===
      canonicalJson(DEV_GENERATION_PRODUCT_POLICY) &&
    canonicalJson(prepared.productBoundary?.identities?.baseline) ===
      canonicalJson(prepared.products?.baseline?.identity) &&
    canonicalJson(prepared.productBoundary?.identities?.spike) ===
      canonicalJson(prepared.products?.spike?.identity)
  );
}

function preparationEvidence(prepared) {
  return {
    corpus: prepared.corpus,
    frozenInstall: prepared.frozenInstall,
    productBoundary: prepared.productBoundary,
    source: prepared.source,
    tooling: prepared.tooling,
  };
}

function reportPolicy(policy) {
  return {
    adapterTimeoutMs: policy.timeoutMs,
    bootstrapIterations: policy.bootstrapIterations,
    editSamplesPerLane: policy.editSamples,
    hostAdmission: 'pre-preparation-and-pre-block-admission-with-post-timing-diagnostic/v1',
    hostSettleMaxTotalMs: policy.hostSettleMaxMs,
    hostSettlePollMs: policy.hostSettlePollMs,
    maxLoadPerCpu: policy.maxLoadPerCpu,
    order: [...SCHEDULE_LANES],
    portBase: policy.portBase,
    portStride: DEV_GENERATION_CELL_PORT_STRIDE,
    readySamplesPerLane: policy.readySamples,
    readyTimeoutMs: policy.readyTimeoutMs,
    rawAdapterEvidence: policy.adapterEvidenceRoot === null ? 'ephemeral' : '<out-dir>/raw',
    productBoundary: DEV_GENERATION_PRODUCT_POLICY,
    size: policy.size,
    timingAuthorization: policy.prepareOnly ? 'prepare-only' : 'explicit-measure',
    timingLock: '<os-temp>/kovo-performance-timing.lock',
    timingLockCoverage: 'pre-block-admission-through-post-timing-diagnostic/v1',
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
  const portBase = boundedInteger(
    options.portBase ?? DEFAULT_DEV_PORT_BASE,
    1_024,
    65_024,
    '--port-base',
  );
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
    hostSettleMaxMs: boundedInteger(
      options.hostSettleMaxMs ?? DEFAULT_HOST_SETTLE_MAX_MS,
      0,
      MAX_HOST_SETTLE_MAX_MS,
      '--host-settle-max-ms',
    ),
    hostSettlePollMs: boundedInteger(
      options.hostSettlePollMs ?? DEFAULT_HOST_SETTLE_POLL_MS,
      10,
      60_000,
      '--host-settle-poll-ms',
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
      '--packed-product',
      options.packedProduct.descriptorPath,
      '--packed-product-digest',
      options.packedProduct.identity.digest,
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
    const error = new Error(
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
    error.adapterFailure = createAdapterFailureEvidence(result, adapterEvidence);
    throw error;
  }
  if (adapterEvidence.error !== null) {
    const error = new Error(adapterEvidence.error);
    error.adapterFailure = createAdapterFailureEvidence(result, adapterEvidence);
    throw error;
  }
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
    return {
      custody: { available: false, reportBytes: null, reportSha256: null },
      error: message,
      failureDiagnostic: message,
      report: null,
      summary: null,
    };
  }
  const custody = {
    available: true,
    reportBytes: bytes.byteLength,
    reportSha256: sha256(bytes),
  };
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_REPORT_BYTES) {
    const message = 'dev-loop adapter report is empty or exceeds its evidence bound';
    return { custody, error: message, failureDiagnostic: message, report: null, summary: null };
  }
  let report;
  try {
    report = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    const message = `dev-loop adapter report is invalid JSON: ${errorMessage(error)}`;
    return { custody, error: message, failureDiagnostic: message, report: null, summary: null };
  }
  const summary = summarizeFailedAdapterReport(report, bytes);
  return {
    custody,
    error: null,
    failureDiagnostic: JSON.stringify(summary),
    report,
    summary,
  };
}

export function summarizeFailedAdapterReport(report, bytes) {
  const integrityErrors = Array.isArray(report?.integrity?.errors) ? report.integrity.errors : [];
  const readySamples = Array.isArray(report?.readySamples) ? report.readySamples : [];
  return {
    browserRequestFailures: safeEvidenceCount(report?.integrity?.browser?.requestFailedCount),
    browserUnexpectedErrors: safeEvidenceCount(report?.integrity?.browser?.unexpectedErrorCount),
    editSessionError:
      report?.editSession?.error === null || report?.editSession?.error === undefined
        ? null
        : boundedDiagnostic(String(report.editSession.error)),
    integrityErrors: integrityErrors.slice(0, 12).map((error) => boundedDiagnostic(String(error))),
    misses: safeEvidenceCount(report?.integrity?.misses),
    readyFailures: readySamples
      .filter((sample) => sample?.success !== true)
      .slice(0, 12)
      .map((sample) => ({
        error:
          sample?.error === null || sample?.error === undefined
            ? null
            : boundedDiagnostic(String(sample.error)),
        iteration: Number.isSafeInteger(sample?.iteration) ? sample.iteration : null,
      })),
    reportBytes: bytes.byteLength,
    reportSha256: sha256(bytes),
    schema: optionalEvidenceLabel(report?.schema),
    verdict: optionalEvidenceLabel(report?.verdict?.status),
  };
}

function createAdapterFailureEvidence(result, adapterEvidence) {
  return {
    evidence: validateAdapterFailureEvidence({
      process: {
        error: result.error === undefined ? null : boundedDiagnostic(errorMessage(result.error)),
        signal: result.signal == null ? null : String(result.signal),
        status: Number.isSafeInteger(result.status) ? result.status : null,
      },
      rawReport: {
        ...adapterEvidence.custody,
        schema: optionalEvidenceLabel(adapterEvidence.report?.schema),
        verdict: optionalEvidenceLabel(adapterEvidence.report?.verdict?.status),
      },
      schema: DEV_GENERATION_ADAPTER_FAILURE_SCHEMA,
      summary: adapterEvidence.summary,
    }),
    report: adapterEvidence.report,
  };
}

function retainedAdapterFailure(error) {
  const value = error?.adapterFailure;
  if (value === null || typeof value !== 'object') return null;
  return {
    evidence: validateAdapterFailureEvidence(value.evidence),
    report: value.report ?? null,
  };
}

function validateAdapterFailureEvidence(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    value.schema !== DEV_GENERATION_ADAPTER_FAILURE_SCHEMA ||
    value.process === null ||
    typeof value.process !== 'object' ||
    !(value.process.error === null || nonEmptyString(value.process.error)) ||
    !(value.process.signal === null || nonEmptyString(value.process.signal)) ||
    !(value.process.status === null || Number.isSafeInteger(value.process.status)) ||
    value.rawReport === null ||
    typeof value.rawReport !== 'object' ||
    typeof value.rawReport.available !== 'boolean' ||
    !(value.rawReport.schema === null || boundedEvidenceLabel(value.rawReport.schema)) ||
    !(value.rawReport.verdict === null || boundedEvidenceLabel(value.rawReport.verdict))
  ) {
    throw new TypeError('failed dev-loop adapter evidence is malformed');
  }
  if (
    !(
      value.summary === null ||
      (typeof value.summary === 'object' && !Array.isArray(value.summary))
    ) ||
    Buffer.byteLength(JSON.stringify(value.summary ?? null)) > 64 * 1024
  ) {
    throw new TypeError('failed dev-loop adapter summary exceeds its evidence bound');
  }
  if (
    value.rawReport.available
      ? !Number.isSafeInteger(value.rawReport.reportBytes) ||
        value.rawReport.reportBytes < 0 ||
        !/^sha256:[0-9a-f]{64}$/u.test(value.rawReport.reportSha256 ?? '')
      : value.rawReport.reportBytes !== null || value.rawReport.reportSha256 !== null
  ) {
    throw new TypeError('failed dev-loop raw report custody is malformed');
  }
  return structuredClone(value);
}

function safeEvidenceCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function evidenceRows(value) {
  return Array.isArray(value) ? value : [];
}

function optionalEvidenceLabel(value) {
  return boundedEvidenceLabel(value) ? value : null;
}

function boundedEvidenceLabel(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    !value.includes('\r') &&
    !value.includes('\n') &&
    !value.includes('\0')
  );
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
    packedProductIdentitySchema: PACKED_KOVO_PRODUCT_IDENTITY_SCHEMA,
    packedProductPreparationSha256: sha256(
      readFileSync(path.join(root, 'scripts/perf-cli-startup-benchmark.mjs')),
    ),
    packedProductVerifierSha256: sha256(
      readFileSync(path.join(root, 'scripts/lib/perf-packed-kovo-product.mjs')),
    ),
    productPolicySchema: DEV_GENERATION_PRODUCT_POLICY_SCHEMA,
    readyRouteValidatorSha256: sha256(
      readFileSync(path.join(root, 'scripts/lib/perf-ready-route.mjs')),
    ),
  };
}

function sameCorpus(left, right) {
  const comparable = (value) => ({
    devPortAllocationPosture: value.devPortAllocationPosture,
    editClasses: value.editClasses,
    editSavePosture: value.editSavePosture,
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

async function preparePackedDevGenerationLane(options, dependencies = {}) {
  const collectState = dependencies.collectState ?? collectWorktreeState;
  const inspectCorpus = dependencies.inspectCorpus ?? verifyGeneratedDevCorpus;
  const externalRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), `kovo-dev-generation-packed-${options.lane}-`)),
  );
  let prepared = null;
  let fixture = null;
  try {
    const preparationModule = await import(
      pathToFileURL(path.join(options.root, 'scripts/perf-cli-startup-benchmark.mjs')).href
    );
    const packedModule = await import(
      pathToFileURL(path.join(options.root, 'scripts/lib/perf-packed-kovo-product.mjs')).href
    );
    const generatorModule = await import(
      pathToFileURL(path.join(options.root, 'benchmarks/corpora/generate.mjs')).href
    );
    if (
      packedModule.PACKED_KOVO_PRODUCT_IDENTITY_SCHEMA !== PACKED_KOVO_PRODUCT_IDENTITY_SCHEMA ||
      typeof preparationModule.preparePackedCliBenchmark !== 'function' ||
      typeof packedModule.createPackedKovoProductFixture !== 'function' ||
      typeof generatorModule.generateCorpus !== 'function'
    ) {
      throw new Error(`${options.lane} packed-product tooling schema or API drift`);
    }
    prepared = await preparationModule.preparePackedCliBenchmark({
      installTimeoutMs: options.installTimeoutMs,
    });
    const sourceAfterPreparation = collectState(options.root);
    fixture = packedModule.createPackedKovoProductFixture({
      prepared,
      source: options.source,
      sourceAfter: sourceAfterPreparation,
    });
    const verifiedProduct = packedModule.verifyPackedKovoProductFixture(
      fixture.descriptorPath,
      fixture.identity.digest,
      sourceAfterPreparation,
    );
    const manifestPath = await generatorModule.generateCorpus(
      devGenerationPackedCorpusOptions(externalRoot, options.size),
    );
    packedModule.assertPackedCorpusIsolation(path.dirname(manifestPath));
    fixture.bindCorpus(manifestPath);
    const corpus = await inspectCorpus(manifestPath, options.root, externalRoot);
    let cleaned = false;
    return {
      cleanup() {
        if (cleaned) return;
        cleaned = true;
        const errors = [];
        try {
          fixture.cleanup();
        } catch (error) {
          errors.push(errorMessage(error));
        }
        try {
          rmSync(externalRoot, { force: true, recursive: true });
        } catch (error) {
          errors.push(errorMessage(error));
        }
        if (errors.length > 0) throw new Error(errors.join('; '));
      },
      consumerRoot: verifiedProduct.consumerRoot,
      corpus,
      descriptorPath: fixture.descriptorPath,
      externalRoot,
      identity: fixture.identity,
      manifestPath,
      sourceAfter: sourceAfterPreparation,
      tooling: toolingEvidence(options.root),
    };
  } catch (error) {
    try {
      if (fixture !== null) fixture.cleanup();
      else prepared?.cleanup();
    } finally {
      rmSync(externalRoot, { force: true, recursive: true });
    }
    throw error;
  }
}

function validatePreparedPackedLane(value, expected) {
  if (
    typeof value?.cleanup !== 'function' ||
    !nonEmptyString(value?.consumerRoot) ||
    !nonEmptyString(value?.descriptorPath) ||
    !nonEmptyString(value?.manifestPath) ||
    value?.corpus?.modules !== expected.size
  ) {
    throw new Error(`${expected.lane} packed product preparation is incomplete`);
  }
  const externalRoot = canonicalDirectory(value.externalRoot);
  const manifestPath = realpathSync(value.manifestPath);
  const consumerRoot = canonicalDirectory(value.consumerRoot);
  const descriptorPath = path.resolve(value.descriptorPath);
  const descriptorStat = lstatSync(descriptorPath);
  if (
    !descriptorStat.isFile() ||
    descriptorStat.isSymbolicLink() ||
    path.dirname(realpathSync(descriptorPath)) !== consumerRoot
  ) {
    throw new Error(
      `${expected.lane} packed product descriptor is not a regular file in its own consumer root`,
    );
  }
  if (!isWithin(externalRoot, manifestPath)) {
    throw new Error(`${expected.lane} corpus does not live below its fresh external root`);
  }
  assertPackedCorpusIsolation(path.dirname(manifestPath));
  const identityFindings = packedKovoProductIdentityFindings(value.identity, value.sourceAfter);
  if (identityFindings.length > 0) {
    throw new Error(`${expected.lane} packed product identity: ${identityFindings.join('; ')}`);
  }
  if (
    value.tooling?.packedProductIdentitySchema !== PACKED_KOVO_PRODUCT_IDENTITY_SCHEMA ||
    value.tooling?.productPolicySchema !== DEV_GENERATION_PRODUCT_POLICY_SCHEMA
  ) {
    throw new Error(`${expected.lane} packed product tooling policy drift`);
  }
}

function packedLaneCapability(lane) {
  return {
    descriptorPath: lane.descriptorPath,
    externalRoot: lane.externalRoot,
    identity: lane.identity,
    manifestPath: lane.manifestPath,
    policy: DEV_GENERATION_PRODUCT_POLICY,
  };
}

function sameFileIdentity(left, right) {
  return (
    Number.isSafeInteger(left?.dev) &&
    Number.isSafeInteger(left?.ino) &&
    left.dev === right?.dev &&
    left.ino === right?.ino
  );
}

async function verifyGeneratedDevCorpus(manifestPath, root, containmentRoot = root) {
  const adapterPath = path.join(root, 'benchmarks', 'corpora', 'dev-loop.mjs');
  const adapter = await import(pathToFileURL(adapterPath).href);
  const loaded = await adapter.loadCorpusManifest(manifestPath);
  await adapter.verifyCorpusSources(loaded);
  return inspectGeneratedDevCorpus(manifestPath, containmentRoot);
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

function gitPatchId(root, from, to) {
  const patch = gitPatchBytes(root, from, to);
  const result = spawnSync('git', ['patch-id', '--stable'], {
    encoding: 'utf8',
    input: patch,
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

/**
 * Admit the host once before preparation, then settle preparation and prior-block load outside each
 * adapter's timing window. A single wait budget covers the entire B,S,S,B run, preventing either an
 * unbounded delay or a per-block timeout multiplier. Post-timing load is observed without waiting
 * or gating because it cannot establish contention before a completed timed block.
 */
export function createDevGenerationHostAdmission({
  ceiling,
  maxWaitMs = DEFAULT_HOST_SETTLE_MAX_MS,
  pollMs = DEFAULT_HOST_SETTLE_POLL_MS,
  sampleHost = sampleHostLoad,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  assertDevGenerationHostPolicy({ ceiling, maxWaitMs, pollMs });
  const budget = { remainingWaitMs: maxWaitMs, totalWaitedMs: 0 };
  let benchmarkWorkStarted = false;
  async function sample(label, { gatesTiming }) {
    if (!boundedEvidenceLabel(label)) {
      throw new TypeError('quiet-host label is invalid');
    }
    const availableWaitMs = gatesTiming ? budget.remainingWaitMs : 0;
    const observations = [];
    let attempt = 0;
    let waitedMs = 0;
    while (true) {
      const raw = sampleHost(label, ceiling);
      const loadAverage = raw?.loadAverage;
      const cpuCount = raw?.cpuCount;
      const loadPerCpu =
        Array.isArray(loadAverage) &&
        Number.isFinite(loadAverage[0]) &&
        Number.isSafeInteger(cpuCount) &&
        cpuCount > 0
          ? loadAverage[0] / cpuCount
          : null;
      const comparable = Number.isFinite(loadPerCpu) && loadPerCpu >= 0 && loadPerCpu <= ceiling;
      const observation = {
        ...raw,
        attempt,
        ceiling,
        comparable,
        gatesTiming,
        label,
        loadPerCpu,
        phase: gatesTiming
          ? benchmarkWorkStarted
            ? 'quiet-host-settle'
            : 'quiet-host-admission'
          : 'host-diagnostic',
        posture: gatesTiming
          ? benchmarkWorkStarted
            ? 'post-benchmark'
            : 'pre-benchmark'
          : 'post-timing',
        waitedMs,
      };
      observations.push(observation);
      if (comparable || !gatesTiming || waitedMs >= availableWaitMs) {
        return {
          ...observation,
          settle: {
            maxWaitMs: availableWaitMs,
            observations,
            pollMs,
            rejectedObservations: observations.filter((entry) => !entry.comparable).length,
            totalBudgetRemainingMs: budget.remainingWaitMs,
            waitedMs,
          },
        };
      }
      const waitMs = Math.min(pollMs, availableWaitMs - waitedMs);
      await wait(waitMs);
      waitedMs += waitMs;
      budget.remainingWaitMs = Math.max(0, budget.remainingWaitMs - waitMs);
      budget.totalWaitedMs += waitMs;
      attempt += 1;
    }
  }
  return {
    admit(label) {
      return sample(label, { gatesTiming: true });
    },
    markBenchmarkWork() {
      benchmarkWorkStarted = true;
    },
    observe(label) {
      return sample(label, { gatesTiming: false });
    },
    policy() {
      return {
        ceiling,
        maxTotalWaitMs: maxWaitMs,
        pollMs,
        remainingWaitMs: budget.remainingWaitMs,
        totalWaitedMs: budget.totalWaitedMs,
      };
    },
  };
}

function assertDevGenerationHostPolicy({ ceiling, maxWaitMs, pollMs }) {
  finitePositiveNumber(ceiling, '--max-load-per-cpu');
  boundedInteger(maxWaitMs, 0, MAX_HOST_SETTLE_MAX_MS, '--host-settle-max-ms');
  boundedInteger(pollMs, 10, 60_000, '--host-settle-poll-ms');
}

function devGenerationHostFailure(sample) {
  const observed = Number.isFinite(sample.loadPerCpu)
    ? sample.loadPerCpu.toFixed(3)
    : 'unavailable';
  return `${sample.posture} host load ${observed} per CPU exceeded ceiling ${String(
    sample.ceiling,
  )} after bounded ${String(sample.settle?.waitedMs ?? 0)}ms quiet-host admission`;
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

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
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
