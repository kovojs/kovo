import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendMetricERound,
  buildMetricEIndependentReviewArtifact,
  buildMetricESeries,
  defaultEscapeCensusBaselinePath,
  metricEComparableCorpusPaths,
  metricEComparableCorpusRoots,
  metricEComparabilityInputPaths,
  metricEComparabilityInputRoots,
  metricEHistoricalSubjectPaths,
  validateMetricESeries,
} from './metric-e-rounds-gate.mjs';
import { repoRoot } from './lib/repo-root.mjs';
import { canonicalJson, sha256 } from './lib/security-evidence-subject.mjs';

const sourceRoot = repoRoot();
const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function createMetricERepository() {
  const root = mkdtempSync(path.join(tmpdir(), 'kovo-metric-e-rounds-'));
  temporaryRoots.push(root);
  const paths = new Set([
    ...metricEComparableCorpusPaths,
    ...metricEComparabilityInputPaths,
    ...metricEHistoricalSubjectPaths,
    defaultEscapeCensusBaselinePath,
    'packages/better-auth/src/credential-options.ts',
    'packages/browser/src/security-output.ts',
    'packages/compiler/src/app-graph.ts',
    'packages/devtool/src/app.d.ts',
    'packages/headless-ui/src/internal.ts',
    'packages/icons/src/a-arrow-down.tsx',
    'packages/style/src/index.ts',
    'packages/ui/src/accordion.tsx',
    'packages/verify/src/translation.ts',
    'security/escape-budgets.json',
  ]);
  for (const relativePath of paths) {
    const destination = path.join(root, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(path.join(sourceRoot, relativePath), destination);
  }
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'metric-e@example.test']);
  git(root, ['config', 'user.name', 'Metric E Test']);
  commitAll(root, 'metric inputs');
  return root;
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${result.stderr}${result.stdout}`);
  return result.stdout.trim();
}

function commitAll(root, message) {
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function writeReview(
  root,
  {
    escapeReviewSha256 = null,
    escapeReviewTrustAnchor = null,
    number,
    reviewer = `reviewer-${number}`,
    subjectSha,
    verdict = 'accept',
  },
) {
  const baseline = JSON.parse(
    readFileSync(path.join(root, defaultEscapeCensusBaselinePath), 'utf8'),
  );
  const ceilings = JSON.parse(
    readFileSync(path.join(root, 'security/escape-budgets.json'), 'utf8'),
  );
  const relativePath = `security/reviews/metric-e/round-${number}.json`;
  const artifact = buildMetricEIndependentReviewArtifact({
    ceilingSha256: sha256(canonicalJson(ceilings)),
    codeSubjectSha: subjectSha,
    escapeReviewSha256,
    escapeReviewTrustAnchor,
    number,
    reportSha256: sha256(canonicalJson(baseline.report)),
    reviewedAt: `2026-07-${String(19 + number).padStart(2, '0')}T12:00:00Z`,
    reviewer,
    verdict,
  });
  mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
  writeFileSync(path.join(root, relativePath), canonicalJson(artifact));
  return relativePath;
}

function writeEscapeReviews(
  root,
  number,
  mutate = (document) => document,
  keyAlgorithm = 'ed25519',
) {
  const baseline = JSON.parse(
    readFileSync(path.join(root, defaultEscapeCensusBaselinePath), 'utf8'),
  );
  const subjects = baseline.reviewSubjects.flatMap((entry) => entry.manifest.subjects);
  const { privateKey, publicKey } =
    keyAlgorithm === 'rsa-512'
      ? generateKeyPairSync('rsa', { modulusLength: 512 })
      : generateKeyPairSync('ed25519');
  const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
  const trustAnchorFingerprint = `sha256:${createHash('sha256').update(publicKeyDer).digest('hex')}`;
  const keyId = `metric-e-review-${number}`;
  const reviews = subjects.map((subject) => ({
    keyId,
    publicKeySpki: publicKeyDer.toString('base64url'),
    signature: sign(
      null,
      Buffer.from(compactCanonicalJson({ keyId, subject }), 'utf8'),
      privateKey,
    ).toString('base64url'),
    subject,
    trustAnchorFingerprint,
  }));
  const document = mutate({ reviews, schema: 'kovo.escape-census-reviews/v1' });
  const relativePath = `security/reviews/metric-e/round-${number}.escape-reviews.json`;
  const source = canonicalJson(document);
  mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
  writeFileSync(path.join(root, relativePath), source);
  return { relativePath, sha256: sha256(source), trustAnchorFingerprint };
}

function compactCanonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(compactCanonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${compactCanonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function appendRound(root, ledger, subjectSha, number, historicalSubject = false, escapeReviews) {
  const reviewEvidence = writeReview(root, {
    escapeReviewSha256: escapeReviews?.sha256 ?? null,
    escapeReviewTrustAnchor: escapeReviews?.trustAnchorFingerprint ?? null,
    number,
    subjectSha,
  });
  return appendMetricERound({
    codeSubjectSha: subjectSha,
    date: `2026-07-${String(19 + number).padStart(2, '0')}`,
    escapeReviewEvidence: escapeReviews?.relativePath,
    escapeReviewTrustAnchor: escapeReviews?.trustAnchorFingerprint,
    historicalSubject,
    ledger,
    repoRoot: root,
    reviewEvidence,
  });
}

describe('Metric E comparable-round series', () => {
  it('does not qualify zero-escape rounds backed only by self-declared unauthenticated reviews', () => {
    const root = createMetricERepository();
    const rounds = Array.from({ length: 3 }, (_, index) => ({
      number: index + 1,
      result: { ceilingIncreases: 0, observedIncreases: 0, unsignedEscapes: 0 },
      reviewer: {
        authentication: 'none',
        independence: 'declared-independent-unverified',
      },
    }));

    expect(buildMetricESeries({ rounds, repoRoot: root }).status).toMatchObject({
      completedComparableRounds: 0,
      qualifyingComparableRounds: 0,
      remainingComparableRounds: 3,
      verdict: 'waiting-for-independent-comparable-rounds',
    });
  });

  it('appends a real historical commit without a nonexistent census-graph path', () => {
    const root = createMetricERepository();
    const subjectSha = git(root, ['rev-parse', 'HEAD']);
    const document = appendRound(root, undefined, subjectSha, 1, true);

    expect(validateMetricESeries(document, { repoRoot: root })).toEqual({
      findings: [],
      ok: true,
      summary: { completed: 0, observed: 1, remaining: 3, required: 3 },
    });
    expect(document).toMatchObject({
      rounds: [
        {
          codeSubjectSha: subjectSha,
          number: 1,
          predecessor: null,
          result: {
            ceilingIncreases: 0,
            observedEscapes: 3,
            observedIncreases: 0,
            reviewedEscapeSignatures: 0,
            unsignedEscapes: 3,
          },
          reviewer: {
            authentication: 'none',
            independence: 'declared-independent-unverified',
            verdict: 'accept',
          },
        },
      ],
      status: {
        completedComparableRounds: 0,
        observedRounds: 1,
        qualifyingComparableRounds: 0,
        remainingComparableRounds: 3,
        verdict: 'waiting-for-signed-comparable-rounds',
      },
    });
  });

  it('accepts three real, distinct, chained commits and keeps unsigned escape coverage open', () => {
    const root = createMetricERepository();
    const firstSha = git(root, ['rev-parse', 'HEAD']);
    const first = appendRound(root, undefined, firstSha, 1, true);
    writeFileSync(path.join(root, 'security/metric-e-rounds.json'), canonicalJson(first));
    const secondSha = commitAll(root, 'round one evidence');
    const second = appendRound(root, first, secondSha, 2);
    writeFileSync(path.join(root, 'security/metric-e-rounds.json'), canonicalJson(second));
    const thirdSha = commitAll(root, 'round two evidence');
    const third = appendRound(root, second, thirdSha, 3);

    expect(validateMetricESeries(third, { repoRoot: root })).toMatchObject({
      findings: [],
      ok: true,
      summary: { completed: 0, observed: 3, remaining: 3, required: 3 },
    });
    expect(third.status.verdict).toBe('waiting-for-signed-comparable-rounds');
  }, 60_000);

  it('rejects reverse-history subjects, nonmonotone review times, and misleading extra fields', () => {
    const root = createMetricERepository();
    const firstSha = git(root, ['rev-parse', 'HEAD']);
    const first = appendRound(root, undefined, firstSha, 1, true);
    writeFileSync(path.join(root, 'security/metric-e-rounds.json'), canonicalJson(first));
    const secondSha = commitAll(root, 'round one evidence');
    const second = appendRound(root, first, secondSha, 2);

    const reverseHistory = structuredClone(second);
    reverseHistory.rounds[0].codeSubjectSha = secondSha;
    reverseHistory.rounds[1].codeSubjectSha = firstSha;
    expect(validateMetricESeries(reverseHistory, { repoRoot: root }).findings).toContain(
      'Metric E round 2 code subject does not descend from its predecessor',
    );

    const nonmonotoneTime = structuredClone(second);
    nonmonotoneTime.rounds[1].reviewer.reviewedAt = nonmonotoneTime.rounds[0].reviewer.reviewedAt;
    expect(validateMetricESeries(nonmonotoneTime, { repoRoot: root }).findings).toContain(
      'Metric E round 2 review timestamp is not later than its predecessor',
    );

    const mixedPrecisionTime = structuredClone(second);
    mixedPrecisionTime.rounds[0].reviewer.reviewedAt = '2026-07-20T12:00:00.001Z';
    mixedPrecisionTime.rounds[1].reviewer.reviewedAt = '2026-07-20T12:00:00Z';
    expect(validateMetricESeries(mixedPrecisionTime, { repoRoot: root }).findings).toContain(
      'Metric E round 2 review timestamp is not later than its predecessor',
    );

    const impossibleDate = structuredClone(second);
    impossibleDate.rounds[0].date = '2026-02-30';
    impossibleDate.rounds[0].reviewer.reviewedAt = '2026-02-30T12:00:00Z';
    expect(validateMetricESeries(impossibleDate, { repoRoot: root }).findings).toContain(
      'Metric E round 1 date must be a real YYYY-MM-DD calendar date',
    );

    const unknownFields = structuredClone(second);
    unknownFields.authenticated = true;
    unknownFields.rounds[0].independent = true;
    unknownFields.rounds[0].reviewer.authenticated = true;
    unknownFields.rounds[0].report.reviewed = true;
    unknownFields.rounds[0].ceilings.reviewed = true;
    expect(validateMetricESeries(unknownFields, { repoRoot: root }).findings).toEqual(
      expect.arrayContaining([
        'Metric E series document has unknown or missing fields',
        'Metric E round 1 has unknown or missing fields',
        'Metric E round 1 reviewer descriptor has unknown or missing fields',
        'Metric E round 1 report descriptor has unknown or missing fields',
        'Metric E round 1 ceiling descriptor has unknown or missing fields',
      ]),
    );
  }, 60_000);

  // @kovo-security-certifies C13 metric-e-round-signature-join
  it('records an exact detached Ed25519 set without treating its caller-supplied anchor as independent review', () => {
    const root = createMetricERepository();
    const subjectSha = git(root, ['rev-parse', 'HEAD']);
    const escapeReviews = writeEscapeReviews(root, 1);
    const document = appendRound(root, undefined, subjectSha, 1, true, escapeReviews);

    expect(validateMetricESeries(document, { repoRoot: root })).toEqual({
      findings: [],
      ok: true,
      summary: { completed: 0, observed: 1, remaining: 3, required: 3 },
    });
    expect(document.rounds[0]).toMatchObject({
      escapeReviews: {
        authentication: 'caller-supplied-unverified',
        path: escapeReviews.relativePath,
        sha256: escapeReviews.sha256,
        trustAnchorFingerprint: escapeReviews.trustAnchorFingerprint,
      },
      result: {
        cryptographicallyValidEscapeSignatures: 3,
        observedEscapes: 3,
        reviewedEscapeSignatures: 0,
        unsignedEscapes: 3,
      },
    });
    expect(document.status.verdict).toBe('waiting-for-signed-comparable-rounds');
  });

  it('rejects forged, missing, surplus, stale-subject, and wrong-anchor review sets', () => {
    const cases = [
      {
        label: 'forged signature',
        mutate(document) {
          document.reviews[0].signature = `${document.reviews[0].signature[0] === 'A' ? 'B' : 'A'}${document.reviews[0].signature.slice(1)}`;
          return document;
        },
        pattern: /invalid signature/u,
      },
      {
        label: 'missing envelope',
        mutate(document) {
          document.reviews.pop();
          return document;
        },
        pattern: /non-exact schema or count/u,
      },
      {
        label: 'surplus envelope',
        mutate(document) {
          document.reviews.push(structuredClone(document.reviews[0]));
          return document;
        },
        pattern: /non-exact schema or count/u,
      },
      {
        label: 'stale subject',
        mutate(document) {
          const review = document.reviews.find((entry) => entry.subject.door === 'csrf:false');
          review.subject = {
            ...review.subject,
            root: 'route:stale/root',
          };
          return document;
        },
        pattern: /surplus or duplicated/u,
      },
      {
        label: 'wrong anchor',
        mutate(document) {
          document.reviews[0].trustAnchorFingerprint = `sha256:${'0'.repeat(64)}`;
          return document;
        },
        pattern: /malformed/u,
      },
      {
        label: 'non-printable subject identity',
        mutate(document) {
          document.reviews[0].subject = {
            ...document.reviews[0].subject,
            root: `${document.reviews[0].subject.root}\u202e`,
          };
          return document;
        },
        pattern: /malformed/u,
      },
      {
        label: 'oversized producer-site set',
        mutate(document) {
          document.reviews[0].subject = {
            ...document.reviews[0].subject,
            sites: Array.from(
              { length: 4_097 },
              (_, siteIndex) => `site:${String(siteIndex).padStart(4, '0')}`,
            ),
          };
          return document;
        },
        pattern: /malformed/u,
      },
    ];
    for (const [index, testCase] of cases.entries()) {
      const root = createMetricERepository();
      const subjectSha = git(root, ['rev-parse', 'HEAD']);
      const evidence = writeEscapeReviews(root, index + 1, (document) => testCase.mutate(document));
      const reviewEvidence = writeReview(root, {
        escapeReviewSha256: evidence.sha256,
        escapeReviewTrustAnchor: evidence.trustAnchorFingerprint,
        number: 1,
        subjectSha,
      });
      expect(
        () =>
          appendMetricERound({
            codeSubjectSha: subjectSha,
            date: '2026-07-20',
            escapeReviewEvidence: evidence.relativePath,
            escapeReviewTrustAnchor: evidence.trustAnchorFingerprint,
            historicalSubject: true,
            repoRoot: root,
            reviewEvidence,
          }),
        testCase.label,
      ).toThrow(testCase.pattern);
    }
  });

  it('rejects a 64-byte RSA-512 signature instead of labeling it Ed25519 evidence', () => {
    const root = createMetricERepository();
    const subjectSha = git(root, ['rev-parse', 'HEAD']);
    const evidence = writeEscapeReviews(root, 1, (document) => document, 'rsa-512');
    const reviewEvidence = writeReview(root, {
      escapeReviewSha256: evidence.sha256,
      escapeReviewTrustAnchor: evidence.trustAnchorFingerprint,
      number: 1,
      subjectSha,
    });

    expect(() =>
      appendMetricERound({
        codeSubjectSha: subjectSha,
        date: '2026-07-20',
        escapeReviewEvidence: evidence.relativePath,
        escapeReviewTrustAnchor: evidence.trustAnchorFingerprint,
        historicalSubject: true,
        repoRoot: root,
        reviewEvidence,
      }),
    ).toThrow(/invalid signature/u);
  });

  it('rejects an independent review that does not bind the signed root set and anchor', () => {
    const root = createMetricERepository();
    const subjectSha = git(root, ['rev-parse', 'HEAD']);
    const escapeReviews = writeEscapeReviews(root, 1);
    const reviewEvidence = writeReview(root, { number: 1, subjectSha });

    expect(() =>
      appendMetricERound({
        codeSubjectSha: subjectSha,
        date: '2026-07-20',
        escapeReviewEvidence: escapeReviews.relativePath,
        escapeReviewTrustAnchor: escapeReviews.trustAnchorFingerprint,
        historicalSubject: true,
        repoRoot: root,
        reviewEvidence,
      }),
    ).toThrow(/independent review escape-review (?:digest|trust anchor) does not bind/u);
  });

  it('rejects nonexistent subjects and reports or ceilings not retained by the subject', () => {
    const root = createMetricERepository();
    const subjectSha = git(root, ['rev-parse', 'HEAD']);
    const document = appendRound(root, undefined, subjectSha, 1, true);

    const nonexistent = structuredClone(document);
    nonexistent.rounds[0].codeSubjectSha = '0'.repeat(40);
    expect(validateMetricESeries(nonexistent, { repoRoot: root }).findings.join('\n')).toContain(
      'code subject cannot be verified',
    );

    const fabricated = structuredClone(document);
    fabricated.rounds[0].report.snapshot.packages[0].doors.trustedHtml = 0;
    fabricated.rounds[0].report.snapshot.packages[0].roots.trustedHtml = [];
    fabricated.rounds[0].report.sha256 = sha256(
      canonicalJson(fabricated.rounds[0].report.snapshot),
    );
    expect(validateMetricESeries(fabricated, { repoRoot: root }).findings).toContain(
      'Metric E round 1 report is not the exact baseline report retained by its subject',
    );
  });

  it('rejects arbitrary files and mismatched or rejecting structured review artifacts', () => {
    const root = createMetricERepository();
    const subjectSha = git(root, ['rev-parse', 'HEAD']);
    const document = appendRound(root, undefined, subjectSha, 1, true);

    const arbitrary = structuredClone(document);
    arbitrary.rounds[0].reviewer.evidence.path = 'scripts/metric-e-rounds-gate.mjs';
    arbitrary.rounds[0].reviewer.evidence.sha256 = sha256(
      readFileSync(path.join(root, 'scripts/metric-e-rounds-gate.mjs')),
    );
    expect(validateMetricESeries(arbitrary, { repoRoot: root }).findings.join('\n')).toContain(
      'must be a JSON artifact under security/reviews/metric-e/',
    );

    const reviewPath = document.rounds[0].reviewer.evidence.path;
    const rejecting = JSON.parse(readFileSync(path.join(root, reviewPath), 'utf8'));
    rejecting.verdict = 'reject';
    writeFileSync(path.join(root, reviewPath), canonicalJson(rejecting));
    const rejectionFindings = validateMetricESeries(document, { repoRoot: root }).findings.join(
      '\n',
    );
    expect(rejectionFindings).toContain('review evidence digest drifted');
    expect(rejectionFindings).toContain('verdict must explicitly accept');
  });

  it('requires a new series when a subject changes the fixed corpus or counting inputs', () => {
    const root = createMetricERepository();
    const firstSha = git(root, ['rev-parse', 'HEAD']);
    const first = appendRound(root, undefined, firstSha, 1, true);
    writeFileSync(
      path.join(root, metricEComparableCorpusPaths[0]),
      `${readFileSync(path.join(root, metricEComparableCorpusPaths[0]), 'utf8')}\n// changed corpus\n`,
    );
    const changedSha = commitAll(root, 'change metric corpus');
    writeReview(root, { number: 2, subjectSha: changedSha });

    expect(() =>
      appendMetricERound({
        codeSubjectSha: changedSha,
        date: '2026-07-21',
        ledger: first,
        repoRoot: root,
        reviewEvidence: 'security/reviews/metric-e/round-2.json',
      }),
    ).toThrow('comparability changed; start a reviewed new series');
  });

  it.each([
    'packages/cli/src/commands/build-export.ts',
    'packages/browser/src/security-output.ts',
    'packages/compiler/src/app-graph.ts',
    'packages/drizzle/src/trust-escapes-static.ts',
    'packages/compiler/src/scan/security-operation-ir.ts',
    'packages/core/src/internal/security-operation-ir.ts',
    'packages/drizzle/src/static/framework-identity.ts',
    'packages/verify/src/translation.ts',
    'scripts/lib/security-evidence-subject.mjs',
  ])('requires a new series when the measurement producer %s changes', (measurementPath) => {
    const root = createMetricERepository();
    const firstSha = git(root, ['rev-parse', 'HEAD']);
    const first = appendRound(root, undefined, firstSha, 1, true);
    writeFileSync(
      path.join(root, measurementPath),
      `${readFileSync(path.join(root, measurementPath), 'utf8')}\n// changed measurement producer\n`,
    );
    const changedSha = commitAll(root, 'change metric measurement producer');
    writeReview(root, { number: 2, subjectSha: changedSha });

    expect(() =>
      appendMetricERound({
        codeSubjectSha: changedSha,
        date: '2026-07-21',
        ledger: first,
        repoRoot: root,
        reviewEvidence: 'security/reviews/metric-e/round-2.json',
      }),
    ).toThrow('comparability changed; start a reviewed new series');
  });

  it('requires a new series when complete measurement-producer tree membership changes', () => {
    const root = createMetricERepository();
    const firstSha = git(root, ['rev-parse', 'HEAD']);
    const first = appendRound(root, undefined, firstSha, 1, true);
    const addedPath = path.join(root, metricEComparabilityInputRoots[1], 'new-producer.ts');
    writeFileSync(addedPath, 'export const changesMeasurement = true;\n');
    const changedSha = commitAll(root, 'add metric measurement producer');
    writeReview(root, { number: 2, subjectSha: changedSha });

    expect(() =>
      appendMetricERound({
        codeSubjectSha: changedSha,
        date: '2026-07-21',
        ledger: first,
        repoRoot: root,
        reviewEvidence: 'security/reviews/metric-e/round-2.json',
      }),
    ).toThrow('comparability changed; start a reviewed new series');
  });

  it('requires a new series when the complete app-corpus membership changes', () => {
    const root = createMetricERepository();
    const firstSha = git(root, ['rev-parse', 'HEAD']);
    const first = appendRound(root, undefined, firstSha, 1, true);
    writeFileSync(
      path.join(root, metricEComparableCorpusRoots[0], 'src/imported-fixture.ts'),
      'export const hiddenEscape = true;\n',
    );
    const changedSha = commitAll(root, 'add imported app corpus source');
    writeReview(root, { number: 2, subjectSha: changedSha });

    expect(() =>
      appendMetricERound({
        codeSubjectSha: changedSha,
        date: '2026-07-21',
        ledger: first,
        repoRoot: root,
        reviewEvidence: 'security/reviews/metric-e/round-2.json',
      }),
    ).toThrow('comparability changed; start a reviewed new series');
  });

  it('returns findings instead of throwing for malformed retained rounds', () => {
    const root = createMetricERepository();
    for (const rounds of [[null], [{}], [null, null]]) {
      const document = buildMetricESeries({ rounds, repoRoot: root });
      expect(() => validateMetricESeries(document, { repoRoot: root })).not.toThrow();
      expect(validateMetricESeries(document, { repoRoot: root }).findings.length).toBeGreaterThan(
        0,
      );
    }
  });

  it('rejects app/package split views and surplus ceiling packages', () => {
    const root = createMetricERepository();
    const subjectSha = git(root, ['rev-parse', 'HEAD']);
    const document = appendRound(root, undefined, subjectSha, 1, true);

    const splitView = structuredClone(document);
    const packageReport = splitView.rounds[0].report.snapshot.packages[0];
    packageReport.doors.trustedHtml = 0;
    packageReport.roots.trustedHtml = [];
    splitView.rounds[0].report.sha256 = sha256(canonicalJson(splitView.rounds[0].report.snapshot));
    expect(validateMetricESeries(splitView, { repoRoot: root }).findings.join('\n')).toContain(
      'differs from the exact app-root aggregation',
    );

    const surplusCeiling = structuredClone(document);
    surplusCeiling.rounds[0].ceilings.snapshot.packages['@surplus/example'] = Object.fromEntries(
      surplusCeiling.rounds[0].ceilings.snapshot.packages['@kovojs/security-metric-e-app'] &&
        Object.keys(
          surplusCeiling.rounds[0].ceilings.snapshot.packages['@kovojs/security-metric-e-app'],
        ).map((door) => [door, 0]),
    );
    surplusCeiling.rounds[0].ceilings.sha256 = sha256(
      canonicalJson(surplusCeiling.rounds[0].ceilings.snapshot),
    );
    expect(validateMetricESeries(surplusCeiling, { repoRoot: root }).findings.join('\n')).toContain(
      'report and ceiling package denominators differ',
    );
  }, 60_000);

  it('requires a reviewed new series instead of rewriting a v1 ledger', () => {
    const root = createMetricERepository();
    const ledger = {
      ...buildMetricESeries({ rounds: [], repoRoot: root }),
      schema: 'kovo.metric-e-round-series/v1',
    };
    expect(() => appendMetricERound({ ledger, repoRoot: root })).toThrow(
      'start a reviewed new series',
    );
  });

  it('verifies every review site against exact retained UTF-16 source bytes', () => {
    const cases = [
      {
        label: 'slice hash',
        mutate(site) {
          site.sliceHash = `sha256:${'0'.repeat(64)}`;
        },
      },
      {
        label: 'source hash',
        mutate(site) {
          site.sourceHash = `sha256:${'0'.repeat(64)}`;
        },
      },
      {
        label: 'source length',
        mutate(site) {
          site.sourceLength += 1;
        },
      },
    ];
    for (const testCase of cases) {
      const root = createMetricERepository();
      const baselinePath = path.join(root, defaultEscapeCensusBaselinePath);
      const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
      testCase.mutate(baseline.reviewSubjects[0].manifest.subjects[0].sites[0]);
      writeFileSync(baselinePath, canonicalJson(baseline));
      const subjectSha = commitAll(root, `tamper retained review ${testCase.label}`);
      const reviewEvidence = writeReview(root, { number: 1, subjectSha });
      expect(
        () =>
          appendMetricERound({
            codeSubjectSha: subjectSha,
            date: '2026-07-20',
            historicalSubject: true,
            repoRoot: root,
            reviewEvidence,
          }),
        testCase.label,
      ).toThrow('does not bind retained source bytes');
    }
  }, 60_000);

  it('does not claim signatures verified when a comparable report observes zero escapes', () => {
    const root = createMetricERepository();
    const baselinePath = path.join(root, defaultEscapeCensusBaselinePath);
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    baseline.reviewSubjects[0].manifest.subjects = [];
    for (const report of [...baseline.report.apps, ...baseline.report.packages]) {
      for (const door of Object.keys(report.doors)) {
        report.doors[door] = 0;
        report.roots[door] = [];
      }
    }
    writeFileSync(baselinePath, canonicalJson(baseline));
    const budgetsPath = path.join(root, 'security/escape-budgets.json');
    const budgets = JSON.parse(readFileSync(budgetsPath, 'utf8'));
    for (const door of Object.keys(budgets.packages['@kovojs/security-metric-e-app'])) {
      budgets.packages['@kovojs/security-metric-e-app'][door] = 0;
    }
    writeFileSync(budgetsPath, canonicalJson(budgets));
    const subjectSha = commitAll(root, 'zero escape metric subject');
    const document = appendRound(root, undefined, subjectSha, 1, true);
    expect(document.rounds[0].result).toMatchObject({
      cryptographicallyValidEscapeSignatures: 0,
      observedEscapes: 0,
      unsignedEscapes: 0,
    });
    expect(document.rounds[0].result.signatureCoverage).not.toContain('signatures verify');
  });
});
