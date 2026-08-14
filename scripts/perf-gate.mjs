#!/usr/bin/env node
/**
 * Kovo perf gate — the REALISTIC budget tier (plans/good-perf.md O17, decision D13).
 *
 * Two tiers exist deliberately:
 *
 *  - Tier 1 `devex-budgets.json` / `scripts/devex-benchmark.mjs`: the cheap per-PR signal. It is
 *    calibrated on a 4-file / 56-LOC / 1-route packed workload, pins ubuntu-24.04 x64, and demands
 *    `KOVO_DEVEX_OS_IMAGE` + `KOVO_DEVEX_RUNNER_NAME` plus a clean git tree. That makes it cheap,
 *    reproducible and unrunnable anywhere else — nothing that scales with app size is visible in it.
 *  - Tier 2 (this script + `perf-budgets.json`): a workload whose module count is a parameter, run
 *    on whatever host you have, ALLOWED TO FAIL LOUDLY. No runner pinning, no clean-tree demand, no
 *    ratification ceremony. It is not a release gate; it is the instrument that would have caught
 *    the quadratic `kovo check` term and the KV448 import wall before they shipped.
 *
 * Honesty rules this script enforces on itself:
 *  - Byte metrics are deterministic and are gated hard.
 *  - Wall-clock metrics are recorded WITH the observed 1-minute load average and are only gated when
 *    that load is at or below the budget's `maxLoadAverage`. Above it the metric reports
 *    `unproven` and the run does not fail on it — a contended box produces numbers that look like
 *    regressions and are not (plans/good-perf.md "Latest verification").
 *  - The scaling-exponent metric is a RATIO across rungs of the same ladder in the same session, so
 *    it survives contention far better than any absolute duration, and is gated unconditionally.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { measureProcessTreeCommand } from './lib/process-tree-rss.mjs';
import { executionIdentityFindings, performanceExecutionIdentity } from './lib/perf-execution.mjs';
import { canonicalJson, performanceHostFingerprint } from './lib/perf-host.mjs';
import { collectPerformanceProvenance } from './lib/perf-provenance.mjs';
import { materializePerfWorkload, perfWorkloadEditedComponent } from './perf-workload.mjs';

export const PERF_REPORT_SCHEMA = 'kovo-perf-report/v1';
export const PERF_BUDGETS_SCHEMA = 'kovo-perf-budgets/v1';
export const PERF_GATE_WORKLOAD_SCHEMA = 'kovo-performance-workload-identity/v1';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CHECK_CENSUS_SCHEMA = 'kovo-check-phase-census/v1';
const CHECK_CENSUS_INCOMPLETE_SCHEMA = 'kovo-check-phase-census-incomplete/v1';
const DEFAULT_HOST_SETTLE_MAX_MS = 30_000;
const DEFAULT_HOST_SETTLE_POLL_MS = 1_000;
const MAX_HOST_SETTLE_MAX_MS = 60_000;

// ---------------------------------------------------------------------------------------------
// Pure helpers (exported for scripts/perf-gate.test.mjs)
// ---------------------------------------------------------------------------------------------

export function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function medianAbsoluteDeviation(values) {
  if (values.length === 0) return 0;
  const centre = median(values);
  return median(values.map((value) => Math.abs(value - centre)));
}

/**
 * Ordinary-least-squares slope of log(y) against log(x) over every rung.
 *
 * Kept as a DIAGNOSTIC, not as the gated statistic. Measured 2026-08-08 over the 8/24/72/216 ladder,
 * this fit reports ~0.51 for the `app-source-trust` phase — not because growth is sublinear, but
 * because the ladder mixes two regimes: a ~5 s fixed cost that dominates at N=8 (8->24 triples N and
 * costs 1.19x) and the asymptotic regime at the top (72->216 triples N and costs 3.14x, i.e.
 * linear). Averaging those together produces a number that is neither, and whose distance from 1.0
 * depends mostly on where the ladder starts. `marginalLogLogExponent` is the gated statistic.
 */
export function fitLogLogExponent(points) {
  const usable = points.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x > 0 && point.y > 0,
  );
  if (usable.length < 2) return null;
  const xs = usable.map((point) => Math.log(point.x));
  const ys = usable.map((point) => Math.log(point.y));
  const meanX = xs.reduce((total, value) => total + value, 0) / xs.length;
  const meanY = ys.reduce((total, value) => total + value, 0) / ys.length;
  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < xs.length; index += 1) {
    covariance += (xs[index] - meanX) * (ys[index] - meanY);
    variance += (xs[index] - meanX) ** 2;
  }
  if (variance === 0) return null;
  return covariance / variance;
}

/**
 * Local growth exponent between the two LARGEST rungs: `ln(y2/y1) / ln(x2/x1)`.
 *
 * This is the statistic the check-scaling gate compares against its budget, because it is the only
 * one that answers the question the gate exists to ask. Linear growth gives exactly 1.0 and
 * quadratic gives exactly 2.0 REGARDLESS of how large the run's fixed cost is — a fixed cost only
 * pulls the value below 1.0, never above it. The whole-ladder OLS fit does not have that property:
 * a large fixed cost at the bottom rung drags it far below 1.0 and leaves room for a real quadratic
 * term to hide underneath a sublinear-looking average (plans/good-perf.md O7 took check from
 * quadratic to linear; this is the statistic that notices if it goes back).
 */
export function marginalLogLogExponent(points) {
  const usable = points
    .filter(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x > 0 && point.y > 0,
    )
    .sort((left, right) => left.x - right.x);
  if (usable.length < 2) return null;
  const lower = usable[usable.length - 2];
  const upper = usable[usable.length - 1];
  if (upper.x === lower.x) return null;
  return Math.log(upper.y / lower.y) / Math.log(upper.x / lower.x);
}

/** Parse either census schema out of a `kovo check` transcript. */
export function parseCheckPhaseCensus(output) {
  for (const line of String(output).split(/\r?\n/u)) {
    for (const schema of [CHECK_CENSUS_SCHEMA, CHECK_CENSUS_INCOMPLETE_SCHEMA]) {
      const prefix = `${schema} `;
      if (!line.startsWith(prefix)) continue;
      const parsed = JSON.parse(line.slice(prefix.length));
      return { complete: schema === CHECK_CENSUS_SCHEMA, evidence: parsed, schema };
    }
  }
  return null;
}

export function phaseDurationMs(census, name) {
  const phase = census?.evidence?.phases?.find((candidate) => candidate.name === name);
  if (phase !== undefined) return phase.durationMs;
  if (census?.evidence?.failedPhase?.name === name) return census.evidence.failedPhase.elapsedMs;
  return null;
}

/**
 * Compare one observation against one budget entry.
 *
 * Returns `{ status: 'pass' | 'fail' | 'unproven' | 'unbudgeted', ... }`. `unproven` is a
 * first-class outcome: a wall-clock budget evaluated above its load ceiling has not been tested,
 * and saying so is the whole point of this tier.
 */
export function evaluateMetric(budget, observation) {
  if (budget === undefined || budget === null) {
    return { reason: 'no budget entry', status: 'unbudgeted' };
  }
  if (budget.max === null || budget.max === undefined) {
    return { reason: budget.rationale ?? 'budget not yet measured', status: 'unbudgeted' };
  }
  if (observation === undefined || observation === null || !Number.isFinite(observation.value)) {
    return { reason: 'suite produced no value', status: 'unproven' };
  }
  if (
    budget.loadSensitive === true &&
    Number.isFinite(budget.maxLoadAverage) &&
    Number.isFinite(observation.loadAverage) &&
    observation.loadAverage > budget.maxLoadAverage
  ) {
    return {
      reason: `observed 1-minute load ${observation.loadAverage.toFixed(2)} exceeds the ${String(
        budget.maxLoadAverage,
      )} ceiling this budget was measured under; wall clock is not evidence here`,
      status: 'unproven',
      value: observation.value,
    };
  }
  return {
    budget: budget.max,
    status: observation.value <= budget.max ? 'pass' : 'fail',
    value: observation.value,
  };
}

export function evaluateReport(budgets, report) {
  const results = [];
  for (const [metricId, observation] of Object.entries(report.metrics ?? {})) {
    results.push({ metricId, ...evaluateMetric(budgets.metrics?.[metricId], observation) });
  }
  results.sort((left, right) => left.metricId.localeCompare(right.metricId));
  return results;
}

/**
 * Normalize either accepted file shape into a list of suite reports.
 *
 * A single suite run has `metrics` at the top level; the committed baseline bundles several under
 * `suites`. Anything else THROWS rather than evaluating zero metrics, because "0 failed, 0 total"
 * is indistinguishable from a pass at a glance and this tier exists to stop exactly that kind of
 * silent green.
 */
export function reportSuites(report, label) {
  if (Array.isArray(report?.suites)) {
    if (report.suites.length === 0) throw new Error(`${label} contains no suite reports`);
    return report.suites;
  }
  if (report?.metrics !== undefined && report.metrics !== null) return [report];
  throw new Error(
    `${label} is not a perf report: expected a top-level 'metrics' object or a 'suites' array`,
  );
}

export function formatEvaluation(results) {
  const lines = [];
  for (const result of results) {
    const value = Number.isFinite(result.value) ? result.value.toFixed(2) : 'n/a';
    const budget = Number.isFinite(result.budget) ? result.budget.toFixed(2) : 'n/a';
    lines.push(
      `${result.status.toUpperCase().padEnd(10)} ${result.metricId} value=${value} budget=${budget}${
        result.reason === undefined ? '' : ` (${result.reason})`
      }`,
    );
  }
  const failed = results.filter((result) => result.status === 'fail').length;
  const unproven = results.filter((result) => result.status === 'unproven').length;
  lines.push(
    `${String(failed)} failed, ${String(unproven)} unproven, ${String(results.length)} total`,
  );
  return `${lines.join('\n')}\n`;
}

export function parsePositiveIntegerOption(
  name,
  raw,
  fallback,
  { max = Number.MAX_SAFE_INTEGER, min = 1 } = {},
) {
  if (raw === undefined) return fallback;
  if (raw === true) throw new Error(`--${name} requires an integer value`);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `--${name} must be an integer between ${String(min)} and ${String(max)}, got ${JSON.stringify(String(raw))}`,
    );
  }
  return value;
}

export function parseLadderOption(raw = '8,24,72,216') {
  if (raw === true) throw new Error('--ladder requires a comma-separated integer value');
  const values = String(raw)
    .split(',')
    .map((value) => value.trim())
    .map((value) => Number(value));
  if (
    values.length < 2 ||
    values.some((value) => !Number.isInteger(value) || value < 1) ||
    new Set(values).size !== values.length
  ) {
    throw new Error(
      `--ladder must contain at least two distinct positive integers, got ${JSON.stringify(String(raw))}`,
    );
  }
  return values;
}

export function wireResponseIntegrityProblems(
  label,
  response,
  { allowedContentEncodings, contentTypePrefix, status = 200 } = {},
) {
  const problems = [];
  if (response?.status !== status) {
    problems.push(
      `${label}: expected HTTP ${String(status)}, received ${String(response?.status)}`,
    );
  }
  if (!Number.isFinite(response?.wireBytes) || response.wireBytes <= 0) {
    problems.push(`${label}: response body carried no wire bytes`);
  }
  if (
    contentTypePrefix !== undefined &&
    !String(response?.headers?.['content-type'] ?? '').startsWith(contentTypePrefix)
  ) {
    problems.push(
      `${label}: expected Content-Type ${contentTypePrefix}..., received ${String(response?.headers?.['content-type'] ?? 'missing')}`,
    );
  }
  if (
    allowedContentEncodings !== undefined &&
    !allowedContentEncodings.includes(response?.contentEncoding)
  ) {
    problems.push(
      `${label}: expected Content-Encoding ${allowedContentEncodings.map(String).join(' or ')}, received ${String(response?.contentEncoding ?? 'identity')}`,
    );
  }
  return problems;
}

export function loadGenerationIntegrityProblems(label, result) {
  const problems = [];
  if ((result?.completed ?? 0) === 0) problems.push(`${label}: completed zero responses`);
  if ((result?.requestErrors ?? 0) > 0) {
    problems.push(`${label}: ${String(result.requestErrors)} requests failed before a response`);
  }
  if ((result?.responseErrors ?? 0) > 0) {
    problems.push(`${label}: ${String(result.responseErrors)} response streams failed`);
  }
  for (const [status, count] of Object.entries(result?.statusCounts ?? {})) {
    if (status !== '200' && count > 0) {
      problems.push(`${label}: ${String(count)} responses returned HTTP ${status}`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Process plumbing
// ---------------------------------------------------------------------------------------------

function observedLoadAverage() {
  return loadavg()[0];
}

/**
 * One bounded quiet-host budget for an entire suite. The first admission is explicitly before
 * benchmark work; after `markBenchmarkWork()` timed admissions are labeled as post-benchmark
 * settling. `observe()` records the final load tail as a non-gating diagnostic because that tail
 * cannot establish contention before an already-completed timed rung.
 */
export function createPerformanceGateHostAdmission({
  ceiling = 1,
  maxWaitMs = DEFAULT_HOST_SETTLE_MAX_MS,
  pollMs = DEFAULT_HOST_SETTLE_POLL_MS,
  readLoad = () => ({ loadAverage: loadavg(), logicalCpuCount: cpus().length }),
  timestamp = () => new Date().toISOString(),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  assertPerformanceGateHostPolicy({ ceiling, maxWaitMs, pollMs });
  const budget = { remainingWaitMs: maxWaitMs, totalWaitedMs: 0 };
  let benchmarkWorkStarted = false;
  async function sample(context, { gatesTiming }) {
    if (
      typeof context !== 'string' ||
      context.length === 0 ||
      context.length > 512 ||
      context.includes('\r') ||
      context.includes('\n') ||
      context.includes('\0')
    ) {
      throw new TypeError('quiet-host context is invalid');
    }
    const availableWaitMs = gatesTiming ? budget.remainingWaitMs : 0;
    const observations = [];
    let attempt = 0;
    let waitedMs = 0;
    while (true) {
      const observed = readLoad();
      const loadAverage = observed.loadAverage;
      const logicalCpuCount = observed.logicalCpuCount;
      const loadPerCpu =
        Array.isArray(loadAverage) &&
        Number.isFinite(loadAverage[0]) &&
        Number.isSafeInteger(logicalCpuCount) &&
        logicalCpuCount > 0
          ? loadAverage[0] / logicalCpuCount
          : null;
      const observation = {
        at: timestamp(),
        attempt,
        context,
        gatesTiming,
        loadAverage,
        loadPerCpu,
        logicalCpuCount,
        phase: gatesTiming
          ? benchmarkWorkStarted
            ? 'quiet-host-settle'
            : 'quiet-host-admission'
          : 'host-diagnostic',
        posture: gatesTiming
          ? benchmarkWorkStarted
            ? 'post-benchmark'
            : 'pre-benchmark'
          : 'post-timing',
        waitedMs,
      };
      observations.push(observation);
      const comparable = Number.isFinite(loadPerCpu) && loadPerCpu >= 0 && loadPerCpu <= ceiling;
      if (comparable || !gatesTiming || waitedMs >= availableWaitMs) {
        return {
          ...observation,
          ceiling,
          comparable,
          settle: {
            maxWaitMs: availableWaitMs,
            observations,
            pollMs,
            rejectedObservations: observations.filter(
              (entry) =>
                !Number.isFinite(entry.loadPerCpu) ||
                entry.loadPerCpu < 0 ||
                entry.loadPerCpu > ceiling,
            ).length,
            totalBudgetRemainingMs: budget.remainingWaitMs,
            waitedMs,
          },
        };
      }
      const waitMs = Math.min(pollMs, availableWaitMs - waitedMs);
      await wait(waitMs);
      waitedMs += waitMs;
      budget.remainingWaitMs = Math.max(0, budget.remainingWaitMs - waitMs);
      budget.totalWaitedMs += waitMs;
      attempt += 1;
    }
  }
  return {
    admit(context) {
      return sample(context, { gatesTiming: true });
    },
    markBenchmarkWork() {
      benchmarkWorkStarted = true;
    },
    observe(context) {
      return sample(context, { gatesTiming: false });
    },
    policy() {
      return {
        ceiling,
        maxTotalWaitMs: maxWaitMs,
        pollMs,
        remainingWaitMs: budget.remainingWaitMs,
        totalWaitedMs: budget.totalWaitedMs,
      };
    },
  };
}

function assertPerformanceGateHostPolicy({ ceiling, maxWaitMs, pollMs }) {
  if (!Number.isFinite(ceiling) || ceiling <= 0) throw new TypeError('host ceiling is invalid');
  if (!Number.isSafeInteger(maxWaitMs) || maxWaitMs < 0 || maxWaitMs > MAX_HOST_SETTLE_MAX_MS) {
    throw new TypeError(
      `quiet-host total settle max must be between 0 and ${String(MAX_HOST_SETTLE_MAX_MS)}ms`,
    );
  }
  if (!Number.isSafeInteger(pollMs) || pollMs < 10 || pollMs > 60_000) {
    throw new TypeError('quiet-host settle poll must be between 10 and 60000ms');
  }
}

function quietHostFailure(sample) {
  const observed = Number.isFinite(sample.loadPerCpu)
    ? sample.loadPerCpu.toFixed(3)
    : 'unavailable';
  return `${sample.posture} host load ${observed} per CPU exceeded ceiling ${String(
    sample.ceiling,
  )} after bounded ${String(sample.settle?.waitedMs ?? 0)}ms quiet-host admission`;
}

function kovoCliArgv(args) {
  return [
    '--disable-warning=ExperimentalWarning',
    '--experimental-transform-types',
    path.join(repoRoot, 'packages/cli/src/bin.ts'),
    ...args,
  ];
}

/**
 * Profiling environment for a SPAWNED command tree.
 *
 * `--cpu-prof` passed through `NODE_OPTIONS` is inherited by every descendant process, which is the
 * only way to see the `app-source-trust` trust worker: it runs in a spawned process the parent
 * profiler cannot observe (plans/good-perf.md O17). Each process writes its own `.cpuprofile` into
 * the shared directory. Verified 2026-08-08 on the N=8 workload: one `kovo check` produced SIX
 * profiles, and `--profile-summary` attributes them apart — the parent is `child_process`-dominated
 * and reports the trust work as nothing, while a separate process shows `typescript.js` at 1,274
 * self-hits and another shows `_tsc.js` at 1,532. A parent-only profiler scores both as zero.
 *
 * For `kovo dev` this is the WRONG tool, though not for the reason plans/good-perf.md records.
 * Measured at this HEAD: SIGINT does flush, producing ONE profile (SIGKILL produces zero) — the
 * ledger's "zero .cpuprofile files" no longer reproduces. The problem is what that profile contains:
 * its window is the whole session (11,825 ms over 10,011 samples in the probe), so the edit is
 * buried under cold-start analysis, which is exactly the confusion an edit-cost measurement must
 * avoid. The dev suite therefore uses CDP `Profiler.start`/`Profiler.stop`, which brackets the exact
 * edit -> served window.
 */
function profilingEnv(options) {
  const flags = [];
  if (options.cpuProfDir !== undefined) {
    mkdirSync(options.cpuProfDir, { recursive: true });
    flags.push('--cpu-prof', `--cpu-prof-dir=${options.cpuProfDir}`);
  }
  if (options.heapProfDir !== undefined) {
    mkdirSync(options.heapProfDir, { recursive: true });
    flags.push('--heap-prof', `--heap-prof-dir=${options.heapProfDir}`);
  }
  if (flags.length === 0) return {};
  return {
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} ${flags.join(' ')}`.trim(),
  };
}

function profileCensus(directory) {
  if (directory === undefined || !existsSync(directory)) return null;
  const files = readdirSync(directory).filter(
    (name) => name.endsWith('.cpuprofile') || name.endsWith('.heapprofile'),
  );
  return { directory, fileCount: files.length, files: files.slice(0, 64).sort() };
}

// ---------------------------------------------------------------------------------------------
// Suite: check-scaling
// ---------------------------------------------------------------------------------------------

/**
 * Run `kovo check` over a component-count ladder and fit the growth exponent of the phase that was
 * quadratic before O7 (`app-source-trust`), using the phase census the CLI now publishes on BOTH the
 * success and the failure path.
 */
export async function runCheckScalingSuite(options) {
  const rungs = [];
  const quietHost = createPerformanceGateHostAdmission({
    ceiling: options.maxLoadPerCpu ?? 1,
    maxWaitMs: options.hostSettleMaxMs ?? DEFAULT_HOST_SETTLE_MAX_MS,
    pollMs: options.hostSettlePollMs ?? DEFAULT_HOST_SETTLE_POLL_MS,
  });
  const hostAdmission = {
    initial: await quietHost.admit('check-scaling/suite-start'),
    policy: quietHost.policy(),
    suiteComplete: null,
  };
  let admissionError = hostAdmission.initial.comparable
    ? null
    : quietHostFailure(hostAdmission.initial);

  rungLoop: for (const componentCount of options.ladder) {
    if (admissionError !== null) break;
    const root = path.join(repoRoot, `.tmp-kovo-perf-scaling-${String(componentCount)}`);
    const samples = [];
    try {
      quietHost.markBenchmarkWork();
      const workload = materializePerfWorkload({ componentCount, repoRoot, root });
      for (let sample = 0; sample < options.samples; sample += 1) {
        const admission = await quietHost.admit(
          `check-scaling/N=${String(componentCount)}/sample=${String(sample)}`,
        );
        if (!admission.comparable) {
          admissionError = quietHostFailure(admission);
          break;
        }
        const measured = measureProcessTreeCommand(
          [process.execPath, ...kovoCliArgv(['check', '--no-cache'])],
          {
            cwd: workload.root,
            env: {
              KOVO_DEVEX_CHECK_PHASE_CENSUS_SOURCE: 'src/app.tsx',
              ...profilingEnv(options),
            },
            sampleIntervalMs: 50,
            timeoutMs: options.timeoutMs,
          },
        );
        const census = parseCheckPhaseCensus(`${measured.stdout}\n${measured.stderr}`);
        samples.push({
          appSourceTrustMs: phaseDurationMs(census, 'app-source-trust'),
          censusComplete: census?.complete ?? false,
          durationMs: measured.durationMs,
          exitCode: measured.exitCode,
          hostAdmission: admission,
          loadAverage: admission.loadAverage[0],
          peakRssBytes: measured.peakRssBytes,
          phases: census?.evidence?.phases ?? [],
        });
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
    const trustSamples = samples.map((sample) => sample.appSourceTrustMs).filter(Number.isFinite);
    rungs.push({
      appSourceTrustMedianMs: trustSamples.length === 0 ? null : median(trustSamples),
      componentCount,
      durationMedianMs:
        samples.length === 0 ? null : median(samples.map((sample) => sample.durationMs ?? 0)),
      peakRssBytes:
        samples.length === 0
          ? null
          : Math.max(...samples.map((sample) => sample.peakRssBytes ?? 0)),
      samples,
    });
    if (admissionError !== null) break rungLoop;
  }

  // This observation is after every timed rung. It describes the suite's own load tail and cannot
  // retroactively establish pre-existing contention, so retain it without gating the ladder.
  hostAdmission.suiteComplete = await quietHost.observe('check-scaling/suite-complete');
  hostAdmission.policy = quietHost.policy();

  // Rung integrity gates the whole suite. A rung whose `kovo check` exited non-zero, or whose phase
  // census came back incomplete, did not measure the thing these metrics claim to measure — and a
  // KV448-class refusal is exactly the regression that would produce one. Reporting a scaling
  // exponent computed over a broken ladder is worse than reporting nothing, because it reads green.
  const brokenRungs = rungs.flatMap((rung) =>
    rung.samples
      .filter((sample) => sample.exitCode !== 0 || sample.censusComplete !== true)
      .map(
        (sample) =>
          `N=${String(rung.componentCount)} (exit ${String(sample.exitCode)}, census ${
            sample.censusComplete === true ? 'complete' : 'incomplete'
          })`,
      ),
  );
  const incompleteLadder =
    rungs.length !== options.ladder.length ||
    rungs.some((rung) => rung.samples.length !== options.samples);
  if (admissionError !== null || brokenRungs.length > 0 || incompleteLadder) {
    const reasons = [];
    if (admissionError !== null) reasons.push(admissionError);
    if (incompleteLadder) reasons.push('quiet-host admission prevented the complete ladder');
    if (brokenRungs.length > 0) {
      reasons.push(`check-scaling ladder did not complete cleanly: ${brokenRungs.join('; ')}`);
    }
    return {
      detail: { rungs },
      error: reasons.join('; '),
      hostAdmission,
      profiles: {
        cpu: profileCensus(options.cpuProfDir),
        heap: profileCensus(options.heapProfDir),
      },
      suite: 'check-scaling',
    };
  }

  const trustPoints = rungs.map((rung) => ({
    x: rung.componentCount,
    y: rung.appSourceTrustMedianMs,
  }));
  const totalPoints = rungs.map((rung) => ({ x: rung.componentCount, y: rung.durationMedianMs }));
  const loads = rungs.flatMap((rung) => rung.samples.map((sample) => sample.loadAverage));

  return {
    detail: {
      // Reported, not gated: see fitLogLogExponent's note on why the whole-ladder average is a
      // regime mixture rather than a growth exponent.
      wholeLadderOlsExponent: {
        appSourceTrust: fitLogLogExponent(trustPoints),
        total: fitLogLogExponent(totalPoints),
      },
      rungs,
    },
    metrics: {
      'check.appSourceTrust.marginalScalingExponent': {
        value: marginalLogLogExponent(trustPoints),
      },
      'check.peakRssBytes': {
        loadAverage: median(loads),
        value: Math.max(...rungs.map((rung) => rung.peakRssBytes)),
      },
      'check.total.marginalScalingExponent': { value: marginalLogLogExponent(totalPoints) },
    },
    profiles: {
      cpu: profileCensus(options.cpuProfDir),
      heap: profileCensus(options.heapProfDir),
    },
    hostAdmission,
    suite: 'check-scaling',
  };
}

// ---------------------------------------------------------------------------------------------
// Suite: bytes (critical path, per-navigation, inline bootstrap)
// ---------------------------------------------------------------------------------------------

/**
 * Count the bytes that actually crossed the socket.
 *
 * `fetch`/undici transparently decompresses the body while leaving `content-encoding` on the
 * response, so `(await response.arrayBuffer()).byteLength` is the DECOMPRESSED size and reports a
 * compressed document as if compression were off. Every byte figure in plans/good-perf.md is a wire
 * figure, so this probe reads the raw response stream through `node:http`, which does not decode.
 */
async function fetchWire(url, headers) {
  const http = await import('node:http');
  return new Promise((resolve, reject) => {
    const request = http.get(url, { headers }, (response) => {
      const chunks = [];
      let wireBytes = 0;
      response.on('data', (chunk) => {
        wireBytes += chunk.byteLength;
        chunks.push(chunk);
      });
      response.on('end', () => {
        const contentEncoding = response.headers['content-encoding'] ?? null;
        resolve({
          contentEncoding,
          headers: response.headers,
          status: response.statusCode,
          text: contentEncoding === null ? Buffer.concat(chunks).toString('utf8') : null,
          wireBytes,
        });
      });
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}

function startBuiltServer(distDir, port) {
  const child = spawn(process.execPath, [path.join(distDir, 'server/server.mjs')], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      // Production posture, not development posture: plans/good-perf.md O15 records that every
      // prior Kovo benchmark ran the dev artifact against Next.js production standalone. The three
      // secrets below are what `dist/server/server.mjs` demands before it will serve at all
      // (attestation at boot, live-target attestation at first interactive render).
      KOVO_ATTESTATION_DEPLOYMENT_ID: 'perf-gate-deployment',
      KOVO_ATTESTATION_SECRET: 'perf-gate-secret-0123456789abcdef0123456789abcdef',
      KOVO_LIVE_TARGET_SECRET: 'perf-gate-live-target-0123456789abcdef0123456789abcdef',
      NODE_ENV: 'production',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => {
    log += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    log += String(chunk);
  });
  return { child, readLog: () => log };
}

async function waitForServer(url, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    try {
      const response = await fetch(url, { headers: { 'accept-encoding': 'identity' } });
      if (response.status < 500) {
        await response.arrayBuffer();
        return true;
      }
    } catch {
      // The artifact has not bound the port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

export async function runBytesSuite(options) {
  const root = path.join(repoRoot, '.tmp-kovo-perf-bytes');
  const workload = materializePerfWorkload({
    componentCount: options.componentCount,
    repoRoot,
    root,
  });
  const port = options.port;
  const origin = `http://127.0.0.1:${String(port)}`;
  let server;
  try {
    const build = measureProcessTreeCommand(
      [process.execPath, ...kovoCliArgv(['build', './src/app.tsx', '--out', './dist'])],
      { cwd: workload.root, env: profilingEnv(options), timeoutMs: options.timeoutMs },
    );
    if (build.exitCode !== 0) {
      return {
        detail: { buildLog: `${build.stdout}\n${build.stderr}`.slice(-8000) },
        error: `kovo build exited ${String(build.exitCode)}`,
        metrics: {},
        suite: 'bytes',
      };
    }

    server = startBuiltServer(path.join(workload.root, 'dist'), port);
    if (!(await waitForServer(origin, 60_000))) {
      return {
        detail: { serverLog: server.readLog().slice(-8000) },
        error: 'built artifact did not answer within 60s',
        metrics: {},
        suite: 'bytes',
      };
    }

    const compressed = { 'accept-encoding': 'br, gzip' };
    const document = await fetchWire(origin + '/', compressed);
    const identity = await fetchWire(origin + '/', { 'accept-encoding': 'identity' });
    const integrityProblems = [
      ...wireResponseIntegrityProblems('compressed document', document, {
        allowedContentEncodings: ['br', 'gzip'],
        contentTypePrefix: 'text/html',
      }),
      ...wireResponseIntegrityProblems('identity document', identity, {
        allowedContentEncodings: [null],
        contentTypePrefix: 'text/html',
      }),
    ];

    // Render-blocking closure: the document plus every stylesheet it links. Scripts are deferred by
    // construction in Kovo, so they are not on the critical path; a <link rel=stylesheet> is.
    const stylesheetHrefs = [
      ...(identity.text ?? '').matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/gu),
    ].map((match) => match[1]);
    if (stylesheetHrefs.length === 0) {
      integrityProblems.push(
        "identity document linked no stylesheets; the critical-path metric would pass by omitting the workload's required CSS",
      );
    }
    let stylesheetWireBytes = 0;
    for (const href of stylesheetHrefs) {
      const asset = await fetchWire(new URL(href, origin).toString(), compressed);
      integrityProblems.push(
        ...wireResponseIntegrityProblems(`stylesheet ${href}`, asset, {
          allowedContentEncodings: ['br', 'gzip'],
          contentTypePrefix: 'text/css',
        }),
      );
      stylesheetWireBytes += asset.wireBytes;
    }

    const navigation = await fetchWire(origin + '/', {
      ...compressed,
      accept: 'application/vnd.kovo.document-parts+json',
    });
    integrityProblems.push(
      ...wireResponseIntegrityProblems('enhanced-navigation document', navigation, {
        allowedContentEncodings: ['br', 'gzip'],
        contentTypePrefix: 'application/vnd.kovo.document-parts+json',
      }),
    );

    const inlineScripts = [
      ...(identity.text ?? '').matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gu),
    ].map((match) => match[1]);
    const inlineBootstrap = inlineScripts.reduce(
      (longest, candidate) => (candidate.length > longest.length ? candidate : longest),
      '',
    );
    if (inlineBootstrap === '') {
      integrityProblems.push(
        'identity document carried no inline bootstrap; this workload is interactive, so zero bytes would be a functionality failure rather than a size win',
      );
    }

    if (integrityProblems.length > 0) {
      return {
        detail: {
          documentContentEncoding: document.contentEncoding,
          documentStatus: document.status,
          identityStatus: identity.status,
          navigationContentType: navigation.headers['content-type'] ?? null,
          navigationStatus: navigation.status,
          stylesheetHrefs,
        },
        error: `bytes suite integrity check failed: ${integrityProblems.join('; ')}`,
        metrics: {},
        suite: 'bytes',
      };
    }

    return {
      detail: {
        documentIdentityBytes: identity.wireBytes,
        documentContentEncoding: document.contentEncoding,
        navigationContentType: navigation.headers['content-type'] ?? null,
        stylesheetHrefs,
      },
      metrics: {
        'production.criticalPath.wireBytes': {
          value: document.wireBytes + stylesheetWireBytes,
        },
        'production.document.wireBytes': { value: document.wireBytes },
        'production.inlineBootstrap.gzipBytes': {
          value:
            inlineBootstrap === ''
              ? 0
              : gzipSync(Buffer.from(inlineBootstrap, 'utf8'), { level: 9 }).byteLength,
        },
        'production.inlineBootstrap.identityBytes': {
          value: Buffer.byteLength(inlineBootstrap, 'utf8'),
        },
        'production.navigation.wireBytes': { value: navigation.wireBytes },
      },
      profiles: {
        cpu: profileCensus(options.cpuProfDir),
        heap: profileCensus(options.heapProfDir),
      },
      suite: 'bytes',
    };
  } finally {
    server?.child.kill('SIGKILL');
    rmSync(root, { force: true, recursive: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Suite: ssr (throughput + TTFB)
// ---------------------------------------------------------------------------------------------

/**
 * Keep-alive load generator. Deliberately NOT autocannon: plans/good-perf.md records that its
 * latency histogram is wrong by ~400x against `Connection: close` and instructs that any Kovo
 * latency number taken with it be invalidated.
 */
async function loadGenerate(origin, connections, durationMs) {
  const { Agent } = await import('node:http');
  const agent = new Agent({ keepAlive: true, maxSockets: connections });
  const http = await import('node:http');
  const ttfbSamples = [];
  let completed = 0;
  let requestErrors = 0;
  let responseErrors = 0;
  const statusCounts = {};
  const deadline = performance.now() + durationMs;

  async function oneRequest() {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const startedAt = performance.now();
      const request = http.get(
        `${origin}/`,
        { agent, headers: { 'accept-encoding': 'identity' } },
        (response) => {
          const status = String(response.statusCode ?? 0);
          statusCounts[status] = (statusCounts[status] ?? 0) + 1;
          ttfbSamples.push(performance.now() - startedAt);
          response.resume();
          response.on('end', () => {
            completed += 1;
            finish();
          });
          response.on('error', () => {
            responseErrors += 1;
            finish();
          });
        },
      );
      request.on('error', () => {
        requestErrors += 1;
        finish();
      });
    });
  }

  async function worker() {
    while (performance.now() < deadline) await oneRequest();
  }

  const startedAt = performance.now();
  await Promise.all(Array.from({ length: connections }, () => worker()));
  const elapsedMs = performance.now() - startedAt;
  agent.destroy();
  return {
    requestsPerSecond: (completed / elapsedMs) * 1000,
    requestErrors,
    responseErrors,
    statusCounts,
    ttfbMedianMs: median(ttfbSamples),
    ttfbSampleCount: ttfbSamples.length,
  };
}

export async function runSsrSuite(options) {
  // Captured BEFORE the build and before the load generator runs. Sampling it afterwards measures
  // the suite's own saturation — c=32 against a 10-core box pushes the 1-minute average past 8 all
  // by itself — and a budget gated on that number would mark every honest run `unproven`. What the
  // load ceiling is for is pre-existing contention from other work on the box.
  const preSuiteLoadAverage = observedLoadAverage();
  const root = path.join(repoRoot, '.tmp-kovo-perf-ssr');
  const workload = materializePerfWorkload({
    componentCount: options.componentCount,
    repoRoot,
    root,
  });
  const port = options.port;
  const origin = `http://127.0.0.1:${String(port)}`;
  let server;
  try {
    const build = measureProcessTreeCommand(
      [process.execPath, ...kovoCliArgv(['build', './src/app.tsx', '--out', './dist'])],
      { cwd: workload.root, timeoutMs: options.timeoutMs },
    );
    if (build.exitCode !== 0) {
      return {
        error: `kovo build exited ${String(build.exitCode)}`,
        detail: { buildLog: `${build.stdout}\n${build.stderr}`.slice(-8000) },
        metrics: {},
        suite: 'ssr',
      };
    }
    server = startBuiltServer(path.join(workload.root, 'dist'), port);
    if (!(await waitForServer(origin, 60_000))) {
      return {
        detail: { serverLog: server.readLog().slice(-8000) },
        error: 'built artifact did not answer within 60s',
        metrics: {},
        suite: 'ssr',
      };
    }
    const warmup = await loadGenerate(origin, options.connections, 2000);
    const warmupProblems = loadGenerationIntegrityProblems('SSR warmup', warmup);
    if (warmupProblems.length > 0) {
      return {
        detail: { warmup },
        error: `SSR suite integrity check failed: ${warmupProblems.join('; ')}`,
        metrics: {},
        suite: 'ssr',
      };
    }
    const measured = await loadGenerate(origin, options.connections, options.durationMs);
    const measurementProblems = loadGenerationIntegrityProblems('SSR measurement', measured);
    if (measurementProblems.length > 0) {
      return {
        detail: { measured, warmup },
        error: `SSR suite integrity check failed: ${measurementProblems.join('; ')}`,
        metrics: {},
        suite: 'ssr',
      };
    }
    return {
      detail: {
        ...measured,
        connections: options.connections,
        // Diagnostic only: this is mostly the suite's own saturation, not contention.
        loadAverageDuringRun: observedLoadAverage(),
        preSuiteLoadAverage,
        warmup,
      },
      metrics: {
        'production.ssr.requestsPerSecondFloor': {
          loadAverage: preSuiteLoadAverage,
          // A floor expressed as a max so one comparison direction covers every metric.
          value: -measured.requestsPerSecond,
        },
        'production.ssr.ttfbMedianMs': {
          loadAverage: preSuiteLoadAverage,
          value: measured.ttfbMedianMs,
        },
      },
      suite: 'ssr',
    };
  } finally {
    server?.child.kill('SIGKILL');
    rmSync(root, { force: true, recursive: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Suite: dev-edit (edit -> served, with a CDP CPU profile over the exact window)
// ---------------------------------------------------------------------------------------------

async function cdpSession(inspectorPort) {
  const list = await (await fetch(`http://127.0.0.1:${String(inspectorPort)}/json/list`)).json();
  const target = list.find((entry) => typeof entry.webSocketDebuggerUrl === 'string');
  if (target === undefined) throw new Error('no CDP target exposed by kovo dev');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    const resolver = pending.get(message.id);
    if (resolver === undefined) return;
    pending.delete(message.id);
    resolver(message.result);
  });
  return {
    close: () => socket.close(),
    send: (method, params = {}) =>
      new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        socket.send(JSON.stringify({ id, method, params }));
      }),
  };
}

export async function runDevEditSuite(options) {
  const root = path.join(repoRoot, '.tmp-kovo-perf-dev');
  const workload = materializePerfWorkload({
    componentCount: options.componentCount,
    repoRoot,
    root,
  });
  const editIndex = options.componentCount - 1;
  const port = options.port;
  const inspectorPort = port + 1;
  const origin = `http://127.0.0.1:${String(port)}`;
  const devArgs = ['dev', './src/app.tsx', '--port', String(port)];
  const child = spawn(
    process.execPath,
    [`--inspect=127.0.0.1:${String(inspectorPort)}`, ...kovoCliArgv(devArgs)],
    { cwd: workload.root, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let devLog = '';
  child.stdout.on('data', (chunk) => {
    devLog += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    devLog += String(chunk);
  });

  const samples = [];
  let profilePath = null;
  try {
    const ready = await waitForServer(origin, options.readyTimeoutMs);
    if (!ready) {
      return {
        detail: { devLog: devLog.slice(-8000) },
        error: `kovo dev did not answer within ${String(options.readyTimeoutMs)}ms`,
        metrics: {},
        suite: 'dev-edit',
      };
    }

    let session = null;
    if (options.cpuProfDir !== undefined) {
      mkdirSync(options.cpuProfDir, { recursive: true });
      session = await cdpSession(inspectorPort);
      await session.send('Profiler.enable');
      await session.send('Profiler.setSamplingInterval', { interval: 500 });
      await session.send('Profiler.start');
    }

    for (let edit = 1; edit <= options.edits; edit += 1) {
      const token = `perf-edit-${String(edit)}-${String(Date.now())}`;
      const loadAverage = observedLoadAverage();
      writeFileSync(
        workload.editTargetPath,
        perfWorkloadEditedComponent(editIndex, options.componentCount, edit).replace(
          `depth marker ${String(editIndex)} of`,
          `${token} of`,
        ),
        'utf8',
      );
      const startedAt = performance.now();
      let landedMs = null;
      const deadline = startedAt + options.editTimeoutMs;
      while (performance.now() < deadline) {
        try {
          const response = await fetch(origin + '/', {
            headers: { 'accept-encoding': 'identity' },
          });
          if ((await response.text()).includes(token)) {
            landedMs = performance.now() - startedAt;
            break;
          }
        } catch {
          // dev server is restaging
        }
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      samples.push({ durationMs: landedMs, edit, loadAverage });
    }

    if (session !== null) {
      const stopped = await session.send('Profiler.stop');
      profilePath = path.join(options.cpuProfDir, `kovo-dev-edit-${String(Date.now())}.cpuprofile`);
      writeFileSync(profilePath, JSON.stringify(stopped.profile), 'utf8');
      session.close();
    }
  } finally {
    child.kill('SIGKILL');
    rmSync(root, { force: true, recursive: true });
  }

  const landed = samples.filter((sample) => Number.isFinite(sample.durationMs));
  return {
    detail: {
      devLogTail: devLog.slice(-4000),
      landedCount: landed.length,
      samples,
    },
    metrics: {
      'dev.editToServed.medianMs': {
        loadAverage: median(samples.map((sample) => sample.loadAverage)),
        value: landed.length === 0 ? null : median(landed.map((sample) => sample.durationMs)),
      },
      'dev.editToServed.missRate': {
        value: samples.length === 0 ? null : (samples.length - landed.length) / samples.length,
      },
    },
    // The CDP window is the profile shape that answers the question here. `--cpu-prof` via
    // NODE_OPTIONS does flush for `kovo dev` under SIGINT at this HEAD, but only as one
    // whole-session profile in which the edit is a small fraction of a cold start; see
    // `profilingEnv` for the measured comparison.
    profiles: {
      cpu:
        profilePath === null
          ? null
          : { directory: options.cpuProfDir, files: [path.basename(profilePath)], fileCount: 1 },
    },
    suite: 'dev-edit',
  };
}

// ---------------------------------------------------------------------------------------------
// Profile summarisation
// ---------------------------------------------------------------------------------------------

/** Self-time hit counts per source file, from one V8 `.cpuprofile`. */
export function cpuProfileFileHits(profile) {
  const totals = new Map();
  for (const node of profile.nodes ?? []) {
    const url = node.callFrame?.url === '' ? '(native)' : (node.callFrame?.url ?? '(native)');
    const name = url.split('/').pop() || url;
    totals.set(name, (totals.get(name) ?? 0) + (node.hitCount ?? 0));
  }
  return [...totals.entries()].sort((left, right) => right[1] - left[1]);
}

/**
 * Summarise every profile in a directory.
 *
 * A `kovo check` tree is six processes. Only a per-process view shows the `app-source-trust` trust
 * worker at all — it is a spawned process, so a parent-only profiler reports its cost as zero.
 */
export function summarizeProfileDirectory(directory) {
  const summaries = [];
  for (const name of readdirSync(directory).sort()) {
    if (!name.endsWith('.cpuprofile')) continue;
    const profile = JSON.parse(readFileSync(path.join(directory, name), 'utf8'));
    const byFile = cpuProfileFileHits(profile);
    summaries.push({
      byFile: byFile.slice(0, 6),
      file: name,
      totalHits: byFile.reduce((total, entry) => total + entry[1], 0),
    });
  }
  summaries.sort((left, right) => right.totalHits - left.totalHits);
  return summaries;
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

const SUITES = new Map([
  ['bytes', runBytesSuite],
  ['check-scaling', runCheckScalingSuite],
  ['dev-edit', runDevEditSuite],
  ['ssr', runSsrSuite],
]);

function parseArgs(argv) {
  const args = { evaluate: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    const value = next !== undefined && !next.startsWith('--') ? argv[++index] : true;
    if (key === 'evaluate') args.evaluate.push(value);
    else args[key] = value;
  }
  return args;
}

export function performanceGateWorkloadIdentity(suite, options) {
  const identity = {
    adapters: { perfGate: PERF_REPORT_SCHEMA, workload: 'kovo-realistic-workload/v1' },
    cells: [suite],
    policies:
      suite === 'check-scaling'
        ? {
            hostLoadCeilingPerCpu: options.maxLoadPerCpu ?? 1,
            hostSettleMaxTotalMs: options.hostSettleMaxMs ?? DEFAULT_HOST_SETTLE_MAX_MS,
            hostSettlePollMs: options.hostSettlePollMs ?? DEFAULT_HOST_SETTLE_POLL_MS,
            ladder: [...options.ladder],
            samplesPerRung: options.samples,
          }
        : { componentCount: options.componentCount },
  };
  return {
    complete:
      typeof suite === 'string' &&
      suite.length > 0 &&
      (suite !== 'check-scaling' ||
        (Array.isArray(options.ladder) &&
          options.ladder.length >= 2 &&
          Number.isSafeInteger(options.samples) &&
          options.samples > 0)),
    digest: `sha256:${createHash('sha256').update(canonicalJson(identity)).digest('hex')}`,
    identity,
    schema: PERF_GATE_WORKLOAD_SCHEMA,
  };
}

export function performanceGateHostSamples(result, host, ceiling = 1) {
  const timedSamples =
    result?.suite === 'check-scaling'
      ? (result.detail?.rungs ?? []).flatMap((rung) =>
          (rung.samples ?? []).map((sample, index) => {
            const oneMinuteLoad = Array.isArray(sample.loadAverage)
              ? sample.loadAverage[0]
              : sample.loadAverage;
            return {
              at: sample.hostAdmission?.at ?? null,
              ceiling: sample.hostAdmission?.ceiling ?? ceiling,
              context: `N=${String(rung.componentCount)}/sample=${String(index)}`,
              loadAverage: [oneMinuteLoad],
              loadPerCpu: oneMinuteLoad / host.cpu.count,
              phase: 'check-scaling',
              ...(sample.hostAdmission === undefined
                ? {}
                : {
                    posture: sample.hostAdmission.posture,
                    settle: sample.hostAdmission.settle,
                  }),
            };
          }),
        )
      : [];
  const initialAdmission = result?.hostAdmission?.initial;
  const lastTimedAdmission = timedSamples.at(-1);
  const authority =
    lastTimedAdmission ??
    (initialAdmission === undefined
      ? null
      : {
          at: initialAdmission.at,
          ceiling: initialAdmission.ceiling,
          context: initialAdmission.context,
          loadAverage: initialAdmission.loadAverage,
          loadPerCpu: initialAdmission.loadPerCpu,
          posture: initialAdmission.posture,
          settle: initialAdmission.settle,
        });
  const observed = authority?.loadAverage ?? loadavg();
  const postTimingDiagnostic = result?.hostAdmission?.suiteComplete ?? null;
  return [
    ...timedSamples,
    {
      admissionContext: authority?.context ?? null,
      at: authority === null ? new Date().toISOString() : authority.at,
      ceiling: authority?.ceiling ?? ceiling,
      context: result?.suite ?? 'unknown',
      loadAverage: observed,
      loadPerCpu: authority?.loadPerCpu ?? observed[0] / host.cpu.count,
      phase: 'suite-complete',
      postTimingDiagnostic,
      ratificationBasis: authority === null ? 'unavailable' : 'last-pre-timing-admission',
      ...(authority === null ? {} : { posture: 'last-timed-admission', settle: authority.settle }),
    },
  ];
}

async function main(argv) {
  const args = parseArgs(argv);
  const budgetsPath = path.resolve(
    String(args.budgets ?? path.join(repoRoot, 'perf-budgets.json')),
  );

  if (args.evaluate.length > 0) {
    const budgets = JSON.parse(readFileSync(budgetsPath, 'utf8'));
    if (budgets.schema !== PERF_BUDGETS_SCHEMA) {
      throw new Error(`perf budgets schema must be ${PERF_BUDGETS_SCHEMA}`);
    }
    let failed = 0;
    let evaluated = 0;
    for (const reportPath of args.evaluate) {
      const label = String(reportPath);
      const report = JSON.parse(readFileSync(path.resolve(label), 'utf8'));
      for (const suite of reportSuites(report, label)) {
        const results = evaluateReport(budgets, suite);
        process.stdout.write(
          `# ${String(suite.suite ?? 'unknown')} (${label})\n${formatEvaluation(results)}`,
        );
        failed += results.filter((result) => result.status === 'fail').length;
        evaluated += results.length;
      }
    }
    // A run that compared nothing is a failure, not a pass. Every previous perf number in this
    // effort was taken by an ad-hoc script; the one thing a committed gate must never do is report
    // green because it silently had no work to do.
    if (evaluated === 0) {
      process.stderr.write('perf gate evaluated 0 metrics; refusing to report success\n');
      process.exitCode = 1;
      return;
    }
    process.exitCode = failed === 0 ? 0 : 1;
    return;
  }

  if (args['profile-summary'] !== undefined) {
    const summaries = summarizeProfileDirectory(path.resolve(String(args['profile-summary'])));
    for (const summary of summaries) {
      process.stdout.write(
        `${summary.file} hits=${String(summary.totalHits)} ${summary.byFile
          .map(([name, hits]) => `${name}=${String(hits)}`)
          .join(' ')}\n`,
      );
    }
    return;
  }

  const suiteName = String(args.suite ?? '');
  const suite = SUITES.get(suiteName);
  if (suite === undefined) {
    process.stderr.write(
      `usage: node scripts/perf-gate.mjs --suite <${[...SUITES.keys()].join('|')}> [--out report.json]\n` +
        '       node scripts/perf-gate.mjs --evaluate report.json [--evaluate other.json]\n' +
        'options: --ladder 8,24,72,216  --samples 1  --components 24  --port 43117\n' +
        '         --connections 32  --duration 10000  --edits 5\n' +
        '         --host-settle-max-ms 30000  --host-settle-poll-ms 1000\n' +
        '         --cpu-prof <dir>  --heap-prof <dir>\n' +
        '       node scripts/perf-gate.mjs --profile-summary <dir>\n',
    );
    process.exitCode = 2;
    return;
  }

  const options = {
    componentCount: parsePositiveIntegerOption('components', args.components, 24, { max: 10_000 }),
    connections: parsePositiveIntegerOption('connections', args.connections, 32, { max: 10_000 }),
    cpuProfDir: args['cpu-prof'] === undefined ? undefined : path.resolve(String(args['cpu-prof'])),
    durationMs: parsePositiveIntegerOption('duration', args.duration, 10_000, { max: 86_400_000 }),
    editTimeoutMs: parsePositiveIntegerOption('edit-timeout', args['edit-timeout'], 240_000, {
      max: 86_400_000,
    }),
    edits: parsePositiveIntegerOption('edits', args.edits, 5, { max: 10_000 }),
    heapProfDir:
      args['heap-prof'] === undefined ? undefined : path.resolve(String(args['heap-prof'])),
    hostSettleMaxMs: parsePositiveIntegerOption(
      'host-settle-max-ms',
      args['host-settle-max-ms'],
      DEFAULT_HOST_SETTLE_MAX_MS,
      { max: MAX_HOST_SETTLE_MAX_MS, min: 0 },
    ),
    hostSettlePollMs: parsePositiveIntegerOption(
      'host-settle-poll-ms',
      args['host-settle-poll-ms'],
      DEFAULT_HOST_SETTLE_POLL_MS,
      { max: 60_000, min: 10 },
    ),
    // Default matches the span the budgets were calibrated on (the 72->216 marginal step). A
    // shorter default would compute the exponent over 24->72, where a genuinely quadratic workload
    // can still look linear — a gate that cannot see the regression it exists to catch.
    ladder: parseLadderOption(args.ladder),
    port: parsePositiveIntegerOption('port', args.port, 43_117, { max: 65_534, min: 1024 }),
    readyTimeoutMs: parsePositiveIntegerOption('ready-timeout', args['ready-timeout'], 300_000, {
      max: 86_400_000,
    }),
    samples: parsePositiveIntegerOption('samples', args.samples, 1, { max: 1_000 }),
    timeoutMs: parsePositiveIntegerOption('timeout', args.timeout, 1_800_000, {
      max: 86_400_000,
    }),
  };

  const startedAt = new Date().toISOString();
  const source = collectPerformanceProvenance({
    lockFiles: [
      'pnpm-lock.yaml',
      'benchmarks/nextjs/pnpm-lock.yaml',
      'benchmarks/harness/pnpm-lock.yaml',
    ],
    repoRoot,
  });
  const execution = performanceExecutionIdentity({ startedAt });
  const result = await suite(options);
  const sourceAfter = collectPerformanceProvenance({
    lockFiles: [
      'pnpm-lock.yaml',
      'benchmarks/nextjs/pnpm-lock.yaml',
      'benchmarks/harness/pnpm-lock.yaml',
    ],
    repoRoot,
  });
  const host = performanceHostFingerprint();
  const workloadIdentity = performanceGateWorkloadIdentity(suiteName, options);
  const sourceStable = canonicalJson(source) === canonicalJson(sourceAfter);
  const verdictReasons = [];
  if (result.error !== undefined) verdictReasons.push(result.error);
  if (source.dirty || sourceAfter.dirty) verdictReasons.push('source provenance is dirty');
  if (!sourceStable) verdictReasons.push('source provenance changed during run');
  for (const finding of executionIdentityFindings(execution)) verdictReasons.push(finding);
  if (!workloadIdentity.complete) verdictReasons.push('workload identity is incomplete');
  const report = {
    execution,
    finishedAt: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    host,
    hostDiagnostics:
      result.hostAdmission?.suiteComplete === undefined ? [] : [result.hostAdmission.suiteComplete],
    hostSamples: performanceGateHostSamples(result, host),
    integrity: {
      complete: result.error === undefined,
      executionAuthenticated: executionIdentityFindings(execution).length === 0,
      publishable: source.dirty === false && sourceAfter.dirty === false,
      serialized: true,
      sourceStable,
      workloadAuthenticated: workloadIdentity.complete,
    },
    options,
    schema: PERF_REPORT_SCHEMA,
    source,
    sourceAfter,
    startedAt,
    verdict: {
      reasons: [...new Set(verdictReasons)].sort(),
      status: verdictReasons.length === 0 ? 'measured' : 'unproven',
    },
    workloadIdentity,
    ...result,
  };
  const outPath = args.out === undefined ? null : path.resolve(String(args.out));
  if (outPath !== null) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (result.error !== undefined) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    // A malformed or wrong-shaped report is an operator mistake, not a crash to debug: print the
    // sentence, keep the stack behind KOVO_PERF_GATE_DEBUG for when it really is a crash.
    process.stderr.write(
      process.env.KOVO_PERF_GATE_DEBUG === '1'
        ? `${error.stack ?? error.message}\n`
        : `perf gate: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
