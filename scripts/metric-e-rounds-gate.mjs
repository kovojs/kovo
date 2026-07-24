#!/usr/bin/env node
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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

export const metricERoundsSchema = 'kovo.metric-e-round-series/v3';
export const metricEIndependentReviewSchema = 'kovo.metric-e-independent-review/v3';
export const metricEIndependentReviewPayloadSchema = 'kovo.metric-e-independent-review-payload/v1';
export const metricEReviewAnchorPolicySchema = 'kovo.metric-e-runtime-attestation-anchor-policy/v1';
export const metricEReviewAnchorAuthority = 'kovo-runtime-posture-attestation/v1';
export const metricEEscapeReviewsSchema = 'kovo.escape-census-reviews/v1';
export const defaultMetricERoundsPath = 'security/metric-e-rounds.json';
export const defaultEscapeCensusBaselinePath = 'security/escape-census-baseline.json';
export const metricERequiredComparableRounds = 3;
export const metricEReviewAnchorPolicyEnvironment =
  'KOVO_METRIC_E_RUNTIME_ATTESTATION_ANCHOR_POLICY';
export const metricEReviewHonestyBoundary =
  'signatures authenticate the externally pinned runtime-attestation key holder and exact bytes; they do not prove reviewer identity, human independence, custody truth, or review correctness';
const metricEReviewProcess = Object.freeze({
  buildCustody: 'outside-kovo-build-and-coding-agent',
  independence: 'outside-party-reviewer-asserted',
  signingKeyCustody: 'outside-kovo-build-and-coding-agent',
});
const metricEReviewAuthentication = 'externally-pinned-runtime-attestation-ed25519';
const metricEReviewIndependence = 'outside-party-process-asserted-not-proven';
const metricEMaxReviewEvidenceBytes = 8 * 1024 * 1024;
const metricEMaxAnchorPolicyBytes = 16 * 1024;
const metricEHistoricalComparabilityCacheLimit = 128;
const metricEHistoricalComparabilityCache = new Map();
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
  'scripts/kovo-certificate-signature.mjs',
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
  'security/fixtures/escape-census-real-app/kovo.config.ts',
  'security/fixtures/escape-census-real-app/package.json',
  'security/fixtures/escape-census-real-app/src/client.ts',
  'security/fixtures/escape-census-real-app/src/style.css',
  'security/fixtures/escape-census-real-app/src/style.d.ts',
  'security/fixtures/escape-census-real-app/tsconfig.json',
]);
export const metricEComparableCorpusPaths = Object.freeze([
  'security/fixtures/escape-census-real-app/app.tsx',
  'security/fixtures/escape-census-real-app/index.html',
  'security/fixtures/escape-census-real-app/kovo.config.ts',
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
  const cacheKey = `${realpathSync(repoRoot)}\0${subjectSha}`;
  const cached = metricEHistoricalComparabilityCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const buildSources = (paths) => buildSourceSetAtCodeSubject({ paths, repoRoot, subjectSha });
  const buildSourceTrees = (roots) =>
    buildSourceTreeSetAtCodeSubject({ repoRoot, roots, subjectSha });
  const comparability = buildMetricEComparabilityWithSources(buildSources, buildSourceTrees);
  if (metricEHistoricalComparabilityCache.size >= metricEHistoricalComparabilityCacheLimit) {
    metricEHistoricalComparabilityCache.delete(
      metricEHistoricalComparabilityCache.keys().next().value,
    );
  }
  metricEHistoricalComparabilityCache.set(cacheKey, comparability);
  return comparability;
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

/**
 * Read the out-of-band policy that pins the already-existing runtime-attestation authority.
 *
 * This file is deliberately not generated or committed by this gate. A repository-controlled
 * fingerprint would let the same actor replace the key and the evidence together.
 */
export function readMetricEReviewAnchorPolicy(policyPath, { repoRoot = findRepoRoot() } = {}) {
  if (typeof policyPath !== 'string' || policyPath.trim() === '') {
    throw new TypeError(
      `Metric E authenticated rounds require an external anchor policy path via ${metricEReviewAnchorPolicyEnvironment}`,
    );
  }
  const stats = lstatSync(policyPath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > metricEMaxAnchorPolicyBytes) {
    throw new TypeError('Metric E anchor policy must be one bounded external regular file');
  }
  const policyRealPath = realpathSync(policyPath);
  const repositoryRealPath = realpathSync(repoRoot);
  const repositoryRelativePath = path.relative(repositoryRealPath, policyRealPath);
  if (
    repositoryRelativePath === '' ||
    (!repositoryRelativePath.startsWith(`..${path.sep}`) &&
      repositoryRelativePath !== '..' &&
      !path.isAbsolute(repositoryRelativePath))
  ) {
    throw new TypeError('Metric E anchor policy must resolve outside the repository');
  }
  const source = readFileSync(policyRealPath);
  let document;
  try {
    document = JSON.parse(source.toString('utf8'));
  } catch (error) {
    throw new TypeError(
      `Metric E anchor policy must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    !exactObjectKeys(document, ['authority', 'schema', 'trustAnchorFingerprint']) ||
    document.schema !== metricEReviewAnchorPolicySchema ||
    document.authority !== metricEReviewAnchorAuthority ||
    !metricEDigestPattern.test(document.trustAnchorFingerprint ?? '')
  ) {
    throw new TypeError(
      'Metric E anchor policy must exactly pin the existing runtime-attestation fingerprint',
    );
  }
  return Object.freeze({
    authority: metricEReviewAnchorAuthority,
    schema: metricEReviewAnchorPolicySchema,
    trustAnchorFingerprint: document.trustAnchorFingerprint,
  });
}

export function buildMetricERound({
  codeSubjectSha,
  date,
  escapeReviewEvidencePath,
  number,
  predecessor,
  previousRound,
  repoRoot = findRepoRoot(),
  reviewAnchorPolicyPath,
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
  const reviewAnchor = readMetricEReviewAnchorPolicy(reviewAnchorPolicyPath, { repoRoot });
  const escapeReviews = readMetricEEscapeReviewEvidence({
    baseline,
    codeSubjectSha: subjectSha,
    relativePath: escapeReviewEvidencePath,
    repoRoot,
    trustAnchorFingerprint: reviewAnchor.trustAnchorFingerprint,
  });
  const reviewEvidence = readIndependentReviewArtifact(reviewEvidencePath, repoRoot);
  const reviewCheck = validateMetricEIndependentReviewArtifact(reviewEvidence.document, {
    ceilingSha256: sha256(canonicalJson(ceilings)),
    codeSubjectSha: subjectSha,
    date,
    escapeReviews:
      escapeReviews === undefined
        ? null
        : {
            path: escapeReviews.path,
            sha256: escapeReviews.sha256,
            trustAnchorFingerprint: escapeReviews.trustAnchorFingerprint,
          },
    number,
    reportSha256: sha256(canonicalJson(report)),
    requireAccepted: true,
    trustAnchorFingerprint: reviewAnchor.trustAnchorFingerprint,
  });
  if (!reviewCheck.ok) throw new TypeError(reviewCheck.findings.join('\n'));
  const result = deriveRoundResult({
    authenticatedIndependentReview: true,
    baseline,
    ceilings,
    cryptographicallyValidEscapeSignatures: escapeReviews?.verified ?? 0,
    previousRound,
    report,
  });
  const payload = reviewCheck.summary.payload;
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
            authentication: metricEReviewAuthentication,
            path: escapeReviews.path,
            sha256: escapeReviews.sha256,
            trustAnchorFingerprint: escapeReviews.trustAnchorFingerprint,
          }),
    reviewer: Object.freeze({
      authentication: metricEReviewAuthentication,
      evidence: Object.freeze({ path: reviewEvidence.path, sha256: reviewEvidence.sha256 }),
      id: payload.reviewer.id,
      independence: metricEReviewIndependence,
      reviewedAt: payload.reviewer.reviewedAt,
      trustAnchorFingerprint: reviewAnchor.trustAnchorFingerprint,
      verdict: payload.verdict,
    }),
    predecessor: predecessor ?? null,
    result,
  });
}

export function buildMetricEIndependentReviewPayload({
  ceilingSha256,
  codeSubjectSha,
  date,
  escapeReviews = null,
  number,
  reportSha256,
  reviewAnchorFingerprint,
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
  if (!validMetricERoundDate(date)) {
    throw new TypeError('Metric E independent-review date must be a real YYYY-MM-DD calendar date');
  }
  let normalizedEscapeReviews = null;
  if (escapeReviews !== null) {
    if (
      !exactObjectKeys(escapeReviews, ['path', 'sha256', 'trustAnchorFingerprint']) ||
      !safeRelativePath(escapeReviews.path) ||
      !escapeReviews.path.startsWith('security/reviews/metric-e/') ||
      !escapeReviews.path.endsWith('.escape-reviews.json') ||
      !/^[0-9a-f]{64}$/u.test(escapeReviews.sha256 ?? '') ||
      !metricEDigestPattern.test(escapeReviews.trustAnchorFingerprint ?? '')
    ) {
      throw new TypeError('Metric E independent-review escape-review descriptor is malformed');
    }
    normalizedEscapeReviews = Object.freeze({
      path: escapeReviews.path,
      sha256: escapeReviews.sha256,
      trustAnchorFingerprint: escapeReviews.trustAnchorFingerprint,
    });
  }
  if (!metricEDigestPattern.test(reviewAnchorFingerprint ?? '')) {
    throw new TypeError('Metric E independent-review runtime anchor must be one SHA-256 digest');
  }
  if (
    normalizedEscapeReviews !== null &&
    normalizedEscapeReviews.trustAnchorFingerprint !== reviewAnchorFingerprint
  ) {
    throw new TypeError('Metric E independent-review root set and aggregate use different anchors');
  }
  if (!metricEReviewAuditText(reviewer)) {
    throw new TypeError('Metric E independent-review reviewer must be non-empty');
  }
  if (
    !metricEReviewedAtPattern.test(reviewedAt ?? '') ||
    !Number.isFinite(Date.parse(reviewedAt ?? ''))
  ) {
    throw new TypeError('Metric E independent-review reviewedAt must be one UTC ISO timestamp');
  }
  if (!reviewedAt.startsWith(`${date}T`)) {
    throw new TypeError('Metric E independent-review timestamp must match its round date');
  }
  if (verdict !== 'accept' && verdict !== 'reject') {
    throw new TypeError('Metric E independent-review verdict must be accept or reject');
  }
  return Object.freeze({
    process: metricEReviewProcess,
    reviewer: Object.freeze({ id: reviewer, reviewedAt }),
    schema: metricEIndependentReviewPayloadSchema,
    subject: Object.freeze({ codeSubjectSha: subjectSha }),
    round: Object.freeze({
      ceilingSha256,
      date,
      escapeReviews: normalizedEscapeReviews,
      number,
      reportSha256,
      reviewAnchorFingerprint,
    }),
    verdict,
  });
}

export function metricEIndependentReviewPayloadSource(keyId, payload) {
  if (!metricEKeyIdPattern.test(keyId ?? '')) {
    throw new TypeError('Metric E independent-review key id is malformed');
  }
  return canonicalMetricEReviewJson({ keyId, payload });
}

export function buildMetricEIndependentReviewArtifact(document) {
  if (
    !exactObjectKeys(document, [
      'keyId',
      'payload',
      'publicKeySpki',
      'schema',
      'signature',
      'trustAnchorFingerprint',
    ]) ||
    document.schema !== metricEIndependentReviewSchema
  ) {
    throw new TypeError('Metric E independent-review envelope has unknown or missing fields');
  }
  const payload = buildMetricEIndependentReviewPayload({
    ceilingSha256: document?.payload?.round?.ceilingSha256,
    codeSubjectSha: document?.payload?.subject?.codeSubjectSha,
    date: document?.payload?.round?.date,
    escapeReviews: document?.payload?.round?.escapeReviews,
    number: document?.payload?.round?.number,
    reportSha256: document?.payload?.round?.reportSha256,
    reviewAnchorFingerprint: document?.payload?.round?.reviewAnchorFingerprint,
    reviewedAt: document?.payload?.reviewer?.reviewedAt,
    reviewer: document?.payload?.reviewer?.id,
    verdict: document?.payload?.verdict,
  });
  if (canonicalJson(document.payload) !== canonicalJson(payload)) {
    throw new TypeError('Metric E independent-review payload has unknown or noncanonical fields');
  }
  if (
    !metricEKeyIdPattern.test(document.keyId ?? '') ||
    typeof document.publicKeySpki !== 'string' ||
    typeof document.signature !== 'string' ||
    !metricEDigestPattern.test(document.trustAnchorFingerprint ?? '')
  ) {
    throw new TypeError('Metric E independent-review envelope is malformed');
  }
  const publicKey = strictBase64url(document.publicKeySpki, 1_024, 'aggregate public key');
  const signature = strictBase64url(document.signature, 128, 'aggregate signature');
  if (
    signature.length !== 64 ||
    `sha256:${sha256(publicKey)}` !== document.trustAnchorFingerprint ||
    document.trustAnchorFingerprint !== payload.round.reviewAnchorFingerprint
  ) {
    throw new TypeError('Metric E independent-review envelope uses the wrong trust anchor');
  }
  if (
    !metricEVerifySignedPayload(
      metricEIndependentReviewPayloadSource(document.keyId, payload),
      document.publicKeySpki,
      document.signature,
    )
  ) {
    throw new TypeError('Metric E independent-review envelope has an invalid Ed25519 signature');
  }
  return Object.freeze({
    keyId: document.keyId,
    payload,
    publicKeySpki: document.publicKeySpki,
    schema: metricEIndependentReviewSchema,
    signature: document.signature,
    trustAnchorFingerprint: document.trustAnchorFingerprint,
  });
}

export function validateMetricEIndependentReviewArtifact(document, expected = {}) {
  const findings = [];
  let normalized;
  try {
    normalized = buildMetricEIndependentReviewArtifact(document);
  } catch (error) {
    findings.push(error instanceof Error ? error.message : String(error));
    return result(findings);
  }
  const payload = normalized.payload;
  for (const [label, actual, wanted] of [
    ['code subject', payload.subject.codeSubjectSha, expected.codeSubjectSha],
    ['round number', payload.round.number, expected.number],
    ['round date', payload.round.date, expected.date],
    ['report digest', payload.round.reportSha256, expected.reportSha256],
    ['ceiling digest', payload.round.ceilingSha256, expected.ceilingSha256],
    ['escape-review artifact', payload.round.escapeReviews, expected.escapeReviews],
    [
      'runtime trust anchor',
      payload.round.reviewAnchorFingerprint,
      expected.trustAnchorFingerprint,
    ],
  ]) {
    if (wanted !== undefined && canonicalJson(actual) !== canonicalJson(wanted)) {
      findings.push(`independent review ${label} does not bind the reviewed round`);
    }
  }
  if (
    expected.trustAnchorFingerprint !== undefined &&
    normalized.trustAnchorFingerprint !== expected.trustAnchorFingerprint
  ) {
    findings.push('independent review envelope does not use the externally pinned trust anchor');
  }
  if (expected.requireAccepted === true && payload.verdict !== 'accept') {
    findings.push('independent review verdict must explicitly accept the round');
  }
  return result(findings, { payload });
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
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > metricEMaxReviewEvidenceBytes) {
    throw new TypeError('Metric E review evidence must be one bounded retained regular file');
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
  if (relativePath === undefined) {
    if (
      trustAnchorFingerprint !== undefined &&
      !metricEDigestPattern.test(trustAnchorFingerprint)
    ) {
      throw new TypeError('Metric E escape-review trust anchor is malformed');
    }
    return undefined;
  }
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
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > metricEMaxReviewEvidenceBytes) {
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
  authenticatedIndependentReview = false,
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
  const reviewedEscapeSignatures = authenticatedIndependentReview
    ? cryptographicallyValidEscapeSignatures
    : 0;
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
    reviewedEscapeSignatures,
    signatureCoverage:
      observedEscapes === 0 && authenticatedIndependentReview
        ? 'complete: the externally pinned key holder accepted the zero-root round and its outside-custody assertion'
        : reviewedEscapeSignatures === observedEscapes && authenticatedIndependentReview
          ? 'complete: every measured root and the aggregate review authenticate under the externally pinned runtime-attestation anchor'
          : 'unresolved: root and aggregate review evidence has not authenticated under the externally pinned runtime-attestation anchor',
    unsignedEscapes: observedEscapes - reviewedEscapeSignatures,
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

export function buildMetricESeries({
  comparability,
  reviewAnchor = null,
  rounds,
  repoRoot = findRepoRoot(),
} = {}) {
  const comparableRounds = Array.isArray(rounds) ? rounds : [];
  const pending = comparableRounds.length === 0;
  const normalizedComparability = pending
    ? null
    : comparability === undefined
      ? buildMetricEComparability({ repoRoot })
      : comparability;
  const normalizedReviewAnchor = pending ? null : reviewAnchor === undefined ? null : reviewAnchor;
  const qualifyingComparableRounds = trailingQualifyingMetricERounds(
    comparableRounds,
    normalizedReviewAnchor,
  );
  return Object.freeze({
    schema: metricERoundsSchema,
    subjectProtocol: SECURITY_EVIDENCE_SUBJECT_PROTOCOL,
    series: Object.freeze({
      id: 'metric-e-representative/v2',
      comparability: normalizedComparability,
      reviewAnchor: normalizedReviewAnchor,
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
          : comparableRounds.length === 0
            ? 'pending-external-independent-rounds'
            : comparableRounds.some((round) => round?.result?.unsignedEscapes !== 0)
              ? 'waiting-for-signed-comparable-rounds'
              : 'waiting-for-independent-comparable-rounds',
    }),
  });
}

function lockedMetricESeriesValueMatches(actual, expected) {
  return plainObject(actual) && canonicalJson(actual) === canonicalJson(expected);
}

function trailingQualifyingMetricERounds(rounds, reviewAnchor) {
  let count = 0;
  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const round = rounds[index];
    const result = round?.result;
    if (
      !metricERoundHasAuthenticatedIndependentReview(round, reviewAnchor) ||
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

function metricERoundHasAuthenticatedIndependentReview(round, reviewAnchor) {
  return (
    plainObject(reviewAnchor) &&
    reviewAnchor.schema === metricEReviewAnchorPolicySchema &&
    reviewAnchor.authority === metricEReviewAnchorAuthority &&
    metricEDigestPattern.test(reviewAnchor.trustAnchorFingerprint ?? '') &&
    round?.reviewer?.authentication === metricEReviewAuthentication &&
    round?.reviewer?.independence === metricEReviewIndependence &&
    round?.reviewer?.trustAnchorFingerprint === reviewAnchor.trustAnchorFingerprint &&
    round?.reviewer?.verdict === 'accept' &&
    round?.result?.reviewedEscapeSignatures === round?.result?.observedEscapes
  );
}

export function validateMetricESeries(
  document,
  { baseline, repoRoot = findRepoRoot(), reviewAnchorPolicyPath } = {},
) {
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
  if (!Array.isArray(document.rounds)) {
    findings.push('Metric E series rounds must be an array');
  }
  let reviewAnchor = null;
  if (rounds.length > 0) {
    try {
      reviewAnchor = readMetricEReviewAnchorPolicy(reviewAnchorPolicyPath, { repoRoot });
    } catch (error) {
      findings.push(
        `Metric E authenticated rounds lack their external runtime-attestation anchor policy: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const expectedShell = buildMetricESeries({ reviewAnchor, rounds, repoRoot });
  if (canonicalJson(document.subjectProtocol) !== canonicalJson(expectedShell.subjectProtocol)) {
    findings.push('Metric E code-subject/evidence-commit protocol drifted');
  }
  if (!exactObjectKeys(document?.series, ['comparability', 'id', 'reviewAnchor'])) {
    findings.push('Metric E series descriptor has unknown or missing fields');
  }
  if (document?.series?.id !== expectedShell.series.id) {
    findings.push('Metric E series identity drifted; start a reviewed new series');
  }
  if (rounds.length === 0) {
    if (document?.series?.comparability !== null || document?.series?.reviewAnchor !== null) {
      findings.push(
        'pending Metric E series must leave comparability and review anchor unlocked as null',
      );
    }
  } else {
    if (
      !lockedMetricESeriesValueMatches(
        document?.series?.comparability,
        expectedShell.series.comparability,
      )
    ) {
      findings.push(
        'nonempty Metric E series lacks its exact locked comparability signature; start a reviewed new series',
      );
    }
    if (!lockedMetricESeriesValueMatches(document?.series?.reviewAnchor, reviewAnchor)) {
      findings.push(
        'Metric E series review anchor differs from the verifier-supplied external policy',
      );
    }
  }
  if (canonicalJson(document.status) !== canonicalJson(expectedShell.status)) {
    findings.push('Metric E round status does not match the retained round count');
  }

  const subjectShas = new Set();
  const escapeReviewEvidenceDigests = new Set();
  const reviewEvidenceDigests = new Set();
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
    let authenticatedIndependentReview = false;
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
        'trustAnchorFingerprint',
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
      if (!lockedMetricESeriesValueMatches(document.series?.comparability, subjectComparability)) {
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
        round.escapeReviews.authentication !== metricEReviewAuthentication ||
        round.escapeReviews.trustAnchorFingerprint !== reviewAnchor?.trustAnchorFingerprint
      ) {
        findings.push(`${label} escape-review evidence descriptor is malformed`);
      } else {
        if (escapeReviewEvidenceDigests.has(round.escapeReviews.sha256)) {
          findings.push(`${label} reuses prior signed escape-review evidence`);
        }
        escapeReviewEvidenceDigests.add(round.escapeReviews.sha256);
        const escapeReviewEvidence = readMetricEEscapeReviewEvidence({
          baseline: subjectBaseline,
          codeSubjectSha: subjectSha,
          relativePath: round.escapeReviews.path,
          repoRoot,
          trustAnchorFingerprint: reviewAnchor?.trustAnchorFingerprint,
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
      round?.reviewer?.authentication !== metricEReviewAuthentication ||
      round?.reviewer?.independence !== metricEReviewIndependence ||
      round?.reviewer?.verdict !== 'accept' ||
      typeof round?.reviewer?.id !== 'string' ||
      !metricEReviewAuditText(round.reviewer.id) ||
      !safeRelativePath(round?.reviewer?.evidence?.path) ||
      !/^[0-9a-f]{64}$/u.test(round?.reviewer?.evidence?.sha256 ?? '') ||
      round?.reviewer?.trustAnchorFingerprint !== reviewAnchor?.trustAnchorFingerprint ||
      !metricEReviewedAtPattern.test(round?.reviewer?.reviewedAt ?? '') ||
      !Number.isFinite(Date.parse(round?.reviewer?.reviewedAt ?? ''))
    ) {
      findings.push(`${label} lacks complete authenticated-review metadata`);
    } else {
      if (!round.reviewer.reviewedAt.startsWith(`${round.date}T`)) {
        findings.push(`${label} review timestamp does not match its round date`);
      }
      const evidenceDigest = round.reviewer.evidence.sha256;
      if (reviewEvidenceDigests.has(evidenceDigest)) {
        findings.push(`${label} reuses prior review evidence and is not an independent round`);
      }
      reviewEvidenceDigests.add(evidenceDigest);
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
          date: round?.date,
          escapeReviews:
            round?.escapeReviews === null
              ? null
              : {
                  path: round?.escapeReviews?.path,
                  sha256: round?.escapeReviews?.sha256,
                  trustAnchorFingerprint: round?.escapeReviews?.trustAnchorFingerprint,
                },
          number: round?.number,
          reportSha256: round?.report?.sha256,
          requireAccepted: true,
          trustAnchorFingerprint: reviewAnchor?.trustAnchorFingerprint,
        });
        findings.push(...reviewCheck.findings.map((finding) => `${label} ${finding}`));
        if (
          reviewCheck.summary?.payload?.reviewer?.id !== round.reviewer.id ||
          reviewCheck.summary?.payload?.reviewer?.reviewedAt !== round.reviewer.reviewedAt ||
          reviewCheck.summary?.payload?.verdict !== round.reviewer.verdict
        ) {
          findings.push(`${label} reviewer metadata differs from its structured review artifact`);
        }
        authenticatedIndependentReview =
          reviewCheck.ok && evidenceRecord.sha256 === round.reviewer.evidence.sha256;
      }
    }
    validateRoundDigest(round, label, findings);
    let expectedResult;
    try {
      expectedResult = deriveRoundResult({
        authenticatedIndependentReview,
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
  historicalSubject = false,
  ledger,
  repoRoot = findRepoRoot(),
  reviewAnchorPolicyPath,
  reviewEvidence,
} = {}) {
  if (ledger !== undefined && ledger?.schema !== metricERoundsSchema) {
    throw new Error('Metric E series schema changed; start a reviewed new series');
  }
  if (ledger !== undefined && !Array.isArray(ledger?.rounds)) {
    throw new Error('Metric E pending ledger is malformed; start a reviewed new series');
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
  if (ledger !== undefined && existingRounds.length === 0) {
    const pendingCheck = validateMetricESeries(ledger, { repoRoot });
    if (!pendingCheck.ok) {
      throw new Error(`Metric E pending ledger is malformed: ${pendingCheck.findings.join('\n')}`);
    }
  }
  const currentComparability = buildMetricEComparability({ repoRoot });
  const reviewAnchor = readMetricEReviewAnchorPolicy(reviewAnchorPolicyPath, { repoRoot });
  if (
    existingRounds.length > 0 &&
    !lockedMetricESeriesValueMatches(ledger?.series?.comparability, currentComparability)
  ) {
    throw new Error('Metric E comparability changed; start a reviewed new series');
  }
  if (
    existingRounds.length > 0 &&
    canonicalJson(ledger?.series?.reviewAnchor) !== canonicalJson(reviewAnchor)
  ) {
    throw new Error('Metric E runtime-attestation anchor changed; start a reviewed new series');
  }
  const baseline = JSON.parse(
    readFileSync(path.join(repoRoot, defaultEscapeCensusBaselinePath), 'utf8'),
  );
  const previous = existingRounds.at(-1);
  const round = buildMetricERound({
    codeSubjectSha,
    date,
    escapeReviewEvidencePath: escapeReviewEvidence,
    number: existingRounds.length + 1,
    predecessor: previous === undefined ? null : predecessorFor(previous),
    previousRound: previous,
    repoRoot,
    reviewAnchorPolicyPath,
    reviewEvidencePath: reviewEvidence,
  });
  const document = buildMetricESeries({
    comparability: currentComparability,
    reviewAnchor,
    rounds: [...existingRounds, round],
    repoRoot,
  });
  const check = validateMetricESeries(document, { baseline, repoRoot, reviewAnchorPolicyPath });
  if (!check.ok) throw new Error(check.findings.join('\n'));
  return document;
}

export function initializeMetricESeries({ existing, repoRoot = findRepoRoot() } = {}) {
  if (
    existing !== undefined &&
    (existing?.schema !== metricERoundsSchema ||
      !Array.isArray(existing?.rounds) ||
      existing.rounds.length !== 0)
  ) {
    throw new Error('Metric E --init refuses to overwrite a nonempty or non-v3 ledger');
  }
  const pending = buildMetricESeries({ rounds: [], repoRoot });
  if (existing !== undefined) {
    const check = validateMetricESeries(existing, { repoRoot });
    if (!check.ok) {
      throw new Error(
        `Metric E --init refuses to normalize a malformed or pre-seeded empty ledger: ${check.findings.join('\n')}`,
      );
    }
  }
  return pending;
}

async function main() {
  const root = findRepoRoot();
  const ledgerPath = path.join(root, defaultMetricERoundsPath);
  const args = process.argv.slice(2);
  let cliReviewAnchorPolicyPath;
  if (args[0] === '--init') {
    if (args.length !== 1) {
      throw new TypeError('Metric E --init accepts no additional arguments');
    }
    if (existsLedger(ledgerPath)) {
      const existing = JSON.parse(readFileSync(ledgerPath, 'utf8'));
      writeFileSync(
        ledgerPath,
        canonicalJson(initializeMetricESeries({ existing, repoRoot: root })),
        'utf8',
      );
    } else {
      writeFileSync(ledgerPath, canonicalJson(initializeMetricESeries({ repoRoot: root })), 'utf8');
    }
  } else if (args.length > 0) {
    const appendOptions = parseExactCliArguments(args, {
      command: '--append',
      optionalFlags: ['--historical-subject'],
      optionalValueFlags: ['--escape-review-evidence-path'],
      valueFlags: [
        '--subject-sha',
        '--date',
        '--review-evidence-path',
        '--runtime-attestation-anchor-policy',
      ],
    });
    const ledger = existsLedger(ledgerPath)
      ? JSON.parse(readFileSync(ledgerPath, 'utf8'))
      : undefined;
    const document = appendMetricERound({
      codeSubjectSha: appendOptions['subject-sha'],
      date: appendOptions.date,
      escapeReviewEvidence: appendOptions['escape-review-evidence-path'],
      historicalSubject: appendOptions['historical-subject'] === true,
      ledger,
      repoRoot: root,
      reviewAnchorPolicyPath: appendOptions['runtime-attestation-anchor-policy'],
      reviewEvidence: appendOptions['review-evidence-path'],
    });
    cliReviewAnchorPolicyPath = appendOptions['runtime-attestation-anchor-policy'];
    writeFileSync(ledgerPath, canonicalJson(document), 'utf8');
  }
  const document = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const reviewAnchorPolicyPath =
    document?.rounds?.length > 0
      ? (cliReviewAnchorPolicyPath ?? process.env[metricEReviewAnchorPolicyEnvironment])
      : undefined;
  const check = validateMetricESeries(document, { repoRoot: root, reviewAnchorPolicyPath });
  if (!check.ok) throw new Error(check.findings.join('\n'));
  const state = check.summary.completed >= check.summary.required ? 'COMPLETE' : 'PENDING';
  process.stdout.write(
    `${metricERoundsSchema} ${state} qualifying=${check.summary.completed}/${check.summary.required} observed=${check.summary.observed} remaining=${check.summary.remaining} unsigned=${document.rounds.at(-1)?.result?.unsignedEscapes ?? 'pending'}; ${metricEReviewHonestyBoundary}; STRUCTURAL-OK\n`,
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
