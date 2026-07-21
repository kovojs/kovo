import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendMetricERound,
  buildMetricEIndependentReviewArtifact,
  defaultEscapeCensusBaselinePath,
  metricEComparableCorpusPaths,
  metricEComparabilityInputPaths,
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
  { number, reviewer = `reviewer-${number}`, subjectSha, verdict = 'accept' },
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

function appendRound(root, ledger, subjectSha, number, historicalSubject = false) {
  const reviewEvidence = writeReview(root, { number, subjectSha });
  return appendMetricERound({
    codeSubjectSha: subjectSha,
    date: `2026-07-${String(19 + number).padStart(2, '0')}`,
    historicalSubject,
    ledger,
    repoRoot: root,
    reviewEvidence,
  });
}

describe('Metric E comparable-round series', () => {
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
          reviewer: { independence: 'independent-review-pass', verdict: 'accept' },
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
});
