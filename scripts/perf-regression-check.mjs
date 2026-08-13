#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { executionIdentityFindings } from './lib/perf-execution.mjs';

export const PERF_REGRESSION_SCHEMA = 'kovo-performance-regression/v1';
const comparisonSchema = 'kovo-next-performance-comparison/v1';
const hostSchema = 'kovo-performance-host/v1';
const workloadSchema = 'kovo-performance-workload-identity/v1';
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const commitPattern = /^[0-9a-f]{40,64}$/u;
const requiredLocks = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);

/**
 * Compare two independently collected reports for the exact same authenticated subject.
 *
 * This is intentionally strict. A changed source commit belongs in a new reviewed baseline, not
 * behind an "approximately comparable" switch: budgets are ratified from repeated runs of one
 * source/workload/host identity, then reviewed when that subject changes (plans/good-perf.md
 * Phase 4; SPEC §1.1 honesty boundary).
 */
export function comparePerformanceReports(baseline, candidate, options = {}) {
  const policy = {
    maxLoadPerCpu: finiteOption(options.maxLoadPerCpu, 1, 'maxLoadPerCpu'),
    maxRegressionPct: finiteOption(options.maxRegressionPct, 5, 'maxRegressionPct'),
    minSamples: integerOption(options.minSamples, 5, 'minSamples'),
  };
  const findings = [
    ...performanceReportFindings(baseline, 'baseline', policy),
    ...performanceReportFindings(candidate, 'candidate', policy),
  ];
  compareIdentity(findings, baseline, candidate);

  const baselineMetrics = baseline?.analysis;
  const candidateMetrics = candidate?.analysis;
  const baselineKeys = objectKeys(baselineMetrics);
  const candidateKeys = objectKeys(candidateMetrics);
  if (canonicalJson(baselineKeys) !== canonicalJson(candidateKeys)) {
    findings.push('analysis metric census differs');
  }

  const metrics = [];
  if (findings.length === 0) {
    for (const metric of baselineKeys) {
      const before = baselineMetrics[metric];
      const after = candidateMetrics[metric];
      if (before.kovo.samples !== after.kovo.samples) {
        findings.push(`${metric} Kovo sample count differs`);
        continue;
      }
      const direction = metricDirection(metric);
      if (direction === null) continue;
      const regressionPct = metricRegressionPct(before.kovo.median, after.kovo.median, direction);
      metrics.push({
        baseline: before.kovo.median,
        candidate: after.kovo.median,
        direction,
        metric,
        regressionPct,
        status:
          Number.isFinite(regressionPct) && regressionPct <= policy.maxRegressionPct
            ? 'pass'
            : 'regression',
      });
    }
  }

  const reasons = [...new Set(findings)].sort();
  const regressions = metrics.filter((metric) => metric.status === 'regression');
  const status = reasons.length > 0 ? 'unproven' : regressions.length > 0 ? 'regression' : 'pass';
  return {
    baseline: reportIdentity(baseline),
    candidate: reportIdentity(candidate),
    generatedAt: new Date().toISOString(),
    metrics,
    policy,
    schema: PERF_REGRESSION_SCHEMA,
    verdict: { reasons, regressions: regressions.map((metric) => metric.metric), status },
  };
}

export function performanceReportFindings(report, label, policy = {}) {
  const findings = [];
  const maxLoadPerCpu = finiteOption(policy.maxLoadPerCpu, 1, 'maxLoadPerCpu');
  const minSamples = integerOption(policy.minSamples, 5, 'minSamples');
  if (!ownRecord(report) || report.schema !== comparisonSchema) {
    return [`${label} is not ${comparisonSchema}`];
  }
  if (!ownRecord(report.source) || !commitPattern.test(report.source.commit ?? '')) {
    findings.push(`${label} source commit is unavailable`);
  }
  if (report.source?.dirty !== false || report.source?.dirtyPaths?.length !== 0) {
    findings.push(`${label} source is dirty`);
  }
  for (const lock of requiredLocks) {
    if (!digestPattern.test(report.source?.locks?.[lock] ?? '')) {
      findings.push(`${label} ${lock} digest is unavailable`);
    }
  }
  for (const [field, expected] of [
    ['sourceStable', true],
    ['comparatorMatched', true],
    ['executionAuthenticated', true],
    ['serialized', true],
    ['publishable', true],
    ['workloadAuthenticated', true],
  ]) {
    if (report.integrity?.[field] !== expected) {
      findings.push(`${label} integrity.${field} is not true`);
    }
  }
  if (report.verdict?.status !== 'measured') findings.push(`${label} verdict is not measured`);

  for (const finding of executionIdentityFindings(report.execution)) {
    findings.push(`${label} ${finding}`);
  }
  if (
    report.execution?.provider === 'github-actions' &&
    report.execution.github?.sha !== report.source?.commit
  ) {
    findings.push(`${label} GitHub execution SHA does not match source commit`);
  }
  findings.push(...hostFingerprintFindings(report.host, label));
  findings.push(...workloadIdentityFindings(report.workloadIdentity, label));

  if (!Array.isArray(report.hostSamples) || report.hostSamples.length === 0) {
    findings.push(`${label} host samples are unavailable`);
  } else {
    for (let index = 0; index < report.hostSamples.length; index += 1) {
      const sample = report.hostSamples[index];
      const ceiling = Math.min(
        maxLoadPerCpu,
        Number.isFinite(sample?.ceiling) ? sample.ceiling : maxLoadPerCpu,
      );
      if (!Number.isFinite(sample?.loadPerCpu) || sample.loadPerCpu < 0) {
        findings.push(`${label} host sample ${index} has no finite load evidence`);
      } else if (
        sample.loadPerCpu > ceiling &&
        !isSupersededServerSettleSample(report.hostSamples, index)
      ) {
        findings.push(`${label} host sample ${index} exceeds the load ceiling`);
      }
    }
  }

  if (!ownRecord(report.analysis) || Object.keys(report.analysis).length === 0) {
    findings.push(`${label} analysis is empty`);
  } else {
    for (const [metric, analysis] of Object.entries(report.analysis)) {
      const expectedSamples = expectedMetricSamples(metric, report.workloadIdentity?.identity);
      if (expectedSamples === null) {
        findings.push(`${label} ${metric} sample policy is unavailable`);
      }
      findings.push(
        ...metricAnalysisFindings(analysis, `${label} ${metric}`, minSamples, expectedSamples, {
          allowSigned: metric.endsWith('.traceMarkerEpochSkewMs'),
        }),
      );
    }
  }
  return findings;
}

function isSupersededServerSettleSample(samples, index) {
  const sample = samples[index];
  if (
    sample?.phase !== 'server-quiet-host-settle' ||
    typeof sample.context !== 'string' ||
    sample.context.length === 0
  ) {
    return false;
  }
  return samples
    .slice(index + 1)
    .some(
      (later) => later?.phase === 'server-quiet-host-settle' && later.context === sample.context,
    );
}

export function hostFingerprintFindings(host, label = 'report') {
  if (!ownRecord(host) || host.schema !== hostSchema) {
    return [`${label} host fingerprint is unavailable`];
  }
  const facts = Object.fromEntries(
    Object.entries(host).filter(([key]) => key !== 'digest' && key !== 'schema'),
  );
  const expected = sha256Canonical(facts);
  return host.digest === expected ? [] : [`${label} host digest is not derived from its facts`];
}

export function workloadIdentityFindings(workload, label = 'report') {
  if (!ownRecord(workload) || workload.schema !== workloadSchema) {
    return [`${label} workload identity is unavailable`];
  }
  const findings = [];
  if (workload.complete !== true) findings.push(`${label} workload identity is incomplete`);
  if (!ownRecord(workload.identity)) findings.push(`${label} workload facts are unavailable`);
  else if (workload.digest !== sha256Canonical(workload.identity)) {
    findings.push(`${label} workload digest is not derived from its facts`);
  }
  return findings;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (ownRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function compareIdentity(findings, baseline, candidate) {
  if (baseline?.source?.commit !== candidate?.source?.commit) {
    findings.push('source commit identity differs');
  }
  if (baseline?.execution?.digest === candidate?.execution?.digest) {
    findings.push('baseline and candidate reuse one execution identity');
  }
  if (canonicalJson(baseline?.source?.locks) !== canonicalJson(candidate?.source?.locks)) {
    findings.push('dependency lock identity differs');
  }
  if (baseline?.host?.digest !== candidate?.host?.digest) {
    findings.push('host identity differs');
  }
  if (
    baseline?.workloadIdentity?.digest !== candidate?.workloadIdentity?.digest ||
    canonicalJson(baseline?.workloadIdentity?.identity) !==
      canonicalJson(candidate?.workloadIdentity?.identity)
  ) {
    findings.push('workload identity differs');
  }
}

function metricAnalysisFindings(
  analysis,
  label,
  minSamples,
  expectedSamples,
  { allowSigned = false } = {},
) {
  if (!ownRecord(analysis)) return [`${label} analysis is unavailable`];
  const findings = [];
  // Some metrics, such as edit-session peak RSS, are deliberately sampled once per serialized
  // occurrence rather than once per edit. The authenticated workload policy owns that smaller exact
  // count; applying the generic five-sample floor would make honest process-peak evidence impossible
  // to ratify.
  const requiredSamples =
    expectedSamples === null ? minSamples : Math.min(minSamples, expectedSamples);
  for (const framework of ['kovo', 'nextjs']) {
    const summary = analysis[framework];
    if (
      !ownRecord(summary) ||
      !finiteNonNegative(summary.mad) ||
      !(allowSigned ? Number.isFinite(summary.median) : finiteNonNegative(summary.median)) ||
      !(allowSigned ? Number.isFinite(summary.p95) : finiteNonNegative(summary.p95)) ||
      !Number.isSafeInteger(summary.samples) ||
      summary.samples < requiredSamples ||
      (expectedSamples !== null && summary.samples !== expectedSamples)
    ) {
      findings.push(`${label} ${framework} summary is short or malformed`);
    }
  }
  const paired = analysis.pairedDifference;
  if (
    !ownRecord(paired) ||
    paired.direction !== 'kovo-minus-nextjs' ||
    !Number.isFinite(paired.median) ||
    !Number.isSafeInteger(paired.samples) ||
    paired.samples < requiredSamples ||
    (expectedSamples !== null && paired.samples !== expectedSamples) ||
    !Array.isArray(paired.bootstrap95Ci) ||
    paired.bootstrap95Ci.length !== 2 ||
    paired.bootstrap95Ci.some((value) => !Number.isFinite(value))
  ) {
    findings.push(`${label} paired bootstrap evidence is short or malformed`);
  }
  return findings;
}

function expectedMetricSamples(metric, workloadIdentity) {
  const policies = workloadIdentity?.policies;
  const cell = metric.split('/')[1];
  if (!ownRecord(policies)) return null;
  if (cell === 'browser') {
    return Number.isSafeInteger(policies.browserSamples) && policies.browserSamples > 0
      ? policies.browserSamples
      : null;
  }
  if (cell === 'build') {
    return Number.isSafeInteger(policies.buildSamples) && policies.buildSamples > 0
      ? policies.buildSamples
      : null;
  }
  if (cell === 'server') {
    return Number.isSafeInteger(policies.server?.samples) && policies.server.samples > 0
      ? policies.server.samples
      : null;
  }
  if (cell === 'dev') {
    const leaf = metric.split('/').slice(3).join('/');
    const total = leaf.startsWith('ready.')
      ? policies.devReadySamples
      : leaf === 'edit.peakRssBytes'
        ? policies.devEditSessionSamples
        : policies.devEditSamples;
    return Number.isSafeInteger(total) && total > 0 ? total : null;
  }
  return null;
}

function metricDirection(metric) {
  // This is a clock-domain diagnostic centered around zero, not a duration. Both signs are valid
  // and neither "more negative" nor "more positive" is a performance improvement.
  if (metric.endsWith('.traceMarkerEpochSkewMs')) return null;
  if (
    /(?:requestsPerSecond|requests\.perSecond|throughput|restoredRate|Available|StateSurvived)$/iu.test(
      metric,
    )
  ) {
    return 'higher-is-better';
  }
  if (
    /(?:Bytes|Ms|cpuPercent)$/iu.test(metric) ||
    /\.(?:bytes|sessionBytes)(?:\.[^.]+)*\.(?:css|html|img|js|other|total)$/iu.test(metric)
  ) {
    return 'lower-is-better';
  }
  // Correctness/status counters are validated by the report's own exact integrity contract. Do
  // not turn a harmless change in request count, trace marker count, or status census into a
  // directional performance claim.
  return null;
}

function metricRegressionPct(baseline, candidate, direction) {
  if (!finiteNonNegative(baseline) || !finiteNonNegative(candidate))
    return Number.POSITIVE_INFINITY;
  if (baseline === 0) return candidate === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (
    ((direction === 'higher-is-better' ? baseline - candidate : candidate - baseline) / baseline) *
    100
  );
}

function reportIdentity(report) {
  return {
    host: report?.host?.digest ?? null,
    locks: report?.source?.locks ?? null,
    source: report?.source?.commit ?? null,
    workload: report?.workloadIdentity?.digest ?? null,
  };
}

function sha256Canonical(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function objectKeys(value) {
  return ownRecord(value) ? Object.keys(value).sort() : [];
}

function ownRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function finiteOption(value, fallback, label) {
  const selected = value ?? fallback;
  if (!Number.isFinite(selected) || selected < 0) throw new TypeError(`${label} must be >= 0`);
  return selected;
}

function integerOption(value, fallback, label) {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return selected;
}

function readFlag(args, flag, fallback) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new TypeError(`${flag} requires a value`);
  return value;
}

async function main(args) {
  const known = new Set([
    '--baseline',
    '--candidate',
    '--max-load-per-cpu',
    '--max-regression-pct',
    '--min-samples',
    '--out',
  ]);
  for (let index = 0; index < args.length; index += 2) {
    if (!known.has(args[index])) throw new TypeError(`unknown option ${String(args[index])}`);
  }
  const baselinePath = path.resolve(readFlag(args, '--baseline'));
  const candidatePath = path.resolve(readFlag(args, '--candidate'));
  const outputPath = path.resolve(readFlag(args, '--out'));
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  const candidate = JSON.parse(await readFile(candidatePath, 'utf8'));
  const result = comparePerformanceReports(baseline, candidate, {
    maxLoadPerCpu: Number(readFlag(args, '--max-load-per-cpu', '1')),
    maxRegressionPct: Number(readFlag(args, '--max-regression-pct', '5')),
    minSamples: Number(readFlag(args, '--min-samples', '5')),
  });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'w' });
  process.stdout.write(
    `${result.schema} ${result.verdict.status} metrics=${result.metrics.length}\n`,
  );
  for (const reason of result.verdict.reasons) process.stdout.write(`UNPROVEN ${reason}\n`);
  for (const metric of result.metrics.filter((entry) => entry.status === 'regression')) {
    process.stdout.write(`REGRESSION ${metric.metric} ${metric.regressionPct.toFixed(2)}%\n`);
  }
  process.exitCode =
    result.verdict.status === 'pass' ? 0 : result.verdict.status === 'regression' ? 1 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
