#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { executionIdentityFindings } from './lib/perf-execution.mjs';
import {
  checkPerformanceReportFindings,
  ratifyPerformanceBaseline,
} from './perf-baseline-ratify.mjs';
import {
  canonicalJson,
  hostFingerprintFindings,
  workloadIdentityFindings,
} from './perf-regression-check.mjs';

export const PERF_CHECK_BUDGET_SCHEMA = 'kovo-check-performance-budget/v1';
export const PERF_CHECK_EVALUATION_SCHEMA = 'kovo-check-performance-evaluation/v1';

const BASELINE_SCHEMA = 'kovo-performance-baseline/v1';
const REPORT_SCHEMA = 'kovo-perf-report/v1';
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40,64}$/u;
const ARTIFACT_PATTERN =
  /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9][0-9]*\/artifacts\/[1-9][0-9]*$/u;
const REQUIRED_LOCKS = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);
const METRICS = Object.freeze([
  'check.appSourceTrust.marginalScalingExponent',
  'check.peakRssBytes',
  'check.total.marginalScalingExponent',
]);
const TARGETS = Object.freeze({
  'check.appSourceTrust.marginalScalingExponent': 1.3,
  'check.peakRssBytes': 3 * 1024 ** 3,
  'check.total.marginalScalingExponent': 1,
});

export function deriveCheckPerformanceBudget(baseline, options = {}) {
  const maxRegressionPct = finitePercentage(options.maxRegressionPct, 5, 'maxRegressionPct');
  const findings = checkBudgetBaselineFindings(baseline, options.baselineEntries);
  if (findings.length > 0) {
    throw new TypeError(`Check performance baseline is unproven:\n${findings.join('\n')}`);
  }
  const metrics = {};
  for (const key of METRICS) {
    const evidence = baseline.metrics[key].kovo;
    metrics[key] = {
      baseline: {
        mad: evidence.mad,
        median: evidence.median,
        p95: evidence.p95,
        runs: evidence.runs,
      },
      direction: 'lower-is-better',
      kind: 'ratified-run-p95-ceiling',
      maximum: upperRegression(evidence.p95, maxRegressionPct),
      targetMaximum: TARGETS[key],
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
      maxLoadPerCpu: baseline.policy.maxLoadPerCpu,
      maxRegressionPct,
    },
    schema: PERF_CHECK_BUDGET_SCHEMA,
    subject: {
      host: baseline.subject.host,
      locks: baseline.subject.locks,
      workloadIdentity: baseline.subject.workloadIdentity,
    },
  };
  return { ...facts, digest: sha256Canonical(facts) };
}

export function evaluateCheckPerformanceBudget(budget, candidate) {
  const reasons = [
    ...checkBudgetFindings(budget),
    ...checkPerformanceReportFindings(candidate, 'candidate', {
      maxLoadPerCpu: budget?.policy?.maxLoadPerCpu ?? 1,
      requireProvider: 'github-actions',
    }),
  ];
  if (candidate?.schema !== REPORT_SCHEMA) reasons.push(`candidate is not ${REPORT_SCHEMA}`);
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
  const checks = [];
  if (reasons.length === 0) {
    for (const [metric, entry] of Object.entries(budget.metrics)) {
      const observed = candidate.metrics[metric].value;
      checks.push(
        upperCheck(`${metric}.ratified-p95`, observed, entry.maximum, 'regression'),
        upperCheck(`${metric}.absolute-target`, observed, entry.targetMaximum, 'target'),
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
    schema: PERF_CHECK_EVALUATION_SCHEMA,
    verdict: {
      failures,
      reasons: uniqueReasons,
      status: uniqueReasons.length > 0 ? 'unproven' : failures.length > 0 ? 'regression' : 'pass',
    },
  };
}

export function checkBudgetBaselineFindings(baseline, entries) {
  if (!ownRecord(baseline) || baseline.schema !== BASELINE_SCHEMA) {
    return [`baseline is not ${BASELINE_SCHEMA}`];
  }
  const findings = [];
  if (baseline.kind !== 'check-scaling') findings.push('baseline kind is not check-scaling');
  if (baseline.verdict?.status !== 'ratified') findings.push('baseline verdict is not ratified');
  if (!Number.isSafeInteger(baseline.policy?.minRuns) || baseline.policy.minRuns < 5) {
    findings.push('baseline did not require at least five runs');
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
  if (
    canonicalJson(baseline.subject?.workloadIdentity?.identity?.cells) !==
    canonicalJson(['check-scaling'])
  ) {
    findings.push('baseline workload is not check-scaling');
  }
  if (
    canonicalJson(Object.keys(baseline.metrics ?? {}).sort()) !== canonicalJson([...METRICS].sort())
  ) {
    findings.push('baseline metric census is incomplete');
  }
  for (const metric of METRICS) {
    const evidence = baseline.metrics?.[metric]?.kovo;
    if (
      !ownRecord(evidence) ||
      !Number.isFinite(evidence.median) ||
      !Number.isFinite(evidence.mad) ||
      !Number.isFinite(evidence.p95) ||
      !Number.isSafeInteger(evidence.runs) ||
      evidence.runs < 5
    ) {
      findings.push(`baseline ${metric} evidence is unavailable`);
    }
  }
  findings.push(...linkedRawFindings(baseline, entries));
  return [...new Set(findings)].sort();
}

export function checkBudgetFindings(budget) {
  if (!ownRecord(budget) || budget.schema !== PERF_CHECK_BUDGET_SCHEMA) {
    return [`budget is not ${PERF_CHECK_BUDGET_SCHEMA}`];
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
  findings.push(...hostFingerprintFindings(budget.subject?.host, 'budget'));
  findings.push(...workloadIdentityFindings(budget.subject?.workloadIdentity, 'budget'));
  if (
    canonicalJson(budget.subject?.workloadIdentity?.identity?.cells) !==
    canonicalJson(['check-scaling'])
  ) {
    findings.push('budget workload is not check-scaling');
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
  if (
    canonicalJson(Object.keys(budget.metrics ?? {}).sort()) !== canonicalJson([...METRICS].sort())
  ) {
    findings.push('budget metric census is incomplete');
  }
  for (const metric of METRICS) {
    const entry = budget.metrics?.[metric];
    if (
      !ownRecord(entry?.baseline) ||
      !Number.isFinite(entry.baseline.median) ||
      !Number.isFinite(entry.baseline.mad) ||
      !Number.isFinite(entry.baseline.p95) ||
      !Number.isSafeInteger(entry.baseline.runs) ||
      entry.baseline.runs < 5 ||
      entry.direction !== 'lower-is-better' ||
      entry.kind !== 'ratified-run-p95-ceiling' ||
      entry.maximum !== upperRegression(entry.baseline.p95, regressionPct) ||
      entry.targetMaximum !== TARGETS[metric]
    ) {
      findings.push(`budget ${metric} is not derived from ratified evidence`);
    }
  }
  return [...new Set(findings)].sort();
}

function linkedRawFindings(baseline, entries) {
  if (!Array.isArray(entries) || entries.length !== baseline.reports?.length) {
    return ['baseline raw check reports are unavailable'];
  }
  const findings = [];
  const links = new Map(baseline.reports.map((report) => [report.contentDigest, report]));
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
    const linked = links.get(entry?.contentDigest);
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
      ...checkPerformanceReportFindings(entry?.report, label, {
        maxLoadPerCpu: baseline.policy.maxLoadPerCpu,
        requireProvider: 'github-actions',
      }),
    );
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
    for (const field of [
      'identity',
      'kind',
      'metrics',
      'policy',
      'reports',
      'subject',
      'verdict',
    ]) {
      if (canonicalJson(reratified[field]) !== canonicalJson(baseline[field])) {
        findings.push(`baseline ${field} is not reproduced by its linked raw reports`);
      }
    }
  }
  return findings;
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

function upperCheck(id, observed, maximum, kind) {
  return {
    id,
    kind,
    limit: maximum,
    observed,
    status: Number.isFinite(observed) && observed <= maximum ? 'pass' : 'fail',
  };
}

function upperRegression(value, percentage) {
  return value + Math.abs(value) * (percentage / 100);
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

function assertKnownOptions(options, known) {
  for (const flag of options.keys()) {
    if (!known.includes(flag)) throw new TypeError(`unknown option ${flag}`);
  }
}

async function loadRawEntries(baseline, reportPaths) {
  const links = new Map(baseline?.reports?.map((report) => [report.contentDigest, report]) ?? []);
  return Promise.all(
    reportPaths.map(async (reportPath) => {
      const bytes = await readFile(path.resolve(reportPath));
      const rawText = bytes.toString('utf8');
      const contentDigest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      return {
        contentDigest,
        location: links.get(contentDigest)?.location ?? path.resolve(reportPath),
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
    assertKnownOptions(options, ['--baseline', '--max-regression-pct', '--out', '--report']);
    const baseline = JSON.parse(
      await readFile(path.resolve(requiredOption(options, '--baseline')), 'utf8'),
    );
    const entries = await loadRawEntries(baseline, options.get('--report') ?? []);
    const budget = deriveCheckPerformanceBudget(baseline, {
      baselineEntries: entries,
      maxRegressionPct: Number(options.get('--max-regression-pct')?.[0] ?? '5'),
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
    const budget = JSON.parse(
      await readFile(path.resolve(requiredOption(options, '--budget')), 'utf8'),
    );
    const candidate = JSON.parse(
      await readFile(path.resolve(requiredOption(options, '--candidate')), 'utf8'),
    );
    const evaluation = evaluateCheckPerformanceBudget(budget, candidate);
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
  throw new TypeError('usage: perf-check-budget.mjs <derive|evaluate> ...');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
