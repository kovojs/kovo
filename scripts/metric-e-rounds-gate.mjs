#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { ESCAPE_CENSUS_DOORS } from './escape-census-gate.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';
import {
  assertCleanCurrentCodeSubject,
  assertHistoricalCodeSubjectMatches,
  buildSourceSet,
  canonicalJson,
  parseExactCliArguments,
  SECURITY_EVIDENCE_SUBJECT_PROTOCOL,
  sha256,
  validateCodeSubjectSha,
} from './lib/security-evidence-subject.mjs';

export const metricERoundsSchema = 'kovo.metric-e-round-series/v1';
export const defaultMetricERoundsPath = 'security/metric-e-rounds.json';
export const defaultEscapeCensusBaselinePath = 'security/escape-census-baseline.json';
export const metricERequiredComparableRounds = 3;
export const metricEHistoricalSubjectPaths = Object.freeze([
  'packages/core/src/escape-census-graph.ts',
  'packages/drizzle/src/trust-escapes-static.ts',
  'scripts/escape-census-baseline.mjs',
  'scripts/escape-census-baseline.test.mjs',
  'scripts/escape-census-gate.mjs',
  'security/escape-budgets.json',
  'security/escape-census-baseline.json',
  'security/escape-census-config.json',
  'security/fixtures/escape-census-real-app/app.tsx',
  'security/fixtures/escape-census-real-app/package.json',
  'security/fixtures/escape-census-real-app/src/client.ts',
  'security/fixtures/escape-census-real-app/src/style.css',
  'security/fixtures/escape-census-real-app/src/style.d.ts',
  'security/fixtures/escape-census-real-app/tsconfig.json',
]);
export const metricEComparableCorpusPaths = Object.freeze([
  'security/fixtures/escape-census-real-app/app.tsx',
  'security/fixtures/escape-census-real-app/package.json',
  'security/fixtures/escape-census-real-app/src/client.ts',
  'security/fixtures/escape-census-real-app/src/style.css',
  'security/fixtures/escape-census-real-app/src/style.d.ts',
  'security/fixtures/escape-census-real-app/tsconfig.json',
]);

const metricECountingRule = Object.freeze({
  id: 'distinct-reachable-root-per-package-door/v1',
  rule: 'count each source-derived reachable root once per app and escape door, then count each app/root tuple once per package and door',
  unsignedEscapeRule:
    'a missing or mismatched kovo.escape-census-coverage/v1 producer witness fails the census, so every accepted report has zero unsigned escapes',
});

export function buildMetricEComparability({ repoRoot = findRepoRoot() } = {}) {
  const value = Object.freeze({
    appCorpus: Object.freeze({
      id: 'metric-e-representative/v1',
      sources: buildSourceSet({ paths: metricEComparableCorpusPaths, repoRoot }),
    }),
    censusSchema: 'kovo.escape-census/v1',
    countingRule: metricECountingRule,
    doorVocabulary: Object.freeze({
      values: ESCAPE_CENSUS_DOORS,
      sha256: sha256(canonicalJson(ESCAPE_CENSUS_DOORS)),
    }),
  });
  return Object.freeze({ ...value, sha256: sha256(canonicalJson(value)) });
}

export function buildMetricERound({
  baseline,
  codeSubjectSha,
  date,
  number,
  predecessor,
  previousRound,
  repoRoot = findRepoRoot(),
  reviewEvidencePath,
  reviewedAt,
  reviewer,
} = {}) {
  const subjectSha = validateCodeSubjectSha(codeSubjectSha);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError('Metric E round number must be a positive integer');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date ?? '')) {
    throw new TypeError('Metric E round date must be YYYY-MM-DD');
  }
  if (!Number.isFinite(Date.parse(reviewedAt ?? ''))) {
    throw new TypeError('Metric E reviewedAt must be one ISO timestamp');
  }
  for (const [label, value] of [
    ['reviewer', reviewer],
    ['reviewEvidencePath', reviewEvidencePath],
  ]) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new TypeError(`Metric E ${label} must be non-empty`);
    }
  }
  if (baseline?.schema !== 'kovo.escape-census-baseline/v1') {
    throw new TypeError('Metric E round requires kovo.escape-census-baseline/v1 evidence');
  }
  const report = structuredClone(baseline.report);
  const ceilings = loadCeilingsFromBaseline(baseline, repoRoot);
  const result = deriveRoundResult({ baseline, ceilings, previousRound, report });
  const reviewEvidence = reviewEvidenceRecord(reviewEvidencePath, repoRoot);
  return Object.freeze({
    number,
    codeSubjectSha: subjectSha,
    date,
    report: Object.freeze({
      schema: report.schema,
      sha256: sha256(canonicalJson(report)),
      snapshot: report,
    }),
    ceilings: Object.freeze({
      schema: ceilings.schema,
      sha256: sha256(canonicalJson(ceilings)),
      snapshot: ceilings,
    }),
    reviewer: Object.freeze({
      evidence: reviewEvidence,
      id: reviewer,
      independence: 'independent-review-pass',
      reviewedAt,
    }),
    predecessor: predecessor ?? null,
    result,
  });
}

function loadCeilingsFromBaseline(baseline, repoRoot) {
  const descriptor = baseline.predecessor;
  if (descriptor?.path !== './escape-budgets.previous.json') {
    throw new TypeError('Metric E baseline must retain its pinned predecessor descriptor');
  }
  const current = JSON.parse(
    readFileSync(path.join(repoRoot, 'security/escape-budgets.json'), 'utf8'),
  );
  if (current?.schema !== 'kovo.escape-budgets/v1') {
    throw new TypeError('Metric E current ceilings must use kovo.escape-budgets/v1');
  }
  return current;
}

function reviewEvidenceRecord(relativePath, repoRoot) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.split('/').includes('..')
  ) {
    throw new TypeError('Metric E review evidence must be one safe relative path');
  }
  return Object.freeze({
    path: relativePath,
    sha256: sha256(readFileSync(path.join(repoRoot, relativePath))),
  });
}

function deriveRoundResult({ baseline, ceilings, previousRound, report }) {
  const negativeIds = Array.isArray(baseline.negativeChecks)
    ? baseline.negativeChecks.map((entry) => entry?.id)
    : [];
  const provenanceWitnesses = ['missing-producer-provenance', 'wrong-producer-provenance'];
  if (!provenanceWitnesses.every((id) => negativeIds.includes(id))) {
    throw new Error('Metric E baseline lacks its producer-provenance negative controls');
  }
  return Object.freeze({
    ceilingIncreases:
      previousRound === undefined
        ? 0
        : countDoorIncreases(previousRound.ceilings.snapshot.packages, ceilings.packages),
    observedIncreases:
      previousRound === undefined
        ? 0
        : countDoorIncreases(
            packageDoorCounts(previousRound.report.snapshot),
            packageDoorCounts(report),
          ),
    unsignedEscapes: 0,
  });
}

export function buildMetricESeries({ rounds, repoRoot = findRepoRoot() } = {}) {
  const comparableRounds = Array.isArray(rounds) ? rounds : [];
  const comparability = buildMetricEComparability({ repoRoot });
  return Object.freeze({
    schema: metricERoundsSchema,
    subjectProtocol: SECURITY_EVIDENCE_SUBJECT_PROTOCOL,
    series: Object.freeze({
      id: 'metric-e-representative/v1',
      comparability,
    }),
    rounds: Object.freeze(comparableRounds),
    status: Object.freeze({
      completedComparableRounds: comparableRounds.length,
      remainingComparableRounds: Math.max(
        0,
        metricERequiredComparableRounds - comparableRounds.length,
      ),
      requiredComparableRounds: metricERequiredComparableRounds,
      verdict:
        comparableRounds.length >= metricERequiredComparableRounds
          ? 'round-count-complete'
          : 'waiting-for-independent-comparable-rounds',
    }),
  });
}

export function validateMetricESeries(document, { baseline, repoRoot = findRepoRoot() } = {}) {
  const findings = [];
  const currentBaseline =
    baseline ??
    JSON.parse(readFileSync(path.join(repoRoot, defaultEscapeCensusBaselinePath), 'utf8'));
  if (document?.schema !== metricERoundsSchema) {
    return result([`schema must be ${metricERoundsSchema}`]);
  }
  const rounds = Array.isArray(document.rounds) ? document.rounds : [];
  if (!Array.isArray(document.rounds) || rounds.length === 0) {
    findings.push('Metric E series must retain at least one reviewed baseline round');
  }
  if (rounds.length > metricERequiredComparableRounds) {
    findings.push('Metric E v1 series must stop after its three required comparable rounds');
  }
  const expectedShell = buildMetricESeries({ rounds, repoRoot });
  if (canonicalJson(document.subjectProtocol) !== canonicalJson(expectedShell.subjectProtocol)) {
    findings.push('Metric E code-subject/evidence-commit protocol drifted');
  }
  if (canonicalJson(document.series) !== canonicalJson(expectedShell.series)) {
    findings.push('Metric E comparability signature drifted; start a reviewed new series');
  }
  if (canonicalJson(document.status) !== canonicalJson(expectedShell.status)) {
    findings.push('Metric E round status does not match the retained round count');
  }

  const subjectShas = new Set();
  const reviewEvidenceKeys = new Set();
  let previous;
  for (const [index, round] of rounds.entries()) {
    const label = `Metric E round ${index + 1}`;
    if (round?.number !== index + 1) findings.push(`${label} has a non-consecutive number`);
    try {
      validateCodeSubjectSha(round?.codeSubjectSha, `${label}.codeSubjectSha`);
    } catch (error) {
      findings.push(error instanceof Error ? error.message : String(error));
    }
    if (subjectShas.has(round?.codeSubjectSha)) {
      findings.push(`${label} reuses a code subject and cannot count as another round`);
    }
    subjectShas.add(round?.codeSubjectSha);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(round?.date ?? '')) {
      findings.push(`${label} date must be YYYY-MM-DD`);
    }
    if (
      round?.reviewer?.independence !== 'independent-review-pass' ||
      typeof round?.reviewer?.id !== 'string' ||
      round.reviewer.id.trim() === '' ||
      !safeRelativePath(round?.reviewer?.evidence?.path) ||
      !/^[0-9a-f]{64}$/u.test(round?.reviewer?.evidence?.sha256 ?? '') ||
      !Number.isFinite(Date.parse(round?.reviewer?.reviewedAt ?? ''))
    ) {
      findings.push(`${label} lacks complete independent reviewer metadata`);
    } else {
      const evidenceKey = `${round.reviewer.evidence.path}#${round.reviewer.evidence.sha256}`;
      if (reviewEvidenceKeys.has(evidenceKey)) {
        findings.push(`${label} reuses prior review evidence and is not an independent round`);
      }
      reviewEvidenceKeys.add(evidenceKey);
      let evidenceSource;
      try {
        evidenceSource = readFileSync(path.join(repoRoot, round.reviewer.evidence.path));
      } catch {
        findings.push(`${label} review evidence file is not retained`);
      }
      if (
        evidenceSource !== undefined &&
        sha256(evidenceSource) !== round.reviewer.evidence.sha256
      ) {
        findings.push(`${label} review evidence digest drifted`);
      }
    }
    validateRoundDigest(round, label, findings);
    let expectedResult;
    try {
      expectedResult = deriveRoundResult({
        baseline: currentBaseline,
        ceilings: round?.ceilings?.snapshot,
        previousRound: previous,
        report: round?.report?.snapshot,
      });
    } catch (error) {
      findings.push(
        `${label} result cannot be derived: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (
      expectedResult !== undefined &&
      canonicalJson(round?.result) !== canonicalJson(expectedResult)
    ) {
      findings.push(`${label} result fields do not match the validated reports`);
    }
    if (
      round?.result?.unsignedEscapes !== 0 ||
      round?.result?.ceilingIncreases !== 0 ||
      round?.result?.observedIncreases !== 0
    ) {
      findings.push(
        `${label} must retain zero unsigned escapes, observed increases, and ceiling increases`,
      );
    }
    if (previous === undefined) {
      if (round?.predecessor !== null) findings.push(`${label} baseline predecessor must be null`);
    } else {
      const expectedPredecessor = predecessorFor(previous);
      if (canonicalJson(round?.predecessor) !== canonicalJson(expectedPredecessor)) {
        findings.push(`${label} predecessor does not bind the prior reviewed artifact`);
      }
      compareMonotoneRound(previous, round, label, findings);
      if (round.date < previous.date) findings.push(`${label} predates its predecessor`);
    }
    previous = round;
  }
  const latest = rounds.at(-1);
  if (
    latest !== undefined &&
    canonicalJson(latest.report.snapshot) !== canonicalJson(currentBaseline.report)
  ) {
    findings.push('latest Metric E round report differs from the current real-app baseline');
  }
  return result(findings, {
    completed: rounds.length,
    remaining: Math.max(0, metricERequiredComparableRounds - rounds.length),
    required: metricERequiredComparableRounds,
  });
}

function validateRoundDigest(round, label, findings) {
  if (
    round?.report?.schema !== 'kovo.escape-census/v1' ||
    round.report.sha256 !== sha256(canonicalJson(round.report.snapshot))
  ) {
    findings.push(`${label} report digest or schema drifted`);
  }
  if (
    round?.ceilings?.schema !== 'kovo.escape-budgets/v1' ||
    round.ceilings.sha256 !== sha256(canonicalJson(round.ceilings.snapshot))
  ) {
    findings.push(`${label} ceiling digest or schema drifted`);
  }
  const reportPackages = round?.report?.snapshot?.packages;
  const ceilingPackages = round?.ceilings?.snapshot?.packages;
  if (!Array.isArray(reportPackages) || !plainObject(ceilingPackages)) {
    findings.push(`${label} report and ceilings must expose package/door counts`);
    return;
  }
  for (const packageReport of reportPackages) {
    const limits = ceilingPackages[packageReport?.package];
    if (!plainObject(limits)) {
      findings.push(`${label} report names a package without ceilings`);
      continue;
    }
    for (const door of ESCAPE_CENSUS_DOORS) {
      const observed = packageReport?.doors?.[door];
      const roots = packageReport?.roots?.[door];
      const ceiling = limits[door];
      if (
        !Number.isSafeInteger(observed) ||
        !Array.isArray(roots) ||
        roots.length !== observed ||
        !Number.isSafeInteger(ceiling) ||
        observed > ceiling
      ) {
        findings.push(`${label} ${packageReport.package}/${door} exceeds or lacks its ceiling`);
      }
    }
  }
}

function compareMonotoneRound(previous, current, label, findings) {
  const priorPackages = previous.ceilings.snapshot.packages;
  const currentPackages = current.ceilings.snapshot.packages;
  if (
    canonicalJson(Object.keys(currentPackages).sort()) !==
    canonicalJson(Object.keys(priorPackages).sort())
  ) {
    findings.push(`${label} package denominator changed without a new series`);
    return;
  }
  for (const packageName of Object.keys(priorPackages)) {
    for (const door of ESCAPE_CENSUS_DOORS) {
      if (currentPackages[packageName]?.[door] > priorPackages[packageName]?.[door]) {
        findings.push(`${label} raises ${packageName}/${door} above its predecessor`);
      }
    }
  }
  const priorObserved = packageDoorCounts(previous.report.snapshot);
  const currentObserved = packageDoorCounts(current.report.snapshot);
  if (
    canonicalJson(Object.keys(currentObserved).sort()) !==
    canonicalJson(Object.keys(priorObserved).sort())
  ) {
    findings.push(`${label} observed package denominator changed without a new series`);
    return;
  }
  for (const packageName of Object.keys(priorObserved)) {
    for (const door of ESCAPE_CENSUS_DOORS) {
      if (currentObserved[packageName]?.[door] > priorObserved[packageName]?.[door]) {
        findings.push(`${label} increases observed ${packageName}/${door} escaped roots`);
      }
    }
  }
}

function packageDoorCounts(report) {
  return Object.fromEntries((report?.packages ?? []).map((entry) => [entry.package, entry.doors]));
}

function countDoorIncreases(previousPackages, currentPackages) {
  let increases = 0;
  for (const [packageName, previousDoors] of Object.entries(previousPackages ?? {})) {
    const currentDoors = currentPackages?.[packageName];
    for (const door of ESCAPE_CENSUS_DOORS) {
      if (currentDoors?.[door] > previousDoors?.[door]) increases += 1;
    }
  }
  return increases;
}

function predecessorFor(round) {
  return Object.freeze({
    codeSubjectSha: round.codeSubjectSha,
    reportSha256: round.report.sha256,
    round: round.number,
  });
}

export function appendMetricERound({
  codeSubjectSha,
  date,
  historicalSubject = false,
  ledger,
  repoRoot = findRepoRoot(),
  reviewEvidence,
  reviewedAt,
  reviewer,
} = {}) {
  if (historicalSubject) {
    assertHistoricalCodeSubjectMatches({
      paths: metricEHistoricalSubjectPaths,
      repoRoot,
      subjectSha: codeSubjectSha,
    });
  } else {
    assertCleanCurrentCodeSubject({ repoRoot, subjectSha: codeSubjectSha });
  }
  const existingRounds = ledger?.rounds ?? [];
  const currentComparability = buildMetricEComparability({ repoRoot });
  if (
    ledger !== undefined &&
    canonicalJson(ledger?.series?.comparability) !== canonicalJson(currentComparability)
  ) {
    throw new Error('Metric E comparability changed; start a reviewed new series');
  }
  const baseline = JSON.parse(
    readFileSync(path.join(repoRoot, defaultEscapeCensusBaselinePath), 'utf8'),
  );
  const previous = existingRounds.at(-1);
  const round = buildMetricERound({
    baseline,
    codeSubjectSha,
    date,
    number: existingRounds.length + 1,
    predecessor: previous === undefined ? null : predecessorFor(previous),
    previousRound: previous,
    repoRoot,
    reviewEvidencePath: reviewEvidence,
    reviewedAt,
    reviewer,
  });
  const document = buildMetricESeries({ rounds: [...existingRounds, round], repoRoot });
  const check = validateMetricESeries(document, { baseline, repoRoot });
  if (!check.ok) throw new Error(check.findings.join('\n'));
  return document;
}

async function main() {
  const root = findRepoRoot();
  const ledgerPath = path.join(root, defaultMetricERoundsPath);
  const args = process.argv.slice(2);
  if (args.length > 0) {
    const appendOptions = parseExactCliArguments(args, {
      command: '--append',
      optionalFlags: ['--historical-subject'],
      valueFlags: [
        '--subject-sha',
        '--date',
        '--reviewer',
        '--reviewed-at',
        '--review-evidence-path',
      ],
    });
    const ledger = existsLedger(ledgerPath)
      ? JSON.parse(readFileSync(ledgerPath, 'utf8'))
      : undefined;
    const document = appendMetricERound({
      codeSubjectSha: appendOptions['subject-sha'],
      date: appendOptions.date,
      historicalSubject: appendOptions['historical-subject'] === true,
      ledger,
      repoRoot: root,
      reviewEvidence: appendOptions['review-evidence-path'],
      reviewedAt: appendOptions['reviewed-at'],
      reviewer: appendOptions.reviewer,
    });
    writeFileSync(ledgerPath, canonicalJson(document), 'utf8');
  }
  const document = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const check = validateMetricESeries(document, { repoRoot: root });
  if (!check.ok) throw new Error(check.findings.join('\n'));
  process.stdout.write(
    `${metricERoundsSchema} rounds=${check.summary.completed}/${check.summary.required} remaining=${check.summary.remaining} unsigned=0 ceiling-increases=0 OK\n`,
  );
}

function existsLedger(ledgerPath) {
  try {
    readFileSync(ledgerPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeRelativePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !value.split('/').includes('..')
  );
}

function result(findings, summary = {}) {
  return { findings, ok: findings.length === 0, summary };
}

if (isMainEntry(import.meta.url)) await runGate(main);
