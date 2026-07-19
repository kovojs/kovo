#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const repoRoot = findRepoRoot();
export const modelBoundarySchema = 'kovo.replay-model-boundary/v1';
export const SPEC_BOUNDARY_MARKER = '<!-- kovo-model-boundary:replay-reservation/v1 -->';

const protocolAlphabetPath = 'formal/replay/protocol-alphabet.json';
const modelBoundaryPath = 'packages/cli/src/replay-model-boundary.json';
const specPath = 'spec/10-data-plane.md';
const expectedProtocolSchema = 'kovo-protocol-alphabet/v1';
const expectedBounds = Object.freeze({
  backwardClockSteps: 1,
  crashPoints: 1,
  identities: 2,
  replicas: 2,
  slots: 2,
});

function asciiCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUniqueStrings(value, label, findings) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry === '')) {
    findings.push(`${label} must be an array of non-empty strings`);
    return [];
  }
  const sorted = [...new Set(value)].sort(asciiCompare);
  if (sorted.length !== value.length) findings.push(`${label} must not contain duplicates`);
  if (value.some((entry, index) => entry !== sorted[index])) {
    findings.push(`${label} must be ASCII-sorted`);
  }
  return sorted;
}

function sameRecord(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateModelHonestyBoundary({ boundary, protocol, specText }) {
  const findings = [];
  if (protocol?.schema !== expectedProtocolSchema) {
    findings.push(`protocol alphabet schema must be ${expectedProtocolSchema}`);
  }
  if (boundary?.schema !== modelBoundarySchema) {
    findings.push(`model boundary schema must be ${modelBoundarySchema}`);
  }
  if (boundary?.id !== 'replay-reservation/v1') {
    findings.push('model boundary id must be replay-reservation/v1');
  }
  if (boundary?.status !== 'registered-not-model-checked') {
    findings.push(
      'model boundary status must remain registered-not-model-checked until TLC evidence lands',
    );
  }
  if (!sameRecord(boundary?.bounds, expectedBounds)) {
    findings.push(`model bounds must equal ${JSON.stringify(expectedBounds)}`);
  }

  const axiom = boundary?.atomicityAxiom;
  if (axiom?.id !== 'postgres-cte-atomicity') {
    findings.push('atomicity axiom id must be postgres-cte-atomicity');
  }
  if (axiom?.classification !== 'human-assumption') {
    findings.push('Postgres atomicity classification must remain human-assumption');
  }
  if (axiom?.verified !== false) {
    findings.push('Postgres atomicity verified must remain false');
  }
  if (typeof axiom?.detail !== 'string' || !axiom.detail.includes('one atomic action')) {
    findings.push('Postgres atomicity detail must state the one-atomic-action abstraction');
  }
  if (typeof axiom?.justification !== 'string' || !axiom.justification.includes('FOR UPDATE')) {
    findings.push('Postgres atomicity justification must name FOR UPDATE');
  }

  const actions = sortedUniqueStrings(protocol?.actions, 'protocol actions', findings);
  const modeled = sortedUniqueStrings(boundary?.modeledActions, 'modeledActions', findings);
  const notModeled = sortedUniqueStrings(
    boundary?.notModeledActions,
    'notModeledActions',
    findings,
  );
  const actionSet = new Set(actions);
  const modeledSet = new Set(modeled);
  const notModeledSet = new Set(notModeled);
  for (const action of [...modeled, ...notModeled]) {
    if (!actionSet.has(action)) {
      findings.push(`${action} is not registered in the protocol alphabet`);
    }
  }
  for (const action of modeled) {
    if (notModeledSet.has(action)) {
      findings.push(`${action} is both modeled and not modeled`);
    }
  }
  const partition = [...new Set([...modeled, ...notModeled])].sort(asciiCompare);
  if (
    partition.length !== actions.length ||
    partition.some((action, index) => action !== actions[index])
  ) {
    findings.push(
      'modeledActions plus notModeledActions must be the exact protocol-action complement',
    );
  }

  if (!specText.includes(SPEC_BOUNDARY_MARKER)) {
    findings.push(`SPEC must contain ${SPEC_BOUNDARY_MARKER}`);
  }
  if (!specText.includes('Postgres-CTE atomicity axiom') || !specText.includes('FOR UPDATE')) {
    findings.push('SPEC must state the Postgres-CTE atomicity axiom and FOR UPDATE justification');
  }
  if (!/human\s+assumption/u.test(specText) || !/not (?:a )?machine-verified/u.test(specText)) {
    findings.push('SPEC must label Postgres atomicity as a human assumption, not machine-verified');
  }

  const phenomena = boundary?.notModeledPhenomena;
  if (!Array.isArray(phenomena) || phenomena.length === 0) {
    findings.push('notModeledPhenomena must be a non-empty explicit list');
  } else {
    const ids = sortedUniqueStrings(
      phenomena.map((entry) => entry?.id),
      'notModeledPhenomena ids',
      findings,
    );
    for (const entry of phenomena) {
      if (typeof entry?.detail !== 'string' || entry.detail === '') {
        findings.push(`not-modeled phenomenon ${String(entry?.id)} must have detail`);
      }
    }
    for (const id of ids) {
      if (!specText.includes(`<!-- kovo-not-modeled:${id} -->`)) {
        findings.push(`SPEC must name excluded phenomenon ${id}`);
      }
    }
  }

  // Keep this explicit read so a future refactor cannot accidentally make the overlap loop dead.
  if (modeledSet.size !== modeled.length) findings.push('modeledActions set is unstable');
  return { findings, ok: findings.length === 0 };
}

function main() {
  const protocol = JSON.parse(readFileSync(path.join(repoRoot, protocolAlphabetPath), 'utf8'));
  const boundary = JSON.parse(readFileSync(path.join(repoRoot, modelBoundaryPath), 'utf8'));
  const specText = readFileSync(path.join(repoRoot, specPath), 'utf8');
  const result = validateModelHonestyBoundary({ boundary, protocol, specText });
  if (!result.ok) {
    throw new Error(
      `Model honesty-boundary gate failed:\n${result.findings.map((finding) => `- ${finding}`).join('\n')}`,
    );
  }
  console.log(
    `Model honesty-boundary gate passed: ${boundary.modeledActions.length} modeled + ${boundary.notModeledActions.length} explicitly not-modeled actions cover ${protocol.actions.length}; ${boundary.notModeledPhenomena.length} excluded phenomena remain visible.`,
  );
}

if (isMainEntry(import.meta.url)) await runGate(main);
