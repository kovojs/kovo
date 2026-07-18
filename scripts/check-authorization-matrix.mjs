#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot } from './lib/repo-root.mjs';

export const authorizationMatrixSchema = 'kovo.authorization-matrix/v1';
export const defaultAuthorizationMatrixPath = 'security/authorization-matrix.json';

const requiredDimensions = Object.freeze({
  operation: ['boot', 'insert', 'invoke', 'read', 'schedule'],
  ownership: ['not-applicable', 'other', 'own', 'owner-via', 'reference', 'unclassified'],
  principal: [
    'act-as-other',
    'act-as-owner',
    'ambient-reader',
    'anonymous',
    'runtime-login',
    'session-owner',
  ],
  queryFamily: [
    'alias',
    'builder',
    'cte',
    'function',
    'join',
    'none',
    'raw-sql',
    'relational',
    'subquery-in-from',
    'union',
    'view',
  ],
  surface: ['closure-audit', 'durable-task', 'endpoint', 'mutation', 'readonlyAppDb', 'webhook'],
});

const expectedVerdicts = new Set([
  'allow',
  'allow-own-only',
  'boot-refuse',
  'deny',
  'idempotent',
  'least-privilege',
]);

const requiredCanaries = Object.freeze({
  'authorization-matrix/allow-cross-owner-builder-read': {
    caseId: 'endpoint-builder-act-as-owner',
    expected: 'allow-own-only',
  },
  'authorization-matrix/allow-cross-owner-raw-write': {
    caseId: 'mutation-raw-cross-owner',
    expected: 'deny',
  },
  'authorization-matrix/allow-cross-schema-definer-function': {
    caseId: 'closure-cross-schema-definer-function-refusal',
    expected: 'boot-refuse',
  },
  'authorization-matrix/allow-provision-role-assumption': {
    caseId: 'runtime-provision-role-assumption-denied',
    expected: 'deny',
  },
  'authorization-matrix/deny-durable-task-owner-read': {
    caseId: 'durable-task-act-as-owner',
    expected: 'allow-own-only',
  },
});

export function validateAuthorizationMatrix({
  matrixPath = defaultAuthorizationMatrixPath,
  rootDir = repoRoot(),
} = {}) {
  const absolutePath = path.join(rootDir, matrixPath);
  let document;
  try {
    document = JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    return result([`${matrixPath}: cannot read valid JSON: ${error.message}`]);
  }
  return validateAuthorizationMatrixDocument(document, { label: matrixPath });
}

export function validateAuthorizationMatrixDocument(
  document,
  { label = defaultAuthorizationMatrixPath } = {},
) {
  const findings = [];
  if (!plainObject(document)) return result([`${label}: root must be an object`]);
  if (document.schema !== authorizationMatrixSchema) {
    findings.push(`${label}: schema must be ${authorizationMatrixSchema}`);
  }
  requireNonEmptyString(document.seed, `${label}: seed`, findings);
  validateReplay(document.replay, document.seed, label, findings);

  const dimensions = plainObject(document.dimensions) ? document.dimensions : {};
  if (!plainObject(document.dimensions)) findings.push(`${label}: dimensions must be an object`);
  for (const [dimension, requiredValues] of Object.entries(requiredDimensions)) {
    const declaredValues = stringArray(
      dimensions[dimension],
      `${label}: dimensions.${dimension}`,
      findings,
    );
    compareExactSet(declaredValues, requiredValues, `${label}: dimensions.${dimension}`, findings);
  }

  const cases = arrayField(document, 'cases', label, findings);
  const casesById = new Map();
  const observedDimensions = Object.fromEntries(
    Object.keys(requiredDimensions).map((dimension) => [dimension, new Set()]),
  );
  for (const [index, testCase] of cases.entries()) {
    const caseLabel = `${label}: cases[${index}]`;
    if (!plainObject(testCase)) {
      findings.push(`${caseLabel} must be an object`);
      continue;
    }
    requireNonEmptyString(testCase.id, `${caseLabel}.id`, findings);
    if (typeof testCase.id === 'string') {
      if (casesById.has(testCase.id)) findings.push(`${caseLabel}.id duplicates ${testCase.id}`);
      casesById.set(testCase.id, testCase);
    }
    if (!expectedVerdicts.has(testCase.expected)) {
      findings.push(`${caseLabel}.expected must be a closed matrix verdict`);
    }
    for (const dimension of ['operation', 'surface']) {
      const value = testCase[dimension];
      if (typeof value !== 'string' || !dimensions[dimension]?.includes(value)) {
        findings.push(`${caseLabel}.${dimension} must name a declared dimension value`);
      } else {
        observedDimensions[dimension].add(value);
      }
    }
    for (const dimension of ['ownership', 'principal', 'queryFamily']) {
      const values = stringArray(testCase[dimension], `${caseLabel}.${dimension}`, findings);
      for (const value of values) {
        if (!dimensions[dimension]?.includes(value)) {
          findings.push(`${caseLabel}.${dimension} contains undeclared value ${value}`);
        } else {
          observedDimensions[dimension].add(value);
        }
      }
    }
  }

  for (const [dimension, requiredValues] of Object.entries(requiredDimensions)) {
    const missing = requiredValues.filter((value) => !observedDimensions[dimension].has(value));
    if (missing.length > 0) {
      findings.push(`${label}: matrix does not execute ${dimension} values: ${missing.join(', ')}`);
    }
  }

  validateCanaries(document.canaries, document.regressionSeeds, casesById, label, findings);

  return result(findings, {
    canaryCount: Array.isArray(document.canaries) ? document.canaries.length : 0,
    caseCount: cases.length,
    dimensionObligations: Object.values(requiredDimensions).reduce(
      (total, values) => total + values.length,
      0,
    ),
  });
}

function validateReplay(replay, seed, label, findings) {
  if (!plainObject(replay)) {
    findings.push(`${label}: replay must be an object`);
    return;
  }
  if (
    typeof replay.command !== 'string' ||
    !replay.command.includes(`KOVO_AUTHZ_MATRIX_SEED=${seed}`) ||
    !replay.command.includes('pnpm run test:authz-paranoid')
  ) {
    findings.push(`${label}: replay.command must pin the seed and paranoid served-artifact gate`);
  }
  if (
    typeof replay.failureDirectory !== 'string' ||
    !replay.failureDirectory.startsWith('.kovo/security-failures/') ||
    path.isAbsolute(replay.failureDirectory) ||
    replay.failureDirectory.includes('..')
  ) {
    findings.push(`${label}: replay.failureDirectory must stay below .kovo/security-failures`);
  }
}

function validateCanaries(canariesValue, seedsValue, casesById, label, findings) {
  const canaries = Array.isArray(canariesValue) ? canariesValue : [];
  if (!Array.isArray(canariesValue)) findings.push(`${label}: canaries must be an array`);
  const seeds = Array.isArray(seedsValue) ? seedsValue : [];
  if (!Array.isArray(seedsValue)) findings.push(`${label}: regressionSeeds must be an array`);

  const canariesByMutation = new Map();
  for (const [index, canary] of canaries.entries()) {
    const canaryLabel = `${label}: canaries[${index}]`;
    if (!plainObject(canary)) {
      findings.push(`${canaryLabel} must be an object`);
      continue;
    }
    requireNonEmptyString(canary.id, `${canaryLabel}.id`, findings);
    requireNonEmptyString(canary.mutation, `${canaryLabel}.mutation`, findings);
    requireNonEmptyString(canary.caseId, `${canaryLabel}.caseId`, findings);
    if (typeof canary.mutation === 'string') {
      if (canariesByMutation.has(canary.mutation)) {
        findings.push(`${canaryLabel}.mutation duplicates ${canary.mutation}`);
      }
      canariesByMutation.set(canary.mutation, canary);
    }
  }

  for (const [mutation, requirement] of Object.entries(requiredCanaries)) {
    const canary = canariesByMutation.get(mutation);
    if (!canary) {
      findings.push(`${label}: missing required authorization canary ${mutation}`);
      continue;
    }
    if (canary.caseId !== requirement.caseId) {
      findings.push(`${label}: ${mutation} must be killed by ${requirement.caseId}`);
    }
    const testCase = casesById.get(requirement.caseId);
    if (!testCase) {
      findings.push(`${label}: canary case ${requirement.caseId} is missing`);
    } else if (testCase.expected !== requirement.expected) {
      findings.push(
        `${label}: canary case ${requirement.caseId} must expect ${requirement.expected}`,
      );
    }
    const replaySeed = seeds.find(
      (seed) => plainObject(seed) && seed.id === canary.id && seed.caseId === canary.caseId,
    );
    if (
      !replaySeed ||
      typeof replaySeed.seed !== 'string' ||
      typeof replaySeed.minimizedRepro !== 'string' ||
      replaySeed.minimizedRepro.trim() === ''
    ) {
      findings.push(`${label}: canary ${canary.id} needs a persisted seed and minimized repro`);
    }
  }
}

function compareExactSet(actual, expected, label, findings) {
  const actualSorted = [...new Set(actual)].sort((left, right) => left.localeCompare(right));
  const expectedSorted = [...expected].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    findings.push(`${label} must equal ${expectedSorted.join(', ')}`);
  }
}

function arrayField(object, key, label, findings) {
  if (Array.isArray(object[key])) return object[key];
  findings.push(`${label}: ${key} must be an array`);
  return [];
}

function stringArray(value, label, findings) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== 'string')
  ) {
    findings.push(`${label} must be a non-empty string array`);
    return [];
  }
  return value;
}

function requireNonEmptyString(value, label, findings) {
  if (typeof value !== 'string' || value.trim() === '') findings.push(`${label} must be non-empty`);
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function result(findings, summary = {}) {
  return { findings, ok: findings.length === 0, summary };
}

export function runAuthorizationMatrixCheck(options = {}) {
  const check = validateAuthorizationMatrix(options);
  if (check.ok) {
    process.stdout.write(
      `check-authorization-matrix/v1\nOK cases=${check.summary.caseCount} dimensions=${check.summary.dimensionObligations} canaries=${check.summary.canaryCount}\n`,
    );
    return 0;
  }
  process.stderr.write(
    `check-authorization-matrix/v1\nFAIL findings=${check.findings.length}:\n${check.findings
      .map((finding) => `- ${finding}`)
      .join('\n')}\n`,
  );
  return 1;
}

async function main() {
  process.exitCode = runAuthorizationMatrixCheck();
}

if (isMainEntry(import.meta.url)) await runGate(main);
