#!/usr/bin/env node
/**
 * Serialized A/B runner for Kovo's proved-document compressed representation cache.
 *
 * `baseline` sets the framework-owned disable-only environment seam; `spike` removes it. Both
 * arms execute the same freshly built Kovo production artifact through perf-server-benchmark.mjs.
 * No unsupported response and no failed correctness proof is admitted into paired statistics.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { bootstrapMedianCi, summarize } from '../benchmarks/compare.mjs';
import {
  canonicalJson,
  performanceHostFingerprint,
  validPerformanceHostFingerprint,
} from './lib/perf-host.mjs';
import { collectPerformanceProvenance } from './lib/perf-provenance.mjs';
import {
  PROVED_DOCUMENT_COMPRESSION_CACHE_DISABLE_ENV,
  SERVER_BENCHMARK_SCHEMA,
  SERVER_CONCURRENCIES,
  SERVER_ENCODINGS,
  SERVER_MODES,
  SERVER_PREPARE_SCHEMA,
  SERVER_ROUTES,
  serverConditions,
} from './perf-server-benchmark.mjs';

export const COMPRESSED_CACHE_AB_SCHEMA = 'kovo-compressed-cache-ab/v1';
export const COMPRESSED_CACHE_AB_ORDER = Object.freeze(['baseline', 'spike', 'spike', 'baseline']);

const LOCK_FILES = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);
const DEFAULT_DURATION_MS = 15_000;
const DEFAULT_MAX_LOAD_PER_CPU = 0.75;
const DEFAULT_SAMPLES = 7;
const DEFAULT_WARMUP_MS = 5_000;
const MAX_CAPTURE_BYTES = 1024 * 1024;
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const serverAdapterPath = path.join(repoRoot, 'scripts/perf-server-benchmark.mjs');

const METRICS = Object.freeze([
  Object.freeze({ higherIsBetter: true, name: 'requestsPerSecond' }),
  Object.freeze({ higherIsBetter: false, name: 'p50Ms' }),
  Object.freeze({ higherIsBetter: false, name: 'p95Ms' }),
  Object.freeze({ higherIsBetter: false, name: 'p99Ms' }),
  Object.freeze({ higherIsBetter: false, name: 'serverCpuMs' }),
  Object.freeze({ higherIsBetter: false, name: 'serverCpuPercent' }),
  Object.freeze({ higherIsBetter: false, name: 'peakRssBytes' }),
]);

/** Repeat B,S,S,B until both arms own the requested number of occurrences. */
export function compressedCacheSampleSchedule(samples = DEFAULT_SAMPLES) {
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 100) {
    throw new TypeError(`samples must be an integer between 1 and 100, got ${String(samples)}`);
  }
  const counts = { baseline: 0, spike: 0 };
  const schedule = [];
  while (counts.baseline < samples || counts.spike < samples) {
    for (const arm of COMPRESSED_CACHE_AB_ORDER) {
      if (counts[arm] >= samples) continue;
      schedule.push({ arm, occurrence: counts[arm] });
      counts[arm] += 1;
    }
  }
  return schedule;
}

/** The baseline can only remove cache acceleration; the spike cannot inherit a disabling value. */
export function compressedCacheArmEnvironment(arm, source = process.env) {
  if (arm !== 'baseline' && arm !== 'spike') throw new TypeError(`unknown cache A/B arm ${arm}`);
  const env = { ...source };
  if (arm === 'baseline') env[PROVED_DOCUMENT_COMPRESSION_CACHE_DISABLE_ENV] = '1';
  else delete env[PROVED_DOCUMENT_COMPRESSION_CACHE_DISABLE_ENV];
  return env;
}

export function analyzeCompressedCacheSamples(
  rawSamples,
  { bootstrapIterations = 10_000, seed = 0x4b4f564f } = {},
) {
  const output = {};
  const keys = [...new Set(rawSamples.map((cell) => cell.condition.key))].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  for (const key of keys) {
    const cells = rawSamples.filter((cell) => cell.condition.key === key);
    const baselineByOccurrence = new Map(
      cells.filter((cell) => cell.arm === 'baseline').map((cell) => [cell.occurrence, cell.sample]),
    );
    const spikeByOccurrence = new Map(
      cells.filter((cell) => cell.arm === 'spike').map((cell) => [cell.occurrence, cell.sample]),
    );
    const occurrences = [...baselineByOccurrence.keys()]
      .filter((occurrence) => spikeByOccurrence.has(occurrence))
      .sort((left, right) => left - right);
    if (occurrences.length === 0) continue;
    const metrics = {};
    for (const metric of METRICS) {
      const baseline = [];
      const spike = [];
      const improvements = [];
      const improvementPercent = [];
      for (const occurrence of occurrences) {
        const baselineValue = finiteNonNegative(
          baselineByOccurrence.get(occurrence)?.[metric.name],
          `${key}/${metric.name}/baseline`,
        );
        const spikeValue = finiteNonNegative(
          spikeByOccurrence.get(occurrence)?.[metric.name],
          `${key}/${metric.name}/spike`,
        );
        baseline.push(baselineValue);
        spike.push(spikeValue);
        const improvement = metric.higherIsBetter
          ? spikeValue - baselineValue
          : baselineValue - spikeValue;
        improvements.push(improvement);
        if (baselineValue > 0) improvementPercent.push((improvement / baselineValue) * 100);
      }
      metrics[metric.name] = {
        baseline: summarize(baseline),
        pairedImprovement: {
          bootstrap95Ci: bootstrapMedianCi(improvements, {
            iterations: bootstrapIterations,
            seed,
          }),
          direction: 'positive-favors-cache-enabled-spike',
          median: summarize(improvements).median,
          percent:
            improvementPercent.length === improvements.length
              ? {
                  bootstrap95Ci: bootstrapMedianCi(improvementPercent, {
                    iterations: bootstrapIterations,
                    seed: seed + 1,
                  }),
                  median: summarize(improvementPercent).median,
                }
              : null,
          samples: improvements.length,
        },
        spike: summarize(spike),
      };
      seed += 2;
    }
    output[key] = {
      condition: cells[0].condition,
      metrics,
      pairedOccurrences: occurrences,
    };
  }
  return output;
}

/** Apply plans/good-perf.md's exact spike rule to cached Brotli HIT cells. */
export function evaluateCompressedCacheAcceptance(
  rawSamples,
  { bootstrapIterations = 10_000, seed = 0x43414348 } = {},
) {
  const primary = rawSamples.filter(
    (cell) => cell.condition.encoding === 'br' && cell.condition.mode === 'HIT',
  );
  const conditionKeys = [...new Set(primary.map((cell) => cell.condition.key))].sort(
    (left, right) => (left < right ? -1 : left > right ? 1 : 0),
  );
  const throughputImprovementPercent = [];
  const p95RegressionByCondition = {};
  const rssRegressionByCondition = {};
  for (const key of conditionKeys) {
    const cells = primary.filter((cell) => cell.condition.key === key);
    const baseline = new Map(
      cells.filter((cell) => cell.arm === 'baseline').map((cell) => [cell.occurrence, cell.sample]),
    );
    const spike = new Map(
      cells.filter((cell) => cell.arm === 'spike').map((cell) => [cell.occurrence, cell.sample]),
    );
    const occurrences = [...baseline.keys()]
      .filter((occurrence) => spike.has(occurrence))
      .sort((left, right) => left - right);
    const p95Regressions = [];
    const rssRegressions = [];
    for (const occurrence of occurrences) {
      const baselineSample = baseline.get(occurrence);
      const spikeSample = spike.get(occurrence);
      const baselineThroughput = finitePositive(
        baselineSample?.requestsPerSecond,
        `${key}/baseline requestsPerSecond`,
      );
      const spikeThroughput = finiteNonNegative(
        spikeSample?.requestsPerSecond,
        `${key}/spike requestsPerSecond`,
      );
      throughputImprovementPercent.push(
        ((spikeThroughput - baselineThroughput) / baselineThroughput) * 100,
      );
      const baselineP95 = finitePositive(baselineSample?.p95Ms, `${key}/baseline p95Ms`);
      const spikeP95 = finiteNonNegative(spikeSample?.p95Ms, `${key}/spike p95Ms`);
      p95Regressions.push(((spikeP95 - baselineP95) / baselineP95) * 100);
      const baselineRss = finitePositive(
        baselineSample?.peakRssBytes,
        `${key}/baseline peakRssBytes`,
      );
      const spikeRss = finiteNonNegative(spikeSample?.peakRssBytes, `${key}/spike peakRssBytes`);
      rssRegressions.push(((spikeRss - baselineRss) / baselineRss) * 100);
    }
    if (occurrences.length > 0) {
      p95RegressionByCondition[key] = summarize(p95Regressions).median;
      rssRegressionByCondition[key] = summarize(rssRegressions).median;
    }
  }
  if (throughputImprovementPercent.length === 0) {
    return {
      criteriaAccepted: false,
      criterion: null,
      primaryConditions: conditionKeys,
      reasons: ['cached Brotli HIT pairs are unavailable'],
      thresholds: acceptanceThresholds(),
    };
  }
  const throughputMedianPercent = summarize(throughputImprovementPercent).median;
  const throughputBootstrap95Ci = bootstrapMedianCi(throughputImprovementPercent, {
    iterations: bootstrapIterations,
    seed,
  });
  const maxP95RegressionPercent = Math.max(...Object.values(p95RegressionByCondition));
  const maxRssRegressionPercent = Math.max(...Object.values(rssRegressionByCondition));
  const confidencePositive = throughputBootstrap95Ci[0] > 0;
  const criterionA = throughputMedianPercent >= 10 && confidencePositive;
  const criterionB =
    throughputMedianPercent >= 5 &&
    confidencePositive &&
    maxP95RegressionPercent <= 5 &&
    maxRssRegressionPercent <= 5;
  const criteriaAccepted = criterionA || criterionB;
  const reasons = [];
  if (throughputMedianPercent < 5)
    reasons.push('cached Brotli HIT median throughput improvement is below 5%');
  if (!confidencePositive)
    reasons.push('cached Brotli HIT paired bootstrap 95% CI does not exclude zero');
  if (!criterionA && maxP95RegressionPercent > 5)
    reasons.push('a cached Brotli HIT cell regressed median p95 latency by more than 5%');
  if (!criterionA && maxRssRegressionPercent > 5)
    reasons.push('a cached Brotli HIT cell regressed median RSS by more than 5%');
  return {
    criteriaAccepted,
    criterion: criterionA ? 'a' : criterionB ? 'b' : null,
    observed: {
      maxP95RegressionPercent,
      maxRssRegressionPercent,
      p95RegressionByCondition,
      rssRegressionByCondition,
      throughputBootstrap95Ci,
      throughputMedianPercent,
      throughputPairs: throughputImprovementPercent.length,
    },
    primaryConditions: conditionKeys,
    reasons,
    thresholds: acceptanceThresholds(),
  };
}

function acceptanceThresholds() {
  return {
    criterionA: 'median throughput improvement >=10% and paired bootstrap 95% CI lower bound >0',
    criterionB:
      'median throughput improvement >=5%, paired bootstrap 95% CI lower bound >0, and every cached-Brotli HIT cell median p95/RSS regression <=5%',
    integrity:
      'zero correctness misses, transport failures, adapter errors, and zero-request samples',
    primary: 'encoding=br and mode=HIT across listing/detail and c=1/8/32',
  };
}

export async function runCompressedCacheAb(options = {}, dependencies = {}) {
  const policy = compressedCachePolicy(options);
  const conditions = serverConditions({
    concurrencies: policy.concurrencies,
    encodings: policy.encodings,
    modes: policy.modes,
    routes: policy.routes,
  });
  const schedule = compressedCacheSampleSchedule(policy.samplesPerArm);
  const collectProvenance =
    dependencies.collectProvenance ??
    (() => collectPerformanceProvenance({ lockFiles: LOCK_FILES, repoRoot }));
  const identifyWorkload =
    dependencies.identifyWorkload ?? (() => compressedCacheWorkloadIdentity(policy));
  const executeAdapter = dependencies.executeAdapter ?? executeServerAdapter;
  const sampleHost = dependencies.sampleHost ?? hostObservation;
  const now = dependencies.now ?? Date.now;
  const wait =
    dependencies.wait ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const source = collectProvenance();
  const workload = identifyWorkload();
  const host = (dependencies.hostFingerprint ?? performanceHostFingerprint)();
  const errors = [];
  const hostSamples = [];
  const rawSamples = [];
  let preparation = null;
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'kovo-compressed-cache-ab-'));
  let outputIndex = 0;

  const readHost = (position, context, extra = {}) => {
    let observed;
    try {
      observed = sampleHost();
    } catch (error) {
      errors.push(`host/${position}/${context}: ${errorMessage(error)}`);
      return null;
    }
    const row = { context, position, ...extra, ...observed };
    hostSamples.push(row);
    if (!Number.isFinite(observed.loadPerCpu) || observed.loadPerCpu < 0) {
      errors.push(`host/${position}/${context}: load observation is invalid`);
      return null;
    }
    return row;
  };

  const settleHost = async (context) => {
    const startedAt = now();
    let attempt = 0;
    while (true) {
      const waitedMs = Math.max(0, now() - startedAt);
      const observed = readHost('before', context, {
        attempt,
        phase: 'server-quiet-host-settle',
        waitedMs,
      });
      if (observed === null) return false;
      if (observed.loadPerCpu <= policy.maxLoadPerCpu) return true;
      if (waitedMs >= policy.hostSettleMaxMs) {
        errors.push(
          `host/before/${context}: load ${String(observed.loadPerCpu)} per CPU exceeded ${String(policy.maxLoadPerCpu)} after ${String(waitedMs)}ms settle`,
        );
        return false;
      }
      await wait(Math.min(policy.hostSettlePollMs, policy.hostSettleMaxMs - waitedMs));
      attempt += 1;
    }
  };

  try {
    if (source.dirty && !policy.allowDirty) {
      errors.push(`source provenance is dirty: ${source.dirtyPaths.join(', ')}`);
    }
    if (errors.length === 0 && (await settleHost('prepare'))) {
      const outputPath = path.join(scratch, `adapter-${String(outputIndex)}.json`);
      outputIndex += 1;
      const execution = await executeAdapter({
        args: [
          '--framework',
          'kovo',
          '--prepare-only',
          '--port',
          String(policy.port),
          ...(policy.allowDirty ? ['--allow-dirty'] : []),
        ],
        cwd: repoRoot,
        env: compressedCacheArmEnvironment('spike', dependencies.baseEnv ?? process.env),
        outputPath,
      });
      preparation = execution.report ?? null;
      if (execution.processError) errors.push(`prepare: ${execution.processError}`);
      errors.push(
        ...validatePreparation(preparation, { host, source }).map(
          (finding) => `prepare: ${finding}`,
        ),
      );
      readHost('after', 'prepare', { phase: 'server-cell-postflight' });
    }

    for (const condition of conditions) {
      if (errors.length > 0) break;
      for (let scheduleIndex = 0; scheduleIndex < schedule.length; scheduleIndex += 1) {
        const scheduled = schedule[scheduleIndex];
        const context = `${condition.key}/${scheduled.arm}/${String(scheduled.occurrence)}`;
        if (!(await settleHost(context))) break;
        const outputPath = path.join(scratch, `adapter-${String(outputIndex)}.json`);
        outputIndex += 1;
        let execution;
        try {
          execution = await executeAdapter({
            args: [
              '--framework',
              'kovo',
              '--mode',
              condition.mode,
              '--route',
              condition.route,
              '--encoding',
              condition.encoding,
              '--concurrency',
              String(condition.concurrency),
              '--warmup-ms',
              String(policy.warmupMs),
              '--duration-ms',
              String(policy.durationMs),
              '--port',
              String(policy.port),
              '--skip-build',
              ...(policy.allowDirty ? ['--allow-dirty'] : []),
            ],
            cwd: repoRoot,
            env: compressedCacheArmEnvironment(scheduled.arm, dependencies.baseEnv ?? process.env),
            outputPath,
          });
        } catch (error) {
          execution = { processError: errorMessage(error), report: null };
        }
        const report = execution.report ?? null;
        const sample = report?.samples?.[0] ?? null;
        rawSamples.push({
          arm: scheduled.arm,
          cachePosture: scheduled.arm === 'baseline' ? 'disabled' : 'enabled',
          condition,
          occurrence: scheduled.occurrence,
          processError: execution.processError ?? null,
          report,
          sample,
          scheduleIndex,
        });
        if (execution.processError) errors.push(`${context}: ${execution.processError}`);
        errors.push(
          ...validateCacheCell(report, {
            allowDirty: policy.allowDirty,
            arm: scheduled.arm,
            condition,
            durationMs: policy.durationMs,
            host,
            source,
            warmupMs: policy.warmupMs,
          }).map((finding) => `${context}: ${finding}`),
        );
        readHost('after', context, { phase: 'server-cell-postflight' });
        if (errors.length > 0) break;
      }
    }
  } catch (error) {
    errors.push(errorMessage(error));
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }

  const sourceAfter = collectProvenance();
  const workloadAfter = identifyWorkload();
  const sourceStable = sameSourceState(source, sourceAfter);
  const workloadStable = workload.digest === workloadAfter.digest;
  if (!sourceStable) errors.push('source provenance changed during the comparison');
  if (!workloadStable) errors.push('workload identity changed during the comparison');
  errors.push(...cacheMatrixIntegrityFindings(rawSamples, conditions, schedule));
  const uniqueErrors = [...new Set(errors)];
  const expectedRawSamples = conditions.length * schedule.length;
  const totals = rawSamples.reduce(
    (summary, cell) => {
      summary.adapterErrors += cell.processError === null ? 0 : 1;
      summary.failedRequests += cell.sample?.failedRequests ?? 0;
      summary.misses += cell.sample?.misses ?? 0;
      summary.reportErrors += cell.report?.integrity?.errors?.length ?? 0;
      summary.zeroRequestSamples += (cell.sample?.requests ?? 0) > 0 ? 0 : 1;
      return summary;
    },
    { adapterErrors: 0, failedRequests: 0, misses: 0, reportErrors: 0, zeroRequestSamples: 0 },
  );
  const complete =
    uniqueErrors.length === 0 &&
    rawSamples.length === expectedRawSamples &&
    totals.adapterErrors === 0 &&
    totals.failedRequests === 0 &&
    totals.misses === 0 &&
    totals.reportErrors === 0 &&
    totals.zeroRequestSamples === 0 &&
    sourceStable &&
    workloadStable;
  let analysis = null;
  if (complete) {
    try {
      analysis = analyzeCompressedCacheSamples(rawSamples, {
        bootstrapIterations: policy.bootstrapIterations,
        seed: policy.seed,
      });
    } catch (error) {
      uniqueErrors.push(`analysis: ${errorMessage(error)}`);
    }
  }
  const analysisComplete = complete && analysis !== null;
  const defaultMatrix = defaultPublicationPolicy(policy);
  let acceptanceEvaluation = null;
  if (analysisComplete) {
    try {
      acceptanceEvaluation = evaluateCompressedCacheAcceptance(rawSamples, {
        bootstrapIterations: policy.bootstrapIterations,
        seed: policy.seed + 10_000,
      });
    } catch (error) {
      uniqueErrors.push(`acceptance: ${errorMessage(error)}`);
    }
  }
  const finalComplete =
    analysisComplete && acceptanceEvaluation !== null && uniqueErrors.length === 0;
  const publishable = finalComplete && defaultMatrix && !source.dirty && !sourceAfter.dirty;
  const acceptanceEligible = publishable && acceptanceEvaluation !== null;
  const accepted = acceptanceEligible && acceptanceEvaluation.criteriaAccepted;
  const evidenceDigest = sha256(
    Buffer.from(
      canonicalJson({
        hostSamples,
        rawSamples,
        source,
        sourceAfter,
        workload,
        workloadAfter,
      }),
      'utf8',
    ),
  );
  return {
    acceptance: {
      accepted,
      eligible: acceptanceEligible,
      evaluation: acceptanceEvaluation,
    },
    analysis,
    environment: { host, hostSamples },
    evidenceDigest,
    generatedAt: new Date().toISOString(),
    integrity: {
      complete: finalComplete,
      defaultMatrix,
      errors: uniqueErrors,
      expectedRawSamples,
      observedRawSamples: rawSamples.length,
      publishable,
      serialized: true,
      sourceStable,
      totals,
      workloadStable,
    },
    policy,
    preparation,
    rawSamples,
    schema: COMPRESSED_CACHE_AB_SCHEMA,
    source,
    sourceAfter,
    verdict: {
      reasons: [
        ...uniqueErrors,
        ...(finalComplete && !defaultMatrix ? ['non-default matrix is smoke-only'] : []),
        ...(finalComplete && (source.dirty || sourceAfter.dirty)
          ? ['source provenance is dirty']
          : []),
        ...(acceptanceEligible && !accepted ? acceptanceEvaluation.reasons : []),
      ],
      status: acceptanceEligible
        ? accepted
          ? 'accepted'
          : 'rejected'
        : finalComplete
          ? 'smoke'
          : 'unproven',
    },
    workload,
    workloadAfter,
  };
}

export function compressedCacheWorkloadIdentity(policy, root = repoRoot) {
  const files = workloadFiles(root).map((relativePath) => {
    const bytes = readFileSync(path.join(root, relativePath));
    return { bytes: bytes.byteLength, path: relativePath, sha256: sha256(bytes) };
  });
  const identity = {
    adapterSchema: SERVER_BENCHMARK_SCHEMA,
    disableOnlySeam: {
      baseline: `${PROVED_DOCUMENT_COMPRESSION_CACHE_DISABLE_ENV}=1`,
      spike: `${PROVED_DOCUMENT_COMPRESSION_CACHE_DISABLE_ENV}=unset`,
    },
    files,
    policy,
    schema: 'kovo-compressed-cache-workload/v1',
  };
  return { ...identity, digest: sha256(Buffer.from(canonicalJson(identity), 'utf8')) };
}

function workloadFiles(root) {
  const files = new Set([
    'benchmarks/compare.mjs',
    'scripts/perf-compressed-cache-ab.mjs',
    'scripts/perf-server-benchmark.mjs',
    ...LOCK_FILES,
  ]);
  const benchmarkRoot = path.join(root, 'benchmarks/kovo');
  const pending = [benchmarkRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['.kovo', 'dist', 'node_modules'].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`workload input is a symlink: ${absolute}`);
      if (stat.isDirectory()) pending.push(absolute);
      else if (stat.isFile()) files.add(path.relative(root, absolute).split(path.sep).join('/'));
      else throw new Error(`workload input is not regular: ${absolute}`);
    }
  }
  return [...files].sort();
}

function validatePreparation(report, expected) {
  const findings = [];
  if (report?.schema !== SERVER_PREPARE_SCHEMA) findings.push('schema mismatch');
  if (report?.framework !== 'kovo') findings.push('framework mismatch');
  if (report?.integrity?.complete !== true) findings.push('integrity is incomplete');
  if (report?.integrity?.artifactsPresent !== true) findings.push('artifact is absent');
  if (report?.integrity?.sourceStable !== true) findings.push('source changed during build');
  if (!sameSourceState(report?.source, expected.source)) findings.push('source identity mismatch');
  if (!sameSourceState(report?.source, report?.sourceAfter))
    findings.push('reported source changed during build');
  if (report?.host?.digest !== expected.host.digest || !validHostFingerprint(report?.host))
    findings.push('host identity mismatch');
  return findings;
}

function validateCacheCell(report, expected) {
  const findings = [];
  const condition = report?.condition;
  const sample = report?.samples?.[0];
  const correctness = report?.correctness;
  if (report?.schema !== SERVER_BENCHMARK_SCHEMA) findings.push('schema mismatch');
  if (report?.framework !== 'kovo') findings.push('framework mismatch');
  if (condition?.key !== expected.condition.key) findings.push('condition key mismatch');
  for (const name of ['concurrency', 'encoding', 'mode', 'route', 'path']) {
    if (condition?.[name] !== expected.condition[name]) findings.push(`condition ${name} mismatch`);
  }
  if (report?.support?.status !== 'supported') findings.push('response is not timing-supported');
  if (
    report?.optimization?.provedDocumentCompressionCache !==
    (expected.arm === 'baseline' ? 'disabled' : 'enabled')
  ) {
    findings.push('cache arm posture mismatch');
  }
  if (
    report?.integrity?.complete !== true ||
    report?.integrity?.timingExcluded !== false ||
    report?.integrity?.misses !== 0 ||
    (report?.integrity?.errors?.length ?? -1) !== 0 ||
    (report?.verdict?.status !== 'measured' &&
      !(expected.allowDirty && report?.verdict?.status === 'unproven'))
  ) {
    findings.push('adapter integrity is incomplete');
  }
  if (
    report?.policy?.durationMs !== expected.durationMs ||
    report?.policy?.warmupMs !== expected.warmupMs
  ) {
    findings.push('timing policy mismatch');
  }
  if (report?.samples?.length !== 1 || sample === null || sample === undefined) {
    findings.push('raw sample is missing');
  } else {
    for (const metric of METRICS) {
      if (!Number.isFinite(sample[metric.name]) || sample[metric.name] < 0)
        findings.push(`sample ${metric.name} is invalid`);
    }
    if (
      sample.durationMs < expected.durationMs ||
      sample.failedRequests !== 0 ||
      sample.misses !== 0 ||
      !(sample.requests > 0) ||
      !(sample.reusedSockets > 0) ||
      !(sample.processTreeSamples > 0) ||
      !(sample.peakRssBytes > 0)
    ) {
      findings.push('request/CPU/RSS evidence is incomplete');
    }
  }
  const expectedStatus = expected.condition.mode === '304' ? 304 : 200;
  const expectedPad =
    expected.condition.encoding === 'br' && expected.condition.mode !== '304'
      ? 'required-fresh'
      : 'absent';
  const exactResponseHeaders = correctness?.exactResponseHeaders;
  if (
    correctness?.status !== expectedStatus ||
    correctness?.requestAcceptEncoding !== expected.condition.encoding ||
    correctness?.kovoPad !== expectedPad ||
    !/^sha256:[0-9a-f]{64}$/u.test(correctness?.bodySha256 ?? '') ||
    exactResponseHeaders === null ||
    typeof exactResponseHeaders !== 'object' ||
    Array.isArray(exactResponseHeaders) ||
    (expected.condition.encoding === 'identity' && correctness?.contentEncoding !== null) ||
    (expected.condition.encoding === 'br' &&
      expected.condition.mode !== '304' &&
      correctness?.contentEncoding !== 'br') ||
    (expected.condition.mode === '304' && correctness?.wireBodyBytes !== 0)
  ) {
    findings.push('wire correctness evidence is incomplete');
  }
  if (expected.condition.mode === 'dynamic') {
    const cacheControl = commaTokens(correctness?.cacheControl);
    if (!cacheControl.has('private') || !cacheControl.has('no-store'))
      findings.push('dynamic cache-control proof is incomplete');
  } else if (
    typeof correctness?.etag !== 'string' ||
    correctness.etag === '' ||
    correctness.etag.startsWith('W/')
  ) {
    findings.push('proved-document strong ETag is missing');
  }
  if (!sameSourceState(report?.source, expected.source)) findings.push('source identity mismatch');
  if (!sameSourceState(report?.source, report?.sourceAfter))
    findings.push('source changed during sample');
  if (
    report?.environment?.host?.digest !== expected.host.digest ||
    !validHostFingerprint(report?.environment?.host)
  ) {
    findings.push('host identity is invalid');
  }
  return [...new Set(findings)];
}

function cacheMatrixIntegrityFindings(rawSamples, conditions, schedule) {
  const findings = [];
  for (const condition of conditions) {
    const cells = rawSamples.filter((cell) => cell.condition.key === condition.key);
    if (cells.length !== schedule.length) {
      findings.push(`${condition.key}: serialized sample census is incomplete`);
      continue;
    }
    if (
      cells.map((cell) => cell.arm).join(',') !== schedule.map((entry) => entry.arm).join(',') ||
      cells.map((cell) => cell.occurrence).join(',') !==
        schedule.map((entry) => entry.occurrence).join(',') ||
      cells.some((cell, index) => cell.scheduleIndex !== index)
    ) {
      findings.push(`${condition.key}: serialized B,S,S,B order is invalid`);
    }
    const bodyDigests = new Set(cells.map((cell) => cell.report?.correctness?.bodySha256));
    const bodyBytes = new Set(cells.map((cell) => cell.report?.correctness?.bodyBytes));
    const contentTypes = new Set(cells.map((cell) => cell.report?.correctness?.contentType));
    if (
      bodyDigests.size !== 1 ||
      bodyBytes.size !== 1 ||
      contentTypes.size !== 1 ||
      [...bodyDigests][0] === undefined ||
      typeof [...contentTypes][0] !== 'string'
    ) {
      findings.push(`${condition.key}: baseline/spike identity representation differs`);
    }
  }
  return findings;
}

function compressedCachePolicy(options) {
  const policy = {
    allowDirty: options.allowDirty === true,
    bootstrapIterations: boundedInteger(
      options.bootstrapIterations ?? 10_000,
      100,
      1_000_000,
      'bootstrapIterations',
    ),
    concurrencies: options.concurrencies ?? SERVER_CONCURRENCIES,
    durationMs: boundedInteger(options.durationMs ?? DEFAULT_DURATION_MS, 25, 60_000, 'durationMs'),
    encodings: options.encodings ?? SERVER_ENCODINGS,
    hostSettleMaxMs: boundedInteger(
      options.hostSettleMaxMs ?? 30_000,
      0,
      300_000,
      'hostSettleMaxMs',
    ),
    hostSettlePollMs: boundedInteger(
      options.hostSettlePollMs ?? 1_000,
      10,
      60_000,
      'hostSettlePollMs',
    ),
    maxLoadPerCpu: finitePositive(
      options.maxLoadPerCpu ?? DEFAULT_MAX_LOAD_PER_CPU,
      'maxLoadPerCpu',
    ),
    modes: options.modes ?? SERVER_MODES,
    port: boundedInteger(options.port ?? 50_310, 1_024, 65_535, 'port'),
    routes: options.routes ?? SERVER_ROUTES,
    samplesPerArm: boundedInteger(options.samples ?? DEFAULT_SAMPLES, 1, 100, 'samples'),
    seed: boundedInteger(options.seed ?? 0x4b4f564f, 0, 0xffff_ffff, 'seed'),
    warmupMs: boundedInteger(options.warmupMs ?? DEFAULT_WARMUP_MS, 25, 60_000, 'warmupMs'),
  };
  // serverConditions owns exact vocabulary and duplicate rejection for all four dimensions.
  serverConditions(policy);
  return policy;
}

function defaultPublicationPolicy(policy) {
  return (
    policy.durationMs === DEFAULT_DURATION_MS &&
    policy.hostSettleMaxMs === 30_000 &&
    policy.hostSettlePollMs === 1_000 &&
    policy.warmupMs === DEFAULT_WARMUP_MS &&
    policy.samplesPerArm === DEFAULT_SAMPLES &&
    sameArray(policy.concurrencies, SERVER_CONCURRENCIES) &&
    sameArray(policy.encodings, SERVER_ENCODINGS) &&
    sameArray(policy.modes, SERVER_MODES) &&
    sameArray(policy.routes, SERVER_ROUTES)
  );
}

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameSourceState(left, right) {
  return (
    left?.commit === right?.commit &&
    JSON.stringify(left?.dirtyPaths) === JSON.stringify(right?.dirtyPaths) &&
    JSON.stringify(left?.locks) === JSON.stringify(right?.locks)
  );
}

function validHostFingerprint(host) {
  return validPerformanceHostFingerprint(host);
}

function hostObservation() {
  const cpuCount = os.cpus().length;
  const loadAverage = os.loadavg();
  return {
    at: new Date().toISOString(),
    cpuCount,
    loadAverage,
    loadPerCpu: loadAverage[0] / cpuCount,
  };
}

async function executeServerAdapter({ args, cwd, env, outputPath }) {
  const result = await spawnCaptured(
    process.execPath,
    [serverAdapterPath, ...args, '--out', outputPath],
    {
      cwd,
      env,
    },
  );
  let report = null;
  if (existsSync(outputPath)) {
    try {
      report = JSON.parse(await readFile(outputPath, 'utf8'));
    } catch (error) {
      return { processError: `invalid adapter report: ${errorMessage(error)}`, report: null };
    }
  }
  const processError =
    result.code === 0 && result.signal === null
      ? null
      : result.error ||
        result.stderr.trim() ||
        `adapter exited ${String(result.code)} (${String(result.signal)})`;
  return { processError, report };
}

function spawnCaptured(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: process.platform !== 'win32',
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let error = null;
    const append = (current, chunk) => `${current}${String(chunk)}`.slice(-MAX_CAPTURE_BYTES);
    child.stdout.on('data', (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.once('error', (caught) => {
      error = errorMessage(caught);
    });
    const forward = () => {
      if (!Number.isSafeInteger(child.pid) || child.pid <= 0) return;
      try {
        if (process.platform === 'win32') child.kill('SIGTERM');
        else process.kill(-child.pid, 'SIGTERM');
      } catch (caught) {
        if (caught?.code !== 'ESRCH') error = errorMessage(caught);
      }
    };
    process.once('SIGINT', forward);
    process.once('SIGTERM', forward);
    child.once('close', (code, signal) => {
      process.removeListener('SIGINT', forward);
      process.removeListener('SIGTERM', forward);
      resolve({ code, error, signal, stderr, stdout });
    });
  });
}

function commaTokens(value) {
  return new Set(
    String(value)
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  );
}

function boundedInteger(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} must be an integer between ${String(min)} and ${String(max)}`);
  }
  return value;
}

function finitePositive(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be finite and positive`);
  }
  return value;
}

function finiteNonNegative(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be finite and non-negative`);
  }
  return value;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--allow-dirty') options.allowDirty = true;
    else if (argument === '--bootstrap-iterations')
      options.bootstrapIterations = Number(argv[++index]);
    else if (argument === '--concurrencies')
      options.concurrencies = argv[++index].split(',').map(Number);
    else if (argument === '--duration-ms') options.durationMs = Number(argv[++index]);
    else if (argument === '--encodings') options.encodings = argv[++index].split(',');
    else if (argument === '--host-settle-max-ms') options.hostSettleMaxMs = Number(argv[++index]);
    else if (argument === '--host-settle-poll-ms') options.hostSettlePollMs = Number(argv[++index]);
    else if (argument === '--max-load-per-cpu') options.maxLoadPerCpu = Number(argv[++index]);
    else if (argument === '--modes')
      options.modes = argv[++index]
        .split(',')
        .map((mode) => (mode.toLowerCase() === 'hit' ? 'HIT' : mode.toLowerCase()));
    else if (argument === '--out') options.output = argv[++index];
    else if (argument === '--port') options.port = Number(argv[++index]);
    else if (argument === '--routes') options.routes = argv[++index].split(',');
    else if (argument === '--samples') options.samples = Number(argv[++index]);
    else if (argument === '--seed') options.seed = Number(argv[++index]);
    else if (argument === '--warmup-ms') options.warmupMs = Number(argv[++index]);
    else if (argument === '--help') options.help = true;
    else throw new TypeError(`unknown argument ${String(argument)}`);
  }
  return options;
}

function usage() {
  return [
    'Usage: node scripts/perf-compressed-cache-ab.mjs --out <report.json> [options]',
    '',
    'Defaults: 7 samples/arm, 5000ms warmup, 15000ms measurement, c=1,8,32,',
    'listing/detail, identity/br, HIT/304/dynamic, max load/CPU 0.75.',
    'Residual load settles for at most 30000ms, sampled every 1000ms.',
    '',
    'baseline: KOVO_BENCHMARK_DISABLE_PROVED_DOCUMENT_COMPRESSION_CACHE=1',
    'spike:    the disable-only variable is removed',
    '',
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage());
    } else {
      if (typeof options.output !== 'string' || options.output === '') {
        throw new TypeError('--out is required');
      }
      const report = await runCompressedCacheAb(options);
      const outputPath = path.resolve(options.output);
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
      process.stdout.write(
        `${COMPRESSED_CACHE_AB_SCHEMA} ${report.verdict.status} ${outputPath}\n`,
      );
      if (report.integrity.complete !== true) process.exitCode = 2;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n${usage()}`);
    process.exitCode = 2;
  }
}
