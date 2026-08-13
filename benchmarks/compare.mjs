#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readArg, readIntegerArg } from './harness/args.mjs';
import { bfcacheIterationFindings } from './harness/bfcache.mjs';
import { BROWSER_BENCHMARK_SCHEMA } from './harness/schema.mjs';
import {
  canonicalJson,
  PERF_HOST_SCHEMA,
  performanceHostFingerprint,
} from '../scripts/lib/perf-host.mjs';
import { collectPerformanceProvenance } from '../scripts/lib/perf-provenance.mjs';
import {
  executionIdentityFindings,
  performanceExecutionIdentity,
} from '../scripts/lib/perf-execution.mjs';
import {
  SERVER_BENCHMARK_SCHEMA,
  SERVER_CONCURRENCIES,
  SERVER_ENCODINGS,
  SERVER_MODES,
  SERVER_PREPARE_SCHEMA,
  SERVER_ROUTES,
  serverConditions,
} from '../scripts/perf-server-benchmark.mjs';

export const COMPARE_SCHEMA = 'kovo-next-performance-comparison/v1';
export const BROWSER_PREPARE_SCHEMA = 'kovo-browser-benchmark-prepare/v1';
export const EXECUTION_ORDER = Object.freeze(['kovo', 'nextjs', 'nextjs', 'kovo']);
export const WORKLOAD_IDENTITY_SCHEMA = 'kovo-performance-workload-identity/v1';

const DEV_EDIT_CLASSES = Object.freeze(['leaf', 'entry', 'data', 'syntaxError', 'recovery']);

const benchmarkRoot = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = path.resolve(benchmarkRoot, '..');
const lanes = Object.freeze(['default', 'matched-l0', 'matched-l1']);
const buildModes = Object.freeze(['clean', 'unchanged', 'edit']);
const defaultCells = Object.freeze(['browser', 'dev', 'build', 'server']);
const lockFiles = Object.freeze([
  'pnpm-lock.yaml',
  'benchmarks/nextjs/pnpm-lock.yaml',
  'benchmarks/harness/pnpm-lock.yaml',
]);

export async function runComparison(options = {}) {
  const execution = performanceExecutionIdentity();
  const executionAuthenticated = executionIdentityFindings(execution).length === 0;
  const cells = options.cells ?? defaultCells;
  for (const cell of cells) assertMember('--cells', cell, defaultCells);
  if (new Set(cells).size !== cells.length) throw new Error('--cells must not contain duplicates.');
  assertMember('--corpus-size', options.corpusSize ?? 24, [24, 216]);
  if ((cells.includes('browser') || cells.includes('server')) && options.skipBuild === true) {
    throw new Error(
      '--skip-build is unavailable for browser/server comparisons; each comparison prepares fresh production artifacts once.',
    );
  }
  if (cells.includes('server')) {
    assertServerMatrixOptions(options);
  }
  for (const lane of options.lanes ?? lanes) assertMember('--lanes', lane, lanes);
  for (const mode of options.buildModes ?? buildModes)
    assertMember('--build-modes', mode, buildModes);
  const devSchedule = cells.includes('dev')
    ? devSampleSchedule({
        editSamples: options.devIterations ?? 30,
        readySamples: options.devReadyIterations ?? 15,
        warmups: options.devWarmups ?? 3,
      })
    : [];
  const workloadIdentity = await performanceWorkloadIdentity(options, cells);
  const provenance = collectPerformanceProvenance({
    lockFiles,
    repoRoot,
  });
  const dirtyOverride = provenance.dirty && options.allowDirty === true;
  if (provenance.dirty && !dirtyOverride) {
    const outDir = path.resolve(options.outDir ?? path.join(benchmarkRoot, 'results'));
    await mkdir(outDir, { recursive: true });
    const report = {
      analysis: {},
      browserPreparation: [],
      execution,
      generatedAt: new Date().toISOString(),
      host: performanceHostFingerprint(),
      hostSamples: [],
      integrity: {
        alternatingOrder: EXECUTION_ORDER,
        cells,
        comparatorMatched: false,
        executionAuthenticated,
        serialized: true,
        sourceStable: true,
        workloadAuthenticated: workloadIdentity.complete,
      },
      rawCells: [],
      schema: COMPARE_SCHEMA,
      serverPreparation: [],
      source: provenance,
      workloadIdentity,
    };
    report.verdict = comparisonVerdict(report);
    const output = path.join(outDir, 'comparison.json');
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    throw new Error(
      `Comparison is unproven: ${report.verdict.reasons.join('; ')}. Evidence preserved at ${output}.`,
    );
  }

  const outDir = path.resolve(options.outDir ?? path.join(benchmarkRoot, 'results'));
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'kovo-next-compare-'));
  const iterations = options.iterations ?? 30;
  const warmups = options.warmups ?? 3;
  const occurrenceCounts = splitAcrossOccurrences(iterations);
  const warmupCounts = splitAcrossOccurrences(warmups);
  const bfcacheCounts = splitAcrossOccurrences(options.bfcacheIterations ?? 10);
  const lighthouseCounts = splitAcrossOccurrences(options.lighthouseRuns ?? 5);
  const hostSamples = [];
  const rawCells = [];
  const browserPreparation = [];
  const serverPreparation = [];
  let executionError = null;
  await mkdir(outDir, { recursive: true });
  try {
    if (cells.includes('browser')) {
      browserPreparation.push(...(await prepareBrowserEntrants()));
      const incomplete = browserPreparation.filter((report) => report.integrity.complete !== true);
      if (incomplete.length > 0) {
        executionError = incomplete
          .flatMap((report) =>
            report.integrity.errors.map((error) => `${report.framework}: ${error}`),
          )
          .join('; ');
      }
    }
    if (cells.includes('browser') && !executionError) {
      for (const lane of options.lanes ?? lanes) {
        assertMember('--lanes', lane, lanes);
        for (const [orderIndex, framework] of EXECUTION_ORDER.entries()) {
          const occurrence = occurrenceIndex(orderIndex, framework);
          const sampleCount = occurrenceCounts[occurrence];
          const warmupCount = warmupCounts[occurrence];
          const host = sampleHost(hostSamples, options.maxLoadPerCpu ?? 1);
          if (!host.comparable) {
            executionError = `host load ${host.loadPerCpu.toFixed(3)} per CPU exceeded ceiling ${host.ceiling}`;
            break;
          }
          const resultFile = path.join(scratch, `${lane}-${orderIndex}-browser.json`);
          try {
            await runAdapter({
              args: [
                path.join(benchmarkRoot, 'run-all.mjs'),
                '--apps',
                framework,
                '--lane',
                lane,
                '--iterations',
                String(sampleCount),
                '--warmups',
                String(warmupCount),
                ...(options.skipLighthouse
                  ? ['--skip-lighthouse']
                  : ['--lighthouse-runs', String(Math.max(1, lighthouseCounts[occurrence]))]),
                '--bfcache-iterations',
                String(Math.max(1, bfcacheCounts[occurrence])),
                '--skip-build',
                '--out-dir',
                path.join(scratch, `${lane}-${orderIndex}-browser-out`),
                '--result-file',
                resultFile,
              ],
              cwd: repoRoot,
              label: `${lane}/${framework}/browser/${occurrence}`,
            });
          } catch (error) {
            executionError = error instanceof Error ? error.message : String(error);
            break;
          }
          rawCells.push({
            cell: 'browser',
            framework,
            lane,
            occurrence,
            report: JSON.parse(await readFile(resultFile, 'utf8')),
          });
        }
        if (executionError) break;
      }
    }

    if (cells.includes('dev') && !executionError) {
      const corpusLane = `corpus-n${options.corpusSize ?? 24}`;
      for (const scheduled of devSchedule) {
        const { framework, occurrence, scheduleIndex } = scheduled;
        const host = sampleHost(hostSamples, options.maxLoadPerCpu ?? 1);
        if (!host.comparable) {
          executionError = `host load ${host.loadPerCpu.toFixed(3)} per CPU exceeded ceiling ${host.ceiling}`;
          break;
        }
        const resultFile = path.join(scratch, `${corpusLane}-${scheduleIndex}-dev.json`);
        try {
          await runAdapter({
            args: [
              path.join(benchmarkRoot, 'corpora/dev-loop.mjs'),
              '--manifest',
              corpusManifest(framework, options.corpusSize ?? 24),
              '--iterations',
              String(scheduled.editSamples),
              '--ready-iterations',
              String(scheduled.readySamples),
              '--warmups',
              String(scheduled.warmups),
              '--port',
              String((options.devPortBase ?? 49_700) + scheduleIndex),
              '--out',
              resultFile,
            ],
            cwd: repoRoot,
            label: `${corpusLane}/${framework}/dev/${occurrence}`,
          });
        } catch (error) {
          executionError = error instanceof Error ? error.message : String(error);
          break;
        }
        rawCells.push({
          cell: 'dev',
          framework,
          lane: corpusLane,
          occurrence,
          report: JSON.parse(await readFile(resultFile, 'utf8')),
          schedule: scheduled,
        });
      }
    }

    if (cells.includes('build') && !executionError) {
      const corpusLane = `corpus-n${options.corpusSize ?? 24}`;
      for (const mode of options.buildModes ?? buildModes) {
        assertMember('--build-modes', mode, buildModes);
        for (const [orderIndex, framework] of EXECUTION_ORDER.entries()) {
          const occurrence = occurrenceIndex(orderIndex, framework);
          const sampleCount = occurrenceCounts[occurrence];
          const warmupCount = warmupCounts[occurrence];
          const host = sampleHost(hostSamples, options.maxLoadPerCpu ?? 1);
          if (!host.comparable) {
            executionError = `host load ${host.loadPerCpu.toFixed(3)} per CPU exceeded ceiling ${host.ceiling}`;
            break;
          }
          const manifest = corpusManifest(framework, options.corpusSize ?? 24);
          const resultFile = path.join(scratch, `${corpusLane}-${orderIndex}-build-${mode}.json`);
          try {
            await runAdapter({
              args: [
                path.join(repoRoot, 'scripts/perf-build-benchmark.mjs'),
                '--framework',
                framework,
                '--corpus',
                manifest,
                '--mode',
                mode,
                '--iterations',
                String(sampleCount),
                '--warmups',
                String(warmupCount),
                '--out',
                resultFile,
              ],
              cwd: repoRoot,
              label: `${corpusLane}/${framework}/build-${mode}/${occurrence}`,
            });
          } catch (error) {
            executionError = error instanceof Error ? error.message : String(error);
            break;
          }
          rawCells.push({
            cell: 'build',
            framework,
            lane: corpusLane,
            mode,
            occurrence,
            report: JSON.parse(await readFile(resultFile, 'utf8')),
          });
        }
        if (executionError) break;
      }
    }

    if (cells.includes('server') && !executionError) {
      for (const [frameworkIndex, framework] of ['kovo', 'nextjs'].entries()) {
        const host = await waitForServerHost(hostSamples, options.maxLoadPerCpu ?? 1, {
          context: `prepare/${framework}`,
          maxWaitMs: options.serverHostSettleMaxMs ?? 30_000,
          pollMs: options.serverHostSettlePollMs ?? 1_000,
        });
        if (!host.comparable) {
          executionError = `host load ${host.loadPerCpu.toFixed(3)} per CPU exceeded ceiling ${host.ceiling}`;
          break;
        }
        const resultFile = path.join(scratch, `server-prepare-${framework}.json`);
        try {
          await runAdapter({
            args: [
              path.join(repoRoot, 'scripts/perf-server-benchmark.mjs'),
              '--framework',
              framework,
              '--prepare-only',
              '--port',
              String((options.serverPortBase ?? 50_310) + frameworkIndex),
              ...(options.skipBuild ? ['--skip-build'] : []),
              ...(options.allowDirty ? ['--allow-dirty'] : []),
              '--out',
              resultFile,
            ],
            cwd: repoRoot,
            label: `server/prepare/${framework}`,
          });
        } catch (error) {
          executionError = error instanceof Error ? error.message : String(error);
          break;
        }
        serverPreparation.push(JSON.parse(await readFile(resultFile, 'utf8')));
      }

      const matrix = serverConditions({
        concurrencies: options.serverConcurrencies ?? SERVER_CONCURRENCIES,
        encodings: options.serverEncodings ?? SERVER_ENCODINGS,
        modes: options.serverModes ?? SERVER_MODES,
        routes: options.serverRoutes ?? SERVER_ROUTES,
      });
      for (const condition of matrix) {
        if (executionError) break;
        const schedule = serverSampleSchedule(options.serverSamples ?? 7);
        for (const [scheduleIndex, scheduled] of schedule.entries()) {
          const host = await waitForServerHost(hostSamples, options.maxLoadPerCpu ?? 1, {
            context: `${condition.key}/${scheduled.framework}/${String(scheduled.occurrence)}`,
            maxWaitMs: options.serverHostSettleMaxMs ?? 30_000,
            pollMs: options.serverHostSettlePollMs ?? 1_000,
          });
          if (!host.comparable) {
            executionError = `host load ${host.loadPerCpu.toFixed(3)} per CPU exceeded ceiling ${host.ceiling}`;
            break;
          }
          const frameworkIndex = scheduled.framework === 'kovo' ? 0 : 1;
          const resultFile = path.join(
            scratch,
            `server-${condition.key}-${String(scheduleIndex)}-${scheduled.framework}.json`,
          );
          try {
            await runAdapter({
              args: [
                path.join(repoRoot, 'scripts/perf-server-benchmark.mjs'),
                '--framework',
                scheduled.framework,
                '--mode',
                condition.mode,
                '--route',
                condition.route,
                '--encoding',
                condition.encoding,
                '--concurrency',
                String(condition.concurrency),
                '--warmup-ms',
                String(options.serverWarmupMs ?? 5_000),
                '--duration-ms',
                String(options.serverDurationMs ?? 15_000),
                '--port',
                String((options.serverPortBase ?? 50_310) + frameworkIndex),
                '--skip-build',
                ...(options.allowDirty ? ['--allow-dirty'] : []),
                '--out',
                resultFile,
              ],
              cwd: repoRoot,
              label: `matched-runtime/${condition.key}/${scheduled.framework}/${String(
                scheduled.occurrence,
              )}`,
            });
          } catch (error) {
            executionError = error instanceof Error ? error.message : String(error);
            break;
          }
          rawCells.push({
            cell: 'server',
            framework: scheduled.framework,
            lane: 'matched-runtime',
            mode: condition.key,
            occurrence: scheduled.occurrence,
            report: JSON.parse(await readFile(resultFile, 'utf8')),
            scheduleIndex,
            serverCondition: condition,
          });
        }
      }
    }

    const analysis = pairedAnalysis(rawCells, {
      bootstrapIterations: options.bootstrapIterations ?? 10_000,
      seed: options.seed ?? 0x4b4f564f,
    });
    const finalProvenance = collectPerformanceProvenance({
      lockFiles,
      repoRoot,
    });
    const sourceStable = sameSourceState(provenance, finalProvenance);
    const report = {
      analysis,
      browserPreparation,
      execution,
      generatedAt: new Date().toISOString(),
      host: performanceHostFingerprint({ browserVersions: observedBrowserVersions(rawCells) }),
      hostSamples,
      integrity: {
        alternatingOrder: EXECUTION_ORDER,
        cells,
        comparator: await comparatorIntegrity(rawCells, {
          browserPreparation,
          cells,
          corpusSize: options.corpusSize ?? 24,
          bfcacheIterations: options.bfcacheIterations ?? 10,
          devIterations: options.devIterations ?? 30,
          devOccurrenceSchedule: devSchedule,
          devReadyIterations: options.devReadyIterations ?? 15,
          devWarmups: options.devWarmups ?? 3,
          iterations,
          lanes: options.lanes ?? lanes,
          lighthouseRuns: options.lighthouseRuns ?? 5,
          modes: options.buildModes ?? buildModes,
          serverConcurrencies: options.serverConcurrencies ?? SERVER_CONCURRENCIES,
          serverDurationMs: options.serverDurationMs ?? 15_000,
          serverEncodings: options.serverEncodings ?? SERVER_ENCODINGS,
          serverHostSettleMaxMs: options.serverHostSettleMaxMs ?? 30_000,
          serverHostSettlePollMs: options.serverHostSettlePollMs ?? 1_000,
          serverModes: options.serverModes ?? SERVER_MODES,
          serverPreparation,
          serverRoutes: options.serverRoutes ?? SERVER_ROUTES,
          serverSamples: options.serverSamples ?? 7,
          serverWarmupMs: options.serverWarmupMs ?? 5_000,
          skipLighthouse: options.skipLighthouse === true,
          source: provenance,
          warmups,
        }),
        comparatorMatched: false,
        executionAuthenticated,
        executionError,
        hostLoadCeilingPerCpu: options.maxLoadPerCpu ?? 1,
        serialized: true,
        sourceStable,
        publishable: !dirtyOverride,
        workloadAuthenticated: workloadIdentity.complete,
      },
      policy: {
        bfcacheIterations: options.bfcacheIterations ?? 10,
        bootstrapIterations: options.bootstrapIterations ?? 10_000,
        browserSamples: iterations,
        devEditSamples: options.devIterations ?? 30,
        devEditSessionSamples: devSchedule.filter(({ framework }) => framework === 'kovo').length,
        devOccurrenceSchedule: devSchedule,
        devReadySamples: options.devReadyIterations ?? 15,
        devWarmups: options.devWarmups ?? 3,
        lighthouseRunsPerCell: options.lighthouseRuns ?? 5,
        server: {
          concurrencies: options.serverConcurrencies ?? SERVER_CONCURRENCIES,
          durationMs: options.serverDurationMs ?? 15_000,
          encodings: options.serverEncodings ?? SERVER_ENCODINGS,
          hostSettleMaxMs: options.serverHostSettleMaxMs ?? 30_000,
          hostSettlePollMs: options.serverHostSettlePollMs ?? 1_000,
          modes: options.serverModes ?? SERVER_MODES,
          routes: options.serverRoutes ?? SERVER_ROUTES,
          samplesPerFrameworkCondition: options.serverSamples ?? 7,
          warmupMs: options.serverWarmupMs ?? 5_000,
        },
        warmups,
      },
      rawCells,
      schema: COMPARE_SCHEMA,
      serverPreparation,
      source: provenance,
      workloadIdentity,
    };
    report.integrity.comparatorMatched = report.integrity.comparator.matched;
    report.verdict = comparisonVerdict(report);
    const output = path.join(outDir, 'comparison.json');
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    if (report.verdict.status !== 'measured') {
      throw new Error(
        `Comparison is unproven: ${report.verdict.reasons.join('; ')}. Evidence preserved at ${output}.`,
      );
    }
    return { output, report };
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
}

export function comparisonVerdict(report) {
  const reasons = [];
  if (report.source?.dirty) reasons.push('source provenance is dirty');
  if (report.integrity?.sourceStable !== true) reasons.push('source provenance changed during run');
  if (report.integrity?.comparatorMatched !== true)
    reasons.push('comparator pairing is incomplete');
  for (const reason of report.integrity?.comparator?.reasons ?? []) reasons.push(reason);
  if (report.integrity?.executionError) reasons.push(report.integrity.executionError);
  if (report.integrity?.executionAuthenticated !== true) {
    reasons.push('execution identity is incomplete');
  } else {
    for (const reason of executionIdentityFindings(report.execution)) reasons.push(reason);
  }
  if (report.integrity?.serialized !== true) reasons.push('cells were not serialized');
  if (report.integrity?.workloadAuthenticated !== true)
    reasons.push('workload identity is incomplete');
  return {
    reasons: [...new Set(reasons)],
    status: reasons.length === 0 ? 'measured' : 'unproven',
  };
}

export function pairedAnalysis(cells, { bootstrapIterations = 10_000, seed = 1 } = {}) {
  const groups = new Map();
  for (const cell of cells) {
    for (const metric of rawMetricSeries(cell)) {
      const key = [cell.lane, cell.cell, cell.mode ?? '', metric.name].join('/');
      const group = groups.get(key) ?? { kovo: new Map(), nextjs: new Map(), metric: metric.name };
      group[cell.framework].set(cell.occurrence, metric.values);
      groups.set(key, group);
    }
  }
  const output = {};
  for (const [key, group] of groups) {
    const pairs = [];
    const kovo = [];
    const nextjs = [];
    const occurrences = [...group.kovo.keys()]
      .filter((occurrence) => group.nextjs.has(occurrence))
      .sort((left, right) => left - right);
    for (const occurrence of occurrences) {
      const kovoValues = group.kovo.get(occurrence) ?? [];
      const nextValues = group.nextjs.get(occurrence) ?? [];
      const samples = Math.min(kovoValues.length, nextValues.length);
      for (let index = 0; index < samples; index += 1) {
        kovo.push(kovoValues[index]);
        nextjs.push(nextValues[index]);
        pairs.push(kovoValues[index] - nextValues[index]);
      }
    }
    if (pairs.length === 0) continue;
    output[key] = {
      kovo: summarize(kovo),
      nextjs: summarize(nextjs),
      pairedDifference: {
        bootstrap95Ci: bootstrapMedianCi(pairs, { iterations: bootstrapIterations, seed }),
        direction: 'kovo-minus-nextjs',
        median: percentile(pairs, 50),
        samples: pairs.length,
      },
    };
    seed += 1;
  }
  return output;
}

function rawMetricSeries(cell) {
  if (cell.cell === 'server' && cell.report?.support?.status === 'unsupported') return [];
  if (cell.cell === 'browser') {
    const app = cell.report.apps?.[0];
    const output = [];
    for (const [condition, scenarios] of Object.entries(app?.conditions ?? {})) {
      for (const [scenario, value] of Object.entries(scenarios ?? {})) {
        if (!Array.isArray(value?.iterations)) continue;
        for (const name of numericLeafNames(value.iterations)) {
          output.push({
            name: `${condition}.${scenario}.${name}`,
            values: value.iterations
              .map((iteration) => readLeaf(iteration, name))
              .filter(Number.isFinite),
          });
        }
      }
    }
    return output;
  }
  if (cell.cell === 'dev') {
    return devMetricSeries(cell.report);
  }
  const samples = cell.report.samples ?? cell.report.rawSamples ?? [];
  return prefixedMetricSeries(samples);
}

function devMetricSeries(report) {
  const editSamples = report?.samples ?? [];
  const readySamples = report?.readySamples ?? [];
  const editPeakRssBytes = report?.editSession?.peakRssBytes;
  return [
    ...prefixedMetricSeries(editSamples, 'edit', { requireComplete: true }),
    ...prefixedMetricSeries(readySamples, 'ready', { requireComplete: true }),
    ...DEV_EDIT_CLASSES.map((editClass) => ({
      name: `edit.${editClass}StateSurvived`,
      values: editSamples.map((sample) => (sample?.[`${editClass}StateSurvived`] === true ? 1 : 0)),
    })),
    {
      name: 'edit.sampleAvailable',
      values: editSamples.map((sample) => (devEditSampleAvailable(sample) ? 1 : 0)),
    },
    {
      name: 'edit.syntaxErrorDiagnosticAvailable',
      values: editSamples.map((sample) =>
        typeof sample?.syntaxErrorDiagnosticSignal === 'string' &&
        sample.syntaxErrorDiagnosticSignal.length > 0
          ? 1
          : 0,
      ),
    },
    {
      name: 'edit.peakRssBytes',
      values: Number.isFinite(editPeakRssBytes) ? [editPeakRssBytes] : [],
    },
    {
      name: 'ready.successAvailable',
      values: readySamples.map((sample) => (sample?.success === true ? 1 : 0)),
    },
  ];
}

function devEditSampleAvailable(sample) {
  return (
    DEV_EDIT_CLASSES.every(
      (editClass) =>
        Number.isFinite(sample?.[`${editClass}Ms`]) &&
        sample?.[`${editClass}StateSurvived`] === true,
    ) &&
    typeof sample?.syntaxErrorDiagnosticSignal === 'string' &&
    sample.syntaxErrorDiagnosticSignal.length > 0
  );
}

function prefixedMetricSeries(samples, prefix = '', { requireComplete = false } = {}) {
  return numericLeafNames(samples)
    .map((name) => ({
      name: prefix ? `${prefix}.${name}` : name,
      values: samples.map((sample) => readLeaf(sample, name)).filter(Number.isFinite),
    }))
    .filter((series) => !requireComplete || series.values.length === samples.length);
}

function numericLeafNames(values) {
  const names = new Set();
  for (const value of values) visitLeaves(value, '', names);
  return [...names].sort();
}

function visitLeaves(value, prefix, names) {
  for (const [key, child] of Object.entries(value ?? {})) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child))
      visitLeaves(child, name, names);
    else if (Number.isFinite(child)) names.add(name);
  }
}

function readLeaf(value, name) {
  return name.split('.').reduce((child, key) => child?.[key], value);
}

export function summarize(values) {
  return {
    mad: percentile(
      values.map((value) => Math.abs(value - percentile(values, 50))),
      50,
    ),
    median: percentile(values, 50),
    p95: percentile(values, 95),
    samples: values.length,
  };
}

export function bootstrapMedianCi(values, { iterations = 10_000, seed = 1 } = {}) {
  if (values.length === 0) return [null, null];
  const random = seededRandom(seed);
  const medians = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const resample = Array.from(
      { length: values.length },
      () => values[Math.floor(random() * values.length)],
    );
    medians.push(percentile(resample, 50));
  }
  return [percentile(medians, 2.5), percentile(medians, 97.5)];
}

function percentile(values, pct) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1)];
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function splitAcrossOccurrences(total) {
  if (!Number.isInteger(total) || total < 0)
    throw new Error(`Sample total must be >= 0, got ${total}.`);
  return [Math.ceil(total / 2), Math.floor(total / 2)];
}

/** Split declared dev totals across the serialized K,N,N,K occurrences exactly once. */
export function devSampleSchedule({ editSamples, readySamples, warmups }) {
  const editCounts = splitAcrossOccurrences(
    boundedComparisonInteger(editSamples, 2, 100, 'dev edit samples'),
  );
  const readyCounts = splitAcrossOccurrences(
    boundedComparisonInteger(readySamples, 2, 100, 'dev ready samples'),
  );
  const warmupCounts = splitAcrossOccurrences(
    boundedComparisonInteger(warmups, 0, 10, 'dev warmups'),
  );
  const occurrences = { kovo: 0, nextjs: 0 };
  return EXECUTION_ORDER.map((framework, scheduleIndex) => {
    const occurrence = occurrences[framework]++;
    return {
      editSamples: editCounts[occurrence],
      framework,
      occurrence,
      readySamples: readyCounts[occurrence],
      scheduleIndex,
      warmups: warmupCounts[occurrence],
    };
  });
}

function boundedComparisonInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(
      `${label} must be an integer from ${String(minimum)} through ${String(maximum)}.`,
    );
  }
  return value;
}

/** Repeat K,N,N,K and truncate only after both frameworks own the requested sample count. */
export function serverSampleSchedule(samples = 7) {
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 100) {
    throw new Error(`Server samples must be an integer between 1 and 100, got ${String(samples)}.`);
  }
  const counts = { kovo: 0, nextjs: 0 };
  const schedule = [];
  while (counts.kovo < samples || counts.nextjs < samples) {
    for (const framework of EXECUTION_ORDER) {
      if (counts[framework] >= samples) continue;
      schedule.push({ framework, occurrence: counts[framework] });
      counts[framework] += 1;
    }
  }
  return schedule;
}

function occurrenceIndex(orderIndex, framework) {
  return EXECUTION_ORDER.slice(0, orderIndex + 1).filter((value) => value === framework).length - 1;
}

function corpusManifest(framework, size) {
  return path.join(benchmarkRoot, framework, '.corpora', framework, `n${size}`, 'manifest.json');
}

function sampleHost(samples, ceiling) {
  const sample = {
    at: new Date().toISOString(),
    loadAverage: os.loadavg(),
    loadPerCpu: os.loadavg()[0] / os.cpus().length,
  };
  samples.push(sample);
  return { ...sample, ceiling, comparable: sample.loadPerCpu <= ceiling };
}

/**
 * Wait only between serialized server cells, preserving every rejected load sample. This prevents
 * the previous build/sample's one-minute load average from becoming an immediate false abort while
 * retaining a hard upper bound on settling.
 */
export async function waitForServerHost(
  samples,
  ceiling,
  {
    context = 'server',
    maxWaitMs = 30_000,
    now = Date.now,
    pollMs = 1_000,
    readLoad = () => ({ loadAverage: os.loadavg(), logicalCpuCount: os.cpus().length }),
    wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {},
) {
  if (!Number.isFinite(ceiling) || ceiling <= 0) throw new TypeError('host ceiling is invalid');
  if (!Number.isSafeInteger(maxWaitMs) || maxWaitMs < 0 || maxWaitMs > 300_000)
    throw new TypeError('server host settle max wait must be between 0 and 300000ms');
  if (!Number.isSafeInteger(pollMs) || pollMs < 10 || pollMs > 60_000)
    throw new TypeError('server host settle poll must be between 10 and 60000ms');
  const startedAt = now();
  let attempt = 0;
  while (true) {
    const observed = readLoad();
    const loadAverage = observed.loadAverage;
    const logicalCpuCount = observed.logicalCpuCount;
    const loadPerCpu = loadAverage?.[0] / logicalCpuCount;
    const waitedMs = Math.max(0, now() - startedAt);
    const sample = {
      at: new Date().toISOString(),
      attempt,
      context,
      loadAverage,
      loadPerCpu,
      logicalCpuCount,
      phase: 'server-quiet-host-settle',
      waitedMs,
    };
    samples.push(sample);
    if (Number.isFinite(loadPerCpu) && loadPerCpu >= 0 && loadPerCpu <= ceiling) {
      return { ...sample, ceiling, comparable: true };
    }
    if (waitedMs >= maxWaitMs) return { ...sample, ceiling, comparable: false };
    const remainingMs = maxWaitMs - waitedMs;
    await wait(Math.min(pollMs, remainingMs));
    attempt += 1;
  }
}

function assertServerMatrixOptions(options) {
  for (const concurrency of options.serverConcurrencies ?? SERVER_CONCURRENCIES)
    assertMember('--server-concurrencies', concurrency, SERVER_CONCURRENCIES);
  for (const encoding of options.serverEncodings ?? SERVER_ENCODINGS)
    assertMember('--server-encodings', encoding, SERVER_ENCODINGS);
  for (const mode of options.serverModes ?? SERVER_MODES)
    assertMember('--server-modes', mode, SERVER_MODES);
  for (const route of options.serverRoutes ?? SERVER_ROUTES)
    assertMember('--server-routes', route, SERVER_ROUTES);
  serverSampleSchedule(options.serverSamples ?? 7);
  boundedServerSettleOption(options.serverHostSettleMaxMs ?? 30_000, 0, 300_000, 'max');
  boundedServerSettleOption(options.serverHostSettlePollMs ?? 1_000, 10, 60_000, 'poll');
}

function boundedServerSettleOption(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(
      `server host settle ${label} must be between ${String(min)} and ${String(max)}ms`,
    );
  }
}

async function runAdapter({ args, cwd, label }) {
  await runChildProcess({ args, command: process.execPath, cwd, label });
}

async function runChildProcess({ args, command, cwd, label }) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: process.platform !== 'win32',
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed (code ${code}, signal ${signal}).`));
    });
    const forward = () => {
      if (child.exitCode !== null) return;
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    };
    process.once('SIGINT', forward);
    process.once('SIGTERM', forward);
    child.once('exit', () => {
      process.removeListener('SIGINT', forward);
      process.removeListener('SIGTERM', forward);
    });
  });
}

async function prepareBrowserEntrants() {
  const definitions = [
    {
      artifacts: [path.join(repoRoot, 'benchmarks/kovo/dist/server/server.mjs')],
      command: ['exec', 'pnpm', '--dir', 'benchmarks/kovo', 'run', 'build'],
      framework: 'kovo',
    },
    {
      artifacts: [
        path.join(repoRoot, 'benchmarks/nextjs/.next/standalone/benchmarks/nextjs/server.js'),
      ],
      command: ['exec', 'pnpm', '--dir', 'benchmarks/nextjs', 'run', 'build'],
      framework: 'nextjs',
      generatedInput: path.join(repoRoot, 'benchmarks/nextjs/next-env.d.ts'),
    },
  ];
  const reports = [];
  for (const definition of definitions) {
    const source = collectPerformanceProvenance({ lockFiles, repoRoot });
    const errors = [];
    const generatedSnapshot =
      definition.generatedInput === undefined
        ? undefined
        : await readFile(definition.generatedInput);
    try {
      await runChildProcess({
        args: definition.command,
        command: 'vp',
        cwd: repoRoot,
        label: `browser/prepare/${definition.framework}`,
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      if (definition.generatedInput !== undefined) {
        await writeFile(definition.generatedInput, generatedSnapshot);
      }
    }
    const sourceAfter = collectPerformanceProvenance({ lockFiles, repoRoot });
    const missingArtifacts = definition.artifacts
      .filter((artifact) => !existsSync(artifact))
      .map((artifact) => path.relative(repoRoot, artifact));
    const sourceStable = sameSourceState(source, sourceAfter);
    if (!sourceStable) errors.push('source provenance changed during browser preparation');
    if (missingArtifacts.length > 0) {
      errors.push(`production artifacts are missing: ${missingArtifacts.join(', ')}`);
    }
    reports.push({
      artifacts: definition.artifacts.map((artifact) => path.relative(repoRoot, artifact)),
      framework: definition.framework,
      integrity: {
        complete: errors.length === 0 && !source.dirty,
        errors,
        publishable: !source.dirty,
        sourceStable,
      },
      schema: BROWSER_PREPARE_SCHEMA,
      source,
      sourceAfter,
    });
  }
  return reports;
}

function assertMember(flag, value, allowed) {
  if (!allowed.includes(value)) {
    throw new Error(`${flag} includes ${value}; expected ${allowed.join(', ')}.`);
  }
}

function sameSourceState(left, right) {
  return (
    left.commit === right.commit &&
    JSON.stringify(left.dirtyPaths) === JSON.stringify(right.dirtyPaths) &&
    JSON.stringify(left.locks) === JSON.stringify(right.locks)
  );
}

async function comparatorIntegrity(cells, policy) {
  const reasons = [];
  let serverMatrix = {
    completeSupportedMatrix: true,
    excludedUnsupported: [],
    supported: [],
  };
  const occurrenceCounts = splitAcrossOccurrences(policy.iterations);
  const warmupCounts = splitAcrossOccurrences(policy.warmups);
  const bfcacheCounts = splitAcrossOccurrences(policy.bfcacheIterations);
  const lighthouseCounts = splitAcrossOccurrences(policy.lighthouseRuns);
  const devSchedule = policy.cells.includes('dev')
    ? devSampleSchedule({
        editSamples: policy.devIterations,
        readySamples: policy.devReadyIterations,
        warmups: policy.devWarmups,
      })
    : [];
  const keys = new Map();
  for (const cell of cells) {
    const key = [cell.lane, cell.cell, cell.mode ?? ''].join('/');
    const frameworks = keys.get(key) ?? new Set();
    frameworks.add(cell.framework);
    keys.set(key, frameworks);
  }
  const expected = [];
  for (const cell of policy.cells) {
    const cellLanes =
      cell === 'browser'
        ? policy.lanes
        : cell === 'server'
          ? ['matched-runtime']
          : [`corpus-n${policy.corpusSize}`];
    for (const lane of cellLanes) {
      const modes =
        cell === 'build'
          ? policy.modes
          : cell === 'server'
            ? serverConditions({
                concurrencies: policy.serverConcurrencies,
                encodings: policy.serverEncodings,
                modes: policy.serverModes,
                routes: policy.serverRoutes,
              }).map((condition) => condition.key)
            : [''];
      for (const mode of modes) {
        expected.push([lane, cell, mode].join('/'));
      }
    }
  }
  for (const key of expected) {
    const expectedCell = key.split('/')[1];
    const relevant = cells.filter(
      (cell) => [cell.lane, cell.cell, cell.mode ?? ''].join('/') === key,
    );
    for (const framework of ['kovo', 'nextjs']) {
      const occurrences = relevant.filter((cell) => cell.framework === framework);
      const expectedOccurrences = expectedCell === 'server' ? policy.serverSamples : 2;
      if (occurrences.length !== expectedOccurrences)
        reasons.push(
          `${key}/${framework} did not produce ${String(expectedOccurrences)} occurrences`,
        );
      if (
        occurrences.length === expectedOccurrences &&
        occurrences
          .map((cell) => cell.occurrence)
          .sort((left, right) => left - right)
          .join(',') !== Array.from({ length: expectedOccurrences }, (_, index) => index).join(',')
      ) {
        reasons.push(`${key}/${framework} occurrence identities were incomplete`);
      }
      for (const occurrence of occurrences) {
        const scheduledDev = devSchedule.find(
          (entry) => entry.framework === framework && entry.occurrence === occurrence.occurrence,
        );
        const expectedSamples =
          occurrence.cell === 'dev'
            ? scheduledDev?.editSamples
            : occurrence.cell === 'server'
              ? 1
              : occurrenceCounts[occurrence.occurrence];
        if (occurrence.cell === 'browser') {
          validateBrowserCell(occurrence, {
            bfcache: Math.max(1, bfcacheCounts[occurrence.occurrence]),
            lighthouse: Math.max(1, lighthouseCounts[occurrence.occurrence]),
            measured: expectedSamples,
            reasons,
            skipLighthouse: policy.skipLighthouse,
            warmups: warmupCounts[occurrence.occurrence],
          });
        } else if (
          !(occurrence.cell === 'server' && occurrence.report?.support?.status === 'unsupported') &&
          cellSampleCount(occurrence) !== expectedSamples
        ) {
          reasons.push(
            `${key}/${framework}/${occurrence.occurrence} expected ${expectedSamples} raw samples`,
          );
        }
        if (occurrence.cell === 'build') {
          if (occurrence.report?.framework !== framework)
            reasons.push(`${key}/${framework} report identity mismatch`);
          if (occurrence.report?.integrity?.iterations !== expectedSamples)
            reasons.push(`${key}/${framework} iteration policy mismatch`);
          if (occurrence.report?.integrity?.warmups !== warmupCounts[occurrence.occurrence])
            reasons.push(`${key}/${framework} warmup policy mismatch`);
        } else if (occurrence.cell === 'dev') {
          if (scheduledDev === undefined) {
            reasons.push(`${key}/${framework}/${occurrence.occurrence} schedule is unavailable`);
          } else {
            validateDevCell(occurrence, {
              iterations: scheduledDev.editSamples,
              readyIterations: scheduledDev.readySamples,
              reasons,
              schedule: scheduledDev,
              warmups: scheduledDev.warmups,
            });
          }
        } else if (occurrence.cell === 'server') {
          validateServerCell(occurrence, { policy, reasons });
        }
      }
    }
    const expectedOrder =
      expectedCell === 'server'
        ? serverSampleSchedule(policy.serverSamples).map((value) => value.framework)
        : EXECUTION_ORDER;
    if (relevant.map((cell) => cell.framework).join(',') !== expectedOrder.join(',')) {
      reasons.push(`${key} execution order did not match ${expectedOrder.join(',')}`);
    }
  }
  if ([...keys.keys()].some((key) => !expected.includes(key)))
    reasons.push('unexpected comparator cell');

  if (policy.cells.includes('server')) {
    serverMatrix = classifyServerMatrixCells(cells, {
      conditionKeys: serverConditions({
        concurrencies: policy.serverConcurrencies,
        encodings: policy.serverEncodings,
        modes: policy.serverModes,
        routes: policy.serverRoutes,
      }).map((condition) => condition.key),
      samples: policy.serverSamples,
    });
    reasons.push(...serverMatrix.findings);
  }

  const corpusDigests = {};
  if (policy.cells.includes('dev') || policy.cells.includes('build')) {
    for (const framework of ['kovo', 'nextjs']) {
      try {
        const manifest = JSON.parse(
          await readFile(corpusManifest(framework, policy.corpusSize), 'utf8'),
        );
        corpusDigests[framework] = manifest.shapeDigest;
      } catch {
        corpusDigests[framework] = null;
        reasons.push(`${framework} corpus manifest is unavailable`);
      }
    }
    if (!corpusDigests.kovo || corpusDigests.kovo !== corpusDigests.nextjs) {
      reasons.push('Kovo/Next corpus shapeDigest mismatch');
    }
  }
  if (policy.cells.includes('browser')) {
    for (const framework of ['kovo', 'nextjs']) {
      const preparation = policy.browserPreparation.filter(
        (report) => report.framework === framework,
      );
      const report = preparation[0];
      if (
        preparation.length !== 1 ||
        report?.schema !== BROWSER_PREPARE_SCHEMA ||
        report?.integrity?.complete !== true ||
        report?.source?.commit !== policy.source.commit ||
        !requiredLocksMatch(report?.source?.locks, policy.source.locks) ||
        report?.sourceAfter?.commit !== report?.source?.commit ||
        JSON.stringify(report?.sourceAfter?.locks) !== JSON.stringify(report?.source?.locks) ||
        report?.source?.dirty ||
        report?.sourceAfter?.dirty
      ) {
        reasons.push(`browser/${framework} preparation evidence is incomplete`);
      }
    }
  }
  if (policy.cells.includes('server')) {
    for (const framework of ['kovo', 'nextjs']) {
      const preparation = policy.serverPreparation.filter(
        (report) => report.framework === framework,
      );
      const report = preparation[0];
      if (
        preparation.length !== 1 ||
        report?.schema !== SERVER_PREPARE_SCHEMA ||
        report?.integrity?.complete !== true ||
        report?.source?.commit !== policy.source.commit ||
        !requiredLocksMatch(report?.source?.locks, policy.source.locks) ||
        !validHostFingerprint(report?.host) ||
        report?.sourceAfter?.commit !== report?.source?.commit ||
        JSON.stringify(report?.sourceAfter?.locks) !== JSON.stringify(report?.source?.locks) ||
        report?.source?.dirty ||
        report?.sourceAfter?.dirty
      ) {
        reasons.push(`server/${framework} preparation evidence is incomplete`);
      }
    }
  }

  for (const cell of cells) {
    if (!cell.report?.source) {
      reasons.push(`${cell.lane}/${cell.framework}/${cell.cell} missing source provenance`);
    } else {
      if (cell.report.source.commit !== policy.source.commit)
        reasons.push('cell source commit mismatch');
      if (!requiredLocksMatch(cell.report.source.locks, policy.source.locks)) {
        reasons.push('cell lock provenance mismatch');
      }
      if (cell.report.source.dirty)
        reasons.push(`${cell.lane}/${cell.framework}/${cell.cell} source is dirty`);
    }
    if (cell.cell === 'browser') {
      const samples = browserSamples(cell);
      if (
        samples.some(
          (sample) =>
            sample.errorResponses > 0 ||
            sample.failedRequests > 0 ||
            sample.rateLimitedResponses > 0 ||
            sample.pageErrors > 0 ||
            sample.settleTimedOut > 0 ||
            sample.navSettleTimedOut > 0,
        )
      ) {
        reasons.push(`${cell.lane}/${cell.framework} browser integrity failure`);
      }
    } else if (
      cell.report?.integrity?.complete === false ||
      (cell.report?.integrity?.errors?.length ?? 0) > 0 ||
      (cell.report?.integrity?.misses ?? 0) > 0 ||
      cell.report?.verdict?.status === 'unproven'
    ) {
      reasons.push(`${cell.lane}/${cell.framework}/${cell.mode ?? cell.cell} integrity failure`);
    }
    if (cell.cell === 'build') {
      if (cell.report?.corpus?.shapeDigest !== corpusDigests[cell.framework]) {
        reasons.push(`${cell.lane}/${cell.framework}/${cell.mode} corpus digest mismatch`);
      }
      if (cell.report?.mode !== cell.mode)
        reasons.push(`${cell.lane}/${cell.framework}/${cell.mode} mode mismatch`);
    } else if (cell.cell === 'dev') {
      if (cell.report?.corpus?.shapeDigest !== corpusDigests[cell.framework]) {
        reasons.push(`${cell.lane}/${cell.framework}/dev corpus digest mismatch`);
      }
    }
  }
  return {
    corpusDigests,
    matched: reasons.length === 0,
    reasons: [...new Set(reasons)].sort(),
    serverMatrix,
  };
}

/**
 * Partition the server matrix into paired timing cells and authenticated capability exclusions.
 * Unsupported cells remain in raw evidence but can never contribute numeric samples.
 */
export function classifyServerMatrixCells(cells, { conditionKeys, samples }) {
  const findings = [];
  const supported = [];
  const excludedUnsupported = [];
  for (const condition of conditionKeys) {
    const statuses = {};
    for (const framework of ['kovo', 'nextjs']) {
      const occurrences = cells.filter(
        (cell) =>
          cell.cell === 'server' &&
          cell.lane === 'matched-runtime' &&
          cell.mode === condition &&
          cell.framework === framework,
      );
      if (occurrences.length !== samples) {
        findings.push(
          `matched-runtime/server/${condition}/${framework} support census is incomplete`,
        );
        statuses[framework] = 'incomplete';
        continue;
      }
      const observed = [
        ...new Set(occurrences.map((cell) => cell.report?.support?.status ?? 'missing')),
      ];
      if (observed.length !== 1 || (observed[0] !== 'supported' && observed[0] !== 'unsupported')) {
        findings.push(
          `matched-runtime/server/${condition}/${framework} support status is inconsistent`,
        );
        statuses[framework] = 'incomplete';
      } else {
        statuses[framework] = observed[0];
      }
    }
    if (statuses.kovo === 'supported' && statuses.nextjs === 'supported') {
      supported.push(condition);
    } else if (
      (statuses.kovo === 'supported' || statuses.kovo === 'unsupported') &&
      (statuses.nextjs === 'supported' || statuses.nextjs === 'unsupported') &&
      (statuses.kovo === 'unsupported' || statuses.nextjs === 'unsupported')
    ) {
      excludedUnsupported.push({
        condition,
        unsupportedFrameworks: ['kovo', 'nextjs'].filter(
          (framework) => statuses[framework] === 'unsupported',
        ),
      });
    }
  }
  return {
    completeSupportedMatrix: findings.length === 0,
    excludedUnsupported,
    findings,
    supported,
  };
}

function validateDevCell(cell, expected) {
  const report = cell.report;
  const key = `${cell.lane}/${cell.framework}/dev`;
  if (report?.framework !== cell.framework)
    expected.reasons.push(`${key} report identity mismatch`);
  if (report?.integrity?.iterations !== expected.iterations)
    expected.reasons.push(`${key} iteration policy mismatch`);
  if (report?.integrity?.readyIterations !== expected.readyIterations)
    expected.reasons.push(`${key} ready iteration policy mismatch`);
  if (report?.integrity?.warmups !== expected.warmups)
    expected.reasons.push(`${key} warmup policy mismatch`);
  if (report?.readySamples?.length !== expected.readyIterations)
    expected.reasons.push(`${key} ready sample count mismatch`);
  if (JSON.stringify(cell.schedule) !== JSON.stringify(expected.schedule)) {
    expected.reasons.push(`${key} occurrence schedule mismatch`);
  }
  if (
    report?.sourceAfter?.commit !== report?.source?.commit ||
    JSON.stringify(report?.sourceAfter?.locks) !== JSON.stringify(report?.source?.locks) ||
    report?.sourceAfter?.dirty ||
    report?.integrity?.source?.stable !== true
  ) {
    expected.reasons.push(`${key} source stability failure`);
  }
  const editClasses = ['leaf', 'entry', 'data', 'syntaxError', 'recovery'];
  for (const editClass of editClasses) {
    if (report?.integrity?.editCounts?.[editClass] !== expected.iterations) {
      expected.reasons.push(`${key} ${editClass} count mismatch`);
    }
  }
  if (
    report?.integrity?.browser?.unexpectedErrorCount !== 0 ||
    report?.integrity?.browser?.requestFailedCount !== 0 ||
    !(report?.integrity?.browser?.responseCount > 0)
  ) {
    expected.reasons.push(`${key} browser error evidence`);
  }
}

export function validateServerCell(cell, expected) {
  const report = cell.report;
  const key = `${cell.lane}/${cell.framework}/${cell.mode}`;
  if (report?.schema !== SERVER_BENCHMARK_SCHEMA)
    expected.reasons.push(`${key} report schema mismatch`);
  if (report?.framework !== cell.framework)
    expected.reasons.push(`${key} report identity mismatch`);
  if (report?.condition?.key !== cell.mode)
    expected.reasons.push(`${key} condition identity mismatch`);
  const unsupported = report?.support?.status === 'unsupported';
  if (unsupported) {
    const correctness = report?.correctness;
    if (
      cell.framework !== 'nextjs' ||
      report?.condition?.encoding !== 'br' ||
      report?.integrity?.complete !== true ||
      report?.integrity?.timingExcluded !== true ||
      report?.integrity?.misses !== 0 ||
      (report?.integrity?.errors?.length ?? -1) !== 0 ||
      report?.verdict?.status !== 'unsupported' ||
      report?.samples?.length !== 0 ||
      report?.support?.requestedContentEncoding !== 'br' ||
      report?.support?.observedContentEncoding !== null ||
      report?.support?.reason !== 'requested Brotli returned the identity representation' ||
      correctness?.status !== 200 ||
      correctness?.requestAcceptEncoding !== 'br' ||
      correctness?.requestIfNoneMatch !== null ||
      correctness?.contentEncoding !== null ||
      correctness?.bodySha256 !== correctness?.wireBodySha256 ||
      correctness?.bodyBytes !== correctness?.wireBodyBytes ||
      !/^sha256:[0-9a-f]{64}$/u.test(correctness?.bodySha256 ?? '') ||
      !correctness?.exactResponseHeaders ||
      correctness?.identityResponse?.status !== 200 ||
      correctness?.selectedResponse?.status !== 200 ||
      correctness?.selectedResponse?.contentEncoding !== null ||
      correctness?.selectedResponse?.bodySha256 !== correctness?.bodySha256
    ) {
      expected.reasons.push(`${key} unsupported response proof failure`);
    }
  } else {
    if (
      report?.support?.status !== 'supported' ||
      report?.integrity?.complete !== true ||
      report?.integrity?.timingExcluded !== false ||
      report?.verdict?.status !== 'measured'
    ) {
      expected.reasons.push(`${key} report is unproven`);
    }
    if (
      report?.integrity?.misses !== 0 ||
      report?.samples?.length !== 1 ||
      report.samples[0]?.misses !== 0 ||
      report.samples[0]?.failedRequests !== 0 ||
      !(report.samples[0]?.requests > 0) ||
      !(report.samples[0]?.reusedSockets > 0)
    ) {
      expected.reasons.push(`${key} request integrity failure`);
    }
    if (
      report?.correctness?.status !== (report?.condition?.mode === '304' ? 304 : 200) ||
      !/^sha256:[0-9a-f]{64}$/u.test(report?.correctness?.bodySha256 ?? '') ||
      !report?.correctness?.exactResponseHeaders ||
      (report?.condition?.encoding === 'br' &&
        report?.condition?.mode !== '304' &&
        report?.correctness?.contentEncoding !== 'br')
    ) {
      expected.reasons.push(`${key} response proof failure`);
    }
  }
  if (
    report?.condition?.concurrency !== cell.serverCondition?.concurrency ||
    report?.condition?.encoding !== cell.serverCondition?.encoding ||
    report?.condition?.mode !== cell.serverCondition?.mode ||
    report?.condition?.route !== cell.serverCondition?.route
  ) {
    expected.reasons.push(`${key} scheduled condition mismatch`);
  }
  if (
    report?.optimization?.provedDocumentCompressionCache !==
    (cell.framework === 'kovo' ? 'enabled' : 'not-applicable')
  ) {
    expected.reasons.push(`${key} optimization posture mismatch`);
  }
  if (
    report?.policy?.durationMs !== expected.policy.serverDurationMs ||
    report?.policy?.warmupMs !== expected.policy.serverWarmupMs ||
    (!unsupported &&
      (report?.samples?.[0]?.durationMs < expected.policy.serverDurationMs ||
        report?.samples?.[0]?.processTreeSamples < 1 ||
        !(report?.samples?.[0]?.peakRssBytes > 0) ||
        !Number.isFinite(report?.samples?.[0]?.serverCpuPercent)))
  ) {
    expected.reasons.push(`${key} timing/CPU/RSS evidence failure`);
  }
  if (
    report?.sourceAfter?.commit !== report?.source?.commit ||
    JSON.stringify(report?.sourceAfter?.locks) !== JSON.stringify(report?.source?.locks) ||
    report?.sourceAfter?.dirty ||
    report?.integrity?.sourceStable !== true
  ) {
    expected.reasons.push(`${key} source stability failure`);
  }
  if (!validHostFingerprint(report?.environment?.host)) {
    expected.reasons.push(`${key} host fingerprint failure`);
  }
}

function validateBrowserCell(cell, expected) {
  if (cell.report?.schema !== BROWSER_BENCHMARK_SCHEMA)
    expected.reasons.push(`${cell.lane}/${cell.framework} browser report schema mismatch`);
  if (cell.report.apps?.length !== 1)
    expected.reasons.push(`${cell.lane}/${cell.framework} expected exactly one app report`);
  const app = cell.report.apps?.[0];
  if (app?.app !== cell.framework)
    expected.reasons.push(`${cell.lane}/${cell.framework} app identity mismatch`);
  const expectedFramework = cell.framework === 'kovo' ? 'Kovo' : 'Next.js App Router';
  if (app?.framework !== expectedFramework)
    expected.reasons.push(`${cell.lane}/${cell.framework} framework identity mismatch`);
  if (cell.report.lane !== cell.lane)
    expected.reasons.push(`${cell.lane}/${cell.framework} lane identity mismatch`);
  if (cell.report.iterations !== expected.measured)
    expected.reasons.push(`${cell.lane}/${cell.framework} iteration policy mismatch`);
  if (cell.report.warmups !== expected.warmups)
    expected.reasons.push(`${cell.lane}/${cell.framework} warmup policy mismatch`);
  if (app?.posture?.nodeEnv !== 'production')
    expected.reasons.push(`${cell.lane}/${cell.framework} production posture mismatch`);
  const listingPath =
    cell.lane === 'default' ? '/' : cell.lane === 'matched-l0' ? '/matched/l0' : '/matched/l1';
  const selectedScenarios =
    cell.lane === 'matched-l0'
      ? ['coldLoad', 'navigation']
      : ['coldLoad', 'ttiProbe', 'navigation'];
  for (const finding of browserReportIntegrityFindings(app, {
    bfcacheIterations: expected.bfcache,
    iterations: expected.measured,
    lighthouseRepeats: expected.skipLighthouse ? 0 : expected.lighthouse,
    listingPath,
    scenarios: selectedScenarios,
    warmups: expected.warmups,
  })) {
    expected.reasons.push(`${cell.lane}/${cell.framework} ${finding}`);
  }
  try {
    if (new URL(app?.origin).hostname !== 'localhost')
      expected.reasons.push(`${cell.lane}/${cell.framework} hostname mismatch`);
  } catch {
    expected.reasons.push(`${cell.lane}/${cell.framework} origin is invalid`);
  }
  const expectedScenarios =
    cell.lane === 'matched-l0'
      ? { coldLoad: expected.measured, navigation: expected.measured, ttiProbe: 0 }
      : {
          coldLoad: expected.measured,
          navigation: expected.measured,
          ttiProbe: expected.measured,
        };
  for (const conditionName of ['desktop', 'mobile']) {
    const condition = app?.conditions?.[conditionName];
    for (const [scenarioName, sampleCount] of Object.entries(expectedScenarios)) {
      const samples = condition?.[scenarioName]?.iterations;
      if (!Array.isArray(samples) || samples.length !== sampleCount) {
        expected.reasons.push(
          `${cell.lane}/${cell.framework}/${conditionName}/${scenarioName} expected ${sampleCount} samples`,
        );
        continue;
      }
      if (scenarioName === 'coldLoad' && samples.some((sample) => !fixtureProof(sample, cell))) {
        expected.reasons.push(
          `${cell.lane}/${cell.framework}/${conditionName} fixture proof failed`,
        );
      }
      if (
        scenarioName === 'ttiProbe' &&
        samples.some((sample) => !ttiInteractionProof(sample, cell.lane))
      ) {
        expected.reasons.push(
          `${cell.lane}/${cell.framework}/${conditionName} interaction proof failed`,
        );
      }
      if (
        scenarioName === 'navigation' &&
        samples.some(
          (sample) =>
            sample.navPaintBoundary !== 'first-traced-frame-after-destination-marker' ||
            !Number.isFinite(sample.navToPaintMs) ||
            !Number.isFinite(sample.traceMarkerEpochSkewMs) ||
            Math.abs(sample.traceMarkerEpochSkewMs) > 250 ||
            !Number.isFinite(sample.sessionBytes?.throughClick?.total) ||
            !Number.isFinite(sample.sessionBytes?.throughDestinationPaint?.total),
        )
      ) {
        expected.reasons.push(
          `${cell.lane}/${cell.framework}/${conditionName} navigation proof failed`,
        );
      }
    }
  }
  if (!expected.skipLighthouse) {
    if (app?.lighthouse?.length !== 4)
      expected.reasons.push(`${cell.lane}/${cell.framework} Lighthouse cells incomplete`);
    const productPath = `${listingPath === '/' ? '' : listingPath}/product/linen-field-jacket`;
    const expectedCells = new Set([
      `desktop:${listingPath}`,
      `desktop:${productPath}`,
      `mobile:${listingPath}`,
      `mobile:${productPath}`,
    ]);
    const actualCells = new Set(
      (app?.lighthouse ?? []).map((entry) => `${entry.formFactor}:${entry.path}`),
    );
    if (
      actualCells.size !== expectedCells.size ||
      [...expectedCells].some((identity) => !actualCells.has(identity))
    ) {
      expected.reasons.push(`${cell.lane}/${cell.framework} Lighthouse identity mismatch`);
    }
    for (const lighthouse of app?.lighthouse ?? []) {
      if (
        lighthouse.repeats !== expected.lighthouse ||
        lighthouse.samples?.length !== expected.lighthouse
      )
        expected.reasons.push(`${cell.lane}/${cell.framework} Lighthouse repeats mismatch`);
      if (Object.values(lighthouse.nullSamples ?? {}).some((value) => value !== 0))
        expected.reasons.push(`${cell.lane}/${cell.framework} Lighthouse null sample`);
      if (Object.values(lighthouse.metrics ?? {}).some((value) => !Number.isFinite(value)))
        expected.reasons.push(`${cell.lane}/${cell.framework} Lighthouse metric missing`);
      if (
        lighthouse.network?.tracked !== true ||
        lighthouse.network.errorResponses > 0 ||
        lighthouse.network.rateLimitedResponses > 0
      )
        expected.reasons.push(
          `${cell.lane}/${cell.framework} Lighthouse network integrity failure`,
        );
    }
  } else if ((app?.lighthouse?.length ?? 0) !== 0) {
    expected.reasons.push(`${cell.lane}/${cell.framework} unexpected Lighthouse cells`);
  }
  if (app?.bfcache?.available !== true || app?.bfcache?.iterations?.length !== expected.bfcache) {
    expected.reasons.push(`${cell.lane}/${cell.framework} bfcache sample mismatch`);
  }
  for (const sample of app?.bfcache?.iterations ?? []) {
    if (
      sample.evidenceComplete !== true ||
      bfcacheIterationFindings(sample, { listingPath }).length > 0 ||
      !(sample.network?.requests > 0)
    ) {
      expected.reasons.push(`${cell.lane}/${cell.framework} bfcache proof incomplete`);
    }
    if (
      sample.network?.errorResponses !== 0 ||
      sample.network?.failedRequests !== 0 ||
      sample.network?.pageErrors !== 0 ||
      sample.network?.rateLimitedResponses !== 0
    ) {
      expected.reasons.push(`${cell.lane}/${cell.framework} bfcache network integrity failure`);
    }
  }
  const bfcacheIterations = app?.bfcache?.iterations ?? [];
  const applicable = bfcacheIterations.filter((sample) => sample.applicable);
  const restored = applicable.filter((sample) => sample.restored);
  const aggregateReasons = [
    ...new Set(bfcacheIterations.flatMap((sample) => sample.notRestoredReasons ?? [])),
  ].sort();
  if (
    app?.bfcache?.applicableCount !== applicable.length ||
    app?.bfcache?.restoredCount !== restored.length ||
    app?.bfcache?.restoredRate !==
      (applicable.length === 0 ? null : restored.length / applicable.length) ||
    JSON.stringify(app?.bfcache?.notRestoredReasons) !== JSON.stringify(aggregateReasons)
  ) {
    expected.reasons.push(`${cell.lane}/${cell.framework} bfcache aggregate mismatch`);
  }
}

export function browserReportIntegrityFindings(app, expected) {
  const findings = [];
  if (app?.integrity?.complete !== true) findings.push('browser integrity verdict is incomplete');
  if (!Array.isArray(app?.integrity?.errors) || app.integrity.errors.length > 0) {
    findings.push('browser integrity errors are present or unavailable');
  }
  for (const [name, value] of Object.entries(expected)) {
    const actual = app?.integrity?.policy?.[name];
    if (JSON.stringify(actual) !== JSON.stringify(value)) {
      findings.push(`browser integrity policy ${name} mismatch`);
    }
  }
  return findings;
}

export { validateDevCell };

function fixtureProof(sample, cell) {
  const expectedScripts =
    cell.framework === 'kovo' && cell.lane !== 'matched-l1'
      ? sample.fixtureScriptCount === 0
      : sample.fixtureScriptCount > 0;
  return (
    sample.fixtureBootstrapValid === 1 &&
    sample.fixtureContentValid === 1 &&
    sample.fixtureControlsValid === 1 &&
    sample.fixtureCssValid === 1 &&
    sample.fixtureLaneValid === 1 &&
    expectedScripts
  );
}

export { fixtureProof };

export function ttiInteractionProof(sample, lane) {
  return (
    sample.checkoutConfirmed === 1 && (lane !== 'matched-l1' || sample.stateMutationConfirmed === 1)
  );
}

function requiredLocksMatch(actual, expected) {
  return lockFiles.every((name) => actual?.[name] && actual[name] === expected?.[name]);
}

function observedBrowserVersions(cells) {
  const versions = [];
  for (const cell of cells) {
    const bfcacheVersion = cell.report?.apps?.[0]?.bfcache?.browser;
    if (typeof bfcacheVersion === 'string') versions.push(bfcacheVersion);
    const devVersion = cell.report?.environment?.browser?.version;
    if (typeof devVersion === 'string') versions.push(devVersion);
  }
  return versions;
}

export function validHostFingerprint(host) {
  if (
    !host ||
    host.schema !== PERF_HOST_SCHEMA ||
    !/^sha256:[0-9a-f]{64}$/u.test(host.digest ?? '')
  ) {
    return false;
  }
  const { digest, schema, ...facts } = host;
  return (
    schema === PERF_HOST_SCHEMA &&
    digest === `sha256:${createHash('sha256').update(canonicalJson(facts)).digest('hex')}`
  );
}

export async function performanceWorkloadIdentity(
  options = {},
  cells = options.cells ?? defaultCells,
) {
  const corpusSize = options.corpusSize ?? 24;
  const devSchedule = cells.includes('dev')
    ? devSampleSchedule({
        editSamples: options.devIterations ?? 30,
        readySamples: options.devReadyIterations ?? 15,
        warmups: options.devWarmups ?? 3,
      })
    : [];
  const corpus = {};
  let complete = true;
  if (cells.includes('dev') || cells.includes('build')) {
    for (const framework of ['kovo', 'nextjs']) {
      try {
        const bytes = await readFile(corpusManifest(framework, corpusSize));
        const manifest = JSON.parse(bytes.toString('utf8'));
        const shapeDigest = `sha256:${createHash('sha256')
          .update(JSON.stringify(manifest.workload))
          .digest('hex')}`;
        corpus[framework] = {
          manifestDigest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
          shapeDigest: manifest.shapeDigest ? `sha256:${manifest.shapeDigest}` : null,
          sourceDigest: manifest.sourceDigest ?? null,
        };
        if (
          !/^sha256:[0-9a-f]{64}$/u.test(corpus[framework].shapeDigest ?? '') ||
          !/^sha256:[0-9a-f]{64}$/u.test(corpus[framework].sourceDigest ?? '') ||
          corpus[framework].shapeDigest !== shapeDigest
        ) {
          complete = false;
        }
      } catch {
        complete = false;
        corpus[framework] = null;
      }
    }
  }
  const identity = {
    adapters: {
      browser: BROWSER_BENCHMARK_SCHEMA,
      browserPrepare: BROWSER_PREPARE_SCHEMA,
      build: 'kovo-build-benchmark/v1',
      compare: COMPARE_SCHEMA,
      dev: 'kovo-dev-loop-report/v1',
      server: SERVER_BENCHMARK_SCHEMA,
      serverPrepare: SERVER_PREPARE_SCHEMA,
    },
    cells: [...cells],
    corpus,
    lanes: [...(options.lanes ?? lanes)],
    policies: {
      bfcacheIterations: options.bfcacheIterations ?? 10,
      browserSamples: options.iterations ?? 30,
      buildSamples: options.iterations ?? 30,
      buildModes: [...(options.buildModes ?? buildModes)],
      corpusSize,
      devEditSamples: options.devIterations ?? 30,
      devEditSessionSamples: devSchedule.filter(({ framework }) => framework === 'kovo').length,
      devOccurrenceSchedule: devSchedule,
      devReadySamples: options.devReadyIterations ?? 15,
      devWarmups: options.devWarmups ?? 3,
      lighthouseRuns: options.lighthouseRuns ?? 5,
      server: {
        concurrencies: [...(options.serverConcurrencies ?? SERVER_CONCURRENCIES)],
        durationMs: options.serverDurationMs ?? 15_000,
        encodings: [...(options.serverEncodings ?? SERVER_ENCODINGS)],
        hostSettleMaxMs: options.serverHostSettleMaxMs ?? 30_000,
        hostSettlePollMs: options.serverHostSettlePollMs ?? 1_000,
        modes: [...(options.serverModes ?? SERVER_MODES)],
        routes: [...(options.serverRoutes ?? SERVER_ROUTES)],
        samples: options.serverSamples ?? 7,
        warmupMs: options.serverWarmupMs ?? 5_000,
      },
      warmups: options.warmups ?? 3,
    },
  };
  if (
    (cells.includes('dev') || cells.includes('build')) &&
    corpus.kovo?.shapeDigest !== corpus.nextjs?.shapeDigest
  ) {
    complete = false;
  }
  return {
    complete,
    digest: `sha256:${createHash('sha256').update(canonicalJson(identity)).digest('hex')}`,
    identity,
    schema: WORKLOAD_IDENTITY_SCHEMA,
  };
}

function browserSamples(cell) {
  return Object.values(cell.report.apps?.[0]?.conditions ?? {}).flatMap((condition) =>
    Object.values(condition ?? {}).flatMap((scenario) => scenario?.iterations ?? []),
  );
}

function cellSampleCount(cell) {
  if (cell.cell === 'browser') return browserSamples(cell).length;
  return (cell.report.samples ?? cell.report.rawSamples ?? []).length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cells = (readArg('--cells') ?? defaultCells.join(',')).split(',').filter(Boolean);
  const laneList = (readArg('--lanes') ?? lanes.join(',')).split(',').filter(Boolean);
  const { output } = await runComparison({
    allowDirty: process.argv.includes('--allow-dirty'),
    bfcacheIterations: readIntegerArg('--bfcache-iterations', { fallback: 10, max: 1_000 }),
    bootstrapIterations: readIntegerArg('--bootstrap-iterations', {
      fallback: 10_000,
      max: 1_000_000,
    }),
    cells,
    corpusSize: readIntegerArg('--corpus-size', { fallback: 24, max: 216 }),
    devIterations: readIntegerArg('--dev-iterations', { fallback: 30, max: 100 }),
    devPortBase: readIntegerArg('--dev-port-base', {
      fallback: 49_700,
      max: 65_500,
      min: 1_024,
    }),
    devReadyIterations: readIntegerArg('--dev-ready-iterations', { fallback: 15, max: 100 }),
    devWarmups: readIntegerArg('--dev-warmups', { fallback: 3, max: 10, min: 0 }),
    iterations: readIntegerArg('--iterations', { fallback: 30, max: 1_000 }),
    lanes: laneList,
    lighthouseRuns: readIntegerArg('--lighthouse-runs', { fallback: 5, max: 100 }),
    outDir: readArg('--out-dir'),
    skipBuild: process.argv.includes('--skip-build'),
    skipLighthouse: process.argv.includes('--skip-lighthouse'),
    serverConcurrencies: (readArg('--server-concurrencies') ?? SERVER_CONCURRENCIES.join(','))
      .split(',')
      .filter(Boolean)
      .map((value) => Number(value)),
    serverDurationMs: readIntegerArg('--server-duration-ms', {
      fallback: 15_000,
      max: 60_000,
      min: 25,
    }),
    serverEncodings: (readArg('--server-encodings') ?? SERVER_ENCODINGS.join(','))
      .split(',')
      .filter(Boolean),
    serverHostSettleMaxMs: readIntegerArg('--server-host-settle-max-ms', {
      fallback: 30_000,
      max: 300_000,
      min: 0,
    }),
    serverHostSettlePollMs: readIntegerArg('--server-host-settle-poll-ms', {
      fallback: 1_000,
      max: 60_000,
      min: 10,
    }),
    serverModes: (readArg('--server-modes') ?? SERVER_MODES.join(',')).split(',').filter(Boolean),
    serverPortBase: readIntegerArg('--server-port-base', {
      fallback: 50_310,
      max: 65_500,
      min: 1_024,
    }),
    serverRoutes: (readArg('--server-routes') ?? SERVER_ROUTES.join(','))
      .split(',')
      .filter(Boolean),
    serverSamples: readIntegerArg('--server-samples', { fallback: 7, max: 100 }),
    serverWarmupMs: readIntegerArg('--server-warmup-ms', {
      fallback: 5_000,
      max: 60_000,
      min: 25,
    }),
    warmups: readIntegerArg('--warmups', { fallback: 3, max: 100, min: 0 }),
  });
  process.stdout.write(`comparison written to ${output}\n`);
}
