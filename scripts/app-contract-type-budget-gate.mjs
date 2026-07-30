#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot } from './lib/repo-root.mjs';

export const APP_CONTRACT_TYPE_BUDGET_SCHEMA = 'kovo.app-contract-type-budgets/v1';
export const DEFAULT_APP_CONTRACT_TYPE_BUDGET_FILE =
  'conformance/app-contract-spike/type-budgets-v1.json';

const TIMING_FIELDS = Object.freeze(['coldTscP50Ms', 'warmTscP50Ms', 'coldCompletionP50Ms']);
const require = createRequire(import.meta.url);
const defaultTscPath = require.resolve('typescript/bin/tsc');

export function loadAppContractTypeBudgetManifest(options = {}) {
  const root = options.repoRoot ?? repoRoot();
  const manifestFile =
    options.manifestFile ?? path.join(root, DEFAULT_APP_CONTRACT_TYPE_BUDGET_FILE);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const findings = validateAppContractTypeBudgetManifest(manifest);
  if (findings.length > 0) {
    throw new TypeError(`App-contract type-budget manifest is invalid:\n${findings.join('\n')}`);
  }
  return manifest;
}

export function validateAppContractTypeBudgetManifest(manifest) {
  const findings = [];
  if (!isRecord(manifest)) return ['manifest must be an object'];
  if (manifest.schema !== APP_CONTRACT_TYPE_BUDGET_SCHEMA) {
    findings.push(`schema must be ${APP_CONTRACT_TYPE_BUDGET_SCHEMA}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}\.\d+$/u.test(manifest.budgetVersion ?? '')) {
    findings.push('budgetVersion must be a dated, revisioned value');
  }
  validateRatification(manifest.ratification, findings);
  validateBaseline(manifest.baseline, manifest.ratification, findings);
  validateDerivation(manifest.derivation, findings);
  validateBudgets(manifest, findings);
  validateMeasurement(manifest.measurement, findings);
  return findings;
}

export function measureAppContractTypeInstantiations(options = {}) {
  const root = options.repoRoot ?? repoRoot();
  const tscPath = options.tscPath ?? defaultTscPath;
  const run = options.spawn ?? spawnSync;
  const configPath =
    options.configPath ??
    path.join(root, 'packages/server/type-fixtures/app-contract/tsconfig.json');
  const result = run(
    process.execPath,
    [tscPath, '-p', configPath, '--extendedDiagnostics', '--incremental', 'false'],
    { cwd: root, encoding: 'utf8' },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0) {
    throw new Error(`App-contract extended-diagnostics fixture failed:\n${output}`);
  }
  const matches = [...output.matchAll(/^Instantiations:\s+(\d+)\s*$/gmu)];
  if (matches.length !== 1) {
    throw new Error(
      `App-contract extended-diagnostics fixture must report exactly one Instantiations count; received ${String(matches.length)}.`,
    );
  }
  const instantiations = Number(matches[0]?.[1]);
  if (!Number.isSafeInteger(instantiations) || instantiations <= 0) {
    throw new Error('App-contract extended-diagnostics fixture reported an invalid count.');
  }
  return instantiations;
}

export function deriveRatifiedTypeBudgets(manifest) {
  const baseline = manifest.baseline.measurements;
  const derivation = manifest.derivation;
  const timing = Object.fromEntries(
    TIMING_FIELDS.map((field) => [
      field,
      roundUp(
        baseline[field] * (1 + derivation.timingHeadroomPercent / 100),
        derivation.timingRoundingQuantumMs,
      ),
    ]),
  );
  return {
    ...timing,
    completionCandidateCount: baseline.completionCandidateCount,
    completionCandidateDigest: baseline.completionCandidateDigest,
    declarationBytesMaximum: roundUp(
      baseline.declarationBytes * (1 + derivation.declarationHeadroomPercent / 100),
      derivation.declarationRoundingQuantumBytes,
    ),
    diagnosticMessageCharactersMaximum: baseline.diagnosticMessageCharactersMaximum,
    diagnosticSpanCharacters: baseline.diagnosticSpanCharacters,
    instantiationsMaximum:
      baseline.instantiations === null
        ? null
        : roundUp(
            baseline.instantiations * (1 + derivation.instantiationHeadroomPercent / 100),
            derivation.instantiationRoundingQuantum,
          ),
    warmCompletionP95Ms: 5,
  };
}

export function evaluateAppContractTypeBudgets(manifest, measurement, options = {}) {
  const findings = [];
  const enforceTimings = options.enforceTimings ?? false;
  if (!isRecord(measurement)) return { findings: ['measurement must be an object'], ok: false };

  if (enforceTimings) {
    for (const field of [...TIMING_FIELDS, 'warmCompletionP95Ms']) {
      const actual = measurement[field];
      const ceiling = manifest.budgets[field];
      if (!isFiniteNumber(actual) || actual > ceiling) {
        findings.push(`${field} ${String(actual)} exceeds ${ceiling}`);
      }
    }
  }

  for (const field of ['declarationBytesMaximum', 'diagnosticMessageCharactersMaximum']) {
    const measurementField =
      field === 'declarationBytesMaximum' ? 'declarationBytes' : 'diagnosticMessageCharacters';
    const actual = measurement[measurementField];
    if (!isFiniteNumber(actual) || actual > manifest.budgets[field]) {
      findings.push(`${measurementField} ${String(actual)} exceeds ${manifest.budgets[field]}`);
    }
  }
  if (measurement.diagnosticSpanCharacters !== manifest.budgets.diagnosticSpanCharacters) {
    findings.push(
      `diagnosticSpanCharacters must equal ${manifest.budgets.diagnosticSpanCharacters}`,
    );
  }
  if (measurement.completionCandidateCount !== manifest.budgets.completionCandidateCount) {
    findings.push(
      `completionCandidateCount must equal ${manifest.budgets.completionCandidateCount}`,
    );
  }
  if (measurement.completionCandidateDigest !== manifest.budgets.completionCandidateDigest) {
    findings.push('completionCandidateDigest differs from the ratified candidate set');
  }

  if (manifest.ratification.instantiations !== 'ratified') {
    findings.push('extendedDiagnostics instantiation ceiling is not ratified');
  } else if (
    !Number.isSafeInteger(measurement.instantiations) ||
    measurement.instantiations > manifest.budgets.instantiationsMaximum
  ) {
    findings.push(
      `instantiations ${String(measurement.instantiations)} exceeds ${manifest.budgets.instantiationsMaximum}`,
    );
  }
  return { findings, ok: findings.length === 0 };
}

export function exactRatifiedRunnerMatches(manifest, actual) {
  const expected = manifest.baseline.runner;
  return (
    isRecord(actual) &&
    [
      'architecture',
      'cpuModel',
      'nodeVersion',
      'operatingSystem',
      'runnerName',
      'typescriptVersion',
    ].every((field) => actual[field] === expected[field])
  );
}

function validateRatification(value, findings) {
  if (!isRecord(value)) {
    findings.push('ratification must be an object');
    return;
  }
  if (value.timings !== 'ratified') findings.push('timing budgets must be ratified');
  if (!['pending-measurement', 'ratified'].includes(value.instantiations)) {
    findings.push('instantiation ratification must be pending-measurement or ratified');
  }
}

function validateBaseline(value, ratification, findings) {
  if (!isRecord(value)) {
    findings.push('baseline must be an object');
    return;
  }
  if (value.variant !== 'arm-a') findings.push('baseline variant must be the selected D1 Arm A');
  for (const [name, subject] of [
    ['criteriaSubject', value.criteriaSubject],
    ['evidenceSubject', value.evidenceSubject],
  ]) {
    if (
      !isRecord(subject) ||
      typeof subject.path !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(subject.sha256 ?? '')
    ) {
      findings.push(`${name} must carry a path and SHA-256 subject`);
    }
  }
  if (
    value.criteriaSubject?.sha256 !==
    'd05ffa8fe6182e6ffbf69619af15bf64aa5f0788a58f554c80e09f885bf87a98'
  ) {
    findings.push('criteriaSubject must bind the independently preregistered D1 v6 criteria');
  }
  const runner = value.runner;
  if (
    !isRecord(runner) ||
    runner.runnerName !== 'apple-m4-darwin-arm64-node24-ts6-d1-v6' ||
    runner.cpuModel !== 'Apple M4' ||
    runner.architecture !== 'arm64' ||
    runner.nodeVersion !== 'v24.18.1' ||
    runner.typescriptVersion !== '6.0.3'
  ) {
    findings.push('baseline runner must retain the exact D1 v6 Apple M4 identity');
  }
  const measurements = value.measurements;
  if (!isRecord(measurements)) {
    findings.push('baseline measurements must be an object');
    return;
  }
  for (const field of [
    ...TIMING_FIELDS,
    'warmCompletionP95Ms',
    'declarationBytes',
    'completionCandidateCount',
    'diagnosticMessageCharactersMaximum',
    'diagnosticSpanCharacters',
  ]) {
    if (!isFiniteNumber(measurements[field])) {
      findings.push(`baseline measurements.${field} must be numeric`);
    }
  }
  if (!/^[a-f0-9]{64}$/u.test(measurements.completionCandidateDigest ?? '')) {
    findings.push('baseline completionCandidateDigest must be SHA-256');
  }
  if (
    ratification?.instantiations === 'ratified' &&
    !Number.isSafeInteger(measurements.instantiations)
  ) {
    findings.push('ratified baseline instantiations must be a safe integer');
  }
  validateInstantiationMeasurement(value.instantiationMeasurement, ratification, findings);
}

function validateInstantiationMeasurement(value, ratification, findings) {
  if (!isRecord(value)) {
    findings.push('baseline.instantiationMeasurement must be an object');
    return;
  }
  const expected = {
    command:
      'pnpm exec tsc -p packages/server/type-fixtures/app-contract/tsconfig.json --extendedDiagnostics --incremental false',
    typescriptVersion: '6.0.3',
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) {
      findings.push(`baseline.instantiationMeasurement.${field} must equal ${expectedValue}`);
    }
  }
  for (const [label, subject, expectedPath] of [
    ['fixture', value.fixture, 'packages/server/type-fixtures/app-contract/positive.ts'],
    ['tsconfig', value.tsconfig, 'packages/server/type-fixtures/app-contract/tsconfig.json'],
  ]) {
    if (
      !isRecord(subject) ||
      subject.path !== expectedPath ||
      !/^[a-f0-9]{64}$/u.test(subject.sha256 ?? '')
    ) {
      findings.push(
        `baseline.instantiationMeasurement.${label} must bind ${expectedPath} by SHA-256`,
      );
    }
  }
  if (ratification?.instantiations !== 'ratified') {
    findings.push('extendedDiagnostics instantiation ceiling must be ratified');
  }
}

function validateDerivation(value, findings) {
  if (!isRecord(value)) {
    findings.push('derivation must be an object');
    return;
  }
  const expected = {
    declarationHeadroomPercent: 35,
    declarationRoundingQuantumBytes: 500,
    instantiationHeadroomPercent: 20,
    instantiationRoundingQuantum: 1000,
    timingHeadroomPercent: 30,
    timingRoundingQuantumMs: 50,
    warmCompletionCeilingSource:
      'criteria-v6.performanceThresholds.warmCompletionP95MillisecondsMaximum',
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) {
      findings.push(`derivation.${field} must equal ${String(expectedValue)}`);
    }
  }
}

function validateBudgets(manifest, findings) {
  if (!isRecord(manifest.budgets) || !isRecord(manifest.baseline?.measurements)) {
    findings.push('budgets must be an object');
    return;
  }
  const derived = deriveRatifiedTypeBudgets(manifest);
  for (const [field, expected] of Object.entries(derived)) {
    if (manifest.budgets[field] !== expected) {
      findings.push(`budgets.${field} must equal derived value ${String(expected)}`);
    }
  }
  if (
    manifest.ratification?.instantiations === 'ratified' &&
    !Number.isSafeInteger(manifest.budgets.instantiationsMaximum)
  ) {
    findings.push('ratified instantiationsMaximum must be a safe integer');
  }
}

function validateMeasurement(value, findings) {
  if (!isRecord(value)) {
    findings.push('measurement must be an object');
    return;
  }
  const expected = {
    coldCompletionRepeats: 12,
    coldTscRepeats: 12,
    instantiationsEnforcedOnEveryRunner: true,
    timingsEnforcedOnlyOnExactRunner: true,
    warmCompletionRepeats: 60,
    warmTscRepeats: 12,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) {
      findings.push(`measurement.${field} must equal ${String(expectedValue)}`);
    }
  }
}

function roundUp(value, quantum) {
  return Math.ceil(value / quantum) * quantum;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function main() {
  const manifest = loadAppContractTypeBudgetManifest();
  const criteriaPath = path.join(repoRoot(), manifest.baseline.criteriaSubject.path);
  const criteriaDigest = createHash('sha256').update(readFileSync(criteriaPath)).digest('hex');
  if (criteriaDigest !== manifest.baseline.criteriaSubject.sha256) {
    throw new Error('D1 v6 preregistered criteria digest differs from the ratification subject.');
  }
  const typescriptVersion = JSON.parse(
    readFileSync(require.resolve('typescript/package.json'), 'utf8'),
  ).version;
  if (typescriptVersion !== manifest.baseline.instantiationMeasurement.typescriptVersion) {
    throw new Error(
      `App-contract instantiation baseline requires TypeScript ${manifest.baseline.instantiationMeasurement.typescriptVersion}; received ${String(typescriptVersion)}.`,
    );
  }
  for (const subject of [
    manifest.baseline.instantiationMeasurement.fixture,
    manifest.baseline.instantiationMeasurement.tsconfig,
  ]) {
    const digest = createHash('sha256')
      .update(readFileSync(path.join(repoRoot(), subject.path)))
      .digest('hex');
    if (digest !== subject.sha256) {
      throw new Error(`App-contract type-budget subject drifted: ${subject.path}.`);
    }
  }
  const instantiations = measureAppContractTypeInstantiations();
  if (instantiations > manifest.budgets.instantiationsMaximum) {
    throw new Error(
      `App-contract type instantiations ${String(instantiations)} exceed ${String(manifest.budgets.instantiationsMaximum)}.`,
    );
  }
  process.stdout.write(
    [
      `app-contract-type-budget/${manifest.schema.split('/').at(-1)}`,
      `timings=${manifest.ratification.timings}`,
      `instantiations=${String(instantiations)}/${String(manifest.budgets.instantiationsMaximum)}`,
      `cold-tsc-p50<=${manifest.budgets.coldTscP50Ms}ms`,
      `warm-tsc-p50<=${manifest.budgets.warmTscP50Ms}ms`,
      `cold-completion-p50<=${manifest.budgets.coldCompletionP50Ms}ms`,
      `warm-completion-p95<=${manifest.budgets.warmCompletionP95Ms}ms`,
    ].join(' ') + '\n',
  );
}

if (isMainEntry(import.meta.url)) {
  await runGate(main);
}
