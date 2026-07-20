#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';
import { collectSourceFiles } from './lib/source-files.mjs';

export const repoRoot = findRepoRoot();
export const responseObservationManifest = 'security/response-observation-surfaces.v1.json';
export const responseObservationAuthLifecycle = 'packages/cli/src/auth-lifecycle-boundary.json';
export const responseObservationBetterAuthInternal = 'packages/better-auth/src/internal.ts';
export const responseObservationPackageManifest = 'package.json';
export const responseObservationWorkflow = '.github/workflows/security-nightly.yml';
export const responseObservationSourceRoots = ['packages/better-auth/src', 'packages/server/src'];

const schema = 'kovo-response-observation/v1';
const markerPattern = /@kovo-response-observation-candidate\s+([a-z0-9]+(?:[.-][a-z0-9]+)+)/gu;
const futureDoorMarkerPattern =
  /@kovo-response-observation-future-door\s+([a-z0-9]+(?:[.-][a-z0-9]+)+)/gu;
const expectedBetterAuthDoors = new Map([
  [
    'better-auth.request-password-reset',
    {
      normalizer: 'normalizeBetterAuthPasswordResetResponse',
      upstreamApi: 'requestPasswordReset',
    },
  ],
  [
    'better-auth.sign-up-email',
    { normalizer: 'normalizeBetterAuthAccountOperation', upstreamApi: 'signUpEmail' },
  ],
]);
const expectedPairs = new Map([
  ['account-creation', 'account-present:account-absent'],
  ['account-recovery', 'account-present:account-absent'],
  ['resource-concealment', 'exists-not-owned:absent'],
  ['unexpected-failure', 'unexpected-cause-a:unexpected-cause-b'],
]);

export function checkResponseObservation(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const sourceFiles =
    options.sourceFiles ??
    collectSourceFiles(root, responseObservationSourceRoots, {
      productionRoots: responseObservationSourceRoots,
    });
  const manifest = options.manifest ?? JSON.parse(readText(responseObservationManifest));
  const findings = [];
  const candidates = collectCandidates(sourceFiles, readText, findings);
  const futureDoorMarkers = collectFutureDoorMarkers(sourceFiles, readText, findings);

  if (!isRecord(manifest) || manifest.schema !== schema) {
    findings.push(`${responseObservationManifest}: expected schema ${schema}`);
    return verdict(findings);
  }

  const budgets = validateBudgets(manifest.timingBudgets, findings);
  const remoteBetterAuthDoors = validateBetterAuthLifecycle(readText, findings);
  const futureDoors = validateFutureDoors(
    manifest.futureDoors,
    futureDoorMarkers,
    remoteBetterAuthDoors,
    readText,
    findings,
  );
  const policies = validatePolicies(manifest.surfaces, budgets, findings);
  validateNightlyEnrollment(readText, findings);

  for (const [id, source] of candidates) {
    const policy = policies.get(id);
    if (policy === undefined) {
      findings.push(`${source}: unclassified remotely reachable surface ${id}`);
      continue;
    }
    if (policy.source !== source) {
      findings.push(`${id}: manifest source ${String(policy.source)} does not match ${source}`);
    }
  }
  for (const [id] of policies) {
    if (!candidates.has(id)) {
      findings.push(`${responseObservationManifest}: policy ${id} has no production candidate`);
    }
  }
  for (const id of remoteBetterAuthDoors) {
    if (!candidates.has(id)) {
      findings.push(`${id}: remotely reachable Better Auth lifecycle needs a candidate marker`);
    }
    if (!policies.has(id)) {
      findings.push(`${id}: remotely reachable Better Auth lifecycle needs a surface policy`);
    }
  }
  for (const [id] of expectedBetterAuthDoors) {
    if (!remoteBetterAuthDoors.has(id) && candidates.has(id)) {
      findings.push(
        `${id}: candidate marker claims reachability absent from the lifecycle boundary`,
      );
    }
    if (!remoteBetterAuthDoors.has(id) && !futureDoors.has(id)) {
      findings.push(`${id}: unreachable lifecycle needs a closed future door`);
    }
  }

  return verdict(findings, candidates.size);
}

function validateBetterAuthLifecycle(readText, findings) {
  const remote = new Set();
  let lifecycle;
  try {
    lifecycle = JSON.parse(readText(responseObservationAuthLifecycle));
  } catch {
    findings.push(`${responseObservationAuthLifecycle}: must be valid JSON`);
    return remote;
  }
  if (
    !isRecord(lifecycle) ||
    lifecycle.schema !== 'kovo-auth-lifecycle-boundary/v1' ||
    !Array.isArray(lifecycle.kovoOwnedTransitions)
  ) {
    findings.push(`${responseObservationAuthLifecycle}: invalid lifecycle boundary`);
    return remote;
  }
  if (
    !Array.isArray(lifecycle.structurallyUnreachable) ||
    !lifecycle.structurallyUnreachable.some(
      (entry) => isRecord(entry) && entry.id === 'unsafe-method-provider-lifecycle',
    )
  ) {
    findings.push(
      `${responseObservationAuthLifecycle}: missing unsafe-method structural-unreachability proof`,
    );
  }
  for (const [id, expected] of expectedBetterAuthDoors) {
    if (
      lifecycle.kovoOwnedTransitions.some(
        (transition) =>
          isRecord(transition) &&
          transition.upstreamApi === expected.upstreamApi &&
          transition.devOnly !== true,
      )
    ) {
      remote.add(id);
    }
  }
  return remote;
}

function validateFutureDoors(value, markers, remoteDoors, readText, findings) {
  const doors = new Map();
  if (!Array.isArray(value)) {
    findings.push(`${responseObservationManifest}: futureDoors must be an array`);
    return doors;
  }
  const internalSource = readText(responseObservationBetterAuthInternal);
  for (const door of value) {
    if (!isRecord(door) || typeof door.id !== 'string' || door.id === '') {
      findings.push(`${responseObservationManifest}: future response door needs a stable id`);
      continue;
    }
    if (doors.has(door.id)) findings.push(`duplicate future response door ${door.id}`);
    doors.set(door.id, door);
    const expected = expectedBetterAuthDoors.get(door.id);
    if (
      expected === undefined ||
      door.normalizer !== expected.normalizer ||
      door.upstreamApi !== expected.upstreamApi ||
      door.reachability !== 'structurally-unreachable' ||
      typeof door.source !== 'string' ||
      markers.get(door.id) !== door.source
    ) {
      findings.push(`${door.id}: future response door contract is incomplete or drifted`);
      continue;
    }
    const source = readText(door.source);
    if (
      !source.includes(`export async function ${door.normalizer}`) ||
      !internalSource.includes(door.normalizer)
    ) {
      findings.push(
        `${door.id}: future response normalizer is not shipped through the internal boundary`,
      );
    }
    if (remoteDoors.has(door.id)) {
      findings.push(`${door.id}: remotely reachable lifecycle cannot remain a future door`);
    }
  }
  for (const [id, source] of markers) {
    if (!doors.has(id)) findings.push(`${source}: future response door ${id} has no manifest row`);
  }
  for (const [id] of expectedBetterAuthDoors) {
    if (!remoteDoors.has(id) && !doors.has(id)) {
      findings.push(`${responseObservationManifest}: missing closed future door ${id}`);
    }
  }
  return doors;
}

function validateNightlyEnrollment(readText, findings) {
  const packageJson = JSON.parse(readText(responseObservationPackageManifest));
  if (
    packageJson.scripts?.['test:response-indistinguishability-nightly'] !==
    'KOVO_RESPONSE_TIMING_ORACLE=1 vitest --run security/response-indistinguishability.nightly.test.ts --reporter=dot'
  ) {
    findings.push(
      `${responseObservationPackageManifest}: nightly timing script is missing or drifted`,
    );
  }
  const workflow = readText(responseObservationWorkflow);
  if (!workflow.includes('run: vp exec pnpm run test:response-indistinguishability-nightly')) {
    findings.push(
      `${responseObservationWorkflow}: nightly timing oracle is not enrolled through vp`,
    );
  }
  if (!workflow.includes('path: .kovo/security-failures/**')) {
    findings.push(`${responseObservationWorkflow}: counterexample artifact upload is missing`);
  }
}

function collectCandidates(sourceFiles, readText, findings) {
  const candidates = new Map();
  for (const source of sourceFiles) {
    const text = readText(source);
    markerPattern.lastIndex = 0;
    for (const match of text.matchAll(markerPattern)) {
      const id = match[1];
      if (candidates.has(id)) {
        findings.push(`${source}: duplicate response-observation candidate ${id}`);
      } else {
        candidates.set(id, source);
      }
    }
  }
  return candidates;
}

function collectFutureDoorMarkers(sourceFiles, readText, findings) {
  const doors = new Map();
  for (const source of sourceFiles) {
    const text = readText(source);
    futureDoorMarkerPattern.lastIndex = 0;
    for (const match of text.matchAll(futureDoorMarkerPattern)) {
      const id = match[1];
      if (doors.has(id)) {
        findings.push(`${source}: duplicate response-observation future door ${id}`);
      } else {
        doors.set(id, source);
      }
    }
  }
  return doors;
}

function validateBudgets(value, findings) {
  const budgets = new Set();
  if (!Array.isArray(value) || value.length === 0) {
    findings.push(`${responseObservationManifest}: timingBudgets must be a non-empty array`);
    return budgets;
  }
  for (const budget of value) {
    if (!isRecord(budget) || typeof budget.id !== 'string' || budget.id === '') {
      findings.push(`${responseObservationManifest}: timing budget needs a stable id`);
      continue;
    }
    if (budgets.has(budget.id)) findings.push(`duplicate timing budget ${budget.id}`);
    budgets.add(budget.id);
    if (budget.noiseModel !== 'paired-alternating-median-mad') {
      findings.push(`${budget.id}: unsupported timing noise model`);
    }
    for (const key of ['sampleSize', 'warmupSamples']) {
      if (!Number.isSafeInteger(budget[key]) || budget[key] < (key === 'sampleSize' ? 16 : 0)) {
        findings.push(`${budget.id}: ${key} is outside the reviewed finite range`);
      }
    }
    for (const key of ['absoluteEffectThresholdMs', 'madMultiplier', 'relativeEffectThreshold']) {
      if (typeof budget[key] !== 'number' || !Number.isFinite(budget[key]) || budget[key] <= 0) {
        findings.push(`${budget.id}: ${key} must be finite and positive`);
      }
    }
    if (
      typeof budget.counterexampleDirectory !== 'string' ||
      !budget.counterexampleDirectory.startsWith('.kovo/security-failures/')
    ) {
      findings.push(
        `${budget.id}: counterexampleDirectory must stay under .kovo/security-failures`,
      );
    }
  }
  return budgets;
}

function validatePolicies(value, budgets, findings) {
  const policies = new Map();
  if (!Array.isArray(value) || value.length === 0) {
    findings.push(`${responseObservationManifest}: surfaces must be a non-empty array`);
    return policies;
  }
  for (const policy of value) {
    if (!isRecord(policy) || typeof policy.id !== 'string' || policy.id === '') {
      findings.push(`${responseObservationManifest}: response policy needs a stable id`);
      continue;
    }
    if (policies.has(policy.id)) findings.push(`duplicate response policy ${policy.id}`);
    policies.set(policy.id, policy);
    const expectedPair = expectedPairs.get(policy.class);
    const actualPair = Array.isArray(policy.worlds) ? policy.worlds.join(':') : '';
    if (expectedPair === undefined || actualPair !== expectedPair) {
      findings.push(`${policy.id}: class/world pair is not canonical`);
    }
    const tuple = policy.tuple;
    if (!isRecord(tuple)) {
      findings.push(`${policy.id}: missing attacker observation tuple`);
      continue;
    }
    if (
      tuple.status !== 'equal' ||
      tuple.redirect !== 'equal' ||
      tuple.connection !== 'complete' ||
      !['none', 'shape-equal'].includes(tuple.cookiesAndTokens) ||
      !['equal-content-and-length', 'generic-accepted-equal-length'].includes(tuple.body) ||
      !Array.isArray(tuple.headers) ||
      tuple.headers.some((header) => typeof header !== 'string') ||
      typeof tuple.workFactor !== 'string' ||
      tuple.workFactor === '' ||
      !budgets.has(tuple.timingBudget)
    ) {
      findings.push(`${policy.id}: attacker observation tuple is incomplete or unversioned`);
    }
  }
  return policies;
}

function verdict(findings, surfaces = 0) {
  return {
    findings,
    ok: findings.length === 0,
    summary:
      findings.length === 0
        ? `OK ${surfaces} remotely reachable response-observation surfaces classified`
        : `${findings.length} response-observation violation(s)`,
  };
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function main() {
  const result = checkResponseObservation();
  process.stdout.write(`check-response-observation/v1 ${result.summary}\n`);
  for (const finding of result.findings) process.stderr.write(`${finding}\n`);
  return result.ok;
}

if (isMainEntry(import.meta.url)) {
  await runGate(main);
}
