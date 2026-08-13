import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PERF_BASELINE_SCHEMA,
  ratifyPerformanceBaseline,
  resolvePerformanceReportLocations,
} from './perf-baseline-ratify.mjs';
import { canonicalJson } from './perf-regression-check.mjs';

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('performance baseline ratification', () => {
  it('ratifies five independent, linked reports for one exact subject', () => {
    const entries = [100, 102, 104, 106, 108].map((durationMs, index) =>
      entryFixture(index, durationMs),
    );

    const result = ratifyPerformanceBaseline(entries, { requireProvider: 'any' });

    expect(result.schema).toBe(PERF_BASELINE_SCHEMA);
    expect(result.verdict).toEqual({ reasons: [], status: 'ratified' });
    expect(result.metrics['matched-runtime/server/dynamic.durationMs'].kovo).toEqual({
      mad: 2,
      median: 104,
      p95: 108,
      runs: 5,
      sampleP95: {
        mad: 2,
        median: 106,
        p95: 110,
        runs: 5,
      },
    });
    expect(result.metrics['matched-runtime/server/dynamic.durationMs'].pairedDifference).toEqual({
      mad: 0,
      median: -10,
      p95: -10,
      runs: 5,
    });
    expect(
      Object.hasOwn(
        result.metrics['matched-runtime/server/dynamic.durationMs'].pairedDifference,
        'sampleP95',
      ),
    ).toBe(false);
    expect(result.subject).toMatchObject({
      host: { digest: result.identity.host },
      locks: result.identity.locks,
      sourceCommit: result.identity.source,
      workloadIdentity: { digest: result.identity.workload },
    });
    expect(result.reports).toHaveLength(5);
  });

  it('matches normalized host cohorts while preserving raw memory and rejects capacity drift', () => {
    const entries = [100, 102, 104, 106, 108].map((durationMs, index) =>
      entryFixture(index, durationMs),
    );
    entries[0].report.host.totalMemoryBytes = 16_766_427_136;
    entries[1].report.host.totalMemoryBytes = 16_766_414_848;

    expect(ratifyPerformanceBaseline(entries, { requireProvider: 'any' }).verdict).toEqual({
      reasons: [],
      status: 'ratified',
    });

    const changed = entries[4].report.host;
    changed.totalMemoryBytes = 8 * 1024 ** 3;
    changed.memoryCapacityClassBytes = 8 * 1024 ** 3;
    const { digest: _digest, schema: _schema, totalMemoryBytes: _raw, ...cohort } = changed;
    changed.digest = digest(canonicalJson(cohort));
    expect(
      ratifyPerformanceBaseline(entries, { requireProvider: 'any' }).verdict.reasons,
    ).toContain('host cohort identity differs across reports');
  });

  it('rejects short, duplicate, or identity-drifted evidence', () => {
    const entries = [100, 102, 104, 106].map((durationMs, index) =>
      entryFixture(index, durationMs),
    );
    entries.push(entries[0]);
    entries[1].report.source.commit = 'b'.repeat(40);

    const result = ratifyPerformanceBaseline(entries, { requireProvider: 'any' });

    expect(result.verdict.status).toBe('unproven');
    expect(result.verdict.reasons).toEqual(
      expect.arrayContaining([
        'duplicate execution identity',
        'duplicate report content',
        'duplicate report location',
        'source commit differs across reports',
      ]),
    );
    expect(result.metrics).toEqual({});
  });

  it('requires five reports and the configured execution provider', () => {
    const result = ratifyPerformanceBaseline([entryFixture(0, 100)], {
      requireProvider: 'github-actions',
    });
    expect(result.verdict.status).toBe('unproven');
    expect(result.verdict.reasons).toEqual(
      expect.arrayContaining([
        'received 1 reports; policy requires 5',
        'report[0] execution provider is local, expected github-actions',
      ]),
    );
  });

  it('pairs repeatable reports with durable GitHub Actions artifact locations', async () => {
    const root = await temporaryRoot();
    const reports = [
      githubEntryFixture(0, 100, '1001').report,
      githubEntryFixture(1, 102, '1002').report,
    ];
    const paths = await Promise.all(
      reports.map(async (report, index) => {
        const reportPath = path.join(root, `report-${String(index)}.json`);
        await writeFile(reportPath, `${JSON.stringify(report)}\n`);
        return reportPath;
      }),
    );
    const locations = [
      'https://github.com/kovojs/kovo/actions/runs/1001/artifacts/2001',
      'https://github.com/kovojs/kovo/actions/runs/1002/artifacts/2002',
    ];
    const output = path.join(root, 'baseline.json');
    const script = fileURLToPath(new URL('./perf-baseline-ratify.mjs', import.meta.url));
    const args = paths.flatMap((reportPath, index) => [
      '--report',
      reportPath,
      '--location',
      locations[index],
    ]);
    const result = spawnSync(
      process.execPath,
      [script, ...args, '--min-runs', '2', '--out', output],
      { encoding: 'utf8' },
    );

    expect(result).toMatchObject({ status: 0, stderr: '' });
    const baseline = JSON.parse(await readFile(output, 'utf8'));
    expect(baseline.verdict.status).toBe('ratified');
    expect(baseline.reports.map((report) => report.location)).toEqual(locations);
  });

  it('rejects an artifact location that belongs to a different Actions run', async () => {
    const root = await temporaryRoot();
    const reportPath = path.join(root, 'report.json');
    await writeFile(reportPath, `${JSON.stringify(githubEntryFixture(0, 100, '1001').report)}\n`);
    const output = path.join(root, 'baseline.json');
    const script = fileURLToPath(new URL('./perf-baseline-ratify.mjs', import.meta.url));
    const result = spawnSync(
      process.execPath,
      [
        script,
        '--report',
        reportPath,
        '--location',
        'https://github.com/kovojs/kovo/actions/runs/9999/artifacts/2001',
        '--out',
        output,
      ],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "--location[0] does not identify an artifact from its report's GitHub Actions run",
    );
  });

  it('preserves report paths only with no locations and rejects malformed location sets', () => {
    const paths = ['/tmp/report-one.json', '/tmp/report-two.json'];
    const first = 'https://github.com/kovojs/kovo/actions/runs/1001/artifacts/2001';
    const second = 'https://github.com/kovojs/kovo/actions/runs/1002/artifacts/2002';

    expect(resolvePerformanceReportLocations(paths)).toEqual(paths);
    expect(resolvePerformanceReportLocations(paths, [first, second])).toEqual([first, second]);
    expect(() => resolvePerformanceReportLocations(paths, [first])).toThrow(
      '--location count 1 must equal --report count 2',
    );
    expect(() => resolvePerformanceReportLocations(paths, [first, first])).toThrow(
      '--location values must be unique',
    );
    for (const invalid of [
      '',
      '   ',
      '/tmp/report.json',
      'http://github.com/kovojs/kovo/actions/runs/1001/artifacts/2001',
      'https://github.com/kovojs/kovo/actions/runs/1001',
      'https://github.com/kovojs/kovo/actions/runs/1001/artifacts/2001?download=1',
    ]) {
      expect(() => resolvePerformanceReportLocations(['/tmp/report.json'], [invalid])).toThrow(
        /--location/u,
      );
    }
  });
});

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-perf-ratify-test-'));
  temporaryRoots.push(root);
  return root;
}

function entryFixture(index, durationMs) {
  const hostFacts = {
    arch: 'arm64',
    browsers: [],
    cpu: { count: 10, model: 'Fixture CPU' },
    memoryCapacityClassBytes: 16 * 1024 * 1024 * 1024,
    node: 'v24.19.0',
    platform: 'darwin',
    release: '25.2.0',
    runnerImage: 'fixture-runner@sha256:one',
  };
  const workloadFacts = {
    adapters: { server: 'kovo-server-benchmark/v1' },
    cells: ['server'],
    corpus: {},
    lanes: ['matched-runtime'],
    policies: {
      browserSamples: 30,
      server: { samples: 7 },
    },
  };
  const executionFacts = {
    complete: true,
    local: {
      nonce: createHash('sha256').update(String(index)).digest('hex').slice(0, 32),
      pid: 42,
    },
    provider: 'local',
    startedAt: `2026-08-13T12:00:0${String(index)}.000Z`,
  };
  const report = {
    analysis: {
      'matched-runtime/server/dynamic.durationMs': metricFixture(durationMs),
    },
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
      totalMemoryBytes: 16 * 1024 * 1024 * 1024,
    },
    hostSamples: [{ ceiling: 1, loadPerCpu: 0.1 }],
    integrity: {
      comparatorMatched: true,
      executionAuthenticated: true,
      publishable: true,
      serialized: true,
      sourceStable: true,
      workloadAuthenticated: true,
    },
    schema: 'kovo-next-performance-comparison/v1',
    source: {
      commit: 'a'.repeat(40),
      dirty: false,
      dirtyPaths: [],
      locks: {
        'benchmarks/harness/pnpm-lock.yaml': digest('harness lock'),
        'benchmarks/nextjs/pnpm-lock.yaml': digest('next lock'),
        'pnpm-lock.yaml': digest('root lock'),
      },
    },
    verdict: { reasons: [], status: 'measured' },
    workloadIdentity: {
      complete: true,
      digest: digest(canonicalJson(workloadFacts)),
      identity: workloadFacts,
      schema: 'kovo-performance-workload-identity/v1',
    },
  };
  const text = JSON.stringify(report);
  return {
    contentDigest: digest(text),
    location: `artifacts/run-${String(index)}/comparison.json`,
    report,
  };
}

function githubEntryFixture(index, durationMs, runId) {
  const entry = entryFixture(index, durationMs);
  const github = {
    job: 'performance-baselines',
    repository: 'kovojs/kovo',
    runAttempt: '1',
    runId,
    runUrl: `https://github.com/kovojs/kovo/actions/runs/${runId}`,
    serverUrl: 'https://github.com',
    sha: 'a'.repeat(40),
    workflowRef: `kovojs/kovo/.github/workflows/perf-realistic.yml@${'a'.repeat(40)}`,
  };
  const facts = {
    complete: true,
    github,
    provider: 'github-actions',
    startedAt: entry.report.generatedAt,
  };
  entry.report.execution = {
    ...facts,
    digest: digest(canonicalJson(facts)),
    schema: 'kovo-performance-execution/v1',
  };
  entry.contentDigest = digest(JSON.stringify(entry.report));
  return entry;
}

function metricFixture(value) {
  return {
    kovo: { mad: 1, median: value, p95: value + 2, samples: 7 },
    nextjs: { mad: 1, median: value + 10, p95: value + 12, samples: 7 },
    pairedDifference: {
      bootstrap95Ci: [-12, -8],
      direction: 'kovo-minus-nextjs',
      median: -10,
      samples: 7,
    },
  };
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
