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
  canonicalJson,
  hostFingerprintFindings,
  performanceReportFindings,
  workloadIdentityFindings,
} from './perf-regression-check.mjs';

export const PERF_BUILD_BUDGET_SCHEMA = 'kovo-build-performance-budget/v1';
export const PERF_BUILD_EVALUATION_SCHEMA = 'kovo-build-performance-evaluation/v1';

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
const BUILD_METRIC_SUFFIXES = Object.freeze(['durationMs', 'peakRssBytes', 'artifactBytes']);

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

  const uniqueReasons = [...new Set(reasons)].sort();
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

export function buildBudgetBaselineFindings(baseline, baselineEntries) {
  if (!ownRecord(baseline) || baseline.schema !== PERF_BASELINE_SCHEMA) {
    return [`baseline is not ${PERF_BASELINE_SCHEMA}`];
  }
  const findings = [];
  if (baseline.verdict?.status !== 'ratified') findings.push('baseline verdict is not ratified');
  if (!Number.isSafeInteger(baseline.policy?.minRuns) || baseline.policy.minRuns < 5) {
    findings.push('baseline did not require at least five runs');
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
  return [...new Set(findings)].sort();
}

function baselineBuildReportFindings(baseline, entries, corpusSize) {
  if (!Array.isArray(entries) || entries.length !== baseline.reports?.length) {
    return ['baseline raw build reports are unavailable'];
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
          metric.baseline.runs < 5 ||
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
  return [...new Set(findings)].sort();
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
    value.runs >= 5 &&
    finiteNonNegative(value?.sampleP95?.mad) &&
    finiteNonNegative(value?.sampleP95?.median) &&
    finiteNonNegative(value?.sampleP95?.p95) &&
    value.sampleP95?.runs === value.runs
  );
}

function validLinkedReports(reports) {
  if (!Array.isArray(reports) || reports.length < 5) return false;
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
  const options = parseOptions(args.slice(1), new Set(['--report']));
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
  throw new TypeError('expected derive or evaluate command');
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
