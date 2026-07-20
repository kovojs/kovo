#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const RUNTIME_DOOR_SCHEMA = 'kovo-runtime-door-manifest/v1';
export const PRODUCTION_MANIFEST_FILE = 'security/runtime-door-manifest.production.json';
export const DEVELOPMENT_MANIFEST_FILE = 'security/runtime-door-manifest.development.json';
export const CAPABILITY_CENSUS_FILE = 'scripts/capability-surface-census.manifest.json';
export const GATE_COMMAND =
  'node scripts/check-runtime-tier-door-parity.mjs && vitest --run scripts/check-runtime-tier-door-parity.test.mjs --reporter=dot';

const REQUIRED_DEV_ONLY_DOORS = new Map([
  ['dev.http.hmr-refresh', 'hmr-refresh'],
  ['dev.http.module-graph', 'module-graph'],
  ['dev.http.source-env', 'source-env'],
  ['dev.websocket.hmr', 'hmr-websocket'],
]);
const MAPPING_VERDICTS = new Set(['audited-exception', 'equivalent', 'stronger']);

export function checkRuntimeTierDoorParity(options = {}) {
  const root = options.repoRoot ?? findRepoRoot();
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const findings = [];
  const production = readJson(PRODUCTION_MANIFEST_FILE, readText, findings);
  const development = readJson(DEVELOPMENT_MANIFEST_FILE, readText, findings);
  const census = readJson(CAPABILITY_CENSUS_FILE, readText, findings);
  const packageJson = readJson('package.json', readText, findings);
  if (production && development && census) {
    findings.push(...evaluateRuntimeTierDoorParity({ census, development, production, readText }));
  }
  if (packageJson) validateEnrollment(packageJson, findings);
  return {
    findings,
    ok: findings.length === 0,
    summary:
      findings.length === 0
        ? `OK prod=${production?.doors?.length ?? 0} dev=${development?.doors?.length ?? 0}`
        : `FAIL findings=${findings.length}`,
  };
}

export function evaluateRuntimeTierDoorParity({ census, development, production, readText }) {
  const findings = [];
  const censusIds = capabilityCensusIds(census, findings);
  const prod = validateManifest(production, 'production', censusIds, readText, findings);
  const dev = validateManifest(development, 'development', censusIds, readText, findings);
  if (!prod || !dev) return findings;

  const coverage = new Map(prod.doors.map((door) => [door.id, new Set()]));
  for (const door of dev.doors) {
    if (door.devOnly === true) {
      if (door.prodMapping !== undefined) {
        findings.push(`${door.id}: a dev-only door must not declare prodMapping`);
      }
      validateAuthenticatedDevOnlyDoor(door, findings);
      continue;
    }
    const mapping = door.prodMapping;
    if (!plainObject(mapping)) {
      findings.push(`${door.id}: every non-dev-only door requires prodMapping`);
      continue;
    }
    const prodDoor = prod.byId.get(mapping.door);
    if (!prodDoor) {
      findings.push(`${door.id}: prodMapping references unknown production door ${mapping.door}`);
      continue;
    }
    if (!MAPPING_VERDICTS.has(mapping.verdict)) {
      findings.push(`${door.id}: prodMapping.verdict is unsupported`);
      continue;
    }
    const covered = stringArray(mapping.covers, `${door.id}.prodMapping.covers`, findings, true);
    for (const obligation of covered) {
      if (!prodDoor.obligations.includes(obligation)) {
        findings.push(`${door.id}: mapping covers unknown ${prodDoor.id} obligation ${obligation}`);
      } else if (!door.obligations.includes(obligation)) {
        findings.push(`${door.id}: mapping claims ${obligation} without a matching dev obligation`);
      } else {
        coverage.get(prodDoor.id)?.add(obligation);
      }
    }
    if (
      mapping.verdict === 'equivalent' &&
      !sameStringSet(door.obligations, prodDoor.obligations)
    ) {
      findings.push(`${door.id}: equivalent mapping must carry exactly the production obligations`);
    }
    if (
      mapping.verdict === 'stronger' &&
      door.obligations.every((obligation) => prodDoor.obligations.includes(obligation))
    ) {
      findings.push(`${door.id}: stronger mapping requires at least one additional dev obligation`);
    }
    if (mapping.verdict === 'audited-exception') {
      const exception = dev.exceptions.get(mapping.exceptionId);
      if (!exception || exception.door !== door.id || exception.productionDoor !== prodDoor.id) {
        findings.push(`${door.id}: audited-exception mapping lacks its exact named review row`);
      }
    } else if (mapping.exceptionId !== undefined) {
      findings.push(`${door.id}: only audited-exception mappings may name exceptionId`);
    }
  }

  for (const prodDoor of prod.doors) {
    const covered = coverage.get(prodDoor.id) ?? new Set();
    for (const obligation of prodDoor.obligations) {
      if (!covered.has(obligation)) {
        findings.push(`${prodDoor.id}: production obligation ${obligation} has no dev verdict`);
      }
    }
  }
  for (const [id, kind] of REQUIRED_DEV_ONLY_DOORS) {
    const door = dev.byId.get(id);
    if (!door) findings.push(`development manifest is missing required dev-only door ${id}`);
    else if (door.kind !== kind) findings.push(`${id}: kind must remain ${kind}`);
  }
  validateDevHostSourcePins(readText, findings);
  return findings;
}

function validateManifest(document, tier, censusIds, readText, findings) {
  const label = `${tier} manifest`;
  if (!plainObject(document)) {
    findings.push(`${label}: document must be an object`);
    return undefined;
  }
  if (document.schema !== RUNTIME_DOOR_SCHEMA) {
    findings.push(`${label}: schema must be ${RUNTIME_DOOR_SCHEMA}`);
  }
  if (document.tier !== tier) findings.push(`${label}: tier must be ${tier}`);
  if (
    !plainObject(document.capabilityCensus) ||
    document.capabilityCensus.file !== CAPABILITY_CENSUS_FILE ||
    document.capabilityCensus.schema !== 'kovo-capability-surface-census/v2'
  ) {
    findings.push(`${label}: capability census reference must bind the v2 canonical census`);
  }
  const exceptions = validateExceptions(document.auditedExceptions, label, findings);
  if (!Array.isArray(document.doors) || document.doors.length === 0) {
    findings.push(`${label}: doors must be a non-empty array`);
    return { byId: new Map(), doors: [], exceptions };
  }
  const byId = new Map();
  const doors = [];
  for (let index = 0; index < document.doors.length; index += 1) {
    const door = document.doors[index];
    const doorLabel = `${label}.doors[${index}]`;
    if (!plainObject(door) || !nonBlank(door.id)) {
      findings.push(`${doorLabel}: door requires a stable non-empty id`);
      continue;
    }
    if (byId.has(door.id)) findings.push(`${doorLabel}: duplicate door id ${door.id}`);
    byId.set(door.id, door);
    doors.push(door);
    for (const key of ['kind', 'owner', 'source']) {
      if (!nonBlank(door[key])) findings.push(`${door.id}: ${key} must be non-empty`);
    }
    door.obligations = stringArray(door.obligations, `${door.id}.obligations`, findings, true);
    door.exposure = stringArray(door.exposure, `${door.id}.exposure`, findings, true);
    const refs = stringArray(
      door.capabilityCensusDoorRefs,
      `${door.id}.capabilityCensusDoorRefs`,
      findings,
      false,
    );
    for (const ref of refs) {
      if (!censusIds.has(ref)) findings.push(`${door.id}: unknown capability census door ${ref}`);
    }
    validateAuthentication(door.authentication, door.id, findings);
    if (nonBlank(door.source) && nonBlank(door.owner)) {
      try {
        if (!readText(door.source).includes(door.owner)) {
          findings.push(`${door.id}: source ${door.source} does not contain owner ${door.owner}`);
        }
      } catch {
        findings.push(`${door.id}: source file is missing: ${door.source}`);
      }
    }
    if (!door.exposure.includes('loopback-only') && tier === 'development') {
      findings.push(`${door.id}: every supported dev door must remain loopback-only`);
    }
  }
  return { byId, doors, exceptions };
}

function validateAuthenticatedDevOnlyDoor(door, findings) {
  if (door.authentication?.required !== true) {
    findings.push(`${door.id}: dev-only source/HMR doors require authentication`);
  }
  if (!door.obligations.includes('boot-session-authenticated')) {
    findings.push(`${door.id}: dev-only door is missing boot-session-authenticated`);
  }
  for (const exposure of ['exact-host', 'loopback-only']) {
    if (!door.exposure.includes(exposure))
      findings.push(`${door.id}: missing ${exposure} exposure`);
  }
  const exactOrigin = door.kind === 'hmr-websocket' ? 'exact-origin' : 'origin-if-present-exact';
  if (!door.exposure.includes(exactOrigin)) {
    findings.push(`${door.id}: missing ${exactOrigin} exposure`);
  }
  if (!door.authentication?.mechanisms?.includes('vite-websocket-token-cookie')) {
    findings.push(`${door.id}: dev-only door must use the shared Vite boot-token cookie`);
  }
  if (
    door.kind === 'hmr-websocket' &&
    !door.authentication?.mechanisms?.includes('vite-websocket-token-query')
  ) {
    findings.push(`${door.id}: HMR websocket must retain Vite's independent query token`);
  }
}

function validateAuthentication(authentication, id, findings) {
  if (!plainObject(authentication) || typeof authentication.required !== 'boolean') {
    findings.push(`${id}: authentication must declare required as a boolean`);
    return;
  }
  stringArray(authentication.mechanisms, `${id}.authentication.mechanisms`, findings, false);
  if (!nonBlank(authentication.reason)) findings.push(`${id}: authentication.reason is required`);
}

function validateExceptions(value, label, findings) {
  if (!Array.isArray(value)) {
    findings.push(`${label}: auditedExceptions must be an array`);
    return new Map();
  }
  const result = new Map();
  for (let index = 0; index < value.length; index += 1) {
    const row = value[index];
    if (!plainObject(row) || !nonBlank(row.id)) {
      findings.push(`${label}.auditedExceptions[${index}]: invalid exception row`);
      continue;
    }
    if (result.has(row.id)) findings.push(`${label}: duplicate audited exception ${row.id}`);
    result.set(row.id, row);
    for (const key of ['door', 'evidence', 'owner', 'productionDoor', 'reason']) {
      if (!nonBlank(row[key])) findings.push(`${label}.${row.id}: ${key} is required`);
    }
  }
  return result;
}

function capabilityCensusIds(census, findings) {
  if (!plainObject(census) || census.schema !== 'kovo-capability-surface-census/v2') {
    findings.push('capability census must use kovo-capability-surface-census/v2');
    return new Set();
  }
  const ids = new Set();
  for (const bucket of ['mintSites', 'requestDeadlineEffectDoors', 'rows']) {
    if (!Array.isArray(census[bucket])) continue;
    for (const row of census[bucket]) if (nonBlank(row?.id)) ids.add(row.id);
  }
  return ids;
}

function validateDevHostSourcePins(readText, findings) {
  const pins = {
    'packages/cli/src/commands/dev-host-door.ts': [
      'configureKovoDevHostDoor',
      'installKovoDevHostDoor',
      "rawListeners('upgrade')",
      'Kovo-Dev-Auth',
      'timingSafeEqual',
      'SOURCE_PATH_PREFIXES',
      'server.allowedHosts',
      'server.cors = false',
    ],
    'packages/cli/src/commands/dev.ts': [
      'configureKovoDevHostDoor(server);',
      'installKovoDevHostDoor(server);',
    ],
    'packages/cli/src/index.kovo-dev.test.ts': [
      '@kovo-security-certifies C13 dev-host-http-websocket-rebinding-closed',
      'rawDevWebSocketHandshake',
    ],
  };
  for (const [file, snippets] of Object.entries(pins)) {
    let source;
    try {
      source = readText(file);
    } catch {
      findings.push(`dev-host source pin file is missing: ${file}`);
      continue;
    }
    for (const snippet of snippets) {
      if (!source.includes(snippet)) findings.push(`${file}: missing dev-host pin ${snippet}`);
    }
  }
}

function validateEnrollment(packageJson, findings) {
  if (packageJson.scripts?.['check:runtime-tier-door-parity'] !== GATE_COMMAND) {
    findings.push(
      `package.json: scripts.check:runtime-tier-door-parity must equal ${GATE_COMMAND}`,
    );
  }
  const count =
    typeof packageJson.scripts?.check === 'string'
      ? packageJson.scripts.check
          .split(' && ')
          .filter((step) => step === 'pnpm run check:runtime-tier-door-parity').length
      : 0;
  if (count !== 1) {
    findings.push('package.json: root check must enroll runtime-tier-door-parity exactly once');
  }
}

function stringArray(value, label, findings, requireNonEmpty) {
  if (!Array.isArray(value) || (requireNonEmpty && value.length === 0)) {
    findings.push(`${label} must be ${requireNonEmpty ? 'a non-empty' : 'an'} array`);
    return [];
  }
  const result = [];
  const seen = new Set();
  for (const entry of value) {
    if (!nonBlank(entry)) findings.push(`${label} must contain only non-empty strings`);
    else if (seen.has(entry)) findings.push(`${label} contains duplicate ${entry}`);
    else {
      seen.add(entry);
      result.push(entry);
    }
  }
  return result;
}

function readJson(file, readText, findings) {
  try {
    return JSON.parse(readText(file));
  } catch (error) {
    findings.push(`${file}: ${error instanceof Error ? error.message : 'invalid JSON'}`);
    return undefined;
  }
}

function sameStringSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function nonBlank(value) {
  return typeof value === 'string' && value.length > 0;
}

function plainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function main(options = {}) {
  const result = checkRuntimeTierDoorParity(options);
  process.stdout.write(`check-runtime-tier-door-parity/v1 ${result.summary}\n`);
  for (const finding of result.findings) process.stderr.write(`${finding}\n`);
  return result.ok;
}

if (isMainEntry(import.meta.url)) await runGate(main);
