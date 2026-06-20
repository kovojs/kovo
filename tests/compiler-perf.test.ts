import { readFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import { CompileCache, compileComponentCacheKeyInput } from '../packages/compiler/src/internal.js';
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
  warmMaxMs: number;
}

interface CompilerPerfBudgets {
  corpora: Record<string, CompilerPerfBudget>;
  total: CompilerPerfBudget;
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
  input: CompilerPerfInputMetrics;
  name: string;
  warm: CompilerPerfRunMetrics;
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
    const corpora = compilerPerfCorpora();
    const results = corpora.map(runCorpus);
    const totals = totalResults(results);

    for (const result of results) {
      const budget = budgets.corpora[result.name];
      expect(budget, `missing compiler perf budget for ${result.name}`).toBeDefined();
      if (!budget) continue;

      assertCorpusShape(result.name, result.input, budget);
      assertElapsedBudget(result.name, 'cold', result.cold.elapsedMs, budget.coldMaxMs);
      assertElapsedBudget(result.name, 'warm', result.warm.elapsedMs, budget.warmMaxMs);
      expect(result.warm.actualCompileCount, `${result.name} warm cache misses`).toBe(0);
      printCorpusResult(result);
    }

    assertCorpusShape('total', totals.input, budgets.total);
    assertElapsedBudget('total', 'cold', totals.cold.elapsedMs, budgets.total.coldMaxMs);
    assertElapsedBudget('total', 'warm', totals.warm.elapsedMs, budgets.total.warmMaxMs);
    expect(totals.warm.actualCompileCount, 'total warm cache misses').toBe(0);
    printCorpusResult(totals);
  }, 60_000);

  it('keeps an incremental single-file edit to O(changed files)', () => {
    const files = compilerPerfCorpora().flatMap((corpus) => corpus.files);
    const cache = new CompileCache<CompileResult>();
    let actualCompileCount = 0;

    for (const file of files) {
      const options = compileOptions(file);
      void cache.getOrCreate(compileComponentCacheKeyInput(options), () => {
        actualCompileCount += 1;
        return compileComponentModule(options);
      });
    }

    const afterPrimeCompileCount = actualCompileCount;
    const editedFiles = files.map((file, index) =>
      index === 0 ? { ...file, source: file.source.replace('Item <span>', 'Edited <span>') } : file,
    );
    for (const file of editedFiles) {
      const options = compileOptions(file);
      void cache.getOrCreate(compileComponentCacheKeyInput(options), () => {
        actualCompileCount += 1;
        return compileComponentModule(options);
      });
    }

    expect(actualCompileCount - afterPrimeCompileCount).toBe(1);
  }, 60_000);
});

function runCorpus(corpus: CompilerPerfCorpus): CompilerPerfCorpusResult {
  const input = inputMetrics(corpus.files);
  const cold = measureColdCompile(corpus.files);
  const warm = measureWarmCompile(corpus.files);

  return {
    cold,
    input,
    name: corpus.name,
    warm,
  };
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

function measureWarmCompile(files: readonly CompilerPerfFile[]): CompilerPerfRunMetrics {
  const cache = new CompileCache<CompileResult>();
  let actualCompileCount = 0;

  for (const file of files) {
    const options = compileOptions(file);
    void cache.getOrCreate(compileComponentCacheKeyInput(options), () => {
      actualCompileCount += 1;
      return compileComponentModule(options);
    });
  }

  const counters = emptyCounters();
  const startedAt = performance.now();
  for (const file of files) {
    const options = compileOptions(file);
    const result = cache.getOrCreate(compileComponentCacheKeyInput(options), () => {
      actualCompileCount += 1;
      return compileComponentModule(options);
    });
    if (result instanceof Promise) throw new Error('compileComponentModule should be synchronous');

    const diagnostics = result.diagnostics.map(
      (diagnostic) => `${diagnostic.code} ${diagnostic.fileName}: ${diagnostic.message}`,
    );
    expect(diagnostics, `compiler diagnostics in ${file.fileName}`).toEqual([]);
    addResultCounters(counters, result);
  }

  return {
    actualCompileCount: actualCompileCount - files.length,
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
  phase: 'cold' | 'warm',
  elapsedMs: number,
  maxElapsedMs: number,
): void {
  if (elapsedMs <= maxElapsedMs) return;

  const message = [
    `Compiler perf regression: ${corpusName} ${phase} compile took ${elapsedMs.toFixed(
      1,
    )}ms, budget is ${maxElapsedMs}ms.`,
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
      `coldMs=${result.cold.elapsedMs.toFixed(1)}`,
      `warmMs=${result.warm.elapsedMs.toFixed(1)}`,
      `compileCount=${result.cold.counters.compileCount + result.warm.counters.compileCount}`,
      `actualColdCompiles=${result.cold.actualCompileCount}`,
      `actualWarmCompiles=${result.warm.actualCompileCount}`,
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
      `vitest=4.1.8`,
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
  const total: CompilerPerfCorpusResult = {
    cold: { actualCompileCount: 0, counters: emptyCounters(), elapsedMs: 0 },
    input: { fileCount: 0, loc: 0 },
    name: 'total',
    warm: { actualCompileCount: 0, counters: emptyCounters(), elapsedMs: 0 },
  };

  for (const result of results) {
    total.input.fileCount += result.input.fileCount;
    total.input.loc += result.input.loc;
    total.cold.elapsedMs += result.cold.elapsedMs;
    total.warm.elapsedMs += result.warm.elapsedMs;
    total.cold.actualCompileCount += result.cold.actualCompileCount;
    total.warm.actualCompileCount += result.warm.actualCompileCount;
    addCounters(total.cold.counters, result.cold.counters);
    addCounters(total.warm.counters, result.warm.counters);
  }

  return total;
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
