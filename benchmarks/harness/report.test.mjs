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
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { writeReport } from './report.mjs';

/** A probe whose HTTP statuses were readable and clean. */
const TRACKED_CLEAN = { errorResponses: 0, rateLimitedResponses: 0, requests: 12, tracked: true };

const ATTRIBUTION = {
  primaryResponse: { selection: 'kovo-document-parts-media-type', status: 'observed' },
  phases: {
    server: { durationMs: 12, source: 'request timing', status: 'observed' },
    transfer: { durationMs: 3, source: 'request timing', status: 'observed' },
    responseProcessingDomApply: {
      durationMs: 81,
      source: 'trace envelope',
      status: 'observed',
    },
    responseReadDecode: {
      durationMs: null,
      reason: 'browser exposes no stable response decode boundary',
      status: 'unsupported',
    },
    documentConstruction: {
      durationMs: 8,
      source: 'trace',
      status: 'observed',
    },
    domMorphApply: {
      durationMs: null,
      reason: 'browser exposes no stable morph boundary',
      status: 'unsupported',
    },
    style: { durationMs: 2, source: 'trace', status: 'observed' },
    layout: { durationMs: 4, source: 'trace', status: 'observed' },
    paint: { durationMs: 1, source: 'trace', status: 'observed' },
  },
};

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
  source: {
    commit: '0123456789abcdef0123456789abcdef01234567',
    dirty: false,
    dirtyPaths: [],
    locks: {
      'benchmarks/harness/pnpm-lock.yaml': 'sha256:harness',
      'benchmarks/nextjs/pnpm-lock.yaml': 'sha256:next',
      'pnpm-lock.yaml': 'sha256:root',
    },
  },
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
        iterations: [
          { applicable: true, network: TRACKED_CLEAN },
          { applicable: true, network: TRACKED_CLEAN },
          { applicable: true, network: TRACKED_CLEAN },
        ],
        notRestoredReasons: [],
        restoredCount: 3,
        restoredRate: 1,
        unavailableReason: null,
      },
      lighthouse: [
        {
          formFactor: 'desktop',
          metrics: { bytes: 400_000, fcpMs: 1500, lcpMs: 1600, performanceScore: 0.8, tbtMs: 0 },
          network: { ...TRACKED_CLEAN, untrackedSamples: 0 },
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
              { navAttribution: ATTRIBUTION, navDocumentReplaced: 1 },
              { navAttribution: ATTRIBUTION, navDocumentReplaced: 1 },
              { navAttribution: ATTRIBUTION, navDocumentReplaced: 1 },
            ],
            summary: {
              'navAttribution.phases.documentConstruction.durationMs': { mad: 0, median: 8 },
              'navAttribution.phases.layout.durationMs': { mad: 0, median: 4 },
              'navAttribution.phases.paint.durationMs': { mad: 0, median: 1 },
              'navAttribution.phases.responseProcessingDomApply.durationMs': {
                mad: 2,
                median: 81,
              },
              'navAttribution.phases.server.durationMs': { mad: 1, median: 12 },
              'navAttribution.phases.style.durationMs': { mad: 0, median: 2 },
              'navAttribution.phases.transfer.durationMs': { mad: 0, median: 3 },
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
        iterations: [
          { applicable: false, network: TRACKED_CLEAN },
          { applicable: false, network: TRACKED_CLEAN },
          { applicable: false, network: TRACKED_CLEAN },
        ],
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

// One temp dir for the file, removed afterwards. Creating (and leaking) a fresh mkdtemp per test
// left one directory per assertion behind on every run.
let workDir;
let renderCount = 0;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'kovo-bench-report-'));
});

afterAll(async () => {
  if (workDir) await rm(workDir, { force: true, recursive: true });
});

async function renderReport(results) {
  renderCount += 1;
  const resultsPath = path.join(workDir, `results-${renderCount}.json`);
  const reportPath = path.join(workDir, `report-${renderCount}.md`);
  await writeFile(resultsPath, JSON.stringify(results));
  await writeReport(resultsPath, reportPath);
  return readFile(reportPath, 'utf8');
}

/** The "Known limits of this instrument" section only, so a limit cannot be pinned from elsewhere. */
function knownLimits(report) {
  const start = report.indexOf('## Known limits of this instrument');
  expect(start).toBeGreaterThan(-1);
  return report.slice(start);
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

  it('binds the report to source, dirty state, and dependency locks', async () => {
    const report = await renderReport(RESULTS);
    expect(report).toContain('Source 0123456789abcdef0123456789abcdef01234567 (clean)');
    expect(report).toContain('pnpm-lock.yaml=sha256:root');
    expect(report).toContain('benchmarks/nextjs/pnpm-lock.yaml=sha256:next');
    expect(report).toContain('benchmarks/harness/pnpm-lock.yaml=sha256:harness');
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

  it('separates directly observed navigation phases from unsupported boundaries', async () => {
    const report = await renderReport(RESULTS);
    expect(report).toContain('## Navigation attribution');
    expect(report).toContain(
      '| replacer | kovo-document-parts-media-type | 12 (1) | 3 (0) | 81 (2) | unsupported | 8 (0) | unsupported | 2 (0) | 4 (0) | 1 (0) |',
    );
    expect(report).toContain(
      '- replacer/desktop/responseReadDecode: browser exposes no stable response decode boundary',
    );
    expect(report).toContain(
      '- replacer/desktop/domMorphApply: browser exposes no stable morph boundary',
    );
  });

  it('flags Lighthouse cells with null samples and reports the spread', async () => {
    const report = await renderReport(RESULTS);
    expect(report).toContain('80 (±19)');
    expect(report).toContain('| **2** |');
  });

  // "No errors reported" and "errors could not be reported" are different claims. The integrity
  // gate only rejects statuses it can observe, so a probe it could not observe has to say so in
  // the report — not only on stderr, which nobody keeps next to the number they quote.
  it('names probes whose HTTP statuses could not be observed', async () => {
    const clean = await renderReport(RESULTS);
    expect(clean).toContain('HTTP statuses were observed for every probe in this run');

    const untracked = structuredClone(RESULTS);
    untracked.apps[0].lighthouse[0].network = {
      errorResponses: 0,
      rateLimitedResponses: 0,
      requests: 0,
      tracked: false,
      untrackedSamples: 2,
    };
    untracked.apps[1].bfcache.iterations = [{ applicable: false }, { applicable: false }];
    const report = await renderReport(untracked);
    expect(report).toContain(
      '**HTTP statuses could not be observed for some probes in this run.**',
    );
    expect(report).toContain('- replacer lighthouse desktop/ (2/3 samples)');
    expect(report).toContain('- sameDoc bfcache probe (2/2 iterations)');
  });

  // `GET /favicon.ico` 404s are exempt from the >=400 gate — the browser asks on its own and only
  // Lighthouse's browser build does, so counting them would reject every run on a difference
  // between browser builds. Exempt is not the same as hidden: the report has to say it happened.
  it('reports favicon 404s that the >=400 gate exempts', async () => {
    expect(await renderReport(RESULTS)).not.toContain('favicon.ico');

    const withFavicon = structuredClone(RESULTS);
    withFavicon.apps[0].lighthouse[0].network.faviconMisses = 3;
    const report = await renderReport(withFavicon);
    expect(report).toContain('3 `GET /favicon.ico` 404s across the Lighthouse cells');
    expect(report).toContain('exempt from the >=400 gate');
  });

  it('does not score a same-document framework as failing the back/forward cache', async () => {
    const report = await renderReport(RESULTS);
    expect(report).toContain('| replacer | 3/3 | 3/3 |');
    expect(report).toContain('| sameDoc | n/a (same-document) | 0/3 |');
  });

  it('always states the instrument’s known limits', async () => {
    const limits = knownLimits(await renderReport(RESULTS));
    expect(limits).toContain('Mobile TTFB is not network-realistic');
    expect(limits).toContain('cannot participate in the back/forward cache');
    // The harness, the browser and the server are three processes on ONE machine, not one process.
    expect(limits).toContain('three separate processes on the same machine');
  });

  it('states the shared trace boundary and its remaining common observation delay', async () => {
    const limits = knownLimits(await renderReport(RESULTS));
    expect(limits).toContain('destination-paint mark observes DOM readiness');
    expect(limits).toContain('first later frame');
    expect(limits).toContain('old asymmetric FCP-versus-two-rAF branch has been removed');
    expect(limits).toContain('not an additive synthetic waterfall');
    expect(limits).toContain('remain `unsupported`');
    expect(limits).not.toContain('errs in Kovo');
  });
});
