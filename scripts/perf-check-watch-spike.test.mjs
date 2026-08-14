import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  CHECK_WATCH_SPIKE_ORDER,
  checkWatchSpikeSchedule,
  linkDeclaredExternalDependenciesForTesting,
  packageDestination,
  pairedCheckWatchAnalysis,
  runCheckWatchSpikeComparison,
} from './perf-check-watch-spike.mjs';

const digest = (seed) => `sha256:${seed.repeat(64).slice(0, 64)}`;

describe('packed check-watch spike comparator', () => {
  it('stages both scoped and unscoped authenticated product packages without path ambiguity', () => {
    expect(packageDestination('/stage/node_modules', '@kovojs/cli')).toBe(
      '/stage/node_modules/@kovojs/cli',
    );
    expect(packageDestination('/stage/node_modules', 'create-kovo')).toBe(
      '/stage/node_modules/create-kovo',
    );
    for (const unsafe of ['../create-kovo', '@kovojs/../cli', '@kovojs/cli/extra', 'Create-Kovo']) {
      expect(() => packageDestination('/stage/node_modules', unsafe)).toThrow(
        /unsupported packed package name/u,
      );
    }
  });

  it('links a packed package external dependency from the one frozen comparator install', () => {
    const stage = mkdtempSync(path.join(os.tmpdir(), 'kovo-check-watch-dependency-test-'));
    try {
      const nodeModules = path.join(stage, 'node_modules');
      mkdirSync(nodeModules, { recursive: true });
      linkDeclaredExternalDependenciesForTesting(
        process.cwd(),
        nodeModules,
        new Set(['@kovojs/style']),
        [
          {
            manifest: {
              dependencies: { '@material/material-color-utilities': '0.3.0' },
            },
            name: '@kovojs/style',
          },
        ],
      );
      expect(realpathSync(path.join(nodeModules, '@material/material-color-utilities'))).toBe(
        realpathSync('packages/style/node_modules/@material/material-color-utilities'),
      );
    } finally {
      rmSync(stage, { force: true, recursive: true });
    }
  });

  it('uses the required serialized baseline, spike, spike, baseline schedule', () => {
    expect(checkWatchSpikeSchedule(5)).toEqual([
      { arm: 'baseline', occurrence: 0, samples: 3 },
      { arm: 'spike', occurrence: 0, samples: 3 },
      { arm: 'spike', occurrence: 1, samples: 2 },
      { arm: 'baseline', occurrence: 1, samples: 2 },
    ]);
    expect(CHECK_WATCH_SPIKE_ORDER).toEqual(['baseline', 'spike', 'spike', 'baseline']);
  });

  it('reports paired CI, median/MAD/p95, RSS, misses, and an accepted improvement', () => {
    const order = [];
    const disposals = [];
    const report = runCheckWatchSpikeComparison({
      baselineRepositoryRoot: '/baseline',
      baselineScenario: '/baseline/scenario.json',
      bootstrapIterations: 1_000,
      maxLoadPerCpu: 0.5,
      prepareArm(arm) {
        return {
          dispose: () => disposals.push(arm),
          identity: { arm, commit: arm === 'baseline' ? 'a'.repeat(40) : 'b'.repeat(40) },
          lockDigest: digest('1'),
          root: `/${arm}`,
          workloadDigest: digest('2'),
        };
      },
      runSession(arm, { requestedEdits }) {
        order.push(arm.identity.arm);
        return incrementalSession(
          requestedEdits,
          arm.identity.arm === 'baseline' ? 100 : 75,
          arm.identity.arm === 'baseline' ? 1_024 : 900,
        );
      },
      sampleHost: () => ({
        at: '2026-08-13T00:00:00.000Z',
        loadAverage: [0.1, 0.1, 0.1],
        loadPerCpu: 0.01,
        logicalCpuCount: 10,
      }),
      samples: 4,
      spikeRepositoryRoot: '/spike',
      spikeScenario: '/spike/scenario.json',
      warmups: 1,
    });

    expect(order).toEqual(CHECK_WATCH_SPIKE_ORDER);
    expect(disposals).toEqual(['spike', 'baseline']);
    expect(report.integrity).toMatchObject({
      complete: true,
      errors: [],
      misses: { baseline: 0, spike: 0 },
      serialized: true,
      zeroCounts: { baseline: 0, spike: 0 },
    });
    expect(report.policy).toMatchObject({ samplesPerArm: 4, warmupsPerOccurrence: 1 });
    expect(report.analysis.baseline.durationMs).toMatchObject({
      mad: 0,
      median: 100,
      p95: 100,
      samples: 4,
    });
    expect(report.analysis.spike.durationMs).toMatchObject({ median: 75, p95: 75 });
    expect(report.analysis.baseline.peakRssBytes.median).toBe(1_024);
    expect(report.analysis.spike.peakRssBytes.median).toBe(900);
    expect(report.analysis.summaryMedianImprovementPercent).toBe(25);
    expect(report.analysis.paired.durationImprovementPercent.bootstrap95Ci).toEqual([25, 25]);
    expect(report.verdict).toMatchObject({ accepted: true, reasons: [], status: 'accepted' });
  });

  it('refuses timing above the host-load ceiling and preserves misses/errors', () => {
    const runSession = vi.fn();
    const report = runCheckWatchSpikeComparison({
      baselineRepositoryRoot: '/baseline',
      baselineScenario: '/baseline/scenario.json',
      maxLoadPerCpu: 0.5,
      prepareArm: (arm) => ({
        dispose() {},
        identity: { arm },
        lockDigest: digest('1'),
        root: `/${arm}`,
        workloadDigest: digest('2'),
      }),
      runSession,
      sampleHost: () => ({
        at: '2026-08-13T00:00:00.000Z',
        loadAverage: [12, 10, 8],
        loadPerCpu: 1.2,
        logicalCpuCount: 10,
      }),
      samples: 4,
      spikeRepositoryRoot: '/spike',
      spikeScenario: '/spike/scenario.json',
      warmups: 1,
    });

    expect(runSession).not.toHaveBeenCalled();
    expect(report.integrity.errors).toEqual([
      'host load 1.2 per CPU exceeded ceiling 0.5 before baseline/0',
    ]);
    expect(report.integrity.misses).toEqual({ baseline: 4, spike: 4 });
    expect(report.verdict).toMatchObject({ accepted: false, status: 'unmeasured' });
  });

  it('rejects unpaired or zero baseline timing instead of manufacturing a win', () => {
    expect(() => pairedCheckWatchAnalysis([{ durationMs: 1, peakRssBytes: 1 }], [])).toThrow(
      /equal non-empty arms/u,
    );
    expect(() =>
      pairedCheckWatchAnalysis(
        [{ durationMs: 0, peakRssBytes: 1 }],
        [{ durationMs: 0, peakRssBytes: 1 }],
      ),
    ).toThrow(/baseline duration must be nonzero/u);
  });
});

function incrementalSession(samples, durationMs, peakRssBytes) {
  const observations = Array.from({ length: samples + 1 }, (_, revision) => {
    const sourceRevision = revision % 2;
    return {
      analysisDigest: digest(String(sourceRevision)),
      checkGraphDigest: digest(sourceRevision === 0 ? 'a' : 'b'),
      closureDigest: digest(sourceRevision === 0 ? 'c' : 'd'),
      diagnosticPhases: diagnosticPhases(sourceRevision),
      durationMs,
      peakRssBytes,
      processTreeSamples: 2,
      projectDigest: digest(sourceRevision === 0 ? 'e' : 'f'),
      revision,
      sourceRevision,
    };
  });
  return {
    observations,
    pid: 4242,
    samples,
    schema: 'kovo-incremental-check-session/v1',
    sessionDigest: `sha256:${createHash('sha256')
      .update(JSON.stringify(observations))
      .digest('hex')}`,
  };
}

function diagnosticPhases(sourceRevision) {
  const invariant = new Set([
    'lifecycle-policy',
    'config-trust',
    'project-quality',
    'sound-subset',
  ]);
  return [
    ['lifecycle-policy', 'not-applicable'],
    ['config-trust', 'executed'],
    ['typescript', 'executed'],
    ['project-quality', 'not-applicable'],
    ['sound-subset', 'not-applicable'],
    ['session-authority', 'executed'],
    ['app-source-trust', 'executed'],
    ['stylesheet', 'executed'],
    ['app-evaluation', 'executed'],
    ['build-check-graph', 'executed'],
    ['graph-diagnostics', 'executed'],
  ].map(([name, status]) => ({
    durationMs: status === 'not-applicable' ? 0 : 1,
    inputDigest: digest(invariant.has(name) ? '7' : String(sourceRevision)),
    name,
    status,
  }));
}
