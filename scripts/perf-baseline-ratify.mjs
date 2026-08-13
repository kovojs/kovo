#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { executionIdentityFindings } from './lib/perf-execution.mjs';
import { canonicalJson, performanceReportFindings } from './perf-regression-check.mjs';

export const PERF_BASELINE_SCHEMA = 'kovo-performance-baseline/v1';

/** Ratify one workload/commit/runner subject from independent, linked raw reports. */
export function ratifyPerformanceBaseline(entries, options = {}) {
  const policy = {
    maxLoadPerCpu: finiteOption(options.maxLoadPerCpu, 1, 'maxLoadPerCpu'),
    minRuns: integerOption(options.minRuns, 5, 'minRuns'),
    minSamples: integerOption(options.minSamples, 5, 'minSamples'),
    requireProvider: options.requireProvider ?? 'github-actions',
  };
  if (!Array.isArray(entries)) throw new TypeError('entries must be an array');
  const findings = [];
  if (entries.length < policy.minRuns) {
    findings.push(
      `received ${String(entries.length)} reports; policy requires ${String(policy.minRuns)}`,
    );
  }

  const executions = new Set();
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
    duplicateFinding(findings, locations, entry?.location, 'report location');
    duplicateFinding(findings, contentDigests, entry?.contentDigest, 'report content');
  }

  const first = entries[0]?.report;
  for (let index = 1; index < entries.length; index += 1) {
    const report = entries[index]?.report;
    for (const [label, left, right] of [
      ['source commit', first?.source?.commit, report?.source?.commit],
      ['dependency locks', first?.source?.locks, report?.source?.locks],
      ['host', first?.host, report?.host],
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
  const result = ratifyPerformanceBaseline(entries, {
    maxLoadPerCpu: Number(readFlag(args, '--max-load-per-cpu', '1')),
    minRuns: Number(readFlag(args, '--min-runs', '5')),
    minSamples: Number(readFlag(args, '--min-samples', '5')),
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
