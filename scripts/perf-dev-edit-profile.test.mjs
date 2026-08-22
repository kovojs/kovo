import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  analyzeDevEditProfiles,
  auditDevEditProfileArtifacts,
  connectDevInspector,
  connectPausedDevInspector,
  createDevEditProfiler,
  DEV_EDIT_PROFILE_AUDIT_SCHEMA,
  DEV_EDIT_PROFILE_CATEGORIES,
  DEV_EDIT_PROFILE_SCHEMA,
  DEV_PAUSED_INSPECTOR_BOOTSTRAP_SCHEMA,
  summarizeProfileWindows,
} from './perf-dev-edit-profile.mjs';

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('exact dev edit-to-paint diagnostics', () => {
  it('rejects an unrelated first /json/list target and binds the spawned PID/session target', async () => {
    const closed = [];
    const marker = 'KOVO_PERF_DEV_SESSION_OWNED';
    const targets = [
      {
        id: 'unrelated',
        webSocketDebuggerUrl: 'ws://127.0.0.1:21216/unrelated',
      },
      {
        id: 'owned',
        webSocketDebuggerUrl: 'ws://127.0.0.1:21216/owned',
      },
    ];
    const session = await connectDevInspector(
      { expectedPid: 9_999, inspectorPort: 21_216, processMarker: marker },
      {
        fetch: async () => ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(targets),
        }),
        openSession: async (url) => ({
          close: () => closed.push(url),
          async send(method) {
            expect(method).toBe('Runtime.evaluate');
            return {
              result: {
                value: {
                  pid: url.endsWith('/owned') ? 9_999 : 7_777,
                  processMarkerMatched: true,
                },
              },
            };
          },
        }),
      },
    );

    expect(session.identity).toMatchObject({ pid: 9_999, targetId: 'owned' });
    expect(closed).toEqual(['ws://127.0.0.1:21216/unrelated']);
    session.close();
    expect(closed).toEqual(['ws://127.0.0.1:21216/unrelated', 'ws://127.0.0.1:21216/owned']);
  });

  it('authenticates the sole prebootstrap context and starts both samplers before runtime advance', async () => {
    const fixture = pausedConnectionFixture();
    const beforeRuntimeAdvance = vi.fn(() => {
      expect(fixture.commands.slice(-1)).toEqual(['Profiler.start']);
    });
    const connection = await connectPausedDevInspector(fixture.options, {
      ...fixture.dependencies,
      beforeRuntimeAdvance,
    });

    expect(connection.identity).toMatchObject({
      bootstrap: {
        contextName: `${process.execPath}[9999]`,
        processGlobals: 'pid-argv-execArgv-undefined',
        schema: DEV_PAUSED_INSPECTOR_BOOTSTRAP_SCHEMA,
      },
      pid: 9_999,
      processMarkerMatched: true,
      targetId: 'owned',
    });
    expect(connection.invocation.argv).toEqual(fixture.options.invocation.argv);
    await connection.startAndResume();
    expect(fixture.commands).toEqual([
      'Runtime.enable',
      'Runtime.evaluate',
      'Profiler.enable',
      'Profiler.setSamplingInterval',
      'Profiler.startPreciseCoverage',
      'Profiler.start',
      'Runtime.runIfWaitingForDebugger',
    ]);
    expect(beforeRuntimeAdvance).toHaveBeenCalledOnce();
    connection.close();
  });

  it('fails closed on missing, duplicate, malformed, advanced, or wrong-PID bootstrap evidence', async () => {
    const cases = [
      {
        expected: /omitted its default execution context/u,
        fixture: pausedConnectionFixture({ events: [] }),
      },
      {
        expected: /duplicate execution-context census/u,
        fixture: pausedConnectionFixture({
          events: [pausedContext(9_999), pausedContext(9_999, { id: 2 })],
        }),
      },
      {
        expected: /default execution context was malformed/u,
        fixture: pausedConnectionFixture({ events: [pausedContext(9_999, { origin: 'file:' })] }),
      },
      {
        expected: /not the expected unadvanced Node bootstrap context/u,
        fixture: pausedConnectionFixture({
          evaluation: pausedEvaluation({ pidType: 'number' }),
        }),
      },
      {
        expected: /not the expected unadvanced Node bootstrap context/u,
        fixture: pausedConnectionFixture({ events: [pausedContext(7_777)] }),
      },
    ];
    for (const { expected, fixture } of cases) {
      await expect(
        connectPausedDevInspector(fixture.options, fixture.dependencies),
      ).rejects.toThrow(expected);
      expect(fixture.commands).not.toContain('Runtime.runIfWaitingForDebugger');
    }
  });

  it('rejects an honest non-paused launch record before opening Inspector', async () => {
    const fixture = pausedConnectionFixture();
    fixture.options.invocation = {
      ...fixture.options.invocation,
      argv: fixture.options.invocation.argv.with(
        0,
        fixture.options.invocation.argv[0].replace('--inspect-brk=', '--inspect='),
      ),
      pauseOnStart: false,
    };
    await expect(connectPausedDevInspector(fixture.options, fixture.dependencies)).rejects.toThrow(
      /exact packed --inspect-brk invocation/u,
    );
    expect(fixture.opened).toHaveLength(0);
  });

  it('stops precise coverage when CPU profiler start fails after coverage activation', async () => {
    const fixture = pausedConnectionFixture({ failMethod: 'Profiler.start' });
    const connection = await connectPausedDevInspector(fixture.options, fixture.dependencies);
    await expect(connection.startAndResume()).rejects.toThrow(/synthetic Profiler.start failure/u);
    expect(fixture.commands).toEqual([
      'Runtime.enable',
      'Runtime.evaluate',
      'Profiler.enable',
      'Profiler.setSamplingInterval',
      'Profiler.startPreciseCoverage',
      'Profiler.start',
      'Profiler.stopPreciseCoverage',
      'close',
    ]);
  });

  it('proves a real inspect-brk process has not run user code before the sampler fence', async () => {
    const root = await temporaryRoot();
    const entrypoint = path.join(root, 'bin.mjs');
    const sentinel = path.join(root, 'started.txt');
    await writeFile(
      entrypoint,
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(
        sentinel,
      )}, 'started');\nsetInterval(() => {}, 1000);\n`,
    );
    const inspectorPort = await reserveLoopbackPort();
    const marker = 'KOVO_PERF_DEV_SESSION_REAL_PAUSED';
    const invocation = profiledPausedInvocation(entrypoint, inspectorPort, inspectorPort - 1);
    const child = spawn(process.execPath, invocation.argv, {
      env: { ...process.env, [marker]: '1' },
      stdio: 'ignore',
    });
    try {
      const connection = await connectPausedDevInspector(
        {
          expectedDevPort: inspectorPort - 1,
          expectedEntrypoint: entrypoint,
          expectedPid: child.pid,
          inspectorPort,
          invocation,
          processMarker: marker,
          samplingIntervalMicros: 500,
        },
        {
          beforeRuntimeAdvance() {
            expect(existsSync(sentinel)).toBe(false);
          },
        },
      );
      expect(existsSync(sentinel)).toBe(false);
      await connection.startAndResume();
      await waitFor(() => existsSync(sentinel));
      await Promise.all([
        connection.send('Profiler.stop'),
        connection.send('Profiler.stopPreciseCoverage'),
      ]);
      connection.close();
    } finally {
      await stopChild(child);
    }
  });

  it('rejects a real already-advanced Inspector target even with forged paused launch evidence', async () => {
    const root = await temporaryRoot();
    const entrypoint = path.join(root, 'bin.mjs');
    const sentinel = path.join(root, 'started.txt');
    await writeFile(
      entrypoint,
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(
        sentinel,
      )}, 'started');\nsetInterval(() => {}, 1000);\n`,
    );
    const inspectorPort = await reserveLoopbackPort();
    const marker = 'KOVO_PERF_DEV_SESSION_REAL_ADVANCED';
    const claimed = profiledPausedInvocation(entrypoint, inspectorPort, inspectorPort - 1);
    const actualArgv = claimed.argv.with(
      0,
      claimed.argv[0].replace('--inspect-brk=', '--inspect='),
    );
    const child = spawn(process.execPath, actualArgv, {
      env: { ...process.env, [marker]: '1' },
      stdio: 'ignore',
    });
    try {
      await waitFor(() => existsSync(sentinel));
      await expect(
        connectPausedDevInspector({
          expectedDevPort: inspectorPort - 1,
          expectedEntrypoint: entrypoint,
          expectedPid: child.pid,
          inspectorPort,
          invocation: claimed,
          processMarker: marker,
          samplingIntervalMicros: 500,
        }),
      ).rejects.toThrow(/not the expected unadvanced Node bootstrap context/u);
    } finally {
      await stopChild(child);
    }
  });

  it('ranks directly sampled categories and retires absent hypotheses', () => {
    const analysis = analyzeDevEditProfiles(syntheticProfiles());

    expect(analysis.census).toMatchObject({
      activeCpuSamples: 15,
      allocatedBytes: 98_304,
      unknownCpuSamples: 1,
    });
    expect(analysis.topFive[0]).toMatchObject({
      category: 'self-time',
      cpuSelfSamples: 15,
      rank: 1,
    });
    expect(category(analysis, 'module-evaluation')).toMatchObject({
      cpuSelfSamples: 7,
      ruling: 'present-in-current-top-five',
    });
    expect(category(analysis, 'vite-transform')).toMatchObject({
      cpuSelfSamples: 5,
      ruling: 'present-in-current-top-five',
    });
    expect(category(analysis, 'ssr-generation')).toMatchObject({
      cpuSelfSamples: 2,
      ruling: 'present-in-current-top-five',
    });
    expect(category(analysis, 'asynchronous-proof-convergence')).toMatchObject({
      cpuSelfSamples: 0,
      ruling: 'retired-absent-from-current-profile',
    });
  });

  it('writes raw CPU/heap evidence and marks the aggregate diagnostic-only', async () => {
    const root = await temporaryRoot();
    const commands = [];
    const profiles = syntheticProfiles();
    const session = {
      close: () => commands.push('close'),
      identity: inspectorIdentity(9_201, 'KOVO_PERF_DEV_SESSION_PROFILE_A'),
      async send(method) {
        commands.push(method);
        if (method === 'Profiler.stop') return { profile: profiles.cpu };
        if (method === 'HeapProfiler.stopSampling') return { profile: profiles.heap };
        return {};
      },
    };
    const profiler = await createDevEditProfiler(
      {
        expectedPid: 9_201,
        framework: 'kovo',
        inspectorPort: 49_201,
        modules: 24,
        processMarker: 'KOVO_PERF_DEV_SESSION_PROFILE_A',
        profileDir: root,
      },
      { connectInspector: async () => session },
    );

    await profiler.startWindow({ editClass: 'leaf', iteration: 0 });
    const observation = await profiler.stopWindow({ editClass: 'leaf', iteration: 0 });
    const summary = profiler.summary();
    await profiler.close();

    expect(commands).toEqual([
      'Profiler.enable',
      'Profiler.setSamplingInterval',
      'HeapProfiler.enable',
      'Profiler.start',
      'HeapProfiler.startSampling',
      'Profiler.stop',
      'HeapProfiler.stopSampling',
      'close',
    ]);
    expect(observation.artifact.cpu.sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(JSON.parse(await readFile(path.join(root, 'leaf-000.cpuprofile'), 'utf8'))).toEqual(
      profiles.cpu,
    );
    expect(summary).toMatchObject({
      diagnosticOnly: { profilerPerturbsDurations: true, publishTimingClaims: false },
      schema: DEV_EDIT_PROFILE_SCHEMA,
      windowCount: 1,
    });
    expect(
      summary.categories
        .map((entry) => entry.category)
        .sort((left, right) => left.localeCompare(right)),
    ).toEqual([...DEV_EDIT_PROFILE_CATEGORIES].sort((left, right) => left.localeCompare(right)));
    await expect(
      auditDevEditProfileArtifacts({ diagnostic: summary, profileDir: root }),
    ).resolves.toMatchObject({
      complete: true,
      schema: DEV_EDIT_PROFILE_AUDIT_SCHEMA,
      windowCount: 1,
    });
    await writeFile(path.join(root, 'leaf-000.cpuprofile'), '{}\n');
    await expect(
      auditDevEditProfileArtifacts({ diagnostic: summary, profileDir: root }),
    ).rejects.toThrow('digest differs');
  });

  it('attributes generic leaf work through its sampled CPU and heap ancestry', () => {
    const analysis = analyzeDevEditProfiles({
      cpu: {
        endTime: 2_000,
        nodes: [
          frameNode(1, '(root)', '', [2]),
          frameNode(
            2,
            'runDevWholeProjectAnalysis',
            'file:///repo/packages/server/src/vite.ts',
            [3],
          ),
          frameNode(3, 'scan', 'file:///repo/node_modules/typescript/lib/typescript.js'),
        ],
        samples: [3, 3, 3],
        startTime: 10,
        timeDeltas: [500, 500, 500],
      },
      heap: {
        head: {
          callFrame: callFrame('(root)', ''),
          children: [
            {
              callFrame: callFrame(
                'runDevWholeProjectAnalysis',
                'file:///repo/packages/server/src/vite.ts',
              ),
              children: [
                {
                  callFrame: callFrame(
                    'scan',
                    'file:///repo/node_modules/typescript/lib/typescript.js',
                  ),
                  children: [],
                  id: 3,
                  selfSize: 65_536,
                },
              ],
              id: 2,
              selfSize: 0,
            },
          ],
          id: 1,
          selfSize: 0,
        },
        samples: [],
      },
    });

    expect(category(analysis, 'asynchronous-proof-convergence')).toMatchObject({
      allocationBytes: 65_536,
      cpuSelfSamples: 3,
      ruling: 'present-in-current-top-five',
    });
    expect(analysis.census).toMatchObject({
      unknownAllocationBytes: 0,
      unknownCpuSamples: 0,
    });
    expect(analysis.topSelfFrames[0]).toMatchObject({
      functionName: 'scan',
      url: 'node_modules/typescript/lib/typescript.js',
    });
  });

  it('stably orders the sample/timestamp pairs without mutating signed Inspector evidence', () => {
    const cpu = {
      endTime: 300,
      nodes: [
        frameNode(1, '(root)', '', [2, 3]),
        frameNode(2, 'evaluateModule', 'file:///repo/node_modules/vite/module-runner.js'),
        frameNode(3, 'transformRequest', 'file:///repo/node_modules/vite/chunk.js'),
      ],
      samples: [2, 3, 2],
      startTime: 0,
      timeDeltas: [100, 100, -50],
    };
    const rawBefore = JSON.stringify(cpu);
    const analysis = analyzeDevEditProfiles({ cpu, heap: syntheticProfiles().heap });

    expect(JSON.stringify(cpu)).toBe(rawBefore);
    expect(analysis.census).toMatchObject({
      negativeCpuTimeDeltas: 1,
      totalCpuSamples: 3,
      totalCpuSelfMicros: 200,
    });
    expect(category(analysis, 'module-evaluation')).toMatchObject({
      cpuSelfSamples: 2,
      selfTimeMicros: 150,
    });
    expect(category(analysis, 'vite-transform')).toMatchObject({
      cpuSelfSamples: 1,
      selfTimeMicros: 50,
    });
  });

  it('accepts every signed-delta magnitude retained by the N=216 hosted profile', async () => {
    const root = await temporaryRoot();
    const profiles = syntheticProfiles();
    const observedNegativeDeltas = [-57, -2, -6, -1, -5, -3, -3, -3, -4, -3, -4, -2, -7];
    const timeDeltas = [...observedNegativeDeltas.flatMap((delta) => [100, delta]), 100];
    const cpu = {
      ...profiles.cpu,
      endTime: 2_500,
      samples: timeDeltas.map((_delta, index) => (index % 2 === 0 ? 2 : 3)),
      startTime: 1_000,
      timeDeltas,
    };
    const exactCpuBytes = `${JSON.stringify(cpu)}\n`;
    const session = {
      close() {},
      identity: inspectorIdentity(9_204, 'KOVO_PERF_DEV_SESSION_PROFILE_D'),
      async send(method) {
        if (method === 'Profiler.stop') return { profile: cpu };
        if (method === 'HeapProfiler.stopSampling') return { profile: profiles.heap };
        return {};
      },
    };
    const profiler = await createDevEditProfiler(
      {
        expectedPid: 9_204,
        framework: 'kovo',
        inspectorPort: 49_204,
        modules: 216,
        processMarker: 'KOVO_PERF_DEV_SESSION_PROFILE_D',
        profileDir: root,
      },
      { connectInspector: async () => session },
    );

    await profiler.startWindow({ editClass: 'leaf', iteration: 0 });
    const observation = await profiler.stopWindow({ editClass: 'leaf', iteration: 0 });
    const summary = profiler.summary();
    await profiler.close();

    expect(await readFile(path.join(root, 'leaf-000.cpuprofile'), 'utf8')).toBe(exactCpuBytes);
    expect(observation.negativeCpuTimeDeltas).toBe(observedNegativeDeltas.length);
    expect(summary.census.negativeCpuTimeDeltas).toBe(observedNegativeDeltas.length);
    await expect(
      auditDevEditProfileArtifacts({ diagnostic: summary, profileDir: root }),
    ).resolves.toMatchObject({ complete: true, windowCount: 1 });
  });

  it('fails closed on mismatched windows and malformed Inspector evidence', async () => {
    const root = await temporaryRoot();
    const profiles = syntheticProfiles();
    const session = {
      close() {},
      identity: inspectorIdentity(9_202, 'KOVO_PERF_DEV_SESSION_PROFILE_B'),
      async send(method) {
        if (method === 'Profiler.stop') return { profile: profiles.cpu };
        if (method === 'HeapProfiler.stopSampling') return { profile: profiles.heap };
        return {};
      },
    };
    const profiler = await createDevEditProfiler(
      {
        expectedPid: 9_202,
        framework: 'kovo',
        inspectorPort: 49_202,
        modules: 24,
        processMarker: 'KOVO_PERF_DEV_SESSION_PROFILE_B',
        profileDir: root,
      },
      { connectInspector: async () => session },
    );

    await profiler.startWindow({ editClass: 'entry', iteration: 0 });
    await expect(profiler.stopWindow({ editClass: 'leaf', iteration: 0 })).rejects.toThrow(
      'identity does not match',
    );
    await profiler.abortWindow();
    await profiler.close();
    expect(() =>
      analyzeDevEditProfiles({ cpu: { nodes: [], samples: [] }, heap: profiles.heap }),
    ).toThrow('CPU profile must contain nodes');
    expect(() =>
      analyzeDevEditProfiles({
        cpu: { ...profiles.cpu, timeDeltas: [500.5, ...profiles.cpu.timeDeltas.slice(1)] },
        heap: profiles.heap,
      }),
    ).toThrow('safe-integer signed time delta');
    expect(() =>
      analyzeDevEditProfiles({
        cpu: {
          ...profiles.cpu,
          startTime: 10,
          timeDeltas: [-1, ...profiles.cpu.timeDeltas.slice(1)],
        },
        heap: profiles.heap,
      }),
    ).toThrow('outside the profile time range');
    expect(() =>
      analyzeDevEditProfiles({
        cpu: {
          ...profiles.cpu,
          endTime: 20,
          timeDeltas: [11, ...profiles.cpu.timeDeltas.slice(1)],
        },
        heap: profiles.heap,
      }),
    ).toThrow('outside the profile time range');
    expect(() =>
      analyzeDevEditProfiles({
        cpu: { ...profiles.cpu, endTime: profiles.cpu.startTime - 1 },
        heap: profiles.heap,
      }),
    ).toThrow('safe-integer ordered time range');
    expect(() =>
      analyzeDevEditProfiles({
        cpu: { ...profiles.cpu, samples: [999, ...profiles.cpu.samples.slice(1)] },
        heap: profiles.heap,
      }),
    ).toThrow('unknown sample or child nodes');
    expect(() =>
      analyzeDevEditProfiles({
        cpu: {
          endTime: 2,
          nodes: [
            frameNode(1, '(root)', '', [2, 3]),
            frameNode(2, 'left', '', [4]),
            frameNode(3, 'right', '', [4]),
            frameNode(4, 'leaf', ''),
          ],
          samples: [4],
          startTime: 0,
          timeDeltas: [1],
        },
        heap: profiles.heap,
      }),
    ).toThrow('multiple parents');
    expect(() =>
      analyzeDevEditProfiles({
        cpu: {
          endTime: 2,
          nodes: [frameNode(1, '(root)', '', [2]), frameNode(2, 'cycle', '', [1])],
          samples: [2],
          startTime: 0,
          timeDeltas: [1],
        },
        heap: profiles.heap,
      }),
    ).toThrow('parent graph contains a cycle');
    expect(() => summarizeProfileWindows([])).toThrow('at least one exact edit profile window');
  });

  it('quarantines malformed Inspector evidence without retrying stopped samplers', async () => {
    const root = await temporaryRoot();
    const profiles = syntheticProfiles();
    const rejectedCpu = { ...profiles.cpu, timeDeltas: profiles.cpu.timeDeltas.slice(1) };
    const commands = [];
    const session = {
      close: () => commands.push('close'),
      identity: inspectorIdentity(9_203, 'KOVO_PERF_DEV_SESSION_PROFILE_C'),
      async send(method) {
        commands.push(method);
        if (method === 'Profiler.stop') return { profile: rejectedCpu };
        if (method === 'HeapProfiler.stopSampling') return { profile: profiles.heap };
        return {};
      },
    };
    const profiler = await createDevEditProfiler(
      {
        expectedPid: 9_203,
        framework: 'kovo',
        inspectorPort: 49_203,
        modules: 24,
        processMarker: 'KOVO_PERF_DEV_SESSION_PROFILE_C',
        profileDir: root,
      },
      { connectInspector: async () => session },
    );

    await profiler.startWindow({ editClass: 'data', iteration: 2 });
    await expect(profiler.stopWindow({ editClass: 'data', iteration: 2 })).rejects.toThrow(
      'samples=15, timeDeltas=14, invalid=none',
    );
    await profiler.abortWindow();
    await profiler.close();

    expect(commands.filter((method) => method === 'Profiler.stop')).toHaveLength(1);
    expect(commands.filter((method) => method === 'HeapProfiler.stopSampling')).toHaveLength(1);
    expect(
      JSON.parse(await readFile(path.join(root, 'rejected/data-002.cpuprofile'), 'utf8')),
    ).toEqual(rejectedCpu);
    expect(
      JSON.parse(await readFile(path.join(root, 'rejected/data-002.heapprofile'), 'utf8')),
    ).toEqual(profiles.heap);
    expect(
      JSON.parse(await readFile(path.join(root, 'rejected/data-002.rejection.json'), 'utf8')),
    ).toMatchObject({
      error: expect.stringContaining('samples=15, timeDeltas=14, invalid=none'),
      identity: { editClass: 'data', iteration: 2 },
      profileShape: {
        cpu: { nodes: 5, samples: 15, timeDeltas: 14 },
        heap: { hasHead: true, samples: 0 },
      },
      schema: 'kovo-dev-edit-profile-rejection/v1',
    });
  });
});

function category(analysis, id) {
  return analysis.categories.find((entry) => entry.category === id);
}

function inspectorIdentity(pid, processMarker, targetId = 'target-1') {
  return {
    pid,
    processMarkerMatched: true,
    processMarkerSha256: `sha256:${createHash('sha256').update(processMarker).digest('hex')}`,
    targetId,
  };
}

function syntheticProfiles() {
  return {
    cpu: {
      endTime: 8_000,
      nodes: [
        frameNode(1, '(root)', ''),
        frameNode(2, 'evaluateModule', 'file:///repo/node_modules/vite/dist/module-runner.js'),
        frameNode(3, 'transformRequest', 'file:///repo/node_modules/vite/dist/node/chunks.js'),
        frameNode(4, 'renderDocument', 'file:///repo/packages/server/src/render.ts'),
        frameNode(5, 'anonymousWork', 'node:internal/process/task_queues'),
      ],
      samples: [2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 5],
      startTime: 10,
      timeDeltas: Array.from({ length: 15 }, () => 500),
    },
    heap: {
      head: {
        callFrame: callFrame('(root)', ''),
        children: [
          {
            callFrame: callFrame(
              'evaluateModule',
              'file:///repo/node_modules/vite/dist/module-runner.js',
            ),
            children: [],
            id: 2,
            selfSize: 65_536,
          },
          {
            callFrame: callFrame('anonymousWork', 'node:internal/process/task_queues'),
            children: [],
            id: 3,
            selfSize: 32_768,
          },
        ],
        id: 1,
        selfSize: 0,
      },
      samples: [],
    },
  };
}

function frameNode(id, functionName, url, children = []) {
  return { callFrame: callFrame(functionName, url), children, hitCount: 0, id };
}

function callFrame(functionName, url) {
  return { columnNumber: 1, functionName, lineNumber: 1, scriptId: '1', url };
}

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-dev-profile-test-'));
  roots.push(root);
  return root;
}

function pausedConnectionFixture({ evaluation, events, failMethod } = {}) {
  const marker = 'KOVO_PERF_DEV_SESSION_PAUSED_FIXTURE';
  const expectedPid = 9_999;
  const inspectorPort = 21_216;
  const expectedDevPort = inspectorPort - 1;
  const entrypoint = '/tmp/kovo-packed/node_modules/@kovojs/cli/dist/bin.mjs';
  const commands = [];
  const opened = [];
  const listeners = new Set();
  let clock = 0;
  const emitted = events ?? [pausedContext(expectedPid)];
  const session = {
    close() {
      commands.push('close');
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async send(method) {
      commands.push(method);
      if (method === failMethod) throw new Error(`synthetic ${method} failure`);
      if (method === 'Runtime.enable') {
        for (const params of emitted) {
          for (const listener of listeners) {
            listener({ error: null, method: 'Runtime.executionContextCreated', params });
          }
        }
      }
      if (method === 'Runtime.evaluate') return evaluation ?? pausedEvaluation();
      return {};
    },
  };
  return {
    commands,
    dependencies: {
      delay: async (milliseconds) => {
        clock += milliseconds;
      },
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify([
            {
              id: 'owned',
              webSocketDebuggerUrl: `ws://127.0.0.1:${String(inspectorPort)}/owned`,
            },
          ]),
      }),
      now: () => clock,
      openSession: async (url) => {
        opened.push(url);
        return session;
      },
      timeoutMs: 20,
    },
    opened,
    options: {
      expectedDevPort,
      expectedEntrypoint: entrypoint,
      expectedPid,
      inspectorPort,
      invocation: profiledPausedInvocation(entrypoint, inspectorPort, expectedDevPort),
      processMarker: marker,
      samplingIntervalMicros: 500,
    },
  };
}

function pausedContext(pid, overrides = {}) {
  return {
    context: {
      auxData: { isDefault: true },
      id: 1,
      name: `${process.execPath}[${String(pid)}]`,
      origin: '',
      ...overrides,
    },
  };
}

function pausedEvaluation(overrides = {}) {
  return {
    result: {
      type: 'object',
      value: {
        argvType: 'undefined',
        execArgvType: 'undefined',
        pidType: 'undefined',
        processMarkerMatched: true,
        ...overrides,
      },
    },
  };
}

function profiledPausedInvocation(entrypoint, inspectorPort, devPort) {
  return {
    argv: [
      `--inspect-brk=127.0.0.1:${String(inspectorPort)}`,
      entrypoint,
      'dev',
      './src/app.tsx',
      '--host',
      'localhost',
      '--strict-port',
      '--port',
      String(devPort),
    ],
    executable: process.execPath,
    pauseOnStart: true,
    port: inspectorPort,
    schema: 'kovo-profiled-process-invocation/v1',
  };
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (address === null || typeof address === 'string') throw new Error('test port was unavailable');
  return address.port;
}

async function waitFor(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for test process state');
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const forceTimer = setTimeout(() => child.kill('SIGKILL'), 1_000);
  try {
    await exited;
  } finally {
    clearTimeout(forceTimer);
  }
}
