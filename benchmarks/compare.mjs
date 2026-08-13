#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readArg, readIntegerArg } from './harness/args.mjs';
import { bfcacheIterationFindings } from './harness/bfcache.mjs';
import { collectPerformanceProvenance } from '../scripts/lib/perf-provenance.mjs';

export const COMPARE_SCHEMA = 'kovo-next-performance-comparison/v1';
export const EXECUTION_ORDER = Object.freeze(['kovo', 'nextjs', 'nextjs', 'kovo']);

const benchmarkRoot = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = path.resolve(benchmarkRoot, '..');
const lanes = Object.freeze(['default', 'matched-l0', 'matched-l1']);
const buildModes = Object.freeze(['clean', 'unchanged', 'edit']);

export async function runComparison(options = {}) {
  const provenance = collectPerformanceProvenance({
    lockFiles: ['pnpm-lock.yaml', 'benchmarks/nextjs/pnpm-lock.yaml'],
    repoRoot,
  });
  const dirtyOverride = provenance.dirty && options.allowDirty === true;
  if (provenance.dirty && !dirtyOverride) {
    const outDir = path.resolve(options.outDir ?? path.join(benchmarkRoot, 'results'));
    await mkdir(outDir, { recursive: true });
    const report = {
      analysis: {},
      generatedAt: new Date().toISOString(),
      hostSamples: [],
      integrity: {
        alternatingOrder: EXECUTION_ORDER,
        cells: options.cells ?? ['browser', 'dev', 'build'],
        comparatorMatched: false,
        serialized: true,
        sourceStable: true,
      },
      rawCells: [],
      schema: COMPARE_SCHEMA,
      source: provenance,
    };
    report.verdict = comparisonVerdict(report);
    const output = path.join(outDir, 'comparison.json');
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    throw new Error(
      `Comparison is unproven: ${report.verdict.reasons.join('; ')}. Evidence preserved at ${output}.`,
    );
  }

  const outDir = path.resolve(options.outDir ?? path.join(benchmarkRoot, 'results'));
  const cells = options.cells ?? ['browser', 'dev', 'build'];
  for (const cell of cells) assertMember('--cells', cell, ['browser', 'dev', 'build']);
  if (new Set(cells).size !== cells.length) throw new Error('--cells must not contain duplicates.');
  assertMember('--corpus-size', options.corpusSize ?? 24, [24, 216]);
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'kovo-next-compare-'));
  const iterations = options.iterations ?? 30;
  const warmups = options.warmups ?? 3;
  const occurrenceCounts = splitAcrossOccurrences(iterations);
  const warmupCounts = splitAcrossOccurrences(warmups);
  const bfcacheCounts = splitAcrossOccurrences(options.bfcacheIterations ?? 10);
  const lighthouseCounts = splitAcrossOccurrences(options.lighthouseRuns ?? 5);
  const hostSamples = [];
  const rawCells = [];
  let executionError = null;
  await mkdir(outDir, { recursive: true });
  try {
    if (cells.includes('browser')) {
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
                ...(options.skipBuild ? ['--skip-build'] : []),
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
      for (const [orderIndex, framework] of EXECUTION_ORDER.entries()) {
        const occurrence = occurrenceIndex(orderIndex, framework);
        const host = sampleHost(hostSamples, options.maxLoadPerCpu ?? 1);
        if (!host.comparable) {
          executionError = `host load ${host.loadPerCpu.toFixed(3)} per CPU exceeded ceiling ${host.ceiling}`;
          break;
        }
        const resultFile = path.join(scratch, `${corpusLane}-${orderIndex}-dev.json`);
        try {
          await runAdapter({
            args: [
              path.join(benchmarkRoot, 'corpora/dev-loop.mjs'),
              '--manifest',
              corpusManifest(framework, options.corpusSize ?? 24),
              '--iterations',
              String(options.devIterations ?? 30),
              '--ready-iterations',
              String(options.devReadyIterations ?? 15),
              '--warmups',
              String(options.devWarmups ?? 3),
              '--port',
              String((options.devPortBase ?? 49_700) + orderIndex),
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

    const analysis = pairedAnalysis(rawCells, {
      bootstrapIterations: options.bootstrapIterations ?? 10_000,
      seed: options.seed ?? 0x4b4f564f,
    });
    const finalProvenance = collectPerformanceProvenance({
      lockFiles: ['pnpm-lock.yaml', 'benchmarks/nextjs/pnpm-lock.yaml'],
      repoRoot,
    });
    const sourceStable = sameSourceState(provenance, finalProvenance);
    const report = {
      analysis,
      generatedAt: new Date().toISOString(),
      hostSamples,
      integrity: {
        alternatingOrder: EXECUTION_ORDER,
        cells,
        comparator: await comparatorIntegrity(rawCells, {
          cells,
          corpusSize: options.corpusSize ?? 24,
          bfcacheIterations: options.bfcacheIterations ?? 10,
          devIterations: options.devIterations ?? 30,
          devReadyIterations: options.devReadyIterations ?? 15,
          devWarmups: options.devWarmups ?? 3,
          iterations,
          lanes: options.lanes ?? lanes,
          lighthouseRuns: options.lighthouseRuns ?? 5,
          modes: options.buildModes ?? buildModes,
          skipLighthouse: options.skipLighthouse === true,
          source: provenance,
          warmups,
        }),
        comparatorMatched: false,
        executionError,
        hostLoadCeilingPerCpu: options.maxLoadPerCpu ?? 1,
        serialized: true,
        sourceStable,
        publishable: !dirtyOverride,
      },
      policy: {
        bfcacheIterations: options.bfcacheIterations ?? 10,
        bootstrapIterations: options.bootstrapIterations ?? 10_000,
        browserSamples: iterations,
        devEditSamples: options.devIterations ?? 30,
        devReadySamples: options.devReadyIterations ?? 15,
        devWarmups: options.devWarmups ?? 3,
        lighthouseRunsPerCell: options.lighthouseRuns ?? 5,
        warmups,
      },
      rawCells,
      schema: COMPARE_SCHEMA,
      source: provenance,
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
  if (report.integrity?.serialized !== true) reasons.push('cells were not serialized');
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
    for (const occurrence of [0, 1]) {
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
    return [
      ...prefixedMetricSeries(cell.report.samples ?? [], 'edit'),
      ...prefixedMetricSeries(cell.report.readySamples ?? [], 'ready'),
    ];
  }
  const samples = cell.report.samples ?? cell.report.rawSamples ?? [];
  return prefixedMetricSeries(samples);
}

function prefixedMetricSeries(samples, prefix = '') {
  return numericLeafNames(samples).map((name) => ({
    name: prefix ? `${prefix}.${name}` : name,
    values: samples.map((sample) => readLeaf(sample, name)).filter(Number.isFinite),
  }));
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

async function runAdapter({ args, cwd, label }) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
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
  const occurrenceCounts = splitAcrossOccurrences(policy.iterations);
  const warmupCounts = splitAcrossOccurrences(policy.warmups);
  const bfcacheCounts = splitAcrossOccurrences(policy.bfcacheIterations);
  const lighthouseCounts = splitAcrossOccurrences(policy.lighthouseRuns);
  const keys = new Map();
  for (const cell of cells) {
    const key = [cell.lane, cell.cell, cell.mode ?? ''].join('/');
    const frameworks = keys.get(key) ?? new Set();
    frameworks.add(cell.framework);
    keys.set(key, frameworks);
  }
  const expected = [];
  for (const cell of policy.cells) {
    const cellLanes = cell === 'browser' ? policy.lanes : [`corpus-n${policy.corpusSize}`];
    for (const lane of cellLanes) {
      for (const mode of cell === 'build' ? policy.modes : ['']) {
        expected.push([lane, cell, mode].join('/'));
      }
    }
  }
  for (const key of expected) {
    const relevant = cells.filter(
      (cell) => [cell.lane, cell.cell, cell.mode ?? ''].join('/') === key,
    );
    for (const framework of ['kovo', 'nextjs']) {
      const occurrences = relevant.filter((cell) => cell.framework === framework);
      if (occurrences.length !== 2)
        reasons.push(`${key}/${framework} did not produce two occurrences`);
      if (
        occurrences.length === 2 &&
        occurrences
          .map((cell) => cell.occurrence)
          .sort()
          .join(',') !== '0,1'
      ) {
        reasons.push(`${key}/${framework} occurrence identities did not match 0,1`);
      }
      for (const occurrence of occurrences) {
        const expectedSamples =
          occurrence.cell === 'dev'
            ? policy.devIterations
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
        } else if (cellSampleCount(occurrence) !== expectedSamples) {
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
          validateDevCell(occurrence, {
            corpusDigest: null,
            iterations: policy.devIterations,
            readyIterations: policy.devReadyIterations,
            reasons,
            warmups: policy.devWarmups,
          });
        }
      }
    }
    if (relevant.map((cell) => cell.framework).join(',') !== EXECUTION_ORDER.join(',')) {
      reasons.push(`${key} execution order did not match ${EXECUTION_ORDER.join(',')}`);
    }
  }
  if ([...keys.keys()].some((key) => !expected.includes(key)))
    reasons.push('unexpected comparator cell');

  const corpusDigests = {};
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
  return { corpusDigests, matched: reasons.length === 0, reasons: [...new Set(reasons)].sort() };
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

function validateBrowserCell(cell, expected) {
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
  return ['pnpm-lock.yaml', 'benchmarks/nextjs/pnpm-lock.yaml'].every(
    (name) => actual?.[name] && actual[name] === expected?.[name],
  );
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
  const cells = (readArg('--cells') ?? 'browser,dev,build').split(',').filter(Boolean);
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
    warmups: readIntegerArg('--warmups', { fallback: 3, max: 100, min: 0 }),
  });
  process.stdout.write(`comparison written to ${output}\n`);
}
