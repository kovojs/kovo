import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  aggregateDevGenerationCells,
  authenticateGenerationCandidateRoots,
  devGenerationSchedule,
  inspectGeneratedDevCorpus,
  pairedBootstrapImprovementCi,
  parseDevGenerationSpikeArgs,
  runDevGenerationSpike,
  summarizeDevMetric,
  validateDevGenerationCell,
} from './perf-dev-generation-spike.mjs';

const EDIT_CLASSES = ['leaf', 'entry', 'data', 'syntaxError', 'recovery'];
const temporaryRoots = [];
const digest = (seed) => `sha256:${seed.repeat(64).slice(0, 64)}`;

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('dev-generation candidate comparator', () => {
  it('uses B,S,S,B and splits full and smoke sample totals exactly', () => {
    expect(devGenerationSchedule({ editSamples: 30, readySamples: 15, warmups: 3 })).toEqual([
      {
        editSamples: 15,
        lane: 'baseline',
        occurrence: 0,
        readySamples: 8,
        scheduleIndex: 0,
        warmups: 2,
      },
      {
        editSamples: 15,
        lane: 'spike',
        occurrence: 0,
        readySamples: 8,
        scheduleIndex: 1,
        warmups: 2,
      },
      {
        editSamples: 15,
        lane: 'spike',
        occurrence: 1,
        readySamples: 7,
        scheduleIndex: 2,
        warmups: 1,
      },
      {
        editSamples: 15,
        lane: 'baseline',
        occurrence: 1,
        readySamples: 7,
        scheduleIndex: 3,
        warmups: 1,
      },
    ]);
    expect(devGenerationSchedule({ editSamples: 2, readySamples: 2, warmups: 0 })).toEqual([
      expect.objectContaining({ lane: 'baseline', occurrence: 0, editSamples: 1, readySamples: 1 }),
      expect.objectContaining({ lane: 'spike', occurrence: 0, editSamples: 1, readySamples: 1 }),
      expect.objectContaining({ lane: 'spike', occurrence: 1, editSamples: 1, readySamples: 1 }),
      expect.objectContaining({ lane: 'baseline', occurrence: 1, editSamples: 1, readySamples: 1 }),
    ]);
  });

  it('reports median/MAD/p95 and deterministic paired bootstrap evidence', () => {
    expect(summarizeDevMetric([1, 3, 9])).toEqual({ mad: 2, median: 3, p95: 9, samples: 3 });
    expect(
      pairedBootstrapImprovementCi([100, 100, 100], [75, 75, 75], { iterations: 500 }),
    ).toEqual([25, 25]);
    expect(() => pairedBootstrapImprovementCi([1], [1, 2])).toThrow(/identical sample counts/u);
  });

  it('authenticates an exact clean one-commit historical patch binding', () => {
    const fixture = candidateFixture();
    const binding = authenticateGenerationCandidateRoots(
      {
        baselineRoot: fixture.baseline,
        candidate: fixture.candidate,
        candidateRepository: fixture.repository,
        spikeRoot: fixture.spike,
      },
      fixture.dependencies,
    );

    expect(binding).toMatchObject({
      baseline: { commit: fixture.baselineCommit, root: realpathSync(fixture.baseline) },
      candidate: {
        patchId: fixture.candidate.patchId,
        patchSha256: fixture.candidate.patchSha256,
        paths: fixture.candidate.paths,
      },
      spike: { commit: fixture.spikeCommit, parent: fixture.baselineCommit },
    });
  });

  it('rejects patch drift and dirty candidate roots', () => {
    const drift = candidateFixture();
    expect(() =>
      authenticateGenerationCandidateRoots(
        {
          baselineRoot: drift.baseline,
          candidate: drift.candidate,
          candidateRepository: drift.repository,
          spikeRoot: drift.spike,
        },
        {
          ...drift.dependencies,
          patch: (_root, from) => Buffer.from(from === 'parent' ? 'patch' : 'drift'),
        },
      ),
    ).toThrow(/does not exactly match/u);

    const dirty = candidateFixture({
      spikeStatus: ' M packages/server/src/security-bootstrap.test.ts',
    });
    expect(() =>
      authenticateGenerationCandidateRoots(
        {
          baselineRoot: dirty.baseline,
          candidate: dirty.candidate,
          candidateRepository: dirty.repository,
          spikeRoot: dirty.spike,
        },
        dirty.dependencies,
      ),
    ).toThrow(/must be clean/u);
  });

  it('authenticates a generated N=24 corpus and enforces literal localhost', () => {
    const root = temporaryDirectory('kovo-dev-generation-corpus-');
    const workload = {
      buildOutputContract: 'required-nonempty-and-cleanup-absent/v1',
      componentImportFanout: 24,
      editClasses: EDIT_CLASSES,
      routes: 4,
      stateSurface: 'local-counter',
      workloadModules: 24,
    };
    const sourceFiles = [{ bytes: 1, file: 'src/app.tsx', sha256: digest('b') }];
    const sourceDigest = `sha256:${createHash('sha256')
      .update(JSON.stringify(sourceFiles))
      .digest('hex')}`;
    const manifest = {
      dev: {
        command: {
          argv: ['node_modules/.bin/kovo', 'dev', '--host', 'localhost', '--port', '{port}'],
        },
      },
      framework: 'kovo',
      modules: 24,
      routes: 4,
      schema: 'kovo-dev-corpus/v1',
      shapeDigest: createHash('sha256').update(JSON.stringify(workload)).digest('hex'),
      sourceDigest,
      sourceFiles,
      workload,
    };
    const manifestPath = path.join(root, 'manifest.json');
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);

    expect(inspectGeneratedDevCorpus(manifestPath, root)).toMatchObject({
      editClasses: EDIT_CLASSES,
      modules: 24,
      routes: 4,
      shapeDigest: `sha256:${manifest.shapeDigest}`,
      sourceDigest,
    });

    manifest.dev.command.argv = ['kovo', 'dev', '--host', '127.0.0.1', '--port', '{port}'];
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    expect(() => inspectGeneratedDevCorpus(manifestPath, root)).toThrow(/literal localhost/u);
  });

  it('validates browser-visible correctness, source identity, and RSS for each cell', () => {
    const state = sourceState('a'.repeat(40));
    const corpus = corpusIdentity();
    const cell = scheduledCell(
      'baseline',
      0,
      fakeAdapterReport({
        commit: state.commit,
        corpus,
        editSamples: 1,
        latency: 100,
        locks: state.locks,
        port: 49_750,
        readySamples: 1,
      }),
    );
    expect(
      validateDevGenerationCell(cell, { commit: state.commit, corpus, locks: state.locks }),
    ).toEqual([]);

    cell.report.samples[0].dataStateSurvived = false;
    cell.report.integrity.browser.requestFailedCount = 1;
    expect(
      validateDevGenerationCell(cell, { commit: state.commit, corpus, locks: state.locks }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/adapter correctness failure/u),
        expect.stringMatching(/lost state during data/u),
      ]),
    );
  });

  it('accepts only all-cell browser wins with positive CI and ignores bundle proxies', () => {
    const cells = comparisonCells();
    for (const cell of cells) cell.report.bundleBytes = cell.lane === 'spike' ? 1_000_000 : 1;
    const result = aggregateDevGenerationCells(cells, { bootstrapIterations: 500, seed: 1 });

    expect(result.correctness).toMatchObject({ complete: true, misses: 0, stateLost: 0 });
    expect(result.metrics.leafMs).toMatchObject({
      baseline: { mad: 0, median: 100, p95: 100, samples: 2 },
      pairedImprovement: { bootstrap95Ci: [25, 25], median: 25, samples: 2 },
      spike: { median: 75 },
      spikeMedianImprovementPercent: 25,
    });
    expect(result.acceptance).toMatchObject({
      candidateAccepted: true,
      excludedProxyEvidence: ['bundleBytes', 'emittedBytes', 'moduleCount'],
    });
    expect(Object.values(result.acceptance.metricAcceptance).every((metric) => metric.passed)).toBe(
      true,
    );

    cells[0].report.samples[0].syntaxErrorDiagnosticSignal = '';
    expect(
      aggregateDevGenerationCells(cells, { bootstrapIterations: 500, seed: 1 }).acceptance
        .candidateAccepted,
    ).toBe(false);
  });

  it('serializes the real-adapter seam as B,S,S,B and emits accepted smoke evidence', async () => {
    const baselineRoot = temporaryDirectory('kovo-dev-generation-baseline-');
    const spikeRoot = temporaryDirectory('kovo-dev-generation-spike-');
    const prepared = preparedFixture(baselineRoot, spikeRoot);
    const calls = [];
    let released = false;
    const report = await runDevGenerationSpike(
      {
        baselineRoot,
        bootstrapIterations: 500,
        measure: true,
        quickSmoke: true,
        spikeRoot,
      },
      {
        acquireLock: () => ({
          release: () => {
            released = true;
          },
        }),
        collectState: (root) =>
          prepared.source.before[root === baselineRoot ? 'baseline' : 'spike'],
        hostFingerprint: () => ({ schema: 'test-host/v1' }),
        prepare: async () => prepared,
        runAdapter: async (options) => {
          const lane = options.root === baselineRoot ? 'baseline' : 'spike';
          calls.push({ lane, port: options.port });
          const state = prepared.source.before[lane];
          return fakeAdapterReport({
            commit: state.commit,
            corpus: prepared.corpus[lane],
            editSamples: options.editSamples,
            latency: lane === 'baseline' ? 100 : 75,
            locks: state.locks,
            port: options.port,
            readyLatency: lane === 'baseline' ? 100 : 95,
            readySamples: options.readySamples,
            rss: 1_000,
            warmups: options.warmups,
          });
        },
        sampleHost: (label, ceiling) => ({
          at: '2026-08-13T00:00:00.000Z',
          ceiling,
          comparable: true,
          cpuCount: 10,
          label,
          loadAverage: [0.1, 0.1, 0.1],
          loadPerCpu: 0.01,
        }),
      },
    );

    expect(calls).toEqual([
      { lane: 'baseline', port: 49_750 },
      { lane: 'spike', port: 49_751 },
      { lane: 'spike', port: 49_752 },
      { lane: 'baseline', port: 49_753 },
    ]);
    expect(released).toBe(true);
    expect(report.integrity).toMatchObject({
      complete: true,
      errors: [],
      serialized: true,
      sourceStable: true,
    });
    expect(report.verdict).toMatchObject({ reasons: [], status: 'accept' });
  });

  it('supports authentication-only preparation and refuses implicit timing', async () => {
    const baselineRoot = temporaryDirectory('kovo-dev-generation-prepare-baseline-');
    const spikeRoot = temporaryDirectory('kovo-dev-generation-prepare-spike-');
    const prepared = preparedFixture(baselineRoot, spikeRoot);
    const runAdapter = vi.fn();
    const report = await runDevGenerationSpike(
      { baselineRoot, prepareOnly: true, quickSmoke: true, spikeRoot },
      {
        hostFingerprint: () => ({ schema: 'test-host/v1' }),
        prepare: async () => prepared,
        runAdapter,
      },
    );

    expect(runAdapter).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      integrity: { complete: true, matchedCorpus: true, sourceStable: true },
      mode: 'prepare-only',
      verdict: { status: 'prepared' },
    });
    expect(() =>
      parseDevGenerationSpikeArgs(['--baseline-root', baselineRoot, '--spike-root', spikeRoot]),
    ).toThrow(/explicitly authorize timing/u);
    expect(
      parseDevGenerationSpikeArgs([
        '--baseline-root',
        baselineRoot,
        '--spike-root',
        spikeRoot,
        '--size',
        '216',
        '--measure',
      ]),
    ).toMatchObject({ measure: true, size: 216 });
  });

  it('refuses a loaded host before taking the timing lock or launching an adapter', async () => {
    const baselineRoot = temporaryDirectory('kovo-dev-generation-load-baseline-');
    const spikeRoot = temporaryDirectory('kovo-dev-generation-load-spike-');
    const prepared = preparedFixture(baselineRoot, spikeRoot);
    const acquireLock = vi.fn();
    const runAdapter = vi.fn();

    await expect(
      runDevGenerationSpike(
        { baselineRoot, measure: true, quickSmoke: true, spikeRoot },
        {
          acquireLock,
          prepare: async () => prepared,
          runAdapter,
          sampleHost: (label, ceiling) => ({
            at: '2026-08-13T00:00:00.000Z',
            ceiling,
            comparable: false,
            cpuCount: 10,
            label,
            loadAverage: [20, 20, 20],
            loadPerCpu: 2,
          }),
        },
      ),
    ).rejects.toThrow(/no timing process was started/u);
    expect(acquireLock).not.toHaveBeenCalled();
    expect(runAdapter).not.toHaveBeenCalled();
  });
});

function candidateFixture({ spikeStatus = '' } = {}) {
  const root = temporaryDirectory('kovo-dev-generation-candidate-');
  const paths = {
    baseline: path.join(root, 'baseline'),
    repository: path.join(root, 'repository'),
    spike: path.join(root, 'spike'),
  };
  for (const directory of Object.values(paths)) mkdirSync(directory);
  const baseline = realpathSync(paths.baseline);
  const spike = realpathSync(paths.spike);
  const repository = realpathSync(paths.repository);
  const baselineCommit = 'a'.repeat(40);
  const spikeCommit = 'b'.repeat(40);
  const patch = Buffer.from('patch');
  const candidate = {
    commit: 'c'.repeat(40),
    parent: 'parent',
    patchId: 'd'.repeat(40),
    patchSha256: `sha256:${createHash('sha256').update(patch).digest('hex')}`,
    paths: ['one.ts', 'two.ts'],
  };
  const command = (directory, args) => `${directory}|${args.join(' ')}`;
  const answers = new Map([
    [command(baseline, ['rev-parse', '--show-toplevel']), baseline],
    [command(spike, ['rev-parse', '--show-toplevel']), spike],
    [command(baseline, ['rev-parse', 'HEAD']), baselineCommit],
    [command(spike, ['rev-parse', 'HEAD']), spikeCommit],
    [command(baseline, ['status', '--porcelain=v1', '--untracked-files=all']), ''],
    [command(spike, ['status', '--porcelain=v1', '--untracked-files=all']), spikeStatus],
    [command(spike, ['rev-parse', 'HEAD^']), baselineCommit],
    [command(spike, ['merge-base', baselineCommit, spikeCommit]), baselineCommit],
    [command(spike, ['rev-list', '--count', `${baselineCommit}..${spikeCommit}`]), '1'],
    [command(repository, ['rev-parse', `${candidate.commit}^{commit}`]), candidate.commit],
    [command(repository, ['rev-parse', `${candidate.commit}^`]), candidate.parent],
    [
      command(spike, ['diff', '--name-status', '--no-renames', baselineCommit, spikeCommit]),
      'M\tone.ts\nM\ttwo.ts',
    ],
  ]);
  const git = (directory, args) => {
    const key = command(directory, args);
    if (!answers.has(key)) throw new Error(`unexpected git request ${key}`);
    return answers.get(key);
  };
  return {
    baseline,
    baselineCommit,
    candidate,
    dependencies: {
      git,
      patch: () => patch,
      patchId: () => candidate.patchId,
    },
    repository,
    spike,
    spikeCommit,
  };
}

function preparedFixture(baselineRoot, spikeRoot) {
  const baseline = sourceState('a'.repeat(40));
  const spike = sourceState('b'.repeat(40));
  const corpus = corpusIdentity();
  return {
    candidateBinding: {
      baseline: { commit: baseline.commit, root: baselineRoot },
      candidate: { commit: 'c'.repeat(40), patchId: 'd'.repeat(40), patchSha256: digest('e') },
      spike: { commit: spike.commit, parent: baseline.commit, root: spikeRoot },
    },
    corpus: { baseline: corpus, spike: corpus },
    frozenInstall: {
      argv: ['pnpm', 'install'],
      packageManager: 'pnpm@10.12.1',
      pnpmVersion: '10.12.1',
    },
    manifestPaths: {
      baseline: path.join(baselineRoot, 'manifest.json'),
      spike: path.join(spikeRoot, 'manifest.json'),
    },
    roots: { baseline: baselineRoot, spike: spikeRoot },
    source: {
      after: { baseline, spike },
      before: { baseline, spike },
      stable: true,
    },
    tooling: {
      baseline: { corpusGeneratorSha256: digest('f'), devLoopAdapterSha256: digest('0') },
      spike: { corpusGeneratorSha256: digest('f'), devLoopAdapterSha256: digest('0') },
    },
  };
}

function comparisonCells() {
  const corpus = corpusIdentity();
  const states = { baseline: sourceState('a'.repeat(40)), spike: sourceState('b'.repeat(40)) };
  return ['baseline', 'spike', 'spike', 'baseline'].map((lane, scheduleIndex) => {
    const occurrence = scheduleIndex === 0 || scheduleIndex === 1 ? 0 : 1;
    const state = states[lane];
    return scheduledCell(
      lane,
      occurrence,
      fakeAdapterReport({
        commit: state.commit,
        corpus,
        editSamples: 1,
        latency: lane === 'baseline' ? 100 : 75,
        locks: state.locks,
        port: 49_750 + scheduleIndex,
        readyLatency: lane === 'baseline' ? 100 : 95,
        readySamples: 1,
        rss: 1_000,
      }),
      scheduleIndex,
    );
  });
}

function scheduledCell(lane, occurrence, report, scheduleIndex = 0) {
  return {
    editSamples: report.integrity.iterations,
    lane,
    occurrence,
    port: Number(new URL(report.integrity.command.origin).port),
    readySamples: report.integrity.readyIterations,
    report,
    scheduleIndex,
    warmups: report.integrity.warmups,
  };
}

function fakeAdapterReport({
  commit,
  corpus,
  editSamples,
  latency,
  locks,
  port,
  readyLatency = latency,
  readySamples,
  rss = 1_000,
  warmups = 0,
}) {
  const source = { commit, dirty: false, dirtyPaths: [], locks };
  const samples = Array.from({ length: editSamples }, (_, iteration) => ({
    ...Object.fromEntries(
      EDIT_CLASSES.flatMap((editClass) => [
        [`${editClass}Ms`, latency],
        [`${editClass}PaintFenceMs`, 1],
        [`${editClass}ServerGenerationMs`, latency / 2],
        [`${editClass}StateSurvived`, true],
        [`${editClass}WriteMs`, 1],
      ]),
    ),
    iteration,
    syntaxErrorDiagnosticSignal: 'framework-owned diagnostic',
  }));
  return {
    corpus: {
      manifestDigest: corpus.manifestDigest,
      modules: corpus.modules,
      routes: corpus.routes,
      shapeDigest: corpus.shapeDigest.slice('sha256:'.length),
      sourceDigest: corpus.sourceDigest,
    },
    editSession: { peakRssBytes: rss, rssSamples: 2 },
    framework: 'kovo',
    integrity: {
      browser: {
        requestFailedCount: 0,
        responseCount: 2,
        unexpectedErrorCount: 0,
      },
      command: {
        argv: ['kovo', 'dev', '--host', 'localhost', '--port', String(port)],
        origin: `http://localhost:${String(port)}`,
      },
      complete: true,
      editCounts: Object.fromEntries(EDIT_CLASSES.map((editClass) => [editClass, editSamples])),
      errors: [],
      iterations: editSamples,
      misses: 0,
      readyIterations: readySamples,
      source: { stable: true },
      warmups,
    },
    readySamples: Array.from({ length: readySamples }, (_, iteration) => ({
      durationMs: readyLatency,
      iteration,
      peakRssBytes: rss,
      rssSamples: 2,
      success: true,
    })),
    samples,
    schema: 'kovo-dev-loop-report/v1',
    source,
    sourceAfter: source,
    verdict: { status: 'measured' },
  };
}

function sourceState(commit) {
  return {
    commit,
    dirty: false,
    dirtyPaths: [],
    locks: {
      'benchmarks/harness/pnpm-lock.yaml': digest('3'),
      'benchmarks/nextjs/pnpm-lock.yaml': digest('2'),
      'pnpm-lock.yaml': digest('1'),
    },
    packageManager: 'pnpm@10.12.1',
    pnpmVersion: '10.12.1',
  };
}

function corpusIdentity() {
  return {
    editClasses: EDIT_CLASSES,
    manifestDigest: digest('4'),
    manifestPath: 'benchmarks/kovo/.corpora/kovo/n24/manifest.json',
    modules: 24,
    routes: 4,
    schema: 'kovo-dev-corpus/v1',
    shapeDigest: digest('5'),
    sourceDigest: digest('6'),
    stateSurface: 'local-counter',
  };
}

function temporaryDirectory(prefix) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}
