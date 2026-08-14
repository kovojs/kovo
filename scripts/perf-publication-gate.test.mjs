import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PERF_PUBLICATION_INPUT_SCHEMA,
  authenticatePerformancePublicationInput,
  derivePerformancePublication,
  performancePublicationFindings,
  renderPerformancePublicationMarkdown,
  writePerformancePublicationOutputs,
} from './perf-publication-gate.mjs';
import { canonicalJson } from './perf-regression-check.mjs';

const FAMILY_NAMES = [
  'browser',
  'dev-n24',
  'dev-n216',
  'build-n24',
  'build-n216',
  'server',
  'check',
];
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('seven-family performance publication gate', () => {
  it('publishes only after five ratified reports and one independent passing holdout per family', () => {
    const authenticated = authenticatedFixture();
    const result = derivePerformancePublication(authenticated, fixtureDerivationOptions());

    expect(result.publication.verdict).toEqual({
      failures: [],
      reasons: [],
      status: 'publishable',
    });
    expect(performancePublicationFindings(result.publication)).toEqual([]);
    expect(Object.keys(result.documents)).toEqual(FAMILY_NAMES);
    for (const familyName of FAMILY_NAMES) {
      expect(result.publication.families[familyName]).toMatchObject({
        status: 'pass',
        targetAssessment: {
          baseline: { status: 'pass' },
          holdout: { status: 'pass' },
          status: 'pass',
        },
      });
      expect(result.publication.families[familyName].evidence.baseline).toHaveLength(5);
    }
    const markdown = renderPerformancePublicationMarkdown(result.publication);
    expect(markdown).toContain('Verdict: **publishable**');
    expect(markdown).toContain('independent holdout');
    expect(markdown).toContain('Kovo-only');
    expect(markdown).toContain('https://github.com/kovojs/kovo/tree/');
  });

  it('blocks publication when a measured family misses either baseline or holdout targets', () => {
    const options = fixtureDerivationOptions();
    options.operations['dev-n216'] = {
      ...options.operations['dev-n216'],
      evaluate: (budget, candidate) => ({
        budget: budget.digest,
        candidate: { execution: candidate.execution.digest, sourceCommit: candidate.source.commit },
        checks: [
          {
            id: 'corpus-n216/dev//ready.durationMs.median-vs-next',
            kind: 'competitive-target',
            limit: 2,
            status: 'fail',
            value: 2.5,
          },
        ],
        schema: 'fixture-evaluation/v1',
        verdict: {
          failures: ['corpus-n216/dev//ready.durationMs.median-vs-next'],
          reasons: [],
          status: 'regression',
        },
      }),
    };

    const result = derivePerformancePublication(authenticatedFixture(), options);

    expect(result.publication.verdict.status).toBe('blocked');
    expect(result.publication.families['dev-n216'].targetAssessment.holdout.status).toBe('fail');
    expect(result.publication.verdict.failures).toContain(
      'dev-n216:holdout:corpus-n216/dev//ready.durationMs.median-vs-next',
    );
  });

  it('reports unproven when the holdout reuses a baseline workflow run', () => {
    const authenticated = authenticatedFixture();
    authenticated.families.server.holdout.report.execution.github.runUrl =
      authenticated.families.server.baseline[0].report.execution.github.runUrl;

    const result = derivePerformancePublication(authenticated, fixtureDerivationOptions());

    expect(result.publication.verdict.status).toBe('unproven');
    expect(result.publication.verdict.reasons.join('\n')).toContain(
      'server holdout reuses a baseline workflow run',
    );
    expect(result.publication.families.server.status).toBe('unproven');
  });

  it('reports unproven for cross-family source, lock, execution, or custody divergence', () => {
    const authenticated = authenticatedFixture();
    const entry = authenticated.families.check.holdout;
    entry.report.source.locks = {
      ...entry.report.source.locks,
      'pnpm-lock.yaml': digest('changed'),
    };
    entry.report.execution.digest =
      authenticated.families.browser.baseline[0].report.execution.digest;
    entry.custody.reportContentDigest = digest('wrong');

    const result = derivePerformancePublication(authenticated, fixtureDerivationOptions());

    expect(result.publication.verdict.status).toBe('unproven');
    expect(result.publication.verdict.reasons.join('\n')).toMatch(
      /dependency locks differ|duplicate execution identity|custody content digest differs/u,
    );
  });

  it('refuses a short or incomplete seven-family input before reading any path', async () => {
    const input = {
      families: Object.fromEntries(
        FAMILY_NAMES.map((name) => [
          name,
          {
            baseline: Array.from({ length: name === 'browser' ? 4 : 5 }, () => ({})),
            holdout: {},
          },
        ]),
      ),
      repository: 'kovojs/kovo',
      schema: PERF_PUBLICATION_INPUT_SCHEMA,
    };

    await expect(authenticatePerformancePublicationInput(input)).rejects.toThrow(
      'browser must contain exactly five baseline reports and one holdout',
    );
    delete input.families.check;
    await expect(authenticatePerformancePublicationInput(input)).rejects.toThrow(
      'exact seven-family census',
    );

    const profileInput = {
      buildProfiles: { unchanged: {} },
      families: Object.fromEntries(
        FAMILY_NAMES.map((name) => [
          name,
          { baseline: Array.from({ length: 5 }, () => ({})), holdout: {} },
        ]),
      ),
      repository: 'kovojs/kovo',
      schema: PERF_PUBLICATION_INPUT_SCHEMA,
    };
    await expect(authenticatePerformancePublicationInput(profileInput)).rejects.toThrow(
      'buildProfiles must contain exactly unchanged and edit evidence',
    );
  });

  it('writes content-addressed family documents plus the aggregate JSON and Markdown', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kovo-perf-publication-'));
    temporaryDirectories.push(directory);
    const result = derivePerformancePublication(authenticatedFixture(), fixtureDerivationOptions());
    const evidenceDirectory = path.join(directory, 'evidence');
    const out = path.join(directory, 'publication.json');
    const markdownOut = path.join(directory, 'publication.md');

    await writePerformancePublicationOutputs(result, { evidenceDirectory, markdownOut, out });

    const publication = JSON.parse(readFileSync(out, 'utf8'));
    expect(performancePublicationFindings(publication)).toEqual([]);
    expect(readFileSync(markdownOut, 'utf8')).toContain('Verdict: **publishable**');
    for (const familyName of FAMILY_NAMES) {
      for (const kind of ['baseline', 'budget', 'evaluation']) {
        const file = readFileSync(path.join(evidenceDirectory, `${familyName}-${kind}.json`));
        expect(digest(file)).toBe(publication.families[familyName].documents[kind].contentDigest);
      }
    }
  });

  it('detects aggregate-manifest mutation through its canonical digest', () => {
    const result = derivePerformancePublication(authenticatedFixture(), fixtureDerivationOptions());
    result.publication.families.browser.status = 'blocked';

    expect(performancePublicationFindings(result.publication)).toContain(
      'publication digest is not derived from its facts',
    );
  });

  it('publishes the build-session assessment and reports profile-required as unproven', () => {
    const options = fixtureDerivationOptions();
    options.assessBuildPersistence = ({ n24Budget, n216Budget }) =>
      fixturePersistenceAssessment(n24Budget, n216Budget, {
        findings: ['current authenticated N=216 unchanged and edit CPU profiles are required'],
        outcome: 'profile-required',
        rationale: 'current-profile-required',
      });

    const result = derivePerformancePublication(authenticatedFixture(), options);

    expect(result.publication.buildPersistenceAssessment.verdict).toMatchObject({
      outcome: 'profile-required',
      status: 'unproven',
    });
    expect(result.publication.verdict.status).toBe('unproven');
    expect(result.publication.verdict.reasons).toContain(
      'build persistence current authenticated N=216 unchanged and edit CPU profiles are required',
    );
    expect(performancePublicationFindings(result.publication)).toEqual([]);
    expect(renderPerformancePublicationMarkdown(result.publication)).toContain(
      'Outcome: **profile-required** (current-profile-required).',
    );
  });
});

function fixtureDerivationOptions() {
  return {
    assessBuildPersistence: ({ n24Budget, n216Budget }) =>
      fixturePersistenceAssessment(n24Budget, n216Budget),
    generatedAt: '2026-08-14T00:00:00.000Z',
    operations: Object.fromEntries(
      FAMILY_NAMES.map((familyName) => [
        familyName,
        {
          budgetFindings: () => [],
          derive: (baseline) => fixtureBudget(familyName, baseline),
          evaluate: (budget, candidate) => fixtureEvaluation(familyName, budget, candidate),
          targetKinds: targetKinds(familyName),
        },
      ]),
    ),
    ratify(entries) {
      const first = entries[0].report;
      return {
        generatedAt: '2026-08-14T00:00:00.000Z',
        identity: {
          host: first.host.digest,
          locks: first.source.locks,
          source: first.source.commit,
          workload: first.workloadIdentity.digest,
        },
        metrics: {},
        policy: { maxLoadPerCpu: 1, minRuns: 5, minSamples: 5, requireProvider: 'github-actions' },
        reports: entries.map((entry) => ({
          contentDigest: entry.contentDigest,
          execution: entry.report.execution.digest,
          location: entry.location,
          runUrl: entry.report.execution.github.runUrl,
        })),
        schema: 'kovo-performance-baseline/v1',
        subject: {
          host: first.host,
          locks: first.source.locks,
          sourceCommit: first.source.commit,
          workloadIdentity: first.workloadIdentity,
        },
        verdict: { reasons: [], status: 'ratified' },
      };
    },
  };
}

function fixturePersistenceAssessment(
  n24Budget,
  n216Budget,
  {
    findings = [],
    outcome = 'not-warranted',
    rationale = 'all-warm-cells-meet-first-milestone',
  } = {},
) {
  const facts = {
    budgets: { n24: n24Budget.digest, n216: n216Budget.digest },
    cells: [n24Budget, n216Budget].flatMap((budget) =>
      ['unchanged', 'edit'].map((mode) => {
        const profileBranch =
          outcome === 'profile-required' &&
          budget.subject.corpusSize === 216 &&
          mode === 'unchanged';
        return {
          artifactBytes: { kovoMedian: 1_000, kovoP95: 1_010 },
          corpusSize: budget.subject.corpusSize,
          milestone: {
            peakRssMedianVsNextRatio: 1,
            status: profileBranch ? 'fail' : 'pass',
            wallMedianVsNextRatio: profileBranch ? 6.1 : 1,
          },
          mode,
          residualUpper: { medianRatio: profileBranch ? 0.1 : 0.05, samples: 50 },
          wall: {
            kovoMedianMs: profileBranch ? 610 : 100,
            kovoP95Ms: profileBranch ? 620 : 110,
            nextMedianMs: 100,
          },
        };
      }),
    ),
    policy: {
      appSourceTrustEligible: false,
      diskCacheEligible: false,
      sessionEligiblePhases: ['config-trust', 'typescript', 'stylesheet'],
      upperWallMinimumRatio: 0.1,
    },
    profiles: [],
    schema: 'kovo-build-persistence-assessment/v1',
    verdict: {
      findings,
      outcome,
      rationale,
      status: ['profile-required', 'unproven'].includes(outcome) ? 'unproven' : 'decided',
    },
  };
  return { ...facts, digest: digest(canonicalJson(facts)) };
}

function fixtureBudget(familyName, baseline) {
  const common = {
    baseline: { reports: baseline.reports, sourceCommit: baseline.identity.source },
    digest: digest(`${familyName}-budget`),
    policy: {},
    schema: `fixture-${familyName}-budget/v1`,
    subject: {},
  };
  if (familyName === 'browser') {
    return {
      ...common,
      targetAssessment: {
        checks: [{ id: 'browser.navigation', limit: 2, observed: 1.5, status: 'pass' }],
        failures: [],
        status: 'pass',
      },
    };
  }
  if (familyName === 'server') {
    return {
      ...common,
      targetAssessment: {
        checks: [{ id: 'server.requestsPerSecond', limit: 0.8, observed: 1, status: 'pass' }],
        failures: [],
        status: 'pass',
      },
    };
  }
  const corpusSize = familyName.endsWith('n216') ? 216 : 24;
  common.subject.corpusSize = corpusSize;
  if (familyName.startsWith('dev-')) {
    const prefix = `corpus-n${String(corpusSize)}/dev//`;
    common.policy.targets = {
      entryMedianVsNextMaximumRatio: 3,
      leafMedianVsNextMaximumRatio: 2,
      readyMedianVsNextMaximumRatio: 2,
      recoveryP95MaximumMs: 2_000,
      syntaxErrorP95MaximumMs: 1_000,
    };
    common.metrics = Object.fromEntries(
      [
        'ready.durationMs',
        'edit.leafMs',
        'edit.entryMs',
        'edit.syntaxErrorMs',
        'edit.recoveryMs',
      ].map((suffix) => [
        `${prefix}${suffix}`,
        { baseline: { median: 100, nextMedian: 100, p95: 200 } },
      ]),
    );
    return common;
  }
  if (familyName.startsWith('build-')) {
    common.policy.targets = {
      peakRssMedianVsNextMaximumRatio: 2,
      wallMedianVsNextMaximumRatio: 6,
    };
    common.metrics = {};
    for (const mode of ['clean', 'unchanged', 'edit']) {
      for (const metric of ['durationMs', 'peakRssBytes']) {
        common.metrics[`corpus-n${String(corpusSize)}/build/${mode}/${metric}`] = {
          baseline: { median: 100, nextMedian: 100 },
        };
      }
    }
    return common;
  }
  common.metrics = {
    'check.appSourceTrust.marginalScalingExponent': {
      baseline: { p95: 1 },
      targetMaximum: 1.3,
    },
    'check.peakRssBytes': { baseline: { p95: 1_000 }, targetMaximum: 3 * 1024 ** 3 },
    'check.total.marginalScalingExponent': { baseline: { p95: 0.9 }, targetMaximum: 1 },
  };
  return common;
}

function fixtureEvaluation(familyName, budget, candidate) {
  const kind = targetKinds(familyName)[0];
  const server = familyName === 'server';
  return {
    budget: budget.digest,
    candidate: { execution: candidate.execution.digest, sourceCommit: candidate.source.commit },
    checks: [
      {
        id: server ? 'server/requestsPerSecond.median-vs-next' : `${familyName}.target`,
        kind,
        limit: server ? 0.8 : 2,
        status: 'pass',
        value: 1,
      },
    ],
    schema: `fixture-${familyName}-evaluation/v1`,
    verdict: { failures: [], reasons: [], status: 'pass' },
  };
}

function targetKinds(familyName) {
  if (familyName.startsWith('dev-')) return ['competitive-target', 'target'];
  if (familyName.startsWith('build-')) return ['milestone'];
  return ['target'];
}

function authenticatedFixture() {
  const sourceCommit = 'a'.repeat(40);
  const locks = {
    'benchmarks/harness/pnpm-lock.yaml': digest('harness-lock'),
    'benchmarks/nextjs/pnpm-lock.yaml': digest('next-lock'),
    'pnpm-lock.yaml': digest('root-lock'),
  };
  let artifactId = 2_000;
  const families = {};
  for (const familyName of FAMILY_NAMES) {
    const entries = Array.from({ length: 6 }, (_, index) => {
      artifactId += 1;
      const runId = artifactId + 10_000;
      const label = `${familyName}-${String(index)}`;
      const contentDigest = digest(`${label}-report`);
      const runUrl = `https://github.com/kovojs/kovo/actions/runs/${String(runId)}`;
      const location = `${runUrl}/artifacts/${String(artifactId)}`;
      return {
        contentDigest,
        custody: {
          apiResponseDigest: digest(`${label}-api`),
          apiUrl: `https://api.github.com/repos/kovojs/kovo/actions/artifacts/${String(artifactId)}`,
          archiveDigest: digest(`${label}-archive`),
          archiveDownloadUrl: `https://api.github.com/repos/kovojs/kovo/actions/artifacts/${String(artifactId)}/zip`,
          artifactId,
          artifactName: artifactName(familyName),
          createdAt: '2026-08-13T00:00:00Z',
          expiresAt: '2026-11-11T00:00:00Z',
          liveApiResponseDigest: digest(`${label}-api`),
          liveApiVerifiedAt: '2026-08-13T23:59:00Z',
          location,
          reportContentDigest: contentDigest,
          reportMember: familyName === 'check' ? 'check-scaling.json' : 'comparison.json',
          runUrl,
          updatedAt: '2026-08-13T00:01:00Z',
          workflowRunId: runId,
        },
        location,
        rawText: '{}\n',
        report: {
          execution: {
            digest: digest(`${label}-execution`),
            github: { runUrl, sha: sourceCommit },
          },
          host: { digest: digest(`${familyName}-host`) },
          source: { commit: sourceCommit, locks },
          workloadIdentity: { digest: digest(`${familyName}-workload`) },
        },
      };
    });
    families[familyName] = { baseline: entries.slice(0, 5), holdout: entries[5] };
  }
  return { families, repository: 'kovojs/kovo' };
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function artifactName(familyName) {
  return {
    browser: 'kovo-perf-browser-matrix',
    'build-n216': 'kovo-perf-build-n216',
    'build-n24': 'kovo-perf-build-n24',
    check: 'kovo-perf-check-scaling',
    'dev-n216': 'kovo-perf-dev-n216',
    'dev-n24': 'kovo-perf-dev-n24',
    server: 'kovo-perf-server-matrix',
  }[familyName];
}
