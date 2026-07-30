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
  agentDocsSnapshotFileName,
  decodeAgentDocsSnapshot,
  digestPublicManifest,
} from './agent-docs-snapshot.mjs';
import {
  readPackageTarballSnapshot,
  validatedPackageTarballEntries,
} from './lib/deterministic-tarball.mjs';
import {
  ensureNonSymlinkDescendantDirectory,
  nonSymlinkDescendant,
  nonSymlinkRootDirectory,
} from './lib/non-symlink-path.mjs';
import {
  DEVEX_GOLDEN_RELEASE_REPORT_SCHEMA,
  goldenJourneyWorkloadIdentity,
  validateGoldenReleaseScorecard,
  validateGoldenWorkloadIdentity,
} from './devex-golden-contract.mjs';
import { packWithoutLifecycleScripts } from './lib/pack-without-lifecycle.mjs';
import { measureProcessTreeCommand } from './lib/process-tree-rss.mjs';
import {
  validatePackedReleaseManifest,
  verifyPackedAttestationBytes,
} from './publish-packed-packages.mjs';
import { repoRoot as defaultRepoRoot } from './public-packages.mjs';
import { releasePackages } from './release-packages.mjs';

export const DEVEX_BUDGETS_SCHEMA = 'kovo-devex-budgets/v8';
export const DEVEX_BENCHMARK_SCENARIO_SCHEMA = 'kovo-devex-benchmark-scenario/v4';
export const DEVEX_BENCHMARK_REPORT_SCHEMA = 'kovo-devex-benchmark-report/v5';
export const DEVEX_DETERMINISTIC_ARTIFACT_REPORT_SCHEMA =
  'kovo-devex-deterministic-artifact-report/v1';
export const DEVEX_BUDGET_PROPOSAL_SCHEMA = 'kovo-devex-budget-proposal/v7';
export const DEVEX_FULL_CATALOG_REPORT_SCHEMA = 'kovo-devex-full-catalog/v1';
export const DEVEX_FULL_CATALOG_SAMPLE_SCHEMA = 'kovo-devex-full-catalog-sample/v1';
export const DEVEX_FULL_CATALOG_WORKLOAD_SCHEMA = 'kovo-devex-full-catalog-workload/v1';
export const DEVEX_PACKED_WORKLOAD_SCHEMA = 'kovo-devex-packed-workload/v2';
export const DEVEX_SCENARIO_RECIPE_SCHEMA = 'kovo-devex-scenario-recipe/v1';

const PHASES = Object.freeze(['cold', 'warm', 'oneFileIncremental']);
const PACKED_PROFILE_ID = 'kovo-packed-check/v3';
const KOVO_FRESH_PACK_PRODUCER_ID = 'kovo-clean-source-pack/v1';
const KOVO_PRODUCER_ATTESTATION_SCHEMA = 'kovo-devex-producer-attestation/v1';
const KOVO_PHASE_CENSUS_SCHEMA = 'kovo-devex-phase-census/v4';
const KOVO_DEV_PHASE_CENSUS_SCHEMA = 'kovo-devex-dev-phase-census/v1';
const KOVO_PACKED_CHECK_PHASES = Object.freeze([
  Object.freeze({ name: 'lifecycle-policy', status: 'not-applicable' }),
  Object.freeze({ name: 'config-trust', status: 'executed' }),
  Object.freeze({ name: 'typescript', status: 'not-applicable' }),
  Object.freeze({ name: 'project-quality', status: 'not-applicable' }),
  Object.freeze({ name: 'sound-subset', status: 'not-applicable' }),
  Object.freeze({ name: 'session-authority', status: 'executed' }),
  Object.freeze({ name: 'app-source-trust', status: 'executed' }),
  Object.freeze({ name: 'app-evaluation', status: 'executed' }),
  Object.freeze({ name: 'stylesheet', status: 'executed' }),
  Object.freeze({ name: 'build-check-graph', status: 'executed' }),
  Object.freeze({ name: 'graph-diagnostics', status: 'executed' }),
]);
const KOVO_PACKED_DOCS_EVIDENCE_SCHEMA = 'kovo-devex-packed-docs-evidence/v1';
const KOVO_PACKED_ARTIFACT_BINDING_SCHEMA = 'kovo-devex-packed-artifact-binding/v2';
const KOVO_WORKLOAD_CONTRACT_SCHEMA = 'kovo-devex-workload-contract/v1';
const KOVO_PACKED_DOCS_REPORT_SUBJECT = 'packed-docs-snapshot';
const KOVO_PACKED_DOCS_METRIC_IDS = Object.freeze([
  'docs.snapshot.compressedBytes',
  'docs.snapshot.installedBytes',
]);
const KOVO_BENCHMARK_CONSUMER = '@kovojs/devex-packed-check-consumer';
const KOVO_PACKED_RECIPE_PATH = 'scripts/devex-scenarios/kovo-packed-check.json';
const KOVO_FULL_CATALOG_SCENARIO = 'kovo-packed-full-catalog';
const KOVO_FULL_CATALOG_COMPONENT_COUNT = 44;
const KOVO_FULL_CATALOG_PHASES = Object.freeze([
  Object.freeze({
    command: 'create-kovo --postgres --retention retained-24h --disable-git',
    name: 'create',
  }),
  Object.freeze({
    command: 'pnpm install --ignore-workspace --no-frozen-lockfile --store-dir <isolated-store>',
    name: 'install',
  }),
  Object.freeze({
    command: 'pnpm exec kovo add <all-44-components> --out src/components/ui',
    name: 'copy',
  }),
  Object.freeze({ command: 'pnpm exec tsc --noEmit', name: 'typecheck' }),
  Object.freeze({ command: 'pnpm run check', name: 'check' }),
  Object.freeze({ command: 'pnpm run build:prod', name: 'build' }),
]);
const authenticatedProductionScenarios = new WeakSet();
const authenticatedProductionDocsEvidence = new WeakMap();
const METRIC_UNITS = new Set(['bytes', 'ms']);
const STATISTICS = new Set(['median', 'p95']);
const RUNNER_STATUSES = new Set(['unratified', 'ratified']);
const GITHUB_HOSTED_STANDARD_PUBLIC_MACHINE_CLASS = Object.freeze({
  kind: 'github-hosted-standard-public',
  provider: 'github-actions',
  repositoryVisibility: 'public',
  label: 'ubuntu-24.04',
  arch: 'x64',
  vcpus: 4,
  memoryBytes: 16 * 1024 * 1024 * 1024,
  ephemeralStorageBytes: 14 * 1024 * 1024 * 1024,
  specificationSource:
    'https://docs.github.com/en/actions/reference/runners/github-hosted-runners#standard-github-hosted-runners-for-public-repositories',
});
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
const PACKED_DEV_PROFILE_COMMAND = Object.freeze({
  command: Object.freeze(['node', 'dev-profile.mjs']),
  cwd: '.',
});
const DEV_PROFILE_METRICS = Object.freeze([
  'dev.ready.cold.durationMs',
  'dev.ready.warm.durationMs',
  'dev.editToDiagnostic.durationMs',
  'dev.editToServedResult.durationMs',
]);
const DEVEX_METRIC_CONTRACT = Object.freeze({
  'browser.bootstrapBytes': Object.freeze({
    source: 'benchmark',
    sampling: 'deterministic',
    statistic: 'median',
    unit: 'bytes',
  }),
  'check.cold.durationMs': Object.freeze({
    source: 'benchmark',
    sampling: 'statistical',
    statistic: 'median',
    unit: 'ms',
  }),
  'check.cold.peakRssBytes': Object.freeze({
    source: 'benchmark',
    sampling: 'statistical',
    statistic: 'p95',
    unit: 'bytes',
  }),
  'check.oneFileIncremental.durationMs': Object.freeze({
    source: 'benchmark',
    sampling: 'statistical',
    statistic: 'median',
    unit: 'ms',
  }),
  'check.oneFileIncremental.peakRssBytes': Object.freeze({
    source: 'benchmark',
    sampling: 'statistical',
    statistic: 'p95',
    unit: 'bytes',
  }),
  'check.warm.durationMs': Object.freeze({
    source: 'benchmark',
    sampling: 'statistical',
    statistic: 'median',
    unit: 'ms',
  }),
  'check.warm.peakRssBytes': Object.freeze({
    source: 'benchmark',
    sampling: 'statistical',
    statistic: 'p95',
    unit: 'bytes',
  }),
  'create.install.cold.durationMs': Object.freeze({
    source: 'golden-journey',
    sampling: 'statistical',
    statistic: 'median',
    unit: 'ms',
  }),
  'create.install.installedBytes': Object.freeze({
    source: 'golden-journey',
    sampling: 'deterministic',
    statistic: 'median',
    unit: 'bytes',
  }),
  'dev.editToDiagnostic.durationMs': Object.freeze({
    source: 'benchmark',
    sampling: 'statistical',
    statistic: 'p95',
    unit: 'ms',
  }),
  'dev.editToServedResult.durationMs': Object.freeze({
    source: 'benchmark',
    sampling: 'statistical',
    statistic: 'p95',
    unit: 'ms',
  }),
  'dev.ready.cold.durationMs': Object.freeze({
    source: 'golden-journey',
    sampling: 'statistical',
    statistic: 'median',
    unit: 'ms',
  }),
  'dev.ready.warm.durationMs': Object.freeze({
    source: 'golden-journey',
    sampling: 'statistical',
    statistic: 'median',
    unit: 'ms',
  }),
  'docs.snapshot.compressedBytes': Object.freeze({
    source: 'packed-docs',
    binding: 'packed-artifact',
    sampling: 'deterministic',
    statistic: 'median',
    unit: 'bytes',
  }),
  'docs.snapshot.installedBytes': Object.freeze({
    source: 'packed-docs',
    binding: 'packed-artifact',
    sampling: 'deterministic',
    statistic: 'median',
    unit: 'bytes',
  }),
  'ui.fullCatalog.peakRssBytes': Object.freeze({
    source: 'full-catalog',
    sampling: 'statistical',
    statistic: 'p95',
    unit: 'bytes',
  }),
});

function metricBinding(metricId) {
  return DEVEX_METRIC_CONTRACT[metricId]?.binding ?? 'runner';
}

function metricSource(metricId) {
  return DEVEX_METRIC_CONTRACT[metricId]?.source;
}

function reportEvidenceSource(report) {
  if (report?.schema === DEVEX_GOLDEN_RELEASE_REPORT_SCHEMA) return 'golden-journey';
  if (report?.schema === DEVEX_FULL_CATALOG_REPORT_SCHEMA) return 'full-catalog';
  return 'benchmark';
}

function reportWorkloadIdentity(report, reportSource) {
  if (reportSource === 'golden-journey') return goldenJourneyWorkloadIdentity(report);
  if (reportSource === 'full-catalog') return fullCatalogWorkloadIdentity(report);
  return benchmarkWorkloadContractIdentity(report);
}

function validateEvidenceReport(report, reportSource, label, options = {}) {
  if (reportSource === 'golden-journey') {
    return validateGoldenReleaseScorecard(report, label);
  }
  if (reportSource === 'full-catalog') {
    return validateFullCatalogReportIdentity(report, label, {
      requireAcceptedRunner: options.requireAcceptedRunner === true,
      requireSuccessfulSamples: options.requireSuccessfulSamples === true,
    });
  }
  return options.ratification === true
    ? validateRatificationReportIdentity(report, label, options.allowArtifactOnly === true)
    : validateBenchmarkReportIdentity(report, label);
}

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

export function packedArtifactBinding(evidence) {
  if (
    evidence === null ||
    typeof evidence !== 'object' ||
    evidence.package === null ||
    typeof evidence.package !== 'object' ||
    evidence.snapshot === null ||
    typeof evidence.snapshot !== 'object'
  ) {
    return null;
  }
  return {
    schema: KOVO_PACKED_ARTIFACT_BINDING_SCHEMA,
    kind: 'packed-artifact',
    evidenceSchema: evidence.schema,
    packageName: evidence.package.name,
  };
}

export function benchmarkScenarioDigest(scenario) {
  return sha256(Buffer.from(canonicalJson(scenario)));
}

export function createFullCatalogWorkloadDefinition(catalog, packageSet) {
  return {
    schema: DEVEX_FULL_CATALOG_WORKLOAD_SCHEMA,
    name: KOVO_FULL_CATALOG_SCENARIO,
    releasePackages: Array.isArray(packageSet)
      ? packageSet.map((pkg) => pkg?.name).sort(compareStrings)
      : [],
    catalog: {
      componentCount: catalog?.componentCount,
      components: Array.isArray(catalog?.components) ? [...catalog.components] : [],
      source: catalog?.source,
    },
    sourcePosture: {
      copiedOutput: 'src/components/ui',
      importedDuringProof: false,
    },
    phases: KOVO_FULL_CATALOG_PHASES.map((phase) => ({ ...phase })),
  };
}

export function fullCatalogScenarioDigest(definition) {
  return sha256(Buffer.from(canonicalJson(definition)));
}

export function fullCatalogPackageSetDigest(packageSet) {
  return sha256(Buffer.from(canonicalJson(packageSet)));
}

export function fullCatalogWorkloadIdentity(report) {
  return structuredClone(report?.scenario?.definition);
}

function validateFullCatalogWorkloadIdentity(identity, label) {
  const findings = [];
  if (
    !exactOwnKeys(identity, [
      'catalog',
      'name',
      'phases',
      'releasePackages',
      'schema',
      'sourcePosture',
    ]) ||
    identity?.schema !== DEVEX_FULL_CATALOG_WORKLOAD_SCHEMA ||
    identity?.name !== KOVO_FULL_CATALOG_SCENARIO
  ) {
    findings.push(`${label} must be an exact ${DEVEX_FULL_CATALOG_WORKLOAD_SCHEMA} record`);
    return findings;
  }
  const packageSet = Array.isArray(identity.releasePackages)
    ? identity.releasePackages.map((name) => ({ name }))
    : [];
  const expected = createFullCatalogWorkloadDefinition(identity.catalog, packageSet);
  if (!sameJson(identity, expected)) {
    findings.push(`${label} must bind the code-owned full-catalog workload`);
  }
  return findings;
}

export function validateFullCatalogReportIdentity(report, label = 'report', options = {}) {
  const findings = [];
  if (
    !exactOwnKeys(report, [
      'budget',
      'catalog',
      'metrics',
      'packageSet',
      'packedRelease',
      'pass',
      'runner',
      'sampleCount',
      'samples',
      'scenario',
      'schema',
      'source',
    ]) ||
    report?.schema !== DEVEX_FULL_CATALOG_REPORT_SCHEMA
  ) {
    findings.push(`${label} must be an exact ${DEVEX_FULL_CATALOG_REPORT_SCHEMA} report`);
    return findings;
  }

  findings.push(
    ...validateRunnerFingerprint(report.runner, `${label}.runner`, { requireNamed: true }),
  );
  if (
    options.requireAcceptedRunner === true &&
    (report.runner?.name !== 'github-hosted-ubuntu-24.04-accepted' ||
      report.runner?.platform !== 'linux' ||
      report.runner?.arch !== 'x64' ||
      !/^github-actions\/ubuntu-24\.04@sha256:[0-9a-f]{64}$/u.test(report.runner?.osImage ?? ''))
  ) {
    findings.push(`${label}.runner must be the exact accepted GitHub-hosted ubuntu-24.04 runner`);
  }
  if (
    !exactOwnKeys(report.source, ['commit', 'tree']) ||
    !validGitObjectId(report.source?.commit) ||
    report.source?.tree !== 'clean'
  ) {
    findings.push(`${label}.source must bind one clean exact Git revision`);
  }
  if (
    !exactOwnKeys(report.packedRelease, ['manifestSha256', 'packageSetSha256', 'schema']) ||
    report.packedRelease?.schema !== 'kovo.packed-public-packages/v2' ||
    !validDigest(report.packedRelease?.manifestSha256) ||
    report.packedRelease?.packageSetSha256 !== fullCatalogPackageSetDigest(report.packageSet)
  ) {
    findings.push(`${label}.packedRelease must bind the authenticated packed-release manifest`);
  }

  const expectedPackageNames = expectedKovoReleasePackages();
  if (
    !Array.isArray(report.packageSet) ||
    report.packageSet.length !== expectedPackageNames.length
  ) {
    findings.push(`${label}.packageSet must contain the exact packed release census`);
  } else {
    const observedNames = [];
    const observedTarballs = new Set();
    for (const [index, pkg] of report.packageSet.entries()) {
      if (
        !exactOwnKeys(pkg, ['name', 'sha512', 'version']) ||
        typeof pkg?.name !== 'string' ||
        typeof pkg?.version !== 'string' ||
        pkg.version.trim().length === 0 ||
        !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(pkg?.sha512 ?? '')
      ) {
        findings.push(`${label}.packageSet[${String(index)}] has invalid tarball identity`);
      }
      observedNames.push(pkg?.name);
      if (observedTarballs.has(pkg?.sha512)) {
        findings.push(`${label}.packageSet reuses one tarball identity`);
      }
      observedTarballs.add(pkg?.sha512);
    }
    if (!sameJson(observedNames, expectedPackageNames)) {
      findings.push(`${label}.packageSet must retain the exact sorted release package names`);
    }
  }

  const components = report.catalog?.components;
  if (
    !exactOwnKeys(report.catalog, ['componentCount', 'components', 'source']) ||
    report.catalog?.componentCount !== KOVO_FULL_CATALOG_COMPONENT_COUNT ||
    report.catalog?.source !== '@kovojs/ui packed manifest exports' ||
    !Array.isArray(components) ||
    components.length !== KOVO_FULL_CATALOG_COMPONENT_COUNT ||
    new Set(components).size !== KOVO_FULL_CATALOG_COMPONENT_COUNT ||
    components.some((component) => !/^[a-z][a-z0-9-]*$/u.test(component)) ||
    !sameJson(components, [...components].sort(compareStrings))
  ) {
    findings.push(
      `${label}.catalog must contain exactly 44 unique sorted authenticated components`,
    );
  }

  const expectedDefinition = createFullCatalogWorkloadDefinition(report.catalog, report.packageSet);
  if (
    !exactOwnKeys(report.scenario, ['definition', 'digest', 'name']) ||
    report.scenario?.name !== KOVO_FULL_CATALOG_SCENARIO ||
    !sameJson(report.scenario?.definition, expectedDefinition) ||
    report.scenario?.digest !== fullCatalogScenarioDigest(expectedDefinition)
  ) {
    findings.push(`${label}.scenario must bind the exact code-owned full-catalog workload`);
  }

  if (
    !exactOwnKeys(report.budget, ['binding', 'source', 'thresholdBytes']) ||
    typeof report.budget?.binding !== 'boolean' ||
    report.budget?.source !== (report.budget?.binding ? 'ratified' : 'provisional') ||
    !Number.isFinite(report.budget?.thresholdBytes) ||
    report.budget.thresholdBytes <= 0
  ) {
    findings.push(`${label}.budget must identify a positive ratified or provisional threshold`);
  }
  if (
    !Number.isSafeInteger(report.sampleCount) ||
    report.sampleCount < 1 ||
    report.sampleCount > 20
  ) {
    findings.push(`${label}.sampleCount must be an integer from 1 through 20`);
  }
  if (!Array.isArray(report.samples) || report.samples.length !== report.sampleCount) {
    findings.push(`${label}.samples must match sampleCount`);
    return findings;
  }

  const metricSamples = [];
  for (const [index, sample] of report.samples.entries()) {
    const sampleLabel = `${label}.samples[${String(index)}]`;
    if (
      !exactOwnKeys(sample, [
        'budget',
        'copiedComponents',
        'copiedSourceFiles',
        'failure',
        'functionalPass',
        'pass',
        'peakProcessTreeRssBytes',
        'phases',
        'sampleIndex',
        'schema',
        'unimportedDuringProof',
      ]) ||
      sample?.schema !== DEVEX_FULL_CATALOG_SAMPLE_SCHEMA ||
      sample?.sampleIndex !== index
    ) {
      findings.push(`${sampleLabel} must be an exact indexed full-catalog sample`);
      continue;
    }
    if (
      typeof sample.functionalPass !== 'boolean' ||
      typeof sample.pass !== 'boolean' ||
      !Number.isFinite(sample.peakProcessTreeRssBytes) ||
      sample.peakProcessTreeRssBytes < 0 ||
      (sample.functionalPass === true && sample.peakProcessTreeRssBytes === 0)
    ) {
      findings.push(`${sampleLabel} has invalid outcome or RSS evidence`);
    }
    const phaseNames = [];
    const phasePeaks = [];
    if (!Array.isArray(sample.phases)) {
      findings.push(`${sampleLabel}.phases must be an array`);
    } else {
      for (const [phaseIndex, phase] of sample.phases.entries()) {
        if (
          !exactOwnKeys(phase, ['durationMs', 'name', 'peakProcessTreeRssBytes', 'status']) ||
          typeof phase?.name !== 'string' ||
          !Number.isFinite(phase?.durationMs) ||
          phase.durationMs < 0 ||
          (phase.status !== null && !Number.isInteger(phase.status)) ||
          !Number.isFinite(phase?.peakProcessTreeRssBytes) ||
          phase.peakProcessTreeRssBytes < 0
        ) {
          findings.push(`${sampleLabel}.phases[${String(phaseIndex)}] has invalid phase evidence`);
          continue;
        }
        phaseNames.push(phase.name);
        phasePeaks.push(phase.peakProcessTreeRssBytes);
      }
    }
    const expectedPhaseNames = KOVO_FULL_CATALOG_PHASES.map((phase) => phase.name);
    if (
      phaseNames.length > expectedPhaseNames.length ||
      !sameJson(phaseNames, expectedPhaseNames.slice(0, phaseNames.length))
    ) {
      findings.push(`${sampleLabel}.phases must be an ordered prefix of the workload phases`);
    }
    if (phasePeaks.length === 0 || sample.peakProcessTreeRssBytes !== Math.max(...phasePeaks)) {
      findings.push(`${sampleLabel}.peakProcessTreeRssBytes does not match phase evidence`);
    }
    if (
      !exactOwnKeys(sample.budget, ['binding', 'thresholdBytes', 'withinThreshold']) ||
      sample.budget?.binding !== report.budget.binding ||
      sample.budget?.thresholdBytes !== report.budget.thresholdBytes ||
      sample.budget?.withinThreshold !==
        (sample.peakProcessTreeRssBytes > 0 &&
          sample.peakProcessTreeRssBytes <= report.budget.thresholdBytes)
    ) {
      findings.push(`${sampleLabel}.budget does not match report threshold and observed peak`);
    }
    if (
      !Number.isSafeInteger(sample.copiedComponents) ||
      sample.copiedComponents < 0 ||
      sample.copiedComponents > KOVO_FULL_CATALOG_COMPONENT_COUNT ||
      !Number.isSafeInteger(sample.copiedSourceFiles) ||
      sample.copiedSourceFiles < 0
    ) {
      findings.push(`${sampleLabel} has invalid copied-source evidence`);
    }
    if (sample.functionalPass) {
      if (
        sample.copiedComponents !== KOVO_FULL_CATALOG_COMPONENT_COUNT ||
        sample.copiedSourceFiles < KOVO_FULL_CATALOG_COMPONENT_COUNT ||
        sample.unimportedDuringProof !== true ||
        !sameJson(phaseNames, expectedPhaseNames) ||
        sample.phases.some((phase) => phase.status !== 0)
      ) {
        findings.push(`${sampleLabel} did not prove every successful workload phase`);
      }
      if (sample.failure !== null) {
        findings.push(`${sampleLabel}.failure must be null on functional success`);
      }
    } else if (
      !exactOwnKeys(sample.failure, ['artifact', 'message', 'phase']) ||
      typeof sample.failure?.message !== 'string' ||
      typeof sample.failure?.phase !== 'string'
    ) {
      findings.push(`${sampleLabel}.failure must explain a failed functional sample`);
    }
    const expectedPass =
      sample.functionalPass === true &&
      (report.budget.binding !== true || sample.budget.withinThreshold === true);
    if (sample.pass !== expectedPass) {
      findings.push(`${sampleLabel} does not enforce functional and binding RSS outcomes`);
    }
    metricSamples.push(sample.peakProcessTreeRssBytes);
  }

  if (
    !exactOwnKeys(report.metrics, ['ui.fullCatalog.peakRssBytes']) ||
    !exactOwnKeys(report.metrics?.['ui.fullCatalog.peakRssBytes'], ['samples', 'unit']) ||
    report.metrics?.['ui.fullCatalog.peakRssBytes']?.unit !== 'bytes' ||
    !sameJson(report.metrics?.['ui.fullCatalog.peakRssBytes']?.samples, metricSamples)
  ) {
    findings.push(`${label}.metrics must exactly match the per-sample full-catalog RSS evidence`);
  }
  if (report.pass !== report.samples.every((sample) => sample.pass === true)) {
    findings.push(`${label}.pass does not match sample outcomes`);
  }
  if (
    options.requireSuccessfulSamples === true &&
    (report.sampleCount < 5 || report.samples.some((sample) => sample.functionalPass !== true))
  ) {
    findings.push(`${label} ratification requires at least five functionally successful samples`);
  }
  return findings;
}

export const DEVEX_PACKED_PROFILE_COMMAND_DIGEST = sha256(
  Buffer.from(
    canonicalJson({
      browserBuild: BROWSER_BUILD_COMMAND,
      dev: PACKED_DEV_PROFILE_COMMAND,
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

export function collectDevexEnvironment(options = {}) {
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

const currentBenchmarkEnvironment = collectDevexEnvironment;

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

/**
 * Measure a command without a shell. The supervisor samples the root process and every live
 * descendant, so fan-out cannot hide behind a direct-child high-water mark.
 */
export function measureCommand(command, options = {}) {
  validateCommand(command, 'command');
  return measureProcessTreeCommand(command, {
    cwd: path.resolve(options.cwd ?? defaultRepoRoot),
    env: { ...process.env, ...options.env },
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
    sampleIntervalMs: options.sampleIntervalMs,
    timeoutMs: options.timeoutMs,
  });
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
    'benchmark-lock.yaml',
    'build-browser.mjs',
    'dev-profile.mjs',
    'profile.mjs',
    'src/app.tsx',
    'src/components/counter-island.tsx',
    'src/kovo.ts',
    'workload.mjs',
  ]);
  for (const required of requiredConsumerFiles) {
    if (!consumerFiles.some((file) => file.path === required)) {
      findings.push(`Kovo packed workload consumer is missing required app source: ${required}`);
    }
  }
  if (!sameJson(manifest?.browserBootstrap, ['dist/.kovo/client/generated/app.client.js'])) {
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

/**
 * Measure the docs payload only after authenticating the exact CLI tarball in the packed
 * workload. The evidence deliberately carries workload, package, and snapshot identities so a
 * deterministic budget can bind artifact bytes without pretending wall-clock runner identity is
 * relevant.
 */
export function packedDocsSnapshotEvidence(
  scenario,
  { repositoryRoot = defaultRepoRoot, root = defaultRepoRoot } = {},
) {
  const { manifest } = readPackedWorkloadManifest(scenario, root);
  const artifact = manifest.artifacts.find((candidate) => candidate.name === '@kovojs/cli');
  if (artifact === undefined) return null;
  const absolute = regularFileInsideRoot(root, artifact.path, 'packed CLI artifact');
  const tarballBytes = readPackageTarballSnapshot(absolute);
  if (sha256(tarballBytes) !== artifact.sha256) {
    throw new Error('packed CLI artifact digest does not match the workload manifest');
  }
  const entries = validatedPackageTarballEntries(tarballBytes);
  if (!sameJson(observedTarballFiles(entries), artifact.files)) {
    throw new Error('packed CLI artifact file census does not match the workload manifest');
  }
  const packageManifestEntry = entries.find((entry) => entry.name === 'package/package.json');
  const snapshotEntry = entries.find(
    (entry) => entry.name === `package/dist/${agentDocsSnapshotFileName}`,
  );
  if (packageManifestEntry === undefined || snapshotEntry === undefined) {
    throw new Error('packed CLI artifact is missing its manifest or authenticated docs snapshot');
  }
  const packageManifest = JSON.parse(packageManifestEntry.data.toString('utf8'));
  if (packageManifest.name !== '@kovojs/cli' || typeof packageManifest.version !== 'string') {
    throw new Error('packed CLI package identity is invalid');
  }
  const snapshot = decodeAgentDocsSnapshot(snapshotEntry.data, {
    expectedPublicManifestDigest: digestPublicManifest(repositoryRoot),
    expectedVersion: packageManifest.version,
  });
  if (snapshot.sourceCommit !== scenario.provenance.sourceCommit) {
    throw new Error('packed docs snapshot source commit does not match the benchmark workload');
  }
  return Object.freeze({
    schema: KOVO_PACKED_DOCS_EVIDENCE_SCHEMA,
    workloadManifestSha256: scenario.provenance.workloadManifest.sha256,
    package: Object.freeze({
      name: '@kovojs/cli',
      sha256: artifact.sha256,
      version: packageManifest.version,
    }),
    snapshot: Object.freeze({
      compressedBytes: snapshotEntry.data.byteLength,
      files: snapshot.files.length,
      installedBytes: snapshot.files.reduce((total, file) => total + file.bytes, 0),
      publicManifestDigest: snapshot.publicManifestDigest,
      snapshotDigest: snapshot.snapshotDigest,
      sourceCommit: snapshot.sourceCommit,
      version: snapshot.version,
    }),
  });
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
    /^kovo-benchmark-phase\/v4 phase=(cold|warm|oneFileIncremental) revision=([01]) edit=(baseline|applied) analysis=(sha256:[0-9a-f]{64}) graph=(sha256:[0-9a-f]{64}) census=([A-Za-z0-9_-]+) duration=([0-9]+(?:\.[0-9]+)?) rss=(none|[0-9]+)\r?\n?$/u.exec(
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
  let diagnosticPhases;
  try {
    diagnosticPhases = JSON.parse(Buffer.from(marker[6], 'base64url').toString('utf8'));
  } catch {
    throw new Error(
      `${context.phase} ${context.role} sample ${context.sampleIndex + 1} returned malformed diagnostic-phase evidence`,
    );
  }
  const phaseFindings = packedCheckPhaseFindings(
    diagnosticPhases,
    `${context.phase} ${context.role} sample ${context.sampleIndex + 1}`,
  );
  if (phaseFindings.length > 0) throw new Error(phaseFindings.join('\n'));
  const durationMs = Number(marker[7]);
  const peakRssBytes = marker[8] === 'none' ? null : Number(marker[8]);
  if (
    !finiteNonNegative(durationMs) ||
    (peakRssBytes !== null && !finiteNonNegative(peakRssBytes))
  ) {
    throw new Error(
      `${context.phase} ${context.role} sample ${context.sampleIndex + 1} returned invalid process cost evidence`,
    );
  }
  return {
    analysisDigest: marker[4],
    checkGraphDigest: marker[5],
    diagnosticPhases,
    durationMs,
    peakRssBytes,
    revision,
  };
}

function packedCheckPhaseFindings(phases, label) {
  const findings = [];
  if (!Array.isArray(phases) || phases.length !== KOVO_PACKED_CHECK_PHASES.length) {
    return [
      `${label} must contain all ${String(
        KOVO_PACKED_CHECK_PHASES.length,
      )} packed-check diagnostic phases`,
    ];
  }
  for (let index = 0; index < KOVO_PACKED_CHECK_PHASES.length; index += 1) {
    const expected = KOVO_PACKED_CHECK_PHASES[index];
    const observed = phases[index];
    if (
      observed?.name !== expected.name ||
      observed?.status !== expected.status ||
      !finiteNonNegative(observed?.durationMs) ||
      (expected.status === 'not-applicable' && observed.durationMs !== 0)
    ) {
      findings.push(
        `${label}.diagnosticPhases[${String(index)}] must prove ${expected.name}=${expected.status}`,
      );
    }
  }
  return findings;
}

function fixturePackedCheckPhases() {
  return KOVO_PACKED_CHECK_PHASES.map((phase) => ({
    durationMs: 0,
    name: phase.name,
    status: phase.status,
  }));
}

function validDigest(value) {
  return /^sha256:[0-9a-f]{64}$/u.test(value ?? '');
}

function exactOwnKeys(value, expected) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    sameJson(Object.keys(value).sort(compareStrings), [...expected].sort(compareStrings))
  );
}

function assertDevProfileInvocation(result, context) {
  if (result.exitCode !== 0 || result.signal || result.error) {
    throw new Error(
      `dev timed sample ${context.sampleIndex + 1} failed: exit=${String(
        result.exitCode,
      )} signal=${String(result.signal)} ${result.error ?? result.stderr ?? ''}`.trim(),
    );
  }
  const marker = /^kovo-dev-profile\/v1 ([^\r\n]+)\r?\n?$/u.exec(result.stdout ?? '');
  if (!marker) {
    throw new Error(
      `dev timed sample ${context.sampleIndex + 1} did not return the code-owned dev marker`,
    );
  }
  let evidence;
  try {
    evidence = JSON.parse(marker[1]);
  } catch {
    throw new Error(`dev timed sample ${context.sampleIndex + 1} returned malformed JSON evidence`);
  }
  if (
    !exactOwnKeys(evidence, ['cold', 'diagnostic', 'served', 'warm']) ||
    !exactOwnKeys(evidence.cold, ['bodyDigest', 'durationMs']) ||
    !exactOwnKeys(evidence.warm, ['bodyDigest', 'durationMs']) ||
    !exactOwnKeys(evidence.diagnostic, ['bodyDigest', 'code', 'durationMs', 'sourceDigest']) ||
    !exactOwnKeys(evidence.served, ['bodyDigest', 'durationMs', 'revision', 'sourceDigest']) ||
    !finiteNonNegative(evidence.cold.durationMs) ||
    !finiteNonNegative(evidence.warm.durationMs) ||
    !finiteNonNegative(evidence.diagnostic.durationMs) ||
    !finiteNonNegative(evidence.served.durationMs) ||
    !validDigest(evidence.cold.bodyDigest) ||
    !validDigest(evidence.warm.bodyDigest) ||
    !validDigest(evidence.diagnostic.bodyDigest) ||
    !validDigest(evidence.diagnostic.sourceDigest) ||
    !validDigest(evidence.served.bodyDigest) ||
    !validDigest(evidence.served.sourceDigest) ||
    evidence.diagnostic.code !== 'KV235' ||
    evidence.served.revision !== 1 ||
    evidence.diagnostic.sourceDigest === evidence.served.sourceDigest
  ) {
    throw new Error(
      `dev timed sample ${context.sampleIndex + 1} returned invalid transition evidence`,
    );
  }
  return evidence;
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
  const graphDigestByRevision = new Map();
  for (const observation of observations) {
    const previous = digestByRevision.get(observation.revision);
    if (previous !== undefined && previous !== observation.analysisDigest) {
      throw new Error('benchmark source revision mapped to inconsistent analyzed-input digests');
    }
    digestByRevision.set(observation.revision, observation.analysisDigest);
    const previousGraph = graphDigestByRevision.get(observation.revision);
    if (previousGraph !== undefined && previousGraph !== observation.checkGraphDigest) {
      throw new Error('benchmark source revision mapped to inconsistent check-graph digests');
    }
    graphDigestByRevision.set(observation.revision, observation.checkGraphDigest);
  }
  if (digestByRevision.size !== 2 || digestByRevision.get(0) === digestByRevision.get(1)) {
    throw new Error('benchmark phase census did not prove two distinct analyzed source revisions');
  }
  if (
    graphDigestByRevision.size !== 2 ||
    graphDigestByRevision.get(0) === graphDigestByRevision.get(1)
  ) {
    throw new Error(
      'benchmark phase census did not prove two distinct current-source check graphs',
    );
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
      checkGraphDigest: observation.checkGraphDigest,
      diagnosticPhases: observation.diagnosticPhases,
      durationMs: observation.durationMs,
      peakRssBytes: observation.peakRssBytes,
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
        revision: phase === 'oneFileIncremental' ? (baseline === 0 ? 1 : 0) : 0,
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
    const graphDigestByRevision = new Map();
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
      if (!/^sha256:[0-9a-f]{64}$/u.test(observed.checkGraphDigest ?? '')) {
        findings.push(`${label}.analysisInputs[${index}].checkGraphDigest is invalid`);
      }
      findings.push(
        ...packedCheckPhaseFindings(
          observed.diagnosticPhases,
          `${label}.analysisInputs[${String(index)}]`,
        ),
      );
      if (!finiteNonNegative(observed.durationMs)) {
        findings.push(`${label}.analysisInputs[${index}].durationMs is invalid`);
      }
      if (observed.peakRssBytes !== null && !finiteNonNegative(observed.peakRssBytes)) {
        findings.push(`${label}.analysisInputs[${index}].peakRssBytes is invalid`);
      }
      const previous = digestByRevision.get(observed.revision);
      if (previous !== undefined && previous !== observed.analysisDigest) {
        findings.push(`${label}.analysisInputs maps one revision to multiple source digests`);
      }
      digestByRevision.set(observed.revision, observed.analysisDigest);
      const previousGraph = graphDigestByRevision.get(observed.revision);
      if (previousGraph !== undefined && previousGraph !== observed.checkGraphDigest) {
        findings.push(`${label}.analysisInputs maps one revision to multiple check-graph digests`);
      }
      graphDigestByRevision.set(observed.revision, observed.checkGraphDigest);
    }
    if (digestByRevision.size !== 2 || digestByRevision.get(0) === digestByRevision.get(1)) {
      findings.push(`${label}.analysisInputs must prove two distinct analyzed source revisions`);
    }
    if (
      graphDigestByRevision.size !== 2 ||
      graphDigestByRevision.get(0) === graphDigestByRevision.get(1)
    ) {
      findings.push(`${label}.analysisInputs must prove two distinct current-source check graphs`);
    }
  }
  return findings;
}

function devPhaseCensus(observations, samples) {
  if (observations.length !== samples) {
    throw new Error('dev phase census does not contain every timed sample');
  }
  const sourceDigests = new Map();
  for (const observation of observations) {
    for (const [kind, digest] of [
      ['diagnostic', observation.diagnostic.sourceDigest],
      ['served', observation.served.sourceDigest],
    ]) {
      const previous = sourceDigests.get(kind);
      if (previous !== undefined && previous !== digest) {
        throw new Error(`dev ${kind} source mapped to inconsistent digests`);
      }
      sourceDigests.set(kind, digest);
    }
  }
  if (sourceDigests.get('diagnostic') === sourceDigests.get('served')) {
    throw new Error(
      'dev edit census did not prove distinct diagnostic and served source revisions',
    );
  }
  return {
    schema: KOVO_DEV_PHASE_CENSUS_SCHEMA,
    samples,
    observations: observations.map((observation) => structuredClone(observation)),
  };
}

function validateDevPhaseCensus(census, sampleCount, label) {
  const findings = [];
  if (
    census?.schema !== KOVO_DEV_PHASE_CENSUS_SCHEMA ||
    !Number.isInteger(sampleCount) ||
    census?.samples !== sampleCount
  ) {
    findings.push(`${label} must bind the report sample count`);
    return findings;
  }
  if (!Array.isArray(census.observations) || census.observations.length !== sampleCount) {
    findings.push(`${label}.observations must census every dev sample`);
    return findings;
  }
  const sourceDigests = new Map();
  for (let index = 0; index < sampleCount; index += 1) {
    const observation = census.observations[index];
    if (
      !exactOwnKeys(observation, ['cold', 'diagnostic', 'sampleIndex', 'served', 'warm']) ||
      observation.sampleIndex !== index
    ) {
      findings.push(`${label}.observations[${index}] does not match the dev sample census`);
      continue;
    }
    for (const kind of ['cold', 'warm']) {
      if (
        !exactOwnKeys(observation[kind], ['bodyDigest', 'durationMs']) ||
        !validDigest(observation[kind]?.bodyDigest) ||
        !finiteNonNegative(observation[kind]?.durationMs)
      ) {
        findings.push(`${label}.observations[${index}].${kind} is invalid`);
      }
    }
    if (
      !exactOwnKeys(observation.diagnostic, ['bodyDigest', 'code', 'durationMs', 'sourceDigest']) ||
      observation.diagnostic?.code !== 'KV235' ||
      !validDigest(observation.diagnostic?.bodyDigest) ||
      !validDigest(observation.diagnostic?.sourceDigest) ||
      !finiteNonNegative(observation.diagnostic?.durationMs)
    ) {
      findings.push(`${label}.observations[${index}].diagnostic is invalid`);
    }
    if (
      !exactOwnKeys(observation.served, ['bodyDigest', 'durationMs', 'revision', 'sourceDigest']) ||
      observation.served?.revision !== 1 ||
      !validDigest(observation.served?.bodyDigest) ||
      !validDigest(observation.served?.sourceDigest) ||
      !finiteNonNegative(observation.served?.durationMs)
    ) {
      findings.push(`${label}.observations[${index}].served is invalid`);
    }
    for (const kind of ['diagnostic', 'served']) {
      const digest = observation[kind]?.sourceDigest;
      if (!validDigest(digest)) continue;
      const previous = sourceDigests.get(kind);
      if (previous !== undefined && previous !== digest) {
        findings.push(`${label}.observations maps ${kind} to multiple source digests`);
      }
      sourceDigests.set(kind, digest);
    }
  }
  if (sourceDigests.size === 2 && sourceDigests.get('diagnostic') === sourceDigests.get('served')) {
    findings.push(`${label}.observations must prove distinct diagnostic and served source edits`);
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

function packedDocsMetrics(evidence) {
  return Object.fromEntries(
    [
      ['docs.snapshot.compressedBytes', evidence.snapshot.compressedBytes],
      ['docs.snapshot.installedBytes', evidence.snapshot.installedBytes],
    ].map(([metricId, value]) => [
      metricId,
      {
        unit: 'bytes',
        samples: [value],
        summary: sampleSummary([value]),
        evidence: structuredClone(evidence),
      },
    ]),
  );
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
    const devObservations = [];
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
            const analysisDigest =
              evidence?.analysisDigest ?? `sha256:${String(revision).repeat(64)}`;
            observations.push({
              phase,
              role: 'prime',
              revision,
              analysisDigest,
              checkGraphDigest:
                evidence?.checkGraphDigest ??
                `sha256:${revision === 0 ? 'a'.repeat(64) : 'b'.repeat(64)}`,
              diagnosticPhases: evidence?.diagnosticPhases ?? fixturePackedCheckPhases(),
              durationMs: evidence?.durationMs ?? prime.durationMs,
              peakRssBytes: prime.peakRssBytes ?? evidence?.peakRssBytes ?? null,
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
            analysisDigest: evidence?.analysisDigest ?? `sha256:${String(revision).repeat(64)}`,
            checkGraphDigest:
              evidence?.checkGraphDigest ??
              `sha256:${revision === 0 ? 'a'.repeat(64) : 'b'.repeat(64)}`,
            diagnosticPhases: evidence?.diagnosticPhases ?? fixturePackedCheckPhases(),
            durationMs: evidence?.durationMs ?? result.durationMs,
            peakRssBytes: result.peakRssBytes ?? evidence?.peakRssBytes ?? null,
            sampleIndex: index,
          });
          const measuredDuration = evidence?.durationMs ?? result.durationMs;
          const measuredPeakRss = result.peakRssBytes ?? evidence?.peakRssBytes;
          if (!finiteNonNegative(measuredDuration)) {
            throw new Error(`${phase} sample ${index + 1} returned an invalid duration`);
          }
          durationSamples.push(measuredDuration);
          if (measuredPeakRss !== null && measuredPeakRss !== undefined) {
            if (!finiteNonNegative(measuredPeakRss)) {
              throw new Error(`${phase} sample ${index + 1} returned invalid peak RSS`);
            }
            rssSamples.push(measuredPeakRss);
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

    const measureDev = options.measureDev ?? measure;
    const devMetricSamples = Object.fromEntries(
      DEV_PROFILE_METRICS.map((metricId) => [metricId, []]),
    );
    for (let index = 0; index < samples; index += 1) {
      const staged = stagePackedWorkload(executionScenario, executionRoot, executionRepositoryRoot);
      try {
        const context = {
          cwd: commandCwdInsideStage(staged.stageRoot, PACKED_DEV_PROFILE_COMMAND.cwd),
          executionPhase: 'dev',
          phase: 'dev',
          role: 'timed',
          sampleIndex: index,
          stageRoot: staged.stageRoot,
        };
        const result = measureDev(PACKED_DEV_PROFILE_COMMAND.command, context);
        const evidence = assertDevProfileInvocation(result, context);
        devMetricSamples['dev.ready.cold.durationMs'].push(evidence.cold.durationMs);
        devMetricSamples['dev.ready.warm.durationMs'].push(evidence.warm.durationMs);
        devMetricSamples['dev.editToDiagnostic.durationMs'].push(evidence.diagnostic.durationMs);
        devMetricSamples['dev.editToServedResult.durationMs'].push(evidence.served.durationMs);
        devObservations.push({ sampleIndex: index, ...evidence });
      } finally {
        rmSync(staged.stageRoot, { recursive: true, force: true });
      }
    }
    for (const metricId of DEV_PROFILE_METRICS) {
      const metricSamples = devMetricSamples[metricId];
      metrics[metricId] = {
        unit: 'ms',
        samples: metricSamples,
        summary: sampleSummary(metricSamples),
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
    const docsEvidence = packedDocsSnapshotEvidence(executionScenario, {
      repositoryRoot: executionRepositoryRoot,
      root: executionRoot,
    });
    if (executionScenario.name === 'kovo-packed-check' && docsEvidence === null) {
      throw new Error('production Kovo benchmark workload has no packed CLI docs snapshot');
    }
    if (docsEvidence !== null) {
      Object.assign(metrics, packedDocsMetrics(docsEvidence));
    }
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
      devPhaseCensus: devPhaseCensus(devObservations, samples),
      commands,
      metrics,
    };
  } finally {
    if (acquired !== null) acquired.dispose();
  }
}

/**
 * Authenticate deterministic bytes directly from the clean-source packed CLI. This is a narrow
 * artifact report: it deliberately contains no duration/RSS observations and cannot ratify a
 * runner-bound metric. The packed digest remains the proof that the measured docs are the product
 * users install (SPEC.md §1.3 and §11).
 */
export function runDeterministicArtifactScenario(scenario, options = {}) {
  const findings = validateBenchmarkScenario(scenario);
  if (findings.length > 0) {
    throw new Error(`Invalid benchmark scenario:\n- ${findings.join('\n- ')}`);
  }
  if (scenario.name !== 'kovo-packed-check') {
    throw new Error(
      'deterministic artifact measurement accepts only the code-owned fresh Kovo scenario',
    );
  }
  const repositoryRoot = path.resolve(options.repositoryRoot ?? defaultRepoRoot);
  const observedEnvironment = currentBenchmarkEnvironment(options);
  const environmentFindings = observedEnvironmentFindings(scenario, observedEnvironment);
  if (environmentFindings.length > 0) {
    throw new Error(
      `Benchmark environment does not match the pinned scenario:\n- ${environmentFindings.join('\n- ')}`,
    );
  }
  const acquire = options.acquireFreshKovoScenario ?? acquireFreshKovoScenario;
  const acquired = acquire(observedEnvironment, { repositoryRoot });
  try {
    validateFreshKovoScenario(acquired, observedEnvironment);
    if (!sameJson(scenario, acquired.scenario)) {
      throw new Error(
        'Kovo benchmark scenario does not match artifacts freshly produced from the exact clean source revision',
      );
    }
    const evidence =
      authenticatedProductionDocsEvidence.get(acquired.scenario) ??
      packedDocsSnapshotEvidence(acquired.scenario, {
        repositoryRoot: acquired.repositoryRoot,
        root: acquired.root,
      });
    if (evidence === null) {
      throw new Error('production Kovo benchmark workload has no packed CLI docs snapshot');
    }
    return {
      schema: DEVEX_DETERMINISTIC_ARTIFACT_REPORT_SCHEMA,
      subject: KOVO_PACKED_DOCS_REPORT_SUBJECT,
      scenario: {
        name: acquired.scenario.name,
        digest: benchmarkScenarioDigest(acquired.scenario),
        definition: structuredClone(acquired.scenario),
      },
      provenance: expectedReportProvenance(acquired.scenario),
      metrics: packedDocsMetrics(evidence),
    };
  } finally {
    acquired.dispose();
  }
}

function expectedScenarioCommands() {
  return structuredClone({
    ...PACKED_PROFILE_COMMANDS,
    dev: PACKED_DEV_PROFILE_COMMAND,
  });
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

function reportMetricCensusFindings(report, label) {
  const findings = [];
  const metrics = report?.metrics;
  if (metrics === null || typeof metrics !== 'object' || Array.isArray(metrics)) {
    return [`${label}.metrics must be an object`];
  }
  for (const phase of PHASES) {
    const timed =
      report.phaseCensus?.analysisInputs?.filter(
        (observation) => observation?.phase === phase && observation?.role === 'timed',
      ) ?? [];
    const expected = [
      [`check.${phase}.durationMs`, 'ms', timed.map((observation) => observation.durationMs)],
      [
        `check.${phase}.peakRssBytes`,
        'bytes',
        timed.map((observation) => observation.peakRssBytes).filter((value) => value !== null),
      ],
    ];
    for (const [metricId, unit, samples] of expected) {
      const metric = metrics[metricId];
      if (metric === undefined) continue;
      if (metric?.unit !== unit || !sameJson(metric.samples, samples)) {
        findings.push(`${label}.metrics.${metricId} does not match its phase census`);
      }
    }
  }
  const devSamples = [
    ['dev.ready.cold.durationMs', 'cold'],
    ['dev.ready.warm.durationMs', 'warm'],
    ['dev.editToDiagnostic.durationMs', 'diagnostic'],
    ['dev.editToServedResult.durationMs', 'served'],
  ];
  for (const [metricId, phase] of devSamples) {
    const metric = metrics[metricId];
    if (metric === undefined) continue;
    const samples =
      report.devPhaseCensus?.observations?.map((observation) => observation?.[phase]?.durationMs) ??
      [];
    if (metric?.unit !== 'ms' || !sameJson(metric.samples, samples)) {
      findings.push(`${label}.metrics.${metricId} does not match its dev phase census`);
    }
  }
  const browser = metrics['browser.bootstrapBytes'];
  if (browser !== undefined) {
    const files = browser?.files;
    const bytes =
      Array.isArray(files) &&
      files.every(
        (file) => safeRepositoryRelativePath(file?.path) && finiteNonNegative(file?.bytes),
      )
        ? files.reduce((total, file) => total + file.bytes, 0)
        : null;
    if (browser?.unit !== 'bytes' || bytes === null || !sameJson(browser.samples, [bytes])) {
      findings.push(
        `${label}.metrics.browser.bootstrapBytes must match its emitted-asset byte census`,
      );
    }
  }
  const compressedDocs = metrics['docs.snapshot.compressedBytes'];
  const installedDocs = metrics['docs.snapshot.installedBytes'];
  if (report?.scenario?.name === 'kovo-packed-check' && (!compressedDocs || !installedDocs)) {
    findings.push(`${label}.metrics must include both packed docs snapshot byte metrics`);
  }
  if (compressedDocs !== undefined || installedDocs !== undefined) {
    const evidence = compressedDocs?.evidence;
    const snapshot = evidence?.snapshot;
    const packageEvidence = evidence?.package;
    const cliArtifact = report.provenance?.packedArtifacts?.find(
      (artifact) => artifact?.name === '@kovojs/cli',
    );
    const validEvidence =
      exactOwnKeys(evidence, ['package', 'schema', 'snapshot', 'workloadManifestSha256']) &&
      evidence.schema === KOVO_PACKED_DOCS_EVIDENCE_SCHEMA &&
      evidence.workloadManifestSha256 === report.provenance?.workloadManifest?.sha256 &&
      exactOwnKeys(packageEvidence, ['name', 'sha256', 'version']) &&
      packageEvidence.name === '@kovojs/cli' &&
      validDigest(packageEvidence.sha256) &&
      packageEvidence.sha256 === cliArtifact?.sha256 &&
      typeof packageEvidence.version === 'string' &&
      exactOwnKeys(snapshot, [
        'compressedBytes',
        'files',
        'installedBytes',
        'publicManifestDigest',
        'snapshotDigest',
        'sourceCommit',
        'version',
      ]) &&
      finiteNonNegative(snapshot.compressedBytes) &&
      Number.isSafeInteger(snapshot.files) &&
      snapshot.files > 0 &&
      finiteNonNegative(snapshot.installedBytes) &&
      validDigest(snapshot.publicManifestDigest) &&
      validDigest(snapshot.snapshotDigest) &&
      snapshot.sourceCommit === report.provenance?.sourceCommit &&
      snapshot.version === packageEvidence.version &&
      sameJson(installedDocs?.evidence, evidence) &&
      compressedDocs?.unit === 'bytes' &&
      installedDocs?.unit === 'bytes' &&
      sameJson(compressedDocs?.samples, [snapshot.compressedBytes]) &&
      sameJson(installedDocs?.samples, [snapshot.installedBytes]);
    if (!validEvidence) {
      findings.push(
        `${label}.metrics packed docs bytes must match one workload/package/snapshot evidence record`,
      );
    }
  }
  return findings;
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
      ...validateDevPhaseCensus(
        report.devPhaseCensus,
        report.sampleCount,
        `${label}.devPhaseCensus`,
      ),
    );
    findings.push(...reportMetricCensusFindings(report, label));
  }
  return findings;
}

export function validateDeterministicArtifactReportIdentity(report, label = 'artifactReport') {
  const findings = [];
  if (report?.schema !== DEVEX_DETERMINISTIC_ARTIFACT_REPORT_SCHEMA) {
    findings.push(`${label}.schema must be ${DEVEX_DETERMINISTIC_ARTIFACT_REPORT_SCHEMA}`);
  }
  if (!exactOwnKeys(report, ['metrics', 'provenance', 'scenario', 'schema', 'subject'])) {
    findings.push(`${label} must contain only deterministic artifact report fields`);
  }
  if (report?.subject !== KOVO_PACKED_DOCS_REPORT_SUBJECT) {
    findings.push(`${label}.subject must be ${KOVO_PACKED_DOCS_REPORT_SUBJECT}`);
  }
  const definition = report?.scenario?.definition;
  const scenarioFindings = validateBenchmarkScenario(definition);
  findings.push(...scenarioFindings.map((finding) => `${label}.${finding}`));
  if (scenarioFindings.length > 0) return findings;
  if (
    !exactOwnKeys(report.scenario, ['definition', 'digest', 'name']) ||
    report.scenario.name !== definition.name
  ) {
    findings.push(`${label}.scenario.name does not match its definition`);
  }
  if (report.scenario.digest !== benchmarkScenarioDigest(definition)) {
    findings.push(`${label}.scenario.digest does not match its full definition`);
  }
  if (!sameJson(report.provenance, expectedReportProvenance(definition))) {
    findings.push(`${label}.provenance does not match its scenario definition`);
  }
  const metricIds =
    report.metrics && typeof report.metrics === 'object' && !Array.isArray(report.metrics)
      ? Object.keys(report.metrics).sort(compareStrings)
      : [];
  if (!sameJson(metricIds, [...KOVO_PACKED_DOCS_METRIC_IDS].sort(compareStrings))) {
    findings.push(
      `${label}.metrics must contain exactly the two packed docs snapshot byte metrics`,
    );
  }
  findings.push(...reportMetricCensusFindings(report, label));
  for (const metricId of KOVO_PACKED_DOCS_METRIC_IDS) {
    const metric = report.metrics?.[metricId];
    if (
      metric !== undefined &&
      (!exactOwnKeys(metric, ['evidence', 'samples', 'summary', 'unit']) ||
        !sameJson(metric.summary, sampleSummary(metric.samples ?? [])))
    ) {
      findings.push(`${label}.metrics.${metricId}.summary must match its exact sample`);
    }
  }
  return findings;
}

function validateRatificationReportIdentity(report, label, allowArtifactReport) {
  if (report?.schema === DEVEX_DETERMINISTIC_ARTIFACT_REPORT_SCHEMA) {
    if (!allowArtifactReport) {
      return [`${label}.schema must be ${DEVEX_BENCHMARK_REPORT_SCHEMA}`];
    }
    return validateDeterministicArtifactReportIdentity(report, label);
  }
  return validateBenchmarkReportIdentity(report, label);
}

/**
 * Bind the benchmark contract, not the revision under measurement. Exact source, tarball, and
 * manifest digests stay authenticated inside each report; carrying those volatile subjects into
 * the budget identity would make every later commit a scenario mismatch instead of a measurement.
 */
export function benchmarkWorkloadContractIdentity(report) {
  const definition = report?.scenario?.definition;
  const attestation = definition?.provenance?.producerAttestation;
  return {
    schema: KOVO_WORKLOAD_CONTRACT_SCHEMA,
    scenarioName: definition?.name,
    profile: structuredClone(definition?.profile),
    producer:
      attestation === undefined
        ? null
        : {
            schema: attestation.schema,
            producer: attestation.producer,
            consumer: attestation.consumer,
            releasePackages: structuredClone(attestation.releasePackages),
            profileCommandDigest: attestation.profileCommandDigest,
            browserBuildCommandDigest: attestation.browserBuildCommandDigest,
          },
    supportFiles: structuredClone(definition?.provenance?.supportFiles),
  };
}

function validateWorkloadIdentity(identity, label) {
  const findings = [];
  if (
    !exactOwnKeys(identity, ['producer', 'profile', 'scenarioName', 'schema', 'supportFiles']) ||
    identity.schema !== KOVO_WORKLOAD_CONTRACT_SCHEMA
  ) {
    findings.push(`${label} must be an exact ${KOVO_WORKLOAD_CONTRACT_SCHEMA} record`);
    return findings;
  }
  if (typeof identity.scenarioName !== 'string' || identity.scenarioName.trim().length === 0) {
    findings.push(`${label}.scenarioName must be a non-empty string`);
  }
  if (
    !exactOwnKeys(identity.profile, ['commandDigest', 'id']) ||
    identity.profile.id !== PACKED_PROFILE_ID ||
    identity.profile.commandDigest !== DEVEX_PACKED_PROFILE_COMMAND_DIGEST
  ) {
    findings.push(`${label}.profile must bind the code-owned packed profile`);
  }
  const expectedProducer = {
    schema: KOVO_PRODUCER_ATTESTATION_SCHEMA,
    producer: KOVO_FRESH_PACK_PRODUCER_ID,
    consumer: KOVO_BENCHMARK_CONSUMER,
    releasePackages: expectedKovoReleasePackages(),
    profileCommandDigest: DEVEX_PACKED_PROFILE_COMMAND_DIGEST,
    browserBuildCommandDigest: sha256(Buffer.from(canonicalJson(BROWSER_BUILD_COMMAND))),
  };
  if (
    identity.scenarioName === 'kovo-packed-check' &&
    !sameJson(identity.producer, expectedProducer)
  ) {
    findings.push(`${label}.producer must bind the exact code-owned package and command census`);
  } else if (identity.scenarioName !== 'kovo-packed-check' && identity.producer !== null) {
    findings.push(`${label}.producer is reserved for the authenticated Kovo production scenario`);
  }
  findings.push(...validateWorkloadFiles(identity.supportFiles, `${label}.supportFiles`));
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
  const binding = metricBinding(metricId);
  const evidenceSource = metricSource(metricId);
  const source = record?.baselineReport;
  if (!safeRepositoryRelativePath(source?.path)) {
    findings.push(`${metricId}.ratification.baselineReport.path must be repository-relative`);
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(source?.sha256 ?? '')) {
    findings.push(`${metricId}.ratification.baselineReport.sha256 is invalid`);
  }
  const allowedSchemas =
    binding === 'packed-artifact'
      ? new Set([DEVEX_BENCHMARK_REPORT_SCHEMA, DEVEX_DETERMINISTIC_ARTIFACT_REPORT_SCHEMA])
      : evidenceSource === 'golden-journey'
        ? new Set([DEVEX_GOLDEN_RELEASE_REPORT_SCHEMA])
        : evidenceSource === 'full-catalog'
          ? new Set([DEVEX_FULL_CATALOG_REPORT_SCHEMA])
          : new Set([DEVEX_BENCHMARK_REPORT_SCHEMA]);
  if (!allowedSchemas.has(source?.schema)) {
    findings.push(
      `${metricId}.ratification.baselineReport.schema must be ${
        binding === 'packed-artifact'
          ? `${DEVEX_BENCHMARK_REPORT_SCHEMA} or ${DEVEX_DETERMINISTIC_ARTIFACT_REPORT_SCHEMA}`
          : evidenceSource === 'golden-journey'
            ? DEVEX_GOLDEN_RELEASE_REPORT_SCHEMA
            : evidenceSource === 'full-catalog'
              ? DEVEX_FULL_CATALOG_REPORT_SCHEMA
              : DEVEX_BENCHMARK_REPORT_SCHEMA
      }`,
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
  const reportIdentityFindings = validateEvidenceReport(
    report,
    evidenceSource,
    `${metricId}.ratification.baselineReport`,
    {
      allowArtifactOnly: binding === 'packed-artifact',
      ratification: true,
      requireAcceptedRunner: evidenceSource === 'full-catalog',
      requireSuccessfulSamples: evidenceSource === 'full-catalog',
    },
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
  if (binding === 'runner' && !sameJson(report.runner, record.runnerFingerprint)) {
    findings.push(`${metricId}.ratification runner does not match its baseline report`);
  }
  const reportWorkload =
    binding !== 'runner' ? null : reportWorkloadIdentity(report, evidenceSource);
  if (binding === 'runner' && !sameJson(reportWorkload, record.workloadIdentity)) {
    findings.push(`${metricId}.ratification workload does not match its baseline report`);
  }
  if (
    binding === 'runner' &&
    evidenceSource === 'benchmark' &&
    budgets?.workload?.status === 'ratified' &&
    !sameJson(reportWorkload, budgets.workload.identity)
  ) {
    findings.push(`${metricId}.ratification workload differs from budgets.workload`);
  }
  const baselineMetric = report.metrics?.[metricId];
  if (baselineMetric?.unit !== metric.unit) {
    findings.push(`${metricId}.ratification baseline metric unit does not match budget unit`);
  }
  if (
    binding === 'packed-artifact' &&
    !sameJson(record.binding, packedArtifactBinding(baselineMetric?.evidence))
  ) {
    findings.push(`${metricId}.ratification packed-artifact binding does not match its report`);
  }
  const samples = baselineMetric?.samples;
  const requiredSamples =
    metric.sampling === 'deterministic'
      ? Number.isInteger(budgets.procedure?.deterministicSamples)
        ? budgets.procedure.deterministicSamples
        : Number.POSITIVE_INFINITY
      : Number.isInteger(budgets.procedure?.minimumBaselineStatisticalSamples)
        ? budgets.procedure.minimumBaselineStatisticalSamples
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
  if (!Number.isInteger(budgets?.procedure?.minimumBaselineStatisticalSamples)) {
    findings.push('procedure.minimumBaselineStatisticalSamples must be an integer');
  } else if (budgets.procedure.minimumBaselineStatisticalSamples < 5) {
    findings.push('procedure.minimumBaselineStatisticalSamples must be at least 5');
  }
  if (!Number.isInteger(budgets?.procedure?.minimumEvaluationStatisticalSamples)) {
    findings.push('procedure.minimumEvaluationStatisticalSamples must be an integer');
  } else if (budgets.procedure.minimumEvaluationStatisticalSamples < 5) {
    findings.push('procedure.minimumEvaluationStatisticalSamples must be at least 5');
  }
  if (budgets?.procedure?.deterministicSamples !== 1) {
    findings.push('procedure.deterministicSamples must be exactly 1');
  }
  if (
    !exactOwnKeys(budgets?.procedure?.noiseMultipliers, ['deterministic', 'statistical']) ||
    budgets.procedure.noiseMultipliers.deterministic !== 0 ||
    budgets.procedure.noiseMultipliers.statistical !== 3
  ) {
    findings.push('procedure.noiseMultipliers must fix deterministic=0 and statistical=3');
  }
  if (budgets?.procedure?.statistic !== 'metric-specific') {
    findings.push('procedure.statistic must be metric-specific');
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
  if (!sameJson(budgets?.runner?.machineClass, GITHUB_HOSTED_STANDARD_PUBLIC_MACHINE_CLASS)) {
    findings.push(
      'runner.machineClass must bind the public GitHub-hosted ubuntu-24.04 4-vCPU/16-GiB/14-GiB class',
    );
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
    if (
      contract &&
      (metric?.unit !== contract.unit ||
        metric?.sampling !== contract.sampling ||
        metric?.statistic !== contract.statistic ||
        metric?.source !== contract.source)
    ) {
      findings.push(
        `${metricId} must retain unit=${contract.unit}, sampling=${contract.sampling}, statistic=${contract.statistic}, and source=${contract.source}`,
      );
    }
    const expectedBinding = metricBinding(metricId);
    const declaredBinding = metric?.binding ?? 'runner';
    if (declaredBinding !== expectedBinding) {
      findings.push(`${metricId}.binding must be ${expectedBinding}`);
    }
    if (declaredBinding === 'packed-artifact' && metric?.sampling !== 'deterministic') {
      findings.push(`${metricId} cannot claim packed-artifact binding unless deterministic`);
    }
    if (!METRIC_UNITS.has(metric?.unit)) findings.push(`${metricId}.unit must be bytes or ms`);
    if (metric?.direction !== 'max') findings.push(`${metricId}.direction must be max`);
    if (!['deterministic', 'statistical'].includes(metric?.sampling)) {
      findings.push(`${metricId}.sampling must be deterministic or statistical`);
    }
    if (!STATISTICS.has(metric?.statistic)) {
      findings.push(`${metricId}.statistic must be median or p95`);
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
    const expectedNoiseMultiplier = budgets.procedure?.noiseMultipliers?.[metric.sampling];
    if (record.noiseMultiplier !== expectedNoiseMultiplier) {
      findings.push(
        `${metricId}.ratification.noiseMultiplier must match procedure.noiseMultipliers.${metric.sampling}`,
      );
    }
    if (record.noiseStatistic !== budgets.procedure?.noiseStatistic) {
      findings.push(`${metricId}.ratification.noiseStatistic must match the budget procedure`);
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
        ? (budgets.procedure?.deterministicSamples ?? Number.POSITIVE_INFINITY)
        : (budgets.procedure?.minimumBaselineStatisticalSamples ?? Number.POSITIVE_INFINITY);
    if (!Number.isInteger(record.sampleCount) || record.sampleCount < requiredSamples) {
      findings.push(`${metricId}.ratification.sampleCount invalid`);
    }
    if (!STATISTICS.has(record.statistic)) {
      findings.push(`${metricId}.ratification.statistic must be median or p95`);
    } else if (record.statistic !== metric.statistic) {
      findings.push(`${metricId}.ratification.statistic must match the metric contract`);
    }
    if (!finiteNonNegative(record.baseline)) {
      findings.push(`${metricId}.ratification.baseline invalid`);
    }
    if (expectedBinding === 'packed-artifact') {
      if (record.runnerFingerprint !== null) {
        findings.push(
          `${metricId}.ratification.runnerFingerprint must be null for packed-artifact binding`,
        );
      }
      if (record.workloadIdentity !== null) {
        findings.push(
          `${metricId}.ratification.workloadIdentity must be null for packed-artifact binding`,
        );
      }
      if (
        !exactOwnKeys(record.binding, ['evidenceSchema', 'kind', 'packageName', 'schema']) ||
        record.binding.schema !== KOVO_PACKED_ARTIFACT_BINDING_SCHEMA ||
        record.binding.kind !== 'packed-artifact' ||
        record.binding.evidenceSchema !== KOVO_PACKED_DOCS_EVIDENCE_SCHEMA ||
        record.binding.packageName !== '@kovojs/cli'
      ) {
        findings.push(
          `${metricId}.ratification.binding must bind the authenticated packed docs contract`,
        );
      }
    } else {
      if (record.binding !== undefined) {
        findings.push(`${metricId}.ratification.binding is reserved for packed artifacts`);
      }
      findings.push(
        ...validateRunnerFingerprint(
          record.runnerFingerprint,
          `${metricId}.ratification.runnerFingerprint`,
          { requireNamed: true },
        ),
      );
      findings.push(
        ...(metricSource(metricId) === 'golden-journey'
          ? validateGoldenWorkloadIdentity(
              record.workloadIdentity,
              `${metricId}.ratification.workloadIdentity`,
            )
          : metricSource(metricId) === 'full-catalog'
            ? validateFullCatalogWorkloadIdentity(
                record.workloadIdentity,
                `${metricId}.ratification.workloadIdentity`,
              )
            : validateWorkloadIdentity(
                record.workloadIdentity,
                `${metricId}.ratification.workloadIdentity`,
              )),
      );
    }
    if (
      expectedBinding === 'runner' &&
      metricSource(metricId) === 'benchmark' &&
      budgets?.runner?.status === 'ratified' &&
      !sameJson(record.runnerFingerprint, budgets.runner.fingerprint)
    ) {
      findings.push(`${metricId}.ratification runner differs from budgets.runner`);
    }
    if (
      expectedBinding === 'runner' &&
      metricSource(metricId) === 'benchmark' &&
      budgets?.workload?.status === 'ratified' &&
      !sameJson(record.workloadIdentity, budgets.workload.identity)
    ) {
      findings.push(`${metricId}.ratification workload differs from budgets.workload`);
    }
    findings.push(...validateRatificationProvenance(metricId, metric, record, budgets, options));
  }
  const runnerRatifiedMetricCount = Object.entries(budgets.metrics).filter(
    ([metricId, metric]) =>
      metricBinding(metricId) === 'runner' &&
      metricSource(metricId) === 'benchmark' &&
      metric?.ratification !== null,
  ).length;
  if (budgets?.runner?.status === 'unratified' && runnerRatifiedMetricCount > 0) {
    findings.push(
      'runner.status cannot be unratified while runner-bound metric ratifications exist',
    );
  }
  if (budgets?.runner?.status === 'ratified' && runnerRatifiedMetricCount === 0) {
    findings.push('runner.status cannot be ratified without a runner-bound metric ratification');
  }
  return findings;
}

function validateProposal(proposal, options = {}) {
  const findings = [];
  if (proposal?.schema !== DEVEX_BUDGET_PROPOSAL_SCHEMA) {
    findings.push(`proposal.schema must be ${DEVEX_BUDGET_PROPOSAL_SCHEMA}`);
  }
  if (options.requiresRunner === true) {
    findings.push(
      ...validateRunnerFingerprint(proposal?.runnerFingerprint, 'proposal.runnerFingerprint', {
        requireNamed: true,
      }),
    );
  } else if (proposal?.runnerFingerprint !== null) {
    findings.push('proposal.runnerFingerprint must be null for packed-artifact-only ratification');
  }
  if (
    !proposal?.metrics ||
    typeof proposal.metrics !== 'object' ||
    Array.isArray(proposal.metrics)
  ) {
    findings.push('proposal.metrics must be an object');
  } else if (Object.keys(proposal.metrics).length === 0) {
    findings.push('proposal.metrics must contain at least one metric');
  } else {
    for (const [metricId, metric] of Object.entries(proposal.metrics)) {
      if (!metric || typeof metric !== 'object' || Array.isArray(metric)) {
        findings.push(`proposal.metrics.${metricId} must be an object`);
        continue;
      }
      const unknownFields = Object.keys(metric).filter(
        (field) => !['budget', 'statistic', 'targetRationale'].includes(field),
      );
      if (unknownFields.length > 0) {
        findings.push(
          `proposal.metrics.${metricId} contains procedure-owned or unknown fields: ${unknownFields.join(', ')}`,
        );
      }
    }
  }
  return findings;
}

/**
 * Ratification is deliberately a second operation over an already-recorded baseline. A proposal
 * supplies the product target and rationale; the harness never invents a threshold from one run.
 */
export function ratifyBudgets(budgets, baselineReport, proposal, options = {}) {
  const reportSource = reportEvidenceSource(baselineReport);
  if (
    reportSource === 'benchmark' &&
    (baselineReport?.scenario?.name !== 'kovo-packed-check' ||
      !authenticatedProductionScenarios.has(options.authenticatedProductionScenario) ||
      !sameJson(baselineReport.scenario.definition, options.authenticatedProductionScenario))
  ) {
    throw new Error(
      'budget ratification requires the exact production scenario authenticated by the fresh code-owned pack producer',
    );
  }
  const proposalMetricIds =
    proposal?.metrics && typeof proposal.metrics === 'object' && !Array.isArray(proposal.metrics)
      ? Object.keys(proposal.metrics)
      : [];
  const incompatibleMetrics = proposalMetricIds.filter((metricId) => {
    const source = metricSource(metricId);
    if (reportSource === 'golden-journey') return source !== 'golden-journey';
    if (reportSource === 'full-catalog') return source !== 'full-catalog';
    return !['benchmark', 'packed-docs'].includes(source);
  });
  if (incompatibleMetrics.length > 0) {
    throw new Error(
      `${reportSource} baseline cannot ratify metrics from another evidence source: ${incompatibleMetrics.join(', ')}`,
    );
  }
  const runnerBoundProposal =
    proposal?.metrics !== null &&
    typeof proposal?.metrics === 'object' &&
    !Array.isArray(proposal.metrics) &&
    Object.keys(proposal.metrics).some((metricId) => metricBinding(metricId) === 'runner');
  const findings = [
    ...validateBudgets(budgets, {
      baselineReports: options.baselineReports,
      repoRoot: options.repoRoot,
    }),
    ...validateProposal(proposal, { requiresRunner: runnerBoundProposal }),
  ];
  findings.push(
    ...validateEvidenceReport(baselineReport, reportSource, 'baselineReport', {
      allowArtifactOnly: !runnerBoundProposal,
      ratification: true,
      requireAcceptedRunner: reportSource === 'full-catalog',
      requireSuccessfulSamples: reportSource === 'full-catalog',
    }),
  );
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
  if (runnerBoundProposal && !sameJson(baselineReport.runner, proposal.runnerFingerprint)) {
    throw new Error('baseline runner fingerprint does not match proposal.runnerFingerprint');
  }
  if (
    runnerBoundProposal &&
    reportSource === 'benchmark' &&
    budgets.runner.status === 'ratified' &&
    !sameJson(budgets.runner.fingerprint, baselineReport.runner)
  ) {
    throw new Error('baseline runner fingerprint does not match the existing ratified runner');
  }
  if (
    runnerBoundProposal &&
    reportSource === 'benchmark' &&
    budgets.workload.status === 'ratified' &&
    !sameJson(budgets.workload.identity, benchmarkWorkloadContractIdentity(baselineReport))
  ) {
    throw new Error('baseline workload identity does not match the existing ratified workload');
  }

  const updated = structuredClone(budgets);
  if (runnerBoundProposal && reportSource === 'benchmark') {
    updated.runner = {
      machineClass: structuredClone(updated.runner.machineClass),
      status: 'ratified',
      fingerprint: structuredClone(baselineReport.runner),
    };
    updated.workload = {
      status: 'ratified',
      identity: benchmarkWorkloadContractIdentity(baselineReport),
    };
  }
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
    const binding = metricBinding(metricId);
    if (
      binding === 'packed-artifact' &&
      reportSource === 'benchmark' &&
      !sameJson(
        baselineMetric?.evidence,
        authenticatedProductionDocsEvidence.get(options.authenticatedProductionScenario),
      )
    ) {
      throw new Error(
        `${metricId} baseline evidence does not match the authenticated packed CLI snapshot`,
      );
    }
    if (
      !Array.isArray(samples) ||
      samples.length === 0 ||
      samples.some((value) => !finiteNonNegative(value))
    ) {
      throw new Error(`baseline report has no valid samples for ${metricId}`);
    }
    const requiredSamples =
      metric.sampling === 'deterministic'
        ? updated.procedure.deterministicSamples
        : updated.procedure.minimumBaselineStatisticalSamples;
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
    const statistic = proposed.statistic ?? metric.statistic;
    if (statistic !== metric.statistic) {
      throw new Error(`${metricId} statistic must remain ${metric.statistic}`);
    }
    const noiseMultiplier = updated.procedure.noiseMultipliers[metric.sampling];
    const noise = metric.sampling === 'deterministic' ? 0 : medianAbsoluteDeviation(samples);
    const budget = proposed.budget;
    metric.ratification = {
      runnerFingerprint:
        binding === 'packed-artifact' ? null : structuredClone(baselineReport.runner),
      workloadIdentity:
        binding === 'packed-artifact' ? null : reportWorkloadIdentity(baselineReport, reportSource),
      baselineReport: structuredClone(baselineReportSource),
      ...(binding === 'packed-artifact'
        ? { binding: packedArtifactBinding(baselineMetric.evidence) }
        : {}),
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
  const reportSource = reportEvidenceSource(report);
  const reportFindings = validateEvidenceReport(report, reportSource, 'report', {
    requireSuccessfulSamples: reportSource === 'full-catalog',
  });
  if (reportFindings.length > 0) {
    throw new Error(`Invalid ${reportSource} report:\n- ${reportFindings.join('\n- ')}`);
  }
  const reportWorkload = reportWorkloadIdentity(report, reportSource);
  const results = [];
  for (const [metricId, metric] of Object.entries(budgets.metrics)) {
    const source = metricSource(metricId);
    const applicable =
      source === reportSource || (reportSource === 'benchmark' && source === 'packed-docs');
    if (!applicable) {
      results.push({ metric: metricId, source, status: 'not-applicable' });
      continue;
    }
    if (metric.ratification === null) {
      results.push({
        metric: metricId,
        source,
        status: options.requireRatified === true ? 'unratified-required' : 'unratified',
      });
      continue;
    }
    const binding = metricBinding(metricId);
    if (
      binding === 'packed-artifact' &&
      !sameJson(
        packedArtifactBinding(report.metrics?.[metricId]?.evidence),
        metric.ratification.binding,
      )
    ) {
      results.push({
        metric: metricId,
        status: 'artifact-mismatch',
        expectedBinding: metric.ratification.binding,
        actualBinding: packedArtifactBinding(report.metrics?.[metricId]?.evidence),
      });
      continue;
    }
    if (binding === 'runner' && !sameJson(reportWorkload, metric.ratification.workloadIdentity)) {
      results.push({
        metric: metricId,
        status: 'scenario-mismatch',
        expectedWorkload: metric.ratification.workloadIdentity,
        actualWorkload: reportWorkload,
      });
      continue;
    }
    if (binding === 'runner' && !sameJson(report.runner, metric.ratification.runnerFingerprint)) {
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
      metric.sampling === 'deterministic'
        ? budgets.procedure.deterministicSamples
        : budgets.procedure.minimumEvaluationStatisticalSamples;
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
          'artifact-mismatch',
          'insufficient-samples',
          'missing',
          'runner-mismatch',
          'scenario-mismatch',
          'unit-mismatch',
          'unratified-required',
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
    const consumerSourceRoot = path.join(temporaryPackRoot, 'consumer-source');
    copyRegularDirectory(
      nonSymlinkDescendant(repositoryRoot, recipe.consumerSource, {
        kind: 'directory',
        label: 'Kovo benchmark consumer source',
      }),
      consumerSourceRoot,
      'Kovo benchmark consumer source',
    );
    copyFileSync(
      regularFileInsideRoot(repositoryRoot, 'pnpm-lock.yaml', 'Kovo benchmark source lockfile'),
      path.join(consumerSourceRoot, 'benchmark-lock.yaml'),
    );
    const consumerTarball = packWithoutLifecycleScripts(
      {
        name: KOVO_BENCHMARK_CONSUMER,
        version: '1.0.0',
        dirPath: consumerSourceRoot,
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

function copyRegularDirectory(source, destination, label) {
  const sourceStat = lstatSync(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink directory`);
  }
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const sourceEntry = path.join(source, entry.name);
    const destinationEntry = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`${label} contains a symbolic link: ${entry.name}`);
    }
    if (entry.isDirectory()) {
      copyRegularDirectory(sourceEntry, destinationEntry, `${label}/${entry.name}`);
    } else if (entry.isFile()) {
      copyFileSync(sourceEntry, destinationEntry);
    } else {
      throw new Error(`${label} contains a non-regular entry: ${entry.name}`);
    }
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
    authenticatedProductionDocsEvidence.set(
      materialized.scenario,
      packedDocsSnapshotEvidence(materialized.scenario, {
        repositoryRoot: produced.repositoryRoot,
        root: materialized.outputRoot,
      }),
    );
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
    else if (arg === '--require-ratified') args.requireRatified = true;
    else if (arg === '--deterministic-artifacts') args.deterministicArtifacts = true;
    else if (arg === '--ratify') args.ratify = true;
    else if (arg === '--baseline') args.baseline = argv[++index];
    else if (arg === '--baseline-record-path') args.baselineRecordPath = argv[++index];
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
    '  node scripts/devex-benchmark.mjs --scenario <file> [--samples N] [--output <file>] [--evaluate] [--require-ratified]',
    '  node scripts/devex-benchmark.mjs --scenario <file> --deterministic-artifacts [--output <file>]',
    '  node scripts/devex-benchmark.mjs --ratify --baseline <report> [--baseline-record-path <path>] --proposal <file> [--write]',
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
    const relativeBaselinePath =
      args.baselineRecordPath ?? path.relative(budgetsRoot, baselinePath);
    const baselineBytes = readFileSync(baselinePath);
    const baselineReport = JSON.parse(baselineBytes.toString('utf8'));
    if (baselineReport?.schema === DEVEX_GOLDEN_RELEASE_REPORT_SCHEMA) {
      const updated = ratifyBudgets(
        budgets,
        baselineReport,
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
    if (baselineReport?.schema === DEVEX_FULL_CATALOG_REPORT_SCHEMA) {
      const updated = ratifyBudgets(
        budgets,
        baselineReport,
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
  if (args.deterministicArtifacts && args.evaluate) {
    throw new Error('--deterministic-artifacts cannot be combined with --evaluate');
  }
  if (args.requireRatified && !args.evaluate) {
    throw new Error('--require-ratified requires --evaluate');
  }
  const report = args.deterministicArtifacts
    ? runDeterministicArtifactScenario(readJson(scenarioPath))
    : runBenchmarkScenario(readJson(scenarioPath), {
        root: path.dirname(scenarioPath),
        samples: args.samples,
      });
  if (args.evaluate) {
    report.evaluation = evaluateBudgets(budgets, report, {
      repoRoot: path.dirname(path.resolve(args.budgets)),
      requireRatified: args.requireRatified,
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
