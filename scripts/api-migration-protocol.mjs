#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot as defaultRepoRoot } from './public-packages.mjs';

export const API_MIGRATION_LEDGER_SCHEMA = 'kovo-api-migration-ledger/v1';
export const API_MIGRATION_RESULT_SCHEMA = 'kovo-api-migration-result/v1';
export const API_MIGRATION_REFUSAL_CATEGORIES = Object.freeze([
  'ambiguous-binding',
  'app-context',
  'auth-posture',
  'csrf-posture',
  'deployment-posture',
  'dynamic-import',
  'sql-semantics',
  'trust-decision',
]);

const BATCH_STATES = new Set(['preparing', 'ready', 'removed']);
const RULE_ACTIONS = new Set(['rewrite', 'refuse']);
const RESULT_FILE_STATES = new Set(['refused', 'rewritten', 'unchanged']);
const OWNER_PATTERN = /^[a-z0-9]+(?:[-/][a-z0-9]+)*$/u;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function canonicalRepoPath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !value.includes('\\') &&
    path.posix.normalize(value) === value &&
    value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  );
}

function validateFile(findings, repoRoot, label, value) {
  if (!canonicalRepoPath(value)) {
    findings.push(`${label} must be a canonical repository-relative path`);
  } else if (!existsSync(path.join(repoRoot, value))) {
    findings.push(`${label} does not exist: ${value}`);
  }
}

function validateEndpoint(findings, label, value) {
  if (
    !isRecord(value) ||
    typeof value.specifier !== 'string' ||
    !value.specifier.startsWith('@kovojs/')
  ) {
    findings.push(`${label}.specifier must name an @kovojs public home`);
    return;
  }
  if (
    value.symbol !== undefined &&
    (typeof value.symbol !== 'string' || value.symbol.length === 0)
  ) {
    findings.push(`${label}.symbol must be a non-empty export name when present`);
  }
}

function ruleCoversDecision(rule, decision) {
  if (rule.from?.specifier !== decision.specifier) return false;
  if (typeof decision.symbol === 'string') return rule.from.symbol === decision.symbol;
  return rule.from.symbol === undefined;
}

/**
 * Validate a migration ledger and bind every removed public decision to an exercised batch.
 * The validator is intentionally declarative: migration tools own mechanics, while this gate owns
 * the required check/write protocol, refusal taxonomy, fixtures, and removal ordering.
 */
export function validateApiMigrationLedger({ ledger, decisions, repoRoot = defaultRepoRoot }) {
  const findings = [];
  if (!isRecord(ledger) || ledger.schema !== API_MIGRATION_LEDGER_SCHEMA) {
    return { findings: [`api-migrations.json: schema must be ${API_MIGRATION_LEDGER_SCHEMA}`] };
  }
  if (ledger.resultSchema !== API_MIGRATION_RESULT_SCHEMA) {
    findings.push(`resultSchema must be ${API_MIGRATION_RESULT_SCHEMA}`);
  }
  if (JSON.stringify(ledger.modes) !== JSON.stringify(['check', 'write'])) {
    findings.push('modes must be exactly ["check", "write"]');
  }
  if (
    JSON.stringify(ledger.refusalCategories) !== JSON.stringify(API_MIGRATION_REFUSAL_CATEGORIES)
  ) {
    findings.push('refusalCategories must equal the reviewed fail-closed taxonomy');
  }
  const decisionRows = new Map(
    [...(decisions.symbols ?? []), ...(decisions.subpaths ?? [])]
      .filter(isRecord)
      .map((row) => [row.id ?? row.specifier, row]),
  );
  const batches = Array.isArray(ledger.batches) ? ledger.batches : [];
  const batchById = new Map();
  const assignedBatches = new Map();
  const cumulativeTool = ledger.cumulativeTool;

  if (!isRecord(cumulativeTool)) {
    findings.push('cumulativeTool must define the installed api-v1 migration command');
  } else {
    if (
      cumulativeTool.batch !== 'api-v1' ||
      cumulativeTool.command !== 'kovo fix api-v1' ||
      cumulativeTool.resultSchema !== API_MIGRATION_RESULT_SCHEMA ||
      JSON.stringify(cumulativeTool.checkArgs) !== JSON.stringify(['--check']) ||
      JSON.stringify(cumulativeTool.writeArgs) !== JSON.stringify(['--write']) ||
      JSON.stringify(cumulativeTool.packedArgs) !== JSON.stringify(['--api-v1-only'])
    ) {
      findings.push(
        'cumulativeTool must expose kovo fix api-v1 with exact --check/--write result protocol',
      );
    }
    validateFile(findings, repoRoot, 'cumulativeTool.path', cumulativeTool.path);
    validateFile(findings, repoRoot, 'cumulativeTool.releaseNote', cumulativeTool.releaseNote);
    validateFile(findings, repoRoot, 'cumulativeTool.packedGate', cumulativeTool.packedGate);
    const removedBatchIds = batches
      .filter((batch) => isRecord(batch) && batch.state === 'removed')
      .map((batch) => batch.id);
    if (JSON.stringify(cumulativeTool.batches) !== JSON.stringify(removedBatchIds)) {
      findings.push(
        'cumulativeTool.batches must equal every removed batch in checked-ledger order',
      );
    }
  }

  for (const [batchIndex, batch] of batches.entries()) {
    const label = `batches[${batchIndex}]`;
    if (!isRecord(batch)) {
      findings.push(`${label} must be an object`);
      continue;
    }
    if (
      typeof batch.id !== 'string' ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(batch.id) ||
      batchById.has(batch.id)
    ) {
      findings.push(`${label}.id must be a unique kebab-case identifier`);
    }
    batchById.set(batch.id, batch);
    if (!BATCH_STATES.has(batch.state)) findings.push(`${label}.state is invalid`);
    if (typeof batch.owner !== 'string' || !OWNER_PATTERN.test(batch.owner)) {
      findings.push(`${label}.owner must be a stable team/area identifier`);
    }
    if (!Array.isArray(batch.decisions) || batch.decisions.length === 0) {
      findings.push(`${label}.decisions must name the affected decision rows`);
    } else {
      if (JSON.stringify(batch.decisions) !== JSON.stringify(sortedUnique(batch.decisions))) {
        findings.push(`${label}.decisions must be sorted and unique`);
      }
      for (const id of batch.decisions) {
        const decision = decisionRows.get(id);
        if (!decision) findings.push(`${label}.decisions names unknown row ${id}`);
        else if (decision.decision === 'keep') {
          findings.push(`${label}.decisions cannot migrate keep row ${id}`);
        }
        const previous = assignedBatches.get(id);
        if (previous) {
          findings.push(`${label}.decisions duplicates ${id} from batch ${previous}`);
        } else {
          assignedBatches.set(id, batch.id);
        }
      }
    }
    if (!isRecord(batch.tool)) {
      findings.push(`${label}.tool must define one migration executable`);
    } else {
      validateFile(findings, repoRoot, `${label}.tool.path`, batch.tool.path);
      if (batch.tool.resultSchema !== API_MIGRATION_RESULT_SCHEMA) {
        findings.push(`${label}.tool.resultSchema is invalid`);
      }
      if (
        JSON.stringify(batch.tool.checkArgs) !== JSON.stringify(['--check']) ||
        JSON.stringify(batch.tool.writeArgs) !== JSON.stringify(['--write'])
      ) {
        findings.push(`${label}.tool must expose exact --check and --write modes`);
      }
    }
    validateFile(findings, repoRoot, `${label}.releaseNote`, batch.releaseNote);
    if (typeof batch.rollback !== 'string' || batch.rollback.trim().length < 30) {
      findings.push(`${label}.rollback must give concrete clean-worktree rollback instructions`);
    }

    const rules = Array.isArray(batch.rules) ? batch.rules : [];
    const ruleIds = new Set();
    let rewriteRules = 0;
    let refusalRules = 0;
    for (const [ruleIndex, rule] of rules.entries()) {
      const ruleLabel = `${label}.rules[${ruleIndex}]`;
      if (!isRecord(rule)) {
        findings.push(`${ruleLabel} must be an object`);
        continue;
      }
      if (
        typeof rule.id !== 'string' ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(rule.id) ||
        ruleIds.has(rule.id)
      ) {
        findings.push(`${ruleLabel}.id must be unique kebab-case`);
      }
      ruleIds.add(rule.id);
      if (!RULE_ACTIONS.has(rule.action)) findings.push(`${ruleLabel}.action is invalid`);
      validateEndpoint(findings, `${ruleLabel}.from`, rule.from);
      if (rule.action === 'rewrite') {
        rewriteRules += 1;
        validateEndpoint(findings, `${ruleLabel}.to`, rule.to);
      } else {
        refusalRules += 1;
        if (!API_MIGRATION_REFUSAL_CATEGORIES.includes(rule.category)) {
          findings.push(`${ruleLabel}.category is not a reviewed refusal category`);
        }
        if (typeof rule.reason !== 'string' || rule.reason.trim().length < 30) {
          findings.push(`${ruleLabel}.reason must explain why guessing would change intent`);
        }
      }
    }
    if (batch.state !== 'preparing' && rules.length === 0) {
      findings.push(`${label}: ready/removed batches require migration rules`);
    }
    if (batch.state !== 'preparing' && refusalRules === 0) {
      findings.push(`${label}: ready/removed tools need at least one fail-closed refusal rule`);
    }
    if (batch.state !== 'preparing') {
      for (const id of batch.decisions ?? []) {
        const decision = decisionRows.get(id);
        if (!decision) continue;
        const coveringRules = rules.filter((rule) => ruleCoversDecision(rule, decision));
        if (coveringRules.length === 0) {
          findings.push(`${label}: no rewrite/refusal rule covers decision ${id}`);
          continue;
        }
        if (
          decision.decision === 'move' &&
          !coveringRules.some(
            (rule) =>
              rule.action === 'rewrite' &&
              rule.to?.specifier === decision.canonicalHome &&
              (typeof decision.symbol !== 'string' || rule.to.symbol === decision.symbol),
          )
        ) {
          findings.push(
            `${label}: move decision ${id} needs a rewrite to canonical home ${decision.canonicalHome}`,
          );
        }
      }
    }

    if (!isRecord(batch.fixtures)) {
      findings.push(`${label}.fixtures must bind rewrite and refusal evidence`);
    } else {
      for (const [kind, expectedRules] of [
        ['rewrites', rewriteRules],
        ['refusals', refusalRules],
      ]) {
        const files = batch.fixtures[kind];
        if (
          batch.state !== 'preparing' &&
          expectedRules > 0 &&
          (!Array.isArray(files) || files.length === 0)
        ) {
          findings.push(`${label}.fixtures.${kind} must be non-empty before removal`);
        }
        if (batch.state !== 'preparing' && expectedRules === 0 && (files?.length ?? 0) > 0) {
          findings.push(`${label}.fixtures.${kind} cannot claim evidence without a matching rule`);
        }
        for (const [fileIndex, file] of (files ?? []).entries()) {
          validateFile(findings, repoRoot, `${label}.fixtures.${kind}[${fileIndex}]`, file);
        }
      }
    }
    if (
      batch.state !== 'preparing' &&
      (!isRecord(batch.exercised) ||
        batch.exercised.resultSchema !== API_MIGRATION_RESULT_SCHEMA ||
        typeof batch.exercised.command !== 'string' ||
        !batch.exercised.command.includes('--check') ||
        !batch.exercised.command.includes(batch.tool?.path))
    ) {
      findings.push(`${label}.exercised must record a checked ${API_MIGRATION_RESULT_SCHEMA} run`);
    }
  }

  for (const [id, decision] of decisionRows) {
    if (decision.state !== 'removed') continue;
    const batch = batchById.get(decision.migrationBatch);
    if (!batch) {
      findings.push(`${id}: removed decision has no migration batch ${decision.migrationBatch}`);
    } else if (batch.state !== 'removed') {
      findings.push(`${id}: old export cannot disappear before ${batch.id} reaches removed`);
    } else if (!batch.decisions.includes(id)) {
      findings.push(`${id}: migration batch ${batch.id} does not cover the decision row`);
    }
  }

  return { findings: sortedUnique(findings), report: { batches: batches.length } };
}

export function validateApiMigrationResult(result, { batch, mode }) {
  const findings = [];
  if (!isRecord(result) || result.schema !== API_MIGRATION_RESULT_SCHEMA) {
    return { findings: [`result schema must be ${API_MIGRATION_RESULT_SCHEMA}`] };
  }
  if (result.batch !== batch) findings.push(`result batch must be ${batch}`);
  if (result.mode !== mode || !['check', 'write'].includes(result.mode)) {
    findings.push(`result mode must be ${mode}`);
  }
  if (!Array.isArray(result.files)) {
    findings.push('result files must be an array');
  } else {
    const paths = new Set();
    for (const [index, file] of result.files.entries()) {
      const label = `files[${index}]`;
      if (!isRecord(file) || !canonicalRepoPath(file.path)) {
        findings.push(`${label}.path must be canonical and repository-relative`);
        continue;
      }
      if (paths.has(file.path)) findings.push(`${label}.path is duplicated`);
      paths.add(file.path);
      if (!RESULT_FILE_STATES.has(file.state)) findings.push(`${label}.state is invalid`);
      if (file.state === 'refused') {
        if (!Array.isArray(file.refusals) || file.refusals.length === 0) {
          findings.push(`${label}: refused files require structured refusals`);
        }
        for (const refusal of file.refusals ?? []) {
          if (!API_MIGRATION_REFUSAL_CATEGORIES.includes(refusal.category)) {
            findings.push(`${label}: unknown refusal category ${String(refusal.category)}`);
          }
          if (
            !isRecord(refusal.anchor) ||
            !Number.isInteger(refusal.anchor.start) ||
            !Number.isInteger(refusal.anchor.end) ||
            refusal.anchor.start < 0 ||
            refusal.anchor.end < refusal.anchor.start
          ) {
            findings.push(`${label}: refusal needs a source byte-range anchor`);
          }
        }
      } else if (file.refusals !== undefined) {
        findings.push(`${label}: only refused files may carry refusals`);
      }
    }
  }
  if (
    !isRecord(result.summary) ||
    !['rewritten', 'unchanged', 'refused'].every(
      (key) => Number.isInteger(result.summary?.[key]) && result.summary[key] >= 0,
    )
  ) {
    findings.push('result summary needs non-negative integer rewritten/unchanged/refused counts');
  } else if (
    Array.isArray(result.files) &&
    result.summary.rewritten + result.summary.unchanged + result.summary.refused !==
      result.files.length
  ) {
    findings.push('result summary counts must equal files.length');
  }
  return { findings: sortedUnique(findings) };
}

export function runApiMigrationProtocol({
  repoRoot = defaultRepoRoot,
  ledgerPath = path.join(repoRoot, 'api-migrations.json'),
  decisionsPath = path.join(repoRoot, 'api-surface-decisions.json'),
} = {}) {
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const decisions = JSON.parse(readFileSync(decisionsPath, 'utf8'));
  const result = validateApiMigrationLedger({ ledger, decisions, repoRoot });
  if (result.findings.length > 0) {
    process.stderr.write(
      `api-migration-protocol: ${result.findings.length} finding(s):\n  ${result.findings.join(
        '\n  ',
      )}\n`,
    );
    return { ...result, ok: false };
  }
  process.stdout.write(
    `api-migration-protocol/v1 batches=${String(result.report.batches)} modes=check,write refusals=${String(API_MIGRATION_REFUSAL_CATEGORIES.length)}\n`,
  );
  return { ...result, ok: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = runApiMigrationProtocol();
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
