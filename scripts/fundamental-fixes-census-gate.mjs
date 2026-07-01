#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

const repoRoot = findRepoRoot();
const requireFromRepo = createRequire(path.join(repoRoot, 'package.json'));

export const defaultPlanPath = 'plans/fundamental-fixes-followup.md';
export const defaultManifestPath = 'scripts/fundamental-fixes-census.manifest.json';

export const CENSUS_KINDS = [
  'write-capable-handle',
  'output-wire-sink',
  'resolver-expression-kind',
  'dialect-sink',
];

export const ALLOWED_STATUSES = ['open', 'in-progress', 'closed'];
export const ALLOWED_RESOLVER_STATUSES = ['resolved', 'fails-closed'];
export const FORBIDDEN_STATUS_PATTERN =
  /\b(?:deferred|out[-_\s]*of[-_\s]*scope|future|later|parked)\b/iu;
export const PLACEHOLDER_EVIDENCE_PATTERN = /^(?:placeholder|pending|todo|tbd|none|open)$/iu;

export const REQUIRED_RESOLVER_EXPRESSION_KINDS = [...typescriptExpressionKindNames(), 'default'];

export const REQUIRED_DIALECT_MATRIX_DIALECTS = ['pglite', 'better-sqlite3', 'unknown'];
export const REQUIRED_DIALECT_MATRIX_SINKS = [
  'execute',
  'query',
  'run',
  'get',
  'all',
  'values',
  'transaction',
  'with',
  'unknown-method',
];

export const DEFAULT_M1_AXES = {
  prodArtifact: true,
  dialects: ['postgres', 'sqlite'],
  independentReviewer: true,
};
export const CENSUS_AUTHORITY = [
  'SPEC.md 1.3 machine-auditable generation',
  'spec/11-verification.md 11.2 runtime verification',
  'plans/fundamental-fixes-followup.md M1/M2/M3/M4/M5',
];

const PLAN_CENSUS_SECTIONS = [
  {
    endMarker: '**(b) Output / wire sinks**',
    kind: 'write-capable-handle',
    startMarker: '**(a) Write-capable handle surfaces**',
  },
  {
    endMarker: '## Traceability',
    kind: 'output-wire-sink',
    startMarker: '**(b) Output / wire sinks**',
  },
];

export function loadCensusManifest(manifestPath = path.join(repoRoot, defaultManifestPath)) {
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

export function loadPlanText(planPath = path.join(repoRoot, defaultPlanPath)) {
  return readFileSync(planPath, 'utf8');
}

export function extractPlanCensusRows(planText) {
  const rows = [];
  for (const section of PLAN_CENSUS_SECTIONS) {
    const sectionText = extractBetween(planText, section.startMarker, section.endMarker);
    const baseLine = lineNumberAtOffset(planText, planText.indexOf(section.startMarker));
    const lines = sectionText.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const match = /^- \[(?<checkbox>[ xX])\]\s+(?<body>.+?)\s*$/u.exec(lines[index].trim());
      if (!match?.groups) continue;

      const ownerMatch = /\s+\[(?<owner>[A-Z0-9/]+)\]\s*$/u.exec(match.groups.body);
      const label = ownerMatch
        ? match.groups.body.slice(0, ownerMatch.index).trim()
        : match.groups.body.trim();
      rows.push({
        checkbox: match.groups.checkbox.toLowerCase() === 'x' ? 'closed' : 'open',
        id: planCensusRowId(label),
        kind: section.kind,
        label,
        line: baseLine + index,
        owner: splitOwners(ownerMatch?.groups?.owner),
      });
    }
  }
  return rows;
}

export function planCensusRowId(label) {
  return label
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\*\*/gu, '')
    .replace(/[^A-Za-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase();
}

export function evaluateFundamentalFixesCensus({
  manifest = loadCensusManifest(),
  planPath = defaultPlanPath,
  planText = loadPlanText(path.join(repoRoot, planPath)),
  requireComplete = false,
} = {}) {
  const violations = [];
  const rows = Array.isArray(manifest?.rows) ? manifest.rows : [];
  const evidenceBundleIds = validateEvidenceBundles(manifest?.evidenceBundles, violations);
  const planRows = extractPlanCensusRows(planText);
  const rowsById = new Map();

  if (manifest?.planPath !== planPath) {
    violations.push(
      `${defaultManifestPath}: planPath must be ${JSON.stringify(planPath)}; found ${JSON.stringify(
        manifest?.planPath,
      )}`,
    );
  }

  validatePlanDenominatorText(planText, violations);
  validateAdversarialGate(manifest?.adversarialGate, violations);

  for (const planRow of planRows) {
    if (planRow.owner.length === 0) {
      violations.push(`${planPath}:${planRow.line}: plan census row is missing an owner tag`);
    }
  }

  for (const row of rows) {
    validateRowShape(row, evidenceBundleIds, violations);
    if (typeof row?.id === 'string') {
      if (rowsById.has(row.id)) violations.push(`${row.id}: duplicate census row id`);
      rowsById.set(row.id, row);
    }
  }

  validatePlanLinkedRows(planRows, rows, violations);
  validateParentRows(rows, rowsById, violations);
  validateResolverRows(rows, violations);
  validateDialectMatrixRows(rows, violations);

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    if (row.status === 'closed') validateClosedRow(row, manifest?.adversarialGate, violations);
    if (requireComplete && row.status !== 'closed') {
      violations.push(`${row.id ?? '<missing-id>'}: M4 completion requires status "closed"`);
    }
  }

  const denominator = {
    dialectMatrixRows: rows.filter((row) => row?.kind === 'dialect-sink').length,
    outputWireSinkRows: rows.filter((row) => row?.kind === 'output-wire-sink').length,
    resolverExpressionKindRows: rows.filter((row) => row?.kind === 'resolver-expression-kind')
      .length,
    writeCapableHandleRows: rows.filter((row) => row?.kind === 'write-capable-handle').length,
  };
  const openRows = rows.filter((row) => row?.status !== 'closed').map((row) => row.id);
  const complete = violations.length === 0 && rows.length > 0 && openRows.length === 0;

  return {
    authority: CENSUS_AUTHORITY,
    complete,
    denominator,
    manifestVersion: manifest?.version,
    ok: violations.length === 0,
    openRows,
    planRows: {
      outputWireSinkRows: planRows.filter((row) => row.kind === 'output-wire-sink').length,
      writeCapableHandleRows: planRows.filter((row) => row.kind === 'write-capable-handle').length,
    },
    requireComplete,
    rowCount: rows.length,
    violations,
  };
}

function validatePlanDenominatorText(planText, violations) {
  for (const marker of [
    'Sink & handle census',
    'resolver expression-kind table',
    'Dialect \u00d7 sink metamorphic matrix',
  ]) {
    if (!planText.includes(marker)) {
      violations.push(
        `${defaultPlanPath}: M4 denominator marker ${JSON.stringify(marker)} missing`,
      );
    }
  }
}

function validateAdversarialGate(adversarialGate, violations) {
  if (!adversarialGate || typeof adversarialGate !== 'object') {
    violations.push(`${defaultManifestPath}: adversarialGate must record the M1 required axes`);
    return;
  }
  if (adversarialGate.prodArtifact !== true) {
    violations.push(`${defaultManifestPath}: adversarialGate.prodArtifact must be true`);
  }
  if (adversarialGate.independentReviewer !== true) {
    violations.push(`${defaultManifestPath}: adversarialGate.independentReviewer must be true`);
  }
  if (!sameStringSet(adversarialGate.dialects, DEFAULT_M1_AXES.dialects)) {
    violations.push(
      `${defaultManifestPath}: adversarialGate.dialects must enumerate ${DEFAULT_M1_AXES.dialects.join(
        ', ',
      )}`,
    );
  }
}

function validateEvidenceBundles(evidenceBundles, violations) {
  if (evidenceBundles === undefined) return new Set();
  if (!evidenceBundles || typeof evidenceBundles !== 'object' || Array.isArray(evidenceBundles)) {
    violations.push(`${defaultManifestPath}: evidenceBundles must be an object when present`);
    return new Set();
  }

  const ids = new Set();
  for (const [id, bundle] of Object.entries(evidenceBundles)) {
    ids.add(id);
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
      violations.push(`${defaultManifestPath}: evidence bundle ${id} must be an object`);
      continue;
    }
    if (!isConcreteEvidence(bundle.command)) {
      violations.push(`${defaultManifestPath}: evidence bundle ${id} is missing command evidence`);
    }
    if (!isConcreteEvidence(bundle.evidence)) {
      violations.push(`${defaultManifestPath}: evidence bundle ${id} is missing evidence summary`);
    }
  }

  return ids;
}

function validateRowShape(row, evidenceBundleIds, violations) {
  if (!row || typeof row !== 'object') {
    violations.push('census manifest row must be an object');
    return;
  }
  const label = typeof row.id === 'string' && row.id.length > 0 ? row.id : '<missing-id>';
  if (typeof row.id !== 'string' || row.id.length === 0) {
    violations.push(`${label}: census row is missing id`);
  }
  if (!CENSUS_KINDS.includes(row.kind)) {
    violations.push(`${label}: census row kind must be one of ${CENSUS_KINDS.join(', ')}`);
  }
  const owners = splitOwners(row.owner);
  if (owners.length === 0) {
    violations.push(`${label}: census row is missing owner`);
  }
  if (typeof row.status !== 'string' || row.status.length === 0) {
    violations.push(`${label}: census row is missing status`);
  } else if (FORBIDDEN_STATUS_PATTERN.test(row.status)) {
    violations.push(`${label}: M5 forbids status ${JSON.stringify(row.status)}`);
  } else if (!ALLOWED_STATUSES.includes(row.status)) {
    violations.push(`${label}: unsupported status ${JSON.stringify(row.status)}`);
  }
  if (typeof row.evidence !== 'string' || row.evidence.trim().length === 0) {
    violations.push(`${label}: census row is missing evidence placeholder`);
  }
  if (row.parent !== undefined && (typeof row.parent !== 'string' || row.parent.length === 0)) {
    violations.push(`${label}: parent must be a non-empty row id when present`);
  }
  if (row.evidenceBundles !== undefined) {
    if (!Array.isArray(row.evidenceBundles)) {
      violations.push(`${label}: evidenceBundles must be an array of bundle ids`);
    } else {
      for (const bundleId of row.evidenceBundles) {
        if (typeof bundleId !== 'string' || bundleId.length === 0) {
          violations.push(`${label}: evidenceBundles entries must be non-empty strings`);
          continue;
        }
        if (!evidenceBundleIds.has(bundleId)) {
          violations.push(`${label}: references missing evidence bundle ${bundleId}`);
        }
      }
    }
  }
}

function validatePlanLinkedRows(planRows, rows, violations) {
  const manifestRowsByKindAndId = new Map(
    rows
      .filter((row) => row?.kind === 'write-capable-handle' || row?.kind === 'output-wire-sink')
      .map((row) => [`${row.kind}:${row.id}`, row]),
  );
  const planRowsByKindAndId = new Map(planRows.map((row) => [`${row.kind}:${row.id}`, row]));

  for (const planRow of planRows) {
    const row = manifestRowsByKindAndId.get(`${planRow.kind}:${planRow.id}`);
    if (!row) {
      violations.push(
        `${defaultManifestPath}: missing manifest row for ${planRow.kind} plan row ${planRow.id}`,
      );
      continue;
    }
    if (!sameStringSet(splitOwners(row.owner), planRow.owner)) {
      violations.push(
        `${row.id}: owner ${JSON.stringify(splitOwners(row.owner))} does not match plan owner ${JSON.stringify(
          planRow.owner,
        )}`,
      );
    }
    if (planRow.checkbox === 'closed' && row.status !== 'closed') {
      violations.push(`${row.id}: plan checkbox is closed but manifest row is ${row.status}`);
    }
    if (planRow.checkbox !== 'closed' && row.status === 'closed') {
      violations.push(`${row.id}: manifest row is closed but plan checkbox is open`);
    }
  }

  for (const row of manifestRowsByKindAndId.values()) {
    if (!planRowsByKindAndId.has(`${row.kind}:${row.id}`)) {
      violations.push(`${row.id}: ${row.kind} row is not present in ${defaultPlanPath}`);
    }
  }
}

function validateParentRows(rows, rowsById, violations) {
  const childrenByParent = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || row.parent === undefined) continue;
    const parent = rowsById.get(row.parent);
    if (!parent) {
      violations.push(`${row.id ?? '<missing-id>'}: parent row ${row.parent} is missing`);
      continue;
    }
    if (parent.kind !== row.kind) {
      violations.push(
        `${row.id}: parent row ${row.parent} has kind ${parent.kind}, not ${row.kind}`,
      );
    }
    const children = childrenByParent.get(row.parent) ?? [];
    children.push(row);
    childrenByParent.set(row.parent, children);
  }

  for (const [parentId, children] of childrenByParent.entries()) {
    const parent = rowsById.get(parentId);
    if (parent?.status === 'closed') {
      for (const child of children) {
        if (child.status !== 'closed') {
          violations.push(
            `${parentId}: parent row cannot close while child row ${child.id} is ${child.status}`,
          );
        }
      }
    }
  }
}

function validateResolverRows(rows, violations) {
  const resolverRows = rows.filter((row) => row?.kind === 'resolver-expression-kind');
  const kinds = new Map();
  for (const row of resolverRows) {
    if (typeof row.expressionKind !== 'string' || row.expressionKind.length === 0) {
      violations.push(`${row.id ?? '<missing-id>'}: resolver row is missing expressionKind`);
      continue;
    }
    if (!ALLOWED_RESOLVER_STATUSES.includes(row.resolverStatus)) {
      violations.push(
        `${row.id ?? '<missing-id>'}: resolverStatus must be one of ${ALLOWED_RESOLVER_STATUSES.join(
          ', ',
        )}`,
      );
    }
    if (
      typeof row.coverageExpectation !== 'string' ||
      row.coverageExpectation.trim().length === 0 ||
      PLACEHOLDER_EVIDENCE_PATTERN.test(row.coverageExpectation.trim())
    ) {
      violations.push(`${row.id ?? '<missing-id>'}: resolver row is missing coverageExpectation`);
    }
    if (kinds.has(row.expressionKind)) {
      violations.push(`${row.id}: duplicate resolver expressionKind ${row.expressionKind}`);
    }
    kinds.set(row.expressionKind, row);
  }
  for (const requiredKind of REQUIRED_RESOLVER_EXPRESSION_KINDS) {
    if (!kinds.has(requiredKind)) {
      violations.push(
        `${defaultManifestPath}: missing resolver expression-kind row ${requiredKind}`,
      );
    }
  }
  for (const row of resolverRows) {
    if (
      typeof row.expressionKind === 'string' &&
      !REQUIRED_RESOLVER_EXPRESSION_KINDS.includes(row.expressionKind)
    ) {
      violations.push(`${row.id}: unknown resolver expressionKind ${row.expressionKind}`);
    }
  }
}

function validateDialectMatrixRows(rows, violations) {
  const matrixRows = rows.filter((row) => row?.kind === 'dialect-sink');
  const cells = new Set();
  for (const row of matrixRows) {
    if (!REQUIRED_DIALECT_MATRIX_DIALECTS.includes(row.dialect)) {
      violations.push(
        `${row.id ?? '<missing-id>'}: unsupported dialect matrix dialect ${row.dialect}`,
      );
    }
    if (!REQUIRED_DIALECT_MATRIX_SINKS.includes(row.sink)) {
      violations.push(`${row.id ?? '<missing-id>'}: unsupported dialect matrix sink ${row.sink}`);
    }
    const cell = `${row.dialect}:${row.sink}`;
    if (cells.has(cell)) violations.push(`${row.id}: duplicate dialect matrix cell ${cell}`);
    cells.add(cell);
  }
  for (const dialect of REQUIRED_DIALECT_MATRIX_DIALECTS) {
    for (const sink of REQUIRED_DIALECT_MATRIX_SINKS) {
      if (!cells.has(`${dialect}:${sink}`)) {
        violations.push(
          `${defaultManifestPath}: missing dialect x sink matrix row ${dialect}/${sink}`,
        );
      }
    }
  }
}

function validateClosedRow(row, adversarialGate, violations) {
  if (PLACEHOLDER_EVIDENCE_PATTERN.test(row.evidence.trim())) {
    violations.push(`${row.id}: closed row must replace placeholder evidence`);
  }

  const m1 = row.m1;
  if (!m1 || typeof m1 !== 'object') {
    violations.push(`${row.id}: closed row is missing M1 adversarial evidence`);
    return;
  }

  if (!isConcreteEvidence(m1.prodArtifact)) {
    violations.push(`${row.id}: closed row is missing M1 prod artifact evidence`);
  }

  const requiredDialects = Array.isArray(adversarialGate?.dialects)
    ? adversarialGate.dialects
    : DEFAULT_M1_AXES.dialects;
  for (const dialect of requiredDialects) {
    if (!isConcreteEvidence(m1.dialects?.[dialect])) {
      violations.push(`${row.id}: closed row is missing M1 dialect evidence for ${dialect}`);
    }
  }

  if (!isConcreteEvidence(m1.independentReviewer)) {
    violations.push(`${row.id}: closed row is missing M1 independent reviewer evidence`);
  }

  const m2 = row.m2;
  if (!m2 || typeof m2 !== 'object') {
    violations.push(`${row.id}: closed row is missing M2 real-build evidence`);
  } else {
    if (!isConcreteEvidence(m2.productionBuild)) {
      violations.push(`${row.id}: closed row is missing M2 production build evidence`);
    }
    if (!isConcreteEvidence(m2.noFixtureOnlyCertification)) {
      violations.push(`${row.id}: closed row is missing M2 no-fixture-only gate evidence`);
    }
  }

  const m3 = row.m3;
  if (!m3 || typeof m3 !== 'object') {
    violations.push(`${row.id}: closed row is missing M3 mutation evidence`);
  } else if (!isConcreteEvidence(m3.mutationGate)) {
    violations.push(`${row.id}: closed row is missing M3 mutation gate evidence`);
  }
}

function isConcreteEvidence(value) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    !PLACEHOLDER_EVIDENCE_PATTERN.test(value.trim())
  );
}

function splitOwners(owner) {
  if (Array.isArray(owner)) return owner.flatMap(splitOwners);
  if (typeof owner !== 'string') return [];
  return owner
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size !== rightSet.size) return false;
  return [...leftSet].every((value) => rightSet.has(value));
}

function extractBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) return '';
  const end = text.indexOf(endMarker, start + startMarker.length);
  return text.slice(start, end === -1 ? undefined : end);
}

function lineNumberAtOffset(text, offset) {
  if (offset < 0) return 1;
  return text.slice(0, offset).split(/\r?\n/u).length;
}

function typescriptExpressionKindNames() {
  const typescriptMain = requireFromRepo.resolve('typescript');
  const compilerSource = readFileSync(typescriptMain, 'utf8');
  const leftHandSideKinds = syntaxKindNamesFromFunction(
    compilerSource,
    'isLeftHandSideExpressionKind',
  );
  const unaryKinds = syntaxKindNamesFromFunction(compilerSource, 'isUnaryExpressionKind').filter(
    (kind) => !leftHandSideKinds.includes(kind),
  );
  const expressionKinds = syntaxKindNamesFromFunction(compilerSource, 'isExpressionKind').filter(
    (kind) => !leftHandSideKinds.includes(kind) && !unaryKinds.includes(kind),
  );
  return [...leftHandSideKinds, ...unaryKinds, ...expressionKinds];
}

function syntaxKindNamesFromFunction(source, functionName) {
  const body = functionBody(source, functionName);
  return [...body.matchAll(/case\s+\d+\s+\/\*\s+([A-Za-z0-9_]+)\s+\*\//gu)].map(
    (match) => match[1],
  );
}

function functionBody(source, functionName) {
  const signature = `function ${functionName}(`;
  const signatureIndex = source.indexOf(signature);
  if (signatureIndex === -1) {
    throw new Error(`TypeScript compiler source is missing ${functionName}`);
  }
  const bodyStart = source.indexOf('{', signatureIndex);
  if (bodyStart === -1) {
    throw new Error(`TypeScript compiler source has no body for ${functionName}`);
  }

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(bodyStart + 1, index);
    }
  }
  throw new Error(`TypeScript compiler source has unterminated body for ${functionName}`);
}

function parseArgs(argv) {
  const options = {
    json: false,
    manifestPath: path.join(repoRoot, defaultManifestPath),
    planPath: path.join(repoRoot, defaultPlanPath),
    requireComplete: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--require-complete') {
      options.requireComplete = true;
      continue;
    }
    if (arg === '--manifest') {
      options.manifestPath = path.resolve(argv[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (arg === '--plan') {
      options.planPath = path.resolve(argv[index + 1] ?? '');
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = existsSync(options.manifestPath)
    ? loadCensusManifest(options.manifestPath)
    : { rows: [] };
  const planText = existsSync(options.planPath) ? readFileSync(options.planPath, 'utf8') : '';
  const report = evaluateFundamentalFixesCensus({
    manifest,
    planPath: path.relative(repoRoot, options.planPath).split(path.sep).join('/'),
    planText,
    requireComplete: options.requireComplete,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.violations.length > 0) {
    process.stderr.write(`Fundamental fixes census gate failed:\n`);
    for (const violation of report.violations) process.stderr.write(`  - ${violation}\n`);
  } else {
    process.stdout.write(
      `Fundamental fixes census gate passed (${report.rowCount} rows; complete: ${String(
        report.complete,
      )}).\n`,
    );
  }

  if (!report.ok) process.exitCode = 1;
}

if (isMainEntry(import.meta.url)) await runGate(main);
