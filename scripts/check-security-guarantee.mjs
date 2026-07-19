#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';
import { loadTcbManifest } from './check-tcb-boundary.mjs';
import { SECURITY_BUILD_PROOFS } from './security-test-build-gate.mjs';

export const repoRoot = findRepoRoot();
export const defaultGuaranteePath = 'SECURITY.md';
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
