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
import { spawn, spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { measureProcessTreeCommand } from './lib/process-tree-rss.mjs';
import { materializePerfWorkload, perfWorkloadEditedComponent } from './perf-workload.mjs';

export const PERF_REPORT_SCHEMA = 'kovo-perf-report/v1';
export const PERF_BUDGETS_SCHEMA = 'kovo-perf-budgets/v1';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CHECK_CENSUS_SCHEMA = 'kovo-check-phase-census/v1';
const CHECK_CENSUS_INCOMPLETE_SCHEMA = 'kovo-check-phase-census-incomplete/v1';

// ---------------------------------------------------------------------------------------------
// Pure helpers (exported for scripts/perf-gate.test.mjs)
// ---------------------------------------------------------------------------------------------

export function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
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
  lines.push(`${String(failed)} failed, ${String(unproven)} unproven, ${String(results.length)} total`);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------
// Process plumbing
// ---------------------------------------------------------------------------------------------

function observedLoadAverage() {
  return loadavg()[0];
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
  for (const componentCount of options.ladder) {
    const root = path.join(repoRoot, `.tmp-kovo-perf-scaling-${String(componentCount)}`);
    const workload = materializePerfWorkload({ componentCount, repoRoot, root });
    const samples = [];
    try {
      for (let sample = 0; sample < options.samples; sample += 1) {
        const loadAverage = observedLoadAverage();
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
          loadAverage,
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
      durationMedianMs: median(samples.map((sample) => sample.durationMs ?? 0)),
      peakRssBytes: Math.max(...samples.map((sample) => sample.peakRssBytes ?? 0)),
      samples,
    });
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

    // Render-blocking closure: the document plus every stylesheet it links. Scripts are deferred by
    // construction in Kovo, so they are not on the critical path; a <link rel=stylesheet> is.
    const stylesheetHrefs = [
      ...(identity.text ?? '').matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/gu),
    ].map((match) => match[1]);
    let stylesheetWireBytes = 0;
    for (const href of stylesheetHrefs) {
      const asset = await fetchWire(new URL(href, origin).toString(), compressed);
      stylesheetWireBytes += asset.wireBytes;
    }

    const navigation = await fetchWire(origin + '/', {
      ...compressed,
      accept: 'application/vnd.kovo.document-parts+json',
    });

    const inlineScripts = [
      ...(identity.text ?? '').matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gu),
    ].map((match) => match[1]);
    const inlineBootstrap = inlineScripts.reduce(
      (longest, candidate) => (candidate.length > longest.length ? candidate : longest),
      '',
    );

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
            inlineBootstrap === '' ? 0 : gzipSync(Buffer.from(inlineBootstrap, 'utf8'), { level: 9 }).byteLength,
        },
        'production.inlineBootstrap.identityBytes': {
          value: Buffer.byteLength(inlineBootstrap, 'utf8'),
        },
        'production.navigation.wireBytes': { value: navigation.wireBytes },
      },
      profiles: { cpu: profileCensus(options.cpuProfDir), heap: profileCensus(options.heapProfDir) },
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
  const deadline = performance.now() + durationMs;

  async function oneRequest() {
    return new Promise((resolve) => {
      const startedAt = performance.now();
      const request = http.get(
        `${origin}/`,
        { agent, headers: { 'accept-encoding': 'identity' } },
        (response) => {
          ttfbSamples.push(performance.now() - startedAt);
          response.resume();
          response.on('end', () => {
            completed += 1;
            resolve();
          });
        },
      );
      request.on('error', () => resolve());
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
    await loadGenerate(origin, options.connections, 2000);
    const measured = await loadGenerate(origin, options.connections, options.durationMs);
    return {
      detail: {
        ...measured,
        connections: options.connections,
        // Diagnostic only: this is mostly the suite's own saturation, not contention.
        loadAverageDuringRun: observedLoadAverage(),
        preSuiteLoadAverage,
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
          const response = await fetch(origin + '/', { headers: { 'accept-encoding': 'identity' } });
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
    profiles: { cpu: profilePath === null ? null : { directory: options.cpuProfDir, files: [path.basename(profilePath)], fileCount: 1 } },
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

function hostFacts() {
  return {
    arch: process.arch,
    cpuCount: (spawnSync('sysctl', ['-n', 'hw.ncpu'], { encoding: 'utf8' }).stdout ?? '').trim() || null,
    loadAverage: loadavg(),
    node: process.version,
    platform: process.platform,
  };
}

async function main(argv) {
  const args = parseArgs(argv);
  const budgetsPath = path.resolve(String(args.budgets ?? path.join(repoRoot, 'perf-budgets.json')));

  if (args.evaluate.length > 0) {
    const budgets = JSON.parse(readFileSync(budgetsPath, 'utf8'));
    if (budgets.schema !== PERF_BUDGETS_SCHEMA) {
      throw new Error(`perf budgets schema must be ${PERF_BUDGETS_SCHEMA}`);
    }
    let failed = 0;
    for (const reportPath of args.evaluate) {
      const report = JSON.parse(readFileSync(path.resolve(String(reportPath)), 'utf8'));
      const results = evaluateReport(budgets, report);
      process.stdout.write(`# ${report.suite} (${String(reportPath)})\n${formatEvaluation(results)}`);
      failed += results.filter((result) => result.status === 'fail').length;
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
        'options: --ladder 8,24,72  --samples 1  --components 24  --port 43117\n' +
        '         --connections 32  --duration 10000  --edits 5\n' +
        '         --cpu-prof <dir>  --heap-prof <dir>\n' +
        '       node scripts/perf-gate.mjs --profile-summary <dir>\n',
    );
    process.exitCode = 2;
    return;
  }

  const options = {
    componentCount: Number(args.components ?? 24),
    connections: Number(args.connections ?? 32),
    cpuProfDir: args['cpu-prof'] === undefined ? undefined : path.resolve(String(args['cpu-prof'])),
    durationMs: Number(args.duration ?? 10_000),
    editTimeoutMs: Number(args['edit-timeout'] ?? 240_000),
    edits: Number(args.edits ?? 5),
    heapProfDir:
      args['heap-prof'] === undefined ? undefined : path.resolve(String(args['heap-prof'])),
    ladder: String(args.ladder ?? '8,24,72')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0),
    port: Number(args.port ?? 43_117),
    readyTimeoutMs: Number(args['ready-timeout'] ?? 300_000),
    samples: Number(args.samples ?? 1),
    timeoutMs: Number(args.timeout ?? 1_800_000),
  };

  const startedAt = new Date().toISOString();
  const result = await suite(options);
  const report = {
    finishedAt: new Date().toISOString(),
    host: hostFacts(),
    options,
    schema: PERF_REPORT_SCHEMA,
    startedAt,
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
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exit(1);
  });
}
