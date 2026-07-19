#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parseDiagnosticSpecRegistry } from './generate-diagnostic-registry.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const repoRoot = findRepoRoot();
export const labelClauseMapPath = 'security/label-clause-map.json';
export const labelClauseMapSchema = 'kovo-label-clause-map/v1';

const expectedDimensions = Object.freeze({
  confidentiality: Object.freeze(['public', 'secret']),
  integrity: Object.freeze(['literal', 'server', 'input', 'unknown']),
  owner: Object.freeze(['public', 'principal', 'framework']),
});
const requiredClauseIds = Object.freeze(['NI-C1', 'NI-E1', 'NI-I1', 'NI-I2', 'NI-O1']);
const requiredDiagnosticCodes = Object.freeze([
  'KV410',
  'KV411',
  'KV414',
  'KV426',
  'KV435',
  'KV438',
  'KV439',
]);
const expectedSpecHeading =
  '#### Principal-indexed label lattice and bounded non-interference (normative)';
const expectedDiagnosticSentence =
  'The diagnostic clause denominator is exactly KV410, KV411, KV414, KV426, KV435, KV438, and KV439.';

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactStringArray(value, expected, label, findings) {
  if (!Array.isArray(value)) {
    findings.push(`${label} must be an array`);
    return;
  }
  if (value.length !== expected.length || value.some((entry, index) => entry !== expected[index])) {
    findings.push(`${label} must equal [${expected.join(', ')}] in normative order`);
  }
}

function validateIntegrityJoin(value, findings) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    findings.push('integrityJoin must be an object');
    return;
  }
  const kinds = expectedDimensions.integrity;
  const rank = new Map(kinds.map((kind, index) => [kind, index]));
  for (const left of kinds) {
    const row = value[left];
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      findings.push(`integrityJoin.${left} must be an object`);
      continue;
    }
    exactStringArray(
      Object.keys(row).sort(compareStrings),
      [...kinds].sort(compareStrings),
      `integrityJoin.${left} keys`,
      findings,
    );
    for (const right of kinds) {
      const expected = kinds[Math.max(rank.get(left), rank.get(right))];
      if (row[right] !== expected) {
        findings.push(`integrityJoin.${left}.${right} must be ${expected}`);
      }
    }
  }

  const join = (left, right) => value[left]?.[right];
  for (const left of kinds) {
    for (const right of kinds) {
      if (join(left, right) !== join(right, left)) {
        findings.push(`integrityJoin is not commutative for ${left}, ${right}`);
      }
      for (const third of kinds) {
        if (join(join(left, right), third) !== join(left, join(right, third))) {
          findings.push(`integrityJoin is not associative for ${left}, ${right}, ${third}`);
        }
      }
    }
  }
}

export function validateLabelClauseMap({ artifact, diagnosticRows, spec }) {
  const findings = [];
  if (artifact?.schema !== labelClauseMapSchema) {
    findings.push(`schema must be ${labelClauseMapSchema}`);
  }
  if (artifact?.specPath !== 'spec/10-data-plane.md') {
    findings.push('specPath must be spec/10-data-plane.md');
  }
  if (!spec.includes(expectedSpecHeading))
    findings.push('normative label-lattice heading is missing');
  if (!spec.includes(expectedDiagnosticSentence)) {
    findings.push('normative diagnostic denominator sentence is missing or changed');
  }

  const dimensions = artifact?.dimensions;
  if (typeof dimensions !== 'object' || dimensions === null || Array.isArray(dimensions)) {
    findings.push('dimensions must be an object');
  } else {
    exactStringArray(
      Object.keys(dimensions).sort(compareStrings),
      Object.keys(expectedDimensions).sort(compareStrings),
      'dimension keys',
      findings,
    );
    for (const [name, values] of Object.entries(expectedDimensions)) {
      exactStringArray(dimensions[name], values, `dimensions.${name}`, findings);
    }
  }
  validateIntegrityJoin(artifact?.integrityJoin, findings);

  const clauses = Array.isArray(artifact?.clauses) ? artifact.clauses : [];
  if (!Array.isArray(artifact?.clauses)) findings.push('clauses must be an array');
  const clauseIds = [];
  const clauseIdSet = new Set();
  for (const [index, clause] of clauses.entries()) {
    if (typeof clause !== 'object' || clause === null || Array.isArray(clause)) {
      findings.push(`clauses[${index}] must be an object`);
      continue;
    }
    if (typeof clause.id !== 'string' || !/^NI-[CIOE]\d+$/u.test(clause.id)) {
      findings.push(`clauses[${index}].id is invalid`);
      continue;
    }
    if (clauseIdSet.has(clause.id)) findings.push(`duplicate clause ${clause.id}`);
    clauseIdSet.add(clause.id);
    clauseIds.push(clause.id);
    if (!['confidentiality', 'integrity', 'owner', 'cross-cutting'].includes(clause.dimension)) {
      findings.push(`${clause.id} has invalid dimension ${String(clause.dimension)}`);
    }
    if (!spec.includes(`**${clause.id} —`)) {
      findings.push(`${clause.id} has no normative SPEC clause`);
    }
  }
  exactStringArray(clauseIds.sort(compareStrings), [...requiredClauseIds], 'clause IDs', findings);

  const registry = new Map(diagnosticRows.map((row) => [row.code, row]));
  const mappings = Array.isArray(artifact?.diagnostics) ? artifact.diagnostics : [];
  if (!Array.isArray(artifact?.diagnostics)) findings.push('diagnostics must be an array');
  const mappedCodes = [];
  const mappedCodeSet = new Set();
  const usedClauses = new Set();
  for (const [index, mapping] of mappings.entries()) {
    if (typeof mapping !== 'object' || mapping === null || Array.isArray(mapping)) {
      findings.push(`diagnostics[${index}] must be an object`);
      continue;
    }
    if (typeof mapping.code !== 'string' || !/^KV\d{3}$/u.test(mapping.code)) {
      findings.push(`diagnostics[${index}].code is invalid`);
      continue;
    }
    if (mappedCodeSet.has(mapping.code))
      findings.push(`duplicate diagnostic mapping ${mapping.code}`);
    mappedCodeSet.add(mapping.code);
    mappedCodes.push(mapping.code);
    const row = registry.get(mapping.code);
    if (!row) findings.push(`${mapping.code} is absent from the normative diagnostic registry`);
    else if (row.severity !== 'error' || row.enforcementClass !== 'compile-error') {
      findings.push(
        `${mapping.code} must remain error/compile-error, found ${row.severity}/${row.enforcementClass}`,
      );
    }
    if (!Array.isArray(mapping.clauses) || mapping.clauses.length === 0) {
      findings.push(`${mapping.code} must map to at least one clause`);
      continue;
    }
    const local = new Set();
    for (const clauseId of mapping.clauses) {
      if (typeof clauseId !== 'string' || !clauseIdSet.has(clauseId)) {
        findings.push(`${mapping.code} references unknown clause ${String(clauseId)}`);
      } else if (local.has(clauseId)) {
        findings.push(`${mapping.code} repeats clause ${clauseId}`);
      } else {
        local.add(clauseId);
        usedClauses.add(clauseId);
      }
    }
  }
  exactStringArray(
    mappedCodes.sort(compareStrings),
    [...requiredDiagnosticCodes],
    'diagnostic codes',
    findings,
  );
  for (const clauseId of requiredClauseIds) {
    if (!usedClauses.has(clauseId)) findings.push(`${clauseId} has no mapped diagnostic`);
  }

  return { findings, ok: findings.length === 0 };
}

export function checkLabelClauseMap({ root = repoRoot } = {}) {
  const artifact = JSON.parse(readFileSync(path.join(root, labelClauseMapPath), 'utf8'));
  const spec = readFileSync(path.join(root, artifact.specPath ?? 'spec/10-data-plane.md'), 'utf8');
  const diagnosticSpec = readFileSync(path.join(root, 'spec/11-diagnostics.md'), 'utf8');
  return validateLabelClauseMap({
    artifact,
    diagnosticRows: parseDiagnosticSpecRegistry(diagnosticSpec),
    spec,
  });
}

export function runLabelClauseMapGate() {
  const result = checkLabelClauseMap();
  process.stdout.write(
    `label-clause-map/v1 diagnostics=${requiredDiagnosticCodes.length} clauses=${requiredClauseIds.length}\n`,
  );
  if (result.ok) {
    process.stdout.write('OK\n');
    return 0;
  }
  process.stderr.write(`${result.findings.map((finding) => `- ${finding}`).join('\n')}\n`);
  return 1;
}

if (isMainEntry(import.meta.url)) await runGate(runLabelClauseMapGate);
