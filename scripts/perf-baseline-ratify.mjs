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

export const PERF_BASELINE_SCHEMA = 'kovo-performance-baseline/v1';
export const PERF_CHECK_REPORT_SCHEMA = 'kovo-perf-report/v1';

const requiredLocks = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);
const checkMetricKeys = Object.freeze([
  'check.appSourceTrust.marginalScalingExponent',
  'check.peakRssBytes',
  'check.total.marginalScalingExponent',
]);

/** Ratify one workload/commit/runner subject from independent, linked raw reports. */
export function ratifyPerformanceBaseline(entries, options = {}) {
  if (!Array.isArray(entries)) throw new TypeError('entries must be an array');
  const schemas = new Set(entries.map((entry) => entry?.report?.schema));
  if (schemas.size === 1 && schemas.has(PERF_CHECK_REPORT_SCHEMA)) {
    return ratifyCheckPerformanceBaseline(entries, options);
  }
  const policy = {
    maxLoadPerCpu: finiteOption(options.maxLoadPerCpu, 1, 'maxLoadPerCpu'),
    minRuns: integerOption(options.minRuns, 5, 'minRuns'),
    minSamples: integerOption(options.minSamples, 5, 'minSamples'),
    requireProvider: options.requireProvider ?? 'github-actions',
  };
  const findings = [];
  if (entries.length < policy.minRuns) {
    findings.push(
      `received ${String(entries.length)} reports; policy requires ${String(policy.minRuns)}`,
    );
  }

  const executions = new Set();
  const githubRuns = new Set();
  const locations = new Set();
  const contentDigests = new Set();
  for (const [index, entry] of entries.entries()) {
    const label = `report[${String(index)}]`;
    findings.push(
      ...performanceReportFindings(entry?.report, label, {
        maxLoadPerCpu: policy.maxLoadPerCpu,
        minSamples: policy.minSamples,
      }),
    );
    const executionPolicy =
      policy.requireProvider === 'any' ? {} : { requireProvider: policy.requireProvider };
    for (const finding of executionIdentityFindings(entry?.report?.execution, executionPolicy)) {
      findings.push(`${label} ${finding}`);
    }
    if (!digestPattern.test(entry?.contentDigest ?? '')) {
      findings.push(`${label} content digest is unavailable`);
    }
    if (!nonEmptyString(entry?.location)) findings.push(`${label} location is unavailable`);
    duplicateFinding(findings, executions, entry?.report?.execution?.digest, 'execution identity');
    duplicateFinding(
      findings,
      githubRuns,
      entry?.report?.execution?.github?.runUrl,
      'GitHub Actions run',
    );
    duplicateFinding(findings, locations, entry?.location, 'report location');
    duplicateFinding(findings, contentDigests, entry?.contentDigest, 'report content');
  }

  const first = entries[0]?.report;
  for (let index = 1; index < entries.length; index += 1) {
    const report = entries[index]?.report;
    for (const [label, left, right] of [
      ['source commit', first?.source?.commit, report?.source?.commit],
      ['dependency locks', first?.source?.locks, report?.source?.locks],
      ['host cohort identity', first?.host?.digest, report?.host?.digest],
      ['workload', first?.workloadIdentity, report?.workloadIdentity],
      ['analysis metric census', objectKeys(first?.analysis), objectKeys(report?.analysis)],
    ]) {
      if (canonicalJson(left) !== canonicalJson(right))
        findings.push(`${label} differs across reports`);
    }
  }

  const metrics = {};
  if (findings.length === 0) {
    for (const metric of objectKeys(first?.analysis)) {
      metrics[metric] = {
        kovo: summarizeRunEvidence(entries, metric, 'kovo'),
        nextjs: summarizeRunEvidence(entries, metric, 'nextjs'),
        pairedDifference: summarizeRunEvidence(entries, metric, 'pairedDifference'),
      };
    }
  }

  const reasons = [...new Set(findings)].sort();
  return {
    generatedAt: new Date().toISOString(),
    identity: {
      host: first?.host?.digest ?? null,
      locks: first?.source?.locks ?? null,
      source: first?.source?.commit ?? null,
      workload: first?.workloadIdentity?.digest ?? null,
    },
    metrics,
    policy,
    reports: entries.map((entry) => ({
      contentDigest: entry?.contentDigest ?? null,
      execution: entry?.report?.execution?.digest ?? null,
      location: entry?.location ?? null,
      runUrl: entry?.report?.execution?.github?.runUrl ?? null,
    })),
    schema: PERF_BASELINE_SCHEMA,
    subject: {
      host: first?.host ?? null,
      locks: first?.source?.locks ?? null,
      sourceCommit: first?.source?.commit ?? null,
      workloadIdentity: first?.workloadIdentity ?? null,
    },
    verdict: { reasons, status: reasons.length === 0 ? 'ratified' : 'unproven' },
  };
}

/** Ratify the standalone Kovo check-scaling ladder without inventing a Next.js subject. */
export function ratifyCheckPerformanceBaseline(entries, policyOptions = {}) {
  const policy = {
    maxLoadPerCpu: finiteOption(policyOptions.maxLoadPerCpu, 1, 'maxLoadPerCpu'),
    minRuns: integerOption(policyOptions.minRuns, 5, 'minRuns'),
    // One expensive ladder sample per rung in each of five independent workflow runs is the
    // declared check-scaling policy. `minRuns`, rather than hidden repetitions in one process,
    // provides the cross-run evidence floor.
    minSamples: integerOption(policyOptions.minSamples, 1, 'minSamples'),
    requireProvider: policyOptions.requireProvider ?? 'github-actions',
  };
  if (!Array.isArray(entries)) throw new TypeError('entries must be an array');
  const findings = [];
  if (entries.length < policy.minRuns) {
    findings.push(
      `received ${String(entries.length)} reports; policy requires ${String(policy.minRuns)}`,
    );
  }
  const executions = new Set();
  const githubRuns = new Set();
  const locations = new Set();
  const contentDigests = new Set();
  for (const [index, entry] of entries.entries()) {
    const label = `report[${String(index)}]`;
    findings.push(
      ...checkPerformanceReportFindings(entry?.report, label, {
        maxLoadPerCpu: policy.maxLoadPerCpu,
        minSamples: policy.minSamples,
        requireProvider: policy.requireProvider,
      }),
    );
    if (!digestPattern.test(entry?.contentDigest ?? '')) {
      findings.push(`${label} content digest is unavailable`);
    }
    if (!nonEmptyString(entry?.location)) findings.push(`${label} location is unavailable`);
    duplicateFinding(findings, executions, entry?.report?.execution?.digest, 'execution identity');
    duplicateFinding(
      findings,
      githubRuns,
      entry?.report?.execution?.github?.runUrl,
      'GitHub Actions run',
    );
    duplicateFinding(findings, locations, entry?.location, 'report location');
    duplicateFinding(findings, contentDigests, entry?.contentDigest, 'report content');
  }

  const first = entries[0]?.report;
  for (let index = 1; index < entries.length; index += 1) {
    const report = entries[index]?.report;
    for (const [label, left, right] of [
      ['source commit', first?.source?.commit, report?.source?.commit],
      ['dependency locks', first?.source?.locks, report?.source?.locks],
      ['host cohort identity', first?.host?.digest, report?.host?.digest],
      ['workload', first?.workloadIdentity, report?.workloadIdentity],
      ['metric census', objectKeys(first?.metrics), objectKeys(report?.metrics)],
    ]) {
      if (canonicalJson(left) !== canonicalJson(right)) {
        findings.push(`${label} differs across reports`);
      }
    }
  }

  const metrics = {};
  if (findings.length === 0) {
    for (const metric of objectKeys(first?.metrics)) {
      metrics[metric] = {
        kovo: summarizeValues(entries.map((entry) => entry.report.metrics[metric].value)),
      };
    }
  }
  const reasons = [...new Set(findings)].sort();
  return {
    generatedAt: new Date().toISOString(),
    identity: {
      host: first?.host?.digest ?? null,
      locks: first?.source?.locks ?? null,
      source: first?.source?.commit ?? null,
      workload: first?.workloadIdentity?.digest ?? null,
    },
    kind: 'check-scaling',
    metrics,
    policy,
    reports: entries.map((entry) => ({
      contentDigest: entry?.contentDigest ?? null,
      execution: entry?.report?.execution?.digest ?? null,
      location: entry?.location ?? null,
      runUrl: entry?.report?.execution?.github?.runUrl ?? null,
    })),
    schema: PERF_BASELINE_SCHEMA,
    subject: {
      host: first?.host ?? null,
      locks: first?.source?.locks ?? null,
      sourceCommit: first?.source?.commit ?? null,
      workloadIdentity: first?.workloadIdentity ?? null,
    },
    verdict: { reasons, status: reasons.length === 0 ? 'ratified' : 'unproven' },
  };
}

export function checkPerformanceReportFindings(report, label = 'report', options = {}) {
  const findings = [];
  const maxLoadPerCpu = finiteOption(options.maxLoadPerCpu, 1, 'maxLoadPerCpu');
  const minSamples = integerOption(options.minSamples, 1, 'minSamples');
  const requireProvider = options.requireProvider ?? 'github-actions';
  if (!ownRecord(report) || report.schema !== PERF_CHECK_REPORT_SCHEMA) {
    return [`${label} is not ${PERF_CHECK_REPORT_SCHEMA}`];
  }
  if (report.suite !== 'check-scaling') findings.push(`${label} is not check-scaling evidence`);
  if (!/^[0-9a-f]{40,64}$/u.test(report.source?.commit ?? '')) {
    findings.push(`${label} source commit is unavailable`);
  }
  if (report.source?.dirty !== false || report.source?.dirtyPaths?.length !== 0) {
    findings.push(`${label} source is dirty`);
  }
  if (canonicalJson(report.source) !== canonicalJson(report.sourceAfter)) {
    findings.push(`${label} source changed during the run`);
  }
  for (const lock of requiredLocks) {
    if (!digestPattern.test(report.source?.locks?.[lock] ?? '')) {
      findings.push(`${label} ${lock} digest is unavailable`);
    }
  }
  for (const field of [
    'complete',
    'executionAuthenticated',
    'publishable',
    'serialized',
    'sourceStable',
    'workloadAuthenticated',
  ]) {
    if (report.integrity?.[field] !== true)
      findings.push(`${label} integrity.${field} is not true`);
  }
  if (report.verdict?.status !== 'measured') findings.push(`${label} verdict is not measured`);
  for (const finding of executionIdentityFindings(
    report.execution,
    requireProvider === 'any' ? {} : { requireProvider },
  )) {
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
  if (!nonEmptyString(report.host?.runnerImage)) {
    findings.push(`${label} runner image identity is unavailable`);
  }
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
        findings.push(`${label} host sample ${String(index)} has no finite load evidence`);
      } else if (
        !Array.isArray(sample?.loadAverage) ||
        !Number.isFinite(sample.loadAverage[0]) ||
        sample.loadPerCpu !== sample.loadAverage[0] / report.host?.cpu?.count
      ) {
        findings.push(`${label} host sample ${String(index)} load identity is malformed`);
      } else if (sample.loadPerCpu > ceiling) {
        findings.push(`${label} host sample ${String(index)} exceeds the load ceiling`);
      }
    }
  }

  const identity = report.workloadIdentity?.identity;
  const ladder = identity?.policies?.ladder;
  const samplesPerRung = identity?.policies?.samplesPerRung;
  if (
    canonicalJson(identity?.cells) !== canonicalJson(['check-scaling']) ||
    canonicalJson(identity?.adapters) !==
      canonicalJson({
        perfGate: PERF_CHECK_REPORT_SCHEMA,
        workload: 'kovo-realistic-workload/v1',
      }) ||
    !Array.isArray(ladder) ||
    ladder.length < 2 ||
    ladder.some((value) => !Number.isSafeInteger(value) || value < 1) ||
    new Set(ladder).size !== ladder.length ||
    ladder.some((value, index) => index > 0 && value <= ladder[index - 1]) ||
    !Number.isSafeInteger(samplesPerRung) ||
    samplesPerRung < minSamples ||
    canonicalJson(report.options?.ladder) !== canonicalJson(ladder) ||
    report.options?.samples !== samplesPerRung
  ) {
    findings.push(`${label} check-scaling workload policy is malformed`);
  }
  const expectedHostContexts =
    Array.isArray(ladder) && Number.isSafeInteger(samplesPerRung)
      ? ladder.flatMap((componentCount) =>
          Array.from(
            { length: samplesPerRung },
            (_, index) => `N=${String(componentCount)}/sample=${String(index)}`,
          ),
        )
      : [];
  const rawRungLoads = Array.isArray(report.detail?.rungs)
    ? report.detail.rungs.flatMap((rung) =>
        (rung.samples ?? []).map((sample) =>
          Array.isArray(sample?.loadAverage) ? sample.loadAverage[0] : sample?.loadAverage,
        ),
      )
    : [];
  if (
    !Array.isArray(report.hostSamples) ||
    report.hostSamples.length !== expectedHostContexts.length + 1 ||
    expectedHostContexts.some(
      (context, index) =>
        report.hostSamples[index]?.phase !== 'check-scaling' ||
        report.hostSamples[index]?.context !== context ||
        report.hostSamples[index]?.loadAverage?.[0] !== rawRungLoads[index] ||
        report.hostSamples[index]?.loadPerCpu !== rawRungLoads[index] / report.host?.cpu?.count,
    ) ||
    report.hostSamples.at(-1)?.phase !== 'suite-complete'
  ) {
    findings.push(`${label} check-scaling pre/post host census is incomplete`);
  }
  if (canonicalJson(objectKeys(report.metrics)) !== canonicalJson([...checkMetricKeys].sort())) {
    findings.push(`${label} check-scaling metric census is incomplete`);
  }
  for (const metric of checkMetricKeys) {
    const value = report.metrics?.[metric]?.value;
    if (!Number.isFinite(value) || (metric === 'check.peakRssBytes' && !finiteNonNegative(value))) {
      findings.push(`${label} ${metric} is unavailable`);
    }
  }
  const rungs = report.detail?.rungs;
  if (
    !Array.isArray(rungs) ||
    canonicalJson(rungs.map((rung) => rung.componentCount)) !== canonicalJson(ladder)
  ) {
    findings.push(`${label} check-scaling rung census is incomplete`);
  } else {
    for (const rung of rungs) {
      if (
        !Array.isArray(rung.samples) ||
        rung.samples.length !== samplesPerRung ||
        rung.samples.some(
          (sample) =>
            sample?.exitCode !== 0 ||
            sample?.censusComplete !== true ||
            !finiteNonNegative(sample?.durationMs) ||
            !finiteNonNegative(sample?.appSourceTrustMs) ||
            !finiteNonNegative(sample?.peakRssBytes),
        )
      ) {
        findings.push(`${label} N=${String(rung.componentCount)} raw samples are incomplete`);
      }
    }
  }
  return [...new Set(findings)];
}

function summarizeRunEvidence(entries, metric, subject) {
  const evidence = summarizeRunField(entries, metric, subject, 'median');
  const p95Values = runFieldValues(entries, metric, subject, 'p95');
  if (p95Values.every(Number.isFinite)) {
    evidence.sampleP95 = summarizeValues(p95Values);
  }
  return evidence;
}

function summarizeRunField(entries, metric, subject, field) {
  return summarizeValues(runFieldValues(entries, metric, subject, field));
}

function runFieldValues(entries, metric, subject, field) {
  return entries.map((entry) => entry.report.analysis[metric][subject][field]);
}

function summarizeValues(values) {
  const median = percentile(values, 50);
  return {
    mad: percentile(
      values.map((value) => Math.abs(value - median)),
      50,
    ),
    median,
    p95: percentile(values, 95),
    runs: values.length,
  };
}

function percentile(values, pct) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1)];
}

function duplicateFinding(findings, seen, value, label) {
  if (value === undefined || value === null || value === '') return;
  if (seen.has(value)) findings.push(`duplicate ${label}`);
  seen.add(value);
}

function objectKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
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

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function ownRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

const digestPattern = /^sha256:[0-9a-f]{64}$/u;

function readRepeatedFlag(args, flag) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new TypeError(`${flag} requires a value`);
      values.push(value);
      index += 1;
    }
  }
  return values;
}

function readFlag(args, flag, fallback) {
  const values = readRepeatedFlag(args, flag);
  if (values.length === 0) return fallback;
  if (values.length > 1) throw new TypeError(`${flag} must be provided once`);
  return values[0];
}

/**
 * Resolve report paths to summary locations. Explicit locations are deliberately restricted to
 * canonical GitHub Actions artifact URLs: run and artifact numeric identities remain linkable in a
 * committed summary without embedding an expiring signed download URL.
 */
export function resolvePerformanceReportLocations(reportPaths, suppliedLocations = []) {
  if (!Array.isArray(reportPaths) || !Array.isArray(suppliedLocations)) {
    throw new TypeError('report paths and locations must be arrays');
  }
  if (suppliedLocations.length === 0) return [...reportPaths];
  if (suppliedLocations.length !== reportPaths.length) {
    throw new TypeError(
      `--location count ${String(suppliedLocations.length)} must equal --report count ${String(reportPaths.length)}`,
    );
  }
  const locations = suppliedLocations.map(validatePerformanceReportLocation);
  if (new Set(locations).size !== locations.length) {
    throw new TypeError('--location values must be unique');
  }
  return locations;
}

export async function loadPerformanceReportEntries(reportPaths, suppliedLocations = []) {
  const locations = resolvePerformanceReportLocations(reportPaths, suppliedLocations);
  return Promise.all(
    reportPaths.map(async (reportPath, index) => {
      const absolute = path.resolve(reportPath);
      const bytes = await readFile(absolute);
      const report = JSON.parse(bytes.toString('utf8'));
      if (suppliedLocations.length > 0) {
        const runUrl = report?.execution?.github?.runUrl;
        if (typeof runUrl !== 'string' || !locations[index].startsWith(`${runUrl}/artifacts/`)) {
          throw new TypeError(
            `--location[${String(index)}] does not identify an artifact from its report's GitHub Actions run`,
          );
        }
      }
      return {
        contentDigest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        location: locations[index],
        report,
      };
    }),
  );
}

function validatePerformanceReportLocation(value) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new TypeError('--location must be a non-empty canonical URL');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`--location is not a valid URL: ${value}`);
  }
  const githubArtifactPath =
    /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9][0-9]*\/artifacts\/[1-9][0-9]*$/u;
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    !githubArtifactPath.test(url.pathname) ||
    url.href !== value
  ) {
    throw new TypeError(
      '--location must be a canonical https://github.com/<owner>/<repo>/actions/runs/<run>/artifacts/<artifact> URL',
    );
  }
  return value;
}

async function main(args) {
  const valueFlags = new Set([
    '--max-load-per-cpu',
    '--min-runs',
    '--min-samples',
    '--location',
    '--out',
    '--report',
    '--require-provider',
  ]);
  for (let index = 0; index < args.length; index += 2) {
    if (!valueFlags.has(args[index]) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new TypeError(`unknown or incomplete option ${String(args[index])}`);
    }
  }
  const paths = readRepeatedFlag(args, '--report');
  const locations = readRepeatedFlag(args, '--location');
  const entries = await loadPerformanceReportEntries(paths, locations);
  const minSamples = readFlag(args, '--min-samples', undefined);
  const result = ratifyPerformanceBaseline(entries, {
    maxLoadPerCpu: Number(readFlag(args, '--max-load-per-cpu', '1')),
    minRuns: Number(readFlag(args, '--min-runs', '5')),
    ...(minSamples === undefined ? {} : { minSamples: Number(minSamples) }),
    requireProvider: readFlag(args, '--require-provider', 'github-actions'),
  });
  const output = path.resolve(readFlag(args, '--out'));
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'w' });
  process.stdout.write(
    `${result.schema} ${result.verdict.status} runs=${String(entries.length)}\n`,
  );
  for (const reason of result.verdict.reasons) process.stdout.write(`UNPROVEN ${reason}\n`);
  process.exitCode = result.verdict.status === 'ratified' ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
