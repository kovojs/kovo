import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { inspectDevPortAllocation } from '../benchmarks/harness/dev-port-allocation.mjs';
import {
  createDevReadyProfiler,
  DEV_READY_PROFILE_SCHEDULE,
  DEV_READY_PROFILE_SCHEMA,
  DEV_READY_PROFILE_WINDOW_SCHEMA,
  devReadyProfileSchedule,
  exactReadyCallEvidence,
  parseDevReadyProfileArgs,
  runDevReadyProfile,
  runReadyProfileCell,
  validateReadyCpuProfile,
  validateReadyPreciseCoverage,
} from './perf-dev-ready-profile.mjs';
import {
  DEV_CRITICAL_PATH_CANDIDATE,
  DEV_GENERATION_CANDIDATE_BINDING_SCHEMA,
} from './perf-dev-generation-spike.mjs';

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('authenticated cold-first-ready diagnostic', () => {
  it('fixes one N=216 first-ready window in exact B,S,S,B order', () => {
    expect(DEV_READY_PROFILE_SCHEMA).toBe('kovo-dev-ready-profile/v1');
    expect(DEV_READY_PROFILE_SCHEDULE).toEqual([
      { lane: 'baseline', occurrence: 0, scheduleIndex: 0 },
      { lane: 'spike', occurrence: 0, scheduleIndex: 1 },
      { lane: 'spike', occurrence: 1, scheduleIndex: 2 },
      { lane: 'baseline', occurrence: 1, scheduleIndex: 3 },
    ]);
    expect(devReadyProfileSchedule(20_000)).toEqual([
      expect.objectContaining({ lane: 'baseline', port: 20_000, inspectorPort: 20_001 }),
      expect.objectContaining({ lane: 'spike', port: 20_128, inspectorPort: 20_129 }),
      expect.objectContaining({ lane: 'spike', port: 20_256, inspectorPort: 20_257 }),
      expect.objectContaining({ lane: 'baseline', port: 20_384, inspectorPort: 20_385 }),
    ]);
    expect(() => devReadyProfileSchedule(65_400)).toThrow(/profile cell 2 port/u);
    expect(
      parseDevReadyProfileArgs([
        '--diagnose',
        '--baseline-root',
        '/tmp/baseline',
        '--spike-root',
        '/tmp/spike',
        '--out',
        '/tmp/report.json',
      ]),
    ).toMatchObject({ diagnose: true, out: '/tmp/report.json' });
  });

  it('authenticates the paused process identity and rejects a wrong PID/target', async () => {
    const root = await temporaryRoot();
    const product = await syntheticPackedScript(root);
    const profileDir = path.join(root, 'profiles');
    await mkdir(profileDir);
    const marker = 'KOVO_PERF_DEV_SESSION_READY_WRONG';
    const closed = vi.fn();
    await expect(
      createDevReadyProfiler(profilerOptions({ marker, product, profileDir }), {
        connectInspector: async () => ({
          close: closed,
          identity: inspectorIdentity(8_888, marker, 'wrong-target'),
          send: vi.fn(),
        }),
      }),
    ).rejects.toThrow(/does not belong to the spawned process/u);
    expect(closed).toHaveBeenCalledOnce();
    await expect(readFile(path.join(profileDir, '.cell-000-baseline.lock'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('requires the exact --inspect-brk invocation before starting either sampler', async () => {
    const root = await temporaryRoot();
    const product = await syntheticPackedScript(root);
    const profileDir = path.join(root, 'profiles');
    await mkdir(profileDir);
    const marker = 'KOVO_PERF_DEV_SESSION_READY_UNPAUSED';
    const commands = [];
    const session = inspectorSession({
      commands,
      execArgv: ['--inspect=127.0.0.1:21216'],
      marker,
      product,
    });
    await expect(
      createDevReadyProfiler(profilerOptions({ marker, product, profileDir }), {
        connectInspector: async () => session,
      }),
    ).rejects.toThrow(/not the exact paused packed CLI invocation/u);
    expect(commands).toEqual(['Runtime.evaluate', 'close']);
  });

  it('writes exclusive raw CPU/coverage artifacts with exact packed ranges and source-map digests', async () => {
    const root = await temporaryRoot();
    const product = await syntheticPackedScript(root);
    const profileDir = path.join(root, 'profiles');
    await mkdir(profileDir);
    const marker = 'KOVO_PERF_DEV_SESSION_READY_PROFILE';
    const commands = [];
    const session = inspectorSession({ commands, marker, product });
    const profiler = await createDevReadyProfiler(
      profilerOptions({ marker, product, profileDir }),
      { connectInspector: async () => session },
    );

    await profiler.startAndResume();
    const evidence = await profiler.captureAtReady();
    await profiler.abort();

    expect(commands).toEqual([
      'Runtime.evaluate',
      'Profiler.enable',
      'Profiler.setSamplingInterval',
      'Profiler.startPreciseCoverage',
      'Profiler.start',
      'Runtime.runIfWaitingForDebugger',
      'Profiler.stop',
      'Profiler.takePreciseCoverage',
      'Profiler.stopPreciseCoverage',
      'close',
    ]);
    expect(evidence).toMatchObject({
      artifact: {
        coverage: { file: 'cell-000-baseline.coverage.json' },
        cpu: { file: 'cell-000-baseline.cpuprofile' },
      },
      diagnosticOnly: {
        acceptanceEligible: false,
        cpuSamplingIntervalMicros: 500,
        profilerPerturbsWallAndRss: true,
      },
      product: {
        digest: digest('a'),
        scriptAssets: [
          {
            file: 'node_modules/@kovojs/compiler/dist/vite-config.mjs',
            sha256: sha256(Buffer.from(product.source)),
            sourceMap: { sha256: sha256(Buffer.from(product.sourceMap)) },
          },
        ],
      },
      schema: DEV_READY_PROFILE_WINDOW_SCHEMA,
    });
    expect(
      evidence.calls.find((entry) => entry.name === 'resolveComponentQueryRuntimeNames'),
    ).toMatchObject({ callCount: 3, present: true });
    expect(
      evidence.calls.find((entry) => entry.name === 'resolveFreshDirectQueryRuntimeNames'),
    ).toMatchObject({ callCount: 3, present: true, required: false });
    expect(
      JSON.parse(await readFile(path.join(profileDir, evidence.artifact.cpu.file), 'utf8')),
    ).toEqual(syntheticCpuProfile());
    expect(
      JSON.parse(await readFile(path.join(profileDir, evidence.artifact.coverage.file), 'utf8')),
    ).toEqual(product.coverage);
  });

  it('fails closed on incomplete CPU profiles and precise coverage', async () => {
    expect(() => validateReadyCpuProfile({ nodes: [], samples: [], timeDeltas: [] })).toThrow(
      /CPU profile is incomplete/u,
    );
    expect(() =>
      validateReadyCpuProfile({
        ...syntheticCpuProfile(),
        samples: [99],
      }),
    ).toThrow(/do not match/u);
    expect(() => validateReadyPreciseCoverage({ result: [], timestamp: 1 })).toThrow(
      /coverage is incomplete/u,
    );
    const root = await temporaryRoot();
    expect(() =>
      exactReadyCallEvidence(
        { result: [coverageScript('1', 'file:///missing.mjs', [])], timestamp: 1 },
        {
          consumerRoot: root,
        },
      ),
    ).toThrow(/omitted required production function/u);
  });

  it('refuses artifact clobbering before connecting to a process', async () => {
    const root = await temporaryRoot();
    const product = await syntheticPackedScript(root);
    const profileDir = path.join(root, 'profiles');
    await mkdir(profileDir);
    await writeFile(path.join(profileDir, 'cell-000-baseline.cpuprofile'), '{}\n');
    const connectInspector = vi.fn();

    await expect(
      createDevReadyProfiler(
        profilerOptions({
          marker: 'KOVO_PERF_DEV_SESSION_READY_CLOBBER',
          product,
          profileDir,
        }),
        { connectInspector },
      ),
    ).rejects.toThrow(/artifact already exists/u);
    expect(connectInspector).not.toHaveBeenCalled();
  });

  it('runs the exact packed cell paused and authenticates product/corpus on both sides', async () => {
    const root = await temporaryRoot();
    const expectedCorpus = { modules: 216, schema: 'test-corpus/v1' };
    const stop = vi.fn(async () => ({ complete: true }));
    const startAndResume = vi.fn();
    const abort = vi.fn();
    const profiler = { abort, captureAtReady: vi.fn(), startAndResume };
    const launch = vi.fn(async (options) => ({
      handoff: { complete: true, target: options.targetSession },
      session: {
        pid: 9_201,
        processMarker: 'KOVO_PERF_DEV_SESSION_CELL',
        stop,
      },
      started: 10,
    }));
    const verifyProduct = vi.fn(() => ({
      cliEntry: '/consumer/bin.mjs',
      consumerRoot: root,
      identity: { digest: digest('a') },
    }));
    const measure = vi.fn(async (_options, dependencies) => {
      expect(dependencies.readyDiagnostic).toBe(profiler);
      return completeProfiledObservation();
    });

    const cell = await runReadyProfileCell(
      {
        browser: {},
        expectedCorpus,
        inspectorPort: 21_216,
        lane: 'baseline',
        manifestPath: path.join(root, 'manifest.json'),
        occurrence: 0,
        port: 20_000,
        priorProcessMarker: null,
        priorSession: null,
        product: {
          descriptorPath: path.join(root, 'descriptor.json'),
          externalRoot: root,
          identity: { digest: digest('a') },
        },
        profileDir: path.join(root, 'profiles'),
        readyTimeoutMs: 600_000,
        scheduleIndex: 0,
        sourceState: sourceState(DEV_CRITICAL_PATH_CANDIDATE.parent),
      },
      cellDependencies({
        expectedCorpus,
        launch,
        measure,
        profiler,
        root,
        verifyProduct,
      }),
    );

    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        inspectorPauseOnStart: true,
        inspectorPort: 21_216,
        targetSession: 'ready-profile[0]',
      }),
    );
    expect(startAndResume).toHaveBeenCalledOnce();
    expect(verifyProduct).toHaveBeenCalledTimes(2);
    expect(cell).toMatchObject({
      authentication: {
        corpus: { afterVerified: true, beforeVerified: true },
        product: { afterVerified: true, beforeVerified: true },
      },
      profile: { schema: DEV_READY_PROFILE_WINDOW_SCHEMA },
    });
  });

  it('terminates a paused packed session when Inspector attachment fails', async () => {
    const root = await temporaryRoot();
    const stop = vi.fn(async () => ({ complete: true }));
    const launch = vi.fn(async () => ({
      handoff: { complete: true },
      session: {
        pid: 9_201,
        processMarker: 'KOVO_PERF_DEV_SESSION_CELL',
        stop,
      },
      started: 10,
    }));
    await expect(
      runReadyProfileCell(
        {
          browser: {},
          expectedCorpus: { modules: 216, schema: 'test-corpus/v1' },
          inspectorPort: 21_216,
          lane: 'baseline',
          manifestPath: path.join(root, 'manifest.json'),
          occurrence: 0,
          port: 20_000,
          priorProcessMarker: null,
          priorSession: null,
          product: {
            descriptorPath: path.join(root, 'descriptor.json'),
            externalRoot: root,
            identity: { digest: digest('a') },
          },
          profileDir: path.join(root, 'profiles'),
          readyTimeoutMs: 600_000,
          scheduleIndex: 0,
          sourceState: sourceState(DEV_CRITICAL_PATH_CANDIDATE.parent),
        },
        cellDependencies({
          createProfiler: async () => {
            throw new Error('wrong Inspector target');
          },
          expectedCorpus: { modules: 216, schema: 'test-corpus/v1' },
          launch,
          root,
          verifyProduct: () => ({ consumerRoot: root }),
        }),
      ),
    ).rejects.toThrow(/wrong Inspector target/u);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('rejects an ephemeral Inspector collision before preparation or process launch', async () => {
    const root = await temporaryRoot();
    const prepare = vi.fn();
    await expect(
      runDevReadyProfile(runnerOptions(root), {
        collectControllerState: () => controllerState(),
        inspectPortAllocation: (options) =>
          inspectDevPortAllocation(options, {
            inspectHostRanges: async () => linuxEphemeralEvidence('20001 20001\n'),
          }),
        prepare,
      }),
    ).rejects.toThrow(/port allocation refused/u);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('rejects a dirty or unauthenticated diagnostic controller before preparation', async () => {
    const root = await temporaryRoot();
    const prepare = vi.fn();
    await expect(
      runDevReadyProfile(runnerOptions(root), {
        collectControllerState: () => ({ ...controllerState(), dirty: true, dirtyPaths: [' M x'] }),
        prepare,
      }),
    ).rejects.toThrow(/controller is dirty or unauthenticated before preparation/u);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('publishes only diagnostic status after four authenticated serialized cells', async () => {
    const root = await temporaryRoot();
    const prepared = preparedFixture(root);
    const release = vi.fn();
    const closeBrowser = vi.fn();
    const calls = [];
    const report = await runDevReadyProfile(runnerOptions(root), {
      acquireLock: () => ({ release }),
      collectControllerState: () => controllerState(),
      collectState: (sourceRoot) =>
        prepared.source.before[sourceRoot === prepared.roots.baseline ? 'baseline' : 'spike'],
      createHostAdmission: () => quietHostAdmission(),
      hostFingerprint: () => ({ schema: 'test-host/v1' }),
      inspectPortAllocation: completePortAllocation,
      launchBrowser: async () => ({ close: closeBrowser }),
      prepare: async () => prepared,
      runCell: async (options) => {
        calls.push({
          lane: options.lane,
          occurrence: options.occurrence,
          priorProcessMarker: options.priorProcessMarker,
          priorSession: options.priorSession,
          scheduleIndex: options.scheduleIndex,
        });
        return successfulCell(options);
      },
    });

    expect(calls.map(({ lane }) => lane)).toEqual(['baseline', 'spike', 'spike', 'baseline']);
    expect(calls[0]).toMatchObject({ priorProcessMarker: null, priorSession: null });
    expect(calls[1]).toMatchObject({
      priorProcessMarker: 'KOVO_PERF_DEV_SESSION_CELL_0',
      priorSession: 'ready-profile[0]',
    });
    expect(report).toMatchObject({
      integrity: {
        complete: true,
        controllerStable: true,
        exactSchedule: true,
        productAndCorpusVerifiedBeforeAndAfter: true,
        serialized: true,
        sourceStable: true,
      },
      policy: {
        acceptanceEligible: false,
        excludedFromAcceptance: ['durationMs', 'paintFenceMs', 'peakRssBytes', 'rssSamples'],
        profilerPerturbsWallAndRss: true,
        readyWindowsPerCell: 1,
      },
      schema: DEV_READY_PROFILE_SCHEMA,
      verdict: { reasons: [], status: 'diagnostic-only' },
    });
    expect(report.controller).toMatchObject({
      after: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) },
      before: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) },
      stable: true,
    });
    expect(report).not.toHaveProperty('analysis.acceptance');
    expect(release).toHaveBeenCalledOnce();
    expect(closeBrowser).toHaveBeenCalledOnce();
    expect(prepared.cleanup).toHaveBeenCalledOnce();
  });

  it('marks a schedule-confused or incomplete cell unproven and stops serialization', async () => {
    const root = await temporaryRoot();
    const prepared = preparedFixture(root);
    const report = await runDevReadyProfile(runnerOptions(root), {
      acquireLock: () => ({ release() {} }),
      collectControllerState: () => controllerState(),
      collectState: (sourceRoot) =>
        prepared.source.before[sourceRoot === prepared.roots.baseline ? 'baseline' : 'spike'],
      createHostAdmission: () => quietHostAdmission(),
      hostFingerprint: () => ({ schema: 'test-host/v1' }),
      inspectPortAllocation: completePortAllocation,
      launchBrowser: async () => ({ close() {} }),
      prepare: async () => prepared,
      runCell: async (options) => ({ ...successfulCell(options), lane: 'spike' }),
    });

    expect(report.cells).toEqual([]);
    expect(report.integrity.complete).toBe(false);
    expect(report.verdict).toMatchObject({
      reasons: [expect.stringMatching(/schedule-confused/u)],
      status: 'unproven',
    });
    expect(prepared.cleanup).toHaveBeenCalledOnce();
  });

  it('marks controller commit/tree/blob drift after the cells unproven', async () => {
    const root = await temporaryRoot();
    const prepared = preparedFixture(root);
    let controllerReads = 0;
    const report = await runDevReadyProfile(runnerOptions(root), {
      acquireLock: () => ({ release() {} }),
      collectControllerState: () => {
        controllerReads += 1;
        return controllerReads === 1
          ? controllerState()
          : { ...controllerState(), tree: 'e'.repeat(40) };
      },
      collectState: (sourceRoot) =>
        prepared.source.before[sourceRoot === prepared.roots.baseline ? 'baseline' : 'spike'],
      createHostAdmission: () => quietHostAdmission(),
      hostFingerprint: () => ({ schema: 'test-host/v1' }),
      inspectPortAllocation: completePortAllocation,
      launchBrowser: async () => ({ close() {} }),
      prepare: async () => prepared,
      runCell: async (options) => successfulCell(options),
    });

    expect(report.controller.stable).toBe(false);
    expect(report.integrity).toMatchObject({ complete: false, controllerStable: false });
    expect(report.verdict).toMatchObject({
      reasons: ['diagnostic controller changed during fresh-ready profiling'],
      status: 'unproven',
    });
  });
});

async function syntheticPackedScript(root) {
  const consumerRoot = path.join(root, 'consumer');
  const dist = path.join(consumerRoot, 'node_modules/@kovojs/compiler/dist');
  await mkdir(dist, { recursive: true });
  const names = [
    'queryPlanBootstrapInputForComponent',
    'resolveViteComponentQueryRuntimeNames',
    'resolveComponentQueryRuntimeNames',
    'queryIdentityCompilerOptions',
    'exactEntryCompilerHost',
    'resolveFreshDirectQueryRuntimeNames',
    'freshDirectImportedQueryRuntimeName',
  ];
  const declarations = names.map((name, index) =>
    index === 0
      ? `const ${name} = () => ${JSON.stringify(name)};`
      : index === 1
        ? `async function ${name}() { return ${JSON.stringify(name)}; }`
        : `function ${name}() { return ${JSON.stringify(name)}; }`,
  );
  const source = `${declarations.join('\n')}\n//# sourceMappingURL=vite-config.mjs.map\n`;
  const sourceMap = `${JSON.stringify({ mappings: '', names: [], sources: ['vite.ts'], version: 3 })}\n`;
  const scriptPath = path.join(dist, 'vite-config.mjs');
  await writeFile(scriptPath, source);
  await writeFile(`${scriptPath}.map`, sourceMap);
  const functions = names.map((name, index) => {
    const declarationStart = source.indexOf(declarations[index]);
    const startOffset = index === 0 ? source.indexOf('() =>', declarationStart) : declarationStart;
    const endOffset = source.indexOf('\n', startOffset);
    return {
      functionName: name,
      isBlockCoverage: true,
      ranges: [{ count: 3, endOffset, startOffset }],
    };
  });
  return {
    consumerRoot,
    coverage: {
      result: [coverageScript('17', pathToFileURL(scriptPath).href, functions)],
      timestamp: 5,
    },
    source,
    sourceMap,
  };
}

function inspectorSession({
  commands,
  execArgv = ['--inspect-brk=127.0.0.1:21216'],
  marker,
  product,
}) {
  return {
    close() {
      commands.push('close');
    },
    identity: inspectorIdentity(9_201, marker, 'owned-target'),
    async send(method) {
      commands.push(method);
      if (method === 'Runtime.evaluate') return { result: { value: { execArgv } } };
      if (method === 'Profiler.stop') return { profile: syntheticCpuProfile() };
      if (method === 'Profiler.takePreciseCoverage') return product.coverage;
      return {};
    },
  };
}

function inspectorIdentity(pid, marker, targetId) {
  return {
    pid,
    processMarkerMatched: true,
    processMarkerSha256: sha256(Buffer.from(marker)),
    targetId,
  };
}

function profilerOptions({ marker, product, profileDir }) {
  return {
    artifactStem: 'cell-000-baseline',
    consumerRoot: product.consumerRoot,
    expectedPid: 9_201,
    inspectorPort: 21_216,
    processMarker: marker,
    productDigest: digest('a'),
    profileDir,
  };
}

function syntheticCpuProfile() {
  return {
    endTime: 1_000,
    nodes: [
      {
        callFrame: { functionName: '(root)', url: '' },
        children: [],
        id: 1,
      },
    ],
    samples: [1],
    startTime: 0,
    timeDeltas: [500],
  };
}

function coverageScript(scriptId, url, functions) {
  return { functions, scriptId, url };
}

function runnerOptions(root) {
  return {
    baselineRoot: path.join(root, 'baseline'),
    diagnose: true,
    out: path.join(root, 'report.json'),
    profileDir: path.join(root, 'profiles'),
    spikeRoot: path.join(root, 'spike'),
  };
}

function preparedFixture(root) {
  const baselineRoot = path.join(root, 'baseline');
  const spikeRoot = path.join(root, 'spike');
  const baseline = sourceState(DEV_CRITICAL_PATH_CANDIDATE.parent);
  const spike = sourceState(DEV_CRITICAL_PATH_CANDIDATE.commit);
  const corpus = { modules: 216, schema: 'test-corpus/v1', sourceDigest: digest('c') };
  return {
    candidateBinding: {
      baseline: { commit: DEV_CRITICAL_PATH_CANDIDATE.parent, root: baselineRoot },
      schema: DEV_GENERATION_CANDIDATE_BINDING_SCHEMA,
      spike: { commit: DEV_CRITICAL_PATH_CANDIDATE.commit, root: spikeRoot },
    },
    cleanup: vi.fn(),
    corpus: { baseline: corpus, spike: structuredClone(corpus) },
    manifestPaths: {
      baseline: path.join(root, 'external-baseline/manifest.json'),
      spike: path.join(root, 'external-spike/manifest.json'),
    },
    products: {
      baseline: productFixture(root, 'baseline'),
      spike: productFixture(root, 'spike'),
    },
    roots: { baseline: baselineRoot, spike: spikeRoot },
    source: { before: { baseline, spike } },
  };
}

function productFixture(root, lane) {
  return {
    descriptorPath: path.join(root, `consumer-${lane}/descriptor.json`),
    externalRoot: path.join(root, `external-${lane}`),
    identity: {
      digest: digest(lane === 'baseline' ? 'a' : 'b'),
      schema: 'kovo-packed-product-identity/v1',
    },
  };
}

function sourceState(commit) {
  return {
    commit,
    dirty: false,
    dirtyPaths: [],
    locks: {
      'benchmarks/harness/pnpm-lock.yaml': digest('h'),
      'benchmarks/nextjs/pnpm-lock.yaml': digest('n'),
      'pnpm-lock.yaml': digest('r'),
    },
    packageManager: 'pnpm@10.15.1',
    pnpmVersion: '10.15.1',
  };
}

function successfulCell(options) {
  return {
    authentication: {
      corpus: { afterVerified: true, beforeVerified: true },
      product: { afterVerified: true, beforeVerified: true },
    },
    lane: options.lane,
    observation: { success: true },
    occurrence: options.occurrence,
    processMarker: `KOVO_PERF_DEV_SESSION_CELL_${String(options.scheduleIndex)}`,
    profile: {
      diagnosticOnly: { acceptanceEligible: false },
      schema: DEV_READY_PROFILE_WINDOW_SCHEMA,
    },
    scheduleIndex: options.scheduleIndex,
  };
}

function completeProfiledObservation() {
  return {
    browser: { requestFailedCount: 0, unexpectedErrorCount: 0 },
    browserContextClosed: true,
    durationMs: 123,
    lifecycle: { complete: true },
    paintFenceMs: 4,
    peakRssBytes: 1_024,
    readinessProbe: { attempts: 1, path: '/', status: 200, transientFailures: 0 },
    readyDiagnostic: {
      diagnosticOnly: { acceptanceEligible: false },
      schema: DEV_READY_PROFILE_WINDOW_SCHEMA,
    },
    rssSamples: 2,
    success: true,
  };
}

function cellDependencies({
  createProfiler,
  expectedCorpus,
  launch,
  measure,
  profiler,
  root,
  verifyProduct,
}) {
  return {
    cleanOutputs: async () => undefined,
    createProfiler: createProfiler ?? (async () => profiler),
    inspectCorpus: () => structuredClone(expectedCorpus),
    launch,
    loadManifest: async () => ({
      appRoot: root,
      manifest: {
        build: { outputs: { absent: [], requiredNonempty: [] } },
        dev: { command: { argv: ['kovo', 'dev'], cwd: '.', env: {} } },
        framework: 'kovo',
        modules: 216,
      },
    }),
    materializeCommand: () => ({
      argv: ['node', 'bin.mjs', 'dev'],
      origin: 'http://localhost:20000',
    }),
    measure,
    verifyProduct,
    verifySources: async () => undefined,
  };
}

function controllerState() {
  const files = [
    'benchmarks/corpora/dev-loop.mjs',
    'benchmarks/corpora/generate.mjs',
    'benchmarks/harness/dev-port-allocation.mjs',
    'scripts/lib/perf-packed-kovo-product.mjs',
    'scripts/lib/perf-ready-route.mjs',
    'scripts/perf-dev-edit-profile.mjs',
    'scripts/perf-dev-generation-spike.mjs',
    'scripts/perf-dev-ready-profile.mjs',
  ];
  return {
    commit: 'a'.repeat(40),
    dirty: false,
    dirtyPaths: [],
    locks: sourceState('a'.repeat(40)).locks,
    packageManager: 'pnpm@10.15.1',
    pnpmVersion: '10.15.1',
    root: '/controller',
    scripts: Object.fromEntries(
      files.map((file, index) => [
        file,
        { bytes: index + 1, gitBlob: 'c'.repeat(40), sha256: digest('d') },
      ]),
    ),
    tree: 'b'.repeat(40),
  };
}

function quietHostAdmission() {
  return {
    async admit(label) {
      return { comparable: true, label };
    },
    markBenchmarkWork() {},
    async observe(label) {
      return { comparable: true, label };
    },
  };
}

async function completePortAllocation(options) {
  return inspectDevPortAllocation(options, {
    inspectHostRanges: async () => linuxEphemeralEvidence('49152 65535\n'),
  });
}

function linuxEphemeralEvidence(source) {
  const bytes = Buffer.from(source);
  const [minimum, maximum] = source.trim().split(/\s+/u).map(Number);
  return {
    complete: true,
    error: null,
    platform: 'linux',
    probe: {
      bytes: bytes.byteLength,
      contentBase64: bytes.toString('base64'),
      kind: 'procfs',
      locator: '/proc/sys/net/ipv4/ip_local_port_range',
      sha256: sha256(bytes),
    },
    ranges: [{ label: 'default', maximum, minimum }],
    schema: 'kovo-host-ephemeral-port-ranges/v1',
    scope: 'tcp-loopback-v4-v6/v1',
  };
}

function digest(seed) {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-dev-ready-profile-test-'));
  roots.push(root);
  return root;
}
