#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { parseTimePeakRssBytes } from './lib/process-cost.mjs';
import { repoRoot as defaultRepoRoot } from './public-packages.mjs';

export const DEVEX_BUDGETS_SCHEMA = 'kovo-devex-budgets/v2';
export const DEVEX_BENCHMARK_SCENARIO_SCHEMA = 'kovo-devex-benchmark-scenario/v2';
export const DEVEX_BENCHMARK_REPORT_SCHEMA = 'kovo-devex-benchmark-report/v2';
export const DEVEX_BUDGET_PROPOSAL_SCHEMA = 'kovo-devex-budget-proposal/v2';

const PHASES = Object.freeze(['cold', 'warm', 'oneFileIncremental']);
const METRIC_UNITS = new Set(['bytes', 'ms']);
const STATISTICS = new Set(['median', 'p95']);
const RUNNER_STATUSES = new Set(['unratified', 'ratified']);

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

function safeRepositoryRelativePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !path.isAbsolute(value) &&
    value.split(/[\\/]/u).every((segment) => segment !== '' && segment !== '.' && segment !== '..')
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
  findings.push(
    ...validatePackedArtifacts(provenance?.packedArtifacts, `${label}.packedArtifacts`),
  );
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
  for (const phase of PHASES) {
    try {
      validateCommand(scenario?.phases?.[phase]?.command, `scenario.phases.${phase}.command`);
    } catch (error) {
      findings.push(error.message);
    }
  }
  const files = scenario?.browserBootstrap?.files;
  if (
    !Array.isArray(files) ||
    files.length === 0 ||
    files.some((file) => typeof file !== 'string')
  ) {
    findings.push('scenario.browserBootstrap.files must be a non-empty string array');
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
  return {
    runnerName,
    sourceCommit,
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

export function browserBootstrapBytes(files, options = {}) {
  const root = path.resolve(options.root ?? defaultRepoRoot);
  let total = 0;
  const measured = [];
  for (const relative of [...files].sort(compareStrings)) {
    const absolute = path.resolve(root, relative);
    const rootPrefix = `${root}${path.sep}`;
    if (absolute !== root && !absolute.startsWith(rootPrefix)) {
      throw new Error(`browser bootstrap path escapes scenario root: ${relative}`);
    }
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      throw new Error(`browser bootstrap file is missing: ${relative}`);
    }
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

function verifiedPackedArtifacts(artifacts, root) {
  const realRoot = realpathSync(root);
  return artifacts.map((artifact) => {
    const absolute = path.resolve(root, artifact.path);
    if (absolute === root || !absolute.startsWith(`${root}${path.sep}`)) {
      throw new Error(`packed artifact path escapes scenario root: ${artifact.path}`);
    }
    if (
      !existsSync(absolute) ||
      !lstatSync(absolute).isFile() ||
      lstatSync(absolute).isSymbolicLink()
    ) {
      throw new Error(`packed artifact must be a regular non-symlink file: ${artifact.path}`);
    }
    const realArtifact = realpathSync(absolute);
    if (!realArtifact.startsWith(`${realRoot}${path.sep}`)) {
      throw new Error(`packed artifact resolves outside scenario root: ${artifact.path}`);
    }
    const observedDigest = sha256(readFileSync(absolute));
    if (observedDigest !== artifact.sha256) {
      throw new Error(
        `packed artifact digest mismatch for ${artifact.path}: expected ${artifact.sha256}, observed ${observedDigest}`,
      );
    }
    return {
      name: artifact.name,
      path: artifact.path.split(path.sep).join('/'),
      sha256: observedDigest,
    };
  });
}

/**
 * Run all three scorecard timing profiles. Tests inject `measure` so statistical and schema
 * behavior are deterministic; production calls use the real monotonic/RSS measurement.
 */
export function runBenchmarkScenario(scenario, options = {}) {
  const findings = validateBenchmarkScenario(scenario);
  if (findings.length > 0)
    throw new Error(`Invalid benchmark scenario:\n- ${findings.join('\n- ')}`);
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
  const packedArtifacts = verifiedPackedArtifacts(scenario.provenance.packedArtifacts, root);
  const measure = options.measure ?? ((command, context) => measureCommand(command, context));
  const metrics = {};
  const commands = {};

  for (const phase of PHASES) {
    const phaseConfig = scenario.phases[phase];
    const durationSamples = [];
    const rssSamples = [];
    commands[phase] = {
      command: [...phaseConfig.command],
      cwd: phaseConfig.cwd ?? '.',
    };
    for (let index = 0; index < samples; index += 1) {
      const result = measure(phaseConfig.command, {
        cwd: path.resolve(root, phaseConfig.cwd ?? '.'),
        phase,
        sampleIndex: index,
      });
      if (result.exitCode !== 0 || result.signal || result.error) {
        throw new Error(
          `${phase} sample ${index + 1} failed: exit=${String(result.exitCode)} signal=${String(
            result.signal,
          )} ${result.error ?? result.stderr ?? ''}`.trim(),
        );
      }
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

  const browser = browserBootstrapBytes(scenario.browserBootstrap.files, { root });
  metrics['browser.bootstrapBytes'] = {
    unit: 'bytes',
    samples: [browser.bytes],
    summary: sampleSummary([browser.bytes]),
    files: browser.files,
  };

  return {
    schema: DEVEX_BENCHMARK_REPORT_SCHEMA,
    scenario: {
      name: scenario.name,
      digest: benchmarkScenarioDigest(scenario),
      definition: structuredClone(scenario),
    },
    provenance: {
      sourceCommit: observedEnvironment.sourceCommit,
      packageManager: observedEnvironment.packageManager,
      osImage: observedEnvironment.osImage,
      packedArtifacts,
    },
    runner: environmentRunnerFingerprint(observedEnvironment),
    sampleCount: samples,
    commands,
    metrics,
  };
}

function expectedScenarioCommands(scenario) {
  return Object.fromEntries(
    PHASES.map((phase) => [
      phase,
      {
        command: [...scenario.phases[phase].command],
        cwd: scenario.phases[phase].cwd ?? '.',
      },
    ]),
  );
}

function expectedReportProvenance(scenario) {
  return {
    sourceCommit: scenario.provenance.sourceCommit,
    packageManager: scenario.environment.packageManager,
    osImage: scenario.environment.osImage,
    packedArtifacts: scenario.provenance.packedArtifacts.map((artifact) => ({
      name: artifact.name,
      path: artifact.path.split(path.sep).join('/'),
      sha256: artifact.sha256,
    })),
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
  if (!sameJson(report.commands, expectedScenarioCommands(definition))) {
    findings.push(`${label}.commands do not match its full scenario definition`);
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
  findings.push(
    ...validatePackedArtifacts(
      identity?.provenance?.packedArtifacts,
      `${label}.provenance.packedArtifacts`,
    ),
  );
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
  for (const [metricId, metric] of Object.entries(budgets.metrics)) {
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
    const updated = ratifyBudgets(
      budgets,
      JSON.parse(baselineBytes.toString('utf8')),
      readJson(path.resolve(args.proposal)),
      {
        baselineReportPath: relativeBaselinePath,
        baselineReportBytes: baselineBytes,
        repoRoot: budgetsRoot,
      },
    );
    if (args.write) writeJson(args.budgets, updated);
    else process.stdout.write(`${JSON.stringify(updated, null, 2)}\n`);
    return 0;
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
