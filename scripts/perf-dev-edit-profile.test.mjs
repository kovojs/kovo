import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  analyzeDevEditProfiles,
  createDevEditProfiler,
  DEV_EDIT_PROFILE_CATEGORIES,
  DEV_EDIT_PROFILE_SCHEMA,
  summarizeProfileWindows,
} from './perf-dev-edit-profile.mjs';

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('exact dev edit-to-paint diagnostics', () => {
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
      async send(method) {
        commands.push(method);
        if (method === 'Profiler.stop') return { profile: profiles.cpu };
        if (method === 'HeapProfiler.stopSampling') return { profile: profiles.heap };
        return {};
      },
    };
    const profiler = await createDevEditProfiler(
      {
        framework: 'kovo',
        inspectorPort: 49_201,
        modules: 24,
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
    expect(summary.categories.map((entry) => entry.category).sort()).toEqual(
      [...DEV_EDIT_PROFILE_CATEGORIES].sort(),
    );
  });

  it('fails closed on mismatched windows and malformed Inspector evidence', async () => {
    const root = await temporaryRoot();
    const profiles = syntheticProfiles();
    const session = {
      close() {},
      async send(method) {
        if (method === 'Profiler.stop') return { profile: profiles.cpu };
        if (method === 'HeapProfiler.stopSampling') return { profile: profiles.heap };
        return {};
      },
    };
    const profiler = await createDevEditProfiler(
      { framework: 'kovo', inspectorPort: 49_202, modules: 24, profileDir: root },
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
    expect(() => summarizeProfileWindows([])).toThrow('at least one exact edit profile window');
  });
});

function category(analysis, id) {
  return analysis.categories.find((entry) => entry.category === id);
}

function syntheticProfiles() {
  return {
    cpu: {
      endTime: 20,
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

function frameNode(id, functionName, url) {
  return { callFrame: callFrame(functionName, url), hitCount: 0, id };
}

function callFrame(functionName, url) {
  return { columnNumber: 1, functionName, lineNumber: 1, scriptId: '1', url };
}

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-dev-profile-test-'));
  roots.push(root);
  return root;
}
