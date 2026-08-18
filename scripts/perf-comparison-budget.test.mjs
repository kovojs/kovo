import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ratifyPerformanceBaseline } from './perf-baseline-ratify.mjs';
import {
  PERF_COMPARISON_BUDGET_SCHEMA,
  comparisonBudgetBaselineFindings,
  comparisonBudgetFindings,
  deriveComparisonPerformanceBudget,
  evaluateComparisonPerformanceBudget,
  renderComparisonBudgetMarkdown,
} from './perf-comparison-budget.mjs';
import { canonicalJson } from './perf-regression-check.mjs';

describe('browser/server comparison budgets', () => {
  it('derives directional browser budgets from five linked raw reports', () => {
    const entries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    const baseline = ratifyPerformanceBaseline(entries);

    const budget = deriveComparisonPerformanceBudget(baseline, { baselineEntries: entries });

    expect(budget.schema).toBe(PERF_COMPARISON_BUDGET_SCHEMA);
    expect(comparisonBudgetBaselineFindings(baseline, entries)).toEqual([]);
    expect(comparisonBudgetFindings(budget)).toEqual([]);
    expect(budget.targetAssessment).toMatchObject({ failures: [], status: 'pass' });
    expect(budget.targetAssessment.checks.map((check) => check.id)).toEqual([
      'matched-l1/browser//mobile.navigation.navToPaintMs.median-vs-next',
      'matched-l1/browser//mobile.navigation.sessionBytes.throughDestinationPaint.total.median-vs-next',
    ]);
    expect(budget.metrics['matched-l1/browser//mobile.navigation.navToPaintMs']).toMatchObject({
      direction: 'lower-is-better',
      kind: 'ratified-regression-ceiling',
    });
    expect(
      budget.metrics['matched-l1/browser//lighthouse.mobile.listing.performanceScore'],
    ).toMatchObject({
      direction: 'higher-is-better',
      kind: 'ratified-regression-floor',
    });
    expect(budget.metrics['matched-l1/browser//bfcache.evidenceComplete']).toMatchObject({
      kind: 'exact-availability-floor',
      minimum: 1,
    });
    expect(budget.metrics['matched-l1/browser//bfcache.restored']).toMatchObject({
      direction: 'higher-is-better',
      kind: 'ratified-regression-floor',
    });
    expect(budget.metrics['matched-l1/browser//bfcache.applicable']).toMatchObject({
      direction: null,
      kind: 'informational',
    });
    const markdown = renderComparisonBudgetMarkdown(budget);
    expect(markdown).toContain('# Ratified browser performance baseline');
    expect(markdown).toContain(entries[0].location);
    expect(markdown).toContain('capability-matched');
    expect(markdown).toContain('same-document navigation');
    expect(markdown).toContain('bfcache.applicable');
  });

  it('evaluates a new same-subject report and enforces the matched L1 navigation target', () => {
    const entries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    const baseline = ratifyPerformanceBaseline(entries);
    const budget = deriveComparisonPerformanceBudget(baseline, { baselineEntries: entries });
    const candidate = reportEntry(5, 'browser').report;

    expect(evaluateComparisonPerformanceBudget(budget, candidate).verdict.status).toBe('pass');
    candidate.analysis['matched-l1/browser//mobile.navigation.navToPaintMs'].kovo.median = 250;
    expect(evaluateComparisonPerformanceBudget(budget, candidate).verdict).toMatchObject({
      status: 'regression',
    });
  });

  it('derives and enforces server throughput targets separately by posture', () => {
    const entries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'server'));
    const baseline = ratifyPerformanceBaseline(entries);
    const budget = deriveComparisonPerformanceBudget(baseline, { baselineEntries: entries });
    const candidate = reportEntry(5, 'server').report;

    expect(comparisonBudgetFindings(budget)).toEqual([]);
    expect(budget.targetAssessment).toMatchObject({ failures: [], status: 'pass' });
    expect(budget.targetAssessment.checks).toHaveLength(12);
    expect(budget.targetAssessment.checks.every((check) => check.id.includes('-identity-'))).toBe(
      true,
    );
    expect(budget.policy.representations).toEqual({
      cachedComparisonEncoding: 'identity',
      forcedDynamicComparisonEncoding: 'identity',
      kovoBrotliPosture: 'required-raw-measurement-not-a-paired-next-target',
      nextBrotliPosture: 'unsupported',
    });
    expect(evaluateComparisonPerformanceBudget(budget, candidate).verdict.status).toBe('pass');
    candidate.analysis[
      'matched-runtime/server/dynamic-listing-identity-c1/requestsPerSecond'
    ].kovo.median = 70;
    expect(evaluateComparisonPerformanceBudget(budget, candidate).verdict.failures).toContain(
      'matched-runtime/server/dynamic-listing-identity-c1/requestsPerSecond.median-vs-next',
    );

    const shortened = structuredClone(budget);
    shortened.targetAssessment.checks.pop();
    resealBudget(shortened);
    expect(comparisonBudgetFindings(shortened)).toContain(
      'budget target assessment is not derived from ratified evidence',
    );

    const weakened = structuredClone(budget);
    weakened.policy.targets.cachedThroughputMinimumRatio = 0;
    resealBudget(weakened);
    expect(comparisonBudgetFindings(weakened)).toContain(
      'budget competitive target policy differs from the declared target census',
    );
  });

  it('refuses derivation when a downloaded report no longer matches its ratified digest', () => {
    const entries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    const baseline = ratifyPerformanceBaseline(entries);
    entries[0] = { ...entries[0], rawText: `${entries[0].rawText} ` };

    expect(() => deriveComparisonPerformanceBudget(baseline, { baselineEntries: entries })).toThrow(
      'does not match its ratified content/link identity',
    );
  });

  it('refuses shortened browser evidence and a partial server matrix', () => {
    const browserEntries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    for (const entry of browserEntries) {
      entry.report.workloadIdentity.identity.policies.skipLighthouse = true;
      refreshEntry(entry);
    }
    const browserBaseline = ratifyPerformanceBaseline(browserEntries);
    expect(browserBaseline.verdict.status).toBe('ratified');
    expect(() =>
      deriveComparisonPerformanceBudget(browserBaseline, { baselineEntries: browserEntries }),
    ).toThrow(/browser workload is not 30 samples, 5 Lighthouse runs, 10 bfcache traversals/u);

    const missingBfcache = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    for (const entry of missingBfcache) {
      delete entry.report.analysis['matched-l0/browser//bfcache.evidenceComplete'];
      refreshEntry(entry);
    }
    const missingBaseline = ratifyPerformanceBaseline(missingBfcache);
    expect(missingBaseline.verdict.status).toBe('ratified');
    expect(() =>
      deriveComparisonPerformanceBudget(missingBaseline, { baselineEntries: missingBfcache }),
    ).toThrow(/matched-l0\/browser\/\/bfcache\.evidenceComplete is unavailable/u);

    const missingSessionBytes = Array.from({ length: 5 }, (_, index) =>
      reportEntry(index, 'browser'),
    );
    for (const entry of missingSessionBytes) {
      delete entry.report.analysis[
        'matched-l1/browser//mobile.navigation.sessionBytes.throughDestinationPaint.total'
      ];
      refreshEntry(entry);
    }
    const missingSessionBaseline = ratifyPerformanceBaseline(missingSessionBytes);
    expect(() =>
      deriveComparisonPerformanceBudget(missingSessionBaseline, {
        baselineEntries: missingSessionBytes,
      }),
    ).toThrow(/sessionBytes\.throughDestinationPaint\.total is unavailable/u);

    for (const requiredMetric of [
      'default/browser//desktop.coldLoad.fcpMs',
      'matched-l0/browser//mobile.navigation.navAttribution.phases.responseProcessingDomApply.durationMs',
      'matched-l1/browser//lighthouse.mobile.detail.lcpMs',
    ]) {
      const missingMetric = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
      for (const entry of missingMetric) {
        delete entry.report.analysis[requiredMetric];
        refreshEntry(entry);
      }
      const baseline = ratifyPerformanceBaseline(missingMetric);
      expect(() =>
        deriveComparisonPerformanceBudget(baseline, { baselineEntries: missingMetric }),
      ).toThrow(`required browser metric ${requiredMetric} is unavailable`);
    }

    const serverEntries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'server'));
    for (const entry of serverEntries) {
      entry.report.workloadIdentity.identity.policies.server.routes = ['listing'];
      refreshEntry(entry);
    }
    const serverBaseline = ratifyPerformanceBaseline(serverEntries);
    expect(serverBaseline.verdict.status).toBe('ratified');
    expect(() =>
      deriveComparisonPerformanceBudget(serverBaseline, { baselineEntries: serverEntries }),
    ).toThrow(
      /server workload is not the full 7-sample route\/encoding\/mode\/concurrency matrix/u,
    );
  });

  it("requires the exact raw browser census and both entrants' measured runtime posture", () => {
    const omitted = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    omitted[2].report.rawCells.pop();
    refreshEntry(omitted[2]);
    expect(() =>
      deriveComparisonPerformanceBudget(ratifyPerformanceBaseline(omitted), {
        baselineEntries: omitted,
      }),
    ).toThrow(/raw browser cell census is not the exact 12 cells/u);

    const kovoScript = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    const kovoDefault = kovoScript[0].report.rawCells.find(
      (cell) => cell.framework === 'kovo' && cell.lane === 'default',
    );
    kovoDefault.report.apps[0].conditions.desktop.coldLoad.iterations[0].fixtureScriptCount = 1;
    kovoDefault.report.apps[0].conditions.desktop.coldLoad.iterations[0].bytes.js = 1;
    refreshEntry(kovoScript[0]);
    expect(() =>
      deriveComparisonPerformanceBudget(ratifyPerformanceBaseline(kovoScript), {
        baselineEntries: kovoScript,
      }),
    ).toThrow(/Kovo L0 zero-JavaScript posture is not proved/u);

    const kovoBytes = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    const kovoL0Bytes = kovoBytes[3].report.rawCells.find(
      (cell) => cell.framework === 'kovo' && cell.lane === 'matched-l0',
    );
    kovoL0Bytes.report.apps[0].conditions.mobile.coldLoad.iterations[0].bytes.js = 1;
    refreshEntry(kovoBytes[3]);
    expect(() =>
      deriveComparisonPerformanceBudget(ratifyPerformanceBaseline(kovoBytes), {
        baselineEntries: kovoBytes,
      }),
    ).toThrow(/Kovo L0 zero-JavaScript posture is not proved/u);

    const nextScript = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    const nextL0 = nextScript[4].report.rawCells.find(
      (cell) => cell.framework === 'nextjs' && cell.lane === 'matched-l0',
    );
    nextL0.report.apps[0].conditions.mobile.coldLoad.iterations[0].fixtureScriptCount = 0;
    refreshEntry(nextScript[4]);
    expect(() =>
      deriveComparisonPerformanceBudget(ratifyPerformanceBaseline(nextScript), {
        baselineEntries: nextScript,
      }),
    ).toThrow(/Next default\/L0 script posture is not proved/u);

    const nextDefaultScript = Array.from({ length: 5 }, (_, index) =>
      reportEntry(index, 'browser'),
    );
    const nextDefault = nextDefaultScript[1].report.rawCells.find(
      (cell) => cell.framework === 'nextjs' && cell.lane === 'default',
    );
    nextDefault.report.apps[0].conditions.desktop.coldLoad.iterations[0].fixtureScriptCount = 0;
    refreshEntry(nextDefaultScript[1]);
    expect(() =>
      deriveComparisonPerformanceBudget(ratifyPerformanceBaseline(nextDefaultScript), {
        baselineEntries: nextDefaultScript,
      }),
    ).toThrow(/Next default\/L0 script posture is not proved/u);

    const clean = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
    const budget = deriveComparisonPerformanceBudget(ratifyPerformanceBaseline(clean), {
      baselineEntries: clean,
    });
    const holdout = reportEntry(5, 'browser').report;
    const kovoL1 = holdout.rawCells.find(
      (cell) => cell.framework === 'kovo' && cell.lane === 'matched-l1',
    );
    kovoL1.report.apps[0].conditions.desktop.navigation.iterations[0].navDocumentReplaced = 1;
    expect(evaluateComparisonPerformanceBudget(budget, holdout).verdict).toMatchObject({
      status: 'unproven',
    });

    const nextHoldout = reportEntry(6, 'browser').report;
    const nextL1 = nextHoldout.rawCells.find(
      (cell) => cell.framework === 'nextjs' && cell.lane === 'matched-l1',
    );
    nextL1.report.apps[0].conditions.mobile.navigation.iterations[0].navAttribution.primaryResponse.contentType =
      'application/json';
    expect(evaluateComparisonPerformanceBudget(budget, nextHoldout).verdict).toMatchObject({
      status: 'unproven',
    });
  });

  it('requires cold-load JavaScript and total bytes for every lane and form factor', () => {
    for (const requiredMetric of [
      'default/browser//desktop.coldLoad.bytes.js',
      'matched-l0/browser//mobile.coldLoad.bytes.total',
      'matched-l1/browser//desktop.coldLoad.bytes.total',
    ]) {
      const entries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'browser'));
      for (const entry of entries) {
        delete entry.report.analysis[requiredMetric];
        refreshEntry(entry);
      }
      expect(() =>
        deriveComparisonPerformanceBudget(ratifyPerformanceBaseline(entries), {
          baselineEntries: entries,
        }),
      ).toThrow(`required browser metric ${requiredMetric} is unavailable`);
    }
  });

  it('rejects omitted identity targets, fabricated paired Brotli, and missing raw Brotli proof', () => {
    const missingIdentity = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'server'));
    for (const entry of missingIdentity) {
      delete entry.report.analysis[
        'matched-runtime/server/hit-detail-identity-c32/requestsPerSecond'
      ];
      refreshEntry(entry);
    }
    const missingIdentityBaseline = ratifyPerformanceBaseline(missingIdentity);
    expect(() =>
      deriveComparisonPerformanceBudget(missingIdentityBaseline, {
        baselineEntries: missingIdentity,
      }),
    ).toThrow(/required server target metric .*hit-detail-identity-c32/u);

    const fabricatedBrotli = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'server'));
    for (const entry of fabricatedBrotli) {
      entry.report.analysis['matched-runtime/server/hit-listing-br-c1/requestsPerSecond'] = metric(
        120,
        125,
        7,
      );
      refreshEntry(entry);
    }
    const fabricatedBaseline = ratifyPerformanceBaseline(fabricatedBrotli);
    expect(() =>
      deriveComparisonPerformanceBudget(fabricatedBaseline, { baselineEntries: fabricatedBrotli }),
    ).toThrow(/fabricates a paired Brotli comparison/u);

    const missingRawBrotli = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'server'));
    for (const entry of missingRawBrotli) {
      entry.report.rawCells.pop();
      refreshEntry(entry);
    }
    const missingRawBaseline = ratifyPerformanceBaseline(missingRawBrotli);
    expect(() =>
      deriveComparisonPerformanceBudget(missingRawBaseline, { baselineEntries: missingRawBrotli }),
    ).toThrow(/Brotli raw cell census is incomplete/u);

    const cleanEntries = Array.from({ length: 5 }, (_, index) => reportEntry(index, 'server'));
    const cleanBaseline = ratifyPerformanceBaseline(cleanEntries);
    const budget = deriveComparisonPerformanceBudget(cleanBaseline, {
      baselineEntries: cleanEntries,
    });
    const hostileHoldout = reportEntry(5, 'server').report;
    hostileHoldout.rawCells.pop();
    expect(evaluateComparisonPerformanceBudget(budget, hostileHoldout).verdict).toMatchObject({
      status: 'unproven',
    });
  });

  it.each(['browser', 'server'])(
    'executes the documented %s ratify and derive commands against five Actions runs',
    (subject) => {
      const root = mkdtempSync(path.join(os.tmpdir(), `kovo-${subject}-publication-cli-`));
      try {
        const entries = Array.from({ length: 5 }, (_, index) => reportEntry(index, subject));
        const reportPaths = entries.map((entry, index) => {
          const reportPath = path.join(root, `run-${String(index)}-comparison.json`);
          writeFileSync(reportPath, entry.rawText);
          return reportPath;
        });
        const baselinePath = path.join(root, `${subject}-baseline.json`);
        const budgetPath = path.join(root, `${subject}-budget.json`);
        const markdownPath = path.join(root, `${subject}-baseline.md`);
        const ratifier = fileURLToPath(new URL('./perf-baseline-ratify.mjs', import.meta.url));
        const ratification = spawnSync(
          process.execPath,
          [
            ratifier,
            ...reportPaths.flatMap((reportPath, index) => [
              '--report',
              reportPath,
              '--location',
              entries[index].location,
            ]),
            '--out',
            baselinePath,
          ],
          { encoding: 'utf8' },
        );
        expect(ratification).toMatchObject({ status: 0, stderr: '' });
        const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
        expect(new Set(baseline.reports.map(({ runUrl }) => runUrl)).size).toBe(5);
        expect(baseline.identity).toMatchObject({
          host: entries[0].report.host.digest,
          locks: entries[0].report.source.locks,
          source: entries[0].report.source.commit,
          workload: entries[0].report.workloadIdentity.digest,
        });

        const derivation = spawnSync(
          process.execPath,
          [
            fileURLToPath(new URL('./perf-comparison-budget.mjs', import.meta.url)),
            'derive',
            '--baseline',
            baselinePath,
            ...reportPaths.flatMap((reportPath) => ['--report', reportPath]),
            '--out',
            budgetPath,
            '--markdown-out',
            markdownPath,
          ],
          { encoding: 'utf8' },
        );
        expect(derivation).toMatchObject({ status: 0, stderr: '' });
        expect(JSON.parse(readFileSync(budgetPath, 'utf8')).subject.kind).toBe(subject);
        expect(readFileSync(markdownPath, 'utf8')).toContain(entries[0].location);

        writeFileSync(reportPaths[0], `${entries[0].rawText} `);
        const hostile = spawnSync(
          process.execPath,
          [
            fileURLToPath(new URL('./perf-comparison-budget.mjs', import.meta.url)),
            'derive',
            '--baseline',
            baselinePath,
            ...reportPaths.flatMap((reportPath) => ['--report', reportPath]),
            '--out',
            budgetPath,
          ],
          { encoding: 'utf8' },
        );
        expect(hostile.status).toBe(2);
        expect(hostile.stderr).toContain('does not match its ratified content/link identity');
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
  );
});

function reportEntry(index, subject) {
  const runId = String(5001 + index);
  const source = {
    commit: 'd'.repeat(40),
    dirty: false,
    dirtyPaths: [],
    locks: {
      'benchmarks/harness/pnpm-lock.yaml': digest('harness lock'),
      'benchmarks/nextjs/pnpm-lock.yaml': digest('next lock'),
      'pnpm-lock.yaml': digest('root lock'),
    },
  };
  const hostFacts = {
    arch: 'x64',
    browsers: subject === 'browser' ? ['chromium 148'] : [],
    cpu: { count: 4, model: 'Fixture CPU' },
    memoryCapacityClassBytes: 16 * 1024 ** 3,
    node: 'v24.19.0',
    platform: 'linux',
    release: '6.11.0',
    runnerImage: 'github-actions/ubuntu-24.04 ImageVersionDigest=sha256:fixture',
  };
  const policies =
    subject === 'browser'
      ? {
          bfcacheIterations: 10,
          browserSamples: 30,
          buildSamples: 30,
          corpusSize: 24,
          devEditSamples: 30,
          devReadySamples: 15,
          lighthouseRuns: 5,
          server: serverPolicy(),
          skipLighthouse: false,
          warmups: 3,
        }
      : {
          bfcacheIterations: 10,
          browserSamples: 30,
          buildSamples: 30,
          corpusSize: 24,
          devEditSamples: 30,
          devReadySamples: 15,
          lighthouseRuns: 5,
          server: serverPolicy(),
          skipLighthouse: false,
          warmups: 3,
        };
  const workloadFacts = {
    adapters: { compare: 'kovo-next-performance-comparison/v1' },
    cells: [subject],
    corpus: {},
    lanes: subject === 'browser' ? ['default', 'matched-l0', 'matched-l1'] : ['matched-runtime'],
    policies,
  };
  const github = {
    eventSha: 'd'.repeat(40),
    job: `${subject}-matrix`,
    repository: 'kovojs/kovo',
    runAttempt: '1',
    runId,
    runUrl: `https://github.com/kovojs/kovo/actions/runs/${runId}`,
    serverUrl: 'https://github.com',
    sha: 'd'.repeat(40),
    workflowRef: `kovojs/kovo/.github/workflows/perf-realistic.yml@${'d'.repeat(40)}`,
    workflowSha: 'd'.repeat(40),
  };
  const executionFacts = {
    complete: true,
    github,
    provider: 'github-actions',
    startedAt: `2026-08-14T00:00:${String(index).padStart(2, '0')}.000Z`,
  };
  const analysis = subject === 'browser' ? browserAnalysis(index) : serverAnalysis(index);
  const report = {
    analysis,
    execution: {
      ...executionFacts,
      digest: digest(canonicalJson(executionFacts)),
      schema: 'kovo-performance-execution/v1',
    },
    generatedAt: executionFacts.startedAt,
    host: {
      ...hostFacts,
      digest: digest(canonicalJson(hostFacts)),
      schema: 'kovo-performance-host/v2',
      totalMemoryBytes: 16 * 1024 ** 3,
    },
    hostSamples: [{ ceiling: 1, loadAverage: [0.2, 0.2, 0.2], loadPerCpu: 0.05 }],
    integrity: {
      comparatorMatched: true,
      ...(subject === 'server' ? { comparator: { serverMatrix: serverSupportCensus() } } : {}),
      executionAuthenticated: true,
      publishable: true,
      serialized: true,
      sourceStable: true,
      workloadAuthenticated: true,
    },
    schema: 'kovo-next-performance-comparison/v1',
    ...(subject === 'browser'
      ? { rawCells: browserRawCells() }
      : { rawCells: serverBrotliRawCells() }),
    source,
    verdict: { reasons: [], status: 'measured' },
    workloadIdentity: {
      complete: true,
      digest: digest(canonicalJson(workloadFacts)),
      identity: workloadFacts,
      schema: 'kovo-performance-workload-identity/v1',
    },
  };
  const rawText = `${JSON.stringify(report)}\n`;
  return {
    contentDigest: digest(rawText),
    location: `https://github.com/kovojs/kovo/actions/runs/${runId}/artifacts/${String(6001 + index)}`,
    rawText,
    report,
  };
}

function browserAnalysis(index) {
  const analysis = {};
  for (const lane of ['default', 'matched-l0', 'matched-l1']) {
    analysis[`${lane}/browser//bfcache.applicable`] = booleanMetric(0, 1, 10);
    analysis[`${lane}/browser//bfcache.evidenceComplete`] = booleanMetric(1, 1, 10);
    analysis[`${lane}/browser//bfcache.restored`] = booleanMetric(1, 0, 10);
    for (const formFactor of ['desktop', 'mobile']) {
      for (const leaf of ['fcpMs', 'lcpMs', 'bytes.js', 'bytes.total']) {
        analysis[`${lane}/browser//${formFactor}.coldLoad.${leaf}`] = metric(200 + index, 220, 30);
      }
      analysis[`${lane}/browser//${formFactor}.navigation.navToPaintMs`] = metric(
        100 + index,
        120,
        30,
      );
      for (const phase of [
        'server',
        'transfer',
        'responseProcessingDomApply',
        'style',
        'layout',
        'paint',
      ]) {
        analysis[
          `${lane}/browser//${formFactor}.navigation.navAttribution.phases.${phase}.durationMs`
        ] = metric(10 + index / 10, 12, 30);
      }
      for (const phase of [
        'initial',
        'automaticPrefetch',
        'preClickBackground',
        'click',
        'postClick',
        'throughClick',
        'throughDestinationPaint',
        'settledSession',
      ]) {
        const kovo = phase === 'throughDestinationPaint' && lane === 'matched-l1' ? 40 : 80;
        analysis[`${lane}/browser//${formFactor}.navigation.sessionBytes.${phase}.total`] = metric(
          kovo,
          100,
          30,
        );
      }
      for (const route of ['listing', 'detail']) {
        for (const leaf of ['fcpMs', 'lcpMs']) {
          analysis[`${lane}/browser//lighthouse.${formFactor}.${route}.${leaf}`] = metric(
            200 + index,
            220,
            5,
          );
        }
        analysis[`${lane}/browser//lighthouse.${formFactor}.${route}.performanceScore`] = metric(
          0.9,
          0.8,
          5,
        );
      }
    }
  }
  return analysis;
}

function browserRawCells() {
  return ['default', 'matched-l0', 'matched-l1'].flatMap((lane) =>
    ['kovo', 'nextjs'].flatMap((framework) =>
      [0, 1].map((occurrence) => {
        const iterations = 15;
        const lighthouseRepeats = occurrence === 0 ? 3 : 2;
        const coldSample = () => {
          const zeroJavaScript = framework === 'kovo' && lane !== 'matched-l1';
          return {
            bytes: { js: zeroJavaScript ? 0 : 100, total: 1_000 },
            fixtureScriptCount: zeroJavaScript ? 0 : 1,
          };
        };
        const navigationSample = () => ({
          ...(lane === 'matched-l1'
            ? framework === 'kovo'
              ? {
                  navAttribution: {
                    primaryResponse: {
                      contentType: 'application/vnd.kovo.document-parts+json; charset=utf-8',
                      resourceType: 'fetch',
                      selection: 'kovo-document-parts-media-type',
                      status: 'observed',
                    },
                  },
                  navDocumentReplaced: 0,
                }
              : {
                  navAttribution: {
                    primaryResponse: {
                      contentType: 'text/html; charset=utf-8',
                      networkWitness: {
                        facts: { isNavigationRequest: true, resourceType: 'document' },
                      },
                      resourceType: 'document',
                      selection: 'document-resource',
                      status: 'observed',
                    },
                  },
                  navDocumentReplaced: 1,
                }
            : {}),
        });
        const condition = () => ({
          coldLoad: { iterations: Array.from({ length: iterations }, coldSample) },
          navigation: { iterations: Array.from({ length: iterations }, navigationSample) },
          ttiProbe: {
            iterations: lane === 'matched-l0' ? [] : Array.from({ length: iterations }, () => ({})),
          },
        });
        return {
          cell: 'browser',
          framework,
          lane,
          occurrence,
          report: {
            apps: [
              {
                app: framework,
                bfcache: { iterations: Array.from({ length: 5 }, () => ({})) },
                conditions: { desktop: condition(), mobile: condition() },
                lighthouse: ['desktop', 'desktop', 'mobile', 'mobile'].map((formFactor) => ({
                  formFactor,
                  repeats: lighthouseRepeats,
                  samples: Array.from({ length: lighthouseRepeats }, () => ({})),
                })),
              },
            ],
            iterations,
            lane,
            schema: 'kovo-browser-benchmark/v1',
          },
        };
      }),
    ),
  );
}

function serverAnalysis(index) {
  const analysis = {};
  for (const mode of ['dynamic', 'hit']) {
    for (const route of ['listing', 'detail']) {
      for (const concurrency of [1, 8, 32]) {
        const prefix = `matched-runtime/server/${mode}-${route}-identity-c${String(concurrency)}`;
        analysis[`${prefix}/requestsPerSecond`] = metric(95 + index, 100, 7);
        analysis[`${prefix}/p95Ms`] = metric(10 + index / 10, 12, 7);
      }
    }
  }
  return analysis;
}

function serverSupportCensus() {
  return {
    completeSupportedMatrix: true,
    excludedUnsupported: serverConditionKeys('br').map((condition) => ({
      condition,
      unsupportedFrameworks: ['nextjs'],
    })),
    findings: [],
    supported: serverConditionKeys('identity'),
  };
}

function serverBrotliRawCells() {
  return serverConditionKeys('br').flatMap((condition) => {
    const [mode, route, encoding, concurrencyText] = condition.split('-');
    const concurrency = Number(concurrencyText.slice(1));
    const declaredMode = mode === 'hit' ? 'HIT' : mode === '304' ? '304' : 'dynamic';
    return ['kovo', 'nextjs'].flatMap((framework) =>
      Array.from({ length: 7 }, (_, occurrence) => ({
        cell: 'server',
        framework,
        lane: 'matched-runtime',
        mode: condition,
        occurrence,
        report: {
          condition: {
            concurrency,
            encoding,
            key: condition,
            mode: declaredMode,
            route,
          },
          correctness: { contentEncoding: framework === 'kovo' && mode !== '304' ? 'br' : null },
          framework,
          samples: framework === 'kovo' ? [{ requestsPerSecond: 125 }] : [],
          support: { status: framework === 'kovo' ? 'supported' : 'unsupported' },
          verdict: { status: framework === 'kovo' ? 'measured' : 'unsupported' },
        },
      })),
    );
  });
}

function serverConditionKeys(encoding) {
  const keys = [];
  for (const concurrency of [1, 8, 32]) {
    for (const route of ['listing', 'detail']) {
      for (const mode of ['HIT', '304', 'dynamic']) {
        keys.push(`${mode.toLowerCase()}-${route}-${encoding}-c${String(concurrency)}`);
      }
    }
  }
  return keys;
}

function serverPolicy() {
  return {
    concurrencies: [1, 8, 32],
    durationMs: 15_000,
    encodings: ['identity', 'br'],
    hostSettleMaxMs: 30_000,
    hostSettlePollMs: 1_000,
    modes: ['HIT', '304', 'dynamic'],
    routes: ['listing', 'detail'],
    samples: 7,
    warmupMs: 5_000,
  };
}

function refreshEntry(entry) {
  const workload = entry.report.workloadIdentity;
  workload.digest = digest(canonicalJson(workload.identity));
  entry.rawText = `${JSON.stringify(entry.report)}\n`;
  entry.contentDigest = digest(entry.rawText);
}

function metric(kovo, nextjs, samples) {
  return {
    kovo: { mad: 1, median: kovo, p95: kovo + 1, samples },
    nextjs: { mad: 1, median: nextjs, p95: nextjs + 1, samples },
    pairedDifference: {
      bootstrap95Ci: [kovo - nextjs - 1, kovo - nextjs + 1],
      direction: 'kovo-minus-nextjs',
      median: kovo - nextjs,
      samples,
    },
  };
}

function booleanMetric(kovo, nextjs, samples) {
  return {
    kovo: { mad: 0, median: kovo, p95: kovo, samples },
    nextjs: { mad: 0, median: nextjs, p95: nextjs, samples },
    pairedDifference: {
      bootstrap95Ci: [kovo - nextjs, kovo - nextjs],
      direction: 'kovo-minus-nextjs',
      median: kovo - nextjs,
      samples,
    },
  };
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function resealBudget(budget) {
  const facts = { ...budget };
  delete facts.digest;
  budget.digest = digest(canonicalJson(facts));
}
