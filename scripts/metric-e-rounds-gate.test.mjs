import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendMetricERound as appendMetricERoundWithExternalPolicy,
  buildMetricEIndependentReviewPayload,
  buildMetricESeries,
  defaultEscapeCensusBaselinePath,
  initializeMetricESeries,
  metricEComparableCorpusPaths,
  metricEComparableCorpusRoots,
  metricEComparabilityInputPaths,
  metricEComparabilityInputRoots,
  metricEHistoricalSubjectPaths,
  metricEIndependentReviewPayloadSource,
  metricEIndependentReviewSchema,
  metricEReviewAnchorAuthority,
  metricEReviewAnchorPolicySchema,
  metricERoundsSchema,
  validateMetricESeries,
} from './metric-e-rounds-gate.mjs';
import { repoRoot } from './lib/repo-root.mjs';
import { canonicalJson, sha256 } from './lib/security-evidence-subject.mjs';

const sourceRoot = repoRoot();
const temporaryRoots = [];
const authorities = new Map();

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
  authorities.set(root, createExternalReviewAuthority());
  return root;
}

function createExternalReviewAuthority(keyAlgorithm = 'ed25519') {
  const { privateKey, publicKey } =
    keyAlgorithm === 'rsa-512'
      ? generateKeyPairSync('rsa', { modulusLength: 512 })
      : generateKeyPairSync('ed25519');
  const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
  const trustAnchorFingerprint = `sha256:${createHash('sha256').update(publicKeyDer).digest('hex')}`;
  const policyRoot = mkdtempSync(path.join(tmpdir(), 'kovo-metric-e-anchor-'));
  temporaryRoots.push(policyRoot);
  const policyPath = path.join(policyRoot, 'runtime-attestation-anchor.json');
  writeFileSync(
    policyPath,
    canonicalJson({
      authority: metricEReviewAnchorAuthority,
      schema: metricEReviewAnchorPolicySchema,
      trustAnchorFingerprint,
    }),
  );
  return { keyAlgorithm, policyPath, privateKey, publicKeyDer, trustAnchorFingerprint };
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

function appendMetricERound(options) {
  return appendMetricERoundWithExternalPolicy({
    ...options,
    reviewAnchorPolicyPath:
      options.reviewAnchorPolicyPath ?? authorities.get(options.repoRoot).policyPath,
  });
}

function writeReview(
  root,
  {
    authority = authorities.get(root),
    escapeReviews = null,
    mutate = (document) => document,
    mutatePayload = (payload) => payload,
    number,
    payloadReviewAnchorFingerprint = authority.trustAnchorFingerprint,
    date = `2026-07-${String(19 + number).padStart(2, '0')}`,
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
  const payload = buildMetricEIndependentReviewPayload({
    ceilingSha256: sha256(canonicalJson(ceilings)),
    codeSubjectSha: subjectSha,
    date,
    escapeReviews:
      escapeReviews === null
        ? null
        : {
            path: escapeReviews.relativePath,
            sha256: escapeReviews.sha256,
            trustAnchorFingerprint: escapeReviews.trustAnchorFingerprint,
          },
    number,
    reportSha256: sha256(canonicalJson(baseline.report)),
    reviewAnchorFingerprint: payloadReviewAnchorFingerprint,
    reviewedAt: `${date}T12:00:00Z`,
    reviewer,
    verdict,
  });
  const signedPayload = mutatePayload(structuredClone(payload));
  const keyId = `metric-e-aggregate-${number}`;
  const artifact = mutate({
    keyId,
    payload: signedPayload,
    publicKeySpki: authority.publicKeyDer.toString('base64url'),
    schema: metricEIndependentReviewSchema,
    signature: sign(
      null,
      Buffer.from(metricEIndependentReviewPayloadSource(keyId, signedPayload), 'utf8'),
      authority.privateKey,
    ).toString('base64url'),
    trustAnchorFingerprint: authority.trustAnchorFingerprint,
  });
  mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
  writeFileSync(path.join(root, relativePath), canonicalJson(artifact));
  return relativePath;
}

function writeEscapeReviews(
  root,
  number,
  mutate = (document) => document,
  keyAlgorithm = authorities.get(root).keyAlgorithm,
  authority = keyAlgorithm === authorities.get(root).keyAlgorithm
    ? authorities.get(root)
    : createExternalReviewAuthority(keyAlgorithm),
) {
  const baseline = JSON.parse(
    readFileSync(path.join(root, defaultEscapeCensusBaselinePath), 'utf8'),
  );
  const subjects = baseline.reviewSubjects.flatMap((entry) => entry.manifest.subjects);
  const { privateKey, publicKeyDer, trustAnchorFingerprint } = authority;
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
    escapeReviews: escapeReviews ?? null,
    number,
    subjectSha,
  });
  return appendMetricERound({
    codeSubjectSha: subjectSha,
    date: `2026-07-${String(19 + number).padStart(2, '0')}`,
    escapeReviewEvidence: escapeReviews?.relativePath,
    historicalSubject,
    ledger,
    repoRoot: root,
    reviewAnchorPolicyPath: authorities.get(root).policyPath,
    reviewEvidence,
  });
}

function validateSeries(document, root) {
  return validateMetricESeries(document, {
    repoRoot: root,
    reviewAnchorPolicyPath: authorities.get(root).policyPath,
  });
}

describe('Metric E comparable-round series', () => {
  it('initializes a canonical pending 0/3 ledger without inventing an anchor or review', () => {
    const root = createMetricERepository();
    const document = initializeMetricESeries({ repoRoot: root });

    expect(document.series).toEqual({
      comparability: null,
      id: 'metric-e-representative/v2',
      reviewAnchor: null,
    });
    expect(canonicalJson(document)).not.toContain('"sha256"');
    expect(
      initializeMetricESeries({ repoRoot: path.join(root, 'missing-comparability-inputs') }),
    ).toEqual(document);
    expect(document).toMatchObject({
      rounds: [],
      schema: metricERoundsSchema,
      status: {
        completedComparableRounds: 0,
        observedRounds: 0,
        qualifyingComparableRounds: 0,
        remainingComparableRounds: 3,
        verdict: 'pending-external-independent-rounds',
      },
    });
    expect(validateMetricESeries(document, { repoRoot: root })).toEqual({
      findings: [],
      ok: true,
      summary: { completed: 0, observed: 0, remaining: 3, required: 3 },
    });
    expect(() =>
      initializeMetricESeries({
        existing: { ...document, rounds: [{}] },
        repoRoot: root,
      }),
    ).toThrow(/refuses to overwrite a nonempty/u);
    expect(() =>
      initializeMetricESeries({
        existing: { ...document, schema: 'kovo.metric-e-round-series/v2' },
        repoRoot: root,
      }),
    ).toThrow(/nonempty or non-v3/u);
  });

  it('locks comparability and the external anchor on first append and rejects partial states', () => {
    const root = createMetricERepository();
    const subjectSha = git(root, ['rev-parse', 'HEAD']);
    const pending = initializeMetricESeries({ repoRoot: root });
    const document = appendRound(root, pending, subjectSha, 1, true);

    expect(document.series.comparability).toMatchObject({
      appCorpus: { id: 'metric-e-representative/v2' },
      censusSchema: 'kovo.escape-census/v2',
    });
    expect(document.series.comparability.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(document.series.reviewAnchor).toEqual({
      authority: metricEReviewAnchorAuthority,
      schema: metricEReviewAnchorPolicySchema,
      trustAnchorFingerprint: authorities.get(root).trustAnchorFingerprint,
    });
    expect(validateSeries(document, root).ok).toBe(true);

    for (const field of ['comparability', 'reviewAnchor']) {
      const missingLock = structuredClone(document);
      missingLock.series[field] = null;
      expect(validateSeries(missingLock, root).findings.join('\n'), field).toContain(
        field === 'comparability'
          ? 'nonempty Metric E series lacks its exact locked comparability signature'
          : 'series review anchor differs from the verifier-supplied external policy',
      );
    }

    for (const fields of [['comparability'], ['reviewAnchor'], ['comparability', 'reviewAnchor']]) {
      const preseeded = structuredClone(pending);
      for (const field of fields) preseeded.series[field] = document.series[field];
      expect(validateMetricESeries(preseeded, { repoRoot: root }).findings.join('\n')).toContain(
        'pending Metric E series must leave comparability and review anchor unlocked as null',
      );
      expect(() => initializeMetricESeries({ existing: preseeded, repoRoot: root })).toThrow(
        /malformed or pre-seeded empty ledger/u,
      );
    }

    const preseeded = structuredClone(pending);
    preseeded.series.comparability = document.series.comparability;
    expect(() => appendRound(root, preseeded, subjectSha, 1, true)).toThrow(
      /pending ledger is malformed/u,
    );
  });

  it('does not qualify zero-escape rounds backed only by self-declared unauthenticated reviews', () => {
    const root = createMetricERepository();
    const trustAnchorFingerprint = authorities.get(root).trustAnchorFingerprint;
    const rounds = Array.from({ length: 3 }, (_, index) => ({
      number: index + 1,
      result: {
        ceilingIncreases: 0,
        observedEscapes: 0,
        observedIncreases: 0,
        reviewedEscapeSignatures: 0,
        unsignedEscapes: 0,
      },
      reviewer: {
        authentication: 'none',
        independence: 'declared-independent-unverified',
        trustAnchorFingerprint,
        verdict: 'accept',
      },
    }));

    expect(
      buildMetricESeries({
        repoRoot: root,
        reviewAnchor: {
          authority: metricEReviewAnchorAuthority,
          schema: metricEReviewAnchorPolicySchema,
          trustAnchorFingerprint,
        },
        rounds,
      }).status,
    ).toMatchObject({
      completedComparableRounds: 0,
      qualifyingComparableRounds: 0,
      remainingComparableRounds: 3,
      verdict: 'waiting-for-independent-comparable-rounds',
    });
  });

  it('rejects a nonempty v3 ledger when no verifier-supplied external policy exists', () => {
    const root = createMetricERepository();
    const subjectSha = git(root, ['rev-parse', 'HEAD']);
    const document = appendRound(root, undefined, subjectSha, 1, true);

    expect(validateMetricESeries(document, { repoRoot: root }).findings.join('\n')).toContain(
      'lack their external runtime-attestation anchor policy',
    );
  });

  it('rejects signer material or surplus fields in the external anchor policy', () => {
    const root = createMetricERepository();
    const authority = authorities.get(root);
    const subjectSha = git(root, ['rev-parse', 'HEAD']);
    const document = appendRound(root, undefined, subjectSha, 1, true);
    writeFileSync(
      authority.policyPath,
      canonicalJson({
        authority: metricEReviewAnchorAuthority,
        privateKey: 'forbidden',
        schema: metricEReviewAnchorPolicySchema,
        trustAnchorFingerprint: authority.trustAnchorFingerprint,
      }),
    );

    expect(validateSeries(document, root).findings.join('\n')).toContain(
      'must exactly pin the existing runtime-attestation fingerprint',
    );
  });

  it('rejects an anchor policy that resolves inside the reviewed repository', () => {
    const root = createMetricERepository();
    const authority = authorities.get(root);
    const subjectSha = git(root, ['rev-parse', 'HEAD']);
    const document = appendRound(root, undefined, subjectSha, 1, true);
    const repositoryPolicyPath = path.join(root, 'security/reviews/metric-e/anchor-policy.json');
    mkdirSync(path.dirname(repositoryPolicyPath), { recursive: true });
    writeFileSync(repositoryPolicyPath, readFileSync(authority.policyPath));

    expect(
      validateMetricESeries(document, {
        repoRoot: root,
        reviewAnchorPolicyPath: repositoryPolicyPath,
      }).findings.join('\n'),
    ).toContain('anchor policy must resolve outside the repository');
  });

  it('rejects coherently rewritten and re-signed repository evidence under a replacement key', () => {
    const root = createMetricERepository();
    const externallyPinned = authorities.get(root);
    const replacement = createExternalReviewAuthority();
    const subjectSha = git(root, ['rev-parse', 'HEAD']);
    const escapeReviews = writeEscapeReviews(
      root,
      1,
      (document) => document,
      'ed25519',
      replacement,
    );
    const reviewEvidence = writeReview(root, {
      authority: replacement,
      escapeReviews,
      number: 1,
      subjectSha,
    });
    const coherentlyRewritten = appendMetricERoundWithExternalPolicy({
      codeSubjectSha: subjectSha,
      date: '2026-07-20',
      escapeReviewEvidence: escapeReviews.relativePath,
      historicalSubject: true,
      repoRoot: root,
      reviewAnchorPolicyPath: replacement.policyPath,
      reviewEvidence,
    });

    const findings = validateMetricESeries(coherentlyRewritten, {
      repoRoot: root,
      reviewAnchorPolicyPath: externallyPinned.policyPath,
    }).findings.join('\n');
    expect(findings).toContain(
      'series review anchor differs from the verifier-supplied external policy',
    );
    expect(findings).toContain('escape-review evidence descriptor is malformed');
  });

  it('rejects an aggregate whose key differs from the externally pinned root-set key', () => {
    const root = createMetricERepository();
    const replacement = createExternalReviewAuthority();
    const subjectSha = git(root, ['rev-parse', 'HEAD']);
    const escapeReviews = writeEscapeReviews(root, 1);
    const reviewEvidence = writeReview(root, {
      authority: replacement,
      escapeReviews,
      mutatePayload(payload) {
        payload.round.reviewAnchorFingerprint = replacement.trustAnchorFingerprint;
        return payload;
      },
      number: 1,
      payloadReviewAnchorFingerprint: authorities.get(root).trustAnchorFingerprint,
      subjectSha,
    });

    expect(() =>
      appendMetricERound({
        codeSubjectSha: subjectSha,
        date: '2026-07-20',
        escapeReviewEvidence: escapeReviews.relativePath,
        historicalSubject: true,
        repoRoot: root,
        reviewEvidence,
      }),
    ).toThrow(/root set and aggregate use different anchors/u);
  });

  it('rejects forged, malformed, and stale aggregate independent-review evidence', () => {
    const cases = [
      {
        label: 'forged signature',
        mutate: (document) => {
          document.signature = `${document.signature[0] === 'A' ? 'B' : 'A'}${document.signature.slice(1)}`;
          return document;
        },
        pattern: /invalid Ed25519 signature/u,
      },
      {
        label: 'missing field',
        mutate: (document) => {
          delete document.keyId;
          return document;
        },
        pattern: /unknown or missing fields/u,
      },
      {
        label: 'surplus field',
        mutate: (document) => {
          document.approved = true;
          return document;
        },
        pattern: /unknown or missing fields/u,
      },
      {
        label: 'stale code subject',
        reviewSubject: '0'.repeat(40),
        pattern: /code subject does not bind the reviewed round/u,
      },
    ];
    for (const testCase of cases) {
      const root = createMetricERepository();
      const subjectSha = git(root, ['rev-parse', 'HEAD']);
      const reviewEvidence = writeReview(root, {
        mutate: testCase.mutate,
        number: 1,
        subjectSha: testCase.reviewSubject ?? subjectSha,
      });
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
      ).toThrow(testCase.pattern);
    }
  });

  it('rejects reused aggregate or root-set evidence as another independent round', () => {
    const root = createMetricERepository();
    const firstSha = git(root, ['rev-parse', 'HEAD']);
    const first = appendRound(root, undefined, firstSha, 1, true);
    writeFileSync(path.join(root, 'security/metric-e-rounds.json'), canonicalJson(first));
    const secondSha = commitAll(root, 'round one retained evidence');
    const second = appendRound(root, first, secondSha, 2);
    const reused = structuredClone(second);
    reused.rounds[1].reviewer.evidence = structuredClone(reused.rounds[0].reviewer.evidence);

    expect(validateSeries(reused, root).findings).toContain(
      'Metric E round 2 reuses prior review evidence and is not an independent round',
    );

    const rootSetRepository = createMetricERepository();
    const firstRootSetSha = git(rootSetRepository, ['rev-parse', 'HEAD']);
    const firstRootSetEvidence = writeEscapeReviews(rootSetRepository, 1);
    const firstRootSetRound = appendRound(
      rootSetRepository,
      undefined,
      firstRootSetSha,
      1,
      true,
      firstRootSetEvidence,
    );
    writeFileSync(
      path.join(rootSetRepository, 'security/metric-e-rounds.json'),
      canonicalJson(firstRootSetRound),
    );
    const secondRootSetSha = commitAll(rootSetRepository, 'first root-set review evidence');
    expect(() =>
      appendRound(
        rootSetRepository,
        firstRootSetRound,
        secondRootSetSha,
        2,
        false,
        firstRootSetEvidence,
      ),
    ).toThrow(/reuses prior signed escape-review evidence/u);
  });

  it('appends a real historical commit without a nonexistent census-graph path', () => {
    const root = createMetricERepository();
    const subjectSha = git(root, ['rev-parse', 'HEAD']);
    const document = appendRound(root, undefined, subjectSha, 1, true);

    expect(validateSeries(document, root)).toEqual({
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
            authentication: 'externally-pinned-runtime-attestation-ed25519',
            independence: 'outside-party-process-asserted-not-proven',
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

  it('qualifies three externally authenticated reviews over real distinct chained commits', () => {
    const root = createMetricERepository();
    const firstSha = git(root, ['rev-parse', 'HEAD']);
    const first = appendRound(root, undefined, firstSha, 1, true, writeEscapeReviews(root, 1));
    writeFileSync(path.join(root, 'security/metric-e-rounds.json'), canonicalJson(first));
    const secondSha = commitAll(root, 'round one evidence');
    const second = appendRound(root, first, secondSha, 2, false, writeEscapeReviews(root, 2));
    writeFileSync(path.join(root, 'security/metric-e-rounds.json'), canonicalJson(second));
    const thirdSha = commitAll(root, 'round two evidence');
    const third = appendRound(root, second, thirdSha, 3, false, writeEscapeReviews(root, 3));

    expect(validateSeries(third, root)).toMatchObject({
      findings: [],
      ok: true,
      summary: { completed: 3, observed: 3, remaining: 0, required: 3 },
    });
    expect(third.status.verdict).toBe('round-count-complete');
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
    expect(validateSeries(reverseHistory, root).findings).toContain(
      'Metric E round 2 code subject does not descend from its predecessor',
    );

    const nonmonotoneTime = structuredClone(second);
    nonmonotoneTime.rounds[1].reviewer.reviewedAt = nonmonotoneTime.rounds[0].reviewer.reviewedAt;
    expect(validateSeries(nonmonotoneTime, root).findings).toContain(
      'Metric E round 2 review timestamp is not later than its predecessor',
    );

    const mixedPrecisionTime = structuredClone(second);
    mixedPrecisionTime.rounds[0].reviewer.reviewedAt = '2026-07-20T12:00:00.001Z';
    mixedPrecisionTime.rounds[1].reviewer.reviewedAt = '2026-07-20T12:00:00Z';
    expect(validateSeries(mixedPrecisionTime, root).findings).toContain(
      'Metric E round 2 review timestamp is not later than its predecessor',
    );

    const impossibleDate = structuredClone(second);
    impossibleDate.rounds[0].date = '2026-02-30';
    impossibleDate.rounds[0].reviewer.reviewedAt = '2026-02-30T12:00:00Z';
    expect(validateSeries(impossibleDate, root).findings).toContain(
      'Metric E round 1 date must be a real YYYY-MM-DD calendar date',
    );

    const unknownFields = structuredClone(second);
    unknownFields.authenticated = true;
    unknownFields.rounds[0].independent = true;
    unknownFields.rounds[0].reviewer.authenticated = true;
    unknownFields.rounds[0].report.reviewed = true;
    unknownFields.rounds[0].ceilings.reviewed = true;
    expect(validateSeries(unknownFields, root).findings).toEqual(
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
  it('qualifies an exact detached Ed25519 set only under the external runtime anchor', () => {
    const root = createMetricERepository();
    const subjectSha = git(root, ['rev-parse', 'HEAD']);
    const escapeReviews = writeEscapeReviews(root, 1);
    const document = appendRound(root, undefined, subjectSha, 1, true, escapeReviews);

    expect(validateSeries(document, root)).toEqual({
      findings: [],
      ok: true,
      summary: { completed: 1, observed: 1, remaining: 2, required: 3 },
    });
    expect(document.rounds[0]).toMatchObject({
      escapeReviews: {
        authentication: 'externally-pinned-runtime-attestation-ed25519',
        path: escapeReviews.relativePath,
        sha256: escapeReviews.sha256,
        trustAnchorFingerprint: escapeReviews.trustAnchorFingerprint,
      },
      result: {
        cryptographicallyValidEscapeSignatures: 3,
        observedEscapes: 3,
        reviewedEscapeSignatures: 3,
        unsignedEscapes: 0,
      },
    });
    expect(document.status.verdict).toBe('waiting-for-independent-comparable-rounds');
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
        escapeReviews: evidence,
        number: 1,
        subjectSha,
      });
      expect(
        () =>
          appendMetricERound({
            codeSubjectSha: subjectSha,
            date: '2026-07-20',
            escapeReviewEvidence: evidence.relativePath,
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
    const rsaAuthority = createExternalReviewAuthority('rsa-512');
    authorities.set(root, rsaAuthority);
    const subjectSha = git(root, ['rev-parse', 'HEAD']);
    const evidence = writeEscapeReviews(root, 1, (document) => document, 'rsa-512', rsaAuthority);
    const reviewEvidence = writeReview(root, {
      authority: rsaAuthority,
      escapeReviews: evidence,
      number: 1,
      subjectSha,
    });

    expect(() =>
      appendMetricERound({
        codeSubjectSha: subjectSha,
        date: '2026-07-20',
        escapeReviewEvidence: evidence.relativePath,
        historicalSubject: true,
        repoRoot: root,
        reviewEvidence,
      }),
    ).toThrow(/invalid signature/u);

    const aggregateRoot = createMetricERepository();
    const aggregateRsaAuthority = createExternalReviewAuthority('rsa-512');
    authorities.set(aggregateRoot, aggregateRsaAuthority);
    const aggregateSubjectSha = git(aggregateRoot, ['rev-parse', 'HEAD']);
    const aggregateReviewEvidence = writeReview(aggregateRoot, {
      authority: aggregateRsaAuthority,
      number: 1,
      subjectSha: aggregateSubjectSha,
    });
    expect(() =>
      appendMetricERound({
        codeSubjectSha: aggregateSubjectSha,
        date: '2026-07-20',
        historicalSubject: true,
        repoRoot: aggregateRoot,
        reviewEvidence: aggregateReviewEvidence,
      }),
    ).toThrow(/invalid Ed25519 signature/u);
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
        historicalSubject: true,
        repoRoot: root,
        reviewEvidence,
      }),
    ).toThrow(/independent review escape-review artifact does not bind/u);
  });

  it('rejects nonexistent subjects and reports or ceilings not retained by the subject', () => {
    const root = createMetricERepository();
    const subjectSha = git(root, ['rev-parse', 'HEAD']);
    const document = appendRound(root, undefined, subjectSha, 1, true);

    const nonexistent = structuredClone(document);
    nonexistent.rounds[0].codeSubjectSha = '0'.repeat(40);
    expect(validateSeries(nonexistent, root).findings.join('\n')).toContain(
      'code subject cannot be verified',
    );

    const fabricated = structuredClone(document);
    fabricated.rounds[0].report.snapshot.packages[0].doors.trustedHtml = 0;
    fabricated.rounds[0].report.snapshot.packages[0].roots.trustedHtml = [];
    fabricated.rounds[0].report.sha256 = sha256(
      canonicalJson(fabricated.rounds[0].report.snapshot),
    );
    expect(validateSeries(fabricated, root).findings).toContain(
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
    expect(validateSeries(arbitrary, root).findings.join('\n')).toContain(
      'must be a JSON artifact under security/reviews/metric-e/',
    );

    const reviewPath = document.rounds[0].reviewer.evidence.path;
    expect(writeReview(root, { number: 1, subjectSha, verdict: 'reject' })).toBe(reviewPath);
    const rejectionFindings = validateSeries(document, root).findings.join('\n');
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
      expect(() => validateSeries(document, root)).not.toThrow();
      expect(validateSeries(document, root).findings.length).toBeGreaterThan(0);
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
    expect(validateSeries(splitView, root).findings.join('\n')).toContain(
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
    expect(validateSeries(surplusCeiling, root).findings.join('\n')).toContain(
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
