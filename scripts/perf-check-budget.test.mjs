import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ratifyPerformanceBaseline } from './perf-baseline-ratify.mjs';
import {
  PERF_CHECK_BUDGET_SCHEMA,
  checkBudgetBaselineFindings,
  checkBudgetFindings,
  deriveCheckPerformanceBudget,
  evaluateCheckPerformanceBudget,
} from './perf-check-budget.mjs';
import { canonicalJson } from './perf-regression-check.mjs';

describe('check-scaling budget derivation', () => {
  it('derives the budget from five linked authenticated ladders', () => {
    const entries = Array.from({ length: 5 }, (_, index) => entryFixture(index));
    const baseline = ratifyPerformanceBaseline(entries);

    const budget = deriveCheckPerformanceBudget(baseline, { baselineEntries: entries });

    expect(budget.schema).toBe(PERF_CHECK_BUDGET_SCHEMA);
    expect(checkBudgetBaselineFindings(baseline, entries)).toEqual([]);
    expect(checkBudgetFindings(budget)).toEqual([]);
    expect(budget.metrics['check.appSourceTrust.marginalScalingExponent']).toMatchObject({
      baseline: { median: 1.02, p95: 1.04, runs: 5 },
      targetMaximum: 1.3,
    });
  });

  it('evaluates a new execution and separates regression from absolute targets', () => {
    const entries = Array.from({ length: 5 }, (_, index) => entryFixture(index));
    const budget = deriveCheckPerformanceBudget(ratifyPerformanceBaseline(entries), {
      baselineEntries: entries,
    });
    const candidate = entryFixture(5).report;

    expect(evaluateCheckPerformanceBudget(budget, candidate).verdict.status).toBe('pass');
    candidate.metrics['check.total.marginalScalingExponent'].value = 1.4;
    expect(evaluateCheckPerformanceBudget(budget, candidate).verdict).toMatchObject({
      status: 'regression',
    });
  });

  it('refuses raw bytes that do not reproduce a linked content digest', () => {
    const entries = Array.from({ length: 5 }, (_, index) => entryFixture(index));
    const baseline = ratifyPerformanceBaseline(entries);
    entries[0] = { ...entries[0], rawText: `${entries[0].rawText} ` };

    expect(() => deriveCheckPerformanceBudget(baseline, { baselineEntries: entries })).toThrow(
      'does not match its ratified content/link identity',
    );
  });

  it('refuses a ratified but shortened check ladder as publication evidence', () => {
    const entries = Array.from({ length: 5 }, (_, index) => entryFixture(index));
    for (const entry of entries) {
      entry.report.workloadIdentity.identity.policies.ladder = [24, 216];
      entry.report.options.ladder = [24, 216];
      entry.report.detail.rungs = entry.report.detail.rungs.filter(({ componentCount }) =>
        [24, 216].includes(componentCount),
      );
      entry.report.hostSamples = checkHostSamples([24, 216]);
      entry.report.workloadIdentity.digest = digest(
        canonicalJson(entry.report.workloadIdentity.identity),
      );
      entry.rawText = `${JSON.stringify(entry.report)}\n`;
      entry.contentDigest = digest(entry.rawText);
    }
    const baseline = ratifyPerformanceBaseline(entries);
    expect(baseline.verdict.status).toBe('ratified');
    expect(() => deriveCheckPerformanceBudget(baseline, { baselineEntries: entries })).toThrow(
      /check workload is not the exact N=8,24,72,216 one-sample ladder/u,
    );
  });

  it('executes the documented check ratify and derive commands against five Actions runs', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'kovo-check-publication-cli-'));
    try {
      const entries = Array.from({ length: 5 }, (_, index) => entryFixture(index));
      const reportPaths = entries.map((entry, index) => {
        const reportPath = path.join(root, `run-${String(index)}-check-scaling.json`);
        writeFileSync(reportPath, entry.rawText);
        return reportPath;
      });
      const baselinePath = path.join(root, 'check-baseline.json');
      const budgetPath = path.join(root, 'check-budget.json');
      const ratification = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL('./perf-baseline-ratify.mjs', import.meta.url)),
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
          fileURLToPath(new URL('./perf-check-budget.mjs', import.meta.url)),
          'derive',
          '--baseline',
          baselinePath,
          ...reportPaths.flatMap((reportPath) => ['--report', reportPath]),
          '--out',
          budgetPath,
        ],
        { encoding: 'utf8' },
      );
      expect(derivation).toMatchObject({ status: 0, stderr: '' });
      expect(JSON.parse(readFileSync(budgetPath, 'utf8')).schema).toBe(PERF_CHECK_BUDGET_SCHEMA);

      writeFileSync(reportPaths[0], `${entries[0].rawText} `);
      const hostile = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL('./perf-check-budget.mjs', import.meta.url)),
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
  });
});

function entryFixture(index) {
  const runId = String(7001 + index);
  const source = {
    commit: 'e'.repeat(40),
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
    browsers: [],
    cpu: { count: 4, model: 'Fixture CPU' },
    memoryCapacityClassBytes: 16 * 1024 ** 3,
    node: 'v24.19.0',
    platform: 'linux',
    release: '6.11.0',
    runnerImage: 'github-actions/ubuntu-24.04 ImageVersionDigest=sha256:fixture',
  };
  const workloadFacts = {
    adapters: {
      perfGate: 'kovo-perf-report/v1',
      workload: 'kovo-realistic-workload/v1',
    },
    cells: ['check-scaling'],
    policies: { ladder: [8, 24, 72, 216], samplesPerRung: 1 },
  };
  const github = {
    eventSha: 'e'.repeat(40),
    job: 'check-scaling',
    repository: 'kovojs/kovo',
    runAttempt: '1',
    runId,
    runUrl: `https://github.com/kovojs/kovo/actions/runs/${runId}`,
    serverUrl: 'https://github.com',
    sha: 'e'.repeat(40),
    workflowRef: `kovojs/kovo/.github/workflows/perf-realistic.yml@${'e'.repeat(40)}`,
    workflowSha: 'e'.repeat(40),
  };
  const executionFacts = {
    complete: true,
    github,
    provider: 'github-actions',
    startedAt: `2026-08-14T00:00:${String(index).padStart(2, '0')}.000Z`,
  };
  const rungs = [8, 24, 72, 216].map((componentCount) => ({
    appSourceTrustMedianMs: componentCount * 10,
    componentCount,
    durationMedianMs: componentCount * 20,
    peakRssBytes: 2_000_000_000,
    samples: [
      {
        appSourceTrustMs: componentCount * 10,
        censusComplete: true,
        durationMs: componentCount * 20,
        exitCode: 0,
        loadAverage: 0.2,
        peakRssBytes: 2_000_000_000,
      },
    ],
  }));
  const report = {
    detail: { rungs },
    execution: {
      ...executionFacts,
      digest: digest(canonicalJson(executionFacts)),
      schema: 'kovo-performance-execution/v1',
    },
    host: {
      ...hostFacts,
      digest: digest(canonicalJson(hostFacts)),
      schema: 'kovo-performance-host/v2',
      totalMemoryBytes: 16 * 1024 ** 3,
    },
    hostSamples: checkHostSamples(),
    integrity: {
      complete: true,
      executionAuthenticated: true,
      publishable: true,
      serialized: true,
      sourceStable: true,
      workloadAuthenticated: true,
    },
    metrics: {
      'check.appSourceTrust.marginalScalingExponent': { value: 1 + index / 100 },
      'check.peakRssBytes': { value: 2_000_000_000 + index },
      'check.total.marginalScalingExponent': { value: 0.7 + index / 100 },
    },
    options: { ladder: [8, 24, 72, 216], samples: 1 },
    schema: 'kovo-perf-report/v1',
    source,
    sourceAfter: structuredClone(source),
    suite: 'check-scaling',
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
    location: `https://github.com/kovojs/kovo/actions/runs/${runId}/artifacts/${String(8001 + index)}`,
    rawText,
    report,
  };
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function checkHostSamples(ladder = [8, 24, 72, 216]) {
  return [
    ...ladder.map((componentCount) => ({
      ceiling: 1,
      context: `N=${String(componentCount)}/sample=0`,
      loadAverage: [0.2, 0.2, 0.2],
      loadPerCpu: 0.05,
      phase: 'check-scaling',
    })),
    {
      ceiling: 1,
      context: 'check-scaling',
      loadAverage: [0.2, 0.2, 0.2],
      loadPerCpu: 0.05,
      phase: 'suite-complete',
    },
  ];
}
