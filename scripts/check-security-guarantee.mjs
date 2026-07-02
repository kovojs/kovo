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

  const register = loadGuaranteeRegister({ guaranteePath, readText });
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
  for (const guarantee of register.guarantees) {
    if (guaranteeIds.has(guarantee.id)) {
      findings.push(`${guaranteePath}: duplicate guarantee id ${guarantee.id}`);
    }
    guaranteeIds.add(guarantee.id);

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

  return result(findings, register.guarantees.length);
}

export function loadGuaranteeRegister({ guaranteePath = defaultGuaranteePath, readText } = {}) {
  const text = readText(guaranteePath);
  const match = text.match(/```json security-guarantees\s*\n([\s\S]*?)\n```/u);
  if (!match) {
    throw new Error(`${guaranteePath}: missing \`\`\`json security-guarantees fenced register`);
  }
  return JSON.parse(match[1]);
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
