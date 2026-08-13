#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { executionIdentityFindings } from './lib/perf-execution.mjs';
import {
  canonicalJson,
  hostFingerprintFindings,
  performanceReportFindings,
  workloadIdentityFindings,
} from './perf-regression-check.mjs';

export const PERF_DEV_BUDGET_SCHEMA = 'kovo-dev-performance-budget/v1';
export const PERF_DEV_EVALUATION_SCHEMA = 'kovo-dev-performance-evaluation/v1';

const PERF_BASELINE_SCHEMA = 'kovo-performance-baseline/v1';
const COMPARISON_SCHEMA = 'kovo-next-performance-comparison/v1';
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40,64}$/u;
const DEV_EDIT_CLASSES = Object.freeze(['leaf', 'entry', 'data', 'syntaxError', 'recovery']);
const REQUIRED_LOCKS = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);
const SUPPORTED_CORPUS_SIZES = Object.freeze([24, 216]);
const PERFORMANCE_METRICS = Object.freeze([
  'edit.leafMs',
  'edit.entryMs',
  'edit.syntaxErrorMs',
  'edit.recoveryMs',
  'edit.peakRssBytes',
  'ready.durationMs',
  'ready.peakRssBytes',
]);
const AVAILABILITY_METRICS = Object.freeze([
  ...DEV_EDIT_CLASSES.map((editClass) => `edit.${editClass}StateSurvived`),
  'edit.sampleAvailable',
  'edit.syntaxErrorDiagnosticAvailable',
  'ready.successAvailable',
]);

/**
 * Derive a reviewable dev budget from a five-run ratified baseline. No timing or RSS value is
 * authored here: every ceiling comes from the baseline's median-of-run statistic plus the plan's
 * declared 5% regression envelope. SPEC §1.1's honesty boundary therefore remains explicit.
 */
export function deriveDevPerformanceBudget(baseline, options = {}) {
  const maxRegressionPct = finitePercentage(options.maxRegressionPct, 5, 'maxRegressionPct');
  const findings = devBudgetBaselineFindings(baseline);
  if (findings.length > 0) {
    throw new TypeError(`Dev performance baseline is unproven:\n${findings.join('\n')}`);
  }
  const corpusSize = baseline.subject.workloadIdentity.identity.policies.corpusSize;
  const metrics = {};
  for (const suffix of PERFORMANCE_METRICS) {
    const key = devMetricKey(corpusSize, suffix);
    const evidence = baseline.metrics[key].kovo;
    metrics[key] = {
      baseline: {
        median: evidence.median,
        p95: evidence.sampleP95.median,
        runs: evidence.runs,
      },
      direction: 'lower-is-better',
      kind: 'ratified-regression-ceiling',
      medianMaximum: regressionCeiling(evidence.median, maxRegressionPct),
      p95Maximum: regressionCeiling(evidence.sampleP95.median, maxRegressionPct),
    };
  }
  for (const suffix of AVAILABILITY_METRICS) {
    const key = devMetricKey(corpusSize, suffix);
    metrics[key] = {
      direction: 'higher-is-better',
      kind: 'exact-availability-floor',
      minimum: 1,
    };
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
      availabilityMinimum: 1,
      maxLoadPerCpu: baseline.policy.maxLoadPerCpu,
      maxRegressionPct,
      targets: {
        entryMedianVsNextMaximumRatio: 3,
        leafMedianVsNextMaximumRatio: 2,
        readyMedianVsNextMaximumRatio: 2,
        recoveryP95MaximumMs: 2_000,
        syntaxErrorP95MaximumMs: 1_000,
      },
    },
    schema: PERF_DEV_BUDGET_SCHEMA,
    subject: {
      corpusSize,
      host: baseline.subject.host,
      locks: baseline.subject.locks,
      workloadIdentity: baseline.subject.workloadIdentity,
    },
  };
  return { ...facts, digest: sha256Canonical(facts) };
}

/** Evaluate a new clean commit against an exact ratified host/lock/workload budget subject. */
export function evaluateDevPerformanceBudget(budget, candidate) {
  const reasons = [
    ...devBudgetFindings(budget),
    ...performanceReportFindings(candidate, 'candidate', {
      maxLoadPerCpu: budget?.policy?.maxLoadPerCpu ?? 1,
      minSamples: 5,
    }),
    ...executionIdentityFindings(candidate?.execution, { requireProvider: 'github-actions' }).map(
      (finding) => `candidate ${finding}`,
    ),
  ];
  if (candidate?.schema !== COMPARISON_SCHEMA) {
    reasons.push(`candidate is not ${COMPARISON_SCHEMA}`);
  }
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
    budget?.baseline?.reports?.some((report) => report.execution === candidate?.execution?.digest)
  ) {
    reasons.push('candidate reuses a baseline execution identity');
  }
  for (const metric of Object.keys(budget?.metrics ?? {})) {
    if (!ownRecord(candidate?.analysis?.[metric])) {
      reasons.push(`candidate required dev metric ${metric} is unavailable`);
    }
  }
  reasons.push(...devRawEvidenceFindings(candidate, budget?.subject?.corpusSize));

  const checks = [];
  if (reasons.length === 0) {
    for (const [metric, entry] of Object.entries(budget.metrics)) {
      const observed = candidate.analysis[metric]?.kovo;
      if (entry.kind === 'ratified-regression-ceiling') {
        checks.push(
          upperBoundCheck(`${metric}.median`, observed.median, entry.medianMaximum, 'regression'),
          upperBoundCheck(`${metric}.p95`, observed.p95, entry.p95Maximum, 'regression'),
        );
      } else {
        checks.push(
          lowerBoundCheck(`${metric}.median`, observed.median, entry.minimum, 'availability'),
          lowerBoundCheck(`${metric}.p95`, observed.p95, entry.minimum, 'availability'),
        );
      }
    }
    const prefix = `corpus-n${String(budget.subject.corpusSize)}/dev//`;
    checks.push(
      ratioCheck(
        `${prefix}ready.durationMs.median-vs-next`,
        candidate.analysis[`${prefix}ready.durationMs`],
        budget.policy.targets.readyMedianVsNextMaximumRatio,
      ),
      ratioCheck(
        `${prefix}edit.leafMs.median-vs-next`,
        candidate.analysis[`${prefix}edit.leafMs`],
        budget.policy.targets.leafMedianVsNextMaximumRatio,
      ),
      ratioCheck(
        `${prefix}edit.entryMs.median-vs-next`,
        candidate.analysis[`${prefix}edit.entryMs`],
        budget.policy.targets.entryMedianVsNextMaximumRatio,
      ),
      upperBoundCheck(
        `${prefix}edit.syntaxErrorMs.p95-target`,
        candidate.analysis[`${prefix}edit.syntaxErrorMs`].kovo.p95,
        budget.policy.targets.syntaxErrorP95MaximumMs,
        'target',
      ),
      upperBoundCheck(
        `${prefix}edit.recoveryMs.p95-target`,
        candidate.analysis[`${prefix}edit.recoveryMs`].kovo.p95,
        budget.policy.targets.recoveryP95MaximumMs,
        'target',
      ),
    );
  }

  const uniqueReasons = [...new Set(reasons)].sort();
  const failures = checks.filter((check) => check.status === 'fail').map((check) => check.id);
  return {
    budget: budget?.digest ?? null,
    candidate: {
      execution: candidate?.execution?.digest ?? null,
      sourceCommit: candidate?.source?.commit ?? null,
    },
    checks,
    schema: PERF_DEV_EVALUATION_SCHEMA,
    verdict: {
      failures,
      reasons: uniqueReasons,
      status: uniqueReasons.length > 0 ? 'unproven' : failures.length > 0 ? 'regression' : 'pass',
    },
  };
}

export function devBudgetBaselineFindings(baseline) {
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
  if (
    !Array.isArray(baseline.reports) ||
    baseline.reports.length < 5 ||
    !uniqueReportEvidence(baseline.reports)
  ) {
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
  if (
    typeof baseline.subject?.host?.runnerImage !== 'string' ||
    baseline.subject.host.runnerImage.length === 0
  ) {
    findings.push('baseline runner image identity is unavailable');
  }
  findings.push(...workloadIdentityFindings(baseline.subject?.workloadIdentity, 'baseline'));
  for (const lock of REQUIRED_LOCKS) {
    if (!DIGEST_PATTERN.test(baseline.subject?.locks?.[lock] ?? '')) {
      findings.push(`baseline ${lock} digest is unavailable`);
    }
  }
  const workloadFindings = devWorkloadFindings(baseline.subject?.workloadIdentity?.identity);
  findings.push(...workloadFindings.map((finding) => `baseline ${finding}`));
  const corpusSize = baseline.subject?.workloadIdentity?.identity?.policies?.corpusSize;
  if (SUPPORTED_CORPUS_SIZES.includes(corpusSize)) {
    for (const suffix of [...PERFORMANCE_METRICS, ...AVAILABILITY_METRICS]) {
      const key = devMetricKey(corpusSize, suffix);
      const metric = baseline.metrics?.[key];
      for (const subject of ['kovo', 'nextjs']) {
        if (!ratifiedMetricEvidence(metric?.[subject])) {
          findings.push(`baseline ${key} ${subject} evidence is unavailable`);
        }
      }
      if (
        AVAILABILITY_METRICS.includes(suffix) &&
        (metric?.kovo?.median !== 1 ||
          metric?.kovo?.p95 !== 1 ||
          metric?.kovo?.sampleP95?.median !== 1)
      ) {
        findings.push(`baseline ${key} does not prove exact Kovo availability`);
      }
    }
  }
  return [...new Set(findings)].sort();
}

export function devBudgetFindings(budget) {
  if (!ownRecord(budget) || budget.schema !== PERF_DEV_BUDGET_SCHEMA) {
    return [`budget is not ${PERF_DEV_BUDGET_SCHEMA}`];
  }
  const findings = [];
  const { digest, ...facts } = budget;
  if (!DIGEST_PATTERN.test(digest ?? '') || digest !== sha256Canonical(facts)) {
    findings.push('budget digest is not derived from its facts');
  }
  if (!DIGEST_PATTERN.test(budget.baseline?.digest ?? '')) {
    findings.push('budget baseline digest is unavailable');
  }
  if (
    !Array.isArray(budget.baseline?.reports) ||
    budget.baseline.reports.length < 5 ||
    !uniqueReportEvidence(budget.baseline.reports)
  ) {
    findings.push('budget baseline report links are short, malformed, or duplicated');
  }
  if (!COMMIT_PATTERN.test(budget.baseline?.sourceCommit ?? '')) {
    findings.push('budget baseline source commit is unavailable');
  }
  findings.push(...hostFingerprintFindings(budget.subject?.host, 'budget'));
  if (
    typeof budget.subject?.host?.runnerImage !== 'string' ||
    budget.subject.host.runnerImage.length === 0
  ) {
    findings.push('budget runner image identity is unavailable');
  }
  findings.push(...workloadIdentityFindings(budget.subject?.workloadIdentity, 'budget'));
  for (const lock of REQUIRED_LOCKS) {
    if (!DIGEST_PATTERN.test(budget.subject?.locks?.[lock] ?? '')) {
      findings.push(`budget ${lock} digest is unavailable`);
    }
  }
  findings.push(
    ...devWorkloadFindings(budget.subject?.workloadIdentity?.identity).map(
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
  const targets = budget.policy?.targets;
  if (
    targets?.readyMedianVsNextMaximumRatio !== 2 ||
    targets?.leafMedianVsNextMaximumRatio !== 2 ||
    targets?.entryMedianVsNextMaximumRatio !== 3 ||
    targets?.syntaxErrorP95MaximumMs !== 1_000 ||
    targets?.recoveryP95MaximumMs !== 2_000
  ) {
    findings.push('budget targets differ from plans/good-perf.md');
  }
  if (SUPPORTED_CORPUS_SIZES.includes(corpusSize)) {
    for (const suffix of PERFORMANCE_METRICS) {
      const key = devMetricKey(corpusSize, suffix);
      const metric = budget.metrics?.[key];
      if (
        metric?.kind !== 'ratified-regression-ceiling' ||
        metric.direction !== 'lower-is-better' ||
        !finiteNonNegative(metric.baseline?.median) ||
        !finiteNonNegative(metric.baseline?.p95) ||
        !Number.isSafeInteger(metric.baseline?.runs) ||
        metric.baseline.runs < 5 ||
        metric.medianMaximum !==
          regressionCeiling(metric.baseline.median, budget.policy.maxRegressionPct) ||
        metric.p95Maximum !== regressionCeiling(metric.baseline.p95, budget.policy.maxRegressionPct)
      ) {
        findings.push(`budget ${key} is not derived from ratified evidence`);
      }
    }
    for (const suffix of AVAILABILITY_METRICS) {
      const key = devMetricKey(corpusSize, suffix);
      const metric = budget.metrics?.[key];
      if (
        metric?.kind !== 'exact-availability-floor' ||
        metric.direction !== 'higher-is-better' ||
        metric.minimum !== 1
      ) {
        findings.push(`budget ${key} availability floor is invalid`);
      }
    }
  }
  return [...new Set(findings)].sort();
}

function devWorkloadFindings(identity) {
  const findings = [];
  const policies = identity?.policies;
  const corpusSize = policies?.corpusSize;
  if (!Array.isArray(identity?.cells) || !identity.cells.includes('dev')) {
    findings.push('workload does not include the dev cell');
  }
  if (!SUPPORTED_CORPUS_SIZES.includes(corpusSize)) {
    findings.push('workload corpus size is not N=24 or N=216');
  }
  if (
    policies?.devEditSamples !== 30 ||
    policies?.devReadySamples !== 15 ||
    policies?.devWarmups !== 3 ||
    policies?.devEditSessionSamples !== 2
  ) {
    findings.push('workload does not declare 30 edits, 15 ready starts, 3 warmups, and 2 sessions');
  }
  if (canonicalJson(policies?.devOccurrenceSchedule) !== canonicalJson(expectedDevSchedule())) {
    findings.push('workload dev occurrence schedule is not the exact K,N,N,K split');
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

function devRawEvidenceFindings(report, corpusSize) {
  const findings = [];
  if (!SUPPORTED_CORPUS_SIZES.includes(corpusSize)) return ['budget corpus size is unavailable'];
  const cells = (report?.rawCells ?? []).filter(
    (cell) => cell?.cell === 'dev' && cell?.lane === `corpus-n${String(corpusSize)}`,
  );
  if (cells.map((cell) => cell.framework).join(',') !== 'kovo,nextjs,nextjs,kovo') {
    findings.push('candidate dev raw cells are not serialized K,N,N,K');
  }
  const totals = {
    kovo: { edits: 0, ready: 0, warmups: 0 },
    nextjs: { edits: 0, ready: 0, warmups: 0 },
  };
  for (const cell of cells) {
    const devReport = cell.report;
    const expectedSchedule = expectedDevSchedule().find(
      (entry) => entry.framework === cell.framework && entry.occurrence === cell.occurrence,
    );
    if (canonicalJson(cell.schedule) !== canonicalJson(expectedSchedule)) {
      findings.push(
        `candidate ${String(cell.framework)} dev occurrence ${String(cell.occurrence)} schedule is invalid`,
      );
    }
    const frameworkTotals = totals[cell.framework];
    if (frameworkTotals === undefined) continue;
    frameworkTotals.edits += devReport?.samples?.length ?? 0;
    frameworkTotals.ready += devReport?.readySamples?.length ?? 0;
    frameworkTotals.warmups += devReport?.integrity?.warmups ?? 0;
    if (
      devReport?.framework !== cell.framework ||
      `sha256:${String(devReport?.corpus?.shapeDigest)}` !==
        report?.workloadIdentity?.identity?.corpus?.[cell.framework]?.shapeDigest ||
      devReport?.integrity?.complete !== true ||
      devReport?.integrity?.misses !== 0 ||
      devReport?.integrity?.iterations !== expectedSchedule?.editSamples ||
      devReport?.integrity?.readyIterations !== expectedSchedule?.readySamples ||
      devReport?.integrity?.browser?.unexpectedErrorCount !== 0 ||
      devReport?.integrity?.browser?.requestFailedCount !== 0 ||
      !(devReport?.integrity?.browser?.responseCount > 0) ||
      devReport?.verdict?.status !== 'measured'
    ) {
      findings.push(
        `candidate ${cell.framework} dev occurrence ${String(cell.occurrence)} is incomplete`,
      );
    }
    if (
      devReport?.source?.commit !== report?.source?.commit ||
      devReport?.source?.dirty !== false ||
      canonicalJson(devReport?.source?.locks) !== canonicalJson(report?.source?.locks) ||
      devReport?.sourceAfter?.commit !== devReport?.source?.commit ||
      devReport?.sourceAfter?.dirty !== false ||
      canonicalJson(devReport?.sourceAfter?.locks) !== canonicalJson(devReport?.source?.locks) ||
      devReport?.integrity?.source?.stable !== true
    ) {
      findings.push(
        `candidate ${cell.framework} dev occurrence ${String(cell.occurrence)} source identity is incomplete`,
      );
    }
    for (const editClass of DEV_EDIT_CLASSES) {
      if (devReport?.integrity?.editCounts?.[editClass] !== expectedSchedule?.editSamples) {
        findings.push(
          `candidate ${cell.framework} dev occurrence ${String(cell.occurrence)} ${editClass} count is incomplete`,
        );
      }
    }
    if (
      !Number.isFinite(devReport?.editSession?.peakRssBytes) ||
      devReport.editSession.peakRssBytes <= 0 ||
      !Number.isSafeInteger(devReport?.editSession?.rssSamples) ||
      devReport.editSession.rssSamples < 1
    ) {
      findings.push(
        `candidate ${cell.framework} dev occurrence ${String(cell.occurrence)} lacks edit RSS`,
      );
    }
    for (const sample of devReport?.samples ?? []) {
      for (const editClass of DEV_EDIT_CLASSES) {
        if (!Number.isFinite(sample?.[`${editClass}Ms`])) {
          findings.push(`candidate ${cell.framework} ${editClass} timing is incomplete`);
        }
        if (sample?.[`${editClass}StateSurvived`] !== true) {
          findings.push(`candidate ${cell.framework} ${editClass} state survival is incomplete`);
        }
      }
      if (
        typeof sample?.syntaxErrorDiagnosticSignal !== 'string' ||
        sample.syntaxErrorDiagnosticSignal.length === 0
      ) {
        findings.push(
          `candidate ${cell.framework} syntax-error diagnostic availability is incomplete`,
        );
      }
    }
    for (const sample of devReport?.readySamples ?? []) {
      if (
        sample?.success !== true ||
        !Number.isFinite(sample.peakRssBytes) ||
        sample.peakRssBytes <= 0 ||
        !Number.isSafeInteger(sample.rssSamples) ||
        sample.rssSamples < 1
      ) {
        findings.push(`candidate ${cell.framework} ready availability/RSS evidence is incomplete`);
      }
    }
  }
  for (const framework of ['kovo', 'nextjs']) {
    const observed = totals[framework];
    if (observed.edits !== 30 || observed.ready !== 15 || observed.warmups !== 3) {
      findings.push(
        `candidate ${framework} dev totals are not 30 edits, 15 ready starts, and 3 warmups`,
      );
    }
  }
  return [...new Set(findings)];
}

function expectedDevSchedule() {
  return [
    {
      editSamples: 15,
      framework: 'kovo',
      occurrence: 0,
      readySamples: 8,
      scheduleIndex: 0,
      warmups: 2,
    },
    {
      editSamples: 15,
      framework: 'nextjs',
      occurrence: 0,
      readySamples: 8,
      scheduleIndex: 1,
      warmups: 2,
    },
    {
      editSamples: 15,
      framework: 'nextjs',
      occurrence: 1,
      readySamples: 7,
      scheduleIndex: 2,
      warmups: 1,
    },
    {
      editSamples: 15,
      framework: 'kovo',
      occurrence: 1,
      readySamples: 7,
      scheduleIndex: 3,
      warmups: 1,
    },
  ];
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

function uniqueReportEvidence(reports) {
  const digests = new Set();
  const executions = new Set();
  const locations = new Set();
  for (const report of reports) {
    if (
      !DIGEST_PATTERN.test(report?.contentDigest ?? '') ||
      !DIGEST_PATTERN.test(report?.execution ?? '') ||
      typeof report?.location !== 'string' ||
      report.location.length === 0 ||
      typeof report?.runUrl !== 'string' ||
      report.runUrl.length === 0 ||
      digests.has(report.contentDigest) ||
      executions.has(report.execution) ||
      locations.has(report.location)
    ) {
      return false;
    }
    digests.add(report.contentDigest);
    executions.add(report.execution);
    locations.add(report.location);
  }
  return true;
}

function ratioCheck(id, analysis, maximum) {
  const denominator = analysis?.nextjs?.median;
  const numerator = analysis?.kovo?.median;
  const ratio =
    Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
      ? numerator / denominator
      : Number.POSITIVE_INFINITY;
  return upperBoundCheck(id, ratio, maximum, 'competitive-target');
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

function lowerBoundCheck(id, value, minimum, kind) {
  return {
    id,
    kind,
    limit: minimum,
    status: Number.isFinite(value) && value >= minimum ? 'pass' : 'fail',
    value,
  };
}

function devMetricKey(corpusSize, suffix) {
  return `corpus-n${String(corpusSize)}/dev//${suffix}`;
}

function regressionCeiling(value, percentage) {
  return value * (1 + percentage / 100);
}

function finitePercentage(value, fallback, label) {
  const selected = value ?? fallback;
  const valid = Number.isFinite(selected) && selected >= 0 && selected <= 100;
  if (!valid) throw new TypeError(`${label} must be between 0 and 100`);
  return selected;
}

function isFinitePercentage(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function ownRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256Canonical(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

async function main(args) {
  const command = args[0];
  const options = parseOptions(args.slice(1));
  if (command === 'derive') {
    assertKnownOptions(options, ['--baseline', '--max-regression-pct', '--out']);
    const baseline = JSON.parse(
      await readFile(path.resolve(requiredOption(options, '--baseline'))),
    );
    const budget = deriveDevPerformanceBudget(baseline, {
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
    const evaluation = evaluateDevPerformanceBudget(budget, candidate);
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

function parseOptions(args) {
  if (args.length % 2 !== 0) throw new TypeError(`incomplete option ${String(args.at(-1))}`);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key.startsWith('--') || value.startsWith('--') || Object.hasOwn(options, key)) {
      throw new TypeError(`invalid or duplicate option ${String(key)}`);
    }
    options[key] = value;
  }
  return options;
}

function requiredOption(options, key) {
  const value = options[key];
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${key} is required`);
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
