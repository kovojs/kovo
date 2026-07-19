#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const SECURITY_DENOMINATOR_INVENTORIES_SCHEMA = 'kovo-security-denominator-inventories/v1';
export const SECURITY_DERIVATION_INVENTORY_SCHEMA = 'kovo-security-derivation-inventory/v1';
export const SECURITY_REWITNESS_INVENTORY_SCHEMA = 'kovo-security-rewitness-inventory/v1';
export const DEFAULT_SECURITY_DENOMINATOR_INVENTORY_FILE =
  'security/security-derivation-rewitness-inventory.json';

const REVIEWED_RAISE_MARKER = 'SECURITY-REVIEWED-RAISE';
const DERIVATION_STATUSES = new Set(['checked-intent', 'derived', 'reviewed-exempt', 'uncovered']);
const REWITNESS_STATUSES = new Set(['reviewed-exempt', 'rewitnessed', 'uncovered']);

// These IDs are the frozen denominator. Adding an obligation requires adding it here and in the
// inventory; removing one is forbidden. An obligation that ceases to apply remains present as a
// reviewed exemption with explicit mutation evidence (plan 2 Phase 0 / Phase 5 D and W).
export const FROZEN_DERIVATION_OBLIGATION_IDS = Object.freeze([
  'D.browser-posture',
  'D.capability-mint-census',
  'D.config-secret-classification',
  'D.decision-surface-coverage',
  'D.public-cache-posture',
  'D.stateful-key-scoping',
  'D.tcb-membership',
  'D.wire-grammar',
]);

export const FROZEN_REWITNESS_OBLIGATION_IDS = Object.freeze([
  'W.async-context-lifecycle',
  'W.config-secret-runtime-box',
  'W.database-posture-lease',
  'W.deployed-posture-attestation',
  'W.dev-host-tier',
  'W.egress-destination-resolution',
  'W.principal-revocation-epoch',
  'W.request-deadline-occupancy',
  'W.scoped-key-sink-witness',
]);

export function loadSecurityDenominatorInventories(options = {}) {
  const root = options.repoRoot ?? findRepoRoot();
  const relativePath = options.inventoryFile ?? DEFAULT_SECURITY_DENOMINATOR_INVENTORY_FILE;
  const readText = options.readText ?? ((file) => readFileSync(path.join(root, file), 'utf8'));
  let document;
  try {
    document = JSON.parse(readText(relativePath));
  } catch (error) {
    return inventoryResult(
      [`${relativePath}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`],
      emptySummary(),
    );
  }
  return validateSecurityDenominatorInventories(document, { label: relativePath });
}

export function validateSecurityDenominatorInventories(document, options = {}) {
  const label = options.label ?? DEFAULT_SECURITY_DENOMINATOR_INVENTORY_FILE;
  const findings = [];
  if (!plainObject(document)) {
    return inventoryResult([`${label}: document must be an object`], emptySummary());
  }
  if (document.schema !== SECURITY_DENOMINATOR_INVENTORIES_SCHEMA) {
    findings.push(`${label}: schema must be ${SECURITY_DENOMINATOR_INVENTORIES_SCHEMA}`);
  }
  if (document.version !== 1) findings.push(`${label}: version must be 1`);
  validateDenominatorPolicy(document.denominatorPolicy, label, findings);

  const derivation = validateSection({
    findings,
    frozenIds: FROZEN_DERIVATION_OBLIGATION_IDS,
    kind: 'derivation',
    label: `${label}: derivation`,
    schema: SECURITY_DERIVATION_INVENTORY_SCHEMA,
    section: document.derivation,
    statuses: DERIVATION_STATUSES,
  });
  const rewitness = validateSection({
    findings,
    frozenIds: FROZEN_REWITNESS_OBLIGATION_IDS,
    kind: 'rewitness',
    label: `${label}: rewitness`,
    schema: SECURITY_REWITNESS_INVENTORY_SCHEMA,
    section: document.rewitness,
    statuses: REWITNESS_STATUSES,
  });

  return inventoryResult(findings, { derivation, rewitness });
}

export function runSecurityDenominatorInventoryCheck(options = {}) {
  const result = loadSecurityDenominatorInventories(options);
  if (!result.ok) {
    process.stderr.write(
      `security-denominator-inventories/v1 FAIL findings=${result.findings.length}\n${result.findings
        .map((finding) => `- ${finding}`)
        .join('\n')}\n`,
    );
    return 1;
  }
  const { derivation, rewitness } = result.summary;
  process.stdout.write(
    `security-denominator-inventories/v1 D=${derivation.total - derivation.uncovered}/${derivation.total} uncovered=${derivation.uncovered} W=${rewitness.total - rewitness.uncovered}/${rewitness.total} uncovered=${rewitness.uncovered} OK\n`,
  );
  return 0;
}

function validateSection({ findings, frozenIds, kind, label, schema, section, statuses }) {
  if (!plainObject(section)) {
    findings.push(`${label} must be an object`);
    return kind === 'derivation' ? emptyDerivationSummary() : emptyRewitnessSummary();
  }
  if (section.schema !== schema) findings.push(`${label}.schema must be ${schema}`);
  if (!Array.isArray(section.rows)) {
    findings.push(`${label}.rows must be an array`);
    return kind === 'derivation' ? emptyDerivationSummary() : emptyRewitnessSummary();
  }

  const rows = section.rows;
  const ids = [];
  const seen = new Set();
  for (let index = 0; index < rows.length; index += 1) {
    const rowLabel = `${label}.rows[${index}]`;
    const row = rows[index];
    if (!plainObject(row)) {
      findings.push(`${rowLabel} must be an object`);
      continue;
    }
    if (typeof row.id !== 'string' || row.id.length === 0) {
      findings.push(`${rowLabel}.id must be a non-empty string`);
    } else {
      ids.push(row.id);
      if (seen.has(row.id)) findings.push(`${rowLabel}: duplicate stable ID ${row.id}`);
      seen.add(row.id);
    }
    validateCommonRow(row, rowLabel, statuses, findings);
    if (kind === 'derivation') validateDerivationRow(row, rowLabel, findings);
    else validateRewitnessRow(row, rowLabel, findings);
  }

  const sortedIds = [...ids].sort(compareText);
  if (!arraysEqual(ids, sortedIds)) findings.push(`${label}.rows must be sorted by stable ID`);
  if (!arraysEqual(ids, frozenIds)) {
    for (const id of frozenIds) {
      if (!seen.has(id)) findings.push(`${label}: missing frozen stable ID ${id}`);
    }
    for (const id of seen) {
      if (!frozenIds.includes(id)) {
        findings.push(`${label}: ${id} is not enrolled in the frozen stable-ID denominator`);
      }
    }
  }

  return summarizeRows(rows, kind);
}

function validateCommonRow(row, label, statuses, findings) {
  requireNonEmptyString(row.owner, `${label}.owner`, findings);
  requireStringArray(row.authoritativeSource, `${label}.authoritativeSource`, findings, true);
  if (row.applicability !== 'applicable' && row.applicability !== 'inapplicable') {
    findings.push(`${label}.applicability must be applicable or inapplicable`);
  }
  if (!statuses.has(row.status)) {
    findings.push(`${label}.status is unsupported`);
  }

  if (row.status === 'reviewed-exempt' || row.applicability === 'inapplicable') {
    if (row.status !== 'reviewed-exempt') {
      findings.push(`${label}: inapplicable obligations must remain as reviewed-exempt rows`);
    }
    validateReviewedExemption(row.reviewedExemption, `${label}.reviewedExemption`, findings);
  } else if (row.reviewedExemption !== null) {
    findings.push(`${label}.reviewedExemption must be null outside reviewed-exempt posture`);
  }
}

function validateDerivationRow(row, label, findings) {
  requireStringArray(row.proof, `${label}.proof`, findings, false);
  validateNullableGap(row.gap, `${label}.gap`, findings);
  if (row.status === 'derived' || row.status === 'checked-intent') {
    if (!Array.isArray(row.proof) || row.proof.length === 0) {
      findings.push(`${label}: ${row.status} obligations require proof evidence`);
    }
    if (row.gap !== null) findings.push(`${label}: ${row.status} obligations must have gap=null`);
  }
  if (row.status === 'uncovered') {
    if (Array.isArray(row.proof) && row.proof.length !== 0) {
      findings.push(`${label}: uncovered obligations must not claim proof evidence`);
    }
    if (typeof row.gap !== 'string' || row.gap.length === 0) {
      findings.push(`${label}: uncovered obligations require a concrete gap`);
    }
  }
}

function validateRewitnessRow(row, label, findings) {
  requireNonEmptyString(row.renewalTrigger, `${label}.renewalTrigger`, findings);
  requireNonEmptyString(row.ttl, `${label}.ttl`, findings);
  requireNonEmptyString(row.failurePosture, `${label}.failurePosture`, findings);
  requireNonEmptyString(row.costBudget, `${label}.costBudget`, findings);
  requireStringArray(row.evidence, `${label}.evidence`, findings, false);
  validateNullableGap(row.gap, `${label}.gap`, findings);
  if (row.status === 'rewitnessed') {
    if (!Array.isArray(row.evidence) || row.evidence.length === 0) {
      findings.push(`${label}: rewitnessed obligations require current evidence`);
    }
    if (row.gap !== null) findings.push(`${label}: rewitnessed obligations must have gap=null`);
  }
  if (row.status === 'uncovered') {
    if (Array.isArray(row.evidence) && row.evidence.length !== 0) {
      findings.push(`${label}: uncovered obligations must not claim re-witness evidence`);
    }
    if (typeof row.gap !== 'string' || row.gap.length === 0) {
      findings.push(`${label}: uncovered obligations require a concrete gap`);
    }
  }
}

function validateReviewedExemption(exemption, label, findings) {
  if (!plainObject(exemption)) {
    findings.push(`${label} must record the reviewed raise and killing mutation`);
    return;
  }
  if (exemption.marker !== REVIEWED_RAISE_MARKER) {
    findings.push(`${label}.marker must be ${REVIEWED_RAISE_MARKER}`);
  }
  requireNonEmptyString(exemption.owner, `${label}.owner`, findings);
  requireNonEmptyString(exemption.reason, `${label}.reason`, findings);
  requireStringArray(exemption.mutationEvidence, `${label}.mutationEvidence`, findings, true);
}

function validateDenominatorPolicy(policy, label, findings) {
  if (!plainObject(policy)) {
    findings.push(`${label}.denominatorPolicy must be an object`);
    return;
  }
  if (policy.stableIdsNeverRemoved !== true) {
    findings.push(`${label}.denominatorPolicy.stableIdsNeverRemoved must be true`);
  }
  if (policy.inapplicableRequiresReviewedMarkerAndMutation !== true) {
    findings.push(
      `${label}.denominatorPolicy.inapplicableRequiresReviewedMarkerAndMutation must be true`,
    );
  }
}

function summarizeRows(rows, kind) {
  if (kind === 'derivation') {
    const summary = emptyDerivationSummary();
    summary.total = rows.length;
    for (const row of rows) {
      if (row?.status === 'checked-intent') summary.checkedIntent += 1;
      else if (row?.status === 'derived') summary.derived += 1;
      else if (row?.status === 'reviewed-exempt') summary.reviewedExempt += 1;
      else if (row?.status === 'uncovered') summary.uncovered += 1;
    }
    return summary;
  }
  const summary = emptyRewitnessSummary();
  summary.total = rows.length;
  for (const row of rows) {
    if (row?.status === 'rewitnessed') summary.rewitnessed += 1;
    else if (row?.status === 'reviewed-exempt') summary.reviewedExempt += 1;
    else if (row?.status === 'uncovered') summary.uncovered += 1;
  }
  return summary;
}

function emptySummary() {
  return { derivation: emptyDerivationSummary(), rewitness: emptyRewitnessSummary() };
}

function emptyDerivationSummary() {
  return { checkedIntent: 0, derived: 0, reviewedExempt: 0, total: 0, uncovered: 0 };
}

function emptyRewitnessSummary() {
  return { reviewedExempt: 0, rewitnessed: 0, total: 0, uncovered: 0 };
}

function inventoryResult(findings, summary) {
  return { findings, ok: findings.length === 0, summary };
}

function requireNonEmptyString(value, label, findings) {
  if (typeof value !== 'string' || value.length === 0) findings.push(`${label} must be non-empty`);
}

function requireStringArray(value, label, findings, requireNonEmpty) {
  if (!Array.isArray(value)) {
    findings.push(`${label} must be an array`);
    return;
  }
  if (requireNonEmpty && value.length === 0) findings.push(`${label} must not be empty`);
  if (value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    findings.push(`${label} must contain only non-empty strings`);
  }
  if (new Set(value).size !== value.length) findings.push(`${label} must not contain duplicates`);
}

function validateNullableGap(value, label, findings) {
  if (value !== null && (typeof value !== 'string' || value.length === 0)) {
    findings.push(`${label} must be null or a non-empty string`);
  }
}

function plainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

if (isMainEntry(import.meta.url)) {
  await runGate(() => runSecurityDenominatorInventoryCheck());
}
