#!/usr/bin/env node
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { ESCAPE_CENSUS_DOORS } from './escape-census-gate.mjs';
import { verifyEd25519Spki } from './kovo-certificate-signature.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';
import {
  assertCodeSubjectDescendsFrom,
  assertHistoricalCodeSubjectMatches,
  assertHistoricalSourceTreesMatch,
  buildSourceSet,
  buildSourceSetAtCodeSubject,
  buildSourceTreeSet,
  buildSourceTreeSetAtCodeSubject,
  canonicalJson,
  parseExactCliArguments,
  readFileAtCodeSubject,
  SECURITY_EVIDENCE_SUBJECT_PROTOCOL,
  sha256,
  validateCodeSubjectSha,
} from './lib/security-evidence-subject.mjs';

export const metricERoundsSchema = 'kovo.metric-e-round-series/v2';
export const metricEIndependentReviewSchema = 'kovo.metric-e-independent-review/v2';
export const metricEEscapeReviewsSchema = 'kovo.escape-census-reviews/v1';
export const defaultMetricERoundsPath = 'security/metric-e-rounds.json';
export const defaultEscapeCensusBaselinePath = 'security/escape-census-baseline.json';
export const metricERequiredComparableRounds = 3;
export const metricEComparabilityInputPaths = Object.freeze([
  'package.json',
  'packages/better-auth/package.json',
  'packages/browser/package.json',
  'packages/cli/package.json',
  'packages/cli/src/commands/build-export.ts',
  'packages/cli/src/escape-census-review-subjects.ts',
  'packages/compiler/package.json',
  'packages/compiler/src/scan/security-abstract-interpreter-census.v1.json',
  'packages/compiler/src/scan/security-abstract-interpreter.ts',
  'packages/compiler/src/scan/security-operation-ir.ts',
  'packages/compiler/src/security-operation-facts.ts',
  'packages/core/package.json',
  'packages/core/src/internal/framework-identity.ts',
  'packages/core/src/internal/json.ts',
  'packages/core/src/internal/security-operation-ir.ts',
  'packages/devtool/package.json',
  'packages/drizzle/package.json',
  'packages/drizzle/src/static/framework-identity.ts',
  'packages/drizzle/src/trust-escapes-static.ts',
  'packages/headless-ui/package.json',
  'packages/icons/package.json',
  'packages/server/package.json',
  'packages/server/src/escape-census-review.ts',
  'packages/style/package.json',
  'packages/ui/package.json',
  'packages/verify/package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'scripts/escape-census-baseline.mjs',
  'scripts/escape-census-gate.mjs',
  'scripts/lib/cli-entry.mjs',
  'scripts/lib/repo-root.mjs',
  'scripts/lib/security-evidence-subject.mjs',
  'scripts/metric-e-rounds-gate.mjs',
  'security/escape-census-config.json',
  'tsconfig.json',
]);
export const metricEComparabilityInputRoots = Object.freeze([
  'packages/better-auth/src',
  'packages/browser/src',
  'packages/cli/src',
  'packages/compiler/src',
  'packages/core/src',
  'packages/devtool/src',
  'packages/drizzle/src',
  'packages/headless-ui/src',
  'packages/icons/src',
  'packages/server/src',
  'packages/style/src',
  'packages/ui/src',
  'packages/verify/src',
]);
export const metricEHistoricalSubjectPaths = Object.freeze([
  ...metricEComparabilityInputPaths,
  'packages/core/src/graph.ts',
  'scripts/escape-census-baseline.test.mjs',
  'security/escape-budgets.json',
  'security/escape-census-baseline.json',
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
export const metricEComparableCorpusRoots = Object.freeze([
  'security/fixtures/escape-census-real-app',
]);
const metricEComparableAppSourceRoots = Object.freeze({
  '@kovojs/security-metric-e-app\0metric-e-representative':
    'security/fixtures/escape-census-real-app',
});

const metricECountingRule = Object.freeze({
  id: 'distinct-reachable-root-per-package-door/v2',
  rule: 'count each source-derived reachable root once per app and escape door, then count each app/root tuple once per package and door',
  unsignedEscapeRule:
    'producer coverage proves census derivation only; until each root joins to a verified detached review signature, it remains unsigned',
});
const metricEReviewedAtPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const metricEDigestPattern = /^sha256:[a-f0-9]{64}$/u;
const metricEKeyIdPattern = /^[A-Za-z0-9_-]{1,256}$/u;

export function buildMetricEComparability({ repoRoot = findRepoRoot() } = {}) {
  const buildSources = (paths) => buildSourceSet({ paths, repoRoot });
  const buildSourceTrees = (roots) => buildSourceTreeSet({ repoRoot, roots });
  return buildMetricEComparabilityWithSources(buildSources, buildSourceTrees);
}

export function buildMetricEComparabilityAtCodeSubject({
  codeSubjectSha,
  repoRoot = findRepoRoot(),
} = {}) {
  const subjectSha = validateCodeSubjectSha(codeSubjectSha);
  const buildSources = (paths) => buildSourceSetAtCodeSubject({ paths, repoRoot, subjectSha });
  const buildSourceTrees = (roots) =>
    buildSourceTreeSetAtCodeSubject({ repoRoot, roots, subjectSha });
  return buildMetricEComparabilityWithSources(buildSources, buildSourceTrees);
}

function buildMetricEComparabilityWithSources(buildSources, buildSourceTrees) {
  const value = Object.freeze({
    appCorpus: Object.freeze({
      id: 'metric-e-representative/v2',
      sources: buildSources(metricEComparableCorpusPaths),
      sourceTrees: buildSourceTrees(metricEComparableCorpusRoots),
    }),
    censusSchema: 'kovo.escape-census/v2',
    countingRule: metricECountingRule,
    doorVocabulary: Object.freeze({
      values: ESCAPE_CENSUS_DOORS,
      sha256: sha256(canonicalJson(ESCAPE_CENSUS_DOORS)),
    }),
    measurementInputs: Object.freeze({
      sources: buildSources(metricEComparabilityInputPaths),
      sourceTrees: buildSourceTrees(metricEComparabilityInputRoots),
    }),
  });
  return Object.freeze({ ...value, sha256: sha256(canonicalJson(value)) });
}

export function buildMetricERound({
  codeSubjectSha,
  date,
  escapeReviewEvidencePath,
  escapeReviewTrustAnchor,
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
  if (!validMetricERoundDate(date)) {
    throw new TypeError('Metric E round date must be a real YYYY-MM-DD calendar date');
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
  if (baseline?.schema !== 'kovo.escape-census-baseline/v2') {
    throw new TypeError('Metric E round requires kovo.escape-census-baseline/v2 evidence');
  }
  const report = structuredClone(baseline.report);
  const ceilings = loadCeilingsAtCodeSubject({ baseline, repoRoot, subjectSha });
  const escapeReviews = readMetricEEscapeReviewEvidence({
    baseline,
    codeSubjectSha: subjectSha,
    relativePath: escapeReviewEvidencePath,
    repoRoot,
    trustAnchorFingerprint: escapeReviewTrustAnchor,
  });
  const result = deriveRoundResult({
    baseline,
    ceilings,
    cryptographicallyValidEscapeSignatures: escapeReviews?.verified ?? 0,
    previousRound,
    report,
  });
  const reviewEvidence = readIndependentReviewArtifact(reviewEvidencePath, repoRoot);
  assertIndependentReviewBindings(reviewEvidence.document, {
    ceilingSha256: sha256(canonicalJson(ceilings)),
    codeSubjectSha: subjectSha,
    escapeReviewSha256: escapeReviews?.sha256 ?? null,
    escapeReviewTrustAnchor: escapeReviews?.trustAnchorFingerprint ?? null,
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
    escapeReviews:
      escapeReviews === undefined
        ? null
        : Object.freeze({
            authentication: 'caller-supplied-unverified',
            path: escapeReviews.path,
            sha256: escapeReviews.sha256,
            trustAnchorFingerprint: escapeReviews.trustAnchorFingerprint,
          }),
    reviewer: Object.freeze({
      authentication: 'none',
      evidence: Object.freeze({ path: reviewEvidence.path, sha256: reviewEvidence.sha256 }),
      id: reviewEvidence.document.reviewer.id,
      independence: 'declared-independent-unverified',
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
  escapeReviewSha256 = null,
  escapeReviewTrustAnchor = null,
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
  if (
    (escapeReviewSha256 === null) !== (escapeReviewTrustAnchor === null) ||
    (escapeReviewSha256 !== null &&
      (typeof escapeReviewSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(escapeReviewSha256))) ||
    (escapeReviewTrustAnchor !== null &&
      (typeof escapeReviewTrustAnchor !== 'string' ||
        !metricEDigestPattern.test(escapeReviewTrustAnchor)))
  ) {
    throw new TypeError(
      'Metric E independent-review escape evidence digest and trust anchor must be paired',
    );
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
    authentication: 'none',
    schema: metricEIndependentReviewSchema,
    subject: Object.freeze({ codeSubjectSha: subjectSha }),
    round: Object.freeze({
      ceilingSha256,
      escapeReviewSha256,
      escapeReviewTrustAnchor,
      number,
      reportSha256,
    }),
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
      escapeReviewSha256: document?.round?.escapeReviewSha256,
      escapeReviewTrustAnchor: document?.round?.escapeReviewTrustAnchor,
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
    ['escape-review digest', normalized.round.escapeReviewSha256, expected.escapeReviewSha256],
    [
      'escape-review trust anchor',
      normalized.round.escapeReviewTrustAnchor,
      expected.escapeReviewTrustAnchor,
    ],
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
  if (!safeRelativePath(relativePath)) {
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

function readMetricEEscapeReviewEvidence({
  baseline,
  codeSubjectSha,
  relativePath,
  repoRoot,
  trustAnchorFingerprint,
}) {
  const expectedSubjects = metricEExpectedReviewSubjects(baseline, {
    codeSubjectSha,
    repoRoot,
  });
  if (relativePath === undefined && trustAnchorFingerprint === undefined) return undefined;
  if (
    typeof relativePath !== 'string' ||
    typeof trustAnchorFingerprint !== 'string' ||
    !metricEDigestPattern.test(trustAnchorFingerprint)
  ) {
    throw new TypeError('Metric E escape-review path and trust anchor must be supplied together');
  }
  if (
    !safeRelativePath(relativePath) ||
    !relativePath.startsWith('security/reviews/metric-e/') ||
    !relativePath.endsWith('.escape-reviews.json')
  ) {
    throw new TypeError(
      'Metric E escape reviews must be a retained *.escape-reviews.json file under security/reviews/metric-e/',
    );
  }
  const absolutePath = path.join(repoRoot, relativePath);
  const stats = lstatSync(absolutePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 8 * 1024 * 1024) {
    throw new TypeError('Metric E escape-review evidence must be one bounded regular file');
  }
  const source = readFileSync(absolutePath);
  let document;
  try {
    document = JSON.parse(source.toString('utf8'));
  } catch (error) {
    throw new TypeError(
      `Metric E escape-review evidence must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    !exactObjectKeys(document, ['reviews', 'schema']) ||
    document.schema !== metricEEscapeReviewsSchema ||
    !Array.isArray(document.reviews) ||
    document.reviews.length !== expectedSubjects.length ||
    document.reviews.length > 4_096
  ) {
    throw new TypeError('Metric E escape-review evidence has a non-exact schema or count');
  }

  const expectedBySubject = new Map(
    expectedSubjects.map((subject) => [canonicalMetricEReviewJson(subject), subject]),
  );
  const consumed = new Set();
  for (const [index, envelope] of document.reviews.entries()) {
    if (
      !exactObjectKeys(envelope, [
        'keyId',
        'publicKeySpki',
        'signature',
        'subject',
        'trustAnchorFingerprint',
      ]) ||
      typeof envelope.keyId !== 'string' ||
      !metricEKeyIdPattern.test(envelope.keyId) ||
      typeof envelope.publicKeySpki !== 'string' ||
      typeof envelope.signature !== 'string' ||
      envelope.trustAnchorFingerprint !== trustAnchorFingerprint
    ) {
      throw new TypeError(`Metric E escape-review envelope ${index} is malformed`);
    }
    const subject = snapshotMetricEReviewSubject(envelope.subject);
    const subjectKey = canonicalMetricEReviewJson(subject);
    if (!expectedBySubject.has(subjectKey) || consumed.has(subjectKey)) {
      throw new TypeError(`Metric E escape-review envelope ${index} is surplus or duplicated`);
    }
    strictBase64url(envelope.publicKeySpki, 1_024, 'public key');
    const signature = strictBase64url(envelope.signature, 128, 'signature');
    let observedTrustAnchor;
    try {
      observedTrustAnchor = metricETrustAnchorFingerprint(envelope.publicKeySpki);
    } catch {
      throw new TypeError(`Metric E escape-review envelope ${index} has a malformed public key`);
    }
    if (signature.length !== 64 || observedTrustAnchor !== trustAnchorFingerprint) {
      throw new TypeError(`Metric E escape-review envelope ${index} uses the wrong trust anchor`);
    }
    const verified = metricEVerifySignedPayload(
      canonicalMetricEReviewJson({ keyId: envelope.keyId, subject }),
      envelope.publicKeySpki,
      envelope.signature,
    );
    if (!verified) {
      throw new TypeError(`Metric E escape-review envelope ${index} has an invalid signature`);
    }
    consumed.add(subjectKey);
  }
  if (consumed.size !== expectedSubjects.length) {
    throw new TypeError('Metric E escape-review evidence does not cover every measured root');
  }
  return Object.freeze({
    path: relativePath,
    sha256: sha256(source),
    trustAnchorFingerprint,
    verified: consumed.size,
  });
}

function metricEExpectedReviewSubjects(baseline, { codeSubjectSha, repoRoot }) {
  if (!Array.isArray(baseline?.reviewSubjects) || !Array.isArray(baseline?.report?.apps)) {
    throw new TypeError('Metric E baseline lacks retained build-owned review subjects');
  }
  const reportFindings = [];
  validateMetricEReportStructure(baseline.report, 'Metric E baseline report', reportFindings);
  if (reportFindings.length > 0) throw new TypeError(reportFindings.join('\n'));
  const reportByApp = new Map(
    baseline.report.apps.map((entry) => [`${entry?.package}\0${entry?.app}`, entry]),
  );
  if (reportByApp.size !== baseline.report.apps.length) {
    throw new TypeError('Metric E baseline report repeats an app/package identity');
  }
  const seenApps = new Set();
  const subjects = [];
  const sourceCache = new Map();
  for (const [index, entry] of baseline.reviewSubjects.entries()) {
    if (
      !exactObjectKeys(entry, ['app', 'manifest', 'package']) ||
      typeof entry.app !== 'string' ||
      entry.app.trim() === '' ||
      typeof entry.package !== 'string' ||
      entry.package.trim() === '' ||
      !exactObjectKeys(entry.manifest, ['artifactSubject', 'schema', 'subjects']) ||
      entry.manifest.schema !== 'kovo.escape-census-review-subjects/v1' ||
      !metricEDigestPattern.test(entry.manifest.artifactSubject ?? '') ||
      !Array.isArray(entry.manifest.subjects)
    ) {
      throw new TypeError(`Metric E baseline reviewSubjects[${index}] is malformed`);
    }
    const appKey = `${entry.package}\0${entry.app}`;
    const report = reportByApp.get(appKey);
    const sourceRoot = metricEComparableAppSourceRoots[appKey];
    if (report === undefined || seenApps.has(appKey) || sourceRoot === undefined) {
      throw new TypeError(`Metric E baseline reviewSubjects[${index}] has no unique report app`);
    }
    seenApps.add(appKey);
    const expectedRoots = [];
    for (const door of ESCAPE_CENSUS_DOORS) {
      if (!Array.isArray(report.roots?.[door])) {
        throw new TypeError(`Metric E baseline report ${entry.app}/${door} lacks exact roots`);
      }
      for (const root of report.roots[door]) expectedRoots.push(`${door}\0${root}`);
    }
    const actualRoots = [];
    for (const rawSubject of entry.manifest.subjects) {
      const subject = snapshotMetricEReviewSubject(rawSubject, {
        codeSubjectSha,
        repoRoot,
        sourceCache,
        sourceRoot,
        verifySource: true,
      });
      if (subject.artifactSubject !== entry.manifest.artifactSubject) {
        throw new TypeError(`Metric E baseline reviewSubjects[${index}] mixes artifact subjects`);
      }
      actualRoots.push(`${subject.door}\0${subject.root}`);
      subjects.push(subject);
    }
    if (
      canonicalJson(actualRoots.sort()) !== canonicalJson(expectedRoots.sort()) ||
      new Set(actualRoots).size !== actualRoots.length
    ) {
      throw new TypeError(
        `Metric E baseline reviewSubjects[${index}] differs from its measured root set`,
      );
    }
  }
  if (seenApps.size !== reportByApp.size || subjects.length > 4_096) {
    throw new TypeError('Metric E baseline review subjects do not cover the exact app corpus');
  }
  const keys = subjects.map(canonicalMetricEReviewJson);
  if (new Set(keys).size !== keys.length) {
    throw new TypeError('Metric E baseline review subjects repeat an exact signed identity');
  }
  return subjects;
}

function snapshotMetricEReviewSubject(
  value,
  { codeSubjectSha, repoRoot, sourceCache, sourceRoot, verifySource = false } = {},
) {
  if (
    !exactObjectKeys(value, ['artifactSubject', 'door', 'root', 'schema', 'sites']) ||
    value.schema !== 'kovo.escape-census-review/v1' ||
    !metricEDigestPattern.test(value.artifactSubject ?? '') ||
    !ESCAPE_CENSUS_DOORS.includes(value.door) ||
    !metricEReviewAuditText(value.root) ||
    !Array.isArray(value.sites) ||
    value.sites.length === 0 ||
    value.sites.length > 4_096
  ) {
    throw new TypeError('Metric E escape-review subject is malformed');
  }
  const sites = [];
  const siteKeys = [];
  for (const rawSite of value.sites) {
    const site = snapshotMetricEReviewSite(rawSite);
    const siteKey = canonicalMetricEReviewJson(site);
    if (siteKeys.length > 0 && siteKeys.at(-1) >= siteKey) {
      throw new TypeError('Metric E escape-review subject sites are not exact and sorted');
    }
    if (verifySource) {
      verifyMetricEReviewSiteSource(site, {
        codeSubjectSha,
        repoRoot,
        sourceCache,
        sourceRoot,
      });
    }
    sites.push(site);
    siteKeys.push(siteKey);
  }
  if (value.door !== 'csrf:false' && value.door !== 'ctx.fetch') {
    const site = sites[0];
    if (sites.length !== 1 || value.root !== `${site.file}:${site.span.start}:${site.span.end}`) {
      throw new TypeError(
        'Metric E source-root review must bind exactly one matching authored site',
      );
    }
  }
  return Object.freeze({
    artifactSubject: value.artifactSubject,
    door: value.door,
    root: value.root,
    schema: value.schema,
    sites: Object.freeze(sites),
  });
}

function snapshotMetricEReviewSite(value) {
  if (
    !exactObjectKeys(value, [
      'encoding',
      'file',
      'sliceHash',
      'sourceHash',
      'sourceLength',
      'span',
    ]) ||
    value.encoding !== 'utf16le' ||
    !metricEReviewSourcePath(value.file) ||
    !metricEDigestPattern.test(value.sliceHash ?? '') ||
    !metricEDigestPattern.test(value.sourceHash ?? '') ||
    !Number.isSafeInteger(value.sourceLength) ||
    value.sourceLength < 0 ||
    !exactObjectKeys(value.span, ['end', 'start']) ||
    !Number.isSafeInteger(value.span.start) ||
    !Number.isSafeInteger(value.span.end) ||
    value.span.start < 0 ||
    value.span.end <= value.span.start ||
    value.span.end > value.sourceLength
  ) {
    throw new TypeError('Metric E escape-review subject site is malformed');
  }
  return Object.freeze({
    encoding: 'utf16le',
    file: value.file,
    sliceHash: value.sliceHash,
    sourceHash: value.sourceHash,
    sourceLength: value.sourceLength,
    span: Object.freeze({ end: value.span.end, start: value.span.start }),
  });
}

function verifyMetricEReviewSiteSource(
  site,
  { codeSubjectSha, repoRoot, sourceCache, sourceRoot },
) {
  if (
    typeof codeSubjectSha !== 'string' ||
    typeof repoRoot !== 'string' ||
    !(sourceCache instanceof Map) ||
    typeof sourceRoot !== 'string'
  ) {
    throw new TypeError('Metric E source review lacks its retained code-subject context');
  }
  const relativePath = `${sourceRoot}/${site.file}`;
  let source = sourceCache.get(relativePath);
  if (source === undefined) {
    const bytes = readFileAtCodeSubject({ relativePath, repoRoot, subjectSha: codeSubjectSha });
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) {
      throw new TypeError(`Metric E reviewed source is not exact UTF-8 text: ${relativePath}`);
    }
    source = Object.freeze({
      sourceHash: `sha256:${sha256(Buffer.from(text, 'utf16le'))}`,
      sourceLength: text.length,
      text,
    });
    sourceCache.set(relativePath, source);
  }
  const sliceHash = `sha256:${sha256(
    Buffer.from(source.text.slice(site.span.start, site.span.end), 'utf16le'),
  )}`;
  if (
    source.sourceLength !== site.sourceLength ||
    source.sourceHash !== site.sourceHash ||
    site.span.end > source.sourceLength ||
    sliceHash !== site.sliceHash
  ) {
    throw new TypeError(
      `Metric E escape-review site does not bind retained source bytes: ${site.file}:${site.span.start}:${site.span.end}`,
    );
  }
}

function metricEReviewSourcePath(value) {
  if (
    !metricEReviewAuditText(value) ||
    path.isAbsolute(value) ||
    path.posix.isAbsolute(value) ||
    value.includes('\\') ||
    value.includes(':')
  ) {
    return false;
  }
  const parts = value.split('/');
  return !parts.some((part) => part.length === 0 || part === '.' || part === '..');
}

function metricEReviewAuditText(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4_096 ||
    value.trim() !== value
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x061c ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x2028 && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x206f) ||
      code === 0xfeff
    ) {
      return false;
    }
  }
  return true;
}

function exactObjectKeys(value, keys) {
  const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
  return (
    plainObject(value) &&
    canonicalJson(Object.keys(value).sort(compareText)) ===
      canonicalJson([...keys].sort(compareText))
  );
}

function strictBase64url(value, maximumBytes, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumBytes * 2 ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new TypeError(`Metric E escape-review ${label} is malformed`);
  }
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length === 0 || bytes.length > maximumBytes || bytes.toString('base64url') !== value) {
    throw new TypeError(`Metric E escape-review ${label} is malformed`);
  }
  return bytes;
}

function metricETrustAnchorFingerprint(publicKeySpki) {
  return `sha256:${sha256(strictBase64url(publicKeySpki, 1_024, 'public key'))}`;
}

function metricEVerifySignedPayload(payload, publicKeySpki, signature) {
  if (typeof payload !== 'string' || payload.length > 8 * 1_024 * 1_024) return false;
  try {
    const publicKeyDer = strictBase64url(publicKeySpki, 1_024, 'public key');
    const signatureBytes = strictBase64url(signature, 128, 'signature');
    if (signatureBytes.length !== 64) return false;
    return verifyEd25519Spki(Buffer.from(payload, 'utf8'), publicKeyDer, signatureBytes);
  } catch {
    return false;
  }
}

function canonicalMetricEReviewJson(value) {
  return JSON.stringify(sortMetricEReviewJson(value));
}

function sortMetricEReviewJson(value) {
  if (Array.isArray(value)) return value.map(sortMetricEReviewJson);
  if (plainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortMetricEReviewJson(value[key])]),
    );
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new TypeError('Metric E escape-review payload is not canonical JSON');
}

function deriveRoundResult({
  baseline,
  ceilings,
  cryptographicallyValidEscapeSignatures = 0,
  previousRound,
  report,
}) {
  const negativeIds = Array.isArray(baseline.negativeChecks)
    ? baseline.negativeChecks.map((entry) => entry?.id)
    : [];
  const provenanceWitnesses = ['missing-producer-provenance', 'wrong-producer-provenance'];
  if (!provenanceWitnesses.every((id) => negativeIds.includes(id))) {
    throw new Error('Metric E baseline lacks its producer-provenance negative controls');
  }
  const observedEscapes = totalObservedEscapes(report);
  if (
    !Number.isSafeInteger(cryptographicallyValidEscapeSignatures) ||
    cryptographicallyValidEscapeSignatures < 0 ||
    cryptographicallyValidEscapeSignatures > observedEscapes
  ) {
    throw new Error('Metric E valid signature count exceeds the measured escape-root set');
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
    observedEscapes,
    cryptographicallyValidEscapeSignatures,
    reviewedEscapeSignatures: 0,
    signatureCoverage:
      observedEscapes === 0
        ? 'unresolved: no escape roots were observed, and independent review remains unauthenticated'
        : cryptographicallyValidEscapeSignatures === observedEscapes
          ? 'unresolved: detached signatures verify, but their caller-supplied anchor and reviewer claim do not authenticate independent review'
          : 'unresolved: producer provenance is not a detached escape-review signature',
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
      id: 'metric-e-representative/v2',
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
    const round = rounds[index];
    const result = round?.result;
    if (
      !metricERoundHasAuthenticatedIndependentReview(round) ||
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

function metricERoundHasAuthenticatedIndependentReview(_round) {
  // The v2 retained-review schema deliberately labels every review as unauthenticated and
  // independence as self-declared. Such evidence remains useful audit input, but cannot satisfy
  // the plan's outside-party review requirement. Keep qualification closed until a later schema
  // defines and verifies an authenticated independent-review mechanism end to end.
  return false;
}

export function validateMetricESeries(document, { baseline, repoRoot = findRepoRoot() } = {}) {
  const findings = [];
  const currentBaseline =
    baseline ??
    JSON.parse(readFileSync(path.join(repoRoot, defaultEscapeCensusBaselinePath), 'utf8'));
  if (document?.schema !== metricERoundsSchema) {
    return result([`schema must be ${metricERoundsSchema}`]);
  }
  if (currentBaseline?.schema !== 'kovo.escape-census-baseline/v2') {
    findings.push('current Metric E baseline must use kovo.escape-census-baseline/v2');
  }
  if (!exactObjectKeys(document, ['rounds', 'schema', 'series', 'status', 'subjectProtocol'])) {
    findings.push('Metric E series document has unknown or missing fields');
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
    const roundFields = [
      'ceilings',
      'codeSubjectSha',
      'date',
      'escapeReviews',
      'number',
      'predecessor',
      'report',
      'result',
      'reviewer',
    ];
    let subjectBaseline;
    let subjectCeilings;
    let subjectEscapeReviewSignatures = 0;
    if (!exactObjectKeys(round, roundFields)) {
      findings.push(`${label} has unknown or missing fields`);
    }
    if (!plainObject(round) || roundFields.some((field) => !Object.hasOwn(round, field))) {
      continue;
    }
    if (!exactObjectKeys(round?.report, ['schema', 'sha256', 'snapshot'])) {
      findings.push(`${label} report descriptor has unknown or missing fields`);
    }
    if (!exactObjectKeys(round?.ceilings, ['schema', 'sha256', 'snapshot'])) {
      findings.push(`${label} ceiling descriptor has unknown or missing fields`);
    }
    if (
      !exactObjectKeys(round?.reviewer, [
        'authentication',
        'evidence',
        'id',
        'independence',
        'reviewedAt',
        'verdict',
      ]) ||
      !exactObjectKeys(round?.reviewer?.evidence, ['path', 'sha256'])
    ) {
      findings.push(`${label} reviewer descriptor has unknown or missing fields`);
    }
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
      if (subjectBaseline?.schema !== 'kovo.escape-census-baseline/v2') {
        throw new TypeError('retained baseline must use kovo.escape-census-baseline/v2');
      }
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
      if (round?.escapeReviews === null) {
        readMetricEEscapeReviewEvidence({
          baseline: subjectBaseline,
          codeSubjectSha: subjectSha,
          repoRoot,
        });
      } else if (
        !plainObject(round?.escapeReviews) ||
        !exactObjectKeys(round.escapeReviews, [
          'authentication',
          'path',
          'sha256',
          'trustAnchorFingerprint',
        ]) ||
        round.escapeReviews.authentication !== 'caller-supplied-unverified'
      ) {
        findings.push(`${label} escape-review evidence descriptor is malformed`);
      } else {
        const escapeReviewEvidence = readMetricEEscapeReviewEvidence({
          baseline: subjectBaseline,
          codeSubjectSha: subjectSha,
          relativePath: round.escapeReviews.path,
          repoRoot,
          trustAnchorFingerprint: round.escapeReviews.trustAnchorFingerprint,
        });
        if (escapeReviewEvidence?.sha256 !== round.escapeReviews.sha256) {
          findings.push(`${label} escape-review evidence digest drifted`);
        }
        subjectEscapeReviewSignatures = escapeReviewEvidence?.verified ?? 0;
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
    if (!validMetricERoundDate(round?.date)) {
      findings.push(`${label} date must be a real YYYY-MM-DD calendar date`);
    }
    if (
      round?.reviewer?.authentication !== 'none' ||
      round?.reviewer?.independence !== 'declared-independent-unverified' ||
      round?.reviewer?.verdict !== 'accept' ||
      typeof round?.reviewer?.id !== 'string' ||
      round.reviewer.id.trim() === '' ||
      !safeRelativePath(round?.reviewer?.evidence?.path) ||
      !/^[0-9a-f]{64}$/u.test(round?.reviewer?.evidence?.sha256 ?? '') ||
      !metricEReviewedAtPattern.test(round?.reviewer?.reviewedAt ?? '') ||
      !Number.isFinite(Date.parse(round?.reviewer?.reviewedAt ?? ''))
    ) {
      findings.push(`${label} lacks complete declared-review metadata`);
    } else {
      if (!round.reviewer.reviewedAt.startsWith(`${round.date}T`)) {
        findings.push(`${label} review timestamp does not match its round date`);
      }
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
          escapeReviewSha256: round?.escapeReviews?.sha256 ?? null,
          escapeReviewTrustAnchor: round?.escapeReviews?.trustAnchorFingerprint ?? null,
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
        cryptographicallyValidEscapeSignatures: subjectEscapeReviewSignatures,
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
      try {
        const expectedPredecessor = predecessorFor(previous);
        if (canonicalJson(round?.predecessor) !== canonicalJson(expectedPredecessor)) {
          findings.push(`${label} predecessor does not bind the prior reviewed artifact`);
        }
        compareMonotoneRound(previous, round, label, findings);
      } catch (error) {
        findings.push(
          `${label} predecessor cannot be verified: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (round.date < previous.date) findings.push(`${label} predates its predecessor`);
      if (
        Date.parse(round?.reviewer?.reviewedAt ?? '') <=
        Date.parse(previous?.reviewer?.reviewedAt ?? '')
      ) {
        findings.push(`${label} review timestamp is not later than its predecessor`);
      }
      try {
        assertCodeSubjectDescendsFrom({
          ancestorSha: previous.codeSubjectSha,
          descendantSha: round.codeSubjectSha,
          repoRoot,
        });
      } catch {
        findings.push(`${label} code subject does not descend from its predecessor`);
      }
    }
    previous = round;
  }
  const latest = rounds.at(-1);
  if (
    plainObject(latest?.report) &&
    canonicalJson(latest.report.snapshot) !== canonicalJson(currentBaseline?.report)
  ) {
    findings.push('latest Metric E round report differs from the current real-app baseline');
  }
  if (plainObject(latest?.ceilings)) {
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

function validMetricERoundDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value ?? '')) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function validateMetricEReportStructure(report, label, findings) {
  if (
    !exactObjectKeys(report, ['apps', 'packages', 'schema']) ||
    report.schema !== 'kovo.escape-census/v2' ||
    !Array.isArray(report.apps) ||
    !Array.isArray(report.packages)
  ) {
    findings.push(`${label} must be one exact kovo.escape-census/v2 report`);
    return;
  }
  const aggregate = new Map();
  let previousAppKey;
  for (const [index, appReport] of report.apps.entries()) {
    const rowLabel = `${label}.apps[${index}]`;
    if (
      !exactObjectKeys(appReport, ['app', 'doors', 'package', 'roots']) ||
      !metricEReviewAuditText(appReport.app) ||
      !metricEReviewAuditText(appReport.package) ||
      !exactObjectKeys(appReport.doors, ESCAPE_CENSUS_DOORS) ||
      !exactObjectKeys(appReport.roots, ESCAPE_CENSUS_DOORS)
    ) {
      findings.push(`${rowLabel} is malformed`);
      continue;
    }
    const appKey = `${appReport.package}\0${appReport.app}`;
    if (previousAppKey !== undefined && previousAppKey >= appKey) {
      findings.push(`${label} app identities must be unique and sorted`);
    }
    previousAppKey = appKey;
    for (const door of ESCAPE_CENSUS_DOORS) {
      const roots = exactMetricERoots(appReport.roots[door], `${rowLabel}.${door}`, findings);
      if (
        !Number.isSafeInteger(appReport.doors[door]) ||
        appReport.doors[door] < 0 ||
        appReport.doors[door] !== roots.length
      ) {
        findings.push(`${rowLabel}.${door} count differs from its exact roots`);
      }
      const packageDoor = `${appReport.package}\0${door}`;
      const packageRoots = aggregate.get(packageDoor) ?? [];
      for (const root of roots) packageRoots.push(JSON.stringify([appReport.app, root]));
      aggregate.set(packageDoor, packageRoots);
    }
  }

  const expectedPackages = new Set(report.apps.map((entry) => entry?.package));
  let previousPackage;
  const actualPackages = new Set();
  for (const [index, packageReport] of report.packages.entries()) {
    const rowLabel = `${label}.packages[${index}]`;
    if (
      !exactObjectKeys(packageReport, ['doors', 'package', 'roots']) ||
      !metricEReviewAuditText(packageReport.package) ||
      !exactObjectKeys(packageReport.doors, ESCAPE_CENSUS_DOORS) ||
      !exactObjectKeys(packageReport.roots, ESCAPE_CENSUS_DOORS)
    ) {
      findings.push(`${rowLabel} is malformed`);
      continue;
    }
    if (previousPackage !== undefined && previousPackage >= packageReport.package) {
      findings.push(`${label} package identities must be unique and sorted`);
    }
    previousPackage = packageReport.package;
    actualPackages.add(packageReport.package);
    for (const door of ESCAPE_CENSUS_DOORS) {
      const roots = exactMetricERoots(packageReport.roots[door], `${rowLabel}.${door}`, findings);
      const expectedRoots = (aggregate.get(`${packageReport.package}\0${door}`) ?? []).sort(
        compareMetricEText,
      );
      if (
        !Number.isSafeInteger(packageReport.doors[door]) ||
        packageReport.doors[door] < 0 ||
        packageReport.doors[door] !== roots.length ||
        canonicalJson(roots) !== canonicalJson(expectedRoots)
      ) {
        findings.push(`${rowLabel}.${door} differs from the exact app-root aggregation`);
      }
    }
  }
  if (
    canonicalJson([...actualPackages].sort(compareMetricEText)) !==
    canonicalJson([...expectedPackages].sort(compareMetricEText))
  ) {
    findings.push(`${label} app and package denominators differ`);
  }
}

function exactMetricERoots(value, label, findings) {
  if (!Array.isArray(value)) {
    findings.push(`${label} roots must be an array`);
    return [];
  }
  const roots = [];
  for (const root of value) {
    if (
      !metricEReviewAuditText(root) ||
      (roots.length > 0 && compareMetricEText(roots.at(-1), root) >= 0)
    ) {
      findings.push(`${label} roots must be exact, unique, and sorted`);
      return roots;
    }
    roots.push(root);
  }
  return roots;
}

function compareMetricEText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateRoundDigest(round, label, findings) {
  if (
    round?.report?.schema !== 'kovo.escape-census/v2' ||
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
  validateMetricEReportStructure(round?.report?.snapshot, `${label} report`, findings);
  if (!Array.isArray(reportPackages) || !plainObject(ceilingPackages)) {
    findings.push(`${label} report and ceilings must expose package/door counts`);
    return;
  }
  const reportPackageNames = reportPackages.map((entry) => entry?.package);
  const ceilingPackageNames = Object.keys(ceilingPackages).sort(compareMetricEText);
  if (
    canonicalJson(reportPackageNames) !== canonicalJson(ceilingPackageNames) ||
    new Set(reportPackageNames).size !== reportPackageNames.length
  ) {
    findings.push(`${label} report and ceiling package denominators differ`);
  }
  for (const packageReport of reportPackages) {
    const limits = ceilingPackages[packageReport?.package];
    if (!plainObject(limits)) {
      findings.push(`${label} report names a package without ceilings`);
      continue;
    }
    if (!exactObjectKeys(limits, ESCAPE_CENSUS_DOORS)) {
      findings.push(`${label} ${packageReport?.package} ceilings use the wrong door vocabulary`);
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
  escapeReviewEvidence,
  escapeReviewTrustAnchor,
  historicalSubject = false,
  ledger,
  repoRoot = findRepoRoot(),
  reviewEvidence,
} = {}) {
  if (ledger !== undefined && ledger?.schema !== metricERoundsSchema) {
    throw new Error('Metric E series schema changed; start a reviewed new series');
  }
  if (historicalSubject) {
    assertHistoricalCodeSubjectMatches({
      paths: metricEHistoricalSubjectPaths,
      repoRoot,
      subjectSha: codeSubjectSha,
    });
    assertHistoricalSourceTreesMatch({
      repoRoot,
      roots: [...metricEComparabilityInputRoots, ...metricEComparableCorpusRoots],
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
    escapeReviewEvidencePath: escapeReviewEvidence,
    escapeReviewTrustAnchor,
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
      optionalValueFlags: ['--escape-review-evidence-path', '--escape-review-trust-anchor'],
      valueFlags: ['--subject-sha', '--date', '--review-evidence-path'],
    });
    const ledger = existsLedger(ledgerPath)
      ? JSON.parse(readFileSync(ledgerPath, 'utf8'))
      : undefined;
    const document = appendMetricERound({
      codeSubjectSha: appendOptions['subject-sha'],
      date: appendOptions.date,
      escapeReviewEvidence: appendOptions['escape-review-evidence-path'],
      escapeReviewTrustAnchor: appendOptions['escape-review-trust-anchor'],
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
  return metricEReviewSourcePath(value);
}

function result(findings, summary = {}) {
  return { findings, ok: findings.length === 0, summary };
}

if (isMainEntry(import.meta.url)) await runGate(main);
