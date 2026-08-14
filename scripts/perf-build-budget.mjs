#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { executionIdentityFindings } from './lib/perf-execution.mjs';
import {
  KOVO_BUILD_PHASE_ATTRIBUTION_SCHEMA,
  KOVO_BUILD_SOURCE_PHASES,
  KOVO_BUILD_WORKER_PHASES,
} from './perf-build-benchmark.mjs';
import { ratifyPerformanceBaseline } from './perf-baseline-ratify.mjs';
import {
  buildProfileConfigStaticTrustRequired,
  PERF_BUILD_PROFILE_REQUIRED_ROLES,
} from './lib/perf-build-profile-classifier.mjs';
import {
  canonicalJson,
  hostFingerprintFindings,
  performanceReportFindings,
  workloadIdentityFindings,
} from './perf-regression-check.mjs';

export const PERF_BUILD_BUDGET_SCHEMA = 'kovo-build-performance-budget/v1';
export const PERF_BUILD_EVALUATION_SCHEMA = 'kovo-build-performance-evaluation/v1';
export const PERF_BUILD_PERSISTENCE_EVIDENCE_SCHEMA = 'kovo-build-persistence-evidence/v1';
export const PERF_BUILD_PERSISTENCE_ASSESSMENT_SCHEMA = 'kovo-build-persistence-assessment/v1';
export const PERF_BUILD_SESSION_PROFILE_SCHEMA = 'kovo-build-session-cpu-profile/v1';
export const PERF_BUILD_SESSION_PROFILE_CLASSIFIER = 'kovo-build-session-eligibility/phase-v1';

const PERF_BASELINE_SCHEMA = 'kovo-performance-baseline/v1';
const COMPARISON_SCHEMA = 'kovo-next-performance-comparison/v1';
const BUILD_BENCHMARK_SCHEMA = 'kovo-build-benchmark/v1';
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40,64}$/u;
const ARTIFACT_PATTERN =
  /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9][0-9]*\/artifacts\/[1-9][0-9]*$/u;
const REQUIRED_LOCKS = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);
const SUPPORTED_CORPUS_SIZES = Object.freeze([24, 216]);
const BUILD_MODES = Object.freeze(['clean', 'unchanged', 'edit']);
const WARM_BUILD_MODES = Object.freeze(['unchanged', 'edit']);
const BUILD_METRIC_SUFFIXES = Object.freeze(['durationMs', 'peakRssBytes', 'artifactBytes']);
const BUILD_BASELINE_REPORTS = 5;
const BUILD_SAMPLES_PER_WARM_MODE = 50;
const SESSION_ELIGIBLE_PHASES = Object.freeze(['config-trust', 'typescript', 'stylesheet']);
const BUILD_PROFILE_CAUSES = Object.freeze([
  ...KOVO_BUILD_SOURCE_PHASES,
  ...KOVO_BUILD_WORKER_PHASES,
  'cli-startup-tail',
  'worker-launch-transport',
  'native-or-unprofiled',
  'unattributed',
]);
const BUILD_PROFILE_INTERVAL_US = 10_000;
const BUILD_PROFILE_PROCESS_ROLES = Object.freeze([...PERF_BUILD_PROFILE_REQUIRED_ROLES]);
const BUILD_PROFILE_PROCESS_CENSUS_SCHEMA = 'kovo-build-process-census/v1';
const BUILD_PROFILE_PROCESS_CPU_SCHEMA = 'kovo-build-process-tree-cpu/v1';
const BUILD_PROFILE_PROCESS_ROLE_CLASSIFIER = 'kovo-build-exec-argv-role/v1';
const PERSISTENCE_UPPER_WALL_MINIMUM_RATIO = 0.1;

/**
 * Derive build ceilings from five linked baseline runs. Absolute values are never authored here:
 * they come from ratified current-head evidence plus the reviewed regression envelope. The only
 * fixed ratios are the Phase 2 milestones declared in plans/good-perf.md.
 */
export function deriveBuildPerformanceBudget(baseline, options = {}) {
  const maxRegressionPct = finitePercentage(options.maxRegressionPct, 5, 'maxRegressionPct');
  const findings = buildBudgetBaselineFindings(baseline, options.baselineEntries);
  if (findings.length > 0) {
    throw new TypeError(`Build performance baseline is unproven:\n${findings.join('\n')}`);
  }
  const corpusSize = baseline.subject.workloadIdentity.identity.policies.corpusSize;
  const metrics = {};
  for (const mode of BUILD_MODES) {
    for (const suffix of BUILD_METRIC_SUFFIXES) {
      const key = buildMetricKey(corpusSize, mode, suffix);
      const evidence = baseline.metrics[key].kovo;
      metrics[key] = {
        baseline: {
          median: evidence.median,
          nextMedian: baseline.metrics[key].nextjs.median,
          nextP95: baseline.metrics[key].nextjs.sampleP95.median,
          pairedMedian: baseline.metrics[key].pairedDifference.median,
          p95: evidence.sampleP95.median,
          runs: evidence.runs,
        },
        direction: 'lower-is-better',
        kind: 'ratified-regression-ceiling',
        medianMaximum: regressionCeiling(evidence.median, maxRegressionPct),
        p95Maximum: regressionCeiling(evidence.sampleP95.median, maxRegressionPct),
      };
    }
  }

  const facts = {
    baseline: {
      digest: sha256Canonical(baseline),
      reports: baseline.reports.map(({ contentDigest, execution, location, runUrl }) => ({
        contentDigest,
        execution,
        location,
        runUrl,
      })),
      sourceCommit: baseline.identity.source,
    },
    generatedFrom: baseline.generatedAt ?? null,
    metrics,
    persistenceEvidence: deriveBuildPersistenceEvidence({
      baseline,
      baselineEntries: options.baselineEntries,
      corpusSize,
    }),
    policy: {
      maxLoadPerCpu: baseline.policy.maxLoadPerCpu,
      maxRegressionPct,
      targets: {
        wallMedianVsNextMaximumRatio: 6,
        peakRssMedianVsNextMaximumRatio: 2,
      },
    },
    schema: PERF_BUILD_BUDGET_SCHEMA,
    subject: {
      corpusSize,
      host: baseline.subject.host,
      locks: baseline.subject.locks,
      workloadIdentity: baseline.subject.workloadIdentity,
    },
  };
  return { ...facts, digest: sha256Canonical(facts) };
}

/** Evaluate a new clean build report against one exact ratified host/lock/workload budget. */
export function evaluateBuildPerformanceBudget(budget, candidate) {
  const reasons = [
    ...buildBudgetFindings(budget),
    ...performanceReportFindings(candidate, 'candidate', {
      maxLoadPerCpu: budget?.policy?.maxLoadPerCpu ?? 1,
      minSamples: 5,
    }),
    ...executionIdentityFindings(candidate?.execution, { requireProvider: 'github-actions' }).map(
      (finding) => `candidate ${finding}`,
    ),
  ];
  if (candidate?.schema !== COMPARISON_SCHEMA)
    reasons.push(`candidate is not ${COMPARISON_SCHEMA}`);
  if (budget?.subject?.host?.digest !== candidate?.host?.digest) {
    reasons.push('candidate host identity differs from the ratified budget');
  }
  if (canonicalJson(budget?.subject?.locks) !== canonicalJson(candidate?.source?.locks)) {
    reasons.push('candidate dependency lock identity differs from the ratified budget');
  }
  if (
    budget?.subject?.workloadIdentity?.digest !== candidate?.workloadIdentity?.digest ||
    canonicalJson(budget?.subject?.workloadIdentity?.identity) !==
      canonicalJson(candidate?.workloadIdentity?.identity)
  ) {
    reasons.push('candidate workload identity differs from the ratified budget');
  }
  if (
    budget?.baseline?.reports?.some(({ execution }) => execution === candidate?.execution?.digest)
  ) {
    reasons.push('candidate reuses a baseline execution identity');
  }
  for (const metric of Object.keys(budget?.metrics ?? {})) {
    if (!ownRecord(candidate?.analysis?.[metric])) {
      reasons.push(`candidate required build metric ${metric} is unavailable`);
    }
  }
  reasons.push(...buildRawEvidenceFindings(candidate, budget?.subject?.corpusSize));

  const checks = [];
  if (reasons.length === 0) {
    for (const [metric, entry] of Object.entries(budget.metrics)) {
      const observed = candidate.analysis[metric]?.kovo;
      checks.push(
        upperBoundCheck(`${metric}.median`, observed.median, entry.medianMaximum, 'regression'),
        upperBoundCheck(`${metric}.p95`, observed.p95, entry.p95Maximum, 'regression'),
      );
    }
    for (const mode of BUILD_MODES) {
      const prefix = `corpus-n${String(budget.subject.corpusSize)}/build/${mode}/`;
      checks.push(
        ratioCheck(
          `${prefix}durationMs.median-vs-next`,
          candidate.analysis[`${prefix}durationMs`],
          budget.policy.targets.wallMedianVsNextMaximumRatio,
        ),
        ratioCheck(
          `${prefix}peakRssBytes.median-vs-next`,
          candidate.analysis[`${prefix}peakRssBytes`],
          budget.policy.targets.peakRssMedianVsNextMaximumRatio,
        ),
      );
    }
  }

  const uniqueReasons = [...new Set(reasons)].sort((left, right) => left.localeCompare(right));
  const failures = checks.filter(({ status }) => status === 'fail').map(({ id }) => id);
  return {
    budget: budget?.digest ?? null,
    candidate: {
      execution: candidate?.execution?.digest ?? null,
      sourceCommit: candidate?.source?.commit ?? null,
    },
    checks,
    schema: PERF_BUILD_EVALUATION_SCHEMA,
    verdict: {
      failures,
      reasons: uniqueReasons,
      status: uniqueReasons.length > 0 ? 'unproven' : failures.length > 0 ? 'regression' : 'pass',
    },
  };
}

/**
 * Decide whether an internal foreground build-session spike is justified. This is intentionally a
 * two-budget decision: the milestone shortcut covers all four N=24/N=216 warm cells, while only
 * the authenticated N=216 phase census may justify retained work. SPEC §5.2 rule 9 keeps the
 * source-proof and deploy-proof phases separate; this gate never treats an ambient disk cache as
 * evidence or as an eligible cause.
 */
export function assessBuildForegroundSession({ n24Budget, n216Budget, profileEntries = [] } = {}) {
  const findings = [
    ...buildBudgetFindings(n24Budget).map((finding) => `N=24 ${finding}`),
    ...buildBudgetFindings(n216Budget).map((finding) => `N=216 ${finding}`),
  ];
  if (n24Budget?.subject?.corpusSize !== 24) findings.push('N=24 budget has the wrong corpus');
  if (n216Budget?.subject?.corpusSize !== 216) findings.push('N=216 budget has the wrong corpus');
  if (
    n24Budget?.baseline?.sourceCommit !== n216Budget?.baseline?.sourceCommit ||
    canonicalJson(n24Budget?.subject?.locks) !== canonicalJson(n216Budget?.subject?.locks)
  ) {
    findings.push('build budgets do not share one source and dependency-lock identity');
  }

  const cells = buildPersistenceCells(n24Budget, n216Budget);
  if (cells.length !== 4) findings.push('build persistence warm-cell census is incomplete');
  if (findings.length > 0) {
    return persistenceAssessment({
      budgets: [n24Budget, n216Budget],
      cells,
      findings,
      outcome: 'unproven',
      profileEntries: [],
      rationale: 'malformed-evidence',
    });
  }

  if (cells.every((cell) => cell.milestone.status === 'pass')) {
    return persistenceAssessment({
      budgets: [n24Budget, n216Budget],
      cells,
      findings: [],
      outcome: 'not-warranted',
      profileEntries: [],
      rationale: 'all-warm-cells-meet-first-milestone',
    });
  }

  const n216Cells = cells.filter((cell) => cell.corpusSize === 216);
  if (
    n216Cells.length === 2 &&
    n216Cells.every((cell) => cell.residualUpper.medianRatio < PERSISTENCE_UPPER_WALL_MINIMUM_RATIO)
  ) {
    return persistenceAssessment({
      budgets: [n24Budget, n216Budget],
      cells,
      findings: [],
      outcome: 'not-warranted',
      profileEntries: [],
      rationale: 'both-n216-upper-residuals-below-ten-percent',
    });
  }

  const qualifyingCells = n216Cells.filter(
    (cell) =>
      cell.milestone.status === 'fail' &&
      cell.residualUpper.medianRatio >= PERSISTENCE_UPPER_WALL_MINIMUM_RATIO,
  );
  if (qualifyingCells.length === 0) {
    return persistenceAssessment({
      budgets: [n24Budget, n216Budget],
      cells,
      findings: [
        'mixed warm-cell evidence satisfies neither not-warranted shortcut nor the N=216 warrant predicate',
      ],
      outcome: 'unproven',
      profileEntries: [],
      rationale: 'mixed-evidence-unresolved',
    });
  }

  if (!Array.isArray(profileEntries)) {
    return persistenceAssessment({
      budgets: [n24Budget, n216Budget],
      cells,
      findings: ['build CPU profile evidence must be an array'],
      outcome: 'unproven',
      profileEntries: [],
      rationale: 'malformed-profile-evidence',
    });
  }
  if (profileEntries.length === 0) {
    return persistenceAssessment({
      budgets: [n24Budget, n216Budget],
      cells,
      findings: ['current authenticated N=216 unchanged and edit CPU profiles are required'],
      outcome: 'profile-required',
      profileEntries: [],
      rationale: 'current-profile-required',
    });
  }

  const profileFindings = [];
  const profilesByMode = new Map();
  for (const [index, entry] of profileEntries.entries()) {
    const mode = entry?.report?.subject?.mode;
    profileFindings.push(
      ...buildSessionProfileFindings(entry, n216Budget).map(
        (finding) => `profile[${String(index)}] ${finding}`,
      ),
    );
    if (!WARM_BUILD_MODES.includes(mode)) continue;
    if (profilesByMode.has(mode)) profileFindings.push(`duplicate ${mode} build CPU profile`);
    profilesByMode.set(mode, entry);
  }
  for (const mode of WARM_BUILD_MODES) {
    if (!profilesByMode.has(mode)) profileFindings.push(`${mode} build CPU profile is unavailable`);
  }
  if (profileEntries.length !== WARM_BUILD_MODES.length) {
    profileFindings.push('build CPU profile census must contain exactly unchanged and edit');
  }
  if (profileFindings.length > 0) {
    return persistenceAssessment({
      budgets: [n24Budget, n216Budget],
      cells,
      findings: profileFindings,
      outcome: 'unproven',
      profileEntries,
      rationale: 'malformed-profile-evidence',
    });
  }

  const qualifyingProfile = qualifyingCells.find((cell) =>
    profilesByMode
      .get(cell.mode)
      .report.topFive.some(({ sessionEligibility }) => sessionEligibility === 'session-eligible'),
  );
  return persistenceAssessment({
    budgets: [n24Budget, n216Budget],
    cells,
    findings:
      qualifyingProfile === undefined
        ? ['current N=216 profiles do not prove session-eligible work in a qualifying top five']
        : [],
    outcome: qualifyingProfile === undefined ? 'unproven' : 'warranted',
    profileEntries,
    rationale:
      qualifyingProfile === undefined
        ? 'current-profile-does-not-prove-warrant'
        : 'n216-miss-upper-residual-and-session-eligible-top-five-proven',
  });
}

/** Validate an assessment's own fail-closed schema and optional exact re-derivation inputs. */
export function buildPersistenceAssessmentFindings(assessment, inputs) {
  if (!ownRecord(assessment) || assessment.schema !== PERF_BUILD_PERSISTENCE_ASSESSMENT_SCHEMA) {
    return [`assessment is not ${PERF_BUILD_PERSISTENCE_ASSESSMENT_SCHEMA}`];
  }
  const findings = [];
  const { digest, ...facts } = assessment;
  if (!DIGEST_PATTERN.test(digest ?? '') || digest !== sha256Canonical(facts)) {
    findings.push('assessment digest is not derived from its facts');
  }
  if (!['decided', 'unproven'].includes(assessment.verdict?.status)) {
    findings.push('assessment verdict status is unavailable');
  }
  if (!nonEmptyString(assessment.verdict?.rationale)) {
    findings.push('assessment rationale is unavailable');
  }
  if (
    !['not-warranted', 'profile-required', 'unproven', 'warranted'].includes(
      assessment.verdict?.outcome,
    )
  ) {
    findings.push('assessment outcome is unavailable');
  }
  if (
    !Array.isArray(assessment.verdict?.findings) ||
    assessment.verdict.findings.some((finding) => !nonEmptyString(finding)) ||
    canonicalJson(assessment.verdict.findings) !==
      canonicalJson(
        [...new Set(assessment.verdict.findings ?? [])].sort((left, right) =>
          left.localeCompare(right),
        ),
      )
  ) {
    findings.push('assessment findings are malformed');
  }
  const expectedStatus = ['profile-required', 'unproven'].includes(assessment.verdict?.outcome)
    ? 'unproven'
    : 'decided';
  if (assessment.verdict?.status !== expectedStatus) {
    findings.push('assessment status is not derived from its outcome');
  }
  if (!Array.isArray(assessment.cells)) {
    findings.push('assessment warm-cell census is incomplete');
  } else if (assessment.cells.length !== 4 && assessment.verdict?.outcome !== 'unproven') {
    findings.push('assessment warm-cell census is incomplete');
  } else if (assessment.cells.length === 4) {
    const identities = new Set();
    for (const cell of assessment.cells) {
      const identity = `${String(cell?.corpusSize)}/${String(cell?.mode)}`;
      const expectedMilestone =
        Number.isFinite(cell?.milestone?.wallMedianVsNextRatio) &&
        cell.milestone.wallMedianVsNextRatio <= 6 &&
        Number.isFinite(cell?.milestone?.peakRssMedianVsNextRatio) &&
        cell.milestone.peakRssMedianVsNextRatio <= 2
          ? 'pass'
          : 'fail';
      if (
        !SUPPORTED_CORPUS_SIZES.includes(cell?.corpusSize) ||
        !WARM_BUILD_MODES.includes(cell?.mode) ||
        identities.has(identity) ||
        cell?.milestone?.status !== expectedMilestone ||
        !finiteNonNegative(cell?.artifactBytes?.kovoMedian) ||
        !finiteNonNegative(cell?.artifactBytes?.kovoP95) ||
        !finiteNonNegative(cell?.wall?.kovoMedianMs) ||
        !finiteNonNegative(cell?.wall?.kovoP95Ms) ||
        !Number.isFinite(cell?.wall?.nextMedianMs) ||
        cell.wall.nextMedianMs <= 0 ||
        cell.milestone.wallMedianVsNextRatio !== cell.wall.kovoMedianMs / cell.wall.nextMedianMs ||
        !Number.isFinite(cell?.residualUpper?.medianRatio) ||
        cell.residualUpper.medianRatio < 0 ||
        cell.residualUpper.medianRatio > 1 ||
        cell.residualUpper.samples !== 50
      ) {
        findings.push('assessment warm cell is malformed, duplicated, or not derived');
      }
      identities.add(identity);
    }
    if (
      canonicalJson([...identities].sort((left, right) => left.localeCompare(right))) !==
      canonicalJson(['216/edit', '216/unchanged', '24/edit', '24/unchanged'])
    ) {
      findings.push('assessment warm-cell identities are incomplete');
    }
  }
  if (
    assessment.policy?.upperWallMinimumRatio !== PERSISTENCE_UPPER_WALL_MINIMUM_RATIO ||
    canonicalJson(assessment.policy?.sessionEligiblePhases) !==
      canonicalJson(SESSION_ELIGIBLE_PHASES) ||
    assessment.policy?.appSourceTrustEligible !== false ||
    assessment.policy?.diskCacheEligible !== false
  ) {
    findings.push('assessment policy differs from the foreground-session decision contract');
  }
  if (!ownRecord(assessment.budgets)) {
    findings.push('assessment build-budget references are unavailable');
  } else if (
    assessment.cells?.length === 4 &&
    (!DIGEST_PATTERN.test(assessment.budgets.n24 ?? '') ||
      !DIGEST_PATTERN.test(assessment.budgets.n216 ?? ''))
  ) {
    findings.push('assessment build-budget references are unavailable');
  }
  if (!Array.isArray(assessment.profiles)) {
    findings.push('assessment profile references are unavailable');
  } else {
    if (![0, 2].includes(assessment.profiles.length)) {
      findings.push('assessment profile reference census is partial');
    }
    const modes = new Set();
    for (const profile of assessment.profiles) {
      const apiUrl = `https://api.github.com/repos/kovojs/kovo/actions/artifacts/${String(profile?.artifactId)}`;
      const runUrl = `https://github.com/kovojs/kovo/actions/runs/${String(profile?.workflowRunId)}`;
      if (
        !WARM_BUILD_MODES.includes(profile?.mode) ||
        modes.has(profile?.mode) ||
        !DIGEST_PATTERN.test(profile?.contentDigest ?? '') ||
        !DIGEST_PATTERN.test(profile?.execution ?? '') ||
        !ARTIFACT_PATTERN.test(profile?.location ?? '') ||
        !DIGEST_PATTERN.test(profile?.reportDigest ?? '') ||
        !Array.isArray(profile?.topFive) ||
        profile.topFive.length !== 5 ||
        profile?.artifactName !== 'kovo-perf-build-profile-n216' ||
        profile?.reportMember !== `profile-${String(profile?.mode)}.json` ||
        profile?.reportContentDigest !== profile?.contentDigest ||
        !validProfileArtifactCustodyEvidence(profile) ||
        !Number.isSafeInteger(profile?.artifactId) ||
        profile.artifactId < 1 ||
        !Number.isSafeInteger(profile?.workflowRunId) ||
        profile.workflowRunId < 1 ||
        profile?.apiUrl !== apiUrl ||
        profile?.archiveDownloadUrl !== `${apiUrl}/zip` ||
        profile?.runUrl !== runUrl ||
        profile?.location !== `${runUrl}/artifacts/${String(profile?.artifactId)}` ||
        !DIGEST_PATTERN.test(profile?.profileArtifact?.sha256 ?? '') ||
        !Number.isSafeInteger(profile?.profileArtifact?.bytes) ||
        profile.profileArtifact.bytes < 1
      ) {
        findings.push('assessment profile reference is malformed or duplicated');
      }
      const causes = new Set();
      for (const [index, cause] of (profile?.topFive ?? []).entries()) {
        const expectedEligibility = SESSION_ELIGIBLE_PHASES.includes(cause?.cause)
          ? 'session-eligible'
          : 'one-shot-or-ineligible';
        if (
          cause?.rank !== index + 1 ||
          !BUILD_PROFILE_CAUSES.includes(cause?.cause) ||
          causes.has(cause?.cause) ||
          cause?.sessionEligibility !== expectedEligibility ||
          !Number.isSafeInteger(cause?.selfSamples) ||
          cause.selfSamples < 1 ||
          (index > 0 && cause.selfSamples > profile.topFive[index - 1]?.selfSamples)
        ) {
          findings.push('assessment profile top-five cause is malformed or misclassified');
        }
        causes.add(cause?.cause);
      }
      modes.add(profile?.mode);
    }
    if (
      assessment.profiles.length === 2 &&
      canonicalJson([...modes].sort((left, right) => left.localeCompare(right))) !==
        canonicalJson([...WARM_BUILD_MODES].sort((left, right) => left.localeCompare(right)))
    ) {
      findings.push('assessment profile reference modes are incomplete');
    }
  }
  if (
    assessment.cells?.length === 4 &&
    assessment.verdict?.outcome !== 'unproven' &&
    Array.isArray(assessment.profiles)
  ) {
    const allWarmMilestonesMet = assessment.cells.every((cell) => cell.milestone.status === 'pass');
    const n216Cells = assessment.cells.filter((cell) => cell.corpusSize === 216);
    const bothN216ResidualsBelow = n216Cells.every(
      (cell) => cell.residualUpper.medianRatio < PERSISTENCE_UPPER_WALL_MINIMUM_RATIO,
    );
    const qualifyingCells = n216Cells.filter(
      (cell) =>
        cell.milestone.status === 'fail' &&
        cell.residualUpper.medianRatio >= PERSISTENCE_UPPER_WALL_MINIMUM_RATIO,
    );
    const profilesByMode = new Map(assessment.profiles.map((profile) => [profile.mode, profile]));
    const qualifyingProfilePresent = qualifyingCells.some((cell) =>
      profilesByMode
        .get(cell.mode)
        ?.topFive?.some(({ sessionEligibility }) => sessionEligibility === 'session-eligible'),
    );
    let expectedOutcome;
    let expectedRationale;
    if (allWarmMilestonesMet) {
      expectedOutcome = 'not-warranted';
      expectedRationale = 'all-warm-cells-meet-first-milestone';
    } else if (bothN216ResidualsBelow) {
      expectedOutcome = 'not-warranted';
      expectedRationale = 'both-n216-upper-residuals-below-ten-percent';
    } else if (qualifyingCells.length === 0) {
      expectedOutcome = 'unproven';
      expectedRationale = 'mixed-evidence-unresolved';
    } else if (assessment.profiles.length === 0) {
      expectedOutcome = 'profile-required';
      expectedRationale = 'current-profile-required';
    } else if (qualifyingProfilePresent) {
      expectedOutcome = 'warranted';
      expectedRationale = 'n216-miss-upper-residual-and-session-eligible-top-five-proven';
    } else {
      expectedOutcome = 'unproven';
      expectedRationale = 'current-profile-does-not-prove-warrant';
    }
    if (
      assessment.verdict.outcome !== expectedOutcome ||
      assessment.verdict.rationale !== expectedRationale
    ) {
      findings.push('assessment outcome is not derived from its warm cells and current profiles');
    }
  }
  if (assessment.verdict?.status === 'decided' && assessment.verdict.findings?.length !== 0) {
    findings.push('decided assessment retains unproven findings');
  }
  if (assessment.verdict?.status === 'unproven' && assessment.verdict.findings?.length === 0) {
    findings.push('unproven assessment does not disclose a finding');
  }
  if (inputs !== undefined && findings.length === 0) {
    const reproduced = assessBuildForegroundSession(inputs);
    if (canonicalJson(reproduced) !== canonicalJson(assessment)) {
      findings.push('assessment is not reproduced from its budgets and profile evidence');
    }
  }
  return [...new Set(findings)].sort((left, right) => left.localeCompare(right));
}

function deriveBuildPersistenceEvidence({ baseline, baselineEntries, corpusSize }) {
  const entriesByDigest = new Map(baselineEntries.map((entry) => [entry.contentDigest, entry]));
  const orderedEntries = baseline.reports.map(({ contentDigest }) =>
    entriesByDigest.get(contentDigest),
  );
  if (
    orderedEntries.length !== BUILD_BASELINE_REPORTS ||
    orderedEntries.some((entry) => !ownRecord(entry))
  ) {
    throw new TypeError(
      'Build performance baseline is unproven:\nbaseline raw build report census must contain exactly five linked reports',
    );
  }
  const modes = {};
  for (const mode of WARM_BUILD_MODES) {
    const samples = [];
    for (const entry of orderedEntries) {
      const cells = entry.report.rawCells.filter(
        (cell) =>
          cell?.cell === 'build' &&
          cell.framework === 'kovo' &&
          cell.lane === `corpus-n${String(corpusSize)}` &&
          cell.mode === mode,
      );
      for (const cell of cells) {
        for (const [sampleIndex, sample] of cell.report.samples.entries()) {
          const phases = new Map(
            sample.phaseCensus.source.phases.map((phase) => [phase.name, phase.durationMs]),
          );
          const eligibleDurationMs = SESSION_ELIGIBLE_PHASES.reduce(
            (total, phase) => total + phases.get(phase),
            0,
          );
          const cliStartupTailMs = sample.phaseAttribution.cliStartupTail.durationMs;
          const upperDurationMs = eligibleDurationMs + cliStartupTailMs;
          if (sample.durationMs <= 0 || upperDurationMs > sample.durationMs + 1e-6) {
            throw new TypeError(
              `Build performance baseline is unproven:\nN=${String(corpusSize)} ${mode} session-eligible upper bound exceeds or lacks wall time`,
            );
          }
          samples.push({
            cliStartupTailMs,
            eligibleDurationMs,
            occurrence: cell.occurrence,
            reportContentDigest: entry.contentDigest,
            sample: sampleIndex,
            upperDurationMs,
            upperWallRatio: upperDurationMs / sample.durationMs,
            wallDurationMs: sample.durationMs,
          });
        }
      }
    }
    if (samples.length !== BUILD_SAMPLES_PER_WARM_MODE) {
      throw new TypeError(
        `Build performance baseline is unproven:\nN=${String(corpusSize)} ${mode} persistence evidence must contain exactly 50 samples`,
      );
    }
    const duration = baseline.metrics[buildMetricKey(corpusSize, mode, 'durationMs')];
    const rss = baseline.metrics[buildMetricKey(corpusSize, mode, 'peakRssBytes')];
    const artifacts = baseline.metrics[buildMetricKey(corpusSize, mode, 'artifactBytes')];
    const wallRatio = exactRatio(duration.kovo.median, duration.nextjs.median);
    const rssRatio = exactRatio(rss.kovo.median, rss.nextjs.median);
    modes[mode] = {
      artifactBytes: {
        kovoMedian: artifacts.kovo.median,
        kovoP95: artifacts.kovo.sampleP95.median,
      },
      milestone: {
        peakRssMedianVsNextRatio: rssRatio,
        status: wallRatio <= 6 && rssRatio <= 2 ? 'pass' : 'fail',
        wallMedianVsNextRatio: wallRatio,
      },
      residualUpper: {
        medianRatio: median(samples.map(({ upperWallRatio }) => upperWallRatio)),
        samples,
      },
      wall: {
        kovoMedianMs: duration.kovo.median,
        kovoP95Ms: duration.kovo.sampleP95.median,
        nextMedianMs: duration.nextjs.median,
      },
    };
  }
  return {
    corpusSize,
    modes,
    policy: {
      appSourceTrustEligible: false,
      diskCacheEligible: false,
      peakRssMedianVsNextMaximumRatio: 2,
      sessionEligiblePhases: [...SESSION_ELIGIBLE_PHASES],
      upperWallMinimumRatio: PERSISTENCE_UPPER_WALL_MINIMUM_RATIO,
      wallMedianVsNextMaximumRatio: 6,
    },
    reports: baseline.reports.map(({ contentDigest }) => contentDigest),
    schema: PERF_BUILD_PERSISTENCE_EVIDENCE_SCHEMA,
  };
}

function buildPersistenceCells(n24Budget, n216Budget) {
  return [n24Budget, n216Budget].flatMap((budget) =>
    WARM_BUILD_MODES.flatMap((mode) => {
      const evidence = budget?.persistenceEvidence?.modes?.[mode];
      return evidence === undefined
        ? []
        : [
            {
              corpusSize: budget.subject.corpusSize,
              artifactBytes: evidence.artifactBytes,
              milestone: evidence.milestone,
              mode,
              residualUpper: {
                medianRatio: evidence.residualUpper.medianRatio,
                samples: evidence.residualUpper.samples.length,
              },
              wall: evidence.wall,
            },
          ];
    }),
  );
}

function persistenceAssessment({ budgets, cells, findings, outcome, profileEntries, rationale }) {
  const facts = {
    budgets: {
      n24: budgets[0]?.digest ?? null,
      n216: budgets[1]?.digest ?? null,
    },
    cells,
    policy: {
      appSourceTrustEligible: false,
      diskCacheEligible: false,
      sessionEligiblePhases: [...SESSION_ELIGIBLE_PHASES],
      upperWallMinimumRatio: PERSISTENCE_UPPER_WALL_MINIMUM_RATIO,
    },
    profiles: profileEntries.map(profileReference),
    schema: PERF_BUILD_PERSISTENCE_ASSESSMENT_SCHEMA,
    verdict: {
      findings: [...new Set(findings)].sort((left, right) => left.localeCompare(right)),
      outcome,
      rationale,
      status: ['profile-required', 'unproven'].includes(outcome) ? 'unproven' : 'decided',
    },
  };
  return { ...facts, digest: sha256Canonical(facts) };
}

function profileReference(entry) {
  return {
    ...(ownRecord(entry?.custody) ? entry.custody : {}),
    contentDigest: entry?.contentDigest ?? null,
    execution: entry?.report?.execution?.digest ?? null,
    location: entry?.location ?? null,
    mode: entry?.report?.subject?.mode ?? null,
    profileArtifact: entry?.report?.profileArtifact ?? null,
    reportDigest: entry?.report?.digest ?? null,
    topFive: entry?.report?.topFive ?? null,
  };
}

function buildSessionProfileFindings(entry, budget) {
  const findings = [];
  const report = entry?.report;
  const custody = entry?.custody;
  let parsedMatches = false;
  try {
    parsedMatches =
      typeof entry?.rawText === 'string' &&
      canonicalJson(JSON.parse(entry.rawText)) === canonicalJson(report);
  } catch {
    parsedMatches = false;
  }
  const custodyApiUrl = `https://api.github.com/repos/kovojs/kovo/actions/artifacts/${String(custody?.artifactId)}`;
  const custodyRunUrl = `https://github.com/kovojs/kovo/actions/runs/${String(custody?.workflowRunId)}`;
  if (
    !DIGEST_PATTERN.test(entry?.contentDigest ?? '') ||
    sha256Bytes(entry?.rawText ?? '') !== entry?.contentDigest ||
    !parsedMatches
  ) {
    findings.push('profile report bytes do not match their content identity');
  }
  if (
    custody?.reportContentDigest !== entry?.contentDigest ||
    custody?.location !== entry?.location ||
    custody?.artifactName !== 'kovo-perf-build-profile-n216' ||
    custody?.reportMember !== `profile-${String(report?.subject?.mode)}.json` ||
    !ARTIFACT_PATTERN.test(entry?.location ?? '') ||
    custody?.runUrl !== report?.execution?.github?.runUrl ||
    !Number.isSafeInteger(custody?.artifactId) ||
    custody.artifactId < 1 ||
    !Number.isSafeInteger(custody?.workflowRunId) ||
    custody.workflowRunId < 1 ||
    custody?.apiUrl !== custodyApiUrl ||
    custody?.archiveDownloadUrl !== `${custodyApiUrl}/zip` ||
    custody?.runUrl !== custodyRunUrl ||
    custody?.location !== `${custodyRunUrl}/artifacts/${String(custody?.artifactId)}` ||
    !validProfileArtifactCustodyEvidence(custody)
  ) {
    findings.push('profile artifact custody is incomplete or mismatched');
  }
  if (!ownRecord(report) || report.schema !== PERF_BUILD_SESSION_PROFILE_SCHEMA) {
    findings.push(`profile report is not ${PERF_BUILD_SESSION_PROFILE_SCHEMA}`);
    return findings;
  }
  const { digest, ...profileFacts } = report;
  if (!DIGEST_PATTERN.test(digest ?? '') || digest !== sha256Canonical(profileFacts)) {
    findings.push('profile report digest is not derived from its facts');
  }
  findings.push(
    ...executionIdentityFindings(report.execution, { requireProvider: 'github-actions' }).map(
      (finding) => `profile ${finding}`,
    ),
  );
  findings.push(...hostFingerprintFindings(report.host, 'profile'));
  findings.push(...workloadIdentityFindings(report.workloadIdentity, 'profile'));
  if (
    report.source?.commit !== budget.baseline.sourceCommit ||
    report.source?.dirty !== false ||
    canonicalJson(report.source?.locks) !== canonicalJson(budget.subject.locks) ||
    canonicalJson(report.sourceAfter) !== canonicalJson(report.source) ||
    report.execution?.github?.sha !== report.source?.commit
  ) {
    findings.push('profile source identity is not current, clean, and stable');
  }
  if (
    // Host v2 deliberately retains raw RAM while its digest defines the normalized cohort. A
    // separately scheduled diagnostic need not observe byte-identical hypervisor-reserved memory.
    report.host?.digest !== budget.subject.host?.digest ||
    report.subject?.corpusSize !== 216 ||
    !WARM_BUILD_MODES.includes(report.subject?.mode) ||
    report.subject?.baselineWorkloadDigest !== budget.subject.workloadIdentity.digest ||
    report.workloadIdentity?.digest !== budget.subject.workloadIdentity.digest
  ) {
    findings.push('profile host or N=216 warm workload differs from the ratified budget');
  }
  if (
    report.classifier !== PERF_BUILD_SESSION_PROFILE_CLASSIFIER ||
    report.diagnosticOnly?.publishTimingClaims !== false ||
    report.integrity?.complete !== true ||
    report.integrity?.profileFlushedBeforeExit !== true ||
    report.integrity?.processCensusComplete !== true ||
    report.integrity?.processCpuComplete !== true ||
    report.integrity?.sourceStable !== true ||
    canonicalJson(report.integrity?.errors) !== canonicalJson([]) ||
    report.verdict?.status !== 'diagnostic' ||
    canonicalJson(report.verdict?.reasons) !== canonicalJson([])
  ) {
    findings.push('profile diagnostic posture or integrity is incomplete');
  }
  if (
    !DIGEST_PATTERN.test(report.profileArtifact?.sha256 ?? '') ||
    !Number.isSafeInteger(report.profileArtifact?.bytes) ||
    report.profileArtifact.bytes < 1 ||
    !nonEmptyString(report.profileArtifact?.fileName)
  ) {
    findings.push('raw CPU profile artifact identity is unavailable');
  }
  findings.push(...buildProfileProcessEvidenceFindings(report));
  if (!Array.isArray(report.topFive) || report.topFive.length !== 5) {
    findings.push('profile top-five cause census is incomplete');
  } else {
    const causes = new Set();
    for (const [index, cause] of report.topFive.entries()) {
      const expectedEligibility = SESSION_ELIGIBLE_PHASES.includes(cause?.cause)
        ? 'session-eligible'
        : 'one-shot-or-ineligible';
      if (
        cause?.rank !== index + 1 ||
        !BUILD_PROFILE_CAUSES.includes(cause?.cause) ||
        causes.has(cause?.cause) ||
        cause?.sessionEligibility !== expectedEligibility ||
        !Number.isSafeInteger(cause?.selfSamples) ||
        cause.selfSamples < 1 ||
        (index > 0 && cause.selfSamples > report.topFive[index - 1]?.selfSamples)
      ) {
        findings.push('profile top-five cause is malformed or misclassified');
      }
      causes.add(cause?.cause);
    }
  }
  return [...new Set(findings)];
}

function buildProfileProcessEvidenceFindings(report) {
  const findings = [];
  const mode = report?.subject?.mode;
  const artifacts = report?.profileArtifacts;
  const capture = report?.capture;
  const processCensus = capture?.processCensus;
  const processCpu = capture?.processCpu;
  const analysis = capture?.profileSetAnalysis;
  let requiredProcessRoles;
  try {
    requiredProcessRoles = [
      ...BUILD_PROFILE_PROCESS_ROLES,
      ...(buildProfileConfigStaticTrustRequired(report?.sourcePhasePosture)
        ? ['config-static-trust']
        : []),
    ];
  } catch {
    findings.push('profile source phase posture is unavailable or malformed');
    return findings;
  }
  if (
    report?.buildInvocation?.adapter !== BUILD_BENCHMARK_SCHEMA ||
    report.buildInvocation.mode !== mode ||
    report.buildInvocation.profiledIterations !== 1 ||
    report.buildInvocation.warmups !== 3 ||
    !Array.isArray(report.buildInvocation.argv) ||
    report.buildInvocation.argv.length < 1 ||
    !nonEmptyString(report.buildInvocation.cwd) ||
    !ownRecord(report.buildInvocation.env) ||
    !DIGEST_PATTERN.test(report.buildInvocation.manifest?.sha256 ?? '') ||
    !DIGEST_PATTERN.test(report.buildInvocation.manifest?.shapeDigest ?? '') ||
    !DIGEST_PATTERN.test(report.buildInvocation.manifest?.sourceDigest ?? '')
  ) {
    findings.push('profile build invocation is incomplete');
  }
  if (
    !Array.isArray(artifacts) ||
    artifacts.length !== requiredProcessRoles.length ||
    !ownRecord(capture) ||
    capture.complete !== true ||
    capture.inputProfiles !== artifacts?.length ||
    capture.includedProfiles !== artifacts?.length ||
    capture.excludedNonKovoProfiles !== 0 ||
    capture.merger !== 'lossless-node-id-remap-with-synthetic-root/v1'
  ) {
    findings.push('profile original-process artifact census is incomplete');
    return findings;
  }
  const artifactRoles = [];
  const artifactPids = new Set();
  const artifactMembers = new Set();
  for (const artifact of artifacts) {
    const expectedMember = `raw-${String(mode)}-${String(artifact?.role)}-pid-${String(artifact?.pid)}.cpuprofile`;
    if (
      !requiredProcessRoles.includes(artifact?.role) ||
      !Number.isSafeInteger(artifact?.pid) ||
      artifact.pid < 1 ||
      artifactPids.has(artifact.pid) ||
      artifact?.member !== expectedMember ||
      artifactMembers.has(artifact.member) ||
      !DIGEST_PATTERN.test(artifact?.sha256 ?? '') ||
      !positiveSafeInteger(artifact?.bytes) ||
      !positiveSafeInteger(artifact?.nodes) ||
      !positiveSafeInteger(artifact?.samples) ||
      !nonNegativeSafeInteger(artifact?.activeSamples) ||
      !nonNegativeSafeInteger(artifact?.idleSamples) ||
      !nonNegativeSafeInteger(artifact?.waitSamples) ||
      artifact.activeSamples + artifact.idleSamples + artifact.waitSamples !== artifact.samples ||
      !nonNegativeSafeInteger(artifact?.negativeTimeDeltas)
    ) {
      findings.push('profile original-process artifact identity is malformed or duplicated');
    }
    artifactRoles.push(artifact?.role);
    artifactPids.add(artifact?.pid);
    artifactMembers.add(artifact?.member);
  }
  if (
    canonicalJson([...artifactRoles].sort((left, right) => left.localeCompare(right))) !==
    canonicalJson([...requiredProcessRoles].sort((left, right) => left.localeCompare(right)))
  ) {
    findings.push('profile original-process role census differs');
  }
  const expectedMembers = [
    `build-${String(mode)}.cpuprofile`,
    `process-cpu-${String(mode)}.txt`,
    `profile-${String(mode)}.json`,
    ...artifacts.map(({ member }) => member),
  ].sort((left, right) => left.localeCompare(right));
  if (canonicalJson(report?.artifactMembers) !== canonicalJson(expectedMembers)) {
    findings.push('profile declared artifact member census differs');
  }
  if (
    !ownRecord(report.processCpuArtifact) ||
    report.processCpuArtifact.fileName !== `process-cpu-${String(mode)}.txt` ||
    !DIGEST_PATTERN.test(report.processCpuArtifact.sha256 ?? '') ||
    !positiveSafeInteger(report.processCpuArtifact.bytes)
  ) {
    findings.push('profile recursive CPU artifact identity is unavailable');
  }
  const censusProcesses = processCensus?.processes;
  if (
    processCensus?.schema !== BUILD_PROFILE_PROCESS_CENSUS_SCHEMA ||
    processCensus?.classifier !== BUILD_PROFILE_PROCESS_ROLE_CLASSIFIER ||
    processCensus?.complete !== true ||
    !nonNegativeSafeInteger(processCensus?.forkOnlyProcesses) ||
    !Array.isArray(censusProcesses) ||
    !ownRecord(processCensus?.tools)
  ) {
    findings.push('profile process census is incomplete');
  } else {
    const nodeProcesses = censusProcesses.filter(({ role }) => requiredProcessRoles.includes(role));
    const nodeKeys = nodeProcesses
      .map(({ pid, role }) => `${String(pid)}:${String(role)}`)
      .sort((left, right) => left.localeCompare(right));
    const artifactKeys = artifacts
      .map(({ pid, role }) => `${String(pid)}:${String(role)}`)
      .sort((left, right) => left.localeCompare(right));
    const processPids = new Set(censusProcesses.map(({ pid }) => pid));
    const processRoots = censusProcesses.filter(
      ({ parentPid }) => parentPid === null || !processPids.has(parentPid),
    );
    if (
      canonicalJson(nodeKeys) !== canonicalJson(artifactKeys) ||
      censusProcesses.some(
        (process) =>
          !Number.isSafeInteger(process?.pid) ||
          process.pid < 1 ||
          !['collector-time', 'native-one-shot', ...requiredProcessRoles].includes(process?.role) ||
          !nonEmptyString(process?.roleEvidence) ||
          !executableEvidence(process?.executable) ||
          (requiredProcessRoles.includes(process?.role) && !executableEvidence(process?.entry)),
      ) ||
      censusProcesses.filter(({ role }) => role === 'collector-time').length !== 1 ||
      processPids.size !== censusProcesses.length ||
      processRoots.length !== 1 ||
      processRoots[0]?.role !== 'collector-time' ||
      censusProcesses.some(
        ({ parentPid, pid }) =>
          parentPid !== null && (parentPid === pid || !processPids.has(parentPid)),
      ) ||
      !['env', 'node', 'strace', 'time'].every((tool) =>
        executableEvidence(processCensus.tools[tool]),
      )
    ) {
      findings.push('profile process PID/role/executable census is malformed');
    }
  }
  const processProfiles = capture?.processProfiles;
  if (
    !Array.isArray(processProfiles) ||
    canonicalJson(processProfiles?.map(profileProcessIdentity)) !==
      canonicalJson(artifacts.map(profileProcessIdentity))
  ) {
    findings.push('profile merged-view process census differs from original artifacts');
  }
  if (
    analysis?.classifier !== PERF_BUILD_SESSION_PROFILE_CLASSIFIER ||
    analysis?.complete !== true ||
    !Array.isArray(analysis?.profileCensus) ||
    analysis.profileCensus.length !== artifacts.length ||
    canonicalJson(analysis.topFive) !== canonicalJson(report.topFive) ||
    analysis.profileCensus.some((profile, index) => {
      const artifact = artifacts[index];
      return (
        profile?.role !== artifact.role ||
        profile?.nodes !== artifact.nodes ||
        profile?.samples !== artifact.samples ||
        profile?.activeSamples !== artifact.activeSamples ||
        profile?.idleSamples !== artifact.idleSamples ||
        profile?.waitSamples !== artifact.waitSamples ||
        profile?.negativeTimeDeltas !== artifact.negativeTimeDeltas
      );
    })
  ) {
    findings.push('profile classifier census differs from original artifacts');
  }
  const active = artifacts.reduce((sum, artifact) => sum + artifact.activeSamples, 0);
  const idle = artifacts.reduce((sum, artifact) => sum + artifact.idleSamples, 0);
  const wait = artifacts.reduce((sum, artifact) => sum + artifact.waitSamples, 0);
  const uncertainty = processCpu?.uncertainty;
  const expectedUncertainty =
    uncertainty?.userResolutionMicros +
    uncertainty?.systemResolutionMicros +
    2 * artifacts.length * BUILD_PROFILE_INTERVAL_US;
  const expectedResidual = processCpu?.totalMicros - active * BUILD_PROFILE_INTERVAL_US;
  const expectedEquivalent =
    expectedResidual === 0
      ? 0
      : Math.floor((expectedResidual - expectedUncertainty) / BUILD_PROFILE_INTERVAL_US);
  if (
    processCpu?.schema !== BUILD_PROFILE_PROCESS_CPU_SCHEMA ||
    processCpu?.complete !== true ||
    processCpu?.fixedProfilerIntervalMicros !== BUILD_PROFILE_INTERVAL_US ||
    processCpu?.profiledActiveV8Samples !== active ||
    processCpu?.idleV8Samples !== idle ||
    processCpu?.waitV8Samples !== wait ||
    processCpu?.profiledActiveMicros !== active * BUILD_PROFILE_INTERVAL_US ||
    processCpu?.cause?.cause !== 'native-or-unprofiled' ||
    processCpu?.cause?.sessionEligibility !== 'one-shot-or-ineligible' ||
    !nonNegativeSafeInteger(processCpu?.cause?.equivalentSamples) ||
    processCpu?.collector?.recursive !== true ||
    processCpu?.collector?.tool !== '/usr/bin/time' ||
    uncertainty?.policy !== 'gnu-time-resolution-plus-two-profiler-intervals-per-process/v1' ||
    !decimalResolutionMicros(uncertainty?.userResolutionMicros) ||
    !decimalResolutionMicros(uncertainty?.systemResolutionMicros) ||
    uncertainty?.totalMicros !== expectedUncertainty ||
    !nonNegativeSafeInteger(processCpu?.userMicros) ||
    !nonNegativeSafeInteger(processCpu?.systemMicros) ||
    processCpu?.totalMicros !== processCpu?.userMicros + processCpu?.systemMicros ||
    processCpu?.residualMicros !== expectedResidual ||
    expectedResidual < 0 ||
    (expectedResidual > 0 && expectedResidual <= expectedUncertainty) ||
    processCpu?.cause?.equivalentSamples !== expectedEquivalent ||
    (censusProcesses?.some(({ role }) => role === 'native-one-shot') && expectedEquivalent === 0) ||
    analysis?.sampleCensus?.active !== active ||
    analysis?.sampleCensus?.idle !== idle ||
    analysis?.sampleCensus?.wait !== wait ||
    analysis?.sampleCensus?.total !== active + idle + wait ||
    analysis?.sampleCensus?.nativeOrUnprofiled !== expectedEquivalent
  ) {
    findings.push('profile recursive CPU residual evidence is incomplete');
  }
  return findings;
}

function profileProcessIdentity(profile) {
  return {
    activeSamples: profile?.activeSamples,
    bytes: profile?.bytes,
    idleSamples: profile?.idleSamples,
    member: profile?.member,
    negativeTimeDeltas: profile?.negativeTimeDeltas,
    nodes: profile?.nodes,
    pid: profile?.pid,
    role: profile?.role,
    samples: profile?.samples,
    sha256: profile?.sha256,
    waitSamples: profile?.waitSamples,
  };
}

function executableEvidence(value) {
  return (
    ownRecord(value) &&
    nonEmptyString(value.path) &&
    nonEmptyString(value.realPath) &&
    positiveSafeInteger(value.bytes) &&
    DIGEST_PATTERN.test(value.sha256 ?? '')
  );
}

function validProfileArtifactCustodyEvidence(value) {
  const responseDigests = [
    value?.apiResponseDigest,
    value?.liveApiResponseDigest,
    value?.jobsApiResponseDigest,
    value?.liveJobsApiResponseDigest,
    value?.runApiResponseDigest,
    value?.liveRunApiResponseDigest,
  ];
  const authorityPairs = [
    [value?.apiAuthorityDigest, value?.liveApiAuthorityDigest],
    [value?.jobsApiAuthorityDigest, value?.liveJobsApiAuthorityDigest],
    [value?.runApiAuthorityDigest, value?.liveRunApiAuthorityDigest],
  ];
  return (
    responseDigests.every((digest) => DIGEST_PATTERN.test(digest ?? '')) &&
    authorityPairs.every(([saved, live]) => DIGEST_PATTERN.test(saved ?? '') && saved === live) &&
    DIGEST_PATTERN.test(value?.archiveDigest ?? '') &&
    value.archiveDigest === value?.artifactDigest &&
    positiveSafeInteger(value?.archiveByteLength) &&
    value.archiveByteLength === value?.artifactSizeInBytes
  );
}

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function nonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function decimalResolutionMicros(value) {
  return [1, 10, 100, 1_000, 10_000, 100_000].includes(value);
}

export function buildBudgetBaselineFindings(baseline, baselineEntries) {
  if (!ownRecord(baseline) || baseline.schema !== PERF_BASELINE_SCHEMA) {
    return [`baseline is not ${PERF_BASELINE_SCHEMA}`];
  }
  const findings = [];
  if (baseline.verdict?.status !== 'ratified') findings.push('baseline verdict is not ratified');
  if (baseline.policy?.minRuns !== BUILD_BASELINE_REPORTS) {
    findings.push('baseline policy must require exactly five runs');
  }
  if (!Number.isSafeInteger(baseline.policy?.minSamples) || baseline.policy.minSamples < 5) {
    findings.push('baseline did not require at least five samples');
  }
  if (baseline.policy?.requireProvider !== 'github-actions') {
    findings.push('baseline did not require GitHub Actions execution identity');
  }
  if (!validLinkedReports(baseline.reports)) {
    findings.push('baseline report links are short, malformed, or duplicated');
  }
  if (!COMMIT_PATTERN.test(baseline.subject?.sourceCommit ?? '')) {
    findings.push('baseline source commit is unavailable');
  }
  if (
    baseline.identity?.source !== baseline.subject?.sourceCommit ||
    baseline.identity?.host !== baseline.subject?.host?.digest ||
    baseline.identity?.workload !== baseline.subject?.workloadIdentity?.digest ||
    canonicalJson(baseline.identity?.locks) !== canonicalJson(baseline.subject?.locks)
  ) {
    findings.push('baseline subject does not match its ratified identity');
  }
  findings.push(...hostFingerprintFindings(baseline.subject?.host, 'baseline'));
  if (!nonEmptyString(baseline.subject?.host?.runnerImage)) {
    findings.push('baseline runner image identity is unavailable');
  }
  findings.push(...workloadIdentityFindings(baseline.subject?.workloadIdentity, 'baseline'));
  for (const lock of REQUIRED_LOCKS) {
    if (!DIGEST_PATTERN.test(baseline.subject?.locks?.[lock] ?? '')) {
      findings.push(`baseline ${lock} digest is unavailable`);
    }
  }
  findings.push(
    ...buildWorkloadFindings(baseline.subject?.workloadIdentity?.identity).map(
      (finding) => `baseline ${finding}`,
    ),
  );
  const corpusSize = baseline.subject?.workloadIdentity?.identity?.policies?.corpusSize;
  if (SUPPORTED_CORPUS_SIZES.includes(corpusSize)) {
    for (const mode of BUILD_MODES) {
      for (const suffix of BUILD_METRIC_SUFFIXES) {
        const key = buildMetricKey(corpusSize, mode, suffix);
        for (const subject of ['kovo', 'nextjs']) {
          if (!ratifiedMetricEvidence(baseline.metrics?.[key]?.[subject])) {
            findings.push(`baseline ${key} ${subject} evidence is unavailable`);
          }
        }
      }
    }
    findings.push(...baselineBuildReportFindings(baseline, baselineEntries, corpusSize));
  }
  return [...new Set(findings)].sort((left, right) => left.localeCompare(right));
}

function baselineBuildReportFindings(baseline, entries, corpusSize) {
  if (!Array.isArray(entries) || entries.length !== BUILD_BASELINE_REPORTS) {
    return ['baseline raw build report census must contain exactly five linked reports'];
  }
  if (!Array.isArray(baseline.reports) || baseline.reports.length !== BUILD_BASELINE_REPORTS) {
    return ['baseline ratified report census must contain exactly five linked reports'];
  }
  const findings = [];
  const linkedByDigest = new Map(baseline.reports.map((report) => [report.contentDigest, report]));
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    const label = `baseline report[${String(index)}]`;
    let parsedMatches = false;
    try {
      parsedMatches =
        typeof entry?.rawText === 'string' &&
        canonicalJson(JSON.parse(entry.rawText)) === canonicalJson(entry.report);
    } catch {
      parsedMatches = false;
    }
    const textDigest = typeof entry?.rawText === 'string' ? sha256Bytes(entry.rawText) : null;
    const linked = linkedByDigest.get(entry?.contentDigest);
    if (
      !DIGEST_PATTERN.test(entry?.contentDigest ?? '') ||
      textDigest !== entry.contentDigest ||
      !parsedMatches ||
      seen.has(entry.contentDigest) ||
      linked === undefined ||
      linked.location !== entry.location ||
      linked.execution !== entry.report?.execution?.digest ||
      linked.runUrl !== entry.report?.execution?.github?.runUrl
    ) {
      findings.push(`${label} does not match its ratified content/link identity`);
    }
    seen.add(entry?.contentDigest);
    findings.push(
      ...performanceReportFindings(entry?.report, label, {
        maxLoadPerCpu: baseline.policy.maxLoadPerCpu,
        minSamples: baseline.policy.minSamples,
      }),
      ...executionIdentityFindings(entry?.report?.execution, {
        requireProvider: 'github-actions',
      }).map((finding) => `${label} ${finding}`),
      ...buildRawEvidenceFindings(entry?.report, corpusSize).map(
        (finding) => `${label} ${finding}`,
      ),
    );
    if (
      entry?.report?.source?.commit !== baseline.subject?.sourceCommit ||
      entry?.report?.host?.digest !== baseline.subject?.host?.digest ||
      canonicalJson(entry?.report?.source?.locks) !== canonicalJson(baseline.subject?.locks) ||
      entry?.report?.workloadIdentity?.digest !== baseline.subject?.workloadIdentity?.digest
    ) {
      findings.push(`${label} does not match the ratified baseline subject`);
    }
  }
  if (
    seen.size !== BUILD_BASELINE_REPORTS ||
    baseline.reports.some(({ contentDigest }) => !seen.has(contentDigest))
  ) {
    findings.push('baseline raw build report census does not exactly match the ratified reports');
  }
  if (findings.length === 0) {
    const entriesByDigest = new Map(entries.map((entry) => [entry.contentDigest, entry]));
    const orderedEntries = baseline.reports.map((report) =>
      entriesByDigest.get(report.contentDigest),
    );
    const reratified = ratifyPerformanceBaseline(orderedEntries, baseline.policy);
    for (const field of ['identity', 'metrics', 'policy', 'reports', 'subject', 'verdict']) {
      if (canonicalJson(reratified[field]) !== canonicalJson(baseline[field])) {
        findings.push(`baseline ${field} is not reproduced by its linked raw reports`);
      }
    }
  }
  return findings;
}

export function buildBudgetFindings(budget) {
  if (!ownRecord(budget) || budget.schema !== PERF_BUILD_BUDGET_SCHEMA) {
    return [`budget is not ${PERF_BUILD_BUDGET_SCHEMA}`];
  }
  const findings = [];
  const { digest, ...facts } = budget;
  if (!DIGEST_PATTERN.test(digest ?? '') || digest !== sha256Canonical(facts)) {
    findings.push('budget digest is not derived from its facts');
  }
  if (!DIGEST_PATTERN.test(budget.baseline?.digest ?? '')) {
    findings.push('budget baseline digest is unavailable');
  }
  if (!validLinkedReports(budget.baseline?.reports)) {
    findings.push('budget baseline report links are short, malformed, or duplicated');
  }
  if (!COMMIT_PATTERN.test(budget.baseline?.sourceCommit ?? '')) {
    findings.push('budget baseline source commit is unavailable');
  }
  findings.push(...hostFingerprintFindings(budget.subject?.host, 'budget'));
  if (!nonEmptyString(budget.subject?.host?.runnerImage)) {
    findings.push('budget runner image identity is unavailable');
  }
  findings.push(...workloadIdentityFindings(budget.subject?.workloadIdentity, 'budget'));
  for (const lock of REQUIRED_LOCKS) {
    if (!DIGEST_PATTERN.test(budget.subject?.locks?.[lock] ?? '')) {
      findings.push(`budget ${lock} digest is unavailable`);
    }
  }
  findings.push(
    ...buildWorkloadFindings(budget.subject?.workloadIdentity?.identity).map(
      (finding) => `budget ${finding}`,
    ),
  );
  const corpusSize = budget.subject?.corpusSize;
  if (corpusSize !== budget.subject?.workloadIdentity?.identity?.policies?.corpusSize) {
    findings.push('budget corpus size differs from its workload identity');
  }
  if (!isFinitePercentage(budget.policy?.maxRegressionPct)) {
    findings.push('budget regression percentage is invalid');
  }
  if (!Number.isFinite(budget.policy?.maxLoadPerCpu) || budget.policy.maxLoadPerCpu <= 0) {
    findings.push('budget host load ceiling is invalid');
  }
  if (
    budget.policy?.targets?.wallMedianVsNextMaximumRatio !== 6 ||
    budget.policy?.targets?.peakRssMedianVsNextMaximumRatio !== 2
  ) {
    findings.push('budget targets differ from plans/good-perf.md');
  }
  findings.push(...buildPersistenceEvidenceFindings(budget.persistenceEvidence, budget));
  if (SUPPORTED_CORPUS_SIZES.includes(corpusSize)) {
    for (const mode of BUILD_MODES) {
      for (const suffix of BUILD_METRIC_SUFFIXES) {
        const key = buildMetricKey(corpusSize, mode, suffix);
        const metric = budget.metrics?.[key];
        if (
          metric?.kind !== 'ratified-regression-ceiling' ||
          metric.direction !== 'lower-is-better' ||
          !finiteNonNegative(metric.baseline?.median) ||
          !finiteNonNegative(metric.baseline?.nextMedian) ||
          !finiteNonNegative(metric.baseline?.nextP95) ||
          !Number.isFinite(metric.baseline?.pairedMedian) ||
          !finiteNonNegative(metric.baseline?.p95) ||
          !Number.isSafeInteger(metric.baseline?.runs) ||
          metric.baseline.runs !== BUILD_BASELINE_REPORTS ||
          metric.medianMaximum !==
            regressionCeiling(metric.baseline.median, budget.policy.maxRegressionPct) ||
          metric.p95Maximum !==
            regressionCeiling(metric.baseline.p95, budget.policy.maxRegressionPct)
        ) {
          findings.push(`budget ${key} is not derived from ratified evidence`);
        }
      }
    }
  }
  return [...new Set(findings)].sort((left, right) => left.localeCompare(right));
}

function buildPersistenceEvidenceFindings(evidence, budget) {
  if (!ownRecord(evidence) || evidence.schema !== PERF_BUILD_PERSISTENCE_EVIDENCE_SCHEMA) {
    return [`budget persistence evidence is not ${PERF_BUILD_PERSISTENCE_EVIDENCE_SCHEMA}`];
  }
  const findings = [];
  const corpusSize = budget?.subject?.corpusSize;
  if (evidence.corpusSize !== corpusSize) {
    findings.push('budget persistence evidence has the wrong corpus');
  }
  if (
    canonicalJson(evidence.reports) !==
    canonicalJson(budget?.baseline?.reports?.map(({ contentDigest }) => contentDigest))
  ) {
    findings.push('budget persistence evidence report census differs from the ratified baseline');
  }
  if (
    !Array.isArray(evidence.reports) ||
    evidence.reports.length !== BUILD_BASELINE_REPORTS ||
    new Set(evidence.reports).size !== BUILD_BASELINE_REPORTS
  ) {
    findings.push('budget persistence evidence must reference exactly five distinct reports');
  }
  if (
    evidence.policy?.appSourceTrustEligible !== false ||
    evidence.policy?.diskCacheEligible !== false ||
    evidence.policy?.wallMedianVsNextMaximumRatio !== 6 ||
    evidence.policy?.peakRssMedianVsNextMaximumRatio !== 2 ||
    evidence.policy?.upperWallMinimumRatio !== PERSISTENCE_UPPER_WALL_MINIMUM_RATIO ||
    canonicalJson(evidence.policy?.sessionEligiblePhases) !== canonicalJson(SESSION_ELIGIBLE_PHASES)
  ) {
    findings.push('budget persistence evidence policy differs from the decision contract');
  }
  if (
    canonicalJson(
      Object.keys(evidence.modes ?? {}).sort((left, right) => left.localeCompare(right)),
    ) !== canonicalJson([...WARM_BUILD_MODES].sort((left, right) => left.localeCompare(right)))
  ) {
    findings.push('budget persistence evidence warm-mode census is incomplete');
    return findings;
  }
  const allowedReports = new Set(evidence.reports ?? []);
  for (const mode of WARM_BUILD_MODES) {
    const value = evidence.modes[mode];
    const duration = budget?.metrics?.[buildMetricKey(corpusSize, mode, 'durationMs')]?.baseline;
    const rss = budget?.metrics?.[buildMetricKey(corpusSize, mode, 'peakRssBytes')]?.baseline;
    const artifact = budget?.metrics?.[buildMetricKey(corpusSize, mode, 'artifactBytes')]?.baseline;
    const wallRatio = exactRatio(duration?.median, duration?.nextMedian);
    const rssRatio = exactRatio(rss?.median, rss?.nextMedian);
    const expectedMilestone =
      Number.isFinite(wallRatio) && wallRatio <= 6 && Number.isFinite(rssRatio) && rssRatio <= 2
        ? 'pass'
        : 'fail';
    if (
      value?.wall?.kovoMedianMs !== duration?.median ||
      value?.wall?.kovoP95Ms !== duration?.p95 ||
      value?.wall?.nextMedianMs !== duration?.nextMedian ||
      value?.artifactBytes?.kovoMedian !== artifact?.median ||
      value?.artifactBytes?.kovoP95 !== artifact?.p95 ||
      value?.milestone?.wallMedianVsNextRatio !== wallRatio ||
      value?.milestone?.peakRssMedianVsNextRatio !== rssRatio ||
      value?.milestone?.status !== expectedMilestone
    ) {
      findings.push(`budget persistence ${mode} milestone or summary is not derived`);
    }
    const samples = value?.residualUpper?.samples;
    if (!Array.isArray(samples) || samples.length !== BUILD_SAMPLES_PER_WARM_MODE) {
      findings.push(`budget persistence ${mode} must contain exactly 50 residual samples`);
      continue;
    }
    const identities = new Set();
    const occurrenceCensus = new Map();
    for (const sample of samples) {
      const identity = `${String(sample?.reportContentDigest)}/${String(sample?.occurrence)}/${String(sample?.sample)}`;
      const occurrence = `${String(sample?.reportContentDigest)}/${String(sample?.occurrence)}`;
      if (
        !allowedReports.has(sample?.reportContentDigest) ||
        ![0, 1].includes(sample?.occurrence) ||
        !Number.isSafeInteger(sample?.sample) ||
        sample.sample < 0 ||
        sample.sample > 4 ||
        identities.has(identity)
      ) {
        findings.push(`budget persistence ${mode} residual sample identity is invalid`);
      }
      identities.add(identity);
      occurrenceCensus.set(occurrence, (occurrenceCensus.get(occurrence) ?? 0) + 1);
      if (
        !finiteNonNegative(sample?.eligibleDurationMs) ||
        !finiteNonNegative(sample?.cliStartupTailMs) ||
        !finiteNonNegative(sample?.upperDurationMs) ||
        !Number.isFinite(sample?.wallDurationMs) ||
        sample.wallDurationMs <= 0 ||
        sample.upperDurationMs !== sample.eligibleDurationMs + sample.cliStartupTailMs ||
        sample.upperDurationMs > sample.wallDurationMs + 1e-6 ||
        sample.upperWallRatio !== sample.upperDurationMs / sample.wallDurationMs
      ) {
        findings.push(`budget persistence ${mode} residual sample arithmetic is invalid`);
      }
    }
    if (
      occurrenceCensus.size !== BUILD_BASELINE_REPORTS * 2 ||
      [...occurrenceCensus.values()].some((count) => count !== 5)
    ) {
      findings.push(`budget persistence ${mode} occurrence census is incomplete`);
    }
    if (
      value.residualUpper.medianRatio !==
      median(samples.map(({ upperWallRatio }) => upperWallRatio))
    ) {
      findings.push(`budget persistence ${mode} residual median is not derived`);
    }
  }
  return [...new Set(findings)];
}

function buildWorkloadFindings(identity) {
  const findings = [];
  const policies = identity?.policies;
  const corpusSize = policies?.corpusSize;
  if (canonicalJson(identity?.cells) !== canonicalJson(['build'])) {
    findings.push('workload is not the isolated build cell');
  }
  if (!SUPPORTED_CORPUS_SIZES.includes(corpusSize)) {
    findings.push('workload corpus size is not N=24 or N=216');
  }
  if (canonicalJson(identity?.lanes) !== canonicalJson([`corpus-n${String(corpusSize)}`])) {
    findings.push('workload does not use the isolated generated-corpus lane');
  }
  if (policies?.buildSamples !== 10 || policies?.warmups !== 3) {
    findings.push('workload does not declare 10 build samples and 3 warmups');
  }
  if (canonicalJson(policies?.buildModes) !== canonicalJson(BUILD_MODES)) {
    findings.push('workload does not declare clean, unchanged, and edit build modes');
  }
  const kovoCorpus = identity?.corpus?.kovo;
  const nextCorpus = identity?.corpus?.nextjs;
  if (
    !DIGEST_PATTERN.test(kovoCorpus?.manifestDigest ?? '') ||
    !DIGEST_PATTERN.test(kovoCorpus?.shapeDigest ?? '') ||
    !DIGEST_PATTERN.test(kovoCorpus?.sourceDigest ?? '') ||
    !DIGEST_PATTERN.test(nextCorpus?.manifestDigest ?? '') ||
    !DIGEST_PATTERN.test(nextCorpus?.shapeDigest ?? '') ||
    !DIGEST_PATTERN.test(nextCorpus?.sourceDigest ?? '') ||
    kovoCorpus?.shapeDigest !== nextCorpus?.shapeDigest
  ) {
    findings.push('workload corpus identity is incomplete or unmatched');
  }
  return findings;
}

function buildRawEvidenceFindings(report, corpusSize) {
  if (!SUPPORTED_CORPUS_SIZES.includes(corpusSize)) return ['budget corpus size is unavailable'];
  const findings = [];
  for (const mode of BUILD_MODES) {
    const cells = (report?.rawCells ?? []).filter(
      (cell) =>
        cell?.cell === 'build' &&
        cell?.lane === `corpus-n${String(corpusSize)}` &&
        cell?.mode === mode,
    );
    if (cells.map(({ framework }) => framework).join(',') !== 'kovo,nextjs,nextjs,kovo') {
      findings.push(`candidate build ${mode} raw cells are not serialized K,N,N,K`);
    }
    const totals = { kovo: 0, nextjs: 0 };
    const warmupTotals = { kovo: 0, nextjs: 0 };
    for (const [scheduleIndex, cell] of cells.entries()) {
      const buildReport = cell.report;
      const expected = expectedBuildSchedule()[scheduleIndex];
      if (
        cell.framework !== expected?.framework ||
        cell.occurrence !== expected?.occurrence ||
        buildReport?.integrity?.iterations !== expected?.samples ||
        buildReport?.integrity?.warmups !== expected?.warmups
      ) {
        findings.push(
          `candidate ${String(cell.framework)} build ${mode} occurrence schedule is invalid`,
        );
      }
      if (totals[cell.framework] !== undefined) {
        totals[cell.framework] += buildReport?.samples?.length ?? 0;
        warmupTotals[cell.framework] += buildReport?.integrity?.warmups ?? 0;
      }
      if (
        buildReport?.schema !== BUILD_BENCHMARK_SCHEMA ||
        buildReport?.framework !== cell.framework ||
        buildReport?.mode !== mode ||
        `sha256:${String(buildReport?.corpus?.shapeDigest)}` !==
          report?.workloadIdentity?.identity?.corpus?.[cell.framework]?.shapeDigest ||
        buildReport?.integrity?.complete !== true ||
        buildReport?.integrity?.misses !== 0 ||
        buildReport?.integrity?.iterations !== buildReport?.samples?.length ||
        buildReport?.integrity?.corpus?.stable !== true ||
        buildReport?.integrity?.source?.stable !== true
      ) {
        findings.push(
          `candidate ${cell.framework} build ${mode} occurrence ${String(cell.occurrence)} is incomplete`,
        );
      }
      if (
        buildReport?.source?.commit !== report?.source?.commit ||
        buildReport?.source?.dirty !== false ||
        canonicalJson(buildReport?.source?.locks) !== canonicalJson(report?.source?.locks) ||
        buildReport?.sourceAfter?.commit !== buildReport?.source?.commit ||
        buildReport?.sourceAfter?.dirty !== false ||
        canonicalJson(buildReport?.sourceAfter?.locks) !== canonicalJson(buildReport?.source?.locks)
      ) {
        findings.push(
          `candidate ${cell.framework} build ${mode} occurrence ${String(cell.occurrence)} source identity is incomplete`,
        );
      }
      for (const sample of buildReport?.samples ?? []) {
        if (
          !finiteNonNegative(sample?.durationMs) ||
          !finiteNonNegative(sample?.peakRssBytes) ||
          !finiteNonNegative(sample?.artifactBytes) ||
          sample?.exitCode !== 0 ||
          sample?.outputCensus?.complete !== true ||
          sample?.corpus?.stable !== true
        ) {
          findings.push(`candidate ${cell.framework} build ${mode} sample evidence is incomplete`);
        }
        if (cell.framework === 'kovo') {
          findings.push(...kovoPhaseEvidenceFindings(sample, mode));
        } else if (sample?.phaseCensus !== null || sample?.phaseAttribution !== null) {
          findings.push(`candidate Next build ${mode} invents Kovo phase evidence`);
        }
      }
    }
    for (const framework of ['kovo', 'nextjs']) {
      if (totals[framework] !== 10 || warmupTotals[framework] !== 3) {
        findings.push(
          `candidate ${framework} build ${mode} totals are not 10 samples and 3 warmups`,
        );
      }
    }
  }
  return [...new Set(findings)];
}

function expectedBuildSchedule() {
  return [
    { framework: 'kovo', occurrence: 0, samples: 5, warmups: 2 },
    { framework: 'nextjs', occurrence: 0, samples: 5, warmups: 2 },
    { framework: 'nextjs', occurrence: 1, samples: 5, warmups: 1 },
    { framework: 'kovo', occurrence: 1, samples: 5, warmups: 1 },
  ];
}

function kovoPhaseEvidenceFindings(sample, mode) {
  const findings = [];
  const attribution = sample?.phaseAttribution;
  const source = sample?.phaseCensus?.source;
  const workers = sample?.phaseCensus?.workers;
  const label = `candidate Kovo build ${mode}`;
  if (
    attribution?.schema !== KOVO_BUILD_PHASE_ATTRIBUTION_SCHEMA ||
    attribution.complete !== true ||
    attribution.wallDurationMs !== sample.durationMs ||
    attribution.cliStartupTail?.status !== 'measured-residual' ||
    !finiteNonNegative(attribution.cliStartupTail?.durationMs) ||
    attribution.phaseEnvelope?.status !== 'authenticated-sequential' ||
    !finiteNonNegative(attribution.phaseEnvelope?.durationMs) ||
    attribution.sourceCheck?.status !== 'authenticated-nested' ||
    attribution.sourceCheck?.nestedWithin !== 'analyze'
  ) {
    findings.push(`${label} phase attribution is incomplete`);
  }
  if (
    source?.schema !== 'kovo-build-source-phase-census/v1' ||
    source.complete !== true ||
    !exactPhaseNames(source.phases, KOVO_BUILD_SOURCE_PHASES) ||
    source.phases?.some(
      ({ durationMs, status }) =>
        !finiteNonNegative(durationMs) ||
        !['executed', 'not-applicable', 'reused-authenticated'].includes(status),
    ) ||
    !DIGEST_PATTERN.test(source?.checkGraphDigest ?? '') ||
    !DIGEST_PATTERN.test(source?.sourceSetDigest ?? '') ||
    !DIGEST_PATTERN.test(source?.source?.contentHash ?? '') ||
    !nonEmptyString(source?.source?.path) ||
    source.source.path !== workers?.sourcePath
  ) {
    findings.push(`${label} source-check census is incomplete`);
  }
  if (
    workers?.schema !== 'kovo-build-worker-phase-census/v1' ||
    workers.complete !== true ||
    !exactPhaseNames(workers.phases, KOVO_BUILD_WORKER_PHASES) ||
    !finiteNonNegative(workers.totalWorkerMs) ||
    !nonEmptyString(workers.sourcePath) ||
    workers.phases?.some(({ durationMs, status }) => !finiteNonNegative(durationMs) || status !== 0)
  ) {
    findings.push(`${label} worker census is incomplete`);
  }
  const phaseTotal = workers?.phases?.reduce((sum, { durationMs }) => sum + durationMs, 0);
  if (
    !Number.isFinite(phaseTotal) ||
    phaseTotal !== workers?.totalWorkerMs ||
    workers.totalWorkerMs !== attribution?.phaseEnvelope?.durationMs ||
    Math.abs(workers.totalWorkerMs + attribution?.cliStartupTail?.durationMs - sample.durationMs) >
      1e-6
  ) {
    findings.push(`${label} CLI/startup residual is not derived from the authenticated envelope`);
  }
  return findings;
}

function exactPhaseNames(phases, expected) {
  return (
    Array.isArray(phases) &&
    phases.length === expected.length &&
    phases.every((phase, index) => phase?.name === expected[index])
  );
}

function ratifiedMetricEvidence(value) {
  return (
    finiteNonNegative(value?.mad) &&
    finiteNonNegative(value?.median) &&
    finiteNonNegative(value?.p95) &&
    Number.isSafeInteger(value?.runs) &&
    value.runs === BUILD_BASELINE_REPORTS &&
    finiteNonNegative(value?.sampleP95?.mad) &&
    finiteNonNegative(value?.sampleP95?.median) &&
    finiteNonNegative(value?.sampleP95?.p95) &&
    value.sampleP95?.runs === value.runs
  );
}

function validLinkedReports(reports) {
  if (!Array.isArray(reports) || reports.length !== BUILD_BASELINE_REPORTS) return false;
  const digests = new Set();
  const executions = new Set();
  const locations = new Set();
  const runUrls = new Set();
  for (const report of reports) {
    if (
      !DIGEST_PATTERN.test(report?.contentDigest ?? '') ||
      !DIGEST_PATTERN.test(report?.execution ?? '') ||
      !ARTIFACT_PATTERN.test(report?.location ?? '') ||
      !nonEmptyString(report?.runUrl) ||
      !report.location.startsWith(`${report.runUrl}/artifacts/`) ||
      digests.has(report.contentDigest) ||
      executions.has(report.execution) ||
      locations.has(report.location) ||
      runUrls.has(report.runUrl)
    ) {
      return false;
    }
    digests.add(report.contentDigest);
    executions.add(report.execution);
    locations.add(report.location);
    runUrls.add(report.runUrl);
  }
  return true;
}

function ratioCheck(id, analysis, maximum) {
  const numerator = analysis?.kovo?.median;
  const denominator = analysis?.nextjs?.median;
  const ratio =
    Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
      ? numerator / denominator
      : Number.POSITIVE_INFINITY;
  return upperBoundCheck(id, ratio, maximum, 'milestone');
}

function upperBoundCheck(id, value, maximum, kind) {
  return {
    id,
    kind,
    limit: maximum,
    status: Number.isFinite(value) && value <= maximum ? 'pass' : 'fail',
    value,
  };
}

function buildMetricKey(corpusSize, mode, suffix) {
  return `corpus-n${String(corpusSize)}/build/${mode}/${suffix}`;
}

function regressionCeiling(value, percentage) {
  return value * (1 + percentage / 100);
}

function exactRatio(numerator, denominator) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? numerator / denominator
    : Number.POSITIVE_INFINITY;
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function finitePercentage(value, fallback, label) {
  const selected = value ?? fallback;
  if (!isFinitePercentage(selected)) throw new TypeError(`${label} must be between 0 and 100`);
  return selected;
}

function isFinitePercentage(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function ownRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256Canonical(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function sha256Bytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function main(args) {
  const command = args[0];
  const options = parseOptions(args.slice(1), new Set(['--profile', '--report']));
  if (command === 'derive') {
    assertKnownOptions(options, ['--baseline', '--max-regression-pct', '--out', '--report']);
    const baseline = JSON.parse(
      await readFile(path.resolve(requiredOption(options, '--baseline'))),
    );
    const linkedReports = new Map(
      (baseline?.reports ?? []).map((report) => [report?.contentDigest, report]),
    );
    const baselineEntries = await Promise.all(
      repeatedOption(options, '--report').map(async (reportPath) => {
        const rawText = await readFile(path.resolve(reportPath), 'utf8');
        const contentDigest = sha256Bytes(rawText);
        return {
          contentDigest,
          // The local download path is not the evidence location committed by the ratifier. Bind
          // the reloaded bytes back to that durable artifact URL through their exact content digest;
          // baselineBuildReportFindings then verifies the execution/run URL and re-ratifies all
          // fields before deriving a budget.
          location: linkedReports.get(contentDigest)?.location ?? null,
          rawText,
          report: JSON.parse(rawText),
        };
      }),
    );
    const budget = deriveBuildPerformanceBudget(baseline, {
      baselineEntries,
      maxRegressionPct:
        options['--max-regression-pct'] === undefined
          ? undefined
          : Number(options['--max-regression-pct']),
    });
    await writeFile(
      path.resolve(requiredOption(options, '--out')),
      `${JSON.stringify(budget, null, 2)}\n`,
      { flag: 'w' },
    );
    process.stdout.write(`${budget.schema} derived ${budget.digest}\n`);
    return;
  }
  if (command === 'evaluate') {
    assertKnownOptions(options, ['--budget', '--candidate', '--out']);
    const budget = JSON.parse(await readFile(path.resolve(requiredOption(options, '--budget'))));
    const candidate = JSON.parse(
      await readFile(path.resolve(requiredOption(options, '--candidate'))),
    );
    const evaluation = evaluateBuildPerformanceBudget(budget, candidate);
    await writeFile(
      path.resolve(requiredOption(options, '--out')),
      `${JSON.stringify(evaluation, null, 2)}\n`,
      { flag: 'w' },
    );
    process.stdout.write(`${evaluation.schema} ${evaluation.verdict.status}\n`);
    process.exitCode =
      evaluation.verdict.status === 'pass' ? 0 : evaluation.verdict.status === 'regression' ? 1 : 2;
    return;
  }
  if (command === 'assess-persistence') {
    assertKnownOptions(options, ['--n24-budget', '--n216-budget', '--out', '--profile']);
    if (options['--profile'] !== undefined) {
      throw new TypeError(
        'standalone --profile is unavailable: authenticated profile decisions must use perf-publication-gate.mjs until shared artifact authentication lands',
      );
    }
    const [n24Budget, n216Budget] = await Promise.all(
      ['--n24-budget', '--n216-budget'].map(async (key) =>
        JSON.parse(await readFile(path.resolve(requiredOption(options, key)))),
      ),
    );
    const profileEntries = [];
    const assessment = assessBuildForegroundSession({ n24Budget, n216Budget, profileEntries });
    const assessmentFindings = buildPersistenceAssessmentFindings(assessment, {
      n24Budget,
      n216Budget,
      profileEntries,
    });
    if (assessmentFindings.length > 0) {
      throw new TypeError(
        `Build persistence assessment failed exact-input validation:\n${assessmentFindings.join('\n')}`,
      );
    }
    await writeFile(
      path.resolve(requiredOption(options, '--out')),
      `${JSON.stringify(assessment, null, 2)}\n`,
      { flag: 'w' },
    );
    process.stdout.write(`${assessment.schema} ${assessment.verdict.outcome}\n`);
    process.exitCode = assessment.verdict.status === 'decided' ? 0 : 2;
    return;
  }
  throw new TypeError('expected derive, evaluate, or assess-persistence command');
}

function assertKnownOptions(options, allowed) {
  for (const key of Object.keys(options)) {
    if (!allowed.includes(key)) throw new TypeError(`unknown option ${key}`);
  }
}

function parseOptions(args, repeatable = new Set()) {
  if (args.length % 2 !== 0) throw new TypeError(`incomplete option ${String(args.at(-1))}`);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key.startsWith('--') || value.startsWith('--')) {
      throw new TypeError(`invalid or duplicate option ${String(key)}`);
    }
    if (repeatable.has(key)) {
      options[key] = [...(options[key] ?? []), value];
    } else {
      if (Object.hasOwn(options, key)) throw new TypeError(`invalid or duplicate option ${key}`);
      options[key] = value;
    }
  }
  return options;
}

function repeatedOption(options, key) {
  const values = options[key];
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(`${key} is required at least once`);
  }
  return values;
}

function requiredOption(options, key) {
  const value = options[key];
  if (!nonEmptyString(value)) throw new TypeError(`${key} is required`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
