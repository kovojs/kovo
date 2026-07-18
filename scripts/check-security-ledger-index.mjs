#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot } from './lib/repo-root.mjs';

export const defaultRepoRoot = repoRoot();
export const defaultIndexPath = 'plans/security-ledger-index.json';
export const securityLedgerSchema = 'kovo.security-ledger-index/v1';
export const transientLedgerMarker = '<!-- kovo-security-ledger: transient -->';
export const maxTransientLifetimeDays = 30;

const millisecondsPerDay = 24 * 60 * 60 * 1000;
const transientStates = new Set([
  'open',
  'closed-pending-publication',
  'published-pending-archive',
]);

export function validateSecurityLedgerIndex({
  rootDir = defaultRepoRoot,
  indexPath = defaultIndexPath,
  today = new Date(),
} = {}) {
  const findings = [];
  const absoluteIndexPath = path.join(rootDir, indexPath);
  if (!existsSync(absoluteIndexPath)) {
    return result(findings.concat(`${indexPath}: security ledger index is missing`));
  }

  let index;
  try {
    index = JSON.parse(readFileSync(absoluteIndexPath, 'utf8'));
  } catch (error) {
    return result(findings.concat(`${indexPath}: invalid JSON: ${error.message}`));
  }

  if (index?.schema !== securityLedgerSchema) {
    findings.push(`${indexPath}: schema must be ${securityLedgerSchema}`);
  }

  const ledgerKinds = plainObject(index?.ledgerKinds) ? index.ledgerKinds : {};
  if (!plainObject(index?.ledgerKinds)) {
    findings.push(`${indexPath}: ledgerKinds must be an object`);
  }
  validateLedgerKinds({ findings, indexPath, ledgerKinds, rootDir });

  const activeRoadmaps = arrayField(index, 'activeRoadmaps', indexPath, findings);
  const transientLedgers = arrayField(index, 'transientLedgers', indexPath, findings);
  const seenPaths = new Set();

  for (const [entryIndex, roadmap] of activeRoadmaps.entries()) {
    const label = `${indexPath}: activeRoadmaps[${entryIndex}]`;
    if (!plainObject(roadmap)) {
      findings.push(`${label} must be an object`);
      continue;
    }
    validatePlanPath({ findings, label, relativePath: roadmap.path, rootDir, seenPaths });
    requireNonEmptyString(roadmap.role, `${label}.role`, findings);
    requireNonEmptyString(roadmap.summary, `${label}.summary`, findings);
  }

  const normalizedToday = normalizeToday(today, findings, indexPath);
  for (const [entryIndex, ledger] of transientLedgers.entries()) {
    validateTransientLedger({
      findings,
      indexPath,
      entryIndex,
      ledger,
      ledgerKinds,
      normalizedToday,
      rootDir,
      seenPaths,
    });
  }

  validateHistory({ findings, history: index?.history, indexPath, rootDir });
  validateMarkerEnrollment({ findings, rootDir, transientLedgers });

  return result(findings, {
    roadmapCount: activeRoadmaps.length,
    transientCount: transientLedgers.length,
    historicalSeriesCount: Array.isArray(index?.history?.series) ? index.history.series.length : 0,
  });
}

export function runSecurityLedgerIndexCheck(options = {}) {
  const check = validateSecurityLedgerIndex(options);
  if (check.ok) {
    process.stdout.write(`check-security-ledger-index/v1\nOK ${check.summary}\n`);
    return 0;
  }

  process.stderr.write(
    `check-security-ledger-index/v1\nFAIL ${check.summary}:\n${check.findings
      .map((finding) => `- ${finding}`)
      .join('\n')}\n`,
  );
  return 1;
}

function validateLedgerKinds({ findings, indexPath, ledgerKinds, rootDir }) {
  if (Object.keys(ledgerKinds).length === 0) {
    findings.push(`${indexPath}: ledgerKinds must declare at least one allocation kind`);
  }
  for (const [kind, config] of Object.entries(ledgerKinds)) {
    const label = `${indexPath}: ledgerKinds.${kind}`;
    if (!plainObject(config)) {
      findings.push(`${label} must be an object`);
      continue;
    }
    if (!Number.isSafeInteger(config.nextSequence) || config.nextSequence < 1) {
      findings.push(`${label}.nextSequence must be a positive integer`);
    }
    if (
      typeof config.pathTemplate !== 'string' ||
      !isSafePlanMarkdownPath(config.pathTemplate.replace('{sequence}', '1')) ||
      countOccurrences(config.pathTemplate, '{sequence}') !== 1
    ) {
      findings.push(
        `${label}.pathTemplate must be a safe plans/*.md path with one {sequence} placeholder`,
      );
      continue;
    }
    if (Number.isSafeInteger(config.nextSequence) && config.nextSequence > 0) {
      const nextPath = config.pathTemplate.replace('{sequence}', String(config.nextSequence));
      if (existsSync(path.join(rootDir, nextPath))) {
        findings.push(`${label}.nextSequence is already consumed by ${nextPath}`);
      }
    }
  }
}

function validateTransientLedger({
  findings,
  indexPath,
  entryIndex,
  ledger,
  ledgerKinds,
  normalizedToday,
  rootDir,
  seenPaths,
}) {
  const label = `${indexPath}: transientLedgers[${entryIndex}]`;
  if (!plainObject(ledger)) {
    findings.push(`${label} must be an object`);
    return;
  }

  validatePlanPath({ findings, label, relativePath: ledger.path, rootDir, seenPaths });
  if (typeof ledger.kind !== 'string' || !plainObject(ledgerKinds[ledger.kind])) {
    findings.push(`${label}.kind must name a ledgerKinds entry`);
  }
  requireNonEmptyString(ledger.summary, `${label}.summary`, findings);

  if (!transientStates.has(ledger.state)) {
    findings.push(
      `${label}.state must be open, closed-pending-publication, or published-pending-archive`,
    );
  }

  const openedOn = parseIsoDate(ledger.openedOn, `${label}.openedOn`, findings);
  const archiveBy = parseIsoDate(ledger.archiveBy, `${label}.archiveBy`, findings);
  if (openedOn && archiveBy) {
    const lifetimeDays = (archiveBy.getTime() - openedOn.getTime()) / millisecondsPerDay;
    if (lifetimeDays < 0 || lifetimeDays > maxTransientLifetimeDays) {
      findings.push(
        `${label}.archiveBy must be between openedOn and ${maxTransientLifetimeDays} days later`,
      );
    }
  }
  if (normalizedToday && openedOn && openedOn > normalizedToday) {
    findings.push(`${label}.openedOn cannot be in the future`);
  }
  if (normalizedToday && archiveBy && archiveBy < normalizedToday) {
    findings.push(
      `${label}.archiveBy has expired; publish/archive the ledger or extend with review`,
    );
  }

  if (
    !isSafePlanMarkdownPath(ledger.archivePath) ||
    !ledger.archivePath.startsWith('plans/history/')
  ) {
    findings.push(`${label}.archivePath must be a safe Markdown path below plans/history/`);
  } else {
    if (ledger.archivePath === ledger.path) {
      findings.push(`${label}.archivePath must differ from the active ledger path`);
    }
    if (existsSync(path.join(rootDir, ledger.archivePath))) {
      findings.push(`${label}.archivePath already exists: ${ledger.archivePath}`);
    }
  }

  const needsClosedOn =
    ledger.state === 'closed-pending-publication' || ledger.state === 'published-pending-archive';
  const closedOn = ledger.closedOn
    ? parseIsoDate(ledger.closedOn, `${label}.closedOn`, findings)
    : undefined;
  if (needsClosedOn && !closedOn) {
    findings.push(`${label}.closedOn is required after closure`);
  }
  if (ledger.state === 'open' && ledger.closedOn !== undefined) {
    findings.push(`${label}.closedOn is forbidden while state is open`);
  }
  if (openedOn && closedOn && closedOn < openedOn) {
    findings.push(`${label}.closedOn cannot precede openedOn`);
  }
  if (normalizedToday && closedOn && closedOn > normalizedToday) {
    findings.push(`${label}.closedOn cannot be in the future`);
  }

  if (ledger.state === 'published-pending-archive') {
    validatePublication({
      findings,
      label,
      publication: ledger.publication,
      closedOn,
      normalizedToday,
    });
  } else if (ledger.publication !== undefined) {
    findings.push(`${label}.publication is only allowed after verified publication`);
  }
}

function validatePublication({ findings, label, publication, closedOn, normalizedToday }) {
  if (!plainObject(publication)) {
    findings.push(`${label}.publication must record commit, ref, and verifiedOn`);
    return;
  }
  if (typeof publication.commit !== 'string' || !/^[0-9a-f]{7,40}$/u.test(publication.commit)) {
    findings.push(`${label}.publication.commit must be a 7-40 character lowercase Git SHA`);
  }
  requireNonEmptyString(publication.ref, `${label}.publication.ref`, findings);
  const verifiedOn = parseIsoDate(
    publication.verifiedOn,
    `${label}.publication.verifiedOn`,
    findings,
  );
  if (closedOn && verifiedOn && verifiedOn < closedOn) {
    findings.push(`${label}.publication.verifiedOn cannot precede closedOn`);
  }
  if (normalizedToday && verifiedOn && verifiedOn > normalizedToday) {
    findings.push(`${label}.publication.verifiedOn cannot be in the future`);
  }
}

function validateHistory({ findings, history, indexPath, rootDir }) {
  if (!plainObject(history)) {
    findings.push(`${indexPath}: history must be an object`);
    return;
  }
  const dedupRoots = arrayField(history, 'dedupRoots', `${indexPath}: history`, findings);
  if (dedupRoots.length === 0) {
    findings.push(`${indexPath}: history.dedupRoots must preserve at least one dedup scope`);
  }
  for (const [rootIndex, relativeRoot] of dedupRoots.entries()) {
    const label = `${indexPath}: history.dedupRoots[${rootIndex}]`;
    if (
      typeof relativeRoot !== 'string' ||
      relativeRoot !== path.posix.normalize(relativeRoot) ||
      path.isAbsolute(relativeRoot) ||
      relativeRoot.includes('..')
    ) {
      findings.push(`${label} must be a safe repository-relative directory`);
      continue;
    }
    const absoluteRoot = path.join(rootDir, relativeRoot);
    if (!existsSync(absoluteRoot) || !statSync(absoluteRoot).isDirectory()) {
      findings.push(`${label} does not exist as a directory: ${relativeRoot}`);
    }
  }

  const series = arrayField(history, 'series', `${indexPath}: history`, findings);
  if (series.length === 0) {
    findings.push(`${indexPath}: history.series must retain at least one compact series summary`);
  }
  const seenIds = new Set();
  for (const [seriesIndex, entry] of series.entries()) {
    const label = `${indexPath}: history.series[${seriesIndex}]`;
    if (!plainObject(entry)) {
      findings.push(`${label} must be an object`);
      continue;
    }
    requireNonEmptyString(entry.id, `${label}.id`, findings);
    if (typeof entry.id === 'string' && entry.id !== '') {
      if (seenIds.has(entry.id)) findings.push(`${label}.id is duplicated: ${entry.id}`);
      seenIds.add(entry.id);
    }
    requireNonEmptyString(entry.summary, `${label}.summary`, findings);
    const representativePaths = arrayField(entry, 'representativePaths', label, findings);
    for (const [pathIndex, relativePath] of representativePaths.entries()) {
      validateExistingPlanPath({
        findings,
        label: `${label}.representativePaths[${pathIndex}]`,
        relativePath,
        rootDir,
      });
    }
  }
}

function validateMarkerEnrollment({ findings, rootDir, transientLedgers }) {
  const registered = new Set(
    transientLedgers
      .filter((ledger) => plainObject(ledger) && typeof ledger.path === 'string')
      .map((ledger) => ledger.path),
  );
  const marked = new Set(
    listMarkdownFiles(rootDir, 'plans').filter((relativePath) =>
      hasTransientLedgerMarker(readFileSync(path.join(rootDir, relativePath), 'utf8')),
    ),
  );

  for (const relativePath of marked) {
    if (!registered.has(relativePath)) {
      findings.push(`${relativePath}: transient marker requires registration in transientLedgers`);
    }
  }
  for (const relativePath of registered) {
    if (!marked.has(relativePath) && existsSync(path.join(rootDir, relativePath))) {
      findings.push(
        `${relativePath}: registered transient ledger is missing ${transientLedgerMarker}`,
      );
    }
  }
}

function hasTransientLedgerMarker(markdown) {
  return markdown.split(/\r?\n/u).some((line) => line.trim() === transientLedgerMarker);
}

function validatePlanPath({ findings, label, relativePath, rootDir, seenPaths }) {
  validateExistingPlanPath({ findings, label: `${label}.path`, relativePath, rootDir });
  if (typeof relativePath !== 'string') return;
  if (seenPaths.has(relativePath)) findings.push(`${label}.path is registered more than once`);
  seenPaths.add(relativePath);
}

function validateExistingPlanPath({ findings, label, relativePath, rootDir }) {
  if (!isSafePlanMarkdownPath(relativePath)) {
    findings.push(`${label} must be a safe Markdown path below plans/`);
    return;
  }
  if (!existsSync(path.join(rootDir, relativePath))) {
    findings.push(`${label} does not exist: ${relativePath}`);
  }
}

function listMarkdownFiles(rootDir, relativeRoot) {
  const output = [];
  const walk = (currentRelativePath) => {
    const absolutePath = path.join(rootDir, currentRelativePath);
    if (!existsSync(absolutePath)) return;
    for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
      const relativePath = path.posix.join(currentRelativePath, entry.name);
      if (entry.isDirectory()) walk(relativePath);
      else if (entry.isFile() && entry.name.endsWith('.md')) output.push(relativePath);
    }
  };
  walk(relativeRoot);
  return output.sort((left, right) => left.localeCompare(right));
}

function normalizeToday(today, findings, indexPath) {
  const value = today instanceof Date ? today : new Date(today);
  if (Number.isNaN(value.getTime())) {
    findings.push(`${indexPath}: validation date is invalid`);
    return undefined;
  }
  return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function parseIsoDate(value, label, findings) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    findings.push(`${label} must be an ISO YYYY-MM-DD date`);
    return undefined;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    findings.push(`${label} must be a real calendar date`);
    return undefined;
  }
  return parsed;
}

function isSafePlanMarkdownPath(relativePath) {
  return (
    typeof relativePath === 'string' &&
    relativePath.startsWith('plans/') &&
    relativePath.endsWith('.md') &&
    !path.isAbsolute(relativePath) &&
    !relativePath.includes('\\') &&
    !relativePath.split('/').includes('..') &&
    path.posix.normalize(relativePath) === relativePath
  );
}

function arrayField(owner, field, label, findings) {
  if (!Array.isArray(owner?.[field])) {
    findings.push(`${label}.${field} must be an array`);
    return [];
  }
  return owner[field];
}

function requireNonEmptyString(value, label, findings) {
  if (typeof value !== 'string' || value.trim() === '') {
    findings.push(`${label} must be a non-empty string`);
  }
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function countOccurrences(value, needle) {
  return value.split(needle).length - 1;
}

function result(findings, counts = {}) {
  const roadmapCount = counts.roadmapCount ?? 0;
  const transientCount = counts.transientCount ?? 0;
  const historicalSeriesCount = counts.historicalSeriesCount ?? 0;
  return {
    ok: findings.length === 0,
    findings,
    summary:
      findings.length === 0
        ? `${roadmapCount} active roadmap(s), ${transientCount} transient ledger(s), ${historicalSeriesCount} historical series`
        : `${findings.length} security ledger index violation(s)`,
  };
}

if (isMainEntry(import.meta.url)) await runGate(runSecurityLedgerIndexCheck);
