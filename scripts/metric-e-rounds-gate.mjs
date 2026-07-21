#!/usr/bin/env node
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { ESCAPE_CENSUS_DOORS } from './escape-census-gate.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';
import {
  assertHistoricalCodeSubjectMatches,
  buildSourceSet,
  buildSourceSetAtCodeSubject,
  canonicalJson,
  parseExactCliArguments,
  readFileAtCodeSubject,
  SECURITY_EVIDENCE_SUBJECT_PROTOCOL,
  sha256,
  validateCodeSubjectSha,
} from './lib/security-evidence-subject.mjs';

export const metricERoundsSchema = 'kovo.metric-e-round-series/v1';
export const metricEIndependentReviewSchema = 'kovo.metric-e-independent-review/v1';
export const defaultMetricERoundsPath = 'security/metric-e-rounds.json';
export const defaultEscapeCensusBaselinePath = 'security/escape-census-baseline.json';
export const metricERequiredComparableRounds = 3;
export const metricEComparabilityInputPaths = Object.freeze([
  'scripts/escape-census-baseline.mjs',
  'scripts/escape-census-gate.mjs',
  'scripts/metric-e-rounds-gate.mjs',
  'security/escape-census-config.json',
]);
export const metricEHistoricalSubjectPaths = Object.freeze([
  'packages/core/src/graph.ts',
  'packages/drizzle/src/trust-escapes-static.ts',
  'scripts/escape-census-baseline.mjs',
  'scripts/escape-census-baseline.test.mjs',
  'scripts/escape-census-gate.mjs',
  'scripts/metric-e-rounds-gate.mjs',
  'security/escape-budgets.json',
  'security/escape-census-baseline.json',
  'security/escape-census-config.json',
  'security/fixtures/escape-census-real-app/app.tsx',
  'security/fixtures/escape-census-real-app/index.html',
  'security/fixtures/escape-census-real-app/package.json',
  'security/fixtures/escape-census-real-app/src/client.ts',
  'security/fixtures/escape-census-real-app/src/style.css',
  'security/fixtures/escape-census-real-app/src/style.d.ts',
  'security/fixtures/escape-census-real-app/tsconfig.json',
]);
export const metricEComparableCorpusPaths = Object.freeze([
  'security/fixtures/escape-census-real-app/app.tsx',
  'security/fixtures/escape-census-real-app/index.html',
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
    'producer coverage proves census derivation only; until each root joins to a verified detached review signature, it remains unsigned',
});
const metricEReviewedAtPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export function buildMetricEComparability({ repoRoot = findRepoRoot() } = {}) {
  const buildSources = (paths) => buildSourceSet({ paths, repoRoot });
  return buildMetricEComparabilityWithSources(buildSources);
}

export function buildMetricEComparabilityAtCodeSubject({
  codeSubjectSha,
  repoRoot = findRepoRoot(),
} = {}) {
  const subjectSha = validateCodeSubjectSha(codeSubjectSha);
  const buildSources = (paths) => buildSourceSetAtCodeSubject({ paths, repoRoot, subjectSha });
  return buildMetricEComparabilityWithSources(buildSources);
}

function buildMetricEComparabilityWithSources(buildSources) {
  const value = Object.freeze({
    appCorpus: Object.freeze({
      id: 'metric-e-representative/v1',
      sources: buildSources(metricEComparableCorpusPaths),
    }),
    censusSchema: 'kovo.escape-census/v1',
    countingRule: metricECountingRule,
    doorVocabulary: Object.freeze({
      values: ESCAPE_CENSUS_DOORS,
      sha256: sha256(canonicalJson(ESCAPE_CENSUS_DOORS)),
    }),
    measurementInputs: Object.freeze({
      sources: buildSources(metricEComparabilityInputPaths),
    }),
  });
  return Object.freeze({ ...value, sha256: sha256(canonicalJson(value)) });
}

export function buildMetricERound({
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
  if (reviewer !== undefined || reviewedAt !== undefined) {
    throw new TypeError(
      'Metric E reviewer identity and time must come from the structured review artifact',
    );
  }
  if (typeof reviewEvidencePath !== 'string' || reviewEvidencePath.trim() === '') {
    throw new TypeError('Metric E reviewEvidencePath must be non-empty');
  }
  const baseline = readJsonAtCodeSubject({
    relativePath: defaultEscapeCensusBaselinePath,
    repoRoot,
    subjectSha,
  });
  if (baseline?.schema !== 'kovo.escape-census-baseline/v1') {
    throw new TypeError('Metric E round requires kovo.escape-census-baseline/v1 evidence');
  }
  const report = structuredClone(baseline.report);
  const ceilings = loadCeilingsAtCodeSubject({ baseline, repoRoot, subjectSha });
  const result = deriveRoundResult({ baseline, ceilings, previousRound, report });
  const reviewEvidence = readIndependentReviewArtifact(reviewEvidencePath, repoRoot);
  assertIndependentReviewBindings(reviewEvidence.document, {
    ceilingSha256: sha256(canonicalJson(ceilings)),
    codeSubjectSha: subjectSha,
    number,
    reportSha256: sha256(canonicalJson(report)),
  });
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
      evidence: Object.freeze({ path: reviewEvidence.path, sha256: reviewEvidence.sha256 }),
      id: reviewEvidence.document.reviewer.id,
      independence: 'independent-review-pass',
      reviewedAt: reviewEvidence.document.reviewer.reviewedAt,
      verdict: reviewEvidence.document.verdict,
    }),
    predecessor: predecessor ?? null,
    result,
  });
}

export function buildMetricEIndependentReviewArtifact({
  ceilingSha256,
  codeSubjectSha,
  number,
  reportSha256,
  reviewedAt,
  reviewer,
  verdict,
} = {}) {
  const subjectSha = validateCodeSubjectSha(codeSubjectSha);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError('Metric E independent-review round must be a positive integer');
  }
  for (const [label, value] of [
    ['reportSha256', reportSha256],
    ['ceilingSha256', ceilingSha256],
  ]) {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
      throw new TypeError(`Metric E independent-review ${label} must be one SHA-256 digest`);
    }
  }
  if (typeof reviewer !== 'string' || reviewer.trim() === '') {
    throw new TypeError('Metric E independent-review reviewer must be non-empty');
  }
  if (
    !metricEReviewedAtPattern.test(reviewedAt ?? '') ||
    !Number.isFinite(Date.parse(reviewedAt ?? ''))
  ) {
    throw new TypeError('Metric E independent-review reviewedAt must be one UTC ISO timestamp');
  }
  if (verdict !== 'accept' && verdict !== 'reject') {
    throw new TypeError('Metric E independent-review verdict must be accept or reject');
  }
  return Object.freeze({
    schema: metricEIndependentReviewSchema,
    subject: Object.freeze({ codeSubjectSha: subjectSha }),
    round: Object.freeze({ ceilingSha256, number, reportSha256 }),
    reviewer: Object.freeze({ id: reviewer, reviewedAt }),
    verdict,
  });
}

export function validateMetricEIndependentReviewArtifact(document, expected = {}) {
  const findings = [];
  let normalized;
  try {
    normalized = buildMetricEIndependentReviewArtifact({
      ceilingSha256: document?.round?.ceilingSha256,
      codeSubjectSha: document?.subject?.codeSubjectSha,
      number: document?.round?.number,
      reportSha256: document?.round?.reportSha256,
      reviewedAt: document?.reviewer?.reviewedAt,
      reviewer: document?.reviewer?.id,
      verdict: document?.verdict,
    });
  } catch (error) {
    findings.push(error instanceof Error ? error.message : String(error));
    return result(findings);
  }
  if (document?.schema !== metricEIndependentReviewSchema) {
    findings.push(`independent review schema must be ${metricEIndependentReviewSchema}`);
  }
  if (canonicalJson(document) !== canonicalJson(normalized)) {
    findings.push('independent review artifact has unknown or noncanonical fields');
  }
  for (const [label, actual, wanted] of [
    ['code subject', normalized.subject.codeSubjectSha, expected.codeSubjectSha],
    ['round number', normalized.round.number, expected.number],
    ['report digest', normalized.round.reportSha256, expected.reportSha256],
    ['ceiling digest', normalized.round.ceilingSha256, expected.ceilingSha256],
  ]) {
    if (wanted !== undefined && actual !== wanted) {
      findings.push(`independent review ${label} does not bind the reviewed round`);
    }
  }
  if (expected.requireAccepted === true && normalized.verdict !== 'accept') {
    findings.push('independent review verdict must explicitly accept the round');
  }
  return result(findings);
}

function assertIndependentReviewBindings(document, expected) {
  const check = validateMetricEIndependentReviewArtifact(document, {
    ...expected,
    requireAccepted: true,
  });
  if (!check.ok) throw new TypeError(check.findings.join('\n'));
}

function readJsonAtCodeSubject({ relativePath, repoRoot, subjectSha }) {
  const source = readFileAtCodeSubject({ relativePath, repoRoot, subjectSha });
  try {
    return JSON.parse(source.toString('utf8'));
  } catch (error) {
    throw new TypeError(
      `${relativePath} at ${subjectSha} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function loadCeilingsAtCodeSubject({ baseline, repoRoot, subjectSha }) {
  const descriptor = baseline.predecessor;
  if (descriptor?.path !== './escape-budgets.previous.json') {
    throw new TypeError('Metric E baseline must retain its pinned predecessor descriptor');
  }
  const current = readJsonAtCodeSubject({
    relativePath: 'security/escape-budgets.json',
    repoRoot,
    subjectSha,
  });
  if (current?.schema !== 'kovo.escape-budgets/v1') {
    throw new TypeError('Metric E current ceilings must use kovo.escape-budgets/v1');
  }
  return current;
}

function readIndependentReviewArtifact(relativePath, repoRoot) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.includes(':') ||
    relativePath.split('/').includes('..')
  ) {
    throw new TypeError('Metric E review evidence must be one safe relative path');
  }
  if (!relativePath.startsWith('security/reviews/metric-e/') || !relativePath.endsWith('.json')) {
    throw new TypeError(
      'Metric E review evidence must be a JSON artifact under security/reviews/metric-e/',
    );
  }
  const absolutePath = path.join(repoRoot, relativePath);
  const stats = lstatSync(absolutePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new TypeError('Metric E review evidence must be one retained regular file');
  }
  const source = readFileSync(absolutePath);
  let document;
  try {
    document = JSON.parse(source.toString('utf8'));
  } catch (error) {
    throw new TypeError(
      `Metric E review evidence must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return Object.freeze({
    document,
    path: relativePath,
    sha256: sha256(source),
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
  const observedEscapes = totalObservedEscapes(report);
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
    observedEscapes,
    reviewedEscapeSignatures: 0,
    signatureCoverage: 'unresolved: producer provenance is not a detached escape-review signature',
    unsignedEscapes: observedEscapes,
  });
}

function totalObservedEscapes(report) {
  return (report?.packages ?? []).reduce(
    (total, packageReport) =>
      total +
      ESCAPE_CENSUS_DOORS.reduce(
        (packageTotal, door) => packageTotal + (packageReport?.roots?.[door]?.length ?? 0),
        0,
      ),
    0,
  );
}

export function buildMetricESeries({ rounds, repoRoot = findRepoRoot() } = {}) {
  const comparableRounds = Array.isArray(rounds) ? rounds : [];
  const comparability = buildMetricEComparability({ repoRoot });
  const qualifyingComparableRounds = trailingQualifyingMetricERounds(comparableRounds);
  return Object.freeze({
    schema: metricERoundsSchema,
    subjectProtocol: SECURITY_EVIDENCE_SUBJECT_PROTOCOL,
    series: Object.freeze({
      id: 'metric-e-representative/v1',
      comparability,
    }),
    rounds: Object.freeze(comparableRounds),
    status: Object.freeze({
      completedComparableRounds: qualifyingComparableRounds,
      observedRounds: comparableRounds.length,
      qualifyingComparableRounds,
      remainingComparableRounds: Math.max(
        0,
        metricERequiredComparableRounds - qualifyingComparableRounds,
      ),
      requiredComparableRounds: metricERequiredComparableRounds,
      verdict:
        qualifyingComparableRounds >= metricERequiredComparableRounds
          ? 'round-count-complete'
          : comparableRounds.some((round) => round?.result?.unsignedEscapes !== 0)
            ? 'waiting-for-signed-comparable-rounds'
            : 'waiting-for-independent-comparable-rounds',
    }),
  });
}

function trailingQualifyingMetricERounds(rounds) {
  let count = 0;
  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const result = rounds[index]?.result;
    if (
      result?.unsignedEscapes !== 0 ||
      result?.ceilingIncreases !== 0 ||
      result?.observedIncreases !== 0
    ) {
      break;
    }
    count += 1;
  }
  return count;
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
    let subjectBaseline;
    let subjectCeilings;
    if (round?.number !== index + 1) findings.push(`${label} has a non-consecutive number`);
    try {
      const subjectSha = validateCodeSubjectSha(round?.codeSubjectSha, `${label}.codeSubjectSha`);
      const subjectComparability = buildMetricEComparabilityAtCodeSubject({
        codeSubjectSha: subjectSha,
        repoRoot,
      });
      if (canonicalJson(document.series?.comparability) !== canonicalJson(subjectComparability)) {
        findings.push(`${label} code subject does not retain the fixed Metric E inputs`);
      }
      subjectBaseline = readJsonAtCodeSubject({
        relativePath: defaultEscapeCensusBaselinePath,
        repoRoot,
        subjectSha,
      });
      subjectCeilings = loadCeilingsAtCodeSubject({
        baseline: subjectBaseline,
        repoRoot,
        subjectSha,
      });
      if (canonicalJson(round?.report?.snapshot) !== canonicalJson(subjectBaseline?.report)) {
        findings.push(`${label} report is not the exact baseline report retained by its subject`);
      }
      if (canonicalJson(round?.ceilings?.snapshot) !== canonicalJson(subjectCeilings)) {
        findings.push(`${label} ceilings are not the exact escape budgets retained by its subject`);
      }
    } catch (error) {
      findings.push(
        `${label} code subject cannot be verified: ${error instanceof Error ? error.message : String(error)}`,
      );
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
      round?.reviewer?.verdict !== 'accept' ||
      typeof round?.reviewer?.id !== 'string' ||
      round.reviewer.id.trim() === '' ||
      !safeRelativePath(round?.reviewer?.evidence?.path) ||
      !/^[0-9a-f]{64}$/u.test(round?.reviewer?.evidence?.sha256 ?? '') ||
      !metricEReviewedAtPattern.test(round?.reviewer?.reviewedAt ?? '') ||
      !Number.isFinite(Date.parse(round?.reviewer?.reviewedAt ?? ''))
    ) {
      findings.push(`${label} lacks complete independent reviewer metadata`);
    } else {
      const evidenceKey = `${round.reviewer.evidence.path}#${round.reviewer.evidence.sha256}`;
      if (reviewEvidenceKeys.has(evidenceKey)) {
        findings.push(`${label} reuses prior review evidence and is not an independent round`);
      }
      reviewEvidenceKeys.add(evidenceKey);
      let evidenceRecord;
      try {
        evidenceRecord = readIndependentReviewArtifact(round.reviewer.evidence.path, repoRoot);
      } catch (error) {
        findings.push(
          `${label} review evidence is not a retained structured artifact: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (
        evidenceRecord !== undefined &&
        evidenceRecord.sha256 !== round.reviewer.evidence.sha256
      ) {
        findings.push(`${label} review evidence digest drifted`);
      }
      if (evidenceRecord !== undefined) {
        const reviewCheck = validateMetricEIndependentReviewArtifact(evidenceRecord.document, {
          ceilingSha256: round?.ceilings?.sha256,
          codeSubjectSha: round?.codeSubjectSha,
          number: round?.number,
          reportSha256: round?.report?.sha256,
          requireAccepted: true,
        });
        findings.push(...reviewCheck.findings.map((finding) => `${label} ${finding}`));
        if (
          evidenceRecord.document?.reviewer?.id !== round.reviewer.id ||
          evidenceRecord.document?.reviewer?.reviewedAt !== round.reviewer.reviewedAt ||
          evidenceRecord.document?.verdict !== round.reviewer.verdict
        ) {
          findings.push(`${label} reviewer metadata differs from its structured review artifact`);
        }
      }
    }
    validateRoundDigest(round, label, findings);
    let expectedResult;
    try {
      expectedResult = deriveRoundResult({
        baseline: subjectBaseline,
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
    if (round?.result?.ceilingIncreases !== 0 || round?.result?.observedIncreases !== 0) {
      findings.push(`${label} must retain zero observed and ceiling increases`);
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
  if (latest !== undefined) {
    const currentCeilings = JSON.parse(
      readFileSync(path.join(repoRoot, 'security/escape-budgets.json'), 'utf8'),
    );
    if (canonicalJson(latest.ceilings.snapshot) !== canonicalJson(currentCeilings)) {
      findings.push('latest Metric E round ceilings differ from the current escape budgets');
    }
  }
  return result(findings, {
    completed: expectedShell.status.qualifyingComparableRounds,
    observed: rounds.length,
    remaining: expectedShell.status.remainingComparableRounds,
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
    ceilingSha256: round.ceilings.sha256,
    codeSubjectSha: round.codeSubjectSha,
    reportSha256: round.report.sha256,
    reviewEvidenceSha256: round.reviewer.evidence.sha256,
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
} = {}) {
  if (historicalSubject) {
    assertHistoricalCodeSubjectMatches({
      paths: metricEHistoricalSubjectPaths,
      repoRoot,
      subjectSha: codeSubjectSha,
    });
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
    codeSubjectSha,
    date,
    number: existingRounds.length + 1,
    predecessor: previous === undefined ? null : predecessorFor(previous),
    previousRound: previous,
    repoRoot,
    reviewEvidencePath: reviewEvidence,
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
      valueFlags: ['--subject-sha', '--date', '--review-evidence-path'],
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
    });
    writeFileSync(ledgerPath, canonicalJson(document), 'utf8');
  }
  const document = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const check = validateMetricESeries(document, { repoRoot: root });
  if (!check.ok) throw new Error(check.findings.join('\n'));
  process.stdout.write(
    `${metricERoundsSchema} observed=${check.summary.observed} qualifying=${check.summary.completed}/${check.summary.required} remaining=${check.summary.remaining} unsigned=${document.rounds.at(-1)?.result?.unsignedEscapes ?? 'unresolved'} ceiling-increases=0 OK\n`,
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
