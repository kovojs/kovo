#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  readPackageTarballSnapshot,
  validatedPackageTarballEntries,
} from './lib/deterministic-tarball.mjs';
import {
  ensureNonSymlinkDescendantDirectory,
  nonSymlinkDescendant,
  nonSymlinkRootDirectory,
} from './lib/non-symlink-path.mjs';
import { packWithoutLifecycleScripts } from './lib/pack-without-lifecycle.mjs';
import { parseTimePeakRssBytes } from './lib/process-cost.mjs';
import {
  validatePackedReleaseManifest,
  verifyPackedAttestationBytes,
} from './publish-packed-packages.mjs';
import { repoRoot as defaultRepoRoot } from './public-packages.mjs';
import { releasePackages } from './release-packages.mjs';

export const DEVEX_BUDGETS_SCHEMA = 'kovo-devex-budgets/v5';
export const DEVEX_BENCHMARK_SCENARIO_SCHEMA = 'kovo-devex-benchmark-scenario/v4';
export const DEVEX_BENCHMARK_REPORT_SCHEMA = 'kovo-devex-benchmark-report/v4';
export const DEVEX_BUDGET_PROPOSAL_SCHEMA = 'kovo-devex-budget-proposal/v5';
export const DEVEX_PACKED_WORKLOAD_SCHEMA = 'kovo-devex-packed-workload/v2';
export const DEVEX_SCENARIO_RECIPE_SCHEMA = 'kovo-devex-scenario-recipe/v1';

const PHASES = Object.freeze(['cold', 'warm', 'oneFileIncremental']);
const PACKED_PROFILE_ID = 'kovo-packed-check/v2';
const KOVO_FRESH_PACK_PRODUCER_ID = 'kovo-clean-source-pack/v1';
const KOVO_PRODUCER_ATTESTATION_SCHEMA = 'kovo-devex-producer-attestation/v1';
const KOVO_PHASE_CENSUS_SCHEMA = 'kovo-devex-phase-census/v2';
const KOVO_BENCHMARK_CONSUMER = '@kovojs/devex-packed-check-consumer';
const KOVO_PACKED_RECIPE_PATH = 'scripts/devex-scenarios/kovo-packed-check.json';
const authenticatedProductionScenarios = new WeakSet();
const METRIC_UNITS = new Set(['bytes', 'ms']);
const STATISTICS = new Set(['median', 'p95']);
const RUNNER_STATUSES = new Set(['unratified', 'ratified']);
const BROWSER_BUILD_COMMAND = Object.freeze({
  command: Object.freeze(['node', 'build-browser.mjs']),
  cwd: '.',
});
const PACKED_PROFILE_COMMANDS = Object.freeze(
  Object.fromEntries(
    PHASES.map((phase) => [
      phase,
      Object.freeze({
        command: Object.freeze(['node', 'profile.mjs', phase]),
        cwd: '.',
      }),
    ]),
  ),
);
const DEVEX_METRIC_CONTRACT = Object.freeze({
  'browser.bootstrapBytes': Object.freeze({ sampling: 'deterministic', unit: 'bytes' }),
  'check.cold.durationMs': Object.freeze({ sampling: 'statistical', unit: 'ms' }),
  'check.cold.peakRssBytes': Object.freeze({ sampling: 'statistical', unit: 'bytes' }),
  'check.oneFileIncremental.durationMs': Object.freeze({
    sampling: 'statistical',
    unit: 'ms',
  }),
  'check.oneFileIncremental.peakRssBytes': Object.freeze({
    sampling: 'statistical',
    unit: 'bytes',
  }),
  'check.warm.durationMs': Object.freeze({ sampling: 'statistical', unit: 'ms' }),
  'check.warm.peakRssBytes': Object.freeze({ sampling: 'statistical', unit: 'bytes' }),
  'create.install.cold.durationMs': Object.freeze({
    sampling: 'statistical',
    unit: 'ms',
  }),
  'create.install.installedBytes': Object.freeze({
    sampling: 'deterministic',
    unit: 'bytes',
  }),
  'dev.editToDiagnostic.durationMs': Object.freeze({
    sampling: 'statistical',
    unit: 'ms',
  }),
  'dev.editToServedResult.durationMs': Object.freeze({
    sampling: 'statistical',
    unit: 'ms',
  }),
  'dev.ready.cold.durationMs': Object.freeze({ sampling: 'statistical', unit: 'ms' }),
  'dev.ready.warm.durationMs': Object.freeze({ sampling: 'statistical', unit: 'ms' }),
  'docs.snapshot.compressedBytes': Object.freeze({ sampling: 'deterministic', unit: 'bytes' }),
  'docs.snapshot.installedBytes': Object.freeze({ sampling: 'deterministic', unit: 'bytes' }),
  'ui.fullCatalog.peakRssBytes': Object.freeze({ sampling: 'statistical', unit: 'bytes' }),
});

function compareStrings(left, right) {
  return left.localeCompare(right);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  const absolute = path.resolve(filePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function sameJson(left, right) {
  return isDeepStrictEqual(left, right);
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort(compareStrings)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('benchmark identity contains a non-JSON value');
}

export function benchmarkScenarioDigest(scenario) {
  return sha256(Buffer.from(canonicalJson(scenario)));
}

export const DEVEX_PACKED_PROFILE_COMMAND_DIGEST = sha256(
  Buffer.from(
    canonicalJson({
      browserBuild: BROWSER_BUILD_COMMAND,
      phases: PACKED_PROFILE_COMMANDS,
    }),
  ),
);

function safeRepositoryRelativePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !value.includes('\\') &&
    path.posix.normalize(value) === value &&
    value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  );
}

function runnerIdentity(fingerprint) {
  return {
    name: fingerprint?.name,
    platform: fingerprint?.platform,
    arch: fingerprint?.arch,
    node: fingerprint?.node,
    cpuModel: fingerprint?.cpuModel,
    packageManager: fingerprint?.packageManager,
    osImage: fingerprint?.osImage,
  };
}

/** Create the immutable identity used to compare baseline and evaluation runners. */
export function createRunnerFingerprint(identity) {
  const normalized = runnerIdentity(identity);
  return {
    ...normalized,
    id: sha256(Buffer.from(JSON.stringify(normalized))),
  };
}

function validateRunnerFingerprint(fingerprint, label, options = {}) {
  const findings = [];
  for (const field of [
    'name',
    'platform',
    'arch',
    'node',
    'cpuModel',
    'packageManager',
    'osImage',
  ]) {
    if (typeof fingerprint?.[field] !== 'string' || fingerprint[field].trim().length === 0) {
      findings.push(`${label}.${field} must be a non-empty string`);
    }
  }
  if (findings.length === 0) {
    const expected = createRunnerFingerprint(fingerprint);
    if (fingerprint.id !== expected.id) {
      findings.push(`${label}.id does not match its OS/platform/CPU/Node/package-manager identity`);
    }
  }
  const allowed = new Set([
    'id',
    'name',
    'platform',
    'arch',
    'node',
    'cpuModel',
    'packageManager',
    'osImage',
  ]);
  for (const field of Object.keys(fingerprint ?? {})) {
    if (!allowed.has(field)) findings.push(`${label}.${field} is not part of the runner identity`);
  }
  if (options.requireNamed && fingerprint?.name?.trim().length === 0) {
    findings.push(`${label}.name is required for ratification`);
  }
  return findings;
}

export function median(values) {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((value) => !Number.isFinite(value))
  ) {
    throw new Error('median requires a non-empty array of finite numbers');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function percentile(values, quantile) {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((value) => !Number.isFinite(value)) ||
    !Number.isFinite(quantile) ||
    quantile < 0 ||
    quantile > 1
  ) {
    throw new Error('percentile requires finite samples and a quantile between zero and one');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[index];
}

export function statisticValue(values, statistic) {
  if (statistic === 'median') return median(values);
  if (statistic === 'p95') return percentile(values, 0.95);
  throw new Error(`Unsupported statistic: ${statistic}`);
}

export function medianAbsoluteDeviation(values) {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

function validateCommand(command, label) {
  if (
    !Array.isArray(command) ||
    command.length === 0 ||
    command.some((part) => typeof part !== 'string' || part.length === 0)
  ) {
    throw new Error(`${label} must be a non-empty string array`);
  }
}

function validatePinnedEnvironment(environment, label) {
  const findings = [];
  for (const field of ['runnerName', 'platform', 'arch', 'node', 'cpuModel']) {
    if (typeof environment?.[field] !== 'string' || environment[field].trim().length === 0) {
      findings.push(`${label}.${field} must be a non-empty string`);
    }
  }
  if (
    !/^[a-z0-9][a-z0-9._-]*@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(
      environment?.packageManager ?? '',
    )
  ) {
    findings.push(`${label}.packageManager must pin an exact semantic version`);
  }
  if (!/^[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$/u.test(environment?.osImage ?? '')) {
    findings.push(`${label}.osImage must be an immutable image name@sha256 digest`);
  }
  return findings;
}

function validatePackedArtifacts(artifacts, label) {
  const findings = [];
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    return [`${label} must contain at least one packed tarball`];
  }
  const names = new Set();
  const paths = new Set();
  for (const [index, artifact] of artifacts.entries()) {
    const prefix = `${label}[${index}]`;
    if (typeof artifact?.name !== 'string' || artifact.name.trim().length === 0) {
      findings.push(`${prefix}.name must be a non-empty string`);
    } else if (names.has(artifact.name)) {
      findings.push(`${prefix}.name is duplicated`);
    } else {
      names.add(artifact.name);
    }
    if (!safeRepositoryRelativePath(artifact?.path) || !artifact.path.endsWith('.tgz')) {
      findings.push(`${prefix}.path must be a repository-relative .tgz path`);
    } else if (paths.has(artifact.path)) {
      findings.push(`${prefix}.path is duplicated`);
    } else {
      paths.add(artifact.path);
    }
    if (!/^sha256:[0-9a-f]{64}$/u.test(artifact?.sha256 ?? '')) {
      findings.push(`${prefix}.sha256 must be an exact SHA-256 digest`);
    }
  }
  return findings;
}

function validGitObjectId(value) {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value ?? '');
}

function validateBenchmarkProvenance(provenance, label) {
  const findings = [];
  if (!validGitObjectId(provenance?.sourceCommit)) {
    findings.push(`${label}.sourceCommit must be an exact Git object ID`);
  }
  if (provenance?.sourceTree !== 'clean') {
    findings.push(`${label}.sourceTree must be clean`);
  }
  if (
    !safeRepositoryRelativePath(provenance?.workloadManifest?.path) ||
    !provenance.workloadManifest.path.endsWith('.json')
  ) {
    findings.push(`${label}.workloadManifest.path must be a repository-relative JSON path`);
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(provenance?.workloadManifest?.sha256 ?? '')) {
    findings.push(`${label}.workloadManifest.sha256 must be an exact SHA-256 digest`);
  }
  findings.push(
    ...validatePackedArtifacts(provenance?.packedArtifacts, `${label}.packedArtifacts`),
  );
  findings.push(...validateWorkloadFiles(provenance?.supportFiles, `${label}.supportFiles`));
  return findings;
}

function expectedKovoReleasePackages() {
  return releasePackages()
    .map((pkg) => pkg.name)
    .sort(compareStrings);
}

function createKovoProducerAttestation(provenance) {
  const releasePackageNames = expectedKovoReleasePackages();
  return {
    schema: KOVO_PRODUCER_ATTESTATION_SCHEMA,
    producer: KOVO_FRESH_PACK_PRODUCER_ID,
    consumer: KOVO_BENCHMARK_CONSUMER,
    releasePackages: releasePackageNames,
    sourceCommit: provenance.sourceCommit,
    workloadManifestSha256: provenance.workloadManifest.sha256,
    profileCommandDigest: DEVEX_PACKED_PROFILE_COMMAND_DIGEST,
    browserBuildCommandDigest: sha256(Buffer.from(canonicalJson(BROWSER_BUILD_COMMAND))),
    artifactCensusSha256: sha256(Buffer.from(canonicalJson(provenance.packedArtifacts))),
    supportFileCensusSha256: sha256(Buffer.from(canonicalJson(provenance.supportFiles))),
  };
}

function validateKovoProductionScenario(scenario, label = 'scenario') {
  const findings = [];
  const expectedArtifactNames = [KOVO_BENCHMARK_CONSUMER, ...expectedKovoReleasePackages()].sort(
    compareStrings,
  );
  const actualArtifactNames = (scenario?.provenance?.packedArtifacts ?? [])
    .map((artifact) => artifact.name)
    .sort(compareStrings);
  if (!sameJson(actualArtifactNames, expectedArtifactNames)) {
    findings.push(
      `${label}.provenance.packedArtifacts must contain the exact code-owned Kovo release and benchmark consumer census`,
    );
  }
  let expectedAttestation;
  try {
    expectedAttestation = createKovoProducerAttestation(scenario.provenance);
  } catch {
    expectedAttestation = null;
  }
  if (!sameJson(scenario?.provenance?.producerAttestation, expectedAttestation)) {
    findings.push(
      `${label}.provenance.producerAttestation must match the code-owned authenticated producer and artifact census`,
    );
  }
  return findings;
}

export function validateBenchmarkScenario(scenario) {
  const findings = [];
  if (scenario?.schema !== DEVEX_BENCHMARK_SCENARIO_SCHEMA) {
    findings.push(`scenario.schema must be ${DEVEX_BENCHMARK_SCENARIO_SCHEMA}`);
  }
  if (typeof scenario?.name !== 'string' || scenario.name.trim().length === 0) {
    findings.push('scenario.name must be a non-empty string');
  }
  findings.push(...validatePinnedEnvironment(scenario?.environment, 'scenario.environment'));
  findings.push(...validateBenchmarkProvenance(scenario?.provenance, 'scenario.provenance'));
  if (scenario?.profile?.id !== PACKED_PROFILE_ID) {
    findings.push(`scenario.profile.id must be ${PACKED_PROFILE_ID}`);
  }
  if (scenario?.profile?.commandDigest !== DEVEX_PACKED_PROFILE_COMMAND_DIGEST) {
    findings.push('scenario.profile.commandDigest must match the code-owned packed profiles');
  }
  const allowedFields = new Set(['schema', 'name', 'profile', 'environment', 'provenance']);
  for (const field of Object.keys(scenario ?? {})) {
    if (!allowedFields.has(field)) {
      findings.push(`scenario.${field} is not part of the packed benchmark contract`);
    }
  }
  if (scenario?.name === 'kovo-packed-check') {
    findings.push(...validateKovoProductionScenario(scenario));
  }
  return findings;
}

function currentBenchmarkEnvironment(options = {}) {
  if (options.observedEnvironment) return structuredClone(options.observedEnvironment);
  const repositoryRoot = path.resolve(options.repositoryRoot ?? defaultRepoRoot);
  const sourceCommit = checkedCommandOutput('git', ['rev-parse', 'HEAD'], repositoryRoot);
  const rootManifest = readJson(path.join(repositoryRoot, 'package.json'));
  const packageManagerName = String(rootManifest.packageManager ?? '').split('@')[0];
  if (!packageManagerName) throw new Error('root package.json must pin packageManager');
  const packageManagerVersion = checkedCommandOutput(
    packageManagerName,
    ['--version'],
    repositoryRoot,
  );
  const osImage = process.env.KOVO_DEVEX_OS_IMAGE;
  const runnerName = process.env.KOVO_DEVEX_RUNNER_NAME;
  if (!osImage || !runnerName) {
    throw new Error(
      'benchmarking requires KOVO_DEVEX_OS_IMAGE and KOVO_DEVEX_RUNNER_NAME to identify the pinned runner',
    );
  }
  const dirtyPaths = checkedCommandOutput(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    repositoryRoot,
  );
  if (dirtyPaths !== '') {
    throw new Error('benchmarking requires a clean source revision');
  }
  return {
    runnerName,
    sourceCommit,
    sourceTree: 'clean',
    packageManager: `${packageManagerName}@${packageManagerVersion}`,
    osImage,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpuModel: os.cpus()[0]?.model ?? 'unknown',
  };
}

function checkedCommandOutput(executable, args, cwd) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error(
      `${executable} ${args.join(' ')} failed while resolving benchmark provenance: ${
        result.error?.message ?? result.signal ?? result.stderr ?? `exit ${String(result.status)}`
      }`,
    );
  }
  return result.stdout.trim();
}

function environmentRunnerFingerprint(environment) {
  return createRunnerFingerprint({
    name: environment.runnerName,
    platform: environment.platform,
    arch: environment.arch,
    node: environment.node,
    cpuModel: environment.cpuModel,
    packageManager: environment.packageManager,
    osImage: environment.osImage,
  });
}

function observedEnvironmentFindings(scenario, observed) {
  const findings = validatePinnedEnvironment(observed, 'observedEnvironment');
  if (!validGitObjectId(observed?.sourceCommit)) {
    findings.push('observedEnvironment.sourceCommit must be an exact Git object ID');
  }
  if (observed?.sourceTree !== 'clean') {
    findings.push('observedEnvironment.sourceTree must be clean');
  }
  for (const field of [
    'runnerName',
    'platform',
    'arch',
    'node',
    'cpuModel',
    'packageManager',
    'osImage',
  ]) {
    if (observed?.[field] !== scenario.environment[field]) {
      findings.push(
        `observedEnvironment.${field}=${JSON.stringify(observed?.[field])} does not match scenario.environment.${field}`,
      );
    }
  }
  if (observed?.sourceCommit !== scenario.provenance.sourceCommit) {
    findings.push(
      `observedEnvironment.sourceCommit=${JSON.stringify(observed?.sourceCommit)} does not match scenario.provenance.sourceCommit`,
    );
  }
  if (observed?.sourceTree !== scenario.provenance.sourceTree) {
    findings.push(
      `observedEnvironment.sourceTree=${JSON.stringify(observed?.sourceTree)} does not match scenario.provenance.sourceTree`,
    );
  }
  return findings;
}

function timeInvocation(command, platform) {
  if (!existsSync('/usr/bin/time')) return null;
  if (platform === 'darwin') return ['/usr/bin/time', ['-l', ...command]];
  if (platform === 'linux') return ['/usr/bin/time', ['-v', ...command]];
  return null;
}

/**
 * Measure a command without a shell. `/usr/bin/time` owns peak RSS; the monotonic clock owns
 * duration so command stderr cannot forge either metric.
 */
export function measureCommand(command, options = {}) {
  validateCommand(command, 'command');
  const cwd = path.resolve(options.cwd ?? defaultRepoRoot);
  const platform = options.platform ?? process.platform;
  const invocation = timeInvocation(command, platform);
  const executable = invocation?.[0] ?? command[0];
  const args = invocation?.[1] ?? command.slice(1);
  const spawn = options.spawnSync ?? spawnSync;
  const started = process.hrtime.bigint();
  const result = spawn(executable, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  const peakRssBytes =
    invocation === null ? null : (parseTimePeakRssBytes(result.stderr ?? '', platform) ?? null);
  return {
    durationMs,
    peakRssBytes,
    exitCode: result.status,
    signal: result.signal ?? null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error?.message ?? null,
  };
}

function resolveInsideRoot(root, relative, label) {
  if (!safeRepositoryRelativePath(relative)) {
    throw new Error(`${label} must be a canonical relative path`);
  }
  const absolute = path.resolve(root, ...relative.split('/'));
  if (absolute === root || !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} escapes its root: ${relative}`);
  }
  return absolute;
}

function regularFileInsideRoot(root, relative, label) {
  return nonSymlinkDescendant(root, relative, { kind: 'file', label });
}

export function browserBootstrapBytes(files, options = {}) {
  const root = path.resolve(options.root ?? defaultRepoRoot);
  let total = 0;
  const measured = [];
  for (const relative of [...files].sort(compareStrings)) {
    const absolute = regularFileInsideRoot(root, relative, 'browser bootstrap file');
    const bytes = statSync(absolute).size;
    total += bytes;
    measured.push({ path: relative.split(path.sep).join('/'), bytes });
  }
  return { bytes: total, files: measured };
}

function sampleSummary(samples) {
  return {
    count: samples.length,
    min: Math.min(...samples),
    median: median(samples),
    p95: percentile(samples, 0.95),
    max: Math.max(...samples),
    medianAbsoluteDeviation: medianAbsoluteDeviation(samples),
  };
}

function validateWorkloadFiles(files, label) {
  const findings = [];
  if (!Array.isArray(files) || files.length === 0) {
    return [`${label} must contain an exact tarball file census`];
  }
  const paths = new Set();
  for (const [index, file] of files.entries()) {
    const prefix = `${label}[${index}]`;
    if (!safeRepositoryRelativePath(file?.path)) {
      findings.push(`${prefix}.path must be canonical and relative`);
    } else if (paths.has(file.path)) {
      findings.push(`${prefix}.path is duplicated`);
    } else {
      paths.add(file.path);
    }
    if (!/^sha256:[0-9a-f]{64}$/u.test(file?.sha256 ?? '')) {
      findings.push(`${prefix}.sha256 must be an exact SHA-256 digest`);
    }
    if (typeof file?.executable !== 'boolean') {
      findings.push(`${prefix}.executable must be boolean`);
    }
  }
  if (!paths.has('package.json')) findings.push(`${label} must include package.json`);
  return findings;
}

function validatePackedWorkloadManifest(manifest) {
  const findings = [];
  if (manifest?.schema !== DEVEX_PACKED_WORKLOAD_SCHEMA) {
    findings.push(`workload manifest schema must be ${DEVEX_PACKED_WORKLOAD_SCHEMA}`);
  }
  if (
    manifest?.profile?.id !== PACKED_PROFILE_ID ||
    manifest?.profile?.commandDigest !== DEVEX_PACKED_PROFILE_COMMAND_DIGEST
  ) {
    findings.push('workload manifest profile must match the code-owned packed profile contract');
  }
  if (manifest?.entrypoint !== 'profile.mjs') {
    findings.push('workload manifest entrypoint must be profile.mjs');
  }
  if (!Array.isArray(manifest?.artifacts) || manifest.artifacts.length === 0) {
    findings.push('workload manifest artifacts must be a non-empty array');
  } else {
    const names = new Set();
    let consumerCount = 0;
    for (const [index, artifact] of manifest.artifacts.entries()) {
      const prefix = `workload manifest artifacts[${index}]`;
      if (typeof artifact?.name !== 'string' || artifact.name.trim().length === 0) {
        findings.push(`${prefix}.name must be non-empty`);
      } else if (names.has(artifact.name)) {
        findings.push(`${prefix}.name is duplicated`);
      } else {
        names.add(artifact.name);
      }
      if (!['consumer', 'package'].includes(artifact?.role)) {
        findings.push(`${prefix}.role must be consumer or package`);
      }
      if (artifact?.role === 'consumer') consumerCount += 1;
      if (!safeRepositoryRelativePath(artifact?.path) || !artifact.path.endsWith('.tgz')) {
        findings.push(`${prefix}.path must be a repository-relative .tgz path`);
      }
      if (!/^sha256:[0-9a-f]{64}$/u.test(artifact?.sha256 ?? '')) {
        findings.push(`${prefix}.sha256 must be an exact SHA-256 digest`);
      }
      findings.push(...validateWorkloadFiles(artifact?.files, `${prefix}.files`));
    }
    if (consumerCount !== 1) {
      findings.push('workload manifest must contain exactly one consumer artifact');
    }
  }
  if (
    !Array.isArray(manifest?.browserBootstrap) ||
    manifest.browserBootstrap.length === 0 ||
    manifest.browserBootstrap.some((file) => !safeRepositoryRelativePath(file)) ||
    new Set(manifest.browserBootstrap).size !== manifest.browserBootstrap.length
  ) {
    findings.push(
      'workload manifest browserBootstrap must contain unique canonical relative paths',
    );
  }
  if (manifest?.browserBuild !== undefined) {
    try {
      validateCommand(manifest.browserBuild?.command, 'workload manifest browserBuild.command');
    } catch (error) {
      findings.push(error.message);
    }
    if (
      manifest.browserBuild?.cwd !== '.' &&
      !safeRepositoryRelativePath(manifest.browserBuild?.cwd)
    ) {
      findings.push('workload manifest browserBuild.cwd must be . or a canonical relative path');
    }
  }
  return findings;
}

export function validateKovoBrowserWorkload(manifest, consumerFiles) {
  const findings = [];
  if (!sameJson(manifest?.browserBuild, BROWSER_BUILD_COMMAND)) {
    findings.push(
      'Kovo packed workload browser build must match the code-owned compiler bootstrap command',
    );
  }
  const requiredConsumerFiles = new Set([
    'build-browser.mjs',
    'profile.mjs',
    'src/app.tsx',
    'src/components/counter-island.tsx',
    'workload.mjs',
  ]);
  for (const required of requiredConsumerFiles) {
    if (!consumerFiles.some((file) => file.path === required)) {
      findings.push(`Kovo packed workload consumer is missing required app source: ${required}`);
    }
  }
  if (
    !sameJson(manifest?.browserBootstrap, [
      'dist/.kovo/client/generated/app.client.js',
    ])
  ) {
    findings.push(
      'Kovo packed workload browser bootstrap must name the canonical compiler-generated app bootstrap',
    );
  }
  for (const relative of manifest?.browserBootstrap ?? []) {
    if (
      !relative.startsWith('dist/.kovo/client/generated/') ||
      consumerFiles.some((file) => file.path === relative)
    ) {
      findings.push(
        'Kovo packed workload browser bootstrap must name emitted client assets, not packed source files',
      );
      break;
    }
  }
  return findings;
}

function readPackedWorkloadManifest(scenario, root) {
  const reference = scenario.provenance.workloadManifest;
  const absolute = regularFileInsideRoot(root, reference.path, 'packed workload manifest');
  const bytes = readFileSync(absolute);
  const observedDigest = sha256(bytes);
  if (observedDigest !== reference.sha256) {
    throw new Error(
      `packed workload manifest digest mismatch: expected ${reference.sha256}, observed ${observedDigest}`,
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('packed workload manifest is not valid JSON');
  }
  const findings = validatePackedWorkloadManifest(manifest);
  if (findings.length > 0) {
    throw new Error(`Invalid packed workload manifest:\n- ${findings.join('\n- ')}`);
  }
  const declaredArtifacts = manifest.artifacts.map(
    ({ name, path: artifactPath, sha256: digest }) => ({
      name,
      path: artifactPath,
      sha256: digest,
    }),
  );
  if (!sameJson(declaredArtifacts, scenario.provenance.packedArtifacts)) {
    throw new Error('packed workload manifest artifacts do not match scenario provenance');
  }
  if (!sameJson(manifest.profile, scenario.profile)) {
    throw new Error('packed workload manifest profile does not match scenario profile');
  }
  const consumer = manifest.artifacts.find((artifact) => artifact.role === 'consumer');
  if (!sameJson(consumer.files, scenario.provenance.supportFiles)) {
    throw new Error('packed workload support files do not match scenario provenance');
  }
  if (scenario.name === 'kovo-packed-check') {
    const browserFindings = validateKovoBrowserWorkload(manifest, consumer.files);
    if (browserFindings.length > 0) {
      throw new Error(browserFindings.join('\n'));
    }
  }
  return { bytes, manifest };
}

function packageDestination(nodeModules, packageName) {
  const match = /^(?:@([a-z0-9][a-z0-9._-]*)\/)?([a-z0-9][a-z0-9._-]*)$/u.exec(packageName);
  if (!match) throw new TypeError(`invalid packed package name: ${String(packageName)}`);
  return match[1]
    ? path.join(nodeModules, `@${match[1]}`, match[2])
    : path.join(nodeModules, match[2]);
}

function linkExternalDependencies(stageRoot, repositoryRoot, packedNames) {
  const source = path.join(repositoryRoot, 'node_modules');
  if (!existsSync(source) || !lstatSync(source).isDirectory()) {
    throw new Error('the frozen repository node_modules is required by the packed Kovo profile');
  }
  const destination = path.join(stageRoot, 'node_modules');
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const sourceEntry = path.join(source, entry.name);
    const destinationEntry = path.join(destination, entry.name);
    if (!entry.name.startsWith('@')) {
      if (!packedNames.has(entry.name) && !existsSync(destinationEntry)) {
        symlinkSync(realpathSync(sourceEntry), destinationEntry, 'dir');
      }
      continue;
    }
    const packedScope = [...packedNames].some((name) => name.startsWith(`${entry.name}/`));
    if (!packedScope) {
      if (!existsSync(destinationEntry)) {
        symlinkSync(realpathSync(sourceEntry), destinationEntry, 'dir');
      }
      continue;
    }
    mkdirSync(destinationEntry, { recursive: true });
    for (const scopedEntry of readdirSync(sourceEntry, { withFileTypes: true })) {
      const packageName = `${entry.name}/${scopedEntry.name}`;
      const scopedDestination = path.join(destinationEntry, scopedEntry.name);
      if (!packedNames.has(packageName) && !existsSync(scopedDestination)) {
        symlinkSync(
          realpathSync(path.join(sourceEntry, scopedEntry.name)),
          scopedDestination,
          'dir',
        );
      }
    }
  }
}

function declaredDependencyNames(manifest) {
  const names = new Set();
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) names.add(name);
  }
  return [...names];
}

function linkDeclaredExternalDependencies(stageRoot, repositoryRoot, packedNames, packedManifests) {
  const nodeModules = path.join(stageRoot, 'node_modules');
  const sourcePackages = new Map(
    releasePackages().map((pkg) => [
      pkg.name,
      path.join(repositoryRoot, path.relative(defaultRepoRoot, pkg.dirPath)),
    ]),
  );
  for (const { manifest, name } of packedManifests) {
    for (const dependencyName of declaredDependencyNames(manifest)) {
      if (packedNames.has(dependencyName)) continue;
      const destination = packageDestination(nodeModules, dependencyName);
      if (existsSync(destination)) continue;
      const packageSource = sourcePackages.get(name);
      const candidates = [
        packageSource
          ? path.join(packageSource, 'node_modules', ...dependencyName.split('/'))
          : null,
        path.join(repositoryRoot, 'node_modules', ...dependencyName.split('/')),
      ].filter(Boolean);
      const source = candidates.find((candidate) => existsSync(candidate));
      if (!source) {
        throw new Error(`${name}: frozen repository install cannot resolve ${dependencyName}`);
      }
      mkdirSync(path.dirname(destination), { recursive: true });
      symlinkSync(realpathSync(source), destination, 'dir');
    }
  }
}

function observedTarballFiles(entries) {
  return entries.map((entry) => ({
    path: entry.name.slice('package/'.length),
    sha256: sha256(entry.data),
    executable: entry.executable,
  }));
}

function stagePackedWorkload(scenario, root, repositoryRoot) {
  const { manifest } = readPackedWorkloadManifest(scenario, root);
  const stageRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-devex-benchmark-'));
  try {
    const packedManifests = [];
    for (const artifact of manifest.artifacts) {
      const absolute = regularFileInsideRoot(root, artifact.path, 'packed artifact');
      const compressed = readPackageTarballSnapshot(absolute);
      const observedDigest = sha256(compressed);
      if (observedDigest !== artifact.sha256) {
        throw new Error(
          `packed artifact digest mismatch for ${artifact.path}: expected ${artifact.sha256}, observed ${observedDigest}`,
        );
      }
      const entries = validatedPackageTarballEntries(compressed);
      if (!sameJson(observedTarballFiles(entries), artifact.files)) {
        throw new Error(`${artifact.name}: tarball file census does not match workload manifest`);
      }
      const packageManifestEntry = entries.find((entry) => entry.name === 'package/package.json');
      const packageManifest = JSON.parse(packageManifestEntry.data.toString('utf8'));
      if (packageManifest.name !== artifact.name) {
        throw new Error(`${artifact.name}: tarball package name does not match workload manifest`);
      }
      packedManifests.push({ manifest: packageManifest, name: artifact.name });
      const destination =
        artifact.role === 'consumer'
          ? stageRoot
          : packageDestination(path.join(stageRoot, 'node_modules'), artifact.name);
      mkdirSync(destination, { recursive: true });
      for (const entry of entries) {
        const relative = entry.name.slice('package/'.length);
        const output = resolveInsideRoot(destination, relative, `${artifact.name} tar entry`);
        mkdirSync(path.dirname(output), { recursive: true });
        writeFileSync(output, entry.data, {
          flag: 'wx',
          mode: entry.executable ? 0o755 : 0o644,
        });
      }
    }
    const packedPackages = new Set(
      manifest.artifacts
        .filter((artifact) => artifact.role === 'package')
        .map((artifact) => artifact.name),
    );
    if (packedPackages.size > 0) {
      linkExternalDependencies(stageRoot, repositoryRoot, packedPackages);
      linkDeclaredExternalDependencies(stageRoot, repositoryRoot, packedPackages, packedManifests);
    }
    regularFileInsideRoot(stageRoot, manifest.entrypoint, 'packed profile entrypoint');
    if (manifest.browserBuild === undefined) {
      for (const bootstrap of manifest.browserBootstrap) {
        regularFileInsideRoot(stageRoot, bootstrap, 'browser bootstrap file');
      }
    }
    return { manifest, stageRoot };
  } catch (error) {
    rmSync(stageRoot, { recursive: true, force: true });
    throw error;
  }
}

function commandCwdInsideStage(stageRoot, relative) {
  if (relative === '.') return nonSymlinkRootDirectory(stageRoot, 'benchmark command cwd');
  return nonSymlinkDescendant(stageRoot, relative, {
    kind: 'directory',
    label: 'benchmark command cwd',
  });
}

function assertProfileInvocation(result, context, requireMarker) {
  if (result.exitCode !== 0 || result.signal || result.error) {
    throw new Error(
      `${context.phase} ${context.role} sample ${context.sampleIndex + 1} failed: exit=${String(
        result.exitCode,
      )} signal=${String(result.signal)} ${result.error ?? result.stderr ?? ''}`.trim(),
    );
  }
  if (!requireMarker) return null;
  const marker =
    /^kovo-benchmark-phase\/v2 phase=(cold|warm|oneFileIncremental) revision=([01]) edit=(baseline|applied) analysis=(sha256:[0-9a-f]{64}) client=([0-9a-f]{64})\r?\n?$/u.exec(
      result.stdout ?? '',
    );
  if (!marker || marker[1] !== context.executionPhase) {
    throw new Error(
      `${context.phase} ${context.role} sample ${context.sampleIndex + 1} did not return the code-owned phase marker`,
    );
  }
  const revision = Number(marker[2]);
  const expectedEdit = context.executionPhase === 'oneFileIncremental' ? 'applied' : 'baseline';
  if (marker[3] !== expectedEdit || revision !== context.expectedRevision) {
    throw new Error(
      `${context.phase} ${context.role} sample ${context.sampleIndex + 1} returned the wrong edit revision`,
    );
  }
  return {
    analysisDigest: marker[4],
    clientDigest: marker[5],
    revision,
  };
}

function phaseCensus(observations, samples) {
  const expected = {
    cold: { prime: 0, timed: samples },
    warm: { prime: samples, timed: samples },
    oneFileIncremental: { prime: samples, timed: samples },
  };
  const counts = Object.fromEntries(PHASES.map((phase) => [phase, { prime: 0, timed: 0 }]));
  const incrementalRevisions = [];
  for (const observation of observations) {
    counts[observation.phase][observation.role] += 1;
    if (observation.phase === 'oneFileIncremental' && observation.role === 'timed') {
      incrementalRevisions.push(observation.revision);
    }
  }
  if (!sameJson(counts, expected)) {
    throw new Error(
      'benchmark phase census does not contain every required prime and timed sample',
    );
  }
  const expectedRevisions = Array.from({ length: samples }, (_, index) =>
    index % 2 === 0 ? 1 : 0,
  );
  if (!sameJson(incrementalRevisions, expectedRevisions)) {
    throw new Error('incremental benchmark edits did not alternate across restored source samples');
  }
  const digestByRevision = new Map();
  for (const observation of observations) {
    const previous = digestByRevision.get(observation.revision);
    if (previous !== undefined && previous !== observation.analysisDigest) {
      throw new Error('benchmark source revision mapped to inconsistent analyzed-input digests');
    }
    digestByRevision.set(observation.revision, observation.analysisDigest);
  }
  if (
    digestByRevision.size !== 2 ||
    digestByRevision.get(0) === digestByRevision.get(1)
  ) {
    throw new Error('benchmark phase census did not prove two distinct analyzed source revisions');
  }
  return {
    schema: KOVO_PHASE_CENSUS_SCHEMA,
    samples,
    counts,
    incrementalRevisions,
    analysisInputs: observations.map((observation) => ({
      phase: observation.phase,
      role: observation.role,
      sampleIndex: observation.sampleIndex,
      revision: observation.revision,
      analysisDigest: observation.analysisDigest,
      clientDigest: observation.clientDigest,
    })),
  };
}

function validatePhaseCensus(census, sampleCount, label) {
  const findings = [];
  if (
    census?.schema !== KOVO_PHASE_CENSUS_SCHEMA ||
    !Number.isInteger(sampleCount) ||
    census?.samples !== sampleCount
  ) {
    findings.push(`${label} must bind the report sample count`);
    return findings;
  }
  const expectedCounts = {
    cold: { prime: 0, timed: sampleCount },
    warm: { prime: sampleCount, timed: sampleCount },
    oneFileIncremental: { prime: sampleCount, timed: sampleCount },
  };
  if (!sameJson(census.counts, expectedCounts)) {
    findings.push(`${label}.counts must contain every required prime and timed sample`);
  }
  const expectedRevisions = Array.from({ length: sampleCount }, (_, index) =>
    index % 2 === 0 ? 1 : 0,
  );
  if (!sameJson(census.incrementalRevisions, expectedRevisions)) {
    findings.push(`${label}.incrementalRevisions must prove alternating restored source edits`);
  }
  const expectedObservations = [];
  for (const phase of PHASES) {
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const baseline = sampleIndex % 2;
      if (phase !== 'cold') {
        expectedObservations.push({
          phase,
          role: 'prime',
          sampleIndex,
          revision: phase === 'oneFileIncremental' ? baseline : 0,
        });
      }
      expectedObservations.push({
        phase,
        role: 'timed',
        sampleIndex,
        revision:
          phase === 'oneFileIncremental' ? (baseline === 0 ? 1 : 0) : 0,
      });
    }
  }
  if (
    !Array.isArray(census.analysisInputs) ||
    census.analysisInputs.length !== expectedObservations.length
  ) {
    findings.push(`${label}.analysisInputs must census every prime and timed compiler analysis`);
  } else {
    const digestByRevision = new Map();
    for (let index = 0; index < expectedObservations.length; index += 1) {
      const expected = expectedObservations[index];
      const observed = census.analysisInputs[index];
      if (
        observed?.phase !== expected.phase ||
        observed?.role !== expected.role ||
        observed?.sampleIndex !== expected.sampleIndex ||
        observed?.revision !== expected.revision
      ) {
        findings.push(`${label}.analysisInputs[${index}] does not match the phase census`);
        continue;
      }
      if (!/^sha256:[0-9a-f]{64}$/u.test(observed.analysisDigest ?? '')) {
        findings.push(`${label}.analysisInputs[${index}].analysisDigest is invalid`);
      }
      if (!/^[0-9a-f]{64}$/u.test(observed.clientDigest ?? '')) {
        findings.push(`${label}.analysisInputs[${index}].clientDigest is invalid`);
      }
      const previous = digestByRevision.get(observed.revision);
      if (previous !== undefined && previous !== observed.analysisDigest) {
        findings.push(`${label}.analysisInputs maps one revision to multiple source digests`);
      }
      digestByRevision.set(observed.revision, observed.analysisDigest);
    }
    if (
      digestByRevision.size !== 2 ||
      digestByRevision.get(0) === digestByRevision.get(1)
    ) {
      findings.push(`${label}.analysisInputs must prove two distinct analyzed source revisions`);
    }
  }
  return findings;
}

function emitBrowserBundle(manifest, stageRoot, options = {}) {
  if (manifest.browserBuild === undefined) return;
  const cwd = commandCwdInsideStage(stageRoot, manifest.browserBuild.cwd);
  const spawn = options.spawnSync ?? spawnSync;
  const [executable, ...args] = manifest.browserBuild.command;
  const result = spawn(executable, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error(
      `browser bundle failed: ${
        result.error?.message ??
        result.signal ??
        result.stderr?.trim() ??
        result.stdout?.trim() ??
        `exit ${String(result.status)}`
      }`,
    );
  }
}

/**
 * Run all three scorecard timing profiles. Tests inject `measure` so statistical and schema
 * behavior are deterministic; production calls use the real monotonic/RSS measurement.
 */
export function runBenchmarkScenario(scenario, options = {}) {
  const findings = validateBenchmarkScenario(scenario);
  if (findings.length > 0)
    throw new Error(`Invalid benchmark scenario:\n- ${findings.join('\n- ')}`);
  if (scenario.name !== 'kovo-packed-check' && options.allowFixtureScenario !== true) {
    throw new Error(
      'production benchmark measurement accepts only the code-owned fresh Kovo scenario',
    );
  }
  const samples = options.samples ?? 5;
  if (!Number.isInteger(samples) || samples <= 0) {
    throw new Error('samples must be a positive integer');
  }
  const root = path.resolve(options.root ?? defaultRepoRoot);
  const observedEnvironment = currentBenchmarkEnvironment(options);
  const environmentFindings = observedEnvironmentFindings(scenario, observedEnvironment);
  if (environmentFindings.length > 0) {
    throw new Error(
      `Benchmark environment does not match the pinned scenario:\n- ${environmentFindings.join('\n- ')}`,
    );
  }
  const repositoryRoot = path.resolve(options.repositoryRoot ?? defaultRepoRoot);
  let acquired = null;
  try {
    let executionScenario = scenario;
    let executionRoot = root;
    let executionRepositoryRoot = repositoryRoot;
    if (scenario.name === 'kovo-packed-check') {
      const acquire = options.acquireFreshKovoScenario ?? acquireFreshKovoScenario;
      acquired = acquire(observedEnvironment, { repositoryRoot });
      validateFreshKovoScenario(acquired, observedEnvironment);
      if (!sameJson(scenario, acquired.scenario)) {
        throw new Error(
          'Kovo benchmark scenario does not match artifacts freshly produced from the exact clean source revision',
        );
      }
      executionScenario = acquired.scenario;
      executionRoot = acquired.root;
      executionRepositoryRoot = acquired.repositoryRoot;
    }
    const measure = options.measure ?? ((command, context) => measureCommand(command, context));
    const metrics = {};
    const commands = expectedScenarioCommands();
    const observations = [];
    const requireMarker = executionScenario.name === 'kovo-packed-check';

    for (const phase of PHASES) {
      const phaseConfig = commands[phase];
      const durationSamples = [];
      const rssSamples = [];
      for (let index = 0; index < samples; index += 1) {
        const staged = stagePackedWorkload(
          executionScenario,
          executionRoot,
          executionRepositoryRoot,
        );
        try {
          const cwd = commandCwdInsideStage(staged.stageRoot, phaseConfig.cwd);
          const baseline = index % 2;
          const invocationEnv =
            phase === 'oneFileIncremental'
              ? { KOVO_DEVEX_EDIT_BASELINE: String(baseline) }
              : undefined;
          if (phase !== 'cold') {
            const primeContext = {
              cwd,
              env: invocationEnv,
              executionPhase: 'warm',
              expectedRevision: phase === 'oneFileIncremental' ? baseline : 0,
              phase,
              role: 'prime',
              sampleIndex: index,
              stageRoot: staged.stageRoot,
            };
            const prime = measure(commands.warm.command, primeContext);
            const evidence = assertProfileInvocation(prime, primeContext, requireMarker);
            const revision = evidence?.revision ?? primeContext.expectedRevision;
            observations.push({
              phase,
              role: 'prime',
              revision,
              analysisDigest:
                evidence?.analysisDigest ?? `sha256:${String(revision).repeat(64)}`,
              clientDigest: evidence?.clientDigest ?? 'f'.repeat(64),
              sampleIndex: index,
            });
          }
          const timedContext = {
            cwd,
            env: invocationEnv,
            executionPhase: phase,
            expectedRevision: phase === 'oneFileIncremental' ? (baseline === 0 ? 1 : 0) : 0,
            phase,
            role: 'timed',
            sampleIndex: index,
            stageRoot: staged.stageRoot,
          };
          const result = measure(phaseConfig.command, timedContext);
          const evidence = assertProfileInvocation(result, timedContext, requireMarker);
          const revision = evidence?.revision ?? timedContext.expectedRevision;
          observations.push({
            phase,
            role: 'timed',
            revision,
            analysisDigest:
              evidence?.analysisDigest ?? `sha256:${String(revision).repeat(64)}`,
            clientDigest: evidence?.clientDigest ?? 'f'.repeat(64),
            sampleIndex: index,
          });
          if (!finiteNonNegative(result.durationMs)) {
            throw new Error(`${phase} sample ${index + 1} returned an invalid duration`);
          }
          durationSamples.push(result.durationMs);
          if (result.peakRssBytes !== null && result.peakRssBytes !== undefined) {
            if (!finiteNonNegative(result.peakRssBytes)) {
              throw new Error(`${phase} sample ${index + 1} returned invalid peak RSS`);
            }
            rssSamples.push(result.peakRssBytes);
          }
        } finally {
          rmSync(staged.stageRoot, { recursive: true, force: true });
        }
      }
      metrics[`check.${phase}.durationMs`] = {
        unit: 'ms',
        samples: durationSamples,
        summary: sampleSummary(durationSamples),
      };
      metrics[`check.${phase}.peakRssBytes`] = {
        unit: 'bytes',
        samples: rssSamples,
        summary: rssSamples.length === 0 ? null : sampleSummary(rssSamples),
      };
    }

    const browserStage = stagePackedWorkload(
      executionScenario,
      executionRoot,
      executionRepositoryRoot,
    );
    let browser;
    try {
      emitBrowserBundle(browserStage.manifest, browserStage.stageRoot, {
        spawnSync: options.spawnSync,
      });
      browser = browserBootstrapBytes(browserStage.manifest.browserBootstrap, {
        root: browserStage.stageRoot,
      });
    } finally {
      rmSync(browserStage.stageRoot, { recursive: true, force: true });
    }
    metrics['browser.bootstrapBytes'] = {
      unit: 'bytes',
      samples: [browser.bytes],
      summary: sampleSummary([browser.bytes]),
      files: browser.files,
    };
    const { manifest } = readPackedWorkloadManifest(executionScenario, executionRoot);
    const consumer = manifest.artifacts.find((artifact) => artifact.role === 'consumer');
    const census = phaseCensus(observations, samples);

    return {
      schema: DEVEX_BENCHMARK_REPORT_SCHEMA,
      scenario: {
        name: scenario.name,
        digest: benchmarkScenarioDigest(scenario),
        definition: structuredClone(scenario),
      },
      provenance: {
        sourceCommit: observedEnvironment.sourceCommit,
        sourceTree: observedEnvironment.sourceTree,
        packageManager: observedEnvironment.packageManager,
        osImage: observedEnvironment.osImage,
        workloadManifest: structuredClone(scenario.provenance.workloadManifest),
        commandDigest: DEVEX_PACKED_PROFILE_COMMAND_DIGEST,
        packedArtifacts: structuredClone(scenario.provenance.packedArtifacts),
        supportFiles: structuredClone(consumer.files),
        ...(scenario.provenance.producerAttestation === undefined
          ? {}
          : { producerAttestation: structuredClone(scenario.provenance.producerAttestation) }),
      },
      runner: environmentRunnerFingerprint(observedEnvironment),
      sampleCount: samples,
      phaseCensus: census,
      commands,
      metrics,
    };
  } finally {
    if (acquired !== null) acquired.dispose();
  }
}

function expectedScenarioCommands() {
  return structuredClone(PACKED_PROFILE_COMMANDS);
}

function expectedReportProvenance(scenario) {
  return {
    sourceCommit: scenario.provenance.sourceCommit,
    sourceTree: scenario.provenance.sourceTree,
    packageManager: scenario.environment.packageManager,
    osImage: scenario.environment.osImage,
    workloadManifest: structuredClone(scenario.provenance.workloadManifest),
    commandDigest: scenario.profile.commandDigest,
    packedArtifacts: scenario.provenance.packedArtifacts.map((artifact) => ({
      name: artifact.name,
      path: artifact.path.split(path.sep).join('/'),
      sha256: artifact.sha256,
    })),
    supportFiles: structuredClone(scenario.provenance.supportFiles),
    ...(scenario.provenance.producerAttestation === undefined
      ? {}
      : { producerAttestation: structuredClone(scenario.provenance.producerAttestation) }),
  };
}

function validateBenchmarkReportIdentity(report, label = 'report') {
  const findings = [];
  if (report?.schema !== DEVEX_BENCHMARK_REPORT_SCHEMA) {
    findings.push(`${label}.schema must be ${DEVEX_BENCHMARK_REPORT_SCHEMA}`);
  }
  const definition = report?.scenario?.definition;
  const scenarioFindings = validateBenchmarkScenario(definition);
  findings.push(...scenarioFindings.map((finding) => `${label}.${finding}`));
  if (scenarioFindings.length > 0) return findings;
  const expectedDigest = benchmarkScenarioDigest(definition);
  if (report.scenario.name !== definition.name) {
    findings.push(`${label}.scenario.name does not match its definition`);
  }
  if (report.scenario.digest !== expectedDigest) {
    findings.push(`${label}.scenario.digest does not match its full definition`);
  }
  if (!sameJson(report.provenance, expectedReportProvenance(definition))) {
    findings.push(`${label}.provenance does not match its scenario definition`);
  }
  findings.push(...validateRunnerFingerprint(report.runner, `${label}.runner`));
  if (!sameJson(report.runner, environmentRunnerFingerprint(definition.environment))) {
    findings.push(`${label}.runner does not match its scenario environment`);
  }
  if (!sameJson(report.commands, expectedScenarioCommands())) {
    findings.push(`${label}.commands do not match its full scenario definition`);
  }
  if (!Number.isInteger(report.sampleCount) || report.sampleCount <= 0) {
    findings.push(`${label}.sampleCount must be a positive integer`);
  } else {
    findings.push(
      ...validatePhaseCensus(report.phaseCensus, report.sampleCount, `${label}.phaseCensus`),
    );
  }
  return findings;
}

function workloadIdentity(report) {
  return {
    scenario: {
      name: report.scenario.name,
      digest: report.scenario.digest,
    },
    provenance: structuredClone(report.provenance),
  };
}

function validateWorkloadIdentity(identity, label) {
  const findings = [];
  if (typeof identity?.scenario?.name !== 'string' || identity.scenario.name.trim().length === 0) {
    findings.push(`${label}.scenario.name must be a non-empty string`);
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(identity?.scenario?.digest ?? '')) {
    findings.push(`${label}.scenario.digest must be an exact SHA-256 digest`);
  }
  if (!validGitObjectId(identity?.provenance?.sourceCommit)) {
    findings.push(`${label}.provenance.sourceCommit must be an exact Git object ID`);
  }
  if (identity?.provenance?.sourceTree !== 'clean') {
    findings.push(`${label}.provenance.sourceTree must be clean`);
  }
  if (
    !/^[a-z0-9][a-z0-9._-]*@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(
      identity?.provenance?.packageManager ?? '',
    )
  ) {
    findings.push(`${label}.provenance.packageManager must pin an exact semantic version`);
  }
  if (!/^[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$/u.test(identity?.provenance?.osImage ?? '')) {
    findings.push(`${label}.provenance.osImage must be an immutable image digest`);
  }
  if (
    !safeRepositoryRelativePath(identity?.provenance?.workloadManifest?.path) ||
    !/^sha256:[0-9a-f]{64}$/u.test(identity?.provenance?.workloadManifest?.sha256 ?? '')
  ) {
    findings.push(`${label}.provenance.workloadManifest must bind a relative path and SHA-256`);
  }
  if (identity?.provenance?.commandDigest !== DEVEX_PACKED_PROFILE_COMMAND_DIGEST) {
    findings.push(`${label}.provenance.commandDigest must bind the code-owned packed profiles`);
  }
  findings.push(
    ...validatePackedArtifacts(
      identity?.provenance?.packedArtifacts,
      `${label}.provenance.packedArtifacts`,
    ),
  );
  findings.push(
    ...validateWorkloadFiles(
      identity?.provenance?.supportFiles,
      `${label}.provenance.supportFiles`,
    ),
  );
  if (identity?.scenario?.name === 'kovo-packed-check') {
    findings.push(
      ...validateKovoProductionScenario({ provenance: identity.provenance }, `${label}.scenario`),
    );
  }
  return findings;
}

function baselineSourceBytes(record, options) {
  const sourcePath = record?.baselineReport?.path;
  if (!safeRepositoryRelativePath(sourcePath)) return null;
  const supplied = options.baselineReports?.get(sourcePath);
  if (supplied !== undefined) {
    return Buffer.isBuffer(supplied) ? supplied : Buffer.from(supplied);
  }
  if (!options.repoRoot) return null;
  const absolute = path.resolve(options.repoRoot, sourcePath);
  const root = path.resolve(options.repoRoot);
  if (!existsSync(root) || !lstatSync(root).isDirectory()) return null;
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) return null;
  if (
    !existsSync(absolute) ||
    !lstatSync(absolute).isFile() ||
    lstatSync(absolute).isSymbolicLink()
  ) {
    return null;
  }
  const realRoot = realpathSync(root);
  const realSource = realpathSync(absolute);
  if (realSource === realRoot || !realSource.startsWith(`${realRoot}${path.sep}`)) return null;
  return readFileSync(absolute);
}

function validateRatificationProvenance(metricId, metric, record, budgets, options) {
  const findings = [];
  const source = record?.baselineReport;
  if (!safeRepositoryRelativePath(source?.path)) {
    findings.push(`${metricId}.ratification.baselineReport.path must be repository-relative`);
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(source?.sha256 ?? '')) {
    findings.push(`${metricId}.ratification.baselineReport.sha256 is invalid`);
  }
  if (source?.schema !== DEVEX_BENCHMARK_REPORT_SCHEMA) {
    findings.push(
      `${metricId}.ratification.baselineReport.schema must be ${DEVEX_BENCHMARK_REPORT_SCHEMA}`,
    );
  }
  if (typeof source?.scenarioName !== 'string' || source.scenarioName.trim().length === 0) {
    findings.push(`${metricId}.ratification.baselineReport.scenarioName is required`);
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(source?.scenarioDigest ?? '')) {
    findings.push(`${metricId}.ratification.baselineReport.scenarioDigest is invalid`);
  }
  if (findings.length > 0) return findings;

  const bytes = baselineSourceBytes(record, options);
  if (bytes === null) {
    findings.push(
      `${metricId}.ratification baseline report provenance could not be verified: ${source.path}`,
    );
    return findings;
  }
  if (sha256(bytes) !== source.sha256) {
    findings.push(`${metricId}.ratification baseline report digest does not match ${source.path}`);
    return findings;
  }

  let report;
  try {
    report = JSON.parse(bytes.toString('utf8'));
  } catch {
    findings.push(`${metricId}.ratification baseline report is not valid JSON`);
    return findings;
  }
  const reportIdentityFindings = validateBenchmarkReportIdentity(
    report,
    `${metricId}.ratification.baselineReport`,
  );
  findings.push(...reportIdentityFindings);
  if (reportIdentityFindings.length > 0) return findings;
  if (
    report.schema !== source.schema ||
    report.scenario?.name !== source.scenarioName ||
    report.scenario?.digest !== source.scenarioDigest
  ) {
    findings.push(`${metricId}.ratification baseline report identity does not match provenance`);
  }
  if (!sameJson(report.runner, record.runnerFingerprint)) {
    findings.push(`${metricId}.ratification runner does not match its baseline report`);
  }
  const reportWorkloadIdentity = workloadIdentity(report);
  if (!sameJson(reportWorkloadIdentity, record.workloadIdentity)) {
    findings.push(`${metricId}.ratification workload does not match its baseline report`);
  }
  if (
    budgets?.workload?.status === 'ratified' &&
    !sameJson(reportWorkloadIdentity, budgets.workload.identity)
  ) {
    findings.push(`${metricId}.ratification workload differs from budgets.workload`);
  }
  const baselineMetric = report.metrics?.[metricId];
  if (baselineMetric?.unit !== metric.unit) {
    findings.push(`${metricId}.ratification baseline metric unit does not match budget unit`);
  }
  const samples = baselineMetric?.samples;
  const requiredSamples =
    metric.sampling === 'deterministic'
      ? 1
      : Number.isInteger(budgets.procedure?.minimumStatisticalSamples)
        ? budgets.procedure.minimumStatisticalSamples
        : Number.POSITIVE_INFINITY;
  if (
    !Array.isArray(samples) ||
    samples.length < requiredSamples ||
    samples.some((value) => !finiteNonNegative(value))
  ) {
    findings.push(
      `${metricId}.ratification baseline report must contain ${requiredSamples} valid samples`,
    );
    return findings;
  }
  if (!STATISTICS.has(record.statistic)) return findings;
  const expectedBaseline = statisticValue(samples, record.statistic);
  const expectedNoise = metric.sampling === 'deterministic' ? 0 : medianAbsoluteDeviation(samples);
  if (record.sampleCount !== samples.length) {
    findings.push(`${metricId}.ratification.sampleCount does not match its baseline report`);
  }
  if (record.baseline !== expectedBaseline) {
    findings.push(`${metricId}.ratification.baseline does not match its baseline report`);
  }
  if (record.noise !== expectedNoise) {
    findings.push(`${metricId}.ratification.noise does not match its baseline report`);
  }
  return findings;
}

export function validateBudgets(budgets, options = {}) {
  const findings = [];
  if (budgets?.schema !== DEVEX_BUDGETS_SCHEMA) {
    findings.push(`schema must be ${DEVEX_BUDGETS_SCHEMA}`);
  }
  if (!Number.isInteger(budgets?.procedure?.minimumStatisticalSamples)) {
    findings.push('procedure.minimumStatisticalSamples must be an integer');
  } else if (budgets.procedure.minimumStatisticalSamples < 5) {
    findings.push('procedure.minimumStatisticalSamples must be at least 5');
  }
  if (!STATISTICS.has(budgets?.procedure?.statistic)) {
    findings.push('procedure.statistic must be median or p95');
  }
  if (budgets?.procedure?.noiseStatistic !== 'median-absolute-deviation') {
    findings.push('procedure.noiseStatistic must be median-absolute-deviation');
  }
  if (budgets?.procedure?.thresholdFormula !== 'budget + noiseMultiplier * noise') {
    findings.push('procedure.thresholdFormula must be budget + noiseMultiplier * noise');
  }
  if (!RUNNER_STATUSES.has(budgets?.runner?.status)) {
    findings.push('runner.status must be unratified or ratified');
  }
  if (budgets?.runner?.status === 'unratified' && budgets.runner.fingerprint !== null) {
    findings.push('runner.fingerprint must be null until ratification');
  }
  if (budgets?.runner?.status === 'ratified') {
    findings.push(
      ...validateRunnerFingerprint(budgets.runner.fingerprint, 'runner.fingerprint', {
        requireNamed: true,
      }),
    );
  }
  if (!RUNNER_STATUSES.has(budgets?.workload?.status)) {
    findings.push('workload.status must be unratified or ratified');
  }
  if (budgets?.workload?.status === 'unratified' && budgets.workload.identity !== null) {
    findings.push('workload.identity must be null until ratification');
  }
  if (budgets?.workload?.status === 'ratified') {
    findings.push(...validateWorkloadIdentity(budgets.workload.identity, 'workload.identity'));
  }
  if (
    RUNNER_STATUSES.has(budgets?.runner?.status) &&
    RUNNER_STATUSES.has(budgets?.workload?.status) &&
    budgets.runner.status !== budgets.workload.status
  ) {
    findings.push('runner.status and workload.status must advance together');
  }
  if (!budgets?.metrics || typeof budgets.metrics !== 'object' || Array.isArray(budgets.metrics)) {
    findings.push('metrics must be an object');
    return findings;
  }
  const expectedMetricIds = Object.keys(DEVEX_METRIC_CONTRACT).sort(compareStrings);
  const actualMetricIds = Object.keys(budgets.metrics).sort(compareStrings);
  if (!sameJson(actualMetricIds, expectedMetricIds)) {
    findings.push(
      `metrics must contain the exact ${DEVEX_BUDGETS_SCHEMA} vocabulary: ${expectedMetricIds.join(', ')}`,
    );
  }
  for (const [metricId, metric] of Object.entries(budgets.metrics)) {
    const contract = DEVEX_METRIC_CONTRACT[metricId];
    if (contract && (metric?.unit !== contract.unit || metric?.sampling !== contract.sampling)) {
      findings.push(
        `${metricId} must retain unit=${contract.unit} and sampling=${contract.sampling}`,
      );
    }
    if (!METRIC_UNITS.has(metric?.unit)) findings.push(`${metricId}.unit must be bytes or ms`);
    if (metric?.direction !== 'max') findings.push(`${metricId}.direction must be max`);
    if (!['deterministic', 'statistical'].includes(metric?.sampling)) {
      findings.push(`${metricId}.sampling must be deterministic or statistical`);
    }
    if (metric?.provisionalTarget !== null && !finiteNonNegative(metric?.provisionalTarget)) {
      findings.push(`${metricId}.provisionalTarget must be null or a non-negative number`);
    }
    if (metric?.ratification === null) continue;
    const record = metric?.ratification;
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      findings.push(`${metricId}.ratification must be null or an object`);
      continue;
    }
    if (typeof record.targetRationale !== 'string' || record.targetRationale.trim().length < 12) {
      findings.push(`${metricId}.ratification.targetRationale must be substantive`);
    }
    if (!finiteNonNegative(record.budget)) findings.push(`${metricId}.ratification.budget invalid`);
    if (!finiteNonNegative(record.noise)) findings.push(`${metricId}.ratification.noise invalid`);
    if (!finiteNonNegative(record.noiseMultiplier)) {
      findings.push(`${metricId}.ratification.noiseMultiplier invalid`);
    }
    if (!finiteNonNegative(record.threshold)) {
      findings.push(`${metricId}.ratification.threshold invalid`);
    } else {
      const expected = record.budget + record.noiseMultiplier * record.noise;
      if (Math.abs(record.threshold - expected) > Number.EPSILON * Math.max(1, expected)) {
        findings.push(`${metricId}.ratification.threshold does not match the recorded formula`);
      }
    }
    const requiredSamples =
      metric.sampling === 'deterministic'
        ? 1
        : (budgets.procedure?.minimumStatisticalSamples ?? Number.POSITIVE_INFINITY);
    if (!Number.isInteger(record.sampleCount) || record.sampleCount < requiredSamples) {
      findings.push(`${metricId}.ratification.sampleCount invalid`);
    }
    if (!STATISTICS.has(record.statistic)) {
      findings.push(`${metricId}.ratification.statistic must be median or p95`);
    }
    if (!finiteNonNegative(record.baseline)) {
      findings.push(`${metricId}.ratification.baseline invalid`);
    }
    findings.push(
      ...validateRunnerFingerprint(
        record.runnerFingerprint,
        `${metricId}.ratification.runnerFingerprint`,
        { requireNamed: true },
      ),
    );
    findings.push(
      ...validateWorkloadIdentity(
        record.workloadIdentity,
        `${metricId}.ratification.workloadIdentity`,
      ),
    );
    if (
      budgets?.runner?.status === 'ratified' &&
      !sameJson(record.runnerFingerprint, budgets.runner.fingerprint)
    ) {
      findings.push(`${metricId}.ratification runner differs from budgets.runner`);
    }
    if (
      budgets?.workload?.status === 'ratified' &&
      !sameJson(record.workloadIdentity, budgets.workload.identity)
    ) {
      findings.push(`${metricId}.ratification workload differs from budgets.workload`);
    }
    findings.push(...validateRatificationProvenance(metricId, metric, record, budgets, options));
  }
  const ratifiedMetricCount = Object.values(budgets.metrics).filter(
    (metric) => metric?.ratification !== null,
  ).length;
  if (budgets?.runner?.status === 'unratified' && ratifiedMetricCount > 0) {
    findings.push('runner.status cannot be unratified while metric ratifications exist');
  }
  if (budgets?.runner?.status === 'ratified' && ratifiedMetricCount === 0) {
    findings.push('runner.status cannot be ratified without at least one metric ratification');
  }
  return findings;
}

function validateProposal(proposal) {
  const findings = [];
  if (proposal?.schema !== DEVEX_BUDGET_PROPOSAL_SCHEMA) {
    findings.push(`proposal.schema must be ${DEVEX_BUDGET_PROPOSAL_SCHEMA}`);
  }
  findings.push(
    ...validateRunnerFingerprint(proposal?.runnerFingerprint, 'proposal.runnerFingerprint', {
      requireNamed: true,
    }),
  );
  if (
    !proposal?.metrics ||
    typeof proposal.metrics !== 'object' ||
    Array.isArray(proposal.metrics)
  ) {
    findings.push('proposal.metrics must be an object');
  } else if (Object.keys(proposal.metrics).length === 0) {
    findings.push('proposal.metrics must contain at least one metric');
  }
  return findings;
}

/**
 * Ratification is deliberately a second operation over an already-recorded baseline. A proposal
 * supplies the product target and rationale; the harness never invents a threshold from one run.
 */
export function ratifyBudgets(budgets, baselineReport, proposal, options = {}) {
  if (
    baselineReport?.scenario?.name !== 'kovo-packed-check' ||
    !authenticatedProductionScenarios.has(options.authenticatedProductionScenario) ||
    !sameJson(baselineReport.scenario.definition, options.authenticatedProductionScenario)
  ) {
    throw new Error(
      'budget ratification requires the exact production scenario authenticated by the fresh code-owned pack producer',
    );
  }
  const findings = [
    ...validateBudgets(budgets, {
      baselineReports: options.baselineReports,
      repoRoot: options.repoRoot,
    }),
    ...validateProposal(proposal),
  ];
  findings.push(...validateBenchmarkReportIdentity(baselineReport, 'baselineReport'));
  if (!safeRepositoryRelativePath(options.baselineReportPath)) {
    findings.push('baselineReportPath must be a repository-relative path');
  }
  if (!Buffer.isBuffer(options.baselineReportBytes)) {
    findings.push('baselineReportBytes must contain the recorded baseline report');
  } else {
    try {
      if (!sameJson(JSON.parse(options.baselineReportBytes.toString('utf8')), baselineReport)) {
        findings.push('baselineReportBytes do not contain baselineReport');
      }
    } catch {
      findings.push('baselineReportBytes are not valid JSON');
    }
  }
  if (findings.length > 0)
    throw new Error(`Cannot ratify DevEx budgets:\n- ${findings.join('\n- ')}`);
  if (!sameJson(baselineReport.runner, proposal.runnerFingerprint)) {
    throw new Error('baseline runner fingerprint does not match proposal.runnerFingerprint');
  }
  if (
    budgets.runner.status === 'ratified' &&
    !sameJson(budgets.runner.fingerprint, baselineReport.runner)
  ) {
    throw new Error('baseline runner fingerprint does not match the existing ratified runner');
  }
  if (
    budgets.workload.status === 'ratified' &&
    !sameJson(budgets.workload.identity, workloadIdentity(baselineReport))
  ) {
    throw new Error('baseline workload identity does not match the existing ratified workload');
  }

  const updated = structuredClone(budgets);
  updated.runner = {
    status: 'ratified',
    fingerprint: structuredClone(baselineReport.runner),
  };
  updated.workload = {
    status: 'ratified',
    identity: workloadIdentity(baselineReport),
  };
  const baselineReportSource = {
    path: options.baselineReportPath.split(path.sep).join('/'),
    sha256: sha256(options.baselineReportBytes),
    schema: baselineReport.schema,
    scenarioName: baselineReport.scenario.name,
    scenarioDigest: baselineReport.scenario.digest,
  };

  for (const [metricId, proposed] of Object.entries(proposal.metrics)) {
    const metric = updated.metrics[metricId];
    if (!metric) throw new Error(`proposal references unknown metric: ${metricId}`);
    const baselineMetric = baselineReport.metrics?.[metricId];
    const samples = baselineMetric?.samples;
    if (baselineMetric?.unit !== metric.unit) {
      throw new Error(`${metricId} baseline unit does not match the budget unit`);
    }
    if (
      !Array.isArray(samples) ||
      samples.length === 0 ||
      samples.some((value) => !finiteNonNegative(value))
    ) {
      throw new Error(`baseline report has no valid samples for ${metricId}`);
    }
    const requiredSamples =
      metric.sampling === 'deterministic' ? 1 : updated.procedure.minimumStatisticalSamples;
    if (samples.length < requiredSamples) {
      throw new Error(
        `${metricId} has ${samples.length} baseline samples; ${requiredSamples} required`,
      );
    }
    if (!finiteNonNegative(proposed.budget)) {
      throw new Error(`${metricId} proposal budget must be a non-negative number`);
    }
    if (
      typeof proposed.targetRationale !== 'string' ||
      proposed.targetRationale.trim().length < 12
    ) {
      throw new Error(`${metricId} proposal targetRationale must be substantive`);
    }
    const statistic = proposed.statistic ?? updated.procedure.statistic;
    if (!STATISTICS.has(statistic)) throw new Error(`${metricId} statistic is unsupported`);
    const noiseMultiplier = proposed.noiseMultiplier;
    if (!finiteNonNegative(noiseMultiplier)) {
      throw new Error(`${metricId} proposal noiseMultiplier must be non-negative`);
    }
    const noise = metric.sampling === 'deterministic' ? 0 : medianAbsoluteDeviation(samples);
    const budget = proposed.budget;
    metric.ratification = {
      runnerFingerprint: structuredClone(baselineReport.runner),
      workloadIdentity: workloadIdentity(baselineReport),
      baselineReport: structuredClone(baselineReportSource),
      sampleCount: samples.length,
      statistic,
      baseline: statisticValue(samples, statistic),
      targetRationale: proposed.targetRationale,
      budget,
      noiseStatistic: updated.procedure.noiseStatistic,
      noise,
      noiseMultiplier,
      threshold: budget + noiseMultiplier * noise,
    };
  }
  const validation = validateBudgets(updated, {
    baselineReports: new Map([[baselineReportSource.path, options.baselineReportBytes]]),
    repoRoot: options.repoRoot,
  });
  if (validation.length > 0) {
    throw new Error(`Ratified DevEx budgets are invalid:\n- ${validation.join('\n- ')}`);
  }
  return updated;
}

export function evaluateBudgets(budgets, report, options = {}) {
  const findings = validateBudgets(budgets, options);
  if (findings.length > 0) throw new Error(`Invalid DevEx budgets:\n- ${findings.join('\n- ')}`);
  const reportFindings = validateBenchmarkReportIdentity(report);
  if (reportFindings.length > 0) {
    throw new Error(`Invalid benchmark report:\n- ${reportFindings.join('\n- ')}`);
  }
  const reportWorkload = workloadIdentity(report);
  const results = [];
  for (const [metricId, metric] of Object.entries(budgets.metrics)) {
    if (metric.ratification === null) {
      results.push({ metric: metricId, status: 'unratified' });
      continue;
    }
    if (!sameJson(reportWorkload, metric.ratification.workloadIdentity)) {
      results.push({
        metric: metricId,
        status: 'scenario-mismatch',
        expectedWorkload: metric.ratification.workloadIdentity,
        actualWorkload: reportWorkload,
      });
      continue;
    }
    if (!sameJson(report.runner, metric.ratification.runnerFingerprint)) {
      results.push({
        metric: metricId,
        status: 'runner-mismatch',
        expectedRunner: metric.ratification.runnerFingerprint,
        actualRunner: report.runner,
      });
      continue;
    }
    const samples = report.metrics?.[metricId]?.samples;
    if (!Array.isArray(samples) || samples.length === 0) {
      results.push({
        metric: metricId,
        status: 'missing',
        threshold: metric.ratification.threshold,
      });
      continue;
    }
    if (report.metrics[metricId].unit !== metric.unit) {
      results.push({
        metric: metricId,
        status: 'unit-mismatch',
        expectedUnit: metric.unit,
        actualUnit: report.metrics[metricId].unit ?? null,
      });
      continue;
    }
    const requiredSamples =
      metric.sampling === 'deterministic' ? 1 : budgets.procedure.minimumStatisticalSamples;
    if (samples.length < requiredSamples || samples.some((value) => !finiteNonNegative(value))) {
      results.push({
        metric: metricId,
        status: 'insufficient-samples',
        requiredSamples,
        actualSamples: samples.length,
        threshold: metric.ratification.threshold,
      });
      continue;
    }
    const observed = statisticValue(samples, metric.ratification.statistic);
    results.push({
      metric: metricId,
      status: observed > metric.ratification.threshold ? 'breach' : 'pass',
      observed,
      statistic: metric.ratification.statistic,
      threshold: metric.ratification.threshold,
    });
  }
  return {
    pass: results.every(
      (result) =>
        ![
          'breach',
          'insufficient-samples',
          'missing',
          'runner-mismatch',
          'scenario-mismatch',
          'unit-mismatch',
        ].includes(result.status),
    ),
    results,
  };
}

function workloadArtifact(name, role, artifactPath, compressed) {
  const entries = validatedPackageTarballEntries(compressed);
  const packageManifestEntry = entries.find((entry) => entry.name === 'package/package.json');
  if (!packageManifestEntry) throw new Error(`${name}: packed workload has no package manifest`);
  const packageManifest = JSON.parse(packageManifestEntry.data.toString('utf8'));
  if (packageManifest.name !== name) {
    throw new Error(`${name}: packed workload package name mismatch`);
  }
  return {
    name,
    role,
    path: artifactPath,
    sha256: sha256(compressed),
    files: observedTarballFiles(entries),
  };
}

function readKovoScenarioRecipe(repositoryRoot) {
  const recipe = readJson(path.join(repositoryRoot, KOVO_PACKED_RECIPE_PATH));
  if (
    recipe.schema !== DEVEX_SCENARIO_RECIPE_SCHEMA ||
    recipe.name !== 'kovo-packed-check' ||
    recipe.profile !== PACKED_PROFILE_ID ||
    recipe.producer !== KOVO_FRESH_PACK_PRODUCER_ID ||
    recipe.consumerSource !== 'scripts/devex-workloads/kovo-packed-check/package' ||
    recipe.output !== '.release/devex/kovo-packed-scenario.json' ||
    Object.hasOwn(recipe, 'packedReleaseManifest')
  ) {
    throw new Error(`${KOVO_PACKED_RECIPE_PATH} does not match the code-owned Kovo scenario`);
  }
  return recipe;
}

function producerCommand(spawn, executable, args, cwd, label, env = process.env) {
  const result = spawn(executable, args, {
    cwd,
    encoding: 'utf8',
    env,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error(
      `${label} failed: ${
        result.error?.message ??
        result.signal ??
        result.stderr?.trim() ??
        `exit ${String(result.status)}`
      }`,
    );
  }
  return result.stdout.trim();
}

/**
 * Build the public tarballs in a detached worktree at the exact clean source revision. The fixed
 * producer performs a frozen offline install and the code-owned publish build; no mutable ignored
 * `.release` input from the caller's worktree participates in the result.
 */
export function produceFreshKovoPackedRelease(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? defaultRepoRoot);
  const repositoryHead = checkedCommandOutput('git', ['rev-parse', 'HEAD'], repositoryRoot);
  const sourceCommit = options.sourceCommit ?? repositoryHead;
  if (!validGitObjectId(sourceCommit))
    throw new Error('fresh pack producer requires an exact HEAD');
  if (sourceCommit !== repositoryHead) {
    throw new Error('fresh pack producer source revision must equal the repository HEAD');
  }
  const sourceChanges = checkedCommandOutput(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    repositoryRoot,
  );
  if (sourceChanges !== '') {
    throw new Error('fresh pack producer requires a clean source revision');
  }
  const spawn = options.spawnSync ?? spawnSync;
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-devex-clean-source-pack-'));
  const sourceRoot = path.join(temporaryRoot, 'source');
  let attached = false;
  let disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    let removalError = null;
    if (attached) {
      const result = spawn('git', ['worktree', 'remove', '--force', sourceRoot], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (result.status !== 0 || result.signal || result.error) {
        removalError = new Error(
          `fresh pack worktree cleanup failed: ${
            result.error?.message ??
            result.signal ??
            result.stderr?.trim() ??
            `exit ${String(result.status)}`
          }`,
        );
      }
    }
    rmSync(temporaryRoot, { recursive: true, force: true });
    if (removalError) throw removalError;
  }

  try {
    producerCommand(
      spawn,
      'git',
      ['worktree', 'add', '--detach', sourceRoot, sourceCommit],
      repositoryRoot,
      'fresh pack worktree checkout',
    );
    attached = true;
    const checkedOutCommit = producerCommand(
      spawn,
      'git',
      ['rev-parse', 'HEAD'],
      sourceRoot,
      'fresh pack source identity',
    );
    if (checkedOutCommit !== sourceCommit) {
      throw new Error('fresh pack worktree did not check out the requested source revision');
    }
    producerCommand(
      spawn,
      'pnpm',
      ['install', '--offline', '--frozen-lockfile', '--ignore-scripts'],
      sourceRoot,
      'fresh pack frozen offline install',
    );
    producerCommand(
      spawn,
      'pnpm',
      ['run', 'check:publish'],
      sourceRoot,
      'fresh pack code-owned publish build',
    );
    const trackedChanges = producerCommand(
      spawn,
      'git',
      ['status', '--porcelain=v1', '--untracked-files=all'],
      sourceRoot,
      'fresh pack source cleanliness',
    );
    if (trackedChanges !== '') {
      throw new Error('fresh pack producer changed the exact source worktree');
    }
    regularFileInsideRoot(
      sourceRoot,
      '.release/packed-packages.json',
      'fresh packed release manifest',
    );
    return {
      dispose,
      producer: KOVO_FRESH_PACK_PRODUCER_ID,
      repositoryRoot: sourceRoot,
      sourceCommit,
    };
  } catch (error) {
    try {
      dispose();
    } catch (cleanupError) {
      throw new Error(`${error.message}; ${cleanupError.message}`, { cause: error });
    }
    throw error;
  }
}

function materializeFreshKovoScenario(repositoryRoot, environment) {
  const recipe = readKovoScenarioRecipe(repositoryRoot);
  const releaseManifestPath = regularFileInsideRoot(
    repositoryRoot,
    '.release/packed-packages.json',
    'fresh packed release manifest',
  );
  const releaseManifest = JSON.parse(readFileSync(releaseManifestPath, 'utf8'));
  const releaseEntries = validatePackedReleaseManifest(releaseManifest, releasePackages());
  const outputRelativeRoot = path.posix.dirname(recipe.output);
  const outputRoot = ensureNonSymlinkDescendantDirectory(
    repositoryRoot,
    outputRelativeRoot,
    'fresh Kovo scenario directory',
  );
  const outputTarballs = ensureNonSymlinkDescendantDirectory(
    repositoryRoot,
    `${outputRelativeRoot}/tarballs`,
    'fresh Kovo artifact directory',
  );
  const scenarioPath = nonSymlinkOutputPath(repositoryRoot, recipe.output, 'fresh Kovo scenario');

  const temporaryPackRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-devex-consumer-pack-'));
  try {
    const consumerTarball = packWithoutLifecycleScripts(
      {
        name: KOVO_BENCHMARK_CONSUMER,
        version: '1.0.0',
        dirPath: path.join(repositoryRoot, recipe.consumerSource),
      },
      temporaryPackRoot,
    );
    const consumerDestination = path.join(
      outputTarballs,
      'kovojs-devex-packed-check-consumer-1.0.0.tgz',
    );
    copyFileSync(consumerTarball, consumerDestination);
    const consumerBytes = readPackageTarballSnapshot(consumerDestination);
    const artifacts = [
      workloadArtifact(
        KOVO_BENCHMARK_CONSUMER,
        'consumer',
        path.relative(outputRoot, consumerDestination).split(path.sep).join('/'),
        consumerBytes,
      ),
    ];

    for (const releaseEntry of releaseEntries) {
      const tarball = regularFileInsideRoot(
        repositoryRoot,
        releaseEntry.tarball.split(path.sep).join('/'),
        `${releaseEntry.name} fresh release tarball`,
      );
      const tarballBytes = readPackageTarballSnapshot(tarball);
      verifyPackedAttestationBytes(releaseEntry, tarballBytes);
      const destination = path.join(outputTarballs, path.basename(tarball));
      copyFileSync(tarball, destination);
      artifacts.push(
        workloadArtifact(
          releaseEntry.name,
          'package',
          path.relative(outputRoot, destination).split(path.sep).join('/'),
          tarballBytes,
        ),
      );
    }

    const workloadManifest = {
      schema: DEVEX_PACKED_WORKLOAD_SCHEMA,
      profile: {
        id: PACKED_PROFILE_ID,
        commandDigest: DEVEX_PACKED_PROFILE_COMMAND_DIGEST,
      },
      entrypoint: 'profile.mjs',
      artifacts,
      browserBuild: structuredClone(BROWSER_BUILD_COMMAND),
      browserBootstrap: ['dist/.kovo/client/generated/app.client.js'],
    };
    const manifestFindings = validatePackedWorkloadManifest(workloadManifest);
    if (manifestFindings.length > 0) {
      throw new Error(
        `Generated Kovo workload manifest is invalid:\n- ${manifestFindings.join('\n- ')}`,
      );
    }
    const workloadManifestPath = nonSymlinkOutputPath(
      outputRoot,
      'packed-workload.json',
      'fresh Kovo workload manifest',
    );
    writeJson(workloadManifestPath, workloadManifest);
    const workloadManifestBytes = readFileSync(workloadManifestPath);
    const consumer = artifacts[0];
    const provenance = {
      sourceCommit: environment.sourceCommit,
      sourceTree: environment.sourceTree,
      workloadManifest: {
        path: path.basename(workloadManifestPath),
        sha256: sha256(workloadManifestBytes),
      },
      packedArtifacts: artifacts.map(({ name, path: artifactPath, sha256: digest }) => ({
        name,
        path: artifactPath,
        sha256: digest,
      })),
      supportFiles: structuredClone(consumer.files),
    };
    provenance.producerAttestation = createKovoProducerAttestation(provenance);
    const scenario = {
      schema: DEVEX_BENCHMARK_SCENARIO_SCHEMA,
      name: recipe.name,
      profile: structuredClone(workloadManifest.profile),
      environment: {
        runnerName: environment.runnerName,
        platform: environment.platform,
        arch: environment.arch,
        node: environment.node,
        cpuModel: environment.cpuModel,
        packageManager: environment.packageManager,
        osImage: environment.osImage,
      },
      provenance,
    };
    const scenarioFindings = validateBenchmarkScenario(scenario);
    if (scenarioFindings.length > 0) {
      throw new Error(
        `Generated Kovo benchmark scenario is invalid:\n- ${scenarioFindings.join('\n- ')}`,
      );
    }
    writeJson(scenarioPath, scenario);
    return { outputRoot, scenario, scenarioPath, workloadManifest, workloadManifestPath };
  } finally {
    rmSync(temporaryPackRoot, { recursive: true, force: true });
  }
}

function acquireFreshKovoScenario(environment, options = {}) {
  const produced = produceFreshKovoPackedRelease({
    repositoryRoot: options.repositoryRoot,
    sourceCommit: environment.sourceCommit,
  });
  try {
    const materialized = materializeFreshKovoScenario(produced.repositoryRoot, environment);
    authenticatedProductionScenarios.add(materialized.scenario);
    return {
      ...materialized,
      dispose: produced.dispose,
      producer: produced.producer,
      repositoryRoot: produced.repositoryRoot,
      root: materialized.outputRoot,
      sourceCommit: produced.sourceCommit,
    };
  } catch (error) {
    produced.dispose();
    throw error;
  }
}

function validateFreshKovoScenario(acquired, environment) {
  if (
    acquired?.producer !== KOVO_FRESH_PACK_PRODUCER_ID ||
    acquired?.sourceCommit !== environment.sourceCommit ||
    acquired?.scenario?.name !== 'kovo-packed-check' ||
    typeof acquired?.dispose !== 'function'
  ) {
    throw new Error('fresh Kovo scenario producer returned an invalid source-bound result');
  }
  const findings = validateBenchmarkScenario(acquired.scenario);
  if (findings.length > 0) {
    throw new Error(`Fresh Kovo scenario is invalid:\n- ${findings.join('\n- ')}`);
  }
  nonSymlinkRootDirectory(acquired.root, 'fresh Kovo scenario');
  nonSymlinkRootDirectory(acquired.repositoryRoot, 'fresh Kovo source');
}

function copyFreshScenarioToRepository(acquired, repositoryRoot) {
  const recipe = readKovoScenarioRecipe(repositoryRoot);
  const outputRelativeRoot = path.posix.dirname(recipe.output);
  const outputRoot = ensureNonSymlinkDescendantDirectory(
    repositoryRoot,
    outputRelativeRoot,
    'persisted Kovo scenario directory',
  );
  ensureNonSymlinkDescendantDirectory(
    repositoryRoot,
    `${outputRelativeRoot}/tarballs`,
    'persisted Kovo artifact directory',
  );
  const outputPath = nonSymlinkOutputPath(repositoryRoot, recipe.output, 'persisted Kovo scenario');
  for (const artifact of acquired.workloadManifest.artifacts) {
    const source = regularFileInsideRoot(
      acquired.root,
      artifact.path,
      `${artifact.name} freshly produced artifact`,
    );
    const destination = nonSymlinkOutputPath(
      outputRoot,
      artifact.path,
      `${artifact.name} persisted output`,
    );
    copyFileSync(source, destination);
  }
  const workloadManifestPath = path.join(outputRoot, 'packed-workload.json');
  nonSymlinkOutputPath(outputRoot, 'packed-workload.json', 'persisted Kovo workload manifest');
  copyFileSync(acquired.workloadManifestPath, workloadManifestPath);
  writeJson(outputPath, acquired.scenario);
  return {
    scenario: acquired.scenario,
    scenarioPath: outputPath,
    workloadManifest: acquired.workloadManifest,
    workloadManifestPath,
  };
}

function nonSymlinkOutputPath(root, relative, label) {
  const parent = path.posix.dirname(relative);
  if (parent !== '.') ensureNonSymlinkDescendantDirectory(root, parent, `${label} parent`);
  const absolute = resolveInsideRoot(root, relative, label);
  if (existsSync(absolute)) {
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`${label} must be a regular non-symlink output file`);
    }
  }
  return absolute;
}

/**
 * Produce and persist a convenience copy of the real scenario. Measurement never trusts this
 * ignored copy: every run independently reproduces the exact clean-source artifacts and compares
 * the supplied definition before executing from the fresh worktree.
 */
export function prepareKovoPackedScenario(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? defaultRepoRoot);
  const environment = currentBenchmarkEnvironment({
    repositoryRoot,
    observedEnvironment: options.observedEnvironment,
  });
  const acquire = options.acquireFreshKovoScenario ?? acquireFreshKovoScenario;
  const acquired = acquire(environment, { repositoryRoot });
  try {
    validateFreshKovoScenario(acquired, environment);
    return copyFreshScenarioToRepository(acquired, repositoryRoot);
  } finally {
    acquired.dispose();
  }
}

function parseArgs(argv) {
  const args = {
    budgets: path.join(defaultRepoRoot, 'devex-budgets.json'),
    samples: 5,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--scenario') args.scenario = argv[++index];
    else if (arg === '--samples') args.samples = Number(argv[++index]);
    else if (arg === '--output') args.output = argv[++index];
    else if (arg === '--budgets') args.budgets = argv[++index];
    else if (arg === '--evaluate') args.evaluate = true;
    else if (arg === '--ratify') args.ratify = true;
    else if (arg === '--baseline') args.baseline = argv[++index];
    else if (arg === '--proposal') args.proposal = argv[++index];
    else if (arg === '--write') args.write = true;
    else if (arg === '--check-budgets') args.checkBudgets = true;
    else if (arg === '--prepare-kovo-scenario') args.prepareKovoScenario = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/devex-benchmark.mjs --scenario <file> [--samples N] [--output <file>] [--evaluate]',
    '  node scripts/devex-benchmark.mjs --ratify --baseline <report> --proposal <file> [--write]',
    '  node scripts/devex-benchmark.mjs --check-budgets',
    '  node scripts/devex-benchmark.mjs --prepare-kovo-scenario',
    '',
    'Budgets remain non-binding until a separate baseline report and proposal ratify them.',
    '',
  ].join('\n');
}

export function runDevexBenchmark(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage());
    return 0;
  }
  if (args.prepareKovoScenario) {
    const prepared = prepareKovoPackedScenario();
    process.stdout.write(
      `Prepared ${path.relative(defaultRepoRoot, prepared.scenarioPath)} from authenticated packed Kovo packages.\n`,
    );
    return 0;
  }
  const budgets = readJson(path.resolve(args.budgets));
  if (args.checkBudgets) {
    const findings = validateBudgets(budgets, {
      repoRoot: path.dirname(path.resolve(args.budgets)),
    });
    if (findings.length > 0) {
      process.stderr.write(`${findings.join('\n')}\n`);
      return 1;
    }
    process.stdout.write(
      `${DEVEX_BUDGETS_SCHEMA} metrics=${Object.keys(budgets.metrics).length} ratified=${
        Object.values(budgets.metrics).filter((metric) => metric.ratification !== null).length
      }\nSCHEMA_VALID\n${
        Object.values(budgets.metrics).some((metric) => metric.ratification !== null)
          ? 'RATIFIED_BUDGETS_PRESENT'
          : 'BUDGETS_UNRATIFIED'
      }\n`,
    );
    return 0;
  }
  if (args.ratify) {
    if (!args.baseline || !args.proposal) {
      throw new Error('--ratify requires --baseline and --proposal');
    }
    const budgetsRoot = path.dirname(path.resolve(args.budgets));
    const baselinePath = path.resolve(args.baseline);
    const relativeBaselinePath = path.relative(budgetsRoot, baselinePath);
    const baselineBytes = readFileSync(baselinePath);
    const baselineReport = JSON.parse(baselineBytes.toString('utf8'));
    const productionScenarioFindings =
      baselineReport?.scenario?.name === 'kovo-packed-check'
        ? validateKovoProductionScenario(
            baselineReport.scenario.definition,
            'baselineReport.scenario',
          )
        : ['baselineReport.scenario.name must be kovo-packed-check'];
    if (productionScenarioFindings.length > 0) {
      throw new Error(
        `production ratification accepts only the authenticated code-owned Kovo producer:\n- ${productionScenarioFindings.join('\n- ')}`,
      );
    }
    const baselineEnvironment = {
      ...baselineReport.scenario.definition.environment,
      sourceCommit: baselineReport.scenario.definition.provenance.sourceCommit,
      sourceTree: baselineReport.scenario.definition.provenance.sourceTree,
    };
    const authenticated = acquireFreshKovoScenario(baselineEnvironment, {
      repositoryRoot: budgetsRoot,
    });
    try {
      validateFreshKovoScenario(authenticated, baselineEnvironment);
      if (!sameJson(authenticated.scenario, baselineReport.scenario.definition)) {
        throw new Error(
          'baseline scenario does not match the exact scenario reproduced by the fresh code-owned pack producer',
        );
      }
      const updated = ratifyBudgets(
        budgets,
        baselineReport,
        readJson(path.resolve(args.proposal)),
        {
          authenticatedProductionScenario: authenticated.scenario,
          baselineReportPath: relativeBaselinePath,
          baselineReportBytes: baselineBytes,
          repoRoot: budgetsRoot,
        },
      );
      if (args.write) writeJson(args.budgets, updated);
      else process.stdout.write(`${JSON.stringify(updated, null, 2)}\n`);
      return 0;
    } finally {
      authenticated.dispose();
    }
  }
  if (!args.scenario) {
    process.stderr.write(usage());
    return 2;
  }
  const scenarioPath = path.resolve(args.scenario);
  const report = runBenchmarkScenario(readJson(scenarioPath), {
    root: path.dirname(scenarioPath),
    samples: args.samples,
  });
  if (args.evaluate) {
    report.evaluation = evaluateBudgets(budgets, report, {
      repoRoot: path.dirname(path.resolve(args.budgets)),
    });
  }
  if (args.output) writeJson(args.output, report);
  else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.evaluation?.pass === false ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = runDevexBenchmark();
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
