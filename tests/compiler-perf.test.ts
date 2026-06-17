import { readFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import {
  compileComponentModule,
  type CompileResult,
  type RegistryFacts,
} from '../packages/compiler/src/index.js';

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

interface CompilerPerfFile {
  fileName: string;
  registryFacts?: RegistryFacts;
  source: string;
}

interface CompilerPerfCorpus {
  files: readonly CompilerPerfFile[];
  name: string;
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

describe('compiler performance gates', () => {
  it(
    'keeps generated compiler corpora within checked-in budgets',
    () => {
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
        printCorpusResult(result);
      }

      assertCorpusShape('total', totals.input, budgets.total);
      assertElapsedBudget('total', 'cold', totals.cold.elapsedMs, budgets.total.coldMaxMs);
      assertElapsedBudget('total', 'warm', totals.warm.elapsedMs, budgets.total.warmMaxMs);
      printCorpusResult(totals);
    },
    60_000,
  );
});

function runCorpus(corpus: CompilerPerfCorpus): CompilerPerfCorpusResult {
  const input = inputMetrics(corpus.files);
  const cold = measureCompile(corpus.files);
  const warm = measureCompile(corpus.files);

  return {
    cold,
    input,
    name: corpus.name,
    warm,
  };
}

function measureCompile(files: readonly CompilerPerfFile[]): CompilerPerfRunMetrics {
  const counters = emptyCounters();
  const startedAt = performance.now();

  for (const file of files) {
    const result = compileComponentModule({
      fileName: file.fileName,
      ...(file.registryFacts ? { registryFacts: file.registryFacts } : {}),
      source: file.source,
    });

    const diagnostics = result.diagnostics.map(
      (diagnostic) => `${diagnostic.code} ${diagnostic.fileName}: ${diagnostic.message}`,
    );
    expect(diagnostics, `compiler diagnostics in ${file.fileName}`).toEqual([]);
    addResultCounters(counters, result);
  }

  return {
    counters,
    elapsedMs: performance.now() - startedAt,
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
    cold: { counters: emptyCounters(), elapsedMs: 0 },
    input: { fileCount: 0, loc: 0 },
    name: 'total',
    warm: { counters: emptyCounters(), elapsedMs: 0 },
  };

  for (const result of results) {
    total.input.fileCount += result.input.fileCount;
    total.input.loc += result.input.loc;
    total.cold.elapsedMs += result.cold.elapsedMs;
    total.warm.elapsedMs += result.warm.elapsedMs;
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

function compilerPerfCorpora(): CompilerPerfCorpus[] {
  return [
    largeComponentCorpus(),
    manySmallComponentsCorpus(),
    manyRoutesRegistriesCorpus(),
    cssHeavyComponentsCorpus(),
    heavyPrimitiveCompositionCorpus(),
    mixedRealAppCorpus(),
  ];
}

function largeComponentCorpus(): CompilerPerfCorpus {
  const blocks = Array.from({ length: 120 }, (_, index) =>
    [
      `        <section class="result result-${index}" title={catalog.title${index}} viewTransitionName={catalog.slug${index}}>`,
      `          <h2>Item <span>{catalog.name${index}}</span></h2>`,
      `          <p>Inventory {catalog.stock${index}}</p>`,
      `          <button hidden={!state.expanded${index}}>Choose</button>`,
      '        </section>',
    ].join('\n'),
  ).join('\n');

  return {
    files: [
      {
        fileName: 'perf/large/large-catalog.tsx',
        registryFacts: { queries: { catalog: 'CatalogQuery' } },
        source: `
import { component } from '@kovojs/core';

export const LargeCatalog = component({
  queries: { catalog: catalogQuery },
  state: () => ({ expanded0: false }),
  render: ({ catalog }, state) => (
    <large-catalog>
${blocks}
    </large-catalog>
  ),
});
`,
      },
    ],
    name: 'large-component',
  };
}

function manySmallComponentsCorpus(): CompilerPerfCorpus {
  return {
    files: Array.from({ length: 48 }, (_, index) => ({
      fileName: `perf/small/small-${index}.tsx`,
      registryFacts: { queries: { item: 'ItemQuery' } },
      source: `
import { component } from '@kovojs/core';

export const Small${index} = component({
  queries: { item: itemQuery },
  state: () => ({ active: false }),
  render: ({ item }, state) => (
    <small-${index}>
      <button class="toggle-${index}" hidden={!state.active}>Toggle</button>
      <span>{item.label${index}}</span>
      <p>Status {state.active ? 'active' : 'idle'}</p>
    </small-${index}>
  ),
});
`,
    })),
    name: 'many-small-components',
  };
}

function manyRoutesRegistriesCorpus(): CompilerPerfCorpus {
  const routes = Array.from({ length: 96 }, (_, index) =>
    index % 2 === 0 ? `/products/${index}/:slug` : `/checkout/${index}`,
  );

  return {
    files: Array.from({ length: 32 }, (_, index) => {
      const productRoute = `/products/${index * 2}/:slug`;
      const checkoutRoute = `/checkout/${index * 2 + 1}`;

      return {
        fileName: `perf/routes/route-card-${index}.tsx`,
        registryFacts: { routes },
        source: `
import { component } from '@kovojs/core';
import { Link } from '@kovojs/runtime';

export const RouteCard${index} = component({
  render: () => (
    <route-card-${index}>
      <Link to="${productRoute}" params={{ slug: 'sku-${index}' }}>Product ${index}</Link>
      <a href="${checkoutRoute}">Checkout ${index}</a>
      <form action="${checkoutRoute}" method="get"><button>Open</button></form>
    </route-card-${index}>
  ),
});
`,
      };
    }),
    name: 'many-routes-registries',
  };
}

function cssHeavyComponentsCorpus(): CompilerPerfCorpus {
  return {
    files: Array.from({ length: 16 }, (_, index) => {
      const rules = Array.from({ length: 72 }, (_, ruleIndex) =>
        [
          `    .tile-${ruleIndex} { color: rgb(${(ruleIndex * 17) % 255}, ${
            (ruleIndex * 29) % 255
          }, ${(ruleIndex * 41) % 255}); padding: ${ruleIndex % 9}px; }`,
          `    .tile-${ruleIndex}:hover { transform: translateY(-1px); }`,
        ].join('\n'),
      ).join('\n');

      return {
        fileName: `perf/css/css-panel-${index}.tsx`,
        source: `
import { component } from '@kovojs/core';

export const CssPanel${index} = component({
  css: \`
${rules}
  \`,
  render: () => (
    <css-panel-${index}>
      <div class="tile-${index}">Panel ${index}</div>
    </css-panel-${index}>
  ),
});
`,
      };
    }),
    name: 'css-heavy-components',
  };
}

function heavyPrimitiveCompositionCorpus(): CompilerPerfCorpus {
  return {
    files: Array.from({ length: 20 }, (_, index) => {
      const triggers = Array.from({ length: 12 }, (_, triggerIndex) =>
        [
          '        <Tooltip.Trigger',
          '          asChild',
          '          attrs={{',
          `            class: 'primitive primitive-${triggerIndex}',`,
          "            'data-state': 'closed',",
          `            'aria-label': 'Trigger ${index}-${triggerIndex}',`,
          "            'on:click': '/c/primitive#toggle',",
          '          }}',
          '        >',
          `          <button class="author author-${triggerIndex}" data-p-index="${triggerIndex}">Toggle ${triggerIndex}</button>`,
          '        </Tooltip.Trigger>',
        ].join('\n'),
      ).join('\n');

      return {
        fileName: `perf/primitives/primitive-stack-${index}.tsx`,
        source: `
import { component } from '@kovojs/core';

export const PrimitiveStack${index} = component({
  render: () => (
    <primitive-stack-${index}>
${triggers}
    </primitive-stack-${index}>
  ),
});
`,
      };
    }),
    name: 'heavy-primitive-composition',
  };
}

function mixedRealAppCorpus(): CompilerPerfCorpus {
  const routes = ['/dashboard', '/accounts/:id', '/accounts/:id/settings', '/reports'];

  return {
    files: Array.from({ length: 8 }, (_, index) => ({
      fileName: `perf/app/dashboard-${index}.tsx`,
      registryFacts: { queries: { account: 'AccountQuery', report: 'ReportQuery' }, routes },
      source: `
import { component } from '@kovojs/core';
import { Link } from '@kovojs/runtime';

export const Dashboard${index} = component({
  fragmentTarget: ${index % 2 === 0},
  queries: { account: accountQuery, report: reportQuery },
  state: () => ({ expanded: false }),
  css: \`
    .summary { display: grid; gap: 8px; }
    .danger { color: red; }
  \`,
  render: ({ account, report }, state) => (
    <dashboard-${index}>
      <nav><Link to="/accounts/:id" params={{ id: 'acct-${index}' }}>Account</Link></nav>
      <section class="summary" title={account.name} viewTransitionName={account.slug}>
        <h2>{account.name}</h2>
        <p>Open invoices {report.openInvoices}</p>
        <button hidden={!state.expanded}>Collapse</button>
      </section>
      <Tooltip.Trigger asChild attrs={{ class: 'primitive', 'data-state': 'closed' }}>
        <button class="danger">Archive</button>
      </Tooltip.Trigger>
    </dashboard-${index}>
  ),
});
`,
    })),
    name: 'mixed-real-app',
  };
}
