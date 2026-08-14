import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import {
  createDevProcessMarker,
  devProcessCensusArguments,
  markedDevProcessEnvironment,
  parseMarkedDevProcessCensus,
  signalMarkedDevProcesses,
  snapshotMarkedDevProcesses,
} from './dev-process-marker.mjs';

describe('dev process marker census', () => {
  it('matches only the exact inherited environment entry and excludes zombies', () => {
    const marker = 'KOVO_PERF_DEV_SESSION_TEST_1';
    const census = [
      `101 1 101 Ss node app.js HOME=/tmp ${marker}=1 TOKEN=x`,
      `102 1 102 S node app.js ${marker}=10`,
      `103 1 103 S node app.js PREFIX_${marker}=1`,
      `104 1 104 Z node app.js ${marker}=1`,
      `105 1 105 S node app.js --label=${marker}=1`,
      `106 1 106 S node app.js TOKEN=x ${marker}=1`,
      `0 1 0 S node app.js TOKEN=x ${marker}=1`,
    ].join('\n');

    expect(parseMarkedDevProcessCensus(census, marker)).toEqual([
      { pgid: 101, pid: 101, ppid: 1, state: 'Ss' },
      { pgid: 106, pid: 106, ppid: 1, state: 'S' },
    ]);
  });

  it('rechecks marker identity before signaling a potentially recycled PID', async () => {
    const marker = 'KOVO_PERF_DEV_SESSION_TEST_2';
    const snapshots = [[record(201), record(202)], [record(201), record(202)], [record(201)]];
    const signals = [];
    const result = await signalMarkedDevProcesses(marker, 'SIGTERM', {
      signalProcess: (pid, signal) => signals.push([pid, signal]),
      snapshotMarkedProcesses: async () => snapshots.shift() ?? [],
    });

    expect(result).toEqual({
      observed: [record(201), record(202)],
      signaled: [201],
    });
    expect(signals).toEqual([[201, 'SIGTERM']]);
  });

  it('finds and terminates a detached descendant after its launching parent exits', async () => {
    const marker = createDevProcessMarker();
    const source = [
      "const { spawn } = require('node:child_process');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 10000)'], {",
      '  detached: true,',
      '  env: process.env,',
      "  stdio: 'ignore',",
      '});',
      'child.unref();',
      'process.stdout.write(String(child.pid));',
    ].join('\n');
    const launcher = spawnSync(process.execPath, ['-e', source], {
      encoding: 'utf8',
      env: markedDevProcessEnvironment(process.env, marker),
      timeout: 5_000,
    });
    const detachedPid = Number(launcher.stdout);

    expect(launcher.status).toBe(0);
    expect(Number.isSafeInteger(detachedPid)).toBe(true);
    try {
      await expect(
        waitFor(async () =>
          (await snapshotMarkedDevProcesses(marker)).some(({ pid }) => pid === detachedPid),
        ),
      ).resolves.toBe(true);
      const cleanup = await signalMarkedDevProcesses(marker, 'SIGKILL');
      expect(cleanup.observed.map(({ pid }) => pid)).toContain(detachedPid);
      expect(cleanup.signaled).toContain(detachedPid);
      await expect(
        waitFor(async () => (await snapshotMarkedDevProcesses(marker)).length === 0),
      ).resolves.toBe(true);
    } finally {
      try {
        process.kill(detachedPid, 'SIGKILL');
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
      }
    }
  });

  it('uses the same bounded GNU procps/BSD census shape on supported hosts', () => {
    expect(devProcessCensusArguments('linux')).toEqual([
      'eww',
      '-A',
      '-o',
      'pid=,ppid=,pgid=,stat=,command=',
    ]);
    expect(devProcessCensusArguments('darwin')).toEqual(devProcessCensusArguments('linux'));
    expect(() => devProcessCensusArguments('win32')).toThrow('supports only Linux and macOS');
  });
});

function record(pid) {
  return { pgid: pid, pid, ppid: 1, state: 'S' };
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await delay(20);
  }
  return false;
}
