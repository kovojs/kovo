import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { performanceExecutionIdentity } from './lib/perf-execution.mjs';
import { performanceHostFingerprint } from './lib/perf-host.mjs';
import { ratifyPerformanceBaseline } from './perf-baseline-ratify.mjs';
import {
  PERF_BUILD_BUDGET_SCHEMA,
  PERF_BUILD_EVALUATION_SCHEMA,
  PERF_BUILD_PERSISTENCE_ASSESSMENT_SCHEMA,
  PERF_BUILD_PERSISTENCE_EVIDENCE_SCHEMA,
  PERF_BUILD_SESSION_PROFILE_CLASSIFIER,
  PERF_BUILD_SESSION_PROFILE_SCHEMA,
  assessBuildForegroundSession,
  buildBudgetBaselineFindings,
  buildBudgetFindings,
  buildPersistenceAssessmentFindings,
  deriveBuildPerformanceBudget,
  evaluateBuildPerformanceBudget,
} from './perf-build-budget.mjs';
import {
  KOVO_BUILD_PHASE_ATTRIBUTION_SCHEMA,
  KOVO_BUILD_SOURCE_PHASES,
  KOVO_BUILD_WORKER_PHASES,
} from './perf-build-benchmark.mjs';
import { canonicalJson } from './perf-regression-check.mjs';

const BUILD_MODES = ['clean', 'unchanged', 'edit'];

describe('ratified production-build performance budgets', () => {
  it.each([24, 216])(
    'derives all N=%s mode/metric ceilings and evaluates a distinct clean source commit',
    (corpusSize) => {
      const { baseline, entries } = ratifiedBuildBaseline(corpusSize);
      const budget = deriveBuildPerformanceBudget(baseline, { baselineEntries: entries });
      const candidate = comparisonReport({ corpusSize, run: 7, sourceCommit: 'b'.repeat(40) });
      const result = evaluateBuildPerformanceBudget(budget, candidate);
      const wall = metricKey(corpusSize, 'clean', 'durationMs');

      expect(buildBudgetBaselineFindings(baseline, entries)).toEqual([]);
      expect(budget).toMatchObject({
        policy: {
          maxRegressionPct: 5,
          targets: {
            peakRssMedianVsNextMaximumRatio: 2,
            wallMedianVsNextMaximumRatio: 6,
          },
        },
        schema: PERF_BUILD_BUDGET_SCHEMA,
        subject: { corpusSize },
      });
      expect(Object.keys(budget.metrics)).toHaveLength(9);
      expect(budget.persistenceEvidence).toMatchObject({
        corpusSize,
        policy: {
          appSourceTrustEligible: false,
          diskCacheEligible: false,
          sessionEligiblePhases: ['config-trust', 'typescript', 'stylesheet'],
          upperWallMinimumRatio: 0.1,
        },
        schema: PERF_BUILD_PERSISTENCE_EVIDENCE_SCHEMA,
      });
      expect(budget.persistenceEvidence.modes.unchanged.residualUpper.samples).toHaveLength(50);
      expect(
        budget.persistenceEvidence.modes.unchanged.residualUpper.samples.every(
          ({ eligibleDurationMs }) => eligibleDurationMs === 3,
        ),
      ).toBe(true);
      expect(budget.metrics[wall]).toMatchObject({
        baseline: {
          median: 502,
          nextMedian: 102,
          nextP95: 122,
          pairedMedian: 400,
          p95: 522,
          runs: 5,
        },
        p95Maximum: 548.1,
      });
      expect(budget.metrics[wall].medianMaximum).toBeCloseTo(527.1);
      expect(buildBudgetFindings(budget)).toEqual([]);
      expect(
        deriveBuildPerformanceBudget(baseline, { baselineEntries: [...entries].reverse() }).digest,
      ).toBe(budget.digest);
      expect(result.schema).toBe(PERF_BUILD_EVALUATION_SCHEMA);
      expect(result.candidate.sourceCommit).toBe('b'.repeat(40));
      expect(result.verdict).toEqual({ failures: [], reasons: [], status: 'pass' });
      expect(result.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: `${wall}.median`, status: 'pass' }),
          expect.objectContaining({ id: `${wall}.p95`, status: 'pass' }),
          expect.objectContaining({
            id: `corpus-n${String(corpusSize)}/build/clean/durationMs.median-vs-next`,
            limit: 6,
            status: 'pass',
          }),
          expect.objectContaining({
            id: `corpus-n${String(corpusSize)}/build/clean/peakRssBytes.median-vs-next`,
            limit: 2,
            status: 'pass',
          }),
        ]),
      );
    },
  );

  it('reports wall median/p95, RSS, artifact, and milestone regressions independently', () => {
    const { baseline, entries } = ratifiedBuildBaseline(24);
    const budget = deriveBuildPerformanceBudget(baseline, { baselineEntries: entries });
    const candidate = comparisonReport({ corpusSize: 24, run: 8, sourceCommit: 'b'.repeat(40) });
    const wall = metricKey(24, 'clean', 'durationMs');
    const rss = metricKey(24, 'clean', 'peakRssBytes');
    const artifact = metricKey(24, 'edit', 'artifactBytes');
    candidate.analysis[wall].kovo.median = 528;
    candidate.analysis[wall].kovo.p95 = 549;
    candidate.analysis[rss].kovo.median = 220;
    candidate.analysis[rss].kovo.p95 = 230;
    candidate.analysis[artifact].kovo.p95 = 1_100;

    const result = evaluateBuildPerformanceBudget(budget, candidate);

    expect(result.verdict.status).toBe('regression');
    expect(result.verdict.reasons).toEqual([]);
    expect(result.verdict.failures).toEqual(
      expect.arrayContaining([
        `${wall}.median`,
        `${wall}.p95`,
        `${rss}.median`,
        `${rss}.p95`,
        `${artifact}.p95`,
        'corpus-n24/build/clean/peakRssBytes.median-vs-next',
      ]),
    );
  });

  it('fails closed on lock drift, missing phase census, or forged CLI/startup subtraction', () => {
    const { baseline, entries } = ratifiedBuildBaseline(24);
    const budget = deriveBuildPerformanceBudget(baseline, { baselineEntries: entries });
    const candidate = comparisonReport({ corpusSize: 24, run: 9, sourceCommit: 'b'.repeat(40) });
    candidate.source.locks['pnpm-lock.yaml'] = digest('drift');
    const firstKovo = candidate.rawCells.find(({ framework }) => framework === 'kovo');
    firstKovo.report.samples[0].phaseCensus.source.phases.pop();
    firstKovo.report.samples[1].phaseAttribution.cliStartupTail.durationMs = 0;

    const result = evaluateBuildPerformanceBudget(budget, candidate);

    expect(result.verdict.status).toBe('unproven');
    expect(result.verdict.reasons).toEqual(
      expect.arrayContaining([
        'candidate dependency lock identity differs from the ratified budget',
        'candidate Kovo build clean source-check census is incomplete',
        'candidate Kovo build clean CLI/startup residual is not derived from the authenticated envelope',
      ]),
    );
    expect(result.checks).toEqual([]);

    budget.metrics[metricKey(24, 'clean', 'durationMs')].medianMaximum = 1_000_000;
    expect(buildBudgetFindings(budget)).toContain('budget digest is not derived from its facts');
  });

  it('refuses short, unlinked, or metric-tampered baseline evidence', () => {
    const { baseline, entries } = ratifiedBuildBaseline(24);
    expect(() => deriveBuildPerformanceBudget(baseline)).toThrow(
      /baseline raw build report census must contain exactly five linked reports/u,
    );

    entries[0].rawText = `${entries[0].rawText} `;
    expect(() => deriveBuildPerformanceBudget(baseline, { baselineEntries: entries })).toThrow(
      /does not match its ratified content\/link identity/u,
    );

    const restored = ratifiedBuildBaseline(24);
    restored.baseline.metrics[metricKey(24, 'clean', 'durationMs')].kovo.median += 1;
    expect(() =>
      deriveBuildPerformanceBudget(restored.baseline, { baselineEntries: restored.entries }),
    ).toThrow(/baseline metrics is not reproduced by its linked raw reports/u);
  });

  it('requires exactly five ratified runs and one exact raw-entry census', () => {
    const sixRun = ratifiedBuildBaseline(24, { runs: 6 });
    expect(sixRun.baseline.policy.minRuns).toBe(5);
    expect(sixRun.baseline.metrics[metricKey(24, 'clean', 'durationMs')].kovo.runs).toBe(6);
    expect(() =>
      deriveBuildPerformanceBudget(sixRun.baseline, { baselineEntries: sixRun.entries }),
    ).toThrow(/exactly five|evidence is unavailable/u);

    const wrongMinimum = ratifiedBuildBaseline(24);
    wrongMinimum.baseline.policy.minRuns = 6;
    expect(buildBudgetBaselineFindings(wrongMinimum.baseline, wrongMinimum.entries)).toContain(
      'baseline policy must require exactly five runs',
    );

    const duplicate = ratifiedBuildBaseline(24);
    duplicate.entries[4] = structuredClone(duplicate.entries[0]);
    expect(buildBudgetBaselineFindings(duplicate.baseline, duplicate.entries)).toContain(
      'baseline raw build report census does not exactly match the ratified reports',
    );
    expect(() =>
      deriveBuildPerformanceBudget(duplicate.baseline, {
        baselineEntries: duplicate.entries,
      }),
    ).toThrow(/raw build report census does not exactly match the ratified reports/u);
  });

  it('refuses to publish a budget from scratch paths or a mixed-cell workload', () => {
    const scratch = ratifiedBuildBaseline(24, { durableLocations: false });
    expect(() =>
      deriveBuildPerformanceBudget(scratch.baseline, { baselineEntries: scratch.entries }),
    ).toThrow(/baseline report links are short, malformed, or duplicated/u);

    const mixed = ratifiedBuildBaseline(24);
    mixed.baseline.subject.workloadIdentity.identity.cells.push('browser');
    expect(() =>
      deriveBuildPerformanceBudget(mixed.baseline, { baselineEntries: mixed.entries }),
    ).toThrow(/workload is not the isolated build cell/u);
  });

  it.each([24, 216])(
    'derives N=%s through the documented CLIs from five linked Actions runs',
    (corpusSize) => {
      const root = mkdtempSync(
        path.join(os.tmpdir(), `kovo-build-n${String(corpusSize)}-budget-cli-`),
      );
      try {
        const { baseline, entries } = ratifiedBuildBaseline(corpusSize, {
          durableLocations: true,
        });
        const baselinePath = path.join(root, 'baseline.json');
        const outputPath = path.join(root, 'budget.json');
        const reportPaths = entries.map((entry, index) => {
          const reportPath = path.join(root, `download-${String(index)}.json`);
          writeFileSync(reportPath, entry.rawText);
          return reportPath;
        });
        const ratifier = fileURLToPath(new URL('./perf-baseline-ratify.mjs', import.meta.url));
        const ratification = spawnSync(
          process.execPath,
          [
            ratifier,
            ...reportPaths.flatMap((reportPath, index) => [
              '--report',
              reportPath,
              '--location',
              entries[index].location,
            ]),
            '--out',
            baselinePath,
          ],
          { encoding: 'utf8' },
        );
        expect(ratification).toMatchObject({ status: 0, stderr: '' });
        const script = fileURLToPath(new URL('./perf-build-budget.mjs', import.meta.url));
        const result = spawnSync(
          process.execPath,
          [
            script,
            'derive',
            '--baseline',
            baselinePath,
            ...reportPaths.flatMap((reportPath) => ['--report', reportPath]),
            '--out',
            outputPath,
          ],
          { encoding: 'utf8' },
        );

        expect(result).toMatchObject({ status: 0, stderr: '' });
        const budget = JSON.parse(readFileSync(outputPath, 'utf8'));
        expect(budget.schema).toBe(PERF_BUILD_BUDGET_SCHEMA);
        expect(budget.baseline.reports.map(({ location }) => location)).toEqual(
          baseline.reports.map(({ location }) => location),
        );
        expect(
          budget.baseline.reports.every(({ location }) => location.startsWith('https://')),
        ).toBe(true);
        expect(new Set(budget.baseline.reports.map(({ runUrl }) => runUrl)).size).toBe(5);

        writeFileSync(reportPaths[0], `${entries[0].rawText} `);
        const hostile = spawnSync(
          process.execPath,
          [
            script,
            'derive',
            '--baseline',
            baselinePath,
            ...reportPaths.flatMap((reportPath) => ['--report', reportPath]),
            '--out',
            outputPath,
          ],
          { encoding: 'utf8' },
        );
        expect(hostile.status).toBe(2);
        expect(hostile.stderr).toContain('does not match its ratified content/link identity');
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
  );

  it('closes the persistence question when all four warm cells meet the first milestone', () => {
    const { n24Budget, n216Budget } = pairedBuildBudgets();

    const assessment = assessBuildForegroundSession({ n24Budget, n216Budget });

    expect(assessment).toMatchObject({
      schema: PERF_BUILD_PERSISTENCE_ASSESSMENT_SCHEMA,
      verdict: {
        findings: [],
        outcome: 'not-warranted',
        rationale: 'all-warm-cells-meet-first-milestone',
        status: 'decided',
      },
    });
    expect(buildPersistenceAssessmentFindings(assessment, { n24Budget, n216Budget })).toEqual([]);

    assessment.verdict.outcome = 'warranted';
    assessment.verdict.rationale = 'n216-miss-upper-residual-and-session-eligible-top-five-proven';
    resealDocument(assessment);
    expect(buildPersistenceAssessmentFindings(assessment)).toContain(
      'assessment outcome is not derived from its warm cells and current profiles',
    );
  });

  it('closes on both N=216 residual ceilings below 10% even when an N=24 cell misses', () => {
    const { n24Budget, n216Budget } = pairedBuildBudgets();
    setWarmCell(n24Budget, 'unchanged', { rssRatio: 2.1, wallRatio: 6.1 });
    setWarmCell(n216Budget, 'unchanged', { residualRatio: 0.099 });
    setWarmCell(n216Budget, 'edit', { residualRatio: 0.05 });

    const assessment = assessBuildForegroundSession({ n24Budget, n216Budget });

    expect(assessment.verdict).toMatchObject({
      findings: [],
      outcome: 'not-warranted',
      rationale: 'both-n216-upper-residuals-below-ten-percent',
      status: 'decided',
    });
  });

  it('keeps mixed evidence unproven instead of inventing a third not-warranted shortcut', () => {
    const { n24Budget, n216Budget } = pairedBuildBudgets();
    setWarmCell(n24Budget, 'edit', { wallRatio: 6.5 });
    setWarmCell(n216Budget, 'unchanged', { residualRatio: 0.2 });
    setWarmCell(n216Budget, 'edit', { residualRatio: 0.2 });

    const assessment = assessBuildForegroundSession({ n24Budget, n216Budget });

    expect(assessment.verdict).toEqual({
      findings: [
        'mixed warm-cell evidence satisfies neither not-warranted shortcut nor the N=216 warrant predicate',
      ],
      outcome: 'unproven',
      rationale: 'mixed-evidence-unresolved',
      status: 'unproven',
    });
  });

  it('reports profile-required at the inclusive 10% boundary and never infers a warrant', () => {
    const { n24Budget, n216Budget } = pairedBuildBudgets();
    setWarmCell(n216Budget, 'unchanged', {
      residualRatio: 0.1,
      rssRatio: 2.01,
      wallRatio: 6.01,
    });
    setWarmCell(n216Budget, 'edit', { residualRatio: 0.05 });

    const assessment = assessBuildForegroundSession({ n24Budget, n216Budget });

    expect(assessment.verdict).toEqual({
      findings: ['current authenticated N=216 unchanged and edit CPU profiles are required'],
      outcome: 'profile-required',
      rationale: 'current-profile-required',
      status: 'unproven',
    });
  });

  it('warrants a spike only when a qualifying current profile has an eligible top-five cause', () => {
    const { n24Budget, n216Budget } = pairedBuildBudgets();
    setWarmCell(n216Budget, 'unchanged', {
      residualRatio: 0.1,
      wallRatio: 6.1,
    });
    const profileEntries = [
      buildProfileEntry(n216Budget, 'unchanged', ['typescript']),
      buildProfileEntry(n216Budget, 'edit', []),
    ];

    const assessment = assessBuildForegroundSession({
      n24Budget,
      n216Budget,
      profileEntries,
    });

    expect(assessment.verdict).toMatchObject({
      findings: [],
      outcome: 'warranted',
      rationale: 'n216-miss-upper-residual-and-session-eligible-top-five-proven',
      status: 'decided',
    });
    expect(assessment.profiles).toHaveLength(2);
    expect(
      buildPersistenceAssessmentFindings(assessment, {
        n24Budget,
        n216Budget,
        profileEntries,
      }),
    ).toEqual([]);
  });

  it('stays unproven when current profiles do not prove an eligible top-five cause', () => {
    const { n24Budget, n216Budget } = pairedBuildBudgets();
    setWarmCell(n216Budget, 'edit', { residualRatio: 0.25, rssRatio: 2.1 });
    const profileEntries = [
      buildProfileEntry(n216Budget, 'unchanged', []),
      buildProfileEntry(n216Budget, 'edit', []),
    ];

    const assessment = assessBuildForegroundSession({
      n24Budget,
      n216Budget,
      profileEntries,
    });

    expect(assessment.verdict).toEqual({
      findings: [
        'current N=216 profiles do not prove session-eligible work in a qualifying top five',
      ],
      outcome: 'unproven',
      rationale: 'current-profile-does-not-prove-warrant',
      status: 'unproven',
    });
  });

  it('fails closed on malformed budget samples, stale profiles, or a partial profile census', () => {
    const malformedBudgets = pairedBuildBudgets();
    malformedBudgets.n216Budget.persistenceEvidence.modes.edit.residualUpper.samples[0].upperWallRatio = 0.9;
    resealBudget(malformedBudgets.n216Budget);
    expect(assessBuildForegroundSession(malformedBudgets).verdict).toMatchObject({
      outcome: 'unproven',
      rationale: 'malformed-evidence',
    });

    const { n24Budget, n216Budget } = pairedBuildBudgets();
    setWarmCell(n216Budget, 'edit', { residualRatio: 0.25, wallRatio: 6.2 });
    expect(
      assessBuildForegroundSession({ n24Budget, n216Budget, profileEntries: {} }).verdict,
    ).toMatchObject({
      findings: ['build CPU profile evidence must be an array'],
      outcome: 'unproven',
      rationale: 'malformed-profile-evidence',
    });
    const stale = buildProfileEntry(n216Budget, 'edit', ['stylesheet']);
    stale.report.source.commit = 'f'.repeat(40);
    expect(
      assessBuildForegroundSession({
        n24Budget,
        n216Budget,
        profileEntries: [buildProfileEntry(n216Budget, 'unchanged', []), stale],
      }).verdict,
    ).toMatchObject({ outcome: 'unproven', rationale: 'malformed-profile-evidence' });

    expect(
      assessBuildForegroundSession({
        n24Budget,
        n216Budget,
        profileEntries: [buildProfileEntry(n216Budget, 'edit', ['stylesheet'])],
      }).verdict.findings,
    ).toEqual(
      expect.arrayContaining([
        'unchanged build CPU profile is unavailable',
        'build CPU profile census must contain exactly unchanged and edit',
      ]),
    );
  });

  it.each([
    {
      finding: 'profile declared artifact member census differs',
      mutate: (report) => {
        report.artifactMembers.push('undeclared-extra.bin');
      },
    },
    {
      finding: 'profile original-process artifact identity is malformed or duplicated',
      mutate: (report) => {
        report.profileArtifacts[0].waitSamples = report.profileArtifacts[0].samples;
      },
    },
    {
      finding: 'profile process PID/role/executable census is malformed',
      mutate: (report) => {
        report.capture.processCensus.processes[1].pid += 50_000;
      },
    },
    {
      finding: 'profile recursive CPU residual evidence is incomplete',
      mutate: (report) => {
        report.capture.processCpu.fixedProfilerIntervalMicros = 500;
      },
    },
    {
      finding: 'profile source phase posture is unavailable or malformed',
      mutate: (report) => {
        delete report.sourcePhasePosture;
      },
    },
    {
      finding: 'profile source phase posture is unavailable or malformed',
      mutate: (report) => {
        report.sourcePhasePosture.phases[1].name = report.sourcePhasePosture.phases[0].name;
      },
    },
    {
      finding: 'profile source phase posture is unavailable or malformed',
      mutate: (report) => {
        report.sourcePhasePosture.phases[1].status = 'skipped';
      },
    },
  ])('rejects malformed raw build profile evidence: $finding', ({ finding, mutate }) => {
    const { n24Budget, n216Budget } = pairedBuildBudgets();
    setWarmCell(n216Budget, 'unchanged', { residualRatio: 0.2, wallRatio: 6.2 });
    const unchanged = buildProfileEntry(n216Budget, 'unchanged', ['typescript']);
    mutate(unchanged.report);
    resealProfileEntry(unchanged);
    const assessment = assessBuildForegroundSession({
      n24Budget,
      n216Budget,
      profileEntries: [unchanged, buildProfileEntry(n216Budget, 'edit', [])],
    });
    expect(assessment.verdict).toMatchObject({
      outcome: 'unproven',
      rationale: 'malformed-profile-evidence',
    });
    expect(assessment.verdict.findings.join('\n')).toContain(finding);
  });

  it('accepts an eight-role skipped-config profile and rejects either posture/role contradiction', () => {
    const { n24Budget, n216Budget } = pairedBuildBudgets();
    setWarmCell(n216Budget, 'unchanged', { residualRatio: 0.2, wallRatio: 6.2 });
    const profileEntries = [
      buildProfileEntry(n216Budget, 'unchanged', ['typescript'], {
        configStatus: 'not-applicable',
      }),
      buildProfileEntry(n216Budget, 'edit', [], { configStatus: 'not-applicable' }),
    ];
    expect(
      assessBuildForegroundSession({ n24Budget, n216Budget, profileEntries }).verdict,
    ).toMatchObject({ outcome: 'warranted', status: 'decided' });

    const forbiddenConfig = buildProfileEntry(n216Budget, 'unchanged', ['typescript']);
    forbiddenConfig.report.sourcePhasePosture.phases.find(
      ({ name }) => name === 'config-trust',
    ).status = 'not-applicable';
    resealProfileEntry(forbiddenConfig);
    const forbiddenAssessment = assessBuildForegroundSession({
      n24Budget,
      n216Budget,
      profileEntries: [forbiddenConfig, profileEntries[1]],
    });
    expect(forbiddenAssessment.verdict).toMatchObject({
      outcome: 'unproven',
      rationale: 'malformed-profile-evidence',
    });
    expect(forbiddenAssessment.verdict.findings.join('\n')).toContain(
      'profile original-process artifact census is incomplete',
    );

    const requiredConfig = buildProfileEntry(n216Budget, 'unchanged', ['typescript']);
    requiredConfig.report.profileArtifacts = requiredConfig.report.profileArtifacts.filter(
      ({ role }) => role !== 'config-static-trust',
    );
    resealProfileEntry(requiredConfig);
    const requiredAssessment = assessBuildForegroundSession({
      n24Budget,
      n216Budget,
      profileEntries: [requiredConfig, buildProfileEntry(n216Budget, 'edit', [])],
    });
    expect(requiredAssessment.verdict).toMatchObject({
      outcome: 'unproven',
      rationale: 'malformed-profile-evidence',
    });
    expect(requiredAssessment.verdict.findings.join('\n')).toContain(
      'profile original-process artifact census is incomplete',
    );
  });

  it('accepts mutable API response bytes only when all authority projections still match', () => {
    const { n24Budget, n216Budget } = pairedBuildBudgets();
    setWarmCell(n216Budget, 'unchanged', { residualRatio: 0.2, wallRatio: 6.2 });
    const profileEntries = [
      buildProfileEntry(n216Budget, 'unchanged', ['typescript']),
      buildProfileEntry(n216Budget, 'edit', []),
    ];
    expect(profileEntries[0].custody.liveApiResponseDigest).not.toBe(
      profileEntries[0].custody.apiResponseDigest,
    );
    expect(
      assessBuildForegroundSession({ n24Budget, n216Budget, profileEntries }).verdict.outcome,
    ).toBe('warranted');

    profileEntries[0].custody.liveJobsApiAuthorityDigest = digest('changed-jobs-authority');
    const assessment = assessBuildForegroundSession({
      n24Budget,
      n216Budget,
      profileEntries,
    });
    expect(assessment.verdict).toMatchObject({
      outcome: 'unproven',
      rationale: 'malformed-profile-evidence',
    });
    expect(assessment.verdict.findings.join('\n')).toContain(
      'profile artifact custody is incomplete or mismatched',
    );
  });

  it.each([49, 51])('rejects a %s-sample warm-mode census', (sampleCount) => {
    const baseline = ratifiedBuildBaseline(216);
    const budget = deriveBuildPerformanceBudget(baseline.baseline, {
      baselineEntries: baseline.entries,
    });
    const samples = budget.persistenceEvidence.modes.unchanged.residualUpper.samples;
    if (sampleCount === 49) {
      samples.pop();
    } else {
      samples.push(structuredClone(samples[0]));
    }
    resealBudget(budget);

    expect(buildBudgetFindings(budget)).toContain(
      'budget persistence unchanged must contain exactly 50 residual samples',
    );
  });

  it('runs the documented cross-corpus persistence assessment CLI', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'kovo-build-persistence-cli-'));
    try {
      const { n24Budget, n216Budget } = pairedBuildBudgets();
      const n24Path = path.join(root, 'n24.json');
      const n216Path = path.join(root, 'n216.json');
      const out = path.join(root, 'assessment.json');
      writeFileSync(n24Path, JSON.stringify(n24Budget));
      writeFileSync(n216Path, JSON.stringify(n216Budget));
      const script = fileURLToPath(new URL('./perf-build-budget.mjs', import.meta.url));

      const result = spawnSync(
        process.execPath,
        [
          script,
          'assess-persistence',
          '--n24-budget',
          n24Path,
          '--n216-budget',
          n216Path,
          '--out',
          out,
        ],
        { encoding: 'utf8' },
      );

      expect(result).toMatchObject({ status: 0, stderr: '' });
      expect(result.stdout).toContain('kovo-build-persistence-assessment/v1 not-warranted');
      const assessment = JSON.parse(readFileSync(out, 'utf8'));
      expect(assessment.verdict).toMatchObject({
        outcome: 'not-warranted',
        status: 'decided',
      });
      expect(
        buildPersistenceAssessmentFindings(assessment, {
          n24Budget,
          n216Budget,
          profileEntries: [],
        }),
      ).toEqual([]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects caller-authored profile custody in the standalone assessment CLI', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'kovo-build-persistence-forged-profile-cli-'));
    try {
      const { n24Budget, n216Budget } = pairedBuildBudgets();
      setWarmCell(n216Budget, 'unchanged', { residualRatio: 0.2, wallRatio: 6.2 });
      const n24Path = path.join(root, 'n24.json');
      const n216Path = path.join(root, 'n216.json');
      const unchangedProfilePath = path.join(root, 'forged-unchanged-profile.json');
      const editProfilePath = path.join(root, 'forged-edit-profile.json');
      const out = path.join(root, 'assessment.json');
      writeFileSync(n24Path, JSON.stringify(n24Budget));
      writeFileSync(n216Path, JSON.stringify(n216Budget));
      writeFileSync(
        unchangedProfilePath,
        JSON.stringify(buildProfileEntry(n216Budget, 'unchanged', ['typescript'])),
      );
      writeFileSync(editProfilePath, JSON.stringify(buildProfileEntry(n216Budget, 'edit', [])));
      const script = fileURLToPath(new URL('./perf-build-budget.mjs', import.meta.url));

      const result = spawnSync(
        process.execPath,
        [
          script,
          'assess-persistence',
          '--n24-budget',
          n24Path,
          '--n216-budget',
          n216Path,
          '--profile',
          unchangedProfilePath,
          '--profile',
          editProfilePath,
          '--out',
          out,
        ],
        { encoding: 'utf8' },
      );

      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(
        'standalone --profile is unavailable: authenticated profile decisions must use perf-publication-gate.mjs',
      );
      expect(() => readFileSync(out, 'utf8')).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

function ratifiedBuildBaseline(corpusSize, { durableLocations = true, runs = 5 } = {}) {
  const entries = Array.from({ length: runs }, (_, run) => {
    const report = comparisonReport({ corpusSize, run, sourceCommit: 'a'.repeat(40) });
    const rawText = JSON.stringify(report);
    return {
      contentDigest: digest(rawText),
      location: durableLocations
        ? `${report.execution.github.runUrl}/artifacts/${String(corpusSize)}${String(run + 101)}`
        : `artifacts/build-n${String(corpusSize)}-run-${String(run)}/comparison.json`,
      rawText,
      report,
    };
  });
  const baseline = ratifyPerformanceBaseline(entries);
  expect(baseline.verdict.status).toBe('ratified');
  return { baseline, entries };
}

function comparisonReport({ corpusSize, run, sourceCommit }) {
  const host = performanceHostFingerprint({ runnerImage: 'ubuntu-24.04@sha256:fixture' });
  const workloadFacts = workloadIdentity(corpusSize);
  const workload = {
    complete: true,
    digest: digest(canonicalJson(workloadFacts)),
    identity: workloadFacts,
    schema: 'kovo-performance-workload-identity/v1',
  };
  const locks = {
    'benchmarks/harness/pnpm-lock.yaml': digest('harness-lock'),
    'benchmarks/nextjs/pnpm-lock.yaml': digest('next-lock'),
    'pnpm-lock.yaml': digest('root-lock'),
  };
  const execution = performanceExecutionIdentity({
    env: {
      GITHUB_JOB: 'build-performance',
      GITHUB_REPOSITORY: 'kovojs/kovo',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_RUN_ID: `${String(corpusSize)}${String(run).padStart(3, '0')}`,
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_SHA: sourceCommit,
      GITHUB_WORKFLOW_REF: `kovojs/kovo/.github/workflows/perf-realistic.yml@${sourceCommit}`,
      GITHUB_WORKFLOW_SHA: sourceCommit,
    },
    startedAt: `2026-08-13T12:00:${String(run).padStart(2, '0')}.000Z`,
  });
  const analysis = {};
  for (const mode of BUILD_MODES) {
    analysis[metricKey(corpusSize, mode, 'durationMs')] = metricSummary(500 + run, 100 + run);
    analysis[metricKey(corpusSize, mode, 'peakRssBytes')] = metricSummary(180 + run, 100 + run);
    analysis[metricKey(corpusSize, mode, 'artifactBytes')] = metricSummary(1_000 + run, 900 + run);
  }
  return {
    analysis,
    execution,
    generatedAt: execution.startedAt,
    host,
    hostSamples: [{ ceiling: 1, loadAverage: [1, 1, 1], loadPerCpu: 0.1 }],
    integrity: {
      comparatorMatched: true,
      executionAuthenticated: true,
      publishable: true,
      serialized: true,
      sourceStable: true,
      workloadAuthenticated: true,
    },
    policy: workloadFacts.policies,
    rawCells: rawBuildCells(corpusSize, {
      locks,
      shapeDigest: workloadFacts.corpus.kovo.shapeDigest.slice('sha256:'.length),
      sourceCommit,
    }),
    schema: 'kovo-next-performance-comparison/v1',
    source: { commit: sourceCommit, dirty: false, dirtyPaths: [], locks },
    verdict: { reasons: [], status: 'measured' },
    workloadIdentity: workload,
  };
}

function workloadIdentity(corpusSize) {
  const shapeDigest = digest(`shape-${String(corpusSize)}`);
  return {
    adapters: {
      build: 'kovo-build-benchmark/v1',
      compare: 'kovo-next-performance-comparison/v1',
    },
    cells: ['build'],
    corpus: {
      kovo: {
        manifestDigest: digest(`kovo-manifest-${String(corpusSize)}`),
        shapeDigest,
        sourceDigest: digest(`kovo-source-${String(corpusSize)}`),
      },
      nextjs: {
        manifestDigest: digest(`next-manifest-${String(corpusSize)}`),
        shapeDigest,
        sourceDigest: digest(`next-source-${String(corpusSize)}`),
      },
    },
    lanes: [`corpus-n${String(corpusSize)}`],
    policies: {
      bfcacheIterations: 10,
      browserSamples: 30,
      buildModes: BUILD_MODES,
      buildSamples: 10,
      corpusSize,
      devEditSamples: 30,
      devReadySamples: 15,
      devWarmups: 3,
      lighthouseRuns: 5,
      server: { samples: 7 },
      warmups: 3,
    },
  };
}

function rawBuildCells(corpusSize, { locks, shapeDigest, sourceCommit }) {
  return BUILD_MODES.flatMap((mode) =>
    buildSchedule().map(({ framework, occurrence, samples, warmups }) => ({
      cell: 'build',
      framework,
      lane: `corpus-n${String(corpusSize)}`,
      mode,
      occurrence,
      report: buildReport({
        framework,
        locks,
        mode,
        samples,
        shapeDigest,
        sourceCommit,
        warmups,
      }),
    })),
  );
}

function buildReport({ framework, locks, mode, samples, shapeDigest, sourceCommit, warmups }) {
  const observed = Array.from({ length: samples }, (_, iteration) => {
    const durationMs = framework === 'kovo' ? 500 + iteration : 100 + iteration;
    return {
      artifactBytes: framework === 'kovo' ? 1_000 : 900,
      corpus: { afterDigest: digest('corpus'), beforeDigest: digest('corpus'), stable: true },
      durationMs,
      exitCode: 0,
      loadAverage: 0.1,
      outputCensus: { complete: true, totalBytes: framework === 'kovo' ? 1_000 : 900 },
      peakRssBytes: framework === 'kovo' ? 180 : 100,
      ...(framework === 'kovo'
        ? kovoPhaseEvidence(durationMs)
        : { phaseAttribution: null, phaseCensus: null }),
    };
  });
  const source = { commit: sourceCommit, dirty: false, dirtyPaths: [], locks };
  return {
    corpus: { shapeDigest },
    framework,
    integrity: {
      complete: true,
      corpus: { stable: true },
      errors: [],
      iterations: samples,
      misses: 0,
      source: { stable: true },
      warmups,
    },
    mode,
    samples: observed,
    schema: 'kovo-build-benchmark/v1',
    source,
    sourceAfter: structuredClone(source),
  };
}

function kovoPhaseEvidence(durationMs) {
  const workerDuration = durationMs / 5;
  const totalWorkerMs = workerDuration * 4;
  const phaseCensus = {
    source: {
      checkGraphDigest: digest('check-graph'),
      complete: true,
      phases: KOVO_BUILD_SOURCE_PHASES.map((name) => ({
        durationMs: 1,
        name,
        status: 'executed',
      })),
      schema: 'kovo-build-source-phase-census/v1',
      source: {
        codeUnitLength: 100,
        contentHash: digest('source'),
        encoding: 'utf16le',
        path: 'src/app.tsx',
      },
      sourceSetDigest: digest('source-set'),
    },
    workers: {
      complete: true,
      phases: KOVO_BUILD_WORKER_PHASES.map((name) => ({
        durationMs: workerDuration,
        name,
        status: 0,
      })),
      schema: 'kovo-build-worker-phase-census/v1',
      sourcePath: 'src/app.tsx',
      totalWorkerMs,
    },
  };
  return {
    phaseAttribution: {
      cliStartupTail: {
        durationMs: durationMs - totalWorkerMs,
        source: {
          envelope: 'kovo-build-worker-phase-census/v1.totalWorkerMs',
          operation: 'wall-minus-sequential-worker-envelope',
          wall: 'measureProcessTreeCommand.durationMs',
        },
        status: 'measured-residual',
      },
      complete: true,
      errors: [],
      phaseEnvelope: {
        durationMs: totalWorkerMs,
        phases: KOVO_BUILD_WORKER_PHASES,
        source: 'kovo-build-worker-phase-census/v1.totalWorkerMs',
        status: 'authenticated-sequential',
      },
      schema: KOVO_BUILD_PHASE_ATTRIBUTION_SCHEMA,
      sourceCheck: {
        nestedWithin: 'analyze',
        phases: KOVO_BUILD_SOURCE_PHASES,
        source: 'kovo-build-source-phase-census/v1',
        status: 'authenticated-nested',
      },
      wallDurationMs: durationMs,
    },
    phaseCensus,
  };
}

function buildSchedule() {
  return [
    { framework: 'kovo', occurrence: 0, samples: 5, warmups: 2 },
    { framework: 'nextjs', occurrence: 0, samples: 5, warmups: 2 },
    { framework: 'nextjs', occurrence: 1, samples: 5, warmups: 1 },
    { framework: 'kovo', occurrence: 1, samples: 5, warmups: 1 },
  ];
}

function metricSummary(kovo, nextjs) {
  return {
    kovo: { mad: 1, median: kovo, p95: kovo + 20, samples: 10 },
    nextjs: { mad: 1, median: nextjs, p95: nextjs + 20, samples: 10 },
    pairedDifference: {
      bootstrap95Ci: [kovo - nextjs - 1, kovo - nextjs + 1],
      direction: 'kovo-minus-nextjs',
      median: kovo - nextjs,
      samples: 10,
    },
  };
}

function metricKey(corpusSize, mode, suffix) {
  return `corpus-n${String(corpusSize)}/build/${mode}/${suffix}`;
}

function pairedBuildBudgets() {
  const n24 = ratifiedBuildBaseline(24);
  const n216 = ratifiedBuildBaseline(216);
  return {
    n24Budget: deriveBuildPerformanceBudget(n24.baseline, { baselineEntries: n24.entries }),
    n216Budget: deriveBuildPerformanceBudget(n216.baseline, { baselineEntries: n216.entries }),
  };
}

function setWarmCell(budget, mode, options) {
  const size = budget.subject.corpusSize;
  const duration = budget.metrics[metricKey(size, mode, 'durationMs')];
  const rss = budget.metrics[metricKey(size, mode, 'peakRssBytes')];
  const evidence = budget.persistenceEvidence.modes[mode];
  const wallRatio = options.wallRatio ?? duration.baseline.median / duration.baseline.nextMedian;
  const rssRatio = options.rssRatio ?? rss.baseline.median / rss.baseline.nextMedian;
  duration.baseline.median = duration.baseline.nextMedian * wallRatio;
  duration.medianMaximum = duration.baseline.median * (1 + budget.policy.maxRegressionPct / 100);
  rss.baseline.median = rss.baseline.nextMedian * rssRatio;
  rss.medianMaximum = rss.baseline.median * (1 + budget.policy.maxRegressionPct / 100);
  evidence.wall.kovoMedianMs = duration.baseline.median;
  evidence.milestone.wallMedianVsNextRatio = wallRatio;
  evidence.milestone.peakRssMedianVsNextRatio = rssRatio;
  evidence.milestone.status = wallRatio <= 6 && rssRatio <= 2 ? 'pass' : 'fail';
  if (options.residualRatio !== undefined) {
    for (const sample of evidence.residualUpper.samples) {
      sample.wallDurationMs = 1_000;
      sample.eligibleDurationMs = options.residualRatio * 1_000;
      sample.cliStartupTailMs = 0;
      sample.upperDurationMs = sample.eligibleDurationMs;
      sample.upperWallRatio = options.residualRatio;
    }
    evidence.residualUpper.medianRatio = options.residualRatio;
  }
  resealBudget(budget);
}

function resealBudget(budget) {
  resealDocument(budget);
}

function resealDocument(document) {
  const { digest: ignored, ...facts } = document;
  void ignored;
  document.digest = digest(canonicalJson(facts));
}

function resealProfileEntry(entry) {
  resealDocument(entry.report);
  entry.rawText = JSON.stringify(entry.report);
  entry.contentDigest = digest(entry.rawText);
  entry.custody.reportContentDigest = entry.contentDigest;
}

function buildProfileEntry(budget, mode, eligibleCauses, { configStatus = 'executed' } = {}) {
  const runId = mode === 'unchanged' ? 990_001 : 990_002;
  const artifactId = mode === 'unchanged' ? 880_001 : 880_002;
  const source = {
    commit: budget.baseline.sourceCommit,
    dirty: false,
    dirtyPaths: [],
    locks: structuredClone(budget.subject.locks),
  };
  const execution = performanceExecutionIdentity({
    env: {
      GITHUB_JOB: 'build-profile',
      GITHUB_REPOSITORY: 'kovojs/kovo',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_RUN_ID: String(runId),
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_SHA: source.commit,
      GITHUB_WORKFLOW_REF: `kovojs/kovo/.github/workflows/perf-realistic.yml@${source.commit}`,
      GITHUB_WORKFLOW_SHA: source.commit,
    },
    startedAt: `2026-08-14T12:00:0${mode === 'unchanged' ? '1' : '2'}.000Z`,
  });
  const defaultCauses = ['client', 'server', 'final', 'app-source-trust', 'unattributed'];
  const causes = [
    ...eligibleCauses,
    ...defaultCauses.filter((cause) => !eligibleCauses.includes(cause)),
  ].slice(0, 5);
  const topFive = causes.map((cause, index) => ({
    cause,
    rank: index + 1,
    selfSamples: 100 - index,
    sessionEligibility: ['config-trust', 'typescript', 'stylesheet'].includes(cause)
      ? 'session-eligible'
      : 'one-shot-or-ineligible',
  }));
  const roles = [
    'analyze',
    'app-static-trust',
    'bootstrap',
    'client',
    ...(configStatus === 'executed' ? ['config-static-trust'] : []),
    'final',
    'orchestrator',
    'server',
    'typescript',
  ];
  const activeSamples = roles.length * 10;
  const idleSamples = roles.length;
  const waitSamples = 5;
  const uncertaintyMicros = 20_000 + 2 * roles.length * 10_000;
  const residualMicros = uncertaintyMicros + 90 * 10_000;
  const totalMicros = activeSamples * 10_000 + residualMicros;
  const profileArtifacts = roles.map((role, index) => {
    const pid = 1_000 + index;
    const waitSamples = role === 'bootstrap' ? 5 : 0;
    return {
      activeSamples: 10,
      bytes: 1_000 + index,
      idleSamples: 1,
      member: `raw-${mode}-${role}-pid-${String(pid)}.cpuprofile`,
      negativeTimeDeltas: 0,
      nodes: 20 + index,
      pid,
      role,
      samples: 11 + waitSamples,
      sha256: digest(`${mode}-${role}-profile`),
      waitSamples,
    };
  });
  const profileCensus = profileArtifacts.map((profile) => ({
    activeSamples: profile.activeSamples,
    causeCensus: [],
    exactMarkerSamples: 1,
    idleSamples: profile.idleSamples,
    negativeTimeDeltas: profile.negativeTimeDeltas,
    nodes: profile.nodes,
    role: profile.role,
    samples: profile.samples,
    waitSamples: profile.waitSamples,
    zeroTimeDeltas: 0,
  }));
  const processProfiles = profileArtifacts.map((profile) => ({ ...profile }));
  const executable = (name) => ({
    bytes: 1_024,
    path: `/usr/bin/${name}`,
    realPath: `/usr/bin/${name}`,
    sha256: digest(`executable-${name}`),
  });
  const nodeExecutable = executable('node');
  const processCensus = {
    classifier: 'kovo-build-exec-argv-role/v1',
    complete: true,
    forkOnlyProcesses: 0,
    processes: [
      {
        entry: null,
        executable: executable('time'),
        parentPid: null,
        pid: 900,
        role: 'collector-time',
        roleEvidence: 'gnu-time-exec/v1',
      },
      ...profileArtifacts.map((profile) => ({
        entry: executable(`entry-${profile.role}`),
        executable: nodeExecutable,
        parentPid: 900,
        pid: profile.pid,
        role: profile.role,
        roleEvidence: `${profile.role}-entry-exec/v1`,
      })),
    ],
    schema: 'kovo-build-process-census/v1',
    tools: {
      env: executable('env'),
      node: nodeExecutable,
      strace: executable('strace'),
      time: executable('time'),
    },
  };
  const processCpu = {
    cause: {
      cause: 'native-or-unprofiled',
      equivalentSamples: 90,
      sessionEligibility: 'one-shot-or-ineligible',
    },
    collector: { recursive: true, tool: '/usr/bin/time' },
    complete: true,
    fixedProfilerIntervalMicros: 10_000,
    idleV8Samples: idleSamples,
    profiledActiveMicros: activeSamples * 10_000,
    profiledActiveV8Samples: activeSamples,
    residualMicros,
    schema: 'kovo-build-process-tree-cpu/v1',
    systemMicros: 100_000,
    totalMicros,
    uncertainty: {
      policy: 'gnu-time-resolution-plus-two-profiler-intervals-per-process/v1',
      systemResolutionMicros: 10_000,
      totalMicros: uncertaintyMicros,
      userResolutionMicros: 10_000,
    },
    userMicros: totalMicros - 100_000,
    waitV8Samples: waitSamples,
  };
  const processCpuArtifact = {
    bytes: 91,
    fileName: `process-cpu-${mode}.txt`,
    sha256: digest(`process-cpu-${mode}`),
  };
  const profileArtifact = {
    bytes: 12_345,
    fileName: `build-${mode}.cpuprofile`,
    sha256: digest(`raw-profile-${mode}`),
  };
  const artifactMembers = [
    profileArtifact.fileName,
    processCpuArtifact.fileName,
    `profile-${mode}.json`,
    ...profileArtifacts.map(({ member }) => member),
  ].sort((left, right) => left.localeCompare(right));
  const facts = {
    artifactMembers,
    buildInvocation: {
      adapter: 'kovo-build-benchmark/v1',
      argv: ['../../../node_modules/.bin/kovo', 'build', './src/app.tsx'],
      cwd: '.',
      env: {},
      manifest: {
        bytes: 1_000,
        path: 'benchmarks/kovo/.corpora/kovo/n216/manifest.json',
        sha256: digest('manifest'),
        shapeDigest: digest('shape'),
        sourceDigest: digest('source'),
      },
      mode,
      profiledIterations: 1,
      warmups: 3,
    },
    capture: {
      complete: true,
      excludedNonKovoProfiles: 0,
      includedProfiles: roles.length,
      inputProfiles: roles.length,
      mergedNodes: 200,
      mergedSamples: activeSamples + idleSamples + waitSamples,
      merger: 'lossless-node-id-remap-with-synthetic-root/v1',
      processCensus,
      processCpu,
      processProfiles,
      profileSetAnalysis: {
        causeCensus: [],
        classifier: PERF_BUILD_SESSION_PROFILE_CLASSIFIER,
        complete: true,
        profileCensus,
        sampleCensus: {
          active: activeSamples,
          idle: idleSamples,
          nativeOrUnprofiled: 90,
          negativeTimeDeltas: 0,
          total: activeSamples + idleSamples + waitSamples,
          wait: waitSamples,
          zeroTimeDeltas: 0,
        },
        topFive,
      },
      schema: 'kovo-build-cpu-profile-capture/v1',
    },
    classifier: PERF_BUILD_SESSION_PROFILE_CLASSIFIER,
    diagnosticOnly: { profilerPerturbsDurations: true, publishTimingClaims: false },
    execution,
    host: structuredClone(budget.subject.host),
    integrity: {
      complete: true,
      errors: [],
      profileFlushedBeforeExit: true,
      processCensusComplete: true,
      processCpuComplete: true,
      sourceStable: true,
    },
    processCpuArtifact,
    profileArtifact,
    profileArtifacts,
    schema: PERF_BUILD_SESSION_PROFILE_SCHEMA,
    source,
    sourceAfter: structuredClone(source),
    sourcePhasePosture: {
      complete: true,
      phases: KOVO_BUILD_SOURCE_PHASES.map((name) => ({
        name,
        status: name === 'config-trust' ? configStatus : 'executed',
      })),
      schema: 'kovo-build-source-phase-posture/v1',
    },
    subject: {
      baselineWorkloadDigest: budget.subject.workloadIdentity.digest,
      corpusSize: 216,
      mode,
    },
    topFive,
    verdict: { reasons: [], status: 'diagnostic' },
    workloadIdentity: structuredClone(budget.subject.workloadIdentity),
  };
  const report = { ...facts, digest: digest(canonicalJson(facts)) };
  const rawText = JSON.stringify(report);
  const contentDigest = digest(rawText);
  const runUrl = execution.github.runUrl;
  const location = `${runUrl}/artifacts/${String(artifactId)}`;
  const apiUrl = `https://api.github.com/repos/kovojs/kovo/actions/artifacts/${String(artifactId)}`;
  const apiAuthorityDigest = digest(`api-authority-${mode}`);
  const jobsApiAuthorityDigest = digest(`jobs-authority-${mode}`);
  const runApiAuthorityDigest = digest(`run-authority-${mode}`);
  const archiveDigest = digest(`archive-${mode}`);
  return {
    contentDigest,
    custody: {
      apiAuthorityDigest,
      apiResponseDigest: digest(`saved-api-${mode}`),
      apiUrl,
      archiveByteLength: 12_345,
      archiveDigest,
      archiveDownloadUrl: `${apiUrl}/zip`,
      artifactId,
      artifactDigest: archiveDigest,
      artifactName: 'kovo-perf-build-profile-n216',
      artifactSizeInBytes: 12_345,
      jobsApiAuthorityDigest,
      jobsApiResponseDigest: digest(`saved-jobs-api-${mode}`),
      liveApiAuthorityDigest: apiAuthorityDigest,
      liveApiResponseDigest: digest(`live-api-${mode}`),
      liveJobsApiAuthorityDigest: jobsApiAuthorityDigest,
      liveJobsApiResponseDigest: digest(`live-jobs-api-${mode}`),
      liveRunApiAuthorityDigest: runApiAuthorityDigest,
      liveRunApiResponseDigest: digest(`live-run-api-${mode}`),
      location,
      reportContentDigest: contentDigest,
      reportMember: `profile-${mode}.json`,
      runApiAuthorityDigest,
      runApiResponseDigest: digest(`saved-run-api-${mode}`),
      runUrl,
      workflowRunId: runId,
    },
    location,
    rawText,
    report,
  };
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
