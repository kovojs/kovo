#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { executionIdentityFindings } from './lib/perf-execution.mjs';
import { ratifyPerformanceBaseline } from './perf-baseline-ratify.mjs';
import {
  canonicalJson,
  hostFingerprintFindings,
  performanceMetricDirection,
  performanceReportFindings,
  workloadIdentityFindings,
} from './perf-regression-check.mjs';

export const PERF_COMPARISON_BUDGET_SCHEMA = 'kovo-comparison-performance-budget/v1';
export const PERF_COMPARISON_EVALUATION_SCHEMA = 'kovo-comparison-performance-evaluation/v1';

const BASELINE_SCHEMA = 'kovo-performance-baseline/v1';
const COMPARISON_SCHEMA = 'kovo-next-performance-comparison/v1';
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40,64}$/u;
const ARTIFACT_PATTERN =
  /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9][0-9]*\/artifacts\/[1-9][0-9]*$/u;
const REQUIRED_LOCKS = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);
const SUPPORTED_SUBJECTS = Object.freeze(['browser', 'server']);
const BROWSER_LANES = Object.freeze(['default', 'matched-l0', 'matched-l1']);
const SERVER_LANES = Object.freeze(['matched-runtime']);
const SERVER_CONCURRENCIES = Object.freeze([1, 8, 32]);
const SERVER_ENCODINGS = Object.freeze(['identity', 'br']);
const SERVER_MODES = Object.freeze(['HIT', '304', 'dynamic']);
const SERVER_ROUTES = Object.freeze(['listing', 'detail']);
const BROWSER_FORM_FACTORS = Object.freeze(['desktop', 'mobile']);
const BROWSER_ROUTES = Object.freeze(['listing', 'detail']);
const BROWSER_NAVIGATION_ATTRIBUTION_PHASES = Object.freeze([
  'server',
  'transfer',
  'responseProcessingDomApply',
  'style',
  'layout',
  'paint',
]);
const BROWSER_SESSION_BYTE_PHASES = Object.freeze([
  'initial',
  'automaticPrefetch',
  'preClickBackground',
  'click',
  'postClick',
  'throughClick',
  'throughDestinationPaint',
  'settledSession',
]);
const BROWSER_TARGETS = Object.freeze({
  matchedL1MobileNavigationMaximumRatio: 2,
  matchedL1TotalSessionBytesMaximumRatio: 0.5,
});
const SERVER_TARGETS = Object.freeze({
  cachedThroughputMinimumRatio: 0.9,
  forcedDynamicThroughputMinimumRatio: 0.8,
});
const SERVER_REPRESENTATION_POLICY = Object.freeze({
  cachedComparisonEncoding: 'identity',
  forcedDynamicComparisonEncoding: 'identity',
  kovoBrotliPosture: 'required-raw-measurement-not-a-paired-next-target',
  nextBrotliPosture: 'unsupported',
});

/** Fixed competitive checks; callers may not discover a smaller claim from present metrics. */
export function comparisonTargetCheckSpecifications(subject) {
  return targetCheckSpecifications(
    subject,
    subject === 'browser' ? BROWSER_TARGETS : subject === 'server' ? SERVER_TARGETS : null,
  );
}

/** Derive browser/server regression budgets and a reviewable Kovo-vs-Next summary. */
export function deriveComparisonPerformanceBudget(baseline, options = {}) {
  const maxRegressionPct = finitePercentage(options.maxRegressionPct, 5, 'maxRegressionPct');
  const findings = comparisonBudgetBaselineFindings(baseline, options.baselineEntries);
  if (findings.length > 0) {
    throw new TypeError(`Comparison performance baseline is unproven:\n${findings.join('\n')}`);
  }
  const subject = baseline.subject.workloadIdentity.identity.cells[0];
  const metrics = {};
  for (const [key, evidence] of Object.entries(baseline.metrics)) {
    const direction = performanceMetricDirection(key);
    const informational = key.endsWith('/bfcache.applicable');
    if (direction === null && !informational) continue;
    const exactAvailability = /(?:Available|StateSurvived|evidenceComplete)$/u.test(key);
    const common = {
      baseline: {
        kovoMedian: evidence.kovo.median,
        kovoP95: evidence.kovo.sampleP95.median,
        nextMedian: evidence.nextjs.median,
        nextP95: evidence.nextjs.sampleP95.median,
        pairedMedian: evidence.pairedDifference.median,
        runs: evidence.kovo.runs,
      },
      direction,
    };
    if (informational) {
      metrics[key] = { ...common, kind: 'informational' };
    } else if (exactAvailability) {
      metrics[key] = { ...common, kind: 'exact-availability-floor', minimum: 1 };
    } else if (direction === 'lower-is-better') {
      metrics[key] = {
        ...common,
        kind: 'ratified-regression-ceiling',
        medianMaximum: regressUpper(evidence.kovo.median, maxRegressionPct),
        p95Maximum: regressUpper(evidence.kovo.sampleP95.median, maxRegressionPct),
      };
    } else {
      metrics[key] = {
        ...common,
        kind: 'ratified-regression-floor',
        medianMinimum: regressLower(evidence.kovo.median, maxRegressionPct),
        p95Minimum: regressLower(evidence.kovo.sampleP95.median, maxRegressionPct),
      };
    }
  }
  if (Object.keys(metrics).length === 0) {
    throw new TypeError('Comparison performance baseline has no directional metrics');
  }

  const policy = {
    maxLoadPerCpu: baseline.policy.maxLoadPerCpu,
    maxRegressionPct,
    ...(subject === 'server' ? { representations: { ...SERVER_REPRESENTATION_POLICY } } : {}),
    targets: {
      ...(subject === 'browser' ? BROWSER_TARGETS : SERVER_TARGETS),
    },
  };
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
    policy,
    schema: PERF_COMPARISON_BUDGET_SCHEMA,
    subject: {
      host: baseline.subject.host,
      kind: subject,
      locks: baseline.subject.locks,
      workloadIdentity: baseline.subject.workloadIdentity,
    },
    targetAssessment: baselineTargetAssessment(subject, metrics, policy.targets),
  };
  return { ...facts, digest: sha256Canonical(facts) };
}

export function evaluateComparisonPerformanceBudget(budget, candidate) {
  const reasons = [
    ...comparisonBudgetFindings(budget),
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
  if (budget?.subject?.kind === 'browser') {
    reasons.push(...browserPublicationMetricFindings(candidate?.analysis, 'candidate'));
  } else if (budget?.subject?.kind === 'server') {
    reasons.push(...serverPublicationMetricFindings(candidate?.analysis, 'candidate'));
    reasons.push(...serverBrotliRawEvidenceFindings(candidate, 'candidate'));
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
    budget?.baseline?.reports?.some(({ execution }) => execution === candidate?.execution?.digest)
  ) {
    reasons.push('candidate reuses a baseline execution identity');
  }
  for (const metric of Object.keys(budget?.metrics ?? {})) {
    if (!ownRecord(candidate?.analysis?.[metric])) {
      reasons.push(
        `candidate required ${String(budget?.subject?.kind)} metric ${metric} is unavailable`,
      );
    }
  }

  const checks = [];
  if (reasons.length === 0) {
    for (const [metric, entry] of Object.entries(budget.metrics)) {
      if (entry.kind === 'informational') continue;
      const observed = candidate.analysis[metric].kovo;
      if (entry.kind === 'ratified-regression-ceiling') {
        checks.push(
          upperCheck(`${metric}.median`, observed.median, entry.medianMaximum, 'regression'),
          upperCheck(`${metric}.p95`, observed.p95, entry.p95Maximum, 'regression'),
        );
      } else if (entry.kind === 'ratified-regression-floor') {
        checks.push(
          lowerCheck(`${metric}.median`, observed.median, entry.medianMinimum, 'regression'),
          lowerCheck(`${metric}.p95`, observed.p95, entry.p95Minimum, 'regression'),
        );
      } else {
        checks.push(
          lowerCheck(`${metric}.median`, observed.median, entry.minimum, 'availability'),
          lowerCheck(`${metric}.p95`, observed.p95, entry.minimum, 'availability'),
        );
      }
    }
    checks.push(...targetChecks(budget, candidate));
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
    schema: PERF_COMPARISON_EVALUATION_SCHEMA,
    verdict: {
      failures,
      reasons: uniqueReasons,
      status: uniqueReasons.length > 0 ? 'unproven' : failures.length > 0 ? 'regression' : 'pass',
    },
  };
}

export function comparisonBudgetBaselineFindings(baseline, entries) {
  if (!ownRecord(baseline) || baseline.schema !== BASELINE_SCHEMA) {
    return [`baseline is not ${BASELINE_SCHEMA}`];
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
  findings.push(
    ...publicationComparisonWorkloadFindings(
      baseline.subject?.workloadIdentity?.identity,
      'baseline',
    ),
  );
  for (const lock of REQUIRED_LOCKS) {
    if (!DIGEST_PATTERN.test(baseline.subject?.locks?.[lock] ?? '')) {
      findings.push(`baseline ${lock} digest is unavailable`);
    }
  }
  const cells = baseline.subject?.workloadIdentity?.identity?.cells;
  if (!Array.isArray(cells) || cells.length !== 1 || !SUPPORTED_SUBJECTS.includes(cells[0])) {
    findings.push('baseline is not an isolated browser or server subject');
  }
  if (Object.keys(baseline.metrics ?? {}).length === 0) findings.push('baseline metrics are empty');
  if (cells?.[0] === 'browser') {
    findings.push(...browserPublicationMetricFindings(baseline.metrics, 'baseline'));
  } else if (cells?.[0] === 'server') {
    findings.push(...serverPublicationMetricFindings(baseline.metrics, 'baseline'));
  }
  for (const [metric, evidence] of Object.entries(baseline.metrics ?? {})) {
    for (const subject of ['kovo', 'nextjs']) {
      if (!ratifiedEvidence(evidence?.[subject], true)) {
        findings.push(`baseline ${metric} ${subject} evidence is unavailable`);
      }
    }
    if (!ratifiedEvidence(evidence?.pairedDifference, false)) {
      findings.push(`baseline ${metric} paired evidence is unavailable`);
    }
    if (
      /(?:Available|StateSurvived|evidenceComplete)$/u.test(metric) &&
      (evidence?.kovo?.median !== 1 || evidence?.kovo?.sampleP95?.median !== 1)
    ) {
      findings.push(`baseline ${metric} does not prove exact Kovo availability`);
    }
  }
  findings.push(...linkedRawReportFindings(baseline, entries));
  return [...new Set(findings)].sort((left, right) => left.localeCompare(right));
}

export function comparisonBudgetFindings(budget) {
  if (!ownRecord(budget) || budget.schema !== PERF_COMPARISON_BUDGET_SCHEMA) {
    return [`budget is not ${PERF_COMPARISON_BUDGET_SCHEMA}`];
  }
  const findings = [];
  const { digest, ...facts } = budget;
  if (digest !== sha256Canonical(facts))
    findings.push('budget digest is not derived from its facts');
  if (!DIGEST_PATTERN.test(budget.baseline?.digest ?? '')) {
    findings.push('budget baseline digest is unavailable');
  }
  if (!validLinkedReports(budget.baseline?.reports)) {
    findings.push('budget baseline report links are short, malformed, or duplicated');
  }
  if (!COMMIT_PATTERN.test(budget.baseline?.sourceCommit ?? '')) {
    findings.push('budget baseline source commit is unavailable');
  }
  if (!SUPPORTED_SUBJECTS.includes(budget.subject?.kind)) {
    findings.push('budget subject kind is unavailable');
  }
  findings.push(...hostFingerprintFindings(budget.subject?.host, 'budget'));
  findings.push(...workloadIdentityFindings(budget.subject?.workloadIdentity, 'budget'));
  findings.push(
    ...publicationComparisonWorkloadFindings(budget.subject?.workloadIdentity?.identity, 'budget'),
  );
  if (
    canonicalJson(budget.subject?.workloadIdentity?.identity?.cells) !==
    canonicalJson([budget.subject?.kind])
  ) {
    findings.push('budget subject kind does not match its workload');
  }
  for (const lock of REQUIRED_LOCKS) {
    if (!DIGEST_PATTERN.test(budget.subject?.locks?.[lock] ?? '')) {
      findings.push(`budget ${lock} digest is unavailable`);
    }
  }
  const regressionPct = budget.policy?.maxRegressionPct;
  if (!Number.isFinite(regressionPct) || regressionPct < 0 || regressionPct > 100) {
    findings.push('budget regression percentage is unavailable');
  }
  if (!ownRecord(budget.metrics) || Object.keys(budget.metrics).length === 0) {
    findings.push('budget metrics are empty');
  }
  if (budget.subject?.kind === 'browser') {
    findings.push(...browserPublicationMetricFindings(budget.metrics, 'budget'));
  } else if (budget.subject?.kind === 'server') {
    findings.push(...serverPublicationMetricFindings(budget.metrics, 'budget'));
  }
  const expectedTargets =
    budget.subject?.kind === 'browser'
      ? BROWSER_TARGETS
      : budget.subject?.kind === 'server'
        ? SERVER_TARGETS
        : null;
  if (canonicalJson(budget.policy?.targets) !== canonicalJson(expectedTargets)) {
    findings.push('budget competitive target policy differs from the declared target census');
  }
  if (
    budget.subject?.kind === 'server' &&
    canonicalJson(budget.policy?.representations) !== canonicalJson(SERVER_REPRESENTATION_POLICY)
  ) {
    findings.push('budget server representation policy is unavailable');
  }
  for (const [metric, entry] of Object.entries(budget.metrics ?? {})) {
    if (!ratifiedBudgetBaseline(entry?.baseline)) {
      findings.push(`budget ${metric} baseline evidence is unavailable`);
      continue;
    }
    if (entry.direction !== performanceMetricDirection(metric)) {
      findings.push(`budget ${metric} direction is not derived from the metric`);
    }
    if (entry.kind === 'informational') {
      if (metric.endsWith('/bfcache.applicable') !== true || entry.direction !== null) {
        findings.push(`budget ${metric} informational policy is unavailable`);
      }
    } else if (entry.kind === 'ratified-regression-ceiling') {
      if (
        entry.medianMaximum !== regressUpper(entry.baseline.kovoMedian, regressionPct) ||
        entry.p95Maximum !== regressUpper(entry.baseline.kovoP95, regressionPct)
      ) {
        findings.push(`budget ${metric} ceiling is not derived from ratified evidence`);
      }
    } else if (entry.kind === 'ratified-regression-floor') {
      if (
        entry.medianMinimum !== regressLower(entry.baseline.kovoMedian, regressionPct) ||
        entry.p95Minimum !== regressLower(entry.baseline.kovoP95, regressionPct)
      ) {
        findings.push(`budget ${metric} floor is not derived from ratified evidence`);
      }
    } else if (entry.kind !== 'exact-availability-floor' || entry.minimum !== 1) {
      findings.push(`budget ${metric} policy is unavailable`);
    }
  }
  if (
    canonicalJson(budget.targetAssessment) !==
    canonicalJson(
      baselineTargetAssessment(budget.subject?.kind, budget.metrics ?? {}, budget.policy?.targets),
    )
  ) {
    findings.push('budget target assessment is not derived from ratified evidence');
  }
  return [...new Set(findings)].sort((left, right) => left.localeCompare(right));
}

function linkedRawReportFindings(baseline, entries) {
  if (!Array.isArray(entries) || entries.length !== baseline.reports?.length) {
    return ['baseline raw comparison reports are unavailable'];
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
        `sha256:${createHash('sha256').update(entry.rawText).digest('hex')}` ===
          entry.contentDigest &&
        canonicalJson(JSON.parse(entry.rawText)) === canonicalJson(entry.report);
    } catch {
      parsedMatches = false;
    }
    const linked = linkedByDigest.get(entry?.contentDigest);
    if (
      !parsedMatches ||
      !linked ||
      seen.has(entry.contentDigest) ||
      entry.location !== linked.location ||
      entry.report?.execution?.digest !== linked.execution ||
      entry.report?.execution?.github?.runUrl !== linked.runUrl ||
      !entry.location.startsWith(`${linked.runUrl}/artifacts/`)
    ) {
      findings.push(`${label} does not match its ratified content/link identity`);
    }
    seen.add(entry?.contentDigest);
    findings.push(
      ...performanceReportFindings(entry?.report, label, {
        maxLoadPerCpu: baseline.policy.maxLoadPerCpu,
        minSamples: baseline.policy.minSamples,
      }),
    );
    if (baseline.subject?.workloadIdentity?.identity?.cells?.[0] === 'server') {
      findings.push(...serverBrotliRawEvidenceFindings(entry?.report, label));
    }
    for (const finding of executionIdentityFindings(entry?.report?.execution, {
      requireProvider: 'github-actions',
    })) {
      findings.push(`${label} ${finding}`);
    }
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
    const byDigest = new Map(entries.map((entry) => [entry.contentDigest, entry]));
    const ordered = baseline.reports.map((report) => byDigest.get(report.contentDigest));
    const reratified = ratifyPerformanceBaseline(ordered, baseline.policy);
    for (const field of ['identity', 'metrics', 'policy', 'reports', 'subject', 'verdict']) {
      if (canonicalJson(reratified[field]) !== canonicalJson(baseline[field])) {
        findings.push(`baseline ${field} is not reproduced by its linked raw reports`);
      }
    }
  }
  return findings;
}

/** Keep the seven-family publication ceremony bound to the exact Phase 0/3 workloads. */
function publicationComparisonWorkloadFindings(identity, label) {
  const findings = [];
  const cells = identity?.cells;
  const subject = Array.isArray(cells) && cells.length === 1 ? cells[0] : null;
  const policies = identity?.policies;
  if (!SUPPORTED_SUBJECTS.includes(subject)) return findings;
  if (subject === 'browser') {
    if (canonicalJson(identity?.lanes) !== canonicalJson(BROWSER_LANES)) {
      findings.push(`${label} browser workload does not include the exact default/L0/L1 lanes`);
    }
    if (
      policies?.browserSamples !== 30 ||
      policies?.lighthouseRuns !== 5 ||
      policies?.bfcacheIterations !== 10 ||
      policies?.warmups !== 3 ||
      policies?.skipLighthouse !== false
    ) {
      findings.push(
        `${label} browser workload is not 30 samples, 5 Lighthouse runs, 10 bfcache traversals, and 3 warmups`,
      );
    }
    return findings;
  }
  if (canonicalJson(identity?.lanes) !== canonicalJson(SERVER_LANES)) {
    findings.push(`${label} server workload does not use the isolated matched-runtime lane`);
  }
  const server = policies?.server;
  if (
    canonicalJson(server?.concurrencies) !== canonicalJson(SERVER_CONCURRENCIES) ||
    canonicalJson(server?.encodings) !== canonicalJson(SERVER_ENCODINGS) ||
    canonicalJson(server?.modes) !== canonicalJson(SERVER_MODES) ||
    canonicalJson(server?.routes) !== canonicalJson(SERVER_ROUTES) ||
    server?.samples !== 7 ||
    server?.warmupMs !== 5_000 ||
    server?.durationMs !== 15_000
  ) {
    findings.push(
      `${label} server workload is not the full 7-sample route/encoding/mode/concurrency matrix`,
    );
  }
  return findings;
}

function browserPublicationMetricFindings(metrics, label) {
  const findings = [];
  for (const metric of requiredBrowserPublicationMetrics()) {
    if (!ownRecord(metrics?.[metric])) {
      findings.push(`${label} required browser metric ${metric} is unavailable`);
    }
  }
  return findings;
}

function requiredBrowserPublicationMetrics() {
  const metrics = [];
  for (const lane of BROWSER_LANES) {
    for (const formFactor of BROWSER_FORM_FACTORS) {
      for (const leaf of ['fcpMs', 'lcpMs']) {
        metrics.push(`${lane}/browser//${formFactor}.coldLoad.${leaf}`);
      }
      metrics.push(`${lane}/browser//${formFactor}.navigation.navToPaintMs`);
      for (const phase of BROWSER_NAVIGATION_ATTRIBUTION_PHASES) {
        metrics.push(
          `${lane}/browser//${formFactor}.navigation.navAttribution.phases.${phase}.durationMs`,
        );
      }
      for (const phase of BROWSER_SESSION_BYTE_PHASES) {
        metrics.push(`${lane}/browser//${formFactor}.navigation.sessionBytes.${phase}.total`);
      }
      for (const route of BROWSER_ROUTES) {
        for (const leaf of ['fcpMs', 'lcpMs', 'performanceScore']) {
          metrics.push(`${lane}/browser//lighthouse.${formFactor}.${route}.${leaf}`);
        }
      }
    }
    for (const metricName of ['applicable', 'evidenceComplete', 'restored']) {
      metrics.push(`${lane}/browser//bfcache.${metricName}`);
    }
  }
  return metrics;
}

function serverPublicationMetricFindings(metrics, label) {
  const findings = [];
  for (const { metric } of targetCheckSpecifications('server', SERVER_TARGETS)) {
    if (!ownRecord(metrics?.[metric])) {
      findings.push(`${label} required server target metric ${metric} is unavailable`);
    }
  }
  for (const metric of Object.keys(metrics ?? {})) {
    if (
      /^matched-runtime\/server\/(?:hit|304|dynamic)-(?:listing|detail)-br-c(?:1|8|32)\//u.test(
        metric,
      )
    ) {
      findings.push(
        `${label} ${metric} fabricates a paired Brotli comparison; Next Brotli is unsupported`,
      );
    }
  }
  return findings;
}

function serverBrotliRawEvidenceFindings(report, label) {
  const findings = [];
  const samples = report?.workloadIdentity?.identity?.policies?.server?.samples;
  if (samples !== 7) return [`${label} Kovo Brotli raw sample policy is unavailable`];
  const rawCells = Array.isArray(report?.rawCells) ? report.rawCells : [];
  const expectedConditions = serverConditionKeys('br');
  const brotliCells = rawCells.filter(
    (cell) => cell?.cell === 'server' && cell?.report?.condition?.encoding === 'br',
  );
  if (brotliCells.length !== expectedConditions.length * samples * 2) {
    findings.push(`${label} Kovo/Next Brotli raw cell census is incomplete`);
  }
  for (const condition of expectedConditions) {
    for (const framework of ['kovo', 'nextjs']) {
      const occurrences = brotliCells
        .filter(
          (cell) =>
            cell.framework === framework &&
            cell.lane === 'matched-runtime' &&
            cell.mode === condition,
        )
        .sort((left, right) => left.occurrence - right.occurrence);
      if (
        occurrences.length !== samples ||
        canonicalJson(occurrences.map((cell) => cell.occurrence)) !==
          canonicalJson(Array.from({ length: samples }, (_, index) => index))
      ) {
        findings.push(
          `${label} ${condition}/${framework} raw Brotli occurrence census is incomplete`,
        );
        continue;
      }
      for (const cell of occurrences) {
        const raw = cell.report;
        if (
          raw?.condition?.key !== condition ||
          raw?.framework !== framework ||
          raw?.condition?.encoding !== 'br'
        ) {
          findings.push(`${label} ${condition}/${framework} raw Brotli identity is malformed`);
          break;
        }
        if (framework === 'kovo') {
          if (
            raw?.support?.status !== 'supported' ||
            raw?.verdict?.status !== 'measured' ||
            raw?.samples?.length !== 1 ||
            !Number.isFinite(raw.samples[0]?.requestsPerSecond) ||
            raw.samples[0].requestsPerSecond <= 0 ||
            (raw.condition.mode !== '304' && raw?.correctness?.contentEncoding !== 'br')
          ) {
            findings.push(`${label} ${condition}/kovo raw Brotli measurement is unavailable`);
            break;
          }
        } else if (
          raw?.support?.status !== 'unsupported' ||
          raw?.verdict?.status !== 'unsupported' ||
          raw?.samples?.length !== 0 ||
          raw?.correctness?.contentEncoding !== null
        ) {
          findings.push(`${label} ${condition}/nextjs unsupported Brotli proof is unavailable`);
          break;
        }
      }
    }
  }
  const matrix = report?.integrity?.comparator?.serverMatrix;
  const supported = Array.isArray(matrix?.supported)
    ? [...matrix.supported].sort((left, right) => left.localeCompare(right))
    : [];
  const excluded = Array.isArray(matrix?.excludedUnsupported)
    ? matrix.excludedUnsupported
        .map(
          (entry) =>
            `${String(entry?.condition)}:${(entry?.unsupportedFrameworks ?? []).join(',')}`,
        )
        .sort((left, right) => left.localeCompare(right))
    : [];
  if (
    matrix?.completeSupportedMatrix !== true ||
    canonicalJson(matrix?.findings) !== canonicalJson([]) ||
    canonicalJson(supported) !==
      canonicalJson(
        serverConditionKeys('identity').sort((left, right) => left.localeCompare(right)),
      ) ||
    canonicalJson(excluded) !==
      canonicalJson(
        serverConditionKeys('br')
          .map((condition) => `${condition}:nextjs`)
          .sort((left, right) => left.localeCompare(right)),
      )
  ) {
    findings.push(`${label} server representation support census is incomplete`);
  }
  return findings;
}

function serverConditionKeys(encoding) {
  const keys = [];
  for (const concurrency of SERVER_CONCURRENCIES) {
    for (const route of SERVER_ROUTES) {
      for (const mode of SERVER_MODES) {
        keys.push(`${mode.toLowerCase()}-${route}-${encoding}-c${String(concurrency)}`);
      }
    }
  }
  return keys;
}

function targetChecks(budget, candidate) {
  return targetCheckSpecifications(budget.subject.kind, budget.policy.targets).map((spec) =>
    spec.operator === '<='
      ? ratioCheck(spec.id, candidate.analysis[spec.metric], spec.limit, spec.kind)
      : inverseRatioCheck(spec.id, candidate.analysis[spec.metric], spec.limit),
  );
}

export function renderComparisonBudgetMarkdown(budget) {
  const findings = comparisonBudgetFindings(budget);
  if (findings.length > 0)
    throw new TypeError(`Cannot render unproven budget:\n${findings.join('\n')}`);
  const architecture =
    budget.subject.kind === 'browser'
      ? 'Default/as-shipped and capability-matched lanes remain separate; default L0/L1 architecture differences must be described beside any selected claim. A bfcache restore is only scored when `bfcache.applicable` is 1; same-document navigation has no cross-document entry to restore.'
      : 'Server cells keep proved HIT, conditional 304, and forced-dynamic posture separate. Competitive HIT and forced-dynamic checks compare the identity representation because Next does not serve Brotli here; Kovo Brotli remains required raw measurement evidence, never a fabricated paired win.';
  const rows = Object.entries(budget.metrics).map(([metric, entry]) =>
    [
      metric.replaceAll('|', '\\|'),
      formatNumber(entry.baseline.kovoMedian),
      formatNumber(entry.baseline.kovoP95),
      formatNumber(entry.baseline.nextMedian),
      formatNumber(entry.baseline.nextP95),
      entry.kind,
    ].join(' | '),
  );
  return [
    `# Ratified ${budget.subject.kind} performance baseline`,
    '',
    `Source: \`${budget.baseline.sourceCommit}\`. Host: \`${budget.subject.host.digest}\`. Workload: \`${budget.subject.workloadIdentity.digest}\`.`,
    '',
    architecture,
    '',
    `Baseline target assessment: **${budget.targetAssessment.status}**${
      budget.targetAssessment.failures.length > 0
        ? ` (${budget.targetAssessment.failures.join(', ')})`
        : ''
    }.`,
    '',
    'Raw evidence:',
    '',
    ...budget.baseline.reports.map((report) => `- [${report.execution}](${report.location})`),
    '',
    '| Metric | Kovo median | Kovo p95 | Next median | Next p95 | Budget policy |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
    ...rows,
    '',
  ].join('\n');
}

function baselineTargetAssessment(subject, metrics, targets) {
  const checks = targetCheckSpecifications(subject, targets).map((spec) => {
    const ratio = ratioFromBudgetEvidence(metrics[spec.metric]?.baseline);
    return {
      id: spec.id,
      limit: spec.limit,
      observed: ratio,
      status:
        Number.isFinite(ratio) && Number.isFinite(spec.limit)
          ? spec.operator === '<='
            ? ratio <= spec.limit
              ? 'pass'
              : 'fail'
            : ratio >= spec.limit
              ? 'pass'
              : 'fail'
          : 'fail',
    };
  });
  const failures = checks.filter(({ status }) => status === 'fail').map(({ id }) => id);
  return { checks, failures, status: failures.length === 0 && checks.length > 0 ? 'pass' : 'fail' };
}

function targetCheckSpecifications(subject, targets) {
  if (subject === 'browser') {
    return [
      targetCheckSpecification(
        'matched-l1/browser//mobile.navigation.navToPaintMs',
        targets?.matchedL1MobileNavigationMaximumRatio,
        '<=',
      ),
      targetCheckSpecification(
        'matched-l1/browser//mobile.navigation.sessionBytes.throughDestinationPaint.total',
        targets?.matchedL1TotalSessionBytesMaximumRatio,
        '<=',
      ),
    ];
  }
  if (subject !== 'server') return [];
  const specifications = [];
  for (const mode of ['dynamic', 'hit']) {
    for (const route of SERVER_ROUTES) {
      for (const concurrency of SERVER_CONCURRENCIES) {
        specifications.push(
          targetCheckSpecification(
            `matched-runtime/server/${mode}-${route}-identity-c${String(
              concurrency,
            )}/requestsPerSecond`,
            mode === 'dynamic'
              ? targets?.forcedDynamicThroughputMinimumRatio
              : targets?.cachedThroughputMinimumRatio,
            '>=',
          ),
        );
      }
    }
  }
  return specifications;
}

function targetCheckSpecification(metric, limit, operator) {
  return {
    id: `${metric}.median-vs-next`,
    kind: 'target',
    limit,
    metric,
    operator,
  };
}

function ratioFromBudgetEvidence(evidence) {
  return evidence?.nextMedian === 0 ? null : evidence?.kovoMedian / evidence?.nextMedian;
}

function validLinkedReports(reports) {
  return (
    Array.isArray(reports) &&
    reports.length >= 5 &&
    new Set(reports.map((report) => report.contentDigest)).size === reports.length &&
    new Set(reports.map((report) => report.execution)).size === reports.length &&
    new Set(reports.map((report) => report.runUrl)).size === reports.length &&
    new Set(reports.map((report) => report.location)).size === reports.length &&
    reports.every(
      (report) =>
        DIGEST_PATTERN.test(report?.contentDigest ?? '') &&
        DIGEST_PATTERN.test(report?.execution ?? '') &&
        ARTIFACT_PATTERN.test(report?.location ?? '') &&
        report.location.startsWith(`${report.runUrl}/artifacts/`),
    )
  );
}

function ratifiedEvidence(value, requireSampleP95) {
  return (
    ownRecord(value) &&
    Number.isFinite(value.median) &&
    Number.isFinite(value.mad) &&
    Number.isFinite(value.p95) &&
    Number.isSafeInteger(value.runs) &&
    value.runs >= 5 &&
    (!requireSampleP95 ||
      (ownRecord(value.sampleP95) &&
        Number.isFinite(value.sampleP95.median) &&
        value.sampleP95.runs === value.runs))
  );
}

function ratifiedBudgetBaseline(value) {
  return (
    ownRecord(value) &&
    ['kovoMedian', 'kovoP95', 'nextMedian', 'nextP95', 'pairedMedian'].every((field) =>
      Number.isFinite(value[field]),
    ) &&
    Number.isSafeInteger(value.runs) &&
    value.runs >= 5
  );
}

function upperCheck(id, observed, maximum, kind) {
  return {
    id,
    kind,
    limit: maximum,
    observed,
    status: Number.isFinite(observed) && observed <= maximum ? 'pass' : 'fail',
  };
}

function lowerCheck(id, observed, minimum, kind) {
  return {
    id,
    kind,
    limit: minimum,
    observed,
    status: Number.isFinite(observed) && observed >= minimum ? 'pass' : 'fail',
  };
}

function ratioCheck(id, analysis, maximum, kind) {
  const ratio =
    analysis.nextjs.median === 0
      ? Number.POSITIVE_INFINITY
      : analysis.kovo.median / analysis.nextjs.median;
  return { id, kind, limit: maximum, observed: ratio, status: ratio <= maximum ? 'pass' : 'fail' };
}

function inverseRatioCheck(id, analysis, minimum) {
  const ratio =
    analysis.nextjs.median === 0
      ? Number.POSITIVE_INFINITY
      : analysis.kovo.median / analysis.nextjs.median;
  return {
    id,
    kind: 'target',
    limit: minimum,
    observed: ratio,
    status: ratio >= minimum ? 'pass' : 'fail',
  };
}

function regressUpper(value, percentage) {
  return value * (1 + percentage / 100);
}

function regressLower(value, percentage) {
  return value * (1 - percentage / 100);
}

function sha256Canonical(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function finitePercentage(value, fallback, label) {
  const selected = value ?? fallback;
  if (!Number.isFinite(selected) || selected < 0 || selected > 100) {
    throw new TypeError(`${label} must be between 0 and 100`);
  }
  return selected;
}

function ownRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(3);
}

function parseOptions(args, repeated = new Set()) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith('--') || !value || value.startsWith('--')) {
      throw new TypeError(`unknown or incomplete option ${String(flag)}`);
    }
    if (!repeated.has(flag) && options.has(flag))
      throw new TypeError(`${flag} must be provided once`);
    const values = options.get(flag) ?? [];
    values.push(value);
    options.set(flag, values);
  }
  return options;
}

function requiredOption(options, flag) {
  const value = options.get(flag)?.[0];
  if (!value) throw new TypeError(`${flag} is required`);
  return value;
}

function repeatedOption(options, flag) {
  return options.get(flag) ?? [];
}

function assertKnownOptions(options, known) {
  for (const flag of options.keys()) {
    if (!known.includes(flag)) throw new TypeError(`unknown option ${flag}`);
  }
}

async function loadRawEntries(baseline, reportPaths) {
  const linked = new Map(baseline?.reports?.map((report) => [report.contentDigest, report]) ?? []);
  return Promise.all(
    reportPaths.map(async (reportPath) => {
      const bytes = await readFile(path.resolve(reportPath));
      const rawText = bytes.toString('utf8');
      const contentDigest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      return {
        contentDigest,
        location: linked.get(contentDigest)?.location ?? path.resolve(reportPath),
        rawText,
        report: JSON.parse(rawText),
      };
    }),
  );
}

async function main(args) {
  const command = args[0];
  const options = parseOptions(args.slice(1), new Set(['--report']));
  if (command === 'derive') {
    assertKnownOptions(options, [
      '--baseline',
      '--markdown-out',
      '--max-regression-pct',
      '--out',
      '--report',
    ]);
    const baseline = JSON.parse(
      await readFile(path.resolve(requiredOption(options, '--baseline')), 'utf8'),
    );
    const entries = await loadRawEntries(baseline, repeatedOption(options, '--report'));
    const budget = deriveComparisonPerformanceBudget(baseline, {
      baselineEntries: entries,
      maxRegressionPct: Number(options.get('--max-regression-pct')?.[0] ?? '5'),
    });
    await writeFile(
      path.resolve(requiredOption(options, '--out')),
      `${JSON.stringify(budget, null, 2)}\n`,
      { flag: 'w' },
    );
    const markdownOut = options.get('--markdown-out')?.[0];
    if (markdownOut) {
      await writeFile(path.resolve(markdownOut), `${renderComparisonBudgetMarkdown(budget)}\n`, {
        flag: 'w',
      });
    }
    process.stdout.write(`${budget.schema} derived ${budget.subject.kind} ${budget.digest}\n`);
    return;
  }
  if (command === 'evaluate') {
    assertKnownOptions(options, ['--budget', '--candidate', '--out']);
    const budget = JSON.parse(
      await readFile(path.resolve(requiredOption(options, '--budget')), 'utf8'),
    );
    const candidate = JSON.parse(
      await readFile(path.resolve(requiredOption(options, '--candidate')), 'utf8'),
    );
    const evaluation = evaluateComparisonPerformanceBudget(budget, candidate);
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
  throw new TypeError('usage: perf-comparison-budget.mjs <derive|evaluate> ...');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
