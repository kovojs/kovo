#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';
import { loadTcbManifest } from './check-tcb-boundary.mjs';
import { SECURITY_BUILD_PROOFS } from './security-test-build-gate.mjs';

export const repoRoot = findRepoRoot();
export const defaultGuaranteePath = 'SECURITY.md';
export const defaultCliPackageManifestPath = 'packages/cli/package.json';
export const defaultDeploymentEnvironmentDoorPath =
  'packages/cli/src/deployment-environment-doors.v1.json';
export const defaultTcbManifestPath = 'security/TCB.md';
export const guaranteeSchema = 'kovo.security.guarantees/v1';
export const privateVulnerabilityReportUrl =
  'https://github.com/kovojs/kovo/security/advisories/new';
export const privateVulnerabilityReportContactLine = `Private contact: <${privateVulnerabilityReportUrl}>`;

const guaranteeStates = new Set(['current', 'superseded', 'withdrawn']);
const advisoryStatuses = new Set(['open', 'resolved']);

export function checkSecurityGuarantee(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const guaranteePath = options.guaranteePath ?? defaultGuaranteePath;
  const cliPackageManifestPath = options.cliPackageManifestPath ?? defaultCliPackageManifestPath;
  const deploymentEnvironmentDoorPath =
    options.deploymentEnvironmentDoorPath ?? defaultDeploymentEnvironmentDoorPath;
  const tcbManifestPath = options.tcbManifestPath ?? defaultTcbManifestPath;
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const exists = options.exists ?? ((relativePath) => existsSync(path.join(root, relativePath)));
  const proofEntries = options.proofEntries ?? SECURITY_BUILD_PROOFS;

  const findings = [];
  if (!exists(guaranteePath)) {
    findings.push(`${guaranteePath}: guarantee statement is missing`);
    return result(findings);
  }

  const guaranteeDocument = readText(guaranteePath);
  const register = loadGuaranteeRegister({ guaranteePath, text: guaranteeDocument });
  findings.push(...validateSecurityReportingSection(guaranteeDocument, guaranteePath));
  findings.push(...validateRegisterShape(register, guaranteePath));
  if (findings.length > 0) return result(findings);
  findings.push(
    ...validateDeploymentEnvironmentAntecedents({
      deploymentEnvironmentDoorPath,
      exists,
      guaranteePath,
      readText,
      register,
    }),
  );
  if (findings.length > 0) return result(findings);
  findings.push(
    ...validateGuaranteeProvenanceIdentity({
      cliPackageManifestPath,
      exists,
      readText,
      register,
    }),
  );

  const manifest = loadTcbManifest({ manifestPath: tcbManifestPath, readText });
  const tcbEntries = new Map(manifest.entries.map((entry) => [entry.id, entry]));
  const proofEntriesByClaim = new Map(
    proofEntries
      .filter((proof) => typeof proof.claimId === 'string' && proof.claimId !== '')
      .map((proof) => [proof.claimId, proof]),
  );

  const guaranteeIds = new Set();
  const guaranteesById = new Map();
  for (const guarantee of register.guarantees) {
    if (guaranteeIds.has(guarantee.id)) {
      findings.push(`${guaranteePath}: duplicate guarantee id ${guarantee.id}`);
    }
    guaranteeIds.add(guarantee.id);
    if (!guaranteesById.has(guarantee.id)) guaranteesById.set(guarantee.id, guarantee);

    if (guarantee.state !== 'current') continue;

    for (const chokeId of guarantee.tcbChokes) {
      const entry = tcbEntries.get(chokeId);
      if (!entry) {
        findings.push(`${guaranteePath}: ${guarantee.id} references unknown TCB choke ${chokeId}`);
      } else if (entry.classification !== 'tcb') {
        findings.push(
          `${guaranteePath}: ${guarantee.id} references ${chokeId}, but it is classified ${entry.classification} instead of tcb`,
        );
      }
    }

    for (const proofId of guarantee.runtimeProofs) {
      const proof = proofEntriesByClaim.get(proofId);
      if (!proof) {
        findings.push(
          `${guaranteePath}: ${guarantee.id} references unknown runtime/paranoid proof ${proofId}`,
        );
      } else if (!isParanoidRuntimeProof(proof)) {
        findings.push(
          `${guaranteePath}: ${guarantee.id} proof ${proofId} is not enrolled as a KOVO_PARANOID runtime proof`,
        );
      }
    }
  }

  const retractedByAdvisories = new Map();
  const advisoryIds = new Set();
  for (const advisory of register.advisories) {
    if (advisoryIds.has(advisory.id)) {
      findings.push(`${guaranteePath}: duplicate advisory id ${advisory.id}`);
    }
    advisoryIds.add(advisory.id);

    const retractedGuaranteeIds = new Set();
    for (const guaranteeId of advisory.retracts) {
      if (retractedGuaranteeIds.has(guaranteeId)) {
        findings.push(
          `${guaranteePath}: advisory ${advisory.id} repeats retracts target ${guaranteeId}`,
        );
        continue;
      }
      retractedGuaranteeIds.add(guaranteeId);

      const guarantee = guaranteesById.get(guaranteeId);
      if (!guarantee) {
        findings.push(
          `${guaranteePath}: advisory ${advisory.id} retracts unknown guarantee ${guaranteeId}`,
        );
        continue;
      }

      const advisoryBindings = retractedByAdvisories.get(guaranteeId) ?? [];
      advisoryBindings.push(advisory);
      retractedByAdvisories.set(guaranteeId, advisoryBindings);

      if (advisory.status === 'open' && guarantee.state === 'current') {
        findings.push(
          `${guaranteePath}: current guarantee ${guaranteeId} is retracted by open advisory ${advisory.id}`,
        );
      }
    }
  }

  for (const guarantee of register.guarantees) {
    if (guarantee.state === 'current') continue;

    if (!retractedByAdvisories.has(guarantee.id)) {
      findings.push(
        `${guaranteePath}: ${guarantee.state} guarantee ${guarantee.id} must be bound by an advisory retracts entry`,
      );
    }

    if (guarantee.state !== 'superseded') continue;
    const replacement = guaranteesById.get(guarantee.supersededBy);
    if (!replacement) {
      findings.push(
        `${guaranteePath}: superseded guarantee ${guarantee.id} references unknown replacement ${guarantee.supersededBy}`,
      );
    } else if (replacement.state !== 'current') {
      findings.push(
        `${guaranteePath}: superseded guarantee ${guarantee.id} replacement ${guarantee.supersededBy} must be current`,
      );
    }
  }

  const currentGuaranteeCount = register.guarantees.filter(
    (guarantee) => guarantee.state === 'current',
  ).length;
  return result(findings, currentGuaranteeCount);
}

/** SHA-256 over canonical UTF-8 JSON: sorted object keys, retained array order, no whitespace. */
export function securityGuaranteeRegisterCanonicalHash(register) {
  return `sha256:${createHash('sha256').update(canonicalJson(register), 'utf8').digest('hex')}`;
}

function validateGuaranteeProvenanceIdentity({
  cliPackageManifestPath,
  exists,
  readText,
  register,
}) {
  if (!exists(cliPackageManifestPath)) {
    return [`${cliPackageManifestPath}: CLI provenance manifest is missing`];
  }

  let cliManifest;
  try {
    cliManifest = JSON.parse(readText(cliPackageManifestPath));
  } catch {
    return [`${cliPackageManifestPath}: CLI provenance manifest is not valid JSON`];
  }
  const identity = cliManifest?.kovoBuildProvenance?.securityGuarantees;
  if (identity?.schema !== guaranteeSchema) {
    return [
      `${cliPackageManifestPath}: kovoBuildProvenance.securityGuarantees.schema must be ${guaranteeSchema}`,
    ];
  }
  const expectedHash = securityGuaranteeRegisterCanonicalHash(register);
  if (identity.canonicalHash !== expectedHash) {
    return [
      `${cliPackageManifestPath}: kovoBuildProvenance.securityGuarantees.canonicalHash must be ${expectedHash}`,
    ];
  }
  return [];
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort(compareStrings)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function loadGuaranteeRegister({
  guaranteePath = defaultGuaranteePath,
  readText,
  text,
} = {}) {
  const guaranteeDocument = text ?? readText(guaranteePath);
  const match = guaranteeDocument.match(/```json security-guarantees\s*\n([\s\S]*?)\n```/u);
  if (!match) {
    throw new Error(`${guaranteePath}: missing \`\`\`json security-guarantees fenced register`);
  }
  return JSON.parse(match[1]);
}

export function validateSecurityReportingSection(text, guaranteePath = defaultGuaranteePath) {
  const registerMatch = text.match(/```json security-guarantees\s*\n[\s\S]*?\n```/u);
  if (!registerMatch || registerMatch.index === undefined) return [];

  const proseAfterRegister = text.slice(registerMatch.index + registerMatch[0].length);
  const heading = '## Report a Vulnerability';
  const headingIndex = proseAfterRegister.indexOf(heading);
  if (headingIndex === -1) {
    return [`${guaranteePath}: ${heading} section must appear outside the guarantee register`];
  }

  const followingProse = proseAfterRegister.slice(headingIndex);
  const nextHeadingIndex = followingProse.indexOf('\n## ', heading.length);
  const reportingSection =
    nextHeadingIndex === -1 ? followingProse : followingProse.slice(0, nextHeadingIndex);
  if (!reportingSection.includes(privateVulnerabilityReportContactLine)) {
    return [
      `${guaranteePath}: ${heading} must retain the private contact line ${privateVulnerabilityReportContactLine}`,
    ];
  }

  return [];
}

export function isParanoidRuntimeProof(proof) {
  const haystack = JSON.stringify(proof);
  return (
    /KOVO_PARANOID/u.test(haystack) &&
    (/runtime/u.test(proof.claimId ?? '') ||
      /runtime/u.test(proof.testName ?? '') ||
      /buildParanoidProductionArtifact/u.test(haystack))
  );
}

export function main(options = {}) {
  const check = checkSecurityGuarantee(options);
  process.stdout.write(`check-security-guarantee/v1 ${check.summary}\n`);
  for (const finding of check.findings) process.stderr.write(`${finding}\n`);
  return check.ok;
}

function validateRegisterShape(register, guaranteePath) {
  const findings = [];
  if (register?.schema !== guaranteeSchema) {
    findings.push(`${guaranteePath}: schema must be ${guaranteeSchema}`);
  }
  if (!Array.isArray(register?.threatModel?.inScope) || register.threatModel.inScope.length === 0) {
    findings.push(`${guaranteePath}: threatModel.inScope must list at least one in-scope threat`);
  }
  if (
    !Array.isArray(register?.threatModel?.assumptions) ||
    register.threatModel.assumptions.length === 0
  ) {
    findings.push(`${guaranteePath}: threatModel.assumptions must list at least one assumption`);
  }
  if (!Array.isArray(register?.nonGoals) || register.nonGoals.length === 0) {
    findings.push(`${guaranteePath}: nonGoals must list at least one explicit non-goal`);
  }
  if (!Array.isArray(register?.guarantees) || register.guarantees.length === 0) {
    findings.push(`${guaranteePath}: guarantees must list at least one stated invariant`);
    return findings;
  }
  if (!Array.isArray(register?.advisories)) {
    findings.push(`${guaranteePath}: advisories must be an array (empty when none are open)`);
  }

  for (const [index, guarantee] of register.guarantees.entries()) {
    const label =
      typeof guarantee?.id === 'string' && guarantee.id !== ''
        ? guarantee.id
        : `guarantees[${index}]`;
    if (typeof guarantee?.id !== 'string' || guarantee.id === '') {
      findings.push(`${guaranteePath}: ${label}.id must be a non-empty string`);
    }
    if (typeof guarantee?.statement !== 'string' || guarantee.statement.trim() === '') {
      findings.push(`${guaranteePath}: ${label}.statement must be a non-empty string`);
    }
    if (!guaranteeStates.has(guarantee?.state)) {
      findings.push(`${guaranteePath}: ${label}.state must be current, withdrawn, or superseded`);
      continue;
    }
    if (guarantee.state === 'superseded') {
      if (typeof guarantee.supersededBy !== 'string' || guarantee.supersededBy === '') {
        findings.push(
          `${guaranteePath}: ${label}.supersededBy must name the current replacement guarantee`,
        );
      } else if (guarantee.supersededBy === guarantee.id) {
        findings.push(`${guaranteePath}: ${label}.supersededBy must not reference itself`);
      }
    }
    if (guarantee.state !== 'current') continue;
    if (!Array.isArray(guarantee?.antecedents) || guarantee.antecedents.length === 0) {
      findings.push(
        `${guaranteePath}: ${label}.antecedents must name at least one derived deployment antecedent`,
      );
    } else {
      for (const antecedent of guarantee.antecedents) {
        if (typeof antecedent !== 'string' || antecedent === '') {
          findings.push(`${guaranteePath}: ${label}.antecedents entries must be non-empty strings`);
        }
      }
    }
    if (!Array.isArray(guarantee?.tcbChokes) || guarantee.tcbChokes.length === 0) {
      findings.push(`${guaranteePath}: ${label}.tcbChokes must name at least one TCB choke`);
    } else {
      for (const chokeId of guarantee.tcbChokes) {
        if (typeof chokeId !== 'string' || chokeId === '') {
          findings.push(`${guaranteePath}: ${label}.tcbChokes entries must be non-empty strings`);
        }
      }
    }
    if (!Array.isArray(guarantee?.runtimeProofs) || guarantee.runtimeProofs.length === 0) {
      findings.push(
        `${guaranteePath}: ${label}.runtimeProofs must name at least one paranoid/runtime proof`,
      );
    } else {
      for (const proofId of guarantee.runtimeProofs) {
        if (typeof proofId !== 'string' || proofId === '') {
          findings.push(
            `${guaranteePath}: ${label}.runtimeProofs entries must be non-empty strings`,
          );
        }
      }
    }
  }

  if (Array.isArray(register?.advisories)) {
    for (const [index, advisory] of register.advisories.entries()) {
      const label =
        typeof advisory?.id === 'string' && advisory.id !== ''
          ? advisory.id
          : `advisories[${index}]`;
      if (typeof advisory?.id !== 'string' || advisory.id === '') {
        findings.push(`${guaranteePath}: ${label}.id must be a non-empty string`);
      }
      if (!advisoryStatuses.has(advisory?.status)) {
        findings.push(`${guaranteePath}: ${label}.status must be open or resolved`);
      }
      if (!Array.isArray(advisory?.retracts) || advisory.retracts.length === 0) {
        findings.push(`${guaranteePath}: ${label}.retracts must name at least one guarantee id`);
      } else {
        for (const guaranteeId of advisory.retracts) {
          if (typeof guaranteeId !== 'string' || guaranteeId === '') {
            findings.push(`${guaranteePath}: ${label}.retracts entries must be non-empty strings`);
          }
        }
      }
    }
  }
  return findings;
}

/**
 * Derive every guarantee antecedent from the framework door that consumes the environment fact.
 * SECURITY.md records the resulting relation for third-party readers, but cannot author or widen it.
 */
export function validateDeploymentEnvironmentAntecedents({
  deploymentEnvironmentDoorPath = defaultDeploymentEnvironmentDoorPath,
  exists,
  guaranteePath = defaultGuaranteePath,
  readText,
  register,
}) {
  const findings = [];
  if (!exists(deploymentEnvironmentDoorPath)) {
    return [`${deploymentEnvironmentDoorPath}: deployment environment door registry is missing`];
  }
  let document;
  try {
    document = JSON.parse(readText(deploymentEnvironmentDoorPath));
  } catch {
    return [
      `${deploymentEnvironmentDoorPath}: deployment environment door registry is invalid JSON`,
    ];
  }
  if (document?.schema !== 'kovo.deployment-environment-doors/v1') {
    findings.push(
      `${deploymentEnvironmentDoorPath}: schema must be kovo.deployment-environment-doors/v1`,
    );
  }
  if (!Array.isArray(document?.antecedents) || document.antecedents.length === 0) {
    findings.push(`${deploymentEnvironmentDoorPath}: antecedents must be a non-empty array`);
  }
  if (!Array.isArray(document?.guarantees) || document.guarantees.length === 0) {
    findings.push(`${deploymentEnvironmentDoorPath}: guarantees must be a non-empty array`);
  }
  if (!Array.isArray(document?.doors) || document.doors.length === 0) {
    findings.push(`${deploymentEnvironmentDoorPath}: doors must be a non-empty array`);
  }
  if (findings.length > 0) return findings;

  const antecedentIds = uniqueRegistryIds(
    document.antecedents,
    'antecedents',
    deploymentEnvironmentDoorPath,
    findings,
  );
  for (const antecedent of document.antecedents) {
    if (
      typeof antecedent?.obligation !== 'string' ||
      antecedent.obligation.trim() === '' ||
      !['local-config', 'partial', 'retained'].includes(antecedent?.probeability)
    ) {
      findings.push(
        `${deploymentEnvironmentDoorPath}: antecedent ${antecedent?.id ?? '-'} must name a non-empty obligation and supported probeability`,
      );
    }
  }
  const guaranteeIds = uniqueRegistryIds(
    document.guarantees,
    'guarantees',
    deploymentEnvironmentDoorPath,
    findings,
  );
  const publishedIds = document.guarantees
    .filter((guarantee) => guarantee?.kind === 'published')
    .map((guarantee) => guarantee.id)
    .sort(compareStrings);
  const currentIds = register.guarantees
    .filter((guarantee) => guarantee.state === 'current')
    .map((guarantee) => guarantee.id)
    .sort(compareStrings);
  if (JSON.stringify(publishedIds) !== JSON.stringify(currentIds)) {
    findings.push(
      `${deploymentEnvironmentDoorPath}: published guarantees must exactly match current SECURITY.md guarantees; expected ${currentIds.join(', ') || '-'}, received ${publishedIds.join(', ') || '-'}`,
    );
  }
  for (const guarantee of document.guarantees) {
    if (
      typeof guarantee?.authority !== 'string' ||
      guarantee.authority === '' ||
      (guarantee?.kind !== 'published' && guarantee?.kind !== 'normative-conditional')
    ) {
      findings.push(
        `${deploymentEnvironmentDoorPath}: guarantee ${guarantee?.id ?? '-'} must name authority and kind`,
      );
    }
  }

  const derived = new Map([...guaranteeIds].map((id) => [id, new Set()]));
  const doorIds = new Set();
  for (const [index, door] of document.doors.entries()) {
    const label = typeof door?.id === 'string' && door.id !== '' ? door.id : `doors[${index}]`;
    if (typeof door?.id !== 'string' || door.id.trim() === '') {
      findings.push(
        `${deploymentEnvironmentDoorPath}: doors[${index}].id must be a non-empty string`,
      );
    }
    if (doorIds.has(door?.id))
      findings.push(`${deploymentEnvironmentDoorPath}: duplicate door ${label}`);
    doorIds.add(door?.id);
    if (
      typeof door?.source !== 'string' ||
      door.source.trim() === '' ||
      !Array.isArray(door?.sourceNeedles) ||
      door.sourceNeedles.length === 0
    ) {
      findings.push(
        `${deploymentEnvironmentDoorPath}: ${label} must name source and sourceNeedles`,
      );
    } else if (!exists(door.source)) {
      findings.push(`${deploymentEnvironmentDoorPath}: ${label} source is missing: ${door.source}`);
    } else {
      const source = readText(door.source);
      for (const needle of door.sourceNeedles) {
        if (typeof needle !== 'string' || needle.trim() === '' || !source.includes(needle)) {
          findings.push(
            `${deploymentEnvironmentDoorPath}: ${label} source ${door.source} is missing consumer anchor ${JSON.stringify(needle)}`,
          );
        }
      }
    }
    if (!Array.isArray(door?.antecedents) || door.antecedents.length === 0) {
      findings.push(`${deploymentEnvironmentDoorPath}: ${label}.antecedents must be non-empty`);
    }
    if (!Array.isArray(door?.guarantees) || door.guarantees.length === 0) {
      findings.push(`${deploymentEnvironmentDoorPath}: ${label}.guarantees must be non-empty`);
    }
    for (const antecedent of door?.antecedents ?? []) {
      if (!antecedentIds.has(antecedent)) {
        findings.push(
          `${deploymentEnvironmentDoorPath}: ${label} references unknown antecedent ${antecedent}`,
        );
      }
    }
    const affectedGuarantees = [
      ...new Set([
        ...(door?.guarantees?.includes('*') ? publishedIds : []),
        ...(door?.guarantees ?? []).filter((guaranteeId) => guaranteeId !== '*'),
      ]),
    ];
    for (const guaranteeId of affectedGuarantees) {
      const antecedents = derived.get(guaranteeId);
      if (antecedents === undefined) {
        findings.push(
          `${deploymentEnvironmentDoorPath}: ${label} references unknown guarantee ${guaranteeId}`,
        );
        continue;
      }
      for (const antecedent of door.antecedents ?? []) antecedents.add(antecedent);
    }
  }

  for (const [guaranteeId, antecedents] of derived) {
    if (antecedents.size === 0) {
      findings.push(
        `${deploymentEnvironmentDoorPath}: guarantee ${guaranteeId} has no consuming-door antecedent`,
      );
    }
  }
  for (const guarantee of register.guarantees) {
    if (guarantee.state !== 'current') continue;
    const expected = [...(derived.get(guarantee.id) ?? [])].sort(compareStrings);
    const actual = Array.isArray(guarantee.antecedents) ? guarantee.antecedents : [];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      findings.push(
        `${guaranteePath}: ${guarantee.id}.antecedents must be derived as ${expected.join(', ') || '-'} from ${deploymentEnvironmentDoorPath}`,
      );
    }
  }
  return findings;
}

function uniqueRegistryIds(entries, field, file, findings) {
  const ids = new Set();
  for (const [index, entry] of entries.entries()) {
    if (typeof entry?.id !== 'string' || entry.id === '') {
      findings.push(`${file}: ${field}[${index}].id must be a non-empty string`);
      continue;
    }
    if (ids.has(entry.id)) findings.push(`${file}: duplicate ${field} id ${entry.id}`);
    ids.add(entry.id);
  }
  return ids;
}

function result(findings, guaranteeCount = 0) {
  return {
    findings,
    ok: findings.length === 0,
    summary:
      findings.length === 0
        ? `OK ${guaranteeCount} security guarantee(s) map to TCB chokes and paranoid/runtime proofs`
        : `${findings.length} security guarantee violation(s)`,
  };
}

if (isMainEntry(import.meta.url)) await runGate(main);
