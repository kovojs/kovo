import { readFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import {
  compileComponentModule,
  type CompileComponentOptions,
  type CompileResult,
} from '../packages/compiler/src/index.js';
import {
  compilerPerfCorpora,
  type CompilerPerfCorpus,
  type CompilerPerfFile,
} from './compiler-perf-corpora.js';

interface CompilerPerfBudget {
  coldMaxMs: number;
  fileCount: number;
  minLoc: number;
}

interface CompilerPerfBudgets {
  corpora: Record<string, CompilerPerfBudget>;
  runs: {
    cold: number;
  };
  total: CompilerPerfBudget;
  version: number;
}

interface CompilerPerfCounters {
  clientExportCount: number;
  compileCount: number;
  cssAssetCount: number;
  diagnosticCount: number;
  emittedFileCount: number;
  emittedLoc: number;
  handlerExportCount: number;
  platformSubstitutionCount: number;
  queryUpdatePlanCount: number;
  renderEquivalenceCheckCount: number;
  transformFactCount: number;
  updateCoverageCount: number;
  viewTransitionCount: number;
}

interface CompilerPerfInputMetrics {
  fileCount: number;
  loc: number;
}

interface CompilerPerfRunMetrics {
  actualCompileCount: number;
  counters: CompilerPerfCounters;
  elapsedMs: number;
}

interface CompilerPerfCorpusResult {
  cold: CompilerPerfRunMetrics;
  coldMadMs: number;
  coldSamplesMs: readonly number[];
  input: CompilerPerfInputMetrics;
  name: string;
}

const budgets = JSON.parse(
  readFileSync(new URL('./compiler-perf.budgets.json', import.meta.url), 'utf8'),
) as CompilerPerfBudgets;

const compilerPerfEnabled = process.env.KOVO_RUN_COMPILER_PERF === '1';
const describeCompilerPerf = compilerPerfEnabled ? describe : describe.skip;

describeCompilerPerf('compiler performance gates', () => {
  it('keeps generated compiler corpora within checked-in budgets', () => {
    // SPEC.md §5.2 defines compileComponentModule as the TSX-to-lowered-IR pipeline; this gate
    // times that public compiler path over generated app-scale TSX corpora.
    printEnvironmentMetadata();
    expect(budgets.runs.cold, 'compiler perf cold sample count').toBeGreaterThanOrEqual(5);
    const corpora = compilerPerfCorpora();
    const results = corpora.map(runCorpus);
    const totals = totalResults(results);

    for (const result of results) {
      const budget = budgets.corpora[result.name];
      expect(budget, `missing compiler perf budget for ${result.name}`).toBeDefined();
      if (!budget) continue;

      assertCorpusShape(result.name, result.input, budget);
      assertElapsedBudget(result.name, result, budget.coldMaxMs);
      printCorpusResult(result);
    }

    assertCorpusShape('total', totals.input, budgets.total);
    assertElapsedBudget('total', totals, budgets.total.coldMaxMs);
    printCorpusResult(totals);
  }, 180_000);
});

function runCorpus(corpus: CompilerPerfCorpus): CompilerPerfCorpusResult {
  const input = inputMetrics(corpus.files);
  const coldRuns = Array.from({ length: budgets.runs.cold }, () =>
    measureColdCompile(corpus.files),
  );
  assertStableRunCounters(corpus.name, coldRuns);
  const coldSamplesMs = coldRuns.map((run) => run.elapsedMs);
  const coldMedianMs = median(coldSamplesMs);
  const cold = coldRuns.reduce((closest, candidate) =>
    Math.abs(candidate.elapsedMs - coldMedianMs) < Math.abs(closest.elapsedMs - coldMedianMs)
      ? candidate
      : closest,
  );

  return {
    cold: { ...cold, elapsedMs: coldMedianMs },
    coldMadMs: median(coldSamplesMs.map((sample) => Math.abs(sample - coldMedianMs))),
    coldSamplesMs,
    input,
    name: corpus.name,
  };
}

function assertStableRunCounters(name: string, runs: readonly CompilerPerfRunMetrics[]): void {
  const expected = runs[0];
  expect(expected, `${name} compiler perf requires at least one sample`).toBeDefined();
  if (!expected) return;
  for (const run of runs.slice(1)) {
    expect(run.actualCompileCount, `${name} compile count changed between samples`).toBe(
      expected.actualCompileCount,
    );
    expect(run.counters, `${name} semantic counters changed between samples`).toEqual(
      expected.counters,
    );
  }
}

function measureColdCompile(files: readonly CompilerPerfFile[]): CompilerPerfRunMetrics {
  const counters = emptyCounters();
  let actualCompileCount = 0;
  const startedAt = performance.now();

  for (const file of files) {
    actualCompileCount += 1;
    const result = compileComponentModule(compileOptions(file));

    const diagnostics = result.diagnostics.map(
      (diagnostic) => `${diagnostic.code} ${diagnostic.fileName}: ${diagnostic.message}`,
    );
    expect(diagnostics, `compiler diagnostics in ${file.fileName}`).toEqual([]);
    addResultCounters(counters, result);
  }

  return {
    actualCompileCount,
    counters,
    elapsedMs: performance.now() - startedAt,
  };
}

function compileOptions(file: CompilerPerfFile): CompileComponentOptions {
  return {
    fileName: file.fileName,
    ...(file.registryFacts ? { registryFacts: file.registryFacts } : {}),
    source: file.source,
  };
}

function addResultCounters(counters: CompilerPerfCounters, result: CompileResult): void {
  counters.compileCount += 1;
  counters.clientExportCount += result.clientExports.length;
  counters.cssAssetCount += result.cssAssets.length;
  counters.diagnosticCount += result.diagnostics.length;
  counters.emittedFileCount += result.files.length;
  counters.emittedLoc += result.files.reduce((total, file) => total + lineCount(file.source), 0);
  counters.handlerExportCount += result.handlerExports.length;
  counters.platformSubstitutionCount += result.platformSubstitutions.length;
  counters.queryUpdatePlanCount += result.queryUpdatePlans.length;
  counters.renderEquivalenceCheckCount += result.renderEquivalenceChecks.length;
  counters.updateCoverageCount += result.updateCoverage.length;
  counters.viewTransitionCount += result.viewTransitions.length;
  counters.transformFactCount +=
    result.clientExports.length +
    result.cssAssets.length +
    result.files.length +
    result.handlerExports.length +
    result.platformSubstitutions.length +
    result.queryUpdatePlans.length +
    result.renderEquivalenceChecks.length +
    result.updateCoverage.length +
    result.viewTransitions.length;
}

function assertCorpusShape(
  name: string,
  input: CompilerPerfInputMetrics,
  budget: Pick<CompilerPerfBudget, 'fileCount' | 'minLoc'>,
): void {
  expect(input.fileCount, `${name} compiler perf file count`).toBe(budget.fileCount);
  expect(input.loc, `${name} compiler perf LOC floor`).toBeGreaterThanOrEqual(budget.minLoc);
}

function assertElapsedBudget(
  corpusName: string,
  result: CompilerPerfCorpusResult,
  maxElapsedMs: number,
): void {
  if (result.cold.elapsedMs <= maxElapsedMs) return;

  const message = [
    `Compiler perf regression: ${corpusName} cold median took ${result.cold.elapsedMs.toFixed(
      1,
    )}ms across N=${result.coldSamplesMs.length} samples (MAD=${result.coldMadMs.toFixed(
      1,
    )}ms), budget is ${maxElapsedMs}ms.`,
    'Run pnpm run test:compiler-perf to reproduce. Set KOVO_COMPILER_PERF_WARN_ONLY=1 only for local triage.',
  ].join('\n');

  if (process.env.KOVO_COMPILER_PERF_WARN_ONLY === '1') {
    console.warn(message);
    return;
  }

  throw new Error(message);
}

function printCorpusResult(result: CompilerPerfCorpusResult): void {
  console.info(
    [
      `compiler-perf ${result.name}`,
      `files=${result.input.fileCount}`,
      `inputLoc=${result.input.loc}`,
      `coldMedianMs=${result.cold.elapsedMs.toFixed(1)}`,
      `coldMadMs=${result.coldMadMs.toFixed(1)}`,
      `coldN=${result.coldSamplesMs.length}`,
      `compileCount=${result.cold.counters.compileCount}`,
      `actualColdCompiles=${result.cold.actualCompileCount}`,
      `emittedFiles=${result.cold.counters.emittedFileCount}`,
      `emittedLoc=${result.cold.counters.emittedLoc}`,
      `transformFacts=${result.cold.counters.transformFactCount}`,
      `clientExports=${result.cold.counters.clientExportCount}`,
      `handlers=${result.cold.counters.handlerExportCount}`,
      `queryPlans=${result.cold.counters.queryUpdatePlanCount}`,
      `cssAssets=${result.cold.counters.cssAssetCount}`,
      `platformSubstitutions=${result.cold.counters.platformSubstitutionCount}`,
      `renderEquivalenceChecks=${result.cold.counters.renderEquivalenceCheckCount}`,
      `updateCoverage=${result.cold.counters.updateCoverageCount}`,
      `viewTransitions=${result.cold.counters.viewTransitionCount}`,
      `diagnostics=${result.cold.counters.diagnosticCount}`,
    ].join(' '),
  );
}

function printEnvironmentMetadata(): void {
  const cpu = cpus()[0];

  console.info(
    [
      'compiler-perf environment',
      `node=${process.version}`,
      `v8=${process.versions.v8}`,
      `vitest=4.1.10`,
      `platform=${platform()}`,
      `release=${release()}`,
      `arch=${arch()}`,
      `cpuCount=${cpus().length}`,
      `cpuModel=${JSON.stringify(cpu?.model ?? 'unknown')}`,
      `totalMemMb=${Math.round(totalmem() / 1024 / 1024)}`,
      `warnOnly=${process.env.KOVO_COMPILER_PERF_WARN_ONLY === '1'}`,
    ].join(' '),
  );
}

function totalResults(results: readonly CompilerPerfCorpusResult[]): CompilerPerfCorpusResult {
  const sampleCount = results[0]?.coldSamplesMs.length ?? 0;
  const coldSamplesMs = Array.from({ length: sampleCount }, (_, index) =>
    results.reduce((total, result) => total + (result.coldSamplesMs[index] ?? 0), 0),
  );
  const coldMedianMs = median(coldSamplesMs);
  const total: CompilerPerfCorpusResult = {
    cold: { actualCompileCount: 0, counters: emptyCounters(), elapsedMs: coldMedianMs },
    coldMadMs: median(coldSamplesMs.map((sample) => Math.abs(sample - coldMedianMs))),
    coldSamplesMs,
    input: { fileCount: 0, loc: 0 },
    name: 'total',
  };

  for (const result of results) {
    total.input.fileCount += result.input.fileCount;
    total.input.loc += result.input.loc;
    total.cold.actualCompileCount += result.cold.actualCompileCount;
    addCounters(total.cold.counters, result.cold.counters);
  }

  return total;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[midpoint] ?? 0)
    : ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2;
}

function addCounters(target: CompilerPerfCounters, source: CompilerPerfCounters): void {
  target.clientExportCount += source.clientExportCount;
  target.compileCount += source.compileCount;
  target.cssAssetCount += source.cssAssetCount;
  target.diagnosticCount += source.diagnosticCount;
  target.emittedFileCount += source.emittedFileCount;
  target.emittedLoc += source.emittedLoc;
  target.handlerExportCount += source.handlerExportCount;
  target.platformSubstitutionCount += source.platformSubstitutionCount;
  target.queryUpdatePlanCount += source.queryUpdatePlanCount;
  target.renderEquivalenceCheckCount += source.renderEquivalenceCheckCount;
  target.transformFactCount += source.transformFactCount;
  target.updateCoverageCount += source.updateCoverageCount;
  target.viewTransitionCount += source.viewTransitionCount;
}

function emptyCounters(): CompilerPerfCounters {
  return {
    clientExportCount: 0,
    compileCount: 0,
    cssAssetCount: 0,
    diagnosticCount: 0,
    emittedFileCount: 0,
    emittedLoc: 0,
    handlerExportCount: 0,
    platformSubstitutionCount: 0,
    queryUpdatePlanCount: 0,
    renderEquivalenceCheckCount: 0,
    transformFactCount: 0,
    updateCoverageCount: 0,
    viewTransitionCount: 0,
  };
}

function inputMetrics(files: readonly CompilerPerfFile[]): CompilerPerfInputMetrics {
  return {
    fileCount: files.length,
    loc: files.reduce((total, file) => total + lineCount(file.source), 0),
  };
}

function lineCount(source: string): number {
  return source.trim().split(/\r?\n/).length;
}
