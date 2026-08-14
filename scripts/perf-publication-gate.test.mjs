import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PERF_PUBLICATION_INPUT_SCHEMA,
  authenticatePerformancePublicationInput,
  buildProfilePublicationFindings,
  derivePerformancePublication,
  performancePublicationFindings,
  performancePublicationResultFindings,
  renderPerformancePublicationMarkdown,
  writePerformancePublicationOutputs,
} from './perf-publication-gate.mjs';
import { deriveBuildProfileSetAnalysis } from './lib/perf-build-profile-classifier.mjs';
import {
  deriveBuildProcessCpuEvidence,
  mergeBuildProcessProfiles,
} from './perf-build-session-profile.mjs';
import { KOVO_BUILD_SOURCE_PHASES } from './perf-build-benchmark.mjs';
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
    const options = fixtureDerivationOptions();
    const result = derivePerformancePublication(authenticated, options);

    expect(result.publication.verdict).toEqual({
      failures: [],
      reasons: [],
      status: 'publishable',
    });
    expect(performancePublicationFindings(result.publication)).toEqual([]);
    expect(
      performancePublicationResultFindings(result, {
        assessBuildPersistence: options.assessBuildPersistence,
        authenticated,
        operations: options.operations,
        ratify: (entries) => options.ratify(entries),
      }),
    ).toEqual([]);
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
    const authenticated = authenticatedFixture();
    const options = fixtureDerivationOptions();
    const result = derivePerformancePublication(authenticated, options);
    const evidenceDirectory = path.join(directory, 'evidence');
    const out = path.join(directory, 'publication.json');
    const markdownOut = path.join(directory, 'publication.md');

    await writePerformancePublicationOutputs(result, {
      assessBuildPersistence: options.assessBuildPersistence,
      authenticated,
      evidenceDirectory,
      markdownOut,
      operations: options.operations,
      out,
      ratify: (entries) => options.ratify(entries),
    });

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

  it('rejects a readback directory containing evidence outside the exact 21-file census', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kovo-perf-publication-extra-'));
    temporaryDirectories.push(directory);
    const evidenceDirectory = path.join(directory, 'evidence');
    mkdirSync(evidenceDirectory);
    writeFileSync(path.join(evidenceDirectory, 'stale.json'), '{}\n');
    const authenticated = authenticatedFixture();
    const options = fixtureDerivationOptions();
    const result = derivePerformancePublication(authenticated, options);

    await expect(
      writePerformancePublicationOutputs(result, {
        assessBuildPersistence: options.assessBuildPersistence,
        authenticated,
        evidenceDirectory,
        markdownOut: path.join(directory, 'publication.md'),
        operations: options.operations,
        out: path.join(directory, 'publication.json'),
        ratify: (entries) => options.ratify(entries),
      }),
    ).rejects.toThrow('exact 21-file census');
  });

  it('detects aggregate-manifest mutation through its canonical digest', () => {
    const result = derivePerformancePublication(authenticatedFixture(), fixtureDerivationOptions());
    result.publication.families.browser.status = 'blocked';

    expect(performancePublicationFindings(result.publication)).toContain(
      'publication digest is not derived from its facts',
    );
  });

  it('rejects a resealed evidence reference whose workflow head differs from its source', () => {
    const result = derivePerformancePublication(authenticatedFixture(), fixtureDerivationOptions());
    const evidence = result.publication.families.browser.evidence.baseline[0];
    const advancedSha = 'c'.repeat(40);
    evidence.workflow.workflowSha = advancedSha;
    evidence.workflow.workflowHeadSha = advancedSha;
    evidence.workflow.workflowApiUrl = `https://api.github.com/repos/kovojs/kovo/contents/.github/workflows/perf-realistic.yml?ref=${advancedSha}`;
    resealPublication(result.publication);

    expect(performancePublicationFindings(result.publication)).toContain(
      'browser baseline live workflow authority differs from baseline policy',
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

  it('rejects a self-consistently resealed evaluation and target policy mutation', async () => {
    const authenticated = authenticatedFixture();
    const options = fixtureDerivationOptions();
    const result = derivePerformancePublication(authenticated, options);
    const evaluation = result.documents.browser.evaluation;
    evaluation.checks[0].limit = 1_000_000;
    const reference = result.publication.families.browser.documents.evaluation;
    reference.contentDigest = digest(`${JSON.stringify(evaluation, null, 2)}\n`);
    reference.semanticDigest = canonicalDigest(evaluation);
    result.publication.families.browser.targetAssessment.holdout.checks[0].limit = 1_000_000;
    resealPublication(result.publication);

    expect(performancePublicationFindings(result.publication)).toEqual([]);
    const findings = performancePublicationResultFindings(result, {
      assessBuildPersistence: options.assessBuildPersistence,
      authenticated,
      operations: options.operations,
      ratify: (entries) => options.ratify(entries),
    });
    expect(findings.join('\n')).toMatch(/evaluation document differs|aggregate summary differs/u);

    const directory = mkdtempSync(path.join(os.tmpdir(), 'kovo-perf-publication-mutation-'));
    temporaryDirectories.push(directory);
    await expect(
      writePerformancePublicationOutputs(result, {
        assessBuildPersistence: options.assessBuildPersistence,
        authenticated,
        evidenceDirectory: path.join(directory, 'evidence'),
        markdownOut: path.join(directory, 'publication.md'),
        operations: options.operations,
        out: path.join(directory, 'publication.json'),
        ratify: (entries) => options.ratify(entries),
      }),
    ).rejects.toThrow('Performance publication result is invalid');
  });

  it('rejects a resealed deletion of one complete family document set', () => {
    const authenticated = authenticatedFixture();
    const options = fixtureDerivationOptions();
    const result = derivePerformancePublication(authenticated, options);
    const family = result.publication.families.browser;
    result.publication.families.browser = {
      architecture: family.architecture,
      comparisonPosture: family.comparisonPosture,
      documents: null,
      evidence: null,
      host: null,
      holdoutEvaluation: null,
      status: 'unproven',
      targetAssessment: null,
      workload: null,
    };
    delete result.documents.browser;
    result.publication.verdict = {
      failures: [],
      reasons: ['browser evidence was removed'],
      status: 'unproven',
    };
    resealPublication(result.publication);

    expect(performancePublicationFindings(result.publication)).toEqual([]);
    expect(
      performancePublicationResultFindings(result, {
        assessBuildPersistence: options.assessBuildPersistence,
        authenticated,
        operations: options.operations,
        ratify: (entries) => options.ratify(entries),
      }).join('\n'),
    ).toMatch(/browser baseline document differs|exact 21 derived documents/u);
  });

  it('rejects a self-consistently resealed build-persistence assessment mutation', () => {
    const authenticated = authenticatedFixture();
    const options = fixtureDerivationOptions();
    const result = derivePerformancePublication(authenticated, options);
    result.publication.buildPersistenceAssessment.cells[0].wall.kovoP95Ms += 1;
    resealDocument(result.publication.buildPersistenceAssessment);
    resealPublication(result.publication);

    expect(performancePublicationFindings(result.publication)).toEqual([]);
    expect(
      performancePublicationResultFindings(result, {
        assessBuildPersistence: options.assessBuildPersistence,
        authenticated,
        operations: options.operations,
        ratify: (entries) => options.ratify(entries),
      }).join('\n'),
    ).toContain('build persistence assessment differs from its exact budgets and profile evidence');
  });

  it('accepts the required config-static-trust profile when source posture executed it', () => {
    const entry = buildProfileEntryFixture('unchanged');

    expect(entry.report.profileArtifacts.map(({ role }) => role)).toContain('config-static-trust');
    expect(buildProfilePublicationFindings(entry, 'unchanged')).toEqual([]);
  });

  it.each(['not-applicable', 'reused-authenticated'])(
    'accepts the exact eight-role profile set when config trust is %s',
    (configTrustStatus) => {
      const entry = buildProfileEntryFixture('unchanged', {
        configTrustStatus,
      });

      expect(entry.report.profileArtifacts.map(({ role }) => role)).not.toContain(
        'config-static-trust',
      );
      expect(buildProfilePublicationFindings(entry, 'unchanged')).toEqual([]);
    },
  );

  it('rejects a missing config-static-trust process when source posture executed it', () => {
    const entry = buildProfileEntryFixture('unchanged');
    entry.report.capture.processCensus.processes =
      entry.report.capture.processCensus.processes.filter(
        ({ role }) => role !== 'config-static-trust',
      );
    resealBuildProfileEntry(entry);

    expect(buildProfilePublicationFindings(entry, 'unchanged').join('\n')).toContain(
      'process PID/role census is incomplete or duplicated',
    );
  });

  it('rejects a missing config-static-trust profile when source posture executed it', () => {
    const entry = buildProfileEntryFixture('unchanged', {
      configTrustStatus: 'not-applicable',
    });
    profileConfigTrustPhase(entry).status = 'executed';
    resealBuildProfileEntry(entry);

    expect(buildProfilePublicationFindings(entry, 'unchanged')).toContain(
      'unchanged original-process profile census differs from policy',
    );
  });

  it('rejects an extra config-static-trust profile when source posture did not execute it', () => {
    const entry = buildProfileEntryFixture('unchanged');
    profileConfigTrustPhase(entry).status = 'reused-authenticated';
    resealBuildProfileEntry(entry);

    expect(buildProfilePublicationFindings(entry, 'unchanged')).toContain(
      'unchanged original-process profile census differs from policy',
    );
  });

  it('rejects malformed or timing-bearing source phase posture before raw derivation', () => {
    const entry = buildProfileEntryFixture('unchanged');
    entry.report.sourcePhasePosture.phases[0].durationMs = 1;
    resealBuildProfileEntry(entry);

    expect(buildProfilePublicationFindings(entry, 'unchanged').join('\n')).toContain(
      'unchanged build profile source phase posture is unavailable',
    );
  });

  it('fails closed instead of throwing on malformed build-profile evidence', () => {
    const entry = buildProfileEntryFixture('unchanged');
    entry.rawText = {};
    entry.report.profileArtifacts = [null];
    entry.custody.archiveMembers = [null];

    expect(() => buildProfilePublicationFindings(entry, 'unchanged')).not.toThrow();
    expect(buildProfilePublicationFindings(entry, 'unchanged').length).toBeGreaterThan(0);
  });

  it('rejects a dispatch build profile whose evaluated workflow is not the measured source', () => {
    const entry = buildProfileEntryFixture('unchanged');
    const advancedSha = 'c'.repeat(40);
    entry.custody.workflow.workflowSha = advancedSha;
    entry.custody.workflow.workflowHeadSha = advancedSha;
    entry.custody.workflow.workflowApiUrl = `https://api.github.com/repos/kovojs/kovo/contents/.github/workflows/perf-realistic.yml?ref=${advancedSha}`;
    entry.report.execution.github.workflowSha = advancedSha;
    resealBuildProfileEntry(entry);

    expect(buildProfilePublicationFindings(entry, 'unchanged')).toContain(
      'unchanged build profile workflow authority differs from policy',
    );
  });

  it('requires the shared build-profile ZIP to equal the exact two-mode declared union', () => {
    const authenticated = authenticatedFixture();
    authenticated.buildProfiles = buildProfileEntryPairFixture();
    const options = fixtureDerivationOptions();

    expect(derivePerformancePublication(authenticated, options).publication.verdict.status).toBe(
      'publishable',
    );

    for (const entry of authenticated.buildProfiles) {
      entry.custody.archiveMembers.push(
        archiveMemberFixture('undeclared-stale.bin', Buffer.from('stale')),
      );
      entry.custody.archiveMembers.sort((left, right) => left.member.localeCompare(right.member));
    }
    expect(
      derivePerformancePublication(authenticated, options).publication.verdict.reasons.join('\n'),
    ).toContain('build profile ZIP census differs from the exact two-mode declared union');
  });

  it('rejects a resealed authored top five that differs from the raw process profiles', () => {
    const entry = buildProfileEntryFixture('unchanged');
    entry.report.topFive[0].selfSamples += 1;
    entry.report.capture.profileSetAnalysis.topFive[0].selfSamples += 1;
    resealBuildProfileEntry(entry);

    expect(buildProfilePublicationFindings(entry, 'unchanged').join('\n')).toContain(
      'profile analysis and top five are not derived from raw originals',
    );
  });

  it('rejects resealed wait-sample and process-role claims not present in raw evidence', () => {
    const entry = buildProfileEntryFixture('unchanged');
    entry.report.profileArtifacts[0].waitSamples -= 1;
    entry.report.profileArtifacts[0].activeSamples += 1;
    entry.report.capture.profileSetAnalysis.profileCensus[0].waitSamples -= 1;
    entry.report.capture.profileSetAnalysis.profileCensus[0].activeSamples += 1;
    entry.report.capture.processCensus.processes[1].role = 'native-one-shot';
    resealBuildProfileEntry(entry);

    const findings = buildProfilePublicationFindings(entry, 'unchanged').join('\n');
    expect(findings).toContain('sample census is not derived from raw bytes');
    expect(findings).toContain('process PID, role, executable, or entry identity is malformed');
  });

  it('rejects a self-consistently rebound convenience profile that is not the raw-profile merge', () => {
    const entry = buildProfileEntryFixture('unchanged');
    const auxiliary = entry.auxiliaries.find(
      ({ member }) => member === 'build-unchanged.cpuprofile',
    );
    auxiliary.bytes = Buffer.concat([auxiliary.bytes, Buffer.from('\n')]);
    auxiliary.contentDigest = digest(auxiliary.bytes);
    entry.report.profileArtifact.bytes = auxiliary.bytes.length;
    entry.report.profileArtifact.sha256 = auxiliary.contentDigest;
    rebindAuxiliaryCustody(entry, auxiliary);
    resealBuildProfileEntry(entry);

    expect(buildProfilePublicationFindings(entry, 'unchanged').join('\n')).toContain(
      'merged profile convenience bytes are not derived from raw originals',
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
          baselineFindings: () => [],
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
      const runApiUrl = `https://api.github.com/repos/kovojs/kovo/actions/runs/${String(runId)}`;
      const jobsApiUrl = `${runApiUrl}/jobs?filter=all&per_page=100`;
      const location = `${runUrl}/artifacts/${String(artifactId)}`;
      const job = workflowJob(familyName);
      const jobId = artifactId + 20_000;
      return {
        contentDigest,
        custody: {
          apiAuthorityDigest: digest(`${label}-artifact-authority`),
          apiResponseDigest: digest(`${label}-api`),
          apiUrl: `https://api.github.com/repos/kovojs/kovo/actions/artifacts/${String(artifactId)}`,
          archiveDigest: digest(`${label}-archive`),
          archiveByteLength: 123,
          archiveDownloadUrl: `https://api.github.com/repos/kovojs/kovo/actions/artifacts/${String(artifactId)}/zip`,
          archiveMembers: [
            {
              byteLength: 3,
              compressedByteLength: 3,
              compressionMethod: 0,
              contentDigest,
              crc32: 'crc32:00000000',
              member: familyName === 'check' ? 'check-scaling.json' : 'comparison.json',
            },
          ],
          artifactId,
          artifactDigest: digest(`${label}-archive`),
          artifactName: artifactName(familyName),
          artifactSizeInBytes: 123,
          createdAt: '2026-08-13T00:00:00Z',
          expiresAt: '2026-11-11T00:00:00Z',
          jobsApiAuthorityDigest: digest(`${label}-jobs-authority`),
          jobsApiResponseDigest: digest(`${label}-jobs-api`),
          jobsApiUrl,
          liveApiAuthorityDigest: digest(`${label}-artifact-authority`),
          liveApiResponseDigest: digest(`${label}-live-api`),
          liveJobsApiResponseDigest: digest(`${label}-live-jobs-api`),
          liveJobsApiAuthorityDigest: digest(`${label}-jobs-authority`),
          liveRunApiResponseDigest: digest(`${label}-live-run-api`),
          liveRunApiAuthorityDigest: digest(`${label}-run-authority`),
          liveApiVerifiedAt: '2026-08-13T23:59:00Z',
          location,
          reportContentDigest: contentDigest,
          reportMember: familyName === 'check' ? 'check-scaling.json' : 'comparison.json',
          runApiAuthorityDigest: digest(`${label}-run-authority`),
          runApiResponseDigest: digest(`${label}-run-api`),
          runApiUrl,
          runUrl,
          updatedAt: '2026-08-13T00:01:00Z',
          workflowApiResponseDigest: digest(`${label}-workflow-api`),
          workflow: {
            artifactUpload: workflowArtifactUpload(familyName),
            conclusion: 'success',
            event: 'workflow_dispatch',
            headSha: sourceCommit,
            job: {
              apiUrl: `https://api.github.com/repos/kovojs/kovo/actions/jobs/${String(jobId)}`,
              completedAt: '2026-08-13T00:01:00Z',
              conclusion: 'success',
              id: jobId,
              key: job.key,
              name: job.name,
              runAttempt: 1,
              startedAt: '2026-08-13T00:00:00Z',
              status: 'completed',
            },
            jobsApiUrl,
            name: 'Perf Realistic Tier',
            path: '.github/workflows/perf-realistic.yml',
            runApiUrl,
            runAttempt: 1,
            sourceSha: sourceCommit,
            status: 'completed',
            triggerPolicy: 'baseline',
            triggerScope: 'workflow-dispatch:measurement_scope=baselines-or-all',
            workflowApiUrl: `https://api.github.com/repos/kovojs/kovo/contents/.github/workflows/perf-realistic.yml?ref=${sourceCommit}`,
            workflowContentDigest: digest('trusted-workflow'),
            workflowGitBlobSha: 'f'.repeat(40),
            workflowHeadSha: sourceCommit,
            workflowRef: 'kovojs/kovo/.github/workflows/perf-realistic.yml@refs/heads/main',
            workflowSha: sourceCommit,
          },
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

function canonicalDigest(value) {
  return digest(canonicalJson(value));
}

function resealPublication(publication) {
  const facts = { ...publication };
  delete facts.digest;
  publication.digest = canonicalDigest(facts);
}

function resealDocument(document) {
  const facts = { ...document };
  delete facts.digest;
  document.digest = canonicalDigest(facts);
}

function buildProfileEntryFixture(mode, { configTrustStatus = 'executed' } = {}) {
  const sourceCommit = 'a'.repeat(40);
  const workflowRunId = 9_001;
  const artifactId = 9_002;
  const requireConfigStaticTrust = configTrustStatus === 'executed';
  const rawInputs = buildRawProfileFixtures(mode, { requireConfigStaticTrust });
  const inspected = deriveBuildProfileSetAnalysis(
    rawInputs.map(({ bytes, role }) => ({ bytes, role })),
    { nativeOrUnprofiledSamples: 0, requireConfigStaticTrust },
  );
  const profileInputs = rawInputs.map((entry, index) => ({
    ...entry,
    facts: {
      activeSamples: inspected.profileCensus[index].activeSamples,
      idleSamples: inspected.profileCensus[index].idleSamples,
      negativeTimeDeltas: inspected.profileCensus[index].negativeTimeDeltas,
      nodes: inspected.profileCensus[index].nodes,
      samples: inspected.profileCensus[index].samples,
      waitSamples: inspected.profileCensus[index].waitSamples,
    },
  }));
  const processCensus = buildProcessCensusFixture(profileInputs);
  const processCpuBytes = Buffer.from(
    'kovo-build-process-cpu/v1 interval=10000 user=5.000000 system=0.000000 exit=0\n',
  );
  const processCpu = deriveBuildProcessCpuEvidence({
    processCensus,
    processCpuBytes,
    profileInputs,
  });
  const profileSetAnalysis = deriveBuildProfileSetAnalysis(
    profileInputs.map(({ bytes, role }) => ({ bytes, role })),
    {
      nativeOrUnprofiledSamples: processCpu.cause.equivalentSamples,
      requireConfigStaticTrust,
    },
  );
  const merged = mergeBuildProcessProfiles(profileInputs);
  const profileArtifacts = profileInputs.map((entry, index) => ({
    activeSamples: profileSetAnalysis.profileCensus[index].activeSamples,
    bytes: entry.bytes.length,
    idleSamples: profileSetAnalysis.profileCensus[index].idleSamples,
    member: entry.member,
    negativeTimeDeltas: profileSetAnalysis.profileCensus[index].negativeTimeDeltas,
    nodes: profileSetAnalysis.profileCensus[index].nodes,
    pid: entry.pid,
    role: entry.role,
    samples: profileSetAnalysis.profileCensus[index].samples,
    sha256: digest(entry.bytes),
    waitSamples: profileSetAnalysis.profileCensus[index].waitSamples,
  }));
  const mergedMember = `build-${mode}.cpuprofile`;
  const processCpuMember = `process-cpu-${mode}.txt`;
  const reportMember = `profile-${mode}.json`;
  const artifactMembers = [
    mergedMember,
    processCpuMember,
    reportMember,
    ...profileArtifacts.map(({ member }) => member),
  ].sort((left, right) => left.localeCompare(right));
  const locks = {
    'benchmarks/harness/pnpm-lock.yaml': digest('harness-lock'),
    'benchmarks/nextjs/pnpm-lock.yaml': digest('next-lock'),
    'pnpm-lock.yaml': digest('root-lock'),
  };
  const source = { commit: sourceCommit, dirty: false, dirtyPaths: [], locks };
  const reportFacts = {
    artifactMembers,
    capture: {
      ...merged.census,
      processCensus,
      processCpu,
      profileSetAnalysis,
    },
    classifier: 'kovo-build-session-eligibility/phase-v1',
    diagnosticOnly: { profilerPerturbsDurations: true, publishTimingClaims: false },
    execution: {
      digest: digest('build-profile-execution'),
      github: {
        runUrl: `https://github.com/kovojs/kovo/actions/runs/${String(workflowRunId)}`,
        sha: sourceCommit,
        workflowSha: sourceCommit,
      },
    },
    host: { digest: digest('build-profile-host') },
    integrity: {
      complete: true,
      errors: [],
      processCensusComplete: true,
      processCpuComplete: true,
      profileFlushedBeforeExit: true,
      sourceStable: true,
    },
    processCpuArtifact: {
      bytes: processCpuBytes.length,
      fileName: processCpuMember,
      sha256: digest(processCpuBytes),
    },
    profileArtifact: {
      bytes: merged.bytes.length,
      fileName: mergedMember,
      sha256: digest(merged.bytes),
    },
    profileArtifacts,
    schema: 'kovo-build-session-cpu-profile/v1',
    source,
    sourceAfter: structuredClone(source),
    sourcePhasePosture: {
      complete: true,
      phases: KOVO_BUILD_SOURCE_PHASES.map((name) => ({
        name,
        status: name === 'config-trust' ? configTrustStatus : 'executed',
      })),
      schema: 'kovo-build-source-phase-posture/v1',
    },
    subject: {
      baselineWorkloadDigest: digest('build-profile-workload'),
      corpusSize: 216,
      mode,
    },
    topFive: profileSetAnalysis.topFive,
    verdict: { reasons: [], status: 'diagnostic' },
    workloadIdentity: { digest: digest('build-profile-workload') },
  };
  const report = { ...reportFacts, digest: canonicalDigest(reportFacts) };
  const rawText = `${JSON.stringify(report, null, 2)}\n`;
  const contentDigest = digest(rawText);
  const auxiliaries = [
    { bytes: merged.bytes, contentDigest: digest(merged.bytes), member: mergedMember },
    {
      bytes: processCpuBytes,
      contentDigest: digest(processCpuBytes),
      member: processCpuMember,
    },
    ...profileInputs.map(({ bytes, member }) => ({
      bytes,
      contentDigest: digest(bytes),
      member,
    })),
  ];
  const auxiliaryMembers = auxiliaries.map(({ bytes, contentDigest: memberDigest, member }) => ({
    byteLength: bytes.length,
    contentDigest: memberDigest,
    member,
  }));
  const reportArchiveMember = archiveMemberFixture(reportMember, Buffer.from(rawText));
  const archiveMembers = [
    reportArchiveMember,
    ...auxiliaries.map(({ bytes, member }) => archiveMemberFixture(member, bytes)),
  ].sort((left, right) => left.member.localeCompare(right.member));
  const apiUrl = `https://api.github.com/repos/kovojs/kovo/actions/artifacts/${String(artifactId)}`;
  const runApiUrl = `https://api.github.com/repos/kovojs/kovo/actions/runs/${String(workflowRunId)}`;
  const runUrl = `https://github.com/kovojs/kovo/actions/runs/${String(workflowRunId)}`;
  const jobsApiUrl = `${runApiUrl}/jobs?filter=all&per_page=100`;
  const location = `${runUrl}/artifacts/${String(artifactId)}`;
  const jobId = 9_003;
  return {
    auxiliaries,
    contentDigest,
    custody: {
      apiAuthorityDigest: digest('profile-artifact-authority'),
      apiResponseDigest: digest('profile-artifact-api'),
      apiUrl,
      archiveByteLength: 50_000,
      archiveDigest: digest('profile-archive'),
      archiveDownloadUrl: `${apiUrl}/zip`,
      archiveMembers,
      artifactDigest: digest('profile-archive'),
      artifactId,
      artifactName: 'kovo-perf-build-profile-n216',
      artifactSizeInBytes: 50_000,
      auxiliaryMembers,
      createdAt: '2026-08-13T22:00:00Z',
      expiresAt: '2026-11-11T22:00:00Z',
      jobsApiAuthorityDigest: digest('profile-jobs-authority'),
      jobsApiResponseDigest: digest('profile-jobs-api'),
      jobsApiUrl,
      liveApiAuthorityDigest: digest('profile-artifact-authority'),
      liveApiResponseDigest: digest('profile-live-artifact-api'),
      liveApiVerifiedAt: '2026-08-13T23:59:00Z',
      liveJobsApiAuthorityDigest: digest('profile-jobs-authority'),
      liveJobsApiResponseDigest: digest('profile-live-jobs-api'),
      liveRunApiAuthorityDigest: digest('profile-run-authority'),
      liveRunApiResponseDigest: digest('profile-live-run-api'),
      location,
      reportContentDigest: contentDigest,
      reportMember,
      runApiAuthorityDigest: digest('profile-run-authority'),
      runApiResponseDigest: digest('profile-run-api'),
      runApiUrl,
      runUrl,
      updatedAt: '2026-08-13T23:00:00Z',
      workflow: {
        artifactUpload: {
          action: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
          concreteName: 'kovo-perf-build-profile-n216',
          job: 'build-profile',
          name: 'kovo-perf-build-profile-n216',
          path: '${{ runner.temp }}/kovo-perf/build-profile-n216',
        },
        conclusion: 'success',
        event: 'workflow_dispatch',
        headSha: sourceCommit,
        job: {
          apiUrl: `https://api.github.com/repos/kovojs/kovo/actions/jobs/${String(jobId)}`,
          completedAt: '2026-08-13T23:00:00Z',
          conclusion: 'success',
          id: jobId,
          key: 'build-profile',
          name: 'N=216 build CPU profiles',
          runAttempt: 1,
          startedAt: '2026-08-13T22:00:00Z',
          status: 'completed',
        },
        jobsApiUrl,
        name: 'Perf Realistic Tier',
        path: '.github/workflows/perf-realistic.yml',
        runApiUrl,
        runAttempt: 1,
        sourceSha: sourceCommit,
        status: 'completed',
        triggerPolicy: 'build-profile',
        triggerScope:
          'workflow-dispatch:measurement_scope=decisions-or-all;decision_focus=all-or-build-profile',
        workflowApiUrl: `https://api.github.com/repos/kovojs/kovo/contents/.github/workflows/perf-realistic.yml?ref=${sourceCommit}`,
        workflowContentDigest: digest('profile-workflow-content'),
        workflowGitBlobSha: 'f'.repeat(40),
        workflowHeadSha: sourceCommit,
        workflowRef: 'kovojs/kovo/.github/workflows/perf-realistic.yml@refs/heads/main',
        workflowSha: sourceCommit,
      },
      workflowApiResponseDigest: digest('profile-workflow-api'),
      workflowRunId,
    },
    location,
    rawText,
    report,
  };
}

function buildProfileEntryPairFixture() {
  const entries = [buildProfileEntryFixture('unchanged'), buildProfileEntryFixture('edit')];
  const sharedArchiveMembers = entries
    .flatMap((entry) => entry.custody.archiveMembers)
    .sort((left, right) => left.member.localeCompare(right.member));
  for (const entry of entries) {
    entry.custody.archiveMembers = structuredClone(sharedArchiveMembers);
  }
  return entries;
}

function buildRawProfileFixtures(mode, { requireConfigStaticTrust = false } = {}) {
  const specs = [
    {
      functionName: 'produceKovoBuildOneShotAnalysis',
      role: 'analyze',
      url: 'file:///workspace/packages/cli/src/commands/build-export.ts',
    },
    {
      functionName: 'runPreEvaluationStaticTrustPreflight',
      role: 'app-static-trust',
      url: 'file:///workspace/packages/cli/src/commands/build-export.ts',
    },
    {
      functionName: 'runCli',
      role: 'bootstrap',
      url: 'file:///workspace/packages/cli/src/bin.ts',
    },
    {
      functionName: 'produceKovoBuildOneShotClientPhase',
      role: 'client',
      url: 'file:///workspace/packages/cli/src/commands/build-export.ts',
    },
    ...(requireConfigStaticTrust
      ? [
          {
            functionName: 'runPreEvaluationBuildConfigTrustPreflight',
            role: 'config-static-trust',
            url: 'file:///workspace/packages/cli/src/commands/build-export.ts',
          },
        ]
      : []),
    {
      functionName: 'finishKovoBuildOneShot',
      role: 'final',
      url: 'file:///workspace/packages/cli/src/commands/build-export.ts',
    },
    {
      functionName: 'runKovoIsolatedOneShotInvocationAsync',
      role: 'orchestrator',
      url: 'file:///workspace/packages/cli/src/commands/build-one-shot-orchestrator.ts',
    },
    {
      functionName: 'produceKovoBuildOneShotServerPhase',
      role: 'server',
      url: 'file:///workspace/packages/cli/src/commands/build-export.ts',
    },
    {
      functionName: 'executeCommandLine',
      role: 'typescript',
      url: 'file:///workspace/node_modules/typescript/lib/_tsc.js',
    },
  ];
  return specs.map((spec, index) => {
    const pid = 100 + index;
    const active = 6 + index;
    const wait = spec.role === 'bootstrap' ? 4 : 0;
    const idle = 1;
    const nodes = [
      {
        callFrame: profileCallFrame('(root)', ''),
        children: [2, 3, 4],
        hitCount: 0,
        id: 1,
      },
      { callFrame: profileCallFrame(spec.functionName, spec.url), hitCount: active, id: 2 },
      {
        callFrame: profileCallFrame('spawnSync', 'node:internal/child_process'),
        hitCount: wait,
        id: 3,
      },
      { callFrame: profileCallFrame('(idle)', ''), hitCount: idle, id: 4 },
    ];
    const samples = [
      ...Array.from({ length: active }, () => 2),
      ...Array.from({ length: wait }, () => 3),
      ...Array.from({ length: idle }, () => 4),
    ];
    const profile = {
      endTime: samples.length * 10_000,
      nodes,
      samples,
      startTime: 0,
      timeDeltas: samples.map(() => 10_000),
    };
    return {
      bytes: Buffer.from(JSON.stringify(profile)),
      member: `raw-${mode}-${spec.role}-pid-${String(pid)}.cpuprofile`,
      pid,
      role: spec.role,
    };
  });
}

function buildProcessCensusFixture(profileInputs) {
  const identity = (file) => ({
    bytes: 100,
    path: file,
    realPath: file,
    sha256: digest(file),
  });
  const tools = {
    env: identity('/usr/bin/env'),
    node: identity('/usr/bin/node'),
    strace: identity('/usr/bin/strace'),
    time: identity('/usr/bin/time'),
  };
  const entryPaths = {
    analyze: '/workspace/packages/cli/src/commands/build-one-shot-analyze-worker.ts',
    'app-static-trust': '/workspace/packages/cli/src/commands/build-static-trust-worker.ts',
    bootstrap: '/workspace/packages/cli/src/bin.ts',
    client: '/workspace/packages/cli/src/commands/build-one-shot-client-worker.ts',
    'config-static-trust': '/workspace/packages/cli/src/commands/build-static-trust-worker.ts',
    final: '/workspace/packages/cli/src/commands/build-one-shot-final-worker.ts',
    orchestrator: '/workspace/packages/cli/src/bin.ts',
    server: '/workspace/packages/cli/src/commands/build-one-shot-server-worker.ts',
    typescript: '/workspace/node_modules/typescript/bin/tsc',
  };
  const evidence = {
    analyze: 'analyze-worker-entry-exec/v1',
    'app-static-trust': 'app-static-trust-worker-entry-exec/v1',
    bootstrap: 'bootstrap-source-bin-exec/v1',
    client: 'client-worker-entry-exec/v1',
    'config-static-trust': 'config-static-trust-worker-entry-exec/v1',
    final: 'final-worker-entry-exec/v1',
    orchestrator: 'orchestrator-source-bin-exec/v1',
    server: 'server-worker-entry-exec/v1',
    typescript: 'typescript-cli-entry-exec/v1',
  };
  const collectorPid = 1;
  const bootstrapPid = profileInputs.find(({ role }) => role === 'bootstrap').pid;
  const orchestratorPid = profileInputs.find(({ role }) => role === 'orchestrator').pid;
  return {
    classifier: 'kovo-build-exec-argv-role/v1',
    complete: true,
    forkOnlyProcesses: 2,
    processes: [
      {
        entry: null,
        executable: tools.time,
        parentPid: null,
        pid: collectorPid,
        role: 'collector-time',
        roleEvidence: 'gnu-time-exec/v1',
      },
      ...profileInputs.map(({ pid, role }) => ({
        entry: identity(entryPaths[role]),
        executable: tools.node,
        parentPid:
          role === 'bootstrap'
            ? collectorPid
            : role === 'orchestrator'
              ? bootstrapPid
              : orchestratorPid,
        pid,
        role,
        roleEvidence: evidence[role],
      })),
      {
        entry: null,
        executable: identity('/workspace/node_modules/esbuild/bin/esbuild'),
        parentPid: orchestratorPid,
        pid: 999,
        role: 'native-one-shot',
        roleEvidence: 'esbuild-exec/v1',
      },
    ],
    schema: 'kovo-build-process-census/v1',
    tools,
  };
}

function profileCallFrame(functionName, url) {
  return { columnNumber: 0, functionName, lineNumber: 0, scriptId: '1', url };
}

function archiveMemberFixture(member, bytes) {
  return {
    byteLength: bytes.length,
    compressedByteLength: bytes.length,
    compressionMethod: 0,
    contentDigest: digest(bytes),
    crc32: 'crc32:00000000',
    member,
  };
}

function rebindAuxiliaryCustody(entry, auxiliary) {
  const custodyMember = entry.custody.auxiliaryMembers.find(
    ({ member }) => member === auxiliary.member,
  );
  custodyMember.byteLength = auxiliary.bytes.length;
  custodyMember.contentDigest = auxiliary.contentDigest;
  const archiveMember = entry.custody.archiveMembers.find(
    ({ member }) => member === auxiliary.member,
  );
  archiveMember.byteLength = auxiliary.bytes.length;
  archiveMember.compressedByteLength = auxiliary.bytes.length;
  archiveMember.contentDigest = auxiliary.contentDigest;
}

function resealBuildProfileEntry(entry) {
  resealDocument(entry.report);
  entry.rawText = `${JSON.stringify(entry.report, null, 2)}\n`;
  entry.contentDigest = digest(entry.rawText);
  entry.custody.reportContentDigest = entry.contentDigest;
  const archiveMember = entry.custody.archiveMembers.find(
    ({ member }) => member === entry.custody.reportMember,
  );
  archiveMember.byteLength = Buffer.byteLength(entry.rawText);
  archiveMember.compressedByteLength = archiveMember.byteLength;
  archiveMember.contentDigest = entry.contentDigest;
}

function profileConfigTrustPhase(entry) {
  const phase = entry.report.sourcePhasePosture.phases.find(({ name }) => name === 'config-trust');
  if (phase === undefined) throw new TypeError('fixture config-trust posture is unavailable');
  return phase;
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

function workflowJob(familyName) {
  const job = {
    browser: { key: 'browser-matrix', name: 'Browser matrix' },
    'build-n216': { key: 'build-matrix', name: 'N=216 production builds' },
    'build-n24': { key: 'build-matrix', name: 'N=24 production builds' },
    check: { key: 'check-scaling', name: 'Check scaling' },
    'dev-n216': { key: 'dev-matrix', name: 'N=216 developer loop' },
    'dev-n24': { key: 'dev-matrix', name: 'N=24 developer loop' },
    server: { key: 'server-matrix', name: 'Matched production throughput' },
  }[familyName];
  return { ...job, triggerPolicy: 'baseline' };
}

function workflowArtifactUpload(familyName) {
  const artifact = {
    browser: {
      concreteName: 'kovo-perf-browser-matrix',
      job: 'browser-matrix',
      name: 'kovo-perf-browser-matrix',
      path: '${{ runner.temp }}/kovo-perf/browser',
    },
    'build-n216': {
      concreteName: 'kovo-perf-build-n216',
      job: 'build-matrix',
      name: 'kovo-perf-build-n${{ matrix.corpus }}',
      path: '${{ runner.temp }}/kovo-perf/build-n${{ matrix.corpus }}',
    },
    'build-n24': {
      concreteName: 'kovo-perf-build-n24',
      job: 'build-matrix',
      name: 'kovo-perf-build-n${{ matrix.corpus }}',
      path: '${{ runner.temp }}/kovo-perf/build-n${{ matrix.corpus }}',
    },
    check: {
      concreteName: 'kovo-perf-check-scaling',
      job: 'check-scaling',
      name: 'kovo-perf-check-scaling',
      path: '${{ runner.temp }}/kovo-perf/check-scaling.json',
    },
    'dev-n216': {
      concreteName: 'kovo-perf-dev-n216',
      job: 'dev-matrix',
      name: 'kovo-perf-dev-n${{ matrix.corpus }}',
      path: '${{ runner.temp }}/kovo-perf/dev-n${{ matrix.corpus }}',
    },
    'dev-n24': {
      concreteName: 'kovo-perf-dev-n24',
      job: 'dev-matrix',
      name: 'kovo-perf-dev-n${{ matrix.corpus }}',
      path: '${{ runner.temp }}/kovo-perf/dev-n${{ matrix.corpus }}',
    },
    server: {
      concreteName: 'kovo-perf-server-matrix',
      job: 'server-matrix',
      name: 'kovo-perf-server-matrix',
      path: '${{ runner.temp }}/kovo-perf/server',
    },
  }[familyName];
  return {
    action: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    ...artifact,
  };
}
