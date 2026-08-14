#!/usr/bin/env node
/**
 * Authenticated hosted A/B decision for the profile-driven lexical-scope declaration index.
 *
 * This runner measures only clean Kovo product builds. Each arm is a clean committed worktree,
 * builds and freezes its own packed release closure, and runs an externally rooted corpus whose
 * actual `kovo` command resolves into that packed consumer. The candidate is reapplied as one exact
 * direct commit over the measurement source; neither workspace source loading nor bundle proxies
 * can enter the acceptance decision.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { canonicalJson, performanceHostFingerprint } from './lib/perf-host.mjs';
import {
  assertPackedCorpusIsolation,
  PACKED_KOVO_PRODUCT_IDENTITY_SCHEMA,
  PACKED_KOVO_PRODUCT_WORKLOAD_POLICY,
  PACKED_KOVO_PRODUCT_WORKLOAD_POLICY_SCHEMA,
  packedKovoProductIdentityFindings,
} from './lib/perf-packed-kovo-product.mjs';

export const BUILD_SOURCE_TRUST_SPIKE_SCHEMA = 'kovo-build-source-trust-spike/v1';
export const BUILD_SOURCE_TRUST_FAILURE_SCHEMA = 'kovo-build-source-trust-spike-failure/v1';
export const BUILD_SOURCE_TRUST_CANDIDATE_BINDING_SCHEMA =
  'kovo-build-source-trust-candidate-binding/v1';
export const BUILD_SOURCE_TRUST_ARTIFACT_SCHEMA = 'kovo-build-output-tree/v1';
export const BUILD_SOURCE_TRUST_BOUNDARY_POLICY_SCHEMA =
  'kovo-build-source-trust-boundary-policy/v1';
export const BUILD_SOURCE_TRUST_BOUNDARY_POLICY = Object.freeze({
  concreteIdentity: 'report-bound-per-arm',
  corpusIsolation: PACKED_KOVO_PRODUCT_WORKLOAD_POLICY.corpusIsolation,
  hostAdmission: 'before-preparation-and-before-every-measured-block',
  kovo: 'required',
  nextjs: 'forbidden-zero-cells',
  preparationTiming: 'after-preparation-host-admission-and-outside-samples',
  productIdentitySchema: PACKED_KOVO_PRODUCT_IDENTITY_SCHEMA,
  schema: BUILD_SOURCE_TRUST_BOUNDARY_POLICY_SCHEMA,
  sharedIsolationPolicySchema: PACKED_KOVO_PRODUCT_WORKLOAD_POLICY_SCHEMA,
  timedWarmups: 0,
});
export const BUILD_SOURCE_TRUST_CANDIDATE = Object.freeze({
  commit: 'c89e179a9e9b179dd75b0bebabd357f4aa9e36a6',
  parent: '4ffd0b24c27f72b9e1b6250a267de325564a4d6f',
  patchBytes: 18_234,
  patchId: 'c8be3545899c135489152f0a82322b64a3208768',
  patchSha256: 'sha256:0beca6e2ee833234dc85040d52644d3d7c10b65d3ddbe1199560507d53cd6253',
  pathChanges: Object.freeze([
    Object.freeze({
      path: 'packages/compiler/src/scan/lexical-scope-declaration-index.test.ts',
      status: 'A',
    }),
    Object.freeze({ path: 'packages/compiler/src/scan/parse.ts', status: 'M' }),
    Object.freeze({ path: 'scripts/check-security-classifier-corpus.mjs', status: 'M' }),
    Object.freeze({ path: 'security/security-carrier-grammar.json', status: 'M' }),
  ]),
  tree: 'bad908875754f4fe748d5e62f5ca9b3f61b7a7e5',
});

const BUILD_ADAPTER_SCHEMA = 'kovo-build-benchmark/v1';
const CORPUS_SCHEMA = 'kovo-dev-corpus/v1';
const PACKED_PRODUCT_SCHEMA = PACKED_KOVO_PRODUCT_IDENTITY_SCHEMA;
const PHASE_ATTRIBUTION_SCHEMA = 'kovo-build-phase-attribution/v1';
const SOURCE_PHASE_SCHEMA = 'kovo-build-source-phase-census/v1';
const WORKER_PHASE_SCHEMA = 'kovo-build-worker-phase-census/v1';
const SOURCE_PHASES = Object.freeze([
  'lifecycle-policy',
  'config-trust',
  'typescript',
  'project-quality',
  'sound-subset',
  'session-authority',
  'app-source-trust',
  'stylesheet',
  'app-evaluation',
  'build-check-graph',
  'graph-diagnostics',
]);
const WORKER_PHASES = Object.freeze(['analyze', 'client', 'server', 'final']);
const LOCK_FILES = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);
const SCHEDULE_PATTERN = Object.freeze(['baseline', 'spike', 'spike', 'baseline']);
const SUPPORTED_SIZES = Object.freeze([24, 216]);
const DECISION_REPETITIONS = 5;
const DECISION_SAMPLES_PER_ARM = 10;
const DEFAULT_BOOTSTRAP_ITERATIONS = 10_000;
const DEFAULT_HOST_SETTLE_MAX_MS = 30_000;
const DEFAULT_HOST_SETTLE_POLL_MS = 1_000;
const MAX_HOST_SETTLE_MAX_MS = 60_000;
const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_RAW_REPORT_BYTES = 64 * 1024 * 1024;
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export function buildSourceTrustSchedule(repetitions = DECISION_REPETITIONS) {
  boundedInteger(repetitions, 1, DECISION_REPETITIONS, 'repetitions');
  const occurrences = { baseline: 0, spike: 0 };
  const schedule = [];
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (const [position, lane] of SCHEDULE_PATTERN.entries()) {
      schedule.push({
        lane,
        occurrence: occurrences[lane]++,
        position,
        repetition,
        scheduleIndex: schedule.length,
      });
    }
  }
  return schedule;
}

export function summarizeBuildSourceTrustMetric(values) {
  const numbers = values.filter(finitePositive).sort((left, right) => left - right);
  if (numbers.length === 0) return { count: 0, mad: null, median: null, p95: null };
  const median = percentile(numbers, 50);
  const deviations = numbers
    .map((value) => Math.abs(value - median))
    .sort((left, right) => left - right);
  return {
    count: numbers.length,
    mad: percentile(deviations, 50),
    median,
    p95: percentile(numbers, 95),
  };
}

export function pairedBuildSourceTrustBootstrap(
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
    medians.push(
      percentile(
        resample.sort((left, right) => left - right),
        50,
      ),
    );
  }
  medians.sort((left, right) => left - right);
  return [percentile(medians, 2.5), percentile(medians, 97.5)];
}

export function authenticateBuildSourceTrustRoots(options, dependencies = {}) {
  const git = dependencies.git ?? gitOutput;
  const patch = dependencies.patch ?? gitPatchBytes;
  const patchId = dependencies.patchId ?? gitPatchId;
  const candidate = options.candidate ?? BUILD_SOURCE_TRUST_CANDIDATE;
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
  const candidateTree = git(candidateRepository, ['rev-parse', `${candidate.commit}^{tree}`]);
  if (
    candidateCommit !== candidate.commit ||
    candidateParent !== candidate.parent ||
    candidateTree !== candidate.tree
  ) {
    throw new Error('source-trust candidate object identity is unavailable or unexpected');
  }

  const expectedPatch = patch(candidateRepository, candidate.parent, candidate.commit);
  const observedPatch = patch(spikeRoot, baselineCommit, spikeCommit);
  const expectedPatchSha256 = sha256(expectedPatch);
  const observedPatchSha256 = sha256(observedPatch);
  const expectedPatchId = patchId(candidateRepository, candidate.commit);
  const observedPatchId = patchId(spikeRoot, spikeCommit);
  if (
    expectedPatch.byteLength !== candidate.patchBytes ||
    expectedPatchSha256 !== candidate.patchSha256 ||
    expectedPatchId !== candidate.patchId ||
    observedPatch.byteLength !== candidate.patchBytes ||
    observedPatchSha256 !== candidate.patchSha256 ||
    observedPatchId !== candidate.patchId ||
    !observedPatch.equals(expectedPatch)
  ) {
    throw new Error(
      `spike patch does not exactly match ${candidate.commit}: expected ${candidate.patchBytes}/${candidate.patchSha256}/${candidate.patchId}, observed ${observedPatch.byteLength}/${observedPatchSha256}/${observedPatchId}`,
    );
  }
  const observedPathChanges = changedPathCensus(spikeRoot, baselineCommit, spikeCommit, git);
  if (canonicalJson(observedPathChanges) !== canonicalJson(candidate.pathChanges)) {
    throw new Error(
      `spike path census differs from source-trust candidate: ${canonicalJson(observedPathChanges)}`,
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
      pathChanges: candidate.pathChanges.map((entry) => ({ ...entry })),
      tree: candidate.tree,
    },
    schema: BUILD_SOURCE_TRUST_CANDIDATE_BINDING_SCHEMA,
    spike: { commit: spikeCommit, parent: baselineCommit, root: spikeRoot },
  };
}

export function inspectBuildSourceTrustArtifact(corpusRootValue, outputContract) {
  const corpusRoot = canonicalDirectory(corpusRootValue);
  const outputs = validateOutputContract(outputContract);
  const entries = [];
  for (const output of outputs.requiredNonempty) {
    for (const target of resolveOutputTargets(corpusRoot, output)) {
      artifactEntries(corpusRoot, target, entries);
    }
  }
  entries.sort((left, right) => bytewise(left.path, right.path));
  if (entries.length === 0 || !entries.some((entry) => entry.type === 'file')) {
    throw new Error('build artifact tree is empty');
  }
  const absent = outputs.absent.flatMap((output) =>
    resolveOutputTargets(corpusRoot, output).map((target) => portablePath(corpusRoot, target)),
  );
  if (absent.length > 0) {
    throw new Error(`forbidden build output remains: ${absent.join(', ')}`);
  }
  const totalBytes = entries.reduce(
    (total, entry) => total + (entry.type === 'file' ? entry.bytes : 0),
    0,
  );
  const identity = {
    entries,
    requiredOutputs: outputs.requiredNonempty,
    schema: BUILD_SOURCE_TRUST_ARTIFACT_SCHEMA,
    totalBytes,
  };
  return { ...identity, digest: sha256(Buffer.from(canonicalJson(identity))) };
}

export function sameBuildSourceTrustCorpusWorkload(left, right) {
  return (
    canonicalJson(crossArmCorpusIdentity(left)) === canonicalJson(crossArmCorpusIdentity(right))
  );
}

export function buildSourceTrustBoundaryPolicyFindings(value) {
  return canonicalJson(value) === canonicalJson(BUILD_SOURCE_TRUST_BOUNDARY_POLICY)
    ? []
    : ['build source-trust boundary policy or measurement order is incomplete'];
}

export function buildSourceTrustNonTimingDiagnostics(report) {
  const sample = report?.samples?.[0];
  const attribution = sample?.phaseAttribution;
  const source = sample?.phaseCensus?.source;
  const workers = sample?.phaseCensus?.workers;
  return {
    attribution: {
      cliStartupTail: {
        source: attribution?.cliStartupTail?.source ?? null,
        status: attribution?.cliStartupTail?.status ?? null,
      },
      complete: attribution?.complete ?? null,
      errors: attribution?.errors ?? null,
      phaseEnvelope: {
        phases: attribution?.phaseEnvelope?.phases ?? null,
        source: attribution?.phaseEnvelope?.source ?? null,
        status: attribution?.phaseEnvelope?.status ?? null,
      },
      schema: attribution?.schema ?? null,
      sourceCheck: attribution?.sourceCheck ?? null,
    },
    source: {
      checkGraphDigest: source?.checkGraphDigest ?? null,
      complete: source?.complete ?? null,
      phases: normalizePhaseSequence(source?.phases),
      schema: source?.schema ?? null,
      source: source?.source ?? null,
      sourceSetDigest: source?.sourceSetDigest ?? null,
    },
    workers: {
      complete: workers?.complete ?? null,
      phases: normalizePhaseSequence(workers?.phases),
      schema: workers?.schema ?? null,
      sourcePath: workers?.sourcePath ?? null,
    },
  };
}

export function validateBuildSourceTrustCell(cell, expected) {
  const findings = [];
  const report = cell?.report;
  const label = `${String(cell?.scheduleIndex)}:${String(cell?.lane)}`;
  if (report?.schema !== BUILD_ADAPTER_SCHEMA) findings.push(`${label} adapter schema mismatch`);
  if (report?.framework !== 'kovo' || report?.mode !== 'clean') {
    findings.push(`${label} is not a clean Kovo build`);
  }
  if (
    report?.integrity?.complete !== true ||
    report?.integrity?.iterations !== 1 ||
    report?.integrity?.warmups !== 0 ||
    report?.integrity?.misses !== 0 ||
    !Array.isArray(report?.integrity?.errors) ||
    report.integrity.errors.length !== 0
  ) {
    findings.push(`${label} adapter evidence is incomplete`);
  }
  if (
    report?.source?.commit !== expected.commit ||
    report?.source?.dirty !== false ||
    report?.sourceAfter?.commit !== expected.commit ||
    report?.sourceAfter?.dirty !== false ||
    report?.integrity?.source?.stable !== true ||
    canonicalJson(report?.source?.locks) !== canonicalJson(expected.source.locks) ||
    canonicalJson(report?.sourceAfter?.locks) !== canonicalJson(expected.source.locks)
  ) {
    findings.push(`${label} source or lock provenance changed`);
  }
  if (
    report?.corpus?.schema !== CORPUS_SCHEMA ||
    report?.corpus?.modules !== expected.corpus.modules ||
    report?.corpus?.routes !== expected.corpus.routes ||
    report?.corpus?.shapeDigest !== expected.corpus.shapeDigest ||
    report?.corpus?.sourceDigest !== expected.corpus.sourceDigest ||
    report?.corpus?.manifestDigest !== expected.corpus.manifestDigest
  ) {
    findings.push(`${label} corpus identity mismatch`);
  }
  findings.push(
    ...buildSourceTrustBoundaryPolicyFindings(expected.corpus?.boundary?.policy).map(
      (finding) => `${label} ${finding}`,
    ),
  );
  const expectedCommand = {
    argv: ['node', '<packed-kovo>/node_modules/@kovojs/cli/dist/bin.mjs', 'build', './src/app.tsx'],
    cwd: '.',
    env: {},
    productArtifactDigest: expected.product.digest,
  };
  if (
    canonicalJson(report?.integrity?.outputRoots) !==
      canonicalJson(expected.corpus.build.outputs) ||
    canonicalJson(report?.integrity?.command) !== canonicalJson(expectedCommand)
  ) {
    findings.push(`${label} command or output contract differs from the authenticated corpus`);
  }
  const productIntegrity = report?.integrity?.productArtifact;
  const productFindings = packedKovoProductIdentityFindings(
    report?.productArtifact,
    expected.source,
  );
  if (
    productFindings.length > 0 ||
    productIntegrity?.required !== true ||
    productIntegrity?.beforeVerified !== true ||
    productIntegrity?.afterVerified !== true ||
    report?.productArtifact?.schema !== PACKED_PRODUCT_SCHEMA ||
    report?.productArtifact?.identity?.schema !== PACKED_PRODUCT_SCHEMA ||
    canonicalJson(report?.productArtifact) !== canonicalJson(expected.product) ||
    report?.integrity?.command?.productArtifactDigest !== expected.product.digest
  ) {
    findings.push(`${label} exact packed Kovo product evidence is unavailable`);
  }
  if (
    cell?.processFailure !== null ||
    !Array.isArray(report?.samples) ||
    report.samples.length !== 1 ||
    !finitePositive(report.samples[0]?.durationMs) ||
    !finitePositive(report.samples[0]?.peakRssBytes) ||
    report.samples[0]?.exitCode !== 0 ||
    report.samples[0]?.outputCensus?.complete !== true ||
    report.samples[0]?.phaseAttribution?.complete !== true
  ) {
    findings.push(`${label} measured sample is incomplete`);
  }
  if (
    cell?.artifact?.schema !== BUILD_SOURCE_TRUST_ARTIFACT_SCHEMA ||
    cell?.artifact?.totalBytes !== report?.samples?.[0]?.artifactBytes ||
    cell?.artifact?.totalBytes !== report?.summary?.artifactBytes ||
    !digest(cell?.artifact?.digest)
  ) {
    findings.push(`${label} exact output tree evidence is incomplete`);
  }
  const diagnostics = buildSourceTrustNonTimingDiagnostics(report);
  if (
    diagnostics.attribution.schema !== PHASE_ATTRIBUTION_SCHEMA ||
    diagnostics.attribution.complete !== true ||
    canonicalJson(diagnostics.attribution.errors) !== canonicalJson([]) ||
    canonicalJson(diagnostics.attribution.phaseEnvelope.phases) !== canonicalJson(WORKER_PHASES) ||
    canonicalJson(diagnostics.attribution.sourceCheck?.phases) !== canonicalJson(SOURCE_PHASES) ||
    diagnostics.source.schema !== SOURCE_PHASE_SCHEMA ||
    diagnostics.workers.schema !== WORKER_PHASE_SCHEMA ||
    canonicalJson(diagnostics.source.phases.map((phase) => phase.name)) !==
      canonicalJson(SOURCE_PHASES) ||
    canonicalJson(diagnostics.workers.phases.map((phase) => phase.name)) !==
      canonicalJson(WORKER_PHASES)
  ) {
    findings.push(`${label} build phase sequence is incomplete`);
  }
  if (
    cell?.raw?.retained !== true ||
    !Number.isSafeInteger(cell?.raw?.bytes) ||
    cell.raw.bytes <= 0 ||
    !digest(cell?.raw?.sha256) ||
    !nonEmptyString(cell?.raw?.path)
  ) {
    findings.push(`${label} raw adapter report was not retained`);
  }
  return findings;
}

export function aggregateBuildSourceTrustCells(cells, policy) {
  const byLane = { baseline: [], spike: [] };
  for (const cell of cells) {
    if (byLane[cell?.lane] !== undefined) byLane[cell.lane].push(cell);
  }
  for (const lane of Object.keys(byLane)) {
    byLane[lane].sort((left, right) => left.occurrence - right.occurrence);
  }
  const duration = pairedMetric(byLane, (cell) => cell.report?.samples?.[0]?.durationMs, policy);
  const peakRssBytes = pairedMetric(byLane, (cell) => cell.report?.samples?.[0]?.peakRssBytes, {
    ...policy,
    seed: policy.seed + 1,
  });
  const schedule = inspectBuildSourceTrustDecisionSchedule(cells, policy);
  const artifactIdentities = uniqueCanonical(cells.map((cell) => cell.artifact));
  const diagnosticIdentities = uniqueCanonical(
    cells.map((cell) => buildSourceTrustNonTimingDiagnostics(cell.report)),
  );
  const artifactExact = artifactIdentities.length === 1;
  const diagnosticsExact = diagnosticIdentities.length === 1;
  const kovoCells = cells.filter((cell) => cell.report?.framework === 'kovo').length;
  const nextCells = cells.filter((cell) => cell.report?.framework === 'nextjs').length;
  const correctness = {
    artifactExact,
    complete:
      schedule.complete &&
      artifactExact &&
      diagnosticsExact &&
      kovoCells === cells.length &&
      nextCells === 0 &&
      cells.every((cell) => Array.isArray(cell.findings) && cell.findings.length === 0),
    diagnosticsExact,
    frameworkCensus: { kovo: kovoCells, nextjs: nextCells },
    nextjsProductArtifact: null,
    output: artifactExact
      ? {
          bytes: cells[0]?.artifact?.totalBytes ?? null,
          digest: cells[0]?.artifact?.digest ?? null,
          entries: cells[0]?.artifact?.entries?.length ?? null,
        }
      : null,
  };
  const medianImprovement = duration.spikeMedianImprovementPercent;
  const durationP95Improvement = duration.spikeP95ImprovementPercent;
  const rssP95Improvement = peakRssBytes.spikeP95ImprovementPercent;
  const n216Primary = {
    medianImprovementAtLeast10Percent:
      policy.size === 216 && Number.isFinite(medianImprovement) && medianImprovement >= 10,
    pairedCiLowerPositive:
      policy.size === 216 &&
      Number.isFinite(duration.pairedImprovement.bootstrap95Ci[0]) &&
      duration.pairedImprovement.bootstrap95Ci[0] > 0,
  };
  n216Primary.passed =
    n216Primary.medianImprovementAtLeast10Percent && n216Primary.pairedCiLowerPositive;
  const n24MedianGuardrail = {
    maximumRegressionPercent: 5,
    observedImprovementPercent: medianImprovement,
    passed: policy.size === 24 && Number.isFinite(medianImprovement) && medianImprovement >= -5,
  };
  const p95Guardrails = {
    peakRssBytes: metricP95Guardrail(rssP95Improvement, 5),
    totalWallMs: metricP95Guardrail(durationP95Improvement, 5),
  };
  const sizeRulePassed = policy.size === 216 ? n216Primary.passed : n24MedianGuardrail.passed;
  const candidateAccepted =
    correctness.complete &&
    sizeRulePassed &&
    Object.values(p95Guardrails).every((guardrail) => guardrail.passed);
  return {
    acceptance: {
      artifactContentExactRequired: true,
      candidateAccepted,
      n24MedianGuardrail,
      n216Primary,
      p95Guardrails,
      rule: 'n216-wall-win-n24-nonregression-and-both-p95-rss-guardrails/v1',
      sizeRule: policy.size === 216 ? 'n216-primary' : 'n24-nonregression',
    },
    correctness,
    metrics: { peakRssBytes, totalWallMs: duration },
    phaseMetrics: aggregatePhaseMetrics(cells),
    rawPhases: cells.map((cell) => ({
      lane: cell.lane,
      occurrence: cell.occurrence,
      phaseCensus: cell.report?.samples?.[0]?.phaseCensus ?? null,
      rawReport: cell.raw?.path ?? null,
      scheduleIndex: cell.scheduleIndex,
    })),
    schedule,
  };
}

export async function prepareBuildSourceTrustSpike(options, dependencies = {}) {
  const binding =
    options.candidateBinding ??
    (dependencies.authenticateRoots ?? authenticateBuildSourceTrustRoots)({
      baselineRoot: options.baselineRoot,
      candidateRepository: options.candidateRepository ?? repoRoot,
      spikeRoot: options.spikeRoot,
    });
  if (binding?.schema !== BUILD_SOURCE_TRUST_CANDIDATE_BINDING_SCHEMA) {
    throw new Error(
      `candidate binding schema must be ${BUILD_SOURCE_TRUST_CANDIDATE_BINDING_SCHEMA}`,
    );
  }
  const roots = { baseline: binding.baseline.root, spike: binding.spike.root };
  const before = {
    baseline: collectWorktreeState(roots.baseline),
    spike: collectWorktreeState(roots.spike),
  };
  validateBoundSourcePair(before, binding);
  const lanes = {};
  const cleanups = [];
  try {
    for (const lane of ['baseline', 'spike']) {
      const root = roots[lane];
      const modules = await (dependencies.loadRootModules ?? loadRootModules)(root);
      const source = modules.collectProvenance({ lockFiles: LOCK_FILES, repoRoot: root });
      assertPreparedSource(source, before[lane], lane);
      const packed = await modules.preparePacked({ installTimeoutMs: options.installTimeoutMs });
      let fixture = null;
      let externalRoot = null;
      // Register the external-root slot before fixture construction, then the fixture immediately
      // after construction. Reverse-order cleanup therefore always unbinds the packed fixture
      // before removing its corpus, including failures between fixture creation and mkdtemp.
      cleanups.push(() => {
        if (externalRoot !== null) rmSync(externalRoot, { force: true, recursive: true });
      });
      try {
        const sourceAfterPack = modules.collectProvenance({
          lockFiles: LOCK_FILES,
          repoRoot: root,
        });
        fixture = modules.createPackedFixture({
          prepared: packed,
          source,
          sourceAfter: sourceAfterPack,
        });
        cleanups.push(() => fixture.cleanup());
        const productFindings = modules.packedProductIdentityFindings(fixture.identity, source);
        if (productFindings.length > 0) {
          throw new Error(`packed product identity: ${productFindings.join('; ')}`);
        }
        externalRoot = mkdtempSync(path.join(os.tmpdir(), `kovo-build-source-trust-${lane}-`));
        const manifestPath = await modules.generateCorpus({
          dependencyMode: 'deferred',
          framework: 'kovo',
          outDir: externalRoot,
          size: options.size,
        });
        const corpusRoot = path.dirname(manifestPath);
        fixture.bindCorpus(manifestPath);
        const verifiedProduct = modules.verifyPackedFixture(
          fixture.descriptorPath,
          fixture.identity.digest,
          sourceAfterPack,
        );
        const corpus = inspectExternalKovoCorpus({
          corpusRoot,
          manifestPath,
          product: verifiedProduct,
          roots: Object.values(roots),
          size: options.size,
          tooling: modules,
        });
        lanes[lane] = {
          boundary: corpus.boundary,
          corpus,
          descriptorPath: fixture.descriptorPath,
          manifestPath,
          product: fixture.identity,
          root,
          source,
          sourceAfterPack,
          tooling: toolingEvidence(root),
        };
      } catch (error) {
        if (fixture === null) packed.cleanup();
        throw error;
      }
    }
    for (const lane of ['baseline', 'spike']) {
      const findings = buildSourceTrustBoundaryPolicyFindings(lanes[lane]?.boundary?.policy);
      if (findings.length > 0) {
        throw new Error(`${lane} boundary policy: ${findings.join('; ')}`);
      }
    }
    if (!sameBuildSourceTrustCorpusWorkload(lanes.baseline.corpus, lanes.spike.corpus)) {
      throw new Error('baseline and spike external corpus identities differ');
    }
    if (canonicalJson(lanes.baseline.tooling) !== canonicalJson(lanes.spike.tooling)) {
      throw new Error('baseline and spike build harness tooling differs');
    }
    const after = {
      baseline: collectWorktreeState(roots.baseline),
      spike: collectWorktreeState(roots.spike),
    };
    validateBoundSourcePair(after, binding);
    return {
      boundary: {
        corpusRoot: 'external-to-both-worktrees',
        kovoPackedProduct: 'required-and-report-bound-per-lane',
        nextjs: { cells: 0, productArtifact: null },
        policy: BUILD_SOURCE_TRUST_BOUNDARY_POLICY,
        policySchema: BUILD_SOURCE_TRUST_BOUNDARY_POLICY_SCHEMA,
        productSchema: PACKED_PRODUCT_SCHEMA,
      },
      candidateBinding: binding,
      cleanup() {
        const errors = [];
        for (const cleanup of cleanups.reverse()) {
          try {
            cleanup();
          } catch (error) {
            errors.push(errorMessage(error));
          }
        }
        if (errors.length > 0) throw new Error(`build A/B cleanup failed: ${errors.join('; ')}`);
      },
      lanes,
      roots,
      source: { after, before, stable: true },
    };
  } catch (error) {
    for (const cleanup of cleanups.reverse()) {
      try {
        cleanup();
      } catch {
        // Preserve the primary preparation failure.
      }
    }
    throw error;
  }
}

export async function runBuildSourceTrustSpike(options = {}, dependencies = {}) {
  const policy = normalizeOptions(options);
  const schedule = buildSourceTrustSchedule(policy.repetitions);
  const errors = [];
  const cells = [];
  const hostSamples = [];
  const hostDiagnostics = [];
  const host = (dependencies.hostFingerprint ?? performanceHostFingerprint)();
  const authenticate = dependencies.authenticateRoots ?? authenticateBuildSourceTrustRoots;
  const candidateBinding = authenticate({
    baselineRoot: policy.baselineRoot,
    candidateRepository: policy.candidateRepository,
    spikeRoot: policy.spikeRoot,
  });
  mkdirSync(policy.rawRoot, { mode: 0o700, recursive: true });
  const admission = (dependencies.createHostAdmission ?? createBuildSourceTrustHostAdmission)({
    ceiling: policy.maxLoadPerCpu,
    maxWaitMs: policy.hostSettleMaxMs,
    pollMs: policy.hostSettlePollMs,
  });
  const timingLock = (dependencies.acquireLock ?? acquireTimingLock)(policy.timingLockPath);
  let prepared = null;
  let sourceAfter = null;
  try {
    const initialHost = await admission.admit('pre-preparation');
    hostSamples.push(initialHost);
    if (!initialHost.comparable) {
      errors.push(buildSourceTrustHostFailure(initialHost));
    } else {
      admission.markBenchmarkWork();
      try {
        prepared = await (dependencies.prepare ?? prepareBuildSourceTrustSpike)(
          { ...policy, candidateBinding },
          dependencies.preparationDependencies ?? {},
        );
      } catch (error) {
        const retained = writeFailureEnvelope(policy.rawRoot, 'preparation.failure.json', {
          error: boundedDiagnostic(errorMessage(error)),
          schema: BUILD_SOURCE_TRUST_FAILURE_SCHEMA,
          stage: 'preparation',
        });
        errors.push(`preparation: ${errorMessage(error)} (retained ${retained.path})`);
      }
    }
    if (prepared !== null) {
      for (const scheduled of schedule) {
        const hostSample = await admission.admit(
          `block-${String(scheduled.scheduleIndex)}-${scheduled.lane}`,
        );
        hostSamples.push(hostSample);
        if (!hostSample.comparable) {
          errors.push(
            `block ${String(scheduled.scheduleIndex)}: ${buildSourceTrustHostFailure(hostSample)}`,
          );
          break;
        }
        const lane = prepared.lanes[scheduled.lane];
        const rawPath = path.join(
          policy.rawRoot,
          `${String(scheduled.scheduleIndex).padStart(2, '0')}-${scheduled.lane}.json`,
        );
        let cell;
        try {
          cell = await (dependencies.runCell ?? executeBuildSourceTrustCell)({
            ...scheduled,
            laneEvidence: lane,
            rawPath,
            timeoutMs: policy.timeoutMs,
          });
        } catch (error) {
          cell = retainBuildCellFailure({
            error,
            rawPath,
            rawRoot: policy.rawRoot,
            scheduled,
          });
        }
        const findings = validateBuildSourceTrustCell(cell, {
          commit:
            scheduled.lane === 'baseline'
              ? candidateBinding.baseline.commit
              : candidateBinding.spike.commit,
          corpus: lane.corpus,
          product: lane.product,
          source: lane.source,
        });
        cell.findings = findings;
        cells.push(cell);
        if (findings.length > 0) {
          errors.push(...findings);
          break;
        }
        const current = collectWorktreeState(lane.root);
        if (!sameWorktreeState(prepared.source.before[scheduled.lane], current)) {
          errors.push(`${scheduled.lane} source changed after block ${scheduled.scheduleIndex}`);
          break;
        }
      }
      hostDiagnostics.push(await admission.observe('post-timing'));
    }
  } finally {
    timingLock.release();
    if (prepared !== null) {
      try {
        prepared.cleanup();
      } catch (error) {
        errors.push(`cleanup: ${errorMessage(error)}`);
      }
      sourceAfter = {
        baseline: collectWorktreeState(prepared.roots.baseline),
        spike: collectWorktreeState(prepared.roots.spike),
      };
      try {
        validateBoundSourcePair(sourceAfter, candidateBinding);
      } catch (error) {
        errors.push(`post-measurement source: ${errorMessage(error)}`);
      }
    }
  }

  const analysis = aggregateBuildSourceTrustCells(cells, policy);
  const decisionEvidenceComplete =
    policy.repetitions === DECISION_REPETITIONS &&
    analysis.schedule.complete &&
    analysis.correctness.complete;
  const complete =
    errors.length === 0 &&
    decisionEvidenceComplete &&
    cells.length === DECISION_REPETITIONS * SCHEDULE_PATTERN.length &&
    hostSamples.every((sample) => sample.comparable) &&
    sourceAfter !== null;
  return {
    analysis,
    candidate: reportCandidateBinding(candidateBinding),
    cells: cells.map(reportCellEvidence),
    finishedAt: new Date().toISOString(),
    host,
    hostDiagnostics,
    hostSamples,
    integrity: {
      complete,
      errors,
      misses: DECISION_REPETITIONS * SCHEDULE_PATTERN.length - cells.length,
      nextjsCells: 0,
      serialized: true,
      sourceStable: sourceAfter !== null && errors.every((error) => !error.includes('source')),
    },
    policy: reportPolicy(policy),
    preparation: prepared === null ? null : preparationEvidence(prepared),
    schema: BUILD_SOURCE_TRUST_SPIKE_SCHEMA,
    sourceAfter,
    verdict: {
      reasons: [
        ...errors,
        ...(!complete && policy.repetitions !== DECISION_REPETITIONS
          ? ['measurement did not use the preregistered five B,S,S,B repetitions']
          : []),
        ...(complete && !analysis.acceptance.candidateAccepted
          ? ['candidate missed at least one preregistered build acceptance threshold']
          : []),
      ],
      status: !complete ? 'unproven' : analysis.acceptance.candidateAccepted ? 'accept' : 'reject',
    },
  };
}

export function parseBuildSourceTrustArgs(argv) {
  const options = {};
  const booleanFlags = new Set(['--measure']);
  const valueFlags = new Set([
    '--baseline-root',
    '--bootstrap-iterations',
    '--host-settle-max-ms',
    '--host-settle-poll-ms',
    '--install-timeout-ms',
    '--max-load-per-cpu',
    '--out',
    '--repetitions',
    '--seed',
    '--size',
    '--spike-root',
    '--timeout-ms',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (booleanFlags.has(flag)) {
      if (options.measure === true) throw new TypeError(`duplicate ${flag}`);
      options.measure = true;
      continue;
    }
    if (!valueFlags.has(flag)) {
      throw new TypeError(`unsupported build source-trust option: ${String(flag)}`);
    }
    const value = argv[++index];
    if (value === undefined) throw new TypeError(`${flag} requires a value`);
    const key = camelFlag(flag);
    if (Object.hasOwn(options, key)) throw new TypeError(`duplicate ${flag}`);
    options[key] = ['--baseline-root', '--out', '--spike-root'].includes(flag)
      ? value
      : Number(value);
  }
  if (options.measure !== true) {
    throw new TypeError('timing requires explicit --measure authorization');
  }
  return options;
}

export function createBuildSourceTrustHostAdmission({
  ceiling,
  maxWaitMs = DEFAULT_HOST_SETTLE_MAX_MS,
  pollMs = DEFAULT_HOST_SETTLE_POLL_MS,
  sampleHost = sampleHostLoad,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  finitePositiveNumber(ceiling, '--max-load-per-cpu');
  boundedInteger(maxWaitMs, 0, MAX_HOST_SETTLE_MAX_MS, '--host-settle-max-ms');
  boundedInteger(pollMs, 10, 60_000, '--host-settle-poll-ms');
  const budget = { remainingWaitMs: maxWaitMs, totalWaitedMs: 0 };
  let benchmarkWorkStarted = false;
  async function sample(label, gatesTiming) {
    if (!boundedLabel(label)) throw new TypeError('quiet-host label is invalid');
    const availableWaitMs = gatesTiming ? budget.remainingWaitMs : 0;
    const observations = [];
    let waitedMs = 0;
    let attempt = 0;
    while (true) {
      const raw = sampleHost(label, ceiling);
      const loadPerCpu =
        Array.isArray(raw?.loadAverage) &&
        Number.isFinite(raw.loadAverage[0]) &&
        Number.isSafeInteger(raw?.cpuCount) &&
        raw.cpuCount > 0
          ? raw.loadAverage[0] / raw.cpuCount
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
      budget.remainingWaitMs -= waitMs;
      budget.totalWaitedMs += waitMs;
      attempt += 1;
    }
  }
  return {
    admit(label) {
      return sample(label, true);
    },
    markBenchmarkWork() {
      benchmarkWorkStarted = true;
    },
    observe(label) {
      return sample(label, false);
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

function pairedMetric(byLane, select, policy) {
  const baseline = byLane.baseline.map(select).filter(finitePositive);
  const spike = byLane.spike.map(select).filter(finitePositive);
  const baselineSummary = summarizeBuildSourceTrustMetric(baseline);
  const spikeSummary = summarizeBuildSourceTrustMetric(spike);
  const pairedCount = Math.min(baseline.length, spike.length);
  const baselinePairs = baseline.slice(0, pairedCount);
  const spikePairs = spike.slice(0, pairedCount);
  const differences = baselinePairs.map((value, index) => value - spikePairs[index]);
  return {
    baseline: baselineSummary,
    pairedImprovement: {
      bootstrap95Ci:
        baseline.length === spike.length
          ? pairedBuildSourceTrustBootstrap(baselinePairs, spikePairs, {
              iterations: policy.bootstrapIterations,
              seed: policy.seed,
            })
          : [null, null],
      direction: 'baseline-minus-spike',
      median:
        differences.length === 0
          ? null
          : percentile(
              differences.sort((left, right) => left - right),
              50,
            ),
      samples: pairedCount,
    },
    spike: spikeSummary,
    spikeMedianImprovementPercent: improvementPercent(baselineSummary.median, spikeSummary.median),
    spikeP95ImprovementPercent: improvementPercent(baselineSummary.p95, spikeSummary.p95),
  };
}

function inspectBuildSourceTrustDecisionSchedule(cells, policy) {
  const expected = buildSourceTrustSchedule(DECISION_REPETITIONS);
  const observed = cells.map(({ lane, occurrence, position, repetition, scheduleIndex }) => ({
    lane,
    occurrence,
    position,
    repetition,
    scheduleIndex,
  }));
  const counts = {
    baseline: cells.filter((cell) => cell.lane === 'baseline').length,
    spike: cells.filter((cell) => cell.lane === 'spike').length,
  };
  return {
    complete:
      policy.repetitions === DECISION_REPETITIONS &&
      canonicalJson(observed) === canonicalJson(expected) &&
      counts.baseline === DECISION_SAMPLES_PER_ARM &&
      counts.spike === DECISION_SAMPLES_PER_ARM,
    counts,
    expectedRepetitions: DECISION_REPETITIONS,
    expectedSamplesPerArm: DECISION_SAMPLES_PER_ARM,
    order: [...SCHEDULE_PATTERN],
    repetitions: policy.repetitions,
    timedWarmups: 0,
  };
}

function metricP95Guardrail(improvement, maximumRegressionPercent) {
  return {
    maximumRegressionPercent,
    observedImprovementPercent: improvement,
    passed: Number.isFinite(improvement) && improvement >= -maximumRegressionPercent,
  };
}

function aggregatePhaseMetrics(cells) {
  const result = { source: {}, workers: {} };
  for (const [kind, names] of [
    ['source', SOURCE_PHASES],
    ['workers', WORKER_PHASES],
  ]) {
    for (const name of names) {
      result[kind][name] = {};
      for (const lane of ['baseline', 'spike']) {
        result[kind][name][lane] = summarizeBuildSourceTrustMetric(
          cells
            .filter((cell) => cell.lane === lane)
            .map(
              (cell) =>
                cell.report?.samples?.[0]?.phaseCensus?.[kind]?.phases?.find(
                  (phase) => phase.name === name,
                )?.durationMs,
            ),
        );
      }
    }
  }
  return result;
}

async function executeBuildSourceTrustCell({
  lane,
  laneEvidence,
  occurrence,
  position,
  rawPath,
  repetition,
  scheduleIndex,
  timeoutMs,
}) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(laneEvidence.root, 'scripts', 'perf-build-benchmark.mjs'),
      '--framework',
      'kovo',
      '--corpus',
      laneEvidence.manifestPath,
      '--mode',
      'clean',
      '--iterations',
      '1',
      '--warmups',
      '0',
      '--timeout',
      String(timeoutMs),
      '--packed-product',
      laneEvidence.productDescriptorPath ?? laneEvidence.descriptorPath,
      '--packed-product-digest',
      laneEvidence.product.digest,
      '--out',
      rawPath,
    ],
    {
      cwd: laneEvidence.root,
      encoding: 'utf8',
      env: cleanBenchmarkEnvironment(process.env),
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs + 60_000,
    },
  );
  const raw = readRetainedReport(rawPath);
  const report = raw.report;
  const artifact = inspectBuildSourceTrustArtifact(
    path.dirname(laneEvidence.manifestPath),
    report?.integrity?.outputRoots,
  );
  const processFailure =
    result.error || result.signal || result.status !== 0
      ? {
          exitCode: result.status,
          message: boundedDiagnostic(
            result.error?.message ??
              `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`.trim() ??
              `signal ${String(result.signal)}`,
          ),
          signal: result.signal,
        }
      : null;
  return {
    artifact,
    lane,
    occurrence,
    position,
    processFailure,
    raw: raw.evidence,
    repetition,
    report,
    scheduleIndex,
  };
}

function retainBuildCellFailure({ error, rawPath, rawRoot, scheduled }) {
  let retainedRaw = null;
  if (existsSync(rawPath)) {
    try {
      retainedRaw = readRetainedReport(rawPath);
    } catch {
      try {
        const metadata = lstatSync(rawPath);
        if (metadata.isFile() && !metadata.isSymbolicLink()) {
          const bytes = readFileSync(rawPath);
          retainedRaw = {
            evidence: {
              bytes: bytes.byteLength,
              path: portablePath(rawRoot, rawPath),
              retained: true,
              sha256: sha256(bytes),
            },
            report: null,
          };
        }
      } catch {
        retainedRaw = null;
      }
    }
  }
  const failure = {
    error: boundedDiagnostic(errorMessage(error)),
    rawReport: retainedRaw?.evidence ?? null,
    schema: BUILD_SOURCE_TRUST_FAILURE_SCHEMA,
    schedule: scheduled,
  };
  const retainedFailure = writeFailureEnvelope(
    rawRoot,
    `${String(scheduled.scheduleIndex).padStart(2, '0')}-${scheduled.lane}.failure.json`,
    failure,
  );
  return {
    artifact: null,
    ...scheduled,
    processFailure: failure,
    raw: {
      ...retainedFailure,
    },
    report: retainedRaw?.report ?? null,
  };
}

function writeFailureEnvelope(rawRoot, name, value) {
  const failurePath = path.join(rawRoot, name);
  const failureBytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(failurePath, failureBytes, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return {
    bytes: failureBytes.byteLength,
    path: portablePath(rawRoot, failurePath),
    retained: true,
    sha256: sha256(failureBytes),
  };
}

function readRetainedReport(rawPath) {
  const metadata = lstatSync(rawPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('raw adapter report must be a regular non-symlink file');
  }
  if (metadata.size <= 0 || metadata.size > MAX_RAW_REPORT_BYTES) {
    throw new Error('raw adapter report is empty or exceeds its evidence bound');
  }
  const bytes = readFileSync(rawPath);
  return {
    evidence: {
      bytes: bytes.byteLength,
      path: path.posix.join('raw', path.basename(rawPath)),
      retained: true,
      sha256: sha256(bytes),
    },
    report: JSON.parse(bytes.toString('utf8')),
  };
}

async function loadRootModules(root) {
  const imported = await Promise.all([
    import(pathToFileURL(path.join(root, 'scripts/perf-cli-startup-benchmark.mjs')).href),
    import(pathToFileURL(path.join(root, 'scripts/lib/perf-packed-kovo-product.mjs')).href),
    import(pathToFileURL(path.join(root, 'scripts/lib/perf-provenance.mjs')).href),
    import(pathToFileURL(path.join(root, 'benchmarks/corpora/generate.mjs')).href),
  ]);
  return {
    assertCorpusIsolation: imported[1].assertPackedCorpusIsolation,
    collectProvenance: imported[2].collectPerformanceProvenance,
    createPackedFixture: imported[1].createPackedKovoProductFixture,
    generateCorpus: imported[3].generateCorpus,
    materializePackedCommand: imported[1].materializePackedKovoCommand,
    normalizedPackedCommand: imported[1].normalizedPackedKovoCommand,
    packedProductIdentityFindings: imported[1].packedKovoProductIdentityFindings,
    preparePacked: imported[0].preparePackedCliBenchmark,
    verifyPackedFixture: imported[1].verifyPackedKovoProductFixture,
  };
}

export function inspectExternalKovoCorpus({
  corpusRoot,
  manifestPath,
  product,
  roots,
  size,
  tooling,
}) {
  const realCorpusRoot = realpathSync(corpusRoot);
  if (roots.some((root) => containedOrEqual(realpathSync(root), realCorpusRoot))) {
    throw new Error('measurement corpus must be external to both source worktrees');
  }
  assertPackedCorpusIsolation(realCorpusRoot);
  tooling.assertCorpusIsolation(realCorpusRoot);
  const manifestBytes = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (
    manifest?.schema !== CORPUS_SCHEMA ||
    manifest.framework !== 'kovo' ||
    manifest.modules !== size ||
    manifest.workload?.workloadModules !== size ||
    manifest.workload?.componentImportFanout !== size ||
    manifest.workload?.buildOutputContract !== 'required-nonempty-and-cleanup-absent/v1'
  ) {
    throw new Error('external generated Kovo corpus contract is invalid');
  }
  const argv = manifest?.build?.command?.argv;
  if (
    !Array.isArray(argv) ||
    argv.length !== 3 ||
    argv[0] !== 'node_modules/.bin/kovo' ||
    argv[1] !== 'build' ||
    argv[2] !== './src/app.tsx'
  ) {
    throw new Error('external corpus does not declare the exact Kovo build command');
  }
  const declaredCommand = {
    argv,
    cwd: path.resolve(realCorpusRoot, manifest.build.command.cwd),
    env: manifest.build.command.env,
  };
  const materializedCommand = tooling.materializePackedCommand(
    declaredCommand,
    product,
    realCorpusRoot,
  );
  const normalizedCommand = tooling.normalizedPackedCommand(materializedCommand, realCorpusRoot);
  const expectedCommand = {
    argv: ['node', '<packed-kovo>/node_modules/@kovojs/cli/dist/bin.mjs', 'build', './src/app.tsx'],
    cwd: '.',
    env: {},
    productArtifactDigest: product.identity.digest,
  };
  if (canonicalJson(normalizedCommand) !== canonicalJson(expectedCommand)) {
    throw new Error('shared packed command materialization changed the exact build command');
  }
  const declaredCommandEntry = realpathSync(path.join(realCorpusRoot, argv[0]));
  if (!containedOrEqual(realpathSync(product.consumerDependencyRoot), declaredCommandEntry)) {
    throw new Error('external corpus declared command escapes its packed dependency root');
  }
  const actualCommand = realpathSync(materializedCommand.argv[1]);
  if (actualCommand !== realpathSync(product.cliEntry)) {
    throw new Error('materialized command does not resolve to the authenticated packed CLI');
  }
  if (!containedOrEqual(realpathSync(product.consumerRoot), actualCommand)) {
    throw new Error('external corpus actual command escapes its packed consumer');
  }
  return {
    approximateLoc: manifest.approximateLoc,
    boundary: {
      actualCommand: '<packed-consumer>/node_modules/@kovojs/cli/dist/bin.mjs',
      actualCommandSha256: sha256(readFileSync(actualCommand)),
      appRoot: '<external-corpus>',
      declaredCommandEntry: '<packed-consumer>/node_modules/.bin/kovo',
      declaredCommandEntrySha256: sha256(readFileSync(declaredCommandEntry)),
      normalizedCommand,
      policy: BUILD_SOURCE_TRUST_BOUNDARY_POLICY,
      workspaceAncestorAvailable: false,
    },
    build: manifest.build,
    manifestDigest: sha256(manifestBytes),
    modules: manifest.modules,
    routes: manifest.routes,
    schema: manifest.schema,
    shapeDigest: manifest.shapeDigest,
    sourceDigest: manifest.sourceDigest,
    workload: manifest.workload,
  };
}

function toolingEvidence(root) {
  const files = [
    'benchmarks/corpora/generate.mjs',
    'scripts/perf-build-benchmark.mjs',
    'scripts/perf-cli-startup-benchmark.mjs',
    'scripts/lib/perf-packed-kovo-product.mjs',
  ];
  return Object.fromEntries(
    files.map((file) => [file, sha256(readFileSync(path.join(root, file)))]),
  );
}

function preparationEvidence(prepared) {
  return {
    boundary: prepared.boundary,
    corpus: {
      baseline: reportCorpus(prepared.lanes.baseline.corpus),
      spike: reportCorpus(prepared.lanes.spike.corpus),
    },
    products: {
      baseline: prepared.lanes.baseline.product,
      spike: prepared.lanes.spike.product,
    },
    source: prepared.source,
    tooling: prepared.lanes.baseline.tooling,
  };
}

function reportCorpus(corpus) {
  return {
    approximateLoc: corpus.approximateLoc,
    boundary: corpus.boundary,
    build: corpus.build,
    manifestDigest: corpus.manifestDigest,
    modules: corpus.modules,
    routes: corpus.routes,
    schema: corpus.schema,
    shapeDigest: corpus.shapeDigest,
    sourceDigest: corpus.sourceDigest,
    workload: corpus.workload,
  };
}

function reportCandidateBinding(binding) {
  return {
    baseline: { commit: binding.baseline.commit, root: '<baseline-worktree>' },
    candidate: binding.candidate,
    schema: binding.schema,
    spike: {
      commit: binding.spike.commit,
      parent: binding.spike.parent,
      root: '<spike-worktree>',
    },
  };
}

function reportCellEvidence(cell) {
  return {
    artifact: cell.artifact,
    findings: cell.findings,
    lane: cell.lane,
    occurrence: cell.occurrence,
    position: cell.position,
    processFailure: cell.processFailure ?? null,
    raw: cell.raw,
    repetition: cell.repetition,
    scheduleIndex: cell.scheduleIndex,
    summary: {
      artifactBytes: cell.report?.samples?.[0]?.artifactBytes ?? null,
      durationMs: cell.report?.samples?.[0]?.durationMs ?? null,
      peakRssBytes: cell.report?.samples?.[0]?.peakRssBytes ?? null,
      phaseCensus: cell.report?.samples?.[0]?.phaseCensus ?? null,
      productArtifactDigest: cell.report?.productArtifact?.digest ?? null,
    },
  };
}

function reportPolicy(policy) {
  return {
    bootstrapIterations: policy.bootstrapIterations,
    corpusSize: policy.size,
    hostAdmission: 'pre-preparation-and-pre-every-block-with-post-timing-diagnostic/v1',
    hostSettleMaxTotalMs: policy.hostSettleMaxMs,
    hostSettlePollMs: policy.hostSettlePollMs,
    maxLoadPerCpu: policy.maxLoadPerCpu,
    order: [...SCHEDULE_PATTERN],
    packedBoundary: BUILD_SOURCE_TRUST_BOUNDARY_POLICY,
    repetitions: policy.repetitions,
    samplesPerArm: policy.repetitions * 2,
    timedWarmups: 0,
    timingAuthorization: 'explicit-measure',
    timingLock: '<os-temp>/kovo-performance-timing.lock',
    timingLockCoverage: 'pre-preparation-admission-through-post-timing-diagnostic/v1',
  };
}

function normalizeOptions(options) {
  if (options.measure !== true) throw new TypeError('timing requires explicit measure=true');
  const baselineRoot = canonicalDirectory(requiredString(options.baselineRoot, '--baseline-root'));
  const spikeRoot = canonicalDirectory(requiredString(options.spikeRoot, '--spike-root'));
  const outPath = path.resolve(requiredString(options.out, '--out'));
  if (
    containedOrEqual(baselineRoot, outPath) ||
    containedOrEqual(spikeRoot, outPath) ||
    containedOrEqual(baselineRoot, path.dirname(outPath)) ||
    containedOrEqual(spikeRoot, path.dirname(outPath))
  ) {
    throw new TypeError('--out must be external to both measured worktrees');
  }
  const size = Number(options.size);
  if (!SUPPORTED_SIZES.includes(size)) throw new TypeError('--size must be 24 or 216');
  return {
    baselineRoot,
    bootstrapIterations: boundedInteger(
      options.bootstrapIterations ?? DEFAULT_BOOTSTRAP_ITERATIONS,
      100,
      1_000_000,
      '--bootstrap-iterations',
    ),
    candidateRepository: canonicalDirectory(options.candidateRepository ?? repoRoot),
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
      60_000,
      60 * 60 * 1_000,
      '--install-timeout-ms',
    ),
    maxLoadPerCpu: finitePositiveNumber(options.maxLoadPerCpu ?? 1, '--max-load-per-cpu'),
    measure: true,
    outPath,
    rawRoot: path.join(path.dirname(outPath), 'raw'),
    repetitions: boundedInteger(
      options.repetitions ?? DECISION_REPETITIONS,
      1,
      DECISION_REPETITIONS,
      '--repetitions',
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
    timingLockPath: path.join(os.tmpdir(), 'kovo-performance-timing.lock'),
  };
}

function collectWorktreeState(root) {
  return {
    commit: gitOutput(root, ['rev-parse', 'HEAD']),
    dirty: gitDirtyPaths(root, gitOutput).length > 0,
    dirtyPaths: gitDirtyPaths(root, gitOutput),
    locks: Object.fromEntries(
      LOCK_FILES.map((file) => [file, sha256(readFileSync(path.join(root, file)))]),
    ),
  };
}

function validateBoundSourcePair(states, binding) {
  if (
    states.baseline.commit !== binding.baseline.commit ||
    states.spike.commit !== binding.spike.commit ||
    states.baseline.dirty ||
    states.spike.dirty ||
    canonicalJson(states.baseline.locks) !== canonicalJson(states.spike.locks)
  ) {
    throw new Error('baseline/spike source pair is dirty, moved, or lock-mismatched');
  }
}

function assertPreparedSource(source, state, lane) {
  if (
    source?.commit !== state.commit ||
    source?.dirty !== false ||
    canonicalJson(source?.locks) !== canonicalJson(state.locks)
  ) {
    throw new Error(`${lane} packed-product source provenance differs from its worktree`);
  }
}

function sameWorktreeState(left, right) {
  return (
    left?.commit === right?.commit &&
    left?.dirty === false &&
    right?.dirty === false &&
    canonicalJson(left?.locks) === canonicalJson(right?.locks)
  );
}

function crossArmCorpusIdentity(corpus) {
  const reported = reportCorpus(corpus);
  const normalizedCommand = reported.boundary.normalizedCommand;
  return {
    ...reported,
    boundary: {
      actualCommand: reported.boundary.actualCommand,
      appRoot: reported.boundary.appRoot,
      declaredCommandEntry: reported.boundary.declaredCommandEntry,
      normalizedCommand: {
        argv: normalizedCommand?.argv,
        cwd: normalizedCommand?.cwd,
        env: normalizedCommand?.env,
      },
      policy: reported.boundary.policy,
      workspaceAncestorAvailable: reported.boundary.workspaceAncestorAvailable,
    },
  };
}

function normalizePhaseSequence(phases) {
  return Array.isArray(phases)
    ? phases.map((phase) => ({ name: phase?.name ?? null, status: phase?.status ?? null }))
    : [];
}

function uniqueCanonical(values) {
  return [...new Set(values.map((value) => canonicalJson(value)))];
}

function artifactEntries(root, target, entries) {
  const metadata = lstatSync(target);
  const relative = portablePath(root, target);
  if (metadata.isSymbolicLink()) {
    const targetValue = readlinkSync(target);
    if (path.isAbsolute(targetValue)) {
      throw new Error(`build artifact symlink is absolute: ${relative}`);
    }
    entries.push({
      mode: metadata.mode & 0o777,
      path: relative,
      target: targetValue,
      type: 'symlink',
    });
    return;
  }
  if (metadata.isFile()) {
    const bytes = readFileSync(target);
    entries.push({
      bytes: bytes.byteLength,
      mode: metadata.mode & 0o777,
      path: relative,
      sha256: sha256(bytes),
      type: 'file',
    });
    return;
  }
  if (!metadata.isDirectory()) throw new Error(`unsupported build artifact type: ${relative}`);
  entries.push({ mode: metadata.mode & 0o777, path: relative, type: 'directory' });
  for (const name of readdirSync(target).sort(bytewise)) {
    artifactEntries(root, path.join(target, name), entries);
  }
}

function validateOutputContract(value) {
  if (
    canonicalJson(Object.keys(value ?? {}).sort()) !==
      canonicalJson(['absent', 'requiredNonempty']) ||
    !Array.isArray(value.absent) ||
    !Array.isArray(value.requiredNonempty) ||
    value.requiredNonempty.length === 0
  ) {
    throw new TypeError('build output contract is invalid');
  }
  return {
    absent: value.absent.map((entry) => validateOutputPattern(entry)),
    requiredNonempty: value.requiredNonempty.map((entry) => validateOutputPattern(entry)),
  };
}

function validateOutputPattern(value) {
  const output = requiredString(value, 'build output');
  const star = output.indexOf('*');
  if (star >= 0 && (star !== output.length - 1 || output.indexOf('*', star + 1) >= 0)) {
    throw new TypeError('build output permits only a trailing wildcard');
  }
  const probe = star < 0 ? output : `${output.slice(0, -1)}sentinel`;
  if (path.isAbsolute(probe) || path.normalize(probe).startsWith(`..${path.sep}`)) {
    throw new TypeError('build output escapes corpus root');
  }
  return output;
}

function resolveOutputTargets(root, output) {
  const star = output.indexOf('*');
  if (star < 0) {
    const target = confinedPath(root, output);
    return existsSync(target) ? [target] : [];
  }
  const prefix = path.basename(output.slice(0, -1));
  if (prefix.length < 2) throw new TypeError('build output wildcard is too broad');
  const parent = confinedPath(root, path.dirname(output), true);
  if (!existsSync(parent)) return [];
  return readdirSync(parent)
    .filter((name) => name.startsWith(prefix))
    .map((name) => confinedPath(root, path.join(path.dirname(output), name)));
}

function confinedPath(root, relative, allowRoot = false) {
  if (path.isAbsolute(relative)) throw new TypeError('path must be relative');
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (
    (resolved === resolvedRoot && !allowRoot) ||
    (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`))
  ) {
    throw new TypeError('path escapes corpus root');
  }
  return resolved;
}

function canonicalGitRoot(value, git) {
  const root = canonicalDirectory(requiredString(value, 'worktree root'));
  if (git(root, ['rev-parse', '--show-toplevel']) !== root) {
    throw new TypeError('worktree root must be an exact Git top-level directory');
  }
  return root;
}

function canonicalDirectory(value) {
  const resolved = realpathSync(path.resolve(value));
  if (!lstatSync(resolved).isDirectory()) throw new TypeError(`not a directory: ${value}`);
  return resolved;
}

function gitOutput(root, args) {
  return String(
    execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      env: cleanBenchmarkEnvironment(process.env),
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  ).trim();
}

function gitDirtyPaths(root, git) {
  const output = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  return output === '' ? [] : output.split('\n').map((line) => line.slice(3));
}

function gitPatchBytes(root, from, to) {
  return execFileSync(
    'git',
    ['-C', root, 'diff', '--binary', '--full-index', '--no-ext-diff', from, to],
    {
      encoding: 'buffer',
      env: cleanBenchmarkEnvironment(process.env),
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

export function gitPatchId(root, commit) {
  const patch = execFileSync(
    'git',
    ['-C', root, 'show', '--pretty=format:', '--binary', '--no-ext-diff', commit],
    {
      encoding: 'buffer',
      env: cleanBenchmarkEnvironment(process.env),
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const result = spawnSync('git', ['patch-id', '--stable'], {
    cwd: root,
    encoding: 'utf8',
    env: cleanBenchmarkEnvironment(process.env),
    input: patch,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(`git patch-id failed: ${boundedDiagnostic(result.stderr)}`);
  }
  return String(result.stdout).trim().split(/\s+/u)[0];
}

function changedPathCensus(root, from, to, git) {
  const output = git(root, ['diff', '--name-status', '--no-renames', from, to]);
  if (output === '') return [];
  return output.split('\n').map((line) => {
    const separator = line.indexOf('\t');
    if (separator < 1) throw new Error('candidate path census is malformed');
    return { path: line.slice(separator + 1), status: line.slice(0, separator) };
  });
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

function sampleHostLoad(label, ceiling) {
  return {
    at: new Date().toISOString(),
    ceiling,
    cpuCount: os.cpus().length,
    label,
    loadAverage: os.loadavg(),
  };
}

function buildSourceTrustHostFailure(sample) {
  const observed = Number.isFinite(sample.loadPerCpu)
    ? sample.loadPerCpu.toFixed(3)
    : 'unavailable';
  return `${sample.posture} host load ${observed} per CPU exceeded ceiling ${String(
    sample.ceiling,
  )} after bounded ${String(sample.settle?.waitedMs ?? 0)}ms quiet-host admission`;
}

function improvementPercent(baseline, spike) {
  return finitePositive(baseline) && finitePositive(spike)
    ? ((baseline - spike) / baseline) * 100
    : null;
}

function percentile(sortedValues, percentage) {
  if (sortedValues.length === 0) return null;
  const values = [...sortedValues].sort((left, right) => left - right);
  const index = ((values.length - 1) * percentage) / 100;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return lower === upper
    ? values[lower]
    : values[lower] + (values[upper] - values[lower]) * (index - lower);
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function containedOrEqual(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function portablePath(root, target) {
  return path.relative(root, target).split(path.sep).join('/');
}

function bytewise(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function digest(value) {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function boundedInteger(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return number;
}

function finitePositiveNumber(value, label) {
  const number = Number(value);
  if (!finitePositive(number)) throw new TypeError(`${label} must be finite and positive`);
  return number;
}

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function requiredString(value, label) {
  if (!nonEmptyString(value)) throw new TypeError(`${label} is required`);
  return value;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function boundedLabel(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,95}$/u.test(value);
}

function boundedDiagnostic(value) {
  const text = String(value ?? '').trim() || '<no output>';
  return text.length <= 4_096 ? text : `${text.slice(0, 4_096)}...[truncated]`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function camelFlag(flag) {
  return flag.slice(2).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  let report;
  try {
    options = parseBuildSourceTrustArgs(argv);
    report = await runBuildSourceTrustSpike(options);
  } catch (error) {
    const outFlag = argv.indexOf('--out');
    const out = outFlag >= 0 && argv[outFlag + 1] ? path.resolve(argv[outFlag + 1]) : null;
    report = {
      error: boundedDiagnostic(errorMessage(error)),
      host: performanceHostFingerprint(),
      schema: BUILD_SOURCE_TRUST_FAILURE_SCHEMA,
      verdict: { reasons: [errorMessage(error)], status: 'unproven' },
    };
    if (out !== null) {
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 2;
  }
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
  writeFileSync(path.resolve(options.out), serialized, 'utf8');
  process.stdout.write(serialized);
  return report.verdict.status === 'accept' ? 0 : 1;
}

if (isMainEntry(import.meta.url)) await runGate(() => main());
