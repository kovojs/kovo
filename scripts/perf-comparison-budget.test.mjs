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
    expect(evaluateComparisonPerformanceBudget(budget, candidate).verdict.status).toBe('pass');
    candidate.analysis[
      'matched-runtime/server/dynamic-listing-identity-c1/requestsPerSecond'
    ].kovo.median = 70;
    expect(evaluateComparisonPerformanceBudget(budget, candidate).verdict.failures).toContain(
      'matched-runtime/server/dynamic-listing-identity-c1/requestsPerSecond.median-vs-next',
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
  const analysis =
    subject === 'browser'
      ? browserAnalysis(index)
      : {
          'matched-runtime/server/dynamic-listing-identity-c1/p95Ms': metric(
            10 + index / 10,
            12,
            7,
          ),
          'matched-runtime/server/dynamic-listing-identity-c1/requestsPerSecond': metric(
            95 + index,
            100,
            7,
          ),
          'matched-runtime/server/hit-listing-br-c1/requestsPerSecond': metric(120 + index, 125, 7),
        };
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
      executionAuthenticated: true,
      publishable: true,
      serialized: true,
      sourceStable: true,
      workloadAuthenticated: true,
    },
    schema: 'kovo-next-performance-comparison/v1',
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
  const analysis = {
    'matched-l1/browser//lighthouse.mobile.listing.lcpMs': metric(200 + index, 300, 5),
    'matched-l1/browser//mobile.navigation.navToPaintMs': metric(100 + index, 120, 30),
  };
  for (const lane of ['default', 'matched-l0', 'matched-l1']) {
    analysis[`${lane}/browser//bfcache.applicable`] = booleanMetric(0, 1, 10);
    analysis[`${lane}/browser//bfcache.evidenceComplete`] = booleanMetric(1, 1, 10);
    analysis[`${lane}/browser//bfcache.restored`] = booleanMetric(1, 0, 10);
    for (const formFactor of ['desktop', 'mobile']) {
      for (const route of ['listing', 'detail']) {
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
