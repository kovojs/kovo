// Regression test for the benchmark report generator.
//
// plans/good-perf.md O15/D14: the committed report was deleted because it stated favourable
// numbers without stating the conditions that made them meaningless. The columns asserted here are
// the ones that make a bad run *look* bad — posture, collection-window understatement, whether the
// navigation replaced the document, Lighthouse null samples, and bfcache applicability. A future
// edit that drops one of them silently restores the old failure mode, so they are pinned.
//
// Imports only `report.mjs`, which depends on nothing outside node:fs — the rest of the harness
// needs Playwright/Lighthouse from `benchmarks/harness/node_modules`, which the root unit pool does
// not install.
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeReport } from './report.mjs';

const RESULTS = {
  generatedAt: '2026-08-07T00:00:00.000Z',
  iterations: 3,
  lighthouseRepeats: 3,
  machine: {
    arch: 'arm64',
    cpus: 10,
    loadAverage: [18.5, 12.25, 8],
    node: 'v24.19.0',
    platform: 'darwin',
    totalMemoryBytes: 16 * 1024 ** 3,
  },
  runId: 'testrun',
  settle: { maxMs: 10_000, quietMs: 750 },
  apps: [
    {
      app: 'replacer',
      framework: 'Document-replacing framework',
      posture: { attestation: 'synthesized-per-run', nodeEnv: 'production' },
      versions: { framework: '1.0.0' },
      bfcache: {
        applicableCount: 3,
        available: true,
        browser: '148.0.0.0',
        iterations: [{ applicable: true }, { applicable: true }, { applicable: true }],
        notRestoredReasons: [],
        restoredCount: 3,
        restoredRate: 1,
        unavailableReason: null,
      },
      lighthouse: [
        {
          formFactor: 'desktop',
          metrics: { bytes: 400_000, fcpMs: 1500, lcpMs: 1600, performanceScore: 0.8, tbtMs: 0 },
          nullSamples: { performanceScore: 2 },
          path: '/',
          repeats: 3,
          spread: { performanceScore: 0.19 },
        },
      ],
      conditions: {
        desktop: {
          coldLoad: {
            iterations: [{ settleTimedOut: 1 }, { settleTimedOut: 0 }, { settleTimedOut: 0 }],
            summary: {
              'bytes.js': { median: 267_948 },
              'bytes.total': { median: 434_847 },
              'loadWindow.bytes.js': { median: 0 },
              'loadWindow.bytes.total': { median: 164_673 },
              settleMs: { median: 2129 },
            },
          },
          navigation: {
            iterations: [
              { navDocumentReplaced: 1 },
              { navDocumentReplaced: 1 },
              { navDocumentReplaced: 1 },
            ],
            summary: {
              navBytesSettled: { median: 152_537 },
              navLegacyDomPresenceMs: { median: 69 },
              navRequests: { median: 5 },
              navToDomMs: { median: 1175 },
              navToPaintMs: { mad: 3, median: 1153 },
            },
          },
          ttiProbe: { iterations: [], summary: { ttiProxyMs: { mad: 0, median: 400 } } },
        },
        mobile: { coldLoad: {}, navigation: {}, ttiProbe: {} },
      },
    },
    {
      app: 'sameDoc',
      framework: 'Same-document framework',
      posture: { attestation: 'not-required', nodeEnv: 'production' },
      versions: {},
      bfcache: {
        applicableCount: 0,
        available: true,
        browser: '148.0.0.0',
        iterations: [{ applicable: false }, { applicable: false }, { applicable: false }],
        notRestoredReasons: [],
        restoredCount: 0,
        restoredRate: null,
        unavailableReason: null,
      },
      lighthouse: [],
      conditions: {
        desktop: {
          coldLoad: { iterations: [], summary: {} },
          navigation: {
            iterations: [
              { navDocumentReplaced: 0 },
              { navDocumentReplaced: 0 },
              { navDocumentReplaced: 0 },
            ],
            summary: { navToPaintMs: { mad: 1, median: 124 } },
          },
          ttiProbe: { iterations: [], summary: {} },
        },
        mobile: { coldLoad: {}, navigation: {}, ttiProbe: {} },
      },
    },
  ],
};

async function renderReport(results) {
  const dir = await mkdtemp(path.join(tmpdir(), 'kovo-bench-report-'));
  const resultsPath = path.join(dir, 'results.json');
  const reportPath = path.join(dir, 'report.md');
  await writeFile(resultsPath, JSON.stringify(results));
  await writeReport(resultsPath, reportPath);
  return readFile(reportPath, 'utf8');
}

describe('benchmark report', () => {
  it('records the posture every entrant was actually measured in', async () => {
    const report = await renderReport(RESULTS);
    expect(report).toContain('## Runtime posture');
    expect(report).toContain('| replacer | production | synthesized-per-run |');
    expect(report).toContain('| sameDoc | production | not-required |');
  });

  it('prints the machine and the load average the timings were taken under', async () => {
    const report = await renderReport(RESULTS);
    expect(report).toContain('darwin/arm64, 10 cores');
    expect(report).toContain('18.50 / 12.25 / 8.00');
  });

  it('shows how far the superseded load-window byte collection understates the truth', async () => {
    const report = await renderReport(RESULTS);
    // 434,847 settled vs 164,673 at load + 150 ms, and js 267,948 vs 0.
    expect(report).toContain('| replacer | 434847 | 164673 | 2.64x | 267948 | 0 |');
    // A capped settle window must be visible, not silently reported as a complete one.
    expect(report).toContain('**1/3**');
  });

  it('reports navigations that replaced the document and the superseded probe error', async () => {
    const report = await renderReport(RESULTS);
    expect(report).toContain('Superseded probe ms');
    // 1,153 ms to paint against the 69 ms the superseded probe reported.
    expect(report).toContain('16.7x low');
    expect(report).toContain('**3/3**');
    // A framework that never replaced the document must not be flagged.
    expect(report).toContain('| sameDoc | 124 (1) | n/a | n/a | n/a | 0/3 |');
  });

  it('flags Lighthouse cells with null samples and reports the spread', async () => {
    const report = await renderReport(RESULTS);
    expect(report).toContain('80 (±19)');
    expect(report).toContain('| **2** |');
  });

  it('does not score a same-document framework as failing the back/forward cache', async () => {
    const report = await renderReport(RESULTS);
    expect(report).toContain('| replacer | 3/3 | 3/3 |');
    expect(report).toContain('| sameDoc | n/a (same-document) | 0/3 |');
  });

  it('always states the instrument’s known limits', async () => {
    const report = await renderReport(RESULTS);
    expect(report).toContain('## Known limits of this instrument');
    expect(report).toContain('Mobile TTFB is not network-realistic');
    expect(report).toContain('cannot participate in the back/forward cache');
  });
});
